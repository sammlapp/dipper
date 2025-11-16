# Dipper - Application Architecture

**Last Updated:** November 2025

## Overview

Dipper is a cross-platform bioacoustics machine learning application built with:
- **Frontend**: Electron + React desktop application
- **Backend**: Python HTTP server (aiohttp) for ML processing
- **Communication**: HTTP REST API (port 8000)
- **Process Model**: Separate Python subprocesses for ML tasks (inference, training, extraction)

## Architecture Diagram

```
┌─────────────────────────────────────────────┐
│         Electron Desktop App                │
│  ┌───────────────────────────────────────┐  │
│  │   React UI (Material-UI)              │  │
│  │   - InferenceTab, TrainingTab, etc.   │  │
│  │   - TaskManager.js (frontend)         │  │
│  └───────────────┬───────────────────────┘  │
│                  │ fetch() HTTP calls        │
│  ┌───────────────▼───────────────────────┐  │
│  │   Electron Main Process               │  │
│  │   - main.js / main-review.js          │  │
│  │   - preload.js (IPC bridge)           │  │  #simplify - IPC is mostly unused now
│  └───────────────┬───────────────────────┘  │
└──────────────────┼───────────────────────────┘
                   │ HTTP (localhost:8000)
       ┌───────────▼──────────────────────────┐
       │   Python HTTP Server                 │
       │   (lightweight_server.py - PyInstaller) │
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
       │   - create_extraction_task.py        │
       │   (Run in conda environment)         │
       └──────────────────────────────────────┘
```

## Communication Flow

### Current Architecture (HTTP-based)

1. **User Action** → React component event
2. **React → Frontend Task Manager** → TaskManager.js manages tasks
3. **Frontend → Backend** → `fetch('http://localhost:8000/...')` HTTP POST/GET
4. **Backend Server** → Receives HTTP request, validates, starts subprocess
5. **Subprocess** → Runs ML script in separate conda environment
6. **Status Updates** → Frontend polls HTTP endpoint every 2 seconds
7. **Results** → Subprocess writes to files, frontend fetches via HTTP

### Legacy IPC (Mostly Unused) #simplify

The application still has Electron IPC infrastructure (preload.js, main.js IPC handlers) but **most communication now goes through HTTP**. The IPC layer is largely vestigial and could be removed.

**Remaining IPC Usage:**
- File/folder dialogs (could be replaced with web-based file pickers) #server_mode
- Window management
- App lifecycle events

## Components

### Frontend (Electron + React)

**Location:** `/frontend/src/`

**Main Files:**
- `App.js` - Main React component with tab navigation
- `main.js` - Electron main process (full app)
- `main-review.js` - Electron main process (review-only app)
- `preload.js` - IPC bridge (mostly unused) #simplify

**React Components:**
- `components/InferenceTab.js` - Model inference UI
- `components/TrainingTab.js` - Model training UI
- `components/ExtractionTab.js` - Clip extraction/annotation task creation
- `components/ExploreTab.js` - Results exploration and visualization
- `components/ReviewTab.js` - Audio clip annotation interface
- `components/TaskMonitor.js` - Task queue and status display
- `utils/TaskManager.js` - Task orchestration and HTTP communication

**Environment Variable:**
- `REACT_APP_REVIEW_ONLY=true` - Builds review-only version (no nav, single tab)

### Backend (Python HTTP Server)

**Location:** `/backend/`

**Main Server:**
- `lightweight_server.py` - aiohttp HTTP server on port 8000
  - Handles all HTTP endpoints
  - Manages running jobs in `running_jobs` dict
  - Spawns ML task subprocesses
  - Serves audio clips and spectrograms
  - Reads `.status` files for detailed task progress

**Build:**
- `build_pyinstaller.py` - Builds standalone executable
- `http_server.spec` - PyInstaller specification
- Output: `frontend/python-dist/lightweight_server` (bundled with Electron app)

