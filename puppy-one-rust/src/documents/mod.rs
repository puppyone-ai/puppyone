//! Document coordinator facade (`DP-40`–`DP-44`, `DP-01`–`DP-11`, `DP-31`, `DP-50`).
//!
//! Splits responsibilities cleanly across submodules:
//! - [`working_copy::WorkingCopy`]: single Working Copy state machine, snapshot
//!   handshake, deadline timers (`DP-42`), and reconciliation wiring (`DP-40`).
//! - [`reconcile`]: line/span 3-way merge and minimal UTF-16 diff hunks (`DP-01`, `DP-04`, `DP-05`, `DP-50`).
//! - [`drafts`]: crash-safe unflushable draft journal scheduling and recovery (`DP-10`, `DP-11`).
//! - [`io`]: bounded executor pool over `platform::tasks::Scheduler` (`DP-41`).
//!
//! [`Documents`] derefs to [`WorkingCopy`] while retaining workspace-root /
//! Cloud-opening / directory-listing facade methods for workbench compatibility.

pub use crate::editor::document_session::types::Snapshot;
use crate::{
    editor::text::buffer::Buffer,
    model::Node,
    platform::draft_journal::DraftJournal,
    wake::Wake,
    workspace::{self, Workspace},
};
use std::{
    ops::{Deref, DerefMut},
    path::{Path, PathBuf},
    sync::{
        Arc,
        mpsc::{self, Receiver, Sender},
    },
    time::{Duration, Instant},
};

mod auto_save;
pub mod drafts;
pub mod io;
pub mod reconcile;
pub mod working_copy;

pub use working_copy::{SNAPSHOT_TIMEOUT, WorkingCopy};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Intent {
    OpenFolder(PathBuf),
    /// A standalone document, without its parent's project capabilities.
    OpenSingleFile(PathBuf),
    OpenFile(PathBuf),
    Reload,
    CloseFile,
    Quit,
    Save,
    /// Freeze and drain without disposing the Working Copy or editor.
    PrepareOperation,
}

/// What the document session asks the editor host (`editor::host`) to do.
#[derive(Clone, Debug, PartialEq)]
pub enum HostMessage {
    /// Per-open-instance document context delivered before `Open` / `OpenResource` / `Oversized` (`RG-10`, `RG-11`, `RG-01`).
    Context {
        id: String,
        context: crate::editor::registry::DocumentContext,
    },
    /// Show a document's text. `external`: storage content was reconciled into
    /// the open document via minimal diff (`DP-02`).
    Open {
        id: String,
        name: String,
        text: String,
        revision: u64,
        external: bool,
    },
    /// Show a file its viewer reads itself (`resource` / `none` sources).
    OpenResource {
        id: String,
        name: String,
        path: workspace::PreviewResource,
    },
    /// Plain-text or code file opened bounded read-only above its editable
    /// `maxSourceBytes` budget (`RG-03`).
    ReadOnlyLarge {
        id: String,
        size_bytes: u64,
        edit_limit_bytes: u64,
    },
    /// File exceeds its viewer's `maxSourceBytes` (or `64 MiB` read-only text
    /// ceiling): open an in-pane explanation card without reading the body (`RG-02`).
    Oversized {
        id: String,
        name: String,
        size_bytes: u64,
        limit_bytes: u64,
        can_reveal_in_finder: bool,
    },
    /// No document is open.
    Clear,
    /// Report the current text; `freeze` holds edits until `Thaw`.
    Snapshot {
        request: u64,
        freeze: bool,
    },
    Thaw,
    /// Same editing instance at a new address; preserve view/history.
    Rebind {
        id: String,
        name: String,
        resource: Option<workspace::PreviewResource>,
    },
    /// A snapshot reached disk: it is the document's clean baseline.
    Saved {
        id: String,
        revision: u64,
        text: String,
    },
    /// Undo (or redo) in the open document.
    History {
        id: String,
        redo: bool,
    },
    /// `DP-31` & `DP-32`: read-only encoding / line-ending normalization policy.
    Policy {
        id: String,
        lossy_readonly: bool,
        requires_line_ending_normalization: bool,
    },
    /// Seeds an undoable pre-overwrite draft (`DP-04` / `DP-11`).
    ExternalUndoSeed {
        id: String,
        previous_text: String,
    },
}

