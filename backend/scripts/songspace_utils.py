#!/usr/bin/env python3
"""
SongSpace backend utilities for Dipper.

Each function is called by the lightweight_server and returns a JSON-serializable dict.
The SongSpace instance is kept alive in a module-level registry keyed by db_path.
"""
import json
import traceback
from pathlib import Path

# Module-level registry: db_path (str) -> SongSpace instance
_songspace_registry = {}


def _ss(db_path: str):
    """Return cached SongSpace instance for db_path, or raise KeyError."""
    key = str(Path(db_path).resolve())
    if key not in _songspace_registry:
        raise KeyError(f"No SongSpace open for path: {db_path}")
    return _songspace_registry[key]


def _register(db_path: str, ss):
    key = str(Path(db_path).resolve())
    _songspace_registry[key] = ss


def create_songspace(db_path: str, feature_extractor: str = "perch2") -> dict:
    """Create a new SongSpace at db_path with the given feature extractor."""
    try:
        from opensoundscape.ml.song_space import SongSpace
        db_path = str(Path(db_path).resolve())
        ss = SongSpace(db_path, feature_extractor=feature_extractor)
        ss.save()
        _register(db_path, ss)
        return {"status": "ok", "db_path": db_path, "info": _songspace_info(db_path)}
    except Exception as e:
        return {"status": "error", "error": str(e), "traceback": traceback.format_exc()}


def open_songspace(db_path: str) -> dict:
    """Open an existing SongSpace at db_path, restoring datasets and classifiers."""
    try:
        from opensoundscape.ml.song_space import SongSpace
        db_path = str(Path(db_path).resolve())
        ss = SongSpace.open(db_path)
        _register(db_path, ss)
        return {"status": "ok", "db_path": db_path, "info": _songspace_info(db_path)}
    except Exception as e:
        return {"status": "error", "error": str(e), "traceback": traceback.format_exc()}


def _dataset_summary(ss, name: str) -> dict:
    ds = ss.datasets[name]
    df = ds["label_df"]
    classes = [c for c in df.columns]
    n_labeled = int(df[classes].notna().any(axis=1).sum()) if classes else 0
    return {
        "name": name,
        "n_samples": len(df),
        "n_labeled": n_labeled,
        "classes": classes,
        "allow_training": ds.get("allow_training", True),
    }


def _classifier_summary(ss, name: str) -> dict:
    clf = ss.classifiers[name]
    return {
        "name": name,
        "classes": list(clf.classes) if hasattr(clf, "classes") else [],
        "n_classes": len(clf.classes) if hasattr(clf, "classes") else 0,
    }


def _songspace_info(db_path: str) -> dict:
    ss = _ss(db_path)
    return {
        "db_path": db_path,
        "feature_extractor": getattr(ss, "model_source", "unknown"),
        "embedding_dim": ss.embedding_dim,
        "sample_duration": ss.sample_duration,
        "datasets": [_dataset_summary(ss, n) for n in ss.datasets],
        "classifiers": [_classifier_summary(ss, n) for n in ss.classifiers],
        "n_embeddings": ss.database.count() if hasattr(ss.database, "count") else None,
    }


def ingest_audio(
    db_path: str,
    samples,  # path to folder (str) or CSV file (str)
    dataset_name: str,
    allow_training: bool = True,
    file_to_deployment: str = "parent_folder_name",
    embedding_exists_mode: str = "skip",
    bypass_augmentations: bool = True,
    audio_root: str = None,
) -> dict:
    """Ingest audio into SongSpace from a folder path or annotation CSV."""
    try:
        from opensoundscape.ml.song_space import (
            parent_folder_name,
            two_parents_name,
            second_parent_name,
            filename_first_part,
        )
        import pandas as pd

        ss = _ss(db_path)

        # Resolve file_to_deployment function
        _deployment_fns = {
            "parent_folder_name": parent_folder_name,
            "two_parents_name": two_parents_name,
            "second_parent_name": second_parent_name,
            "filename_first_part": filename_first_part,
        }
        deployment_fn = _deployment_fns.get(file_to_deployment, parent_folder_name)

        # Resolve samples: folder path → pass as-is; CSV → load as DataFrame
        samples_arg = samples
        if isinstance(samples, str):
            p = Path(samples)
            if p.is_file() and p.suffix.lower() == ".csv":
                df = pd.read_csv(samples)
                # Set multi-index if columns present
                idx_cols = [c for c in ["file", "start_time", "end_time"] if c in df.columns]
                if idx_cols:
                    df = df.set_index(idx_cols)
                samples_arg = df

        kwargs = dict(
            samples=samples_arg,
            dataset_name=dataset_name,
            file_to_deployment=deployment_fn,
            allow_training=allow_training,
            embedding_exists_mode=embedding_exists_mode,
            bypass_augmentations=bypass_augmentations,
        )
        if audio_root:
            kwargs["audio_root"] = audio_root

        ss.ingest_audio(**kwargs)
        ss.save()
        return {"status": "ok", "info": _songspace_info(db_path)}
    except KeyError as e:
        return {"status": "error", "error": str(e)}
    except Exception as e:
        return {"status": "error", "error": str(e), "traceback": traceback.format_exc()}


def get_info(db_path: str) -> dict:
    try:
        return {"status": "ok", "info": _songspace_info(db_path)}
    except KeyError as e:
        return {"status": "error", "error": str(e)}
    except Exception as e:
        return {"status": "error", "error": str(e), "traceback": traceback.format_exc()}


