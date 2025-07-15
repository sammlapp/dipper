const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

// HTTP Server management
let httpServerProcess = null;
const HTTP_SERVER_PORT = 8000;

// Force development mode - we want to always load from localhost:3000 when developing
const isDev = true; // Force development mode for now

let mainWindow;

async function tryDevServer() {
  try {
    const http = require('http');
    return new Promise((resolve) => {
      const req = http.get('http://localhost:3000', (res) => {
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
}

async function createWindow() {
  console.log('=== ELECTRON STARTUP ===');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('ELECTRON_IS_DEV:', process.env.ELECTRON_IS_DEV);
  console.log('app.isPackaged:', app.isPackaged);
  console.log('isDev:', isDev);
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Check if development server is running
  const devServerRunning = await tryDevServer();
  console.log('Dev server running:', devServerRunning);
  
  if (isDev && devServerRunning) {
    console.log('=== LOADING DEVELOPMENT VERSION ===');
    console.log('Loading from: http://localhost:3000');
    await mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    console.log('=== LOADING PRODUCTION VERSION ===');
    const buildPath = path.join(__dirname, '../../build/index.html');
    console.log('Build path:', buildPath);
    console.log('Build exists:', fs.existsSync(buildPath));
    
    if (fs.existsSync(buildPath)) {
      await mainWindow.loadFile(buildPath);
    } else {
      console.log('Build not found, creating placeholder');
      mainWindow.loadURL('data:text/html,<h1>Build not found. Run npm run build first.</h1>');
    }
  }

  console.log('=== WINDOW LOADED ===');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Start HTTP server after window is loaded
  await startHttpServer();
}

async function startHttpServer() {
  if (httpServerProcess) {
    console.log('HTTP server already running');
    return;
  }

  try {
    const pythonPath = getCondaPythonPath();
    const serverScriptPath = path.join(__dirname, '../../../backend/scripts/http_server.py');
    
    console.log(`Starting HTTP server: ${pythonPath} ${serverScriptPath} --port ${HTTP_SERVER_PORT}`);
    
    httpServerProcess = spawn(pythonPath, [serverScriptPath, '--port', HTTP_SERVER_PORT.toString()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.join(__dirname, '../../../backend')
    });
    
    httpServerProcess.stdout.on('data', (data) => {
      console.log(`HTTP Server stdout: ${data.toString()}`);
    });
    
    httpServerProcess.stderr.on('data', (data) => {
      console.log(`HTTP Server stderr: ${data.toString()}`);
    });
    
    httpServerProcess.on('close', (code) => {
      console.log(`HTTP server process exited with code ${code}`);
      httpServerProcess = null;
    });
    
    httpServerProcess.on('error', (error) => {
      console.error(`HTTP server error: ${error}`);
      httpServerProcess = null;
    });

    // Wait a bit for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test server health
    try {
      const http = require('http');
      const healthCheck = new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${HTTP_SERVER_PORT}/health`, (res) => {
          if (res.statusCode === 200) {
            console.log('✅ HTTP server started successfully');
            resolve(true);
          } else {
            reject(new Error(`Health check failed: ${res.statusCode}`));
          }
        });
        req.on('error', reject);
        req.setTimeout(5000, () => {
          req.destroy();
          reject(new Error('Health check timeout'));
        });
      });
      
      await healthCheck;
    } catch (error) {
      console.error('❌ HTTP server health check failed:', error.message);
    }
    
  } catch (error) {
    console.error('Failed to start HTTP server:', error);
  }
}

function stopHttpServer() {
  if (httpServerProcess) {
    console.log('Stopping HTTP server...');
    httpServerProcess.kill('SIGTERM');
    httpServerProcess = null;
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopHttpServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  stopHttpServer();
});

// File selection handlers
ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio Files', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'WAV', 'MP3', 'FLAC', 'OGG', 'M4A'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.filePaths;
});

ipcMain.handle('select-csv-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'CSV Files', extensions: ['csv'] },
      { name: 'Text Files', extensions: ['txt', 'tsv'] },
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

ipcMain.handle('save-file', async (event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [
      { name: 'CSV Files', extensions: ['csv'] },
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.filePath;
});

// Python subprocess management
const pythonProcesses = new Map();

function getCondaPythonPath() {
  // Try to find conda python in the train_gui environment
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

ipcMain.handle('run-python-script', async (event, scriptPath, args, processId) => {
  return new Promise((resolve, reject) => {
    const pythonPath = getCondaPythonPath();
    const fullScriptPath = path.join(__dirname, '../../../backend/scripts', scriptPath);
    
    console.log(`Running: ${pythonPath} ${fullScriptPath} ${args.join(' ')}`);
    
    const process = spawn(pythonPath, [fullScriptPath, ...args]);
    pythonProcesses.set(processId, process);
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      // Send progress updates to renderer
      mainWindow.webContents.send('python-output', { 
        processId, 
        type: 'stdout', 
        data: output 
      });
    });
    
    process.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      mainWindow.webContents.send('python-output', { 
        processId, 
        type: 'stderr', 
        data: output 
      });
    });
    
    process.on('close', (code) => {
      pythonProcesses.delete(processId);
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`Python process exited with code ${code}: ${stderr}`));
      }
    });
    
    process.on('error', (error) => {
      pythonProcesses.delete(processId);
      reject(error);
    });
  });
});

ipcMain.handle('kill-python-process', async (event, processId) => {
  const process = pythonProcesses.get(processId);
  if (process) {
    process.kill();
    pythonProcesses.delete(processId);
    return true;
  }
  return false;
});

// Add a test handler to check Python path
ipcMain.handle('test-python-path', async () => {
  const pythonPath = getCondaPythonPath();
  return {
    pythonPath: pythonPath,
    exists: fs.existsSync(pythonPath),
    homeDir: os.homedir()
  };
});

// Audio clip creation handler
ipcMain.handle('create-audio-clips', async (event, filePath, startTime, endTime, settings) => {
  return new Promise((resolve, reject) => {
    const pythonPath = getCondaPythonPath();
    const fullScriptPath = path.join(__dirname, '../../../backend/scripts/create_audio_clips.py');
    
    const args = [
      '--file', filePath,
      '--start', startTime.toString(),
      '--end', endTime.toString(),
      '--settings', JSON.stringify(settings)
    ];
    
    console.log(`Creating audio clips: ${pythonPath} ${fullScriptPath} ${args.join(' ')}`);
    
    const process = spawn(pythonPath, [fullScriptPath, ...args]);
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        try {
          // Try to find JSON in the output (in case there's extra logging)
          const lines = stdout.split('\n').filter(line => line.trim());
          let result = null;
          
          // Look for valid JSON in the output lines
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.status) {
                result = parsed;
                break;
              }
            } catch (e) {
              // Continue looking
            }
          }
          
          if (result) {
            resolve(result);
          } else {
            reject(new Error(`No valid JSON found in output. Raw output: ${stdout}`));
          }
        } catch (parseError) {
          reject(new Error(`Failed to parse audio clip creation result: ${parseError.message}. Raw output: ${stdout}`));
        }
      } else {
        reject(new Error(`Audio clip creation failed with code ${code}: ${stderr}`));
      }
    });
    
    process.on('error', (error) => {
      reject(error);
    });
  });
});

// Batch audio clip creation handler
ipcMain.handle('create-audio-clips-batch', async (event, clipsData, settings) => {
  return new Promise((resolve, reject) => {
    const pythonPath = getCondaPythonPath();
    const fullScriptPath = path.join(__dirname, '../../../backend/scripts/create_audio_clips_batch.py');
    
    const args = [
      '--clips', JSON.stringify(clipsData),
      '--settings', JSON.stringify(settings)
    ];
    
    console.log(`Creating audio clips batch: ${pythonPath} ${fullScriptPath}`);
    console.log(`Processing ${clipsData.length} clips`);
    
    const process = spawn(pythonPath, [fullScriptPath, ...args]);
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        try {
          // Try to find JSON in the output (in case there's extra logging)
          const lines = stdout.split('\n').filter(line => line.trim());
          let result = null;
          
          // Look for valid JSON in the output lines
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.status) {
                result = parsed;
                break;
              }
            } catch (e) {
              // Continue looking
            }
          }
          
          if (result) {
            resolve(result);
          } else {
            reject(new Error(`No valid JSON found in batch output. Raw output: ${stdout}`));
          }
        } catch (parseError) {
          reject(new Error(`Failed to parse batch audio clip creation result: ${parseError.message}. Raw output: ${stdout}`));
        }
      } else {
        reject(new Error(`Batch audio clip creation failed with code ${code}: ${stderr}`));
      }
    });
    
    process.on('error', (error) => {
      reject(error);
    });
  });
});