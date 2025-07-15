import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Grid,
  Paper,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  LinearProgress,
  Alert,
  Chip,
  List,
  ListItem,
  ListItemText,
  IconButton
} from '@mui/material';
import {
  ExpandMore,
  PlayArrow,
  Stop,
  FolderOpen,
  AudioFile,
  Save,
  Delete
} from '@mui/icons-material';

const AVAILABLE_MODELS = {
  'BirdNET': 'Global bird species classification (TensorFlow)',
  'Perch': 'Global bird species classification (TensorFlow)',
  'HawkEars': 'HawkEars Canadian bird classification CNN v0.1.0 (PyTorch)',
  'RanaSierraeCNN': 'CNN trained to detect Rana sierrae calls (PyTorch)',
};

function InferenceTab({ config, updateConfig }) {
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [outputFile, setOutputFile] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');

  const handleSelectFiles = async () => {
    try {
      const files = await window.electronAPI.selectFiles();
      setSelectedFiles(files);
      setError('');
    } catch (err) {
      setError('Failed to select files');
    }
  };

  const handleSelectFolder = async () => {
    try {
      const folder = await window.electronAPI.selectFolder();
      if (folder) {
        // This would need to be implemented in the backend to scan for audio files
        const processId = Date.now().toString();
        const result = await window.electronAPI.runPythonScript(
          '../backend/scripts/scan_folder.py',
          [folder],
          processId
        );
        const files = JSON.parse(result.stdout);
        setSelectedFiles(files);
        setError('');
      }
    } catch (err) {
      setError('Failed to scan folder');
    }
  };

  const handleSelectOutputFile = async () => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const defaultName = `${selectedModel}_predictions_${timestamp}.csv`;
      const file = await window.electronAPI.saveFile(defaultName);
      if (file) {
        setOutputFile(file);
      }
    } catch (err) {
      setError('Failed to select output file');
    }
  };

  const handleRunInference = async () => {
    if (!selectedModel || selectedFiles.length === 0) {
      setError('Please select a model and files');
      return;
    }

    setIsRunning(true);
    setProgress(0);
    setLogs([]);
    setError('');

    try {
      const processId = Date.now().toString();
      
      // Listen for Python output
      const outputHandler = (event, data) => {
        if (data.processId === processId) {
          setLogs(prev => [...prev, data.data]);
          // Parse progress if available
          if (data.data.includes('Progress:')) {
            const match = data.data.match(/Progress:\s*(\d+)%/);
            if (match) {
              setProgress(parseInt(match[1]));
            }
          }
        }
      };

      window.electronAPI.onPythonOutput(outputHandler);

      const args = [
        '--model', selectedModel,
        '--files', JSON.stringify(selectedFiles),
        '--output', outputFile || '',
        '--config', JSON.stringify(config.inference)
      ];

      await window.electronAPI.runPythonScript(
        '../backend/scripts/inference.py',
        args,
        processId
      );

      setProgress(100);
      setLogs(prev => [...prev, 'Inference completed successfully!']);
      
      window.electronAPI.removePythonOutputListener(outputHandler);
      
    } catch (err) {
      setError(`Inference failed: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleStopInference = async () => {
    // Implementation would need process tracking
    setIsRunning(false);
    setError('Inference stopped by user');
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Species Detection Inference
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              1. Select Model
            </Typography>
            <FormControl fullWidth>
              <InputLabel>Model</InputLabel>
              <Select
                value={selectedModel}
                label="Model"
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                {Object.entries(AVAILABLE_MODELS).map(([name, description]) => (
                  <MenuItem key={name} value={name}>
                    <Box>
                      <Typography variant="body1">{name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {description}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              2. Configure Settings
            </Typography>
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography>Inference Settings</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Clip Overlap (seconds)"
                      type="number"
                      value={config.inference.clip_overlap}
                      onChange={(e) => updateConfig('inference', { clip_overlap: parseFloat(e.target.value) })}
                      fullWidth
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Batch Size"
                      type="number"
                      value={config.inference.batch_size}
                      onChange={(e) => updateConfig('inference', { batch_size: parseInt(e.target.value) })}
                      fullWidth
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Num Workers"
                      type="number"
                      value={config.inference.num_workers}
                      onChange={(e) => updateConfig('inference', { num_workers: parseInt(e.target.value) })}
                      fullWidth
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Prediction Threshold"
                      type="number"
                      value={config.prediction_threshold}
                      onChange={(e) => updateConfig('', { prediction_threshold: parseFloat(e.target.value) })}
                      fullWidth
                    />
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              3. Select Audio Files
            </Typography>
            <Box sx={{ mb: 2 }}>
              <Button
                variant="outlined"
                startIcon={<AudioFile />}
                onClick={handleSelectFiles}
                sx={{ mr: 1 }}
              >
                Select Files
              </Button>
              <Button
                variant="outlined"
                startIcon={<FolderOpen />}
                onClick={handleSelectFolder}
              >
                Select Folder
              </Button>
            </Box>
            
            <Typography variant="body2" sx={{ mb: 1 }}>
              Selected files: {selectedFiles.length}
            </Typography>
            
            {selectedFiles.length > 0 && (
              <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
                <List dense>
                  {selectedFiles.slice(0, 10).map((file, index) => (
                    <ListItem key={index}>
                      <ListItemText 
                        primary={file.split('/').pop()} 
                        secondary={file}
                      />
                      <IconButton onClick={() => removeFile(index)} size="small">
                        <Delete />
                      </IconButton>
                    </ListItem>
                  ))}
                  {selectedFiles.length > 10 && (
                    <ListItem>
                      <ListItemText primary={`... and ${selectedFiles.length - 10} more files`} />
                    </ListItem>
                  )}
                </List>
              </Box>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              4. Output Location
            </Typography>
            <Box sx={{ mb: 2 }}>
              <Button
                variant="outlined"
                startIcon={<Save />}
                onClick={handleSelectOutputFile}
              >
                Select Output File
              </Button>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {outputFile || 'No output file selected'}
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              5. Run Inference
            </Typography>
            <Box sx={{ mb: 2 }}>
              {!isRunning ? (
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<PlayArrow />}
                  onClick={handleRunInference}
                  disabled={!selectedModel || selectedFiles.length === 0}
                >
                  Run Inference
                </Button>
              ) : (
                <Button
                  variant="contained"
                  color="error"
                  size="large"
                  startIcon={<Stop />}
                  onClick={handleStopInference}
                >
                  Stop Inference
                </Button>
              )}
            </Box>
            
            {isRunning && (
              <Box sx={{ mb: 2 }}>
                <LinearProgress variant="determinate" value={progress} />
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Progress: {progress}%
                </Typography>
              </Box>
            )}
            
            {logs.length > 0 && (
              <Box sx={{ maxHeight: 200, overflow: 'auto', bgcolor: 'grey.100', p: 1 }}>
                <Typography variant="body2" component="pre" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  {logs.join('\n')}
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

export default InferenceTab;