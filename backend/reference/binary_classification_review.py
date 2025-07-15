from pathlib import Path
import librosa
import streamlit as st
import filedialpy
import numpy as np
import pandas as pd
import streamlit as st
import pagination  # import paginator, next_page, previous_page, next_idx, previous_idx
import PIL
import streamlit as st
from streamlit_extras.stylable_container import stylable_container

# import streamlit_shortcuts

import scipy
import matplotlib
import json


# add imports that will not be found by pyinstaller, causing build to fail:

# anything using "from" syntax
import streamlit_shortcuts
import streamlit_extras
import streamlit_extras.stylable_container
import plotly

import matplotlib.pyplot
import shortcut_utils

st.set_page_config(layout="wide")


def button(
    label,
    shortcut,
    on_click=None,
    key=None,
    hint=False,
    help=None,
    args=None,
    kwargs=None,
):
    """Wrapper for button to add keyboard shortcut only if shortcuts are enabled"""
    b = shortcut_utils.shortcut_button(
        label=label,
        shortcut=shortcut if ss.settings["enable_shortcuts"] else None,
        key=key,
        on_click=on_click,
        help=help,
        args=args,
        kwargs=kwargs,
    )
    return b


# Default settings configuration
DEFAULT_SETTINGS = {
    "n_columns": 4,
    "n_rows": 2,
    "clip_duration": 3,
    "pre_look_time": 0,
    "bandpass_range": [0, 10000],
    "dB_range": [-90, -20],
    "spec_window_size": 512,
    "use_bandpass": None,
    "spectrogram_colormap": "greys",
    "image_width": 400,
    "image_height": 200,
    "resize_images": False,
    "autosave": True,
    "show_comment_field": False,
    "show_reference_frequency": False,
    "reference_frequency": 2000,  # Hz
    "show_file_name": True,
    "enable_shortcuts": True,  # enable keyboard shortcuts
}


def save_settings_to_file():
    """Save current settings to a JSON file"""
    if "settings" not in ss:
        return

    save_path = filedialpy.saveFile(
        title="Save Settings Configuration",
        initial_file="config.json",
    )

    if save_path:
        with open(save_path, "w") as f:
            json.dump(ss.settings, f, indent=2)
        st.success(f"Settings saved to {save_path}")


def load_settings_from_file():
    """Load settings from a JSON file"""
    load_path = filedialpy.openFile(
        title="Load Settings Configuration",
    )

    if load_path:
        try:
            with open(load_path, "r") as f:
                loaded_settings = json.load(f)

            # Validate loaded settings against default settings
            validated_settings = {}
            for key, default_value in DEFAULT_SETTINGS.items():
                if key in loaded_settings:
                    validated_settings[key] = loaded_settings[key]
                else:
                    validated_settings[key] = default_value

            ss.settings = validated_settings
            st.success(f"Settings loaded from {load_path}")
            return True
        except Exception as e:
            st.error(
                f"Error loading settings! Did you select a JSON file saved using the 'Save Settings' button?"
            )
            return False
    return False


def initialize_settings():
    """Initialize settings in session state"""
    if "settings" not in ss:
        ss.settings = DEFAULT_SETTINGS.copy()

    # Ensure all settings keys exist (for backwards compatibility)
    for key, default_value in DEFAULT_SETTINGS.items():
        if key not in ss.settings:
            ss.settings[key] = default_value


# TODO: click img to play, instead of separate audio widget. Right click for download
# TODO: spacebar plays active clip!
# TODO: field for multi-select of species: user picks species list file, field updates 'labels' column. Two modes: binary classification and multi-select. "labels" column of annotation df is comma-separated list of classes.
# TODO: click to select active pane (make reusable click-able element class?)
# TODO: decrease latency of activating next clip after setting label
# TODO: bug causing crash, no error message just Error code: 5 on chrome. Not on a consistent clip.
# TODO: histograms of scores for selected species (ask which column has scores, open panel with alpha=0.5 histograms of scores for positive and negative annotations)
# TODO: frequency axis labels (turn on and off)

