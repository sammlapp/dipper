#!/usr/bin/env python3
"""
Lightweight HTTP server for bioacoustics app backend.
This version excludes ML dependencies and uses lightweight libraries.
"""

import sys
import json
import argparse
import asyncio
import os
import tempfile
import logging
import base64
import subprocess
import threading
import tarfile
from pathlib import Path
from aiohttp import web, web_request
from aiohttp_cors import setup as cors_setup, ResourceOptions
import pandas as pd
import numpy as np
import librosa
import scipy.signal
from PIL import Image
import soundfile as sf
from io import BytesIO

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Config Management Functions
def save_inference_config(config_data, output_path):
    """Save inference configuration to JSON file"""
    try:
        with open(output_path, 'w') as f:
            json.dump(config_data, f, indent=2)
        return {"status": "success", "config_path": output_path}
    except Exception as e:
        return {"status": "error", "error": str(e)}

def load_inference_config(config_path):
    """Load inference configuration from JSON file"""
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
        return {"status": "success", "config": config}
    except Exception as e:
        return {"status": "error", "error": str(e)}

def validate_audio_files(file_list):
    """Validate that audio files exist"""
    valid_extensions = {'.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac'}
    results = {
        "valid_files": [],
        "missing_files": [],
        "invalid_extensions": []
    }
    
    for file_path in file_list:
        if not os.path.exists(file_path):
            results["missing_files"].append(file_path)
        elif Path(file_path).suffix.lower() not in valid_extensions:
            results["invalid_extensions"].append(file_path)
        else:
            results["valid_files"].append(file_path)
    
    return results


# Environment Management Functions  
def check_environment(env_path):
    """Check if conda-pack environment exists and is valid"""
    try:
        python_path = os.path.join(env_path, "bin", "python")
        if os.name == 'nt':  # Windows
            python_path = os.path.join(env_path, "python.exe")
        
        if not os.path.exists(python_path):
            return {"status": "missing", "python_path": python_path}
        
        # Try to run a simple Python command
        result = subprocess.run([python_path, "--version"], capture_output=True, text=True)
        if result.returncode == 0:
            return {
                "status": "ready", 
                "python_path": python_path, 
                "version": result.stdout.strip()
            }
        else:
            return {"status": "broken", "error": f"Python check failed: {result.stderr}"}
            
    except Exception as e:
        return {"status": "error", "error": str(e)}

def extract_environment(archive_path, extract_dir):
    """Extract conda-pack environment from tar.gz archive"""
    try:
        logger.info(f"Extracting environment from {archive_path} to {extract_dir}")
        
        # Create extraction directory
        os.makedirs(extract_dir, exist_ok=True)
        
        # Extract the tar.gz file
        with tarfile.open(archive_path, 'r:gz') as tar:
            tar.extractall(path=extract_dir)
        
        # Check if extraction was successful
        env_check = check_environment(extract_dir)
        if env_check["status"] in ["ready", "missing"]:
            return {"status": "success", "env_path": extract_dir}
        else:
            return {"status": "error", "error": f"Environment extraction failed: {env_check.get('error', 'Unknown error')}"}
            
    except Exception as e:
        return {"status": "error", "error": str(e)}

def setup_environment(env_dir, archive_path=None):
    """Set up environment - extract if needed, check if ready"""
    try:
        # First check if environment already exists
        env_check = check_environment(env_dir)
        
        if env_check["status"] == "ready":
            return {"status": "ready", "python_path": env_check["python_path"], "message": "Environment already ready"}
        
        # If environment doesn't exist and we have an archive, extract it
        if env_check["status"] == "missing" and archive_path and os.path.exists(archive_path):
            logger.info(f"Environment not found, extracting from {archive_path}")
            extract_result = extract_environment(archive_path, env_dir)
            
            if extract_result["status"] == "success":
                # Check again after extraction
                final_check = check_environment(env_dir)
                if final_check["status"] == "ready":
                    return {
                        "status": "ready", 
                        "python_path": final_check["python_path"],
                        "message": "Environment extracted and ready"
                    }
                else:
                    return {"status": "error", "error": f"Environment setup failed: {final_check.get('error', 'Unknown error')}"}
            else:
                return extract_result
        
        # Environment missing and no archive provided
        return {
            "status": "missing", 
            "error": f"Environment not found at {env_dir}" + (f" and no archive provided" if not archive_path else f" and archive not found at {archive_path}")
        }
        
    except Exception as e:
        return {"status": "error", "error": str(e)}


