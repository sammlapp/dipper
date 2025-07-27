# Dipper - Build Instructions

This document provides instructions for building distributable versions of the Bioacoustics Training GUI desktop application.

## Prerequisites

### Required Software

1. **Node.js** (v16 or later)
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify installation: `node --version` and `npm --version`

2. **Conda** (Miniconda or Anaconda)
   - Download Miniconda: [docs.conda.io](https://docs.conda.io/en/latest/miniconda.html)
   - Verify installation: `conda --version`

3. **Git** (for installing bioacoustics-model-zoo)
   - Usually pre-installed on macOS
   - Verify installation: `git --version`

### Platform-Specific Requirements

#### macOS
- macOS 10.15 (Catalina) or later
- Xcode Command Line Tools: `xcode-select --install`

#### Windows
- Windows 10 or later
- Visual Studio Build Tools or Visual Studio Community

#### Linux
- Ubuntu 18.04+ or equivalent
- Build essentials: `sudo apt-get install build-essential`

## Supported Models

The built application includes support for PyTorch-based models only:

✅ **Included Models:**
- HawkEars: Canadian bird classification CNN v0.1.0
- RanaSierraeCNN: Rana sierrae call detection

❌ **Excluded Models (require TensorFlow):**
- BirdNET: Global bird species classification (BirdNET can now run using ai-edge-litert package without TensorFlow, but this package is not yet available on Windows)
- Perch: Global bird species classification  
- SeparationModel: Audio source separation

## Quick Build (macOS)

The fastest way to build for macOS:

```bash
cd frontend
./build-mac.sh
```

This script will:
1. Install npm dependencies
2. Build the React application
3. Build Electron files
4. Create a bundled Python environment
5. Package the macOS application as a .dmg

## Manual Build Process

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Build React Application

```bash
npm run build
```

### 3. Build Electron Files

```bash
npm run build:electron
```

### 4. Build Python Environment

This creates a portable Python environment with all required packages:

```bash
npm run build:python-env
```

**Note:** This step takes 5-15 minutes depending on your internet connection and system speed.

### 5. Package Application

For macOS:
```bash
npm run dist:mac
```

For Windows:
```bash
npm run dist:win
```

For Linux:
```bash
npm run dist:linux
```

## Build Outputs

Successful builds create the following files in `../dist/`:

### macOS
- `Bioacoustics Training GUI-1.0.0.dmg` - Installer disk image
- `Bioacoustics Training GUI-1.0.0-mac.zip` - Application bundle

### Windows
- `Bioacoustics Training GUI Setup 1.0.0.exe` - NSIS installer

### Linux
- `Bioacoustics Training GUI-1.0.0.AppImage` - Portable application

## Python Environment Details

The bundled Python environment includes:

- **Python 3.9**
- **PyTorch** (with CPU support)
- **PyTorch Audio**
- **OpenSoundscape**
- **timm** (PyTorch Image Models)
- **Lightning** (PyTorch Lightning)
- **Bioacoustics Model Zoo** (PyTorch models only)
- **Standard ML libraries:** pandas, numpy, librosa, scikit-learn
- **Visualization:** matplotlib, seaborn

## Development Mode

For development with hot reload:

```bash
cd frontend
npm install
npm run build:electron  # Build Electron files first
npm run electron-dev
```

This will:
1. Start the React development server on localhost:3000
2. Launch Electron pointing to the development server
3. Enable hot reload for React components

## Troubleshooting

### Common Issues

#### Python Environment Build Fails
- Ensure conda is properly installed and in PATH
- Try clearing conda cache: `conda clean --all`
- Check available disk space (needs ~2GB)

#### Electron Build Fails
- Delete `node_modules` and run `npm install` again
- Clear electron cache: `npx electron-builder cleanup`

#### App Won't Start After Build
- Check that the Python environment was properly bundled
- Verify all required backend scripts are included
- Check console logs for specific error messages

#### macOS Gatekeeper Issues
- The app is not code-signed by default
- Users may need to right-click → Open to bypass Gatekeeper
- For distribution, consider proper code signing with Apple Developer account

### File Size Optimization

The bundled app is large (~500MB-1GB) due to the Python environment. To reduce size:

1. **Remove unused packages** from `build-python-env.js`
2. **Exclude development dependencies** in the conda environment
3. **Use conda-pack** for more efficient environment packaging

## Security Considerations

- The app includes Python environments and executable code
- Consider virus scanning exemptions for development machines
- For public distribution, implement proper code signing
- Keep dependencies updated for security patches

## Performance Notes

- First build takes longest due to Python environment creation
- Subsequent builds reuse the Python environment if unchanged
- Use `--dir` flag for faster development builds (unpackaged)
- Consider using local package mirrors for faster conda installs