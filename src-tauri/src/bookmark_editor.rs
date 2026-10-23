use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl, Window, WindowEvent, window::WindowBuilder};

const LABEL: &str = "bookmark-editor";
static EDITOR: Mutex<Option<serde_json::Value>> = Mutex::new(None);

// An owned window stays above the native browser panes without hiding or
// resizing them. Its UI uses the same local origin and bookmark storage.
#[tauri::command]
pub async fn show_bookmark_editor(app: AppHandle, window: Window, draft: serde_json::Value, data: serde_json::Value) -> Result<(), String> {
    if window.label() != "main" { return Err("Open bookmarks from the main window".into()); }
    if let Some(editor) = app.get_webview_window(LABEL) {
        return editor.set_focus().map_err(|error| error.to_string());
    }
    super::bookmark_folder::close(&app)?;
    let main = app.get_window("main").ok_or("Main window is not ready")?;
    let scale = main.scale_factor().map_err(|error| error.to_string())?;
    let origin = main.inner_position().map_err(|error| error.to_string())?.to_logical::<f64>(scale);
    let size = main.inner_size().map_err(|error| error.to_string())?.to_logical::<f64>(scale);
    let title = if draft.get("id").and_then(|id| id.as_str()).is_some() { "Edit bookmark" } else { "Add bookmark" };
    *EDITOR.lock().unwrap() = Some(serde_json::json!({ "draft": draft, "data": data }));
    let editor = WindowBuilder::new(&app, LABEL)
        .title(title).inner_size(420.0, 440.0).resizable(false).minimizable(false).maximizable(false)
        .skip_taskbar(true).visible(false)
        .position(origin.x + (size.width - 420.0) / 2.0, origin.y + (size.height - 440.0) / 2.0)
        .parent(&main).map_err(|error| error.to_string())?
        .build().map_err(|error| error.to_string())?;
    let handle = app.clone();
    editor.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            *EDITOR.lock().unwrap() = None;
            if let Some(main) = handle.get_window("main") {
                let _ = main.set_enabled(true);
                let _ = main.set_focus();
            }
            let _ = handle.emit_to("main", "bookmark-editor-closed", ());
        }
    });
    if let Err(error) = editor.add_child(
        WebviewBuilder::new(LABEL, WebviewUrl::App("index.html#bookmark-editor".into())).auto_resize(),
        LogicalPosition::new(0.0, 0.0), LogicalSize::new(420.0, 440.0),
    ) {
        let _ = editor.destroy();
        return Err(error.to_string());
    }
    main.set_enabled(false).map_err(|error| error.to_string())?;
    if let Err(error) = editor.show() {
        let _ = editor.destroy();
        let _ = main.set_enabled(true);
        return Err(error.to_string());
    }
    editor.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_bookmark_editor(window: Window) -> Result<serde_json::Value, String> {
    if window.label() != LABEL { return Err("Not a bookmark editor window".into()); }
    EDITOR.lock().unwrap().clone().ok_or_else(|| "No bookmark is being edited".into())
}

#[tauri::command]
pub async fn close_bookmark_editor(window: Window) -> Result<(), String> {
    if window.label() != LABEL { return Err("Not a bookmark editor window".into()); }
    window.close().map_err(|error| error.to_string())
}
