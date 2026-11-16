//! Single-Working-Copy state machine (`DP-40`, `DP-41`, `DP-42`, `DP-43`, `DP-44`).
//!
//! Owns ONLY one Working Copy: its [`DocumentEditingSession`], snapshot
//! handshake, deadline-driven autosave/timeout timers (zero `100ms` periodic
//! polling), bounded storage I/O dispatch, 3-way external reconciliation, and
//! crash-safe unflushable draft journaling. Workspace folder opening, Cloud
//! opening progress and directory tree listings stay outside `WorkingCopy`.

use super::{
    ClientMessage, HostMessage, Intent, OBSERVATION_RETRIES, Phase, PresentationKey, Resource,
    SAVED_STATUS_DURATION, SaveStatus, WorkspaceAssets, auto_save,
    drafts::{self, DraftCoordinator, RecoveryPlan},
    io::{self, IoLane},
    read_budget, reconcile,
};
use crate::{
    editor::{
        document_session::{
            document_editing_session::DocumentEditingSession,
            types::{
                Completion, ConflictState, SessionError, Snapshot, StorageObservation,
                WriteOutcome as SessionWriteOutcome,
            },
        },
        text::buffer::Buffer,
    },
    platform::{
        draft_journal::{DraftEntry, DraftJournal},
        tasks::Owner,
    },
    wake::Wake,
    workspace::{self, Document, MAX_TEXT_BYTES, Workspace},
};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        mpsc::{self, Receiver, Sender},
    },
    time::{Duration, Instant},
};

/// Exact snapshot handshake timeout (`DP-42`); registered once as a real
/// deadline on [`Wake::after`] rather than polled every `100ms`.
pub const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(5);

const MARKDOWN_ASSET_MAX_BYTES: u64 = 32 * 1024 * 1024;

pub(super) enum CopyCompleted {
    File(workspace::Result<(Document, Option<DraftEntry>)>),
    Resource(PathBuf, workspace::Result<workspace::PreviewResource>),
    Save {
        id: String,
        sequence: u64,
        result: workspace::Result<workspace::WriteOutcome>,
    },
    Observed {
        id: String,
        generation: u64,
        result: workspace::Result<Document>,
    },
    ObservationDeferred {
        id: String,
        generation: u64,
    },
    Rebound {
        id: String,
        generation: u64,
        result: workspace::Result<Document>,
    },
    ResourceRebound(PathBuf, workspace::Result<workspace::PreviewResource>),
    ConflictCopy {
        id: String,
        result: workspace::Result<PathBuf>,
    },
    DraftPersisted,
}

pub struct WorkingCopy {
    /// Window/task admission scope (`EditorTaskOwner.scope`).
    pub task_scope: String,
    /// Unique Working Copy instance prefix so independent copies never collide on `Owner`.
    owner_id: String,
    pub workspace: Option<Arc<Workspace>>,
    pub document: Option<Document>,
    /// Open non-text preview resource (mutually exclusive with `document`).
    pub resource: Option<Resource>,
    pub dirty: bool,
    pub revision: u64,
    pub phase: Phase,
    pub error: Option<String>,
    /// Last autosave failure detail; typed category is in `save_error_kind` (`DP-43`).
    pub save_error: Option<String>,
    pub save_error_kind: Option<workspace::ErrorKind>,
    /// Non-blocking neutral notice counter for `DP-04` local disk overwrites.
    pub local_overwrite_notice: Option<u64>,
    /// Non-blocking notice counter when an unflushable draft was restored from
    /// [`DraftJournal`] on open (`DP-11`).
    pub recovered_draft_notice: Option<u64>,
    /// Set when `Save As Copy` (`DP-05` Exit 4) creates `<stem> (conflict copy).<ext>`.
    pub conflict_copy_created: Option<PathBuf>,
    pub status: String,
    pub allow_quit: bool,
    pub outgoing: Vec<HostMessage>,
    pub file_window: bool,

    pub(super) deferred_document: Option<Document>,
    pub(super) saved_at: Option<Instant>,
    pub(super) saving_since: Option<Instant>,
    pub(super) save_announced: bool,
    pub(super) auto_save: auto_save::Scheduler,
    pub(super) drafts: DraftCoordinator,
    pub(super) serial: u64,
    pub(super) notice_serial: u64,
    pub(super) session: Option<DocumentEditingSession>,
    pub(super) autosave_request: Option<(u64, u64, Instant)>,
    pub(super) observing: bool,
    pub(super) read_generation: u64,
    pub(super) watch: Option<workspace::Subscription>,
    pub(super) observation_pending: bool,
    pub(super) observation_retry: Option<Instant>,
    pub(super) observation_failures: usize,
    pub(super) copy_tx: Sender<CopyCompleted>,
    pub(super) copy_rx: Receiver<CopyCompleted>,
}

impl Default for WorkingCopy {
    fn default() -> Self {
        let (copy_tx, copy_rx) = mpsc::channel();
        let id = uuid::Uuid::new_v4();
        Self {
            task_scope: format!("documents-{id}"),
            owner_id: id.to_string(),
            workspace: None,
            document: None,
            resource: None,
            dirty: false,
            revision: 0,
            phase: Phase::Idle,
            error: None,
            save_error: None,
            save_error_kind: None,
            local_overwrite_notice: None,
            recovered_draft_notice: None,
            conflict_copy_created: None,
            status: "Open a folder to start".into(),
            allow_quit: false,
            outgoing: Vec::new(),
            file_window: false,
            deferred_document: None,
            saved_at: None,
            saving_since: None,
            save_announced: false,
            auto_save: Default::default(),
            drafts: DraftCoordinator::default(),
            serial: 0,
            notice_serial: 0,
            session: None,
            autosave_request: None,
            observing: false,
            read_generation: 0,
            watch: None,
            observation_pending: false,
            observation_retry: None,
            observation_failures: 0,
            copy_tx,
            copy_rx,
        }
    }
}

impl WorkingCopy {
    pub fn in_workspace(workspace: Arc<Workspace>) -> Self {
        Self {
            workspace: Some(workspace),
            ..Self::default()
        }
    }

    fn task_owner(&self, target: impl std::fmt::Display, generation: u64) -> Owner {
        Owner::new(
            self.task_scope.clone(),
            format!("{}:{target}", self.owner_id),
            generation,
        )
    }

    pub fn set_draft_journal(&mut self, journal: Option<DraftJournal>) {
        self.drafts.journal = journal;
    }

    pub fn draft_journal(&self) -> Option<&DraftJournal> {
        self.drafts.journal.as_ref()
    }

    pub fn draft_saving(&self) -> bool {
        self.drafts.inflight > 0
    }

    /// Background persistence does not block keyboard input or native commands.
    pub fn busy(&self) -> bool {
        !matches!(self.phase, Phase::Idle | Phase::AwaitComposition { .. })
    }

    /// The open file's session id and workspace-relative path, text or not.
    pub fn opened(&self) -> Option<(&str, &Path)> {
        match (&self.document, &self.resource) {
            (Some(doc), _) => Some((&doc.id, &doc.relative)),
            (None, Some(resource)) => Some((&resource.id, &resource.relative)),
            (None, None) => None,
        }
    }

    /// `EditorSaveButton`'s status for the open document.
    pub fn save_status(&self) -> SaveStatus {
        let conflict = self.cloud_conflict();
        if self.save_error.is_some() && !conflict {
            SaveStatus::Failed
        } else if self.save_announced && self.session.as_ref().is_some_and(|s| s.has_active_write())
        {
            SaveStatus::Saving
        } else if self
            .saved_at
            .is_some_and(|at| at.elapsed() < SAVED_STATUS_DURATION)
        {
            SaveStatus::Saved
        } else {
            SaveStatus::Clean
        }
    }

