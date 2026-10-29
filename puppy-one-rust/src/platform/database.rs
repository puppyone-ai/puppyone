//! Database preview host (`electron/main/database-preview`): read-only,
//! detected by file signature, never repaired or written.
//!
//! SQLite base tables open through an immutable read-only connection on a
//! worker thread; DuckDB files are recognised and reported as unsupported
//! here; a database with an active journal/WAL sidecar needs recovery by its
//! own application. Pages are bounded (100 rows, 50 columns, 4 KiB per
//! value) and a changed file expires the session.
use rusqlite::{Connection, OpenFlags, types::ValueRef};
use std::{
    path::{Path, PathBuf},
    time::SystemTime,
};

pub const PAGE_ROWS: usize = 100;
pub const PAGE_COLUMNS: usize = 50;
const VALUE_BYTES: usize = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    /// `database.recovery`: active logs or recovery required.
    Recovery,
    /// `database.unsupported`: format, version or object not supported.
    Unsupported,
    /// `database.expired`: the file changed since it was opened.
    Expired,
    /// `database.permission`
    Permission,
    /// `database.unavailable`
    Unavailable,
}
impl Failure {
    pub fn message_key(self) -> &'static str {
        match self {
            Self::Recovery => "editor.database.recovery",
            Self::Unsupported => "editor.database.unsupported",
            Self::Expired => "editor.database.expired",
            Self::Permission => "editor.database.permission",
            Self::Unavailable => "editor.database.unavailable",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Engine {
    Sqlite,
    DuckDb,
}
/// Signature probe of the first 100 bytes.
pub fn detect(head: &[u8]) -> Option<Engine> {
    if head.starts_with(b"SQLite format 3\0") {
        Some(Engine::Sqlite)
    } else if head.len() >= 12 && &head[8..12] == b"DUCK" {
        Some(Engine::DuckDb)
    } else {
        None
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Column {
    pub name: String,
    pub native_type: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Object {
    pub name: String,
    pub columns: Vec<Column>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Cell {
    Null,
    Text(String),
    Number(String),
    /// `database.complex`
    Blob(usize),
    /// `database.truncated`
    Truncated(String),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Page {
    pub offset: usize,
    pub first_column: usize,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Cell>>,
    pub has_more: bool,
}

pub struct Session {
    path: PathBuf,
    stamp: Option<(u64, SystemTime)>,
    connection: Connection,
}
fn stamp(path: &Path) -> Option<(u64, SystemTime)> {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.len(), meta.modified().ok()?))
}
fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}
impl Session {
    pub fn open(path: &Path, max_bytes: u64) -> Result<Self, Failure> {
        let meta = std::fs::metadata(path).map_err(|e| match e.kind() {
            std::io::ErrorKind::PermissionDenied => Failure::Permission,
            _ => Failure::Unavailable,
        })?;
        if meta.len() > max_bytes {
            return Err(Failure::Unsupported);
        }
        let mut head = [0u8; 100];
        let n = {
            use std::io::Read;
            let mut file = std::fs::File::open(path).map_err(|_| Failure::Unavailable)?;
            file.read(&mut head).map_err(|_| Failure::Unavailable)?
        };
        match detect(&head[..n]) {
            Some(Engine::Sqlite) => {}
            Some(Engine::DuckDb) | None => return Err(Failure::Unsupported),
        }
        for sidecar in ["-wal", "-journal"] {
            let mut name = path.as_os_str().to_owned();
            name.push(sidecar);
            if std::fs::metadata(PathBuf::from(name)).is_ok_and(|m| m.len() > 0) {
                return Err(Failure::Recovery);
            }
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
        Ok(Self {
            path: path.to_path_buf(),
            stamp: stamp(path),
            connection,
        })
    }
    fn check(&self) -> Result<(), Failure> {
        if stamp(&self.path) != self.stamp {
            return Err(Failure::Expired);
        }
        Ok(())
    }
    /// Base tables with their declared columns (generated columns excluded).
    pub fn objects(&self) -> Result<Vec<Object>, Failure> {
        self.check()?;
        let mut statement = self
            .connection
            .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .map_err(|_| Failure::Unsupported)?;
        let names: Vec<String> = statement
            .query_map([], |r| r.get(0))
            .map_err(|_| Failure::Unsupported)?
            .filter_map(Result::ok)
            .collect();
        let mut objects = vec![];
        for name in names {
            let mut info = self
                .connection
                .prepare(&format!("PRAGMA table_xinfo({})", quote(&name)))
                .map_err(|_| Failure::Unsupported)?;
            let columns: Vec<Column> = info
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(6)?,
                    ))
                })
                .map_err(|_| Failure::Unsupported)?
                .filter_map(Result::ok)
                .filter(|(_, _, hidden)| *hidden == 0)
                .map(|(name, native_type, _)| Column { name, native_type })
                .collect();
            objects.push(Object { name, columns });
        }
        Ok(objects)
    }
    pub fn page(
        &self,
        object: &Object,
        offset: usize,
        first_column: usize,
    ) -> Result<Page, Failure> {
        self.check()?;
        let columns: Vec<String> = object
            .columns
            .iter()
            .skip(first_column)
            .take(PAGE_COLUMNS)
            .map(|c| c.name.clone())
            .collect();
        if columns.is_empty() {
            return Ok(Page {
                offset,
                first_column,
                columns,
                rows: vec![],
                has_more: false,
            });
        }
        let list: Vec<String> = columns.iter().map(|c| quote(c)).collect();
        let sql = format!(
            "SELECT {} FROM {} LIMIT {} OFFSET {}",
            list.join(", "),
            quote(&object.name),
            PAGE_ROWS + 1,
            offset
        );
        let mut statement = self
            .connection
            .prepare(&sql)
            .map_err(|_| Failure::Unsupported)?;
        let width = columns.len();
        let mut rows: Vec<Vec<Cell>> = statement
            .query_map([], |row| {
                (0..width)
                    .map(|i| {
                        Ok(match row.get_ref(i)? {
                            ValueRef::Null => Cell::Null,
                            ValueRef::Integer(v) => Cell::Number(v.to_string()),
                            ValueRef::Real(v) => Cell::Number(v.to_string()),
                            ValueRef::Text(bytes) => {
                                let text = String::from_utf8_lossy(bytes);
                                if bytes.len() > VALUE_BYTES {
                                    Cell::Truncated(text.chars().take(VALUE_BYTES / 4).collect())
                                } else {
                                    Cell::Text(text.into_owned())
                                }
                            }
                            ValueRef::Blob(bytes) => Cell::Blob(bytes.len()),
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
            offset,
            first_column,
            columns,
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
        let session = Session::open(&path, 1 << 30).unwrap();
        let objects = session.objects().unwrap();
        assert_eq!(
            objects.iter().map(|o| o.name.as_str()).collect::<Vec<_>>(),
            ["empty", "people"]
        );
        let people = &objects[1];
        assert_eq!(
            people.columns[1],
            Column {
                name: "name".into(),
                native_type: "TEXT".into()
            }
        );
        let first = session.page(people, 0, 0).unwrap();
        assert_eq!(first.rows.len(), PAGE_ROWS);
        assert!(first.has_more);
        assert_eq!(first.rows[0][1], Cell::Text("Ada".into()));
        assert_eq!(first.rows[0][2], Cell::Blob(2));
        assert_eq!(first.rows[1][2], Cell::Null);
        let second = session.page(people, PAGE_ROWS, 0).unwrap();
        assert_eq!(second.rows.len(), 52);
        assert!(!second.has_more);
        // Writing through another connection expires the read-only session.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        Connection::open(&path)
            .unwrap()
            .execute("INSERT INTO empty VALUES (1)", [])
            .unwrap();
        assert_eq!(session.objects().err(), Some(Failure::Expired));
    }

    #[test]
    fn signatures_sidecars_and_budgets_are_checked() {
        let dir = tempfile::tempdir().unwrap();
        let path = fixture(dir.path());
        assert_eq!(Session::open(&path, 10).err(), Some(Failure::Unsupported));
        let mut wal = path.as_os_str().to_owned();
        wal.push("-wal");
        std::fs::write(PathBuf::from(wal), b"log").unwrap();
        assert_eq!(Session::open(&path, 1 << 30).err(), Some(Failure::Recovery));
        let text = dir.path().join("notes.db");
        std::fs::write(&text, b"plain text").unwrap();
        assert_eq!(
            Session::open(&text, 1 << 30).err(),
            Some(Failure::Unsupported)
        );
        let mut duck = vec![0u8; 16];
        duck[8..12].copy_from_slice(b"DUCK");
        assert_eq!(detect(&duck), Some(Engine::DuckDb));
    }
}
