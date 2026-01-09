import { invoke } from '@tauri-apps/api/core';

// Cache for the backend URL
let cachedBackendUrl = null;

// Build-time configurable default backend port for SERVER mode.
// This can be set via REACT_APP_BACKEND_PORT when running `npm run build`.
// Falls back to 8000 when not provided.
const CONFIGURED_BACKEND_PORT =
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_BACKEND_PORT)
    ? process.env.REACT_APP_BACKEND_PORT
    : '8000';

/**
 * Get the backend server URL dynamically
 * For Tauri apps, this calls the Rust backend to get the actual port
 * For browser mode, uses localhost with a configurable port (default 8000)
 */
export async function getBackendUrl() {
  // Return cached value if available
  if (cachedBackendUrl) {
    return cachedBackendUrl;
  }

  // Check if running in Tauri
  const isTauri = typeof window !== 'undefined' &&
    (window.__TAURI__ || window.__TAURI_INTERNALS__);

  if (isTauri) {
    try {
      console.log('[backendConfig] Invoking get_backend_port from Tauri...');
      // Get the dynamic port from Tauri backend
      const port = await invoke('get_backend_port');
      cachedBackendUrl = `http://localhost:${port}`;
      console.log(`[backendConfig]  Got backend port from Tauri: ${port}`);
      console.log(`[backendConfig] Backend URL: ${cachedBackendUrl}`);
      return cachedBackendUrl;
    } catch (error) {
      console.error('[backendConfig]  Failed to get backend port from Tauri:', error);
      // Fallback to configured/default port
      cachedBackendUrl = `http://localhost:${CONFIGURED_BACKEND_PORT}`;
      console.warn(`[backendConfig] Falling back to configured/default port ${CONFIGURED_BACKEND_PORT}`);
      return cachedBackendUrl;
    }
  }

  // For browser/server mode (no Tauri), use configured/default port
  cachedBackendUrl = `http://localhost:${CONFIGURED_BACKEND_PORT}`;
  return cachedBackendUrl;
}

/**
 * Clear the cached backend URL (useful for testing or reconnection)
 */
export function clearBackendUrlCache() {
  cachedBackendUrl = null;
}