**ML Task Scripts:** `/backend/scripts/`
- `inference.py` - Run model inference
- `train_model.py` - Train custom models
- `create_extraction_task.py` - Create annotation tasks from detections
- `load_model.py` - Model loading utilities
- `file_selection.py` - Audio file resolution (glob patterns, file lists)
- `config_utils.py` - Configuration file handling

**Status Tracking:**
- Each job writes `.status` JSON file in job folder
- Contains: status, stage, progress %, message, metadata
- Backend reads and returns via HTTP status endpoints
- Frontend polls and displays in TaskMonitor

### HTTP API Endpoints

**Health & Utility:**
- `GET /` - Root handler
- `GET /health` - Health check
- `POST /scan_folder` - Scan directory for audio files
- `DELETE /cache` - Clear audio cache

**Audio Processing:**
- `GET /clip` - Get single audio clip/spectrogram
- `POST /clips/batch` - Get multiple clips
- `POST /get_sample_detections` - Sample detections from CSV
- `POST /load_scores` - Load prediction scores

**Configuration:**
- `POST /config/save` - Save configuration to file
- `POST /config/load` - Load configuration from file
- `POST /config/validate` - Validate configuration

**Environment Management:**
- `POST /env/check` - Check Python environment
- `POST /env/setup` - Setup/download conda environment

**ML Tasks:**
- `POST /inference/run` - Start inference job
- `GET /inference/status/{job_id}` - Check inference status
- `POST /inference/cancel/{job_id}` - Cancel inference

- `POST /training/run` - Start training job
- `GET /training/status/{job_id}` - Check training status
- `POST /training/cancel/{job_id}` - Cancel training

- `POST /extraction/run` - Start extraction job
- `GET /extraction/status/{job_id}` - Check extraction status
- `POST /extraction/cancel/{job_id}` - Cancel extraction

**Annotation (Review Tab):**
- `POST /annotation/load` - Load annotation task
- `POST /annotation/save` - Save annotations
- `POST /annotation/export` - Export annotations

## Python Environment Strategy

### Lightweight Environment (PyInstaller)

**Purpose:** HTTP server and basic audio processing
**Build:** PyInstaller bundles Python + dependencies into standalone executable
**Location:** `frontend/python-dist/lightweight_server`
**Included in:** All Electron builds
**Size:** ~50MB

**Dependencies:**
- aiohttp, pandas, numpy, librosa, soundfile, Pillow, scipy
- gdown (for environment downloads)
- appdirs (for cache directories)

### Heavy Environment (Conda) #simplify

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

**Download System:**
- Google Drive file ID: `1rsJjnCWjkiMDPimwg11QKsI-tOS7To8O`
- Uses `gdown` library for download
- Downloads to cache on first inference/training job
- Reused across app restarts

**Custom Environment:**
- Users can specify custom Python environment path in settings
- Bypasses default cache environment

## Process Management

### Job Lifecycle

1. **Job Creation:**
   - Frontend creates config JSON with job parameters
   - Sends to `/inference/run`, `/training/run`, or `/extraction/run`

2. **Job Start:**
   - Backend generates unique `job_id`
   - Creates job folder: `<output_dir>/<task_name>_<timestamp>/`
   - Writes config to `job_folder/config.json`
   - Creates log file: `job_folder/logs.txt`
   - Spawns subprocess: `python <script> --config <config_path>`
   - Stores job info in `running_jobs[job_id]`

3. **Job Execution:**
   - Subprocess runs in separate process
   - Writes `.status` file with progress updates
   - Logs to `logs.txt`
   - Generates outputs in job folder

4. **Status Polling:**
   - Frontend polls status endpoint every 2 seconds
   - Backend reads `.status` file and process state
   - Returns: status, stage, progress %, message, metadata

5. **Job Completion:**
   - Subprocess exits with code 0 (success) or non-zero (error)
   - Backend reads final status
   - Frontend displays results or error

