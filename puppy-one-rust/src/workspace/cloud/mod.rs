//! Live workbench adapter. No checkout mirror, Git fallback, UI, credentials or
//! execution owner. This stage only prepares an already-running workbench;
//! explicit allocation/resume and visible navigation belong to the later owner.
pub mod agent;
pub mod agents;
pub mod billing;
pub mod cache;
pub mod catalog;
pub mod chat_apps;
mod client;
mod events;
pub mod failure;
pub mod graph;
pub mod history;
pub mod locator;
mod model;
mod mutations;
pub mod opening;
pub mod pricing;
pub mod publish;
pub mod recovery;
pub mod repository;
pub mod sandbox;
pub mod services;
pub mod spaces;
#[cfg(test)]
mod tests;
use super::{Workspace, contracts::*, ports::*};
use crate::{
    cloud::auth::{
        Broker, Cancellation,
        model::{ApiRequest, Binding},
    },
    model::Node,
};
use client::{Shared, VerifyAuthFailure, VerifyError, map_error};
pub use model::Target;
use reqwest::Method;
use serde_json::json;
use std::{
    sync::{Arc, atomic::Ordering},
    time::{Duration, Instant},
};

pub struct Prepared {
    workspace: Option<Arc<Workspace>>,
    root: Option<Vec<Node>>,
    shared: Arc<Shared>,
    epoch: u64,
    expires: Instant,
}
impl Prepared {
    /// One-use readiness receipt, not a persistent authorization/cache grant.
    pub fn into_parts(mut self) -> Result<(Arc<Workspace>, Vec<Node>)> {
        self.shared.check()?;
        if Instant::now() >= self.expires || self.shared.epoch.load(Ordering::Acquire) != self.epoch
        {
            return Err(model::stale());
        }
        Ok((
            self.workspace.take().expect("unconsumed workspace"),
            self.root.take().expect("unconsumed root"),
        ))
    }
}
impl Drop for Prepared {
    fn drop(&mut self) {
        if let Some(workspace) = &self.workspace {
            workspace.revoke();
        }
    }
}

/// Authenticate the exact target, pin runtime identity and verify the live root.
/// GETs and watcher recovery never allocate or resume a workbench.
pub fn prepare_running(
    broker: Arc<Broker>,
    binding: Binding,
    target: Target,
    cancel: &Cancellation,
) -> Result<Prepared> {
    let project = target.project()?.to_owned();
    let scope = cancel.child();
    scope.check().map_err(map_error)?;
    broker.check_binding(&binding).map_err(map_error)?;
    let context = authorize(&broker, &binding, &target, &scope)?;
    let status = ApiRequest {
        idempotency_key: None,
        method: Method::GET,
        path: format!("/projects/{project}/workbench"),
        query: Vec::new(),
        body: None,
    };
    let mut response = broker
        .request_scoped(&binding, &status, &scope)
        .map_err(map_error)?;
    let runtime: model::Runtime =
        serde_json::from_value(response["workspace"].take()).map_err(|_| model::invalid())?;
    runtime.ready(&project)?;
    prepare_verified(broker, binding, context, scope, runtime)
}

/// Why an exact target was refused, before it becomes a provider error.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Refusal {
    Auth(crate::cloud::auth::Error),
    /// A malformed context, or one for another Project or Scope.
    Invalid,
    /// The account may not read the Project's content.
    Unreadable,
}
fn authorize(
    broker: &Broker,
    binding: &Binding,
    target: &Target,
    scope: &Cancellation,
) -> Result<model::Context> {
    authorize_target(broker, binding, target, scope).map_err(|refusal| match refusal {
        Refusal::Auth(error) => map_error(error),
        Refusal::Invalid => model::invalid(),
        Refusal::Unreadable => Error::new(
            ErrorKind::PermissionDenied,
            "This account cannot read the Cloud project",
        ),
    })
}
/// `getCloudRepositoryContext`: `POST /projects/{id}/repository-context`
/// for exactly `target`, checked against it.
fn authorize_target(
    broker: &Broker,
    binding: &Binding,
    target: &Target,
    scope: &Cancellation,
) -> std::result::Result<model::Context, Refusal> {
    let project = target.owner().ok_or(Refusal::Invalid)?;
    scope.check().map_err(Refusal::Auth)?;
    broker.check_binding(binding).map_err(Refusal::Auth)?;
    let query = ApiRequest {
        idempotency_key: None,
        method: Method::POST,
        path: format!("/projects/{project}/repository-context"),
        query: Vec::new(),
        body: Some(json!({"target": target})),
    };
    let mut response = broker
        .request_scoped(binding, &query, scope)
        .map_err(Refusal::Auth)?;
    if response["code"] != 0 {
        return Err(Refusal::Invalid);
    }
    let context: model::Context =
        serde_json::from_value(response["data"].take()).map_err(|_| Refusal::Invalid)?;
    // A Project root has no path inside it; a Scope names where it sits.
    let placed = match target {
        Target::ProjectRoot { .. } => context.scope_path.as_deref().is_none_or(str::is_empty),
        Target::Scope { .. } => context.scope_path.as_deref().is_some_and(scope_path),
    };
    if &context.target != target || context.project.id != project || !placed {
        return Err(Refusal::Invalid);
    }
    if !context
        .project
        .capabilities
        .iter()
        .any(|v| v == "content.read")
    {
        return Err(Refusal::Unreadable);
    }
    if context.project.name.is_empty()
        || context.project.name.len() > 1024
        || context.project.name.chars().any(char::is_control)
    {
        return Err(Refusal::Invalid);
    }
    Ok(context)
}

