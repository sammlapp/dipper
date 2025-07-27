import React, { useState, useEffect } from 'react';
import { styled, useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import MuiDrawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import CssBaseline from '@mui/material/CssBaseline';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SchoolIcon from '@mui/icons-material/School';
import ExploreIcon from '@mui/icons-material/Explore';
import RateReviewIcon from '@mui/icons-material/RateReview';
import HelpIcon from '@mui/icons-material/Help';
import './App.css';
import ExploreTab from './components/ExploreTab';
import ReviewTab from './components/ReviewTab';
import HelpTab from './components/HelpTab';
import TaskCreationForm from './components/TaskCreationForm';
import TrainingTaskCreationForm from './components/TrainingTaskCreationForm';
import TaskMonitor from './components/TaskMonitor';
import taskManager from './utils/TaskManager';

const drawerWidth = 240;

const openedMixin = (theme) => ({
  width: drawerWidth,
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.enteringScreen,
  }),
  overflowX: 'hidden',
});

const closedMixin = (theme) => ({
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  overflowX: 'hidden',
  width: `calc(${theme.spacing(7)} + 1px)`,
  [theme.breakpoints.up('sm')]: {
    width: `calc(${theme.spacing(8)} + 1px)`,
  },
});

const DrawerHeader = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  padding: theme.spacing(0, 1),
  ...theme.mixins.toolbar,
}));


const Drawer = styled(MuiDrawer, { shouldForwardProp: (prop) => prop !== 'open' })(
  ({ theme }) => ({
    width: drawerWidth,
    flexShrink: 0,
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
    variants: [
      {
        props: ({ open }) => open,
        style: {
          ...openedMixin(theme),
          '& .MuiDrawer-paper': openedMixin(theme),
        },
      },
      {
        props: ({ open }) => !open,
        style: {
          ...closedMixin(theme),
          '& .MuiDrawer-paper': closedMixin(theme),
        },
      },
    ],
  }),
);

function App() {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('inference');
  const [currentTask, setCurrentTask] = useState(null);
  const [taskHistory, setTaskHistory] = useState([]);

  const tabs = [
    { id: 'inference', name: 'Inference', icon: <PlayArrowIcon /> },
    { id: 'training', name: 'Training', icon: <SchoolIcon /> },
    { id: 'explore', name: 'Explore', icon: <ExploreIcon /> },
    { id: 'review', name: 'Review', icon: <RateReviewIcon /> },
    { id: 'help', name: 'Help', icon: <HelpIcon /> }
  ];

  const handleDrawerOpen = () => {
    setOpen(true);
  };

  const handleDrawerClose = () => {
    setOpen(false);
  };

  const handleDrawerHover = () => {
    if (!open) {
      setHoverOpen(true);
    }
  };

  const handleDrawerLeave = () => {
    setHoverOpen(false);
  };

  const isDrawerOpen = open || hoverOpen;

  // Set up task manager listeners
  useEffect(() => {
    const unsubscribe = taskManager.addListener(() => {
      // Always update task history first
      setTaskHistory(taskManager.getAllTasks());

      // Update current task based on queue info
      const queueInfo = taskManager.getQueueInfo();
      setCurrentTask(queueInfo.currentTask);
    });

    // Handle tab change events from help icons
    const handleTabChange = (event) => {
      if (event.detail && event.detail.tabId) {
        setActiveTab(event.detail.tabId);
      }
    };

    // Initial load
    setTaskHistory(taskManager.getAllTasks());
    const queueInfo = taskManager.getQueueInfo();
    setCurrentTask(queueInfo.currentTask);

    // Add tab change listener
    window.addEventListener('changeTab', handleTabChange);

    return () => {
      unsubscribe();
      window.removeEventListener('changeTab', handleTabChange);
    };
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
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <Drawer
        variant="permanent"
        open={isDrawerOpen}
        onMouseEnter={handleDrawerHover}
        onMouseLeave={handleDrawerLeave}
        sx={{
          fontFamily: 'Rokkitt, sans-serif',
          '& .MuiDrawer-paper': {
            fontFamily: 'Rokkitt, sans-serif'
          }
        }}
      >
        <DrawerHeader>
          {!open && (
            <IconButton 
              onClick={handleDrawerOpen}
              sx={{ 
                width: '100%', 
                justifyContent: 'center',
                color: 'var(--dark)'
              }}
            >
              <MenuIcon />
            </IconButton>
          )}
          {open && (
            <IconButton 
              onClick={handleDrawerClose}
              sx={{ 
                marginLeft: 'auto',
                color: 'var(--dark)'
              }}
            >
              {theme.direction === 'rtl' ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </IconButton>
          )}
        </DrawerHeader>
        <List>
          {tabs.map((tab) => (
            <ListItem key={tab.id} disablePadding sx={{ display: 'block' }}>
              <ListItemButton
                selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                sx={[
                  {
                    minHeight: 48,
                    px: 2.5,
                  },
                  isDrawerOpen
                    ? {
                      justifyContent: 'initial',
                    }
                    : {
                      justifyContent: 'center',
                    },
                ]}
              >
                <ListItemIcon
                  sx={[
                    {
                      minWidth: 0,
                      justifyContent: 'center',
                    },
                    isDrawerOpen
                      ? {
                        mr: 3,
                      }
                      : {
                        mr: 'auto',
                      },
                  ]}
                >
                  {tab.icon}
                </ListItemIcon>
                <ListItemText
                  primary={tab.name}
                  sx={[
                    isDrawerOpen
                      ? {
                        opacity: 1,
                      }
                      : {
                        opacity: 0,
                      },
                  ]}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Drawer>
      <Box component="main" sx={{ 
        flexGrow: 1, 
        p: 3,
        marginLeft: isDrawerOpen ? 0 : 0, // Remove any margin conflicts
        width: '100%' // Ensure full width
      }}>
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
          <ReviewTab drawerOpen={isDrawerOpen} />
        )}

        {activeTab === 'help' && (
          <HelpTab />
        )}

        {/* Fixed status bar */}
        <div className="status-bar" style={{
          position: 'fixed',
          bottom: 0,
          left: isDrawerOpen ? drawerWidth : `calc(${theme.spacing(8)} + 1px)`,
          right: 0,
          zIndex: 1000, // Ensure it's above other content but below modals
          transition: theme.transitions.create('left', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
          })
        }}>
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
      </Box>
    </Box >
  );
}

export default App;