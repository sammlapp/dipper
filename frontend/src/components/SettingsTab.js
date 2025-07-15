import { useState, useEffect } from 'react';

function SettingsTab() {
  // Visualization settings state based on binary_classification_review.py
  const [visualizationSettings, setVisualizationSettings] = useState({
    // Spectrogram settings
    spec_window_size: 512,
    spectrogram_colormap: 'greys_r',
    
    // dB range settings
    dB_range: [-80, -20],
    
    // Bandpass filter settings
    use_bandpass: false,
    bandpass_range: [500, 8000],
    
    // Reference frequency line
    show_reference_frequency: false,
    reference_frequency: 1000,
    
    // Image settings
    resize_images: true,
    image_width: 224,
    image_height: 224,
    
    // Audio playback settings
    audio_playback_speed: 1.0,
    normalize_audio: true,
  });

  const [pythonSettings, setPythonSettings] = useState({
    python_path: '',
    conda_env: 'train_gui',
    gpu_enabled: false,
    cache_spectrograms: true,
    temp_directory: '',
  });

  const colormapOptions = [
    { value: 'viridis', label: 'Viridis (Default)' },
    { value: 'plasma', label: 'Plasma' },
    { value: 'inferno', label: 'Inferno' },
    { value: 'magma', label: 'Magma' },
    { value: 'cividis', label: 'Cividis' },
    { value: 'greys', label: 'Grayscale' },
    { value: 'hot', label: 'Hot' },
    { value: 'cool', label: 'Cool' },
    { value: 'spring', label: 'Spring' },
    { value: 'summer', label: 'Summer' },
    { value: 'autumn', label: 'Autumn' },
    { value: 'winter', label: 'Winter' },
  ];

  // Load settings on component mount
  useEffect(() => {
    const savedVizSettings = localStorage.getItem('visualization_settings');
    const savedPythonSettings = localStorage.getItem('python_settings');
    
    if (savedVizSettings) {
      try {
        setVisualizationSettings(JSON.parse(savedVizSettings));
      } catch (e) {
        console.warn('Failed to load visualization settings:', e);
      }
    }
    
    if (savedPythonSettings) {
      try {
        setPythonSettings(JSON.parse(savedPythonSettings));
      } catch (e) {
        console.warn('Failed to load python settings:', e);
      }
    }
  }, []);

  const handleVisualizationSettingChange = (key, value) => {
    setVisualizationSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handlePythonSettingChange = (key, value) => {
    setPythonSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleResetToDefaults = () => {
    setVisualizationSettings({
      spec_window_size: 512,
      spectrogram_colormap: 'greys_r',
      dB_range: [-80, -20],
      use_bandpass: false,
      bandpass_range: [500, 8000],
      show_reference_frequency: false,
      reference_frequency: 1000,
      resize_images: true,
      image_width: 224,
      image_height: 224,
      audio_playback_speed: 1.0,
      normalize_audio: true,
    });
    alert('Settings reset to defaults!');
  };

  const handleTestPython = async () => {
    try {
      if (!window.electronAPI) {
        alert('Electron API not available - running in browser mode');
        return;
      }
      
      const result = await window.electronAPI.testPythonPath();
      alert(`Python path: ${result.pythonPath}\nExists: ${result.exists}\nHome directory: ${result.homeDir}`);
    } catch (err) {
      alert('Failed to test Python path: ' + err.message);
    }
  };

  const handleSaveSettings = () => {
    // Save settings to localStorage for now
    localStorage.setItem('visualization_settings', JSON.stringify(visualizationSettings));
    localStorage.setItem('python_settings', JSON.stringify(pythonSettings));
    alert('Settings saved successfully!');
  };

  const handleLoadSettings = () => {
    try {
      const savedVizSettings = localStorage.getItem('visualization_settings');
      const savedPythonSettings = localStorage.getItem('python_settings');
      
      if (savedVizSettings) {
        setVisualizationSettings(JSON.parse(savedVizSettings));
      }
      
      if (savedPythonSettings) {
        setPythonSettings(JSON.parse(savedPythonSettings));
      }
      
      alert('Settings loaded successfully!');
    } catch (err) {
      alert('Failed to load settings: ' + err.message);
    }
  };

  return (
    <div className="tab-content">
      <h2>Settings & Configuration</h2>
      
      <div className="section">
        <h3>Visualization Settings</h3>
        <p>Configure how spectrograms and audio clips are displayed in the Review tab.</p>
        
        <div className="config-grid">
          <label>
            Spectrogram Window Size:
            <select
              value={visualizationSettings.spec_window_size}
              onChange={(e) => handleVisualizationSettingChange('spec_window_size', parseInt(e.target.value))}
            >
              <option value={256}>256 samples</option>
              <option value={512}>512 samples</option>
              <option value={1024}>1024 samples</option>
              <option value={2048}>2048 samples</option>
            </select>
          </label>
          
          <label>
            Colormap:
            <select
              value={visualizationSettings.spectrogram_colormap}
              onChange={(e) => handleVisualizationSettingChange('spectrogram_colormap', e.target.value)}
            >
              {colormapOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          
          <label>
            dB Range Min:
            <input
              type="number"
              value={visualizationSettings.dB_range[0]}
              onChange={(e) => handleVisualizationSettingChange('dB_range', [
                parseInt(e.target.value), 
                visualizationSettings.dB_range[1]
              ])}
              min="-120"
              max="0"
            />
          </label>
          
          <label>
            dB Range Max:
            <input
              type="number"
              value={visualizationSettings.dB_range[1]}
              onChange={(e) => handleVisualizationSettingChange('dB_range', [
                visualizationSettings.dB_range[0], 
                parseInt(e.target.value)
              ])}
              min="-120"
              max="0"
            />
          </label>
          
          <label>
            Reference Frequency (Hz):
            <input
              type="number"
              value={visualizationSettings.reference_frequency}
              onChange={(e) => handleVisualizationSettingChange('reference_frequency', parseInt(e.target.value))}
              min="100"
              max="20000"
              step="100"
            />
          </label>
          
          <label>
            Bandpass Low (Hz):
            <input
              type="number"
              value={visualizationSettings.bandpass_range[0]}
              onChange={(e) => handleVisualizationSettingChange('bandpass_range', [
                parseInt(e.target.value), 
                visualizationSettings.bandpass_range[1]
              ])}
              min="50"
              max="10000"
              step="50"
            />
          </label>
          
          <label>
            Bandpass High (Hz):
            <input
              type="number"
              value={visualizationSettings.bandpass_range[1]}
              onChange={(e) => handleVisualizationSettingChange('bandpass_range', [
                visualizationSettings.bandpass_range[0], 
                parseInt(e.target.value)
              ])}
              min="1000"
              max="20000"
              step="100"
            />
          </label>
          
          <label>
            Image Width (pixels):
            <input
              type="number"
              value={visualizationSettings.image_width}
              onChange={(e) => handleVisualizationSettingChange('image_width', parseInt(e.target.value))}
              min="100"
              max="1000"
              step="32"
            />
          </label>
          
          <label>
            Image Height (pixels):
            <input
              type="number"
              value={visualizationSettings.image_height}
              onChange={(e) => handleVisualizationSettingChange('image_height', parseInt(e.target.value))}
              min="100"
              max="1000"
              step="32"
            />
          </label>
          
          <label>
            Audio Playback Speed:
            <input
              type="number"
              value={visualizationSettings.audio_playback_speed}
              onChange={(e) => handleVisualizationSettingChange('audio_playback_speed', parseFloat(e.target.value))}
              min="0.25"
              max="4.0"
              step="0.25"
            />
          </label>
        </div>
        
        <div className="settings-toggles">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={visualizationSettings.use_bandpass}
              onChange={(e) => handleVisualizationSettingChange('use_bandpass', e.target.checked)}
            />
            <span>Enable Bandpass Filter</span>
          </label>
          
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={visualizationSettings.show_reference_frequency}
              onChange={(e) => handleVisualizationSettingChange('show_reference_frequency', e.target.checked)}
            />
            <span>Show Reference Frequency Line</span>
          </label>
          
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={visualizationSettings.resize_images}
              onChange={(e) => handleVisualizationSettingChange('resize_images', e.target.checked)}
            />
            <span>Resize Images to Fixed Size</span>
          </label>
          
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={visualizationSettings.normalize_audio}
              onChange={(e) => handleVisualizationSettingChange('normalize_audio', e.target.checked)}
            />
            <span>Normalize Audio Clips</span>
          </label>
        </div>
      </div>
      
      <div className="section">
        <h3>Python Environment</h3>
        <div className="config-grid">
          <label>
            Python Path (Optional):
            <input
              type="text"
              value={pythonSettings.python_path}
              onChange={(e) => handlePythonSettingChange('python_path', e.target.value)}
              placeholder="Leave empty for auto-detection"
            />
          </label>
          
          <label>
            Conda Environment:
            <input
              type="text"
              value={pythonSettings.conda_env}
              onChange={(e) => handlePythonSettingChange('conda_env', e.target.value)}
              placeholder="train_gui"
            />
          </label>
          
          <label>
            Temporary Directory:
            <input
              type="text"
              value={pythonSettings.temp_directory}
              onChange={(e) => handlePythonSettingChange('temp_directory', e.target.value)}
              placeholder="Leave empty for system default"
            />
          </label>
        </div>
        
        <div className="settings-toggles">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={pythonSettings.gpu_enabled}
              onChange={(e) => handlePythonSettingChange('gpu_enabled', e.target.checked)}
            />
            <span>Enable GPU Acceleration (if available)</span>
          </label>
          
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={pythonSettings.cache_spectrograms}
              onChange={(e) => handlePythonSettingChange('cache_spectrograms', e.target.checked)}
            />
            <span>Cache Generated Spectrograms</span>
          </label>
        </div>
      </div>
      
      <div className="section">
        <h3>Actions</h3>
        <div className="button-group">
          <button className="primary-button" onClick={handleSaveSettings}>
            Save Settings
          </button>
          <button onClick={handleLoadSettings}>
            Load Settings
          </button>
          <button onClick={handleResetToDefaults}>
            Reset to Defaults
          </button>
          <button onClick={handleTestPython}>
            Test Python Path
          </button>
        </div>
      </div>
      
      <div className="section">
        <h3>Current Settings Preview</h3>
        <div className="settings-preview">
          <div className="preview-section">
            <h4>Spectrogram Settings</h4>
            <ul>
              <li>Window Size: {visualizationSettings.spec_window_size} samples</li>
              <li>Colormap: {visualizationSettings.spectrogram_colormap}</li>
              <li>dB Range: {visualizationSettings.dB_range[0]} to {visualizationSettings.dB_range[1]} dB</li>
              <li>Bandpass Filter: {visualizationSettings.use_bandpass ? 
                `${visualizationSettings.bandpass_range[0]}-${visualizationSettings.bandpass_range[1]} Hz` : 
                'Disabled'}</li>
              <li>Reference Frequency: {visualizationSettings.show_reference_frequency ? 
                `${visualizationSettings.reference_frequency} Hz` : 
                'Hidden'}</li>
              <li>Image Size: {visualizationSettings.resize_images ? 
                `${visualizationSettings.image_width}x${visualizationSettings.image_height}` : 
                'Original'}</li>
            </ul>
          </div>
          
          <div className="preview-section">
            <h4>Audio Settings</h4>
            <ul>
              <li>Playback Speed: {visualizationSettings.audio_playback_speed}x</li>
              <li>Normalize Audio: {visualizationSettings.normalize_audio ? 'Yes' : 'No'}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsTab;