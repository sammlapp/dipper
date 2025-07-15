import { useState, useEffect, useRef } from 'react';

/**
 * Frontend Performance Profiler for measuring rendering and IPC times
 */
export const usePerformanceProfiler = () => {
  const [measurements, setMeasurements] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const timers = useRef({});
  const renderCounts = useRef({});

  const startTimer = (operation) => {
    timers.current[operation] = performance.now();
  };

  const endTimer = (operation, metadata = {}) => {
    if (timers.current[operation]) {
      const duration = performance.now() - timers.current[operation];
      const measurement = {
        operation,
        duration,
        timestamp: new Date().toISOString(),
        metadata
      };
      
      if (isRecording) {
        setMeasurements(prev => [...prev, measurement]);
      }
      
      delete timers.current[operation];
      return duration;
    }
    return 0;
  };

  const measureRender = (componentName) => {
    renderCounts.current[componentName] = (renderCounts.current[componentName] || 0) + 1;
    const renderKey = `render_${componentName}_${renderCounts.current[componentName]}`;
    
    // Use React's unstable_trace if available for better profiling
    if (typeof window !== 'undefined' && window.React && window.React.unstable_trace) {
      window.React.unstable_trace(componentName, performance.now(), () => {
        // Component rendering code would go here
      });
    }

    return {
      start: () => startTimer(renderKey),
      end: (metadata = {}) => endTimer(renderKey, { ...metadata, component: componentName })
    };
  };

  const measureAsync = async (operation, asyncFunction, metadata = {}) => {
    startTimer(operation);
    try {
      const result = await asyncFunction();
      endTimer(operation, { ...metadata, success: true });
      return result;
    } catch (error) {
      endTimer(operation, { ...metadata, success: false, error: error.message });
      throw error;
    }
  };

  const clearMeasurements = () => {
    setMeasurements([]);
    renderCounts.current = {};
  };

  const getStats = () => {
    const operations = measurements.reduce((acc, m) => {
      if (!acc[m.operation]) {
        acc[m.operation] = { times: [], count: 0 };
      }
      acc[m.operation].times.push(m.duration);
      acc[m.operation].count++;
      return acc;
    }, {});

    const stats = Object.entries(operations).map(([operation, data]) => ({
      operation,
      count: data.count,
      totalTime: data.times.reduce((sum, time) => sum + time, 0),
      averageTime: data.times.reduce((sum, time) => sum + time, 0) / data.times.length,
      minTime: Math.min(...data.times),
      maxTime: Math.max(...data.times)
    }));

    return stats.sort((a, b) => b.totalTime - a.totalTime);
  };

  return {
    startTimer,
    endTimer,
    measureRender,
    measureAsync,
    measurements,
    isRecording,
    setIsRecording,
    clearMeasurements,
    getStats
  };
};

/**
 * Enhanced BatchAudioLoader with performance profiling
 */
