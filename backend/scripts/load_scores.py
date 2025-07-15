#!/usr/bin/env python3
"""
Load and process score files for data exploration
"""

import argparse
import json
import pandas as pd
import numpy as np
import sys
import os

def load_scores(file_path):
    """Load scores from CSV file"""
    try:
        # Try to load as multi-index (opensoundscape format)
        df = pd.read_csv(file_path, index_col=[0, 1, 2])
        
        # Convert to format suitable for frontend
        scores = {}
        for column in df.columns:
            scores[column] = df[column].values.tolist()
        
        # Calculate min and max scores
        all_scores = df.values.flatten()
        min_score = float(np.min(all_scores))
        max_score = float(np.max(all_scores))
        
        # Get file info
        file_info = []
        for idx in df.index:
            file_info.append({
                'file': idx[0],
                'start_time': idx[1],
                'end_time': idx[2]
            })
        
        result = {
            'scores': scores,
            'min_score': min_score,
            'max_score': max_score,
            'file_info': file_info,
            'shape': list(df.shape)
        }
        
        return result
        
    except Exception as e:
        # Try to load as simple CSV
        try:
            df = pd.read_csv(file_path)
            
            # Assume first column is file path, rest are scores
            if 'file' in df.columns:
                file_col = 'file'
            else:
                file_col = df.columns[0]
            
            score_columns = [col for col in df.columns if col != file_col]
            
            scores = {}
            for column in score_columns:
                scores[column] = df[column].values.tolist()
            
            all_scores = df[score_columns].values.flatten()
            min_score = float(np.min(all_scores))
            max_score = float(np.max(all_scores))
            
            file_info = []
            for _, row in df.iterrows():
                file_info.append({
                    'file': row[file_col],
                    'start_time': 0,
                    'end_time': 0
                })
            
            result = {
                'scores': scores,
                'min_score': min_score,
                'max_score': max_score,
                'file_info': file_info,
                'shape': list(df.shape)
            }
            
            return result
            
        except Exception as e2:
            raise Exception(f"Could not load scores file: {e2}")

def main():
    parser = argparse.ArgumentParser(description='Load scores file')
    parser.add_argument('file_path', help='Path to scores CSV file')
    
    args = parser.parse_args()
    
    try:
        if not os.path.exists(args.file_path):
            raise FileNotFoundError(f"File not found: {args.file_path}")
        
        result = load_scores(args.file_path)
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            'error': str(e),
            'scores': {},
            'min_score': 0,
            'max_score': 1,
            'file_info': [],
            'shape': [0, 0]
        }
        print(json.dumps(error_result))

if __name__ == "__main__":
    main()