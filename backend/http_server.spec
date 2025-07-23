# -*- mode: python ; coding: utf-8 -*-

# PyInstaller spec for lightweight_server.py
# This server handles all backend communication with the frontend

a = Analysis(
    ['lightweight_server.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'aiohttp',
        'aiohttp_cors',
        'pandas',
        'numpy', 
        'librosa',
        'soundfile',
        'PIL',
        'scipy.signal',
        'matplotlib.pyplot'
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
