#!/usr/bin/env python3
"""
Extraction Task Creation Script

Creates extraction tasks from ML predictions by:
1. Scanning prediction files and extracting available classes
2. Applying stratification (by subfolder, etc.)
3. Applying filtering (score thresholds, etc.)
4. Extracting clips using various methods (random, score-bin, highest)
5. Creating extraction CSV files (binary or multiclass)
6. Optionally extracting audio clips

Usage:
    python create_extraction_task.py config.json
"""

import argparse
import json
import logging
import os
import sys
import traceback
from pathlib import Path
import pandas as pd
import numpy as np
from typing import Dict, List, Tuple, Any, Optional
import pickle
import random
from datetime import datetime

# Add the backend path to import opensoundscape if available
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

try:
    import opensoundscape as opso

    HAS_OPENSOUNDSCAPE = True
except ImportError:
    print("Warning: opensoundscape not available - audio extraction will be disabled")
    HAS_OPENSOUNDSCAPE = False


def setup_logging(log_file_path: Optional[str] = None):
    """Set up logging configuration"""
    log_format = "%(asctime)s - %(levelname)s - %(message)s"

    if log_file_path:
        logging.basicConfig(
            level=logging.INFO,
            format=log_format,
            handlers=[
                logging.FileHandler(log_file_path),
                logging.StreamHandler(sys.stdout),
            ],
        )
    else:
        logging.basicConfig(level=logging.INFO, format=log_format)


def scan_predictions_folder(folder_path: str) -> Dict[str, Any]:
    """
    Scan a folder for prediction files (CSV/PKL) and extract available classes

    Returns:
        Dict with 'available_classes', 'file_count', 'files' keys
    """
    folder_path = Path(folder_path)
    if not folder_path.exists():
        raise ValueError(f"Folder does not exist: {folder_path}")

    # Find prediction files
    prediction_files = []
    for ext in ["*.csv", "*.pkl"]:
        prediction_files.extend(list(folder_path.glob(ext)))
        prediction_files.extend(list(folder_path.rglob(ext)))  # Recursive search

    if not prediction_files:
        return {"available_classes": [], "file_count": 0, "files": []}

    # Extract classes from first file
    available_classes = []
    first_file = prediction_files[0]

    try:
        if first_file.suffix == ".csv":
            # Read just the header to get column names
            df_header = pd.read_csv(first_file, nrows=0)
            columns = df_header.columns.tolist()

            # Skip standard columns (file, start_time, end_time)
            skip_cols = ["file", "start_time", "end_time"]
            available_classes = [col for col in columns if col not in skip_cols]

        elif first_file.suffix == ".pkl":
            # For pickle files, load and inspect structure
            with open(first_file, "rb") as f:
                data = pickle.load(f)

            if isinstance(data, pd.DataFrame):
                columns = data.columns.tolist()
                skip_cols = ["file", "start_time", "end_time"]
                available_classes = [col for col in columns if col not in skip_cols]
            else:
                available_classes = []  # Unknown pickle format

    except Exception as e:
        logging.warning(f"Could not extract classes from {first_file}: {e}")
        available_classes = []

    return {
        "available_classes": available_classes,
        "file_count": len(prediction_files),
        "files": [str(f) for f in prediction_files],
    }


def load_prediction_files(file_paths: List[str]) -> pd.DataFrame:
    """
    Load and concatenate multiple prediction files

    Returns:
        Combined DataFrame with all predictions
    """
    dfs = []

    for file_path in file_paths:
        file_path = Path(file_path)

        try:
            if file_path.suffix == ".csv":
                df = pd.read_csv(file_path)
            elif file_path.suffix == ".pkl":
                df = pd.read_pickle(
                    file_path
                ).reset_index()  # TODO: consider whether to keep multi-index or columns
            else:
                logging.warning(f"Unsupported file format: {file_path}")
                continue

            # Add source file column for tracking
            df["source_file"] = str(file_path)
            dfs.append(df)

        except Exception as e:
            logging.error(f"Failed to load {file_path}: {e}")
            continue

    if not dfs:
        raise ValueError("No prediction files could be loaded")

    # Combine all dataframes
    combined_df = pd.concat(dfs, ignore_index=True)
    logging.info(f"Loaded {len(combined_df)} predictions from {len(dfs)} files")

    return combined_df


