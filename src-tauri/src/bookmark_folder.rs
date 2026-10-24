use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl, Window, window::WindowBuilder};

const LABEL: &str = "bookmark-folder";
static FOLDER: Mutex<Option<OpenFolder>> = Mutex::new(None);

#[derive(Clone, Copy, serde::Deserialize)]
pub struct FolderAnchor { x: f64, y: f64, width: f64, height: f64 }
impl FolderAnchor {
    fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height].iter().all(|value| value.is_finite()) && self.width > 0.0 && self.height > 0.0
    }
    fn contains(self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}
struct OpenFolder { id: String, anchor: Option<FolderAnchor> }

fn should_toggle(current: Option<&str>, requested: &str, popup_exists: bool) -> bool {
    popup_exists && current == Some(requested)
}

fn opener_pressed(anchor: FolderAnchor, pointer: (f64, f64), left_pressed: bool) -> bool {
    left_pressed && anchor.contains(pointer.0, pointer.1)
}

// Mouse activation reaches the native focus handler before the toolbar's
// click event. Keep the popup alive on its own opener so that click can close
// it; dismiss normally for interactions elsewhere in the main window.
pub fn main_focused(window: &Window) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
        let anchor = FOLDER.lock().unwrap().as_ref().and_then(|folder| folder.anchor);
        if let Some(anchor) = anchor {
            if let (Ok(cursor), Ok(origin), Ok(scale)) = (window.cursor_position(), window.inner_position(), window.scale_factor()) {
                if opener_pressed(anchor, ((cursor.x - origin.x as f64) / scale, (cursor.y - origin.y as f64) / scale), unsafe { GetAsyncKeyState(0x01) < 0 }) { return Ok(()); }
            }
        }
    }
    close(window.app_handle())
}

pub fn close(app: &AppHandle) -> Result<(), String> {
    *FOLDER.lock().unwrap() = None;
    if let Some(window) = app.get_window(LABEL) { window.destroy().map_err(|error| error.to_string())?; }
    Ok(())
}

#[tauri::command]
pub async fn show_bookmark_folder(app: AppHandle, window: Window, folder_id: String, x: f64, y: f64, height: f64, anchor: Option<FolderAnchor>) -> Result<(), String> {
    if window.label() != "main" || !x.is_finite() || !y.is_finite() || !height.is_finite() || anchor.is_some_and(|anchor| !anchor.valid()) { return Err("Invalid bookmark folder request".into()); }
    let toggle = should_toggle(FOLDER.lock().unwrap().as_ref().map(|folder| folder.id.as_str()), &folder_id, app.get_window(LABEL).is_some());
    if toggle { return close(&app); }
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let origin = window.inner_position().map_err(|error| error.to_string())?.to_logical::<f64>(scale);
    let size = window.inner_size().map_err(|error| error.to_string())?.to_logical::<f64>(scale);
    let width = 300.0_f64.min(size.width);
    let height = height.clamp(82.0, 400.0).min(size.height);
    let left = origin.x + x.clamp(0.0, (size.width - width).max(0.0));
    let top = origin.y + y.clamp(0.0, (size.height - height).max(0.0));
    *FOLDER.lock().unwrap() = Some(OpenFolder { id: folder_id.clone(), anchor });
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
    FOLDER.lock().unwrap().as_ref().map(|folder| folder.id.clone()).ok_or_else(|| "No bookmark folder is open".into())
}

#[tauri::command]
pub async fn close_bookmark_folder(app: AppHandle) -> Result<(), String> { close(&app) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_folder_clicks_toggle_only_an_existing_matching_popup() {
        assert!(should_toggle(Some("one"), "one", true));
        assert!(!should_toggle(Some("one"), "two", true));
        assert!(!should_toggle(Some("one"), "one", false));
        assert!(!should_toggle(None, "one", true));
    }
    #[test]
    fn opener_bounds_preserve_mouse_activation_without_suppressing_outside_dismissal() {
        let anchor = FolderAnchor { x: 20.0, y: 60.0, width: 100.0, height: 28.0 };
        assert!(anchor.valid());
        assert!(anchor.contains(20.0, 60.0));
        assert!(anchor.contains(119.0, 87.0));
        assert!(!anchor.contains(120.0, 70.0));
        assert!(!anchor.contains(80.0, 90.0));
        assert!(opener_pressed(anchor, (80.0, 70.0), true));
        assert!(!opener_pressed(anchor, (80.0, 70.0), false));
        assert!(!opener_pressed(anchor, (80.0, 100.0), true));
        assert!(!FolderAnchor { width: f64::NAN, ..anchor }.valid());
        assert!(!FolderAnchor { height: 0.0, ..anchor }.valid());
    }
}
