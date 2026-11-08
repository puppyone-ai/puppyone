//! The host's file service (`host-file-service.mjs`): a root-closed service
//! for one registered folder at a time. Every call loads the folder's
//! current registration; a transport-supplied root is never accepted. It
//! is deliberately not a shell, Git or general file bridge.
//!
//! The folder is opened as a capability (`cap_std::fs::Dir`), so no path,
//! symbolic link or swapped directory can reach outside it, and every
//! segment is checked to be a real directory or file: links and the Git
//! metadata are refused, a missing name is "not found" only when its parent
//! is inside the folder.
use super::protocol::{
    Capability, Entry, Kind, MAX_DIRECTORY_ENTRIES, MAX_FILE_BYTES, Request, relative_path,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use cap_std::{ambient_authority, fs::Dir};
use serde_json::{Value, json};
use sha2::Digest;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, UNIX_EPOCH},
};

/// Writes go through a temporary name the listing never shows.
pub const TEMP_PREFIX: &str = ".puppyone-write-";
const MAX_EVENT_PATHS: usize = 256;
const COALESCE: Duration = Duration::from_millis(100);

/// One folder as the host registered it now.
#[derive(Clone, Debug, PartialEq)]
pub struct Grant {
    pub root: PathBuf,
    pub active: bool,
    pub capabilities: Vec<Capability>,
}
/// The host's registry: `None` for a folder it does not serve.
pub trait Folders: Send + Sync {
    fn resolve(&self, folder: &str) -> Option<Grant>;
}

pub type Outcome = Result<Value, &'static str>;

/// `revision`: lowercase sha256 hex of the bytes.
pub fn revision(bytes: &[u8]) -> String {
    sha2::Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn code(error: &std::io::Error) -> &'static str {
    use std::io::ErrorKind::*;
    match error.kind() {
        NotFound | NotADirectory => "not_found",
        AlreadyExists => "already_exists",
        DirectoryNotEmpty => "not_empty",
        // cap-std's refusal of a path that leads out of the folder.
        PermissionDenied if error.to_string().contains("outside") => "invalid_path",
        _ => "file_operation_failed",
    }
}
fn io(error: std::io::Error) -> &'static str {
    code(&error)
}
fn split(name: &str) -> (&str, &str) {
    match name.rfind('/') {
        Some(slash) => (&name[..slash], &name[slash + 1..]),
        None => ("", name),
    }
}
fn at(name: &str) -> &Path {
    if name.is_empty() {
        Path::new(".")
    } else {
        Path::new(name)
    }
}
fn modified_ns(metadata: &cap_std::fs::Metadata) -> String {
    metadata
        .modified()
        .ok()
        .and_then(|m| m.into_std().duration_since(UNIX_EPOCH).ok())
        .map_or_else(|| "0".into(), |d| d.as_nanos().to_string())
}
fn describe(name: &str, metadata: &cap_std::fs::Metadata) -> Entry {
    Entry {
        name: name.to_owned(),
        kind: if metadata.is_dir() {
            Kind::Directory
        } else {
            Kind::File
        },
        size: metadata.len(),
        modified_ns: modified_ns(metadata),
    }
}
/// `decodeContent`: standard base64, canonical, at most the file limit.
fn decode(content: &str) -> Result<Vec<u8>, &'static str> {
    if content.len() > (MAX_FILE_BYTES as usize).div_ceil(3) * 4 + 4 {
        return Err("invalid_content");
    }
    let bytes = STANDARD.decode(content).map_err(|_| "invalid_content")?;
    if bytes.len() as u64 > MAX_FILE_BYTES || STANDARD.encode(&bytes) != content {
        return Err("invalid_content");
    }
    Ok(bytes)
}

