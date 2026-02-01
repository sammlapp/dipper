# Dipper - Bioacoustics ML Application

A cross-platform desktop application for bioacoustics machine learning with active learning capabilities. Built with Tauri and React for the frontend, and Python for the ML backend.

## Features

- **Species Detection Inference**: Run pre-trained models from the bioacoustics model zoo
- **Model Training**: Train custom models with your own data
- **Clip Extraction**: Create annotation tasks from detection results
- **Data Exploration**: Visualize and explore detection results
- **Review & Annotation**: Annotate audio clips with binary or multi-class labels
- **Active Learning**: Iteratively improve models with human feedback
- **Cross-Platform**: Works on macOS (ARM), Windows, and Linux

## Project Structure

```
dipper/
├── frontend/              # Tauri + React desktop app
│   ├── src/
│   │   ├── components/    # React components (tabs, UI elements)
│   │   └── utils/         # TaskManager, utilities
│   ├── src-tauri/         # Tauri Rust backend
│   ├── python-dist/       # PyInstaller backend executable
│   └── package.json
├── backend/               # Python ML processing
│   ├── lightweight_server.py  # HTTP server (aiohttp)
│   ├── scripts/           # ML task scripts (inference, training, etc.)
│   ├── build_pyinstaller.py   # Build standalone server
│   └── requirements-lightweight.txt
└── .github/workflows/     # CI/CD for releases
```

## Quick Start

### Prerequisites

- **Node.js** (v18+)
- **Python** (3.9+)
- **Rust** (required for Tauri) - see [Developer Setup](#developer-setup)

### Running in Development

```bash
# Install frontend dependencies
cd frontend
npm install

# Run full dev mode (recommended)
npm run tauri:dev:full
```

This starts the Python backend, React dev server with hot reload, and launches the Tauri desktop app.

### Building for Production

```bash
cd frontend
npm run tauri:build:all
```

Output: Platform-specific installers in `frontend/src-tauri/target/release/bundle/`

## Developer Setup

See [CLAUDE.md](CLAUDE.md) for comprehensive developer setup instructions including:
- Platform-specific prerequisites (Windows, macOS, Linux)
- Rust/Cargo installation
- Backend Python environment setup
- Development modes and commands
- Troubleshooting common issues

## Server Mode

Run Dipper on a remote server and access via web browser. Useful for:
- Running ML tasks on a remote GPU server
- Accessing large datasets stored on remote machines
- Single-user remote access

```bash
# Quick start
./scripts/launch-server.sh [config_file]

# Access via SSH tunnel
ssh -L 3000:localhost:3000 -L 8000:localhost:8000 user@remote-server
open http://localhost:3000
```

See [QUICKSTART_SERVER.md](QUICKSTART_SERVER.md) for detailed server mode instructions.

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](CLAUDE.md) | Primary developer reference - architecture, commands, patterns |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Detailed system architecture and API documentation |
| [RELEASE.md](RELEASE.md) | Release process and versioning guide |
| [QUICKSTART_SERVER.md](QUICKSTART_SERVER.md) | Server mode quick start guide |

## Models

The application integrates with the [bioacoustics model zoo](https://github.com/kitzeslab/bioacoustics-model-zoo/) and includes:

- **BirdNET**: Global bird species classification
- **Perch**: Global bird species classification
- **HawkEars**: Canadian bird classification CNN
- **RanaSierraeCNN**: Frog call detection

## Dependencies

**Frontend:**
- React 18, Material-UI 5, Tauri 2.x

**Backend:**
- Python 3.11, aiohttp, PyTorch, OpenSoundscape, librosa, pandas

**Build:**
- Tauri CLI, PyInstaller, conda-pack

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the MIT License.

## Acknowledgments

- [OpenSoundscape](https://github.com/kitzeslab/opensoundscape) for bioacoustics processing
- [Bioacoustics Model Zoo](https://github.com/kitzeslab/bioacoustics-model-zoo/) for pre-trained models
- The bioacoustics research community for datasets and models
