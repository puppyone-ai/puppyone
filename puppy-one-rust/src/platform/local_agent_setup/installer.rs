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
pub type Verify<'a> = &'a dyn Fn(&Path) -> Result<(), ErrorCode>;

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
                let meta = std::fs::symlink_metadata(&receipt).map_err(|_| ErrorCode::Integrity)?;
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
                verify(&target.join(recipe.entry))?;
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
                let meta = std::fs::symlink_metadata(&binary).map_err(|_| ErrorCode::Archive)?;
                if !meta.is_file() {
                    return Err(ErrorCode::Archive);
                }
                private(&binary, 0o755);
                if recipe.binary != recipe.entry {
                    symlink(Path::new(&recipe.binary), &payload.join(recipe.entry))
                        .map_err(|_| ErrorCode::Installation)?;
                }
                verify(&payload.join(recipe.entry))?;
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
    }
}

/// `install.lock`, held as `proper-lockfile` holds it: a directory whose
/// modification time the holder renews.
struct Lease {
    path: PathBuf,
    stop: Arc<AtomicBool>,
    compromised: Arc<AtomicBool>,
}
const LEASE_STALE: Duration = Duration::from_secs(30);
const LEASE_UPDATE: Duration = Duration::from_secs(5);
impl Lease {
    fn acquire(root: &Path) -> Result<Self, ErrorCode> {
        let path = root.join("install.lock");
        if std::fs::create_dir(&path).is_err() {
            let stale = std::fs::metadata(&path)
                .and_then(|m| m.modified())
                .is_ok_and(|t| t.elapsed().unwrap_or_default() > LEASE_STALE);
            if !stale {
                return Err(ErrorCode::InstallationBusy);
            }
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir(&path).map_err(|_| ErrorCode::InstallationBusy)?;
        }
        let stop = Arc::new(AtomicBool::new(false));
        let compromised = Arc::new(AtomicBool::new(false));
        let (renew, stopping, lost) = (path.clone(), stop.clone(), compromised.clone());
        std::thread::spawn(move || {
            let step = Duration::from_millis(100);
            let mut waited = Duration::ZERO;
            while !stopping.load(Ordering::Relaxed) {
                std::thread::sleep(step);
                waited += step;
                if waited >= LEASE_UPDATE {
                    waited = Duration::ZERO;
                    if !touch(&renew) {
                        lost.store(true, Ordering::Relaxed);
                        break;
                    }
                }
            }
        });
        Ok(Self {
            path,
            stop,
            compromised,
        })
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if !self.compromised.load(Ordering::Relaxed) {
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

/// `downloadVerifiedArtifact`.
pub fn download(recipe: &Recipe, destination: &Path, cancel: &AtomicBool) -> Result<(), ErrorCode> {
    let url = allowed_url(&recipe.url).ok_or(ErrorCode::Integrity)?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| ErrorCode::Download)?;
    let mut hasher = Hasher::new(recipe.algorithm);
    runtime.block_on(async {
        let client = reqwest::Client::builder()
            .redirect_policy(reqwest::redirect::Policy::none())
            .https_only(true)
            .timeout(Duration::from_secs(10 * 60))
            .build()
            .map_err(|_| ErrorCode::Download)?;
        let mut response = cancellable(client.get(url).send(), cancel)
            .await?
            .map_err(|_| ErrorCode::Download)?;
        if !response.status().is_success()
            || response.content_length().is_some_and(|n| n > MAX_DOWNLOAD)
        {
            return Err(ErrorCode::Download);
        }
        let mut file = new_file(destination, 0o600).map_err(|_| ErrorCode::Download)?;
        let mut bytes = 0u64;
        while let Some(chunk) = cancellable(response.chunk(), cancel)
            .await?
            .map_err(|_| ErrorCode::Download)?
        {
            bytes += chunk.len() as u64;
            if bytes > MAX_DOWNLOAD {
                return Err(ErrorCode::Download);
            }
            hasher.update(&chunk);
            file.write_all(&chunk).map_err(|_| ErrorCode::Download)?;
        }
        file.sync_all().map_err(|_| ErrorCode::Download)
    })?;
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
    tokio::pin!(future);
    loop {
        tokio::select! {
            out = &mut future => return Ok(out),
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

/// `extractActivationArchive`: validate every member, then write them under
/// `directory` without the archive's root (`strip: 1`).
pub fn extract(archive: &Path, directory: &Path, cancel: &AtomicBool) -> Result<(), ErrorCode> {
    let open = || -> Result<tar::Archive<flate2::read::GzDecoder<std::io::BufReader<std::fs::File>>>, ErrorCode> {
        let file = std::fs::File::open(archive).map_err(|_| ErrorCode::Archive)?;
        Ok(tar::Archive::new(flate2::read::GzDecoder::new(std::io::BufReader::new(file))))
    };
    let check = || {
        if cancel.load(Ordering::Relaxed) {
            Err(ErrorCode::Interrupted)
        } else {
            Ok(())
        }
    };
    // Pass one: the whole archive must be acceptable.
    let mut names = std::collections::HashSet::new();
    let (mut count, mut bytes, mut root) = (0usize, 0u64, None::<String>);
    let mut reader = open()?;
    for entry in reader.entries().map_err(|_| ErrorCode::Archive)? {
        check()?;
        let entry = entry.map_err(|_| ErrorCode::Archive)?;
        let kind = entry.header().entry_type();
        if kind == tar::EntryType::XGlobalHeader {
            continue;
        }
        let name =
            String::from_utf8(entry.path_bytes().into_owned()).map_err(|_| ErrorCode::Archive)?;
        let name = name.trim_end_matches('/').to_owned();
        let parts: Vec<&str> = name.split('/').collect();
        let first = parts[0].to_owned();
        let root = root.get_or_insert_with(|| first.clone());
        count += 1;
        bytes += entry.size();
        let directory_entry = kind == tar::EntryType::Directory;
        if count > 20_000
            || bytes > MAX_EXPANDED
            || name.len() > 4096
            || name.contains(['\\', '\0', '\r', '\n', ':'])
            || parts
                .iter()
                .any(|p| p.is_empty() || *p == "." || *p == "..")
            || !(kind == tar::EntryType::Regular || directory_entry)
            || !names.insert(name.clone())
            || first != *root
            || (parts.len() == 1 && !directory_entry)
        {
            return Err(ErrorCode::Archive);
        }
    }
    if count == 0 {
        return Err(ErrorCode::Archive);
    }
    check()?;
    // Pass two: write what was validated.
    let mut reader = open()?;
    for entry in reader.entries().map_err(|_| ErrorCode::Archive)? {
        check()?;
        let mut entry = entry.map_err(|_| ErrorCode::Archive)?;
        let kind = entry.header().entry_type();
        if kind == tar::EntryType::XGlobalHeader {
            continue;
        }
        let name =
            String::from_utf8(entry.path_bytes().into_owned()).map_err(|_| ErrorCode::Archive)?;
        let relative: Vec<&str> = name.trim_end_matches('/').split('/').skip(1).collect();
        if relative.is_empty() {
            continue;
        }
        let path = relative
            .iter()
            .fold(directory.to_path_buf(), |p, part| p.join(part));
        if kind == tar::EntryType::Directory {
            std::fs::create_dir_all(&path).map_err(|_| ErrorCode::Archive)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| ErrorCode::Archive)?;
        }
        // The member's mode under the usual 022 umask.
        let mode = entry.header().mode().unwrap_or(0o644) & 0o755;
        let mut file = new_file(&path, mode).map_err(|_| ErrorCode::Archive)?;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let n = entry.read(&mut buffer).map_err(|_| ErrorCode::Archive)?;
            if n == 0 {
                break;
            }
            file.write_all(&buffer[..n])
                .map_err(|_| ErrorCode::Archive)?;
        }
        private(&path, mode);
    }
    Ok(())
}

/// `runActivationProcess(file, ["--version"])`: no shell, the home as the
/// working directory, a cleaned environment, 512 KiB of output and 20s.
pub fn verify_version(file: &Path, home: &Path, cancel: &AtomicBool) -> Result<(), ErrorCode> {
    use std::process::{Command, Stdio};
    let executable = std::fs::canonicalize(file).map_err(|_| ErrorCode::Installation)?;
    let mut command = Command::new(&executable);
    command
        .arg("--version")
        .current_dir(home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, _) in std::env::vars_os() {
        if unsafe_variable(&key.to_string_lossy()) {
            command.env_remove(key);
        }
    }
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
    let status = loop {
        if cancel.load(Ordering::Relaxed) {
            crate::platform::process::terminate(&mut child);
            return Err(ErrorCode::Interrupted);
        }
        if total.load(Ordering::Relaxed) > 512 * 1024 {
            crate::platform::process::terminate(&mut child);
            return Err(ErrorCode::Process);
        }
        if started.elapsed() > Duration::from_secs(20) {
            crate::platform::process::terminate(&mut child);
            return Err(ErrorCode::Timeout);
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(Duration::from_millis(15)),
            Err(_) => {
                crate::platform::process::terminate(&mut child);
                return Err(ErrorCode::Process);
            }
        }
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
mod tests {
    use super::*;
    use core::prelude::v1::test;
    /// A gzip tarball of `(path, contents, mode)`; `None` contents is a directory.
    fn archive(path: &Path, entries: &[(&str, Option<&str>, u32)]) {
        let file = std::fs::File::create(path).unwrap();
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
            file,
            flate2::Compression::fast(),
        ));
        for (name, contents, mode) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_mode(*mode);
            // Raw name bytes: `set_path` refuses the hostile names under test.
            let raw = &mut header.as_gnu_mut().unwrap().name;
            raw[..name.len()].copy_from_slice(name.as_bytes());
            let data = contents.unwrap_or("");
            header.set_entry_type(if contents.is_some() {
                tar::EntryType::Regular
            } else {
                tar::EntryType::Directory
            });
            header.set_size(data.len() as u64);
            header.set_cksum();
            builder.append(&header, data.as_bytes()).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap();
    }
    fn recipe(archive: &Path) -> Recipe {
        Recipe {
            setup_id: "codex",
            version: "1.2.3",
            entry: "codex",
            binary: "vendor/bin/codex".into(),
            url: "https://registry.npmjs.org/codex.tgz".into(),
            algorithm: Algorithm::Sha512,
            digest: Box::leak(file_digest(archive, Algorithm::Sha512).into_boxed_str()),
        }
    }
    fn installer(home: &Path, source: PathBuf) -> Installer {
        Installer {
            home: home.into(),
            download: Arc::new(move |_, destination, _| {
                std::fs::copy(&source, destination)
                    .map(|_| ())
                    .map_err(|_| ErrorCode::Download)
            }),
        }
    }
    #[test]
    fn a_verified_archive_becomes_the_current_installation() {
        let dir = tempfile::tempdir().unwrap();
        let home = std::fs::canonicalize(dir.path()).unwrap();
        let source = home.join("codex.tgz");
        archive(
            &source,
            &[
                ("package/", None, 0o755),
                ("package/vendor/", None, 0o755),
                ("package/vendor/bin/", None, 0o755),
                (
                    "package/vendor/bin/codex",
                    Some("#!/bin/sh\necho codex 1.2.3\n"),
                    0o644,
                ),
                ("package/README.md", Some("readme"), 0o644),
            ],
        );
        let recipe = recipe(&source);
        let installer = installer(&home, source.clone());
        let cancel = AtomicBool::new(false);
        let verified = std::cell::RefCell::new(vec![]);
        let verify = |p: &Path| {
            verified.borrow_mut().push(p.to_path_buf());
            verify_version(p, &home, &AtomicBool::new(false))
        };
        let commits = std::cell::Cell::new(0);
        let entry = installer
            .install(&recipe, &cancel, &verify, &|| {
                commits.set(commits.get() + 1)
            })
            .unwrap();
        let root = home.join(".puppyone/agent-runtimes/codex");
        assert_eq!(entry, root.join("current/codex"));
        assert_eq!(managed_entry(&home, "codex"), Some(entry.clone()));
        assert_eq!(
            std::fs::read_link(root.join("current")).unwrap(),
            PathBuf::from("1.2.3")
        );
        assert_eq!(
            std::fs::read_link(root.join("1.2.3/codex")).unwrap(),
            PathBuf::from("vendor/bin/codex")
        );
        let receipt: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("1.2.3/installation.json")).unwrap())
                .unwrap();
        assert_eq!(receipt["digest"], recipe.digest);
        assert_eq!(commits.get(), 1);
        assert!(!root.join("install.lock").exists());
        // No staging is left behind; a second run reuses the version.
        let names: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert_eq!(names.len(), 2, "{names:?}");
        installer
            .install(&recipe, &cancel, &verify, &|| {
                commits.set(commits.get() + 1)
            })
            .unwrap();
        assert_eq!(verified.borrow().len(), 2);
        assert_eq!(commits.get(), 2);
        // A receipt for another artifact is not trusted.
        let other = Recipe {
            digest: "AAAA",
            ..recipe.clone()
        };
        assert_eq!(
            installer.install(&other, &cancel, &verify, &|| {}),
            Err(ErrorCode::Integrity)
        );
        // Another installation holds the lease.
        std::fs::create_dir(root.join("install.lock")).unwrap();
        assert_eq!(
            installer.install(&recipe, &cancel, &verify, &|| {}),
            Err(ErrorCode::InstallationBusy)
        );
    }
    #[test]
    fn unsafe_archives_are_rejected_before_anything_is_written() {
        let dir = tempfile::tempdir().unwrap();
        let cases: [&[(&str, Option<&str>, u32)]; 4] = [
            &[
                ("package/", None, 0o755),
                ("package/../evil", Some("x"), 0o644),
            ],
            &[
                ("package/a", Some("x"), 0o644),
                ("other/b", Some("x"), 0o644),
            ],
            &[("file-at-root", Some("x"), 0o644)],
            &[
                ("package/a", Some("x"), 0o644),
                ("package/a", Some("y"), 0o644),
            ],
        ];
        for (i, entries) in cases.iter().enumerate() {
            let path = dir.path().join(format!("{i}.tgz"));
            archive(&path, entries);
            let out = dir.path().join(format!("out-{i}"));
            std::fs::create_dir(&out).unwrap();
            assert_eq!(
                extract(&path, &out, &AtomicBool::new(false)),
                Err(ErrorCode::Archive),
                "case {i}"
            );
            assert_eq!(std::fs::read_dir(&out).unwrap().count(), 0, "case {i}");
        }
        // A symlink member.
        let path = dir.path().join("link.tgz");
        let file = std::fs::File::create(&path).unwrap();
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
            file,
            flate2::Compression::fast(),
        ));
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        builder
            .append_link(&mut header, "package/link", "/etc/passwd")
            .unwrap();
        builder.into_inner().unwrap().finish().unwrap();
        assert_eq!(
            extract(&path, dir.path(), &AtomicBool::new(false)),
            Err(ErrorCode::Archive)
        );
        // Cancelled work stops.
        let ok = dir.path().join("ok.tgz");
        archive(&ok, &[("package/a", Some("x"), 0o644)]);
        assert_eq!(
            extract(&ok, dir.path(), &AtomicBool::new(true)),
            Err(ErrorCode::Interrupted)
        );
    }
    #[test]
    fn only_reviewed_https_hosts_and_safe_processes_are_used() {
        assert!(allowed_url("https://registry.npmjs.org/@openai/codex/-/codex.tgz").is_some());
        assert!(allowed_url("http://registry.npmjs.org/x").is_none());
        assert!(allowed_url("https://registry.npmjs.org:8443/x").is_none());
        assert!(allowed_url("https://user@downloads.cursor.com/x").is_none());
        assert!(allowed_url("https://example.com/x").is_none());
        assert!(unsafe_variable("DYLD_INSERT_LIBRARIES") && unsafe_variable("node_options"));
        assert!(!unsafe_variable("PATH"));
        let dir = tempfile::tempdir().unwrap();
        let script = |name: &str, body: &str| {
            let path = dir.path().join(name);
            std::fs::write(&path, body).unwrap();
            private(&path, 0o755);
            path
        };
        let silent = script("silent", "#!/bin/sh\nexit 0\n");
        assert_eq!(
            verify_version(&silent, dir.path(), &AtomicBool::new(false)),
            Err(ErrorCode::Installation)
        );
        let fails = script("fails", "#!/bin/sh\necho no >&2\nexit 3\n");
        assert_eq!(
            verify_version(&fails, dir.path(), &AtomicBool::new(false)),
            Err(ErrorCode::Installation)
        );
        let ok = script("ok", "#!/bin/sh\necho \"v1 $NODE_OPTIONS\"\n");
        assert_eq!(
            verify_version(&ok, dir.path(), &AtomicBool::new(false)),
            Ok(())
        );
        assert!(managed_root(dir.path(), "claude").is_none());
    }
    #[test]
    fn the_product_installer_refuses_unreviewed_sources_without_a_request() {
        let dir = tempfile::tempdir().unwrap();
        let home = std::fs::canonicalize(dir.path()).unwrap();
        let installer = Installer::new(home.clone());
        let recipe = Recipe {
            setup_id: "codex",
            version: "1.0.0",
            entry: "codex",
            binary: "codex".into(),
            url: "https://example.com/codex.tgz".into(),
            algorithm: Algorithm::Sha256,
            digest: "AAAA",
        };
        let cancel = AtomicBool::new(false);
        let never = |_: &Path| -> Result<(), ErrorCode> { panic!("nothing to verify") };
        assert_eq!(
            installer.install(&recipe, &cancel, &never, &|| {}),
            Err(ErrorCode::Integrity)
        );
        assert_eq!(
            download(&recipe, &home.join("a.tgz"), &cancel),
            Err(ErrorCode::Integrity)
        );
        assert!(!home.join("a.tgz").exists());
        let guided = Recipe {
            setup_id: "claude",
            ..recipe
        };
        assert_eq!(
            installer.install(&guided, &cancel, &never, &|| {}),
            Err(ErrorCode::Unsupported)
        );
    }
}
