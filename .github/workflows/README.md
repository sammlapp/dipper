# GitHub Actions Workflows

This directory contains automated build workflows for Dipper across multiple platforms.

## Workflows

### 1. CI (`ci.yml`)
**Trigger:** Pull requests and pushes to `develop` branch
**Purpose:** Quick validation and testing

**What it does:**
- Runs linting and formatting checks
- Builds React frontend
- Compiles Rust backend
- Tests PyInstaller build script
- Runs on all platforms (Linux, macOS, Windows)

**Use this for:** Validating PRs before merge

---

### 2. Build Review-Only App (`build-review.yml`)
**Trigger:**
- Push to `main` or `develop`
- Tags matching `v*-review` (e.g., `v0.0.6-review`)
- Manual workflow dispatch

**Purpose:** Build lightweight review-only version of the app

**What it builds:**
1. **PyInstaller Backend** (all platforms)
   - macOS Apple Silicon (arm64)
   - Windows (x64)
   - Linux (x64)

2. **Tauri Review App** (all platforms)
   - DMG for macOS
   - NSIS installer for Windows
   - AppImage for Linux

**Artifacts:**
- Review app installers for each platform
- Smaller download size (~100-200MB)
- No ML training capabilities, only annotation review

**Use this for:** Distributing lightweight review tools to annotators

---

### 3. Build Full App (`build-full.yml`)
**Trigger:**
- Push to `main` or `develop`
- Tags matching version patterns:
  - `v0.0.6` (release)
  - `v0.0.6-alpha`, `v0.0.6-beta`, `v0.0.6-rc1` (pre-releases)
  - **Does NOT trigger on** `v*-review` tags
- Manual workflow dispatch

**Purpose:** Build complete app with ML training capabilities

**What it builds:**
1. **PyInstaller Backend** (all platforms)
   - Same as review build

2. **Tauri Full App** (all platforms)
   - DMG for macOS
   - NSIS installer for Windows
   - AppImage for Linux

**Artifacts:**
- Full app installers for each platform (~100-200MB)
- The ML environment is not included: the app installs it on first use from `backend/ml_env/uv.lock` (bundled with the backend, along with the `uv` executable)

**Use this for:** Full production releases with ML capabilities

**Note:** The app installs the ML environment on first use with `uv sync` from the bundled lockfile. Before a release, the `test-built-backend` job installs the environment through each freshly built backend executable (CPU on all platforms, CUDA on Windows/Linux) and fails the release if that does not work.

---

## Platform Support

| Platform | Architecture | Runner | Status |
|----------|-------------|--------|--------|
| macOS    | Intel (x64) | `macos-15-intel` | Supported |
| macOS    | Apple Silicon (arm64) | `macos-latest` | Supported |
| Windows  | x64 | `windows-latest` | Supported |
| Linux    | x64 | `ubuntu-latest` | Supported |

**Note:** Builds are independent per platform. If the PyInstaller build fails on one platform, the other platforms will continue building. Each Tauri build only requires its own platform's artifacts to succeed.

---

## Release Process

### Review-Only Release

1. **Tag the release:**
   ```bash
   git tag v0.0.6-review
   git push origin v0.0.6-review
   ```

2. **Workflow runs automatically:**
   - Builds PyInstaller backend for all platforms
   - Builds review-only Tauri apps
   - Creates draft GitHub release with installers

3. **Edit and publish:**
   - Go to GitHub Releases
   - Edit the draft release
   - Add release notes
   - Publish the release

### Full App Release

1. **Update the ML environment lockfile** (only if ML dependencies changed):
   ```bash
   cd backend/ml_env && uv lock   # then commit pyproject.toml and uv.lock
   ```

2. **Tag the app release:**
   ```bash
   # For stable release:
   git tag v0.0.6
   git push origin v0.0.6

   # For pre-release:
   git tag v0.0.6-beta
   git push origin v0.0.6-beta
   ```

3. **Workflow runs automatically:**
   - Builds PyInstaller backend for all platforms
   - Builds full Tauri apps
   - Creates draft GitHub release with installers
   - Installs the ML environment through each built backend as a pre-release check

4. **Edit and publish:**
   - Go to GitHub Releases
   - Edit the draft release
   - Add release notes
   - Publish the release

### Tag Naming Convention

**Review-only:** `v*-review`
- `v0.0.6-review` ✓ Triggers review build
- `v0.0.6-release` ✗ Does NOT trigger review build

