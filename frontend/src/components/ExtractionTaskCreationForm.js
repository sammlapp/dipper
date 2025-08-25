import React, { useState } from 'react';
import Select from 'react-select';
import HelpIcon from './HelpIcon';

// Default values for extraction task creation form
const DEFAULT_VALUES = {
  taskName: '',
  config: {
    predictions_folder: '',
    class_list: [],
    stratification: {
      by_subfolder: false
    },
    filtering: {
      score_threshold_enabled: false,
      score_threshold: 0.5
    },
    extraction: {
      random_clips: { enabled: false, count: 10 },
      score_bin_stratified: {
        enabled: false,
        count_per_bin: 5,
        percentile_bins: '[[0,75],[75,90],[90,95],[95,100]]'
      },
      highest_scoring: { enabled: false, count: 10 }
    },
    output_dir: '',
    export_audio_clips: false,
    clip_duration: 5.0,
    annotation_mode: 'binary' // 'binary' or 'multiclass'
  }
};

function ExtractionTaskCreationForm({ onTaskCreate, onTaskCreateAndRun }) {
  const [taskName, setTaskName] = useState(DEFAULT_VALUES.taskName);
  const [config, setConfig] = useState(DEFAULT_VALUES.config);
  const [availableClasses, setAvailableClasses] = useState([]);
  const [fileCount, setFileCount] = useState(0);

  const handlePredictionsFolderSelection = async () => {
    try {
      const folder = await window.electronAPI.selectFolder();
      if (folder) {
        setConfig(prev => ({ ...prev, predictions_folder: folder }));

        // Scan for CSV/PKL files and get available classes
        await scanPredictionsFolder(folder);
      }
    } catch (error) {
      console.error('Failed to select predictions folder:', error);
    }
  };

  const scanPredictionsFolder = async (folderPath) => {
    try {
      const response = await fetch('http://localhost:8000/extraction/scan-predictions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ folder_path: folderPath })
      });

      const result = await response.json();
      if (result.status === 'success') {
        setAvailableClasses(result.available_classes || []);
        setFileCount(result.file_count || 0);
      } else {
        console.error('Failed to scan predictions folder:', result.error);
        setAvailableClasses([]);
        setFileCount(0);
      }
    } catch (error) {
      console.error('Failed to scan predictions folder:', error);
      setAvailableClasses([]);
      setFileCount(0);
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

  const handleClassListChange = (selectedOptions) => {
    const classes = selectedOptions ? selectedOptions.map(opt => opt.value) : [];
    setConfig(prev => ({ ...prev, class_list: classes }));
  };

  const validatePercentileBins = (binsText) => {
    try {
      const bins = JSON.parse(binsText);
      if (!Array.isArray(bins)) return false;

      for (const bin of bins) {
        if (!Array.isArray(bin) || bin.length !== 2) return false;
        if (typeof bin[0] !== 'number' || typeof bin[1] !== 'number') return false;
        if (bin[0] >= bin[1] || bin[0] < 0 || bin[1] > 100) return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = (createAndRun = false) => {
    // Validation
    if (!config.predictions_folder) {
      alert('Please select a predictions folder');
      return;
    }

    if (config.class_list.length === 0) {
      alert('Please select at least one class');
      return;
    }

    if (!config.output_dir) {
      alert('Please select an output directory');
      return;
    }

    // Check that at least one extraction method is enabled
    const extractionEnabled = config.extraction.random_clips.enabled ||
      config.extraction.score_bin_stratified.enabled ||
      config.extraction.highest_scoring.enabled;

    if (!extractionEnabled) {
      alert('Please enable at least one extraction method');
      return;
    }

    // Validate percentile bins if score bin stratified is enabled
    if (config.extraction.score_bin_stratified.enabled) {
      if (!validatePercentileBins(config.extraction.score_bin_stratified.percentile_bins)) {
        alert('Invalid percentile bins format. Expected format: [[0,75],[75,90],[90,95],[95,100]]');
        return;
      }
    }

    const taskConfig = {
      ...config,
      task_type: 'extraction'
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
    setConfig({ ...DEFAULT_VALUES.config });
    setAvailableClasses([]);
    setFileCount(0);
  };

  const saveExtractionConfig = async () => {
    try {
      if (!window.electronAPI) {
        console.log('Electron API not available - running in browser mode');
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `extraction_config_${timestamp}.json`;
      const configPath = await window.electronAPI.saveFile(defaultName);

      if (configPath) {
        const configData = {
          task_name: taskName,
          predictions_folder: config.predictions_folder,
          class_list: config.class_list,
          stratification: config.stratification,
          filtering: config.filtering,
          extraction: config.extraction,
          output_dir: config.output_dir,
          export_audio_clips: config.export_audio_clips,
          clip_duration: config.clip_duration,
          extraction_mode: config.annotation_mode
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
          console.log(`Extraction config saved to: ${configPath.split('/').pop()}`);
        } else {
          console.error(`Failed to save config: ${result.error}`);
        }
      }
    } catch (err) {
      console.error('Failed to save config: ' + err.message);
    }
  };

  const loadExtractionConfig = async () => {
    try {
      if (!window.electronAPI) {
        console.log('Electron API not available - running in browser mode');
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

          setConfig(prev => ({
            ...prev,
            predictions_folder: configData.predictions_folder || '',
            class_list: configData.class_list || [],
            stratification: configData.stratification || DEFAULT_VALUES.config.stratification,
            filtering: configData.filtering || DEFAULT_VALUES.config.filtering,
            extraction: configData.extraction || DEFAULT_VALUES.config.extraction,
            output_dir: configData.output_dir || '',
            export_audio_clips: configData.export_audio_clips || false,
            clip_duration: configData.clip_duration || 5.0,
            annotation_mode: configData.extraction_mode || configData.annotation_mode || 'binary'
          }));

          // Re-scan predictions folder if it was loaded
          if (configData.predictions_folder) {
            await scanPredictionsFolder(configData.predictions_folder);
          }

          console.log(`Extraction config loaded from: ${configFile[0].split('/').pop()}`);
        } else {
          console.error(`Failed to load config: ${result.error}`);
        }
      }
    } catch (err) {
      console.error('Failed to load config: ' + err.message);
    }
  };

  // Options for react-select
  const classOptions = availableClasses.map(cls => ({
    value: cls,
    label: cls
  }));

  const selectedClassOptions = config.class_list.map(cls => ({
    value: cls,
    label: cls
  }));

  return (
    <div className="task-creation-form">
      <h3>Create Extraction Task</h3>

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

        {/* Predictions Folder */}
        <div className="form-group full-width">
          <label>Predictions Folder <HelpIcon section="extraction-predictions-folder" /></label>
          <div className="file-selection">
            <div className="file-selection-buttons">
              <button onClick={handlePredictionsFolderSelection}>
                Select Folder with Predictions
              </button>
              {config.predictions_folder && (
                <button
                  onClick={() => {
                    setConfig(prev => ({ ...prev, predictions_folder: '', class_list: [] }));
                    setAvailableClasses([]);
                    setFileCount(0);
                  }}
                  className="button-clear"
                  title="Clear selected folder"
                >
                  Clear
                </button>
              )}
            </div>
            {config.predictions_folder && (
              <div>
                <span className="selected-path">
                  {config.predictions_folder}
                </span>
                <div className="file-count">
                  {fileCount} prediction files found, {availableClasses.length} classes available
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Class Selection */}
        {availableClasses.length > 0 && (
          <div className="form-group full-width">
            <label>Select Classes <HelpIcon section="extraction-class-selection" /></label>
            <Select
              isMulti
              options={classOptions}
              value={selectedClassOptions}
              onChange={handleClassListChange}
              placeholder="Select classes to create extraction tasks for..."
              className="multiclass-select"
              classNamePrefix="select"
            />
          </div>
        )}

        {/* Stratification */}
        <div className="form-group full-width">
          <label>Stratification <HelpIcon section="extraction-stratification" /></label>
          <div className="help-text">
            Choose how to stratify clips across different groups for balanced sampling
          </div>
          <div className="checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={config.stratification.by_subfolder}
                onChange={(e) => setConfig(prev => ({
                  ...prev,
                  stratification: { ...prev.stratification, by_subfolder: e.target.checked }
                }))}
              />
              Stratify by subfolder
            </label>
          </div>
        </div>

        {/* Filtering */}
        <div className="form-group full-width">
          <label>Filtering <HelpIcon section="extraction-filtering" /></label>
          <div className="help-text">
            Apply filters to remove unwanted predictions before sampling
          </div>
          <div className="checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={config.filtering.score_threshold_enabled}
                onChange={(e) => setConfig(prev => ({
                  ...prev,
                  filtering: { ...prev.filtering, score_threshold_enabled: e.target.checked }
                }))}
              />
              Filter by score threshold
            </label>
            {config.filtering.score_threshold_enabled && (
              <div style={{ marginLeft: '24px', marginTop: '8px' }}>
                <label>Minimum Score</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  value={config.filtering.score_threshold}
                  onChange={(e) => setConfig(prev => ({
                    ...prev,
                    filtering: { ...prev.filtering, score_threshold: parseFloat(e.target.value) }
                  }))}
                  style={{ width: '100px', marginLeft: '8px' }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Extraction Methods */}
        <div className="form-group full-width">
          <label>Extraction Methods <HelpIcon section="extraction-methods" /></label>
          <div className="help-text">
            Choose how to select clips from each stratification group
          </div>

          {/* Random Clips */}
          <div className="extraction-method">
            <label>
              <input
                type="checkbox"
                checked={config.extraction.random_clips.enabled}
                onChange={(e) => setConfig(prev => ({
                  ...prev,
                  extraction: {
                    ...prev.extraction,
                    random_clips: { ...prev.extraction.random_clips, enabled: e.target.checked }
                  }
                }))}
              />
              Random N clips
            </label>
            {config.extraction.random_clips.enabled && (
              <div style={{ marginLeft: '24px', marginTop: '8px' }}>
                <label>Number of clips per group</label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={config.extraction.random_clips.count}
                  onChange={(e) => setConfig(prev => ({
                    ...prev,
                    extraction: {
                      ...prev.extraction,
                      random_clips: { ...prev.extraction.random_clips, count: parseInt(e.target.value) }
                    }
                  }))}
                  style={{ width: '100px', marginLeft: '8px' }}
                />
              </div>
            )}
          </div>

          {/* Score Bin Stratified */}
          <div className="extraction-method">
            <label>
              <input
                type="checkbox"
                checked={config.extraction.score_bin_stratified.enabled}
                onChange={(e) => setConfig(prev => ({
                  ...prev,
                  extraction: {
                    ...prev.extraction,
                    score_bin_stratified: { ...prev.extraction.score_bin_stratified, enabled: e.target.checked }
                  }
                }))}
              />
              Score-bin stratified
            </label>
            {config.extraction.score_bin_stratified.enabled && (
              <div style={{ marginLeft: '24px', marginTop: '8px' }}>
                <div>
                  <label>Clips per score bin</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={config.extraction.score_bin_stratified.count_per_bin}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      extraction: {
                        ...prev.extraction,
                        score_bin_stratified: { ...prev.extraction.score_bin_stratified, count_per_bin: parseInt(e.target.value) }
                      }
                    }))}
                    style={{ width: '100px', marginLeft: '8px' }}
                  />
                </div>
                <div style={{ marginTop: '8px' }}>
                  <label>Score percentile bins</label>
                  <input
                    type="text"
                    value={config.extraction.score_bin_stratified.percentile_bins}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      extraction: {
                        ...prev.extraction,
                        score_bin_stratified: { ...prev.extraction.score_bin_stratified, percentile_bins: e.target.value }
                      }
                    }))}
                    placeholder="[[0,75],[75,90],[90,95],[95,100]]"
                    style={{ width: '300px', marginLeft: '8px' }}
                  />
                  <div className="help-text">
                    Percentile ranges for score bins (after applying threshold)
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Highest Scoring */}
          <div className="extraction-method">
            <label>
              <input
                type="checkbox"
                checked={config.extraction.highest_scoring.enabled}
                onChange={(e) => setConfig(prev => ({
                  ...prev,
                  extraction: {
                    ...prev.extraction,
                    highest_scoring: { ...prev.extraction.highest_scoring, enabled: e.target.checked }
                  }
                }))}
              />
              Highest scoring clips
            </label>
            {config.extraction.highest_scoring.enabled && (
              <div style={{ marginLeft: '24px', marginTop: '8px' }}>
                <label>Number of clips per group</label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={config.extraction.highest_scoring.count}
                  onChange={(e) => setConfig(prev => ({
                    ...prev,
                    extraction: {
                      ...prev.extraction,
                      highest_scoring: { ...prev.extraction.highest_scoring, count: parseInt(e.target.value) }
                    }
                  }))}
                  style={{ width: '100px', marginLeft: '8px' }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Output Directory */}
        <div className="form-group full-width">
          <label>Output Directory <HelpIcon section="extraction-output" /></label>
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

        {/* Audio Clip Export */}
        <div className="form-group full-width">
          <label>
            <input
              type="checkbox"
              checked={config.export_audio_clips}
              onChange={(e) => setConfig(prev => ({ ...prev, export_audio_clips: e.target.checked }))}
              style={{ marginRight: '8px' }}
            />
            Export Associated Audio Clips <HelpIcon section="extraction-audio-export" />
          </label>
          <div className="help-text">
            Extract audio clips for each selected prediction to output_directory/clips/
          </div>
          {config.export_audio_clips && (
            <div style={{ marginLeft: '24px', marginTop: '8px' }}>
              <label>Clip Duration (seconds)</label>
              <input
                type="number"
                min="1"
                max="60"
                step="0.5"
                value={config.clip_duration}
                onChange={(e) => setConfig(prev => ({ ...prev, clip_duration: parseFloat(e.target.value) }))}
                style={{ width: '100px', marginLeft: '8px' }}
              />
              <div className="help-text">
                Total duration of extracted clips, centered on prediction interval
              </div>
            </div>
          )}
        </div>

        {/* Annotation Mode */}
        <div className="form-group full-width">
          <label>Output Mode <HelpIcon section="extraction-output-mode" /></label>
          <div className="segmented-control">
            <button
              type="button"
              className={`segment ${config.annotation_mode === 'binary' ? 'active' : ''}`}
              onClick={() => setConfig(prev => ({ ...prev, annotation_mode: 'binary' }))}
            >
              Binary Annotation
            </button>
            <button
              type="button"
              className={`segment ${config.annotation_mode === 'multiclass' ? 'active' : ''}`}
              onClick={() => setConfig(prev => ({ ...prev, annotation_mode: 'multiclass' }))}
            >
              Multiclass Annotation
            </button>
          </div>
          <div className="help-text">
            {config.annotation_mode === 'binary' ?
              'Creates one CSV file per species for yes/no annotation' :
              'Creates one CSV file for all species with multi-label annotation'
            }
          </div>
        </div>

      </div>

      {/* Config Management and Task Launch Buttons */}
      <div className="config-actions" style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
        <div className="button-group" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="button-secondary"
            onClick={saveExtractionConfig}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
          >
            Save Config
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={loadExtractionConfig}
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
            disabled={!config.predictions_folder || config.class_list.length === 0 || !config.output_dir}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
          >
            Create Task
          </button>
          <button
            className="button-primary"
            onClick={() => handleSubmit(true)}
            disabled={!config.predictions_folder || config.class_list.length === 0 || !config.output_dir}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
          >
            Create and Run Task
          </button>
          <HelpIcon section="extraction-tasks" />
        </div>
      </div>
    </div>
  );
}

export default ExtractionTaskCreationForm;