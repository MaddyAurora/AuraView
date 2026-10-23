use std::{fs::OpenOptions, io::Write, path::{Path, PathBuf}};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

const MAX_IMAGE_BYTES: usize = 100 * 1024 * 1024;

pub fn token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let random = || std::collections::hash_map::RandomState::new().build_hasher().finish();
    format!("{:016x}{:016x}", random(), random())
}

pub fn script(token: &str) -> String {
    include_str!("image-download.js").replace("__AURAVIEW_IMAGE_TOKEN__", &serde_json::to_string(token).unwrap())
}

#[derive(serde::Deserialize)]
struct Request { kind: String, token: String, id: String, url: String, data: Option<String>, mime: Option<String> }

fn image_extension(mime: &str) -> Option<&'static str> {
    match mime.split(';').next()?.trim().to_ascii_lowercase().as_str() {
        "image/png" | "image/apng" => Some("png"), "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"), "image/webp" => Some("webp"), "image/avif" => Some("avif"),
        "image/svg+xml" => Some("svg"), "image/bmp" | "image/x-ms-bmp" => Some("bmp"),
        "image/x-icon" | "image/vnd.microsoft.icon" => Some("ico"), "image/tiff" => Some("tiff"),
        "image/jxl" => Some("jxl"), "image/heic" => Some("heic"), "image/heif" => Some("heif"),
        _ => None,
    }
}

fn filename(url: &str, mime: &str) -> Result<String, String> {
    let extension = image_extension(mime).ok_or("Unsupported image format")?;
    let parsed = tauri::Url::parse(url).map_err(|e| e.to_string())?;
    let suggested = if matches!(parsed.scheme(), "http" | "https" | "file") {
        parsed.query_pairs().find(|(key, _)| key == "filename").map(|(_, value)| value.into_owned())
            .or_else(|| parsed.path_segments().and_then(|mut parts| parts.next_back()).map(|part|
                percent_encoding::percent_decode_str(part).decode_utf8_lossy().into_owned())).unwrap_or_default()
    } else { String::new() };
    let cleaned: String = suggested.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c }).collect();
    let cleaned = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());
    let stem = cleaned.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(cleaned);
    let stem: String = stem.trim_matches(|c: char| c == '.' || c.is_whitespace()).chars().take(100).collect();
    let stem = if stem.is_empty() { "image" } else { &stem };
    let reserved = stem.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(reserved.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        || (reserved.len() == 4 && (reserved.starts_with("COM") || reserved.starts_with("LPT"))
            && reserved.as_bytes()[3].is_ascii_digit());
    Ok(format!("{}{stem}.{extension}", if reserved { "_" } else { "" }))
}

fn save_image(directory: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES { return Err("Image is empty or exceeds 100 MB".into()); }
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let name = Path::new(name);
    let stem = name.file_stem().and_then(|s| s.to_str()).ok_or("Invalid image filename")?;
    let ext = name.extension().and_then(|s| s.to_str()).ok_or("Invalid image extension")?;
    for index in 0..10_000 {
        let path = directory.join(if index == 0 { format!("{stem}.{ext}") } else { format!("{stem} ({index}).{ext}") });
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes).and_then(|_| file.flush()) {
                    drop(file); let _ = std::fs::remove_file(&path); return Err(error.to_string());
                }
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Too many images with the same filename".into())
}

fn find_resource(tree: &Value, url: &str) -> Option<(String, String)> {
    if let Some(resource) = tree["resources"].as_array().and_then(|resources| resources.iter()
        .find(|resource| resource["url"].as_str() == Some(url) && image_extension(resource["mimeType"].as_str().unwrap_or("")).is_some())) {
        return Some((tree["frame"]["id"].as_str()?.into(), resource["mimeType"].as_str()?.into()));
    }
    tree["childFrames"].as_array()?.iter().find_map(|child| find_resource(child, url))
}

fn frame_for_source(tree: &Value, source: &str) -> Option<String> {
    let without_fragment = |url: &str| url.split('#').next().unwrap_or("").to_string();
    if tree["frame"]["url"].as_str().is_some_and(|url| without_fragment(url) == without_fragment(source)) {
        return tree["frame"]["id"].as_str().map(str::to_string);
    }
    tree["childFrames"].as_array()?.iter().find_map(|child| frame_for_source(child, source))
}

