//! Reference ingestion and authorization: `agent-reference-authorization.mjs`,
//! `infrastructure/attachments/agent-attachment-store.mjs` and the limits of
//! `agent-reference-policy.mjs`.
//!
//! - A file or folder inside the conversation's workspace is a *live*
//!   reference: it is checked again (still there, still inside the
//!   workspace after resolving links, same kind, within the limits) and read
//!   again for every turn.
//! - A file from elsewhere is copied once into this process's private
//!   staging directory (0700, files 0600) with its SHA-256 digest; the turn
//!   reads that snapshot, never the original. A snapshot belongs to one
//!   conversation, expires 30 minutes after it was last used, and is removed
//!   when its reference is removed or the conversation closes. Staging
//!   directories of processes that exited are swept.
//! - The same workspace path, or the same name, type, size and digest, is
//!   referenced once. At most 32 references and 25 MB in total.
use crate::agent::domain::reference_input::{Origin, Reference, ReferenceContent};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::{
    collections::HashMap,
    io::{Read, Write as _},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

/// `agentContractLimits`.
pub const MAX_REFERENCES: usize = 32;
pub const MAX_REFERENCE_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_TOTAL_REFERENCE_BYTES: u64 = 25 * 1024 * 1024;
/// Native runtimes inline text references; larger text is refused.
const TEXT_LIMIT: usize = 1024 * 1024;
/// `DEFAULT_TTL_MS`.
pub const TTL: Duration = Duration::from_secs(30 * 60);

/// Stages `paths` for the conversation `owner` in `workspace`, skipping
/// those already in `existing`.
pub fn stage(
    paths: Vec<PathBuf>,
    workspace: Option<&Path>,
    owner: &str,
    existing: &[Reference],
) -> Result<Vec<Reference>, String> {
    stage_in(Store::global(), paths, workspace, owner, existing)
}
fn stage_in(
    store: &Store,
    paths: Vec<PathBuf>,
    workspace: Option<&Path>,
    owner: &str,
    existing: &[Reference],
) -> Result<Vec<Reference>, String> {
    if paths.is_empty() || paths.len() > MAX_REFERENCES {
        return Err("Choose at most 32 references".into());
    }
    let root = workspace.and_then(|w| std::fs::canonicalize(w).ok());
    let mut out: Vec<Reference> = Vec::new();
    let mut created: Vec<PathBuf> = Vec::new();
    let result = (|| {
        for path in paths {
            let canonical = std::fs::canonicalize(&path)
                .map_err(|_| "An Agent file reference no longer exists.".to_owned())?;
            let name = canonical
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let inside = root.as_ref().is_some_and(|r| canonical.starts_with(r));
            let reference = if inside {
                let duplicate = |r: &Reference| matches!(&r.origin, Origin::Workspace { path, .. } if *path == canonical);
                if existing.iter().chain(&out).any(duplicate) {
                    continue;
                }
                let folder = canonical.is_dir();
                let (content, bytes) = materialize(&canonical, &name)?;
                Reference {
                    id: uuid::Uuid::new_v4().to_string(),
                    name,
                    source: canonical.to_string_lossy().into_owned(),
                    content,
                    bytes,
                    origin: Origin::Workspace {
                        path: canonical,
                        folder,
                    },
                }
            } else {
                // `stageOne`: only regular files, never through a link.
                let meta = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
                if !meta.is_file() {
                    return Err("Only regular, non-symbolic-link files can be attached.".to_owned());
                }
                let staged = store.stage(owner, &canonical)?;
                if staged.created {
                    created.push(staged.snapshot.clone());
                }
                let origin = Origin::Staged {
                    snapshot: staged.snapshot.clone(),
                    digest: staged.digest.clone(),
                };
                if existing.iter().chain(&out).any(|r| r.origin == origin) {
                    continue;
                }
                let (content, bytes) = materialize(&staged.snapshot, &name)?;
                Reference {
                    id: uuid::Uuid::new_v4().to_string(),
                    name,
                    source: canonical.to_string_lossy().into_owned(),
                    content,
                    bytes,
                    origin,
                }
            };
            out.push(reference);
        }
        within_limits(existing.iter().chain(&out))?;
        Ok(())
    })();
    match result {
        Ok(()) => Ok(out),
        Err(error) => {
            store.remove(&created);
            Err(error)
        }
    }
}

/// `authorizeAgentReferences` for one turn: workspace references are
/// checked and read again; snapshots must still match their digest.
pub fn authorize(references: &mut [Reference], workspace: Option<&Path>) -> Result<(), String> {
    authorize_in(Store::global(), references, workspace)
}
fn authorize_in(
    store: &Store,
    references: &mut [Reference],
    workspace: Option<&Path>,
) -> Result<(), String> {
    let root = workspace.and_then(|w| std::fs::canonicalize(w).ok());
    for reference in references.iter_mut() {
        match reference.origin.clone() {
            Origin::Snapshot => {}
            Origin::Workspace { path, folder } => {
                let canonical = std::fs::canonicalize(&path)
                    .map_err(|_| "An Agent file reference no longer exists.".to_owned())?;
                if !root.as_ref().is_some_and(|r| canonical.starts_with(r)) {
                    return Err(
                        "Agent file references must stay inside the assigned workspace.".into(),
                    );
                }
                if canonical.is_dir() != folder {
                    return Err("An Agent workspace reference changed type.".into());
                }
                let (content, bytes) = materialize(&canonical, &reference.name)?;
                reference.content = content;
                reference.bytes = bytes;
            }
            Origin::Staged { snapshot, digest } => {
                store.verify(&snapshot, &digest)?;
                let (content, bytes) = materialize(&snapshot, &reference.name)?;
                reference.content = content;
                reference.bytes = bytes;
            }
        }
    }
    within_limits(references.iter())
}

/// `revoke`: the staged snapshots of references that left the draft.
pub fn revoke(references: &[Reference]) {
    Store::global().remove(&snapshots(references));
}
/// `revokeOwner`: a closed conversation's snapshots.
pub fn revoke_owner(owner: &str) {
    Store::global().remove_owner(owner);
}
fn snapshots(references: &[Reference]) -> Vec<PathBuf> {
    references
        .iter()
        .filter_map(|r| match &r.origin {
            Origin::Staged { snapshot, .. } => Some(snapshot.clone()),
            _ => None,
        })
        .collect()
}

fn within_limits<'a>(references: impl Iterator<Item = &'a Reference>) -> Result<(), String> {
    let (count, bytes) = references.fold((0usize, 0u64), |(n, b), r| (n + 1, b + r.bytes as u64));
    if count > MAX_REFERENCES {
        return Err("Agent file references exceed the 32-file safety limit.".into());
    }
    if bytes > MAX_TOTAL_REFERENCE_BYTES {
        return Err("Agent file references exceed the 25 MB total safety limit.".into());
    }
    Ok(())
}

