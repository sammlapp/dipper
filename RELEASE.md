# Release Guide

This document describes how to create releases for Dipper using the automated GitHub Actions workflows.

## Download Page

Releases are published at: **https://sammlapp.github.io/dipper/**

The page auto-fetches the latest GitHub Release assets and shows per-platform download buttons.
It updates automatically whenever a release is published.

---

## Quick Start

### Step 1 — Bump the version

```bash
cd frontend
npm run version-bump 0.0.13   # updates package.json, Cargo.toml, tauri.conf.json
cd src-tauri && cargo check   # updates Cargo.lock
cd ../..
git add -A && git commit -m "bump version to 0.0.13"
git push origin main
```

### Step 2 — Tag and push

```bash
# Dipper Review build only (lightweight, ~20-30 min)
git tag -a v0.0.13 -m "Release v0.0.13"
git push origin v0.0.13

# Full app build (includes ML environment, ~50-90 min)
# Uses the build-full.yml workflow — tag format: vX.Y.Z (no suffix)
```

### Step 3 — Publish the draft release

1. Go to **https://github.com/sammlapp/dipper/releases**
2. Find the draft release created by the workflow
3. Add release notes, then click **Publish release**
4. The GitHub Pages site updates automatically within ~1 minute

---

## Workflows

| Workflow | Trigger | Builds |
|---|---|---|
| `build-review.yml` | Any `v*` tag or push to `main`/`develop` | Dipper Review (PyInstaller + Tauri review-only) |
| `build-full.yml` | Tags matching `vX.Y.Z` (no suffix) | Dipper Full (PyInstaller + Tauri full app) |
| `deploy-pages.yml` | Release published, push to `docs/`, or manual | GitHub Pages download site |

Both build workflows create a **draft GitHub Release** with assets attached when triggered by a tag.

---

## Build Outputs

### Dipper Review
- `Dipper-Review-X.Y.Z-arm64.dmg` — macOS Apple Silicon
- `Dipper-Review-X.Y.Z-x64-setup.exe` — Windows x64
- `Dipper-Review-X.Y.Z-x64.AppImage` — Linux x64
- Size: ~100–200 MB per platform

### Dipper Full
- `Dipper-X.Y.Z-arm64.dmg` — macOS Apple Silicon
- `Dipper-X.Y.Z-x64-setup.exe` — Windows x64
- `Dipper-X.Y.Z-x64.AppImage` — Linux x64
- Size: ~100–200 MB app + ~700 MB ML environment (downloaded on first use)

---

## Supported Platforms

| Platform | Architecture | Format |
|---|---|---|
| macOS | Apple Silicon (arm64) | DMG |
| Windows | x64 | NSIS Installer (EXE) |
| Linux | x64 | AppImage |

---

## Version Numbers

Three files must stay in sync — `npm run version-bump` handles all three:

1. `frontend/package.json`
2. `frontend/src-tauri/Cargo.toml`
3. `frontend/src-tauri/tauri.conf.json`

Follow semantic versioning (`MAJOR.MINOR.PATCH`):
- `v0.0.X` — bug fixes / minor improvements
- `v0.X.0` — new features (backwards compatible)
- `vX.0.0` — breaking changes

Pre-releases: `v0.0.13-alpha`, `v0.0.13-beta`, `v0.0.13-rc1`

---

## GitHub Pages Setup (one-time)

The download site lives in `docs/` and deploys via the `deploy-pages.yml` workflow.

To enable it the first time:
1. Go to **Settings → Pages** in the GitHub repo
2. Under **Source**, select **GitHub Actions**
3. Save — the site will be live at `https://sammlapp.github.io/dipper/` after the next deploy

---

## Manual Workflow Trigger

To rebuild without creating a new tag:
1. **Actions** tab → select workflow
2. Click **Run workflow** → select branch → **Run workflow**

---

## Troubleshooting

**PyInstaller build fails**
```bash
cd backend && python build_pyinstaller.py   # reproduce locally, fix, commit, retag
```

**Tauri build fails**
- Check that PyInstaller artifact was produced in the prior job
- Check `frontend/src-tauri/tauri.conf.json` for syntax errors
```bash
cd frontend && npm run tauri:build:review   # reproduce locally
```

**Release draft not created**
- Release is only created for tag pushes starting with `v`
- Check: `git tag -l` and the Actions tab

**GitHub Pages not updating**
- Confirm Pages source is set to "GitHub Actions" (not a branch)
- Check the `deploy-pages` workflow run in the Actions tab

**macOS: "App is damaged" / Gatekeeper block**
- Right-click → Open, or: `xattr -cr /Applications/Dipper\ Review.app`

**Linux: AppImage won't launch**
```bash
chmod +x Dipper-Review-*.AppImage && ./Dipper-Review-*.AppImage
```
