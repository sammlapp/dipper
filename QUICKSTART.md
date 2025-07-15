# Quick Start Guide

## Simple Test (Recommended for first run)

1. **Navigate to the frontend directory:**
   ```bash
   cd frontend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Test React app in browser:**
   ```bash
   npm start
   ```
   This will open http://localhost:3000 in your browser.

4. **Test Electron app:**
   ```bash
   # In a new terminal, build the React app first
   npm run build
   
   # Then run Electron
   npx electron .
   ```

## Full Setup with Material-UI (After basic test works)

1. **Switch to the complex app version:**
   ```bash
   # Backup the simple version
   mv src/App.js src/App-simple.js
   mv src/electron/main.js src/electron/main-simple.js
   
   # Use the complex versions
   mv src/App-complex.js src/App.js  
   mv src/electron/main-complex.js src/electron/main.js
   ```

2. **Install all dependencies:**
   ```bash
   npm install
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

## Backend Setup (Python)

1. **Navigate to backend directory:**
   ```bash
   cd ../backend
   ```

2. **Create virtual environment:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

## Troubleshooting

### If npm install fails:
- Try: `npm install --legacy-peer-deps`
- Or: `npm install --force`

### If Electron doesn't start:
- Make sure you built the React app first: `npm run build`
- Check that main.js path is correct in package.json

### If Python dependencies fail:
- Install bioacoustics libraries manually:
  ```bash
  pip install opensoundscape
  pip install git+https://github.com/kitzeslab/bioacoustics-model-zoo.git
  ```

## Current File Structure

```
frontend/src/
├── App.js              # Simple React app (current)
├── App-simple.js       # Same as App.js (backup)
├── App-complex.js      # Full Material-UI app
├── App.css             # Styles for simple app
├── index.js            # React entry point
├── components/         # Material-UI components (for complex app)
└── electron/
    ├── main.js         # Simple Electron main (current)
    ├── main-simple.js  # Same as main.js (backup)
    └── main-complex.js # Full IPC Electron main
```

## Next Steps

1. **Test the simple app first** - make sure React and Electron work
2. **Switch to complex app** - get the full Material-UI interface
3. **Set up Python backend** - for actual ML processing
4. **Test file selection and subprocess communication**

The simple app gives you the basic structure and navigation. The complex app adds:
- Material-UI components
- File selection dialogs
- Python subprocess communication
- Real-time progress monitoring
- Configuration management