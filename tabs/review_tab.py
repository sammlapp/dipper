"""Review Tab - Annotation review interface with click-to-play spectrograms"""

import pandas as pd
from pathlib import Path
from typing import Optional, List, Dict
from nicegui import ui, events
from .audio_utils import create_spectrogram


class ClickableSpectrogramCard:
    """A card with clickable spectrogram and annotation controls"""
    
    def __init__(self, clip_data: dict, index: int, on_annotation_change, review_mode='binary', 
                 show_comments=False, available_classes=None, spectrogram_settings=None):
        self.clip_data = clip_data
        self.index = index
        self.on_annotation_change = on_annotation_change
        self.review_mode = review_mode
        self.show_comments = show_comments
        self.available_classes = available_classes or []
        self.spectrogram_settings = spectrogram_settings or {}
        
        self.spectrogram_base64 = None
        self.audio_base64 = None
        self.audio_element = None
        self.annotation = clip_data.get('annotation', 'unlabeled')
        self.comment = clip_data.get('comments', '')
        self.is_loaded = False
        
        # UI elements to update
        self.card_container = None
        self.annotation_badge = None
        self.label_select = None
        self.spec_container = None
        
    def render(self):
        """Render the spectrogram card"""
        with ui.card().classes('w-full') as card:
            self.card_container = card
            # File info
            file_name = Path(self.clip_data.get('file', 'Unknown')).name
            ui.label(file_name).classes('text-caption font-bold')
            ui.label(
                f"{self.clip_data.get('start_time', 0):.2f}s - {self.clip_data.get('end_time', 0):.2f}s"
            ).classes('text-caption text-gray-600')
            
            # Container for spectrogram that will be updated
            with ui.column().classes('w-full mt-2') as self.spec_container:
                # Auto-load on render (no manual Load button)
                if not self.is_loaded:
                    ui.label('Loading...').classes('text-caption text-gray-500')
                    # Auto-load after render
                    ui.timer(0.1, self.load_clip, once=True)
                else:
                    self._render_spectrogram()
            
            # Annotation controls
            if self.review_mode == 'binary':
                with ui.row().classes('w-full gap-1 mt-2'):
                    ui.button('Yes', icon='check', on_click=lambda: self.set_annotation('yes')).props('size=sm color=positive flat')
                    ui.button('No', icon='close', on_click=lambda: self.set_annotation('no')).props('size=sm color=negative flat')
                    ui.button('?', on_click=lambda: self.set_annotation('uncertain')).props('size=sm color=warning flat')
                    ui.button('∅', on_click=lambda: self.set_annotation('unlabeled')).props('size=sm flat')
                
                # Annotation indicator
                annotation_colors = {
                    'yes': 'positive',
                    'no': 'negative', 
                    'uncertain': 'warning',
                    'unlabeled': 'grey'
                }
                self.annotation_badge = ui.badge(
                    self.annotation, 
                    color=annotation_colors.get(self.annotation, 'grey')
                ).props('outline')
            else:
                # Multiclass mode
                with ui.column().classes('w-full gap-1 mt-2'):
                    self.label_select = ui.select(
                        options=self.available_classes,
                        label='Select Classes',
                        multiple=True,
                        value=self.get_current_labels(),
                        on_change=self.on_labels_change
                    ).classes('w-full')
            
            # Comments field (if enabled)
            if self.show_comments:
                ui.input(
                    label='Comments',
                    value=self.comment,
                    on_change=self.on_comment_change
                ).classes('w-full mt-2').props('dense')
    
    def _render_spectrogram(self):
        """Render the spectrogram and audio elements"""
        if self.spectrogram_base64 and self.audio_base64:
            # Use interactive_image for click-to-play
            ui.interactive_image(
                f'data:image/png;base64,{self.spectrogram_base64}',
                on_mouse=self.on_spectrogram_click,
                events=['click'],
                cross=False
            ).classes('w-full cursor-pointer').style('max-height: 200px; object-fit: contain;')
            
            # Hidden audio element
            self.audio_element = ui.audio(
                f'data:audio/wav;base64,{self.audio_base64}',
                controls=False,
                autoplay=False
            ).style('display: none')
    
    def load_clip(self):
        """Load the audio clip and spectrogram"""
        try:
            # Merge default settings with spectrogram settings
            settings = {
                'image_width': 400,
                'image_height': 200,
                **self.spectrogram_settings
            }
            
            spec_base64, audio_base64, sr = create_spectrogram(
                self.clip_data.get('file'),
                self.clip_data.get('start_time', 0),
                self.clip_data.get('end_time', 3),
                settings=settings
            )
            
            self.spectrogram_base64 = spec_base64
            self.audio_base64 = audio_base64
            self.is_loaded = True
            
            # Clear the container and re-render
            self.spec_container.clear()
            with self.spec_container:
                self._render_spectrogram()
            
            ui.notify('Clip loaded - click to play', type='positive')
            
        except Exception as e:
            ui.notify(f'Error loading clip: {e}', type='negative')
            import traceback
            print(f"Error loading clip: {traceback.format_exc()}")
    
    def on_spectrogram_click(self, e: events.MouseEventArguments):
        """Handle click on spectrogram to play audio"""
        if self.audio_element:
            self.audio_element.seek(0)
            self.audio_element.play()
    
    def set_annotation(self, value: str):
        """Set annotation value"""
        self.annotation = value
        # Update badge if it exists
        if hasattr(self, 'annotation_badge') and self.annotation_badge:
            annotation_colors = {
                'yes': 'positive',
                'no': 'negative', 
                'uncertain': 'warning',
                'unlabeled': 'grey'
            }
            self.annotation_badge.text = value
            self.annotation_badge.props(f'color={annotation_colors.get(value, "grey")}')
        
        if self.on_annotation_change:
            self.on_annotation_change(self.index, value)
    
    def get_current_labels(self):
        """Get current labels as list"""
        labels = self.clip_data.get('labels', '')
        if not labels:
            return []
        try:
            import json
            return json.loads(labels) if isinstance(labels, str) else labels
        except:
            return []
    
    def on_labels_change(self, e):
        """Handle multiclass label changes"""
        # e.value contains the new selection
        new_labels = e.value if hasattr(e, 'value') else []
        if self.on_annotation_change:
            import json
            self.on_annotation_change(self.index, json.dumps(new_labels))
    
    def on_comment_change(self, e):
        """Handle comment changes"""
        self.comment = e.sender.value
        if self.on_annotation_change:
            self.on_annotation_change(self.index, self.annotation, self.comment)


