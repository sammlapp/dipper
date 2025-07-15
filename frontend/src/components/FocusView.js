import { useState, useEffect, useRef, useCallback } from 'react';

function FocusView({ 
  clipData, 
  onAnnotationChange, 
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
    audio_base64 = null,
    spectrogram_base64 = null
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

  // Auto-play when clip changes (if enabled in settings)
  useEffect(() => {
    if (audioUrl && settings?.focus_mode_autoplay && !hasAutoPlayedRef.current) {
      hasAutoPlayedRef.current = true;
      setTimeout(() => {
        playAudio();
      }, 100); // Small delay to ensure audio is ready
    }
    
    // Reset auto-play flag when clip changes
    return () => {
      hasAutoPlayedRef.current = false;
    };
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
    if (audioRef.current && !isPlaying) {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (err) {
        console.error('Audio playback error:', err);
      }
    }
  }, [isPlaying]);

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
      return annotation || 'unlabeled';
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
    { value: 'unsure', label: 'Unsure', key: 'd', color: 'rgb(237, 223, 177)' },
    { value: 'unlabeled', label: 'Unlabeled', key: 'f', color: 'rgb(223, 223, 223)' }
  ];

  // Keyboard event handler
  useEffect(() => {
    const handleKeyDown = (event) => {
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
            handleAnnotationChangeWithAdvance('unsure');
          }
          break;
        case 'f':
          if (reviewMode === 'binary') {
            handleAnnotationChangeWithAdvance('');
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
      <div className="focus-spectrogram-container">
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
              <div className="placeholder-icon">🔊</div>
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
          <div className="focus-play-overlay">
            <div className={`focus-play-button ${isPlaying ? 'playing' : 'paused'}`}>
              <span className="material-symbols-outlined">
                {isPlaying ? 'pause' : 'play_arrow'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Clip info and controls */}
      <div className="focus-controls">
        <div className="focus-clip-info">
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

        {/* Binary annotation controls */}
        {reviewMode === 'binary' && (
          <div className="focus-annotation-controls">
            <div className="focus-binary-controls">
              {binaryOptions.map(option => (
                <button
                  key={option.value}
                  className={`focus-annotation-button ${annotationValue === option.value ? 'active' : ''}`}
                  style={{
                    backgroundColor: annotationValue === option.value ? option.color : 'transparent',
                    borderColor: option.color,
                    color: annotationValue === option.value ? 'white' : option.color
                  }}
                  onClick={() => handleAnnotationChangeWithAdvance(option.value === 'unlabeled' ? '' : option.value)}
                >
                  <span className="button-key">({option.key})</span>
                  <span className="button-label">{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Navigation controls */}
        <div className="focus-navigation">
          <button 
            className="focus-nav-button"
            onClick={() => onNavigate('previous')}
            title="Previous clip (j)"
          >
            <span className="material-symbols-outlined">skip_previous</span>
            Previous (j)
          </button>
          
          <button 
            className="focus-nav-button"
            onClick={() => onNavigate('next')}
            title="Next clip (k)"
          >
            <span className="material-symbols-outlined">skip_next</span>
            Next (k)
          </button>
        </div>
      </div>

      {/* Keyboard shortcuts help */}
      <div className="focus-shortcuts-help">
        <small>
          <strong>Shortcuts:</strong> 
          {reviewMode === 'binary' && ' a=Yes, s=No, d=Unsure, f=Unlabeled |'} 
          j=Previous, k=Next | Space=Play/Pause
        </small>
      </div>
    </div>
  );
}

export default FocusView;