#!/usr/bin/env python3
"""
Fast HTTP server for serving audio clips and spectrograms
Eliminates IPC overhead by serving data over HTTP
"""

import asyncio
import json
import logging
import os
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, Any, Optional
import threading
import signal

# Add the current directory to the path to import our modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from create_audio_clips import create_audio_clip_and_spectrogram
from create_audio_clips_batch import process_clips_batch

try:
    from aiohttp import web, ClientError
    from aiohttp.web_response import Response
    import aiohttp_cors
except ImportError:
    print("Installing aiohttp for fast HTTP server...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "aiohttp", "aiohttp-cors"])
    from aiohttp import web, ClientError
    from aiohttp.web_response import Response
    import aiohttp_cors

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)
logger = logging.getLogger(__name__)

class ClipDataCache:
    """In-memory cache for processed clips"""
    def __init__(self, max_size: int = 1000):
        self.cache = {}
        self.access_times = {}
        self.max_size = max_size
        self.lock = threading.Lock()
    
    def _make_key(self, file_path: str, start_time: float, end_time: float, settings_hash: str) -> str:
        return f"{file_path}:{start_time}:{end_time}:{settings_hash}"
    
    def get(self, file_path: str, start_time: float, end_time: float, settings_hash: str) -> Optional[Dict[str, Any]]:
        key = self._make_key(file_path, start_time, end_time, settings_hash)
        with self.lock:
            if key in self.cache:
                self.access_times[key] = time.time()
                return self.cache[key]
        return None
    
    def put(self, file_path: str, start_time: float, end_time: float, settings_hash: str, data: Dict[str, Any]):
        key = self._make_key(file_path, start_time, end_time, settings_hash)
        with self.lock:
            if len(self.cache) >= self.max_size:
                # Remove oldest accessed item
                oldest_key = min(self.access_times.keys(), key=lambda k: self.access_times[k])
                del self.cache[oldest_key]
                del self.access_times[oldest_key]
            
            self.cache[key] = data
            self.access_times[key] = time.time()
    
    def clear(self):
        with self.lock:
            self.cache.clear()
            self.access_times.clear()

