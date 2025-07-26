This project will create a cross-platform desktop app that runs pytorch machine learning models and allows users to train models in an active learning loop. 

Conda environment: `conda activate train_gui`

The project will use the bioacoustics model zoo for pre-trained bioacoustic identification models: https://github.com/kitzeslab/bioacoustics-model-zoo/

and opensoundscape: https://github.com/kitzeslab/opensoundscape which uses pytorch

The front end will be fluid, modern, intuitive, and attractive. 

Users can customize preprocessing, training, and inference settings. These settings are saved and loaded from configuration files. Python scripts for pytorch model inference and training run in subprocesses and reference the configuration files. 

The app will be built for desktop guis on Mac, Linux, and Windows. Python environments will be bundled and shipped to the user. Users should simply be able to install and launch the app, then use GUI workflows for model training and inference. 

streamlit_inference.py is provided as a reference for understanding and porting basic functionality, but not as a final product. 

# Build pipeline checklist
- pyinstaller build of lightweight env is working
- running app using pyinstaller for lightweight backend: works well
- conda-pack is now succeeding after resolving issues with packages installed with conda then modified by pip
- the environment built with conda pack works. I can run /path/to/env/bin/python backend/scripts/predict.py --config /path/to/config.txt. It runs inference and creates the csv. 
- inference in the GUI is broken

# Visual design

For theming, let's switch to using Material UI components, icons, and theming throughout
Installation: (I ran this myself)
npm install @mui/material @emotion/react @emotion/styled

Start by taking a close look at this Material UI "Dashboard" example project:
https://github.com/mui/material-ui/tree/v7.2.0/docs/data/material/getting-started/templates/dashboard 
Usage instructions (if we were using the example template):
- Copy these folders (dashboard and shared-theme) into your project, or one of the example projects.
- Make sure your project has the required dependencies: @mui/material, @mui/icons-material, @emotion/styled, @emotion/react, @mui/x-charts, @mui/x-date-pickers, @mui/x-data-grid, @mui/x-tree-view, dayjs
- Import and use the Dashboard component.
- 

(we will eventually use date pickers and charts)

Use default light color theme, for now. Use the icons from material-ui throughout.  

For fonts let's switch to Monserrat, via FontSource

I already ran npm install @fontsource-variable/montserrat

We can import it in the entry point like this:
import '@fontsource/monserrat/300.css';
import '@fontsource/monserrat/400.css';
import '@fontsource/monserrat/500.css';
import '@fontsource/monserrat/700.css';

Review tab visuals:
- dB range slider still has poor appearance. use the react material-ui range slider
- also throughout, switch to using the AutoComplete element from material-ui for multi-selects . example:
<Autocomplete
        multiple
        id="tags-outlined"
        options={speciesList}
        getOptionLabel={(option) => option.title}
        defaultValue={[speciesList]}
        renderInput={(params) => (
          <TextField
            {...params}
            label="select species"
            placeholder="Selected labels"
          />
        )}
      />
(including the multi-selects for filtering by labels in Review tab)




previous color scheme:
but these colors for accents: 
#eae0d5 off-white shades
#395756 dark accent 1
#4f5d75 dark accent 2
#c6ac8f medium accent
#d36135 highlights/alert


# Review tab:
User will select an annotation task. The interface will be very similar to that implemented in backend/reference/binary_classification_review.py:
- the annotation task is a csv with the relative audio path `file`, `start_time` in seconds of the clip within the audio path, `annotation`, and `comments`
- grid of spectrogram/audio clip cards displayed to user, with pagination over all rows in the annotation task
- there will be two review modes: binary review and multi-class review
- binary review: as in binary_classification_review.py, there is a multi-select for 'yes' 'no' 'uncertain' or 'unlabeled' for each audio clip. A visual effect (eg colored outline green/yellow/red/grey) indicates the current label of the clip. Optionally, the user can toggle on "show comment field" and write text comments. `annototation` value is yes/no/uncertain or empty (nan) for not annotated
- multi-class review: each audio clip panel has multi-select (react-select) instead of multi-select of yes/no/uncertain/unlabeled. `annotation` column will contain a comma-separated list of classes ['a','b']. Empty list [] indicates annotated and no classes, whereas empty / nan indicates the clip has not been annotated. 
- implement a settings panel with spectrogram window length, frequency bandpass range, dB range, colormap, number of rows and columns for grid of displayed clips, show/hide comments field, show/hide file name


