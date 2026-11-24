//! `cloud-git-operation-lease.mjs`: a lease across processes over the
//! repository's whole Cloud Git saga (not just its journal writes). Git
//! remotes and repository credential config live in the common Git
//! directory, so linked worktrees contend on the same lease. A live owner
//! PID always owns it, even past its expiry (machine sleep, a long stall); a
//! dead owner's lease is reclaimed at once; expiry only recovers residue
//! without an owner. A second process therefore fails fast instead of
//! interleaving with the first.
use super::{Code, PublishError};
use serde_json::{Value, json};
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime};

pub const FILENAME: &str = "cloud-git-operation.lease.json";
const VERSION: u64 = 1;
/// `LEASE_DURATION_MS`.
const DURATION: Duration = Duration::from_secs(30);
/// `HEARTBEAT_INTERVAL_MS`.
const HEARTBEAT: Duration = Duration::from_secs(5);
/// `TAKEOVER_LOCK_TIMEOUT_MS`, `TAKEOVER_LOCK_RETRY_MS`, `TAKEOVER_LOCK_STALE_MS`.
const TAKEOVER_TIMEOUT: Duration = Duration::from_secs(5);
const TAKEOVER_RETRY: Duration = Duration::from_millis(10);
const TAKEOVER_STALE: Duration = Duration::from_secs(30);

/// Sees each lease a contender reads before it takes one over (tests).
pub type Observer = dyn Fn(&Value) + Send + Sync;

/// The clock and the liveness check a lease decides by (tests replace them),
/// and an observer of each lease read before a takeover.
#[derive(Clone)]
pub struct Options {
    pub now: Arc<dyn Fn() -> SystemTime + Send + Sync>,
    pub alive: Arc<dyn Fn(u32) -> bool + Send + Sync>,
    pub observed: Option<Arc<Observer>>,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            now: Arc::new(SystemTime::now),
            alive: Arc::new(crate::platform::process::is_alive),
            observed: None,
        }
    }
}

/// A held lease; dropping it releases it.
pub struct Lease {
    path: PathBuf,
    takeover: PathBuf,
    token: String,
    options: Options,
    stop: Arc<(Mutex<bool>, Condvar)>,
    heartbeat: Option<JoinHandle<()>>,
}
impl Lease {
    pub fn token(&self) -> &str {
        &self.token
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        let (stopped, wake) = &*self.stop;
        *stopped.lock().unwrap_or_else(|p| p.into_inner()) = true;
        wake.notify_all();
        if let Some(heartbeat) = self.heartbeat.take() {
            let _ = heartbeat.join();
        }
        let _ = with_takeover(&self.takeover, &self.options, || {
            if read(&self.path)
                .ok()
                .flatten()
                .is_some_and(|lease| lease["owner_token"] == self.token.as_str())
            {
                let _ = fs::remove_file(&self.path);
            }
            Ok(())
        });
    }
}

fn busy(message: &str) -> PublishError {
    PublishError::new(Code::JournalIoFailed, message, true)
}
fn unsafe_lease(message: &str) -> PublishError {
    PublishError::new(Code::JournalIoFailed, message, false)
}

/// `acquire`: the lease of the repository whose common Git directory is
/// `common_dir`, or `JOURNAL_IO_FAILED` (retryable) while another live
/// process holds it.
pub fn acquire(common_dir: &Path, options: &Options) -> Result<Lease, PublishError> {
    let directory = common_dir.join("puppyone");
    safe_directory(&directory)?;
    let path = directory.join(FILENAME);
    let takeover = directory.join(format!("{FILENAME}.takeover"));
    let token = uuid::Uuid::new_v4().to_string();
    if !claim(&path, &takeover, &token, options)? {
        return Err(busy(
            "Another Desktop process is already updating this worktree's Cloud Git operation.",
        ));
    }
    let stop = Arc::new((Mutex::new(false), Condvar::new()));
    let heartbeat = {
        let (path, token, options, stop) =
            (path.clone(), token.clone(), options.clone(), stop.clone());
        std::thread::Builder::new()
            .name("cloud-git-lease".into())
            .spawn(move || {
                let (stopped, wake) = &*stop;
                let mut done = stopped.lock().unwrap_or_else(|p| p.into_inner());
                while !*done {
                    done = wake
                        .wait_timeout(done, HEARTBEAT)
                        .unwrap_or_else(|p| p.into_inner())
                        .0;
                    if !*done {
                        refresh(&path, &token, &options);
                    }
                }
            })
            .ok()
    };
    Ok(Lease {
        path,
        takeover,
        token,
        options: options.clone(),
        stop,
        heartbeat,
    })
}

