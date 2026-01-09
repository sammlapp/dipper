#!/bin/bash
#
# Dipper Server Mode Launcher
#
# Starts both the Python backend and React static server with a single command.
# Usage: ./scripts/launch-server.sh [config_file]
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

# Default config file
CONFIG_FILE="${1:-$PROJECT_ROOT/server_config.yml}"

# PID files for cleanup
PYTHON_PID=""
SERVE_PID=""

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Shutting down Dipper server mode...${NC}"

    if [ -n "$PYTHON_PID" ]; then
        echo "  Stopping Python backend (PID: $PYTHON_PID)"
        kill $PYTHON_PID 2>/dev/null || true
    fi

    if [ -n "$SERVE_PID" ]; then
        echo "  Stopping static file server (PID: $SERVE_PID)"
        kill $SERVE_PID 2>/dev/null || true
    fi

    echo -e "${GREEN}✓ Dipper server mode stopped${NC}"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM EXIT

# Print banner
echo -e "${BLUE}"
echo "╔═══════════════════════════════════════╗"
echo "║   Dipper Server Mode Launcher         ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}✗ Config file not found: $CONFIG_FILE${NC}"
    echo ""
    echo "Usage: $0 [config_file]"
    echo ""
    echo "Example config file (server_config.yml):"
    echo "---"
    echo "server:"
    echo "  host: 0.0.0.0"
    echo "  port: 8000"
    echo "  static_port: 3000"
    echo ""
    echo "file_access:"
    echo "  allowed_base_paths:"
    echo "    - /home/username/audio_data"
    echo "    - /data"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ Config file: $CONFIG_FILE${NC}"

# Parse config file for host and ports (simple YAML-style parsing)
# We intentionally avoid full YAML parsing here and just look for
# top-level keys "host:", "port:", and "static_port:" under "server:".
HOST=$(awk 'section=="server" && $1=="host:" {print $2; exit} /^server:/ {section="server"; next} /^[^[:space:]]/ && $1!="server:" {section=""}' "$CONFIG_FILE")
PYTHON_PORT=$(awk 'section=="server" && $1=="port:" {print $2; exit} /^server:/ {section="server"; next} /^[^[:space:]]/ && $1!="server:" {section=""}' "$CONFIG_FILE")
STATIC_PORT=$(awk 'section=="server" && $1=="static_port:" {print $2; exit} /^server:/ {section="server"; next} /^[^[:space:]]/ && $1!="server:" {section=""}' "$CONFIG_FILE")

# Set defaults if not found in config
PYTHON_PORT=${PYTHON_PORT:-8000}
STATIC_PORT=${STATIC_PORT:-3000}
HOST=${HOST:-0.0.0.0}

echo -e "${GREEN}✓ Python backend: http://$HOST:$PYTHON_PORT${NC}"
echo -e "${GREEN}✓ Static server: http://localhost:$STATIC_PORT${NC}"
echo ""

# Check if React build exists
if [ ! -d "$PROJECT_ROOT/frontend/build" ]; then
    echo -e "${YELLOW}! React build not found, building now...${NC}"
    cd "$PROJECT_ROOT/frontend"
    REACT_APP_MODE=server npm run build
    echo -e "${GREEN}✓ React build complete${NC}"
    echo ""
fi

# Check if pyinstaller executable backend exists
if [ ! -f "$PROJECT_ROOT/frontend/python-dist/lightweight_server" ]; then
    echo -e "${RED}✗ Python backend not found at:$PROJECT_ROOT/frontend/python-dist/lightweight_server${NC}"
    exit 1
fi

# Check if npx is available
if ! command -v npx &> /dev/null; then
    echo -e "${RED}✗ npx not found. Please install Node.js${NC}"
    exit 1
fi

# Check if Python is available
if ! command -v python &> /dev/null && ! command -v python3 &> /dev/null; then
    echo -e "${RED}✗ Python not found. Please install Python 3.8+${NC}"
    exit 1
fi

PYTHON_CMD=$(command -v python3 || command -v python)

echo -e "${BLUE}Starting services...${NC}"
echo ""

# Start Python backend
echo -e "${YELLOW}[1/2] Starting Python backend...${NC}"
# cd "$PROJECT_ROOT/backend"
# $PYTHON_CMD lightweight_server.py --host "$HOST" --port "$PYTHON_PORT" > "$PROJECT_ROOT/python-backend.log" 2>&1 &
# launch pyinstaller executable
cd "$PROJECT_ROOT/frontend/python-dist/"
./lightweight_server --host "$HOST" --port "$PYTHON_PORT" > "$PROJECT_ROOT/python-backend.log" 2>&1 &
PYTHON_PID=$!

# Wait a bit for Python to start
sleep 2

# Check if Python is still running
if ! ps -p $PYTHON_PID > /dev/null; then
    echo -e "${RED}✗ Python backend failed to start${NC}"
    echo "Check logs: $PROJECT_ROOT/python-backend.log"
    cat "$PROJECT_ROOT/python-backend.log"
    exit 1
fi

echo -e "${GREEN}  ✓ Python backend started (PID: $PYTHON_PID)${NC}"

# Start static file server
echo -e "${YELLOW}[2/2] Starting static file server...${NC}"
cd "$PROJECT_ROOT/frontend"
npx serve -s build -p "$STATIC_PORT" -n > "$PROJECT_ROOT/static-server.log" 2>&1 &
SERVE_PID=$!

# Wait a bit for serve to start
sleep 2

# Check if serve is still running
if ! ps -p $SERVE_PID > /dev/null; then
    echo -e "${RED}✗ Static file server failed to start${NC}"
    echo "Check logs: $PROJECT_ROOT/static-server.log"
    cat "$PROJECT_ROOT/static-server.log"
    exit 1
fi

echo -e "${GREEN}  ✓ Static file server started (PID: $SERVE_PID)${NC}"
echo ""

# Success message
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Dipper is running!                  ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""
echo -e "Open in browser: ${BLUE}http://localhost:$STATIC_PORT${NC}"
echo ""
echo -e "Logs:"
echo -e "  Python backend: ${PROJECT_ROOT}/python-backend.log"
echo -e "  Static server:  ${PROJECT_ROOT}/static-server.log"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop${NC}"
echo ""

# Wait for processes
wait
