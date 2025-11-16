const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

// Development/production detection
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// HTTP Server management
let httpServerProcess = null;
const HTTP_SERVER_PORT = 8000;

let mainWindow;

// Helper function to get backend scripts path
function getBackendScriptsPath() {
  if (isDev) {
    // In development, backend is in the parent directory
    return path.join(__dirname, '../../backend/scripts');
  } else {
    // In production, backend is in resources
    return path.join(process.resourcesPath, 'backend', 'scripts');
  }
}

// Helper function to get bundled Python executable path
function getBundledPythonExecutable(scriptName = 'minimal_server') {
  if (isDev) {
    // In development, check if python-dist exists in the project
    const devExecutablePath = path.join(__dirname, '../python-dist', scriptName);
    if (fs.existsSync(devExecutablePath)) {
      return devExecutablePath;
    }
    // Fallback to backend directory for development
    const devBackendPath = path.join(__dirname, '../../backend/dist', scriptName);
    if (fs.existsSync(devBackendPath)) {
      return devBackendPath;
    }
  } else {
    // In production, Python executables are bundled with the app
    const resourcesPath = process.resourcesPath;
    const executablePath = path.join(resourcesPath, 'python-dist', scriptName);
    
    if (fs.existsSync(executablePath)) {
      return executablePath;
    }
  }
  
  return null;
}

// Helper function to get bundled Python path (legacy)
function getBundledPythonPath() {
  return getBundledPythonExecutable('python');
}

// Helper function to get the best way to run a Python script
function getPythonCommand(scriptName) {
  // For the new architecture, we primarily use the lightweight_server HTTP API
  // This function is kept for compatibility but should only be used for the server itself
  
  if (scriptName === 'lightweight_server') {
    const executablePath = getBundledPythonExecutable('lightweight_server');
    if (executablePath) {
      return {
        command: executablePath,
        needsScript: false
      };
    }
  }
  
  // Fall back to system Python with script path for any remaining direct script calls
  const pythonPath = getCondaPythonPath();
  return {
    command: pythonPath,
    needsScript: true,
    scriptPath: path.join(getBackendScriptsPath(), `${scriptName}.py`)
  };
}

// Python path detection
function getCondaPythonPath() {
  // First, try to find bundled Python environment
  const bundledPythonPath = getBundledPythonPath();
  if (bundledPythonPath) {
    console.log(`Using bundled Python at: ${bundledPythonPath}`);
    return bundledPythonPath;
  }
  
  // Fallback to system conda environments
  const homeDir = os.homedir();
  const possiblePaths = [
    // User's exact path (highest priority)
    '/Users/SML161/miniconda3/envs/train_gui/bin/python',
    // Common patterns for train_gui environment
    path.join(homeDir, 'miniconda3', 'envs', 'train_gui', 'bin', 'python'),
    path.join(homeDir, 'anaconda3', 'envs', 'train_gui', 'bin', 'python'),
    path.join(homeDir, 'miniforge3', 'envs', 'train_gui', 'bin', 'python'),
    '/opt/miniconda3/envs/train_gui/bin/python',
    '/opt/anaconda3/envs/train_gui/bin/python',
    // Also try training_gui in case the environment gets renamed
    path.join(homeDir, 'miniconda3', 'envs', 'training_gui', 'bin', 'python'),
    path.join(homeDir, 'anaconda3', 'envs', 'training_gui', 'bin', 'python'),
    path.join(homeDir, 'miniforge3', 'envs', 'training_gui', 'bin', 'python'),
    '/opt/miniconda3/envs/training_gui/bin/python',
    '/opt/anaconda3/envs/training_gui/bin/python',
    'python3' // Fallback to system python
  ];
  
  console.log('Searching for conda python in these paths:');
  for (const pythonPath of possiblePaths) {
    console.log(`  Checking: ${pythonPath}`);
    if (fs.existsSync(pythonPath)) {
      console.log(`  Found Python at: ${pythonPath}`);
      return pythonPath;
    }
  }
  
  console.log('No conda python found, falling back to system python');
  return 'python3'; // Ultimate fallback
}

async function createWindow() {
  console.log('=== DIPPER REVIEW - ELECTRON STARTUP ===');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('isDev:', isDev);
  console.log('app.isPackaged:', app.isPackaged);

  // Start HTTP server for audio processing first
  await startHttpServer();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Dipper Review',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the app
  let startUrl;
  if (isDev) {
    startUrl = 'http://localhost:3000';
  } else {
    // In production, the build folder is inside app.asar
    // __dirname will be inside app.asar/src, so go up one level to app.asar root, then into build
    const indexPath = path.join(__dirname, '..', 'build', 'index.html');
    startUrl = url.format({
      pathname: indexPath,
      protocol: 'file:',
      slashes: true
    });
  }

  console.log('Loading URL:', startUrl);
  console.log('__dirname:', __dirname);
  console.log('process.resourcesPath:', process.resourcesPath);
  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});