class FocusViewClip:
    """Focus view component for reviewing a single large clip"""
    
    def __init__(self, clip_data: dict, on_annotation_change, on_next, on_prev, 
                 review_mode='binary', show_comments=False, available_classes=None):
        self.clip_data = clip_data
        self.on_annotation_change = on_annotation_change
        self.on_next = on_next
        self.on_prev = on_prev
        self.review_mode = review_mode
        self.show_comments = show_comments
        self.available_classes = available_classes or []
        
        self.spectrogram_base64 = None
        self.audio_base64 = None
        self.audio_element = None
        self.annotation = clip_data.get('annotation', 'unlabeled')
        self.comment = clip_data.get('comments', '')
        
        # UI elements
        self.spec_container = None
        self.annotation_label = None
        self.label_select = None
        
    def render(self):
        """Render the focus view clip"""
        with ui.column().classes('w-full items-center'):
            # File info
            ui.label(f"File: {Path(self.clip_data.get('file', 'Unknown')).name}").classes('text-h6 mb-2')
            ui.label(
                f"Time: {self.clip_data.get('start_time', 0):.2f}s - {self.clip_data.get('end_time', 0):.2f}s"
            ).classes('text-caption mb-4')
            
            # Container for spectrogram
            with ui.column().classes('w-full items-center') as self.spec_container:
                if not self.spectrogram_base64:
                    ui.button('Load Clip', icon='play_circle', on_click=self.load_clip).classes('mb-4')
                else:
                    self._render_spectrogram()
            
            # Annotation controls
            with ui.card().classes('w-full p-4 mb-4'):
                ui.label('Annotation').classes('text-h6 mb-2')
                
                if self.review_mode == 'binary':
                    with ui.row().classes('w-full gap-2 justify-center'):
                        ui.button('Yes', icon='check', on_click=lambda: self.set_annotation('yes')).props('color=positive')
                        ui.button('No', icon='close', on_click=lambda: self.set_annotation('no')).props('color=negative')
                        ui.button('Uncertain', icon='help', on_click=lambda: self.set_annotation('uncertain')).props('color=warning')
                        ui.button('Unlabeled', icon='remove', on_click=lambda: self.set_annotation('unlabeled'))
                    
                    self.annotation_label = ui.label(f'Current: {self.annotation.upper()}').classes('text-caption mt-2')
                else:
                    # Multiclass mode
                    self.label_select = ui.select(
                        options=self.available_classes,
                        label='Select Classes',
                        multiple=True,
                        value=self.get_current_labels(),
                        on_change=self.on_labels_change
                    ).classes('w-full')
                
                # Comments field (if enabled)
                if self.show_comments:
                    ui.input(
                        label='Comments',
                        value=self.comment,
                        on_change=self.on_comment_change
                    ).classes('w-full mt-4')
            
            # Navigation controls
            with ui.row().classes('gap-4 mb-4'):
                ui.button('Previous (J)', icon='navigate_before', on_click=self.on_prev)
                ui.button('Next (K)', icon='navigate_next', on_click=self.on_next).props('color=primary')
            
            # Keyboard shortcuts help
            with ui.expansion('Keyboard Shortcuts', icon='keyboard').classes('w-full'):
                ui.markdown('''
- **A**: Mark as Yes
- **S**: Mark as No
- **D**: Mark as Uncertain
- **F**: Mark as Unlabeled
- **Space**: Play/Pause
- **J**: Previous clip
- **K**: Next clip
                ''').classes('text-caption')
    
    def _render_spectrogram(self):
        """Render the spectrogram and audio elements"""
        if self.spectrogram_base64 and self.audio_base64:
            # Large interactive spectrogram (click-to-play)
            with ui.card().classes('mb-4'):
                ui.label('Click spectrogram to play audio').classes('text-caption text-gray-600 mb-2')
                ui.interactive_image(
                    f'data:image/png;base64,{self.spectrogram_base64}',
                    on_mouse=self.on_spectrogram_click,
                    events=['click'],
                    cross=False
                ).classes('cursor-pointer').style('max-width: 900px; max-height: 400px; object-fit: contain;')
            
            # Hidden audio element
            self.audio_element = ui.audio(
                f'data:audio/wav;base64,{self.audio_base64}',
                controls=False,
                autoplay=False
            ).style('display: none')
            
            # Visible audio controls
            with ui.row().classes('items-center gap-4 mb-4'):
                ui.button(icon='play_arrow', on_click=lambda: self.audio_element.play()).props('round color=primary')
                ui.button(icon='pause', on_click=lambda: self.audio_element.pause()).props('round flat')
                ui.button(icon='replay', on_click=lambda: (self.audio_element.seek(0), self.audio_element.play())).props('round flat')
    
    def load_clip(self):
        """Load the audio clip and spectrogram"""
        try:
            spec_base64, audio_base64, sr = create_spectrogram(
                self.clip_data.get('file'),
                self.clip_data.get('start_time', 0),
                self.clip_data.get('end_time', 3),
                settings={'image_width': 900, 'image_height': 400}
            )
            
            self.spectrogram_base64 = spec_base64
            self.audio_base64 = audio_base64
            
            # Clear the container and re-render
            self.spec_container.clear()
            with self.spec_container:
                self._render_spectrogram()
            
            ui.notify('Clip loaded - click to play', type='positive')
            
        except Exception as e:
            ui.notify(f'Error loading clip: {e}', type='negative')
            import traceback
            print(f"Error loading clip: {traceback.format_exc()}")
    
    def on_spectrogram_click(self, e: events.MouseEventArguments):
        """Handle click on spectrogram to play audio"""
        if self.audio_element:
            self.audio_element.seek(0)
            self.audio_element.play()
    
    def set_annotation(self, value: str):
        """Set annotation value"""
        self.annotation = value
        # Update label if it exists
        if hasattr(self, 'annotation_label') and self.annotation_label:
            self.annotation_label.text = f'Current: {value.upper()}'
        
        if self.on_annotation_change:
            self.on_annotation_change(value)
    
    def get_current_labels(self):
        """Get current labels as list"""
        labels = self.clip_data.get('labels', '')
        if not labels:
            return []
        try:
            import json
            return json.loads(labels) if isinstance(labels, str) else labels
        except:
            return []
    
    def on_labels_change(self, e):
        """Handle multiclass label changes"""
        # e.value contains the new selection
        new_labels = e.value if hasattr(e, 'value') else []
        if self.on_annotation_change:
            import json
            self.on_annotation_change(json.dumps(new_labels))
    
    def on_comment_change(self, e):
        """Handle comment changes"""
        self.comment = e.sender.value


