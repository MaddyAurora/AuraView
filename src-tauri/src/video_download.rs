#[cfg(windows)]
use crate::image_download::{devtools, frame_for_source};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex, OnceLock,
    },
};
use tauri::{AppHandle, Emitter, Manager};

pub fn script(token: &str) -> String {
    include_str!("video-download.js")
        .replace(
            "__AURAVIEW_VIDEO_TOKEN__",
            &serde_json::to_string(token).unwrap(),
        )
        .replace(
            "__AURAVIEW_MEDIA_STREAMS__",
            include_str!("video-streams.js"),
        )
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    kind: String,
    token: String,
    id: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    page_url: String,
    #[serde(default)]
    poster: String,
    #[serde(default)]
    instagram_video_id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    streams: Vec<StreamHint>,
    #[serde(default)]
    stream_only: bool,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    resolution: Option<u32>,
    #[serde(default)]
    audio_only: bool,
}

#[derive(Clone, Deserialize)]
struct StreamHint {
    url: String,
    kind: String,
    #[serde(default)]
    mime: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    id: String,
    title: String,
    status: String,
    message: String,
    downloaded: u64,
    total: Option<u64>,
    percent: Option<f64>,
    filename: Option<String>,
    revision: u64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    resolutions: Vec<u32>,
    audio_option: Option<String>,
}
fn busy(status: &str) -> bool {
    matches!(
        status,
        "preparing" | "downloading" | "merging" | "saving" | "cancelling"
    )
}
struct Task {
    request: Request,
    source: String,
    label: String,
    cancel: AtomicBool,
    progress: Mutex<Progress>,
    selection: Mutex<Selection>,
    selection_changed: Condvar,
}
#[derive(Default)]
struct Selection {
    available: Vec<u32>,
    audio: Option<&'static str>,
    offered: bool,
    chosen: Option<DownloadChoice>,
}
#[derive(Clone, Copy, Debug, PartialEq)]
enum DownloadChoice {
    Video(Option<u32>),
    Mp3,
}
static TASKS: OnceLock<Mutex<HashMap<String, Arc<Task>>>> = OnceLock::new();
fn tasks() -> &'static Mutex<HashMap<String, Arc<Task>>> {
    TASKS.get_or_init(Default::default)
}

impl Task {
    #[cfg(test)]
    fn select_resolution(&self, resolution: u32) {
        self.select_download(Some(resolution), false);
    }
    fn select_download(&self, resolution: Option<u32>, audio_only: bool) {
        let mut selection = self.selection.lock().unwrap();
        let valid = selection.offered && if audio_only {
            resolution.is_none() && selection.audio.is_some()
        } else {
            resolution.map_or(selection.available.is_empty(), |n| selection.available.contains(&n))
        };
        if selection.chosen.is_none() && valid {
            selection.chosen = Some(if audio_only { DownloadChoice::Mp3 } else { DownloadChoice::Video(resolution) });
            self.selection_changed.notify_all();
        }
    }
    fn has_selection(&self) -> bool {
        self.selection.lock().unwrap().offered || self.request.resolution.is_some() || self.request.audio_only
    }
    fn check(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::Relaxed) {
            Err("Download cancelled".into())
        } else {
            Ok(())
        }
    }
    fn update(
        &self,
        app: &AppHandle,
        status: &str,
        message: &str,
        downloaded: u64,
        total: Option<u64>,
    ) {
        let payload = {
            let mut p = self.progress.lock().unwrap();
            p.status = status.into();
            p.message = message.into();
            p.downloaded = downloaded;
            p.total = total;
            p.percent = total
                .filter(|n| *n > 0)
                .map(|n| (downloaded as f64 / n as f64 * 100.).clamp(0., 100.));
            p.revision += 1;
            p.clone()
        };
        self.emit(app, &payload);
    }
    fn emit(&self, app: &AppHandle, payload: &Progress) {
        let mut entry = crate::downloads::Entry::new("video", &payload.id, &payload.title);
        entry.status = payload.status.clone(); entry.message = payload.message.clone();
        entry.downloaded = payload.downloaded; entry.total = payload.total;
        entry.percent = payload.percent; entry.filename = payload.filename.clone();
        entry.cancelable = busy(&payload.status);
        entry.retryable = matches!(payload.status.as_str(), "error" | "cancelled");
        crate::downloads::publish(app, entry);
        let _ = app.emit_to("main", "video-download-progress", payload);
        if let Some(view) = app.get_webview(&self.label) {
            let _ = view.eval(&format!(
                "window.dispatchEvent(new CustomEvent('auraview-video-result', {{detail: {}}}));",
                serde_json::to_string(payload).unwrap()
            ));
        }
    }
}

fn http_url(value: &str) -> Option<tauri::Url> {
    let url = tauri::Url::parse(value).ok()?;
    (value.len() <= 16384
        && matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && !value.chars().any(char::is_control))
    .then_some(url)
}
fn site(host: &str) -> &str {
    if host == "youtu.be"
        || host == "youtube-nocookie.com"
        || host.ends_with(".youtube-nocookie.com")
        || host == "youtube.com"
        || host.ends_with(".youtube.com")
    {
        "youtube.com"
    } else if host == "instagram.com" || host.ends_with(".instagram.com") {
        "instagram.com"
    } else if matches!(host, "x.com" | "twitter.com")
        || host.ends_with(".x.com")
        || host.ends_with(".twitter.com")
    {
        "x.com"
    } else {
        host
    }
}
fn validate(request: &Request, source: &str) -> bool {
    let valid_id = !request.id.is_empty()
        && request.id.len() <= 80
        && request
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-');
    if !valid_id
        || request.title.len() > 1024
        || (request.audio_only && request.resolution.is_some())
        || request.resolution.is_some_and(|n| n == 0 || n > 32768)
        || (!request.poster.is_empty() && http_url(&request.poster).is_none())
        || request.instagram_video_id.len() > 40
        || !request.instagram_video_id.bytes().all(|b| b.is_ascii_digit())
        || request.streams.len() > 8
        || request.streams.iter().any(|hint| {
            http_url(&hint.url).is_none()
                || hint.mime.len() > 256
                || !matches!(
                    hint.kind.as_str(),
                    "manifest" | "video" | "audio" | "combined"
                )
        })
        || request
            .duration
            .is_some_and(|duration| !duration.is_finite() || duration <= 0.)
    {
        return false;
    }
    let media = http_url(&request.url).is_some()
        || tauri::Url::parse(&request.url).is_ok_and(|u| u.scheme() == "blob");
    let page = http_url(&request.page_url)
        .zip(http_url(source))
        .is_some_and(|(page, origin)| {
            site(page.host_str().unwrap_or("")) == site(origin.host_str().unwrap_or(""))
        });
    (media || page || !request.streams.is_empty())
        && (request.page_url.is_empty() || page)
        && (!request.stream_only || request.page_url.is_empty())
}

#[tauri::command]
pub fn list_video_downloads(webview: tauri::Webview) -> Result<Vec<Progress>, String> {
    if webview.label() != "main" {
        return Err("Downloads are managed from AuraView".into());
    }
    Ok(tasks()
        .lock()
        .unwrap()
        .values()
        .map(|t| t.progress.lock().unwrap().clone())
        .collect())
}
#[tauri::command]
pub fn cancel_video_download(webview: tauri::Webview, id: String) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Downloads are managed from AuraView".into());
    }
    if let Some(task) = tasks().lock().unwrap().get(&id) {
        task.cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}
#[tauri::command]
pub fn retry_video_download(
    app: AppHandle,
    webview: tauri::Webview,
    id: String,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Downloads are managed from AuraView".into());
    }
    let task = tasks()
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or("Download is no longer available")?;
    if busy(&task.progress.lock().unwrap().status) {
        return Ok(());
    }
    let view = app
        .get_webview(&task.label)
        .or_else(|| if !task.request.page_url.is_empty() {
            app.webviews().into_iter().find(|(label, _)| label.starts_with("browser-")).map(|(_, view)| view)
        } else { None })
        .ok_or("Reopen the video’s page and use its download button")?;
    let mut request = task.request.clone();
    if let Some(choice) = task.selection.lock().unwrap().chosen {
        request.audio_only = choice == DownloadChoice::Mp3;
        request.resolution = match choice { DownloadChoice::Video(n) => n, DownloadChoice::Mp3 => None };
    }
    request.id = crate::image_download::token();
    start(app, view, request, task.source.clone());
    Ok(())
}

fn start(app: AppHandle, view: tauri::Webview, request: Request, source: String) {
    let task = Arc::new(Task {
        progress: Mutex::new(Progress {
            id: request.id.clone(),
            title: request
                .title
                .chars()
                .filter(|c| !c.is_control())
                .take(160)
                .collect(),
            status: "preparing".into(),
            message: "Preparing video…".into(),
            downloaded: 0,
            total: None,
            percent: None,
            filename: None,
            revision: 0,
            resolutions: Vec::new(),
            audio_option: None,
        }),
        request,
        source,
        label: view.label().into(),
        cancel: AtomicBool::new(false),
        selection: Mutex::new(Selection::default()),
        selection_changed: Condvar::new(),
    });
    {
        let mut registry = tasks().lock().unwrap();
        if registry.contains_key(&task.request.id) {
            return;
        }
        if registry.len() >= 60 {
            registry.retain(|id, t| busy(&t.progress.lock().unwrap().status) || crate::downloads::contains(&format!("video:{id}")));
        }
        let active = registry
            .values()
            .filter(|t| busy(&t.progress.lock().unwrap().status))
            .count();
        registry.insert(task.request.id.clone(), task.clone());
        if active >= 4 {
            drop(registry);
            task.update(
                &app,
                "error",
                "Four videos are already downloading. Retry when one finishes.",
                0,
                None,
            );
            return;
        }
    }
    task.update(&app, "preparing", "Preparing video…", 0, None);
    tauri::async_runtime::spawn(async move {
        let result = download(&app, &view, &task).await;
        match result {
            Ok(path) => {
                crate::downloads::remember("video", &task.request.id, &path, crate::downloads::Replay::Video(task.request.id.clone()));
                task.progress.lock().unwrap().filename =
                    path.file_name().map(|n| n.to_string_lossy().into_owned());
                task.update(&app, "saved", "Saved to Downloads", 0, None);
            }
            Err(_) if task.cancel.load(Ordering::Relaxed) => {
                task.update(&app, "cancelled", "Download cancelled.", 0, None)
            }
            Err(error) => task.update(&app, "error", &error, 0, None),
        }
    });
}

