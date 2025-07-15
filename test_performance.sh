#!/bin/bash

echo "=== Performance Testing Script ==="
echo "This script runs backend performance tests for spectrogram and audio creation"
echo

# Change to backend directory
cd backend

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install dependencies if needed
echo "Installing dependencies..."
pip install -q -r requirements.txt

# Run performance tests
echo
echo "=== Running Performance Tests ==="
echo

# Test with different clip counts
echo "Testing with 1 clip..."
python scripts/profile_performance.py --clips 1 --output results_1_clip.json

echo
echo "Testing with 6 clips (half page)..."
python scripts/profile_performance.py --clips 6 --output results_6_clips.json

echo
echo "Testing with 12 clips (full page)..."
python scripts/profile_performance.py --clips 12 --output results_12_clips.json

echo
echo "Testing with 24 clips (two pages)..."
python scripts/profile_performance.py --clips 24 --output results_24_clips.json

echo
echo "=== Performance Test Results ==="
echo "Results saved to:"
echo "- results_1_clip.json"
echo "- results_6_clips.json" 
echo "- results_12_clips.json"
echo "- results_24_clips.json"

echo
echo "=== Quick Performance Summary ==="
echo

# Extract key metrics from results
if command -v jq &> /dev/null; then
    echo "Single clip performance:"
    jq -r '.performance_summary.single_clip_time' results_1_clip.json | xargs printf "  Time: %.3fs\n"
    
    echo
    echo "Batch performance (12 clips):"
    jq -r '.performance_summary.batch_throughput' results_12_clips.json | xargs printf "  Throughput: %.1f clips/sec\n"
    jq -r '.performance_summary.avg_time_per_clip_batch' results_12_clips.json | xargs printf "  Avg time per clip: %.3fs\n"
    
    echo
    echo "Data transfer simulation:"
    jq -r '.performance_summary.data_transfer_overhead' results_12_clips.json | xargs printf "  Transfer overhead: %.3fs\n"
else
    echo "Install 'jq' for formatted output, or check the JSON files directly"
fi

echo
echo "=== Test Complete ==="
echo "To run individual tests: python scripts/profile_performance.py --help"