use std::sync::Mutex;
use tauri::{window::WindowBuilder, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager,
    Webview, WebviewBuilder, WebviewUrl, Window, WindowEvent};

const LABEL: &str = "tab-overflow";
static OPERATION: tauri::async_runtime::Mutex<()> = tauri::async_runtime::Mutex::const_new(());
static STATE: Mutex<PopupState> = Mutex::new(PopupState { snapshot: None, anchor: None, request: 0, opening_id: 0, presented: false });

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverflowPage { title: String, url: String, favicon: Option<String>, is_loading: bool, is_muted: bool }
#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct OverflowTab { id: String, title: String, pages: Vec<OverflowPage> }
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot { tabs: Vec<OverflowTab>, active_tab_id: String, request_id: u64, opening_id: u64 }
#[derive(Clone, Copy, serde::Deserialize)]
pub struct Anchor { x: f64, y: f64, width: f64, height: f64 }
impl Anchor {
    fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height].iter().all(|n| n.is_finite()) && self.width > 0.0 && self.height > 0.0
    }
    fn contains(self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}
struct PopupState { snapshot: Option<Snapshot>, anchor: Option<Anchor>, request: u64, opening_id: u64, presented: bool }
impl PopupState {
    fn update(&mut self, tabs: Vec<OverflowTab>, active_tab_id: String) -> Snapshot {
        self.request += 1;
        let snapshot = Snapshot { tabs, active_tab_id, request_id: self.request, opening_id: self.opening_id };
        self.snapshot = Some(snapshot.clone());
        snapshot
    }
    fn can_select(&self, request: u64, id: &str) -> bool {
        // Metadata can change between a pointer press and its click. Accept the
        // stable ID from this opening if it still exists in the latest list.
        self.snapshot.as_ref().is_some_and(|s| request >= s.opening_id && request <= s.request_id
            && s.tabs.iter().any(|tab| tab.id == id))
    }
    fn should_dismiss_for_focus(&self, opening: u64, popup_active: bool, opener_pressed: bool) -> bool {
        self.presented && self.snapshot.as_ref().is_some_and(|s| s.opening_id == opening)
            && !popup_active && !opener_pressed
    }
}
fn authorize(view: &Webview, label: &str) -> Result<(), String> {
    if view.label() == label { Ok(()) } else { Err("Open the tabs menu from AuraView".into()) }
}
fn validate(tabs: &[OverflowTab], active: &str) -> Result<(), String> {
    super::browser_label(active, "primary")?;
    for tab in tabs {
        super::browser_label(&tab.id, "primary")?;
        if tab.pages.is_empty() || tab.pages.len() > 2 { return Err("Invalid tab pages".into()); }
    }
    Ok(())
}

pub fn dismiss(app: &AppHandle, restore_focus: bool) {
    let closed = {
        let mut state = STATE.lock().unwrap();
        state.anchor = None;
        state.presented = false;
        state.snapshot.take()
    };
    if let Some(popup) = app.get_window(LABEL) { let _ = popup.hide(); }
    let Some(closed) = closed else { return };
    let _ = app.emit_to(LABEL, "tab-overflow-dismissed", closed.opening_id);
    if restore_focus {
        if let Some(main) = app.get_window("main") { let _ = main.set_focus(); }
        if let Some(view) = app.get_webview("main") { let _ = view.set_focus(); }
    }
    let _ = app.emit_to("main", "tab-overflow-closed", serde_json::json!({"restoreFocus":restore_focus}));
}
fn opener_pressed(app: &AppHandle) -> bool {
    #[cfg(windows)]
    {
        let anchor = STATE.lock().unwrap().anchor;
        if let (Some(anchor), Some(main)) = (anchor, app.get_window("main")) {
            if let (Ok(cursor), Ok(origin), Ok(scale)) = (main.cursor_position(), main.inner_position(), main.scale_factor()) {
                return anchor.contains((cursor.x - origin.x as f64) / scale, (cursor.y - origin.y as f64) / scale)
                    && unsafe { windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(0x01) < 0 };
            }
        }
    }
    let _ = app;
    false
}
fn check_focus(app: &AppHandle) {
    let opening = STATE.lock().unwrap().snapshot.as_ref().map(|s| s.opening_id);
    let Some(opening) = opening else { return };
    let handle = app.clone();
    // Window focus events also fire while WebView2 takes keyboard focus inside
    // the popup. Check the foreground window after queued focus work settles.
    tauri::async_runtime::spawn(async move {
        let app = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            let Some(popup) = app.get_window(LABEL) else { return };
            #[cfg(windows)]
            let popup_active = {
                let foreground = unsafe { windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow() };
                // A missing foreground handle can be a transient activation gap.
                if foreground.0.is_null() { return; }
                let Ok(hwnd) = popup.hwnd() else { return };
                foreground.0 == hwnd.0
            };
            #[cfg(not(windows))]
            let popup_active = popup.is_focused().unwrap_or(true);
            let pressed = opener_pressed(&app);
            let dismiss_menu = STATE.lock().unwrap().should_dismiss_for_focus(opening, popup_active, pressed);
            if dismiss_menu { dismiss(&app, false); }
        });
    });
}
pub fn main_focused(window: &Window) {
    check_focus(window.app_handle());
}

