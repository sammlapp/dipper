const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const platform = os.platform();
const arch = os.arch();

console.log(`Building Python environment for ${platform}-${arch}`);

// Paths
const backendPath = path.join(__dirname, '../../backend');
const envPath = path.join(backendPath, 'bundled_env');
const requirementsPath = path.join(backendPath, 'requirements.txt');

// Create bundled environment directory
if (!fs.existsSync(envPath)) {
  fs.mkdirSync(envPath, { recursive: true });
}

try {
  // Determine Python executable name
  const pythonExe = platform === 'win32' ? 'python.exe' : 'python3';
  
  console.log('Creating virtual environment...');
  execSync(`${pythonExe} -m venv "${envPath}"`, { 
    stdio: 'inherit',
    cwd: backendPath 
  });
  
  // Determine pip path
  const pipPath = platform === 'win32' 
    ? path.join(envPath, 'Scripts', 'pip.exe')
    : path.join(envPath, 'bin', 'pip');
  
  console.log('Installing requirements...');
  execSync(`"${pipPath}" install -r "${requirementsPath}"`, { 
    stdio: 'inherit',
    cwd: backendPath 
  });
  
  // Install additional packages that might be needed
  const additionalPackages = [
    'pyinstaller',  // For potential standalone executable creation
    'cx_Freeze',    // Alternative packaging tool
  ];
  
  for (const pkg of additionalPackages) {
    try {
      console.log(`Installing ${pkg}...`);
      execSync(`"${pipPath}" install ${pkg}`, { 
        stdio: 'inherit',
        cwd: backendPath 
      });
    } catch (error) {
      console.warn(`Warning: Could not install ${pkg}: ${error.message}`);
    }
  }
  
  // Create a manifest file with environment info
  const manifest = {
    platform: platform,
    arch: arch,
    python_version: execSync(`"${pipPath}" --version`, { encoding: 'utf8' }).trim(),
    created_at: new Date().toISOString(),
    packages: []
  };
  
  try {
    const packageList = execSync(`"${pipPath}" list --format=json`, { encoding: 'utf8' });
    manifest.packages = JSON.parse(packageList);
  } catch (error) {
    console.warn('Could not generate package list');
  }
  
  fs.writeFileSync(
    path.join(envPath, 'environment_manifest.json'), 
    JSON.stringify(manifest, null, 2)
  );
  
  console.log('Python environment built successfully!');
  console.log(`Environment location: ${envPath}`);
  
} catch (error) {
  console.error('Error building Python environment:', error.message);
  process.exit(1);
}