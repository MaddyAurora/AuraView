use std::io::Read;
use tauri::{AppHandle, Window};

const MAX_BYTES: u64 = 10 * 1024 * 1024;

fn read_html(path: &std::path::Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Unable to open bookmarks: {e}"))?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("This bookmarks file is too large (maximum 10 MB).".into());
    }
    decode_html(&bytes)
}

fn decode_html(bytes: &[u8]) -> Result<String, String> {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        if bytes.len() % 2 != 0 { return Err("Invalid UTF-16 bookmarks file.".into()); }
        let little = bytes[0] == 0xff;
        let words: Vec<_> = bytes[2..].chunks_exact(2).map(|pair| {
            if little { u16::from_le_bytes([pair[0], pair[1]]) } else { u16::from_be_bytes([pair[0], pair[1]]) }
        }).collect();
        return String::from_utf16(&words).map_err(|_| "Invalid UTF-16 bookmarks file.".into());
    }
    String::from_utf8(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes).to_vec())
        .map_err(|_| "The bookmarks file must use UTF-8 or UTF-16 text encoding.".into())
}

// A native dialog owns the selected path. Web content cannot supply arbitrary
// filesystem paths to these commands or bypass the user's file selection.
#[tauri::command]
pub async fn import_bookmarks_html(app: AppHandle, webview: tauri::Webview, window: Window) -> Result<Option<String>, String> {
    main_only(&webview, &window)?;
    super::bookmark_folder::close(&app)?;
    let path = pick(&window, false).await?;
    match path {
        Some(path) => tauri::async_runtime::spawn_blocking(move || read_html(&path)).await.map_err(|e| e.to_string())?.map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn export_bookmarks_html(app: AppHandle, webview: tauri::Webview, window: Window, html: String) -> Result<bool, String> {
    main_only(&webview, &window)?;
    if html.len() as u64 > MAX_BYTES || !html.starts_with("<!DOCTYPE NETSCAPE-Bookmark-file-1>") {
        return Err("Invalid bookmarks export.".into());
    }
    super::bookmark_folder::close(&app)?;
    let Some(path) = pick(&window, true).await? else { return Ok(false); };
    tauri::async_runtime::spawn_blocking(move || std::fs::write(path, html).map_err(|e| format!("Unable to export bookmarks: {e}")))
        .await.map_err(|e| e.to_string())??;
    Ok(true)
}

fn main_only(webview: &tauri::Webview, window: &Window) -> Result<(), String> {
    if webview.label() != "main" || window.label() != "main" { return Err("Manage bookmarks from the main window.".into()); }
    Ok(())
}

async fn pick(window: &Window, save: bool) -> Result<Option<std::path::PathBuf>, String> {
    #[cfg(windows)]
    {
        let owner = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
        tauri::async_runtime::spawn_blocking(move || dialog::pick(owner, save)).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, save);
        Err("Bookmark file dialogs require Windows.".into())
    }
}

#[cfg(windows)]
mod dialog {
    use windows::{core::{w, Interface}, Win32::{Foundation::HWND, System::Com::*, UI::Shell::*}};
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) { unsafe { CoUninitialize(); } }
    }
    pub fn pick(owner: usize, save: bool) -> Result<Option<std::path::PathBuf>, String> {
        let result = (|| -> windows::core::Result<Option<std::path::PathBuf>> {
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
                let _apartment = Apartment;
                let dialog: IFileDialog = if save {
                    let save: IFileSaveDialog = CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER)?;
                    save.cast()?
                } else {
                    let open: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
                    open.cast()?
                };
                dialog.SetTitle(if save { w!("Export bookmarks") } else { w!("Import bookmarks from Chrome, Edge, or AuraView") })?;
                dialog.SetFileTypes(&[Common::COMDLG_FILTERSPEC { pszName: w!("Bookmarks HTML (*.html; *.htm)"), pszSpec: w!("*.html;*.htm") }])?;
                dialog.SetOptions(dialog.GetOptions()? | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR
                    | if save { FOS_OVERWRITEPROMPT } else { FOS_FILEMUSTEXIST })?;
                dialog.SetDefaultExtension(w!("html"))?;
                if save { dialog.SetFileName(w!("AuraView-bookmarks.html"))?; }
                if let Err(error) = dialog.Show(Some(HWND(owner as *mut _))) {
                    if error.code().0 == 0x800704c7_u32 as i32 { return Ok(None); }
                    return Err(error);
                }
                let name = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
                // Keep Unicode Windows paths, including characters outside the BMP.
                let path = {
                    use std::os::windows::ffi::OsStringExt;
                    std::path::PathBuf::from(std::ffi::OsString::from_wide(name.as_wide()))
                };
                CoTaskMemFree(Some(name.0.cast()));
                Ok(Some(path))
            }
        })();
        result.map_err(|e| format!("Unable to open the bookmarks file dialog: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decodes_browser_exports_without_losing_unicode_and_rejects_invalid_text() {
        let html = "<!DOCTYPE NETSCAPE-Bookmark-file-1><H1>日本語 & Café</H1>";
        assert_eq!(decode_html(html.as_bytes()).unwrap(), html);
        assert_eq!(decode_html(&[&[0xef, 0xbb, 0xbf][..], html.as_bytes()].concat()).unwrap(), html);
        for little in [true, false] {
            let mut bytes = if little { vec![0xff, 0xfe] } else { vec![0xfe, 0xff] };
            for word in html.encode_utf16() { bytes.extend(if little { word.to_le_bytes() } else { word.to_be_bytes() }); }
            assert_eq!(decode_html(&bytes).unwrap(), html);
        }
        assert!(decode_html(&[0xff]).is_err());
        assert!(decode_html(&[0xff, 0xfe, 0x00]).is_err());
    }
}
