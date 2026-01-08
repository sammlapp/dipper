# Dipper - Tauri & Server Mode Migration Plan

**Date:** November 2025
**Status:** Planning

## Overview

Migrate from the current Electron-based desktop application to a dual-mode architecture supporting both desktop and server deployments **without breaking existing workflows during the transition**:

1. **Local Mode (Tauri):** Cross-platform desktop app with native file access
2. **Server Mode (Browser):** Headless server accessed via web browser

**Key Decisions:**
- ✅ **Single React codebase** with conditional features based on deployment mode
- ✅ **HTTP remains the only backend communication layer** (no new IPC)
- ⚠️ **Electron is deprecated but not removed immediately** – it is retired only **after** Tauri reaches feature parity and is validated in real-world use.

> This plan is intentionally incremental: first make the frontend truly Electron-agnostic, then add Tauri, and only then introduce server mode features.

## Architecture Comparison

### Current (Electron)
```
┌─────────────────────────────┐
│   Electron Desktop App      │
│  ┌────────────────────────┐ │
│  │   React UI             │ │
│  └──────────┬─────────────┘ │
│             │ IPC/HTTP       │
│  ┌──────────▼─────────────┐ │
│  │   Electron Main        │ │
│  │   - File dialogs       │ │
│  │   - Process mgmt       │ │
│  └──────────┬─────────────┘ │
└─────────────┼───────────────┘
              │ HTTP
┌─────────────▼───────────────┐
│  Python Backend (port 8000) │
│  - ML processing            │
│  - Audio loading            │
└─────────────────────────────┘
```

### Proposed: Dual Mode Architecture

**Local Mode (Tauri Desktop):**
```
┌─────────────────────────────┐
│   Tauri Desktop App         │
│  ┌────────────────────────┐ │
│  │   React UI             │ │
│  │   mode: 'local'        │ │
│  └──────────┬─────────────┘ │
│             │ Tauri Commands │
│  ┌──────────▼─────────────┐ │
│  │   Rust Backend         │ │
│  │   - File dialogs       │ │
│  │   - Native file access │ │
│  └──────────┬─────────────┘ │
└─────────────┼───────────────┘
              │ HTTP
┌─────────────▼───────────────┐
│  Python Backend (port 8000) │
│  - ML processing            │
│  - Audio loading            │
└─────────────────────────────┘
```

**Server Mode (Browser):**
```
┌─────────────────────────────┐
│   Web Browser               │
│  ┌────────────────────────┐ │
│  │   React UI             │ │
│  │   mode: 'server'       │ │
│  │   SVAR file browser    │ │
│  └──────────┬─────────────┘ │
└─────────────┼───────────────┘
              │ HTTPS
┌─────────────▼───────────────┐
│   nginx (Reverse Proxy)     │
│   - Static files            │
│   - Backend proxy           │
└─────────────┬───────────────┘
              │
┌─────────────▼───────────────┐
│  Python Backend (port 8000) │
│  + File browsing endpoints  │
│  + File save endpoints      │
│  + Authentication           │
│  - ML processing            │
│  - Audio loading            │
└─────────────────────────────┘
```

## Migration Strategy

### Phase 1: Prepare Codebase (Electron-Agnostic Frontend)

**Goal:** Make the React app runnable in a plain browser (no Electron/Tauri) while **keeping Electron builds working**.

**Status:** ~80% complete (after IPC refactoring; see `CLAUDE.md` and `ARCHITECTURE.md`).

**Completed:**
- ✅ All ML tasks via HTTP
- ✅ All audio loading via HTTP
- ✅ Job management via HTTP
- ✅ Status tracking via HTTP

**Remaining Electron Dependencies:**
- File selection dialogs (11 IPC methods)
- File save dialogs
- File write operations
- Process kill fallback
- Electron-only entrypoints (`main.js`, `main-review.js`, `preload.js`)

