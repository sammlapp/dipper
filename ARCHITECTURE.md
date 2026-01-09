# Dipper - Application Architecture

**Last Updated:** January 2026

## Overview

Dipper is a cross-platform bioacoustics machine learning application with two deployment modes:

- **Desktop Mode**: Tauri + React desktop application
- **Server Mode**: React web app + Python backend (no Tauri)
- **Backend**: Python HTTP server (aiohttp) for ML processing
- **Communication**: HTTP REST API
- **Process Model**: Separate Python subprocesses for ML tasks (inference, training, extraction)

## Architecture Diagram

### Desktop Mode

```
┌─────────────────────────────────────────────┐
│         Tauri Desktop App                   │
│  ┌───────────────────────────────────────┐  │
│  │   React UI (Material-UI)              │  │
│  │   - InferenceTab, TrainingTab, etc.   │  │
│  │   - TaskManager.js (frontend)         │  │
│  └───────────────┬───────────────────────┘  │
│                  │ fetch() HTTP calls        │
│  ┌───────────────▼───────────────────────┐  │
│  │   Tauri Core (Rust)                   │  │
│  │   - Window management                 │  │
│  │   - Native file dialogs               │  │
│  └───────────────────────────────────────┘  │
└──────────────────┼───────────────────────────┘
                   │ HTTP (localhost:8000)
       ┌───────────▼──────────────────────────┐
       │   Python HTTP Server                 │
       │   (lightweight_server - PyInstaller) │
       │   - aiohttp web server               │
       │   - Audio processing (librosa, etc.) │
       │   - Job tracking & status            │
       │   - Environment setup                │
       └───────────┬──────────────────────────┘
                   │ subprocess.Popen()
       ┌───────────▼──────────────────────────┐
       │   ML Task Processes (separate)       │
       │   - inference.py                     │
       │   - train_model.py                   │
       │   - clip_extraction.py               │
       │   (Run in conda environment)         │
       └──────────────────────────────────────┘
```

### Server Mode

```
┌─────────────────┐
│  Web Browser    │
│  (React App)    │
└────────┬────────┘
         │ HTTP/HTTPS
┌────────▼────────────────┐
│  Static File Server     │
│  (npx serve or nginx)   │
│  - Serves React build   │
│  - Port 3001            │
└─────────────────────────┘
         │ fetch() API calls
┌────────▼────────────────┐
│  Python HTTP Server     │
│  (lightweight_server)   │
│  - Port 8001            │
│  - CORS enabled         │
│  - File access controls │
└────────┬────────────────┘
         │ subprocess
┌────────▼────────────────┐
│  ML Task Processes      │
│  (inference, training)  │
└─────────────────────────┘
```

## Communication Flow

1. **User Action** → React component event
2. **React → Frontend Task Manager** → TaskManager.js manages tasks
3. **Frontend → Backend** → `fetch('http://localhost:PORT/...')` HTTP POST/GET
4. **Backend Server** → Receives HTTP request, validates, starts subprocess
5. **Subprocess** → Runs ML script in separate conda environment
6. **Status Updates** → Frontend polls HTTP endpoint every 2 seconds
7. **Results** → Subprocess writes to files, frontend fetches via HTTP

## Server Configuration

Server mode uses a YAML configuration file for settings:

```yaml
server:
  host: 0.0.0.0              # Host to bind to
  port: 8001                 # Python backend port
  static_port: 3001          # React static server port

file_access:
  allowed_base_paths:        # Directories accessible to users
    - /home/username/data
    - /media/audio

jobs:
  max_concurrent: 2          # Max simultaneous ML tasks

logging:
  level: INFO                # Log level
```

**Launch Commands:**
- Development: `./scripts/launch-server-dev.sh [config_file]`
- Production: `./scripts/launch-server.sh [config_file]`

## HTTP API Endpoints

### Health & Utility

- `GET /health` - Health check
- `POST /scan_folder` - Scan directory for audio files
- `DELETE /cache` - Clear audio cache

### Audio Processing

- `GET /clip` - Get audio clip with spectrogram
  - Query params: `file`, `start_time`, `end_time`, `sr`, `spec_height`
- `POST /clips/batch` - Get multiple clips
- `POST /get_sample_detections` - Sample detections from predictions
- `POST /load_scores` - Load prediction scores

### Configuration

- `POST /config/save` - Save configuration to file
- `POST /config/load` - Load configuration from file
- `POST /config/validate` - Validate configuration

### Environment Management

- `POST /env/check` - Check Python environment availability
- `POST /env/setup` - Setup/download conda environment

### ML Tasks - Inference

- `POST /inference/run` - Start inference job
  - Body: `{config: {...}, env_path: "..."}`
  - Returns: `{job_id: "...", job_folder: "..."}`
- `GET /inference/status/{job_id}` - Check inference status
  - Returns: `{status, stage, progress, message, metadata}`
- `POST /inference/cancel/{job_id}` - Cancel inference job

### ML Tasks - Training

- `POST /training/run` - Start training job
  - Body: `{config: {...}, env_path: "..."}`
  - Returns: `{job_id: "...", job_folder: "..."}`
