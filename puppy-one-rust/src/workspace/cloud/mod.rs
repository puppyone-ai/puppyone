//! Live workbench adapter. No checkout mirror, Git fallback, UI, credentials or
//! execution owner. This stage only prepares an already-running workbench;
//! explicit allocation/resume and visible navigation belong to the later owner.
pub mod catalog;
mod client;
mod events;
pub mod failure;
pub mod history;
pub mod locator;
mod model;
pub mod opening;
pub mod publish;
pub mod recovery;
pub mod repository;
#[cfg(test)]
mod tests;
use super::{Workspace, contracts::*, ports::*};
use crate::{
    cloud_auth::{
        Broker, Cancellation,
        model::{ApiRequest, Binding},
    },
    model::Node,
};
use client::{Shared, map_error};
pub use model::Target;
use reqwest::Method;
use serde_json::json;
use std::{
    path::Path,
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
    Auth(crate::cloud_auth::Error),
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
    let project = target.project().map_err(|_| Refusal::Invalid)?;
    scope.check().map_err(Refusal::Auth)?;
    broker.check_binding(binding).map_err(Refusal::Auth)?;
    let query = ApiRequest {
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
    if &context.target != target
        || context.project.id != project
        || context.scope_path.as_deref().is_some_and(|v| !v.is_empty())
    {
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

fn prepare_verified(
    broker: Arc<Broker>,
    binding: Binding,
    context: model::Context,
    scope: Cancellation,
    runtime: model::Runtime,
) -> Result<Prepared> {
    let project = context.target.project()?.to_owned();
    runtime.ready(&project)?;
    let api = url::Url::parse(binding.environment.api()).map_err(|_| model::invalid())?;
    let authority = &api[url::Position::BeforeHost..url::Position::AfterPort];
    let mut identity =
        url::Url::parse(&format!("puppyone-cloud://{authority}/")).map_err(|_| model::invalid())?;
    identity
        .path_segments_mut()
        .map_err(|_| model::invalid())?
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
        storage: StorageId::new(identity.as_str())?,
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
            watch: true,
            preview: true,
            ..Default::default()
        },
    };
    let shared = Shared::new(broker, binding, scope, runtime, descriptor);
    let provider = Arc::new(Cloud {
        shared: shared.clone(),
        hub: events::Hub::new(shared.clone()),
    });
    let workspace = Workspace::from_provider(provider)?;
    let epoch = shared.epoch.load(Ordering::Acquire);
    // A status is a hint, not proof that the file service or grant is usable.
    // Optional server handoff/root reuse is left to the navigation stage.
    let root = workspace.list(Path::new(""))?;
    shared.check()?;
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
impl DataPort for Cloud {
    fn descriptor(&self) -> Descriptor {
        self.shared.descriptor.clone()
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
            let _serial = self.shared.mutations.lock().unwrap();
            self.shared.check()?;
            if text.contains(['\0', '\r']) {
                return Err(Error::from("Invalid Cloud template text"));
            }
            self.shared.raw_write(&path, text.as_bytes(), None)?;
        }
        Ok(path)
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
        let _serial = self.shared.mutations.lock().unwrap();
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
                version.revision = revision;
                Ok(WriteResult::Saved(TextSnapshot {
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
        let file = self.shared.file(path)?;
        let name = model::path(path, false)?;
        Ok(PreviewData::Bytes {
            mime: crate::formats::preferred_mime(name)
                .unwrap_or("application/octet-stream")
                .into(),
            bytes: file.bytes,
        })
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
        self.hub.subscribe(notify)
    }
    fn watch_root(&self, notify: Notify) -> Result<WatchSubscription> {
        self.hub.subscribe(notify)
    }
}
