import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { Autocomplete, TextField, Box } from '@mui/material';
// import { useRenderProfiler } from './PerformanceProfiler';

const AnnotationCard = memo(function AnnotationCard({
  clipData,
  reviewMode = 'binary', // 'binary' or 'multiclass'
  availableClasses = [],
  showComments = false,
  showFileName = true,
  onAnnotationChange,
  onCommentChange,
  className = "",
  disableAutoLoad = false // New prop to disable auto-loading
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [spectrogramUrl, setSpectrogramUrl] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef(null);
  const loadingRef = useRef(false);
  const lastLoadedRef = useRef(null);

  // Add render profiling
  // useRenderProfiler('AnnotationCard');

  const {
    file = '',
    start_time = 0,
    end_time = 0,
    annotation = '',
    labels = '',
    annotation_status = 'unreviewed',
    comments = '',
    spectrogram_base64 = null,
    audio_base64 = null
  } = clipData || {};

  // Create audio URL from base64 data
  useEffect(() => {
    if (audio_base64) {
      const dataUrl = `data:audio/wav;base64,${audio_base64}`;
      setAudioUrl(dataUrl);
    } else {
      setAudioUrl(null);
    }
  }, [audio_base64]);

  // Audio event handlers
  const handleAudioTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }, []);

  const handleAudioLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  }, []);

  const handleAudioEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  // Click to play/pause spectrogram
  const handleSpectrogramClick = useCallback(async () => {
    if (!audioUrl || isLoading) return;

    try {
      if (isPlaying) {
        // Pause audio
        if (audioRef.current) {
          audioRef.current.pause();
        }
        setIsPlaying(false);
      } else {
        // Play audio
        if (audioRef.current) {
          await audioRef.current.play();
          setIsPlaying(true);
        }
      }
    } catch (err) {
      console.error('Audio playback error:', err);
      setError('Failed to play audio: ' + err.message);
    }
  }, [audioUrl, isLoading, isPlaying]);

  // Parse annotation based on review mode
  const getAnnotationValue = () => {
    if (reviewMode === 'binary') {
      return annotation || 'unlabeled';
    } else {
      // Multi-class: use labels column instead of annotation column
      const labelsToUse = labels || '';
      if (!labelsToUse || labelsToUse === '' || labelsToUse === 'nan') {
        return []; // Not annotated
      }
      try {
        // Handle both string arrays like "['a','b']" and comma-separated like "a,b"
        if (labelsToUse.startsWith('[') && labelsToUse.endsWith(']')) {
          return JSON.parse(labelsToUse.replace(/'/g, '"'));
        } else {
          return labelsToUse.split(',').map(s => s.trim()).filter(s => s);
        }
      } catch (e) {
        return [];
      }
    }
  };

  const annotationValue = getAnnotationValue();

  // Annotation status options for multi-class mode
  const annotationStatusOptions = [
    { value: 'complete', label: 'Complete', symbol: 'check_circle', color: 'rgb(145, 180, 135)' },
    { value: 'uncertain', label: 'Uncertain', symbol: 'help', color: 'rgb(237, 223, 177)' },
    { value: 'unreviewed', label: 'Unreviewed', symbol: 'radio_button_unchecked', color: 'rgb(223, 223, 223)' }
  ];


  // Cleanup effect to prevent memory leaks
  useEffect(() => {
    return () => {
      // Clean up blob URLs to prevent memory leaks
      if (spectrogramUrl && spectrogramUrl.startsWith('data:')) {
        // Data URLs don't need cleanup, but file URLs would
      }
    };
  }, [spectrogramUrl]);

  // Binary review options with semantic colors
  const binaryOptions = [
    { value: 'yes', label: 'Yes', symbol: 'check_circle', color: 'rgb(145, 180, 135)' },
    { value: 'no', label: 'No', symbol: 'cancel', color: 'rgb(207, 122, 107)' },
    { value: 'uncertain', label: 'Uncertain', symbol: 'question_mark', color: 'rgb(237, 223, 177)' },
    { value: 'unlabeled', label: 'Reset', symbol: 'restart_alt', color: 'rgb(223, 223, 223)' }
  ];

  // Multi-class support for Material UI Autocomplete
  // (Options are now passed directly to the Autocomplete component)

  // Get card styling based on annotation
  const getCardStyle = () => {
    if (reviewMode === 'binary') {
      const option = binaryOptions.find(opt => opt.value === annotationValue);
      return {
        borderColor: option?.color || '#d1d5db',
        borderWidth: '3px',
        borderStyle: 'solid'
      };
    } else {
      // Multi-class: border color based on annotation status
      const statusOption = annotationStatusOptions.find(opt => opt.value === annotation_status);
      return {
        borderColor: statusOption?.color || '#6b7280',
        borderWidth: '3px',
        borderStyle: 'solid'
      };
    }
  };

  const handleBinaryAnnotationChange = useCallback((value) => {
    if (onAnnotationChange) {
      onAnnotationChange(clipData.id, value === 'unlabeled' ? '' : value);
    }
  }, [onAnnotationChange, clipData.id]);

  const handleMulticlassAnnotationChange = useCallback((selectedOptions) => {
    const classes = selectedOptions ? selectedOptions.map(opt => opt.value) : [];
    if (onAnnotationChange) {
      // Convert to string format for storage
      const annotationString = classes.length > 0 ? JSON.stringify(classes) : '[]';
      onAnnotationChange(clipData.id, annotationString);
    }
  }, [onAnnotationChange, clipData.id]);

  const handleAnnotationStatusChange = useCallback((value) => {
    if (onAnnotationChange) {
      // Call annotation change with current annotation value and the new status
      onAnnotationChange(clipData.id, annotationValue, value);
    }
  }, [onAnnotationChange, annotationValue, clipData.id]);

  const handleCommentChange = (event) => {
    if (onCommentChange) {
      onCommentChange(clipData.id, event.target.value);
    }
  };


  // Auto-load spectrogram when props change (proper implementation)
  useEffect(() => {
    const currentKey = `${file}:${start_time}`;
    
    // Only proceed if we should auto-load and haven't tried this combination before
    if (!disableAutoLoad && file && start_time !== undefined && 
        lastLoadedRef.current !== currentKey && !spectrogram_base64) {
      
      lastLoadedRef.current = currentKey;
      
      // Create an async function inside useEffect to handle the loading
      const loadSpec = async () => {
        if (loadingRef.current) return;

        try {
          loadingRef.current = true;
          setIsLoading(true);
          setError('');

          // Get visualization settings
          const savedSettings = localStorage.getItem('visualization_settings');
          const settings = savedSettings ? JSON.parse(savedSettings) : {
            spec_window_size: 512,
            spectrogram_colormap: 'greys_r',
            dB_range: [-80, -20],
            use_bandpass: false,
            bandpass_range: [500, 8000],
            show_reference_frequency: false,
            reference_frequency: 1000,
            resize_images: true,
            image_width: 224,
            image_height: 224,
          };

          if (window.electronAPI && file && start_time !== undefined) {
            const clipEndTime = end_time || start_time + 3;

            // Get current root audio path from localStorage
            const reviewSettings = localStorage.getItem('review_settings');
            const currentRootAudioPath = reviewSettings ? JSON.parse(reviewSettings).root_audio_path || '' : '';
            
            let fullFilePath = file;
            if (currentRootAudioPath && !file.startsWith('/') && !file.match(/^[A-Za-z]:\\/)) {
              fullFilePath = `${currentRootAudioPath}/${file}`;
            }

            console.log('Loading spectrogram for:', fullFilePath, 'from', start_time, 'to', clipEndTime);

            const result = await window.electronAPI.createAudioClips(
              fullFilePath,
              start_time,
              clipEndTime,
              settings
            );

            console.log('Spectrogram result:', result);

            if (result.status === 'success' && result.spectrogram_base64) {
              const dataUrl = `data:image/png;base64,${result.spectrogram_base64}`;
              setSpectrogramUrl(dataUrl);
            } else {
              setError(result.error || 'Failed to generate spectrogram');
            }
          } else {
            setError('Missing file path or Electron API not available');
          }
        } catch (err) {
          setError(`Failed to load spectrogram: ${err.message}`);
        } finally {
          loadingRef.current = false;
          setIsLoading(false);
        }
      };

      loadSpec();
    }
  }, [file, start_time, end_time, disableAutoLoad]);

  // Memoize spectrogram rendering to prevent re-renders when annotation changes
  const spectrogramMemo = useMemo(() => {
    return { spectrogram_base64, file, start_time, end_time };
  }, [spectrogram_base64, file, start_time, end_time]);

  const renderSpectrogram = useMemo(() => {
    // Debug spectrogram data
    console.log('AnnotationCard renderSpectrogram:', {
      hasSpecBase64: !!spectrogramMemo.spectrogram_base64,
      hasSpectrogramUrl: !!spectrogramUrl,
      isLoading,
      file: spectrogramMemo.file,
      start_time: spectrogramMemo.start_time,
      clipData_keys: Object.keys(clipData || {}),
      spectrogram_base64_length: spectrogramMemo.spectrogram_base64?.length || 0
    });

    if (spectrogramMemo.spectrogram_base64) {
      const dataUrl = `data:image/png;base64,${spectrogramMemo.spectrogram_base64}`;
      console.log('Using spectrogram_base64, dataUrl length:', dataUrl.length);
      return (
        <img
          src={dataUrl}
          alt="Spectrogram"
          className="annotation-spectrogram"
          onLoad={() => console.log('Spectrogram image loaded successfully')}
          onError={(e) => console.error('Spectrogram image load error:', e)}
        />
      );
    }

    if (spectrogramUrl) {
      console.log('Using spectrogramUrl:', spectrogramUrl);
      return (
        <img
          src={spectrogramUrl}
          alt="Spectrogram"
          className="annotation-spectrogram"
          onLoad={() => console.log('Spectrogram URL loaded successfully')}
          onError={(e) => console.error('Spectrogram URL load error:', e)}
        />
      );
    }

    if (isLoading) {
      return (
        <div className="spectrogram-loading">
          <div className="loading-spinner">⏳</div>
          <div>Loading spectrogram...</div>
        </div>
      );
    }

    return (
      <div className="spectrogram-placeholder">
        <img src="/icon.svg" alt="Loading" className="placeholder-icon app-icon" />
        <div className="placeholder-text">Loading spectrogram...</div>
      </div>
    );
  }, [spectrogramMemo, spectrogramUrl, isLoading]);

  const renderAnnotationControl = () => {
    if (reviewMode === 'binary') {
      return (
        <div className="binary-annotation-control">
          <div className="segmented-control">
            {binaryOptions.map(option => (
              <button
                key={option.value}
                className={`segment ${annotationValue === option.value ? 'active' : ''}`}
                style={{
                  backgroundColor: annotationValue === option.value ? option.color : 'transparent',
                  borderColor: option.color,
                  color: annotationValue === option.value ? 'white' : option.color
                }}
                onClick={() => handleBinaryAnnotationChange(option.value)}
                title={option.label}
              >
                <span className="material-symbols-outlined">{option.symbol}</span>
              </button>
            ))}
          </div>
        </div>
      );
    } else {
      // Multi-class
      return (
        <div className="multiclass-annotation-control">
          <Box sx={{ mb: 1 }}>
            <Autocomplete
              multiple
              options={availableClasses}
              value={annotationValue}
              onChange={(_, newValue) => {
                const selectedOptions = newValue.map(cls => ({ value: cls, label: cls }));
                handleMulticlassAnnotationChange(selectedOptions);
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder="Select classes..."
                  variant="outlined"
                  size="small"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      minHeight: '38px',
                    },
                  }}
                />
              )}
              sx={{
                '& .MuiAutocomplete-tag': {
                  backgroundColor: 'primary.main',
                  color: 'primary.contrastText',
                  borderRadius: 1,
                  fontSize: '0.8rem',
                  fontWeight: 500,
                },
              }}
              disableCloseOnSelect
              clearOnBlur={false}
              selectOnFocus
              handleHomeEndKeys
            />
          </Box>

          {/* Annotation status control */}
          <div className="annotation-status-control">
            <label className="status-label">Review Status:</label>
            <div className="segmented-control">
              {annotationStatusOptions.map(option => (
                <button
                  key={option.value}
                  className={`segment ${annotation_status === option.value ? 'active' : ''}`}
                  style={{
                    backgroundColor: annotation_status === option.value ? option.color : 'transparent',
                    borderColor: option.color,
                    color: annotation_status === option.value ? 'white' : option.color
                  }}
                  onClick={() => handleAnnotationStatusChange(option.value)}
                  title={option.label}
                >
                  <span className="material-symbols-outlined">{option.symbol}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }
  };

  return (
    <div className={`annotation-card ${className}`} style={getCardStyle()}>
      {/* Hidden audio element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleAudioTimeUpdate}
          onLoadedMetadata={handleAudioLoadedMetadata}
          onEnded={handleAudioEnded}
          preload="metadata"
        />
      )}

      {/* Spectrogram area - clickable */}
      <div
        className={`annotation-spectrogram-container ${audioUrl ? 'clickable' : ''}`}
        onClick={handleSpectrogramClick}
        title={audioUrl ? (isPlaying ? 'Click to pause audio' : 'Click to play audio') : 'Audio not available'}
      >
        {renderSpectrogram}

        {/* Progress bar overlay */}
        {duration > 0 && (
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(currentTime / duration) * 100}%` }}
            />
          </div>
        )}


        {error && (
          <div className="annotation-error">
            {error}
          </div>
        )}
      </div>

      {/* Card content */}
      <div className="annotation-card-content">
        {/* File info */}
        {showFileName && (
          <div className="file-info">
            <div className="file-name" title={file}>
              {file ? file.split('/').pop() : 'Unknown file'}
            </div>
            <div className="time-info">
              {start_time !== undefined && (
                <span>{start_time.toFixed(1)}s</span>
              )}
              {end_time && end_time !== start_time && (
                <span> - {end_time.toFixed(1)}s</span>
              )}
            </div>
          </div>
        )}

        {/* Annotation control */}
        <div className="annotation-control">
          {renderAnnotationControl()}
        </div>

        {/* Comments field */}
        {showComments && (
          <div className="comments-field">
            <textarea
              placeholder="Add comments..."
              value={localComment}
              onChange={handleCommentChange}
              className="comment-textarea"
              rows={2}
            />
          </div>
        )}
      </div>
    </div>
  );
});

export default AnnotationCard;