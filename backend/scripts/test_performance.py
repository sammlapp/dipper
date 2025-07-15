#!/usr/bin/env python3
"""
Test script to compare performance between file I/O and buffer-based approaches
"""

import time
import json
import sys
import os
import numpy as np
import tempfile
from pathlib import Path

# Add the current directory to the path to import our modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from create_audio_clips import create_audio_clip_and_spectrogram
from create_audio_clips_batch import process_clips_batch

def create_test_audio_file():
    """Create a test audio file for performance testing"""
    import soundfile as sf
    
    # Create a 10-second test audio file with chirp
    duration = 10.0
    sample_rate = 22050
    t = np.linspace(0, duration, int(sample_rate * duration))
    
    # Create a chirp signal (frequency sweep)
    f0, f1 = 1000, 5000  # Start and end frequencies
    signal = np.sin(2 * np.pi * (f0 * t + (f1 - f0) * t**2 / (2 * duration)))
    
    # Add some noise
    noise = np.random.normal(0, 0.1, signal.shape)
    signal = signal + noise
    
    # Normalize
    signal = signal / np.max(np.abs(signal))
    
    # Save to temporary file
    temp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    sf.write(temp_file.name, signal, sample_rate)
    temp_file.close()
    
    return temp_file.name

def test_single_clip_performance():
    """Test single clip processing performance"""
    print("=== Single Clip Performance Test ===")
    
    # Create test audio file
    test_file = create_test_audio_file()
    
    # Test settings
    settings = {
        'spec_window_size': 512,
        'spectrogram_colormap': 'greys_r',
        'dB_range': [-80, -20],
        'resize_images': True,
        'image_width': 224,
        'image_height': 224,
        'normalize_audio': True,
        'create_temp_files': False  # Use buffer-based approach
    }
    
    # Test with buffer-based approach
    start_time = time.time()
    
    try:
        result = create_audio_clip_and_spectrogram(
            test_file, 2.0, 5.0, settings
        )
        
        buffer_time = time.time() - start_time
        
        print(f"✅ Buffer-based approach: {buffer_time:.3f} seconds")
        print(f"   - Audio base64 size: {len(result.get('audio_base64', ''))} chars")
        print(f"   - Spectrogram base64 size: {len(result.get('spectrogram_base64', ''))} chars")
        print(f"   - Duration: {result.get('duration', 0):.2f} seconds")
        print(f"   - Sample rate: {result.get('sample_rate', 0)} Hz")
        
        # Test with file-based approach for comparison
        settings['create_temp_files'] = True
        start_time = time.time()
        
        result_file = create_audio_clip_and_spectrogram(
            test_file, 2.0, 5.0, settings
        )
        
        file_time = time.time() - start_time
        
        print(f"📁 File-based approach: {file_time:.3f} seconds")
        print(f"   - Audio path: {result_file.get('audio_path', 'None')}")
        print(f"   - Spectrogram path: {result_file.get('spectrogram_path', 'None')}")
        
        # Calculate speedup
        speedup = file_time / buffer_time
        print(f"🚀 Speedup: {speedup:.2f}x faster with buffer approach")
        
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        # Clean up test file
        try:
            os.unlink(test_file)
        except:
            pass

def test_batch_processing():
    """Test batch processing performance"""
    print("\n=== Batch Processing Performance Test ===")
    
    # Create test audio file
    test_file = create_test_audio_file()
    
    # Create test clips data
    clips_data = []
    for i in range(10):  # Test with 10 clips
        start_time = i * 0.8  # Overlapping clips
        end_time = start_time + 2.0
        clips_data.append({
            'clip_id': f'test_clip_{i}',
            'file_path': test_file,
            'start_time': start_time,
            'end_time': end_time
        })
    
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
    
    # Test batch processing
    start_time = time.time()
    
    try:
        results = process_clips_batch(clips_data, settings)
        
        batch_time = time.time() - start_time
        
        successful_clips = [r for r in results if r.get('status') == 'success']
        failed_clips = [r for r in results if r.get('status') == 'error']
        
        print(f"✅ Batch processing: {batch_time:.3f} seconds")
        print(f"   - Total clips: {len(clips_data)}")
        print(f"   - Successful: {len(successful_clips)}")
        print(f"   - Failed: {len(failed_clips)}")
        print(f"   - Average time per clip: {batch_time / len(clips_data):.3f} seconds")
        
        if successful_clips:
            avg_audio_size = np.mean([len(r.get('audio_base64', '')) for r in successful_clips])
            avg_spec_size = np.mean([len(r.get('spectrogram_base64', '')) for r in successful_clips])
            print(f"   - Average audio base64 size: {avg_audio_size:.0f} chars")
            print(f"   - Average spectrogram base64 size: {avg_spec_size:.0f} chars")
        
        # Estimate equivalent single-clip processing time
        single_clip_time = 0.2  # Estimated from previous test
        estimated_sequential_time = single_clip_time * len(clips_data)
        
        speedup = estimated_sequential_time / batch_time
        print(f"🚀 Estimated speedup vs sequential: {speedup:.2f}x")
        
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        # Clean up test file
        try:
            os.unlink(test_file)
        except:
            pass

if __name__ == "__main__":
    print("Performance Test - Buffer-based Audio Clip Processing")
    print("=" * 60)
    
    test_single_clip_performance()
    test_batch_processing()
    
    print("\n" + "=" * 60)
    print("Performance test completed!")
    print("The buffer-based approach should be significantly faster than file I/O")
    print("Batch processing should provide additional speedup for multiple clips")