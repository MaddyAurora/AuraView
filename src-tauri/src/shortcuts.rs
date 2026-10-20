use tauri::{AppHandle, Emitter, Manager};
use super::{browser_label, browser_state, pane_details, BrowserViewRef, WebviewStatusPayload};

// Only host-owned accelerators are intercepted. Find, print, Escape, Space,
// text editing and media keys keep WebView2's context-sensitive native behavior.
fn host_shortcut(key: u32, ctrl: bool, shift: bool, alt: bool) -> Option<String> {
    if alt { return None; }
    let action = if ctrl {
        match (key, shift) {
            (0x73, false) => "close-tab", (0x73, true) => "reopen-tab",
            (0x09, false) => "next-tab", (0x09, true) => "previous-tab",
            (0x31..=0x39, false) => return Some(format!("tab-{}", key - 0x30)),
            (0x54, false) => "new-tab", (0x57, false) => "close-tab",
            (0x52 | 0x74, false) => "reload", (0x53, false) => "save",
            (0xDC, false) => "split", (0x44, false) => "ai-dock",
            _ => return None,
        }
    } else if !shift {
        match key { 0x74 => "reload", 0x7A => "fullscreen", 0x7B => "devtools", _ => return None }
    } else { return None; };
    Some(action.to_string())
}

fn toolbar_page_shortcut(key: u32, ctrl: bool, shift: bool, alt: bool) -> Option<String> {
    if !ctrl || alt { return None; }
    match (key, shift) {
        (0x46, false) => Some("find".to_string()),
        (0x47, false) => Some("find-next".to_string()),
        (0x47, true) => Some("find-previous".to_string()),
        (0x50, false) => Some("print".to_string()),
        _ => None,
    }
}

#[derive(serde::Serialize, Clone)]
struct ShortcutPayload { action: String, view: Option<BrowserViewRef> }

pub fn install(app: &AppHandle, webview: &tauri::Webview, view: Option<BrowserViewRef>) -> tauri::Result<()> {
    #[cfg(windows)]
    {
        let app = app.clone();
        webview.with_webview(move |platform| unsafe {
            use webview2_com::{AcceleratorKeyPressedEventHandler, FocusChangedEventHandler};
            use webview2_com_sys::Microsoft::Web::WebView2::Win32::*;
            use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState;
            let controller = platform.controller();
            let key_app = app.clone();
            let key_view = view.clone();
            let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
                args.KeyEventKind(&mut kind)?;
                if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN {
                    return Ok(());
                }
                let mut key = 0;
                args.VirtualKey(&mut key)?;
                if key == 0x1B && key_view.is_some()
                    && GetKeyState(0x11) >= 0 && GetKeyState(0x10) >= 0 && GetKeyState(0x12) >= 0 {
                    // Keep native Escape dismissal, and end the host's loading
                    // state even if stopping produces no finished page event.
                    let _ = key_app.emit_to("main", "browser-shortcut", ShortcutPayload {
                        action: "stop".to_string(), view: key_view.clone(),
                    });
                    return Ok(());
                }
                let ctrl = GetKeyState(0x11) < 0;
                let shift = GetKeyState(0x10) < 0;
                let alt = GetKeyState(0x12) < 0;
                // Toolbar focus must search/print the page, not the React shell.
                let action = host_shortcut(key, ctrl, shift, alt).or_else(|| {
                    if key_view.is_none() { toolbar_page_shortcut(key, ctrl, shift, alt) } else { None }
                });
                let Some(action) = action else { return Ok(()) };
                // Mark handled synchronously, then leave this COM callback before
                // performing work that can create/close views or open modal UI.
                args.SetHandled(true)?;
                let mut status = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
                args.PhysicalKeyStatus(&mut status)?;
                if !status.WasKeyDown.as_bool() {
                    let _ = key_app.emit_to("main", "browser-shortcut", ShortcutPayload { action, view: key_view.clone() });
                }
                Ok(())
            }));
            let mut token = 0;
            if let Err(error) = controller.add_AcceleratorKeyPressed(&handler, &mut token) {
                eprintln!("Unable to install browser shortcuts: {error}");
            }
            if let Some(view) = view {
                let handler = FocusChangedEventHandler::create(Box::new(move |_, _| {
                    let _ = app.emit_to("main", "browser-focus", view.clone());
                    Ok(())
                }));
                let _ = controller.add_GotFocus(&handler, &mut token);
            }
        })?;
    }
    #[cfg(not(windows))]
    let _ = (app, webview, view);
    Ok(())
}

