/**
 * Utility functions for classifier-guided listening with stratification bins
 */

/**
 * Get unique combinations of values from specified columns
 * @param {Array} data - Array of clip objects
 * @param {Array} columns - Array of column names to stratify by
 * @returns {Array} Array of unique combination objects
 */
export function getStratificationBins(data, columns) {
  if (!columns || columns.length === 0 || !data || data.length === 0) {
    return [];
  }

  const combinationsMap = new Map();

  data.forEach(clip => {
    // Create a key from the combination of column values
    const values = columns.map(col => {
      const value = clip[col];
      return value !== undefined && value !== null ? String(value) : 'null';
    });
    const key = values.join('|||'); // Use separator unlikely to appear in data

    if (!combinationsMap.has(key)) {
      // Store the combination with both key and individual values
      const combination = {};
      columns.forEach((col) => {
        combination[col] = clip[col];
      });
      combinationsMap.set(key, {
        key,
        values: combination,
        clips: []
      });
    }

    combinationsMap.get(key).clips.push(clip);
  });

  return Array.from(combinationsMap.values());
}

/**
 * Sort clips within a bin based on sort strategy
 * @param {Array} clips - Array of clips
 * @param {string} sortStrategy - 'original', 'score_desc', or 'random'
 * @param {string} scoreColumn - Column name for scores (if using score_desc)
 * @returns {Array} Sorted array of clips
 */
export function sortClipsInBin(clips, sortStrategy, scoreColumn = null) {
  if (!clips || clips.length === 0) {
    return [];
  }

  const clipsCopy = [...clips];

  switch (sortStrategy) {
    case 'score_desc':
      if (!scoreColumn) {
        console.warn('Score column not specified, using original order');
        return clipsCopy;
      }
      return clipsCopy.sort((a, b) => {
        const scoreA = parseFloat(a[scoreColumn]);
        const scoreB = parseFloat(b[scoreColumn]);

        // Handle NaN values - push them to the end
        if (isNaN(scoreA) && isNaN(scoreB)) return 0;
        if (isNaN(scoreA)) return 1;
        if (isNaN(scoreB)) return -1;

        return scoreB - scoreA; // Descending order
      });

    case 'random':
      // Fisher-Yates shuffle
      for (let i = clipsCopy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [clipsCopy[i], clipsCopy[j]] = [clipsCopy[j], clipsCopy[i]];
      }
      return clipsCopy;

    case 'original':
    default:
      return clipsCopy;
  }
}

/**
 * Create stratified bins with sorted and limited clips
 * @param {Array} data - Array of clip objects
 * @param {Object} config - Configuration object
 * @param {Array} config.stratificationColumns - Columns to stratify by
 * @param {string} config.sortStrategy - How to sort clips ('original', 'score_desc', 'random')
 * @param {string} config.scoreColumn - Column for sorting by score
 * @param {number} config.maxClipsPerBin - Maximum clips to include per bin
 * @returns {Array} Array of bin objects with sorted and limited clips
 */
export function createStratifiedBins(data, config) {
  const {
    stratificationColumns = [],
    sortStrategy = 'original',
    scoreColumn = null,
    maxClipsPerBin = 20
  } = config;

  // Get unique combinations
  const bins = getStratificationBins(data, stratificationColumns);

  // Sort and limit clips in each bin
  return bins.map(bin => {
    const sortedClips = sortClipsInBin(bin.clips, sortStrategy, scoreColumn);
    const limitedClips = sortedClips.slice(0, maxClipsPerBin);

    return {
      ...bin,
      clips: limitedClips,
      totalClips: bin.clips.length, // Keep track of original count
      displayedClips: limitedClips.length
    };
  });
}

/**
 * Check if a bin is complete based on completion strategy
 * @param {Array} clips - Clips in the bin
 * @param {string} reviewMode - 'binary' or 'multiclass'
 * @param {Object} completionConfig - Completion configuration
 * @returns {boolean} Whether the bin is complete
 */
export function isBinComplete(clips, reviewMode, completionConfig) {
  const { strategy, targetCount = 1, targetLabels = [] } = completionConfig;

  if (!clips || clips.length === 0) {
    return true; // Empty bin is considered complete
  }

  switch (strategy) {
    case 'all':
      // All clips must be annotated
      if (reviewMode === 'binary') {
        return clips.every(clip =>
          clip.annotation && clip.annotation !== ''
        );
      } else {
        // Multi-class: all must be marked complete
        return clips.every(clip =>
          clip.annotation_status === 'complete'
        );
      }

    case 'binary_yes_count':
      if (reviewMode !== 'binary') {
        console.warn('Binary completion strategy used with non-binary mode');
        return false;
      }

      const yesCount = clips.filter(clip => clip.annotation === 'yes').length;
      const allAnnotated = clips.every(clip =>
        clip.annotation && clip.annotation !== ''
      );

      // Complete if target reached OR all clips annotated
      return yesCount >= targetCount || allAnnotated;

    case 'multiclass_label_count':
      if (reviewMode !== 'multiclass') {
        console.warn('Multi-class completion strategy used with non-multiclass mode');
        return false;
      }

      // Count clips that are complete and have any of the target labels
      const matchingCount = clips.filter(clip => {
        if (clip.annotation_status !== 'complete') return false;

        const clipLabels = clip.labels ? clip.labels.split(',').map(l => l.trim()) : [];
        return targetLabels.some(target => clipLabels.includes(target));
      }).length;

      const allComplete = clips.every(clip =>
        clip.annotation_status === 'complete'
      );

      // Complete if target reached OR all clips complete
      return matchingCount >= targetCount || allComplete;

    default:
      console.warn(`Unknown completion strategy: ${strategy}`);
      return false;
  }
}

/**
 * Get available columns from data (excluding standard columns)
 * @param {Array} data - Array of clip objects
 * @returns {Array} Array of column names
 */
export function getAvailableColumns(data) {
  if (!data || data.length === 0) {
    return [];
  }

  // Standard columns that shouldn't be used for stratification
  const excludedColumns = new Set([
    'id', 'file', 'start_time', 'end_time', 'annotation',
    'labels', 'annotation_status', 'comments',
    'spectrogram_base64', 'audio_base64', 'clip_id'
  ]);

  // Get all unique column names from the data
  const allColumns = new Set();
  data.forEach(clip => {
    Object.keys(clip).forEach(key => {
      if (!excludedColumns.has(key)) {
        allColumns.add(key);
      }
    });
  });

  return Array.from(allColumns).sort();
}

/**
 * Get columns that could be used as score columns (numeric columns)
 * @param {Array} data - Array of clip objects
 * @returns {Array} Array of column names that contain numeric values
 */
export function getNumericColumns(data) {
  if (!data || data.length === 0) {
    return [];
  }

  const availableColumns = getAvailableColumns(data);

  // Test each column to see if it contains numeric values
  return availableColumns.filter(col => {
    // Sample first few rows to check if column is numeric
    const sample = data.slice(0, Math.min(10, data.length));
    const numericCount = sample.filter(clip => {
      const value = clip[col];
      return value !== null && value !== undefined && !isNaN(parseFloat(value));
    }).length;

    // If more than half the samples are numeric, consider it a numeric column
    return numericCount > sample.length / 2;
  });
}