6. **Cancellation:**
   - User clicks cancel in TaskMonitor
   - Frontend sends cancel request
   - Backend kills subprocess via `process.terminate()`
   - Marks job as cancelled

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

## Build System

### Full Application (Dipper)

**Build Command:** `npm run dist:mac` (or `:win`, `:linux`)

**Steps:**
1. `npm run build` - Build React app
2. `npm run build:python-pyinstaller` - Build Python server with PyInstaller
3. `electron-builder` - Package Electron app

**Output:**
- macOS: `.dmg` installer
- Windows: `.exe` NSIS installer
- Linux: `.AppImage`

**Bundled:**
- React app (built, static HTML/CSS/JS)
- Electron framework
- PyInstaller Python server executable
- Node.js (via Electron)

**NOT Bundled:**
- Heavy conda environment (downloaded on-demand)

### Review-Only Application (Dipper Review)

**Build Command:** `npm run dist:review-mac`

**Differences:**
- `REACT_APP_REVIEW_ONLY=true` environment variable
- Uses `main-review.js` instead of `main.js`
- No navigation drawer
- Only ReviewTab component
- Smaller bundle size (~31KB less JavaScript)
- Different app ID: `com.bioacoustics.traininggui.review`

**Build Script:** `scripts/build-review.js`

## Development Modes

### Standard Development

**Command:** `npm run electron-dev`

**Process:**
1. Start React dev server on http://localhost:3000 (hot reload)
2. Wait for server to be ready
3. Start Electron pointing to localhost:3000
4. Backend server NOT running (HTTP calls will fail) #simplify

**Problem:** Most features don't work without backend
**Limitation:** Can only test UI, not functionality

### PyInstaller Development

**Command:** `npm run electron-dev-pyinstaller`

**Process:**
1. Start React dev server on http://localhost:3000
2. Start lightweight_server on http://localhost:8000
3. Wait for both servers
4. Start Electron

**Advantage:** Full functionality with hot reload
**Limitation:** Must rebuild PyInstaller exe after backend changes

## Complexity Analysis & Simplification Opportunities

### #simplify - Electron IPC Layer

**Current State:**
- Electron IPC (main.js, preload.js) exists but mostly unused
- Communication primarily via HTTP to localhost:8000
- IPC only used for file dialogs and window management

**Simplification:**
- Remove unused IPC handlers
- Use web-based file pickers instead of native dialogs
- Consider removing Electron entirely for server mode

### #simplify - Dual Environment System

**Current State:**
- Two separate Python environments (lightweight + heavy)
- PyInstaller for HTTP server
- Conda for ML tasks
- Complex download/caching system

**Simplification Options:**
1. Single conda environment with all dependencies
2. Docker container with everything pre-installed
3. Cloud-based ML backend (no local Python)

**Trade-offs:**
- Simplicity vs. app size
- Download time vs. bundled size
- User control vs. ease of deployment

### #simplify - Build Complexity

**Current State:**
- Multiple build scripts (build_pyinstaller.py, build-review.js)
- Complex PyInstaller spec with script bundling
- Separate builds for review vs. full app
- Cross-platform builds require platform-specific steps

**Simplification:**
- Unified build script
- Docker-based builds for consistency
- Single codebase with feature flags instead of separate builds

## Server Mode Requirements #server_mode

To run Dipper as a web application (browser-based, no Electron):

### Required Changes

**1. Remove Electron Dependencies**
- ❌ Remove: main.js, preload.js, Electron-specific code
- ✅ Keep: React app, all components
- ✅ Use: Create React App or Vite for web builds

**2. Replace File Selection** #server_mode
- ❌ Remove: Electron file dialogs (`window.electronAPI.selectFile()`)
- ✅ Replace: Web file pickers (`<input type="file">`)
- ⚠️ Limitation: No directory selection in web browsers
- ✅ Alternative: Server-side file browsing API

