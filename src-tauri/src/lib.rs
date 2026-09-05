use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewBuilder, WebviewUrl,
};

static LAST_REQUESTED_URL: Mutex<String> = Mutex::new(String::new());

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
    let search_url = format!("https://duckduckgo.com/?q={}", search_query);

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
      <span id="status-text">Auto-connecting as soon as your server starts...</span>
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
      <a class="btn btn-secondary" href="https://duckduckgo.com">
        Home
      </a>
    </div>

    <div class="footer">
      AuraView Lightweight Browser • Privacy &amp; Performance First
    </div>
  </div>

  <script>
    const targetUrl = "{failed_url}";
    let isChecking = false;

    async function checkServer() {{
      if (isChecking) return;
      isChecking = true;
      try {{
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1200);
        await fetch(targetUrl, {{ mode: 'no-cors', cache: 'no-store', signal: controller.signal }});
        clearTimeout(timer);
        window.location.replace(targetUrl);
      }} catch (e) {{
        // Server still offline
      }} finally {{
        isChecking = false;
      }}
    }}

    function retryNow() {{
      const st = document.getElementById('status-text');
      if (st) st.innerText = 'Checking port {port}...';
      checkServer().then(() => {{
        setTimeout(() => {{
          if (st) st.innerText = 'Auto-connecting as soon as your server starts...';
        }}, 1000);
      }});
    }}

    setInterval(checkServer, 2500);
  </script>
</body>
</html>"##,
            port = port,
            error_code = error_code,
            failed_url = failed_url,
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
        Search DuckDuckGo
      </a>
      <a class="btn btn-secondary" href="{failed_url}">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
        </svg>
        Try Again
      </a>
      <a class="btn btn-secondary" href="https://duckduckgo.com">
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
    log_debug("app_close: exiting app");
    app.exit(0);
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

