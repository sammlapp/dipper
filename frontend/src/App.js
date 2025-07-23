import React, { useState, useEffect } from 'react';
import './App.css';
import ExploreTab from './components/ExploreTab';
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
    { id: 'explore', name: 'Explore' },
    { id: 'review', name: 'Review' }
  ];

  const models = {
    'HawkEars': 'HawkEars Canadian bird classification CNN v0.1.0 (PyTorch)',
    'RanaSierraeCNN': 'CNN trained to detect Rana sierrae calls (PyTorch)',
    // TensorFlow-dependent models excluded for distribution build: BirdNET, Perch, SeparationModel
    'BirdSetConvNeXT': 'BirdSet: ConvNext Global Bird Song Classification Model (PyTorch)',
    'BirdSetBirdSetEfficientNetB1': 'BirdSet: EfficientNetB1 Global Bird Song Classification Model (PyTorch)',
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

    setIsRunning(true);
    setLogs([]);
    setError('');
    setProgress('Starting inference...');

    try {
      const processId = Date.now().toString();
      
      // Create temporary config file
      const tempConfigPath = `/tmp/inference_config_${processId}.json`;
      const configData = {
        model: selectedModel,
        files: selectedFiles,
        output_file: outputFile,
        inference_settings: config.inference
      };

      // Save temporary config file using HTTP API
      setProgress('Preparing configuration...');
      const saveResponse = await fetch('http://localhost:8000/config/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config_data: configData,
          output_path: tempConfigPath
        })
      });

      const saveResult = await saveResponse.json();
      if (saveResult.status !== 'success') {
        throw new Error(`Failed to save configuration: ${saveResult.error}`);
      }

      // Run inference with environment setup via HTTP API
      setProgress('Setting up ML environment and running inference...');
      const envPath = './runtime_envs/dipper_pytorch_env';
      const archivePath = './environments/dipper_pytorch_env.tar.gz';
      
      const inferenceResponse = await fetch('http://localhost:8000/inference/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config_path: tempConfigPath,
          env_path: envPath,
          archive_path: archivePath
        })
      });

      const inferenceResult = await inferenceResponse.json();
      
      if (inferenceResult.status === 'success') {
        setProgress('Inference completed successfully!');
        if (outputFile) {
          setProgress(prev => prev + ` Results saved to: ${outputFile.split('/').pop()}`);
        }
        
        // Parse any results from the inference output
        if (inferenceResult.output) {
          try {
            const outputLines = inferenceResult.output.split('\n').filter(line => line.trim());
            let summary = null;

            // Look for JSON output from inference script
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

            if (summary && summary.species_detected && summary.species_detected.length > 0) {
              setProgress(prev => prev + `. Detected species: ${summary.species_detected.slice(0, 3).join(', ')}${summary.species_detected.length > 3 ? '...' : ''}`);
            }
          } catch (parseError) {
            // Ignore parsing errors for output
          }
        }
      } else {
        throw new Error(inferenceResult.error || 'Inference failed');
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

  const saveInferenceConfig = async () => {
    try {
      if (!window.electronAPI) {
        setError('Electron API not available - running in browser mode');
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `inference_config_${timestamp}.json`;
      const configPath = await window.electronAPI.saveFile(defaultName);
      
      if (configPath) {
        const configData = {
          model: selectedModel,
          files: selectedFiles,
          output_file: outputFile,
          inference_settings: config.inference
        };

        // Use HTTP API to save config
        const response = await fetch('http://localhost:8000/config/save', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            config_data: configData,
            output_path: configPath
          })
        });

        const result = await response.json();
        if (result.status === 'success') {
          setProgress(`Config saved to: ${configPath.split('/').pop()}`);
        } else {
          setError(`Failed to save config: ${result.error}`);
        }
      }
    } catch (err) {
      setError('Failed to save config: ' + err.message);
    }
  };

  const loadInferenceConfig = async () => {
    try {
      if (!window.electronAPI) {
        setError('Electron API not available - running in browser mode');
        return;
      }

      const configFile = await window.electronAPI.selectFiles();
      if (configFile && configFile.length > 0) {
        // Use HTTP API to load config
        const response = await fetch('http://localhost:8000/config/load', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            config_path: configFile[0]
          })
        });

        const result = await response.json();
        if (result.status === 'success') {
          const configData = result.config;
          setSelectedModel(configData.model || '');
          setSelectedFiles(configData.files || []);
          setOutputFile(configData.output_file || '');
          setConfig(prev => ({
            ...prev,
            inference: { ...prev.inference, ...configData.inference_settings }
          }));
          setProgress(`Config loaded from: ${configFile[0].split('/').pop()}`);
        } else {
          setError(`Failed to load config: ${result.error}`);
        }
      }
    } catch (err) {
      setError('Failed to load config: ' + err.message);
    }
  };

  return (
    <div className="App">
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
              <div className="button-group" style={{ marginBottom: '15px' }}>
                <button onClick={saveInferenceConfig} disabled={isRunning}>
                  Save Config
                </button>
                <button onClick={loadInferenceConfig} disabled={isRunning}>
                  Load Config
                </button>
              </div>
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

        {activeTab === 'explore' && (
          <ExploreTab />
        )}

        {activeTab === 'review' && (
          <ReviewTab />
        )}
      </main>
    </div>
  );
}

export default App;