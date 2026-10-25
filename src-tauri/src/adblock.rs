use adblock::{
    lists::{FilterSet, ParseOptions},
    request::Request,
    Engine,
};
use std::{
    io::Read,
    net::IpAddr,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const EASYLIST: &str = include_str!("../resources/adblock/easylist.txt");
const EASYPRIVACY: &str = include_str!("../resources/adblock/easyprivacy.txt");
const MAX_LIST_BYTES: usize = 8 * 1024 * 1024;
const UPDATE_INTERVAL: u64 = 24 * 60 * 60;
static ENABLED: AtomicBool = AtomicBool::new(true);
static UPDATING: AtomicBool = AtomicBool::new(false);
static LAST_ATTEMPT: AtomicU64 = AtomicU64::new(0);
static ENGINE: OnceLock<Mutex<Engine>> = OnceLock::new();
static CACHE: OnceLock<PathBuf> = OnceLock::new();

pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}
pub fn set_enabled(value: bool) {
    ENABLED.store(value, Ordering::Relaxed);
}

fn build_engine(lists: &[&str]) -> Engine {
    let mut filters = FilterSet::new(false);
    for list in lists {
        filters.add_filter_list((*list).to_string(), ParseOptions::default());
    }
    Engine::new_with_filter_set(filters)
}
fn engine() -> &'static Mutex<Engine> {
    ENGINE.get_or_init(|| Mutex::new(build_engine(&[EASYLIST, EASYPRIVACY])))
}

// Local AI tools and private-network pages must keep all their resources working.
pub(crate) fn public_url(value: &str) -> bool {
    let Ok(url) = tauri::Url::parse(value) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_end_matches('.');
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".lan")
    {
        return false;
    }
    match host.trim_matches(['[', ']']).parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            !(ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified())
        }
        Ok(IpAddr::V6(ip)) => {
            !(ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|ip| ip.is_private() || ip.is_loopback() || ip.is_link_local()))
        }
        Err(_) => host.contains('.'),
    }
}
fn should_block(
    engine: &Engine,
    on: bool,
    target: &str,
    source: &str,
    kind: &str,
    method: &str,
) -> bool {
    if !on || kind == "document" || !public_url(target) || !public_url(source) {
        return false;
    }
    Request::new(target, source, kind, method)
        .is_ok_and(|request| engine.check_network_request(&request).should_block())
}

#[derive(serde::Deserialize)]
struct CosmeticRequest {
    kind: String,
    token: String,
    #[serde(default)]
    classes: Vec<String>,
    #[serde(default)]
    ids: Vec<String>,
}
fn cosmetic_reply(
    message: &str,
    secret: &str,
    source: &str,
    top: &str,
) -> Option<serde_json::Value> {
    if message.len() > 65536 {
        return None;
    }
    let request: CosmeticRequest = serde_json::from_str(message).ok()?;
    if request.kind != "auraview-adblock-query"
        || request.token != secret
        || request.classes.len() > 256
        || request.ids.len() > 256
        || request
            .classes
            .iter()
            .chain(&request.ids)
            .any(|s| s.len() > 512)
    {
        return None;
    }
    let active = enabled() && public_url(source) && public_url(top);
    let mut selectors = Vec::new();
    if active {
        let guard = engine().lock().unwrap_or_else(|e| e.into_inner());
        let resources = guard.url_cosmetic_resources(source);
        if !resources.generichide {
            selectors.extend(guard.hidden_class_id_selectors(
                &request.classes,
                &request.ids,
                &resources.exceptions,
            ));
        }
        selectors.extend(resources.hide_selectors);
        selectors.extend(
            crate::adblock_sites::selectors(source)
                .iter()
                .map(|selector| selector.to_string()),
        );
    }
    Some(
        serde_json::json!({"kind":"auraview-adblock-rules", "token":secret, "url":source, "enabled":active, "selectors":selectors}),
    )
}

