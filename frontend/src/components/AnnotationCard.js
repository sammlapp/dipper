import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import Select from 'react-select';
// import { useRenderProfiler } from './PerformanceProfiler';

const AnnotationCard = memo(function AnnotationCard({
  clipData,
  reviewMode = 'binary', // 'binary' or 'multiclass'
  availableClasses = [],
  showComments = false,
  showFileName = true,
  isActive = false, // New prop to indicate active clip
  onAnnotationChange,
  onCommentChange,
  onCardClick, // New prop for click handler
  onPlayPause, // New prop to trigger play/pause from outside
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

  // Pause function (can be called to stop playback)
  const pause = useCallback(() => {
    if (audioRef.current && isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, [isPlaying]);

  // Play function (can be called to start playback)
  const play = useCallback(async () => {
    if (!audioUrl || isLoading) return;

    try {
      if (audioRef.current) {
        await audioRef.current.play();
        setIsPlaying(true);
      }
    } catch (err) {
      console.error('Audio playback error:', err);
      setError('Failed to play audio: ' + err.message);
    }
  }, [audioUrl, isLoading]);

  // Play/pause functionality (can be called internally or externally)
  const togglePlayPause = useCallback(async () => {
    if (!audioUrl || isLoading) return;

    try {
      if (isPlaying) {
        pause();
      } else {
        await play();
      }
    } catch (err) {
      console.error('Audio playback error:', err);
      setError('Failed to play audio: ' + err.message);
    }
  }, [audioUrl, isLoading, isPlaying, pause, play]);

  // Expose play/pause/pause-only to parent via callback
  useEffect(() => {
    if (onPlayPause && isActive) {
      // Pass an object with both toggle and pause functions
      onPlayPause({ togglePlayPause, pause, play });
    }
  }, [onPlayPause, isActive, togglePlayPause, pause, play]);

  // Click to play/pause spectrogram
  const handleSpectrogramClick = useCallback(async () => {
    await togglePlayPause();
  }, [togglePlayPause]);

  // Parse annotation based on review mode
  const getAnnotationValue = () => {
    if (reviewMode === 'binary') {
      // Return the actual annotation value, or null for unlabeled
      return annotation || null;
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

  // Multi-class options for react-select
  const multiclassOptions = availableClasses.map(cls => ({
    value: cls,
    label: cls
  }));

  const multiclassValue = reviewMode === 'multiclass'
    ? annotationValue.map(cls => ({ value: cls, label: cls }))
    : [];

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
      // For unlabeled, pass null to represent NaN in dataframe
      onAnnotationChange(value === 'unlabeled' ? null : value);
    }
  }, [onAnnotationChange]);

  const handleMulticlassAnnotationChange = useCallback((selectedOptions) => {
    const classes = selectedOptions ? selectedOptions.map(opt => opt.value) : [];
    if (onAnnotationChange) {
      // Convert to string format for storage
      const annotationString = classes.length > 0 ? JSON.stringify(classes) : '[]';
      onAnnotationChange(annotationString);
    }
  }, [onAnnotationChange]);

  const handleAnnotationStatusChange = useCallback((value) => {
    if (onAnnotationChange) {
      // For multiclass mode, pass the current labels string, not the parsed array
      if (reviewMode === 'multiclass') {
        // Use the original labels string to preserve current selections
        onAnnotationChange(labels || '', value);
      } else {
        // For binary mode, pass the annotation value
        onAnnotationChange(annotationValue, value);
      }
    }
  }, [onAnnotationChange, annotationValue, labels, reviewMode]);

  // Local state for comment to prevent re-renders on every keystroke
  const [localComment, setLocalComment] = useState(comments || '');
  const commentTimeoutRef = useRef(null);

  // Update local comment when external comments change
  useEffect(() => {
    setLocalComment(comments || '');
  }, [comments]);

  const handleCommentChange = (event) => {
    const newComment = event.target.value;
    setLocalComment(newComment);

    // Debounce the callback to parent to prevent excessive re-renders
    if (commentTimeoutRef.current) {
      clearTimeout(commentTimeoutRef.current);
    }

    commentTimeoutRef.current = setTimeout(() => {
      if (onCommentChange) {
        onCommentChange(newComment);
      }
    }, 500); // Wait 500ms after user stops typing
  };

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (commentTimeoutRef.current) {
        clearTimeout(commentTimeoutRef.current);
      }
    };
  }, []);


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
            {binaryOptions.map(option => {
              // For unlabeled button, show as active only when explicitly unlabeled
              // For other buttons, show as active when annotation matches
              const isActive = option.value === 'unlabeled' 
                ? false  // Never show unlabeled as active - it just resets
                : annotationValue === option.value;
              
              return (
                <button
                  key={option.value}
                  className={`segment ${isActive ? 'active' : ''}`}
                  style={{
                    backgroundColor: isActive ? option.color : 'transparent',
                    borderColor: option.color,
                    color: isActive ? 'white' : option.color
                  }}
                  onClick={() => handleBinaryAnnotationChange(option.value)}
                  title={option.label}
                >
                  <span className="material-symbols-outlined">{option.symbol}</span>
                </button>
              );
            })}
          </div>
        </div>
      );
    } else {
      // Multi-class
      const customStyles = {
        control: (provided) => ({
          ...provided,
          minHeight: '38px',
          fontSize: '0.9rem'
        }),
        multiValue: (provided) => ({
          ...provided,
          backgroundColor: '#10b981',
          borderRadius: '4px',
        }),
        multiValueLabel: (provided) => ({
          ...provided,
          color: 'white',
          fontSize: '0.8rem'
        }),
        multiValueRemove: (provided) => ({
          ...provided,
          color: 'white',
          '&:hover': {
            backgroundColor: '#047857',
            color: 'white',
          }
        })
      };

      return (
        <div className="multiclass-annotation-control">
          <Select
            isMulti
            options={multiclassOptions}
            value={multiclassValue}
            onChange={handleMulticlassAnnotationChange}
            placeholder="Select classes..."
            styles={customStyles}
            className="multiclass-select"
            classNamePrefix="select"
            isClearable
            closeMenuOnSelect={false}
            hideSelectedOptions={false}
            blurInputOnSelect={false}
          />

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

  // Handler for card click - clicking anywhere activates the clip
  const handleCardClick = useCallback((event) => {
    // Only exclude actual interactive form controls
    const target = event.target;
    const isFormControl = target.tagName === 'BUTTON' ||
                         target.tagName === 'INPUT' ||
                         target.tagName === 'TEXTAREA' ||
                         target.closest('button') ||
                         target.closest('input') ||
                         target.closest('textarea') ||
                         target.closest('.react-select'); // Exclude react-select dropdowns

    if (!isFormControl && onCardClick) {
      onCardClick();
    }
  }, [onCardClick]);

  return (
    <div
      className={`annotation-card ${className} ${isActive ? 'active-clip' : ''}`}
      style={getCardStyle()}
      onClick={handleCardClick}
    >
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