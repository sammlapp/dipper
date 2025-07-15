import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Grid,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  LinearProgress,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  Chip
} from '@mui/material';
import {
  ExpandMore,
  PlayArrow,
  Stop,
  FolderOpen,
  Dataset
} from '@mui/icons-material';

function TrainingTab({ config, updateConfig }) {
  const [trainingData, setTrainingData] = useState([]);
  const [validationData, setValidationData] = useState([]);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [currentEpoch, setCurrentEpoch] = useState(0);
  const [trainingLogs, setTrainingLogs] = useState([]);
  const [error, setError] = useState('');

  const handleSelectTrainingData = async () => {
    try {
      const folder = await window.electronAPI.selectFolder();
      if (folder) {
        // This would scan for training data structure
        const processId = Date.now().toString();
        const result = await window.electronAPI.runPythonScript(
          '../backend/scripts/scan_training_data.py',
          [folder],
          processId
        );
        const data = JSON.parse(result.stdout);
        setTrainingData(data);
        setError('');
      }
    } catch (err) {
      setError('Failed to load training data');
    }
  };

  const handleSelectValidationData = async () => {
    try {
      const folder = await window.electronAPI.selectFolder();
      if (folder) {
        const processId = Date.now().toString();
        const result = await window.electronAPI.runPythonScript(
          '../backend/scripts/scan_training_data.py',
          [folder],
          processId
        );
        const data = JSON.parse(result.stdout);
        setValidationData(data);
        setError('');
      }
    } catch (err) {
      setError('Failed to load validation data');
    }
  };

  const handleStartTraining = async () => {
    if (trainingData.length === 0) {
      setError('Please select training data');
      return;
    }

    setIsTraining(true);
    setTrainingProgress(0);
    setCurrentEpoch(0);
    setTrainingLogs([]);
    setError('');

    try {
      const processId = Date.now().toString();
      
      // Listen for training progress
      const outputHandler = (event, data) => {
        if (data.processId === processId) {
          setTrainingLogs(prev => [...prev, data.data]);
          
          // Parse epoch progress
          const epochMatch = data.data.match(/Epoch (\d+)\/(\d+)/);
          if (epochMatch) {
            const current = parseInt(epochMatch[1]);
            const total = parseInt(epochMatch[2]);
            setCurrentEpoch(current);
            setTrainingProgress((current / total) * 100);
          }
        }
      };

      window.electronAPI.onPythonOutput(outputHandler);

      const args = [
        '--training_data', JSON.stringify(trainingData),
        '--validation_data', JSON.stringify(validationData),
        '--config', JSON.stringify(config.training)
      ];

      await window.electronAPI.runPythonScript(
        '../backend/scripts/train_model.py',
        args,
        processId
      );

      setTrainingProgress(100);
      setTrainingLogs(prev => [...prev, 'Training completed successfully!']);
      
      window.electronAPI.removePythonOutputListener(outputHandler);
      
    } catch (err) {
      setError(`Training failed: ${err.message}`);
    } finally {
      setIsTraining(false);
    }
  };

  const handleStopTraining = async () => {
    setIsTraining(false);
    setError('Training stopped by user');
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Model Training
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
              1. Training Configuration
            </Typography>
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography>Training Parameters</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Learning Rate"
                      type="number"
                      value={config.training.learning_rate}
                      onChange={(e) => updateConfig('training', { learning_rate: parseFloat(e.target.value) })}
                      fullWidth
                      inputProps={{ step: 0.0001 }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Epochs"
                      type="number"
                      value={config.training.epochs}
                      onChange={(e) => updateConfig('training', { epochs: parseInt(e.target.value) })}
                      fullWidth
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Batch Size"
                      type="number"
                      value={config.training.batch_size}
                      onChange={(e) => updateConfig('training', { batch_size: parseInt(e.target.value) })}
                      fullWidth
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Optimizer</InputLabel>
                      <Select
                        value={config.training.optimizer || 'adam'}
                        label="Optimizer"
                        onChange={(e) => updateConfig('training', { optimizer: e.target.value })}
                      >
                        <MenuItem value="adam">Adam</MenuItem>
                        <MenuItem value="sgd">SGD</MenuItem>
                        <MenuItem value="rmsprop">RMSprop</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              2. Data Augmentation
            </Typography>
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography>Augmentation Settings</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Time Shift (seconds)"
                      type="number"
                      value={config.training.time_shift || 0.1}
                      onChange={(e) => updateConfig('training', { time_shift: parseFloat(e.target.value) })}
                      fullWidth
                      inputProps={{ step: 0.01 }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Frequency Mask"
                      type="number"
                      value={config.training.freq_mask || 0.1}
                      onChange={(e) => updateConfig('training', { freq_mask: parseFloat(e.target.value) })}
                      fullWidth
                      inputProps={{ step: 0.01 }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Time Mask"
                      type="number"
                      value={config.training.time_mask || 0.1}
                      onChange={(e) => updateConfig('training', { time_mask: parseFloat(e.target.value) })}
                      fullWidth
                      inputProps={{ step: 0.01 }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      label="Gaussian Noise"
                      type="number"
                      value={config.training.gaussian_noise || 0.01}
                      onChange={(e) => updateConfig('training', { gaussian_noise: parseFloat(e.target.value) })}
                      fullWidth
                      inputProps={{ step: 0.001 }}
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
              3. Training Data
            </Typography>
            <Box sx={{ mb: 2 }}>
              <Button
                variant="outlined"
                startIcon={<Dataset />}
                onClick={handleSelectTrainingData}
                sx={{ mr: 1 }}
              >
                Select Training Data
              </Button>
              <Button
                variant="outlined"
                startIcon={<FolderOpen />}
                onClick={handleSelectValidationData}
              >
                Select Validation Data
              </Button>
            </Box>
            
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>
                  Training Data ({trainingData.length} samples)
                </Typography>
                {trainingData.length > 0 && (
                  <Box sx={{ maxHeight: 150, overflow: 'auto' }}>
                    <List dense>
                      {trainingData.slice(0, 5).map((item, index) => (
                        <ListItem key={index}>
                          <ListItemText 
                            primary={item.class_name}
                            secondary={`${item.sample_count} samples`}
                          />
                          <Chip label={item.class_name} size="small" />
                        </ListItem>
                      ))}
                      {trainingData.length > 5 && (
                        <ListItem>
                          <ListItemText primary={`... and ${trainingData.length - 5} more classes`} />
                        </ListItem>
                      )}
                    </List>
                  </Box>
                )}
              </Grid>
              
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>
                  Validation Data ({validationData.length} samples)
                </Typography>
                {validationData.length > 0 && (
                  <Box sx={{ maxHeight: 150, overflow: 'auto' }}>
                    <List dense>
                      {validationData.slice(0, 5).map((item, index) => (
                        <ListItem key={index}>
                          <ListItemText 
                            primary={item.class_name}
                            secondary={`${item.sample_count} samples`}
                          />
                          <Chip label={item.class_name} size="small" />
                        </ListItem>
                      ))}
                      {validationData.length > 5 && (
                        <ListItem>
                          <ListItemText primary={`... and ${validationData.length - 5} more classes`} />
                        </ListItem>
                      )}
                    </List>
                  </Box>
                )}
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              4. Train Model
            </Typography>
            <Box sx={{ mb: 2 }}>
              {!isTraining ? (
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<PlayArrow />}
                  onClick={handleStartTraining}
                  disabled={trainingData.length === 0}
                >
                  Start Training
                </Button>
              ) : (
                <Button
                  variant="contained"
                  color="error"
                  size="large"
                  startIcon={<Stop />}
                  onClick={handleStopTraining}
                >
                  Stop Training
                </Button>
              )}
            </Box>
            
            {isTraining && (
              <Box sx={{ mb: 2 }}>
                <LinearProgress variant="determinate" value={trainingProgress} />
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Epoch {currentEpoch} - Progress: {trainingProgress.toFixed(1)}%
                </Typography>
              </Box>
            )}
            
            {trainingLogs.length > 0 && (
              <Box sx={{ maxHeight: 300, overflow: 'auto', bgcolor: 'grey.100', p: 1 }}>
                <Typography variant="body2" component="pre" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  {trainingLogs.join('\n')}
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

export default TrainingTab;