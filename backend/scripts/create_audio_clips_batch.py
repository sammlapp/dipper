#!/usr/bin/env python3
"""
Batch processing script for creating audio clips and spectrograms
Optimized for high-performance processing of multiple clips
"""

import argparse
import json
import sys
import logging
import numpy as np
import librosa
import scipy.signal
import matplotlib
matplotlib.use("Agg")  # Use non-interactive backend
from pathlib import Path
import base64
from io import BytesIO
import soundfile as sf
from PIL import Image
import concurrent.futures
import time
from typing import List, Dict, Any

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)
logger = logging.getLogger(__name__)

def spec_to_image(spectrogram, range=None, colormap=None, channels=3, shape=None):
    """Convert spectrogram to image array (fast version)"""
    # Apply range if specified
    if range is not None:
        spectrogram = np.clip(spectrogram, range[0], range[1])
        spectrogram = (spectrogram - range[0]) / (range[1] - range[0])
    else:
        spec_min, spec_max = np.min(spectrogram), np.max(spectrogram)
        if spec_max > spec_min:
            spectrogram = (spectrogram - spec_min) / (spec_max - spec_min)

    # Flip vertically (higher frequencies at top)
    spectrogram = np.flipud(spectrogram)

    # Apply colormap efficiently
    if colormap == "greys_r":
        if channels == 1:
            img_array = 1.0 - spectrogram  # Invert
        else:
            inverted = 1.0 - spectrogram
            img_array = np.stack([inverted] * 3, axis=-1)
    else:
        if channels == 1:
            img_array = spectrogram
        else:
            img_array = np.stack([spectrogram] * 3, axis=-1)

    # Resize if shape is specified
    if shape is not None:
        from scipy.ndimage import zoom
        zoom_factors = (shape[0] / img_array.shape[0], shape[1] / img_array.shape[1])
        if len(img_array.shape) == 3:
            zoom_factors = zoom_factors + (1,)
        img_array = zoom(img_array, zoom_factors, order=1)

    # Convert to 0-255 uint8
    img_array = (img_array * 255).astype(np.uint8)
    return img_array

def process_single_clip(clip_data: Dict[str, Any], settings: Dict[str, Any]) -> Dict[str, Any]:
    """Process a single clip with optimized performance"""
    try:
        file_path = clip_data["file_path"]
        start_time = clip_data["start_time"]
        end_time = clip_data["end_time"]
        
        # Load audio
        duration = end_time - start_time
        samples, sr = librosa.load(
            file_path, sr=None, offset=start_time, duration=duration
        )

        # Normalize audio if requested
        if settings.get("normalize_audio", True):
            samples = samples / (np.max(np.abs(samples)) + 1e-8)

        # Create spectrogram
        frequencies, _, spectrogram = scipy.signal.spectrogram(
            x=samples,
            fs=sr,
            nperseg=int(settings.get("spec_window_size", 512)),
            noverlap=int(settings.get("spec_window_size", 512) * 0.5),
            nfft=int(settings.get("spec_window_size", 512)),
        )

        # Convert to decibels
        spectrogram = 10 * np.log10(
            spectrogram,
            where=spectrogram > 0,
            out=np.full(spectrogram.shape, -np.inf),
        )

        # Apply bandpass filter if requested
        if settings.get("use_bandpass", False):
            bandpass_range = settings.get("bandpass_range", [0, 10000])
            lowest_index = np.abs(frequencies - bandpass_range[0]).argmin()
            highest_index = np.abs(frequencies - bandpass_range[1]).argmin()
            spectrogram = spectrogram[lowest_index : highest_index + 1, :]
            frequencies = frequencies[lowest_index : highest_index + 1]

        # Convert spectrogram to image array
        colormap = settings.get("spectrogram_colormap", "greys_r")
        img_array = spec_to_image(
            spectrogram,
            range=settings.get("dB_range", [-80, -20]),
            colormap=colormap,
            channels=1 if colormap in ["greys", "greys_r"] else 3,
            shape=(
                (settings.get("image_height", 224), settings.get("image_width", 224))
                if settings.get("resize_images", True)
                else None
            ),
        )

        # Create audio buffer (in-memory WAV)
        audio_buffer = BytesIO()
        sf.write(audio_buffer, samples, sr, format="WAV")
        audio_buffer.seek(0)
        audio_base64 = base64.b64encode(audio_buffer.read()).decode("utf-8")

        # Create spectrogram image buffer (in-memory PNG)
        img_buffer = BytesIO()
        
        # Convert numpy array to PIL Image for faster processing
        if len(img_array.shape) == 2:
            pil_image = Image.fromarray(img_array, mode='L')
        else:
            pil_image = Image.fromarray(img_array, mode='RGB')
        
        # Save to buffer as PNG with optimization
        pil_image.save(img_buffer, format="PNG", optimize=True, compress_level=6)
        img_buffer.seek(0)
        img_base64 = base64.b64encode(img_buffer.read()).decode("utf-8")

        return {
            "clip_id": clip_data.get("clip_id", f"{file_path}_{start_time}_{end_time}"),
            "status": "success",
            "audio_base64": audio_base64,
            "spectrogram_base64": img_base64,
            "duration": duration,
            "sample_rate": int(sr),
            "frequency_range": [float(frequencies.min()), float(frequencies.max())],
            "time_range": [float(start_time), float(end_time)],
        }

    except Exception as e:
        logger.error(f"Error processing clip {clip_data}: {e}")
        return {
            "clip_id": clip_data.get("clip_id", f"{clip_data.get('file_path', 'unknown')}_{clip_data.get('start_time', 0)}_{clip_data.get('end_time', 0)}"),
            "status": "error",
            "error": str(e)
        }

