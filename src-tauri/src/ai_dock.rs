use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl, Window, WindowEvent,
    menu::{ContextMenu, Menu, MenuItem}, window::WindowBuilder};

const PREFIX: &str = "ai-dock-menu:";
const LABEL: &str = "ai-dock-editor";
static EDITOR: Mutex<Option<serde_json::Value>> = Mutex::new(None);

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}
fn menu_action(id: &str) -> Option<&str> {
    let action = id.strip_prefix(PREFIX)?;
    if action == "add" { return Some(action); }
    let (kind, id) = action.split_once(':')?;
    (matches!(kind, "edit" | "delete") && valid_id(id)).then_some(action)
}
pub fn selected(app: &AppHandle, id: &str) {
    if let Some(action) = menu_action(id) { let _ = app.emit_to("main", "ai-dock-menu-select", action); }
}

#[tauri::command]
pub async fn show_ai_dock_menu(app: AppHandle, webview: tauri::Webview, window: Window, x: f64, y: f64, server_id: Option<String>) -> Result<(), String> {
    main_only(&webview, &window)?;
    if !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 || server_id.as_deref().is_some_and(|id| !valid_id(id)) {
        return Err("Invalid Local Hub menu request.".into());
    }
    let menu = Menu::new(&app).map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    if let Some(id) = server_id {
        items.push((format!("edit:{id}"), "Edit entry…"));
        items.push((format!("delete:{id}"), "Delete entry"));
    }
    items.push(("add".into(), "Add port…"));
    for (id, label) in items {
        let item = MenuItem::with_id(&app, format!("{PREFIX}{id}"), label, true, None::<&str>).map_err(|e| e.to_string())?;
        menu.append(&item).map_err(|e| e.to_string())?;
    }
    menu.popup_at(window, LogicalPosition::new(x, y)).map_err(|e| e.to_string())
}

fn main_only(webview: &tauri::Webview, window: &Window) -> Result<(), String> {
    if webview.label() != "main" || window.label() != "main" { return Err("Manage Local Hub entries from the main window.".into()); }
    Ok(())
}

// The editor is an owned native window so it stays above browser child panes.
#[tauri::command]
pub async fn show_ai_dock_editor(app: AppHandle, webview: tauri::Webview, window: Window, draft: serde_json::Value) -> Result<(), String> {
    main_only(&webview, &window)?;
    if let Some(editor) = app.get_window(LABEL) { return editor.set_focus().map_err(|e| e.to_string()); }
    super::bookmark_folder::close(&app)?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let origin = window.inner_position().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
    let size = window.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
    let title = if draft.get("id").and_then(|id| id.as_str()).is_some() { "Edit Local Hub entry" } else { "Add Local Hub port" };
    *EDITOR.lock().unwrap() = Some(draft);
    let editor = WindowBuilder::new(&app, LABEL).title(title).inner_size(440.0, 500.0)
        .resizable(false).minimizable(false).maximizable(false).skip_taskbar(true).visible(false)
        .position(origin.x + ((size.width - 440.0) / 2.0).max(0.0), origin.y + ((size.height - 500.0) / 2.0).max(0.0))
        .parent(&window).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
    let handle = app.clone();
    editor.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            *EDITOR.lock().unwrap() = None;
            if let Some(main) = handle.get_window("main") { let _ = main.set_enabled(true); let _ = main.set_focus(); }
            let _ = handle.emit_to("main", "ai-dock-editor-closed", ());
        }
    });
    if let Err(error) = editor.add_child(WebviewBuilder::new(LABEL, WebviewUrl::App("index.html#ai-dock-editor".into())).auto_resize(),
        LogicalPosition::new(0.0, 0.0), LogicalSize::new(440.0, 500.0)) {
        let _ = editor.destroy(); return Err(error.to_string());
    }
    if let Err(error) = window.set_enabled(false) { let _ = editor.destroy(); return Err(error.to_string()); }
    if let Err(error) = editor.show().and_then(|_| editor.set_focus()) {
        let _ = editor.destroy(); let _ = window.set_enabled(true); return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn get_ai_dock_editor(webview: tauri::Webview, window: Window) -> Result<serde_json::Value, String> {
    if webview.label() != LABEL || window.label() != LABEL { return Err("Not an Local Hub editor window.".into()); }
    EDITOR.lock().unwrap().clone().ok_or_else(|| "No Local Hub entry is being edited.".into())
}

#[tauri::command]
pub async fn close_ai_dock_editor(webview: tauri::Webview, window: Window) -> Result<(), String> {
    if webview.label() != LABEL || window.label() != LABEL { return Err("Not an Local Hub editor window.".into()); }
    window.close().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn menu_selection_keeps_the_exact_entry_id_and_rejects_unrelated_actions() {
        assert_eq!(menu_action("ai-dock-menu:add"), Some("add"));
        assert_eq!(menu_action("ai-dock-menu:edit:ollama-api"), Some("edit:ollama-api"));
        assert_eq!(menu_action("ai-dock-menu:delete:1234-abcd"), Some("delete:1234-abcd"));
        for id in ["bookmark-menu:delete:one", "ai-dock-menu:other:one", "ai-dock-menu:edit:", "ai-dock-menu:delete:one:two"] {
            assert_eq!(menu_action(id), None);
        }
    }
}
