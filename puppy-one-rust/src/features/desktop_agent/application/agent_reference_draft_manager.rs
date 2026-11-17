//! `application/AgentReferenceDraftManager.ts`: owns draft reference
//! acquisition, validation, retry material and grant release.
//!
//! The product's `async` methods run until their first `await` when
//! called; these return a future after doing the same synchronous work
//! (generation capture, bridge dispatch), so a later reset still cancels
//! them the same way.
use super::agent_client_port::{
    AgentClient as _, AgentClientPort, AgentClientProvider, AgentFile, require_bridge,
};
use super::agent_controller_state::StatePatch;
use super::agent_controller_values::merge_agent_references;
use super::agent_error::{format_agent_error, operation_failure};
use super::agent_reference_preview_store::{
    AgentReferencePreviewStore, AgentReferenceVisualPreview, create_agent_file_visual_preview,
    release,
};
use super::agent_session_controller::AgentControllerStore;
use super::ui_runtime::{Task, UiRuntime, detach, random_uuid, start};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::dto::{
    DraftReference, EntryType, ReferenceError, ReferenceInputCapabilities, ReferenceKind,
    ReferenceStatus,
};
use crate::agent::contract::protocol::{
    AgentOperation, ResolveWorkspaceReferences, RevokeReferences, StageReferences, WorkspaceTarget,
};
use crate::agent::contract::reference_input::{accepts_attachment, classify_agent_attachment};
use crate::agent::contract::workspace_resource_reference::parse_workspace_resource_reference;
use crate::text;
use futures_util::future::{LocalBoxFuture, join_all};
use regex::Regex;
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::LazyLock;

pub struct AgentReferenceDraftManagerOptions {
    pub workspace_root: String,
    pub bridge_provider: AgentClientProvider,
    pub store: Rc<AgentControllerStore>,
    pub runtime: Rc<dyn UiRuntime>,
    pub append_text: Rc<dyn Fn(&str)>,
}

#[derive(Clone)]
pub struct AgentReferenceDraftManager(Rc<Inner>);

struct Inner {
    options: AgentReferenceDraftManagerOptions,
    retry_files: RefCell<HashMap<String, AgentFile>>,
    retry_workspace_paths: RefCell<HashMap<String, String>>,
    previews: RefCell<AgentReferencePreviewStore>,
    epoch: RefCell<String>,
    acquisition_generation: Cell<u64>,
}

type Count = LocalBoxFuture<'static, AgentResult<usize>>;

fn ready_ids(references: &[DraftReference]) -> HashSet<String> {
    references.iter().map(|r| r.id.clone()).collect()
}

fn newly_ready(merged: &[DraftReference], existing: &HashSet<String>) -> usize {
    merged
        .iter()
        .filter(|r| r.is_ready() && !existing.contains(&r.id))
        .count()
}

impl AgentReferenceDraftManager {
    pub fn new(options: AgentReferenceDraftManagerOptions) -> Self {
        Self(Rc::new(Inner {
            options,
            retry_files: RefCell::default(),
            retry_workspace_paths: RefCell::default(),
            previews: RefCell::default(),
            epoch: RefCell::new(create_reference_epoch()),
            acquisition_generation: Cell::new(0),
        }))
    }

    /// `referenceEpoch`.
    pub fn reference_epoch(&self) -> String {
        self.0.epoch.borrow().clone()
    }

