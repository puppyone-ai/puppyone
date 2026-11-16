#![cfg(test)]
use super::*;
use std::{
    io::{self, Cursor, Read, Seek, SeekFrom},
    sync::{Mutex, atomic::AtomicUsize, mpsc},
};
#[derive(Default)]
struct Counts {
    reads: AtomicUsize,
    bytes: AtomicUsize,
    drops: AtomicUsize,
    max_request: AtomicUsize,
    fail_at: AtomicUsize,
    hook: Mutex<Option<Box<dyn FnOnce() + Send>>>,
}
struct Reader {
    cursor: Cursor<Vec<u8>>,
    counts: Arc<Counts>,
}
impl Drop for Reader {
    fn drop(&mut self) {
        self.counts.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl Read for Reader {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        let index = self.counts.reads.fetch_add(1, Ordering::SeqCst) + 1;
        self.counts
            .max_request
            .fetch_max(bytes.len(), Ordering::SeqCst);
        let fail = self.counts.fail_at.load(Ordering::SeqCst);
        if fail != 0 && index >= fail {
            return Err(io::Error::other("private provider detail must not escape"));
        }
        let n = self.cursor.read(bytes)?;
        self.counts.bytes.fetch_add(n, Ordering::SeqCst);
        let hook = self.counts.hook.lock().unwrap().take();
        if let Some(hook) = hook {
            hook();
        }
        Ok(n)
    }
}
impl Seek for Reader {
    fn seek(&mut self, seek: SeekFrom) -> io::Result<u64> {
        self.cursor.seek(seek)
    }
}
fn fixture() -> Vec<u8> {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("database.db");
    let db = Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE items(id INTEGER, value TEXT, payload BLOB); BEGIN;")
        .unwrap();
    for i in 0..300 {
        db.execute(
            "INSERT INTO items VALUES (?1, ?2, zeroblob(8192))",
            rusqlite::params![i, "value".repeat(100)],
        )
        .unwrap();
    }
    db.execute_batch("COMMIT").unwrap();
    drop(db);
    std::fs::read(path).unwrap()
}
fn input(bytes: Vec<u8>) -> (Input, Arc<Counts>, Arc<AtomicBool>) {
    let counts = Arc::new(Counts::default());
    let live = Arc::new(AtomicBool::new(true));
    let valid = live.clone();
    (
        Input {
            length: bytes.len() as u64,
            reader: Box::new(Reader {
                cursor: Cursor::new(bytes),
                counts: counts.clone(),
            }),
            validate: Arc::new(move || {
                if valid.load(Ordering::SeqCst) {
                    Ok(())
                } else {
                    Err(Failure::Permission)
                }
            }),
        },
        counts,
        live,
    )
}
fn open(input: Input) -> Session {
    Session::open_reader(input, MAX_SOURCE_BYTES, Arc::new(AtomicBool::new(false))).unwrap()
}
fn items(session: &Session) -> usize {
    session
        .objects
        .iter()
        .position(|o| o.name == "items")
        .unwrap()
}

#[test]
fn sqlite_reads_provider_pages_lazily_without_buffering_a_multigigabyte_extent() {
    let (mut input, counts, _) = input(fixture());
    input.length = MAX_SOURCE_BYTES;
    let session = open(input);
    let page = session.page(items(&session), 0, 0).unwrap();
    assert_eq!(page.rows.len(), PAGE_ROWS);
    assert_eq!(page.rows[0][2].bytes, 8192);
    assert_eq!(page.rows[0][2].kind, CellKind::Blob);
    assert!(counts.bytes.load(Ordering::SeqCst) < 1024 * 1024);
    assert!(counts.max_request.load(Ordering::SeqCst) <= 64 * 1024);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 0);
    drop(session);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn sqlite_cannot_write_attach_an_ambient_file_or_create_output_through_the_provider_vfs() {
    let (input, counts, _) = input(fixture());
    let session = open(input);
    let dir = tempfile::tempdir().unwrap();
    let outside = dir.path().join("outside.db");
    let output = dir.path().join("output.db");
    Connection::open(&outside)
        .unwrap()
        .execute_batch("CREATE TABLE secret(value); INSERT INTO secret VALUES ('private');")
        .unwrap();
    let before = std::fs::read(&outside).unwrap();
    assert!(
        session
            .connection
            .execute("INSERT INTO items VALUES (999, 'changed', NULL)", [])
            .is_err()
    );
    assert!(
        session
            .connection
            .execute("ATTACH DATABASE ?1 AS outside", [outside.to_str().unwrap()])
            .is_err()
    );
    assert!(
        session
            .connection
            .execute("VACUUM INTO ?1", [output.to_str().unwrap()])
            .is_err()
    );
    assert_eq!(std::fs::read(&outside).unwrap(), before);
    assert!(!output.exists());
    assert_eq!(
        session.page(items(&session), 0, 0).unwrap().rows[0][0].text,
        "0"
    );
    drop(session);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn cached_sqlite_pages_still_require_live_authority_and_io_errors_never_become_partial_success() {
    let (input, counts, live) = input(fixture());
    let session = open(input);
    session.page(items(&session), 0, 0).unwrap();
    let reads = counts.reads.load(Ordering::SeqCst);
    live.store(false, Ordering::SeqCst);
    assert_eq!(
        session.page(items(&session), 0, 0).err(),
        Some(Failure::Permission)
    );
    assert_eq!(counts.reads.load(Ordering::SeqCst), reads);
    drop(session);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    let (input, counts, _) = self::input(fixture());
    let session = open(input);
    counts
        .fail_at
        .store(counts.reads.load(Ordering::SeqCst) + 3, Ordering::SeqCst);
    assert_eq!(
        session.page(items(&session), 0, 0).err(),
        Some(Failure::Unavailable)
    );
    let reads = counts.reads.load(Ordering::SeqCst);
    assert_eq!(
        session.page(items(&session), 0, 0).err(),
        Some(Failure::Unavailable)
    );
    assert_eq!(counts.reads.load(Ordering::SeqCst), reads);
    drop(session);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn database_admission_checks_budget_cancel_and_header_before_opening_an_engine() {
    for (size, cancelled, expected) in [
        (MAX_SOURCE_BYTES + 1, false, Failure::Budget),
        (100, true, Failure::Unavailable),
    ] {
        let (mut input, counts, _) = input(fixture());
        input.length = size;
        assert_eq!(
            Session::open_reader(
                input,
                MAX_SOURCE_BYTES,
                Arc::new(AtomicBool::new(cancelled))
            )
            .err(),
            Some(expected)
        );
        assert_eq!(counts.bytes.load(Ordering::SeqCst), 0);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
    for wal in [false, true] {
        let mut bytes = fixture();
        if wal {
            bytes[18] = 2;
        } else {
            bytes[0] = 0;
        }
        let (input, counts, _) = input(bytes);
        assert_eq!(
            Session::open_reader(input, MAX_SOURCE_BYTES, Arc::new(AtomicBool::new(false))).err(),
            Some(if wal {
                Failure::Recovery
            } else {
                Failure::Unsupported
            })
        );
        assert_eq!(counts.bytes.load(Ordering::SeqCst), 100);
        assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn cancellation_during_provider_admission_drops_the_reader_without_publishing_a_session() {
    let (input, counts, _) = input(fixture());
    let (entered, started) = mpsc::sync_channel(1);
    let (release, released) = mpsc::sync_channel(1);
    *counts.hook.lock().unwrap() = Some(Box::new(move || {
        entered.send(()).unwrap();
        released.recv_timeout(Duration::from_secs(5)).unwrap();
    }));
    let cancel = Arc::new(AtomicBool::new(false));
    let token = cancel.clone();
    let worker = std::thread::spawn(move || Session::open_reader(input, MAX_SOURCE_BYTES, token));
    started.recv_timeout(Duration::from_secs(5)).unwrap();
    cancel.store(true, Ordering::SeqCst);
    release.send(()).unwrap();
    assert_eq!(worker.join().unwrap().err(), Some(Failure::Unavailable));
    assert_eq!(counts.bytes.load(Ordering::SeqCst), 100);
    assert_eq!(counts.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn the_actual_sqlite_vm_obeys_cancellation_and_query_deadlines() {
    const EXPENSIVE: &str = "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n";
    let (input, _, _) = input(fixture());
    let cancel = Arc::new(AtomicBool::new(false));
    let session = Session::open_reader(input, MAX_SOURCE_BYTES, cancel.clone()).unwrap();
    cancel.store(true, Ordering::SeqCst);
    assert!(
        session
            .connection
            .query_row(EXPENSIVE, [], |row| row.get::<_, i64>(0))
            .is_err()
    );
    let (input, _, _) = self::input(fixture());
    let session = open(input);
    let start = session.guard.begin(Duration::from_millis(50));
    assert!(start.is_ok() || start == Err(Failure::Budget));
    let started = Instant::now();
    assert!(
        session
            .connection
            .query_row(EXPENSIVE, [], |row| row.get::<_, i64>(0))
            .is_err()
    );
    assert_eq!(session.check(), Err(Failure::Budget));
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[test]
fn sqlite_lossless_pages_and_quoted_column_windows_leave_source_and_directory_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sample.db");
    let db = Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE items(id INTEGER PRIMARY KEY, label TEXT, big INTEGER); BEGIN")
        .unwrap();
    for i in 0..57 {
        db.execute(
            "INSERT INTO items VALUES (?1, ?2, ?3)",
            rusqlite::params![i, format!("<b>row {i}</b>"), i64::MAX],
        )
        .unwrap();
    }
    db.execute_batch("COMMIT").unwrap();
    let fields: Vec<_> = (0..30)
        .map(|i| format!("{} INTEGER", quote(&format!("c\"{i}"))))
        .collect();
    db.execute_batch(&format!(
        "CREATE TABLE {}({}); INSERT INTO {}({}, {}) VALUES(1,29);",
        quote("wide\"table"),
        fields.join(","),
        quote("wide\"table"),
        quote("c\"0"),
        quote("c\"29")
    ))
    .unwrap();
    drop(db);
    let before = std::fs::read(&path).unwrap();
    let session = Session::open(&path, MAX_SOURCE_BYTES).unwrap();
    let items = session
        .objects()
        .iter()
        .position(|o| o.name == "items")
        .unwrap();
    let first = session.page(items, 0, 0).unwrap();
    assert_eq!(first.rows.len(), 50);
    assert!(first.has_more);
    assert_eq!(first.rows[0][2].text, "9223372036854775807");
    assert_eq!(first.rows[0][1].text, "<b>row 0</b>");
    let next = session.page(items, 50, 0).unwrap();
    assert_eq!(next.rows.len(), 7);
    assert!(!next.has_more);
    let wide = session
        .objects()
        .iter()
        .position(|o| o.name == "wide\"table")
        .unwrap();
    let first = session.page(wide, 0, 0).unwrap();
    assert_eq!(first.columns.len(), 30);
    assert_eq!(first.rows[0].len(), 24);
    let last = session.page(wide, 0, 24).unwrap();
    assert_eq!(last.rows[0].len(), 6);
    assert_eq!(last.rows[0][5].text, "29");
    drop(session);
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn an_active_wal_is_refused_without_checkpointing_or_mutating_its_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("active.db");
    let writer = Connection::open(&path).unwrap();
    writer.execute_batch("CREATE TABLE items(value); PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO items VALUES('uncheckpointed private value');").unwrap();
    let before = std::fs::read(&path).unwrap();
    let wal = sidecar(&path, "-wal");
    let wal_before = std::fs::read(&wal).unwrap();
    assert!(!wal_before.is_empty());
    assert_eq!(
        Session::open(&path, MAX_SOURCE_BYTES).err(),
        Some(Failure::Recovery)
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert_eq!(std::fs::read(&wal).unwrap(), wal_before);
    drop(writer);
}

#[test]
fn object_limits_and_typed_values_are_enforced_by_the_real_sqlite_engine() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("typed.db");
    let db = Connection::open(&path).unwrap();
    db.execute_batch(
        "CREATE TABLE typed(value TEXT, empty TEXT, missing TEXT, bytes BLOB, precise REAL);",
    )
    .unwrap();
    db.execute(
        "INSERT INTO typed VALUES(?1,'',NULL,zeroblob(1048576),?2)",
        rusqlite::params!["🐶中".repeat(500), 1.2345678901234567],
    )
    .unwrap();
    drop(db);
    let session = Session::open(&path, MAX_SOURCE_BYTES).unwrap();
    let page = session.page(0, 0, 0).unwrap();
    let row = &page.rows[0];
    assert_eq!(row[0].text, "🐶中".repeat(128));
    assert!(row[0].truncated);
    assert_eq!(row[1].text, "");
    assert_eq!(row[2].kind, CellKind::Null);
    assert_eq!(row[3].kind, CellKind::Blob);
    assert_eq!(row[3].bytes, 1048576);
    assert!(row[3].text.is_empty());
    assert_eq!(row[4].text, "1.2345678901234567");
    assert_eq!(
        session.page(usize::MAX, 0, 0).err(),
        Some(Failure::Unsupported)
    );
    drop(session);
    let db = Connection::open(&path).unwrap();
    for i in 0..MAX_OBJECTS {
        db.execute_batch(&format!("CREATE TABLE t{i}(value)"))
            .unwrap();
    }
    drop(db);
    assert_eq!(
        Session::open(&path, MAX_SOURCE_BYTES).err(),
        Some(Failure::Budget)
    );
}
