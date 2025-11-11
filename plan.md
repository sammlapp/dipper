This project will create a cross-platform desktop app that runs pytorch machine learning models and allows users to train models in an active learning loop. 
  
Conda environment: `conda activate train_gui`

The project will use the bioacoustics model zoo for pre-trained bioacoustic identification models: https://github.com/kitzeslab/bioacoustics-model-zoo/

and opensoundscape: https://github.com/kitzeslab/opensoundscape which uses pytorch

The front end will be fluid, modern, intuitive, and attractive. 

Users can customize preprocessing, training, and inference settings. These settings are saved and loaded from configuration files. Python scripts for pytorch model inference and training run in subprocesses and reference the configuration files. 

The app will be built for desktop guis on Mac, Linux, and Windows. Python environments will be bundled and shipped to the user. Users should simply be able to install and launch the app, then use GUI workflows for model training and inference. 

streamlit_inference.py is provided as a reference for understanding and porting basic functionality, but not as a final product. 

## minimal changes:
allow tasks to run on parallel if user clicks run in parallel

# Build pipeline checklist
- pyinstaller build of lightweight env is working
- running app using pyinstaller for lightweight backend: works well
- conda-pack is now succeeding after resolving issues with packages installed with conda then modified by pip
- the environment built with conda pack works. I can run /path/to/env/bin/python backend/scripts/predict.py --config /path/to/config.txt. It runs inference and creates the csv. 

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


### active clip functionality in grid view
one clip is active at a time. 
- the active clip is always one of the clips on the current page. If page changes, set first clip on page as active
- The active clip has a thicker outline on the display panel
- Binary classification mode: user can use a/s/d/f shortcuts to annotate the active clip; when a/s/d/f is clicked, "active" clip moves to the next clip; if last clip on page, transitions to next page and first clip on new page is active; user can navigate Active clip to previous/next clip on page with j/k
- Multi-class classification mode: the multi select of the active clip is activated, so that the user can simply start typing labels.
- active clip does not go beyond first/last index on the page (no advance from last clip on page, no backwards-move from first clip on page); 
- when switching to focus mode, the clip that appears in the focus mode display is the clip that was "active" in grid mode
- clicking on a panel (somewhere other than the spectrogram, comments box, or annotation controls) makes that clip active

### Classifier-guided listening (CGL)

We are going to introduce an option called "classifier-guided listening". When selected, the clips on a page in grid view are determined by stratification based on metadata columns in the annotation csv. For instance, the annotation csv could contain columns "location_id" and "primary_period". Then there will be one page of clips for each unique combination of "location_id" and "primary_period". The user selects the names of columns to use for stratification in a menu panel. The user can also select a column containing classifier score, in order to sort the displayed clips on the page from highest to lowest classifier score. There is also a menu option for the maximum number of clips to display per stratification bin, default 20. 
Since the set of clips on a page is determined by the stratification bins, the "number of rows" menu option will be ignored when classifier-guided listening is enabled. The number of columns menu option is still used, and the grid contains as many rows as needed to display all clips in the stratification bin. 
Importantly, the user can also specify rules for when to stop annotating within a bin (see below). When a bin is complete, the GUI auto-advances to the next page. 

Here's what we need:
- a module implementing the logic for finding unique combinations of the selected stratification columns and generating the sets of clips to be displayed on each page
- a brand new panel in the GUI, accessed via a button called "classifier guided listening", with menu options for: (0) turning on/off classifier guided listening mode. (1) selecting columns of the loaded csv to use for stratification; (2) selecting a column to use as the classifier score, plus a toggle for displaying the clips in (a) original order (b) highest to lowest score (c) random order. 
- "bin completion" logic: the user specifies a strategy to use for when the stratification bin is considered complete. The options are 

(1) All: annotate all clips in bin

(2) Binary: annotate until [select number] clips are labeled Yes; A bin is also 'complete' if all clips are labeled with any of yes/no/uncertain, even if the desired count of Yes has not been reached

(3) Multi-class: annotate until the count of any of these labels: [multi-select labels] is: [select number]. Clips only count toward the total when they are marked 'complete'. A bin is also 'complete' if all clips are marked 'complete', even if the desired count has not been reached. 

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

## auto-save for review tab
- create a session variable for where to save annotations
- add a toggle/button switch for auto-save on/off, default on
- user selects the save location with a button
- any time the user changes page or goes to previous/next clip in focus mode, auto-saves if auto-save is on
- if save location has not been set, opens a File Save As dialogue to select the file


