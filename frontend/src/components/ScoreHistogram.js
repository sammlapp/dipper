import React, { useState, useMemo } from 'react';
import { Modal, Box, FormControl, Select, MenuItem, IconButton } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';

const NUM_BINS = 30;

function ScoreHistogram({ open, onClose, clips, reviewMode, annotationColumn }) {
  const [selectedScoreColumn, setSelectedScoreColumn] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [showGrey, setShowGrey] = useState(true);
  const [showRed, setShowRed] = useState(true);
  const [showYellow, setShowYellow] = useState(true);
  const [showGreen, setShowGreen] = useState(true);

  // Get numeric columns from clips
  const numericColumns = useMemo(() => {
    if (!clips || clips.length === 0) return [];

    const firstClip = clips[0];
    const columns = Object.keys(firstClip).filter(key => {
      const value = firstClip[key];
      return typeof value === 'number' || (!isNaN(parseFloat(value)) && isFinite(value));
    });

    return columns;
  }, [clips]);

  // Get available classes for multiclass mode
  const availableClasses = useMemo(() => {
    if (reviewMode !== 'multiclass' || !clips || clips.length === 0) return [];

    const classSet = new Set();
    clips.forEach(clip => {
      if (clip.labels) {
        const labels = typeof clip.labels === 'string' ? JSON.parse(clip.labels) : clip.labels;
        if (Array.isArray(labels)) {
          labels.forEach(label => classSet.add(label));
        }
      }
    });

    return Array.from(classSet).sort();
  }, [clips, reviewMode]);

  // Initialize selections
  React.useEffect(() => {
    if (numericColumns.length > 0 && !selectedScoreColumn) {
      setSelectedScoreColumn(numericColumns[0]);
    }
  }, [numericColumns, selectedScoreColumn]);

  React.useEffect(() => {
    if (availableClasses.length > 0 && !selectedClass) {
      setSelectedClass(availableClasses[0]);
    }
  }, [availableClasses, selectedClass]);

  // Calculate histogram data
  const histogramData = useMemo(() => {
    if (!clips || clips.length === 0 || !selectedScoreColumn) {
      return null;
    }

    // Get score values
    const scores = clips
      .map(clip => parseFloat(clip[selectedScoreColumn]))
      .filter(score => !isNaN(score) && isFinite(score));

    if (scores.length === 0) return null;

    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const binWidth = (maxScore - minScore) / NUM_BINS;

    // Create bins
    const bins = Array.from({ length: NUM_BINS }, (_, i) => ({
      start: minScore + i * binWidth,
      end: minScore + (i + 1) * binWidth,
      grey: 0,
      red: 0,
      yellow: 0,
      green: 0
    }));

    // Fill bins based on mode
    clips.forEach(clip => {
      const score = parseFloat(clip[selectedScoreColumn]);
      if (isNaN(score) || !isFinite(score)) return;

      // Find bin index with proper bounds checking
      let binIndex;
      if (binWidth === 0) {
        // All scores are the same
        binIndex = 0;
      } else {
        binIndex = Math.floor((score - minScore) / binWidth);
        // Clamp to valid range
        if (binIndex >= NUM_BINS) binIndex = NUM_BINS - 1;
        if (binIndex < 0) binIndex = 0;
      }

      if (reviewMode === 'binary') {
        const annotation = clip[annotationColumn] || '';

        if (annotation === '') {
          bins[binIndex].grey++;
        } else if (annotation === 'no') {
          bins[binIndex].red++;
        } else if (annotation === 'uncertain') {
          bins[binIndex].yellow++;
        } else if (annotation === 'yes') {
          bins[binIndex].green++;
        }
      } else {
        // Multiclass mode
        const annotationStatus = clip.annotation_status || 'unreviewed';

        if (annotationStatus === 'unreviewed') {
          bins[binIndex].grey++;
        } else if (annotationStatus === 'uncertain') {
          bins[binIndex].yellow++;
        } else if (annotationStatus === 'complete') {
          // Check if class is present
          const labels = clip.labels ? (typeof clip.labels === 'string' ? JSON.parse(clip.labels) : clip.labels) : [];
          const hasClass = Array.isArray(labels) && labels.includes(selectedClass);

          if (hasClass) {
            bins[binIndex].green++;
          } else {
            bins[binIndex].red++;
          }
        }
      }
    });

    return {
      bins,
      minScore,
      maxScore,
      binWidth
    };
  }, [clips, selectedScoreColumn, selectedClass, reviewMode, annotationColumn]);

  // Calculate max count based on visible components only
  const maxCount = useMemo(() => {
    if (!histogramData) return 0;

    const { bins } = histogramData;

    return Math.max(
      ...bins.map(bin => {
        const visibleCounts = [];
        if (showGrey) visibleCounts.push(bin.grey);
        if (showRed) visibleCounts.push(bin.red);
        if (showYellow) visibleCounts.push(bin.yellow);
        if (showGreen) visibleCounts.push(bin.green);
        return visibleCounts.length > 0 ? Math.max(...visibleCounts) : 0;
      })
    );
  }, [histogramData, showGrey, showRed, showYellow, showGreen]);

  if (!histogramData) {
    return (
      <Modal open={open} onClose={onClose}>
        <Box sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '80%',
          maxWidth: 900,
          bgcolor: 'background.paper',
          boxShadow: 24,
          p: 3,
          borderRadius: 1,
          maxHeight: '90vh',
          overflow: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ margin: 0, fontFamily: 'Rokkitt, sans-serif' }}>Score Histogram</h3>
            <IconButton onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </div>
          <p>No valid numeric data available for histogram.</p>
        </Box>
      </Modal>
    );
  }

  const { bins, minScore, maxScore } = histogramData;

  // SVG dimensions
  const width = 800;
  const height = 400;
  const margin = { top: 20, right: 20, bottom: 60, left: 60 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '80%',
        maxWidth: 900,
        bgcolor: 'background.paper',
        boxShadow: 24,
        p: 3,
        borderRadius: 1,
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontFamily: 'Rokkitt, sans-serif' }}>Score Histogram</h3>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <label style={{ marginBottom: '5px', fontSize: '0.9rem' }}>Score Column</label>
            <Select
              value={selectedScoreColumn}
              onChange={(e) => setSelectedScoreColumn(e.target.value)}
            >
              {numericColumns.map(col => (
                <MenuItem key={col} value={col}>{col}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {reviewMode === 'multiclass' && (
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <label style={{ marginBottom: '5px', fontSize: '0.9rem' }}>Class</label>
              <Select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
              >
                {availableClasses.map(cls => (
                  <MenuItem key={cls} value={cls}>{cls}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </div>

        {/* Legend with checkboxes */}
        <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', fontSize: '0.9rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showGrey}
              onChange={(e) => setShowGrey(e.target.checked)}
            />
            <div style={{ width: 20, height: 3, backgroundColor: '#9ca3af', border: '1px solid #9ca3af' }}></div>
            <span>
              {reviewMode === 'binary' ? 'Unlabeled' : 'Unreviewed'}
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showYellow}
              onChange={(e) => setShowYellow(e.target.checked)}
            />
            <div style={{ width: 20, height: 3, backgroundColor: '#fbbf24', border: '1px solid #fbbf24' }}></div>
            <span>Uncertain</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showGreen}
              onChange={(e) => setShowGreen(e.target.checked)}
            />
            <div style={{ width: 20, height: 3, backgroundColor: '#10b981', border: '1px solid #10b981' }}></div>
            <span>
              {reviewMode === 'binary' ? 'Yes' : `Has ${selectedClass}`}
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showRed}
              onChange={(e) => setShowRed(e.target.checked)}
            />
            <div style={{ width: 20, height: 3, backgroundColor: '#ef4444', border: '1px solid #ef4444' }}></div>
            <span>
              {reviewMode === 'binary' ? 'No' : `No ${selectedClass}`}
            </span>
          </label>
        </div>

        {/* Histogram SVG */}
        <svg width={width} height={height} style={{ border: '1px solid #e5e7eb', borderRadius: '4px' }}>
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {/* Y-axis */}
            <line x1={0} y1={0} x2={0} y2={chartHeight} stroke="#374151" strokeWidth={2} />

            {/* X-axis */}
            <line x1={0} y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="#374151" strokeWidth={2} />

            {/* Y-axis ticks and labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac, i) => {
              const y = chartHeight - frac * chartHeight;
              const count = Math.round(frac * maxCount);
              return (
                <g key={i}>
                  <line x1={-5} y1={y} x2={0} y2={y} stroke="#374151" strokeWidth={1} />
                  <text x={-10} y={y + 4} textAnchor="end" fontSize={12} fill="#374151">
                    {count}
                  </text>
                </g>
              );
            })}

            {/* Y-axis label */}
            <text
              x={-40}
              y={chartHeight / 2}
              textAnchor="middle"
              fontSize={14}
              fill="#374151"
              transform={`rotate(-90, -40, ${chartHeight / 2})`}
            >
              Count
            </text>

            {/* X-axis ticks and labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac, i) => {
              const x = frac * chartWidth;
              const value = (minScore + frac * (maxScore - minScore)).toFixed(2);
              return (
                <g key={i}>
                  <line x1={x} y1={chartHeight} x2={x} y2={chartHeight + 5} stroke="#374151" strokeWidth={1} />
                  <text x={x} y={chartHeight + 20} textAnchor="middle" fontSize={12} fill="#374151">
                    {value}
                  </text>
                </g>
              );
            })}

            {/* X-axis label */}
            <text
              x={chartWidth / 2}
              y={chartHeight + 45}
              textAnchor="middle"
              fontSize={14}
              fill="#374151"
            >
              {selectedScoreColumn}
            </text>

            {/* Histogram bars - draw as outlines only */}
            {bins.map((bin, i) => {
              const x = (i / NUM_BINS) * chartWidth;
              const barWidth = chartWidth / NUM_BINS;

              // Draw each category as outline - filter by visibility
              const categories = [
                { count: bin.grey, color: '#9ca3af', visible: showGrey },
                { count: bin.yellow, color: '#fbbf24', visible: showYellow },
                { count: bin.green, color: '#10b981', visible: showGreen },
                { count: bin.red, color: '#ef4444', visible: showRed }
              ];

              return (
                <g key={i}>
                  {categories.map((cat, catIdx) => {
                    if (cat.count === 0 || !cat.visible) return null;
                    const barHeight = (cat.count / maxCount) * chartHeight;
                    const y = chartHeight - barHeight;

                    return (
                      <rect
                        key={catIdx}
                        x={x}
                        y={y}
                        width={barWidth - 1}
                        height={barHeight}
                        fill="none"
                        stroke={cat.color}
                        strokeWidth={2}
                      />
                    );
                  })}
                </g>
              );
            })}
          </g>
        </svg>
      </Box>
    </Modal>
  );
}

export default ScoreHistogram;
