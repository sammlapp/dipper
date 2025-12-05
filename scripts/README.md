# Version Management

## Bumping Version

Version numbers are defined in three places:
1. `frontend/package.json`
2. `frontend/src-tauri/Cargo.toml`
3. `frontend/src-tauri/tauri.conf.json`

To update the version across all files at once:

```bash
cd frontend
npm run version-bump <new-version>
```

### Examples

```bash
# Bump to next patch version
npm run version-bump 0.0.7

# Bump to next minor version
npm run version-bump 0.1.0

# Bump to next major version
npm run version-bump 1.0.0

# Pre-release version
npm run version-bump 1.0.0-beta.1
```

### After Bumping Version

The script will print the next steps:

1. **Review changes:**
   ```bash
   git diff
   ```

2. **Update Cargo.lock:**
   ```bash
   cd frontend/src-tauri && cargo check
   ```

3. **Commit changes:**
   ```bash
   git add -A
   git commit -m "bump version to X.Y.Z"
   ```

4. **Create git tag:**
   ```bash
   git tag vX.Y.Z
   ```

5. **Build the application:**
   ```bash
   npm run tauri:build:all
   ```

## Manual Version Update

If you need to update manually, edit these files:

- `frontend/package.json` - line 3: `"version": "X.Y.Z"`
- `frontend/src-tauri/Cargo.toml` - line 3: `version = "X.Y.Z"`
- `frontend/src-tauri/tauri.conf.json` - line 10: `"version": "X.Y.Z"`

After manual changes, run `cargo check` in `frontend/src-tauri` to update `Cargo.lock`.