# requested / complete:

## clip extraction / annotation task creation

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

### Extraction tab
We will have a separate script that creates and runs the extraction task from the config file, in a background process using the pytorch python environment. 

- User selects a folder containing inference outputs (predictions.csv or .pkl)
CSVs should all have the same set of columns: 'file','start_time','end_time', then one column per class
- User selects class list with a multi-select populated by the score file columns
- User selects type(s) of stratification:
The idea of stratification is that for each unique combination of each value, a fixed number of clips are chosen for annotation
EG if you stratify by 4 date windows and subfolders (say there are 5), and you choose N=1 clip per stratification, you get 4x5x1=20 clips to review for each species. 
  - stratify by subfolder
  - (more types of stratification by date windows, time windows, and folder metadata to be implemented later)
- user selects type(s) of filtering:
  - filter by score threshold: remove any scores beneath a threshold
  - (later we will implement date and time window filtering)
- User selects type of extraction for each unique comination of the stratification values:

  - random N clips
  - score-bin stratified: N clips for each score bin
      - text field allows specification for score percentile bins
      - default: [[0,75],[75,90],[90-95],[95,100]]
      - these values represent score percentiles, NOT raw scores
      - percentiles should be calculated after applying the score threshold
  - highest scoring: fixed N clips with the highest scores
  Multiple strategies can be chosen, rather than just one. Clips selected from each
  strategies are added to a single annotation task csv. 


Select an output directory

Check box for `export associated audio clips`
- if selected, can specify total clip duration to extract
- extracted clip is centered on the `start_time,end_time` interval of the selected clip. Eg for 5 seconds with start_time=10,end-time=13, select 9-14
- clips are extracted to `output_directory/clips/`

Select 'binary annotation' or 'multiclass annotation' mode:
Binary annotation: Clicking `Run extraction task` creates one csv file per species in `out_dir/{species_name}_annotation_task_{timestamp}.csv` with columns `file,start_time,end_time,annotation,score`. 
Multi-class annotation: Clicking `Run extraction task` creates one csv file `annotation_task_{timestamp}.csv` for all species, with same columns as loaded score files. 

The contents of the 'file' column in the created csv files depends on whether audio clips are extracted:
- if audio clips are extracted, put clips in `out_dir/clips/` and use the relative path in the file column. Start time and end time will be relative to the extracted clip. eg `"clips/clip1.wav",0,3,5.2,-1.5,...` for one of the clips. 
- if audio clips are not extracted, keep the same `file` `start_time` and `end_time` values as the original df

Extraction:
- Clips can be efficiently extracted with `opensoundscape.Audio.from_file(file,offset=,duration=).save(clip_save_path)`
- if the same audio clip is selected for multiple species, do not extract multiple copies of it: instead refer back to the same clip name
- attempt to include the correct root audio dir to use for the Review tab in the config file. Correct root audio dir is output_dir if extracting audio clips, or the same root audio dir as the inference config file if not extracting clips

Test out the script on /Users/SML161/Downloads/HawkEars_Embedding_-_1_files_-_7272025_10843_AM/predictions.csv

# Incomplete items / TODO /feature request

## general feature request list 

get xeno-canto recordings for a species to supplement training data?!

potentially allow parallel as well as sequential tasks

denoising and/or bandpassing for audio playback / review

wandb integration with training & inference for logging progress and model evaluation: login on global settings page, specify user/project/run name/notes in configuration panel; if used, provide link to wandb page in task panels

for clip review from query/explore mode: "add to cart" button on panel, adds the clip to an annotation "cart" that can be exported as an annotation task

## Extraction improvements:
Stratification by folder metadata (eg 'primary period', 'secondary period','site', 'treatment group')

#### For stratify by folder metadata:
user selects a csv file with `folder` column and other columns
form populates with multi-select of the other columns
user selects which other columns to use for stratification
form displays the number of unique values for each selected stratification column


#### For stratify by date window: 
display a panel with a table of MUI date range pickers. Starts with no rows.
Provide 'delete' buttons for each added row, and an 'add' button below the table to add a new date range. 
Example of DateRangePicker from MUI:
```
import * as React from 'react';
import { DemoContainer } from '@mui/x-date-pickers/internals/demo';
import { LocalizationProvider } from '@mui/x-date-pickers-pro/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers-pro/AdapterDayjs';
import { DateRangePicker } from '@mui/x-date-pickers-pro/DateRangePicker';

export default function BasicDateRangePicker() {
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <DemoContainer components={['DateRangePicker']}>
        <DateRangePicker />
      </DemoContainer>
    </LocalizationProvider>
  );
}
```
  

