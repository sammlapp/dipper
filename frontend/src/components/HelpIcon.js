import { useState, useRef } from 'react';

const HELP_TOOLTIPS = {
  // Inference
  'inference-file-selection': 'Select audio files, a folder, glob patterns, or a file list to process.',
  'inference-output': 'Directory where prediction CSVs, config, and logs will be saved.',
  'inference-model-source': 'Choose a pre-trained model from the model zoo or load a local file.',
  'inference-models': 'Select the detection model (BirdNET, Perch, HawkEars, etc.).',
  'inference-local-model': 'Path to a locally saved .pt model file.',
  'inference-overlap': 'How much consecutive analysis windows overlap (0 = none). Increases detection near window edges.',
  'inference-batch-size': 'Audio segments processed at once. Use 1 for CPU; 256–1024 for GPU.',
  'inference-workers': 'Parallel CPU threads for data loading. 0 is safest; 4–8 is good for most machines.',
  'inference-sparse-outputs': 'Only save clips that exceed the score threshold, reducing output file size.',
  'inference-sparse-threshold': 'Minimum confidence score to include in sparse output.',
  'inference-python-env': 'Use a custom conda/Python environment instead of the bundled one.',
  'inference-testing-mode': 'Run on a small subset to verify configuration before full processing.',
  'inference-tasks': 'Create a task to queue it, or Create and Run to start immediately.',
  'inference-subfolder-split': 'Create separate output files per subfolder in the audio directory.',

  // Training
  'training-mode': 'Choose between fine-tuning a pre-trained model or training from scratch.',
  'training-model-source': 'Use a model from the zoo or load a locally saved model file.',
  'training-model-selection': 'Pre-trained base model whose feature extractor will be reused.',
  'training-local-model': 'Path to a locally saved .pt model to continue training from.',
  'training-cnn-architecture': 'CNN backbone architecture when training from scratch.',
  'training-clip-duration': 'Duration (seconds) of each audio clip fed to the model.',
  'training-sample-rate': 'Audio sample rate in Hz used during training.',
  'training-spec-window': 'STFT window size (samples) for spectrogram generation.',
  'training-low-freq': 'Low-pass frequency cutoff for the spectrogram (Hz).',
  'training-high-freq': 'High-pass frequency cutoff for the spectrogram (Hz).',
  'training-fully-annotated': 'CSVs where every clip is labeled for all target classes (one-hot or list format).',
  'training-single-class': 'CSVs from binary review sessions (yes/no/uncertain) for a single species each.',
  'training-background': 'Optional CSV of noise/ambient segments used as explicit negatives during training.',
  'training-class-list': 'Target class names (comma or newline separated). Auto-detected from fully annotated files if left empty.',
  'training-root-folder': 'Base directory for resolving relative file paths in annotation CSVs.',
  'training-evaluation': 'Optional held-out dataset for unbiased evaluation. Uses 80/20 split if omitted.',
  'training-batch-size': 'Samples per training step. 128–512 for GPU; 32–64 for CPU.',
  'training-workers': 'Parallel data-loading processes. 2–4 is good for most systems.',
  'training-freeze': 'Keep pre-trained feature extractor weights fixed; only trains the classifier. Recommended for small datasets.',
  'training-augmentation-variants': 'Augmented copies created per sample when feature extractor is frozen. More variants help small datasets.',
  'training-feature-extractor-lr': 'Learning rate for the feature extractor when unfrozen. Keep very small (e.g. 0.00001).',
  'training-classifier-lr': 'Learning rate for the final classification layers (e.g. 0.001).',
  'training-multi-layer': 'Add hidden layers to the classifier head for more complex decision boundaries.',
  'training-output': 'Where the trained model, config, and logs will be saved.',
  'training-python-env': 'Use a custom conda/Python environment instead of the bundled one.',
  'training-testing-mode': 'Run a quick test pass on a small subset to verify setup.',

  // Extraction
  'extraction-predictions-folder': 'Folder containing inference result CSVs to extract clips from.',
  'extraction-methods': 'How clips are selected: top scores, random sample, threshold-based, etc.',
  'extraction-output': 'Directory where extracted annotation tasks will be saved.',
  'extraction-audio-export': 'Also copy the raw audio segments alongside the annotation task.',
  'extraction-output-mode': 'Format of the output: binary review (yes/no) or multi-class labels.',
  'extraction-class-selection': 'Which classes to extract clips for.',
  'extraction-stratification': 'Balance extracted clips across score ranges or subfolders.',
  'extraction-filtering': 'Filter source clips by score range, file, or other criteria.',
  'extraction-python-env': 'Use a custom conda/Python environment instead of the bundled one.',
  'extraction-tasks': 'Create a task to queue it, or Create and Run to start immediately.',
};

function HelpIcon({ section, className = '' }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const iconRef = useRef(null);
  const tooltip = HELP_TOOLTIPS[section];

  const handleMouseEnter = () => {
    if (!tooltip) return;
    const rect = iconRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
    setVisible(true);
  };

  const handleMouseLeave = () => setVisible(false);

  const handleClick = () => {
    setVisible(false);
    const tabChangeEvent = new CustomEvent('changeTab', { detail: { tabId: 'help' } });
    window.dispatchEvent(tabChangeEvent);
    setTimeout(() => {
      const helpNavEvent = new CustomEvent('navigateToHelp', { detail: { section } });
      window.dispatchEvent(helpNavEvent);
    }, 100);
  };

  return (
    <>
      <span
        ref={iconRef}
        className={`help-icon ${className}`}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        ?
      </span>
      {visible && tooltip && (
        <div
          className="help-icon-tooltip"
          style={{ top: pos.top, left: pos.left }}
        >
          {tooltip}
          <span className="help-icon-tooltip-hint">Click for full details</span>
        </div>
      )}
    </>
  );
}

export default HelpIcon;
