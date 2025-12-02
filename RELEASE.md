# Release Guide

This document describes how to create releases for Dipper using the automated GitHub Actions workflows.

## Quick Start

### Review-Only Release
```bash
git tag v0.0.6-review
git push origin v0.0.6-review
```
→ Builds lightweight review-only app (~20-30 min)

### Full App Release
```bash
git tag v0.0.6
git push origin v0.0.6
```
→ Builds complete app with ML environment (~50-90 min)

## What Gets Built

### Review-Only Build (`v*-review` tags)
- [YES] PyInstaller lightweight_server for all platforms
- [YES] Tauri desktop app (DMG, EXE, AppImage)
- [NO] ML training environment
- **Size:** ~100-200 MB per platform
- **Use for:** Distribution to annotators for review tasks only

### Full App Build (`v*` tags, excluding `v*-review`)
- [YES] PyInstaller lightweight_server for all platforms
- [YES] Conda-pack ML environment (~700 MB) for all platforms
- [YES] Tauri desktop app (DMG, EXE, AppImage)
- **Size:** ~100-200 MB app + ~700 MB ML environment
- **Use for:** Full production releases with training capabilities

## Supported Platforms

| Platform | Architecture | Output Format |
|----------|-------------|---------------|
| macOS | Intel (x64) | DMG |
| macOS | Apple Silicon (arm64) | DMG |
| Windows | x64 | NSIS Installer (EXE) |
| Linux | x64 | AppImage |

## Release Process

### Step 1: Prepare Release

1. Update version in `frontend/package.json`:
   ```json
   {
     "version": "0.0.6"
   }
   ```

2. Update version in `frontend/src-tauri/Cargo.toml`:
   ```toml
   [package]
   version = "0.0.6"
   ```

3. Update CHANGELOG.md with release notes

4. Commit changes:
   ```bash
   git add .
   git commit -m "Prepare release v0.0.6"
   git push origin main
   ```

### Step 2: Create Tag

**For Review-Only:**
```bash
git tag -a v0.0.6-review -m "Release v0.0.6 (Review Only)"
git push origin v0.0.6-review
```

**For Full App:**
```bash
git tag -a v0.0.6 -m "Release v0.0.6"
git push origin v0.0.6
```

### Step 3: Monitor Build

1. Go to https://github.com/YOUR_ORG/training_gui/actions
2. Watch the workflow run (green = success, red = failure)
3. Wait for completion:
   - Review-only: ~20-30 minutes
   - Full app: ~50-90 minutes

### Step 4: Publish Release

1. Go to https://github.com/YOUR_ORG/training_gui/releases
2. Find the draft release
3. Edit the release:
   - Add detailed release notes
   - Add screenshots if UI changed
   - Add upgrade instructions if needed
4. **Publish release**

## Build Outputs

### Review-Only Release Files
```
Dipper-Review-0.0.6-x64.dmg              # macOS Intel
Dipper-Review-0.0.6-arm64.dmg            # macOS ARM
Dipper-Review-0.0.6-x64-setup.exe        # Windows
Dipper-Review-0.0.6-x64.AppImage         # Linux
```

### Full App Release Files
```
Dipper-0.0.6-x64.dmg                     # macOS Intel
Dipper-0.0.6-arm64.dmg                   # macOS ARM
Dipper-0.0.6-x64-setup.exe               # Windows
Dipper-0.0.6-x64.AppImage                # Linux
dipper_pytorch_env-macos-x64.tar.gz      # ML env macOS Intel
dipper_pytorch_env-macos-arm64.tar.gz    # ML env macOS ARM
dipper_pytorch_env-windows-x64.tar.gz    # ML env Windows
dipper_pytorch_env-linux-x64.tar.gz      # ML env Linux
```

## Manual Workflow Trigger

If you need to rebuild without creating a new tag:

1. Go to **Actions** tab
2. Select workflow: "Build Review-Only App" or "Build Full App"
3. Click **Run workflow**
4. Select branch (usually `main`)
5. Click green **Run workflow** button

