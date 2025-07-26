#!/usr/bin/env python3
"""
Training script for bioacoustics models
Handles model training with active learning capabilities
"""
import argparse
import logging
import pandas as pd
import json
import sys
import os
import sklearn
from pathlib import Path
import datetime

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


def load_config_file(config_path):
    """Load training configuration from JSON file"""
    try:
        with open(config_path, "r") as f:
            config = json.load(f)
        return config
    except Exception as e:
        logger.error(f"Failed to load config file {config_path}: {e}")
        raise


def load_model(model_name):
    """Load a model from the bioacoustics model zoo"""
    try:
        logger.info(f"Loading model: {model_name}")
        
        # Import here to avoid import errors if not installed
        import bioacoustics_model_zoo as bmz
        import pydantic.deprecated.decorator  # Fix for pydantic error
        
        # Load model using the same approach as inference
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


def process_fully_annotated_files(config):
    """Load and process fully annotated files"""
    fully_annotated_dfs = []
    
    for f in config.get("fully_annotated_files", []):
        logger.info(f"Loading fully annotated file: {f}")
        df = pd.read_csv(f, index_col=[0, 1, 2])
        
        # columns are either one per class with one-hot labels, or "labels" and "complete"
        if "labels" in df.columns:
            # parse labels column (list of strings) to list
            import ast
            
            df["labels"] = df["labels"].apply(ast.literal_eval)
            df = df[df.complete == "complete"]
            
            # use opensoundscape utility for labels to one-hot
            from opensoundscape.annotations import categorical_to_multi_hot
            
            multihot_labels = pd.DataFrame(
                categorical_to_multi_hot(
                    df["labels"].values, classes=config["class_list"], sparse=False
                ),
                index=df.index,
                columns=config["class_list"],
            )
        else:
            # df should have one-hot labels: just select the correct classes
            multihot_labels = df[config["class_list"]]
        
        fully_annotated_dfs.append(multihot_labels)
    
    if fully_annotated_dfs:
        return pd.concat(fully_annotated_dfs)[config["class_list"]]
    else:
        return pd.DataFrame(columns=config["class_list"])


def process_single_class_annotations(config, labels):
    """Load and process single class annotation files"""
    # add labels where only one species was annotated
    # treat other species as weak negatives
    single_class_dfs = []
    
    for annotation_item in config.get("single_class_annotations", []):
        file_path = annotation_item["file"]
        class_name = annotation_item["class"]
        
        logger.info(f"Loading single class annotation file: {file_path} for class: {class_name}")
        df = pd.read_csv(file_path, index_col=[0, 1, 2])
        
        # remove incomplete or uncertain annotations
        df = df[df.annotation.isin(["yes", "no"])]
        
        # create one-hot df
        new_labels = pd.DataFrame(index=df.index, columns=config["class_list"])
        new_labels[class_name] = df["annotation"].map({"yes": 1, "no": 0})
        
        # TODO: loss function should be able to handle NaNs by ignoring or treating as soft-negative
        new_labels = new_labels.fillna(0)
        single_class_dfs.append(new_labels)
    
    if single_class_dfs:
        single_labels = pd.concat(single_class_dfs)
        # Combine with fully annotated labels
        if not labels.empty:
            labels = pd.concat([labels, single_labels])
        else:
            labels = single_labels
    
    return labels


def load_background_samples(config):
    """Load background samples if provided"""
    background_file = config.get("background_samples_file", "")
    if background_file and os.path.exists(background_file):
        logger.info(f"Loading background samples from: {background_file}")
        # TODO: implement background sample processing
        # This would typically be negative examples or environmental noise
        pass


def load_evaluation_data(config):
    """Load evaluation data if provided"""
    evaluation_file = config.get("evaluation_file", "")
    if evaluation_file and os.path.exists(evaluation_file):
        logger.info(f"Loading evaluation data from: {evaluation_file}")
        return pd.read_csv(evaluation_file, index_col=[0, 1, 2])
    return None


