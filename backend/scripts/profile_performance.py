#!/usr/bin/env python3
"""
Performance profiling script for spectrogram and audio creation
Measures timing at each step of the process
"""

import time
import json
import sys
import os
import numpy as np
import tempfile
import logging
from pathlib import Path
import argparse
from typing import List, Dict, Any
import psutil
import tracemalloc

# Add the current directory to the path to import our modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from create_audio_clips import create_audio_clip_and_spectrogram
from create_audio_clips_batch import process_clips_batch

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)
logger = logging.getLogger(__name__)

class PerformanceProfiler:
    def __init__(self):
        self.timings = {}
        self.memory_usage = {}
        self.start_times = {}
        
    def start_timer(self, operation: str):
        """Start timing an operation"""
        self.start_times[operation] = time.perf_counter()
        
    def end_timer(self, operation: str) -> float:
        """End timing an operation and return duration"""
        if operation not in self.start_times:
            raise ValueError(f"Timer {operation} was not started")
        
        duration = time.perf_counter() - self.start_times[operation]
        self.timings[operation] = duration
        del self.start_times[operation]
        return duration
        
    def measure_memory(self, operation: str):
        """Measure current memory usage"""
        process = psutil.Process()
        memory_info = process.memory_info()
        self.memory_usage[operation] = {
            'rss_mb': memory_info.rss / 1024 / 1024,  # RSS in MB
            'vms_mb': memory_info.vms / 1024 / 1024,  # VMS in MB
        }
        
    def get_report(self) -> Dict[str, Any]:
        """Get performance report"""
        return {
            'timings': self.timings,
            'memory_usage': self.memory_usage,
            'total_time': sum(self.timings.values())
        }

def create_test_audio_file(duration: float = 10.0, sample_rate: int = 22050) -> str:
    """Create a test audio file for profiling"""
    import soundfile as sf
    
    # Create a 10-second test audio file with chirp
    t = np.linspace(0, duration, int(sample_rate * duration))
    
    # Create a chirp signal (frequency sweep) with some bird-like characteristics
    f0, f1 = 1000, 5000  # Start and end frequencies
    signal = np.sin(2 * np.pi * (f0 * t + (f1 - f0) * t**2 / (2 * duration)))
    
    # Add some harmonics to make it more realistic
    signal += 0.3 * np.sin(4 * np.pi * (f0 * t + (f1 - f0) * t**2 / (2 * duration)))
    signal += 0.2 * np.sin(6 * np.pi * (f0 * t + (f1 - f0) * t**2 / (2 * duration)))
    
    # Add some noise
    noise = np.random.normal(0, 0.05, signal.shape)
    signal = signal + noise
    
    # Normalize
    signal = signal / np.max(np.abs(signal))
    
    # Save to temporary file
    temp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    sf.write(temp_file.name, signal, sample_rate)
    temp_file.close()
    
    return temp_file.name

def profile_single_clip(test_file: str, profiler: PerformanceProfiler) -> Dict[str, Any]:
    """Profile creation of a single clip"""
    logger.info("=== Profiling Single Clip ===")
    
    # Test settings optimized for performance
    settings = {
        'spec_window_size': 512,
        'spectrogram_colormap': 'greys_r',
        'dB_range': [-80, -20],
        'resize_images': True,
        'image_width': 224,
        'image_height': 224,
        'normalize_audio': True,
        'create_temp_files': False  # Use buffer-based approach only
    }
    
    start_time = 2.0
    end_time = 5.0
    
    profiler.start_timer('single_clip_total')
    profiler.measure_memory('single_clip_start')
    
    try:
        # Time audio loading
        profiler.start_timer('audio_loading')
        import librosa
        samples, sr = librosa.load(test_file, sr=None, offset=start_time, duration=end_time - start_time)
        audio_load_time = profiler.end_timer('audio_loading')
        logger.info(f"Audio loading: {audio_load_time:.3f}s")
        
        # Time spectrogram creation
        profiler.start_timer('spectrogram_creation')
        import scipy.signal
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
        spec_creation_time = profiler.end_timer('spectrogram_creation')
        logger.info(f"Spectrogram creation: {spec_creation_time:.3f}s")
        
        # Time complete processing (including image conversion and base64 encoding)
        profiler.start_timer('complete_processing')
        result = create_audio_clip_and_spectrogram(test_file, start_time, end_time, settings)
        complete_time = profiler.end_timer('complete_processing')
        logger.info(f"Complete processing: {complete_time:.3f}s")
        
        profiler.measure_memory('single_clip_end')
        total_time = profiler.end_timer('single_clip_total')
        
        # Calculate sizes
        audio_size = len(result.get('audio_base64', ''))
        spec_size = len(result.get('spectrogram_base64', ''))
        
        return {
            'success': True,
            'total_time': total_time,
            'audio_load_time': audio_load_time,
            'spec_creation_time': spec_creation_time,
            'complete_processing_time': complete_time,
            'audio_base64_size': audio_size,
            'spectrogram_base64_size': spec_size,
            'memory_usage': profiler.memory_usage
        }
        
    except Exception as e:
        logger.error(f"Error in single clip profiling: {e}")
        return {
            'success': False,
            'error': str(e),
            'total_time': profiler.end_timer('single_clip_total') if 'single_clip_total' in profiler.start_times else 0
        }

