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
  MenuItem,
  Switch,
  Tooltip,
  CircularProgress
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useDarkMode } from '../hooks/useDarkMode';
import { useBackendUrl } from '../hooks/useBackendUrl';

function SettingsTab({ onEnvReady }) {
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(1);
  const [exemptExtractionTasks, setExemptExtractionTasks] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const { darkMode, set: setDarkMode } = useDarkMode();
  const backendUrl = useBackendUrl();

  // ML environment state
  // envStatus: 'checking' | 'ready' | 'missing' | 'broken' | 'installing' | 'error'
  const [envStatus, setEnvStatus] = useState('checking');
  const [envMessage, setEnvMessage] = useState('');
  // torchVariant: which PyTorch build to install: 'auto' (use the GPU if a compatible NVIDIA driver is found) | 'cpu' | 'cuda'
  const [torchVariant, setTorchVariant] = useState('auto');
  const envPollRef = React.useRef(null);
  // gpuStatus: null while loading, else { level: 'ok' | 'info' | 'warning', summary, detail } from GET /env/gpu
  const [gpuStatus, setGpuStatus] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const checkGpu = () => {
    if (!backendUrl) return;
    setGpuStatus(null);
    fetch(`${backendUrl}/env/gpu`)
      .then(r => r.json())
      .then(result => setGpuStatus(result.error
        ? { level: 'warning', summary: 'Could not check GPU', detail: result.error }
        : result))
      .catch(e => setGpuStatus({ level: 'warning', summary: 'Could not check GPU', detail: String(e) }));
  };

  const checkEnv = () => {
    if (!backendUrl) return;
    fetch(`${backendUrl}/env/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ env_path: null }) })
      .then(r => r.json())
      .then(result => {
        setEnvStatus(result.status);
        setEnvMessage(result.version ? `${result.version}${result.torch_variant ? ` (${result.torch_variant === 'cuda' ? 'GPU / CUDA' : 'CPU'} build)` : ''}` : result.error || '');
        if (onEnvReady) onEnvReady(result.status === 'ready');
        checkGpu();
      })
      .catch(() => setEnvStatus('missing'));
  };

  useEffect(() => {
    checkEnv();
  }, [backendUrl]); // eslint-disable-line

  const startEnvInstall = () => {
    if (!backendUrl) return;
    setEnvStatus('installing');
    setEnvMessage('Starting install...');
    fetch(`${backendUrl}/env/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ torch_variant: torchVariant }) })
      .catch(() => { });
    envPollRef.current = setInterval(() => {
      fetch(`${backendUrl}/env/install/status`)
        .then(r => r.json())
        .then(state => {
          setEnvStatus(state.stage);
          setEnvMessage(state.message || '');
          if (state.stage === 'ready' || state.stage === 'error') {
            clearInterval(envPollRef.current);
            checkEnv();
          }
        })
        .catch(() => { });
    }, 2000);
  };

  const removeEnv = () => {
    if (!backendUrl) return;
    fetch(`${backendUrl}/env/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.json())
      .then(() => { setEnvStatus('missing'); setEnvMessage(''); setConfirmRemove(false); if (onEnvReady) onEnvReady(false); checkGpu(); })
      .catch(() => { });
  };

  const envStatusColor = { ready: 'success', missing: 'warning', broken: 'error', error: 'error', checking: 'info' }[envStatus] || 'info';
  const envStatusLabel = {
    ready: 'Installed', missing: 'Not installed', broken: 'Broken',
    installing: 'Installing...', error: 'Error', checking: 'Checking...',
  }[envStatus] || envStatus;

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
              sx={{
                '& .MuiFormHelperText-root': {
                  color: 'var(--text-secondary)'
                }
              }}
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
                // icon={<LightModeIcon fontSize="small" />}
                // checkedIcon={<DarkModeIcon fontSize="small" />}
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

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            ML Environment
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The ML environment is required for inference, training, and extraction tasks. It is downloaded on first install (about 3 GB for the CPU build, 6-9 GB for the GPU build on Windows/Linux).
          </Typography>
          <Divider sx={{ my: 2 }} />

          <Alert severity={envStatusColor} sx={{ mb: 2 }}>
            <strong>Status: {envStatusLabel}</strong>
            {envMessage ? ` — ${envMessage}` : ''}
          </Alert>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            {gpuStatus === null ? (
              <>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">Checking GPU...</Typography>
              </>
            ) : (
              <Tooltip title={gpuStatus.detail} arrow>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'help' }}>
                  {gpuStatus.level === 'ok' && <CheckCircleOutlineIcon color="success" fontSize="small" />}
                  {gpuStatus.level === 'warning' && <WarningAmberIcon color="warning" fontSize="small" />}
                  {gpuStatus.level === 'info' && <InfoOutlinedIcon color="action" fontSize="small" />}
                  <Typography variant="body2">{gpuStatus.summary}</Typography>
                </Box>
              </Tooltip>
            )}
          </Box>

          {envStatus === 'installing' && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Downloading and installing the ML environment. This may take several minutes...
            </Alert>
          )}

          <TextField
            select
            size="small"
            label="PyTorch build"
            value={torchVariant}
            onChange={(e) => setTorchVariant(e.target.value)}
            disabled={envStatus === 'installing'}
            helperText="Applies when installing. Auto uses the GPU if a compatible NVIDIA driver is found (Windows/Linux)."
            sx={{ mb: 2, minWidth: 260 }}
          >
            <MenuItem value="auto">Auto-detect GPU</MenuItem>
            <MenuItem value="cpu">CPU only</MenuItem>
            <MenuItem value="cuda">GPU (NVIDIA CUDA)</MenuItem>
          </TextField>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button variant="outlined" onClick={checkEnv} disabled={envStatus === 'installing'}>
              Check
            </Button>
            <Button
              variant="contained"
              onClick={startEnvInstall}
              disabled={envStatus === 'ready' || envStatus === 'installing'}
            >
              {envStatus === 'missing' || envStatus === 'unknown' ? 'Download and Install' : 'Re-install'}
            </Button>
            {confirmRemove ? (
              <>
                <Button variant="contained" color="error" onClick={removeEnv}>
                  Confirm Remove
                </Button>
                <Button variant="outlined" onClick={() => setConfirmRemove(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="outlined"
                color="error"
                onClick={() => setConfirmRemove(true)}
                disabled={envStatus !== 'ready' && envStatus !== 'broken'}
              >
                Remove
              </Button>
            )}
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Debugging
          </Typography>
          <Divider sx={{ my: 2 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Download the backend server log to share with developers when reporting issues.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={() => {
              const a = document.createElement('a');
              a.href = `${backendUrl}/debug/log`;
              a.click();
            }}
          >
            Download Debug Log
          </Button>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            About
          </Typography>
          <Divider sx={{ my: 2 }} />
          <Typography variant="body2" color="text.secondary">
            <strong>Version:</strong> {process.env.REACT_APP_VERSION || require('../../package.json').version}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            <strong>Backend:</strong> {backendUrl || 'connecting…'}
          </Typography>
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
