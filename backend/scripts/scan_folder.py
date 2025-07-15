#!/usr/bin/env python3
"""
Scan folder for audio files
Returns a list of audio files found in the specified directory
"""

import argparse
import json
import os
import glob
import sys
import logging
from pathlib import Path

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)

# Supported audio extensions (matching streamlit_inference.py)
AUDIO_EXTENSIONS = ['wav', 'WAV', 'mp3', 'MP3', 'flac', 'FLAC', 'ogg', 'OGG', 'm4a', 'M4A']

def scan_folder(folder_path):
    """Scan folder recursively for audio files"""
    logger.info(f"Scanning folder: {folder_path}")
    audio_files = []
    
    for extension in AUDIO_EXTENSIONS:
        pattern = os.path.join(folder_path, '**', f'*.{extension}')
        files = glob.glob(pattern, recursive=True)
        audio_files.extend(files)
        
        if files:
            logger.info(f"Found {len(files)} .{extension} files")
    
    # Sort files alphabetically
    audio_files.sort()
    
    logger.info(f"Total audio files found: {len(audio_files)}")
    
    return audio_files

def main():
    parser = argparse.ArgumentParser(description='Scan folder for audio files')
    parser.add_argument('folder', help='Folder path to scan')
    
    args = parser.parse_args()
    
    try:
        if not os.path.exists(args.folder):
            raise FileNotFoundError(f"Folder not found: {args.folder}")
        
        if not os.path.isdir(args.folder):
            raise ValueError(f"Path is not a directory: {args.folder}")
        
        audio_files = scan_folder(args.folder)
        
        # Output as JSON for the GUI
        result = {
            'files': audio_files,
            'count': len(audio_files),
            'folder': args.folder
        }
        
        print(json.dumps(result))
        
    except Exception as e:
        logger.error(f"Error scanning folder: {e}")
        error_result = {
            'error': str(e),
            'files': [],
            'count': 0,
            'folder': args.folder if 'args' in locals() else ''
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    main()