def apply_stratification(
    df: pd.DataFrame, config: Dict[str, Any]
) -> Dict[str, pd.DataFrame]:
    """
    Apply stratification to group predictions

    Returns:
        Dictionary mapping group names to DataFrames
    """
    stratification = config.get("stratification", {})

    # Apply subfolder stratification
    if stratification.get("by_subfolder", False):
        # if "subfolder" not in df.columns:  # if existing, use whatever is there!
        df["subfolder"] = df["file"].apply(
            lambda x: str(Path(x).parent.name) if pd.notna(x) else "unknown"
        )
        groups = {group: group_df for group, group_df in df.groupby("subfolder")}
        logging.info(
            f"Stratification created {len(groups)} groups: {list(groups.keys())}"
        )
        # df = df.drop(columns=["subfolder"])
        return groups

    return df


def apply_filtering(
    df: pd.DataFrame, config: Dict[str, Any], class_list: List[str]
) -> pd.DataFrame:
    """
    Apply filtering to remove rows where no classes exceed minimum score threshold

    Returns:
        Filtered DataFrame
    """
    filtering = config.get("filtering", {})
    original_length = len(df)

    # Apply score threshold filtering
    if filtering.get("score_threshold_enabled", False):
        threshold = filtering.get("score_threshold", 0.0)

        # For each selected class, keep rows where at least one class exceeds threshold
        if class_list:
            # Create mask for rows where any selected class exceeds threshold
            mask = pd.Series(False, index=df.index)
            for class_name in class_list:
                if class_name in df.columns:
                    mask |= df[class_name] > threshold

            df = df[mask].copy()
            logging.info(
                f"Score threshold filtering: {original_length} -> {len(df)} predictions"
            )

    return df


def extract_random_clips(
    group_df: pd.DataFrame, class_list: List[str], config: Dict[str, Any]
) -> List[Dict]:
    """Extract random N clips across all classes (for multiclass) or per class (for binary)"""
    extraction_config = config["extraction"]["random_clips"]
    count = extraction_config.get("count", 10)
    extraction_mode = config.get("extraction_mode", "binary")

    selected_clips = []

    if extraction_mode == "multiclass":
        # For multiclass: select N clips total across all classes
        # Get rows that have predictions for any of the selected classes
        mask = pd.Series(False, index=group_df.index)
        for class_name in class_list:
            if class_name in group_df.columns:
                mask |= group_df[class_name].notna()

        valid_predictions = group_df[mask].copy()

        if len(valid_predictions) == 0:
            logging.warning("No predictions found for any selected classes")
            return selected_clips

        # Sample random clips across all classes
        n_sample = min(count, len(valid_predictions))
        sampled = valid_predictions.sample(n=n_sample, random_state=42)

        for _, row in sampled.iterrows():
            # Create clip data with individual class scores
            clip_data = {
                "file": row["file"],
                "start_time": row["start_time"],
                "end_time": row["end_time"],
                "method": "random",
            }

            # Add individual class scores
            for class_name in class_list:
                if class_name in row:
                    clip_data[class_name] = row[class_name]

            selected_clips.append(clip_data)

    else:  # binary mode
        # For binary: select N clips per class (original behavior)
        for class_name in class_list:
            if class_name not in group_df.columns:
                logging.warning(f"Class {class_name} not found in data")
                continue

            # Get all predictions for this class (any positive score)
            class_predictions = group_df[group_df[class_name] > -np.inf].copy()

            if len(class_predictions) == 0:
                logging.warning(f"No predictions found for class {class_name}")
                continue

            # Sample random clips
            n_sample = min(count, len(class_predictions))
            sampled = class_predictions.sample(n=n_sample, random_state=42)

            for _, row in sampled.iterrows():
                clip_data = {
                    "file": row["file"],
                    "start_time": row["start_time"],
                    "end_time": row["end_time"],
                    "class": class_name,
                    "method": "random",
                }

                # Add individual class scores
                for class_name in class_list:
                    if class_name in row:
                        clip_data[class_name] = row[class_name]

                selected_clips.append(clip_data)

    logging.info(f"Random extraction: selected {len(selected_clips)} clips")
    return selected_clips


