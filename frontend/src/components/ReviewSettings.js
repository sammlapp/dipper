import { useState, useEffect } from 'react';
import { Slider, styled, FormControl, Select, MenuItem } from '@mui/material';

// Styled Material UI Slider with local color scheme
const StyledSlider = styled(Slider)({
  color: '#4f5d75', // --dark-accent
  height: 4,
  '& .MuiSlider-track': {
    border: 'none',
    backgroundColor: '#4f5d75', // --dark-accent
  },
  '& .MuiSlider-rail': {
    backgroundColor: '#d1d5db', // --border
    opacity: 1,
  },
  '& .MuiSlider-thumb': {
    height: 16,
    width: 16,
    backgroundColor: '#4f5d75', // --dark-accent
    border: '2px solid currentColor',
    '&:focus, &:hover, &.Mui-active, &.Mui-focusVisible': {
      boxShadow: 'inherit',
    },
    '&:before': {
      display: 'none',
    },
    '&:hover': {
      backgroundColor: '#395756', // --dark
    },
  },
  '& .MuiSlider-valueLabel': {
    lineHeight: 1.2,
    fontSize: 12,
    background: 'unset',
    padding: 0,
    width: 32,
    height: 32,
    borderRadius: '50% 50% 50% 0',
    backgroundColor: '#4f5d75', // --dark-accent
    transformOrigin: 'bottom left',
    transform: 'translate(50%, -100%) rotate(-45deg) scale(0)',
    '&:before': { display: 'none' },
    '&.MuiSlider-valueLabelOpen': {
      transform: 'translate(50%, -100%) rotate(-45deg) scale(1)',
    },
    '& > *': {
      transform: 'rotate(45deg)',
    },
  },
});

