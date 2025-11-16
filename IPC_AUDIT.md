# Electron IPC Audit & Refactoring Plan

**Date:** November 2025

## Current IPC Methods Analysis

### ✅ USED - File Operations (Keep for Electron, Plan for Server Mode)

| Method | Usage | Count | Notes |
|--------|-------|-------|-------|
| `selectFiles` | Multiple tabs for audio file selection | High | #server_mode - Replace with web file picker |
| `selectFolder` | Output directory selection | Medium | #server_mode - Replace with web folder picker |
| `selectCSVFiles` | Loading prediction files | Medium | #server_mode - Replace with web file picker |
| `selectTextFiles` | File list selection | Low | #server_mode - Replace with web file picker |
| `selectJSONFiles` | Config file selection | Low | #server_mode - Replace with web file picker |
| `selectModelFiles` | Model file selection | Low | #server_mode - Replace with web file picker |
| `saveFile` | Save dialogs (config, annotations) | High | #server_mode - Replace with download |
| `writeFile` | Write annotations and logs | High | #server_mode - HTTP POST endpoint |
| `generateUniqueFolderName` | Job folder naming | Medium | #server_mode - HTTP endpoint |

**Electron Implementation:** Native OS file dialogs
**Server Mode Alternative:** Web file pickers + HTTP endpoints for server-side operations

### ✅ USED - Process Management (Keep for Now, Remove for Server Mode)

| Method | Usage | Count | Notes |
|--------|-------|-------|-------|
| `killPythonProcess` | Fallback for job cancellation | Low | Already uses HTTP cancel first |

**Current Flow:**
1. Frontend calls HTTP `/inference/cancel/{job_id}`
2. Backend kills subprocess
3. If HTTP fails, fallback to IPC `killPythonProcess`

**Server Mode:** Remove entirely, use only HTTP cancellation

### ❌ UNUSED - Remove Immediately

| Method | Usage | Reason |
|--------|-------|--------|
| `runPythonScript` | **NONE FOUND** | Jobs now run via HTTP API |
| `onPythonOutput` | **NONE FOUND** | Output now in log files, not IPC |
| `removePythonOutputListener` | **NONE FOUND** | Related to onPythonOutput |
| `testPythonPath` | **NONE FOUND** | Environment checks now via HTTP |
| `getUserDataPath` | **NONE FOUND** | Not used anywhere |

### ⚠️ AUDIO TRANSFER - Currently Uses IPC, Should Use HTTP

| Method | Current Usage | Alternative | Status |
|--------|---------------|-------------|---------|
| `createAudioClips` | AudioClipCard (ExploreTab) | HttpAudioLoader | **REFACTOR** |

**Current (IPC-based):**
```
Frontend AudioClipCard
    ↓ IPC: createAudioClips
Electron Main Process
    ↓ spawn subprocess
create_audio_clips.py
    ↓ returns base64
Frontend receives base64
```

**Alternative (HTTP-based):**
```
Frontend HttpAudioLoader
    ↓ HTTP POST /clips/batch
Backend lightweight_server
    ↓ librosa, soundfile
Returns base64 JSON
```

**ReviewTab Already Uses:** HttpAudioLoader with `/clips/batch` endpoint
**ExploreTab Uses:** AudioClipCard with IPC `createAudioClips`

## Audio Loading Architecture (Current State)

### HTTP-Based Loading (✅ Correct Approach)

**Endpoint:** `GET /clip` and `POST /clips/batch`
**Used by:** ReviewTab via HttpAudioLoader.js
**Flow:**
1. Frontend makes HTTP request with clip params
2. Backend loads audio with librosa/soundfile
3. Backend generates spectrogram with matplotlib
4. Backend returns base64-encoded audio + spectrogram
5. Frontend displays from base64 data URLs

**Advantages:**
- Works in browser (no Electron needed)
- Fast batch loading
- No subprocess spawning
- Caching support
- Already tested and working

### IPC-Based Loading (❌ Outdated, Remove)

**Method:** `createAudioClips` IPC
**Used by:** AudioClipCard.js (ExploreTab only)
**Flow:**
1. Frontend calls `window.electronAPI.createAudioClips()`
2. Electron main process spawns Python subprocess
3. Subprocess runs `create_audio_clips.py`
4. Returns base64 via IPC
5. Frontend displays from base64