/// What the document editor reports back.
#[derive(Clone, Debug)]
pub enum ClientMessage {
    RetryInput {
        id: String,
    },
    /// Read a pane's file again after its read failed (the workbench's).
    RetryRead,
    Dirty {
        id: String,
        revision: u64,
        dirty: bool,
    },
    /// `$O(1)$`-shared rope snapshot emitted on local edits so asynchronous
    /// observations can 3-way merge immediately (`DP-01`, `DP-44`).
    LiveBuffer {
        id: String,
        revision: u64,
        text: Buffer,
    },
    Snapshot {
        request: u64,
        id: String,
        revision: u64,
        text: Buffer,
    },
    Deferred {
        request: u64,
        id: String,
    },
    /// Explicit "Normalize line endings and edit" action (`DP-31`).
    NormalizeLineEndings {
        id: String,
    },
    Action {
        action: String,
    },
    Loaded {
        id: String,
    },
    /// The editor could not apply an edit or protocol step.
    Fault {
        message: String,
    },
    /// Open workspace paths a document referenced (`openWorkspaceCandidates`).
    OpenPaths {
        paths: Vec<String>,
    },
}

pub enum Phase {
    Idle,
    Snapshot {
        request: u64,
        intent: Intent,
        since: Instant,
    },
    AwaitComposition {
        intent: Intent,
    },
    Draining {
        intent: Intent,
    },
    Working,
    Prepared,
}

/// An open file whose viewer reads it itself: no text, nothing to save.
#[derive(Clone, Debug, PartialEq)]
pub struct Resource {
    pub id: String,
    pub relative: PathBuf,
    pub preview: workspace::PreviewResource,
}

enum FolderCompleted {
    Root(workspace::Result<(Arc<Workspace>, Vec<Node>)>),
    Children(Arc<Workspace>, PathBuf, workspace::Result<Vec<Node>>),
}

pub(super) struct WorkspaceAssets {
    pub workspace: Arc<Workspace>,
    pub base: PathBuf,
}

impl crate::platform::webview::ResourceSource for WorkspaceAssets {
    fn read(&self, relative: &Path) -> Option<Vec<u8>> {
        let path = self.base.join(relative);
        match self.workspace.resource(&path).ok()?.data().ok()? {
            workspace::PreviewData::Bytes { bytes, .. } => Some(bytes.to_vec()),
            workspace::PreviewData::LocalFile(_) => None,
        }
    }
}

pub type PresentationKey = (
    Option<(String, blake3::Hash)>,
    u64,
    bool,
    bool,
    String,
    Option<String>,
    SaveStatus,
);

/// `SaveStatus` (without manual saving, which the desktop does not use).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SaveStatus {
    Clean,
    Saving,
    Saved,
    Failed,
}

/// `SAVED_STATUS_DURATION_MS`.
pub const SAVED_STATUS_DURATION: Duration = Duration::from_millis(1200);

/// Background observation retry schedule on transient `ErrorKind::Io` failures.
pub(super) const OBSERVATION_RETRIES: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(3),
    Duration::from_secs(10),
];
/// After those, a re-read that keeps failing in transit tries again this often,
/// quietly, for as long as the document is open.
pub(super) const OBSERVATION_QUIET_RETRY: Duration = Duration::from_secs(30);
/// A change subscription that ended for a passing reason subscribes again
/// after these delays, then every 30 seconds.
pub(super) const WATCH_RETRIES: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(5),
    Duration::from_secs(30),
];

/// Selects localized UI copy for a failed save by typed [`workspace::ErrorKind`] (`DP-43`).
pub fn localized_save_error(kind: Option<workspace::ErrorKind>, detail: &str) -> String {
    match kind {
        Some(workspace::ErrorKind::PermissionDenied) => {
            crate::localization::t("native.workspace.readOnly").into()
        }
        Some(workspace::ErrorKind::LineEndingNormalizationRequired) => {
            crate::localization::t("native.editor.lineEndingsReadOnly").into()
        }
        Some(workspace::ErrorKind::EncodingRoundTrip) => {
            crate::localization::t("native.workspace.notUtf8").into()
        }
        Some(workspace::ErrorKind::StaleLease) => {
            crate::localization::t("native.editor.saveStaleLease").into()
        }
        Some(workspace::ErrorKind::OutcomeUnknown) => {
            crate::localization::t("native.editor.saveOutcomeUnknown").into()
        }
        Some(workspace::ErrorKind::NotFound) => {
            crate::localization::t("native.editor.saveTargetMissing").into()
        }
        _ => crate::localization::tf(
            "editor.session.saveFailedDetail",
            &[(
                "detail",
                detail.chars().take(300).collect::<String>().into(),
            )],
        ),
    }
}

pub struct Documents {
    pub copy: WorkingCopy,
    /// Cloud opening phase (`Waking up…` / `Taking out your files…`).
    pub cloud_phase: Arc<std::sync::Mutex<Option<crate::workspace::cloud::opening::Phase>>>,
    /// Why the last Cloud opening failed (`describeCloudOpeningFailure`).
    pub cloud_failure: Arc<std::sync::Mutex<Option<crate::workspace::cloud::opening::Failure>>>,
    cloud_run: Arc<std::sync::atomic::AtomicU64>,
    cloud_cancel: Option<crate::cloud::auth::Cancellation>,
    pub tree_update: Option<Vec<Node>>,
    pub children_update: Option<(PathBuf, workspace::Result<Vec<Node>>)>,
    pub folder_busy: bool,
    folder_tx: Sender<FolderCompleted>,
    folder_rx: Receiver<FolderCompleted>,
}

