import { useState, useEffect, useRef, useCallback } from 'react';
import { basename } from 'pathe';
import Select from 'react-select';
import BoundingBoxOverlay from './BoundingBoxOverlay';
import SpectrogramContextMenu from './SpectrogramContextMenu';

function FocusView({
  clipData,
  onAnnotationChange,
  onCommentChange,
  onBoundingBoxChange,
  onNavigate,
  onContextPage,
  viewOffset = 0,
  settings,
  annotationColumn = 'annotation',
  reviewMode = 'binary',
  availableClasses = [],
  isLastClip = false,
  autoAdvance = true,
  audioRootPath = '',
  isDesktop = false,
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [hoveredZone, setHoveredZone] = useState(null); // 'left' | 'right' | null
  const audioRef = useRef(null);
  const hasAutoPlayedRef = useRef(false);
  const spectrogramRef = useRef(null);

  const {
    file = '',
    start_time = 0,
    end_time = 0,
    labels = '',
    annotation_status = 'unreviewed',
    comments = '',
    audio_base64 = null,
    spectrogram_base64 = null,
    frequency_range = null,
    time_range = null,
    clip_start_time = null,
    clip_end_time = null,
  } = clipData || {};

  // Context window: start_time/end_time are the loaded (extended) window.
  // clip_start_time/clip_end_time are the original annotation clip bounds.
  const hasContext = clip_start_time != null && clip_end_time != null;
  const extDuration = end_time > start_time ? end_time - start_time : 0;
  // Clip is visible only when its time range overlaps the current loaded window
  const clipVisibleInWindow = hasContext && clip_start_time < end_time && clip_end_time > start_time;
  const highlightLeft = clipVisibleInWindow && extDuration > 0 ? (clip_start_time - start_time) / extDuration : 0;
  const highlightWidth = clipVisibleInWindow && extDuration > 0 ? (clip_end_time - clip_start_time) / extDuration : 1;
  // Offset into the loaded WAV where the annotation clip begins (for cursor positioning)
  const clipOffsetSeconds = hasContext ? clip_start_time - start_time : 0;

  // Read annotation and bbox from dynamic column keys based on annotationColumn prop
  const annotation = (clipData && clipData[annotationColumn]) ?? '';
  const bbox_start_time = (clipData && clipData[`${annotationColumn}_start_time`]) ?? null;
  const bbox_end_time = (clipData && clipData[`${annotationColumn}_end_time`]) ?? null;
  const bbox_low_freq = (clipData && clipData[`${annotationColumn}_low_freq`]) ?? null;
  const bbox_high_freq = (clipData && clipData[`${annotationColumn}_high_freq`]) ?? null;

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
      // Position cursor at start of annotation clip within the context window
      audioRef.current.currentTime = clipOffsetSeconds;
      setIsPlaying(false);
      setCurrentTime(clipOffsetSeconds);
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
      setDuration(audioRef.current.duration || 0);
      setCurrentTime(audioRef.current.currentTime || 0);
    }
  }, []);

  const handleAudioPlay = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handleAudioPause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleAudioEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  // Play/pause functions
  const playAudio = useCallback(async () => {
    if (audioRef.current) {
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
    if (audioRef.current && !audioRef.current.paused) {
      pauseAudio();
    } else {
      playAudio();
    }
  }, [playAudio, pauseAudio]);

  // Audio seek function
  const handleSeek = useCallback((event) => {
    const newTime = parseFloat(event.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  }, []);

  // Restart: re-center page if paged away, then seek playhead to clip start
  const handleRestart = useCallback(() => {
    if (onContextPage && viewOffset !== 0) {
      onContextPage(null); // re-center; new audio will load and autoplay/position handled by load effect
      return;
    }
    if (audioRef.current) {
      audioRef.current.currentTime = clipOffsetSeconds;
      setCurrentTime(clipOffsetSeconds);
      if (isPlaying) {
        audioRef.current.play();
      }
    }
  }, [onContextPage, viewOffset, clipOffsetSeconds, isPlaying]);

  // Format time helper
  const formatTime = useCallback((seconds) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const formatAxisTime = useCallback((seconds) => {
    if (seconds == null || Number.isNaN(seconds)) return '0:00.00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds - mins * 60;
    return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
  }, []);

  const axisTickCount = 5;
  const displayTimeRange = (
    Number.isFinite(start_time) &&
    Number.isFinite(end_time) &&
    end_time > start_time
  )
    ? [start_time, end_time]
    : time_range;

  const timeTicks = (displayTimeRange && axisTickCount > 1)
    ? Array.from({ length: axisTickCount }, (_, i) => {
      const t = displayTimeRange[0] + (i / (axisTickCount - 1)) * (displayTimeRange[1] - displayTimeRange[0]);
      return { value: t, label: formatAxisTime(t), pct: (i / (axisTickCount - 1)) * 100 };
    })
    : [];
  const freqTicks = (frequency_range && axisTickCount > 1)
    ? Array.from({ length: axisTickCount }, (_, i) => {
      const f = frequency_range[0] + (i / (axisTickCount - 1)) * (frequency_range[1] - frequency_range[0]);
      return {
        value: f,
        label: `${(f / 1000).toFixed(1)} kHz`,
        // Higher frequencies should be visually toward top.
        pctFromTop: 100 - ((i / (axisTickCount - 1)) * 100)
      };
    })
    : [];

  const handleDownloadCurrentClip = useCallback(() => {
    if (!audio_base64) {
      console.error('FocusView download failed: no clip audio data available');
      return;
    }

    try {
      const link = document.createElement('a');
      link.href = `data:audio/wav;base64,${audio_base64}`;

      const start = Number.isFinite(hasContext ? clip_start_time : start_time) ? (hasContext ? clip_start_time : start_time).toFixed(2) : 'start';
      const end = Number.isFinite(hasContext ? clip_end_time : end_time) ? (hasContext ? clip_end_time : end_time).toFixed(2) : 'end';
      const stem = file ? basename(file).replace(/\.[^/.]+$/, '') : 'clip';
      link.download = `${stem}_${start}s_${end}s.wav`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('FocusView download failed:', err);
    }
  }, [audio_base64, file, start_time, end_time]);

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
    { value: 'yes', label: 'Yes', key: 'a', color: 'var(--yes)' },
    { value: 'no', label: 'No', key: 's', color: 'var(--no)' },
    { value: 'uncertain', label: 'Uncertain', key: 'd', color: 'var(--uncertain)' },
    { value: 'unlabeled', label: 'Unlabeled', key: 'f', color: 'var(--unlabeled)' }
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
    { value: 'complete', label: 'Complete', symbol: 'check_circle', color: 'var(--complete)' },
    { value: 'uncertain', label: 'Uncertain', symbol: 'help', color: 'var(--uncertain)' },
    { value: 'unreviewed', label: 'Unreviewed', symbol: 'radio_button_unchecked', color: 'var(--unreviewed)' }
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
          // make sure not cmd+shift+k, which has special function
          // in CGL mode (move to next incomplete clip)
          if (!(event.metaKey && event.shiftKey)) {
            onNavigate('next');
          }
          // onNavigate('next');
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

  const PAGE_ZONE_FRACTION = 0.10; // left/right 10% triggers paging

  const getClickZone = useCallback((e) => {
    if (!spectrogramRef.current) return 'seek';
    const rect = spectrogramRef.current.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    if (fraction < PAGE_ZONE_FRACTION) return 'left';
    if (fraction > 1 - PAGE_ZONE_FRACTION) return 'right';
    return 'seek';
  }, []);

  const handleSpectrogramMouseMove = useCallback((e) => {
    if (!onContextPage) return;
    setHoveredZone(getClickZone(e));
  }, [getClickZone, onContextPage]);

  const handleSpectrogramMouseLeave = useCallback(() => {
    setHoveredZone(null);
  }, []);

  // Single click — page left/right in edge zones, seek in centre
  const handleSpectrogramClick = useCallback((e) => {
    const zone = getClickZone(e);
    if (zone === 'left' && onContextPage) {
      onContextPage(-1);
      return;
    }
    if (zone === 'right' && onContextPage) {
      onContextPage(1);
      return;
    }
    // Centre zone: seek
    if (!audioRef.current || !spectrogramRef.current) return;
    const rect = spectrogramRef.current.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    const seekTime = fraction * (audioRef.current.duration || 0);
    audioRef.current.currentTime = seekTime;
    setCurrentTime(seekTime);
  }, [getClickZone, onContextPage]);

  // Double click — re-center on clip (recenter paging) or toggle play/pause if already centred
  const handleSpectrogramDoubleClick = useCallback((e) => {
    e.preventDefault();
    if (onContextPage && viewOffset !== 0) {
      onContextPage(null);
    } else {
      togglePlayPause();
    }
  }, [onContextPage, viewOffset, togglePlayPause]);

  const [contextMenu, setContextMenu] = useState(null);
  const handleSpectrogramContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    <>
      <div className="focus-view">
        <div className="focus-view-inner">
          {/* Hidden audio element */}
          {audioUrl && (
            <audio
              ref={audioRef}
              src={audioUrl}
              onTimeUpdate={handleAudioTimeUpdate}
              onLoadedMetadata={handleAudioLoadedMetadata}
              onPlay={handleAudioPlay}
              onPause={handleAudioPause}
              onEnded={handleAudioEnded}
              preload="metadata"
            />
          )}

          {/* Large spectrogram display */}
          <div className={`focus-spectrogram-container ${settings?.focus_size ? `size-${settings.focus_size}` : 'size-medium'}`}>
            <div className="focus-spectrogram-grid">
              <div className="focus-axis-y-outside">
                {spectrogram_base64 && freqTicks.map((tick, idx) => (
                  <div
                    key={`freq-outside-${idx}`}
                    className="focus-axis-outside-tick-wrap focus-axis-outside-tick-wrap-y"
                    style={{ top: `${tick.pctFromTop}%` }}
                  >
                    <div className="focus-axis-outside-label focus-axis-outside-label-y">{tick.label}</div>
                    <div className="focus-axis-outside-tick focus-axis-outside-tick-y" />
                  </div>
                ))}
              </div>

              <div
                ref={spectrogramRef}
                className="focus-spectrogram"
                onClick={handleSpectrogramClick}
                onDoubleClick={handleSpectrogramDoubleClick}
                onMouseMove={handleSpectrogramMouseMove}
                onMouseLeave={handleSpectrogramMouseLeave}
                onContextMenu={handleSpectrogramContextMenu}
                title={audioUrl ? 'Click edges to page · Click centre to seek · Double-click to play/pause' : 'Audio not available'}
                style={{ position: 'relative', cursor: hoveredZone === 'left' || hoveredZone === 'right' ? 'pointer' : (audioUrl ? 'crosshair' : 'default') }}
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

                {/* Left/right page zones — hover reveals arrow overlay */}
                {onContextPage && (
                  <>
                    <div className={`focus-page-zone focus-page-zone-left ${hoveredZone === 'left' ? 'hovered' : ''}`}>
                      <span className="material-symbols-outlined focus-page-zone-arrow">chevron_left</span>
                    </div>
                    <div className={`focus-page-zone focus-page-zone-right ${hoveredZone === 'right' ? 'hovered' : ''}`}>
                      <span className="material-symbols-outlined focus-page-zone-arrow">chevron_right</span>
                    </div>
                  </>
                )}

                {/* Clip region highlight — only shown when the annotation clip is within the current view window */}
                {clipVisibleInWindow && spectrogram_base64 && (
                  <div
                    className="focus-clip-highlight"
                    style={{
                      left: `${highlightLeft * 100}%`,
                      width: `${highlightWidth * 100}%`,
                    }}
                  />
                )}

                {/* Bounding box overlay for drawing annotations */}
                {onBoundingBoxChange && time_range && frequency_range && (
                  <BoundingBoxOverlay
                    boundingBox={
                      bbox_start_time != null && bbox_end_time != null &&
                        bbox_low_freq != null && bbox_high_freq != null
                        ? { start_time: bbox_start_time, end_time: bbox_end_time, low_freq: bbox_low_freq, high_freq: bbox_high_freq }
                        : null
                    }
                    onBoundingBoxChange={onBoundingBoxChange}
                    timeRange={time_range}
                    frequencyRange={frequency_range}
                  />
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
              </div>

              <div className="focus-axis-x-outside">
                {spectrogram_base64 && timeTicks.map((tick, idx) => (
                  <div
                    key={`time-outside-${idx}`}
                    className="focus-axis-outside-tick-wrap focus-axis-outside-tick-wrap-x"
                    style={{ left: `${tick.pct}%` }}
                  >
                    <div className="focus-axis-outside-tick focus-axis-outside-tick-x" />
                    <div className="focus-axis-outside-label focus-axis-outside-label-x">{tick.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Compact controls beneath spectrogram */}
          <div className="focus-controls-compact">

            {/* Binary annotation controls with audio buttons on the left */}
            {reviewMode === 'binary' && (
              <div className="focus-annotation-controls">
                {audioUrl && (
                  <div className="audio-controls-compact">
                    <button
                      onClick={togglePlayPause}
                      className="audio-btn"
                      title={isPlaying ? 'Pause (space)' : 'Play (space)'}
                    >
                      <span className="material-symbols-outlined">
                        {isPlaying ? 'pause' : 'play_arrow'}
                      </span>
                    </button>
                    <button
                      onClick={handleRestart}
                      className="audio-btn"
                      title={viewOffset !== 0 ? 'Re-center on clip' : 'Restart to clip start'}
                    >
                      <span className="material-symbols-outlined">restart_alt</span>
                    </button>
                    <button
                      onClick={handleDownloadCurrentClip}
                      className="audio-btn"
                      title="Download current clip audio"
                    >
                      <span className="material-symbols-outlined">download</span>
                    </button>
                  </div>
                )}
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
                        border: "none",
                        fontSize: '1rem',
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

            {/* Multi-class annotation controls with audio buttons on the left */}
            {reviewMode === 'multiclass' && (
              <div className="focus-annotation-controls">
                {audioUrl && (
                  <div className="audio-controls-compact">
                    <button
                      onClick={togglePlayPause}
                      className="audio-btn"
                      title={isPlaying ? 'Pause (space)' : 'Play (space)'}
                    >
                      <span className="material-symbols-outlined">
                        {isPlaying ? 'pause' : 'play_arrow'}
                      </span>
                    </button>
                    <button
                      onClick={handleRestart}
                      className="audio-btn"
                      title={viewOffset !== 0 ? 'Re-center on clip' : 'Restart to clip start'}
                    >
                      <span className="material-symbols-outlined">restart_alt</span>
                    </button>
                    <button
                      onClick={handleDownloadCurrentClip}
                      className="audio-btn"
                      title="Download current clip audio"
                    >
                      <span className="material-symbols-outlined">download</span>
                    </button>
                  </div>
                )}
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



            {/* File info row — always shows original annotation clip times */}
            <div className="focus-info-row">
              <div className="focus-file-name">{file ? basename(file) : 'Unknown file'}</div>
              <div className="focus-time-info">
                {(hasContext ? clip_start_time : start_time) !== undefined && (
                  <span>{(hasContext ? clip_start_time : start_time).toFixed(1)}s</span>
                )}
                {(hasContext ? clip_end_time : end_time) && (hasContext ? clip_end_time !== clip_start_time : end_time !== start_time) && (
                  <span> - {(hasContext ? clip_end_time : end_time).toFixed(1)}s</span>
                )}
              </div>
            </div>
          </div>


        </div>
      </div>

      {contextMenu && (
        <SpectrogramContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          filePath={file}
          audioRootPath={audioRootPath}
          audioBase64={audio_base64}
          spectrogramBase64={spectrogram_base64}
          clipLabel={`${file ? file.replace(/.*[\\/]/, '').replace(/\.[^.]+$/, '') : 'clip'}_${start_time}-${end_time}`}
          isDesktop={isDesktop}
        />
      )}
    </>
  );
}

export default FocusView;