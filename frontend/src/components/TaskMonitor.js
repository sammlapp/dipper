import React, { useState, useEffect } from 'react';
import { TASK_STATUS } from '../utils/TaskManager';

function TaskMonitor({ taskManager }) {
  const [tasks, setTasks] = useState([]);
  const [queueInfo, setQueueInfo] = useState({ currentTask: null, queueLength: 0, nextTasks: [] });
  const [expandedErrors, setExpandedErrors] = useState(new Set());

  useEffect(() => {
    if (!taskManager) return;

    // Initial load
    setTasks(taskManager.getAllTasks());
    setQueueInfo(taskManager.getQueueInfo());

    // Listen for task updates
    const unsubscribe = taskManager.addListener((event, data) => {
      setTasks(taskManager.getAllTasks());
      setQueueInfo(taskManager.getQueueInfo());
    });

    return unsubscribe;
  }, [taskManager]);

  const getStatusColor = (status) => {
    switch (status) {
      case TASK_STATUS.RUNNING: return '#2196f3';
      case TASK_STATUS.COMPLETED: return '#4caf50';
      case TASK_STATUS.FAILED: return '#f44336';
      case TASK_STATUS.CANCELLED: return '#ff9800';
      case TASK_STATUS.QUEUED: return '#9c27b0';
      default: return '#757575';
    }
  };

  const formatDuration = (start, end) => {
    if (!start) return '';
    const duration = (end || Date.now()) - start;
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const handleCancelTask = (taskId) => {
    if (taskManager) {
      taskManager.cancelTask(taskId);
    }
  };

  const handleDeleteTask = (taskId) => {
    if (taskManager) {
      taskManager.deleteTask(taskId);
    }
  };

  const handleRetryTask = (taskId) => {
    if (taskManager) {
      taskManager.queueTask(taskId);
    }
  };

  const handleClearHistory = () => {
    if (taskManager && window.confirm('Clear all completed, failed, and canceled tasks?')) {
      const tasksToDelete = tasks.filter(task =>
        [TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED].includes(task.status)
      );
      tasksToDelete.forEach(task => taskManager.deleteTask(task.id));
    }
  };

  const toggleErrorExpansion = (taskId) => {
    const newExpanded = new Set(expandedErrors);
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId);
    } else {
      newExpanded.add(taskId);
    }
    setExpandedErrors(newExpanded);
  };

  return (
    <div className="task-monitor">
      {/* Queue Status */}
      {queueInfo.currentTask && (
        <div className="current-task">
          <h4>Currently Running</h4>
          <div className="task-card running">
            <div className="task-header">
              <span className="task-name">{queueInfo.currentTask.name}</span>
              <span className="task-status" style={{ color: getStatusColor(queueInfo.currentTask.status) }}>
                {queueInfo.currentTask.status}
              </span>
            </div>
            <div className="task-progress">{queueInfo.currentTask.progress}</div>
            <div className="task-meta">
              Duration: {formatDuration(queueInfo.currentTask.started)}
            </div>
            <button
              className="task-action cancel"
              onClick={() => handleCancelTask(queueInfo.currentTask.id)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Queue Preview */}
      {queueInfo.queueLength > 0 && (
        <div className="queue-preview">
          <h4>Queue ({queueInfo.queueLength} tasks)</h4>
          {queueInfo.nextTasks.map((task, index) => (
            <div key={task.id} className="task-card queued">
              <div className="task-header">
                <span className="queue-position">#{index + 1}</span>
                <span className="task-name">{task.name}</span>
              </div>
              <button
                className="task-action cancel"
                onClick={() => handleCancelTask(task.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* All Tasks */}
      <div className="all-tasks">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4>All Tasks ({tasks.length})</h4>
          <button
            className="task-action clear-history"
            onClick={handleClearHistory}
            style={{ fontSize: '0.8rem', padding: '4px 8px' }}
          >
            Clear History
          </button>
        </div>
        <div className="task-list">
          {tasks.map(task => (
            <div key={task.id} className={`task-card ${task.status}`}>
              <div className="task-header">
                <span className="task-name">{task.name}</span>
                <span className="task-status" style={{ color: getStatusColor(task.status) }}>
                  {task.status}
                </span>
              </div>

              <div className="task-details">
                <div className="task-config">
                  Model: {task.config.model}
                  {task.config.files?.length > 0 && ` • Files: ${task.config.files.length}`}
                  {task.config.file_globbing_patterns?.length > 0 && ' • Pattern-based selection'}
                  {task.config.file_list && ' • File list selection'}
                </div>

                {task.progress && (
                  <div className="task-progress">{task.progress}</div>
                )}

                <div className="task-meta">
                  <div>Created: {new Date(task.created).toLocaleString()}</div>
                  <div>Job ID: {task.id}</div>
                  {task.started && (
                    <div>Duration: {formatDuration(task.started, task.completed)}</div>
                  )}
                </div>

                {task.result && task.result.error && (
                  <div className="task-error">
                    <div
                      className="error-header"
                      onClick={() => toggleErrorExpansion(task.id)}
                      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                      <span className="error-toggle">
                        {expandedErrors.has(task.id) ? '▼' : '▶'}
                      </span>
                      <span>Error occurred (click to expand)</span>
                    </div>
                    {expandedErrors.has(task.id) && (
                      <div className="error-details" style={{ marginTop: '8px', paddingLeft: '20px' }}>
                        {task.result.error}
                      </div>
                    )}
                  </div>
                )}

                {task.result && task.result.output_path && (
                  <div className="task-result">
                    Output: {task.result.output_path}
                  </div>
                )}
              </div>

              <div className="task-actions">
                {task.status === TASK_STATUS.UNSTARTED && (
                  <>
                    <button
                      className="task-action start"
                      onClick={() => handleRetryTask(task.id)}
                    >
                      Start Task
                    </button>
                    <button
                      className="task-action delete"
                      onClick={() => handleDeleteTask(task.id)}
                    >
                      Clear
                    </button>
                  </>
                )}

                {task.status === TASK_STATUS.RUNNING && (
                  <button
                    className="task-action cancel"
                    onClick={() => handleCancelTask(task.id)}
                  >
                    Cancel
                  </button>
                )}

                {task.status === TASK_STATUS.FAILED && (
                  <>
                    <button
                      className="task-action retry"
                      onClick={() => handleRetryTask(task.id)}
                    >
                      Retry
                    </button>
                    <button
                      className="task-action delete"
                      onClick={() => handleDeleteTask(task.id)}
                    >
                      Delete
                    </button>
                  </>
                )}

                {task.status === TASK_STATUS.CANCELLED && (
                  <>
                    <button
                      className="task-action retry"
                      onClick={() => handleRetryTask(task.id)}
                    >
                      Retry
                    </button>
                    <button
                      className="task-action delete"
                      onClick={() => handleDeleteTask(task.id)}
                    >
                      Delete
                    </button>
                  </>
                )}

                {task.status === TASK_STATUS.COMPLETED && (
                  <button
                    className="task-action delete"
                    onClick={() => handleDeleteTask(task.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default TaskMonitor;