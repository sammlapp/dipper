#!/bin/bash
#
# Dipper Server Mode Installer
#
# Installs all dependencies needed to run Dipper in server mode
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════╗"
echo "║   Dipper Server Mode Installer        ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# Check OS
OS="$(uname -s)"
echo -e "${GREEN}✓ Detected OS: $OS${NC}"
echo ""

# Check for required commands
echo -e "${BLUE}Checking prerequisites...${NC}"

# Check Python
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo -e "${RED}✗ Python not found${NC}"
    echo "  Please install Python 3.8 or later"
    echo "  Visit: https://www.python.org/downloads/"
    exit 1
fi

PYTHON_CMD=$(command -v python3 || command -v python)
PYTHON_VERSION=$($PYTHON_CMD --version 2>&1 | awk '{print $2}')
echo -e "${GREEN}✓ Python: $PYTHON_VERSION${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found${NC}"
    echo "  Please install Node.js 16 or later"
    echo "  Visit: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node --version)
echo -e "${GREEN}✓ Node.js: $NODE_VERSION${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm not found${NC}"
    echo "  npm should be installed with Node.js"
    exit 1
fi

NPM_VERSION=$(npm --version)
echo -e "${GREEN}✓ npm: $NPM_VERSION${NC}"
echo ""

# Install Python dependencies
echo -e "${BLUE}[1/3] Installing Python dependencies...${NC}"
cd "$PROJECT_ROOT/backend"

if [ ! -f "requirements-backend.txt" ]; then
    echo -e "${RED}✗ requirements-backend.txt not found${NC}"
    exit 1
fi

echo "  Creating Python virtual environment..."
$PYTHON_CMD -m venv venv

echo "  Activating virtual environment..."
source venv/bin/activate

echo "  Installing packages from requirements-backend.txt..."
pip install --upgrade pip
pip install -r requirements-backend.txt

echo -e "${GREEN}  ✓ Python dependencies installed${NC}"
echo ""

# Install Node.js dependencies
echo -e "${BLUE}[2/3] Installing Node.js dependencies...${NC}"
cd "$PROJECT_ROOT/frontend"

if [ ! -f "package.json" ]; then
    echo -e "${RED}✗ package.json not found${NC}"
    exit 1
fi

echo "  Installing npm packages..."
npm install

# Install serve globally for static file serving
echo "  Installing serve (static file server)..."
npm install -g serve

echo -e "${GREEN}  ✓ Node.js dependencies installed${NC}"
echo ""

# Build React app
echo -e "${BLUE}[3/3] Building React app for server mode...${NC}"
cd "$PROJECT_ROOT/frontend"

echo "  Building with REACT_APP_MODE=server..."
REACT_APP_MODE=server npm run build

echo -e "${GREEN}  ✓ React app built${NC}"
echo ""

# Create config file if it doesn't exist
if [ ! -f "$PROJECT_ROOT/server_config.yml" ]; then
    echo -e "${YELLOW}Creating default config file...${NC}"
    cp "$PROJECT_ROOT/server_config.example.yml" "$PROJECT_ROOT/server_config.yml"
    echo -e "${GREEN}  ✓ Created server_config.yml${NC}"
    echo -e "${YELLOW}  ! Please edit server_config.yml to add your audio data directories${NC}"
    echo ""
fi

# Success message
echo -e "${GREEN}"
echo "╔═══════════════════════════════════════╗"
echo "║   Installation complete!              ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo "Next steps:"
echo ""
echo "1. Edit configuration:"
echo -e "   ${BLUE}nano server_config.yml${NC}"
echo ""
echo "2. Launch Dipper server mode:"
echo -e "   ${BLUE}./scripts/launch-server.sh${NC}"
echo ""
echo "3. Open in browser:"
echo -e "   ${BLUE}http://localhost:3000${NC}"
echo ""
echo "For remote access (from your laptop):"
echo -e "   ${BLUE}ssh -L 3000:localhost:3000 -L 8000:localhost:8000 user@remote-server${NC}"
echo ""
