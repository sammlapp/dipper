import React, { useState, useEffect } from 'react';
import { basename } from 'pathe';
import Select from 'react-select';
import { Tabs, Tab, Box, Checkbox, FormControl, Select as MuiSelect, MenuItem } from '@mui/material';
import HelpIcon from './HelpIcon';
import { selectFolder, saveFile, selectJSONFiles } from '../utils/fileOperations';
import { getBackendUrl } from '../utils/backendConfig';

// Default values for extraction task creation form
const DEFAULT_VALUES = {
  taskName: '',
  config: {
    predictions_folder: '',
    class_list: [],
    stratification: {
      filepath_grouping: 'none',
      date_grouping: 'none',   // 'none' | 'by_day' | 'custom'
      date_ranges: []           // [{start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', label: ''}]
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
    extraction_mode: 'binary', // 'binary' or 'multiclass'
    use_custom_python_env: false,
    custom_python_env_path: ''
  }
};

function ExtractionTaskCreationForm({ onTaskCreate, onTaskCreateAndRun, initialPredictionsFolder }) {
  const [taskName, setTaskName] = useState(DEFAULT_VALUES.taskName);
  const [settingsTab, setSettingsTab] = useState(0);
  const [config, setConfig] = useState(DEFAULT_VALUES.config);
  const [availableClasses, setAvailableClasses] = useState([]);
  const [fileCount, setFileCount] = useState(0);
  const [isScanningFiles, setIsScanningFiles] = useState(false);

  // Pre-populate predictions folder when navigating from a completed task
  useEffect(() => {
    if (initialPredictionsFolder?.folder) {
      setConfig(prev => ({ ...prev, predictions_folder: initialPredictionsFolder.folder }));
      scanPredictionsFolder(initialPredictionsFolder.folder);
    }
    // eslint-disable-next-line
  }, [initialPredictionsFolder]);

  const handlePredictionsFolderSelection = async () => {
    try {
      const folder = await selectFolder();
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
    setIsScanningFiles(true);
    setAvailableClasses([]);
    setFileCount(0);

    try {
      const backendUrl = await getBackendUrl();
      const response = await fetch(`${backendUrl}/extraction/scan-predictions`, {
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
    } finally {
      setIsScanningFiles(false);
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

  const handleClassListChange = (selectedOptions) => {
    const classes = selectedOptions ? selectedOptions.map(opt => opt.value) : [];
    setConfig(prev => ({ ...prev, class_list: classes }));
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
    setSettingsTab(0);
    setConfig({ ...DEFAULT_VALUES.config });
    setAvailableClasses([]);
    setFileCount(0);
  };

  const saveExtractionConfig = async () => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `extraction_config_${timestamp}.json`;
      const configPath = await saveFile(defaultName);

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
          extraction_mode: config.extraction_mode,
          python_environment: {
            use_custom: config.use_custom_python_env,
            custom_path: config.custom_python_env_path
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
          console.log(`Extraction config saved to: ${basename(configPath)}`);
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

          setConfig(prev => ({
            ...prev,
            predictions_folder: configData.predictions_folder || '',
            class_list: configData.class_list || [],
            stratification: configData.stratification ? {
              filepath_grouping: configData.stratification.filepath_grouping || (configData.stratification.by_subfolder ? 'parent_folder' : 'none'),
              date_grouping: configData.stratification.date_grouping || 'none',
              date_ranges: configData.stratification.date_ranges || [],
            } : DEFAULT_VALUES.config.stratification,
            filtering: configData.filtering || DEFAULT_VALUES.config.filtering,
            extraction: configData.extraction || DEFAULT_VALUES.config.extraction,
            output_dir: configData.output_dir || '',
            export_audio_clips: configData.export_audio_clips || false,
            clip_duration: configData.clip_duration || 5.0,
            extraction_mode: configData.extraction_mode || configData.annotation_mode || 'binary',
            use_custom_python_env: configData.python_environment?.use_custom || false,
            custom_python_env_path: configData.python_environment?.custom_path || ''
          }));

          // Re-scan predictions folder if it was loaded
          if (configData.predictions_folder) {
            await scanPredictionsFolder(configData.predictions_folder);
          }

          console.log(`Extraction config loaded from: ${basename(configFile[0])}`);
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
    <div className="task-creation-form extraction-task-form">
      <h3>Create Extraction Task</h3>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={settingsTab} onChange={(_event, newValue) => setSettingsTab(newValue)} variant="fullWidth">
          <Tab label="Task Setup" />
          <Tab label="Filter & Stratify" />
          <Tab label="Advanced" />
        </Tabs>
      </Box>

      <div className="task-settings-outline">
        {settingsTab === 0 && (
          <div className="form-grid extraction-tab-grid">
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
              <label>Predictions Folder <HelpIcon section="extraction-predictions-folder" /></label>
              <div className="file-selection">
                <div className="file-selection-buttons">
                  <button onClick={handlePredictionsFolderSelection}>Select Folder with Predictions</button>
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
                    <span className="selected-path">{config.predictions_folder}</span>
                    <div className="file-count">
                      {isScanningFiles ? 'Scanning for prediction files...' : `${fileCount} prediction files found, ${availableClasses.length} classes available`}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {availableClasses.length > 0 && (
              <div className="form-group full-width">
                <label>Select Classes <HelpIcon section="extraction-class-selection" /></label>
                <Select
                  isMulti
                  options={classOptions}
                  value={selectedClassOptions}
                  onChange={handleClassListChange}
                  placeholder="Select classes to create extraction tasks for..."
                  className="multiclass-select extraction-class-select-narrow"
                  classNamePrefix="select"
                />
              </div>
            )}

            <div className="form-group full-width">
              <label>Extraction Methods <HelpIcon section="extraction-methods" /></label>
              <div className="help-text">Choose how to select clips from each stratification group</div>

              <div className="extraction-method-grid">
                <div className="extraction-method">
                  <label>
                    <Checkbox
                      size="small"
                      checked={config.extraction.random_clips.enabled}
                      onChange={(e) => setConfig(prev => ({
                        ...prev,
                        extraction: {
                          ...prev.extraction,
                          random_clips: { ...prev.extraction.random_clips, enabled: e.target.checked }
                        }
                      }))}
                      sx={{ p: 0.25, mr: 0.5 }}
                    />
                    Random N clips
                  </label>
                  {config.extraction.random_clips.enabled && (
                    <div style={{ marginLeft: '24px', marginTop: '8px' }}>
                      <label>Number of clips per group</label>
                      <input
                        className="compact-input"
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
                        style={{ marginLeft: '8px' }}
                      />
                    </div>
                  )}
                </div>

                <div className="extraction-method">
                  <label>
                    <Checkbox
                      size="small"
                      checked={config.extraction.score_bin_stratified.enabled}
                      onChange={(e) => setConfig(prev => ({
                        ...prev,
                        extraction: {
                          ...prev.extraction,
                          score_bin_stratified: { ...prev.extraction.score_bin_stratified, enabled: e.target.checked }
                        }
                      }))}
                      sx={{ p: 0.25, mr: 0.5 }}
                    />
                    Score-bin stratified
                  </label>
                  {config.extraction.score_bin_stratified.enabled && (
                    <div style={{ marginLeft: '24px', marginTop: '8px' }}>
                      <div>
                        <label>Clips per score bin</label>
                        <input
                          className="compact-input"
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
                          style={{ marginLeft: '8px' }}
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
                        <div className="help-text">Percentile ranges for score bins (after applying threshold)</div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="extraction-method">
                  <label>
                    <Checkbox
                      size="small"
                      checked={config.extraction.highest_scoring.enabled}
                      onChange={(e) => setConfig(prev => ({
                        ...prev,
                        extraction: {
                          ...prev.extraction,
                          highest_scoring: { ...prev.extraction.highest_scoring, enabled: e.target.checked }
                        }
                      }))}
                      sx={{ p: 0.25, mr: 0.5 }}
                    />
                    Highest scoring clips
                  </label>
                  {config.extraction.highest_scoring.enabled && (
                    <div style={{ marginLeft: '24px', marginTop: '8px' }}>
                      <label>Number of clips per group</label>
                      <input
                        className="compact-input"
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
                        style={{ marginLeft: '8px' }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="form-group">
              <label>Output Directory <HelpIcon section="extraction-output" /></label>
              <div className="file-selection">
                <div className="file-selection-buttons">
                  <button onClick={handleOutputDirSelection}>Select Output Directory</button>
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
                {config.output_dir && <span className="selected-path">{config.output_dir}</span>}
              </div>
            </div>

            <div className="form-group">
              <label>
                <Checkbox
                  size="small"
                  checked={config.export_audio_clips}
                  onChange={(e) => setConfig(prev => ({ ...prev, export_audio_clips: e.target.checked }))}
                  sx={{ p: 0.25, mr: 0.5 }}
                />
                Export Associated Audio Clips <HelpIcon section="extraction-audio-export" />
              </label>
              <div className="help-text">Extract audio clips for each selected prediction to output_directory/clips/</div>
              {config.export_audio_clips && (
                <div style={{ marginLeft: '24px', marginTop: '8px' }}>
                  <label>Clip Duration (seconds)</label>
                  <input
                    className="compact-input"
                    type="number"
                    min="1"
                    max="60"
                    step="0.5"
                    value={config.clip_duration}
                    onChange={(e) => setConfig(prev => ({ ...prev, clip_duration: parseFloat(e.target.value) }))}
                    style={{ marginLeft: '8px' }}
                  />
                  <div className="help-text">Total duration of extracted clips, centered on prediction interval</div>
                </div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Output Mode <HelpIcon section="extraction-output-mode" /></label>
              <div className="segmented-control extraction-output-mode-control">
                <button
                  type="button"
                  className={`segment ${config.extraction_mode === 'binary' ? 'active' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, extraction_mode: 'binary' }))}
                >
                  Binary Annotation
                </button>
                <button
                  type="button"
                  className={`segment ${config.extraction_mode === 'multiclass' ? 'active' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, extraction_mode: 'multiclass' }))}
                >
                  Multiclass Annotation
                </button>
              </div>
              <div className="help-text">
                {config.extraction_mode === 'binary'
                  ? 'Will create one CSV file per species for yes/no annotation'
                  : 'Will create one CSV file for all species with multi-label annotation'}
              </div>
            </div>
          </div>
        )}

        {settingsTab === 1 && (
          <div className="form-grid extraction-tab-grid">
            <div className="form-group full-width">
              <label>Audio Filepath Stratification <HelpIcon section="extraction-stratification" /></label>
              <div className="help-text">Group audio files by path component and select clips independently within each group</div>
              <FormControl size="small" sx={{ mt: 0.75, minWidth: 320, maxWidth: '100%' }}>
                <MuiSelect
                  value={config.stratification.filepath_grouping}
                  onChange={(e) => setConfig(prev => ({
                    ...prev,
                    stratification: { ...prev.stratification, filepath_grouping: e.target.value }
                  }))}
                >
                  <MenuItem value="none">None (all files in one group)</MenuItem>
                  <MenuItem value="parent_folder">Parent folder</MenuItem>
                  <MenuItem value="second_parent">Second parent folder</MenuItem>
                  <MenuItem value="two_parents">Two parents (grandparent_parent)</MenuItem>
                  <MenuItem value="filename_prefix">Filename before first underscore</MenuItem>
                </MuiSelect>
              </FormControl>
            </div>

            <div className="form-group full-width">
              <label>Date Stratification <HelpIcon section="extraction-stratification" /></label>
              <div className="help-text">Group clips by recording date (parsed from filename). Intersected with filepath stratification.</div>
              <FormControl size="small" sx={{ mt: 0.75, minWidth: 320, maxWidth: '100%' }}>
                <MuiSelect
                  value={config.stratification.date_grouping}
                  onChange={(e) => {
                    const val = e.target.value;
                    setConfig(prev => ({
                      ...prev,
                      stratification: {
                        ...prev.stratification,
                        date_grouping: val,
                        date_ranges: val === 'custom' ? (prev.stratification.date_ranges.length > 0 ? prev.stratification.date_ranges : [{ start: '', end: '', label: '' }]) : []
                      }
                    }));
                  }}
                >
                  <MenuItem value="none">None</MenuItem>
                  <MenuItem value="by_day">By day (one group per calendar date)</MenuItem>
                  <MenuItem value="custom">Custom date ranges</MenuItem>
                </MuiSelect>
              </FormControl>

              {config.stratification.date_grouping === 'custom' && (
                <div style={{ marginTop: '12px' }}>
                  {config.stratification.date_ranges.map((range, i) => (
                    <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                      <input
                        type="date"
                        value={range.start}
                        onChange={(e) => {
                          const ranges = config.stratification.date_ranges.map((r, j) => j === i ? { ...r, start: e.target.value } : r);
                          setConfig(prev => ({ ...prev, stratification: { ...prev.stratification, date_ranges: ranges } }));
                        }}
                      />
                      <span>–</span>
                      <input
                        type="date"
                        value={range.end}
                        onChange={(e) => {
                          const ranges = config.stratification.date_ranges.map((r, j) => j === i ? { ...r, end: e.target.value } : r);
                          setConfig(prev => ({ ...prev, stratification: { ...prev.stratification, date_ranges: ranges } }));
                        }}
                      />
                      <input
                        type="text"
                        placeholder="Label (optional)"
                        value={range.label}
                        onChange={(e) => {
                          const ranges = config.stratification.date_ranges.map((r, j) => j === i ? { ...r, label: e.target.value } : r);
                          setConfig(prev => ({ ...prev, stratification: { ...prev.stratification, date_ranges: ranges } }));
                        }}
                        style={{ width: '140px' }}
                      />
                      {range.start && range.end && (() => {
                        const ms = new Date(range.end) - new Date(range.start);
                        const days = Math.round(ms / 86400000) + 1;
                        return days >= 1
                          ? <span className="help-text" style={{ whiteSpace: 'nowrap' }}>{days} day{days !== 1 ? 's' : ''}</span>
                          : <span className="help-text" style={{ color: 'var(--error, #f44336)', whiteSpace: 'nowrap' }}>end before start</span>;
                      })()}
                      <button
                        type="button"
                        className="button-clear"
                        onClick={() => {
                          const ranges = config.stratification.date_ranges.filter((_, j) => j !== i);
                          setConfig(prev => ({ ...prev, stratification: { ...prev.stratification, date_ranges: ranges } }));
                        }}
                        title="Remove this range"
                      >✕</button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="button-secondary"
                    style={{ marginTop: '4px', fontSize: '0.8rem', padding: '4px 10px' }}
                    onClick={() => {
                      const ranges = [...config.stratification.date_ranges, { start: '', end: '', label: '' }];
                      setConfig(prev => ({ ...prev, stratification: { ...prev.stratification, date_ranges: ranges } }));
                    }}
                  >+ Add Date Range</button>
                </div>
              )}
            </div>

            <div className="form-group full-width">
              <label>Filtering <HelpIcon section="extraction-filtering" /></label>
              <div className="help-text">Apply filters to remove unwanted predictions before sampling</div>
              <div className="checkbox-group">
                <label>
                  <Checkbox
                    size="small"
                    checked={config.filtering.score_threshold_enabled}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      filtering: { ...prev.filtering, score_threshold_enabled: e.target.checked }
                    }))}
                    sx={{ p: 0.25, mr: 0.5 }}
                  />
                  Filter by score threshold
                </label>
                {config.filtering.score_threshold_enabled && (
                  <div style={{ marginLeft: '24px', marginTop: '8px' }}>
                    <label>Minimum Score</label>
                    <input
                      className="compact-input"
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={config.filtering.score_threshold}
                      onChange={(e) => setConfig(prev => ({
                        ...prev,
                        filtering: { ...prev.filtering, score_threshold: parseFloat(e.target.value) }
                      }))}
                      style={{ marginLeft: '8px' }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {settingsTab === 2 && (
          <div className="form-grid extraction-tab-grid">
            <div className="form-group full-width">
              <label>
                <Checkbox
                  size="small"
                  checked={config.use_custom_python_env}
                  onChange={(e) => setConfig(prev => ({ ...prev, use_custom_python_env: e.target.checked }))}
                  sx={{ p: 0.25, mr: 0.5 }}
                />
                Use Custom Python Environment <HelpIcon section="extraction-python-env" />
              </label>
              {config.use_custom_python_env && (
                <div style={{ marginLeft: '24px', marginTop: '8px' }}>
                  <div className="file-selection-buttons" style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <button type="button" onClick={handleCustomPythonEnvSelection} className="button-secondary">
                      Select Python Environment Folder
                    </button>
                    {config.custom_python_env_path && (
                      <button
                        type="button"
                        onClick={() => setConfig(prev => ({ ...prev, custom_python_env_path: '' }))}
                        className="button-clear"
                        title="Clear selected Python environment"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {config.custom_python_env_path && <span className="selected-path">{config.custom_python_env_path}</span>}
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