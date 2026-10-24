use crate::downloads::{self, Entry, Replay, SavedFile};
use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tauri::{AppHandle, Manager};

static JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
fn jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    JOBS.get_or_init(Default::default)
}
pub fn cancel(id: &str) -> bool {
    if let Some(cancel) = jobs().lock().unwrap().get(id) {
        cancel.store(true, Ordering::Relaxed);
        true
    } else {
        false
    }
}
struct Job {
    entry: Mutex<Entry>,
    cancel: Arc<AtomicBool>,
}
impl Job {
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
        let mut entry = self.entry.lock().unwrap();
        entry.status = status.into();
        entry.message = message.into();
        entry.downloaded = downloaded;
        entry.total = total;
        entry.percent = total
            .filter(|total| *total > 0)
            .map(|total| (downloaded as f64 / total as f64 * 100.).clamp(0., 100.));
        entry.cancelable = downloads::busy(status);
        downloads::publish(app, entry.clone());
    }
}
pub fn start(app: AppHandle, original: SavedFile) {
    let id = crate::image_download::token();
    let title = original
        .path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let job = Arc::new(Job {
        entry: Mutex::new(Entry::new(&original.kind, &id, &title)),
        cancel: Arc::new(AtomicBool::new(false)),
    });
    let key = job.entry.lock().unwrap().id.clone();
    jobs()
        .lock()
        .unwrap()
        .insert(key.clone(), job.cancel.clone());
    job.update(&app, "preparing", "Preparing another download…", 0, None);
    tauri::async_runtime::spawn(async move {
        let result = download(&app, &job, &original).await;
        match result {
            Ok(path) => {
                downloads::remember(&original.kind, &id, &path, original.replay.clone());
                job.entry.lock().unwrap().filename = path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned());
                let size = std::fs::metadata(&path)
                    .map(|metadata| metadata.len())
                    .unwrap_or(0);
                job.update(&app, "saved", "Saved to Downloads", size, Some(size));
            }
            Err(_) if job.cancel.load(Ordering::Relaxed) => {
                job.update(&app, "cancelled", "Download cancelled.", 0, None)
            }
            Err(error) => job.update(&app, "error", &error, 0, None),
        }
        jobs().lock().unwrap().remove(&key);
    });
}
struct Temporary(PathBuf);
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(windows)]
async fn download(
    app: &AppHandle,
    job: &Arc<Job>,
    original: &SavedFile,
) -> Result<PathBuf, String> {
    use crate::image_download::{devtools, frame_for_source};
    use serde_json::json;
    let Replay::Resource {
        url,
        source,
        label,
        mime,
    } = &original.replay
    else {
        return Err("Use the video download button to retry".into());
    };
    let http = tauri::Url::parse(url).is_ok_and(|url| matches!(url.scheme(), "http" | "https"));
    let view = app
        .get_webview(label)
        .or_else(|| {
            if http {
                app.webviews()
                    .into_iter()
                    .find(|(label, _)| label.starts_with("browser-"))
                    .map(|(_, view)| view)
            } else {
                None
            }
        })
        .ok_or("Open the original download’s page and try again")?;
    let tree = devtools(&view, "Page.getFrameTree", json!({})).await?;
    let frame = frame_for_source(&tree["frameTree"], source)
        .or_else(|| {
            if http {
                tree["frameTree"]["frame"]["id"]
                    .as_str()
                    .map(str::to_string)
            } else {
                None
            }
        })
        .ok_or("Open the original download’s page and try again")?;
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("download-again");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let temporary = Temporary(directory.join(format!("{}.part", crate::image_download::token())));
    job.check()?;
    if http {
        let response = devtools(
            &view,
            "Network.loadNetworkResource",
            json!({"frameId": frame, "url": url,
            "options": {"disableCache": true, "includeCredentials": true}}),
        )
        .await?;
        let allow_html = mime.to_ascii_lowercase().starts_with("text/html")
            || original
                .path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| {
                    matches!(ext.to_ascii_lowercase().as_str(), "html" | "htm" | "xhtml")
                });
        save_resource_with(
            &response["resource"],
            &temporary.0,
            allow_html,
            |method, params| devtools(&view, method, params),
            || job.check(),
            |size, total| job.update(app, "downloading", "Downloading again…", size, total),
        )
        .await?;
    } else {
        blob_file(app, &view, &frame, url, job, &temporary.0).await?;
    }
    job.check()?;
    job.update(app, "saving", "Saving another copy…", 0, None);
    let name = original
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("The download filename is unavailable")?
        .to_string();
    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    let source = temporary.0.clone();
    let check = job.clone();
    tauri::async_runtime::spawn_blocking(move || {
        publish_copy(&source, &downloads, &name, || check.check())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(not(windows))]
async fn download(_: &AppHandle, _: &Arc<Job>, _: &SavedFile) -> Result<PathBuf, String> {
    Err("Downloads require Windows".into())
}

fn header<'a>(headers: &'a serde_json::Value, name: &str) -> Option<&'a str> {
    headers
        .as_object()?
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))?
        .1
        .as_str()
}
async fn save_resource_with<F, Fut, C, P>(
    resource: &serde_json::Value,
    path: &Path,
    allow_html: bool,
    mut call: F,
    check: C,
    mut progress: P,
) -> Result<(), String>
where
    F: FnMut(&'static str, serde_json::Value) -> Fut,
    Fut: std::future::Future<Output = Result<serde_json::Value, String>>,
    C: Fn() -> Result<(), String>,
    P: FnMut(u64, Option<u64>),
{
    use base64::Engine;
    use serde_json::json;
    let stream = resource["stream"]
        .as_str()
        .ok_or("The source refused the download. Open its original page and retry.")?;
    let result = async {
        if resource["success"] != true || resource["httpStatusCode"].as_u64() != Some(200) {
            return Err(
                "The source refused a complete download. Open its original page and retry.".into(),
            );
        }
        if !allow_html
            && header(&resource["headers"], "content-type")
                .is_some_and(|mime| mime.to_ascii_lowercase().starts_with("text/html"))
        {
            return Err(
                "The source returned a web page. Open the original download link and retry.".into(),
            );
        }
        // Chromium decodes transfer compression before exposing the body.
        // Content-Length then describes compressed bytes, not the saved file.
        let compressed = header(&resource["headers"], "content-encoding").is_some_and(|encoding| {
            !encoding.is_empty() && !encoding.eq_ignore_ascii_case("identity")
        });
        let total = if compressed {
            None
        } else {
            header(&resource["headers"], "content-length").and_then(|size| size.parse::<u64>().ok())
        };
        let mut file = File::create(path).map_err(|e| e.to_string())?;
        let mut size = 0;
        loop {
            check()?;
            let chunk = call("IO.read", json!({"handle": stream, "size": 256 * 1024})).await?;
            let text = chunk["data"]
                .as_str()
                .filter(|text| text.len() <= 2 * 1024 * 1024)
                .ok_or("Invalid download data")?;
            let bytes = if chunk["base64Encoded"] == true {
                base64::engine::general_purpose::STANDARD
                    .decode(text)
                    .map_err(|e| e.to_string())?
            } else {
                text.as_bytes().to_vec()
            };
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            size += bytes.len() as u64;
            progress(size, total);
            if chunk["eof"] == true {
                break;
            }
            if bytes.is_empty() {
                return Err("The download stopped before completion".into());
            }
        }
        if total.is_some_and(|total| total != size) {
            return Err("The download was incomplete".into());
        }
        file.flush().map_err(|e| e.to_string())
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
) -> Result<serde_json::Value, String> {
    let result = crate::image_download::devtools(
        view,
        "Runtime.evaluate",
        serde_json::json!({"contextId": context,
        "expression": expression, "awaitPromise": true, "returnByValue": true}),
    )
    .await?;
    if !result["exceptionDetails"].is_null() {
        return Err(
            "This generated file is no longer available. Open its original page and retry.".into(),
        );
    }
    Ok(result["result"]["value"].clone())
}
#[cfg(windows)]
async fn blob_file(
    app: &AppHandle,
    view: &tauri::Webview,
    frame: &str,
    url: &str,
    job: &Job,
    path: &Path,
) -> Result<(), String> {
    use base64::Engine;
    use serde_json::json;
    let world = crate::image_download::devtools(
        view,
        "Page.createIsolatedWorld",
        json!({"frameId": frame, "worldName": "AuraView download again"}),
    )
    .await?;
    let context = world["executionContextId"]
        .as_u64()
        .ok_or("The original download’s page is unavailable")?;
    let key = serde_json::to_string(&format!("auraview-file-{}", crate::image_download::token()))
        .unwrap();
    let url = serde_json::to_string(url).unwrap();
    let result = async {
        let info = evaluate(view, context, format!("(async()=>{{const r=await fetch({url});if(!r.ok)throw Error();const b=await r.blob();globalThis[{key}]=b;return b.size}})()" )).await?;
        let size = info.as_u64().ok_or("Invalid generated file")?;
        let mut file = File::create(path).map_err(|e| e.to_string())?; let mut offset = 0;
        while offset < size {
            job.check()?;
            let data = evaluate(view, context, format!("(async()=>{{const b=globalThis[{key}].slice({offset},{});return await new Promise((ok,no)=>{{const r=new FileReader();r.onload=()=>ok(r.result.split(',')[1]);r.onerror=no;r.readAsDataURL(b)}})}})()", (offset + 256 * 1024).min(size))).await?;
            let encoded = data.as_str().filter(|text| text.len() <= 2 * 1024 * 1024).ok_or("Invalid generated file data")?;
            let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|e| e.to_string())?;
            if bytes.is_empty() { return Err("The generated file stopped before completion".into()); }
            file.write_all(&bytes).map_err(|e| e.to_string())?; offset += bytes.len() as u64;
            job.update(app, "downloading", "Downloading again…", offset, Some(size));
        }
        file.flush().map_err(|e| e.to_string())
    }.await;
    let _ = evaluate(view, context, format!("delete globalThis[{key}]")).await;
    result
}

fn publish_copy(
    source: &Path,
    directory: &Path,
    name: &str,
    check: impl Fn() -> Result<(), String>,
) -> Result<PathBuf, String> {
    check()?;
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let name = Path::new(name)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid download name")?;
    let filename = Path::new(name);
    let stem = filename
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or("Invalid download name")?;
    let extension = filename
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"))
        .unwrap_or_default();
    for index in 0..10_000 {
        let path = directory.join(if index == 0 {
            name.to_string()
        } else {
            format!("{stem} ({index}){extension}")
        });
        match OpenOptions::new().create_new(true).write(true).open(&path) {
            Ok(mut target) => {
                let result = (|| {
                    let mut source = File::open(source).map_err(|e| e.to_string())?;
                    let mut buffer = vec![0; 256 * 1024];
                    loop {
                        check()?;
                        let n = source.read(&mut buffer).map_err(|e| e.to_string())?;
                        if n == 0 {
                            break;
                        }
                        target.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
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
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Too many downloads with the same filename".into())
}

fn regular_file(path: &Path) -> Result<bool, String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() && !metadata.file_type().is_symlink() => {
            Ok(true)
        }
        Ok(_) => Err("This download no longer points to a regular file".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}
pub fn reveal(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        shell::reveal(path)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("Show in folder requires Windows".into())
    }
}
pub fn recycle(path: &Path) -> Result<bool, String> {
    if !regular_file(path)? {
        return Ok(false);
    }
    #[cfg(windows)]
    {
        shell::recycle(path)?;
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        Err("Recycle Bin requires Windows".into())
    }
}
#[cfg(windows)]
mod shell {
    use super::*;
    use windows::{
        core::HSTRING,
        Win32::{System::Com::*, UI::Shell::*},
    };
    struct Apartment;
    impl Apartment {
        fn new() -> windows::core::Result<Self> {
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
            }
            Ok(Self)
        }
    }
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }
    pub fn reveal(path: &Path) -> Result<(), String> {
        let parent = path
            .parent()
            .filter(|parent| parent.is_dir())
            .ok_or("The download’s folder no longer exists")?;
        if path.is_file() {
            let selected = (|| -> windows::core::Result<()> {
                unsafe {
                    let _apartment = Apartment::new()?;
                    let mut pidl = std::ptr::null_mut();
                    SHParseDisplayName(&HSTRING::from(path.as_os_str()), None, &mut pidl, 0, None)?;
                    let result = SHOpenFolderAndSelectItems(pidl, None, 0);
                    CoTaskMemFree(Some(pidl.cast()));
                    result
                }
            })();
            if selected.is_ok() {
                return Ok(());
            }
        }
        // No command shell: the complete folder path is one literal argument.
        let explorer =
            PathBuf::from(std::env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into()))
                .join("explorer.exe");
        std::process::Command::new(explorer)
            .arg(parent)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    pub fn recycle(path: &Path) -> Result<(), String> {
        let result = (|| -> windows::core::Result<()> {
            unsafe {
                let _apartment = Apartment::new()?;
                let operation: IFileOperation =
                    CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)?;
                operation.SetOperationFlags(
                    FOFX_RECYCLEONDELETE
                        | FOFX_ADDUNDORECORD
                        | FOFX_EARLYFAILURE
                        | FOF_NOERRORUI
                        | FOF_SILENT
                        | FOF_NOCONFIRMATION
                        | FOF_NO_CONNECTED_ELEMENTS,
                )?;
                let item: IShellItem =
                    SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None)?;
                operation.DeleteItem(&item, None)?;
                operation.PerformOperations()?;
                if operation.GetAnyOperationsAborted()?.as_bool() {
                    return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                        0x80004005_u32 as i32,
                    )));
                }
                Ok(())
            }
        })();
        result.map_err(|error| format!("Could not move this file to the Recycle Bin: {error}"))?;
        if path.exists() {
            return Err("The file was not moved to the Recycle Bin".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{collections::VecDeque, sync::atomic::AtomicUsize};
    fn directory() -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "auraview-file-actions-{}",
            crate::image_download::token()
        ));
        std::fs::create_dir(&directory).unwrap();
        directory
    }
    #[test]
    fn repeated_downloads_create_independent_copies_and_cancelled_publications_leave_no_partial_file(
    ) {
        let root = directory();
        let source = root.join("source");
        let downloads = root.join("downloads");
        std::fs::write(&source, b"new response").unwrap();
        std::fs::create_dir(&downloads).unwrap();
        std::fs::write(downloads.join("report.txt"), b"original download").unwrap();
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let source = source.clone();
                let downloads = downloads.clone();
                std::thread::spawn(move || {
                    publish_copy(&source, &downloads, "report.txt", || Ok(())).unwrap()
                })
            })
            .collect();
        let paths: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_ne!(paths[0], paths[1]);
        assert_eq!(
            std::fs::read(downloads.join("report.txt")).unwrap(),
            b"original download"
        );
        for path in &paths {
            assert_eq!(std::fs::read(path).unwrap(), b"new response");
        }
        std::fs::write(&source, vec![7; 700_000]).unwrap();
        let checks = AtomicUsize::new(0);
        assert!(publish_copy(&source, &downloads, "cancelled.bin", || {
            if checks.fetch_add(1, Ordering::Relaxed) >= 2 {
                Err("Cancelled".into())
            } else {
                Ok(())
            }
        })
        .is_err());
        assert!(!downloads.join("cancelled.bin").exists());
        for path in paths {
            std::fs::remove_file(path).unwrap();
        }
        std::fs::remove_file(downloads.join("report.txt")).unwrap();
        std::fs::remove_file(source).unwrap();
        std::fs::remove_dir(downloads).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
    #[test]
    fn file_actions_reject_directories_and_handle_missing_files_without_touching_neighbors() {
        let root = directory();
        let path = root.join("test.txt");
        std::fs::write(&path, b"download").unwrap();
        assert!(regular_file(&root).is_err());
        assert!(regular_file(&path).unwrap());
        assert!(!regular_file(&root.join("missing.txt")).unwrap());
        assert!(!recycle(&root.join("missing.txt")).unwrap());
        assert_eq!(std::fs::read(&path).unwrap(), b"download");
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
    #[test]
    fn streamed_redownloads_keep_all_bytes_close_handles_and_reject_partial_or_login_responses() {
        let root = directory();
        for (index, resource, chunks, should_succeed) in [
            (
                0,
                json!({"stream":"body", "success":true,"httpStatusCode":200,"headers":{"Content-Length":"4"}}),
                vec![
                    json!({"data":"QUI=","base64Encoded":true,"eof":false}),
                    json!({"data":"CD","eof":true}),
                ],
                true,
            ),
            (
                1,
                json!({"stream":"body", "success":true,"httpStatusCode":200,"headers":{"content-length":"4"}}),
                vec![json!({"data":"ABC","eof":true})],
                false,
            ),
            (
                2,
                json!({"stream":"body", "success":true,"httpStatusCode":200,"headers":{"Content-Type":"text/html"}}),
                vec![],
                false,
            ),
            (
                3,
                json!({"stream":"body", "success":false,"httpStatusCode":403}),
                vec![],
                false,
            ),
            (
                4,
                json!({"stream":"body", "success":true,"httpStatusCode":200,"headers":{"content-length":"0"}}),
                vec![json!({"data":"","eof":true})],
                true,
            ),
            (
                5,
                json!({"stream":"body", "success":true,"httpStatusCode":200,"headers":{"content-length":"24", "content-encoding":"gzip"}}),
                vec![json!({"data":"ABCD","eof":true})],
                true,
            ),
        ] {
            let temporary = Temporary(root.join(format!("{index}.part")));
            let mut chunks = VecDeque::from(chunks);
            let mut closed = false;
            let result = tauri::async_runtime::block_on(save_resource_with(
                &resource,
                &temporary.0,
                false,
                |method, _| {
                    let reply = if method == "IO.close" {
                        closed = true;
                        json!({})
                    } else {
                        chunks.pop_front().unwrap()
                    };
                    std::future::ready(Ok(reply))
                },
                || Ok(()),
                |_, _| {},
            ));
            assert_eq!(result.is_ok(), should_succeed);
            assert!(closed);
            if index == 0 {
                assert_eq!(std::fs::read(&temporary.0).unwrap(), b"ABCD");
            }
            let path = temporary.0.clone();
            drop(temporary);
            assert!(!path.exists());
        }
        std::fs::remove_dir(root).unwrap();
    }
}
