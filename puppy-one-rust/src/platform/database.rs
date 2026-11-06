//! Database preview host (`electron/main/database-preview` with
//! `shared/database-preview/contract.mjs`): read-only, detected by file
//! signature, never repaired or written.
//!
//! SQLite base tables open through an immutable read-only connection on a
//! worker thread; DuckDB files are recognised and reported as unsupported
//! here. A WAL-mode header or any `-journal` / `-wal` / `-shm` sidecar needs
//! recovery by the database's own application. Objects are listed like
//! `pragma_table_list` (views and virtual tables stay listed but unreadable),
//! pages are bounded by the product budget, and a changed file expires the
//! session. Each open is a new snapshot epoch: a cursor never continues
//! across reopenings.
use rusqlite::{Connection, OpenFlags, types::ValueRef};
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant, SystemTime},
};

/// `DATABASE_BUDGET`.
pub const MAX_SOURCE_BYTES: u64 = 8 * 1024 * 1024 * 1024;
pub const MAX_OBJECTS: usize = 512;
pub const MAX_COLUMNS: usize = 128;
pub const PAGE_ROWS: usize = 50;
pub const PAGE_COLUMNS: usize = 24;
const CELL_CHARACTERS: usize = 256;
/// A session sleeps after a minute without reads and ends after five.
pub const IDLE: Duration = Duration::from_secs(60);
pub const SESSION: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    /// `recovery-required`
    Recovery,
    /// `unrecognized-format`, `unsupported-version`, `unsupported-object`
    Unsupported,
    /// `stale-input`: the file changed since it was opened.
    Expired,
    /// `permission-denied`
    Permission,
    /// `budget-exceeded` / `timeout`
    Budget,
    /// Every other host failure.
    Unavailable,
}
impl Failure {
    /// `DatabaseViewer`'s `failureDetail`.
    pub fn message_key(self) -> &'static str {
        match self {
            Self::Recovery => "editor.database.recovery",
            Self::Unsupported => "editor.database.unsupported",
            Self::Expired => "editor.database.expired",
            Self::Permission => "editor.database.permission",
            Self::Budget => "editor.database.budget",
            Self::Unavailable => "editor.database.unavailable",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Engine {
    Sqlite { wal: bool },
    DuckDb,
}
/// `detectDatabase(bytes)`: the bounded 100-byte header.
pub fn detect(head: &[u8]) -> Option<Engine> {
    if head.len() >= 100 && head.starts_with(b"SQLite format 3\0") {
        Some(Engine::Sqlite {
            wal: head[18] == 2 || head[19] == 2,
        })
    } else if head.len() >= 20 && &head[8..12] == b"DUCK" {
        Some(Engine::DuckDb)
    } else {
        None
    }
}
/// `DatabaseObjectUnavailableReason`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unreadable {
    Kind,
    TooManyColumns,
    GeneratedOrHidden,
}
impl Unreadable {
    /// `databaseObjectUnavailableMessage(reason)`.
    pub fn message_key(self) -> &'static str {
        match self {
            Self::TooManyColumns => "editor.database.objectUnavailableColumns",
            Self::GeneratedOrHidden => "editor.database.objectUnavailableGenerated",
            Self::Kind => "editor.database.objectUnavailableKind",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Object {
    pub name: String,
    pub unreadable: Option<Unreadable>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Column {
    pub name: String,
    /// The declared type, `ANY` when there is none.
    pub native_type: String,
    pub primary_key: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CellKind {
    Null,
    Integer,
    Real,
    Text,
    Blob,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cell {
    pub kind: CellKind,
    /// At most 256 characters; empty for NULL and BLOB.
    pub text: String,
    pub truncated: bool,
    /// A BLOB's size.
    pub bytes: u64,
}
#[cfg(test)]
impl Cell {
    pub fn text(kind: CellKind, text: &str) -> Self {
        Self {
            kind,
            text: text.into(),
            truncated: false,
            bytes: 0,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Page {
    /// The session that read it.
    pub epoch: u64,
    /// The first row's position.
    pub offset: usize,
    pub column_offset: usize,
    /// Every column of the object, and the ones this page shows.
    pub columns: Vec<Column>,
    pub visible: Vec<Column>,
    pub rows: Vec<Vec<Cell>>,
    pub has_more: bool,
}

static EPOCH: AtomicU64 = AtomicU64::new(1);

pub struct Session {
    path: PathBuf,
    stamp: Option<(u64, SystemTime)>,
    connection: Connection,
    objects: Vec<Object>,
    pub epoch: u64,
    opened: Instant,
}
fn stamp(path: &Path) -> Option<(u64, SystemTime)> {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.len(), meta.modified().ok()?))
}
fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}
fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}
impl Session {
    pub fn open(path: &Path, max_bytes: u64) -> Result<Self, Failure> {
        let meta = std::fs::symlink_metadata(path).map_err(|e| match e.kind() {
            std::io::ErrorKind::PermissionDenied => Failure::Permission,
            _ => Failure::Unavailable,
        })?;
        if meta.file_type().is_symlink() {
            return Err(Failure::Permission);
        }
        if meta.len() > max_bytes {
            return Err(Failure::Budget);
        }
        let mut head = [0u8; 100];
        let n = {
            use std::io::Read;
            let mut file = std::fs::File::open(path).map_err(|_| Failure::Unavailable)?;
            file.read(&mut head).map_err(|_| Failure::Unavailable)?
        };
        match detect(&head[..n]) {
            Some(Engine::Sqlite { wal: true }) => return Err(Failure::Recovery),
            Some(Engine::Sqlite { wal: false }) => {}
            Some(Engine::DuckDb) | None => return Err(Failure::Unsupported),
        }
        // Opening a live log read-only can still write sidecars; never show
        // an incomplete main file.
        if ["-journal", "-wal", "-shm"]
            .iter()
            .any(|suffix| std::fs::symlink_metadata(sidecar(path, suffix)).is_ok())
        {
            return Err(Failure::Recovery);
        }
        let uri = format!(
            "file:{}?mode=ro&immutable=1",
            url::form_urlencoded::byte_serialize(path.to_string_lossy().as_bytes())
                .collect::<String>()
                .replace("%2F", "/")
        );
        let connection = Connection::open_with_flags(
            uri,
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_URI
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|_| Failure::Unavailable)?;
        connection
            .execute_batch(
                "PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA mmap_size=0; \
                 PRAGMA cache_size=-8192; PRAGMA temp_store=MEMORY; PRAGMA hard_heap_limit=134217728;",
            )
            .map_err(|_| Failure::Unavailable)?;
        let mut session = Self {
            path: path.to_path_buf(),
            stamp: stamp(path),
            connection,
            objects: vec![],
            epoch: EPOCH.fetch_add(1, Ordering::Relaxed),
            opened: Instant::now(),
        };
        session.objects = session.list()?;
        Ok(session)
    }
    fn check(&self) -> Result<(), Failure> {
        if stamp(&self.path) != self.stamp {
            return Err(Failure::Expired);
        }
        Ok(())
    }
    /// Past the session's five minutes: reopen before reading.
    pub fn ended(&self) -> bool {
        self.opened.elapsed() >= SESSION
    }
    pub fn objects(&self) -> &[Object] {
        &self.objects
    }
    /// `pragma_table_list` of `main`: only plain base tables are readable.
    fn list(&self) -> Result<Vec<Object>, Failure> {
        self.check()?;
        let mut statement = self
            .connection
            .prepare("SELECT name, type, ncol FROM pragma_table_list WHERE schema='main' AND name NOT LIKE 'sqlite_%' LIMIT ?1")
            .map_err(|_| Failure::Unsupported)?;
        let entries: Vec<(String, String, i64)> = statement
            .query_map([MAX_OBJECTS as i64 + 1], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .map_err(|_| Failure::Unsupported)?
            .filter_map(Result::ok)
            .collect();
        if entries.len() > MAX_OBJECTS {
            return Err(Failure::Budget);
        }
        let mut objects = vec![];
        for (name, kind, columns) in entries {
            let table = kind == "table";
            let hidden = table
                && self
                    .connection
                    .prepare("SELECT hidden FROM pragma_table_xinfo(?1) WHERE hidden<>0 LIMIT 1")
                    .and_then(|mut s| s.exists([&name]))
                    .map_err(|_| Failure::Unsupported)?;
            let unreadable = if !table {
                Some(Unreadable::Kind)
            } else if columns as usize > MAX_COLUMNS {
                Some(Unreadable::TooManyColumns)
            } else if hidden {
                Some(Unreadable::GeneratedOrHidden)
            } else {
                None
            };
            objects.push(Object { name, unreadable });
        }
        Ok(objects)
    }
    /// The object's columns (`pragma_table_xinfo`).
    fn columns(&self, object: &str) -> Result<Vec<Column>, Failure> {
        let mut info = self
            .connection
            .prepare("SELECT name, type, pk, hidden FROM pragma_table_xinfo(?1) LIMIT ?2")
            .map_err(|_| Failure::Unsupported)?;
        let fields: Vec<(String, String, i64, i64)> = info
            .query_map(rusqlite::params![object, MAX_COLUMNS as i64 + 1], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .map_err(|_| Failure::Unsupported)?
            .filter_map(Result::ok)
            .collect();
        if fields.len() > MAX_COLUMNS || fields.iter().any(|f| f.3 != 0) {
            return Err(Failure::Unsupported);
        }
        Ok(fields
            .into_iter()
            .map(|(name, native_type, pk, _)| Column {
                name,
                native_type: if native_type.is_empty() {
                    "ANY".into()
                } else {
                    native_type
                },
                primary_key: pk > 0,
            })
            .collect())
    }
    /// Up to 50 rows from `offset` over 24 columns from `column_offset`.
    pub fn page(
        &self,
        object: usize,
        offset: usize,
        column_offset: usize,
    ) -> Result<Page, Failure> {
        self.check()?;
        let object = self
            .objects
            .get(object)
            .filter(|o| o.unreadable.is_none())
            .ok_or(Failure::Unsupported)?;
        let columns = self.columns(&object.name)?;
        let visible: Vec<Column> = columns
            .iter()
            .skip(column_offset)
            .take(PAGE_COLUMNS)
            .cloned()
            .collect();
        if visible.is_empty() {
            if columns.is_empty() {
                return Ok(Page {
                    epoch: self.epoch,
                    offset,
                    column_offset,
                    columns,
                    visible,
                    rows: vec![],
                    has_more: false,
                });
            }
            return Err(Failure::Unavailable);
        }
        // Even substr(blob) can materialise the whole value: a BLOB's page
        // needs its size only, which length() reads from record metadata.
        let projections: Vec<String> = visible
            .iter()
            .map(|column| {
                let col = quote(&column.name);
                format!(
                    "typeof({col}), CASE WHEN typeof({col})='blob' THEN NULL WHEN typeof({col}) IN ('integer','real') THEN {col} ELSE substr(CAST({col} AS TEXT),1,{CELL_CHARACTERS}) END, CASE WHEN typeof({col}) IN ('text','blob') THEN length({col}) ELSE 0 END"
                )
            })
            .collect();
        let sql = format!(
            "SELECT {} FROM {} LIMIT {} OFFSET {}",
            projections.join(", "),
            quote(&object.name),
            PAGE_ROWS + 1,
            offset
        );
        let mut statement = self
            .connection
            .prepare(&sql)
            .map_err(|_| Failure::Unsupported)?;
        let width = visible.len();
        let mut rows: Vec<Vec<Cell>> = statement
            .query_map([], |row| {
                (0..width)
                    .map(|i| {
                        let kind = match row.get_ref(i * 3)?.as_str().unwrap_or("null") {
                            "integer" => CellKind::Integer,
                            "real" => CellKind::Real,
                            "text" => CellKind::Text,
                            "blob" => CellKind::Blob,
                            _ => CellKind::Null,
                        };
                        let length = row.get::<_, i64>(i * 3 + 2)?.max(0) as u64;
                        let text = match row.get_ref(i * 3 + 1)? {
                            ValueRef::Integer(v) => v.to_string(),
                            ValueRef::Real(v) => v.to_string(),
                            ValueRef::Text(bytes) => String::from_utf8_lossy(bytes).into_owned(),
                            ValueRef::Null | ValueRef::Blob(_) => String::new(),
                        };
                        Ok(Cell {
                            kind,
                            text,
                            truncated: kind != CellKind::Blob && length > CELL_CHARACTERS as u64,
                            bytes: if kind == CellKind::Blob { length } else { 0 },
                        })
                    })
                    .collect()
            })
            .map_err(|_| Failure::Unsupported)?
            .filter_map(Result::ok)
            .collect();
        let has_more = rows.len() > PAGE_ROWS;
        rows.truncate(PAGE_ROWS);
        Ok(Page {
            epoch: self.epoch,
            offset,
            column_offset,
            columns,
            visible,
            rows,
            has_more,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(dir: &Path) -> PathBuf {
        let path = dir.join("app.db");
        let c = Connection::open(&path).unwrap();
        c.execute_batch(
            "CREATE TABLE people(id INTEGER PRIMARY KEY, name TEXT, photo BLOB);
             INSERT INTO people(name, photo) VALUES ('Ada', x'0102'), ('Lin', NULL);
             CREATE TABLE empty(x);",
        )
        .unwrap();
        for i in 0..150 {
            c.execute("INSERT INTO people(name) VALUES (?1)", [format!("p{i}")])
                .unwrap();
        }
        drop(c);
        path
    }

    #[test]
    fn sqlite_tables_page_read_only_and_expire_on_change() {
        let dir = tempfile::tempdir().unwrap();
        let path = fixture(dir.path());
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE VIEW names AS SELECT name FROM people;")
            .unwrap();
        let session = Session::open(&path, 1 << 30).unwrap();
        let objects = session.objects();
        let people = objects.iter().position(|o| o.name == "people").unwrap();
        let view = objects.iter().find(|o| o.name == "names").unwrap();
        assert_eq!(view.unreadable, Some(Unreadable::Kind));
        let first = session.page(people, 0, 0).unwrap();
        assert_eq!(
            first.columns[0],
            Column {
                name: "id".into(),
                native_type: "INTEGER".into(),
                primary_key: true,
            }
        );
        assert_eq!(first.rows.len(), PAGE_ROWS);
        assert!(first.has_more);
        assert_eq!(first.rows[0][1], Cell::text(CellKind::Text, "Ada"));
        assert_eq!(first.rows[0][2].kind, CellKind::Blob);
        assert_eq!(first.rows[0][2].bytes, 2);
        assert_eq!(first.rows[1][2].kind, CellKind::Null);
        let last = session.page(people, 150, 0).unwrap();
        assert_eq!(last.rows.len(), 2);
        assert!(!last.has_more);
        assert!(session.page(people, 0, 3).is_err());
        assert!(
            session
                .page(
                    objects.iter().position(|o| o.name == "names").unwrap(),
                    0,
                    0
                )
                .is_err()
        );
        // Writing through another connection expires the read-only session.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        Connection::open(&path)
            .unwrap()
            .execute("INSERT INTO empty VALUES (1)", [])
            .unwrap();
        assert_eq!(session.page(people, 0, 0).err(), Some(Failure::Expired));
    }

    #[test]
    fn long_values_wide_tables_and_generated_columns_follow_the_budget() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("wide.db");
        let c = Connection::open(&path).unwrap();
        let wide: Vec<String> = (0..130).map(|i| format!("c{i}")).collect();
        c.execute_batch(&format!(
            "CREATE TABLE wide({}); CREATE TABLE gen(a, b AS (a * 2)); CREATE TABLE long(v);",
            wide.join(", ")
        ))
        .unwrap();
        c.execute("INSERT INTO long VALUES (?1)", ["x".repeat(300)])
            .unwrap();
        drop(c);
        let session = Session::open(&path, 1 << 30).unwrap();
        let reason = |name: &str| {
            session
                .objects()
                .iter()
                .find(|o| o.name == name)
                .unwrap()
                .unreadable
        };
        assert_eq!(reason("wide"), Some(Unreadable::TooManyColumns));
        assert_eq!(reason("gen"), Some(Unreadable::GeneratedOrHidden));
        let long = session
            .objects()
            .iter()
            .position(|o| o.name == "long")
            .unwrap();
        let cell = &session.page(long, 0, 0).unwrap().rows[0][0];
        assert_eq!(cell.text.chars().count(), 256);
        assert!(cell.truncated);
    }

    #[test]
    fn signatures_sidecars_and_budgets_are_checked() {
        let dir = tempfile::tempdir().unwrap();
        let path = fixture(dir.path());
        assert_eq!(Session::open(&path, 10).err(), Some(Failure::Budget));
        let mut header = std::fs::read(&path).unwrap();
        header[18] = 2;
        header[19] = 2;
        let wal_mode = dir.path().join("wal.db");
        std::fs::write(&wal_mode, &header).unwrap();
        assert_eq!(
            Session::open(&wal_mode, 1 << 30).err(),
            Some(Failure::Recovery)
        );
        std::fs::write(sidecar(&path, "-shm"), b"").unwrap();
        assert_eq!(Session::open(&path, 1 << 30).err(), Some(Failure::Recovery));
        let text = dir.path().join("notes.db");
        std::fs::write(&text, b"plain text").unwrap();
        assert_eq!(
            Session::open(&text, 1 << 30).err(),
            Some(Failure::Unsupported)
        );
        let mut duck = vec![0u8; 20];
        duck[8..12].copy_from_slice(b"DUCK");
        assert_eq!(detect(&duck), Some(Engine::DuckDb));
    }
}
