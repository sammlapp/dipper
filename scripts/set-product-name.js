#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get the mode from command line argument
const mode = process.argv[2]; // 'full' or 'review'

const tauriConfigPath = path.join(__dirname, '../frontend/src-tauri/tauri.conf.json');

// Read the config file
const config = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));

// Set the product name based on mode
if (mode === 'review') {
  config.productName = 'Dipper Review';
  config.app.windows[0].title = 'Dipper Review';
  config.app.windows[1].title = 'Loading Dipper Review...';
  console.log('✓ Set productName to "Dipper Review"');
} else {
  config.productName = 'Dipper';
  config.app.windows[0].title = 'Dipper';
  config.app.windows[1].title = 'Loading Dipper...';
  console.log('✓ Set productName to "Dipper"');
}

// Write the config back
fs.writeFileSync(tauriConfigPath, JSON.stringify(config, null, 2) + '\n');
