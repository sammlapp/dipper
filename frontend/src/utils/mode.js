/**
 * Mode Detection Utility
 *
 * Detects whether the app is running in:
 * - LOCAL mode: Desktop app (Electron or Tauri)
 * - SERVER mode: Browser/web server deployment
 *
 * This allows the React app to adapt its behavior based on the deployment context.
 */

export const AppMode = {
  LOCAL: 'local',
  SERVER: 'server'
};

/**
 * Get the current application mode
 *
 * Detection order:
 * 1. Explicit override via REACT_APP_MODE environment variable (build-time)
 * 2. Runtime detection of Tauri (window.__TAURI__)
 * 3. Runtime detection of Electron (user agent check)
 * 4. Default to SERVER mode if none of the above
 *
 * @returns {string} AppMode.LOCAL or AppMode.SERVER
 */
export const getAppMode = () => {
  // 1) Explicit override via env (build-time)
  if (process.env.REACT_APP_MODE === AppMode.SERVER) {
    return AppMode.SERVER;
  }

  // 2) Detect Tauri at runtime (local desktop)
  if (typeof window !== 'undefined' && window.__TAURI__) {
    return AppMode.LOCAL;
  }

  // 2b) Detect Tauri v2 (alternative check)
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
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

/**
 * Check if the app is running in local mode (desktop app)
 * @returns {boolean} True if running as desktop app
 */
export const isLocalMode = () => getAppMode() === AppMode.LOCAL;

/**
 * Check if the app is running in server mode (browser)
 * @returns {boolean} True if running in browser
 */
export const isServerMode = () => getAppMode() === AppMode.SERVER;
