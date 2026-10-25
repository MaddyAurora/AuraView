use tauri::{AppHandle, Emitter, Manager};
use crate::BrowserViewRef;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Action { Google, Bing, Address, CopyPlain }

// Retain WebView2's own commands and submenus so Copy keeps rich formatting,
// highlights use the browser's text-fragment support, and Inspect targets the
// original element, including when the selection is in a frame.
const MENU: [(&str, Option<Action>); 9] = [
    ("Search with Google", Some(Action::Google)),
    ("Search with Bing", Some(Action::Bing)),
    ("Send text to URL", Some(Action::Address)),
    ("Copy", None),
    ("Copy as plain text", Some(Action::CopyPlain)),
    ("Copy link to highlight", None),
    ("Print", None),
    ("More tools", None),
    ("Inspect", None),
];

fn default_label(name: &str, label: &str) -> Option<&'static str> {
    let name = name.to_ascii_lowercase();
    let label = label.replace('&', "").replace('…', "").trim().to_ascii_lowercase();
    match name.as_str() {
        "copy" => Some("Copy"),
        "copylinktohighlight" | "copylinktotext" => Some("Copy link to highlight"),
        "print" => Some("Print"),
        "moretools" | "othertools" => Some("More tools"),
        "inspect" | "inspectelement" => Some("Inspect"),
        _ => match label.as_str() {
            "copy" => Some("Copy"), "copy link to highlight" => Some("Copy link to highlight"),
            "print" => Some("Print"), "more tools" => Some("More tools"),
            "inspect" | "inspect element" => Some("Inspect"), _ => None,
        },
    }
}

fn search_url(action: Action, text: &str) -> Option<String> {
    let base = match action {
        Action::Google => "https://www.google.com/search",
        Action::Bing => "https://www.bing.com/search",
        _ => return None,
    };
    let mut url = tauri::Url::parse(base).ok()?;
    url.query_pairs_mut().append_pair("q", text);
    Some(url.into())
}

#[derive(Clone, serde::Serialize)]
struct AddressSelection { view: BrowserViewRef, text: String }

#[cfg(windows)]
fn copy_plain(app: &AppHandle, text: &str) -> Result<(), String> {
    use windows::Win32::{Foundation::{GlobalFree, HANDLE, HWND},
        System::{DataExchange::{OpenClipboard, CloseClipboard, EmptyClipboard, SetClipboardData},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE}}};
    let window = app.get_window("main").ok_or("Main window is not ready")?;
    let owner = HWND(window.hwnd().map_err(|e| e.to_string())?.0);
    let text: Vec<u16> = text.replace('\0', "").encode_utf16().chain(Some(0)).collect();
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, text.len() * std::mem::size_of::<u16>()).map_err(|e| e.to_string())?;
        let pointer = GlobalLock(memory);
        if pointer.is_null() { let _ = GlobalFree(Some(memory)); return Err("Unable to prepare plain text for copying".into()); }
        std::ptr::copy_nonoverlapping(text.as_ptr(), pointer.cast::<u16>(), text.len());
        let _ = GlobalUnlock(memory);
        if let Err(error) = OpenClipboard(Some(owner)) {
            let _ = GlobalFree(Some(memory)); return Err(error.to_string());
        }
        // Only CF_UNICODETEXT is published: no HTML, rich text or page markup.
        let result = EmptyClipboard().and_then(|_| SetClipboardData(13, Some(HANDLE(memory.0))));
        let _ = CloseClipboard();
        if result.is_err() { let _ = GlobalFree(Some(memory)); }
        result.map(|_| ()).map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
fn selected(app: &AppHandle, view: &BrowserViewRef, action: Action, text: &str) {
    if let Some(url) = search_url(action, text) {
        let _ = app.emit_to("main", "page-selection-open-url", url);
    } else if action == Action::Address {
        let app = app.clone();
        let payload = AddressSelection { view: view.clone(), text: text.into() };
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(main) = handle.get_webview("main") { let _ = main.set_focus(); }
            let _ = handle.emit_to("main", "page-selection-fill-address", payload);
        });
    } else if action == Action::CopyPlain {
        if let Err(error) = copy_plain(app, text) {
            let _ = app.emit_to("main", "page-selection-error", format!("Unable to copy plain text: {error}"));
        }
    }
}

