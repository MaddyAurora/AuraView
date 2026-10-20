use std::sync::{Arc, Mutex, atomic::{AtomicU64, Ordering}};
use tauri::{AppHandle, Manager};
use super::{browser_label, registry, BrowserBounds, BrowserViewRef, LAYOUT_LOCK};

type Layout = Vec<(BrowserViewRef, BrowserBounds, &'static str)>;

#[derive(Clone)]
struct ContentFullscreen {
    view: BrowserViewRef,
}

#[derive(Default)]
struct FullscreenState {
    // User-selected F11 mode. Tauri also toggles the native window automatically
    // on video events, so is_fullscreen() cannot distinguish these two modes.
    browser_fullscreen: bool,
    content: Option<ContentFullscreen>,
    normal_layout: Layout,
}

static STATE: Mutex<FullscreenState> = Mutex::new(FullscreenState {
    browser_fullscreen: false, content: None, normal_layout: Vec::new(),
});

impl FullscreenState {
    fn toggle_browser_mode(&mut self) -> bool {
        self.browser_fullscreen = !self.browser_fullscreen;
        self.browser_fullscreen
    }

    fn begin_content(&mut self, view: BrowserViewRef) -> ContentFullscreen {
        let content = ContentFullscreen { view };
        self.content = Some(content.clone());
        content
    }

    fn take_content(&mut self) -> Option<(ContentFullscreen, Layout, bool)> {
        let content = self.content.take()?;
        Some((content, self.normal_layout.clone(), self.browser_fullscreen))
    }

    fn desired_window_fullscreen(&self) -> bool {
        self.content.is_some() || self.browser_fullscreen
    }
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let window = app.get_window("main").ok_or("Main window is not ready")?;
    STATE.lock().unwrap().browser_fullscreen = window.is_fullscreen().map_err(|e| e.to_string())?;
    Ok(())
}

fn same_view(left: &BrowserViewRef, right: &BrowserViewRef) -> bool {
    left.tab_id == right.tab_id && left.pane == right.pane
}

fn viewport(app: &AppHandle) -> Result<BrowserBounds, String> {
    let window = app.get_window("main").ok_or("Main window is not ready")?;
    let size = window.inner_size().map_err(|e| e.to_string())?
        .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
    Ok(BrowserBounds { x: 0.0, y: 0.0, width: size.width, height: size.height })
}

fn content_layout(content: &ContentFullscreen, bounds: BrowserBounds) -> Layout {
    vec![(content.view.clone(), bounds, "primary")]
}

fn apply_layout(app: &AppHandle, layout: &Layout) -> Result<(), String> {
    let keys = layout.iter().map(|(view, _, _)| view.key()).collect::<Result<Vec<_>, _>>()?;
    let labels = layout.iter().map(|(view, _, _)| {
        let (owner, pane) = view.key()?;
        browser_label(&owner, pane)
    }).collect::<Result<Vec<_>, String>>()?;
    {
        let registry = registry().lock().unwrap();
        for (key, state) in &registry.states {
            let mut state = state.lock().unwrap();
            let visible = keys.contains(key);
            if state.visible && !visible { state.generation += 1; }
            state.visible = visible;
        }
    }
    for (label, webview) in app.webviews() {
        if label.starts_with("browser-viewport-") || label.starts_with("browser-split-") {
            if let Some(index) = labels.iter().position(|item| item == &label) {
                layout[index].1.apply(&webview)?;
                webview.show().map_err(|e| e.to_string())?;
            } else { webview.hide().map_err(|e| e.to_string())?; }
        }
    }
    Ok(())
}

// Call with LAYOUT_LOCK held, from a worker rather than a native COM callback.
fn leave(app: &AppHandle, exit_document: bool) -> Result<(), String> {
    let saved = STATE.lock().unwrap().take_content();
    let Some((content, layout, browser_fullscreen)) = saved else { return Ok(()) };
    if exit_document {
        let (owner, pane) = content.view.key()?;
        if let Some(webview) = app.get_webview(&browser_label(&owner, pane)?) {
            let _ = webview.eval("if (document.fullscreenElement) document.exitFullscreen().catch(() => {});");
        }
    }
    let window = app.get_window("main").ok_or("Main window is not ready")?;
    window.set_fullscreen(browser_fullscreen).map_err(|e| e.to_string())?;
    // React's resize observer subsequently refreshes these bounds if the window
    // size changed. The original native views and video playback stay alive.
    apply_layout(app, &layout)
}

fn content_changed(app: &AppHandle, view: BrowserViewRef, active: bool, sequence: &AtomicU64, revision: u64) -> Result<(), String> {
    let _layout = LAYOUT_LOCK.lock().unwrap();
    if sequence.load(Ordering::SeqCst) != revision { return Ok(()); }
    if !active {
        let owns_fullscreen = STATE.lock().unwrap().content.as_ref()
            .is_some_and(|content| same_view(&content.view, &view));
        if owns_fullscreen { return leave(app, false); }
        // Document exit can arrive after F11, closing, or switching tabs already
        // ended our content mode. Tauri queues another native window exit then;
        // reapply the current mode rather than letting that late event win.
        let fullscreen = STATE.lock().unwrap().desired_window_fullscreen();
        let window = app.get_window("main").ok_or("Main window is not ready")?;
        return window.set_fullscreen(fullscreen).map_err(|e| e.to_string());
    }
    let key = view.key()?;
    let visible = registry().lock().unwrap().states.get(&key)
        .is_some_and(|state| state.lock().unwrap().visible);
    if !visible { return Ok(()) }
    if STATE.lock().unwrap().content.as_ref().is_some_and(|content| same_view(&content.view, &view)) {
        return Ok(());
    }
    leave(app, true)?;
    let window = app.get_window("main").ok_or("Main window is not ready")?;
    let content = STATE.lock().unwrap().begin_content(view);
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    apply_layout(app, &content_layout(&content, viewport(app)?))
}

// Every regular layout request is remembered, but cannot shrink an active video
// back under the tab bar. Switching tabs also exits document fullscreen.
pub fn resolve_layout(app: &AppHandle, layout: Layout) -> Result<Layout, String> {
    // A superseded layout for a closed tab must never replace the saved layout.
    {
        let registry = registry().lock().unwrap();
        for (view, _, _) in &layout {
            if registry.closed_views.contains(&view.key()?) { return Ok(layout); }
        }
    }
    let content = {
        let mut state = STATE.lock().unwrap();
        state.normal_layout = layout.clone();
        state.content.clone()
    };
    if let Some(content) = content {
        if layout.iter().any(|(view, _, _)| same_view(view, &content.view)) {
            return Ok(content_layout(&content, viewport(app)?));
        }
        leave(app, true)?;
    }
    Ok(layout)
}

pub fn closing_views(app: &AppHandle, keys: &[(String, &'static str)]) -> Result<(), String> {
    let closing_owner = {
        let mut state = STATE.lock().unwrap();
        state.normal_layout.retain(|(view, _, _)| !keys.iter().any(|(owner, pane)| view.tab_id == *owner && view.pane == *pane));
        state.content.as_ref().is_some_and(|content| keys.iter()
            .any(|(owner, pane)| content.view.tab_id == *owner && content.view.pane == *pane))
    };
    if closing_owner { leave(app, true)?; }
    Ok(())
}

pub fn toggle_browser(app: &AppHandle) -> Result<(), String> {
    let _layout = LAYOUT_LOCK.lock().unwrap();
    let (in_video, browser_fullscreen) = {
        let mut state = STATE.lock().unwrap();
        let browser_fullscreen = state.toggle_browser_mode();
        (state.content.is_some(), browser_fullscreen)
    };
    if in_video { return leave(app, true); }
    let window = app.get_window("main").ok_or("Main window is not ready")?;
    window.set_fullscreen(browser_fullscreen).map_err(|e| e.to_string())
}

pub fn install(app: &AppHandle, webview: &tauri::Webview, view: BrowserViewRef) -> tauri::Result<()> {
    #[cfg(windows)]
    {
        let app = app.clone();
        let sequence = Arc::new(AtomicU64::new(0));
        webview.with_webview(move |platform| unsafe {
            use webview2_com::ContainsFullScreenElementChangedEventHandler;
            if let Ok(core) = platform.controller().CoreWebView2() {
                let handler = ContainsFullScreenElementChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(core) = sender {
                        let mut active = windows_core::BOOL(0);
                        core.ContainsFullScreenElement(&mut active)?;
                        let app = app.clone();
                        let view = view.clone();
                        let revision = sequence.fetch_add(1, Ordering::SeqCst) + 1;
                        let sequence = sequence.clone();
                        // Never wait for LAYOUT_LOCK on the UI thread: layout
                        // commands may already be waiting for that same thread.
                        tauri::async_runtime::spawn_blocking(move || {
                            if let Err(error) = content_changed(&app, view, active.as_bool(), &sequence, revision) {
                                eprintln!("Unable to change video fullscreen: {error}");
                            }
                        });
                    }
                    Ok(())
                }));
                let mut token = 0;
                if let Err(error) = core.add_ContainsFullScreenElementChanged(&handler, &mut token) {
                    eprintln!("Unable to track video fullscreen: {error}");
                }
            }
        })?;
    }
    #[cfg(not(windows))]
    let _ = (app, webview, view);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_from_either_split_pane_covers_the_entire_client_area() {
        // Test the actual fullscreen layout builder with native identities used
        // by both ordinary and detached/re-paired split pages.
        let display = BrowserBounds { x: 0.0, y: 0.0, width: 2560.0 / 1.5, height: 1440.0 / 1.5 };
        for (tab, pane) in [("pair", "primary"), ("pair", "secondary"), ("detached", "primary")] {
            let content = ContentFullscreen {
                view: BrowserViewRef { tab_id: tab.into(), pane: pane.into() },
            };
            let layout = content_layout(&content, display);
            assert_eq!(layout.len(), 1);
            assert!(same_view(&layout[0].0, &content.view));
            assert_eq!(layout[0].1.x, 0.0);
            assert_eq!(layout[0].1.y, 0.0); // No tab/address-bar inset.
            assert_eq!(layout[0].1.width, display.width);
            assert_eq!(layout[0].1.height, display.height);
        }
    }

    #[test]
    fn leaving_video_restores_user_mode_on_every_cycle_and_preserves_split_bounds() {
        for browser_mode in [false, true] {
            let mut state = FullscreenState::default();
            if browser_mode { state.toggle_browser_mode(); }
            let left = BrowserViewRef { tab_id: "pair".into(), pane: "primary".into() };
            let right = BrowserViewRef { tab_id: "pair".into(), pane: "secondary".into() };
            state.normal_layout = vec![
                (left.clone(), BrowserBounds { x: 0.0, y: 120.0, width: 500.0, height: 600.0 }, "primary"),
                (right.clone(), BrowserBounds { x: 508.0, y: 120.0, width: 700.0, height: 600.0 }, "secondary"),
            ];
            for view in [left.clone(), right, left] {
                // Tauri's native window is already fullscreen when our video
                // handler runs. That must not alter the user's independent mode.
                state.begin_content(view.clone());
                assert!(state.desired_window_fullscreen());
                let (ended, layout, restore_fullscreen) = state.take_content().unwrap();
                assert!(same_view(&ended.view, &view));
                assert_eq!(restore_fullscreen, browser_mode);
                assert_eq!(state.desired_window_fullscreen(), browser_mode);
                assert_eq!(layout.len(), 2);
                assert_eq!(layout[0].1.y, 120.0);
                assert_eq!(layout[0].1.width, 500.0);
                assert_eq!(layout[1].1.x, 508.0);
                assert_eq!(layout[1].1.width, 700.0);
            }
        }
    }

    #[test]
    fn f11_during_video_and_late_document_exit_keep_the_latest_user_mode() {
        let mut state = FullscreenState::default();
        let view = BrowserViewRef { tab_id: "video".into(), pane: "primary".into() };
        for expected_browser_mode in [true, false, true] {
            state.begin_content(view.clone());
            state.toggle_browser_mode();
            let (_, _, restore_fullscreen) = state.take_content().unwrap();
            assert_eq!(restore_fullscreen, expected_browser_mode);
            // Native document exit arrives after F11 already ended content mode.
            assert_eq!(state.desired_window_fullscreen(), expected_browser_mode);
        }
        state.toggle_browser_mode();
        state.begin_content(view);
        // A previous page's delayed exit must not shrink the next fullscreen video.
        assert!(state.desired_window_fullscreen());
        state.take_content();
        assert!(!state.desired_window_fullscreen());
    }

    #[test]
    fn fullscreen_identity_follows_the_page_rather_than_the_split_group() {
        let right = BrowserViewRef { tab_id: "pair".into(), pane: "secondary".into() };
        let left = BrowserViewRef { tab_id: "pair".into(), pane: "primary".into() };
        let other = BrowserViewRef { tab_id: "other".into(), pane: "secondary".into() };
        assert!(!same_view(&right, &left));
        assert!(!same_view(&right, &other));
        assert!(same_view(&right, &right.clone()));
    }
}