fn envelope(token: &str, options: &Options) -> Value {
    let now = (options.now)();
    json!({
        "version": VERSION,
        "owner_token": token,
        "pid": std::process::id(),
        "heartbeat_at": iso(now),
        "expires_at": iso(now + DURATION),
    })
}

/// `tryClaimLease`.
fn claim(
    path: &Path,
    takeover: &Path,
    token: &str,
    options: &Options,
) -> Result<bool, PublishError> {
    let lease = envelope(token, options);
    if create(path, &lease)? {
        return Ok(true);
    }
    let metadata = fs::symlink_metadata(path).ok();
    if metadata
        .as_ref()
        .is_some_and(|m| m.file_type().is_symlink() || !m.is_file())
    {
        return Err(unsafe_lease("Cloud Git operation lease is unsafe."));
    }
    let current = read(path).ok().flatten();
    if let (Some(observed), Some(current)) = (&options.observed, &current) {
        observed(current);
    }
    let owner = owner(current.as_ref());
    if owner.is_some_and(|pid| (options.alive)(pid)) {
        return Ok(false);
    }
    // Expiry only recovers residue without an owner: a live PID always
    // owns the lease.
    if owner.is_none() && !expired(current.as_ref(), metadata.as_ref(), options) {
        return Ok(false);
    }
    with_takeover(takeover, options, || {
        let Ok(latest) = fs::symlink_metadata(path) else {
            return create(path, &lease);
        };
        if latest.file_type().is_symlink() || !latest.is_file() {
            return Err(unsafe_lease("Cloud Git operation lease is unsafe."));
        }
        let current = read(path).ok().flatten();
        if !reclaimable(current.as_ref(), Some(&latest), options) {
            return Ok(false);
        }
        let _ = fs::remove_file(path);
        create(path, &lease)
    })
}

/// Creates the lease file when absent; `Ok(false)` when it exists.
fn create(path: &Path, lease: &Value) -> Result<bool, PublishError> {
    let mut file = match crate::platform::fs::open_private_create_new(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return Ok(false),
        Err(_) => return Err(busy("Unable to create the Cloud Git operation lease.")),
    };
    file.write_all(format!("{lease}\n").as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|_| busy("Unable to write the Cloud Git operation lease."))?;
    Ok(true)
}

fn owner(lease: Option<&Value>) -> Option<u32> {
    lease?["pid"]
        .as_u64()
        .filter(|pid| *pid > 0)
        .and_then(|pid| u32::try_from(pid).ok())
}

fn expired(lease: Option<&Value>, metadata: Option<&fs::Metadata>, options: &Options) -> bool {
    let now = (options.now)();
    match lease
        .and_then(|l| l["expires_at"].as_str())
        .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
    {
        Some(expiry) => now >= SystemTime::from(expiry),
        None => metadata
            .and_then(|m| m.modified().ok())
            .is_some_and(|modified| now.duration_since(modified).unwrap_or_default() >= DURATION),
    }
}

/// `isLeaseReclaimable`: a dead owner's lease, or residue past its expiry.
fn reclaimable(lease: Option<&Value>, metadata: Option<&fs::Metadata>, options: &Options) -> bool {
    match owner(lease) {
        Some(pid) => !(options.alive)(pid),
        None => expired(lease, metadata, options),
    }
}