- `GET /training/status/{job_id}` - Check training status
- `POST /training/cancel/{job_id}` - Cancel training job

### ML Tasks - Extraction

- `POST /extraction/run` - Start clip extraction job
  - Body: `{config: {...}, env_path: "..."}`
  - Returns: `{job_id: "...", job_folder: "..."}`
- `GET /extraction/status/{job_id}` - Check extraction status
- `POST /extraction/cancel/{job_id}` - Cancel extraction job

### Annotation (Review Tab)

- `POST /annotation/load` - Load annotation task
  - Body: `{csv_file, audio_folder, ...}`
- `POST /annotation/save` - Save annotations
  - Body: `{csv_file, data: [{...}, ...]}`
- `POST /annotation/export` - Export annotations
- `POST /annotation/stats` - Get annotation statistics

### File Management (Server Mode)

- `POST /files/browse` - Browse files on server
  - Body: `{path: "/path/to/dir"}`
  - Returns: `{current_path, parent_path, items: [{name, type, ...}]}`
- `POST /files/save` - Save file to server
  - Body: `{file_path, content}`
- `POST /files/validate_path` - Check if path is accessible

## Python Environment Strategy

### Lightweight Environment (PyInstaller)

**Purpose:** HTTP server and basic audio processing
**Build:** PyInstaller bundles Python + dependencies into standalone executable
**Location:** `frontend/python-dist/lightweight_server`
**Included in:** All desktop builds
**Size:** ~50MB

**Dependencies:**
- aiohttp, pandas, numpy, librosa, soundfile, Pillow, scipy
- gdown (for environment downloads)
- appdirs (for cache directories)
- PyYAML (for config file parsing)

### Heavy Environment (Conda)

**Purpose:** ML model training and inference (PyTorch, OpenSoundscape)
**Build:** conda-pack creates portable conda environment
**Download:** Auto-downloaded from Google Drive on first use
**Location:** System cache directory via `appdirs.user_cache_dir("Dipper")`
- macOS: `~/Library/Caches/Dipper/envs/dipper_pytorch_env`
- Linux: `~/.cache/Dipper/envs/dipper_pytorch_env`
- Windows: `C:\Users\<user>\AppData\Local\BioacousticsApp\Dipper\Cache\envs\dipper_pytorch_env`

**Size:** ~700MB compressed, ~2GB extracted

**Dependencies:**
- PyTorch, torchaudio, timm, lightning
- OpenSoundscape, bioacoustics-model-zoo
- librosa, pandas, numpy, matplotlib, seaborn
- scikit-learn, scikit-image

**Custom Environment:**
- Users can specify custom Python environment path in settings
- Bypasses default cache environment
- Useful for development or custom package installations

## Process Management

### Job Lifecycle

1. **Job Creation**
   - Frontend creates config JSON with job parameters
   - Sends to `/inference/run`, `/training/run`, or `/extraction/run`

2. **Job Start**
   - Backend generates unique `job_id` (timestamp-based)
   - Creates job folder: `<output_dir>/<task_name>_<timestamp>/`
   - Writes config to `job_folder/config.json`
   - Creates log file: `job_folder/logs.txt`
   - Spawns subprocess: `python <script> --config <config_path>`
   - Stores job info in `running_jobs[job_id]` dict

3. **Job Execution**
   - Subprocess runs in separate process
   - Writes `.status` file with progress updates
   - Logs to `logs.txt` (stdout/stderr)
   - Generates outputs in job folder

4. **Status Polling**
   - Frontend polls status endpoint every 2 seconds
   - Backend reads `.status` file and process state
   - Returns: status, stage, progress %, message, metadata

5. **Job Completion**
   - Subprocess exits with code 0 (success) or non-zero (error)
   - Backend reads final status from `.status`
   - Frontend displays results or error message

6. **Cancellation**
   - User clicks cancel in TaskMonitor
   - Frontend sends cancel request
   - Backend kills subprocess via `process.terminate()`
   - Status marked as cancelled

### Job Storage Structure

```
<output_dir>/
  └── <task_name>_<timestamp>/     # Job folder
      ├── config.json               # Job configuration
      ├── logs.txt                  # Console output
      ├── .status                   # Real-time status (JSON)
      ├── predictions.csv           # Inference output
      ├── model.pt                  # Training output
      └── extraction_task_*.csv     # Extraction output
```

### Status File Format

```json
{
  "status": "running",
  "stage": "processing_files",
  "progress": 45,
  "message": "Processing 100 audio files",
  "timestamp": 1699564829.123,
  "metadata": {
    "files_processed": 45,
    "total_files": 100
  }
}
```

## Build System

### Desktop Application

**Full App:**
```bash
cd frontend
npm run tauri:build:all
```

**Review-Only App:**
```bash
cd frontend
npm run tauri:build:review
```

**Build Process:**
1. Build React app to `frontend/build/`
2. Build PyInstaller executable (if using `:build:all`)
3. Tauri packages everything into platform-specific installer

**Output:**
- macOS: `.dmg` installer
- Windows: `.msi` or `.exe` installer
- Linux: `.AppImage` or `.deb`

