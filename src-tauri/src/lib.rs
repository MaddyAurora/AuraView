use std::net::{SocketAddr, TcpStream};
use std::time::Duration;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewBuilder, WebviewUrl,
};

fn log_debug(msg: &str) {
    use std::io::Write;
    let path = "b:/AIB/AuraView/auraview_debug.log";
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "[DEBUG] {}", msg);
    }
}

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
fn log_client_event(msg: String) {
    log_debug(&format!("CLIENT_EVENT: {}", msg));
}

#[tauri::command]
fn app_minimize(app: AppHandle) {
    log_debug("app_minimize CALLED");
    if let Some(w) = app.get_window("main") {
        log_debug("app_minimize: found window 'main'");
        let res = w.minimize();
        log_debug(&format!("app_minimize result: {:?}", res));
    } else {
        log_debug("app_minimize: window 'main' NOT FOUND");
    }
}

#[tauri::command]
fn app_toggle_maximize(app: AppHandle) -> bool {
    log_debug("app_toggle_maximize CALLED");
    if let Some(w) = app.get_window("main") {
        if let Ok(is_max) = w.is_maximized() {
            if is_max {
                let _ = w.unmaximize();
                log_debug("app_toggle_maximize: unmaximized");
                return false;
            } else {
                let _ = w.maximize();
                log_debug("app_toggle_maximize: maximized");
                return true;
            }
        }
    }
    false
}

#[tauri::command]
fn app_is_maximized(app: AppHandle) -> bool {
    if let Some(w) = app.get_window("main") {
        w.is_maximized().unwrap_or(false)
    } else {
        false
    }
}

#[tauri::command]
fn app_close(app: AppHandle) {
    log_debug("app_close CALLED");
    if let Some(w) = app.get_window("main") {
        log_debug("app_close: closing window 'main'");
        let _ = w.close();
    }
    log_debug("app_close: exiting app");
    app.exit(0);
}

#[tauri::command]
fn app_start_dragging(app: AppHandle) {
    log_debug("app_start_dragging CALLED");
    if let Some(w) = app.get_window("main") {
        let res = w.start_dragging();
        log_debug(&format!("app_start_dragging result: {:?}", res));
    } else {
        log_debug("app_start_dragging: window 'main' NOT FOUND");
    }
}

#[tauri::command]
fn app_open_devtools(app: AppHandle) {
    log_debug("app_open_devtools CALLED");
    if let Some(w) = app.get_webview("main") {
        if w.is_devtools_open() {
            log_debug("app_open_devtools: closing devtools on 'main'");
            w.close_devtools();
        } else {
            log_debug("app_open_devtools: opening devtools on 'main'");
            w.open_devtools();
        }
    }
}

#[tauri::command]
fn navigate_browser_view(app: AppHandle, url: String) -> Result<(), String> {
    log_debug(&format!("navigate_browser_view to: {}", url));
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
            log_debug("=== SETUP START ===");
            for (label, _) in app.windows() {
                log_debug(&format!("Found window: {}", label));
            }
            for (label, _) in app.webviews() {
                log_debug(&format!("Found webview: {}", label));
            }

            if let Some(window) = app.get_window("main") {
                log_debug("Adding child webview browser-viewport to main window");
                let initial_url = Url::parse("https://duckduckgo.com").unwrap();
                let builder = WebviewBuilder::new(
                    "browser-viewport",
                    WebviewUrl::External(initial_url),
                );

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
            log_client_event,
            app_minimize,
            app_toggle_maximize,
            app_is_maximized,
            app_close,
            app_start_dragging,
            app_open_devtools,
            navigate_browser_view,
            update_browser_bounds
        ])
        .run(tauri::generate_context!())
        .expect("error while running AuraView application");
}
