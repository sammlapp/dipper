import React, { useState, useEffect } from 'react';
import './App.css';
import ExploreTab from './components/ExploreTab';
import SettingsTab from './components/SettingsTab';
import ReviewTab from './components/ReviewTab';

function App() {
  const [activeTab, setActiveTab] = useState('inference');
  
  // Inference state
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [outputFile, setOutputFile] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  
  // Configuration (matching streamlit_inference.py cfg structure)
  const [config, setConfig] = useState({
    inference: {
      clip_overlap: 0.0,
      batch_size: 1,
      num_workers: 0,
    }
  });

  const tabs = [
    { id: 'inference', name: 'Inference' },
    { id: 'training', name: 'Training' },
    { id: 'explore', name: 'Explore' },
    { id: 'review', name: 'Review' },
    { id: 'settings', name: 'Settings' }
  ];

  const models = {
    'BirdNET': 'Global bird species classification (TensorFlow)',
    'Perch': 'Global bird species classification (TensorFlow)', 
    'HawkEars': 'HawkEars Canadian bird classification CNN v0.1.0 (PyTorch)',
    'RanaSierraeCNN': 'CNN trained to detect Rana sierrae calls (PyTorch)',
  };

  // Set up Python output listener
  useEffect(() => {
    if (window.electronAPI) {
      const handlePythonOutput = (event, data) => {
        setLogs(prev => [...prev, data.data]);
        
        // Parse progress if available
        if (data.data.includes('Progress:')) {
          const match = data.data.match(/Progress:\s*(\d+)%/);
          if (match) {
            setProgress(`Progress: ${match[1]}%`);
          }
        }
      };

      window.electronAPI.onPythonOutput(handlePythonOutput);
      
      return () => {
        window.electronAPI.removePythonOutputListener(handlePythonOutput);
      };
    }
  }, []);

  const handleSelectFiles = async () => {
    try {
      if (!window.electronAPI) {
        setError('Electron API not available - running in browser mode');
        return;
      }
      
      const files = await window.electronAPI.selectFiles();
      setSelectedFiles(files);
      setError('');
    } catch (err) {
      setError('Failed to select files: ' + err.message);
    }
  };

  const handleSelectFolder = async () => {
    try {
      if (!window.electronAPI) {
        setError('Electron API not available - running in browser mode');
        return;
      }
      
      const folder = await window.electronAPI.selectFolder();
      if (folder) {
        setProgress('Scanning folder for audio files...');
        setLogs([]);
        
        const processId = Date.now().toString();
        const result = await window.electronAPI.runPythonScript(
          'scan_folder.py',
          [folder],
          processId
        );
        
        const data = JSON.parse(result.stdout);
        if (data.error) {
          setError(data.error);
        } else {
          setSelectedFiles(data.files);
          setProgress(`Found ${data.count} audio files`);
          setError('');
        }
      }
    } catch (err) {
      setError('Failed to scan folder: ' + err.message);
    }
  };

  const handleSelectOutputFile = async () => {
    try {
      if (!window.electronAPI) {
        setError('Electron API not available - running in browser mode');
        return;
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `${selectedModel}_predictions_${timestamp}.csv`;
      const file = await window.electronAPI.saveFile(defaultName);
      if (file) {
        setOutputFile(file);
      }
    } catch (err) {
      setError('Failed to select output file: ' + err.message);
    }
  };

  const handleRunInference = async () => {
    if (!selectedModel) {
      setError('Please select a model');
      return;
    }
    
    if (selectedFiles.length === 0) {
      setError('Please select audio files');
      return;
    }
    
    if (!window.electronAPI) {
      setError('Electron API not available - running in browser mode');
      return;
    }

    setIsRunning(true);
    setLogs([]);
    setError('');
    setProgress('Starting inference...');

    try {
      const processId = Date.now().toString();
      
      const args = [
        '--model', selectedModel,
        '--files', JSON.stringify(selectedFiles),
        '--output', outputFile || '',
        '--config', JSON.stringify(config.inference)
      ];

      const result = await window.electronAPI.runPythonScript(
        'inference.py',
        args,
        processId
      );

      // Parse the JSON output more safely
      try {
        const outputLines = result.stdout.split('\n').filter(line => line.trim());
        let summary = null;
        
        // Look for the JSON output (usually the last line)
        for (let i = outputLines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(outputLines[i]);
            if (parsed.status) {
              summary = parsed;
              break;
            }
          } catch (e) {
            // Continue looking for valid JSON
          }
        }
        
        if (summary && summary.status === 'success') {
          setProgress(`Inference completed! Processed ${summary.files_processed} files`);
          if (summary.species_detected && summary.species_detected.length > 0) {
            setProgress(prev => prev + `. Detected species: ${summary.species_detected.slice(0, 3).join(', ')}${summary.species_detected.length > 3 ? '...' : ''}`);
          }
          if (summary.output_file) {
            setProgress(prev => prev + `. Results saved to: ${summary.output_file.split('/').pop()}`);
          }
        } else if (summary && summary.status === 'error') {
          setError(summary.error);
        } else {
          setProgress('Inference completed successfully!');
        }
      } catch (parseError) {
        console.log('JSON parse error, but inference may have succeeded:', parseError);
        setProgress('Inference completed! Check the output file for results.');
      }
      
    } catch (err) {
      setError(`Inference failed: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const clearLogs = () => {
    setLogs([]);
    setError('');
    setProgress('');
  };

  const handleTestPython = async () => {
    try {
      if (!window.electronAPI) {
        setError('Electron API not available - running in browser mode');
        return;
      }
      
      setProgress('Testing Python path...');
      const result = await window.electronAPI.testPythonPath();
      setProgress(`Python path: ${result.pythonPath} (exists: ${result.exists})`);
      setLogs(prev => [...prev, `Home directory: ${result.homeDir}`]);
      setLogs(prev => [...prev, `Python path: ${result.pythonPath}`]);
      setLogs(prev => [...prev, `Path exists: ${result.exists}`]);
      
      if (!result.exists) {
        setError(`Python not found at ${result.pythonPath}. Please check your conda environment.`);
      } else {
        setError('');
      }
    } catch (err) {
      setError('Failed to test Python path: ' + err.message);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Bioacoustics Training GUI</h1>
      </header>
      
      <nav className="tab-nav">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.name}
          </button>
        ))}
      </nav>
      
      <main className="main-content">
        {activeTab === 'inference' && (
          <div className="tab-content">
            <h2>Species Detection Inference</h2>
            
            {error && (
              <div className="error-message">
                <strong>Error:</strong> {error}
              </div>
            )}
            
            {progress && (
              <div className="progress-message">
                {progress}
              </div>
            )}
            
            <div className="section">
              <h3>1. Select Model</h3>
              <select 
                value={selectedModel} 
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={isRunning}
              >
                <option value="">Choose a model...</option>
                {Object.entries(models).map(([name, description]) => (
                  <option key={name} value={name}>
                    {name} - {description}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="section">
              <h3>2. Configure Settings</h3>
              <div className="config-grid">
                <label>
                  Clip Overlap (seconds):
                  <input
                    type="number"
                    step="0.1"
                    value={config.inference.clip_overlap}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      inference: { ...prev.inference, clip_overlap: parseFloat(e.target.value) }
                    }))}
                    disabled={isRunning}
                  />
                </label>
                <label>
                  Batch Size:
                  <input
                    type="number"
                    min="1"
                    value={config.inference.batch_size}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      inference: { ...prev.inference, batch_size: parseInt(e.target.value) }
                    }))}
                    disabled={isRunning}
                  />
                </label>
                <label>
                  Num Workers:
                  <input
                    type="number"
                    min="0"
                    value={config.inference.num_workers}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      inference: { ...prev.inference, num_workers: parseInt(e.target.value) }
                    }))}
                    disabled={isRunning}
                  />
                </label>
              </div>
            </div>
            
            <div className="section">
              <h3>3. Select Audio Files</h3>
              <div className="button-group">
                <button onClick={handleSelectFiles} disabled={isRunning}>
                  Select Files
                </button>
                <button onClick={handleSelectFolder} disabled={isRunning}>
                  Select Folder
                </button>
              </div>
              <p className="file-count">
                Selected files: {selectedFiles.length}
                {selectedFiles.length > 0 && (
                  <span className="file-sample">
                    <br />First file: {selectedFiles[0].split('/').pop()}
                  </span>
                )}
              </p>
            </div>
            
            <div className="section">
              <h3>4. Output Location (Optional)</h3>
              <button onClick={handleSelectOutputFile} disabled={isRunning}>
                Select Output File
              </button>
              {outputFile && (
                <p className="output-path">Output: {outputFile}</p>
              )}
            </div>
            
            <div className="section">
              <h3>5. Run Inference</h3>
              <div className="button-group">
                <button 
                  className="primary-button"
                  onClick={handleRunInference}
                  disabled={isRunning || !selectedModel || selectedFiles.length === 0}
                >
                  {isRunning ? 'Running...' : 'Run Inference'}
                </button>
                <button onClick={clearLogs} disabled={isRunning}>
                  Clear Logs
                </button>
                <button onClick={handleTestPython} disabled={isRunning}>
                  Test Python Path
                </button>
              </div>
            </div>
            
            {logs.length > 0 && (
              <div className="section">
                <h3>Logs</h3>
                <div className="logs-container">
                  {logs.slice(-20).map((log, index) => (
                    <div key={index} className="log-line">
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        
        {activeTab === 'training' && (
          <div className="tab-content">
            <h2>Model Training</h2>
            <p>Training interface will be implemented here.</p>
          </div>
        )}
        
        {activeTab === 'explore' && (
          <ExploreTab />
        )}
        
        {activeTab === 'review' && (
          <ReviewTab />
        )}
        
        {activeTab === 'settings' && (
          <SettingsTab />
        )}
      </main>
    </div>
  );
}

export default App;