# Process Management Functions
def run_inference_with_env(config_path, env_python_path):
    """Run inference using specified Python environment"""
    try:
        # Verify environment exists
        if not os.path.exists(env_python_path):
            return {"status": "error", "error": f"Python environment not found: {env_python_path}"}
        
        # Verify config file exists
        if not os.path.exists(config_path):
            return {"status": "error", "error": f"Config file not found: {config_path}"}
        
        # Run inference.py with the specified Python environment
        inference_script = os.path.join(os.path.dirname(__file__), "scripts", "inference.py")
        cmd = [env_python_path, inference_script, "--config", config_path]
        
        logger.info(f"Running command: {' '.join(cmd)}")
        
        # Start the process
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=os.path.dirname(os.path.abspath(__file__))
        )
        
        # Wait for process to complete
        stdout, stderr = process.communicate()
        return_code = process.returncode
        
        if return_code == 0:
            return {"status": "success", "message": "Inference completed successfully", "output": stdout}
        else:
            return {"status": "error", "error": f"Inference failed with exit code {return_code}", "stderr": stderr}
            
    except Exception as e:
        return {"status": "error", "error": str(e)}


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
        if channels == 1:  # greyscale
            img_array = spectrogram
        else:
            # apply matplotlib colormap
            import matplotlib.pyplot as plt

            cmap = plt.get_cmap(colormap)
            img_array = cmap(spectrogram)[:, :, :3]  # Drop alpha channel

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


def process_single_clip(clip_data, settings):
    """Process a single clip with optimized performance (adapted from create_audio_clips_batch.py)"""
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

        # Apply bandpass filter if requested (frequency cropping)
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
            pil_image = Image.fromarray(img_array, mode="L")
        else:
            pil_image = Image.fromarray(img_array.astype(np.uint8))

        # Save to buffer as PNG with optimization
        pil_image.save(img_buffer, format="PNG", optimize=True, compress_level=6)
        img_buffer.seek(0)
        spectrogram_base64 = base64.b64encode(img_buffer.read()).decode("utf-8")

        return {
            "clip_id": clip_data.get("clip_id", f"{file_path}_{start_time}_{end_time}"),
            "file_path": file_path,
            "start_time": start_time,
            "end_time": end_time,
            "status": "success",
            "audio_base64": audio_base64,
            "spectrogram_base64": spectrogram_base64,
            "duration": duration,
            "sample_rate": int(sr),
            "frequency_range": [float(frequencies.min()), float(frequencies.max())],
            "time_range": [float(start_time), float(end_time)],
        }

    except Exception as e:
        logger.error(f"Error processing clip {clip_data}: {e}")
        return {
            "clip_id": clip_data.get(
                "clip_id",
                f"{clip_data.get('file_path', 'unknown')}_{clip_data.get('start_time', 0)}_{clip_data.get('end_time', 0)}",
            ),
            "file_path": clip_data.get("file_path"),
            "start_time": clip_data.get("start_time"),
            "end_time": clip_data.get("end_time"),
            "status": "error",
            "error": str(e),
        }


