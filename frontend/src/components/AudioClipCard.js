import { useState, useRef, useEffect } from 'react';

function AudioClipCard({ 
  clipData, 
  showPredictions = false, 
  showAnnotations = false, 
  showComments = false,
  onPlaybackChange = null,
  className = "",
  autoLoadSpectrogram = false
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [audioUrl, setAudioUrl] = useState(null);
  const [spectrogramUrl, setSpectrogramUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [clipResult, setClipResult] = useState(null);
  const audioRef = useRef(null);
  const [audioBase64, setAudioBase64] = useState(null);

  // Extract clip information
  const {
    file_path,
    start_time,
    end_time,
    species,
    score,
    predictions = {},
    annotations = {},
    comments = "",
    spectrogram_base64 = null
  } = clipData || {};

  useEffect(() => {
    // If we have base64 spectrogram data, create a URL for it
    if (spectrogram_base64) {
      const dataUrl = `data:image/png;base64,${spectrogram_base64}`;
      setSpectrogramUrl(dataUrl);
    }
  }, [spectrogram_base64]);

  useEffect(() => {
    // If we have base64 audio data, create a URL for it
    if (audioBase64) {
      const dataUrl = `data:audio/wav;base64,${audioBase64}`;
      setAudioUrl(dataUrl);
    }
  }, [audioBase64]);

  // Auto-load spectrogram when clipData changes
  useEffect(() => {
    if (autoLoadSpectrogram && clipData && file_path && start_time !== undefined && end_time !== undefined) {
      loadClipData();
    }
  }, [clipData, autoLoadSpectrogram, file_path, start_time, end_time]);

  const loadClipData = async () => {
    if (isLoading) return;

    try {
      setIsLoading(true);
      setError('');

      // Get visualization settings from localStorage
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
        normalize_audio: true
      };

      if (window.electronAPI) {
        const result = await window.electronAPI.createAudioClips(
          file_path, 
          start_time, 
          end_time, 
          settings
        );

        if (result.status === 'success') {
          setClipResult(result);
          
          // Prioritize base64 data over file paths for faster loading
          if (result.audio_base64) {
            setAudioBase64(result.audio_base64);
          } else if (result.audio_path) {
            // Fallback to file path if base64 not available
            setAudioUrl(`file://${result.audio_path}`);
          }
          
          // Update spectrogram if we got a new one
          if (result.spectrogram_base64) {
            const dataUrl = `data:image/png;base64,${result.spectrogram_base64}`;
            setSpectrogramUrl(dataUrl);
          }
          
          setDuration(result.duration || (end_time - start_time));
        } else {
          setError(result.error || 'Failed to create audio clip');
        }
      } else {
        setError('Electron API not available');
      }
    } catch (err) {
      setError(`Failed to load clip: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSpectrogramClick = async () => {
    if (isLoading) return;

    try {
      if (isPlaying) {
        // Pause audio
        if (audioRef.current) {
          audioRef.current.pause();
        }
        setIsPlaying(false);
        if (onPlaybackChange) onPlaybackChange(false);
        return;
      }

      // If we don't have an audio URL yet, load the clip data
      if (!audioUrl) {
        await loadClipData();
        // Wait a bit for the audio element to load
        setTimeout(async () => {
          if (audioRef.current && audioUrl) {
            try {
              await audioRef.current.play();
              setIsPlaying(true);
              if (onPlaybackChange) onPlaybackChange(true);
            } catch (playErr) {
              setError(`Playback failed: ${playErr.message}`);
            }
          }
        }, 100);
      } else {
        // Play audio directly
        if (audioRef.current) {
          await audioRef.current.play();
          setIsPlaying(true);
          if (onPlaybackChange) onPlaybackChange(true);
        }
      }

    } catch (err) {
      setError(`Playback failed: ${err.message}`);
      setIsPlaying(false);
      if (onPlaybackChange) onPlaybackChange(false);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (onPlaybackChange) onPlaybackChange(false);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const formatTime = (time) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const renderSpectrogram = () => {
    if (spectrogramUrl) {
      return (
        <img 
          src={spectrogramUrl} 
          alt="Spectrogram" 
          className="spectrogram-image"
        />
      );
    }
    
    // Placeholder spectrogram
    return (
      <div className="spectrogram-placeholder">
        <img src="/icon.svg" alt="Audio Clip" className="placeholder-icon app-icon" />
        <div className="placeholder-text">Click to generate spectrogram</div>
      </div>
    );
  };

  const getPlayButtonIcon = () => {
    if (isLoading) return "⏳";
    return isPlaying ? "⏸️" : "▶️";
  };

  return (
    <div className={`audio-clip-card ${className}`}>
      {/* Audio element (hidden) */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onEnded={handleAudioEnded}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => {
            if (audioRef.current) {
              setDuration(audioRef.current.duration);
            }
          }}
          preload="metadata"
        />
      )}

      {/* Spectrogram area - clickable */}
      <div className="spectrogram-container" onClick={handleSpectrogramClick}>
        {renderSpectrogram()}

        {/* Progress bar only (no play button overlay) */}
        {duration > 0 && (
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${(currentTime / duration) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Card content */}
      <div className="card-content">
        {/* Basic info */}
        <div className="clip-info">
          <div className="file-name">
            {file_path ? file_path.split('/').pop() : 'Unknown file'}
          </div>
          <div className="time-range">
            {start_time !== undefined && end_time !== undefined 
              ? `${start_time.toFixed(1)}s - ${end_time.toFixed(1)}s`
              : 'Unknown time range'
            }
          </div>
          {duration > 0 && (
            <div className="duration">
              Duration: {formatTime(duration)}
            </div>
          )}
        </div>

        {/* Species and score */}
        {species && (
          <div className="species-info">
            <div className="species-name">{species}</div>
            {score !== undefined && (
              <div className="confidence-score">
                Score: {score.toFixed(3)}
              </div>
            )}
          </div>
        )}

        {/* ML Predictions */}
        {showPredictions && predictions && Object.keys(predictions).length > 0 && (
          <div className="predictions-section">
            <h5>Predictions:</h5>
            <div className="predictions-list">
              {Object.entries(predictions)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 3)
                .map(([pred_species, pred_score]) => (
                  <div key={pred_species} className="prediction-item">
                    <span className="pred-species">{pred_species}</span>
                    <span className="pred-score">{pred_score.toFixed(3)}</span>
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {/* User Annotations */}
        {showAnnotations && annotations && Object.keys(annotations).length > 0 && (
          <div className="annotations-section">
            <h5>Annotations:</h5>
            <div className="annotations-list">
              {Object.entries(annotations).map(([key, value]) => (
                <div key={key} className="annotation-item">
                  <span className="annotation-key">{key}:</span>
                  <span className="annotation-value">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comments */}
        {showComments && comments && (
          <div className="comments-section">
            <h5>Comments:</h5>
            <div className="comment-text">{comments}</div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="error-display">
            <strong>Error:</strong> {error}
          </div>
        )}
      </div>
    </div>
  );
}

export default AudioClipCard;