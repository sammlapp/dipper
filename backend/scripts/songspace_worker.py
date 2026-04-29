#!/usr/bin/env python3
"""
SongSpace worker process.

Reads JSON-RPC messages from stdin (one per line), dispatches to songspace_utils,
writes JSON responses to stdout (one per line).  Keeps SongSpace instances alive
in memory between calls.
"""
import sys
import os
import json
import traceback
from pathlib import Path

# Suppress TensorFlow/JAX stdout output before any imports
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("PYTHONUNBUFFERED", "1")

# Redirect stdout to stderr during heavy imports so any stray prints go to log file
_real_stdout = sys.stdout
sys.stdout = sys.stderr

# Ensure this directory is on the path
sys.path.insert(0, str(Path(__file__).parent))
import songspace_utils as su

# Restore stdout for JSON-RPC communication
sys.stdout = _real_stdout


DISPATCH = {
    "open": su.open_songspace,
    "create": su.create_songspace,
    "info": su.get_info,
    "ingest_audio": su.ingest_audio,
    "fit_classifier": su.fit_classifier,
    "predict": su.predict_and_save,
    "similarity_search": su.similarity_search,
    "get_dataset_samples": su.get_dataset_samples,
}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            method = msg.get("method")
            params = msg.get("params", {})
            fn = DISPATCH.get(method)
            if fn is None:
                result = {"status": "error", "error": f"Unknown method: {method}"}
            else:
                # Redirect stdout→stderr during function call to capture stray library prints
                sys.stdout = sys.stderr
                try:
                    result = fn(**params)
                finally:
                    sys.stdout = _real_stdout
        except Exception as e:
            sys.stdout = _real_stdout
            result = {"status": "error", "error": str(e), "traceback": traceback.format_exc()}

        try:
            _real_stdout.write(json.dumps(result) + "\n")
            _real_stdout.flush()
        except Exception as e:
            _real_stdout.write(json.dumps({"status": "error", "error": f"Serialization error: {e}"}) + "\n")
            _real_stdout.flush()


if __name__ == "__main__":
    main()