def extract_score_bin_stratified(
    group_df: pd.DataFrame, class_list: List[str], config: Dict[str, Any]
) -> List[Dict]:
    """Extract N clips for each score percentile bin"""
    extraction_config = config["extraction"]["score_bin_stratified"]
    count_per_bin = extraction_config.get("count_per_bin", 5)
    percentile_bins_str = extraction_config.get(
        "percentile_bins", "[[0,75],[75,90],[90,95],[95,100]]"
    )
    extraction_mode = config.get("extraction_mode", "binary")

    try:
        percentile_bins = json.loads(percentile_bins_str)
    except json.JSONDecodeError:
        logging.error(f"Invalid percentile bins format: {percentile_bins_str}")
        return []

    selected_clips = []

    for class_name in class_list:
        if class_name not in group_df.columns:
            continue

        # Get predictions for this class
        class_predictions = group_df[group_df[class_name] > -np.inf].copy()

        if len(class_predictions) == 0:
            continue

        # Calculate percentiles for this class
        scores = class_predictions[class_name]

        for bin_start, bin_end in percentile_bins:
            # Get percentile thresholds
            start_threshold = np.percentile(scores, bin_start)
            end_threshold = np.percentile(scores, bin_end)

            # Select clips in this percentile range
            bin_mask = (scores >= start_threshold) & (scores <= end_threshold)
            bin_predictions = class_predictions[bin_mask]

            if len(bin_predictions) == 0:
                continue

            # Sample from this bin
            n_sample = min(count_per_bin, len(bin_predictions))
            sampled = bin_predictions.sample(n=n_sample, random_state=42)

            for _, row in sampled.iterrows():
                clip_data = {
                    "file": row["file"],
                    "start_time": row["start_time"],
                    "end_time": row["end_time"],
                    "method": f"score_bin_{bin_start}-{bin_end}",
                    "percentile_bin": [bin_start, bin_end],
                }

                if extraction_mode == "binary":
                    # For binary mode, keep original format
                    clip_data["class"] = class_name
                    clip_data["score"] = row[class_name]
                    clip_data["all_scores"] = (
                        row[class_list].to_dict()
                        if all(c in row for c in class_list)
                        else {}
                    )
                else:
                    # For multiclass mode, store individual class scores directly
                    for class_name_inner in class_list:
                        if class_name_inner in row:
                            clip_data[class_name_inner] = row[class_name_inner]

                selected_clips.append(clip_data)

    logging.info(f"Score-bin extraction: selected {len(selected_clips)} clips")
    return selected_clips


def extract_highest_scoring(
    group_df: pd.DataFrame, class_list: List[str], config: Dict[str, Any]
) -> List[Dict]:
    """Extract highest scoring N clips for each class"""
    extraction_config = config["extraction"]["highest_scoring"]
    count = extraction_config.get("count", 10)
    extraction_mode = config.get("extraction_mode", "binary")

    selected_clips = []

    for class_name in class_list:
        if class_name not in group_df.columns:
            continue

        # Get all predictions for this class, sorted by score descending
        class_predictions = group_df[group_df[class_name] > -np.inf].copy()
        class_predictions = class_predictions.sort_values(class_name, ascending=False)

        if len(class_predictions) == 0:
            continue

        # Take top N
        n_sample = min(count, len(class_predictions))
        top_clips = class_predictions.head(n_sample)

        for _, row in top_clips.iterrows():
            clip_data = {
                "file": row["file"],
                "start_time": row["start_time"],
                "end_time": row["end_time"],
                "method": "highest_scoring",
            }

            if extraction_mode == "binary":
                # For binary mode, keep original format
                clip_data["class"] = class_name
                clip_data["score"] = row[class_name]
                clip_data["all_scores"] = (
                    row[class_list].to_dict()
                    if all(c in row for c in class_list)
                    else {}
                )
            else:
                # For multiclass mode, store individual class scores directly
                for class_name_inner in class_list:
                    if class_name_inner in row:
                        clip_data[class_name_inner] = row[class_name_inner]

            selected_clips.append(clip_data)

    logging.info(f"Highest scoring extraction: selected {len(selected_clips)} clips")
    return selected_clips


