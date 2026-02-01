#!/usr/bin/env python3
"""
Build PyInstaller executable for lightweight_server.py
This replaces the JavaScript build script in frontend/build-scripts/
"""

import os
import sys
import shutil
import subprocess
from pathlib import Path

# Project paths
PROJECT_ROOT = Path(__file__).parent.parent
BACKEND_DIR = Path(__file__).parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
DIST_DIR = FRONTEND_DIR / "python-dist"


def run_command(command, cwd=None, description=None):
    """Run a command and handle errors"""
    if description:
        print(f"[INFO] {description}")

    print(f"Running: {command}")
    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=cwd or BACKEND_DIR,
            check=True,
            capture_output=True,
            text=True,
        )
        return result
    except subprocess.CalledProcessError as e:
        print(f"[ERROR] Command failed: {command}")
        print(f"Error: {e}")
        if e.stdout:
            print(f"Stdout: {e.stdout}")
        if e.stderr:
            print(f"Stderr: {e.stderr}")
        sys.exit(1)


def create_virtual_env():
    """Create virtual environment for PyInstaller"""
    print("[INFO] Creating virtual environment for PyInstaller...")

    venv_path = BACKEND_DIR / "pyinstaller-venv-light"

    # Clean up existing venv
    if venv_path.exists():
        print("Removing existing virtual environment...")
        shutil.rmtree(venv_path)

    # Create new venv
    run_command(
        "python -m venv pyinstaller-venv-light",
        description="Creating virtual environment",
    )

    # Determine paths based on OS
    if os.name == "nt":  # Windows
        python_exe = venv_path / "Scripts" / "python.exe"
        pip_exe = venv_path / "Scripts" / "pip.exe"
        pyinstaller_exe = venv_path / "Scripts" / "pyinstaller.exe"
    else:  # Unix-like
        python_exe = venv_path / "bin" / "python"
        pip_exe = venv_path / "bin" / "pip"
        pyinstaller_exe = venv_path / "bin" / "pyinstaller"

    # Install requirements
    print("[INFO] Installing requirements...")
    # Use python -m pip to avoid Windows file locking issues when upgrading pip
    run_command(f'"{python_exe}" -m pip install --upgrade pip setuptools wheel')

    # Install requirements from file if it exists
    requirements_file = BACKEND_DIR / "requirements-lightweight.txt"
    run_command(f'"{python_exe}" -m pip install -r {requirements_file}')

    return python_exe, pip_exe, pyinstaller_exe, venv_path


def get_tauri_platform_name():
    """Get the Tauri platform-specific binary name suffix"""
    import platform

    system = platform.system()
    machine = platform.machine().lower()

    if system == "Darwin":  # macOS
        if machine in ["arm64", "aarch64"]:
            return "aarch64-apple-darwin"
        else:
            return "x86_64-apple-darwin"
    elif system == "Windows":
        return "x86_64-pc-windows-msvc"
    elif system == "Linux":
        return "x86_64-unknown-linux-gnu"
    else:
        print(f"[WARNING] Unknown platform: {system} {machine}")
        return None


def build_with_pyinstaller(pyinstaller_exe, venv_path):
    """Build executable with PyInstaller"""
    print("[INFO] Building executable with PyInstaller...")

    # Clean previous builds
    build_dir = BACKEND_DIR / "build"
    dist_dir = BACKEND_DIR / "dist"

    if build_dir.exists():
        shutil.rmtree(build_dir)
    if dist_dir.exists():
        shutil.rmtree(dist_dir)

    # Build with PyInstaller using the spec file
    spec_file = BACKEND_DIR / "http_server.spec"
    if not spec_file.exists():
        print("[ERROR] PyInstaller spec file not found: http_server.spec")
        sys.exit(1)

    run_command(
        f'"{pyinstaller_exe}" --clean --noconfirm http_server.spec',
        description="Building with PyInstaller",
    )

    # Determine source and destination paths
    if os.name == "nt":  # Windows
        source_dist = BACKEND_DIR / "dist" / "lightweight_server.exe"
        python_dist_file = DIST_DIR / "lightweight_server.exe"
    else:  # Unix-like
        source_dist = BACKEND_DIR / "dist" / "lightweight_server"
        python_dist_file = DIST_DIR / "lightweight_server"

    if not source_dist.exists():
        print("[ERROR] Lightweight server executable not found in dist directory")
        print(f"   Expected location: {source_dist}")
        sys.exit(1)

    # Copy to frontend/python-dist directory (for backwards compatibility)
    print("[INFO] Copying executable to frontend/python-dist...")
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_dist, python_dist_file)
    print(f"[OK] Copied to: {python_dist_file}")

    # Copy to src-tauri/bin with platform-specific name (for Tauri sidecar)
    print("[INFO] Copying executable to src-tauri/bin for Tauri sidecar...")
    tauri_bin_dir = FRONTEND_DIR / "src-tauri" / "bin"
    tauri_bin_dir.mkdir(parents=True, exist_ok=True)

    platform_name = get_tauri_platform_name()
    if platform_name:
        if os.name == "nt":
            tauri_dest_file = tauri_bin_dir / f"lightweight_server-{platform_name}.exe"
        else:
            tauri_dest_file = tauri_bin_dir / f"lightweight_server-{platform_name}"

        shutil.copy2(source_dist, tauri_dest_file)
        # Make sure it's executable on Unix
        if os.name != "nt":
            os.chmod(tauri_dest_file, 0o755)
        print(f"[OK] Copied to: {tauri_dest_file}")
    else:
        print("[WARNING] Skipping Tauri bin copy (unknown platform)")

    print("[OK] Lightweight server executable copied successfully!")


def main():
    """Main build function"""
    try:
        print("[INFO] Starting PyInstaller build process...")
        print(f"Project root: {PROJECT_ROOT}")
        print(f"Backend directory: {BACKEND_DIR}")
        print(f"Frontend directory: {FRONTEND_DIR}")

        # Check if Python is available
        try:
            result = subprocess.run(
                ["python", "--version"], capture_output=True, text=True
            )
            print(f"[OK] Python found: {result.stdout.strip()}")
        except FileNotFoundError:
            print("[ERROR] Python not found. Please install Python 3.8 or higher.")
            sys.exit(1)

        # Create virtual environment and install dependencies
        python_exe, pip_exe, pyinstaller_exe, venv_path = create_virtual_env()

        # Build with PyInstaller
        build_with_pyinstaller(pyinstaller_exe, venv_path)

        print("\n[OK] Python backend built successfully with PyInstaller!")
        print(f"Executable locations:")
        print(f"   - python-dist: {DIST_DIR}")
        print(f"   - src-tauri/bin: {FRONTEND_DIR / 'src-tauri' / 'bin'}")

        # Show size information
        if os.name == "nt":
            exe_path = DIST_DIR / "lightweight_server.exe"
        else:
            exe_path = DIST_DIR / "lightweight_server"

        if exe_path.exists():
            # Get file size (single file, not directory)
            size_mb = exe_path.stat().st_size / (1024 * 1024)
            print(f"Executable size: {size_mb:.1f} MB")

    except Exception as error:
        print(f"[ERROR] Build failed: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