class AudioClipServer:
    def __init__(self, port: int = 8000, host: str = 'localhost'):
        self.port = port
        self.host = host
        self.app = web.Application()
        self.cache = ClipDataCache()
        self.executor = ThreadPoolExecutor(max_workers=4)
        self._setup_routes()
        self._setup_cors()
        
    def _setup_routes(self):
        """Setup HTTP routes"""
        self.app.router.add_get('/clip', self.get_clip)
        self.app.router.add_post('/clips/batch', self.get_clips_batch)
        self.app.router.add_get('/health', self.health_check)
        self.app.router.add_delete('/cache', self.clear_cache)
        self.app.router.add_get('/stats', self.get_stats)
    
    def _setup_cors(self):
        """Setup CORS for Electron app"""
        cors = aiohttp_cors.setup(self.app, defaults={
            "*": aiohttp_cors.ResourceOptions(
                allow_credentials=True,
                expose_headers="*",
                allow_headers="*",
                allow_methods="*"
            )
        })
        
        # Add CORS to all routes
        for route in list(self.app.router.routes()):
            cors.add(route)
    
    def _hash_settings(self, settings: Dict[str, Any]) -> str:
        """Create a hash of settings for caching"""
        import hashlib
        settings_str = json.dumps(settings, sort_keys=True)
        return hashlib.md5(settings_str.encode()).hexdigest()[:8]
    
    async def health_check(self, request):
        """Health check endpoint"""
        return web.json_response({
            'status': 'healthy',
            'timestamp': time.time(),
            'cache_size': len(self.cache.cache),
            'server': 'audio-clip-server'
        })
    
    async def clear_cache(self, request):
        """Clear the cache"""
        self.cache.clear()
        return web.json_response({'status': 'cache_cleared'})
    
    async def get_stats(self, request):
        """Get server statistics"""
        return web.json_response({
            'cache_size': len(self.cache.cache),
            'cache_max_size': self.cache.max_size,
            'executor_threads': self.executor._max_workers,
            'server_uptime': time.time()
        })
    
    async def get_clip(self, request):
        """Get a single audio clip with spectrogram"""
        try:
            # Parse query parameters
            file_path = request.query.get('file_path')
            start_time = float(request.query.get('start_time', 0))
            end_time = float(request.query.get('end_time', start_time + 3))
            
            # Parse settings from query or use defaults
            settings = {
                'spec_window_size': int(request.query.get('spec_window_size', 512)),
                'spectrogram_colormap': request.query.get('spectrogram_colormap', 'greys_r'),
                'dB_range': json.loads(request.query.get('dB_range', '[-80, -20]')),
                'use_bandpass': request.query.get('use_bandpass', 'false').lower() == 'true',
                'bandpass_range': json.loads(request.query.get('bandpass_range', '[500, 8000]')),
                'show_reference_frequency': request.query.get('show_reference_frequency', 'false').lower() == 'true',
                'reference_frequency': int(request.query.get('reference_frequency', 1000)),
                'resize_images': request.query.get('resize_images', 'true').lower() == 'true',
                'image_width': int(request.query.get('image_width', 224)),
                'image_height': int(request.query.get('image_height', 224)),
                'normalize_audio': request.query.get('normalize_audio', 'true').lower() == 'true',
                'create_temp_files': False  # Always use base64 for HTTP
            }
            
            if not file_path:
                return web.json_response({'error': 'file_path parameter required'}, status=400)
            
            if not os.path.exists(file_path):
                return web.json_response({'error': f'File not found: {file_path}'}, status=404)
            
            # Check cache first
            settings_hash = self._hash_settings(settings)
            cached_result = self.cache.get(file_path, start_time, end_time, settings_hash)
            if cached_result:
                logger.info(f"Cache hit for {file_path}:{start_time}-{end_time}")
                return web.json_response(cached_result)
            
            # Process clip in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                self.executor,
                create_audio_clip_and_spectrogram,
                file_path, start_time, end_time, settings
            )
            
            if result:
                # Cache the result
                self.cache.put(file_path, start_time, end_time, settings_hash, result)
                
                response_data = {
                    'status': 'success',
                    'audio_base64': result.get('audio_base64', ''),
                    'spectrogram_base64': result.get('spectrogram_base64', ''),
                    'duration': result.get('duration', 0),
                    'sample_rate': result.get('sample_rate', 0),
                    'file_path': file_path,
                    'start_time': start_time,
                    'end_time': end_time,
                    'cached': False
                }
                
                return web.json_response(response_data)
            else:
                return web.json_response({'error': 'Failed to process clip'}, status=500)
                
        except Exception as e:
            logger.error(f"Error processing clip request: {e}\n{traceback.format_exc()}")
            return web.json_response({'error': str(e)}, status=500)
    
    async def get_clips_batch(self, request):
        """Process multiple clips in batch"""
        try:
            data = await request.json()
            clips = data.get('clips', [])
            settings = data.get('settings', {})
            
            if not clips:
                return web.json_response({'error': 'clips array required'}, status=400)
            
            # Set defaults for HTTP mode
            settings.update({
                'create_temp_files': False,  # Always use base64 for HTTP
                'max_workers': min(len(clips), 4)  # Limit concurrency
            })
            
            # Process batch in thread pool
            loop = asyncio.get_event_loop()
            start_time = time.time()
            
            results = await loop.run_in_executor(
                self.executor,
                process_clips_batch,
                clips, settings
            )
            
            processing_time = time.time() - start_time
            
            # Cache individual results
            settings_hash = self._hash_settings(settings)
            for i, (clip, result) in enumerate(zip(clips, results)):
                if result.get('status') == 'success':
                    self.cache.put(
                        clip['file_path'], 
                        clip['start_time'], 
                        clip['end_time'], 
                        settings_hash, 
                        result
                    )
            
            response_data = {
                'status': 'success',
                'results': results,
                'processing_time': processing_time,
                'total_clips': len(clips),
                'successful_clips': len([r for r in results if r.get('status') == 'success']),
                'server_info': {
                    'cache_size': len(self.cache.cache),
                    'processing_mode': 'batch'
                }
            }
            
            return web.json_response(response_data)
            
        except Exception as e:
            logger.error(f"Error processing batch request: {e}\n{traceback.format_exc()}")
            return web.json_response({'error': str(e)}, status=500)
    
    async def start_server(self):
        """Start the HTTP server"""
        runner = web.AppRunner(self.app)
        await runner.setup()
        site = web.TCPSite(runner, self.host, self.port)
        await site.start()
        logger.info(f"Audio clip server started on http://{self.host}:{self.port}")
        return runner

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Start HTTP server for audio clips")
    parser.add_argument('--port', type=int, default=8000, help='Server port')
    parser.add_argument('--host', default='localhost', help='Server host')
    parser.add_argument('--cache-size', type=int, default=1000, help='Cache size')
    
    args = parser.parse_args()
    
    # Create and start server
    server = AudioClipServer(port=args.port, host=args.host)
    server.cache.max_size = args.cache_size
    
    async def run_server():
        runner = await server.start_server()
        
        # Setup graceful shutdown
        def signal_handler(signum, frame):
            logger.info("Received shutdown signal")
            asyncio.create_task(runner.cleanup())
            sys.exit(0)
        
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
        
        try:
            # Keep server running
            while True:
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            logger.info("Shutting down server...")
            await runner.cleanup()
    
    # Run the server
    try:
        asyncio.run(run_server())
    except KeyboardInterrupt:
        logger.info("Server stopped")

if __name__ == "__main__":
    main()