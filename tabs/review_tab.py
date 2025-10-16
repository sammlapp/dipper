"""Review Tab - Annotation review interface with click-to-play spectrograms"""

import pandas as pd
from pathlib import Path
from typing import Optional, List, Dict
from nicegui import ui, events
from .audio_utils import create_spectrogram


class ClickableSpectrogramCard:
    """A card with clickable spectrogram and annotation controls"""
    
    def __init__(self, clip_data: dict, index: int, on_annotation_change, review_mode='binary', 
                 show_comments=False, available_classes=None):
        self.clip_data = clip_data
        self.index = index
        self.on_annotation_change = on_annotation_change
        self.review_mode = review_mode
        self.show_comments = show_comments
        self.available_classes = available_classes or []
        
        self.spectrogram_base64 = None
        self.audio_base64 = None
        self.audio_element = None
        self.annotation = clip_data.get('annotation', 'unlabeled')
        self.comment = clip_data.get('comments', '')
        self.is_loaded = False
        
    def render(self):
        """Render the spectrogram card"""
        with ui.card().classes('w-full'):
            # File info
            file_name = Path(self.clip_data.get('file', 'Unknown')).name
            ui.label(file_name).classes('text-caption font-bold')
            ui.label(
                f"{self.clip_data.get('start_time', 0):.2f}s - {self.clip_data.get('end_time', 0):.2f}s"
            ).classes('text-caption text-gray-600')
            
            # Spectrogram (click-to-play)
            if not self.is_loaded:
                ui.button('Load', icon='play_circle', on_click=self.load_clip).classes('w-full mt-2')
            else:
                # Use interactive_image for click-to-play
                self.spectrogram_img = ui.interactive_image(
                    f'data:image/png;base64,{self.spectrogram_base64}',
                    on_mouse=self.on_spectrogram_click,
                    events=['click']
                ).classes('w-full cursor-pointer').style('max-height: 200px')
                
                # Hidden audio element
                self.audio_element = ui.audio(
                    f'data:audio/wav;base64,{self.audio_base64}',
                    controls=False,
                    autoplay=False
                ).style('display: none')
            
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
                ui.badge(self.annotation, color=annotation_colors.get(self.annotation, 'grey')).props('outline')
            else:
                # Multiclass mode
                with ui.column().classes('w-full gap-1 mt-2'):
                    ui.select(
                        self.available_classes,
                        label='Class',
                        multiple=True,
                        value=self.get_current_labels()
                    ).classes('w-full').on('update:model-value', self.on_labels_change)
            
            # Comments field (if enabled)
            if self.show_comments:
                ui.input(
                    label='Comments',
                    value=self.comment,
                    on_change=self.on_comment_change
                ).classes('w-full mt-2').props('dense')
    
    def load_clip(self):
        """Load the audio clip and spectrogram"""
        try:
            spec_base64, audio_base64, sr = create_spectrogram(
                self.clip_data.get('file'),
                self.clip_data.get('start_time', 0),
                self.clip_data.get('end_time', 3),
                settings={'image_width': 400, 'image_height': 200}
            )
            
            self.spectrogram_base64 = spec_base64
            self.audio_base64 = audio_base64
            self.is_loaded = True
            
            # Re-render to show spectrogram
            ui.notify('Clip loaded - click to play', type='positive')
            
        except Exception as e:
            ui.notify(f'Error loading clip: {e}', type='negative')
    
    def on_spectrogram_click(self, e: events.MouseEventArguments):
        """Handle click on spectrogram to play audio"""
        if self.audio_element:
            self.audio_element.seek(0)
            self.audio_element.play()
    
    def set_annotation(self, value: str):
        """Set annotation value"""
        self.annotation = value
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
        if self.on_annotation_change:
            import json
            self.on_annotation_change(self.index, json.dumps(e.args))
    
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
        
    def render(self):
        """Render the focus view clip"""
        with ui.column().classes('w-full items-center'):
            # File info
            ui.label(f"File: {Path(self.clip_data.get('file', 'Unknown')).name}").classes('text-h6 mb-2')
            ui.label(
                f"Time: {self.clip_data.get('start_time', 0):.2f}s - {self.clip_data.get('end_time', 0):.2f}s"
            ).classes('text-caption mb-4')
            
            # Load clip button or spectrogram
            if not self.spectrogram_base64:
                ui.button('Load Clip', icon='play_circle', on_click=self.load_clip).classes('mb-4')
            else:
                # Large interactive spectrogram (click-to-play)
                with ui.card().classes('mb-4'):
                    ui.label('Click spectrogram to play audio').classes('text-caption text-gray-600 mb-2')
                    self.spectrogram_img = ui.interactive_image(
                        f'data:image/png;base64,{self.spectrogram_base64}',
                        on_mouse=self.on_spectrogram_click,
                        events=['click']
                    ).classes('cursor-pointer').style('max-width: 900px; max-height: 400px')
                
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
            
            # Annotation controls
            with ui.card().classes('w-full p-4 mb-4'):
                ui.label('Annotation').classes('text-h6 mb-2')
                
                if self.review_mode == 'binary':
                    with ui.row().classes('w-full gap-2 justify-center'):
                        ui.button('Yes', icon='check', on_click=lambda: self.set_annotation('yes')).props('color=positive')
                        ui.button('No', icon='close', on_click=lambda: self.set_annotation('no')).props('color=negative')
                        ui.button('Uncertain', icon='help', on_click=lambda: self.set_annotation('uncertain')).props('color=warning')
                        ui.button('Unlabeled', icon='remove', on_click=lambda: self.set_annotation('unlabeled'))
                    
                    ui.label(f'Current: {self.annotation.upper()}').classes('text-caption mt-2')
                else:
                    # Multiclass mode
                    ui.select(
                        self.available_classes,
                        label='Select Classes',
                        multiple=True,
                        value=self.get_current_labels()
                    ).classes('w-full').on('update:model-value', self.on_labels_change)
                
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
            
            ui.notify('Clip loaded - click spectrogram to play', type='positive')
            
        except Exception as e:
            ui.notify(f'Error loading clip: {e}', type='negative')
    
    def on_spectrogram_click(self, e: events.MouseEventArguments):
        """Handle click on spectrogram to play audio"""
        if self.audio_element:
            self.audio_element.seek(0)
            self.audio_element.play()
    
    def set_annotation(self, value: str):
        """Set annotation value"""
        self.annotation = value
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
        if self.on_annotation_change:
            import json
            self.on_annotation_change(json.dumps(e.args))
    
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
            
            # Settings drawer (collapsible side panel)
            with ui.column().classes('w-80 p-4 bg-gray-100').bind_visibility_from(self, 'settings_drawer_open'):
                ui.label('Display Settings').classes('text-h6 mb-4')
                
                ui.select(
                    ['binary', 'multiclass'],
                    label='Review Mode',
                    value='binary'
                ).bind_value(self, 'review_mode').classes('w-full mb-2')
                
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
                
                ui.checkbox('Show Comments', value=False).bind_value(self, 'show_comments').classes('mb-2')
                
                ui.button('Apply', icon='check', on_click=self.apply_settings).props('color=primary').classes('w-full')
    
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
        ui.notify('Settings applied', type='positive')
    
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
            ui.notify(f'Loaded {len(self.data)} clips for review', type='positive')
            
            # Initialize annotations if not present
            if 'annotation' not in self.data.columns:
                self.data['annotation'] = 'unlabeled'
            if 'comments' not in self.data.columns:
                self.data['comments'] = ''
            
            # Extract available classes for multiclass mode
            if 'species' in self.data.columns:
                self.available_classes = sorted(self.data['species'].dropna().unique().tolist())
            
            # Start with first clip/page
            self.current_index = 0
            self.current_page = 0
            self.render_content()
            
        except Exception as e:
            ui.notify(f'Error loading file: {e}', type='negative')
    
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
                    self.available_classes
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
            return
        
        # Save to same file with _annotated suffix
        output_path = Path('annotations_reviewed.csv')
        self.data.to_csv(output_path, index=False)
        ui.notify(f'Annotations saved to {output_path}', type='positive')
        self.annotations_changed = False