def profile_batch_processing(test_file: str, profiler: PerformanceProfiler, num_clips: int = 12) -> Dict[str, Any]:
    """Profile batch processing of multiple clips"""
    logger.info(f"=== Profiling Batch Processing ({num_clips} clips) ===")
    
    # Test settings
    settings = {
        'spec_window_size': 512,
        'spectrogram_colormap': 'greys_r',
        'dB_range': [-80, -20],
        'resize_images': True,
        'image_width': 224,
        'image_height': 224,
        'normalize_audio': True,
        'max_workers': 4
    }
    
    # Create test clips data (simulating a page of clips)
    clips_data = []
    for i in range(num_clips):
        start_time = i * 0.8  # Overlapping clips
        end_time = start_time + 3.0
        clips_data.append({
            'clip_id': f'test_clip_{i}',
            'file_path': test_file,
            'start_time': start_time,
            'end_time': end_time
        })
    
    profiler.start_timer('batch_total')
    profiler.measure_memory('batch_start')
    
    try:
        # Time batch processing
        profiler.start_timer('batch_processing')
        results = process_clips_batch(clips_data, settings)
        batch_time = profiler.end_timer('batch_processing')
        
        profiler.measure_memory('batch_end')
        total_time = profiler.end_timer('batch_total')
        
        # Analyze results
        successful_clips = [r for r in results if r.get('status') == 'success']
        failed_clips = [r for r in results if r.get('status') == 'error']
        
        # Calculate average sizes
        avg_audio_size = 0
        avg_spec_size = 0
        if successful_clips:
            avg_audio_size = np.mean([len(r.get('audio_base64', '')) for r in successful_clips])
            avg_spec_size = np.mean([len(r.get('spectrogram_base64', '')) for r in successful_clips])
        
        return {
            'success': True,
            'total_clips': num_clips,
            'successful_clips': len(successful_clips),
            'failed_clips': len(failed_clips),
            'total_time': total_time,
            'batch_processing_time': batch_time,
            'average_time_per_clip': batch_time / num_clips if num_clips > 0 else 0,
            'avg_audio_base64_size': avg_audio_size,
            'avg_spectrogram_base64_size': avg_spec_size,
            'memory_usage': profiler.memory_usage,
            'throughput_clips_per_second': num_clips / batch_time if batch_time > 0 else 0
        }
        
    except Exception as e:
        logger.error(f"Error in batch profiling: {e}")
        return {
            'success': False,
            'error': str(e),
            'total_time': profiler.end_timer('batch_total') if 'batch_total' in profiler.start_times else 0
        }

