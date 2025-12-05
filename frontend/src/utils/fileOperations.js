/**
 * File Operations Abstraction Layer
 *
 * Provides a unified API for file operations that works across:
 * - LOCAL mode: Uses native file dialogs (Tauri)
 * - SERVER mode: Uses SVAR file browser and HTTP endpoints
 *
 * This abstraction allows the React app to be deployment-agnostic.
 */

import { isLocalMode, isServerMode } from './mode';
import {
  showAudioFilePicker,
  showFolderPicker,
  showCSVFilePicker,
  showTextFilePicker,
  showJSONFilePicker,
  showModelFilePicker,
  showSaveDialog
} from './serverFilePicker';
import { getBackendUrl } from './backendConfig';

/**
 * Check if Tauri is available (v1 or v2)
 */
function isTauriAvailable() {
  return typeof window !== 'undefined' &&
         (window.__TAURI__ || window.__TAURI_INTERNALS__);
}

/**
 * Helper to invoke Tauri commands
 * Dynamically imports the Tauri API to avoid errors in browser mode
 */
async function invokeTauri(command, args = {}) {
  if (isTauriAvailable()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke(command, args);
  }
  throw new Error('Tauri API not available');
}

/**
 * Select multiple audio files
 * @returns {Promise<string[]>} Array of selected file paths
 */
export const selectFiles = async () => {
  if (isLocalMode()) {
    if (isTauriAvailable()) {
      return await invokeTauri('select_files');
    }
    throw new Error('Local mode file selection not available');
  } else {
    // Server mode: Use SVAR file browser
    const result = await showAudioFilePicker(true);
    return result || [];
  }
};

/**
 * Select a folder
 * @returns {Promise<string>} Selected folder path
 */
export const selectFolder = async () => {
  if (isLocalMode()) {
    if (isTauriAvailable()) {
      return await invokeTauri('select_folder');
    }
    throw new Error('Local mode folder selection not available');
  } else {
    // Server mode: Use SVAR folder browser
    const result = await showFolderPicker();
    return result || '';
  }
};

/**
 * Select CSV or PKL prediction files
 * @returns {Promise<string[]>} Array of selected file paths
 */
export const selectCSVFiles = async () => {
  if (isLocalMode()) {
    if (isTauriAvailable()) {
      return await invokeTauri('select_csv_files');
    }
    throw new Error('Local mode CSV file selection not available');
  } else {
    // Server mode: Use SVAR with CSV/PKL filter
    const result = await showCSVFilePicker(true);
    return result || [];
  }
};

/**
 * Select text files
 * @returns {Promise<string[]>} Array of selected file paths
 */
export const selectTextFiles = async () => {
  if (isLocalMode()) {
    if (isTauriAvailable()) {
      return await invokeTauri('select_text_files');
    }
    throw new Error('Local mode text file selection not available');
  } else {
    // Server mode: Use SVAR with text filter
    const result = await showTextFilePicker(true);
    return result || [];
  }
};

/**
 * Select JSON files (single file for config loading)
 * @returns {Promise<string[]>} Array with single selected file path
 */
export const selectJSONFiles = async () => {
  if (isLocalMode()) {
    if (isTauriAvailable()) {
      return await invokeTauri('select_json_files');
    }
    throw new Error('Local mode JSON file selection not available');
  } else {
    // Server mode: Use single file selection for config files
    const result = await showJSONFilePicker(false);
    return result ? [result] : [];
  }
};

/**
 * Select model files (single file)
 * @returns {Promise<string[]>} Array with single selected file path
 */
export const selectModelFiles = async () => {
  if (isLocalMode()) {
    if (isTauriAvailable()) {
      return await invokeTauri('select_model_files');
    }
    throw new Error('Local mode model file selection not available');
  } else {
    // Server mode: Use single file selection for models
    const result = await showModelFilePicker(false);
    return result ? [result] : [];
  }
};

/**
 * Generate a unique folder name by appending numeric suffix if needed
 * @param {string} basePath - Base directory path
 * @param {string} folderName - Desired folder name
 * @returns {Promise<string>} Unique folder name
 */
export const generateUniqueFolderName = async (basePath, folderName) => {
  if (isLocalMode()) {
    if (isTauriAvailable()) {
      return await invokeTauri('generate_unique_folder_name', { basePath, folderName });
    }
    throw new Error('Local mode unique folder name generation not available');
  } else {
    // Server mode: Use HTTP endpoint (to be implemented in Phase 4)
    const backendUrl = await getBackendUrl();
    const response = await fetch(`${backendUrl}/files/unique-name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ basePath, folderName })
    });

    if (!response.ok) {
      throw new Error(`Failed to generate unique folder name: ${response.statusText}`);
    }

    const result = await response.json();
    return result.uniqueName;
  }
};

/**
 * Show save file dialog
 * @param {string} defaultName - Default file name
 * @returns {Promise<string>} Selected file path for saving
 */
export const saveFile = async (defaultName) => {
  if (isLocalMode()) {
    if (isTauriAvailable()) {
      return await invokeTauri('save_file', { defaultName });
    }
    throw new Error('Local mode save file dialog not available');
  } else {
    // Server mode: Use SVAR save dialog
    const result = await showSaveDialog({ defaultName });
    return result || '';
  }
};

/**
 * Write content to a file
 * @param {string} filePath - File path to write to
 * @param {string} content - Content to write
 * @returns {Promise<{success: boolean, error?: string}>} Result of write operation
 */
export const writeFile = async (filePath, content) => {
  if (isLocalMode()) {
    if (isTauriAvailable()) {
      await invokeTauri('write_file', { filePath, content });
      return { success: true };
    }
    throw new Error('Local mode file write not available');
  } else {
    // Server mode: Use HTTP endpoint (to be implemented in Phase 4)
    const backendUrl = await getBackendUrl();
    const response = await fetch(`${backendUrl}/files/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content })
    });

    if (!response.ok) {
      throw new Error(`Failed to write file: ${response.statusText}`);
    }

    const result = await response.json();
    return { success: result.status === 'success', error: result.error };
  }
};

/**
 * Read content from a file
 * @param {string} filePath - File path to read from
 * @returns {Promise<string>} Content of the file
 */
export const readFile = async (filePath) => {
  if (isLocalMode()) {
    if (isTauriAvailable()) {
      return await invokeTauri('read_text_file', { filePath });
    }
    throw new Error('Local mode file read not available');
  } else {
    // Server mode: Use HTTP endpoint
    const backendUrl = await getBackendUrl();
    const response = await fetch(`${backendUrl}/files/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath })
    });

    if (!response.ok) {
      throw new Error(`Failed to read file: ${response.statusText}`);
    }

    const result = await response.json();
    return result.content;
  }
};

/**
 * Default export with all file operations
 */
const fileOperations = {
  selectFiles,
  selectFolder,
  selectCSVFiles,
  selectTextFiles,
  selectJSONFiles,
  selectModelFiles,
  generateUniqueFolderName,
  saveFile,
  writeFile,
  readFile
};

export default fileOperations;
