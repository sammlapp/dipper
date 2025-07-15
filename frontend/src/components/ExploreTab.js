import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import SpeciesMultiSelect from './SpeciesMultiSelect';
import AudioClipCard from './AudioClipCard';
import DisplaySettings from './DisplaySettings';

function ExploreTab() {
  const [scoreData, setScoreData] = useState(null);
  const [selectedFile, setSelectedFile] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detectionSummary, setDetectionSummary] = useState(null);
  const [scoreThreshold, setScoreThreshold] = useState(0.1);
  const [selectedSpecies, setSelectedSpecies] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [detectionMetric, setDetectionMetric] = useState('count'); // 'count' or 'rate'
  const [selectedClips, setSelectedClips] = useState({}); // For histogram bin selections
  const [displaySettings, setDisplaySettings] = useState(null);
  const [isThresholdDragging, setIsThresholdDragging] = useState(false);
  const [tempThreshold, setTempThreshold] = useState(0.1);
  const fileInputRef = useRef(null);
  const thresholdTimeoutRef = useRef(null);
  
  const SPECIES_PER_PAGE = 6;

  // Load persisted state on mount
  useEffect(() => {
    const savedState = localStorage.getItem('explore_tab_state');
    if (savedState) {
      try {
        const state = JSON.parse(savedState);
        if (state.selectedFile) setSelectedFile(state.selectedFile);
        if (state.scoreThreshold) setScoreThreshold(state.scoreThreshold);
        if (state.detectionMetric) setDetectionMetric(state.detectionMetric);
        if (state.currentPage) setCurrentPage(state.currentPage);
      } catch (e) {
        console.warn('Failed to load saved state:', e);
      }
    }
  }, []);

  // Save state when it changes
  const saveState = useCallback(() => {
    const state = {
      selectedFile,
      scoreThreshold,
      detectionMetric,
      currentPage,
      selectedSpecies: selectedSpecies.slice(0, 50) // Limit to avoid localStorage issues
    };
    localStorage.setItem('explore_tab_state', JSON.stringify(state));
  }, [selectedFile, scoreThreshold, detectionMetric, currentPage, selectedSpecies]);

  // Save state when relevant values change
  useEffect(() => {
    if (selectedFile || scoreData) {
      saveState();
    }
  }, [selectedFile, scoreThreshold, detectionMetric, currentPage, selectedSpecies, saveState]);

  const handleLoadCSV = async () => {
    try {
      if (!window.electronAPI) {
        // For browser testing, use file input
        fileInputRef.current?.click();
        return;
      }
      
      const files = await window.electronAPI.selectCSVFiles();
      if (files && files.length > 0) {
        setSelectedFile(files[0]);
        await loadAndProcessCSV(files[0]);
      }
    } catch (err) {
      setError('Failed to select file: ' + err.message);
    }
  };

  const handleFileInputChange = async (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file.name);
      await loadAndProcessCSVFromFile(file);
    }
  };

  const loadAndProcessCSVFromFile = async (file) => {
    setLoading(true);
    setError('');
    
    try {
      const text = await file.text();
      const data = parseCSV(text);
      processScoreData(data);
    } catch (err) {
      setError('Failed to parse CSV file: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadAndProcessCSV = async (filePath) => {
    setLoading(true);
    setError('');
    
    try {
      const processId = Date.now().toString();
      const result = await window.electronAPI.runPythonScript(
        'load_scores.py',
        [filePath],
        processId
      );
      
      const data = JSON.parse(result.stdout);
      if (data.error) {
        setError(data.error);
      } else {
        processScoreData(data);
      }
    } catch (err) {
      setError('Failed to load score data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const parseCSV = (csvText) => {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV file appears to be empty or invalid');
    }

    // Better CSV parsing - handle quoted fields and commas inside quotes
    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result.map(field => field.replace(/^"|"$/g, ''));
    };

    const headers = parseCSVLine(lines[0]);
    const dataLines = lines.slice(1);
    
    console.log('CSV Headers:', headers);
    
    // Find species columns (exclude common non-species columns)
    const excludeColumns = [
      'file', 'start_time', 'end_time', 'filename', 'path', 'clip_path',
      'index', 'id', 'timestamp', 'date', 'time', 'duration', 'sample_rate'
    ];
    
    const speciesColumns = headers.filter(h => 
      !excludeColumns.includes(h.toLowerCase()) && 
      !h.toLowerCase().includes('unnamed') &&
      h.trim() !== ''
    );
    
    console.log('Species columns found:', speciesColumns);
    
    if (speciesColumns.length === 0) {
      throw new Error(`No species columns found. Available columns: ${headers.join(', ')}`);
    }
    
    const scores = {};
    const fileInfo = [];
    
    // Initialize species arrays
    speciesColumns.forEach(species => {
      scores[species] = [];
    });
    
    // Parse data rows
    dataLines.forEach((line, index) => {
      if (!line.trim()) return; // Skip empty lines
      
      const values = parseCSVLine(line);
      
      if (values.length !== headers.length) {
        console.warn(`Row ${index + 2} has ${values.length} values but expected ${headers.length}`);
        return;
      }
      
      const rowData = {};
      headers.forEach((header, i) => {
        rowData[header] = values[i];
      });
      
      // Extract file info
      fileInfo.push({
        file: rowData.file || rowData.filename || rowData.path || `file_${index}`,
        start_time: parseFloat(rowData.start_time) || 0,
        end_time: parseFloat(rowData.end_time) || 0
      });
      
      // Extract scores
      speciesColumns.forEach(species => {
        const score = parseFloat(rowData[species]);
        if (!isNaN(score)) {
          scores[species].push(score);
        } else {
          scores[species].push(0);
        }
      });
    });
    
    // Calculate min/max scores
    const allScores = Object.values(scores).flat();
    const minScore = Math.min(...allScores);
    const maxScore = Math.max(...allScores);
    
    return {
      scores,
      file_info: fileInfo,
      min_score: minScore,
      max_score: maxScore,
      shape: [dataLines.length, speciesColumns.length]
    };
  };

  const processScoreData = (data) => {
    console.log('DEBUG: Processing score data', data);
    setScoreData(data);
    
    // Calculate detection counts for all species to find top 6
    const speciesDetectionCounts = Object.entries(data.scores).map(([species, scores]) => {
      const detections = scores.filter(score => score >= scoreThreshold).length;
      return { species, detections };
    });
    
    // Sort by detection count and take top 6 as default
    const topSpecies = speciesDetectionCounts
      .sort((a, b) => b.detections - a.detections)
      .slice(0, 6)
      .map(item => item.species);
    
    console.log('DEBUG: Top species selected', topSpecies);
    console.log('DEBUG: Species detection counts', speciesDetectionCounts);
    
    setSelectedSpecies(topSpecies);
    setCurrentPage(0); // Reset to first page when new data is loaded
    generateDetectionSummary(data);
  };

  // Memoized filtered species list based on selection
  const filteredSpecies = useMemo(() => {
    if (!scoreData || selectedSpecies.length === 0) {
      console.log('DEBUG: No filtered species - missing data or no selection', {
        hasScoreData: !!scoreData,
        selectedSpeciesLength: selectedSpecies.length
      });
      return [];
    }
    const filtered = selectedSpecies.filter(species => 
      scoreData.scores[species] && scoreData.scores[species].length > 0
    );
    console.log('DEBUG: Filtered species', {
      selectedSpecies,
      filtered,
      availableScoreKeys: Object.keys(scoreData.scores || {})
    });
    return filtered;
  }, [scoreData, selectedSpecies]);

  // Memoized paginated species
  const paginatedSpecies = useMemo(() => {
    const start = currentPage * SPECIES_PER_PAGE;
    const end = start + SPECIES_PER_PAGE;
    const paginated = filteredSpecies.slice(start, end);
    console.log('DEBUG: Pagination data', {
      filteredSpecies: filteredSpecies.length,
      selectedSpecies: selectedSpecies.length,
      currentPage,
      start,
      end,
      paginated: paginated.length,
      paginatedList: paginated
    });
    return paginated;
  }, [filteredSpecies, currentPage, selectedSpecies]);

  // Total pages calculation
  const totalPages = Math.ceil(filteredSpecies.length / SPECIES_PER_PAGE);

  const generateDetectionSummary = (data) => {
    const summary = {};
    
    Object.entries(data.scores).forEach(([species, scores]) => {
      const detections = scores.filter(score => score >= scoreThreshold);
      const maxScore = Math.max(...scores);
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      
      summary[species] = {
        totalClips: scores.length,
        detections: detections.length,
        detectionRate: (detections.length / scores.length * 100).toFixed(1),
        maxScore: maxScore.toFixed(3),
        avgScore: avgScore.toFixed(3),
        scores: scores
      };
    });
    
    // Sort by detection count
    const sortedSummary = Object.entries(summary)
      .sort(([,a], [,b]) => b.detections - a.detections)
      .reduce((obj, [species, data]) => {
        obj[species] = data;
        return obj;
      }, {});
    
    setDetectionSummary(sortedSummary);
  };

  const createBarChart = () => {
    if (!detectionSummary) return null;
    
    // Filter by selected species and get top 10
    const species = filteredSpecies
      .filter(s => detectionSummary[s])
      .sort((a, b) => {
        const aValue = detectionMetric === 'count' ? 
          detectionSummary[b].detections : parseFloat(detectionSummary[b].detectionRate);
        const bValue = detectionMetric === 'count' ? 
          detectionSummary[a].detections : parseFloat(detectionSummary[a].detectionRate);
        return aValue - bValue;
      })
      .slice(0, 10);
    
    const maxValue = Math.max(...species.map(s => {
      const data = detectionSummary[s];
      return detectionMetric === 'count' ? data.detections : parseFloat(data.detectionRate);
    }));
    
    return (
      <div className="chart-container">
        <h4>Top Species {detectionMetric === 'count' ? 'Detections' : 'Detection Rates'} (Threshold: {scoreThreshold})</h4>
        
        <div className="detection-toggle">
          <button
            className={`toggle-option ${detectionMetric === 'count' ? 'active' : ''}`}
            onClick={() => setDetectionMetric('count')}
          >
            Count
          </button>
          <button
            className={`toggle-option ${detectionMetric === 'rate' ? 'active' : ''}`}
            onClick={() => setDetectionMetric('rate')}
          >
            Rate (%)
          </button>
        </div>
        
        <div className="bar-chart">
          {species.map(speciesName => {
            const data = detectionSummary[speciesName];
            const value = detectionMetric === 'count' ? data.detections : parseFloat(data.detectionRate);
            const width = (value / maxValue) * 100;
            
            return (
              <div key={speciesName} className="bar-row">
                <div className="bar-label">{speciesName}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ width: `${width}%` }}
                    title={`${data.detections} detections (${data.detectionRate}%)`}
                  >
                    <span className="bar-text">
                      {detectionMetric === 'count' ? data.detections : `${data.detectionRate}%`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const createHistogram = (speciesName) => {
    if (!scoreData || !scoreData.scores[speciesName]) return null;
    
    const scores = scoreData.scores[speciesName];
    const bins = 20;
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const binSize = (maxScore - minScore) / bins;
    
    const histogram = Array(bins).fill(0);
    const binClips = Array(bins).fill().map(() => []); // Store clip indices for each bin
    
    scores.forEach((score, clipIndex) => {
      const binIndex = Math.min(Math.floor((score - minScore) / binSize), bins - 1);
      histogram[binIndex]++;
      binClips[binIndex].push(clipIndex);
    });
    
    const maxCount = Math.max(...histogram);
    
    const handleBinClick = (binIndex) => {
      const binClipIndices = binClips[binIndex];
      if (binClipIndices.length === 0) return;
      
      // Select a random clip from this bin
      const randomIndex = Math.floor(Math.random() * binClipIndices.length);
      const clipIndex = binClipIndices[randomIndex];
      
      // Create clip data from the file info and scores
      const clipData = {
        file_path: scoreData.file_info[clipIndex]?.file || 'Unknown',
        start_time: scoreData.file_info[clipIndex]?.start_time || 0,
        end_time: scoreData.file_info[clipIndex]?.end_time || 0,
        species: speciesName,
        score: scores[clipIndex]
      };
      
      setSelectedClips(prev => ({
        ...prev,
        [speciesName]: clipData
      }));
    };

    const getHighestScoringClip = () => {
      const maxIndex = scores.findIndex(score => score === Math.max(...scores));
      return {
        file_path: scoreData.file_info[maxIndex]?.file || 'Unknown',
        start_time: scoreData.file_info[maxIndex]?.start_time || 0,
        end_time: scoreData.file_info[maxIndex]?.end_time || 0,
        species: speciesName,
        score: scores[maxIndex]
      };
    };
    
    return (
      <div className="histogram-container">
        <h4>Score Distribution: {speciesName}</h4>
        <div className="histogram">
          {histogram.map((count, index) => {
            const binStart = minScore + index * binSize;
            const binEnd = binStart + binSize;
            const height = (count / maxCount) * 100;
            
            return (
              <div 
                key={index} 
                className="histogram-bar clickable"
                style={{ height: `${height}%` }}
                title={`${binStart.toFixed(2)} - ${binEnd.toFixed(2)}: ${count} clips\nClick to view random clip`}
                onClick={() => handleBinClick(index)}
              />
            );
          })}
        </div>
        <div className="histogram-labels">
          <span>{minScore.toFixed(2)}</span>
          <span>{maxScore.toFixed(2)}</span>
        </div>
        
        {/* Display selected clip or highest scoring clip */}
        <div className="histogram-clip">
          <AudioClipCard 
            key={`${speciesName}-${selectedClips[speciesName]?.score || 'highest'}`}
            clipData={selectedClips[speciesName] || getHighestScoringClip()}
            className="compact"
            autoLoadSpectrogram={true}
          />
          <div className="clip-info-text">
            {selectedClips[speciesName] 
              ? "Random clip from selected score range" 
              : "Highest scoring clip (click histogram bars for random clips)"}
          </div>
          {detectionSummary && detectionSummary[speciesName] && (
            <div className="detection-count-badge">
              {detectionSummary[speciesName].detections} detections
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="tab-content">
      <h2>Explore Detection Results</h2>
      
      <div className="section">
        <h3>Load Detection Results</h3>
        <div className="button-group">
          <button onClick={handleLoadCSV} disabled={loading}>
            {loading ? 'Loading...' : 'Load CSV File'}
          </button>
          {selectedFile && (
            <span className="selected-file">
              Loaded: {selectedFile.split('/').pop()}
            </span>
          )}
        </div>
        
        {/* Hidden file input for browser mode */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
        />
        
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}
      </div>

      {scoreData && (
        <>
          <div className="section">
            <h3>Dataset Overview</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{scoreData.shape[0]}</div>
                <div className="stat-label">Total Clips</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{Object.keys(scoreData.scores).length}</div>
                <div className="stat-label">Total Species</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{selectedSpecies.length}</div>
                <div className="stat-label">Selected Species</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{scoreData.min_score.toFixed(3)}</div>
                <div className="stat-label">Min Score</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{scoreData.max_score.toFixed(3)}</div>
                <div className="stat-label">Max Score</div>
              </div>
            </div>
            
            {detectionSummary && (
              <div className="top-species-overview">
                <h4>Top 10 Most Detected Species</h4>
                <div className="top-species-list">
                  {Object.entries(detectionSummary)
                    .sort(([,a], [,b]) => b.detections - a.detections)
                    .slice(0, 10)
                    .map(([species, data], index) => (
                      <div key={species} className="top-species-item">
                        <span className="species-rank">#{index + 1}</span>
                        <span className="species-name">{species}</span>
                        <span className="species-count">{data.detections}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}
          </div>

          <div className="section">
            <SpeciesMultiSelect
              availableSpecies={Object.keys(scoreData.scores)}
              selectedSpecies={selectedSpecies}
              onSelectionChange={setSelectedSpecies}
              placeholder="Select species to display..."
            />
          </div>

          <DisplaySettings onSettingsChange={setDisplaySettings} />

          <div className="section">
            <h3>Detection Threshold</h3>
            <div className="threshold-controls">
              <label>
                Score Threshold: {isThresholdDragging ? tempThreshold : scoreThreshold}
                <input
                  type="range"
                  min={scoreData.min_score}
                  max={scoreData.max_score}
                  step="0.01"
                  value={isThresholdDragging ? tempThreshold : scoreThreshold}
                  onMouseDown={() => setIsThresholdDragging(true)}
                  onMouseUp={() => {
                    setIsThresholdDragging(false);
                    setScoreThreshold(tempThreshold);
                    // Clear any pending timeout
                    if (thresholdTimeoutRef.current) {
                      clearTimeout(thresholdTimeoutRef.current);
                    }
                    // Update after a short delay to allow slider to finish
                    thresholdTimeoutRef.current = setTimeout(() => {
                      generateDetectionSummary(scoreData);
                    }, 100);
                  }}
                  onChange={(e) => {
                    const newThreshold = parseFloat(e.target.value);
                    if (isThresholdDragging) {
                      setTempThreshold(newThreshold);
                    } else {
                      setScoreThreshold(newThreshold);
                      // Debounce the summary generation
                      if (thresholdTimeoutRef.current) {
                        clearTimeout(thresholdTimeoutRef.current);
                      }
                      thresholdTimeoutRef.current = setTimeout(() => {
                        generateDetectionSummary(scoreData);
                      }, 300);
                    }
                  }}
                  className="threshold-slider"
                />
              </label>
            </div>
          </div>

          <div className="section">
            {createBarChart()}
          </div>

          {detectionSummary && filteredSpecies.length > 0 && (
            <div className="histograms-section">
              <h3>Score Distributions and Clips</h3>
              <p>Showing {paginatedSpecies.length} of {filteredSpecies.length} selected species. Click histogram bars to hear random clips from that score range.</p>
              
              {paginatedSpecies.length === 0 && (
                <div className="debug-info" style={{backgroundColor: '#ffe6e6', padding: '10px', margin: '10px 0'}}>
                  <strong>DEBUG: No species to display on current page</strong>
                  <br />Current page: {currentPage}, Total pages: {totalPages}
                  <br />Filtered species: {filteredSpecies.join(', ')}
                  <br />Selected species: {selectedSpecies.join(', ')}
                  <button onClick={() => setCurrentPage(0)} style={{marginTop: '5px'}}>
                    Reset to page 1
                  </button>
                </div>
              )}
              
              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="pagination-container">
                  <button
                    className="pagination-button"
                    onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                    disabled={currentPage === 0}
                  >
                    Previous
                  </button>
                  
                  <span className="pagination-info">
                    Page {currentPage + 1} of {totalPages}
                  </span>
                  
                  <button
                    className="pagination-button"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
                    disabled={currentPage === totalPages - 1}
                  >
                    Next
                  </button>
                </div>
              )}
              
              <div className="histograms-grid">
                {paginatedSpecies.map(species => (
                  <div key={species} className="section">
                    {createHistogram(species)}
                  </div>
                ))}
              </div>
              
              {/* Bottom pagination */}
              {totalPages > 1 && (
                <div className="pagination-container">
                  <button
                    className="pagination-button"
                    onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                    disabled={currentPage === 0}
                  >
                    Previous
                  </button>
                  
                  <span className="pagination-info">
                    Page {currentPage + 1} of {totalPages}
                  </span>
                  
                  <button
                    className="pagination-button"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
                    disabled={currentPage === totalPages - 1}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ExploreTab;