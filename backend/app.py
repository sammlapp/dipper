#!/usr/bin/env python3
"""
The backend is a pyinstaller executable that exposes an API via aiohttp

This version excludes ML dependencies and uses lightweight libraries.

Heavy ML Tasks are run in background processes using a separate uv-managed
Python environment that is installed on demand from a bundled lockfile.
"""

import sys
import json
import argparse
import asyncio
import os
import tempfile
import logging
import base64
import subprocess
import threading
import shutil
import functools
import hashlib
import tomllib
import glob
import platform
import ssl
import certifi
import yaml
from pathlib import Path
from aiohttp import web, web_request
from aiohttp_cors import setup as cors_setup, ResourceOptions
import pandas as pd
import numpy as np
import soundfile as sf
import scipy.signal
from PIL import Image
from io import BytesIO

from scripts import scan_folder
from scripts import load_scores
from scripts import clip_extraction

import birdnames  # for taxonomy and naming conversions

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# XC recommends using an app-specific API key
# we could allow user to specify their own eventually if we get rate limited
try:
    from _secrets import XC_API_KEY
except ImportError:
    XC_API_KEY = os.environ.get("XC_DIPPER_API_KEY", "")

# Set up logging — stderr for dev, plus a rotating file in the user cache dir
import platformdirs as _platformdirs
from logging.handlers import RotatingFileHandler as _RotatingFileHandler

_log_dir = _platformdirs.user_log_dir("Dipper", "Dipper")
os.makedirs(_log_dir, exist_ok=True)
LOG_FILE_PATH = os.path.join(_log_dir, "dipper-backend.log")

_file_handler = _RotatingFileHandler(
    LOG_FILE_PATH, maxBytes=5 * 1024 * 1024, backupCount=2, encoding="utf-8"
)
_file_handler.setFormatter(
    logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
)
_stream_handler = logging.StreamHandler()
_stream_handler.setFormatter(
    logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
)
# Configure root logger directly — basicConfig is a no-op if any library
# has already added handlers, so we add ours explicitly.
_root = logging.getLogger()
_root.setLevel(logging.INFO)
_root.addHandler(_file_handler)
_root.addHandler(_stream_handler)
logger = logging.getLogger(__name__)
logger.info(f"Log file: {LOG_FILE_PATH}")

# SSL context using certifi's CA bundle — required in PyInstaller builds where
# the system cert store is not accessible from the bundled Python runtime.
SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())

common_to_sci = birdnames.Converter(
    from_type="common_name",
    to_type="scientific_name",
    soft_matching=True,
    fuzzy_matching=True,
)


def is_process_alive(pid):
    """
    Check if a process with given PID is still running.
    Cross-platform implementation for Windows, macOS, and Linux.

    Args:
        pid: Process ID to check

    Returns:
        True if process is alive, False otherwise
    """
    if pid is None or pid <= 0:
        return False

    system = platform.system()

    try:
        if system == "Windows":
            # On Windows, use tasklist command to check if process exists
            import ctypes

            kernel32 = ctypes.windll.kernel32
            PROCESS_QUERY_INFORMATION = 0x0400
            handle = kernel32.OpenProcess(PROCESS_QUERY_INFORMATION, 0, pid)
            if handle:
                kernel32.CloseHandle(handle)
                return True
            return False
        else:
            # On Unix-like systems (Linux, macOS), use os.kill with signal 0
            # Signal 0 doesn't actually send a signal, just checks if process exists
            os.kill(pid, 0)
            return True
    except (OSError, AttributeError, Exception):
        # OSError raised if process doesn't exist
        # AttributeError if ctypes not available
        return False


async def monitor_parent_process(parent_pid, shutdown_callback, check_interval=2.0):
    """
    Async task that monitors the parent process and triggers shutdown if parent dies.

    Args:
        parent_pid: PID of the parent process to monitor
        shutdown_callback: Async function to call when parent process dies
        check_interval: How often to check (in seconds)
    """
    logger.info(f"Starting parent process monitor (parent PID: {parent_pid})")
    logger.info(f"Checking parent process every {check_interval} seconds")

    check_count = 0
    while True:
        await asyncio.sleep(check_interval)
        check_count += 1

        is_alive = is_process_alive(parent_pid)
        if check_count <= 1:  # Log first check for debugging
            logger.info(
                f"Parent process check #{check_count}: PID {parent_pid} alive={is_alive}"
            )

        if not is_alive:
            logger.warning(f"Parent process (PID {parent_pid}) is no longer alive!")
            logger.info("Initiating graceful shutdown...")
            try:
                await shutdown_callback()
            except Exception as e:
                logger.error(f"Error during shutdown callback: {e}")
            logger.info("Shutdown callback completed, exiting monitor")
            break


def get_last_error_from_log(log_file_path, max_lines=10):
    """
    Read the last few lines from a log file to extract error information.
    Returns a brief error summary for display in the task panel.
    """
    if not log_file_path or not os.path.exists(log_file_path):
        return None

    try:
        with open(log_file_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()

        if not lines:
            return None

        # Get last few lines to look for errors
        last_lines = lines[-max_lines:] if len(lines) > max_lines else lines

        # Look for common error patterns
        error_keywords = [
            "ERROR",
            "Error",
            "error",
            "FAILED",
            "Failed",
            "failed",
            "Exception",
            "Traceback",
            "RuntimeError",
            "ValueError",
            "ImportError",
        ]

        error_lines = []
        for line in last_lines:
            line = line.strip()
            if any(keyword in line for keyword in error_keywords):
                error_lines.append(line)

        if error_lines:
            # Return the last error line, truncated if too long
            last_error = error_lines[-1]
            if len(last_error) > 150:
                last_error = last_error[:147] + "..."
            return last_error
        else:
            # If no explicit error found, return last non-empty line
            for line in reversed(last_lines):
                line = line.strip()
                if line and len(line) > 10:  # Skip very short lines
                    if len(line) > 150:
                        line = line[:147] + "..."
                    return line

    except Exception as e:
        logger.warning(f"Could not read log file {log_file_path}: {e}")
        return None

    return None


# Config Management Functions
def save_inference_config(config_data, output_path):
    """Save inference configuration to JSON file"""
    try:
        with open(output_path, "w") as f:
            json.dump(config_data, f, indent=2)
        return {"status": "success", "config_path": output_path}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def load_inference_config(config_path):
    """Load inference configuration from JSON file"""
    try:
        with open(config_path, "r") as f:
            config = json.load(f)
        return {"status": "success", "config": config}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def validate_audio_files(file_list):
    """Validate that audio files exist"""
    valid_extensions = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"}
    results = {"valid_files": [], "missing_files": [], "invalid_extensions": []}

    for file_path in file_list:
        if not os.path.exists(file_path):
            results["missing_files"].append(file_path)
        elif Path(file_path).suffix.lower() not in valid_extensions:
            results["invalid_extensions"].append(file_path)
        else:
            results["valid_files"].append(file_path)

    return results


# ML environment management
#
# The ML environment is a uv-managed virtual environment, created on first use from
# the bundled ml_env/pyproject.toml and ml_env/uv.lock. The lockfile pins every
# package (for both torch variants), so no dependency resolution happens on the
# user's machine, and uv downloads its own managed Python, so nothing needs to be
# installed on the system.

ML_PYTHON_VERSION = "3.13"

# The torch build is chosen at install time and maps to the `cpu` / `cuda` extras
# in ml_env/pyproject.toml.
TORCH_VARIANTS = ("cpu", "cuda")

# On-disk size (GB) of the installed environment per (OS, torch variant), measured
# in CI (`du -sh .venv` in test-uv-ml-env.yml). Used to show the expected size
# up front and to check free disk space. Re-measure when the lock changes.
ENV_SIZE_GB = {
    ("Darwin", "cpu"): 2.4,
    ("Windows", "cpu"): 2.8,
    ("Linux", "cpu"): 3.7,
    ("Windows", "cuda"): 6.5,
    ("Linux", "cuda"): 9.5,
}
# A fresh install needs this multiple of the environment size free (downloaded
# wheels are cached while they are installed).
INSTALL_DISK_MARGIN = 1.25
# Free space needed to update an existing environment in place (incremental).
UPDATE_MIN_FREE_GB = 2.0

# Hosts the installer downloads from, listed in connection error messages.
REQUIRED_HOSTS = (
    "pypi.org and files.pythonhosted.org (Python packages)",
    "download.pytorch.org (PyTorch)",
    "github.com and objects.githubusercontent.com (the Python download)",
)

# Environment variables users may set for the installer (proxy, mirrors,
# certificates), e.g. from Settings on locked-down networks. Everything else
# starting with UV_ is removed so a user's own uv setup can't change the install.
INSTALLER_ENV_ALLOWED = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "UV_DEFAULT_INDEX",
    "UV_INDEX",
    "UV_PYTHON_INSTALL_MIRROR",
    "UV_HTTP_TIMEOUT",
)


def get_default_env_cache_dir():
    """Get the default environment caching folder in system-specific cache directory"""
    return _platformdirs.user_cache_dir("Dipper", "Dipper")


def get_default_env_path():
    """Get the default environment path in system-specific cache directory"""
    return os.path.join(get_default_env_cache_dir(), "envs", "ml_env")


def _bundle_dir():
    """Directory holding bundled resources (PyInstaller bundle or source tree)."""
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


def get_uv_executable():
    """Path to the uv executable: bundled with the PyInstaller build, or from the
    `uv` package when running from source."""
    if getattr(sys, "frozen", False):
        uv_path = os.path.join(
            _bundle_dir(), "uv", "uv.exe" if os.name == "nt" else "uv"
        )
    else:
        try:
            from uv import find_uv_bin
        except ImportError as e:
            raise RuntimeError(
                "The 'uv' package is not installed in the backend's Python environment. "
                "Run: pip install -r backend/requirements-backend.txt"
            ) from e

        uv_path = find_uv_bin()
    if not os.path.isfile(uv_path):
        raise RuntimeError(f"uv executable not found at {uv_path}")
    return uv_path


def get_ml_project_dir():
    """Directory holding the ML environment's pyproject.toml and uv.lock."""
    project_dir = os.path.join(_bundle_dir(), "ml_env")
    for name in ("pyproject.toml", "uv.lock"):
        if not os.path.isfile(os.path.join(project_dir, name)):
            raise RuntimeError(
                f"ML environment definition missing: {project_dir}/{name}"
            )
    return project_dir