#[tauri::command]
fn navigate_browser_view(app: AppHandle, url: String) -> Result<(), String> {
    log_debug(&format!("navigate_browser_view to: {}", url));
    let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

    if let Ok(mut lock) = LAST_REQUESTED_URL.lock() {
        *lock = url.clone();
    }

    if let Some(webview) = app.get_webview("browser-viewport") {
        let _ = webview.show();
        let _ = webview.set_focus();

        let host = parsed_url.host_str().unwrap_or("").to_string();
        let is_local = host == "localhost"
            || host == "127.0.0.1"
            || host.parse::<std::net::IpAddr>().map(|ip| ip.is_loopback()).unwrap_or(false);

        if is_local {
            let port = parsed_url.port().unwrap_or(if parsed_url.scheme() == "https" { 443 } else { 80 });
            let addr: Result<SocketAddr, _> = format!("127.0.0.1:{}", port).parse();
            let is_open = if let Ok(sa) = addr {
                TcpStream::connect_timeout(&sa, Duration::from_millis(150)).is_ok()
            } else {
                false
            };

            if !is_open {
                log_debug(&format!(
                    "Local server at port {} is offline, displaying custom offline page",
                    port
                ));
                let custom_err = make_custom_error_url(&url, "ERR_CONNECTION_REFUSED");
                webview.navigate(custom_err).map_err(|e| e.to_string())?;
                return Ok(());
            }
            webview.navigate(parsed_url).map_err(|e| e.to_string())?;
        } else if parsed_url.scheme() == "http" || parsed_url.scheme() == "https" {
            let addr1 = format!("{}:443", host);
            let addr2 = format!("{}:80", host);
            let is_resolvable = addr1.to_socket_addrs().is_ok() || addr2.to_socket_addrs().is_ok();

            if !is_resolvable {
                log_debug(&format!(
                    "DNS resolution failed for {}, navigating directly to custom error page",
                    url
                ));
                let custom_err = make_custom_error_url(&url, "ERR_NAME_NOT_RESOLVED");
                webview.navigate(custom_err).map_err(|e| e.to_string())?;
                return Ok(());
            }

            webview.navigate(parsed_url).map_err(|e| e.to_string())?;
        } else {
            webview.navigate(parsed_url).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn update_browser_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview("browser-viewport") {
        let _ = webview.set_position(LogicalPosition::new(x, y));
        let _ = webview.set_size(LogicalSize::new(width, height));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            log_debug("=== SETUP START ===");
            for (label, _) in app.windows() {
                log_debug(&format!("Found window: {}", label));
            }
            for (label, _) in app.webviews() {
                log_debug(&format!("Found webview: {}", label));
            }

            if let Some(window) = app.get_window("main") {
                log_debug("Adding child webview browser-viewport to main window");
                let initial_url = Url::parse("https://duckduckgo.com").unwrap();
                let builder = WebviewBuilder::new(
                    "browser-viewport",
                    WebviewUrl::External(initial_url),
                )
                .on_navigation(|url| {
                    log_debug(&format!("[ON NAVIGATION] target: {}", url));
                    true
                })
                .background_color(tauri::webview::Color(9, 12, 16, 255))
                .initialization_script(r#"
                    const setDark = () => {
                        if (document.documentElement) {
                            document.documentElement.style.backgroundColor = '#090c10';
                        }
                        if (document.body) {
                            document.body.style.backgroundColor = '#090c10';
                        }
                    };
                    setDark();
                    window.addEventListener('DOMContentLoaded', setDark);

                    const hideEdgeError = () => {
                        if (!document.title.includes("AuraView") && (document.title.includes("can't reach this page") || (document.body && document.body.innerText.includes("Microsoft Edge") && document.body.innerText.includes("ERR_")))) {
                            document.documentElement.style.display = 'none';
                        }
                    };
                    window.addEventListener('DOMContentLoaded', hideEdgeError);
                    setInterval(hideEdgeError, 250);
                "#)
                .on_page_load(|webview, payload| {
                    log_debug(&format!("[PAGE LOAD] url: {}, event: {:?}", payload.url(), payload.event()));
                    if payload.event() == tauri::webview::PageLoadEvent::Finished {
                        let url_str = payload.url().as_str();
                        if url_str.starts_with("chrome-error://") || url_str.starts_with("edge://chromewebdata") {
                            let failed_url = LAST_REQUESTED_URL.lock().unwrap().clone();
                            let display_url = if failed_url.is_empty() { "Unknown site".to_string() } else { failed_url };
                            let err_url = make_custom_error_url(&display_url, "ERR_NAME_NOT_RESOLVED");
                            let _ = webview.navigate(err_url);
                        }
                    }
                })
                .on_document_title_changed(|webview, title| {
                    log_debug(&format!("[TITLE CHANGED] title: {}", title));
                    let t_lower = title.to_lowercase();
                    if !t_lower.contains("auraview")
                        && (t_lower.contains("can't reach this page")
                            || t_lower.contains("cannot reach this page")
                            || t_lower.starts_with("hmmm")
                            || t_lower.contains("err_name_not_resolved")
                            || t_lower.contains("err_connection_refused")
                            || t_lower.contains("err_internet_disconnected"))
                    {
                        let failed_url = LAST_REQUESTED_URL.lock().unwrap().clone();
                        let display_url = if failed_url.is_empty() { "Unknown site".to_string() } else { failed_url };
                        let err_url = make_custom_error_url(&display_url, "ERR_CONNECTION_FAILED");
                        let _ = webview.navigate(err_url);
                    }
                });

                if let Ok(child_webview) = window.add_child(
                    builder,
                    LogicalPosition::new(0., 80.),
                    LogicalSize::new(1280., 760.),
                ) {
                    let _ = child_webview.with_webview(|platform_webview| {
                        #[cfg(windows)]
                        unsafe {
                            use webview2_com_sys::Microsoft::Web::WebView2::Win32::*;
                            use windows_core::Interface;
                            if let Ok(controller2) = platform_webview.controller().cast::<ICoreWebView2Controller2>() {
                                let color = COREWEBVIEW2_COLOR { A: 255, R: 9, G: 12, B: 16 };
                                let _ = controller2.SetDefaultBackgroundColor(color);
                            }
                            if let Ok(core) = platform_webview.controller().CoreWebView2() {
                                if let Ok(settings) = core.Settings() {
                                    let _ = settings.SetIsBuiltInErrorPageEnabled(false);
                                }
                            }
                        }
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_port_active,
            log_client_event,
            app_minimize,
            app_toggle_maximize,
            app_is_maximized,
            app_close,
            app_start_dragging,
            app_open_devtools,
            navigate_browser_view,
            update_browser_bounds
        ])
        .run(tauri::generate_context!())
        .expect("error while running AuraView application");
}
