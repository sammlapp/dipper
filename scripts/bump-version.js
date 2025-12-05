#!/usr/bin/env node

/**
 * Bump version script
 * Updates version in all required files:
 * - frontend/package.json
 * - frontend/src-tauri/Cargo.toml
 * - frontend/src-tauri/tauri.conf.json
 *
 * Usage:
 *   node scripts/bump-version.js <new-version>
 *   npm run version-bump <new-version>
 *
 * Example:
 *   node scripts/bump-version.js 0.0.7
 */

const fs = require('fs');
const path = require('path');

const newVersion = process.argv[2];

if (!newVersion) {
  console.error('❌ Error: Version number required');
  console.log('Usage: node scripts/bump-version.js <version>');
  console.log('Example: node scripts/bump-version.js 0.0.7');
  process.exit(1);
}

// Validate version format (basic semver check)
if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(newVersion)) {
  console.error('❌ Error: Invalid version format');
  console.log('Version must be in format: X.Y.Z or X.Y.Z-suffix');
  console.log('Example: 0.0.7 or 1.0.0-beta.1');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const FILES = {
  packageJson: path.join(ROOT, 'frontend', 'package.json'),
  cargoToml: path.join(ROOT, 'frontend', 'src-tauri', 'Cargo.toml'),
  tauriConf: path.join(ROOT, 'frontend', 'src-tauri', 'tauri.conf.json')
};

console.log(`\n🔧 Bumping version to: ${newVersion}\n`);

// Update frontend/package.json
try {
  const pkgPath = FILES.packageJson;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const oldVersion = pkg.version;
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✅ frontend/package.json: ${oldVersion} → ${newVersion}`);
} catch (err) {
  console.error(`❌ Failed to update package.json: ${err.message}`);
  process.exit(1);
}

// Update frontend/src-tauri/Cargo.toml
try {
  const cargoPath = FILES.cargoToml;
  let cargo = fs.readFileSync(cargoPath, 'utf8');
  const versionMatch = cargo.match(/^version = "([^"]+)"/m);
  if (!versionMatch) {
    throw new Error('Could not find version line in Cargo.toml');
  }
  const oldVersion = versionMatch[1];
  cargo = cargo.replace(/^version = "[^"]+"$/m, `version = "${newVersion}"`);
  fs.writeFileSync(cargoPath, cargo);
  console.log(`✅ frontend/src-tauri/Cargo.toml: ${oldVersion} → ${newVersion}`);
} catch (err) {
  console.error(`❌ Failed to update Cargo.toml: ${err.message}`);
  process.exit(1);
}

// Update frontend/src-tauri/tauri.conf.json
try {
  const tauriPath = FILES.tauriConf;
  const tauri = JSON.parse(fs.readFileSync(tauriPath, 'utf8'));
  const oldVersion = tauri.version;
  tauri.version = newVersion;
  fs.writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + '\n');
  console.log(`✅ frontend/src-tauri/tauri.conf.json: ${oldVersion} → ${newVersion}`);
} catch (err) {
  console.error(`❌ Failed to update tauri.conf.json: ${err.message}`);
  process.exit(1);
}

console.log(`\n✨ Version updated successfully to ${newVersion}\n`);
console.log('Next steps:');
console.log('  1. Review changes: git diff');
console.log('  2. Update Cargo.lock: cd frontend/src-tauri && cargo check');
console.log(`  3. Commit: git add -A && git commit -m "bump version to ${newVersion}"`);
console.log(`  4. Tag: git tag v${newVersion}`);
console.log('  5. Build: npm run tauri:build:all\n');
