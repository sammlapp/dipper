// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

// State to store the backend server port and process
struct BackendState {
    port: Mutex<Option<u16>>,
    process: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}

/// Select multiple files
#[tauri::command]
async fn select_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();

    app.dialog()
        .file()
        .add_filter("Audio Files", &["wav", "mp3", "flac", "ogg", "m4a"])
        .add_filter("All Files", &["*"])
        .pick_files(move |files| {
            tx.send(files).ok();
        });

    match rx.recv() {
        Ok(Some(paths)) => Ok(paths.iter().map(|p| p.to_string()).collect()),
        Ok(None) => Err("No files selected".to_string()),
        Err(_) => Err("Failed to receive selection".to_string())
    }
}

/// Select a single folder
#[tauri::command]
async fn select_folder(app: tauri::AppHandle) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel();

    app.dialog()
        .file()
        .pick_folder(move |folder| {
            tx.send(folder).ok();
        });

    match rx.recv() {
        Ok(Some(path)) => Ok(path.to_string()),
        Ok(None) => Err("No folder selected".to_string()),
        Err(_) => Err("Failed to receive selection".to_string())
    }
}

/// Select CSV or PKL files for predictions
#[tauri::command]
async fn select_csv_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();

    app.dialog()
        .file()
        .add_filter("Prediction Files", &["csv", "pkl"])
        .add_filter("CSV Files", &["csv"])
        .add_filter("PKL Files", &["pkl"])
        .add_filter("All Files", &["*"])
        .pick_files(move |files| {
            tx.send(files).ok();
        });

    match rx.recv() {
        Ok(Some(paths)) => Ok(paths.iter().map(|p| p.to_string()).collect()),
        Ok(None) => Err("No files selected".to_string()),
        Err(_) => Err("Failed to receive selection".to_string())
    }
}

/// Select text files
#[tauri::command]
async fn select_text_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();

    app.dialog()
        .file()
        .add_filter("Text Files", &["txt", "csv"])
        .add_filter("All Files", &["*"])
        .pick_files(move |files| {
            tx.send(files).ok();
        });

    match rx.recv() {
        Ok(Some(paths)) => Ok(paths.iter().map(|p| p.to_string()).collect()),
        Ok(None) => Err("No files selected".to_string()),
        Err(_) => Err("Failed to receive selection".to_string())
    }
}

/// Select JSON files
#[tauri::command]
async fn select_json_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();

    app.dialog()
        .file()
        .add_filter("JSON Files", &["json"])
        .add_filter("All Files", &["*"])
        .pick_files(move |files| {
            tx.send(files).ok();
        });

    match rx.recv() {
        Ok(Some(paths)) => Ok(paths.iter().map(|p| p.to_string()).collect()),
        Ok(None) => Err("No files selected".to_string()),
        Err(_) => Err("Failed to receive selection".to_string())
    }
}

/// Select model files
#[tauri::command]
async fn select_model_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();

    app.dialog()
        .file()
        .add_filter("All Files", &["*"])
        .pick_files(move |files| {
            tx.send(files).ok();
        });

    match rx.recv() {
        Ok(Some(paths)) => Ok(paths.iter().map(|p| p.to_string()).collect()),
        Ok(None) => Err("No files selected".to_string()),
        Err(_) => Err("Failed to receive selection".to_string())
    }
}

/// Show save file dialog and return the selected path
#[tauri::command]
async fn save_file(app: tauri::AppHandle, default_name: String) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel();

    // Determine file type from extension
    let is_json = default_name.to_lowercase().contains(".json");

    let mut dialog = app.dialog()
        .file()
        .set_file_name(&default_name);

    if is_json {
        dialog = dialog.add_filter("JSON Files", &["json"]);
    } else {
        dialog = dialog.add_filter("CSV Files", &["csv"]);
    }
    dialog = dialog.add_filter("All Files", &["*"]);

    dialog.save_file(move |path| {
        tx.send(path).ok();
    });

    match rx.recv() {
        Ok(Some(p)) => Ok(p.to_string()),
        Ok(None) => Err("Save cancelled".to_string()),
        Err(_) => Err("Failed to receive selection".to_string())
    }
}

/// Write content to a file
#[tauri::command]
async fn write_file(file_path: String, content: String) -> Result<(), String> {
    fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write file: {}", e))
}

/// Generate a unique folder name by appending numeric suffix if needed
#[tauri::command]
async fn generate_unique_folder_name(base_path: String, folder_name: String) -> Result<String, String> {
    let base = PathBuf::from(&base_path);

    // Check if base path exists
    if !base.exists() {
        return Err(format!("Base path does not exist: {}", base_path));
    }

    let mut unique_name = folder_name.clone();
    let mut counter = 1;

    loop {
        let test_path = base.join(&unique_name);
        if !test_path.exists() {
            return Ok(unique_name);
        }
        unique_name = format!("{}_{}", folder_name, counter);
        counter += 1;
    }
}

