use std::net::{SocketAddr, TcpStream};
use std::time::Duration;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewBuilder, WebviewUrl,
};

/// Check if a local port is currently open and reachable
#[tauri::command]
fn check_port_active(port: u16) -> bool {
    let address: Result<SocketAddr, _> = format!("127.0.0.1:{}", port).parse();
    if let Ok(addr) = address {
        TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
    } else {
        false
    }
}

#[tauri::command]
fn app_minimize(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.minimize();
    }
}

#[tauri::command]
fn app_toggle_maximize(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if let Ok(is_max) = w.is_maximized() {
            if is_max {
                let _ = w.unmaximize();
            } else {
                let _ = w.maximize();
            }
        }
    }
}

#[tauri::command]
fn app_close(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.close();
    }
}

#[tauri::command]
fn app_open_devtools(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        w.open_devtools();
    }
}

#[tauri::command]
fn navigate_browser_view(app: AppHandle, url: String) -> Result<(), String> {
    let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
    if let Some(webview) = app.get_webview("browser-viewport") {
        let _ = webview.show();
        let _ = webview.set_focus();
        webview.navigate(parsed_url).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn update_browser_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview("browser-viewport") {
        let _ = webview.set_position(LogicalPosition::new(x, y));
        let _ = webview.set_size(LogicalSize::new(width, height));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if let Some(window) = app.get_window("main") {
                let initial_url = Url::parse("https://duckduckgo.com").unwrap();
                let builder = WebviewBuilder::new(
                    "browser-viewport",
                    WebviewUrl::External(initial_url),
                )
                .auto_resize();

                let _ = window.add_child(
                    builder,
                    LogicalPosition::new(0., 80.),
                    LogicalSize::new(1280., 760.),
                );
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_port_active,
            app_minimize,
            app_toggle_maximize,
            app_close,
            app_open_devtools,
            navigate_browser_view,
            update_browser_bounds
        ])
        .run(tauri::generate_context!())
        .expect("error while running AuraView application");
}
