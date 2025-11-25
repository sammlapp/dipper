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
import torch
import numpy as np

import sklearn.model_selection
from pathlib import Path
import datetime
from opensoundscape.ml.shallow_classifier import fit_classifier_on_embeddings
from opensoundscape.ml.cnn import _gpu_if_available

# local imports
from load_model import load_model
from config_utils import load_config_file
from train_utils import (
    check_clip_df_format,
    process_fully_annotated_files,
    process_single_class_annotations,
    load_background_samples,
    load_evaluation_data,
)

from opensoundscape.ml.shallow_classifier import MLPClassifier
from opensoundscape.ml.cnn_architectures import set_layer_from_name

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# configuration: might eventually expose these parameters
max_background_samples = 10_000
overlay_weight = (0.2, 0.5)
early_stopping_patience = None  # no early stopping


def train_on_audio(model, train_labels, eval_labels, config):
    train_cfg = config["training_settings"]
    # Configure model for target classes
    # if model.classes != config["class_list"]: (always initialize new classifier for now)
    logger.info(
        "Initializing new classifier head with random weights"  # , because classes differ from the loaded classifier head"
    )

    # changes .classes and updates metrics as needed; initializes 1-layer classifier
    model.change_classes(config["class_list"])

    # initialize multi-layer classifier if needed:
    hidden_layer_sizes = train_cfg.get("classifier_hidden_layer_sizes")

    if hidden_layer_sizes and len(hidden_layer_sizes) > 0:
        assert all(
            [isinstance(x, int) for x in hidden_layer_sizes]
        ), "hidden_layer_sizes must be a list of integers"
        new_classifier = MLPClassifier(
            input_size=model.classifier.in_features,
            output_size=len(config["class_list"]),
            hidden_layer_sizes=hidden_layer_sizes,
        )
        clf_layer_name = model.network.classifier_layer
        set_layer_from_name(model.network, clf_layer_name, new_classifier)

    # Set audio root if provided
    audio_root = config.get("root_audio_folder", None)

    # training strategy depends on whether the feature extractor is frozen
    # if it is frozen, we can quickly train the classifier head on embeddings
    # if it is not frozen, we need to train the entire model
    if config.get("freeze_feature_extractor", True):
        logger.info("Freezing feature extractor")
        model.freeze_feature_extractor()

        logger.info(
            "Feature extractor is frozen. Training will only update the classifier head (fast)."
        )
        # Default epochs (steps) for shallow classifier fitting
        # we typically train lots of steps since its very fast from here forward
        # and we can use early stopping to avoid overfitting
        epochs = train_cfg.get("epochs", 1000)

        # create embeddings once and use them for quickly training the classifier head
        # after fitting, this function loads the weights of the best step
        _, _, _, _, metrics = fit_classifier_on_embeddings(
            embedding_model=model,
            classifier_model=model.network.classifier,
            train_df=train_labels,
            validation_df=eval_labels,
            n_augmentation_variants=train_cfg.get("n_augmentation_variants"),
            audio_root=audio_root,
            embedding_batch_size=train_cfg["batch_size"],
            embedding_num_workers=train_cfg["num_workers"],
            steps=epochs,
            optimizer=None,
            criterion=None,
            device=model.device,
            early_stopping_patience=early_stopping_patience,
            logging_interval=100,
            validation_interval=1,
        )

        # add class names to per-class metrics
        metrics["per_class_auroc"] = {
            class_name: metrics["per_class_auroc"][i]
            for i, class_name in enumerate(config["class_list"])
        }

        # save the model
        save_path = train_cfg["model_save_path"]
        model.save(save_path, pickle=True)
        logger.info(f"Saved trained model to: {save_path}")
    else:
        logger.info(
            "Feature extractor is not frozen. Training will update the entire model (slow)."
        )
        # Default epochs for full training
        epochs = train_cfg.get("epochs", 20)
        try:
            assert "class" in model.optimizer_params
            # use AdamW optimizer with custom parameters
            model.optimizer_params = {
                "class": torch.optim.AdamW,
                "kwargs": {"lr": train_cfg.get("feature_extractor_lr", 0.001)},
                "classifier_lr": train_cfg.get("classifier_lr", 0.01),
            }
        except:
            logger.warning(
                "Model does not support custom optimizer parameters. Using default learning rate and optimizer."
            )
        try:
            assert "class" in model.lr_scheduler_params
            model.lr_scheduler_params = {
                "class": torch.optim.lr_scheduler.CosineAnnealingLR,
                "kwargs": {
                    "T_max": epochs,
                    "eta_min": train_cfg.get("min_lr", 1e-6),
                },
            }
        except:
            logger.warning(
                "Model does not support custom learning rate scheduler parameters. Using default scheduler."
            )
        # Start training loop
        logger.info("Starting model training...")
        model_save_path = config.get("model_save_path")
        out_dir = Path(model_save_path).parent
        model.train(
            train_labels,
            eval_labels,
            epochs=epochs,
            batch_size=train_cfg["batch_size"],
            num_workers=train_cfg["num_workers"],
            save_path=out_dir,
            save_interval=-1,  # Only save best epoch (saves best.pkl)
            audio_root=audio_root,
        )
        metrics = model.valid_metrics[model.best_epoch]