impl Default for Documents {
    fn default() -> Self {
        let (folder_tx, folder_rx) = mpsc::channel();
        Self {
            copy: WorkingCopy::default(),
            cloud_phase: Default::default(),
            cloud_failure: Default::default(),
            cloud_run: Default::default(),
            cloud_cancel: None,
            tree_update: None,
            children_update: None,
            folder_busy: false,
            folder_tx,
            folder_rx,
        }
    }
}

impl Deref for Documents {
    type Target = WorkingCopy;
    fn deref(&self) -> &WorkingCopy {
        &self.copy
    }
}

impl DerefMut for Documents {
    fn deref_mut(&mut self) -> &mut WorkingCopy {
        &mut self.copy
    }
}

impl Documents {
    pub fn native() -> Self {
        let mut docs = Self::default();
        docs.copy.set_draft_journal(Some(DraftJournal::native()));
        docs
    }

    pub fn in_workspace(workspace: Arc<Workspace>) -> Self {
        Self {
            copy: WorkingCopy::in_workspace(workspace),
            ..Self::default()
        }
    }

    pub fn in_workspace_with_journal(
        workspace: Arc<Workspace>,
        journal: Option<DraftJournal>,
    ) -> Self {
        let mut docs = Self::in_workspace(workspace);
        docs.copy.set_draft_journal(journal);
        docs
    }

    pub fn with_draft_journal(mut self, journal: DraftJournal) -> Self {
        self.copy.set_draft_journal(Some(journal));
        self
    }

    fn spawn_open_folder(
        copy: &mut WorkingCopy,
        folder_tx: Sender<FolderCompleted>,
        intent: Intent,
        ctx: &Wake,
    ) {
        copy.clear_observation_retry();
        copy.phase = Phase::Working;
        copy.status = "Opening folder…".into();
        let wake = ctx.clone();
        let legacy_text = copy.file_window;
        io::submit_serialized(None, io::IoLane::InteractiveOpen, move || {
            let result = match intent {
                Intent::OpenSingleFile(path) => Workspace::open_file(&path).map(|ws| (ws, vec![])),
                Intent::OpenFolder(path) => Workspace::open_with(&path, legacy_text)
                    .and_then(|ws| ws.list(Path::new("")).map(|rows| (ws, rows))),
                _ => unreachable!(),
            };
            let _ = folder_tx.send(FolderCompleted::Root(result));
            wake.notify();
        });
    }

    pub fn begin(&mut self, intent: Intent, ctx: &Wake) {
        let folder_tx = self.folder_tx.clone();
        self.copy.begin_with(intent, ctx, move |copy, path, wake| {
            Self::spawn_open_folder(copy, folder_tx, path, wake);
        });
    }

    pub fn client(&mut self, message: ClientMessage, ctx: &Wake) {
        let folder_tx = self.folder_tx.clone();
        self.copy
            .client_with(message, ctx, move |copy, path, wake| {
                Self::spawn_open_folder(copy, folder_tx, path, wake);
            });
    }

    pub fn flush_pending_auto_save(&mut self, ctx: &Wake) {
        if self.copy.auto_save.flush() {
            self.poll(ctx);
        }
    }

    pub fn open_cloud(
        &mut self,
        broker: Arc<crate::cloud::auth::Broker>,
        binding: crate::cloud::auth::model::Binding,
        project_id: String,
        ctx: &Wake,
    ) {
        use crate::workspace::cloud::{Target, opening};
        use std::sync::atomic::Ordering;
        self.cancel_cloud();
        let cancel = crate::cloud::auth::Cancellation::default();
        self.cloud_cancel = Some(cancel.clone());
        let phase = self.cloud_phase.clone();
        *phase.lock().unwrap() = Some(opening::Phase::Checking);
        let run = self.cloud_run.fetch_add(1, Ordering::SeqCst) + 1;
        let current = self.cloud_run.clone();
        let failure_slot = self.cloud_failure.clone();
        *failure_slot.lock().unwrap() = None;
        let tx = self.folder_tx.clone();
        let ctx = ctx.clone();
        io::submit_serialized(None, io::IoLane::InteractiveOpen, move || {
            let progress_phase = phase.clone();
            let progress_ctx = ctx.clone();
            let result = opening::prepare(
                broker,
                binding,
                Target::ProjectRoot { project_id },
                &cancel,
                false,
                move |p| {
                    if current.load(Ordering::SeqCst) == run {
                        *progress_phase.lock().unwrap() = Some(p);
                    }
                    progress_ctx.notify();
                },
            );
            if cancel.check().is_err() {
                ctx.notify();
                return;
            }
            let completed = match result {
                Ok(prepared) => prepared.into_parts(),
                Err(failure) => {
                    let error = workspace::Error::new(
                        workspace::ErrorKind::Unsupported,
                        crate::localization::t(&format!("cloud.message.{}", failure.code)),
                    );
                    *failure_slot.lock().unwrap() = Some(failure);
                    Err(error)
                }
            };
            let _ = tx.send(FolderCompleted::Root(completed));
            ctx.notify();
        });
    }

