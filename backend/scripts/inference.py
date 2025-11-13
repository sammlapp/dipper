#!/usr/bin/env python3
"""
Inference script for bioacoustics models from model zoo or local model file
"""

import argparse
import json
import sys
import os
import logging
import pandas as pd
import numpy as np
from pathlib import Path

import torch
from load_model import load_model
from file_selection import resolve_files_from_config
import opensoundscape as opso

from config_utils import load_config_file

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


def update_status(
    job_folder, status, stage=None, progress=None, message=None, **metadata
):
    """Write status update to .status file in job directory

    Args:
        job_folder: Path to directory where job stores outputs
        status: Current status (e.g., 'running', 'completed', 'error')
        stage: Current stage of processing (e.g., 'loading_model', 'processing_files')
        progress: Progress percentage (0-100)
        message: Human-readable status message
        **metadata: Additional metadata to include in status file
    """
    import time

    status_file = Path(job_folder) / ".status"
    status_data = {"status": status, "timestamp": time.time()}
    if stage:
        status_data["stage"] = stage
    if message:
        status_data["message"] = message
    if progress is not None:
        status_data["progress"] = progress
    if metadata:
        status_data["metadata"] = metadata

    try:
        with open(status_file, "w") as f:
            json.dump(status_data, f, indent=2)
        logger.info(f"Updated status: {status_data}")
    except Exception as e:
        logger.warning(f"Failed to update status file: {e}")


def run_inference(files, model, config_data):
    """Run inference on audio files using the model's predict method"""
    logger.info(f"Processing {len(files)} audio files")
    logger.info(f"Inference config: {config_data.get('inference_settings', {})}")

    try:
        # Progress tracking
        total_files = len(files)
        job_folder = config_data.get("job_folder")

        # Use the model's predict method with the configuration
        # This matches the streamlit implementation: model.predict(ss.selected_files, **ss.cfg["inference"])
        logger.info("Starting model prediction...")

        if config_data.get("mode") == "classify_from_hoplite":
            # run shallow classifier on features retrieved from hoplite db
            predictions = classify_from_hoplite_embeddings(files, model, config_data)
        else:  # run full forward pass of model
            predictions = model.predict(
                files, **config_data.get("inference_settings", {})
            )

        logger.info(f"Progress: 100% ({total_files}/{total_files})")
        logger.info(f"Predictions generated with shape: {predictions.shape}")
        update_status(
            job_folder,
            "running",
            stage="processing_files",
            progress=100,
            message=f"Completed processing {total_files} files",
        )

        return predictions

    except Exception as e:
        logger.error(f"Error during inference: {e}")
        update_status(
            job_folder,
            "error",
            stage="processing_files",
            message=f"Error during inference: {str(e)}",
        )
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")
        raise


def save_results(predictions, output_file, config_data):
    """Save predictions to file, optionally as sparse format"""

    sparse_threshold = config_data.get("sparse_save_threshold")
    # None -> save all scores

    if output_file:
        try:
            job_folder = config_data.get("job_folder")
            update_status(
                job_folder,
                "running",
                stage="saving_results",
                message=f"Saving predictions to {os.path.basename(output_file)}",
            )

            if sparse_threshold is None:
                # save all scores for all classes and clips
                predictions.to_csv(output_file)
            else:
                # create sparse dataframe discarding clip scores below threshold
                # save as pickle
                predictions[predictions < sparse_threshold] = np.nan
                sparse_df = predictions.astype(
                    pd.SparseDtype("float", fill_value=np.nan)
                )
                sparse_df.to_pickle(output_file)

                # Note: Load this pickled sparse df from file using:
                # sparse_df_loaded = pd.read_pickle("sparse_df.pkl")
            logger.info(f"Predictions saved to: {output_file}")
        except Exception as e:
            logger.error(f"Failed to save predictions: {e}")
            update_status(
                job_folder,
                "error",
                stage="saving_results",
                message=f"Failed to save predictions: {str(e)}",
            )
            raise


def group_files_by_subfolder(files):
    """
    Group files by their immediate parent directory (subfolder).

    Args:
        files: List of file paths

    Returns:
        Dictionary mapping subfolder names to lists of files
    """
    from collections import defaultdict

    subfolder_groups = defaultdict(list)
    subfolder_dirs = {}

    for file_path in files:
        # Get the immediate parent directory name
        parent_dir = os.path.dirname(file_path)
        subfolder_name = os.path.basename(parent_dir) if parent_dir else "root"

        # Handle edge cases
        if not subfolder_name or subfolder_name == ".":
            subfolder_name = "root"

        # Raise an error if there is another subfolder with the same name
        if subfolder_name in subfolder_groups:
            # Same folder name: ensure parent directories are identical
            # otherwise we have a naming conflict where multiple
            # subfolders have the same name
            assert (
                parent_dir == subfolder_dirs[subfolder_name]
            ), f"Duplicate subfolder name '{subfolder_name}' found"
        else:
            subfolder_dirs[subfolder_name] = parent_dir

        subfolder_groups[subfolder_name].append(file_path)

    # Convert to regular dict
    return dict(subfolder_groups)


