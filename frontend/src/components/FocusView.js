import { useState, useEffect, useRef, useCallback } from 'react';
import { basename } from 'pathe';
import Select from 'react-select';
import BboxOverlay from './BboxOverlay';

function FocusView({
  clipData,
  onAnnotationChange,
  onCommentChange,
  onBboxChange,
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
  const pointerInteractionRef = useRef({
    active: false,
    moved: false,
    mode: null, // 'draw' | 'edit'
    startClientX: 0,
    startClientY: 0,
    startCoords: null,
    handle: null
  });

  const {
    file = '',
    start_time = 0,
    end_time = 0,
    annotation = '',
    labels = '',
    annotation_status = 'unreviewed',
    comments = '',
    audio_base64 = null,
    spectrogram_base64 = null,
    // Bounding box fields (separate columns for CSV safety)
    bbox_start_t = null,
    bbox_end_t = null,
    bbox_low_f = null,
    bbox_high_f = null,
    // Spectrogram metadata from backend
    frequency_range = null,
    time_range = null,
    original_time_range = null,
    audio_padding = 0,
  } = clipData || {};

  // Local state for comment to prevent re-renders on every keystroke
  const [localComment, setLocalComment] = useState(comments || '');
  const commentTimeoutRef = useRef(null);

  // Bounding box state
  const [isDrawingBbox, setIsDrawingBbox] = useState(false);
  const [drawStartPoint, setDrawStartPoint] = useState(null);
  const [currentBbox, setCurrentBbox] = useState(null);
  const [editingHandle, setEditingHandle] = useState(null);
  const [hoverHandle, setHoverHandle] = useState(null);
  const [isPointerInteracting, setIsPointerInteracting] = useState(false);
  const spectrogramRef = useRef(null);
  const spectrogramContainerRef = useRef(null);
  const [spectrogramDimsState, setSpectrogramDimsState] = useState(null);

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

  // Parse existing bbox from separate columns when clip data changes
  useEffect(() => {
    if (bbox_start_t != null && bbox_end_t != null &&
        bbox_low_f != null && bbox_high_f != null &&
        !isNaN(parseFloat(bbox_start_t)) && !isNaN(parseFloat(bbox_end_t)) &&
        !isNaN(parseFloat(bbox_low_f)) && !isNaN(parseFloat(bbox_high_f))) {
      setCurrentBbox({
        start_time: parseFloat(bbox_start_t),
        end_time: parseFloat(bbox_end_t),
        low_freq: parseFloat(bbox_low_f),
        high_freq: parseFloat(bbox_high_f)
      });
    } else {
      setCurrentBbox(null);
    }
  }, [bbox_start_t, bbox_end_t, bbox_low_f, bbox_high_f]);

  // Coordinate transformation: get spectrogram dimensions accounting for object-fit
  const getSpectrogramDimensions = useCallback(() => {
    if (!spectrogramRef.current) return null;
    const img = spectrogramRef.current;
    const rect = img.getBoundingClientRect();

    // Focus spectrogram uses full fill in the display area.
    const renderWidth = rect.width;
    const renderHeight = rect.height;
    const offsetX = 0;
    const offsetY = 0;
    return { renderWidth, renderHeight, offsetX, offsetY, rect };
  }, []);

  // Convert pixel coordinates to time/frequency
  const pixelToCoordinates = useCallback((clientX, clientY) => {
    const dims = getSpectrogramDimensions();
    if (!dims || !time_range || !frequency_range) return null;

    const relX = clientX - dims.rect.left - dims.offsetX;
    const relY = clientY - dims.rect.top - dims.offsetY;

    // Normalize to 0-1 range, clamped to spectrogram bounds
    const normX = Math.max(0, Math.min(1, relX / dims.renderWidth));
    const normY = Math.max(0, Math.min(1, relY / dims.renderHeight));

    // Map to time/frequency (Y is inverted: top=high freq, bottom=low freq)
    const time = time_range[0] + normX * (time_range[1] - time_range[0]);
    const freq = frequency_range[1] - normY * (frequency_range[1] - frequency_range[0]);

    return { time, freq };
  }, [getSpectrogramDimensions, time_range, frequency_range]);

  // Convert time/frequency to pixel coordinates
  const coordinatesToPixel = useCallback((time, freq) => {
    const dims = getSpectrogramDimensions();
    if (!dims || !time_range || !frequency_range) return null;

    const normX = (time - time_range[0]) / (time_range[1] - time_range[0]);
    const normY = (frequency_range[1] - freq) / (frequency_range[1] - frequency_range[0]);

    return {
      x: dims.offsetX + normX * dims.renderWidth,
      y: dims.offsetY + normY * dims.renderHeight
    };
  }, [getSpectrogramDimensions, time_range, frequency_range]);

  const updateSpectrogramDimensions = useCallback(() => {
    const dims = getSpectrogramDimensions();
    setSpectrogramDimsState(dims);
  }, [getSpectrogramDimensions]);

  // Keep rendered dimensions in sync for axis/tick overlays
  useEffect(() => {
    updateSpectrogramDimensions();

    const handleWindowResize = () => {
      updateSpectrogramDimensions();
    };

    window.addEventListener('resize', handleWindowResize);

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined' && spectrogramContainerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        updateSpectrogramDimensions();
      });
      resizeObserver.observe(spectrogramContainerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleWindowResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [updateSpectrogramDimensions, spectrogram_base64, settings?.focus_size]);

  // Check if a point is near a bbox handle (for editing)
  const getHandleAtPoint = useCallback((clientX, clientY) => {
    if (!currentBbox) return null;

    const dims = getSpectrogramDimensions();
    if (!dims) return null;

    const topLeft = coordinatesToPixel(currentBbox.start_time, currentBbox.high_freq);
    const bottomRight = coordinatesToPixel(currentBbox.end_time, currentBbox.low_freq);
    if (!topLeft || !bottomRight) return null;

    const relX = clientX - dims.rect.left;
    const relY = clientY - dims.rect.top;
    const handleSize = 12; // Hit area for handles

    const handles = [
      { name: 'nw', x: topLeft.x, y: topLeft.y },
      { name: 'ne', x: bottomRight.x, y: topLeft.y },
      { name: 'sw', x: topLeft.x, y: bottomRight.y },
      { name: 'se', x: bottomRight.x, y: bottomRight.y },
      { name: 'n', x: (topLeft.x + bottomRight.x) / 2, y: topLeft.y },
      { name: 's', x: (topLeft.x + bottomRight.x) / 2, y: bottomRight.y },
      { name: 'w', x: topLeft.x, y: (topLeft.y + bottomRight.y) / 2 },
      { name: 'e', x: bottomRight.x, y: (topLeft.y + bottomRight.y) / 2 }
    ];

    for (const handle of handles) {
      if (Math.abs(relX - handle.x) < handleSize && Math.abs(relY - handle.y) < handleSize) {
        return handle.name;
      }
    }
    return null;
  }, [currentBbox, getSpectrogramDimensions, coordinatesToPixel]);

  // Update bbox when dragging a handle
  const updateBboxFromHandle = useCallback((handle, coords) => {
    if (!currentBbox) return;

    const newBbox = { ...currentBbox };

    switch (handle) {
      case 'nw':
        newBbox.start_time = coords.time;
        newBbox.high_freq = coords.freq;
        break;
      case 'ne':
        newBbox.end_time = coords.time;
        newBbox.high_freq = coords.freq;
        break;
      case 'sw':
        newBbox.start_time = coords.time;
        newBbox.low_freq = coords.freq;
        break;
      case 'se':
        newBbox.end_time = coords.time;
        newBbox.low_freq = coords.freq;
        break;
      case 'n':
        newBbox.high_freq = coords.freq;
        break;
      case 's':
        newBbox.low_freq = coords.freq;
        break;
      case 'w':
        newBbox.start_time = coords.time;
        break;
      case 'e':
        newBbox.end_time = coords.time;
        break;
      default:
        break;
    }

    // Ensure start < end and low < high
    if (newBbox.start_time > newBbox.end_time) {
      [newBbox.start_time, newBbox.end_time] = [newBbox.end_time, newBbox.start_time];
    }
    if (newBbox.low_freq > newBbox.high_freq) {
      [newBbox.low_freq, newBbox.high_freq] = [newBbox.high_freq, newBbox.low_freq];
    }

    setCurrentBbox(newBbox);
  }, [currentBbox]);

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
          // Inline play logic here to avoid temporal-dead-zone issues with callback order
          (async () => {
            try {
              if (audioRef.current.duration > 0 && audioRef.current.currentTime >= audioRef.current.duration - 1e-3) {
                audioRef.current.currentTime = 0;
                setCurrentTime(0);
              }
              await audioRef.current.play();
              setIsPlaying(true);
            } catch (err) {
              console.error('Audio playback error:', err);
            }
          })();
        }
      }, 250); // Slightly longer delay to ensure previous audio is properly paused
    }
  }, [audioUrl, settings?.focus_mode_autoplay]);

  // Audio event handlers
  const handleAudioTimeUpdate = useCallback(() => {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime || 0);
  }, []);

  const handleAudioLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      const t = audioRef.current.currentTime || 0;
      setCurrentTime(t);
    }
  }, []);

  const handleAudioEnded = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const handleAudioPlay = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handleAudioPause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  // Play/pause functions
  const playAudio = useCallback(async () => {
    if (audioRef.current) {
      try {
        // Reset position if at end
        if (audioRef.current.duration > 0 && audioRef.current.currentTime >= audioRef.current.duration - 1e-3) {
          audioRef.current.currentTime = 0;
          setCurrentTime(0);
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

  // Mouse handlers for bbox drawing (defined after togglePlayPause)
  const seekToMousePosition = useCallback((clientX, clientY) => {
    if (!audioRef.current) {
      console.error('FocusView seek failed: audio element is not available');
      return;
    }
    if (!(duration > 0)) {
      console.error('FocusView seek failed: audio duration is not ready');
      return;
    }
    if (!time_range) {
      console.error('FocusView seek failed: missing spectrogram time_range metadata');
      return;
    }

    const coords = pixelToCoordinates(clientX, clientY);
    if (!coords) {
      console.error('FocusView seek failed: unable to map pixel to spectrogram coordinates');
      return;
    }

    const targetAudioTime = Math.max(0, Math.min(duration, coords.time - time_range[0]));
    audioRef.current.currentTime = targetAudioTime;
    setCurrentTime(targetAudioTime);
  }, [duration, time_range, pixelToCoordinates]);

  const handleSpectrogramMouseDown = useCallback((e) => {
    if (!settings?.enable_bbox_drawing) {
      // In playback mode, mousedown performs seek immediately.
      seekToMousePosition(e.clientX, e.clientY);
      return;
    }

    e.preventDefault();
    const coords = pixelToCoordinates(e.clientX, e.clientY);
    if (!coords) return;

    pointerInteractionRef.current = {
      active: true,
      moved: false,
      mode: 'draw',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCoords: coords,
      handle: null
    };
    setIsPointerInteracting(true);

    // Check if clicking on an existing bbox handle
    if (currentBbox) {
      const handle = getHandleAtPoint(e.clientX, e.clientY);
      if (handle) {
        pointerInteractionRef.current.mode = 'edit';
        pointerInteractionRef.current.handle = handle;
        setEditingHandle(handle);
        setHoverHandle(handle);
        return;
      }
    }

    // Potential draw start (becomes an actual draw only after drag threshold)
    setDrawStartPoint(coords);
    setHoverHandle(null);
  }, [settings?.enable_bbox_drawing, pixelToCoordinates, currentBbox, getHandleAtPoint, seekToMousePosition]);

  const handleSpectrogramMouseMove = useCallback((e) => {
    if (!settings?.enable_bbox_drawing) return;

    const interaction = pointerInteractionRef.current;

    // Active interaction (including when cursor leaves spectrogram)
    if (interaction.active) {
      const coords = pixelToCoordinates(e.clientX, e.clientY);
      if (!coords) return;

      const dx = e.clientX - interaction.startClientX;
      const dy = e.clientY - interaction.startClientY;
      const moved = Math.hypot(dx, dy) > 3;

      if (moved && !interaction.moved) {
        interaction.moved = true;
      }

      if (interaction.mode === 'draw') {
        if (!interaction.moved) {
          return; // still a click candidate
        }

        if (!isDrawingBbox) {
          setIsDrawingBbox(true);
          setCurrentBbox(null);
        }

        const start = interaction.startCoords || drawStartPoint;
        if (!start) return;

        setCurrentBbox({
          start_time: Math.min(start.time, coords.time),
          end_time: Math.max(start.time, coords.time),
          low_freq: Math.min(start.freq, coords.freq),
          high_freq: Math.max(start.freq, coords.freq)
        });
        return;
      }

      if (interaction.mode === 'edit') {
        if (!interaction.moved) {
          return; // still a click candidate on handle
        }

        const activeHandle = interaction.handle || editingHandle;
        if (!activeHandle) return;
        updateBboxFromHandle(activeHandle, coords);
        return;
      }
    }

    // Hover state for resize cursors on bbox handles
    if (!isDrawingBbox && !editingHandle && currentBbox) {
      const handle = getHandleAtPoint(e.clientX, e.clientY);
      setHoverHandle(handle);
    }
  }, [settings?.enable_bbox_drawing, isDrawingBbox, editingHandle, currentBbox, getHandleAtPoint, drawStartPoint, pixelToCoordinates, updateBboxFromHandle]);

  const handleSpectrogramMouseUp = useCallback((e) => {
    const interaction = pointerInteractionRef.current;

    if (settings?.enable_bbox_drawing && interaction.active) {
      // Click in bbox mode (no drag): seek playback
      if (!interaction.moved && e) {
        seekToMousePosition(e.clientX, e.clientY);
      }

      // Drag in bbox mode: persist bbox updates
      if (interaction.moved && currentBbox && onBboxChange) {
        onBboxChange({
          bbox_start_t: parseFloat(currentBbox.start_time.toFixed(3)),
          bbox_end_t: parseFloat(currentBbox.end_time.toFixed(3)),
          bbox_low_f: parseFloat(currentBbox.low_freq.toFixed(1)),
          bbox_high_f: parseFloat(currentBbox.high_freq.toFixed(1))
        });
      }
    }

    pointerInteractionRef.current.active = false;
    pointerInteractionRef.current.moved = false;
    pointerInteractionRef.current.mode = null;
    pointerInteractionRef.current.handle = null;
    setIsPointerInteracting(false);
    setIsDrawingBbox(false);
    setDrawStartPoint(null);
    setEditingHandle(null);
    setHoverHandle(null);
  }, [settings?.enable_bbox_drawing, currentBbox, onBboxChange, seekToMousePosition]);

  // Continue drawing/editing until mouse button release, even outside spectrogram bounds
  useEffect(() => {
    if (!isPointerInteracting) return;

    const onWindowMouseMove = (e) => handleSpectrogramMouseMove(e);
    const onWindowMouseUp = (e) => handleSpectrogramMouseUp(e);

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [isPointerInteracting, handleSpectrogramMouseMove, handleSpectrogramMouseUp]);

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

  const handleDownloadCurrentClip = useCallback(() => {
    if (!audio_base64) {
      console.error('FocusView download failed: no clip audio data available');
      return;
    }

    try {
      const link = document.createElement('a');
      link.href = `data:audio/wav;base64,${audio_base64}`;

      const start = Number.isFinite(start_time) ? start_time.toFixed(2) : 'start';
      const end = Number.isFinite(end_time) ? end_time.toFixed(2) : 'end';
      const stem = file ? basename(file).replace(/\.[^/.]+$/, '') : 'clip';
      link.download = `${stem}_${start}s_${end}s.wav`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('FocusView download failed:', err);
    }
  }, [audio_base64, file, start_time, end_time]);

  // Format time helper
  const formatTime = useCallback((seconds) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Axis labels for focus spectrogram viewer
  const formatAxisTime = useCallback((seconds) => {
    if (seconds == null || Number.isNaN(seconds)) return '0:00.00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds - mins * 60;
    return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
  }, []);

  const axisTickCount = 5;
  const timeTicks = (time_range && axisTickCount > 1)
    ? Array.from({ length: axisTickCount }, (_, i) => {
      const t = time_range[0] + (i / (axisTickCount - 1)) * (time_range[1] - time_range[0]);
      return { value: t, label: formatAxisTime(t) };
    })
    : [];
  const freqTicks = (frequency_range && axisTickCount > 1)
    ? Array.from({ length: axisTickCount }, (_, i) => {
      const f = frequency_range[0] + (i / (axisTickCount - 1)) * (frequency_range[1] - frequency_range[0]);
      return { value: f, label: `${(f / 1000).toFixed(1)} kHz` };
    })
    : [];

  const handleToCursor = useCallback((handle) => {
    switch (handle) {
      case 'nw':
      case 'se':
        return 'nwse-resize';
      case 'ne':
      case 'sw':
        return 'nesw-resize';
      case 'n':
      case 's':
        return 'ns-resize';
      case 'e':
      case 'w':
        return 'ew-resize';
      default:
        return 'crosshair';
    }
  }, []);

  const spectrogramCursor = settings?.enable_bbox_drawing
    ? handleToCursor(editingHandle || hoverHandle)
    : 'pointer';

  const hasValidPaddingOverlay = Boolean(
    audio_padding > 0 &&
    original_time_range &&
    time_range &&
    time_range[1] > time_range[0] &&
    spectrogramDimsState &&
    spectrogramDimsState.renderWidth > 0 &&
    spectrogramDimsState.renderHeight > 0
  );

  const leftOverlayWidthPx = hasValidPaddingOverlay
    ? ((original_time_range[0] - time_range[0]) / (time_range[1] - time_range[0])) * spectrogramDimsState.renderWidth
    : 0;
  const rightOverlayWidthPx = hasValidPaddingOverlay
    ? ((time_range[1] - original_time_range[1]) / (time_range[1] - time_range[0])) * spectrogramDimsState.renderWidth
    : 0;

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

      // Let modified shortcuts (Cmd/Ctrl/Alt combos) pass through to app/global handlers
      // so single-key focus shortcuts never fire during combinations like Cmd/Ctrl+S.
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      // Handle Escape key for focus/grid toggle - let it bubble up to parent
      if (event.key === 'Escape') {
        // Don't prevent default - let parent handle this
        return;
      }

      // Prevent default behavior for our unmodified shortcuts
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

  // Handle spectrogram click (only for play/pause when bbox drawing is disabled)
  const handleSpectrogramClick = useCallback((e) => {
    // In bbox mode, clicks are for drawing/editing only.
    if (settings?.enable_bbox_drawing) {
      return;
    }
    // Intentionally no-op: seek is handled in mousedown for deterministic behavior.
  }, [settings?.enable_bbox_drawing]);

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
            onPlay={handleAudioPlay}
            onPause={handleAudioPause}
            onEnded={handleAudioEnded}
            preload="metadata"
          />
        )}

        {/* Large spectrogram display */}
        <div className={`focus-spectrogram-container ${settings?.focus_size ? `size-${settings.focus_size}` : 'size-medium'}`}>
          <div className="focus-spectrogram-grid" ref={spectrogramContainerRef}>
            <div className="focus-axis-y-outside">
              {spectrogram_base64 && spectrogramDimsState && freqTicks.length > 0 && time_range && (
                freqTicks.map((tick, idx) => {
                  const y = coordinatesToPixel(time_range[0], tick.value)?.y ?? spectrogramDimsState.offsetY;
                  return (
                    <div
                      key={`freq-outside-${idx}`}
                      className="focus-axis-outside-tick-wrap focus-axis-outside-tick-wrap-y"
                      style={{ top: `${y}px` }}
                    >
                      <div className="focus-axis-outside-label focus-axis-outside-label-y">{tick.label}</div>
                      <div className="focus-axis-outside-tick focus-axis-outside-tick-y" />
                    </div>
                  );
                })
              )}
            </div>

            <div
              className={`focus-spectrogram ${settings?.enable_bbox_drawing ? 'bbox-mode' : ''}`}
              onClick={handleSpectrogramClick}
              onMouseDown={handleSpectrogramMouseDown}
              onMouseMove={handleSpectrogramMouseMove}
              onMouseUp={handleSpectrogramMouseUp}
              onMouseLeave={() => setHoverHandle(null)}
              title={settings?.enable_bbox_drawing
                ? 'Click and drag to draw bounding box'
                : (audioUrl ? 'Click to seek playback position' : 'Audio not available')}
              style={{ cursor: spectrogramCursor }}
            >
              {spectrogram_base64 ? (
                <img
                  ref={spectrogramRef}
                  src={`data:image/png;base64,${spectrogram_base64}`}
                  alt="Spectrogram"
                  className="focus-spectrogram-image"
                  draggable={false}
                  onLoad={updateSpectrogramDimensions}
                />
              ) : (
                <div className="focus-spectrogram-placeholder">
                  <img src="/icon.svg" alt="Loading" className="placeholder-icon app-icon" />
                  <div className="placeholder-text">Loading spectrogram...</div>
                </div>
              )}

              {/* Padding overlays - show non-target regions with darker overlay */}
              {hasValidPaddingOverlay && (
                <>
                  {/* Left padding overlay */}
                  <div
                    className="focus-padding-overlay focus-padding-left"
                    style={{
                      top: `${spectrogramDimsState.offsetY}px`,
                      left: `${spectrogramDimsState.offsetX}px`,
                      height: `${spectrogramDimsState.renderHeight}px`,
                      width: `${Math.max(0, leftOverlayWidthPx)}px`
                    }}
                  />
                  {/* Right padding overlay */}
                  <div
                    className="focus-padding-overlay focus-padding-right"
                    style={{
                      top: `${spectrogramDimsState.offsetY}px`,
                      right: `${spectrogramDimsState.offsetX}px`,
                      height: `${spectrogramDimsState.renderHeight}px`,
                      width: `${Math.max(0, rightOverlayWidthPx)}px`
                    }}
                  />
                </>
              )}

              {/* Bounding box overlay */}
              {spectrogram_base64 && (
                <BboxOverlay
                  currentBbox={currentBbox}
                  coordinatesToPixel={coordinatesToPixel}
                  getSpectrogramDimensions={getSpectrogramDimensions}
                  isDrawing={isDrawingBbox}
                  editingHandle={editingHandle}
                />
              )}


            </div>

            <div className="focus-axis-x-outside">
              {spectrogram_base64 && spectrogramDimsState && timeTicks.length > 0 && frequency_range && (
                timeTicks.map((tick, idx) => {
                  const x = coordinatesToPixel(tick.value, frequency_range[0])?.x ?? spectrogramDimsState.offsetX;
                  return (
                    <div
                      key={`time-outside-${idx}`}
                      className="focus-axis-outside-tick-wrap focus-axis-outside-tick-wrap-x"
                      style={{ left: `${x}px` }}
                    >
                      <div className="focus-axis-outside-tick focus-axis-outside-tick-x" />
                      <div className="focus-axis-outside-label focus-axis-outside-label-x">{tick.label}</div>
                    </div>
                  );
                })
              )}
            </div>
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
                <button
                  onClick={handleDownloadCurrentClip}
                  className="audio-btn"
                  title="Download current clip audio"
                >
                  <span className="material-symbols-outlined">download</span>
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
            <div className="focus-file-name">{file ? basename(file) : 'Unknown file'}</div>
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
      </div>
    </div>
  );
}

export default FocusView;