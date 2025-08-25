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


## requested / complete:

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

# Incomplete items:
improve paging display for review tab: should show previous specs then replace with new ones, rather than briefly showing the 'loading spectrograms' on a white page.

get xeno-canto recordings for a species to supplement training data?!

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
  

## Review tab Focus view refinements
- the spectrogram should be resized to fit focus-spectrogram-container
- default size should be the size that focus-spectrogram-container currently defaults to (most of page width)
- instead of specifying size in pixels for focus view settings, user can select 'large' 'medium' or 'small', and the focus-spectrogram-container is sized according to the page (large: takes up the whole available width)

## Review tab grid view updates:
- resizing is not working properly, because the spectrogram is sometimes not fully displayed in the panel. The spectrogram should always fit within the displayed panel. 

## app-wide updates
- the multi-selects for filtering should use the same type of selector as the annotation panels, react-select

review tab "undo" functionality? I think this would require tracking the full-page or single-clip annotations in a history so that we can sequentially undo and redo changes witch ctrl/cmd+z and ctrl/cmd+y

toolbar in review tab: if too wide for current window, should float the tools onto another line like line-wrapping in a textbox. 

# feature requests and TODO

Inference and training tabs: at the end of the form, add a checkbox to run a small test job on a subset of clips/files. 

potentially allow parallel as well as sequential tasks

denoising and/or bandpassing for audio playback / review

wandb integration with training & inference for logging progress and model evaluation: login on global settings page, specify user/project/run name/notes in configuration panel; if used, provide link to wandb page in task panels

# HAWKEARS Low band is broken in v0.12.0: 
need to update BMZ version then update dependency

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
- add Global Settings page with option to switch between remote and desktop versions
- make sure none of the other features depend on electron
- provide instructions for port forwarding to access the gui on a web browser
- launch from CLI with argument for HTTP forwarding port
- will need to refactor the backend: in desktop mode, use electronAPI, in remote server mode, use aiohttp or something for the API calls; extract shared functionality between the two modes to separate functions to avoid redundancy
- Streamlit has some nice backend support for multiple users using the same hosted app, but ours will not. Think carefully about what would happen if multiple users used the app. This gets quite a bit more complicated
- would be huge if task management can be integrated across users; eg what if two people run the app on the same server, should have a central task management system and run jobs sequentially

alternatively, could run backend on remote, run frontend locally, connect to backend via GUI on frontend. This seems more complicated overall because it requires more custom IPC.


### Training wishlist
- convert Raven annotations to training data
- create labels from subfolder structure (wrote this in a python notebook)
- Weldy style noise augmentation (wrote this in a python notebook)

## embedding: 
add toggle in inference script to embed instead or in addition to classification


# updates for review tab

- reference frequency line not showing. To create the reference frequency line, should make the pixels maximal value at the relevant row of the spectrogram. 

- there is small black line at bottom of every spectrogram, but only when resizing is enabled. Seems to be an issue with the backend spectrogram creation creating a row of zeros 

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


## Annotation task creation panel
Improvements:
- rename this panel from Annotation to Extract. Rename first two panels to 'Predict' and 'Train'. 
- Review tab binary classification: check box in settings to show f"{class} : {classifier_score:0.2f}" in the clip display panel (just below audio file display position)
- include additional columns in the exported csv for any stratification levels used (subfolder, )
- each job should create a job folder within the user-specified output directory and store all outputs within the job folder 

Implement a new tab for creating annotation tasks
It will select subsets of clips from ML predictions.csv files, and create an annotation task from the results.

- all settings are saved and can be loaded from a json config file




## inference tab updates:
for completed tasks, add a button to create an annotation task

Too many subfolders in job folder: after creating job folder for inference/train with unique name, should be flat file structure with config.json, logs, and any outputs such as inference predictions.csv or saved model objects. 

Add a button for each task in the task manager to "load config" -> loads that task's config to the configuration form, switching to train/inference tab as appropriate. 

### wish list
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