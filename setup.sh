#!/bin/bash

echo "Setting up Bioacoustics Training GUI..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed. Please install Python 3.8+"
    exit 1
fi

echo "Node.js version: $(node --version)"
echo "Python version: $(python3 --version)"

# Setup frontend
echo "Setting up frontend..."
cd frontend

# Install frontend dependencies
echo "Installing frontend dependencies..."
npm install --legacy-peer-deps

if [ $? -ne 0 ]; then
    echo "Error: Failed to install frontend dependencies"
    exit 1
fi

# Go back to root
cd ..

# Setup backend
echo "Setting up backend..."
cd backend

# Create virtual environment
echo "Creating Python virtual environment..."
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install backend dependencies
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

if [ $? -ne 0 ]; then
    echo "Warning: Some Python dependencies may have failed to install"
    echo "You may need to install bioacoustics-model-zoo manually:"
    echo "pip install git+https://github.com/kitzeslab/bioacoustics-model-zoo.git"
fi

# Go back to root
cd ..

echo "Setup complete!"
echo ""
echo "To start the application in development mode:"
echo "1. cd frontend"
echo "2. npm run dev"
echo ""
echo "The application will open in a new desktop window."