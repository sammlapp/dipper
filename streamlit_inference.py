import streamlit as st
import filedialpy
import glob
import bioacoustics_model_zoo as bmz
import pydantic.deprecated.decorator  # otherwise error about not finding this module in executable
import wandb
import wandb_gql
import numpy as np

import json
import pandas as pd

st.set_page_config(layout="wide")

st.title("Model Zoo Inference GUI")

# when user downloads on mac:
# make executable: chmod +x file
# not signed: "cannot be opened because the developer cannot be verified"
# app signing in AddaxAI: https://github.com/PetervanLunteren/AddaxAI/commit/86a4a7dfaab02653f3504b5a5c5a720d2d40c857
# have to open system settings -> Security -> allow applications from -> click the GUI app for open anyway
# num workers gave louis an error


# TODO: use "audio root" to avoid full paths in output df

# prediction tab:
# TODO: use toast or other widget to show messages like 'loaded model xyz' or 'saved settings to file', or errors/warnings
# TODO: update theme, add splash screen, add opso logo
# TODO: progress bar during inference (per file? per folder?)
# TODO: widgets showing GPU/memory/cpu usage?
# TODO: message while loading model

# TODO: for file dialog, why isn't the panel "active" whe it opens

# TODO: training tab

# TODO: in data exploration, select a species and show selection of clips with that species detected
# (choose score range, random, or top-N)
# grid of spectrograms with click-to-play audio, or click-to-enlarge and show widget in popup window

# TODO: could we do remote machine / cluster/ SSH connections?! would need file browser integration, otherwise just need to send scripts over and get outputs back

# TODO: data review and annotate tab:
# use range for slider
# use min and max from df for slider limits

# - show specs with detections, audio widget
# - allow user to annotate clips with species, or modify existing annotations
# list of labels from config file; auto-complete multi-select

# def save_config_to_file(data):
#     file_path = filedialpy.saveFile()
#     if file_path:
#         with open(file_path, "w") as f:
#             json.dump(data, f, indent=4)
#         st.success(f"Settings saved to {file_path}")


# def load_config_from_file():
#     file_path = filedialpy.openFile()
#     if file_path:
#         with open(file_path, "r") as f:
#             return json.load(f)
#     return None

ss = st.session_state

# Store dynamic values in "session_state"
# if "selected_files" not in ss:
if "selected_files" not in ss:
    ss.selected_files = []
if "prediction_enabled" not in ss:
    ss.prediction_enabled = False
if "output_scores" not in ss:
    ss.output_scores = None
if "output_file" not in ss:
    ss.output_file = None
if "selected_model" not in ss:
    ss.selected_model = None

if not "inference_model" in ss:
    ss.inference_model = None

extensions = ["wav", "WAV", "mp3", "MP3"]


from opensoundscape import Spectrogram, Audio


def show_audio(file, start, end):
    a = Audio.from_file(file, offset=start, duration=end - start)
    st.audio(
        a.samples,
        sample_rate=a.sample_rate,
        format="audio/wav",
        start_time=0,
    )

    spec = Spectrogram.from_audio(a)
    img = spec.to_image(range=[-80, -20], invert=True)
    st.image(img)


def save_cfg():
    """Save session state to a JSON file."""
    file_path = filedialpy.saveFile()
    values = ss.cfg  # .to_dict()
    if file_path:
        with open(file_path, "w") as f:
            json.dump(values, f, indent=4)
        st.success(f"Config saved to {file_path}")


def load_cfg():
    """Load session state from a JSON file."""
    file_path = filedialpy.openFile()
    if file_path:
        with open(file_path, "r") as f:
            loaded_data = json.load(f)
        ss.cfg.update(loaded_data)
        st.rerun()


# Initialize session state defaults
default_cfg = {
    "inference": {
        "clip_overlap": 0.0,
        "batch_size": 1,
        "num_workers": 0,
    },
    "prediction_threshold": 0.0,
}
ss.setdefault("cfg", default_cfg)
# for key, value in defaults.items():
#     ss.setdefault(key, value)


def check_if_ready_to_predict():
    ss.prediction_enabled = (
        ss.selected_files and len(ss.selected_files) > 0 and ss.selected_model
    )


