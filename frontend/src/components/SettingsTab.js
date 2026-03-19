import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Button,
  Alert,
  Divider,
  Switch
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { useDarkMode } from '../hooks/useDarkMode';

/**
 * Settings Tab - Global application configuration
 *
 * Currently supports:
 * - Max concurrent background tasks
 * - Extraction task exemption from concurrency limit
 */
function SettingsTab() {
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(1);
  const [exemptExtractionTasks, setExemptExtractionTasks] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const { darkMode, set: setDarkMode } = useDarkMode();

  // Load settings from localStorage on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = () => {
    try {
      const savedSettings = localStorage.getItem('dipper_settings');
      if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        setMaxConcurrentTasks(settings.maxConcurrentTasks ?? 1);
        setExemptExtractionTasks(settings.exemptExtractionTasks ?? false);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const saveSettings = () => {
    try {
      const settings = {
        maxConcurrentTasks,
        exemptExtractionTasks
      };
      localStorage.setItem('dipper_settings', JSON.stringify(settings));

      // Dispatch custom event to notify TaskManager of settings change
      window.dispatchEvent(new CustomEvent('settingsChanged', { detail: settings }));

      setSaveMessage({ type: 'success', text: 'Settings saved successfully!' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveMessage({ type: 'error', text: 'Failed to save settings' });
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const resetToDefaults = () => {
    setMaxConcurrentTasks(1);
    setExemptExtractionTasks(false);
    setSaveMessage({ type: 'info', text: 'Settings reset to defaults (not saved yet)' });
    setTimeout(() => setSaveMessage(null), 3000);
  };

  const handleMaxConcurrentChange = (e) => {
    const value = parseInt(e.target.value, 10);
    if (value >= 1 && value <= 10) {
      setMaxConcurrentTasks(value);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: 'auto' }}>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Configure global application settings
      </Typography>

      {saveMessage && (
        <Alert severity={saveMessage.type} sx={{ mb: 3 }}>
          {saveMessage.text}
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Task Execution
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Control how many background tasks can run simultaneously
          </Typography>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ mb: 3 }}>
            <TextField
              label="Max Concurrent Background Tasks"
              type="number"
              value={maxConcurrentTasks}
              onChange={handleMaxConcurrentChange}
              inputProps={{
                min: 1,
                max: 64,
                step: 1
              }}
              helperText="Number of inference/training/extraction tasks that can run at the same time (1-64)"
              fullWidth
              variant="outlined"
            />
          </Box>

          <FormGroup>
            <FormControlLabel
              control={
                <Checkbox
                  checked={exemptExtractionTasks}
                  onChange={(e) => setExemptExtractionTasks(e.target.checked)}
                />
              }
              label="Do not count extraction tasks when limiting concurrent tasks"
            />
            <Typography variant="caption" color="text.secondary" sx={{ ml: 4, mt: -1 }}>
              When enabled, extraction tasks run without counting toward the concurrent task limit,
              allowing unlimited extraction tasks to run alongside inference/training tasks.
            </Typography>
          </FormGroup>

          <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={saveSettings}
            >
              Save Settings
            </Button>
            <Button
              variant="outlined"
              startIcon={<RestoreIcon />}
              onClick={resetToDefaults}
            >
              Reset to Defaults
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Appearance
          </Typography>
          <Divider sx={{ my: 2 }} />
          <FormGroup>
            <FormControlLabel
              control={
                <Switch
                  checked={darkMode}
                  onChange={(e) => setDarkMode(e.target.checked)}
                  icon={<LightModeIcon fontSize="small" />}
                  checkedIcon={<DarkModeIcon fontSize="small" />}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {darkMode ? <DarkModeIcon fontSize="small" /> : <LightModeIcon fontSize="small" />}
                  <Typography variant="body2">{darkMode ? 'Dark Mode' : 'Light Mode'}</Typography>
                </Box>
              }
            />
          </FormGroup>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            About Concurrent Tasks
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            <strong>Max Concurrent Tasks:</strong> This setting controls how many background tasks
            can run simultaneously. Each task spawns a separate Python process that uses significant
            RAM and CPU resources. Training and inference tasks may also use GPU if available.
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph sx={{ mt: 2 }}>
            <strong>Extraction Task Exemption:</strong> Extraction tasks (creating annotation CSVs)
            are typically less resource-intensive than inference or training. Enabling this option
            allows extraction tasks to run without being counted in the concurrent task limit.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}

export default SettingsTab;
