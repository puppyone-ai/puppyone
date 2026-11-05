//! `application/AgentReferenceDraftManager.ts`: owns draft reference
//! acquisition, validation, retry material and grant release.
//!
//! The product's `async` methods run until their first `await` when
//! called; these return a future after doing the same synchronous work
//! (generation capture, bridge dispatch), so a later reset still cancels
//! them the same way.
use super::agent_client_port::{AgentClientPort, AgentClientProvider, AgentFile, require_bridge};
use super::agent_controller_state::StatePatch;
use super::agent_controller_values::merge_agent_references;
use super::agent_error::{format_agent_error, operation_failure};
use super::agent_reference_preview_store::{
    AgentReferencePreviewStore, AgentReferenceVisualPreview, create_agent_file_visual_preview,
    release,
};
use super::agent_session_controller::AgentControllerStore;
use super::ui_runtime::{UiRuntime, detach, random_uuid};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js;
use crate::agent::contract::reference_input::{
    accepts_agent_attachment, classify_agent_attachment,
};
use crate::agent::contract::workspace_resource_reference::parse_workspace_resource_reference;
use futures_util::future::{LocalBoxFuture, join_all};
use regex::Regex;
use serde_json::{Value, json};
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

fn id_of(reference: &Value) -> &str {
    reference["id"].as_str().unwrap_or_default()
}

fn ready_ids(references: &[Value]) -> HashSet<String> {
    references.iter().map(|r| id_of(r).to_string()).collect()
}

