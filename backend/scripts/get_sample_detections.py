#!/usr/bin/env python3
"""
Get sample detections for a specific species
"""

import argparse
import json
import pandas as pd
import numpy as np
import sys
import os
import tempfile
from pathlib import Path
from opensoundscape import Audio, Spectrogram
import matplotlib.pyplot as plt

def get_sample_detections(score_data, species, score_range, num_samples=12):
    """Get sample detections for a species within score range"""
    try:
        if species not in score_data['scores']:
            raise ValueError(f"Species {species} not found in scores")
        
        scores = score_data['scores'][species]
        file_info = score_data['file_info']
        
        # Find detections within score range
        filtered_detections = []
        for i, score in enumerate(scores):
            if score_range[0] <= score <= score_range[1]:
                detection = {
                    'score': score,
                    'file_path': file_info[i]['file'],
                    'start_time': file_info[i]['start_time'],
                    'end_time': file_info[i]['end_time'],
                    'index': i
                }
                filtered_detections.append(detection)
        
        # Sort by score (highest first)
        filtered_detections.sort(key=lambda x: x['score'], reverse=True)
        
        # Take top samples
        sample_detections = filtered_detections[:num_samples]
        
        # Generate spectrograms for each sample
        for detection in sample_detections:
            try:
                # Create spectrogram
                audio_path = detection['file_path']
                start_time = detection['start_time']
                end_time = detection['end_time']
                
                # Load audio segment
                if start_time == 0 and end_time == 0:
                    # Full file
                    audio = Audio.from_file(audio_path)
                else:
                    # Specific segment
                    duration = end_time - start_time
                    audio = Audio.from_file(audio_path, offset=start_time, duration=duration)
                
                # Create spectrogram
                spectrogram = Spectrogram.from_audio(audio)
                
                # Convert to image
                img = spectrogram.to_image(range=[-80, -20], invert=True)
                
                # Save to temporary file
                temp_dir = tempfile.gettempdir()
                temp_file = os.path.join(temp_dir, f"spec_{detection['index']}.png")
                img.save(temp_file)
                
                # Add info to detection
                detection['spectrogram_path'] = temp_file
                detection['file_name'] = os.path.basename(audio_path)
                
            except Exception as e:
                # If spectrogram generation fails, create placeholder
                detection['spectrogram_path'] = None
                detection['file_name'] = os.path.basename(detection['file_path'])
                detection['error'] = str(e)
        
        return sample_detections
        
    except Exception as e:
        raise Exception(f"Error getting sample detections: {e}")

def main():
    parser = argparse.ArgumentParser(description='Get sample detections')
    parser.add_argument('score_data', help='JSON score data')
    parser.add_argument('species', help='Species name')
    parser.add_argument('score_range', help='JSON score range [min, max]')
    parser.add_argument('num_samples', type=int, help='Number of samples to return')
    
    args = parser.parse_args()
    
    try:
        score_data = json.loads(args.score_data)
        score_range = json.loads(args.score_range)
        
        samples = get_sample_detections(score_data, args.species, score_range, args.num_samples)
        print(json.dumps(samples))
        
    except Exception as e:
        error_result = {
            'error': str(e),
            'samples': []
        }
        print(json.dumps(error_result))

if __name__ == "__main__":
    main()