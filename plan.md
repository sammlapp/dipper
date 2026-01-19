This project will create a cross-platform desktop app that runs pytorch machine learning models and allows users to train models in an active learning loop. 

## claude start up prompt
take a close look at this codebase, especially documentation markdowns such as readme.md claude.md build.md. We're going to work from plan.md on ## next steps but first I want you to have a good sense for how the code base works and what is currently implemented. Carefully read the main implementation files: src/App.js, src/AppReviewOnly.js, lightweight_server.py, scripts/train_model.py, scripts/inference.py, scripts/clip_extraction.py

# Build and release
- lightweight python executable for GUI back-end is built with pyinstaller
- heavy python environment is built with conda-pack (inference, train scripts)
- inference, train, extraction scripts run in separate processes and are tracked by task manager
- these run with the built-in heavier conda env (downloaded on demand to application cache dir) unless the user specifies a custom python env to use
- an annotation-only version of the app can be 
- server mode: user clones github repo, runs install script, edits config file, launches server that can be accessed on web browser via port forwarding

# Incomplete items / TODO /feature request

- need to resovle issues with building conda-pack env for Windows

test downloading/using default conda-pack env on linux! (updated conda pack env; need to rerun github runner and re-upload to onedrive)

Task status updates: "toast" notifications appear regardless of which tab you are viewing; go away after a few seconds, or user can dismiss 
https://mui.com/material-ui/react-snackbar/
Colors match coloring of tasks in task pane for running (started)/queued/canceled/failed/pending/completed
- [task name] started (<task type>) (blue)
- [task name] queued (task type) (purple)
- [task name] created (Waiting on user to start) (grey)
- [task name] completed  (task type) (green)
- [task name] failed (task type) (red)
- [task name] canceled (task type) (yellow)

### User feature requests
JT Larkin:
- CGL stopping criterion for number of negative clips in bin

