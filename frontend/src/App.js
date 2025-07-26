import React, { useState, useEffect } from 'react';
import './App.css';
import ExploreTab from './components/ExploreTab';
import ReviewTab from './components/ReviewTab';
import TaskCreationForm from './components/TaskCreationForm';
import TrainingTaskCreationForm from './components/TrainingTaskCreationForm';
import TaskMonitor from './components/TaskMonitor';
import taskManager from './utils/TaskManager';

function App() {
  const [activeTab, setActiveTab] = useState('inference');
  const [currentTask, setCurrentTask] = useState(null);
  const [taskHistory, setTaskHistory] = useState([]);

  const tabs = [
    { id: 'inference', name: 'Inference' },
    { id: 'training', name: 'Training' },
    { id: 'explore', name: 'Explore' },
    { id: 'review', name: 'Review' }
  ];

  // Set up task manager listeners
  useEffect(() => {
    const unsubscribe = taskManager.addListener((event, data) => {
      // Always update task history first
      setTaskHistory(taskManager.getAllTasks());
      
      // Update current task based on queue info
      const queueInfo = taskManager.getQueueInfo();
      setCurrentTask(queueInfo.currentTask);
    });

    // Initial load
    setTaskHistory(taskManager.getAllTasks());
    const queueInfo = taskManager.getQueueInfo();
    setCurrentTask(queueInfo.currentTask);

    return unsubscribe;
  }, []);

  // Task handlers
  const handleTaskCreate = (taskConfig, taskName) => {
    const task = taskManager.createTask(taskConfig, taskName);
    console.log('Task created:', task);
  };

  const handleTaskCreateAndRun = (taskConfig, taskName) => {
    const task = taskManager.createTask(taskConfig, taskName);
    taskManager.queueTask(task.id);
    console.log('Task created and queued:', task);
  };

  return (
    <div className="App">
      <nav className="tab-nav">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.name}
          </button>
        ))}
      </nav>

      <main className="main-content">
        {activeTab === 'inference' && (
          <div className="tab-content">
            <div className="section">
              <TaskCreationForm
                onTaskCreate={handleTaskCreate}
                onTaskCreateAndRun={handleTaskCreateAndRun}
              />
            </div>

            <div className="section">
              <h3>Task Management</h3>
              <TaskMonitor taskManager={taskManager} />
            </div>
          </div>
        )}

        {activeTab === 'training' && (
          <div className="tab-content">
            <div className="section">
              <TrainingTaskCreationForm
                onTaskCreate={handleTaskCreate}
                onTaskCreateAndRun={handleTaskCreateAndRun}
              />
            </div>

            <div className="section">
              <h3>Training Task Management</h3>
              <TaskMonitor taskManager={taskManager} />
            </div>
          </div>
        )}

        {activeTab === 'explore' && (
          <ExploreTab />
        )}

        {activeTab === 'review' && (
          <ReviewTab />
        )}
      </main>

      {/* Fixed status bar */}
      <div className="status-bar">
        {currentTask ? (
          <div className="status-running">
            <span className="status-icon">🔄</span>
            <span>Running: {currentTask.name}</span>
            <span className="status-progress">{currentTask.progress}</span>
          </div>
        ) : (
          <div className="status-idle">
            <span className="status-icon">✅</span>
            <span>Ready • {taskHistory.filter(t => t.status === 'completed').length} completed tasks</span>
            {taskHistory.filter(t => t.status === 'queued').length > 0 && (
              <span className="queue-count">
                • {taskHistory.filter(t => t.status === 'queued').length} queued
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;