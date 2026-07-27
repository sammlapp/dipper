# Dipper Cloud Deployment

## Overview

Dipper's server mode is designed for self-hosted cloud deployment. Each user or organization launches their own cloud instance (e.g. AWS EC2), runs the Dipper backend on it, and accesses the full app via a browser — no desktop install required. Audio data stays on the user's own instance.

The backend serves both the API and the React frontend static files from a single port, so users only need to open one port in their cloud firewall and access one URL.

## How It Works

1. User launches a cloud VM (EC2 or equivalent), clones Dipper, and runs a setup script
2. The backend starts, auto-selects an available port (or uses a user-configured one), and serves both the API and the built React frontend
3. User opens that port in their cloud provider's firewall (a 2-minute point-and-click step in the AWS console)
4. User accesses `http://<instance-ip>:<port>` from any browser — the app loads and talks to the backend at the same origin, with no extra configuration

No domain name, TLS certificate, or separate static file server is required for a single-user research deployment.

## Implementation Checklist

### Backend: serve frontend static files

- [ ] In `app.py`, add a static file route that serves `frontend/build/` at `/`
- [ ] Serve `index.html` as a fallback for all unmatched routes (so React client-side routing works)
- [ ] Ensure API routes take precedence over the static catch-all
- [ ] Remove the `npx serve` step from `launch-server.sh` — backend is now the only process needed

### Port selection

- [ ] On startup, if no port is specified, scan for the first available port starting from a sensible default (e.g. 8000), and bind to it
- [ ] Print the selected port clearly at startup so the user knows which URL to open
- [ ] Allow the user to specify a port via:
  - CLI flag: `--port 8080`
  - Config file: `server.port: 8080` in `server_config.yml`
  - If both provided, config file takes precedence (already the case)
- [ ] If the requested port is unavailable, exit with a clear error message rather than binding to a random port silently

### Launch script (`launch-server.sh`)

- [ ] Remove the `npx serve` / static server block — only the Python backend needs to start
- [ ] Remove `STATIC_PORT` parsing and references
- [ ] After the backend starts, print the full access URL: `http://<host-ip>:<port>`
- [ ] Optionally: detect and print the instance's public IP automatically (e.g. via `curl -s ifconfig.me`) so the user knows exactly what URL to share

### Setup script (`scripts/install-server.sh`) — already exists

- [x] Creates Python venv and installs `requirements-backend.txt`
- [x] Runs `npm install` and builds the React frontend with `REACT_APP_MODE=server`
- [x] Creates `server_config.yml` from example if not present
- [ ] Once backend serves the frontend, remove the `npm install -g serve` step (no longer needed)
- [ ] Print the port to open in the cloud security group at the end of installation

### Documentation

- [ ] Add a "Cloud Deployment (AWS / EC2)" section to `README.md` covering:
  - Launching an EC2 instance (instance type recommendations for ML workloads)
  - Running the setup and launch scripts
  - Opening the port in the AWS Security Group (2-minute console step)
  - Accessing the app via `http://<public-ip>:<port>`
- [ ] Note that plain HTTP is acceptable for single-user research deployments where the user controls access via the security group (IP allowlisting)
- [ ] Note that for multi-user or sensitive deployments, put nginx + HTTPS in front and restrict the security group to the nginx port only

## Architecture After Changes

```
EC2 instance
└── dipper-backend (single process, one port)
    ├── GET /           → serves frontend/build/index.html
    ├── GET /static/... → serves React JS/CSS assets
    └── POST /inference/run, GET /clip, etc. → API
```

User accesses: `http://<ec2-public-ip>:<port>`

## Authentication

### Single-user mode: no app-level auth needed

AWS (and equivalent cloud providers) let you restrict inbound traffic by IP address in the Security Group firewall rules. Instead of opening the port to `0.0.0.0/0` (the whole internet), you set the source to your own IP:

```
Inbound rule: TCP  port 8000  source: <your-ip>/32
```

With this rule, the server is simply unreachable from any other IP — connection attempts time out before they reach Dipper. No login page, no tokens, no passwords needed. The user accesses `http://<instance-ip>:8000` from their allowed IP and gets straight in.

**Finding your IP:** `curl ifconfig.me` or visit whatismyip.com. If your IP changes (home ISP), you update the Security Group rule — a 30-second edit in the AWS console.

**Limitation:** if you need to access from multiple locations (home + office + laptop on cellular), you add each IP as a separate rule, or use a CIDR range for your institution's network. This covers most single-researcher use cases without any code changes.

### Multi-user mode: auth layer required

If multiple people need access (a team, annotators, collaborators), IP allowlisting doesn't scale. Options in order of implementation complexity:

1. **HTTP basic auth via nginx** — put nginx in front of the backend, configure a `.htpasswd` file. No Dipper code changes. One shared password for the whole team. Simple but credentials travel in base64 (fine over HTTPS, not over plain HTTP).

2. **Token middleware in aiohttp** — add a request middleware to `app.py` that checks a `?token=` query param or `Authorization` header against a list of valid tokens in `server_config.yml`. Users bookmark `http://<ip>:8000/?token=abc123`. No login UI needed.

3. **Full auth service** — OAuth2/OIDC via something like Authelia or Authentik in front of nginx. Overkill for research use.

For a research lab, option 2 is probably the right call: a per-user token in the config, no extra infrastructure, and it's implementable in ~50 lines of Python.

### Current status

No auth is implemented. Single-user deployments work securely today via Security Group IP restriction. Multi-user auth is not yet built.
