const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectCSVFiles: () => ipcRenderer.invoke('select-csv-files'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  saveFile: (defaultName) => ipcRenderer.invoke('save-file', defaultName),
  
  // Python subprocess operations
  runPythonScript: (scriptPath, args, processId) => 
    ipcRenderer.invoke('run-python-script', scriptPath, args, processId),
  killPythonProcess: (processId) => ipcRenderer.invoke('kill-python-process', processId),
  
  // Audio clip creation
  createAudioClips: (filePath, startTime, endTime, settings) =>
    ipcRenderer.invoke('create-audio-clips', filePath, startTime, endTime, settings),
  
  // Batch audio clip creation
  createAudioClipsBatch: (clipsData, settings) =>
    ipcRenderer.invoke('create-audio-clips-batch', clipsData, settings),
  
  // Listen for Python output
  onPythonOutput: (callback) => ipcRenderer.on('python-output', callback),
  removePythonOutputListener: (callback) => ipcRenderer.removeListener('python-output', callback),
  
  // Test Python path
  testPythonPath: () => ipcRenderer.invoke('test-python-path'),
});