This is useful for:
- Testing workflow changes
- Rebuilding after fixing a build issue
- Creating test builds from feature branches

## Version Numbering

Follow semantic versioning: `MAJOR.MINOR.PATCH`

**Examples:**
- `v0.0.6` - Patch release (bug fixes)
- `v0.1.0` - Minor release (new features, backwards compatible)
- `v1.0.0` - Major release (breaking changes)

**Review-only variants:**
- `v0.0.6-review` - Review-only version of v0.0.6

**Pre-releases:**
- `v0.0.6-alpha` - Alpha release
- `v0.0.6-beta` - Beta release
- `v0.0.6-rc1` - Release candidate

## Troubleshooting

### "Build Failed" - PyInstaller Stage

**Check:**
1. Does `backend/build_pyinstaller.py` run locally?
2. Are requirements in `backend/requirements-lightweight.txt` up to date?
3. Check workflow logs for Python errors

**Fix:**
```bash
cd backend
python build_pyinstaller.py
# Fix any errors, commit, and re-tag
```

### "Build Failed" - Conda-Pack Stage

**Check:**
1. Does `backend/build_conda_pack.py` run locally?
2. Is `backend/dipper_pytorch_env.yml` valid?
3. Check for package conflicts in conda solver

**Fix:**
```bash
cd backend
conda env create -f dipper_pytorch_env.yml
# Fix conflicts, update yml, commit, and re-tag
```

### "Build Failed" - Tauri Stage

**Check:**
1. Did previous stages (PyInstaller/conda-pack) complete?
2. Are artifacts being downloaded correctly?
3. Check `frontend/src-tauri/tauri.conf.json` for errors

**Fix:**
```bash
cd frontend
npm run tauri:build:review  # or tauri:build:all
# Fix errors, commit, and re-tag
```

### Release Doesn't Appear

**Problem:** GitHub Release not created
**Solution:**
- Release is only created for tag pushes starting with `v`
- Check if tag exists: `git tag -l`
- Check Actions tab for workflow run status

### Wrong Files in Release

**Problem:** Missing or incorrect artifacts
**Solution:**
- Check artifact upload steps in workflow
- Verify file paths match actual build outputs
- Re-run workflow manually if needed

## Testing Before Release

Before creating an official release, test the build process:

### Test Review Build
```bash
git checkout -b test-review-build
# Make version changes if needed
git commit -am "Test review build"
git tag v0.0.6-review-test
git push origin test-review-build --tags
# Monitor build, then delete tag if successful
git tag -d v0.0.6-review-test
git push origin :refs/tags/v0.0.6-review-test
```

### Test Full Build
```bash
git checkout -b test-full-build
git commit -am "Test full build"
git tag v0.0.6-test
git push origin test-full-build --tags
# Monitor build, then delete tag if successful
git tag -d v0.0.6-test
git push origin :refs/tags/v0.0.6-test
```

## Best Practices

1. **Always test locally first**
   ```bash
   npm run build:python-pyinstaller
   npm run build:conda-pack
   npm run tauri:build:review
   ```

2. **Update CHANGELOG before tagging**
   - Document all changes
   - Include breaking changes
   - Add migration guide if needed

3. **Use semantic versioning**
   - Patch (0.0.X): Bug fixes only
   - Minor (0.X.0): New features, backwards compatible
   - Major (X.0.0): Breaking changes

4. **Test on all platforms when possible**
   - Especially for breaking changes
   - Check platform-specific bugs
   - Verify installers work correctly

5. **Keep release notes user-friendly**
   - What's new
   - What's fixed
   - What's changed (breaking)
   - How to upgrade

## Questions?

- Workflow details: See [.github/workflows/README.md](.github/workflows/README.md)
- Build scripts: See `backend/build_pyinstaller.py` and `backend/build_conda_pack.py`
- Issues: Open an issue on GitHub