// All intermediates (including session cookies) live in a fresh private job directory.
// Only the completed media file is published to Downloads. Drop cleans every exit path.
struct WorkDir(PathBuf);
impl WorkDir {
    fn new(root: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let path = root.join(format!("video-{}", crate::image_download::token()));
        std::fs::create_dir(&path).map_err(|e| e.to_string())?;
        Ok(Self(path))
    }
}
impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn safe_stem(title: &str) -> String {
    let clean: String = title
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*%".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(100)
        .collect();
    let clean = clean.trim_matches(|c: char| c == '.' || c.is_whitespace());
    let base = clean.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(
        base.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || (base.len() == 4
        && (base.starts_with("COM") || base.starts_with("LPT"))
        && base.as_bytes()[3].is_ascii_digit());
    if clean.is_empty() {
        "Video".into()
    } else {
        format!("{}{clean}", if reserved { "_" } else { "" })
    }
}
fn extension(mime: &str, head: &[u8]) -> Result<&'static str, String> {
    // Validate the actual container, even when the server sends a video MIME type.
    if head.get(4..8) == Some(b"ftyp") {
        Ok("mp4")
    } else if head.starts_with(b"\x1a\x45\xdf\xa3") {
        Ok(if mime.contains("webm") { "webm" } else { "mkv" })
    } else if head.starts_with(b"OggS") {
        Ok("ogv")
    } else if head.starts_with(b"RIFF") && head.get(8..12) == Some(b"AVI ") {
        Ok("avi")
    } else {
        Err("This player uses a stream that needs video extraction".into())
    }
}
fn publish(
    file: &Path,
    downloads: &Path,
    title: &str,
    ext: &str,
    task: &Task,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(downloads).map_err(|e| e.to_string())?;
    let stem = safe_stem(title);
    for index in 0..10000 {
        task.check()?;
        let path = downloads.join(if index == 0 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem} ({index}).{ext}")
        });
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut target) => {
                let result = (|| {
                    let mut source = File::open(file).map_err(|e| e.to_string())?;
                    let mut buf = vec![0; 1024 * 1024];
                    loop {
                        task.check()?;
                        let n = source.read(&mut buf).map_err(|e| e.to_string())?;
                        if n == 0 {
                            break;
                        }
                        target.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                    }
                    target.flush().map_err(|e| e.to_string())
                })();
                drop(target);
                if let Err(error) = result {
                    let _ = std::fs::remove_file(&path);
                    return Err(error);
                }
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Too many videos with the same filename".into())
}

#[cfg(windows)]
async fn download(
    app: &AppHandle,
    view: &tauri::Webview,
    task: &Arc<Task>,
) -> Result<PathBuf, String> {
    let work = WorkDir::new(
        &app.path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("video-downloads"),
    )?;
    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    let youtube = http_url(&task.request.page_url)
        .is_some_and(|u| site(u.host_str().unwrap_or("")) == "youtube.com");
    let inspect_first = !task.request.page_url.is_empty()
        || task.request.streams.iter().any(|hint| hint.kind == "manifest")
        || instagram_story_target(&task.source).is_some();
    if !youtube && !inspect_first && !task.request.url.is_empty() {
        if let Ok(path) = try_direct(app, view, task, &work, &downloads).await {
            return Ok(path);
        }
        task.check()?;
    }
    let result = extract_download(app, view, task, work, &downloads).await;
    if result.is_err() && !youtube && inspect_first && !task.has_selection()
        && !task.request.url.is_empty()
        && !result.as_ref().unwrap_err().contains("protected")
        && !result.as_ref().unwrap_err().contains("Live-stream") {
        task.check()?;
        let fallback = WorkDir::new(&app.path().app_cache_dir().map_err(|e| e.to_string())?.join("video-downloads"))?;
        if let Ok(path) = try_direct(app, view, task, &fallback, &downloads).await {
            return Ok(path);
        }
    }
    result
}
#[cfg(windows)]
async fn try_direct(app: &AppHandle, view: &tauri::Webview, task: &Arc<Task>, work: &WorkDir, downloads: &Path) -> Result<PathBuf, String> {
    let file = work.0.join("direct.media");
    let direct = if task.request.url.starts_with("blob:") {
        blob_video(app, view, task, &file).await
    } else {
        direct_video(app, view, task, &file).await
    };
    if let Ok(ext) = direct {
        task.check()?;
        let file_copy = file.clone();
        let downloads = downloads.to_path_buf();
        let task_copy = task.clone();
        let app_copy = app.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            let tools = tool_dir(&app_copy)?;
            let audio = probe_video(&tools, &file_copy, &task_copy)?;
            // A streaming player may expose a video-only MP4. Resolve its
            // permalink to retrieve audio rather than silently saving that track.
            if !audio && (!task_copy.request.page_url.is_empty()
                || instagram_story_target(&task_copy.source).is_some()) {
                return Err("Resolve separate audio".into());
            }
            let mut info = json!({"formats": [{"vcodec": "unknown", "acodec": if audio { "unknown" } else { "none" }}]});
            if choose_resolution(&app_copy, &task_copy, &mut info)? {
                task_copy.update(&app_copy, "merging", "Converting to MP3…", 0, None);
                let audio = convert_mp3(&tools, &file_copy, file_copy.parent().unwrap(), &task_copy)?;
                task_copy.update(&app_copy, "saving", "Saving MP3…", 0, None);
                return publish(&audio, &downloads, &task_copy.request.title, "mp3", &task_copy);
            }
            task_copy.update(&app_copy, "saving", "Saving video…", 0, None);
            publish(&file_copy, &downloads, &task_copy.request.title, ext, &task_copy)
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    task.check()?;
    Err("Unable to download the direct video".into())
}
#[cfg(windows)]
async fn extract_download(app: &AppHandle, view: &tauri::Webview, task: &Arc<Task>, work: WorkDir, downloads: &Path) -> Result<PathBuf, String> {
    task.update(app, "preparing", "Resolving video and audio…", 0, None);
    // Story playback can be authenticated even when Instagram rejects the
    // external extractor's webpage lookup. Resolve that exact story in its tab.
    let story = instagram_story(view, task).await.ok();
    task.check()?;
    let url = if !task.request.page_url.is_empty() && !task.request.stream_only {
        Some(task.request.page_url.clone())
    } else if http_url(&task.request.url).is_some() {
        Some(task.request.url.clone())
    } else if !task.request.streams.is_empty() || story.is_some() {
        None
    } else {
        return Err(
            "Could not identify this video. Open its individual post or watch page and retry."
                .into(),
        );
    };
    let cookie_urls: Vec<_> = [&task.source, &task.request.page_url, &task.request.url]
        .into_iter()
        .chain(task.request.streams.iter().map(|hint| &hint.url))
        .filter(|s| http_url(s).is_some())
        .collect();
    let cookies = devtools(view, "Network.getCookies", json!({"urls": cookie_urls}))
        .await
        .map_err(|_| "Unable to read this page’s session. Keep its tab open and retry.")?;
    let cookies_path = work.0.join("session.txt");
    std::fs::write(&cookies_path, cookie_file(&cookies["cookies"])?).map_err(|e| e.to_string())?;
    let browser = devtools(view, "Browser.getVersion", json!({}))
        .await
        .unwrap_or_default();
    let user_agent = browser["userAgent"].as_str().unwrap_or("").to_string();
    let app_copy = app.clone();
    let task = task.clone();
    let downloads = downloads.to_path_buf();
    // Moving the directory guard into the worker also keeps cookies alive through cancellation.
    tauri::async_runtime::spawn_blocking(move || {
        extract_video(
            &app_copy,
            &task,
            work,
            &downloads,
            url.as_deref(),
            &cookies_path,
            &user_agent,
            story,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(not(windows))]
async fn download(_: &AppHandle, _: &tauri::Webview, _: &Arc<Task>) -> Result<PathBuf, String> {
    Err("Video downloads require the Windows desktop app".into())
}

fn header<'a>(headers: &'a Value, name: &str) -> Option<&'a str> {
    headers
        .as_object()?
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))?
        .1
        .as_str()
}
fn decode_chunk(chunk: &Value) -> Result<Vec<u8>, String> {
    let data = chunk["data"]
        .as_str()
        .ok_or("Video stream returned no data")?;
    if data.len() > 2 * 1024 * 1024 {
        return Err("Video stream chunk is too large".into());
    }
    if chunk["base64Encoded"].as_bool() == Some(true) {
        STANDARD.decode(data).map_err(|e| e.to_string())
    } else {
        Ok(data.as_bytes().to_vec())
    }
}
#[cfg(windows)]
async fn frame(view: &tauri::Webview, source: &str) -> Result<String, String> {
    let tree = devtools(view, "Page.getFrameTree", json!({})).await?;
    frame_for_source(&tree["frameTree"], source)
        .ok_or("The video’s frame has navigated away".into())
}

fn instagram_story_target(url: &str) -> Option<(String, Option<String>)> {
    let url = http_url(url)?;
    if !matches!(url.host_str()?, "instagram.com" | "www.instagram.com") {
        return None;
    }
    let parts: Vec<_> = url.path().trim_end_matches('/').split('/').collect();
    if !matches!(parts.len(), 3 | 4)
        || parts[1] != "stories"
        || parts[2].eq_ignore_ascii_case("highlights")
        || parts[2].is_empty()
        || !parts[2].bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.'))
        || (parts.len() == 4 && (parts[3].is_empty() || !parts[3].bytes().all(|b| b.is_ascii_digit())))
    {
        return None;
    }
    Some((parts[2].into(), parts.get(3).map(|id| id.to_string())))
}

