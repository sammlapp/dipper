# Dipper Server Mode - Quick Start Guide

Run Dipper on a remote server and access it from your laptop's browser.

## Installation (5 minutes)

### On the remote server:

```bash
# 1. Clone repository
git clone https://github.com/sammlapp/dipper.git
cd dipper

# 2. Run installer (installs Python + Node.js dependencies) with admin privelages
# enter password if prompted
sudo ./scripts/install-server.sh
```

The installer will:
- ✓ Check Python 3.8+ and Node.js 16+ are installed
- ✓ Create Python virtual environment
- ✓ Install Python packages (aiohttp, librosa, etc.)
- ✓ Install Node.js packages
- ✓ Build React app for server mode
- ✓ Create default `server_config.yml`

## Configuration (2 minutes)

### Edit server_config.yml:

```bash
nano server_config.yml
```

**Minimum required changes:**
```yaml
file_access:
  allowed_base_paths:
    - /path/to/your/audio/data     # Change this!
    - /path/to/your/recordings     # Add your directories
```

**Optional tuning:**
```yaml
server:
  host: 0.0.0.0          # Accept remote connections
  port: 8000             # Python backend port
  static_port: 3000      # React app port

jobs:
  max_concurrent: 3      # Adjust based on system capacity
```

## Launch (1 command)

```bash
./scripts/launch-server.sh
```

You'll see:
```
╔═══════════════════════════════════════╗
║   Dipper is running!                  ║
╚═══════════════════════════════════════╝

Open in browser: http://localhost:3000

Press Ctrl+C to stop
```

## Access from Your Laptop

### Option 1: SSH Tunnel (Recommended)
Note: if you run the above commands from VS Code, the program automatically sets up port forwarding and you can skip this step (forwarded ports listed in the Ports panel).


```bash
# On your laptop
ssh -L 3000:localhost:3000 -L 8000:localhost:8000 user@remote-server

# Open browser
open http://localhost:3000
```

### Option 2: Direct Access (if firewall allows)

```bash
# Open browser to server's IP
open http://remote-server-ip:3000
```

## Stopping

Press `Ctrl+C` in the terminal where `launch-server.sh` is running.

Both Python backend and static server will shut down gracefully.

## Troubleshooting

### Port already in use

```bash
# Check what's using the port
lsof -i :3000
lsof -i :8000

# change ports in server_config.yml

# or kill process
kill <PID>

```

### React build missing

```bash
cd frontend
REACT_APP_MODE=server npm run build
```

### Python dependencies missing

```bash
cd backend
source venv/bin/activate
pip install -r requirements-lightweight.txt
```

### Can't access from laptop

1. **Check SSH tunnel is running:**
   ```bash
   # You should see these in ps output
   ps aux | grep ssh
   ```

2. **Check ports are forwarded:**
   ```bash
   # On laptop, these should respond
   curl http://localhost:8000/health
   curl http://localhost:3000
   ```

3. **Check firewall on server:**
   ```bash
   # If using direct access (not SSH tunnel)
   sudo ufw status
   sudo firewall-cmd --list-all
   ```

## Logs

Logs are written to the project root:
- `python-backend.log` - Python backend (API, ML tasks)
- `static-server.log` - Static file server (React app)

```bash
# Watch logs in real-time
tail -f python-backend.log
tail -f static-server.log
```

## Custom Config File

```bash
# Use a different config file
./scripts/launch-server.sh /path/to/my-config.yml
```

## Architecture

```
Your Laptop (Browser)
  │
  ├─ http://localhost:3000 (SSH tunnel → React app)
  └─ http://localhost:8000 (SSH tunnel → API calls)
       │
       │ SSH Tunnel
       │
Remote Server
  ├─ npx serve (port 3000) - Serves React static files
  └─ Python (port 8000) - ML tasks, file operations, API
```

## What You Can Do

Once the app loads in your browser:

✅ Browse server-side files and folders
✅ Run inference on audio files
✅ Train custom models
✅ Create annotation tasks
✅ Review and annotate clips
✅ All data stays on the server (only results shown in browser)

## Getting Help

- Check logs: `python-backend.log` and `static-server.log`
- GitHub issues: [link to repo issues]
- Documentation: `README.md`, `CLAUDE.md`, `SERVER_AND_TAURI.md`
