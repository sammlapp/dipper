#!/usr/bin/env python3
"""
Load annotation task CSV file for the Review tab.
This script reads a CSV file containing annotation tasks and outputs the data as JSON.
"""

import sys
import json
import os
import pandas as pd
import logging

# Set up logging - redirect to stderr to avoid interfering with JSON output
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stderr)]
)

def load_annotation_csv(csv_path):
    """
    Load annotation CSV file and return clip data.
    
    Expected columns:
    - file: Path to audio file
    - start_time: Start time in seconds
    - end_time: End time in seconds (optional)
    - annotation: Current annotation value
    - comments: Text comments (optional)
    
    Args:
        csv_path (str): Path to the CSV file
        
    Returns:
        dict: JSON response with clips data or error
    """
    try:
        # Check if file exists
        if not os.path.exists(csv_path):
            return {"error": f"File not found: {csv_path}"}
        
        # Read CSV file
        logging.info(f"Loading annotation CSV: {csv_path}")
        df = pd.read_csv(csv_path)
        
        # Validate required columns
        required_columns = ['file', 'start_time']
        missing_columns = [col for col in required_columns if col not in df.columns]
        if missing_columns:
            return {"error": f"Missing required columns: {', '.join(missing_columns)}"}
        
        logging.info(f"Found {len(df)} clips in CSV")
        logging.info(f"Columns: {list(df.columns)}")
        
        # Process clips
        clips = []
        for idx, row in df.iterrows():
            # Handle missing values
            file_path = str(row['file']) if pd.notna(row['file']) else ''
            start_time = float(row['start_time']) if pd.notna(row['start_time']) else 0.0
            
            # Optional columns with defaults
            end_time = float(row['end_time']) if 'end_time' in df.columns and pd.notna(row['end_time']) else start_time + 3.0
            annotation = str(row['annotation']) if 'annotation' in df.columns and pd.notna(row['annotation']) else ''
            comments = str(row['comments']) if 'comments' in df.columns and pd.notna(row['comments']) else ''
            
            # Clean up 'nan' string values
            if annotation.lower() == 'nan':
                annotation = ''
            if comments.lower() == 'nan':
                comments = ''
            
            clip_data = {
                'id': idx,
                'file': file_path,
                'start_time': start_time,
                'end_time': end_time,
                'annotation': annotation,
                'comments': comments
            }
            
            clips.append(clip_data)
        
        logging.info(f"Successfully processed {len(clips)} clips")
        
        return {
            "clips": clips,
            "total_clips": len(clips),
            "columns": list(df.columns)
        }
        
    except pd.errors.EmptyDataError:
        return {"error": "CSV file is empty"}
    except pd.errors.ParserError as e:
        return {"error": f"Failed to parse CSV: {str(e)}"}
    except Exception as e:
        logging.error(f"Error loading annotation CSV: {str(e)}")
        return {"error": f"Failed to load annotation file: {str(e)}"}

def main():
    """Main function to handle command line arguments and process CSV."""
    if len(sys.argv) != 2:
        result = {"error": "Usage: python load_annotation_task.py <csv_file_path>"}
        print(json.dumps(result))
        sys.exit(1)
    
    csv_path = sys.argv[1]
    
    # Load and process the CSV
    result = load_annotation_csv(csv_path)
    
    # Output JSON result to stdout
    print(json.dumps(result, indent=None, separators=(',', ':')))

if __name__ == "__main__":
    main()