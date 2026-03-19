# Design Customization Guide

This project uses a CSS token/theme approach. Most visual changes should be done in [frontend/src/App.css](frontend/src/App.css).

## Fonts: change only CSS vs install fonts

### Short answer
- If the font is already available (system font or already bundled), you can just edit `--app-font` in [frontend/src/App.css](frontend/src/App.css).
- If the font is **not** available, install or bundle it first, then update `--app-font`.

### Current setup
- App-wide font token is `--app-font` in [frontend/src/App.css](frontend/src/App.css#L5).
- Font is loaded from `@fontsource/inter` in [frontend/src/index.js](frontend/src/index.js#L1-L4).

### How to try a new font

#### Option A: system font only (no install)
1. Edit `--app-font` in [frontend/src/App.css](frontend/src/App.css#L5).
2. Put preferred font first, keep fallbacks after it.

Example:
- `--app-font: 'Avenir Next', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;`

Use this only if the font exists on target machines.

#### Option B: webfont via npm (recommended for consistency)
1. Install package from `frontend/`:
	- `npm install @fontsource/<font-name>`
2. Import it in [frontend/src/index.js](frontend/src/index.js):
	- `import '@fontsource/<font-name>/index.css';`
3. Update `--app-font` in [frontend/src/App.css](frontend/src/App.css#L5).
4. Restart dev server.

Notes:
- Package entrypoints differ by font. If `variable.css` fails, use `index.css`.
- Commit both `package.json` and `package-lock.json` after install.

#### Option C: self-host local font files
1. Add font files under `frontend/public/fonts/...`.
2. Define `@font-face` (in HTML or CSS).
3. Set `--app-font` to that family name.

Use this for fully offline/distributable builds without runtime font CDNs.

## Colors and theming

### Where to edit
- Light theme tokens: `:root` in [frontend/src/App.css](frontend/src/App.css#L4-L58).
- Dark theme tokens: `body.dark-mode` in [frontend/src/App.css](frontend/src/App.css#L62-L114).

### Recommended process
1. Change semantic tokens first (`--bg`, `--text-primary`, `--panel-bg`, etc.).
2. Then tune specific accents (`--dark-accent`, task-state colors, glow colors).
3. Verify both light and dark mode.
4. Check contrast for:
	- text vs background,
	- helper text,
	- selected vs unselected controls,
	- button text states.

### Common tokens
- Backgrounds: `--bg`, `--bg-surface`, `--bg-elevated`, `--panel-bg`
- Text: `--text-primary`, `--text-secondary`
- Borders/inputs: `--border-color`, `--input-bg`, `--input-border`, `--dropdown-bg`, `--dropdown-border`
- Accent/action: `--dark-accent`, `--toolbar-btn-active-bg`
- Status: `--task-running-*`, `--task-completed-*`, `--task-failed-*`, `--task-cancelled-*`, `--task-queued-*`

## Quick checklist after design changes
- Restart `npm run tauri:dev`.
- Confirm font is actually rendered (not fallback).
- Test light + dark mode in:
  - task forms,
  - settings,
  - review drawers/modals,
  - buttons and helper text.
- Ensure no regressions in MUI controls.