    #[cfg(feature = "dev-capture")]
    pub fn restore_epoch(&self, epoch: &str) -> AgentResult<()> {
        static EPOCH: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_-]{1,160}$").expect("epoch"));
        if !EPOCH.is_match(epoch) {
            return Err(AgentError::new("Invalid retained reference epoch."));
        }
        *self.0.epoch.borrow_mut() = epoch.to_string();
        Ok(())
    }

    /// `captureAcquisition()`: whether no reset happened since.
    #[cfg(test)]
    pub fn capture_acquisition(&self) -> impl Fn() -> bool + 'static {
        let generation = self.0.acquisition_generation.get();
        let inner = Rc::downgrade(&self.0);
        move || {
            inner
                .upgrade()
                .is_some_and(|inner| inner.acquisition_generation.get() == generation)
        }
    }

    pub fn preview_url(&self, id: &str) -> Option<String> {
        self.0.previews.borrow().get_url(id)
    }

    fn add_workspace_paths_future(
        &self,
        paths: Vec<String>,
        visual_previews: Vec<(String, AgentReferenceVisualPreview)>,
    ) -> Count {
        let inner = self.0.clone();
        let generation = inner.acquisition_generation.get();
        let mut unique_paths: Vec<String> = Vec::new();
        for path in paths.into_iter().filter(|p| !p.is_empty()) {
            if !unique_paths.contains(&path) {
                unique_paths.push(path);
            }
        }
        unique_paths.truncate(32);
        let bridge = match require_bridge(
            &inner.options.bridge_provider,
            &[AgentOperation::ResolveWorkspaceReferences],
        ) {
            Ok(bridge) => bridge,
            Err(error) => {
                for (_, preview) in visual_previews {
                    release(Some(preview));
                }
                return Box::pin(async move { Err(error) });
            }
        };
        let mut previews: HashMap<String, AgentReferenceVisualPreview> = HashMap::new();
        for (path, preview) in visual_previews {
            if unique_paths.contains(&path) {
                previews.insert(path, preview);
            } else {
                release(Some(preview));
            }
        }
        let previews = Rc::new(RefCell::new(previews));
        let resolutions: Vec<LocalBoxFuture<'static, Vec<DraftReference>>> = unique_paths
            .iter()
            .map(|path| {
                let call = bridge.resolve_workspace_references(ResolveWorkspaceReferences {
                    root_path: inner.options.workspace_root.clone(),
                    paths: vec![path.clone()],
                });
                let inner = inner.clone();
                let previews = previews.clone();
                let path = path.clone();
                Box::pin(async move {
                    let result = call.await;
                    let preview = previews.borrow_mut().remove(&path);
                    if generation != inner.acquisition_generation.get() {
                        release(preview);
                        return Vec::new();
                    }
                    match result {
                        Ok(references) => {
                            match (preview, references.first()) {
                                (Some(preview), Some(first)) => {
                                    inner.previews.borrow_mut().set(&first.id, Some(preview))
                                }
                                (preview, _) => release(preview),
                            }
                            references
                                .iter()
                                .map(|r| inner.with_capability_status(r))
                                .collect()
                        }
                        Err(error) => {
                            let reference = workspace_reference_error(&path, &error);
                            inner
                                .retry_workspace_paths
                                .borrow_mut()
                                .insert(reference.id.clone(), path);
                            inner.previews.borrow_mut().set(&reference.id, preview);
                            vec![reference]
                        }
                    }
                }) as LocalBoxFuture<'static, Vec<DraftReference>>
            })
            .collect();
        Box::pin(async move {
            let resolved = join_all(resolutions).await;
            if generation != inner.acquisition_generation.get() {
                return Ok(0);
            }
            let references: Vec<DraftReference> = resolved.into_iter().flatten().collect();
            let current = inner.options.store.read(|state| state.references.clone());
            let existing = ready_ids(&current);
            let merged = inner.merge_and_validate(&current, &references);
            let count = newly_ready(&merged, &existing);
            inner
                .options
                .store
                .patch(StatePatch::new().references(merged).error(None));
            Ok(count)
        })
    }

    fn pick_workspace_references_future(&self) -> Count {
        let inner = self.0.clone();
        let bridge = match require_bridge(
            &inner.options.bridge_provider,
            &[AgentOperation::PickWorkspaceReferences],
        ) {
            Ok(bridge) => bridge,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        let call = bridge.pick_workspace_references(WorkspaceTarget {
            root_path: inner.options.workspace_root.clone(),
        });
        Box::pin(async move {
            match call.await {
                Ok(references) => {
                    let references: Vec<DraftReference> = references
                        .iter()
                        .map(|r| inner.with_capability_status(r))
                        .collect();
                    let current = inner.options.store.read(|state| state.references.clone());
                    let existing = ready_ids(&current);
                    let merged = inner.merge_and_validate(&current, &references);
                    let count = newly_ready(&merged, &existing);
                    inner
                        .options
                        .store
                        .patch(StatePatch::new().references(merged).error(None));
                    Ok(count)
                }
                Err(error) => {
                    inner
                        .options
                        .store
                        .patch(StatePatch::new().error(Some(format_agent_error(&error))));
                    Ok(0)
                }
            }
        })
    }

    fn add_path_text_or_draft_future(
        &self,
        text: &str,
    ) -> LocalBoxFuture<'static, AgentResult<bool>> {
        let inner = self.0.clone();
        let value = text::trim(text).to_string();
        if value.is_empty() {
            return Box::pin(async { Ok(false) });
        }
        let bridge = match require_bridge(
            &inner.options.bridge_provider,
            &[AgentOperation::ResolveWorkspaceReferences],
        ) {
            Ok(bridge) => bridge,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        let call = bridge.resolve_workspace_references(ResolveWorkspaceReferences {
            root_path: inner.options.workspace_root.clone(),
            paths: vec![value.clone()],
        });
        Box::pin(async move {
            let added: AgentResult<bool> = async {
                let references: Vec<DraftReference> = call
                    .await?
                    .iter()
                    .map(|r| inner.with_capability_status(r))
                    .collect();
                if references.is_empty() {
                    return Err(AgentError::new("No workspace reference was resolved."));
                }
                let current = inner.options.store.read(|state| state.references.clone());
                let existing = ready_ids(&current);
                let merged = inner.merge_and_validate(&current, &references);
                let added = newly_ready(&merged, &existing) > 0;
                inner
                    .options
                    .store
                    .patch(StatePatch::new().references(merged).error(None));
                Ok(added)
            }
            .await;
            match added {
                Ok(added) => Ok(added),
                Err(_) => {
                    (inner.options.append_text)(&value);
                    Ok(false)
                }
            }
        })
    }

    fn stage_external_files_future(&self, files: Vec<AgentFile>) -> Count {
        self.0.stage_external_files(files)
    }

    pub fn remove(&self, id: &str) {
        let inner = &self.0;
        let references = inner.options.store.read(|state| state.references.clone());
        let Some(reference) = references.iter().find(|r| r.id == id).cloned() else {
            return;
        };
        inner.retry_files.borrow_mut().remove(id);
        inner.retry_workspace_paths.borrow_mut().remove(id);
        inner.options.store.patch(
            StatePatch::new().references(references.into_iter().filter(|r| r.id != id).collect()),
        );
        detach(&inner.options.runtime, inner.revoke(vec![reference]));
    }

    #[cfg(test)]
    pub fn retry(&self, id: &str) {
        let inner = self.0.clone();
        let references = inner.options.store.read(|state| state.references.clone());
        let Some(reference) = references.iter().find(|r| r.id == id).cloned() else {
            return;
        };
        if reference.status != ReferenceStatus::Error {
            return;
        }
        let file = inner.retry_files.borrow_mut().remove(id);
        let workspace_path = inner.retry_workspace_paths.borrow_mut().remove(id);
        inner.options.store.patch(
            StatePatch::new().references(references.into_iter().filter(|r| r.id != id).collect()),
        );
        let revoke = inner.revoke(vec![reference.clone()]);
        let manager = self.clone();
        detach(&inner.options.runtime, async move {
            revoke.await;
            if let Some(file) = file {
                let _ = manager.stage_external_files(vec![file]).await;
            } else if reference.kind == ReferenceKind::WorkspaceEntry {
                let path = workspace_path
                    .or_else(|| reference.resource_uri.clone())
                    .unwrap_or_else(|| reference.relative_path.clone().unwrap_or_default());
                let _ = manager.add_workspace_paths(vec![path], Vec::new()).await;
            }
        });
    }

    pub fn merge_and_validate(
        &self,
        current: &[DraftReference],
        incoming: &[DraftReference],
    ) -> Vec<DraftReference> {
        self.0.merge_and_validate(current, incoming)
    }

    fn revoke_future(&self, references: Vec<DraftReference>) -> LocalBoxFuture<'static, ()> {
        self.0.revoke(references)
    }

    fn rotate_future(&self, references: Vec<DraftReference>) -> LocalBoxFuture<'static, ()> {
        self.0.rotate(references)
    }

    fn reset_future(&self, references: Vec<DraftReference>) -> LocalBoxFuture<'static, ()> {
        let rotate = self.0.rotate(references);
        let inner = self.0.clone();
        Box::pin(async move {
            rotate.await;
            inner.options.store.patch(
                StatePatch::new()
                    .references(Vec::new())
                    .draft_mentions(Vec::new())
                    .pending_intent(None),
            );
        })
    }

    pub fn release_previews(&self, references: &[DraftReference]) {
        self.0.release_previews(references);
    }

    pub fn dispose_renderer_resources(&self) {
        let inner = &self.0;
        inner
            .acquisition_generation
            .set(inner.acquisition_generation.get() + 1);
        inner.retry_files.borrow_mut().clear();
        inner.retry_workspace_paths.borrow_mut().clear();
        inner.previews.borrow_mut().clear();
    }

    pub fn add_workspace_paths(
        &self,
        paths: Vec<String>,
        visual_previews: Vec<(String, AgentReferenceVisualPreview)>,
    ) -> Task<AgentResult<usize>> {
        start(
            &self.0.options.runtime,
            self.add_workspace_paths_future(paths, visual_previews),
        )
    }

    pub fn pick_workspace_references(&self) -> Task<AgentResult<usize>> {
        start(
            &self.0.options.runtime,
            self.pick_workspace_references_future(),
        )
    }

    pub fn add_path_text_or_draft(&self, text: &str) -> Task<AgentResult<bool>> {
        start(
            &self.0.options.runtime,
            self.add_path_text_or_draft_future(text),
        )
    }

    pub fn stage_external_files(&self, files: Vec<AgentFile>) -> Task<AgentResult<usize>> {
        start(
            &self.0.options.runtime,
            self.stage_external_files_future(files),
        )
    }

    pub fn revoke(&self, references: Vec<DraftReference>) -> Task<()> {
        start(&self.0.options.runtime, self.revoke_future(references))
    }

    pub fn rotate(&self, references: Vec<DraftReference>) -> Task<()> {
        start(&self.0.options.runtime, self.rotate_future(references))
    }

    pub fn reset(&self, references: Vec<DraftReference>) -> Task<()> {
        start(&self.0.options.runtime, self.reset_future(references))
    }
}

