#!/bin/bash
#
# Dipper Server Mode - Development Launcher
#
# Runs backend from SOURCE (not PyInstaller) for hot reload
# Frontend runs with npm start for hot reload
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

# Default config file (allow relative path, then normalize to absolute)
CONFIG_FILE="${1:-$PROJECT_ROOT/server_config.yml}"

# PID files for cleanup
PYTHON_PID=""
FRONTEND_PID=""

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Shutting down development servers...${NC}"

    if [ -n "$PYTHON_PID" ]; then
        echo "  Stopping Python backend (PID: $PYTHON_PID)"
        kill $PYTHON_PID 2>/dev/null || true
    fi

    if [ -n "$FRONTEND_PID" ]; then
        echo "  Stopping frontend dev server (PID: $FRONTEND_PID)"
        kill $FRONTEND_PID 2>/dev/null || true
    fi

    echo -e "${GREEN}✓ Development servers stopped${NC}"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM EXIT

# Print banner
echo -e "${BLUE}"
echo "╔═══════════════════════════════════════╗"
echo "║   Dipper Dev Mode (Hot Reload)        ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"

# Check if config file exists (from current working directory)
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}✗ Config file not found: $CONFIG_FILE${NC}"
    exit 1
fi

# Normalize CONFIG_FILE to an absolute path so Python backend can always read it
CONFIG_FILE="$(cd "$(dirname "$CONFIG_FILE")" && pwd)/$(basename "$CONFIG_FILE")"

echo -e "${GREEN}✓ Config file: $CONFIG_FILE${NC}"

# Parse config file for ports (for display and frontend only)
PYTHON_PORT=$(awk 'section=="server" && $1=="port:" {print $2; exit} /^server:/ {section="server"; next} /^[^[:space:]]/ && $1!="server:" {section=""}' "$CONFIG_FILE")
STATIC_PORT=$(awk 'section=="server" && $1=="static_port:" {print $2; exit} /^server:/ {section="server"; next} /^[^[:space:]]/ && $1!="server:" {section=""}' "$CONFIG_FILE")
HOST=$(awk 'section=="server" && $1=="host:" {print $2; exit} /^server:/ {section="server"; next} /^[^[:space:]]/ && $1!="server:" {section=""}' "$CONFIG_FILE")

# Set defaults
PYTHON_PORT=${PYTHON_PORT:-8000}
STATIC_PORT=${STATIC_PORT:-3000}
HOST=${HOST:-0.0.0.0}

echo -e "${YELLOW}🔥 HOT RELOAD ENABLED${NC}"
echo -e "${GREEN}✓ Python backend (source): http://$HOST:$PYTHON_PORT${NC}"
echo -e "${GREEN}✓ Frontend dev server: http://localhost:$STATIC_PORT${NC}"
echo ""

# Note: Backend will read host and port from config file directly, but we also
# pass them explicitly via CLI args so the port/host are honored even if
# config loading fails in the backend.

# Check if Python backend exists
if [ ! -f "$PROJECT_ROOT/backend/lightweight_server.py" ]; then
    echo -e "${RED}✗ Python backend not found${NC}"
    exit 1
fi

# Check for venv created by install-server.sh
VENV_PATH="$PROJECT_ROOT/backend/venv"
if [ -d "$VENV_PATH" ] && [ -f "$VENV_PATH/bin/python" ]; then
    PYTHON_CMD="$VENV_PATH/bin/python"
    echo -e "${GREEN}✓ Using venv: $VENV_PATH${NC}"
else
    # Fall back to system Python
    PYTHON_CMD=$(command -v python3 || command -v python)
    echo -e "${YELLOW}⚠ No venv found at $VENV_PATH, using system Python${NC}"
    echo -e "${YELLOW}  Run ./scripts/install-server.sh to create venv with dependencies${NC}"
fi

echo -e "${BLUE}Starting development servers...${NC}"
echo ""

# Start Python backend from SOURCE
echo -e "${YELLOW}[1/2] Starting Python backend from source...${NC}"
cd "$PROJECT_ROOT/backend"
$PYTHON_CMD lightweight_server.py --config "$CONFIG_FILE" --host "$HOST" --port "$PYTHON_PORT" > "$PROJECT_ROOT/python-backend-dev.log" 2>&1 &
PYTHON_PID=$!
sleep 2

if ! ps -p $PYTHON_PID > /dev/null; then
    echo -e "${RED}✗ Python backend failed to start${NC}"
    tail -20 "$PROJECT_ROOT/python-backend-dev.log"
    exit 1
fi

echo -e "${GREEN}  ✓ Python backend started (PID: $PYTHON_PID)${NC}"

# Start frontend dev server
echo -e "${YELLOW}[2/2] Starting frontend dev server...${NC}"
cd "$PROJECT_ROOT/frontend"
# Pass backend port both as a REACT_APP_* env var (for CRA) and via a
# runtime global (DIPPER_BACKEND_PORT) that the frontend can read if
# process.env injection is not working in this environment.
REACT_APP_MODE=server REACT_APP_BACKEND_PORT=$PYTHON_PORT DIPPER_BACKEND_PORT=$PYTHON_PORT PORT=$STATIC_PORT npm start > "$PROJECT_ROOT/frontend-dev.log" 2>&1 &
FRONTEND_PID=$!
sleep 3

if ! ps -p $FRONTEND_PID > /dev/null; then
    echo -e "${RED}✗ Frontend failed to start${NC}"
    tail -20 "$PROJECT_ROOT/frontend-dev.log"
    exit 1
fi

echo -e "${GREEN}  ✓ Frontend started (PID: $FRONTEND_PID)${NC}"
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Dipper DEV MODE is running!         ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""
echo -e "🔥 ${YELLOW}Hot reload enabled!${NC}"
echo -e "Open: ${BLUE}http://localhost:$STATIC_PORT${NC}"
echo ""
echo -e "Logs:"
echo -e "  Backend: python-backend-dev.log"
echo -e "  Frontend: frontend-dev.log"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop${NC}"
echo ""

# Wait for processes
wait