Matt Weldy:
GCL should work without stratification; eg should be able to sort by score (be cautious: sorting could be slow for large set of clips; but maybe we don't really use clip tables that big)

Lauren Chronister:
should not create annotation_status column when using binary annotation
(currently creates it if you flip the UI to multi-class annotation, even if you don't add any annotations)

Davis Hines:
- clip download from focus view (esp in remote mode)
when you annotate, it continues playing the old clip even after youve selected a label with asdf-keys, which plays overtop of the other clip, which detracted from the softwares intended function of fast review
- I actually like this feature, but we could make it configurable

would be nice to have a audacity esq bar that tranverses the entire spectrogram to visualize what part of clip is playing (vertical scroll bar shows playback position; this exists in focus mode already)
would be nice to have arrow key functionality to navigate active clip (j/k navigate next/previous, but arrows navigate up/down/left/right for active clip in grid mode)

would be nice to have multi selection feature (shift-click) to annotate a string of clips with the same label

Santiago:
frequency axis kHz ticks and tick labels on spectrograms
- configurable to show/hide
configurable color for referecne frequency line

Louis/Lauren/lab:
- alternative multi-class annotation mode: button for each class, click for present (green)/not (grey), or to be most general, click through yes/no/uncertain/unlabeled on each class
- the latter suggests an extension of binary annotation mode where you add a multi-select for each class; settings panel choose column(s) for annotation

### Allowing multiple active clips in grid mode:
Selection:
- if user holds shift and clicks clip other than active clip, all clips between them inclusive become active (in displayed order)
- if user holds ctrl/cmd while clicking a clip, the clicked clip is added to the set of currently active clips
- if a user clicks a clip without cmd/ctrl or shift held, that clip becomes the only active clip
Display:
- when multiple clips are active, active clip border-glow changes color and playback is disabled; all selected clips show the border-glow to indicate they are selected
Annotation:
when multiple clips are active, changes made to the annotations of any single clip are applied to all active clips
Binary mode: annotating A/S/D/F or clicking yes/no/uncertain/unlabeled applies this label to all active clips
Multiclass mode: adding or removing a class adds/removes the class from all active clips; changes to annotation status segmented control are applied to all active clips

## known bugs

in server mode, new file dialogue to save the csv of annotations opens three dialogues on top of eachother, such that once use speifies file once there are still two open windows. SHould only show one window. 

"explore" failing to display audio clips (in server mode at least)
(Error: Failed to load clip: Cannot read properties of undefined (reading 'toString'))

Clip extraction: add "annotation" (if single-target) or "labels","annotation_status" (if multi-target) columns to the created csv so that the csv can be opened in the review tab. I tried to fix this but it is still not actually exporting csvs with these columns. 

When app reloads, tasks are re-started; background tasks should continue and the app should simply check on their status when reopening. This implies that the task manager should have a cached on-disk record of active tasks.

After clicking 'restart' task from task manager, two issues with tracking info in task manager panels:
- error messages from previous task are still shown
- time is incorrect negative value

Training is failing 

Windows shortcuts: ctrl+shift+K doesn't work for next unannotated clip, and ctrl+s doesn't work for save (applies the No label instead, which should be used fors the S shortcut but not ctrl/cmd + S)

current numeric form input fields are very bad, hard to type into and hard to use buttons to change values; sometimes typing a new value doesn't correctly replace the old value. Use the Material UI Spinner element for numeric configuration fields, or something equivalently simple and easy to interact with that doesn't add complexity to the codebase.  

Extraction by subfolder: keep entire relative path of subfolder rather than just `Path(audio_file).parent.name`. That way, folder structures like project/recorder1/wavs/a.wav, project/recorder2/wavs/a.wav are maintained as distinct folders rather than looking like the same folder ("wavs")

Automatic port selection updates for server and local modes:
Manual server mode port specification turned out to be a hassle. The frontend and backend ports should instead be automatically selected to be on an unused port, and clearly reported once running so that the user can see which ports are being used. This avoids accidental conflicts with overlapping ports. 
Similarly, I don't want local mode to default to using port 8000. Currently, it checks if 8000 is a dipper server, if so uses it, if not finds an open port to run Dipper backend. Instead, should always launch the dipper backend on an open port. The reason the current behavior is a problem: user could be forwarding remote Dipper backend to port 8000, and also trying to run a separate instance of Dipper in local mode. The local mode should create its own local dipper backend on a unique port rather than using the 8000 port which happens to be a different Dipper instance. Despite this behavior, dev mode (npm run tauri:dev) should look for the backend running on the default 8000 port. 

(BUT!! this makes me wonder: should we allow the set up of user launching local dipper, connecting to remote backend dipper port (eg 8001), then use server-mode file selection and essentially be running local app that runs tasks on the remote?)

### server mode installation
- should skip `npm install -g serve` if serve is already installed, this will avoid unnecessary permissions error for non-sudo user
- lightweight_server is not included when cloning the repo; should we download it from github builds/other source? build it locally? (building locally requires creating conda env with relevant packages) can't just provide built executable because won't work across platforms 
- to launch server in dev mode, the user needs a python env with relevant packages

## Intuitive workflows from task manager pane
Completed tasks in task manager should have a button for the next step in the workflow:
- completed inference task: button for "extract clips" on the completed task panel opens the clip extraction tab and fills in the output folder used by the inference task as the predictions folder in the extraction settings panel 
- completed extraction task: button on the completed task panel to open the first created task in review tab

## next steps:
debug/fix building conda-pack environment for Linux and Windows

rename lightweight-server (pyinstaller executable) and lightweight_server.py to dipper_pybackend. Make sure this is thoroughly updated throughout the codebase, build scripts, and documentation. 

test inference with custom/local models

get feedback on inference and training builds

add alternative "view mode" for multi-class annotation: instead of a multi-select box, each class has a button that can be toggled (clicked) for present (green) or absent (no color). Class buttons are floated in a wrapping div, such that multiple can appear side by side if there is enough horizontal space; vertical space is added to the clip panel as needed to display all options. 

- delete archive file of pytorch env after unpacking

separate HopLite Database-oriented embed, train, and predict into its own app

completed task pane should display full path to job folder containing the outputs of the task, with a little button to copy the path to the clipboard

In train/inference, add an option to specify device name for the ML model (typically selects gpu if available, otherwise cpu; advanced users might want to specify a device using torch's conventions, like "cuda:0"). This can be placed in an "advanced settings" sub-panel along with the option to select a custom python environment. 

## general feature request list 

get xeno-canto / other public recordings for a species to supplement training data?!
- this functionality is now provided in Jan's package
- also possible via scripting on BirdSet, though snapshot is early 2024

implement stratification by arbitrary columns in metadata for clip extraction:
... but how? need mapping from predictions to metadata, then select cols from metadata for stratification; dates/times are a whole different story

denoising and/or bandpassing for audio playback / review

wandb integration with training & inference for logging progress and model evaluation: login on global settings page, specify user/project/run name/notes in configuration panel; if used, provide link to wandb page in task panels

for clip review from query/explore mode: "add to cart" button on panel, adds the clip to an annotation "cart" that can be exported as an annotation task


review tab "undo" functionality? I think this would require tracking the full-page or single-clip annotations in a history so that we can sequentially undo and redo changes witch ctrl/cmd+z and ctrl/cmd+y

new shortcuts for review tab: 1,2,3...8 to navigate to 1st/etc clip on the current visible page or group; 9 to navigate to the last clip on the page; ctrl+1/2/3/4/5 to change grid mode number of columns;

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


## rewind
- throughout the application, when providing click-to-play spectrograms, make it so that clicking on the left 20% of the spectrogram rewinds the clip to the beginning instead of performing the play/pause action. Show a rewind icon when hovering over the left 20% of the spectrogram. 

## Remote mode
- install on a remote machine accessed via SSH
- replace native filesystem / other native system interactions with text fields or other working alternatives
- avoid system alerts/dialogues, which won't work
- add Global Settings page with option to switch between remote and desktop versions
- provide instructions for port forwarding to access the gui on a web browser
- launch from CLI with argument for HTTP forwarding port

### Training wishlist
(see sketch of full data ingestion tooling)
- convert Raven annotations to training data 
- create single-target labels from subfolder structure (wrote this in a python notebook)
- Weldy style noise augmentation (wrote this in a python notebook)
- preprocessing "wizard": started notebook for prototype

## embedding: 
add toggle in inference script to embed instead or in addition to classification

## HOPLITE embedding and shallow classification 
Separate app for hoplite embedding workflow
(eventually add Query also)

I have implemented functionalities for "embed audio to database" (mode='embed_to_hoplite') and "apply shallow classifier" (mode="classify_from_hoplite") modes in the inference.py script. We need to expose these functionalities to the user on the front end. Embed tab: similar form to Inference tab, runs inference.py with mode='embed_to_hoplite'. 
- instead of Save sparse outputs and Separate inference by subfolders fields, shows multi-select for database selection: 
- Create New Hoplite Database (user selects parent folder and enters name of new db in a text field)
- Add embeddings to existing Hoplite Database (user selects an existing folder; system confirms that "hoplite.sqlite" file exists in the folder)
-  User selects the embedding model from BMZ or local file path
- form has controls for batch size, num workers, and optionally specifying a custom python environment
- embedding script should write a dipper config file into the database folder, specifying the model and settings used for creating the embedding database

Predict tab: user selects an existing hoplite database (a folder) and an existing shallow classifier (from file). Besides this there are just some configuration options (borrow from Inference tab) for batch size, activation layer, save sparse outputs, separate by subfolder, and test run on a few clips. Runs inference.py with mode="clasify_from_hoplite" in config. 

Train tab: I need to write backend script
User selects hoplite database (folder) and annotation files. Same configuration settings/form as training in full app for selecting train/val sets with single and multi-target labels
- loads the dipper config file from the embedding database folder
- embeds any training/val sets as necessary

Review tab: same as review tab for full app. 

Query tab: I need to write backend script that embeds the query clips and runs search across db


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