def process_clips_batch(clips: List[Dict[str, Any]], settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Process multiple clips in parallel"""
    start_time = time.time()
    
    # Use thread pool for I/O bound operations
    max_workers = min(settings.get("max_workers", 4), len(clips))
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks and maintain their order
        future_to_index = {executor.submit(process_single_clip, clip, settings): i for i, clip in enumerate(clips)}
        
        # Initialize results array with correct size
        results = [None] * len(clips)
        
        # Collect results in order
        for future in concurrent.futures.as_completed(future_to_index):
            index = future_to_index[future]
            try:
                result = future.result()
                results[index] = result
                logger.info(f"Clip {index}: {result.get('status', 'unknown')} - {clips[index].get('file_path', 'unknown')}")
            except Exception as e:
                logger.error(f"Clip {index} failed: {e}")
                results[index] = {
                    "clip_id": clips[index].get("clip_id", f"clip_{index}"),
                    "status": "error",
                    "error": str(e)
                }
    
    end_time = time.time()
    successful_count = len([r for r in results if r and r.get('status') == 'success'])
    logger.info(f"Processed {len(clips)} clips in {end_time - start_time:.2f} seconds - {successful_count} successful")
    
    return results

def main():
    parser = argparse.ArgumentParser(description="Batch create audio clips and spectrograms")
    parser.add_argument("--clips", required=True, help="JSON array of clip data")
    parser.add_argument("--settings", required=True, help="JSON settings for spectrogram creation")

    args = parser.parse_args()

    try:
        # Parse inputs
        clips = json.loads(args.clips)
        settings = json.loads(args.settings)

        logger.info(f"Processing {len(clips)} clips")
        logger.info(f"Settings: {settings}")

        # Process clips
        results = process_clips_batch(clips, settings)

        # Output results as JSON
        output = {
            "status": "success",
            "total_clips": len(clips),
            "successful_clips": len([r for r in results if r["status"] == "success"]),
            "failed_clips": len([r for r in results if r["status"] == "error"]),
            "results": results
        }

        print(json.dumps(output))
        sys.stdout.flush()

    except Exception as e:
        logger.error(f"Failed to process clips: {e}")
        error_output = {"status": "error", "error": str(e)}
        print(json.dumps(error_output))
        sys.stdout.flush()
        sys.exit(1)

if __name__ == "__main__":
    main()