#[cfg(windows)]
async fn instagram_story(view: &tauri::Webview, task: &Task) -> Result<Value, String> {
    let (username, id) = instagram_story_target(&task.request.page_url)
        .or_else(|| instagram_story_target(&task.source))
        .ok_or("Not an Instagram story")?;
    let frame = frame(view, &task.source).await?;
    task.check()?;
    let world = devtools(
        view, "Page.createIsolatedWorld",
        json!({"frameId": frame, "worldName": "AuraView story downloads"}),
    ).await?;
    let context = world["executionContextId"].as_u64()
        .ok_or("Story frame is no longer available")?;
    let expression = format!(
        "({})({})", include_str!("instagram-story.js"),
        json!({"storyId": id, "username": username, "poster": task.request.poster, "mediaUrl": task.request.url,
            "playerId": task.request.instagram_video_id}),
    );
    let response = devtools(
        view, "Runtime.evaluate", json!({"contextId": context,
        "expression": expression, "awaitPromise": true, "returnByValue": true}),
    ).await?;
    task.check()?;
    if !response["exceptionDetails"].is_null() {
        return Err("Unable to resolve the story in this session".into());
    }
    let mut info = instagram_story_metadata(&task.request, id.as_deref(), &response["result"]["value"])?;
    info["webpage_url"] = json!(format!(
        "https://www.instagram.com/stories/{username}/{}/", info["id"].as_str().unwrap()
    ));
    Ok(info)
}

fn instagram_story_metadata(
    request: &Request, expected: Option<&str>, item: &Value,
) -> Result<Value, String> {
    let id = item["id"].as_str()
        .filter(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()))
        .ok_or("The story response did not identify the selected story")?;
    if expected.is_some_and(|expected| id != expected) {
        return Err("The story response did not match the selected story".into());
    }
    let formats: Vec<_> = item["video_versions"].as_array().into_iter().flatten().enumerate()
        .filter_map(|(index, version)| {
            let url = http_url(version["url"].as_str()?)?;
            Some(json!({"format_id": format!("story-{index}"), "url": url.as_str(),
                "width": version["width"].as_u64(), "height": version["height"].as_u64(),
                "ext": "mp4", "vcodec": "unknown",
                "acodec": if item["has_audio"] == false {"none"} else {"unknown"}}))
        })
        .collect();
    if formats.is_empty() {
        return Err("No complete video was available for this story".into());
    }
    Ok(json!({"id": id, "title": request.title, "webpage_url": request.page_url,
        "extractor": "AuraView Instagram story", "formats": formats,
        "duration": item["video_duration"].as_f64(),
        "http_headers": {"Referer": "https://www.instagram.com/"}}))
}
#[cfg(windows)]
async fn direct_video(
    app: &AppHandle,
    view: &tauri::Webview,
    task: &Task,
    path: &Path,
) -> Result<&'static str, String> {
    let frame = frame(view, &task.source).await?;
    task.check()?;
    let response = devtools(
        view,
        "Network.loadNetworkResource",
        json!({"frameId": frame, "url": task.request.url,
        "options": {"disableCache": false, "includeCredentials": true}}),
    )
    .await?;
    save_response_with(
        &response["resource"],
        path,
        |method, params| devtools(view, method, params),
        || task.check(),
        |size, total| task.update(app, "downloading", "Downloading video…", size, total),
    )
    .await
}

async fn save_response_with<F, Fut, C, P>(
    resource: &Value,
    path: &Path,
    mut call: F,
    check: C,
    mut progress: P,
) -> Result<&'static str, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: std::future::Future<Output = Result<Value, String>>,
    C: Fn() -> Result<(), String>,
    P: FnMut(u64, Option<u64>),
{
    let stream = resource["stream"]
        .as_str()
        .ok_or("The video server refused the request")?;
    let result = async {
        if resource["success"] != true || resource["httpStatusCode"].as_u64() != Some(200) {
            return Err("The server did not return a complete video".into());
        }
        let total =
            header(&resource["headers"], "content-length").and_then(|s| s.parse::<u64>().ok());
        let mut file = File::create(path).map_err(|e| e.to_string())?;
        let mut size = 0;
        let mut head = Vec::new();
        let mut format = None;
        loop {
            check()?;
            let chunk = call("IO.read", json!({"handle": stream, "size": 256 * 1024})).await?;
            let bytes = decode_chunk(&chunk)?;
            if !bytes.is_empty() {
                if head.len() < 64 {
                    head.extend_from_slice(&bytes[..bytes.len().min(64 - head.len())]);
                }
                if format.is_none() && head.len() >= 16 {
                    format = Some(extension(
                        header(&resource["headers"], "content-type").unwrap_or(""),
                        &head,
                    )?);
                }
                file.write_all(&bytes).map_err(|e| e.to_string())?;
                size += bytes.len() as u64;
                progress(size, total);
            }
            if chunk["eof"].as_bool() == Some(true) {
                break;
            }
            if bytes.is_empty() {
                return Err("The video stream stopped before completion".into());
            }
        }
        if size == 0 || total.is_some_and(|total| size != total) {
            return Err("The video download is incomplete".into());
        }
        file.flush().map_err(|e| e.to_string())?;
        if let Some(format) = format {
            Ok(format)
        } else {
            extension(
                header(&resource["headers"], "content-type").unwrap_or(""),
                &head,
            )
        }
    }
    .await;
    let _ = call("IO.close", json!({"handle": stream})).await;
    result
}

#[cfg(windows)]
async fn evaluate(
    view: &tauri::Webview,
    context: u64,
    expression: String,
) -> Result<Value, String> {
    let response = devtools(
        view,
        "Runtime.evaluate",
        json!({"contextId": context, "expression": expression,
        "awaitPromise": true, "returnByValue": true}),
    )
    .await?;
    if !response["exceptionDetails"].is_null() {
        return Err("This blob is a streaming player, rather than a complete video file".into());
    }
    Ok(response["result"]["value"].clone())
}
#[cfg(windows)]
async fn blob_video(
    app: &AppHandle,
    view: &tauri::Webview,
    task: &Task,
    path: &Path,
) -> Result<&'static str, String> {
    let frame = frame(view, &task.source).await?;
    let world = devtools(
        view,
        "Page.createIsolatedWorld",
        json!({"frameId": frame, "worldName": "AuraView video downloads"}),
    )
    .await?;
    let context = world["executionContextId"]
        .as_u64()
        .ok_or("Video frame is no longer available")?;
    let key = serde_json::to_string(&format!("auraview-{}", task.request.id)).unwrap();
    let url = serde_json::to_string(&task.request.url).unwrap();
    let result = async {
        let info = evaluate(view, context, format!("(async()=>{{const r=await fetch({url});if(!r.ok)throw Error();const b=await r.blob();globalThis[{key}]=b;return {{size:b.size,type:b.type}}}})()" )).await?;
        let size = info["size"].as_u64().filter(|n| *n > 0).ok_or("The video blob is empty")?;
        let mut file = File::create(path).map_err(|e| e.to_string())?; let mut offset = 0; let mut ext = None;
        while offset < size {
            task.check()?;
            let chunk = evaluate(view, context, format!("(async()=>{{const b=globalThis[{key}].slice({offset},{});return await new Promise((ok,no)=>{{const r=new FileReader();r.onload=()=>ok(r.result.split(',')[1]);r.onerror=no;r.readAsDataURL(b)}})}})()", (offset + 256 * 1024).min(size))).await?;
            let bytes = decode_chunk(&json!({"data": chunk, "base64Encoded": true}))?;
            if bytes.is_empty() { return Err("The video blob ended early".into()); }
            if ext.is_none() { ext = Some(extension(info["type"].as_str().unwrap_or(""), &bytes)?); }
            file.write_all(&bytes).map_err(|e| e.to_string())?; offset += bytes.len() as u64;
            task.update(app, "downloading", "Downloading video…", offset, Some(size));
        }
        file.flush().map_err(|e| e.to_string())?; ext.ok_or("No video data was received".into())
    }.await;
    let _ = evaluate(view, context, format!("delete globalThis[{key}]")).await;
    result
}

fn cookie_file(cookies: &Value) -> Result<String, String> {
    let mut text = String::from("# Netscape HTTP Cookie File\n");
    for cookie in cookies.as_array().ok_or("Unable to read browser cookies")? {
        let field = |name: &str| -> Result<&str, String> {
            let value = cookie[name].as_str().unwrap_or("");
            if value
                .chars()
                .any(|c| matches!(c, '\t' | '\r' | '\n' | '\0'))
            {
                return Err("Invalid browser cookie".into());
            }
            Ok(value)
        };
        let domain = field("domain")?;
        let expires = cookie["expires"].as_f64().unwrap_or(0.).max(0.) as u64;
        text.push_str(&format!(
            "{}{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
            if cookie["httpOnly"] == true {
                "#HttpOnly_"
            } else {
                ""
            },
            domain,
            if domain.starts_with('.') {
                "TRUE"
            } else {
                "FALSE"
            },
            field("path")?,
            if cookie["secure"] == true {
                "TRUE"
            } else {
                "FALSE"
            },
            expires,
            field("name")?,
            field("value")?
        ));
    }
    Ok(text)
}

