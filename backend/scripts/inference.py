#!/usr/bin/env python3
"""
Inference script for bioacoustics models
Based on streamlit_inference.py implementation
"""

import argparse
import json
import sys
import os
import logging
import pandas as pd
import numpy as np
import glob
from pathlib import Path

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


def load_model(model_name):
    """Load a model from the bioacoustics model zoo"""
    try:
        logger.info(f"Loading model: {model_name}")

        # Import here to avoid import errors if not installed
        import bioacoustics_model_zoo as bmz
        import pydantic.deprecated.decorator  # Fix for pydantic error

        # Load model using the same approach as streamlit_inference.py
        model = getattr(bmz, model_name)()
        logger.info(f"Model loaded successfully: {type(model).__name__}")
        return model
    except ImportError as e:
        logger.error(
            f"Import error - make sure bioacoustics_model_zoo is installed: {e}"
        )
        raise
    except AttributeError as e:
        logger.error(f"Model {model_name} not found in bioacoustics_model_zoo: {e}")
        raise
    except Exception as e:
        logger.error(f"Failed to load model {model_name}: {e}")
        raise


def run_inference(files, model, config):
    """Run inference on audio files using the model's predict method"""
    logger.info(f"Processing {len(files)} audio files")
    logger.info(f"Inference config: {config}")

    try:
        # Progress tracking
        total_files = len(files)

        # Use the model's predict method with the configuration
        # This matches the streamlit implementation: model.predict(ss.selected_files, **ss.cfg["inference"])
        logger.info("Starting model prediction...")

        # Show progress
        logger.info(f"Progress: 0% (0/{total_files})")

        predictions = model.predict(files, **config)

        logger.info(f"Progress: 100% ({total_files}/{total_files})")
        logger.info(f"Predictions generated with shape: {predictions.shape}")

        return predictions

    except Exception as e:
        logger.error(f"Error during inference: {e}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")
        raise


def save_results(predictions, output_file):
    """Save predictions to file"""
    if output_file:
        try:
            predictions.to_csv(output_file)
            logger.info(f"Predictions saved to: {output_file}")
        except Exception as e:
            logger.error(f"Failed to save predictions: {e}")
            raise


def resolve_files_from_config(config_data):
    """
    Resolve audio files from config using exactly one file selection method.

    Args:
        config_data: Configuration dictionary containing one of:
            - files: List of file paths
            - file_globbing_patterns: List of glob patterns
            - file_list: Path to text file with one file per line

    Returns:
        List of audio file paths

    Raises:
        ValueError: If multiple file selection methods are specified or none found
    """
    # Audio file extensions (case-insensitive)
    AUDIO_EXTENSIONS = {
        ".wav",
        ".mp3",
        ".flac",
        ".ogg",
        ".m4a",
        ".aac",
        ".wma",
        ".aiff",
    }

    # Check which file selection methods are specified
    has_files = bool(config_data.get("files"))
    has_patterns = bool(config_data.get("file_globbing_patterns"))
    has_file_list = bool(config_data.get("file_list"))

    methods_specified = sum([has_files, has_patterns, has_file_list])

    if methods_specified == 0:
        raise ValueError(
            "Config error: No file selection method specified. Please provide 'files', 'file_globbing_patterns', or 'file_list'"
        )

    if methods_specified > 1:
        methods = []
        if has_files:
            methods.append("files")
        if has_patterns:
            methods.append("file_globbing_patterns")
        if has_file_list:
            methods.append("file_list")
        raise ValueError(
            f"Config error: Multiple file selection methods specified: {', '.join(methods)}. Please specify only one method."
        )

    files = []

    # Process files array
    if has_files:
        files = config_data["files"]
        logger.info(f"Using files array with {len(files)} files")

    # Process glob patterns
    elif has_patterns:
        patterns = config_data["file_globbing_patterns"]
        logger.info(f"Processing {len(patterns)} glob patterns")

        for pattern in patterns:
            try:
                matched_files = glob.glob(pattern, recursive=True)
                files.extend(matched_files)
                logger.info(f"Pattern '{pattern}' matched {len(matched_files)} files")
            except Exception as e:
                logger.error(f"Invalid glob pattern '{pattern}': {e}")
                raise ValueError(f"Invalid glob pattern '{pattern}': {e}")

    # Process file list
    elif has_file_list:
        file_list_path = config_data["file_list"]
        logger.info(f"Reading file list from: {file_list_path}")

        if not os.path.exists(file_list_path):
            raise FileNotFoundError(f"File list not found: {file_list_path}")

        try:
            with open(file_list_path, "r", encoding="utf-8") as f:
                files = [line.strip() for line in f if line.strip()]
            logger.info(f"Loaded {len(files)} files from file list")
        except Exception as e:
            logger.error(f"Failed to read file list '{file_list_path}': {e}")
            raise ValueError(f"Failed to read file list '{file_list_path}': {e}")

    # Filter by audio file extensions
    def is_audio_file(filepath):
        return Path(filepath).suffix.lower() in AUDIO_EXTENSIONS

    audio_files = [f for f in files if is_audio_file(f)]
    filtered_count = len(files) - len(audio_files)

    if filtered_count > 0:
        logger.info(f"Filtered out {filtered_count} non-audio files")

    # Remove duplicates while preserving order
    seen = set()
    unique_files = []
    for f in audio_files:
        if f not in seen:
            seen.add(f)
            unique_files.append(f)

    duplicates_removed = len(audio_files) - len(unique_files)
    if duplicates_removed > 0:
        logger.info(f"Removed {duplicates_removed} duplicate files")

    if not unique_files:
        raise ValueError("No audio files found after processing file selection method")

    logger.info(f"Final file list contains {len(unique_files)} unique audio files")
    return unique_files


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

    for file_path in files:
        # Get the immediate parent directory name
        parent_dir = os.path.dirname(file_path)
        subfolder_name = os.path.basename(parent_dir) if parent_dir else "root"

        # Handle edge cases
        if not subfolder_name or subfolder_name == ".":
            subfolder_name = "root"

        # Raise an error if there is another subfolder with the same name
        if subfolder_name in subfolder_groups:
            raise ValueError(f"Duplicate subfolder name '{subfolder_name}' found")

        subfolder_groups[subfolder_name].append(file_path)

    # Convert to regular dict
    return dict(subfolder_groups)


