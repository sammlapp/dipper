import React, { useState } from 'react';
import { FormControl, Select, MenuItem } from '@mui/material';
import HelpIcon from './HelpIcon';
import { selectFiles, selectFolder, selectTextFiles, selectModelFiles, saveFile, selectJSONFiles } from '../utils/fileOperations';

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
    model_source: 'bmz',
    model: 'BirdSetEfficientNetB1',
    overlap: 0.0,
    batch_size: 1,
    worker_count: 1,
    output_dir: '',
    sparse_outputs_enabled: false,
    sparse_save_threshold: -3.,
    split_by_subfolder: false,
    use_custom_python_env: false,
    custom_python_env_path: '',
    testing_mode_enabled: false,
    subset_size: 10
  }
};

function TaskCreationForm({ onTaskCreate, onTaskCreateAndRun }) {
  const [taskName, setTaskName] = useState(DEFAULT_VALUES.taskName);
  const [fileSelectionMode, setFileSelectionMode] = useState(DEFAULT_VALUES.fileSelectionMode);
  const [globPatterns, setGlobPatterns] = useState(DEFAULT_VALUES.globPatterns);
  const [fileCount, setFileCount] = useState(DEFAULT_VALUES.fileCount);
  const [firstFile, setFirstFile] = useState('');

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
      const files = await selectFiles();
      if (files && files.length > 0) {
        setConfig(prev => ({
          ...prev,
          files,
          file_globbing_patterns: [],
          file_list: ''
        }));
        setFileCount(files.length);
        setFirstFile(files[0] || '');
      }
    } catch (error) {
      console.error('Failed to select files:', error);
    }
  };

  const handleFolderSelection = async () => {
    try {
      const folder = await selectFolder();
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
      const files = await selectTextFiles();
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
        setFirstFile(result.first_file || '');
      } else {
        console.error('Failed to count files:', result.error);
        setFileCount(0);
        setFirstFile('');
      }
    } catch (error) {
      console.error('Failed to count files:', error);
      // Fallback: show estimated count message
      setFileCount('? (Server not available)');
      setFirstFile('');
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
        setFirstFile(result.first_file || '');
      } else {
        console.error('Failed to count files:', result.error);
        setFileCount(0);
        setFirstFile('');
      }
    } catch (error) {
      console.error('Failed to count files:', error);
      // Fallback: show estimated count message
      setFileCount('? (Server not available)');
      setFirstFile('');
      console.log('Cannot count files - backend server not available. Files will be counted during inference.');
    }
  };

  const handleOutputDirSelection = async () => {
    try {
      const dir = await selectFolder();
      if (dir) {
        setConfig(prev => ({ ...prev, output_dir: dir }));
      }
    } catch (error) {
      console.error('Failed to select output directory:', error);
    }
  };

  const handleModelFileSelection = async () => {
    try {
      const files = await selectModelFiles();
      if (files && files.length > 0) {
        const modelFile = files[0];
        setConfig(prev => ({ ...prev, model: modelFile }));
      }
    } catch (error) {
      console.error('Failed to select model file:', error);
    }
  };

  const handleCustomPythonEnvSelection = async () => {
    try {
      const folder = await selectFolder();
      if (folder) {
        setConfig(prev => ({ ...prev, custom_python_env_path: folder }));
      }
    } catch (error) {
      console.error('Failed to select Python environment folder:', error);
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

    const taskConfig = {
      ...config,
      // Convert sparse outputs settings for TaskManager
      sparse_save_threshold: config.sparse_outputs_enabled ? config.sparse_save_threshold : null
    };
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
    setFirstFile('');
    setSelectedExtensions([...DEFAULT_VALUES.selectedExtensions]);
    setConfig({ ...DEFAULT_VALUES.config });
  };

  const saveInferenceConfig = async () => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `inference_config_${timestamp}.json`;
      const configPath = await saveFile(defaultName);

      if (configPath) {
        const configData = {
          task_name: taskName,
          file_selection_mode: fileSelectionMode,
          selected_extensions: selectedExtensions,
          model_source: config.model_source,
          model: config.model,
          files: config.files,
          file_globbing_patterns: config.file_globbing_patterns,
          file_list: config.file_list,
          glob_patterns_text: globPatterns,
          output_dir: config.output_dir,
          split_by_subfolder: config.split_by_subfolder,
          inference_settings: {
            clip_overlap: config.overlap,
            batch_size: config.batch_size,
            num_workers: config.worker_count
          },
          sparse_outputs: {
            enabled: config.sparse_outputs_enabled,
            threshold: config.sparse_save_threshold
          },
          python_environment: {
            use_custom: config.use_custom_python_env,
            custom_path: config.custom_python_env_path
          },
          testing_mode: {
            enabled: config.testing_mode_enabled,
            subset_size: config.testing_mode_enabled ? config.subset_size : null
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
      const configFile = await selectJSONFiles();
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
            model_source: configData.model_source || 'bmz',
            model: configData.model || 'BirdNET',
            files: configData.files || [],
            file_globbing_patterns: configData.file_globbing_patterns || [],
            file_list: configData.file_list || '',
            output_dir: configData.output_dir || '',
            split_by_subfolder: configData.split_by_subfolder || false,
            overlap: configData.inference_settings?.clip_overlap || 0.0,
            batch_size: configData.inference_settings?.batch_size || 1,
            worker_count: configData.inference_settings?.num_workers || 1,
            sparse_outputs_enabled: configData.sparse_outputs?.enabled || false,
            sparse_save_threshold: configData.sparse_outputs?.threshold || -3.0,
            use_custom_python_env: configData.python_environment?.use_custom || false,
            custom_python_env_path: configData.python_environment?.custom_path || '',
            testing_mode_enabled: configData.testing_mode?.enabled || false,
            subset_size: configData.testing_mode?.subset_size || 10
          }));

          // Update file count based on loaded config
          if (configData.files && configData.files.length > 0) {
            setFileCount(configData.files.length);
            setFirstFile(configData.files[0] || '');
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
                        setFirstFile('');
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
                        setFirstFile('');
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
                        setFirstFile('');
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
                        setFirstFile('');
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
                {firstFile && (
                  <div style={{ marginTop: '4px', fontSize: '0.9em', color: '#666' }}>
                    First file: {firstFile.split('/').pop()}
                  </div>
                )}
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

        {/* Model Source Selection */}
        <div className="form-group full-width">
          <label>Model Source <HelpIcon section="inference-model-source" /></label>
          <div className="segmented-control">
            <button
              type="button"
              className={`segment ${config.model_source === 'bmz' ? 'active' : ''}`}
              onClick={() => {
                setConfig(prev => ({ 
                  ...prev, 
                  model_source: 'bmz',
                  model: 'BirdSetEfficientNetB1' // Reset to default BMZ model
                }));
              }}
            >
              Bioacoustics Model Zoo
            </button>
            <button
              type="button"
              className={`segment ${config.model_source === 'local_file' ? 'active' : ''}`}
              onClick={() => {
                setConfig(prev => ({ 
                  ...prev, 
                  model_source: 'local_file',
                  model: '' // Clear model path when switching to local file
                }));
              }}
            >
              Local Model File
            </button>
          </div>
        </div>

        {/* Conditional Model Selection */}
        {config.model_source === 'bmz' ? (
          <div className="form-group">
            <label>Model <HelpIcon section="inference-models" /></label>
            <FormControl size="small" fullWidth sx={{ mt: 0.5 }}>
              <Select
                value={config.model}
                onChange={(e) => setConfig(prev => ({ ...prev, model: e.target.value }))}
              >
                <MenuItem value="HawkEars">HawkEars</MenuItem>
                <MenuItem value="HawkEars_Embedding">HawkEars Embed/Transfer Learning</MenuItem>
                <MenuItem value="HawkEars_Low_Band">Ruffed & Spruce Grouse (HawkEars Low-band)</MenuItem>
                <MenuItem value="BirdNET">BirdNET Global bird species classifier</MenuItem>
                <MenuItem value="BirdSetEfficientNetB1">BirdSet Global bird species classifier EfficientNetB1</MenuItem>
                <MenuItem value="BirdSetConvNeXT">BirdSet Global bird species classifier ConvNext</MenuItem>
                {/* <MenuItem value="Perch">Perch Global bird species classifier </MenuItem> */}
                {/* haven't created TF environments yet */}
              </Select>
            </FormControl>
          </div>
        ) : (
          <div className="form-group full-width">
            <label>Local Model File <HelpIcon section="inference-local-model" /></label>
            <div className="file-selection">
              <div className="file-selection-buttons">
                <button onClick={handleModelFileSelection}>
                  Select Model File
                </button>
                {config.model && (
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, model: '' }))}
                    className="button-clear"
                    title="Clear selected model file"
                  >
                    Clear
                  </button>
                )}
              </div>
              {config.model && (
                <span className="selected-path">
                  {config.model.split('/').pop()}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Overlap */}
        <div className="form-group">
          <label>Clip Overlap (sec) <HelpIcon section="inference-overlap" /></label>
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

        {/* Sparse Outputs */}
        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={config.sparse_outputs_enabled}
              onChange={(e) => setConfig(prev => ({ ...prev, sparse_outputs_enabled: e.target.checked }))}
              style={{ marginRight: '8px' }}
            />
            Save sparse outputs <HelpIcon section="inference-sparse-outputs" />
          </label>
          <small style={{ display: 'block', marginTop: '4px', color: '#6b7280' }}>
            Only save scores above threshold, output as .pkl file instead of .csv
          </small>
        </div>

        {config.sparse_outputs_enabled && (
          <div className="form-group" style={{ marginLeft: '20px' }}>
            <label>Score Threshold <HelpIcon section="inference-sparse-threshold" /></label>
            <input
              type="number"
              min="-10"
              max="5"
              step="0.1"
              value={config.sparse_save_threshold}
              onChange={(e) => setConfig(prev => ({ ...prev, sparse_save_threshold: parseFloat(e.target.value) }))}
            />
            <small style={{ display: 'block', marginTop: '4px', color: '#6b7280' }}>
              Logit scores below this threshold will be discarded (default: -3.0)
            </small>
          </div>
        )}
        {/* Subfolder Splitting */}
        <div className="form-group full-width">
          <label>
            <input
              type="checkbox"
              checked={config.split_by_subfolder}
              onChange={(e) => setConfig(prev => ({ ...prev, split_by_subfolder: e.target.checked }))}
              style={{ marginRight: '8px' }}
            />
            Separate inference by subfolders
          </label>
          <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '4px' }}>
            Create separate output files for each subfolder containing audio files
          </div>
        </div>

        {/* Python Environment */}
        <div className="form-group full-width">
          <label>
            <input
              type="checkbox"
              checked={config.use_custom_python_env}
              onChange={(e) => setConfig(prev => ({ ...prev, use_custom_python_env: e.target.checked }))}
              style={{ marginRight: '8px' }}
            />
            Use Custom Python Environment <HelpIcon section="inference-python-env" />
          </label>
          <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '4px' }}>
            Use a custom Python environment instead of the default dipper_pytorch_env
          </div>
          {config.use_custom_python_env && (
            <div className="file-selection" style={{ marginTop: '8px', marginLeft: '24px' }}>
              <div className="file-selection-buttons">
                <button onClick={handleCustomPythonEnvSelection}>
                  Select Python Environment Folder
                </button>
                {config.custom_python_env_path && (
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, custom_python_env_path: '' }))}
                    className="button-clear"
                    title="Clear selected Python environment"
                  >
                    Clear
                  </button>
                )}
              </div>
              {config.custom_python_env_path && (
                <span className="selected-path" style={{ marginTop: '4px', display: 'block' }}>
                  {config.custom_python_env_path}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Testing Mode */}
        <div className="form-group full-width">
          <label>
            <input
              type="checkbox"
              checked={config.testing_mode_enabled}
              onChange={(e) => setConfig(prev => ({ ...prev, testing_mode_enabled: e.target.checked }))}
              style={{ marginRight: '8px' }}
            />
            Testing Mode <HelpIcon section="inference-testing-mode" />
          </label>
          <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '4px' }}>
            Run inference on a small subset of files for quick testing
          </div>
          {config.testing_mode_enabled && (
            <div className="form-group" style={{ marginTop: '8px', marginLeft: '24px' }}>
              <label>Subset Size</label>
              <input
                type="number"
                min="1"
                max="1000"
                value={config.subset_size}
                onChange={(e) => setConfig(prev => ({ ...prev, subset_size: parseInt(e.target.value) }))}
                style={{ width: '100px' }}
              />
              <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '4px' }}>
                Number of files to process (default: 10)
              </div>
            </div>
          )}
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