fn response_mime(headers: &Value, bytes: &[u8]) -> Result<String, String> {
    if let Some(mime) = headers.as_object().and_then(|headers| headers.iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-type")).and_then(|(_, value)| value.as_str())) {
        if image_extension(mime).is_some() { return Ok(mime.into()); }
    }
    // Image servers sometimes send application/octet-stream. Identify actual
    // image bytes rather than saving an HTML error page under an image extension.
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { "image/png" }
        else if bytes.starts_with(b"\xff\xd8\xff") { "image/jpeg" }
        else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { "image/gif" }
        else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { "image/webp" }
        else if bytes.starts_with(b"BM") { "image/bmp" }
        else if bytes.starts_with(b"\0\0\x01\0") { "image/x-icon" }
        else if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") { "image/tiff" }
        else if bytes.get(4..8) == Some(b"ftyp") && bytes.get(8..12).is_some_and(|brand| brand == b"avif" || brand == b"avis") { "image/avif" }
        else { return Err("The server did not return a supported image".into()); };
    Ok(mime.into())
}

fn append_stream_chunk(bytes: &mut Vec<u8>, chunk: &Value) -> Result<bool, String> {
    let text = chunk["data"].as_str().ok_or("Image stream returned no data")?;
    let eof = chunk["eof"].as_bool().ok_or("Image stream did not report completion")?;
    if !text.is_empty() {
        let data = decode_content(text, chunk["base64Encoded"].as_bool().unwrap_or(false))?;
        if bytes.len() + data.len() > MAX_IMAGE_BYTES { return Err("Image exceeds 100 MB".into()); }
        bytes.extend(data);
    } else if !eof { return Err("Image stream stopped before completion".into()); }
    if eof && bytes.is_empty() { return Err("The server returned an empty image".into()); }
    Ok(eof)
}

async fn loaded_image_with<F, Fut>(mut call: F, url: &str, source: &str) -> Result<(Vec<u8>, String), String>
where F: FnMut(&'static str, Value) -> Fut, Fut: std::future::Future<Output = Result<Value, String>> {
    let tree = match call("Page.getResourceTree", json!({})).await {
        Ok(tree) => tree,
        Err(_) => call("Page.getFrameTree", json!({})).await?,
    };
    let cached = find_resource(&tree["frameTree"], url);
    if let Some((frame, mime)) = &cached {
        if let Ok(content) = call("Page.getResourceContent", json!({"frameId": frame, "url": url})).await {
            if let Some(text) = content["content"].as_str() {
                if let Ok(bytes) = decode_content(text, content["base64Encoded"].as_bool().unwrap_or(false)) {
                    return Ok((bytes, mime.clone()));
                }
            }
        }
    }
    if !tauri::Url::parse(url).is_ok_and(|url| matches!(url.scheme(), "http" | "https")) {
        return Err("Image is no longer in the page cache".into());
    }
    let frame = frame_for_source(&tree["frameTree"], source)
        .or_else(|| cached.map(|(frame, _)| frame))
        .or_else(|| tree["frameTree"]["frame"]["id"].as_str().map(str::to_string))
        .ok_or("Browser frame is no longer available")?;
    // Browser-side loading retains the WebView's session and cache. Page fetch()
    // cannot read many perfectly displayable cross-origin/lazy-loaded images.
    let response = call("Network.loadNetworkResource", json!({"frameId": frame, "url": url,
        "options": {"disableCache": false, "includeCredentials": true}})).await?;
    let resource = &response["resource"];
    let stream = resource["stream"].as_str().ok_or_else(|| format!("Browser image request failed ({})",
        resource["httpStatusCode"].as_u64().map(|code| code.to_string()).unwrap_or_else(|| "network error".into())))?;
    let result = async {
        if resource["success"].as_bool() != Some(true) || resource["httpStatusCode"].as_u64().is_some_and(|code| code >= 400) {
            return Err("The image server refused the download".into());
        }
        let mut bytes = Vec::new();
        loop {
            let chunk = call("IO.read", json!({"handle": stream, "size": 1024 * 1024})).await?;
            if append_stream_chunk(&mut bytes, &chunk)? { break; }
        }
        let mime = response_mime(&resource["headers"], &bytes)?;
        Ok((bytes, mime))
    }.await;
    // Close browser-owned handles on success, invalid data, and read failures.
    let _ = call("IO.close", json!({"handle": stream})).await;
    result
}

