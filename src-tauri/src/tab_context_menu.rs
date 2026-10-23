use tauri::{AppHandle, Emitter, LogicalPosition, Manager, menu::{ContextMenu, Menu, MenuItem, PredefinedMenuItem}};

const PREFIX: &str = "tab-context:";
const ACTIONS: [&str; 7] = ["refresh", "duplicate", "mute", "close", "close-right", "close-left", "reopen"];

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TabMenuSelection { action: String, page_id: String }

fn selection(id: &str) -> Option<TabMenuSelection> {
    let (action, page_id) = id.strip_prefix(PREFIX)?.split_once(':')?;
    if !ACTIONS.contains(&action) || super::browser_label(page_id, "primary").is_err() { return None; }
    Some(TabMenuSelection { action: action.to_string(), page_id: page_id.to_string() })
}

pub fn selected(app: &AppHandle, id: &str) {
    if let Some(payload) = selection(id) {
        let _ = app.emit_to("main", "tab-context-action", payload);
    }
}

#[tauri::command]
pub async fn show_tab_context_menu(app: AppHandle, page_id: String, x: f64, y: f64,
    can_close: bool, can_close_left: bool, can_close_right: bool, can_reopen: bool, is_muted: bool) -> Result<(), String> {
    if !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 { return Err("Invalid tab menu position".into()); }
    super::browser_label(&page_id, "primary")?;
    let window = app.get_window("main").ok_or("Main window is not ready")?;
    let menu = Menu::new(&app).map_err(|e| e.to_string())?;
    let items = [
        ("refresh", "Refresh", true),
        ("duplicate", "Duplicate tab", true),
        ("mute", if is_muted { "Unmute tab" } else { "Mute tab" }, true),
        ("close", "Close page", can_close),
        ("close-right", "Close tabs to the right", can_close_right),
        ("close-left", "Close tabs to the left", can_close_left),
        ("reopen", "Reopen closed tab", can_reopen),
    ];
    for (action, title, enabled) in items {
        if action == "close" || action == "reopen" {
            menu.append(&PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        }
        let item = MenuItem::with_id(&app, format!("{PREFIX}{action}:{page_id}"), title, enabled, None::<&str>)
            .map_err(|e| e.to_string())?;
        menu.append(&item).map_err(|e| e.to_string())?;
    }
    menu.popup_at(window, LogicalPosition::new(x, y)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_actions_keep_the_stable_page_identity() {
        for action in ACTIONS {
            let parsed = selection(&format!("tab-context:{action}:page-123")).unwrap();
            assert_eq!(parsed.action, action);
            assert_eq!(parsed.page_id, "page-123");
        }
        for id in ["bookmark-menu:close:page", "tab-context:unknown:page", "tab-context:close:", "tab-context:close:bad:id"] {
            assert!(selection(id).is_none());
        }
    }
}
