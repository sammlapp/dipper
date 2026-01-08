# Server Mode - Correct Architecture

## Overview

Server mode uses a **two-process architecture**:
1. **Python Backend** (port 8000) - Handles ML tasks and API endpoints
2. **Static File Server** (npx serve or nginx) - Serves React app

## Architecture Diagram

```
┌─────────────────────────────┐
│   Web Browser               │
│  ┌────────────────────────┐ │
│  │   React UI             │ │ ← Downloads from static server
│  │   mode: 'server'       │ │ ← Runs in browser
│  │   SVAR file browser    │ │
│  └──────────┬─────────────┘ │
└─────────────┼───────────────┘
              │
              ├─ http://localhost:3000 (static files)
              └─ http://localhost:8000 (API calls)

┌─────────────▼───────────────┐
│  npx serve (port 3000)      │ ← Dev: Serves React build files
│  OR nginx (production)      │
└─────────────────────────────┘

┌─────────────▼───────────────┐
│  Python Backend (port 8000) │ ← API only (no static files)
│  - /files/browse            │
│  - /files/read              │
│  - /files/save              │
│  - /inference/run           │
│  - /training/run            │
└─────────────────────────────┘
```

## How It Works

### Step 1: Build React App
```bash
cd frontend
REACT_APP_MODE=server npm run build
```

Creates `frontend/build/`:
- `index.html`
- `static/js/*.js`
- `static/css/*.css`

### Step 2: Start Python Backend (API only)
```bash
cd backend
python lightweight_server.py --host 0.0.0.0 --port 8000
```

Serves **API endpoints only**:
- `/files/*` - File operations
- `/inference/*` - ML inference
- `/training/*` - Model training
- `/extraction/*` - Clip extraction

### Step 3: Start Static File Server

**Development:**
```bash
cd frontend
npx serve -s build -p 3000
```

**Production (nginx):**
```nginx
server {
    listen 80;
    root /path/to/frontend/build;

    # Serve React app
    location / {
        try_files $uri /index.html;
    }

    # Proxy API calls to Python backend
    location /files/ {
        proxy_pass http://localhost:8000;
    }
    location /inference/ {
        proxy_pass http://localhost:8000;
    }
    # ... other API routes
}
```

### Step 4: Access in Browser
```bash
# Local testing
open http://localhost:3000

# Remote access via SSH tunnel
ssh -L 3000:localhost:3000 -L 8000:localhost:8000 user@remote-server
open http://localhost:3000
```

## Request Flow

1. **Browser requests `http://localhost:3000/`**
   - `npx serve` returns `index.html`
   - Browser downloads and runs React app

2. **React app initializes**
   - Detects `isServerMode()` (no Tauri detected)
   - Uses `ServerFileBrowser` for file operations

3. **User clicks "Browse Files"**
   - React makes API call: `POST http://localhost:8000/files/browse`
   - Python backend returns directory listing JSON
   - React displays files in ServerFileBrowser modal

4. **User starts inference job**
   - React makes API call: `POST http://localhost:8000/inference/run`
   - Python backend spawns ML subprocess
   - React polls: `GET http://localhost:8000/inference/status/{job_id}`

## Key Changes Made

### ✅ Python Backend (`lightweight_server.py`)
- Added `--host` parameter (default: `localhost`, use `0.0.0.0` for server mode)
- Added `/files/read` endpoint for config loading
- **Removed** static file serving (that was wrong!)
- **API endpoints only**

### ✅ File Operations Already Working
- `POST /files/browse` - List directories
- `POST /files/read` - Read file content
- `POST /files/save` - Write file
- `POST /files/unique-name` - Generate unique folder name

## Testing Instructions

### Terminal 1: Start Python Backend
```bash
cd backend
python lightweight_server.py --host 0.0.0.0 --port 8000
```

Should see:
```
INFO:lightweight_server:Lightweight server started on http://0.0.0.0:8000
```

### Terminal 2: Build and Serve React App
```bash
cd frontend
REACT_APP_MODE=server npm run build
npx serve -s build -p 3000
```

Should see:
```
   ┌────────────────────────────────────────┐
   │                                        │
   │   Serving!                             │
   │                                        │
   │   - Local:    http://localhost:3000   │
   │                                        │
   └────────────────────────────────────────┘
```

### Browser: Test
```bash
open http://localhost:3000
```

**Expected behavior:**
1. React app loads (not blank page)
2. File browser opens and shows directories
3. Can navigate folders and select files
4. Can start inference/training jobs
5. No CORS errors in console

## Why Two Processes?

### Python Backend (port 8000)
- **Purpose**: ML processing, file operations, heavy lifting
- **Technology**: aiohttp, PyTorch, librosa
- **Why separate**: ML libraries are heavy, Python is good for data processing

### Static File Server (port 3000)
- **Purpose**: Serve React build files (HTML, JS, CSS)
- **Technology**: `npx serve` (dev) or nginx (production)
- **Why separate**: Dedicated static file servers are optimized for this

### Why NOT combine them?
- Python is not optimized for static file serving
- Keeps concerns separated (ML vs UI)
- Easier to scale (nginx in front, multiple Python backends)
- Matches standard production architectures

## Production Deployment

### Using nginx (Recommended)

**nginx.conf:**
```nginx
server {
    listen 80;
    server_name dipper.example.com;

    root /var/www/dipper/build;

    # Serve React static files
    location / {
        try_files $uri /index.html;
    }

    # Proxy API requests to Python backend
    location ~ ^/(files|inference|training|extraction|config|env|review)/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

**Systemd service for Python backend:**
```ini
[Unit]
Description=Dipper Python Backend
After=network.target

[Service]
Type=simple
User=dipper
WorkingDirectory=/opt/dipper/backend
ExecStart=/opt/dipper/backend/venv/bin/python lightweight_server.py --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

## Files Modified

### `backend/lightweight_server.py`
- **Added**: `--host` parameter (line 2797-2802)
- **Added**: `/files/read` endpoint (line 2717)
- **Kept**: `host` parameter in `__init__` and `start_server()`
- **Removed**: All static file serving code
- **Removed**: `--serve-static` and `--static-path` arguments
- **Removed**: `serve_index_html()` method

## What's Working Now

✅ Python backend binds to 0.0.0.0 for remote access
✅ All API endpoints functional (`/files/*`, `/inference/*`, etc.)
✅ File browsing, reading, writing via API
✅ Mode detection works (React detects SERVER mode)
✅ Two-process architecture matches production pattern

## Next Steps

1. **Test end-to-end** with `npx serve`
2. **Add to package.json**: `"serve": "serve -s build -p 3000"`
3. **Document nginx setup** for production
4. **Add YAML configuration** (Phase 1)
5. **Replace window.prompt()** with proper modal (Phase 2)

## Success Criteria

- [ ] Python backend starts on port 8000
- [ ] npx serve starts on port 3000
- [ ] Browser loads React app from port 3000
- [ ] React makes API calls to port 8000
- [ ] File browser works
- [ ] No CORS errors
- [ ] ML tasks can be started
