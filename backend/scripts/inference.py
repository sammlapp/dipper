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
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
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
        logger.error(f"Import error - make sure bioacoustics_model_zoo is installed: {e}")
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

def main():
    parser = argparse.ArgumentParser(description='Run bioacoustics model inference')
    parser.add_argument('--model', required=True, help='Model name from bioacoustics model zoo')
    parser.add_argument('--files', required=True, help='JSON array of audio file paths')
    parser.add_argument('--output', help='Output file path for predictions')
    parser.add_argument('--config', required=True, help='JSON configuration for inference')
    
    args = parser.parse_args()
    
    try:
        # Parse inputs
        files = json.loads(args.files)
        config = json.loads(args.config)
        
        logger.info(f"Starting inference with model: {args.model}")
        logger.info(f"Processing {len(files)} files")
        logger.info(f"Configuration: {config}")
        
        # Validate files exist
        missing_files = [f for f in files if not os.path.exists(f)]
        if missing_files:
            logger.error(f"Missing files: {missing_files[:5]}...")  # Show first 5
            raise FileNotFoundError(f"Missing {len(missing_files)} files")
        
        # Load model
        model = load_model(args.model)
        
        # Run inference
        predictions = run_inference(files, model, config)
        
        # Save results
        save_results(predictions, args.output)
        
        # Output summary for the GUI
        summary = {
            'status': 'success',
            'files_processed': len(files),
            'predictions_shape': list(predictions.shape),
            'output_file': args.output,
            'species_detected': list(predictions.columns) if hasattr(predictions, 'columns') else []
        }
        
        logger.info("Inference completed successfully")
        print(json.dumps(summary))
        
    except Exception as e:
        logger.error(f"Inference failed: {e}")
        error_summary = {
            'status': 'error',
            'error': str(e)
        }
        print(json.dumps(error_summary))
        sys.exit(1)

if __name__ == "__main__":
    main()