def select_files():
    ss.selected_files = filedialpy.openFiles()
    check_if_ready_to_predict()


def select_files_from_folder():
    selected_folder = filedialpy.openDir()
    all_files = []
    for extension in extensions:
        all_files.extend(
            glob.glob(f"{selected_folder}/**/*.{extension}", recursive=True)
        )
    ss.selected_files = all_files

    check_if_ready_to_predict()

    st.write(f"Number of files: {len(ss.selected_files)}")
    st.write("First file:")
    st.caption(ss.selected_files[0] if len(ss.selected_files) > 0 else "n/a")


def select_save_location():
    # create a default file name based on the model name and timestamp
    timestamp = pd.Timestamp.now().strftime("%Y%m%d_%H%M%S")
    model_name = ss.selected_model.replace(" ", "_")
    default_name = f"{model_name}_predictions_{timestamp}.csv"
    ss.output_file = filedialpy.saveFile(initial_file=default_name)
    check_if_ready_to_predict()


def load_selected_model():
    import bioacoustics_model_zoo as bmz

    selected = ss.selected_model
    st.write(f"Loading model: {selected}")
    load_model(selected)  # sets ss.inference_model

    st.write(
        "MODEL:" + type(ss.inference_model).__name__
        if ss.inference_model is not None
        else "Model not loaded"
    )


# todo show
def load_scores():
    f = filedialpy.openFile()
    if f:
        ss.output_scores = pd.read_csv(f, index_col=[0, 1, 2])


@st.cache_resource  # don't re-initialize if this same model has already been loaded
def load_model(model_name):
    try:
        # initialize the model using the name from bmz.__init__.py
        ss.inference_model = getattr(bmz, model_name)()
    except Exception as e:
        st.write(f"An error occurred while loading this model: {e}")
        ss.inference_model = None


def run_inference():
    if ss.selected_files is None or len(ss.selected_files) == 0:
        # st.write("No files selected: use the `select files` or `select folder` button")
        return
    if ss.inference_model is None:
        # st.write("No model loaded: use the `load model` button")
        return
    st.write(
        f"Running inference using model: {ss.selected_model} on {len(ss.selected_files)} files"
    )

    # here, we could instead run a command line script
    # which runs /specific/python inference_script.py --model_name {selected_model} --files {selected_files} --output_file {output_file}
    # and then read the results from the output_file
    # this also avoids freezing up the GUI while the inference is running

    score_df = ss.inference_model.predict(ss.selected_files, **ss.cfg["inference"])
    if ss.output_file:
        score_df.to_csv(ss.output_file)
        st.write(f"Inference complete, results saved to: {ss.output_file}")
    else:
        st.write(
            "Inference complete, no output directory selected so results not saved to disk"
        )

    ss.output_scores = score_df


def save_scores(path=None):
    if ss.output_scores is None:
        st.write("No output scores to save")
        return
    if path is None:
        path = filedialpy.saveFile()
    ss.output_scores.to_csv(path)


inference_tab, explore_tab = st.tabs(
    ["Run Species Detection Models", "Explore Detections"]
)

