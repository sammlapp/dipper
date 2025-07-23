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
        print(f"📋 {description}")

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
        print(f"❌ Command failed: {command}")
        print(f"Error: {e}")
        if e.stdout:
            print(f"Stdout: {e.stdout}")
        if e.stderr:
            print(f"Stderr: {e.stderr}")
        sys.exit(1)


def create_virtual_env():
    """Create virtual environment for PyInstaller"""
    print("🐍 Creating virtual environment for PyInstaller...")

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
    print("📦 Installing requirements...")
    run_command(f'"{pip_exe}" install --upgrade pip setuptools wheel')

    # Install requirements from file if it exists
    requirements_file = BACKEND_DIR / "requirements-lightweight.txt"
    run_command(f'"{pip_exe}" install -r {requirements_file}')

    return python_exe, pip_exe, pyinstaller_exe, venv_path


def build_with_pyinstaller(pyinstaller_exe, venv_path):
    """Build executable with PyInstaller"""
    print("🔨 Building executable with PyInstaller...")

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
        print("❌ PyInstaller spec file not found: http_server.spec")
        sys.exit(1)

    run_command(
        f'"{pyinstaller_exe}" --clean --noconfirm http_server.spec',
        description="Building with PyInstaller",
    )

    # Copy to frontend directory
    print("📁 Copying executable to frontend directory...")
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    # Copy lightweight server
    source_dist = BACKEND_DIR / "dist" / "lightweight_server"
    if source_dist.exists():
        shutil.copy2(source_dist, DIST_DIR / "lightweight_server")
        print("✅ Lightweight server executable copied successfully!")
    else:
        print("❌ Lightweight server executable not found in dist directory")
        sys.exit(1)


def main():
    """Main build function"""
    try:
        print("🚀 Starting PyInstaller build process...")
        print(f"Project root: {PROJECT_ROOT}")
        print(f"Backend directory: {BACKEND_DIR}")
        print(f"Frontend directory: {FRONTEND_DIR}")

        # Check if Python is available
        try:
            result = subprocess.run(
                ["python", "--version"], capture_output=True, text=True
            )
            print(f"✅ Python found: {result.stdout.strip()}")
        except FileNotFoundError:
            print("❌ Python not found. Please install Python 3.8 or higher.")
            sys.exit(1)

        # Create virtual environment and install dependencies
        python_exe, pip_exe, pyinstaller_exe, venv_path = create_virtual_env()

        # Build with PyInstaller
        build_with_pyinstaller(pyinstaller_exe, venv_path)

        print("\n✅ Python backend built successfully with PyInstaller!")
        print(f"📦 Executable location: {DIST_DIR}")

        # Show size information
        exe_path = DIST_DIR / "lightweight_server"
        if exe_path.exists():
            # Calculate total size
            total_size = sum(
                f.stat().st_size for f in exe_path.rglob("*") if f.is_file()
            )
            size_mb = total_size / (1024 * 1024)
            print(f"📊 Total size: {size_mb:.1f} MB")

    except Exception as error:
        print(f"❌ Build failed: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