pub fn script(token: &str) -> String {
    include_str!("adblock.js").replace(
        "__AURAVIEW_ADBLOCK_TOKEN__",
        &serde_json::to_string(token).unwrap(),
    )
}
pub fn notify_views(app: &AppHandle) {
    for (label, view) in app.webviews() {
        if !label.starts_with("browser-viewport-") && !label.starts_with("browser-split-") {
            continue;
        }
        #[cfg(windows)]
        let _ = view.with_webview(|platform| unsafe {
            if let Ok(core) = platform.controller().CoreWebView2() {
                let _ = core.PostWebMessageAsJson(&windows_core::HSTRING::from(
                    r#"{"kind":"auraview-adblock-refresh"}"#,
                ));
            }
        });
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ListCache {
    fetched_at: u64,
    easylist: String,
    easyprivacy: String,
}
fn valid_list(text: &str, title: &str) -> bool {
    text.len() < MAX_LIST_BYTES
        && text.starts_with("[Adblock Plus ")
        && text
            .lines()
            .take(30)
            .any(|line| line == format!("! Title: {title}"))
        && text.lines().count() > 1000
}
fn read_cache(path: &Path) -> Option<ListCache> {
    if std::fs::metadata(path).ok()?.len() > (MAX_LIST_BYTES * 3) as u64 {
        return None;
    }
    let cache: ListCache = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    (valid_list(&cache.easylist, "EasyList") && valid_list(&cache.easyprivacy, "EasyPrivacy"))
        .then_some(cache)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn fetch_list(
    client: &reqwest::blocking::Client,
    name: &str,
    title: &str,
) -> Result<String, String> {
    let response = client
        .get(format!("https://easylist.to/easylist/{name}.txt"))
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    let mut text = String::new();
    response
        .take(MAX_LIST_BYTES as u64 + 1)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if !valid_list(&text, title) {
        return Err("Invalid filter list; keeping existing protection".into());
    }
    Ok(text)
}
fn update(path: &Path) -> Result<(), String> {
    if read_cache(path)
        .is_some_and(|cache| now().saturating_sub(cache.fetched_at) < UPDATE_INTERVAL)
    {
        return Ok(());
    }
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("AuraView filter-list updater")
        .build()
        .map_err(|e| e.to_string())?;
    let cache = ListCache {
        fetched_at: now(),
        easylist: fetch_list(&client, "easylist", "EasyList")?,
        easyprivacy: fetch_list(&client, "easyprivacy", "EasyPrivacy")?,
    };
    let replacement = build_engine(&[&cache.easylist, &cache.easyprivacy]);
    // Publish both validated lists together. A failed download/write never replaces a good cache.
    std::fs::create_dir_all(path.parent().ok_or("Invalid filter cache path")?)
        .map_err(|e| e.to_string())?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(
        &temporary,
        serde_json::to_vec(&cache).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, path).map_err(|e| e.to_string())?;
    *engine().lock().unwrap_or_else(|e| e.into_inner()) = replacement;
    Ok(())
}
pub fn refresh() {
    if !enabled() || UPDATING.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(path) = CACHE.get().cloned() else {
        UPDATING.store(false, Ordering::SeqCst);
        return;
    };
    if now().saturating_sub(LAST_ATTEMPT.load(Ordering::Relaxed)) < UPDATE_INTERVAL {
        UPDATING.store(false, Ordering::SeqCst);
        return;
    }
    LAST_ATTEMPT.store(now(), Ordering::Relaxed);
    std::thread::spawn(move || {
        if let Err(error) = update(&path) {
            eprintln!("Filter update unavailable: {error}");
        }
        UPDATING.store(false, Ordering::SeqCst);
    });
}
pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("adblock-lists.json");
    let initial = read_cache(&path)
        .map(|cache| build_engine(&[&cache.easylist, &cache.easyprivacy]))
        .unwrap_or_else(|| build_engine(&[EASYLIST, EASYPRIVACY]));
    let _ = ENGINE.set(Mutex::new(initial));
    let _ = CACHE.set(path);
    refresh();
    // One check a day, only while protection is enabled. No browsing data is sent.
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(UPDATE_INTERVAL));
        refresh();
    });
    Ok(())
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::{cell::RefCell, rc::Rc};
    use webview2_com_sys::Microsoft::Web::WebView2::Win32::*;
    use windows_core::{Interface, HSTRING, PWSTR};

    fn resource_kind(
        context: COREWEBVIEW2_WEB_RESOURCE_CONTEXT,
        target: &str,
        top: &str,
    ) -> &'static str {
        match context {
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT => {
                if same_document(target, top) {
                    "document"
                } else {
                    "subdocument"
                }
            }
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT => "script",
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET => "stylesheet",
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE => "image",
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT => "font",
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA => "media",
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST
            | COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH => "xmlhttprequest",
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING => "ping",
            _ => "other",
        }
    }
    fn same_document(target: &str, top: &str) -> bool {
        let (Ok(mut target), Ok(mut top)) = (tauri::Url::parse(target), tauri::Url::parse(top))
        else {
            return false;
        };
        target.set_fragment(None);
        top.set_fragment(None);
        target == top
    }
    #[test]
    fn top_level_fragments_never_turn_navigation_into_an_ad_subdocument() {
        assert_eq!(
            resource_kind(
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT,
                "https://example.com/",
                "https://example.com/#part"
            ),
            "document"
        );
        assert_eq!(
            resource_kind(
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT,
                "https://other.example/",
                "https://example.com/"
            ),
            "subdocument"
        );
    }
    unsafe fn reply(
        args: &ICoreWebView2WebMessageReceivedEventArgs,
        secret: &str,
        top: &str,
    ) -> Option<HSTRING> {
        let mut raw = PWSTR::null();
        args.TryGetWebMessageAsString(&mut raw).ok()?;
        let message = webview2_com::take_pwstr(raw);
        let mut raw = PWSTR::null();
        args.Source(&mut raw).ok()?;
        let source = webview2_com::take_pwstr(raw);
        cosmetic_reply(&message, secret, &source, top).map(|data| HSTRING::from(data.to_string()))
    }
    unsafe fn install_frame(
        frame: ICoreWebView2Frame,
        secret: String,
        top: Rc<RefCell<String>>,
    ) -> windows_core::Result<()> {
        let messaging = frame.cast::<ICoreWebView2Frame2>()?;
        let mut token = 0;
        let key = secret.clone();
        let page = top.clone();
        messaging.add_WebMessageReceived(
            &webview2_com::FrameWebMessageReceivedEventHandler::create(Box::new(
                move |sender, args| {
                    if let (Some(sender), Some(args)) = (sender, args) {
                        if let (Some(data), Ok(frame)) = (
                            reply(&args, &key, &page.borrow()),
                            sender.cast::<ICoreWebView2Frame2>(),
                        ) {
                            let _ = frame.PostWebMessageAsJson(&data);
                        }
                    }
                    Ok(())
                },
            )),
            &mut token,
        )?;
        if let Ok(children) = frame.cast::<ICoreWebView2Frame7>() {
            children.add_FrameCreated(
                &webview2_com::FrameChildFrameCreatedEventHandler::create(Box::new(
                    move |_, args| {
                        if let Some(args) = args {
                            install_frame(args.Frame()?, secret.clone(), top.clone())?;
                        }
                        Ok(())
                    },
                )),
                &mut token,
            )?;
        }
        Ok(())
    }
    pub fn install(view: &tauri::Webview, secret: String) -> Result<(), String> {
        let target = view.clone();
        view.with_webview(move |platform| unsafe {
            let result = (|| -> windows_core::Result<()> {
                let core = platform.controller().CoreWebView2()?;
                let environment = core.cast::<ICoreWebView2_2>()?.Environment()?;
                let top = Rc::new(RefCell::new(String::new()));
                crate::adblock_sites::install(&core, target, top.clone())?;
                let navigation = top.clone();
                let mut token = 0;
                core.add_NavigationStarting(
                    &webview2_com::NavigationStartingEventHandler::create(Box::new(
                        move |sender, args| {
                            if let Some(args) = args {
                                let mut raw = PWSTR::null();
                                args.Uri(&mut raw)?;
                                *navigation.borrow_mut() = webview2_com::take_pwstr(raw);
                                // Keep page-driven navigation and departures to ordinary/local
                                // sites in sync too. Native navigation awaits this before loading.
                                if let Some(core) = sender {
                                    let bypass = crate::adblock_sites::bypass_service_worker(&navigation.borrow(), enabled());
                                    let _ = core.CallDevToolsProtocolMethod(
                                        &HSTRING::from("Network.setBypassServiceWorker"),
                                        &HSTRING::from(serde_json::json!({"bypass":bypass}).to_string()),
                                        &webview2_com::CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(()))),
                                    );
                                }
                            }
                            Ok(())
                        },
                    )),
                    &mut token,
                )?;
                let network_top = top.clone();
                core.add_WebResourceRequested(
                    &webview2_com::WebResourceRequestedEventHandler::create(Box::new(
                        move |_, args| {
                            let Some(args) = args else { return Ok(()) };
                            if !enabled() {
                                return Ok(());
                            }
                            let request = args.Request()?;
                            let mut raw = PWSTR::null();
                            request.Uri(&mut raw)?;
                            let target = webview2_com::take_pwstr(raw);
                            let top = network_top.borrow().clone();
                            if !public_url(&top) || !public_url(&target) {
                                return Ok(());
                            }
                            let mut context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
                            args.ResourceContext(&mut context)?;
                            let kind = resource_kind(context, &target, &top);
                            if kind == "document" {
                                return Ok(());
                            }
                            let mut raw = PWSTR::null();
                            let source = if request
                                .Headers()?
                                .GetHeader(&HSTRING::from("Referer"), &mut raw)
                                .is_ok()
                            {
                                let value = webview2_com::take_pwstr(raw);
                                if value.is_empty() {
                                    top
                                } else {
                                    value
                                }
                            } else {
                                top
                            };
                            let mut raw = PWSTR::null();
                            request.Method(&mut raw)?;
                            let method = webview2_com::take_pwstr(raw);
                            let blocked = should_block(
                                &engine().lock().unwrap_or_else(|e| e.into_inner()),
                                enabled(),
                                &target,
                                &source,
                                kind,
                                &method,
                            );
                            if blocked {
                                let response = environment.CreateWebResourceResponse(
                                    None,
                                    403,
                                    &HSTRING::from("Blocked by AuraView"),
                                    &HSTRING::from(
                                        "Content-Length: 0\r\nCache-Control: no-store\r\n",
                                    ),
                                )?;
                                args.SetResponse(&response)?;
                            }
                            Ok(())
                        },
                    )),
                    &mut token,
                )?;
                // The newer API covers cross-origin frames as well as the main document;
                // deeply nested frames can still hit WebView2 issue #5765.
                // Workers are separate from pages and deliberately excluded from this per-view hook.
                if let Ok(modern) = core.cast::<ICoreWebView2_22>() {
                    modern.AddWebResourceRequestedFilterWithRequestSourceKinds(
                        &HSTRING::from("*"),
                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_DOCUMENT,
                    )?;
                } else {
                    core.AddWebResourceRequestedFilter(
                        &HSTRING::from("*"),
                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    )?;
                }
                let key = secret.clone();
                let page = top.clone();
                core.add_WebMessageReceived(
                    &webview2_com::WebMessageReceivedEventHandler::create(Box::new(
                        move |sender, args| {
                            if let (Some(sender), Some(args)) = (sender, args) {
                                if let Some(data) = reply(&args, &key, &page.borrow()) {
                                    let _ = sender.PostWebMessageAsJson(&data);
                                }
                            }
                            Ok(())
                        },
                    )),
                    &mut token,
                )?;
                core.cast::<ICoreWebView2_4>()?.add_FrameCreated(
                    &webview2_com::FrameCreatedEventHandler::create(Box::new(move |_, args| {
                        if let Some(args) = args {
                            install_frame(args.Frame()?, secret.clone(), top.clone())?;
                        }
                        Ok(())
                    })),
                    &mut token,
                )
            })();
            if let Err(error) = result {
                eprintln!("Unable to install ad blocking: {error}");
            }
        })
        .map_err(|e| e.to_string())
    }
}
pub fn install(view: &tauri::Webview, secret: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        native::install(view, secret)
    }
    #[cfg(not(windows))]
    {
        let _ = (view, secret);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn network_rules_honor_types_domains_third_party_and_exceptions() {
        let engine = build_engine(&["||ads.example^$script,third-party\n@@||ads.example/allowed.js$script\n||track.example^$domain=news.example"]);
        let check = |url, source, kind| should_block(&engine, true, url, source, kind, "GET");
        assert!(check(
            "https://ads.example/ad.js",
            "https://news.example/",
            "script"
        ));
        assert!(!check(
            "https://ads.example/ad.js",
            "https://ads.example/",
            "script"
        ));
        assert!(!check(
            "https://ads.example/allowed.js",
            "https://news.example/",
            "script"
        ));
        assert!(!check(
            "https://ads.example/ad.png",
            "https://news.example/",
            "image"
        ));
        assert!(check(
            "https://track.example/x",
            "https://news.example/",
            "xmlhttprequest"
        ));
        assert!(!check(
            "https://track.example/x",
            "https://other.example/",
            "xmlhttprequest"
        ));
        assert!(!check(
            "https://ads.example/",
            "https://news.example/",
            "document"
        ));
        assert!(!should_block(
            &engine,
            false,
            "https://ads.example/ad.js",
            "https://news.example/",
            "script",
            "GET"
        ));
    }
    #[test]
    fn local_ai_and_internal_urls_are_exempt() {
        for url in [
            "http://localhost:8188",
            "http://sub.localhost./",
            "http://127.0.0.1:3000",
            "http://192.168.0.5",
            "http://10.0.0.4",
            "http://172.16.1.5",
            "http://[::1]",
            "http://[fc00::1]",
            "http://[::ffff:127.0.0.1]",
            "http://ai.local",
            "http://workstation",
            "data:text/html,hello",
            "about:blank",
            "file:///test.html",
        ] {
            assert!(!public_url(url), "{url}");
        }
        assert!(public_url("https://localhost.example/"));
        assert!(public_url("https://cloudcatshop.ru./"));
        let engine = build_engine(&["||ads.example^"]);
        assert!(!should_block(
            &engine,
            true,
            "https://ads.example/a",
            "http://localhost:8188",
            "script",
            "GET"
        ));
    }
    #[test]
    fn cosmetics_honor_site_and_generic_exceptions() {
        let engine = build_engine(&["##.advertisement\nnews.example##.sponsor\nnews.example#@#.advertisement\n@@||quiet.example^$generichide"]);
        let site = engine.url_cosmetic_resources("https://news.example/");
        assert!(site.hide_selectors.contains(".sponsor"));
        assert!(engine
            .hidden_class_id_selectors(["advertisement"], Vec::<String>::new(), &site.exceptions)
            .is_empty());
        let other = engine.url_cosmetic_resources("https://other.example/");
        assert!(engine
            .hidden_class_id_selectors(["advertisement"], Vec::<String>::new(), &other.exceptions)
            .contains(&".advertisement".into()));
        assert!(
            engine
                .url_cosmetic_resources("https://quiet.example/")
                .generichide
        );
    }
    #[test]
    fn bundled_lists_block_real_ads_without_blocking_ordinary_assets() {
        assert!(valid_list(EASYLIST, "EasyList"));
        assert!(valid_list(EASYPRIVACY, "EasyPrivacy"));
        let engine = build_engine(&[EASYLIST, EASYPRIVACY]);
        assert!(should_block(
            &engine,
            true,
            "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
            "https://example.com/",
            "script",
            "GET"
        ));
        assert!(should_block(
            &engine,
            true,
            "https://www.google-analytics.com/analytics.js",
            "https://example.com/",
            "script",
            "GET"
        ));
        assert!(!should_block(
            &engine,
            true,
            "https://example.com/app.js",
            "https://example.com/",
            "script",
            "GET"
        ));
    }
    #[test]
    fn cosmetic_bridge_rejects_untrusted_or_unbounded_requests() {
        assert!(cosmetic_reply(
            r#"{"kind":"auraview-adblock-query","token":"bad"}"#,
            "secret",
            "https://example.com/",
            "https://example.com/"
        )
        .is_none());
        let oversized = serde_json::json!({"kind":"auraview-adblock-query", "token":"secret", "classes":vec!["a";257]}).to_string();
        assert!(cosmetic_reply(
            &oversized,
            "secret",
            "https://example.com/",
            "https://example.com/"
        )
        .is_none());
        let request = r#"{"kind":"auraview-adblock-query","token":"secret"}"#;
        let local = cosmetic_reply(
            request,
            "secret",
            "http://localhost:8188/",
            "http://localhost:8188/",
        )
        .unwrap();
        assert_eq!(local["enabled"], false);
        assert_eq!(local["selectors"], serde_json::json!([]));
        let embedded = cosmetic_reply(
            request,
            "secret",
            "https://example.com/",
            "http://localhost:8188/",
        )
        .unwrap();
        assert_eq!(embedded["enabled"], false);
    }
    #[test]
    fn invalid_downloads_never_qualify_as_filter_lists() {
        for text in [
            "",
            "<html>502 bad gateway</html>",
            "[Adblock Plus 2.0]\n! Title: EasyList\n||ads.example^",
        ] {
            assert!(!valid_list(text, "EasyList"));
        }
        assert!(!valid_list(EASYPRIVACY, "EasyList"));
    }
}
