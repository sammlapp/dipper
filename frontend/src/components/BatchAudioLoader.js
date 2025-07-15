import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Hook for efficiently loading multiple audio clips with spectrograms
 * Uses batch processing for significantly improved performance
 */
export const useBatchAudioLoader = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [debugInfo, setDebugInfo] = useState([]);

  const loadClipsBatch = useCallback(async (clipDataArray, settings = {}) => {
    const addDebug = (message, data = null) => {
      const debugEntry = {
        timestamp: new Date().toISOString(),
        message,
        data: data ? JSON.stringify(data, null, 2) : null
      };
      setDebugInfo(prev => [...prev, debugEntry]);
      console.log('BatchAudioLoader DEBUG:', message, data);
    };

    addDebug('Starting batch load', { clipCount: clipDataArray.length, settings });

    if (!window.electronAPI) {
      addDebug('ERROR: Electron API not available');
      setError('Electron API not available');
      return [];
    }

    setIsLoading(true);
    setError(null);
    setProgress(0);
    setDebugInfo([]);

    try {
      // Default settings optimized for performance
      const defaultSettings = {
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
        normalize_audio: true,
        max_workers: 4,
        create_temp_files: false, // Use only base64 for speed
        ...settings
      };

      addDebug('Using settings', defaultSettings);

      // Prepare clip data for batch processing
      const clipsForBatch = clipDataArray.map((clip, index) => ({
        clip_id: clip.clip_id || `clip_${index}`,
        file_path: clip.file_path,
        start_time: clip.start_time,
        end_time: clip.end_time,
        ...clip
      }));

      addDebug('Prepared clips for batch', clipsForBatch);

      // Use batch processing script
      addDebug('Calling createAudioClipsBatch...');
      let result;
      try {
        result = await window.electronAPI.createAudioClipsBatch(
          clipsForBatch,
          defaultSettings
        );
        addDebug('Batch processing result', result);
      } catch (batchError) {
        addDebug('Batch processing failed, trying individual clips', { error: batchError.message });
        
        // Fallback to individual clip processing
        const individualResults = [];
        for (let i = 0; i < clipsForBatch.length; i++) {
          const clip = clipsForBatch[i];
          setProgress((i / clipsForBatch.length) * 100);
          
          try {
            const individualResult = await window.electronAPI.createAudioClips(
              clip.file_path,
              clip.start_time,
              clip.end_time,
              defaultSettings
            );
            
            if (individualResult.status === 'success') {
              individualResults.push({
                ...individualResult,
                clip_id: clip.clip_id
              });
            } else {
              addDebug(`Individual clip failed: ${clip.clip_id}`, individualResult);
              individualResults.push({
                status: 'error',
                error: individualResult.error || 'Individual clip processing failed',
                clip_id: clip.clip_id
              });
            }
          } catch (individualError) {
            addDebug(`Individual clip error: ${clip.clip_id}`, { error: individualError.message });
            individualResults.push({
              status: 'error',
              error: individualError.message,
              clip_id: clip.clip_id
            });
          }
        }
        
        result = {
          status: 'success',
          results: individualResults
        };
      }

      if (result.status === 'success') {
        setProgress(100);
        
        // Transform results back to match expected format
        const processedClips = result.results.map((clipResult, index) => ({
          ...clipDataArray[index],
          ...clipResult,
          // Keep original clip data
          originalData: clipDataArray[index]
        }));

        addDebug('Processed clips', processedClips);
        return processedClips;
      } else {
        addDebug('Batch processing failed', result);
        throw new Error(result.error || 'Batch processing failed');
      }

    } catch (err) {
      addDebug('ERROR in batch processing', { error: err.message, stack: err.stack });
      setError(`Failed to load clips: ${err.message}`);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadSingleClip = useCallback(async (clipData, settings = {}) => {
    const results = await loadClipsBatch([clipData], settings);
    return results[0] || null;
  }, [loadClipsBatch]);

  return {
    loadClipsBatch,
    loadSingleClip,
    isLoading,
    error,
    progress,
    debugInfo
  };
};

/**
 * Component for displaying batch loading progress
 */
export const BatchLoadingProgress = ({ isLoading, progress, error, totalClips }) => {
  if (!isLoading && !error) return null;

  return (
    <div className="batch-loading-progress">
      {isLoading && (
        <div className="loading-indicator">
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="progress-text">
            Loading {totalClips} clips... {progress.toFixed(0)}%
          </div>
        </div>
      )}
      
      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  );
};

/**
 * Enhanced AudioClipCard that supports batch-loaded data
 */
export const FastAudioClipCard = ({ 
  clipData, 
  showPredictions = false, 
  showAnnotations = false, 
  showComments = false,
  onPlaybackChange = null,
  className = ""
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);

  // Extract data (prioritize batch-loaded base64 data)
  const {
    file_path,
    start_time,
    end_time,
    species,
    score,
    predictions = {},
    annotations = {},
    comments = "",
    audio_base64,
    spectrogram_base64,
    duration: loadedDuration,
    error: clipError
  } = clipData || {};

  // Create audio URL from base64 data
  const audioUrl = audio_base64 ? `data:audio/wav;base64,${audio_base64}` : null;
  const spectrogramUrl = spectrogram_base64 ? `data:image/png;base64,${spectrogram_base64}` : null;

  useEffect(() => {
    if (loadedDuration) {
      setDuration(loadedDuration);
    }
  }, [loadedDuration]);

  const handleSpectrogramClick = async () => {
    if (!audioUrl) return;

    try {
      if (isPlaying) {
        audioRef.current?.pause();
        setIsPlaying(false);
        onPlaybackChange?.(false);
      } else {
        await audioRef.current?.play();
        setIsPlaying(true);
        onPlaybackChange?.(true);
      }
    } catch (err) {
      console.error('Playback failed:', err);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    onPlaybackChange?.(false);
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

  return (
    <div className={`audio-clip-card fast-loaded ${className}`}>
      {/* Audio element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onEnded={handleAudioEnded}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => {
            if (audioRef.current && !duration) {
              setDuration(audioRef.current.duration);
            }
          }}
          preload="metadata"
        />
      )}

      {/* Spectrogram area */}
      <div className="spectrogram-container" onClick={handleSpectrogramClick}>
        {spectrogramUrl ? (
          <img 
            src={spectrogramUrl} 
            alt="Spectrogram" 
            className="spectrogram-image"
            style={{ cursor: audioUrl ? 'pointer' : 'default' }}
          />
        ) : (
          <div className="spectrogram-placeholder">
            <div className="placeholder-icon">🔊</div>
            <div className="placeholder-text">No spectrogram available</div>
          </div>
        )}

        {/* Progress bar */}
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

        {/* Error display */}
        {clipError && (
          <div className="error-display">
            <strong>Error:</strong> {clipError}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Debug panel component for troubleshooting batch loading
 */
export const BatchLoadingDebugPanel = ({ debugInfo, isLoading, error }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (debugInfo.length === 0 && !isLoading && !error) {
    return null;
  }

  return (
    <div className="batch-debug-panel">
      <button 
        className="debug-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        🐛 Debug Info ({debugInfo.length} entries) {isExpanded ? '▼' : '▶'}
      </button>
      
      {isExpanded && (
        <div className="debug-content">
          <div className="debug-status">
            <p><strong>Status:</strong> {isLoading ? 'Loading...' : 'Idle'}</p>
            {error && <p><strong>Error:</strong> {error}</p>}
          </div>
          
          <div className="debug-log">
            <h4>Debug Log:</h4>
            <div className="debug-entries">
              {debugInfo.map((entry, index) => (
                <div key={index} className="debug-entry">
                  <div className="debug-timestamp">{entry.timestamp}</div>
                  <div className="debug-message">{entry.message}</div>
                  {entry.data && (
                    <pre className="debug-data">{entry.data}</pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default { useBatchAudioLoader, BatchLoadingProgress, FastAudioClipCard, BatchLoadingDebugPanel };