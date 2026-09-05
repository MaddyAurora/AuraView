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
fn app_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn app_toggle_maximize(window: tauri::Window) {
    if let Ok(is_max) = window.is_maximized() {
        if is_max {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
fn app_close(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
async fn navigate_browser_view(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

    if let Some(webview) = app.get_webview("browser-viewport") {
        let _ = webview.set_position(LogicalPosition::new(x, y));
        let _ = webview.set_size(LogicalSize::new(width, height));
        let _ = webview.show();
        let _ = webview.set_focus();
        webview.navigate(parsed_url).map_err(|e| e.to_string())?;
    } else {
        let window = app
            .get_window("main")
            .ok_or_else(|| "Main window not found".to_string())?;
        let builder = WebviewBuilder::new("browser-viewport", WebviewUrl::External(parsed_url))
            .auto_resize();
        window
            .add_child(
                builder,
                LogicalPosition::new(x, y),
                LogicalSize::new(width, height),
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn navigate_split_view(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

    if let Some(webview) = app.get_webview("browser-viewport-split") {
        let _ = webview.set_position(LogicalPosition::new(x, y));
        let _ = webview.set_size(LogicalSize::new(width, height));
        let _ = webview.show();
        webview.navigate(parsed_url).map_err(|e| e.to_string())?;
    } else {
        let window = app
            .get_window("main")
            .ok_or_else(|| "Main window not found".to_string())?;
        let builder =
            WebviewBuilder::new("browser-viewport-split", WebviewUrl::External(parsed_url))
                .auto_resize();
        window
            .add_child(
                builder,
                LogicalPosition::new(x, y),
                LogicalSize::new(width, height),
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn close_split_view(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview("browser-viewport-split") {
        let _ = webview.close();
    }
    Ok(())
}

#[tauri::command]
async fn update_browser_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    split_active: bool,
) -> Result<(), String> {
    if split_active {
        let half_width = width / 2.0;
        if let Some(webview1) = app.get_webview("browser-viewport") {
            let _ = webview1.set_position(LogicalPosition::new(x, y));
            let _ = webview1.set_size(LogicalSize::new(half_width, height));
        }
        if let Some(webview2) = app.get_webview("browser-viewport-split") {
            let _ = webview2.set_position(LogicalPosition::new(x + half_width, y));
            let _ = webview2.set_size(LogicalSize::new(half_width, height));
        }
    } else {
        if let Some(webview1) = app.get_webview("browser-viewport") {
            let _ = webview1.set_position(LogicalPosition::new(x, y));
            let _ = webview1.set_size(LogicalSize::new(width, height));
        }
        if let Some(webview2) = app.get_webview("browser-viewport-split") {
            let _ = webview2.close();
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            check_port_active,
            app_minimize,
            app_toggle_maximize,
            app_close,
            navigate_browser_view,
            navigate_split_view,
            close_split_view,
            update_browser_bounds
        ])
        .run(tauri::generate_context!())
        .expect("error while running AuraView application");
}
