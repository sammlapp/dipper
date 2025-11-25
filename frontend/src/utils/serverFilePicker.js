/**
 * Server Mode File Picker Utilities
 *
 * Provides promise-based file/folder picker functions for server mode.
 * These functions render ServerFileBrowser components and return selected paths.
 */

import ReactDOM from 'react-dom/client';
import ServerFileBrowser from '../components/ServerFileBrowser';

/**
 * Show file picker dialog and return selected file(s)
 * @param {Object} options - Picker options
 * @param {boolean} options.multiple - Allow multiple selection
 * @param {string[]} options.filters - File extensions to filter (e.g., ['.csv', '.json'])
 * @param {string} options.title - Dialog title
 * @returns {Promise<string|string[]|null>} Selected file path(s) or null if cancelled
 */
export const showFilePicker = (options = {}) => {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    const cleanup = () => {
      root.unmount();
      document.body.removeChild(container);
    };

    const handleSelect = (paths) => {
      cleanup();
      resolve(paths);
    };

    const handleClose = () => {
      cleanup();
      resolve(null);
    };

    root.render(
      <ServerFileBrowser
        open={true}
        onClose={handleClose}
        onSelect={handleSelect}
        mode="file"
        multiple={options.multiple || false}
        filters={options.filters || []}
        title={options.title || 'Select File'}
      />
    );
  });
};

/**
 * Show folder picker dialog and return selected folder
 * @param {Object} options - Picker options
 * @param {string} options.title - Dialog title
 * @returns {Promise<string|null>} Selected folder path or null if cancelled
 */
export const showFolderPicker = (options = {}) => {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    const cleanup = () => {
      root.unmount();
      document.body.removeChild(container);
    };

    const handleSelect = (path) => {
      cleanup();
      resolve(path);
    };

    const handleClose = () => {
      cleanup();
      resolve(null);
    };

    root.render(
      <ServerFileBrowser
        open={true}
        onClose={handleClose}
        onSelect={handleSelect}
        mode="folder"
        multiple={false}
        title={options.title || 'Select Folder'}
      />
    );
  });
};

/**
 * Show save file dialog and return save path
 * @param {Object} options - Save dialog options
 * @param {string} options.defaultName - Default file name
 * @param {string} options.title - Dialog title
 * @returns {Promise<string|null>} Save file path or null if cancelled
 */
export const showSaveDialog = async (options = {}) => {
  // For server mode, we first let user pick a folder, then append the filename
  const folder = await showFolderPicker({
    title: options.title || 'Select Save Location'
  });

  if (!folder) {
    return null;
  }

  // Prompt for filename
  const filename = prompt('Enter filename:', options.defaultName || 'file.json');
  if (!filename) {
    return null;
  }

  // Combine folder and filename
  return `${folder}/${filename}`;
};

/**
 * Convenience functions for specific file types
 */

export const showAudioFilePicker = (multiple = false) => {
  return showFilePicker({
    multiple,
    filters: ['.wav', '.mp3', '.flac', '.ogg', '.m4a'],
    title: 'Select Audio Files'
  });
};

export const showCSVFilePicker = (multiple = false) => {
  return showFilePicker({
    multiple,
    filters: ['.csv', '.pkl'],
    title: 'Select CSV/PKL Files'
  });
};

export const showTextFilePicker = (multiple = false) => {
  return showFilePicker({
    multiple,
    filters: ['.txt', '.csv'],
    title: 'Select Text Files'
  });
};

export const showJSONFilePicker = (multiple = false) => {
  return showFilePicker({
    multiple,
    filters: ['.json'],
    title: 'Select JSON Files'
  });
};

export const showModelFilePicker = (multiple = false) => {
  return showFilePicker({
    multiple,
    filters: [],  // No filter - allow any file
    title: 'Select Model Files'
  });
};
