//! A folder on another of the owner's computers as a workspace
//! (`deviceDataPort.ts`): files only, through the access side. It has no
//! local checkout, and no Shell, Git, external app or implicit Cloud
//! publication of its own; what may run there is the host's to allow.
use super::{
    lines::HostError,
    protocol::{Kind, Request, relative_path},
    remote::{FolderEvent, Hosts, runtime},
};
use crate::workspace::{Workspace, contracts::*, ports::*};
use base64::{Engine, engine::general_purpose::STANDARD};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, Ordering},
    },
};

/// Stable resource identity (`deviceFolderRootUri`): never a device name, a
/// local path, the online state or a connection.
pub fn storage(api: &str, account: &str, device: &str, folder: &str) -> Result<StorageId> {
    let api = url::Url::parse(api).map_err(|_| Error::from("Invalid deployment"))?;
    let authority = &api[url::Position::BeforeHost..url::Position::AfterPort];
    let path = [
        api.scheme(),
        api.path().trim_matches('/'),
        &account.to_lowercase(),
        &device.to_lowercase(),
        &folder.to_lowercase(),
    ]
    .join("/");
    StorageId::new(&format!("puppyone-device://{authority}/{path}/"))
}

/// Why the folder cannot be reached right now; the surface words it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Availability {
    Online,
    Offline,
    Revoked,
    Denied,
}
impl Availability {
    pub fn of(error: &HostError) -> Self {
        match (error.code.as_str(), error.status) {
            (
                "device_offline"
                | "device_disconnected"
                | "device_timeout"
                | "device_busy"
                | "network_unavailable",
                _,
            )
            | (_, 0 | 502 | 503 | 504) => Self::Offline,
            ("folder_unavailable", 403 | 404) => Self::Revoked,
            (_, 401 | 403) => Self::Denied,
            _ => Self::Online,
        }
    }
    pub fn message(self, host: &str) -> String {
        use crate::localization::{t, tf};
        match self {
            Self::Online => String::new(),
            Self::Offline => tf("hosts.folder.offline", &[("host", host.into())]),
            Self::Revoked => t("hosts.folder.revoked").into(),
            Self::Denied => t("hosts.folder.denied").into(),
        }
    }
}

/// One folder on another computer, as opened from this one.
pub struct Opened {
    pub api: String,
    pub account: String,
    pub device: String,
    pub folder: String,
    pub name: String,
    /// The other computer's name, for "On {host}".
    pub host: String,
    pub writable: bool,
}

/// One coalesced remote watch for every subscriber of the folder: the host
/// allows only a few per connection.
type Slot = Weak<Mutex<Option<WatchEvent>>>;
#[derive(Default)]
struct Hub {
    sinks: Mutex<HashMap<uuid::Uuid, (Slot, Notify)>>,
    running: AtomicBool,
}

pub struct DeviceFolder {
    hosts: Arc<Hosts>,
    opened: Opened,
    descriptor: Descriptor,
    live: Arc<AtomicBool>,
    mutations: Mutex<()>,
    hub: Arc<Hub>,
    availability: Arc<Mutex<Availability>>,
}

/// Opens the folder: its root is listed once, so a computer that cannot
/// serve it fails here rather than in the workbench.
pub fn open(
    hosts: Arc<Hosts>,
    opened: Opened,
) -> Result<(Arc<Workspace>, Vec<crate::model::Node>)> {
    let writable = opened.writable;
    let descriptor = Descriptor {
        storage: storage(&opened.api, &opened.account, &opened.device, &opened.folder)?,
        name: opened.name.clone(),
        local_root: None,
        limits: Limits::CLOUD,
        capabilities: Capabilities {
            read: true,
            write: writable,
            create: writable,
            rename: writable,
            remove: writable,
            move_entry: writable,
            watch: true,
            preview: true,
            ..Default::default()
        },
    };
    let provider = Arc::new(DeviceFolder {
        hosts,
        opened,
        descriptor,
        live: Arc::new(AtomicBool::new(true)),
        mutations: Mutex::new(()),
        hub: Arc::default(),
        availability: Arc::new(Mutex::new(Availability::Online)),
    });
    let workspace = Workspace::from_provider(provider)?;
    let root = workspace.list(Path::new(""))?;
    Ok((workspace, root))
}

fn wire(path: &RelativePath) -> Result<String> {
    let text = path
        .as_path()
        .to_str()
        .ok_or_else(|| Error::from("Invalid remote folder path"))?
        .replace(std::path::MAIN_SEPARATOR, "/");
    relative_path(&text, true).map_err(|_| Error::from("Invalid remote folder path"))
}
fn child(parent: &RelativePath, name: &str) -> Result<RelativePath> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains(['/', '\\', '\0'])
        || name.eq_ignore_ascii_case(".git")
    {
        return Err(Error::from("Invalid file name"));
    }
    RelativePath::new(&parent.as_path().join(name))
}