**Bundled:**
- React app (built, static HTML/CSS/JS)
- Tauri framework (Rust-based)
- PyInstaller Python server executable
- NOT bundled: Heavy conda environment (downloaded on-demand)

### Server Mode Build

**Build React app for server:**
```bash
cd frontend
npm run build:server
```

**Build PyInstaller backend:**
```bash
cd backend
python build_pyinstaller.py
cp dist/lightweight_server ../frontend/python-dist/
```

## Development Modes

### Desktop Mode

**Full dev mode (recommended):**
```bash
cd frontend
npm run tauri:dev:full
```
- Starts Python backend from source (localhost:8000)
- Starts React dev server with hot reload
- Launches Tauri desktop app with full functionality
- Backend changes apply immediately (no rebuild needed)

**Frontend-only mode:**
```bash
cd frontend
npm run tauri:dev
```
- Only starts React dev server
- No backend running (HTTP calls fail)
- Use for UI-only testing

### Server Mode

**Development (hot reload):**
```bash
./scripts/launch-server-dev.sh [config_file]
```
- Starts Python backend from source
- Starts React dev server with hot reload
- No Tauri compilation
- Access via web browser at `http://localhost:3001`

**Production:**
```bash
./scripts/launch-server.sh [config_file]
```
- Uses PyInstaller backend executable
- Serves built React app via `npx serve`
- Requires PyInstaller rebuild after backend changes

## Components

### Frontend (React)

**Location:** `frontend/src/`

**Main Files:**
- `App.js` - Main React component with tab navigation
- `components/` - All React components

**React Components:**
- `InferenceTab.js` - Model inference UI
- `TrainingTab.js` - Model training UI
- `ExtractionTab.js` - Clip extraction/annotation task creation
- `ExploreTab.js` - Results exploration and visualization
- `ReviewTab.js` - Audio clip annotation interface
- `TaskMonitor.js` - Task queue and status display
- `ServerFileBrowser.js` - Server-side file browsing (server mode)
- `utils/TaskManager.js` - Task orchestration and HTTP communication

**Environment Variables:**
- `REACT_APP_MODE=server` - Enable server mode (no native file dialogs)
- `REACT_APP_BACKEND_PORT=8001` - Backend port (defaults to 8000)
- `REACT_APP_REVIEW_ONLY=true` - Build review-only version

### Backend (Python)

**Location:** `backend/`

**Main Server:**
- `lightweight_server.py` - aiohttp HTTP server
  - Handles all HTTP endpoints (30+ routes)
  - Manages running jobs in `running_jobs` dict
  - Spawns ML task subprocesses
  - Serves audio clips and spectrograms
  - Reads `.status` files for detailed task progress
  - Implements file access controls for server mode

**Build:**
- `build_pyinstaller.py` - Builds standalone executable
- `http_server.spec` - PyInstaller specification
- Output: `frontend/python-dist/lightweight_server`

**ML Task Scripts:** `backend/scripts/`
- `inference.py` - Run model inference
- `train_model.py` - Train custom models
- `clip_extraction.py` - Create annotation tasks from detections
- `load_model.py` - Model loading utilities
- `file_selection.py` - Audio file resolution (glob patterns, file lists)
- `config_utils.py` - Configuration file handling

## Technology Stack

**Frontend:**
- React 18.3.1
- Material-UI 5.15.0
- Tauri 2.x
- react-select 5.10.1

**Backend:**
- Python 3.11
- aiohttp (HTTP server)
- PyTorch (ML framework)
- OpenSoundscape (bioacoustics)
- librosa (audio processing)
- pandas, numpy (data processing)
- PyYAML (config files)
- gdown (Google Drive downloads)
- appdirs (system paths)

**Build Tools:**
- Tauri CLI 2.x
- PyInstaller
- conda-pack
- concurrently, wait-on (dev orchestration)

## Server Mode Features

### File Access Control

Server mode restricts file system access to configured directories:

```yaml
file_access:
  allowed_base_paths:
    - /home/username/data
    - /media/audio
```

**Security:**
- All file paths normalized and validated
- Paths outside allowed directories are rejected
- Symlinks resolved and checked
- Directory traversal attacks prevented

### Server File Browser

Server mode provides a file browser UI component for remote file selection:

**Features:**
- Browse directories on server
- Navigate with breadcrumbs or text input
- Filter by file type (audio, csv, folders)
- Save mode with filename input
- Load mode for selecting existing files

**API:**
- `POST /files/browse` - List directory contents
- `POST /files/validate_path` - Check if path is accessible

### Multi-User Considerations

**Current Implementation:**
- Single-user design (no authentication)
- Job IDs are globally unique
- No user isolation

**Future Enhancements:**
- User authentication and sessions
- Per-user job namespaces
- Resource quotas
- Job queue with priority
- User-specific file access controls

## Version Management

Version numbers defined in three files:
1. `frontend/package.json` (line 3)
2. `frontend/src-tauri/Cargo.toml` (line 3)
3. `frontend/src-tauri/tauri.conf.json` (line 10)

**Update all versions:**
```bash
cd frontend
npm run version-bump 0.1.0
```

See `scripts/README.md` for details.