/// Get a free port from the OS
fn get_free_port() -> Option<u16> {
    // Bind to port 0 to let the OS assign a free port
    match TcpListener::bind(("127.0.0.1", 0)) {
        Ok(listener) => {
            match listener.local_addr() {
                Ok(addr) => Some(addr.port()),
                Err(_) => None
            }
        }
        Err(_) => None
    }
}

/// Check if the Dipper backend server is running on the given port
/// Returns true only if the server responds to /health with the expected response
fn check_dipper_backend_running(port: u16) -> bool {
    // Build the health check URL
    let url = format!("http://127.0.0.1:{}/health", port);

    // Try to connect and check the health endpoint with a longer timeout
    match ureq::get(&url).timeout(Duration::from_secs(5)).call() {
        Ok(response) => {
            let status_code = response.status();
            println!("  Health check got HTTP {}", status_code);

            if status_code == 200 {
                // Try to parse the JSON response
                match response.into_string() {
                    Ok(body) => {
                        println!("  Health response body: {}", body);
                        match serde_json::from_str::<serde_json::Value>(&body) {
                            Ok(json) => {
                                // Verify it's the Dipper backend by checking for expected fields
                                let status = json.get("status").and_then(|v| v.as_str());
                                let server_type = json.get("server_type").and_then(|v| v.as_str());

                                println!("  Parsed: status={:?}, server_type={:?}", status, server_type);

                                if status == Some("ok") && server_type == Some("lightweight") {
                                    println!("  ✓ Valid Dipper backend detected!");
                                    return true;
                                } else {
                                    println!("  ✗ Response doesn't match Dipper backend signature");
                                }
                            }
                            Err(e) => {
                                println!("  ✗ Failed to parse JSON: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        println!("  ✗ Failed to read response body: {}", e);
                    }
                }
            } else {
                println!("  ✗ Unexpected status code: {}", status_code);
            }
            false
        }
        Err(e) => {
            println!("  ✗ Connection failed: {}", e);
            false
        }
    }
}

/// Wait for the Dipper backend to be ready on the given port
fn wait_for_server(port: u16, max_retries: u32) -> bool {
    for i in 0..max_retries {
        if check_dipper_backend_running(port) {
            println!("✓ Dipper backend health check passed on port {}!", port);
            return true;
        }
        if i < 3 || i % 5 == 0 {
            // Only print every 5th attempt after the first 3 to reduce spam
            println!("⏳ Checking backend health on port {}... (attempt {}/{})", port, i + 1, max_retries);
        }
        thread::sleep(Duration::from_secs(2));
    }
    eprintln!("✗ Backend health check timed out after {} attempts", max_retries);
    false
}

/// Tauri command to get the backend server port
#[tauri::command]
async fn get_backend_port(state: tauri::State<'_, BackendState>) -> Result<u16, String> {
    state.port.lock().unwrap()
        .ok_or_else(|| "Backend port not initialized".to_string())
}

/// Start the backend HTTP server using Tauri's sidecar mechanism (non-blocking)
fn start_backend_server(app: &tauri::AppHandle, port: u16) -> Option<tauri_plugin_shell::process::CommandChild> {
    println!("Starting Dipper backend sidecar on port {}...", port);

    // Use Tauri's sidecar API to spawn the bundled executable
    let sidecar = match app.shell().sidecar("lightweight_server") {
        Ok(cmd) => {
            println!("  Sidecar command created successfully");
            cmd
        }
        Err(e) => {
            eprintln!("✗ Failed to create sidecar command: {}", e);
            eprintln!("  Make sure the binary exists in src-tauri/bin/lightweight_server-*");
            return None;
        }
    };

    println!("  Spawning with args: --port {}", port);

    match sidecar
        .args(["--port", &port.to_string()])
        .spawn()
    {
        Ok((mut rx, child)) => {
            println!("✓ Dipper backend sidecar spawned (PID: {:?})", child.pid());

            // Spawn a thread to read backend output using blocking receiver
            std::thread::spawn(move || {
                use tauri_plugin_shell::process::CommandEvent;
                loop {
                    match rx.blocking_recv() {
                        Some(event) => {
                            match event {
                                CommandEvent::Stdout(line) => {
                                    println!("  [Backend stdout] {}", String::from_utf8_lossy(&line));
                                }
                                CommandEvent::Stderr(line) => {
                                    eprintln!("  [Backend stderr] {}", String::from_utf8_lossy(&line));
                                }
                                CommandEvent::Error(err) => {
                                    eprintln!("  [Backend error] {}", err);
                                }
                                CommandEvent::Terminated(payload) => {
                                    println!("  [Backend terminated] code: {:?}", payload.code);
                                    break;
                                }
                                _ => {}
                            }
                        }
                        None => {
                            println!("  [Backend output stream closed]");
                            break;
                        }
                    }
                }
            });

            Some(child)
        }
        Err(e) => {
            eprintln!("✗ Failed to spawn Dipper backend sidecar: {}", e);
            eprintln!("  Error details: {:?}", e);
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .manage(BackendState {
            port: Mutex::new(None),
            process: Mutex::new(None),
        })
        .setup(|app| {
            // Get window handles
            let splash_window = app.get_webview_window("splash").expect("Splash window not found");
            let main_window = app.get_webview_window("main").expect("Main window not found");

            // Load splash HTML content
            let splash_html = r#"
<!DOCTYPE html>
<html>

<head>
    <meta charset="UTF-8">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Rokkitt', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #395756 0%, #4f5d75 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            overflow: hidden;
        }

        .splash-container {
            text-align: center;
            color: white;
        }

        .logo {
            font-size: 64px;
            font-weight: 600;
            margin-bottom: 10px;
            color: #ffffff;
        }

        .subtitle {
            font-size: 18px;
            color: #c6ac8f;
            margin-bottom: 10px;
            margin-top: 10px;
            font-weight: 300;
        }

        .loader {
            width: 40px;
            height: 40px;
            border: 4px solid rgba(255, 255, 255, 0.3);
            border-top: 4px solid #ffffff;
            border-radius: 50%;
            margin: 0 auto;
            animation: spin 1s linear infinite;
        }

        .status {
            margin-top: 20px;
            font-size: 14px;
            color: rgba(255, 255, 255, 0.8);
            font-weight: 300;
        }

        @keyframes spin {
            0% {
                transform: rotate(0deg);
            }

            100% {
                transform: rotate(360deg);
            }
        }
    </style>
</head>

<body>
    <div class="splash-container">
        <img src="./icon.svg" alt="Dipper Logo" class="logo" width="200" height="200">
        <div class="subtitle">Dipper is booting...</div>
        <div class="loader"></div>
    </div>
</body>

</html>
"#;
            splash_window.eval(&format!("document.documentElement.innerHTML = `{}`;", splash_html.replace("`", "\\`")))
                .expect("Failed to load splash HTML");

            // Show splash screen immediately
            splash_window.show().expect("Failed to show splash window");

            // Check if Dipper backend is already running on port 8000 (for dev mode with manual backend)
            let (port, child_process) = if check_dipper_backend_running(8000) {
                println!("✓ Using existing Dipper backend on port 8000 (dev mode)");
                (8000, None)
            } else {
                // Get a free port from the OS
                let free_port = get_free_port().expect("Failed to get free port");
                println!("→ No backend found on port 8000, starting on port {}", free_port);

                // Start our own backend
                let child = start_backend_server(&app.handle(), free_port);

                if child.is_none() {
                    eprintln!("✗ Failed to start backend server on port {}", free_port);
                    eprintln!("  Check that the sidecar binary exists in src-tauri/bin/");
                    // Continue anyway - app will show connection error
                } else {
                    println!("✓ Backend started successfully on port {}", free_port);
                }

                (free_port, child)
            };

            // Store port and process in managed state
            let backend_state: tauri::State<BackendState> = app.state();
            *backend_state.port.lock().unwrap() = Some(port);
            *backend_state.process.lock().unwrap() = child_process;

            // Clone handles for background thread
            let main_window_clone = main_window.clone();
            let splash_window_clone = splash_window.clone();

            // Wait for backend server in background thread
            thread::spawn(move || {
                println!("Waiting for backend server to be ready on port {}...", port);
                if wait_for_server(port, 30) {
                    println!("✓ Backend server is ready!");
                    // Show main window and close splash
                    main_window_clone.show().expect("Failed to show main window");
                    splash_window_clone.close().expect("Failed to close splash window");
                } else {
                    eprintln!("✗ Backend server health check timed out - showing main window anyway");
                    eprintln!("  (Backend may still be starting up and will work shortly)");
                    main_window_clone.show().expect("Failed to show main window");
                    splash_window_clone.close().expect("Failed to close splash window");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Kill the backend server when window closes
                println!("Window close event - cleaning up backend...");
                let app = window.app_handle();
                let state: tauri::State<BackendState> = app.state();
                let mut guard = state.process.lock().unwrap();
                if let Some(child) = guard.take() {
                    println!("Killing backend server on window close...");
                    let _ = child.kill();
                    println!("✓ Backend server terminated");
                } else {
                    println!("No backend process to terminate (may be manual mode)");
                }
                drop(guard);
            }
        })
        .invoke_handler(tauri::generate_handler![
            select_files,
            select_folder,
            select_csv_files,
            select_text_files,
            select_json_files,
            select_model_files,
            save_file,
            write_file,
            generate_unique_folder_name,
            get_backend_port
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Handle app-wide exit event to ensure backend cleanup
            if let tauri::RunEvent::Exit = event {
                println!("App exit event - cleaning up backend...");
                let state: tauri::State<BackendState> = app_handle.state();
                let mut guard = state.process.lock().unwrap();
                if let Some(child) = guard.take() {
                    println!("Killing backend server on app exit...");
                    let _ = child.kill();
                    println!("✓ Backend server terminated");
                } else {
                    println!("No backend process to terminate");
                }
                drop(guard);
            }
        });
}