def run_classification(model, files, config_data):
    # Extract values from config file
    inference_config = config_data.get("inference_settings", {})
    logger.info(f"Inference Configuration: {inference_config}")

    job_folder = config_data.get("job_folder")

    out_name = (
        "predictions.csv"
        if config_data.get("sparse_save_threshold") is None
        else "sparse_preds.pkl"
    )
    summary = {}

    # Check if we should split by subfolder
    split_by_subfolder = config_data.get("split_by_subfolder", False)

    if split_by_subfolder:
        logger.info("Splitting inference task by subfolders")

        # Group files by subfolder
        subfolder_groups = group_files_by_subfolder(files)
        logger.info(
            f"Found {len(subfolder_groups)} subfolders: {list(subfolder_groups.keys())}"
        )

        all_results = []
        output_files = []

        for i, (subfolder_name, files_subset) in enumerate(subfolder_groups.items()):
            logger.info(
                f"Processing subfolder {i+1} of {len(subfolder_groups)} ('{subfolder_name}') with {len(files_subset)} files"
            )
            update_status(
                job_folder,
                "running",
                stage=f"processing_{subfolder_name}",
                progress=int((i / len(subfolder_groups)) * 100),
                message=f"Processing subfolder {i+1} of {len(subfolder_groups)}: '{subfolder_name}'",
            )

            # Generate output file name for this subfolder
            output_file = Path(job_folder) / f"{subfolder_name}_{out_name}"
            output_files.append(str(output_file))

            # Run inference on this subset
            try:
                predictions = run_inference(files_subset, model, config_data)
                save_results(
                    predictions,
                    config_data=config_data,
                    output_file=str(output_file),
                )
                all_results.append(
                    {
                        "subfolder": subfolder_name,
                        "file_count": len(files_subset),
                        "output_file": str(output_file),
                        "status": "success",
                    }
                )
                logger.info(f"Completed subfolder '{subfolder_name}' -> {output_file}")
            except Exception as e:
                logger.error(f"Failed to process subfolder '{subfolder_name}': {e}")
                all_results.append(
                    {
                        "subfolder": subfolder_name,
                        "file_count": len(files_subset),
                        "output_file": str(output_file),
                        "status": "error",
                        "error": str(e),
                    }
                )

        # Create summary of all subfolder results
        summary.update(
            {
                "status": "success",
                "files_processed": len(files),
                "split_by_subfolder": True,
                "subfolders_processed": len(subfolder_groups),
                "output_files": output_files,
                "total_files": len(files),
                "subfolder_results": all_results,
            }
        )

    else:
        # Run inference normally (single output)
        model_name = (
            config_data.get("model")
            if config_data.get("model_source", "bmz") == "bmz"
            else "local model"
        )
        logger.info(f"Starting inference with model: {model_name}")
        # Show progress
        total_files = len(files)
        logger.info(f"Progress: 0% (0/{total_files})")
        update_status(
            job_folder,
            "running",
            stage="processing_files",
            progress=0,
            message=f"Processing {total_files} audio files",
        )
        predictions = run_inference(files, model, config_data)

        output_file = Path(job_folder) / out_name
        save_results(predictions, output_file, config_data)

        # summary of task completed
        summary.update(
            {
                "split_by_subfolder": False,
                "total_files": len(files),
                "output_file": str(output_file),
                "status": "success",
                "files_processed": len(files),
                "predictions_shape": list(predictions.shape),
                "species_detected": (
                    list(predictions.columns) if hasattr(predictions, "columns") else []
                ),
            }
        )

    logger.info("Inference completed successfully")

    update_status(
        job_folder,
        "completed",
        stage="finished",
        progress=100,
        message="Inference completed successfully",
    )

    print(json.dumps(summary))


def embed_hoplite(model, files, config_data):
    from hoplite_utils import load_or_create_db

    # initialize new database or connect to existing database at path config_data["db_path"]
    db = load_or_create_db(
        config_data, embedding_dim=model.classifier.in_features, logger=logger
    )

    ## Embed all audio to into the database under the specified dataset
    # Note that multiple datasets can be within the same db
    # Samples with the same dataset name, file path, and offset that have already been embedded are skipped
    model.embed_to_hoplite_db(
        files,
        db=db,
        dataset_name=config_data["dataset_name"],
        audio_root=config_data["audio_root"],
        batch_size=config_data.get("inference_config")["batch_size"],
        num_workers=config_data.get("inference_config")["num_workers"],
    )

    logger.info("completed embedding samples to Hoplite DB")