/// `withTakeoverLock`: one reclaimer at a time.
fn with_takeover<T>(
    takeover: &Path,
    options: &Options,
    operation: impl FnOnce() -> Result<T, PublishError>,
) -> Result<T, PublishError> {
    let token = uuid::Uuid::new_v4().to_string();
    let lock = json!({"owner_token": token, "pid": std::process::id()});
    let started = (options.now)();
    loop {
        if create(takeover, &lock)? {
            break;
        }
        let holder = read_takeover(takeover);
        let live = owner(holder.as_ref()).is_some_and(|pid| (options.alive)(pid));
        let stale = fs::symlink_metadata(takeover)
            .and_then(|m| m.modified())
            .is_ok_and(|modified| {
                (options.now)().duration_since(modified).unwrap_or_default() >= TAKEOVER_STALE
            });
        if !live && stale {
            let _ = fs::remove_file(takeover);
            continue;
        }
        if (options.now)().duration_since(started).unwrap_or_default() >= TAKEOVER_TIMEOUT {
            return Err(busy("Cloud Git operation takeover is busy."));
        }
        std::thread::sleep(TAKEOVER_RETRY);
    }
    let result = operation();
    if read_takeover(takeover).is_some_and(|holder| holder["owner_token"] == token.as_str()) {
        let _ = fs::remove_file(takeover);
    }
    result
}

fn read_takeover(path: &Path) -> Option<Value> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > 4096 {
        return None;
    }
    let value: Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    (value["owner_token"].is_string() && value["pid"].is_u64()).then_some(value)
}

/// `readLease`: the lease, `None` when it is not one, an error when the
/// file is not safe to trust.
fn read(path: &Path) -> Result<Option<Value>, PublishError> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| busy("Unable to read the Cloud Git lease."))?;
    let private = crate::platform::fs::is_private_metadata(&metadata);
    if !metadata.is_file() || metadata.len() > 16 * 1024 || !private {
        return Err(unsafe_lease("Cloud Git operation lease is unsafe."));
    }
    let value: Value = fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null);
    Ok(
        (value["version"] == VERSION && value["owner_token"].is_string() && value["pid"].is_u64())
            .then_some(value),
    )
}

/// `refreshLease`: the owner's heartbeat moves the expiry forward.
fn refresh(path: &Path, token: &str, options: &Options) {
    let Some(mut lease) = read(path).ok().flatten() else {
        return;
    };
    if lease["owner_token"] != token {
        return;
    }
    let now = (options.now)();
    lease["heartbeat_at"] = json!(iso(now));
    lease["expires_at"] = json!(iso(now + DURATION));
    if let Ok(mut file) = OpenOptions::new().write(true).truncate(true).open(path) {
        let _ = file
            .write_all(format!("{lease}\n").as_bytes())
            .and_then(|_| file.sync_all());
    }
}

/// `ensureSafeLeaseDirectory`.
fn safe_directory(directory: &Path) -> Result<(), PublishError> {
    crate::platform::fs::create_private_dir_all(directory)
        .map_err(|_| busy("Unable to create the Cloud Git lease directory."))?;
    let metadata = fs::symlink_metadata(directory)
        .map_err(|_| busy("Unable to read the Cloud Git lease directory."))?;
    if !metadata.is_dir() {
        return Err(unsafe_lease(
            "Cloud Git operation lease directory is unsafe.",
        ));
    }
    Ok(())
}

