use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewBuilder, WebviewUrl,
};

mod shortcuts;
mod fullscreen;
mod tab_overflow;
mod tab_context_menu;
mod page_context_menu;
mod favicon;
mod tab_audio;
mod image_download;
mod video_download;
mod downloads;
mod downloads_preview;
mod browser_download;
mod download_files;
mod bookmark_menu;
mod bookmark_editor;
mod bookmark_folder;
mod bookmark_transfer;
mod ai_dock;
mod browser_history;
mod browser_settings;
mod adblock;
mod adblock_sites;

struct BrowserState {
    last_requested_url: String,
    offline_retry_target: Option<Url>,
    generation: u64,
    visible: bool,
}

impl BrowserState {
    const fn new(visible: bool) -> Self {
        Self { last_requested_url: String::new(), offline_retry_target: None, generation: 0, visible }
    }
}

#[derive(Default)]
struct BrowserRegistry {
    states: HashMap<(String, &'static str), Arc<Mutex<BrowserState>>>,
    closed_views: HashSet<(String, &'static str)>,
    active_tab_id: Option<String>,
}

static REGISTRY: OnceLock<Mutex<BrowserRegistry>> = OnceLock::new();
static LAYOUT_LOCK: Mutex<()> = Mutex::new(());

fn registry() -> &'static Mutex<BrowserRegistry> {
    REGISTRY.get_or_init(|| Mutex::new(BrowserRegistry::default()))
}

fn pane_details(pane: Option<&str>) -> Result<(&'static str, &'static str), String> {
    match pane {
        None | Some("primary") => Ok(("primary", "browser-viewport")),
        Some("secondary") => Ok(("secondary", "browser-split")),
        _ => Err("Unknown browser pane".to_string()),
    }
}

fn browser_label(tab_id: &str, pane: &'static str) -> Result<String, String> {
    if tab_id.is_empty() || tab_id.len() > 80
        || !tab_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') {
        return Err("Invalid browser tab identifier".to_string());
    }
    let (_, prefix) = pane_details(Some(pane))?;
    Ok(format!("{}-{}", prefix, tab_id))
}

fn browser_state(tab_id: &str, pane: &'static str) -> Arc<Mutex<BrowserState>> {
    registry().lock().unwrap().states.entry((tab_id.to_string(), pane))
        .or_insert_with(|| Arc::new(Mutex::new(BrowserState::new(false)))).clone()
}

fn local_server_addresses(url: &Url) -> Option<Vec<SocketAddr>> {
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let port = url.port_or_known_default()?;
    let host = url.host_str()?.trim_matches(['[', ']']);
    if host == "localhost" {
        return Some(vec![
            SocketAddr::from(([127, 0, 0, 1], port)),
            SocketAddr::new(std::net::Ipv6Addr::LOCALHOST.into(), port),
        ]);
    }
    let ip: std::net::IpAddr = host.parse().ok()?;
    ip.is_loopback().then(|| vec![SocketAddr::new(ip, port)])
}

fn local_server_is_online(url: &Url) -> bool {
    local_server_addresses(url).map(|addresses| {
        addresses.iter().any(|address| {
            TcpStream::connect_timeout(address, Duration::from_millis(250)).is_ok()
        })
    }).unwrap_or(false)
}

fn retry_target(offline_page: &Url, requested_url: &str) -> Option<Url> {
    if !offline_page.as_str().starts_with("data:text/html") {
        return None;
    }
    let target = Url::parse(requested_url).ok()?;
    local_server_addresses(&target)?;
    Some(target)
}

fn retry_local_server(app: AppHandle, tab_id: String, pane: &'static str, label: String, state: Arc<Mutex<BrowserState>>) {
    let (generation, target) = {
        let state = state.lock().unwrap();
        if !state.visible { return; }
        let Some(target) = state.offline_retry_target.clone() else { return };
        (state.generation, target)
    };
    std::thread::spawn(move || {
        let online = local_server_is_online(&target);
        let app_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            {
                let state = state.lock().unwrap();
                if !state.visible || state.generation != generation { return; }
            }
            let Some(webview) = app_main.get_webview(&label) else { return };
            let connecting = if online {
                let _ = app_main.emit("webview-status", navigation_status(&tab_id, pane, target.as_str(), true));
                let started = webview.navigate(target.clone()).is_ok();
                if !started {
                    let _ = app_main.emit("webview-status", navigation_status(&tab_id, pane, target.as_str(), false));
                }
                started
            } else { false };
            let _ = webview.eval(&format!(
                "if (typeof window.onNativeRetryResult === 'function') window.onNativeRetryResult({});", connecting
            ));
        });
    });
}

