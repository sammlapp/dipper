// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::process::Child;
use std::thread;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

const HTTP_SERVER_PORT: u16 = 8000;

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

/// Check if the HTTP server is already running
fn check_server_running() -> bool {
    match std::net::TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", HTTP_SERVER_PORT).parse().unwrap(),
        Duration::from_secs(1)
    ) {
        Ok(_) => true,
        Err(_) => false,
    }
}

/// Wait for the server to be ready
fn wait_for_server(max_retries: u32) -> bool {
    for i in 0..max_retries {
        if check_server_running() {
            println!("HTTP server is ready!");
            return true;
        }
        println!("Waiting for HTTP server... ({}/{})", i + 1, max_retries);
        thread::sleep(Duration::from_secs(1));
    }
    eprintln!("HTTP server failed to start within timeout period");
    false
}

/// Start the backend HTTP server using Tauri's sidecar mechanism (non-blocking)
fn start_backend_server(app: &tauri::AppHandle) {
    // Check if server is already running
    if check_server_running() {
        println!("HTTP server already running on port {}", HTTP_SERVER_PORT);
        return;
    }

    println!("Starting HTTP server sidecar...");

    // Use Tauri's sidecar API to spawn the bundled executable
    let sidecar = app.shell().sidecar("lightweight_server").unwrap();

    match sidecar
        .args(["--port", &HTTP_SERVER_PORT.to_string()])
        .spawn()
    {
        Ok(_) => {
            println!("HTTP server sidecar spawned successfully");
        }
        Err(e) => {
            eprintln!("Failed to start HTTP server sidecar: {}", e);
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

            // Start the backend server (non-blocking)
            start_backend_server(&app.handle());

            // Clone handles for background thread
            let main_window_clone = main_window.clone();
            let splash_window_clone = splash_window.clone();

            // Wait for backend server in background thread
            thread::spawn(move || {
                println!("Waiting for backend server to be ready...");
                if wait_for_server(30) {
                    println!("Backend server is ready!");
                    // Show main window and close splash
                    main_window_clone.show().expect("Failed to show main window");
                    splash_window_clone.close().expect("Failed to close splash window");
                } else {
                    eprintln!("Backend server failed to start - showing main window anyway");
                    main_window_clone.show().expect("Failed to show main window");
                    splash_window_clone.close().expect("Failed to close splash window");
                }
            });

            Ok(())
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
            generate_unique_folder_name
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