def query_nvidia_gpus():
    """Query the NVIDIA driver via nvidia-smi.

    Returns (gpu_names, driver_version, problem). `problem` explains why no GPU
    information is available (and gpu_names is then empty).
    """
    nvidia_smi = shutil.which("nvidia-smi")
    if nvidia_smi is None:
        return [], None, "no NVIDIA driver found (nvidia-smi not available)"
    result = subprocess.run(
        [nvidia_smi, "--query-gpu=name,driver_version", "--format=csv,noheader"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        return (
            [],
            None,
            f"nvidia-smi failed: {result.stderr.strip() or result.stdout.strip()}",
        )
    rows = [
        [field.strip() for field in line.split(",")]
        for line in result.stdout.splitlines()
        if line.strip()
    ]
    if not rows:
        return [], None, "nvidia-smi reported no GPUs"
    return [row[0] for row in rows], rows[0][1], None


def _parse_driver(version):
    """(major, minor) from an NVIDIA driver version string such as '570.26' or '560.35.03'."""
    parts = version.strip().split(".")
    if len(parts) < 2:
        raise ValueError(f"unrecognized driver version {version!r}")
    return int(parts[0]), int(parts[1])


@functools.lru_cache(maxsize=1)
def get_cuda_requirements():
    """(CUDA version, {OS: minimum driver (major, minor)}) for the bundled CUDA build.

    Read from [tool.dipper.cuda] in ml_env/pyproject.toml, which keeps them next to
    the torch pin and CUDA index they must match.
    """
    with open(os.path.join(get_ml_project_dir(), "pyproject.toml"), "rb") as f:
        cuda = tomllib.load(f)["tool"]["dipper"]["cuda"]
    min_driver = {
        "Linux": _parse_driver(cuda["min_driver"]["linux"]),
        "Windows": _parse_driver(cuda["min_driver"]["windows"]),
    }
    return cuda["version"], min_driver


def _check_driver(driver):
    """Whether an NVIDIA driver version supports the bundled CUDA build.

    Returns (usable, problem); `problem` explains why not.
    """
    cuda_version, min_driver = get_cuda_requirements()
    try:
        version = _parse_driver(driver)
    except ValueError:
        return False, f"could not read the NVIDIA driver version ({driver!r})"
    minimum = min_driver[platform.system()]
    if version < minimum:
        return False, (
            f"NVIDIA driver {driver} is older than the minimum "
            f"{'.'.join(map(str, minimum))} required for the CUDA {cuda_version} "
            "build; update the driver to enable GPU support"
        )
    return True, None


def detect_torch_variant():
    """Choose the torch build for this machine.

    Returns (variant, reason). 'cuda' only if an NVIDIA driver new enough for the
    bundled CUDA build is present; otherwise 'cpu'. macOS always uses 'cpu' (the
    standard PyTorch build, which includes Apple MPS support).
    """
    system = platform.system()
    if system == "Darwin":
        return "cpu", "macOS uses the standard PyTorch build (CPU and Apple MPS)"
    if system not in get_cuda_requirements()[1]:
        raise RuntimeError(f"Unsupported operating system: {system}")

    gpus, driver, problem = query_nvidia_gpus()
    if problem:
        return "cpu", problem
    usable, driver_problem = _check_driver(driver)
    if not usable:
        return "cpu", driver_problem
    return "cuda", f"NVIDIA driver {driver} supports the CUDA build"


def resolve_torch_variant(requested, env_check=None):
    """Resolve 'auto' / 'cpu' / 'cuda' to a concrete variant. Returns (variant, reason).

    When updating an installed environment, 'auto' keeps the installed build instead
    of re-detecting, so an update never silently switches between CPU and GPU.
    """
    if requested == "auto":
        if (
            env_check is not None
            and env_check["status"] == "outdated"
            and env_check.get("torch_variant")
        ):
            return env_check["torch_variant"], "keeping the installed build"
        return detect_torch_variant()
    if requested not in TORCH_VARIANTS:
        raise ValueError(
            f"Unknown torch variant {requested!r}; expected 'auto' or one of {TORCH_VARIANTS}"
        )
    return requested, "selected by user"


TORCH_PROBE_SCRIPT = """
import json, torch
available = torch.cuda.is_available()
arch_list = torch.cuda.get_arch_list() if available else []
devices = []
for i in range(torch.cuda.device_count() if available else 0):
    major, minor = torch.cuda.get_device_capability(i)
    arch = f"sm_{major}{minor}"
    devices.append({
        "name": torch.cuda.get_device_name(i),
        "arch": arch,
        # the build must contain kernels for this GPU's architecture
        "arch_supported": arch in arch_list,
    })
print(json.dumps({
    "torch_version": torch.__version__,
    "cuda_build": torch.version.cuda,
    "cuda_available": available,
    "cuda_arch_list": arch_list,
    "cuda_devices": devices,
    "mps_available": torch.backends.mps.is_available(),
}))
"""


def probe_torch_runtime(python_path):
    """Ask the ML environment's torch which accelerators it can actually use."""
    result = subprocess.run(
        [python_path, "-c", TORCH_PROBE_SCRIPT],
        capture_output=True,
        text=True,
        timeout=180,
        env=env_python_subprocess_env(),
    )
    if result.returncode != 0:
        raise RuntimeError(f"torch probe failed: {result.stderr[-500:]}")
    return json.loads(result.stdout.strip().splitlines()[-1])


def get_gpu_status():
    """Describe this machine's GPU and whether the installed ML environment can use it.

    Returns {"level": "ok" | "info" | "warning", "summary": str, "detail": str, ...}.
    Once the environment is installed, torch itself is asked whether it can use the
    GPU, so the answer reflects the real runtime and not just the hardware.
    """
    system = platform.system()
    env_check = check_environment(get_default_env_path())
    installed_variant = (
        env_check.get("torch_variant") if env_check["status"] == "ready" else None
    )
    probe = (
        probe_torch_runtime(env_check["python_path"])
        if env_check["status"] == "ready"
        else None
    )

    def status(level, summary, detail, **extra):
        return {
            "level": level,
            "summary": summary,
            "detail": detail,
            "installed_variant": installed_variant,
            **extra,
        }

    if system == "Darwin":
        if probe is None:
            return status(
                "info",
                "Apple GPU (Metal) is used if available",
                "The ML environment is not installed yet. The standard PyTorch build "
                "supports Apple Silicon GPUs (MPS).",
            )
        if probe["mps_available"]:
            return status(
                "ok",
                "Apple GPU (MPS) available",
                f"PyTorch {probe['torch_version']} can use the Apple GPU.",
            )
        return status(
            "info",
            "Apple GPU (MPS) not available",
            "PyTorch cannot use the Apple GPU on this machine (MPS requires Apple "
            "Silicon and a recent macOS). Tasks will run on the CPU.",
        )

    if system not in get_cuda_requirements()[1]:
        raise RuntimeError(f"Unsupported operating system: {system}")
    gpus, driver, problem = query_nvidia_gpus()
    gpu_names = ", ".join(gpus)
    hardware = {"gpus": gpus, "driver": driver}
    if problem:
        gpu_usable, hardware_problem = False, problem
    else:
        gpu_usable, hardware_problem = _check_driver(driver)

    if probe is None:
        if gpu_usable:
            return status(
                "ok",
                f"NVIDIA GPU detected: {gpu_names}",
                f"Driver {driver} supports GPU acceleration. The GPU build of the ML "
                "environment will be installed when using Auto-detect.",
                **hardware,
            )
        if gpus:
            return status(
                "warning",
                "NVIDIA GPU found, but its driver can't be used",
                hardware_problem,
                **hardware,
            )
        return status(
            "info",
            "No NVIDIA GPU detected",
            f"{hardware_problem}. Tasks will run on the CPU.",
            **hardware,
        )

    if probe["cuda_available"]:
        supported = [d for d in probe["cuda_devices"] if d["arch_supported"]]
        unsupported = [d for d in probe["cuda_devices"] if not d["arch_supported"]]
        if not supported:
            names = ", ".join(f"{d['name']} ({d['arch']})" for d in unsupported)
            return status(
                "warning",
                f"GPU not supported by the installed PyTorch build: {names}",
                f"PyTorch {probe['torch_version']} (CUDA {probe['cuda_build']}) was "
                f"built for GPU architectures {', '.join(probe['cuda_arch_list'])}, which "
                "does not include this GPU's architecture, so GPU tasks would fail. "
                "Tasks should be run on the CPU build.",
                **hardware,
            )
        note = (
            ""
            if not unsupported
            else " Not usable: "
            + ", ".join(f"{d['name']} ({d['arch']})" for d in unsupported)
            + "."
        )
        return status(
            "ok",
            f"GPU acceleration available: {', '.join(d['name'] for d in supported)}",
            f"PyTorch {probe['torch_version']} (CUDA {probe['cuda_build']}) can use "
            f"the GPU. NVIDIA driver {driver}.{note}",
            **hardware,
        )
    if installed_variant == "cpu" and gpu_usable:
        return status(
            "warning",
            f"GPU found ({gpu_names}), but the CPU-only PyTorch build is installed",
            "Tasks will run on the CPU. To use the GPU, remove the ML environment and "
            "install it again with the 'GPU (NVIDIA CUDA)' build.",
            **hardware,
        )
    if installed_variant == "cuda" and not gpus:
        return status(
            "warning",
            "GPU build installed, but no NVIDIA GPU was found",
            f"{hardware_problem}. Tasks will run on the CPU.",
            **hardware,
        )
    if not gpu_usable and gpus:
        return status(
            "warning",
            f"GPU found ({gpu_names}), but it can't be used",
            hardware_problem,
            **hardware,
        )
    if installed_variant == "cuda":
        return status(
            "warning",
            "GPU build installed, but PyTorch cannot use the GPU",
            f"NVIDIA driver {driver} and GPU {gpu_names} were detected, but "
            f"torch.cuda.is_available() is False (PyTorch {probe['torch_version']}, "
            f"CUDA {probe['cuda_build']}). Check the backend log for details.",
            **hardware,
        )
    return status(
        "info",
        "No NVIDIA GPU detected",
        f"{hardware_problem}. Tasks will run on the CPU.",
        **hardware,
    )


# Install state lives next to the environment directory, not inside it, because uv
# manages the contents of the environment directory.
def _install_status_path(env_path):
    return env_path + ".install_status"


def _torch_variant_path(env_path):
    return env_path + ".torch_variant"


def _lock_hash_path(env_path):
    return env_path + ".lock_hash"


def _lock_hash():
    """Hash of the bundled uv.lock: identifies which packages this Dipper expects."""
    with open(os.path.join(get_ml_project_dir(), "uv.lock"), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _read_text(path):
    try:
        with open(path, "r") as f:
            return f.read().strip()
    except FileNotFoundError:
        return None


def _write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


# Python interpreter variables that redirect which stdlib/site-packages an
# interpreter loads. Packaged launches (e.g. a Linux AppImage's AppRun) set these
# to point at their own bundled Python, and children inherit them, which breaks the
# environment's Python ("No module named 'encodings'").
_PYTHON_ENV_VARS = ("PYTHONHOME", "PYTHONPATH", "PYTHONUSERBASE", "PYTHONSTARTUP")


def env_python_subprocess_env():
    """Environment for subprocesses running the ML environment's Python.

    Inherits the current environment minus variables that would point the
    interpreter at a different Python installation.
    """
    return {k: v for k, v in os.environ.items() if k not in _PYTHON_ENV_VARS}


def _env_python_path(env_path):
    """Path to the python executable of an environment directory.

    Managed environments are venvs (bin/python, or Scripts/python.exe on Windows);
    user-selected custom environments may also be Windows conda envs (python.exe).
    """
    if os.name != "nt":
        return os.path.join(env_path, "bin", "python")
    venv_python = os.path.join(env_path, "Scripts", "python.exe")
    if os.path.exists(venv_python):
        return venv_python
    return os.path.join(env_path, "python.exe")


def check_environment(env_path):
    """Check whether a Python environment exists and is usable.

    The managed environment (the default path) must also have completed installation
    and match the bundled uv.lock. Statuses: ready, outdated (usable, but the lockfile
    changed since it was installed), installing, missing, broken, error.
    """
    try:
        managed = os.path.abspath(env_path) == os.path.abspath(get_default_env_path())
        if managed:
            install_status = _read_text(_install_status_path(env_path))
            if install_status == "in_progress":
                return {"status": "installing", "python_path": None}
            if install_status != "complete":
                return {"status": "missing", "python_path": None}

        python_path = _env_python_path(env_path)
        if not os.path.exists(python_path):
            if managed:
                return {
                    "status": "broken",
                    "error": "Python binary missing after install",
                }
            return {"status": "missing", "python_path": None}

        result = subprocess.run(
            [python_path, "--version"],
            capture_output=True,
            text=True,
            env=env_python_subprocess_env(),
        )
        if result.returncode != 0:
            return {
                "status": "broken",
                "error": f"Python check failed: {result.stderr}",
            }
        info = {
            "status": "ready",
            "python_path": python_path,
            "version": result.stdout.strip(),
        }
        if managed:
            info["torch_variant"] = _read_text(_torch_variant_path(env_path))
            # A new Dipper release may ship a different uv.lock; the installed
            # packages are then out of date even though the install completed.
            if _read_text(_lock_hash_path(env_path)) != _lock_hash():
                info["status"] = "outdated"
                info["message"] = (
                    "This version of Dipper needs different packages than the "
                    "installed ML environment. Update it from Settings."
                )
        return info

    except Exception as e:
        return {"status": "error", "error": str(e)}


def _uv_subprocess_env(env_dir, installer_env=None):
    """Environment for running uv: isolated from the user's own uv/venv settings,
    with uv's Python installs and package cache kept in Dipper's cache directory
    (on the same filesystem as the environment so installs can use hard links).

    installer_env: user-supplied overrides (proxy, mirrors, certificates), limited to
    INSTALLER_ENV_ALLOWED.
    """
    env = env_python_subprocess_env()
    for key in list(env):
        if key.startswith("UV_") or key == "VIRTUAL_ENV":
            del env[key]
    cache_dir = get_default_env_cache_dir()
    env["UV_PROJECT_ENVIRONMENT"] = env_dir
    env["UV_CACHE_DIR"] = os.path.join(cache_dir, "uv-cache")
    env["UV_PYTHON_INSTALL_DIR"] = os.path.join(cache_dir, "python")
    env.update(installer_env or {})
    return env


def validate_installer_env(installer_env):
    """Check user-supplied installer environment variables; returns them as a dict."""
    if not isinstance(installer_env, dict):
        raise ValueError("installer_env must be an object of NAME: value pairs")
    unknown = sorted(set(installer_env) - set(INSTALLER_ENV_ALLOWED))
    if unknown:
        raise ValueError(
            f"Not allowed as installer settings: {', '.join(unknown)}. "
            f"Allowed: {', '.join(INSTALLER_ENV_ALLOWED)}"
        )
    return {k: str(v) for k, v in installer_env.items()}


# (phrases in uv's output, explanation, whether it is a network/access problem)
_INSTALL_ERROR_PATTERNS = (
    (
        (
            "dns error",
            "failed to lookup address",
            "name or service not known",
            "no such host",
            "nodename nor servname",
        ),
        "Could not look up a download server's address (DNS error). Check your internet connection.",
        True,
    ),
    (
        (
            "invalid peer certificate",
            "unknownissuer",
            "certificate verify failed",
            "self-signed",
            "invalid certificate",
            "tls handshake",
        ),
        "A secure (TLS) connection could not be verified. This usually means a network "
        "proxy or firewall is intercepting HTTPS traffic with its own certificate.",
        True,
    ),
    (
        ("403 forbidden", "status code 403", "407 proxy", "proxy authentication"),
        "A download server refused the request (HTTP 403 or proxy authentication). "
        "This is usually a firewall or proxy restriction.",
        True,
    ),
    (
        ("404 not found", "status code 404"),
        "A package file is no longer available at its download address (HTTP 404). "
        "This version of Dipper may need an update.",
        False,
    ),
    (
        ("timed out", "timeout"),
        "A download timed out. Check your connection and try again.",
        True,
    ),
    (
        (
            "connection refused",
            "connection reset",
            "connection closed",
            "error sending request",
        ),
        "The connection to a download server failed.",
        True,
    ),
    (
        ("no space left on device", "os error 28", "not enough space", "disk full"),
        "The disk is full. Free some space and try again.",
        False,
    ),
    (
        ("permission denied", "access is denied"),
        "Permission was denied while writing files. Check that Dipper's cache "
        "directory is writable and not blocked by security software.",
        False,
    ),
)


def explain_install_error(output_lines, returncode):
    """Turn the tail of uv's output into a message a user can act on."""
    text = "\n".join(output_lines).lower()
    details = "\n".join(output_lines[-10:])
    for phrases, explanation, is_network in _INSTALL_ERROR_PATTERNS:
        if any(p in text for p in phrases):
            message = explanation
            if is_network:
                hosts = "\n".join(f"  - {h}" for h in REQUIRED_HOSTS)
                message += (
                    f"\n\nThe installer needs to reach:\n{hosts}\n"
                    "If your network blocks these or needs a proxy or mirror, ask your IT "
                    "administrator, or enter proxy/mirror settings under Settings > "
                    "ML Environment > Advanced network settings."
                )
            return f"{message}\n\nDetails:\n{details}"
    return f"uv sync exited with code {returncode}:\n{details}"


def _free_disk_gb(path):
    """Free space (GB) on the filesystem that will hold `path`."""
    probe = path
    while not os.path.exists(probe):
        probe = os.path.dirname(probe)
    return shutil.disk_usage(probe).free / 1e9


def plan_install(requested="auto"):
    """What installing the ML environment would do, for showing before it starts.

    Returns the torch variant, whether this is a fresh install, an update, or
    nothing to do, the expected disk size, and whether enough disk space is free.
    """
    env_dir = get_default_env_path()
    env_check = check_environment(env_dir)
    variant, reason = resolve_torch_variant(requested, env_check)

    if env_check["status"] == "ready" and env_check.get("torch_variant") == variant:
        mode = "up_to_date"
    elif env_check["status"] == "outdated" and env_check.get("torch_variant") == variant:
        mode = "update"
    else:
        mode = "install"

    size_gb = ENV_SIZE_GB[(platform.system(), variant)]
    required_gb = UPDATE_MIN_FREE_GB if mode == "update" else size_gb * INSTALL_DISK_MARGIN
    free_gb = _free_disk_gb(env_dir)
    return {
        "variant": variant,
        "reason": reason,
        "mode": mode,
        "estimated_size_gb": size_gb,
        "required_free_gb": round(required_gb, 1),
        "free_gb": round(free_gb, 1),
        "enough_space": mode == "up_to_date" or free_gb >= required_gb,
        "env_path": env_dir,
    }


def install_environment(env_dir, torch_variant, on_progress=None, installer_env=None):
    """Create or update the ML environment at env_dir from the bundled lockfile.

    Args:
        env_dir: environment directory (managed by uv)
        torch_variant: 'cpu' or 'cuda' (a concrete variant, see resolve_torch_variant)
        on_progress: optional callable receiving each line of uv's output
        installer_env: optional validated environment overrides for uv (proxy, mirror)
    """
    try:
        if torch_variant not in TORCH_VARIANTS:
            raise ValueError(f"Invalid torch variant {torch_variant!r}")
        uv = get_uv_executable()
        project_dir = get_ml_project_dir()

        # If interrupted mid-install, check_environment sees "in_progress" and refuses
        # to use the partial environment.
        _write_text(_install_status_path(env_dir), "in_progress")

        # --frozen: install exactly what uv.lock pins, with no resolution.
        # --no-config: ignore any uv configuration files on the user's machine.
        # --system-certs: trust the operating system's certificate store, so networks
        #   that intercept HTTPS with a corporate or university certificate work.
        cmd = [
            uv, "--no-config", "--system-certs", "--color", "never",
            "sync", "--frozen", "--no-progress",
            "--project", project_dir,
            "--python", ML_PYTHON_VERSION, "--managed-python",
            "--extra", torch_variant,
        ]  # fmt: skip
        logger.info(f"Installing ML environment ({torch_variant}) to {env_dir}")
        logger.info(f"Running: {' '.join(cmd)}")
        output_tail = []
        with subprocess.Popen(
            cmd,
            env=_uv_subprocess_env(env_dir, installer_env),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        ) as process:
            for line in process.stdout:
                line = line.rstrip()
                if not line:
                    continue
                logger.info(f"[uv] {line}")
                output_tail = (output_tail + [line])[-30:]
                if on_progress:
                    on_progress(line)
        returncode = process.returncode
        if returncode != 0:
            _write_text(_install_status_path(env_dir), "failed")
            error_msg = explain_install_error(output_tail, returncode)
            logger.error(error_msg)
            return {"status": "error", "error": error_msg}

        _write_text(_torch_variant_path(env_dir), torch_variant)
        _write_text(_lock_hash_path(env_dir), _lock_hash())
        _write_text(_install_status_path(env_dir), "complete")

        env_check = check_environment(env_dir)
        logger.info(f"Environment check result: {env_check}")
        if env_check["status"] != "ready":
            return {
                "status": "error",
                "error": f"Environment install failed: {env_check.get('error', env_check['status'])}",
            }
        return {
            "status": "success",
            "env_path": env_dir,
            "torch_variant": torch_variant,
        }

    except Exception as e:
        logger.error(f"Environment install failed: {e}")
        return {"status": "error", "error": str(e)}


def resolve_path(path_str, base_dir=None):
    """Resolve relative or absolute paths consistently"""
    if os.path.isabs(path_str):
        # Already absolute, use as-is
        return path_str
    else:
        # Relative path - resolve relative to base_dir or current working directory
        if base_dir:
            return os.path.join(base_dir, path_str)
        else:
            return os.path.abspath(path_str)


def env_not_ready_message(env_result):
    """Message for a task request when the ML environment can't be used."""
    if env_result["status"] == "outdated":
        return "The ML environment is out of date for this version of Dipper. Please update it from the Settings tab."
    return "ML environment is not installed. Please install it from the Settings tab."


def setup_environment(env_dir=None, torch_variant="auto"):
    """Set up environment - install if needed, check if ready

    Args:
        env_dir: Environment directory if using a custom Python environment
            if None, will use the built-in Dipper environment in application cache
            directory, installing it first if needed
        torch_variant: 'auto', 'cpu', or 'cuda'; only used when installing the
            built-in environment

    Returns:
        dict: Status and details about the environment setup
    """
    try:
        # If user provided custom environment path, use that environment
        if env_dir is not None:
            env_dir = resolve_path(env_dir)
            logger.info(f"Using custom environment path: {env_dir}")

            env_check = check_environment(env_dir)
            if env_check["status"] == "ready":
                return {
                    "status": "ready",
                    "python_path": env_check["python_path"],
                    "message": "Environment already ready",
                }
            return {
                "status": "error",
                "error": f"User-specified custom environment {env_dir} could not be used: {env_check.get('error', env_check['status'])}",
            }

        env_dir = get_default_env_path()
        logger.info(f"Using default environment path: {env_dir}")
        env_check = check_environment(env_dir)
        logger.info(f"Environment check result: {env_check}")
        if env_check["status"] == "ready":
            return {
                "status": "ready",
                "python_path": env_check["python_path"],
                "message": "Environment already ready",
            }

        variant, reason = resolve_torch_variant(torch_variant, env_check)
        logger.info(f"Installing ML environment: torch variant {variant} ({reason})")
        install_result = install_environment(env_dir, variant)
        if install_result["status"] != "success":
            return install_result
        final_check = check_environment(env_dir)
        return {
            "status": "ready",
            "python_path": final_check["python_path"],
            "message": f"Environment installed ({variant})",
        }

    except Exception as e:
        return {"status": "error", "error": str(e)}


# Process Management Functions
def start_inference_process(job_id, config_path, env_python_path):
    """Start inference process in background and return immediately"""
    try:
        # Resolve paths to absolute paths
        config_path = resolve_path(config_path)
        env_python_path = resolve_path(env_python_path)

        logger.info(f"Starting inference job {job_id} with config: {config_path}")
        logger.info(f"Using Python environment: {env_python_path}")

        # Verify environment exists
        if not os.path.exists(env_python_path):
            return {
                "status": "error",
                "error": f"Python environment not found: {env_python_path}",
            }

        # Verify config file exists
        if not os.path.exists(config_path):
            return {"status": "error", "error": f"Config file not found: {config_path}"}

        # Load config to get log file path and job folder
        log_file_path = None
        job_folder = None
        try:
            import json

            with open(config_path, "r") as f:
                config_data = json.load(f)
                log_file_path = config_data.get("log_file_path")
                job_folder = config_data.get("job_folder")
        except Exception as e:
            logger.warning(f"Could not read config data: {e}")

        # Run inference.py with the specified Python environment
        inference_script = os.path.join(
            os.path.dirname(__file__), "scripts", "inference.py"
        )
        cmd = [env_python_path, inference_script, "--config", config_path]

        logger.info(f"Running command: {' '.join(cmd)}")
        if log_file_path:
            logger.info(f"Redirecting output to: {log_file_path}")

        # Prepare output redirection
        if log_file_path:
            # Ensure the directory exists
            os.makedirs(os.path.dirname(log_file_path), exist_ok=True)
            # Open log file for writing or appending (append if resuming existing task)
            file_mode = "a" if os.path.exists(log_file_path) else "w"
            log_file = open(log_file_path, file_mode)
            stdout_target = log_file
            stderr_target = (
                subprocess.STDOUT
            )  # Redirect stderr to stdout (which goes to log file)
        else:
            # Fallback to PIPE if no log file specified
            stdout_target = subprocess.PIPE
            stderr_target = subprocess.PIPE

        # Start the process (non-blocking)
        process = subprocess.Popen(
            cmd,
            stdout=stdout_target,
            stderr=stderr_target,
            text=True,
            cwd=os.path.dirname(os.path.abspath(__file__)),
            env=env_python_subprocess_env(),
        )

        # Store log file handle with process if we opened one
        if log_file_path:
            process._log_file = log_file

        return {
            "status": "started",
            "job_id": job_id,
            "process": process,
            "system_pid": process.pid,
            "command": " ".join(cmd),
            "message": "Inference process started successfully",
            "log_file_path": log_file_path,
            "job_folder": job_folder,
        }

    except Exception as e:
        return {"status": "error", "error": str(e)}


def check_inference_status(process, job_info=None):
    """Check status of running inference process"""
    try:
        if process is None:
            return {"status": "error", "error": "No process to check"}

        # Check if process is still running
        return_code = process.poll()

        if return_code is None:
            status_response = {
                "status": "running",
                "message": "Inference process is initializing",
            }

            # Try to read detailed status from .status file
            if job_info and "job_folder" in job_info:
                status_file = os.path.join(job_info["job_folder"], ".status")
                logger.info(
                    f"[check_inference_status] Checking for status file: {status_file}"
                )
                if os.path.exists(status_file):
                    try:
                        with open(status_file, "r") as f:
                            status_data = json.load(f)
                            logger.info(
                                f"[check_inference_status] Read status file data: {status_data}"
                            )
                            # Merge status file data into response
                            if "stage" in status_data:
                                status_response["stage"] = status_data["stage"]
                            if "progress" in status_data:
                                status_response["progress"] = status_data["progress"]
                            if "message" in status_data:
                                status_response["message"] = status_data["message"]
                            if "metadata" in status_data:
                                status_response["metadata"] = status_data["metadata"]
                            logger.info(
                                f"[check_inference_status] Merged status response: {status_response}"
                            )
                    except Exception as e:
                        logger.warning(
                            f"[check_inference_status] Could not read status file: {e}"
                        )
                else:
                    logger.debug(
                        f"[check_inference_status] Status file does not exist yet: {status_file}"
                    )

            return status_response
        else:
            # Process has completed
            # Close log file if it was opened
            if hasattr(process, "_log_file"):
                try:
                    process._log_file.close()
                except:
                    pass

            # Get output - may be None if redirected to file
            stdout, stderr = process.communicate()

            logger.info(f"Inference process completed with exit code: {return_code}")
            if stdout:
                logger.info(f"Stdout: {stdout[:500]}...")  # Log first 500 chars
            if stderr:
                logger.error(f"Stderr: {stderr[:500]}...")  # Log first 500 chars

            # Check if job was cancelled before checking exit code
            if job_info and job_info.get("status") == "cancelled":
                return {
                    "status": "cancelled",
                    "message": "Inference was cancelled by user",
                    "exit_code": return_code,
                }
            elif return_code == 0:
                return {
                    "status": "completed",
                    "message": "Inference completed successfully",
                    "output": stdout or "Output redirected to log file",
                    "stdout": stdout or "Output redirected to log file",
                    "stderr": stderr if stderr else "",
                    "exit_code": return_code,
                }
            else:
                # Try to get the actual error from log file
                error_message = f"Inference failed with exit code {return_code}"
                log_file_path = None

                # Try to get log file path from job_info
                if job_info and "log_file_path" in job_info:
                    log_file_path = job_info["log_file_path"]

                # Try to get actual error from log file
                if log_file_path:
                    last_error = get_last_error_from_log(log_file_path)
                    if last_error:
                        error_message = (
                            f"{last_error} (see log file for full error message)"
                        )

                return {
                    "status": "failed",
                    "error": error_message,
                    "exit_code": return_code,
                    "stdout": stdout or "Output redirected to log file",
                    "stderr": stderr or "Error output redirected to log file",
                }

    except Exception as e:
        return {"status": "error", "error": str(e)}


def start_training_process(job_id, config_path, env_python_path):
    """Start training process in background and return immediately"""
    try:
        # Resolve paths to absolute paths
        config_path = resolve_path(config_path)
        env_python_path = resolve_path(env_python_path)

        logger.info(f"Starting training job {job_id} with config: {config_path}")
        logger.info(f"Using Python environment: {env_python_path}")

        # Verify environment exists
        if not os.path.exists(env_python_path):
            return {
                "status": "error",
                "error": f"Python environment not found: {env_python_path}",
            }

        # Verify config file exists
        if not os.path.exists(config_path):
            return {"status": "error", "error": f"Config file not found: {config_path}"}

        # Load config to get log file path and job folder
        log_file_path = None
        job_folder = None
        try:
            import json

            with open(config_path, "r") as f:
                config_data = json.load(f)
                log_file_path = config_data.get("log_file_path")
                job_folder = config_data.get("job_folder")
        except Exception as e:
            logger.warning(f"Could not read config data: {e}")

        # Run train_model.py with the specified Python environment
        training_script = os.path.join(
            os.path.dirname(__file__), "scripts", "train_model.py"
        )
        cmd = [env_python_path, training_script, "--config", config_path]

        logger.info(f"Running command: {' '.join(cmd)}")
        if log_file_path:
            logger.info(f"Redirecting output to: {log_file_path}")

        # Prepare output redirection
        if log_file_path:
            # Ensure the directory exists
            os.makedirs(os.path.dirname(log_file_path), exist_ok=True)
            # Open log file for writing or appending (append if resuming existing task)
            file_mode = "a" if os.path.exists(log_file_path) else "w"
            log_file = open(log_file_path, file_mode)
            stdout_target = log_file
            stderr_target = (
                subprocess.STDOUT
            )  # Redirect stderr to stdout (which goes to log file)
        else:
            # Fallback to PIPE if no log file specified
            stdout_target = subprocess.PIPE
            stderr_target = subprocess.PIPE

        # Start the process (non-blocking)
        process = subprocess.Popen(
            cmd,
            stdout=stdout_target,
            stderr=stderr_target,
            text=True,
            cwd=os.path.dirname(os.path.abspath(__file__)),
            env=env_python_subprocess_env(),
        )

        # Store log file handle with process if we opened one
        if log_file_path:
            process._log_file = log_file

        return {
            "status": "started",
            "job_id": job_id,
            "process": process,
            "system_pid": process.pid,
            "command": " ".join(cmd),
            "message": "Training process started successfully",
            "log_file_path": log_file_path,
            "job_folder": job_folder,
        }

    except Exception as e:
        return {"status": "error", "error": str(e)}


def start_extraction_process(job_id, config_path, env_python_path):
    """Start extraction process in background and return immediately"""
    try:
        # Resolve paths to absolute paths
        config_path = resolve_path(config_path)
        env_python_path = resolve_path(env_python_path)

        logger.info(f"Starting extraction job {job_id} with config: {config_path}")
        logger.info(f"Using Python environment: {env_python_path}")

        # Verify environment exists
        if not os.path.exists(env_python_path):
            return {
                "status": "error",
                "error": f"Python environment not found: {env_python_path}",
            }

        # Verify config file exists
        if not os.path.exists(config_path):
            return {"status": "error", "error": f"Config file not found: {config_path}"}

        # Load config to get log file path and job folder
        log_file_path = None
        job_folder = None
        try:
            import json

            with open(config_path, "r") as f:
                config_data = json.load(f)
                log_file_path = config_data.get("log_file_path")
                job_folder = config_data.get("job_folder")
        except Exception as e:
            logger.warning(f"Could not read config data: {e}")

        # Run clip_extraction.py with the specified Python environment
        extraction_script = os.path.join(
            os.path.dirname(__file__), "scripts", "clip_extraction.py"
        )
        cmd = [env_python_path, extraction_script, config_path]

        logger.info(f"Running command: {' '.join(cmd)}")
        if log_file_path:
            logger.info(f"Redirecting output to: {log_file_path}")

        # Prepare output redirection
        if log_file_path:
            # Ensure the directory exists
            os.makedirs(os.path.dirname(log_file_path), exist_ok=True)
            # Open log file for writing or appending (append if resuming existing task)
            file_mode = "a" if os.path.exists(log_file_path) else "w"
            log_file = open(log_file_path, file_mode)
            stdout_target = log_file
            stderr_target = (
                subprocess.STDOUT
            )  # Redirect stderr to stdout (which goes to log file)
        else:
            # Fallback to PIPE if no log file specified
            stdout_target = subprocess.PIPE
            stderr_target = subprocess.PIPE

        # Start the process (non-blocking)
        process = subprocess.Popen(
            cmd,
            stdout=stdout_target,
            stderr=stderr_target,
            text=True,
            cwd=os.path.dirname(os.path.abspath(__file__)),
            env=env_python_subprocess_env(),
        )

        # Store log file handle with process if we opened one
        if log_file_path:
            process._log_file = log_file

        return {
            "status": "started",
            "job_id": job_id,
            "process": process,
            "system_pid": process.pid,
            "command": " ".join(cmd),
            "message": "Extraction process started successfully",
            "log_file_path": log_file_path,
            "job_folder": job_folder,
        }

    except Exception as e:
        return {"status": "error", "error": str(e)}


def check_training_status(process, job_info=None):
    """Check status of running training process"""
    try:
        if process is None:
            return {"status": "error", "error": "No process to check"}

        # Check if process is still running
        return_code = process.poll()

        if return_code is None:
            # Process is still running
            status_response = {
                "status": "running",
                "message": "Training process is still running",
            }

            # Try to read detailed status from .status file
            if job_info and "job_folder" in job_info:
                status_file = os.path.join(job_info["job_folder"], ".status")
                if os.path.exists(status_file):
                    try:
                        with open(status_file, "r") as f:
                            status_data = json.load(f)
                            # Merge status file data into response
                            if "stage" in status_data:
                                status_response["stage"] = status_data["stage"]
                            if "progress" in status_data:
                                status_response["progress"] = status_data["progress"]
                            if "message" in status_data:
                                status_response["message"] = status_data["message"]
                            if "metadata" in status_data:
                                status_response["metadata"] = status_data["metadata"]
                    except Exception as e:
                        logger.debug(f"Could not read status file: {e}")

            return status_response
        else:
            # Process has completed
            # Close log file if it was opened
            if hasattr(process, "_log_file"):
                try:
                    process._log_file.close()
                except:
                    pass

            # Get output - may be None if redirected to file
            stdout, stderr = process.communicate()

            logger.info(f"Training process completed with exit code: {return_code}")
            if stdout:
                logger.info(f"Stdout: {stdout[:500]}...")  # Log first 500 chars
            if stderr:
                logger.error(f"Stderr: {stderr[:500]}...")  # Log first 500 chars

            # Check if job was cancelled before checking exit code
            if job_info and job_info.get("status") == "cancelled":
                return {
                    "status": "cancelled",
                    "message": "Training was cancelled by user",
                    "exit_code": return_code,
                }
            elif return_code == 0:
                return {
                    "status": "completed",
                    "message": "Training completed successfully",
                    "output": stdout or "Output redirected to log file",
                    "stdout": stdout or "Output redirected to log file",
                    "stderr": stderr if stderr else "",
                    "exit_code": return_code,
                }
            else:
                # Try to get the actual error from log file
                error_message = f"Training failed with exit code {return_code}"
                log_file_path = None

                # Try to get log file path from job_info
                if job_info and "log_file_path" in job_info:
                    log_file_path = job_info["log_file_path"]

                # Try to get actual error from log file
                if log_file_path:
                    last_error = get_last_error_from_log(log_file_path)
                    if last_error:
                        error_message = (
                            f"{last_error} (see log file for full error message)"
                        )

                return {
                    "status": "failed",
                    "error": error_message,
                    "exit_code": return_code,
                    "stdout": stdout or "Output redirected to log file",
                    "stderr": stderr or "Error output redirected to log file",
                }

    except Exception as e:
        return {"status": "error", "error": str(e)}


def check_extraction_status(process, job_info=None):
    """Check status of running extraction process"""
    try:
        if process is None:
            return {"status": "error", "error": "No process to check"}

        # Check if process is still running
        return_code = process.poll()

        if return_code is None:
            # Process is still running
            status_response = {
                "status": "running",
                "message": "Extraction process is still running",
            }

            # Try to read detailed status from .status file
            if job_info and "job_folder" in job_info:
                status_file = os.path.join(job_info["job_folder"], ".status")
                if os.path.exists(status_file):
                    try:
                        with open(status_file, "r") as f:
                            status_data = json.load(f)
                            # Merge status file data into response
                            if "stage" in status_data:
                                status_response["stage"] = status_data["stage"]
                            if "progress" in status_data:
                                status_response["progress"] = status_data["progress"]
                            if "message" in status_data:
                                status_response["message"] = status_data["message"]
                            if "metadata" in status_data:
                                status_response["metadata"] = status_data["metadata"]
                    except Exception as e:
                        logger.debug(f"Could not read status file: {e}")

            return status_response
        else:
            # Process has completed
            # Close log file if it was opened
            if hasattr(process, "_log_file"):
                try:
                    process._log_file.close()
                except:
                    pass

            # Get output - may be None if redirected to file
            stdout, stderr = process.communicate()

            logger.info(f"Extraction process completed with exit code: {return_code}")
            if stdout:
                logger.info(f"Stdout: {stdout[:500]}...")  # Log first 500 chars
            if stderr:
                logger.error(f"Stderr: {stderr[:500]}...")  # Log first 500 chars

            # Check if job was cancelled before checking exit code
            if job_info and job_info.get("status") == "cancelled":
                return {
                    "status": "cancelled",
                    "message": "Extraction was cancelled by user",
                    "exit_code": return_code,
                }
            elif return_code == 0:
                # Try to parse extraction files from stdout if available
                extraction_files = []
                if stdout and "SUCCESS:" in stdout:
                    # Extract any created files info from stdout
                    try:
                        lines = stdout.split("\n")
                        for line in lines:
                            if "extraction_task_" in line and ".csv" in line:
                                extraction_files.append(line.strip())
                    except:
                        pass

                return {
                    "status": "completed",
                    "message": "Extraction completed successfully",
                    "output": stdout or "Output redirected to log file",
                    "stdout": stdout or "Output redirected to log file",
                    "stderr": stderr if stderr else "",
                    "exit_code": return_code,
                    "extraction_files": extraction_files,
                }
            else:
                # Try to get the actual error from log file
                error_message = f"Extraction failed with exit code {return_code}"
                log_file_path = None

                # Try to get log file path from job_info
                if job_info and "log_file_path" in job_info:
                    log_file_path = job_info["log_file_path"]

                # Try to get actual error from log file
                if log_file_path:
                    last_error = get_last_error_from_log(log_file_path)
                    if last_error:
                        error_message = (
                            f"{last_error} (see log file for full error message)"
                        )

                return {
                    "status": "failed",
                    "error": error_message,
                    "exit_code": return_code,
                    "stdout": stdout or "Output redirected to log file",
                    "stderr": stderr or "Error output redirected to log file",
                }

    except Exception as e:
        return {"status": "error", "error": str(e)}


def spec_to_image(spectrogram, range=None, colormap=None, channels=3, shape=None):
    """Convert spectrogram to image array (fast version)"""
    # Apply range if specified
    if range is not None:
        spectrogram = np.clip(spectrogram, range[0], range[1])
        spectrogram = (spectrogram - range[0]) / (range[1] - range[0])
    else:
        spec_min, spec_max = np.min(spectrogram), np.max(spectrogram)
        if spec_max > spec_min:
            spectrogram = (spectrogram - spec_min) / (spec_max - spec_min)

    # Flip vertically (higher frequencies at top)
    spectrogram = np.flipud(spectrogram)

    # Apply colormap efficiently
    if colormap == "greys_r":
        if channels == 1:
            img_array = 1.0 - spectrogram  # Invert
        else:
            inverted = 1.0 - spectrogram
            img_array = np.stack([inverted] * 3, axis=-1)
    else:
        if channels == 1:  # greyscale
            img_array = spectrogram
        else:
            # apply matplotlib colormap
            import matplotlib.pyplot as plt

            cmap = plt.get_cmap(colormap)
            img_array = cmap(spectrogram)[:, :, :3]  # Drop alpha channel

    # Resize if shape is specified
    if shape is not None:
        from scipy.ndimage import zoom

        zoom_factors = (shape[0] / img_array.shape[0], shape[1] / img_array.shape[1])
        if len(img_array.shape) == 3:
            zoom_factors = zoom_factors + (1,)
        img_array = zoom(img_array, zoom_factors, order=1)

    # Convert to 0-255 uint8
    img_array = (img_array * 255).astype(np.uint8)
    return img_array


def load_audio(file_path, sr=None, offset=0.0, duration=None):
    """Load audio file segment with soundfile and return samples and sample rate"""
    with sf.SoundFile(file_path) as f:
        sr = f.samplerate
        start_frame = int(offset * sr)
        num_frames = int(duration * sr)
        file_duration = f.frames / f.samplerate
        if start_frame >= f.frames:
            raise ValueError(
                f"Clip time out of bounds: start_time={offset:.3f}s is beyond the audio file "
                f"duration ({file_duration:.3f}s). Check that the 'start_time' and 'end_time' "
                f"columns in your CSV are in seconds relative to the start of each audio file."
            )
        f.seek(start_frame)
        samples = f.read(num_frames, dtype="float32", always_2d=False)

    if samples.ndim > 1:
        samples = samples.mean(axis=1)

    return samples, sr


def process_single_clip(clip_data, settings):
    """Process a single clip with optimized performance (adapted from create_audio_clips_batch.py)"""
    try:
        file_path = clip_data["file_path"]
        start_time = clip_data["start_time"]
        end_time = clip_data["end_time"]
        duration = end_time - start_time

        samples, sr = load_audio(
            file_path, sr=None, offset=start_time, duration=duration
        )

        # if start time was <0 or end time was > audio duration, librosa will return available audio
        # we want to pad with zeros to ensure consistent length for display
        expected_length = int(duration * sr)
        # pad front with zeros if start_time < 0
        if start_time < 0:
            pad_length = int(-start_time * sr)
            samples = np.concatenate((np.zeros(pad_length), samples))

        # pad end with zeros if end_time > audio duration
        if len(samples) < expected_length:
            pad_length = expected_length - len(samples)
            samples = np.concatenate((samples, np.zeros(pad_length)))

        # Normalize audio if requested
        if settings.get("normalize_audio", False):
            samples = samples / (np.max(np.abs(samples)) + 1e-8)

        # Create spectrogram
        frequencies, _, spectrogram = scipy.signal.spectrogram(
            x=samples,
            fs=sr,
            nperseg=int(settings.get("spec_window_size", 512)),
            noverlap=int(settings.get("spec_window_size", 512) * 0.5),
            nfft=int(settings.get("spec_window_size", 512)),
        )

        # Convert to decibels
        spectrogram = 10 * np.log10(
            spectrogram,
            where=spectrogram > 0,
            out=np.full(spectrogram.shape, -np.inf),
        )

        # Apply bandpass filter if requested (frequency cropping)
        if settings.get("use_bandpass", False):
            bandpass_range = settings.get("bandpass_range", [0, 10000])
            lowest_index = np.abs(frequencies - bandpass_range[0]).argmin()
            highest_index = np.abs(frequencies - bandpass_range[1]).argmin()
            spectrogram = spectrogram[lowest_index : highest_index + 1, :]
            frequencies = frequencies[lowest_index : highest_index + 1]

        # Show reference frequency line if requested (after bandpass filtering)
        if settings.get("show_reference_frequency", False):
            ref_freq = settings.get("reference_frequency", 1000)
            # Only add reference line if frequency is within the current range
            if frequencies.min() <= ref_freq <= frequencies.max():
                closest_index = np.abs(frequencies - ref_freq).argmin()
                db_range = settings.get("dB_range", [-80, -20])
                # Make the reference line very prominent
                spectrogram[closest_index, :] = db_range[1]
                logger.info(
                    f"Added reference line at {ref_freq}Hz (index {closest_index})"
                )
            else:
                logger.warning(
                    f"Reference frequency {ref_freq}Hz is outside frequency range {frequencies.min()}-{frequencies.max()}Hz"
                )

        # Convert spectrogram to image array
        colormap = settings.get("spectrogram_colormap", "greys_r")
        img_array = spec_to_image(
            spectrogram,
            range=settings.get("dB_range", [-80, -20]),
            colormap=colormap,
            channels=1 if colormap in ["greys", "greys_r"] else 3,
            shape=(
                (settings.get("image_height", 224), settings.get("image_width", 224))
                if settings.get("resize_images", True)
                else None
            ),
        )

        # Create audio buffer (in-memory WAV)
        audio_buffer = BytesIO()
        sf.write(audio_buffer, samples, sr, format="WAV")
        audio_buffer.seek(0)
        audio_base64 = base64.b64encode(audio_buffer.read()).decode("utf-8")

        # Create spectrogram image buffer (in-memory PNG)
        img_buffer = BytesIO()

        # Convert numpy array to PIL Image for faster processing
        if len(img_array.shape) == 2:
            pil_image = Image.fromarray(img_array, mode="L")
        else:
            pil_image = Image.fromarray(img_array.astype(np.uint8))

        # Save to buffer as PNG with optimization
        pil_image.save(img_buffer, format="PNG", optimize=True, compress_level=6)
        img_buffer.seek(0)
        spectrogram_base64 = base64.b64encode(img_buffer.read()).decode("utf-8")

        return {
            "clip_id": clip_data.get("clip_id", f"{file_path}_{start_time}_{end_time}"),
            "file_path": file_path,
            "start_time": start_time,
            "end_time": end_time,
            "status": "success",
            "audio_base64": audio_base64,
            "spectrogram_base64": spectrogram_base64,
            "duration": duration,
            "sample_rate": int(sr),
            "frequency_range": [float(frequencies.min()), float(frequencies.max())],
            "time_range": [float(start_time), float(end_time)],
        }

    except Exception as e:
        logger.error(f"Error processing clip {clip_data}: {e}")
        return {
            "clip_id": clip_data.get(
                "clip_id",
                f"{clip_data.get('file_path', 'unknown')}_{clip_data.get('start_time', 0)}_{clip_data.get('end_time', 0)}",
            ),
            "file_path": clip_data.get("file_path"),
            "start_time": clip_data.get("start_time"),
            "end_time": clip_data.get("end_time"),
            "status": "error",
            "error": str(e),
        }


def _get_scripts_path():
    """
    Get the path to the scripts directory.
    Works both in development (normal Python) and when bundled with PyInstaller.
    """
    if getattr(sys, "frozen", False):
        # Running in PyInstaller bundle
        base_path = sys._MEIPASS
    else:
        # Running in normal Python
        base_path = os.path.dirname(__file__)

    return os.path.join(base_path, "scripts")


class DipperServer:
    def __init__(self, port=8000, host="localhost"):
        self.port = port
        self.host = host
        # Increase max request body size to 100MB for large annotation files
        self.app = web.Application(client_max_size=100 * 1024 * 1024)
        self.running_jobs = (
            {}
        )  # Track running inference jobs: {job_id: {process, task, status, result}}
        # Background env install state: idle | downloading | extracting | ready | error
        self._env_install_state = {"stage": "idle", "message": "", "error": None}
        self.setup_routes()
        self.setup_cors()

    def json_response_with_nan_handling(self, data, **kwargs):
        """Create JSON response with proper NaN handling"""
        import json
        import math

        def convert_nan(obj):
            if isinstance(obj, dict):
                return {key: convert_nan(value) for key, value in obj.items()}
            elif isinstance(obj, list):
                return [convert_nan(item) for item in obj]
            elif isinstance(obj, float) and math.isnan(obj):
                return None
            else:
                return obj

        clean_data = convert_nan(data)
        return web.json_response(clean_data, **kwargs)

    def setup_cors(self):
        """Setup CORS for frontend communication"""
        cors = cors_setup(
            self.app,
            defaults={
                "*": ResourceOptions(
                    allow_credentials=True,
                    expose_headers="*",
                    allow_headers="*",
                    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                )
            },
        )

        # Add CORS to all routes
        for route in list(self.app.router.routes()):
            cors.add(route)

    def setup_routes(self):
        """Setup HTTP routes"""
        self.app.router.add_get("/", self.root_handler)
        self.app.router.add_get("/health", self.health_check)
        self.app.router.add_post("/scan_folder", self.scan_folder)
        self.app.router.add_post("/load_scores", self.load_scores)
        self.app.router.add_get("/clip", self.clip_single)
        self.app.router.add_post("/clips/batch", self.clips_batch)
        self.app.router.add_delete("/cache", self.clear_cache)

        # System info routes
        self.app.router.add_get("/system/tempdir", self.get_temp_dir)

        # New config and process management routes
        self.app.router.add_post("/config/save", self.save_config)
        self.app.router.add_post("/config/load", self.load_config)
        self.app.router.add_post("/config/validate", self.validate_config)
        self.app.router.add_post("/env/check", self.check_env)
        self.app.router.add_post("/env/setup", self.setup_env)
        self.app.router.add_post("/env/install", self.install_env)
        self.app.router.add_get("/env/install/status", self.install_env_status)
        self.app.router.add_post("/env/remove", self.remove_env)
        self.app.router.add_get("/env/gpu", self.env_gpu)
        self.app.router.add_get("/env/plan", self.env_plan)
        self.app.router.add_post("/inference/run", self.run_inference)
        self.app.router.add_get("/inference/status/{job_id}", self.get_inference_status)
        self.app.router.add_post("/inference/cancel/{job_id}", self.cancel_inference)
        self.app.router.add_post(
            "/geomodel/species_list", self.get_geomodel_species_list
        )
        self.app.router.add_post(
            "/geomodel/classifier_labels", self.get_classifier_labels
        )

        # Training routes
        self.app.router.add_post("/training/run", self.run_training)
        self.app.router.add_get("/training/status/{job_id}", self.get_training_status)
        self.app.router.add_post("/training/cancel/{job_id}", self.cancel_training)

        # Extraction routes
        self.app.router.add_post(
            "/extraction/scan-predictions", self.scan_predictions_folder
        )
        self.app.router.add_post("/review/load-task", self.load_review_task)
        self.app.router.add_post("/extraction/run", self.run_extraction)
        self.app.router.add_post("/extraction/run-inline", self.run_extraction_inline)
        self.app.router.add_get(
            "/extraction/status/{job_id}", self.get_extraction_status
        )
        self.app.router.add_post("/extraction/cancel/{job_id}", self.cancel_extraction)

        # File counting routes
        self.app.router.add_post("/files/count-glob", self.count_files_glob)
        self.app.router.add_post("/files/count-list", self.count_files_list)
        self.app.router.add_post("/files/get-csv-columns", self.get_csv_columns)
        self.app.router.add_post("/files/count-rows", self.count_file_rows)

        # Server mode file browsing routes
        self.app.router.add_post("/files/browse", self.browse_files)
        self.app.router.add_post("/files/save", self.save_file_server)
        self.app.router.add_post("/files/read", self.read_file_server)
        self.app.router.add_post("/files/unique-name", self.generate_unique_name)
        self.app.router.add_get("/files/download", self.download_file)

        # SongSpace routes
        self.app.router.add_post("/songspace/open", self.songspace_open)
        self.app.router.add_post("/songspace/create", self.songspace_create)
        self.app.router.add_post("/songspace/info", self.songspace_info)
        self.app.router.add_post("/songspace/ingest", self.songspace_ingest)
        self.app.router.add_post(
            "/songspace/fit-classifier", self.songspace_fit_classifier
        )
        self.app.router.add_post("/songspace/predict", self.songspace_predict)
        self.app.router.add_post(
            "/songspace/similarity-search", self.songspace_similarity_search
        )
        self.app.router.add_post(
            "/songspace/dataset-samples", self.songspace_dataset_samples
        )

        self.app.router.add_get("/xeno-canto/search", self.xeno_canto_search)
        self.app.router.add_get("/xeno-canto/clip", self.xeno_canto_clip)
        self.app.router.add_get("/memory", self.memory_stats)
        self.app.router.add_get("/debug/log", self.download_debug_log)

    async def xeno_canto_search(self, request):
        """Proxy Xeno-Canto API v3 search."""
        import aiohttp as aiohttp_client

        params = request.query
        genus = params.get("genus", "").strip()
        species = params.get("species", "").strip()
        english_name = params.get("en", "").strip()
        rec_type = params.get("type", "").strip()
        quality = params.get("quality", "").strip()
        page = params.get("page", "1")
        per_page = params.get("per_page", "100")

        # Build v3 query using search tags
        query_parts = []
        if english_name:
            # try converting bird name to scientific with fuzzy matching
            try:
                gen, sp = common_to_sci.convert(english_name).split(" ")
                query_parts.append(f"gen:{gen}")
                query_parts.append(f"sp:{sp}")
            except:  # not found / might be non bird species, pass en name to xc query
                query_parts.append(f'en:"={english_name}"')
        else:
            if genus:
                query_parts.append(f"gen:{genus}")
            if species:
                query_parts.append(f"sp:{species}")
        if rec_type:
            # Multi-word types need quoting
            if " " in rec_type:
                query_parts.append(f'type:"{rec_type}"')
            else:
                query_parts.append(f"type:{rec_type}")
        if quality:
            # Frontend sends either a single grade ("A"), a ">X" threshold (">B"),
            # or nothing. Emit as a single q: tag, quoting if it contains operators.
            q = quality.strip()
            if q.startswith(">"):
                query_parts.append(f'q:"{q}"')
            elif q:
                query_parts.append(f"q:{q}")

        if not query_parts:
            return web.json_response({"error": "No query specified"}, status=400)

        xc_query = " ".join(query_parts)
        logger.info(f"XC query: {xc_query!r}")
        url = "https://xeno-canto.org/api/3/recordings"
        try:
            async with aiohttp_client.ClientSession() as session:
                async with session.get(
                    url,
                    params={
                        "query": xc_query,
                        "key": XC_API_KEY,
                        "page": page,
                        "per_page": per_page,
                    },
                    timeout=aiohttp_client.ClientTimeout(total=15),
                    ssl=SSL_CONTEXT,
                ) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        return web.json_response(
                            {
                                "error": f"XC API returned {resp.status}",
                                "detail": body[:300],
                            },
                            status=502,
                        )
                    data = await resp.json(content_type=None)
                    return web.json_response(data)
        except Exception as e:
            logger.error(f"XC search error: {e}")
            return web.json_response({"error": str(e)}, status=502)

    async def xeno_canto_clip(self, request):
        """Fetch a XC recording URL, trim to first 6 s, return spectrogram+audio base64."""
        import aiohttp as aiohttp_client

        params = request.query
        audio_url = params.get("url", "")
        if not audio_url:
            return web.json_response({"error": "url parameter required"}, status=400)

        settings = {
            "spec_window_size": int(params.get("spec_window_size", 512)),
            "spectrogram_colormap": params.get("spectrogram_colormap", "greys_r"),
            "dB_range": json.loads(params.get("dB_range", "[-80, -20]")),
            "use_bandpass": params.get("use_bandpass", "false").lower() == "true",
            "bandpass_range": json.loads(params.get("bandpass_range", "[500, 8000]")),
            "resize_images": params.get("resize_images", "true").lower() == "true",
            "image_width": int(params.get("image_width", 224)),
            "image_height": int(params.get("image_height", 224)),
            "normalize_audio": params.get("normalize_audio", "false").lower() == "true",
        }

        try:
            async with aiohttp_client.ClientSession() as session:
                async with session.get(
                    audio_url,
                    headers={"User-Agent": f"Dipper/{XC_API_KEY}"},
                    timeout=aiohttp_client.ClientTimeout(total=30),
                    ssl=SSL_CONTEXT,
                ) as resp:
                    if resp.status != 200:
                        return web.json_response(
                            {"error": f"Failed to fetch audio: {resp.status}"},
                            status=502,
                        )
                    audio_bytes = await resp.read()

            # Determine format from content-type or URL
            is_mp3 = "mp3" in audio_url.lower()
            raw_suffix = ".mp3" if is_mp3 else ".ogg"
            with tempfile.NamedTemporaryFile(suffix=raw_suffix, delete=False) as tmp:
                tmp.write(audio_bytes)
                raw_path = tmp.name

            try:
                clip_data = {
                    "file_path": raw_path,
                    "start_time": 0,
                    "end_time": 6.0,
                }
                result = process_single_clip(clip_data, settings)
            finally:
                try:
                    os.unlink(raw_path)
                except Exception:
                    pass

            return web.json_response(result)
        except Exception as e:
            logger.error(f"XC clip error: {e}")
            return web.json_response({"error": str(e)}, status=500)

    async def root_handler(self, request):
        """Root endpoint to handle HEAD requests from wait-on"""
        return web.json_response({"status": "ok", "server": "dipper-backend"})

    async def health_check(self, request):
        """Health check endpoint"""
        return web.json_response(
            {
                "status": "ok",
                "message": f"Backend running on port {self.port}",
                "port": self.port,
                "server_type": "lightweight",
                "capabilities": [
                    "scan_folder",
                    "load_scores",
                    "load_extraction_task",
                    "config_management",
                    "env_management",
                    "inference_runner",
                    "training_runner",
                    "extraction_runner",
                ],
            }
        )

    async def get_temp_dir(self, request):
        """Return the system temporary directory path"""
        try:
            temp_dir = tempfile.gettempdir()
            return web.json_response({"status": "success", "temp_dir": temp_dir})
        except Exception as e:
            logger.error(f"Error getting temp directory: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def scan_folder(self, request):
        """Scan folder for audio files"""
        try:
            data = await request.json()
            folder_path = data.get("folder_path")

            if not folder_path or not os.path.exists(folder_path):
                raise ValueError("Invalid folder path")

            # Call scan function
            result = scan_folder.scan_folder_for_audio_files(folder_path)

            return web.json_response(result)

        except Exception as e:
            logger.error(f"Error scanning folder: {e}")
            return web.json_response({"error": str(e), "files": []}, status=500)

    async def load_scores(self, request):
        """Load scores from file"""
        try:
            data = await request.json()
            file_path = data.get("file_path")
            max_rows = data.get("max_rows")

            if not file_path or not os.path.exists(file_path):
                raise ValueError("Invalid file path")

            # Call function with optional max_rows parameter
            result = load_scores.load_scores(file_path, max_rows=max_rows)

            return self.json_response_with_nan_handling(result)

        except Exception as e:
            logger.error(f"Error loading scores: {e}")
            return web.json_response({"error": str(e), "scores": {}}, status=500)

    def _multihot_to_class_list(self, series, classes, threshold=0):
        """Helper function to convert multi-hot row to list of class names"""
        labels = series[classes]
        # Convert to numeric, treating non-numeric values as 0
        labels = pd.to_numeric(labels, errors="coerce").fillna(0)
        return labels[labels > threshold].index.to_list()

    async def load_review_task(self, request):
        """Load extraction task CSV file for the Review tab"""
        try:
            data = await request.json()
            csv_path = data.get("csv_path")
            threshold = data.get("threshold", 0)
            wide_format = data.get("wide_format", False)
            annotation_column = data.get("annotation_column", None)
            # mode: 'binary', 'multiclass', or 'wide' — sent by frontend dialog
            mode = data.get("mode", None)
            # Derive from legacy params if mode not provided
            if mode is None:
                if wide_format:
                    mode = "wide"
                elif annotation_column:
                    mode = "binary"
                else:
                    mode = "binary"  # safe default

            if not csv_path:
                return web.json_response({"error": "csv_path is required"}, status=400)

            if not os.path.exists(csv_path):
                return web.json_response(
                    {"error": f"File not found: {csv_path}"}, status=404
                )

            logger.info(f"Loading extraction task CSV: {csv_path}")

            # Read CSV file
            df = pd.read_csv(csv_path)

            # Validate required columns
            required_columns = ["file", "start_time"]
            missing_columns = [col for col in required_columns if col not in df.columns]
            if missing_columns:
                return web.json_response(
                    {
                        "error": f"Missing required columns: {', '.join(missing_columns)}"
                    },
                    status=400,
                )

            logger.info(f"Found {len(df)} clips in CSV")
            logger.info(f"Columns: {list(df.columns)}")

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

            # Fill missing values
            df["id"] = list(range(len(df)))
            if "comments" in df.columns:
                df["comments"] = df["comments"].fillna("")
            else:
                df["comments"] = ""

            classes = None

            def parse_labels(x):
                if pd.isna(x) or x == "":
                    return []
                elif isinstance(x, list):
                    return x
                elif isinstance(x, str):
                    if x.startswith("[") and x.endswith("]"):
                        try:
                            return json.loads(x.replace("'", '"'))
                        except:
                            return []
                    else:
                        return [
                            label.strip() for label in x.split(",") if label.strip()
                        ]
                return []

            if mode == "binary":
                # Binary mode: use the specified annotation column, create if missing
                col = annotation_column or "annotation"
                if col not in df.columns:
                    df[col] = ""
                df[col] = (
                    df[col]
                    .fillna("")
                    .astype(str)
                    .str.strip()
                    .str.lower()
                    .replace("nan", "")
                )

                standard_cols = ["file", "start_time"]
                if "end_time" in df.columns:
                    standard_cols.append("end_time")
                standard_cols.extend([col, "comments"])
                extra_cols = [
                    c for c in df.columns if c not in standard_cols and c != "id"
                ]
                df = df[standard_cols + extra_cols + ["id"]]

            elif mode == "multiclass":
                # Multi-class mode: use labels column, create if missing
                if "labels" not in df.columns:
                    df["labels"] = ""
                df["labels"] = df["labels"].fillna("")
                df["labels"] = df["labels"].apply(parse_labels)

                # Extract unique classes
                classes = set()
                for labels_list in df["labels"]:
                    if isinstance(labels_list, list):
                        classes.update(labels_list)
                classes = sorted(list(classes)) if classes else None

                if "annotation_status" not in df.columns:
                    df["annotation_status"] = "unreviewed"
                else:
                    df["annotation_status"] = df["annotation_status"].fillna(
                        "unreviewed"
                    )

                standard_cols = ["file", "start_time"]
                if "end_time" in df.columns:
                    standard_cols.append("end_time")
                standard_cols.extend(["labels", "annotation_status", "comments"])
                extra_cols = [
                    c for c in df.columns if c not in standard_cols and c != "id"
                ]
                df = df[standard_cols + extra_cols + ["id"]]

                df["labels"] = df["labels"].apply(
                    lambda x: json.dumps(x) if isinstance(x, list) else "[]"
                )

            elif mode == "wide":
                # Wide-format: convert one-hot/score columns to multiclass labels
                non_data_cols = {"file", "start_time", "end_time", "comments", "id"}
                classes = [c for c in df.columns if c not in non_data_cols]
                df["labels"] = df.apply(
                    self._multihot_to_class_list, axis=1, args=(classes, threshold)
                )
                df["labels"] = df["labels"].apply(
                    lambda x: json.dumps(x) if isinstance(x, list) else "[]"
                )
                df["annotation_status"] = "unreviewed"

                standard_cols = ["file", "start_time"]
                if "end_time" in df.columns:
                    standard_cols.append("end_time")
                standard_cols.extend(["labels", "annotation_status", "comments"])
                extra_cols = [
                    c
                    for c in df.columns
                    if c not in standard_cols and c not in classes and c != "id"
                ]
                df = df[standard_cols + extra_cols + ["id"]]

            # Convert to JSON
            clips = df.to_dict(orient="records")

            # Handle NaN values
            for i, clip in enumerate(clips):
                clip["id"] = i
                for key, value in clip.items():
                    if pd.isna(value):
                        clip[key] = None

            result = {
                "clips": clips,
                "total_clips": len(clips),
                "columns": list(df.columns),
                "duration": duration,
                "classes": classes,
            }

            return self.json_response_with_nan_handling(result)

        except pd.errors.EmptyDataError:
            return web.json_response({"error": "CSV file is empty"}, status=400)
        except pd.errors.ParserError as e:
            logger.error(f"CSV parse error: {e}")
            return web.json_response(
                {"error": f"Failed to parse CSV: {str(e)}"}, status=400
            )
        except Exception as e:
            logger.error(f"Error loading extraction task: {e}")
            return web.json_response({"error": str(e)}, status=500)

    async def count_file_rows(self, request):
        """Count rows in a CSV or PKL file"""
        try:
            data = await request.json()
            file_path = data.get("file_path")

            if not file_path:
                return web.json_response(
                    {"status": "error", "error": "No file_path provided"}, status=400
                )

            if not os.path.exists(file_path):
                return web.json_response(
                    {"status": "error", "error": f"File not found: {file_path}"},
                    status=400,
                )

            # Call row count function
            row_count = load_scores.count_file_rows(file_path)

            return web.json_response(
                {"status": "success", "row_count": row_count, "file_path": file_path}
            )

        except Exception as e:
            logger.error(f"Error counting file rows: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def clip_single(self, request):
        """Process single audio clip from query parameters"""
        try:
            # Get query parameters
            params = request.query

            # Extract required parameters
            file_path = params.get("file_path")
            start_time = float(params.get("start_time", 0))
            end_time = float(params.get("end_time", start_time + 3))

            if not file_path:
                return web.json_response(
                    {"error": "file_path parameter is required"}, status=400
                )

            # Convert query parameters to settings format
            settings = {
                "spec_window_size": int(params.get("spec_window_size", 512)),
                "spectrogram_colormap": params.get("spectrogram_colormap", "greys_r"),
                "dB_range": json.loads(params.get("dB_range", "[-80, -20]")),
                "use_bandpass": params.get("use_bandpass", "false").lower() == "true",
                "bandpass_range": json.loads(
                    params.get("bandpass_range", "[500, 8000]")
                ),
                "resize_images": params.get("resize_images", "true").lower() == "true",
                "image_width": int(params.get("image_width", 224)),
                "image_height": int(params.get("image_height", 224)),
                "normalize_audio": params.get("normalize_audio", "false").lower()
                == "true",
            }

            # Create clip data
            clip_data = {
                "file_path": file_path,
                "start_time": start_time,
                "end_time": end_time,
            }

            # Process the clip
            result = process_single_clip(clip_data, settings)

            if result.get("status") == "error":
                return web.json_response(result, status=500)

            return web.json_response(result)

        except Exception as e:
            logger.error(f"Error processing single clip: {e}")
            return web.json_response({"error": str(e)}, status=500)

    async def clips_batch(self, request):
        """Process batch of audio clips to generate spectrograms and audio"""
        try:
            data = await request.json()
            clips = data.get("clips", [])
            settings = data.get("settings", {})

            if not clips:
                return web.json_response({"error": "No clips provided"}, status=400)

            # Process clips using the optimized function from create_audio_clips_batch.py
            results = []
            for clip in clips:
                # Use the process_single_clip function that handles all settings properly
                result = process_single_clip(clip, settings)
                results.append(result)

            # Count successful clips
            successful_count = sum(1 for r in results if r.get("status") == "success")

            return web.json_response(
                {
                    "status": "success",
                    "results": results,
                    "successful_clips": successful_count,
                    "processing_time": 0.0,
                }
            )

        except Exception as e:
            logger.error(f"Error in clips batch processing: {e}")
            return web.json_response({"error": str(e)}, status=500)

    async def clear_cache(self, request):
        """Purge completed/failed jobs from running_jobs to free memory."""
        try:
            before = len(self.running_jobs)
            done_keys = [
                k
                for k, v in self.running_jobs.items()
                if v.get("status") in ("completed", "failed", "cancelled")
            ]
            for k in done_keys:
                del self.running_jobs[k]
            after = len(self.running_jobs)
            return web.json_response(
                {
                    "status": "success",
                    "message": f"Removed {before - after} completed jobs ({after} active remaining)",
                }
            )
        except Exception as e:
            logger.error(f"Error clearing cache: {e}")
            return web.json_response({"error": str(e)}, status=500)

    async def download_debug_log(self, request):
        """Stream the backend log file as a download (GET /debug/log)."""
        if not os.path.exists(LOG_FILE_PATH):
            return web.Response(text="Log file not found", status=404)
        from datetime import datetime

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return web.FileResponse(
            LOG_FILE_PATH,
            headers={
                "Content-Disposition": f'attachment; filename="dipper-backend_{timestamp}.log"'
            },
        )

    async def memory_stats(self, request):
        """Return process memory usage and running_jobs breakdown."""
        try:
            import psutil, os

            proc = psutil.Process(os.getpid())
            mem = proc.memory_info()
            job_counts = {}
            for v in self.running_jobs.values():
                s = v.get("status", "unknown")
                job_counts[s] = job_counts.get(s, 0) + 1
            return web.json_response(
                {
                    "rss_mb": round(mem.rss / 1024 / 1024, 1),
                    "vms_mb": round(mem.vms / 1024 / 1024, 1),
                    "running_jobs_total": len(self.running_jobs),
                    "running_jobs_by_status": job_counts,
                }
            )
        except ImportError:
            return web.json_response(
                {"error": "psutil not installed; run: pip install psutil"}, status=501
            )
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    # Config Management Routes
    async def save_config(self, request):
        """Save inference configuration to file"""
        try:
            data = await request.json()
            config_data = data.get("config_data")
            output_path = data.get("output_path")

            if not config_data or not output_path:
                return web.json_response(
                    {"error": "config_data and output_path required"}, status=400
                )

            result = save_inference_config(config_data, output_path)
            return web.json_response(result)

        except Exception as e:
            logger.error(f"Error saving config: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def load_config(self, request):
        """Load inference configuration from file"""
        try:
            data = await request.json()
            config_path = data.get("config_path")

            if not config_path:
                return web.json_response({"error": "config_path required"}, status=400)

            result = load_inference_config(config_path)
            return web.json_response(result)

        except Exception as e:
            logger.error(f"Error loading config: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def validate_config(self, request):
        """Validate audio files in configuration"""
        try:
            data = await request.json()
            files = data.get("files", [])

            result = validate_audio_files(files)
            return web.json_response({"status": "success", "validation": result})

        except Exception as e:
            logger.error(f"Error validating config: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    # Environment Management Routes
    async def check_env(self, request):
        """Check ML environment status

        If env_path not provided or None, uses default system cache directory
        """
        try:
            data = await request.json()
            env_path = data.get("env_path")  # Could be None for default

            # Use default cache directory if not provided
            if env_path is None:
                env_path = get_default_env_path()
                logger.info(f"Using default env path for check: {env_path}")
            else:
                logger.info(f"Using custom env path for check: {env_path}")

            result = check_environment(env_path)
            return web.json_response(result)

        except Exception as e:
            logger.error(f"Error checking environment: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def setup_env(self, request):
        """Setup ML environment (install if needed)

        If env_path not provided or None, uses the default environment in the system
        cache directory, installing it if needed (optional torch_variant: 'auto',
        'cpu' or 'cuda'). If env_path is provided, uses that custom environment
        (must already exist).
        """
        try:
            data = await request.json()
            env_path = data.get("env_path")  # None = use default cache, or custom path
            torch_variant = data.get("torch_variant", "auto")

            result = setup_environment(env_path, torch_variant)
            return web.json_response(result)

        except Exception as e:
            logger.error(f"Error setting up environment: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def install_env(self, request):
        """Start a background install (or update) of the ML environment.

        Body (all optional): {"torch_variant": "auto" | "cpu" | "cuda",
        "installer_env": {"HTTPS_PROXY": "...", ...}}. "auto" (default) picks CUDA if
        a new enough NVIDIA driver is present, or keeps the installed build when
        updating. installer_env is limited to INSTALLER_ENV_ALLOWED.

        Non-blocking: returns immediately with {"status": "started"} or
        {"status": "already_running"} if an install is already in progress.
        Poll /env/install/status for progress.
        """
        state = self._env_install_state
        if state["stage"] == "installing":
            return web.json_response({"status": "already_running", "state": state})

        data = await request.json()
        try:
            installer_env = validate_installer_env(data.get("installer_env", {}))
            plan = plan_install(data.get("torch_variant", "auto"))
        except ValueError as e:
            return web.json_response({"status": "error", "error": str(e)}, status=400)
        variant, reason, env_dir = plan["variant"], plan["reason"], plan["env_path"]

        if plan["mode"] == "up_to_date":
            self._env_install_state = {
                "stage": "ready",
                "message": "Environment already ready",
                "error": None,
            }
            return web.json_response(
                {"status": "already_ready", "state": self._env_install_state}
            )
        if not plan["enough_space"]:
            return web.json_response(
                {
                    "status": "error",
                    "error": f"Not enough free disk space: the {variant} build needs about "
                    f"{plan['required_free_gb']} GB free in {env_dir}, but only "
                    f"{plan['free_gb']} GB is available.",
                },
                status=400,
            )

        def _set_progress(line):
            self._env_install_state = {
                "stage": "installing",
                "message": f"Installing ML environment ({variant}): {line}"[:300],
                "error": None,
            }

        def _run():
            try:
                logger.info(
                    f"Starting background environment {plan['mode']}: {variant} ({reason})"
                )
                result = install_environment(
                    env_dir, variant, on_progress=_set_progress, installer_env=installer_env
                )
                if result["status"] == "success":
                    self._env_install_state = {
                        "stage": "ready",
                        "message": f"ML environment ready ({variant}: {reason})",
                        "error": None,
                    }
                    logger.info("Background environment install complete")
                else:
                    self._env_install_state = {
                        "stage": "error",
                        "message": result["error"],
                        "error": result["error"],
                    }
            except Exception as e:
                logger.error(f"Background env install failed: {e}")
                self._env_install_state = {
                    "stage": "error",
                    "message": str(e),
                    "error": str(e),
                }

        self._env_install_state = {
            "stage": "installing",
            "message": f"Starting {plan['mode']} ({variant}: {reason})...",
            "error": None,
        }
        threading.Thread(target=_run, daemon=True).start()
        return web.json_response(
            {"status": "started", "state": self._env_install_state, "plan": plan}
        )

    async def env_plan(self, request):
        """What installing would do (variant, expected size, free disk space)."""
        try:
            plan = plan_install(request.query.get("torch_variant", "auto"))
            return web.json_response(plan)
        except ValueError as e:
            return web.json_response({"status": "error", "error": str(e)}, status=400)
        except Exception as e:
            logger.error(f"Error planning environment install: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def install_env_status(self, request):
        """Return current state of background env install."""
        return web.json_response(self._env_install_state)

    async def env_gpu(self, request):
        """GPU detection and whether the installed ML environment can use it."""
        try:
            loop = asyncio.get_running_loop()
            return web.json_response(await loop.run_in_executor(None, get_gpu_status))
        except Exception as e:
            logger.error(f"Error getting GPU status: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def remove_env(self, request):
        """Delete the default ML environment directory (POST /env/remove)."""
        env_dir = get_default_env_path()
        try:
            for path in (_install_status_path(env_dir), _torch_variant_path(env_dir)):
                if os.path.exists(path):
                    os.remove(path)
            if os.path.exists(env_dir):
                shutil.rmtree(env_dir)
                logger.info(f"Removed ML environment at {env_dir}")
                return web.json_response({"status": "removed"})
            return web.json_response({"status": "not_found"})
        except Exception as e:
            logger.error(f"Failed to remove ML environment: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    # Process Management Routes
    async def run_inference(self, request):
        """Start inference process and return immediately with job ID"""
        try:
            data = await request.json()
            config_path = data.get("config_path")
            env_path = data.get("env_path")
            job_id = data.get(
                "job_id", f"job_{int(asyncio.get_event_loop().time() * 1000)}"
            )

            logger.info(f"Inference request received:")
            logger.info(f"  job_id: {job_id}")
            logger.info(f"  config_path: {config_path}")
            logger.info(f"  env_path: {env_path if env_path else 'default'}")

            if not config_path:
                return web.json_response({"error": "config_path required"}, status=400)

            # Check environment is ready — install via Settings if missing
            resolved_env = env_path if env_path else get_default_env_path()
            env_result = check_environment(resolved_env)
            if env_result["status"] != "ready":
                logger.error(f"Environment not ready: {env_result}")
                return web.json_response(
                    {
                        "status": "error",
                        "error": env_not_ready_message(env_result),
                        "env_status": env_result["status"],
                    },
                    status=503,
                )
            logger.info(f"Environment is ready: {env_result}")

            # Start inference process (non-blocking)
            logger.info(f"Starting inference process for job {job_id}...")
            result = start_inference_process(
                job_id, config_path, env_result["python_path"]
            )

            if result["status"] == "started":
                # Store job info for status tracking
                self.running_jobs[job_id] = {
                    "process": result["process"],
                    "status": "running",
                    "job_id": job_id,
                    "system_pid": result["system_pid"],
                    "command": result["command"],
                    "started_at": asyncio.get_event_loop().time(),
                    "log_file_path": result.get("log_file_path"),
                    "job_folder": result.get("job_folder"),
                }

                return web.json_response(
                    {
                        "status": "started",
                        "job_id": job_id,
                        "message": "Inference started successfully. Use /inference/status/{job_id} to check progress.",
                    }
                )
            else:
                return web.json_response(result, status=500)

        except Exception as e:
            logger.error(f"Error starting inference: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def get_inference_status(self, request):
        """Get status of running inference job"""
        try:
            job_id = request.match_info["job_id"]

            if job_id not in self.running_jobs:
                return web.json_response(
                    {"status": "error", "error": f"Job {job_id} not found"}, status=404
                )

            job_info = self.running_jobs[job_id]
            process = job_info["process"]

            # Check if job is already in a final state
            if job_info["status"] in ["cancelled", "completed", "failed"]:
                # Job is already finished, don't check process status again
                if job_info["status"] == "cancelled":
                    status_result = {
                        "status": "cancelled",
                        "message": "Job was cancelled by user",
                    }
                elif job_info["status"] == "completed":
                    status_result = {
                        "status": "completed",
                        "message": "Inference completed successfully",
                    }
                else:  # failed
                    status_result = {"status": "failed", "message": "Inference failed"}
            else:
                # Check current status
                status_result = check_inference_status(process, job_info)

                # Update job info
                job_info["status"] = status_result["status"]

            job_info["last_checked"] = asyncio.get_event_loop().time()

            # If completed, failed, or cancelled, add final results and optionally clean up
            if status_result["status"] in ["completed", "failed", "cancelled"]:
                job_info.update(status_result)
                # Keep job info for a while so frontend can retrieve results
                # Could add cleanup logic here if needed

            return web.json_response(
                {
                    "job_id": job_id,
                    "system_pid": job_info.get("system_pid"),
                    "started_at": job_info["started_at"],
                    "last_checked": job_info["last_checked"],
                    **status_result,
                }
            )

        except Exception as e:
            logger.error(f"Error checking inference status: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def cancel_inference(self, request):
        """Cancel a running inference job"""
        try:
            job_id = request.match_info["job_id"]

            if job_id not in self.running_jobs:
                return web.json_response(
                    {"status": "error", "error": f"Job {job_id} not found"}, status=404
                )

            job_info = self.running_jobs[job_id]
            process = job_info["process"]

            try:
                # Terminate the process
                process.terminate()
                # Give it a moment to terminate gracefully
                import time

                time.sleep(0.5)

                # If still running, force kill
                if process.poll() is None:
                    process.kill()

                # Close log file if it was opened
                if hasattr(process, "_log_file"):
                    try:
                        process._log_file.close()
                    except:
                        pass

                # Update job status
                job_info["status"] = "cancelled"
                job_info["cancelled_at"] = asyncio.get_event_loop().time()

                logger.info(f"Inference job {job_id} cancelled successfully")

                return web.json_response(
                    {
                        "status": "cancelled",
                        "job_id": job_id,
                        "message": "Inference job cancelled successfully",
                    }
                )

            except Exception as e:
                logger.error(f"Error cancelling inference job {job_id}: {e}")
                return web.json_response(
                    {"status": "error", "error": f"Failed to cancel job: {str(e)}"},
                    status=500,
                )

        except Exception as e:
            logger.error(f"Error in cancel_inference: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def get_geomodel_species_list(self, request):
        """Get species list from BirdNET geomodel for a given lat/lon/week, filtered to classifier classes."""
        from scripts import geomodel

        try:
            data = await request.json()
            lat = data.get("lat")
            lon = data.get("lon")
            week = data.get("week")
            min_probability = data.get("min_probability", 0.05)
            classifier = data.get("classifier")

            if lat is None or lon is None or week is None or not classifier:
                return web.json_response(
                    {
                        "status": "error",
                        "error": "lat, lon, week, and classifier are required",
                    },
                    status=400,
                )

            logger.info(
                f"Running geomodel: lat={lat}, lon={lon}, week={week}, classifier={classifier}"
            )

            geo = geomodel.BirdNETGeomodel()
            sp_df = geo(lat, lon, week, min_probability)

            try:
                sp_df = geomodel.subset_classifier_labels(classifier, sp_df)
            except ValueError as e:
                return web.json_response(
                    {"status": "error", "error": str(e)}, status=400
                )

            records = sp_df.to_dict(orient="records")
            for r in records:
                r["probability"] = round(float(r["probability"]), 4)

            return web.json_response({"status": "success", "species": records})

        except Exception as e:
            logger.error(f"Error in get_geomodel_species_list: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def get_classifier_labels(self, request):
        """Return the full class name table for a classifier as a list of records."""
        from scripts import geomodel

        try:
            data = await request.json()
            classifier = data.get("classifier")
            if not classifier:
                return web.json_response(
                    {"status": "error", "error": "classifier is required"}, status=400
                )
            df = geomodel.get_class_table(classifier)
            # First column is the model's native class label
            native_col = df.columns[0]
            records = df.to_dict(orient="records")
            return web.json_response(
                {
                    "status": "success",
                    "native_col": native_col,
                    "labels": records,
                }
            )
        except ValueError as e:
            return web.json_response({"status": "error", "error": str(e)}, status=400)
        except Exception as e:
            logger.error(f"Error in get_classifier_labels: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    # Training Process Management Routes
    async def run_training(self, request):
        """Start training process and return immediately with job ID"""
        try:
            data = await request.json()
            config_path = data.get("config_path")
            env_path = data.get("env_path")
            job_id = data.get(
                "job_id", f"training_job_{int(asyncio.get_event_loop().time() * 1000)}"
            )

            logger.info(f"Training request received:")
            logger.info(f"  job_id: {job_id}")
            logger.info(f"  config_path: {config_path}")
            logger.info(f"  env_path: {env_path if env_path else 'default'}")

            if not config_path:
                return web.json_response({"error": "config_path required"}, status=400)

            # Check environment is ready — install via Settings if missing
            resolved_env = env_path if env_path else get_default_env_path()
            env_result = check_environment(resolved_env)
            if env_result["status"] != "ready":
                logger.error(f"Environment not ready: {env_result}")
                return web.json_response(
                    {
                        "status": "error",
                        "error": env_not_ready_message(env_result),
                        "env_status": env_result["status"],
                    },
                    status=503,
                )

            # Start training process (non-blocking)
            result = start_training_process(
                job_id, config_path, env_result["python_path"]
            )

            if result["status"] == "started":
                # Store job info for status tracking
                self.running_jobs[job_id] = {
                    "process": result["process"],
                    "status": "running",
                    "job_id": job_id,
                    "system_pid": result["system_pid"],
                    "command": result["command"],
                    "started_at": asyncio.get_event_loop().time(),
                    "job_type": "training",
                    "log_file_path": result.get("log_file_path"),
                    "job_folder": result.get("job_folder"),
                }

                return web.json_response(
                    {
                        "status": "started",
                        "job_id": job_id,
                        "message": "Training started successfully. Use /training/status/{job_id} to check progress.",
                    }
                )
            else:
                return web.json_response(result, status=500)

        except Exception as e:
            logger.error(f"Error starting training: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def get_training_status(self, request):
        """Get status of running training job"""
        try:
            job_id = request.match_info["job_id"]

            if job_id not in self.running_jobs:
                return web.json_response(
                    {"status": "error", "error": f"Training job {job_id} not found"},
                    status=404,
                )

            job_info = self.running_jobs[job_id]
            process = job_info["process"]

            # Check if job is already in a final state
            if job_info["status"] in ["cancelled", "completed", "failed"]:
                # Job is already finished, don't check process status again
                if job_info["status"] == "cancelled":
                    status_result = {
                        "status": "cancelled",
                        "message": "Job was cancelled by user",
                    }
                elif job_info["status"] == "completed":
                    status_result = {
                        "status": "completed",
                        "message": "Training completed successfully",
                    }
                else:  # failed
                    status_result = {"status": "failed", "message": "Training failed"}
            else:
                # Check current status
                status_result = check_training_status(process, job_info)

                # Update job info
                job_info["status"] = status_result["status"]

            job_info["last_checked"] = asyncio.get_event_loop().time()

            # If completed, failed, or cancelled, add final results and optionally clean up
            if status_result["status"] in ["completed", "failed", "cancelled"]:
                job_info.update(status_result)
                # Keep job info for a while so frontend can retrieve results
                # Could add cleanup logic here if needed

            return web.json_response(
                {
                    "job_id": job_id,
                    "system_pid": job_info.get("system_pid"),
                    "job_type": "training",
                    "started_at": job_info["started_at"],
                    "last_checked": job_info["last_checked"],
                    **status_result,
                }
            )

        except Exception as e:
            logger.error(f"Error checking training status: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def cancel_training(self, request):
        """Cancel a running training job"""
        try:
            job_id = request.match_info["job_id"]

            if job_id not in self.running_jobs:
                return web.json_response(
                    {"status": "error", "error": f"Training job {job_id} not found"},
                    status=404,
                )

            job_info = self.running_jobs[job_id]
            process = job_info["process"]

            try:
                # Terminate the process
                process.terminate()
                # Give it a moment to terminate gracefully
                import time

                time.sleep(0.5)

                # If still running, force kill
                if process.poll() is None:
                    process.kill()

                # Close log file if it was opened
                if hasattr(process, "_log_file"):
                    try:
                        process._log_file.close()
                    except:
                        pass

                # Update job status
                job_info["status"] = "cancelled"
                job_info["cancelled_at"] = asyncio.get_event_loop().time()

                logger.info(f"Training job {job_id} cancelled successfully")

                return web.json_response(
                    {
                        "status": "cancelled",
                        "job_id": job_id,
                        "message": "Training job cancelled successfully",
                    }
                )

            except Exception as e:
                logger.error(f"Error cancelling training job {job_id}: {e}")
                return web.json_response(
                    {"status": "error", "error": f"Failed to cancel job: {str(e)}"},
                    status=500,
                )

        except Exception as e:
            logger.error(f"Error in cancel_training: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    # Annotation Process Management Routes
    async def scan_predictions_folder(self, request):
        """Scan folder for prediction files and extract available classes"""
        try:
            data = await request.json()
            folder_path = data.get("folder_path")

            if not folder_path:
                return web.json_response(
                    {"error": "folder_path is required"}, status=400
                )

            # Call the scan function from the extraction script
            result = clip_extraction.scan_predictions_folder(folder_path)

            return web.json_response({"status": "success", **result})

        except Exception as e:
            logger.error(f"Error scanning predictions folder: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def run_extraction(self, request):
        """Start extraction process and return immediately with job ID"""
        try:
            data = await request.json()
            config_path = data.get("config_path")
            env_path = data.get("env_path")
            job_id = data.get(
                "job_id",
                f"extraction_job_{int(asyncio.get_event_loop().time() * 1000)}",
            )

            logger.info(f"Annotation request received:")
            logger.info(f"  job_id: {job_id}")
            logger.info(f"  config_path: {config_path}")
            logger.info(f"  env_path: {env_path if env_path else 'default'}")

            if not config_path:
                return web.json_response({"error": "config_path required"}, status=400)

            # Check environment is ready — install via Settings if missing
            resolved_env = env_path if env_path else get_default_env_path()
            env_result = check_environment(resolved_env)
            if env_result["status"] != "ready":
                logger.error(f"Environment not ready: {env_result}")
                return web.json_response(
                    {
                        "status": "error",
                        "error": env_not_ready_message(env_result),
                        "env_status": env_result["status"],
                    },
                    status=503,
                )

            # Start extraction process (non-blocking)
            result = start_extraction_process(
                job_id, config_path, env_result["python_path"]
            )

            if result["status"] == "started":
                # Store job info for status tracking
                self.running_jobs[job_id] = {
                    "process": result["process"],
                    "status": "running",
                    "job_id": job_id,
                    "system_pid": result["system_pid"],
                    "command": result["command"],
                    "started_at": asyncio.get_event_loop().time(),
                    "job_type": "extraction",
                    "log_file_path": result.get("log_file_path"),
                    "job_folder": result.get("job_folder"),
                }

                return web.json_response(
                    {
                        "status": "started",
                        "job_id": job_id,
                        "message": "Extraction started successfully. Use /extraction/status/{job_id} to check progress.",
                    }
                )
            else:
                return web.json_response(result, status=500)

        except Exception as e:
            logger.error(f"Error starting extraction: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def run_extraction_inline(self, request):
        """Run extraction synchronously in the backend thread (no subprocess).
        Faster for small jobs since it skips Python startup and library import time."""
        try:
            data = await request.json()
            config_path = data.get("config_path")

            if not config_path:
                return web.json_response({"error": "config_path required"}, status=400)

            config_path = resolve_path(config_path)
            if not os.path.exists(config_path):
                return web.json_response(
                    {"error": f"Config file not found: {config_path}"}, status=400
                )

            logger.info(f"Running extraction inline from config: {config_path}")

            # Ensure job folder exists before extract_clips tries to write into it
            import json as _json

            with open(config_path, "r") as _f:
                _cfg = _json.load(_f)
            job_folder = _cfg.get("job_folder")
            if job_folder:
                os.makedirs(job_folder, exist_ok=True)

            # Run in a thread pool so we don't block the event loop
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, clip_extraction.extract_clips, config_path
            )

            if result.get("status") == "success":
                return web.json_response(
                    {
                        "status": "completed",
                        "extraction_files": result.get("extraction_files", []),
                        "total_clips": result.get("total_clips", 0),
                        "summary_file": result.get("summary_file", ""),
                    }
                )
            else:
                logger.error(f"Inline extraction failed: {result.get('error')}")
                return web.json_response(
                    {"status": "error", "error": result.get("error", "Unknown error")},
                    status=500,
                )

        except Exception as e:
            import traceback

            logger.error(
                f"Error running inline extraction: {e}\n{traceback.format_exc()}"
            )
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def get_extraction_status(self, request):
        """Get status of running extraction job"""
        try:
            job_id = request.match_info["job_id"]

            if job_id not in self.running_jobs:
                return web.json_response(
                    {"status": "error", "error": f"Annotation job {job_id} not found"},
                    status=404,
                )

            job_info = self.running_jobs[job_id]
            process = job_info["process"]

            # Check if job is already in a final state
            if job_info["status"] in ["cancelled", "completed", "failed"]:
                # Job is already finished, don't check process status again
                if job_info["status"] == "cancelled":
                    status_result = {
                        "status": "cancelled",
                        "message": "Job was cancelled by user",
                    }
                elif job_info["status"] == "completed":
                    status_result = {
                        "status": "completed",
                        "message": "Annotation completed successfully",
                        "extraction_files": job_info.get("extraction_files", []),
                    }
                else:  # failed
                    status_result = {"status": "failed", "message": "Annotation failed"}
            else:
                # Check current status
                status_result = check_extraction_status(process, job_info)

                # Update job info
                job_info["status"] = status_result["status"]

                # Store extraction files if completed
                if (
                    status_result["status"] == "completed"
                    and "extraction_files" in status_result
                ):
                    job_info["extraction_files"] = status_result["extraction_files"]

            job_info["last_checked"] = asyncio.get_event_loop().time()

            # If completed, failed, or cancelled, add final results and optionally clean up
            if status_result["status"] in ["completed", "failed", "cancelled"]:
                job_info.update(status_result)
                # Keep job info for a while so frontend can retrieve results
                # Could add cleanup logic here if needed

            return web.json_response(
                {
                    "job_id": job_id,
                    "system_pid": job_info.get("system_pid"),
                    "job_type": "extraction",
                    "started_at": job_info["started_at"],
                    "last_checked": job_info["last_checked"],
                    **status_result,
                }
            )

        except Exception as e:
            logger.error(f"Error checking extraction status: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def cancel_extraction(self, request):
        """Cancel a running extraction job"""
        try:
            job_id = request.match_info["job_id"]

            if job_id not in self.running_jobs:
                return web.json_response(
                    {"status": "error", "error": f"Annotation job {job_id} not found"},
                    status=404,
                )

            job_info = self.running_jobs[job_id]
            process = job_info["process"]

            try:
                # Terminate the process
                process.terminate()
                # Give it a moment to terminate gracefully
                import time

                time.sleep(0.5)

                # If still running, force kill
                if process.poll() is None:
                    process.kill()

                # Close log file if it was opened
                if hasattr(process, "_log_file"):
                    try:
                        process._log_file.close()
                    except:
                        pass

                # Update job status
                job_info["status"] = "cancelled"
                job_info["cancelled_at"] = asyncio.get_event_loop().time()

                logger.info(f"Annotation job {job_id} cancelled successfully")

                return web.json_response(
                    {
                        "status": "cancelled",
                        "job_id": job_id,
                        "message": "Annotation job cancelled successfully",
                    }
                )

            except Exception as e:
                logger.error(f"Error cancelling extraction job {job_id}: {e}")
                return web.json_response(
                    {"status": "error", "error": f"Failed to cancel job: {str(e)}"},
                    status=500,
                )

        except Exception as e:
            logger.error(f"Error in cancel_extraction: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def count_files_glob(self, request):
        """Count files matching glob patterns"""
        try:
            data = await request.json()
            patterns = data.get("patterns", [])
            extensions = data.get(
                "extensions", ["wav", "mp3", "flac", "ogg", "m4a", "aac"]
            )  # Default extensions

            if not patterns:
                return web.json_response(
                    {"status": "error", "error": "No patterns provided"}, status=400
                )

            logger.info(f"Counting files for patterns: {patterns}")
            logger.info(f"Using extensions: {extensions}")

            # Convert extensions to valid set (both lower and uppercase)
            valid_extensions = set()
            for ext in extensions:
                valid_extensions.add(f".{ext.lower()}")
                valid_extensions.add(f".{ext.upper()}")

            all_files = set()  # Use set to avoid duplicates

            for pattern in patterns:
                try:
                    # Use glob with recursive=True to support ** syntax
                    matches = glob.glob(pattern, recursive=True)

                    # Filter for audio files only
                    audio_files = [
                        f
                        for f in matches
                        if Path(f).suffix in valid_extensions and os.path.isfile(f)
                    ]
                    all_files.update(audio_files)

                    logger.info(
                        f"Pattern '{pattern}' matched {len(audio_files)} audio files"
                    )

                except Exception as e:
                    logger.warning(f"Error processing pattern '{pattern}': {e}")
                    continue

            # Convert to sorted list to get consistent first file
            all_files_list = sorted(list(all_files))
            total_count = len(all_files_list)
            first_file = all_files_list[0] if all_files_list else None

            logger.info(f"Total unique audio files found: {total_count}")
            if first_file:
                logger.info(f"First file: {first_file}")

            return web.json_response(
                {
                    "status": "success",
                    "count": total_count,
                    "first_file": first_file,
                    "patterns_processed": len(patterns),
                    "extensions_used": extensions,
                }
            )

        except Exception as e:
            logger.error(f"Error counting files from glob patterns: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def count_files_list(self, request):
        """Count files from a file list (one file per line)"""
        try:
            data = await request.json()
            file_path = data.get("file_path")

            if not file_path:
                return web.json_response(
                    {"status": "error", "error": "No file_path provided"}, status=400
                )

            if not os.path.exists(file_path):
                return web.json_response(
                    {"status": "error", "error": f"File list not found: {file_path}"},
                    status=400,
                )

            logger.info(f"Counting files from list: {file_path}")

            # Valid audio extensions
            valid_extensions = {
                ".wav",
                ".WAV",
                ".mp3",
                ".MP3",
                ".flac",
                ".FLAC",
                ".ogg",
                ".OGG",
                ".m4a",
                ".M4A",
                ".aac",
                ".AAC",
            }

            valid_files = []
            invalid_files = []

            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    for line_num, line in enumerate(f, 1):
                        file_path_line = line.strip()

                        # Skip empty lines
                        if not file_path_line:
                            continue

                        # Check if file exists and has valid extension
                        if (
                            os.path.isfile(file_path_line)
                            and Path(file_path_line).suffix in valid_extensions
                        ):
                            valid_files.append(file_path_line)
                        else:
                            invalid_files.append(f"Line {line_num}: {file_path_line}")
                            logger.warning(
                                f"Invalid or missing file at line {line_num}: {file_path_line}"
                            )

                first_file = valid_files[0] if valid_files else None

                logger.info(
                    f"File list processed: {len(valid_files)} valid, {len(invalid_files)} invalid"
                )
                if first_file:
                    logger.info(f"First file: {first_file}")

                return web.json_response(
                    {
                        "status": "success",
                        "count": len(valid_files),
                        "first_file": first_file,
                        "valid_files": len(valid_files),
                        "invalid_files": len(invalid_files),
                    }
                )

            except UnicodeDecodeError:
                return web.json_response(
                    {
                        "status": "error",
                        "error": "File list contains invalid characters (not UTF-8)",
                    },
                    status=400,
                )

        except Exception as e:
            logger.error(f"Error counting files from file list: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def get_csv_columns(self, request):
        """Get column names from a CSV or PKL file"""
        try:
            data = await request.json()
            file_path = data.get("file_path")

            if not file_path:
                return web.json_response(
                    {"status": "error", "error": "No file_path provided"}, status=400
                )

            if not os.path.exists(file_path):
                return web.json_response(
                    {
                        "status": "error",
                        "error": f"Predictions file not found: {file_path}",
                    },
                    status=400,
                )

            file_ext = os.path.splitext(file_path)[1].lower()
            logger.info(f"Reading columns from {file_ext} file: {file_path}")

            try:
                if file_ext == ".pkl":
                    # Read pickle file and get column names
                    df = pd.read_pickle(file_path)
                    columns = df.columns.tolist()
                    logger.info(f"PKL columns: {columns}")
                else:
                    # Read just the header row to get column names for CSV
                    df = pd.read_csv(file_path, nrows=0)
                    columns = df.columns.tolist()
                    logger.info(f"CSV columns: {columns}")

                return web.json_response(
                    {
                        "status": "success",
                        "columns": columns,
                        "file_path": file_path,
                        "file_type": file_ext,
                    }
                )

            except Exception as e:
                return web.json_response(
                    {
                        "status": "error",
                        "error": f"Failed to read predictions file: {str(e)}",
                    },
                    status=400,
                )

        except Exception as e:
            logger.error(f"Error getting file columns: {e}")
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def browse_files(self, request):
        """Browse server-side files (server mode only)"""
        try:
            data = await request.json()
            path = data.get("path", os.path.expanduser("~"))

            # Security: Restrict to allowed base paths
            # Allow user home directory and common data directories
            allowed_paths = [
                os.path.expanduser("~"),
                "/data",
                "/mnt",
                "/media",
                "/Users",  # macOS
                "/home",  # Linux
            ]

            # Check if path is under any allowed directory
            normalized_path = os.path.normpath(os.path.abspath(path))
            is_allowed = any(
                normalized_path.startswith(os.path.normpath(os.path.abspath(base)))
                for base in allowed_paths
            )

            if not is_allowed:
                return web.json_response(
                    {"error": "Access denied to this directory"}, status=403
                )

            # Check if path exists
            if not os.path.exists(normalized_path):
                return web.json_response(
                    {"error": f"Path does not exist: {path}"}, status=404
                )

            # List directory contents
            items = []
            try:
                for entry in os.scandir(normalized_path):
                    try:
                        stat_info = entry.stat()
                        items.append(
                            {
                                "id": entry.path,
                                "value": entry.name,
                                "size": stat_info.st_size if entry.is_file() else 0,
                                "date": int(stat_info.st_mtime * 1000),  # milliseconds
                                "type": "folder" if entry.is_dir() else "file",
                            }
                        )
                    except (OSError, PermissionError):
                        # Skip files/folders we can't access
                        continue

                # Sort: folders first, then by name
                items.sort(key=lambda x: (x["type"] != "folder", x["value"].lower()))

            except PermissionError:
                return web.json_response({"error": "Permission denied"}, status=403)

            return web.json_response({"data": items, "path": normalized_path})

        except Exception as e:
            logger.error(f"Error browsing files: {e}")
            return web.json_response({"error": str(e)}, status=500)

    async def save_file_server(self, request):
        """Save file on server (server mode only)"""
        try:
            data = await request.json()
            file_path = data.get("path")
            content = data.get("content")

            if not file_path or content is None:
                return web.json_response(
                    {"error": "Missing path or content"}, status=400
                )

            # Security: Validate path is under allowed directories
            allowed_paths = [
                os.path.expanduser("~"),
                "/data",
                "/mnt",
                "/media",
                "/Users",
                "/home",
            ]

            normalized_path = os.path.normpath(os.path.abspath(file_path))
            is_allowed = any(
                normalized_path.startswith(os.path.normpath(os.path.abspath(base)))
                for base in allowed_paths
            )

            if not is_allowed:
                return web.json_response(
                    {"error": "Access denied to this location"}, status=403
                )

            # Create parent directories if needed
            parent_dir = os.path.dirname(normalized_path)
            if parent_dir:  # Only create if there's a parent directory
                os.makedirs(parent_dir, exist_ok=True)

            # Write file
            with open(normalized_path, "w", encoding="utf-8") as f:
                f.write(content)

            return web.json_response({"status": "success", "path": normalized_path})

        except Exception as e:
            import traceback

            logger.error(f"Error saving file to {file_path}: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            return web.json_response({"error": str(e)}, status=500)

    async def read_file_server(self, request):
        """Read file content (server mode only)"""
        try:
            data = await request.json()
            file_path = data.get("file_path")

            if not file_path:
                return web.json_response({"error": "Missing file_path"}, status=400)

            # Security: Validate path is under allowed directories
            allowed_paths = [
                os.path.expanduser("~"),
                "/data",
                "/mnt",
                "/media",
                "/Users",
                "/home",
            ]

            normalized_path = os.path.normpath(os.path.abspath(file_path))
            is_allowed = any(
                normalized_path.startswith(os.path.normpath(os.path.abspath(base)))
                for base in allowed_paths
            )

            if not is_allowed:
                return web.json_response(
                    {"error": "Access denied to this location"}, status=403
                )

            # Check if file exists
            if not os.path.exists(normalized_path):
                return web.json_response(
                    {"error": f"File does not exist: {file_path}"}, status=404
                )

            # Read file content
            with open(normalized_path, "r", encoding="utf-8") as f:
                content = f.read()

            return web.json_response({"content": content})

        except Exception as e:
            logger.error(f"Error reading file: {e}")
            return web.json_response({"error": str(e)}, status=500)

    async def download_file(self, request):
        """Stream a raw file to the browser as a download (GET /files/download?path=...)"""
        try:
            file_path = request.rel_url.query.get("path", "")
            if not file_path:
                return web.Response(text="Missing path", status=400)

            normalized_path = os.path.normpath(os.path.abspath(file_path))
            if not os.path.exists(normalized_path) or not os.path.isfile(
                normalized_path
            ):
                return web.Response(text="File not found", status=404)

            filename = os.path.basename(normalized_path)
            return web.FileResponse(
                normalized_path,
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        except Exception as e:
            logger.error(f"Error downloading file: {e}")
            return web.Response(text=str(e), status=500)

    async def generate_unique_name(self, request):
        """Generate unique folder/file name (server mode only)"""
        try:
            data = await request.json()
            base_path = data.get("basePath")
            folder_name = data.get("folderName")

            if not base_path or not folder_name:
                return web.json_response(
                    {"error": "Missing basePath or folderName"}, status=400
                )

            # Check if base path exists
            if not os.path.exists(base_path):
                return web.json_response(
                    {"error": f"Base path does not exist: {base_path}"}, status=404
                )

            # Generate unique name
            unique_name = folder_name
            counter = 1

            while os.path.exists(os.path.join(base_path, unique_name)):
                unique_name = f"{folder_name}_{counter}"
                counter += 1

            return web.json_response({"uniqueName": unique_name})

        except Exception as e:
            logger.error(f"Error generating unique name: {e}")
            return web.json_response({"error": str(e)}, status=500)

    async def start_server(self):
        """Start the HTTP server"""
        # Suppress access log noise from high-frequency polling endpoints
        _SILENT_PATHS = {"/env/install/status", "/memory", "/health"}

        class _QuietAccessLogger(logging.Logger):
            def info(self, msg, *args, **kwargs):
                # aiohttp formats the access log line as the message string
                line = msg % args if args else str(msg)
                if any(p in line for p in _SILENT_PATHS):
                    return
                super().info(msg, *args, **kwargs)

        access_logger = _QuietAccessLogger("aiohttp.access")
        access_logger.setLevel(logging.INFO)
        for h in logging.getLogger().handlers:
            access_logger.addHandler(h)

        runner = web.AppRunner(self.app, access_log=access_logger)
        await runner.setup()

        site = web.TCPSite(runner, self.host, self.port)
        await site.start()

        logger.info(f"Backend started on http://{self.host}:{self.port}")
        return runner

    # ------------------------------------------------------------------ #
    # SongSpace endpoints                                                  #
    # ------------------------------------------------------------------ #

    def _get_songspace_python(self):
        """Return python path to use for SongSpace — opso_dev conda env if available."""
        import shutil

        # Try opso_dev env first (has SongSpace on the feature branch)
        opso_dev = "/Users/SML161/miniconda3/envs/opso_dev/bin/python"
        if Path(opso_dev).exists():
            return opso_dev
        # Fall back to the standard ML environment
        result = setup_environment(None)
        if result.get("status") == "ready":
            return result["python_path"]
        raise RuntimeError("No Python environment with SongSpace available")

    def _run_songspace_fn(self, fn_name: str, **kwargs) -> dict:
        """Run a songspace_utils function in a subprocess via the opso_dev python.

        We serialize kwargs as JSON, pass via stdin, and read the result from stdout.
        This keeps the SongSpace instance alive between calls via a persistent process
        — but for simplicity we use module-level registry via a long-running subprocess.

        For now: run each call as a short subprocess that loads the registry from a
        shelf file on disk.  Simple and reliable for a prototype.
        """
        import subprocess, json, sys, os, tempfile

        script = f"""
import sys, json
sys.path.insert(0, {repr(str(Path(__file__).parent / "scripts"))})
import songspace_utils as su
kwargs = json.loads(sys.stdin.read())
result = su.{fn_name}(**kwargs)
print(json.dumps(result))
"""
        python = self._get_songspace_python()
        proc = subprocess.run(
            [python, "-c", script],
            input=json.dumps(kwargs),
            capture_output=True,
            text=True,
            timeout=600,
            env=env_python_subprocess_env(),
        )
        if proc.returncode != 0:
            stderr = proc.stderr[-2000:] if proc.stderr else ""
            return {"status": "error", "error": f"Subprocess failed:\n{stderr}"}
        stdout = proc.stdout.strip()
        if not stdout:
            return {
                "status": "error",
                "error": f"Empty response from subprocess. stderr: {proc.stderr[-500:]}",
            }
        # Take last line (avoid any stray print output before ours)
        last_line = [l for l in stdout.splitlines() if l.strip()][-1]
        try:
            return json.loads(last_line)
        except json.JSONDecodeError as e:
            return {
                "status": "error",
                "error": f"JSON decode error: {e}. Output: {stdout[-500:]}",
            }

    # SongSpace instances are heavy — keep them alive in a per-process registry
    # managed by a long-running worker process.  For the prototype we use a simpler
    # approach: a persistent background worker process per open SongSpace that keeps
    # the SS instance in memory and handles requests via stdin/stdout JSON-RPC.
    # We store worker processes in self._ss_workers keyed by resolved db_path.

    def _ensure_ss_worker(self, ssdb_path: str):
        """Ensure a SongSpace worker process is running for db_path. Return its handle."""
        import subprocess, tempfile, os

        if not hasattr(self, "_ss_workers"):
            self._ss_workers = {}
            self._ss_worker_logs = {}
        key = str(Path(ssdb_path).resolve())
        worker = self._ss_workers.get(key)
        if worker is None or worker.poll() is not None:
            python = self._get_songspace_python()
            worker_script = str(
                Path(__file__).parent / "scripts" / "songspace_worker.py"
            )
            # Write stderr to a temp log file — avoids pipe buffer deadlock from TF warnings
            log_path = os.path.join(
                tempfile.gettempdir(),
                f"dipper_songspace_{key.replace('/', '_')[-40:]}.log",
            )
            log_fh = open(log_path, "w")
            env = env_python_subprocess_env()
            env["PYTHONUNBUFFERED"] = "1"  # disable Python stdout buffering
            env["TF_CPP_MIN_LOG_LEVEL"] = "3"  # suppress TF C++ logs to stdout
            proc = subprocess.Popen(
                [python, worker_script],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=log_fh,
                text=True,
                bufsize=1,  # line-buffered
                env=env,
            )
            self._ss_workers[key] = proc
            self._ss_worker_logs[key] = log_path
            logger.info(f"Started SongSpace worker PID {proc.pid}, log: {log_path}")
        return self._ss_workers[key]

    def _call_worker(self, ssdb_path: str, method: str, **params) -> dict:
        """Send a JSON-RPC call to the SongSpace worker for ssdb_path."""
        import json, threading

        key = str(Path(ssdb_path).resolve())
        worker = self._ensure_ss_worker(ssdb_path)
        log_path = getattr(self, "_ss_worker_logs", {}).get(key, "")
        msg = json.dumps({"method": method, "params": params}) + "\n"
        try:
            worker.stdin.write(msg)
            worker.stdin.flush()
            result_holder = [None]
            err_holder = [None]

            def read():
                try:
                    # Skip blank lines — some libraries (TF) print to stdout
                    line = ""
                    while not line.strip():
                        line = worker.stdout.readline()
                        if line == "":  # EOF / process died
                            break
                    result_holder[0] = line
                except Exception as e:
                    err_holder[0] = str(e)

            t = threading.Thread(target=read, daemon=True)
            t.start()
            t.join(timeout=600)
            if t.is_alive():
                return {
                    "status": "error",
                    "error": "Worker timed out after 600s",
                    "log_path": log_path,
                }
            if err_holder[0]:
                return {"status": "error", "error": err_holder[0], "log_path": log_path}
            line = result_holder[0]
            if not line:
                # Worker died — read last lines from log file for context
                tail = ""
                try:
                    with open(log_path) as f:
                        tail = "".join(f.readlines()[-30:])
                except Exception:
                    pass
                del self._ss_workers[key]
                return {
                    "status": "error",
                    "error": "Worker process exited unexpectedly",
                    "log": tail,
                    "log_path": log_path,
                }
            result = json.loads(line.strip())
            result["log_path"] = log_path
            return result
        except Exception as e:
            try:
                worker.kill()
            except Exception:
                pass
            if key in self._ss_workers:
                del self._ss_workers[key]
            return {"status": "error", "error": str(e), "log_path": log_path}

    async def songspace_open(self, request):
        """POST /songspace/open — open or create a SongSpace."""
        try:
            data = await request.json()
            db_path = data.get("db_path", "")
            if not db_path:
                return web.json_response(
                    {"status": "error", "error": "db_path required"}, status=400
                )
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._call_worker(db_path, "open", db_path=db_path),
            )
            return self.json_response_with_nan_handling(result)
        except Exception as e:
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def songspace_create(self, request):
        """POST /songspace/create — create a new SongSpace."""
        try:
            data = await request.json()
            db_path = data.get("db_path", "")
            feature_extractor = data.get("feature_extractor", "perch2")
            if not db_path:
                return web.json_response(
                    {"status": "error", "error": "db_path required"}, status=400
                )
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._call_worker(
                    db_path,
                    "create",
                    db_path=db_path,
                    feature_extractor=feature_extractor,
                ),
            )
            return self.json_response_with_nan_handling(result)
        except Exception as e:
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def songspace_info(self, request):
        """POST /songspace/info — get info about an open SongSpace."""
        try:
            data = await request.json()
            db_path = data.get("db_path", "")
            result = await asyncio.get_event_loop().run_in_executor(
                None, lambda: self._call_worker(db_path, "info", db_path=db_path)
            )
            return self.json_response_with_nan_handling(result)
        except Exception as e:
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def songspace_ingest(self, request):
        """POST /songspace/ingest — ingest audio into a SongSpace dataset."""
        try:
            data = await request.json()
            db_path = data.get("db_path", "")
            if not db_path:
                return web.json_response(
                    {"status": "error", "error": "db_path required"}, status=400
                )
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._call_worker(
                    db_path,
                    "ingest_audio",
                    db_path=db_path,
                    samples=data.get("samples", ""),
                    dataset_name=data.get("dataset_name", ""),
                    allow_training=data.get("allow_training", True),
                    file_to_deployment=data.get(
                        "file_to_deployment", "parent_folder_name"
                    ),
                    embedding_exists_mode=data.get("embedding_exists_mode", "skip"),
                    bypass_augmentations=data.get("bypass_augmentations", True),
                    audio_root=data.get("audio_root") or None,
                ),
            )
            return self.json_response_with_nan_handling(result)
        except Exception as e:
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def songspace_fit_classifier(self, request):
        """POST /songspace/fit-classifier — train a classifier."""
        try:
            data = await request.json()
            db_path = data.get("db_path", "")
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._call_worker(
                    db_path,
                    "fit_classifier",
                    db_path=db_path,
                    classifier_name=data.get("classifier_name", "classifier"),
                    classes=data.get("classes", []),
                    train_datasets=data.get("train_datasets", []),
                    validation_dataset=data.get("validation_dataset", None),
                    weak_negatives_proportion=data.get(
                        "weak_negatives_proportion", 2.0
                    ),
                    steps=data.get("steps", 500),
                    batch_size=data.get("batch_size", 128),
                ),
            )
            return self.json_response_with_nan_handling(result)
        except Exception as e:
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def songspace_predict(self, request):
        """POST /songspace/predict — apply classifier, save CSV."""
        try:
            data = await request.json()
            db_path = data.get("db_path", "")
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._call_worker(
                    db_path,
                    "predict",
                    db_path=db_path,
                    classifier_name=data.get("classifier_name", ""),
                    dataset_name=data.get("dataset_name", ""),
                    output_csv=data.get("output_csv", ""),
                    batch_size=data.get("batch_size", 1024),
                ),
            )
            return self.json_response_with_nan_handling(result)
        except Exception as e:
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def songspace_similarity_search(self, request):
        """POST /songspace/similarity-search — embedding similarity search."""
        try:
            data = await request.json()
            db_path = data.get("db_path", "")
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._call_worker(
                    db_path,
                    "similarity_search",
                    db_path=db_path,
                    dataset_name=data.get("dataset_name", ""),
                    sample_indices=data.get("sample_indices", []),
                    k=data.get("k", 20),
                    exact_search=data.get("exact_search", False),
                ),
            )
            return self.json_response_with_nan_handling(result)
        except Exception as e:
            return web.json_response({"status": "error", "error": str(e)}, status=500)

    async def songspace_dataset_samples(self, request):
        """POST /songspace/dataset-samples — get sample rows from a dataset."""
        try:
            data = await request.json()
            db_path = data.get("db_path", "")
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._call_worker(
                    db_path,
                    "get_dataset_samples",
                    db_path=db_path,
                    dataset_name=data.get("dataset_name", ""),
                    max_rows=data.get("max_rows", 500),
                ),
            )
            return self.json_response_with_nan_handling(result)
        except Exception as e:
            return web.json_response({"status": "error", "error": str(e)}, status=500)


def main():
    parser = argparse.ArgumentParser(description="Lightweight bioacoustics server")
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to run on (overridden by config file if provided)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="localhost",
        help="Host to bind to (use 0.0.0.0 for server mode, overridden by config file if provided)",
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Path to YAML config file (server.host and server.port will override command-line args)",
    )
    parser.add_argument(
        "--parent-pid",
        type=int,
        default=None,
        help="Parent process PID for heartbeat monitoring",
    )
    parser.add_argument("--test", action="store_true", help="Run quick test and exit")

    args = parser.parse_args()

    # Read config file if provided
    config = {}
    if args.config:
        try:
            with open(args.config, "r") as f:
                config = yaml.safe_load(f)
            logger.info(f"Loaded config file: {args.config}")
        except Exception as e:
            logger.error(f"Failed to load config file {args.config}: {e}")
            sys.exit(1)

    # Use config file values if available, otherwise fall back to command-line args
    host = args.host
    port = args.port

    if config:
        if "server" in config:
            if "host" in config["server"]:
                host = config["server"]["host"]
                logger.info(f"Using host from config file: {host}")
            if "port" in config["server"]:
                port = config["server"]["port"]
                logger.info(f"Using port from config file: {port}")

    logger.info(f"Server will start on {host}:{port}")

    if args.test:
        print("[OK] Backend test successful!")
        print(f"Python version: {sys.version}")
        print(
            f"PyInstaller bundling: {'[OK] SUCCESS' if getattr(sys, 'frozen', False) else '[ERROR] Not bundled'}"
        )
        return 0

    async def run_server():
        server = DipperServer(port=port, host=host)
        runner = await server.start_server()

        # Get parent process ID for heartbeat monitoring
        # Use provided parent PID if available, otherwise use getppid()
        parent_pid = args.parent_pid if args.parent_pid else os.getppid()
        logger.info(
            f"Server started with parent process PID: {parent_pid} (provided={args.parent_pid is not None})"
        )
        logger.info(f"Server process PID: {os.getpid()}")

        # Create shutdown event for graceful termination
        shutdown_event = asyncio.Event()

        async def graceful_shutdown():
            """Callback for graceful shutdown when parent dies"""
            logger.info("Graceful shutdown: setting shutdown event")
            shutdown_event.set()
            logger.info("Graceful shutdown: cleaning up runner")
            try:
                await runner.cleanup()
                logger.info("Graceful shutdown: runner cleanup completed")
            except Exception as e:
                logger.error(f"Error during runner cleanup: {e}")

        # Start parent process monitoring task
        monitor_task = asyncio.create_task(
            monitor_parent_process(parent_pid, graceful_shutdown, check_interval=2.0)
        )

        async def cleanup_completed_jobs():
            """Periodically remove completed/failed jobs older than 5 minutes."""
            while not shutdown_event.is_set():
                await asyncio.sleep(300)
                cutoff = asyncio.get_event_loop().time() - 300
                stale = [
                    k
                    for k, v in server.running_jobs.items()
                    if v.get("status") in ("completed", "failed", "cancelled")
                    and v.get("last_checked", 0) < cutoff
                ]
                for k in stale:
                    del server.running_jobs[k]
                if stale:
                    logger.info(f"Cleaned up {len(stale)} stale jobs from running_jobs")

        asyncio.create_task(cleanup_completed_jobs())

        try:
            # Keep server running until shutdown event is triggered
            await shutdown_event.wait()
            logger.info("Shutdown event received, server stopped")
            logger.info("Exiting server process...")
        except KeyboardInterrupt:
            logger.info("Keyboard interrupt received, shutting down server...")
            await runner.cleanup()
        except Exception as e:
            logger.error(f"Unexpected error in server main loop: {e}")
            await runner.cleanup()
        finally:
            # Cancel monitoring task if still running
            if not monitor_task.done():
                monitor_task.cancel()
                try:
                    await monitor_task
                except asyncio.CancelledError:
                    pass

    try:
        asyncio.run(run_server())
    except Exception as e:
        logger.error(f"Error running server: {e}")
    finally:
        logger.info("Server main() function exiting")
        # Force exit to ensure no lingering tasks
        sys.exit(0)


if __name__ == "__main__":
    sys.exit(main())
