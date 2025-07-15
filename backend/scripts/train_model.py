#!/usr/bin/env python3
"""
Training script for bioacoustics models
Handles model training with active learning capabilities
"""

import argparse
import json
import sys
import os
import logging
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, Dataset
from pathlib import Path
import time
from sklearn.model_selection import train_test_split
from opensoundscape import Audio, Spectrogram
from opensoundscape.ml import cnn

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('training.log')
    ]
)
logger = logging.getLogger(__name__)

class BioacousticsDataset(Dataset):
    """Custom dataset for bioacoustics data"""
    
    def __init__(self, audio_files, labels, transform=None):
        self.audio_files = audio_files
        self.labels = labels
        self.transform = transform
    
    def __len__(self):
        return len(self.audio_files)
    
    def __getitem__(self, idx):
        audio_path = self.audio_files[idx]
        label = self.labels[idx]
        
        # Load and preprocess audio
        try:
            audio = Audio.from_file(audio_path)
            spectrogram = Spectrogram.from_audio(audio)
            
            if self.transform:
                spectrogram = self.transform(spectrogram)
            
            # Convert to tensor
            spec_tensor = torch.FloatTensor(spectrogram.spectrogram)
            label_tensor = torch.FloatTensor(label)
            
            return spec_tensor, label_tensor
            
        except Exception as e:
            logger.error(f"Error loading audio {audio_path}: {e}")
            # Return zeros if audio loading fails
            return torch.zeros(1, 224, 224), torch.zeros(len(label))

def create_model(num_classes, architecture='resnet18'):
    """Create a CNN model for bioacoustics classification"""
    model = cnn.CNN(
        architecture=architecture,
        num_classes=num_classes,
        sample_duration=5.0,
        single_target=False
    )
    return model

def train_epoch(model, dataloader, criterion, optimizer, device):
    """Train for one epoch"""
    model.train()
    total_loss = 0
    num_batches = 0
    
    for batch_idx, (data, target) in enumerate(dataloader):
        data, target = data.to(device), target.to(device)
        
        optimizer.zero_grad()
        output = model(data)
        loss = criterion(output, target)
        loss.backward()
        optimizer.step()
        
        total_loss += loss.item()
        num_batches += 1
        
        # Print progress
        if batch_idx % 10 == 0:
            progress = 100. * batch_idx / len(dataloader)
            logger.info(f'Training Progress: {progress:.1f}% ({batch_idx}/{len(dataloader)})')
    
    return total_loss / num_batches

def validate_epoch(model, dataloader, criterion, device):
    """Validate for one epoch"""
    model.eval()
    total_loss = 0
    num_batches = 0
    
    with torch.no_grad():
        for data, target in dataloader:
            data, target = data.to(device), target.to(device)
            output = model(data)
            loss = criterion(output, target)
            total_loss += loss.item()
            num_batches += 1
    
    return total_loss / num_batches

