//! DuckDB through its C API (`libduckdb`, `tools/fetch-duckdb.py`), loaded at
//! run time from the bundle (`Frameworks`) or the developer vendor folder,
//! the way PDFium is. Only what the database preview reads: a read-only,
//! sandboxed database (`duckdb-adapter.mjs`'s settings) and string results.
use libloading::Library;
use std::{
    ffi::{CStr, CString, c_char, c_void},
    path::{Path, PathBuf},
    sync::OnceLock,
};

type Handle = *mut c_void;
/// `duckdb_state`: `DuckDBSuccess` is 0.
type State = i32;

/// `duckdb_result` (its layout; read through the API only).
#[repr(C)]
struct RawResult {
    column_count: u64,
    row_count: u64,
    rows_changed: u64,
    columns: *mut c_void,
    error: *mut c_char,
    internal: *mut c_void,
}

struct Api {
    _library: Library,
    create_config: unsafe extern "C" fn(*mut Handle) -> State,
    set_config: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> State,
    destroy_config: unsafe extern "C" fn(*mut Handle),
    open_ext: unsafe extern "C" fn(*const c_char, *mut Handle, Handle, *mut *mut c_char) -> State,
    close: unsafe extern "C" fn(*mut Handle),
    connect: unsafe extern "C" fn(Handle, *mut Handle) -> State,
    disconnect: unsafe extern "C" fn(*mut Handle),
    interrupt: unsafe extern "C" fn(Handle),
    query: unsafe extern "C" fn(Handle, *const c_char, *mut RawResult) -> State,
    destroy_result: unsafe extern "C" fn(*mut RawResult),
    result_error: unsafe extern "C" fn(*mut RawResult) -> *const c_char,
    column_count: unsafe extern "C" fn(*mut RawResult) -> u64,
    row_count: unsafe extern "C" fn(*mut RawResult) -> u64,
    value_is_null: unsafe extern "C" fn(*mut RawResult, u64, u64) -> bool,
    value_varchar: unsafe extern "C" fn(*mut RawResult, u64, u64) -> *mut c_char,
    free: unsafe extern "C" fn(*mut c_void),
}

/// Where libduckdb lives: explicit override, the app bundle, beside the
/// executable, or the developer vendor folder.
pub fn library_path() -> Option<PathBuf> {
    let name = "libduckdb.dylib";
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PUPPYONE_DUCKDB_LIB") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        candidates.push(dir.join("../Frameworks").join(name));
        candidates.push(dir.join(name));
    }
    candidates.push(
        Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
            .join("vendor/duckdb/lib")
            .join(name),
    );
    candidates.into_iter().find(|p| p.is_file())
}

fn api() -> Option<&'static Api> {
    static API: OnceLock<Option<Api>> = OnceLock::new();
    API.get_or_init(|| {
        let path = library_path()?;
        // SAFETY: the pinned libduckdb; every symbol is bound with its C
        // signature from that release's duckdb.h.
        unsafe {
            let library = Library::new(path).ok()?;
            macro_rules! bind {
                ($name:literal) => {
                    *library.get(concat!($name, "\0").as_bytes()).ok()?
                };
            }
            Some(Api {
                create_config: bind!("duckdb_create_config"),
                set_config: bind!("duckdb_set_config"),
                destroy_config: bind!("duckdb_destroy_config"),
                open_ext: bind!("duckdb_open_ext"),
                close: bind!("duckdb_close"),
                connect: bind!("duckdb_connect"),
                disconnect: bind!("duckdb_disconnect"),
                interrupt: bind!("duckdb_interrupt"),
                query: bind!("duckdb_query"),
                destroy_result: bind!("duckdb_destroy_result"),
                result_error: bind!("duckdb_result_error"),
                column_count: bind!("duckdb_column_count"),
                row_count: bind!("duckdb_row_count"),
                value_is_null: bind!("duckdb_value_is_null"),
                value_varchar: bind!("duckdb_value_varchar"),
                free: bind!("duckdb_free"),
                _library: library,
            })
        }
    })
    .as_ref()
}

/// Whether DuckDB files can be read here.
pub fn available() -> bool {
    api().is_some()
}

/// `openDuckdb`'s settings: read-only, no spill, no external access or
/// extensions, bounded memory, one thread. The temp directory is cleared
/// before external access is disabled (DuckDB refuses it afterwards).
const SETTINGS: [(&str, &str); 10] = [
    ("temp_directory", ""),
    ("max_temp_directory_size", "0B"),
    ("access_mode", "READ_ONLY"),
    ("enable_external_access", "false"),
    ("autoinstall_known_extensions", "false"),
    ("autoload_known_extensions", "false"),
    ("allow_community_extensions", "false"),
    ("allow_unsigned_extensions", "false"),
    ("memory_limit", "128MB"),
    ("threads", "1"),
];

/// An open read-only database with one connection, in one transaction.
pub struct Database {
    api: &'static Api,
    database: Handle,
    connection: Handle,
}
// SAFETY: DuckDB connections may move between threads; the preview uses
// one from one thread at a time (behind a mutex).
unsafe impl Send for Database {}

