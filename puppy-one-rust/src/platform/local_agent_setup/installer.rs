//! Port of `managed-artifact-installer.mjs`, `activation-process.mjs` and
//! `managed-installation-layout.mjs`: a reviewed CLI archive installed under
//! `~/.puppyone/agent-runtimes/<id>/<version>`, then made `current`.
//!
//! - Only HTTPS from the recipe hosts, without redirects, at most 512 MiB,
//!   and only with the recipe's digest.
//! - The whole archive is validated before any member is written: one
//!   root, regular files and directories only, no traversal, links,
//!   duplicates or special names, at most 20 000 entries and 1.5 GiB.
//! - One installation per Agent across processes: the `install.lock`
//!   directory lease the Electron product's `proper-lockfile` uses
//!   (stale after 30s, renewed every 5s), so both apps share the layout.
//! - The receipt (`installation.json`) is written before the version
//!   directory appears; `current` is a symlink swapped atomically.
use super::{Algorithm, Recipe, activation::ErrorCode};
use std::{
    io::{Read, Write as _},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

mod archive;
pub use archive::extract;

const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;
const MAX_EXPANDED: u64 = 1536 * 1024 * 1024;
const HOSTS: [&str; 2] = ["registry.npmjs.org", "downloads.cursor.com"];

/// `managedInstallationRoot`: only the Agents with recipes.
pub fn managed_root(home: &Path, id: &str) -> Option<PathBuf> {
    entry_name(id).map(|_| home.join(".puppyone/agent-runtimes").join(id))
}
/// `managedInstallationCandidate`: the stable entry point discovery checks.
pub fn managed_entry(home: &Path, id: &str) -> Option<PathBuf> {
    Some(
        managed_root(home, id)?
            .join("current")
            .join(entry_name(id)?),
    )
}
fn entry_name(id: &str) -> Option<&'static str> {
    match id {
        "codex" => Some("codex"),
        "cursor" => Some("cursor-agent"),
        _ => None,
    }
}

/// Fetches `recipe`'s artifact into a new file, verified.
pub type Download = Arc<dyn Fn(&Recipe, &Path, &AtomicBool) -> Result<(), ErrorCode> + Send + Sync>;
/// Proves an unpacked entry point runs.
pub type Verify<'a> = &'a dyn Fn(&Path, &AtomicBool) -> Result<(), ErrorCode>;

