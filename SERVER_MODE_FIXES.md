# Server Mode Implementation - Fixes Required

## Current Status
The server mode infrastructure is **95% complete** but has a few critical issues preventing it from working:

### ✅ What's Already Working
1. **Mode detection** (`mode.js`) - Correctly detects LOCAL vs SERVER mode
2. **File operations abstraction** (`fileOperations.js`) - Routes to serverFilePicker in SERVER mode
3. **SVAR-based ServerFileBrowser** component - Custom file browser UI
4. **Backend file browsing endpoints** - `/files/browse`, `/files/save`, `/files/unique-name`
5. **Backend URL resolution** - `getBackendUrl()` returns correct URL
6. **File browsing security** - Path validation with allowed directories

### 🐛 Critical Issues to Fix

## Issue 1: Server Binding to Wrong Interface

**Problem:** Backend server binds to `localhost` only, but server mode needs to serve the frontend

**Location:** `backend/lightweight_server.py:2739`
```python
site = web.TCPSite(runner, "localhost", self.port)
```

**Why it fails:**
- When you run `npm run build:server`, React builds static files that need to be served
- These static files try to fetch from `http://localhost:8000/files/browse`
- But the server only listens on localhost (127.0.0.1), not on the actual server interface

**Fix Required:**
The server needs to:
1. Accept a `--host` argument (default: `localhost` for LOCAL mode, `0.0.0.0` for SERVER mode)
2. OR detect mode and bind accordingly
3. OR always bind to `0.0.0.0` (less secure but simpler)

**Recommended Solution:**
```python
# In BackendServer.__init__
self.host = host or "localhost"  # Add host parameter

# In start_server
site = web.TCPSite(runner, self.host, self.port)
logger.info(f"Server listening on {self.host}:{self.port}")

# In main()
parser.add_argument("--host", type=str, default="localhost",
                   help="Host to bind to (use 0.0.0.0 for server mode)")
```

---

## Issue 2: Static File Serving for Server Mode

**Problem:** No mechanism to serve the built React app in server mode

**Current workflow that should work:**
```bash
# Build React app for server mode
npm run build:server  # Sets REACT_APP_MODE=server

# Start Python backend
python backend/lightweight_server.py --host 0.0.0.0 --port 8000

# ??? How does the browser get the React app?
```

**What's Missing:**
The backend server needs to serve the static React files when in server mode.

**Two Options:**

### Option A: Python serves static files (Simpler, single process)
Add static file serving to `lightweight_server.py`:

```python
def setup_routes(self):
    # ... existing routes ...

    # Serve React static files (server mode only)
    if self.serve_static:
        self.app.router.add_static('/static',
                                   path='../frontend/build/static',
                                   name='static')
        self.app.router.add_get('/{tail:.*}', self.serve_index)

async def serve_index(self, request):
    """Serve index.html for all unmatched routes (React routing)"""
    index_path = os.path.join(os.path.dirname(__file__),
                              '../frontend/build/index.html')
    return web.FileResponse(index_path)
```

### Option B: nginx/separate server (Production, recommended in docs)
Use nginx to serve static files and proxy API requests.

**Recommendation:** Implement Option A for development/testing, document Option B for production.

---

## Issue 3: CORS Configuration for Server Mode

**Problem:** Browser fetch requests might be blocked by CORS

**Current CORS setup:** `backend/lightweight_server.py` already has aiohttp-cors configured

**Verification Needed:**
Check if CORS allows requests from `http://0.0.0.0:8000` to `http://localhost:8000`

**Likely Fine:** The existing CORS setup appears permissive enough, but may need adjustment.

---

## Issue 4: File Save Dialog Uses `window.prompt()`

**Problem:** `serverFilePicker.js:112` uses deprecated `window.prompt()` for filename input

**Location:** `frontend/src/utils/serverFilePicker.js:101-119`