def main():
    parser = argparse.ArgumentParser(description='Train bioacoustics model')
    parser.add_argument('--training_data', required=True, help='JSON array of training data')
    parser.add_argument('--validation_data', help='JSON array of validation data')
    parser.add_argument('--config', required=True, help='JSON configuration for training')
    
    args = parser.parse_args()
    
    try:
        # Parse inputs
        training_data = json.loads(args.training_data)
        validation_data = json.loads(args.validation_data) if args.validation_data else []
        config = json.loads(args.config)
        
        logger.info(f"Starting training with {len(training_data)} training samples")
        logger.info(f"Validation samples: {len(validation_data)}")
        logger.info(f"Configuration: {config}")
        
        # Set device
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info(f"Using device: {device}")
        
        # Extract file paths and labels from training data
        train_files = []
        train_labels = []
        class_names = set()
        
        for item in training_data:
            train_files.extend(item.get('files', []))
            labels = item.get('labels', [])
            train_labels.extend(labels)
            class_names.update([label['class'] for label in labels])
        
        class_names = sorted(list(class_names))
        num_classes = len(class_names)
        class_to_idx = {name: idx for idx, name in enumerate(class_names)}
        
        logger.info(f"Found {num_classes} classes: {class_names}")
        
        # Convert labels to one-hot encoding
        train_labels_encoded = []
        for label_info in train_labels:
            one_hot = [0] * num_classes
            if label_info['class'] in class_to_idx:
                one_hot[class_to_idx[label_info['class']]] = 1
            train_labels_encoded.append(one_hot)
        
        # Create datasets
        train_dataset = BioacousticsDataset(train_files, train_labels_encoded)
        train_loader = DataLoader(
            train_dataset,
            batch_size=config.get('batch_size', 32),
            shuffle=True,
            num_workers=0  # Set to 0 for Windows compatibility
        )
        
        # Create validation dataset if provided
        val_loader = None
        if validation_data:
            val_files = []
            val_labels = []
            for item in validation_data:
                val_files.extend(item.get('files', []))
                labels = item.get('labels', [])
                val_labels.extend(labels)
            
            val_labels_encoded = []
            for label_info in val_labels:
                one_hot = [0] * num_classes
                if label_info['class'] in class_to_idx:
                    one_hot[class_to_idx[label_info['class']]] = 1
                val_labels_encoded.append(one_hot)
            
            val_dataset = BioacousticsDataset(val_files, val_labels_encoded)
            val_loader = DataLoader(
                val_dataset,
                batch_size=config.get('batch_size', 32),
                shuffle=False,
                num_workers=0
            )
        
        # Create model
        model = create_model(num_classes)
        model.to(device)
        
        # Setup training
        criterion = nn.BCEWithLogitsLoss()
        optimizer_name = config.get('optimizer', 'adam').lower()
        
        if optimizer_name == 'adam':
            optimizer = optim.Adam(model.parameters(), lr=config.get('learning_rate', 0.001))
        elif optimizer_name == 'sgd':
            optimizer = optim.SGD(model.parameters(), lr=config.get('learning_rate', 0.001))
        else:
            optimizer = optim.Adam(model.parameters(), lr=config.get('learning_rate', 0.001))
        
        # Training loop
        epochs = config.get('epochs', 10)
        best_val_loss = float('inf')
        
        for epoch in range(epochs):
            logger.info(f"Epoch {epoch + 1}/{epochs}")
            
            # Training
            train_loss = train_epoch(model, train_loader, criterion, optimizer, device)
            logger.info(f"Training Loss: {train_loss:.4f}")
            
            # Validation
            val_loss = 0
            if val_loader:
                val_loss = validate_epoch(model, val_loader, criterion, device)
                logger.info(f"Validation Loss: {val_loss:.4f}")
                
                # Save best model
                if val_loss < best_val_loss:
                    best_val_loss = val_loss
                    torch.save(model.state_dict(), 'best_model.pth')
                    logger.info("Saved best model")
            
            # Progress update for GUI
            progress = int(((epoch + 1) / epochs) * 100)
            logger.info(f"Progress: {progress}%")
        
        # Save final model
        torch.save(model.state_dict(), 'final_model.pth')
        
        # Save class mapping
        with open('class_mapping.json', 'w') as f:
            json.dump({'class_names': class_names, 'class_to_idx': class_to_idx}, f)
        
        # Output summary
        summary = {
            'status': 'success',
            'epochs_completed': epochs,
            'num_classes': num_classes,
            'class_names': class_names,
            'best_val_loss': best_val_loss if val_loader else None
        }
        
        logger.info("Training completed successfully")
        print(json.dumps(summary))
        
    except Exception as e:
        logger.error(f"Training failed: {e}")
        error_summary = {
            'status': 'error',
            'error': str(e)
        }
        print(json.dumps(error_summary))
        sys.exit(1)

if __name__ == "__main__":
    main()