## app-wide updates
Hawkears not loading offline - HTTP error something to do with download-cached-file I think

- the multi-selects for filtering should use the same type of selector as the annotation panels, react-select

review tab "undo" functionality? I think this would require tracking the full-page or single-clip annotations in a history so that we can sequentially undo and redo changes witch ctrl/cmd+z and ctrl/cmd+y

## HAWKEARS Low band is broken in v0.12.0: 
need to update BMZ version then update dependency

## review tab
- settings checkbox to show/hide the yes/no/uncertain/unlabeled segmented control for each clip panel in grid mode + binary classification: default is checked; when un-checked user can still annotate via keyboard controls and active clip navigation but the panel is compact with no segmented control shown
- don't like the visual aesthetic of the segmented controls. Let's try something different while retaining the per-button coloring and functionality
- add settings option for whether to auto-advance after an annotation in Focus mode
- "status bar" is being covered by the global app status bar in App.js instead of integrating with it. 
- auto-advance in classifier-guided listening mode: 

### ✅ Review-only App
within this project, create a separate deployable/buildable version of the app that only includes the Review tab. In this version of the app, we can remove page navigation as there will only be one page. We should be able to build this app as a desktop executable that includes the lightweight compiled python environment.

- the offset of main content vs top menu bar isn't working correctly. When the window is narrow the menu bar will wrap around and become larger, causing it to cover the top of the main content. The main content should simply always be below the menu bar. It seems like there should be a simpler way to do this than trying to calculate the expected height of the menu bar, by placing the element below the menu bar instead of behind it. 

**COMPLETED**: Created review-only version of Dipper
- Modified App.js to conditionally render based on `REACT_APP_REVIEW_ONLY` environment variable
- Created separate Electron main process file (`main-review.js`) with "Dipper Review" branding
- Added build scripts to package.json:
  - `npm run electron-dev-review` - Development mode
  - `npm run build:review` - React build only
  - `npm run build:review-all` - React + Python build
  - `npm run dist:review-mac` - macOS distribution build
- Created electron-builder-review.json for separate build configuration
- App builds to `dist-review/` directory
- JavaScript bundle is 31KB smaller than full app
- No navigation drawer - full width used for Review interface
- Includes full Python HTTP server for audio processing
- See REVIEW_ONLY_APP.md for complete documentation  


## Training with hoplite
I implemented training with hoplite in opso branch
Now can have a script that
- selects hoplite db and embedding model
- ingests various training/val sets with single target or multi-target labels
- embeds any training/val sets as necessary


## rewind
- throughout the application, when providing click-to-play spectrograms, make it so that clicking on the left 20% of the spectrogram rewinds the clip to the beginning instead of performing the play/pause action. Show a rewind icon when hovering over the left 20% of the spectrogram. 

## Remote mode
- install on a remote machine accessed via SSH
- replace native filesystem / other native system interactions with text fields or other working alternatives
- avoid system alerts/dialogues, which won't work
- add Global Settings page with option to switch between remote and desktop versions
- make sure none of the other features depend on electron
- provide instructions for port forwarding to access the gui on a web browser
- launch from CLI with argument for HTTP forwarding port
- will need to refactor the backend: in desktop mode, use electronAPI, in remote server mode, use aiohttp or something for the API calls; extract shared functionality between the two modes to separate functions to avoid redundancy. Or write in a way that works for both. 
- Streamlit has some nice backend support for multiple users using the same hosted app, but ours will not. Think carefully about what would happen if multiple users used the app on a multi-user machine. This gets quite a bit more complicated. Probably want to launch a separate instance of the app for each user/session and prevent multiple users from using the same session. 
- would be huge if task management can be integrated across users; eg what if two people run the app on the same server, should have a central task management system and run jobs sequentially

alternatively, could run backend on remote, run frontend locally, connect to backend via GUI on frontend. This seems more complicated overall because it requires more custom IPC.


### Training wishlist
- convert Raven annotations to training data
- create labels from subfolder structure (wrote this in a python notebook)
- Weldy style noise augmentation (wrote this in a python notebook)
- preprocessing "wizard": started notebook for prototype

## embedding: 
add toggle in inference script to embed instead or in addition to classification

