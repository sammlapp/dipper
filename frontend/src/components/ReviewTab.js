import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Drawer, IconButton, Modal, Box, Typography } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import AnnotationCard from './AnnotationCard';
import ReviewSettings from './ReviewSettings';
import FocusView from './FocusView';
import HelpIcon from './HelpIcon';
import { useHttpAudioLoader, HttpServerStatus } from './HttpAudioLoader';

function ReviewTab({ drawerOpen = false }) {
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
    show_file_name: true,
    resize_images: true,
    image_width: 400,
    image_height: 200,
    focus_mode_autoplay: true,
    focus_size: 'medium',
    keyboard_shortcuts_enabled: true,
    manual_classes: '',
    clip_duration: 3.0
  });
  const [availableClasses, setAvailableClasses] = useState([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [loadedPageData, setLoadedPageData] = useState([]);
  const [displayedPageData, setDisplayedPageData] = useState([]); // What's currently shown - only updates when new page is ready
  const [isPageTransitioning, setIsPageTransitioning] = useState(false);
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [rootAudioPath, setRootAudioPath] = useState('');
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [focusClipIndex, setFocusClipIndex] = useState(0);
  const [isLeftTrayOpen, setIsLeftTrayOpen] = useState(false);
  const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
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
  const fileInputRef = useRef(null);

  // HTTP-based loader (fast and reliable)
  const httpLoader = useHttpAudioLoader('http://localhost:8000');

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

  const handleSettingsChange = (newSettings) => {
    setSettings(newSettings);

    // If grid size changed, adjust current page to stay in bounds
    const newItemsPerPage = newSettings.grid_rows * newSettings.grid_columns;
    const newTotalPages = Math.ceil(annotationData.length / newItemsPerPage);
    if (currentPage >= newTotalPages && newTotalPages > 0) {
      setCurrentPage(newTotalPages - 1);
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
    const start = currentPage * itemsPerPage;
    const end = start + itemsPerPage;
    return filteredAnnotationData.slice(start, end);
  }, [currentPage, itemsPerPage, filteredAnnotationData]);

  // Memoize current page data separately to reduce dependencies
  const currentPageData = useMemo(() => {
    const start = currentPage * itemsPerPage;
    const end = start + itemsPerPage;
    return filteredAnnotationData.slice(start, end);
  }, [currentPage, itemsPerPage, filteredAnnotationData]);

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

        const loadedClips = await httpLoader.loadClipsBatch(clipsToLoad, visualizationSettings);
        console.log('Loaded clips result:', loadedClips);

        // Check if any clips failed to load
        const failedClips = loadedClips.filter(clip => !clip.spectrogram_base64);
        if (failedClips.length > 0) {
          console.warn('Some clips failed to generate spectrograms:', failedClips);
        }

        // Update both loaded data and displayed page data atomically
        // This ensures the display only updates once everything is ready
        setLoadedPageData(loadedClips);
        setDisplayedPageData(currentData); // Now safe to display these clips
      } catch (error) {
        console.error('Failed to load page spectrograms:', error);
        console.error('Error details:', {
          message: error.message,
          settings: visualizationSettings,
          clipCount: clipsToLoad.length
        });
      } finally {
        // Don't set transitioning state - no overlay shown
        // setIsPageTransitioning(false);
      }
    }
  }, [rootAudioPath, httpLoader]); // Use rootAudioPath state instead of settings

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

  // Track when data actually changes (new file loaded) vs just annotations updated
  const dataVersion = useRef(0);
  const [currentDataVersion, setCurrentDataVersion] = useState(0);

  // Load spectrograms when page changes, new data loaded, settings change, or filtering changes
  useEffect(() => {
    if (annotationData.length > 0) {
      loadCurrentPageSpectrograms();
    }
  }, [currentPage, currentDataVersion, rootAudioPath, filteredAnnotationData.length, settings.grid_rows, settings.grid_columns]);

  // Auto-save on page changes (only trigger when page actually changes)
  useEffect(() => {
    if (annotationData.length > 0 && autoSaveEnabled && hasUnsavedChanges) {
      performAutoSave();
    }
  }, [currentPage]); // Only trigger on page changes, not when hasUnsavedChanges changes

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

  // Separate effect to detect when NEW data is loaded (not just annotations changed)
  useEffect(() => {
    // Only increment version when the data array length changes (new file loaded)
    // This avoids reloading spectrograms when just annotations change
    if (annotationData.length > 0 && dataVersion.current !== annotationData.length) {
      dataVersion.current = annotationData.length;
      setCurrentDataVersion(prev => prev + 1);
    }
  }, [annotationData.length]); // Only depend on LENGTH, not content

  // Re-extract available classes when manual classes change
  useEffect(() => {
    if (annotationData.length > 0) {
      extractAvailableClasses(annotationData);
    }
  }, [settings.manual_classes, settings.review_mode]);

  const handleLoadAnnotationTask = async () => {
    try {
      if (!window.electronAPI) {
        // For browser testing, use file input
        fileInputRef.current?.click();
        return;
      }

      const files = await window.electronAPI.selectCSVFiles();
      if (files && files.length > 0) {
        setSelectedFile(files[0]);
        await loadAndProcessCSV(files[0]);
      }
    } catch (err) {
      setError('Failed to select file: ' + err.message);
    }
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

    try {
      const text = await file.text();
      const data = parseAnnotationCSV(text);
      setAnnotationData(data);
      extractAvailableClasses(data);
      setCurrentPage(0);
      setHasUnsavedChanges(false);
      // Clear displayed page data so it will load fresh
      setDisplayedPageData([]);
      setLoadedPageData([]);
      // Clear save path when new annotation file is loaded
      setCurrentSavePath(null);
      localStorage.removeItem('review_autosave_location');
    } catch (err) {
      setError('Failed to parse CSV file: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadAndProcessCSV = async (filePath) => {
    setLoading(true);
    setError('');

    try {
      // Auto-set root audio path if not already set
      const savedSettings = localStorage.getItem('review_settings');
      let currentSettings = settings;
      if (savedSettings) {
        currentSettings = JSON.parse(savedSettings);
      }

      if (!rootAudioPath || rootAudioPath.trim() === '') {
        // Set root audio path to directory containing the CSV file
        const csvDirectory = filePath.substring(0, filePath.lastIndexOf('/'));
        setRootAudioPath(csvDirectory);
        // Save to localStorage (keeping it with settings for now but will move it out)
        const newSettings = { ...currentSettings, root_audio_path: csvDirectory };
        localStorage.setItem('review_settings', JSON.stringify(newSettings));
      }

      // Use Python script to read CSV file
      const processId = Date.now().toString();
      const result = await window.electronAPI.runPythonScript(
        'load_extraction_task.py',
        [filePath],
        processId
      );

      console.log('Raw Python script result:', result);

      const data = JSON.parse(result.stdout);
      console.log('Parsed annotation data:', data);

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
        setHasUnsavedChanges(false);
        // Clear displayed page data so it will load fresh
        setDisplayedPageData([]);
        setLoadedPageData([]);
        // Clear save path when new annotation file is loaded
        setCurrentSavePath(null);
        localStorage.removeItem('review_autosave_location');
      }
    } catch (err) {
      console.error('Failed to load annotation task:', err);
      console.error('Error stack:', err.stack);

      // Try to write error to a log file for debugging
      if (window.electronAPI?.writeFile) {
        const errorLog = `Error loading annotation task at ${new Date().toISOString()}:\n${err.message}\n${err.stack}\n\n`;
        try {
          window.electronAPI.writeFile('/tmp/annotation_errors.log', errorLog, { flag: 'a' });
        } catch (logErr) {
          console.error('Could not write to error log:', logErr);
        }
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

    // Auto-detect review mode based on available columns
    const hasAnnotationColumn = headers.includes('annotation');
    const hasLabelsColumn = headers.includes('labels');

    let detectedReviewMode = 'binary'; // default
    if (hasLabelsColumn && !hasAnnotationColumn) {
      detectedReviewMode = 'multiclass';
    } else if (hasAnnotationColumn && !hasLabelsColumn) {
      detectedReviewMode = 'binary';
    } else if (hasLabelsColumn && hasAnnotationColumn) {
      // Both columns exist, prefer labels for multiclass
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

      // Parse numeric values
      const clip = {
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
    // Clear displayed data so new filtered content will load fresh
    setDisplayedPageData([]);
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
    // Clear displayed data so unfiltered content will load fresh
    setDisplayedPageData([]);
  }, []);

  // Check if filters have changed since last apply
  const hasUnappliedFilterChanges = useMemo(() => {
    return JSON.stringify(filters) !== JSON.stringify(appliedFilters);
  }, [filters, appliedFilters]);

  // Bulk annotation function for current page
  const handleBulkAnnotation = useCallback((annotationValue) => {
    const currentData = currentPageData;
    if (currentData.length === 0) return;

    // Update all clips on current page
    setAnnotationData(prev => {
      const newArray = [...prev];
      currentData.forEach(clip => {
        const clipIndex = newArray.findIndex(c => c.id === clip.id);
        if (clipIndex !== -1) {
          newArray[clipIndex] = {
            ...newArray[clipIndex],
            annotation: annotationValue === 'unlabeled' ? '' : annotationValue
          };
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
        }
      }

      // Grid mode only shortcuts
      if (!isFocusMode && cmdOrCtrl) {
        switch (event.key.toLowerCase()) {
          case 'a':
            if (event.shiftKey) {
              // Cmd/Ctrl+Shift+A: bulk annotate as Yes
              if (settings.review_mode === 'binary') {
                handleBulkAnnotation('yes');
              }
            }
            break;
          case 's':
            if (event.shiftKey) {
              // Cmd/Ctrl+Shift+S: bulk annotate as No
              if (settings.review_mode === 'binary') {
                handleBulkAnnotation('no');
              }
            }
            break;
          case 'd':
            if (event.shiftKey) {
              // Cmd/Ctrl+Shift+D: bulk annotate as Uncertain
              if (settings.review_mode === 'binary') {
                handleBulkAnnotation('uncertain');
              }
            }
            break;
          case 'f':
            if (event.shiftKey) {
              // Cmd/Ctrl+Shift+F: bulk annotate as Unlabeled
              if (settings.review_mode === 'binary') {
                handleBulkAnnotation('unlabeled');
              }
            }
            break;
          case 'j':
            // Cmd/Ctrl+J: previous page
            if (currentPage > 0) {
              setCurrentPage(prev => prev - 1);
            }
            break;
          case 'k':
            // Cmd/Ctrl+K: next page
            if (currentPage < totalPages - 1) {
              setCurrentPage(prev => prev + 1);
            }
            break;
          case 'c':
            if (event.shiftKey) {
              // Cmd/Ctrl+Shift+C: toggle comments
              handleSettingsChange({ ...settings, show_comments: !settings.show_comments });
            }
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
  }, [settings, isFocusMode, currentPage, totalPages, handleBulkAnnotation, handleSettingsChange]);

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
      if (window.electronAPI) {
        const folder = await window.electronAPI.selectFolder();
        if (folder) {
          setRootAudioPath(folder);
          // Save to localStorage
          const savedSettings = localStorage.getItem('review_settings');
          const currentSettings = savedSettings ? JSON.parse(savedSettings) : {};
          const newSettings = { ...currentSettings, root_audio_path: folder };
          localStorage.setItem('review_settings', JSON.stringify(newSettings));
        }
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

              if (window.electronAPI?.saveFile) {
                saveLocation = await window.electronAPI.saveFile(defaultName);
                if (saveLocation) {
                  setCurrentSavePath(saveLocation);
                } else {
                  resolve(); // User cancelled save dialog
                  return;
                }
              }
            }

            if (saveLocation && window.electronAPI?.writeFile) {
              const csvContent = exportToCSV(currentData, currentSettings);
              await window.electronAPI.writeFile(saveLocation, csvContent);
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
            if (currentSavePath && window.electronAPI?.writeFile) {
              const csvContent = exportToCSV(currentData, currentSettings);
              await window.electronAPI.writeFile(currentSavePath, csvContent);
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
    if (!window.electronAPI) {
      // Browser fallback - create downloadable file
      const csvContent = exportToCSV(currentData, currentSettings);
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `annotations_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setHasUnsavedChanges(false);
      return;
    }

    const csvContent = exportToCSV(currentData, currentSettings);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultName = `annotations_${timestamp}.csv`;

    // Check if writeFile is available for proper Electron file saving
    if (window.electronAPI.writeFile) {
      const filePath = await window.electronAPI.saveFile(defaultName);
      if (filePath) {
        await window.electronAPI.writeFile(filePath, csvContent);
        setCurrentSavePath(filePath); // Set the save path for future auto-saves
        setHasUnsavedChanges(false);
      }
    } else {
      // Fallback: just trigger download without file dialog
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      a.click();
      URL.revokeObjectURL(url);
      setHasUnsavedChanges(false);
    }
  };

  const handleSaveAs = async () => {
    try {
      // Use functional setState to ensure we have the most current state
      const saveAsWithCurrentState = (currentData, currentSettings) => {
        return new Promise(async (resolve, reject) => {
          try {
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
          saveAsWithCurrentState(currentData, currentSettings).catch(err => {
            console.error('Save As failed:', err);
            setError('Failed to export annotations: ' + err.message);
          });
          return currentSettings; // Don't modify the settings
        });
        return currentData; // Don't modify the data
      });
    } catch (err) {
      setError('Failed to export annotations: ' + err.message);
    }
  };

  const exportToCSV = (dataToExport = null, currentSettings = null) => {
    // Use provided data or current state (ensures we always have the latest data)
    const dataToUse = dataToExport || annotationData;
    const settingsToUse = currentSettings || settings;

    // Dynamic headers based on review mode
    const baseHeaders = ['file', 'start_time', 'end_time'];
    const annotationHeaders = settingsToUse.review_mode === 'multiclass'
      ? ['labels', 'annotation_status']
      : ['annotation'];
    const headers = [...baseHeaders, ...annotationHeaders, 'comments'];

    const rows = dataToUse.map(clip => {
      const baseRow = [
        clip.file,
        clip.start_time,
        clip.end_time
      ];

      const annotationRow = settingsToUse.review_mode === 'multiclass'
        ? [
          clip.labels != null ? clip.labels : '',
          clip.annotation_status != null ? clip.annotation_status : 'unreviewed'
        ]
        : [
          // For binary mode, treat empty string as truly empty (no annotation)
          clip.annotation != null && clip.annotation !== '' ? clip.annotation : null
        ];

      // Handle comments: treat empty/NaN/null as truly null
      const commentsValue = clip.comments != null && clip.comments !== '' && !Number.isNaN(clip.comments) ? clip.comments : null;

      return [...baseRow, ...annotationRow, commentsValue];
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

  const getGridClassName = useCallback(() => {
    return `annotation-grid grid-${settings.grid_rows}x${settings.grid_columns}`;
  }, [settings.grid_rows, settings.grid_columns]);



  const renderAnnotationGrid = useMemo(() => {
    // Use displayedPageData instead of currentPageData to prevent showing unloaded content
    const currentData = displayedPageData.length > 0 ? displayedPageData : currentPageData;

    if (currentData.length === 0) {
      return (
        <div className="no-data-message">
          <p>No clips to display on this page.</p>
        </div>
      );
    }

    // Don't show loading overlay - just keep old content visible until new content is ready
    // const showLoadingOverlay = httpLoader.isLoading || isPageTransitioning;

    return (
      <div className="annotation-grid-container" style={{ position: 'relative' }}>
        <div className={getGridClassName()}>
          {currentData.map(clip => {
            // Find the loaded data for this clip
            const loadedClip = loadedPageData.find(loaded => loaded.clip_id === clip.id) || clip;

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
                onAnnotationChange={(annotation, annotationStatus) => handleAnnotationChange(clip.id, annotation, annotationStatus)}
                onCommentChange={(comment) => handleCommentChange(clip.id, comment)}
                disableAutoLoad={true} // Use batch loading instead
              />
            );
          })}
        </div>

        {/* Loading overlay disabled - old content stays visible until new content loads */}
        {/* {showLoadingOverlay && (
          <div className="loading-overlay">
            <div className="loading-content">
              <p>Loading spectrograms...</p>
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
        )} */}
      </div>
    );
  }, [displayedPageData, currentPageData, loadedPageData, httpLoader.isLoading, isPageTransitioning, httpLoader.progress, getGridClassName, settings.review_mode, availableClasses, settings.show_comments, settings.show_file_name, handleAnnotationChange, handleCommentChange]);

  return (
    <div className="review-tab-layout">
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
            Load & Filter
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
            <p>Load a CSV file with columns: file, start_time, end_time (optional), annotation, comments (optional)</p>

            <div className="button-group">
              <button onClick={handleLoadAnnotationTask} disabled={loading}>
                {loading ? 'Loading...' : 'Load Annotation CSV'}
              </button>
              {selectedFile && (
                <span className="selected-file">
                  Loaded: {selectedFile.split('/').pop()}
                </span>
              )}
              {annotationData.length > 0 && (
                <button
                  onClick={handleSave}
                  className="primary-button"
                  disabled={!hasUnsavedChanges}
                >
                  {hasUnsavedChanges ? 'Save Annotations *' : 'Save Annotations'}
                </button>
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
                {error}
              </div>
            )}

          </div>

          {/* Filtering Section */}
          {annotationData.length > 0 && (
            <div className="tray-section">
              <h4>Filter Clips</h4>

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
                    <select
                      multiple
                      value={filters.annotation.values}
                      onChange={(e) => {
                        const values = Array.from(e.target.selectedOptions, option => option.value);
                        handleFilterChange('annotation', true, values);
                      }}
                      className="filter-multiselect"
                    >
                      {getFilterOptions.annotation.map(option => (
                        <option key={option} value={option}>
                          {option === '' ? 'unlabeled' : option}
                        </option>
                      ))}
                    </select>
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
                      <select
                        multiple
                        value={filters.labels.values}
                        onChange={(e) => {
                          const values = Array.from(e.target.selectedOptions, option => option.value);
                          handleFilterChange('labels', true, values);
                        }}
                        className="filter-multiselect"
                      >
                        {getFilterOptions.labels.map(option => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
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
                      <select
                        multiple
                        value={filters.annotation_status.values}
                        onChange={(e) => {
                          const values = Array.from(e.target.selectedOptions, option => option.value);
                          handleFilterChange('annotation_status', true, values);
                        }}
                        className="filter-multiselect"
                      >
                        {getFilterOptions.annotation_status.map(option => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
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
              />
              <HttpServerStatus
                serverUrl="http://localhost:8000"
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
                </div>
              </div>

              {/* Grid Mode Shortcuts */}
              <div className="shortcuts-section">
                <h3>Grid Mode</h3>
                <div className="shortcuts-list">
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd</kbd> + <kbd>J</kbd>
                    <span>Previous page</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd</kbd> + <kbd>K</kbd>
                    <span>Next page</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd>
                    <span>Toggle comments visibility</span>
                  </div>
                  {settings.review_mode === 'binary' && (
                    <>
                      <div className="shortcuts-subsection">
                        <h4>Bulk Annotation (Binary Mode)</h4>
                        <div className="shortcut-item">
                          <kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>A</kbd>
                          <span>Mark all clips on page as Yes</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd>
                          <span>Mark all clips on page as No</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd>
                          <span>Mark all clips on page as Uncertain</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd>
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
                          <span>Mark as Yes</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>S</kbd>
                          <span>Mark as No</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>D</kbd>
                          <span>Mark as Uncertain</span>
                        </div>
                        <div className="shortcut-item">
                          <kbd>F</kbd>
                          <span>Mark as Unlabeled</span>
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

      {/* Main Content Area - Full Window */}
      <div className="review-main-content">
        {/* Compact Top Toolbar */}
        <div
          className="review-toolbar"
          style={{
            left: drawerOpen ? '240px' : 'calc(64px + 1px)',
            width: drawerOpen ? 'calc(100% - 240px)' : 'calc(100% - 65px)'
          }}
        >
          <div className="toolbar-left">
            {/* Left Tray Toggle */}
            <button
              onClick={() => setIsLeftTrayOpen(true)}
              className="toolbar-btn"
              title="Load & Filter"
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
              title={currentSavePath ? `Save to ${currentSavePath.split('/').pop()}` : "Save (will open save dialog)"}
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
                {!isFocusMode && settings.review_mode === 'binary' && currentPageData.length > 0 && (
                  <div className="toolbar-bulk-controls">
                    <button
                      className="toolbar-btn bulk-btn"
                      onClick={() => handleBulkAnnotation('yes')}
                      title={`Mark all ${currentPageData.length} clips on this page as Yes`}
                      style={{ color: 'rgb(145, 180, 135)' }}
                    >
                      <span className="material-symbols-outlined">check_circle</span>
                    </button>
                    <button
                      className="toolbar-btn bulk-btn"
                      onClick={() => handleBulkAnnotation('no')}
                      title={`Mark all ${currentPageData.length} clips on this page as No`}
                      style={{ color: 'rgb(207, 122, 107)' }}
                    >
                      <span className="material-symbols-outlined">cancel</span>
                    </button>
                    <button
                      className="toolbar-btn bulk-btn"
                      onClick={() => handleBulkAnnotation('uncertain')}
                      title={`Mark all ${currentPageData.length} clips on this page as Uncertain`}
                      style={{ color: 'rgb(237, 223, 177)' }}
                    >
                      <span className="material-symbols-outlined">help</span>
                    </button>
                    <button
                      className="toolbar-btn bulk-btn"
                      onClick={() => handleBulkAnnotation('unlabeled')}
                      title={`Mark all ${currentPageData.length} clips on this page as Unlabeled`}
                      style={{ color: 'rgb(223, 223, 223)' }}
                    >
                      <span className="material-symbols-outlined">restart_alt</span>
                    </button>
                  </div>
                )}

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

                {/* Page Navigation */}
                {!isFocusMode && totalPages > 1 && (
                  <div className="page-navigation">
                    <button
                      className="toolbar-btn"
                      onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                      disabled={currentPage === 0}
                      title="Previous Page"
                    >
                      <span className="material-symbols-outlined">chevron_left</span>
                    </button>

                    <select
                      className="page-dropdown"
                      value={currentPage}
                      onChange={(e) => setCurrentPage(parseInt(e.target.value))}
                      title="Go to page"
                    >
                      {Array.from({ length: totalPages }, (_, i) => (
                        <option key={i} value={i}>
                          Page {i + 1}
                        </option>
                      ))}
                    </select>

                    <button
                      className="toolbar-btn"
                      onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
                      disabled={currentPage >= totalPages - 1}
                      title="Next Page"
                    >
                      <span className="material-symbols-outlined">chevron_right</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="toolbar-right">
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
            {error}
          </div>
        )}


        {/* Main Content Area - Grid or Focus View */}
        <div className={`review-content ${annotationData.length > 0 ? (isFocusMode ? 'focus-mode' : 'grid-mode') : 'placeholder-mode'}`}>
          {annotationData.length > 0 ? (
            <>
              {isFocusMode ? (
                // Focus Mode View - Centered
                <div className="focus-view-container">
                  <FocusView
                    clipData={{
                      ...filteredAnnotationData[focusClipIndex],
                      // Find loaded spectrogram data for current clip
                      ...loadedPageData.find(loaded => loaded.clip_id === filteredAnnotationData[focusClipIndex]?.id) || {}
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
                  <h3>Ready for Annotation Review 📝 <HelpIcon section="review" /></h3>
                  <p>Load a CSV file to begin reviewing and annotating audio clips. Supported formats:</p>

                  <div className="format-section">
                    <h4>📋 Required Columns (all formats)</h4>
                    <ul>
                      <li><strong>file</strong>: Path to audio file</li>
                      <li><strong>start_time</strong>: Start time in seconds</li>
                      <li><strong>end_time</strong>: End time in seconds (optional)</li>
                      <li><strong>comments</strong>: Text comments (optional)</li>
                    </ul>

                    <h4>Format 1: Binary Review</h4>
                    <ul>
                      <li><strong>annotation</strong>: Binary labels (yes/no/uncertain/empty)</li>
                    </ul>
                    <p><em>Example: file,start_time,end_time,annotation,comments</em></p>

                    <h4>Format 2: Multi-class with Labels Column</h4>
                    <ul>
                      <li><strong>labels</strong>: Comma-separated or JSON list of classes</li>
                      <li><strong>annotation_status</strong>: complete/unreviewed/uncertain</li>
                    </ul>
                    <p><em>Example: file,start_time,end_time,labels,annotation_status,comments</em></p>

                    <h4>Format 3: Multi-hot (One Column Per Class)</h4>
                    <ul>
                      <li><strong>[class_name]</strong>: One column per class with 0/1 values or continuous scores</li>
                    </ul>
                    <p><em>Example: file,start_time,end_time,robin,cardinal,blue_jay,comments</em></p>
                  </div>

                  <p><strong>The system auto-detects the format and switches to the appropriate review mode.</strong></p>

                  {/* Load CSV Button */}
                  <div className="placeholder-actions">
                    <button
                      onClick={handleLoadAnnotationTask}
                      disabled={loading}
                      className="primary-button load-csv-button"
                    >
                      {loading ? 'Loading...' : 'Load Annotation CSV'}
                    </button>
                    <p className="load-button-help">
                      <small>You can also use the menu button in the top-left to access loading and filtering options.</small>
                    </p>
                  </div>
                </div>
              </div>
            )
          )}
        </div>

      </div>
      {/* Status Bar - Always visible when data is loaded */}
      {annotationData.length > 0 && (
        <div className="review-status-bar">
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
      )}
    </div>
  );
}

export default ReviewTab;