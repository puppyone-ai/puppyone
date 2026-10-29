//! Main-thread responsiveness and worker panic containment.
//!
//! GPUI renders every window from one foreground thread, so a synchronous
//! stall in any window freezes all of them (Electron gave each window its
//! own renderer). The foreground beats every 100 ms; a watcher thread that
//! does not depend on UI frames records any gap over `STALL` with the last
//! activity label, so stalls are visible in diagnostics instead of silent.
//!
//! `spawn_contained` runs worker closures under `catch_unwind`: a panicking
//! parse or I/O worker reports a failure to its owner instead of tearing
//! down the process (and every window with it).
use std::{
    io::Write,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

/// A foreground gap longer than this is a stall (four 60 Hz frames ≈ 67 ms
/// would already be visible; 250 ms is the product's "felt freeze" bar).
pub const STALL: Duration = Duration::from_millis(250);
pub const BEAT: Duration = Duration::from_millis(100);
const LOG_LIMIT: u64 = 256 * 1024;

static EPOCH: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
static LAST_BEAT: AtomicU64 = AtomicU64::new(0);
static STALLS: AtomicU64 = AtomicU64::new(0);
static LONGEST: AtomicU64 = AtomicU64::new(0);
static ACTIVITY: Mutex<&'static str> = Mutex::new("startup");

fn now_ms() -> u64 {
    EPOCH.get_or_init(Instant::now).elapsed().as_millis() as u64
}
/// Called by the foreground ticker.
pub fn beat() {
    LAST_BEAT.store(now_ms().max(1), Ordering::Release);
}
/// Labels what the foreground is about to do (cheap; static strings only).
pub fn activity(label: &'static str) {
    *ACTIVITY.lock().unwrap() = label;
}

static LOG_OVERRIDE: Mutex<Option<PathBuf>> = Mutex::new(None);
fn log_path() -> PathBuf {
    if let Some(path) = LOG_OVERRIDE.lock().unwrap().clone() {
        return path;
    }
    std::env::var_os("PUPPYONE_RUST_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                .join("Library/Application Support/PuppyOne GPUI")
        })
        .join("diagnostics/main-thread-stalls.jsonl")
}
fn record(kind: &str, millis: u64, activity: &str) {
    let path = log_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > LOG_LIMIT) {
        let _ = std::fs::rename(&path, path.with_extension("jsonl.1"));
    }
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let line = serde_json::json!({"at": at, "kind": kind, "ms": millis, "activity": activity});
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(file, "{line}");
    }
}

/// Evaluates one watcher tick; returns a finished stall's length.
fn observe(last_beat: u64, now: u64, open: &mut Option<u64>) -> Option<u64> {
    if last_beat == 0 {
        return None;
    }
    let gap = now.saturating_sub(last_beat);
    if gap > STALL.as_millis() as u64 {
        open.get_or_insert(last_beat);
        None
    } else {
        open.take().map(|start| last_beat.saturating_sub(start))
    }
}

/// Starts the watcher once; the caller drives `beat()` from the foreground.
pub fn start() {
    static STARTED: std::sync::Once = std::sync::Once::new();
    STARTED.call_once(|| {
        now_ms();
        let _ = std::thread::Builder::new()
            .name("main-thread-watchdog".into())
            .spawn(|| {
                let mut open = None;
                let mut label = "startup";
                loop {
                    std::thread::sleep(BEAT);
                    let last = LAST_BEAT.load(Ordering::Acquire);
                    if open.is_none() {
                        label = *ACTIVITY.lock().unwrap();
                    }
                    if let Some(length) = observe(last, now_ms(), &mut open) {
                        STALLS.fetch_add(1, Ordering::AcqRel);
                        LONGEST.fetch_max(length, Ordering::AcqRel);
                        record("stall", length, label);
                    }
                }
            });
    });
}

/// Runs `work` on a named worker thread; a panic is reported to `on_panic`
/// with its message instead of unwinding into the process.
pub fn spawn_contained<F, P>(name: &str, work: F, on_panic: P) -> std::thread::JoinHandle<()>
where
    F: FnOnce() + Send + 'static,
    P: FnOnce(String) + Send + 'static,
{
    let name = name.to_owned();
    let code = crate::localization::current_code();
    std::thread::Builder::new()
        .name(name.clone())
        .spawn(move || {
            crate::localization::set_current(&code);
            if let Err(payload) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)) {
                let message = payload
                    .downcast_ref::<&str>()
                    .map(|s| (*s).to_owned())
                    .or_else(|| payload.downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "worker panicked".into());
                record("worker-panic", 0, Box::leak(name.into_boxed_str()));
                on_panic(message);
            }
        })
        .expect("spawn worker thread")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_gap_longer_than_the_bar_is_one_stall_reported_when_it_ends() {
        let mut open = None;
        assert_eq!(observe(0, 1_000, &mut open), None);
        assert_eq!(observe(1_000, 1_100, &mut open), None);
        assert!(open.is_none());
        // Foreground stops beating at 1_000.
        assert_eq!(observe(1_000, 1_400, &mut open), None);
        assert_eq!(open, Some(1_000));
        assert_eq!(observe(1_000, 2_000, &mut open), None);
        // It beats again at 2_100: one stall of 1_100 ms.
        assert_eq!(observe(2_100, 2_150, &mut open), Some(1_100));
        assert_eq!(observe(2_200, 2_250, &mut open), None);
    }

    #[test]
    fn a_panicking_worker_reports_instead_of_unwinding() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("diagnostics/main-thread-stalls.jsonl");
        *LOG_OVERRIDE.lock().unwrap() = Some(log.clone());
        let (tx, rx) = std::sync::mpsc::channel();
        let handle = spawn_contained(
            "test-worker",
            || panic!("parse failed"),
            move |m| tx.send(m).unwrap(),
        );
        assert!(handle.join().is_ok());
        assert_eq!(rx.recv().unwrap(), "parse failed");
        let text = std::fs::read_to_string(&log).unwrap();
        assert!(text.contains("worker-panic"));
        *LOG_OVERRIDE.lock().unwrap() = None;
    }
}