pub struct Installer {
    pub home: PathBuf,
    pub download: Download,
}
impl Installer {
    pub fn new(home: PathBuf) -> Self {
        Self {
            home,
            download: Arc::new(download),
        }
    }
    /// `install`: returns `current/<entry>`. `committed` runs once
    /// `current` points at the version, even if a cancel won the race.
    pub fn install(
        &self,
        recipe: &Recipe,
        cancel: &AtomicBool,
        verify: Verify,
        committed: &dyn Fn(),
    ) -> Result<PathBuf, ErrorCode> {
        let root = managed_root(&self.home, recipe.setup_id).ok_or(ErrorCode::Unsupported)?;
        if !valid_version(recipe.version) || !relative_path(&recipe.binary) {
            return Err(ErrorCode::Unsupported);
        }
        std::fs::create_dir_all(&root).map_err(|_| ErrorCode::Installation)?;
        private(&root, 0o700);
        // No symlink anywhere on the way to the root.
        if std::fs::canonicalize(&root).ok() != std::path::absolute(&root).ok() {
            return Err(ErrorCode::Installation);
        }
        let lock = Lease::acquire(&root)?;
        with_installation_signal(cancel, &lock.compromised, |cancel| {
            let check = || {
                if cancel.load(Ordering::Relaxed) {
                    Err(ErrorCode::Interrupted)
                } else if lock.compromised.load(Ordering::Relaxed) {
                    Err(ErrorCode::InstallationBusy)
                } else {
                    Ok(())
                }
            };
            check()?;
            // Only the lease holder may remove a previous process's staging.
            for entry in std::fs::read_dir(&root)
                .map_err(|_| ErrorCode::Installation)?
                .flatten()
            {
                let name = entry.file_name().to_string_lossy().into_owned();
                let stale = name.strip_prefix(".staging-").is_some_and(|rest| {
                    !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric())
                });
                if stale
                    && let Ok(meta) = std::fs::symlink_metadata(entry.path())
                    && meta.is_dir()
                {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
            check()?;
            let target = root.join(recipe.version);
            let current = root.join("current");
            match std::fs::symlink_metadata(&target) {
                Ok(meta) => {
                    if !meta.is_dir() {
                        return Err(ErrorCode::Installation);
                    }
                    let receipt = target.join("installation.json");
                    let meta =
                        std::fs::symlink_metadata(&receipt).map_err(|_| ErrorCode::Integrity)?;
                    if !meta.is_file() || meta.len() > 4096 {
                        return Err(ErrorCode::Integrity);
                    }
                    let value: serde_json::Value = std::fs::read(&receipt)
                        .ok()
                        .and_then(|b| serde_json::from_slice(&b).ok())
                        .ok_or(ErrorCode::Integrity)?;
                    if value.get("digest").and_then(|v| v.as_str()) != Some(recipe.digest)
                        || value.get("version").and_then(|v| v.as_str()) != Some(recipe.version)
                    {
                        return Err(ErrorCode::Integrity);
                    }
                    verify(&target.join(recipe.entry), cancel)?;
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    let staging = tempfile::Builder::new()
                        .prefix(".staging-")
                        .tempdir_in(&root)
                        .map_err(|_| ErrorCode::Installation)?;
                    let archive = staging.path().join("artifact.tgz");
                    let payload = staging.path().join("payload");
                    std::fs::create_dir(&payload).map_err(|_| ErrorCode::Installation)?;
                    private(&payload, 0o700);
                    (self.download)(recipe, &archive, cancel)?;
                    check()?;
                    extract(&archive, &payload, cancel)?;
                    let binary = payload.join(&recipe.binary);
                    let meta =
                        std::fs::symlink_metadata(&binary).map_err(|_| ErrorCode::Archive)?;
                    if !meta.is_file() {
                        return Err(ErrorCode::Archive);
                    }
                    private(&binary, 0o755);
                    if recipe.binary != recipe.entry {
                        symlink(Path::new(&recipe.binary), &payload.join(recipe.entry))
                            .map_err(|_| ErrorCode::Installation)?;
                    }
                    verify(&payload.join(recipe.entry), cancel)?;
                    let receipt = serde_json::json!({
                        "version": recipe.version,
                        "digest": recipe.digest,
                        "source": recipe.url,
                    });
                    write_new(
                        &payload.join("installation.json"),
                        receipt.to_string().as_bytes(),
                        0o600,
                    )
                    .map_err(|_| ErrorCode::Installation)?;
                    check()?;
                    std::fs::rename(&payload, &target).map_err(|_| ErrorCode::Installation)?;
                }
                Err(_) => return Err(ErrorCode::Installation),
            }
            check()?;
            if let Ok(meta) = std::fs::symlink_metadata(&current)
                && !meta.file_type().is_symlink()
            {
                return Err(ErrorCode::Installation);
            }
            let pointer = root.join(format!(".current-{}", uuid::Uuid::new_v4()));
            symlink(Path::new(recipe.version), &pointer).map_err(|_| ErrorCode::Installation)?;
            if let Err(e) = check() {
                let _ = std::fs::remove_file(&pointer);
                return Err(e);
            }
            if std::fs::rename(&pointer, &current).is_err() {
                let _ = std::fs::remove_file(&pointer);
                return Err(ErrorCode::Installation);
            }
            committed();
            Ok(current.join(recipe.entry))
        })
    }
}

/// A verification process observes cancellation from both its activation and
/// the cross-process installation lease, including while it owns a pipe.
fn with_installation_signal<T>(
    requested: &AtomicBool,
    compromised: &AtomicBool,
    work: impl FnOnce(&AtomicBool) -> Result<T, ErrorCode>,
) -> Result<T, ErrorCode> {
    let combined =
        AtomicBool::new(requested.load(Ordering::Relaxed) || compromised.load(Ordering::Relaxed));
    let finished = AtomicBool::new(false);
    struct Stop<'a>(&'a AtomicBool);
    impl Drop for Stop<'_> {
        fn drop(&mut self) {
            self.0.store(true, Ordering::Relaxed);
        }
    }
    std::thread::scope(|scope| {
        let _stop = Stop(&finished);
        scope.spawn(|| {
            while !finished.load(Ordering::Relaxed) {
                if requested.load(Ordering::Relaxed) || compromised.load(Ordering::Relaxed) {
                    combined.store(true, Ordering::Relaxed);
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        let result = work(&combined);
        match result {
            Err(_) if requested.load(Ordering::Relaxed) => Err(ErrorCode::Interrupted),
            Err(_) if compromised.load(Ordering::Relaxed) => Err(ErrorCode::InstallationBusy),
            other => other,
        }
    })
}

/// `install.lock`, held as `proper-lockfile` holds it: a directory whose
/// modification time the holder renews.
struct Lease {
    path: PathBuf,
    stop: Arc<AtomicBool>,
    compromised: Arc<AtomicBool>,
    stamp: Arc<std::sync::Mutex<LeaseStamp>>,
}
#[derive(Clone, PartialEq, Eq)]
struct LeaseStamp {
    modified: std::time::SystemTime,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}
impl LeaseStamp {
    fn read(path: &Path) -> std::io::Result<Self> {
        let meta = std::fs::symlink_metadata(path)?;
        if !meta.is_dir() {
            return Err(std::io::ErrorKind::InvalidInput.into());
        }
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt as _;
        Ok(Self {
            modified: meta.modified()?,
            #[cfg(unix)]
            device: meta.dev(),
            #[cfg(unix)]
            inode: meta.ino(),
        })
    }
    fn matches(&self, path: &Path) -> bool {
        Self::read(path).ok().as_ref() == Some(self)
    }
    fn same_file(&self, other: &Self) -> bool {
        #[cfg(unix)]
        {
            self.device == other.device && self.inode == other.inode
        }
        #[cfg(not(unix))]
        {
            let _ = other;
            true
        }
    }
}
const LEASE_STALE: Duration = Duration::from_secs(30);
const LEASE_UPDATE: Duration = Duration::from_secs(5);
impl Lease {
    fn acquire(root: &Path) -> Result<Self, ErrorCode> {
        let path = root.join("install.lock");
        if std::fs::create_dir(&path).is_err() {
            let stale = LeaseStamp::read(&path)
                .map(|stamp| stamp.modified)
                .is_ok_and(|t| t.elapsed().unwrap_or_default() > LEASE_STALE);
            if !stale {
                return Err(ErrorCode::InstallationBusy);
            }
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir(&path).map_err(|_| ErrorCode::InstallationBusy)?;
        }
        let stamp = Arc::new(std::sync::Mutex::new(
            LeaseStamp::read(&path).map_err(|_| ErrorCode::InstallationBusy)?,
        ));
        let renewed_stamp = stamp.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let compromised = Arc::new(AtomicBool::new(false));
        let (renew, stopping, lost) = (path.clone(), stop.clone(), compromised.clone());
        std::thread::spawn(move || {
            let step = Duration::from_millis(100);
            let mut last = std::time::Instant::now();
            while !stopping.load(Ordering::Relaxed) {
                std::thread::sleep(step);
                if last.elapsed() >= LEASE_UPDATE {
                    last = std::time::Instant::now();
                    let mut stamp = renewed_stamp.lock().unwrap();
                    if !stamp.matches(&renew) || !touch(&renew) {
                        lost.store(true, Ordering::Relaxed);
                        break;
                    }
                    match LeaseStamp::read(&renew) {
                        Ok(next) if stamp.same_file(&next) => *stamp = next,
                        _ => {
                            lost.store(true, Ordering::Relaxed);
                            break;
                        }
                    }
                }
            }
        });
        Ok(Self {
            path,
            stop,
            compromised,
            stamp,
        })
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let stamp = self.stamp.lock().unwrap();
        if !self.compromised.load(Ordering::Relaxed) && stamp.matches(&self.path) {
            let _ = std::fs::remove_dir(&self.path);
        }
    }
}
fn touch(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt as _;
        let Ok(c) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
            return false;
        };
        // SAFETY: a valid C path; a null times pointer means "now".
        path.is_dir() && unsafe { libc::utimes(c.as_ptr(), std::ptr::null()) } == 0
    }
    #[cfg(not(unix))]
    path.is_dir()
}

fn artifact_client(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    builder
        .redirect_policy(reqwest::redirect::Policy::none())
        .https_only(true)
        .timeout(Duration::from_secs(10 * 60))
}

/// `downloadVerifiedArtifact`.
pub fn download(recipe: &Recipe, destination: &Path, cancel: &AtomicBool) -> Result<(), ErrorCode> {
    let url = allowed_url(&recipe.url).ok_or(ErrorCode::Integrity)?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| ErrorCode::Download)?;
    runtime.block_on(async {
        let client = artifact_client(crate::platform::proxy::system(reqwest::Client::builder()))
            .build()
            .map_err(|_| ErrorCode::Download)?;
        let response = cancellable(client.get(url).send(), cancel)
            .await?
            .map_err(|_| ErrorCode::Download)?;
        let metadata = ArtifactResponse {
            success: response.status().is_success(),
            length: response.content_length(),
        };
        save_artifact_body(
            recipe,
            destination,
            cancel,
            metadata,
            response.bytes_stream(),
            MAX_DOWNLOAD,
        )
        .await
    })
}
struct ArtifactResponse {
    success: bool,
    length: Option<u64>,
}
/// The production response body pipeline, with only transport and size policy
/// supplied separately so offline fixtures can drive real writes and digests.
async fn save_artifact_body<T: AsRef<[u8]>, E>(
    recipe: &Recipe,
    destination: &Path,
    cancel: &AtomicBool,
    response: ArtifactResponse,
    body: impl futures_util::Stream<Item = Result<T, E>>,
    max_bytes: u64,
) -> Result<(), ErrorCode> {
    use futures_util::StreamExt as _;
    if cancel.load(Ordering::Relaxed) {
        return Err(ErrorCode::Interrupted);
    }
    if !response.success || response.length.is_some_and(|n| n > max_bytes) {
        return Err(ErrorCode::Download);
    }
    let mut file = new_file(destination, 0o600).map_err(|_| ErrorCode::Download)?;
    let mut hasher = Hasher::new(recipe.algorithm);
    let mut bytes = 0u64;
    futures_util::pin_mut!(body);
    while let Some(chunk) = cancellable(body.next(), cancel).await? {
        let chunk = chunk.map_err(|_| ErrorCode::Download)?;
        let chunk = chunk.as_ref();
        bytes += chunk.len() as u64;
        if bytes > max_bytes {
            return Err(ErrorCode::Download);
        }
        hasher.update(chunk);
        file.write_all(chunk).map_err(|_| ErrorCode::Download)?;
    }
    file.sync_all().map_err(|_| ErrorCode::Download)?;
    if hasher.finish() != recipe.digest {
        return Err(ErrorCode::Integrity);
    }
    Ok(())
}
/// Waits for `future`, giving up within 100ms of a cancel.
async fn cancellable<F: std::future::Future>(
    future: F,
    cancel: &AtomicBool,
) -> Result<F::Output, ErrorCode> {
    if cancel.load(Ordering::Relaxed) {
        return Err(ErrorCode::Interrupted);
    }
    tokio::pin!(future);
    loop {
        tokio::select! {
            out = &mut future => return if cancel.load(Ordering::Relaxed) { Err(ErrorCode::Interrupted) } else { Ok(out) },
            _ = tokio::time::sleep(Duration::from_millis(100)) => {
                if cancel.load(Ordering::Relaxed) {
                    return Err(ErrorCode::Interrupted);
                }
            }
        }
    }
}
/// HTTPS to a recipe host, without credentials or an explicit port.
fn allowed_url(value: &str) -> Option<url::Url> {
    let url = url::Url::parse(value).ok()?;
    (url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.host_str().is_some_and(|h| HOSTS.contains(&h)))
    .then_some(url)
}
enum Hasher {
    Sha256(sha2::Sha256),
    Sha512(sha2::Sha512),
}
impl Hasher {
    fn new(algorithm: Algorithm) -> Self {
        use sha2::Digest as _;
        match algorithm {
            Algorithm::Sha256 => Self::Sha256(sha2::Sha256::new()),
            Algorithm::Sha512 => Self::Sha512(sha2::Sha512::new()),
        }
    }
    fn update(&mut self, bytes: &[u8]) {
        use sha2::Digest as _;
        match self {
            Self::Sha256(h) => h.update(bytes),
            Self::Sha512(h) => h.update(bytes),
        }
    }
    /// The digest, base64 (`hash.digest("base64")`).
    fn finish(self) -> String {
        use base64::Engine as _;
        use sha2::Digest as _;
        let bytes = match self {
            Self::Sha256(h) => h.finalize().to_vec(),
            Self::Sha512(h) => h.finalize().to_vec(),
        };
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }
}
/// The base64 digest of a file (tests and receipts).
#[cfg(test)]
pub fn file_digest(path: &Path, algorithm: Algorithm) -> String {
    let mut hasher = Hasher::new(algorithm);
    hasher.update(&std::fs::read(path).unwrap());
    hasher.finish()
}

