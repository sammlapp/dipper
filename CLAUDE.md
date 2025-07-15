# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Architecture

This is a bioacoustics machine learning application with an Electron + React frontend and Python backend for ML processing. The application provides species detection inference, model training, data exploration, and active learning capabilities.

**Key Components:**
- **Frontend**: Electron desktop app with React UI using Material-UI components
- **Backend**: Python scripts for ML operations using PyTorch and OpenSoundscape
- **Models**: Integration with bioacoustics model zoo (BirdNET, Perch, HawkEars, RanaSierraeCNN)
- **Data Flow**: Electron IPC communication between frontend and Python subprocesses

## Development Commands

### Frontend Development
```bash
cd frontend
npm install                    # Install dependencies
npm run dev                    # Start development server with hot reload
npm start                      # Start React app in browser (testing)
npm run build                  # Build React app for production
npm run electron-build         # Build Electron app
npm run build-all             # Build both React and Electron
npm test                       # Run React tests
```

### Backend Development
```bash
cd backend
python -m venv venv           # Create virtual environment
source venv/bin/activate      # Activate venv (Windows: venv\Scripts\activate)
pip install -r requirements.txt  # Install Python dependencies
```

### Python Scripts
All Python scripts are in `backend/scripts/`:
- `inference.py` - Run model inference on audio files
- `train_model.py` - Train custom bioacoustics models
- `test_environment.py` - Test Python environment setup
- `scan_folder.py` - Scan folders for audio files
- `create_audio_clips.py` - Create audio clips from detections

## Architecture Details

### Frontend Structure
- **Main Process**: `frontend/src/electron/main.js` - Electron main process with IPC handlers
- **Renderer**: `frontend/src/App.js` - React app with tab-based navigation
- **Components**: `frontend/src/components/` - Material-UI components for each tab
- **IPC Communication**: Frontend communicates with Python backend via Electron IPC

### Backend Structure
- **Inference Pipeline**: Uses bioacoustics model zoo for species detection
- **Training Pipeline**: Custom CNN training with OpenSoundscape
- **Data Processing**: Audio file scanning, clip generation, and annotation loading
- **Model Support**: PyTorch and TensorFlow models via unified interface

### Key Dependencies
- **Frontend**: React 18, Material-UI 5, Electron 28
- **Backend**: PyTorch, OpenSoundscape, bioacoustics-model-zoo, librosa, pandas
- **Build Tools**: electron-builder, react-scripts, concurrently

## Configuration Management

The application uses JSON configuration files for:
- Inference settings (batch size, overlap, worker count)
- Training parameters (learning rate, epochs, data augmentation)
- Model-specific configurations
- File paths and output directories

Settings are managed through the Settings tab and can be saved/loaded as JSON files.

## Testing and Validation

### Quick Start Testing
1. Test React app in browser: `cd frontend && npm start`
2. Test Electron app: `cd frontend && npm run build && npx electron .`
3. Test Python environment: `cd backend && python scripts/test_environment.py`

### Development Flow
1. Frontend development uses hot reload via `npm run dev`
2. Backend testing through individual script execution
3. Full integration testing through Electron app

## File Structure Notes

- `frontend/src/App.js` - Main React component with tab navigation
- `frontend/src/components/` - Individual tab components (InferenceTab, TrainingTab, etc.)
- `frontend/src/electron/` - Electron main and preload scripts
- `backend/scripts/` - Python ML processing scripts
- `models/` - Directory for storing trained models
- `configs/` - Configuration file storage
- `build/` - Build output directory

## Common Issues

- If `npm install` fails: Try `npm install --legacy-peer-deps`
- If Electron doesn't start: Ensure React app is built first with `npm run build`
- For Python dependency issues: Install bioacoustics libraries manually or use conda environment