fn tool_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/download-tools")
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("download-tools")
    };
    for tool in ["yt-dlp.exe", "ffmpeg.exe", "ffprobe.exe", "deno.exe"] {
        if !root.join(tool).is_file() {
            return Err(
                "Video tools are missing. Run npm run prepare:video-tools, then restart AuraView."
                    .into(),
            );
        }
    }
    Ok(root)
}
fn extractor_args(
    tools: &Path,
    work: &Path,
    cookies: &Path,
    source: &str,
    agent: &str,
) -> Vec<String> {
    vec![
        "--ignore-config".into(),
        "--no-plugin-dirs".into(),
        "--no-playlist".into(),
        "--no-cache-dir".into(),
        "--no-colors".into(),
        "--newline".into(),
        "--socket-timeout".into(),
        "20".into(),
        "--retries".into(),
        "3".into(),
        "--no-js-runtimes".into(),
        "--js-runtimes".into(),
        format!("deno:{}", tools.join("deno.exe").display()),
        "--ffmpeg-location".into(),
        tools.to_string_lossy().into_owned(),
        "--cookies".into(),
        cookies.to_string_lossy().into_owned(),
        "--referer".into(),
        source.into(),
        "--user-agent".into(),
        agent.into(),
        "--paths".into(),
        work.to_string_lossy().into_owned(),
        "--windows-filenames".into(),
        "--output".into(),
        "media.%(ext)s".into(),
        "--format".into(),
        "bv*+ba/b".into(),
        "--format-sort".into(),
        "res,ext:mp4:m4a".into(),
        "--merge-output-format".into(),
        "mp4/mkv".into(),
    ]
}

fn metadata(mut info: Value) -> Result<Value, String> {
    if let Some(entries) = info["entries"].as_array() {
        // A carousel/playlist must not silently turn into the first item.
        if entries.len() != 1 {
            return Err(
                "This post contains multiple videos. Open the individual video and retry.".into(),
            );
        }
        info = entries[0].clone();
    }
    if info["is_live"] == true || info["live_status"] == "is_live" {
        return Err("Live-stream recording is not supported yet".into());
    }
    if info["has_drm"] == true {
        return Err("This video is protected. Downloading is unavailable.".into());
    }
    if info["formats"]
        .as_array()
        .is_some_and(|formats| !formats.is_empty() && formats.iter().all(|f| f["has_drm"] == true))
    {
        return Err("This video is protected. Downloading is unavailable.".into());
    }
    Ok(info)
}

fn video_resolution(format: &Value) -> Option<u32> {
    if format["vcodec"] == "none" || format["has_drm"] == true
        || format["ext"] == "mhtml" || format["protocol"] == "mhtml" {
        return None;
    }
    let height = format["height"].as_u64()?;
    let width = format["width"].as_u64().filter(|n| *n > 0).unwrap_or(height);
    u32::try_from(height.min(width)).ok().filter(|n| *n > 0 && *n <= 32768)
}
fn resolutions(info: &Value) -> Vec<u32> {
    let mut choices: Vec<_> = info["formats"].as_array().into_iter().flatten()
        .filter_map(video_resolution).collect();
    choices.sort_unstable_by(|a, b| b.cmp(a));
    choices.dedup();
    choices
}
fn restrict_resolution(info: &mut Value, resolution: u32) -> Result<(), String> {
    if !resolutions(info).contains(&resolution) {
        return Err("The selected resolution is no longer available. Retry this video.".into());
    }
    if let Some(formats) = info["formats"].as_array_mut() {
        // Keep all audio choices, but only video tracks at the selected resolution.
        formats.retain(|f| f["has_drm"] != true && f["ext"] != "mhtml" && f["protocol"] != "mhtml"
            && ((f["vcodec"] == "none" && f["acodec"] != "none")
                || video_resolution(f) == Some(resolution)));
    }
    // The probe can include an already-selected best format. Force a fresh
    // selection from the restricted list when loading the saved metadata.
    clear_preselected_format(info);
    Ok(())
}
fn audio_option(info: &Value) -> Option<&'static str> {
    let formats: Vec<_> = info["formats"].as_array().map(|f| f.iter().collect())
        .unwrap_or_else(|| vec![info]);
    let playable: Vec<_> = formats.into_iter().filter(|f| f["has_drm"] != true
        && f["ext"] != "mhtml" && f["protocol"] != "mhtml").collect();
    if playable.iter().any(|f| f["vcodec"] == "none" && f["acodec"] != "none") {
        Some("download")
    } else if playable.iter().any(|f| f["vcodec"] != "none" && f["acodec"] != "none") {
        // Unknown codecs still allow extraction to determine whether audio exists.
        Some("convert")
    } else { None }
}
fn clear_preselected_format(info: &mut Value) {
    if let Some(object) = info.as_object_mut() {
        for key in ["requested_formats", "requested_downloads", "url", "format", "format_id"] {
            object.remove(key);
        }
    }
}
fn audio_download_args(info: &mut Value, args: &mut Vec<String>) -> Result<(), String> {
    let mode = audio_option(info).ok_or("This video has no downloadable audio track")?;
    if mode == "download" {
        if let Some(formats) = info["formats"].as_array_mut() {
            formats.retain(|f| f["vcodec"] == "none" && f["acodec"] != "none"
                && f["has_drm"] != true && f["ext"] != "mhtml" && f["protocol"] != "mhtml");
        }
    }
    if info["formats"].as_array().is_some_and(|f| !f.is_empty()) {
        clear_preselected_format(info);
    }
    // Use the original MP3 when one exists; other audio containers are encoded
    // locally. Without a separate track, download a combined video into cache.
    let selector = if mode == "download" { "ba[ext=mp3]/ba" } else { "b[acodec!=none]/bv*+ba/b" };
    let index = args.iter().position(|arg| arg == "--format").ok_or("Missing format selector")?;
    args[index + 1] = selector.into();
    Ok(())
}
fn choose_resolution(app: &AppHandle, task: &Task, info: &mut Value) -> Result<bool, String> {
    let available = resolutions(info);
    let audio = audio_option(info);
    let previous = task.selection.lock().unwrap().chosen.or_else(|| {
        if task.request.audio_only { Some(DownloadChoice::Mp3) }
        else { task.request.resolution.map(|n| DownloadChoice::Video(Some(n))) }
    });
    let chosen = if previous.is_some() { previous } else if available.len() > 1 || audio.is_some() {
        {
            let mut selection = task.selection.lock().unwrap();
            selection.available = available.clone(); selection.audio = audio; selection.offered = true;
        }
        {
            let mut progress = task.progress.lock().unwrap();
            progress.resolutions = available; progress.audio_option = audio.map(str::to_string);
        }
        task.update(app, "preparing", "Choose a video resolution or MP3", 0, None);
        // This runs on the blocking extraction worker, leaving the webview free
        // to receive the selection or cancellation. Abandoned menus expire.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
        let mut selection = task.selection.lock().unwrap();
        loop {
            task.check()?;
            if let Some(chosen) = selection.chosen { break Some(chosen); }
            if std::time::Instant::now() >= deadline {
                return Err("Download selection expired. Click the video download button to retry.".into());
            }
            selection = task.selection_changed.wait_timeout(selection, std::time::Duration::from_millis(250))
                .unwrap().0;
        }
    } else { None };
    {
        let mut progress = task.progress.lock().unwrap();
        progress.resolutions.clear(); progress.audio_option = None;
    }
    if let Some(DownloadChoice::Video(Some(resolution))) = chosen { restrict_resolution(info, resolution)?; }
    if chosen == Some(DownloadChoice::Mp3) && audio.is_none() {
        return Err("This video has no downloadable audio track".into());
    }
    task.selection.lock().unwrap().chosen = chosen;
    let mp3 = chosen == Some(DownloadChoice::Mp3);
    task.update(app, "preparing", if mp3 { "Preparing MP3 audio…" } else { "Preparing video and audio…" }, 0, None);
    Ok(mp3)
}
fn extract_video(
    app: &AppHandle,
    task: &Task,
    work: WorkDir,
    downloads: &Path,
    url: Option<&str>,
    cookies: &Path,
    agent: &str,
    story: Option<Value>,
) -> Result<PathBuf, String> {
    let tools = tool_dir(app)?;
    if let Some(info) = story {
        let directory = work.0.join("story");
        std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
        match extract_one(app, task, &tools, &directory, downloads, None, cookies, agent, Some(info)) {
            Ok(path) => return Ok(path),
            Err(error) => {
                task.check()?;
                if error.contains("protected") || error.contains("Live-stream")
                    || task.has_selection() {
                    return Err(error);
                }
            }
        }
    }
    let mut primary_error = None;
    if let Some(url) = url {
        let directory = work.0.join("primary");
        std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
        match extract_one(
            app,
            task,
            &tools,
            &directory,
            downloads,
            Some(url),
            cookies,
            agent,
            None,
        ) {
            Ok(path) => return Ok(path),
            Err(error) => {
                task.check()?;
                // Preserve DRM/live restrictions and avoid changing existing
                // successful site extraction. Discovery is a fallback only.
                if error.contains("protected") || error.contains("Live-stream")
                    || task.has_selection() {
                    return Err(error);
                }
                primary_error = Some(error);
            }
        }
    }
    if task.request.streams.is_empty() {
        return Err(primary_error.unwrap_or_else(|| {
            "Could not identify the media currently playing. Play the video briefly and retry."
                .into()
        }));
    }
    task.update(
        app,
        "preparing",
        "Resolving the playing media stream…",
        0,
        None,
    );
    let directory = work.0.join("stream");
    std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
    if task.request.streams.len() == 1 && task.request.streams[0].kind == "manifest" {
        extract_one(
            app,
            task,
            &tools,
            &directory,
            downloads,
            Some(&task.request.streams[0].url),
            cookies,
            agent,
            None,
        )
    } else {
        let info = stream_metadata(&task.request)?;
        extract_one(
            app,
            task,
            &tools,
            &directory,
            downloads,
            None,
            cookies,
            agent,
            Some(info),
        )
    }
}

