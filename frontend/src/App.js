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
import RuleIcon from '@mui/icons-material/Rule';
import HelpIcon from '@mui/icons-material/Help';
import ColorizeIcon from '@mui/icons-material/Colorize';
import SettingsIcon from '@mui/icons-material/Settings';
import ListAltIcon from '@mui/icons-material/PlaylistPlay'
import BubbleChartIcon from '@mui/icons-material/BubbleChart';
import './App.css';
import SongSpaceTab from './components/SongSpaceTab';
import ReviewTab from './components/ReviewTab';
import HelpTab from './components/HelpTab';
import SettingsTab from './components/SettingsTab';
import TaskCreationForm from './components/TaskCreationForm';
import TrainingTaskCreationForm from './components/TrainingTaskCreationForm';
import ExtractionTaskCreationForm from './components/ExtractionTaskCreationForm';
import TaskMonitor from './components/TaskMonitor';
import taskManager from './utils/TaskManager';
import { useBackendUrl } from './hooks/useBackendUrl';
import { useDarkMode } from './hooks/useDarkMode';

// ─── Feature flags ────────────────────────────────────────────────────────────
// Set to false to hide a tab from the full app build.
const ENABLE_TRAINING  = false;
const ENABLE_SONGSPACE = false;
// ─────────────────────────────────────────────────────────────────────────────

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
  useDarkMode(); // applies body.dark-mode class from persisted preference

  // Check if running in review-only mode
  const isReviewOnly = process.env.REACT_APP_REVIEW_ONLY === 'true';

  const [activeTab, setActiveTab] = useState(isReviewOnly ? 'review' : 'inference');
  const [currentTask, setCurrentTask] = useState(null);
  const [runningTasks, setRunningTasks] = useState([]);
  const [taskHistory, setTaskHistory] = useState([]);
  const [extractionPredictionsFolder, setExtractionPredictionsFolder] = useState(null); // {folder, ts}
  const backendUrl = useBackendUrl();

  const [envReady, setEnvReady] = useState(false);

  const tabs = [
    { id: 'inference',  name: 'Inference',   icon: <PlayArrowIcon /> },
    ENABLE_TRAINING  && { id: 'training',  name: 'Training',    icon: <SchoolIcon /> },
    { id: 'extraction', name: 'Extraction',  icon: <ColorizeIcon /> },
    { id: 'tasks',      name: 'Task Queue',  icon: <ListAltIcon /> },
    { id: 'review',     name: 'Review',      icon: <RuleIcon /> },
    ENABLE_SONGSPACE && { id: 'songspace', name: 'SongSpace',   icon: <BubbleChartIcon /> },
    { id: 'settings',   name: 'Settings',    icon: <SettingsIcon /> },
    { id: 'help',       name: 'Help',        icon: <HelpIcon /> },
  ].filter(Boolean);

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
    const unsubscribe = taskManager.addListener((event, data) => {
      setTaskHistory(taskManager.getAllTasks());
      const queueInfo = taskManager.getQueueInfo();
      setRunningTasks(queueInfo.runningTasks || []);
      setCurrentTask(queueInfo.currentTask);
    });

    const handleTabChange = (event) => {
      if (event.detail && event.detail.tabId) {
        setActiveTab(event.detail.tabId);
      }
    };

    // Initial load
    const allTasks = taskManager.getAllTasks();
    setTaskHistory(allTasks);
    const queueInfo = taskManager.getQueueInfo();
    setRunningTasks(queueInfo.runningTasks || []);
    setCurrentTask(queueInfo.currentTask);

    window.addEventListener('changeTab', handleTabChange);

    return () => {
      unsubscribe();
      window.removeEventListener('changeTab', handleTabChange);
    };
  }, []);

  // ML environment: check on launch so task forms know whether env is ready
  useEffect(() => {
    if (isReviewOnly || !backendUrl) return;
    fetch(`${backendUrl}/env/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ env_path: null }) })
      .then(r => r.json())
      .then(result => setEnvReady(result.status === 'ready'))
      .catch(() => { });
  }, [backendUrl, isReviewOnly]);

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

  const handleExtractClips = (jobFolder) => {
    // Wrap in object with timestamp so the effect always re-fires, even for the same folder
    setExtractionPredictionsFolder({ folder: jobFolder, ts: Date.now() });
    setActiveTab('extraction');
  };

  // If review-only mode, render only the ReviewTab without drawer
  if (isReviewOnly) {
    return (
      <Box sx={{ display: 'flex', width: '100%' }}>
        <CssBaseline />
        <Box component="main" sx={{ flexGrow: 1, p: 0 }}>
          <ReviewTab isReviewOnly={true} />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <Drawer
        variant="permanent"
        open={isDrawerOpen}
        onMouseEnter={handleDrawerHover}
        onMouseLeave={handleDrawerLeave}
        sx={{
          fontFamily: 'var(--app-font)',
          '& .MuiDrawer-paper': {
            fontFamily: 'var(--app-font)'
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
        width: '100%', // Ensure full width
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh'
      }}>
        {/* Keep all tabs mounted to preserve state - only hide/show with CSS */}
        <div className="tab-content" style={{ display: activeTab === 'inference' ? 'block' : 'none' }}>
          <TaskCreationForm
            onTaskCreate={handleTaskCreate}
            onTaskCreateAndRun={handleTaskCreateAndRun}
            mlEnvReady={envReady}
          />
        </div>

        {ENABLE_TRAINING && (
          <div className="tab-content" style={{ display: activeTab === 'training' ? 'block' : 'none' }}>
            <TrainingTaskCreationForm
              onTaskCreate={handleTaskCreate}
              onTaskCreateAndRun={handleTaskCreateAndRun}
              mlEnvReady={envReady}
            />
          </div>
        )}

        <div className="tab-content" style={{ display: activeTab === 'extraction' ? 'block' : 'none' }}>
          <ExtractionTaskCreationForm
            onTaskCreate={handleTaskCreate}
            onTaskCreateAndRun={handleTaskCreateAndRun}
            onTaskCreateAndRunInline={handleTaskCreateAndRun}
            initialPredictionsFolder={extractionPredictionsFolder}
            mlEnvReady={envReady}
          />
        </div>

        <div style={{ display: activeTab === 'tasks' ? 'flex' : 'none', flexDirection: 'column', flex: 1, padding: '24px', minHeight: 0 }}>
          <TaskMonitor taskManager={taskManager} onExtractClips={handleExtractClips} />
        </div>

        <div style={{ display: activeTab === 'review' ? 'block' : 'none' }}>
          <ReviewTab drawerOpen={isDrawerOpen} isActive={activeTab === 'review'} />
        </div>

        {ENABLE_SONGSPACE && (
          <div style={{ display: activeTab === 'songspace' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <SongSpaceTab />
          </div>
        )}

        <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
          <SettingsTab onEnvReady={setEnvReady} />
        </div>

        <div style={{ display: activeTab === 'help' ? 'block' : 'none' }}>
          <HelpTab />
        </div>

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
          {runningTasks.length > 0 ? (
            <div className="status-running" onClick={() => setActiveTab('tasks')} style={{ cursor: 'pointer' }}>
              <span className="status-icon">🔄</span>
              {runningTasks.length === 1 ? (
                <>
                  <span>Running: {runningTasks[0].name}</span>
                  <span className="status-progress">{runningTasks[0].progress}</span>
                </>
              ) : (
                <span>Running {runningTasks.length} tasks: {runningTasks.map(t => t.name).join(', ').substring(0, 80)}...</span>
              )}
            </div>
          ) : (
            <div className="status-idle" onClick={() => setActiveTab('tasks')} style={{ cursor: 'pointer' }}>
              <span className="status-icon">✅</span>
              <span>Ready • {taskHistory.filter(t => t.status === 'completed').length} completed tasks</span>
              {taskHistory.filter(t => t.status === 'queued').length > 0 && (
                <span className="queue-count">
                  • {taskHistory.filter(t => t.status === 'queued').length} queued
                </span>
              )}
              <span className="server-status">
                • Backend: {backendUrl.replace('http://localhost:', 'port ')}
              </span>
            </div>
          )}
        </div>
      </Box>

    </Box >
  );
}

export default App;