/// A query's rows, every value as text (`None`: NULL).
pub type Rows = Vec<Vec<Option<String>>>;

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        let api = api().ok_or("DuckDB is not available")?;
        let path = CString::new(path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        let c = |s: &str| CString::new(s).unwrap_or_default();
        // SAFETY: the C API's own create / set / open / connect sequence;
        // every handle is released on each failure path.
        unsafe {
            let mut config: Handle = std::ptr::null_mut();
            if (api.create_config)(&mut config) != 0 {
                return Err("DuckDB configuration failed".into());
            }
            for (name, value) in SETTINGS {
                if (api.set_config)(config, c(name).as_ptr(), c(value).as_ptr()) != 0 {
                    (api.destroy_config)(&mut config);
                    return Err(format!("DuckDB refused {name}"));
                }
            }
            let mut database: Handle = std::ptr::null_mut();
            let mut error: *mut c_char = std::ptr::null_mut();
            let state = (api.open_ext)(path.as_ptr(), &mut database, config, &mut error);
            (api.destroy_config)(&mut config);
            if state != 0 {
                let message = if error.is_null() {
                    "DuckDB could not open the file".to_owned()
                } else {
                    let text = CStr::from_ptr(error).to_string_lossy().into_owned();
                    (api.free)(error.cast());
                    text
                };
                return Err(message);
            }
            let mut connection: Handle = std::ptr::null_mut();
            if (api.connect)(database, &mut connection) != 0 {
                (api.close)(&mut database);
                return Err("DuckDB connection failed".into());
            }
            let db = Self {
                api,
                database,
                connection,
            };
            db.query("SET lock_configuration=true")?;
            db.query("BEGIN TRANSACTION")?;
            Ok(db)
        }
    }

    /// Run `sql`; its rows as text.
    pub fn query(&self, sql: &str) -> Result<Rows, String> {
        let sql = CString::new(sql).map_err(|e| e.to_string())?;
        let api = self.api;
        // SAFETY: a live connection; the result is read within its bounds
        // and destroyed exactly once.
        unsafe {
            let mut result: RawResult = std::mem::zeroed();
            let state = (api.query)(self.connection, sql.as_ptr(), &mut result);
            if state != 0 {
                let error = (api.result_error)(&mut result);
                let message = if error.is_null() {
                    "DuckDB query failed".to_owned()
                } else {
                    CStr::from_ptr(error).to_string_lossy().into_owned()
                };
                (api.destroy_result)(&mut result);
                return Err(message);
            }
            let (columns, rows) = (
                (api.column_count)(&mut result),
                (api.row_count)(&mut result),
            );
            let mut out = Vec::with_capacity(rows as usize);
            for row in 0..rows {
                let mut values = Vec::with_capacity(columns as usize);
                for column in 0..columns {
                    if (api.value_is_null)(&mut result, column, row) {
                        values.push(None);
                        continue;
                    }
                    let text = (api.value_varchar)(&mut result, column, row);
                    if text.is_null() {
                        values.push(None);
                    } else {
                        values.push(Some(CStr::from_ptr(text).to_string_lossy().into_owned()));
                        (api.free)(text.cast());
                    }
                }
                out.push(values);
            }
            (api.destroy_result)(&mut result);
            Ok(out)
        }
    }
}

impl Drop for Database {
    fn drop(&mut self) {
        // SAFETY: the handles this value owns, released once.
        unsafe {
            (self.api.interrupt)(self.connection);
            (self.api.disconnect)(&mut self.connection);
            (self.api.close)(&mut self.database);
        }
    }
}

/// A writable database at `path` with `sql` run in it (test fixtures).
#[cfg(test)]
pub fn create(path: &Path, sql: &str) -> Result<(), String> {
    let api = api().ok_or("DuckDB is not available")?;
    let path = CString::new(path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    // SAFETY: as `Database::open`, with the default configuration.
    unsafe {
        let mut database: Handle = std::ptr::null_mut();
        let mut error: *mut c_char = std::ptr::null_mut();
        if (api.open_ext)(
            path.as_ptr(),
            &mut database,
            std::ptr::null_mut(),
            &mut error,
        ) != 0
        {
            return Err("open".into());
        }
        let mut connection: Handle = std::ptr::null_mut();
        if (api.connect)(database, &mut connection) != 0 {
            (api.close)(&mut database);
            return Err("connect".into());
        }
        let db = Database {
            api,
            database,
            connection,
        };
        db.query(sql).map(|_| ())
    }
}

/// A DuckDB string literal.
pub fn literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    #[ignore = "requires DuckDB; tools/verify-native-dependencies.py runs this explicitly"]
    fn a_read_only_database_reads_and_refuses_writes() {
        assert!(available(), "DuckDB missing: run tools/fetch-duckdb.py");
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.duckdb");
        create(
            &path,
            "CREATE TABLE t(a INTEGER, b VARCHAR); INSERT INTO t VALUES (1, 'x'), (NULL, 'it''s')",
        )
        .unwrap();
        let db = Database::open(&path).unwrap();
        let rows = db.query("SELECT a, b FROM t ORDER BY b DESC").unwrap();
        assert_eq!(
            rows,
            vec![
                vec![Some("1".into()), Some("x".into())],
                vec![None, Some("it's".into())]
            ]
        );
        assert!(
            db.query("INSERT INTO t VALUES (2, 'y')").is_err(),
            "read-only"
        );
        assert!(
            db.query("SELECT * FROM read_csv('/etc/hosts')").is_err(),
            "no external access"
        );
        assert_eq!(literal("it's"), "'it''s'");
    }
}