#[tauri::command]
pub async fn browser_page_action(app: AppHandle, tab_id: String, pane: String, action: String) -> Result<(), String> {
    if action == "fullscreen" {
        return super::fullscreen::toggle_browser(&app);
    }
    let (pane, _) = pane_details(Some(&pane))?;
    let label = browser_label(&tab_id, pane)?;
    let webview = app.get_webview(&label).ok_or("Browser pane is not ready")?;
    if action == "devtools" {
        if webview.is_devtools_open() { webview.close_devtools(); } else { webview.open_devtools(); }
        return Ok(());
    }
    if action == "scroll-down" || action == "scroll-up" {
        let _ = webview.set_focus();
        return webview.eval(&format!(
            "window.scrollBy({{top: {} * window.innerHeight * 0.9, behavior: 'smooth'}})",
            if action == "scroll-up" { -1 } else { 1 }
        )).map_err(|e| e.to_string());
    }
    #[cfg(windows)]
    {
        let _ = webview.set_focus();
        let (sender, receiver) = std::sync::mpsc::channel();
        let stop = action == "stop";
        webview.with_webview(move |platform| unsafe {
            let result = (|| -> windows_core::Result<()> {
                use webview2_com::{FindStartCompletedHandler, ShowSaveAsUICompletedHandler};
                use webview2_com_sys::Microsoft::Web::WebView2::Win32::*;
                use windows_core::{Interface, w};
                let core = platform.controller().CoreWebView2()?;
                match action.as_str() {
                    "stop" => core.Stop(),
                    "print" => core.cast::<ICoreWebView2_16>()?.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER),
                    "save" => core.cast::<ICoreWebView2_25>()?.ShowSaveAsUI(
                        &ShowSaveAsUICompletedHandler::create(Box::new(|result, _| result))),
                    "find" => {
                        let find = core.cast::<ICoreWebView2_28>()?.Find()?;
                        let options = core.cast::<ICoreWebView2_2>()?.Environment()?.cast::<ICoreWebView2Environment15>()?.CreateFindOptions()?;
                        options.SetFindTerm(w!(""))?;
                        options.SetSuppressDefaultFindDialog(false)?;
                        find.Start(&options, &FindStartCompletedHandler::create(Box::new(|result| result)))
                    }
                    "find-next" => core.cast::<ICoreWebView2_28>()?.Find()?.FindNext(),
                    "find-previous" => core.cast::<ICoreWebView2_28>()?.Find()?.FindPrevious(),
                    _ => Err(windows_core::Error::from_hresult(windows_core::HRESULT(0x80070057u32 as i32))),
                }
            })();
            let _ = sender.send(result.map_err(|e| e.to_string()));
        }).map_err(|e| e.to_string())?;
        let result = tauri::async_runtime::spawn_blocking(move || receiver.recv().map_err(|e| e.to_string()))
            .await.map_err(|e| e.to_string())??;
        if stop && result.is_ok() {
            let state = browser_state(&tab_id, pane);
            let mut state = state.lock().unwrap();
            state.generation += 1;
            let _ = app.emit("webview-status", WebviewStatusPayload { tab_id, pane, is_loading: Some(false), ..Default::default() });
        }
        result
    }
    #[cfg(not(windows))]
    Err("This browser action requires Windows WebView2".to_string())
}

#[cfg(test)]
mod tests {
    use super::host_shortcut;
    #[test]
    fn host_keys_and_exact_modifiers() {
        for (key, shift, action) in [(0x54, false, "new-tab"), (0x73, false, "close-tab"),
            (0x73, true, "reopen-tab"), (9, false, "next-tab"), (9, true, "previous-tab"),
            (0x52, false, "reload"), (0x74, false, "reload"), (0x53, false, "save")] {
            assert_eq!(host_shortcut(key, true, shift, false).as_deref(), Some(action));
            assert_eq!(host_shortcut(key, true, shift, true), None);
        }
        for key in 0x31..=0x39 { assert_eq!(host_shortcut(key, true, false, false), Some(format!("tab-{}", key - 0x30))); }
        assert_eq!(host_shortcut(0x7A, false, false, false).as_deref(), Some("fullscreen"));
        assert_eq!(host_shortcut(0x7B, false, false, false).as_deref(), Some("devtools"));
        for key in [0x20, 0x1B, 0x46, 0x47, 0x50] { assert_eq!(host_shortcut(key, true, false, false), None); }
        for (key, shift, action) in [(0x46, false, "find"), (0x47, false, "find-next"),
            (0x47, true, "find-previous"), (0x50, false, "print")] {
            assert_eq!(super::toolbar_page_shortcut(key, true, shift, false).as_deref(), Some(action));
            assert_eq!(super::toolbar_page_shortcut(key, true, shift, true), None);
        }
    }
}