ss = st.session_state

# Initialize settings
initialize_settings()

# Initialize application state variables (not saved in config)
if not "annotation_df" in ss:
    ss.annotation_df = None

if not "active_idx" in ss:
    ss.active_idx = 0  # index of the currently selected clip

if not "annotation_save_path" in ss:
    ss.annotation_save_path = None

if not "labels_are_up_to_date" in ss:
    ss.labels_are_up_to_date = True

if not "original_annotation_path" in ss:
    ss.original_annotation_path = None

if not "audio_dir" in ss:
    ss.audio_dir = None

if "page_number" not in ss:
    ss.page_number = 0

if "full_page_annotation" not in ss:
    ss.full_page_annotation = None

if "visible_labels" not in ss:
    ss.visible_labels = ["yes", "no", "unknown", None]  # default visible labels

option_map = {
    0: ":material/check_circle:",
    1: ":material/cancel:",
    2: ":material/question_mark:",
}

option_map_w_none = {
    0: ":material/check_circle:",
    1: ":material/cancel:",
    2: ":material/question_mark:",
    3: "No selection",
}

option_labels = {
    0: "yes",
    1: "no",
    2: "unknown",
    None: None,  # no selection
}
label_to_index = {v: k for k, v in option_labels.items()}

# option_labels_w_none = {
#     0: "yes",
#     1: "no",
#     2: "unknown",
#     3: None,  # no selection
# }

option_colormap = {
    "yes": "#c7f0c2",  # green
    "no": "#f0c6c2",  # red
    "unknown": "#f8ee81",  # amber
    None: "#cccccc",  # grey
}


@st.dialog("unsaved changes")
def unsaved_changes():
    st.write("You have unsaved changes to annotations. Save or discard them.")


def linear_scale(array, in_range, out_range):
    # linear scaling of array values from in_range to out_range
    scale = (out_range[1] - out_range[0]) / (in_range[1] - in_range[0])
    return (array - in_range[0]) * scale + out_range[0]


def spec_to_image(spec, range=None, colormap=None, channels=3, shape=None):
    if colormap is not None:
        # it doesn't make sense to use a colormap with #channels != 3
        assert (
            channels == 3
        ), f"Channels must be 3 to use colormap. Specified {channels}"

    # rescale spec_range to [1, 0]
    # note the low values represent silence, so a silent img would be black
    # if plotted directly from these values.
    array = linear_scale(spec, in_range=range, out_range=(0, 1))

    # clip values to [0,1]
    array = np.clip(array, 0, 1)

    # flip up-down so that frequency increases from bottom to top
    array = array[::-1, :]

    # invert values
    array = 1 - array

    if colormap is not None:  # apply a colormap to get RGB channels
        cm = matplotlib.pyplot.get_cmap(colormap)
        array = cm(array)[..., :3]  # remove alpha channel (4)

    # determine output height and width
    if shape is None:  # if None, use original shape
        shape = np.shape(array)
    else:  # shape is like [height, width]
        # if height or width are None, use original sizes
        if shape[0] is None:
            shape[0] = np.shape(array)[0]
        if shape[1] is None:
            shape[1] = np.shape(array)[1]

    if array.shape[-1] == 1:
        # PIL doesnt like [x,y,1] shape, it wants [x,y] instead
        # if there's only one channel
        array = array[:, :, 0]

    # expected shape of input is [height, width, channels]
    image = PIL.Image.fromarray(np.uint8(array * 255))

    # reshape
    image = image.resize((shape[1], shape[0]))  # PIL expects (width, height) for resize

    return image


