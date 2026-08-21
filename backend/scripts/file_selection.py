from pathlib import Path
from glob import glob
import os

# Audio file extensions (case-insensitive)
AUDIO_EXTENSIONS = {
    ".wav",
    ".mp3",
    ".flac",
    ".ogg",
    ".m4a",
    ".aac",
    ".wma",
    ".aiff",
}


def _is_audio_file(filepath):
    return Path(filepath).suffix.lower() in AUDIO_EXTENSIONS


def resolve_files_from_config(config_data, logger=None):
    """
    Resolve audio files from config using exactly one file selection method.

    Args:
        config_data: Configuration dictionary containing one of:
            - files: List of file paths
            - file_globbing_patterns: List of glob patterns
            - file_list: Path to text file with one file per line

    Returns:
        List of audio file paths

    Raises:
        ValueError: If multiple file selection methods are specified or none found
    """

    # Check which file selection methods are specified
    has_files = bool(config_data.get("files"))
    has_patterns = bool(config_data.get("file_globbing_patterns"))
    has_file_list = bool(config_data.get("file_list"))

    methods_specified = sum([has_files, has_patterns, has_file_list])

    if methods_specified == 0:
        raise ValueError(
            "Config error: No file selection method specified. Please provide 'files', 'file_globbing_patterns', or 'file_list'"
        )

    if methods_specified > 1:
        methods = []
        if has_files:
            methods.append("files")
        if has_patterns:
            methods.append("file_globbing_patterns")
        if has_file_list:
            methods.append("file_list")
        raise ValueError(
            f"Config error: Multiple file selection methods specified: {', '.join(methods)}. Please specify only one method."
        )

    files = []

    # Process files array
    if has_files:
        files = config_data["files"]
        if logger:
            logger.info(f"Using files array with {len(files)} files")

    # Process glob patterns
    elif has_patterns:
        patterns = config_data["file_globbing_patterns"]
        if logger:
            logger.info(f"Processing {len(patterns)} glob patterns")

        for pattern in patterns:
            try:
                matched_files = glob(pattern, recursive=True)

                # if pattern ends with wildcard, filter to audio files only
                # to avoid including text/other files for ml inference
                if pattern.endswith("*") or pattern.endswith("**"):
                    # Filter by audio file extensions
                    # this filters out custom user-specified extensions!
                    filtered_files = [f for f in matched_files if _is_audio_file(f)]
                    filtered_count = len(matched_files) - len(filtered_files)
                    if filtered_count > 0:
                        if logger:
                            logger.info(
                                f"Filtered out {filtered_count} non-audio files from pattern '{pattern}'"
                            )
                    files.extend(filtered_files)
                else:
                    files.extend(matched_files)

                if logger:
                    logger.info(
                        f"Pattern '{pattern}' matched {len(matched_files)} files"
                    )
            except Exception as e:
                if logger:
                    logger.error(f"Invalid glob pattern '{pattern}': {e}")
                raise ValueError(f"Invalid glob pattern '{pattern}': {e}")

    # Process file list
    elif has_file_list:
        file_list_path = config_data["file_list"]
        if logger:
            logger.info(f"Reading file list from: {file_list_path}")

        if not os.path.exists(file_list_path):
            raise FileNotFoundError(f"File list not found: {file_list_path}")

        try:
            with open(file_list_path, "r", encoding="utf-8") as f:
                files = [line.strip() for line in f if line.strip()]
            if logger:
                logger.info(f"Loaded {len(files)} files from file list")
        except Exception as e:
            if logger:
                logger.error(f"Failed to read file list '{file_list_path}': {e}")
            raise ValueError(f"Failed to read file list '{file_list_path}': {e}")

    # Remove duplicates while preserving order
    seen = set()
    unique_files = []
    for f in files:
        if f not in seen:
            seen.add(f)
            unique_files.append(f)

    duplicates_removed = len(files) - len(unique_files)
    if duplicates_removed > 0:
        if logger:
            logger.info(f"Removed {duplicates_removed} duplicate files")

    if not unique_files:
        raise ValueError("No audio files found after processing file selection method")

    if logger:
        logger.info(f"Final file list contains {len(unique_files)} unique audio files")
    return unique_files