## build strategy
- implement saving and loading all inference settings, including paths, to a config file. The path to the config file will be the single argument taken by the inference.py script. 
- we will use pyinstaller to build an executable for the backend scripts EXCLUDING ml and heavy dependencies (no predict, train embed). The scripts should only depend on pandas, matplotlib, numpy, librosa, etc. They will not require pytorch, opensoundscape, or bioacoustics-model-zoo
- we will build frozen python enviornment(s) that will be downloaded on an as-needed basis: for now, just dipper_pytorch_env.yml which we will build using conda-pack to create a .tar.gz. 
- inference will run in the background by writing a config file, and running the python script specifying the inference environment python, something like `/path/to/dipper_pytorch_env/bin/python inference.py --config inference_config.yml &"
- make sure we can build the app, communicate between the frontend and backend with the pyinstaller compiled simpler backend enviornment, build the distributable environment with conda-pack, and run a simple python script using the conda-pack env


## Shortcuts for review tab (when in grid view):
- generally, use ctrl for window and cmd for mac
- toggle shortcuts on/off in the settings tab
- ctrl/cmd+shift+C: show/hide comments
- ctrl/cmd+A/S/D/F: annotate all clips on page as yes/no/uncertain/unlabeled (only has an effect in binary classification model)
- ctrl+j/k: previous/next page 


## Filtering by annotation for review tab
- in the left tray, add a multi-select box for filtering by annotation
- in binary review mode, filters by `annotation`, and a checkbox to enable/disable filtering
- in multi-class review mode, provides two filter multi-selects: filter by label with enable/disable, and filter by annotation status with enable/disable


## Review tab Focus view refinements
- compact the controls: file name, annotation buttons, audio playback, comments, and forward/backward should all be smaller and be located neatly beneath the spectrogram view 


## Focus mode for review tab
- provide a toggle at the top of the review page to switch between viewing lots of clips on a page (current setup) and viewing a single, large spectrogram (click to play) in 'focus' mode.
- in focus mode, offer these shortcuts for binary classification mode: "a" = yes, "s" = no, "d" = uncertain, "f" = unlabeled. "j" view previous, "k" view next clip. spacebar to play/pause audio. 
- in focus mode, auto-advance to next clip when user clicks or uses shortcut to provide an annotation of yes/no/unknown/unlabeled
- in settings panel, add a check box for whether to auto-play clips when using focus mode. When checked, the audio begins as soon as the spectrogram is displayed. 
- help me debug why spectrograms appear as white-on-black instead of in color when choosing a colormap

## auto-save for review tab
- create a session variable for where to save annotations
- add a toggle/button switch for auto-save on/off, default on
- user selects the save location with a button
- any time the user changes page or goes to previous/next clip in focus mode, auto-saves if auto-save is on
- if save location has not been set, opens a File Save As dialogue to select the file

# Incomplete items:

## app-wide updates
We need to implement a thorough "help" functionality:
- help page implemented as a separate tab has detailed descriptions of how to use each page and the settings within. Organized by tab name (top-level header), then by major functionalities, then by specific settings. Under the top-level header describe the general purpose and how to use the page, eg for Inference tab describe that the tools are used to run existing machine learning models on audio data to detect classes of interest; that user will select audio files and parameters; that outputs are saved to files and can be loaded in the review tab to inspect results. 
- small question-mark icon next to buttons, form fields, settings fields across the app: hover text is "get help", and clicking the icontakes you to the relevant section of the help page

- the multi-selects for filtering should use the same type of selector as the annotation panels, react-select

# feature requests

## rewind
- throughout the application, when providing click-to-play spectrograms, make it so that clicking on the left 20% of the spectrogram rewinds the clip to the beginning instead of performing the play/pause action. Show a rewind icon when hovering over the left 20% of the spectrogram. 

## create inference or annotation tasks via filtering and stratification: 
from a "wizard" or from Explore tab

start by creating or providing a table of audio file | location | start_timestamp | end timestamp

filter to:
- dates
- times of day

stratification by: metadata columns, date

within stratification bins, selection based on score:
- score range / threshold -> random sample
- stratified score bins -> random sample
- score-weighted or z-score weighted sampling
- highest scoring N clips

## preprocessing "wizard"

## Remote mode
- install on a remote machine accessed via SSH
- replace native filesystem / other native system interactions with text fields or other working alternatives
- avoid system alerts/dialogues, which won't work

- make sure none of the other features depend on electron
- provide instructions for port forwarding to access the gui on a web browser

alternatively, could run backend on remote, run frontend locally, connect to backend via GUI on frontend. This seems more complicated overall because it requires more custom IPC.

## Training
Implement a Training tab with a Configure Training Run panel and task monitoring of training runs, similar to the Inference tab and Inference task tracking system. 

We will use a model configuration panel to load and save model configuration parameters to a config file. 

Completed Inference tab 

Config: 
- select a model from bioacoustics model zoo
- specify class list (comma or return delimited) in text box
- select one or more annotation_files:
    - fully_annotated: csvs of labeled audio for all classes with file,start_time,end_time,and col for each class. OR csv with cols: file,start_time,end_time,labels,complete (EG result of using Review tab in multi-class classification mode)
    - single_class_annotations: csvs of clips annotated for a single species. cols: file,start_time,end_time,annotation. EG result of using Review tab in binary classification mode. For each of these, the user should specify which class was annotated from a dropdown populated with class list from above. 
- optionally select dataframe of "background" samples
- select root audio folder (if dataframes use relative paths)
- optionally select an evaluation task (annotated dataframe with same format as training dfs: file,start_time,end_time,and col for each class)
- select save location for trained model
- training settings: batch size, N parallel preprocessing workers, freeze feature extractor (True/False), 

training script example: (don't worry about the TODO's for first iteration)
backend/scripts/train_model.py


training form tweaks:
- class list: put this field after annotation loading fields. If empty, automatically populate from the first file selected in fully annotated files selection, using the columns (not including the first 3: file, start_time, end_time). 

### Training wishlist
- convert Raven annotations to training data
- num classifier layers (default 1, options 1,2,3,4)

## embedding: 
add toggle in inference script to embed instead or in addition to classification

# TODO fixes and tweaks

# updates for review tab

- Focus mode: move comments field to sit on the right side of the controls, rather than below the other controls. Use the full width for the controls + comment field. 

- review-content focus-mode and review-content grid-mode divs are taking up space even when they are empty. This causes the "ready for annotation review" text to display far down the page under the empty but large grid-mode div. It might also be the reason that there is always a scroll bar even when the page is not full

- reference frequency line not showing. To create the reference frequency line, should make the pixels maximal value at the relevant row of the spectrogram. 

- there is small black line at bottom of every spectrogram, but only when resizing is enabled. Seems to be an issue with the backend spectrogram creation creating a row of zeros 

- bottom status bar and top button bar: currenlty they can scroll out of view but they should always be visible. Should not be in an outer div that doesn't scroll with the content.

consolidate the global theming options into a simple config or css file, so that I can make edits to the set of colors, fonts, font weights, font sizes, overall spacing values in one place for the entire app. 

- if one or more audio files is not found when trying to display it, provide a helpful message like: f"Audio file was not found in {absolute_path}.  Set 'Root Audio Folder' to the location from which relative paths are specified in the 'file' column of the annotation csv, or clear it if absolute paths are specified."

## conda-pack updates:
- if on linux or mac, include ai-edge-litert as a dependency and allow BirdNET use in the inference gui

inference issue: BirdSet model not producing outputs if clips are <5 seconds

## inference tab updates:
- app should download the appropriate env for inference if needed. tell user its downloading and will be saved for future use

- checkbox for 'Separate inference by subfolders'

### add process ID tracking to reconnect with running process across app close/restart
The running task continues when the app quits.

  Here's what happens:

  1. Inference subprocess keeps running - The python inference.py process started
  by lightweight_server.py runs independently
  2. Server shuts down - The HTTP server stops, losing connection to the subprocess
  3. Task status becomes orphaned - On restart, the task gets reset to QUEUED
  status (we just fixed this)
  4. Results still get saved - The inference completes and saves output files
  normally

  Issue: No way to reconnect to the orphaned process or get its results back into
  the task system.

  Potential improvements:
  - Add process ID tracking to reconnect on restart

## inference tab updates:

### wish list
for completed tasks, add buttons to
- open results in Explore tab
- create annotation task (we need to implement a wizard/panel for this)
- subset classes: can use text file or ebird filter
- optional sparse outputs: don't save scores below a floor, and save df as a sparse pickle


Inference settings panel: 
- remove "saved" and "loaded" alerts after save/load of json config. Instead just put a message in the status bar. 

option to split up inference tasks into one task per subfolder


- TODO: how to divide up inference task? by subfolders? aggregate results or keep separate?
- TODO: better progress reporting, currently goes from 0-100 instantly
- TODO: smart segmenting into subtasks for large prediction tasks, with intermittent saving


# Explore tab updates
- should have a little button in the panel (gold medal icon: 🥇) to return to viewing the highest-scoring clip (eg after clicking on a histogram bin)
- put the settings in a side panel/tray, exactly like the settings panel in the review tab

future items:
- use Material UI badges and small photos of the class detected for quick overview (use birdnames repo for name translation, find open-source set of images for species headshots or use the global bird svgs dataset)

