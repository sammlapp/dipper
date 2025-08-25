# Build Strategy Implementation Summary

This document summarizes the complete implementation of the build strategy that consolidates all lightweight backend functionality into a single `lightweight_server.py` that is compiled with PyInstaller.

## Architecture Overview

```
Electron Frontend
    ↓ (HTTP requests for most operations)
PyInstaller lightweight_server.exe (port 8000)
    ↓ (subprocess calls)
conda-pack dipper_pytorch_env/bin/python inference.py --config config.json

    ↓ (direct IPC for UI-specific operations like file dialogs)
Electron IPC → File Selection & Audio Clip Creation
```

## Key Components

### 1. Lightweight Server (`lightweight_server.py`)
A single HTTP server executable that handles ALL backend communication:

**Existing Capabilities:**
- Audio clip processing and spectrogram generation  
- Folder scanning for audio files
- Sample detection analysis
- Score file loading (CSV and PKL formats)
- Column extraction from prediction files

**New Capabilities Added:**
- **Config Management**: Save/load inference configurations
- **Environment Management**: Extract/manage conda-pack environments
- **Process Management**: Run inference with conda-pack Python environments

**HTTP Endpoints:**
```
POST /config/save        - Save inference configuration
POST /config/load        - Load inference configuration  
POST /config/validate    - Validate audio files
POST /env/check          - Check environment status
POST /env/setup          - Setup conda-pack environment
POST /inference/run      - Run inference with conda environment
```

### 2. Modified Inference Script (`inference.py`)
- Now accepts config file as single argument: `--config path/to/config.json`
- Config file contains all settings: model, files, output path, inference parameters
- Compatible with conda-pack environment execution

### 3. Conda-Pack Environment (`dipper_pytorch_env.tar.gz`)
- Contains PyTorch, bioacoustics-model-zoo, and all ML dependencies
- Built using `npm run build:conda-pack`
- Extracted on-demand at runtime
- Self-contained Python environment for ML inference

### 4. Updated Frontend Integration
- **HTTP API Communication**: All data processing operations use lightweight server via HTTP
- **Direct IPC Communication**: Only UI-specific operations like file dialogs and audio clip creation use Electron IPC
- **Unified Architecture**: Config management, score loading, file operations all via HTTP API
- **File Selection**: Updated to support both CSV and PKL files for prediction loading
- **Error Reporting**: Enhanced to show actual errors from log files instead of generic messages

## Build Process

### 1. Build PyInstaller Server
```bash
cd frontend
npm run build:python-pyinstaller
```
Creates: `frontend/python-dist/lightweight_server/lightweight_server`

### 2. Build Conda-Pack Environment  
```bash
cd frontend  
npm run build:conda-pack
```
Creates: `environments/dipper_pytorch_env.tar.gz`

### 3. Test Complete Pipeline
```bash
node test_build_pipeline.js
```

## Runtime Flow

1. **Frontend Startup**: Electron starts and launches lightweight_server.exe on port 8000
2. **User Configuration**: User selects model, files, and settings via UI
3. **Config Save**: Frontend sends config to `/config/save` endpoint
4. **Environment Setup**: Server checks/extracts conda-pack environment via `/env/setup`
5. **Inference Execution**: Server runs inference via `/inference/run` using conda-pack Python
6. **Results**: Inference results returned to frontend and displayed

## Benefits of This Architecture

### ✅ **Single Executable Approach**
- Only one PyInstaller build needed (`lightweight_server.exe`)
- Simpler build process and distribution
- Consistent HTTP API for all backend operations

### ✅ **Lightweight Distribution**  
- PyInstaller executable excludes heavy ML dependencies
- Conda-pack environment downloaded/extracted on-demand
- Smaller initial download size

### ✅ **Cross-Platform Compatibility**
- HTTP communication works on all platforms
- Conda-pack environments work on Windows, Mac, Linux
- PyInstaller builds work consistently

### ✅ **Maintainable Architecture**
- All backend logic in single file (`lightweight_server.py`)
- Clear separation between lightweight operations and ML inference
- Easy to extend with new endpoints