fn iso(at: SystemTime) -> String {
    chrono::DateTime::<chrono::Utc>::from(at).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn git(cwd: &Path, args: &[&str]) -> String {
        let out = std::process::Command::new("git")
            .args(args)
            .current_dir(cwd)
            .env("LC_ALL", "C")
            .output()
            .unwrap();
        assert!(out.status.success(), "{args:?}");
        String::from_utf8(out.stdout).unwrap().trim().to_owned()
    }

    /// A repository and a linked worktree of it: their common Git directory.
    struct Linked {
        _root: tempfile::TempDir,
        _linked: tempfile::TempDir,
        common: PathBuf,
        linked_common: PathBuf,
    }
    fn linked() -> Linked {
        let root = tempfile::tempdir().unwrap();
        let linked = tempfile::tempdir().unwrap();
        let worktree = linked.path().join("linked");
        git(root.path(), &["init", "-q"]);
        std::fs::write(root.path().join("README.md"), "lease\n").unwrap();
        git(root.path(), &["add", "README.md"]);
        git(
            root.path(),
            &[
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@example.test",
                "commit",
                "-qm",
                "initial",
            ],
        );
        git(
            root.path(),
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "lease-linked",
                worktree.to_str().unwrap(),
            ],
        );
        let common = |cwd: &Path| {
            cwd.join(git(cwd, &["rev-parse", "--git-common-dir"]))
                .canonicalize()
                .unwrap()
        };
        Linked {
            common: common(root.path()),
            linked_common: common(&worktree),
            _root: root,
            _linked: linked,
        }
    }
    fn dead_lease(common: &Path) -> PathBuf {
        let directory = common.join("puppyone");
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(FILENAME);
        let now = SystemTime::now();
        let lease = json!({
            "version": 1, "owner_token": "dead-owner", "pid": 999_999,
            "heartbeat_at": iso(now), "expires_at": iso(now + Duration::from_secs(60)),
        });
        assert!(create(&path, &lease).unwrap());
        path
    }
    fn owner_of(path: &Path) -> Value {
        read(path).unwrap().unwrap()
    }

    /// `serializes linked worktrees through the shared Git commonDir`.
    #[test]
    fn linked_worktrees_contend_on_the_common_directory() {
        let fixture = linked();
        assert_eq!(fixture.common, fixture.linked_common);
        let options = Options::default();
        let held = acquire(&fixture.common, &options).unwrap();
        let refused = acquire(&fixture.linked_common, &options).err().unwrap();
        assert_eq!(
            (refused.code, refused.retryable),
            (Code::JournalIoFailed, true)
        );
        let path = fixture.common.join("puppyone").join(FILENAME);
        assert_eq!(owner_of(&path)["pid"], std::process::id());
        drop(held);
        assert!(!path.exists(), "released");
        drop(acquire(&fixture.linked_common, &options).unwrap());
    }

    /// `never steals an expired lease while its owner PID is alive`.
    #[test]
    fn a_live_owner_keeps_its_lease_past_its_expiry() {
        let fixture = linked();
        let clock = Arc::new(Mutex::new(SystemTime::now()));
        let now = clock.clone();
        let options = Options {
            now: Arc::new(move || *now.lock().unwrap()),
            alive: Arc::new(|_| true),
            observed: None,
        };
        let held = acquire(&fixture.common, &options).unwrap();
        *clock.lock().unwrap() += Duration::from_secs(24 * 60 * 60);
        let refused = acquire(&fixture.linked_common, &options).err().unwrap();
        assert_eq!(refused.code, Code::JournalIoFailed);
        drop(held);
    }

    /// `reclaims a lease owned by a dead PID even before its timestamp
    /// expires`.
    #[test]
    fn a_dead_owners_lease_is_reclaimed_before_its_expiry() {
        let fixture = linked();
        let path = dead_lease(&fixture.common);
        let options = Options {
            alive: Arc::new(|_| false),
            ..Options::default()
        };
        let held = acquire(&fixture.linked_common, &options).unwrap();
        let owner = owner_of(&path);
        assert_eq!(owner["pid"], std::process::id());
        assert_eq!(owner["owner_token"], held.token());
    }

    /// `serializes two contenders that both observed the same dead lease`:
    /// both read the dead owner's lease before either reclaims it; one
    /// takes it over, the other is refused.
    #[test]
    fn two_contenders_for_one_dead_lease_are_serialized() {
        let fixture = linked();
        let path = dead_lease(&fixture.common);
        let both = Arc::new(std::sync::Barrier::new(2));
        let options = Options {
            alive: Arc::new(|pid| pid == std::process::id()),
            observed: Some(Arc::new(move |lease| {
                if lease["owner_token"] == "dead-owner" {
                    both.wait();
                }
            })),
            ..Options::default()
        };
        let contenders = [fixture.common.clone(), fixture.linked_common.clone()].map(|common| {
            let options = options.clone();
            std::thread::spawn(move || acquire(&common, &options))
        });
        let results: Vec<_> = contenders.into_iter().map(|c| c.join().unwrap()).collect();
        let (held, refused): (Vec<_>, Vec<_>) = results.into_iter().partition(Result::is_ok);
        assert_eq!((held.len(), refused.len()), (1, 1));
        let refused = refused.into_iter().next().unwrap().err().unwrap();
        assert_eq!(refused.code, Code::JournalIoFailed);
        let held = held.into_iter().next().unwrap().unwrap();
        assert_eq!(owner_of(&path)["owner_token"], held.token());
    }
}
