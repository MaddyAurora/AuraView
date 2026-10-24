use std::sync::Mutex;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl, Window, WindowEvent, window::WindowBuilder};

pub const LABEL: &str = "downloads-preview";
#[derive(Clone, Copy, serde::Deserialize)]
pub struct Bounds { x: f64, y: f64, width: f64, height: f64 }
impl Bounds {
    fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height].iter().all(|value| value.is_finite()) && self.width > 0.0 && self.height > 0.0
    }
    fn fit(self, width: f64, height: f64) -> Self {
        let x = self.x.clamp(0.0, (width - 1.0).max(0.0));
        let y = self.y.clamp(0.0, (height - 1.0).max(0.0));
        Self { x, y, width: self.width.min(width - x).max(1.0), height: self.height.min(height - y).max(1.0) }
    }
}
struct PreviewState { bounds: Option<Bounds>, ready: bool, request: u64 }
impl PreviewState {
    fn visible(&self) -> bool { self.bounds.is_some() && self.ready }
    fn update(&mut self, bounds: Option<Bounds>, request: u64) -> bool {
        if request < self.request { return false; }
        self.request = request; self.bounds = bounds; true
    }
}
static STATE: Mutex<PreviewState> = Mutex::new(PreviewState { bounds: None, ready: false, request: 0 });
static UPDATE: tauri::async_runtime::Mutex<()> = tauri::async_runtime::Mutex::const_new(());

// Hide and reuse the passive window. Browser pane bounds are never changed.
pub fn hide(app: &AppHandle) {
    STATE.lock().unwrap().bounds = None;
    if let Some(window) = app.get_window(LABEL) { let _ = window.hide(); }
}

fn apply(app: &AppHandle) -> Result<(), String> {
    let bounds = STATE.lock().unwrap().bounds;
    let Some(bounds) = bounds else { if let Some(window) = app.get_window(LABEL) { window.hide().map_err(|e| e.to_string())?; } return Ok(()); };
    let main = app.get_window("main").ok_or("Main window is not ready")?;
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let origin = main.inner_position().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
    let size = main.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
    let bounds = bounds.fit(size.width, size.height);
    let popup = if let Some(window) = app.get_window(LABEL) { window } else {
        STATE.lock().unwrap().ready = false;
        let window = WindowBuilder::new(app, LABEL).title("Downloads preview")
            .inner_size(bounds.width, bounds.height).position(origin.x + bounds.x, origin.y + bounds.y)
            .decorations(false).resizable(false).skip_taskbar(true).shadow(false)
            .focused(false).focusable(false).visible(false).parent(&main).map_err(|e| e.to_string())?
            .build().map_err(|e| e.to_string())?;
        window.on_window_event(|event| { if matches!(event, WindowEvent::Destroyed) { STATE.lock().unwrap().ready = false; } });
        if let Err(error) = window.set_ignore_cursor_events(true).and_then(|_| window.add_child(
            WebviewBuilder::new(LABEL, WebviewUrl::App("index.html#downloads-preview".into())).focused(false).auto_resize(),
            LogicalPosition::new(0.0, 0.0), LogicalSize::new(bounds.width, bounds.height))) {
            let _ = window.destroy(); return Err(error.to_string());
        }
        window
    };
    popup.set_position(LogicalPosition::new(origin.x + bounds.x, origin.y + bounds.y)).map_err(|e| e.to_string())?;
    popup.set_size(LogicalSize::new(bounds.width, bounds.height)).map_err(|e| e.to_string())?;
    // Loading is asynchronous. A late ready event must not resurrect a preview
    // after the pointer has already left or the user has pinned the panel.
    if STATE.lock().unwrap().visible() { popup.show().map_err(|e| e.to_string())?; }
    else { popup.hide().map_err(|e| e.to_string())?; }
    Ok(())
}

async fn schedule(app: AppHandle) -> Result<(), String> {
    // Serialize updates and read the latest desired state after waiting.
    // Window/WebView2 creation stays on the async command thread, as required
    // by Tauri on Windows; its window APIs dispatch UI work themselves.
    let _update = UPDATE.lock().await;
    apply(&app)
}

#[tauri::command]
pub async fn set_downloads_preview(app: AppHandle, webview: tauri::Webview, window: Window, bounds: Option<Bounds>, request_id: u64) -> Result<(), String> {
    if webview.label() != "main" || window.label() != "main" { return Err("Downloads preview is controlled by AuraView".into()); }
    if bounds.is_some_and(|bounds| !bounds.valid()) { return Err("Invalid downloads preview bounds".into()); }
    if !STATE.lock().unwrap().update(bounds, request_id) { return Ok(()); }
    schedule(app).await
}

#[tauri::command]
pub async fn downloads_preview_ready(app: AppHandle, webview: tauri::Webview, window: Window) -> Result<(), String> {
    if webview.label() != LABEL || window.label() != LABEL { return Err("Not a downloads preview window".into()); }
    STATE.lock().unwrap().ready = true;
    schedule(app).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn late_ready_and_rapid_hover_changes_only_show_the_current_preview() {
        let bounds = Bounds { x: 0.0, y: 70.0, width: 1200.0, height: 210.0 };
        let mut state = PreviewState { bounds: Some(bounds), ready: false, request: 0 };
        assert!(!state.visible());
        state.bounds = None; state.ready = true;
        assert!(!state.visible(), "loading after pointer leave must stay hidden");
        state.bounds = Some(bounds); assert!(state.visible());
        state.bounds = None; assert!(!state.visible());
        state.bounds = Some(bounds); assert!(state.visible(), "an already loaded preview is reusable");
        assert!(state.update(None, 3));
        assert!(!state.update(Some(bounds), 2), "out-of-order open requests must not resurrect a closed preview");
        assert!(!state.visible());
        assert!(state.update(Some(bounds), 4)); assert!(state.visible());
    }
    #[test]
    fn overlay_bounds_are_finite_and_fit_the_existing_client_area() {
        let bounds = Bounds { x: -10.0, y: 70.0, width: 1400.0, height: 210.0 };
        let fitted = bounds.fit(800.0, 200.0);
        assert_eq!((fitted.x, fitted.y, fitted.width, fitted.height), (0.0, 70.0, 800.0, 130.0));
        assert!(bounds.valid());
        assert!(!Bounds { width: f64::NAN, ..bounds }.valid());
        assert!(!Bounds { height: 0.0, ..bounds }.valid());
    }
}