def load_annotation_df(f=None, discard_changes=False):
    if not ss.labels_are_up_to_date and not discard_changes:
        unsaved_changes()
        return
    if f is None:
        f = filedialpy.openFile()
    if f:
        ss.annotation_df = pd.read_csv(f)
        ss.original_annotation_path = f
        assert (
            "file" in ss.annotation_df.columns
            and "start_time" in ss.annotation_df.columns
        )
        if not "annotation" in ss.annotation_df.columns:
            ss.annotation_df["annotation"] = None
        if not "comment" in ss.annotation_df.columns:
            ss.annotation_df["comment"] = None

        # change 'nan' to None in annotation column
        ss.annotation_df["annotation"] = ss.annotation_df["annotation"].replace(
            {np.nan: None}
        )

        # if audio_dir is not set, set to the directory of the selected file
        if ss.audio_dir is None:
            ss.audio_dir = Path(f).parent

        # go to first page
        ss.page_number = 0
        # reset active index to first item
        ss["active_idx"] = 0
        # labels are now up to date
        ss.labels_are_up_to_date = True


def save_annotation_df(saveas=False):
    if ss.annotation_df is None:
        st.write("No output scores to save")
        return
    if ss.annotation_save_path is None or saveas:
        ss.annotation_save_path = filedialpy.saveFile(title="Save annotation table as")
    if ss.annotation_save_path:
        ss.annotation_df.to_csv(ss.annotation_save_path, index=False)
    ss.labels_are_up_to_date = True


def autosave_annotation_df():
    """Automatically save the annotation dataframe to the original path if it exists."""
    if ss.settings["autosave"]:
        save_annotation_df()


def next_unlabeled_idx(idx):
    """activate next item that doesn't have an annotation"""

    if len(ss.page_indices) == 0:
        return
    if idx not in ss.page_indices:
        idx = ss.page_indices[0]
    position = ss.page_indices.index(idx)
    position = (position + 1) % len(ss.page_indices)
    next_idx = ss.page_indices[position]
    while ss.annotation_df.at[next_idx, "annotation"] not in (None, np.nan):
        position = (position + 1) % len(ss.page_indices)
        next_idx = ss.page_indices[position]
        if next_idx == idx:
            break  # if we looped through all items, stop
    ss.active_idx = ss.page_indices[position]


def update_annotation_from_segcon(review_id):
    df_idx = int(review_id.replace("review_clip_", ""))
    val = option_labels[ss[review_id]]
    set_label(df_idx, val)


# @st.cache_data(max_entries=30)
# def get_audio_and_spec(file, offset, duration, window_samples):
#     a = Audio.from_file(file, offset=offset, duration=duration)
#     return a, Spectrogram.from_audio(a, window_samples=window_samples)


def set_comment(df_idx):
    if f"comment_{df_idx}" in st.session_state:
        ss.annotation_df.at[df_idx, "comment"] = st.session_state[f"comment_{df_idx}"]


