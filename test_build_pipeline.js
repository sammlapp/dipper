#!/usr/bin/env node

/**
 * Test script for the complete build pipeline
 * Tests PyInstaller builds, conda-pack environment, and integration
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = __dirname;
const BACKEND_DIR = path.join(PROJECT_ROOT, 'backend');
const FRONTEND_DIR = path.join(PROJECT_ROOT, 'frontend');

console.log('🧪 Testing Build Pipeline');
console.log('========================');

function runCommand(command, cwd = PROJECT_ROOT, options = {}) {
    console.log(`Running: ${command}`);
    try {
        const result = execSync(command, { 
            stdio: options.silent ? 'pipe' : 'inherit', 
            cwd: cwd,
            encoding: 'utf8',
            env: { ...process.env }
        });
        return { success: true, output: result };
    } catch (error) {
        console.error(`Command failed: ${command}`);
        if (!options.silent) {
            console.error(`Error: ${error.message}`);
        }
        return { success: false, error: error.message, output: error.stdout };
    }
}

function checkFileExists(filePath, description) {
    if (fs.existsSync(filePath)) {
        console.log(`✅ ${description}: ${filePath}`);
        return true;
    } else {
        console.log(`❌ ${description} not found: ${filePath}`);
        return false;
    }
}

function testPyInstallerBuild() {
    console.log('\n📦 Testing PyInstaller Build');
    console.log('-----------------------------');
    
    // Check if PyInstaller environment exists
    const pyinstallerVenv = path.join(BACKEND_DIR, 'pyinstaller-venv-light');
    if (!checkFileExists(pyinstallerVenv, 'PyInstaller virtual environment')) {
        console.log('Creating PyInstaller environment...');
        const result = runCommand('npm run build:python-pyinstaller', FRONTEND_DIR);
        if (!result.success) {
            return false;
        }
    }
    
    // Check for built lightweight server
    const pythonDist = path.join(FRONTEND_DIR, 'python-dist');
    const serverPath = path.join(pythonDist, 'lightweight_server', 'lightweight_server');
    
    let allPresent = checkFileExists(serverPath, 'Lightweight server executable');
    
    return allPresent;
}

function testCondaPackBuild() {
    console.log('\n🐍 Testing Conda-Pack Environment Build');
    console.log('---------------------------------------');
    
    // Check if conda is available
    const condaCheck = runCommand('conda --version', PROJECT_ROOT, { silent: true });
    if (!condaCheck.success) {
        console.log('❌ Conda not available - skipping conda-pack tests');
        return false;
    }
    
    // Check if environment file exists
    const envFile = path.join(BACKEND_DIR, 'dipper_pytorch_env.yml');
    if (!checkFileExists(envFile, 'Environment file')) {
        return false;
    }
    
    // Check if conda-pack archive exists
    const envDir = path.join(PROJECT_ROOT, 'environments');
    const archivePath = path.join(envDir, 'dipper_pytorch_env.tar.gz');
    
    if (!fs.existsSync(archivePath)) {
        console.log('Building conda-pack environment...');
        const result = runCommand('npm run build:conda-pack', FRONTEND_DIR);
        if (!result.success) {
            return false;
        }
    }
    
    return checkFileExists(archivePath, 'Conda-pack archive');
}

function testLightweightServer() {
    console.log('\n⚙️  Testing Lightweight Server');
    console.log('-----------------------------');
    
    const pythonDist = path.join(FRONTEND_DIR, 'python-dist', 'lightweight_server');
    
    if (!fs.existsSync(pythonDist)) {
        console.log('❌ Lightweight server not built');
        return false;
    }
    
    // Test server starts and responds
    console.log('Testing lightweight server startup...');
    const serverExe = path.join(pythonDist, 'lightweight_server');
    
    try {
        // Test with --test flag
        const testResult = runCommand(
            `"${serverExe}" --test`,
            PROJECT_ROOT,
            { silent: true }
        );
        
        if (testResult.success && testResult.output.includes('Lightweight server test successful!')) {
            console.log('✅ Server test mode passed');
            
            if (testResult.output.includes('PyInstaller bundling: ✅ SUCCESS')) {
                console.log('✅ PyInstaller bundling confirmed');
            } else {
                console.log('⚠️  PyInstaller bundling not confirmed (might be running from source)');
            }
            
            return true;
        } else {
            console.log('❌ Server test failed');
            console.log('Output:', testResult.output);
            return false;
        }
    } catch (error) {
        console.log(`❌ Server test failed: ${error.message}`);
        return false;
    }
}

function testIntegration() {
    console.log('\n🔄 Testing Integration');
    console.log('---------------------');
    
    // Test that all required files are in place for distribution
    const requiredFiles = [
        'frontend/python-dist/lightweight_server/lightweight_server',
        'backend/lightweight_server.py',
        'backend/scripts/inference.py',
        'backend/dipper_pytorch_env.yml'
    ];
    
    // Optional files (check if they exist but don't fail if missing)
    const optionalFiles = [
        'environments/dipper_pytorch_env.tar.gz'
    ];
    
    let allPresent = true;
    for (const file of requiredFiles) {
        const filePath = path.join(PROJECT_ROOT, file);
        if (!checkFileExists(filePath, `Required file ${file}`)) {
            allPresent = false;
        }
    }
    
    // Check optional files (informational only)
    for (const file of optionalFiles) {
        const filePath = path.join(PROJECT_ROOT, file);
        if (checkFileExists(filePath, `Optional file ${file}`)) {
            console.log(`ℹ️  Optional file available: ${file}`);
        } else {
            console.log(`ℹ️  Optional file missing: ${file} (will be built as needed)`);
        }
    }
    
    if (allPresent) {
        console.log('✅ All required files present for distribution');
    }
    
    return allPresent;
}

function main() {
    console.log(`Platform: ${os.platform()}`);
    console.log(`Architecture: ${os.arch()}`);
    console.log(`Node.js: ${process.version}`);
    
    let allTestsPassed = true;
    
    // Test each component
    const tests = [
        { name: 'PyInstaller Build', fn: testPyInstallerBuild },
        { name: 'Conda-Pack Build', fn: testCondaPackBuild },
        { name: 'Lightweight Server', fn: testLightweightServer },
        { name: 'Integration', fn: testIntegration }
    ];
    
    for (const test of tests) {
        try {
            const result = test.fn();
            if (result) {
                console.log(`\n✅ ${test.name}: PASSED`);
            } else {
                console.log(`\n❌ ${test.name}: FAILED`);
                allTestsPassed = false;
            }
        } catch (error) {
            console.log(`\n💥 ${test.name}: ERROR - ${error.message}`);
            allTestsPassed = false;
        }
    }
    
    console.log('\n🏁 Test Summary');
    console.log('================');
    
    if (allTestsPassed) {
        console.log('🎉 All tests passed! Build pipeline is working correctly.');
        console.log('\n📝 Next steps:');
        console.log('1. Build the Electron app: cd frontend && npm run dist');
        console.log('2. Test the complete application with ML inference');
        console.log('3. Create distribution packages');
        process.exit(0);
    } else {
        console.log('💥 Some tests failed. Please check the errors above.');
        console.log('\n🔧 Troubleshooting:');
        console.log('1. Ensure all dependencies are installed');
        console.log('2. Check that conda is available and working');
        console.log('3. Verify PyInstaller builds completed successfully');
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}