    /// The Save failed chip: write the current input again.
    pub fn retry_save(&mut self, ctx: &Wake) {
        if self.session.as_mut().is_some_and(|s| s.retry()) {
            self.save_error = None;
            self.save_error_kind = None;
            self.auto_save.cancel();
            self.drafts.sync_schedule(
                self.document.as_ref(),
                self.session.as_ref(),
                Instant::now(),
            );
            ctx.notify();
        }
    }

    /// Window blur/hidden: flush pending typing in place without freezing input.
    pub fn flush_pending_auto_save(&mut self, ctx: &Wake) {
        if self.auto_save.flush() {
            self.poll_copy(ctx, Instant::now());
        }
    }

    /// Flushes any pending unflushable draft to [`DraftJournal`] immediately
    /// (for example when closing with unsaved unflushable changes).
    pub fn flush_unflushable_draft(&mut self) {
        if let (Some(doc), Some(session)) = (&self.document, &self.session)
            && let Some((journal, entry)) =
                self.drafts
                    .take_due_entry(doc, session, Instant::now(), true)
        {
            let _ = journal.write_entry(&entry);
        }
    }

    pub fn saving(&self) -> bool {
        self.session.as_ref().is_some_and(|s| !s.drained()) || self.autosave_request.is_some()
    }

    pub fn cloud_conflict(&self) -> bool {
        self.session.as_ref().is_some_and(|s| s.conflicted())
    }

    /// Returns the structured conflict state `(base, ours, theirs)` when a
    /// hosted conflict is pending (`DP-05` `Compare` exit).
    pub fn conflict_state(&self) -> Option<&ConflictState> {
        self.session.as_ref()?.conflict.as_ref()
    }

    /// Exit 3 (`Accept Remote` / `Command::ReloadCloudBaseline`): adopts the
    /// newer remote baseline as an undoable external step and clears conflict (`DP-05`).
    pub fn reload_cloud_baseline(&mut self) {
        let Some(session) = self.session.as_mut() else {
            return;
        };
        let Some(remote_text) = session.reload_external() else {
            return;
        };
        if let Some(mut doc) = self.deferred_document.take() {
            doc.text = remote_text.as_str().to_owned();
            self.document = Some(doc);
        } else if let Some(doc) = &mut self.document {
            doc.text = remote_text.as_str().to_owned();
        }
        if let Some(doc) = self.document.clone() {
            self.remove_draft_entry(&doc);
        }
        self.error = None;
        self.save_error = None;
        self.save_error_kind = None;
        self.sync_state();
        self.show_storage_update(None);
    }

    /// Exit 2 (`Keep Mine` / `Command::KeepLocalCloudDraft`): rebases `ours`
    /// onto `remote_version` (`deferred_document`) and dispatches a conditional
    /// write immediately (`DP-05`).
    pub fn keep_local_cloud_draft(&mut self, ctx: &Wake) {
        let Some(session) = self.session.as_mut() else {
            return;
        };
        let Some(ours) = session.keep_local() else {
            return;
        };
        if let Some(mut remote_doc) = self.deferred_document.take() {
            let remote_baseline = remote_doc.text.clone();
            remote_doc.text = ours.as_str().to_owned();
            let doc_id = remote_doc.id.clone();
            self.document = Some(remote_doc);
            self.outgoing.push(HostMessage::Saved {
                id: doc_id,
                revision: 0,
                text: remote_baseline,
            });
        }
        self.error = None;
        self.save_error = None;
        self.save_error_kind = None;
        self.sync_state();
        self.pump(ctx);
        if self.autosave_request.is_none()
            && self
                .session
                .as_ref()
                .is_some_and(|s| s.needs_snapshot && !s.has_active_write())
        {
            self.request_autosave_snapshot(Instant::now(), ctx);
        }
        ctx.notify();
    }

    /// Exit 4 (`Save As Copy` / `Command::SaveConflictCopy`): writes `ours` to
    /// `<stem> (conflict copy).<ext>` in the workspace and reloads the original
    /// document to `theirs` (`DP-05`).
    pub fn save_conflict_copy(&mut self, ctx: &Wake) {
        if !self.cloud_conflict() {
            return;
        }
        let (Some(ws), Some(doc), Some(session)) =
            (self.workspace.clone(), self.document.clone(), &self.session)
        else {
            return;
        };
        let ours = session.latest_draft_buffer();
        let parent = doc.relative.parent().map(PathBuf::from).unwrap_or_default();
        let file_name = doc
            .relative
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "untitled".into());
        let id = doc.id.clone();
        let tx = self.copy_tx.clone();
        let wake = ctx.clone();
        let owner = self.task_owner(
            format!("conflict-copy:{}", doc.relative.to_string_lossy()),
            self.read_generation,
        );
        let max_bytes = (ws.text_limit() as u64).max(1);
        let input_bytes = (ours.len() as u64).min(max_bytes);

