"""Audio utilities for spectrogram generation and audio processing"""

import base64
import numpy as np
import librosa
import scipy.signal
import matplotlib

matplotlib.use("Agg")  # Non-interactive backend
import matplotlib.pyplot as plt
from io import BytesIO
from PIL import Image
import soundfile as sf


def create_spectrogram(
    file_path: str, start_time: float, end_time: float, settings: dict = None
) -> tuple:
    """
    Create spectrogram and audio clip for a detection

    Returns:
        tuple: (spectrogram_base64, audio_base64, sample_rate)
    """
    if settings is None:
        settings = {
            "spec_window_size": 512,
            "spectrogram_colormap": "Greys_r",
            "dB_range": [-80, -20],
            "use_bandpass": False,
            "bandpass_range": [500, 8000],
            "normalize_audio": True,
            "resize_images": True,
            "image_width": 400,
            "image_height": 200,
        }

    # Load audio
    duration = end_time - start_time
    samples, sr = librosa.load(file_path, sr=None, offset=start_time, duration=duration)

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

    # Convert spectrogram to image
    spec_image_base64 = spec_to_image(
        spectrogram,
        range=settings.get("dB_range", [-80, -20]),
        colormap=settings.get("spectrogram_colormap", "Greys_r"),
        shape=(settings.get("image_height", 200), settings.get("image_width", 400)),
    )

    # Convert audio to base64
    audio_base64 = audio_to_base64(samples, sr)

    return spec_image_base64, audio_base64, sr


def spec_to_image(
    spectrogram: np.ndarray,
    range: list = None,
    colormap: str = "Greys_r",
    channels: int = 3,
    shape: tuple = None,
) -> str:
    """
    Convert spectrogram array to base64 image string

    Args:
        spectrogram: 2D numpy array
        range: dB range [min, max]
        colormap: matplotlib colormap name
        channels: number of color channels (3 for RGB)
        shape: target image shape (height, width)

    Returns:
        str: base64 encoded image
    """
    if range is not None:
        vmin, vmax = range
    else:
        vmin, vmax = np.min(spectrogram), np.max(spectrogram)

    # Normalize to 0-1
    spec_norm = (spectrogram - vmin) / (vmax - vmin + 1e-8)
    spec_norm = np.clip(spec_norm, 0, 1)

    # Get colormap
    cmap = plt.get_cmap(colormap)

    # Apply colormap
    spec_colored = cmap(spec_norm)

    # Convert to RGB (remove alpha channel if present)
    if spec_colored.shape[-1] == 4:
        spec_colored = spec_colored[..., :3]

    # Convert to uint8
    spec_uint8 = (spec_colored * 255).astype(np.uint8)

    # Flip vertically (spectrograms are usually displayed with low frequencies at bottom)
    spec_uint8 = np.flipud(spec_uint8)

    # Create PIL image
    img = Image.fromarray(spec_uint8)

    # Resize if needed
    if shape is not None:
        img = img.resize((shape[1], shape[0]), Image.LANCZOS)

    # Convert to base64
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    img_base64 = base64.b64encode(buffer.getvalue()).decode()

    return img_base64


def audio_to_base64(samples: np.ndarray, sr: int) -> str:
    """
    Convert audio samples to base64 WAV string

    Args:
        samples: 1D numpy array of audio samples
        sr: sample rate

    Returns:
        str: base64 encoded WAV audio
    """
    buffer = BytesIO()
    sf.write(buffer, samples, sr, format="WAV")
    buffer.seek(0)
    audio_base64 = base64.b64encode(buffer.read()).decode()
    return audio_base64


def generate_placeholder_spectrogram(width: int = 400, height: int = 200) -> str:
    """Generate a placeholder spectrogram image"""
    # Create a simple gradient image
    img = np.zeros((height, width, 3), dtype=np.uint8)
    for i in range(height):
        img[i, :, :] = int(255 * (height - i) / height)

    pil_img = Image.fromarray(img)
    buffer = BytesIO()
    pil_img.save(buffer, format="PNG")
    buffer.seek(0)
    return base64.b64encode(buffer.getvalue()).decode()