def extract_clips_from_groups(
    groups: Dict[str, pd.DataFrame], config: Dict[str, Any]
) -> List[Dict]:
    """
    Extract clips from each group using configured methods

    Returns:
        List of selected clip dictionaries
    """
    class_list = config["class_list"]
    extraction = config["extraction"]

    all_selected_clips = []

    for group_name, group_df in groups.items():
        logging.info(
            f"Processing group '{group_name}' with {len(group_df)} predictions"
        )

        # Apply filtering to this group
        filtered_df = apply_filtering(group_df, config, class_list)

        if len(filtered_df) == 0:
            logging.warning(
                f"No predictions remain after filtering in group {group_name}"
            )
            continue

        group_clips = []

        # Apply each enabled extraction method
        if extraction.get("random_clips", {}).get("enabled", False):
            group_clips.extend(extract_random_clips(filtered_df, class_list, config))

        if extraction.get("score_bin_stratified", {}).get("enabled", False):
            group_clips.extend(
                extract_score_bin_stratified(filtered_df, class_list, config)
            )

        if extraction.get("highest_scoring", {}).get("enabled", False):
            group_clips.extend(extract_highest_scoring(filtered_df, class_list, config))

        # Add group info to clips
        for clip in group_clips:
            clip["group"] = group_name

        all_selected_clips.extend(group_clips)

    # remove duplicates
    clip_df = pd.DataFrame.from_records(all_selected_clips)
    clip_df = clip_df.drop_duplicates(subset=["file", "start_time", "end_time"])

    logging.info(f"Total clips selected: {len(clip_df)}")
    return clip_df


def extract_audio_clips(
    selected_clips: pd.DataFrame, config: Dict[str, Any]
) -> Dict[str, str]:
    """
    Extract audio clips and return mapping of clip names to file paths

    Returns:
        Dictionary mapping original clip info to extracted clip filenames
    """
    if not HAS_OPENSOUNDSCAPE:
        logging.error("opensoundscape not available - cannot extract audio clips")
        return {}

    if not config.get("export_audio_clips", False):
        return {}

    clip_duration = config.get("clip_duration", 5.0)
    save_dir = Path(config["job_folder"])
    clips_dir = save_dir / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    clip_mapping = {}
    extracted_files = set()  # Track to avoid duplicates

    for i in range(len(selected_clips)):
        clip = selected_clips.iloc[i]
        file_path = clip["file"]
        start_time = clip["start_time"]
        end_time = clip["end_time"]

        # Calculate extraction window (centered on detection)
        detection_center = (start_time + end_time) / 2
        extract_start = detection_center - clip_duration / 2
        extract_end = detection_center + clip_duration / 2

        # Ensure non-negative start time
        extract_start = max(0, extract_start)
        extract_duration = extract_end - extract_start

        # Create unique clip name
        clip_name = f"clip_{i:06d}_{Path(file_path).stem}_{start_time:.1f}s.wav"
        clip_path = clips_dir / clip_name

        # Check if we've already extracted this exact clip
        clip_key = f"{file_path}_{extract_start}_{extract_duration}"
        if clip_key in extracted_files:
            # Find existing clip for this exact segment
            for existing_clip, existing_name in clip_mapping.items():
                if existing_clip.startswith(clip_key):
                    clip_mapping[f"{file_path}_{start_time}_{end_time}"] = existing_name
                    break
            continue

        try:
            # Extract audio clip
            audio = opso.Audio.from_file(
                file_path, offset=extract_start, duration=extract_duration
            )
            audio.save(str(clip_path))

            # Store mapping
            clip_mapping[f"{file_path}_{start_time}_{end_time}"] = clip_name
            extracted_files.add(clip_key)

            logging.info(f"Extracted audio clip: {clip_name}")

        except Exception as e:
            logging.error(f"Failed to extract audio clip {clip_name}: {e}")
            # Use original file path as fallback
            clip_mapping[f"{file_path}_{start_time}_{end_time}"] = file_path

    logging.info(f"Extracted {len(extracted_files)} unique audio clips")
    return clip_mapping


