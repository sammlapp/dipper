#!/usr/bin/env python3
"""
Scan training data folder structure
Expects folder structure like:
  training_data/
    species1/
      file1.wav
      file2.wav
    species2/
      file3.wav
      file4.wav
"""

import argparse
import json
import os
import glob
from pathlib import Path

# Supported audio extensions
AUDIO_EXTENSIONS = ['wav', 'WAV', 'mp3', 'MP3', 'flac', 'FLAC', 'ogg', 'OGG', 'm4a', 'M4A']

def scan_training_data(folder_path):
    """Scan training data folder structure"""
    training_data = []
    
    # Look for subfolders (classes)
    for item in os.listdir(folder_path):
        item_path = os.path.join(folder_path, item)
        
        if os.path.isdir(item_path):
            class_name = item
            audio_files = []
            
            # Scan for audio files in this class folder
            for extension in AUDIO_EXTENSIONS:
                pattern = os.path.join(item_path, f'*.{extension}')
                files = glob.glob(pattern)
                audio_files.extend(files)
            
            if audio_files:
                # Create labels for each file
                labels = []
                for file_path in audio_files:
                    labels.append({
                        'file': file_path,
                        'class': class_name,
                        'start_time': 0,
                        'end_time': 0  # Will be set based on audio duration
                    })
                
                training_data.append({
                    'class_name': class_name,
                    'sample_count': len(audio_files),
                    'files': audio_files,
                    'labels': labels
                })
    
    return training_data

def main():
    parser = argparse.ArgumentParser(description='Scan training data folder')
    parser.add_argument('folder', help='Training data folder path')
    
    args = parser.parse_args()
    
    try:
        if not os.path.exists(args.folder):
            raise FileNotFoundError(f"Folder not found: {args.folder}")
        
        if not os.path.isdir(args.folder):
            raise ValueError(f"Path is not a directory: {args.folder}")
        
        training_data = scan_training_data(args.folder)
        
        # Output as JSON for the GUI
        print(json.dumps(training_data))
        
    except Exception as e:
        error_result = {
            'error': str(e),
            'training_data': []
        }
        print(json.dumps(error_result))

if __name__ == "__main__":
    main()