export const useProfiledBatchAudioLoader = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [debugInfo, setDebugInfo] = useState([]);
  const [performanceData, setPerformanceData] = useState([]);
  const profiler = usePerformanceProfiler();

  const loadClipsBatch = async (clipDataArray, settings = {}) => {
    const addDebug = (message, data = null) => {
      const debugEntry = {
        timestamp: new Date().toISOString(),
        message,
        data: data ? JSON.stringify(data, null, 2) : null
      };
      setDebugInfo(prev => [...prev, debugEntry]);
      console.log('ProfiledBatchAudioLoader:', message, data);
    };

    const addPerformance = (operation, duration, metadata = {}) => {
      const perfEntry = {
        operation,
        duration,
        timestamp: new Date().toISOString(),
        metadata
      };
      setPerformanceData(prev => [...prev, perfEntry]);
    };

    addDebug('Starting batch load with profiling', { clipCount: clipDataArray.length });
    
    if (!window.electronAPI) {
      addDebug('ERROR: Electron API not available');
      setError('Electron API not available');
      return [];
    }

    setIsLoading(true);
    setError(null);
    setProgress(0);
    setDebugInfo([]);
    setPerformanceData([]);

    try {
      // Time the entire operation
      const totalStartTime = performance.now();

      // Default settings
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
        create_temp_files: false,
        ...settings
      };

      // Time data preparation
      const prepStartTime = performance.now();
      const clipsForBatch = clipDataArray.map((clip, index) => ({
        clip_id: clip.clip_id || `clip_${index}`,
        file_path: clip.file_path,
        start_time: clip.start_time,
        end_time: clip.end_time,
        ...clip
      }));
      const prepTime = performance.now() - prepStartTime;
      addPerformance('data_preparation', prepTime, { clipCount: clipDataArray.length });
      addDebug(`Data preparation: ${prepTime.toFixed(2)}ms`);

      // Time IPC call to backend
      const ipcStartTime = performance.now();
      let result;
      try {
        result = await window.electronAPI.createAudioClipsBatch(clipsForBatch, defaultSettings);
        const ipcTime = performance.now() - ipcStartTime;
        addPerformance('ipc_backend_call', ipcTime, { clipCount: clipDataArray.length });
        addDebug(`Backend IPC call: ${ipcTime.toFixed(2)}ms`);
      } catch (batchError) {
        const ipcTime = performance.now() - ipcStartTime;
        addPerformance('ipc_backend_call_failed', ipcTime, { error: batchError.message });
        addDebug('Batch processing failed, trying individual clips', { error: batchError.message });
        
        // Fallback to individual processing with timing
        const individualResults = [];
        for (let i = 0; i < clipsForBatch.length; i++) {
          const clip = clipsForBatch[i];
          setProgress((i / clipsForBatch.length) * 100);
          
          const individualStartTime = performance.now();
          try {
            const individualResult = await window.electronAPI.createAudioClips(
              clip.file_path,
              clip.start_time,
              clip.end_time,
              defaultSettings
            );
            const individualTime = performance.now() - individualStartTime;
            addPerformance('individual_clip_processing', individualTime, { 
              clipId: clip.clip_id,
              success: individualResult.status === 'success'
            });
            
            if (individualResult.status === 'success') {
              individualResults.push({
                ...individualResult,
                clip_id: clip.clip_id
              });
            } else {
              individualResults.push({
                status: 'error',
                error: individualResult.error || 'Individual clip processing failed',
                clip_id: clip.clip_id
              });
            }
          } catch (individualError) {
            const individualTime = performance.now() - individualStartTime;
            addPerformance('individual_clip_processing', individualTime, { 
              clipId: clip.clip_id,
              success: false,
              error: individualError.message
            });
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
        
        // Time data processing and transformation
        const processStartTime = performance.now();
        const processedClips = result.results.map((clipResult, index) => ({
          ...clipDataArray[index],
          ...clipResult,
          originalData: clipDataArray[index]
        }));
        const processTime = performance.now() - processStartTime;
        addPerformance('data_transformation', processTime, { clipCount: processedClips.length });
        addDebug(`Data transformation: ${processTime.toFixed(2)}ms`);

        // Calculate total time and data sizes
        const totalTime = performance.now() - totalStartTime;
        const successfulClips = processedClips.filter(clip => clip.status === 'success');
        const totalAudioSize = successfulClips.reduce((sum, clip) => 
          sum + (clip.audio_base64 ? clip.audio_base64.length : 0), 0);
        const totalSpecSize = successfulClips.reduce((sum, clip) => 
          sum + (clip.spectrogram_base64 ? clip.spectrogram_base64.length : 0), 0);

        addPerformance('total_operation', totalTime, {
          clipCount: clipDataArray.length,
          successfulClips: successfulClips.length,
          totalAudioSizeBytes: totalAudioSize,
          totalSpectrogramSizeBytes: totalSpecSize,
          averageTimePerClip: totalTime / clipDataArray.length,
          throughputClipsPerSecond: (clipDataArray.length / totalTime) * 1000
        });

        addDebug('Batch processing completed', {
          totalTime: `${totalTime.toFixed(2)}ms`,
          successfulClips: successfulClips.length,
          throughput: `${((clipDataArray.length / totalTime) * 1000).toFixed(1)} clips/sec`
        });

        return processedClips;
      } else {
        throw new Error(result.error || 'Batch processing failed');
      }

    } catch (err) {
      addDebug('ERROR in batch processing', { error: err.message });
      setError(`Failed to load clips: ${err.message}`);
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  return {
    loadClipsBatch,
    isLoading,
    error,
    progress,
    debugInfo,
    performanceData,
    profiler
  };
};

/**
 * Performance Profiler Display Component
 */
export const PerformanceProfilerPanel = ({ performanceData, measurements, onClear }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sortBy, setSortBy] = useState('duration');

  if (!performanceData?.length && !measurements?.length) {
    return null;
  }

  const allData = [...(performanceData || []), ...(measurements || [])];
  const sortedData = allData.sort((a, b) => {
    if (sortBy === 'duration') return b.duration - a.duration;
    if (sortBy === 'timestamp') return new Date(b.timestamp) - new Date(a.timestamp);
    return a.operation.localeCompare(b.operation);
  });

  const stats = allData.reduce((acc, item) => {
    if (!acc[item.operation]) {
      acc[item.operation] = { count: 0, totalTime: 0, times: [] };
    }
    acc[item.operation].count++;
    acc[item.operation].totalTime += item.duration;
    acc[item.operation].times.push(item.duration);
    return acc;
  }, {});

  const statsArray = Object.entries(stats).map(([operation, data]) => ({
    operation,
    count: data.count,
    totalTime: data.totalTime,
    averageTime: data.totalTime / data.count,
    minTime: Math.min(...data.times),
    maxTime: Math.max(...data.times)
  }));

  return (
    <div className="performance-profiler-panel">
      <button 
        className="profiler-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        📊 Performance Profile ({allData.length} measurements) {isExpanded ? '▼' : '▶'}
      </button>
      
      {isExpanded && (
        <div className="profiler-content">
          <div className="profiler-controls">
            <label>
              Sort by:
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="duration">Duration</option>
                <option value="timestamp">Timestamp</option>
                <option value="operation">Operation</option>
              </select>
            </label>
            <button onClick={onClear} className="clear-button">Clear Data</button>
          </div>

          <div className="profiler-stats">
            <h4>Performance Summary</h4>
            <div className="stats-grid">
              {statsArray.map(stat => (
                <div key={stat.operation} className="stat-item">
                  <div className="stat-operation">{stat.operation}</div>
                  <div className="stat-values">
                    <span>Count: {stat.count}</span>
                    <span>Total: {stat.totalTime.toFixed(2)}ms</span>
                    <span>Avg: {stat.averageTime.toFixed(2)}ms</span>
                    <span>Min: {stat.minTime.toFixed(2)}ms</span>
                    <span>Max: {stat.maxTime.toFixed(2)}ms</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="profiler-details">
            <h4>Detailed Measurements</h4>
            <div className="measurements-list">
              {sortedData.map((measurement, index) => (
                <div key={index} className="measurement-item">
                  <div className="measurement-header">
                    <span className="operation">{measurement.operation}</span>
                    <span className="duration">{measurement.duration.toFixed(2)}ms</span>
                    <span className="timestamp">{new Date(measurement.timestamp).toLocaleTimeString()}</span>
                  </div>
                  {measurement.metadata && (
                    <div className="measurement-metadata">
                      {Object.entries(measurement.metadata).map(([key, value]) => (
                        <span key={key} className="metadata-item">
                          {key}: {typeof value === 'object' ? JSON.stringify(value) : value}
                        </span>
                      ))}
                    </div>
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

/**
 * Hook for measuring component render performance
 */
export const useRenderProfiler = (componentName) => {
  const renderStart = useRef(null);
  const [renderTimes, setRenderTimes] = useState([]);

  useEffect(() => {
    renderStart.current = performance.now();
  });

  useEffect(() => {
    if (renderStart.current) {
      const renderTime = performance.now() - renderStart.current;
      setRenderTimes(prev => [...prev.slice(-9), renderTime]); // Keep last 10 renders
      console.log(`${componentName} render time: ${renderTime.toFixed(2)}ms`);
    }
  });

  const getAverageRenderTime = () => {
    if (renderTimes.length === 0) return 0;
    return renderTimes.reduce((sum, time) => sum + time, 0) / renderTimes.length;
  };

  return {
    renderTimes,
    averageRenderTime: getAverageRenderTime(),
    lastRenderTime: renderTimes[renderTimes.length - 1] || 0
  };
};