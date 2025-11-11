import React from 'react';
import Select from 'react-select';

function ClassifierGuidedPanel({
  config,
  onConfigChange,
  availableColumns,
  numericColumns,
  availableClasses,
  reviewMode,
  currentBinIndex,
  totalBins,
  currentBinInfo
}) {
  const handleToggleEnabled = (enabled) => {
    onConfigChange({ ...config, enabled });
  };

  const handleStratificationColumnsChange = (selectedOptions) => {
    const columns = selectedOptions ? selectedOptions.map(opt => opt.value) : [];
    onConfigChange({ ...config, stratificationColumns: columns });
  };

  const handleScoreColumnChange = (selectedOption) => {
    onConfigChange({ ...config, scoreColumn: selectedOption ? selectedOption.value : null });
  };

  const handleSortStrategyChange = (strategy) => {
    onConfigChange({ ...config, sortStrategy: strategy });
  };

  const handleMaxClipsChange = (value) => {
    const num = parseInt(value);
    if (!isNaN(num) && num > 0) {
      onConfigChange({ ...config, maxClipsPerBin: num });
    }
  };

  const handleCompletionStrategyChange = (strategy) => {
    onConfigChange({ ...config, completionStrategy: strategy });
  };

  const handleTargetCountChange = (value) => {
    const num = parseInt(value);
    if (!isNaN(num) && num > 0) {
      onConfigChange({ ...config, completionTargetCount: num });
    }
  };

  const handleTargetLabelsChange = (selectedOptions) => {
    const labels = selectedOptions ? selectedOptions.map(opt => opt.value) : [];
    onConfigChange({ ...config, completionTargetLabels: labels });
  };

  // Convert columns to react-select format
  const columnOptions = availableColumns.map(col => ({ value: col, label: col }));
  const numericColumnOptions = numericColumns.map(col => ({ value: col, label: col }));
  const classOptions = availableClasses.map(cls => ({ value: cls, label: cls }));

  const selectedStratColumns = config.stratificationColumns.map(col => ({
    value: col,
    label: col
  }));

  const selectedScoreColumn = config.scoreColumn ? { value: config.scoreColumn, label: config.scoreColumn } : null;

  const selectedTargetLabels = config.completionTargetLabels.map(lbl => ({
    value: lbl,
    label: lbl
  }));

  return (
    <div className="classifier-guided-panel">
      <div className="panel-section">
        <h4>Enable Classifier-Guided Listening</h4>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => handleToggleEnabled(e.target.checked)}
          />
          <span>Enable Mode</span>
        </label>
        <p className="help-text">
          Organize clips into stratification bins based on metadata columns.
          Display one bin per page with auto-advance when completion criteria are met.
        </p>
      </div>

      {config.enabled && (
        <>
          <div className="panel-section">
            <h4>Stratification Columns</h4>
            <p className="help-text">
              Select columns to create unique bins. Each unique combination will be one bin/page.
            </p>
            <Select
              isMulti
              options={columnOptions}
              value={selectedStratColumns}
              onChange={handleStratificationColumnsChange}
              placeholder="Select columns..."
              className="react-select-container"
              classNamePrefix="react-select"
            />
            {config.stratificationColumns.length === 0 && (
              <p className="warning-text">⚠️ Please select at least one column</p>
            )}
          </div>

          <div className="panel-section">
            <h4>Bin Completion Strategy</h4>
            <div className="completion-options">
              <label className="radio-label">
                <input
                  type="radio"
                  name="completionStrategy"
                  value="all"
                  checked={config.completionStrategy === 'all'}
                  onChange={(e) => handleCompletionStrategyChange(e.target.value)}
                />
                <span>All - Annotate all clips in bin</span>
              </label>

              {reviewMode === 'binary' && (
                <label className="radio-label">
                  <input
                    type="radio"
                    name="completionStrategy"
                    value="binary_yes_count"
                    checked={config.completionStrategy === 'binary_yes_count'}
                    onChange={(e) => handleCompletionStrategyChange(e.target.value)}
                  />
                  <span>Binary - Stop after N "yes" labels</span>
                </label>
              )}

              {reviewMode === 'multiclass' && (
                <label className="radio-label">
                  <input
                    type="radio"
                    name="completionStrategy"
                    value="multiclass_label_count"
                    checked={config.completionStrategy === 'multiclass_label_count'}
                    onChange={(e) => handleCompletionStrategyChange(e.target.value)}
                  />
                  <span>Multi-class - Stop after N target labels</span>
                </label>
              )}
            </div>

            {config.completionStrategy === 'binary_yes_count' && reviewMode === 'binary' && (
              <div className="target-config">
                <label>Target "Yes" count:</label>
                <input
                  type="number"
                  value={config.completionTargetCount}
                  onChange={(e) => handleTargetCountChange(e.target.value)}
                  min="1"
                  className="number-input"
                />
                <p className="help-text">
                  Bin completes when this many clips are labeled "yes", or all clips are annotated
                </p>
              </div>
            )}

            {config.completionStrategy === 'multiclass_label_count' && reviewMode === 'multiclass' && (
              <div className="target-config">
                <label>Target Labels:</label>
                <Select
                  isMulti
                  options={classOptions}
                  value={selectedTargetLabels}
                  onChange={handleTargetLabelsChange}
                  placeholder="Select target labels..."
                  className="react-select-container"
                  classNamePrefix="react-select"
                />
                <label>Target count:</label>
                <input
                  type="number"
                  value={config.completionTargetCount}
                  onChange={(e) => handleTargetCountChange(e.target.value)}
                  min="1"
                  className="number-input"
                />
                <p className="help-text">
                  Bin completes when this many clips with target labels are marked "complete", or all clips are complete
                </p>
              </div>
            )}
          </div>
          
          <div className="panel-section">
            <h4>Clip Sorting</h4>
            <div className="sort-options">
              <label className="radio-label">
                <input
                  type="radio"
                  name="sortStrategy"
                  value="original"
                  checked={config.sortStrategy === 'original'}
                  onChange={(e) => handleSortStrategyChange(e.target.value)}
                />
                <span>Original order</span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="sortStrategy"
                  value="score_desc"
                  checked={config.sortStrategy === 'score_desc'}
                  onChange={(e) => handleSortStrategyChange(e.target.value)}
                />
                <span>Highest to lowest score</span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="sortStrategy"
                  value="random"
                  checked={config.sortStrategy === 'random'}
                  onChange={(e) => handleSortStrategyChange(e.target.value)}
                />
                <span>Random order</span>
              </label>
            </div>

            {config.sortStrategy === 'score_desc' && (
              <div className="score-column-select">
                <label>Score Column:</label>
                <Select
                  options={numericColumnOptions}
                  value={selectedScoreColumn}
                  onChange={handleScoreColumnChange}
                  placeholder="Select score column..."
                  isClearable
                  className="react-select-container"
                  classNamePrefix="react-select"
                />
                {!config.scoreColumn && (
                  <p className="warning-text">⚠️ Please select a score column</p>
                )}
              </div>
            )}
          </div>

          <div className="panel-section">
            <h4>Max Clips Per Bin</h4>
            <input
              type="number"
              value={config.maxClipsPerBin}
              onChange={(e) => handleMaxClipsChange(e.target.value)}
              min="1"
              className="number-input"
            />
            <p className="help-text">Maximum number of clips to display per bin (default: 20)</p>
          </div>


        </>
      )}
    </div>
  );
}

export default ClassifierGuidedPanel;
