import { invoke } from '@tauri-apps/api/core';

// Cache for the backend URL
let cachedBackendUrl = null;

export async function getBackendUrl() {
  if (cachedBackendUrl) {
    return cachedBackendUrl;
  }

  const isTauri = typeof window !== 'undefined' &&
    (window.__TAURI__ || window.__TAURI_INTERNALS__);

  if (isTauri) {
    const port = await invoke('get_backend_port');
    cachedBackendUrl = `http://localhost:${port}`;
    return cachedBackendUrl;
  }

  // Server mode: fetch runtime config written by launch-server.sh on each launch
  const resp = await fetch('/server-launch-config.json');
  if (!resp.ok) throw new Error(`Failed to fetch server-launch-config.json: ${resp.status}`);
  const cfg = await resp.json();
  if (!cfg.backend_port) throw new Error('server-launch-config.json missing backend_port');
  cachedBackendUrl = `http://localhost:${cfg.backend_port}`;
  return cachedBackendUrl;
}

export function clearBackendUrlCache() {
  cachedBackendUrl = null;
}