pub fn install(app: &AppHandle, view: &tauri::Webview, identity: BrowserViewRef) -> tauri::Result<()> {
    #[cfg(windows)]
    {
        let app = app.clone();
        view.with_webview(move |platform| unsafe {
            use std::{cell::RefCell, rc::Rc};
            use webview2_com::{ContextMenuRequestedEventHandler, CustomItemSelectedEventHandler};
            use webview2_com_sys::Microsoft::Web::WebView2::Win32::*;
            use windows_core::{Interface, HSTRING, PWSTR};
            let result = (|| -> windows_core::Result<()> {
                let core = platform.controller().CoreWebView2()?;
                let environment = core.cast::<ICoreWebView2_2>()?.Environment()?.cast::<ICoreWebView2Environment9>()?;
                // Reuse the four custom items; their callbacks read the latest
                // native selection, without accumulating handlers or COM cycles.
                let selection = Rc::new(RefCell::new(String::new()));
                let mut custom = std::collections::HashMap::new();
                for (label, action) in MENU {
                    if let Some(action) = action {
                        let item = environment.CreateContextMenuItem(&HSTRING::from(label), None, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND)?;
                        let app = app.clone(); let identity = identity.clone(); let selection = selection.clone();
                        let mut token = 0;
                        item.add_CustomItemSelected(&CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                            selected(&app, &identity, action, &selection.borrow()); Ok(())
                        })), &mut token)?;
                        custom.insert(label, item);
                    }
                }
                let mut token = 0;
                core.cast::<ICoreWebView2_11>()?.add_ContextMenuRequested(
                    &ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                        let Some(args) = args else { return Ok(()); };
                        let target = args.ContextMenuTarget()?;
                        let mut has_selection = windows_core::BOOL::default();
                        target.HasSelection(&mut has_selection)?;
                        if !has_selection.as_bool() { return Ok(()); }
                        let mut text = PWSTR::null(); target.SelectionText(&mut text)?;
                        let text = webview2_com::take_pwstr(text);
                        if text.is_empty() { return Ok(()); }
                        *selection.borrow_mut() = text;
                        let items = args.MenuItems()?;
                        let mut count = 0; items.Count(&mut count)?;
                        let mut defaults = std::collections::HashMap::new();
                        for index in 0..count {
                            let item = items.GetValueAtIndex(index)?;
                            let mut name = PWSTR::null(); item.Name(&mut name)?;
                            let name = webview2_com::take_pwstr(name);
                            let mut label = PWSTR::null(); item.Label(&mut label)?;
                            let label = webview2_com::take_pwstr(label);
                            if let Some(key) = default_label(&name, &label) { defaults.insert(key, item); }
                        }
                        // Construct the complete list before mutating the native
                        // menu so API failures leave its original items usable.
                        let mut ordered = Vec::new();
                        for (label, action) in MENU {
                            if let Some(item) = custom.get(label).or_else(|| defaults.get(label)) {
                                ordered.push(item.clone());
                            } else if action.is_none() {
                                // Some contexts (e.g. editable fields) cannot
                                // create highlight links. Keep their slot disabled.
                                let item = environment.CreateContextMenuItem(&HSTRING::from(label), None, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND)?;
                                item.SetIsEnabled(false)?;
                                ordered.push(item);
                            }
                        }
                        for index in (0..count).rev() { items.RemoveValueAtIndex(index)?; }
                        for (index, item) in ordered.iter().enumerate() { items.InsertValueAtIndex(index as u32, item)?; }
                        Ok(())
                    })), &mut token)
            })();
            if let Err(error) = result { eprintln!("Unable to install selected-text menu: {error}"); }
        })?;
    }
    #[cfg(not(windows))]
    let _ = (app, view, identity);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_menu_keeps_requested_order_and_reuses_native_actions() {
        assert_eq!(MENU.map(|(label, _)| label), ["Search with Google", "Search with Bing", "Send text to URL", "Copy", "Copy as plain text", "Copy link to highlight", "Print", "More tools", "Inspect"]);
        assert_eq!(MENU.iter().filter(|(_, action)| action.is_some()).count(), 4);
        for (name, label, expected) in [("copy", "&Copy", "Copy"), ("copyLinkToHighlight", "", "Copy link to highlight"),
            ("print", "", "Print"), ("other", "More &tools", "More tools"), ("inspectElement", "", "Inspect")] {
            assert_eq!(default_label(name, label), Some(expected));
        }
        assert_eq!(default_label("cut", "Cut"), None);
    }
    #[test]
    fn searches_encode_the_selected_text_as_one_query_parameter() {
        let text = "selected & other? # / 中文\nline";
        for action in [Action::Google, Action::Bing] {
            let url = tauri::Url::parse(&search_url(action, text).unwrap()).unwrap();
            assert_eq!(url.query_pairs().collect::<Vec<_>>(), vec![("q".into(), text.into())]);
            assert!(matches!(url.host_str(), Some("www.google.com" | "www.bing.com")));
        }
        assert!(search_url(Action::Address, text).is_none());
    }
}