    pub fn open_device(
        &mut self,
        hosts: Arc<crate::workspace::hosts::remote::Hosts>,
        opened: crate::workspace::hosts::device::Opened,
        ctx: &Wake,
    ) {
        self.cancel_cloud();
        self.copy.phase = Phase::Working;
        self.copy.status = "Opening folder…".into();
        let tx = self.folder_tx.clone();
        let ctx = ctx.clone();
        io::submit_serialized(None, io::IoLane::InteractiveOpen, move || {
            let result = crate::workspace::hosts::device::open(hosts, opened);
            let _ = tx.send(FolderCompleted::Root(result));
            ctx.notify();
        });
    }

    pub fn cancel_cloud(&mut self) {
        if let Some(cancel) = self.cloud_cancel.take() {
            cancel.cancel();
        }
        self.cloud_run
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        *self.cloud_phase.lock().unwrap() = None;
    }

    pub fn load_children(&mut self, path: PathBuf, ctx: &Wake) {
        let Some(ws) = self.copy.workspace.clone() else {
            return;
        };
        if self.folder_busy {
            return;
        }
        self.folder_busy = true;
        let tx = self.folder_tx.clone();
        let ctx = ctx.clone();
        io::submit_serialized(None, io::IoLane::InteractiveOpen, move || {
            let result = ws.list(&path);
            let _ = tx.send(FolderCompleted::Children(ws, path, result));
            ctx.notify();
        });
    }

    pub fn poll(&mut self, ctx: &Wake) {
        self.poll_at(ctx, Instant::now());
    }

    pub(crate) fn poll_at(&mut self, ctx: &Wake, now: Instant) {
        while let Ok(message) = self.folder_rx.try_recv() {
            match message {
                FolderCompleted::Root(Ok((ws, rows))) => {
                    *self.cloud_phase.lock().unwrap() = None;
                    if let Some(previous) = self.copy.workspace.replace(ws) {
                        previous.revoke();
                    }
                    self.copy.watch = None;
                    self.copy.observation_pending = false;
                    self.copy.document = None;
                    self.copy.deferred_document = None;
                    self.copy.resource = None;
                    self.copy.read_only_large = None;
                    self.copy.oversized = None;
                    self.copy.sniffed_format = None;
                    self.copy.session = None;
                    self.copy.dirty = false;
                    self.copy.revision = 0;
                    self.copy.save_error = None;
                    self.copy.save_error_kind = None;
                    self.copy.local_overwrite_notice = None;
                    self.copy.recovered_draft_notice = None;
                    self.copy.drafts.reset();
                    self.copy.next_open = None;
                    self.folder_busy = false;
                    self.tree_update = Some(rows);
                    self.copy.phase = Phase::Idle;
                    self.copy.error = None;
                    self.copy.status = "Select a text file".into();
                    self.copy.show_document();
                }
                FolderCompleted::Root(Err(error)) => {
                    *self.cloud_phase.lock().unwrap() = None;
                    self.copy.fail(error.to_string());
                }
                FolderCompleted::Children(ws, path, result) => {
                    if self
                        .copy
                        .workspace
                        .as_ref()
                        .is_some_and(|current| Arc::ptr_eq(current, &ws))
                    {
                        self.folder_busy = false;
                        self.children_update = Some((path, result));
                    }
                }
            }
        }
        let folder_tx = self.folder_tx.clone();
        self.copy.poll_copy_with(ctx, now, move |copy, path, wake| {
            Self::spawn_open_folder(copy, folder_tx.clone(), path, wake);
        });
        // The newest file choice, once the copy is free.
        if matches!(self.copy.phase, Phase::Idle)
            && let Some(intent) = self.copy.next_open.take()
        {
            self.begin(intent, ctx);
        }
    }
}

/// `EditorDocumentHost` admission: the resolved viewer's `maxSourceBytes`,
/// never more than the provider's text bound (8 MiB in Cloud).
pub(crate) fn read_budget(path: &str, workspace: &Workspace) -> u64 {
    crate::editor::registry::source_budget(path).min(workspace.text_limit() as u64)
}

#[cfg(test)]
mod resource_tests;
#[cfg(test)]
mod tests;
