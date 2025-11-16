This project will create a cross-platform desktop app that runs pytorch machine learning models and allows users to train models in an active learning loop. 

## minimal changes:
allow up to N background tasks to run in parallel if user clicks run in parallel


# Build and release
- lightweight python executable for GUI back-end is built with pyinstaller
- heavy python environment is built with conda-pack (inference, train scripts)
- inference, train, extraction scripts run in separate processes and are tracked by task manager
- these run with the built-in heavier conda env (downloaded on demand to application cache dir) unless the user specifies a custom python env to use
- an annota
# Incomplete items / TODO /feature request

tion-only version of the app can be built

## next steps:
separate HopLite Database-oriented embed, train, and predict into its own area
test using custom models
test builds that allow inference and training
get feedback on inference and training builds
running on servers: port forwarding or otherwise providing a web-based gui where user can access Dipper running on a remote machine
- need to be very careful with multi-user scenarios, sessions, what happens when more than one person using Dipper

- IPC may be unnecessarily complicated. PyInstaller build is likely overly complicated: I think we should be able to use other modules without the "sys.path.append" workarounds to find the modules. 

- saving/loading annotation settings to json: includes view settings and CGL
- CGL true/false should persist across app restart

- stratification by arbitrary columns for clip extraction

- delete archive file of pytorch env after unpacking
- eventually will want to choose between pytorch envs depending on (1) operating system, (2) model being run

## general feature request list 

get xeno-canto / other public recordings for a species to supplement training data?!
- this functionality is now provided in Jan's package

denoising and/or bandpassing for audio playback / review

wandb integration with training & inference for logging progress and model evaluation: login on global settings page, specify user/project/run name/notes in configuration panel; if used, provide link to wandb page in task panels

for clip review from query/explore mode: "add to cart" button on panel, adds the clip to an annotation "cart" that can be exported as an annotation task


review tab "undo" functionality? I think this would require tracking the full-page or single-clip annotations in a history so that we can sequentially undo and redo changes witch ctrl/cmd+z and ctrl/cmd+y


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

- "status bar" is being covered by the global app status bar in App.js instead of integrating with it. 
- auto-advance in classifier-guided listening mode: 

Something is wrong with the way grid mode is rendering when CGL is enabled. When CGL is off, I can create a grid with 2 columns, but when CGL is on, choosing 2 columns setting creates only 1 column in the displayed grid. 

### ✅ Review-only App
within this project, create a separate deployable/buildable version of the app that only includes the Review tab. In this version of the app, we can remove page navigation as there will only be one page. We should be able to build this app as a desktop executable that includes the lightweight compiled python environment.

- the offset of main content vs top menu bar isn't working correctly. When the window is narrow the menu bar will wrap around and become larger, causing it to cover the top of the main content. The main content should simply always be below the menu bar. It seems like there should be a simpler way to do this than trying to calculate the expected height of the menu bar, by placing the element below the menu bar instead of behind it. 

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