/// The content a runtime receives: a folder listing, an image, or UTF-8 text.
fn materialize(path: &Path, name: &str) -> Result<(ReferenceContent, usize), String> {
    if path.is_dir() {
        let mut names = std::fs::read_dir(path)
            .map_err(|e| e.to_string())?
            .take(201)
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        names.sort();
        let truncated = names.len() > 200;
        names.truncate(200);
        let text = format!(
            "Directory {}\n{}{}",
            path.display(),
            names.join("\n"),
            if truncated {
                "\n[More entries omitted]"
            } else {
                ""
            }
        );
        let bytes = text.len();
        return Ok((ReferenceContent::Text(text), bytes));
    }
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Agent workspace references must be regular files or directories.".into());
    }
    if metadata.len() > MAX_REFERENCE_BYTES {
        return Err("An Agent file reference exceeds the 25 MB safety limit.".into());
    }
    let mut data = Vec::new();
    Read::by_ref(&mut file)
        .take(MAX_REFERENCE_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    let bytes = data.len();
    if bytes as u64 > MAX_REFERENCE_BYTES || bytes as u64 != metadata.len() {
        return Err("An Agent file reference changed while it was being authorized.".into());
    }
    let content = match image_mime(&data) {
        Some(mime) => ReferenceContent::Image {
            mime: mime.into(),
            data: STANDARD.encode(data),
        },
        None => {
            if bytes > TEXT_LIMIT {
                return Err(format!("{name}: text references are limited to 1 MiB"));
            }
            let text = String::from_utf8(data)
                .map_err(|_| format!("{name}: this runtime accepts UTF-8 text and images"))?;
            if text.contains('\0') {
                return Err(format!("{name}: binary files are not accepted"));
            }
            ReferenceContent::Text(text)
        }
    };
    Ok((content, bytes))
}
fn image_mime(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if data.starts_with(&[255, 216, 255]) {
        Some("image/jpeg")
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if data.len() > 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// `createAgentAttachmentStore`: process-scoped immutable snapshots.
pub struct Store {
    root: PathBuf,
    directory: PathBuf,
    entries: Mutex<HashMap<PathBuf, Entry>>,
    ttl: Duration,
}
#[derive(Clone)]
struct Entry {
    owner: String,
    name: String,
    size: u64,
    digest: String,
    expires: Instant,
}
struct Staged {
    snapshot: PathBuf,
    digest: String,
    created: bool,
}
impl Store {
    fn global() -> &'static Store {
        static STORE: OnceLock<Store> = OnceLock::new();
        STORE.get_or_init(|| {
            #[cfg(test)]
            let root = std::env::temp_dir().join(format!(
                "puppyone-agent-attachments-test-{}",
                std::process::id()
            ));
            #[cfg(not(test))]
            let root = crate::platform::data_dir().join("agent-attachments");
            Store::new(root, TTL)
        })
    }
    fn new(root: PathBuf, ttl: Duration) -> Self {
        let directory = root.join(format!("{}-{}", std::process::id(), uuid::Uuid::new_v4()));
        let store = Self {
            root,
            directory,
            entries: Mutex::default(),
            ttl,
        };
        store.sweep_orphans();
        store
    }
    fn ensure_directory(&self) -> Result<(), String> {
        for dir in [&self.root, &self.directory] {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            private(dir, 0o700);
        }
        Ok(())
    }
    /// `stageOne`: copy, hash, and reuse an identical snapshot of the owner.
    fn stage(&self, owner: &str, source: &Path) -> Result<Staged, String> {
        use sha2::Digest as _;
        self.sweep_expired();
        self.ensure_directory()?;
        let mut input = std::fs::File::open(source)
            .map_err(|_| "The selected attachment changed before it could be staged.".to_owned())?;
        let before = input.metadata().map_err(|e| e.to_string())?;
        if !before.is_file() {
            return Err("Only regular files can be attached.".into());
        }
        if before.len() > MAX_REFERENCE_BYTES {
            return Err("An attachment exceeds the 25 MB safety limit.".into());
        }
        let snapshot = self
            .directory
            .join(format!("{}.snapshot", uuid::Uuid::new_v4()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        let copy = (|| -> Result<(String, u64), String> {
            let mut output = options.open(&snapshot).map_err(|e| e.to_string())?;
            let mut hash = sha2::Sha256::new();
            let mut buffer = vec![0u8; 64 * 1024];
            let mut size = 0u64;
            loop {
                let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                size += n as u64;
                if size > MAX_REFERENCE_BYTES {
                    return Err("An attachment exceeds the 25 MB safety limit.".into());
                }
                hash.update(&buffer[..n]);
                output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
            }
            output.sync_all().map_err(|e| e.to_string())?;
            if size != before.len() {
                return Err("The selected attachment changed while it was being staged.".into());
            }
            let digest: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
            Ok((digest, size))
        })();
        let (digest, size) = match copy {
            Ok(value) => value,
            Err(error) => {
                let _ = std::fs::remove_file(&snapshot);
                return Err(error);
            }
        };
        let name = source
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let mut entries = self.entries.lock().unwrap();
        if let Some((existing, entry)) = entries.iter_mut().find(|(_, e)| {
            e.owner == owner && e.name == name && e.size == size && e.digest == digest
        }) {
            entry.expires = Instant::now() + self.ttl;
            let existing = existing.clone();
            drop(entries);
            let _ = std::fs::remove_file(&snapshot);
            return Ok(Staged {
                snapshot: existing,
                digest,
                created: false,
            });
        }
        entries.insert(
            snapshot.clone(),
            Entry {
                owner: owner.into(),
                name,
                size,
                digest: digest.clone(),
                expires: Instant::now() + self.ttl,
            },
        );
        Ok(Staged {
            snapshot,
            digest,
            created: true,
        })
    }
    /// `authorize`: the snapshot is still granted, unexpired and unchanged;
    /// using it renews its lifetime.
    fn verify(&self, snapshot: &Path, digest: &str) -> Result<(), String> {
        use sha2::Digest as _;
        self.sweep_expired();
        let mut entries = self.entries.lock().unwrap();
        let Some(entry) = entries.get_mut(snapshot) else {
            return Err("An attachment grant expired. Add the file again.".into());
        };
        let bytes = std::fs::read(snapshot).ok();
        let actual: Option<String> = bytes.as_ref().map(|b| {
            sha2::Sha256::digest(b)
                .iter()
                .map(|x| format!("{x:02x}"))
                .collect()
        });
        if entry.digest != digest || actual.as_deref() != Some(digest) {
            entries.remove(snapshot);
            drop(entries);
            let _ = std::fs::remove_file(snapshot);
            return Err("A staged attachment is no longer available.".into());
        }
        entry.expires = Instant::now() + self.ttl;
        Ok(())
    }
    fn remove(&self, snapshots: &[PathBuf]) {
        let mut entries = self.entries.lock().unwrap();
        for snapshot in snapshots {
            if entries.remove(snapshot).is_some() {
                let _ = std::fs::remove_file(snapshot);
            }
        }
    }
    fn remove_owner(&self, owner: &str) {
        let owned: Vec<PathBuf> = self
            .entries
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, e)| e.owner == owner)
            .map(|(p, _)| p.clone())
            .collect();
        self.remove(&owned);
    }
    fn sweep_expired(&self) {
        let now = Instant::now();
        let expired: Vec<PathBuf> = self
            .entries
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, e)| e.expires <= now)
            .map(|(p, _)| p.clone())
            .collect();
        self.remove(&expired);
    }
    /// `sweepOrphanDirectories`: staging of processes that are gone.
    fn sweep_orphans(&self) {
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(pid) = name.split('-').next().and_then(|p| p.parse::<u32>().ok()) else {
                continue;
            };
            let path = entry.path();
            let directory = std::fs::symlink_metadata(&path).is_ok_and(|m| m.is_dir());
            if directory && path != self.directory && !alive(pid) {
                let _ = std::fs::remove_dir_all(path);
            }
        }
    }
}
fn alive(pid: u32) -> bool {
    if pid == std::process::id() {
        return true;
    }
    #[cfg(unix)]
    // SAFETY: signal 0 only checks whether the process exists.
    unsafe {
        libc::kill(pid as i32, 0) == 0
            || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
    #[cfg(not(unix))]
    true
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

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    fn store(dir: &Path, ttl: Duration) -> Store {
        Store::new(dir.join("staging"), ttl)
    }
    #[test]
    fn workspace_references_are_live_and_external_files_are_snapshots() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path().join("ws");
        std::fs::create_dir_all(workspace.join("src")).unwrap();
        std::fs::write(workspace.join("src/a.txt"), "before").unwrap();
        let outside = dir.path().join("notes.txt");
        std::fs::write(&outside, "outside before").unwrap();
        let store = store(dir.path(), TTL);
        let paths = vec![
            workspace.join("src/a.txt"),
            outside.clone(),
            workspace.join("src"),
        ];
        let mut refs = stage_in(&store, paths.clone(), Some(&workspace), "chat-1", &[]).unwrap();
        assert_eq!(refs.len(), 3);
        assert!(matches!(
            refs[0].origin,
            Origin::Workspace { folder: false, .. }
        ));
        assert!(matches!(
            refs[2].origin,
            Origin::Workspace { folder: true, .. }
        ));
        assert!(matches!(refs[1].origin, Origin::Staged { .. }));
        // Adding the same files again adds nothing.
        assert!(
            stage_in(&store, paths, Some(&workspace), "chat-1", &refs)
                .unwrap()
                .is_empty()
        );
        std::fs::write(workspace.join("src/a.txt"), "after").unwrap();
        std::fs::write(&outside, "outside after").unwrap();
        authorize_in(&store, &mut refs, Some(&workspace)).unwrap();
        // The workspace file is read again; the attachment stays as added.
        assert!(matches!(&refs[0].content, ReferenceContent::Text(t) if t == "after"));
        assert!(matches!(&refs[1].content, ReferenceContent::Text(t) if t == "outside before"));
        assert!(matches!(&refs[2].content, ReferenceContent::Text(t) if t.contains("a.txt")));
        // A removed workspace file or a tampered snapshot fails the turn.
        std::fs::remove_file(workspace.join("src/a.txt")).unwrap();
        assert!(authorize_in(&store, &mut refs, Some(&workspace)).is_err());
        let Origin::Staged { snapshot, .. } = refs[1].origin.clone() else {
            unreachable!()
        };
        std::fs::write(&snapshot, "tampered").unwrap();
        assert!(authorize_in(&store, &mut refs[1..2], Some(&workspace)).is_err());
        assert!(!snapshot.exists());
    }
    #[test]
    fn snapshots_expire_belong_to_one_conversation_and_are_revoked() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("image.png");
        std::fs::write(&outside, b"\x89PNG\r\n\x1a\nrest").unwrap();
        let expiring = store(dir.path(), Duration::ZERO);
        let mut refs = stage_in(&expiring, vec![outside.clone()], None, "a", &[]).unwrap();
        assert!(matches!(refs[0].content, ReferenceContent::Image { .. }));
        assert!(authorize_in(&expiring, &mut refs, None).is_err());
        let store = store(dir.path(), TTL);
        let first = stage_in(&store, vec![outside.clone()], None, "a", &[]).unwrap();
        // Another conversation gets its own snapshot.
        let second = stage_in(&store, vec![outside.clone()], None, "b", &[]).unwrap();
        assert_ne!(first[0].origin, second[0].origin);
        let Origin::Staged { snapshot, .. } = first[0].origin.clone() else {
            unreachable!()
        };
        assert!(snapshot.exists());
        store.remove(&snapshots(&first));
        assert!(!snapshot.exists());
        store.remove_owner("b");
        let Origin::Staged { snapshot, .. } = second[0].origin.clone() else {
            unreachable!()
        };
        assert!(!snapshot.exists());
        // Links and too many files are refused; nothing is left behind.
        #[cfg(unix)]
        {
            let link = dir.path().join("link.png");
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            assert!(stage_in(&store, vec![link], None, "a", &[]).is_err());
        }
        assert!(stage_in(&store, vec![outside; 33], None, "a", &[]).is_err());
        // A staging directory of an exited process is swept.
        let orphan = dir.path().join("staging/999999-dead");
        std::fs::create_dir_all(&orphan).unwrap();
        let _ = Store::new(dir.path().join("staging"), TTL);
        assert!(!orphan.exists());
    }
}
