use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub status: String,
    pub message: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub percent: Option<f64>,
    pub bytes_per_second: Option<f64>,
    pub remaining_seconds: Option<f64>,
    pub estimate_updated_at: Option<u64>,
    pub filename: Option<String>,
    pub cancelable: bool,
    pub retryable: bool,
    pub has_file: bool,
    pub file_deleted: bool,
    pub redownloadable: bool,
    pub started: u64,
    pub revision: u64,
}
impl Entry {
    pub fn new(kind: &str, id: &str, title: &str) -> Self {
        Self {
            id: format!("{kind}:{id}"),
            kind: kind.into(),
            title: title
                .chars()
                .filter(|c| !c.is_control())
                .take(180)
                .collect(),
            status: "preparing".into(),
            message: "Preparing download…".into(),
            downloaded: 0,
            total: None,
            percent: None,
            bytes_per_second: None,
            remaining_seconds: None,
            estimate_updated_at: None,
            filename: None,
            cancelable: false,
            retryable: false,
            has_file: false,
            file_deleted: false,
            redownloadable: false,
            started: 0,
            revision: 0,
        }
    }
}
pub fn busy(status: &str) -> bool {
    matches!(
        status,
        "preparing" | "downloading" | "merging" | "saving" | "cancelling"
    )
}
#[derive(Default)]
struct History {
    entries: Vec<Entry>,
    files: HashMap<String, SavedFile>,
    sequence: u64,
    transfers: HashMap<String, TransferRate>,
}

struct TransferRate {
    started: Instant,
    baseline: u64,
    received: u64,
    progressed: Instant,
}
impl TransferRate {
    fn new(now: Instant, received: u64) -> Self {
        Self {
            started: now,
            baseline: received,
            received,
            progressed: now,
        }
    }
    fn sample(
        &mut self,
        now: Instant,
        received: u64,
        total: Option<u64>,
    ) -> Option<(f64, Option<f64>)> {
        // Resumes and separate video/audio tracks may reset the byte counter.
        // Existing bytes are a baseline, never bytes transferred at this speed.
        if received < self.received {
            *self = Self::new(now, received);
        }
        if received > self.received {
            self.progressed = now;
        }
        self.received = received;
        let elapsed = now.saturating_duration_since(self.started).as_secs_f64();
        if elapsed < 1.0
            || now.saturating_duration_since(self.progressed) >= Duration::from_secs(10)
        {
            return None;
        }
        let rate = received.saturating_sub(self.baseline) as f64 / elapsed;
        if !rate.is_finite() || rate <= 0.0 {
            return None;
        }
        let remaining = total
            .filter(|total| *total > received)
            .map(|total| (total - received) as f64 / rate);
        Some((rate, remaining))
    }
}
#[derive(Clone)]
pub enum Replay {
    Video(String),
    Resource {
        url: String,
        source: String,
        label: String,
        mime: String,
    },
}
#[derive(Clone)]
pub struct SavedFile {
    pub path: PathBuf,
    pub replay: Replay,
    pub kind: String,
    deleted: bool,
}
impl History {
    fn record(&mut self, entry: Entry) -> Entry {
        let wall_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(u64::MAX as u128) as u64;
        self.record_at(entry, Instant::now(), wall_time)
    }
    fn record_at(&mut self, mut entry: Entry, now: Instant, wall_time: u64) -> Entry {
        entry.bytes_per_second = None;
        entry.remaining_seconds = None;
        entry.estimate_updated_at = None;
        if entry.status == "downloading" {
            let transfer = self
                .transfers
                .entry(entry.id.clone())
                .or_insert_with(|| TransferRate::new(now, entry.downloaded));
            if let Some((rate, remaining)) = transfer.sample(now, entry.downloaded, entry.total) {
                entry.bytes_per_second = Some(rate);
                entry.remaining_seconds = remaining;
                entry.estimate_updated_at = Some(wall_time);
            }
        } else {
            self.transfers.remove(&entry.id);
        }
        if let Some(file) = self.files.get(&entry.id) {
            entry.has_file = true;
            entry.file_deleted = file.deleted;
            entry.redownloadable = true;
        }
        self.sequence += 1;
        entry.revision = self.sequence;
        if let Some(previous) = self.entries.iter_mut().find(|item| item.id == entry.id) {
            entry.started = previous.started;
            *previous = entry.clone();
        } else {
            entry.started = self.sequence;
            self.entries.push(entry.clone());
        }
        // Never evict an active download when many small files finish.
        let mut completed = self
            .entries
            .iter()
            .filter(|item| !busy(&item.status))
            .count();
        self.entries.retain(|item| {
            if completed > 60 && !busy(&item.status) {
                completed -= 1;
                false
            } else {
                true
            }
        });
        self.files
            .retain(|id, _| self.entries.iter().any(|entry| &entry.id == id));
        self.transfers
            .retain(|id, _| self.entries.iter().any(|entry| &entry.id == id));
        entry
    }
}
static HISTORY: OnceLock<Mutex<History>> = OnceLock::new();
fn history() -> &'static Mutex<History> {
    HISTORY.get_or_init(Default::default)
}