def create_extraction_csvs(
    selected_clips: pd.DataFrame,
    config: Dict[str, Any],
    audio_clip_mapping: Dict[str, str],
) -> List[str]:
    """
    Create extraction CSV files based on mode (binary vs multiclass)

    Returns:
        List of created CSV file paths
    """
    extraction_mode = config.get("extraction_mode")
    save_dir = Path(config["job_folder"])

    created_files = []

    if extraction_mode == "binary":
        # Create one CSV per class
        class_clips = {}
        for i in range(len(selected_clips)):
            clip = selected_clips.iloc[i]
            class_name = clip["class"]
            if class_name not in class_clips:
                class_clips[class_name] = []
            class_clips[class_name].append(clip)

        for class_name, clips in class_clips.items():
            csv_filename = f"{class_name}_selected_clips.csv"
            csv_path = save_dir / csv_filename

            # Prepare data for CSV
            csv_data = []
            for clip in clips:
                original_key = f"{clip['file']}_{clip['start_time']}_{clip['end_time']}"

                if (
                    config.get("export_audio_clips", False)
                    and original_key in audio_clip_mapping
                ):
                    # Use extracted clip path
                    file_path = f"clips/{audio_clip_mapping[original_key]}"
                    # adjust start times to be relative to the _extracted_ clip
                    # rather than relative to the original full audio file
                    detection_center = (clip["start_time"] + clip["end_time"]) / 2
                    clip_duration = config.get("clip_duration", 5.0)
                    clip_start = clip_duration / 2 - (
                        detection_center - clip["start_time"]
                    )
                    clip_end = clip_duration / 2 + (clip["end_time"] - detection_center)
                    clip_start = max(0, clip_start)
                    clip_end = min(clip_duration, clip_end)
                else:
                    # Use original file path and times
                    # start and end refer to the clip's offset from full audio file
                    file_path = clip["file"]
                    clip_start = clip["start_time"]
                    clip_end = clip["end_time"]

                row_data = {
                    "file": file_path,
                    "start_time": clip_start,
                    "end_time": clip_end,
                    "annotation": "",  # Empty for user to fill
                    "score": clip.get("score", ""),
                }

                # Add subfolder column if stratification by subfolder is enabled
                if config.get("stratification", {}).get("by_subfolder", False):
                    row_data["subfolder"] = clip.get("group", "")

                csv_data.append(row_data)

            # Create DataFrame and save
            df = pd.DataFrame(csv_data)
            df.to_csv(csv_path, index=False)
            created_files.append(str(csv_path))
            logging.info(
                f"Created binary extraction CSV: {csv_filename} with {len(df)} clips"
            )

    else:  # multiclass mode
        csv_filename = f"selected_clips.csv"
        csv_path = save_dir / csv_filename

        # For multiclass mode, selected_clips is a DataFrame, not a list of dicts
        # Convert to list of dicts if needed
        if isinstance(selected_clips, pd.DataFrame):
            clips_list = selected_clips.to_dict("records")
        else:
            clips_list = selected_clips

        # Get all unique clips (same clip might be selected for multiple classes)
        unique_clips = {}
        for clip in clips_list:
            original_key = f"{clip['file']}_{clip['start_time']}_{clip['end_time']}"
            if original_key not in unique_clips:
                unique_clips[original_key] = clip

        # Prepare data for multiclass CSV
        csv_data = []
        all_classes = config["class_list"]

        for original_key, clip in unique_clips.items():
            if (
                config.get("export_audio_clips", False)
                and original_key in audio_clip_mapping
            ):
                # Use extracted clip path and adjust times
                file_path = f"clips/{audio_clip_mapping[original_key]}"
                detection_center = (clip["start_time"] + clip["end_time"]) / 2
                clip_duration = config.get("clip_duration", 5.0)
                clip_start = clip_duration / 2 - (detection_center - clip["start_time"])
                clip_end = clip_duration / 2 + (clip["end_time"] - detection_center)

                clip_start = max(0, clip_start)
                clip_end = min(clip_duration, clip_end)
            else:
                file_path = clip["file"]
                clip_start = clip["start_time"]
                clip_end = clip["end_time"]

            # Create row with basic columns
            row = {"file": file_path, "start_time": clip_start, "end_time": clip_end}

            # Add subfolder column if stratification by subfolder is enabled
            if config.get("stratification", {}).get("by_subfolder", False):
                row["subfolder"] = clip.get("group", "")

            # Add columns for each class with actual scores (not empty strings)
            for class_name in all_classes:
                if class_name in clip and clip[class_name] is not None:
                    # Use the actual classifier score for this class
                    row[class_name] = clip[class_name]
                else:
                    # Empty string for user annotation if no score available
                    row[class_name] = ""

            csv_data.append(row)

        # Create DataFrame and save
        df = pd.DataFrame(csv_data)
        df.to_csv(csv_path, index=False)
        created_files.append(str(csv_path))
        logging.info(
            f"Created multiclass extraction CSV: {csv_filename} with {len(df)} clips"
        )

    return created_files