        io::submit_admitted(
            owner,
            "document-conflict-copy",
            input_bytes,
            max_bytes,
            IoLane::Save,
            move |lease_res| {
                let lease = match lease_res {
                    Ok(lease) => lease,
                    Err(rejection) => {
                        let err = workspace::Error::new(
                            workspace::ErrorKind::Unsupported,
                            rejection.to_string(),
                        );
                        let _ = tx.send(CopyCompleted::ConflictCopy {
                            id,
                            result: Err(err),
                        });
                        wake.notify();
                        return;
                    }
                };
                if lease.cancelled() {
                    return;
                }
                let text = ours.as_str();
                let mut result = Err(workspace::Error::new(
                    workspace::ErrorKind::AlreadyExists,
                    crate::localization::t("native.workspace.nameExhausted"),
                ));
                for index in 1..=100 {
                    let candidate_name = reconcile::conflict_copy_filename(&file_name, index);
                    let candidate_rel = if parent.as_os_str().is_empty() {
                        PathBuf::from(&candidate_name)
                    } else {
                        parent.join(&candidate_name)
                    };
                    if matches!(ws.entry_exists(&candidate_rel), Ok(true)) {
                        continue;
                    }
                    match ws.create_entry(&parent, &candidate_name, false, text) {
                        Ok(created) => {
                            result = Ok(created);
                            break;
                        }
                        Err(err) if err.kind == workspace::ErrorKind::AlreadyExists => continue,
                        Err(err) => {
                            result = Err(err);
                            break;
                        }
                    }
                }
                drop(lease);
                let _ = tx.send(CopyCompleted::ConflictCopy { id, result });
                wake.notify();
            },
        );
    }

    /// `DP-31`: normalizes mixed or lone-`CR` line endings on the open document
    /// to the dominant uniform discipline (`LF` or `CRLF`), thaws the editor to
    /// read-write, and schedules saving the normalized bytes.
    pub fn normalize_open_line_endings(&mut self, ctx: &Wake) {
        let Some(doc) = &mut self.document else {
            return;
        };
        if !doc.requires_line_ending_normalization() {
            return;
        }
        doc.normalize_line_endings();
        let doc_id = doc.id.clone();
        let lossy = doc.is_lossy_readonly();
        self.ensure_session(ctx);
        if let Some(session) = &mut self.session {
            session.mark_line_ending_normalized();
        }
        self.save_error = None;
        self.save_error_kind = None;
        let now = Instant::now();
        self.auto_save.schedule(now);
        self.sync_state();
        self.outgoing.push(HostMessage::Policy {
            id: doc_id,
            lossy_readonly: lossy,
            requires_line_ending_normalization: false,
        });
        self.thaw();
        self.schedule_deadlines(ctx, now);
        ctx.notify();
    }

    pub fn dismiss_local_overwrite_notice(&mut self) {
        self.local_overwrite_notice = None;
    }

    pub fn dismiss_recovered_draft_notice(&mut self) {
        self.recovered_draft_notice = None;
    }

    pub fn take_conflict_copy_created(&mut self) -> Option<PathBuf> {
        self.conflict_copy_created.take()
    }

    pub fn clear_hosted_drafts(&self) -> usize {
        self.drafts.clear_hosted_entries()
    }

    pub(crate) fn ensure_session(&mut self, ctx: &Wake) {
        if let Some(doc) = &self.document {
            if self.session.as_ref().is_none_or(|s| s.id != doc.id) {
                let mut session =
                    DocumentEditingSession::new(doc.id.clone(), doc.text.as_str(), self.revision);
                session.cloud = self
                    .workspace
                    .as_ref()
                    .is_some_and(|ws| ws.local_root().is_none());
                self.session = Some(session);
                self.auto_save.cancel();
                self.drafts.reset();
                self.saving_since = None;
                self.save_announced = false;
                self.saved_at = None;
                self.autosave_request = None;
                self.read_generation += 1;
                self.observing = false;
                self.observation_pending = false;
                self.watch = None;
                self.start_watch(ctx);
            }
        } else {
            self.session = None;
            self.auto_save.cancel();
            self.drafts.reset();
            self.autosave_request = None;
            self.watch = None;
            self.observation_pending = false;
        }
    }

    pub(crate) fn start_watch(&mut self, ctx: &Wake) {
        if let (Some(ws), Some(doc)) = (&self.workspace, &self.document)
            && ws.capabilities().watch
            && !self.allow_quit
        {
            let wake = ctx.clone();
            match ws.watch(doc, Arc::new(move || wake.notify())) {
                Ok(watch) => self.watch = Some(watch),
                Err(error) => self.error = Some(error.to_string()),
            }
        }
    }

    pub fn observe_publication(&mut self) {
        self.revalidate();
    }

    pub fn revalidate(&mut self) {
        if self.document.is_some() {
            self.observation_pending = true;
        }
    }

    pub fn pause_watch(&mut self) {
        self.watch = None;
        self.observing = false;
    }

    pub fn resume_watch(&mut self, ctx: &Wake) {
        if self.watch.is_none() && self.document.is_some() && self.session.is_some() {
            self.observation_pending = true;
            self.start_watch(ctx);
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn watching(&self) -> bool {
        self.watch.is_some()
    }

    pub fn operation_ready(&self) -> bool {
        matches!(self.phase, Phase::Prepared)
    }

    pub fn can_prepare_operation(&self) -> bool {
        matches!(self.phase, Phase::Idle)
    }

    pub fn release_operation(&mut self, ctx: &Wake) {
        self.phase = Phase::Idle;
        self.read_generation += 1;
        self.observation_pending = false;
        self.autosave_request = None;
        self.outgoing
            .retain(|m| !matches!(m, HostMessage::Snapshot { freeze: true, .. }));
        self.thaw();
        self.start_watch(ctx);
    }

    /// Rebinds this retained Working Copy to a new lease of the same storage (`DP-01`, `DP-05`).
    pub fn rebind_workspace(&mut self, ws: Arc<Workspace>, ctx: &Wake) {
        if self
            .workspace
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &ws))
        {
            return;
        }
        self.workspace = Some(ws.clone());
        self.watch = None;
        self.observing = false;
        self.observation_pending = false;
        self.read_generation += 1;
        let tx = self.copy_tx.clone();
        let wake = ctx.clone();
        if let (Some(doc), Some(session)) = (self.document.clone(), self.session.as_ref()) {
            let id = session.id.clone();
            let generation = self.read_generation;
            let owner = self.task_owner(doc.relative.to_string_lossy(), generation);
            let budget = read_budget(&doc.relative.to_string_lossy(), &ws);
            io::submit_admitted(
                owner,
                "document-rebind",
                0,
                budget,
                IoLane::InteractiveOpen,
                move |lease_res| {
                    let Ok(lease) = lease_res else {
                        return;
                    };
                    if lease.cancelled() {
                        return;
                    }
                    let result = ws.adopt(&doc);
                    if lease.cancelled() {
                        return;
                    }
                    drop(lease);
                    let _ = tx.send(CopyCompleted::Rebound {
                        id,
                        generation,
                        result,
                    });
                    wake.notify();
                },
            );
        } else if let Some(resource) = &self.resource {
            let relative = resource.relative.clone();
            let owner = self.task_owner(relative.to_string_lossy(), self.read_generation);
            io::submit_admitted(
                owner,
                "resource-rebind",
                0,
                1,
                IoLane::InteractiveOpen,
                move |lease_res| {
                    let Ok(lease) = lease_res else {
                        return;
                    };
                    if lease.cancelled() {
                        return;
                    }
                    let result = ws.resource(&relative);
                    if lease.cancelled() {
                        return;
                    }
                    drop(lease);
                    let _ = tx.send(CopyCompleted::ResourceRebound(relative, result));
                    wake.notify();
                },
            );
        }
    }

    pub fn rebind_document(&mut self, document: Document) {
        debug_assert!(self.operation_ready());
        debug_assert_eq!(self.document.as_ref().map(|d| &d.id), Some(&document.id));
        self.outgoing.push(HostMessage::Rebind {
            id: document.id.clone(),
            name: document.relative.to_string_lossy().into_owned(),
            resource: None,
        });
        self.document = Some(document);
    }

    pub fn rebind_resource(&mut self, relative: PathBuf, preview: workspace::PreviewResource) {
        if let Some(resource) = &mut self.resource {
            resource.relative = relative;
            resource.preview = preview.clone();
            self.outgoing.push(HostMessage::Rebind {
                id: resource.id.clone(),
                name: resource.relative.to_string_lossy().into_owned(),
                resource: Some(preview),
            });
        }
    }

    pub fn remove_after_operation(&mut self, ctx: &Wake) {
        self.execute_copy(Intent::CloseFile, ctx);
    }

    pub fn cancel_quit(&mut self, ctx: &Wake) {
        let pending_quit = matches!(
            &self.phase,
            Phase::Snapshot {
                intent: Intent::Quit,
                ..
            } | Phase::AwaitComposition {
                intent: Intent::Quit
            } | Phase::Draining {
                intent: Intent::Quit
            }
        );
        if self.allow_quit || pending_quit {
            self.allow_quit = false;
            self.phase = Phase::Idle;
            self.outgoing
                .retain(|m| !matches!(m, HostMessage::Snapshot { freeze: true, .. }));
            self.thaw();
            if self.watch.is_none() {
                self.start_watch(ctx);
            }
        }
    }

    pub(crate) fn sync_state(&mut self) {
        if let Some(s) = &self.session {
            self.dirty = s.dirty;
            self.revision = s.revision;
        }
    }

    pub(super) fn begin_with<F>(&mut self, intent: Intent, ctx: &Wake, open_folder: F)
    where
        F: FnOnce(&mut Self, PathBuf, &Wake),
    {
        if !matches!(self.phase, Phase::Idle) {
            return;
        }
        self.ensure_session(ctx);
        if let (Intent::OpenFile(path), Some((_, open))) = (&intent, self.opened())
            && path == open
        {
            return;
        }
        if self.document.is_none() {
            if let Intent::OpenFolder(path) = intent {
                open_folder(self, path, ctx);
            } else {
                self.execute_copy(intent, ctx);
            }
            return;
        }
        self.autosave_request = None;
        self.serial += 1;
        self.auto_save.cancel();
        let now = Instant::now();
        self.outgoing.push(HostMessage::Snapshot {
            request: self.serial,
            freeze: true,
        });
        self.phase = Phase::Snapshot {
            request: self.serial,
            intent,
            since: now,
        };
        // `DP-42`: schedule only the exact 5s snapshot deadline, never a 100ms ticker.
        ctx.after(SNAPSHOT_TIMEOUT);
    }

    fn open_message(&self, doc: &Document, shown_text: &str, external: bool) -> HostMessage {
        let folder = self
            .workspace
            .as_ref()
            .filter(|ws| ws.local_root().is_some())
            .and_then(|ws| ws.absolute(&doc.relative).ok())
            .and_then(|p| p.parent().map(PathBuf::from));
        crate::editor::registry::set_document_folder(&doc.id, folder);

        let source = self
            .workspace
            .as_ref()
            .filter(|ws| ws.local_root().is_none() && ws.capabilities().preview)
            .map(|ws| {
                crate::platform::webview::Source(Arc::new(WorkspaceAssets {
                    workspace: ws.clone(),
                    base: doc.relative.parent().map(PathBuf::from).unwrap_or_default(),
                }))
            });
        crate::editor::registry::set_document_source(&doc.id, source);

        let assets = self
            .workspace
            .as_ref()
            .filter(|ws| ws.capabilities().preview)
            .and_then(|ws| {
                let root = ws.resource_id(Path::new("")).ok()?;
                let ws = ws.clone();
                Some(crate::editor::registry::DocumentAssets {
                    workspace: crate::editor::workbench::catalog::resource_key(&root),
                    document: doc.relative.clone(),
                    read: Arc::new(move |path: &Path| {
                        ws.resource(path).ok()?.bytes(MARKDOWN_ASSET_MAX_BYTES)
                    }),
                })
            });
        crate::editor::registry::set_document_assets(&doc.id, assets);

        HostMessage::Open {
            id: doc.id.clone(),
            name: doc.relative.to_string_lossy().into_owned(),
            text: shown_text.to_owned(),
            revision: self.revision,
            external,
        }
    }

    fn push_policy_if_needed(&mut self, doc: &Document) {
        let lossy = doc.is_lossy_readonly();
        let norm = doc.requires_line_ending_normalization();
        if lossy || norm {
            self.outgoing.push(HostMessage::Policy {
                id: doc.id.clone(),
                lossy_readonly: lossy,
                requires_line_ending_normalization: norm,
            });
        }
    }

    pub(crate) fn show_document(&mut self) {
        let (message, policy_doc) = match (&self.document, &self.resource) {
            (Some(doc), _) => (self.open_message(doc, &doc.text, false), Some(doc.clone())),
            (None, Some(resource)) => (
                HostMessage::OpenResource {
                    id: resource.id.clone(),
                    name: resource.relative.to_string_lossy().into_owned(),
                    path: resource.preview.clone(),
                },
                None,
            ),
            (None, None) => (HostMessage::Clear, None),
        };
        self.outgoing.push(message);
        if let Some(doc) = policy_doc {
            self.push_policy_if_needed(&doc);
        }
    }

    fn show_storage_update(&mut self, baseline_override: Option<String>) {
        self.saved_at = None;
        self.saving_since = None;
        self.save_announced = false;
        self.autosave_request = None;
        self.read_generation += 1;
        self.outgoing
            .retain(|m| !matches!(m, HostMessage::Snapshot { .. } | HostMessage::Saved { .. }));
        if let Some(doc) = &self.document {
            let doc_clone = doc.clone();
            let message = self.open_message(&doc_clone, &doc_clone.text, true);
            self.outgoing.push(message);
            if let Some(base_text) = baseline_override {
                self.outgoing.push(HostMessage::Saved {
                    id: doc_clone.id.clone(),
                    revision: self.revision,
                    text: base_text,
                });
            }
            self.push_policy_if_needed(&doc_clone);
        }
    }

    pub(super) fn client_with<F>(&mut self, message: ClientMessage, ctx: &Wake, open_folder: F)
    where
        F: FnOnce(&mut Self, PathBuf, &Wake),
    {
        self.ensure_session(ctx);
        let now = Instant::now();
        match message {
            ClientMessage::LiveBuffer { id, revision, text } => {
                if let Some(s) = &mut self.session
                    && s.id == id
                    && revision >= s.revision
                {
                    s.record_live_buffer(revision, text);
                    self.drafts
                        .sync_schedule(self.document.as_ref(), self.session.as_ref(), now);
                    self.schedule_deadlines(ctx, now);
                }
            }
            ClientMessage::Dirty {
                id,
                revision,
                dirty,
            } => {
                if let Some(s) = &mut self.session
                    && s.id == id
                    && revision >= s.revision
                {
                    s.local_edit(revision, dirty);
                    if s.needs_snapshot {
                        self.auto_save.schedule(now);
                    } else {
                        self.auto_save.cancel();
                    }
                    self.sync_state();
                    self.drafts
                        .sync_schedule(self.document.as_ref(), self.session.as_ref(), now);
                    if let Phase::AwaitComposition { intent } = &self.phase {
                        let intent = intent.clone();
                        self.phase = Phase::Idle;
                        self.begin_with(intent, ctx, open_folder);
                        return;
                    }
                    self.schedule_deadlines(ctx, now);
                    ctx.notify();
                }
            }
            ClientMessage::NormalizeLineEndings { id } => {
                if self.document.as_ref().is_some_and(|d| d.id == id) {
                    self.normalize_open_line_endings(ctx);
                }
            }
            ClientMessage::Deferred { request, id } => {
                if !self.document.as_ref().is_some_and(|d| d.id == id) {
                    return;
                }
                if matches!(&self.phase, Phase::Snapshot { request: expected, .. } if request == *expected)
                {
                    let Phase::Snapshot { intent, .. } =
                        std::mem::replace(&mut self.phase, Phase::Idle)
                    else {
                        unreachable!()
                    };
                    self.phase = Phase::AwaitComposition { intent };
                    self.thaw();
                } else if self
                    .autosave_request
                    .is_some_and(|(expected, _, _)| expected == request)
                {
                    self.autosave_request = None;
                    if let Some(s) = &mut self.session {
                        s.needs_snapshot = false;
                    }
                }
            }
            ClientMessage::Snapshot {
                request,
                id,
                revision,
                text,
            } => {
                if !self.document.as_ref().is_some_and(|d| d.id == id) {
                    return;
                }
                let barrier = matches!(&self.phase, Phase::Snapshot { request: expected, .. } if request == *expected);
                let automatic = self.autosave_request.is_some_and(|(expected, epoch, _)| {
                    expected == request && self.session.as_ref().is_some_and(|s| s.epoch == epoch)
                });
                if !barrier && !automatic {
                    return;
                }
                let limit = self
                    .workspace
                    .as_ref()
                    .map_or(MAX_TEXT_BYTES, |ws| ws.text_limit());
                let has_forbidden = text
                    .chunks_in(0..text.len())
                    .any(|chunk| chunk.contains(['\0', '\r']));
                if text.len() > limit || has_forbidden {
                    self.fail(crate::localization::t("native.editor.invalidSnapshot").into());
                    return;
                }
                if revision < self.revision {
                    if automatic {
                        self.autosave_request = None;
                        ctx.notify();
                    } else {
                        self.fail(crate::localization::t("native.editor.outdatedSnapshot").into());
                    }
                    return;
                }
                let snapshot = Snapshot { revision, text };
                self.session.as_mut().unwrap().enqueue(snapshot);
                self.auto_save.cancel();
                self.sync_state();
                self.drafts
                    .sync_schedule(self.document.as_ref(), self.session.as_ref(), now);
                if automatic {
                    self.autosave_request = None;
                }
                if barrier {
                    let Phase::Snapshot { intent, .. } =
                        std::mem::replace(&mut self.phase, Phase::Idle)
                    else {
                        unreachable!()
                    };
                    self.phase = Phase::Draining { intent };
                }
                self.pump_with(ctx, open_folder);
            }
            ClientMessage::Loaded { id } => {
                if self.document.as_ref().is_some_and(|d| d.id == id) {
                    self.pump_with(ctx, open_folder);
                }
            }
            ClientMessage::OpenPaths { paths } => {
                if let (Some(path), Some(_)) = (paths.first(), &self.workspace) {
                    let path = Path::new(path.trim_start_matches('/'));
                    if path
                        .components()
                        .all(|c| matches!(c, std::path::Component::Normal(_)))
                    {
                        self.begin_with(Intent::OpenFile(path.to_path_buf()), ctx, open_folder);
                    }
                }
            }
            ClientMessage::Fault { message } => {
                let message = crate::localization::tf(
                    "native.editor.fault",
                    &[(
                        "detail",
                        message.chars().take(300).collect::<String>().into(),
                    )],
                );
                if self.busy() {
                    self.fail(message);
                } else {
                    self.error = Some(message);
                    self.autosave_request = None;
                }
            }
            ClientMessage::Action { .. } => {}
        }
    }

    pub(crate) fn thaw(&mut self) {
        self.outgoing.push(HostMessage::Thaw);
    }

    pub(crate) fn fail(&mut self, message: String) {
        self.error = Some(message);
        self.phase = Phase::Idle;
        self.autosave_request = None;
        self.status = "Unable to save · input retained".into();
        self.thaw();
    }

    fn pump(&mut self, ctx: &Wake) {
        self.pump_with(ctx, |_, _, _| {});
    }

    pub(super) fn pump_with<F>(&mut self, ctx: &Wake, open_folder: F)
    where
        F: FnOnce(&mut Self, PathBuf, &Wake),
    {
        if let Some(s) = &mut self.session {
            if let (Some(ws), Some(doc)) = (&self.workspace, &self.document)
                && let Some(commit) = s.next_commit()
            {
                let (ws, doc, tx, wake) =
                    (ws.clone(), doc.clone(), self.copy_tx.clone(), ctx.clone());
                let snapshot_buf = commit.snapshot.text.clone();
                let sequence = commit.sequence;
                let doc_id = doc.id.clone();
                let owner = Owner::new(
                    self.task_scope.clone(),
                    format!("{}:{}", self.owner_id, doc.relative.to_string_lossy()),
                    self.read_generation,
                );
                let max_bytes = (ws.text_limit() as u64).max(1);
                let input_bytes = (snapshot_buf.len() as u64).min(max_bytes);

                self.status = "Saving…".into();
                self.saving_since = Some(Instant::now());
                self.saved_at = None;
                self.save_announced = matches!(
                    self.phase,
                    Phase::Draining {
                        intent: Intent::Save
                    }
                );
                if !self.save_announced {
                    ctx.after(auto_save::SLOW_SAVE);
                }

                // `DP-41` & `DP-44`: save runs on the bounded admitted I/O pool
                // sharing the `$O(1)$` `Buffer` snapshot without cloning `String`.
                io::submit_admitted(
                    owner,
                    "document-save",
                    input_bytes,
                    max_bytes,
                    IoLane::Save,
                    move |lease_res| {
                        let lease = match lease_res {
                            Ok(lease) => lease,
                            Err(rejection) => {
                                let err = workspace::Error::new(
                                    workspace::ErrorKind::Io,
                                    rejection.to_string(),
                                );
                                let _ = tx.send(CopyCompleted::Save {
                                    id: doc_id,
                                    sequence,
                                    result: Err(err),
                                });
                                wake.notify();
                                return;
                            }
                        };
                        if lease.cancelled() {
                            let err = workspace::Error::new(
                                workspace::ErrorKind::Io,
                                crate::platform::tasks::Rejection::Cancelled.to_string(),
                            );
                            let _ = tx.send(CopyCompleted::Save {
                                id: doc_id,
                                sequence,
                                result: Err(err),
                            });
                            wake.notify();
                            return;
                        }
                        let result = ws.save(&doc, snapshot_buf.as_str());
                        drop(lease);
                        let _ = tx.send(CopyCompleted::Save {
                            id: doc_id,
                            sequence,
                            result,
                        });
                        wake.notify();
                    },
                );
            }
            if let Some(snapshot) = s.take_receipt() {
                self.outgoing.push(HostMessage::Saved {
                    id: s.id.clone(),
                    revision: snapshot.revision,
                    text: snapshot.text.as_str().to_owned(),
                });
            }
        }
        self.sync_state();
        if let Phase::Draining { intent } = &self.phase {
            if self
                .session
                .as_ref()
                .is_none_or(DocumentEditingSession::drained)
            {
                let intent = intent.clone();
                if let Intent::OpenFolder(path) = intent {
                    open_folder(self, path, ctx);
                } else {
                    self.execute_copy(intent, ctx);
                }
            } else if let Some(s) = &self.session
                && !s.has_active_write()
            {
                if let Some(error) = &s.error {
                    let msg = error.message.clone();
                    self.fail(msg);
                } else if s.conflicted() {
                    self.fail(crate::localization::t("editor.session.cloudConflict").into());
                }
            }
        }
    }

    pub(super) fn execute_copy(&mut self, intent: Intent, ctx: &Wake) {
        match intent {
            Intent::OpenFolder(_) => {}
            Intent::OpenFile(_) | Intent::Reload => {
                let Some(ws) = self.workspace.clone() else {
                    self.fail(crate::localization::t("native.editor.fixtureReadonly").into());
                    return;
                };
                let path = match intent {
                    Intent::OpenFile(path) => path,
                    _ => match self.opened() {
                        Some((_, relative)) => relative.to_path_buf(),
                        None => return,
                    },
                };
                self.phase = Phase::Working;
                self.status = "Reading file…".into();
                let content = crate::editor::registry::source_requirement(&path.to_string_lossy())
                    .reads_content();
                let tx = self.copy_tx.clone();
                let wake = ctx.clone();
                let budget = read_budget(&path.to_string_lossy(), &ws);
                let journal = self.drafts.journal.clone();
                let owner = self.task_owner(path.to_string_lossy(), self.read_generation);
                io::submit_admitted(
                    owner,
                    "document-read",
                    0,
                    budget,
                    IoLane::InteractiveOpen,
                    move |lease_res| {
                        let lease = match lease_res {
                            Ok(lease) => lease,
                            Err(rejection) => {
                                let error = workspace::Error::new(
                                    workspace::ErrorKind::Unsupported,
                                    rejection.to_string(),
                                );
                                let _ = tx.send(CopyCompleted::File(Err(error)));
                                wake.notify();
                                return;
                            }
                        };
                        if lease.cancelled() {
                            return;
                        }
                        let completed = if content {
                            CopyCompleted::File(ws.read(&path).and_then(|doc| {
                                if doc.text.len() as u64 > budget {
                                    Err(workspace::Error::new(
                                        workspace::ErrorKind::Unsupported,
                                        crate::localization::tf(
                                            "editor.unavailable.resourceLimit",
                                            &[(
                                                "limit",
                                                crate::editor::registry::format_byte_limit(budget)
                                                    .into(),
                                            )],
                                        ),
                                    ))
                                } else {
                                    // `DP-11`: check local draft journal without blocking open on error.
                                    let entry = journal.as_ref().and_then(|j| {
                                        let (ws_key, res_key) = drafts::journal_keys(&doc);
                                        j.read_entry(&ws_key, &res_key).ok().flatten()
                                    });
                                    Ok((doc, entry))
                                }
                            }))
                        } else {
                            let result = ws.resource(&path);
                            CopyCompleted::Resource(path, result)
                        };
                        if lease.cancelled() {
                            return;
                        }
                        drop(lease);
                        let _ = tx.send(completed);
                        wake.notify();
                    },
                );
            }
            Intent::CloseFile => {
                self.watch = None;
                self.observation_pending = false;
                self.document = None;
                self.deferred_document = None;
                self.resource = None;
                self.dirty = false;
                self.revision = 0;
                self.phase = Phase::Idle;
                self.session = None;
                self.save_error = None;
                self.save_error_kind = None;
                self.local_overwrite_notice = None;
                self.recovered_draft_notice = None;
                self.drafts.reset();
                self.show_document();
                self.status = "Select a text file".into();
            }
            Intent::Quit => {
                self.flush_unflushable_draft();
                self.allow_quit = true;
                self.phase = Phase::Idle;
            }
            Intent::Save => {
                self.phase = Phase::Idle;
                self.thaw();
            }
            Intent::PrepareOperation => {
                self.watch = None;
                self.read_generation += 1;
                self.observation_pending = false;
                self.phase = Phase::Prepared;
            }
        }
    }

    fn apply_opened_document(&mut self, doc: Document, entry: Option<DraftEntry>, ctx: &Wake) {
        let had_journal_entry = entry.is_some();
        let plan = drafts::plan_recovery(&doc, entry);
        let hosted = self
            .workspace
            .as_ref()
            .is_some_and(|ws| ws.local_root().is_none());

        self.resource = None;
        self.session = None;
        self.deferred_document = None;
        self.save_error = None;
        self.save_error_kind = None;
        self.local_overwrite_notice = None;
        self.recovered_draft_notice = None;
        self.phase = Phase::Idle;
        self.error = None;
        self.drafts.has_entry_on_disk = had_journal_entry;

        match plan {
            RecoveryPlan::None => {
                self.document = Some(doc);
                self.dirty = false;
                self.revision = 0;
                self.ensure_session(ctx);
                self.drafts.has_entry_on_disk = had_journal_entry;
                self.status = "Opened".into();
                self.show_document();
            }
            RecoveryPlan::AlreadyConverged => {
                self.remove_draft_entry(&doc);
                self.document = Some(doc);
                self.dirty = false;
                self.revision = 0;
                self.ensure_session(ctx);
                self.drafts.has_entry_on_disk = had_journal_entry;
                self.status = "Opened".into();
                self.show_document();
            }
            RecoveryPlan::RestoreMatchingBaseline { draft_text, .. } => {
                let baseline_text = doc.text.clone();
                let mut shown_doc = doc;
                shown_doc.text = draft_text.clone();
                let doc_id = shown_doc.id.clone();
                self.document = Some(shown_doc);
                self.revision = 1;
                self.dirty = true;
                self.ensure_session(ctx);
                self.drafts.has_entry_on_disk = had_journal_entry;
                if let Some(session) = &mut self.session {
                    // Reset session baseline to authoritative storage `baseline_text`
                    // while staging `draft_text` as unsaved working copy!
                    let mut restored =
                        DocumentEditingSession::new(doc_id.clone(), baseline_text.as_str(), 1);
                    restored.cloud = hosted;
                    restored.local_edit(1, true);
                    restored.needs_snapshot = false;
                    restored.record_live_buffer(1, Buffer::new(draft_text));
                    *session = restored;
                }
                self.sync_state();
                self.notice_serial += 1;
                self.recovered_draft_notice = Some(self.notice_serial);
                self.status = "Opened".into();
                self.show_document();
                self.outgoing.push(HostMessage::Saved {
                    id: doc_id,
                    revision: 0,
                    text: baseline_text,
                });
            }
            RecoveryPlan::StorageDiverged { draft_text, .. } => {
                if hosted {
                    // `DP-05` / `DP-11`: hosted storage moved while closed -> enter
                    // 4-exit conflict with `ours = draft_text`, `theirs = doc.text`.
                    let remote_doc = doc.clone();
                    let remote_text = doc.text.clone();
                    let mut shown_doc = doc;
                    shown_doc.text = draft_text.clone();
                    let doc_id = shown_doc.id.clone();
                    self.deferred_document = Some(remote_doc);
                    self.document = Some(shown_doc);
                    self.revision = 1;
                    self.dirty = true;
                    self.ensure_session(ctx);
                    self.drafts.has_entry_on_disk = had_journal_entry;
                    if let Some(session) = &mut self.session {
                        let mut conflicted =
                            DocumentEditingSession::new(doc_id, remote_text.as_str(), 1);
                        conflicted.cloud = true;
                        conflicted.enter_conflict(
                            remote_text.as_str(),
                            draft_text.as_str(),
                            remote_text.as_str(),
                            None,
                        );
                        *session = conflicted;
                    }
                    self.sync_state();
                    self.notice_serial += 1;
                    self.recovered_draft_notice = Some(self.notice_serial);
                    self.error =
                        Some(crate::localization::t("editor.session.cloudConflict").into());
                    self.status = "Opened".into();
                    self.show_document();
                } else {
                    // `DP-04` / `DP-11`: local disk moved while closed -> disk wins,
                    // seed undo step with `draft_text` and show neutral undo notice!
                    let doc_id = doc.id.clone();
                    self.remove_draft_entry(&doc);
                    self.document = Some(doc);
                    self.dirty = false;
                    self.revision = 1;
                    self.ensure_session(ctx);
                    self.drafts.has_entry_on_disk = had_journal_entry;
                    self.notice_serial += 1;
                    self.local_overwrite_notice = Some(self.notice_serial);
                    self.status = "Opened".into();
                    self.show_document();
                    self.outgoing.push(HostMessage::ExternalUndoSeed {
                        id: doc_id,
                        previous_text: draft_text,
                    });
                }
            }
        }
    }

    fn apply_adopted_storage(
        &mut self,
        mut remote_doc: Document,
        merged: Buffer,
        had_local_unmerged: bool,
        overwrote_local_overlap: bool,
        now: Instant,
        ctx: &Wake,
    ) {
        let storage_baseline = remote_doc.text.clone();
        remote_doc.text = merged.as_str().to_owned();
        if !had_local_unmerged {
            self.remove_draft_entry(&remote_doc);
            self.auto_save.cancel();
        }
        self.document = Some(remote_doc);
        self.deferred_document = None;
        self.error = None;
        self.save_error = None;
        self.save_error_kind = None;
        if overwrote_local_overlap {
            self.notice_serial += 1;
            self.local_overwrite_notice = Some(self.notice_serial);
        }
        self.sync_state();
        let baseline_override = had_local_unmerged.then_some(storage_baseline);
        self.show_storage_update(baseline_override);

        if had_local_unmerged {
            if matches!(self.phase, Phase::Draining { .. }) {
                if let Some(s) = &mut self.session {
                    let rev = s.revision;
                    s.enqueue(Snapshot {
                        revision: rev,
                        text: merged,
                    });
                }
            } else {
                self.auto_save.schedule(now);
                self.schedule_deadlines(ctx, now);
            }
        }
    }

    fn remove_draft_entry(&mut self, doc: &Document) {
        if let Some((journal, ws_key, res_key)) = self.drafts.take_removal(doc) {
            let _ = journal.remove_entry(&ws_key, &res_key);
        }
    }

    fn dispatch_due_draft(&mut self, now: Instant, ctx: &Wake) {
        let (Some(doc), Some(session)) = (&self.document, &mut self.session) else {
            return;
        };
        if drafts::classify_unflushable(session).is_some()
            && session.has_unsnapshotted_edits()
            && self.autosave_request.is_none()
            && matches!(self.phase, Phase::Idle)
        {
            // Request an up-to-date snapshot from the host before persisting.
            self.serial += 1;
            self.autosave_request = Some((self.serial, session.epoch, now));
            self.outgoing.push(HostMessage::Snapshot {
                request: self.serial,
                freeze: false,
            });
            ctx.after(SNAPSHOT_TIMEOUT);
        }
        let Some(session_ref) = self.session.as_ref() else {
            return;
        };
        if let Some((journal, entry)) = self.drafts.take_due_entry(doc, session_ref, now, false) {
            let lock = (self.task_scope.clone(), entry.resource_key.clone());
            self.drafts.inflight += 1;
            let tx = self.copy_tx.clone();
            let wake = ctx.clone();
            io::submit_serialized(Some(lock), IoLane::Journal, move || {
                let _ = journal.write_entry(&entry);
                let _ = tx.send(CopyCompleted::DraftPersisted);
                wake.notify();
            });
        }
    }

    fn request_autosave_snapshot(&mut self, now: Instant, ctx: &Wake) {
        if let Some(s) = &mut self.session {
            self.serial += 1;
            self.autosave_request = Some((self.serial, s.epoch, now));
            s.needs_snapshot = false;
            self.outgoing.push(HostMessage::Snapshot {
                request: self.serial,
                freeze: false,
            });
            ctx.after(SNAPSHOT_TIMEOUT);
        }
    }

    /// Registers ONLY real upcoming deadlines on `ctx` (`DP-42`) — never a
    /// periodic `100ms` wakeup ticker.
    pub(crate) fn schedule_deadlines(&self, ctx: &Wake, now: Instant) {
        if self.allow_quit {
            return;
        }
        if let Phase::Snapshot { since, .. } = &self.phase {
            let elapsed = now.saturating_duration_since(*since);
            ctx.after(SNAPSHOT_TIMEOUT.saturating_sub(elapsed));
        }
        if let Some((_, _, since)) = self.autosave_request {
            let elapsed = now.saturating_duration_since(since);
            ctx.after(SNAPSHOT_TIMEOUT.saturating_sub(elapsed));
        }
        if !self.save_announced
            && self.session.as_ref().is_some_and(|s| s.has_active_write())
            && let Some(since) = self.saving_since
        {
            let elapsed = now.saturating_duration_since(since);
            ctx.after(auto_save::SLOW_SAVE.saturating_sub(elapsed));
        }
        if let Some(delay) = self.auto_save.delay(now) {
            ctx.after(delay);
        }
        if let Some(retry_at) = self.observation_retry {
            ctx.after(retry_at.saturating_duration_since(now));
        }
        if let Some(delay) = self.drafts.delay(now) {
            ctx.after(delay);
        }
    }

    pub fn notice_state_key(
        &self,
    ) -> (bool, Option<u64>, Option<u64>, Option<workspace::ErrorKind>) {
        (
            self.cloud_conflict(),
            self.local_overwrite_notice,
            self.recovered_draft_notice,
            self.save_error_kind,
        )
    }

    pub fn status_key(
        &self,
    ) -> (
        Option<String>,
        u64,
        bool,
        bool,
        String,
        Option<String>,
        SaveStatus,
    ) {
        (
            self.opened().map(|(id, _)| id.to_owned()),
            self.revision,
            self.dirty,
            self.busy(),
            self.status.clone(),
            self.error.clone(),
            self.save_status(),
        )
    }

    pub fn presentation_key(&self) -> PresentationKey {
        (
            self.document
                .as_ref()
                .map(|d| (d.id.clone(), blake3::hash(d.text.as_bytes())))
                .or_else(|| {
                    self.resource.as_ref().map(|r| {
                        (
                            r.id.clone(),
                            blake3::hash(r.relative.as_os_str().as_encoded_bytes()),
                        )
                    })
                }),
            self.revision,
            self.dirty,
            self.busy(),
            self.status.clone(),
            self.error.clone(),
            self.save_status(),
        )
    }

    pub(super) fn poll_copy(&mut self, ctx: &Wake, now: Instant) {
        self.poll_copy_with(ctx, now, |_, _, _| {});
    }

    pub(super) fn poll_copy_with<F>(&mut self, ctx: &Wake, now: Instant, mut open_folder: F)
    where
        F: FnMut(&mut Self, PathBuf, &Wake),
    {
        if self
            .saving_since
            .is_some_and(|at| now.saturating_duration_since(at) >= auto_save::SLOW_SAVE)
        {
            self.save_announced = true;
        }
        self.ensure_session(ctx);
        if matches!(
            &self.phase,
            Phase::Snapshot { since, .. } if now.saturating_duration_since(*since) >= SNAPSHOT_TIMEOUT
        ) {
            self.fail(crate::localization::t("native.editor.noAck").into());
        }
        if self
            .autosave_request
            .is_some_and(|(_, _, since)| now.saturating_duration_since(since) >= SNAPSHOT_TIMEOUT)
        {
            self.fail(crate::localization::t("native.editor.noSaveSnapshot").into());
            if let Some(s) = &mut self.session {
                s.needs_snapshot = false;
            }
        }

        while let Ok(message) = self.copy_rx.try_recv() {
            match message {
                CopyCompleted::File(Ok((doc, entry))) => {
                    self.apply_opened_document(doc, entry, ctx);
                }
                CopyCompleted::File(Err(error)) | CopyCompleted::Resource(_, Err(error)) => {
                    self.fail(error.to_string());
                }
                CopyCompleted::Resource(relative, Ok(preview)) => {
                    self.document = None;
                    self.deferred_document = None;
                    self.resource = Some(Resource {
                        id: uuid::Uuid::new_v4().to_string(),
                        relative,
                        preview,
                    });
                    self.watch = None;
                    self.session = None;
                    self.dirty = false;
                    self.revision = 0;
                    self.phase = Phase::Idle;
                    self.error = None;
                    self.save_error = None;
                    self.save_error_kind = None;
                    self.local_overwrite_notice = None;
                    self.recovered_draft_notice = None;
                    self.drafts.reset();
                    self.status = "Opened".into();
                    self.show_document();
                }
                CopyCompleted::Save {
                    id,
                    sequence,
                    result,
                } => {
                    if !self.session.as_ref().is_some_and(|s| s.id == id) {
                        continue;
                    }
                    self.read_generation += 1;
                    let typed_outcome = match &result {
                        Ok(out) if out.updated => Ok(SessionWriteOutcome::Conflict {
                            remote_text: Buffer::new(out.document.text.clone()),
                            remote_revision: None,
                        }),
                        Ok(out) => Ok(SessionWriteOutcome::Written {
                            text: Buffer::new(out.document.text.clone()),
                            revision: None,
                        }),
                        Err(err) => Err(SessionError::new(err.kind, err.to_string())),
                    };
                    let completion = self
                        .session
                        .as_mut()
                        .unwrap()
                        .complete(sequence, typed_outcome);
                    match completion {
                        Completion::Saved => {
                            let saved_doc = result.unwrap().document;
                            self.remove_draft_entry(&saved_doc);
                            self.document = Some(saved_doc);
                            self.deferred_document = None;
                            self.error = None;
                            self.save_error = None;
                            self.save_error_kind = None;
                            self.saved_at = self.save_announced.then_some(now);
                            self.saving_since = None;
                            self.status = "Saved".into();
                        }
                        Completion::Adopted {
                            text,
                            had_local_unmerged,
                            overwrote_local_overlap,
                        } => {
                            let remote_doc = result.unwrap().document;
                            self.apply_adopted_storage(
                                remote_doc,
                                text,
                                had_local_unmerged,
                                overwrote_local_overlap,
                                now,
                                ctx,
                            );
                        }
                        Completion::Failed(error) => {
                            self.saving_since = None;
                            self.save_error_kind = Some(error.kind);
                            self.save_error = Some(error.message);
                            self.drafts.sync_schedule(
                                self.document.as_ref(),
                                self.session.as_ref(),
                                now,
                            );
                        }
                        Completion::Deferred(_) => {
                            self.saving_since = None;
                            self.deferred_document = result.ok().map(|r| r.document);
                            self.save_error = None;
                            self.save_error_kind = None;
                            self.error =
                                Some(crate::localization::t("editor.session.cloudConflict").into());
                            self.drafts.sync_schedule(
                                self.document.as_ref(),
                                self.session.as_ref(),
                                now,
                            );
                        }
                        Completion::Retired => {}
                    }
                }
                CopyCompleted::ObservationDeferred { id, generation } => {
                    self.observing = false;
                    let current = self.session.as_ref().is_some_and(|s| s.id == id);
                    if current {
                        if generation != self.read_generation || !matches!(self.phase, Phase::Idle)
                        {
                            self.observation_pending = true;
                        } else {
                            let delay = OBSERVATION_RETRIES[0];
                            self.observation_retry = Some(now + delay);
                            ctx.after(delay);
                        }
                    }
                }
                CopyCompleted::Observed {
                    id,
                    generation,
                    result,
                } => {
                    self.observing = false;
                    let current = self.session.as_ref().is_some_and(|s| s.id == id);
                    if generation != self.read_generation
                        || !matches!(self.phase, Phase::Idle)
                        || !current
                    {
                        self.observation_pending |= current;
                        continue;
                    }
                    let result = match result {
                        Err(error)
                            if (error.kind == workspace::ErrorKind::Io
                                || error.detail
                                    == crate::localization::t(
                                        "native.workspace.changedWhileReading",
                                    ))
                                && self.observation_failures < OBSERVATION_RETRIES.len() =>
                        {
                            let delay = OBSERVATION_RETRIES[self.observation_failures];
                            self.observation_failures += 1;
                            self.observation_retry = Some(now + delay);
                            ctx.after(delay);
                            continue;
                        }
                        result => {
                            self.observation_failures = 0;
                            self.observation_retry = None;
                            result
                        }
                    };
                    match result {
                        Ok(doc) => {
                            let obs = self
                                .session
                                .as_mut()
                                .unwrap()
                                .observe_with_revision(Buffer::new(doc.text.clone()), None);
                            match obs {
                                StorageObservation::OwnWrite => {}
                                StorageObservation::Baseline => {
                                    self.document = Some(doc);
                                }
                                StorageObservation::Adopted {
                                    text,
                                    had_local_unmerged,
                                    overwrote_local_overlap,
                                } => {
                                    self.apply_adopted_storage(
                                        doc,
                                        text,
                                        had_local_unmerged,
                                        overwrote_local_overlap,
                                        now,
                                        ctx,
                                    );
                                }
                                StorageObservation::Deferred(_) => {
                                    self.deferred_document = Some(doc);
                                    self.error = Some(
                                        crate::localization::t("editor.session.cloudConflict")
                                            .into(),
                                    );
                                    self.drafts.sync_schedule(
                                        self.document.as_ref(),
                                        self.session.as_ref(),
                                        now,
                                    );
                                }
                            }
                        }
                        Err(error) => self.error = Some(error.to_string()),
                    }
                }
                CopyCompleted::Rebound {
                    id,
                    generation,
                    result,
                } => {
                    if generation != self.read_generation
                        || !self.session.as_ref().is_some_and(|s| s.id == id)
                    {
                        continue;
                    }
                    match result {
                        Ok(doc) => {
                            let obs = self
                                .session
                                .as_mut()
                                .unwrap()
                                .observe_with_revision(Buffer::new(doc.text.clone()), None);
                            match obs {
                                StorageObservation::Deferred(_) => {
                                    self.deferred_document = Some(doc);
                                    self.error = Some(
                                        crate::localization::t("editor.session.cloudConflict")
                                            .into(),
                                    );
                                    self.drafts.sync_schedule(
                                        self.document.as_ref(),
                                        self.session.as_ref(),
                                        now,
                                    );
                                }
                                StorageObservation::Adopted {
                                    text,
                                    had_local_unmerged,
                                    overwrote_local_overlap,
                                } => {
                                    self.apply_adopted_storage(
                                        doc,
                                        text,
                                        had_local_unmerged,
                                        overwrote_local_overlap,
                                        now,
                                        ctx,
                                    );
                                    self.start_watch(ctx);
                                }
                                StorageObservation::OwnWrite | StorageObservation::Baseline => {
                                    self.document = Some(doc);
                                    self.start_watch(ctx);
                                }
                            }
                        }
                        Err(error) => self.error = Some(error.to_string()),
                    }
                }
                CopyCompleted::ResourceRebound(relative, result) => {
                    if self
                        .resource
                        .as_ref()
                        .is_some_and(|r| r.relative == relative)
                    {
                        match result {
                            Ok(preview) => self.rebind_resource(relative, preview),
                            Err(error) => self.error = Some(error.to_string()),
                        }
                    }
                }
                CopyCompleted::ConflictCopy { id, result } => {
                    if !self.session.as_ref().is_some_and(|s| s.id == id) {
                        continue;
                    }
                    match result {
                        Ok(created) => {
                            self.conflict_copy_created = Some(created);
                            self.reload_cloud_baseline();
                        }
                        Err(error) => {
                            self.save_error_kind = Some(error.kind);
                            self.save_error = Some(error.to_string());
                        }
                    }
                }
                CopyCompleted::DraftPersisted => {
                    self.drafts.inflight = self.drafts.inflight.saturating_sub(1);
                }
            }
        }

        if self.observation_retry.is_some_and(|at| now >= at) {
            self.observation_retry = None;
            self.observation_pending = true;
        }
        if let Some(event) = self.watch.as_ref().and_then(workspace::Subscription::next) {
            match event {
                workspace::ports::WatchEvent::Invalidated
                | workspace::ports::WatchEvent::Changed(_) => self.observation_pending = true,
                workspace::ports::WatchEvent::Failed(error) => self.error = Some(error.to_string()),
            }
        }
        self.pump_with(ctx, &mut open_folder);
        if self.allow_quit {
            self.watch = None;
        }
        if matches!(self.phase, Phase::Idle) {
            if self.autosave_request.is_none()
                && self.session.as_ref().is_some_and(|s| s.needs_snapshot)
                && (self.auto_save.delay(now).is_none() || self.auto_save.take_due(now))
            {
                self.request_autosave_snapshot(now, ctx);
            }
            if !self.observing
                && self.observation_pending
                && let (Some(ws), Some(doc)) = (&self.workspace, &self.document)
            {
                let (ws, doc, tx, wake, generation) = (
                    ws.clone(),
                    doc.clone(),
                    self.copy_tx.clone(),
                    ctx.clone(),
                    self.read_generation,
                );
                let doc_id = doc.id.clone();
                let budget = read_budget(&doc.relative.to_string_lossy(), &ws);
                let owner = self.task_owner(doc.relative.to_string_lossy(), generation);
                self.observing = true;
                self.observation_pending = false;
                // `DP-41`: background observations run on the `Observation`
                // (`Priority::Background`) lane of the bounded I/O pool.
                io::submit_admitted(
                    owner,
                    "document-observe",
                    0,
                    budget,
                    IoLane::Observation,
                    move |lease_res| {
                        let Ok(lease) = lease_res else {
                            let _ = tx.send(CopyCompleted::ObservationDeferred {
                                id: doc_id,
                                generation,
                            });
                            wake.notify();
                            return;
                        };
                        if lease.cancelled() {
                            drop(lease);
                            let _ = tx.send(CopyCompleted::ObservationDeferred {
                                id: doc_id,
                                generation,
                            });
                            wake.notify();
                            return;
                        }
                        let result = ws.observe(&doc);
                        drop(lease);
                        let _ = tx.send(CopyCompleted::Observed {
                            id: doc_id,
                            generation,
                            result,
                        });
                        wake.notify();
                    },
                );
            }
        }
        self.dispatch_due_draft(now, ctx);
        self.schedule_deadlines(ctx, now);
    }
}