**Why it's a problem:**
- Poor UX (browser's basic prompt dialog)
- No validation
- User reported: "not opening a file save dialogue"

**Fix Required:**
Create a proper React modal component for filename input (already planned in Phase 2 of the plan)

**Recommendation:**
- Low priority (it works, just ugly)
- Focus on fixing Issues 1-2 first to get server mode working
- Polish this in Phase 2

---

## Issue 5: YAML Configuration Not Implemented

**Problem:** Plan calls for `--config` flag with YAML configuration, but it's not implemented

**Current state:** Backend only accepts `--port` and `--parent-pid`

**What's needed (from plan.md):**
- YAML config file support
- `allowed_base_paths` configuration (currently hardcoded)
- `max_concurrent` jobs configuration
- `host` configuration

**Status:** This is Phase 1 of the plan, not yet started

**Recommendation:**
- Required for production but not for initial testing
- Can work with hardcoded defaults for now
- Implement after getting basic server mode working

---

## Issue 6: Missing `/files/read` Endpoint

**Problem:** `fileOperations.js:238` tries to POST to `/files/read` but endpoint doesn't exist

**Location:** `frontend/src/utils/fileOperations.js:229-251` (readFile function)

**Backend:** No `/files/read` endpoint found in `lightweight_server.py`

**Impact:** File reading in server mode will fail (used for config loading)

**Fix Required:**
Add endpoint to backend:
```python
async def read_file_server(self, request):
    """Read file content (server mode only)"""
    try:
        data = await request.json()
        file_path = data.get("file_path")

        # Security validation (same as browse_files)
        # ...

        with open(normalized_path, 'r', encoding='utf-8') as f:
            content = f.read()

        return web.json_response({"content": content})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

# Register route
self.app.router.add_post("/files/read", self.read_file_server)
```

---

## Implementation Priority

### Phase 0: Get Server Mode Working (Critical)
1. ✅ Fix server host binding (Issue 1) - **REQUIRED**
2. ✅ Add static file serving (Issue 2) - **REQUIRED**
3. ✅ Add `/files/read` endpoint (Issue 6) - **REQUIRED**
4. ⚠️ Test CORS (Issue 3) - **VERIFY**

### Phase 1: YAML Configuration (High Priority)
5. Implement `--config` flag with YAML support (Issue 5)
6. Make `allowed_base_paths` configurable
7. Make `max_concurrent` configurable

### Phase 2: Polish (Medium Priority)
8. Replace `window.prompt()` with proper modal (Issue 4)
9. Add file overwrite confirmation
10. Improve error messages

### Phase 3: Production Ready (Low Priority)
11. nginx configuration documentation
12. HTTPS setup guide
13. systemd service files
14. Docker deployment

---

## Testing Checklist

After implementing Phase 0 fixes:

```bash
# 1. Build React app for server mode
cd frontend
REACT_APP_MODE=server npm run build

# 2. Start backend in server mode
cd ../backend
python lightweight_server.py --host 0.0.0.0 --port 8000

# 3. Access in browser
open http://localhost:8000

# 4. Test file operations
- [ ] Open file browser (should load directory list)
- [ ] Navigate folders (double-click)
- [ ] Select files (checkbox)
- [ ] Select folder
- [ ] Save file (with prompt for now)
- [ ] Load config file (tests readFile)

# 5. Test ML tasks
- [ ] Start inference job
- [ ] Monitor progress
- [ ] View results

# 6. Test from remote machine (SSH tunnel)
ssh -L 8000:localhost:8000 user@server
open http://localhost:8000
```

---

## Files That Need Changes

### Critical Changes (Phase 0)
1. `backend/lightweight_server.py`
   - Add `--host` argument
   - Change binding from `localhost` to configurable host
   - Add static file serving routes
   - Add `/files/read` endpoint

### Configuration Changes (Phase 1)
2. `backend/lightweight_server.py`
   - Add `--config` argument
   - Load YAML configuration
   - Use configurable `allowed_base_paths`
   - Use configurable `max_concurrent`

3. `backend/requirements-lightweight.txt`
   - Already has `pyyaml>=6.0` ✅

### Polish Changes (Phase 2)
4. `frontend/src/components/FileSaveModal.js` (NEW)
   - Material-UI modal for filename input
   - Validation and error handling

5. `frontend/src/utils/serverFilePicker.js`
   - Replace `window.prompt()` with FileSaveModal

---

## Estimated Effort

- **Phase 0:** 1-2 hours (simple changes, immediate testing)
- **Phase 1:** 2-3 hours (YAML parsing, validation)
- **Phase 2:** 2-3 hours (React modal component)
- **Phase 3:** Document only (no code changes)

**Total:** ~5-8 hours to full server mode functionality

---

## Current vs Target Architecture

### Current (Not Working)
```
Browser (localhost:8000)
  │
  ├─> Try to load React app ❌ (no server for static files)
  └─> Try to fetch /files/browse ❌ (connection refused)

Python Backend (localhost:8000)
  └─> Listening only on 127.0.0.1 ❌
```

### Target (Working)
```
Browser (localhost:8000)
  │
  ├─> Load React app ✅ (served by Python backend)
  └─> Fetch /files/browse ✅ (Python backend)

Python Backend (0.0.0.0:8000)
  ├─> Serve static files ✅
  ├─> API endpoints ✅
  └─> Listening on all interfaces ✅
```

---

## Next Steps

1. **Start with Phase 0** - Get basic server mode working
2. **Test thoroughly** with the checklist above
3. **Document issues** found during testing
4. **Move to Phase 1** only after Phase 0 is confirmed working
5. **Update README.md** with actual tested commands
