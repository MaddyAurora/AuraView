use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::{AppHandle, Emitter};

const MAX_ICON_BYTES: usize = 128 * 1024;

fn png_data(bytes: &[u8]) -> Option<String> {
    (bytes.len() <= MAX_ICON_BYTES && bytes.starts_with(b"\x89PNG\r\n\x1a\n"))
        .then(|| format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

#[cfg(windows)]
unsafe fn refresh(app: &AppHandle,
    core: &webview2_com_sys::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    tab_id: &str, pane: &'static str) -> windows_core::Result<()> {
    use webview2_com::GetFaviconCompletedHandler;
    use webview2_com_sys::Microsoft::Web::WebView2::Win32::*;
    use windows_core::{Interface, PWSTR};
    let favicon = core.cast::<ICoreWebView2_15>()?;
    let mut source = PWSTR::null(); core.Source(&mut source)?;
    let source = webview2_com::take_pwstr(source);
    if !tauri::Url::parse(&source).is_ok_and(|url| matches!(url.scheme(), "http" | "https" | "file")) { return Ok(()); }
    let mut uri = PWSTR::null(); favicon.FaviconUri(&mut uri)?;
    let uri = webview2_com::take_pwstr(uri);
    let emit = {
        let app = app.clone(); let tab_id = tab_id.to_string(); let source = source.clone();
        move |data: Option<String>| {
            let _ = app.emit_to("main", "webview-status", crate::WebviewStatusPayload {
                tab_id: tab_id.clone(), pane, favicon: Some(data.unwrap_or_default()),
                favicon_page_url: Some(source.clone()), ..Default::default()
            });
        }
    };
    if uri.is_empty() { emit(None); return Ok(()); }
    let current = core.clone();
    favicon.GetFavicon(COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG,
        &GetFaviconCompletedHandler::create(Box::new(move |result, stream| {
            // An old image request must never assign the previous document's
            // icon after navigation or a dynamic favicon change.
            let mut now = PWSTR::null(); current.Source(&mut now)?;
            let now = webview2_com::take_pwstr(now);
            let mut current_uri = PWSTR::null(); current.cast::<ICoreWebView2_15>()?.FaviconUri(&mut current_uri)?;
            let current_uri = webview2_com::take_pwstr(current_uri);
            if now != source || current_uri != uri { return Ok(()); }
            let mut bytes = Vec::new();
            if result.is_ok() {
                if let Some(stream) = stream {
                    loop {
                        let mut buffer = [0u8; 8192]; let mut read = 0;
                        if stream.Read(buffer.as_mut_ptr().cast(), buffer.len() as u32, Some(&mut read)).is_err()
                            || bytes.len() + read as usize > MAX_ICON_BYTES {
                            bytes.clear(); break;
                        }
                        if read == 0 { break; }
                        bytes.extend_from_slice(&buffer[..read as usize]);
                    }
                }
            }
            emit(png_data(&bytes));
            Ok(())
        })))
}

pub fn install(app: &AppHandle, view: &tauri::Webview, tab_id: &str, pane: &'static str) -> tauri::Result<()> {
    #[cfg(windows)]
    {
        let app = app.clone(); let tab_id = tab_id.to_string();
        view.with_webview(move |platform| unsafe {
            use webview2_com::{FaviconChangedEventHandler, NavigationCompletedEventHandler};
            use webview2_com_sys::Microsoft::Web::WebView2::Win32::*;
            use windows_core::Interface;
            let result = (|| -> windows_core::Result<()> {
                let core = platform.controller().CoreWebView2()?;
                let change_app = app.clone(); let change_tab = tab_id.clone();
                let changed = FaviconChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(core) = sender { let _ = refresh(&change_app, &core, &change_tab, pane); }
                    Ok(())
                }));
                // Navigating between documents that share an icon need not fire
                // FaviconChanged; refresh after navigation too.
                let loaded = NavigationCompletedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(core) = sender { let _ = refresh(&app, &core, &tab_id, pane); }
                    Ok(())
                }));
                let mut token = 0;
                core.cast::<ICoreWebView2_15>()?.add_FaviconChanged(&changed, &mut token)?;
                core.add_NavigationCompleted(&loaded, &mut token)
            })();
            if let Err(error) = result { eprintln!("Unable to track website icons: {error}"); }
        })?;
    }
    #[cfg(not(windows))]
    let _ = (app, view, tab_id, pane);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cached_favicons_are_bounded_png_images_and_empty_or_invalid_streams_use_the_fallback() {
        let bytes = b"\x89PNG\r\n\x1a\nicon";
        let data = png_data(bytes).unwrap();
        assert_eq!(STANDARD.decode(data.strip_prefix("data:image/png;base64,").unwrap()).unwrap(), bytes);
        assert!(png_data(b"").is_none());
        assert!(png_data(b"<html>not an icon</html>").is_none());
        let mut large = bytes.to_vec(); large.resize(MAX_ICON_BYTES + 1, 0);
        assert!(png_data(&large).is_none());
    }
}
