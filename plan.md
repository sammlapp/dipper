This project will create a cross-platform desktop app that runs pytorch machine learning models and allows users to train models in an active learning loop. 

Conda environment: `conda activate train_gui`

The project will use the bioacoustics model zoo for pre-trained bioacoustic identification models: https://github.com/kitzeslab/bioacoustics-model-zoo/

and opensoundscape: https://github.com/kitzeslab/opensoundscape which uses pytorch

The front end will be fluid, modern, intuitive, and attractive. 

Users can customize preprocessing, training, and inference settings. These settings are saved and loaded from configuration files. Python scripts for pytorch model inference and training run in subprocesses and reference the configuration files. 

The app will be built for desktop guis on Mac, Linux, and Windows. Python environments will be bundled and shipped to the user. Users should simply be able to install and launch the app, then use GUI workflows for model training and inference. 

streamlit_inference.py is provided as a reference for understanding and porting basic functionality, but not as a final product. 


For theming, let's use a modern and clean aesthetic with a nice set of sans serif fonts and these colors:
#eae0d5 light backgrounds
#395756 dark
#4f5d75 dark highlight/a/ccent
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

# Incomplete items:


## Theme updates: 
use the Rokkit font family throughout the app. I added the font folder to the top-level of the project, but feel free to move it elsewhere
overall, the buttons and other elements are slightly too large, reduce their size for a slightly more compact and professional look. 

## Review tab issues
- all colormaps still result in greyscale spectrograms, but some should result in colored images. The colormaps were working previously but now colormaps except 'inverted grayscale' all look like black with white for the sounds. 
- saving annotations isn't working properly. First a file save browser opens, but then when a file is selected, a second file save browser opens. 
- "reset settings" should not reset the Root Audio Folder. Move the root audio folder into the Load Annotation File section, and don't consider it part of the settings form. 
- review settings panel: no longer needs the inner div, just use the panel directly
- review settings panel: buttons are not accessible because they go beyond the end of the panel. make panel larger and buttons smaller
- style the panel like a streamlit side panel: << double arrow symbol on the page to expand, and double arrow >> on the panel to hide
- remove the "form" like behavior of settings, reverting to directly updating the spectrogram views when the settings are changed. however, the updates should not occur while typing in a text field like "bandpass frequency" - instead only when the field is exited or user presses "Return"
- the slider control for dB range is looking ugly: it has a box instead of a line that the sliders move along, and no numbers are visible 
- many of the settings extend beyond the edge of the panel display

## Review tab issues
- spectrogram images are always still appearing in black and white
- cannot edit text fields in settings (bandpass frequencies and referenc frequency)

## Focus mode for review tab
- provide a toggle at the top of the review page to switch between viewing lots of clips on a page (current setup) and viewing a single, large spectrogram (click to play) in 'focus' mode.
- in focus mode, offer these shortcuts for binary classification mode: "a" = yes, "s" = no, "d" = unsure, "f" = unlabeled. "j" view previous, "k" view next clip. spacebar to play/pause audio. 
- in focus mode, auto-advance to next clip when user clicks or uses shortcut to provide an annotation of yes/no/unknown/unlabeled
- in settings panel, add a check box for whether to auto-play clips when using focus mode. When checked, the audio begins as soon as the spectrogram is displayed. 

## Review tab tweaks: 
- there are two scroll bars, one for the main page and one inner. Should only need one scroll bar for everything. 
- slightly decrease the padding between the clip display panels and increase the efficiency of space use across the full window by using the entire width
- use symbols (check, question mark, circle) rather than text for Complete/Uncertain/Unreviewed in segmented control for multi class review mode. Provide tooltips on hover. 
- clicking on segmented control is resetting the values in the multi-select, but should not
- when user changes multi-select option list, old values as well as new values are displayed in the multi-select, but only the new values should be offered

- focus mode is working well, but if you proceed to the next clip before the previous one finishes playing, you have to click play twice to get the audio to play. It should pause the previous clip, and play the new clip on load (if auto play is on)

## Shortcuts for review tab:
- use ctrl for window and cmd for mac
- toggle shortcuts on/off in the settings tab
- ctrl/cmd+C: show/hide comments
- ctrl/cmd+A/S/D/F: annotate all clips on page as yes/no/uncertain/unlabeled (only works in binary classification model)


## refinements to review tab
- when in binary review mode, add buttons below pagination buttons for applying the same label to all clips on the current page
- 

## inference updates:
- refactor as "create inference task" -> task gets a name, and same options as the app currently has, then launches background task and monitors progress in a pane that monitors each task. API is not disabled, instead user can create additional inference tasks that will run after the running one is complete. Tasks pane monitors completed, running, and queued prediction tasks
- subset classes: can use text file or ebird filter
- don't save scores below a floor, and save df as a sparse pickle

# Explore tab updates
- when you click on a histogram bar, it changes the info at the bottom of the card but doesn't update the audio and spectrogram
- should have a little button in the panel (gold medal icon) to return to viewing the highest-scoring clip (eg after clicking on a histogram bin)
- put the settings in a side panel, exactly like the settings in the review tab
- create spectrograms automatically rather than having user "click to view spectrogram"
- in "dataset overview", include the detection counts for the top 10 most detected species
- for the species panels, include the number of detections in the top of the panel
- default selected values for multi-select should be the 6 most commonly detected species
- Detection Threshold: laggy behavior with large df, don't try to adjust other parts of the display as user drags, wait until slider is released to make updates
- this tab's state should persist if the user switches tabs and comes back


## Review tab improvements:
- any time next page or an annotation button is clicked, the whole still page blinks, making a poor user experience
- should not re-render spectrograms when user changes label
- in multi-class review mode, segmented control now appears but is not working properly, clicking has no effect
- in multi-class review mode, in settings pane, user enters a list of possible classes to choose from, delimited by Return key

## plan for initial share-able desktop app
- package the app as a desktop app in whatever way will be easy to  share with users on Windows + Mac, and be robust to cross platform issues
- include one Python environment with all required packages 
- only include those models in the bioacoustics model zoo which don't require TensorFlow (exclude: Perch, BirdNET, and )

## long-term plan for shipping environments for BMZ models
- build a set of a few environments necessary to run bmz models
- only download the required env on-demand
- if not running bmz models/training, user has light weight env for backend, and can do annotation tasks without heavy PyTorch env