def profile_data_transfer_simulation(test_file: str, profiler: PerformanceProfiler) -> Dict[str, Any]:
    """Simulate data transfer timing (base64 encoding/decoding)"""
    logger.info("=== Profiling Data Transfer Simulation ===")
    
    settings = {
        'spec_window_size': 512,
        'spectrogram_colormap': 'greys_r',
        'dB_range': [-80, -20],
        'resize_images': True,
        'image_width': 224,
        'image_height': 224,
        'normalize_audio': True,
        'create_temp_files': False
    }
    
    # Create a clip
    result = create_audio_clip_and_spectrogram(test_file, 2.0, 5.0, settings)
    
    if result:
        audio_base64 = result.get('audio_base64', '')
        spec_base64 = result.get('spectrogram_base64', '')
        
        # Time JSON serialization (simulating IPC)
        profiler.start_timer('json_serialization')
        json_data = json.dumps({
            'audio_base64': audio_base64,
            'spectrogram_base64': spec_base64,
            'duration': result.get('duration', 0),
            'sample_rate': result.get('sample_rate', 0)
        })
        json_time = profiler.end_timer('json_serialization')
        
        # Time JSON parsing
        profiler.start_timer('json_parsing')
        parsed_data = json.loads(json_data)
        parse_time = profiler.end_timer('json_parsing')
        
        # Simulate frontend data URL creation
        profiler.start_timer('data_url_creation')
        audio_data_url = f"data:audio/wav;base64,{parsed_data['audio_base64']}"
        spec_data_url = f"data:image/png;base64,{parsed_data['spectrogram_base64']}"
        url_time = profiler.end_timer('data_url_creation')
        
        return {
            'success': True,
            'json_size_bytes': len(json_data),
            'json_serialization_time': json_time,
            'json_parsing_time': parse_time,
            'data_url_creation_time': url_time,
            'audio_base64_size': len(audio_base64),
            'spectrogram_base64_size': len(spec_base64),
            'total_transfer_simulation_time': json_time + parse_time + url_time
        }
    else:
        return {'success': False, 'error': 'Failed to create clip'}

def main():
    parser = argparse.ArgumentParser(description="Profile spectrogram and audio creation performance")
    parser.add_argument("--clips", type=int, default=12, help="Number of clips for batch testing")
    parser.add_argument("--output", type=str, help="Output file for results")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Start memory tracking
    tracemalloc.start()
    
    # Create test audio file
    logger.info("Creating test audio file...")
    test_file = create_test_audio_file()
    
    try:
        profiler = PerformanceProfiler()
        
        # Profile single clip
        single_result = profile_single_clip(test_file, profiler)
        
        # Profile batch processing
        batch_result = profile_batch_processing(test_file, profiler, args.clips)
        
        # Profile data transfer simulation
        transfer_result = profile_data_transfer_simulation(test_file, profiler)
        
        # Get memory usage
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        
        # Compile results
        results = {
            'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
            'test_conditions': {
                'num_clips_batch': args.clips,
                'test_file_duration': 10.0,
                'settings': {
                    'spec_window_size': 512,
                    'image_size': '224x224',
                    'colormap': 'greys_r'
                }
            },
            'single_clip_performance': single_result,
            'batch_performance': batch_result,
            'data_transfer_performance': transfer_result,
            'memory_tracking': {
                'current_mb': current / 1024 / 1024,
                'peak_mb': peak / 1024 / 1024
            },
            'performance_summary': {
                'single_clip_time': single_result.get('total_time', 0),
                'batch_throughput': batch_result.get('throughput_clips_per_second', 0),
                'avg_time_per_clip_batch': batch_result.get('average_time_per_clip', 0),
                'data_transfer_overhead': transfer_result.get('total_transfer_simulation_time', 0)
            }
        }
        
        # Output results
        print(json.dumps(results, indent=2))
        
        if args.output:
            with open(args.output, 'w') as f:
                json.dump(results, f, indent=2)
            logger.info(f"Results saved to {args.output}")
        
        # Print summary
        print(f"\n=== PERFORMANCE SUMMARY ===", file=sys.stderr)
        print(f"Single clip processing: {single_result.get('total_time', 0):.3f}s", file=sys.stderr)
        print(f"Batch throughput: {batch_result.get('throughput_clips_per_second', 0):.1f} clips/sec", file=sys.stderr)
        print(f"Average time per clip (batch): {batch_result.get('average_time_per_clip', 0):.3f}s", file=sys.stderr)
        print(f"Data transfer simulation: {transfer_result.get('total_transfer_simulation_time', 0):.3f}s", file=sys.stderr)
        print(f"Peak memory usage: {peak / 1024 / 1024:.1f} MB", file=sys.stderr)
        
    finally:
        # Clean up test file
        try:
            os.unlink(test_file)
        except:
            pass

if __name__ == "__main__":
    main()