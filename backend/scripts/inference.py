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
        files = config_data.get("files", [])
        output_file = config_data.get("output_file")
        inference_config = config_data.get("inference_settings", {})

        if not model_name:
            raise ValueError("Model name not specified in config file or command line")
        if not files:
            raise ValueError("Audio files not specified in config file or command line")

        logger.info(f"Starting inference with model: {model_name}")
        logger.info(f"Processing {len(files)} files")
        logger.info(f"Configuration: {inference_config}")
        logger.info(f"Output file: {output_file}")

        # Validate files exist
        missing_files = [f for f in files if not os.path.exists(f)]
        if missing_files:
            logger.error(f"Missing files: {missing_files[:5]}...")  # Show first 5
            raise FileNotFoundError(f"Missing {len(missing_files)} files")

        # Load model
        model = load_model(model_name)

        # Save config to the output directory
        config_save_path = output_file + "inference_config.json"
        Path(config_save_path).parent.mkdir(parents=True, exist_ok=True)
        with open(config_save_path, "w") as f:
            json.dump(config_data, f, indent=4)

        # Run inference
        predictions = run_inference(files, model, inference_config)

        # Save results
        save_results(predictions, output_file)

        # Output summary for the GUI
        summary = {
            "status": "success",
            "files_processed": len(files),
            "predictions_shape": list(predictions.shape),
            "output_file": output_file,
            "species_detected": (
                list(predictions.columns) if hasattr(predictions, "columns") else []
            ),
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