## HOPLITE embedding and shallow classification 
(eventually add Query also)

 I have implemented functionalities for "embed audio to database" (mode='embed_to_hoplite') and "apply shallow classifier" (mode="classify_from_hoplite") modes in the inference.py script. We need to expose these functionalities to the user on the front end. In the Inference tab, we need to toggle between "End-toEnd Classification", "Embed to Database", and "Apply Shallow Classifier to Embedding DB" modes with a multi-select. Some of the inference paramters will be exposed depending on this selection.
End-toEnd Classification: 
- shows the current fields "Save sparse outputs" (checkbox) and "Separate inference by subfolders"
- model selection is same as current (bmz model or local model)
Embed to Database:
- instead of Save sparse outputs and Separate inference by subfolders fields, shows multi-select for database selection: 
- Create New Hoplite Database (user selects parent folder and enters name of new db in a text field)
- Add embeddings to existing Hoplite Database (user selects an existing folder; system confirms that "hoplite.sqlite" file exists in the folder)
and shows a text field for 'dataset name' 
- model selection is same as current (bmz model or local model)
Apply Shallow Classifier to Embedding DB:
- user selects a folder containing the HopLite Embedding DB
- user selects a shallow classification model file (extension: .mlp)
- also shows the current fields "Save sparse outputs" (checkbox) and "Separate inference by subfolders"



Otherwise, the task creation form remains the same. When Embed to database is selected in the multi-select, a different 


## updates for review tab
consolidate the global theming options into a simple config or css file, so that I can make edits to the set of colors, fonts, font weights, font sizes, overall spacing values in one place for the entire app. 

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


## Annotation task creation panel Improvements:
- Review tab binary classification: check box in settings to show f"Score : {row['score']:0.2f}" in the clip display panel (just below audio file display position)

## Classifier-guided listening
annotation pane: if using early stopping mode:
- annotation csv has column for 'group name': combines any stratification eg by date window, point name
- create a state variable tracking group_name:status, where status is (a) 'unverified candidate detection' (>=1 clips in group, no verified detections, >=1 unannotated or uncertain clips), (b) 'verified detection' (>=1 yes annotation), (c) 'verified non-detection' (all clips in group labeled no), or (d) 'no candidate detection'. 
- filter to clips in groups with status 'unverified candidate detection'
- order clips by group
- display group in clip panel

## inference tab updates:
for completed tasks, add a button to create an annotation task

Too many subfolders in job folder: after creating job folder for inference/train with unique name, should be flat file structure with config.json, logs, and any outputs such as inference predictions.csv or saved model objects. 

Add a button for each task in the task manager to "load config" -> loads that task's config to the configuration form, switching to train/inference tab as appropriate. 


for completed tasks, add buttons to
- open results in Explore tab
- create annotation task (we need to implement a wizard/panel for this)
Inference:
- subset classes: can use text file or ebird filter

Inference update:
- optional sparse outputs: don't save scores below a floor, and save df as a sparse pickle
I've implemented this in inference.py using config['sparse_save_threshold']. Update the frontend inference config creator to:
- toggle on/off an option to save only values below a threshold. If off, config['sparse_save_threshold'] is none/null
- if toggled on, user specifies the numeric threshold for the logit score beneath which scores are discarded, default value -3. config['sparse_save_threshold']
- output_file of the config should be predictions.csv if sparse_save_threshold is None and sparse_predictions.pkl if the threshold is used


- explore tab should support loading sparse predictions (.pkl) as well as csv files (.csv). This will require using python backend to run `sparse_df_loaded = pd.read_pickle("sparse_df.pkl")`. the sparse values are np.nan and should always be treated as non-detections. The unpickled df will be a dataframe with the multi-index 'file','start_time','end_time'.

TODO:
- allow setting threshold when loading an annotation task in Review mode

# Explore tab updates
- should have a little button in the panel (gold medal icon: 🥇)  to the right of the title, to return to viewing the highest-scoring clip (eg after clicking on a histogram bin)
- put the display settings in a side panel/tray, like the settings panel in the review tab. Make sure the settings are properly implemented and are not mixed up with the display settings for the review tab. 
- images are being cut off at the bottom. Resize them to the height of the 

future items:
- use Material UI badges and small photos of the class detected for quick overview (use birdnames repo for name translation, find open-source set of images for species headshots or use the global bird svgs dataset)


when selecting models in inference or training mode, we should be able to select a local model file instead of 