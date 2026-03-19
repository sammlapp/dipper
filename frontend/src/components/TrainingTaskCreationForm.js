import React, { useState } from 'react';
import { basename } from 'pathe';
import { FormControl, Select, MenuItem, Tabs, Tab, Box } from '@mui/material';
import HelpIcon from './HelpIcon';
import { selectCSVFiles, selectFolder, saveFile, selectJSONFiles, selectModelFiles } from '../utils/fileOperations';
import { getBackendUrl } from '../utils/backendConfig';

// Default values for training form
const DEFAULT_VALUES = {
  taskName: '',
  singleClassAnnotations: [],
  config: {
    model: 'HawkEars_Embedding',
    model_source: 'bmz',
    mode: 'train_on_audio',
    class_list: '',
    // Custom model settings
    cnn_architecture: 'resnet18',
    preprocessing: {
      clip_duration: 5.0,
      sample_rate: 32000,
      spec_window_samples: 512,
      low_freq: 0,
      high_freq: 12000,
    },
    fully_annotated_files: [],
    single_class_annotations: [],
    background_samples_file: '',
    root_audio_folder: '',
    evaluation_file: '',
    save_location: '',
    batch_size: 128,
    num_workers: 4,
    freeze_feature_extractor: true,
    use_multi_layer_classifier: false,
    classifier_hidden_layer_sizes_input: '100',
    // Frozen feature extractor parameters
    n_augmentation_variants: 0,
    // Unfrozen feature extractor parameters
    feature_extractor_lr: 0.00001,
    classifier_lr: 0.001,
    // Hoplite embedding database settings
    use_existing_hoplite_db: false,
    hoplite_db_path: '',
    hoplite_db_name: 'hoplite_embeddings',
    // Python environment settings
    use_custom_python_env: false,
    custom_python_env_path: '',
    // Testing mode settings
    testing_mode_enabled: false,
    subset_size: 10
  }
};

