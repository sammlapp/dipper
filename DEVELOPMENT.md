# Development Guide

How to set up, run, test, build, and release Dipper from source. For installing and using the app, see [README.md](README.md).

Other developer references:

| Document | Contents |
|----------|----------|
| [CLAUDE.md](CLAUDE.md) | Condensed architecture, commands, and patterns (also used by AI coding assistants) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture and API documentation |
| [DESIGN.md](DESIGN.md) | UI design conventions |
| [RELEASE.md](RELEASE.md) | Release process and versioning |
| [frontend/BUILD_INSTRUCTIONS.md](frontend/BUILD_INSTRUCTIONS.md) | Build commands and build troubleshooting |
| [.github/workflows/README.md](.github/workflows/README.md) | CI/CD workflows |
| [QUICKSTART_SERVER.md](QUICKSTART_SERVER.md) | Server mode setup |

## How the pieces fit together

```
React UI (Tauri window or browser)
   │  HTTP (localhost:8000)
   ▼
Backend: backend/app.py, an aiohttp server, shipped as a PyInstaller executable
   │  spawns subprocesses
   ▼
ML scripts in backend/scripts/ (inference, training, clip extraction)
   running in a separate, uv-managed Python environment ("the ML environment")
```

There are **two different Python environments**; do not confuse them:

| | Backend | ML environment |
|---|---|---|
| Runs | `backend/app.py` (HTTP API, light data processing) | Heavy tasks in `backend/scripts/` (PyTorch, TensorFlow, OpenSoundscape) |
| In releases | PyInstaller executable bundled with the app | Installed by the user on first use, from a bundled lockfile |
| Defined by | `backend/pyproject.toml` + `backend/uv.lock` (environment: `backend/.venv`) | `backend/ml_env/pyproject.toml` + `backend/ml_env/uv.lock` (installed into the user's cache directory) |

Jobs communicate progress by writing a `.status` JSON file in the job folder; the backend reads it and the frontend polls every 2 seconds. See [CLAUDE.md](CLAUDE.md) for the job folder layout and status format.

Repository layout:

```
dipper/
├── frontend/              Tauri + React app
│   ├── src/components/    React components (one per tab, plus shared UI)
│   ├── src/utils/         TaskManager.js and other utilities
│   ├── src-tauri/         Tauri (Rust) shell; src-tauri/bin holds the backend sidecar
│   └── python-dist/       PyInstaller output
├── backend/
│   ├── app.py             HTTP server and environment management
│   ├── scripts/           ML task scripts (run inside the ML environment)
│   ├── ml_env/            ML environment definition (pyproject.toml, uv.lock)
│   ├── data/class_names/  Classifier label tables (must be git-tracked)
│   ├── tests/             Environment install tests
│   ├── http_server.spec   PyInstaller spec
│   ├── pyproject.toml     Backend dependencies (uv); uv.lock pins them
│   └── .venv/             Backend environment created by uv (git-ignored)
├── scripts/               Server-mode launchers, version bump
├── docs/                  GitHub Pages download site
└── .github/workflows/     CI/CD
```

## Prerequisites

All platforms: Git, Node.js 18+, Rust (with Cargo), and [uv](https://docs.astral.sh/uv/getting-started/installation/). uv installs the backend's Python (3.13) and packages itself, so no particular Python needs to be installed.

- **macOS:** `xcode-select --install`, then install Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Windows:** Visual Studio Build Tools with the "Desktop development with C++" workload, then Rust via [rustup-init.exe](https://www.rust-lang.org/tools/install). Restart the terminal afterwards.
- **Linux:**
  ```bash
  sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```
  then install Rust as on macOS.

## Setting up

```bash
git clone <repository-url>
cd dipper

# 1. Backend environment: creates backend/.venv from the lockfile (downloads Python 3.13 if needed)
cd backend
uv sync

# 2. Frontend dependencies
cd ../frontend
npm install
cargo --version         # verify Rust is available

# 3. Placeholder backend sidecar, so Tauri dev mode can start.
#    The file name must end with your platform's target triple:
#      macOS ARM:   dipper-backend-aarch64-apple-darwin
#      Linux x64:   dipper-backend-x86_64-unknown-linux-gnu
#      Windows x64: dipper-backend-x86_64-pc-windows-msvc.exe
mkdir -p src-tauri/bin
touch src-tauri/bin/dipper-backend-aarch64-apple-darwin
chmod +x src-tauri/bin/dipper-backend-aarch64-apple-darwin

# 4. Git hooks: pre-commit runs `cargo fmt --check` and `cargo clippy -D warnings`
#    (the same checks as CI) when a commit touches frontend/src-tauri
cd ..
./scripts/install-git-hooks.sh
```

For format-on-save of Rust files in VS Code, install the rust-analyzer extension and set
`"[rust]": { "editor.defaultFormatter": "rust-lang.rust-analyzer", "editor.formatOnSave": true }`.

## Running in development

### Desktop app, backend and frontend in separate terminals (recommended)

```bash
# Terminal 1: backend. Wait for it to report that it is ready.
cd backend
uv run python app.py --port 8000

# Terminal 2: frontend (React hot reload + Tauri window)
cd frontend
npm run tauri:dev
```

Backend changes need a restart of the backend only; no PyInstaller rebuild is needed in dev mode. Check that it is up with `curl http://localhost:8000/health`.

### Other modes (run from `frontend/`)

| Command | What it does |
|---------|--------------|
| `npm run tauri:dev:full` | Starts the backend (`uv run --project ../backend python ../backend/app.py`), waits for `/health`, then launches Tauri |
| `npm run tauri:dev` | Frontend only; HTTP calls fail without a backend |
| `npm start` | React dev server in a browser, no Tauri |

Server mode (React in a browser, backend on a remote machine) has its own launchers: `./scripts/launch-server-dev.sh [config_file]` runs from source with hot reload, and `./scripts/launch-server.sh [config_file]` uses the built PyInstaller backend. Do not use `npm start` for server mode work. See [QUICKSTART_SERVER.md](QUICKSTART_SERVER.md).

## The ML environment

The ML environment is created on first use by the bundled `uv` from `backend/ml_env/uv.lock`. The lockfile pins every package, so nothing is resolved on user machines, and uv downloads its own Python, so nothing needs to be installed on the system.

In development, install it from the app's **Settings** tab (or `POST /env/install`). From a source checkout, the backend finds `uv` through the `uv` Python package, which is a dependency in `backend/pyproject.toml`, so `uv sync` in `backend/` provides it.

How it works (`backend/app.py`):

- `install_environment()` runs `uv sync --frozen --system-certs --extra cpu|cuda` into the cache directory and records its state in sibling files (`ml_env.install_status`, `ml_env.torch_variant`, `ml_env.lock_hash`). `--system-certs` makes uv trust the operating system's certificate store, so networks that intercept HTTPS with a corporate or university certificate work.
- **Stale environments:** the hash of the bundled `uv.lock` is stored when an install completes. If a newer Dipper ships a different lockfile, `check_environment()` reports `outdated` (the old environment still runs, but tasks are refused until it is updated) and Settings offers **Update**. The update re-runs `uv sync`, which only changes the packages that differ, and keeps the installed torch build.
- `detect_torch_variant()` chooses the torch build: `cuda` on Windows/Linux when `nvidia-smi` reports a driver at or above the minimum for the bundled CUDA version (from `[tool.dipper.cuda]` in `ml_env/pyproject.toml`), otherwise `cpu`. A driver version that can't be parsed counts as unusable (reported, not a crash). macOS always uses `cpu` (the standard PyTorch build, which includes Apple MPS). Users can override this in Settings.
- `get_gpu_status()` (`GET /env/gpu`) reports what GPU was found and whether the installed torch can use it. After installation it asks the environment's torch itself, including whether each GPU's architecture (`sm_XX`) is in `torch.cuda.get_arch_list()`, which catches GPUs that are too new or too old for the bundled build.
- `plan_install()` (`GET /env/plan`) returns the torch build, expected disk size (`ENV_SIZE_GB`) and free space. Settings shows it before installing, and `POST /env/install` refuses to start without enough free disk.
- **Network problems:** `explain_install_error()` turns common uv failures (DNS, TLS, HTTP 403/404, timeouts, disk full, permissions) into plain-language messages that list the hosts the installer needs. For locked-down networks, Settings has an "advanced network settings" box that passes proxy, certificate and mirror variables (`INSTALLER_ENV_ALLOWED`) to the installer. All other `UV_*` variables are removed from uv's environment.
- Subprocesses that run the environment's Python use `env_python_subprocess_env()`, which removes `PYTHONHOME`, `PYTHONPATH` and similar variables. Some packaged launchers (for example the Linux AppImage) set these, and they break a different Python installation.

### Updating the ML environment

**Changing or adding a package.** Edit the dependencies in `backend/ml_env/pyproject.toml`, then:

```bash
cd backend/ml_env
uv lock                      # re-resolves for all platforms; commit pyproject.toml and uv.lock
```

CI (`test-uv-ml-env.yml`) installs the lock on every platform and checks the imports. Users on an older install see "Update required" the next time they open a newer Dipper, because the lockfile hash changed.

**Bumping PyTorch or the CUDA version.** Three things must change together; they are next to each other in `pyproject.toml` under a comment saying so:

1. **The torch pins** in `constraint-dependencies`: `torch`, `torchvision` and `torchaudio` (matching releases; torchaudio's metadata does not pin torch). The version must exist on **both** the CPU index and the CUDA index, for every supported platform (Windows x64 and Linux x86_64 wheels for the project's Python). PyTorch's CUDA indexes stop receiving new torch versions for older CUDA releases, so the newest torch may require a newer CUDA index. Check what each index offers:
   ```bash
   for index in cpu cu128; do   # the CPU index and your CUDA index
     echo "== $index"
     curl -s https://download.pytorch.org/whl/$index/torch/ \
       | grep -o 'torch-[0-9.]*\(+\|%2B\)[a-z0-9]*-cp313-cp313-\(win_amd64\|manylinux[^"<>]*x86_64\)\.whl' | sort -uV | tail -6
   done
   ```
2. **The CUDA index name** (`pytorch-cuXXX`), in both `[tool.uv.sources]` (three packages) and `[[tool.uv.index]]`.
3. **`[tool.dipper.cuda]`**: the CUDA `version` and the `min_driver` per OS. Take the minimums from the "CUDA Toolkit and Corresponding Driver Versions" table in the [CUDA Toolkit release notes](https://docs.nvidia.com/cuda/cuda-toolkit-release-notes/) (the GA row for your CUDA version). `app.py` reads this table, so there is no copy of it in the code.

Then:

```bash
cd backend/ml_env && uv lock
```

and finish with:

- Re-measure the installed sizes from the `Environment size` step of `test-uv-ml-env.yml` and update `ENV_SIZE_GB` in `app.py` (shown to users, and used for the free-disk check).
- Check that the new build supports the GPUs you care about (the Settings GPU row, or `torch.cuda.get_arch_list()`). Newer CUDA builds add new GPU generations; PyTorch also drops very old architectures over time.
- Test on a real NVIDIA machine on Windows and Linux. CI has no GPU, so it can only prove that the CUDA wheels install and import.
- `test-uv-ml-env.yml` derives the expected CUDA build from `[tool.dipper.cuda]`, so it needs no edit.

**Bumping Python.** Check that the heavy dependencies resolve and import on the new version first (`uv lock` in a scratch copy with the new `requires-python`; TensorFlow is the usual blocker, and a resolution that needs a release candidate means it isn't ready). Then change together: `requires-python` in `ml_env/pyproject.toml` **and** `backend/pyproject.toml`, `ML_PYTHON_VERSION` in `app.py`, and the docs, and re-run `uv lock` in both directories. The workflows need no edit: they use uv, which installs the version the project asks for.

**Upstream drift.** `check-ml-env-lock.yml` runs weekly (and on changes to `backend/ml_env`). It checks that `uv.lock` still matches `pyproject.toml` and that every pinned file for the supported platforms can still be downloaded, so a yanked or removed wheel is reported before users hit it. If it fails, re-lock and test, or pin around the problem.

### Things to keep in mind

- **Always pass an extra** (`--extra cpu` or `--extra cuda`) on Linux/Windows. A plain `uv sync` there gives the PyPI default torch, which is a CUDA 13 build on Linux and CPU-only on Windows.
- **Import order matters for TensorFlow.** TensorFlow bundles its own LLVM and aborts on Linux with `LLVM ERROR: ... registered more than once` if it is imported before opensoundscape (numba/llvmlite). Import opensoundscape and `bioacoustics_model_zoo` first, as the scripts do.
- **Python version:** `requires-python` in `ml_env/pyproject.toml` and `ML_PYTHON_VERSION` in `app.py` must agree, and should match the backend's `requires-python` in `backend/pyproject.toml` (see [Python version](#python-version)).

### Where things live

| | macOS | Linux | Windows |
|---|---|---|---|
| Cache (environment, uv cache) | `~/Library/Caches/Dipper` | `~/.cache/Dipper` | `%LOCALAPPDATA%\Dipper\Dipper\Cache` |
| Backend log (`dipper-backend.log`) | `~/Library/Logs/Dipper` | `~/.local/state/Dipper/log` | `%LOCALAPPDATA%\Dipper\Dipper\Logs` |

The environment is `envs/ml_env` in the cache directory; uv's package cache and managed Python are in `uv-cache/` and `python/` beside it. uv's output appears in the backend log as `[uv]` lines. To start over, use **Remove** in Settings, or delete the `envs/ml_env*` entries.

## Common tasks

### Change the backend's dependencies

Edit `backend/pyproject.toml` (runtime packages under `dependencies`, developer tools under the `dev` group, build tools under the `build` group), then:

```bash
cd backend
uv lock                       # commit pyproject.toml and uv.lock
```

The lockfile is what gets built into releases, so every release uses exactly the versions you tested. This is separate from the ML environment (`backend/ml_env`), whose dependencies are locked independently.

### Add or change a backend endpoint

1. Add a handler method on `DipperServer` in `backend/app.py`.
2. Register it in `setup_routes()`, for example `self.app.router.add_post("/path", self.handler)`. CORS is applied to all registered routes.
3. In development just restart the backend. For built apps, rebuild the PyInstaller executable (below).

### Change an ML script

Edit the script in `backend/scripts/`. Scripts run in the ML environment, so changes apply immediately in development. Built apps bundle the scripts, so they need a PyInstaller rebuild.

### Add a tab or component

Create the component in `frontend/src/components/`, import it in `App.js`, and add it to the tab list. Follow the UI conventions in [DESIGN.md](DESIGN.md).

## Practices

- **No hard-coded fallbacks.** Do not silently substitute a default when something is missing or fails. Fallbacks make bugs harder to find, debug, and refactor. Fail with a clear error instead, and let a real, detected condition (for example "no NVIDIA GPU found, so use the CPU build") be the only reason to choose a different path.
- **Keep documentation in step with changes.** Update [README.md](README.md) (user-facing) and this file (developer-facing) when you change features, architecture, setup, or build requirements.
- **Frontend talks to the backend only over HTTP.** There are no Tauri commands for application logic.
- **Heavy work runs in subprocesses.** Each job gets its own process and a job folder with `config.json`, `logs.txt`, and a `.status` file.
- **`num_workers` defaults to 0** for DataLoaders. Worker subprocesses are fragile on Windows.
- **Class-name tables are source files.** `backend/data/class_names/*.csv` must stay git-tracked (the `*.csv` ignore pattern must not apply there); classifier label lookups depend on them.
- **Audio decoding** uses `soundfile`, which reads mp3 and ogg natively, so no ffmpeg conversion is needed.
- **Review pull requests against CI.** Do not merge with failing platform jobs.

### Python version

The PyInstaller backend and the ML environment should use the **same Python minor version** (currently 3.13). A mismatch has caused DLL conflicts on Windows (`python3xx.dll conflicts`) when multiprocessing spawns DataLoader workers. The version is set in three places that must agree: `requires-python` in `backend/pyproject.toml` and in `backend/ml_env/pyproject.toml`, and `ML_PYTHON_VERSION` in `backend/app.py`. CI uses uv, which installs whichever version the project asks for, so the workflows do not pin one.

## Testing

There is no single test command. The checks are:

| Check | How | Notes |
|-------|-----|-------|
| Backend health | `curl http://localhost:8000/health` | Quick sanity check |
| ML environment install | `cd backend && TORCH_VARIANT=cpu uv run python -m unittest tests.test_env_install -v` | Installs the full environment (several GB) into a temporary directory, with a bogus `PYTHONHOME` set. `TORCH_VARIANT` is `cpu` or `cuda`; on a machine without a GPU, `cuda` checks the wheels install and import, not that CUDA works |
| Built backend | `uv run --project backend python backend/tests/test_built_backend.py <path-to-dipper-backend> <cpu\|cuda>` | Launches a built executable, installs the environment through its HTTP API, and checks `/env/check`. **Installs into your real Dipper cache directory**, replacing an existing environment, so prefer running it in CI |
| UI | Run the app and exercise it | Frontend unit tests (`npm test`) exist only as `react-scripts` defaults |

CI ([.github/workflows/README.md](.github/workflows/README.md) has details):

- `ci.yml`: checks on pull requests.
- `test-uv-ml-env.yml`: locks and installs `backend/ml_env` on each platform and checks imports (run on pushes that touch `backend/ml_env`).
- `test-env-install.yml`: runs the install test above on every platform and torch variant (manual dispatch).
- `build-full.yml`: builds release artifacts. Its `test-built-backend` job installs the environment through each freshly built backend, and a failure blocks the release.

CI runners have no GPU, so GPU behavior needs a manual test on a machine with an NVIDIA card (including Windows).

## Building

All commands run from `frontend/`.

```bash
npm run tauri:build:all      # React app + PyInstaller backend + Tauri installer
```

Output is in `frontend/src-tauri/target/release/bundle/`. See [frontend/BUILD_INSTRUCTIONS.md](frontend/BUILD_INSTRUCTIONS.md) for step-by-step builds and troubleshooting.

To rebuild only the backend executable:

```bash
cd backend
uv run --isolated --no-project python build_pyinstaller.py     # installs the locked build environment, builds, outputs to frontend/python-dist/ and src-tauri/bin/
```

The PyInstaller build bundles the `uv` executable and `backend/ml_env/{pyproject.toml,uv.lock}` (see `backend/http_server.spec`). The ML environment itself is not part of the installer. Because it is not bundled, testing a built app requires installing the environment from Settings on first launch.

Full builds can be run in CI without tagging a release: Actions → "Build Full App" → Run workflow, on any branch. Artifacts (`.dmg`, `.exe`, `.AppImage`, `.deb`, `.rpm`) are attached to the run. Releases are only created for version tags. Only the app installers are attached to releases; the `dipper-backend-*` artifacts are build inputs.

### Linux packages

The Linux build runs on Ubuntu 22.04 (the oldest supported release: glibc is only forward compatible, so building on a newer Ubuntu would break older ones) and produces three packages:

- **`.deb` / `.rpm`** use the distribution's own WebKitGTK, GTK, GLib and graphics stack, declared as package dependencies. GStreamer `plugins-base`/`plugins-good` are added in `bundle.linux.deb/rpm.depends` in `tauri.conf.json`, because WebKitGTK plays the app's WAV audio through GStreamer. These are the recommended Linux downloads.
- **AppImage** bundles WebKitGTK, GTK, GLib, libepoxy and (before the fix below) libwayland from 22.04, but takes glibc and the graphics drivers (libEGL/Mesa) from the host. linuxdeploy's GTK hook also forces `GDK_BACKEND=x11`, so on Wayland desktops it always runs through XWayland. It needs FUSE (`libfuse2t64`, not installed by default on Ubuntu 24.04+).

**AppImage blank window on Ubuntu 26.04 (fixed in the build).** The AppImage built for v0.3.0rc1 opened a blank window on Ubuntu 26.04, logging `Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...` (the backend started normally). The same AppImage rendered on 22.04 and 24.04. Reproduced in CI by launching the extracted AppImage under Xvfb on `ubuntu-22.04`, `ubuntu-24.04` and `ubuntu-26.04` runners and counting unique colours in a screenshot (about 1,400 when the UI renders, 2 when blank). Results:

| Variant | 22.04 / 24.04 | 26.04 |
|---|---|---|
| As built | renders | blank, EGL error |
| `WEBKIT_DISABLE_DMABUF_RENDERER=1` or `WEBKIT_DISABLE_COMPOSITING_MODE=1` | renders | blank, EGL error |
| Bundled `libepoxy` removed | renders | blank, EGL error |
| Bundled `libwayland-*` removed | renders | **renders** |

Cause: the bundled libwayland 1.20 (from 22.04) is loaded by the host's Mesa 26 libEGL, which needs a newer libwayland even when the app runs on X11. libwayland is backward compatible, so the host's copy works with the bundled GTK/WebKit. `scripts/strip-appimage-libs.sh` runs after `tauri build` in `build-full.yml` and `build-linux.yml`: it extracts the AppImage, deletes the bundled `libwayland-*`, and repacks it with a pinned, checksummed appimagetool. It fails the build if the libraries are no longer bundled, so a change in Tauri's bundling gets noticed.

The unrelated `libgvfscommon.so: undefined symbol: g_task_set_static_name` / `Failed to load module` warnings on newer distributions are harmless: the bundled GLib 2.72 cannot load the host's GIO modules (gvfs, dconf), which are built for a newer GLib.

If a future distribution shows a similar AppImage-only failure, compare the host's versions of the libraries the AppImage bundles (`./Dipper_*.AppImage --appimage-extract`, then look in `squashfs-root/usr/lib`), try removing candidates from an extracted copy and launching `squashfs-root/AppRun`, and add the culprit to `STRIP_GLOBS` only after checking that the result still renders on 22.04.

## Versions and releases

Version numbers live in three files, which `npm run version-bump` keeps in sync:

```bash
cd frontend
npm run version-bump 0.3.0      # also accepts pre-release suffixes, e.g. 1.0.0-beta
```

Then update `Cargo.lock` (`cd frontend/src-tauri && cargo check`), commit, and tag `vX.Y.Z`. The tag triggers `build-full.yml`, which builds all platforms and creates a draft GitHub release. See [RELEASE.md](RELEASE.md) for the full procedure and how the download page is updated.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `npm run tauri:dev` fails with "cargo metadata" or "program not found" | Rust/Cargo is not installed or not on `PATH`. On Windows, install the Visual Studio Build Tools and restart the terminal |
| Tauri window is blank | The backend is not running on port 8000. Use `npm run tauri:dev:full`, or start the backend first |
| Backend does not respond | `curl http://localhost:8000/health`; check the backend log |
| "Install" in Settings returns to "Not installed" | Read the error shown in Settings and the `[uv]` lines in the backend log. In development, the most common cause is `uv` missing from the backend environment (run `uv sync` in `backend/`) |
| ML tasks fail with "ML environment is not installed" or "out of date" | Install or update the environment from the Settings tab |
| Install fails with a TLS, 403 or DNS message | The network blocks or intercepts the downloads. The error lists the hosts needed; use Settings > ML Environment > advanced network settings for a proxy or mirror |
| Status messages do not show in the UI | Check that the `.status` file exists in the job folder |
| Backend changes not reflected in a built app | Rebuild the PyInstaller executable: `cd backend && uv run --isolated --no-project python build_pyinstaller.py` |
| `npm start` tries to build the Tauri app in server mode | Use `./scripts/launch-server-dev.sh` instead |
| Class-name tables missing in a built app | Ensure `backend/data/class_names/*.csv` is git-tracked |

## Contributing

1. Fork the repository and create a feature branch.
2. Make your changes, following the practices above, and update the documentation.
3. Check that the relevant tests and CI jobs pass.
4. Open a pull request against `main`.