def run_training(config):
    """Run the training process"""
    try:
        # Load and process annotation data
        logger.info("Processing fully annotated files...")
        labels = process_fully_annotated_files(config)
        
        logger.info("Processing single class annotations...")
        labels = process_single_class_annotations(config, labels)
        
        if labels.empty:
            raise ValueError("No training data found. Please provide annotation files.")
        
        logger.info(f"Total training samples: {len(labels)}")
        logger.info(f"Classes: {config['class_list']}")
        
        # Load background samples (optional)
        load_background_samples(config)
        
        # Split data for training/validation
        evaluation_df = load_evaluation_data(config)
        if evaluation_df is None:
            logger.info("No evaluation file provided, using train/validation split")
            train_df, evaluation_df = sklearn.model_selection.train_test_split(
                labels, test_size=0.2, random_state=42
            )
        else:
            train_df = labels
            logger.info(f"Using provided evaluation set with {len(evaluation_df)} samples")
        
        logger.info(f"Training samples: {len(train_df)}")
        logger.info(f"Validation samples: {len(evaluation_df)}")
        
        # Load pre-trained model
        model_name = config.get("model", "BirdNET")
        logger.info(f"Loading model: {model_name}")
        model = load_model(model_name)
        
        # Configure model for target classes
        model.change_classes(config["class_list"])
        
        # Optionally freeze feature extractor
        training_settings = config.get("training_settings", {})
        if training_settings.get("freeze_feature_extractor", True):
            logger.info("Freezing feature extractor")
            model.freeze_feature_extractor()
        
        # Create output directory
        model_save_path = config.get("model_save_path", "./trained_model.pth")
        out_dir = Path(model_save_path).parent
        out_dir.mkdir(parents=True, exist_ok=True)
        
        # Save configuration
        config_save_path = config.get("config_output_path", str(out_dir / "training_config.json"))
        Path(config_save_path).parent.mkdir(parents=True, exist_ok=True)
        with open(config_save_path, "w") as f:
            json.dump(config, f, indent=4)
        
        logger.info(f"Training configuration saved to: {config_save_path}")
        
        # Start training
        logger.info("Starting model training...")
        batch_size = training_settings.get("batch_size", 32)
        num_workers = training_settings.get("num_workers", 4)
        epochs = training_settings.get("epochs", 10)  # Default epochs
        
        # Set audio root if provided
        audio_root = config.get("root_audio_folder", None)
        
        model.train(
            train_df,
            evaluation_df,
            epochs=epochs,
            batch_size=batch_size,
            num_workers=num_workers,
            save_path=out_dir,
            save_interval=-1,  # Only save best epoch
            audio_root=audio_root
        )
        
        logger.info("Training completed successfully!")
        
        # Get validation metrics
        if hasattr(model, 'validation_metrics') and model.validation_metrics:
            final_metrics = model.validation_metrics[-1]
            logger.info(f"Final validation metrics: {final_metrics}")
        
        # Output summary for the GUI
        summary = {
            "status": "success",
            "model_save_path": model_save_path,
            "config_save_path": config_save_path,
            "training_samples": len(train_df),
            "validation_samples": len(evaluation_df),
            "classes_trained": config["class_list"],
            "epochs_completed": epochs,
            "final_metrics": final_metrics if hasattr(model, 'validation_metrics') and model.validation_metrics else {}
        }
        
        logger.info("Training completed successfully")
        print(json.dumps(summary))
        
    except Exception as e:
        logger.error(f"Training failed: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        error_summary = {"status": "error", "error": str(e)}
        print(json.dumps(error_summary))
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Run bioacoustics model training")
    parser.add_argument(
        "--config", required=True, help="Path to training configuration file"
    )
    args = parser.parse_args()
    
    # Load configuration from file
    config_data = load_config_file(args.config)
    
    # Run training
    run_training(config_data)


if __name__ == "__main__":
    main()