impl Inner {
    fn stage_external_files(self: &Rc<Self>, files: Vec<AgentFile>) -> Count {
        let bridge = match require_bridge(
            &self.options.bridge_provider,
            &[AgentOperation::StageReferences],
        ) {
            Ok(bridge) => bridge,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        let generation = self.acquisition_generation.get();
        let epoch = self.epoch.borrow().clone();
        let selected: Vec<AgentFile> = files.into_iter().take(32).collect();
        let pending: Vec<DraftReference> = selected.iter().map(pending_attachment).collect();
        for (reference, file) in pending.iter().zip(&selected) {
            self.previews
                .borrow_mut()
                .set(&reference.id, create_agent_file_visual_preview(file));
        }
        let current = self.options.store.read(|state| state.references.clone());
        let existing = ready_ids(&current);
        let merged = self.merge_and_validate(&current, &pending);
        self.options
            .store
            .patch(StatePatch::new().references(merged).error(None));
        let stagings: Vec<LocalBoxFuture<'static, Option<DraftReference>>> = selected
            .into_iter()
            .zip(pending)
            .map(|(file, pending)| {
                let pending_id = pending.id.clone();
                let call = bridge.stage_attachments(StageReferences {
                    root_path: self.options.workspace_root.clone(),
                    epoch: epoch.clone(),
                    files: vec![file.to_stage_file()],
                });
                let inner = self.clone();
                let bridge = bridge.clone();
                Box::pin(async move {
                    inner
                        .complete_staging(bridge, call, file, pending_id, generation)
                        .await
                }) as LocalBoxFuture<'static, Option<DraftReference>>
            })
            .collect();
        let inner = self.clone();
        Box::pin(async move {
            let completed: HashSet<String> = join_all(stagings)
                .await
                .into_iter()
                .flatten()
                .map(|r| r.id)
                .collect();
            Ok(inner.options.store.read(|state| {
                state
                    .references
                    .iter()
                    .filter(|r| {
                        r.is_ready() && completed.contains(&r.id) && !existing.contains(&r.id)
                    })
                    .count()
            }))
        })
    }

    async fn complete_staging(
        self: Rc<Self>,
        bridge: Rc<dyn AgentClientPort>,
        call: LocalBoxFuture<'static, AgentResult<Vec<DraftReference>>>,
        file: AgentFile,
        pending_id: String,
        generation: u64,
    ) -> Option<DraftReference> {
        let is_current = || {
            generation == self.acquisition_generation.get()
                && self
                    .options
                    .store
                    .read(|state| state.references.iter().any(|entry| entry.id == pending_id))
        };
        let staged: AgentResult<Option<DraftReference>> = async {
            let reference = call
                .await?
                .into_iter()
                .next()
                .ok_or_else(|| AgentError::new("The selected attachment was not staged."))?;
            if !is_current() {
                self.revoke_unretained(&reference).await;
                self.previews.borrow_mut().delete(&pending_id);
                return Ok(None);
            }
            let supported = self.with_capability_status(&reference);
            let token = supported.grant().map(str::to_string);
            if supported.status == ReferenceStatus::Error
                && supported.is_staged()
                && let Some(token) = token
            {
                if bridge.supports(AgentOperation::RevokeReferences) {
                    bridge
                        .revoke_attachments(RevokeReferences {
                            root_path: self.options.workspace_root.clone(),
                            tokens: vec![token],
                        })
                        .await?;
                }
                let mut result = supported;
                result.token = None;
                return Ok(Some(result));
            }
            Ok(Some(supported))
        }
        .await;
        let result = match staged {
            Ok(Some(result)) => result,
            Ok(None) => return None,
            Err(error) => attachment_reference_error(&file, &error),
        };
        if !is_current() {
            self.revoke_unretained(&result).await;
            self.previews.borrow_mut().delete(&pending_id);
            return None;
        }
        // Replace each pending item atomically in its original position. A
        // slow sibling must not hide a ready image or resurrect one the user
        // removed.
        let replaced: Vec<DraftReference> = self.options.store.read(|state| {
            state
                .references
                .iter()
                .map(|entry| {
                    if entry.id == pending_id {
                        result.clone()
                    } else {
                        entry.clone()
                    }
                })
                .collect()
        });
        let merged = self.merge_and_validate(&[], &replaced);
        let retained = merged.iter().find(|entry| entry.id == result.id).cloned();
        self.previews
            .borrow_mut()
            .move_preview(&pending_id, &result.id);
        if let Some(retained) = retained
            .as_ref()
            .filter(|r| r.status == ReferenceStatus::Error)
        {
            self.retry_files
                .borrow_mut()
                .insert(retained.id.clone(), file);
        }
        self.options
            .store
            .patch(StatePatch::new().references(merged));
        retained
    }

    async fn revoke_unretained(&self, reference: &DraftReference) {
        let Some(token) = reference.grant() else {
            return;
        };
        if !reference.is_staged() {
            return;
        }
        // Staging deduplicates: a cancelled duplicate cannot revoke a retained
        // image.
        let retained = self.options.store.read(|state| {
            state
                .references
                .iter()
                .any(|entry| entry.is_staged() && entry.token.as_deref() == Some(token))
        });
        if retained {
            return;
        }
        self.revoke(vec![reference.clone()]).await;
    }

    fn merge_and_validate(
        &self,
        current: &[DraftReference],
        incoming: &[DraftReference],
    ) -> Vec<DraftReference> {
        let capabilities = self.reference_inputs();
        let mut count = 0u64;
        let mut bytes = 0f64;
        merge_agent_references(current, incoming)
            .into_iter()
            .map(|original| {
                if !original.is_ready() {
                    return original;
                }
                let reference = self.with_capability_status(&original);
                let Some(capabilities) = capabilities.as_ref().filter(|_| reference.is_ready())
                else {
                    return reference;
                };
                count += 1;
                bytes += reference.byte_size();
                if capabilities
                    .limits
                    .max_count
                    .is_some_and(|max| count as f64 > max)
                {
                    return reference.failed(ReferenceError::new(
                        "reference-limit",
                        "This Agent's reference count limit was reached.",
                    ));
                }
                if capabilities
                    .limits
                    .max_total_bytes
                    .is_some_and(|max| bytes > max)
                {
                    return reference.failed(ReferenceError::new(
                        "reference-total-size",
                        "This Agent's total reference size limit was reached.",
                    ));
                }
                reference
            })
            .collect()
    }

    fn revoke(&self, references: Vec<DraftReference>) -> LocalBoxFuture<'static, ()> {
        self.release_previews(&references);
        let mut tokens: Vec<String> = Vec::new();
        for reference in &references {
            if reference.is_staged()
                && let Some(token) = reference.grant()
                && !tokens.iter().any(|t| t == token)
            {
                tokens.push(token.to_string());
            }
        }
        if tokens.is_empty() {
            return Box::pin(async {});
        }
        let bridge = (self.options.bridge_provider)();
        let Some(bridge) = bridge.filter(|b| b.supports(AgentOperation::RevokeReferences)) else {
            return Box::pin(async {});
        };
        let call = bridge.revoke_attachments(RevokeReferences {
            root_path: self.options.workspace_root.clone(),
            tokens,
        });
        Box::pin(async move {
            let _ = call.await;
        })
    }

