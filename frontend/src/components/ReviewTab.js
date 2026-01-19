import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Drawer, IconButton, Modal, Box, Typography, FormControl, Select, MenuItem } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import AnnotationCard from './AnnotationCard';
import ReviewSettings from './ReviewSettings';
import FocusView from './FocusView';
import HelpIcon from './HelpIcon';
import ClassifierGuidedPanel from './ClassifierGuidedPanel';
import ScoreHistogram from './ScoreHistogram';
import { useHttpAudioLoader, HttpServerStatus } from './HttpAudioLoader';
import {
  createStratifiedBins,
  isBinComplete,
  getAvailableColumns,
  getNumericColumns
} from '../utils/stratificationUtils';
import { selectCSVFiles, selectFolder, selectJSONFiles, saveFile, writeFile, readFile } from '../utils/fileOperations';
import { useBackendUrl } from '../hooks/useBackendUrl';
import { dirname, basename } from 'pathe';

function ReviewTab({ drawerOpen = false, isReviewOnly = false }) {
  const backendUrl = useBackendUrl();
  const [selectedFile, setSelectedFile] = useState('');
  const [annotationData, setAnnotationData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [settings, setSettings] = useState({
    review_mode: 'binary',
    grid_rows: 3,
    grid_columns: 4,
    show_comments: false,
    show_file_name: false,
    show_binary_controls: true,
    resize_images: true,
    image_width: 400,
    image_height: 200,
    focus_mode_autoplay: true,
    focus_size: 'medium',
    keyboard_shortcuts_enabled: true,
    manual_classes: '',
    clip_duration: 3.0,
    annotation_column: 'annotation'  // Column to use for binary annotations
  });
  const [availableClasses, setAvailableClasses] = useState([]);
  const [csvColumns, setCsvColumns] = useState([]);  // Store CSV column headers
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [loadedPageData, setLoadedPageData] = useState([]);
  const [lastRenderedPage, setLastRenderedPage] = useState(0); // Track which page we last rendered to prevent flashing
  const [lastRenderedBinIndex, setLastRenderedBinIndex] = useState(0); // Track which bin we last rendered in classifier-guided mode
  const [lastRenderedFocusClipIndex, setLastRenderedFocusClipIndex] = useState(0); // Track which focus clip we last rendered
  const [isPageTransitioning, setIsPageTransitioning] = useState(false);
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [rootAudioPath, setRootAudioPath] = useState('');
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [focusClipIndex, setFocusClipIndex] = useState(0);
  const [activeClipIndexOnPage, setActiveClipIndexOnPage] = useState(0); // Index of active clip within current page (0 to itemsPerPage-1)
  const activeClipAudioControlsRef = useRef(null); // Ref to store active clip's audio control functions {togglePlayPause, pause, play}
  const previousClipAudioControlsRef = useRef(null); // Ref to store previous clip's audio controls for pausing
  const shouldAutoplayNextClip = useRef(false); // Flag to trigger autoplay after annotation
  const isLayoutChanging = useRef(false); // Flag to prevent active clip reset during layout changes
  const [gridModeAutoplay, setGridModeAutoplay] = useState(false); // Auto-play in grid mode when active clip advances
  const [isLeftTrayOpen, setIsLeftTrayOpen] = useState(false);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [isClassifierGuidedPanelOpen, setIsClassifierGuidedPanelOpen] = useState(false);
  const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
  const [isFormatInfoExpanded, setIsFormatInfoExpanded] = useState(false);
  const [isScoreHistogramOpen, setIsScoreHistogramOpen] = useState(false);

  // Classifier-guided listening state
  const [classifierGuidedMode, setClassifierGuidedMode] = useState({
    enabled: false,
    stratificationColumns: [],
    scoreColumn: null,
    sortStrategy: 'original', // 'original', 'score_desc', 'random'
    maxClipsPerBin: 20,
    completionStrategy: 'all', // 'all', 'binary_yes_count', 'multiclass_label_count'
    completionTargetCount: 1,
    completionTargetLabels: [] // For multiclass mode
  });
  const [stratifiedBins, setStratifiedBins] = useState([]);
  const [currentBinIndex, setCurrentBinIndex] = useState(0);
  const [filters, setFilters] = useState({
    annotation: { enabled: false, values: [] },
    labels: { enabled: false, values: [] },
    annotation_status: { enabled: false, values: [] }
  });
  const [appliedFilters, setAppliedFilters] = useState({
    annotation: { enabled: false, values: [] },
    labels: { enabled: false, values: [] },
    annotation_status: { enabled: false, values: [] }
  });
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [currentSavePath, setCurrentSavePath] = useState(null); // Session save path
  const [serverInitializing, setServerInitializing] = useState(false);
  const serverInitializedRef = useRef(false); // Track if server has been initialized
  const fileInputRef = useRef(null);

  // HTTP-based loader (fast and reliable)
  const httpLoader = useHttpAudioLoader(`${backendUrl}`);

  // Helper function to get image dimensions based on focus size setting
  const getFocusImageDimensions = (focusSize) => {
    switch (focusSize) {
      case 'small':
        return { width: 600, height: 300 };
      case 'medium':
        return { width: 900, height: 400 };
      case 'large':
        return { width: 1200, height: 500 };
      default:
        return { width: 900, height: 400 };
    }
  };

  // Helper functions for unified config management
  const getUnifiedConfig = () => ({
    view_settings: settings,
    cgl_settings: classifierGuidedMode
  });

  const saveConfigToLocalStorage = (config) => {
    localStorage.setItem('review_unified_config', JSON.stringify(config));
  };

  const loadConfigFromLocalStorage = () => {
    try {
      const saved = localStorage.getItem('review_unified_config');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (err) {
      console.warn('Failed to load config from localStorage:', err);
    }
    return null;
  };

  const saveConfigToFile = async () => {
    try {
      const config = getUnifiedConfig();
      const configJson = JSON.stringify(config, null, 2);

      const filePath = await saveFile('review_config.json');
      if (filePath) {
        const result = await writeFile(filePath, configJson);
        if (result.success) {
          console.log('Config saved to:', filePath);
          return true;
        } else {
          throw new Error(result.error || 'Failed to write file');
        }
      }
      return false;
    } catch (err) {
      console.error('Failed to save config to file:', err);
      setError('Failed to save config: ' + err.message);
      return false;
    }
  };

  const loadConfigFromFile = async () => {
    try {
      const files = await selectJSONFiles();
      if (files && files.length > 0) {
        const filePath = files[0];

        // Read file using standard file operations (works in both Tauri and server mode)
        const configContent = await readFile(filePath);
        const config = JSON.parse(configContent);

        // Validate config structure
        if (config.view_settings && config.cgl_settings) {
          setSettings(config.view_settings);
          setClassifierGuidedMode(config.cgl_settings);
          saveConfigToLocalStorage(config);

          // Save visualization settings to localStorage so AudioClipCard can read them
          const visualizationSettings = {
            spec_window_size: config.view_settings.spec_window_size,
            spectrogram_colormap: config.view_settings.spectrogram_colormap,
            dB_range: config.view_settings.dB_range,
            use_bandpass: config.view_settings.use_bandpass,
            bandpass_range: config.view_settings.bandpass_range,
            show_reference_frequency: config.view_settings.show_reference_frequency,
            reference_frequency: config.view_settings.reference_frequency,
            resize_images: config.view_settings.resize_images,
            image_width: config.view_settings.image_width,
            image_height: config.view_settings.image_height,
          };
          localStorage.setItem('visualization_settings', JSON.stringify(visualizationSettings));

          // Force spectrogram re-render by calling loadCurrentPageSpectrograms
          loadCurrentPageSpectrograms();

          console.log('Config loaded from:', filePath);
          return true;
        } else {
          throw new Error('Invalid config file format. Expected view_settings and cgl_settings keys.');
        }
      }
      return false;
    } catch (err) {
      console.error('Failed to load config from file:', err);
      setError('Failed to load config: ' + err.message);
      return false;
    }
  };

  const handleSettingsChange = (newSettings) => {
    // Calculate current active clip's absolute index before layout changes
    const oldItemsPerPage = settings.grid_rows * settings.grid_columns;
    const absoluteActiveIndex = currentPage * oldItemsPerPage + activeClipIndexOnPage;

    setSettings(newSettings);

    // If grid size changed, recalculate page and position to preserve active clip
    const newItemsPerPage = newSettings.grid_rows * newSettings.grid_columns;
    const layoutChanged = (newSettings.grid_rows !== settings.grid_rows ||
      newSettings.grid_columns !== settings.grid_columns);

    if (layoutChanged && annotationData.length > 0) {
      // Set flag to prevent page-change useEffect from resetting active clip
      isLayoutChanging.current = true;

      // Calculate which page and position the active clip should be at in new layout
      const newPage = Math.floor(absoluteActiveIndex / newItemsPerPage);
      const newActiveClipIndex = absoluteActiveIndex % newItemsPerPage;

      // Update page if it changed
      const newTotalPages = Math.ceil(annotationData.length / newItemsPerPage);
      const boundedNewPage = Math.min(newPage, newTotalPages - 1);

      if (boundedNewPage !== currentPage) {
        setCurrentPage(boundedNewPage);
      }

      // Update active clip index for new layout
      setActiveClipIndexOnPage(newActiveClipIndex);

      // Clear flag after state updates complete
      setTimeout(() => {
        isLayoutChanging.current = false;
      }, 0);
    } else {
      // No layout change, just ensure current page is in bounds
      const newTotalPages = Math.ceil(annotationData.length / newItemsPerPage);
      if (currentPage >= newTotalPages && newTotalPages > 0) {
        setCurrentPage(newTotalPages - 1);
      }
    }

    // Re-extract classes if review mode changed
    if (newSettings.review_mode !== settings.review_mode) {
      extractAvailableClasses(annotationData);
    }
  };

  // Apply filters to annotation data (using appliedFilters, not filters)
  const filteredAnnotationData = useMemo(() => {
    return annotationData.filter(clip => {
      // Filter by annotation (binary mode)
      if (appliedFilters.annotation.enabled && appliedFilters.annotation.values.length > 0) {
        const clipAnnotation = clip.annotation || 'unlabeled';
        if (!appliedFilters.annotation.values.includes(clipAnnotation)) {
          return false;
        }
      }

      // Filter by labels (multi-class mode)
      if (appliedFilters.labels.enabled && appliedFilters.labels.values.length > 0) {
        const clipLabels = clip.labels || '';
        if (!clipLabels) return false;

        try {
          let labels = [];
          if (clipLabels.startsWith('[') && clipLabels.endsWith(']')) {
            labels = JSON.parse(clipLabels.replace(/'/g, '"'));
          } else {
            labels = clipLabels.split(',').map(s => s.trim()).filter(s => s);
          }

          // Check if any of the clip's labels match the filter
          const hasMatchingLabel = labels.some(label => appliedFilters.labels.values.includes(label));
          if (!hasMatchingLabel) return false;
        } catch (e) {
          return false;
        }
      }

      // Filter by annotation status (multi-class mode)
      if (appliedFilters.annotation_status.enabled && appliedFilters.annotation_status.values.length > 0) {
        const clipStatus = clip.annotation_status || 'unreviewed';
        if (!appliedFilters.annotation_status.values.includes(clipStatus)) {
          return false;
        }
      }

      return true;
    });
  }, [annotationData, appliedFilters]);

  // Calculate items per page based on grid settings
  const itemsPerPage = settings.grid_rows * settings.grid_columns;
  const totalPages = Math.ceil(filteredAnnotationData.length / itemsPerPage);

  // Get current page data - memoized to prevent unnecessary re-renders
  const getCurrentPageData = useCallback(() => {
    // If classifier-guided mode is enabled, use bin data instead
    if (classifierGuidedMode.enabled && stratifiedBins.length > 0) {
      const currentBin = stratifiedBins[currentBinIndex];
      return currentBin ? currentBin.clips : [];
    }

    // Normal pagination mode
    const start = currentPage * itemsPerPage;
    const end = start + itemsPerPage;
    return filteredAnnotationData.slice(start, end);
  }, [currentPage, itemsPerPage, filteredAnnotationData, classifierGuidedMode.enabled, stratifiedBins, currentBinIndex]);

  // Memoize current page data separately to reduce dependencies
  const currentPageData = useMemo(() => {
    // If classifier-guided mode is enabled, use bin data instead
    if (classifierGuidedMode.enabled && stratifiedBins.length > 0) {
      const currentBin = stratifiedBins[currentBinIndex];
      return currentBin ? currentBin.clips : [];
    }

    // Normal pagination mode
    const start = currentPage * itemsPerPage;
    const end = start + itemsPerPage;
    return filteredAnnotationData.slice(start, end);
  }, [currentPage, itemsPerPage, filteredAnnotationData, classifierGuidedMode.enabled, stratifiedBins, currentBinIndex]);

  // Get data for the last rendered page/bin (to show old content while new one loads)
  const lastRenderedPageData = useMemo(() => {
    // If classifier-guided mode was enabled for last render, use last bin data
    if (classifierGuidedMode.enabled && stratifiedBins.length > 0 && lastRenderedBinIndex < stratifiedBins.length) {
      const lastBin = stratifiedBins[lastRenderedBinIndex];
      return lastBin ? lastBin.clips : [];
    }

    // Normal pagination mode
    const start = lastRenderedPage * itemsPerPage;
    const end = start + itemsPerPage;
    return filteredAnnotationData.slice(start, end);
  }, [lastRenderedPage, lastRenderedBinIndex, itemsPerPage, filteredAnnotationData, classifierGuidedMode.enabled, stratifiedBins]);

  // Load spectrograms for current page
  const loadCurrentPageSpectrograms = useCallback(async () => {
    const currentData = getCurrentPageData();
    if (currentData.length > 0) {
      try {
        // Don't set transitioning state - keep old content visible until new content is ready
        // setIsPageTransitioning(true);

        // DON'T clear existing data immediately - keep old content visible during loading
        // setLoadedPageData([]);  // Commented out to prevent visual flash

        // Get root audio path from state
        const currentRootAudioPath = rootAudioPath || '';

        const clipsToLoad = currentData.map(clip => {
          // Construct full file path using root audio path if available
          let fullFilePath = clip.file;
          if (currentRootAudioPath && !clip.file.startsWith('/') && !clip.file.match(/^[A-Za-z]:\\\\/)) {
            // File is relative, prepend root audio path
            fullFilePath = `${currentRootAudioPath}/${clip.file}`;
          }

          return {
            file_path: fullFilePath,
            start_time: clip.start_time,
            end_time: clip.end_time || clip.start_time + 3,
            clip_id: clip.id
          };
        });

        // Get visualization settings with validation
        const savedVisualizationSettings = localStorage.getItem('visualization_settings');
        let visualizationSettings;
        try {
          visualizationSettings = savedVisualizationSettings ? JSON.parse(savedVisualizationSettings) : null;
        } catch (e) {
          console.warn('Corrupted visualization settings in localStorage, using defaults');
          visualizationSettings = null;
        }

        // Use defaults if settings are missing or invalid
        if (!visualizationSettings) {
          visualizationSettings = {
            spec_window_size: 512,
            spectrogram_colormap: 'greys_r',
            dB_range: [-80, -20],
            use_bandpass: false,
            bandpass_range: [500, 8000],
            show_reference_frequency: false,
            reference_frequency: 1000,
            resize_images: true,
            image_width: 400,
            image_height: 200,
          };
        }

        // Override with focus mode settings if in focus mode
        if (isFocusMode) {
          const focusDimensions = getFocusImageDimensions(settings.focus_size);
          visualizationSettings = {
            ...visualizationSettings,
            resize_images: true, // Always resize for focus mode
            image_width: focusDimensions.width,
            image_height: focusDimensions.height,
          };
        }

        // Validate dB range
        if (!Array.isArray(visualizationSettings.dB_range) ||
          visualizationSettings.dB_range.length !== 2 ||
          visualizationSettings.dB_range[0] >= visualizationSettings.dB_range[1]) {
          console.warn('Invalid dB range in settings, using defaults');
          visualizationSettings.dB_range = [-80, -20];
        }

        console.log('Loading clips:', clipsToLoad);
        console.log('Using visualization settings:', visualizationSettings);

        // Final validation of settings before sending to backend
        if (visualizationSettings.dB_range[0] >= visualizationSettings.dB_range[1]) {
          console.error('Invalid dB range: dB_min must be less than dB_max', visualizationSettings.dB_range);
          // Auto-fix invalid range instead of throwing error
          console.warn('Auto-fixing invalid dB range to default [-80, -20]');
          visualizationSettings.dB_range = [-80, -20];
        }

        // Ensure dB range values are reasonable
        if (visualizationSettings.dB_range[0] < -200 || visualizationSettings.dB_range[1] > 50) {
          console.warn('dB range values seem unreasonable, using defaults');
          visualizationSettings.dB_range = [-80, -20];
        }

        // Show server initializing message only on first load
        if (!serverInitializedRef.current) {
          setServerInitializing(true);
        }
        const loadedClips = await httpLoader.loadClipsBatch(clipsToLoad, visualizationSettings);
        if (!serverInitializedRef.current) {
          serverInitializedRef.current = true;
          setServerInitializing(false);
        }
        console.log('Loaded clips result:', loadedClips);

        // Check if any clips failed to load
        const failedClips = loadedClips.filter(clip => !clip.spectrogram_base64);
        if (failedClips.length > 0) {
          console.warn('Some clips failed to generate spectrograms:', failedClips);

          // Show helpful error message for the first failed clip
          if (failedClips.length > 0) {
            const firstFailedClip = failedClips[0];
            // Find the original clip data to get the CSV file path
            const originalClip = currentData.find(c => c.id === firstFailedClip.clip_id);
            if (originalClip) {
              const expectedPath = clipsToLoad.find(c => c.clip_id === firstFailedClip.clip_id)?.file_path || 'unknown';
              const csvPath = originalClip.file;
              const errorMessage = `Audio file(s) were not found in the expected locations. ` +
                `First missing file: ${expectedPath}\n` +
                `Path in CSV file: ${csvPath}\n` +
                `Root audio folder: ${rootAudioPath || '(not set)'}\n\n` +
                `Use the menu in the upper left to specify the Root Audio Folder that should be prepended to values of the 'file' column in the annotation CSV.`;
              setError(errorMessage);
            }
          }
        }

        // Update loaded data and mark that we've rendered this page/bin
        setLoadedPageData(loadedClips);
        if (classifierGuidedMode.enabled && stratifiedBins.length > 0) {
          setLastRenderedBinIndex(currentBinIndex); // Safe to display this bin now
        } else {
          setLastRenderedPage(currentPage); // Safe to display this page now
        }
      } catch (error) {
        console.error('Failed to load page spectrograms:', error);
        console.error('Error details:', {
          message: error.message,
          settings: visualizationSettings,
          clipCount: clipsToLoad.length
        });
        // Mark server as initialized even on error to avoid showing message repeatedly
        if (!serverInitializedRef.current) {
          serverInitializedRef.current = true;
          setServerInitializing(false);
        }
      } finally {
        // Don't set transitioning state - no overlay shown
        // setIsPageTransitioning(false);
      }
    }
  }, [rootAudioPath, httpLoader, classifierGuidedMode.enabled, stratifiedBins.length, currentBinIndex]); // Use rootAudioPath state instead of settings

  // Load saved state on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem('review_settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setSettings(prev => ({ ...prev, ...parsed }));
        // Load root audio path separately
        setRootAudioPath(parsed.root_audio_path || '');
      } catch (e) {
        console.warn('Failed to parse saved review settings:', e);
      }
    }
  }, []);

  // Track when data actually changes (new file loaded) to trigger spectrogram reload
  const [currentDataVersion, setCurrentDataVersion] = useState(0);

  // Load spectrograms when page/bin changes, new data loaded, settings change, filtering changes, or mode changes
  useEffect(() => {
    if (annotationData.length > 0) {
      loadCurrentPageSpectrograms();
    }
  }, [currentPage, currentBinIndex, currentDataVersion, rootAudioPath, filteredAnnotationData.length, settings.grid_rows, settings.grid_columns, classifierGuidedMode.enabled, stratifiedBins.length, isFocusMode]);

  // Reset active clip to first clip when page or bin changes (unless it's a layout change)
  useEffect(() => {
    if (!isLayoutChanging.current) {
      setActiveClipIndexOnPage(0);
    }
  }, [currentPage, currentBinIndex]);

  // Sync focus clip index with active clip when entering focus mode
  useEffect(() => {
    if (isFocusMode) {
      if (classifierGuidedMode.enabled && stratifiedBins.length > 0) {
        // In CGL mode, get the active clip from the current bin
        const currentBin = stratifiedBins[currentBinIndex];
        if (currentBin && currentBin.clips[activeClipIndexOnPage]) {
          const activeClip = currentBin.clips[activeClipIndexOnPage];
          const absoluteIndex = filteredAnnotationData.findIndex(clip => clip.id === activeClip.id);
          if (absoluteIndex !== -1) {
            setFocusClipIndex(absoluteIndex);
          }
        }
      } else {
        // Normal mode: Calculate absolute index from page and active clip index
        const absoluteIndex = currentPage * itemsPerPage + activeClipIndexOnPage;
        // Make sure it's within bounds of filtered data
        if (absoluteIndex < filteredAnnotationData.length) {
          setFocusClipIndex(absoluteIndex);
        }
      }
    }
  }, [isFocusMode]); // Only run when entering/exiting focus mode

  // Sync currentBinIndex when navigating in focus mode (CGL only)
  useEffect(() => {
    if (isFocusMode && classifierGuidedMode.enabled && stratifiedBins.length > 0) {
      const currentClip = filteredAnnotationData[focusClipIndex];
      if (currentClip) {
        // Find which bin contains the current focus clip
        const binIdx = stratifiedBins.findIndex(bin =>
          bin.clips.some(clip => clip.id === currentClip.id)
        );
        if (binIdx !== -1 && binIdx !== currentBinIndex) {
          setCurrentBinIndex(binIdx);
        }
      }
    }
  }, [focusClipIndex, isFocusMode, classifierGuidedMode.enabled, stratifiedBins]);

  // Sync page/active clip when exiting focus mode
  useEffect(() => {
    if (!isFocusMode && focusClipIndex >= 0) {
      if (classifierGuidedMode.enabled && stratifiedBins.length > 0) {
        // In CGL mode, find which bin and position the focus clip is at
        const currentClip = filteredAnnotationData[focusClipIndex];
        if (currentClip) {
          const binIdx = stratifiedBins.findIndex(bin =>
            bin.clips.some(clip => clip.id === currentClip.id)
          );
          if (binIdx !== -1) {
            const bin = stratifiedBins[binIdx];
            const clipIdxInBin = bin.clips.findIndex(clip => clip.id === currentClip.id);
            if (clipIdxInBin !== -1) {
              setCurrentBinIndex(binIdx);
              setActiveClipIndexOnPage(clipIdxInBin);
            }
          }
        }
      } else {
        // Normal mode: Calculate page and active clip index from absolute focus index
        const newPage = Math.floor(focusClipIndex / itemsPerPage);
        const newActiveClipIndex = focusClipIndex % itemsPerPage;
        if (newPage !== currentPage) {
          setCurrentPage(newPage);
        }
        setActiveClipIndexOnPage(newActiveClipIndex);
      }
    }
  }, [isFocusMode]); // Only run when entering/exiting focus mode

  // Trigger autoplay when active clip advances after annotation (grid mode only)
  useEffect(() => {
    if (!isFocusMode && shouldAutoplayNextClip.current && activeClipAudioControlsRef.current) {
      // Use setTimeout to ensure the new clip's audio is ready
      const timer = setTimeout(() => {
        // First, pause the previous clip if it was playing
        if (previousClipAudioControlsRef.current?.pause) {
          previousClipAudioControlsRef.current.pause();
        }

        // Then play the new active clip
        if (activeClipAudioControlsRef.current?.play) {
          activeClipAudioControlsRef.current.play();
          shouldAutoplayNextClip.current = false;
        }
      }, 100); // Small delay to ensure audio element is ready

      return () => clearTimeout(timer);
    }
  }, [activeClipIndexOnPage, isFocusMode]); // Trigger when active clip changes

  // Auto-advance functionality removed - user will see bin completion status in display above grid

  // Auto-save on page/bin changes (only trigger when page or bin actually changes)
  useEffect(() => {
    if (annotationData.length > 0 && autoSaveEnabled && hasUnsavedChanges) {
      performAutoSave();
    }
  }, [currentPage, currentBinIndex]); // Trigger on page changes (normal mode) or bin changes (CGL mode)

  // Auto-save on focus clip navigation (focus mode only)
  useEffect(() => {
    if (isFocusMode && annotationData.length > 0 && autoSaveEnabled && hasUnsavedChanges) {
      performAutoSave();
    }
  }, [focusClipIndex, isFocusMode]); // Only trigger on clip navigation, not on annotation changes

  // Clear save path on app startup
  useEffect(() => {
    // Clear save path on app restart
    setCurrentSavePath(null);
    localStorage.removeItem('review_autosave_location');
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = async (event) => {
      // Ctrl/Cmd+S for Save
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (annotationData.length > 0) {
          // Use the updated handleSave function to avoid race conditions
          handleSave();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [annotationData.length, currentSavePath]);

  // Note: currentDataVersion is now incremented directly in the file loading functions
  // (loadAndProcessCSV and loadAndProcessCSVFromFile) to ensure spectrograms load
  // on initial file load. The previous approach of detecting length changes was flawed
  // because it didn't work when loading a new file with the same number of clips.

  // Track previous config to detect when user changes settings (vs just data updating)
  const prevConfigRef = useRef({
    enabled: false,
    stratificationColumns: [],
    sortStrategy: 'original',
    scoreColumn: null,
    maxClipsPerBin: 20
  });

  // Generate stratified bins when classifier-guided mode config changes
  useEffect(() => {
    if (classifierGuidedMode.enabled && filteredAnnotationData.length > 0) {
      const bins = createStratifiedBins(filteredAnnotationData, {
        stratificationColumns: classifierGuidedMode.stratificationColumns,
        sortStrategy: classifierGuidedMode.sortStrategy,
        scoreColumn: classifierGuidedMode.scoreColumn,
        maxClipsPerBin: classifierGuidedMode.maxClipsPerBin
      });
      setStratifiedBins(bins);

      // Only reset to first bin if configuration changed (not just data updated)
      const configChanged =
        prevConfigRef.current.enabled !== classifierGuidedMode.enabled ||
        JSON.stringify(prevConfigRef.current.stratificationColumns) !== JSON.stringify(classifierGuidedMode.stratificationColumns) ||
        prevConfigRef.current.sortStrategy !== classifierGuidedMode.sortStrategy ||
        prevConfigRef.current.scoreColumn !== classifierGuidedMode.scoreColumn ||
        prevConfigRef.current.maxClipsPerBin !== classifierGuidedMode.maxClipsPerBin;

      if (configChanged) {
        setCurrentBinIndex(0); // Reset to first bin only when config changes
        prevConfigRef.current = {
          enabled: classifierGuidedMode.enabled,
          stratificationColumns: [...classifierGuidedMode.stratificationColumns],
          sortStrategy: classifierGuidedMode.sortStrategy,
          scoreColumn: classifierGuidedMode.scoreColumn,
          maxClipsPerBin: classifierGuidedMode.maxClipsPerBin
        };
      }
      // Otherwise keep current bin index - just update bin contents with new annotation data
    } else {
      setStratifiedBins([]);
      setCurrentBinIndex(0);
    }
  }, [
    classifierGuidedMode.enabled,
    classifierGuidedMode.stratificationColumns,
    classifierGuidedMode.sortStrategy,
    classifierGuidedMode.scoreColumn,
    classifierGuidedMode.maxClipsPerBin,
    filteredAnnotationData
  ]);

  // Note: Manual classes are now applied via explicit button clicks in ReviewSettings
  // No automatic updates when manual_classes changes

  // Load unified config from localStorage on mount
  useEffect(() => {
    const config = loadConfigFromLocalStorage();
    if (config) {
      if (config.view_settings) {
        setSettings(config.view_settings);
      }
      if (config.cgl_settings) {
        setClassifierGuidedMode(config.cgl_settings);
      }
      console.log('Loaded config from localStorage');
    }
  }, []);

  // Save unified config to localStorage whenever settings or CGL config changes
  useEffect(() => {
    const config = getUnifiedConfig();
    saveConfigToLocalStorage(config);
  }, [settings, classifierGuidedMode]);

  const handleLoadAnnotationTask = async () => {
    try {
      const files = await selectCSVFiles();
      if (files && files.length > 0) {
        setSelectedFile(files[0]);
        await loadAndProcessCSV(files[0], false); // false = not wide format
      }
    } catch (err) {
      setError('Failed to select file: ' + err.message);
    }
  };

  const handleLoadWideFormatCSV = async () => {
    try {
      const files = await selectCSVFiles();
      if (files && files.length > 0) {
        setSelectedFile(files[0]);
        await loadAndProcessCSV(files[0], true); // true = wide format
      }
    } catch (err) {
      setError('Failed to select file: ' + err.message);
    }
  };

  const handleCloseAnnotationTask = (event) => {
    // Prevent any default behavior
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    // Reset all state to initial values
    setSelectedFile('');
    setAnnotationData([]);
    setLoading(false);
    setError('');
    setCurrentPage(0);
    setAvailableClasses([]);
    setHasUnsavedChanges(false);
    setLoadedPageData([]);
    setLastRenderedPage(0);
    setLastRenderedBinIndex(0);
    setLastRenderedFocusClipIndex(0);
    setIsPageTransitioning(false);
    setRootAudioPath('');
    setIsFocusMode(false);
    setFocusClipIndex(0);
    setActiveClipIndexOnPage(0);
    setGridModeAutoplay(false);
    setClassifierGuidedMode({
      enabled: false,
      stratificationColumns: [],
      scoreColumn: null,
      sortStrategy: 'original',
      maxClipsPerBin: 20,
      completionStrategy: 'all',
      completionTargetCount: 1,
      completionTargetLabels: []
    });
    setStratifiedBins([]);
    setCurrentBinIndex(0);
    setFilters({
      annotation: { enabled: false, values: [] },
      labels: { enabled: false, values: [] },
      annotation_status: { enabled: false, values: [] }
    });
    setAppliedFilters({
      annotation: { enabled: false, values: [] },
      labels: { enabled: false, values: [] },
      annotation_status: { enabled: false, values: [] }
    });
    setCurrentSavePath(null);

    // Reset refs
    activeClipAudioControlsRef.current = null;
    previousClipAudioControlsRef.current = null;
    shouldAutoplayNextClip.current = false;
    isLayoutChanging.current = false;
  };

  const handleFileInputChange = async (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file.name);
      await loadAndProcessCSVFromFile(file);
    }
  };

  const loadAndProcessCSVFromFile = async (file) => {
    setLoading(true);
    setError('');

    // Clear old data immediately to prevent loading spectrograms with mismatched data
    setAnnotationData([]);
    setLoadedPageData([]);

    try {
      const text = await file.text();
      const data = parseAnnotationCSV(text);
      setAnnotationData(data);
      extractAvailableClasses(data);
      setCurrentPage(0);
      setLastRenderedPage(0); // Reset to page 0
      setFocusClipIndex(0);
      setLastRenderedFocusClipIndex(0); // Reset focus clip index
      setHasUnsavedChanges(false);
      // Clear loaded page data so it will load fresh
      setLoadedPageData([]);
      // Clear filters when new file is loaded
      clearFilters();
      // Restore CGL config from localStorage
      const config = loadConfigFromLocalStorage();
      if (config && config.cgl_settings) {
        setClassifierGuidedMode(config.cgl_settings);
      }
      setStratifiedBins([]);
      setCurrentBinIndex(0);
      // Clear save path when new annotation file is loaded
      setCurrentSavePath(null);
      localStorage.removeItem('review_autosave_location');
      // Force spectrogram reload by incrementing data version
      setCurrentDataVersion(prev => prev + 1);
    } catch (err) {
      setError('Failed to parse CSV file: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadAndProcessCSV = async (filePath, wideFormat = false) => {
    setLoading(true);
    setError('');

    // Clear old data immediately to prevent loading spectrograms with mismatched data
    setAnnotationData([]);
    setLoadedPageData([]);

    try {
      // Always set root audio path to directory containing the CSV file
      const savedSettings = localStorage.getItem('review_settings');
      let currentSettings = settings;
      if (savedSettings) {
        currentSettings = JSON.parse(savedSettings);
      }

      // Set root audio path to directory containing the CSV file
      const csvDirectory = dirname(filePath);
      setRootAudioPath(csvDirectory);
      // Save to localStorage (keeping it with settings for now but will move it out)
      const newSettings = { ...currentSettings, root_audio_path: csvDirectory };
      localStorage.setItem('review_settings', JSON.stringify(newSettings));

      // Use HTTP endpoint to load CSV file
      const response = await fetch(`${backendUrl}/review/load-task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          csv_path: filePath,
          threshold: 0,
          wide_format: wideFormat
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Loaded annotation data:', data);

      if (data.error) {
        console.error('Backend error:', data.error);
        setError(data.error);
      } else {
        setAnnotationData(data.clips);

        // Auto-detect review mode based on response format
        const hasLabelsField = data.clips.length > 0 && 'labels' in data.clips[0];
        const hasAnnotationField = data.clips.length > 0 && 'annotation' in data.clips[0];

        if (hasLabelsField && !hasAnnotationField) {
          // Multi-class mode
          setSettings(prev => ({ ...prev, review_mode: 'multiclass' }));
        } else if (hasAnnotationField && !hasLabelsField) {
          // Binary mode
          setSettings(prev => ({ ...prev, review_mode: 'binary' }));
        }

        // Update class list if classes were provided
        if (data.classes && Array.isArray(data.classes) && data.classes.length > 0) {
          setSettings(prev => ({
            ...prev,
            manual_classes: data.classes.join('\n')
          }));
        }

        // Update clip duration if provided
        if (data.duration !== null && data.duration !== undefined && !isNaN(data.duration)) {
          setSettings(prev => ({
            ...prev,
            clip_duration: parseFloat(data.duration)
          }));
        }

        extractAvailableClasses(data.clips);
        setCurrentPage(0);
        setLastRenderedPage(0); // Reset to page 0
        setFocusClipIndex(0);
        setLastRenderedFocusClipIndex(0); // Reset focus clip index
        setHasUnsavedChanges(false);
        // Clear loaded page data so it will load fresh
        setLoadedPageData([]);
        // Clear filters when new file is loaded
        clearFilters();
        // Restore CGL config from localStorage
        const config = loadConfigFromLocalStorage();
        if (config && config.cgl_settings) {
          setClassifierGuidedMode(config.cgl_settings);
        }
        setStratifiedBins([]);
        setCurrentBinIndex(0);
        // Clear save path when new annotation file is loaded
        setCurrentSavePath(null);
        localStorage.removeItem('review_autosave_location');
        // Force spectrogram reload by incrementing data version
        setCurrentDataVersion(prev => prev + 1);
      }
    } catch (err) {
      console.error('Failed to load annotation task:', err);
      console.error('Error stack:', err.stack);

      // Try to write error to a log file for debugging
      const errorLog = `Error loading annotation task at ${new Date().toISOString()}:\n${err.message}\n${err.stack}\n\n`;
      try {
        await writeFile('/tmp/annotation_errors.log', errorLog);
      } catch (logErr) {
        console.error('Could not write to error log:', logErr);
      }

      setError('Failed to load annotation task: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const parseAnnotationCSV = (csvText) => {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV file appears to be empty or invalid');
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const dataLines = lines.slice(1);

    console.log('CSV Headers:', headers);

    // Validate required columns
    const requiredColumns = ['file', 'start_time'];
    const missingColumns = requiredColumns.filter(col => !headers.includes(col));
    if (missingColumns.length > 0) {
      throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
    }

    // Store CSV columns for annotation column selector
    setCsvColumns(headers);

    // Auto-detect review mode based on available columns
    const hasAnnotationColumn = headers.includes('annotation');
    const hasLabelsColumn = headers.includes('labels');

    let detectedReviewMode = 'binary'; // default
    if (hasAnnotationColumn) {
      // If annotation column exists, prefer binary mode
      detectedReviewMode = 'binary';
    } else if (hasLabelsColumn && !hasAnnotationColumn) {
      detectedReviewMode = 'multiclass';
    }

    console.log('Detected review mode:', detectedReviewMode, { hasAnnotationColumn, hasLabelsColumn });

    // Update settings with detected mode
    setSettings(prev => ({ ...prev, review_mode: detectedReviewMode }));

    const clips = [];

    dataLines.forEach((line, index) => {
      if (!line.trim()) return; // Skip empty lines

      const values = line.split(',').map(v => v.trim().replace(/"/g, ''));

      if (values.length !== headers.length) {
        console.warn(`Row ${index + 2} has ${values.length} values but expected ${headers.length}`);
        return;
      }

      const rowData = {};
      headers.forEach((header, i) => {
        rowData[header] = values[i];
      });

      // Parse numeric values and preserve all CSV columns
      const clip = {
        ...rowData,  // Preserve all CSV columns including metadata
        file: rowData.file || '',
        start_time: parseFloat(rowData.start_time) || 0,
        end_time: parseFloat(rowData.end_time) || parseFloat(rowData.start_time) + 3, // Default 3 sec if no end_time
        annotation: rowData.annotation || '',
        labels: rowData.labels || '',
        annotation_status: rowData.annotation_status || 'unreviewed',
        comments: rowData.comments || '',
        id: index
      };

      clips.push(clip);
    });

    return clips;
  };

  const extractAvailableClasses = (clips) => {
    const classSet = new Set();

    // Add manual classes from settings
    if (settings.manual_classes) {
      const manualClasses = settings.manual_classes
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      manualClasses.forEach(cls => classSet.add(cls));

      // If manual classes are provided, only use those (don't extract from clips)
      // This ensures when user changes manual classes, old values don't persist
      if (manualClasses.length > 0) {
        setAvailableClasses(Array.from(classSet).sort());
        return;
      }
    }

    // Only add classes from clips if no manual classes are specified
    clips.forEach(clip => {
      if (settings.review_mode === 'multiclass') {
        // Use labels column for multiclass
        const labelsValue = clip.labels || '';
        if (labelsValue && labelsValue !== '' && labelsValue !== 'nan') {
          try {
            // Parse multiclass labels
            let classes = [];
            if (labelsValue.startsWith('[') && labelsValue.endsWith(']')) {
              classes = JSON.parse(labelsValue.replace(/'/g, '"'));
            } else {
              classes = labelsValue.split(',').map(s => s.trim()).filter(s => s);
            }
            classes.forEach(cls => classSet.add(cls));
          } catch (e) {
            // Fallback: treat as single class
            classSet.add(labelsValue);
          }
        }
      }
    });

    setAvailableClasses(Array.from(classSet).sort());
  };

  // Subset clip labels to only include classes in availableClasses
  const subsetClipLabels = useCallback((clips, availableClassesArray) => {
    if (settings.review_mode !== 'multiclass') {
      return clips; // Only applies to multiclass mode
    }

    return clips.map(clip => {
      const labelsValue = clip.labels || '';
      if (!labelsValue || labelsValue === '' || labelsValue === 'nan') {
        return clip; // No labels to subset
      }

      try {
        // Parse multiclass labels
        let classes = [];
        if (labelsValue.startsWith('[') && labelsValue.endsWith(']')) {
          classes = JSON.parse(labelsValue.replace(/'/g, '"'));
        } else {
          classes = labelsValue.split(',').map(s => s.trim()).filter(s => s);
        }

        // Filter to only include classes in availableClassesArray
        const filteredClasses = classes.filter(cls => availableClassesArray.includes(cls));

        // Convert back to string format
        const newLabelsValue = filteredClasses.length > 0
          ? JSON.stringify(filteredClasses)
          : '';

        return {
          ...clip,
          labels: newLabelsValue
        };
      } catch (e) {
        // Fallback: treat as single class
        const isValidClass = availableClassesArray.includes(labelsValue);
        return {
          ...clip,
          labels: isValidClass ? labelsValue : ''
        };
      }
    });
  }, [settings.review_mode]);

  // Handler for "Change Visible Classes" button - only updates the class list
  const handleApplyClassesOnly = useCallback((manualClassesText) => {
    // Update settings with new manual_classes
    setSettings(prev => ({ ...prev, manual_classes: manualClassesText }));

    // Re-extract available classes (this will include both manual and CSV classes)
    extractAvailableClasses(annotationData);

    console.log('Applied visible classes only (no label subsetting)');
  }, [annotationData]);

  // Handler for "Change Classes + Subset Labels" button - updates classes AND subsets labels
  const handleApplyClassesAndSubset = useCallback((manualClassesText) => {
    // Update settings with new manual_classes
    setSettings(prev => ({ ...prev, manual_classes: manualClassesText }));

    // Get the new class list
    const manualClasses = manualClassesText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    // Set as available classes (only manual classes, no CSV extraction)
    setAvailableClasses(manualClasses.sort());

    // Subset the clip labels to only include the new classes
    const subsetData = subsetClipLabels(annotationData, manualClasses);
    setAnnotationData(subsetData);
    setHasUnsavedChanges(true);

    console.log('Applied classes and subset labels to:', manualClasses);
  }, [annotationData, subsetClipLabels]);

  const handleAnnotationChange = useCallback((clipId, newAnnotation, newAnnotationStatus) => {
    setAnnotationData(prev => {
      // Find the index of the clip to update
      const clipIndex = prev.findIndex(clip => clip.id === clipId);
      if (clipIndex === -1) return prev;

      // Create updates object
      const updates = {};
      if (settings.review_mode === 'binary') {
        updates.annotation = newAnnotation;
      } else {
        updates.labels = newAnnotation;
        if (newAnnotationStatus !== undefined) {
          updates.annotation_status = newAnnotationStatus;
        }
      }

      // Only update if there are actual changes
      const currentClip = prev[clipIndex];
      const hasChanges = Object.keys(updates).some(key => currentClip[key] !== updates[key]);
      if (!hasChanges) return prev;

      // Create new array with minimal changes
      const newArray = [...prev];
      newArray[clipIndex] = { ...currentClip, ...updates };
      return newArray;
    });
    setHasUnsavedChanges(true);

    // Individual annotation changes don't trigger auto-save - only page/navigation changes do
  }, [settings.review_mode]);

  const handleCommentChange = useCallback((clipId, newComment) => {
    setAnnotationData(prev => {
      // Find the index of the clip to update
      const clipIndex = prev.findIndex(clip => clip.id === clipId);
      if (clipIndex === -1) return prev;

      const currentClip = prev[clipIndex];
      // Only update if comment actually changed
      if (currentClip.comments === newComment) return prev;

      // Create new array with minimal changes
      const newArray = [...prev];
      newArray[clipIndex] = { ...currentClip, comments: newComment };
      return newArray;
    });
    setHasUnsavedChanges(true);
  }, []);

  // Focus mode navigation
  const handleFocusNavigation = useCallback((direction) => {
    if (direction === 'next') {
      setFocusClipIndex(prev => Math.min(annotationData.length - 1, prev + 1));
    } else if (direction === 'previous') {
      setFocusClipIndex(prev => Math.max(0, prev - 1));
    }
  }, [annotationData.length]);

  // Focus mode annotation change
  const handleFocusAnnotationChange = useCallback((newAnnotation, newAnnotationStatus) => {
    const currentClip = filteredAnnotationData[focusClipIndex];
    if (currentClip) {
      handleAnnotationChange(currentClip.id, newAnnotation, newAnnotationStatus);
    }
  }, [focusClipIndex, filteredAnnotationData, handleAnnotationChange]);

  // Focus mode comment change
  const handleFocusCommentChange = useCallback((newComment) => {
    const currentClip = filteredAnnotationData[focusClipIndex];
    if (currentClip) {
      handleCommentChange(currentClip.id, newComment);
    }
  }, [focusClipIndex, filteredAnnotationData, handleCommentChange]);

  // Reset focus index when data changes
  useEffect(() => {
    if (filteredAnnotationData.length > 0 && focusClipIndex >= filteredAnnotationData.length) {
      setFocusClipIndex(0);
    }
  }, [filteredAnnotationData.length, focusClipIndex]);

  // Get available filter options
  const getFilterOptions = useMemo(() => {
    const options = {
      annotation: new Set(),
      labels: new Set(),
      annotation_status: new Set()
    };

    annotationData.forEach(clip => {
      // Binary annotation options
      const annotation = clip.annotation || 'unlabeled';
      options.annotation.add(annotation);

      // Multi-class label options
      if (clip.labels) {
        try {
          let labels = [];
          if (clip.labels.startsWith('[') && clip.labels.endsWith(']')) {
            labels = JSON.parse(clip.labels.replace(/'/g, '"'));
          } else {
            labels = clip.labels.split(',').map(s => s.trim()).filter(s => s);
          }
          labels.forEach(label => options.labels.add(label));
        } catch (e) {
          // Ignore parsing errors
        }
      }

      // Annotation status options
      const status = clip.annotation_status || 'unreviewed';
      options.annotation_status.add(status);
    });

    return {
      annotation: Array.from(options.annotation).sort(),
      labels: Array.from(options.labels).sort(),
      annotation_status: Array.from(options.annotation_status).sort()
    };
  }, [annotationData]);

  // Handle filter changes (just update the UI state, don't apply yet)
  const handleFilterChange = useCallback((filterType, enabled, values) => {
    setFilters(prev => ({
      ...prev,
      [filterType]: { enabled, values }
    }));
  }, []);

  // Apply filters function
  const applyFilters = useCallback(() => {
    setAppliedFilters(filters);
    setCurrentPage(0); // Reset to first page when filters are applied
    setLastRenderedPage(0); // Reset rendered page tracker
    setFocusClipIndex(0);
    setLastRenderedFocusClipIndex(0); // Reset focus clip index
  }, [filters]);

  // Clear filters function
  const clearFilters = useCallback(() => {
    const emptyFilters = {
      annotation: { enabled: false, values: [] },
      labels: { enabled: false, values: [] },
      annotation_status: { enabled: false, values: [] }
    };
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setCurrentPage(0);
    setLastRenderedPage(0); // Reset rendered page tracker
    setFocusClipIndex(0);
    setLastRenderedFocusClipIndex(0); // Reset focus clip index
  }, []);

  // Check if filters have changed since last apply
  const hasUnappliedFilterChanges = useMemo(() => {
    return JSON.stringify(filters) !== JSON.stringify(appliedFilters);
  }, [filters, appliedFilters]);

  // Annotate active clip and advance to next
  const handleActiveClipAnnotation = useCallback((annotationValue) => {
    if (currentPageData.length === 0) return;

    const activeClip = currentPageData[activeClipIndexOnPage];
    if (!activeClip) return;

    // Annotate the active clip
    handleAnnotationChange(activeClip.id, annotationValue, undefined);

    // Set flag for autoplay if enabled
    if (gridModeAutoplay) {
      shouldAutoplayNextClip.current = true;
    }

    // Advance to next clip within current page/bin
    if (activeClipIndexOnPage < currentPageData.length - 1) {
      // Move to next clip on current page/bin
      setActiveClipIndexOnPage(prev => prev + 1);
    } else {
      // Last clip on page/bin
      // In classifier-guided mode, do NOT auto-advance to next bin
      // In normal mode, advance to next page
      if (!classifierGuidedMode.enabled && currentPage < totalPages - 1) {
        setCurrentPage(prev => prev + 1);
        // activeClipIndexOnPage will be reset to 0 by the useEffect
      }
    }
  }, [currentPageData, activeClipIndexOnPage, handleAnnotationChange, currentPage, totalPages, gridModeAutoplay, classifierGuidedMode.enabled]);

  // Navigate active clip within page
  const handleActiveClipNavigation = useCallback((direction) => {
    if (direction === 'next' && activeClipIndexOnPage < currentPageData.length - 1) {
      setActiveClipIndexOnPage(prev => prev + 1);
    } else if (direction === 'previous' && activeClipIndexOnPage > 0) {
      setActiveClipIndexOnPage(prev => prev - 1);
    }
  }, [activeClipIndexOnPage, currentPageData.length]);

  // Count completed bins in classifier-guided mode
  const getCompletedBinsCount = useCallback(() => {
    if (!classifierGuidedMode.enabled || stratifiedBins.length === 0) {
      return { completed: 0, total: 0 };
    }

    const completedCount = stratifiedBins.filter(bin => {
      return isBinComplete(
        bin.clips,
        settings.review_mode,
        {
          strategy: classifierGuidedMode.completionStrategy,
          targetCount: classifierGuidedMode.completionTargetCount,
          targetLabels: classifierGuidedMode.completionTargetLabels
        }
      );
    }).length;

    return { completed: completedCount, total: stratifiedBins.length };
  }, [classifierGuidedMode, stratifiedBins, settings.review_mode]);

  // Get the active clip index within the current bin (1-based for display)
  const getActiveClipIndexInBin = useCallback((binIndex, clipId) => {
    if (!classifierGuidedMode.enabled || stratifiedBins.length === 0 || binIndex >= stratifiedBins.length) {
      return { clipIndex: 0, totalClips: 0 };
    }

    const bin = stratifiedBins[binIndex];
    const clipIndexInBin = bin.clips.findIndex(clip => clip.id === clipId);

    return {
      clipIndex: clipIndexInBin !== -1 ? clipIndexInBin + 1 : 1, // 1-based for display
      totalClips: bin.clips.length
    };
  }, [classifierGuidedMode, stratifiedBins]);

  // Jump to next incomplete bin in classifier-guided mode
  const handleJumpToNextIncompleteBin = useCallback(() => {
    if (!classifierGuidedMode.enabled || stratifiedBins.length === 0) return;

    // Search for next incomplete bin starting from current + 1
    for (let i = currentBinIndex + 1; i < stratifiedBins.length; i++) {
      const bin = stratifiedBins[i];
      const binCompleteStatus = isBinComplete(
        bin.clips,
        settings.review_mode,
        {
          strategy: classifierGuidedMode.completionStrategy,
          targetCount: classifierGuidedMode.completionTargetCount,
          targetLabels: classifierGuidedMode.completionTargetLabels
        }
      );

      if (!binCompleteStatus) {
        setCurrentBinIndex(i);

        // If in grid mode, reset to first clip on page
        if (!isFocusMode) {
          setActiveClipIndexOnPage(0);
        } else {
          // If in focus mode, jump to first clip of this bin in the full filtered data
          const firstClipOfBin = bin.clips[0];
          if (firstClipOfBin) {
            const clipIndexInFullData = filteredAnnotationData.findIndex(clip => clip.id === firstClipOfBin.id);
            if (clipIndexInFullData !== -1) {
              setFocusClipIndex(clipIndexInFullData);
              console.log(`Jumped to incomplete bin ${i + 1}, clip index ${clipIndexInFullData}`);
            } else {
              console.warn('Could not find first clip of bin in filtered data');
            }
          }
        }
        return;
      }
    }

    // No incomplete bin found after current - wrap around and search from beginning
    for (let i = 0; i < currentBinIndex; i++) {
      const bin = stratifiedBins[i];
      const binCompleteStatus = isBinComplete(
        bin.clips,
        settings.review_mode,
        {
          strategy: classifierGuidedMode.completionStrategy,
          targetCount: classifierGuidedMode.completionTargetCount,
          targetLabels: classifierGuidedMode.completionTargetLabels
        }
      );

      if (!binCompleteStatus) {
        setCurrentBinIndex(i);

        // If in grid mode, reset to first clip on page
        if (!isFocusMode) {
          setActiveClipIndexOnPage(0);
        } else {
          // If in focus mode, jump to first clip of this bin in the full filtered data
          const firstClipOfBin = bin.clips[0];
          if (firstClipOfBin) {
            const clipIndexInFullData = filteredAnnotationData.findIndex(clip => clip.id === firstClipOfBin.id);
            if (clipIndexInFullData !== -1) {
              setFocusClipIndex(clipIndexInFullData);
              console.log(`Jumped to incomplete bin ${i + 1}, clip index ${clipIndexInFullData}`);
            } else {
              console.warn('Could not find first clip of bin in filtered data');
            }
          }
        }
        return;
      }
    }

    // All bins are complete - stay on current bin
    console.log('All bins are complete');
  }, [classifierGuidedMode, stratifiedBins, currentBinIndex, settings.review_mode, isFocusMode, filteredAnnotationData]);

  // Bulk annotation function for current page
  const handleBulkAnnotation = useCallback((annotationValue) => {
    const currentData = currentPageData;
    if (currentData.length === 0) return;

    // For yes/no/uncertain, only update unlabeled clips
    // For 'unlabeled', update all clips
    const onlyUpdateUnlabeled = annotationValue !== 'unlabeled';

    setAnnotationData(prev => {
      const newArray = [...prev];
      currentData.forEach(clip => {
        const clipIndex = newArray.findIndex(c => c.id === clip.id);
        if (clipIndex !== -1) {
          const currentClip = newArray[clipIndex];
          const isUnlabeled = !currentClip.annotation || currentClip.annotation === '';

          // Only update if: setting to unlabeled OR clip is currently unlabeled
          if (!onlyUpdateUnlabeled || isUnlabeled) {
            newArray[clipIndex] = {
              ...currentClip,
              annotation: annotationValue === 'unlabeled' ? '' : annotationValue
            };
          }
        }
      });
      return newArray;
    });
    setHasUnsavedChanges(true);
  }, [currentPageData]);

  // Keyboard shortcuts for both grid and focus view
  useEffect(() => {
    if (!settings.keyboard_shortcuts_enabled) return;

    const handleKeyDown = (event) => {
      // Check if user is typing in a text field
      const isTyping = (
        event.target.tagName === "TEXTAREA" ||
        (event.target.tagName === "INPUT" && event.target.type === "text") ||
        (event.target.tagName === "INPUT" && event.target.type === "number")
      );

      // Don't handle shortcuts if user is typing
      if (isTyping) return;

      const isMac = navigator.userAgent.includes('Mac') || navigator.userAgent.includes('macOS');
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

      // Always allow standard copy/paste/cut shortcuts to work normally
      // BUT allow Ctrl/Cmd+Shift+C for toggling comments
      if (cmdOrCtrl && ['c', 'v', 'x'].includes(event.key.toLowerCase())) {
        if (!(event.key.toLowerCase() === 'c' && event.shiftKey)) {
          return;
        }
      }

      // Handle Escape key for focus/grid toggle (works in both modes)
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsFocusMode(prev => !prev);
        return;
      }

      // Handle Ctrl/Cmd shortcuts
      if (cmdOrCtrl) {
        // Prevent default behavior for our shortcuts
        const shortcutKeys = ['a', 's', 'd', 'f', 'j', 'k', 'c', 'o', ','];
        if (shortcutKeys.includes(event.key.toLowerCase())) {
          event.preventDefault();
        }

        // Handle global shortcuts (work in both grid and focus mode)
        switch (event.key.toLowerCase()) {
          case 's':
            if (!event.shiftKey) {
              // Ctrl/Cmd+S: Save annotations
              handleSave();
              return;
            }
            break;
          case 'o':
            // Ctrl/Cmd+O: Open annotation file
            handleLoadAnnotationTask();
            return;
          case ',':
            // Ctrl/Cmd+,: Open settings panel
            setIsSettingsPanelOpen(true);
            return;
          case 'c':
            if (event.shiftKey && !isFocusMode) {
              // Cmd/Ctrl+Shift+C: toggle comments (grid mode only)
              handleSettingsChange({ ...settings, show_comments: !settings.show_comments });
              return;
            }
            break;
          case 'k':
            if (event.shiftKey) {
              // Cmd/Ctrl+Shift+K: jump to next incomplete bin (CGL mode only, works in both grid and focus)
              if (classifierGuidedMode.enabled && stratifiedBins.length > 0) {
                handleJumpToNextIncompleteBin();
                return;
              }
            }
            break;
        }
      }

      // Grid mode only shortcuts (with Cmd/Ctrl)
      if (!isFocusMode && cmdOrCtrl) {
        switch (event.key.toLowerCase()) {
          case 'j':
            // Cmd/Ctrl+J: previous page/bin
            if (classifierGuidedMode.enabled && stratifiedBins.length > 0) {
              if (currentBinIndex > 0) {
                setCurrentBinIndex(prev => prev - 1);
              }
            } else {
              if (currentPage > 0) {
                setCurrentPage(prev => prev - 1);
              }
            }
            break;
          case 'k':
            // Cmd/Ctrl+K: next page/bin (grid mode only, Shift+K handled globally)
            if (!event.shiftKey) {
              if (classifierGuidedMode.enabled && stratifiedBins.length > 0) {
                if (currentBinIndex < stratifiedBins.length - 1) {
                  setCurrentBinIndex(prev => prev + 1);
                }
              } else {
                if (currentPage < totalPages - 1) {
                  setCurrentPage(prev => prev + 1);
                }
              }
            }
            break;
          default:
            break;
        }
      }

      // Grid mode shortcuts WITHOUT Cmd/Ctrl (only in grid mode, not focus mode)
      if (!isFocusMode && !cmdOrCtrl) {
        // Spacebar: play/pause active clip audio
        if (event.key === ' ') {
          event.preventDefault();
          if (activeClipAudioControlsRef.current?.togglePlayPause) {
            activeClipAudioControlsRef.current.togglePlayPause();
          }
          return;
        }

        // Shift+A/S/D/F: bulk annotate (binary mode only)
        if (event.shiftKey && settings.review_mode === 'binary') {
          switch (event.key.toLowerCase()) {
            case 'a':
              // Shift+A: Bulk annotate as Yes
              event.preventDefault();
              handleBulkAnnotation('yes');
              return;
            case 's':
              // Shift+S: Bulk annotate as No
              event.preventDefault();
              handleBulkAnnotation('no');
              return;
            case 'd':
              // Shift+D: Bulk annotate as Uncertain
              event.preventDefault();
              handleBulkAnnotation('uncertain');
              return;
            case 'f':
              // Shift+F: Bulk annotate as Unlabeled
              event.preventDefault();
              handleBulkAnnotation('unlabeled');
              return;
            default:
              break;
          }
        }

        // Binary mode: a/s/d/f shortcuts (without Shift) to annotate active clip and advance
        if (!event.shiftKey && settings.review_mode === 'binary') {
          switch (event.key.toLowerCase()) {
            case 'a':
              // A: Mark active clip as Yes and advance
              event.preventDefault();
              handleActiveClipAnnotation('yes');
              break;
            case 's':
              // S: Mark active clip as No and advance
              event.preventDefault();
              handleActiveClipAnnotation('no');
              break;
            case 'd':
              // D: Mark active clip as Uncertain and advance
              event.preventDefault();
              handleActiveClipAnnotation('uncertain');
              break;
            case 'f':
              // F: Mark active clip as Unlabeled and advance
              event.preventDefault();
              handleActiveClipAnnotation('');
              break;
            default:
              break;
          }
        }

        // Navigation shortcuts: j/k to move active clip
        switch (event.key.toLowerCase()) {
          case 'j':
            // J: Move active clip to previous clip on page
            event.preventDefault();
            handleActiveClipNavigation('previous');
            break;
          case 'k':
            // K: Move active clip to next clip on page
            event.preventDefault();
            handleActiveClipNavigation('next');
            break;
          default:
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [settings, isFocusMode, currentPage, totalPages, handleBulkAnnotation, handleSettingsChange, handleActiveClipAnnotation, handleActiveClipNavigation, handleJumpToNextIncompleteBin, classifierGuidedMode.enabled, stratifiedBins.length, currentBinIndex]);

  // Load current focus clip spectrogram when in focus mode
  useEffect(() => {
    if (isFocusMode && annotationData.length > 0) {
      const currentClip = annotationData[focusClipIndex];
      const hasLoadedData = loadedPageData.find(loaded => loaded.clip_id === currentClip?.id);

      if (currentClip && !hasLoadedData) {
        // Load the current clip if it's not already loaded
        loadFocusClipSpectrogram(currentClip);
      }
    }
  }, [isFocusMode, focusClipIndex, annotationData, loadedPageData]);

  // Function to load spectrogram for a specific clip in focus mode
  const loadFocusClipSpectrogram = useCallback(async (clip) => {
    try {
      // Don't set transitioning state - keep old content visible until new content is ready
      // setIsPageTransitioning(true);

      const currentRootAudioPath = rootAudioPath || '';
      let fullFilePath = clip.file;
      if (currentRootAudioPath && !clip.file.startsWith('/') && !clip.file.match(/^[A-Za-z]:\\\\/)) {
        fullFilePath = `${currentRootAudioPath}/${clip.file}`;
      }

      const clipToLoad = {
        file_path: fullFilePath,
        start_time: clip.start_time,
        end_time: clip.end_time || clip.start_time + 3,
        clip_id: clip.id
      };

      // Get visualization settings
      const savedVisualizationSettings = localStorage.getItem('visualization_settings');
      let visualizationSettings;
      try {
        visualizationSettings = savedVisualizationSettings ? JSON.parse(savedVisualizationSettings) : null;
      } catch (e) {
        console.warn('Corrupted visualization settings in localStorage, using defaults');
        visualizationSettings = null;
      }

      if (!visualizationSettings) {
        visualizationSettings = {
          spec_window_size: 512,
          spectrogram_colormap: 'greys_r',
          dB_range: [-80, -20],
          use_bandpass: false,
          bandpass_range: [500, 8000],
          show_reference_frequency: false,
          reference_frequency: 1000,
          resize_images: true,
          image_width: 400,
          image_height: 200,
        };
      }

      // Use focus mode settings for focus mode
      const focusDimensions = getFocusImageDimensions(settings.focus_size);
      visualizationSettings = {
        ...visualizationSettings,
        resize_images: true, // Always resize for focus mode
        image_width: focusDimensions.width,
        image_height: focusDimensions.height,
      };

      const loadedClip = await httpLoader.loadClipsBatch([clipToLoad], visualizationSettings);

      if (loadedClip && loadedClip.length > 0) {
        setLoadedPageData(prev => {
          // Remove any existing data for this clip and add the new data
          const filtered = prev.filter(loaded => loaded.clip_id !== clip.id);
          return [...filtered, loadedClip[0]];
        });
        // Mark this clip as rendered now that it's loaded
        setLastRenderedFocusClipIndex(focusClipIndex);
      }
    } catch (error) {
      console.error('Failed to load focus clip spectrogram:', error);
    } finally {
      // Don't set transitioning state - no overlay shown
      // setIsPageTransitioning(false);
    }
  }, [rootAudioPath, httpLoader]);

  const handleSelectRootAudioPath = async () => {
    try {
      const folder = await selectFolder();
      if (folder) {
        setRootAudioPath(folder);
        // Save to localStorage
        const savedSettings = localStorage.getItem('review_settings');
        const currentSettings = savedSettings ? JSON.parse(savedSettings) : {};
        const newSettings = { ...currentSettings, root_audio_path: folder };
        localStorage.setItem('review_settings', JSON.stringify(newSettings));
      }
    } catch (err) {
      console.error('Failed to select root audio folder:', err);
    }
  };


  const performAutoSave = async () => {
    if (!autoSaveEnabled || !hasUnsavedChanges) return;

    try {
      // Use functional setState to ensure we have the most current state
      const autoSaveWithCurrentState = (currentData, currentSettings) => {
        return new Promise(async (resolve) => {
          try {
            let saveLocation = currentSavePath;

            // If no save path set, open save dialog
            if (!saveLocation) {
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
              const defaultName = `annotations_${timestamp}.csv`;

              saveLocation = await saveFile(defaultName);
              if (saveLocation) {
                setCurrentSavePath(saveLocation);
              } else {
                resolve(); // User cancelled save dialog
                return;
              }
            }

            if (saveLocation) {
              const csvContent = exportToCSV(currentData, currentSettings);
              await writeFile(saveLocation, csvContent);
              setHasUnsavedChanges(false);
              console.log('Auto-saved to:', saveLocation);
            }
          } catch (err) {
            console.error('Auto-save failed:', err);
          }
          resolve();
        });
      };

      // Access current state using functional setState pattern - get both data and settings
      setAnnotationData(currentData => {
        // Use functional setState to get current settings too
        setSettings(currentSettings => {
          autoSaveWithCurrentState(currentData, currentSettings);
          return currentSettings; // Don't modify the settings
        });
        return currentData; // Don't modify the data
      });
    } catch (err) {
      console.error('Auto-save failed:', err);
    }
  };

  const handleSave = async () => {
    try {
      // Use functional setState to ensure we have the most current state
      const saveWithCurrentState = (currentData, currentSettings) => {
        return new Promise(async (resolve, reject) => {
          try {
            // If we have a save path, use it directly
            if (currentSavePath) {
              const csvContent = exportToCSV(currentData, currentSettings);
              await writeFile(currentSavePath, csvContent);
              setHasUnsavedChanges(false);
              console.log('Saved to:', currentSavePath);
              resolve();
              return;
            }

            // No save path set, fall back to Save As behavior
            await handleSaveAsWithData(currentData, currentSettings);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      };

      // Access current state using functional setState pattern - get both data and settings
      setAnnotationData(currentData => {
        // Use functional setState to get current settings too
        setSettings(currentSettings => {
          saveWithCurrentState(currentData, currentSettings).catch(err => {
            console.error('Save failed:', err);
            setError('Save failed: ' + err.message);
          });
          return currentSettings; // Don't modify the settings
        });
        return currentData; // Don't modify the data
      });
    } catch (err) {
      console.error('Save failed:', err);
      setError('Save failed: ' + err.message);
    }
  };

  const handleSaveAsWithData = async (currentData, currentSettings) => {
    const csvContent = exportToCSV(currentData, currentSettings);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultName = `annotations_${timestamp}.csv`;

    const filePath = await saveFile(defaultName);
    if (filePath) {
      await writeFile(filePath, csvContent);
      setCurrentSavePath(filePath); // Set the save path for future auto-saves
      setHasUnsavedChanges(false);
    }
  };

  const handleSaveAs = async () => {
    try {
      // Simply use current state values directly
      // The nested setState pattern was causing multiple calls
      await handleSaveAsWithData(annotationData, settings);
    } catch (err) {
      console.error('Save As failed:', err);
      setError('Failed to export annotations: ' + err.message);
    }
  };

  const exportToCSV = (dataToExport = null, currentSettings = null) => {
    // Use provided data or current state (ensures we always have the latest data)
    const dataToUse = dataToExport || annotationData;
    const settingsToUse = currentSettings || settings;

    if (dataToUse.length === 0) {
      return '';
    }

    // Get all column names from the first clip, preserving order
    // Standard columns first, then annotation columns, then extra metadata columns
    const standardCols = ['file', 'start_time', 'end_time'];
    const annotationCols = settingsToUse.review_mode === 'multiclass'
      ? ['labels', 'annotation_status', 'comments']
      : ['annotation', 'comments'];
    const excludedCols = new Set([...standardCols, ...annotationCols, 'id', 'spectrogram_base64', 'audio_base64', 'clip_id']);

    // Get extra columns (metadata like card, date, grid, scores, etc.)
    const extraCols = Object.keys(dataToUse[0]).filter(col => !excludedCols.has(col));

    // Final column order: standard, annotation, then extra metadata
    const headers = [...standardCols, ...annotationCols, ...extraCols];

    const rows = dataToUse.map(clip => {
      return headers.map(header => {
        const value = clip[header];

        // Handle null/undefined
        if (value == null) {
          return null;
        }

        // Handle empty string annotations in binary mode
        if (header === 'annotation' && value === '') {
          return null;
        }

        // Handle empty/NaN comments
        if (header === 'comments' && (value === '' || Number.isNaN(value))) {
          return null;
        }

        return value;
      });
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(field => {
        // Properly handle field content for CSV
        // If field is null/undefined, output empty (no quotes)
        if (field == null) {
          return '';
        }
        // Convert to string and escape quotes
        const fieldStr = String(field);
        const escapedField = fieldStr.replace(/"/g, '""');
        return `"${escapedField}"`;
      }).join(','))
    ].join('\n');

    return csvContent;
  };

  const getGridDimensions = useCallback(() => {
    // In classifier-guided mode, use dynamic rows based on clips in bin
    if (classifierGuidedMode.enabled && currentPageData.length > 0) {
      const rows = Math.ceil(currentPageData.length / settings.grid_columns);
      return { rows, columns: settings.grid_columns };
    }
    return { rows: settings.grid_rows, columns: settings.grid_columns };
  }, [settings.grid_rows, settings.grid_columns, classifierGuidedMode.enabled, currentPageData.length]);



  const renderAnnotationGrid = useMemo(() => {
    // Determine which page/bin data to show
    // If we've moved to a new page/bin but spectrograms haven't loaded, show the old content
    const isOnNewPageOrBin = classifierGuidedMode.enabled
      ? (currentBinIndex !== lastRenderedBinIndex)
      : (currentPage !== lastRenderedPage);
    const hasLoadedNewContent = loadedPageData.length > 0 &&
      loadedPageData.some(loaded => currentPageData.some(clip => clip.id === loaded.clip_id));

    // Show old content if we're on a new page/bin but it hasn't loaded yet, otherwise show current
    const dataToShow = (isOnNewPageOrBin && !hasLoadedNewContent) ? lastRenderedPageData : currentPageData;

    if (dataToShow.length === 0) {
      return (
        <div className="no-data-message">
          <p>No clips to display on this page.</p>
        </div>
      );
    }

    // Don't show loading overlay - just keep old content visible until new content is ready
    // const showLoadingOverlay = httpLoader.isLoading || isPageTransitioning;

    // Calculate bin completion status for display
    const currentBin = classifierGuidedMode.enabled && stratifiedBins.length > 0
      ? stratifiedBins[currentBinIndex]
      : null;
    const isBinCompleteStatus = currentBin ? isBinComplete(
      currentBin.clips,
      settings.review_mode,
      {
        strategy: classifierGuidedMode.completionStrategy,
        targetCount: classifierGuidedMode.completionTargetCount,
        targetLabels: classifierGuidedMode.completionTargetLabels
      }
    ) : false;

    // Get bin completion stats
    const binCompletionStats = getCompletedBinsCount();
    const allBinsComplete = binCompletionStats.completed === binCompletionStats.total && binCompletionStats.total > 0;

    // Get active clip info within bin
    const activeClip = dataToShow[activeClipIndexOnPage];
    const activeClipInBin = activeClip ? getActiveClipIndexInBin(currentBinIndex, activeClip.id) : { clipIndex: 0, totalClips: 0 };

    return (
      <>
        {/* Bin Status Display for Classifier-Guided Mode */}
        {classifierGuidedMode.enabled && currentBin && (
          <div className={`bin-status-display ${isBinCompleteStatus ? 'complete' : 'incomplete'}`}>
            <div className="bin-status-header">
              <div className="bin-status-info">
                <span className="bin-status-label">
                  <b>Classifier Guided Listening</b> Bin {currentBinIndex + 1} of {stratifiedBins.length}
                  {activeClipInBin.totalClips > 0 && (
                    <span className="bin-clip-position"> • Clip {activeClipInBin.clipIndex} of {activeClipInBin.totalClips}</span>
                  )}
                </span>
                <span className={`bin-completion-badge ${isBinCompleteStatus ? 'complete' : 'incomplete'}`}>
                  {isBinCompleteStatus ? '✓ Complete' : 'In Progress'}
                </span>
              </div>
              <button
                className="jump-incomplete-btn"
                onClick={handleJumpToNextIncompleteBin}
                disabled={allBinsComplete}
                title={allBinsComplete ? "All bins complete" : "Jump to next incomplete bin (⌘⇧K)"}
              >
                <span className="material-symbols-outlined">fast_forward</span>
                Next Incomplete
              </button>
            </div>
            <div className="bin-stratification-values">
              {Object.entries(currentBin.values).map(([key, value]) => (
                <span key={key} className="bin-value-tag">
                  <strong>{key}:</strong> {String(value)}
                </span>
              ))}
            </div>
            <div className="bin-completion-stats">
              Completed bins: {binCompletionStats.completed}/{binCompletionStats.total}
            </div>
          </div>
        )}

        <div className="annotation-grid-container">
          <div
            className="annotation-grid"
            style={{
              '--rows': getGridDimensions().rows,
              '--cols': getGridDimensions().columns,
            }}
          >
            {dataToShow.map((clip, indexOnPage) => {
              // Find the loaded data for this clip
              const loadedClip = loadedPageData.find(loaded => loaded.clip_id === clip.id) || clip;
              const isActive = indexOnPage === activeClipIndexOnPage;

              return (
                <AnnotationCard
                  key={clip.id} // Use stable key to prevent unnecessary re-mounts
                  clipData={{
                    ...clip,
                    spectrogram_base64: loadedClip.spectrogram_base64,
                    audio_base64: loadedClip.audio_base64
                  }}
                  reviewMode={settings.review_mode}
                  availableClasses={availableClasses}
                  showComments={settings.show_comments}
                  showFileName={settings.show_file_name}
                  showBinaryControls={settings.show_binary_controls}
                  isActive={isActive}
                  onAnnotationChange={(annotation, annotationStatus) => handleAnnotationChange(clip.id, annotation, annotationStatus)}
                  onCommentChange={(comment) => handleCommentChange(clip.id, comment)}
                  onCardClick={() => setActiveClipIndexOnPage(indexOnPage)}
                  onPlayPause={isActive ? (audioControls) => {
                    // Store previous clip's controls before updating to new clip
                    if (activeClipAudioControlsRef.current) {
                      previousClipAudioControlsRef.current = activeClipAudioControlsRef.current;
                    }
                    // Store new active clip's controls
                    activeClipAudioControlsRef.current = audioControls;
                  } : undefined}
                  disableAutoLoad={true} // Use batch loading instead
                />
              );
            })}
          </div>

        </div>
      </>
    );
  }, [currentPage, lastRenderedPage, currentBinIndex, lastRenderedBinIndex, currentPageData, lastRenderedPageData, loadedPageData, activeClipIndexOnPage, httpLoader.isLoading, isPageTransitioning, httpLoader.progress, getGridDimensions, settings.review_mode, availableClasses, settings.show_comments, settings.show_file_name, settings.show_binary_controls, handleAnnotationChange, handleCommentChange, classifierGuidedMode, stratifiedBins]);

  return (
    <div className="review-tab-layout">
      {/* Global loading overlay - covers main content area while server initializes */}
      {serverInitializing && (
        <div className="loading-overlay">
          <div className="loading-content">
            <p>Initializing audio processing server...</p>
            <p style={{ fontSize: '0.9em', color: '#666', marginTop: '8px' }}>
              This may take a few seconds on first load while Python libraries are loaded.
            </p>
            {httpLoader.progress > 0 && (
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${httpLoader.progress}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}
      {/* Left Tray */}
      <Drawer
        anchor="left"
        open={isLeftTrayOpen}
        onClose={() => setIsLeftTrayOpen(false)}
        variant="temporary"
        sx={(theme) => ({
          '& .MuiDrawer-paper': {
            width: 400,
            boxSizing: 'border-box',
            backgroundColor: '#ffffff',
            fontFamily: 'Rokkitt, sans-serif',
            marginLeft: `calc(${theme.spacing(8)} + 1px)`, // Account for navigation drawer
            [theme.breakpoints.up('sm')]: {
              marginLeft: `calc(${theme.spacing(8)} + 1px)`
            }
          },
        })}
      >
        <div className="drawer-header">
          <h3 style={{ margin: 0, fontFamily: 'Rokkitt, sans-serif', fontSize: '1.1rem', fontWeight: 600 }}>
            Load Annotation Task
          </h3>
          <IconButton
            onClick={() => setIsLeftTrayOpen(false)}
            sx={{
              color: '#6b7280',
              '&:hover': { backgroundColor: '#f3f4f6' }
            }}
          >
            <CloseIcon />
          </IconButton>
        </div>
        <div className="drawer-content">
          {/* Load Annotation Task Section */}
          <div className="tray-section">
            <h4>Load Annotation Task</h4>
            <p>Load a CSV file for annotation review</p>

            <div className="button-group">
              <button onClick={handleLoadAnnotationTask} disabled={loading}>
                {loading ? 'Loading...' : 'Load Annotation CSV'}
              </button>
              <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '4px 0' }}>
                Standard format: Uses <strong>annotation</strong> column (binary) or <strong>labels</strong> column (multiclass)
              </p>
              <button
                onClick={handleLoadWideFormatCSV}
                disabled={loading}
                style={{ marginTop: '8px' }}
              >
                {loading ? 'Loading...' : 'Open Wide-format CSV'}
              </button>
              <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '4px 0' }}>
                Wide format: Each column represents a class with one-hot encoding
              </p>
              {selectedFile && (
                <span className="selected-file">
                  Loaded: {basename(selectedFile)}
                </span>
              )}
              {annotationData.length > 0 && (
                <>
                  <button
                    onClick={handleSave}
                    className="primary-button"
                    disabled={!hasUnsavedChanges}
                  >
                    {hasUnsavedChanges ? 'Save Annotations *' : 'Save Annotations'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseAnnotationTask}
                    className="secondary-button"
                    title="Close current annotation task and return to landing page"
                  >
                    Close Task
                  </button>
                </>
              )}
            </div>

            {/* Root Audio Path Setting */}
            <div className="audio-path-setting">
              <label>
                Root Audio Folder:
                <div className="file-path-control">
                  <input
                    type="text"
                    value={rootAudioPath}
                    onChange={(e) => setRootAudioPath(e.target.value)}
                    placeholder="Leave empty for absolute paths"
                    className="path-input"
                  />
                  <button
                    onClick={handleSelectRootAudioPath}
                    className="select-folder-button"
                    type="button"
                  >
                    Browse
                  </button>
                </div>
              </label>
              <div className="path-help-text">
                <small>
                  This folder is used as the base path for relative file paths in the CSV.
                  If empty, file paths are expected to be absolute.
                </small>
              </div>
            </div>

            {error && (
              <div className="error-message">
                <span style={{ flex: 1 }}>{error}</span>
                <button
                  onClick={() => setError('')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: '0 0 0 8px',
                    fontSize: '1.2rem',
                    lineHeight: 1,
                    flexShrink: 0
                  }}
                  title="Dismiss error"
                >
                  ×
                </button>
              </div>
            )}

          </div>

          {/* File Input (hidden) */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
          />
        </div>
      </Drawer>

      {/* Settings Drawer */}
      <Drawer
        anchor="right"
        open={isSettingsPanelOpen}
        onClose={() => setIsSettingsPanelOpen(false)}
        variant="temporary"
        sx={{
          '& .MuiDrawer-paper': {
            width: 500,
            boxSizing: 'border-box',
            backgroundColor: '#ffffff',
            fontFamily: 'Rokkitt, sans-serif',
          },
        }}
      >
        <div className="drawer-header">
          <h3 style={{ margin: 0, fontFamily: 'Rokkitt, sans-serif', fontSize: '1.1rem', fontWeight: 600 }}>
            Review Settings
          </h3>
          <IconButton
            onClick={() => setIsSettingsPanelOpen(false)}
            sx={{
              color: '#6b7280',
              '&:hover': { backgroundColor: '#f3f4f6' }
            }}
          >
            <CloseIcon />
          </IconButton>
        </div>
        <div className="drawer-content">
          {annotationData.length > 0 && (
            <>
              <ReviewSettings
                onSettingsChange={handleSettingsChange}
                onReRenderSpectrograms={loadCurrentPageSpectrograms}
                onClearCache={httpLoader.clearCache}
                currentSettings={settings}
                onSaveConfig={saveConfigToFile}
                onLoadConfig={loadConfigFromFile}
                csvColumns={csvColumns}
                onApplyClassesOnly={handleApplyClassesOnly}
                onApplyClassesAndSubset={handleApplyClassesAndSubset}
              />
              <HttpServerStatus
                serverUrl={backendUrl}
                onClearCache={httpLoader.clearCache}
                onGetStats={httpLoader.getServerStats}
              />
            </>
          )}
        </div>
      </Drawer>

      {/* Keyboard Shortcuts Help Modal */}
      <Modal
        open={isShortcutsHelpOpen}
        onClose={() => setIsShortcutsHelpOpen(false)}
        aria-labelledby="shortcuts-help-title"
        aria-describedby="shortcuts-help-description"
      >
        <Box sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: { xs: '90%', sm: 600 },
          maxHeight: '80vh',
          bgcolor: 'background.paper',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          boxShadow: 24,
          overflow: 'auto',
          fontFamily: 'Rokkitt, sans-serif'
        }}>
          <div className="shortcuts-help-modal">
            <div className="shortcuts-help-header">
              <Typography id="shortcuts-help-title" variant="h6" component="h2" sx={{ fontFamily: 'Rokkitt, sans-serif', fontWeight: 600 }}>
                Keyboard Shortcuts
              </Typography>
              <IconButton
                onClick={() => setIsShortcutsHelpOpen(false)}
                sx={{ color: 'var(--medium-gray)' }}
              >
                <CloseIcon />
              </IconButton>
            </div>
            <div className="shortcuts-help-content">
              {/* Global Shortcuts */}
              <div className="shortcuts-section">
                <h3>Global Shortcuts</h3>
                <div className="shortcuts-list">
                  <div className="shortcut-item">
                    <kbd>Esc</kbd>
                    <span>Toggle between Grid and Focus view</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd</kbd> + <kbd>O</kbd>
                    <span>Open annotation file</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd</kbd> + <kbd>S</kbd>
                    <span>Save annotations</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd</kbd> + <kbd>,</kbd>
                    <span>Open settings panel</span>
                  </div>
                  {classifierGuidedMode.enabled && (
                    <div className="shortcut-item">
                      <kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>K</kbd>
                      <span>Jump to next incomplete bin (CGL mode)</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Grid Mode Shortcuts */}
              <div className="shortcuts-section">
                <h3>Grid Mode</h3>
                <div className="shortcuts-list">
                  <div className="shortcut-item">
                    <kbd>Space</kbd>
                    <span>Play/Pause active clip audio</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>J</kbd>
                    <span>Move to previous clip on page</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>K</kbd>
                    <span>Move to next clip on page</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd</kbd> + <kbd>J</kbd>
                    <span>Previous page/bin</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd</kbd> + <kbd>K</kbd>
                    <span>Next page/bin</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd>
                    <span>Toggle comments visibility</span>
                  </div>
                  {settings.review_mode === 'binary' && (
                    <>
                      <div className="shortcuts-subsection">
                        <h4>Active Clip Annotation (Binary Mode)</h4>
                        <div className="shortcut-item">
                          <kbd>A</kbd>
                          <span>Mark active clip as Yes and advance</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>S</kbd>
                          <span>Mark active clip as No and advance</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>D</kbd>
                          <span>Mark active clip as Uncertain and advance</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>F</kbd>
                          <span>Mark active clip as Unlabeled and advance</span>
                        </div>
                      </div>
                      <div className="shortcuts-subsection">
                        <h4>Bulk Annotation (Binary Mode)</h4>
                        <div className="shortcut-item">
                          <kbd>Shift</kbd> + <kbd>A</kbd>
                          <span>Mark all unlabeled clips on page as Yes</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>Shift</kbd> + <kbd>S</kbd>
                          <span>Mark all unlabeled clips on page as No</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>Shift</kbd> + <kbd>D</kbd>
                          <span>Mark all unlabeled clips on page as Uncertain</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>Shift</kbd> + <kbd>F</kbd>
                          <span>Mark all clips on page as Unlabeled</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Focus Mode Shortcuts */}
              <div className="shortcuts-section">
                <h3>Focus Mode</h3>
                <div className="shortcuts-list">
                  <div className="shortcut-item">
                    <kbd>Space</kbd>
                    <span>Play/Pause audio</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>J</kbd>
                    <span>Previous clip</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>K</kbd>
                    <span>Next clip</span>
                  </div>
                  {settings.review_mode === 'binary' && (
                    <>
                      <div className="shortcuts-subsection">
                        <h4>Binary Annotation</h4>
                        <div className="shortcut-item">
                          <kbd>A</kbd>
                          <span>Mark as Yes and advance</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>S</kbd>
                          <span>Mark as No and advance</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>D</kbd>
                          <span>Mark as Uncertain and advance</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>F</kbd>
                          <span>Mark as Unlabeled and advance</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Note about shortcuts being enabled */}
              <div className="shortcuts-note">
                <p><strong>Note:</strong> Keyboard shortcuts can be disabled in the settings panel if needed.</p>
                <p>Shortcuts will not work when typing in text fields or comment boxes.</p>
              </div>
            </div>
          </div>
        </Box>
      </Modal>

      {/* Score Histogram Modal */}
      <ScoreHistogram
        open={isScoreHistogramOpen}
        onClose={() => setIsScoreHistogramOpen(false)}
        clips={annotationData}
        reviewMode={settings.review_mode}
        annotationColumn={settings.annotation_column}
      />

      {/* Filter Panel Drawer */}
      <Drawer
        anchor="right"
        open={isFilterPanelOpen}
        onClose={() => setIsFilterPanelOpen(false)}
        variant="temporary"
        sx={{
          '& .MuiDrawer-paper': {
            width: 400,
            boxSizing: 'border-box',
            backgroundColor: '#ffffff',
            fontFamily: 'Rokkitt, sans-serif',
          },
        }}
      >
        <div className="drawer-header">
          <h3 style={{ margin: 0, fontFamily: 'Rokkitt, sans-serif', fontSize: '1.1rem', fontWeight: 600 }}>
            Filter Clips
          </h3>
          <IconButton
            onClick={() => setIsFilterPanelOpen(false)}
            sx={{
              color: '#6b7280',
              '&:hover': { backgroundColor: '#f3f4f6' }
            }}
          >
            <CloseIcon />
          </IconButton>
        </div>
        <div className="drawer-content">
          {annotationData.length > 0 && (
            <div className="tray-section">
              {/* Binary mode: Filter by annotation */}
              {settings.review_mode === 'binary' && (
                <div className="filter-group">
                  <label className="filter-checkbox">
                    <input
                      type="checkbox"
                      checked={filters.annotation.enabled}
                      onChange={(e) => handleFilterChange('annotation', e.target.checked, filters.annotation.values)}
                    />
                    Filter by annotation
                  </label>
                  {filters.annotation.enabled && (
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                      <Select
                        multiple
                        value={filters.annotation.values}
                        onChange={(e) => handleFilterChange('annotation', true, e.target.value)}
                        renderValue={(selected) => selected.map(v => v === '' ? 'unlabeled' : v).join(', ')}
                      >
                        {getFilterOptions.annotation.map(option => (
                          <MenuItem key={option} value={option}>
                            {option === '' ? 'unlabeled' : option}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </div>
              )}

              {/* Multi-class mode: Filter by labels and status */}
              {settings.review_mode === 'multiclass' && (
                <>
                  <div className="filter-group">
                    <label className="filter-checkbox">
                      <input
                        type="checkbox"
                        checked={filters.labels.enabled}
                        onChange={(e) => handleFilterChange('labels', e.target.checked, filters.labels.values)}
                      />
                      Filter by labels
                    </label>
                    {filters.labels.enabled && (
                      <FormControl size="small" sx={{ minWidth: 150 }}>
                        <Select
                          multiple
                          value={filters.labels.values}
                          onChange={(e) => handleFilterChange('labels', true, e.target.value)}
                          renderValue={(selected) => selected.join(', ')}
                        >
                          {getFilterOptions.labels.map(option => (
                            <MenuItem key={option} value={option}>
                              {option}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </div>

                  <div className="filter-group">
                    <label className="filter-checkbox">
                      <input
                        type="checkbox"
                        checked={filters.annotation_status.enabled}
                        onChange={(e) => handleFilterChange('annotation_status', e.target.checked, filters.annotation_status.values)}
                      />
                      Filter by status
                    </label>
                    {filters.annotation_status.enabled && (
                      <FormControl size="small" sx={{ minWidth: 150 }}>
                        <Select
                          multiple
                          value={filters.annotation_status.values}
                          onChange={(e) => handleFilterChange('annotation_status', true, e.target.value)}
                          renderValue={(selected) => selected.join(', ')}
                        >
                          {getFilterOptions.annotation_status.map(option => (
                            <MenuItem key={option} value={option}>
                              {option}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </div>
                </>
              )}

              {/* Filter Actions */}
              <div className="filter-actions">
                <button
                  onClick={applyFilters}
                  className="apply-filters-button"
                  disabled={!hasUnappliedFilterChanges}
                >
                  Apply Filters
                </button>
                <button
                  onClick={clearFilters}
                  className="clear-filters-button"
                >
                  Clear All
                </button>
              </div>

              {/* Show filter status */}
              <div className="filter-status">
                <small>
                  Showing {filteredAnnotationData.length} of {annotationData.length} clips
                  {hasUnappliedFilterChanges && (
                    <span className="filter-pending"> (pending changes)</span>
                  )}
                </small>
              </div>
            </div>
          )}
        </div>
      </Drawer>

      {/* Classifier-Guided Listening Panel Drawer */}
      <Drawer
        anchor="right"
        open={isClassifierGuidedPanelOpen}
        onClose={() => setIsClassifierGuidedPanelOpen(false)}
        variant="temporary"
        sx={{
          '& .MuiDrawer-paper': {
            width: 450,
            boxSizing: 'border-box',
            backgroundColor: '#ffffff',
            fontFamily: 'Rokkitt, sans-serif',
          },
        }}
      >
        <div className="drawer-header">
          <h3 style={{ margin: 0, fontFamily: 'Rokkitt, sans-serif', fontSize: '1.1rem', fontWeight: 600 }}>
            Classifier-Guided Listening
          </h3>
          <IconButton
            onClick={() => setIsClassifierGuidedPanelOpen(false)}
            sx={{
              color: '#6b7280',
              '&:hover': { backgroundColor: '#f3f4f6' }
            }}
          >
            <CloseIcon />
          </IconButton>
        </div>
        <div className="drawer-content">
          {annotationData.length > 0 && (
            <ClassifierGuidedPanel
              config={classifierGuidedMode}
              onConfigChange={setClassifierGuidedMode}
              availableColumns={getAvailableColumns(annotationData)}
              numericColumns={getNumericColumns(annotationData)}
              availableClasses={availableClasses}
              reviewMode={settings.review_mode}
              currentBinIndex={currentBinIndex}
              totalBins={stratifiedBins.length}
              currentBinInfo={stratifiedBins[currentBinIndex]}
              onSaveConfig={saveConfigToFile}
              onLoadConfig={loadConfigFromFile}
            />
          )}
        </div>
      </Drawer>

      {/* Main Content Area - Full Window */}
      <div className="review-main-content">
        {/* Compact Top Toolbar */}
        <div className="review-toolbar">
          <div className="toolbar-left">
            {/* Left Tray Toggle */}
            <button
              onClick={() => setIsLeftTrayOpen(true)}
              className="toolbar-btn"
              title="Load Annotation Task"
            >
              <span className="material-symbols-outlined">menu</span>
            </button>

            {/* File Operations */}
            <button
              onClick={handleLoadAnnotationTask}
              className="toolbar-btn"
              title="Open Annotation File"
              disabled={loading}
            >
              <span className="material-symbols-outlined">folder_open</span>
            </button>

            {/* Save button */}
            <button
              onClick={handleSave}
              className="toolbar-btn"
              title={currentSavePath ? `Save to ${basename(currentSavePath)}` : "Save (will open save dialog)"}
              disabled={annotationData.length === 0}
            >
              <span className="material-symbols-outlined">save</span>
            </button>

            {/* Save As button */}
            <button
              onClick={handleSaveAs}
              className="toolbar-btn"
              title="Save As..."
              disabled={annotationData.length === 0}
            >
              <span className="material-symbols-outlined">save_as</span>
            </button>

            {/* Auto-save controls */}
            <button
              onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
              className={`toolbar-btn ${autoSaveEnabled ? 'active' : ''}`}
              title={`Auto-save ${autoSaveEnabled ? 'ON' : 'OFF'}`}
              disabled={annotationData.length === 0}
            >
              <span className="material-symbols-outlined">
                {autoSaveEnabled ? 'sync' : 'sync_disabled'}
              </span>
            </button>

            {/* Filter button */}
            <button
              onClick={() => setIsFilterPanelOpen(true)}
              className={`toolbar-btn ${(filters.annotation.enabled || filters.labels.enabled || filters.annotation_status.enabled) ? 'active' : ''}`}
              title="Filter Clips"
              disabled={annotationData.length === 0}
            >
              <span className="material-symbols-outlined">filter_alt</span>
            </button>

            {/* Save Status Indicator */}
            {annotationData.length > 0 && (
              <div className="save-status-indicator">
                <span
                  className={`material-symbols-outlined ${hasUnsavedChanges ? 'unsaved' : 'saved'}`}
                  title={hasUnsavedChanges ? 'Unsaved changes' : 'All changes saved'}
                >
                  {hasUnsavedChanges ? 'edit' : 'check_circle'}
                </span>
              </div>
            )}
          </div>

          <div className="toolbar-center">
            {annotationData.length > 0 && (
              <>
                {/* Focus/Grid Mode Toggle */}
                <button
                  className={`toolbar-btn ${isFocusMode ? 'active' : ''}`}
                  onClick={() => setIsFocusMode(!isFocusMode)}
                  title={isFocusMode ? 'Switch to Grid View (Esc)' : 'Switch to Focus Mode (Esc)'}
                >
                  <span className="material-symbols-outlined">
                    {isFocusMode ? 'grid_view' : 'fullscreen'}
                  </span>
                </button>

                {/* Bulk Annotation Controls - Only show in Grid mode for binary mode */}
                {!isFocusMode && settings.review_mode === 'binary' && currentPageData.length > 0 && (() => {
                  // Count unlabeled clips on current page
                  const unlabeledCount = currentPageData.filter(clip => !clip.annotation || clip.annotation === '').length;

                  return (
                    <div className="toolbar-bulk-controls">
                      <button
                        className="toolbar-btn bulk-btn"
                        onClick={() => handleBulkAnnotation('yes')}
                        title={`Mark ${unlabeledCount} unlabeled clip${unlabeledCount !== 1 ? 's' : ''} on this page as Yes`}
                        style={{ color: 'rgb(145, 180, 135)' }}
                      >
                        <span className="material-symbols-outlined">check_circle</span>
                      </button>
                      <button
                        className="toolbar-btn bulk-btn"
                        onClick={() => handleBulkAnnotation('no')}
                        title={`Mark ${unlabeledCount} unlabeled clip${unlabeledCount !== 1 ? 's' : ''} on this page as No`}
                        style={{ color: 'rgb(207, 122, 107)' }}
                      >
                        <span className="material-symbols-outlined">cancel</span>
                      </button>
                      <button
                        className="toolbar-btn bulk-btn"
                        onClick={() => handleBulkAnnotation('uncertain')}
                        title={`Mark ${unlabeledCount} unlabeled clip${unlabeledCount !== 1 ? 's' : ''} on this page as Uncertain`}
                        style={{ color: 'rgb(237, 223, 177)' }}
                      >
                        <span className="material-symbols-outlined">help</span>
                      </button>
                      <button
                        className="toolbar-btn bulk-btn"
                        onClick={() => handleBulkAnnotation('unlabeled')}
                        title={`Mark all ${currentPageData.length} clip${currentPageData.length !== 1 ? 's' : ''} on this page as Unlabeled`}
                        style={{ color: 'rgb(223, 223, 223)' }}
                      >
                        <span className="material-symbols-outlined">restart_alt</span>
                      </button>
                    </div>
                  );
                })()}

                {/* Comments Toggle - Only show in Grid mode */}
                {!isFocusMode && (
                  <button
                    className={`toolbar-btn ${settings.show_comments ? 'active' : ''}`}
                    onClick={() => handleSettingsChange({ ...settings, show_comments: !settings.show_comments })}
                    title="Toggle Comments Visibility"
                  >
                    <span className="material-symbols-outlined">comment</span>
                  </button>
                )}

                {/* Autoplay Toggle - Grid Mode */}
                {!isFocusMode && (
                  <button
                    className={`toolbar-btn ${gridModeAutoplay ? 'active' : ''}`}
                    onClick={() => setGridModeAutoplay(!gridModeAutoplay)}
                    title={`Grid Autoplay ${gridModeAutoplay ? 'ON' : 'OFF'}: Auto-play when advancing to next clip`}
                  >
                    <span className="material-symbols-outlined">
                      {gridModeAutoplay ? 'play_circle' : 'pause_circle'}
                    </span>
                  </button>
                )}

                {/* Autoplay Toggle - Only show in Focus mode */}
                {isFocusMode && (
                  <button
                    className={`toolbar-btn ${settings.focus_mode_autoplay ? 'active' : ''}`}
                    onClick={() => handleSettingsChange({ ...settings, focus_mode_autoplay: !settings.focus_mode_autoplay })}
                    title="Toggle Autoplay in Focus Mode"
                  >
                    <span className="material-symbols-outlined">
                      {settings.focus_mode_autoplay ? 'play_circle' : 'pause_circle'}
                    </span>
                  </button>
                )}

                {/* Page/Bin Navigation */}
                {!isFocusMode && (
                  <>
                    {classifierGuidedMode.enabled && stratifiedBins.length > 0 ? (
                      // Bin navigation for classifier-guided mode
                      <div className="page-navigation">
                        <button
                          className="toolbar-btn"
                          onClick={() => setCurrentBinIndex(prev => Math.max(0, prev - 1))}
                          disabled={currentBinIndex === 0}
                          title="Previous Bin"
                        >
                          <span className="material-symbols-outlined">chevron_left</span>
                        </button>

                        <FormControl size="small" sx={{ minWidth: 90 }}>
                          <Select
                            value={currentBinIndex}
                            onChange={(e) => setCurrentBinIndex(parseInt(e.target.value))}
                            title="Go to bin"
                          >
                            {stratifiedBins.map((_, i) => (
                              <MenuItem key={i} value={i}>
                                Bin {i + 1}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>

                        <button
                          className="toolbar-btn"
                          onClick={() => setCurrentBinIndex(prev => Math.min(stratifiedBins.length - 1, prev + 1))}
                          disabled={currentBinIndex >= stratifiedBins.length - 1}
                          title="Next Bin"
                        >
                          <span className="material-symbols-outlined">chevron_right</span>
                        </button>
                      </div>
                    ) : (
                      // Normal page navigation
                      totalPages > 1 && (
                        <div className="page-navigation">
                          <button
                            className="toolbar-btn"
                            onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                            disabled={currentPage === 0}
                            title="Previous Page"
                          >
                            <span className="material-symbols-outlined">chevron_left</span>
                          </button>

                          <FormControl size="small" sx={{ minWidth: 100 }}>
                            <Select
                              value={currentPage}
                              onChange={(e) => setCurrentPage(parseInt(e.target.value))}
                              title="Go to page"
                            >
                              {Array.from({ length: totalPages }, (_, i) => (
                                <MenuItem key={i} value={i}>
                                  Page {i + 1}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>

                          <button
                            className="toolbar-btn"
                            onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
                            disabled={currentPage >= totalPages - 1}
                            title="Next Page"
                          >
                            <span className="material-symbols-outlined">chevron_right</span>
                          </button>
                        </div>
                      )
                    )}
                  </>
                )}
              </>
            )}
          </div>

          <div className="toolbar-right">
            {/* Score Histogram Button */}
            {annotationData.length > 0 && (
              <button
                onClick={() => setIsScoreHistogramOpen(true)}
                className="toolbar-btn"
                title="Score Histogram"
              >
                <span className="material-symbols-outlined">bar_chart</span>
              </button>
            )}

            {/* Classifier-Guided Listening Button */}
            {annotationData.length > 0 && (
              <button
                onClick={() => setIsClassifierGuidedPanelOpen(true)}
                className={`toolbar-btn ${classifierGuidedMode.enabled ? 'active' : ''}`}
                title="Classifier-Guided Listening"
              >
                <span className="material-symbols-outlined">analytics</span>
              </button>
            )}

            {/* Keyboard Shortcuts Help Button */}
            <button
              onClick={() => setIsShortcutsHelpOpen(true)}
              className="toolbar-btn"
              title="Keyboard Shortcuts"
            >
              <span className="material-symbols-outlined">keyboard</span>
            </button>

            {/* Settings Button */}
            <button
              onClick={() => setIsSettingsPanelOpen(true)}
              className="toolbar-btn"
              title="Settings"
            >
              <span className="material-symbols-outlined">settings</span>
            </button>
          </div>
        </div>

        {/* Error and status messages */}
        {error && (
          <div className="error-message">
            <span style={{ flex: 1 }}>{error}</span>
            <button
              onClick={() => setError('')}
              style={{
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: '0 0 0 8px',
                fontSize: '1.2rem',
                lineHeight: 1,
                flexShrink: 0
              }}
              title="Dismiss error"
            >
              ×
            </button>
          </div>
        )}


        {/* Main Content Area - Grid or Focus View */}
        <div className={`review-content ${annotationData.length > 0 ? (isFocusMode ? 'focus-mode' : 'grid-mode') : 'placeholder-mode'}`}>
          {annotationData.length > 0 ? (
            <>
              {isFocusMode ? (
                // Focus Mode View - Centered
                (() => {
                  // Determine which clip to show - use same logic as grid mode
                  const isOnNewClip = focusClipIndex !== lastRenderedFocusClipIndex;
                  const currentClip = filteredAnnotationData[focusClipIndex];
                  const hasLoadedNewClip = loadedPageData.some(loaded => loaded.clip_id === currentClip?.id);

                  // Show old clip if we've navigated but new clip hasn't loaded yet
                  const clipIndexToShow = (isOnNewClip && !hasLoadedNewClip) ? lastRenderedFocusClipIndex : focusClipIndex;
                  const clipToShow = filteredAnnotationData[clipIndexToShow];

                  // Calculate which bin the current focus clip belongs to (for CGL mode)
                  let focusBinIndex = currentBinIndex;
                  let focusBin = null;
                  let isFocusBinComplete = false;

                  if (classifierGuidedMode.enabled && stratifiedBins.length > 0 && clipToShow) {
                    // Find which bin contains the current focus clip
                    const binIdx = stratifiedBins.findIndex(bin =>
                      bin.clips.some(clip => clip.id === clipToShow.id)
                    );
                    if (binIdx !== -1) {
                      focusBinIndex = binIdx;
                      focusBin = stratifiedBins[binIdx];
                      isFocusBinComplete = isBinComplete(
                        focusBin.clips,
                        settings.review_mode,
                        {
                          strategy: classifierGuidedMode.completionStrategy,
                          targetCount: classifierGuidedMode.completionTargetCount,
                          targetLabels: classifierGuidedMode.completionTargetLabels
                        }
                      );
                    }
                  }

                  // Get bin completion stats for focus mode
                  const focusBinCompletionStats = getCompletedBinsCount();
                  const focusAllBinsComplete = focusBinCompletionStats.completed === focusBinCompletionStats.total && focusBinCompletionStats.total > 0;

                  // Get active clip info within bin for focus mode
                  const focusActiveClipInBin = clipToShow ? getActiveClipIndexInBin(focusBinIndex, clipToShow.id) : { clipIndex: 0, totalClips: 0 };

                  return (
                    <div className="focus-view-container">
                      {/* Bin Status Display for Classifier-Guided Mode in Focus View */}
                      {classifierGuidedMode.enabled && focusBin && (
                        <div className={`bin-status-display ${isFocusBinComplete ? 'complete' : 'incomplete'}`}>
                          <div className="bin-status-header">
                            <div className="bin-status-info">
                              <span className="bin-status-label">
                                Bin {focusBinIndex + 1} of {stratifiedBins.length}
                                {focusActiveClipInBin.totalClips > 0 && (
                                  <span className="bin-clip-position"> • Clip {focusActiveClipInBin.clipIndex} of {focusActiveClipInBin.totalClips}</span>
                                )}
                              </span>
                              <span className={`bin-completion-badge ${isFocusBinComplete ? 'complete' : 'incomplete'}`}>
                                {isFocusBinComplete ? '✓ Complete' : 'In Progress'}
                              </span>
                            </div>
                            <button
                              className="jump-incomplete-btn"
                              onClick={handleJumpToNextIncompleteBin}
                              disabled={focusAllBinsComplete}
                              title={focusAllBinsComplete ? "All bins complete" : "Jump to next incomplete bin (⌘⇧K)"}
                            >
                              <span className="material-symbols-outlined">fast_forward</span>
                              Next Incomplete
                            </button>
                          </div>
                          <div className="bin-stratification-values">
                            {Object.entries(focusBin.values).map(([key, value]) => (
                              <span key={key} className="bin-value-tag">
                                <strong>{key}:</strong> {String(value)}
                              </span>
                            ))}
                          </div>
                          <div className="bin-completion-stats">
                            Completed bins: {focusBinCompletionStats.completed}/{focusBinCompletionStats.total}
                          </div>
                        </div>
                      )}


                      <FocusView
                        clipData={{
                          ...clipToShow,
                          // Find loaded spectrogram data for the clip we're showing
                          ...loadedPageData.find(loaded => loaded.clip_id === clipToShow?.id) || {}
                        }}
                        onAnnotationChange={handleFocusAnnotationChange}
                        onCommentChange={handleFocusCommentChange}
                        onNavigate={handleFocusNavigation}
                        settings={settings}
                        reviewMode={settings.review_mode}
                        availableClasses={availableClasses}
                        isLastClip={focusClipIndex === filteredAnnotationData.length - 1}
                        autoAdvance={true}
                      />
                    </div>
                  );
                })()
              ) : (
                // Grid Mode View
                <>
                  {renderAnnotationGrid}
                </>
              )}
            </>
          ) : (
            /* PLACEHOLDER - SHOWN WHEN NO DATA LOADED */
            !loading && !error && (
              <div className="placeholder-container">
                <div className="placeholder-content">
                  {/* <h3>Ready for Annotation Review 📝 <HelpIcon section="review" /></h3> */}
                  {/* Load CSV Buttons */}
                  <div className="placeholder-actions">
                    <button
                      onClick={handleLoadAnnotationTask}
                      disabled={loading}
                      className="primary-button load-csv-button"
                    >
                      {loading ? 'Loading...' : 'Load Annotation CSV'}
                    </button>
                    <button
                      onClick={handleLoadWideFormatCSV}
                      disabled={loading}
                      className="primary-button load-csv-button"
                      style={{ margin: '10px', backgroundColor: 'var(--dark-accent)' }}
                    >
                      {loading ? 'Loading...' : 'Open Wide-format CSV'}
                    </button>
                    <p className="load-button-help">
                      <small>You can also use the menu button in the top-left to access loading and root audio path options.</small>
                    </p>
                  </div>

                  {/* Collapsible Format Information */}
                  <div style={{ marginTop: '20px', marginBottom: '20px' }}>
                    <button
                      onClick={() => setIsFormatInfoExpanded(!isFormatInfoExpanded)}
                      style={{
                        background: 'none',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        padding: '8px 16px',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontFamily: 'Rokkitt, sans-serif',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        width: '100%',
                        justifyContent: 'center'
                      }}
                    >
                      <span>{isFormatInfoExpanded ? '▼' : '▶'}</span>
                      <span>Supported CSV Formats</span>
                    </button>

                    {isFormatInfoExpanded && (
                      <div className="format-section" style={{ marginTop: '15px' }}>
                        <h4>Standard Formats (use "Load Annotation CSV" button)</h4>

                        <p><strong>Required columns:</strong> file, start_time, end_time</p>
                        <p><strong>Optional columns:</strong> comments, and any metadata columns</p>

                        <p><strong>Binary Review:</strong></p>
                        <ul>
                          <li><strong>annotation</strong>: Binary labels (yes/no/uncertain/empty)</li>
                        </ul>
                        <p><em>Example: file,start_time,end_time,annotation,comments<br /> /path/to/file.wav,5,8,yes,Primary song</em></p>

                        <p><strong>Multi-class Review:</strong></p>
                        <ul>
                          <li><strong>labels</strong>: Comma-separated or JSON list of classes</li>
                          <li><strong>annotation_status</strong>: complete/unreviewed/uncertain</li>
                        </ul>
                        <p><em>Example: file,start_time,end_time,labels,annotation_status,comments<br />/path/to/file.wav,5,8,"[AMRO,NOCA]",complete,Alarm calls</em></p>

                        <h4 style={{ marginTop: '20px' }}>Wide Format (use "Open Wide-format CSV" button)</h4>
                        <ul>
                          <li>One column per class with 0/1 values or continuous scores</li>
                          <li>Each extra column (beyond file, start_time, end_time, comments) is treated as a class</li>
                        </ul>
                        <p><em>Example: file,start_time,end_time,robin,cardinal,blue_jay,comments<br />/path/to/file.wav,5,8,1,0,0,"Very distant"</em></p>
                      </div>
                    )}
                  </div>


                </div>
              </div>
            )
          )}
        </div>

      </div>
      {/* Status Bar - Always visible when data is loaded */}
      {
        annotationData.length > 0 && (
          <div
            className="review-status-bar"
            style={{
              bottom: isReviewOnly ? '0' : '30px',
              left: isReviewOnly ? '0' : (drawerOpen ? '240px' : '65px')
            }}
          >
            <div className="status-section">
              <span className="status-label">Current Page:</span>
              <span className="status-value">{currentPage + 1} of {totalPages}</span>
            </div>
            <div className="status-section">
              <span className="status-label">Annotated:</span>
              <span className="status-value">
                {annotationData.filter(item =>
                  settings.review_mode === 'binary'
                    ? item.annotation && item.annotation !== ''
                    : item.annotation_status === 'complete'
                ).length} of {annotationData.length}
              </span>
            </div>
            <div className="status-section">
              <span className="status-label">Progress:</span>
              <span className="status-value">
                {Math.round((annotationData.filter(item =>
                  settings.review_mode === 'binary'
                    ? item.annotation && item.annotation !== ''
                    : item.annotation_status === 'complete'
                ).length / annotationData.length) * 100)}%
              </span>
            </div>
            {isFocusMode && (
              <div className="status-section">
                <span className="status-label">Focus:</span>
                <span className="status-value">{focusClipIndex + 1} of {filteredAnnotationData.length}</span>
              </div>
            )}
          </div>
        )
      }
    </div>
  );
}

export default ReviewTab;