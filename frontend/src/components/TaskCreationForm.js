import React, { useState, useCallback, useEffect, useRef } from 'react';
import { basename } from 'pathe';
import { FormControl, Select, MenuItem, Tabs, Tab, Box, Checkbox, Menu } from '@mui/material';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import HelpIcon from './HelpIcon';
import { selectFiles, selectFolder, selectTextFiles, selectModelFiles, saveFile, selectJSONFiles, writeFile, readFile } from '../utils/fileOperations';
import { getBackendUrl } from '../utils/backendConfig';

// Fix leaflet default marker icon (broken by webpack)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});


function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

// Which field in a species object is the class label string for each classifier (mirrors geomodel.MODEL_CLASS_COL)
const MODEL_CLASS_COL = {
  'BirdNET_V3.0.3': 'scientific_name',
  'Perch2': 'scientific_name',
  'Perch2LiteRT': 'scientific_name',
  'Perch2ONNX': 'scientific_name',
  'Perch': 'ebird_code',
  'BirdSetConvNeXT': 'ebird_code',
  'BirdSetEfficientNetB1': 'ebird_code',
  'HawkEars_v010': 'common_name',
  'HawkEars': 'common_name',
};

// Flatten a selected_species object array to a string[] of class labels for the given model
function flattenSpeciesForConfig(selected_species, model) {
  const col = MODEL_CLASS_COL[model] || 'scientific_name';
  return selected_species.map(s => s[col] || s.scientific_name);
}

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
    model: 'Perch2',
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
    subset_size: 10,
    species_filter: {
      enabled: false,
      selected_species: [], // [{ebird_code, scientific_name, common_name, probability}]
    },
    ribbit_settings: {
      class_name: '',
      signal_band: [1000, 2000],
      noise_bands: [[0, 200]],
      pulse_rate_range: [5, 20],
      clip_duration: 2.0,
      clip_overlap: 0.0,
    },
    cwt_settings: {
      class_name: '',
      sample_rate: 400,
      window_len: 60,
      center_frequency: 50,
      wavelet: 'morl',
      peak_threshold: 0.2,
      peak_separation: 0.0375,
      dt_range: [0.05, 0.8],
      dy_range: [-0.2, 0.0],
      d2y_range: [-0.05, 0.15],
      max_skip: 3,
      duration_range: [1, 15],
      points_range: [9, 100],
    },
  }
};

const RUGR_CWT_DEFAULTS = {
  class_name: 'Ruffed Grouse',
  sample_rate: 400,
  window_len: 60,
  center_frequency: 50,
  wavelet: 'morl',
  peak_threshold: 0.2,
  peak_separation: 0.0375,
  dt_range: [0.05, 0.8],
  dy_range: [-0.2, 0.0],
  d2y_range: [-0.05, 0.15],
  max_skip: 3,
  duration_range: [1, 15],
  points_range: [9, 100],
};

