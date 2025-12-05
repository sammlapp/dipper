# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dipper is a bioacoustics machine learning desktop application built with:
- **Frontend**: Electron + React with Material-UI
- **Backend**: Python HTTP server (aiohttp) on port 8000
- **Communication**: HTTP REST API (frontend → backend)
- **ML Processing**: Separate Python subprocesses for inference, training, and extraction

## Quick Start Commands

### Frontend Development
```bash
cd frontend
npm install                                # Install dependencies
npm run electron-dev-pyinstaller           # Full dev mode with backend (recommended)
npm run electron-dev                       # Frontend only (limited functionality)
npm run build                              # Build React app
npm run dist:mac                           # Build macOS app
```

### Backend Development
```bash
cd backend
./pyinstaller-venv-light/bin/pyinstaller --clean --noconfirm http_server.spec
cp dist/lightweight_server ../frontend/python-dist/lightweight_server
```

### Python Scripts Location
All ML scripts are in `backend/scripts/`:
- `inference.py` - Run model inference
- `train_model.py` - Train custom models
- `create_extraction_task.py` - Create annotation tasks
- `load_model.py` - Model loading utilities
- `file_selection.py` - Audio file resolution
- `config_utils.py` - Configuration handling

## Architecture

### Communication Flow
1. User interacts with React UI (InferenceTab, TrainingTab, etc.)
2. Frontend TaskManager.js sends HTTP POST/GET to localhost:8000
3. Backend lightweight_server.py receives request
4. Backend spawns subprocess running ML script in conda environment
5. Frontend polls status endpoint every 2 seconds
6. Subprocess writes `.status` file with progress updates
7. Backend reads .status and returns to frontend
8. Results saved to job folder

### File Structure
```
training_gui/
├── frontend/
│   ├── src/
│   │   ├── App.js                    # Main React app
│   │   ├── main.js                   # Electron main (full app)
│   │   ├── main-review.js            # Electron main (review-only)
│   │   ├── preload.js                # IPC bridge (mostly unused)
│   │   ├── components/               # React tabs (Inference, Training, etc.)
│   │   └── utils/TaskManager.js      # Task orchestration
│   ├── python-dist/                  # PyInstaller backend executable
│   └── package.json
├── backend/
│   ├── lightweight_server.py         # HTTP server (2500 lines, 30+ endpoints)
│   ├── scripts/                      # ML task scripts
│   ├── build_pyinstaller.py          # Build standalone server
│   └── http_server.spec              # PyInstaller config
└── docs/                             # Markdown documentation
```

### Key Endpoints
- `POST /inference/run` - Start inference job
- `GET /inference/status/{job_id}` - Check job status
- `POST /training/run` - Start training job
- `POST /extraction/run` - Start extraction job
- `GET /clip` - Get audio clip/spectrogram
- `POST /annotation/load` - Load annotation task (ReviewTab)

## Important Patterns

### Status Tracking
Jobs write `.status` JSON files:
```json
{
  "status": "running",
  "stage": "processing_files",
  "progress": 45,
  "message": "Processing 100 audio files",
  "timestamp": 1699564829.123
}
```

Backend reads these files and returns via status endpoints. Frontend displays in TaskMonitor.

### Job Folder Structure
```
<output_dir>/<task_name>_<timestamp>/
├── config.json           # Job configuration
├── logs.txt              # Console output
├── .status               # Real-time progress (JSON)
├── predictions.csv       # Inference results
└── model.pt              # Training results
```

### Environment Management
- **Lightweight env**: PyInstaller executable (bundled with app, ~50MB)
- **Heavy env**: Conda environment with PyTorch (auto-downloaded on first use, ~700MB)
- **Download**: From Google Drive to system cache (`appdirs.user_cache_dir("Dipper")`)
- **Location**: `~/Library/Caches/Dipper/envs/dipper_pytorch_env` (macOS)

## Development Modes

### Recommended: PyInstaller Dev Mode
```bash
npm run electron-dev-pyinstaller
```
- Starts React dev server (localhost:3000)
- Starts lightweight_server (localhost:8000)
- Launches Electron with full functionality
- Hot reload for React changes
- **Note**: Must rebuild PyInstaller exe after backend changes

### Limited: Frontend Only Mode
```bash
npm run electron-dev
```
- Only starts React dev server
- No backend running (HTTP calls fail)
- Use for UI-only testing

