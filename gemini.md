# Gemini Code Assist - Project Guide

This document provides a comprehensive overview of the `training_gui` project, its architecture, development practices, and key components. It is intended as a reference for development with Gemini Code Assist.

## 1. Project Overview

`training_gui` is a cross-platform desktop application designed for bioacoustics machine learning workflows. It enables users to run inference with pre-trained models, review detections, annotate data, and train new models in an active learning loop.

The application is built with an **Electron + React** frontend and a **Python** backend. A key architectural feature is its hybrid communication system, designed for both robustness and high performance.

### Core Architectural Pillars
- **Interactive UI**: A modern, responsive UI built with React and Material-UI, running in an Electron shell.
- **Powerful Backend**: Python scripts leverage industry-standard libraries like PyTorch, OpenSoundscape, and Librosa for all machine learning and audio processing tasks.
- **Performance-Tuned Data Flow**: For data-intensive tasks like reviewing spectrograms, the application uses a dedicated, high-performance Python HTTP server to serve data directly to the frontend, bypassing slower IPC mechanisms.

## 2. Key Components & Technologies

| Component          | Technology/Library                                                              | Purpose                                                                                             |
| ------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Frontend**       | Electron, React, Material-UI                                                    | Provides the desktop application shell and user interface.                                          |
| **Backend**        | Python, PyTorch, OpenSoundscape, bioacoustics-model-zoo, Librosa, Pandas         | Handles model inference, training, audio processing, and data manipulation.                         |
| **Communication**  | 1. **Electron IPC**: `ipcMain`/`ipcRenderer`                                    | For general command-and-control, like starting training/inference tasks and receiving logs.         |
|                    | 2. **Local HTTP Server**: `aiohttp`                                             | For high-throughput data transfer (e.g., serving batches of spectrograms/audio clips as base64).    |
| **Build Tools**    | `electron-builder`, `react-scripts`, `concurrently`                             | For packaging the application and managing the development workflow.                                |

## 3. Development Setup

### Frontend (`/frontend`)

```bash
# Navigate to the frontend directory
cd frontend

# Install dependencies
npm install

# Start the development server (React app in browser with hot reload)
npm run dev

# Build the React app for production
npm run build

# Build the full Electron application
npm run electron-build
```

### Backend (`/backend`)

```bash
# Navigate to the backend directory
cd backend

# Create and activate a Python virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt
```

## 4. Architecture Deep Dive

### Communication Patterns

The application intelligently uses two different methods for frontend-backend communication.

1.  **Command & Control (via Electron IPC):**
    -   **Flow**: React Component -> `window.electronAPI.runPythonScript()` -> Electron `main.js` (IPC) -> Spawns Python script as a child process.
    -   **Usage**: Used for long-running, self-contained tasks like `inference.py` and `train_model.py`.
    -   **Data Return**: Progress and logs are streamed back to the UI via `stdout` and captured by an IPC listener (`onPythonOutput`).

2.  **High-Throughput Data (via Local HTTP Server):**
    -   **Flow**: React Component -> `fetch('http://localhost:8000/clips/batch')` -> Python `http_server.py` -> Returns JSON with base64 data.
    -   **Usage**: Specifically for the "Review" tab, where many small audio clips and spectrograms must be loaded quickly. This avoids the overhead and serialization limits of IPC.
    -   **Key Scripts**: `http_server.py`, `create_audio_clips_batch.py`.
    -   **Performance Features**:
        -   Asynchronous server (`aiohttp`) to handle concurrent requests.
        -   In-memory LRU cache (`ClipDataCache`) to instantly serve recently requested clips.
        -   Parallel processing of clips using a `ThreadPoolExecutor`.
        -   Data is encoded to base64 in memory, avoiding slow disk I/O.

### Key Python Scripts (`/backend/scripts`)

- **`inference.py`**: Executes model inference on a list of audio files. Called via IPC.
- **`train_model.py`**: Manages the model training loop. Called via IPC.
- **`http_server.py`**: Runs the fast, async HTTP server for serving clip data. Started as a background process.
- **`create_audio_clips_batch.py`**: The workhorse for the HTTP server. Processes a batch of clips in parallel, generating spectrograms and audio data.
- **`create_audio_clips.py`**: Processes a *single* clip. The foundational, non-batch version.
- **`profile_performance.py`**: A utility script to benchmark and validate the performance of the clip generation pipeline.
- **`streamlit_inference.py`**: A reference/prototype Streamlit app. Not part of the final Electron application but useful for understanding the core logic.

### Frontend Structure (`/frontend/src`)

- **`electron/main.js`**: The Electron main process. Handles window creation and IPC communication.
- **`App.js`**: The main React component, containing the tab-based navigation.
- **`components/`**: Contains the React components for each tab (`InferenceTab.js`, `TrainingTab.js`, `ReviewTab.js`, etc.). These components manage their own state and make calls to the backend.

## 5. Project Goals & Roadmap (from `plan.md`)

This summarizes the active development goals and known issues.

### General
- **Packaging**: Package the app for easy distribution on Windows & Mac.
- **Theming**: Refine UI/UX, including fonts (Rokkitt), element sizes, and color scheme.

### Review Tab
- **Performance**:
    -   Eliminate UI flashing/thrashing on content load. Display old content until new content is ready.
    -   Avoid re-rendering spectrograms when only an annotation is changed.
- **Bugs**:
    -   Fix colormap issues (all appearing grayscale).
    -   Fix settings resets (dB range, defaults) causing rendering failures.
- **Features**:
    -   Implement a range-slider for dB range.
    -   Improve multi-class annotation workflow.

### Inference Tab
- **Refactor Workflow**: Change from a single-run process to a task-based system.
    -   Users create and name "inference tasks".
    -   A task queue manages running, queued, and completed jobs.
    -   UI is not blocked while a task is running.
- **Features**:
    -   Allow class subsetting via text file or eBird filters.
    -   Implement sparse data storage for scores to save space.

### Explore Tab
- **Bugs**:
    -   Fix broken page where selected species do not appear.
    -   Fix issue where clicking a histogram bar doesn't update the spectrogram/audio.
- **Features**:
    -   Load example spectrograms automatically for each class.
    -   Move display settings into a collapsible menu on the tab itself.
    -   Show detection counts in the dataset overview and on species panels.
    -   Persist tab state when switching away and back.

## 6. Configuration

Application settings (e.g., inference parameters, training hyperparameters, spectrogram settings) are managed via JSON files. The UI provides controls to modify these settings, which are then passed to the backend scripts. The `SettingsTab` allows for saving and loading these configurations.

---
*This document is maintained by Gemini Code Assist and is based on an analysis of the repository's files.*