pub struct FileService {
    folders: Arc<dyn Folders>,
    /// One write, move or remove of a name at a time.
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}
impl FileService {
    pub fn new(folders: Arc<dyn Folders>) -> Self {
        Self {
            folders,
            locks: Mutex::default(),
        }
    }
    fn lock(&self, key: String) -> Arc<Mutex<()>> {
        self.locks.lock().unwrap().entry(key).or_default().clone()
    }
    /// The folder, admitted for `capability` and still at its registered
    /// place.
    fn admit(&self, folder: &str, capability: Capability) -> Result<Dir, &'static str> {
        let grant = self.folders.resolve(folder).ok_or("folder_unavailable")?;
        if !grant.active || !grant.capabilities.contains(&capability) {
            return Err("folder_unavailable");
        }
        let canonical = grant.root.canonicalize().map_err(|_| "root_changed")?;
        if canonical != grant.root {
            return Err("root_changed");
        }
        Dir::open_ambient_dir(&canonical, ambient_authority()).map_err(|_| "root_changed")
    }
    /// An existing name: every segment a real directory, the last a real
    /// file or directory, none a link.
    fn entry(dir: &Dir, name: &str) -> Result<cap_std::fs::Metadata, &'static str> {
        if name.is_empty() {
            return dir.symlink_metadata(".").map_err(io);
        }
        let segments: Vec<&str> = name.split('/').collect();
        let mut prefix = String::new();
        for (index, segment) in segments.iter().enumerate() {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(segment);
            let metadata = dir.symlink_metadata(&prefix).map_err(io)?;
            let last = index + 1 == segments.len();
            if metadata.file_type().is_symlink() {
                return Err("invalid_path");
            }
            if !last && !metadata.is_dir() {
                return Err("not_found");
            }
            if last {
                if !(metadata.is_file() || metadata.is_dir()) {
                    return Err("unsupported_file");
                }
                return Ok(metadata);
            }
        }
        Err("invalid_path")
    }
    /// A name to create: its parent exists inside the folder as a directory.
    fn new_entry(dir: &Dir, name: &str) -> Result<(), &'static str> {
        let (parent, _) = split(name);
        let metadata = Self::entry(dir, parent)?;
        if !metadata.is_dir() {
            return Err("not_found");
        }
        Ok(())
    }
    /// `readBounded`: the bytes of a file that did not change while read.
    fn read_bytes(dir: &Dir, name: &str) -> Result<(Vec<u8>, cap_std::fs::Metadata), &'static str> {
        let before = Self::entry(dir, name)?;
        if !before.is_file() || before.len() > MAX_FILE_BYTES {
            return Err("unsupported_file");
        }
        let mut file = dir.open(name).map_err(io)?;
        let mut bytes = Vec::with_capacity(before.len() as usize);
        Read::by_ref(&mut file)
            .take(MAX_FILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(io)?;
        let after = file.metadata().map_err(io)?;
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err("unsupported_file");
        }
        if before.len() != after.len() || modified_ns(&before) != modified_ns(&after) {
            return Err("conflict");
        }
        Ok((bytes, after))
    }

    /// `runHostFileOperation`: one request for `folder`. Unknown actions
    /// fail closed (they do not parse).
    pub fn run(&self, folder: &str, request: &Request) -> Outcome {
        match request {
            Request::List { path } => self.list(folder, path),
            Request::Read { path } => self.read(folder, path),
            Request::Write {
                path,
                content_base64,
                expected_revision,
            } => match expected_revision {
                None => Err("revision_required"),
                Some(expected) => self.write(folder, path, content_base64, expected.as_deref()),
            },
            Request::Mkdir { path } => self.mkdir(folder, path),
            Request::Move { path, destination } => self.move_entry(folder, path, destination),
            Request::Remove { path } => self.remove(folder, path),
            // Git is the host's Git service's, never the file service's.
            Request::Git(_) => Err("folder_unavailable"),
        }
    }
    /// The folder's root, while it is shared with `capability`.
    pub fn root(&self, folder: &str, capability: Capability) -> Result<PathBuf, &'static str> {
        self.admit(folder, capability)?;
        let grant = self.folders.resolve(folder).ok_or("folder_unavailable")?;
        grant.root.canonicalize().map_err(|_| "root_changed")
    }
    pub fn list(&self, folder: &str, requested: &str) -> Outcome {
        let dir = self.admit(folder, Capability::Read)?;
        let name = relative_path(requested, true)?;
        if !Self::entry(&dir, &name)?.is_dir() {
            return Err("not_found");
        }
        let mut entries = Vec::new();
        for (count, item) in dir.read_dir(at(&name)).map_err(io)?.enumerate() {
            if count >= MAX_DIRECTORY_ENTRIES {
                return Err("too_many_entries");
            }
            let item = item.map_err(io)?;
            let child = item.file_name().to_string_lossy().into_owned();
            if child.eq_ignore_ascii_case(".git") || child.starts_with(TEMP_PREFIX) {
                continue;
            }
            let path = if name.is_empty() {
                child.clone()
            } else {
                format!("{name}/{child}")
            };
            let Ok(metadata) = dir.symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() || !(metadata.is_file() || metadata.is_dir()) {
                continue;
            }
            entries.push(describe(&child, &metadata));
        }
        // Directories first, then by code point (the same on every host).
        entries.sort_by(|a, b| {
            (a.kind == Kind::File, a.name.as_bytes())
                .cmp(&(b.kind == Kind::File, b.name.as_bytes()))
        });
        Ok(json!({ "entries": entries }))
    }
    pub fn read(&self, folder: &str, requested: &str) -> Outcome {
        let dir = self.admit(folder, Capability::Read)?;
        let name = relative_path(requested, false)?;
        let (bytes, metadata) = Self::read_bytes(&dir, &name)?;
        let mut value = serde_json::to_value(describe(split(&name).1, &metadata))
            .map_err(|_| "file_operation_failed")?;
        value["content_base64"] = json!(STANDARD.encode(&bytes));
        value["revision"] = json!(revision(&bytes));
        Ok(value)
    }
    pub fn write(
        &self,
        folder: &str,
        requested: &str,
        content: &str,
        expected: Option<&str>,
    ) -> Outcome {
        let dir = self.admit(folder, Capability::Write)?;
        let name = relative_path(requested, false)?;
        let bytes = decode(content)?;
        if expected.is_some_and(|r| {
            r.len() != 64
                || !r
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        }) {
            return Err("revision_required");
        }
        let lock = self.lock(format!("{folder}:{name}"));
        let _held = lock.lock().unwrap();
        match expected {
            None => Self::new_entry(&dir, &name)?,
            Some(expected) => {
                let metadata = Self::entry(&dir, &name)?;
                if !metadata.is_file() {
                    return Err("unsupported_file");
                }
                use cap_std::fs::MetadataExt;
                if metadata.nlink() != 1 {
                    return Err("unsupported_file");
                }
                if revision(&Self::read_bytes(&dir, &name)?.0) != expected {
                    return Err("conflict");
                }
            }
        }
        let (parent, _) = split(&name);
        let temp = if parent.is_empty() {
            format!("{TEMP_PREFIX}{}", uuid::Uuid::new_v4())
        } else {
            format!("{parent}/{TEMP_PREFIX}{}", uuid::Uuid::new_v4())
        };
        let result = (|| -> Outcome {
            let mut file = dir
                .open_with(
                    &temp,
                    cap_std::fs::OpenOptions::new().write(true).create_new(true),
                )
                .map_err(io)?;
            file.write_all(&bytes).map_err(io)?;
            file.sync_all().map_err(io)?;
            drop(file);
            match expected {
                // No-clobber creation: a link fails if anything appeared.
                None => dir
                    .hard_link(&temp, &dir, &name)
                    .map_err(|e| match code(&e) {
                        "already_exists" => "conflict",
                        other => other,
                    })?,
                // The person on the host may edit too: never overwrite that.
                Some(expected) => {
                    if revision(&Self::read_bytes(&dir, &name)?.0) != expected {
                        return Err("conflict");
                    }
                    dir.rename(&temp, &dir, &name).map_err(io)?;
                }
            }
            Ok(json!({ "revision": revision(&bytes), "size": bytes.len() }))
        })();
        let _ = dir.remove_file(&temp);
        result
    }
    pub fn mkdir(&self, folder: &str, requested: &str) -> Outcome {
        let dir = self.admit(folder, Capability::Write)?;
        let name = relative_path(requested, false)?;
        Self::new_entry(&dir, &name)?;
        dir.create_dir(&name).map_err(io)?;
        Ok(json!({}))
    }
    pub fn move_entry(&self, folder: &str, requested: &str, destination: &str) -> Outcome {
        let dir = self.admit(folder, Capability::Write)?;
        let from = relative_path(requested, false)?;
        let to = relative_path(destination, false)?;
        if to == from || to.starts_with(&format!("{from}/")) {
            return Err("invalid_path");
        }
        let lock = self.lock(format!("{folder}:{from}"));
        let _held = lock.lock().unwrap();
        let source = Self::entry(&dir, &from)?;
        Self::new_entry(&dir, &to)?;
        if source.is_file() {
            // A hard link refuses an existing target: a move never overwrites.
            dir.hard_link(&from, &dir, &to).map_err(io)?;
            dir.remove_file(&from).map_err(io)?;
        } else {
            if dir.symlink_metadata(&to).is_ok() {
                return Err("already_exists");
            }
            dir.rename(&from, &dir, &to).map_err(io)?;
        }
        Ok(json!({}))
    }
    pub fn remove(&self, folder: &str, requested: &str) -> Outcome {
        let dir = self.admit(folder, Capability::Write)?;
        let name = relative_path(requested, false)?;
        let lock = self.lock(format!("{folder}:{name}"));
        let _held = lock.lock().unwrap();
        let metadata = Self::entry(&dir, &name)?;
        if metadata.is_dir() {
            let mut budget = MAX_DIRECTORY_ENTRIES;
            count(&dir, &name, &mut budget)?;
            dir.remove_dir_all(&name).map_err(io)?;
        } else {
            dir.remove_file(&name).map_err(io)?;
        }
        Ok(json!({}))
    }

    /// Coalesced change notifications for one folder: `{paths, reset}`, a
    /// reset first and whenever too much changed at once. Ends when the
    /// returned watch is dropped.
    pub fn watch(
        &self,
        folder: &str,
        on_event: impl Fn(Vec<String>, bool) + Send + 'static,
    ) -> Result<Watch, &'static str> {
        use notify::Watcher;
        let grant = self.folders.resolve(folder).ok_or("folder_unavailable")?;
        self.admit(folder, Capability::Read)?;
        let root = grant.root;
        let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
        let events = tx.clone();
        let base = root.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| match event {
                Ok(event) => {
                    for path in event.paths {
                        let relative = path
                            .strip_prefix(&base)
                            .map(|p| p.to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/"))
                            .ok();
                        let _ = events.send(relative);
                    }
                }
                Err(_) => {
                    let _ = events.send(None);
                }
            })
            .map_err(|_| "file_operation_failed")?;
        watcher
            .watch(&root, notify::RecursiveMode::Recursive)
            .map_err(|_| "file_operation_failed")?;
        on_event(Vec::new(), true);
        std::thread::Builder::new()
            .name("puppyone-host-watch".into())
            .spawn(move || {
                while let Ok(first) = rx.recv() {
                    let mut changed: Vec<String> = Vec::new();
                    let mut reset = false;
                    let mut take = |relative: Option<String>| match relative {
                        None => reset = true,
                        Some(name) => {
                            let parts: Vec<&str> = name.split('/').collect();
                            if parts.iter().any(|p| p.eq_ignore_ascii_case(".git"))
                                || parts.last().is_some_and(|p| p.starts_with(TEMP_PREFIX))
                            {
                                return;
                            }
                            if name.is_empty() || changed.len() >= MAX_EVENT_PATHS {
                                reset = true;
                            } else if !changed.contains(&name) {
                                changed.push(name);
                            }
                        }
                    };
                    take(first);
                    let deadline = std::time::Instant::now() + COALESCE;
                    while let Ok(next) = rx
                        .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                    {
                        take(next);
                    }
                    if reset {
                        on_event(Vec::new(), true);
                    } else if !changed.is_empty() {
                        on_event(changed, false);
                    }
                }
            })
            .map_err(|_| "file_operation_failed")?;
        Ok(Watch {
            _watcher: Box::new(watcher),
            _stop: tx,
        })
    }
}
/// A running watch; dropping it ends it.
pub struct Watch {
    _watcher: Box<dyn notify::Watcher + Send>,
    _stop: std::sync::mpsc::Sender<Option<String>>,
}
/// Counts the entries a recursive remove would take, within `budget`.
fn count(dir: &Dir, name: &str, budget: &mut usize) -> Result<(), &'static str> {
    for item in dir.read_dir(name).map_err(io)? {
        let item = item.map_err(io)?;
        *budget = budget.checked_sub(1).ok_or("too_many_entries")?;
        let child = format!("{name}/{}", item.file_name().to_string_lossy());
        let metadata = dir.symlink_metadata(&child).map_err(io)?;
        if metadata.is_dir() {
            count(dir, &child, budget)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    struct One(Grant);
    impl Folders for One {
        fn resolve(&self, folder: &str) -> Option<Grant> {
            (folder == "f").then(|| self.0.clone())
        }
    }
    fn service(root: &Path, capabilities: Vec<Capability>) -> FileService {
        FileService::new(Arc::new(One(Grant {
            root: root.canonicalize().unwrap(),
            active: true,
            capabilities,
        })))
    }

    /// `conformance`: the contract's fifteen cases, each in a folder of its
    /// own beside an `outside.md` the folder must never reach.
    #[test]
    fn the_host_file_service_meets_the_protocols_conformance_cases() {
        let contract: Value = serde_json::from_str(super::super::protocol::CONTRACT).unwrap();
        let cases = contract["conformance"].as_array().unwrap();
        assert_eq!(cases.len(), 15);
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let temp = tempfile::tempdir().unwrap();
            std::fs::write(temp.path().join("outside.md"), "outside").unwrap();
            let root = temp.path().join("folder");
            std::fs::create_dir(&root).unwrap();
            for (path, body) in case["files"].as_object().into_iter().flatten() {
                let path = root.join(path);
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(path, body.as_str().unwrap()).unwrap();
            }
            for (path, target) in case["symlinks"].as_object().into_iter().flatten() {
                std::os::unix::fs::symlink(target.as_str().unwrap(), root.join(path)).unwrap();
            }
            let files = service(&root, vec![Capability::Read, Capability::Write]);
            let request: Request = serde_json::from_value(case["request"].clone()).unwrap();
            let outcome = files.run("f", &request);
            match case.get("error") {
                Some(error) => assert_eq!(outcome, Err(error.as_str().unwrap()), "{name}"),
                None => {
                    let result = outcome.unwrap_or_else(|e| panic!("{name}: {e}"));
                    for (key, expected) in case["expect"].as_object().unwrap() {
                        if key == "entries" {
                            let got: Vec<(Value, Value)> = result["entries"]
                                .as_array()
                                .unwrap()
                                .iter()
                                .map(|e| (e["name"].clone(), e["kind"].clone()))
                                .collect();
                            let want: Vec<(Value, Value)> = expected
                                .as_array()
                                .unwrap()
                                .iter()
                                .map(|e| (e["name"].clone(), e["kind"].clone()))
                                .collect();
                            assert_eq!(got, want, "{name}");
                        } else {
                            assert_eq!(&result[key], expected, "{name}: {key}");
                        }
                    }
                }
            }
            for (path, body) in case["after"].as_object().into_iter().flatten() {
                assert_eq!(
                    std::fs::read_to_string(root.join(path)).unwrap(),
                    body.as_str().unwrap(),
                    "{name}: {path}"
                );
            }
            for path in case["absent"].as_array().into_iter().flatten() {
                assert!(!root.join(path.as_str().unwrap()).exists(), "{name}");
            }
            // Nothing outside the folder ever changes.
            assert_eq!(
                std::fs::read_to_string(temp.path().join("outside.md")).unwrap(),
                "outside",
                "{name}"
            );
            // No temporary file is left behind.
            assert!(
                std::fs::read_dir(&root)
                    .unwrap()
                    .flatten()
                    .all(|e| !e.file_name().to_string_lossy().starts_with(TEMP_PREFIX)),
                "{name}"
            );
        }
    }

    #[test]
    fn a_folder_is_served_only_as_granted() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("a.md"), "a").unwrap();
        let reader = service(temp.path(), vec![Capability::Read]);
        assert!(
            reader
                .run(
                    "f",
                    &Request::Read {
                        path: "a.md".into()
                    }
                )
                .is_ok()
        );
        assert_eq!(
            reader.run("f", &Request::Mkdir { path: "b".into() }),
            Err("folder_unavailable")
        );
        assert_eq!(
            reader.run(
                "other",
                &Request::List {
                    path: String::new()
                }
            ),
            Err("folder_unavailable")
        );
        // A write must say what it replaces, or that it creates.
        let writer = service(temp.path(), vec![Capability::Read, Capability::Write]);
        assert_eq!(
            writer.run(
                "f",
                &Request::Write {
                    path: "a.md".into(),
                    content_base64: "YQ==".into(),
                    expected_revision: None
                }
            ),
            Err("revision_required")
        );
        assert_eq!(
            writer.write("f", "a.md", "not base64!", Some(&revision(b"a"))),
            Err("invalid_content")
        );
        // A folder moved away from its registration is not served.
        let moved = FileService::new(Arc::new(One(Grant {
            root: temp.path().join("gone"),
            active: true,
            capabilities: vec![Capability::Read],
        })));
        assert_eq!(moved.list("f", ""), Err("root_changed"));
    }

    #[test]
    fn a_watch_reports_changes_coalesced() {
        let temp = tempfile::tempdir().unwrap();
        let files = service(temp.path(), vec![Capability::Read]);
        let (tx, rx) = std::sync::mpsc::channel();
        let _watch = files
            .watch("f", move |paths, reset| {
                let _ = tx.send((paths, reset));
            })
            .unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            (vec![], true)
        );
        std::thread::sleep(Duration::from_millis(300));
        std::fs::write(temp.path().join("new.md"), "x").unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            let (paths, reset) = rx
                .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                .expect("a change");
            if reset || paths.iter().any(|p| p == "new.md") {
                break;
            }
        }
    }
}