pub fn clear_completed(app: &AppHandle) {
    let mut history=history().lock().unwrap();
    history.entries.retain(|entry| busy(&entry.status));
    let active: std::collections::HashSet<String>=history.entries.iter().map(|entry|entry.id.clone()).collect();
    history.files.retain(|id,_|active.contains(id));
    history.transfers.retain(|id,_|active.contains(id));
    history.sequence += 1;
    let _=app.emit("downloads-history-cleared",serde_json::json!({ "entries": history.entries, "revision": history.sequence }));
}
pub fn publish(app: &AppHandle, entry: Entry) {
    let entry = history().lock().unwrap().record(entry);
    let _ = app.emit_to("main", "download-progress", &entry);
    let _ = app.emit_to(crate::downloads_preview::LABEL, "download-progress", &entry);
}
pub fn remember(kind: &str, id: &str, path: &Path, replay: Replay) {
    history().lock().unwrap().files.insert(
        format!("{kind}:{id}"),
        SavedFile {
            path: path.into(),
            replay,
            kind: kind.into(),
            deleted: false,
        },
    );
}
pub fn contains(id: &str) -> bool {
    history()
        .lock()
        .unwrap()
        .entries
        .iter()
        .any(|entry| entry.id == id)
}
fn saved_file(id: &str) -> Result<SavedFile, String> {
    history()
        .lock()
        .unwrap()
        .files
        .get(id)
        .cloned()
        .ok_or_else(|| "This download has no saved file".into())
}
fn authorize(webview: &tauri::Webview) -> Result<(), String> {
    if webview.label() == "main" {
        Ok(())
    } else {
        Err("Downloads are managed from AuraView".into())
    }
}
fn target(id: &str) -> Result<(&str, &str), String> {
    let (kind, key) = id.split_once(':').ok_or("Invalid download")?;
    if !matches!(kind, "video" | "image" | "browser") || key.is_empty() || key.len() > 80 {
        return Err("Invalid download".into());
    }
    Ok((kind, key))
}
#[tauri::command]
pub fn list_downloads(webview: tauri::Webview) -> Result<Vec<Entry>, String> {
    // The passive preview can read history; file actions still require main.
    if webview.label() != crate::downloads_preview::LABEL {
        authorize(&webview)?;
    }
    Ok(history().lock().unwrap().entries.clone())
}
#[tauri::command]
pub async fn cancel_download(
    app: AppHandle,
    webview: tauri::Webview,
    id: String,
) -> Result<(), String> {
    authorize(&webview)?;
    if crate::download_files::cancel(&id) {
        return Ok(());
    }
    let (kind, key) = target(&id)?;
    match kind {
        "video" => crate::video_download::cancel_video_download(webview, key.into()),
        "browser" => crate::browser_download::action(app, key.into(), false).await,
        _ => Err("This image is saved immediately and cannot be cancelled".into()),
    }
}
#[tauri::command]
pub async fn retry_download(
    app: AppHandle,
    webview: tauri::Webview,
    id: String,
) -> Result<(), String> {
    authorize(&webview)?;
    let (kind, key) = target(&id)?;
    match kind {
        "video" => crate::video_download::retry_video_download(app, webview, key.into()),
        "browser" => crate::browser_download::action(app, key.into(), true).await,
        _ => Err("Use the image’s download button to retry".into()),
    }
}