def show_audio(file, start, end, review_buttons=False, review_id=None, active=False):
    if review_id is not None:
        df_idx = int(review_id.replace("review_clip_", ""))
        label = ss.annotation_df.at[df_idx, "annotation"]
        if label != label:
            label = None  # could use 'no-annotations' and just return label I think
        initial_value = label_to_index[label]

    else:
        initial_value = None
        label = None

    with stylable_container(
        key="c" + review_id,
        css_styles=f"""
            {{
                border: {"6px" if active else "2px"} solid {option_colormap[label]}; 
                border-radius: .3rem;
                padding: calc(1em - 1px)
            }}
            """,  # //{"4px" if active else "1px"}
    ):

        with st.container():
            # st.markdown("This is a container with a border.")
            # (border=border, key="c" + review_id):
            # cache for performance # didn't work smoothly because of pickling
            samples, sr = librosa.load(
                file, sr=None, offset=start, duration=end - start
            )
            # create spec with librosa
            frequencies, times, spectrogram = scipy.signal.spectrogram(
                x=samples,
                fs=sr,
                # window=window_type,
                nperseg=int(ss.settings["spec_window_size"]),
                noverlap=int(ss.settings["spec_window_size"] * 0.5),  # 50% overlap
                nfft=int(ss.settings["spec_window_size"]),
                # scaling=scaling,
                # **kwargs,
            )

            # convert to decibels
            # -> avoid RuntimeWarning by setting negative or 0 values to -np.inf
            spectrogram = 10 * np.log10(
                spectrogram,
                where=spectrogram > 0,
                out=np.full(spectrogram.shape, -np.inf),
            )

            # show reference frequency line if requested
            if ss.settings["show_reference_frequency"]:
                closest_index = np.abs(
                    frequencies - ss.settings["reference_frequency"]
                ).argmin()
                # add a horizontal line at the reference frequency
                spectrogram[closest_index, :] = ss.settings["dB_range"][1]
            st.audio(
                samples,
                sample_rate=sr,
                format="audio/wav",
                start_time=0,
            )

            if ss.settings["use_bandpass"]:
                lowest_index = np.abs(
                    frequencies - ss.settings["bandpass_range"][0]
                ).argmin()
                highest_index = np.abs(
                    frequencies - ss.settings["bandpass_range"][1]
                ).argmin()

                # retain slices of the spectrogram and frequencies that fall within desired range
                spectrogram = spectrogram[lowest_index : highest_index + 1, :]
                frequencies = frequencies[lowest_index : highest_index + 1]

            img = spec_to_image(
                spectrogram,
                range=ss.settings["dB_range"],
                colormap=(
                    ss.settings["spectrogram_colormap"]
                    if ss.settings["spectrogram_colormap"] != "greys"
                    else None
                ),
                channels=1 if ss.settings["spectrogram_colormap"] == "greys" else 3,
                shape=(
                    (ss.settings["image_height"], ss.settings["image_width"])
                    if ss.settings["resize_images"]
                    else None
                ),
            )

            st.image(img)

            if review_buttons:
                if ss.settings["show_file_name"]:
                    filename = Path(file).name
                    max_len = 100 // ss.settings["n_columns"]
                    if len(filename) > max_len:
                        # truncate long file names for display
                        filename = filename[:max_len] + "..."
                    filename = f"`{filename}`"
                else:
                    filename = None
                st.segmented_control(
                    filename,
                    options=option_map.keys(),
                    format_func=lambda option: option_map[option],
                    selection_mode="single",
                    key=review_id,
                    on_change=update_annotation_from_segcon,
                    args=(review_id,),
                    default=initial_value,
                )

                # vertical space
                # st.write("")  # add vertical space after segmented control

            if ss.settings["show_comment_field"]:
                if review_id is not None and pd.notna(
                    ss.annotation_df.at[df_idx, "comment"]
                ):
                    current_value = ss.annotation_df.at[df_idx, "comment"]
                else:
                    current_value = ""

                st.text_area(
                    "Comment",
                    value=current_value,
                    key=f"comment_{df_idx}",
                    # height=100,
                    on_change=set_comment(df_idx),
                )
            st.write("")


def update_page_annotations(indices, val):
    indices = list(indices)
    # warn if all clips on page are annotated and full_page_overrides is False
    if not ss["full_page_overrides"] and all(
        ss.annotation_df.at[idx, "annotation"] is not None for idx in indices
    ):
        st.warning(
            "All clips on this page are already annotated. "
            "Check 'Override existing annotations' to apply the annotations to annotated clips."
        )
        return
    for idx in indices:
        if ss["full_page_overrides"] or ss.annotation_df.at[idx, "annotation"] is None:
            # only update if the clip has not yet been annotated, or if override is True
            ss.annotation_df.at[idx, "annotation"] = val
            ss[f"review_clip_{idx}"] = label_to_index[val]  # stored as 0, 1, 2, or None
            ss.labels_are_up_to_date = False


def select_audio_dir():
    ss.audio_dir = filedialpy.openDir()


def clear_audio_dir():
    ss.audio_dir = None