impl DeviceFolder {
    fn error(&self, error: HostError) -> Error {
        if error.outcome_unknown {
            return Error::new(
                ErrorKind::OutcomeUnknown,
                "The other computer did not confirm this change. Check the folder before trying again.",
            );
        }
        let availability = Availability::of(&error);
        if availability != Availability::Online {
            *self.availability.lock().unwrap() = availability;
            let kind = match availability {
                Availability::Offline => ErrorKind::Io,
                _ => ErrorKind::PermissionDenied,
            };
            return Error::new(kind, availability.message(&self.opened.host));
        }
        let kind = match error.status {
            404 => ErrorKind::NotFound,
            409 => ErrorKind::AlreadyExists,
            401 | 403 => ErrorKind::PermissionDenied,
            413 => ErrorKind::Unsupported,
            _ => ErrorKind::InvalidInput,
        };
        Error::new(kind, error.code)
    }
    fn call(&self, request: Request) -> Result<serde_json::Value> {
        self.check()?;
        let outcome = runtime().block_on(self.hosts.request(&self.opened.folder, &request));
        self.check()?;
        match outcome {
            Ok(value) => {
                *self.availability.lock().unwrap() = Availability::Online;
                Ok(value)
            }
            Err(error) => Err(self.error(error)),
        }
    }
    fn mutate(&self, request: Request) -> Result<serde_json::Value> {
        let _serial = self.mutations.lock().unwrap();
        if !self.descriptor.capabilities.write {
            return Err(Error::new(
                ErrorKind::PermissionDenied,
                crate::localization::t("hosts.folder.readOnly"),
            ));
        }
        self.call(request)
    }
    fn check(&self) -> Result<()> {
        if self.live.load(Ordering::Acquire) {
            Ok(())
        } else {
            Err(Error::new(
                ErrorKind::StaleLease,
                "Remote folder session changed. Reopen it.",
            ))
        }
    }
    fn read_bytes(&self, path: &RelativePath) -> Result<(Vec<u8>, String)> {
        let result = self.call(Request::Read { path: wire(path)? })?;
        let revision = result["revision"].as_str().unwrap_or_default().to_owned();
        if revision.len() != 64 || !revision.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(Error::from("Invalid remote file revision"));
        }
        let bytes = STANDARD
            .decode(result["content_base64"].as_str().unwrap_or_default())
            .map_err(|_| Error::from("Invalid remote file"))?;
        Ok((bytes, revision))
    }
    /// How reachable the folder was at its last request or watch event.
    pub fn availability(&self) -> Availability {
        *self.availability.lock().unwrap()
    }
    fn subscribe(&self, notify: Notify) -> Result<WatchSubscription> {
        self.check()?;
        // Revalidate after registration: something may have changed between
        // the read and the watch.
        let events = Arc::new(Mutex::new(Some(WatchEvent::Invalidated)));
        let id = uuid::Uuid::new_v4();
        self.hub
            .sinks
            .lock()
            .unwrap()
            .insert(id, (Arc::downgrade(&events), notify.clone()));
        notify();
        if !self.hub.running.swap(true, Ordering::AcqRel) {
            let (hub, hosts, live) = (self.hub.clone(), self.hosts.clone(), self.live.clone());
            let (folder, host) = (self.opened.folder.clone(), self.opened.host.clone());
            let availability = self.availability.clone();
            runtime().spawn(async move {
                let deliver = |event: WatchEvent| {
                    let mut sinks = hub.sinks.lock().unwrap();
                    sinks.retain(|_, (slot, _)| slot.strong_count() > 0);
                    for (slot, notify) in sinks.values() {
                        if let Some(slot) = slot.upgrade() {
                            *slot.lock().unwrap() = Some(event.clone());
                            notify();
                        }
                    }
                    !sinks.is_empty() && live.load(Ordering::Acquire)
                };
                hosts
                    .watch(&folder, |event| match event {
                        FolderEvent::Change { .. } => {
                            *availability.lock().unwrap() = Availability::Online;
                            deliver(WatchEvent::Invalidated)
                        }
                        FolderEvent::Offline(_) => {
                            *availability.lock().unwrap() = Availability::Offline;
                            deliver(WatchEvent::Failed(Error::new(
                                ErrorKind::Io,
                                Availability::Offline.message(&host),
                            )))
                        }
                        FolderEvent::Unavailable(error) => {
                            let kind = Availability::of(&error);
                            let kind = if kind == Availability::Online {
                                Availability::Denied
                            } else {
                                kind
                            };
                            *availability.lock().unwrap() = kind;
                            deliver(WatchEvent::Failed(Error::new(
                                ErrorKind::PermissionDenied,
                                kind.message(&host),
                            )));
                            false
                        }
                    })
                    .await;
                hub.running.store(false, Ordering::Release);
            });
        }
        let hub = self.hub.clone();
        Ok(WatchSubscription {
            events,
            cancel: WatchCancellation::new(move || {
                hub.sinks.lock().unwrap().remove(&id);
            }),
        })
    }
}
impl Drop for DeviceFolder {
    fn drop(&mut self) {
        self.live.store(false, Ordering::Release);
    }
}
impl DataPort for DeviceFolder {
    fn descriptor(&self) -> Descriptor {
        self.descriptor.clone()
    }
    fn check_authority(&self) -> Result<()> {
        self.check()
    }
    fn revoke(&self) {
        self.live.store(false, Ordering::Release);
        self.hub.sinks.lock().unwrap().clear();
    }
    fn list(&self, path: &RelativePath) -> Result<Vec<Entry>> {
        let result = self.call(Request::List { path: wire(path)? })?;
        let entries = result["entries"]
            .as_array()
            .filter(|e| e.len() <= self.descriptor.limits.directory_entries)
            .ok_or_else(|| Error::from("Invalid remote directory"))?;
        entries
            .iter()
            .map(|item| {
                let entry: super::protocol::Entry = serde_json::from_value(item.clone())
                    .map_err(|_| Error::from("Invalid remote directory entry"))?;
                Ok(Entry {
                    path: child(path, &entry.name)?,
                    name: entry.name,
                    folder: entry.kind == Kind::Directory,
                })
            })
            .collect()
    }
    fn create(
        &self,
        parent: &RelativePath,
        name: &str,
        folder: bool,
        text: &str,
    ) -> Result<RelativePath> {
        let path = child(parent, name)?;
        let request = if folder {
            Request::Mkdir { path: wire(&path)? }
        } else {
            Request::Write {
                path: wire(&path)?,
                content_base64: STANDARD.encode(text.as_bytes()),
                expected_revision: Some(None),
            }
        };
        self.mutate(request)?;
        Ok(path)
    }
    fn rename(&self, path: &RelativePath, name: &str) -> Result<RelativePath> {
        if path.is_root() {
            return Err(Error::from("The folder itself cannot be renamed here"));
        }
        let parent = RelativePath::new(path.as_path().parent().unwrap_or(Path::new("")))?;
        let destination = child(&parent, name)?;
        self.mutate(Request::Move {
            path: wire(path)?,
            destination: wire(&destination)?,
        })?;
        Ok(destination)
    }
    fn move_entry(&self, from: &RelativePath, folder: &RelativePath) -> Result<RelativePath> {
        let name = from
            .as_path()
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(|| Error::from("The folder itself cannot be moved"))?;
        let destination = child(folder, name)?;
        if destination == *from || destination.as_path().starts_with(from.as_path()) {
            return Err(Error::from("An entry cannot move into itself"));
        }
        self.mutate(Request::Move {
            path: wire(from)?,
            destination: wire(&destination)?,
        })?;
        Ok(destination)
    }
    fn remove(&self, path: &RelativePath) -> Result<()> {
        if path.is_root() {
            return Err(Error::from("The folder itself cannot be deleted here"));
        }
        self.mutate(Request::Remove { path: wire(path)? })
            .map(|_| ())
    }
}
impl DocumentStoragePort for DeviceFolder {
    fn read(&self, path: &RelativePath) -> Result<TextSnapshot> {
        let (bytes, revision) = self.read_bytes(path)?;
        let (text, encoding) = match String::from_utf8(bytes) {
            Ok(text) => (text, TextEncoding::Utf8),
            Err(error) => (
                String::from_utf8_lossy(error.as_bytes()).into_owned(),
                TextEncoding::Unknown,
            ),
        };
        Ok(TextSnapshot {
            text,
            revision: Revision(revision),
            encoding,
        })
    }
    fn write(&self, path: &RelativePath, base: &Revision, text: &str) -> Result<WriteResult> {
        if base.0.len() != 64 {
            return Err(Error::from("Reload this remote file before saving."));
        }
        let outcome = self.mutate(Request::Write {
            path: wire(path)?,
            content_base64: STANDARD.encode(text.as_bytes()),
            expected_revision: Some(Some(base.0.clone())),
        });
        match outcome {
            Ok(result) => Ok(WriteResult::Saved(TextSnapshot {
                text: text.into(),
                revision: Revision(result["revision"].as_str().unwrap_or_default().into()),
                encoding: TextEncoding::Utf8,
            })),
            // Keep the draft when the other computer itself is unavailable.
            Err(error) if error.kind == ErrorKind::AlreadyExists => {
                self.read(path).map(WriteResult::Conflict)
            }
            Err(error) => Err(error),
        }
    }
}
impl ResourcePort for DeviceFolder {
    fn preview(&self, path: &RelativePath) -> Result<PreviewData> {
        let (bytes, _) = self.read_bytes(path)?;
        let name = path.as_path().to_string_lossy();
        Ok(PreviewData::Bytes {
            mime: crate::formats::preferred_mime(&name)
                .unwrap_or("application/octet-stream")
                .into(),
            bytes: bytes.into(),
        })
    }
    fn platform_path(&self, _: &RelativePath) -> Result<PathBuf> {
        Err(Error::unsupported())
    }
}
impl ResourceWatchPort for DeviceFolder {
    fn watch(&self, _: &RelativePath, _: &Revision, notify: Notify) -> Result<WatchSubscription> {
        self.subscribe(notify)
    }
    fn watch_root(&self, notify: Notify) -> Result<WatchSubscription> {
        self.subscribe(notify)
    }
}

