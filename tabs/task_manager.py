"""Task Management for NiceGUI App - Direct Subprocess Execution"""

import asyncio
import json
import uuid
import subprocess
import threading
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime
from nicegui import ui


class TaskStatus:
    """Task status constants"""
    UNSTARTED = 'unstarted'
    QUEUED = 'queued'
    RUNNING = 'running'
    COMPLETED = 'completed'
    FAILED = 'failed'
    CANCELLED = 'cancelled'


class TaskManager:
    """Manages inference/training/extraction tasks via direct subprocess execution"""
    
    def __init__(self):
        self.tasks: Dict[str, dict] = {}
        self.current_task = None
        self.queue = []
        self.processes: Dict[str, subprocess.Popen] = {}
        
    def create_task(self, task_type: str, config: dict, name: str = None) -> dict:
        """Create a new task"""
        task_id = str(uuid.uuid4())
        
        task = {
            'id': task_id,
            'type': task_type,
            'name': name or f'{task_type}_task_{datetime.now().strftime("%Y%m%d_%H%M%S")}',
            'status': TaskStatus.UNSTARTED,
            'config': config,
            'created': datetime.now().isoformat(),
            'started': None,
            'completed': None,
            'progress': '',
            'result': None,
            'job_id': None,
            'system_pid': None
        }
        
        self.tasks[task_id] = task
        return task
    
    def get_task(self, task_id: str) -> Optional[dict]:
        """Get task by ID"""
        return self.tasks.get(task_id)
    
    def get_all_tasks(self) -> List[dict]:
        """Get all tasks sorted by creation date"""
        return sorted(self.tasks.values(), key=lambda t: t['created'], reverse=True)
    
    def update_task(self, task_id: str, updates: dict):
        """Update task fields"""
        if task_id in self.tasks:
            self.tasks[task_id].update(updates)
    
    async def queue_task(self, task_id: str):
        """Add task to queue and start processing"""
        task = self.get_task(task_id)
        if not task or task['status'] == TaskStatus.RUNNING:
            return False
        
        self.update_task(task_id, {
            'status': TaskStatus.QUEUED,
            'progress': 'Queued for execution'
        })
        
        if task_id not in self.queue:
            self.queue.append(task_id)
        
        # Start processing if no current task
        if not self.current_task:
            await self.process_queue()
        
        return True
    
    async def process_queue(self):
        """Process tasks in queue"""
        if self.current_task or not self.queue:
            return
        
        task_id = self.queue.pop(0)
        task = self.get_task(task_id)
        
        if not task or task['status'] == TaskStatus.CANCELLED:
            # Task was deleted or cancelled, process next
            await self.process_queue()
            return
        
        self.current_task = task_id
        await self.execute_task(task_id)
    
    async def execute_task(self, task_id: str):
        """Execute a task via subprocess"""
        task = self.get_task(task_id)
        if not task:
            return
        
        try:
            self.update_task(task_id, {
                'status': TaskStatus.RUNNING,
                'started': datetime.now().isoformat(),
                'progress': f'Starting {task["type"]}...'
            })
            
            # Execute based on task type
            if task['type'] == 'inference':
                await self.run_inference(task)
            elif task['type'] == 'training':
                await self.run_training(task)
            elif task['type'] == 'extraction':
                await self.run_extraction(task)
            
        except Exception as e:
            print(f'Task execution error: {e}')
            import traceback
            traceback.print_exc()
            self.update_task(task_id, {
                'status': TaskStatus.FAILED,
                'completed': datetime.now().isoformat(),
                'progress': 'Failed',
                'result': {'error': str(e)}
            })
        finally:
            self.current_task = None
            # Process next task
            await self.process_queue()
    
    async def run_inference(self, task: dict):
        """Run inference task via direct subprocess"""
        config = task['config']
        
        # Create job folder name
        job_folder_name = f"{task['name']}_{task['id'][:8]}"
        output_dir = config.get('output_dir', '/tmp')
        job_folder = Path(output_dir) / job_folder_name
        job_folder.mkdir(parents=True, exist_ok=True)
        
        # Prepare config for inference script
        inference_config = {
            'model_source': config.get('model_source', 'bmz'),
            'model': config.get('model', 'BirdSetEfficientNetB1'),
            'files': config.get('files', []),
            'file_globbing_patterns': config.get('file_globbing_patterns', []),
            'file_list': config.get('file_list', ''),
            'output_dir': str(job_folder),
            'sparse_save_threshold': config.get('sparse_save_threshold'),
            'split_by_subfolder': config.get('split_by_subfolder', False),
            'subset_size': config.get('subset_size') if config.get('testing_mode_enabled') else None,
            'inference_settings': {
                'clip_overlap': config.get('overlap', 0.0),
                'batch_size': config.get('batch_size', 1),
                'num_workers': config.get('worker_count', 1)
            }
        }
        
        # Save config file
        config_path = job_folder / f'{task["name"]}_config.json'
        config_path.write_text(json.dumps(inference_config, indent=2))
        
        # Log file path
        log_file_path = job_folder / 'inference_log.txt'
        
        # Determine Python environment
        if config.get('use_custom_python_env') and config.get('custom_python_env_path'):
            python_path = Path(config['custom_python_env_path'])
            if python_path.is_dir():
                # If it's a directory, assume it's a conda/venv environment
                python_exe = python_path / 'bin' / 'python'
            else:
                python_exe = python_path
        else:
            python_exe = Path('/usr/bin/python3')  # Default system Python
        
        # Path to inference script
        script_path = Path(__file__).parent.parent / 'backend' / 'scripts' / 'inference.py'
        
        try:
            # Build command
            cmd = [str(python_exe), str(script_path), '--config', str(config_path)]
            
            print(f'Starting inference task: {" ".join(cmd)}')
            
            # Start subprocess
            log_file = open(log_file_path, 'w')
            process = subprocess.Popen(
                cmd,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                text=True,
                cwd=str(script_path.parent)
            )
            
            # Store process
            self.processes[task['id']] = process
            
            self.update_task(task['id'], {
                'system_pid': process.pid,
                'progress': f'Running inference (PID: {process.pid})...',
                'log_file': str(log_file_path)
            })
            
            # Monitor process in background thread
            def monitor_process():
                try:
                    return_code = process.wait()
                    log_file.close()
                    
                    if return_code == 0:
                        self.update_task(task['id'], {
                            'status': TaskStatus.COMPLETED,
                            'completed': datetime.now().isoformat(),
                            'progress': 'Completed successfully',
                            'result': {'exit_code': return_code}
                        })
                        ui.notify(f'Task "{task["name"]}" completed successfully', type='positive')
                    else:
                        # Read last lines of log file for error
                        try:
                            with open(log_file_path, 'r') as f:
                                log_lines = f.readlines()
                                error_msg = ''.join(log_lines[-10:]) if log_lines else f'Exit code: {return_code}'
                        except:
                            error_msg = f'Exit code: {return_code}'
                        
                        self.update_task(task['id'], {
                            'status': TaskStatus.FAILED,
                            'completed': datetime.now().isoformat(),
                            'progress': 'Failed',
                            'result': {'error': error_msg, 'exit_code': return_code}
                        })
                        ui.notify(f'Task "{task["name"]}" failed', type='negative')
                    
                    # Remove from processes dict
                    if task['id'] in self.processes:
                        del self.processes[task['id']]
                    
                except Exception as e:
                    print(f'Error monitoring process: {e}')
                    self.update_task(task['id'], {
                        'status': TaskStatus.FAILED,
                        'completed': datetime.now().isoformat(),
                        'progress': 'Failed',
                        'result': {'error': str(e)}
                    })
            
            # Start monitoring thread
            monitor_thread = threading.Thread(target=monitor_process, daemon=True)
            monitor_thread.start()
            
        except Exception as e:
            print(f'Failed to start inference: {e}')
            import traceback
            traceback.print_exc()
            self.update_task(task['id'], {
                'status': TaskStatus.FAILED,
                'completed': datetime.now().isoformat(),
                'progress': 'Failed to start',
                'result': {'error': str(e)}
            })
            raise
    
    async def run_training(self, task: dict):
        """Run training task"""
        # TODO: Implement training similar to inference
        ui.notify('Training not yet implemented', type='warning')
        self.update_task(task['id'], {
            'status': TaskStatus.FAILED,
            'completed': datetime.now().isoformat(),
            'progress': 'Not implemented',
            'result': {'error': 'Training not yet implemented'}
        })
    
    async def run_extraction(self, task: dict):
        """Run extraction task"""
        # TODO: Implement extraction similar to inference
        ui.notify('Extraction not yet implemented', type='warning')
        self.update_task(task['id'], {
            'status': TaskStatus.FAILED,
            'completed': datetime.now().isoformat(),
            'progress': 'Not implemented',
            'result': {'error': 'Extraction not yet implemented'}
        })
    
    async def cancel_task(self, task_id: str):
        """Cancel a running task by terminating the subprocess"""
        task = self.get_task(task_id)
        if not task:
            return False
        
        # Get the process
        process = self.processes.get(task_id)
        if process and process.poll() is None:  # Process is still running
            try:
                process.terminate()
                # Give it a moment to terminate gracefully
                await asyncio.sleep(0.5)
                if process.poll() is None:
                    # Force kill if still running
                    process.kill()
                
                self.update_task(task_id, {
                    'status': TaskStatus.CANCELLED,
                    'completed': datetime.now().isoformat(),
                    'progress': 'Cancelled by user'
                })
                
                if task_id in self.processes:
                    del self.processes[task_id]
                
                ui.notify(f'Task "{task["name"]}" cancelled', type='warning')
                return True
            except Exception as e:
                print(f'Error cancelling task: {e}')
                return False
        
        return False
    
    def delete_task(self, task_id: str):
        """Delete a task"""
        task = self.get_task(task_id)
        if task and task['status'] != TaskStatus.RUNNING:
            del self.tasks[task_id]
            if task_id in self.queue:
                self.queue.remove(task_id)
            return True
        return False


# Global task manager instance
task_manager = TaskManager()