def fit_classifier(
    db_path: str,
    classifier_name: str,
    classes: list,
    train_datasets: list,
    validation_dataset: str,
    weak_negatives_proportion: float = 2.0,
    steps: int = 500,
    batch_size: int = 128,
) -> dict:
    """Train a classifier and register it in the SongSpace."""
    try:
        ss = _ss(db_path)
        clf = ss.fit_classifier(
            classes=classes if classes else None,
            train_datasets=train_datasets,
            validation_dataset=validation_dataset if validation_dataset else None,
            weak_negatives_proportion=weak_negatives_proportion,
            steps=steps,
            batch_size=batch_size,
        )
        # register under chosen name (replace if exists)
        if classifier_name in ss.classifiers:
            ss.remove_classifier(classifier_name)
        ss.add_classifier(classifier_name, clf)
        ss.save()
        summary = _classifier_summary(ss, classifier_name)
        # include val metrics if available
        val_metrics = getattr(clf, "val_metrics", None)
        if val_metrics is not None:
            try:
                import math
                last = val_metrics[-1] if isinstance(val_metrics, list) else None
                if last and isinstance(last, dict):
                    summary["last_val_metrics"] = {
                        k: (None if (isinstance(v, float) and math.isnan(v)) else v)
                        for k, v in last.items()
                    }
            except Exception:
                pass
        return {"status": "ok", "classifier": summary}
    except KeyError as e:
        return {"status": "error", "error": str(e)}
    except Exception as e:
        return {"status": "error", "error": str(e), "traceback": traceback.format_exc()}


def predict_and_save(
    db_path: str,
    classifier_name: str,
    dataset_name: str,
    output_csv: str,
    batch_size: int = 1024,
) -> dict:
    """Apply classifier to dataset, save predictions CSV, return path."""
    try:
        ss = _ss(db_path)
        preds = ss.predict_on_dataset(classifier_name, dataset_name, batch_size=batch_size)
        # Reset index so file/start_time/end_time become columns
        preds_out = preds.reset_index()
        Path(output_csv).parent.mkdir(parents=True, exist_ok=True)
        preds_out.to_csv(output_csv, index=False)
        return {
            "status": "ok",
            "csv_path": output_csv,
            "n_predictions": len(preds_out),
            "classes": [c for c in preds.columns],
        }
    except KeyError as e:
        return {"status": "error", "error": str(e)}
    except Exception as e:
        return {"status": "error", "error": str(e), "traceback": traceback.format_exc()}


def similarity_search(
    db_path: str,
    dataset_name: str,
    sample_indices: list,
    k: int = 20,
    exact_search: bool = False,
) -> dict:
    """Run similarity search using selected samples as queries.

    sample_indices: list of integer row indices into the dataset's label_df.
    Returns top-k matches as list of dicts with file/start_time/end_time/score.
    """
    try:
        ss = _ss(db_path)
        label_df = ss.datasets[dataset_name]["label_df"]
        if not sample_indices:
            return {"status": "error", "error": "No samples selected for search"}
        query_df = label_df.iloc[sample_indices]
        results = ss.similarity_search(query_df, k=k, exact_search=exact_search)
        # results is a DataFrame with index (file,start_time,end_time) and similarity column
        results_reset = results.reset_index()
        # take top k by sort_score or similarity
        score_col = "sort_score" if "sort_score" in results_reset.columns else "similarity" if "similarity" in results_reset.columns else None
        if score_col:
            results_reset = results_reset.sort_values(score_col, ascending=False).head(k)
        records = []
        for _, row in results_reset.iterrows():
            rec = {
                "file": str(row.get("file", "")),
                "start_time": float(row.get("start_time", 0)),
                "end_time": float(row.get("end_time", 0)),
            }
            if score_col:
                rec["score"] = float(row.get(score_col, 0))
            records.append(rec)
        return {"status": "ok", "results": records}
    except KeyError as e:
        return {"status": "error", "error": str(e)}
    except Exception as e:
        return {"status": "error", "error": str(e), "traceback": traceback.format_exc()}


def get_dataset_samples(db_path: str, dataset_name: str, max_rows: int = 500) -> dict:
    """Return a sample of rows from a dataset for display."""
    try:
        ss = _ss(db_path)
        df = ss.datasets[dataset_name]["label_df"]
        subset = df.head(max_rows).reset_index()
        records = []
        for _, row in subset.iterrows():
            rec = {
                "file": str(row.get("file", "")),
                "start_time": float(row.get("start_time", 0)) if "start_time" in row else 0,
                "end_time": float(row.get("end_time", 0)) if "end_time" in row else 0,
            }
            # include label columns
            for col in df.columns:
                val = row.get(col)
                if val is not None:
                    try:
                        import math
                        if isinstance(val, float) and math.isnan(val):
                            rec[col] = None
                        else:
                            rec[col] = val
                    except Exception:
                        rec[col] = str(val)
            records.append(rec)
        return {
            "status": "ok",
            "dataset_name": dataset_name,
            "total": len(df),
            "shown": len(records),
            "columns": ["file", "start_time", "end_time"] + list(df.columns),
            "records": records,
        }
    except KeyError as e:
        return {"status": "error", "error": str(e)}
    except Exception as e:
        return {"status": "error", "error": str(e), "traceback": traceback.format_exc()}