**3. Backend Modifications**
- ✅ Keep: aiohttp server (already web-compatible)
- ✅ Add: CORS headers (already implemented)
- ✅ Add: Authentication/authorization
- ✅ Add: Session management
- ✅ Add: Multi-user job isolation

**4. Deployment Architecture** #server_mode

```
┌─────────────────┐
│  Web Browser    │
│  (React App)    │
└────────┬────────┘
         │ HTTPS
┌────────▼────────────────┐
│  Web Server (nginx)     │
│  - Static files (React) │
│  - Reverse proxy        │
└────────┬────────────────┘
         │ Proxy
┌────────▼────────────────┐
│  Backend Server         │
│  (lightweight_server)   │
│  - Port 8000            │
│  - HTTP API             │
└────────┬────────────────┘
         │ subprocess
┌────────▼────────────────┐
│  ML Task Processes      │
│  (inference, training)  │
└─────────────────────────┘
```

**5. Multi-User Considerations** #server_mode

**Critical Issues:**
- Job ID conflicts between users
- Shared file system access
- Concurrent ML task execution
- Resource limits (CPU, GPU, memory)

**Solutions:**
- User sessions with unique namespaces
- Per-user job directories
- Job queue with resource allocation
- User authentication and quotas

**6. File Access** #server_mode

**Desktop Mode:**
- Direct file system access via native dialogs
- User browses local files

**Server Mode Options:**

**Option A: Upload-based**
- Users upload audio files to server
- Server stores in temporary directory
- Process uploaded files
- Download results

**Option B: Server-side browsing**
- Users browse server file system via web UI
- Server provides file tree API
- Security: Restrict to allowed directories

**Option C: Cloud storage integration**
- Integration with S3, Google Drive, etc.
- Users select files from cloud storage
- Server downloads and processes

**7. Authentication & Security** #server_mode

**Required:**
- User login system
- Session management (JWT tokens)
- API authentication on all endpoints
- File access permissions
- Job ownership validation

**Considerations:**
- Single-user vs. multi-user mode
- Public vs. private instances
- Resource quotas per user
- Data isolation and privacy

### Server Mode Feature Matrix

| Feature | Desktop (Electron) | Server (Web) | Notes |
|---------|-------------------|--------------|-------|
| File browsing | ✅ Native dialogs | ⚠️ Server-side or upload | #server_mode |
| Audio playback | ✅ Direct file access | ✅ HTTP streaming | Already works |
| ML inference | ✅ Local processing | ✅ Server processing | Same backend |
| Model training | ✅ Local processing | ✅ Server processing | Same backend |
| Multi-user | ❌ Single user | ⚠️ Needs implementation | #server_mode |
| Authentication | ❌ Not needed | ✅ Required | #server_mode |
| File uploads | ❌ Not needed | ✅ Required | #server_mode |
| GPU access | ✅ User's GPU | ⚠️ Shared server GPU | Resource management |
| Offline use | ✅ Fully offline | ❌ Requires connection | - |

## Technology Stack

**Frontend:**
- React 18.3.1
- Material-UI 5.15.0
- Electron 28.3.3
- react-select 5.10.1

**Backend:**
- Python 3.11
- aiohttp (HTTP server)
- PyTorch (ML framework)
- OpenSoundscape (bioacoustics)
- librosa (audio processing)
- pandas, numpy (data)
- gdown (Google Drive downloads)
- appdirs (system paths)

**Build Tools:**
- electron-builder 24.9.0
- PyInstaller
- conda-pack
- concurrently, wait-on (dev orchestration)

## Codebase Statistics

**Frontend:**
- ~15 React components
- ~3,000 lines of component code
- ~2,000 lines of CSS
- 2 Electron main processes

**Backend:**
- ~2,500 lines in lightweight_server.py
- ~10 Python ML scripts
- ~30 HTTP endpoints

**Documentation:**
- 13 markdown files
- ~2,000 lines of documentation