function TrainingTaskCreationForm({ onTaskCreate, onTaskCreateAndRun }) {
  const [taskName, setTaskName] = useState(DEFAULT_VALUES.taskName);
  const [settingsTab, setSettingsTab] = useState(0);
  const [config, setConfig] = useState(DEFAULT_VALUES.config);

  // State for single class annotations - array of {file: '', class: ''}
  const [singleClassAnnotations, setSingleClassAnnotations] = useState(DEFAULT_VALUES.singleClassAnnotations);

  const handleClassListChange = (e) => {
    setConfig(prev => ({ ...prev, class_list: e.target.value }));
  };

  const getClassListArray = () => {
    // Handle case where class_list might be an array (from loaded config) or string
    if (Array.isArray(config.class_list)) {
      return config.class_list.filter(cls => cls && cls.length > 0);
    }

    // Handle string case
    if (typeof config.class_list === 'string') {
      return config.class_list
        .split(/[,\n]/)
        .map(cls => cls.trim())
        .filter(cls => cls.length > 0);
    }

    // Fallback for other types
    return [];
  };

  const populateClassListFromFile = async (filePath) => {
    try {
      // Only populate if class list is currently empty
      if (config.class_list.trim() !== '') {
        return;
      }

      console.log('Selected file:', filePath);

      const backendUrl = await getBackendUrl();
      const response = await fetch(`${backendUrl}/files/get-csv-columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file_path: filePath })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.status === 'success' && result.columns) {
          // Skip first 3 columns (file, start_time, end_time) and use the rest as classes
          const classColumns = result.columns.slice(3);
          if (classColumns.length > 0) {
            setConfig(prev => ({
              ...prev,
              class_list: classColumns.join(', ')
            }));
          }
        }
      }

    } catch (error) {
      console.error('Failed to read CSV columns:', error);
    }
  };

  const handleFullyAnnotatedSelection = async () => {
    try {
      const files = await selectCSVFiles();
      if (files && files.length > 0) {
        setConfig(prev => ({
          ...prev,
          fully_annotated_files: files
        }));

        // Auto-populate class list from first file
        await populateClassListFromFile(files[0]);
      }
    } catch (error) {
      console.error('Failed to select fully annotated files:', error);
    }
  };

  const handleSingleClassAnnotationSelection = async () => {
    try {
      const files = await selectCSVFiles();
      if (files && files.length > 0) {
        // Add new entries with empty class assignments
        const newAnnotations = files.map(file => ({ file, class: '' }));
        setSingleClassAnnotations(prev => [...prev, ...newAnnotations]);
      }
    } catch (error) {
      console.error('Failed to select single class annotation files:', error);
    }
  };

  const handleModelFileSelection = async () => {
    try {
      const files = await selectModelFiles();
      if (files && files.length > 0) {
        setConfig(prev => ({ ...prev, model: files[0] }));
      }
    } catch (error) {
      console.error('Failed to select model file:', error);
    }
  };

  const updateSingleClassAnnotationClass = (index, selectedClass) => {
    setSingleClassAnnotations(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], class: selectedClass };
      return updated;
    });

    // Update config
    setConfig(prev => ({
      ...prev,
      single_class_annotations: singleClassAnnotations.map(item => ({ ...item }))
    }));
  };

  const removeSingleClassAnnotation = (index) => {
    setSingleClassAnnotations(prev => prev.filter((_, i) => i !== index));
    setConfig(prev => ({
      ...prev,
      single_class_annotations: singleClassAnnotations.filter((_, i) => i !== index)
    }));
  };

  const handleBackgroundSamplesSelection = async () => {
    try {
      const files = await selectCSVFiles();
      if (files && files.length > 0) {
        setConfig(prev => ({
          ...prev,
          background_samples_file: files[0]
        }));
      }
    } catch (error) {
      console.error('Failed to select background samples file:', error);
    }
  };

  const handleRootAudioFolderSelection = async () => {
    try {
      const folder = await selectFolder();
      if (folder) {
        setConfig(prev => ({ ...prev, root_audio_folder: folder }));
      }
    } catch (error) {
      console.error('Failed to select root audio folder:', error);
    }
  };

  const handleEvaluationFileSelection = async () => {
    try {
      const files = await selectCSVFiles();
      if (files && files.length > 0) {
        setConfig(prev => ({
          ...prev,
          evaluation_file: files[0]
        }));
      }
    } catch (error) {
      console.error('Failed to select evaluation file:', error);
    }
  };

  const handleSaveLocationSelection = async () => {
    try {
      const location = await selectFolder();
      if (location) {
        setConfig(prev => ({ ...prev, save_location: location }));
      }
    } catch (error) {
      console.error('Failed to select save location:', error);
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

  const handleHopliteDbSelection = async () => {
    try {
      if (config.use_existing_hoplite_db) {
        // Select existing database folder
        const folder = await selectFolder();
        if (folder) {
          setConfig(prev => ({ ...prev, hoplite_db_path: folder }));
        }
      } else {
        // Select parent folder for new database
        const parentFolder = await selectFolder();
        if (parentFolder) {
          setConfig(prev => ({ ...prev, hoplite_db_path: parentFolder }));
        }
      }
    } catch (error) {
      console.error('Failed to select Hoplite database folder:', error);
    }
  };

  const handleSubmit = (createAndRun = false) => {
    // Validation
    const classList = getClassListArray();
    if (classList.length === 0) {
      alert('Please specify at least one class in the class list');
      return;
    }

    const hasAnnotations = config.fully_annotated_files.length > 0 || singleClassAnnotations.length > 0;
    if (!hasAnnotations) {
      alert('Please select at least one annotation file (fully annotated or single class)');
      return;
    }

    // Validate single class annotations have class assignments
    const incompleteAnnotations = singleClassAnnotations.filter(item => !item.class);
    if (incompleteAnnotations.length > 0) {
      alert('Please assign classes to all single class annotation files');
      return;
    }

    if (!config.save_location) {
      alert('Please select a save location for the trained model');
      return;
    }

    // Parse hidden layer sizes from string to array of integers
    const parseHiddenLayerSizes = (input) => {
      if (!input || input.trim() === '') return null;
      return input.split(',').map(size => {
        const parsed = parseInt(size.trim());
        return isNaN(parsed) ? null : parsed;
      }).filter(size => size !== null && size > 0);
    };

    // Prepare final config
    const taskConfig = {
      ...config,
      class_list: classList,
      single_class_annotations: singleClassAnnotations,
      training_settings: {
        batch_size: config.batch_size,
        num_workers: config.num_workers,
        freeze_feature_extractor: config.freeze_feature_extractor,
        classifier_hidden_layer_sizes: config.use_multi_layer_classifier ? parseHiddenLayerSizes(config.classifier_hidden_layer_sizes_input) : null,
        // Conditional parameters based on freeze setting
        ...(config.freeze_feature_extractor ? {
          n_augmentation_variants: config.n_augmentation_variants
        } : {
          feature_extractor_lr: config.feature_extractor_lr,
          classifier_lr: config.classifier_lr
        })
      }
    };

    const finalTaskName = taskName.trim() || null;

    if (createAndRun) {
      onTaskCreateAndRun(taskConfig, finalTaskName);
    } else {
      onTaskCreate(taskConfig, finalTaskName);
    }
  };

  const resetForm = () => {
    setTaskName(DEFAULT_VALUES.taskName);
    setSettingsTab(0);
    setSingleClassAnnotations([...DEFAULT_VALUES.singleClassAnnotations]);
    setConfig({ ...DEFAULT_VALUES.config });
  };

  const saveTrainingConfig = async () => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `training_config_${timestamp}.json`;
      const configPath = await saveFile(defaultName);

      if (configPath) {
        // Parse hidden layer sizes from string to array of integers
        const parseHiddenLayerSizes = (input) => {
          if (!input || input.trim() === '') return null;
          return input.split(',').map(size => {
            const parsed = parseInt(size.trim());
            return isNaN(parsed) ? null : parsed;
          }).filter(size => size !== null && size > 0);
        };

        // Construct full hoplite_db_path for new databases
        const fullHopliteDbPath = config.mode === 'train_on_embeddings' && config.hoplite_db_path
          ? (config.use_existing_hoplite_db
            ? config.hoplite_db_path
            : `${config.hoplite_db_path}/${config.hoplite_db_name}`)
          : '';

        const configData = {
          task_name: taskName,
          model: config.model_source === 'custom' ? 'Custom Architecture' : config.model,
          model_source: config.model_source,
          cnn_architecture: config.cnn_architecture,
          preprocessing: config.preprocessing,
          mode: config.mode,
          hoplite_db_path: fullHopliteDbPath,
          class_list: config.class_list,
          fully_annotated_files: config.fully_annotated_files,
          single_class_annotations: singleClassAnnotations,
          background_samples_file: config.background_samples_file,
          root_audio_folder: config.root_audio_folder,
          evaluation_file: config.evaluation_file,
          save_location: config.save_location,
          training_settings: {
            batch_size: config.batch_size,
            num_workers: config.num_workers,
            freeze_feature_extractor: config.freeze_feature_extractor,
            use_multi_layer_classifier: config.use_multi_layer_classifier,
            classifier_hidden_layer_sizes_input: config.classifier_hidden_layer_sizes_input,
            classifier_hidden_layer_sizes: config.use_multi_layer_classifier ? parseHiddenLayerSizes(config.classifier_hidden_layer_sizes_input) : null,
            // Save all parameters regardless of freeze setting so they can be restored
            n_augmentation_variants: config.n_augmentation_variants,
            feature_extractor_lr: config.feature_extractor_lr,
            classifier_lr: config.classifier_lr
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

        const backendUrl = await getBackendUrl();
        const response = await fetch(`${backendUrl}/config/save`, {
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
          console.log(`Training config saved to: ${basename(configPath)}`);
        } else {
          console.error(`Failed to save config: ${result.error}`);
        }
      }
    } catch (err) {
      console.error('Failed to save config: ' + err.message);
    }
  };

  const loadTrainingConfig = async () => {
    try {
      const configFile = await selectJSONFiles();
      if (configFile && configFile.length > 0) {
        const backendUrl = await getBackendUrl();
        const response = await fetch(`${backendUrl}/config/load`, {
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
          setSingleClassAnnotations(configData.single_class_annotations || []);

          // For loading, just store the full path - we can't determine if it was existing or new
          // so we'll default to "existing" mode if a path is present
          setConfig(prev => ({
            ...prev,
            model_source: configData.model_source || 'bmz',
            model: configData.model,
            mode: configData.mode || 'train_on_audio',
            cnn_architecture: configData.cnn_architecture || 'resnet18',
            preprocessing: configData.preprocessing || {
              clip_duration: 5.0,
              sample_rate: 22050,
              spec_window_samples: 512,
              low_freq: 0,
              high_freq: 11025
            },
            hoplite_db_path: configData.hoplite_db_path || '',
            use_existing_hoplite_db: !!(configData.hoplite_db_path), // If path exists, assume existing DB
            hoplite_db_name: 'hoplite_embeddings', // Reset to default
            class_list: Array.isArray(configData.class_list) ? configData.class_list.join(', ') : (configData.class_list || ''),
            fully_annotated_files: configData.fully_annotated_files || [],
            background_samples_file: configData.background_samples_file || '',
            root_audio_folder: configData.root_audio_folder || '',
            evaluation_file: configData.evaluation_file || '',
            save_location: configData.save_location || '',
            batch_size: configData.training_settings?.batch_size || 32,
            num_workers: configData.training_settings?.num_workers || 4,
            freeze_feature_extractor: configData.training_settings?.freeze_feature_extractor !== false,
            use_multi_layer_classifier: configData.training_settings?.use_multi_layer_classifier || false,
            classifier_hidden_layer_sizes_input: configData.training_settings?.classifier_hidden_layer_sizes_input || '100',
            // All parameters (will be used conditionally based on freeze setting)
            n_augmentation_variants: configData.training_settings?.n_augmentation_variants || 0,
            feature_extractor_lr: configData.training_settings?.feature_extractor_lr || 0.00001,
            classifier_lr: configData.training_settings?.classifier_lr || 0.001,
            // Python environment settings
            use_custom_python_env: configData.python_environment?.use_custom || false,
            custom_python_env_path: configData.python_environment?.custom_path || '',
            // Testing mode settings
            testing_mode_enabled: configData.testing_mode?.enabled || false,
            subset_size: configData.testing_mode?.subset_size || 10
          }));

          console.log(`Training config loaded from: ${basename(configFile[0])}`);
        } else {
          console.error(`Failed to load config: ${result.error}`);
        }
      }
    } catch (err) {
      console.error('Failed to load config: ' + err.message);
    }
  };

  return (
    <div className="task-creation-form training-task-form">
      <h3>Create Training Task</h3>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={settingsTab} onChange={(_event, newValue) => setSettingsTab(newValue)} variant="fullWidth">
          <Tab label="Model Config" />
          <Tab label="Data" />
          <Tab label="Class List" />
          <Tab label="Advanced" />
        </Tabs>
      </Box>

      <div className="task-settings-outline">
        {settingsTab === 0 && (
          <div className="form-grid training-tab-grid">
            <div className="form-group full-width">
              <label>Task Name (optional)</label>
              <input
                type="text"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                placeholder="Leave empty for auto-generated name"
              />
            </div>

            <div className="form-group full-width">
              <label>Training Mode <HelpIcon section="training-mode" /></label>
              <div className="segmented-control not-too-big">
                <button
                  type="button"
                  className={`segment ${config.mode === 'train_on_audio' ? 'active' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, mode: 'train_on_audio' }))}
                >
                  Train on Audio
                </button>
                <button
                  type="button"
                  className={`segment ${config.mode === 'train_on_embeddings' ? 'active' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, mode: 'train_on_embeddings' }))}
                >
                  Train on Embeddings
                </button>
              </div>
              <div className="help-text">
                Train on Audio: Standard training approach. Train on Embeddings: Uses Hoplite database for faster training (feature extractor must be frozen)
              </div>
            </div>

            <div className="form-group full-width">
              <label>Model Source <HelpIcon section="training-model-source" /></label>
              <div className="segmented-control not-too-big">
                <button
                  type="button"
                  className={`segment ${config.model_source === 'bmz' ? 'active' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, model_source: 'bmz', model: 'HawkEars_Embedding' }))}
                >
                  Bioacoustics Model Zoo
                </button>
                <button
                  type="button"
                  className={`segment ${config.model_source === 'local_file' ? 'active' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, model_source: 'local_file', model: '' }))}
                >
                  Local Model File
                </button>
                <button
                  type="button"
                  className={`segment ${config.model_source === 'custom' ? 'active' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, model_source: 'custom', model: 'Custom Architecture' }))}
                >
                  Custom Architecture
                </button>
              </div>
            </div>

            {config.model_source === 'bmz' ? (
              <div className="form-group">
                <label>Base Model <HelpIcon section="training-model-selection" /></label>
                <FormControl size="small" sx={{ mt: 0.5, minWidth: 320, maxWidth: '100%' }}>
                  <Select
                    value={config.model}
                    onChange={(e) => setConfig(prev => ({ ...prev, model: e.target.value }))}
                  >
                    <MenuItem value="HawkEars_Embedding">HawkEars Embed/Transfer Learning</MenuItem>
                    <MenuItem value="BirdNET">BirdNET Global bird species classifier</MenuItem>
                    <MenuItem value="BirdSetEfficientNetB1">BirdSet Global bird species classifier EfficientNetB1</MenuItem>
                    <MenuItem value="Perch">Perch Global bird species classifier </MenuItem>
                  </Select>
                </FormControl>
              </div>
            ) : config.model_source === 'local_file' ? (
              <div className="form-group full-width">
                <label>Local Model File <HelpIcon section="training-local-model" /></label>
                <div className="file-selection">
                  <div className="file-selection-buttons">
                    <button onClick={handleModelFileSelection}>Select Model File</button>
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
                  {config.model && <span className="selected-path">{basename(config.model)}</span>}
                </div>
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label>CNN Architecture <HelpIcon section="training-cnn-architecture" /></label>
                  <FormControl size="small" sx={{ mt: 0.5, minWidth: 220, maxWidth: '100%' }}>
                    <Select
                      value={config.cnn_architecture}
                      onChange={(e) => setConfig(prev => ({ ...prev, cnn_architecture: e.target.value }))}
                    >
                      <MenuItem value="resnet18">ResNet-18</MenuItem>
                      <MenuItem value="resnet34">ResNet-34</MenuItem>
                      <MenuItem value="resnet50">ResNet-50</MenuItem>
                      <MenuItem value="efficientnet_b0">EfficientNet-B0</MenuItem>
                      <MenuItem value="efficientnet_b1">EfficientNet-B1</MenuItem>
                    </Select>
                  </FormControl>
                </div>
                <div className="form-group">
                  <label>Clip Duration (sec) <HelpIcon section="training-clip-duration" /></label>
                  <input className="compact-input" type="number" step="0.1" value={config.preprocessing.clip_duration} onChange={(e) => setConfig(prev => ({ ...prev, preprocessing: { ...prev.preprocessing, clip_duration: parseFloat(e.target.value) } }))} />
                </div>
                <div className="form-group">
                  <label>Sample Rate (Hz) <HelpIcon section="training-sample-rate" /></label>
                  <input className="compact-input" type="number" value={config.preprocessing.sample_rate} onChange={(e) => setConfig(prev => ({ ...prev, preprocessing: { ...prev.preprocessing, sample_rate: parseInt(e.target.value) } }))} />
                </div>
                <div className="form-group">
                  <label>Spectrogram Window (samples) <HelpIcon section="training-spec-window" /></label>
                  <input className="compact-input" type="number" value={config.preprocessing.spec_window_samples} onChange={(e) => setConfig(prev => ({ ...prev, preprocessing: { ...prev.preprocessing, spec_window_samples: parseInt(e.target.value) } }))} />
                </div>
                <div className="form-group">
                  <label>Low Frequency (Hz) <HelpIcon section="training-low-freq" /></label>
                  <input className="compact-input" type="number" value={config.preprocessing.low_freq} onChange={(e) => setConfig(prev => ({ ...prev, preprocessing: { ...prev.preprocessing, low_freq: parseInt(e.target.value) } }))} />
                </div>
                <div className="form-group">
                  <label>High Frequency (Hz) <HelpIcon section="training-high-freq" /></label>
                  <input className="compact-input" type="number" value={config.preprocessing.high_freq} onChange={(e) => setConfig(prev => ({ ...prev, preprocessing: { ...prev.preprocessing, high_freq: parseInt(e.target.value) } }))} />
                </div>
              </>
            )}

            <div className="form-group full-width">
              <label>Model Save Location *</label>
              <div className="file-selection">
                <div className="file-selection-buttons">
                  <button onClick={handleSaveLocationSelection}>Select Save Directory</button>
                  {config.save_location && (
                    <button
                      onClick={() => setConfig(prev => ({ ...prev, save_location: '' }))}
                      className="button-clear"
                      title="Clear selected save location"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {config.save_location && <span className="selected-path">{config.save_location}</span>}
              </div>
            </div>
          </div>
        )}

        {settingsTab === 1 && (
          <div className="form-grid training-tab-grid">
            <div className="form-group full-width">
              <label>Fully Annotated Files (optional) <HelpIcon section="training-fully-annotated" /></label>
              <div className="file-selection">
                <div className="file-selection-buttons">
                  <button onClick={handleFullyAnnotatedSelection}>Select Fully Annotated CSV Files</button>
                  {config.fully_annotated_files.length > 0 && (
                    <button
                      onClick={() => setConfig(prev => ({ ...prev, fully_annotated_files: [] }))}
                      className="button-clear"
                      title="Clear selected files"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {config.fully_annotated_files.length > 0 && (
                  <div className="selected-files">
                    <div className="file-count">{config.fully_annotated_files.length} files selected</div>
                    <div className="file-list">
                      {config.fully_annotated_files.map((file, index) => (
                        <div key={index} className="file-item">{basename(file)}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="form-group full-width">
              <label>Single Class Annotations (optional) <HelpIcon section="training-single-class" /></label>
              <div className="file-selection">
                <div className="file-selection-buttons">
                  <button onClick={handleSingleClassAnnotationSelection}>Add Single Class Annotation Files</button>
                  {singleClassAnnotations.length > 0 && (
                    <button
                      onClick={() => {
                        setSingleClassAnnotations([]);
                        setConfig(prev => ({ ...prev, single_class_annotations: [] }));
                      }}
                      className="button-clear"
                      title="Clear all single class annotations"
                    >
                      Clear All
                    </button>
                  )}
                </div>
                {singleClassAnnotations.length > 0 && (
                  <div className="single-class-annotations">
                    {singleClassAnnotations.map((item, index) => (
                      <div key={index} className="annotation-item">
                        <span className="file-name">{basename(item.file)}</span>
                        <FormControl size="small" sx={{ minWidth: 150 }}>
                          <Select
                            value={item.class}
                            onChange={(e) => updateSingleClassAnnotationClass(index, e.target.value)}
                            displayEmpty
                          >
                            <MenuItem value="">Select class...</MenuItem>
                            {getClassListArray().map(cls => (
                              <MenuItem key={cls} value={cls}>{cls}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        <button onClick={() => removeSingleClassAnnotation(index)} className="remove-button">Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="form-group full-width">
              <label>Background Samples (optional)</label>
              <div className="file-selection">
                <div className="file-selection-buttons">
                  <button onClick={handleBackgroundSamplesSelection}>Select Background Samples CSV</button>
                  {config.background_samples_file && (
                    <button
                      onClick={() => setConfig(prev => ({ ...prev, background_samples_file: '' }))}
                      className="button-clear"
                      title="Clear selected background samples file"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {config.background_samples_file && <span className="selected-path">{basename(config.background_samples_file)}</span>}
              </div>
            </div>

            <div className="form-group full-width">
              <label>Root Audio Folder (optional) <HelpIcon section="training-root-folder" /></label>
              <div className="file-selection">
                <div className="file-selection-buttons">
                  <button onClick={handleRootAudioFolderSelection}>Select Root Audio Folder</button>
                  {config.root_audio_folder && (
                    <button
                      onClick={() => setConfig(prev => ({ ...prev, root_audio_folder: '' }))}
                      className="button-clear"
                      title="Clear selected root audio folder"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {config.root_audio_folder && <span className="selected-path">{config.root_audio_folder}</span>}
              </div>
            </div>

            <div className="form-group full-width">
              <label>Evaluation Task (optional)</label>
              <div className="file-selection">
                <div className="file-selection-buttons">
                  <button onClick={handleEvaluationFileSelection}>Select Evaluation CSV</button>
                  {config.evaluation_file && (
                    <button
                      onClick={() => setConfig(prev => ({ ...prev, evaluation_file: '' }))}
                      className="button-clear"
                      title="Clear selected evaluation file"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {config.evaluation_file && <span className="selected-path">{basename(config.evaluation_file)}</span>}
              </div>
            </div>
          </div>
        )}

        {settingsTab === 2 && (
          <div className="form-grid training-tab-grid">
            <div className="form-group full-width">
              <label>Class List (comma or newline separated) <HelpIcon section="training-class-list" /></label>
              <textarea
                value={config.class_list}
                onChange={handleClassListChange}
                placeholder="Species A, Species B, Species C&#10;or one per line:&#10;Species A&#10;Species B&#10;Species C&#10;&#10;Auto-populated from first fully annotated file"
                rows={10}
                style={{ width: '100%', marginBottom: '8px' }}
              />
              {getClassListArray().length > 0 && (
                <div className="class-preview">
                  <strong>Classes ({getClassListArray().length}):</strong> {getClassListArray().join(', ')}
                </div>
              )}
              <div className="help-text">
                Will be auto-populated from the first fully annotated file if left empty
              </div>
            </div>
          </div>
        )}

        {settingsTab === 3 && (
          <div className="form-grid training-tab-grid">
            {config.mode === 'train_on_embeddings' && (
              <div className="form-group full-width" style={{ marginLeft: '20px', paddingLeft: '16px', borderLeft: '2px solid var(--border)' }}>
                <label>
                  <input
                    type="checkbox"
                    checked={config.use_existing_hoplite_db}
                    onChange={(e) => setConfig(prev => ({ ...prev, use_existing_hoplite_db: e.target.checked, hoplite_db_path: '' }))}
                    style={{ marginRight: '8px' }}
                  />
                  Use Existing Hoplite Embedding Database
                </label>
                <div className="help-text">Load embeddings from an existing database or create a new one</div>

                {config.use_existing_hoplite_db ? (
                  <div className="file-selection" style={{ marginTop: '8px' }}>
                    <div className="file-selection-buttons">
                      <button onClick={handleHopliteDbSelection}>Select Existing Hoplite DB Folder</button>
                      {config.hoplite_db_path && (
                        <button
                          onClick={() => setConfig(prev => ({ ...prev, hoplite_db_path: '' }))}
                          className="button-clear"
                          title="Clear selected Hoplite database folder"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {config.hoplite_db_path && <span className="selected-path" style={{ marginTop: '4px', display: 'block' }}>{config.hoplite_db_path}</span>}
                  </div>
                ) : (
                  <div style={{ marginTop: '8px' }}>
                    <div className="form-group">
                      <label>Database Name</label>
                      <input
                        type="text"
                        value={config.hoplite_db_name}
                        onChange={(e) => setConfig(prev => ({ ...prev, hoplite_db_name: e.target.value }))}
                        placeholder="hoplite_embeddings"
                        style={{ width: '300px' }}
                      />
                    </div>
                    <div className="file-selection">
                      <div className="file-selection-buttons">
                        <button onClick={handleHopliteDbSelection}>Select Parent Folder</button>
                        {config.hoplite_db_path && (
                          <button
                            onClick={() => setConfig(prev => ({ ...prev, hoplite_db_path: '' }))}
                            className="button-clear"
                            title="Clear selected parent folder"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      {config.hoplite_db_path && (
                        <span className="selected-path" style={{ display: 'block' }}>
                          {config.hoplite_db_path}/{config.hoplite_db_name}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="form-group">
              <label>Batch Size <HelpIcon section="training-batch-size" /></label>
              <input className="compact-input" type="number" min="1" max="128" value={config.batch_size} onChange={(e) => setConfig(prev => ({ ...prev, batch_size: parseInt(e.target.value) }))} />
            </div>

            <div className="form-group">
              <label>Workers <HelpIcon section="training-workers" /></label>
              <input className="compact-input" type="number" min="1" max="16" value={config.num_workers} onChange={(e) => setConfig(prev => ({ ...prev, num_workers: parseInt(e.target.value) }))} />
            </div>

            <div className="form-group full-width">
              <label>
                <input
                  type="checkbox"
                  checked={config.freeze_feature_extractor}
                  onChange={(e) => setConfig(prev => ({ ...prev, freeze_feature_extractor: e.target.checked }))}
                />
                Freeze Feature Extractor <HelpIcon section="training-freeze" />
              </label>
              <div className="help-text">Keep pre-trained feature extractor frozen (recommended for small datasets)</div>
            </div>

            {config.freeze_feature_extractor ? (
              <div className="form-group" style={{ marginLeft: '20px' }}>
                <label>Augmentation Variants <HelpIcon section="training-augmentation-variants" /></label>
                <input className="compact-input" type="number" min="0" max="20" value={config.n_augmentation_variants} onChange={(e) => setConfig(prev => ({ ...prev, n_augmentation_variants: parseInt(e.target.value) }))} />
              </div>
            ) : (
              <div style={{ marginLeft: '20px' }}>
                <div className="form-group">
                  <label>Feature Extractor Learning Rate <HelpIcon section="training-feature-extractor-lr" /></label>
                  <input className="compact-input" type="number" min="0.000001" max="0.01" step="0.000001" value={config.feature_extractor_lr} onChange={(e) => setConfig(prev => ({ ...prev, feature_extractor_lr: parseFloat(e.target.value) }))} />
                </div>
                <div className="form-group">
                  <label>Classifier Learning Rate <HelpIcon section="training-classifier-lr" /></label>
                  <input className="compact-input" type="number" min="0.0001" max="0.1" step="0.0001" value={config.classifier_lr} onChange={(e) => setConfig(prev => ({ ...prev, classifier_lr: parseFloat(e.target.value) }))} />
                </div>
              </div>
            )}

            <div className="form-group full-width">
              <label>
                <input
                  type="checkbox"
                  checked={config.use_multi_layer_classifier}
                  onChange={(e) => setConfig(prev => ({ ...prev, use_multi_layer_classifier: e.target.checked }))}
                />
                Multi-layer Classifier <HelpIcon section="training-multi-layer" />
              </label>
              {config.use_multi_layer_classifier && (
                <div className="form-group" style={{ marginTop: '8px', marginLeft: '24px' }}>
                  <label>Hidden Layer Sizes (comma-separated)</label>
                  <input
                    type="text"
                    value={config.classifier_hidden_layer_sizes_input}
                    onChange={(e) => setConfig(prev => ({ ...prev, classifier_hidden_layer_sizes_input: e.target.value }))}
                    placeholder="100,50,25"
                    style={{ width: '200px' }}
                  />
                </div>
              )}
            </div>

            <div className="form-group full-width">
              <label>
                <input
                  type="checkbox"
                  checked={config.use_custom_python_env}
                  onChange={(e) => setConfig(prev => ({ ...prev, use_custom_python_env: e.target.checked }))}
                  style={{ marginRight: '8px' }}
                />
                Use Custom Python Environment <HelpIcon section="training-python-env" />
              </label>
              {config.use_custom_python_env && (
                <div className="file-selection" style={{ marginTop: '8px', marginLeft: '24px' }}>
                  <div className="file-selection-buttons">
                    <button onClick={handleCustomPythonEnvSelection}>Select Python Environment Folder</button>
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
                  {config.custom_python_env_path && <span className="selected-path" style={{ marginTop: '4px', display: 'block' }}>{config.custom_python_env_path}</span>}
                </div>
              )}
            </div>

            <div className="form-group full-width">
              <label>
                <input
                  type="checkbox"
                  checked={config.testing_mode_enabled}
                  onChange={(e) => setConfig(prev => ({ ...prev, testing_mode_enabled: e.target.checked }))}
                  style={{ marginRight: '8px' }}
                />
                Testing Mode <HelpIcon section="training-testing-mode" />
              </label>
              {config.testing_mode_enabled && (
                <div className="form-group" style={{ marginTop: '8px', marginLeft: '24px' }}>
                  <label>Subset Size</label>
                  <input className="compact-input" type="number" min="1" max="10000" value={config.subset_size} onChange={(e) => setConfig(prev => ({ ...prev, subset_size: parseInt(e.target.value) }))} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Config Management and Task Launch Buttons */}
      <div className="config-actions task-form-actions" style={{ marginBottom: '16px' }}>
        <div className="button-group" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="button-secondary"
            onClick={saveTrainingConfig}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
          >
            Save Config
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={loadTrainingConfig}
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
            disabled={getClassListArray().length === 0 || !config.save_location}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
          >
            Create Task
          </button>
          <button
            className="button-primary"
            onClick={() => handleSubmit(true)}
            disabled={getClassListArray().length === 0 || !config.save_location}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
          >
            Create and Run Task
          </button>
        </div>
      </div>
    </div>
  );
}

export default TrainingTaskCreationForm;