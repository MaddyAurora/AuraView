use tauri::AppHandle;

// Native WebView2 download operations must stay on their owning UI thread.
#[cfg(windows)]
mod native {
    use super::*;
    use crate::downloads::{self, Entry};
    use std::{cell::RefCell, collections::HashMap, path::PathBuf};
    use tauri::Manager;
    use webview2_com::{
        BytesReceivedChangedEventHandler, DownloadStartingEventHandler, StateChangedEventHandler,
    };
    use webview2_com_sys::Microsoft::Web::WebView2::Win32::*;
    use windows_core::{Interface, HSTRING, PWSTR};

    struct Operation {
        operation: ICoreWebView2DownloadOperation,
        bytes_token: i64,
        state_token: i64,
        entry: Entry,
        cancelled: bool,
        destination: super::Destination,
        replay: downloads::Replay,
    }
    impl Drop for Operation {
        fn drop(&mut self) {
            unsafe {
                let _ = self.operation.remove_BytesReceivedChanged(self.bytes_token);
                let _ = self.operation.remove_StateChanged(self.state_token);
            }
        }
    }
    thread_local! { static OPERATIONS: RefCell<HashMap<String, Operation>> = RefCell::new(HashMap::new()); }

    unsafe fn refresh(
        app: &AppHandle,
        id: &str,
        operation: &ICoreWebView2DownloadOperation,
    ) -> windows_core::Result<()> {
        let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
        operation.State(&mut state)?;
        let mut received = 0;
        operation.BytesReceived(&mut received)?;
        let mut total = -1;
        operation.TotalBytesToReceive(&mut total)?;
        let mut can_resume = windows_core::BOOL::default();
        operation.CanResume(&mut can_resume)?;
        let mut reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON::default();
        if state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED {
            operation.InterruptReason(&mut reason)?;
        }
        let payload = OPERATIONS.with(|operations| {
            let mut operations = operations.borrow_mut();
            let record = operations.get_mut(id)?;
            let entry = &mut record.entry;
            entry.downloaded = received.max(0) as u64;
            entry.total = (total > 0).then_some(total as u64);
            entry.percent = entry
                .total
                .map(|total| (entry.downloaded as f64 / total as f64 * 100.).clamp(0., 100.));
            let cancelled =
                record.cancelled || reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED;
            let status = if state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED {
                "saved"
            } else if state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED {
                if cancelled {
                    "cancelled"
                } else {
                    "error"
                }
            } else {
                "downloading"
            };
            entry.status = status.into();
            entry.cancelable = status == "downloading";
            entry.retryable = status == "error" && can_resume.as_bool();
            entry.message = match status {
                "saved" => "Saved to Downloads",
                "cancelled" => "Download cancelled.",
                "error" if entry.retryable => "Download interrupted. Retry to resume.",
                "error" => "Download interrupted. Use the original download link to retry.",
                _ => "Downloading file…",
            }
            .into();
            let payload = entry.clone();
            record.destination.saved = status == "saved";
            if status == "saved" {
                downloads::remember(
                    "browser",
                    id,
                    &record.destination.path,
                    record.replay.clone(),
                );
            }
            if !entry.cancelable && !entry.retryable {
                operations.remove(id);
            }
            Some(payload)
        });
        if let Some(payload) = payload {
            downloads::publish(app, payload);
        }
        Ok(())
    }

    unsafe fn watch(
        app: AppHandle,
        args: &ICoreWebView2DownloadStartingEventArgs,
        label: String,
        source: String,
    ) -> windows_core::Result<()> {
        let operation = args.DownloadOperation()?;
        let mut uri = PWSTR::null();
        operation.Uri(&mut uri)?;
        let url = webview2_com::take_pwstr(uri);
        let mut mime = PWSTR::null();
        let mime = if operation.MimeType(&mut mime).is_ok() {
            webview2_com::take_pwstr(mime)
        } else {
            String::new()
        };
        let replay = downloads::Replay::Resource {
            url,
            source,
            label,
            mime,
        };
        let mut path = PWSTR::null();
        args.ResultFilePath(&mut path)?;
        let original = PathBuf::from(webview2_com::take_pwstr(path));
        let directory = app.path().download_dir().map_err(|_| {
            windows_core::Error::from_hresult(windows_core::HRESULT(0x80004005_u32 as i32))
        })?;
        let name = original
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("download");
        let destination = super::reserve(&directory, name).map_err(|_| {
            windows_core::Error::from_hresult(windows_core::HRESULT(0x80004005_u32 as i32))
        })?;
        let path = &destination.path;
        // Use the browser's suggested filename and normal download engine,
        // including authenticated requests, POST responses, blobs and redirects.
        args.SetResultFilePath(&HSTRING::from(path.to_string_lossy().as_ref()))?;
        let id = crate::image_download::token();
        let filename = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let mut entry = Entry::new("browser", &id, &filename);
        entry.filename = Some(filename);
        entry.cancelable = true;
        let mut bytes_token = 0;
        let app_bytes = app.clone();
        let bytes_id = id.clone();
        operation.add_BytesReceivedChanged(
            &BytesReceivedChangedEventHandler::create(Box::new(move |operation, _| {
                if let Some(operation) = operation {
                    refresh(&app_bytes, &bytes_id, &operation)?;
                }
                Ok(())
            })),
            &mut bytes_token,
        )?;
        let mut state_token = 0;
        let app_state = app.clone();
        let state_id = id.clone();
        if let Err(error) = operation.add_StateChanged(
            &StateChangedEventHandler::create(Box::new(move |operation, _| {
                if let Some(operation) = operation {
                    refresh(&app_state, &state_id, &operation)?;
                }
                Ok(())
            })),
            &mut state_token,
        ) {
            let _ = operation.remove_BytesReceivedChanged(bytes_token);
            return Err(error);
        }
        OPERATIONS.with(|operations| {
            operations.borrow_mut().insert(
                id.clone(),
                Operation {
                    operation: operation.clone(),
                    bytes_token,
                    state_token,
                    entry,
                    cancelled: false,
                    destination,
                    replay,
                },
            );
        });
        refresh(&app, &id, &operation)?;
        args.SetHandled(true)?;
        Ok(())
    }