with inference_tab:
    st.subheader("1. Configure prediction settings")

    with st.expander("Prediction Settings", expanded=False, icon=None):

        ss.cfg["inference"]["clip_overlap"] = st.number_input(
            "Clip Overlap (seconds)",
            value=ss.cfg["inference"]["clip_overlap"],
            format="%.2f",
        )
        batchsize_vals = [2**i for i in range(12)]
        ss.cfg["inference"]["batch_size"] = st.selectbox(
            "Batch Size",
            batchsize_vals,
            index=batchsize_vals.index(ss.cfg["inference"]["batch_size"]),
        )
        ss.cfg["inference"]["num_workers"] = st.number_input(
            "Num Workers",
            min_value=0,
            step=1,
            value=ss.cfg["inference"]["num_workers"],
        )
        ss["cfg"]["prediction_threshold"] = st.number_input(
            "Prediction Threshold",
            value=ss.cfg["prediction_threshold"],
            format="%.2f",
        )

        col1, col2 = st.columns(2)
        with col1:
            if st.button("Save Settings to Configuration File"):
                save_cfg()

        with col2:
            if st.button("Load Settings from Configuration File"):
                load_cfg()

    st.subheader("2. Load a model from the Bioacoustics Model Zoo")
    # not sure if we want to call bmz.describe_models() (requires bmz installed in this env)
    # or hard-code file list or access in another way
    all_models = {
        "BirdNET": "Global bird species classification (TensorFlow)",
        # "SeparationModel": "no description",
        # "YAMNet": "no description",
        "Perch": "Global bird species classification (TensorFlow)",
        "HawkEars": "HawkEars Canadian bird classification CNN v0.1.0 (Pytorch)",
        "RanaSierraeCNN": "CNN trained to detect Rana sierrae calls (Pytorch)",
    }

    # streamlit dropdown for selecting model
    selected_model = st.selectbox(
        "Select model",
        list(all_models.keys()),
        placeholder="Select a model",
        on_change=load_selected_model,
        index=None,
        key="selected_model",
    )

    st.write("Currently loaded model:")
    st.caption(ss.selected_model)

    # TODO: need to create separate environments to use for inference depending on the model

    # TODO: why do selected_files get cleared when choosing a model?

    st.subheader("3. Select audio files to run the model on")

    col1, col2 = st.columns(2)
    with col1:
        st.button("Select file(s)", on_click=select_files, key="select_files")
    with col2:
        st.button(
            "Select all files in a folder (including subfolders)",
            on_click=select_files_from_folder,
            key="select_files_from_folder",
        )

    st.caption(
        f"Number of audio files selected for prediction: {len(ss.selected_files)}"
    )
    st.caption(
        f"First file: {ss.selected_files[0] if len(ss.selected_files ) > 0 else 'n/a'}"
    )

    st.subheader("4. Specify where to save the outputs of the ML model")
    st.button(
        "Select output file for model predictions",
        on_click=select_save_location,
        key="select_save_location",
    )
    st.write("Selected folder to save model predictions:")
    st.caption(ss.output_file)
    # TODO: it's not saving to this or updating the path shown as output dir! not sure why

    st.subheader("5. Run the model on the selected files")
    st.caption(
        "Model predictions are saved to the selected output directory, if specified"
    )
    st.button(
        "Predict on selected files",
        on_click=run_inference,
        disabled=not ss.prediction_enabled,
    )

    st.caption(
        f"size of output scores df: {ss.output_scores.shape if ss.output_scores is not None else 'n/a'}"
    )

    st.button(
        "Save model output scores to file",
        on_click=save_scores,
        disabled=ss.output_scores is None,
    )
    with st.expander("Model output scores table", expanded=False, icon=None):
        if ss.output_scores is not None:
            selected_classes = st.multiselect(
                "Which classes to include in table:",
                ss.output_scores.columns,
                default=[],  # all columns
            )
            df_to_show = (
                ss.output_scores[selected_classes]
                if len(selected_classes) > 0
                else ss.output_scores
            )
            df_to_show

