import { useState, useEffect } from 'react';

function DisplaySettings({ onSettingsChange }) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [settings, setSettings] = useState({
    spec_window_size: 512,
    spectrogram_colormap: 'greys_r',
    dB_range: [-80, -20],
    use_bandpass: false,
    bandpass_range: [500, 8000],
    show_reference_frequency: false,
    reference_frequency: 1000,
  });

  const colormapOptions = [
    { value: 'greys_r', label: 'Inverse Grayscale (Default)' },
    { value: 'greys', label: 'Grayscale' },
    { value: 'viridis', label: 'Viridis' },
    { value: 'plasma', label: 'Plasma' },
    { value: 'inferno', label: 'Inferno' },
    { value: 'magma', label: 'Magma' },
    { value: 'cividis', label: 'Cividis' },
    { value: 'hot', label: 'Hot' },
    { value: 'cool', label: 'Cool' },
  ];

  // Load settings on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem('visualization_settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setSettings(parsed);
      } catch (e) {
        console.warn('Failed to parse saved settings:', e);
      }
    }
  }, []);

  const handleSettingChange = (key, value) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    
    // Save to localStorage
    localStorage.setItem('visualization_settings', JSON.stringify(newSettings));
    
    // Notify parent component
    if (onSettingsChange) {
      onSettingsChange(newSettings);
    }
  };

  const resetToDefaults = () => {
    const defaults = {
      spec_window_size: 512,
      spectrogram_colormap: 'viridis',
      dB_range: [-80, -20],
      use_bandpass: false,
      bandpass_range: [500, 8000],
      show_reference_frequency: false,
      reference_frequency: 1000,
    };
    setSettings(defaults);
    localStorage.setItem('visualization_settings', JSON.stringify(defaults));
    if (onSettingsChange) {
      onSettingsChange(defaults);
    }
  };

  return (
    <div className="display-settings">
      <button 
        className="settings-toggle"
        onClick={() => setIsCollapsed(!isCollapsed)}
        aria-expanded={!isCollapsed}
      >
        <span>Display Settings</span>
        <span className="toggle-icon">{isCollapsed ? '▶' : '▼'}</span>
      </button>
      
      {!isCollapsed && (
        <div className="settings-panel">
          <div className="settings-grid">
            <label>
              Window Size:
              <select
                value={settings.spec_window_size}
                onChange={(e) => handleSettingChange('spec_window_size', parseInt(e.target.value))}
              >
                <option value={256}>256</option>
                <option value={512}>512</option>
                <option value={1024}>1024</option>
                <option value={2048}>2048</option>
              </select>
            </label>
            
            <label>
              Colormap:
              <select
                value={settings.spectrogram_colormap}
                onChange={(e) => handleSettingChange('spectrogram_colormap', e.target.value)}
              >
                {colormapOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            
            <label>
              dB Min:
              <input
                type="number"
                value={settings.dB_range[0]}
                onChange={(e) => handleSettingChange('dB_range', [
                  parseInt(e.target.value), 
                  settings.dB_range[1]
                ])}
                min="-120"
                max="0"
                step="5"
              />
            </label>
            
            <label>
              dB Max:
              <input
                type="number"
                value={settings.dB_range[1]}
                onChange={(e) => handleSettingChange('dB_range', [
                  settings.dB_range[0], 
                  parseInt(e.target.value)
                ])}
                min="-120"
                max="0"
                step="5"
              />
            </label>
            
            <label>
              Bandpass Low (Hz):
              <input
                type="number"
                value={settings.bandpass_range[0]}
                onChange={(e) => handleSettingChange('bandpass_range', [
                  parseInt(e.target.value), 
                  settings.bandpass_range[1]
                ])}
                min="50"
                max="10000"
                step="50"
                disabled={!settings.use_bandpass}
              />
            </label>
            
            <label>
              Bandpass High (Hz):
              <input
                type="number"
                value={settings.bandpass_range[1]}
                onChange={(e) => handleSettingChange('bandpass_range', [
                  settings.bandpass_range[0], 
                  parseInt(e.target.value)
                ])}
                min="1000"
                max="20000"
                step="100"
                disabled={!settings.use_bandpass}
              />
            </label>
            
            <label>
              Reference Freq (Hz):
              <input
                type="number"
                value={settings.reference_frequency}
                onChange={(e) => handleSettingChange('reference_frequency', parseInt(e.target.value))}
                min="100"
                max="20000"
                step="100"
                disabled={!settings.show_reference_frequency}
              />
            </label>
          </div>
          
          <div className="settings-toggles">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={settings.use_bandpass}
                onChange={(e) => handleSettingChange('use_bandpass', e.target.checked)}
              />
              <span>Enable Bandpass Filter</span>
            </label>
            
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={settings.show_reference_frequency}
                onChange={(e) => handleSettingChange('show_reference_frequency', e.target.checked)}
              />
              <span>Show Reference Frequency Line</span>
            </label>
          </div>
          
          <div className="settings-actions">
            <button 
              className="reset-button"
              onClick={resetToDefaults}
            >
              Reset to Defaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DisplaySettings;