def classify_from_hoplite_embeddings(files, classifier, config_data):
    # establish db connection
    from hoplite_utils import load_or_create_db

    db = load_or_create_db(config_data, embedding_dim=None, logger=logger)

    # retrieve features from db
    clips = opso.make_clip_df(
        files,
        config_data.get("clip_duration"),
        clip_overlap=None,
        clip_overlap_fraction=None,
        clip_step=None,
        final_clip=None,
        return_invalid_samples=False,
        raise_exceptions=False,
        audio_root=None,
    )
    index_values = []
    train_embeddings = []
    for f, s, e in clips.index:
        ids = db.get_embeddings_by_source(
            dataset_name=config_data.get("dataset_name"),
            source_id=f,
            offsets=np.array([s], dtype=np.float16),
        )
        assert (
            len(ids) == 1
        ), f"Expected exactly one embedding for file {f} at offset {s}, but found {len(ids)}"
        emb = db.get_embedding(id)
        train_embeddings.append(emb)
        # index_values.append((f, s, e))
    train_embeddings = np.vstack(train_embeddings)

    preds = classifier(torch.tensor(train_embeddings)).detach().numpy()
    return pd.DataFrame(preds, index=clips.index, columns=classifier.class_names)


def main():
    parser = argparse.ArgumentParser(description="Run bioacoustics model inference")
    parser.add_argument(
        "--config", required=True, help="Path to inference configuration file"
    )
    args = parser.parse_args()

    # Load configuration from file
    config_data = load_config_file(args.config, logger=logger)

    # Get job folder for status updates
    job_folder = Path(config_data.get("job_folder"))

    try:

        # Resolve files from any of the specified methods in the config
        update_status(
            job_folder,
            "running",
            stage="resolving_files",
            message="Resolving audio files from configuration",
        )
        files = resolve_files_from_config(config_data, logger)

        # Validate first file exists
        if not os.path.exists(files[0]):
            raise FileNotFoundError(
                f"Did not find first file {files[0]}: was this config generated for a different file system? Perhaps an external drive is detached?"
            )

        # initialize model from BMZ or local file
        logger.info("Loading and initializing model from configuration")
        update_status(
            job_folder,
            "running",
            stage="loading_model",
            message="Loading and initializing model",
        )
        model = load_model(config_data, logger)

        logger.info(f"Output directory: {config_data.get('output_dir')}")

        # missing_files = [f for f in files if not os.path.exists(f)]
        # if missing_files:
        #     logger.error(f"Missing files: {missing_files[:5]}...")  # Show first 5
        #     raise FileNotFoundError(f"Missing {len(missing_files)} files")

        # Save config to the output directory
        job_dir = Path(config_data.get("job_folder"))
        config_save_path = job_dir / "inference_config.json"
        Path(config_save_path).parent.mkdir(parents=True, exist_ok=True)
        with open(config_save_path, "w") as f:
            json.dump(config_data, f, indent=4)

        # Run on a small subset of data if specified
        if "subset_size" in config_data and config_data["subset_size"] is not None:
            subset_size = min(config_data["subset_size"], len(files))
            logger.info(f"Using a SUBSET of {subset_size} files as a test run")
            files = np.random.choice(files, size=subset_size, replace=False).tolist()
        else:
            logger.info(f"Running model on {len(files)} files")

        # Inference comes in three flavors:
        # run a classification procedure with model.predict(), or embed to database with .embed_to_hoplite_db()
        # or run a classifier on hoplite embeddings with .classify_from_hoplite_embeddings()
        mode = config_data.get("mode")
        if mode is None:
            mode = "classification"
        logger.info("current mode: " + mode)
        if mode == "classification":
            run_classification(model, files, config_data)
        elif mode == "embed_to_hoplite":
            assert hasattr(
                model, "embed_to_hoplite_db"
            ), "Embedding to a HopLite database is not supported by the selected model: the model object does not have a method `embed_to_hoplite_db()`"
            embed_hoplite(model, files, config_data)
        elif mode == "classify_from_hoplite":
            assert (
                config_data.get("model_source") == "mlp_classifier"
            ), "When classifying from Hoplite embeddings, you must select a shallow classifier as the model (model_source = 'mlp_classifier')"
        else:
            raise ValueError(
                f"Unknown mode: {mode}. Supported modes are 'classification', 'embed_to_hoplite', and 'classify_from_hoplite'"
            )

    except Exception as e:
        logger.error(f"Inference failed: {e}")
        update_status(
            job_folder,
            "error",
            stage="failed",
            message=f"Inference failed: {str(e)}",
        )
        error_summary = {"status": "error", "error": str(e)}
        print(json.dumps(error_summary))
        sys.exit(1)


if __name__ == "__main__":
    main()