with explore_tab:

    st.subheader("Select table of model output scores to explore")
    st.button(
        "Load model output scores from file", key="load_scores", on_click=load_scores
    )
    score_df = ss.output_scores

    st.caption(
        f"size of output scores df: {score_df.shape if score_df is not None else 'n/a'}"
    )

    if score_df is None:
        st.write("No output scores currently available")
    else:
        st.subheader("Counts of detections in score range")

        # re-calculate counts of species with sliding score threshold
        min_score = float(score_df.values.min(axis=None))
        max_score = float(score_df.values.max(axis=None))
        score_range = st.slider(
            label="Subset outputs by model logit score range (inclusive at both ends)",
            min_value=min_score,
            max_value=max_score,
            ##start at 0 unless min score is > 0
            value=(max(min_score, 0.0), max_score),
            step=0.01,
            key="score_range",
        )

        selected_classes = st.multiselect(
            "Which classes to show samples from: (if none selected, all classes will be shown)",
            score_df.columns,
            default=[],  # all columns
        )

        # filtered = score_df[
        #     (score_range[0] <= score_df) & (score_df <= score_range[1])
        # ]
        # filtered = filtered[selected_classes] if len(selected_classes) > 0 else filtered

        detection_counts = (
            (score_df >= score_range[0]) & (score_df <= score_range[1])
        ).sum(0)
        detection_counts = detection_counts.sort_values(ascending=False)
        detection_counts = detection_counts[detection_counts > 0]
        if len(selected_classes) > 0:
            detection_counts = detection_counts[selected_classes]
        st.write("Detection counts (species with at least one detection):")

        # TODO: option to group by subfolder or parsed date or other metadata
        # TODO: option to filter by list of subfolders/dates/range of dates/times
        # TODO: weirdly if you click on the slider it goes back to first tab
        # but if you drag it it doesn't
        detection_counts

        st.subheader("Explore detections from one class")
        st.write(
            "Select a species to see samples of detections in the selected score range"
        )
        cols = st.columns([2, 1, 2])
        with cols[0]:
            selected_class = st.selectbox(
                "Select species to explore",
                detection_counts.index,
                index=None,
                key="selected_species",
            )
        with cols[1]:
            n_detections = st.number_input(
                "Number of detections to show",
                min_value=1,
                value=12,
                step=1,
                format="%d",
                key="n_detections",
            )

        # Histogram
        from matplotlib import pyplot as plt

        # copy code from other streamlit app to show grid of spectrograms
        if selected_class is not None:

            class_scores = score_df[selected_class]
            min_score = float(class_scores.min())
            max_score = float(class_scores.max())
            with cols[2]:
                score_range_sp = st.slider(
                    "Subset outputs by model logit score range (inclusive at both ends)",
                    min_score,
                    max_score,
                    (
                        max(min_score, 0.0),
                        max_score,
                    ),  # start at 0 unless min score is > 0
                    0.01,
                    key="score_range_sp",
                )
            filtered = class_scores[
                (score_range_sp[0] <= class_scores) & (class_scores <= score_range[1])
            ]
            st.caption(
                f"Displaying {n_detections}/{len(filtered)} samples of {selected_class} detections (score range: {score_range_sp[0]} to {score_range_sp[1]})"
            )

            fig, ax = plt.subplots()
            n, bins, patches = ax.hist(class_scores, bins=50, color="#EEEEEE")
            _ = ax.hist(
                filtered,
                bins=bins,
                color="#AABBFF",
            )
            st.pyplot(fig)

            # TODO: widget to calculate score percentiles at custom percentile

            # on = st.toggle("group by subfolder", False)

            # TODO: this should be a form with regenerate as the form submit button
            options = ["Highest scores", "Random selection"]
            selection_strategy = st.segmented_control(
                "Selection strategy",
                options,
                selection_mode="single",
                key="selection_strategy",
                default=options[0],
            )
            st.button("regenerate samples", key="regenerate_samples")
            # will rerun page, if random selection is chosen, will show different random samples

            if selection_strategy == "Random selection":
                # randomly select n_detections from the filtered df
                if len(filtered) > n_detections:
                    to_display = filtered.sample(n_detections)
                else:
                    to_display = filtered

            elif selection_strategy == "Highest scores":
                to_display = filtered.nlargest(n_detections)

            columns = st.columns(4)
            for i in range(n_detections):
                with columns[i % 4]:
                    show_audio(
                        to_display.index[i][0],
                        to_display.index[i][1],
                        to_display.index[i][2],
                    )

            # TODO: add bubble maps, when metadata is available
            # metadata will be based on subfolder name

    # TODO: histograms of scores for selected species


# pip install streamlit-option-menu
# post-processing visualization and labeling
# streamlit-cropper
# streamlit-img-label
# streamlit-player
# pip install streamlit-image-annotation: annotate images w bboxes
# st-clickable-images: grid of specs -> one sample
# streamlit-audio-plot?
# maps

# post processing: a few graphs

# post processing: stratified labeling -> Navine callibration
# or in general, select score region using (some strategy) and review clips
# top-N, , random stratified
#
# https://github.com/ChristophNa/streamlit-bokeh3-events
#

# TODO: when select model, loses choices of files and output dir
# TODO: implement file subsetting wizard (subset by time of day, date, other columns in metadata) that writes a list of files, and Button to "Select files based on text file list"
