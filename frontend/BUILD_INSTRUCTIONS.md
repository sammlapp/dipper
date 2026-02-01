# Build Instructions

This document describes how to build Dipper for different platforms.

## Prerequisites

1. **Node.js** (v16 or later)
2. **Python** environment with required dependencies
3. Platform-specific tools:
   - **macOS**: Xcode Command Line Tools
   - **Windows**: Windows SDK (for Windows builds)
   - **Linux**: Standard build tools

## Build Scripts

### Full Application (Dipper)

The full application includes all tabs: Inference, Training, Extraction, Explore, Review, and Help.

#### Build for All Platforms
```bash
cd frontend
npm run dist:all
```
Output: `../dist/`

#### Build for Specific Platforms

**macOS (ARM):**
```bash
npm run dist:mac
```

**macOS (ARM/M1/M2 only):**
```bash
npm run dist:mac-arm64
```

**Windows:**
```bash
npm run dist:win
```

**Linux:**
```bash
npm run dist:linux
```

### Review-Only Application (Dipper Review)

The review-only application includes only the Review tab with no navigation drawer.

#### Build for All Platforms
```bash
cd frontend
npm run dist:review-all
```
Output: `../dist-review/`

#### Build for Specific Platforms

**macOS (both Intel and ARM):**
```bash
npm run dist:review-mac
```

**macOS (ARM only):**
```bash
npm run dist:review-mac-arm64
```


**Windows:**
```bash
npm run dist:review-win
```

**Linux:**
```bash
npm run dist:review-linux
```

## Build Process Overview

Each build script performs the following steps:

1. **React Build**: Compiles the React application
   - Full app: Standard build
   - Review-only: Build with `REACT_APP_REVIEW_ONLY=true`

2. **Python Backend**: Packages Python dependencies using PyInstaller
   - Creates standalone executables in `python-dist/`
   - Includes `lightweight_server` for audio processing

3. **Electron Packaging**: Uses electron-builder to create platform-specific installers
   - **macOS**: DMG installer with drag-to-Applications
   - **Windows**: NSIS installer with customization options
   - **Linux**: AppImage for universal compatibility

## Output Files

### Full Application
- **macOS**: `../dist/Dipper-{version}-arm64.dmg` and `Dipper-{version}-x64.dmg`
- **Windows**: `../dist/Dipper Setup {version}.exe`
- **Linux**: `../dist/Dipper-{version}.AppImage`

### Review-Only Application
- **macOS**: `../dist-review/Dipper Review-{version}-arm64.dmg` and `Dipper Review-{version}-x64.dmg`
- **Windows**: `../dist-review/Dipper Review Setup {version}.exe`
- **Linux**: `../dist-review/Dipper Review-{version}.AppImage`

## Architecture Support

### macOS
- **ARM64** (Apple Silicon: M1, M2, M3)
- (Intel processors x64 not supported)

### Windows
- **x64** (64-bit Intel/AMD processors)

### Linux
- **x64** (64-bit Intel/AMD processors)

## Development Builds

For testing without creating installers:

**Full app:**
```bash
npm run electron-dev
```

**Review-only app:**
```bash
npm run electron-dev-review
```

## Troubleshooting

### macOS Code Signing Issues
The builds are configured with `hardenedRuntime: false` and `gatekeeperAssess: false` for development. For distribution, you'll need to:
1. Configure code signing in `package.json` and `electron-builder-review.json`
2. Add your Apple Developer certificate
3. Enable notarization

### Windows Build on macOS/Linux
Cross-platform building from macOS/Linux to Windows requires Wine:
```bash
brew install wine-stable  # macOS
```

### Linux Build Requirements
Ensure you have the required build tools:
```bash
sudo apt-get install build-essential libarchive-tools
```

## Python Backend Dependencies

The Python backend is bundled using PyInstaller. To rebuild:
```bash
cd backend
python build_pyinstaller.py
```

This creates standalone executables in `frontend/python-dist/`.

## Notes

- Building for all platforms simultaneously (`dist:all` or `dist:review-all`) can take significant time and disk space
- Cross-compilation from one platform to another may not always work reliably
- For production builds, it's recommended to build each platform on its native OS