/// A Scope's place in its Project: a relative path of plain segments.
fn scope_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 4096
        && !path.chars().any(char::is_control)
        && path.split('/').all(|segment| {
            !segment.is_empty() && segment != "." && segment != ".." && !segment.contains('\\')
        })
}

fn prepare_verified(
    broker: Arc<Broker>,
    binding: Binding,
    context: model::Context,
    scope: Cancellation,
    runtime: model::Runtime,
) -> Result<Prepared> {
    prepare_verified_opening(broker, binding, context, scope, runtime, None).map_err(|error| {
        match error {
            VerifyError::Auth(failure) => map_error(failure.error),
            VerifyError::Contract(error) => error,
        }
    })
}

fn prepare_verified_opening(
    broker: Arc<Broker>,
    binding: Binding,
    context: model::Context,
    scope: Cancellation,
    runtime: model::Runtime,
    opening_root: Option<serde_json::Value>,
) -> std::result::Result<Prepared, VerifyError> {
    let project = context
        .target
        .project()
        .map_err(VerifyError::Contract)?
        .to_owned();
    runtime.ready(&project).map_err(VerifyError::Contract)?;
    let api = url::Url::parse(binding.environment.api())
        .map_err(|_| VerifyError::Contract(model::invalid()))?;
    let authority = &api[url::Position::BeforeHost..url::Position::AfterPort];
    let mut identity = url::Url::parse(&format!("puppyone-cloud://{authority}/"))
        .map_err(|_| VerifyError::Contract(model::invalid()))?;
    identity
        .path_segments_mut()
        .map_err(|_| VerifyError::Contract(model::invalid()))?
        .push(api.scheme())
        .extend(api.path().trim_matches('/').split('/'))
        .push(&binding.user)
        .push(&project)
        .push("root")
        .push("");
    let writable = context
        .project
        .capabilities
        .iter()
        .any(|v| v == "content.write");
    let descriptor = Descriptor {
        storage: StorageId::new(identity.as_str()).map_err(VerifyError::Contract)?,
        name: context.project.name,
        local_root: None,
        limits: Limits::CLOUD,
        capabilities: Capabilities {
            read: true,
            write: writable,
            create: writable,
            rename: writable,
            remove: writable,
            move_entry: writable,
            import: writable,
            watch: true,
            preview: true,
            ..Default::default()
        },
    };
    let shared = Shared::new(broker, binding, scope, runtime, descriptor);
    let check_fenced = || {
        shared.check_auth().map_err(|error| {
            VerifyError::Auth(VerifyAuthFailure {
                error,
                dispatched: false,
                elapsed: Duration::ZERO,
            })
        })
    };
    check_fenced()?;
    let provider = Arc::new(Cloud {
        shared: shared.clone(),
        hub: events::Hub::new(shared.clone()),
    });
    let workspace = Workspace::from_provider(provider).map_err(|error| {
        shared
            .check_auth()
            .err()
            .map(|auth| {
                VerifyError::Auth(VerifyAuthFailure {
                    error: auth,
                    dispatched: false,
                    elapsed: Duration::ZERO,
                })
            })
            .unwrap_or(VerifyError::Contract(error))
    })?;
    let epoch = shared.epoch.load(Ordering::Acquire);
    // A status is a hint, not proof that the file service or grant is usable.
    // Reuse a server-verified opening listing once, or verify live `/files`.
    let root = shared
        .verify_opening_root(opening_root)?
        .into_iter()
        .map(|row| Node {
            name: row.name,
            path: row.path.as_path().to_owned(),
            folder: row.folder,
            ..Default::default()
        })
        .collect();
    check_fenced()?;
    Ok(Prepared {
        workspace: Some(workspace),
        root: Some(root),
        shared,
        epoch,
        expires: Instant::now() + Duration::from_secs(5),
    })
}
struct Cloud {
    shared: Arc<Shared>,
    hub: Arc<events::Hub>,
}
impl Drop for Cloud {
    fn drop(&mut self) {
        self.shared.retire();
    }
}
impl Cloud {
    /// The one create-only upload: the path may not exist yet.
    fn write_new(&self, path: &RelativePath, bytes: &[u8]) -> Result<String> {
        let _serial = self
            .shared
            .mutations
            .acquire(&[path], || self.shared.check())?;
        self.shared.check()?;
        self.shared.raw_write(path, bytes, None)
    }
    /// Copies a dropped file or folder under a keep-both name. A file over
    /// the Cloud limit or one that fails to write fails alone; a folder
    /// still copies what it can and then reports the first failure.
    fn import_tree(
        &self,
        source: &std::path::Path,
        folder: &RelativePath,
        name: &str,
    ) -> Result<RelativePath> {
        use super::local::ImportSource;
        let content =
            super::local::Workspace::read_import_source(source, Limits::CLOUD.text_bytes)?;
        let is_dir = matches!(content, ImportSource::Folder(_));
        for index in 0..=10_000 {
            let candidate = super::local::Workspace::keep_both_name(name, index, is_dir);
            let path = model::child(folder, &candidate)?;
            let made = match &content {
                ImportSource::Folder(_) => self.shared.change("mkdir", &path, None),
                ImportSource::File(bytes) => self.write_new(&path, bytes).map(|_| ()),
            };
            match made {
                Ok(()) => {
                    if let ImportSource::Folder(children) = &content {
                        let mut first = None;
                        for child in children {
                            let Some(child_name) = child.file_name().and_then(|v| v.to_str())
                            else {
                                continue;
                            };
                            if let Err(error) = self.import_tree(child, &path, child_name) {
                                first.get_or_insert(error);
                            }
                        }
                        if let Some(error) = first {
                            return Err(error);
                        }
                    }
                    return Ok(path);
                }
                Err(error) if error.kind == ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Err(crate::localization::t("native.workspace.nameExhausted").into())
    }
}
impl DataPort for Cloud {
    fn descriptor(&self) -> Descriptor {
        self.shared.descriptor.clone()
    }
    fn agent_target(&self) -> Option<agent::AgentTarget> {
        Some(agent::AgentTarget {
            broker: self.shared.broker.clone(),
            binding: self.shared.binding.clone(),
            project: self.shared.runtime.project_id.clone(),
            workbench: self.shared.runtime.id.clone(),
            storage: self.shared.descriptor.storage.as_str().to_owned(),
        })
    }
    fn sandbox_target(&self) -> Option<sandbox::SandboxTarget> {
        Some(sandbox::SandboxTarget {
            broker: self.shared.broker.clone(),
            binding: self.shared.binding.clone(),
            project: self.shared.runtime.project_id.clone(),
            storage: self.shared.descriptor.storage.as_str().to_owned(),
            sandbox: self.shared.sandbox.clone(),
        })
    }
    fn check_authority(&self) -> Result<()> {
        self.shared.check()
    }
    fn revoke(&self) {
        self.shared.retire();
    }
    fn list(&self, path: &RelativePath) -> Result<Vec<Entry>> {
        self.shared.list(path)
    }
    fn create(
        &self,
        parent: &RelativePath,
        name: &str,
        folder: bool,
        text: &str,
    ) -> Result<RelativePath> {
        let path = model::child(parent, name)?;
        if folder {
            self.shared.change("mkdir", &path, None)?;
        } else {
            if text.contains(['\0', '\r']) {
                return Err(Error::from("Invalid Cloud template text"));
            }
            self.write_new(&path, text.as_bytes())?;
        }
        Ok(path)
    }
    fn import(&self, source: &std::path::Path, folder: &RelativePath) -> Result<RelativePath> {
        if !source.is_absolute() {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                "Import requires an absolute source path",
            ));
        }
        let name = source
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(model::invalid)?;
        self.import_tree(source, folder, name)
    }
    fn rename(&self, path: &RelativePath, name: &str) -> Result<RelativePath> {
        let parent = RelativePath::new(path.as_path().parent().ok_or_else(model::stale)?)?;
        let destination = model::child(&parent, name)?;
        self.shared.change("move", path, Some(&destination))?;
        Ok(destination)
    }
    fn move_entry(&self, from: &RelativePath, folder: &RelativePath) -> Result<RelativePath> {
        let name = from
            .as_path()
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(model::invalid)?;
        let destination = model::child(folder, name)?;
        if destination == *from || destination.as_path().starts_with(from.as_path()) {
            return Err(Error::from("A Cloud entry cannot move into itself"));
        }
        self.shared.change("move", from, Some(&destination))?;
        Ok(destination)
    }
    fn remove(&self, path: &RelativePath) -> Result<()> {
        self.shared.change("remove", path, None)
    }
}
impl DocumentStoragePort for Cloud {
    fn read(&self, path: &RelativePath) -> Result<TextSnapshot> {
        model::Version::snapshot(
            &self.shared.file(path)?,
            &self.shared.descriptor.storage,
            &self.shared.runtime,
            path,
        )
    }
    fn write(&self, path: &RelativePath, baseline: &Revision, text: &str) -> Result<WriteResult> {
        let _serial = self
            .shared
            .mutations
            .acquire(&[path], || self.shared.check())?;
        self.shared.check()?;
        let mut version = model::Version::parse(
            baseline,
            &self.shared.descriptor.storage,
            &self.shared.runtime,
            path,
        )?;
        let bytes = version.encode(text)?;
        match self.shared.raw_write(path, &bytes, Some(&version.revision)) {
            Ok(revision) => {
                let line_ending = if version.crlf {
                    LineEnding::Crlf
                } else {
                    LineEnding::Lf
                };
                version.revision = revision;
                Ok(WriteResult::Saved(TextSnapshot {
                    encoding: Default::default(),
                    line_ending,
                    text: text.into(),
                    revision: version.revision()?,
                }))
            }
            Err(error) if error.kind == ErrorKind::AlreadyExists => {
                self.read(path).map(WriteResult::Conflict)
            }
            Err(error) => Err(error),
        }
    }
}
impl ResourcePort for Cloud {
    fn preview(&self, path: &RelativePath) -> Result<PreviewData> {
        let name = model::path(path, false)?;
        // `downloadWorkspace` for a database: no active sidecar before or
        // after the read, and the same revision twice; anything else is not
        // a consistent snapshot to decode.
        let database = DATABASE_EXTENSIONS
            .iter()
            .any(|ext| name.to_ascii_lowercase().ends_with(ext));
        if database {
            self.reject_sidecars(path)?;
        }
        let file = self.shared.file(path)?;
        if database {
            self.reject_sidecars(path)?;
            if self.shared.file(path)?.digest != file.digest {
                return Err(Error::new(
                    ErrorKind::Unsupported,
                    crate::localization::t("editor.database.expired"),
                ));
            }
        }
        Ok(PreviewData::Bytes {
            mime: crate::formats::preferred_mime(name)
                .unwrap_or("application/octet-stream")
                .into(),
            bytes: file.bytes,
        })
    }
    fn stat_entry(&self, path: &RelativePath) -> Result<EntryStat> {
        let file = self.shared.file(path)?;
        Ok(EntryStat {
            size: file.bytes.len() as u64,
            is_file: true,
            readonly: !self.shared.descriptor.capabilities.write,
        })
    }
    fn read_head(&self, path: &RelativePath, max_bytes: usize) -> Result<Vec<u8>> {
        let file = self.shared.file(path)?;
        let len = file.bytes.len().min(max_bytes);
        Ok(file.bytes[..len].to_vec())
    }
}
/// `database-candidate` extensions (`file-formats.json`).
const DATABASE_EXTENSIONS: [&str; 4] = [".db", ".db3", ".sqlite", ".sqlite3"];
impl Cloud {
    /// `workspaceSidecars`: `-wal`, `-shm`, `-journal` or `.wal` beside the
    /// database means it needs recovery, never a partial snapshot.
    fn reject_sidecars(&self, path: &RelativePath) -> Result<()> {
        let parent =
            RelativePath::new(path.as_path().parent().unwrap_or(std::path::Path::new("")))?;
        let name = path
            .as_path()
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let entries = self.shared.fresh_list(&parent)?;
        let active = ["-wal", "-shm", "-journal", ".wal"].iter().any(|suffix| {
            let sidecar = format!("{name}{suffix}");
            entries.iter().any(|e| e.name == sidecar)
        });
        if active {
            return Err(Error::new(
                ErrorKind::Unsupported,
                crate::localization::t("editor.database.recovery"),
            ));
        }
        Ok(())
    }
}
impl ResourceWatchPort for Cloud {
    fn watch(
        &self,
        path: &RelativePath,
        baseline: &Revision,
        notify: Notify,
    ) -> Result<WatchSubscription> {
        model::Version::parse(
            baseline,
            &self.shared.descriptor.storage,
            &self.shared.runtime,
            path,
        )?;
        self.hub.subscribe(Some(path.clone()), notify)
    }
    fn watch_root(&self, notify: Notify) -> Result<WatchSubscription> {
        self.hub.subscribe(None, notify)
    }
}
