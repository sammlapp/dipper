import { useState, useEffect, useRef, useCallback } from 'react';
import Select from 'react-select';

function FocusView({
  clipData,
  onAnnotationChange,
  onCommentChange,
  onNavigate,
  settings,
  reviewMode = 'binary',
  availableClasses = [],
  isLastClip = false,
  autoAdvance = true
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const audioRef = useRef(null);
  const hasAutoPlayedRef = useRef(false);

  const {
    file = '',
    start_time = 0,
    end_time = 0,
    annotation = '',
    labels = '',
    annotation_status = 'unreviewed',
    comments = '',
    audio_base64 = null,
    spectrogram_base64 = null
  } = clipData || {};

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

  // Create audio URL from base64 data
  useEffect(() => {
    if (audio_base64) {
      const dataUrl = `data:audio/wav;base64,${audio_base64}`;
      setAudioUrl(dataUrl);
    } else {
      setAudioUrl(null);
    }
  }, [audio_base64]);

  // Auto-play when clip changes (if enabled in settings)
  useEffect(() => {
    // Always pause any currently playing audio when clip changes
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      setCurrentTime(0);
    }

    // Reset auto-play flag for new clip
    hasAutoPlayedRef.current = false;

    if (audioUrl && settings?.focus_mode_autoplay) {
      setTimeout(() => {
        // Double-check that this is still the current audio and we haven't navigated away
        if (audioUrl && audioRef.current && !hasAutoPlayedRef.current) {
          hasAutoPlayedRef.current = true;
          playAudio();
        }
      }, 250); // Slightly longer delay to ensure previous audio is properly paused
    }
  }, [audioUrl, settings?.focus_mode_autoplay]);

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

  // Play/pause functions
  const playAudio = useCallback(async () => {
    if (audioRef.current && audioRef.current.readyState >= 2) { // HAVE_CURRENT_DATA
      try {
        // Reset position if at end
        if (audioRef.current.currentTime >= audioRef.current.duration) {
          audioRef.current.currentTime = 0;
        }
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (err) {
        console.error('Audio playback error:', err);
      }
    }
  }, []);

  const pauseAudio = useCallback(() => {
    if (audioRef.current && isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, [isPlaying]);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      pauseAudio();
    } else {
      playAudio();
    }
  }, [isPlaying, playAudio, pauseAudio]);

  // Audio seek function
  const handleSeek = useCallback((event) => {
    const newTime = parseFloat(event.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  }, []);

  // Restart audio function
  const handleRestart = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      if (isPlaying) {
        audioRef.current.play();
      }
    }
  }, [isPlaying]);

  // Format time helper
  const formatTime = useCallback((seconds) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Handle annotation changes with auto-advance
  const handleAnnotationChangeWithAdvance = useCallback((newAnnotation, newAnnotationStatus) => {
    if (onAnnotationChange) {
      onAnnotationChange(newAnnotation, newAnnotationStatus);
    }

    // Auto-advance to next clip if not the last clip
    if (autoAdvance && !isLastClip) {
      setTimeout(() => {
        onNavigate('next');
      }, 200); // Small delay for visual feedback
    }
  }, [onAnnotationChange, onNavigate, autoAdvance, isLastClip]);

  // Get current annotation value
  const getAnnotationValue = () => {
    if (reviewMode === 'binary') {
      // Return the actual annotation value, or null if empty/unlabeled
      return annotation || null;
    } else {
      const labelsToUse = labels || '';
      if (!labelsToUse || labelsToUse === '' || labelsToUse === 'nan') {
        return [];
      }
      try {
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

  // Binary annotation options
  const binaryOptions = [
    { value: 'yes', label: 'Yes', key: 'a', color: 'rgb(145, 180, 135)' },
    { value: 'no', label: 'No', key: 's', color: 'rgb(207, 122, 107)' },
    { value: 'uncertain', label: 'Uncertain', key: 'd', color: 'rgb(237, 223, 177)' },
    { value: 'unlabeled', label: 'Unlabeled', key: 'f', color: 'rgb(223, 223, 223)' }
  ];

  // Multi-class annotation options
  const multiclassOptions = availableClasses.map(cls => ({
    value: cls,
    label: cls
  }));

  const multiclassValue = reviewMode === 'multiclass'
    ? annotationValue.map(cls => ({ value: cls, label: cls }))
    : [];

  // Annotation status options for multi-class mode
  const annotationStatusOptions = [
    { value: 'complete', label: 'Complete', symbol: 'check_circle', color: 'rgb(145, 180, 135)' },
    { value: 'uncertain', label: 'Uncertain', symbol: 'help', color: 'rgb(237, 223, 177)' },
    { value: 'unreviewed', label: 'Unreviewed', symbol: 'radio_button_unchecked', color: 'rgb(223, 223, 223)' }
  ];

  // Multi-class annotation change handler
  const handleMulticlassAnnotationChange = useCallback((selectedOptions) => {
    const classes = selectedOptions ? selectedOptions.map(opt => opt.value) : [];
    if (onAnnotationChange) {
      // Convert to string format for storage
      const annotationString = classes.length > 0 ? JSON.stringify(classes) : '[]';
      // Pass both the new labels and preserve the current annotation status
      onAnnotationChange(annotationString, annotation_status || 'unreviewed');
    }
  }, [onAnnotationChange, annotation_status]);

  // Annotation status change handler
  const handleAnnotationStatusChange = useCallback((value) => {
    if (onAnnotationChange) {
      // For multiclass mode, pass the current labels string and the new annotation status
      onAnnotationChange(labels || '', value);
    }
  }, [onAnnotationChange, labels]);

  // Keyboard event handler
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Check if user is typing in a text field
      const isTyping = (
        event.target.tagName === "TEXTAREA" ||
        (event.target.tagName === "INPUT" && event.target.type === "text") ||
        (event.target.tagName === "INPUT" && event.target.type === "number")
      );

      // Don't handle shortcuts if user is typing
      if (isTyping) return;

      // Handle Escape key for focus/grid toggle - let it bubble up to parent
      if (event.key === 'Escape') {
        // Don't prevent default - let parent handle this
        return;
      }

      // Prevent default behavior for our shortcuts
      if (['a', 's', 'd', 'f', 'j', 'k', ' '].includes(event.key.toLowerCase())) {
        event.preventDefault();
      }

      switch (event.key.toLowerCase()) {
        case 'a':
          if (reviewMode === 'binary') {
            handleAnnotationChangeWithAdvance('yes');
          }
          break;
        case 's':
          if (reviewMode === 'binary') {
            handleAnnotationChangeWithAdvance('no');
          }
          break;
        case 'd':
          if (reviewMode === 'binary') {
            handleAnnotationChangeWithAdvance('uncertain');
          }
          break;
        case 'f':
          if (reviewMode === 'binary') {
            handleAnnotationChangeWithAdvance(null);
          }
          break;
        case 'j':
          onNavigate('previous');
          break;
        case 'k':
          onNavigate('next');
          break;
        case ' ':
          togglePlayPause();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [reviewMode, handleAnnotationChangeWithAdvance, onNavigate, togglePlayPause]);

  // Handle spectrogram click
  const handleSpectrogramClick = useCallback(() => {
    togglePlayPause();
  }, [togglePlayPause]);

  return (
    <div className="focus-view">
      <div className="focus-view-inner">
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

        {/* Large spectrogram display */}
        <div className={`focus-spectrogram-container ${settings?.focus_size ? `size-${settings.focus_size}` : 'size-medium'}`}>
          <div
            className="focus-spectrogram"
            onClick={handleSpectrogramClick}
            title={audioUrl ? (isPlaying ? 'Click to pause audio' : 'Click to play audio') : 'Audio not available'}
          >
            {spectrogram_base64 ? (
              <img
                src={`data:image/png;base64,${spectrogram_base64}`}
                alt="Spectrogram"
                className="focus-spectrogram-image"
              />
            ) : (
              <div className="focus-spectrogram-placeholder">
                <img src="/icon.svg" alt="Loading" className="placeholder-icon app-icon" />
                <div className="placeholder-text">Loading spectrogram...</div>
              </div>
            )}

            {/* Progress bar overlay */}
            {duration > 0 && (
              <div className="focus-progress-bar">
                <div
                  className="focus-progress-fill"
                  style={{ width: `${(currentTime / duration) * 100}%` }}
                />
              </div>
            )}

            {/* Play/pause overlay */}
            {/* <div className="focus-play-overlay">
              <div className={`focus-play-button ${isPlaying ? 'playing' : 'paused'}`}>
                <span className="material-symbols-outlined">
                  {isPlaying ? 'pause' : 'play_arrow'}
                </span>
              </div>
            </div> */}
          </div>
        </div>

        {/* Compact controls beneath spectrogram */}
        <div className="focus-controls-compact">

          {/* Binary annotation controls with comments on the right */}
          {reviewMode === 'binary' && (
            <div className="focus-annotation-controls">
              <div className="focus-binary-segmented-control">
                {binaryOptions.map((option, index) => (
                  <button
                    key={option.value}
                    className={`segmented-control-option ${(option.value === 'unlabeled' && annotationValue === null) ||
                      (option.value !== 'unlabeled' && annotationValue === option.value) ? 'active' : ''
                      } ${index === 0 ? 'first' : index === binaryOptions.length - 1 ? 'last' : 'middle'
                      }`}
                    style={{
                      backgroundColor: ((option.value === 'unlabeled' && annotationValue === null) ||
                        (option.value !== 'unlabeled' && annotationValue === option.value)) ? option.color : 'transparent',
                      borderColor: option.color,
                      color: ((option.value === 'unlabeled' && annotationValue === null) ||
                        (option.value !== 'unlabeled' && annotationValue === option.value)) ? 'white' : option.color
                    }}
                    onClick={() => handleAnnotationChangeWithAdvance(option.value === 'unlabeled' ? '' : option.value)}
                  >
                    <span className="segmented-key">({option.key})</span>
                    {option.value === 'unlabeled' ? (
                      <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>restart_alt</span>
                    ) : (
                      <span className="segmented-label">{option.label}</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="focus-comments-right">
                <textarea
                  placeholder="Comments..."
                  value={localComment}
                  onChange={handleCommentChange}
                  className="focus-comment-textarea-right"
                  rows={2}
                />
              </div>
            </div>
          )}
          {/* Audio controls row */}
          {audioUrl && (
            <div className="focus-audio-row">
              <div className="audio-controls-compact">
                <button
                  onClick={togglePlayPause}
                  className="audio-btn"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  <span className="material-symbols-outlined">
                    {isPlaying ? 'pause' : 'play_arrow'}
                  </span>
                </button>
                <button
                  onClick={handleRestart}
                  className="audio-btn"
                  title="Restart"
                >
                  <span className="material-symbols-outlined">restart_alt</span>
                </button>
              </div>
              <div className="audio-timeline-compact">
                <input
                  type="range"
                  min="0"
                  max={duration || 0}
                  value={currentTime}
                  onChange={handleSeek}
                  className="audio-scrubber-compact"
                  step="0.1"
                />
              </div>
              <div className="audio-time-compact">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>
          )}

          {/* Multi-class annotation controls with comments on the right */}
          {reviewMode === 'multiclass' && (
            <div className="focus-annotation-controls">
              <div className="focus-multiclass-controls">
                <div className="focus-multiclass-select">
                  <Select
                    isMulti
                    options={multiclassOptions}
                    value={multiclassValue}
                    onChange={handleMulticlassAnnotationChange}
                    placeholder="Select classes..."
                    styles={{
                      control: (provided) => ({
                        ...provided,
                        minHeight: '44px',
                        fontSize: '0.9rem',
                        backgroundColor: 'var(--white)',
                        borderColor: 'var(--border)',
                        '&:hover': {
                          borderColor: 'var(--dark-accent)'
                        }
                      }),
                      multiValue: (provided) => ({
                        ...provided,
                        backgroundColor: 'var(--dark-accent)',
                        borderRadius: '4px',
                      }),
                      multiValueLabel: (provided) => ({
                        ...provided,
                        color: 'white',
                        fontSize: '0.85rem',
                        fontWeight: '500'
                      }),
                      multiValueRemove: (provided) => ({
                        ...provided,
                        color: 'white',
                        '&:hover': {
                          backgroundColor: 'var(--dark)',
                          color: 'white',
                        }
                      }),
                      placeholder: (provided) => ({
                        ...provided,
                        color: 'var(--medium-gray)',
                        fontSize: '0.9rem'
                      })
                    }}
                    className="focus-multiclass-select"
                    classNamePrefix="select"
                    isClearable
                    closeMenuOnSelect={false}
                    hideSelectedOptions={false}
                    blurInputOnSelect={false}
                  />
                </div>

                {/* Annotation status control */}
                <div className="focus-annotation-status-control">
                  <label className="focus-status-label">Review Status:</label>
                  <div className="focus-status-buttons">
                    {annotationStatusOptions.map(option => (
                      <button
                        key={option.value}
                        className={`focus-status-button ${annotation_status === option.value ? 'active' : ''}`}
                        style={{
                          backgroundColor: annotation_status === option.value ? option.color : 'transparent',
                          borderColor: option.color,
                          color: annotation_status === option.value ? 'white' : option.color
                        }}
                        onClick={() => handleAnnotationStatusChange(option.value)}
                        title={option.label}
                      >
                        <span className="material-symbols-outlined">{option.symbol}</span>
                        <span className="status-label">{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="focus-navigation-compact">
                <button
                  className="nav-btn"
                  onClick={() => onNavigate('previous')}
                  title="Previous clip (j)"
                >
                  <span className="material-symbols-outlined">skip_previous</span>j
                </button>
                <button
                  className="nav-btn"
                  onClick={() => onNavigate('next')}
                  title="Next clip (k)"
                >
                  k<span className="material-symbols-outlined">skip_next</span>
                </button>
              </div>
              <div className="focus-comments-right">
                <textarea
                  placeholder="Comments..."
                  value={localComment}
                  onChange={handleCommentChange}
                  className="focus-comment-textarea-right"
                  rows={2}
                />
              </div>

            </div>

          )}



          {/* File info row */}
          <div className="focus-info-row">
            <div className="focus-file-name">{file ? file.split('/').pop() : 'Unknown file'}</div>
            <div className="focus-time-info">
              {start_time !== undefined && (
                <span>{start_time.toFixed(1)}s</span>
              )}
              {end_time && end_time !== start_time && (
                <span> - {end_time.toFixed(1)}s</span>
              )}
            </div>
          </div>
        </div>

        {/* Keyboard shortcuts help */}
        <div className="focus-shortcuts-help">
          <small>
            <strong>Shortcuts:</strong>
            {reviewMode === 'binary' && ' a=Yes, s=No, d=Uncertain, f=Unlabeled |'}
            j=Previous, k=Next | Space=Play/Pause
          </small>
        </div>
      </div>
    </div>
  );
}

export default FocusView;