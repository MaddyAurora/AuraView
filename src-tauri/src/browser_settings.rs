use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::{
    window::WindowBuilder, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager,
    WebviewBuilder, WebviewUrl, Window,
};

pub const MENU: &str = "browser-settings";
pub const HISTORY: &str = "browser-history";
const APP_KEYS: [&str; 3] = [
    "auraview.bookmarks.v1",
    "auraview.ai-dock.v1",
    "auraview.toolbar-visibility.v1",
];
static KEEP_HISTORY: AtomicBool = AtomicBool::new(true);
static PRUNING: AtomicBool = AtomicBool::new(false);
static CLOSING: AtomicBool = AtomicBool::new(false);
static PROFILE: OnceLock<PathBuf> = OnceLock::new();
static OPERATION: tauri::async_runtime::Mutex<()> = tauri::async_runtime::Mutex::const_new(());
static MENU_OPERATION: tauri::async_runtime::Mutex<()> = tauri::async_runtime::Mutex::const_new(());
static ANCHOR: Mutex<Option<Anchor>> = Mutex::new(None);

#[derive(Clone, Copy, serde::Deserialize)]
pub struct Anchor {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl Anchor {
    fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            && self.width > 0.0
            && self.height > 0.0
    }
    fn contains(self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    keep_history: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self { keep_history: true }
    }
}
fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("browser-settings.json"))
}
fn backup_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("app-preferences-recovery.json"))
}
fn snapshots_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("history-snapshots"))
}
fn write_json(path: &std::path::Path, value: &impl serde::Serialize) -> Result<(), String> {
    std::fs::create_dir_all(path.parent().ok_or("Invalid settings location")?)
        .map_err(|e| e.to_string())?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(
        &temporary,
        serde_json::to_vec(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(temporary, path).map_err(|e| e.to_string())
}
fn authorize(webview: &tauri::Webview) -> Result<(), String> {
    if !matches!(webview.label(), "main" | MENU | HISTORY) {
        return Err("Open settings from AuraView".into());
    }
    Ok(())
}
pub fn initialize(app: &AppHandle) -> Result<(), String> {
    crate::browser_history::clear_snapshots(&snapshots_dir(app)?)?;
    let path = settings_file(app)?;
    let settings = if path.exists() {
        serde_json::from_slice::<Settings>(&std::fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?
    } else {
        Settings::default()
    };
    KEEP_HISTORY.store(settings.keep_history, Ordering::SeqCst);
    Ok(())
}
pub fn attach(webview: &tauri::Webview) -> Result<(), String> {
    #[cfg(windows)]
    {
        webview
            .with_webview(|platform| unsafe {
                use webview2_com_sys::Microsoft::Web::WebView2::Win32::ICoreWebView2_13;
                use windows_core::Interface;
                if let Ok(profile) = platform
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.cast::<ICoreWebView2_13>())
                    .and_then(|core| core.Profile())
                {
                    let mut path = windows_core::PWSTR::null();
                    if profile.ProfilePath(&mut path).is_ok() {
                        let _ = PROFILE.set(PathBuf::from(webview2_com::take_pwstr(path)));
                    }
                }
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
async fn evaluate(app: &AppHandle, script: String) -> Result<String, String> {
    evaluate_view(app, "main", script).await
}
#[cfg(windows)]
async fn evaluate_view(app: &AppHandle, label: &str, script: String) -> Result<String, String> {
    use webview2_com::ExecuteScriptCompletedHandler;
    let main = app
        .get_webview(label)
        .ok_or("Browser view is unavailable")?;
    let (send, receive) = std::sync::mpsc::channel();
    main.with_webview(move |platform| unsafe {
        let result = (|| -> windows_core::Result<()> {
            platform.controller().CoreWebView2()?.ExecuteScript(
                &windows_core::HSTRING::from(script),
                &ExecuteScriptCompletedHandler::create(Box::new({
                    let send = send.clone();
                    move |status, result| {
                        let _ = send.send(status.map(|_| result).map_err(|e| e.to_string()));
                        Ok(())
                    }
                })),
            )
        })();
        if let Err(e) = result {
            let _ = send.send(Err(e.to_string()));
        }
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receive
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "Browser did not finish the operation".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}

// Only this narrow mask is allowed for history cleanup. Never use ALL_PROFILE:
// it also erases login cookies, app bookmarks, and other site preferences.
#[cfg(windows)]
fn data_kinds(
    action: &str,
) -> Result<
    webview2_com_sys::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_BROWSING_DATA_KINDS,
    String,
> {
    use webview2_com_sys::Microsoft::Web::WebView2::Win32::*;
    Ok(match action {
        "history" => COREWEBVIEW2_BROWSING_DATA_KINDS(
            COREWEBVIEW2_BROWSING_DATA_KINDS_BROWSING_HISTORY.0
                | COREWEBVIEW2_BROWSING_DATA_KINDS_DOWNLOAD_HISTORY.0,
        ),
        "urls" => COREWEBVIEW2_BROWSING_DATA_KINDS_BROWSING_HISTORY,
        "cookies" => COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES,
        "sessions" => COREWEBVIEW2_BROWSING_DATA_KINDS(
            COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES.0
                | COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_DOM_STORAGE.0,
        ),
        _ => return Err("Unknown cleanup action".into()),
    })
}

async fn clear_native(app: &AppHandle, action: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use webview2_com::ClearBrowsingDataCompletedHandler;
        use webview2_com_sys::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Profile2, ICoreWebView2_13,
        };
        use windows_core::Interface;
        let kinds = data_kinds(action)?;
        let view = app.get_webview("main").ok_or("Main view is unavailable")?;
        let (send, receive) = std::sync::mpsc::channel();
        view.with_webview(move |platform| unsafe {
            let result = (|| -> windows_core::Result<()> {
                let profile = platform
                    .controller()
                    .CoreWebView2()?
                    .cast::<ICoreWebView2_13>()?
                    .Profile()?
                    .cast::<ICoreWebView2Profile2>()?;
                profile.ClearBrowsingData(
                    kinds,
                    &ClearBrowsingDataCompletedHandler::create(Box::new({
                        let send = send.clone();
                        move |status| {
                            let _ = send.send(status.map_err(|e| e.to_string()));
                            Ok(())
                        }
                    })),
                )
            })();
            if let Err(e) = result {
                let _ = send.send(Err(e.to_string()));
            }
        })
        .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            receive
                .recv_timeout(Duration::from_secs(120))
                .map_err(|_| "Browser cleanup did not finish. Please retry.".to_string())?
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, action);
        Err("Browser cleanup is currently available on Windows".into())
    }
}

pub async fn restore_preferences(app: &AppHandle) -> Result<(), String> {
    let path = backup_file(app)?;
    if !path.exists() {
        return Ok(());
    }
    let values: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        let script=format!("(()=>{{const values={};for(const key of {}){{const value=values[key];if(typeof value==='string')localStorage.setItem(key,value);}}window.dispatchEvent(new StorageEvent('storage'));return true;}})()",values,serde_json::json!(APP_KEYS));
        if evaluate(app, script).await? != "true" {
            return Err("Unable to restore AuraView preferences".into());
        }
        if let Some(raw) = values.get(APP_KEYS[0]).and_then(|value| value.as_str()) {
            if let Ok(bookmarks) = serde_json::from_str::<serde_json::Value>(raw) {
                let _ = app.emit("bookmarks-changed", bookmarks);
            }
        }
        let _ = app.emit("ai-dock-changed", ());
    }
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_settings_ready(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Only AuraView can initialize settings".into());
    }
    let _lock = OPERATION.lock().await;
    restore_preferences(&app).await?;
    if !KEEP_HISTORY.load(Ordering::SeqCst) {
        clear_native(&app, "urls").await?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_browser_settings(webview: tauri::Webview) -> Result<Settings, String> {
    authorize(&webview)?;
    Ok(Settings {
        keep_history: KEEP_HISTORY.load(Ordering::SeqCst),
    })
}
#[tauri::command]
pub async fn set_keep_history(
    app: AppHandle,
    webview: tauri::Webview,
    enabled: bool,
) -> Result<Settings, String> {
    authorize(&webview)?;
    let _lock = OPERATION.lock().await;
    let settings = Settings {
        keep_history: enabled,
    };
    let path = settings_file(&app)?;
    // Persist OFF before clearing, so a crash cannot re-enable retention.
    write_json(&path, &settings)?;
    KEEP_HISTORY.store(enabled, Ordering::SeqCst);
    app.emit("browser-settings-changed", &settings)
        .map_err(|e| e.to_string())?;
    if !enabled {
        clear_native(&app, "urls").await?;
        crate::browser_history::clear_snapshots(&snapshots_dir(&app)?)?;
        app.emit("browser-history-cleared", ())
            .map_err(|e| e.to_string())?;
    }
    Ok(settings)
}
#[tauri::command]
pub async fn clear_browser_data(
    app: AppHandle,
    webview: tauri::Webview,
    action: String,
) -> Result<(), String> {
    authorize(&webview)?;
    let _lock = OPERATION.lock().await;
    if action == "sessions" {
        // Site logins may live in localStorage/IndexedDB. Preserve only the
        // AuraView-owned preference keys, never any website's authentication data.
        #[cfg(windows)]
        {
            restore_preferences(&app).await?;
            let script = format!(
                "JSON.stringify(Object.fromEntries({}.map(key=>[key,localStorage.getItem(key)])))",
                serde_json::json!(APP_KEYS)
            );
            let result = evaluate(&app, script).await?;
            let json: String = serde_json::from_str(&result).map_err(|e| e.to_string())?;
            let values: serde_json::Value =
                serde_json::from_str(&json).map_err(|e| e.to_string())?;
            write_json(&backup_file(&app)?, &values)?;
        }
    }
    let result = clear_native(&app, &action).await;
    // Restoration must also run when native cleanup partially fails.
    if action == "sessions" {
        restore_preferences(&app).await?;
    }
    result?;
    if action == "history" {
        crate::browser_history::clear_snapshots(&snapshots_dir(&app)?)?;
        crate::downloads::clear_completed(&app);
        app.emit("browser-history-cleared", ())
            .map_err(|e| e.to_string())?;
    }
    if matches!(action.as_str(), "cookies" | "sessions") {
        for (label, view) in app.webviews() {
            if label.starts_with("browser-viewport-") || label.starts_with("browser-split-") {
                #[cfg(windows)]
                if action == "sessions" {
                    evaluate_view(
                        &app,
                        &label,
                        "(()=>{try{sessionStorage.clear();return true}catch{return false}})()"
                            .into(),
                    )
                    .await?;
                }
                view.reload().map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

pub fn prune(app: &AppHandle) {
    if KEEP_HISTORY.load(Ordering::SeqCst) || PRUNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _lock = OPERATION.lock().await;
        if !KEEP_HISTORY.load(Ordering::SeqCst) {
            if let Err(error) = clear_native(&app, "urls").await {
                let _ = app.emit("browser-history-error", error);
            }
        }
        PRUNING.store(false, Ordering::SeqCst);
    });
}
pub fn close_requested(app: &AppHandle, api: &tauri::CloseRequestApi) {
    api.prevent_close();
    if CLOSING.swap(true, Ordering::SeqCst) {
        return;
    }
    if KEEP_HISTORY.load(Ordering::SeqCst) {
        app.exit(0);
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _lock = OPERATION.lock().await;
        match clear_native(&app, "urls").await {
            Ok(()) => app.exit(0),
            Err(error) => {
                CLOSING.store(false, Ordering::SeqCst);
                let _ = app.emit(
                    "browser-history-error",
                    format!("Could not clear URL history before closing: {error}"),
                );
            }
        }
    });
}

#[tauri::command]
pub async fn list_browser_history(
    app: AppHandle,
    webview: tauri::Webview,
    search: Option<String>,
    offset: Option<u32>,
) -> Result<crate::browser_history::Page, String> {
    authorize(&webview)?;
    let _lock = OPERATION.lock().await;
    if !KEEP_HISTORY.load(Ordering::SeqCst) {
        return Ok(crate::browser_history::Page {
            visits: vec![],
            more: false,
        });
    }
    let path = PROFILE
        .get()
        .ok_or("Browser profile is not ready. Please refresh.")?
        .join("History");
    let search = search.unwrap_or_default();
    if search.len() > 2000 {
        return Err("Search is too long".into());
    }
    let snapshots = snapshots_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::browser_history::read(&path, &snapshots, &search, offset.unwrap_or(0))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn dismiss(app: &AppHandle) {
    *ANCHOR.lock().unwrap() = None;
    if let Some(window) = app.get_window(MENU) {
        let _ = window.hide();
    }
}
pub fn main_focused(window: &Window) {
    #[cfg(windows)]
    {
        if let Some(anchor) = *ANCHOR.lock().unwrap() {
            if let (Ok(cursor), Ok(origin), Ok(scale)) = (
                window.cursor_position(),
                window.inner_position(),
                window.scale_factor(),
            ) {
                let x = (cursor.x - origin.x as f64) / scale;
                let y = (cursor.y - origin.y as f64) / scale;
                if anchor.contains(x, y)
                    && unsafe {
                        windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(0x01) < 0
                    }
                {
                    return;
                }
            }
        }
    }
    dismiss(window.app_handle());
}
#[tauri::command]
pub async fn toggle_browser_settings(
    app: AppHandle,
    webview: tauri::Webview,
    window: Window,
    anchor: Anchor,
) -> Result<(), String> {
    if webview.label() != "main" || window.label() != "main" || !anchor.valid() {
        return Err("Invalid settings menu request".into());
    }
    let _lock = MENU_OPERATION.lock().await;
    if ANCHOR.lock().unwrap().is_some() {
        dismiss(&app);
        return Ok(());
    }
    crate::downloads_preview::hide(&app);
    crate::bookmark_folder::close(&app)?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let origin = window
        .inner_position()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let size = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let width = 350_f64.min(size.width);
    let height = 440_f64.min(size.height);
    let x = origin.x + (anchor.x + anchor.width - width).clamp(0.0, (size.width - width).max(0.0));
    let y = origin.y + (anchor.y + anchor.height + 4.0).clamp(0.0, (size.height - height).max(0.0));
    *ANCHOR.lock().unwrap() = Some(anchor);
    let popup = if let Some(popup) = app.get_window(MENU) {
        popup
    } else {
        let popup = WindowBuilder::new(&app, MENU)
            .title("Settings")
            .inner_size(width, height)
            .position(x, y)
            .decorations(false)
            .resizable(false)
            .skip_taskbar(true)
            .visible(false)
            .parent(&window)
            .map_err(|e| e.to_string())?
            .build()
            .map_err(|e| e.to_string())?;
        if let Err(error) = popup.add_child(
            WebviewBuilder::new(MENU, WebviewUrl::App("index.html#browser-settings".into()))
                .auto_resize(),
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(width, height),
        ) {
            let _ = popup.destroy();
            *ANCHOR.lock().unwrap() = None;
            return Err(error.to_string());
        }
        popup
    };
    popup
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    popup
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    popup.show().map_err(|e| e.to_string())?;
    popup.set_focus().map_err(|e| e.to_string())?;
    if let Some(view) = app.get_webview(MENU) {
        view.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn close_browser_settings(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    authorize(&webview)?;
    dismiss(&app);
    Ok(())
}
#[tauri::command]
pub async fn open_browser_history(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    authorize(&webview)?;
    dismiss(&app);
    if let Some(window) = app.get_window(HISTORY) {
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let main = app.get_window("main").ok_or("Main window is unavailable")?;
    let window = WindowBuilder::new(&app, HISTORY)
        .title("History — AuraView")
        .inner_size(1000.0, 720.0)
        .min_inner_size(540.0, 360.0)
        .parent(&main)
        .map_err(|e| e.to_string())?
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    if let Err(error) = window.add_child(
        WebviewBuilder::new(
            HISTORY,
            WebviewUrl::App("index.html#browser-history".into()),
        )
        .auto_resize(),
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(1000.0, 720.0),
    ) {
        let _ = window.destroy();
        return Err(error.to_string());
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn open_history_url(
    app: AppHandle,
    webview: tauri::Webview,
    url: String,
) -> Result<(), String> {
    if webview.label() != HISTORY {
        return Err("Open a link from History".into());
    }
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "file") {
        return Err("Unsupported history link".into());
    }
    app.emit_to("main", "history-open-url", url)
        .map_err(|e| e.to_string())?;
    if let Some(window) = app.get_window("main") {
        let _ = window.set_focus();
    }
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use webview2_com_sys::Microsoft::Web::WebView2::Win32::*;
    #[test]
    fn history_cleanup_never_includes_cookies_or_site_storage() {
        let value = data_kinds("history").unwrap().0;
        assert_ne!(
            value & COREWEBVIEW2_BROWSING_DATA_KINDS_BROWSING_HISTORY.0,
            0
        );
        assert_ne!(
            value & COREWEBVIEW2_BROWSING_DATA_KINDS_DOWNLOAD_HISTORY.0,
            0
        );
        assert_eq!(value & COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES.0, 0);
        assert_eq!(
            value & COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_DOM_STORAGE.0,
            0
        );
        assert_eq!(
            data_kinds("urls").unwrap(),
            COREWEBVIEW2_BROWSING_DATA_KINDS_BROWSING_HISTORY
        );
        assert!(data_kinds("all").is_err());
        assert_eq!(
            data_kinds("cookies").unwrap(),
            COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES
        );
        assert_eq!(
            data_kinds("sessions").unwrap().0,
            COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES.0
                | COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_DOM_STORAGE.0
        );
    }
    #[test]
    fn retention_preference_can_be_replaced_atomically_and_loaded_after_restart() {
        let root = std::env::temp_dir().join(format!(
            "auraview-settings-test-{}",
            crate::image_download::token()
        ));
        let path = root.join("browser-settings.json");
        for keep_history in [false, true, false] {
            write_json(&path, &Settings { keep_history }).unwrap();
            assert_eq!(
                serde_json::from_slice::<Settings>(&std::fs::read(&path).unwrap())
                    .unwrap()
                    .keep_history,
                keep_history
            );
        }
        assert!(!path.with_extension("json.tmp").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