def set_label(idx, label):
    """Set the label for the current active index

    Then activate the next clip that has not been annotated yet
    and update the session state to indicate that labels are not up to date.
    """
    ss.annotation_df.at[idx, "annotation"] = label
    next_unlabeled_idx(idx)  # activate next clip after updating annotation
    ss.labels_are_up_to_date = False


with st.sidebar:

    if ss.labels_are_up_to_date:
        st.success("All updates are saved")
    else:
        st.warning("Unsaved changes! use Save/Save As")

    with st.expander("Annotation File", expanded=True):
        cols = st.columns(2)
        with cols[0]:
            button(
                label=":material/folder_open: Open",
                key="load_annotation_table",
                shortcut="meta+o",
                # hint=True,
                on_click=load_annotation_df,
                help="Open annotations from a CSV file with columns: 'file', 'start_time', 'annotation'",
            )
        with cols[1]:
            button(
                label=":material/save: Save",
                shortcut="meta+s",
                help="Save updates to the current annotation table",
                key="save_annotation_table",
                on_click=save_annotation_df,
                # hint=True,
            )
        cols = st.columns(2)
        with cols[0]:
            button(
                label=":material/save_as: Save As",
                shortcut="meta+ctrl+s",
                help="Save updates to a new file",
                key="save_annotation_table_as",
                on_click=save_annotation_df,
                args=(True,),
                # hint=True,
            )
        with cols[1]:
            table_to_load = ss.annotation_save_path or ss.original_annotation_path
            st.button(
                type="secondary",
                label=":material/delete: Discard",
                key="discard_annotation_table",
                on_click=load_annotation_df,
                help="Discard unsaved changes and reload the last saved annotation table.",
                args=(table_to_load, True),
            )

        cols = st.columns(2)
        with cols[0]:
            st.button(
                ":material/folder: Audio Dir",
                key="root_audio_directory",
                on_click=select_audio_dir,
                help=f"{ss.audio_dir if ss.audio_dir is not None else 'n/a'}",
            )
        with cols[1]:
            st.button(
                "Clear",
                key="clear_root_audio_directory",
                help="Clear the Root Audio Directory path.",
                on_click=clear_audio_dir,
            )

        st.caption(
            f"size of annotation df: {ss.annotation_df.shape if ss.annotation_df is not None else 'n/a'}"
        )


def check_first_path():
    # check that audio exists in expected location
    first_audio_path = ss.annotation_df.iloc[0]["file"]
    if ss.audio_dir is not None:
        first_audio_path = Path(ss.audio_dir) / first_audio_path
    return Path(first_audio_path).exists()


currently_annotating = False
if ss.annotation_df is None:
    st.write("No annotation task loaded")
elif not check_first_path():
    st.warning(
        f"""Click Root Audio Directory to specify the location of audio files from which relative paths are specified.
        
        First audio file {ss.annotation_df.iloc[0]['file']} was not found relative to Root Audio Directory ({ss.audio_dir}). 
        
        Examples:
        
        If the first audio file in the annotation table is 'audio/clip1.wav', and 'audio' is a subdirectory in '/home/user/annotation_project',
        then set the Root Audio Directory to '/home/user/annotation_project'. 
        
        If the audio files are given just as the file path, eg `clip1.wav`, the 
        Root Audio Directory should be set to the directory where the audio files are located, eg `/home/user/annotation_project/audio`.
        
        If the audio files in the annotation table are absolute paths (eg /home/user/annotation_project/audio/clip1.wav`), use the `Clear` button to set the Root Audio Directory to None.
        """
    )
