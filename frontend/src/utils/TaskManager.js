/**
 * Task Management System for Inference and Training Tasks
 * Handles task CRUD operations, persistence, and queue management
 */

import { v4 as uuidv4 } from 'uuid';
import { generateUniqueFolderName } from './fileOperations';
import { getBackendUrl } from './backendConfig';

export const TASK_STATUS = {
  UNSTARTED: 'unstarted',
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

export const TASK_TYPE = {
  INFERENCE: 'inference',
  TRAINING: 'training',
  EXTRACTION: 'extraction'
};

class TaskManager {
  constructor() {
    this.tasks = new Map();
    this.queue = [];
    this.runningTasks = new Set();
    this.listeners = new Set();
    this.loadSettings();
    this.loadTasks();

    window.addEventListener('settingsChanged', (event) => {
      this.loadSettings();
      this.processQueue();
    });
  }

  loadSettings() {
    try {
      const savedSettings = localStorage.getItem('dipper_settings');
      if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        this.maxConcurrentTasks = settings.maxConcurrentTasks ?? 1;
        this.exemptExtractionTasks = settings.exemptExtractionTasks ?? false;
      } else {
        this.maxConcurrentTasks = 1;
        this.exemptExtractionTasks = false;
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      this.maxConcurrentTasks = 1;
      this.exemptExtractionTasks = false;
    }
  }

  // Task CRUD Operations
  createTask(config, name = null, taskType = null) {
    // Determine task type from config or parameter
    const type = taskType || this.determineTaskType(config);

    const task = {
      id: uuidv4(),
      name: name || this.generateTaskName(config, type),
      type: type,
      status: TASK_STATUS.UNSTARTED,
      config: { ...config },
      created: Date.now(),
      started: null,
      completed: null,
      progress: '',
      result: null,
      processId: null,
      systemPid: null
    };

    this.tasks.set(task.id, task);
    this.saveTasks();
    this.notifyListeners('taskCreated', task);
    return task;
  }

  determineTaskType(config) {
    // Check task type from config
    if (config.task_type === 'extraction') {
      return TASK_TYPE.EXTRACTION;
    }

    // Check if config has training-specific properties
    if (config.class_list !== undefined ||
      config.fully_annotated_files !== undefined ||
      config.single_class_annotations !== undefined) {
      return TASK_TYPE.TRAINING;
    }
    return TASK_TYPE.INFERENCE;
  }

  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  getAllTasks() {
    return Array.from(this.tasks.values()).sort((a, b) => b.created - a.created);
  }

  updateTask(taskId, updates) {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    Object.assign(task, updates);
    this.tasks.set(taskId, task);
    this.saveTasks();
    this.notifyListeners('taskUpdated', task);
    return task;
  }

  deleteTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Can't delete running tasks
    if (task.status === TASK_STATUS.RUNNING) {
      return false;
    }

    // Remove from queue if present
    this.queue = this.queue.filter(id => id !== taskId);

    this.tasks.delete(taskId);
    this.saveTasks();
    this.notifyListeners('taskDeleted', { id: taskId });
    return true;
  }

  // Queue Management
  queueTask(taskId) {
    const task = this.getTask(taskId);
    if (!task || task.status === TASK_STATUS.RUNNING) return false;

    // Check if this is an extraction task and exemption is enabled
    const isExemptedExtraction =
      this.exemptExtractionTasks &&
      task.type === TASK_TYPE.EXTRACTION;

    if (isExemptedExtraction) {
      // Start extraction tasks immediately without queueing
      this.updateTask(taskId, {
        status: TASK_STATUS.RUNNING,
        progress: 'Starting immediately (extraction tasks exempted)...'
      });
      this.runningTasks.add(taskId);
      this.executeTask(taskId);
      return true;
    }

    // Update task status to queued
    this.updateTask(taskId, {
      status: TASK_STATUS.QUEUED,
      progress: 'Queued for execution'
    });

    // Add to queue if not already present
    if (!this.queue.includes(taskId)) {
      this.queue.push(taskId);
    }

    this.processQueue();

    return true;
  }

  getCountedRunningTasks() {
    if (this.exemptExtractionTasks) {
      return Array.from(this.runningTasks).filter(taskId => {
        const task = this.getTask(taskId);
        return task && task.type !== TASK_TYPE.EXTRACTION;
      }).length;
    } else {
      return this.runningTasks.size;
    }
  }

  async processQueue() {
    while (this.queue.length > 0) {
      const countedRunning = this.getCountedRunningTasks();
      if (countedRunning >= this.maxConcurrentTasks) {
        break;
      }

      const taskId = this.queue.shift();
      const task = this.getTask(taskId);

      if (!task || task.status === TASK_STATUS.CANCELLED) {
        continue;
      }

      this.runningTasks.add(taskId);
      this.executeTask(taskId);
    }
  }

  async executeTask(taskId) {
    const task = this.getTask(taskId);
    if (!task) return;

    try {
      // Update task to running status with appropriate start message
      const startMessage = task.type === TASK_TYPE.TRAINING ? 'Starting training...' : 'Starting inference...';
      this.updateTask(taskId, {
        status: TASK_STATUS.RUNNING,
        started: Date.now(),
        progress: startMessage
      });

      // Execute based on task type
      let result;
      if (task.type === TASK_TYPE.TRAINING) {
        result = await this.runTraining(task);
      } else if (task.type === TASK_TYPE.EXTRACTION) {
        result = await this.runExtraction(task);
      } else {
        result = await this.runInference(task);
      }

      // Check if task was cancelled
      if (result && result.cancelled) {
        // Task was cancelled, update accordingly
        this.updateTask(taskId, {
          status: TASK_STATUS.CANCELLED,
          completed: Date.now(),
          progress: 'Cancelled by user',
          result: result
        });
      } else {
        // Update task with results
        this.updateTask(taskId, {
          status: TASK_STATUS.COMPLETED,
          completed: Date.now(),
          progress: 'Completed successfully',
          result: result
        });
      }

    } catch (error) {
      // Update task with error
      this.updateTask(taskId, {
        status: TASK_STATUS.FAILED,
        completed: Date.now(),
        progress: 'Failed',
        result: { error: error.message }
      });
    } finally {
      // Clear current task and process next in queue
      this.runningTasks.delete(taskId);
      this.notifyListeners('taskCompleted', { taskId });
      setTimeout(() => this.processQueue(), 100);
    }
  }

  async runInference(task) {
    const config = task.config;
    const backendUrl = await getBackendUrl();

    // Generate unique process ID for this task
    const processId = `task_${task.id}_${Date.now()}`;

    // Update task with process ID
    this.updateTask(task.id, { processId });

    try {
      // Update progress
      this.updateTask(task.id, { progress: 'Preparing configuration...' });

      // If resuming a task, use the existing job folder
      // Otherwise, create a new job folder with unique name
      let jobFolder;
      if (config.job_folder) {
        // Resume mode: use existing job folder
        jobFolder = config.job_folder;
        this.updateTask(task.id, { progress: 'Resuming task in existing folder...' });
      } else {
        // Normal mode: create new unique job folder
        const jobFolderName = await this.generateUniqueJobFolderName(config.output_dir, task.name);
        jobFolder = config.output_dir ? `${config.output_dir}/${jobFolderName}` : '';
      }

      const configJsonPath = jobFolder ? `${jobFolder}/${task.name}_${task.id}.json` : '';
      const logFilePath = jobFolder ? `${jobFolder}/inference_log.txt` : '';

      // Create temporary config file
      const tempConfigPath = `/tmp/inference_config_${processId}.json`;
      const configData = {
        task_name: task.name,
        model_source: config.model_source || 'bmz',
        model: config.model,
        files: config.files || [],
        file_globbing_patterns: config.file_globbing_patterns || [],
        file_list: config.file_list || '',
        file_selection_mode: config.file_selection_mode || 'files',
        selected_extensions: config.selected_extensions || ['wav', 'mp3', 'flac'],
        glob_patterns_text: config.glob_patterns_text || '',
        output_dir: config.output_dir,
        job_folder: jobFolder,
        config_output_path: configJsonPath,
        log_file_path: logFilePath,
        split_by_subfolder: config.split_by_subfolder || false,
        inference_settings: {
          clip_overlap: config.overlap || 0.0,
          batch_size: config.batch_size || 1,
          num_workers: config.worker_count || 1
        },
        sparse_outputs: {
          enabled: config.sparse_outputs_enabled || false,
          threshold: config.sparse_save_threshold || -3.0
        },
        python_environment: {
          use_custom: config.use_custom_python_env || false,
          custom_path: config.custom_python_env_path || ''
        },
        testing_mode: {
          enabled: config.testing_mode_enabled || false,
          subset_size: config.subset_size || 10
        }
      };

      // Save temporary config file using HTTP API
      const saveResponse = await fetch(`${backendUrl}/config/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config_data: configData,
          output_path: tempConfigPath
        })
      });

      const saveResult = await saveResponse.json();
      if (saveResult.status !== 'success') {
        throw new Error(`Failed to save configuration: ${saveResult.error}`);
      }

      // Update progress
      this.updateTask(task.id, { progress: 'Setting up ML environment...' });

      // Get environment path - use custom environment if specified, otherwise null for default
      let envPath = null;
      if (config.use_custom_python_env && config.custom_python_env_path) {
        envPath = config.custom_python_env_path;
      }
      // If envPath is null, backend will use default cache directory and auto-download if needed

      // Update progress
      this.updateTask(task.id, { progress: 'Running inference...' });

      // Start inference via HTTP API (now returns immediately with job ID)
      const inferenceResponse = await fetch(`${backendUrl}/inference/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config_path: tempConfigPath,
          env_path: envPath,
          job_id: processId
        })
      });

      const startResult = await inferenceResponse.json();

      if (startResult.status === 'started') {
        const jobId = startResult.job_id;
        this.updateTask(task.id, { progress: 'Inference running...', processId: jobId });

        // Poll for completion
        const finalResult = await this.pollInferenceStatus(jobId, task.id, backendUrl);

        if (finalResult.status === 'completed') {
          return {
            success: true,
            output_dir: configData.output_dir,
            job_folder: configData.job_folder,
            config_path: configData.config_output_path,
            total_files: config.files.length || config.file_globbing_patterns.length || (config.file_list ? 1 : 0),
            message: 'Inference completed successfully',
            job_id: jobId
          };
        } else if (finalResult.status === 'cancelled') {
          return {
            success: false,
            cancelled: true,
            message: 'Inference was cancelled by user',
            job_id: jobId
          };
        } else {
          // Show detailed error information
          let errorMessage = finalResult.error || 'Inference failed';

          if (finalResult.stderr) {
            errorMessage += '\n\nError output:\n' + finalResult.stderr;
          }

          if (finalResult.stdout) {
            errorMessage += '\n\nStandard output:\n' + finalResult.stdout;
          }

          throw new Error(errorMessage);
        }
      } else {
        throw new Error(startResult.error || 'Failed to start inference');
      }
    } catch (error) {
      throw new Error(`Inference failed: ${error.message}`);
    }
  }

  async pollInferenceStatus(jobId, taskId, backendUrl, pollInterval = 2000) {
    /**
     * Poll inference status until completion or failure
     * @param {string} jobId - Backend job ID
     * @param {string} taskId - Frontend task ID
     * @param {string} backendUrl - Backend server URL
     * @param {number} pollInterval - Polling interval in milliseconds
     * @returns {Promise} Final result when inference completes
     */
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const response = await fetch(`${backendUrl}/inference/status/${jobId}`);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const result = await response.json();
          console.log('[TaskManager] Inference status poll result:', result);

          // Update task progress based on status
          if (result.status === 'running') {
            // Store system PID if available
            const updates = {};

            // Use detailed status message from .status file if available
            if (result.message) {
              console.log('[TaskManager] Using detailed status message:', result.message);
              updates.progress = result.message;
            } else {
              updates.progress = 'Inference running...';
            }

            // Add progress percentage if available
            if (result.progress !== undefined) {
              updates.progressPercent = result.progress;
            }

            if (result.system_pid) {
              updates.systemPid = result.system_pid;
            }

            this.updateTask(taskId, updates);
            // Continue polling
            setTimeout(poll, pollInterval);
          } else if (result.status === 'completed') {
            this.updateTask(taskId, { progress: 'Inference completed' });
            resolve(result);
          } else if (result.status === 'failed') {
            this.updateTask(taskId, { progress: 'Inference failed' });
            resolve(result); // Resolve with failed status, let caller handle error
          } else if (result.status === 'cancelled') {
            this.updateTask(taskId, { progress: 'Cancelled by user' });
            resolve(result); // Resolve with cancelled status - stop polling
          } else {
            // Unknown status, treat as error
            reject(new Error(`Unknown inference status: ${result.status}`));
          }
        } catch (error) {
          reject(new Error(`Failed to check inference status: ${error.message}`));
        }
      };

      // Start polling
      poll();
    });
  }

  async runTraining(task) {
    const config = task.config;
    const backendUrl = await getBackendUrl();

    // Generate unique process ID for this task
    const processId = `training_${task.id}_${Date.now()}`;

    // Update task with process ID
    this.updateTask(task.id, { processId });

    try {
      // Update progress
      this.updateTask(task.id, { progress: 'Preparing training configuration...' });

      // Create job folder and output paths with unique name
      const jobFolderName = await this.generateUniqueJobFolderName(config.save_location, task.name);
      const jobFolder = config.save_location ? `${config.save_location}/${jobFolderName}` : '';
      const modelSavePath = jobFolder ? `${jobFolder}/trained_model.pth` : '';
      const configJsonPath = jobFolder ? `${jobFolder}/${task.name}_${task.id}.json` : '';
      const logFilePath = jobFolder ? `${jobFolder}/train_log.txt` : '';

      // Create temporary config file
      const tempConfigPath = `/tmp/training_config_${processId}.json`;
      const configData = {
        model: config.model || 'BirdNET',
        class_list: config.class_list || [],
        fully_annotated_files: config.fully_annotated_files || [],
        single_class_annotations: config.single_class_annotations || [],
        background_samples_file: config.background_samples_file || '',
        root_audio_folder: config.root_audio_folder || '',
        evaluation_file: config.evaluation_file || '',
        save_location: config.save_location,
        model_save_path: modelSavePath,
        job_folder: jobFolder,
        config_output_path: configJsonPath,
        log_file_path: logFilePath,
        subset_size: config.testing_mode_enabled ? config.subset_size : null,
        training_settings: {
          batch_size: config.batch_size || 32,
          num_workers: config.num_workers || 4,
          freeze_feature_extractor: config.freeze_feature_extractor !== false,
          classifier_hidden_layer_sizes: config.training_settings?.classifier_hidden_layer_sizes || null
        }
      };

      // Save temporary config file using HTTP API
      const saveResponse = await fetch(`${backendUrl}/config/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config_data: configData,
          output_path: tempConfigPath
        })
      });

      const saveResult = await saveResponse.json();
      if (saveResult.status !== 'success') {
        throw new Error(`Failed to save configuration: ${saveResult.error}`);
      }

      // Update progress
      this.updateTask(task.id, { progress: 'Setting up ML environment...' });

      // Get environment path - use custom environment if specified, otherwise null for default
      let envPath = null;
      if (config.use_custom_python_env && config.custom_python_env_path) {
        envPath = config.custom_python_env_path;
      }
      // If envPath is null, backend will use default cache directory and auto-download if needed

      // Update progress
      this.updateTask(task.id, { progress: 'Starting training...' });

      // Start training via HTTP API (returns immediately with job ID)
      const trainingResponse = await fetch(`${backendUrl}/training/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config_path: tempConfigPath,
          env_path: envPath,
          job_id: processId
        })
      });

      const startResult = await trainingResponse.json();

      if (startResult.status === 'started') {
        const jobId = startResult.job_id;
        this.updateTask(task.id, { progress: 'Training running...', processId: jobId });

        // Poll for completion
        const finalResult = await this.pollTrainingStatus(jobId, task.id, backendUrl);

        if (finalResult.status === 'completed') {
          return {
            success: true,
            model_save_path: configData.model_save_path,
            job_folder: configData.job_folder,
            config_path: configData.config_output_path,
            classes_trained: configData.class_list.length,
            message: 'Training completed successfully',
            job_id: jobId
          };
        } else if (finalResult.status === 'cancelled') {
          return {
            success: false,
            cancelled: true,
            message: 'Training was cancelled by user',
            job_id: jobId
          };
        } else {
          // Show detailed error information
          let errorMessage = finalResult.error || 'Training failed';

          if (finalResult.stderr) {
            errorMessage += '\n\nError output:\n' + finalResult.stderr;
          }

          if (finalResult.stdout) {
            errorMessage += '\n\nStandard output:\n' + finalResult.stdout;
          }

          throw new Error(errorMessage);
        }
      } else {
        throw new Error(startResult.error || 'Failed to start training');
      }
    } catch (error) {
      throw new Error(`Training failed: ${error.message}`);
    }
  }

  async pollTrainingStatus(jobId, taskId, backendUrl, pollInterval = 2000) {
    /**
     * Poll training status until completion or failure
     * @param {string} jobId - Backend job ID
     * @param {string} taskId - Frontend task ID
     * @param {string} backendUrl - Backend server URL
     * @param {number} pollInterval - Polling interval in milliseconds
     * @returns {Promise} Final result when training completes
     */
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const response = await fetch(`${backendUrl}/training/status/${jobId}`);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const result = await response.json();

          // Update task progress based on status
          if (result.status === 'running') {
            // Store system PID if available
            const updates = {};

            // Use detailed status message from .status file if available
            if (result.message) {
              updates.progress = result.message;
            } else {
              updates.progress = 'Training running...';
            }

            // Add progress percentage if available
            if (result.progress !== undefined) {
              updates.progressPercent = result.progress;
            }

            if (result.system_pid) {
              updates.systemPid = result.system_pid;
            }

            this.updateTask(taskId, updates);
            // Continue polling
            setTimeout(poll, pollInterval);
          } else if (result.status === 'completed') {
            this.updateTask(taskId, { progress: 'Training completed' });
            resolve(result);
          } else if (result.status === 'failed') {
            this.updateTask(taskId, { progress: 'Training failed' });
            resolve(result); // Resolve with failed status, let caller handle error
          } else if (result.status === 'cancelled') {
            this.updateTask(taskId, { progress: 'Cancelled by user' });
            resolve(result); // Resolve with cancelled status - stop polling
          } else {
            // Unknown status, treat as error
            reject(new Error(`Unknown training status: ${result.status}`));
          }
        } catch (error) {
          reject(new Error(`Failed to check training status: ${error.message}`));
        }
      };

      // Start polling
      poll();
    });
  }

  async runExtraction(task) {
    const config = task.config;
    const backendUrl = await getBackendUrl();

    // Generate unique process ID for this task
    const processId = `extraction_${task.id}_${Date.now()}`;

    // Update task with process ID
    this.updateTask(task.id, { processId });

    try {
      // Update progress
      this.updateTask(task.id, { progress: 'Preparing annotation configuration...' });

      // Create job folder and output paths with unique name
      const jobFolderName = await this.generateUniqueJobFolderName(config.output_dir, task.name);
      const jobFolder = config.output_dir ? `${config.output_dir}/${jobFolderName}` : '';
      const configJsonPath = jobFolder ? `${jobFolder}/${task.name}_${task.id}.json` : '';
      const logFilePath = jobFolder ? `${jobFolder}/annotation_log.txt` : '';

      // Create temporary config file
      const tempConfigPath = `/tmp/annotation_config_${processId}.json`;
      const configData = {
        predictions_folder: config.predictions_folder,
        class_list: config.class_list || [],
        stratification: config.stratification,
        filtering: config.filtering,
        extraction: config.extraction,
        output_dir: config.output_dir,
        export_audio_clips: config.export_audio_clips || false,
        clip_duration: config.clip_duration || 5.0,
        extraction_mode: config.extraction_mode || 'binary',
        job_folder: jobFolder,
        config_output_path: configJsonPath,
        log_file_path: logFilePath
      };

      // Save temporary config file using HTTP API
      const saveResponse = await fetch(`${backendUrl}/config/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config_data: configData,
          output_path: tempConfigPath
        })
      });

      const saveResult = await saveResponse.json();
      if (saveResult.status !== 'success') {
        throw new Error(`Failed to save configuration: ${saveResult.error}`);
      }

      // Update progress
      this.updateTask(task.id, { progress: 'Setting up ML environment...' });

      // Get environment path - use custom environment if specified, otherwise null for default
      let envPath = null;
      if (config.use_custom_python_env && config.custom_python_env_path) {
        envPath = config.custom_python_env_path;
      }
      // If envPath is null, backend will use default cache directory and auto-download if needed

      // Update progress
      this.updateTask(task.id, { progress: 'Creating annotation task...' });

      // Start annotation via HTTP API (returns immediately with job ID)
      const extractionResponse = await fetch(`${backendUrl}/extraction/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config_path: tempConfigPath,
          env_path: envPath,
          job_id: processId
        })
      });

      const startResult = await extractionResponse.json();

      if (startResult.status === 'started') {
        const jobId = startResult.job_id;
        this.updateTask(task.id, { progress: 'Clip selection task running...', processId: jobId });

        // Poll for completion
        const finalResult = await this.pollExtractionStatus(jobId, task.id, backendUrl);

        if (finalResult.status === 'completed') {
          return {
            success: true,
            annotation_files: finalResult.annotation_files || [],
            job_folder: configData.job_folder,
            config_path: configData.config_output_path,
            total_classes: configData.class_list.length,
            message: 'Clip extraction task completed successfully',
            job_id: jobId
          };
        } else if (finalResult.status === 'cancelled') {
          return {
            success: false,
            cancelled: true,
            message: 'Clip extraction task was cancelled by user',
            job_id: jobId
          };
        } else {
          // Show detailed error information
          let errorMessage = finalResult.error || 'Clip extraction task failed';

          if (finalResult.stderr) {
            errorMessage += '\n\nError output:\n' + finalResult.stderr;
          }

          if (finalResult.stdout) {
            errorMessage += '\n\nStandard output:\n' + finalResult.stdout;
          }

          throw new Error(errorMessage);
        }
      } else {
        throw new Error(startResult.error || 'Failed to start annotation task');
      }
    } catch (error) {
      throw new Error(`Clip extraction task failed: ${error.message}`);
    }
  }

  async pollExtractionStatus(jobId, taskId, backendUrl, pollInterval = 2000) {
    /**
     * Poll extraction status until completion or failure
     * @param {string} jobId - Backend job ID
     * @param {string} taskId - Frontend task ID
     * @param {string} backendUrl - Backend server URL
     * @param {number} pollInterval - Polling interval in milliseconds
     * @returns {Promise} Final result when extraction completes
     */
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const response = await fetch(`${backendUrl}/extraction/status/${jobId}`);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const result = await response.json();

          // Update task progress based on status
          if (result.status === 'running') {
            // Store system PID if available
            const updates = {};

            // Use detailed status message from .status file if available
            if (result.message) {
              updates.progress = result.message;
            } else {
              updates.progress = 'Clip extraction task running...';
            }

            // Add progress percentage if available
            if (result.progress !== undefined) {
              updates.progressPercent = result.progress;
            }

            if (result.system_pid) {
              updates.systemPid = result.system_pid;
            }

            this.updateTask(taskId, updates);
            // Continue polling
            setTimeout(poll, pollInterval);
          } else if (result.status === 'completed') {
            this.updateTask(taskId, { progress: 'Clip extraction task completed' });
            resolve(result);
          } else if (result.status === 'failed') {
            this.updateTask(taskId, { progress: 'Clip extraction task failed' });
            resolve(result); // Resolve with failed status, let caller handle error
          } else if (result.status === 'cancelled') {
            this.updateTask(taskId, { progress: 'Cancelled by user' });
            resolve(result); // Resolve with cancelled status - stop polling
          } else {
            // Unknown status, treat as error
            reject(new Error(`Unknown annotation status: ${result.status}`));
          }
        } catch (error) {
          reject(new Error(`Failed to check annotation status: ${error.message}`));
        }
      };

      // Start polling
      poll();
    });
  }

  async cancelTask(taskId) {
    const task = this.getTask(taskId);
    if (!task) return false;

    const backendUrl = await getBackendUrl();

    if (task.status === TASK_STATUS.RUNNING) {
      // Cancel the running process via backend API
      if (task.processId) {
        try {
          let endpoint;
          if (task.type === TASK_TYPE.TRAINING) {
            endpoint = `${backendUrl}/training/cancel/${task.processId}`;
          } else if (task.type === TASK_TYPE.EXTRACTION) {
            endpoint = `${backendUrl}/extraction/cancel/${task.processId}`;
          } else {
            endpoint = `${backendUrl}/inference/cancel/${task.processId}`;
          }

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            }
          });

          if (!response.ok) {
            console.error(`Failed to cancel ${task.type} job via backend:`, response.statusText);
          }
        } catch (error) {
          console.error(`Error cancelling ${task.type} job via backend:`, error);
        }
      }

      // Electron API fallback removed - using backend cancellation only
    }

    // Remove from queue
    this.queue = this.queue.filter(id => id !== taskId);

    // Update task status
    this.updateTask(taskId, {
      status: TASK_STATUS.CANCELLED,
      completed: Date.now(),
      progress: 'Cancelled by user'
    });

    // If this was the current task, process next
    if (this.runningTasks.has(taskId)) {
      this.runningTasks.delete(taskId);
      setTimeout(() => this.processQueue(), 100);
    }

    return true;
  }

  // Generate unique job folder name
  async generateUniqueJobFolderName(baseDir, taskName) {
    // Clean the task name for use as folder name
    const cleanedName = taskName.replace(/[^a-zA-Z0-9\-_\s]/g, '').replace(/\s+/g, '_');

    // Use file operations abstraction to generate unique folder name
    try {
      return await generateUniqueFolderName(baseDir, cleanedName);
    } catch (error) {
      console.warn('Failed to generate unique folder name via file operations, using fallback:', error);
      // Fallback: just return the cleaned name (original behavior)
      return cleanedName;
    }
  }

  // Utility Methods
  generateTaskName(config, taskType = TASK_TYPE.INFERENCE) {
    let modelName;
    if (config.model_source === 'bmz') {
      // Use model name from BMZ config
      modelName = config.model || 'Unknown';
    } else {
      modelName = "Local Model"
    }
    const timestamp = new Date().toLocaleString();

    if (taskType === TASK_TYPE.TRAINING) {
      // Generate training task name
      const classCount = Array.isArray(config.class_list) ? config.class_list.length :
        (config.class_list ? config.class_list.split(/[,\n]/).filter(c => c.trim()).length : 0);
      const classDescription = classCount > 0 ? `${classCount} classes` : 'no classes';
      return `Training ${modelName} - ${classDescription} - ${timestamp}`;
    } else if (taskType === TASK_TYPE.EXTRACTION) {
      // Generate annotation task name
      const classCount = Array.isArray(config.class_list) ? config.class_list.length : 0;
      const classDescription = classCount > 0 ? `${classCount} classes` : 'no classes';
      const modeDescription = config.extraction_mode === 'binary' ? 'Binary' : 'Multiclass';
      return `Extraction ${modeDescription} - ${classDescription} - ${timestamp}`;
    } else {
      // Generate inference task names
      let fileDescription = '';
      if (config.files && config.files.length > 0) {
        fileDescription = `${config.files.length} files`;
      } else if (config.file_globbing_patterns && config.file_globbing_patterns.length > 0) {
        fileDescription = 'pattern-based';
      } else if (config.file_list) {
        fileDescription = 'file list';
      } else {
        fileDescription = 'no files';
      }

      return `Inference ${modelName} - ${fileDescription} - ${timestamp}`;
    }
  }

  // Persistence
  saveTasks() {
    try {
      const tasksData = Array.from(this.tasks.entries());
      localStorage.setItem('inference_tasks', JSON.stringify(tasksData));
    } catch (error) {
      console.error('Failed to save tasks:', error);
    }
  }

  loadTasks() {
    try {
      const tasksData = localStorage.getItem('inference_tasks');
      if (tasksData) {
        const entries = JSON.parse(tasksData);
        this.tasks = new Map(entries);

        // Rebuild queue from queued tasks
        this.rebuildQueue();
      }
    } catch (error) {
      console.error('Failed to load tasks:', error);
      this.tasks = new Map();
    }
  }

  rebuildQueue() {
    // On startup, rebuild queue from tasks that were queued or running
    const queuedTasks = this.getAllTasks()
      .filter(task => task.status === TASK_STATUS.QUEUED || task.status === TASK_STATUS.RUNNING)
      .sort((a, b) => a.created - b.created);

    this.queue = queuedTasks.map(task => {
      // Reset running tasks to queued on startup
      if (task.status === TASK_STATUS.RUNNING) {
        this.updateTask(task.id, {
          status: TASK_STATUS.QUEUED,
          progress: 'Reconnected - queued for execution',
          started: null  // Clear started timestamp so it gets a fresh start time
        });
      }
      return task.id;
    });

    // Start processing if there are queued tasks
    if (this.queue.length > 0) {
      setTimeout(() => this.processQueue(), 1000);
    }
  }

  // Event System
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notifyListeners(event, data) {
    this.listeners.forEach(callback => {
      try {
        callback(event, data);
      } catch (error) {
        console.error('Task listener error:', error);
      }
    });
  }

  // Queue Info
  getQueueInfo() {
    const runningTasks = Array.from(this.runningTasks)
      .map(id => this.getTask(id))
      .filter(task => task && task.status === TASK_STATUS.RUNNING);

    const currentTask = runningTasks.length > 0 ? runningTasks[0] : null;

    return {
      currentTask: currentTask,
      runningTasks: runningTasks,
      queueLength: this.queue.length,
      nextTasks: this.queue.slice(0, 3).map(id => this.getTask(id)),
      maxConcurrentTasks: this.maxConcurrentTasks,
      exemptExtractionTasks: this.exemptExtractionTasks
    };
  }
}

// Singleton instance
export const taskManager = new TaskManager();
export default taskManager;