fn stream_metadata(request: &Request) -> Result<Value, String> {
    if request.streams.is_empty()
        || request.streams.iter().any(|hint| hint.kind == "manifest")
        || !request
            .streams
            .iter()
            .any(|hint| matches!(hint.kind.as_str(), "video" | "combined"))
    {
        return Err("The playing stream could not be identified unambiguously".into());
    }
    let formats: Vec<_> = request.streams.iter().enumerate().map(|(index, hint)| {
        let mime = hint.mime.to_ascii_lowercase();
        json!({"format_id": format!("playing-{index}"), "url": hint.url,
            "ext": if mime.contains("webm") {"webm"} else if hint.kind == "audio" {"m4a"} else {"mp4"},
            "vcodec": if hint.kind == "audio" {"none"} else {"unknown"},
            "acodec": if hint.kind == "video" {"none"} else {"unknown"},
            "protocol": "https"})
    }).collect();
    Ok(
        json!({"id": request.id, "title": request.title, "duration": request.duration, "formats": formats,
        "extractor": "AuraView playing stream", "webpage_url": request.url}),
    )
}

fn extract_one(
    app: &AppHandle,
    task: &Task,
    tools: &Path,
    work: &Path,
    downloads: &Path,
    url: Option<&str>,
    cookies: &Path,
    agent: &str,
    supplied: Option<Value>,
) -> Result<PathBuf, String> {
    task.check()?;
    let mut args = extractor_args(tools, work, cookies, &task.source, agent);
    let mut probe_args = args.clone();
    probe_args.extend([
        "--dump-single-json".into(),
        "--skip-download".into(),
        "--".into(),
        url.unwrap_or_default().into(),
    ]);
    let mut metadata_json = String::new();
    let fallback = supplied.is_some() || work.file_name().is_some_and(|name| name == "stream");
    let mut info = if let Some(info) = supplied {
        metadata(info)?
    } else {
        run_tool(&tools.join("yt-dlp.exe"), &probe_args, task, |line| {
            if line.starts_with('{') {
                metadata_json = line.into();
            }
        })?;
        metadata(serde_json::from_str(&metadata_json).map_err(|_| "Unable to resolve this video")?)?
    };
    let mp3 = choose_resolution(app, task, &mut info)?;
    if mp3 { audio_download_args(&mut info, &mut args)?; }
    let title = info["title"]
        .as_str()
        .unwrap_or(&task.request.title)
        .to_string();
    let info_path = work.join("video.json");
    std::fs::write(
        &info_path,
        serde_json::to_vec(&info).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    task.check()?;
    let mut download_args = args;
    download_args.extend([
        "--progress".into(),
        "--progress-delta".into(),
        "0.4".into(),
        "--progress-template".into(),
        "download:AVPROGRESS:%(progress)j".into(),
        "--print".into(),
        "after_move:AVFILE:%(filepath)j".into(),
        "--no-quiet".into(),
        "--load-info-json".into(),
        info_path.to_string_lossy().into_owned(),
    ]);
    let mut completed = None;
    run_tool(&tools.join("yt-dlp.exe"), &download_args, task, |line| {
        if let Some(data) = line
            .strip_prefix("AVPROGRESS:")
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
        {
            let downloaded = data["downloaded_bytes"].as_u64().unwrap_or(0);
            let total = data["total_bytes"]
                .as_u64()
                .or_else(|| data["total_bytes_estimate"].as_u64());
            task.update(
                app,
                "downloading",
                if mp3 { "Downloading audio for MP3…" } else { "Downloading video and audio…" },
                downloaded,
                total,
            );
        } else if let Some(path) = line
            .strip_prefix("AVFILE:")
            .and_then(|s| serde_json::from_str::<String>(s).ok())
        {
            completed = Some(PathBuf::from(path));
        } else if line.starts_with("[Merger]") || line.starts_with("[VideoRemuxer]") {
            task.update(app, "merging", "Combining video and audio…", 0, None);
        }
    })?;
    task.check()?;
    let file = completed.ok_or("The downloader did not produce a video file")?;
    let file = file.canonicalize().map_err(|e| e.to_string())?;
    let root = work.canonicalize().map_err(|e| e.to_string())?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err("The downloader returned an invalid output file".into());
    }
    if mp3 {
        task.update(app, "merging", "Converting to MP3…", 0, None);
        let audio = convert_mp3(tools, &file, work, task)?;
        if fallback { verify_stream_duration(tools, &audio, task)?; }
        task.update(app, "saving", "Saving MP3…", 0, None);
        return publish(&audio, downloads, &title, "mp3", task);
    }
    let ext = file
        .extension()
        .and_then(|s| s.to_str())
        .filter(|s| {
            matches!(
                *s,
                "mp4" | "webm" | "mkv" | "mov" | "ogv" | "avi" | "flv" | "ts"
            )
        })
        .ok_or("Unsupported video format")?;
    probe_video(&tools, &file, task)?;
    if fallback {
        verify_stream_duration(tools, &file, task)?;
    }
    task.update(app, "saving", "Saving video…", 0, None);
    publish(&file, downloads, &title, ext, task)
}

fn convert_mp3(tools: &Path, input: &Path, work: &Path, task: &Task) -> Result<PathBuf, String> {
    task.check()?;
    let output = if input.extension().is_some_and(|ext| ext == "mp3") {
        input.to_path_buf()
    } else {
        let output = work.join("converted-audio.mp3");
        run_tool(&tools.join("ffmpeg.exe"), &[
            "-nostdin".into(), "-y".into(), "-i".into(), input.to_string_lossy().into_owned(),
            "-map".into(), "0:a:0".into(), "-vn".into(), "-c:a".into(), "libmp3lame".into(),
            "-q:a".into(), "2".into(), "-f".into(), "mp3".into(), output.to_string_lossy().into_owned(),
        ], task, |_| {})?;
        output
    };
    let mut probe = String::new();
    run_tool(&tools.join("ffprobe.exe"), &[
        "-v".into(), "error".into(), "-show_entries".into(), "stream=codec_type,codec_name".into(),
        "-of".into(), "json".into(), output.to_string_lossy().into_owned(),
    ], task, |line| probe.push_str(line))?;
    let info: Value = serde_json::from_str(&probe).map_err(|_| "Unable to verify the MP3 file")?;
    let streams = info["streams"].as_array().ok_or("Unable to verify the MP3 file")?;
    if !streams.iter().any(|s| s["codec_type"] == "audio" && s["codec_name"] == "mp3")
        || streams.iter().any(|s| s["codec_type"] == "video") {
        return Err("The converter did not produce a playable MP3 file".into());
    }
    task.check()?;
    if output != input { std::fs::remove_file(input).map_err(|e| e.to_string())?; }
    Ok(output)
}

fn verify_stream_duration(tools: &Path, file: &Path, task: &Task) -> Result<(), String> {
    let Some(expected) = task.request.duration else {
        return Ok(());
    };
    let args = vec![
        "-v".into(),
        "error".into(),
        "-show_entries".into(),
        "format=duration".into(),
        "-of".into(),
        "json".into(),
        file.to_string_lossy().into_owned(),
    ];
    let mut output = String::new();
    run_tool(&tools.join("ffprobe.exe"), &args, task, |line| {
        output.push_str(line)
    })?;
    let actual = serde_json::from_str::<Value>(&output).ok().and_then(|v| {
        v["format"]["duration"]
            .as_str()
            .and_then(|s| s.parse::<f64>().ok())
    });
    if !actual.is_some_and(|duration| stream_duration_matches(duration, expected)) {
        return Err("The discovered stream did not match this player’s full duration. Play it briefly and retry; no file was saved.".into());
    }
    Ok(())
}

fn stream_duration_matches(actual: f64, expected: f64) -> bool {
    actual.is_finite() && (actual - expected).abs() <= (expected * 0.05).max(0.5)
}

// Return whether the file also contains audio. Silent source videos remain valid.
fn probe_video(tools: &Path, file: &Path, task: &Task) -> Result<bool, String> {
    let probe = vec![
        "-v".into(),
        "error".into(),
        "-show_entries".into(),
        "stream=codec_type".into(),
        "-of".into(),
        "json".into(),
        file.to_string_lossy().into_owned(),
    ];
    let mut streams = String::new();
    run_tool(&tools.join("ffprobe.exe"), &probe, task, |line| {
        streams.push_str(line);
    })?;
    let streams: Value =
        serde_json::from_str(&streams).map_err(|_| "Unable to verify downloaded video")?;
    let tracks = streams["streams"]
        .as_array()
        .ok_or("Unable to verify downloaded video")?;
    if !tracks.iter().any(|s| s["codec_type"] == "video") {
        return Err("The downloaded file contains no playable video".into());
    }
    Ok(tracks.iter().any(|s| s["codec_type"] == "audio"))
}