    fn rotate(self: &Rc<Self>, references: Vec<DraftReference>) -> LocalBoxFuture<'static, ()> {
        self.acquisition_generation
            .set(self.acquisition_generation.get() + 1);
        let revoke = self.revoke(references);
        let inner = self.clone();
        Box::pin(async move {
            revoke.await;
            inner.retry_files.borrow_mut().clear();
            inner.retry_workspace_paths.borrow_mut().clear();
            inner.previews.borrow_mut().clear();
            *inner.epoch.borrow_mut() = create_reference_epoch();
        })
    }

    fn release_previews(&self, references: &[DraftReference]) {
        self.previews
            .borrow_mut()
            .delete_many(references.iter().map(|r| r.id.as_str()));
    }

    fn reference_inputs(&self) -> Option<ReferenceInputCapabilities> {
        self.options.store.read(|state| {
            state
                .inspection
                .as_ref()
                .and_then(|i| i.capabilities.as_ref())
                .and_then(|c| c.reference_inputs.clone())
        })
    }

    fn with_capability_status(&self, reference: &DraftReference) -> DraftReference {
        match unsupported_reference_failure(reference, self.reference_inputs().as_ref()) {
            Some(failure) => reference.clone().failed(failure),
            None => reference.clone(),
        }
    }
}

