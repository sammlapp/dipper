import React, { useState, useEffect } from 'react';

function HelpTab() {
  const [activeSection, setActiveSection] = useState('');

  // Handle navigation from help icons
  useEffect(() => {
    const handleHelpNavigation = (event) => {
      if (event.detail && event.detail.section) {
        console.log('Navigating to help section:', event.detail.section);
        setActiveSection(event.detail.section);
        
        // Function to attempt scrolling to element
        const scrollToElement = (sectionId, attempts = 0) => {
          const element = document.getElementById(sectionId);
          console.log(`Attempt ${attempts + 1} - Found element:`, element);
          
          if (element) {
            // Add highlighted class temporarily
            element.classList.add('help-highlight');
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Remove highlight after animation
            setTimeout(() => {
              element.classList.remove('help-highlight');
            }, 2000);
          } else if (attempts < 5) {
            // Try again after a short delay (max 5 attempts)
            setTimeout(() => scrollToElement(sectionId, attempts + 1), 200);
          } else {
            console.error('Help section not found after 5 attempts:', sectionId);
          }
        };

        // Start trying to scroll after a delay to ensure tab rendering
        setTimeout(() => scrollToElement(event.detail.section), 300);
      }
    };

    window.addEventListener('navigateToHelp', handleHelpNavigation);
    return () => window.removeEventListener('navigateToHelp', handleHelpNavigation);
  }, []);

  const sections = [
    {
      id: 'inference',
      title: 'Inference',
      content: (
        <div>
          <h3>Overview</h3>
          <p>
            The Inference tab is used to run existing machine learning models on audio data to detect classes of interest (such as bird species). 
            You select audio files and configure parameters, then the system processes the audio and saves detection results to CSV files. 
            These results can later be loaded in the Review tab to inspect and validate detections.
          </p>

          <h4 id="inference-file-selection">Audio File Selection</h4>
          <p><strong>Select Files:</strong> Choose individual audio files to process.</p>
          <p><strong>Select Folder:</strong> Choose a folder and the system will recursively find all audio files of the selected extensions.</p>
          <p><strong>Glob Patterns:</strong> Use advanced pattern matching (e.g., "/path/**/*.wav") to select files across multiple directories.</p>
          <p><strong>File List:</strong> Provide a text file with one audio file path per line.</p>

          <h4 id="inference-models">Model Selection</h4>
          <p><strong>BirdNET:</strong> General bird species detection model trained on global bird sounds.</p>
          <p><strong>Perch:</strong> Specialized model for bird vocalizations with high precision.</p>
          <p><strong>HawkEars:</strong> Model focused on raptor and hawk species detection.</p>
          <p><strong>RanaSierraeCNN:</strong> Specialized model for frog and amphibian detection.</p>

          <h4 id="inference-overlap">Overlap Setting</h4>
          <p><strong>Overlap:</strong> Amount of overlap between consecutive audio analysis windows (0.0-1.0). Higher values provide more thorough analysis but take longer.</p>

          <h4 id="inference-batch-size">Batch Size Setting</h4>
          <p><strong>Batch Size:</strong> Number of audio segments processed simultaneously. Higher values are faster but use more memory.</p>

          <h4 id="inference-workers">Workers Setting</h4>
          <p><strong>Workers:</strong> Number of parallel processing threads. More workers are faster but use more CPU.</p>

          <h4 id="inference-subfolder-split">Subfolder Split Option</h4>
          <p><strong>Split by Subfolder:</strong> When enabled, creates separate output files for each subfolder in your audio directory structure.</p>

          <h4 id="inference-output">Output Configuration</h4>
          <p><strong>Output Directory:</strong> Where result files will be saved. The system creates a job folder with predictions CSV, configuration backup, and processing logs.</p>

          <h4 id="inference-tasks">Task Management</h4>
          <p><strong>Create Task:</strong> Saves the configuration for later execution.</p>
          <p><strong>Create and Run:</strong> Immediately starts processing with the current configuration.</p>
          <p>Tasks are queued and processed sequentially. You can monitor progress, cancel running tasks, and retry failed tasks.</p>
        </div>
      )
    },
    {
      id: 'training',
      title: 'Training',
      content: (
        <div>
          <h3>Overview</h3>
          <p>
            The Training tab allows you to train custom machine learning models using your own annotated audio data. 
            You can fine-tune existing models from the bioacoustics model zoo on your specific classes of interest, 
            creating specialized detectors for your research needs.
          </p>

          <h4 id="training-model-selection">Base Model Selection</h4>
          <p>Choose a pre-trained model to use as the starting point for training. The model's feature extraction layers will be used, and new classification layers will be trained on your data.</p>

          <h4 id="training-fully-annotated">Fully Annotated Files</h4>
          <p><strong>Fully Annotated Files:</strong> CSV files with complete annotations for all classes. Format should be: file, start_time, end_time, then one column per class with 1/0 labels, OR file, start_time, end_time, labels, complete format.</p>

          <h4 id="training-single-class">Single Class Annotations</h4>
          <p><strong>Single Class Annotations:</strong> CSV files from binary classification review sessions. Format: file, start_time, end_time, annotation (yes/no/uncertain). Assign each file to a specific class from your class list.</p>

          <h4 id="training-background">Background Samples</h4>
          <p><strong>Background Samples:</strong> Optional CSV of background/negative examples to improve model discrimination.</p>

          <h4 id="training-class-list">Class Configuration</h4>
          <p><strong>Class List:</strong> Comma or newline-separated list of classes to train. Will auto-populate from the first fully annotated file if left empty (using column names after file, start_time, end_time).</p>

          <h4 id="training-root-folder">Root Audio Folder</h4>
          <p><strong>Root Audio Folder:</strong> Base directory for resolving relative file paths in your annotation CSVs.</p>

          <h4 id="training-evaluation">Evaluation File</h4>
          <p><strong>Evaluation File:</strong> Optional separate dataset for model evaluation. Same format as training data.</p>

          <h4 id="training-batch-size">Batch Size Setting</h4>
          <p><strong>Batch Size:</strong> Number of samples processed together during training. Larger batches train faster but require more memory.</p>

          <h4 id="training-workers">Workers Setting</h4>
          <p><strong>Workers:</strong> Number of parallel data loading processes.</p>

          <h4 id="training-freeze">Freeze Feature Extractor</h4>
          <p><strong>Freeze Feature Extractor:</strong> When enabled, only trains the final classification layers. Recommended for small datasets to prevent overfitting.</p>

          <h4 id="training-output">Model Output</h4>
          <p><strong>Save Location:</strong> Directory where the trained model and training logs will be saved.</p>
        </div>
      )
    },
    {
      id: 'explore',
      title: 'Explore',
      content: (
        <div>
          <h3>Overview</h3>
          <p>
            The Explore tab allows you to load and analyze inference results from CSV files. 
            You can visualize detection scores, listen to audio clips, view spectrograms, and explore your data 
            to understand model performance and identify interesting detections.
          </p>

          <h4>Data Loading</h4>
          <p><strong>Load Results:</strong> Import CSV files containing inference results with detection scores and metadata.</p>
          <p><strong>File Format:</strong> Expected columns include file paths, start/end times, and confidence scores for each detected class.</p>

          <h4>Visualization</h4>
          <p><strong>Score Distribution:</strong> Histograms and statistics showing the distribution of detection confidence scores.</p>
          <p><strong>Species Selection:</strong> Filter and focus on specific classes/species of interest.</p>
          <p><strong>Threshold Selection:</strong> Adjust confidence thresholds to explore different sensitivity levels.</p>

          <h4>Audio Review</h4>
          <p><strong>Spectrogram Display:</strong> Visual representation of audio clips with detection overlays.</p>
          <p><strong>Audio Playback:</strong> Listen to detected audio segments to verify model performance.</p>
          <p><strong>Sample Selection:</strong> Browse high-confidence detections, random samples, or specific score ranges.</p>
        </div>
      )
    },
    {
      id: 'review',
      title: 'Review',
      content: (
        <div>
          <h3>Overview</h3>
          <p>
            The Review tab provides tools for manual annotation and validation of audio data. 
            You can review detection results, annotate audio clips for training data, and create ground truth datasets. 
            The interface supports both binary classification (yes/no/uncertain) and multi-class annotation workflows.
          </p>

          <h4>Annotation Modes</h4>
          <p><strong>Binary Review:</strong> Annotate clips as yes/no/uncertain/unlabeled for a single species or sound type.</p>
          <p><strong>Multi-class Review:</strong> Assign multiple class labels to each audio clip from your defined class list.</p>

          <h4>Display Options</h4>
          <p><strong>Grid Mode:</strong> View multiple spectrograms simultaneously for efficient batch annotation.</p>
          <p><strong>Focus Mode:</strong> Single large spectrogram display for detailed review of individual clips.</p>

          <h4>Audio Controls</h4>
          <p><strong>Playback:</strong> Click spectrograms to play audio clips.</p>
          <p><strong>Auto-play:</strong> Automatically play clips when displayed (configurable in Focus mode).</p>
          <p><strong>Navigation:</strong> Keyboard shortcuts for efficient annotation workflow.</p>

          <h4>Settings</h4>
          <p><strong>Spectrogram Settings:</strong> Adjust window length, frequency range, dB range, and colormap.</p>
          <p><strong>Display Settings:</strong> Configure grid size, comments field visibility, and file name display.</p>
          <p><strong>Filtering:</strong> Filter clips by annotation status or assigned labels.</p>

          <h4>Data Export</h4>
          <p><strong>Auto-save:</strong> Automatically save annotations as you work.</p>
          <p><strong>Export Format:</strong> Annotations saved as CSV files compatible with training workflows.</p>
        </div>
      )
    },
    {
      id: 'general',
      title: 'General Usage',
      content: (
        <div>
          <h3>Getting Started</h3>
          <p>
            This application provides a complete workflow for bioacoustic analysis: from running pre-trained models on your audio data (Inference), 
            to exploring and understanding the results (Explore), annotating clips for validation or training (Review), 
            and training custom models on your annotated data (Training).
          </p>

          <h4>Typical Workflow</h4>
          <ol>
            <li><strong>Inference:</strong> Run a pre-trained model on your audio files to get initial detections</li>
            <li><strong>Explore:</strong> Load and examine the inference results to understand what was detected</li>
            <li><strong>Review:</strong> Manually validate high-confidence detections and annotate clips for training</li>
            <li><strong>Training:</strong> Use your annotations to train a custom model specialized for your data</li>
            <li><strong>Iteration:</strong> Run inference with your trained model and repeat the cycle to improve performance</li>
          </ol>

          <h4>File Formats</h4>
          <p><strong>Audio:</strong> Supported formats include WAV, MP3, FLAC, OGG, M4A, AAC, WMA, AIFF</p>
          <p><strong>Annotations:</strong> CSV files with standardized column formats for different annotation types</p>
          <p><strong>Results:</strong> CSV files with detection scores and metadata for each analyzed audio segment</p>

          <h4>Configuration Management</h4>
          <p>All tabs support saving and loading configuration files to preserve your analysis parameters and enable reproducible workflows.</p>

          <h4>Task Monitoring</h4>
          <p>Long-running processes (inference and training) are managed through a task queue system with progress monitoring, cancellation support, and error reporting.</p>
        </div>
      )
    }
  ];

  return (
    <div className="help-tab">
      <div className="help-header">
        <h2>Dipper - Help Documentation</h2>
        <p>Comprehensive guide to using all features of the application</p>
      </div>

      <div className="help-navigation">
        <h3>Quick Navigation</h3>
        <ul>
          {sections.map(section => (
            <li key={section.id}>
              <button 
                className={`nav-link ${activeSection === section.id ? 'active' : ''}`}
                onClick={() => setActiveSection(section.id)}
              >
                {section.title}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="help-content">
        {sections.map(section => (
          <div key={section.id} className="help-section" id={section.id}>
            <h2>{section.title}</h2>
            {section.content}
          </div>
        ))}
      </div>

      <style jsx>{`
        .help-tab {
          padding: 20px;
          max-width: 800px;
          margin: 0 auto;
          line-height: 1.6;
        }

        .help-header {
          text-align: center;
          margin-bottom: 30px;
          padding-bottom: 20px;
          border-bottom: 2px solid var(--border, #ddd);
        }

        .help-header h2 {
          color: var(--primary, #333);
          margin-bottom: 10px;
        }

        .help-navigation {
          background: var(--background-secondary, #f8f9fa);
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 30px;
        }

        .help-navigation ul {
          list-style: none;
          padding: 0;
          margin: 10px 0 0 0;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .nav-link {
          background: var(--background, white);
          border: 1px solid var(--border, #ddd);
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .nav-link:hover {
          background: var(--primary-light, #e3f2fd);
          border-color: var(--primary, #1976d2);
        }

        .nav-link.active {
          background: var(--primary, #1976d2);
          color: white;
          border-color: var(--primary, #1976d2);
        }

        .help-section {
          margin-bottom: 40px;
          padding: 20px;
          border: 1px solid var(--border, #ddd);
          border-radius: 8px;
          background: var(--background, white);
        }

        .help-section h2 {
          color: var(--primary, #333);
          margin-top: 0;
          margin-bottom: 20px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--border, #ddd);
        }

        .help-section h3 {
          color: var(--primary, #333);
          margin-top: 25px;
          margin-bottom: 15px;
        }

        .help-section h4 {
          color: var(--text-secondary, #555);
          margin-top: 20px;
          margin-bottom: 10px;
        }

        .help-section p {
          margin-bottom: 12px;
        }

        .help-section ol, .help-section ul {
          margin-bottom: 15px;
          padding-left: 25px;
        }

        .help-section li {
          margin-bottom: 8px;
        }

        .help-section strong {
          color: var(--primary, #333);
        }

        .help-content div[id] {
          scroll-margin-top: 20px;
        }

        .help-content h4[id] {
          scroll-margin-top: 20px;
          padding: 8px;
          border-radius: 4px;
          transition: background-color 0.3s ease;
        }

        .help-highlight {
          background-color: var(--primary-light, #e3f2fd) !important;
          border: 2px solid var(--primary, #1976d2) !important;
          animation: helpPulse 0.5s ease-in-out;
        }

        @keyframes helpPulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.02); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

export default HelpTab;