def train_hoplite(train_labels, eval_labels, config):
    # local hoplite imports as needed
    from hoplite_utils import load_or_create_db

    train_cfg = config["training_settings"]

    # TODO: could avoid model load if all samples are already embedded
    model = load_model(config)

    # create db for training or connect to existing one
    train_db = load_or_create_db(
        config, embedding_dim=model.classifier.in_features, logger=logger
    )

    augmentation_variants = train_cfg.get("augmentation_variants")

    # first, embed any samples not yet embedded
    # or create multiple embeddings from augmented variants if specified
    model.embed_to_hoplite_db(
        eval_labels,
        db=train_db,
        dataset_name=config["eval_dataset_name"],
        audio_root=config["root_audio_folder"],
        batch_size=train_cfg["batch_size"],
        num_workers=train_cfg["num_workers"],
    )

    if augmentation_variants is None:
        logger.info("Embedding samples without augmentations...")
        model.embed_to_hoplite_db(
            train_labels,
            db=train_db,
            dataset_name=config["training_dataset_name"],
            audio_root=config["root_audio_folder"],
            batch_size=train_cfg["batch_size"],
            num_workers=train_cfg["num_workers"],
        )
    else:
        logger.info(
            f"Embedding samples {augmentation_variants} times with augmentation..."
        )
        for i in range(augmentation_variants):
            logger.info(f"Embedding augmentation variant {i+1}/{augmentation_variants}")
            model.embed_to_hoplite_db(
                train_labels,
                db=train_db,
                dataset_name=config["training_datset_name"],
                audio_root=config["root_audio_folder"],
                batch_size=train_cfg["batch_size"],
                num_workers=train_cfg["num_workers"],
                embedding_exists_mode="add",
                bypass_augmentations=False,
            )

    # second, retrieve train and eval features from db
    index_values = []
    train_embeddings = []
    for f, s, e in train_labels.index:
        ids = train_db.get_embeddings_by_source(
            dataset_name=config["training_datset_name"],
            source_id=f,
            offsets=np.array([s], dtype=np.float16),
        )
        for id in ids:
            emb = train_db.get_embedding(id)
            train_embeddings.append(emb)
            index_values.append((f, s, e))
    train_embeddings = np.vstack(train_embeddings)
    # might have had >1 emb per label, so reconstruct labels array
    # based on index values for each embedding row
    train_labels = train_labels.loc[index_values].values

    eval_embeddings = []
    for f, s, e in eval_labels.index:
        ids = train_db.get_embeddings_by_source(
            dataset_name=config["eval_datset_name"],
            source_id=f,
            offsets=np.array([s], dtype=np.float16),
        )
        assert len(ids) == 1
        emb = train_db.get_embedding(id)
        train_embeddings.append(emb)
    eval_embeddings = np.vstack(eval_embeddings)

    # third, train classifier
    import opensoundscape as opso
    import torch

    # initialize an MLP with random weights and desired shape
    classes = list(train_labels.columns)
    hidden_layers = config.get("training_settings", {}).get(
        "classifier_hidden_layer_sizes"
    )
    mlp = opso.ml.shallow_classifier.MLPClassifier(
        input_size=train_db.embedding_dim,
        output_size=len(classes),
        hidden_layer_sizes=hidden_layers,
        classes=classes,
    )

    val_metrics = mlp.fit(
        train_embeddings,
        train_labels.values,
        validation_features=eval_embeddings,
        validation_labels=eval_labels.values,
        steps=1000,
        batch_size=128,
        logging_interval=200,
        optimizer=torch.optim.Adam(mlp.parameters(), lr=0.001),
        # criterion=opso.ml.loss.BCELossWeakNegatives(), #TODO: weak negatives loss!
    )

    mlp.save(config["model_save_path"])

    logger.info(f"Trained classifier saved to {config['model_save_path']}")
    logger.info(f"Validation set metrics: \n" + val_metrics)

    return val_metrics


