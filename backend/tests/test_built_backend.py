"""End-to-end check of a built (PyInstaller) backend executable.

Launches the executable, installs the ML environment through its HTTP API
(/env/install, then polls /env/install/status), and verifies /env/check reports
the environment ready. The backend is started with PYTHONHOME/PYTHONPATH pointing
at a nonexistent directory to mimic packaged launchers (e.g. Linux AppImage), and
without the test runner's Python on PATH.

Usage:  python tests/test_built_backend.py <path-to-dipper-backend>
Installs into the real per-user Dipper cache directory and downloads the full
archive for the current platform (several GB).
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

STARTUP_TIMEOUT_S = 60
INSTALL_TIMEOUT_S = 40 * 60
POLL_INTERVAL_S = 5


def free_port():
    with socket.socket() as s:
        s.bind(("localhost", 0))
        return s.getsockname()[1]


def request(port, method, path, body=None):
    data = json.dumps(body if body is not None else {}).encode() if method == "POST" else None
    req = urllib.request.Request(
        f"http://localhost:{port}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def backend_env(poison_dir):
    env = dict(os.environ)
    env["PYTHONHOME"] = poison_dir
    env["PYTHONPATH"] = poison_dir
    # Remove the test runner's Python so the backend can't fall back to it.
    runner_dir = os.path.dirname(os.path.abspath(sys.executable))
    runner_dirs = {runner_dir, os.path.join(runner_dir, "Scripts")}
    env["PATH"] = os.pathsep.join(
        p for p in env["PATH"].split(os.pathsep) if os.path.abspath(p) not in runner_dirs
    )
    return env


def wait_for(predicate, timeout, description):
    deadline = time.time() + timeout
    while time.time() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(POLL_INTERVAL_S)
    raise TimeoutError(f"Timed out waiting for {description}")


def main(executable):
    port = free_port()
    with tempfile.TemporaryDirectory() as poison_dir:
        proc = subprocess.Popen(
            [executable, "--port", str(port)], env=backend_env(os.path.join(poison_dir, "nonexistent"))
        )
        try:
            def healthy():
                try:
                    return request(port, "GET", "/health")
                except OSError:
                    return None

            wait_for(healthy, STARTUP_TIMEOUT_S, "backend /health")

            started = request(port, "POST", "/env/install")
            assert started["status"] in ("started", "already_ready", "already_running"), started

            def finished():
                state = request(port, "GET", "/env/install/status")
                print(f"install state: {state['stage']} - {state['message']}", flush=True)
                return state if state["stage"] in ("ready", "error") else None

            state = wait_for(finished, INSTALL_TIMEOUT_S, "environment install")
            assert state["stage"] == "ready", f"Install failed: {state}"

            check = request(port, "POST", "/env/check")
            assert check["status"] == "ready", f"/env/check not ready: {check}"
            print(f"OK: environment ready ({check.get('version')})")
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
