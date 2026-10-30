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
  FormControl,
  MenuItem,
  Select,
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
  // installPlan: what installing would do, from GET /env/plan:
  // { variant, reason, mode: 'install' | 'update' | 'up_to_date', estimated_size_gb, required_free_gb, free_gb, enough_space }
  const [installPlan, setInstallPlan] = useState(null);
  // installerEnvText: advanced network settings for locked-down networks, one NAME=value per line (proxy, mirrors)
  const [installerEnvText, setInstallerEnvText] = useState(() => {
    try { return localStorage.getItem('dipper_installer_env') || ''; } catch (e) { return ''; }
  });
  const [showNetworkSettings, setShowNetworkSettings] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const loadInstallPlan = () => {
    if (!backendUrl) return;
    fetch(`${backendUrl}/env/plan?torch_variant=${torchVariant}`)
      .then(r => r.json())
      .then(plan => setInstallPlan(plan.error ? null : plan))
      .catch(() => setInstallPlan(null));
  };

  // "NAME=value" lines -> object; blank lines and # comments are ignored
  const parseInstallerEnv = () => {
    const env = {};
    installerEnvText.split('\n').forEach(line => {
      const text = line.trim();
      if (!text || text.startsWith('#')) return;
      const i = text.indexOf('=');
      if (i > 0) env[text.slice(0, i).trim()] = text.slice(i + 1).trim();
    });
    return env;
  };

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
        setEnvMessage(result.status === 'outdated' ? (result.message || '') : result.version ? `${result.version}${result.torch_variant ? ` (${result.torch_variant === 'cuda' ? 'GPU / CUDA' : 'CPU'} build)` : ''}` : result.error || '');
        if (onEnvReady) onEnvReady(result.status === 'ready');
        checkGpu();
      })
      .catch(() => setEnvStatus('missing'));
  };

  useEffect(() => {
    checkEnv();
  }, [backendUrl]); // eslint-disable-line

  useEffect(() => {
    loadInstallPlan();
  }, [backendUrl, torchVariant, envStatus]); // eslint-disable-line

  useEffect(() => {
    try { localStorage.setItem('dipper_installer_env', installerEnvText); } catch (e) { /* storage unavailable */ }
  }, [installerEnvText]);

  const startEnvInstall = () => {
    if (!backendUrl) return;
    setEnvStatus('installing');
    setEnvMessage('Starting install...');
    fetch(`${backendUrl}/env/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ torch_variant: torchVariant, installer_env: parseInstallerEnv() })
    })
      .then(r => r.json())
      .then(result => {
        if (result.status === 'error') {
          // rejected before starting (e.g. not enough disk space)
          setEnvStatus('error');
          setEnvMessage(result.error);
          return;
        }
        envPollRef.current = setInterval(() => {
          fetch(`${backendUrl}/env/install/status`)
            .then(r => r.json())
            .then(state => {
              setEnvStatus(state.stage);
              setEnvMessage(state.message || '');
              if (state.stage === 'ready') {
                clearInterval(envPollRef.current);
                checkEnv();
              } else if (state.stage === 'error') {
                // keep the install error visible; checkEnv would replace it with a bare "Not installed"
                clearInterval(envPollRef.current);
                setEnvStatus('error');
                setEnvMessage(state.message || 'Install failed');
              }
            })
            .catch(() => { });
        }, 2000);
      })
      .catch(e => { setEnvStatus('error'); setEnvMessage(String(e)); });
  };

  const removeEnv = () => {
    if (!backendUrl) return;
    setRemoving(true);
    fetch(`${backendUrl}/env/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.json())
      .then(() => { setEnvStatus('missing'); setEnvMessage(''); setConfirmRemove(false); if (onEnvReady) onEnvReady(false); checkGpu(); })
      .catch(() => { })
      .finally(() => setRemoving(false));
  };

  const envStatusColor = { ready: 'success', outdated: 'warning', missing: 'warning', broken: 'error', error: 'error', checking: 'info' }[envStatus] || 'info';
  const envStatusLabel = {
    ready: 'Installed', outdated: 'Update required', missing: 'Not installed', broken: 'Broken',
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

          <Alert severity={envStatusColor} sx={{ mb: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
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

          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ mb: 0.5 }}>PyTorch build</Typography>
            <FormControl size="small" sx={{ minWidth: 260 }} disabled={envStatus === 'installing'}>
              <Select value={torchVariant} onChange={(e) => setTorchVariant(e.target.value)}>
                <MenuItem value="auto">Auto-detect GPU</MenuItem>
                <MenuItem value="cpu">CPU only</MenuItem>
                <MenuItem value="cuda">GPU (NVIDIA CUDA)</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Applies when installing. Auto uses the GPU if a compatible NVIDIA driver is found (Windows/Linux).
            </Typography>
          </Box>

          {installPlan && installPlan.mode !== 'up_to_date' && envStatus !== 'installing' && (
            <Alert severity={installPlan.enough_space ? 'info' : 'error'} sx={{ mb: 2 }}>
              {installPlan.mode === 'update' ? 'Update' : 'Install'}: {installPlan.variant === 'cuda' ? 'GPU (NVIDIA CUDA)' : 'CPU'} build
              {installPlan.mode === 'install' ? `, about ${installPlan.estimated_size_gb} GB of disk space` : ''}
              {' '}({installPlan.reason}). {installPlan.free_gb} GB free
              {installPlan.enough_space ? '.' : `, but at least ${installPlan.required_free_gb} GB is needed.`}
            </Alert>
          )}

          <Box sx={{ mb: 2 }}>
            <Button size="small" onClick={() => setShowNetworkSettings(v => !v)}>
              {showNetworkSettings ? 'Hide' : 'Show'} advanced network settings
            </Button>
            {showNetworkSettings && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  For networks that need a proxy or mirror. One NAME=value per line. Allowed: HTTPS_PROXY, HTTP_PROXY, ALL_PROXY, NO_PROXY,
                  SSL_CERT_FILE, SSL_CERT_DIR, UV_DEFAULT_INDEX, UV_INDEX, UV_PYTHON_INSTALL_MIRROR, UV_HTTP_TIMEOUT.
                </Typography>
                <TextField
                  multiline
                  minRows={3}
                  fullWidth
                  size="small"
                  value={installerEnvText}
                  onChange={(e) => setInstallerEnvText(e.target.value)}
                  placeholder={'HTTPS_PROXY=http://proxy.example.edu:8080'}
                  disabled={envStatus === 'installing'}
                />
              </Box>
            )}
          </Box>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button variant="outlined" onClick={checkEnv} disabled={envStatus === 'installing'}>
              Check
            </Button>
            <Button
              variant="contained"
              onClick={startEnvInstall}
              disabled={envStatus === 'ready' || envStatus === 'installing' || (installPlan !== null && !installPlan.enough_space)}
            >
              {envStatus === 'missing' || envStatus === 'unknown' ? 'Download and Install' : envStatus === 'outdated' ? 'Update' : 'Re-install'}
            </Button>
            {removing ? (
              <Button variant="outlined" color="error" disabled>
                Removing...
              </Button>
            ) : confirmRemove ? (
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