fn base64_encode(input: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };

        out.push(CHARSET[(b0 >> 2) as usize] as char);
        out.push(CHARSET[(((b0 & 3) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARSET[(((b1 & 15) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARSET[(b2 & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn urlencoding_simple(s: &str) -> String {
    let mut result = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
            result.push(b as char);
        } else {
            result.push_str(&format!("%{:02X}", b));
        }
    }
    result
}

fn make_custom_error_url(failed_url: &str, error_code: &str) -> Url {
    let parsed = Url::parse(failed_url).ok();
    let host = parsed.as_ref().and_then(|u| u.host_str()).unwrap_or("").to_string();
    let domain = if !host.is_empty() { host.clone() } else { failed_url.to_string() };
    let is_local = host == "localhost"
        || host == "127.0.0.1"
        || host.parse::<std::net::IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false);
    let port = parsed.as_ref().and_then(|u| u.port()).unwrap_or(if parsed.as_ref().map(|u| u.scheme()) == Some("https") { 443 } else { 80 });

    let search_query = urlencoding_simple(&domain);
    let search_url = format!("https://www.google.com/search?q={}", search_query);

    let html = if is_local {
        format!(r##"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Local AI Server Offline • AuraView</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background-color: #090c10;
      color: #e5e7eb;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      overflow-x: hidden;
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(168, 85, 247, 0.1) 0%, transparent 40%),
        radial-gradient(circle at 85% 85%, rgba(245, 158, 11, 0.08) 0%, transparent 40%);
    }}
    .card {{
      background: #0f141c;
      border: 1px solid #1f2937;
      border-radius: 16px;
      padding: 40px;
      max-width: 580px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      text-align: center;
    }}
    .badge {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 9999px;
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.25);
      color: #fbbf24;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.05em;
      margin-bottom: 24px;
    }}
    .badge-dot {{
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #f59e0b;
      box-shadow: 0 0 8px #f59e0b;
      animation: pulse 2s infinite;
    }}
    @keyframes pulse {{
      0%, 100% {{ opacity: 1; transform: scale(1); }}
      50% {{ opacity: 0.4; transform: scale(0.8); }}
    }}
    .icon-wrapper {{
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(168, 85, 247, 0.15));
      border: 1px solid rgba(245, 158, 11, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      box-shadow: 0 0 24px rgba(245, 158, 11, 0.2);
    }}
    .icon-wrapper svg {{
      width: 36px;
      height: 36px;
      stroke: #fbbf24;
    }}
    h1 {{
      font-size: 22px;
      font-weight: 700;
      color: #f9fafb;
      margin-bottom: 10px;
      letter-spacing: -0.02em;
    }}
    .description {{
      font-size: 14px;
      color: #9ca3af;
      line-height: 1.6;
      margin-bottom: 20px;
    }}
    .domain-tag {{
      color: #fbbf24;
      font-weight: 600;
      word-break: break-all;
    }}
    .error-code {{
      display: inline-block;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      color: #f87171;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.2);
      padding: 3px 8px;
      border-radius: 6px;
      margin-bottom: 20px;
    }}
    .status-bar {{
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-size: 12px;
      color: #9ca3af;
      margin-bottom: 24px;
      padding: 8px 14px;
      background: #151e28;
      border-radius: 8px;
      border: 1px solid #1f2937;
    }}
    .status-dot {{
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #3b82f6;
      animation: pulse 1.5s infinite;
    }}
    .suggestions {{
      background: #151e28;
      border: 1px solid #1f2937;
      border-radius: 10px;
      padding: 16px 20px;
      text-align: left;
      font-size: 13px;
      color: #9ca3af;
      margin-bottom: 28px;
    }}
    .suggestions p {{
      font-weight: 600;
      color: #d1d5db;
      margin-bottom: 8px;
    }}
    .suggestions ul {{
      list-style-position: inside;
      line-height: 1.8;
    }}
    .buttons {{
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: center;
    }}
    .btn {{
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
      border: none;
    }}
    .btn-primary {{
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(245, 158, 11, 0.35);
    }}
    .btn-primary:hover {{
      opacity: 0.92;
      transform: translateY(-1px);
    }}
    .btn-secondary {{
      background: #1f2937;
      color: #e5e7eb;
      border: 1px solid #374151;
    }}
    .btn-secondary:hover {{
      background: #283548;
      color: #ffffff;
    }}
    .footer {{
      margin-top: 28px;
      font-size: 11px;
      color: #4b5563;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">
      <div class="badge-dot"></div>
      AuraView Local AI Engine
    </div>

    <div class="icon-wrapper">
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
        <line x1="6" y1="6" x2="6.01" y2="6"></line>
        <line x1="6" y1="18" x2="6.01" y2="18"></line>
      </svg>
    </div>

    <h1>Local AI Server Offline</h1>
    <p class="description">
      No service is currently listening on <span class="domain-tag">localhost:{port}</span>.
    </p>

    <div class="error-code">{error_code}</div>

    <div class="status-bar">
      <div class="status-dot"></div>
      <span id="status-text">Server offline. Checking again in 10 seconds...</span>
    </div>

    <div class="suggestions">
      <p>How to resolve:</p>
      <ul>
        <li>Start your local AI engine (ComfyUI, Stable Diffusion WebUI, Ollama, LM Studio, etc.)</li>
        <li>Confirm the server is set to port <strong>{port}</strong></li>
        <li>This tab will automatically load the interface once the server is ready</li>
      </ul>
    </div>

    <div class="buttons">
      <button class="btn btn-primary" onclick="retryNow()">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
        </svg>
        Retry Connection
      </button>
      <a class="btn btn-secondary" href="https://www.google.com">
        Home
      </a>
    </div>

    <div class="footer">
      AuraView Lightweight Browser • Privacy &amp; Performance First
    </div>
  </div>

  <script>
    {retry_script}
  </script>
</body>
</html>"##,
            port = port,
            error_code = error_code,
            retry_script = include_str!("offline-retry.js"),
        )
    } else {
        format!(r##"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Site Unreachable • AuraView</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background-color: #090c10;
      color: #e5e7eb;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      overflow-x: hidden;
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(168, 85, 247, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 85% 85%, rgba(6, 182, 212, 0.08) 0%, transparent 40%);
    }}
    .card {{
      background: #0f141c;
      border: 1px solid #1f2937;
      border-radius: 16px;
      padding: 40px;
      max-width: 580px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      text-align: center;
    }}
    .badge {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.12);
      border: 1px solid rgba(168, 85, 247, 0.25);
      color: #c084fc;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.05em;
      margin-bottom: 24px;
    }}
    .badge-dot {{
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #a855f7;
      box-shadow: 0 0 8px #a855f7;
    }}
    .icon-wrapper {{
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(6, 182, 212, 0.15));
      border: 1px solid rgba(168, 85, 247, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      box-shadow: 0 0 24px rgba(168, 85, 247, 0.2);
    }}
    .icon-wrapper svg {{
      width: 36px;
      height: 36px;
      stroke: #38bdf8;
    }}
    h1 {{
      font-size: 22px;
      font-weight: 700;
      color: #f9fafb;
      margin-bottom: 10px;
      letter-spacing: -0.02em;
    }}
    .description {{
      font-size: 14px;
      color: #9ca3af;
      line-height: 1.6;
      margin-bottom: 20px;
    }}
    .domain-tag {{
      color: #38bdf8;
      font-weight: 600;
      word-break: break-all;
    }}
    .error-code {{
      display: inline-block;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      color: #f87171;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.2);
      padding: 3px 8px;
      border-radius: 6px;
      margin-bottom: 24px;
    }}
    .suggestions {{
      background: #151e28;
      border: 1px solid #1f2937;
      border-radius: 10px;
      padding: 16px 20px;
      text-align: left;
      font-size: 13px;
      color: #9ca3af;
      margin-bottom: 28px;
    }}
    .suggestions p {{
      font-weight: 600;
      color: #d1d5db;
      margin-bottom: 8px;
    }}
    .suggestions ul {{
      list-style-position: inside;
      line-height: 1.8;
    }}
    .buttons {{
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: center;
    }}
    .btn {{
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
      border: none;
    }}
    .btn-primary {{
      background: linear-gradient(135deg, #9333ea, #06b6d4);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(147, 51, 234, 0.35);
    }}
    .btn-primary:hover {{
      opacity: 0.92;
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(147, 51, 234, 0.5);
    }}
    .btn-secondary {{
      background: #1f2937;
      color: #e5e7eb;
      border: 1px solid #374151;
    }}
    .btn-secondary:hover {{
      background: #283548;
      color: #ffffff;
      border-color: #4b5563;
    }}
    .footer {{
      margin-top: 28px;
      font-size: 11px;
      color: #4b5563;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">
      <div class="badge-dot"></div>
      AuraView Safe Navigation
    </div>

    <div class="icon-wrapper">
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" stroke="#f87171" stroke-width="2.5"></line>
      </svg>
    </div>

    <h1>Hmmm… can't reach this page</h1>
    <p class="description">
      The server for <span class="domain-tag">{domain}</span> could not be reached or does not exist.
    </p>

    <div class="error-code">{error_code}</div>

    <div class="suggestions">
      <p>Troubleshooting suggestions:</p>
      <ul>
        <li>Check the URL spelling for typos</li>
        <li>Verify your internet connection and DNS settings</li>
        <li>Search for the site name directly below</li>
      </ul>
    </div>

    <div class="buttons">
      <a class="btn btn-primary" href="{search_url}">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        Search Google
      </a>
      <a class="btn btn-secondary" href="{failed_url}">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
        </svg>
        Try Again
      </a>
      <a class="btn btn-secondary" href="https://www.google.com">
        Home
      </a>
    </div>

    <div class="footer">
      AuraView Lightweight Browser • Privacy &amp; Performance First
    </div>
  </div>
</body>
</html>"##,
            domain = domain,
            error_code = error_code,
            search_url = search_url,
            failed_url = failed_url,
        )
    };

    let encoded = base64_encode(html.as_bytes());
    Url::parse(&format!("data:text/html;base64,{}", encoded)).unwrap()
}

#[allow(unused_variables)]
fn log_debug(msg: &str) {
    #[cfg(debug_assertions)]
    eprintln!("[DEBUG] {}", msg);
}

/// Check if a local port is currently open and reachable
#[tauri::command]
fn check_port_active(port: u16) -> bool {
    let address: Result<SocketAddr, _> = format!("127.0.0.1:{}", port).parse();
    if let Ok(addr) = address {
        TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
    } else {
        false
    }
}

#[tauri::command]
fn log_client_event(msg: String) {
    log_debug(&format!("CLIENT_EVENT: {}", msg));
}

#[tauri::command]
fn app_minimize(app: AppHandle) {
    log_debug("app_minimize CALLED");
    if let Some(w) = app.get_window("main") {
        log_debug("app_minimize: found window 'main'");
        let res = w.minimize();
        log_debug(&format!("app_minimize result: {:?}", res));
    } else {
        log_debug("app_minimize: window 'main' NOT FOUND");
    }
}

#[tauri::command]
fn app_toggle_maximize(app: AppHandle) -> bool {
    log_debug("app_toggle_maximize CALLED");
    if let Some(w) = app.get_window("main") {
        if let Ok(is_max) = w.is_maximized() {
            if is_max {
                let _ = w.unmaximize();
                log_debug("app_toggle_maximize: unmaximized");
                return false;
            } else {
                let _ = w.maximize();
                log_debug("app_toggle_maximize: maximized");
                return true;
            }
        }
    }
    false
}

#[tauri::command]
fn app_is_maximized(app: AppHandle) -> bool {
    if let Some(w) = app.get_window("main") {
        w.is_maximized().unwrap_or(false)
    } else {
        false
    }
}

#[tauri::command]
fn app_close(app: AppHandle) {
    log_debug("app_close CALLED");
    if let Some(w) = app.get_window("main") {
        log_debug("app_close: closing window 'main'");
        let _ = w.close();
    }
}

#[tauri::command]
fn app_start_dragging(app: AppHandle) {
    log_debug("app_start_dragging CALLED");
    if let Some(w) = app.get_window("main") {
        let res = w.start_dragging();
        log_debug(&format!("app_start_dragging result: {:?}", res));
    } else {
        log_debug("app_start_dragging: window 'main' NOT FOUND");
    }
}

#[tauri::command]
fn app_open_devtools(app: AppHandle) {
    log_debug("app_open_devtools CALLED");
    if let Some(w) = app.get_webview("main") {
        if w.is_devtools_open() {
            log_debug("app_open_devtools: closing devtools on 'main'");
            w.close_devtools();
        } else {
            log_debug("app_open_devtools: opening devtools on 'main'");
            w.open_devtools();
        }
    }
}

#[derive(serde::Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct WebviewStatusPayload {
    pub tab_id: String,
    pub pane: &'static str,
    pub url: Option<String>,
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favicon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favicon_page_url: Option<String>,
    pub is_loading: Option<bool>,
    pub can_go_back: Option<bool>,
    pub can_go_forward: Option<bool>,
}

fn navigation_status(tab_id: &str, pane: &'static str, url: &str, is_loading: bool) -> WebviewStatusPayload {
    let is_error_page = url.starts_with("data:text/html")
        || url.starts_with("chrome-error://") || url.starts_with("edge://chromewebdata");
    WebviewStatusPayload {
        tab_id: tab_id.to_string(), pane,
        url: if is_error_page { None } else { Some(url.to_string()) },
        is_loading: Some(is_loading && !is_error_page), ..Default::default()
    }
}

fn destination_url(url: &Url) -> Url {
    if local_server_addresses(url).is_some() {
        if !local_server_is_online(url) {
            return make_custom_error_url(url.as_str(), "ERR_CONNECTION_REFUSED");
        }
    } else if matches!(url.scheme(), "http" | "https") {
        let host = url.host_str().unwrap_or("");
        if format!("{}:443", host).to_socket_addrs().is_err()
            && format!("{}:80", host).to_socket_addrs().is_err() {
            return make_custom_error_url(url.as_str(), "ERR_NAME_NOT_RESOLVED");
        }
    }
    url.clone()
}

fn begin_navigation(app: &AppHandle, tab_id: &str, pane: &'static str, url: &Url) -> Url {
    let destination = destination_url(url);
    {
        let state = browser_state(tab_id, pane);
        let mut state = state.lock().unwrap();
        state.generation += 1;
        state.last_requested_url = url.to_string();
        state.offline_retry_target = retry_target(&destination, url.as_str());
    }
    let _ = app.emit("webview-status", navigation_status(tab_id, pane, url.as_str(), !destination.as_str().starts_with("data:text/html")));
    destination
}

#[tauri::command]
async fn navigate_browser_view(app: AppHandle, url: String, pane: Option<String>, tab_id: Option<String>) -> Result<(), String> {
    let (pane, _) = pane_details(pane.as_deref())?;
    let tab_id = tab_id.as_deref().unwrap_or("tab-1");
    let label = browser_label(tab_id, pane)?;
    let parsed = Url::parse(&url).map_err(|error| error.to_string())?;
    let webview = app.get_webview(&label).ok_or("Browser pane is not ready")?;
    let destination = begin_navigation(&app, tab_id, pane, &parsed);
    let generation = browser_state(tab_id, pane).lock().unwrap().generation;
    adblock_sites::prepare_navigation(&webview, destination.as_str()).await;
    // Preparing the network policy must not let an older click replace a newer one.
    if browser_state(tab_id, pane).lock().unwrap().generation != generation { return Ok(()); }
    // A late command for a background tab must not bring its webview forward.
    if browser_state(tab_id, pane).lock().unwrap().visible {
        let _ = webview.set_focus();
    }
    if let Err(error) = webview.navigate(destination) {
        let _ = app.emit("webview-status", navigation_status(tab_id, pane, &url, false));
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
async fn reload_browser_view(app: AppHandle, pane: Option<String>, tab_id: Option<String>) -> Result<(), String> {
    let (pane, _) = pane_details(pane.as_deref())?;
    let tab_id = tab_id.as_deref().unwrap_or("tab-1");
    let label = browser_label(tab_id, pane)?;
    let (url, offline) = {
        let state = browser_state(tab_id, pane);
        let state = state.lock().unwrap();
        (state.last_requested_url.clone(), state.offline_retry_target.is_some())
    };
    if offline { return navigate_browser_view(app, url, Some(pane.to_string()), Some(tab_id.to_string())).await; }
    let webview = app.get_webview(&label).ok_or("Browser pane is not ready")?;
    adblock_sites::prepare_navigation(&webview, &url).await;
    let _ = app.emit("webview-status", navigation_status(tab_id, pane, &url, true));
    webview.reload().map_err(|error| error.to_string())
}

#[tauri::command]
fn go_back_browser_view(app: AppHandle, pane: Option<String>, tab_id: Option<String>) -> Result<(), String> {
    let (pane, _) = pane_details(pane.as_deref())?;
    let label = browser_label(tab_id.as_deref().unwrap_or("tab-1"), pane)?;
    let webview = app.get_webview(&label).ok_or("Browser pane is not ready")?;
    #[cfg(windows)]
    webview.with_webview(move |platform| unsafe {
        if let Ok(core) = platform.controller().CoreWebView2() {
            let mut can_back = windows_core::BOOL(0);
            if core.CanGoBack(&mut can_back).is_ok() && can_back.as_bool() { let _ = core.GoBack(); }
        }
    }).map_err(|error| error.to_string())?;
    #[cfg(not(windows))]
    webview.eval("window.history.back()").map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn go_forward_browser_view(app: AppHandle, pane: Option<String>, tab_id: Option<String>) -> Result<(), String> {
    let (pane, _) = pane_details(pane.as_deref())?;
    let label = browser_label(tab_id.as_deref().unwrap_or("tab-1"), pane)?;
    let webview = app.get_webview(&label).ok_or("Browser pane is not ready")?;
    #[cfg(windows)]
    webview.with_webview(move |platform| unsafe {
        if let Ok(core) = platform.controller().CoreWebView2() {
            let mut can_forward = windows_core::BOOL(0);
            if core.CanGoForward(&mut can_forward).is_ok() && can_forward.as_bool() { let _ = core.GoForward(); }
        }
    }).map_err(|error| error.to_string())?;
    #[cfg(not(windows))]
    webview.eval("window.history.forward()").map_err(|error| error.to_string())?;
    Ok(())
}

// A same-document navigation (pushState, replaceState, fragment, back/forward)
// changes the address without starting or finishing a document load.
fn location_status(state: &mut BrowserState, tab_id: &str, pane: &'static str,
    url: &str, back: Option<bool>, forward: Option<bool>) -> WebviewStatusPayload {
    let public_url = !url.is_empty() && url != "about:blank"
        && !url.starts_with("data:text/html") && !url.starts_with("chrome-error://")
        && !url.starts_with("edge://chromewebdata");
    if public_url && state.last_requested_url != url {
        state.generation += 1;
        state.last_requested_url = url.to_string();
        state.offline_retry_target = None;
    }
    WebviewStatusPayload { tab_id: tab_id.to_string(), pane,
        url: public_url.then(|| url.to_string()), can_go_back: back, can_go_forward: forward,
        ..Default::default() }
}

#[cfg(windows)]
fn emit_native_location(app: &AppHandle,
    core: &webview2_com_sys::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    state: &Arc<Mutex<BrowserState>>, tab_id: &str, pane: &'static str) -> windows_core::Result<()> {
    unsafe {
        let mut source = windows_core::PWSTR::null();
        core.Source(&mut source)?;
        let url = webview2_com::take_pwstr(source);
        let mut back = windows_core::BOOL(0);
        let mut forward = windows_core::BOOL(0);
        let back = core.CanGoBack(&mut back).is_ok().then(|| back.as_bool());
        let forward = core.CanGoForward(&mut forward).is_ok().then(|| forward.as_bool());
        let status = location_status(&mut state.lock().unwrap(), tab_id, pane, &url, back, forward);
        let _ = app.emit("webview-status", status);
        browser_settings::prune(app);
    }
    Ok(())
}

fn emit_history_status(app: AppHandle, webview: &tauri::Webview, tab_id: &str, pane: &'static str) {
    let tab_id = tab_id.to_string();
    #[cfg(windows)]
    let _ = webview.with_webview(move |platform| unsafe {
        if let Ok(core) = platform.controller().CoreWebView2() {
            let _ = emit_native_location(&app, &core, &browser_state(&tab_id, pane), &tab_id, pane);
        }
    });
}

fn install_location_events(app: &AppHandle, webview: &tauri::Webview, tab_id: &str, pane: &'static str) -> tauri::Result<()> {
    #[cfg(windows)]
    {
        let app = app.clone();
        let tab_id = tab_id.to_string();
        let state = browser_state(&tab_id, pane);
        webview.with_webview(move |platform| unsafe {
            use webview2_com::{SourceChangedEventHandler, HistoryChangedEventHandler};
            if let Ok(core) = platform.controller().CoreWebView2() {
                let source_app = app.clone();
                let source_tab = tab_id.clone();
                let source_state = state.clone();
                let source = SourceChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(core) = sender {
                        emit_native_location(&source_app, &core, &source_state, &source_tab, pane)?;
                    }
                    Ok(())
                }));
                let history_app = app.clone();
                let history_tab = tab_id.clone();
                let history_state = state.clone();
                let history = HistoryChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(core) = sender {
                        emit_native_location(&history_app, &core, &history_state, &history_tab, pane)?;
                    }
                    Ok(())
                }));
                let mut token = 0;
                if let Err(error) = core.add_SourceChanged(&source, &mut token)
                    .and_then(|_| core.add_HistoryChanged(&history, &mut token)) {
                    eprintln!("Unable to track browser URL changes: {error}");
                }
                let _ = emit_native_location(&app, &core, &state, &tab_id, pane);
            }
        })?;
    }
    #[cfg(not(windows))]
    let _ = (app, webview, tab_id, pane);
    Ok(())
}