fn create_reference_epoch() -> String {
    random_uuid()
}

fn file_mime(file: &AgentFile) -> String {
    if file.mime.is_empty() {
        "application/octet-stream".into()
    } else {
        file.mime.clone()
    }
}

fn file_size(file: &AgentFile) -> f64 {
    if file.size.is_finite() { file.size } else { 0. }
}

fn pending_attachment(file: &AgentFile) -> DraftReference {
    DraftReference {
        id: format!("pending-{}", create_reference_epoch()),
        kind: ReferenceKind::StagedAttachment,
        display_name: safe_reference_name(&file.name),
        mime: Some(file_mime(file)),
        size: Some(file_size(file)),
        status: ReferenceStatus::Resolving,
        ..DraftReference::default()
    }
}

fn attachment_reference_error(file: &AgentFile, error: &AgentError) -> DraftReference {
    DraftReference {
        id: format!("error-{}", create_reference_epoch()),
        kind: ReferenceKind::StagedAttachment,
        display_name: safe_reference_name(&file.name),
        mime: Some(file_mime(file)),
        size: Some(file_size(file)),
        status: ReferenceStatus::Error,
        error: Some(reference_operation_error(error, "staging-failed")),
        ..DraftReference::default()
    }
}

fn workspace_reference_error(reference_path: &str, error: &AgentError) -> DraftReference {
    let reference_path = parse_workspace_resource_reference(reference_path)
        .map(|resource| resource.relative_path)
        .unwrap_or_else(|_| reference_path.to_string());
    let last = reference_path
        .split(['\\', '/'])
        .rfind(|segment| !segment.is_empty())
        .unwrap_or("workspace item");
    let display_name = safe_reference_name(last);
    DraftReference {
        id: format!("error-{}", create_reference_epoch()),
        kind: ReferenceKind::WorkspaceEntry,
        entry_type: Some(EntryType::File),
        relative_path: Some(display_name.clone()),
        display_name,
        status: ReferenceStatus::Error,
        error: Some(reference_operation_error(
            error,
            "workspace-resolution-failed",
        )),
        ..DraftReference::default()
    }
}

