use tauri::{AppHandle, Emitter, LogicalPosition, Manager, menu::{CheckMenuItem, ContextMenu, Menu}};

const PREFIX: &str = "tab-overflow:";

#[derive(serde::Deserialize)]
pub struct OverflowTab { id: String, title: String }

fn menu_title(title: &str) -> String {
    // Native menus treat ampersands as mnemonics and tabs as accelerators.
    title.chars().map(|c| if c.is_control() { ' ' } else { c }).take(140)
        .collect::<String>().replace('&', "&&")
}

pub fn selected(app: &AppHandle, id: &str) {
    if let Some(tab_id) = id.strip_prefix(PREFIX) {
        let _ = app.emit_to("main", "tab-overflow-select", tab_id);
    }
}

#[tauri::command]
pub async fn show_tab_overflow(app: AppHandle, tabs: Vec<OverflowTab>, active_tab_id: String, x: f64, y: f64) -> Result<(), String> {
    if tabs.is_empty() { return Ok(()); }
    if !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 { return Err("Invalid tab menu position".into()); }
    let window = app.get_window("main").ok_or("Main window is not ready")?;
    let menu = Menu::new(&app).map_err(|e| e.to_string())?;
    for tab in tabs {
        super::browser_label(&tab.id, "primary")?;
        let item = CheckMenuItem::with_id(&app, format!("{PREFIX}{}", tab.id), menu_title(&tab.title),
            true, tab.id == active_tab_id, None::<&str>).map_err(|e| e.to_string())?;
        menu.append(&item).map_err(|e| e.to_string())?;
    }
    // A native popup stays above all child WebView2 panes and supplies keyboard
    // navigation, scrolling, outside-click dismissal and Escape automatically.
    menu.popup_at(window, LogicalPosition::new(x, y)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn web_page_titles_are_literal_menu_labels() {
        assert_eq!(menu_title("Music & video\tCtrl+Q\nLive"), "Music && video Ctrl+Q Live");
        assert_eq!(menu_title(&"a".repeat(200)).len(), 140);
        assert_eq!(menu_title("日本語 🎵"), "日本語 🎵");
    }
}
