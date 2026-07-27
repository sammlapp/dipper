# Build Instructions

This document describes how to build Dipper for different platforms using Tauri.

## Prerequisites

1. **Node.js** (v18+)
2. **Python 3.12** with PyInstaller dependencies (`backend/requirements-backend.txt`)
3. **Rust/Cargo** — required by Tauri
   - macOS/Linux: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
   - Windows: install via [rustup-init.exe](https://www.rust-lang.org/tools/install)
4. Platform-specific:
   - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
   - **Windows**: Visual Studio Build Tools with "Desktop development with C++" workload
   - **Linux**: `sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget libssl-dev libayatana-appindicator3-dev librsvg2-dev`

## Build Commands

All commands run from the `frontend/` directory.

### Full Application (Dipper)

```bash
cd frontend
npm run tauri:build:all
```

This builds the React app, PyInstaller backend, and Tauri desktop app in one step.
Output: `frontend/src-tauri/target/release/bundle/`

### Review-Only Application (Dipper Review)

```bash
cd frontend
npm run tauri:build:review
```

Smaller build with only the ReviewTab. Uses `REACT_APP_REVIEW_ONLY=true`.

### Manual step-by-step (if needed)

```bash
# 1. Build PyInstaller backend
cd backend
python build_pyinstaller.py
cp dist/dipper-backend ../frontend/python-dist/dipper-backend

# 2. Build React app
cd ../frontend
npm run build

# 3. Build Tauri app
npx tauri build --verbose
```

## Output Files

- **macOS**: `.dmg` installer in `src-tauri/target/release/bundle/dmg/`
- **Windows**: `.msi` / `.exe` installer in `src-tauri/target/release/bundle/msi/` or `nsis/`
- **Linux**: `.AppImage` / `.deb` in `src-tauri/target/release/bundle/`

## Architecture Support

### macOS
- ARM64 (Apple Silicon: M1/M2/M3)
- x64 (Intel) — build on Intel Mac or use `--target x86_64-apple-darwin`

### Windows
- x64 (64-bit Intel/AMD)

### Linux
- x64 (64-bit Intel/AMD)

## CI Builds

GitHub Actions workflows in `.github/workflows/` automate builds:
- `build-full.yml` — full Dipper app for all platforms
- `build-review.yml` — review-only app

CI uses Python 3.12 for the PyInstaller backend. **The backend Python version must match the conda-pack ML environment Python version** (also 3.12) to avoid DLL conflicts on Windows when multiprocessing spawns DataLoader workers.

## Development Builds

```bash
cd frontend

# Full dev mode — backend + React hot reload + Tauri window (recommended)
npm run tauri:dev:full

# Frontend only — no backend
npm run tauri:dev
```

## Python Backend

The PyInstaller backend bundles Python 3.12 + lightweight dependencies (no PyTorch).
Heavy ML dependencies live in the separately downloaded conda-pack environment.

To rebuild after backend changes:
```bash
cd backend
python build_pyinstaller.py
cp dist/dipper-backend ../frontend/python-dist/dipper-backend
```

The spec file (`http_server.spec`) bundles:
- All `backend/scripts/*.py` ML task scripts
- `backend/data/class_names/*.csv` classifier name tables
- `birdnames` taxonomy data
- `certifi` SSL certificates

## Troubleshooting

**`cargo metadata` / program not found**: Rust/Cargo not installed or not on PATH. Restart terminal after installing.

**Blank screen in Tauri dev**: Backend not running. Use `tauri:dev:full` instead of `tauri:dev`.

**PyInstaller changes not reflected**: Rebuild and copy the backend executable (see above).

**Windows multiprocessing DLL conflict**: PyInstaller backend Python version must match the conda ML env Python version (both 3.12). Check `build-full.yml` uses `python-version: '3.12'`.

**Class name tables missing in built app**: Ensure `backend/data/class_names/*.csv` files are git-tracked (not gitignored). They must be present at PyInstaller build time to be bundled.