else:
    currently_annotating = True
    ss.annotation_df["annotation"].unique()
    filtered_annotation_df = ss.annotation_df[
        ss.annotation_df["annotation"].isin(ss["visible_labels"])
    ]

    if len(filtered_annotation_df) == 0:
        st.write("No annotations to display with the selected filters.")
        n_pages = None
    else:
        ss.page_indices, n_pages = pagination.paginator(
            filtered_annotation_df.index,
            items_per_page=ss.settings["n_rows"] * ss.settings["n_columns"],
        )
        if not ss["active_idx"] in ss.page_indices:
            ss["active_idx"] = ss.page_indices[0]

        # st.divider()

        columns = st.columns(ss.settings["n_columns"])
        for ii, idx in enumerate(ss.page_indices):
            row_to_display = ss.annotation_df.loc[idx]
            audio_path = row_to_display["file"]
            if ss.audio_dir is not None:
                audio_path = Path(ss.audio_dir) / audio_path
            with columns[ii % ss.settings["n_columns"]]:
                start_t = row_to_display["start_time"] - ss.settings["pre_look_time"]
                show_audio(
                    audio_path,
                    start_t,
                    start_t + ss.settings["clip_duration"],
                    review_buttons=True,
                    review_id=f"review_clip_{idx}",
                    active=idx == ss["active_idx"],
                )


def previous_page(n_pages):
    autosave_annotation_df()
    pagination.previous_page(n_pages)


def next_page(n_pages):
    autosave_annotation_df()
    pagination.next_page(n_pages)


