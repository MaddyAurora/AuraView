use tauri::{AppHandle, Emitter, LogicalPosition, Manager, menu::{ContextMenu, Menu, MenuItem}};

const CLOSE_PAGE: &str = "tab-context-close:";

pub fn selected(app: &AppHandle, id: &str) {
    if let Some(page_id) = id.strip_prefix(CLOSE_PAGE) {
        let _ = app.emit_to("main", "tab-context-close-page", page_id);
    }
}

#[tauri::command]
pub async fn show_tab_context_menu(app: AppHandle, page_id: String, x: f64, y: f64, can_close: bool) -> Result<(), String> {
    if !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 { return Err("Invalid tab menu position".into()); }
    super::browser_label(&page_id, "primary")?;
    let window = app.get_window("main").ok_or("Main window is not ready")?;
    let close = MenuItem::with_id(&app, format!("{CLOSE_PAGE}{page_id}"), "Close page", can_close, None::<&str>)
        .map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&app, &[&close]).map_err(|e| e.to_string())?;
    menu.popup_at(window, LogicalPosition::new(x, y)).map_err(|e| e.to_string())
}