#[cfg(windows)]
async fn devtools(webview: &tauri::Webview, method: &str, params: Value) -> Result<Value, String> {
    let method = method.to_string();
    let (sender, receiver) = std::sync::mpsc::channel();
    webview.with_webview(move |platform| unsafe {
        use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
        let callback_sender = sender.clone();
        let result = (|| -> windows_core::Result<()> {
            platform.controller().CoreWebView2()?.CallDevToolsProtocolMethod(
                &windows_core::HSTRING::from(method), &windows_core::HSTRING::from(params.to_string()),
                &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, response| {
                    let value = result.map_err(|e| e.to_string()).and_then(|_| {
                        serde_json::from_str(&response).map_err(|e| e.to_string())
                    });
                    let _ = callback_sender.send(value);
                    Ok(())
                })))
        })();
        if let Err(error) = result { let _ = sender.send(Err(error.to_string())); }
    }).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(std::time::Duration::from_secs(30))
        .map_err(|e| e.to_string())?).await.map_err(|e| e.to_string())?
}

#[cfg(windows)]
async fn loaded_image(webview: &tauri::Webview, url: &str, source: &str) -> Result<(Vec<u8>, String), String> {
    loaded_image_with(|method, params| devtools(webview, method, params), url, source).await
}

fn decode_content(content: &str, encoded: bool) -> Result<Vec<u8>, String> {
    if content.len() > MAX_IMAGE_BYTES * 4 / 3 + 4 { return Err("Image exceeds 100 MB".into()); }
    let bytes = if encoded { STANDARD.decode(content).map_err(|e| e.to_string())? } else { content.as_bytes().to_vec() };
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES { return Err("Image is empty or exceeds 100 MB".into()); }
    Ok(bytes)
}

#[cfg(windows)]
async fn handle(app: AppHandle, webview: tauri::Webview, request: Request, source: String) {
    let result = if let Some(data) = &request.data {
        decode_content(data, true).map(|bytes| (bytes, request.mime.clone().unwrap_or_default()))
    } else { loaded_image(&webview, &request.url, &source).await };
    if let Err(error) = &result {
        if request.data.is_none() {
            let payload = json!({"id": request.id, "status": "read-in-page", "message": format!("Could not save image: {error}. Click to retry.")});
            let _ = webview.eval(&format!("window.dispatchEvent(new CustomEvent('auraview-image-result', {{detail: {payload}}}));"));
            return;
        }
    }
    let result = match result {
        Ok((bytes, mime)) => {
            let name = filename(&request.url, &mime);
            match name.and_then(|name| Ok((app.path().download_dir().map_err(|e| e.to_string())?, name))) {
                Ok((directory, name)) => tauri::async_runtime::spawn_blocking(move || save_image(&directory, &name, &bytes))
                    .await.map_err(|e| e.to_string()).and_then(|result| result),
                Err(error) => Err(error),
            }
        }
        Err(error) => Err(error),
    };
    let payload = match result {
        Ok(path) => json!({"id": request.id, "status": "saved", "filename": path.file_name().unwrap_or_default().to_string_lossy()}),
        Err(error) => json!({"id": request.id, "status": "error", "message": format!("Could not save image: {error}. Click to retry.")}),
    };
    let _ = webview.eval(&format!("window.dispatchEvent(new CustomEvent('auraview-image-result', {{detail: {payload}}}));"));
}

#[cfg(windows)]
mod bridge {
    use super::*;
    use std::rc::Rc;
    use webview2_com_sys::Microsoft::Web::WebView2::Win32::*;
    use windows_core::Interface;
    type Receiver = Rc<dyn Fn(&ICoreWebView2WebMessageReceivedEventArgs)>;

    unsafe fn install_frame(frame: ICoreWebView2Frame, receive: Receiver) -> windows_core::Result<()> {
        use webview2_com::{FrameWebMessageReceivedEventHandler, FrameChildFrameCreatedEventHandler};
        let mut token = 0;
        let messages = receive.clone();
        frame.cast::<ICoreWebView2Frame2>()?.add_WebMessageReceived(
            &FrameWebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args { messages(&args); } Ok(())
            })), &mut token)?;
        if let Ok(frame) = frame.cast::<ICoreWebView2Frame7>() {
            frame.add_FrameCreated(&FrameChildFrameCreatedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args { install_frame(args.Frame()?, receive.clone())?; } Ok(())
            })), &mut token)?;
        }
        Ok(())
    }

    pub fn install(app: &AppHandle, webview: &tauri::Webview, secret: String) -> tauri::Result<()> {
        let app = app.clone(); let target = webview.clone();
        webview.with_webview(move |platform| unsafe {
            use webview2_com::{WebMessageReceivedEventHandler, FrameCreatedEventHandler};
            let receive: Receiver = Rc::new(move |args| {
                let mut message = windows_core::PWSTR::null();
                if args.TryGetWebMessageAsString(&mut message).is_err() { return; }
                let message = webview2_com::take_pwstr(message);
                if message.len() > MAX_IMAGE_BYTES * 4 / 3 + 8192 { return; }
                let Ok(request) = serde_json::from_str::<Request>(&message) else { return };
                if request.kind != "auraview-image-download" || request.token != secret || request.id.len() > 80 { return; }
                if !tauri::Url::parse(&request.url).is_ok_and(|url| matches!(url.scheme(), "http" | "https" | "blob" | "data" | "file")) { return; }
                let mut source = windows_core::PWSTR::null();
                if args.Source(&mut source).is_err() { return; }
                let source = webview2_com::take_pwstr(source);
                tauri::async_runtime::spawn(handle(app.clone(), target.clone(), request, source));
            });
            let result = (|| -> windows_core::Result<()> {
                let core = platform.controller().CoreWebView2()?;
                let mut token = 0;
                let messages = receive.clone();
                core.add_WebMessageReceived(&WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args { messages(&args); } Ok(())
                })), &mut token)?;
                core.cast::<ICoreWebView2_4>()?.add_FrameCreated(&FrameCreatedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args { install_frame(args.Frame()?, receive.clone())?; } Ok(())
                })), &mut token)
            })();
            if let Err(error) = result { eprintln!("Unable to install image downloads: {error}"); }
        })
    }
}