**Actions:**
1. **Abstract file operations behind interface**
  - Create `frontend/src/utils/fileOperations.js` as the single abstraction layer for: select files/folders, save dialogs, and writes.
  - Migrate all callsites (tabs, settings, ReviewTab) to use this interface.
2. **Introduce mode detection utility (but keep default = Electron)**
  - Add `frontend/src/utils/mode.js` (see Phase 2) and start using `isLocalMode` / `isServerMode` in new code.
  - For existing Electron builds, treat `Electron` + `PyInstaller` as a **temporary "local" mode variant**.
3. **Refactor Electron glue to use the abstraction**
  - Implement an Electron-backed adapter inside `fileOperations` that uses existing IPC methods.
  - Only after all callsites are migrated, remove redundant IPC channels.
4. **Document and guard all Electron-specific imports**
  - Ensure `window.require('electron')` and similar calls only occur in Electron entrypoints, not in React components.
  - Verify `npm start` (pure React) works without Electron installed.

### Phase 2: Implement Mode Detection

**Environment Variable:** `REACT_APP_MODE`
- `local`  – Desktop mode (Electron now, Tauri later)
- `tauri`  – Explicit Tauri-local mode (optional refinement once Tauri is stable)
- `server` – Browser/server mode

**Runtime Detection:**
```javascript
// src/utils/mode.js
export const AppMode = {
  LOCAL: 'local',
  SERVER: 'server'
};

export const getAppMode = () => {
  // 1) Explicit override via env (build-time)
  if (process.env.REACT_APP_MODE === AppMode.SERVER) {
    return AppMode.SERVER;
  }

  // 2) Detect Tauri at runtime (local desktop)
  if (typeof window !== 'undefined' && window.__TAURI__) {
    return AppMode.LOCAL;
  }

  // 3) Default heuristics
  // - If running under Electron, treat as local until Electron is fully removed
  //   (can be refined later using userAgent / preload flag)
  // - Otherwise assume server/browser mode.
  if (typeof window !== 'undefined' && /Electron/i.test(window.navigator.userAgent || '')) {
    return AppMode.LOCAL;
  }

  return AppMode.SERVER;
};

export const isLocalMode = () => getAppMode() === AppMode.LOCAL;
export const isServerMode = () => getAppMode() === AppMode.SERVER;
```

### Phase 3: Implement Tauri Backend (Local Mode)

**File Operations via Tauri Commands:**

**Rust Backend (`src-tauri/src/main.rs`):**
```rust
use tauri::api::dialog;

#[tauri::command]
async fn select_files() -> Result<Vec<String>, String> {
    dialog::FileDialogBuilder::new()
        .pick_files()
        .map(|paths| paths.iter().map(|p| p.to_string()).collect())
        .ok_or("No files selected".to_string())
}

#[tauri::command]
async fn select_folder() -> Result<String, String> {
    dialog::FileDialogBuilder::new()
        .pick_folder()
        .map(|path| path.to_string())
        .ok_or("No folder selected".to_string())
}

#[tauri::command]
async fn save_file(default_name: String, content: String) -> Result<String, String> {
    let path = dialog::FileDialogBuilder::new()
        .set_file_name(&default_name)
        .save_file()
        .ok_or("Save cancelled".to_string())?;

    std::fs::write(&path, content)
        .map_err(|e| e.to_string())?;

    Ok(path.to_string())
}

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(path, content)
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            select_files,
            select_folder,
            save_file,
            write_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Frontend Adapter (`src/utils/fileOperations.js`):**
```javascript
import { invoke } from '@tauri-apps/api/tauri';
import { isLocalMode } from './mode';

