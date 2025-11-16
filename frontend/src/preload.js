const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File selection
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectCSVFiles: () => ipcRenderer.invoke('select-csv-files'),
  selectTextFiles: () => ipcRenderer.invoke('select-text-files'),
  selectJSONFiles: () => ipcRenderer.invoke('select-json-files'),
  selectModelFiles: () => ipcRenderer.invoke('select-model-files'),
  generateUniqueFolderName: (basePath, folderName) => ipcRenderer.invoke('generate-unique-folder-name', basePath, folderName),
  saveFile: (defaultName) => ipcRenderer.invoke('save-file', defaultName),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),

  // Process management (kill only - used as fallback for job cancellation)
  killPythonProcess: (processId) =>
    ipcRenderer.invoke('kill-python-process', processId)
});