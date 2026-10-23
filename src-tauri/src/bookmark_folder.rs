use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl, Window, window::WindowBuilder};

const LABEL: &str = "bookmark-folder";
static FOLDER: Mutex<Option<String>> = Mutex::new(None);

pub fn close(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_window(LABEL) { window.destroy().map_err(|error| error.to_string())?; }
    Ok(())
}

#[tauri::command]
pub async fn show_bookmark_folder(app: AppHandle, window: Window, folder_id: String, x: f64, y: f64, height: f64) -> Result<(), String> {
    if window.label() != "main" || !x.is_finite() || !y.is_finite() || !height.is_finite() { return Err("Invalid bookmark folder request".into()); }
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let origin = window.inner_position().map_err(|error| error.to_string())?.to_logical::<f64>(scale);
    let size = window.inner_size().map_err(|error| error.to_string())?.to_logical::<f64>(scale);
    let width = 300.0_f64.min(size.width);
    let height = height.clamp(82.0, 400.0).min(size.height);
    let left = origin.x + x.clamp(0.0, (size.width - width).max(0.0));
    let top = origin.y + y.clamp(0.0, (size.height - height).max(0.0));
    *FOLDER.lock().unwrap() = Some(folder_id.clone());
    if let Some(popup) = app.get_window(LABEL) {
        popup.set_position(LogicalPosition::new(left, top)).map_err(|error| error.to_string())?;
        popup.set_size(LogicalSize::new(width, height)).map_err(|error| error.to_string())?;
        app.emit_to(LABEL, "bookmark-folder-selected", folder_id).map_err(|error| error.to_string())?;
        popup.set_focus().map_err(|error| error.to_string())?;
        if let Some(webview) = app.get_webview(LABEL) { webview.set_focus().map_err(|error| error.to_string())?; }
        return Ok(());
    }
    let popup = WindowBuilder::new(&app, LABEL).title("Bookmark folder").inner_size(width, height)
        .position(left, top).decorations(false).resizable(false).skip_taskbar(true).visible(false)
        .parent(&window).map_err(|error| error.to_string())?.build().map_err(|error| error.to_string())?;
    if let Err(error) = popup.add_child(WebviewBuilder::new(LABEL, WebviewUrl::App("index.html#bookmark-folder".into())).auto_resize(),
        LogicalPosition::new(0.0, 0.0), LogicalSize::new(width, height)) {
        let _ = popup.destroy();
        return Err(error.to_string());
    }
    popup.show().map_err(|error| error.to_string())?;
    popup.set_focus().map_err(|error| error.to_string())?;
    if let Some(webview) = app.get_webview(LABEL) { webview.set_focus().map_err(|error| error.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn get_bookmark_folder(window: Window) -> Result<String, String> {
    if window.label() != LABEL { return Err("Not a bookmark folder window".into()); }
    FOLDER.lock().unwrap().clone().ok_or_else(|| "No bookmark folder is open".into())
}

#[tauri::command]
pub async fn close_bookmark_folder(app: AppHandle) -> Result<(), String> { close(&app) }
