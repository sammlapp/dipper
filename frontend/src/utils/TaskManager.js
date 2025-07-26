/**
 * Task Management System for Inference and Training Tasks
 * Handles task CRUD operations, persistence, and queue management
 */

import { v4 as uuidv4 } from 'uuid';

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
  TRAINING: 'training'
};

class TaskManager {
  constructor() {
    this.tasks = new Map();
    this.queue = [];
    this.currentTask = null;
    this.listeners = new Set();
    this.loadTasks();
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
      processId: null
    };

    this.tasks.set(task.id, task);
    this.saveTasks();
    this.notifyListeners('taskCreated', task);
    return task;
  }

  determineTaskType(config) {
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

    // Update task status to queued
    this.updateTask(taskId, { 
      status: TASK_STATUS.QUEUED,
      progress: 'Queued for execution'
    });

    // Add to queue if not already present
    if (!this.queue.includes(taskId)) {
      this.queue.push(taskId);
    }

    // Start immediately if no task is running
    if (!this.currentTask) {
      this.processQueue();
    }

    return true;
  }

  async processQueue() {
    if (this.currentTask || this.queue.length === 0) return;

    const taskId = this.queue.shift();
    const task = this.getTask(taskId);
    
    if (!task || task.status === TASK_STATUS.CANCELLED) {
      // Task was deleted or cancelled, process next
      this.processQueue();
      return;
    }

    this.currentTask = taskId;
    await this.executeTask(taskId);
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
      const result = task.type === TASK_TYPE.TRAINING 
        ? await this.runTraining(task)
        : await this.runInference(task);

      // Update task with results
      this.updateTask(taskId, {
        status: TASK_STATUS.COMPLETED,
        completed: Date.now(),
        progress: 'Completed successfully',
        result: result
      });

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
      this.currentTask = null;
      setTimeout(() => this.processQueue(), 100);
    }
  }

  async runInference(task) {
    const config = task.config;
    
    // Generate unique process ID for this task
    const processId = `task_${task.id}_${Date.now()}`;
    
    // Update task with process ID
    this.updateTask(task.id, { processId });

    try {
      // Update progress
      this.updateTask(task.id, { progress: 'Preparing configuration...' });

      // Create job folder and output paths
      const jobFolderName = task.name.replace(/[^a-zA-Z0-9\-_\s]/g, '').replace(/\s+/g, '_');
      const jobFolder = config.output_dir ? `${config.output_dir}/${jobFolderName}` : '';
      const outputCsvPath = jobFolder ? `${jobFolder}/predictions.csv` : '';
      const configJsonPath = jobFolder ? `${jobFolder}/${task.name}_${task.id}.json` : '';

      // Create temporary config file
      const tempConfigPath = `/tmp/inference_config_${processId}.json`;
      const configData = {
        model: config.model || 'BirdNET',
        files: config.files || [],
        file_globbing_patterns: config.file_globbing_patterns || [],
        file_list: config.file_list || '',
        output_file: outputCsvPath,
        job_folder: jobFolder,
        config_output_path: configJsonPath,
        inference_settings: {
          clip_overlap: config.overlap || 0.0,
          batch_size: config.batch_size || 1,
          num_workers: config.worker_count || 1
        }
      };

      // Save temporary config file using HTTP API
      const saveResponse = await fetch('http://localhost:8000/config/save', {
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

      // Get environment paths using Electron userData directory
      const envPathResult = await window.electronAPI.getEnvironmentPath('dipper_pytorch_env');
      const archivePathResult = await window.electronAPI.getArchivePath('dipper_pytorch_env.tar.gz');

      if (!envPathResult.success || !archivePathResult.success) {
        throw new Error('Failed to get environment paths');
      }

      const envPath = envPathResult.path;
      const archivePath = archivePathResult.path;

      // Update progress
      this.updateTask(task.id, { progress: 'Running inference...' });

      // Start inference via HTTP API (now returns immediately with job ID)
      const inferenceResponse = await fetch('http://localhost:8000/inference/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config_path: tempConfigPath,
          env_path: envPath,
          archive_path: archivePath,
          job_id: processId
        })
      });

      const startResult = await inferenceResponse.json();

      if (startResult.status === 'started') {
        const jobId = startResult.job_id;
        this.updateTask(task.id, { progress: 'Inference running...', processId: jobId });

        // Poll for completion
        const finalResult = await this.pollInferenceStatus(jobId, task.id);
        
        if (finalResult.status === 'completed') {
          return {
            success: true,
            output_path: configData.output_file,
            job_folder: configData.job_folder,
            config_path: configData.config_output_path,
            total_files: config.files.length || config.file_globbing_patterns.length || (config.file_list ? 1 : 0),
            message: 'Inference completed successfully',
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

  async pollInferenceStatus(jobId, taskId, pollInterval = 2000) {
    /**
     * Poll inference status until completion or failure
     * @param {string} jobId - Backend job ID 
     * @param {string} taskId - Frontend task ID
     * @param {number} pollInterval - Polling interval in milliseconds
     * @returns {Promise} Final result when inference completes
     */
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const response = await fetch(`http://localhost:8000/inference/status/${jobId}`);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const result = await response.json();
          
          // Update task progress based on status
          if (result.status === 'running') {
            this.updateTask(taskId, { progress: 'Inference running...' });
            // Continue polling
            setTimeout(poll, pollInterval);
          } else if (result.status === 'completed') {
            this.updateTask(taskId, { progress: 'Inference completed' });
            resolve(result);
          } else if (result.status === 'failed') {
            this.updateTask(taskId, { progress: 'Inference failed' });
            resolve(result); // Resolve with failed status, let caller handle error
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
    
    // Generate unique process ID for this task
    const processId = `training_${task.id}_${Date.now()}`;
    
    // Update task with process ID
    this.updateTask(task.id, { processId });

    try {
      // Update progress
      this.updateTask(task.id, { progress: 'Preparing training configuration...' });

      // Create job folder and output paths
      const jobFolderName = task.name.replace(/[^a-zA-Z0-9\-_\s]/g, '').replace(/\s+/g, '_');
      const jobFolder = config.save_location ? `${config.save_location}/${jobFolderName}` : '';
      const modelSavePath = jobFolder ? `${jobFolder}/trained_model.pth` : '';
      const configJsonPath = jobFolder ? `${jobFolder}/${task.name}_${task.id}.json` : '';

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
        model_save_path: modelSavePath,
        job_folder: jobFolder,
        config_output_path: configJsonPath,
        training_settings: {
          batch_size: config.batch_size || 32,
          num_workers: config.num_workers || 4,
          freeze_feature_extractor: config.freeze_feature_extractor !== false
        }
      };

      // Save temporary config file using HTTP API
      const saveResponse = await fetch('http://localhost:8000/config/save', {
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

      // Get environment paths using Electron userData directory
      const envPathResult = await window.electronAPI.getEnvironmentPath('dipper_pytorch_env');
      const archivePathResult = await window.electronAPI.getArchivePath('dipper_pytorch_env.tar.gz');

      if (!envPathResult.success || !archivePathResult.success) {
        throw new Error('Failed to get environment paths');
      }

      const envPath = envPathResult.path;
      const archivePath = archivePathResult.path;

      // Update progress
      this.updateTask(task.id, { progress: 'Starting training...' });

      // Start training via HTTP API (returns immediately with job ID)
      const trainingResponse = await fetch('http://localhost:8000/training/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config_path: tempConfigPath,
          env_path: envPath,
          archive_path: archivePath,
          job_id: processId
        })
      });

      const startResult = await trainingResponse.json();

      if (startResult.status === 'started') {
        const jobId = startResult.job_id;
        this.updateTask(task.id, { progress: 'Training running...', processId: jobId });

        // Poll for completion
        const finalResult = await this.pollTrainingStatus(jobId, task.id);
        
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

  async pollTrainingStatus(jobId, taskId, pollInterval = 2000) {
    /**
     * Poll training status until completion or failure
     * @param {string} jobId - Backend job ID 
     * @param {string} taskId - Frontend task ID
     * @param {number} pollInterval - Polling interval in milliseconds
     * @returns {Promise} Final result when training completes
     */
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const response = await fetch(`http://localhost:8000/training/status/${jobId}`);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const result = await response.json();
          
          // Update task progress based on status
          if (result.status === 'running') {
            this.updateTask(taskId, { progress: 'Training running...' });
            // Continue polling
            setTimeout(poll, pollInterval);
          } else if (result.status === 'completed') {
            this.updateTask(taskId, { progress: 'Training completed' });
            resolve(result);
          } else if (result.status === 'failed') {
            this.updateTask(taskId, { progress: 'Training failed' });
            resolve(result); // Resolve with failed status, let caller handle error
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

  cancelTask(taskId) {
    const task = this.getTask(taskId);
    if (!task) return false;

    if (task.status === TASK_STATUS.RUNNING) {
      // Cancel the running process
      if (task.processId && window.electronAPI) {
        window.electronAPI.killPythonProcess(task.processId);
      }
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
    if (this.currentTask === taskId) {
      this.currentTask = null;
      setTimeout(() => this.processQueue(), 100);
    }

    return true;
  }

  // Utility Methods
  generateTaskName(config, taskType = TASK_TYPE.INFERENCE) {
    const modelName = config.model || 'Unknown';
    const timestamp = new Date().toLocaleString();
    
    if (taskType === TASK_TYPE.TRAINING) {
      // Generate training task name
      const classCount = Array.isArray(config.class_list) ? config.class_list.length : 
                        (config.class_list ? config.class_list.split(/[,\n]/).filter(c => c.trim()).length : 0);
      const classDescription = classCount > 0 ? `${classCount} classes` : 'no classes';
      return `Training ${modelName} - ${classDescription} - ${timestamp}`;
    } else {
      // Generate inference task name
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
      
      return `${modelName} - ${fileDescription} - ${timestamp}`;
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
    // Only show currentTask if it's actually still running
    const currentTask = this.currentTask ? this.getTask(this.currentTask) : null;
    const isCurrentTaskRunning = currentTask && currentTask.status === TASK_STATUS.RUNNING;
    
    return {
      currentTask: isCurrentTaskRunning ? currentTask : null,
      queueLength: this.queue.length,
      nextTasks: this.queue.slice(0, 3).map(id => this.getTask(id))
    };
  }
}

// Singleton instance
export const taskManager = new TaskManager();
export default taskManager;