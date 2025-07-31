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
          <p><strong>Select Files:</strong> Choose individual audio files to process. Use this for small datasets or when you need precise control over which files to analyze.</p>

          <p><strong>Select Folder:</strong> Choose a folder and the system will recursively find all audio files of the selected extensions. This is the most common option for processing entire datasets. Select which file extensions to include (WAV, MP3, FLAC, etc.).</p>

          <p><strong>Glob Patterns:</strong> Use advanced pattern matching for complex file selection across multiple directories. Examples:</p>
          <ul>
            <li><code>/Users/name/recordings/**/*.wav</code> - All WAV files in recordings and subdirectories</li>
            <li><code>/data/project_&#123;2023,2024&#125;/**/*.&#123;wav,mp3&#125;</code> - WAV and MP3 files from specific years</li>
            <li><code>/recordings/site_*/morning_*.wav</code> - Specific naming patterns</li>
          </ul>

          <p><strong>File List:</strong> Provide a text file with one audio file path per line. Useful when you have a pre-defined list of files to process.</p>
          <div className="help-code-block">
            <strong>Example file list (filelist.txt):</strong><br />
            <code>/Users/name/audio/recording1.wav<br />
              /Users/name/audio/recording2.wav<br />
              /Users/name/audio/subfolder/recording3.mp3</code>
          </div>

          <h4 id="inference-models">Model Selection</h4>
          <p><strong>BirdNET:</strong> Global bird species detection model trained on ~3000 species. Best general-purpose option for bird detection worldwide. Outputs confidence scores for individual species.</p>

          <p><strong>Perch:</strong> Specialized bird detection model optimized for precision over recall. Uses advanced embedding techniques for robust species classification. Good for research requiring high confidence detections.</p>

          <p><strong>HawkEars:</strong> Model focused on raptor and hawk species detection, trained specifically on birds of prey vocalizations. Use for raptor migration monitoring or specialized hawk surveys.</p>

          <p><strong>RanaSierraeCNN:</strong> Specialized CNN model for frog and amphibian detection, trained on anuran calls. Designed for amphibian biodiversity monitoring and ecological surveys.</p>

          <h4 id="inference-overlap">Overlap Setting</h4>
          <p><strong>Overlap (0.0-1.0):</strong> Controls how much consecutive analysis windows overlap. Typically we pass non-overlapping clips, but overlap can be used to increase the probability of detecting sounds that would otherwise be split across clips.</p>
          <ul>
            <li><strong>0 (No overlap):</strong> Fastest processing, but may miss calls at window edges</li>
            <li><strong>1:</strong> Overlap sequential clips by 1.0 seconds</li>
            <li><strong>Other</strong> </li>

          </ul>
          <p><em>Recommendation:</em> Start with 0 overlap for general use, increase to 50% or more for critical surveys where missing detections is costly. Take note of the clip duration of the selected model (eg 3 sec for BirdNET, 5 sec for Perch)</p>

          <h4 id="inference-batch-size">Batch Size Setting</h4>
          <p><strong>Batch Size:</strong> Number of audio segments processed simultaneously in GPU memory. When using CPU, set to 1. GPUs can typically handle batch sizes of 512 or 1024, depending on the size of the model and spectrogram.</p>
          <ul>
            <li><strong>Small batch (1-4):</strong> Safe for limited CPU inference, slower but stable</li>
            <li><strong>Medium batch (32-128):</strong>If you experience issues with GPU CUDA memory errors</li>
            <li><strong>Large batch (256, 512, 1024):</strong>Recommended when using GPUs and typical models</li>
          </ul>
          <p><em>Memory usage:</em> Larger batches require more GPU memory. If you get CUDA out-of-memory errors, reduce batch size.</p>
          <p><em>Performance:</em> Larger batches are more efficient due to parallel processing, but benefit plateaus after optimal size for your hardware.</p>

          <h4 id="inference-workers">Workers Setting</h4>
          <p><strong>Workers (1-8):</strong> Number of parallel CPU threads for data loading and preprocessing. This is PyTorch's num_workers parameter for DataLoader.</p>
          <ul>
            <li><strong>0 workers:</strong> Uses root process for preprocessing. Safe default, sequential processing, minimal CPU usage</li>
            <li><strong>4-8 workers:</strong> Good for most personal computers, balances speed and stability</li>
            <li><strong>10+ workers:</strong> Maximum performance on high-end multi-core computers or clusters</li>
          </ul>
          <p><em>CPU consideration:</em> More workers use more CPU cores. </p>
          <p><em>I/O bottleneck:</em> Using many workers sometimes causes 'traffic jams' when reading from slow storage like traditional HDD hard drives.</p>

          <h4 id="inference-subfolder-split">Subfolder Split Option</h4>
          <p><strong>Split by Subfolder:</strong> When enabled, creates separate output files for each subfolder in your audio directory structure. The lowest-level subfolder is used.</p>

          <h4 id="inference-output">Output Configuration</h4>
          <p><strong>Output Directory:</strong> Where result files will be saved. The system creates a job folder with predictions CSV, a copy of the configuration file (which can be loaded back into the interface), and processing logs.</p>

          <h4 id="inference-tasks">Task Management</h4>
          <p><strong>Create Task:</strong> Creates a task but does not start it. Can be started from the task queue.</p>
          <p><strong>Create and Run:</strong> Immediately starts processing with the current configuration.</p>
          <p>Tasks are queued and processed sequentially. You can monitor progress, cancel running tasks, and retry failed tasks in the task queue.</p>
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
          <p><strong>Fully Annotated Files:</strong> CSV files where every audio clip has been completely labeled for all target classes. These provide the highest quality training data.</p>

          <p><strong>Format 1 - One-hot encoding (recommended):</strong></p>
          <div className="help-code-block">
            file,start_time,end_time,robin,cardinal,blue_jay<br />
            recording1.wav,0.0,3.0,1,0,0<br />
            recording1.wav,3.0,6.0,0,1,1<br />
            recording2.wav,10.0,13.0,0,0,0
          </div>

          <p><strong>Format 2 - List format:</strong></p>
          <div className="help-code-block">
            file,start_time,end_time,labels,complete<br />
            recording1.wav,0.0,3.0,"['robin']",complete<br />
            recording1.wav,3.0,6.0,"['cardinal','blue_jay']",complete<br />
            recording2.wav,10.0,13.0,"[]",complete
          </div>

          <p><em>Best practice:</em> Use Format 1 for simpler processing. Each class column should contain 1 (present) or 0 (absent).</p>

          <h4 id="training-single-class">Single Class Annotations</h4>
          <p><strong>Single Class Annotations:</strong> CSV files from binary review sessions where you've labeled clips for presence/absence of a single species. These are combined to create multi-class training data.</p>

          <div className="help-code-block">
            <strong>Example robin_annotations.csv:</strong><br />
            file,start_time,end_time,annotation<br />
            recording1.wav,0.0,3.0,yes<br />
            recording1.wav,3.0,6.0,no<br />
            recording1.wav,6.0,9.0,uncertain<br />
            recording2.wav,0.0,3.0,no
          </div>

          <p><strong>Usage:</strong> After selecting files, assign each CSV to its corresponding class (e.g., robin_annotations.csv → "robin"). The system treats:</p>
          <ul>
            <li><strong>"yes":</strong> Positive example for that class</li>
            <li><strong>"no":</strong> Negative example for that class</li>
            <li><strong>"uncertain":</strong> Excluded from training (ambiguous)</li>
          </ul>

          <p><em>Note:</em> Other classes are treated as weak negatives (assumed absent but not explicitly labeled).</p>

          <h4 id="training-background">Background Samples</h4>
          <p><strong>Background Samples:</strong> Optional CSV file containing environmental noise or audio segments without any target species. These improve model discrimination by providing explicit negative examples.</p>

          <div className="help-code-block">
            <strong>Example background_samples.csv:</strong><br />
            file,start_time,end_time<br />
            wind_noise.wav,0.0,3.0<br />
            rain_ambient.wav,5.0,8.0<br />
            urban_noise.wav,10.0,13.0<br />
            forest_ambient.wav,0.0,3.0
          </div>

          <p><strong>Usage in training:</strong> Background samples are mixed with training data using "overlay" augmentation at 75% probability, helping the model learn to distinguish target species from environmental sounds.</p>

          <p><em>Best practice:</em> Include 1000-5000 background samples representing the acoustic environments where your model will be deployed.</p>

          <h4 id="training-class-list">Class Configuration</h4>
          <p><strong>Class List:</strong> Defines the target species or sound classes for your model. This determines the model's output structure.</p>

          <div className="help-info-box">
            <strong>Example formats:</strong><br />
            <strong>Comma-separated:</strong> robin, cardinal, blue_jay, wood_thrush<br />
            <strong>Line-separated:</strong><br />
            robin<br />
            cardinal<br />
            blue_jay<br />
            wood_thrush
          </div>

          <p><strong>Auto-population:</strong> If left empty, the system extracts class names from the first fully annotated file using column headers (after file, start_time, end_time).</p>

          <p><strong>Important considerations:</strong></p>
          <ul>
            <li>Class names must exactly match those used in annotation files</li>
            <li>Order affects model output structure but not performance</li>
            <li>More classes require more training data for good performance</li>
            <li>Consider grouping rare species or using hierarchical classification</li>
          </ul>

          <h4 id="training-root-folder">Root Audio Folder</h4>
          <p><strong>Root Audio Folder:</strong> Base directory for resolving relative file paths in your annotation CSVs. This enables portable annotation files that work across different systems.</p>

          <p><strong>Example usage:</strong></p>
          <div className="help-info-box">
            <strong>If your CSV contains:</strong><br />
            <code>site1/morning.wav,0.0,3.0,1,0,0</code><br /><br />
            <strong>And root folder is:</strong><br />
            <code>/Users/researcher/audio_data/</code><br /><br />
            <strong>System looks for:</strong><br />
            <code>/Users/researcher/audio_data/site1/morning.wav</code>
          </div>

          <p><strong>When to use:</strong></p>
          <ul>
            <li>CSV files contain relative paths (recommended for portability)</li>
            <li>Sharing annotation files between team members</li>
            <li>Moving datasets between different computers/servers</li>
          </ul>

          <p><em>Alternative:</em> Use absolute paths in CSV files if you prefer, then leave this field empty.</p>

          <h4 id="training-evaluation">Evaluation File</h4>
          <p><strong>Evaluation File:</strong> Optional separate dataset for unbiased model evaluation. Uses same format as fully annotated training files.</p>

          <p><strong>Purpose:</strong> Provides independent test set for assessing true model performance. Without this, the system uses 80/20 train/validation split from your training data.</p>

          <div className="help-code-block">
            <strong>Example evaluation.csv:</strong><br />
            file,start_time,end_time,robin,cardinal,blue_jay<br />
            test_site1.wav,0.0,3.0,1,0,0<br />
            test_site1.wav,3.0,6.0,0,1,0<br />
            test_site2.wav,10.0,13.0,0,0,1
          </div>

          <p><strong>Best practices:</strong></p>
          <ul>
            <li>When possible, select evaluation data that represents the same conditions as deployment (especially if your training data looks different from your deployment data)</li>
            <li>Include all target classes in evaluation set</li>
            <li>Consider geographic or temporal separation from training data</li>
          </ul>

          <h4 id="training-batch-size">Batch Size Setting</h4>
          <p><strong>Batch Size (8-64):</strong> Number of audio samples processed together in each training step. This is a fundamental PyTorch hyperparameter affecting both performance and model behavior.</p>

          <p><strong>Size recommendations:</strong></p>
          <ul>
            <li><strong>128-512:</strong>GPU Training</li>
            <li><strong>32-64:</strong>CPU Training (slow)</li>
          </ul>

          <p><strong>Trade-offs:</strong></p>
          <ul>
            <li><strong>Larger batches:</strong> More stable gradients, faster training, need more memory</li>
            <li><strong>Smaller batches:</strong> More noise in gradients (can help escape local minima), less memory</li>
          </ul>

          <p><em>Rule of thumb:</em> Start with 128, reduce if you get out-of-memory errors, increase if training is slow and you have spare GPU memory.</p>

          <h4 id="training-workers">Workers Setting</h4>
          <p><strong>Workers (0-8):</strong> Number of parallel processes for loading and preprocessing training data. This is PyTorch's DataLoader num_workers parameter.</p>

          <ul>
            <li><strong>0:</strong> Single-threaded data loading, safest but slowest</li>
            <li><strong>2-4:</strong> Good balance for most systems</li>
            <li><strong>4-8:</strong> High-performance systems with fast storage</li>
          </ul>

          <p><strong>Optimization guidelines:</strong></p>
          <ul>
            <li>Set to number of CPU cores available for training (typically total cores - 2)</li>
            <li>Reduce if you experience system instability or memory issues</li>
            <li>Increase if GPU utilization is low (GPU waiting for data)</li>
          </ul>

          <p><em>Performance tip:</em> Monitor GPU utilization during training. If it's below 90%, try increasing workers.</p>

          <h4 id="training-freeze">Freeze Feature Extractor</h4>
          <p><strong>Freeze Feature Extractor:</strong> Controls which parts of the neural network are updated during training. This is a crucial transfer learning decision.</p>

          <p><strong>Enabled (Recommended for most users):</strong></p>
          <ul>
            <li>Only trains the final classification layers</li>
            <li>Preserves pre-trained feature representations</li>
            <li>Faster training, less GPU memory, prevents overfitting</li>
            <li>Best for small datasets (&lt;5000 samples)</li>
          </ul>

          <p><strong>Disabled (Advanced users):</strong></p>
          <ul>
            <li>Fine-tunes the entire network including feature extractor</li>
            <li>Can achieve better performance with sufficient data</li>
            <li>Requires large datasets (&gt;10000 samples) to avoid overfitting</li>
            <li>Much slower training, needs more GPU memory</li>
          </ul>

          <p><em>Decision guide:</em> Keep enabled unless you have &gt;10,000 labeled samples and understand the risks of overfitting.</p>

          <h4 id="training-multi-layer">Multi-layer Classifier</h4>
          <p><strong>Multi-layer Classifier:</strong> Controls the architecture of the final classification head. This affects model capacity and learning ability.</p>

          <p><strong>Disabled (Single layer, default):</strong></p>
          <ul>
            <li>Simple linear layer: features → classes</li>
            <li>Fastest training, least overfitting risk</li>
            <li>Sufficient for most bioacoustic classification tasks</li>
          </ul>

          <p><strong>Enabled (Multi-layer):</strong></p>
          <ul>
            <li>Deep classifier: features → hidden layers → classes</li>
            <li>More expressive, can learn complex decision boundaries</li>
            <li>Useful for difficult discrimination tasks</li>
          </ul>

          <p><strong>Hidden Layer Sizes:</strong> Comma-separated numbers defining the architecture. Examples:</p>
          <ul>
            <li><strong>"100":</strong> Single hidden layer with 100 neurons</li>
            <li><strong>"100,50":</strong> Two layers: 100 → 50 → classes</li>
            <li><strong>"200,100,50":</strong> Three layers with decreasing size</li>
          </ul>

          <p><em>Guideline:</em> Start with single layer. Try "100" if single layer performance plateaus. <p>
          </p>
            <p><em>Overfitting:</em> Multi-layer networks are much more prone to over-fitting on small training datasets. If you see performance on the validation set decreasing as training proceeds, that is a clear sign of over-fitting and you should try reducing the number of layers.</p></p>

          <h4 id="training-output">Model Output</h4>
          <p><strong>Save Location:</strong> Directory where the trained model, configuration, and training logs will be saved. The system creates a job folder with:</p>
          <ul>
            <li><strong>trained_model.pth:</strong> PyTorch model file for inference</li>
            <li><strong>training_config.json:</strong> Complete training configuration backup</li>
            <li><strong>Training logs:</strong> Loss curves, validation metrics, debugging info</li>
          </ul>
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

          <p><strong>Expected CSV format from inference:</strong></p>
          <div className="help-code-block">
            file,start_time,end_time,robin,cardinal,blue_jay<br />
            recording1.wav,0.0,3.0,0.85,0.12,0.03<br />
            recording1.wav,3.0,6.0,0.15,0.78,0.07<br />
            recording2.wav,6.0,9.0,0.02,0.05,0.93
          </div>

          <p>Each species column contains confidence scores (0.0-1.0) indicating detection probability.</p>

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

          <h4 id="review-formats">Supported CSV Formats</h4>
          <p>The Review tab supports three different CSV formats for annotation tasks. The system automatically detects the format and switches to the appropriate review mode:</p>

          <h5>Format 1: Binary Review (yes/no/uncertain)</h5>
          <p>Used for single-species detection tasks where each clip is labeled as present, absent, or uncertain.</p>
          <div className="help-code-block">
            <strong>Required columns:</strong><br />
            file,start_time,end_time,annotation,comments<br /><br />
            <strong>Example binary_review.csv:</strong><br />
            file,start_time,end_time,annotation,comments<br />
            recording1.wav,0.0,3.0,yes,Clear robin song<br />
            recording1.wav,3.0,6.0,no,Background noise only<br />
            recording1.wav,6.0,9.0,uncertain,Possible robin call<br />
            recording2.wav,0.0,3.0,,Unannotated clip
          </div>
          <ul>
            <li><strong>annotation values:</strong> "yes", "no", "uncertain", or empty (unlabeled)</li>
            <li><strong>Auto-detection:</strong> System detects this format when "annotation" column is present without "labels" column</li>
          </ul>

          <h5>Format 2: Multi-class with Labels Column</h5>
          <p>Used for multi-species annotation where clips can contain multiple classes simultaneously.</p>
          <div className="help-code-block">
            <strong>Required columns:</strong><br />
            file,start_time,end_time,labels,annotation_status,comments<br /><br />
            <strong>Example multiclass_labels.csv:</strong><br />
            file,start_time,end_time,labels,annotation_status,comments<br />
            recording1.wav,0.0,3.0,"robin,cardinal",complete,Multiple species<br />
            recording1.wav,3.0,6.0,"[]",complete,No target species<br />
            recording1.wav,6.0,9.0,"blue_jay",uncertain,Possible blue jay<br />
            recording2.wav,0.0,3.0,"robin",unreviewed,Auto-detected
          </div>
          <ul>
            <li><strong>labels format:</strong> Comma-separated strings or JSON arrays: "robin,cardinal" or ["robin","cardinal"]</li>
            <li><strong>annotation_status values:</strong> "complete", "unreviewed", "uncertain"</li>
            <li><strong>Auto-detection:</strong> System detects this format when "labels" column is present</li>
          </ul>

          <h5>Format 3: Multi-hot (One Column Per Class)</h5>
          <p>Used when you have a column for each target class with 0/1 values or continuous confidence scores.</p>
          <div className="help-code-block">
            <strong>Dynamic columns:</strong><br />
            file,start_time,end_time,[class1],[class2],[class3]...,comments<br /><br />
            <strong>Example multihot_classes.csv:</strong><br />
            file,start_time,end_time,robin,cardinal,blue_jay,comments<br />
            recording1.wav,0.0,3.0,1,0,0,Robin detected<br />
            recording1.wav,3.0,6.0,1,1,0,Both robin and cardinal<br />
            recording1.wav,6.0,9.0,0,0,1,Blue jay only<br />
            recording2.wav,0.0,3.0,0,0,0,No target species
          </div>
          <ul>
            <li><strong>Class values:</strong> 0 (absent), 1 (present), or continuous scores (0.0-1.0)</li>
            <li><strong>Threshold:</strong> Values above threshold (default 0) are considered present</li>
            <li><strong>Auto-detection:</strong> System detects this when no "annotation" or "labels" columns exist</li>
            <li><strong>Classes extracted:</strong> All columns except file, start_time, end_time, comments become class names</li>
          </ul>

          <h4>Annotation Modes</h4>
          <p><strong>Binary Review:</strong> Annotate clips as yes/no/uncertain/unlabeled for a single species or sound type (Format 1).</p>
          <p><strong>Multi-class Review:</strong> Assign multiple class labels to each audio clip from your defined class list (Formats 2 & 3).</p>

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
            <li><strong>Inference:</strong> Run a pre-trained model (BirdNET, Perch, etc.) on your audio files to get initial detections</li>
            <li><strong>Explore:</strong> Load and examine the inference results to understand detection patterns and confidence distributions</li>
            <li><strong>Review:</strong> Manually validate high-confidence detections and annotate clips to create training datasets</li>
            <li><strong>Training:</strong> Use your annotations to fine-tune models specialized for your target species and acoustic environment</li>
            <li><strong>Iteration:</strong> Deploy your trained model via inference and repeat the cycle to improve performance</li>
          </ol>

          <h4>File Formats Supported</h4>
          <p><strong>Audio formats:</strong> WAV (recommended), MP3, FLAC, OGG, M4A, AAC, WMA, AIFF</p>
          <ul>
            <li><strong>WAV:</strong> Uncompressed, best quality for analysis</li>
            <li><strong>FLAC:</strong> Lossless compression, good balance of quality and size</li>
            <li><strong>MP3:</strong> Compressed, acceptable for many applications but may affect model performance</li>
          </ul>

          <p><strong>CSV file specifications:</strong></p>
          <ul>
            <li><strong>Inference results:</strong> file, start_time, end_time, [confidence columns]</li>
            <li><strong>Annotations:</strong> file, start_time, end_time, [class labels or annotation field]</li>
            <li><strong>File lists:</strong> One audio file path per line (plain text)</li>
          </ul>

          <h4>Configuration Management</h4>
          <p>All tabs support saving and loading JSON configuration files to preserve your analysis parameters and enable reproducible workflows. This includes:</p>
          <ul>
            <li><strong>Model parameters:</strong> Batch size, overlap, worker counts</li>
            <li><strong>File selections:</strong> Input files, output directories, patterns</li>
            <li><strong>Training settings:</strong> Learning rates, architectures, data augmentation</li>
          </ul>

          <p><em>Best practice:</em> Save configurations for each project to ensure consistent analysis parameters.</p>

          <h4>Task Monitoring & Performance</h4>
          <p>Long-running processes (inference and training) are managed through a task queue system with:</p>
          <ul>
            <li><strong>Progress monitoring:</strong> Real-time updates on processing status</li>
            <li><strong>Resource management:</strong> Automatic GPU/CPU utilization optimization</li>
            <li><strong>Error reporting:</strong> Detailed logs for troubleshooting failures</li>
            <li><strong>Background processing:</strong> Continue working while tasks run</li>
          </ul>

          <p><strong>Performance tips:</strong></p>
          <ul>
            <li>Start with small test datasets to optimize parameters</li>
            <li>Monitor GPU/CPU usage to identify bottlenecks</li>
            <li>Use SSD storage for better I/O performance</li>
            <li>Batch process large datasets instead of individual files</li>
          </ul>
        </div>
      )
    }
  ];

  return (
    <div className="help-tab">
      <div className="help-header">
        <h2>Dipper - Help Documentation</h2>

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
          max-width: 900px;
          margin: 0 auto;
          line-height: 1.6;
        }
        
        .help-tab code {
          background: #e8f4f8;
          padding: 2px 4px;
          border-radius: 3px;
          font-family: 'Courier New', monospace;
          font-size: 0.9em;
        }
        
        .help-tab ul li {
          margin-bottom: 6px;
        }
        
        .help-tab em {
          color: #0066cc;
          font-style: normal;
          font-weight: 500;
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