**Problems:**
- Electron-specific (won't work in browser)
- Spawns separate subprocess (slow)
- Duplicate functionality with HTTP endpoint
- Not needed - HTTP version exists and works

## Refactoring Plan

### Phase 1: Remove Unused IPC (Immediate)

**Actions:**
1. Remove from preload.js:
   - `runPythonScript`
   - `onPythonOutput`
   - `removePythonOutputListener`
   - `testPythonPath`
   - `getUserDataPath`

2. Remove handlers from main.js and main-review.js:
   - `run-python-script`
   - `python-output` event
   - `test-python-path`
   - `get-user-data-path`

3. Remove related process management code in main.js:
   - `pythonProcesses` Map
   - Python output handling

**Result:** ~150 lines of dead code removed

### Phase 2: Replace Audio IPC with HTTP (This Task)

**Actions:**
1. Update AudioClipCard.js to use HTTP instead of IPC
2. Test ExploreTab audio loading
3. Remove `createAudioClips` from preload.js
4. Remove `create-audio-clips` handler from main.js/main-review.js
5. Consider removing `backend/scripts/create_audio_clips.py` (if only used by IPC)

**Result:** Audio loading unified on HTTP, works in browser

### Phase 3: Plan for Server Mode (Future)

**File Operations Replacement:**
- File pickers → Web `<input type="file">` + server-side browsing API
- `saveFile` → Download via browser or server-side save
- `writeFile` → HTTP POST to backend
- `generateUniqueFolderName` → HTTP endpoint

**Process Management:**
- Remove `killPythonProcess` IPC
- Use only HTTP cancellation

## Implementation Details

### Remove Unused IPC Methods

**preload.js changes:**
```javascript
// REMOVE these lines:
runPythonScript: (scriptPath, args, processId) =>
  ipcRenderer.invoke('run-python-script', scriptPath, args, processId),
killPythonProcess: (processId) =>
  ipcRenderer.invoke('kill-python-process', processId),
testPythonPath: () => ipcRenderer.invoke('test-python-path'),
getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
onPythonOutput: (callback) => {
  ipcRenderer.on('python-output', callback);
},
removePythonOutputListener: (callback) => {
  ipcRenderer.removeListener('python-output', callback);
}
```

### Replace AudioClipCard IPC with HTTP

**AudioClipCard.js changes:**
```javascript
// BEFORE (IPC):
if (window.electronAPI) {
  const result = await window.electronAPI.createAudioClips(
    file_path, start_time, end_time, settings
  );
  // ...
}

// AFTER (HTTP):
const response = await fetch('http://localhost:8000/clip', {
  method: 'GET',
  params: {
    file_path,
    start_time,
    end_time,
    ...settings
  }
});
const result = await response.json();
// Handle result.audio_base64, result.spectrogram_base64
```

Or better, use the existing `useHttpAudioLoader` hook:
```javascript
import { useHttpAudioLoader } from './HttpAudioLoader';

const AudioClipCard = ({ file_path, start_time, end_time }) => {
  const httpLoader = useHttpAudioLoader('http://localhost:8000');

  const loadClip = async () => {
    const clip = await httpLoader.loadClip({
      file_path,
      start_time,
      end_time,
      // settings...
    });
    setClipResult(clip);
  };
};
```

## File Saving Architecture

### Current Electron Implementation

**Save Flow:**
1. Frontend calls `window.electronAPI.saveFile(defaultName)`
2. Main process shows native save dialog
3. Returns file path
4. Frontend calls `window.electronAPI.writeFile(path, content)`
5. Main process writes file with Node.js fs

### Server Mode Alternative

**Option A: Download (Simple)**
```javascript
// Frontend
const blob = new Blob([csvContent], { type: 'text/csv' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'annotations.csv';
a.click();
```

**Option B: Server-Side Save (Better for workflows)**
```javascript
// Frontend
await fetch('http://localhost:8000/annotation/save', {
  method: 'POST',
  body: JSON.stringify({
    file_path: '/path/to/save',
    content: csvContent
  })
});
```

## Remaining Electron Dependencies After Refactoring

### Phase 2 Complete (After This Task)

**Still Using Electron For:**
1. File/folder selection dialogs (all `select*` methods)
2. Native file saving/writing (ReviewTab annotations)
3. Unique folder name generation
4. Window management
5. App lifecycle

**Ready for Server Mode:**
1. ✅ All ML tasks (already HTTP)
2. ✅ Audio loading (after this refactor)
3. ✅ Job management (already HTTP)
4. ✅ Status tracking (already HTTP)

### Phase 3 Complete (Full Server Mode)

**No Electron Dependencies:**
- All file operations via HTTP or browser APIs
- Pure web application
- Can run in any browser
- Optional Tauri wrapper for desktop feel

## Testing Plan

### Phase 1: Remove Unused IPC
1. Remove unused methods
2. Test all tabs still work
3. Test inference/training/extraction jobs
4. Verify no console errors

### Phase 2: Replace Audio IPC
1. Update AudioClipCard to use HTTP
2. Test ExploreTab audio playback
3. Test spectrogram display
4. Compare performance with IPC version
5. Remove IPC audio methods

### Phase 3: Server Mode Preparation
1. Create file browsing HTTP endpoints
2. Test with web file pickers
3. Add authentication
4. Test multi-user scenarios

## Summary

**Current State:**
- 17 IPC methods in preload.js
- ~5 unused methods (dead code)
- Audio loading split between IPC (ExploreTab) and HTTP (ReviewTab)
- Most communication already via HTTP

**After Phase 1 (Remove Unused):**
- 12 IPC methods remaining
- All file operations
- One audio method (createAudioClips)

**After Phase 2 (Replace Audio IPC):**
- 11 IPC methods remaining
- Only file operations and utilities
- Audio completely via HTTP
- **Ready for browser deployment** (with file operation limitations)

**After Phase 3 (Full Server Mode):**
- 0 IPC methods
- Pure web application
- Optional Tauri wrapper
- Full browser compatibility
