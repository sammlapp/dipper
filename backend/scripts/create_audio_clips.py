#!/usr/bin/env python3
"""
Create audio clips and spectrograms for selected detections
Based on binary_classification_review.py example
"""

import argparse
import json
import sys
import os
import tempfile
import logging
import numpy as np
import librosa
import scipy.signal
import matplotlib

matplotlib.use("Agg")  # Use non-interactive backend
import matplotlib.pyplot as plt
from pathlib import Path
import base64
from io import BytesIO
import soundfile as sf
from PIL import Image

# Set up logging - redirect to stderr to avoid interfering with JSON output
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)
logger = logging.getLogger(__name__)


def spec_to_image(spectrogram, range=None, colormap=None, channels=3, shape=None):
    """
    Convert spectrogram to image array
    Based on the spec_to_image function from the reference code
    """
    # Apply range if specified
    if range is not None:
        spectrogram = np.clip(spectrogram, range[0], range[1])
        # Normalize to 0-1
        spectrogram = (spectrogram - range[0]) / (range[1] - range[0])
    else:
        # Normalize to 0-1 based on min/max
        spec_min, spec_max = np.min(spectrogram), np.max(spectrogram)
        if spec_max > spec_min:
            spectrogram = (spectrogram - spec_min) / (spec_max - spec_min)

    # Flip vertically (higher frequencies at top)
    spectrogram = np.flipud(spectrogram)

    # Apply colormap
    if colormap and colormap not in ["greys", "greys_r"]:
        try:
            logger.info(f"Applying colormap: {colormap}")
            cmap = plt.get_cmap(colormap)
            img_array = cmap(spectrogram)
            logger.info(f"Colormap applied successfully, shape: {img_array.shape}")
            if len(img_array.shape) == 3 and img_array.shape[2] == 4:
                img_array = img_array[:, :, :3]  # Remove alpha channel if present
                logger.info(f"Removed alpha channel, new shape: {img_array.shape}")
            # Ensure we have the right number of channels
            if channels == 1 and len(img_array.shape) == 3:
                # Convert RGB to grayscale
                img_array = np.mean(img_array[:, :, :3], axis=2)
                logger.info("Converted RGB to grayscale")
            elif channels == 3 and len(img_array.shape) == 2:
                # Convert grayscale to RGB by stacking
                img_array = np.stack([img_array] * 3, axis=-1)
                logger.info("Converted grayscale to RGB")
        except Exception as e:
            logger.error(f"Error applying colormap {colormap}: {e}, using default grayscale")
            # Fall back to inverse grayscale
            if channels == 1:
                img_array = 1.0 - spectrogram
            else:
                inverted = 1.0 - spectrogram
                img_array = np.stack([inverted] * 3, axis=-1)
    elif colormap == "greys_r":
        # Inverse grayscale (white=low, black=high)
        if channels == 1:
            img_array = 1.0 - spectrogram  # Invert
        else:
            inverted = 1.0 - spectrogram
            img_array = np.stack([inverted] * 3, axis=-1)
    else:
        # Regular grayscale
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


