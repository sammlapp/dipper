#!/usr/bin/env python3
"""
Load extraction task CSV file for the Review tab.
This script reads a CSV file containing extraction tasks and outputs the data as JSON.
"""

import sys
import json
import os
import pandas as pd
import logging

# Set up logging - redirect to stderr to avoid interfering with JSON output
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)


def multihot_to_class_list(series, classes, threshold=0):
    labels = series[classes]
    # Convert to numeric, treating non-numeric values as 0
    labels = pd.to_numeric(labels, errors="coerce").fillna(0)
    return labels[labels > threshold].index.to_list()


def load_extraction_csv(csv_path, threshold=0):
    """
    Load extraction CSV file and return clip data.

    Expected columns:
    - file: Path to audio file
    - start_time: Start time in seconds
    - end_time: End time in seconds (optional)
    - annotation: Current annotation value
        - for binary classification: yes/no/uncertain/NaN
        - for multi-class classification: comma-separated list of classes
    - comments: Text comments (optional)

    Alternative format: instead of annotation column one column per class
    - values are 0/1 for absent/present, NaN for unannotated, or continuous score
        to use threshold for determining present/absent

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
        required_columns = ["file", "start_time"]
        missing_columns = [col for col in required_columns if col not in df.columns]
        if missing_columns:
            return {"error": f"Missing required columns: {', '.join(missing_columns)}"}

        logging.info(f"Found {len(df)} clips in CSV")
        logging.info(f"Columns: {list(df.columns)}")

        # Convert numeric columns to proper types
        df["start_time"] = pd.to_numeric(df["start_time"], errors="coerce")
        if "end_time" in df.columns:
            df["end_time"] = pd.to_numeric(df["end_time"], errors="coerce")

        # Determine clip duration if end time is provided
        if (
            "end_time" in df.columns
            and len(df) > 0
            and pd.notna(df["end_time"].iloc[0])
        ):
            duration = float(df.iloc[0]["end_time"] - df.iloc[0]["start_time"])
        else:
            duration = None

        # fill missing values
        df["id"] = list(range(len(df)))
        if "comments" in df.columns:
            df["comments"].fillna("", inplace=True)
        else:
            df["comments"] = ""

        if "annotation" in df.columns and "labels" in df.columns:
            raise ValueError(
                "Found columns for both 'annotations' (yes/no/uncertain) and 'labels' (lists of classes present) which could lead to mass confusion and is not allowed. "
            )

        if "annotation" in df.columns:
            # we don't know the complete list of classes
            classes = None
            # include 'annotations' column of 'yes','no','uncertain',NaN
            df["annotation"].fillna("", inplace=True)

            # strip whitespace and convert to lowercase:
            df["annotation"] = df["annotation"].str.strip().str.lower()

            # ensure proper values
            assert (
                df["annotation"].isin(["yes", "no", "uncertain", ""]).all()
            ), f"annotation column was present but contained values other than 'yes', 'no', 'uncertain', and empty cells: {df['annotation'].unique()}"
            # Only include end_time if it was provided in the CSV
            if "end_time" in df.columns:
                df = df[["file", "start_time", "end_time", "annotation", "comments"]]
            else:
                df = df[["file", "start_time", "annotation", "comments"]]

        elif "labels" in df.columns:
            # Extract classes from the labels data
            classes = set()
            # Handle labels column - could be lists, comma-separated strings, or empty
            df["labels"].fillna("", inplace=True)

            # Convert comma-separated strings to lists
            def parse_labels(x):
                if pd.isna(x) or x == "":
                    return []
                elif isinstance(x, list):
                    return x
                elif isinstance(x, str):
                    # Handle comma-separated string like "bird,car"
                    if x.startswith("[") and x.endswith("]"):
                        # Already JSON format
                        try:
                            return json.loads(x.replace("'", '"'))
                        except:
                            return []
                    else:
                        # Comma-separated string
                        return [
                            label.strip() for label in x.split(",") if label.strip()
                        ]
                else:
                    return []

            df["labels"] = df["labels"].apply(parse_labels)

            # Extract unique classes from all labels
            for labels_list in df["labels"]:
                if isinstance(labels_list, list):
                    classes.update(labels_list)
            classes = sorted(list(classes)) if classes else None

            if not "annotation_status" in df.columns:
                # assume all clips unreviewed since no info about completion
                df["annotation_status"] = "unreviewed"
            else:
                # Fill any NaN values with default status
                df["annotation_status"].fillna("unreviewed", inplace=True)

            # Validate annotation_status values
            valid_statuses = ["complete", "unreviewed", "uncertain"]
            invalid_statuses = df["annotation_status"][
                ~df["annotation_status"].isin(valid_statuses)
            ]
            if not invalid_statuses.empty:
                raise ValueError(
                    f"annotation_status column contained invalid values: {invalid_statuses.unique()}. Valid values are: {valid_statuses}"
                )
            # Subset columns; Only include end_time if it was provided in the CSV
            columns = (
                ["file", "start_time"]
                + (["end_time"] if "end_time" in df.columns else [])
                + ["labels", "annotation_status", "comments"]
            )
            df = df[columns]
            # serialize annotations to json if they are lists
            df["labels"] = df["labels"].apply(
                lambda x: json.dumps(x) if isinstance(x, list) else "[]"
            )

        else:  # no 'labels' or 'annotation' columns: we expect a one-hot df with column per class
            # Handle multi-hot formatted labels (one class per column)
            # by converting to annotations and also forwarding the list of classes
            # assume this dataframe has a column per class and 0/1/nan or continuous score values
            classes = list(
                set(df.columns)
                - set(["file", "start_time", "end_time", "comments", "id"])
            )
            df["labels"] = df.apply(
                multihot_to_class_list, axis=1, args=(classes, threshold)
            )
            # serialize annotations to json if they are lists
            df["labels"] = df["labels"].apply(
                lambda x: json.dumps(x) if isinstance(x, list) else "[]"
            )
            if "comments" not in df.columns:
                df["comments"] = ""
            # Add annotation_status for multi-class
            df["annotation_status"] = "unreviewed"

            # Subset columns; Only include end_time if it was provided in the CSV
            columns = (
                ["file", "start_time"]
                + (["end_time"] if "end_time" in df.columns else [])
                + ["labels", "annotation_status", "comments"]
            )
            df = df[columns]

        # Convert to appropriate json format and send
        clips = df.to_dict(orient="records")

        # Ensure each clip has an id field and handle NaN values
        for i, clip in enumerate(clips):
            clip["id"] = i
            # Replace NaN values with None (which becomes null in JSON)
            for key, value in clip.items():
                if pd.isna(value):
                    clip[key] = None

        return {
            "clips": clips,
            "total_clips": len(clips),
            "columns": list(df.columns),
            "duration": duration,
            "classes": classes,
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
    result = load_extraction_csv(csv_path)

    # Output JSON result to stdout
    print(json.dumps(result, indent=None, separators=(",", ":")))


if __name__ == "__main__":
    main()
