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
   - macOS Intel (x64)
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
- Tags matching `v*` but NOT `v*-review` (e.g., `v0.0.6`)
- Manual workflow dispatch

**Purpose:** Build complete app with ML training capabilities

**What it builds:**
1. **PyInstaller Backend** (all platforms)
   - Same as review build

2. **Conda-Pack ML Environment** (all platforms)
   - PyTorch + dependencies
   - ~700MB compressed archive
   - Automatically downloaded by app on first use

3. **Tauri Full App** (all platforms)
   - DMG for macOS
   - NSIS installer for Windows
   - AppImage for Linux

**Artifacts:**
- Full app installers for each platform
- Conda-pack environment archives (`dipper_pytorch_env.tar.gz`)
- Environment extraction and test scripts
- Larger download size (~100-200MB app + ~700MB ML env)

**Use this for:** Full production releases with ML capabilities

---

## Platform Support

| Platform | Architecture | Runner | Status |
|----------|-------------|--------|--------|
| macOS    | Intel (x64) | `macos-13` | ✅ Supported |
| macOS    | Apple Silicon (arm64) | `macos-14` | ✅ Supported |
| Windows  | x64 | `windows-latest` | ✅ Supported |
| Linux    | x64 | `ubuntu-latest` | ✅ Supported |

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

1. **Tag the release:**
   ```bash
   git tag v0.0.6
   git push origin v0.0.6
   ```

2. **Workflow runs automatically:**
   - Builds PyInstaller backend for all platforms
   - Builds conda-pack ML environments (~30-60 minutes)
   - Builds full Tauri apps
   - Creates draft GitHub release with installers and ML environments

3. **Edit and publish:**
   - Go to GitHub Releases
   - Edit the draft release
   - Add release notes
   - Publish the release

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
├── lightweight_server-macos-x64/
├── lightweight_server-macos-arm64/
├── lightweight_server-windows-x64/
├── lightweight_server-linux-x64/
├── dipper-review-macos-x64-dmg/
├── dipper-review-macos-arm64-dmg/
├── dipper-review-windows-x64-installer/
└── dipper-review-linux-x64-appimage/
```

### Full App Build
```
artifacts/
├── lightweight_server-macos-x64/
├── lightweight_server-macos-arm64/
├── lightweight_server-windows-x64/
├── lightweight_server-linux-x64/
├── conda-env-macos-x64/
│   ├── dipper_pytorch_env.tar.gz
│   ├── extract_and_test_env.sh
│   └── test_environment.py
├── conda-env-macos-arm64/
├── conda-env-windows-x64/
├── conda-env-linux-x64/
├── dipper-full-macos-x64/
│   ├── *.dmg
│   └── dipper_pytorch_env.tar.gz
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
| Conda-pack build | 30-60 minutes |
| Tauri build | 10-20 minutes |
| **Total (Review)** | **~20-30 minutes** |
| **Total (Full)** | **~50-90 minutes** |

---

## Troubleshooting

### Build Fails on macOS

**Problem:** Code signing issues
**Solution:** The workflow uses ad-hoc signing (`-`). For distribution, you'll need to add proper signing certificates to GitHub Secrets.

### Conda-pack Build Fails

**Problem:** Environment creation timeout
**Solution:** Check `backend/dipper_pytorch_env.yml` for package conflicts. Consider using mamba instead of conda for faster resolution.

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

Edit all workflow files:
```yaml
- name: Setup Python
  uses: actions/setup-python@v5
  with:
    python-version: '3.11'  # Change this
```

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
