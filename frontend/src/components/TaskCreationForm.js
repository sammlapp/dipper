import React, { useState } from 'react';
import HelpIcon from './HelpIcon';

// Default values for inference form
const DEFAULT_VALUES = {
  taskName: '',
  fileSelectionMode: 'files',
  globPatterns: '',
  fileCount: 0,
  selectedExtensions: ['wav', 'mp3', 'flac'],
  config: {
    files: [],
    file_globbing_patterns: [],
    file_list: '',
    model: 'BirdNET',
    overlap: 0.0,
    batch_size: 1,
    worker_count: 1,
    output_dir: ''
  }
};

function TaskCreationForm({ onTaskCreate, onTaskCreateAndRun }) {
  const [taskName, setTaskName] = useState(DEFAULT_VALUES.taskName);
  const [fileSelectionMode, setFileSelectionMode] = useState(DEFAULT_VALUES.fileSelectionMode);
  const [globPatterns, setGlobPatterns] = useState(DEFAULT_VALUES.globPatterns);
  const [fileCount, setFileCount] = useState(DEFAULT_VALUES.fileCount);

  // Available audio extensions with their descriptions
  const availableExtensions = [
    { ext: 'wav', label: 'WAV', description: 'Uncompressed audio' },
    { ext: 'mp3', label: 'MP3', description: 'Compressed audio' },
    { ext: 'flac', label: 'FLAC', description: 'Lossless compressed' },
    { ext: 'ogg', label: 'OGG', description: 'Open source compressed' },
    { ext: 'm4a', label: 'M4A', description: 'Apple audio' },
    { ext: 'aac', label: 'AAC', description: 'Advanced audio coding' },
    { ext: 'wma', label: 'WMA', description: 'Windows media audio' },
    { ext: 'aiff', label: 'AIFF', description: 'Apple interchange' }
  ];

  // Selected extensions (default to most common)
  const [selectedExtensions, setSelectedExtensions] = useState(DEFAULT_VALUES.selectedExtensions);

  const [config, setConfig] = useState(DEFAULT_VALUES.config);

  const handleExtensionChange = (ext, checked) => {
    if (checked) {
      setSelectedExtensions(prev => [...prev, ext]);
    } else {
      setSelectedExtensions(prev => prev.filter(e => e !== ext));
    }
  };

  const generatePatternsForExtensions = (basePath, extensions) => {
    return extensions.flatMap(ext => [
      `${basePath}/**/*.${ext}`,
      `${basePath}/**/*.${ext.toUpperCase()}`
    ]);
  };

  const handleFileSelection = async () => {
    try {
      const files = await window.electronAPI.selectFiles();
      if (files && files.length > 0) {
        setConfig(prev => ({
          ...prev,
          files,
          file_globbing_patterns: [],
          file_list: ''
        }));
        setFileCount(files.length);
      }
    } catch (error) {
      console.error('Failed to select files:', error);
    }
  };

  const handleFolderSelection = async () => {
    try {
      const folder = await window.electronAPI.selectFolder();
      if (folder && selectedExtensions.length > 0) {
        // Create globbing patterns for selected extensions
        const patterns = generatePatternsForExtensions(folder, selectedExtensions);

        setConfig(prev => ({
          ...prev,
          files: [],
          file_globbing_patterns: patterns,
          file_list: ''
        }));

        // Count files using backend
        await countFilesFromPatterns(patterns);
      } else if (folder && selectedExtensions.length === 0) {
        console.log('Please select at least one file extension to search for.');
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    }
  };

  const handleFileListSelection = async () => {
    try {
      const files = await window.electronAPI.selectTextFiles();
      if (files && files.length > 0) {
        const filePath = files[0]; // Should be a text file (.txt or .csv)
        setConfig(prev => ({
          ...prev,
          files: [],
          file_globbing_patterns: [],
          file_list: filePath
        }));

        // Count files in the list using backend
        await countFilesFromList(filePath);
      }
    } catch (error) {
      console.error('Failed to select file list:', error);
    }
  };

  const handlePatternChange = (e) => {
    setGlobPatterns(e.target.value);
  };

  const handleFindFiles = async () => {
    const patterns = globPatterns.split('\n').filter(p => p.trim()).map(p => p.trim());
    if (patterns.length > 0) {
      setConfig(prev => ({
        ...prev,
        files: [],
        file_globbing_patterns: patterns,
        file_list: ''
      }));

      await countFilesFromPatterns(patterns);
    }
  };

  const countFilesFromPatterns = async (patterns) => {
    try {
      const response = await fetch('http://localhost:8000/files/count-glob', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          patterns,
          extensions: selectedExtensions
        })
      });

      const result = await response.json();
      if (result.status === 'success') {
        setFileCount(result.count);
      } else {
        console.error('Failed to count files:', result.error);
        setFileCount(0);
      }
    } catch (error) {
      console.error('Failed to count files:', error);
      // Fallback: show estimated count message
      setFileCount('? (Server not available)');
      console.log('Cannot count files - backend server not available. Files will be counted during inference.');
    }
  };

  const countFilesFromList = async (filePath) => {
    try {
      const response = await fetch('http://localhost:8000/files/count-list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file_path: filePath })
      });

      const result = await response.json();
      if (result.status === 'success') {
        setFileCount(result.count);
      } else {
        console.error('Failed to count files:', result.error);
        setFileCount(0);
      }
    } catch (error) {
      console.error('Failed to count files:', error);
      // Fallback: show estimated count message
      setFileCount('? (Server not available)');
      console.log('Cannot count files - backend server not available. Files will be counted during inference.');
    }
  };

  const handleOutputDirSelection = async () => {
    try {
      const dir = await window.electronAPI.selectFolder();
      if (dir) {
        setConfig(prev => ({ ...prev, output_dir: dir }));
      }
    } catch (error) {
      console.error('Failed to select output directory:', error);
    }
  };

  const handleSubmit = (createAndRun = false) => {
    // Validate file selection based on mode
    const hasFiles = config.files.length > 0 ||
      config.file_globbing_patterns.length > 0 ||
      config.file_list.trim() !== '';

    if (!hasFiles) {
      console.log('Please select audio files, folder, patterns, or file list first');
      return;
    }

    if (fileCount === 0) {
      console.log('No audio files found with current selection');
      return;
    }

    // Allow proceeding if server is not available (fileCount is string)
    if (typeof fileCount === 'string') {
      const proceed = confirm('File count could not be verified (server not available). Proceed anyway?');
      if (!proceed) return;
    }

    if (!config.output_dir) {
      console.log('Please select an output directory');
      return;
    }

    const taskConfig = { ...config };
    const finalTaskName = taskName.trim() || null; // Let TaskManager generate name if empty

    if (createAndRun) {
      onTaskCreateAndRun(taskConfig, finalTaskName);
    } else {
      onTaskCreate(taskConfig, finalTaskName);
    }
  };

  const resetForm = () => {
    setTaskName(DEFAULT_VALUES.taskName);
    setFileSelectionMode(DEFAULT_VALUES.fileSelectionMode);
    setGlobPatterns(DEFAULT_VALUES.globPatterns);
    setFileCount(DEFAULT_VALUES.fileCount);
    setSelectedExtensions([...DEFAULT_VALUES.selectedExtensions]);
    setConfig({ ...DEFAULT_VALUES.config });
  };

  const saveInferenceConfig = async () => {
    try {
      if (!window.electronAPI) {
        console.log('Electron API not available - running in browser mode');
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `inference_config_${timestamp}.json`;
      const configPath = await window.electronAPI.saveFile(defaultName);

      if (configPath) {
        const configData = {
          task_name: taskName,
          file_selection_mode: fileSelectionMode,
          selected_extensions: selectedExtensions,
          model: config.model,
          files: config.files,
          file_globbing_patterns: config.file_globbing_patterns,
          file_list: config.file_list,
          glob_patterns_text: globPatterns,
          output_dir: config.output_dir,
          inference_settings: {
            clip_overlap: config.overlap,
            batch_size: config.batch_size,
            num_workers: config.worker_count
          }
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
          console.log(`Config saved to: ${configPath.split('/').pop()}`);
        } else {
          console.error(`Failed to save config: ${result.error}`);
        }
      }
    } catch (err) {
      console.error('Failed to save config: ' + err.message);
    }
  };

  const loadInferenceConfig = async () => {
    try {
      if (!window.electronAPI) {
        console.log('Electron API not available - running in browser mode');
        return;
      }

      const configFile = await window.electronAPI.selectJSONFiles();
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
          setTaskName(configData.task_name || '');
          setFileSelectionMode(configData.file_selection_mode || 'files');
          setGlobPatterns(configData.glob_patterns_text || '');
          setSelectedExtensions(configData.selected_extensions || ['wav', 'mp3', 'flac']);

          setConfig(prev => ({
            ...prev,
            model: configData.model || 'BirdNET',
            files: configData.files || [],
            file_globbing_patterns: configData.file_globbing_patterns || [],
            file_list: configData.file_list || '',
            output_dir: configData.output_dir || '',
            overlap: configData.inference_settings?.clip_overlap || 0.0,
            batch_size: configData.inference_settings?.batch_size || 1,
            worker_count: configData.inference_settings?.num_workers || 1
          }));

          // Update file count based on loaded config
          if (configData.files && configData.files.length > 0) {
            setFileCount(configData.files.length);
          } else if (configData.file_globbing_patterns && configData.file_globbing_patterns.length > 0) {
            await countFilesFromPatterns(configData.file_globbing_patterns);
          } else if (configData.file_list) {
            await countFilesFromList(configData.file_list);
          }

          console.log(`Config loaded from: ${configFile[0].split('/').pop()}`);
        } else {
          console.error(`Failed to load config: ${result.error}`);
        }
      }
    } catch (err) {
      console.error('Failed to load config: ' + err.message);
    }
  };

  return (
    <div className="task-creation-form">
      <h3>Create Inference Task</h3>

      <div className="form-grid">
        {/* Task Name */}
        <div className="form-group full-width">
          <label>Task Name (optional)</label>
          <input
            type="text"
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            placeholder="Leave empty for auto-generated name"
          />
        </div>

        {/* File Selection Mode */}
        <div className="form-group full-width">
          <label>Audio File Selection <HelpIcon section="inference-file-selection" /></label>
          <div className="segmented-control">
            <button
              type="button"
              className={`segment ${fileSelectionMode === 'files' ? 'active' : ''}`}
              onClick={() => setFileSelectionMode('files')}
            >
              Select Files
            </button>
            <button
              type="button"
              className={`segment ${fileSelectionMode === 'folder' ? 'active' : ''}`}
              onClick={() => setFileSelectionMode('folder')}
            >
              Select Folder
            </button>
            <button
              type="button"
              className={`segment ${fileSelectionMode === 'patterns' ? 'active' : ''}`}
              onClick={() => setFileSelectionMode('patterns')}
            >
              Glob Patterns
            </button>
            <button
              type="button"
              className={`segment ${fileSelectionMode === 'filelist' ? 'active' : ''}`}
              onClick={() => setFileSelectionMode('filelist')}
            >
              File List
            </button>
          </div>

          {/* Dynamic file selection UI based on mode */}
          <div className="file-selection-content">
            {fileSelectionMode === 'files' && (
              <div className="file-selection">
                <div className="file-selection-buttons">
                  <button onClick={handleFileSelection}>
                    Select Audio Files
                  </button>
                  {config.files.length > 0 && (
                    <button
                      onClick={() => {
                        setConfig(prev => ({ ...prev, files: [] }));
                        setFileCount(0);
                      }}
                      className="button-clear"
                      title="Clear selected files"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {config.files.length > 0 && (
                  <span className="file-count">
                    {config.files.length} files selected
                  </span>
                )}
              </div>
            )}

            {fileSelectionMode === 'folder' && (
              <div className="file-selection">
                <div className="extension-selection">
                  <label>File Extensions to Include:</label>
                  <div className="extension-checkboxes">
                    {availableExtensions.map(({ ext, label, description }) => (
                      <label key={ext} className="extension-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedExtensions.includes(ext)}
                          onChange={(e) => handleExtensionChange(ext, e.target.checked)}
                        />
                        <span className="extension-label">
                          {label}
                          <span className="extension-description">({description})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="file-selection-buttons">
                  <button onClick={handleFolderSelection}>
                    Select Folder (Recursive)
                  </button>
                  {config.file_globbing_patterns.length > 0 && (
                    <button
                      onClick={() => {
                        setConfig(prev => ({ ...prev, file_globbing_patterns: [] }));
                        setFileCount(0);
                      }}
                      className="button-clear"
                      title="Clear selected folder"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {config.file_globbing_patterns.length > 0 && (
                  <span className="file-count">
                    Searching in folder - {fileCount} files found
                  </span>
                )}
              </div>
            )}

            {fileSelectionMode === 'patterns' && (
              <div className="glob-patterns">
                <div className="extension-selection">
                  <label>File Extensions to Include:</label>
                  <div className="extension-checkboxes">
                    {availableExtensions.map(({ ext, label, description }) => (
                      <label key={ext} className="extension-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedExtensions.includes(ext)}
                          onChange={(e) => handleExtensionChange(ext, e.target.checked)}
                        />
                        <span className="extension-label">
                          {label}
                          <span className="extension-description">({description})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <textarea
                  value={globPatterns}
                  onChange={handlePatternChange}
                  placeholder="Use * for wildcard in folder/file name and ** for all subfolders (recursive)&#10;/Users/name/data/project1/**/*.WAV&#10;/Users/name/data/project2/**/*.mp3&#10;/path/to/audio/*_103000.wav"
                  rows={4}
                  style={{ width: '100%', marginBottom: '8px' }}
                />
                <div className="pattern-actions">
                  <button onClick={handleFindFiles}>
                    Find Files
                  </button>
                  {config.file_globbing_patterns.length > 0 && (
                    <button
                      onClick={() => {
                        setConfig(prev => ({ ...prev, file_globbing_patterns: [] }));
                        setGlobPatterns('');
                        setFileCount(0);
                      }}
                      className="button-clear"
                      title="Clear patterns and found files"
                    >
                      Clear
                    </button>
                  )}
                  {config.file_globbing_patterns.length > 0 && (
                    <span className="file-count">
                      {fileCount} files found
                    </span>
                  )}
                </div>
              </div>
            )}

            {fileSelectionMode === 'filelist' && (
              <div className="file-selection">
                <div className="file-selection-buttons">
                  <button onClick={handleFileListSelection}>
                    Select Text File (One File Per Line)
                  </button>
                  {config.file_list && (
                    <button
                      onClick={() => {
                        setConfig(prev => ({ ...prev, file_list: '' }));
                        setFileCount(0);
                      }}
                      className="button-clear"
                      title="Clear selected file list"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {config.file_list && (
                  <div>
                    <span className="selected-path">
                      {config.file_list.split('/').pop()}
                    </span>
                    <span className="file-count">
                      {fileCount} files listed
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* File count display */}
            {fileCount > 0 && (
              <div className="total-file-count">
                Total files: <strong>{fileCount}</strong>
              </div>
            )}
          </div>
        </div>

        {/* Output Directory */}
        <div className="form-group full-width">
          <label>Output Directory <HelpIcon section="inference-output" /></label>
          <div className="file-selection">
            <div className="file-selection-buttons">
              <button onClick={handleOutputDirSelection}>
                Select Output Directory
              </button>
              {config.output_dir && (
                <button
                  onClick={() => setConfig(prev => ({ ...prev, output_dir: '' }))}
                  className="button-clear"
                  title="Clear selected output directory"
                >
                  Clear
                </button>
              )}
            </div>
            {config.output_dir && (
              <span className="selected-path">
                {config.output_dir}
              </span>
            )}
          </div>
        </div>

        {/* Model */}
        <div className="form-group">
          <label>Model <HelpIcon section="inference-models" /></label>
          <select
            value={config.model}
            onChange={(e) => setConfig(prev => ({ ...prev, model: e.target.value }))}
          >
            <option value="HawkEars">HawkEars</option>
            <option value="HawkEars_Embedding">HawkEars Embed/Transfer Learning</option>
            <option value="HawkEars_Low_Band">Ruffed & Spruce Grouse (HawkEars Low-band)</option>
            <option value="BirdNET">BirdNET Global bird species classifier</option>
            <option value="BirdSetEfficientNetB1">BirdSet Global bird species classifier EfficientNetB1</option>
            <option value="BirdSetConvNeXT">BirdSet Global bird species classifier ConvNext</option>
            {/* <option value="Perch">Perch Global bird species classifier </option> */}
            {/* haven't created TF environments yet */}

          </select>
        </div>

        {/* Overlap */}
        <div className="form-group">
          <label>Overlap <HelpIcon section="inference-overlap" /></label>
          <input
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={config.overlap}
            onChange={(e) => setConfig(prev => ({ ...prev, overlap: parseFloat(e.target.value) }))}
          />
        </div>

        {/* Batch Size */}
        <div className="form-group">
          <label>Batch Size <HelpIcon section="inference-batch-size" /></label>
          <input
            type="number"
            min="1"
            max="32"
            value={config.batch_size}
            onChange={(e) => setConfig(prev => ({ ...prev, batch_size: parseInt(e.target.value) }))}
          />
        </div>

        {/* Worker Count */}
        <div className="form-group">
          <label>Workers <HelpIcon section="inference-workers" /></label>
          <input
            type="number"
            min="1"
            max="8"
            value={config.worker_count}
            onChange={(e) => setConfig(prev => ({ ...prev, worker_count: parseInt(e.target.value) }))}
          />
        </div>


      </div>

      {/* Config Management and Task Launch Buttons */}
      <div className="config-actions" style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
        <div className="button-group" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="button-secondary"
            onClick={saveInferenceConfig}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
          >
            Save Config
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={loadInferenceConfig}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
          >
            Load Config
          </button>
          <button
            type="button"
            className="button-clear"
            onClick={resetForm}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            title="Reset form to default values"
          >
            Reset Form
          </button>

          <button
            className="button-secondary"
            onClick={() => handleSubmit(false)}
            disabled={(fileCount === 0) || !config.output_dir}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
          >
            Create Task
          </button>
          <button
            className="button-primary"
            onClick={() => handleSubmit(true)}
            disabled={(fileCount === 0) || !config.output_dir}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}

          >
            Create and Run Task
          </button>
          <HelpIcon section="inference-tasks" />

        </div>
      </div>

      {/* Action Buttons
      <div className="form-actions">
        
      </div> */}
    </div>
  );
}

export default TaskCreationForm;