fn newly_ready(merged: &[Value], existing: &HashSet<String>) -> usize {
    merged
        .iter()
        .filter(|r| r["status"] == "ready" && !existing.contains(id_of(r)))
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

    pub fn add_workspace_paths(
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
            &["resolveAgentWorkspaceReferences"],
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
        let resolutions: Vec<LocalBoxFuture<'static, Vec<Value>>> = unique_paths
            .iter()
            .map(|path| {
                let call = bridge.call(
                    "resolveAgentWorkspaceReferences",
                    json!({ "rootPath": inner.options.workspace_root, "paths": [path] }),
                );
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
                            let references = references.as_array().cloned().unwrap_or_default();
                            match (preview, references.first()) {
                                (Some(preview), Some(first)) => {
                                    inner.previews.borrow_mut().set(id_of(first), Some(preview))
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
                                .insert(id_of(&reference).to_string(), path);
                            inner.previews.borrow_mut().set(id_of(&reference), preview);
                            vec![reference]
                        }
                    }
                }) as LocalBoxFuture<'static, Vec<Value>>
            })
            .collect();
        Box::pin(async move {
            let resolved = join_all(resolutions).await;
            if generation != inner.acquisition_generation.get() {
                return Ok(0);
            }
            let references: Vec<Value> = resolved.into_iter().flatten().collect();
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

    pub fn pick_workspace_references(&self) -> Count {
        let inner = self.0.clone();
        let bridge = match require_bridge(
            &inner.options.bridge_provider,
            &["pickAgentWorkspaceReferences"],
        ) {
            Ok(bridge) => bridge,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        let call = bridge.call(
            "pickAgentWorkspaceReferences",
            json!({ "rootPath": inner.options.workspace_root }),
        );
        Box::pin(async move {
            match call.await {
                Ok(references) => {
                    let references: Vec<Value> = references
                        .as_array()
                        .map(|r| r.iter().map(|r| inner.with_capability_status(r)).collect())
                        .unwrap_or_default();
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

    pub fn add_path_text_or_draft(&self, text: &str) -> LocalBoxFuture<'static, AgentResult<bool>> {
        let inner = self.0.clone();
        let value = js::trim(text).to_string();
        if value.is_empty() {
            return Box::pin(async { Ok(false) });
        }
        let bridge = match require_bridge(
            &inner.options.bridge_provider,
            &["resolveAgentWorkspaceReferences"],
        ) {
            Ok(bridge) => bridge,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        let call = bridge.call(
            "resolveAgentWorkspaceReferences",
            json!({ "rootPath": inner.options.workspace_root, "paths": [value] }),
        );
        Box::pin(async move {
            let added: AgentResult<bool> = async {
                let references: Vec<Value> = call
                    .await?
                    .as_array()
                    .map(|r| r.iter().map(|r| inner.with_capability_status(r)).collect())
                    .unwrap_or_default();
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

    pub fn stage_external_files(&self, files: Vec<AgentFile>) -> Count {
        self.0.stage_external_files(files)
    }

    pub fn remove(&self, id: &str) {
        let inner = &self.0;
        let references = inner.options.store.read(|state| state.references.clone());
        let Some(reference) = references.iter().find(|r| id_of(r) == id).cloned() else {
            return;
        };
        inner.retry_files.borrow_mut().remove(id);
        inner.retry_workspace_paths.borrow_mut().remove(id);
        inner.options.store.patch(
            StatePatch::new()
                .references(references.into_iter().filter(|r| id_of(r) != id).collect()),
        );
        detach(&inner.options.runtime, inner.revoke(vec![reference]));
    }

    pub fn retry(&self, id: &str) {
        let inner = self.0.clone();
        let references = inner.options.store.read(|state| state.references.clone());
        let Some(reference) = references.iter().find(|r| id_of(r) == id).cloned() else {
            return;
        };
        if reference["status"] != "error" {
            return;
        }
        let file = inner.retry_files.borrow_mut().remove(id);
        let workspace_path = inner.retry_workspace_paths.borrow_mut().remove(id);
        inner.options.store.patch(
            StatePatch::new()
                .references(references.into_iter().filter(|r| id_of(r) != id).collect()),
        );
        let revoke = inner.revoke(vec![reference.clone()]);
        let manager = self.clone();
        detach(&inner.options.runtime, async move {
            revoke.await;
            if let Some(file) = file {
                let _ = manager.stage_external_files(vec![file]).await;
            } else if reference["kind"] == "workspace-entry" {
                let path = workspace_path
                    .or_else(|| reference["resourceUri"].as_str().map(str::to_string))
                    .unwrap_or_else(|| js::string_or_empty(reference.get("relativePath")));
                let _ = manager.add_workspace_paths(vec![path], Vec::new()).await;
            }
        });
    }

    pub fn merge_and_validate(&self, current: &[Value], incoming: &[Value]) -> Vec<Value> {
        self.0.merge_and_validate(current, incoming)
    }

    pub fn revoke(&self, references: Vec<Value>) -> LocalBoxFuture<'static, ()> {
        self.0.revoke(references)
    }

    pub fn rotate(&self, references: Vec<Value>) -> LocalBoxFuture<'static, ()> {
        self.0.rotate(references)
    }

    pub fn reset(&self, references: Vec<Value>) -> LocalBoxFuture<'static, ()> {
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

    pub fn release_previews(&self, references: &[Value]) {
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
}

impl Inner {
    fn stage_external_files(self: &Rc<Self>, files: Vec<AgentFile>) -> Count {
        let bridge = match require_bridge(&self.options.bridge_provider, &["stageAgentAttachments"])
        {
            Ok(bridge) => bridge,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        let generation = self.acquisition_generation.get();
        let epoch = self.epoch.borrow().clone();
        let selected: Vec<AgentFile> = files.into_iter().take(32).collect();
        let pending: Vec<Value> = selected.iter().map(pending_attachment).collect();
        for (reference, file) in pending.iter().zip(&selected) {
            self.previews
                .borrow_mut()
                .set(id_of(reference), create_agent_file_visual_preview(file));
        }
        let current = self.options.store.read(|state| state.references.clone());
        let existing = ready_ids(&current);
        let merged = self.merge_and_validate(&current, &pending);
        self.options
            .store
            .patch(StatePatch::new().references(merged).error(None));
        let stagings: Vec<LocalBoxFuture<'static, Option<Value>>> = selected
            .into_iter()
            .zip(pending)
            .map(|(file, pending)| {
                let pending_id = id_of(&pending).to_string();
                let call = bridge.call(
                    "stageAgentAttachments",
                    json!({ "rootPath": self.options.workspace_root, "epoch": epoch, "files": [file.to_value()] }),
                );
                let inner = self.clone();
                let bridge = bridge.clone();
                Box::pin(async move { inner.complete_staging(bridge, call, file, pending_id, generation).await })
                    as LocalBoxFuture<'static, Option<Value>>
            })
            .collect();
        let inner = self.clone();
        Box::pin(async move {
            let completed: HashSet<String> = join_all(stagings)
                .await
                .into_iter()
                .flatten()
                .map(|r| id_of(&r).to_string())
                .collect();
            Ok(inner.options.store.read(|state| {
                state
                    .references
                    .iter()
                    .filter(|r| {
                        r["status"] == "ready"
                            && completed.contains(id_of(r))
                            && !existing.contains(id_of(r))
                    })
                    .count()
            }))
        })
    }

    async fn complete_staging(
        self: Rc<Self>,
        bridge: Rc<dyn AgentClientPort>,
        call: LocalBoxFuture<'static, AgentResult<Value>>,
        file: AgentFile,
        pending_id: String,
        generation: u64,
    ) -> Option<Value> {
        let is_current = || {
            generation == self.acquisition_generation.get()
                && self.options.store.read(|state| {
                    state
                        .references
                        .iter()
                        .any(|entry| id_of(entry) == pending_id)
                })
        };
        let staged: AgentResult<Option<Value>> = async {
            let reference = call
                .await?
                .get(0)
                .cloned()
                .filter(js::truthy)
                .ok_or_else(|| AgentError::new("The selected attachment was not staged."))?;
            if !is_current() {
                self.revoke_unretained(&reference).await;
                self.previews.borrow_mut().delete(&pending_id);
                return Ok(None);
            }
            let supported = self.with_capability_status(&reference);
            let token = supported["token"]
                .as_str()
                .filter(|t| !t.is_empty())
                .map(str::to_string);
            if supported["status"] == "error"
                && supported["kind"] == "staged-attachment"
                && let Some(token) = token
            {
                if bridge.implements("revokeAgentAttachments") {
                    bridge
                        .call(
                            "revokeAgentAttachments",
                            json!({ "rootPath": self.options.workspace_root, "tokens": [token] }),
                        )
                        .await?;
                }
                let mut result = supported;
                js::delete(&mut result, "token");
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
        let replaced: Vec<Value> = self.options.store.read(|state| {
            state
                .references
                .iter()
                .map(|entry| {
                    if id_of(entry) == pending_id {
                        result.clone()
                    } else {
                        entry.clone()
                    }
                })
                .collect()
        });
        let merged = self.merge_and_validate(&[], &replaced);
        let retained = merged
            .iter()
            .find(|entry| entry["id"] == result["id"])
            .cloned();
        self.previews
            .borrow_mut()
            .move_preview(&pending_id, id_of(&result));
        if let Some(retained) = retained.as_ref().filter(|r| r["status"] == "error") {
            self.retry_files
                .borrow_mut()
                .insert(id_of(retained).to_string(), file);
        }
        self.options
            .store
            .patch(StatePatch::new().references(merged));
        retained
    }

    async fn revoke_unretained(&self, reference: &Value) {
        let Some(token) = reference["token"].as_str().filter(|t| !t.is_empty()) else {
            return;
        };
        if reference["kind"] != "staged-attachment" {
            return;
        }
        // Staging deduplicates: a cancelled duplicate cannot revoke a retained
        // image.
        let retained = self.options.store.read(|state| {
            state
                .references
                .iter()
                .any(|entry| entry["kind"] == "staged-attachment" && entry["token"] == token)
        });
        if retained {
            return;
        }
        self.revoke(vec![reference.clone()]).await;
    }

    fn merge_and_validate(&self, current: &[Value], incoming: &[Value]) -> Vec<Value> {
        let capabilities = self.reference_inputs();
        let mut count = 0u64;
        let mut bytes = 0f64;
        merge_agent_references(current, incoming)
            .into_iter()
            .map(|original| {
                if original["status"] != "ready" {
                    return original;
                }
                let reference = self.with_capability_status(&original);
                let Some(capabilities) = capabilities
                    .as_ref()
                    .filter(|_| reference["status"] == "ready")
                else {
                    return reference;
                };
                count += 1;
                bytes += reference["size"].as_f64().unwrap_or(0.);
                if count as f64 > js::to_number(Some(&capabilities["limits"]["maxCount"])) {
                    return reference_capability_error(
                        &reference,
                        "reference-limit",
                        "This Agent's reference count limit was reached.",
                    );
                }
                if bytes > js::to_number(Some(&capabilities["limits"]["maxTotalBytes"])) {
                    return reference_capability_error(
                        &reference,
                        "reference-total-size",
                        "This Agent's total reference size limit was reached.",
                    );
                }
                reference
            })
            .collect()
    }

    fn revoke(&self, references: Vec<Value>) -> LocalBoxFuture<'static, ()> {
        self.release_previews(&references);
        let mut tokens: Vec<String> = Vec::new();
        for reference in &references {
            if reference["kind"] == "staged-attachment"
                && let Some(token) = reference["token"].as_str().filter(|t| !t.is_empty())
                && !tokens.iter().any(|t| t == token)
            {
                tokens.push(token.to_string());
            }
        }
        if tokens.is_empty() {
            return Box::pin(async {});
        }
        let bridge = (self.options.bridge_provider)();
        let Some(bridge) = bridge.filter(|b| b.implements("revokeAgentAttachments")) else {
            return Box::pin(async {});
        };
        let call = bridge.call(
            "revokeAgentAttachments",
            json!({ "rootPath": self.options.workspace_root, "tokens": tokens }),
        );
        Box::pin(async move {
            let _ = call.await;
        })
    }

    fn rotate(self: &Rc<Self>, references: Vec<Value>) -> LocalBoxFuture<'static, ()> {
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

    fn release_previews(&self, references: &[Value]) {
        self.previews
            .borrow_mut()
            .delete_many(references.iter().map(id_of));
    }

    fn reference_inputs(&self) -> Option<Value> {
        self.options.store.read(|state| {
            state
                .inspection
                .as_ref()
                .map(|i| i["capabilities"]["referenceInputs"].clone())
                .filter(js::truthy)
        })
    }

    fn with_capability_status(&self, reference: &Value) -> Value {
        match unsupported_reference_failure(reference, self.reference_inputs().as_ref()) {
            Some(failure) => {
                let mut reference = reference.clone();
                reference["status"] = json!("error");
                reference["error"] = failure;
                reference
            }
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

fn file_size(file: &AgentFile) -> Value {
    js::number(if file.size.is_finite() { file.size } else { 0. })
}

fn pending_attachment(file: &AgentFile) -> Value {
    json!({
        "id": format!("pending-{}", create_reference_epoch()),
        "kind": "staged-attachment",
        "displayName": safe_reference_name(&file.name),
        "mime": file_mime(file),
        "size": file_size(file),
        "status": "resolving",
    })
}

fn attachment_reference_error(file: &AgentFile, error: &AgentError) -> Value {
    json!({
        "id": format!("error-{}", create_reference_epoch()),
        "kind": "staged-attachment",
        "displayName": safe_reference_name(&file.name),
        "mime": file_mime(file),
        "size": file_size(file),
        "status": "error",
        "error": reference_operation_error(error, "staging-failed"),
    })
}

fn workspace_reference_error(reference_path: &str, error: &AgentError) -> Value {
    let reference_path = parse_workspace_resource_reference(reference_path)
        .map(|resource| resource.relative_path)
        .unwrap_or_else(|_| reference_path.to_string());
    let last = reference_path
        .split(['\\', '/'])
        .rfind(|segment| !segment.is_empty())
        .unwrap_or("workspace item");
    let display_name = safe_reference_name(last);
    json!({
        "id": format!("error-{}", create_reference_epoch()),
        "kind": "workspace-entry",
        "entryType": "file",
        "relativePath": display_name,
        "displayName": display_name,
        "status": "error",
        "error": reference_operation_error(error, "workspace-resolution-failed"),
    })
}

fn reference_failure(code: &str, message: &str) -> Value {
    json!({ "code": code, "message": message })
}

/// `unsupportedReferenceFailure(reference, capabilities)`.
fn unsupported_reference_failure(reference: &Value, capabilities: Option<&Value>) -> Option<Value> {
    let Some(capabilities) = capabilities else {
        return Some(reference_failure(
            "capability-unreported",
            "The selected Agent has not reported reference input support.",
        ));
    };
    let size = reference["size"].as_f64().unwrap_or(0.);
    if size > js::to_number(Some(&capabilities["limits"]["maxBytesPerReference"])) {
        return Some(reference_failure(
            "reference-size",
            "This reference exceeds the selected Agent's size limit.",
        ));
    }
    if reference["kind"] == "workspace-entry" {
        let workspace = &capabilities["workspace"];
        if js::truthy(&reference["workspaceName"]) && workspace["crossRoots"] != true {
            return Some(reference_failure(
                "workspace-cross-root-unsupported",
                "The selected Agent does not accept references from another project.",
            ));
        }
        if reference["entryType"] == "directory" && !js::truthy(&workspace["directories"]) {
            return Some(reference_failure(
                "workspace-directory-unsupported",
                "The selected Agent does not accept workspace directories.",
            ));
        }
        if reference["entryType"] == "file" && !js::truthy(&workspace["files"]) {
            return Some(reference_failure(
                "workspace-file-unsupported",
                "The selected Agent does not accept workspace files.",
            ));
        }
        return None;
    }
    let mime = js::string_or_empty(reference.get("mime"));
    let name = js::string_or_empty(reference.get("displayName"));
    let kind = classify_agent_attachment(&mime, &name);
    let kind_limit = &capabilities["attachments"][kind]["maxBytes"];
    if js::truthy(kind_limit) && size > js::to_number(Some(kind_limit)) {
        return Some(reference_failure(
            "reference-size",
            "This reference exceeds the selected Agent's size limit.",
        ));
    }
    if !accepts_agent_attachment(capabilities, &mime, &name) {
        return Some(if kind == "image" {
            reference_failure(
                "image-unsupported",
                "The selected Agent does not accept image attachments.",
            )
        } else {
            reference_failure(
                "file-unsupported",
                "The selected Agent does not accept this file type.",
            )
        });
    }
    None
}

fn reference_capability_error(reference: &Value, code: &str, message: &str) -> Value {
    let mut reference = reference.clone();
    reference["status"] = json!("error");
    reference["error"] = reference_failure(code, message);
    reference
}

/// `safeReferenceName(value)`.
fn safe_reference_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .filter(|c| !matches!(*c, '\u{0}'..='\u{1f}' | '\u{7f}'))
        .collect();
    let name = js::head16(js::trim(&cleaned), 512);
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
    let message = js::head16(&message, 500);
    if message.is_empty() {
        "The reference could not be added.".into()
    } else {
        message.to_string()
    }
}

/// `referenceOperationError(error, fallbackCode)`.
fn reference_operation_error(error: &AgentError, fallback_code: &str) -> Value {
    let message = safe_reference_error(error);
    let Some(failure) = operation_failure(error) else {
        return json!({ "code": fallback_code, "message": message });
    };
    // The client already validated the pure-data failure envelope. Keep its
    // reason through draft projection instead of misclassifying
    // authorization as file I/O.
    let mut value =
        json!({ "code": failure["code"], "message": message, "retryable": failure["retryable"] });
    if js::truthy(&failure["stage"]) {
        value["stage"] = failure["stage"].clone();
    }
    value
}
