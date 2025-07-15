import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Drawer, IconButton } from '@mui/material';
import { Settings as SettingsIcon, Close as CloseIcon } from '@mui/icons-material';
import AnnotationCard from './AnnotationCard';
import ReviewSettings from './ReviewSettings';
import FocusView from './FocusView';
import { useHttpAudioLoader, HttpServerStatus } from './HttpAudioLoader';

function ReviewTab() {
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
    focus_mode_autoplay: true
  });
  const [availableClasses, setAvailableClasses] = useState([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [loadedPageData, setLoadedPageData] = useState([]);
  const [isPageTransitioning, setIsPageTransitioning] = useState(false);
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [rootAudioPath, setRootAudioPath] = useState('');
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [focusClipIndex, setFocusClipIndex] = useState(0);
  const fileInputRef = useRef(null);

  // HTTP-based loader (fast and reliable)
  const httpLoader = useHttpAudioLoader('http://localhost:8000');

  // Calculate items per page based on grid settings
  const itemsPerPage = settings.grid_rows * settings.grid_columns;
  const totalPages = Math.ceil(annotationData.length / itemsPerPage);

  // Get current page data - memoized to prevent unnecessary re-renders
  const getCurrentPageData = useCallback(() => {
    const start = currentPage * itemsPerPage;
    const end = start + itemsPerPage;
    return annotationData.slice(start, end);
  }, [currentPage, itemsPerPage, annotationData]);

  // Memoize current page data separately to reduce dependencies
  const currentPageData = useMemo(() => {
    const start = currentPage * itemsPerPage;
    const end = start + itemsPerPage;
    return annotationData.slice(start, end);
  }, [currentPage, itemsPerPage, annotationData]);

  // Load spectrograms for current page
  const loadCurrentPageSpectrograms = useCallback(async () => {
    const currentData = getCurrentPageData();
    if (currentData.length > 0) {
      try {
        setIsPageTransitioning(true);

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

        setLoadedPageData(loadedClips);
      } catch (error) {
        console.error('Failed to load page spectrograms:', error);
        console.error('Error details:', {
          message: error.message,
          settings: visualizationSettings,
          clipCount: clipsToLoad.length
        });
      } finally {
        setIsPageTransitioning(false);
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
  
  // Load spectrograms when page changes, new data loaded, or settings change
  useEffect(() => {
    if (annotationData.length > 0) {
      loadCurrentPageSpectrograms();
    }
  }, [currentPage, currentDataVersion, rootAudioPath]);
  
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

      if (!rootAudioPath) {
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
        'load_annotation_task.py',
        [filePath],
        processId
      );

      const data = JSON.parse(result.stdout);
      if (data.error) {
        setError(data.error);
      } else {
        setAnnotationData(data.clips);
        extractAvailableClasses(data.clips);
        setCurrentPage(0);
        setHasUnsavedChanges(false);
      }
    } catch (err) {
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
    const currentClip = annotationData[focusClipIndex];
    if (currentClip) {
      handleAnnotationChange(currentClip.id, newAnnotation, newAnnotationStatus);
    }
  }, [focusClipIndex, annotationData, handleAnnotationChange]);

  // Reset focus index when data changes
  useEffect(() => {
    if (annotationData.length > 0 && focusClipIndex >= annotationData.length) {
      setFocusClipIndex(0);
    }
  }, [annotationData.length, focusClipIndex]);

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
      setIsPageTransitioning(true);

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
      setIsPageTransitioning(false);
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

  const handleExportAnnotations = async () => {
    try {
      if (!window.electronAPI) {
        // Browser fallback - create downloadable file
        const csvContent = exportToCSV();
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

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `annotations_${timestamp}.csv`;
      const filePath = await window.electronAPI.saveFile(defaultName);

      if (filePath) {
        const csvContent = exportToCSV();
        // For now, trigger download since writeFile doesn't exist
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filePath.split('/').pop() || 'annotations.csv';
        a.click();
        URL.revokeObjectURL(url);
        setHasUnsavedChanges(false);
      }
    } catch (err) {
      setError('Failed to export annotations: ' + err.message);
    }
  };

  const exportToCSV = () => {
    // Dynamic headers based on review mode
    const baseHeaders = ['file', 'start_time', 'end_time'];
    const annotationHeaders = settings.review_mode === 'multiclass'
      ? ['labels', 'annotation_status']
      : ['annotation'];
    const headers = [...baseHeaders, ...annotationHeaders, 'comments'];

    const rows = annotationData.map(clip => {
      const baseRow = [
        clip.file,
        clip.start_time,
        clip.end_time
      ];

      const annotationRow = settings.review_mode === 'multiclass'
        ? [clip.labels || '', clip.annotation_status || 'unreviewed']
        : [clip.annotation || ''];

      return [...baseRow, ...annotationRow, clip.comments || ''];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(field => `"${field}"`).join(','))
    ].join('\n');

    return csvContent;
  };

  const getGridClassName = useCallback(() => {
    return `annotation-grid grid-${settings.grid_rows}x${settings.grid_columns}`;
  }, [settings.grid_rows, settings.grid_columns]);

  const renderPagination = () => {
    if (totalPages <= 1) return null;

    return (
      <div className="pagination-container">
        <button
          className="pagination-button"
          onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
          disabled={currentPage === 0}
        >
          Previous
        </button>

        <div className="pagination-info">
          <span>Page</span>
          <select 
            value={currentPage + 1} 
            onChange={(e) => setCurrentPage(parseInt(e.target.value) - 1)}
            className="page-selector"
          >
            {Array.from({ length: totalPages }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
          <span>of {totalPages} ({annotationData.length} clips total)</span>
        </div>

        <button
          className="pagination-button"
          onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
          disabled={currentPage === totalPages - 1}
        >
          Next
        </button>
      </div>
    );
  };

  const renderAnnotationGrid = useMemo(() => {
    const currentData = currentPageData;

    if (currentData.length === 0) {
      return (
        <div className="no-data-message">
          <p>No clips to display on this page.</p>
        </div>
      );
    }

    // Show loading overlay over existing content instead of replacing it
    const showLoadingOverlay = httpLoader.isLoading || isPageTransitioning;

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
        
        {/* Loading overlay that appears over existing content */}
        {showLoadingOverlay && (
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
        )}
      </div>
    );
  }, [currentPageData, loadedPageData, httpLoader.isLoading, isPageTransitioning, httpLoader.progress, getGridClassName, settings.review_mode, availableClasses, settings.show_comments, settings.show_file_name, handleAnnotationChange, handleCommentChange]);

  return (
    <div className="review-tab-layout">
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

      {/* Main Content Area */}
      <div className="main-content-area">
        <div className="main-content-header">
          <h2>Review Annotations</h2>
          {annotationData.length > 0 && (
            <div className="header-controls">
              {/* Focus Mode Toggle */}
              <div className="focus-mode-toggle">
                <button
                  className={`focus-toggle-btn ${isFocusMode ? 'active' : ''}`}
                  onClick={() => setIsFocusMode(!isFocusMode)}
                  title={isFocusMode ? 'Switch to Grid View' : 'Switch to Focus Mode'}
                >
                  <span className="material-symbols-outlined">
                    {isFocusMode ? 'grid_view' : 'fullscreen'}
                  </span>
                  {isFocusMode ? 'Grid View' : 'Focus Mode'}
                </button>
              </div>

              {/* Settings Button */}
              <IconButton 
                onClick={() => setIsSettingsPanelOpen(true)}
                sx={{ 
                  color: '#4f5d75',
                  backgroundColor: '#ffffff',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  padding: '0.5rem',
                  '&:hover': { 
                    backgroundColor: '#f3f4f6',
                    borderColor: '#4f5d75'
                  }
                }}
                title="Open Settings"
              >
                <SettingsIcon />
              </IconButton>
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

        {/* LOAD ANNOTATION TASK - BACK TO TOP */}
        <div className="section">
          <h3>Load Annotation Task</h3>
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
                onClick={handleExportAnnotations}
                className="primary-button"
                disabled={!hasUnsavedChanges}
              >
                {hasUnsavedChanges ? 'Export Annotations *' : 'Export Annotations'}
              </button>
            )}
          </div>

          {/* Root Audio Path Setting - moved below button */}
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

          {hasUnsavedChanges && (
            <div className="unsaved-changes-notice">
              <strong>⚠ Unsaved changes</strong> - Remember to export your annotations when finished.
            </div>
          )}
        </div>

        {/* SPECTROGRAM GRID OR FOCUS VIEW - AFTER LOAD SECTION */}
        {annotationData.length > 0 && (
          <div className="section">
            <h3>
              Annotation Review
              {settings.review_mode === 'binary' ? '(Binary Mode)' : '(Multi-class Mode)'}
              {isFocusMode && ` - Focus Mode (${focusClipIndex + 1} of ${annotationData.length})`}
            </h3>

            {isFocusMode ? (
              // Focus Mode View
              <FocusView
                clipData={{
                  ...annotationData[focusClipIndex],
                  // Find loaded spectrogram data for current clip
                  ...loadedPageData.find(loaded => loaded.clip_id === annotationData[focusClipIndex]?.id) || {}
                }}
                onAnnotationChange={handleFocusAnnotationChange}
                onNavigate={handleFocusNavigation}
                settings={settings}
                reviewMode={settings.review_mode}
                availableClasses={availableClasses}
                isLastClip={focusClipIndex === annotationData.length - 1}
                autoAdvance={true}
              />
            ) : (
              // Grid Mode View
              <>
                {renderPagination()}
                {renderAnnotationGrid}
                {renderPagination()}
              </>
            )}
          </div>
        )}

        {/* PLACEHOLDER - SHOWN WHEN NO DATA LOADED */}
        {annotationData.length === 0 && !loading && !error && (
          <div className="section">
            <div className="placeholder-content">
              <div className="placeholder-icon">📝</div>
              <h3>Ready for Annotation Review</h3>
              <p>Load a CSV file to begin reviewing and annotating audio clips. The CSV should contain:</p>
              <ul>
                <li><strong>file</strong>: Path to audio file</li>
                <li><strong>start_time</strong>: Start time in seconds</li>
                <li><strong>end_time</strong>: End time in seconds (optional)</li>
                <li>Either <strong>annotation</strong>: Binary classification label (yes/no/unsure)</li>
                <li>Or <strong>labels</strong> and <strong>complete</strong>: Comma-separated labels for multi-class annotations</li>
                <li><strong>comments</strong>: Text comments (optional)</li>
              </ul>
              <p>Choose between binary review (yes/no/unsure) or multi-class review modes.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ReviewTab;