/// `unsupportedReferenceFailure(reference, capabilities)`.
fn unsupported_reference_failure(
    reference: &DraftReference,
    capabilities: Option<&ReferenceInputCapabilities>,
) -> Option<ReferenceError> {
    let Some(capabilities) = capabilities else {
        return Some(ReferenceError::new(
            "capability-unreported",
            "The selected Agent has not reported reference input support.",
        ));
    };
    let size = reference.byte_size();
    if capabilities
        .limits
        .max_bytes_per_reference
        .is_some_and(|max| size > max)
    {
        return Some(ReferenceError::new(
            "reference-size",
            "This reference exceeds the selected Agent's size limit.",
        ));
    }
    if reference.kind == ReferenceKind::WorkspaceEntry {
        let workspace = &capabilities.workspace;
        if reference
            .workspace_name
            .as_deref()
            .is_some_and(|name| !name.is_empty())
            && workspace.cross_roots != Some(true)
        {
            return Some(ReferenceError::new(
                "workspace-cross-root-unsupported",
                "The selected Agent does not accept references from another project.",
            ));
        }
        if reference.entry_type == Some(EntryType::Directory) && !workspace.directories {
            return Some(ReferenceError::new(
                "workspace-directory-unsupported",
                "The selected Agent does not accept workspace directories.",
            ));
        }
        if reference.entry_type == Some(EntryType::File) && !workspace.files {
            return Some(ReferenceError::new(
                "workspace-file-unsupported",
                "The selected Agent does not accept workspace files.",
            ));
        }
        return None;
    }
    let mime = reference.mime.clone().unwrap_or_default();
    let name = reference.display_name.clone();
    let kind = classify_agent_attachment(&mime, &name);
    let kind_limit = capabilities
        .attachments
        .of(kind)
        .and_then(|input| input.max_bytes)
        .filter(|limit| *limit != 0.);
    if let Some(limit) = kind_limit
        && size > limit
    {
        return Some(ReferenceError::new(
            "reference-size",
            "This reference exceeds the selected Agent's size limit.",
        ));
    }
    if !accepts_attachment(capabilities, &mime, &name) {
        return Some(if kind == "image" {
            ReferenceError::new(
                "image-unsupported",
                "The selected Agent does not accept image attachments.",
            )
        } else {
            ReferenceError::new(
                "file-unsupported",
                "The selected Agent does not accept this file type.",
            )
        });
    }
    None
}