#[derive(serde::Deserialize, Clone, Copy, Debug)]
struct BrowserBounds { x: f64, y: f64, width: f64, height: f64 }

impl BrowserBounds {
    fn validate(&self) -> Result<(), String> {
        if [self.x, self.y, self.width, self.height].iter().all(|value| value.is_finite())
            && self.x >= 0.0 && self.y >= 0.0 && self.width > 0.0 && self.height > 0.0 { Ok(()) }
        else { Err("Invalid browser pane bounds".to_string()) }
    }
    fn apply(&self, webview: &tauri::Webview) -> Result<(), String> {
        self.validate()?;
        webview.set_position(LogicalPosition::new(self.x, self.y)).map_err(|error| error.to_string())?;
        webview.set_size(LogicalSize::new(self.width, self.height)).map_err(|error| error.to_string())
    }
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct BrowserViewRef { tab_id: String, pane: String }

impl BrowserViewRef {
    fn key(&self) -> Result<(String, &'static str), String> {
        let (pane, _) = pane_details(Some(&self.pane))?;
        browser_label(&self.tab_id, pane)?;
        Ok((self.tab_id.clone(), pane))
    }
}

// Layout slots and page identities are separate: detaching a split keeps the
// same WebView2 instance, event callbacks, loaded document, and history.
fn browser_layout(tab_id: &str, primary: BrowserBounds, secondary: Option<BrowserBounds>,
    reversed: bool, primary_view: Option<BrowserViewRef>, secondary_view: Option<BrowserViewRef>)
    -> Result<Vec<(BrowserViewRef, BrowserBounds, &'static str)>, String> {
    primary.validate()?;
    if let Some(bounds) = secondary { bounds.validate()?; }
    let (primary, secondary) = ordered_pane_bounds(primary, secondary, reversed);
    let primary_view = primary_view.unwrap_or(BrowserViewRef { tab_id: tab_id.to_string(), pane: "primary".to_string() });
    let secondary_view = secondary_view.unwrap_or(BrowserViewRef { tab_id: tab_id.to_string(), pane: "secondary".to_string() });
    let mut views = Vec::new();
    let mut keys = HashSet::new();
    for (view, bounds, slot) in [(primary_view, primary, "primary"), (secondary_view, secondary, "secondary")] {
        if let Some(bounds) = bounds {
            if !keys.insert(view.key()?) { return Err("A browser page cannot occupy both split panes".to_string()); }
            views.push((view, bounds, slot));
        }
    }
    Ok(views)
}

fn layout_focus_target(active_tab_id: Option<&str>, tab_id: &str, reversed: bool,
    layout: &[(BrowserViewRef, BrowserBounds, &'static str)]) -> Option<BrowserViewRef> {
    if active_tab_id == Some(tab_id) { return None; }
    let first_slot = if reversed { "secondary" } else { "primary" };
    layout.iter().find(|(_, _, slot)| *slot == first_slot).or_else(|| layout.first())
        .map(|(view, _, _)| view.clone())
}

#[tauri::command]
async fn configure_browser_views(app: AppHandle, primary: BrowserBounds, secondary: Option<BrowserBounds>,
    right_url: String, primary_url: String, tab_id: String, reversed: Option<bool>,
    primary_view: Option<BrowserViewRef>, secondary_view: Option<BrowserViewRef>,
    primary_muted: Option<bool>, secondary_muted: Option<bool>, focus_address: Option<bool>) -> Result<(), String> {
    let _layout = LAYOUT_LOCK.lock().unwrap();
    let layout = browser_layout(&tab_id, primary, secondary, reversed.unwrap_or(false), primary_view, secondary_view)?;
    let layout = fullscreen::resolve_layout(&app, layout)?;
    let keys = layout.iter().map(|(view, _, _)| view.key()).collect::<Result<HashSet<_>, _>>()?;
    let labels = keys.iter().map(|(owner, pane)| browser_label(owner, pane)).collect::<Result<HashSet<_>, _>>()?;
    let (states, focus_target) = {
        let registry = registry().lock().unwrap();
        if keys.iter().any(|key| registry.closed_views.contains(key)) { return Ok(()); }
        let focus_target = layout_focus_target(registry.active_tab_id.as_deref(), &tab_id, reversed.unwrap_or(false), &layout);
        (registry.states.iter().map(|(key, value)| (key.clone(), value.clone())).collect::<Vec<_>>(), focus_target)
    };
    for ((owner, pane), state) in states {
        let mut state = state.lock().unwrap();
        let visible = keys.contains(&(owner, pane));
        if state.visible && !visible { state.generation += 1; }
        state.visible = visible;
    }
    for (label, webview) in app.webviews() {
        if (label.starts_with("browser-viewport-") || label.starts_with("browser-split-"))
            && !labels.contains(&label) {
            let _ = webview.hide();
        }
    }
    for (view, bounds, slot) in layout {
        let (owner, pane) = view.key()?;
        let url = if slot == "primary" { &primary_url } else { &right_url };
        let label = browser_label(&owner, pane)?;
        browser_state(&owner, pane).lock().unwrap().visible = true;
        let webview = if let Some(webview) = app.get_webview(&label) {
            bounds.apply(&webview)?;
            webview.show().map_err(|error| error.to_string())?;
            webview
        } else {
            let requested = Url::parse(url).map_err(|error| error.to_string())?;
            let initial_url = begin_navigation(&app, &owner, pane, &requested);
            let focused = !focus_address.unwrap_or(false)
                && slot == if reversed.unwrap_or(false) { "secondary" } else { "primary" };
            create_browser_view(&app, &owner, pane, bounds, initial_url, focused)?
        };
        tab_audio::apply_muted(&webview, if slot == "primary" { primary_muted } else { secondary_muted }.unwrap_or(false))?;
    }
    // show() does not give a reused WebView2 keyboard focus. Closing its former
    // owner otherwise leaves accelerators stranded until the user clicks a page.
    // Apply focus after the complete layout is ready, outside accelerator callbacks.
    if focus_address.unwrap_or(false) {
        // The address field is already focused in React. Keep keyboard input in
        // the main webview after creating the child page, including from Ctrl+T.
        app.get_webview("main").ok_or("Main webview is not ready")?
            .set_focus().map_err(|error| error.to_string())?;
    } else if let Some(view) = focus_target {
        let (owner, pane) = view.key()?;
        app.get_webview(&browser_label(&owner, pane)?).ok_or("Browser pane is not ready")?
            .set_focus().map_err(|error| error.to_string())?;
    }
    registry().lock().unwrap().active_tab_id = Some(tab_id);
    Ok(())
}

fn ordered_pane_bounds(left: BrowserBounds, right: Option<BrowserBounds>, reversed: bool)
    -> (Option<BrowserBounds>, Option<BrowserBounds>) {
    if reversed { (right, Some(left)) } else { (Some(left), right) }
}

// Resizing an existing layout only moves its views, preserving page state and focus.
#[tauri::command]
async fn resize_browser_views(app: AppHandle, primary: BrowserBounds, secondary: Option<BrowserBounds>,
    tab_id: String, reversed: Option<bool>, primary_view: Option<BrowserViewRef>,
    secondary_view: Option<BrowserViewRef>) -> Result<(), String> {
    let _layout = LAYOUT_LOCK.lock().unwrap();
    let layout = browser_layout(&tab_id, primary, secondary, reversed.unwrap_or(false), primary_view, secondary_view)?;
    let layout = fullscreen::resolve_layout(&app, layout)?;
    for (view, bounds, _) in layout {
        let (owner, pane) = view.key()?;
        if registry().lock().unwrap().closed_views.contains(&(owner.clone(), pane)) { return Ok(()); }
        let webview = app.get_webview(&browser_label(&owner, pane)?)
            .ok_or_else(|| "Browser pane is not ready".to_string())?;
        bounds.apply(&webview)?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct SplitDragPointer { x: f64, pressed: bool }

fn client_pointer_x(cursor_x: f64, window_x: i32, scale: f64) -> f64 {
    (cursor_x - f64::from(window_x)) / scale
}

// Child WebView2 windows can take mouse capture away from the UI webview.
// Read the pointer only while a divider drag is active so it survives crossing a page.
#[tauri::command]
fn get_split_drag_pointer(window: tauri::Window) -> Result<SplitDragPointer, String> {
    #[cfg(windows)]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
        let cursor = window.cursor_position().map_err(|error| error.to_string())?;
        let origin = window.inner_position().map_err(|error| error.to_string())?;
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let pressed = unsafe { GetAsyncKeyState(0x01) < 0 && GetAsyncKeyState(0x1B) >= 0 };
        Ok(SplitDragPointer { x: client_pointer_x(cursor.x, origin.x, scale), pressed })
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Err("Native split drag tracking is only available on Windows".to_string())
    }
}

#[tauri::command]
async fn close_browser_views(app: AppHandle, views: Vec<BrowserViewRef>) -> Result<(), String> {
    let _layout = LAYOUT_LOCK.lock().unwrap();
    let keys = views.iter().map(BrowserViewRef::key).collect::<Result<Vec<_>, _>>()?;
    fullscreen::closing_views(&app, &keys)?;
    {
        let mut registry = registry().lock().unwrap();
        retire_browser_views(&mut registry, &keys);
    }
    for (owner, pane) in keys {
        if let Some(webview) = app.get_webview(&browser_label(&owner, pane)?) {
            webview.close().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn retire_browser_views(registry: &mut BrowserRegistry, keys: &[(String, &'static str)]) {
    for key in keys {
        registry.closed_views.insert(key.clone());
        if let Some(state) = registry.states.remove(key) {
            let mut state = state.lock().unwrap();
            state.visible = false;
            state.generation += 1;
        }
    }
}

fn initial_browser_url(url: &Url) -> Url {
    // Install native request filters before the first real navigation. This also
    // permits our generated data URLs, which Tauri rejects at view creation.
    let _ = url;
    Url::parse("about:blank").unwrap()
}

fn create_browser_view(app: &AppHandle, tab_id: &str, pane: &'static str, bounds: BrowserBounds,
    initial_url: Url, focused: bool) -> Result<tauri::Webview, String> {
    let label = browser_label(tab_id, pane)?;
    let retry_label = label.clone();
    let nav_tab = tab_id.to_string();
    let load_tab = tab_id.to_string();
    let title_tab = tab_id.to_string();
    let nav_state = browser_state(tab_id, pane);
    let load_state = nav_state.clone();
    let title_state = nav_state.clone();
    let app_nav = app.clone();
    let app_load = app.clone();
    let app_title = app.clone();
    let image_token = image_download::token();
    let video_token = image_download::token();
    let adblock_token = image_download::token();
    let builder = WebviewBuilder::new(label, WebviewUrl::External(initial_browser_url(&initial_url)))
        .focused(focused)
        .initialization_script_for_all_frames(adblock::script(&adblock_token))
        .initialization_script_for_all_frames(image_download::script(&image_token))
        .initialization_script_for_all_frames(video_download::script(&video_token))
        .on_navigation(move |url| {
            if url.as_str() == "about:blank" { return true; }
            if url.as_str() == "https://auraview.invalid/retry-local-server" {
                retry_local_server(app_nav.clone(), nav_tab.clone(), pane, retry_label.clone(), nav_state.clone());
                return false;
            }
            {
                let mut state = nav_state.lock().unwrap();
                state.generation += 1;
                state.offline_retry_target = retry_target(url, &state.last_requested_url);
                if !url.as_str().starts_with("data:text/html")
                    && !url.as_str().starts_with("chrome-error://")
                    && !url.as_str().starts_with("edge://chromewebdata") {
                    state.last_requested_url = url.to_string();
                }
            }
            let _ = app_nav.emit("webview-status", navigation_status(&nav_tab, pane, url.as_str(), true));
            true
        })
        // Use the browser's normal white canvas for pages without a background.
        // Website styles must control their own light/dark appearance.
        .background_color(tauri::webview::Color(255, 255, 255, 255))
                .initialization_script(r#"
                    const hideEdgeError = () => {
                        const t = (document.title || '').toLowerCase();
                        const isEdgeTitle = t === "can't reach this page"
                            || t === "cannot reach this page"
                            || t.startsWith("hmmm… can't reach this page")
                            || t.startsWith("hmmm... can't reach this page")
                            || t === "hmmm… can’t reach this page";
                        const isEdgeBody = document.body && document.body.innerText
                            && document.body.innerText.includes("Microsoft Edge")
                            && document.body.innerText.includes("ERR_");
                        if (!document.title.includes("AuraView") && (isEdgeTitle || isEdgeBody)) {
                            document.documentElement.style.display = 'none';
                        }
                    };
                    window.addEventListener('DOMContentLoaded', hideEdgeError);
                    setInterval(hideEdgeError, 250);
                "#)

        .on_page_load(move |webview, payload| {
            let url = payload.url().as_str();
            if url == "about:blank" { return; }
            let loading = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
            let _ = app_load.emit("webview-status", navigation_status(&load_tab, pane, url, loading));
            if !loading {
                browser_settings::prune(&app_load);
                emit_history_status(app_load.clone(), &webview, &load_tab, pane);
                if url.starts_with("chrome-error://") || url.starts_with("edge://chromewebdata") {
                    let failed = load_state.lock().unwrap().last_requested_url.clone();
                    let _ = webview.navigate(make_custom_error_url(&failed, "ERR_CONNECTION_FAILED"));
                }
            }
        })
        .on_document_title_changed(move |webview, title| {
            if title == "about:blank" { return; }
            let lower = title.to_lowercase();
            let is_error = lower == "can't reach this page" || lower == "cannot reach this page"
                || lower.starts_with("hmmm… can't reach this page") || lower.starts_with("hmmm... can't reach this page")
                || lower == "hmmm… can’t reach this page" || lower.contains("err_name_not_resolved")
                || lower.contains("err_connection_refused") || lower.contains("err_internet_disconnected");
            if !lower.contains("auraview") && is_error {
                let failed = title_state.lock().unwrap().last_requested_url.clone();
                let _ = webview.navigate(make_custom_error_url(&failed, "ERR_CONNECTION_FAILED"));
            } else if !title.is_empty() && !title.contains("AuraView") {
                let _ = app_title.emit("webview-status", WebviewStatusPayload {
                    tab_id: title_tab.clone(), pane, title: Some(title), ..Default::default()
                });
            }
        });
    let window = app.get_window("main").ok_or("Main window is not ready")?;
    let child = window.add_child(builder, LogicalPosition::new(bounds.x, bounds.y),
        LogicalSize::new(bounds.width, bounds.height)).map_err(|error| error.to_string())?;
    adblock::install(&child, adblock_token)?;
    image_download::install(app, &child, image_token).map_err(|error| error.to_string())?;
    video_download::install(app, &child, video_token).map_err(|error| error.to_string())?;
    browser_download::install(app, &child).map_err(|error| error.to_string())?;
    page_context_menu::install(app, &child, BrowserViewRef { tab_id: tab_id.into(), pane: pane.into() })
        .map_err(|error| error.to_string())?;
    favicon::install(app, &child, tab_id, pane).map_err(|error| error.to_string())?;
    install_location_events(app, &child, tab_id, pane).map_err(|error| error.to_string())?;
    fullscreen::install(app, &child, BrowserViewRef { tab_id: tab_id.to_string(), pane: pane.to_string() })
        .map_err(|error| error.to_string())?;
    shortcuts::install(app, &child, Some(BrowserViewRef { tab_id: tab_id.to_string(), pane: pane.to_string() }))
        .map_err(|error| error.to_string())?;
    let _ = child.with_webview(|platform| {
        #[cfg(windows)]
        unsafe {
            use webview2_com_sys::Microsoft::Web::WebView2::Win32::*;
            use windows_core::Interface;
            if let Ok(controller) = platform.controller().cast::<ICoreWebView2Controller2>() {
                let _ = controller.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR { A: 255, R: 255, G: 255, B: 255 });
            }
            if let Ok(core) = platform.controller().CoreWebView2() {
                if let Ok(settings) = core.Settings() { let _ = settings.SetIsBuiltInErrorPageEnabled(false); }
            }
        }
    });
    browser_settings::prune(app);
    if initial_url.as_str() != "about:blank" {
        let view = child.clone();
        let state = browser_state(tab_id, pane);
        let generation = state.lock().unwrap().generation;
        tauri::async_runtime::spawn(async move {
            adblock_sites::prepare_navigation(&view, initial_url.as_str()).await;
            if state.lock().unwrap().generation == generation {
                let _ = view.navigate(initial_url);
            }
        });
    }
    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event { browser_settings::close_requested(window.app_handle(), api); }
                if matches!(event, tauri::WindowEvent::Focused(false) | tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)) {
                    downloads_preview::hide(window.app_handle());
                }
                if matches!(event, tauri::WindowEvent::Focused(true)) {
                    let _ = bookmark_folder::main_focused(window);
                    browser_settings::main_focused(window);
                    tab_overflow::main_focused(window);
                } else if matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)) {
                    let _ = bookmark_folder::close(window.app_handle());
                    browser_settings::dismiss(window.app_handle());
                    tab_overflow::dismiss(window.app_handle(), false);
                }
            }
        })
        .on_menu_event(|app, event| {
            tab_context_menu::selected(app, event.id().as_ref());
            bookmark_menu::selected(app, event.id().as_ref());
            ai_dock::selected(app, event.id().as_ref());
        })
        .setup(|app| {
            fullscreen::initialize(app.handle())?;
            browser_settings::initialize(app.handle()).map_err(std::io::Error::other)?;
            adblock::initialize(app.handle()).map_err(std::io::Error::other)?;
            if let Some(main) = app.get_webview("main") { browser_settings::attach(&main).map_err(std::io::Error::other)?; }
            if let Some(main) = app.get_webview("main") { shortcuts::install(app.handle(), &main, None)?; }
            create_browser_view(app.handle(), "tab-1", "primary",
                BrowserBounds { x: 0.0, y: 80.0, width: 1280.0, height: 760.0 },
                Url::parse("https://www.google.com").unwrap(), true)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_port_active, log_client_event, app_minimize, app_toggle_maximize,
            app_is_maximized, app_close, app_start_dragging, app_open_devtools,
            navigate_browser_view, reload_browser_view, go_back_browser_view,
            go_forward_browser_view, configure_browser_views, resize_browser_views,
            get_split_drag_pointer, close_browser_views, shortcuts::browser_page_action, tab_overflow::show_tab_overflow,
            tab_overflow::get_tab_overflow, tab_overflow::update_tab_overflow, tab_overflow::tab_overflow_ready,
            tab_overflow::close_tab_overflow, tab_overflow::select_overflow_tab,
            tab_overflow::close_overflow_tab,
            tab_context_menu::show_tab_context_menu, bookmark_menu::show_bookmark_menu,
            tab_audio::set_browser_muted,
            video_download::list_video_downloads, video_download::cancel_video_download, video_download::retry_video_download,
            downloads::list_downloads, downloads::cancel_download, downloads::retry_download,
            downloads::reveal_download, downloads::delete_download, downloads::redownload_download,
            downloads_preview::set_downloads_preview, downloads_preview::downloads_preview_ready,
            bookmark_editor::show_bookmark_editor, bookmark_editor::get_bookmark_editor, bookmark_editor::close_bookmark_editor,
            bookmark_folder::show_bookmark_folder, bookmark_folder::get_bookmark_folder, bookmark_folder::close_bookmark_folder,
            bookmark_transfer::import_bookmarks_html, bookmark_transfer::export_bookmarks_html,
            ai_dock::show_ai_dock_menu, ai_dock::show_ai_dock_editor, ai_dock::get_ai_dock_editor, ai_dock::close_ai_dock_editor,
            browser_settings::toggle_browser_settings, browser_settings::close_browser_settings,
            browser_settings::get_browser_settings, browser_settings::set_keep_history, browser_settings::clear_browser_data,
            browser_settings::set_adblock_enabled,
            browser_settings::open_browser_history, browser_settings::list_browser_history, browser_settings::open_history_url,
            browser_settings::browser_settings_ready
        ])
        .run(tauri::generate_context!())
        .expect("error while running AuraView application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_document_url_changes_update_the_address_and_reload_target_without_loading() {
        let mut state = BrowserState::new(true);
        state.last_requested_url = "https://www.youtube.com/".to_string();
        for (url, back, forward) in [
            ("https://www.youtube.com/watch?v=first", true, false),
            ("https://www.youtube.com/watch?v=second&list=mix", true, false),
            ("https://www.youtube.com/watch?v=second&list=mix&t=30s", true, false),
            ("https://www.youtube.com/watch?v=first", true, true),
            ("https://www.youtube.com/", false, true),
        ] {
            let previous_generation = state.generation;
            let status = location_status(&mut state, "youtube", "secondary", url, Some(back), Some(forward));
            assert_eq!(status.url.as_deref(), Some(url));
            assert_eq!(status.is_loading, None);
            assert_eq!(status.can_go_back, Some(back));
            assert_eq!(status.can_go_forward, Some(forward));
            assert_eq!(state.last_requested_url, url);
            assert_eq!(state.generation, previous_generation + 1);
            let json = serde_json::to_value(status).unwrap();
            assert_eq!(json["tabId"], "youtube");
            assert_eq!(json["pane"], "secondary");
            assert_eq!(json["url"], url);
        }
        let generation = state.generation;
        let url = state.last_requested_url.clone();
        location_status(&mut state, "youtube", "secondary", &url, Some(false), Some(true));
        assert_eq!(state.generation, generation);
    }

    #[test]
    fn native_location_events_keep_internal_error_urls_and_blank_startup_out_of_the_address() {
        let mut state = BrowserState::new(true);
        let requested = "http://localhost:8188/workflow";
        state.last_requested_url = requested.to_string();
        state.offline_retry_target = Some(Url::parse(requested).unwrap());
        for url in ["about:blank", "", "data:text/html;base64,error", "chrome-error://chromewebdata/", "edge://chromewebdata/"] {
            let status = location_status(&mut state, "local", "primary", url, None, None);
            assert_eq!(status.url, None);
            assert_eq!(status.is_loading, None);
            assert_eq!(state.last_requested_url, requested);
            assert!(state.offline_retry_target.is_some());
            assert_eq!(state.generation, 0);
        }
        location_status(&mut state, "local", "primary", "https://example.com/", Some(true), Some(false));
        assert!(state.offline_retry_target.is_none());
    }

    #[test]
    fn detached_pages_keep_native_identities_when_shown_alone_or_in_a_new_split() {
        let left = BrowserBounds { x: 0.0, y: 120.0, width: 400.0, height: 600.0 };
        let right = BrowserBounds { x: 408.0, width: 600.0, ..left };
        let detached = || BrowserViewRef { tab_id: "original".to_string(), pane: "secondary".to_string() };
        let single = browser_layout("detached", left, None, false, Some(detached()), None).unwrap();
        assert_eq!(single.len(), 1);
        assert_eq!(single[0].0.key().unwrap(), ("original".to_string(), "secondary"));
        assert_eq!(single[0].1.x, 0.0);
        assert_eq!(single[0].2, "primary");
        let new_page = || BrowserViewRef { tab_id: "fresh".to_string(), pane: "primary".to_string() };
        let split = browser_layout("detached", left, Some(right), true, Some(detached()), Some(new_page())).unwrap();
        assert_eq!(split[0].0.key().unwrap(), single[0].0.key().unwrap());
        assert_eq!(split[0].1.x, 408.0);
        assert_eq!(split[1].0.key().unwrap(), ("fresh".to_string(), "primary"));
        assert_eq!(split[1].1.x, 0.0);
        assert!(browser_layout("detached", left, Some(right), false, Some(detached()), Some(detached())).is_err());
    }

    #[test]
    fn closing_one_detached_page_keeps_its_former_partner_alive() {
        let mut registry = BrowserRegistry::default();
        let first_key = ("pair".to_string(), "primary");
        let second_key = ("pair".to_string(), "secondary");
        let first = Arc::new(Mutex::new(BrowserState::new(true)));
        let second = Arc::new(Mutex::new(BrowserState::new(true)));
        registry.states.insert(first_key.clone(), first.clone());
        registry.states.insert(second_key.clone(), second.clone());
        retire_browser_views(&mut registry, &[first_key.clone()]);
        assert!(registry.closed_views.contains(&first_key));
        assert!(!registry.closed_views.contains(&second_key));
        assert!(!registry.states.contains_key(&first_key));
        assert!(Arc::ptr_eq(registry.states.get(&second_key).unwrap(), &second));
        assert!(!first.lock().unwrap().visible);
        assert_eq!(first.lock().unwrap().generation, 1);
        assert!(second.lock().unwrap().visible);
    }

    #[test]
    fn successive_tab_closes_focus_each_reused_replacement_view() {
        let bounds = BrowserBounds { x: 0.0, y: 80.0, width: 1280.0, height: 760.0 };
        let mut registry = BrowserRegistry::default();
        let ids = ["first", "second", "third", "fourth"];
        for id in ids {
            registry.states.insert((id.to_string(), "primary"), Arc::new(Mutex::new(BrowserState::new(id == "fourth"))));
        }
        registry.active_tab_id = Some("fourth".into());
        for (closed, replacement) in [("fourth", "third"), ("third", "second"), ("second", "first")] {
            retire_browser_views(&mut registry, &[(closed.to_string(), "primary")]);
            let layout = browser_layout(replacement, bounds, None, false, None, None).unwrap();
            assert!(registry.states.contains_key(&(replacement.to_string(), "primary")), "replacement already exists");
            let target = layout_focus_target(registry.active_tab_id.as_deref(), replacement, false, &layout).unwrap();
            assert_eq!(target.key().unwrap(), (replacement.to_string(), "primary"));
            registry.active_tab_id = Some(replacement.into());
            assert!(layout_focus_target(registry.active_tab_id.as_deref(), replacement, false, &layout).is_none(),
                "reconfiguring the selected page must preserve input focus");
        }
    }

    #[test]
    fn tab_switch_focus_uses_the_first_visual_page_and_preserves_native_identities() {
        let left = BrowserBounds { x: 0.0, y: 120.0, width: 400.0, height: 600.0 };
        let right = BrowserBounds { x: 408.0, width: 600.0, ..left };
        let primary = BrowserViewRef { tab_id: "original-left".into(), pane: "primary".into() };
        let secondary = BrowserViewRef { tab_id: "original-right".into(), pane: "secondary".into() };
        for reversed in [false, true] {
            let layout = browser_layout("pair", left, Some(right), reversed, Some(primary.clone()), Some(secondary.clone())).unwrap();
            let target = layout_focus_target(Some("other"), "pair", reversed, &layout).unwrap();
            assert_eq!(target.key().unwrap(), if reversed { secondary.key().unwrap() } else { primary.key().unwrap() });
            assert!(layout_focus_target(Some("pair"), "pair", reversed, &layout).is_none(),
                "swapping or resizing split panes must not steal focus");
        }
        let fullscreen = vec![(secondary.clone(), left, "primary")];
        assert_eq!(layout_focus_target(Some("other"), "pair", true, &fullscreen).unwrap().key().unwrap(), secondary.key().unwrap());
    }

    #[test]
    fn drag_coordinates_use_client_origin_and_display_scale() {
        assert_eq!(client_pointer_x(1300.0, 100, 1.5), 800.0);
        assert_eq!(client_pointer_x(-400.0, -1600, 2.0), 600.0);
    }

    #[test]
    fn swapping_moves_existing_panes_and_keeps_the_first_visible_when_split_closes() {
        let left = BrowserBounds { x: 0.0, y: 120.0, width: 640.0, height: 600.0 };
        let right = BrowserBounds { x: 640.0, ..left };
        let (primary, secondary) = ordered_pane_bounds(left, Some(right), true);
        assert_eq!(primary.unwrap().x, 640.0);
        assert_eq!(secondary.unwrap().x, 0.0);
        let (primary, secondary) = ordered_pane_bounds(left, Some(right), false);
        assert_eq!(primary.unwrap().x, 0.0);
        assert_eq!(secondary.unwrap().x, 640.0);
        let (primary, secondary) = ordered_pane_bounds(left, None, true);
        assert!(primary.is_none());
        assert_eq!(secondary.unwrap().x, 0.0);
    }

    #[test]
    fn offline_right_panes_start_with_a_supported_url_before_showing_the_error_page() {
        let offline = make_custom_error_url("http://localhost:7860", "ERR_CONNECTION_REFUSED");
        assert_eq!(initial_browser_url(&offline).as_str(), "about:blank");
        let online = Url::parse("http://localhost:8188/").unwrap();
        assert_eq!(initial_browser_url(&online).as_str(), "about:blank");
    }

    #[test]
    fn pane_routing_uses_distinct_webviews_and_status_sources() {
        assert_eq!(pane_details(None).unwrap(), ("primary", "browser-viewport"));
        assert_eq!(pane_details(Some("secondary")).unwrap(), ("secondary", "browser-split"));
        assert!(pane_details(Some("main")).is_err());
        let left = navigation_status("tab-1", "primary", "http://localhost:8188", true);
        let right = navigation_status("tab-1", "secondary", "http://localhost:7860", false);
        assert_eq!(left.pane, "primary");
        assert_eq!(right.pane, "secondary");
        assert_eq!(left.is_loading, Some(true));
        assert_eq!(right.is_loading, Some(false));
        assert_eq!(serde_json::to_value(right).unwrap()["pane"], "secondary");
        assert!(!Arc::ptr_eq(&browser_state("tab-1", "primary"), &browser_state("tab-1", "secondary")));
    }

    #[test]
    fn different_tabs_keep_separate_native_views_and_state() {
        assert_ne!(browser_label("first", "primary").unwrap(), browser_label("second", "primary").unwrap());
        assert_ne!(browser_label("first", "primary").unwrap(), browser_label("first", "secondary").unwrap());
        let first = browser_state("ownership-first", "secondary");
        let second = browser_state("ownership-second", "secondary");
        first.lock().unwrap().last_requested_url = "http://localhost:8188".to_string();
        second.lock().unwrap().last_requested_url = "http://localhost:7860".to_string();
        assert_eq!(first.lock().unwrap().last_requested_url, "http://localhost:8188");
        assert_eq!(second.lock().unwrap().last_requested_url, "http://localhost:7860");
        let status = navigation_status("second", "secondary", "https://www.youtube.com", false);
        assert_eq!(serde_json::to_value(status).unwrap()["tabId"], "second");
        for invalid in ["", "../main", "tab:main", "tab/1"] {
            assert!(browser_label(invalid, "primary").is_err());
        }
    }

    #[test]
    fn pane_bounds_require_positive_finite_dimensions() {
        let valid = BrowserBounds { x: 640.0, y: 120.0, width: 640.0, height: 600.0 };
        assert!(valid.validate().is_ok());
        assert!(BrowserBounds { width: 0.0, ..valid }.validate().is_err());
        assert!(BrowserBounds { height: -1.0, ..valid }.validate().is_err());
        assert!(BrowserBounds { x: f64::NAN, ..valid }.validate().is_err());
        assert!(BrowserBounds { height: f64::INFINITY, ..valid }.validate().is_err());
    }

    #[test]
    fn offline_page_stops_loading_even_without_a_finished_event() {
        let offline_url = make_custom_error_url("http://localhost:8188", "ERR_CONNECTION_REFUSED");
        let status = navigation_status("tab-1", "primary", offline_url.as_str(), true);
        assert_eq!(status.is_loading, Some(false));
        // Preserve the requested localhost address in the URL bar.
        assert_eq!(status.url, None);
    }

    #[test]
    fn website_navigation_still_reports_start_and_finish() {
        let url = "http://localhost:8188";
        let started = navigation_status("tab-1", "primary", url, true);
        let finished = navigation_status("tab-1", "primary", url, false);
        assert_eq!(started.is_loading, Some(true));
        assert_eq!(started.url.as_deref(), Some(url));
        assert_eq!(finished.is_loading, Some(false));
        assert_eq!(finished.url.as_deref(), Some(url));
    }

    #[test]
    fn retries_preserve_the_requested_localhost_url() {
        let requested = "http://localhost:8188/workflow?name=test";
        let offline = make_custom_error_url(requested, "ERR_CONNECTION_REFUSED");
        assert_eq!(retry_target(&offline, requested).unwrap().as_str(), requested);
        assert!(retry_target(&Url::parse(requested).unwrap(), requested).is_none());
        assert!(retry_target(&offline, "https://example.com").is_none());
        assert!(retry_target(&offline, "http://192.168.1.1:8188").is_none());
    }

    #[test]
    fn probes_support_localhost_ipv4_and_ipv6_only() {
        let localhost = local_server_addresses(&Url::parse("http://localhost:8188").unwrap()).unwrap();
        assert_eq!(localhost.len(), 2);
        assert!(localhost.iter().all(|address| address.ip().is_loopback() && address.port() == 8188));
        for url in ["http://127.0.0.1:8188", "http://[::1]:8188"] {
            assert_eq!(local_server_addresses(&Url::parse(url).unwrap()).unwrap().len(), 1);
        }
        for url in ["https://example.com", "http://192.168.1.1", "ftp://localhost"] {
            assert!(local_server_addresses(&Url::parse(url).unwrap()).is_none());
        }
    }

    #[test]
    fn native_probe_detects_a_local_server_starting_and_stopping() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let url = Url::parse(&format!("http://localhost:{}", port)).unwrap();
        assert!(local_server_is_online(&url));
        drop(listener);
        assert!(!local_server_is_online(&url));
    }
}