def run_training(config):
    """Run the training process"""
    try:
        # Create output directory
        model_save_path = config.get("model_save_path")
        out_dir = Path(model_save_path).parent
        out_dir.mkdir(parents=True, exist_ok=True)
        # Save configuration
        config_save_path = config.get(
            "config_output_path", str(out_dir / "training_config.json")
        )
        Path(config_save_path).parent.mkdir(parents=True, exist_ok=True)
        with open(config_save_path, "w") as f:
            json.dump(config, f, indent=4)

        # Log training start information
        logger.info("=" * 80)
        logger.info("BIOACOUSTICS MODEL TRAINING STARTED")
        logger.info("=" * 80)
        logger.info(f"Timestamp: {datetime.datetime.now().isoformat()}")
        logger.info(f"Model: {config.get('model', 'Unknown')}")
        logger.info(f"Target classes: {config.get('class_list', [])}")
        logger.info(f"Save location: {config.get('model_save_path')}")

        # Log configuration summary
        train_cfg = config.get("training_settings", {})
        logger.info(f"Training settings: \n{train_cfg}")

        # Load and process annotation data
        logger.info("Processing labels from fully annotated files...")
        labels = process_fully_annotated_files(config, logger=logger)

        logger.info("Processing labels from single class annotations...")
        labels = process_single_class_annotations(config, labels, logger=logger)

        if labels.empty:
            raise ValueError("No training data found. Please provide annotation files.")

        logger.info(f"Total training samples: {len(labels)}")
        logger.info(f"Classes: {config['class_list']}")

        # Split data for training/validation
        evaluation_df = load_evaluation_data(config, logger=logger)
        if evaluation_df is None:
            logger.info(
                "No evaluation file provided, using 80:20 train/validation split"
            )
            train_df, evaluation_df = sklearn.model_selection.train_test_split(
                labels, test_size=0.2
            )
        else:
            train_df = labels
            logger.info(
                f"Using provided evaluation set with {len(evaluation_df)} samples"
            )

        # Run on a small subset of data if specified
        if "subset_size" in config and isinstance(config["subset_size"], int):
            subset_size = min(config["subset_size"], len(train_df))
            logger.info(
                f"Using a SUBSET of {subset_size} samples for training and evaluation"
            )
            train_df = train_df.sample(n=subset_size, random_state=0)
            evaluation_df = evaluation_df.sample(n=subset_size, random_state=0)

        logger.info(f"Training samples: {len(train_df)}")
        logger.info(f"Validation samples: {len(evaluation_df)}")

        # Load pre-trained model
        model_name = config.get("model")
        logger.info(f"Loading backbone model: {model_name}")
        model = load_model(config, logger)

        logger.info(f" Using device: {model.device}")

        # Customize preprocessing

        # Load background samples for overlay (optional)
        background_samples = load_background_samples(
            config, max_background_samples=max_background_samples, logger=logger
        )
        if background_samples is not None:
            from opensoundscape.preprocess.overlay import Overlay

            logger.info(
                f"Using {len(background_samples)} background samples for overlay in preprocessor"
            )
            # TODO: consider allowing user to select which training sets get overlays (criterion_fn=...)
            overlay_action = Overlay(
                overlay_df=background_samples,
                update_labels=False,
                overlay_prob=0.75,
                max_overlay_num=1,
                overlay_weight=overlay_weight,
                # criterion_fn=)
            )
            model.preprocessor.insert_action(
                action_index="background_sample_overlay",
                action=overlay_action,
                after_key="to_spec",
            )  # TODO this will fail for models that take audio as input! need to implement audio-space mixup

        if config["mode"] == "train_on_embeddings":
            metrics = train_hoplite(model, train_df, evaluation_df, config)
        elif config["mode"] == "train_on_audio":
            metrics = train_on_audio(model, train_df, evaluation_df, config)
        else:
            raise ValueError(f"Unsupported mode: {config['mode']}")

        logger.info("Training completed successfully!")

        # Log and save validation metrics
        logger.info(f"Final validation metrics: {metrics}")
        with open(Path(out_dir) / "validation_metrics.json", "w") as f:
            json.dump(metrics, f, indent=4)

        # Output summary for the GUI
        summary = {
            "status": "success",
            "model_save_path": model_save_path,
            "config_save_path": config_save_path,
            "training_samples": len(train_df),
            "validation_samples": len(evaluation_df),
            "classes_trained": config["class_list"],
            # "epochs_completed": epochs,
            "final_metrics": metrics,
        }

        logger.info("=" * 80)
        logger.info("TRAINING COMPLETED SUCCESSFULLY!")
        logger.info("=" * 80)
        logger.info(f"Model saved to: {model_save_path}")
        logger.info(f"Training samples processed: {len(train_df)}")
        logger.info(f"Validation samples: {len(evaluation_df)}")
        logger.info(f"Final timestamp: {datetime.datetime.now().isoformat()}")
        logger.info(f"Final validation metrics: {metrics}")
        logger.info("=" * 80)
        print(json.dumps(summary))

    except Exception as e:
        logger.error("=" * 80)
        logger.error("TRAINING FAILED!")
        logger.error("=" * 80)
        logger.error(f"Error: {e}")
        logger.error(f"Timestamp: {datetime.datetime.now().isoformat()}")
        import traceback

        logger.error(f"Full traceback:")
        logger.error(traceback.format_exc())
        logger.error("=" * 80)
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
    config_data = load_config_file(args.config, logger=logger)

    # Run training
    run_training(config_data)


if __name__ == "__main__":
    main()