class LightweightServer:
    def __init__(self, port=8000):
        self.port = port
        self.app = web.Application()
        self.setup_routes()
        self.setup_cors()

    def setup_cors(self):
        """Setup CORS for frontend communication"""
        cors = cors_setup(
            self.app,
            defaults={
                "*": ResourceOptions(
                    allow_credentials=True,
                    expose_headers="*",
                    allow_headers="*",
                    allow_methods="*",
                )
            },
        )

        # Add CORS to all routes
        for route in list(self.app.router.routes()):
            cors.add(route)

    def setup_routes(self):
        """Setup HTTP routes"""
        self.app.router.add_get("/", self.root_handler)
        self.app.router.add_head("/", self.root_handler)
        self.app.router.add_get("/health", self.health_check)
        self.app.router.add_post("/scan_folder", self.scan_folder)
        self.app.router.add_post("/get_sample_detections", self.get_sample_detections)
        self.app.router.add_post("/load_scores", self.load_scores)
        self.app.router.add_get("/clip", self.clip_single)
        self.app.router.add_post("/clips/batch", self.clips_batch)
        self.app.router.add_delete("/cache", self.clear_cache)
        
        # New config and process management routes
        self.app.router.add_post("/config/save", self.save_config)
        self.app.router.add_post("/config/load", self.load_config)
        self.app.router.add_post("/config/validate", self.validate_config)
        self.app.router.add_post("/env/check", self.check_env)
        self.app.router.add_post("/env/setup", self.setup_env)
        self.app.router.add_post("/inference/run", self.run_inference)

    async def root_handler(self, request):
        """Root endpoint to handle HEAD requests from wait-on"""
        return web.json_response({"status": "ok", "server": "lightweight_server"})

    async def health_check(self, request):
        """Health check endpoint"""
        return web.json_response(
            {
                "status": "ok",
                "message": "Lightweight server running",
                "server_type": "lightweight",
                "capabilities": [
                    "scan_folder", 
                    "get_sample_detections", 
                    "load_scores", 
                    "config_management",
                    "env_management", 
                    "inference_runner"
                ],
            }
        )

    async def scan_folder(self, request):
        """Scan folder for audio files"""
        try:
            data = await request.json()
            folder_path = data.get("folder_path")

            if not folder_path or not os.path.exists(folder_path):
                raise ValueError("Invalid folder path")

            # Import scan_folder script
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "scripts"))
            import scan_folder as sf

            # Call scan function
            result = sf.scan_folder_for_audio_files(folder_path)

            return web.json_response(result)

        except Exception as e:
            logger.error(f"Error scanning folder: {e}")
            return web.json_response({"error": str(e), "files": []}, status=500)

    async def get_sample_detections(self, request):
        """Get sample detections using lightweight approach"""
        try:
            data = await request.json()
            score_data = data.get("score_data")
            species = data.get("species")
            score_range = data.get("score_range")
            num_samples = data.get("num_samples", 12)

            # Import get_sample_detections script
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "scripts"))
            import get_sample_detections as gsd

            # Call function
            samples = gsd.get_sample_detections(
                score_data, species, score_range, num_samples
            )

            return web.json_response(samples)

        except Exception as e:
            logger.error(f"Error getting sample detections: {e}")
            return web.json_response({"error": str(e), "samples": []}, status=500)

    async def load_scores(self, request):
        """Load scores from file"""
        try:
            data = await request.json()
            file_path = data.get("file_path")

            if not file_path or not os.path.exists(file_path):
                raise ValueError("Invalid file path")

            # Import load_scores script
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "scripts"))
            import load_scores as ls

            # Call function
            result = ls.load_scores_from_file(file_path)

            return web.json_response(result)

        except Exception as e:
            logger.error(f"Error loading scores: {e}")
            return web.json_response({"error": str(e), "scores": {}}, status=500)

    async def clip_single(self, request):
        """Process single audio clip from query parameters"""
        try:
            # Get query parameters
            params = request.query
            
            # Extract required parameters
            file_path = params.get('file_path')
            start_time = float(params.get('start_time', 0))
            end_time = float(params.get('end_time', start_time + 3))
            
            if not file_path:
                return web.json_response({"error": "file_path parameter is required"}, status=400)
            
            # Convert query parameters to settings format
            settings = {
                'spec_window_size': int(params.get('spec_window_size', 512)),
                'spectrogram_colormap': params.get('spectrogram_colormap', 'greys_r'),
                'dB_range': json.loads(params.get('dB_range', '[-80, -20]')),
                'use_bandpass': params.get('use_bandpass', 'false').lower() == 'true',
                'bandpass_range': json.loads(params.get('bandpass_range', '[500, 8000]')),
                'resize_images': params.get('resize_images', 'true').lower() == 'true',
                'image_width': int(params.get('image_width', 224)),
                'image_height': int(params.get('image_height', 224)),
                'normalize_audio': params.get('normalize_audio', 'true').lower() == 'true'
            }
            
            # Create clip data
            clip_data = {
                'file_path': file_path,
                'start_time': start_time,
                'end_time': end_time
            }
            
            # Process the clip
            result = process_single_clip(clip_data, settings)
            
            if result.get('status') == 'error':
                return web.json_response(result, status=500)
            
            return web.json_response(result)
            
        except Exception as e:
            logger.error(f"Error processing single clip: {e}")
            return web.json_response({"error": str(e)}, status=500)

    async def clips_batch(self, request):
        """Process batch of audio clips to generate spectrograms and audio"""
        try:
            data = await request.json()
            clips = data.get("clips", [])
            settings = data.get("settings", {})

            if not clips:
                return web.json_response({"error": "No clips provided"}, status=400)

            # Process clips using the optimized function from create_audio_clips_batch.py
            results = []
            for clip in clips:
                # Use the process_single_clip function that handles all settings properly
                result = process_single_clip(clip, settings)
                results.append(result)

            # Count successful clips
            successful_count = sum(1 for r in results if r.get("status") == "success")

            return web.json_response(
                {
                    "status": "success",
                    "results": results,
                    "successful_clips": successful_count,
                    "processing_time": 0.0,
                }
            )

        except Exception as e:
            logger.error(f"Error in clips batch processing: {e}")
            return web.json_response({"error": str(e)}, status=500)

    async def clear_cache(self, request):
        """Clear server cache (lightweight server doesn't really cache, so just return success)"""
        try:
            return web.json_response({"status": "success", "message": "Cache cleared"})
        except Exception as e:
            logger.error(f"Error clearing cache: {e}")
            return web.json_response({"error": str(e)}, status=500)

    # Config Management Routes
    async def save_config(self, request):
        """Save inference configuration to file"""
        try:
            data = await request.json()
            config_data = data.get("config_data")
            output_path = data.get("output_path")
            
            if not config_data or not output_path:
                return web.json_response({"error": "config_data and output_path required"}, status=400)
            
            result = save_inference_config(config_data, output_path)
            return web.json_response(result)
            
        except Exception as e:
            logger.error(f"Error saving config: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def load_config(self, request):
        """Load inference configuration from file"""
        try:
            data = await request.json()
            config_path = data.get("config_path")
            
            if not config_path:
                return web.json_response({"error": "config_path required"}, status=400)
            
            result = load_inference_config(config_path)
            return web.json_response(result)
            
        except Exception as e:
            logger.error(f"Error loading config: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def validate_config(self, request):
        """Validate audio files in configuration"""
        try:
            data = await request.json()
            files = data.get("files", [])
            
            result = validate_audio_files(files)
            return web.json_response({"status": "success", "validation": result})
            
        except Exception as e:
            logger.error(f"Error validating config: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    # Environment Management Routes
    async def check_env(self, request):
        """Check conda-pack environment status"""
        try:
            data = await request.json()
            env_path = data.get("env_path")
            
            if not env_path:
                return web.json_response({"error": "env_path required"}, status=400)
            
            result = check_environment(env_path)
            return web.json_response(result)
            
        except Exception as e:
            logger.error(f"Error checking environment: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def setup_env(self, request):
        """Setup conda-pack environment (extract if needed)"""
        try:
            data = await request.json()
            env_path = data.get("env_path")
            archive_path = data.get("archive_path")
            
            if not env_path:
                return web.json_response({"error": "env_path required"}, status=400)
            
            result = setup_environment(env_path, archive_path)
            return web.json_response(result)
            
        except Exception as e:
            logger.error(f"Error setting up environment: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    # Process Management Routes
    async def run_inference(self, request):
        """Run inference with conda-pack environment"""
        try:
            data = await request.json()
            config_path = data.get("config_path")
            env_path = data.get("env_path")
            
            if not config_path or not env_path:
                return web.json_response({"error": "config_path and env_path required"}, status=400)
            
            # First check/setup environment
            env_result = setup_environment(env_path, data.get("archive_path"))
            if env_result["status"] != "ready":
                return web.json_response(env_result, status=500)
            
            # Run inference
            result = run_inference_with_env(config_path, env_result["python_path"])
            return web.json_response(result)
            
        except Exception as e:
            logger.error(f"Error running inference: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def start_server(self):
        """Start the HTTP server"""
        runner = web.AppRunner(self.app)
        await runner.setup()

        site = web.TCPSite(runner, "localhost", self.port)
        await site.start()

        logger.info(f"Lightweight server started on http://localhost:{self.port}")
        return runner


def main():
    parser = argparse.ArgumentParser(description="Lightweight bioacoustics server")
    parser.add_argument("--port", type=int, default=8000, help="Port to run on")
    parser.add_argument("--test", action="store_true", help="Run quick test and exit")

    args = parser.parse_args()

    if args.test:
        print("✅ Lightweight server test successful!")
        print(f"Python version: {sys.version}")
        print(
            f"PyInstaller bundling: {'✅ SUCCESS' if getattr(sys, 'frozen', False) else '❌ Not bundled'}"
        )
        print("Available libraries:")
        print("  - pandas ✅")
        print("  - numpy ✅")
        print("  - librosa ✅")
        print("  - PIL ✅")
        print("  - aiohttp ✅")
        return 0

    async def run_server():
        server = LightweightServer(args.port)
        runner = await server.start_server()

        try:
            # Keep server running
            while True:
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            logger.info("Shutting down server...")
            await runner.cleanup()

    asyncio.run(run_server())
    return 0


if __name__ == "__main__":
    sys.exit(main())