def load_config_file(config_path):
    """Load inference configuration from YAML or JSON file"""
    try:
        import yaml

        with open(config_path, "r") as f:
            if config_path.endswith(".yml") or config_path.endswith(".yaml"):
                config = yaml.safe_load(f)
            else:
                config = json.load(f)
        return config
    except ImportError:
        # Fallback to JSON if yaml not available
        with open(config_path, "r") as f:
            config = json.load(f)
        return config
    except Exception as e:
        logger.error(f"Failed to load config file {config_path}: {e}")
        raise


def main():
    parser = argparse.ArgumentParser(description="Run bioacoustics model inference")
    parser.add_argument(
        "--config", required=True, help="Path to inference configuration file"
    )
    args = parser.parse_args()

    # Load configuration from file
    config_data = load_config_file(args.config)

    try:
        # Extract values from config file, with command line overrides
        model_name = config_data.get("model")
        output_file = config_data.get("output_file")
        inference_config = config_data.get("inference_settings", {})

        if not model_name:
            raise ValueError("Model name not specified in config file or command line")

        # Resolve files using new multi-method approach
        files = resolve_files_from_config(config_data)

        logger.info(f"Processing {len(files)} files")
        logger.info(f"Configuration: {inference_config}")
        logger.info(f"Output file: {output_file}")

        # Validate files exist (TODO: skip this? will be slow for very large datsets. Could get list back from .predict() instead.)
        if not os.path.exists(files[0]):
            raise FileNotFoundError(
                f"Did not find first file {files[0]}: was this config generated for a different file system? Perhaps an external drive is detached?"
            )
        # missing_files = [f for f in files if not os.path.exists(f)]
        # if missing_files:
        #     logger.error(f"Missing files: {missing_files[:5]}...")  # Show first 5
        #     raise FileNotFoundError(f"Missing {len(missing_files)} files")

        # Load model
        logger.info(f"Loading model: {model_name}")
        model = load_model(model_name)

        # Save config to the output directory
        config_save_path = Path(output_file).parent / "inference_config.json"
        Path(config_save_path).parent.mkdir(parents=True, exist_ok=True)
        with open(config_save_path, "w") as f:
            json.dump(config_data, f, indent=4)

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
                base_output = Path(output_file)
                subfolder_output = (
                    base_output.parent / f"{subfolder_name}_{base_output.stem}.csv"
                )
                output_files.append(str(subfolder_output))

                # Run inference on this subset
                try:
                    predictions = run_inference(files_subset, model, inference_config)
                    save_results(predictions, str(subfolder_output))
                    all_results.append(
                        {
                            "subfolder": subfolder_name,
                            "file_count": len(files_subset),
                            "output_file": str(subfolder_output),
                            "status": "success",
                        }
                    )
                    logger.info(
                        f"Completed subfolder '{subfolder_name}' -> {subfolder_output}"
                    )
                except Exception as e:
                    logger.error(f"Failed to process subfolder '{subfolder_name}': {e}")
                    all_results.append(
                        {
                            "subfolder": subfolder_name,
                            "file_count": len(files_subset),
                            "output_file": str(subfolder_output),
                            "status": "error",
                            "error": str(e),
                        }
                    )

            # Create summary of all subfolder results
            summary_results = {
                "split_by_subfolder": True,
                "subfolders_processed": len(subfolder_groups),
                "total_files": len(files),
                "results": all_results,
                "output_files": output_files,
            }

        else:
            # Run inference normally (single output)
            logger.info(f"Starting inference with model: {model_name}")
            predictions = run_inference(files, model, inference_config)
            save_results(predictions, output_file)

            summary_results = {
                "split_by_subfolder": False,
                "total_files": len(files),
                "output_file": output_file,
            }

        # Output summary for the GUI
        if split_by_subfolder:
            # For split mode, include summary_results and don't assume single predictions shape
            summary = {
                "status": "success",
                "files_processed": len(files),
                **summary_results,  # Include all subfolder information
            }
        else:
            # For single mode, include traditional summary info
            summary = {
                "status": "success",
                "files_processed": len(files),
                "predictions_shape": list(predictions.shape),
                "output_file": output_file,
                "species_detected": (
                    list(predictions.columns) if hasattr(predictions, "columns") else []
                ),
                **summary_results,  # Include split_by_subfolder flag
            }

        logger.info("Inference completed successfully")
        print(json.dumps(summary))

    except Exception as e:
        logger.error(f"Inference failed: {e}")
        error_summary = {"status": "error", "error": str(e)}
        print(json.dumps(error_summary))
        sys.exit(1)


if __name__ == "__main__":
    main()