## File Structure
```
training_gui/
├── backend/
│   ├── lightweight_server.py          # Main server (compiled to executable)
│   ├── scripts/inference.py           # ML inference script (runs in conda-pack)
│   └── dipper_pytorch_env.yml         # Conda environment specification
├── frontend/
│   ├── python-dist/
│   │   └── lightweight_server/        # PyInstaller executable
│   └── src/App.js                     # Frontend (updated to use HTTP API)
├── environments/
│   └── dipper_pytorch_env.tar.gz      # Conda-pack environment
└── test_build_pipeline.js             # Complete build testing
```

## Testing

The test pipeline validates:
- ✅ PyInstaller build creates working executable
- ✅ Conda-pack environment builds successfully  
- ✅ Lightweight server starts and responds correctly
- ✅ All required files present for distribution

Run: `node test_build_pipeline.js`

## Next Steps

1. **Build Electron App**: `cd frontend && npm run dist`
2. **Test Complete Application**: Full integration testing with ML inference
3. **Create Distribution Packages**: Platform-specific installers

This implementation successfully consolidates the build strategy into a single, maintainable server architecture while preserving all functionality and improving the build/distribution process.

## Current Architectural Issues

### Unified Communication Architecture
All tabs now use HTTP API for data processing operations:

1. **ExploreTab**: Migrated to use HTTP API for score loading
   - File: `/frontend/src/components/ExploreTab.js`
   - Method: `fetch('http://localhost:8000/load_scores')` and `fetch('http://localhost:8000/files/count-rows')`
   - Direct IPC removed for data operations

2. **Lightweight Server**: Provides comprehensive HTTP API
   - File: `/backend/lightweight_server.py`
   - Method: Imports and calls script functions (`load_scores()`, `count_file_rows()`)
   - **Resolution**: Function name fixed and endpoints working correctly

3. **ReviewTab**: Uses correct script names
   - File: `/frontend/src/components/ReviewTab.js`
   - Method: `window.electronAPI.runPythonScript('load_extraction_task.py')` (renamed for consistency)
   - Could be migrated to HTTP API in future if needed

### PKL File Support Status
- ✅ `load_scores.py` fully supports both CSV and PKL files
- ✅ Electron IPC handlers accept both file types  
- ✅ ExploreTab UI updated for both formats
- ✅ `lightweight_server.py` function name fixed (now calls `load_scores()` correctly)
- ✅ Both source and dist-electron main.js files updated for PKL support

## Architecture Migration Summary

**Issues Identified and Resolved:**
1. **Function Name Mismatch**: `lightweight_server.py` was calling non-existent `load_scores_from_file()` - fixed to call `load_scores()`
2. **File Selection**: PKL files couldn't be selected in ExploreTab - fixed by updating Electron IPC handlers  
3. **Mixed Communication Patterns**: ExploreTab used direct IPC while other operations used HTTP API - migrated to unified HTTP API
4. **Terminology Consistency**: Renamed `load_annotation_task.py` to `load_extraction_task.py` and updated all references

**Final Architecture Status:**
- ✅ **Unified HTTP API**: All data processing operations now use `lightweight_server.py` HTTP endpoints
- ✅ **PKL File Support**: Fully functional for both CSV and PKL prediction files via HTTP API
- ✅ **Sparse Data Handling**: Proper handling of NaN values in sparse prediction data
- ✅ **Consistent Terminology**: All annotation/extraction terminology aligned
- ✅ **Error Reporting**: Enhanced to show actual log content instead of generic messages
- ✅ **Build Strategy Alignment**: All backend functionality consolidated into PyInstaller executable

**Remaining IPC Usage** (appropriate for UI operations):
- File selection dialogs (`electronAPI.selectCSVFiles()`, etc.)
- Audio clip creation (`electronAPI.runPythonScript('create_audio_clips.py')`)
- Direct script execution for ReviewTab (`load_extraction_task.py`) - could be migrated to HTTP API in future