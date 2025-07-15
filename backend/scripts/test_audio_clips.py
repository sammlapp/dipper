#!/usr/bin/env python3
"""
Test script for audio clip creation
"""

import json
import sys
import tempfile
import os

# Test the create_audio_clips script with dummy data
if __name__ == "__main__":
    # Create a dummy test
    settings = {
        "spec_window_size": 512,
        "spectrogram_colormap": "viridis",
        "dB_range": [-80, -20],
        "use_bandpass": False,
        "bandpass_range": [500, 8000],
        "show_reference_frequency": False,
        "reference_frequency": 1000,
        "resize_images": True,
        "image_width": 224,
        "image_height": 224,
        "normalize_audio": True
    }
    
    print("Test settings:", json.dumps(settings, indent=2))
    print("This script is just for testing the JSON format.")
    print("For actual testing, you need a real audio file.")