//! Read Chromium's existing history without ever writing to its database.
//! WinSQLite ships with Windows, so no extra executable or SQLite runtime is bundled.
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Visit {
    pub id: i64,
    pub url: String,
    pub title: String,
    pub visited_at: i64,
}
#[derive(Serialize)]
pub struct Page {
    pub visits: Vec<Visit>,
    pub more: bool,
}

pub fn unix_millis(chromium_micros: i64) -> i64 {
    chromium_micros / 1000 - 11_644_473_600_000
}

#[cfg(windows)]
mod sqlite {
    use super::*;
    use std::{
        ffi::{c_char, c_int, c_void, CStr, CString},
        ptr,
    };
    #[link(name = "winsqlite3")]
    extern "C" {
        fn sqlite3_open_v2(
            name: *const c_char,
            db: *mut *mut c_void,
            flags: c_int,
            vfs: *const c_char,
        ) -> c_int;
        fn sqlite3_close(db: *mut c_void) -> c_int;
        fn sqlite3_prepare_v2(
            db: *mut c_void,
            sql: *const c_char,
            len: c_int,
            statement: *mut *mut c_void,
            tail: *mut *const c_char,
        ) -> c_int;
        fn sqlite3_finalize(statement: *mut c_void) -> c_int;
        fn sqlite3_bind_text(
            statement: *mut c_void,
            column: c_int,
            value: *const c_char,
            len: c_int,
            destructor: Option<unsafe extern "C" fn(*mut c_void)>,
        ) -> c_int;
        fn sqlite3_bind_int64(statement: *mut c_void, column: c_int, value: i64) -> c_int;
        fn sqlite3_step(statement: *mut c_void) -> c_int;
        fn sqlite3_column_int64(statement: *mut c_void, column: c_int) -> i64;
        fn sqlite3_column_text(statement: *mut c_void, column: c_int) -> *const u8;
        #[cfg(test)]
        fn sqlite3_exec(
            db: *mut c_void,
            sql: *const c_char,
            callback: Option<
                unsafe extern "C" fn(
                    *mut c_void,
                    c_int,
                    *mut *mut c_char,
                    *mut *mut c_char,
                ) -> c_int,
            >,
            context: *mut c_void,
            error: *mut *mut c_char,
        ) -> c_int;
    }
    struct Database(*mut c_void);
    impl Drop for Database {
        fn drop(&mut self) {
            unsafe {
                sqlite3_close(self.0);
            }
        }
    }
    struct Statement(*mut c_void);
    impl Drop for Statement {
        fn drop(&mut self) {
            unsafe {
                sqlite3_finalize(self.0);
            }
        }
    }
    unsafe fn column(statement: *mut c_void, index: i32) -> String {
        let value = sqlite3_column_text(statement, index);
        if value.is_null() {
            String::new()
        } else {
            CStr::from_ptr(value.cast()).to_string_lossy().into_owned()
        }
    }
    pub fn read(path: &Path, snapshots: &Path, search: &str, offset: u32) -> Result<Page, String> {
        if !path.exists() {
            return Ok(Page {
                visits: vec![],
                more: false,
            });
        }
        // Copy a snapshot first: never ignore SQLite locks against a live, changing
        // file. Chromium owns the source. A write during copying can invalidate the
        // snapshot; the caller retries rather than altering/recovering the source.
        std::fs::create_dir_all(snapshots).map_err(|_| "Unable to prepare history preview")?;
        let snapshot = snapshots.join(format!("{}.sqlite", crate::image_download::token()));
        struct Snapshot(std::path::PathBuf);
        impl Drop for Snapshot {
            fn drop(&mut self) {
                for suffix in ["", "-journal", "-wal", "-shm"] {
                    let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display()));
                }
            }
        }
        let snapshot = Snapshot(snapshot);
        let sources: Vec<_> = ["", "-journal", "-wal"]
            .iter()
            .map(|suffix| std::path::PathBuf::from(format!("{}{suffix}", path.display())))
            .collect();
        let stamp = |path: &Path| {
            std::fs::metadata(path)
                .ok()
                .map(|m| (m.len(), m.modified().ok()))
        };
        let before: Vec<_> = sources.iter().map(|path| stamp(path)).collect();
        for (index, source) in sources.iter().enumerate() {
            if before[index].is_some() {
                std::fs::copy(
                    source,
                    format!(
                        "{}{}",
                        snapshot.0.display(),
                        ["", "-journal", "-wal"][index]
                    ),
                )
                .map_err(|_| "History is busy. Please refresh in a moment.")?;
            }
        }
        if sources.iter().map(|path| stamp(path)).collect::<Vec<_>>() != before {
            return Err("History changed while reading. Please refresh.".into());
        }
        let mut uri =
            tauri::Url::from_file_path(&snapshot.0).map_err(|_| "Invalid history location")?;
        // Recovery/checkpointing is allowed only in the disposable copy. Copying
        // the journal/WAL preserves committed visits even while Chromium holds
        // its live database exclusively. Never run a SQLite writer on the source.
        uri.set_query(Some("mode=rw"));
        let name = CString::new(uri.as_str()).map_err(|_| "Invalid history location")?;
        let query = CString::new("SELECT v.id, u.url, u.title, v.visit_time FROM visits v JOIN urls u ON u.id=v.url WHERE (u.url LIKE 'http://%' OR u.url LIKE 'https://%' OR u.url LIKE 'file://%') AND (?1='' OR instr(lower(u.url), lower(?1))>0 OR instr(lower(u.title), lower(?1))>0) ORDER BY v.visit_time DESC, v.id DESC LIMIT 201 OFFSET ?2").unwrap();
        let search = CString::new(search).map_err(|_| "Invalid history search")?;
        unsafe {
            let mut raw = ptr::null_mut();
            let code = sqlite3_open_v2(name.as_ptr(), &mut raw, 2 | 0x40, ptr::null()); // READWRITE | URI, snapshot only
            let db = Database(raw);
            if code != 0 {
                return Err("Unable to read browser history. Please refresh.".into());
            }
            let mut raw_statement = ptr::null_mut();
            if sqlite3_prepare_v2(
                db.0,
                query.as_ptr(),
                -1,
                &mut raw_statement,
                ptr::null_mut(),
            ) != 0
            {
                return Err("Browser history is temporarily unavailable. Please refresh.".into());
            }
            let statement = Statement(raw_statement);
            if sqlite3_bind_text(statement.0, 1, search.as_ptr(), -1, None) != 0
                || sqlite3_bind_int64(statement.0, 2, offset.into()) != 0
            {
                return Err("Unable to search history".into());
            }
            let mut visits = Vec::new();
            loop {
                match sqlite3_step(statement.0) {
                    100 => visits.push(Visit {
                        id: sqlite3_column_int64(statement.0, 0),
                        url: column(statement.0, 1),
                        title: column(statement.0, 2),
                        visited_at: unix_millis(sqlite3_column_int64(statement.0, 3)),
                    }),
                    101 => break,
                    _ => return Err("History changed while reading. Please refresh.".into()),
                }
            }
            let more = visits.len() > 200;
            visits.truncate(200);
            Ok(Page { visits, more })
        }
    }

    #[cfg(test)]
    #[test]
    fn reads_committed_wal_visits_in_timestamp_order_with_bound_search_and_pagination() {
        let root = std::env::temp_dir().join(format!(
            "auraview-history-test-{}",
            crate::image_download::token()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("History");
        let snapshots = root.join("snapshots");
        let name = CString::new(path.to_string_lossy().as_bytes()).unwrap();
        unsafe {
            let mut raw = ptr::null_mut();
            assert_eq!(
                sqlite3_open_v2(name.as_ptr(), &mut raw, 2 | 4, ptr::null()),
                0
            );
            let db = Database(raw);
            let sql=CString::new("PRAGMA journal_mode=WAL; PRAGMA locking_mode=EXCLUSIVE; CREATE TABLE urls(id INTEGER PRIMARY KEY,url TEXT,title TEXT); CREATE TABLE visits(id INTEGER PRIMARY KEY,url INTEGER,visit_time INTEGER); INSERT INTO urls VALUES(1,'https://example.com/older','Older visit'),(2,'https://example.com/newer','Newer visit'),(3,'data:text/html,private','Internal document'); WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<205) INSERT INTO visits SELECT n,CASE WHEN n=205 THEN 2 ELSE 1 END,11644473600000000+n*1000 FROM numbers; INSERT INTO visits VALUES(206,3,11644473600999000);").unwrap();
            assert_eq!(
                sqlite3_exec(db.0, sql.as_ptr(), None, ptr::null_mut(), ptr::null_mut()),
                0
            );
            assert!(root.join("History-wal").exists());
            let first = read(&path, &snapshots, "", 0).unwrap();
            assert_eq!(first.visits.len(), 200);
            assert!(first.more);
            assert_eq!(first.visits[0].url, "https://example.com/newer");
            assert_eq!(first.visits[0].visited_at, 205);
            let second = read(&path, &snapshots, "", 200).unwrap();
            assert_eq!(second.visits.len(), 5);
            assert!(!second.more);
            assert_eq!(second.visits.last().unwrap().visited_at, 1);
            let search = read(&path, &snapshots, "NEWER", 0).unwrap();
            assert_eq!(search.visits.len(), 1);
            assert!(read(&path, &snapshots, "' OR 1=1 --", 0)
                .unwrap()
                .visits
                .is_empty());
            assert!(
                std::fs::read_dir(&snapshots).unwrap().next().is_none(),
                "URL snapshots must be removed after reading"
            );
            drop(db);
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}

pub fn clear_snapshots(snapshots: &Path) -> Result<(), String> {
    if !snapshots.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(snapshots).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type().map_err(|e| e.to_string())?.is_file()
            && name.split_once('.').is_some_and(|(id, extension)| {
                id.len() == 32
                    && id.bytes().all(|c| c.is_ascii_hexdigit())
                    && matches!(
                        extension,
                        "sqlite" | "sqlite-journal" | "sqlite-wal" | "sqlite-shm"
                    )
            })
        {
            std::fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn read(path: &Path, snapshots: &Path, search: &str, offset: u32) -> Result<Page, String> {
    #[cfg(windows)]
    {
        let mut result = sqlite::read(path, snapshots, search, offset);
        for _ in 0..2 {
            if result.is_ok() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(80));
            result = sqlite::read(path, snapshots, search, offset);
        }
        result
    }
    #[cfg(not(windows))]
    {
        let _ = (path, snapshots, search, offset);
        Err("History is currently available on Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chromium_times_convert_to_unix_milliseconds() {
        assert_eq!(unix_millis(11_644_473_600_000_000), 0);
        assert_eq!(unix_millis(13_000_000_000_123_456), 1_355_526_400_123);
    }
    #[test]
    fn missing_history_is_an_empty_page() {
        let page = read(
            Path::new("Z:/does-not-exist/auraview-history"),
            &std::env::temp_dir(),
            "",
            0,
        )
        .unwrap();
        assert!(page.visits.is_empty());
        assert!(!page.more);
    }
    #[test]
    fn abandoned_snapshots_are_removed_without_touching_other_files() {
        let root = std::env::temp_dir().join(format!(
            "auraview-history-cleanup-test-{}",
            crate::image_download::token()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let snapshot = root.join("0123456789abcdef0123456789abcdef.sqlite");
        std::fs::write(&snapshot, b"fixture").unwrap();
        let unrelated = root.join("keep.txt");
        std::fs::write(&unrelated, b"keep").unwrap();
        clear_snapshots(&root).unwrap();
        assert!(!snapshot.exists());
        assert!(unrelated.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
