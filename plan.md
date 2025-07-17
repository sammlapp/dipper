This project will create a cross-platform desktop app that runs pytorch machine learning models and allows users to train models in an active learning loop. 

Conda environment: `conda activate train_gui`

The project will use the bioacoustics model zoo for pre-trained bioacoustic identification models: https://github.com/kitzeslab/bioacoustics-model-zoo/

and opensoundscape: https://github.com/kitzeslab/opensoundscape which uses pytorch

The front end will be fluid, modern, intuitive, and attractive. 

Users can customize preprocessing, training, and inference settings. These settings are saved and loaded from configuration files. Python scripts for pytorch model inference and training run in subprocesses and reference the configuration files. 

The app will be built for desktop guis on Mac, Linux, and Windows. Python environments will be bundled and shipped to the user. Users should simply be able to install and launch the app, then use GUI workflows for model training and inference. 

streamlit_inference.py is provided as a reference for understanding and porting basic functionality, but not as a final product. 



# Visual design

For theming, let's switch to using Material UI layouts, components, and theming throughout
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
- binary review: as in binary_classification_review.py, there is a multi-select for 'yes' 'no' 'unsure' or 'unlabeled' for each audio clip. A visual effect (eg colored outline green/yellow/red/grey) indicates the current label of the clip. Optionally, the user can toggle on "show comment field" and write text comments. `annototation` value is yes/no/unsure or empty (nan) for not annotated
- multi-class review: each audio clip panel has multi-select (react-select) instead of multi-select of yes/no/unsure/unlabeled. `annotation` column will contain a comma-separated list of classes ['a','b']. Empty list [] indicates annotated and no classes, whereas empty / nan indicates the clip has not been annotated. 
- implement a settings panel with spectrogram window length, frequency bandpass range, dB range, colormap, number of rows and columns for grid of displayed clips, show/hide comments field, show/hide file name

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

## Review tab issues
- filtering or changing number of displayed spectrograms should cause a re-fetch of spectrograms. Currently, if new items are displayed the spectrograms are not rendered, and user sees blank panels after filtering or increasing number of visible samples. These two actions shoudl trigger re-fetch just like pagination does. 
- all colormaps still result in greyscale spectrograms, but some should result in colored images. The colormaps were working previously but now colormaps except 'inverted grayscale' all look like black with white for the sounds. Add debugging information for this since this issue has been difficult to crack
- if no annotation file is currently loaded, add a "Load annotation csv" button in the main window (exactly like the button in the left panel)

## Focus mode for review tab
- provide a toggle at the top of the review page to switch between viewing lots of clips on a page (current setup) and viewing a single, large spectrogram (click to play) in 'focus' mode.
- in focus mode, offer these shortcuts for binary classification mode: "a" = yes, "s" = no, "d" = unsure, "f" = unlabeled. "j" view previous, "k" view next clip. spacebar to play/pause audio. 
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

- the multi-selects for filtering should use the same type of selector as the annotation panels, react-select

# feature requests
- throughout the application, when providing click-to-play spectrograms, make it so that clicking on the left 20% of the spectrogram rewinds the clip to the beginning instead of performing the play/pause action. Show a rewind icon when hovering over the left 20% of the spectrogram. 

## create inference or annotation tasks via filtering and stratification: 
from wizard or from Explore tab

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

## Training
For now, model training will be limited to a "shallow classifier" strategy. That is, we will not attempt to fine-tune entire neural networks. Instead, we will train linear probes, MLPs, or similar shallow classifiers on embeddings generated with fixed models. 

We will use a model configuration panel to load and save model configuration parameters to a config file. 
Config: 
- select a model from bioacoustics model zoo
- specify class list (comma or return delimited) in text box
- select one or more annotation_files:
    - all_species_annotations: csvs of labeled audio for all classes with file,start_time,end_time,and col for each class. OR csv with cols: file,start_time,end_time,labels,complete (EG result of using Review tab in multi-class classification mode)
    - single_species_annotations: csvs of clips annotated for a single species. cols: file,start_time,end_time,annotation. EG result of using Review tab in binary classification mode. For each of these, the user should specify which class was annotated from a dropdown populated with class list from above. 
- optionally select dataframe of "background" samples
- select root audio folder (if dataframes use relative paths)
- optionally select an evaluation task (annotated dataframe with same format as training dfs: file,start_time,end_time,and col for each class)
- select save location for trained model
- training settings: batch size, N parallel preprocessing workers, device (populate dropdown with visible GPU/CPU devices using pytorch)


training script example: (don't worry about the TODO's for first iteration)