if currently_annotating:
    # add navigation, display, and annotation controls to sidebar
    with st.sidebar:
        if n_pages is not None:

            # Page select dropdown
            page_format_func = lambda i: "Page %s" % i
            st.selectbox(
                "Page",
                range(n_pages),
                format_func=page_format_func,
                key="page_number",
                on_change=autosave_annotation_df,
            )

            # next/previous item and page buttons
            cols = st.columns(4)
            with cols[0]:
                button(
                    ":material/keyboard_double_arrow_left:",
                    shortcut="p",
                    key="previous_page",
                    on_click=previous_page,
                    args=(n_pages,),
                    hint=True,
                    help="Go to previous page",
                )

            with cols[1]:
                button(
                    ":material/keyboard_double_arrow_right:",
                    shortcut="n",
                    key="next_page",
                    on_click=next_page,
                    args=(n_pages,),
                    hint=True,
                    help="Go to next page",
                )

            with cols[2]:
                button(
                    ":material/arrow_left:",
                    shortcut="j",
                    key="previous_idx",
                    on_click=pagination.previous_idx,
                    hint=True,
                    help="Activate previous clip",
                )

            with cols[3]:
                button(
                    ":material/arrow_right:",
                    "k",
                    key="next_idx",
                    on_click=pagination.next_idx,
                    hint=True,
                    help="Activate next clip",
                )

        # add buttons and keyboard shortcuts for full-page annotations
        with st.expander("Full-page annotations", expanded=True):
            # add_keyboard_shortcuts({"ctrl+shift+s": "Save", "ctrl+shift+o": "Open"})
            cols = st.columns(4)
            with cols[0]:
                button(
                    ":material/check_circle:`A`",
                    shortcut="shift+a",
                    hint=False,
                    key="full_page_yes",
                    on_click=update_page_annotations,
                    args=(ss.page_indices, "yes"),
                    help="Apply 'yes' annotation to all clips on this page",
                )
            with cols[1]:
                button(
                    ":material/cancel:`S`",
                    "shift+s",
                    hint=False,
                    key="full_page_no",
                    on_click=update_page_annotations,
                    args=(ss.page_indices, "no"),
                    help="Apply 'no' annotation to all clips on this page",
                )
            with cols[2]:
                button(
                    ":material/question_mark:`D`",
                    "shitf+d",
                    hint=False,
                    key="full_page_unknown",
                    on_click=update_page_annotations,
                    args=(ss.page_indices, "unknown"),
                    help="Apply 'unknown' annotation to all clips on this page",
                )
            with cols[3]:
                button(
                    ":material/Replay:`F`",
                    "shift+f",
                    key="full_page_reset",
                    hint=False,
                    on_click=update_page_annotations,
                    args=(ss.page_indices, None),
                    help="Clear annotations for all clips on this page",
                )

            st.checkbox(
                "Override existing annotations",
                key="full_page_overrides",
                value=False,
                help="""If checked, clicking an annotation on the left will override existing annotations on this page. 
                Otherwise, the annotation is only applied to un-labeled clips on this page.""",
            )

        # add buttons and keyboard shortcuts for annotation of the active clip
        with st.expander("Selected Clip annotation", expanded=True):
            cols = st.columns(4)
            with cols[0]:
                button(
                    label=":material/check_circle:",
                    shortcut="a",
                    key="active_clip_set_yes",
                    on_click=set_label,
                    args=(ss["active_idx"], "yes"),
                    help="Annotate current selection as 'yes'",
                    hint=True,
                )
            with cols[1]:
                button(
                    label=":material/cancel:",
                    shortcut="s",
                    key="active_clip_set_no",
                    on_click=set_label,
                    args=(ss["active_idx"], "no"),
                    help="Annotate current selection as 'no'",
                    hint=True,
                )
            with cols[2]:
                button(
                    label=":material/question_mark:",
                    shortcut="d",
                    key="active_clip_set_unknown",
                    on_click=set_label,
                    args=(ss["active_idx"], "unknown"),
                    help="Annotate current selection as 'unknown'",
                    hint=True,
                )
            with cols[3]:
                button(
                    label=":material/Replay:",
                    shortcut="f",
                    key="active_clip_reset",
                    on_click=set_label,
                    args=(ss["active_idx"], None),
                    help="Clear annotation for current selection",
                    hint=True,
                )

        # add controls for audio and spectrogram display options
        with st.expander(":material/Settings: Settings", expanded=True):
            # Save/Load configuration buttons
            cols = st.columns(3)
            with cols[0]:
                st.button(
                    ":material/save: Save",
                    key="save_config",
                    on_click=save_settings_to_file,
                    help="Save current display settings to a JSON file",
                )
            with cols[1]:
                if st.button(
                    ":material/folder_open: Load",
                    key="load_config",
                    help="Load display settings from a JSON file",
                ):
                    if load_settings_from_file():
                        st.rerun()

            with cols[2]:
                if st.button(
                    ":material/refresh: Reset",
                    key="reset_config",
                    help="Reset all settings to defaults",
                ):
                    ss.settings = DEFAULT_SETTINGS.copy()
                    st.rerun()

            with st.form("settings_form"):
                if st.form_submit_button("Apply Settings", type="primary"):
                    # Update settings from form values
                    for key in DEFAULT_SETTINGS.keys():
                        if key in st.session_state:
                            ss.settings[key] = ss[key]
                    st.rerun()

                st.write("General settings")
                st.checkbox(
                    "Autosave annotations",
                    key="autosave",
                    value=ss.settings["autosave"],
                    help="Automatically save annotations each time the page is changed.",
                )
                st.checkbox(
                    "Show comment field",
                    key="show_comment_field",
                    value=ss.settings["show_comment_field"],
                    help="Show a comment field for each clip.",
                )
                st.checkbox(
                    "Show file name",
                    key="show_file_name",
                    value=ss.settings["show_file_name"],
                    help="Show the file name of the audio clip above the segmented control.",
                )
                st.checkbox(
                    "Enable keyboard shortcuts",
                    key="enable_shortcuts",
                    value=ss.settings["enable_shortcuts"],
                    help="Enable keyboard shortcuts for navigation and annotation.",
                )
                st.write("Spectrogram settings")
                bandpass_enabled = st.checkbox(
                    "Limit Spectrogram Frequency Range",
                    key="use_bandpass",
                    value=ss.settings["use_bandpass"],
                )
                st.slider(
                    "Bandpass filter range (Hz)",
                    min_value=0,
                    max_value=20000,
                    value=tuple(ss.settings["bandpass_range"]),
                    step=10,
                    disabled=not bandpass_enabled,
                    key="bandpass_range",
                )

                st.slider(
                    "Spectrogram dB range",
                    min_value=-120,
                    max_value=0,
                    value=tuple(ss.settings["dB_range"]),
                    step=1,
                    help="\nhigher values -> lighter; \nnarrower range -> more contrast",
                    key="dB_range",
                )

                st.number_input(
                    "Spectrogram window samples",
                    value=ss.settings["spec_window_size"],
                    min_value=16,
                    max_value=4096,
                    key="spec_window_size",
                )

                colormap_options = [
                    "greys",
                    "viridis",
                    "plasma",
                    "inferno",
                    "magma",
                    "cividis",
                ]
                colormap_index = (
                    colormap_options.index(ss.settings["spectrogram_colormap"])
                    if ss.settings["spectrogram_colormap"] in colormap_options
                    else 0
                )
                st.selectbox(
                    "Spectrogram colormap",
                    options=colormap_options,
                    index=colormap_index,
                    help="Select the colormap for the spectrogram",
                    key="spectrogram_colormap",
                )

                st.checkbox(
                    "Resize images",
                    key="resize_images",
                    value=ss.settings["resize_images"],
                )
                cols = st.columns(2)
                with cols[0]:
                    st.number_input(
                        "width (px)",
                        min_value=10,
                        max_value=1000,
                        key="image_width",
                        value=ss.settings["image_width"],
                    )
                with cols[1]:
                    st.number_input(
                        "height (px)",
                        value=ss.settings["image_height"],
                        min_value=10,
                        max_value=1000,
                        key="image_height",
                    )

                st.write("Display settings")
                cols = st.columns(2)
                with cols[0]:
                    st.number_input(
                        "columns",
                        key="n_columns",
                        min_value=1,
                        max_value=20,
                        value=ss.settings["n_columns"],
                    )
                with cols[1]:
                    st.number_input(
                        "rows",
                        value=ss.settings["n_rows"],
                        min_value=1,
                        max_value=100,
                        key="n_rows",
                    )

                cols = st.columns(2)
                with cols[0]:
                    st.number_input(
                        "Length (sec)",
                        value=float(ss.settings["clip_duration"]),
                        min_value=0.1,
                        max_value=60.0,
                        key="clip_duration",
                    )
                with cols[1]:
                    st.number_input(
                        "Pre-look (sec)",
                        value=float(ss.settings["pre_look_time"]),
                        min_value=0.0,
                        max_value=60.0,
                        key="pre_look_time",
                    )

                st.checkbox(
                    "Show reference frequency",
                    key="show_reference_frequency",
                    value=ss.settings["show_reference_frequency"],
                    help="Show a reference frequency line on the spectrogram.",
                )
                st.number_input(
                    "Reference frequency (Hz)",
                    value=int(ss.settings["reference_frequency"]),
                    min_value=int(0),
                    max_value=int(20000),
                    key="reference_frequency",
                    disabled=not ss.settings["show_reference_frequency"],
                    help="Frequency to show as a reference line on the spectrogram.",
                )

        # Show count of each annotation type
        with st.expander("Annotation Summary", expanded=True):
            if ss.annotation_df is not None:
                st.progress(
                    ss.annotation_df["annotation"].notna().sum() / len(ss.annotation_df)
                )
                st.write(
                    f"Annotated:",
                    ss.annotation_df["annotation"].notna().sum(),
                    "/",
                    len(ss.annotation_df),
                )
                text = []
                for label in option_labels.values():
                    if label is None:
                        continue
                    count = (ss.annotation_df["annotation"] == label).sum()
                    text.extend([label, ": ", count, " "])
                st.write(*text)

            else:
                st.write("No annotations loaded.")

        # Filter displayed clips by current annotation
        with st.expander("Filter by Annotation", expanded=True):
            # filter by label
            with st.form("filter_form"):
                st.multiselect(
                    "Visible Labels",
                    options=option_labels.values(),
                    default=ss["visible_labels"],
                    help="Only show clips with these annotations",
                    key="visible_labels",
                )
                st.form_submit_button("Apply Filter", type="primary")
