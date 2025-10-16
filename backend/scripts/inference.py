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


def run_inference(files, model, config_data):
    """Run inference on audio files using the model's predict method"""
    logger.info(f"Processing {len(files)} audio files")
    logger.info(f"Inference config: {config_data.get('inference_settings', {})}")

    try:
        # Progress tracking
        total_files = len(files)

        # Use the model's predict method with the configuration
        # This matches the streamlit implementation: model.predict(ss.selected_files, **ss.cfg["inference"])
        logger.info("Starting model prediction...")

        # Show progress
        logger.info(f"Progress: 0% (0/{total_files})")

        if config_data.get("mode") == "classify_from_hoplite":
            # run shallow classifier on features retrieved from hoplite db
            predictions = classify_from_hoplite_embeddings(files, model, config_data)
        else:  # run full forward pass of model
            predictions = model.predict(
                files, **config_data.get("inference_settings", {})
            )

        logger.info(f"Progress: 100% ({total_files}/{total_files})")
        logger.info(f"Predictions generated with shape: {predictions.shape}")

        return predictions

    except Exception as e:
        logger.error(f"Error during inference: {e}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")
        raise


def save_results(predictions, output_file, config_data):
    """Save predictions to file, optionally as sparse format"""

    sparse_threshold = config_data.get("sparse_save_threshold")
    # None -> save all scores

    if output_file:
        try:
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


def run_classification(model, files, job_dir, config_data):
    # Extract values from config file
    inference_config = config_data.get("inference_settings", {})
    logger.info(f"Inference Configuration: {inference_config}")

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

        for subfolder_name, files_subset in subfolder_groups.items():
            logger.info(
                f"Processing subfolder '{subfolder_name}' with {len(files_subset)} files"
            )

            # Generate output file name for this subfolder
            output_file = job_dir / f"{subfolder_name}_{out_name}"
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
        predictions = run_inference(files, model, inference_config)

        output_file = job_dir / out_name
        save_results(predictions, output_file, inference_config)

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

    try:
        # Resolve files from any of the specified methods in the config
        files = resolve_files_from_config(config_data, logger)

        # Validate first file exists
        if not os.path.exists(files[0]):
            raise FileNotFoundError(
                f"Did not find first file {files[0]}: was this config generated for a different file system? Perhaps an external drive is detached?"
            )

        # initialize model from BMZ or local file
        logger.info("Loading and initializing model from configuration")
        model = load_model(config_data, logger)

        logger.info(f"Saving outputs to: {config_data.get('job_folder')}")

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

        # Inference comes in two flavors:
        # run a classification procedure with model.predict(), or embed to database with .embed_to_hoplite_db()
        if config_data.get("mode") == "classification":
            run_classification(model, files, job_dir, config_data)
        elif config_data.get("mode") == "embed_to_hoplite":
            assert hasattr(
                model, "embed_to_hoplite_db"
            ), "Embedding to a HopLite database is not supported by the selected model: the model object does not have a method `embed_to_hoplite_db()`"
            embed_hoplite(model, files, config_data)
        elif config_data.get("mode") == "classify_from_hoplite":
            assert (
                config_data.get("model_source") == "mlp_classifier"
            ), "When classifying from Hoplite embeddings, you must select a shallow classifier as the model (model_source = 'mlp_classifier')"
        else:
            raise ValueError(
                f"Unknown mode: {config_data.get('mode')}. Supported modes are 'classification', 'embed_to_hoplite', and 'classify_from_hoplite'"
            )

    except Exception as e:
        logger.error(f"Inference failed: {e}")
        error_summary = {"status": "error", "error": str(e)}
        print(json.dumps(error_summary))
        sys.exit(1)


if __name__ == "__main__":
    main()