/// `runActivationProcess(file, ["--version"])`: no shell, the home as the
/// working directory, a cleaned environment, 512 KiB of output and 20s.
pub fn verify_version(file: &Path, home: &Path, cancel: &AtomicBool) -> Result<(), ErrorCode> {
    run_version(
        file,
        home,
        cancel,
        Duration::from_secs(20),
        std::env::vars_os(),
    )
}
fn run_version(
    file: &Path,
    home: &Path,
    cancel: &AtomicBool,
    timeout: Duration,
    environment: impl IntoIterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
) -> Result<(), ErrorCode> {
    use std::process::{Command, Stdio};
    if cancel.load(Ordering::Relaxed) {
        return Err(ErrorCode::Interrupted);
    }
    if !file.is_absolute() {
        return Err(ErrorCode::Process);
    }
    let executable = std::fs::canonicalize(file).map_err(|_| ErrorCode::Installation)?;
    let mut command = Command::new(&executable);
    command
        .arg("--version")
        .current_dir(home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.env_clear().envs(
        environment
            .into_iter()
            .filter(|(key, _)| !unsafe_variable(&key.to_string_lossy())),
    );
    crate::platform::process::isolate(&mut command);
    let mut child = command.spawn().map_err(|_| ErrorCode::Process)?;
    let total = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let reader = |pipe: Option<Box<dyn Read + Send>>| {
        let total = total.clone();
        std::thread::spawn(move || {
            let mut out = Vec::new();
            let Some(mut pipe) = pipe else {
                return (out, false);
            };
            let mut buffer = [0u8; 8192];
            while let Ok(n) = pipe.read(&mut buffer) {
                if n == 0 {
                    break;
                }
                if total.fetch_add(n, Ordering::Relaxed) + n > 512 * 1024 {
                    return (out, true);
                }
                out.extend_from_slice(&buffer[..n]);
            }
            (out, false)
        })
    };
    let stdout = reader(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let stderr = reader(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let started = std::time::Instant::now();
    let mut exited = None;
    let status = loop {
        if cancel.load(Ordering::Relaxed) {
            crate::platform::process::terminate(&mut child);
            return Err(ErrorCode::Interrupted);
        }
        if total.load(Ordering::Relaxed) > 512 * 1024 {
            crate::platform::process::terminate(&mut child);
            return Err(ErrorCode::Process);
        }
        if started.elapsed() > timeout {
            crate::platform::process::terminate(&mut child);
            return Err(ErrorCode::Timeout);
        }
        if exited.is_none() {
            match child.try_wait() {
                Ok(status) => exited = status,
                Err(_) => {
                    crate::platform::process::terminate(&mut child);
                    return Err(ErrorCode::Process);
                }
            }
        }
        // A successful parent can leave descendants holding stdout/stderr.
        // Keep cancellation, output limits and the deadline alive until both
        // readers finish; joining a still-running reader would lose control.
        if stdout.is_finished()
            && stderr.is_finished()
            && let Some(status) = exited
        {
            break status;
        }
        std::thread::sleep(Duration::from_millis(15));
    };
    let (out, over_out) = stdout.join().map_err(|_| ErrorCode::Process)?;
    let (err, over_err) = stderr.join().map_err(|_| ErrorCode::Process)?;
    if over_out || over_err {
        return Err(ErrorCode::Process);
    }
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&out),
        String::from_utf8_lossy(&err)
    );
    if status.success() && !text.trim().is_empty() {
        Ok(())
    } else {
        Err(ErrorCode::Installation)
    }
}
/// `activationEnvironment`: variables that would inject code into the CLI.
fn unsafe_variable(key: &str) -> bool {
    let key = key.to_ascii_uppercase();
    matches!(
        key.as_str(),
        "NODE_OPTIONS"
            | "NODE_PATH"
            | "BUN_OPTIONS"
            | "ELECTRON_RUN_AS_NODE"
            | "LD_PRELOAD"
            | "LD_LIBRARY_PATH"
    ) || key.starts_with("DYLD_")
}

fn valid_version(version: &str) -> bool {
    let mut chars = version.chars();
    version.len() <= 120
        && chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}
/// `relativeEntry`.
fn relative_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() < 4096
        && !value.contains(['\\', '\0', '\r', '\n', ':'])
        && value
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != "..")
}
fn new_file(path: &Path, mode: u32) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(mode);
    }
    #[cfg(not(unix))]
    let _ = mode;
    options.open(path)
}
fn write_new(path: &Path, bytes: &[u8], mode: u32) -> std::io::Result<()> {
    let mut file = new_file(path, mode)?;
    file.write_all(bytes)?;
    file.sync_all()
}
fn private(path: &Path, mode: u32) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
    }
    #[cfg(not(unix))]
    let _ = (path, mode);
}
fn symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    return std::os::unix::fs::symlink(target, link);
    #[cfg(not(unix))]
    {
        let _ = (target, link);
        Err(std::io::ErrorKind::Unsupported.into())
    }
}

#[cfg(all(test, unix))]
mod tests;