class ReviewTab:
    """Review tab for annotation review with grid and focus modes"""
    
    def __init__(self):
        self.data: Optional[pd.DataFrame] = None
        self.current_index = 0
        self.current_page = 0
        self.review_mode = 'binary'
        self.view_mode = 'grid'  # 'grid' or 'focus'
        self.grid_rows = 3
        self.grid_columns = 4
        self.show_comments = False
        self.available_classes = []
        self.annotations_changed = False
        self.settings_drawer_open = False
        self.loaded_file_path = None
        
        # Spectrogram settings (matching ReviewSettings.js)
        self.spec_window_size = 512
        self.spectrogram_colormap = 'viridis'
        self.dB_range = [-80, -20]
        self.use_bandpass = False
        self.bandpass_range = [500, 8000]
        self.normalize_audio = True
        self.resize_images = True
        self.image_width = 400
        self.image_height = 200
        
    def render(self):
        """Render the review tab UI"""
        with ui.row().classes('w-full'):
            # Main content area
            with ui.column().classes('flex-grow p-4'):
                ui.label('Review Annotations').classes('text-h4 mb-4')
                
                # File loading section
                with ui.card().classes('w-full mb-4'):
                    ui.label('Load Annotation Data').classes('text-h6 mb-2')
                    with ui.row().classes('w-full gap-2'):
                        self.file_input = ui.input(
                            label='CSV File Path',
                            placeholder='Enter path to CSV file with annotations...'
                        ).classes('flex-grow')
                        ui.button('Load', icon='upload_file', on_click=self.load_annotation_file)
                
                # Toolbar
                with ui.row().classes('w-full items-center gap-4 mb-4').bind_visibility_from(self, 'data', lambda d: d is not None):
                    # View mode toggle
                    with ui.button_group():
                        ui.button('Grid', icon='grid_view', on_click=lambda: self.set_view_mode('grid'))
                        ui.button('Focus', icon='fullscreen', on_click=lambda: self.set_view_mode('focus'))
                    
                    ui.space()
                    
                    # Progress indicator
                    if self.view_mode == 'focus':
                        ui.label().bind_text_from(
                            self, 'current_index',
                            lambda i: f'Clip {i + 1} of {len(self.data) if self.data is not None else 0}'
                        ).classes('text-h6')
                    else:
                        ui.label().bind_text_from(
                            self, 'current_page',
                            lambda p: f'Page {p + 1} of {self.get_total_pages()}'
                        ).classes('text-h6')
                    
                    ui.space()
                    
                    # Settings toggle
                    ui.button(icon='settings', on_click=self.toggle_settings).props('flat')
                    ui.button('Save', icon='save', on_click=self.save_annotations).props('color=primary')
                
                # Content container
                self.content_container = ui.column().classes('w-full')
                with self.content_container:
                    ui.label('Load a file to start reviewing').classes('text-caption text-gray-500')
            
            # Settings drawer (collapsible side panel with all settings)
            with ui.column().classes('w-96 p-4 bg-gray-100 overflow-y-auto').bind_visibility_from(self, 'settings_drawer_open'):
                with ui.row().classes('w-full items-center mb-4'):
                    ui.label('Settings').classes('text-h5')
                    ui.space()
                    ui.button(icon='close', on_click=self.toggle_settings).props('flat dense')
                
                # Review mode settings
                with ui.expansion('Review Mode', icon='assignment', value=True).classes('w-full mb-2'):
                    ui.select(
                        ['binary', 'multiclass'],
                        label='Review Mode',
                        value='binary'
                    ).bind_value(self, 'review_mode').classes('w-full mb-2')
                    
                    ui.checkbox('Show Comments Field', value=False).bind_value(self, 'show_comments').classes('mb-2')
                
                # Grid layout settings
                with ui.expansion('Grid Layout', icon='grid_view', value=True).classes('w-full mb-2'):
                    ui.number(
                        label='Grid Rows',
                        value=3,
                        min=1,
                        max=10
                    ).bind_value(self, 'grid_rows').classes('w-full mb-2')
                    
                    ui.number(
                        label='Grid Columns',
                        value=4,
                        min=1,
                        max=6
                    ).bind_value(self, 'grid_columns').classes('w-full mb-2')
                
                # Spectrogram settings
                with ui.expansion('Spectrogram Settings', icon='graphic_eq', value=False).classes('w-full mb-2'):
                    ui.number(
                        label='Window Size',
                        value=512,
                        min=128,
                        max=2048,
                        step=128
                    ).bind_value(self, 'spec_window_size').classes('w-full mb-2')
                    
                    ui.select(
                        options=['viridis', 'plasma', 'inferno', 'magma', 'greys_r', 'greys', 'hot', 'cool'],
                        label='Colormap',
                        value='viridis'
                    ).bind_value(self, 'spectrogram_colormap').classes('w-full mb-2')
                    
                    with ui.row().classes('w-full gap-2'):
                        ui.number(
                            label='dB Min',
                            value=-80,
                            min=-120,
                            max=0
                        ).bind_value(self, 'dB_range', forward=lambda v: [v, self.dB_range[1]], 
                                    backward=lambda r: r[0]).classes('flex-1')
                        
                        ui.number(
                            label='dB Max',
                            value=-20,
                            min=-80,
                            max=0
                        ).bind_value(self, 'dB_range', forward=lambda v: [self.dB_range[0], v],
                                    backward=lambda r: r[1]).classes('flex-1')
                    
                    ui.checkbox('Use Bandpass Filter', value=False).bind_value(self, 'use_bandpass').classes('mb-2')
                    
                    with ui.row().classes('w-full gap-2').bind_visibility_from(self, 'use_bandpass'):
                        ui.number(
                            label='Low (Hz)',
                            value=500,
                            min=0,
                            max=20000
                        ).bind_value(self, 'bandpass_range', forward=lambda v: [v, self.bandpass_range[1]],
                                    backward=lambda r: r[0]).classes('flex-1')
                        
                        ui.number(
                            label='High (Hz)',
                            value=8000,
                            min=0,
                            max=20000
                        ).bind_value(self, 'bandpass_range', forward=lambda v: [self.bandpass_range[0], v],
                                    backward=lambda r: r[1]).classes('flex-1')
                    
                    ui.checkbox('Normalize Audio', value=True).bind_value(self, 'normalize_audio').classes('mb-2')
                
                # Image size settings
                with ui.expansion('Image Size', icon='photo_size_select_large', value=False).classes('w-full mb-2'):
                    ui.checkbox('Resize Images', value=True).bind_value(self, 'resize_images').classes('mb-2')
                    
                    with ui.row().classes('w-full gap-2').bind_visibility_from(self, 'resize_images'):
                        ui.number(
                            label='Width',
                            value=400,
                            min=200,
                            max=1200
                        ).bind_value(self, 'image_width').classes('flex-1')
                        
                        ui.number(
                            label='Height',
                            value=200,
                            min=100,
                            max=600
                        ).bind_value(self, 'image_height').classes('flex-1')
                
                # Apply and reset buttons
                with ui.row().classes('w-full gap-2 mt-4'):
                    ui.button('Apply Settings', icon='check', on_click=self.apply_settings).props('color=primary').classes('flex-1')
                    ui.button('Reset', icon='refresh', on_click=self.reset_settings).props('flat').classes('flex-1')
    
    def toggle_settings(self):
        """Toggle settings drawer"""
        self.settings_drawer_open = not self.settings_drawer_open
    
    def set_view_mode(self, mode: str):
        """Set view mode (grid or focus)"""
        self.view_mode = mode
        self.render_content()
    
    def apply_settings(self):
        """Apply settings and re-render"""
        self.render_content()
        ui.notify('Settings applied - re-rendering spectrograms', type='positive')
    
    def reset_settings(self):
        """Reset settings to defaults"""
        self.spec_window_size = 512
        self.spectrogram_colormap = 'viridis'
        self.dB_range = [-80, -20]
        self.use_bandpass = False
        self.bandpass_range = [500, 8000]
        self.normalize_audio = True
        self.resize_images = True
        self.image_width = 400
        self.image_height = 200
        self.grid_rows = 3
        self.grid_columns = 4
        self.show_comments = False
        ui.notify('Settings reset to defaults', type='info')
    
    def get_total_pages(self):
        """Get total number of pages for grid view"""
        if self.data is None:
            return 0
        items_per_page = self.grid_rows * self.grid_columns
        return max(1, (len(self.data) + items_per_page - 1) // items_per_page)
    
    def load_annotation_file(self):
        """Load annotation file"""
        file_path = self.file_input.value
        
        try:
            self.data = pd.read_csv(file_path)
            self.loaded_file_path = file_path
            ui.notify(f'Loaded {len(self.data)} clips for review', type='positive')
            
            # Initialize annotations if not present
            if 'annotation' not in self.data.columns:
                self.data['annotation'] = 'unlabeled'
            if 'comments' not in self.data.columns:
                self.data['comments'] = ''
            
            # Extract available classes for multiclass mode
            if 'species' in self.data.columns:
                self.available_classes = sorted(self.data['species'].dropna().unique().tolist())
            elif 'class' in self.data.columns:
                self.available_classes = sorted(self.data['class'].dropna().unique().tolist())
            
            # Start with first clip/page
            self.current_index = 0
            self.current_page = 0
            self.render_content()
            
        except Exception as e:
            ui.notify(f'Error loading file: {e}', type='negative')
            import traceback
            print(f"Error loading annotation file: {traceback.format_exc()}")
    
    def get_spectrogram_settings(self):
        """Get current spectrogram settings as dict"""
        return {
            'spec_window_size': self.spec_window_size,
            'spectrogram_colormap': self.spectrogram_colormap,
            'dB_range': self.dB_range,
            'use_bandpass': self.use_bandpass,
            'bandpass_range': self.bandpass_range,
            'normalize_audio': self.normalize_audio,
            'resize_images': self.resize_images,
            'image_width': self.image_width,
            'image_height': self.image_height
        }
    
    def render_content(self):
        """Render the main content area based on view mode"""
        if self.data is None or len(self.data) == 0:
            return
        
        self.content_container.clear()
        
        with self.content_container:
            if self.view_mode == 'grid':
                self.render_grid_view()
            else:
                self.render_focus_view()
    
    def render_grid_view(self):
        """Render grid view with multiple clips"""
        items_per_page = self.grid_rows * self.grid_columns
        start_idx = self.current_page * items_per_page
        end_idx = min(start_idx + items_per_page, len(self.data))
        
        page_data = self.data.iloc[start_idx:end_idx]
        
        # Grid layout
        grid_html = f'grid-cols-{self.grid_columns} gap-4'
        with ui.grid(columns=self.grid_columns).classes('w-full gap-4'):
            for idx, (_, row) in enumerate(page_data.iterrows()):
                clip_data = {
                    'file': row.get('file', ''),
                    'start_time': row.get('start_time', 0),
                    'end_time': row.get('end_time', 3),
                    'annotation': row.get('annotation', 'unlabeled'),
                    'labels': row.get('labels', ''),
                    'comments': row.get('comments', ''),
                    'species': row.get('species', row.get('class', 'Unknown'))
                }
                
                card = ClickableSpectrogramCard(
                    clip_data,
                    start_idx + idx,
                    self.update_annotation,
                    self.review_mode,
                    self.show_comments,
                    self.available_classes,
                    self.get_spectrogram_settings()
                )
                card.render()
        
        # Pagination controls
        with ui.row().classes('w-full justify-center gap-4 mt-4'):
            ui.button(
                'Previous Page',
                icon='navigate_before',
                on_click=self.prev_page
            ).props('flat').bind_enabled_from(self, 'current_page', lambda p: p > 0)
            
            ui.label(f'Page {self.current_page + 1} of {self.get_total_pages()}').classes('text-h6')
            
            ui.button(
                'Next Page',
                icon='navigate_next',
                on_click=self.next_page
            ).props('flat').bind_enabled_from(
                self, 'current_page',
                lambda p: p < self.get_total_pages() - 1
            )
    
    def render_focus_view(self):
        """Render focus view with single large clip"""
        if self.current_index >= len(self.data):
            self.current_index = 0
        
        row = self.data.iloc[self.current_index]
        clip_data = {
            'file': row.get('file', ''),
            'start_time': row.get('start_time', 0),
            'end_time': row.get('end_time', 3),
            'annotation': row.get('annotation', 'unlabeled'),
            'labels': row.get('labels', ''),
            'comments': row.get('comments', ''),
            'species': row.get('species', row.get('class', 'Unknown'))
        }
        
        focus_view = FocusViewClip(
            clip_data,
            on_annotation_change=lambda v: self.update_annotation(self.current_index, v),
            on_next=self.next_clip,
            on_prev=self.prev_clip,
            review_mode=self.review_mode,
            show_comments=self.show_comments,
            available_classes=self.available_classes
        )
        focus_view.render()
    
    def update_annotation(self, index: int, value: str, comment: str = None):
        """Update annotation for a clip"""
        if self.data is not None and index < len(self.data):
            self.data.at[index, 'annotation'] = value
            if comment is not None:
                self.data.at[index, 'comments'] = comment
            self.annotations_changed = True
    
    def next_clip(self):
        """Go to next clip (focus mode)"""
        if self.data is not None and self.current_index < len(self.data) - 1:
            self.current_index += 1
            self.render_content()
    
    def prev_clip(self):
        """Go to previous clip (focus mode)"""
        if self.data is not None and self.current_index > 0:
            self.current_index -= 1
            self.render_content()
    
    def next_page(self):
        """Go to next page (grid mode)"""
        if self.current_page < self.get_total_pages() - 1:
            self.current_page += 1
            self.render_content()
    
    def prev_page(self):
        """Go to previous page (grid mode)"""
        if self.current_page > 0:
            self.current_page -= 1
            self.render_content()
    
    def save_annotations(self):
        """Save annotations to file"""
        if self.data is None:
            ui.notify('No data to save', type='warning')
            return
        
        try:
            # Determine output path
            if self.loaded_file_path:
                # Save with _annotated suffix next to original file
                input_path = Path(self.loaded_file_path)
                output_path = input_path.parent / f"{input_path.stem}_annotated{input_path.suffix}"
            else:
                # Default name
                output_path = Path('annotations_reviewed.csv')
            
            # Save to CSV
            self.data.to_csv(output_path, index=False)
            ui.notify(f'✓ Annotations saved to {output_path.name}', type='positive')
            self.annotations_changed = False
            
            print(f"Saved annotations to: {output_path}")
            
        except Exception as e:
            ui.notify(f'Error saving annotations: {e}', type='negative')
            import traceback
            print(f"Error saving annotations: {traceback.format_exc()}")