// Wait for HTTP server to be ready
async function waitForServer(maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${HTTP_SERVER_PORT}/health`);
      if (response.ok) {
        console.log('HTTP server is ready!');
        return true;
      }
    } catch (error) {
      // Server not ready yet, wait and retry
    }
    console.log(`Waiting for HTTP server... (${i + 1}/${maxRetries})`);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
  }
  console.error('HTTP server failed to start within timeout period');
  return false;
}

// Check if HTTP server is already running
async function checkServerRunning(port) {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.request({
      hostname: 'localhost',
      port: port,
      path: '/health',
      method: 'GET',
      timeout: 2000
    }, (res) => {
      resolve(true);
    });
    
    req.on('error', () => {
      resolve(false);
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    
    req.end();
  });
}

// Start HTTP server for audio processing
async function startHttpServer() {
  if (httpServerProcess) {
    console.log('HTTP server already running');
    return;
  }
  
  // Check if server is already running (e.g., started directly with Python)
  const serverRunning = await checkServerRunning(HTTP_SERVER_PORT);
  if (serverRunning) {
    console.log(`HTTP server already running on port ${HTTP_SERVER_PORT} (external)`);
    return;
  }
  
  try {
    let command, args;
    
    if (isDev) {
      // In development, always use Python script directly for faster startup
      const pythonPath = getCondaPythonPath();
      const serverScriptPath = path.join(process.cwd(), '..', 'backend', 'lightweight_server.py');
      command = pythonPath;
      args = [serverScriptPath, '--port', HTTP_SERVER_PORT.toString()];
      console.log(`Starting HTTP server (Python dev): ${command} ${args.join(' ')}`);
    } else {
      // In production, try PyInstaller executable first
      const lightweightServerExecutable = getBundledPythonExecutable('lightweight_server');
      if (lightweightServerExecutable) {
        // Use lightweight PyInstaller executable
        command = lightweightServerExecutable;
        args = ['--port', HTTP_SERVER_PORT.toString()];
        console.log(`Starting lightweight HTTP server (PyInstaller): ${command} ${args.join(' ')}`);
      } else {
        // Fallback to Python + script
        const pythonPath = getCondaPythonPath();
        const serverScriptPath = path.join(process.cwd(), '..', 'backend', 'lightweight_server.py');
        command = pythonPath;
        args = [serverScriptPath, '--port', HTTP_SERVER_PORT.toString()];
        console.log(`Starting HTTP server (Python fallback): ${command} ${args.join(' ')}`);
      }
    }

    httpServerProcess = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: isDev ? path.join(process.cwd(), '..', 'backend') : path.join(process.cwd(), 'backend')
    });
    
    httpServerProcess.stdout.on('data', (data) => {
      console.log(`HTTP Server stdout: ${data}`);
    });
    
    httpServerProcess.stderr.on('data', (data) => {
      console.error(`HTTP Server stderr: ${data}`);
    });
    
    httpServerProcess.on('close', (code) => {
      console.log(`HTTP server process exited with code ${code}`);
      httpServerProcess = null;
    });
    
    // Wait for server to be ready
    console.log('Waiting for HTTP server to start...');
    await waitForServer();
    
  } catch (error) {
    console.error('Failed to start HTTP server:', error);
  }
}

// Stop HTTP server
function stopHttpServer() {
  if (httpServerProcess) {
    httpServerProcess.kill();
    httpServerProcess = null;
    console.log('HTTP server stopped');
  }
}

// Clean up on app exit
app.on('before-quit', () => {
  stopHttpServer();
});

// IPC handlers
const pythonProcesses = new Map();

ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio Files', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.filePaths;
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});

ipcMain.handle('select-csv-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Prediction Files', extensions: ['csv', 'pkl'] },
      { name: 'CSV Files', extensions: ['csv'] },
      { name: 'PKL Files', extensions: ['pkl'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.filePaths;
});

ipcMain.handle('select-text-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Text Files', extensions: ['txt', 'csv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.filePaths;
});

ipcMain.handle('select-json-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.filePaths;
});

ipcMain.handle('select-model-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.filePaths;
});

ipcMain.handle('generate-unique-folder-name', async (event, basePath, folderName) => {
  // Generate a unique folder name by adding numeric suffix if needed
  let uniqueName = folderName;
  let counter = 1;
  
  while (fs.existsSync(path.join(basePath, uniqueName))) {
    uniqueName = `${folderName}_${counter}`;
    counter++;
  }
  
  return uniqueName;
});

ipcMain.handle('save-file', async (event, defaultName) => {
  // Determine file type from extension
  const isJsonFile = defaultName && defaultName.toLowerCase().includes('.json');

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: isJsonFile ? [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ] : [
      { name: 'CSV Files', extensions: ['csv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.filePath;
});

// Process management - used as fallback for job cancellation
ipcMain.handle('kill-python-process', async (event, processId) => {
  const process = pythonProcesses.get(processId);
  if (process) {
    process.kill();
    pythonProcesses.delete(processId);
    return true;
  }
  return false;
});

ipcMain.handle('write-file', async (event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});