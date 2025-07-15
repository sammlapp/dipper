#!/bin/bash

echo "Quick test setup for Bioacoustics Training GUI..."

# Setup frontend with minimal dependencies
echo "Setting up frontend with minimal dependencies..."
cd frontend

# Create a minimal package.json for testing
cat > package-minimal.json << 'EOF'
{
  "name": "bioacoustics-training-gui-test",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-scripts": "5.0.1",
    "electron": "^28.0.0"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "electron": "electron .",
    "electron-dev": "ELECTRON_IS_DEV=1 electron ."
  },
  "main": "src/electron/main.js",
  "browserslist": {
    "production": [
      ">0.2%",
      "not dead",
      "not op_mini all"
    ],
    "development": [
      "last 1 chrome version",
      "last 1 firefox version",
      "last 1 safari version"
    ]
  }
}
EOF

# Install minimal dependencies
echo "Installing minimal dependencies..."
npm install --package-lock-only react react-dom react-scripts electron

echo "Basic setup complete!"
echo ""
echo "To test the basic React app:"
echo "1. cd frontend"
echo "2. npm start"
echo ""
echo "To test with Electron:"
echo "1. cd frontend"  
echo "2. npm run build"
echo "3. npm run electron"