import React, { useState } from 'react';

function TrainingTaskCreationForm({ onTaskCreate, onTaskCreateAndRun }) {
  const [taskName, setTaskName] = useState('');
  const [config, setConfig] = useState({
    model: 'BirdNET',
    class_list: '',
    fully_annotated_files: [],
    single_class_annotations: [],
    background_samples_file: '',
    root_audio_folder: '',
    evaluation_file: '',
    save_location: '',
    batch_size: 32,
    num_workers: 4,
    freeze_feature_extractor: true
  });

  // State for single class annotations - array of {file: '', class: ''}
  const [singleClassAnnotations, setSingleClassAnnotations] = useState([]);

  const handleClassListChange = (e) => {
    setConfig(prev => ({ ...prev, class_list: e.target.value }));
  };

  const getClassListArray = () => {
    return config.class_list
      .split(/[,\n]/)
      .map(cls => cls.trim())
      .filter(cls => cls.length > 0);
  };

  const populateClassListFromFile = async (filePath) => {
    try {
      // Only populate if class list is currently empty
      if (config.class_list.trim() !== '') {
        return;
      }

      console.log('Selected file:', filePath);


      const response = await fetch('http://localhost:8000/files/get-csv-columns', {
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
      const files = await window.electronAPI.selectCSVFiles();
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
      const files = await window.electronAPI.selectCSVFiles();
      if (files && files.length > 0) {
        // Add new entries with empty class assignments
        const newAnnotations = files.map(file => ({ file, class: '' }));
        setSingleClassAnnotations(prev => [...prev, ...newAnnotations]);
      }
    } catch (error) {
      console.error('Failed to select single class annotation files:', error);
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
      const files = await window.electronAPI.selectCSVFiles();
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
      const folder = await window.electronAPI.selectFolder();
      if (folder) {
        setConfig(prev => ({ ...prev, root_audio_folder: folder }));
      }
    } catch (error) {
      console.error('Failed to select root audio folder:', error);
    }
  };

  const handleEvaluationFileSelection = async () => {
    try {
      const files = await window.electronAPI.selectCSVFiles();
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
      const location = await window.electronAPI.selectFolder();
      if (location) {
        setConfig(prev => ({ ...prev, save_location: location }));
      }
    } catch (error) {
      console.error('Failed to select save location:', error);
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

    // Prepare final config
    const taskConfig = {
      ...config,
      class_list: classList,
      single_class_annotations: singleClassAnnotations
    };

    const finalTaskName = taskName.trim() || null;

    if (createAndRun) {
      onTaskCreateAndRun(taskConfig, finalTaskName);
    } else {
      onTaskCreate(taskConfig, finalTaskName);
    }

    // Reset form
    setTaskName('');
    setSingleClassAnnotations([]);
    setConfig({
      model: 'BirdNET',
      class_list: '',
      fully_annotated_files: [],
      single_class_annotations: [],
      background_samples_file: '',
      root_audio_folder: '',
      evaluation_file: '',
      save_location: '',
      batch_size: 32,
      num_workers: 4,
      freeze_feature_extractor: true
    });
  };

  const saveTrainingConfig = async () => {
    try {
      if (!window.electronAPI) {
        alert('Electron API not available - running in browser mode');
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `training_config_${timestamp}.json`;
      const configPath = await window.electronAPI.saveFile(defaultName);

      if (configPath) {
        const configData = {
          task_name: taskName,
          model: config.model,
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
            freeze_feature_extractor: config.freeze_feature_extractor
          }
        };

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
          alert(`Training config saved to: ${configPath.split('/').pop()}`);
        } else {
          alert(`Failed to save config: ${result.error}`);
        }
      }
    } catch (err) {
      alert('Failed to save config: ' + err.message);
    }
  };

  const loadTrainingConfig = async () => {
    try {
      if (!window.electronAPI) {
        alert('Electron API not available - running in browser mode');
        return;
      }

      const configFile = await window.electronAPI.selectJSONFiles();
      if (configFile && configFile.length > 0) {
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
          setSingleClassAnnotations(configData.single_class_annotations || []);

          setConfig(prev => ({
            ...prev,
            model: configData.model || 'BirdNET',
            class_list: configData.class_list || '',
            fully_annotated_files: configData.fully_annotated_files || [],
            background_samples_file: configData.background_samples_file || '',
            root_audio_folder: configData.root_audio_folder || '',
            evaluation_file: configData.evaluation_file || '',
            save_location: configData.save_location || '',
            batch_size: configData.training_settings?.batch_size || 32,
            num_workers: configData.training_settings?.num_workers || 4,
            freeze_feature_extractor: configData.training_settings?.freeze_feature_extractor !== false
          }));

          alert(`Training config loaded from: ${configFile[0].split('/').pop()}`);
        } else {
          alert(`Failed to load config: ${result.error}`);
        }
      }
    } catch (err) {
      alert('Failed to load config: ' + err.message);
    }
  };

  return (
    <div className="task-creation-form">
      <h3>Create Training Task</h3>

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

        {/* Model Selection */}
        <div className="form-group">
          <label>Base Model</label>
          <select
            value={config.model}
            onChange={(e) => setConfig(prev => ({ ...prev, model: e.target.value }))}
          >
            <option value="BirdNET">BirdNET</option>
            <option value="Perch">Perch</option>
            <option value="HawkEars">HawkEars</option>
            <option value="BirdSetEfficientNetB1">BirdSetEfficientNetB1</option>

          </select>
        </div>

        {/* Fully Annotated Files */}
        <div className="form-group full-width">
          <label>Fully Annotated Files (optional)</label>
          <div className="file-selection">
            <button onClick={handleFullyAnnotatedSelection}>
              Select Fully Annotated CSV Files
            </button>
            {config.fully_annotated_files.length > 0 && (
              <div className="selected-files">
                <div className="file-count">{config.fully_annotated_files.length} files selected</div>
                <div className="file-list">
                  {config.fully_annotated_files.map((file, index) => (
                    <div key={index} className="file-item">
                      {file.split('/').pop()}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="help-text">
            CSV files with columns: file, start_time, end_time, and one column per class, or file, start_time, end_time, labels, complete
          </div>
        </div>

        {/* Single Class Annotations */}
        <div className="form-group full-width">
          <label>Single Class Annotations (optional)</label>
          <div className="file-selection">
            <button onClick={handleSingleClassAnnotationSelection}>
              Add Single Class Annotation Files
            </button>
            {singleClassAnnotations.length > 0 && (
              <div className="single-class-annotations">
                {singleClassAnnotations.map((item, index) => (
                  <div key={index} className="annotation-item">
                    <span className="file-name">{item.file.split('/').pop()}</span>
                    <select
                      value={item.class}
                      onChange={(e) => updateSingleClassAnnotationClass(index, e.target.value)}
                      className="class-selector"
                    >
                      <option value="">Select class...</option>
                      {getClassListArray().map(cls => (
                        <option key={cls} value={cls}>{cls}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeSingleClassAnnotation(index)}
                      className="remove-button"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="help-text">
            CSV files with columns: file, start_time, end_time, annotation (binary classification results)
          </div>
        </div>

        {/* Class List */}
        <div className="form-group full-width">
          <label>Class List (comma or newline separated)</label>
          <textarea
            value={config.class_list}
            onChange={handleClassListChange}
            placeholder="Species A, Species B, Species C&#10;or one per line:&#10;Species A&#10;Species B&#10;Species C&#10;&#10;Auto-populated from first fully annotated file"
            rows={4}
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

        {/* Background Samples */}
        <div className="form-group full-width">
          <label>Background Samples (optional)</label>
          <div className="file-selection">
            <button onClick={handleBackgroundSamplesSelection}>
              Select Background Samples CSV
            </button>
            {config.background_samples_file && (
              <span className="selected-path">
                {config.background_samples_file.split('/').pop()}
              </span>
            )}
          </div>
          <div className="help-text">
            CSV file with background/negative samples
          </div>
        </div>

        {/* Root Audio Folder */}
        <div className="form-group full-width">
          <label>Root Audio Folder (optional)</label>
          <div className="file-selection">
            <button onClick={handleRootAudioFolderSelection}>
              Select Root Audio Folder
            </button>
            {config.root_audio_folder && (
              <span className="selected-path">
                {config.root_audio_folder}
              </span>
            )}
          </div>
          <div className="help-text">
            Base directory for resolving relative audio file paths in annotation CSVs
          </div>
        </div>

        {/* Evaluation File */}
        <div className="form-group full-width">
          <label>Evaluation Task (optional)</label>
          <div className="file-selection">
            <button onClick={handleEvaluationFileSelection}>
              Select Evaluation CSV
            </button>
            {config.evaluation_file && (
              <span className="selected-path">
                {config.evaluation_file.split('/').pop()}
              </span>
            )}
          </div>
          <div className="help-text">
            Annotated CSV for model evaluation with same format as training data
          </div>
        </div>

        {/* Save Location */}
        <div className="form-group full-width">
          <label>Model Save Location *</label>
          <div className="file-selection">
            <button onClick={handleSaveLocationSelection}>
              Select Save Directory
            </button>
            {config.save_location && (
              <span className="selected-path">
                {config.save_location}
              </span>
            )}
          </div>
        </div>

        {/* Training Settings */}
        <div className="form-group">
          <label>Batch Size</label>
          <input
            type="number"
            min="1"
            max="128"
            value={config.batch_size}
            onChange={(e) => setConfig(prev => ({ ...prev, batch_size: parseInt(e.target.value) }))}
          />
        </div>

        <div className="form-group">
          <label>Workers</label>
          <input
            type="number"
            min="1"
            max="16"
            value={config.num_workers}
            onChange={(e) => setConfig(prev => ({ ...prev, num_workers: parseInt(e.target.value) }))}
          />
        </div>

        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={config.freeze_feature_extractor}
              onChange={(e) => setConfig(prev => ({ ...prev, freeze_feature_extractor: e.target.checked }))}
            />
            Freeze Feature Extractor
          </label>
          <div className="help-text">
            Keep pre-trained feature extractor frozen (recommended for small datasets)
          </div>
        </div>
      </div>

      {/* Config Management and Task Launch Buttons */}
      <div className="config-actions" style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
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