pub fn install(app: &AppHandle, webview: &tauri::Webview, token: String) -> tauri::Result<()> {
    #[cfg(windows)]
    return bridge::install(app, webview, token);
    #[cfg(not(windows))]
    { let _ = (app, webview, token); Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_keep_image_formats_and_remove_paths_and_windows_special_names() {
        assert_eq!(filename("https://example.com/photos/Snow%20day.jpeg?size=large", "image/jpeg").unwrap(), "Snow day.jpg");
        assert_eq!(filename("http://localhost:8188/view?filename=ComfyUI_00001.png&type=output", "image/png").unwrap(), "ComfyUI_00001.png");
        assert_eq!(filename("https://example.com/CON.jpg", "image/jpeg").unwrap(), "_CON.jpg");
        assert_eq!(filename("https://example.com/?filename=..%2F..%2Fbad%5Cname.exe", "image/webp").unwrap(), "_.._bad_name.webp");
        assert_eq!(filename("blob:https://example.com/id", "image/png").unwrap(), "image.png");
        assert_eq!(filename("data:image/svg+xml,svg", "image/svg+xml").unwrap(), "image.svg");
        assert!(filename("https://example.com/a.exe", "application/octet-stream").is_err());
    }

    #[test]
    fn resource_lookup_uses_the_image_in_its_own_frame_and_excludes_non_images() {
        let tree = json!({"frame": {"id": "main"}, "resources": [
            {"url": "https://example.com/code", "mimeType": "text/javascript"}],
            "childFrames": [{"frame": {"id": "frame"}, "resources": [
                {"url": "https://cdn.example.org/image.webp", "mimeType": "image/webp"}]}]});
        assert_eq!(find_resource(&tree, "https://cdn.example.org/image.webp"), Some(("frame".into(), "image/webp".into())));
        assert!(find_resource(&tree, "https://example.com/code").is_none());
        assert!(find_resource(&tree, "https://example.com/missing").is_none());
    }

    #[test]
    fn image_data_decoding_preserves_bytes_and_rejects_invalid_content() {
        let bytes = [0, 255, 13, 10, 128];
        assert_eq!(decode_content(&STANDARD.encode(bytes), true).unwrap(), bytes);
        assert_eq!(decode_content("<svg/>", false).unwrap(), b"<svg/>");
        assert!(decode_content("not-base64", true).is_err());
        assert!(decode_content("", false).is_err());
    }

    #[test]
    fn duplicate_downloads_are_created_atomically_without_overwriting() {
        let directory = std::env::temp_dir().join(format!("auraview-image-test-{}", token()));
        let first = save_image(&directory, "picture.png", b"first image").unwrap();
        let second = save_image(&directory, "picture.png", b"second image").unwrap();
        assert_eq!(first.file_name().unwrap(), "picture.png");
        assert_eq!(second.file_name().unwrap(), "picture (1).png");
        assert_eq!(std::fs::read(&first).unwrap(), b"first image");
        assert_eq!(std::fs::read(&second).unwrap(), b"second image");
        assert!(save_image(&directory, "empty.png", b"").is_err());
        std::fs::remove_file(first).unwrap(); std::fs::remove_file(second).unwrap(); std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn bridge_tokens_stay_private_to_each_injected_page_closure() {
        let first = token(); let second = token();
        assert_eq!(first.len(), 32); assert_ne!(first, second);
        let source = script(&first);
        assert!(!source.contains("__AURAVIEW_IMAGE_TOKEN__"));
        assert!(source.contains(&first));
    }

    #[test]
    fn lazy_cross_origin_images_download_through_the_browser_and_close_the_stream() {
        let mut calls = Vec::new();
        let mut read = 0;
        let result = tauri::async_runtime::block_on(loaded_image_with(|method, params| {
            calls.push((method, params.clone()));
            let response = match method {
                "Page.getResourceTree" => Ok(json!({"frameTree": {"frame": {"id": "main", "url": "https://search.example/images"},
                    "resources": [], "childFrames": [{"frame": {"id": "embedded", "url": "https://frame.example/gallery"}, "resources": []}]}})),
                "Network.loadNetworkResource" => {
                    assert_eq!(params["frameId"], "embedded");
                    assert_eq!(params["url"], "https://cdn.example/lazy.jpg");
                    assert_eq!(params["options"]["includeCredentials"], true);
                    assert_eq!(params["options"]["disableCache"], false);
                    Ok(json!({"resource": {"success": true, "httpStatusCode": 200, "stream": "image-stream", "headers": {"Content-Type": "image/jpeg"}}}))
                }
                "IO.read" => {
                    read += 1;
                    Ok(if read == 1 { json!({"data": STANDARD.encode([0xff, 0xd8, 0xff, 0x80]), "base64Encoded": true, "eof": false}) }
                       else { json!({"data": "", "eof": true}) })
                }
                "IO.close" => { assert_eq!(params["handle"], "image-stream"); Ok(json!({})) }
                _ => panic!("Unexpected protocol call: {method}"),
            };
            std::future::ready(response)
        }, "https://cdn.example/lazy.jpg", "https://frame.example/gallery#photo"));
        let (bytes, mime) = result.unwrap();
        assert_eq!(bytes, [0xff, 0xd8, 0xff, 0x80]); assert_eq!(mime, "image/jpeg");
        assert_eq!(calls.last().unwrap().0, "IO.close");
    }

    #[test]
    fn evicted_cached_image_bodies_fall_back_to_native_fetch_and_keep_existing_cache_hits() {
        for evicted in [false, true] {
            let mut methods = Vec::new();
            let result = tauri::async_runtime::block_on(loaded_image_with(|method, _| {
                methods.push(method);
                std::future::ready(match method {
                    "Page.getResourceTree" => Ok(json!({"frameTree": {"frame": {"id": "main", "url": "https://example.com/"},
                        "resources": [{"url": "https://cdn.example/img.png", "mimeType": "image/png"}]}})),
                    "Page.getResourceContent" if evicted => Err("No resource with given identifier found".into()),
                    "Page.getResourceContent" => Ok(json!({"content": STANDARD.encode(b"original"), "base64Encoded": true})),
                    "Network.loadNetworkResource" => Ok(json!({"resource": {"success": true, "httpStatusCode": 200,
                        "stream": "stream", "headers": {"content-type": "image/png"}}})),
                    "IO.read" => Ok(json!({"data": STANDARD.encode(b"original"), "base64Encoded": true, "eof": true})),
                    "IO.close" => Ok(json!({})),
                    _ => panic!("Unexpected protocol call: {method}"),
                })
            }, "https://cdn.example/img.png", "https://example.com/")).unwrap();
            assert_eq!(result.0, b"original"); assert_eq!(result.1, "image/png");
            assert_eq!(methods.contains(&"Network.loadNetworkResource"), evicted);
        }
    }

    #[test]
    fn failed_native_reads_and_non_image_responses_always_release_the_stream() {
        for failed_read in [false, true] {
            let mut closed = false;
            let result = tauri::async_runtime::block_on(loaded_image_with(|method, _| std::future::ready(match method {
                "Page.getResourceTree" => Ok(json!({"frameTree": {"frame": {"id": "main"}, "resources": []}})),
                "Network.loadNetworkResource" => Ok(json!({"resource": {"success": true, "stream": "stream", "headers": {"content-type": "text/html"}}})),
                "IO.read" if failed_read => Err("Read failed".into()),
                "IO.read" => Ok(json!({"data": "<html>Not an image</html>", "eof": true})),
                "IO.close" => { closed = true; Ok(json!({})) }
                _ => panic!("Unexpected protocol call: {method}"),
            }), "https://cdn.example/img", "https://example.com/"));
            assert!(result.is_err()); assert!(closed);
        }
        assert_eq!(response_mime(&json!({"Content-Type": "application/octet-stream"}), b"GIF89a...").unwrap(), "image/gif");
    }
}