    pub fn install(app: &AppHandle, webview: &tauri::Webview) -> tauri::Result<()> {
        let app = app.clone();
        let label = webview.label().to_string();
        webview.with_webview(move |platform| unsafe {
            let result = (|| -> windows_core::Result<()> {
                let mut token = 0;
                platform
                    .controller()
                    .CoreWebView2()?
                    .cast::<ICoreWebView2_4>()?
                    .add_DownloadStarting(
                        &DownloadStartingEventHandler::create(Box::new(move |core, args| {
                            if let Some(args) = args {
                                let source = if let Some(core) = core {
                                    let mut source = PWSTR::null();
                                    if core.Source(&mut source).is_ok() {
                                        webview2_com::take_pwstr(source)
                                    } else {
                                        String::new()
                                    }
                                } else {
                                    String::new()
                                };
                                if let Err(error) = watch(app.clone(), &args, label.clone(), source)
                                {
                                    // Let WebView2 keep its normal download UI if tracking fails.
                                    eprintln!("Unable to track browser download: {error}");
                                }
                            }
                            Ok(())
                        })),
                        &mut token,
                    )
            })();
            if let Err(error) = result {
                eprintln!("Unable to install browser downloads: {error}");
            }
        })
    }

    pub async fn action(app: AppHandle, id: String, resume: bool) -> Result<(), String> {
        let (sender, receiver) = std::sync::mpsc::channel();
        let update = app.clone();
        app.run_on_main_thread(move || unsafe {
            let result = (|| -> Result<(), String> {
                let operation = OPERATIONS.with(
                    |operations| -> Result<ICoreWebView2DownloadOperation, String> {
                        let mut operations = operations.borrow_mut();
                        let record = operations
                            .get_mut(&id)
                            .ok_or("Download is no longer available")?;
                        if resume && !record.entry.retryable {
                            return Err("Use the original download link to retry".into());
                        }
                        if !resume {
                            record.cancelled = true;
                        }
                        Ok(record.operation.clone())
                    },
                )?;
                // Release the RefCell borrow before invoking COM: StateChanged can fire here.
                if resume {
                    operation.Resume()
                } else {
                    operation.Cancel()
                }
                .map_err(|e| e.to_string())?;
                refresh(&update, &id, &operation).map_err(|e| e.to_string())
            })();
            let _ = sender.send(result);
        })
        .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv_timeout(std::time::Duration::from_secs(10))
                .map_err(|e| e.to_string())?
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

struct Destination {
    path: std::path::PathBuf,
    saved: bool,
}
impl Drop for Destination {
    fn drop(&mut self) {
        // The empty reservation prevents another image/video/file job from
        // claiming this name while WebView2 writes its temporary download.
        if !self.saved && std::fs::metadata(&self.path).is_ok_and(|metadata| metadata.len() == 0) {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}
fn reserve(directory: &std::path::Path, name: &str) -> Result<Destination, String> {
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let name = std::path::Path::new(name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("download");
    let path = std::path::Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("download");
    let ext = path
        .extension()
        .and_then(|name| name.to_str())
        .map(|ext| format!(".{ext}"))
        .unwrap_or_default();
    for index in 0..10_000 {
        let name = if index == 0 {
            name.into()
        } else {
            format!("{stem} ({index}){ext}")
        };
        let path = directory.join(name);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => return Ok(Destination { path, saved: false }),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Too many downloads with the same filename".into())
}
pub fn install(app: &AppHandle, webview: &tauri::Webview) -> tauri::Result<()> {
    #[cfg(windows)]
    {
        native::install(app, webview)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, webview);
        Ok(())
    }
}
pub async fn action(app: AppHandle, id: String, resume: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        native::action(app, id, resume).await
    }
    #[cfg(not(windows))]
    {
        let _ = (app, id, resume);
        Err("Browser downloads require Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_download_names_preserve_extensions_and_avoid_existing_and_active_files() {
        let directory = std::env::temp_dir().join(format!(
            "auraview-download-test-{}",
            crate::image_download::token()
        ));
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(directory.join("report.zip"), b"original").unwrap();
        let first = reserve(&directory, "report.zip").unwrap();
        let second = reserve(&directory, "report.zip").unwrap();
        assert_eq!(second.path.file_name().unwrap(), "report (2).zip");
        assert_eq!(
            std::fs::read(directory.join("report.zip")).unwrap(),
            b"original"
        );
        let mut empty = reserve(&directory, "README").unwrap();
        assert_eq!(empty.path, directory.join("README"));
        empty.saved = true;
        drop(empty);
        assert!(
            directory.join("README").exists(),
            "a successfully downloaded empty file is valid"
        );
        drop(first);
        drop(second);
        assert!(
            !directory.join("report (1).zip").exists(),
            "failed downloads release their empty reservation"
        );
        std::fs::remove_file(directory.join("README")).unwrap();
        std::fs::remove_file(directory.join("report.zip")).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
