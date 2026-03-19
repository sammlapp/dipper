# -*- mode: python ; coding: utf-8 -*-

# PyInstaller spec for lightweight_server.py
# This server handles all backend communication with the frontend

import os
from pathlib import Path

# Get the directory containing this spec file
spec_root = os.path.abspath(SPECPATH)

# Collect all Python files from scripts directory
scripts_dir = os.path.join(spec_root, 'scripts')
script_datas = []
if os.path.exists(scripts_dir):
    for root, dirs, files in os.walk(scripts_dir):
        for file in files:
            if file.endswith('.py'):
                # Get relative path from scripts directory
                rel_dir = os.path.relpath(root, spec_root)
                src_path = os.path.join(root, file)
                # Add as (source, destination_folder)
                script_datas.append((src_path, rel_dir))

a = Analysis(
    ['lightweight_server.py'],
    pathex=[],
    binaries=[],
    datas=script_datas,  # Include all Python scripts
    hiddenimports=[
        'aiohttp',
        'aiohttp_cors',
        'pandas',
        'numpy',
        'librosa',
        'soundfile',
        'PIL',
        'scipy.signal',
        'matplotlib.pyplot',
        # Add script modules as hidden imports
        'scan_folder',
        'get_sample_detections',
        'load_scores',
        'clip_extraction',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude ML libraries to keep executable smaller
        'torch',
        'torchvision',
        'torchaudio',
        'tensorflow',
        'sklearn',
        'opensoundscape',
        'bioacoustics_model_zoo'
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='lightweight_server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