fn popup_bounds(anchor: Anchor, count: usize, left: f64, top: f64, right: f64, bottom: f64) -> (f64, f64, f64, f64) {
    let width = 360.0_f64.min((right - left - 16.0).max(1.0));
    let x = (anchor.x + anchor.width - width).clamp(left + 8.0, (right - width - 8.0).max(left + 8.0));
    let y = (anchor.y + anchor.height + 4.0).clamp(top + 8.0, (bottom - 8.0).max(top + 8.0));
    let height = (54.0 + count as f64 * 52.0).min((bottom - y - 8.0).max(1.0));
    (x, y, width, height)
}
fn place(app: &AppHandle, popup: &Window, anchor: Anchor, count: usize) -> Result<(), String> {
    let main = app.get_window("main").ok_or("Main window is not ready")?;
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let origin = main.inner_position().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
    let size = main.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
    let (mut left, mut top, mut right, mut bottom) = (0.0_f64, 0.0_f64, size.width, size.height);
    if let Some(monitor) = main.current_monitor().map_err(|e| e.to_string())? {
        let area = monitor.work_area();
        let position = area.position.to_logical::<f64>(scale);
        let size = area.size.to_logical::<f64>(scale);
        left = left.max(position.x - origin.x); top = top.max(position.y - origin.y);
        right = right.min(position.x + size.width - origin.x); bottom = bottom.min(position.y + size.height - origin.y);
    }
    let (x, y, width, height) = popup_bounds(anchor, count, left, top, right, bottom);
    popup.set_position(LogicalPosition::new(origin.x + x, origin.y + y)).map_err(|e| e.to_string())?;
    popup.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn show_tab_overflow(app: AppHandle, webview: Webview, window: Window, tabs: Vec<OverflowTab>, active_tab_id: String, anchor: Anchor) -> Result<(), String> {
    authorize(&webview, "main")?;
    if window.label() != "main" || !anchor.valid() { return Err("Invalid tab menu position".into()); }
    validate(&tabs, &active_tab_id)?;
    let _operation = OPERATION.lock().await;
    if tabs.is_empty() { dismiss(&app, false); return Ok(()); }
    crate::downloads_preview::hide(&app);
    crate::browser_settings::dismiss(&app);
    crate::bookmark_folder::close(&app)?;
    let snapshot = {
        let mut state = STATE.lock().unwrap();
        state.anchor = Some(anchor);
        state.opening_id = state.request + 1;
        state.presented = false;
        state.update(tabs, active_tab_id)
    };
    let result = (|| -> Result<(), String> {
        let popup = if let Some(popup) = app.get_window(LABEL) { popup } else {
            let popup = WindowBuilder::new(&app, LABEL).title("More tabs").inner_size(360.0, 106.0)
                .decorations(false).resizable(false).skip_taskbar(true).visible(false).focused(false)
                .parent(&window).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
            let handle = app.clone();
            popup.on_window_event(move |event| {
                if matches!(event, WindowEvent::Focused(false)) { check_focus(&handle); }
                if let WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); dismiss(&handle, true); }
            });
            if let Err(error) = popup.add_child(WebviewBuilder::new(LABEL, WebviewUrl::App("index.html#tab-overflow".into())).focused(false).auto_resize(),
                LogicalPosition::new(0.0, 0.0), LogicalSize::new(360.0, 106.0)) {
                let _ = popup.destroy(); return Err(error.to_string());
            }
            popup
        };
        place(&app, &popup, anchor, snapshot.tabs.len())?;
        // Show only after the UI renders this snapshot. Late acknowledgements
        // after dismissal must not resurrect the menu.
        app.emit_to(LABEL, "tab-overflow-updated", snapshot).map_err(|e| e.to_string())
    })();
    if result.is_err() { dismiss(&app, false); }
    result
}
#[tauri::command]
pub async fn update_tab_overflow(app: AppHandle, webview: Webview, tabs: Vec<OverflowTab>, active_tab_id: String) -> Result<(), String> {
    authorize(&webview, "main")?;
    validate(&tabs, &active_tab_id)?;
    let _operation = OPERATION.lock().await;
    if tabs.is_empty() { dismiss(&app, false); return Ok(()); }
    let next = {
        let mut state = STATE.lock().unwrap();
        if state.snapshot.is_none() { return Ok(()); }
        state.anchor.map(|anchor| (anchor, state.update(tabs, active_tab_id)))
    };
    if let (Some((anchor, snapshot)), Some(popup)) = (next, app.get_window(LABEL)) {
        place(&app, &popup, anchor, snapshot.tabs.len())?;
        app.emit_to(LABEL, "tab-overflow-updated", snapshot).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn get_tab_overflow(webview: Webview) -> Result<Option<Snapshot>, String> {
    authorize(&webview, LABEL)?;
    Ok(STATE.lock().unwrap().snapshot.clone())
}
#[tauri::command]
pub async fn tab_overflow_ready(app: AppHandle, webview: Webview, request_id: u64) -> Result<(), String> {
    authorize(&webview, LABEL)?;
    let _operation = OPERATION.lock().await;
    let opening = {
        let state = STATE.lock().unwrap();
        let Some(snapshot) = state.snapshot.as_ref().filter(|s| s.request_id == request_id) else { return Ok(()) };
        // A metadata refresh acknowledges new rows but must not activate the
        // native window again while the user is already interacting with it.
        if state.presented { return Ok(()); }
        snapshot.opening_id
    };
    if let Some(popup) = app.get_window(LABEL) {
        popup.show().map_err(|e| e.to_string())?;
        popup.set_focus().map_err(|e| e.to_string())?;
        webview.set_focus().map_err(|e| e.to_string())?;
        let still_open = {
            let mut state = STATE.lock().unwrap();
            let current = state.snapshot.as_ref().is_some_and(|s| s.opening_id == opening);
            if current { state.presented = true; }
            current
        };
        if !still_open { popup.hide().map_err(|e| e.to_string())?; }
    }
    Ok(())
}
#[tauri::command]
pub async fn close_tab_overflow(app: AppHandle, webview: Webview, restore_focus: bool, opening_id: Option<u64>) -> Result<(), String> {
    if !matches!(webview.label(), "main" | LABEL) { return Err("Not a tabs menu".into()); }
    let _operation = OPERATION.lock().await;
    if opening_id.is_some_and(|id| STATE.lock().unwrap().snapshot.as_ref().is_none_or(|s| s.opening_id != id)) {
        return Ok(());
    }
    dismiss(&app, restore_focus);
    Ok(())
}
#[tauri::command]
pub async fn select_overflow_tab(app: AppHandle, webview: Webview, tab_id: String, request_id: u64) -> Result<(), String> {
    authorize(&webview, LABEL)?;
    if !STATE.lock().unwrap().can_select(request_id, &tab_id) { return Err("This tab menu has changed. Select the tab again.".into()); }
    dismiss(&app, true);
    app.emit_to("main", "tab-overflow-select", tab_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_overflow_tab(app: AppHandle, webview: Webview, tab_id: String, request_id: u64) -> Result<(), String> {
    authorize(&webview, LABEL)?;
    if !STATE.lock().unwrap().can_select(request_id, &tab_id) { return Err("This tab menu has changed. Select the tab again.".into()); }
    // Let the main session close the listed group and its native views without
    // selecting it. Its updated hidden-tab list keeps this popup in sync.
    app.emit_to("main", "tab-overflow-close-tab", tab_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn internal_focus_handoffs_keep_the_menu_open_but_outside_activation_dismisses_it() {
        let mut state = PopupState { snapshot: None, anchor: None, request: 0, opening_id: 1, presented: false };
        let tab = OverflowTab { id: "one".into(), title: "One".into(), pages: vec![] };
        state.update(vec![tab.clone()], "one".into());
        assert!(!state.should_dismiss_for_focus(1, false, false), "hidden popup creation must not count as leaving the menu");
        state.presented = true;
        assert!(!state.should_dismiss_for_focus(1, true, false), "WebView2 child focus remains inside the active popup");
        assert!(!state.should_dismiss_for_focus(1, false, true), "the opener click owns its toggle action");
        assert!(state.should_dismiss_for_focus(1, false, false), "a page click or another app really leaves the menu");
        state.update(vec![tab.clone()], "one".into());
        assert!(!state.should_dismiss_for_focus(1, true, false), "background title updates retain focus");
        state.snapshot = None;
        assert!(!state.should_dismiss_for_focus(1, false, false), "closing cannot dismiss twice");
        state.opening_id = state.request + 1;
        let next = state.update(vec![tab], "one".into());
        assert!(!state.should_dismiss_for_focus(1, false, false), "queued events from the old opening cannot close the new one");
        assert!(state.should_dismiss_for_focus(next.opening_id, false, false));
    }
    #[test]
    fn scrolling_popup_fits_below_the_opener_and_stops_at_the_work_area() {
        let anchor = Anchor { x: 940.0, y: 4.0, width: 36.0, height: 32.0 };
        assert!(anchor.valid());
        assert!(!Anchor { width: f64::NAN, ..anchor }.valid());
        assert!(anchor.contains(950.0, 20.0));
        assert!(!anchor.contains(976.0, 20.0));
        assert_eq!(popup_bounds(anchor, 100, 0.0, 0.0, 1000.0, 700.0), (616.0, 40.0, 360.0, 652.0));
        assert_eq!(popup_bounds(anchor, 1, 0.0, 0.0, 1000.0, 700.0).3, 106.0);
        let (x, y, width, height) = popup_bounds(anchor, 100, 100.0, 0.0, 600.0, 500.0);
        assert!(x >= 108.0 && x + width <= 592.0 && y + height <= 492.0);
    }
    #[test]
    fn metadata_updates_preserve_selection_but_old_openings_and_removed_tabs_are_rejected() {
        let mut state = PopupState { snapshot: None, anchor: None, request: 0, opening_id: 1, presented: false };
        let tab = OverflowTab { id: "one".into(), title: "Music & video\t日本語 🎵".into(), pages: vec![] };
        let first = state.update(vec![tab.clone()], "one".into());
        assert!(state.can_select(first.request_id, "one"));
        assert!(!state.can_select(first.request_id, "missing"));
        let second = state.update(vec![tab.clone()], "one".into());
        assert!(state.can_select(first.request_id, "one"));
        assert!(state.can_select(second.request_id, "one"));
        assert_eq!(second.tabs[0].title, "Music & video\t日本語 🎵");
        state.snapshot = None;
        assert!(!state.can_select(second.request_id, "one"));
        state.opening_id = state.request + 1;
        let third = state.update(vec![tab], "one".into());
        assert!(!state.can_select(second.request_id, "one"));
        assert!(state.can_select(third.request_id, "one"));
        state.update(vec![], "one".into());
        assert!(!state.can_select(third.request_id, "one"));
    }
}