def create_audio_clip_and_spectrogram(file_path, start_time, end_time, settings):
    """
    Create audio clip and spectrogram for a detection using in-memory buffers
    """
    try:
        logger.info(f"Processing {file_path} from {start_time} to {end_time}")

        # Load audio
        duration = end_time - start_time
        samples, sr = librosa.load(
            file_path, sr=None, offset=start_time, duration=duration
        )

        logger.info(f"Loaded audio: {len(samples)} samples at {sr} Hz")

        # Normalize audio if requested
        if settings.get("normalize_audio", True):
            samples = samples / np.max(np.abs(samples) + 1e-8)

        # Create spectrogram
        frequencies, _, spectrogram = scipy.signal.spectrogram(
            x=samples,
            fs=sr,
            nperseg=int(settings.get("spec_window_size", 512)),
            noverlap=int(settings.get("spec_window_size", 512) * 0.5),  # 50% overlap
            nfft=int(settings.get("spec_window_size", 512)),
        )

        # Convert to decibels
        spectrogram = 10 * np.log10(
            spectrogram,
            where=spectrogram > 0,
            out=np.full(spectrogram.shape, -np.inf),
        )

        # Show reference frequency line if requested
        if settings.get("show_reference_frequency", False):
            ref_freq = settings.get("reference_frequency", 1000)
            closest_index = np.abs(frequencies - ref_freq).argmin()
            db_range = settings.get("dB_range", [-80, -20])
            spectrogram[closest_index, :] = db_range[1]

        # Apply bandpass filter if requested
        if settings.get("use_bandpass", False):
            bandpass_range = settings.get("bandpass_range", [0, 10000])
            lowest_index = np.abs(frequencies - bandpass_range[0]).argmin()
            highest_index = np.abs(frequencies - bandpass_range[1]).argmin()

            # Retain slices within desired range
            spectrogram = spectrogram[lowest_index : highest_index + 1, :]
            frequencies = frequencies[lowest_index : highest_index + 1]

        # Convert spectrogram to image array
        colormap = settings.get("spectrogram_colormap", "greys_r")
        img_array = spec_to_image(
            spectrogram,
            range=settings.get("dB_range", [-80, -20]),
            colormap=colormap,
            channels=3,  # Always use 3 channels for proper color support
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
        logger.info(f"Final img_array shape: {img_array.shape}, dtype: {img_array.dtype}")
        logger.info(f"Array min/max: {np.min(img_array)}/{np.max(img_array)}")
        
        if len(img_array.shape) == 2:
            # Grayscale
            logger.info("Creating grayscale PIL image")
            pil_image = Image.fromarray(img_array, mode='L')
        else:
            # RGB
            logger.info("Creating RGB PIL image")
            # Ensure the array is the right type and shape for RGB
            if img_array.shape[2] == 3:
                pil_image = Image.fromarray(img_array, mode='RGB')
            else:
                logger.warning(f"Unexpected image shape: {img_array.shape}")
                pil_image = Image.fromarray(img_array, mode='RGB')
        
        # Save to buffer as PNG
        pil_image.save(img_buffer, format="PNG", optimize=True)
        img_buffer.seek(0)
        img_base64 = base64.b64encode(img_buffer.read()).decode("utf-8")

        # Optional: still create temporary files for backward compatibility
        # but only if explicitly requested
        audio_path = None
        spectrogram_path = None
        
        if settings.get("create_temp_files", False):
            temp_dir = tempfile.gettempdir()
            audio_filename = f"clip_{hash(file_path + str(start_time))}_{int(start_time*1000)}_{int(end_time*1000)}.wav"
            audio_path = os.path.join(temp_dir, audio_filename)
            sf.write(audio_path, samples, sr)
            
            img_filename = f"spec_{hash(file_path + str(start_time))}_{int(start_time*1000)}_{int(end_time*1000)}.png"
            spectrogram_path = os.path.join(temp_dir, img_filename)
            pil_image.save(spectrogram_path)

        return {
            "audio_path": audio_path,
            "spectrogram_path": spectrogram_path,
            "audio_base64": audio_base64,
            "spectrogram_base64": img_base64,
            "duration": duration,
            "sample_rate": int(sr),
            "frequency_range": [float(frequencies.min()), float(frequencies.max())],
            "time_range": [float(start_time), float(end_time)],
        }

    except Exception as e:
        logger.error(f"Error processing clip: {e}")
        raise


def main():
    parser = argparse.ArgumentParser(description="Create audio clips and spectrograms")
    parser.add_argument("--file", required=True, help="Audio file path")
    parser.add_argument(
        "--start", type=float, required=True, help="Start time in seconds"
    )
    parser.add_argument("--end", type=float, required=True, help="End time in seconds")
    parser.add_argument(
        "--settings", required=True, help="JSON settings for spectrogram creation"
    )

    args = parser.parse_args()

    try:
        # Parse settings
        settings = json.loads(args.settings)

        logger.info(f"Creating clip from {args.file}: {args.start} - {args.end}")
        logger.info(f"Settings: {settings}")

        # Check if file exists
        if not os.path.exists(args.file):
            raise FileNotFoundError(f"Audio file not found: {args.file}")

        # Create clip and spectrogram
        result = create_audio_clip_and_spectrogram(
            args.file, args.start, args.end, settings
        )

        # Output result as JSON
        output = {"status": "success", **result}

        print(json.dumps(output))
        sys.stdout.flush()

    except Exception as e:
        logger.error(f"Failed to create clip: {e}")
        error_output = {"status": "error", "error": str(e)}
        print(json.dumps(error_output))
        sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
