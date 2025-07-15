const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const platform = os.platform();

console.log(`Packaging application for ${platform}`);

// Update package.json build configuration based on platform
const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Ensure Python environment is included in build
const pythonEnvPath = path.join(__dirname, '../../backend/bundled_env');
if (fs.existsSync(pythonEnvPath)) {
  packageJson.build.extraResources = [
    {
      "from": "../backend/bundled_env",
      "to": "backend/bundled_env",
      "filter": ["**/*"]
    },
    {
      "from": "../backend/scripts",
      "to": "backend/scripts",
      "filter": ["**/*.py"]
    }
  ];
} else {
  console.warn('Python environment not found. Run build-python-env.js first.');
}

// Platform-specific configurations
if (platform === 'darwin') {
  packageJson.build.mac = {
    ...packageJson.build.mac,
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"]
      }
    ],
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    hardenedRuntime: true,
    gatekeeperAssess: false
  };
} else if (platform === 'win32') {
  packageJson.build.win = {
    ...packageJson.build.win,
    target: [
      {
        target: "nsis",
        arch: ["x64", "ia32"]
      }
    ],
    requestedExecutionLevel: "asInvoker"
  };
} else if (platform === 'linux') {
  packageJson.build.linux = {
    ...packageJson.build.linux,
    target: [
      {
        target: "AppImage",
        arch: ["x64"]
      },
      {
        target: "deb",
        arch: ["x64"]
      }
    ]
  };
}

// Write updated package.json
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

try {
  console.log('Building React app...');
  execSync('npm run build', { 
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  
  console.log('Packaging Electron app...');
  execSync('npm run electron-build', { 
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  
  console.log('Application packaged successfully!');
  
  // List output files
  const buildDir = path.join(__dirname, '../../build');
  if (fs.existsSync(buildDir)) {
    console.log('\nBuild outputs:');
    const files = fs.readdirSync(buildDir);
    files.forEach(file => {
      const filePath = path.join(buildDir, file);
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`  ${file} (${sizeInMB} MB)`);
      }
    });
  }
  
} catch (error) {
  console.error('Error packaging application:', error.message);
  process.exit(1);
}