function ReviewSettings({ onSettingsChange, onReRenderSpectrograms, onClearCache, currentSettings, onSaveConfig, onLoadConfig }) {
  const [settings, setSettings] = useState({
    // Spectrogram settings
    spec_window_size: 512,
    spectrogram_colormap: 'greys_r',
    dB_range: [-80, -20],
    use_bandpass: false,
    bandpass_range: [500, 8000],
    show_reference_frequency: false,
    reference_frequency: 1000,
    
    // Grid layout settings
    grid_rows: 3,
    grid_columns: 4,
    
    // Display settings
    show_comments: false,
    show_file_name: false,
    show_binary_controls: true, // Show yes/no/uncertain controls in grid mode

    // Image resize settings
    resize_images: true,
    image_width: 400,
    image_height: 200,
    
    // Focus mode settings
    focus_mode_autoplay: true,
    focus_size: 'medium', // 'small', 'medium', 'large'
    
    // Keyboard shortcuts
    keyboard_shortcuts_enabled: true,
    
    // Review mode
    review_mode: 'binary', // 'binary' or 'multiclass'
    
    // Multi-class settings
    manual_classes: '',
    
    // Clip duration setting
    clip_duration: 3.0
  });
  
  // Local state for text inputs to allow editing
  const [localBandpassLow, setLocalBandpassLow] = useState(settings.bandpass_range[0]);
  const [localBandpassHigh, setLocalBandpassHigh] = useState(settings.bandpass_range[1]);
  const [localReferenceFreq, setLocalReferenceFreq] = useState(settings.reference_frequency);
  const [localImageWidth, setLocalImageWidth] = useState(settings.image_width);
  const [localImageHeight, setLocalImageHeight] = useState(settings.image_height);

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
    const savedSettings = localStorage.getItem('review_settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        const newSettings = { ...settings, ...parsed };
        setSettings(newSettings);
      } catch (e) {
        console.warn('Failed to parse saved review settings:', e);
      }
    }
  }, []);

  // Sync with parent settings when they change (e.g., when review mode is auto-detected)
  useEffect(() => {
    if (currentSettings) {
      setSettings(prev => ({ ...prev, ...currentSettings }));
    }
  }, [currentSettings]);

  // Sync local state when settings change
  useEffect(() => {
    setLocalBandpassLow(settings.bandpass_range[0]);
    setLocalBandpassHigh(settings.bandpass_range[1]);
    setLocalReferenceFreq(settings.reference_frequency);
    setLocalImageWidth(settings.image_width);
    setLocalImageHeight(settings.image_height);
  }, [settings.bandpass_range, settings.reference_frequency, settings.image_width, settings.image_height]);

  // Handle immediate setting changes (for dropdowns, checkboxes, sliders)
  const handleSettingChange = (key, value) => {
    // Validate dB range to ensure dB_min < dB_max and reasonable values
    if (key === 'dB_range') {
      const [dB_min, dB_max] = value;
      if (dB_min >= dB_max) {
        console.warn('Invalid dB range: dB_min must be less than dB_max', value);
        return;
      }
      
      if (dB_min < -200 || dB_min > 50 || dB_max < -200 || dB_max > 50) {
        console.warn('dB range values outside reasonable bounds (-200 to +50)', value);
        return;
      }
      
      if (dB_max - dB_min < 5) {
        console.warn('dB range too narrow, minimum 5 dB difference required', value);
        return;
      }
    }
    
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    
    // Save to localStorage
    localStorage.setItem('review_settings', JSON.stringify(newSettings));
    
    // Also save visualization settings for spectrogram generation
    const visualizationSettings = {
      spec_window_size: newSettings.spec_window_size,
      spectrogram_colormap: newSettings.spectrogram_colormap,
      dB_range: newSettings.dB_range,
      use_bandpass: newSettings.use_bandpass,
      bandpass_range: newSettings.bandpass_range,
      show_reference_frequency: newSettings.show_reference_frequency,
      reference_frequency: newSettings.reference_frequency,
      resize_images: newSettings.resize_images,
      image_width: newSettings.image_width,
      image_height: newSettings.image_height,
    };
    localStorage.setItem('visualization_settings', JSON.stringify(visualizationSettings));
    
    // Notify parent component
    if (onSettingsChange) {
      onSettingsChange(newSettings);
    }
    
    // Check if visualization settings changed and trigger re-render
    const visualizationSettingsChanged = 
      key === 'spec_window_size' ||
      key === 'spectrogram_colormap' ||
      key === 'dB_range' ||
      key === 'use_bandpass' ||
      key === 'bandpass_range' ||
      key === 'show_reference_frequency' ||
      key === 'reference_frequency' ||
      key === 'resize_images' ||
      key === 'image_width' ||
      key === 'image_height' ||
      key === 'focus_size';
    
    if (visualizationSettingsChanged) {
      // Clear cache to ensure fresh spectrograms
      if (onClearCache) {
        onClearCache();
      }
      
      // Trigger spectrogram re-rendering
      if (onReRenderSpectrograms) {
        onReRenderSpectrograms();
      }
    }
  };

  // Handle text field changes that should only update on blur or Enter
  const handleTextFieldChange = (key, value) => {
    // For text inputs, just apply the change directly
    handleSettingChange(key, value);
  };

  const resetToDefaults = () => {
    const defaults = {
      spec_window_size: 512,
      spectrogram_colormap: 'greys_r', // Back to standard default
      dB_range: [-80, -20],
      use_bandpass: false,
      bandpass_range: [500, 8000],
      show_reference_frequency: false,
      reference_frequency: 1000,
      grid_rows: 3,
      grid_columns: 4,
      show_comments: false,
      show_file_name: true,
      show_binary_controls: true,
      resize_images: true,
      image_width: 400,
      image_height: 200,
      focus_mode_autoplay: true,
      focus_size: 'medium',
      keyboard_shortcuts_enabled: true,
      review_mode: 'binary',
      manual_classes: '',
      clip_duration: 3.0
    };
    
    // Clear potentially corrupted visualization settings first
    const defaultVisualizationSettings = {
      spec_window_size: 512,
      spectrogram_colormap: 'greys_r', // Back to standard default
      dB_range: [-80, -20],
      use_bandpass: false,
      bandpass_range: [500, 8000],
      show_reference_frequency: false,
      reference_frequency: 1000,
      resize_images: true,
      image_width: 400,
      image_height: 200,
      normalize_audio: true
    };
    
    // Clear ALL localStorage keys related to settings
    localStorage.removeItem('review_settings');
    localStorage.removeItem('visualization_settings');
    
    // Set fresh defaults to localStorage FIRST
    localStorage.setItem('review_settings', JSON.stringify(defaults));
    localStorage.setItem('visualization_settings', JSON.stringify(defaultVisualizationSettings));
    
    // Then update component state
    setSettings(defaults);
    
    console.log('RESET: Cleared all settings and set proper defaults');
    
    // Clear cache preemptively to avoid stale spectrograms
    if (onClearCache) {
      onClearCache();
    }
    
    // Trigger re-render immediately
    if (onReRenderSpectrograms) {
      onReRenderSpectrograms();
    }
  };

  return (
    <div className="review-settings-content">
            {/* Review Mode */}
            <div className="settings-section">
              <h4>Review Mode</h4>
              <div className="review-mode-selection">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="review_mode"
                    value="binary"
                    checked={settings.review_mode === 'binary'}
                    onChange={(e) => handleSettingChange('review_mode', e.target.value)}
                  />
                  <span>Binary Review (Yes/No/Uncertain)</span>
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="review_mode"
                    value="multiclass"
                    checked={settings.review_mode === 'multiclass'}
                    onChange={(e) => handleSettingChange('review_mode', e.target.value)}
                  />
                  <span>Multi-class Review (Class Selection)</span>
                </label>
              </div>
            </div>

            {/* Multi-class settings */}
            {settings.review_mode === 'multiclass' && (
              <div className="settings-section">
                <h4>Multi-class Classes</h4>
                <div className="input-group">
                  <label htmlFor="manual_classes">Available Classes (one per line):</label>
                  <textarea
                    id="manual_classes"
                    value={settings.manual_classes}
                    onChange={(e) => handleSettingChange('manual_classes', e.target.value)}
                    placeholder="Enter class names, one per line:&#10;bird&#10;car&#10;dog&#10;noise"
                    rows="4"
                    className="class-input"
                  />
                  <small className="help-text">
                    Enter each class name on a new line. These will be available for selection in addition to any classes found in the CSV file.
                  </small>
                </div>
              </div>
            )}

            {/* Clip Duration Setting */}
            <div className="settings-section">
              <h4>Clip Duration</h4>
              <div className="input-group">
                <label htmlFor="clip_duration">Default Clip Duration (seconds):</label>
                <input
                  id="clip_duration"
                  type="number"
                  value={settings.clip_duration}
                  onChange={(e) => handleSettingChange('clip_duration', parseFloat(e.target.value) || 3.0)}
                  min="0.1"
                  max="30.0"
                  step="0.1"
                  className="duration-input"
                />
                <small className="help-text">
                  Duration used for clips when end_time is not specified in the CSV file. Can be overridden when loading annotation files.
                </small>
              </div>
            </div>

            {/* Grid Layout */}
            <div className="settings-section">
              <h4>Grid Layout</h4>
              <div className="grid-settings">
                <label>
                  Rows:
                  <FormControl size="small" sx={{ minWidth: 70, ml: 1 }}>
                    <Select
                      value={settings.grid_rows}
                      onChange={(e) => handleSettingChange('grid_rows', parseInt(e.target.value))}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                        <MenuItem key={num} value={num}>{num}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </label>

                <label>
                  Columns:
                  <FormControl size="small" sx={{ minWidth: 70, ml: 1 }}>
                    <Select
                      value={settings.grid_columns}
                      onChange={(e) => handleSettingChange('grid_columns', parseInt(e.target.value))}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                        <MenuItem key={num} value={num}>{num}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </label>
              </div>
            </div>


            {/* Display Options */}
            <div className="settings-section">
              <h4>Display Options</h4>
              <div className="display-toggles">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={settings.show_comments}
                    onChange={(e) => handleSettingChange('show_comments', e.target.checked)}
                  />
                  <span>Show Comments Field</span>
                </label>
                
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={settings.show_file_name}
                    onChange={(e) => handleSettingChange('show_file_name', e.target.checked)}
                  />
                  <span>Show File Names</span>
                </label>

                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={settings.show_binary_controls}
                    onChange={(e) => handleSettingChange('show_binary_controls', e.target.checked)}
                  />
                  <span>Show Binary Controls (Grid Mode)</span>
                </label>
              </div>
            </div>

            {/* Focus Mode Settings */}
            <div className="settings-section">
              <h4>Focus Mode Settings</h4>
              <div className="display-toggles">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={settings.focus_mode_autoplay}
                    onChange={(e) => handleSettingChange('focus_mode_autoplay', e.target.checked)}
                  />
                  <span>Auto-play clips in focus mode</span>
                </label>
                
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={settings.keyboard_shortcuts_enabled}
                    onChange={(e) => handleSettingChange('keyboard_shortcuts_enabled', e.target.checked)}
                  />
                  <span>Enable keyboard shortcuts</span>
                </label>
              </div>
              
              <div className="focus-size-settings">
                <label>
                  Focus View Size:
                  <FormControl size="small" sx={{ minWidth: 180, ml: 1 }}>
                    <Select
                      value={settings.focus_size}
                      onChange={(e) => handleSettingChange('focus_size', e.target.value)}
                    >
                      <MenuItem value="small">Small (600px wide)</MenuItem>
                      <MenuItem value="medium">Medium (900px wide)</MenuItem>
                      <MenuItem value="large">Large (full width)</MenuItem>
                    </Select>
                  </FormControl>
                </label>
              </div>
            </div>

            {/* Image Resize Settings */}
            <div className="settings-section">
              <h4>Image Resize Settings</h4>
              <div className="display-toggles">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={settings.resize_images}
                    onChange={(e) => handleSettingChange('resize_images', e.target.checked)}
                  />
                  <span>Resize Images</span>
                </label>
              </div>
              
              {settings.resize_images && (
                <div className="spectrogram-settings">
                  <label>
                    Image Width (px):
                    <input
                      type="number"
                      value={localImageWidth}
                      onChange={(e) => setLocalImageWidth(parseInt(e.target.value) || 0)}
                      onBlur={(e) => handleTextFieldChange('image_width', parseInt(e.target.value) || 0)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleTextFieldChange('image_width', parseInt(e.target.value) || 0);
                        }
                      }}
                      min="50"
                      max="2000"
                      step="10"
                    />
                  </label>
                  
                  <label>
                    Image Height (px):
                    <input
                      type="number"
                      value={localImageHeight}
                      onChange={(e) => setLocalImageHeight(parseInt(e.target.value) || 0)}
                      onBlur={(e) => handleTextFieldChange('image_height', parseInt(e.target.value) || 0)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleTextFieldChange('image_height', parseInt(e.target.value) || 0);
                        }
                      }}
                      min="50"
                      max="2000"
                      step="10"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Spectrogram Settings */}
            <div className="settings-section">
              <h4>Spectrogram Settings</h4>
              <div className="spectrogram-settings">
                <label>
                  Window Size:
                  <FormControl size="small" sx={{ minWidth: 100, ml: 1 }}>
                    <Select
                      value={settings.spec_window_size}
                      onChange={(e) => handleSettingChange('spec_window_size', parseInt(e.target.value))}
                    >
                      <MenuItem value={256}>256</MenuItem>
                      <MenuItem value={512}>512</MenuItem>
                      <MenuItem value={1024}>1024</MenuItem>
                      <MenuItem value={2048}>2048</MenuItem>
                    </Select>
                  </FormControl>
                </label>

                <label>
                  Colormap:
                  <FormControl size="small" sx={{ minWidth: 180, ml: 1 }}>
                    <Select
                      value={settings.spectrogram_colormap}
                      onChange={(e) => handleSettingChange('spectrogram_colormap', e.target.value)}
                    >
                      {colormapOptions.map(option => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </label>
              </div>
              
              {/* dB Range Slider - Full Width */}
              <div className="db-range-full-width">
                <label>
                  dB Range: {settings.dB_range[0]} to {settings.dB_range[1]} dB
                  <div className="range-help-text">
                    <small>
                      💡 Higher values (closer to 0) brighten the spectrogram. 
                      Narrower range increases contrast.
                    </small>
                  </div>
                  <div className="range-slider-container" style={{ padding: '20px 10px' }}>
                    <StyledSlider
                      size="small"
                      value={settings.dB_range}
                      onChange={(e, newValue) => {
                        // Ensure minimum gap of 5 dB
                        const [newMin, newMax] = newValue;
                        if (newMax - newMin >= 5) {
                          handleSettingChange('dB_range', [newMin, newMax]);
                        }
                      }}
                      valueLabelDisplay="auto"
                      valueLabelFormat={(value) => `${value} dB`}
                      min={-120}
                      max={0}
                      step={5}
                      disableSwap
                      className="db-range-slider"
                    />
                  </div>
                </label>
              </div>
              
              <div className="spectrogram-settings">
                <label>
                  Bandpass Low (Hz):
                  <input
                    type="number"
                    value={localBandpassLow}
                    onChange={(e) => setLocalBandpassLow(parseInt(e.target.value) || 0)}
                    onBlur={(e) => handleTextFieldChange('bandpass_range', [
                      parseInt(e.target.value) || 0, 
                      settings.bandpass_range[1]
                    ])}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleTextFieldChange('bandpass_range', [
                          parseInt(e.target.value) || 0, 
                          settings.bandpass_range[1]
                        ]);
                      }
                    }}
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
                    value={localBandpassHigh}
                    onChange={(e) => setLocalBandpassHigh(parseInt(e.target.value) || 0)}
                    onBlur={(e) => handleTextFieldChange('bandpass_range', [
                      settings.bandpass_range[0], 
                      parseInt(e.target.value) || 0
                    ])}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleTextFieldChange('bandpass_range', [
                          settings.bandpass_range[0], 
                          parseInt(e.target.value) || 0
                        ]);
                      }
                    }}
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
                    value={localReferenceFreq}
                    onChange={(e) => setLocalReferenceFreq(parseInt(e.target.value) || 0)}
                    onBlur={(e) => handleTextFieldChange('reference_frequency', parseInt(e.target.value) || 0)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleTextFieldChange('reference_frequency', parseInt(e.target.value) || 0);
                      }
                    }}
                    min="100"
                    max="20000"
                    step="100"
                    disabled={!settings.show_reference_frequency}
                  />
                </label>
              </div>
              
              <div className="spectrogram-toggles">
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
            </div>
          
          {/* Simplified settings actions */}
          <div className="settings-actions">
            <button
              className="defaults-button"
              onClick={resetToDefaults}
            >
              Reset to Defaults
            </button>
          </div>

          {/* Config file management */}
          {onSaveConfig && onLoadConfig && (
            <div className="config-file-actions" style={{
              marginTop: '20px',
              paddingTop: '20px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              gap: '10px',
              flexDirection: 'column'
            }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '5px', color: 'var(--dark)' }}>
                Config File
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  className="config-button"
                  onClick={onSaveConfig}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    backgroundColor: 'var(--accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontFamily: 'Rokkitt, sans-serif'
                  }}
                >
                  💾 Save Config
                </button>
                <button
                  className="config-button"
                  onClick={onLoadConfig}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    backgroundColor: 'var(--dark-accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontFamily: 'Rokkitt, sans-serif'
                  }}
                >
                  📂 Load Config
                </button>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--medium)', marginTop: '5px' }}>
                Save/load both view and CGL settings
              </div>
            </div>
          )}
    </div>
  );
}

export default ReviewSettings;