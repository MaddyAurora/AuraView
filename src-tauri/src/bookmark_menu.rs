use tauri::{AppHandle, Emitter, LogicalPosition, Window, menu::{ContextMenu, Menu, MenuItem}};

const PREFIX: &str = "bookmark-menu:";

#[derive(serde::Deserialize)]
pub struct BookmarkMenuItem {
    id: String,
    label: String,
    enabled: Option<bool>,
}

pub fn selected(app: &AppHandle, id: &str) {
    if let Some(action) = id.strip_prefix(PREFIX) {
        let _ = app.emit_to("main", "bookmark-menu-select", action);
    }
}

#[tauri::command]
pub async fn show_bookmark_menu(app: AppHandle, window: Window, x: f64, y: f64, items: Vec<BookmarkMenuItem>) -> Result<(), String> {
    if !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 { return Err("Invalid bookmark menu position".into()); }
    let menu = Menu::new(&app).map_err(|error| error.to_string())?;
    for item in items {
        let label = item.label.chars().map(|c| if c.is_control() { ' ' } else { c }).take(140).collect::<String>().replace('&', "&&");
        let entry = MenuItem::with_id(&app, format!("{PREFIX}{}", item.id), label, item.enabled.unwrap_or(true), None::<&str>)
            .map_err(|error| error.to_string())?;
        menu.append(&entry).map_err(|error| error.to_string())?;
    }
    menu.popup_at(window, LogicalPosition::new(x, y)).map_err(|error| error.to_string())
}
