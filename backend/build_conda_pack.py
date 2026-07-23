#!/usr/bin/env python3
"""
Build conda-pack environment for ML inference
This replaces the JavaScript build script in frontend/build-scripts/
"""

import os
import sys
import shutil
import subprocess
import tempfile
from pathlib import Path

# Project paths
PROJECT_ROOT = Path(__file__).parent.parent
BACKEND_DIR = Path(__file__).parent
ENV_NAME = "dipper_ml_env"
OUTPUT_DIR = PROJECT_ROOT / "environments"


def run_command(command, description=None, ignore_errors=False):
    """Run a command and handle errors"""
    if description:
        print(f"[INFO] {description}")

    print(f"Running: {command}")
    try:
        result = subprocess.run(
            command, shell=True, check=True, capture_output=True, text=True
        )
        return result
    except subprocess.CalledProcessError as e:
        if ignore_errors:
            print(f"[WARNING] Command failed (ignored): {command}")
            return None
        else:
            print(f"[ERROR] Command failed: {command}")
            print(f"Error: {e}")
            if e.stdout:
                print(f"Stdout: {e.stdout}")
            if e.stderr:
                print(f"Stderr: {e.stderr}")
            sys.exit(1)


def check_conda():
    """Check if conda is available"""
    try:
        result = run_command(
            "conda --version", description="Checking conda availability"
        )
        print(f"[OK] Conda found: {result.stdout.strip()}")
        return True
    except:
        print("[ERROR] Conda not found. Please install Miniconda or Anaconda.")
        return False


def create_conda_environment():
    """Create conda environment from yml file"""
    print(f"[INFO] Creating conda environment: {ENV_NAME}")

    # Remove existing environment if it exists
    print("Checking for existing environment...")
    run_command(f"conda remove -n {ENV_NAME} --all -y", ignore_errors=True)

    # Create environment from yml file
    yml_path = BACKEND_DIR / "dipper_ml_env.yml"
    if not yml_path.exists():
        print(f"[ERROR] Environment file not found: {yml_path}")
        sys.exit(1)

    run_command(
        f'conda env create -f "{yml_path}"',
        description=f"Creating environment from {yml_path}",
    )
    print("[OK] Conda environment created successfully!")


def install_conda_pack():
    """Install conda-pack if not available"""
    print("[INFO] Ensuring conda-pack is available...")

    # Try to install conda-pack in base environment
    try:
        run_command(
            "conda install conda-pack -c conda-forge -y",
            description="Installing conda-pack via conda",
        )
    except:
        print("[WARNING] Failed to install conda-pack via conda, trying pip...")
        try:
            run_command(
                "python -m pip install conda-pack",
                description="Installing conda-pack via pip",
            )
        except:
            print("[ERROR] Failed to install conda-pack. Please install it manually:")
            print("   conda install conda-pack -c conda-forge")
            print("   OR")
            print("   python -m pip install conda-pack")
            sys.exit(1)


def prune_environment():
    """Remove files that cause conda-unpack to fail but aren't needed at runtime."""
    import glob

    # tensorflow/include ships C++ development headers. They're listed in conda-pack's
    # file manifest but don't exist in the installed package, so conda-unpack trips over
    # them with FileNotFoundError. Remove before packing so they're never in the archive.
    result = subprocess.run(
        f"conda run -n {ENV_NAME} python -c \"import site; print(site.getsitepackages()[0])\"",
        shell=True, capture_output=True, text=True
    )
    if result.returncode != 0 or not result.stdout.strip():
        print("[WARNING] Could not determine site-packages path, skipping prune")
        return

    site_packages = Path(result.stdout.strip())
    tf_include = site_packages / "tensorflow" / "include"
    if tf_include.is_dir():
        n = sum(1 for _ in tf_include.rglob('*'))
        shutil.rmtree(tf_include)
        print(f"[OK] Removed {tf_include} ({n} files pruned)")
    else:
        print("[INFO] tensorflow/include not found, nothing to prune")


def pack_environment():
    """Pack the conda environment"""
    print("[INFO] Packing environment with conda-pack...")

    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    output_file = OUTPUT_DIR / f"{ENV_NAME}.tar.gz"

    # Remove existing packed environment
    if output_file.exists():
        output_file.unlink()
        print(f"Removed existing archive: {output_file}")

    # Pack the environment
    run_command(
        f'conda-pack -n {ENV_NAME} -o "{output_file}"',
        description="Packing environment",
    )

    print(f"[OK] Environment packed successfully: {output_file}")
    return output_file