export const fileOperations = {
  selectFiles: async () => {
    if (isLocalMode()) {
      return await invoke('select_files');
    } else {
      // Server mode: use SVAR file browser
      return await serverSelectFiles();
    }
  },

  selectFolder: async () => {
    if (isLocalMode()) {
      return await invoke('select_folder');
    } else {
      return await serverSelectFolder();
    }
  },

  saveFile: async (defaultName, content) => {
    if (isLocalMode()) {
      return await invoke('save_file', { defaultName, content });
    } else {
      return await serverSaveFile(defaultName, content);
    }
  },

  writeFile: async (path, content) => {
    if (isLocalMode()) {
      return await invoke('write_file', { path, content });
    } else {
      return await serverWriteFile(path, content);
    }
  }
};
```

### Phase 4: Implement Server Mode File Operations

**SVAR Integration:** https://svar.dev/react/filemanager/

**Install SVAR:**
```bash
npm install @svar/filemanager
npm install @svar/core
```

**SVAR File Browser Component:**
```javascript
// src/components/ServerFileBrowser.js
import { useState } from 'react';
import { Filemanager } from "@svar/filemanager";
import "@svar/filemanager/dist/filemanager.css";

export const ServerFileBrowser = ({ onSelect, mode = 'files' }) => {
  const [selectedItems, setSelectedItems] = useState([]);

  // Custom backend for server-side file browsing
  const api = {
    url: 'http://localhost:8000/files',

    handlers: {
      // Get directory contents
      read: async (params) => {
        const response = await fetch(`${api.url}/browse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: params.path || '/' })
        });
        return await response.json();
      },

      // Upload file (if needed)
      upload: async (formData) => {
        const response = await fetch(`${api.url}/upload`, {
          method: 'POST',
          body: formData
        });
        return await response.json();
      }
    }
  };

  const handleSelect = (selected) => {
    setSelectedItems(selected);
    if (onSelect) {
      onSelect(selected);
    }
  };

  return (
    <div style={{ height: '500px' }}>
      <Filemanager
        api={api}
        selection={mode === 'files' ? 'multiple' : 'single'}
        mode={mode === 'folder' ? 'folders' : 'files'}
        onSelect={handleSelect}
      />
    </div>
  );
};
```

**Backend File Browsing Endpoints:**

Add to `lightweight_server.py`:
```python
# File browsing for server mode
async def browse_files(self, request):
    """Browse server-side files (server mode only)"""
    try:
        data = await request.json()
        path = data.get("path", "/")

        # Security: Restrict to allowed base paths
        allowed_paths = self.config.get("allowed_paths", ["/data"])
        if not any(path.startswith(base) for base in allowed_paths):
            return web.json_response(
                {"error": "Access denied"}, status=403
            )

        # List directory contents
        items = []
        for entry in os.scandir(path):
            items.append({
                "name": entry.name,
                "path": entry.path,
                "type": "folder" if entry.is_dir() else "file",
                "size": entry.stat().st_size if entry.is_file() else 0,
                "modified": entry.stat().st_mtime
            })

        return web.json_response({
            "items": items,
            "path": path
        })
    except Exception as e:
        logger.error(f"Error browsing files: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def save_file_server(self, request):
    """Save file on server (server mode only)"""
    try:
        data = await request.json()
        path = data.get("path")
        content = data.get("content")

        # Security: Validate path
        allowed_paths = self.config.get("allowed_paths", ["/data"])
        if not any(path.startswith(base) for base in allowed_paths):
            return web.json_response(
                {"error": "Access denied"}, status=403
            )

        # Write file
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            f.write(content)

        return web.json_response({
            "status": "success",
            "path": path
        })
    except Exception as e:
        logger.error(f"Error saving file: {e}")
        return web.json_response({"error": str(e)}, status=500)

# Register routes
self.app.router.add_post("/files/browse", self.browse_files)
self.app.router.add_post("/files/save", self.save_file_server)
```

**Server Mode File Operations:**
```javascript
// Server mode implementations
const serverSelectFiles = async () => {
  return new Promise((resolve) => {
    // Show SVAR file browser modal
    const modal = showFilePickerModal({
      mode: 'files',
      onSelect: (files) => {
        resolve(files.map(f => f.path));
        modal.close();
      }
    });
  });
};

const serverSaveFile = async (defaultName, content) => {
  // Show SVAR file browser in save mode
  const path = await showSaveDialog({ defaultName });

  // Save to server
  const response = await fetch('http://localhost:8000/files/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content })
  });

  const result = await response.json();
  return result.path;
};
```

### Phase 5: Authentication & Multi-User (Server Mode)

**Required for Server Mode:**

**1. User Authentication:**
```python
# Add to lightweight_server.py
import jwt
from aiohttp_session import setup as session_setup
from aiohttp_session.cookie_storage import EncryptedCookieStorage
from cryptography import fernet

class BackendServer:
    def __init__(self):
        # ... existing init ...

        # Session management
        secret_key = os.getenv('SESSION_SECRET', fernet.Fernet.generate_key())
        session_setup(self.app, EncryptedCookieStorage(secret_key))

    async def login(self, request):
        """User login endpoint"""
        data = await request.json()
        username = data.get("username")
        password = data.get("password")

        # Verify credentials (use proper password hashing!)
        user = await self.verify_user(username, password)
        if not user:
            return web.json_response(
                {"error": "Invalid credentials"}, status=401
            )

        # Create JWT token
        token = jwt.encode(
            {"user_id": user.id, "username": username},
            os.getenv('JWT_SECRET'),
            algorithm="HS256"
        )

        return web.json_response({
            "status": "success",
            "token": token,
            "user": {"id": user.id, "username": username}
        })

    async def auth_middleware(self, app, handler):
        """Middleware to check authentication"""
        async def middleware_handler(request):
            # Skip auth for login/health endpoints
            if request.path in ['/login', '/health']:
                return await handler(request)

            # Check JWT token
            auth_header = request.headers.get('Authorization')
            if not auth_header:
                return web.json_response(
                    {"error": "Authentication required"}, status=401
                )

            try:
                token = auth_header.split(' ')[1]
                payload = jwt.decode(
                    token, os.getenv('JWT_SECRET'), algorithms=["HS256"]
                )
                request['user'] = payload
            except:
                return web.json_response(
                    {"error": "Invalid token"}, status=401
                )

            return await handler(request)

        return middleware_handler
```

**2. User-Specific Job Isolation:**
```python
def get_user_job_folder(self, user_id, job_id):
    """Get job folder for specific user"""
    base_dir = os.path.join(self.config.get("jobs_dir", "/data/jobs"))
    user_dir = os.path.join(base_dir, f"user_{user_id}")
    os.makedirs(user_dir, exist_ok=True)
    return os.path.join(user_dir, job_id)

async def run_inference(self, request):
    """Start inference with user isolation"""
    user_id = request['user']['user_id']

    # ... existing validation ...

    # Create user-specific job folder
    job_folder = self.get_user_job_folder(user_id, job_id)

    # Job ownership
    self.running_jobs[job_id] = {
        "user_id": user_id,
        "process": result["process"],
        # ... rest of job info ...
    }
```

**3. Frontend Authentication:**
```javascript
// src/utils/auth.js
export class AuthManager {
  constructor() {
    this.token = localStorage.getItem('auth_token');
  }

  async login(username, password) {
    const response = await fetch('http://localhost:8000/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const result = await response.json();
    if (result.token) {
      this.token = result.token;
      localStorage.setItem('auth_token', result.token);
      return true;
    }
    return false;
  }

  getAuthHeaders() {
    return {
      'Authorization': `Bearer ${this.token}`
    };
  }

  isAuthenticated() {
    return !!this.token;
  }
}

// Use in fetch calls
const response = await fetch(url, {
  headers: {
    ...authManager.getAuthHeaders(),
    'Content-Type': 'application/json'
  }
});
```

## File Operation Migration Map

| Current (Electron IPC) | Local Mode (Tauri) | Server Mode (SVAR + HTTP) |
|------------------------|-------------------|---------------------------|
| `selectFiles()` | `invoke('select_files')` | SVAR file browser modal |
| `selectFolder()` | `invoke('select_folder')` | SVAR folder browser modal |
| `selectCSVFiles()` | `invoke('select_files')` + filter | SVAR with CSV filter |
| `saveFile(name)` | `invoke('save_file')` | SVAR save dialog + HTTP POST |
| `writeFile(path, content)` | `invoke('write_file')` | HTTP POST `/files/save` |
| `generateUniqueFolderName()` | Rust function | HTTP POST `/files/unique-name` |

## Build Configuration

### Tauri Build

**`src-tauri/tauri.conf.json`:**
```json
{
  "build": {
    "beforeBuildCommand": "npm run build",
    "beforeDevCommand": "npm start",
    "devPath": "http://localhost:3000",
    "distDir": "../build"
  },
  "package": {
    "productName": "Dipper",
    "version": "2.0.0"
  },
  "tauri": {
    "allowlist": {
      "all": false,
      "dialog": {
        "all": true
      },
      "fs": {
        "all": true,
        "scope": ["$APPDATA/*", "$HOME/*"]
      },
      "http": {
        "all": true,
        "scope": ["http://localhost:8000/*"]
      }
    },
    "bundle": {
      "active": true,
      "identifier": "com.bioacoustics.dipper",
      "icon": [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/icon.icns",
        "icons/icon.ico"
      ]
    },
    "windows": [
      {
        "title": "Dipper",
        "width": 1400,
        "height": 900,
        "resizable": true,
        "fullscreen": false
      }
    ]
  }
}
```

### Server Build

**`package.json` scripts:**
```json
{
  "scripts": {
    "build:local": "cross-env REACT_APP_MODE=local npm run build",
    "build:server": "cross-env REACT_APP_MODE=server npm run build",
    "tauri:dev": "tauri dev",
    "tauri:build": "npm run build:local && tauri build",
    "server:build": "npm run build:server",
    "server:start": "npm run build:server && python backend/lightweight_server.py --mode server"
  }
}
```

### Server Deployment

**nginx configuration:**
```nginx
server {
    listen 80;
    server_name dipper.example.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name dipper.example.com;

    ssl_certificate /etc/ssl/certs/dipper.crt;
    ssl_certificate_key /etc/ssl/private/dipper.key;

    # Serve React static files
    location / {
        root /var/www/dipper/build;
        try_files $uri /index.html;
    }

    # Proxy to Python backend
    location /api/ {
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## Dependencies

### Remove
- ❌ `electron` - Replace with Tauri
- ❌ `electron-builder` - Use Tauri CLI
- ❌ `concurrently`, `wait-on` - Different dev workflow

### Add

**Local Mode:**
```json
{
  "dependencies": {
    "@tauri-apps/api": "^1.5.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^1.5.0"
  }
}
```

**Server Mode:**
```json
{
  "dependencies": {
    "@svar/filemanager": "^1.0.0",
    "@svar/core": "^1.0.0",
    "jwt-decode": "^4.0.0"
  }
}
```

**Backend (Server Mode):**
```txt
# Add to requirements-lightweight.txt
PyJWT>=2.8.0
cryptography>=41.0.0
aiohttp-session>=2.12.0
python-multipart>=0.0.6
```

## Migration Timeline

### Week 1-2: Preparation
- [ ] Remove remaining Electron IPC methods
- [ ] Create mode detection utilities
- [ ] Abstract file operations interface
- [ ] Update build scripts

### Week 3-4: Tauri Implementation
- [ ] Set up Tauri project structure
- [ ] Implement Rust file operation commands
- [ ] Create Tauri adapters in frontend
- [ ] Test local mode functionality

### Week 5-6: Server Mode (Basic)
- [ ] Integrate SVAR file manager
- [ ] Implement backend file browsing endpoints
- [ ] Create server mode adapters
- [ ] Test basic browser functionality

### Week 7-8: Server Mode (Auth & Multi-User)
- [ ] Implement authentication system
- [ ] Add user session management
- [ ] Implement job isolation
- [ ] Add resource quotas

### Week 9-10: Testing & Polish
- [ ] End-to-end testing both modes
- [ ] Performance optimization
- [ ] Documentation updates
- [ ] Deployment guides

## Testing Strategy

### Local Mode Testing
```bash
# Development
npm run tauri:dev

# Build
npm run tauri:build

# Test packaged app
open src-tauri/target/release/bundle/macos/Dipper.app
```

### Server Mode Testing
```bash
# Build
npm run build:server

# Start backend
python backend/lightweight_server.py --mode server --port 8000

# Serve frontend
npx serve -s build -p 3000

# Test in browser
open http://localhost:3000
```

### Feature Parity Checklist
- [ ] Audio playback works in both modes
- [ ] ML tasks run successfully
- [ ] File selection works (native vs SVAR)
- [ ] File saving works (native vs server-side)
- [ ] Annotations save correctly
- [ ] Job management identical
- [ ] Performance acceptable

## Security Considerations

### Local Mode
- ✅ Native file access (OS permissions)
- ✅ No network exposure (localhost only)
- ✅ Single user (OS user)

### Server Mode
- ⚠️ **Authentication required** - JWT tokens
- ⚠️ **File access restrictions** - Whitelist allowed paths
- ⚠️ **User isolation** - Separate job directories
- ⚠️ **Rate limiting** - Prevent abuse
- ⚠️ **HTTPS required** - SSL certificates
- ⚠️ **Input validation** - Sanitize all user inputs
- ⚠️ **Session management** - Secure cookie storage

## Advantages of New Architecture

### vs. Electron

**Size:**
- Electron app: ~150-200MB (includes Chromium + Node)
- Tauri app: ~10-20MB (uses system WebView)
- **Savings: ~90% smaller**

**Performance:**
- Tauri: Faster startup, lower memory
- Rust backend: More efficient than Node

**Security:**
- Tauri: More restrictive permissions model
- Rust: Memory-safe by default

### Server Mode Benefits

**Accessibility:**
- Access from any device with browser
- No installation required
- Centralized data management

**Collaboration:**
- Multi-user support
- Shared data access
- Centralized job management

**Scalability:**
- Server-side GPU utilization
- Resource pooling
- Batch processing

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| SVAR integration complexity | High | POC first, fallback to simpler file picker |
| Tauri learning curve | Medium | Start with simple commands, iterate |
| Server mode security | High | Thorough security review, penetration testing |
| Migration bugs | Medium | Comprehensive testing, gradual rollout |
| Performance regression | Medium | Benchmarking, optimization |

## Success Criteria

### Must Have
- ✅ All current features work in both modes
- ✅ File operations work seamlessly
- ✅ Audio playback and visualization work
- ✅ ML tasks complete successfully
- ✅ Smaller binary size (local mode)

### Should Have
- ✅ Server mode authentication working
- ✅ Multi-user support functional
- ✅ Performance equal or better
- ✅ Documentation complete

### Nice to Have
- ✅ Automated deployment
- ✅ User management UI
- ✅ Resource usage monitoring
- ✅ Job queuing system

## Conclusion

The migration to Tauri + Server mode provides:
1. **Smaller desktop apps** (~90% size reduction)
2. **Browser accessibility** (no installation required)
3. **Better security** (Rust + restrictive permissions)
4. **Multi-user support** (server mode)
5. **Unified codebase** (single React app for both modes)

The current HTTP-based architecture makes this migration straightforward - most of the application already works without Electron. The main effort is replacing file dialogs and implementing server-side file management.

**Next Steps:** Start with Tauri POC for local mode, then implement SVAR server mode file browsing.