def create_extraction_task(config_path: str):
    """
    Main function to create extraction task from config file
    """
    # Load configuration
    with open(config_path, "r") as f:
        config = json.load(f)

    save_dir = Path(config["job_folder"])

    # Set up logging
    log_file = config.get("log_file_path")
    setup_logging(log_file)

    logging.info(f"Starting extraction task creation with config: {config_path}")

    try:
        # save config file to output dir
        with open(save_dir / "config.json", "w") as f:
            json.dump(config, f, indent=2, default=str)

        # Scan predictions folder to get file list
        scan_result = scan_predictions_folder(config["predictions_folder"])
        prediction_files = scan_result["files"]

        if not prediction_files:
            raise ValueError(
                f"No prediction files found in {config['predictions_folder']}"
            )

        # Load all prediction files
        combined_df = load_prediction_files(prediction_files)

        # Apply stratification by subfolder (more options can be added later)
        groups = apply_stratification(combined_df, config)

        # Extract clips from each group
        selected_clips_df = extract_clips_from_groups(groups, config)

        if selected_clips_df.empty:
            raise ValueError(
                "No clips were selected based on the current configuration"
            )

        # Extract audio clips if requested
        audio_clip_mapping = extract_audio_clips(selected_clips_df, config)

        # Create extraction CSV files
        created_files = create_extraction_csvs(
            selected_clips_df, config, audio_clip_mapping
        )

        # Save summary
        summary = {
            "total_clips_selected": len(selected_clips_df),
            "classes_processed": config["class_list"],
            "groups_processed": list(groups.keys()),
            "extraction_files_created": created_files,
            "audio_clips_extracted": (
                len(audio_clip_mapping) if audio_clip_mapping else 0
            ),
            "config_used": config,
        }

        summary_path = save_dir / f"extraction_task_summary.json"
        with open(summary_path, "w") as f:
            json.dump(summary, f, indent=2, default=str)

        logging.info(f"Extraction task creation completed successfully")
        logging.info(f"Summary saved to: {summary_path}")
        logging.info(f"Created {len(created_files)} extraction files")

        return {
            "status": "success",
            "extraction_files": created_files,
            "summary_file": str(summary_path),
            "total_clips": len(selected_clips_df),
        }

    except Exception as e:
        logging.error(f"Extraction task creation failed: {e}")
        logging.error(traceback.format_exc())
        return {"status": "error", "error": str(e)}


def main():
    parser = argparse.ArgumentParser(
        description="Create extraction tasks from ML predictions"
    )
    parser.add_argument("config", help="Path to configuration JSON file")

    args = parser.parse_args()

    result = create_extraction_task(args.config)

    if result["status"] == "error":
        sys.exit(1)
    else:
        print(f"SUCCESS: Created extraction task with {result['total_clips']} clips")


if __name__ == "__main__":
    main()
