# Bioacoustics Training GUI

A cross-platform desktop application for bioacoustics machine learning with active learning capabilities. Built with Tauri and React for the frontend, and Python for the ML backend.

## Features

- **Species Detection Inference**: Run pre-trained models from the bioacoustics model zoo
- **Model Training**: Train custom models with your own data
- **Data Exploration**: Visualize and explore detection results
- **Active Learning**: Iteratively improve models with human feedback
- **Cross-Platform**: Works on Mac, Windows, and Linux

## Project Structure

```
training_gui/
├── frontend/              # Electron + React desktop app
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── electron/      # Electron main process
│   │   └── App.js         # Main React app
│   ├── public/            # Static assets
│   └── package.json       # Frontend dependencies
├── backend/               # Python ML processing
│   ├── scripts/           # Python scripts for ML operations
│   └── requirements.txt   # Python dependencies
├── configs/               # Configuration files
├── models/                # Model storage
├── environments/          # Bundled Python environments
└── build/                 # Build outputs
```

## Development Setup

### Prerequisites

- Node.js (v16+)
- Python (3.8+)
- Git

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

### Running the Application

#### Local Mode (Default)

Start the desktop application:
```bash
cd frontend
npm run dev
```

The application will open in a new desktop window with full functionality.

#### Server Mode

Run on a remote machine and access via web browser. Perfect for:
- Running ML tasks on a remote GPU server
- Accessing large datasets stored on remote machines
- Working with audio files located on a server
- Single-user remote access (no multi-user support)

**Quick Start:**

1. **Install (one-time setup):**
   ```bash
   git clone <repository-url>
   cd training_gui
   ./scripts/install-server.sh
   ```

2. **Configure:**
   ```bash
   # Edit server_config.yml to add your audio data directories
   nano server_config.yml
   ```

3. **Launch:**
   ```bash
   # Starts both Python backend and React server
   ./scripts/launch-server.sh
   ```

4. **Access from your laptop:**
   ```bash
   # Create SSH tunnel
   ssh -L 3000:localhost:3000 -L 8000:localhost:8000 user@remote-server
   ssh -L 3111:localhost:3000 -L 8111:localhost:8000 sml161@10.226.187.22

   # Open browser
   open http://localhost:3000
   ```

**What's happening:**
- Python backend (port 8000) - ML tasks and API
- Static file server (port 3000) - React app
- Single command manages both processes

**Manual control (advanced):**
```bash
# Terminal 1: Python backend
cd backend
source venv/bin/activate
python lightweight_server.py --host 0.0.0.0 --port 8000

# Terminal 2: Static server
cd frontend
npx serve -s build -p 3000
```

**Note:** Each Dipper instance supports one user at a time. For multiple users, run separate instances on different ports.

## Building for Production

### Frontend
```bash
cd frontend
npm run build
```

### Backend
The Python environment will be bundled with the application during the build process.

## Usage

### Running Inference

1. Open the "Inference" tab
2. Select a model from the bioacoustics model zoo
3. Choose audio files or folders to process
4. Configure inference settings
5. Run the model and view results

### Training Models

1. Open the "Training" tab
2. Prepare your training data in the expected folder structure
3. Configure training parameters
4. Start training and monitor progress
5. Save and use your trained model

### Exploring Data

1. Open the "Explore Data" tab
2. Load inference results (CSV files)
3. Filter detections by score range
4. Visualize species distributions
5. Listen to audio samples

## Configuration

Settings are stored in JSON configuration files that can be saved and loaded. The application supports:

- Inference settings (batch size, overlap, etc.)
- Training parameters (learning rate, epochs, etc.)
- Data augmentation settings
- Model-specific configurations

## Models

The application integrates with the [bioacoustics model zoo](https://github.com/kitzeslab/bioacoustics-model-zoo/) and includes:

- **BirdNET**: Global bird species classification
- **Perch**: Global bird species classification
- **HawkEars**: Canadian bird classification CNN
- **RanaSierraeCNN**: Frog call detection

## Dependencies

### Frontend
- Electron: Desktop app framework
- React: UI framework
- Material-UI: Component library
- Plotly.js: Data visualization

### Backend
- PyTorch: Machine learning framework
- OpenSoundscape: Bioacoustics processing
- Bioacoustics Model Zoo: Pre-trained models
- NumPy, Pandas: Data processing

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Acknowledgments

- [OpenSoundscape](https://github.com/kitzeslab/opensoundscape) for bioacoustics processing
- [Bioacoustics Model Zoo](https://github.com/kitzeslab/bioacoustics-model-zoo/) for pre-trained models
- The bioacoustics research community for datasets and models