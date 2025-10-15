"""Inference Tab - Model inference interface"""

import os
import json
import asyncio
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional
from nicegui import ui, events
import uuid
import glob
from .task_manager import task_manager, TaskStatus


class InferenceTab:
    """Inference tab for running model predictions"""
    
    def __init__(self):
        self.task_name = ''
        self.file_selection_mode = 'files'
        self.selected_files = []
        self.selected_folder = None
        self.selected_extensions = ['wav', 'mp3', 'flac']
        self.file_count = 0
        self.first_file = ''
        self.glob_patterns = ''
        self.file_list_path = ''
        self.config = {
            'files': [],
            'file_globbing_patterns': [],
            'file_list': '',
            'model_source': 'bmz',
            'model': 'BirdSetEfficientNetB1',
            'overlap': 0.0,
            'batch_size': 1,
            'worker_count': 1,
            'output_dir': '',
            'sparse_outputs_enabled': False,
            'sparse_save_threshold': -3.0,
            'split_by_subfolder': False,
            'use_custom_python_env': False,
            'custom_python_env_path': '',
            'testing_mode_enabled': False,
            'subset_size': 10
        }
        self.running_tasks = {}
        
        # UI elements that need to be updated
        self.path_input = None
        self.file_count_label = None
        self.first_file_label = None
        self.patterns_textarea = None
        self.extension_checkboxes = []
        self.file_list_input = None
        self.task_container = None
        
        # Task manager
        self.task_manager = task_manager
        
    def render(self):
        """Render the inference tab UI"""
        with ui.column().classes('w-full p-4'):
            ui.label('Model Inference').classes('text-h4 mb-4')
            
            # Task name
            with ui.row().classes('w-full items-center gap-4 mb-4'):
                ui.label('Task Name (optional):').classes('text-bold')
                ui.input(placeholder='Leave empty for auto-generated name').classes('flex-grow').bind_value(self, 'task_name')
            
            # File selection mode
            with ui.card().classes('w-full mb-4'):
                ui.label('Audio File Selection').classes('text-h6 mb-2')
                
                with ui.row().classes('w-full gap-2 mb-2'):
                    ui.radio(
                        {
                            'files': 'Select Files',
                            'folder': 'Select Folder',
                            'patterns': 'Glob Patterns',
                            'filelist': 'File List'
                        },
                        value='files',
                        on_change=self.on_file_mode_change
                    ).props('inline').bind_value(self, 'file_selection_mode')
                
                # Dynamic content based on mode
                with ui.column().classes('w-full gap-2') as self.file_selection_container:
                    self.render_file_selection_ui()
            
            # Model configuration
            with ui.card().classes('w-full mb-4'):
                ui.label('Model Configuration').classes('text-h6 mb-2')
                
                with ui.grid(columns=2).classes('w-full gap-4'):
                    # Model source
                    with ui.column():
                        ui.label('Model Source:')
                        ui.select(
                            ['bmz', 'local', 'custom'],
                            value='bmz'
                        ).bind_value(self.config, 'model_source')
                    
                    # Model selection
                    with ui.column():
                        ui.label('Model:')
                        ui.select(
                            [
                                'BirdSetEfficientNetB1',
                                'BirdNET',
                                'Perch',
                                'HawkEars',
                                'RanaSierraeCNN'
                            ],
                            value='BirdSetEfficientNetB1'
                        ).bind_value(self.config, 'model')
                    
                    # Overlap
                    with ui.column():
                        ui.label('Overlap:')
                        ui.number(
                            value=0.0,
                            min=0.0,
                            max=0.9,
                            step=0.1
                        ).bind_value(self.config, 'overlap')
                    
                    # Batch size
                    with ui.column():
                        ui.label('Batch Size:')
                        ui.number(
                            value=1,
                            min=1,
                            max=64,
                            step=1
                        ).bind_value(self.config, 'batch_size')
                    
                    # Worker count
                    with ui.column():
                        ui.label('Worker Count:')
                        ui.number(
                            value=1,
                            min=1,
                            max=16,
                            step=1
                        ).bind_value(self.config, 'worker_count')
                    
                    # Output directory
                    with ui.column().classes('col-span-2'):
                        ui.label('Output Directory:')
                        with ui.row().classes('w-full gap-2'):
                            ui.input(placeholder='Enter output directory path...').classes('flex-grow').bind_value(self.config, 'output_dir')
            
            # Advanced settings
            with ui.expansion('Advanced Settings').classes('w-full mb-4'):
                with ui.column().classes('w-full gap-4 p-4'):
                    # Sparse outputs
                    with ui.row().classes('w-full items-center gap-4'):
                        ui.checkbox('Sparse Outputs Enabled').bind_value(self.config, 'sparse_outputs_enabled')
                        ui.number(
                            label='Sparse Save Threshold',
                            value=-3.0,
                            step=0.1
                        ).bind_value(self.config, 'sparse_save_threshold').classes('w-32')
                    
                    # Other options
                    ui.checkbox('Split by Subfolder').bind_value(self.config, 'split_by_subfolder')
                    
                    # Testing mode
                    with ui.row().classes('w-full items-center gap-4'):
                        ui.checkbox('Testing Mode (Limit Files)').bind_value(self.config, 'testing_mode_enabled')
                        ui.number(
                            label='Subset Size',
                            value=10,
                            min=1,
                            max=1000,
                            step=1
                        ).bind_value(self.config, 'subset_size').classes('w-32')
                    
                    # Custom Python environment
                    with ui.column().classes('w-full gap-2'):
                        ui.checkbox('Use Custom Python Environment').bind_value(self.config, 'use_custom_python_env')
                        ui.input(
                            label='Custom Python Environment Path',
                            placeholder='Path to custom Python environment...'
                        ).classes('w-full').bind_value(self.config, 'custom_python_env_path')
            
            # Action buttons
            with ui.row().classes('w-full gap-2 mb-4'):
                ui.button('Create Task', icon='add', on_click=self.create_task)
                ui.button('Create and Run', icon='play_arrow', on_click=self.create_and_run_task).props('color=primary')
                ui.button('Save Config', icon='save', on_click=self.save_config)
                ui.button('Load Config', icon='folder_open', on_click=self.load_config)
                ui.button('Reset Form', icon='refresh', on_click=self.reset_form).props('flat')
            
            # Task monitor
            with ui.card().classes('w-full'):
                ui.label('Running Tasks').classes('text-h6 mb-2')
                with ui.column().classes('w-full gap-2') as self.task_container:
                    ui.label('No active tasks').classes('text-caption text-gray-500')
        
        # Set up periodic task update
        ui.timer(2.0, self.update_task_display)
    
    def on_file_mode_change(self, e):
        """Handle file selection mode change"""
        self.file_selection_container.clear()
        with self.file_selection_container:
            self.render_file_selection_ui()
    
    def render_file_selection_ui(self):
        """Render the file selection UI based on current mode"""
        if self.file_selection_mode == 'files':
            self.render_files_mode()
        elif self.file_selection_mode == 'folder':
            self.render_folder_mode()
        elif self.file_selection_mode == 'patterns':
            self.render_patterns_mode()
        elif self.file_selection_mode == 'filelist':
            self.render_filelist_mode()
    
    def render_files_mode(self):
        """Render file selection UI for files mode"""
        with ui.column().classes('w-full gap-2'):
            ui.label('Enter audio file paths (one per line):').classes('text-caption')
            self.path_input = ui.textarea(
                placeholder='Enter full paths to audio files (one per line)...'
            ).classes('w-full').on('change', self.on_files_input_change)
            
            with ui.row().classes('w-full items-center gap-2'):
                self.file_count_label = ui.label(f'Files: {self.file_count}').classes('text-caption')
                if self.first_file:
                    self.first_file_label = ui.label(f'First: {Path(self.first_file).name}').classes('text-caption')
    
    def render_folder_mode(self):
        """Render file selection UI for folder mode"""
        with ui.column().classes('w-full gap-2'):
            # Extension selection
            ui.label('File Extensions to Include:').classes('text-caption font-bold')
            with ui.row().classes('w-full gap-4'):
                for ext in ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'aiff']:
                    ui.checkbox(
                        ext.upper(),
                        value=ext in self.selected_extensions
                    ).on('update:model-value', lambda e, ext=ext: self.toggle_extension(ext, e.args))
            
            # Folder path input
            ui.label('Folder Path (will search recursively):').classes('text-caption mt-2')
            self.path_input = ui.input(
                placeholder='Enter full path to folder...'
            ).classes('w-full').on('change', self.on_folder_input_change)
            
            with ui.row().classes('w-full items-center gap-2'):
                self.file_count_label = ui.label(f'Files found: {self.file_count}').classes('text-caption')
                if self.first_file:
                    self.first_file_label = ui.label(f'First: {Path(self.first_file).name}').classes('text-caption')
    
    def render_patterns_mode(self):
        """Render file selection UI for glob patterns mode"""
        with ui.column().classes('w-full gap-2'):
            # Extension selection
            ui.label('File Extensions to Include:').classes('text-caption font-bold')
            with ui.row().classes('w-full gap-4'):
                for ext in ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'aac']:
                    ui.checkbox(
                        ext.upper(),
                        value=ext in self.selected_extensions
                    ).on('update:model-value', lambda e, ext=ext: self.toggle_extension(ext, e.args))
            
            # Patterns input
            ui.label('Glob Patterns (one per line):').classes('text-caption mt-2')
            ui.label('Use * for wildcard, ** for recursive subdirectories').classes('text-caption text-gray-500')
            self.patterns_textarea = ui.textarea(
                placeholder='Example:\n/path/to/audio/**/*.wav\n/another/path/*.mp3'
            ).classes('w-full').props('rows=4')
            
            ui.button('Find Files', icon='search', on_click=self.find_files_from_patterns)
            
            with ui.row().classes('w-full items-center gap-2'):
                self.file_count_label = ui.label(f'Files found: {self.file_count}').classes('text-caption')
                if self.first_file:
                    self.first_file_label = ui.label(f'First: {Path(self.first_file).name}').classes('text-caption')
    
    def render_filelist_mode(self):
        """Render file selection UI for file list mode"""
        with ui.column().classes('w-full gap-2'):
            ui.label('Path to text file containing audio file paths:').classes('text-caption')
            self.file_list_input = ui.input(
                placeholder='Enter path to .txt or .csv file with audio file paths...'
            ).classes('w-full').on('change', self.on_filelist_input_change)
            
            with ui.row().classes('w-full items-center gap-2'):
                self.file_count_label = ui.label(f'Files in list: {self.file_count}').classes('text-caption')
                if self.first_file:
                    self.first_file_label = ui.label(f'First: {Path(self.first_file).name}').classes('text-caption')
    
    def toggle_extension(self, ext: str, checked: bool):
        """Toggle extension selection"""
        if checked and ext not in self.selected_extensions:
            self.selected_extensions.append(ext)
        elif not checked and ext in self.selected_extensions:
            self.selected_extensions.remove(ext)
    
    def on_files_input_change(self, e):
        """Handle files input change"""
        text = e.sender.value
        if not text:
            self.config['files'] = []
            self.file_count = 0
            self.first_file = ''
            return
        
        # Split by newlines and filter empty lines
        files = [f.strip() for f in text.split('\n') if f.strip()]
        
        # Validate files exist
        valid_files = [f for f in files if Path(f).is_file()]
        
        self.config['files'] = valid_files
        self.config['file_globbing_patterns'] = []
        self.config['file_list'] = ''
        self.file_count = len(valid_files)
        self.first_file = valid_files[0] if valid_files else ''
        
        if len(valid_files) < len(files):
            ui.notify(f'{len(files) - len(valid_files)} invalid file paths', type='warning')
        
        # Update labels
        if self.file_count_label:
            self.file_count_label.text = f'Files: {self.file_count}'
        if self.first_file and self.first_file_label:
            self.first_file_label.text = f'First: {Path(self.first_file).name}'
    
    def on_folder_input_change(self, e):
        """Handle folder input change"""
        folder_path = e.sender.value
        if not folder_path:
            return
        
        path_obj = Path(folder_path)
        if not path_obj.is_dir():
            ui.notify('Invalid folder path', type='warning')
            return
        
        self.selected_folder = folder_path
        self.count_files_in_folder()
    
    def count_files_in_folder(self):
        """Count files in selected folder with selected extensions"""
        if not self.selected_folder or not self.selected_extensions:
            return
        
        folder_path = Path(self.selected_folder)
        patterns = []
        
        # Generate patterns for selected extensions
        for ext in self.selected_extensions:
            patterns.append(f'{folder_path}/**/*.{ext}')
            patterns.append(f'{folder_path}/**/*.{ext.upper()}')
        
        # Find all matching files
        all_files = []
        for pattern in patterns:
            all_files.extend(glob.glob(pattern, recursive=True))
        
        # Remove duplicates
        all_files = list(set(all_files))
        
        self.config['files'] = []
        self.config['file_globbing_patterns'] = patterns
        self.config['file_list'] = ''
        self.file_count = len(all_files)
        self.first_file = all_files[0] if all_files else ''
        
        # Update labels
        if self.file_count_label:
            self.file_count_label.text = f'Files found: {self.file_count}'
        if self.first_file and self.first_file_label:
            self.first_file_label.text = f'First: {Path(self.first_file).name}'
        
        ui.notify(f'Found {self.file_count} files', type='positive' if self.file_count > 0 else 'warning')
    
    def find_files_from_patterns(self):
        """Find files from glob patterns"""
        if not self.patterns_textarea:
            return
        
        text = self.patterns_textarea.value
        if not text:
            ui.notify('Please enter glob patterns', type='warning')
            return
        
        patterns = [p.strip() for p in text.split('\n') if p.strip()]
        
        # Find all matching files
        all_files = []
        for pattern in patterns:
            try:
                matched = glob.glob(pattern, recursive=True)
                all_files.extend(matched)
            except Exception as e:
                ui.notify(f'Error with pattern {pattern}: {e}', type='warning')
        
        # Filter by selected extensions
        if self.selected_extensions:
            all_files = [f for f in all_files if any(f.lower().endswith(f'.{ext}') for ext in self.selected_extensions)]
        
        # Remove duplicates
        all_files = list(set(all_files))
        
        self.config['files'] = []
        self.config['file_globbing_patterns'] = patterns
        self.config['file_list'] = ''
        self.file_count = len(all_files)
        self.first_file = all_files[0] if all_files else ''
        
        # Update labels
        if self.file_count_label:
            self.file_count_label.text = f'Files found: {self.file_count}'
        if self.first_file and self.first_file_label:
            self.first_file_label.text = f'First: {Path(self.first_file).name}'
        
        ui.notify(f'Found {self.file_count} files', type='positive' if self.file_count > 0 else 'warning')
    
    def on_filelist_input_change(self, e):
        """Handle file list input change"""
        list_path = e.sender.value
        if not list_path:
            return
        
        path_obj = Path(list_path)
        if not path_obj.is_file():
            ui.notify('Invalid file list path', type='warning')
            return
        
        try:
            # Read file list
            with open(list_path, 'r') as f:
                files = [line.strip() for line in f if line.strip()]
            
            # Validate files
            valid_files = [f for f in files if Path(f).is_file()]
            
            self.config['files'] = []
            self.config['file_globbing_patterns'] = []
            self.config['file_list'] = list_path
            self.file_count = len(valid_files)
            self.first_file = valid_files[0] if valid_files else ''
            
            # Update labels
            if self.file_count_label:
                self.file_count_label.text = f'Files in list: {self.file_count}'
            if self.first_file and self.first_file_label:
                self.first_file_label.text = f'First: {Path(self.first_file).name}'
            
            if len(valid_files) < len(files):
                ui.notify(f'{len(files) - len(valid_files)} invalid file paths in list', type='warning')
            else:
                ui.notify(f'Loaded {self.file_count} files from list', type='positive')
        
        except Exception as e:
            ui.notify(f'Error reading file list: {e}', type='negative')
    
    def create_task(self):
        """Create inference task"""
        # Validate inputs
        has_files = (
            len(self.config.get('files', [])) > 0 or
            len(self.config.get('file_globbing_patterns', [])) > 0 or
            self.config.get('file_list', '').strip() != ''
        )
        
        if not has_files:
            ui.notify('Please select audio files first', type='warning')
            return None
        
        if self.file_count == 0:
            ui.notify('No audio files found with current selection', type='warning')
            return None
        
        if not self.config.get('output_dir'):
            ui.notify('Please specify an output directory', type='warning')
            return None
        
        # Create task
        task_name = self.task_name.strip() if self.task_name.strip() else None
        task = self.task_manager.create_task('inference', self.config.copy(), task_name)
        
        ui.notify(f'Task "{task["name"]}" created', type='positive')
        self.update_task_display()
        return task
    
    async def create_and_run_task(self):
        """Create and run inference task"""
        task = self.create_task()
        if not task:
            return
        
        # Queue and run the task
        ui.notify(f'Starting task: {task["name"]}', type='info')
        await self.task_manager.queue_task(task['id'])
        self.update_task_display()
    
    def save_config(self):
        """Save configuration to file"""
        try:
            # Create configs directory in user's home
            config_dir = Path.home() / '.bioacoustics_gui' / 'configs'
            config_dir.mkdir(parents=True, exist_ok=True)
            
            config_path = config_dir / 'inference_config.json'
            
            config_data = {
                'task_name': self.task_name,
                'file_selection_mode': self.file_selection_mode,
                'selected_extensions': self.selected_extensions,
                'glob_patterns_text': self.glob_patterns,
                'config': self.config
            }
            
            with open(config_path, 'w') as f:
                json.dump(config_data, f, indent=2)
            
            ui.notify(f'Configuration saved to {config_path}', type='positive')
        except Exception as e:
            ui.notify(f'Error saving config: {e}', type='negative')
            print(f'Save config error: {e}')
    
    def load_config(self):
        """Load configuration from file"""
        try:
            config_path = Path.home() / '.bioacoustics_gui' / 'configs' / 'inference_config.json'
            
            if not config_path.exists():
                ui.notify('No saved configuration found', type='warning')
                return
            
            with open(config_path, 'r') as f:
                config_data = json.load(f)
            
            self.task_name = config_data.get('task_name', '')
            self.file_selection_mode = config_data.get('file_selection_mode', 'files')
            self.selected_extensions = config_data.get('selected_extensions', ['wav', 'mp3', 'flac'])
            self.glob_patterns = config_data.get('glob_patterns_text', '')
            
            # Load config but preserve the structure
            loaded_config = config_data.get('config', {})
            for key, value in loaded_config.items():
                self.config[key] = value
            
            # Re-render file selection UI
            if hasattr(self, 'file_selection_container'):
                self.file_selection_container.clear()
                with self.file_selection_container:
                    self.render_file_selection_ui()
            
            ui.notify('Configuration loaded', type='positive')
        except Exception as e:
            ui.notify(f'Error loading config: {e}', type='negative')
            print(f'Load config error: {e}')
    
    def reset_form(self):
        """Reset form to default values"""
        self.task_name = ''
        self.file_selection_mode = 'files'
        self.selected_files = []
        self.selected_folder = None
        self.selected_extensions = ['wav', 'mp3', 'flac']
        self.file_count = 0
        self.first_file = ''
        self.glob_patterns = ''
        self.file_list_path = ''
        self.config = {
            'files': [],
            'file_globbing_patterns': [],
            'file_list': '',
            'model_source': 'bmz',
            'model': 'BirdSetEfficientNetB1',
            'overlap': 0.0,
            'batch_size': 1,
            'worker_count': 1,
            'output_dir': '',
            'sparse_outputs_enabled': False,
            'sparse_save_threshold': -3.0,
            'split_by_subfolder': False,
            'use_custom_python_env': False,
            'custom_python_env_path': '',
            'testing_mode_enabled': False,
            'subset_size': 10
        }
        
        # Re-render file selection UI
        self.file_selection_container.clear()
        with self.file_selection_container:
            self.render_file_selection_ui()
        
        ui.notify('Form reset to defaults', type='info')
    
    def update_task_display(self):
        """Update the task display with current tasks"""
        if not self.task_container:
            return
        
        tasks = self.task_manager.get_all_tasks()
        
        # Filter to only show inference tasks
        inference_tasks = [t for t in tasks if t['type'] == 'inference']
        
        # Only show running and queued tasks
        active_tasks = [t for t in inference_tasks if t['status'] in [TaskStatus.RUNNING, TaskStatus.QUEUED]]
        
        self.task_container.clear()
        
        with self.task_container:
            if not active_tasks:
                ui.label('No active tasks').classes('text-caption text-gray-500')
            else:
                for task in active_tasks:
                    with ui.card().classes('w-full p-2 mb-2'):
                        with ui.row().classes('w-full items-center justify-between'):
                            with ui.column().classes('gap-1'):
                                ui.label(task['name']).classes('font-bold')
                                status_color = 'blue' if task['status'] == TaskStatus.RUNNING else 'purple'
                                ui.label(f"Status: {task['status']}").classes(f'text-{status_color}-500 text-caption')
                                if task['progress']:
                                    ui.label(task['progress']).classes('text-caption')
                                if task.get('system_pid'):
                                    ui.label(f"PID: {task['system_pid']}").classes('text-caption text-gray-500')
                            
                            if task['status'] == TaskStatus.RUNNING:
                                ui.button(
                                    'Cancel',
                                    icon='cancel',
                                    on_click=lambda t=task: self.cancel_task(t['id'])
                                ).props('flat color=negative size=sm')
    
    async def cancel_task(self, task_id: str):
        """Cancel a running task"""
        await self.task_manager.cancel_task(task_id)
        self.update_task_display()
        ui.notify('Task cancelled', type='info')