def create_extraction_script(output_file):
    """Create bash script to extract and test the environment"""
    print("[INFO] Creating extraction script...")

    script_content = f"""#!/bin/bash
# Extract and test conda-pack environment

set -e

ENV_NAME="{ENV_NAME}"
ARCHIVE_PATH="$1"
EXTRACT_DIR="$2"

if [ -z "$ARCHIVE_PATH" ] || [ -z "$EXTRACT_DIR" ]; then
    echo "Usage: $0 <archive_path> <extract_dir>"
    echo "Example: $0 ./environments/{ENV_NAME}.tar.gz ./runtime_envs/{ENV_NAME}"
    exit 1
fi

echo "Extracting $ENV_NAME to $EXTRACT_DIR..."

# Create extraction directory
mkdir -p "$EXTRACT_DIR"

# Extract the environment
tar -xzf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"

# Fix up the environment (conda-pack requirement)
source "$EXTRACT_DIR/bin/activate"

# Cleanup prefixes (if conda-unpack exists)
if command -v conda-unpack &> /dev/null; then
    conda-unpack
fi

echo "Environment extracted successfully!"
echo "Python location: $EXTRACT_DIR/bin/python"

# Test the environment
echo "Testing Python environment..."
"$EXTRACT_DIR/bin/python" --version

echo "Testing key imports..."
"$EXTRACT_DIR/bin/python" -c "import torch; print(f'PyTorch version: {{torch.__version__}}')"
"$EXTRACT_DIR/bin/python" -c "import bioacoustics_model_zoo as bmz; print('Bioacoustics model zoo loaded successfully')" || echo "[WARNING] Bioacoustics model zoo not available (normal if not installed)"

echo "[OK] Environment is ready for use!"
echo "To use: $EXTRACT_DIR/bin/python your_script.py"
"""

    script_path = OUTPUT_DIR / "extract_and_test_env.sh"
    with open(script_path, "w") as f:
        f.write(script_content)

    # Make executable
    os.chmod(script_path, 0o755)

    print(f"[OK] Extraction script created: {script_path}")
    return script_path


def create_test_script():
    """Create Python test script for the packed environment"""
    print("[INFO] Creating test script...")

    test_content = '''#!/usr/bin/env python3
"""
Test script for conda-pack environment
Tests that all required packages are available
"""

import sys
import os

def test_imports():
    """Test importing required packages"""
    print("Testing imports...")
    
    try:
        import torch
        print(f"[OK] PyTorch {torch.__version__}")
    except ImportError as e:
        print(f"[ERROR] PyTorch: {e}")
        return False
    
    try:
        import numpy as np
        print(f"[OK] NumPy {np.__version__}")
    except ImportError as e:
        print(f"[ERROR] NumPy: {e}")
        return False
    
    try:
        import pandas as pd
        print(f"[OK] Pandas {pd.__version__}")
    except ImportError as e:
        print(f"[ERROR] Pandas: {e}")
        return False
    
    try:
        import librosa
        print(f"[OK] Librosa {librosa.__version__}")
    except ImportError as e:
        print(f"[ERROR] Librosa: {e}")
        return False
    
    try:
        import bioacoustics_model_zoo as bmz
        print("[OK] Bioacoustics model zoo")

        # Test loading a model
        try:
            model = bmz.HawkEars()
            print("[OK] HawkEars model loaded successfully")
        except Exception as model_error:
            print(f"[WARNING] HawkEars model test failed: {model_error}")
            # This is not critical for the environment test
        
    except ImportError as e:
        print(f"[ERROR] Bioacoustics model zoo: {e}")
        return False
    except Exception as e:
        print(f"[WARNING] Bioacoustics model zoo loaded but initialization failed: {e}")
        # This is not critical for the environment test
    
    return True

def main():
    print("[INFO] Testing conda-pack environment")
    print(f"Python version: {sys.version}")
    print(f"Python executable: {sys.executable}")
    
    if test_imports():
        print("\\n[OK] All tests passed! Environment is working correctly.")
        return 0
    else:
        print("\\n[ERROR] Some tests failed. Environment may not be complete.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
'''

    test_script_path = OUTPUT_DIR / "test_environment.py"
    with open(test_script_path, "w") as f:
        f.write(test_content)

    print(f"[OK] Test script created: {test_script_path}")
    return test_script_path


def main():
    """Main build function"""
    try:
        print("[INFO] Starting conda-pack environment build...")
        print(f"Project root: {PROJECT_ROOT}")
        print(f"Backend directory: {BACKEND_DIR}")
        print(f"Output directory: {OUTPUT_DIR}")

        # Check conda availability
        if not check_conda():
            sys.exit(1)

        # Install conda-pack if needed
        install_conda_pack()

        # Create conda environment
        create_conda_environment()

        # Remove files that break conda-unpack on end-user machines
        prune_environment()

        # Pack environment
        output_file = pack_environment()

        # Create helper scripts
        extract_script = create_extraction_script(output_file)
        test_script = create_test_script()

        print("\n[OK] Conda-pack environment built successfully!")
        print(f"Environment archive: {output_file}")
        print(f"Extraction script: {extract_script}")
        print(f"Test script: {test_script}")

        # Show file sizes
        if output_file.exists():
            size_bytes = output_file.stat().st_size
            size_mb = size_bytes / (1024 * 1024)
            print(f"Archive size: {size_mb:.1f} MB")

        print("\nUsage:")
        print(f"   Extract: {extract_script} {output_file} ./runtime_envs/{ENV_NAME}")
        print(f"   Test: ./runtime_envs/{ENV_NAME}/bin/python {test_script}")

    except Exception as error:
        print(f"[ERROR] Build failed: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