// Bound both metadata and log lines. stdout/stderr are drained concurrently so the
// helper cannot deadlock on a full pipe. A Windows job kills FFmpeg/Deno too.
fn run_tool<F: FnMut(&str)>(
    program: &Path,
    args: &[String],
    task: &Task,
    mut line: F,
) -> Result<(), String> {
    use std::{
        io::BufRead,
        process::{Command, Stdio},
        sync::mpsc,
        time::{Duration, Instant},
    };
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Unable to start the video download tools")?;
    #[cfg(windows)]
    let _job = match process_job::Job::attach(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let (send, receive) = mpsc::sync_channel(16);
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let readers: Vec<Box<dyn Read + Send>> = vec![Box::new(stdout), Box::new(stderr)];
    let workers: Vec<_> = readers
        .into_iter()
        .map(|reader| {
            let send = send.clone();
            std::thread::spawn(move || {
                let mut reader = std::io::BufReader::new(reader);
                loop {
                    let mut bytes = Vec::new();
                    match reader
                        .by_ref()
                        .take(16 * 1024 * 1024 + 1)
                        .read_until(b'\n', &mut bytes)
                    {
                        Ok(0) => break,
                        Ok(_) if bytes.len() <= 16 * 1024 * 1024 => {
                            if send
                                .send(Ok(String::from_utf8_lossy(&bytes).trim().to_string()))
                                .is_err()
                            {
                                break;
                            }
                        }
                        _ => {
                            let _ = send.send(Err("The video helper returned too much data"));
                            break;
                        }
                    }
                }
            })
        })
        .collect();
    drop(send);
    let start = Instant::now();
    let mut last_activity = Instant::now();
    let mut error = None;
    let mut failed = false;
    loop {
        if task.check().is_err()
            || last_activity.elapsed() > Duration::from_secs(180)
            || start.elapsed() > Duration::from_secs(24 * 3600)
        {
            failed = true;
            break;
        }
        match receive.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(text)) => {
                last_activity = Instant::now();
                if text.starts_with("ERROR:") {
                    error = Some(friendly_error(&text));
                }
                line(&text);
            }
            Ok(Err(_)) => {
                failed = true;
                break;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
    if failed {
        #[cfg(windows)]
        _job.terminate();
        let _ = child.kill();
    }
    // Release blocked senders before joining on cancellation or a failed reader.
    drop(receive);
    let status = child.wait().map_err(|e| e.to_string())?;
    for worker in workers {
        let _ = worker.join();
    }
    task.check()?;
    if failed {
        return Err("The video download stopped responding. Please retry.".into());
    }
    if !status.success() {
        return Err(error.unwrap_or_else(|| {
            "Unable to download this video. Keep its page open, check your login, and retry.".into()
        }));
    }
    Ok(())
}
fn friendly_error(text: &str) -> String {
    let text = text.to_ascii_lowercase();
    if text.contains("drm") { "This video is protected. Downloading is unavailable." }
    else if text.contains("sign in") || text.contains("login") || text.contains("cookies") { "The site requires a valid login or verification. Complete it in AuraView and retry." }
    else if text.contains("unsupported url") { "This video player is not supported yet. Try opening the individual video page." }
    else if text.contains("403") || text.contains("forbidden") { "The video server refused the download. Reload its page and retry." }
    else { "Unable to download this video. Reload its page and retry; the site may need a newer download engine." }.into()
}

#[cfg(windows)]
mod process_job {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::JobObjects::*,
    };
    pub struct Job(HANDLE);
    impl Job {
        pub fn attach(child: &std::process::Child) -> Result<Self, String> {
            unsafe {
                let handle = CreateJobObjectW(None, None).map_err(|e| e.to_string())?;
                let job = Self(handle);
                let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if let Err(error) = SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const _,
                    std::mem::size_of_val(&limits) as u32,
                )
                .and_then(|_| AssignProcessToJobObject(handle, HANDLE(child.as_raw_handle())))
                {
                    let _ = child;
                    return Err(error.to_string());
                }
                Ok(job)
            }
        }
        pub fn terminate(&self) {
            unsafe {
                let _ = TerminateJobObject(self.0, 1);
            }
        }
    }
    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

#[cfg(windows)]
mod bridge {
    use super::*;
    use std::rc::Rc;
    use webview2_com_sys::Microsoft::Web::WebView2::Win32::*;
    use windows_core::Interface;
    type Receiver = Rc<dyn Fn(&ICoreWebView2WebMessageReceivedEventArgs)>;
    unsafe fn install_frame(
        frame: ICoreWebView2Frame,
        receive: Receiver,
    ) -> windows_core::Result<()> {
        use webview2_com::{
            FrameChildFrameCreatedEventHandler, FrameWebMessageReceivedEventHandler,
        };
        let mut token = 0;
        let messages = receive.clone();
        frame
            .cast::<ICoreWebView2Frame2>()?
            .add_WebMessageReceived(
                &FrameWebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        messages(&args);
                    }
                    Ok(())
                })),
                &mut token,
            )?;
        if let Ok(frame) = frame.cast::<ICoreWebView2Frame7>() {
            frame.add_FrameCreated(
                &FrameChildFrameCreatedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        install_frame(args.Frame()?, receive.clone())?;
                    }
                    Ok(())
                })),
                &mut token,
            )?;
        }
        Ok(())
    }
    pub fn install(app: &AppHandle, view: &tauri::Webview, secret: String) -> tauri::Result<()> {
        let app = app.clone();
        let view_target = view.clone();
        view.with_webview(move |platform| unsafe {
            use webview2_com::{FrameCreatedEventHandler, WebMessageReceivedEventHandler};
            let receive: Receiver = Rc::new(move |args| {
                let mut message = windows_core::PWSTR::null();
                if args.TryGetWebMessageAsString(&mut message).is_err() {
                    return;
                }
                let message = webview2_com::take_pwstr(message);
                if message.len() > 192 * 1024 {
                    return;
                }
                let Ok(request) = serde_json::from_str::<Request>(&message) else {
                    return;
                };
                if request.token != secret {
                    return;
                }
                let mut source = windows_core::PWSTR::null();
                if args.Source(&mut source).is_err() {
                    return;
                }
                let source = webview2_com::take_pwstr(source);
                if request.kind == "auraview-video-cancel" {
                    if let Some(task) = tasks().lock().unwrap().get(&request.id) {
                        if task.label == view_target.label() && task.source == source {
                            task.cancel.store(true, Ordering::Relaxed);
                        }
                    }
                } else if request.kind == "auraview-video-select" {
                    if let Some(task) = tasks().lock().unwrap().get(&request.id) {
                        if task.label == view_target.label() && task.source == source {
                            task.select_download(request.resolution, request.audio_only);
                        }
                    }
                } else if request.kind == "auraview-video-download" && validate(&request, &source) {
                    start(app.clone(), view_target.clone(), request, source);
                }
            });
            let result = (|| -> windows_core::Result<()> {
                let core = platform.controller().CoreWebView2()?;
                let mut token = 0;
                let messages = receive.clone();
                core.add_WebMessageReceived(
                    &WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                        if let Some(args) = args {
                            messages(&args);
                        }
                        Ok(())
                    })),
                    &mut token,
                )?;
                core.cast::<ICoreWebView2_4>()?.add_FrameCreated(
                    &FrameCreatedEventHandler::create(Box::new(move |_, args| {
                        if let Some(args) = args {
                            install_frame(args.Frame()?, receive.clone())?;
                        }
                        Ok(())
                    })),
                    &mut token,
                )
            })();
            if let Err(error) = result {
                eprintln!("Unable to install video downloads: {error}");
            }
        })
    }
}
pub fn install(app: &AppHandle, view: &tauri::Webview, token: String) -> tauri::Result<()> {
    #[cfg(windows)]
    return bridge::install(app, view, token);
    #[cfg(not(windows))]
    {
        let _ = (app, view, token);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn task() -> Arc<Task> {
        Arc::new(Task {
            request: Request {
                kind: "auraview-video-download".into(),
                token: "private".into(),
                id: "test-id".into(),
                url: "https://cdn.example.com/movie.mp4".into(),
                page_url: String::new(),
                poster: String::new(),
                instagram_video_id: String::new(),
                title: "Video".into(),
                streams: Vec::new(),
                stream_only: false,
                duration: None,
                resolution: None,
                audio_only: false,
            },
            source: "https://example.com/watch".into(),
            label: "test".into(),
            cancel: AtomicBool::new(false),
            progress: Mutex::new(Progress {
                id: "test-id".into(),
                title: "Video".into(),
                status: "preparing".into(),
                message: String::new(),
                downloaded: 0,
                total: None,
                percent: None,
                filename: None,
                revision: 0,
                resolutions: Vec::new(),
                audio_option: None,
            }),
            selection: Mutex::new(Selection::default()),
            selection_changed: Condvar::new(),
        })
    }
    #[test]
    fn resolution_choices_exclude_audio_drm_and_storyboards_and_keep_selected_audio() {
        let mut info = json!({"requested_formats": [{"height": 2160}], "url": "https://cdn.example/best",
            "formats": [
                {"format_id": "4k", "height": 2160, "width": 3840, "vcodec": "vp9"},
                {"format_id": "hd-avc", "height": 720, "width": 1280, "vcodec": "h264", "acodec": "none"},
                {"format_id": "hd-vp9", "height": 720, "width": 1280, "vcodec": "vp9", "acodec": "none"},
                {"format_id": "audio", "vcodec": "none", "acodec": "aac"},
                {"format_id": "drm", "height": 4320, "has_drm": true},
                {"format_id": "storyboard", "height": 180, "vcodec": "none", "ext": "mhtml"},
                {"format_id": "invalid", "height": 0},
                {"format_id": "unknown"}
            ]});
        assert_eq!(resolutions(&info), vec![2160, 720]);
        restrict_resolution(&mut info, 720).unwrap();
        assert_eq!(resolutions(&info), vec![720]);
        let ids: Vec<_> = info["formats"].as_array().unwrap().iter().map(|f| f["format_id"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["hd-avc", "hd-vp9", "audio"]);
        assert!(info.get("requested_formats").is_none());
        assert!(info.get("url").is_none());
        assert!(restrict_resolution(&mut info, 1080).is_err());
        assert_eq!(video_resolution(&json!({"width":1080, "height":1920})), Some(1080));
        assert!(resolutions(&json!({"url": "https://cdn.example/one.mp4"})).is_empty());
        let task = task();
        task.selection.lock().unwrap().available = vec![1080, 720];
        task.selection.lock().unwrap().offered = true;
        task.select_resolution(480);
        assert_eq!(task.selection.lock().unwrap().chosen, None);
        task.select_resolution(720);
        task.select_resolution(1080);
        assert_eq!(task.selection.lock().unwrap().chosen, Some(DownloadChoice::Video(Some(720))));
    }
    #[test]
    fn mp3_choices_prefer_separate_audio_preserve_native_mp3_and_reject_silent_or_protected_media() {
        let mut info = json!({"formats": [
            {"format_id":"video", "vcodec":"h264", "acodec":"none"},
            {"format_id":"audio", "ext":"m4a", "vcodec":"none", "acodec":"aac"},
            {"format_id":"mp3", "ext":"mp3", "vcodec":"none", "acodec":"mp3"},
            {"format_id":"drm", "vcodec":"none", "has_drm":true}
        ], "requested_formats":[{"format_id":"video"}]});
        assert_eq!(audio_option(&info), Some("download"));
        let mut args = vec!["--format".into(), "bv*+ba/b".into()];
        audio_download_args(&mut info, &mut args).unwrap();
        assert_eq!(args[1], "ba[ext=mp3]/ba");
        assert_eq!(info["formats"].as_array().unwrap().len(), 2);
        assert!(info.get("requested_formats").is_none());
        let mut combined = json!({"formats":[{"vcodec":"h264", "acodec":"aac", "url":"https://cdn.example/combined.mp4"}]});
        assert_eq!(audio_option(&combined), Some("convert"));
        audio_download_args(&mut combined, &mut args).unwrap();
        assert_eq!(args[1], "b[acodec!=none]/bv*+ba/b");
        for info in [json!({"formats":[{"vcodec":"h264", "acodec":"none"}]}),
            json!({"formats":[{"vcodec":"none", "ext":"mhtml"}]}),
            json!({"formats":[{"vcodec":"h264", "acodec":"aac", "has_drm":true}]})] {
            assert_eq!(audio_option(&info), None);
            assert!(audio_download_args(&mut info.clone(), &mut args).is_err());
        }
        let task = task();
        task.select_download(None, true);
        assert_eq!(task.selection.lock().unwrap().chosen, None);
        {
            let mut selection = task.selection.lock().unwrap();
            selection.offered = true; selection.audio = Some("convert");
        }
        task.select_download(Some(720), true);
        assert_eq!(task.selection.lock().unwrap().chosen, None);
        task.select_download(None, true);
        assert_eq!(task.selection.lock().unwrap().chosen, Some(DownloadChoice::Mp3));
        task.select_download(None, false);
        assert_eq!(task.selection.lock().unwrap().chosen, Some(DownloadChoice::Mp3));
    }
    #[test]
    fn bundled_downloader_honors_selected_resolution_and_merges_audio() {
        let tools = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/download-tools");
        if !tools.join("yt-dlp.exe").exists() { return; }
        let work = WorkDir::new(&std::env::temp_dir()).unwrap();
        let sample = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/download-sample.mp4");
        let task = task();
        let low = work.0.join("low.mp4");
        let audio = work.0.join("audio.m4a");
        run_tool(&tools.join("ffmpeg.exe"), &[
            "-y".into(), "-i".into(), sample.to_string_lossy().into_owned(),
            "-vf".into(), "scale=160:90".into(), "-an".into(), low.to_string_lossy().into_owned(),
            "-vn".into(), "-c:a".into(), "copy".into(), audio.to_string_lossy().into_owned(),
        ], &task, |_| {}).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let combined_bytes = std::fs::read(&sample).unwrap();
        let worker = std::thread::spawn(move || {
            let low = std::fs::read(low).unwrap();
            let audio = std::fs::read(audio).unwrap();
            let mut requests = Vec::new();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
            while !stopped.load(Ordering::Relaxed) && std::time::Instant::now() < deadline {
                let Ok((mut stream, _)) = listener.accept() else {
                    std::thread::sleep(std::time::Duration::from_millis(10)); continue;
                };
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(std::time::Duration::from_secs(3))).unwrap();
                let mut buffer = [0; 8192];
                let Ok(n) = stream.read(&mut buffer) else { continue; };
                if n == 0 { continue; }
                let request = String::from_utf8_lossy(&buffer[..n]);
                let path = request.split_whitespace().nth(1).unwrap_or("").to_string();
                requests.push(path.clone());
                let data = if path == "/audio.m4a" { &audio } else if path == "/combined.mp4" { &combined_bytes } else { &low };
                let header = format!("HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", data.len());
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(data);
            }
            requests
        });
        let mut info = json!({"id":"quality-test", "title":"Resolution test", "extractor":"generic", "formats":[
            {"format_id":"low", "url":format!("http://{address}/low.mp4"), "width":160, "height":90, "ext":"mp4", "vcodec":"h264", "acodec":"none"},
            {"format_id":"high", "url":format!("http://{address}/high.mp4"), "width":1280, "height":720, "ext":"mp4", "vcodec":"h264", "acodec":"none"},
            {"format_id":"audio", "url":format!("http://{address}/audio.m4a"), "ext":"m4a", "vcodec":"none", "acodec":"aac"}
        ]});
        let original_info = info.clone();
        restrict_resolution(&mut info, 90).unwrap();
        let path = work.0.join("video.json");
        std::fs::write(&path, serde_json::to_vec(&info).unwrap()).unwrap();
        let mut args = extractor_args(&tools, &work.0, &work.0.join("session.txt"), "http://example.com", "AuraView test");
        args.extend(["--load-info-json".into(), path.to_string_lossy().into_owned(),
            "--print".into(), "after_move:AVFILE:%(filepath)j".into()]);
        let mut completed = None;
        let mut log = Vec::new();
        let result = run_tool(&tools.join("yt-dlp.exe"), &args, &task, |line| {
            log.push(line.to_string());
            if let Some(path) = line.strip_prefix("AVFILE:").and_then(|s| serde_json::from_str::<String>(s).ok()) {
                completed = Some(PathBuf::from(path));
            }
        });
        result.unwrap();
        let output = completed.unwrap_or_else(|| panic!("No completed output: {log:?}"));
        assert!(probe_video(&tools, &output, &task).unwrap(), "selected video must contain audio");
        let mut dimensions = String::new();
        run_tool(&tools.join("ffprobe.exe"), &[
            "-v".into(), "error".into(), "-select_streams".into(), "v:0".into(),
            "-show_entries".into(), "stream=width,height".into(), "-of".into(), "csv=p=0".into(),
            output.to_string_lossy().into_owned(),
        ], &task, |line| dimensions.push_str(line)).unwrap();
        assert_eq!(dimensions.trim(), "160,90");
        let downloads = work.0.join("Downloads");
        let download_mp3 = |mut info: Value, title: &str| {
            let cache = WorkDir::new(&work.0).unwrap();
            let cache_path = cache.0.clone();
            let metadata = cache.0.join("audio.json");
            let mut args = extractor_args(&tools, &cache.0, &cache.0.join("session.txt"), "http://example.com", "AuraView test");
            audio_download_args(&mut info, &mut args).unwrap();
            std::fs::write(&metadata, serde_json::to_vec(&info).unwrap()).unwrap();
            args.extend(["--load-info-json".into(), metadata.to_string_lossy().into_owned(),
                "--print".into(), "after_move:AVFILE:%(filepath)j".into()]);
            let mut input = None;
            run_tool(&tools.join("yt-dlp.exe"), &args, &task, |line| {
                if let Some(path) = line.strip_prefix("AVFILE:").and_then(|s| serde_json::from_str::<String>(s).ok()) {
                    input = Some(PathBuf::from(path));
                }
            }).unwrap();
            let input = input.unwrap();
            let audio = convert_mp3(&tools, &input, &cache.0, &task).unwrap();
            assert!(!input.exists(), "the cached source must be deleted after conversion");
            let bytes = std::fs::read(&audio).unwrap();
            assert_eq!(convert_mp3(&tools, &audio, &cache.0, &task).unwrap(), audio);
            assert_eq!(std::fs::read(&audio).unwrap(), bytes, "native MP3 must not be re-encoded");
            let path = publish(&audio, &downloads, title, "mp3", &task).unwrap();
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
            drop(cache);
            assert!(!cache_path.exists(), "private cache including cookies must be removed");
        };
        download_mp3(original_info, "Separate audio");
        download_mp3(json!({"id":"combined", "title":"Combined", "extractor":"generic", "formats":[
            {"format_id":"combined", "url":format!("http://{address}/combined.mp4"), "ext":"mp4", "vcodec":"h264", "acodec":"aac"}
        ]}), "Converted video");
        stop.store(true, Ordering::Relaxed);
        let requests = worker.join().unwrap();
        assert_eq!(requests.iter().filter(|path| *path == "/low.mp4").count(), 1, "MP3 must never fetch the video-only track");
        assert_eq!(requests.iter().filter(|path| *path == "/audio.m4a").count(), 2);
        assert_eq!(requests.iter().filter(|path| *path == "/combined.mp4").count(), 1);
        assert!(!requests.iter().any(|path| path == "/high.mp4"));
        let files: Vec<_> = std::fs::read_dir(&downloads).unwrap().map(|entry| entry.unwrap().path()).collect();
        assert_eq!(files.len(), 2);
        assert!(files.iter().all(|path| path.extension().unwrap() == "mp3"));
    }
    #[test]
    fn failed_or_cancelled_mp3_conversion_cleans_private_cache_without_publishing() {
        let tools = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/download-tools");
        if !tools.join("ffmpeg.exe").exists() { return; }
        let sample = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/download-stream-video.mp4");
        let directory = WorkDir::new(&std::env::temp_dir()).unwrap();
        let downloads = directory.0.join("Downloads");
        for cancelled in [false, true] {
            let cache = WorkDir::new(&directory.0).unwrap();
            let path = cache.0.clone();
            let video = path.join("cached-video.mp4");
            std::fs::copy(&sample, &video).unwrap();
            std::fs::write(path.join("session.txt"), "private").unwrap();
            let task = task();
            task.cancel.store(cancelled, Ordering::Relaxed);
            assert!(convert_mp3(&tools, &video, &path, &task).is_err());
            drop(cache);
            assert!(!path.exists());
            assert!(!downloads.exists(), "failed audio must never appear in Downloads");
        }
    }
    #[test]
    fn instagram_stories_resolve_only_the_selected_video_and_keep_existing_routes_separate() {
        let url = "https://www.instagram.com/stories/creator/3994261805935619921/?from=home";
        let id = instagram_story_target(url).unwrap().1.unwrap();
        assert_eq!(id, "3994261805935619921");
        for url in ["https://www.instagram.com/reel/abc/", "https://www.instagram.com/",
            "https://www.instagram.com/stories/highlights/123/",
            "https://www.instagram.com/stories/creator/not-numeric/", "https://instagram.com.evil.example/stories/a/123/"] {
            assert!(instagram_story_target(url).is_none());
        }
        let mut request = task().request.clone();
        request.page_url = url.into();
        let item = json!({"id": id, "video_duration": 15, "has_audio": true,
            "video_versions": [{"url": "https://cdn.example/video.mp4", "width": 720, "height": 1280},
            {"url": "file:///C:/private"}]});
        assert_eq!(instagram_story_target("https://www.instagram.com/stories/creator/").unwrap(), ("creator".into(), None));
        let info = instagram_story_metadata(&request, Some(&id), &item).unwrap();
        assert_eq!(info["formats"].as_array().unwrap().len(), 1);
        assert_eq!(info["formats"][0]["acodec"], "unknown");
        assert_eq!(info["duration"], 15.0);
        assert!(instagram_story_metadata(&request, Some("3994261805935619922"), &item).is_err());
        assert!(instagram_story_metadata(&request, Some(&id), &json!({"id": id, "video_versions": []})).is_err());
    }
    #[test]
    fn requests_restrict_protocols_permalinks_and_native_job_identifiers() {
        let mut request = task().request.clone();
        assert!(validate(&request, "https://example.com/feed"));
        request.url = "blob:https://www.instagram.com/id".into();
        request.page_url = "https://www.instagram.com/reel/selected/".into();
        assert!(validate(&request, "https://instagram.com/"));
        request.page_url = "https://evil.example/page".into();
        assert!(!validate(&request, "https://www.instagram.com/"));
        request.page_url.clear();
        request.url = "file:///C:/private.mp4".into();
        assert!(!validate(&request, "https://example.com/"));
        request.url = "https://user:password@example.com/a.mp4".into();
        assert!(!validate(&request, "https://example.com/"));
        request.url = "https://cdn.example/a.mp4".into();
        request.id = "../escape".into();
        assert!(!validate(&request, "https://example.com/"));
    }
    #[test]
    fn playing_streams_validate_aliases_kinds_and_canonical_ad_isolation() {
        let mut request = task().request.clone();
        request.url = "blob:https://twitter.com/playing".into();
        request.page_url = "https://x.com/i/status/1234567890".into();
        assert!(validate(&request, "https://twitter.com/home"));
        request.stream_only = true;
        assert!(!validate(&request, "https://twitter.com/home"));
        request.page_url.clear();
        request.streams = vec![StreamHint {
            url: "https://cdn.example/manifest.m3u8".into(),
            kind: "manifest".into(),
            mime: String::new(),
        }];
        assert!(validate(&request, "https://twitter.com/home"));
        request.streams[0].url = "file:///C:/private".into();
        assert!(!validate(&request, "https://twitter.com/home"));
        request.streams[0].url = "https://cdn.example/file.mp4".into();
        request.streams[0].kind = "script".into();
        assert!(!validate(&request, "https://twitter.com/home"));
    }
    #[test]
    fn separate_source_bound_tracks_keep_audio_and_reject_incomplete_or_wrong_duration() {
        let mut request = task().request.clone();
        request.streams = vec![
            StreamHint {
                url: "https://cdn.example/video.mp4".into(),
                kind: "video".into(),
                mime: "video/mp4".into(),
            },
            StreamHint {
                url: "https://cdn.example/audio.m4a".into(),
                kind: "audio".into(),
                mime: "audio/mp4".into(),
            },
        ];
        let info = stream_metadata(&request).unwrap();
        assert_eq!(info["formats"][0]["acodec"], "none");
        assert_eq!(info["formats"][1]["vcodec"], "none");
        assert!(stream_duration_matches(4.02, 4.0));
        assert!(!stream_duration_matches(2., 4.));
        assert!(!stream_duration_matches(20., 4.));
        request.streams.remove(0);
        assert!(stream_metadata(&request).is_err());
    }
    #[test]
    fn downloaded_files_never_overwrite_and_cancelled_publication_cleans_up() {
        let work = WorkDir::new(&std::env::temp_dir()).unwrap();
        let source = work.0.join("original.mp4");
        std::fs::write(&source, b"video content").unwrap();
        let downloads = work.0.join("downloads");
        let task = task();
        let first = publish(&source, &downloads, "CON", "mp4", &task).unwrap();
        let second = publish(&source, &downloads, "CON", "mp4", &task).unwrap();
        assert_eq!(first.file_name().unwrap(), "_CON.mp4");
        assert_eq!(second.file_name().unwrap(), "_CON (1).mp4");
        assert_eq!(std::fs::read(first).unwrap(), b"video content");
        task.cancel.store(true, Ordering::Relaxed);
        assert!(publish(&source, &downloads, "cancelled", "mp4", &task).is_err());
        assert!(!downloads.join("cancelled.mp4").exists());
        assert_eq!(safe_stem("../../bad\\name:%file"), "_.._bad_name__file");
    }
    #[test]
    fn streaming_downloads_validate_containers_lengths_and_always_close_handles() {
        for scenario in [
            "success",
            "html",
            "truncated",
            "partial",
            "cancelled",
            "read-error",
        ] {
            let work = WorkDir::new(&std::env::temp_dir()).unwrap();
            let path = work.0.join("video");
            let data = b"\0\0\0\x18ftypisom0123456789abcdef";
            let mut read = 0;
            let mut closed = false;
            let mut progress = Vec::new();
            let resource = json!({"success": true, "httpStatusCode": if scenario == "partial" {206} else {200}, "stream": "video-stream",
                "headers": {"Content-Type": "video/mp4", "Content-Length": (data.len() + if scenario == "truncated" {1} else {0}).to_string()}});
            let result = tauri::async_runtime::block_on(save_response_with(
                &resource,
                &path,
                |method, params| {
                    assert_eq!(params["handle"], "video-stream");
                    std::future::ready(match method {
                        "IO.close" => {
                            closed = true;
                            Ok(json!({}))
                        }
                        "IO.read" if scenario == "read-error" => Err("connection lost".into()),
                        "IO.read" => {
                            read += 1;
                            let chunk: &[u8] = if scenario == "html" {
                                b"<html>Access denied</html>"
                            } else if read == 1 {
                                &data[..4]
                            } else {
                                &data[4..]
                            };
                            Ok(
                                json!({"data": STANDARD.encode(chunk), "base64Encoded": true, "eof": read == 2 || scenario == "html"}),
                            )
                        }
                        _ => panic!("unexpected protocol call"),
                    })
                },
                || {
                    if scenario == "cancelled" {
                        Err("cancelled".into())
                    } else {
                        Ok(())
                    }
                },
                |n, total| progress.push((n, total)),
            ));
            assert!(closed, "handle leaked for {scenario}");
            if scenario == "success" {
                assert_eq!(result.unwrap(), "mp4");
                assert_eq!(std::fs::read(&path).unwrap(), data);
                assert_eq!(
                    progress.last().unwrap(),
                    &(data.len() as u64, Some(data.len() as u64))
                );
            } else {
                assert!(result.is_err(), "accepted {scenario}");
            }
        }
    }
    #[test]
    fn extraction_rejects_ambiguous_playlists_live_streams_and_drm() {
        assert!(metadata(json!({"entries": [{"id": "a"}, {"id": "b"}]})).is_err());
        assert_eq!(
            metadata(json!({"entries": [{"id": "one"}]})).unwrap()["id"],
            "one"
        );
        assert!(metadata(json!({"is_live": true})).is_err());
        assert!(metadata(json!({"has_drm": true})).is_err());
        assert!(metadata(json!({"formats": [{"has_drm": true}]})).is_err());
        assert!(metadata(json!({"formats": [{"has_drm": false}]})).is_ok());
    }
    #[test]
    fn cookies_preserve_session_and_http_only_values_without_line_injection() {
        let text = cookie_file(&json!([{"domain": ".instagram.com", "path": "/", "secure": true, "httpOnly": true, "expires": -1,
            "name": "session", "value": "private-session"}])).unwrap();
        assert!(
            text.contains("#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t0\tsession\tprivate-session")
        );
        assert!(
            cookie_file(&json!([{"domain":"example.com", "name":"x", "value":"bad\nvalue"}]))
                .is_err()
        );
        assert!(
            !friendly_error("ERROR: https://secret.example/?token=private 403").contains("secret")
        );
    }
    #[test]
    fn bundled_helpers_probe_real_audio_and_video_and_preserve_output_bytes() {
        let tools = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/download-tools");
        if !tools.join("ffprobe.exe").exists() {
            return;
        }
        let sample =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/download-sample.mp4");
        assert!(probe_video(&tools, &sample, &task()).unwrap());
        let args = extractor_args(
            &tools,
            Path::new("work"),
            Path::new("session"),
            "https://example.com/watch",
            "browser",
        );
        let mut version = String::new();
        run_tool(
            &tools.join("yt-dlp.exe"),
            &["--version".into()],
            &task(),
            |line| version.push_str(line),
        )
        .unwrap();
        assert!(!version.is_empty());
        assert!(args.iter().any(|s| s == "--no-playlist"));
    }
    #[test]
    fn cancellation_stops_helper_processes_and_removes_private_job_files() {
        let tools = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/download-tools");
        if !tools.join("deno.exe").exists() {
            return;
        }
        let task = task();
        let cancel = task.clone();
        let worker = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(500));
            cancel.cancel.store(true, Ordering::Relaxed);
        });
        let start = std::time::Instant::now();
        let result = run_tool(
            &tools.join("deno.exe"),
            &[
                "eval".into(),
                "await new Promise(r=>setTimeout(r,60000))".into(),
            ],
            &task,
            |_| {},
        );
        worker.join().unwrap();
        assert!(result.is_err());
        assert!(start.elapsed().as_secs() < 10);
        let work = WorkDir::new(&std::env::temp_dir()).unwrap();
        let path = work.0.clone();
        std::fs::write(path.join("cookies.txt"), "private").unwrap();
        drop(work);
        assert!(!path.exists());
    }
}