#[cfg(test)]
mod tests {
    use super::super::remote::tests::{ACCOUNT, DEVICE, FOLDER, fake};
    use super::*;
    use std::time::Duration;

    /// A remote folder in the editor's terms: list, read, save with its
    /// revision, a conflict when the other computer changed it first, the
    /// usual file operations, a change notification, and an offline
    /// computer worded for the person.
    #[test]
    fn a_folder_on_another_computer_reads_saves_and_watches_like_a_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        std::fs::write(root.join("note.md"), "hello").unwrap();
        let cloud = fake(root.clone());
        let hosts = Hosts::new(cloud.clone());
        let (workspace, listed) = open(
            hosts.clone(),
            Opened {
                api: "https://api.puppyone.ai/api/v1".into(),
                account: ACCOUNT.into(),
                device: DEVICE.into(),
                folder: FOLDER.into(),
                name: "notes".into(),
                host: "Studio Mac".into(),
                writable: true,
            },
        )
        .unwrap();
        assert_eq!(listed.len(), 1);
        let document = workspace.read(Path::new("note.md")).unwrap();
        assert_eq!(
            document.identity.storage.as_str(),
            format!("puppyone-device://api.puppyone.ai/https/api/v1/{ACCOUNT}/{DEVICE}/{FOLDER}/")
        );
        assert_eq!(document.text, "hello");
        let saved = workspace.save(&document, "hello there").unwrap();
        assert!(!saved.updated);
        assert_eq!(
            std::fs::read_to_string(root.join("note.md")).unwrap(),
            "hello there"
        );
        // Changed on the other computer since: not overwritten.
        std::fs::write(root.join("note.md"), "theirs").unwrap();
        let conflict = workspace.save(&saved.document, "mine").unwrap();
        assert!(conflict.updated);
        assert_eq!(conflict.document.text, "theirs");
        assert_eq!(
            std::fs::read_to_string(root.join("note.md")).unwrap(),
            "theirs"
        );
        let created = workspace
            .create_entry(Path::new(""), "drafts", true, "")
            .unwrap();
        assert!(root.join(&created).is_dir());
        let renamed = workspace
            .rename_entry(Path::new("note.md"), "renamed.md")
            .unwrap();
        assert!(root.join(&renamed).is_file());
        workspace.remove_entry(&renamed).unwrap();
        assert!(!root.join("renamed.md").exists());
        let (tx, rx) = std::sync::mpsc::channel();
        let subscription = workspace
            .watch_root(Arc::new(move || {
                let _ = tx.send(());
            }))
            .unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
        while subscription.next().is_some() {}
        std::fs::write(root.join("other.md"), "x").unwrap();
        let mut invalidated = false;
        for _ in 0..20 {
            if rx.recv_timeout(Duration::from_secs(5)).is_ok()
                && matches!(subscription.next(), Some(WatchEvent::Invalidated))
            {
                invalidated = true;
                break;
            }
        }
        assert!(invalidated);
        drop(subscription);
        hosts.close(FOLDER);
        *cloud.online.lock().unwrap() = false;
        let offline = workspace.list(Path::new("")).unwrap_err();
        assert_eq!(offline.kind, ErrorKind::Io);
        assert!(offline.detail.contains("Studio Mac"), "{}", offline.detail);
    }
}
