use tauri::{AppHandle, Manager};

pub fn install(app: &AppHandle, webview: &tauri::Webview, tab_id: &str, pane: &'static str) -> tauri::Result<()> {
    #[cfg(windows)]
    {
        use tauri::Emitter;
        let app = app.clone();
        let tab_id = tab_id.to_string();
        webview.with_webview(move |platform| unsafe {
            use webview2_com::IsDocumentPlayingAudioChangedEventHandler;
            use webview2_com_sys::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
            use windows_core::Interface;
            if let Ok(core) = platform.controller().CoreWebView2().and_then(|core| core.cast::<ICoreWebView2_8>()) {
                let mut token = 0;
                let _ = core.add_IsDocumentPlayingAudioChanged(
                    &IsDocumentPlayingAudioChangedEventHandler::create(Box::new(move |sender, _| {
                        if let Some(sender) = sender {
                            if let Ok(core) = sender.cast::<ICoreWebView2_8>() {
                                let mut playing = false.into();
                                if core.IsDocumentPlayingAudio(&mut playing).is_ok() {
                                    let _ = app.emit("webview-status", super::WebviewStatusPayload {
                                        tab_id: tab_id.clone(), pane, is_playing_audio: Some(playing.as_bool()), ..Default::default()
                                    });
                                }
                            }
                        }
                        Ok(())
                    })), &mut token);
            }
        })?;
    }
    #[cfg(not(windows))]
    let _ = (app, webview, tab_id, pane);
    Ok(())
}

// Called from async command workers, never from a WebView2 callback or the UI thread.
pub fn apply_muted(webview: &tauri::Webview, muted: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        webview.with_webview(move |platform| unsafe {
            use webview2_com_sys::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
            use windows_core::Interface;
            let result = (|| -> windows_core::Result<()> {
                platform.controller().CoreWebView2()?.cast::<ICoreWebView2_8>()?.SetIsMuted(muted)
            })();
            let _ = sender.send(result.map_err(|e| e.to_string()));
        }).map_err(|e| e.to_string())?;
        receiver.recv_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (webview, muted);
        Err("Tab audio control requires Windows WebView2".into())
    }
}

#[tauri::command]
pub async fn set_browser_muted(app: AppHandle, tab_id: String, pane: String, muted: bool) -> Result<(), String> {
    let _layout = super::LAYOUT_LOCK.lock().unwrap();
    let (pane, _) = super::pane_details(Some(&pane))?;
    let label = super::browser_label(&tab_id, pane)?;
    // Unvisited tabs have no native view yet; layout applies their saved mute state.
    if let Some(webview) = app.get_webview(&label) { apply_muted(&webview, muted)?; }
    Ok(())
}