```python
import bioacoustics_model_zoo as bmz
import pandas as pd
import json
import yaml
from pathlib import Path
import datetime
import os


# load config
with open(config_file,'r') as f:
  config=yaml.safe_load(f)

# load one-hot labels(index: (file,start_time,end_time))
# TODO: convert list-of-labels formats to one-hot, removing incomplete or uncertain annotations
fully_annotated_dfs = []
for f in fully_annotated_files:
  df = pd.read_csv(f,index_col=[0,1,2])
  # columns are either one per class with one-hot labels, or "labels" and "complete"
  # in which case we reformat to one-hot labels with one column per class
  if 'labels' in df.columns:
    # parse labels column (list of strings) to list
    import ast
    df['labels']=df['labels'].apply(ast.literal_eval)
    df=df[df.complete=='complete'] #TODO what is the text value when 'complete' is selected in the Review tab
    # use opensoundscape utility for labels to one-hot
    from opensoundscape.annotations import categorical_to_multi_hot
    df = pd.DataFrame(
      categorical_to_multi_hot(labels, classes=config['class_list'], sparse=False), index=df.index,columns=config['class_list']
    )
    
  # else: df already has one-hot labels, keep as is
  
  fully_annotated_dfs.append(df)
labels = pd.concat(fully_annotated_dfs)
labels = labels[config['class_list']]

# add labels where only one species was annotated
# treat other species as weak negatives
for class_name,file in single_species_annotations.items():

  # parse class name from file name
  df = pd.read_csv(f,index_col=[0,1,2])

  # remove incomplete or uncertain annotations
  df=df[df.annotation.isin(['yes','no'])]

  # create one-hot df
  new_labels = pd.DataFrame(index=df.index,columns=labels.columns)
  new_labels[class_name]=df['annotation'].map({'yes':1,'no':0})
  

  # TODO: loss function should be able to handle NaNs by ignoring or treating as soft-negative
  new_labels=new_labels.fillna(0)


if evaluation_df is None:
  train_df, evaluation_df = sklearn.model_selection.train_test_split(labels,test_size=0.2)


# load pre-trained network and change output classes
# select model class based on config
m = bmz.__getattribute__(config['model_name'])()
m.change_classes(config['class_list'])
m.device = config['device']

# optionally, freeze feature extractor (only train final layer)
if config['freeze_feature_extractor']: # default to True
  m.freeze_feature_extractor()
  # maybe report # trainable parameters

# TODO: make sure to use AdamW optimizer, Cosine Annealing LR schedule, regularization, and early stopping for training
# TODO: allow wandb integration
# TODO: use background clips for overlay augmentation
# TODO: provide pre-computed noise clips for overlay augmentation
# TODO: pre-compute embeddings once for shallow training

# make a directory with a unique name to save results in
out_dir = Path(config['model_save_dir']) / datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
out_dir.mkdir(parents=True,exist_ok=False)

# before beginning training, save configuration to save_dir/config.json
with open(Path(out_dir)/'config.json','w') as f:
  yaml.dump(config,f)

# train # only save 'best' epoch (best performance on validation set)
m.train(train_df, evaluation_df, epochs=config['epochs'], batch_size=config['batch_size'], num_workers=config['num_workers'], save_path=out_dir,save_interval=-1)

# TODO: save a model training summary (visualization? html? yaml that can be visualized in the gui?) with evaluation set performance in out_dir
```

<!-- train(
        self,
        train_df,
        validation_df=None,
        epochs=1,
        batch_size=1,
        num_workers=0,
        save_path=".",
        save_interval=1,  # save weights every n epochs
        log_interval=10,  # print metrics every n batches
        validation_interval=1,  # compute validation metrics every n epochs
        reset_optimizer=False,
        restart_scheduler=False,
        invalid_samples_log="./invalid_training_samples.log",
        raise_errors=False,
        wandb_session=None,
        progress_bar=True,
        audio_root=None,
        **dataloader_kwargs,
    ) -->

## embedding: 
add toggle in inference script to embed instead or in addition

# TODO fixes and tweaks

# updates for review tab
- do not allow auto-save location to persist across app restarts. Saving location should be cleared on restart or any time an annotation df is opened 
- in focus mode, the content should be centered and use an inner div, but currently it is aligned left
- focus mode: use segmented control instead of large buttons for annotation options; make the area holding the controls wider, so that the comment field is larger. Keep the vertical spacing tight. 
- should auto-save when page changes in grid view or on forward/backward in focus view, not every time user clicks an annotation button in grid view
- 'unknown' is currently treated differently than 'unlabeled'. However, these are meant to be equivalent: clicking the grey circle should result in a NaN value in the dataframe, which we will call 'unlabeled'. Clicking this button should result in the segmented control having no selection. Change the symbol to a "reset" symbol for clarity. 

- reference frequency line not showing

- colormaps for spectrograms render properly in the explore tab but not in the review tab (still greyscale)

consolidate the global theming options into a simple config or css file, so that I can make edits to the set of colors, fonts, font weights, font sizes, overall spacing values in one place for the entire app. 

## inference updates:
- implement saving and loading all inference settings, including paths, to a config file
- refactor as "create inference task" -> task gets a name, and same options as the app currently has, then launches background task and monitors progress in a pane that monitors each task. API is not disabled, instead user can create additional inference tasks that will run after the running one is complete. Tasks pane monitors completed, running, and queued prediction tasks
- subset classes: can use text file or ebird filter
- optional sparse outputs: don't save scores below a floor, and save df as a sparse pickle

- TODO: how to divide up inference task? by subfolders? aggregate results or keep separate?
- TODO: better progress reporting, currently goes from 0-100 instantly
- TODO: smart segmenting into subtasks for large prediction tasks, with intermittent saving


# Explore tab updates
- remove "Score Distribution" text from the panel headings
- when you click on a histogram bar, it says "click to load spectrogram" but should instead say "loading spectrogram..."  
- should have a little button in the panel (gold medal icon?) to return to viewing the highest-scoring clip (eg after clicking on a histogram bin)
- put the settings in a side panel, exactly like the settings in the review tab
- 
## initial share-able desktop app
- remove the settings panel, we don't need it
- remove the training panel for now
- package the app as a desktop app in whatever way will be easy to  share with users on Windows + Mac, and be robust to cross platform issues. We can use GitHub runners to make windows builds, for now just make a Mac build since I'm on a mac
- for Inference, only allow use of those models in the bioacoustics model zoo which don't require TensorFlow (exclude: Perch, BirdNET, and SeparationModel)
- include one Python environment with all required packages, including `torch, torchaudio, opensoundscape, timm, lightning, git+https://github.com/kitzeslab/bioacoustics-model-zoo.git`


## long-term plan for shipping environments for BMZ models
- build a set of a few environments necessary to run bmz models
- only download the required env on-demand
- if not running bmz models/training, user has light weight env for backend, and can do annotation tasks without heavy PyTorch env
