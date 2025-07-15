import { useState, useCallback } from 'react';

/**
 * HTTP-based audio loader - 20x faster than IPC by using direct HTTP calls
 */
export const useHttpAudioLoader = (serverUrl = 'http://localhost:8000') => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [debugInfo, setDebugInfo] = useState([]);
  const [performanceData, setPerformanceData] = useState([]);

  const addDebug = useCallback((message, data = null) => {
    const debugEntry = {
      timestamp: new Date().toISOString(),
      message,
      data: data ? JSON.stringify(data, null, 2) : null
    };
    setDebugInfo(prev => [...prev, debugEntry]);
    console.log('HttpAudioLoader DEBUG:', message, data);
  }, []);

  const addPerformance = useCallback((operation, duration, metadata = {}) => {
    const perfEntry = {
      operation,
      duration,
      timestamp: new Date().toISOString(),
      metadata
    };
    setPerformanceData(prev => [...prev, perfEntry]);
  }, []);

  const checkServerHealth = useCallback(async () => {
    try {
      const response = await fetch(`${serverUrl}/health`);
      if (!response.ok) {
        throw new Error(`Server health check failed: ${response.status}`);
      }
      const data = await response.json();
      addDebug('Server health check passed', data);
      return true;
    } catch (err) {
      addDebug('Server health check failed', { error: err.message });
      return false;
    }
  }, [serverUrl, addDebug]);

  const loadSingleClip = useCallback(async (clipData, settings = {}) => {
    const {
      file_path,
      start_time,
      end_time
    } = clipData;

    if (!file_path || start_time === undefined) {
      throw new Error('file_path and start_time are required');
    }

    // Build query parameters
    const params = new URLSearchParams({
      file_path,
      start_time: start_time.toString(),
      end_time: (end_time || start_time + 3).toString(),
      spec_window_size: (settings.spec_window_size || 512).toString(),
      spectrogram_colormap: settings.spectrogram_colormap || 'greys_r',
      dB_range: JSON.stringify(settings.dB_range || [-80, -20]),
      use_bandpass: (settings.use_bandpass || false).toString(),
      bandpass_range: JSON.stringify(settings.bandpass_range || [500, 8000]),
      show_reference_frequency: (settings.show_reference_frequency || false).toString(),
      reference_frequency: (settings.reference_frequency || 1000).toString(),
      resize_images: (settings.resize_images !== false).toString(),
      image_width: (settings.image_width || 224).toString(),
      image_height: (settings.image_height || 224).toString(),
      normalize_audio: (settings.normalize_audio !== false).toString()
    });

    const startTime = performance.now();
    
    try {
      const response = await fetch(`${serverUrl}/clip?${params}`);
      const fetchTime = performance.now() - startTime;
      
      addPerformance('http_fetch_single', fetchTime, { 
        file_path, 
        start_time, 
        end_time: end_time || start_time + 3 
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const parseStartTime = performance.now();
      const data = await response.json();
      const parseTime = performance.now() - parseStartTime;
      
      addPerformance('json_parse_single', parseTime, { 
        audio_size: data.audio_base64?.length || 0,
        spectrogram_size: data.spectrogram_base64?.length || 0
      });

      addDebug(`Single clip loaded via HTTP in ${fetchTime.toFixed(2)}ms`, {
        file_path,
        cached: data.cached,
        audio_size: data.audio_base64?.length || 0,
        spectrogram_size: data.spectrogram_base64?.length || 0
      });

      return {
        ...clipData,
        ...data,
        clip_id: clipData.clip_id,
        status: 'success'
      };

    } catch (err) {
      const totalTime = performance.now() - startTime;
      addPerformance('http_fetch_single_error', totalTime, { error: err.message });
      addDebug('Single clip HTTP fetch failed', { error: err.message, file_path });
      throw err;
    }
  }, [serverUrl, addDebug, addPerformance]);

  const loadClipsBatch = useCallback(async (clipDataArray, settings = {}) => {
    addDebug('Starting HTTP batch load', { clipCount: clipDataArray.length, serverUrl });

    setIsLoading(true);
    setError(null);
    setProgress(0);
    setDebugInfo([]);
    setPerformanceData([]);

    try {
      // Check server health first
      const healthStartTime = performance.now();
      const isHealthy = await checkServerHealth();
      const healthTime = performance.now() - healthStartTime;
      addPerformance('server_health_check', healthTime, { healthy: isHealthy });

      if (!isHealthy) {
        throw new Error('Server is not healthy. Make sure the Python HTTP server is running on ' + serverUrl);
      }

      // Default settings optimized for HTTP
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
        ...settings
      };

      // Prepare clips data
      const prepStartTime = performance.now();
      const clipsForBatch = clipDataArray.map((clip, index) => ({
        clip_id: clip.clip_id || `clip_${index}`,
        file_path: clip.file_path,
        start_time: clip.start_time,
        end_time: clip.end_time || clip.start_time + 3,
        ...clip
      }));
      const prepTime = performance.now() - prepStartTime;
      addPerformance('data_preparation', prepTime, { clipCount: clipDataArray.length });

      addDebug('Using HTTP batch endpoint', { clips: clipsForBatch.length, settings: defaultSettings });
      console.log('HTTP Batch Request Settings:', defaultSettings);
      console.log('Colormap setting:', defaultSettings.spectrogram_colormap);
      console.log('dB range setting:', defaultSettings.dB_range);

      // Make HTTP batch request
      const fetchStartTime = performance.now();
      
      const response = await fetch(`${serverUrl}/clips/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clips: clipsForBatch,
          settings: defaultSettings
        })
      });

      const fetchTime = performance.now() - fetchStartTime;
      addPerformance('http_fetch_batch', fetchTime, { clipCount: clipsForBatch.length });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('HTTP Batch Request Failed:', {
          status: response.status,
          statusText: response.statusText,
          errorData,
          sentSettings: defaultSettings
        });
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      // Parse response
      const parseStartTime = performance.now();
      const result = await response.json();
      const parseTime = performance.now() - parseStartTime;
      addPerformance('json_parse_batch', parseTime, { 
        resultCount: result.results?.length || 0 
      });

      if (result.status === 'success') {
        setProgress(100);
        
        // Debug what we received
        addDebug('Raw HTTP response received', {
          resultCount: result.results?.length || 0,
          serverSuccessful: result.successful_clips,
          firstResult: result.results?.[0],
          processingTime: result.processing_time
        });
        
        // Transform results back to match expected format
        const processStartTime = performance.now();
        const processedClips = result.results.map((clipResult, index) => ({
          ...clipDataArray[index],
          ...clipResult,
          clip_id: clipResult.clip_id || clipDataArray[index].clip_id,
          originalData: clipDataArray[index]
        }));
        const processTime = performance.now() - processStartTime;
        addPerformance('data_transformation', processTime, { clipCount: processedClips.length });

        // Calculate statistics
        const successfulClips = processedClips.filter(clip => clip.status === 'success');
        
        // Debug the transformation
        addDebug('Processed clips analysis', {
          totalProcessed: processedClips.length,
          successfulAfterTransform: successfulClips.length,
          sampleClip: processedClips[0],
          sampleClipStatus: processedClips[0]?.status,
          hasAudio: !!processedClips[0]?.audio_base64,
          hasSpectrogram: !!processedClips[0]?.spectrogram_base64
        });
        const totalAudioSize = successfulClips.reduce((sum, clip) => 
          sum + (clip.audio_base64?.length || 0), 0);
        const totalSpecSize = successfulClips.reduce((sum, clip) => 
          sum + (clip.spectrogram_base64?.length || 0), 0);

        addPerformance('total_http_operation', fetchTime + parseTime + processTime, {
          clipCount: clipDataArray.length,
          successfulClips: successfulClips.length,
          totalAudioSizeBytes: totalAudioSize,
          totalSpectrogramSizeBytes: totalSpecSize,
          averageTimePerClip: (fetchTime + parseTime + processTime) / clipDataArray.length,
          throughputClipsPerSecond: (clipDataArray.length / (fetchTime + parseTime + processTime)) * 1000,
          serverProcessingTime: result.processing_time,
          cacheHits: result.server_info?.cache_size || 0
        });

        addDebug('HTTP batch processing completed', {
          totalTime: `${(fetchTime + parseTime + processTime).toFixed(2)}ms`,
          serverTime: `${(result.processing_time * 1000).toFixed(2)}ms`,
          successfulClips: successfulClips.length,
          throughput: `${((clipDataArray.length / (fetchTime + parseTime + processTime)) * 1000).toFixed(1)} clips/sec`,
          cacheInfo: result.server_info
        });

        return processedClips;
      } else {
        throw new Error(result.error || 'HTTP batch processing failed');
      }

    } catch (err) {
      addDebug('ERROR in HTTP batch processing', { error: err.message });
      setError(`Failed to load clips via HTTP: ${err.message}`);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [serverUrl, checkServerHealth, addDebug, addPerformance]);

  const clearCache = useCallback(async () => {
    try {
      const response = await fetch(`${serverUrl}/cache`, { method: 'DELETE' });
      if (response.ok) {
        addDebug('Server cache cleared');
        return true;
      } else {
        throw new Error(`Failed to clear cache: ${response.status}`);
      }
    } catch (err) {
      addDebug('Failed to clear server cache', { error: err.message });
      return false;
    }
  }, [serverUrl, addDebug]);

  const getServerStats = useCallback(async () => {
    try {
      const response = await fetch(`${serverUrl}/stats`);
      if (response.ok) {
        const stats = await response.json();
        addDebug('Server stats retrieved', stats);
        return stats;
      } else {
        throw new Error(`Failed to get server stats: ${response.status}`);
      }
    } catch (err) {
      addDebug('Failed to get server stats', { error: err.message });
      return null;
    }
  }, [serverUrl, addDebug]);

  return {
    loadClipsBatch,
    loadSingleClip,
    isLoading,
    error,
    progress,
    debugInfo,
    performanceData,
    serverUrl,
    clearCache,
    getServerStats,
    checkServerHealth
  };
};

/**
 * HTTP Server Status Component
 */
export const HttpServerStatus = ({ serverUrl, onClearCache, onGetStats }) => {
  const [serverStatus, setServerStatus] = useState('unknown');
  const [serverStats, setServerStats] = useState(null);
  const { checkServerHealth } = useHttpAudioLoader(serverUrl);

  const checkStatus = async () => {
    const isHealthy = await checkServerHealth();
    setServerStatus(isHealthy ? 'healthy' : 'unhealthy');
  };

  const handleGetStats = async () => {
    if (onGetStats) {
      const stats = await onGetStats();
      setServerStats(stats);
    }
  };

  return (
    <div className="http-server-status">
      <div className="server-info">
        <span className="server-url">🌐 {serverUrl}</span>
        <span className={`server-status ${serverStatus}`}>
          {serverStatus === 'healthy' ? '✅' : serverStatus === 'unhealthy' ? '❌' : '❓'} 
          {serverStatus}
        </span>
      </div>
      <div className="server-controls">
        <button onClick={checkStatus} className="check-button">Check Status</button>
        <button onClick={handleGetStats} className="stats-button">Get Stats</button>
        <button onClick={onClearCache} className="clear-cache-button">Clear Cache</button>
      </div>
      {serverStats && (
        <div className="server-stats">
          <small>
            Cache: {serverStats.cache_size}/{serverStats.cache_max_size} | 
            Threads: {serverStats.executor_threads}
          </small>
        </div>
      )}
    </div>
  );
};