#[tauri::command]
pub async fn reveal_download(webview: tauri::Webview, id: String) -> Result<(), String> {
    authorize(&webview)?;
    let file = saved_file(&id)?;
    tauri::async_runtime::spawn_blocking(move || crate::download_files::reveal(&file.path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn delete_download(
    app: AppHandle,
    webview: tauri::Webview,
    id: String,
) -> Result<(), String> {
    authorize(&webview)?;
    let file = saved_file(&id)?;
    if file.deleted {
        return Ok(());
    }
    let recycled =
        tauri::async_runtime::spawn_blocking(move || crate::download_files::recycle(&file.path))
            .await
            .map_err(|e| e.to_string())??;
    let entry = {
        let mut registry = history().lock().unwrap();
        if let Some(file) = registry.files.get_mut(&id) {
            file.deleted = true;
        }
        let mut entry = registry
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .cloned()
            .ok_or("Download history has expired")?;
        entry.status = "deleted".into();
        entry.message = if recycled {
            "Moved to Recycle Bin"
        } else {
            "File already removed"
        }
        .into();
        entry.cancelable = false;
        entry.retryable = false;
        registry.record(entry)
    };
    let _ = app.emit_to("main", "download-progress", entry);
    Ok(())
}
#[tauri::command]
pub fn redownload_download(
    app: AppHandle,
    webview: tauri::Webview,
    id: String,
) -> Result<(), String> {
    authorize(&webview)?;
    let file = saved_file(&id)?;
    match &file.replay {
        Replay::Video(key) => {
            crate::video_download::retry_video_download(app, webview, key.clone())
        }
        _ => {
            crate::download_files::start(app, file);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn estimates_average_only_new_bytes_after_transfer_starts_and_reset_for_new_tracks() {
        let start = Instant::now();
        let mut rate = TransferRate::new(start, 1000);
        assert!(rate
            .sample(start + Duration::from_millis(500), 2000, Some(6000))
            .is_none());
        let (speed, remaining) = rate
            .sample(start + Duration::from_secs(2), 3000, Some(6000))
            .unwrap();
        assert_eq!(speed, 1000.0);
        assert_eq!(remaining, Some(3.0));
        let (speed, remaining) = rate
            .sample(start + Duration::from_secs(4), 4000, Some(6000))
            .unwrap();
        assert_eq!(
            speed, 750.0,
            "use the transfer average, not the last chunk's speed"
        );
        assert_eq!(remaining, Some(2000.0 / 750.0));
        assert!(rate
            .sample(start + Duration::from_secs(5), 100, Some(2000))
            .is_none());
        assert_eq!(
            rate.sample(start + Duration::from_secs(6), 600, Some(2000)),
            Some((500.0, Some(2.8)))
        );
        assert!(rate
            .sample(start + Duration::from_secs(16), 600, Some(2000))
            .is_none());
    }
    #[test]
    fn shared_history_exposes_estimates_to_snapshots_and_clears_them_on_pause_and_finalization() {
        let mut history = History::default();
        let start = Instant::now();
        let mut item = Entry::new("video", "estimate", "Video");
        item.status = "downloading".into();
        item.total = Some(1000);
        history.record_at(item.clone(), start, 1000);
        item.downloaded = 200;
        let measured = history.record_at(item.clone(), start + Duration::from_secs(2), 3000);
        assert_eq!(measured.bytes_per_second, Some(100.0));
        assert_eq!(measured.remaining_seconds, Some(8.0));
        assert_eq!(measured.estimate_updated_at, Some(3000));
        let snapshot = serde_json::to_value(&history.entries[0]).unwrap();
        assert_eq!(snapshot["bytesPerSecond"], 100.0);
        assert_eq!(snapshot["remainingSeconds"], 8.0);
        for status in ["merging", "saving", "saved", "error", "cancelled"] {
            let mut finalized = measured.clone();
            finalized.status = status.into();
            let finalized = history.record_at(finalized, start + Duration::from_secs(3), 4000);
            assert!(finalized.bytes_per_second.is_none() && finalized.remaining_seconds.is_none());
            assert!(history.transfers.is_empty());
        }
        history.record_at(item.clone(), start + Duration::from_secs(50), 51_000);
        item.downloaded = 400;
        item.total = None;
        let resumed = history.record_at(item.clone(), start + Duration::from_secs(52), 53_000);
        assert_eq!(
            resumed.bytes_per_second,
            Some(100.0),
            "paused time and existing bytes are excluded"
        );
        assert!(
            resumed.remaining_seconds.is_none(),
            "unknown size cannot have an ETA"
        );
    }
    #[test]
    fn mixed_downloads_keep_identity_order_and_monotonic_revisions() {
        let mut history = History::default();
        let image = history.record(Entry::new("image", "same-id", "Photo"));
        history.record(Entry::new("video", "same-id", "Clip"));
        history.record(Entry::new("browser", "same-id", "archive.zip"));
        let mut saved = image.clone();
        saved.status = "saved".into();
        let saved = history.record(saved);
        assert_eq!(history.entries.len(), 3);
        assert_eq!(history.entries[0].id, "image:same-id");
        assert_eq!(saved.started, image.started);
        assert!(saved.revision > history.entries[2].revision);
        assert_eq!(target("browser:same-id").unwrap(), ("browser", "same-id"));
        assert!(target("unknown:id").is_err());
        assert!(target("video:").is_err());
    }
    #[test]
    fn history_limits_completed_items_without_losing_active_downloads() {
        let mut history = History::default();
        history.record(Entry::new("browser", "active", "Large file"));
        for i in 0..100 {
            let mut item = Entry::new("image", &i.to_string(), "Photo");
            item.status = "saved".into();
            history.record(item);
        }
        assert_eq!(history.entries.len(), 61);
        assert_eq!(history.entries[0].id, "browser:active");
        assert_eq!(history.entries[1].id, "image:40");
    }
    #[test]
    fn saved_file_actions_remain_bound_to_native_records_without_exposing_sources_to_the_page() {
        let mut history = History::default();
        history.files.insert(
            "image:photo".into(),
            SavedFile {
                path: PathBuf::from("C:\\Downloads\\photo.png"),
                kind: "image".into(),
                deleted: false,
                replay: Replay::Resource {
                    url: "https://example.com/private?token=secret".into(),
                    source: "https://example.com".into(),
                    label: "browser-viewport-test".into(),
                    mime: "image/png".into(),
                },
            },
        );
        let mut entry = Entry::new("image", "photo", "Photo");
        entry.status = "saved".into();
        let saved = history.record(entry);
        assert!(saved.has_file && saved.redownloadable && !saved.file_deleted);
        let json = serde_json::to_string(&saved).unwrap();
        assert!(!json.contains("secret") && !json.contains("C:\\") && !json.contains("replay"));
        history.files.get_mut(&saved.id).unwrap().deleted = true;
        let mut deleted = saved.clone();
        deleted.status = "deleted".into();
        let deleted = history.record(deleted);
        assert!(deleted.has_file && deleted.file_deleted && deleted.redownloadable);
        for i in 0..60 {
            let mut entry = Entry::new("browser", &i.to_string(), "File");
            entry.status = "saved".into();
            history.record(entry);
        }
        assert!(
            !history.files.contains_key(&saved.id),
            "expired history releases its private source information too"
        );
    }
}