/// `safeReferenceName(value)`.
fn safe_reference_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .filter(|c| !matches!(*c, '\u{0}'..='\u{1f}' | '\u{7f}'))
        .collect();
    let name = text::head16(text::trim(&cleaned), 512);
    if name.is_empty() {
        "attachment".into()
    } else {
        name.to_string()
    }
}

/// `safeReferenceError(error)`.
fn safe_reference_error(error: &AgentError) -> String {
    static REMOTE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^Error invoking remote method '[^']+':\s*(?:Error:\s*)?").expect("remote")
    });
    static NEWLINES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\r\n]+").expect("newlines"));
    let message = REMOTE.replace(&error.message, "");
    let message = NEWLINES.replace_all(&message, " ");
    let message = text::head16(&message, 500);
    if message.is_empty() {
        "The reference could not be added.".into()
    } else {
        message.to_string()
    }
}

/// `referenceOperationError(error, fallbackCode)`.
fn reference_operation_error(error: &AgentError, fallback_code: &str) -> ReferenceError {
    let message = safe_reference_error(error);
    let Some(failure) = operation_failure(error) else {
        return ReferenceError::new(fallback_code, &message);
    };
    // The client already validated the pure-data failure envelope. Keep its
    // reason through draft projection instead of misclassifying
    // authorization as file I/O.
    ReferenceError {
        code: failure.code.clone(),
        message,
        stage: failure.stage.clone().filter(|stage| !stage.is_empty()),
        retryable: Some(failure.retryable),
    }
}