**Full app:** `v[0-9]+.[0-9]+.[0-9]+` with optional suffix
- `v0.0.6` ✓ Stable release
- `v0.0.6-alpha` ✓ Alpha pre-release
- `v0.0.6-beta` ✓ Beta pre-release
- `v0.0.6-rc1` ✓ Release candidate
- `v0.0.6-review` ✗ Does NOT trigger full build (triggers review)

---

## Manual Workflow Dispatch

You can manually trigger builds from the GitHub Actions tab:

1. Go to **Actions** tab in GitHub
2. Select the workflow (`Build Review-Only App` or `Build Full App`)
3. Click **Run workflow**
4. Select the branch
5. Click **Run workflow** button

---

## Build Artifacts

### Review-Only Build
```
artifacts/
├── dipper-backend-macos-arm64/
├── dipper-backend-windows-x64/
├── dipper-backend-linux-x64/
├── dipper-review-macos-arm64-dmg/
├── dipper-review-windows-x64-installer/
└── dipper-review-linux-x64-appimage/
```

### Full App Build
```
artifacts/
├── dipper-backend-macos-arm64/
├── dipper-backend-windows-x64/
├── dipper-backend-linux-x64/
├── dipper-full-macos-arm64/
├── dipper-full-windows-x64/
└── dipper-full-linux-x64/
```

---

## Build Times

Approximate build times on GitHub-hosted runners:

| Step | Time |
|------|------|
| PyInstaller build | 5-10 minutes |
| Tauri build | 10-20 minutes |
| **Total (Review)** | **~20-30 minutes** |
| **Total (Full)** | **~40-70 minutes** |

---

## Troubleshooting

### Build Fails on macOS

**Problem:** Code signing issues
**Solution:** The workflow uses ad-hoc signing (`-`). For distribution, you'll need to add proper signing certificates to GitHub Secrets.

### ML Environment Install Fails in `test-built-backend`

**Problem:** `uv sync --frozen` fails or the installed environment is not usable
**Solution:** Run `cd backend/ml_env && uv lock --check` to verify the lockfile matches `pyproject.toml`, and see the `test-uv-ml-env.yml` workflow for per-platform import checks.

### Tauri Build Can't Find PyInstaller Executable

**Problem:** Artifact download failed or incorrect permissions
**Solution:** Check the artifact name matches between jobs. Ensure `chmod +x` is run on Unix systems.

### Linux Build Fails with WebKit Errors

**Problem:** Missing system dependencies
**Solution:** Ensure all dependencies are listed in the "Install Linux dependencies" step.

---

## Local Testing

To test the workflows locally, you can use [act](https://github.com/nektos/act):

```bash
# Install act
brew install act  # macOS
# or
choco install act  # Windows

# Test CI workflow
act pull_request -W .github/workflows/ci.yml

# Test review build (jobs only, won't complete)
act push -W .github/workflows/build-review.yml -j build-pyinstaller
```

**Note:** Full builds won't work locally due to runner requirements and artifact dependencies.

---

## GitHub Secrets Required

For full production releases with code signing:

| Secret | Purpose | Required For |
|--------|---------|--------------|
| `GITHUB_TOKEN` | Create releases | All workflows (auto-provided) |
| `APPLE_CERTIFICATE` | macOS code signing | macOS production builds |
| `APPLE_CERTIFICATE_PASSWORD` | Certificate password | macOS production builds |
| `APPLE_ID` | Notarization | macOS production builds |
| `APPLE_TEAM_ID` | Team identifier | macOS production builds |

Currently, workflows use ad-hoc signing for development builds.

---

## Customization

### Change Python Version

The workflows use [uv](https://docs.astral.sh/uv/) (`astral-sh/setup-uv`), which installs the Python version the project asks for, so there is no `python-version` to edit in the workflows. Change `requires-python` in `backend/pyproject.toml` and `backend/ml_env/pyproject.toml` (and `ML_PYTHON_VERSION` in `backend/app.py`), then re-run `uv lock` in both directories. See DEVELOPMENT.md.

### Change Node Version

Edit all workflow files:
```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'  # Change this
```

### Add Additional Platforms

To add ARM Linux support:
```yaml
- platform: linux-arm64
  os: ubuntu-latest
  rust_target: aarch64-unknown-linux-gnu
```

Add cross-compilation setup in the workflow.

---

## Questions?

See the [main project README](../../README.md) or open an issue.