function CreateInferenceTaskForm({ onTaskCreate, onTaskCreateAndRun, mlEnvReady }) {
  const [taskName, setTaskName] = useState(DEFAULT_VALUES.taskName);
  const [settingsTab, setSettingsTab] = useState(0);
  const [fileSelectionMode, setFileSelectionMode] = useState(DEFAULT_VALUES.fileSelectionMode);
  const [globPatterns, setGlobPatterns] = useState(DEFAULT_VALUES.globPatterns);
  const [fileCount, setFileCount] = useState(DEFAULT_VALUES.fileCount);
  const [firstFile, setFirstFile] = useState('');
  const [isCountingFiles, setIsCountingFiles] = useState(false);

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

  // Species filter UI state (not persisted to config)
  const [geoLat, setGeoLat] = useState('');
  const [geoLon, setGeoLon] = useState('');
  const [geoWeek, setGeoWeek] = useState(1);
  const [geoMinProb, setGeoMinProb] = useState(0.05);
  const [speciesLoading, setSpeciesLoading] = useState(false);
  const [speciesError, setSpeciesError] = useState('');
  const [classifierLabels, setClassifierLabels] = useState([]);
  const [geoFilteredClasses, setGeoFilteredClasses] = useState(null); // null = show all; array = geomodel result
  const [availableSearch, setAvailableSearch] = useState('');
  const [selectedSearch, setSelectedSearch] = useState('');
  const [addSearchInput, setAddSearchInput] = useState('');
  const addSearchRef = useRef(null);

  // Fetch classifier label list whenever the model changes (and species filter is supported)
  useEffect(() => {
    const classifierKey = config.model;
    setClassifierLabels([]);
    setGeoFilteredClasses(null);
    setConfig(prev => ({ ...prev, species_filter: { ...prev.species_filter, selected_species: [] } }));
    if (!classifierKey) return;
    let cancelled = false;
    getBackendUrl().then(backendUrl =>
      fetch(`${backendUrl}/geomodel/classifier_labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classifier: classifierKey }),
      })
    ).then(r => r.json()).then(result => {
      if (!cancelled && result.status === 'success') setClassifierLabels(result.labels);
    }).catch(() => { });
    return () => { cancelled = true; };
  }, [config.model]);

  const handleMapClick = useCallback((lat, lon) => {
    setGeoLat(lat.toFixed(5));
    setGeoLon(lon.toFixed(5));
  }, []);

  const handleLoadSpecies = async () => {
    const lat = parseFloat(geoLat);
    const lon = parseFloat(geoLon);
    const week = parseInt(geoWeek);
    if (isNaN(lat) || isNaN(lon) || isNaN(week)) {
      setSpeciesError('Please enter valid lat, lon, and week values.');
      return;
    }
    const classifierKey = config.model;
    if (!classifierKey) {
      setSpeciesError('Selected model does not support species filtering.');
      return;
    }
    setSpeciesLoading(true);
    setSpeciesError('');
    try {
      const backendUrl = await getBackendUrl();
      const response = await fetch(`${backendUrl}/geomodel/species_list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon, week, min_probability: geoMinProb, classifier: classifierKey }),
      });
      const result = await response.json();
      if (result.status === 'success') {
        setGeoFilteredClasses(result.species);
      } else {
        setSpeciesError(result.error || 'Failed to load species list.');
      }
    } catch (err) {
      setSpeciesError('Error contacting backend: ' + err.message);
    } finally {
      setSpeciesLoading(false);
    }
  };

  // The canonical identity key for a species object is the model's native label field.
  const modelKeyField = MODEL_CLASS_COL[config.model] || 'scientific_name';

  const getSpeciesKey = (sp) => sp[modelKeyField] || sp.scientific_name || sp.common_name || sp.ebird_code || '';

  const handleRemoveSpecies = (key) => {
    setConfig(prev => ({
      ...prev,
      species_filter: {
        ...prev.species_filter,
        selected_species: prev.species_filter.selected_species.filter(s => getSpeciesKey(s) !== key),
      },
    }));
  };

  // sp can be a full species object (from geomodel) or a raw label string (from classifierLabels search)
  const handleAddSpecies = (spOrLabel) => {
    if (!spOrLabel) return;
    const sp = typeof spOrLabel === 'string'
      ? { ebird_code: '', scientific_name: '', common_name: '', [modelKeyField]: spOrLabel, probability: null }
      : spOrLabel;
    const key = getSpeciesKey(sp);
    if (config.species_filter.selected_species.some(s => getSpeciesKey(s) === key)) {
      setAddSearchInput('');
      return;
    }
    setConfig(prev => ({
      ...prev,
      species_filter: {
        ...prev.species_filter,
        selected_species: [sp, ...prev.species_filter.selected_species],
      },
    }));
    setAddSearchInput('');
  };

  const handleClearAllSpecies = () => {
    setConfig(prev => ({ ...prev, species_filter: { ...prev.species_filter, selected_species: [] } }));
  };

  const handleUseAllClasses = () => {
    const all = classifierLabels.map(label => ({
      ebird_code: '', scientific_name: '', common_name: '', [modelKeyField]: label, probability: null,
    }));
    setConfig(prev => ({ ...prev, species_filter: { ...prev.species_filter, selected_species: all } }));
    setGeoFilteredClasses(null);
  };

  const handleSaveSpeciesList = async () => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `species_list_${timestamp}.txt`;
      const filePath = await saveFile(defaultName);
      if (!filePath) return;
      const lines = config.species_filter.selected_species.map(s => getSpeciesKey(s)).join('\n');
      await writeFile(filePath, lines);
      console.log(`Species list saved to: ${basename(filePath)}`);
    } catch (err) {
      console.error('Failed to save species list: ' + err.message);
    }
  };

  const handleLoadSpeciesList = async () => {
    try {
      const files = await selectTextFiles();
      if (!files || files.length === 0) return;
      const content = await readFile(files[0]);
      const loaded = content.split('\n').map(l => l.trim()).filter(Boolean)
        .map(label => ({ ebird_code: '', scientific_name: '', common_name: '', [modelKeyField]: label, probability: null }));
      setConfig(prev => ({ ...prev, species_filter: { ...prev.species_filter, selected_species: loaded } }));
      console.log(`Loaded ${loaded.length} species from ${basename(files[0])}`);
    } catch (err) {
      console.error('Failed to load species list: ' + err.message);
    }
  };


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
    setIsCountingFiles(true);
    setFileCount(0);
    setFirstFile('');

    try {
      const backendUrl = await getBackendUrl();
      const response = await fetch(`${backendUrl}/files/count-glob`, {
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
      console.log('Cannot count files - backend not available. Files will be counted during inference.');
    } finally {
      setIsCountingFiles(false);
    }
  };

  const countFilesFromList = async (filePath) => {
    setIsCountingFiles(true);
    setFileCount(0);
    setFirstFile('');

    try {
      const backendUrl = await getBackendUrl();
      const response = await fetch(`${backendUrl}/files/count-list`, {
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
      console.log('Cannot count files - backend not available. Files will be counted during inference.');
    } finally {
      setIsCountingFiles(false);
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
      // Add form-level state that isn't in config object
      file_selection_mode: fileSelectionMode,
      selected_extensions: selectedExtensions,
      glob_patterns_text: globPatterns,
      // Convert sparse outputs settings for TaskManager
      sparse_save_threshold: config.sparse_outputs_enabled ? config.sparse_save_threshold : null,
      // Signal-processing method settings (passed through as-is)
      ribbit_settings: config.ribbit_settings,
      cwt_settings: config.cwt_settings,
      // Species filter: flatten to string[] for the inference pipeline
      species_filter: {
        enabled: config.species_filter.enabled,
        selected_species: flattenSpeciesForConfig(config.species_filter.selected_species, config.model),
      },
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
    setSettingsTab(0);
    setFileSelectionMode(DEFAULT_VALUES.fileSelectionMode);
    setGlobPatterns(DEFAULT_VALUES.globPatterns);
    setFileCount(DEFAULT_VALUES.fileCount);
    setFirstFile('');
    setSelectedExtensions([...DEFAULT_VALUES.selectedExtensions]);
    setConfig({
      ...DEFAULT_VALUES.config,
      ribbit_settings: { ...DEFAULT_VALUES.config.ribbit_settings, noise_bands: [[0, 200]] },
      cwt_settings: { ...DEFAULT_VALUES.config.cwt_settings },
      species_filter: { ...DEFAULT_VALUES.config.species_filter },
    });
    setGeoLat('');
    setGeoLon('');
    setGeoWeek(1);
    setGeoMinProb(0.05);
    setSpeciesError('');
    setAddSearchInput('');
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
          },
          ribbit_settings: config.ribbit_settings,
          cwt_settings: config.cwt_settings,
          species_filter: {
            enabled: config.species_filter.enabled,
            selected_species: flattenSpeciesForConfig(config.species_filter.selected_species, config.model),
          },
        };

        // Use HTTP API to save config
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
          console.log(`Config saved to: ${basename(configPath)}`);
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
          setFileSelectionMode(configData.file_selection_mode || 'files');
          setGlobPatterns(configData.glob_patterns_text || '');
          setSelectedExtensions(configData.selected_extensions || ['wav', 'mp3', 'flac']);

          setConfig(prev => ({
            ...prev,
            model_source: configData.model_source || 'bmz',
            model: configData.model || 'Perch2',
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
            subset_size: configData.testing_mode?.subset_size || 10,
            ribbit_settings: configData.ribbit_settings || DEFAULT_VALUES.config.ribbit_settings,
            cwt_settings: configData.cwt_settings || DEFAULT_VALUES.config.cwt_settings,
            species_filter: configData.species_filter
              ? { enabled: configData.species_filter.enabled || false, selected_species: configData.species_filter.selected_species || [] }
              : { ...DEFAULT_VALUES.config.species_filter },
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

          console.log(`Config loaded from: ${basename(configFile[0])}`);
        } else {
          console.error(`Failed to load config: ${result.error}`);
        }
      }
    } catch (err) {
      console.error('Failed to load config: ' + err.message);
    }
  };

  return (
    <div className="task-creation-form inference-task-form">
      <h3>Create Inference Task</h3>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs
          value={settingsTab}
          onChange={(_event, newValue) => setSettingsTab(newValue)}
          variant="fullWidth"
        >
          <Tab label="Audio Files" />
          <Tab label="Model Config" />
          <Tab label="Advanced Settings" />
        </Tabs>
      </Box>

      <div className="task-settings-outline">
        {settingsTab === 0 && (
          <div className="form-grid inference-tab-grid">
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
              <div className="segmented-control not-too-big">
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
                            <Checkbox
                              size="small"
                              checked={selectedExtensions.includes(ext)}
                              onChange={(e) => handleExtensionChange(ext, e.target.checked)}
                              sx={{ p: 0.25, mr: 0.5 }}
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
                        {isCountingFiles ? 'Searching for files...' : `Searching in folder - ${fileCount} files found`}
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
                            <Checkbox
                              size="small"
                              checked={selectedExtensions.includes(ext)}
                              onChange={(e) => handleExtensionChange(ext, e.target.checked)}
                              sx={{ p: 0.25, mr: 0.5 }}
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
                          {isCountingFiles ? 'Searching for files...' : `${fileCount} files found`}
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
                          {basename(config.file_list)}
                        </span>
                        <span className="file-count">
                          {isCountingFiles ? 'Counting files...' : `${fileCount} files listed`}
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
                      <div style={{ marginTop: '4px', fontSize: '0.9em', color: 'var(--medium-gray)' }}>
                        First file: {basename(firstFile)}
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
          </div>
        )}

        {settingsTab === 1 && (
          <div className="form-grid inference-tab-grid">
            {/* Model Source Selection */}
            <div className="form-group full-width">
              <label>Model Source <HelpIcon section="inference-model-source" /></label>
              <div className="segmented-control not-too-big">
                <button
                  type="button"
                  className={`segment ${config.model_source === 'bmz' ? 'active' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, model_source: 'bmz', model: 'Perch2' }))}
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
                  className={`segment ${config.model_source === 'ribbit' ? 'active' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, model_source: 'ribbit', model: 'ribbit' }))}
                >
                  RIBBIT
                </button>
                <button
                  type="button"
                  className={`segment ${config.model_source === 'cwt_detector' ? 'active' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, model_source: 'cwt_detector', model: 'cwt_detector' }))}
                >
                  CWT Detector
                </button>
              </div>
            </div>

            {/* BMZ model picker */}
            {config.model_source === 'bmz' && (
              <div className="form-group">
                <label>Model <HelpIcon section="inference-models" /></label>
                <FormControl size="small" sx={{ mt: 0.5, minWidth: 320, maxWidth: '100%' }}>
                  <Select
                    value={config.model}
                    onChange={(e) => setConfig(prev => ({ ...prev, model: e.target.value }))}
                  >
                    <MenuItem value="Perch2">Perch V2 Global Classifier</MenuItem>
                    <MenuItem value="Perch2LiteRT">Perch V2 (LiteRT)</MenuItem>
                    <MenuItem value="Perch2ONNX">Perch V2 (ONNX)</MenuItem>
                    <MenuItem value="HawkEars">HawkEars N. American Bird Classifier (V1.0.8)</MenuItem>
                    <MenuItem value="HawkEars_Embedding">HawkEars Embed/Transfer Learning</MenuItem>
                    <MenuItem value="HawkEars_Low_Band">Ruffed &amp; Spruce Grouse (HawkEars Low-band)</MenuItem>
                    <MenuItem value="Perch">Perch (V1) Global Classifier</MenuItem>
                    <MenuItem value="BirdNET">BirdNET Global bird classifier (V2.4)</MenuItem>
                    <MenuItem value="BirdSetEfficientNetB1">BirdSet-EfficientNetB1 Global bird classifier </MenuItem>
                    <MenuItem value="BirdSetConvNeXT">BirdSet-ConvNeXT Global bird classifier </MenuItem>
                  </Select>
                </FormControl>
              </div>
            )}

            {/* Species filter panel — shown for bmz only */}
            {config.model_source === 'bmz' && (
              <div className="form-group full-width">
                <label>
                  <Checkbox
                    size="small"
                    checked={config.species_filter.enabled}
                    onChange={(e) => setConfig(prev => ({ ...prev, species_filter: { ...prev.species_filter, enabled: e.target.checked } }))}
                    sx={{ p: 0.25, mr: 0.5 }}
                  />
                  Filter output to a species list
                </label>
                <small style={{ display: 'block', marginTop: 2, color: 'var(--medium-gray)' }}>
                  Only retain scores for selected species in the output CSV
                </small>
                <small style={{ display: 'block', marginTop: 2, color: 'var(--medium-gray)' }}>
                  powered by BirdNET GeoModel
                </small>



                {config.species_filter.enabled && (
                  <div style={{ marginTop: 12, marginLeft: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>

                    {/* Geo location picker */}
                    {config.model_source === 'bmz' && config.model ? (
                      <>
                        <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                          Load species list by location &amp; week
                        </div>

                        {/* Map */}
                        <div style={{ height: 220, maxWidth: '700px', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                          <MapContainer
                            center={[geoLat || 40, geoLon || -95]}
                            zoom={3}
                            style={{ height: '100%', width: '100%' }}
                          >
                            <TileLayer
                              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                            />
                            <MapClickHandler onMapClick={handleMapClick} />
                            {geoLat !== '' && geoLon !== '' && (
                              <Marker position={[parseFloat(geoLat), parseFloat(geoLon)]} />
                            )}
                          </MapContainer>

                        </div>

                        {/* Lat/lon/week/prob inputs */}
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label style={{ fontSize: '0.8rem' }}>Latitude</label>
                            <input
                              className="compact-input"
                              type="number"
                              min="-90" max="90" step="0.0001"
                              value={geoLat}
                              onChange={(e) => setGeoLat(e.target.value)}
                              placeholder="e.g. 40.71"
                              style={{ width: 100 }}
                            />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label style={{ fontSize: '0.8rem' }}>Longitude</label>
                            <input
                              className="compact-input"
                              type="number"
                              min="-180" max="180" step="0.0001"
                              value={geoLon}
                              onChange={(e) => setGeoLon(e.target.value)}
                              placeholder="e.g. -74.01"
                              style={{ width: 100 }}
                            />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label style={{ fontSize: '0.8rem' }}>Week of year (1–52)</label>
                            <input
                              className="compact-input"
                              type="number"
                              min="1" max="52"
                              value={geoWeek}
                              onChange={(e) => setGeoWeek(parseInt(e.target.value))}
                              style={{ width: 60 }}
                            />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label style={{ fontSize: '0.8rem' }}>Min occurrence probability</label>
                            <input
                              className="compact-input"
                              type="number"
                              min="0" max="1" step="0.01"
                              value={geoMinProb}
                              onChange={(e) => setGeoMinProb(parseFloat(e.target.value))}
                              style={{ width: 70 }}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={handleLoadSpecies}
                            disabled={speciesLoading}
                            style={{ alignSelf: 'flex-end', marginBottom: 1 }}
                          >
                            {speciesLoading ? 'Loading…' : 'Get Species List'}
                          </button>
                        </div>

                        {speciesError && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--error-color, #c00)' }}>{speciesError}</div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: '0.8rem', color: 'var(--medium-gray)' }}>
                        Geographic species list generation is not currently supported for this model. You can still load a species list from a .txt file below.
                      </div>
                    )}

                    {/* Two-table class list UI */}
                    {(() => {
                      const selectedKeys = new Set(config.species_filter.selected_species.map(s => getSpeciesKey(s)));
                      // Available pool: geomodel result if active, otherwise all classifier labels as minimal objects
                      const availablePool = geoFilteredClasses !== null
                        ? geoFilteredClasses
                        : classifierLabels.map(label => ({ ebird_code: '', scientific_name: '', common_name: '', [modelKeyField]: label, probability: null }));
                      const searchLower = availableSearch.trim().toLowerCase();
                      const availableFiltered = availablePool.filter(sp => {
                        if (selectedKeys.has(getSpeciesKey(sp))) return false;
                        if (!searchLower) return true;
                        return ['ebird_code', 'scientific_name', 'common_name'].some(f => sp[f] && sp[f].toLowerCase().includes(searchLower));
                      });
                      const selSearchLower = selectedSearch.trim().toLowerCase();
                      const selectedFiltered = config.species_filter.selected_species.filter(sp => {
                        if (!selSearchLower) return true;
                        return ['ebird_code', 'scientific_name', 'common_name'].some(f => sp[f] && sp[f].toLowerCase().includes(selSearchLower));
                      });
                      // Determine which extra columns have data to show (beyond the native key field)
                      const extraCols = ['scientific_name', 'common_name', 'ebird_code'].filter(f => f !== modelKeyField);

                      const hasExtraData = (pool) => extraCols.some(f => pool.some(sp => sp[f] && sp[f] !== sp[modelKeyField]));
                      const availHasExtra = hasExtraData(availablePool);
                      const selHasExtra = hasExtraData(config.species_filter.selected_species);

                      const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' };
                      const thStyle = { padding: '4px 8px', textAlign: 'left', whiteSpace: 'nowrap', background: 'var(--surface-secondary, #f5f5f5)', position: 'sticky', top: 0, borderBottom: '1px solid var(--border-color)' };
                      const tdStyle = { padding: '3px 8px' };
                      const rowStyle = { borderTop: '1px solid var(--border-color)', cursor: 'pointer' };
                      const panelStyle = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', borderRadius: 4, overflow: 'hidden' };
                      const colLabel = { scientific_name: 'Scientific Name', common_name: 'Common Name', ebird_code: 'eBird Code' };
                      const isItalic = (f) => f === 'scientific_name';

                      const renderRow = (sp, onClick, showExtra) => {
                        const key = getSpeciesKey(sp);
                        const visibleExtras = showExtra ? extraCols.filter(f => sp[f] && sp[f] !== sp[modelKeyField]) : [];
                        return (
                          <tr key={key} style={rowStyle} onClick={onClick}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-bg, #f0f0f0)'}
                            onMouseLeave={e => e.currentTarget.style.background = ''}
                          >
                            <td style={{ ...tdStyle, fontStyle: isItalic(modelKeyField) ? 'italic' : 'normal' }}>{sp[modelKeyField]}</td>
                            {visibleExtras.map(f => (
                              <td key={f} style={{ ...tdStyle, color: 'var(--medium-gray)', fontStyle: isItalic(f) ? 'italic' : 'normal' }}>{sp[f]}</td>
                            ))}
                            {sp.probability != null && <td style={{ ...tdStyle, color: 'var(--medium-gray)', whiteSpace: 'nowrap' }}>{sp.probability.toFixed(3)}</td>}
                          </tr>
                        );
                      };

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {/* Tip */}
                          <div style={{ fontSize: '0.75rem', color: 'var(--medium-gray)', fontStyle: 'italic' }}>
                            Tip: You can save the selected list as a plain text file (one class per line, no header), edit it, and reload it with Load List.
                          </div>

                          {/* Save / Load / bulk controls */}
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <button type="button" className="button-secondary" style={{ fontSize: '0.8rem', padding: '4px 10px' }} onClick={handleSaveSpeciesList}>
                              Save List (.txt)
                            </button>
                            <button type="button" className="button-secondary" style={{ fontSize: '0.8rem', padding: '4px 10px' }} onClick={handleLoadSpeciesList}>
                              Load List (.txt)
                            </button>
                            {geoFilteredClasses !== null && (
                              <button type="button" className="button-secondary" style={{ fontSize: '0.8rem', padding: '4px 10px' }} onClick={() => setGeoFilteredClasses(null)}>
                                Reset to All Classes
                              </button>
                            )}
                          </div>

                          {/* Side-by-side tables */}
                          <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>

                            {/* Left: Available */}
                            <div style={panelStyle}>
                              <div style={{ padding: '4px 8px', background: 'var(--surface-secondary, #f5f5f5)', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem', fontWeight: 500, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>
                                  Available
                                  {geoFilteredClasses !== null && <span style={{ fontWeight: 400, color: 'var(--medium-gray)', marginLeft: 6 }}>(geo-filtered)</span>}
                                </span>
                                <button
                                  type="button" className="button-secondary"
                                  style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                                  onClick={() => setConfig(prev => ({ ...prev, species_filter: { ...prev.species_filter, selected_species: [...prev.species_filter.selected_species, ...availableFiltered] } }))}
                                  title="Add all visible available classes to selected"
                                >
                                  Add All →
                                </button>
                              </div>
                              <input
                                type="text" value={availableSearch} onChange={e => setAvailableSearch(e.target.value)}
                                placeholder="Filter…"
                                style={{ margin: 4, padding: '3px 6px', fontSize: '0.8rem', border: '1px solid var(--border-color)', borderRadius: 3 }}
                              />
                              <div style={{ overflowY: 'auto', maxHeight: 260 }}>
                                <table style={tableStyle}>
                                  {availHasExtra && (
                                    <thead>
                                      <tr>
                                        <th style={thStyle}>{colLabel[modelKeyField]}</th>
                                        {extraCols.filter(f => availablePool.some(sp => sp[f] && sp[f] !== sp[modelKeyField])).map(f => (
                                          <th key={f} style={thStyle}>{colLabel[f]}</th>
                                        ))}
                                        {availablePool.some(sp => sp.probability != null) && <th style={thStyle}>Prob.</th>}
                                      </tr>
                                    </thead>
                                  )}
                                  <tbody>
                                    {availableFiltered.map(sp => renderRow(sp, () => handleAddSpecies(sp), availHasExtra))}
                                    {availableFiltered.length === 0 && (
                                      <tr><td colSpan={99} style={{ ...tdStyle, color: 'var(--medium-gray)' }}>
                                        {availablePool.length === 0 ? 'No classes available — select a model or run geo filter' : 'All classes selected'}
                                      </td></tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            {/* Right: Selected */}
                            <div style={panelStyle}>
                              <div style={{ padding: '4px 8px', background: 'var(--surface-secondary, #f5f5f5)', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem', fontWeight: 500, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>Selected ({config.species_filter.selected_species.length})</span>
                                <button
                                  type="button" className="button-clear"
                                  style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                                  onClick={handleClearAllSpecies}
                                  title="Remove all selected classes"
                                >
                                  ← Remove All
                                </button>
                              </div>
                              <input
                                type="text" value={selectedSearch} onChange={e => setSelectedSearch(e.target.value)}
                                placeholder="Filter…"
                                style={{ margin: 4, padding: '3px 6px', fontSize: '0.8rem', border: '1px solid var(--border-color)', borderRadius: 3 }}
                              />
                              <div style={{ overflowY: 'auto', maxHeight: 260 }}>
                                <table style={tableStyle}>
                                  {selHasExtra && (
                                    <thead>
                                      <tr>
                                        <th style={thStyle}>{colLabel[modelKeyField]}</th>
                                        {extraCols.filter(f => config.species_filter.selected_species.some(sp => sp[f] && sp[f] !== sp[modelKeyField])).map(f => (
                                          <th key={f} style={thStyle}>{colLabel[f]}</th>
                                        ))}
                                        {config.species_filter.selected_species.some(sp => sp.probability != null) && <th style={thStyle}>Prob.</th>}
                                      </tr>
                                    </thead>
                                  )}
                                  <tbody>
                                    {selectedFiltered.map(sp => renderRow(sp, () => handleRemoveSpecies(getSpeciesKey(sp)), selHasExtra))}
                                    {selectedFiltered.length === 0 && (
                                      <tr><td colSpan={99} style={{ ...tdStyle, color: 'var(--medium-gray)' }}>
                                        {config.species_filter.selected_species.length === 0 ? 'No classes selected' : 'No matches'}
                                      </td></tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>

                          {/* Search-to-add from full classifier labels (for adding classes not in geo filter) */}
                          {classifierLabels.length > 0 && (() => {
                            const filtered = addSearchInput.trim().length > 0
                              ? classifierLabels.filter(name =>
                                !selectedKeys.has(name) &&
                                name.toLowerCase().includes(addSearchInput.toLowerCase())
                              ).slice(0, 50)
                              : [];
                            return (
                              <div style={{ position: 'relative' }} ref={addSearchRef}>
                                <input
                                  type="text"
                                  value={addSearchInput}
                                  onChange={(e) => setAddSearchInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') setAddSearchInput('');
                                    if (e.key === 'Enter' && filtered.length > 0) { handleAddSpecies(filtered[0]); setAddSearchInput(''); }
                                  }}
                                  placeholder="Search full model class list to add…"
                                  style={{ width: '100%', maxWidth: 360, padding: '3px 6px', fontSize: '0.8rem' }}
                                />
                                {filtered.length > 0 && (
                                  <div style={{
                                    position: 'absolute', zIndex: 100, background: 'var(--surface, #fff)',
                                    border: '1px solid var(--border-color)', borderRadius: 4,
                                    maxHeight: 200, overflowY: 'auto', width: '100%', maxWidth: 360,
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                  }}>
                                    {filtered.map(name => (
                                      <div key={name}
                                        onClick={() => { handleAddSpecies(name); setAddSearchInput(''); }}
                                        style={{ padding: '5px 10px', cursor: 'pointer', fontSize: '0.8rem', fontStyle: isItalic(modelKeyField) ? 'italic' : 'normal' }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-bg, #f0f0f0)'}
                                        onMouseLeave={e => e.currentTarget.style.background = ''}
                                      >
                                        {name}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Local file model picker */}
            {config.model_source === 'local_file' && (
              <div className="form-group full-width">
                <label>Local Model File <HelpIcon section="inference-local-model" /></label>
                <div className="file-selection">
                  <div className="file-selection-buttons">
                    <button onClick={handleModelFileSelection}>Select Model File</button>
                    {config.model && (
                      <button onClick={() => setConfig(prev => ({ ...prev, model: '' }))} className="button-clear" title="Clear selected model file">
                        Clear
                      </button>
                    )}
                  </div>
                  {config.model && <span className="selected-path">{basename(config.model)}</span>}
                </div>
              </div>
            )}

            {/* RIBBIT parameters */}
            {config.model_source === 'ribbit' && (
              <div className="form-group full-width">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--medium-gray)' }}>
                    Detects periodic, pulsed vocalizations by measuring rhythmic energy at a target pulse rate.{' '}
                    <HelpIcon section="ribbit-overview" />
                  </div>

                  <div className="form-group">
                    <label>Output Class Name <HelpIcon section="ribbit-class-name" /></label>
                    <input
                      type="text"
                      value={config.ribbit_settings.class_name}
                      onChange={(e) => setConfig(prev => ({ ...prev, ribbit_settings: { ...prev.ribbit_settings, class_name: e.target.value } }))}
                      placeholder="e.g. Great Plains Toad"
                      style={{ maxWidth: 280 }}
                    />
                    <small style={{ display: 'block', marginTop: 2, color: 'var(--medium-gray)' }}>Column name in output CSV</small>
                  </div>

                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <div className="form-group">
                      <label>Signal Band (Hz) <HelpIcon section="ribbit-signal-band" /></label>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input className="compact-input" type="number" min="0" max="20000" step="50"
                          value={config.ribbit_settings.signal_band[0]}
                          onChange={(e) => setConfig(prev => ({ ...prev, ribbit_settings: { ...prev.ribbit_settings, signal_band: [parseFloat(e.target.value), prev.ribbit_settings.signal_band[1]] } }))}
                        />
                        <span style={{ color: 'var(--medium-gray)' }}>–</span>
                        <input className="compact-input" type="number" min="0" max="20000" step="50"
                          value={config.ribbit_settings.signal_band[1]}
                          onChange={(e) => setConfig(prev => ({ ...prev, ribbit_settings: { ...prev.ribbit_settings, signal_band: [prev.ribbit_settings.signal_band[0], parseFloat(e.target.value)] } }))}
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Pulse Rate Range (pulses/sec) <HelpIcon section="ribbit-pulse-rate" /></label>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input className="compact-input" type="number" min="0" max="100" step="0.5"
                          value={config.ribbit_settings.pulse_rate_range[0]}
                          onChange={(e) => setConfig(prev => ({ ...prev, ribbit_settings: { ...prev.ribbit_settings, pulse_rate_range: [parseFloat(e.target.value), prev.ribbit_settings.pulse_rate_range[1]] } }))}
                        />
                        <span style={{ color: 'var(--medium-gray)' }}>–</span>
                        <input className="compact-input" type="number" min="0" max="100" step="0.5"
                          value={config.ribbit_settings.pulse_rate_range[1]}
                          onChange={(e) => setConfig(prev => ({ ...prev, ribbit_settings: { ...prev.ribbit_settings, pulse_rate_range: [prev.ribbit_settings.pulse_rate_range[0], parseFloat(e.target.value)] } }))}
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Clip Duration (sec) <HelpIcon section="ribbit-clip-duration" /></label>
                      <input className="compact-input" type="number" min="0.1" max="60" step="0.1"
                        value={config.ribbit_settings.clip_duration}
                        onChange={(e) => setConfig(prev => ({ ...prev, ribbit_settings: { ...prev.ribbit_settings, clip_duration: parseFloat(e.target.value) } }))}
                      />
                    </div>

                    <div className="form-group">
                      <label>Clip Overlap (sec) <HelpIcon section="ribbit-clip-overlap" /></label>
                      <input className="compact-input" type="number" min="0" max="60" step="0.1"
                        value={config.ribbit_settings.clip_overlap}
                        onChange={(e) => setConfig(prev => ({ ...prev, ribbit_settings: { ...prev.ribbit_settings, clip_overlap: parseFloat(e.target.value) } }))}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Noise Bands (Hz) <small style={{ fontWeight: 400, color: 'var(--medium-gray)' }}>— up to 3, subtracted from signal</small> <HelpIcon section="ribbit-noise-bands" /></label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {[0, 1, 2].map(i => (
                        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--medium-gray)', minWidth: 16 }}>{i + 1}.</span>
                          <input className="compact-input" type="number" min="0" max="20000" step="50"
                            placeholder="min"
                            value={config.ribbit_settings.noise_bands[i] ? config.ribbit_settings.noise_bands[i][0] : ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseFloat(e.target.value);
                              setConfig(prev => {
                                const bands = [
                                  [...(prev.ribbit_settings.noise_bands[0] || [null, null])],
                                  [...(prev.ribbit_settings.noise_bands[1] || [null, null])],
                                  [...(prev.ribbit_settings.noise_bands[2] || [null, null])],
                                ];
                                bands[i][0] = val;
                                return { ...prev, ribbit_settings: { ...prev.ribbit_settings, noise_bands: bands.filter(b => b[0] !== null || b[1] !== null) } };
                              });
                            }}
                          />
                          <span style={{ color: 'var(--medium-gray)' }}>–</span>
                          <input className="compact-input" type="number" min="0" max="20000" step="50"
                            placeholder="max"
                            value={config.ribbit_settings.noise_bands[i] ? config.ribbit_settings.noise_bands[i][1] : ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseFloat(e.target.value);
                              setConfig(prev => {
                                const bands = [
                                  [...(prev.ribbit_settings.noise_bands[0] || [null, null])],
                                  [...(prev.ribbit_settings.noise_bands[1] || [null, null])],
                                  [...(prev.ribbit_settings.noise_bands[2] || [null, null])],
                                ];
                                bands[i][1] = val;
                                return { ...prev, ribbit_settings: { ...prev.ribbit_settings, noise_bands: bands.filter(b => b[0] !== null || b[1] !== null) } };
                              });
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* CWT Detector parameters */}
            {config.model_source === 'cwt_detector' && (
              <div className="form-group full-width">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--medium-gray)' }}>
                    Detects accelerating sequences of peaks via continuous wavelet transform — designed for Ruffed Grouse drumming and similar accelerating pulse patterns.{' '}
                    <HelpIcon section="cwt-overview" />
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      className="button-secondary"
                      style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                      onClick={() => setConfig(prev => ({ ...prev, cwt_settings: { ...RUGR_CWT_DEFAULTS } }))}
                    >
                      Load Default RUGR Parameters
                    </button>
                    <small style={{ color: 'var(--medium-gray)' }}>Ruffed Grouse drumming (Lapp et al. 2022)</small>
                  </div>

                  <div className="form-group">
                    <label>Output Class Name <HelpIcon section="cwt-class-name" /></label>
                    <input
                      type="text"
                      value={config.cwt_settings.class_name}
                      onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, class_name: e.target.value } }))}
                      placeholder="e.g. Ruffed Grouse"
                      style={{ maxWidth: 280 }}
                    />
                    <small style={{ display: 'block', marginTop: 2, color: 'var(--medium-gray)' }}>Column name in output CSV</small>
                  </div>

                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <div className="form-group">
                      <label>Sample Rate (Hz) <HelpIcon section="cwt-sample-rate" /></label>
                      <input className="compact-input" type="number" min="100" max="48000"
                        value={config.cwt_settings.sample_rate}
                        onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, sample_rate: parseInt(e.target.value) } }))}
                      />
                    </div>
                    <div className="form-group">
                      <label>Window Length (sec) <HelpIcon section="cwt-window-len" /></label>
                      <input className="compact-input" type="number" min="1" max="600"
                        value={config.cwt_settings.window_len}
                        onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, window_len: parseFloat(e.target.value) } }))}
                      />
                    </div>
                    <div className="form-group">
                      <label>Center Frequency (Hz) <HelpIcon section="cwt-center-frequency" /></label>
                      <input className="compact-input" type="number" min="1" max="500"
                        value={config.cwt_settings.center_frequency}
                        onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, center_frequency: parseFloat(e.target.value) } }))}
                      />
                    </div>
                    <div className="form-group">
                      <label>Wavelet <HelpIcon section="cwt-wavelet" /></label>
                      <input className="compact-input" type="text"
                        value={config.cwt_settings.wavelet}
                        onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, wavelet: e.target.value } }))}
                        style={{ width: 80 }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Peak Threshold <HelpIcon section="cwt-peak-threshold" /></label>
                      <input className="compact-input" type="number" min="0" max="1" step="0.01"
                        value={config.cwt_settings.peak_threshold}
                        onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, peak_threshold: parseFloat(e.target.value) } }))}
                      />
                    </div>
                    <div className="form-group">
                      <label>Peak Separation (sec) <HelpIcon section="cwt-peak-separation" /></label>
                      <input className="compact-input" type="number" min="0" max="1" step="0.001"
                        value={config.cwt_settings.peak_separation}
                        onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, peak_separation: parseFloat(e.target.value) } }))}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <div className="form-group">
                      <label>&delta;t Range (sec) <HelpIcon section="cwt-dt-range" /></label>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input className="compact-input" type="number" step="0.01"
                          value={config.cwt_settings.dt_range[0]}
                          onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, dt_range: [parseFloat(e.target.value), prev.cwt_settings.dt_range[1]] } }))}
                        />
                        <span style={{ color: 'var(--medium-gray)' }}>–</span>
                        <input className="compact-input" type="number" step="0.01"
                          value={config.cwt_settings.dt_range[1]}
                          onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, dt_range: [prev.cwt_settings.dt_range[0], parseFloat(e.target.value)] } }))}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>&delta;y Range <HelpIcon section="cwt-dy-range" /></label>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input className="compact-input" type="number" step="0.01"
                          value={config.cwt_settings.dy_range[0]}
                          onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, dy_range: [parseFloat(e.target.value), prev.cwt_settings.dy_range[1]] } }))}
                        />
                        <span style={{ color: 'var(--medium-gray)' }}>–</span>
                        <input className="compact-input" type="number" step="0.01"
                          value={config.cwt_settings.dy_range[1]}
                          onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, dy_range: [prev.cwt_settings.dy_range[0], parseFloat(e.target.value)] } }))}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>&delta;²y Range <HelpIcon section="cwt-d2y-range" /></label>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input className="compact-input" type="number" step="0.01"
                          value={config.cwt_settings.d2y_range[0]}
                          onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, d2y_range: [parseFloat(e.target.value), prev.cwt_settings.d2y_range[1]] } }))}
                        />
                        <span style={{ color: 'var(--medium-gray)' }}>–</span>
                        <input className="compact-input" type="number" step="0.01"
                          value={config.cwt_settings.d2y_range[1]}
                          onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, d2y_range: [prev.cwt_settings.d2y_range[0], parseFloat(e.target.value)] } }))}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Max Skip <HelpIcon section="cwt-max-skip" /></label>
                      <input className="compact-input" type="number" min="0" max="20"
                        value={config.cwt_settings.max_skip}
                        onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, max_skip: parseInt(e.target.value) } }))}
                      />
                    </div>
                    <div className="form-group">
                      <label>Duration Range (sec) <HelpIcon section="cwt-duration-range" /></label>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input className="compact-input" type="number" min="0" step="0.5"
                          value={config.cwt_settings.duration_range[0]}
                          onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, duration_range: [parseFloat(e.target.value), prev.cwt_settings.duration_range[1]] } }))}
                        />
                        <span style={{ color: 'var(--medium-gray)' }}>–</span>
                        <input className="compact-input" type="number" min="0" step="0.5"
                          value={config.cwt_settings.duration_range[1]}
                          onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, duration_range: [prev.cwt_settings.duration_range[0], parseFloat(e.target.value)] } }))}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Points Range <HelpIcon section="cwt-points-range" /></label>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input className="compact-input" type="number" min="1"
                          value={config.cwt_settings.points_range[0]}
                          onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, points_range: [parseInt(e.target.value), prev.cwt_settings.points_range[1]] } }))}
                        />
                        <span style={{ color: 'var(--medium-gray)' }}>–</span>
                        <input className="compact-input" type="number" min="1"
                          value={config.cwt_settings.points_range[1]}
                          onChange={(e) => setConfig(prev => ({ ...prev, cwt_settings: { ...prev.cwt_settings, points_range: [prev.cwt_settings.points_range[0], parseInt(e.target.value)] } }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Standard inference settings — hidden for signal-processing methods */}
            {(config.model_source === 'bmz' || config.model_source === 'local_file') && (<>
              <div className="form-group">
                <label>Clip Overlap (sec) <HelpIcon section="inference-overlap" /></label>
                <input
                  className="compact-input"
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  value={config.overlap}
                  onChange={(e) => setConfig(prev => ({ ...prev, overlap: parseFloat(e.target.value) }))}
                />
              </div>

              <div className="form-group">
                <label>Batch Size <HelpIcon section="inference-batch-size" /></label>
                <input
                  className="compact-input"
                  type="number"
                  min="1"
                  max="32"
                  value={config.batch_size}
                  onChange={(e) => setConfig(prev => ({ ...prev, batch_size: parseInt(e.target.value) }))}
                />
              </div>

              <div className="form-group">
                <label>Workers <HelpIcon section="inference-workers" /></label>
                <input
                  className="compact-input"
                  type="number"
                  min="1"
                  max="8"
                  value={config.worker_count}
                  onChange={(e) => setConfig(prev => ({ ...prev, worker_count: parseInt(e.target.value) }))}
                />
              </div>
            </>)}
          </div>
        )}

        {settingsTab === 2 && (
          <div className="form-grid inference-tab-grid">
            {/* Sparse Outputs */}
            <div className="form-group full-width">
              <label>
                <Checkbox
                  size="small"
                  checked={config.sparse_outputs_enabled}
                  onChange={(e) => setConfig(prev => ({ ...prev, sparse_outputs_enabled: e.target.checked }))}
                  sx={{ p: 0.25, mr: 0.5 }}
                />
                Save sparse outputs <HelpIcon section="inference-sparse-outputs" />
              </label>
              <small style={{ display: 'block', marginTop: '4px', color: 'var(--medium-gray)' }}>
                Only save scores above threshold, output as .pkl file instead of .csv
              </small>
            </div>

            {config.sparse_outputs_enabled && (
              <div className="form-group" style={{ marginLeft: '20px' }}>
                <label>Score Threshold <HelpIcon section="inference-sparse-threshold" /></label>
                <input
                  className="compact-input"
                  type="number"
                  min="-10"
                  max="5"
                  step="0.1"
                  value={config.sparse_save_threshold}
                  onChange={(e) => setConfig(prev => ({ ...prev, sparse_save_threshold: parseFloat(e.target.value) }))}
                />
                <small style={{ display: 'block', marginTop: '4px', color: 'var(--medium-gray)' }}>
                  Logit scores below this threshold will be discarded (default: -3.0)
                </small>
              </div>
            )}

            {/* Subfolder Splitting */}
            <div className="form-group full-width">
              <label>
                <Checkbox
                  size="small"
                  checked={config.split_by_subfolder}
                  onChange={(e) => setConfig(prev => ({ ...prev, split_by_subfolder: e.target.checked }))}
                  sx={{ p: 0.25, mr: 0.5 }}
                />
                Separate inference by subfolders
              </label>
              <div style={{ fontSize: '0.8rem', color: 'var(--medium-gray)', marginTop: '4px' }}>
                Create separate output files for each subfolder containing audio files
              </div>
            </div>

            {/* Python Environment */}
            <div className="form-group full-width">
              <label>
                <Checkbox
                  size="small"
                  checked={config.use_custom_python_env}
                  onChange={(e) => setConfig(prev => ({ ...prev, use_custom_python_env: e.target.checked }))}
                  sx={{ p: 0.25, mr: 0.5 }}
                />
                Use Custom Python Environment <HelpIcon section="inference-python-env" />
              </label>
              <div style={{ fontSize: '0.8rem', color: 'var(--medium-gray)', marginTop: '4px' }}>
                Use a custom Python environment instead of the default dipper_ml_env
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
                <Checkbox
                  size="small"
                  checked={config.testing_mode_enabled}
                  onChange={(e) => setConfig(prev => ({ ...prev, testing_mode_enabled: e.target.checked }))}
                  sx={{ p: 0.25, mr: 0.5 }}
                />
                Testing Mode <HelpIcon section="inference-testing-mode" />
              </label>
              <div style={{ fontSize: '0.8rem', color: 'var(--medium-gray)', marginTop: '4px' }}>
                Run inference on a small subset of files for quick testing
              </div>
              {config.testing_mode_enabled && (
                <div className="form-group" style={{ marginTop: '8px', marginLeft: '24px' }}>
                  <label>Subset Size</label>
                  <input
                    className="compact-input"
                    type="number"
                    min="1"
                    max="1000"
                    value={config.subset_size}
                    onChange={(e) => setConfig(prev => ({ ...prev, subset_size: parseInt(e.target.value) }))}
                  />
                  <div style={{ fontSize: '0.8rem', color: 'var(--medium-gray)', marginTop: '4px' }}>
                    Number of files to process (default: 10)
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Config Management and Task Launch Buttons */}
      <div className="config-actions inference-config-actions task-form-actions" style={{ marginBottom: '16px' }}>
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
            disabled={(fileCount === 0) || !config.output_dir || !mlEnvReady}
            title={!mlEnvReady ? 'ML environment not installed — install from Settings tab' : undefined}
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

// Separate component for resuming incomplete tasks
function ResumeInferenceTask({ onResumeTask }) {
  const handleResumeTask = async () => {
    try {
      const configFile = await selectJSONFiles();
      if (!configFile || configFile.length === 0) {
        return; // User cancelled
      }

      // Load the config file
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
      if (result.status !== 'success') {
        console.error(`Failed to load config: ${result.error}`);
        alert(`Failed to load config file: ${result.error}`);
        return;
      }

      const configData = result.config;

      // Validate that this is an inference config with a job_folder
      if (!configData.job_folder) {
        console.error('Selected config does not contain a job_folder field. Cannot resume.');
        alert('This config file does not appear to be from an inference task. Please select an inference_config.json file from an incomplete task folder.');
        return;
      }

      // Validate required fields exist
      const requiredFields = ['model', 'model_source', 'inference_settings', 'sparse_outputs', 'python_environment', 'testing_mode'];
      for (const field of requiredFields) {
        if (!(field in configData)) {
          throw new Error(`Missing required field in config: ${field}`);
        }
      }

      // Build the task config from the loaded data - no fallbacks for config fields
      const taskConfig = {
        model_source: configData.model_source,
        model: configData.model,
        files: configData.files,
        file_globbing_patterns: configData.file_globbing_patterns,
        file_list: configData.file_list,
        file_selection_mode: configData.file_selection_mode,
        selected_extensions: configData.selected_extensions,
        glob_patterns_text: configData.glob_patterns_text,
        output_dir: configData.output_dir,
        split_by_subfolder: configData.split_by_subfolder,
        overlap: configData.inference_settings.clip_overlap,
        batch_size: configData.inference_settings.batch_size,
        worker_count: configData.inference_settings.num_workers,
        sparse_outputs_enabled: configData.sparse_outputs.enabled,
        sparse_save_threshold: configData.sparse_outputs.threshold,
        use_custom_python_env: configData.python_environment.use_custom,
        custom_python_env_path: configData.python_environment.custom_path,
        testing_mode_enabled: configData.testing_mode.enabled,
        subset_size: configData.testing_mode.subset_size,
        // Critical: pass the existing job_folder to resume in same location
        job_folder: configData.job_folder
      };

      const taskName = configData.task_name || 'Resumed Inference';

      console.log(`Resuming inference task from: ${basename(configFile[0])}`);
      console.log(`Job folder: ${configData.job_folder}`);

      // Immediately create and run the task
      onResumeTask(taskConfig, taskName);

    } catch (err) {
      console.error('Failed to resume task: ' + err.message);
      alert(`Failed to resume task: ${err.message}`);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <p style={{ fontSize: '1em', color: '#333', marginBottom: '20px' }}>
        Resume an interrupted inference task by selecting its config file. The task will continue from where it left off, skipping already-processed files.
      </p>
      <button
        className="button-primary"
        onClick={handleResumeTask}
        style={{ fontSize: '0.95rem', padding: '12px 24px' }}
      >
        Select Config File to Resume
      </button>
    </div>
  );
}

// Wrapper component with tabs for creating or resuming inference tasks
function TaskCreationForm({ onTaskCreate, onTaskCreateAndRun, mlEnvReady }) {
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (_event, newValue) => {
    setTabValue(newValue);
  };

  return (
    <div>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={tabValue} onChange={handleTabChange}>
          <Tab label="Create New Task" />
          <Tab label="Resume Task" />
        </Tabs>
      </Box>

      {/* Tab Panel 0: Create New Task */}
      <div role="tabpanel" hidden={tabValue !== 0}>
        {tabValue === 0 && (
          <CreateInferenceTaskForm
            onTaskCreate={onTaskCreate}
            onTaskCreateAndRun={onTaskCreateAndRun}
            mlEnvReady={mlEnvReady}
          />
        )}
      </div>

      {/* Tab Panel 1: Resume Task */}
      <div role="tabpanel" hidden={tabValue !== 1}>
        {tabValue === 1 && (
          <ResumeInferenceTask
            onResumeTask={onTaskCreateAndRun}
          />
        )}
      </div>
    </div>
  );
}

export default TaskCreationForm;