## Build System

### Full Application
```bash
npm run dist:mac          # macOS (both Intel + ARM)
npm run dist:mac-arm64    # macOS ARM only
npm run dist:win          # Windows
npm run dist:linux        # Linux
```

Builds include:
- React app (built static files)
- Electron framework
- PyInstaller backend executable
- Does NOT include conda environment (downloaded on-demand)

### Review-Only Application
```bash
npm run dist:review-mac   # Smaller app with only ReviewTab
```

Uses `REACT_APP_REVIEW_ONLY=true` environment variable.

## Common Development Tasks

### Modifying Backend API
1. Edit `backend/lightweight_server.py`
2. Rebuild PyInstaller: `cd backend && python build_pyinstaller.py`
3. Copy to frontend: `cp dist/lightweight_server ../frontend/python-dist/`
4. Restart dev server

### Modifying ML Scripts
1. Edit script in `backend/scripts/`
2. If using PyInstaller dev mode: Rebuild PyInstaller (scripts are bundled)
3. If using custom Python env: Changes apply immediately

### Adding New HTTP Endpoint
1. Add handler method in `BackendServer` class
2. Register in `setup_routes()`: `self.app.router.add_post("/path", self.handler)`
3. Add CORS in `setup_cors()`
4. Rebuild PyInstaller

### Adding New Tab/Component
1. Create component in `frontend/src/components/`
2. Import in `App.js`
3. Add to tab list (if not review-only)
4. Add Material-UI tab panel

## Testing

### Quick Validation
```bash
# Test React app in browser
cd frontend && npm start

# Test Electron app
cd frontend && npm run build && npx electron .

# Test Python backend
cd backend && ./pyinstaller-venv-light/bin/python lightweight_server.py --port 8000
```

### Backend Health Check
```bash
curl http://localhost:8000/health
```

## Configuration

Settings stored in JSON files with structure:
- Inference settings (batch_size, overlap, num_workers)
- Training parameters (learning_rate, epochs, augmentation)
- Model configurations
- File paths (input/output directories)

Managed through Settings tab, saved/loaded via HTTP endpoints.

## Important Notes

1. **IPC is mostly unused**: Communication is primarily HTTP, not Electron IPC
2. **Two Python environments**: PyInstaller for server, conda for ML tasks
3. **Status polling**: Frontend polls every 2 seconds for job updates
4. **Subprocess isolation**: Each job runs in separate Python process
5. **Review-only build**: Conditional rendering based on REACT_APP_REVIEW_ONLY

## Dependencies

**Frontend:**
- React 18.3.1, Material-UI 5.15.0, Electron 28.3.3

**Backend:**
- Python 3.11, aiohttp, PyTorch, OpenSoundscape, librosa, pandas

**Build:**
- electron-builder, PyInstaller, conda-pack

## Version Management

### Bumping Version

Version numbers are defined in three places:
1. `frontend/package.json` (line 3)
2. `frontend/src-tauri/Cargo.toml` (line 3)
3. `frontend/src-tauri/tauri.conf.json` (line 10)

To update all three at once:
```bash
cd frontend
npm run version-bump <new-version>
```

Examples:
```bash
npm run version-bump 0.0.7       # Next patch
npm run version-bump 0.1.0       # Next minor
npm run version-bump 1.0.0       # Next major
npm run version-bump 1.0.0-beta  # Pre-release
```

The script automatically updates all files and shows next steps:
1. Review changes: `git diff`
2. Update Cargo.lock: `cd frontend/src-tauri && cargo check`
3. Commit: `git add -A && git commit -m "bump version to X.Y.Z"`
4. Tag: `git tag vX.Y.Z`
5. Build: `npm run tauri:build:all`

See `scripts/README.md` for more details.

## Troubleshooting

**Issue**: Electron doesn't start
**Fix**: Build React app first: `npm run build`

**Issue**: Backend API not responding
**Fix**: Check if lightweight_server is running on port 8000

**Issue**: ML tasks fail
**Fix**: Check if conda environment downloaded: `~/Library/Caches/Dipper/envs/`

**Issue**: PyInstaller changes not reflected
**Fix**: Rebuild and copy: `cd backend && python build_pyinstaller.py && cp dist/lightweight_server ../frontend/python-dist/`

**Issue**: Status messages not showing in UI
**Fix**: Check `.status` file exists in job folder and backend logs show file reads
