//! Native document-session boundary. The native document editor
//! (`editor::host`) reports revisions and provides snapshots; the shared
//! editing session owns autosave and disk epochs.
pub use crate::editor::document_session::types::Snapshot;
use crate::editor::document_session::{
    document_editing_session::DocumentEditingSession,
    types::{Completion, StorageObservation},
};
use crate::wake::Wake;
use crate::{
    model::Node,
    workspace::{self, Document, MAX_TEXT_BYTES, Workspace},
};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        mpsc::{self, Receiver, Sender},
    },
    time::{Duration, Instant},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Intent {
    OpenFolder(PathBuf),
    OpenFile(PathBuf),
    Reload,
    CloseFile,
    Quit,
    Save,
}
/// What the document editor reports back.
#[derive(Clone, Debug)]
pub enum ClientMessage {
    Dirty {
        id: String,
        revision: u64,
        dirty: bool,
    },
    Snapshot {
        request: u64,
        id: String,
        revision: u64,
        text: String,
    },
    Deferred {
        request: u64,
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
}
enum Completed {
    Root(workspace::Result<(Arc<Workspace>, Vec<Node>)>),
    File(workspace::Result<Document>),
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
    Children(Arc<Workspace>, PathBuf, workspace::Result<Vec<Node>>),
}
pub type PresentationKey = (
    Option<(String, blake3::Hash)>,
    u64,
    bool,
    bool,
    String,
    Option<String>,
);
pub struct Documents {
    pub workspace: Option<Arc<Workspace>>,
    pub document: Option<Document>,
    pub dirty: bool,
    pub revision: u64,
    pub phase: Phase,
    pub error: Option<String>,
    pub status: String,
    pub allow_quit: bool,
    pub outgoing: Vec<Value>,
    pub tree_update: Option<Vec<Node>>,
    pub children_update: Option<(PathBuf, workspace::Result<Vec<Node>>)>,
    pub folder_busy: bool,
    serial: u64,
    session: Option<DocumentEditingSession>,
    autosave_request: Option<(u64, u64, Instant)>,
    observing: bool,
    read_generation: u64,
    next_observation: Instant,
    tx: Sender<Completed>,
    rx: Receiver<Completed>,
}
impl Default for Documents {
    fn default() -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            workspace: None,
            document: None,
            dirty: false,
            revision: 0,
            phase: Phase::Idle,
            error: None,
            status: "Open a folder to start".into(),
            allow_quit: false,
            outgoing: vec![],
            tree_update: None,
            children_update: None,
            folder_busy: false,
            serial: 0,
            session: None,
            autosave_request: None,
            observing: false,
            read_generation: 0,
            next_observation: Instant::now(),
            tx,
            rx,
        }
    }
}
impl Documents {
    /// Background persistence does not block keyboard input or native commands.
    pub fn busy(&self) -> bool {
        !matches!(self.phase, Phase::Idle | Phase::AwaitComposition { .. })
    }
    #[cfg(test)]
    pub fn saving(&self) -> bool {
        self.session.as_ref().is_some_and(|s| !s.drained()) || self.autosave_request.is_some()
    }
    fn ensure_session(&mut self) {
        if let Some(doc) = &self.document {
            if self.session.as_ref().is_none_or(|s| s.id != doc.id) {
                self.session = Some(DocumentEditingSession::new(
                    doc.id.clone(),
                    doc.text.clone(),
                    self.revision,
                ));
                self.autosave_request = None;
                self.read_generation += 1;
            }
        } else {
            self.session = None;
            self.autosave_request = None;
        }
    }
    fn sync_state(&mut self) {
        if let Some(s) = &self.session {
            self.dirty = s.dirty;
            self.revision = s.revision;
        }
    }
    pub fn begin(&mut self, intent: Intent, ctx: &Wake) {
        if !matches!(self.phase, Phase::Idle) {
            return;
        }
        self.ensure_session();
        if let (Intent::OpenFile(path), Some(doc)) = (&intent, &self.document)
            && path == &doc.relative
        {
            return;
        }
        if self.document.is_none() {
            self.execute(intent, ctx);
            return;
        }
        self.autosave_request = None;
        self.serial += 1;
        self.outgoing
            .push(json!({"kind":"snapshot","request":self.serial,"freeze":true}));
        self.phase = Phase::Snapshot {
            request: self.serial,
            intent,
            since: Instant::now(),
        };
        ctx.after(Duration::from_millis(100));
    }
    fn show_document(&mut self) {
        if let Some(doc) = &self.document {
            self.outgoing.push(json!({"kind":"open","id":doc.id,"name":doc.relative.to_string_lossy(),"text":doc.text,"revision":self.revision}));
        } else {
            self.outgoing.push(json!({"kind":"clear"}));
        }
    }
    fn show_storage_update(&mut self) {
        self.autosave_request = None;
        self.read_generation += 1;
        self.outgoing
            .retain(|m| m["kind"] != "snapshot" && m["kind"] != "saved");
        if let Some(doc) = &self.document {
            self.outgoing.push(json!({"kind":"open","id":doc.id,"name":doc.relative.to_string_lossy(),"text":doc.text,"revision":self.revision,"external":true}));
        }
    }
    pub fn client(&mut self, message: ClientMessage, ctx: &Wake) {
        self.ensure_session();
        match message {
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
                    self.sync_state();
                    if let Phase::AwaitComposition { intent } = &self.phase {
                        let intent = intent.clone();
                        self.phase = Phase::Idle;
                        self.begin(intent, ctx);
                    }
                    ctx.notify();
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
                if text.len() > MAX_TEXT_BYTES || text.contains(['\0', '\r']) {
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
                self.session.as_mut().unwrap().enqueue(snapshot.clone());
                self.sync_state();
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
                self.pump(ctx);
            }
            ClientMessage::Loaded { id } => {
                if self.document.as_ref().is_some_and(|d| d.id == id) {
                    self.pump(ctx);
                }
            }
            ClientMessage::OpenPaths { paths } => {
                // Workspace-relative candidates; the first one opens.
                if let (Some(path), Some(workspace)) = (paths.first(), &self.workspace) {
                    let path = std::path::Path::new(path.trim_start_matches('/'));
                    if path.components().all(|c| matches!(c, std::path::Component::Normal(_))) {
                        let target = workspace.path.join(path);
                        self.begin(Intent::OpenFile(target), ctx);
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
    fn thaw(&mut self) {
        self.outgoing.push(json!({"kind":"thaw"}));
    }
    fn fail(&mut self, message: String) {
        self.error = Some(message);
        self.phase = Phase::Idle;
        self.autosave_request = None;
        self.status = "Unable to save · input retained".into();
        self.thaw();
    }
    fn pump(&mut self, ctx: &Wake) {
        if let Some(s) = &mut self.session {
            if let (Some(ws), Some(doc)) = (&self.workspace, &self.document)
                && let Some(commit) = s.next_commit()
            {
                let (ws, doc, tx, wake) = (ws.clone(), doc.clone(), self.tx.clone(), ctx.clone());
                self.status = "Saving…".into();
                crate::localization::spawn(move || {
                    let result = ws.save(&doc, &commit.snapshot.text);
                    let _ = tx.send(Completed::Save {
                        id: doc.id,
                        sequence: commit.sequence,
                        result,
                    });
                    wake.notify();
                });
            }
            if let Some(snapshot) = s.take_receipt() {
                self.outgoing.push(json!({"kind":"saved","id":s.id,"revision":snapshot.revision,"text":snapshot.text}));
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
                self.execute(intent, ctx);
            } else if let Some(s) = &self.session
                && !s.has_active_write()
                && let Some(error) = &s.error
            {
                self.fail(error.clone());
            }
        }
    }
    fn execute(&mut self, intent: Intent, ctx: &Wake) {
        match intent {
            Intent::OpenFolder(path) => {
                self.phase = Phase::Working;
                self.status = "Opening folder…".into();
                let tx = self.tx.clone();
                let ctx = ctx.clone();
                crate::localization::spawn(move || {
                    let result = Workspace::open(&path)
                        .and_then(|ws| ws.list(std::path::Path::new("")).map(|rows| (ws, rows)));
                    let _ = tx.send(Completed::Root(result));
                    ctx.notify();
                });
            }
            Intent::OpenFile(_) | Intent::Reload => {
                let Some(ws) = self.workspace.clone() else {
                    self.fail(crate::localization::t("native.editor.fixtureReadonly").into());
                    return;
                };
                let path = match intent {
                    Intent::OpenFile(path) => path,
                    _ => match &self.document {
                        Some(d) => d.relative.clone(),
                        None => return,
                    },
                };
                self.phase = Phase::Working;
                self.status = "Reading file…".into();
                let tx = self.tx.clone();
                let ctx = ctx.clone();
                crate::localization::spawn(move || {
                    let _ = tx.send(Completed::File(ws.read(&path)));
                    ctx.notify();
                });
            }
            Intent::CloseFile => {
                self.document = None;
                self.dirty = false;
                self.revision = 0;
                self.phase = Phase::Idle;
                self.session = None;
                self.show_document();
                self.status = "Select a text file".into();
            }
            Intent::Quit => {
                self.allow_quit = true;
                self.phase = Phase::Idle;
            }
            Intent::Save => {
                self.phase = Phase::Idle;
                self.thaw();
            }
        }
    }
    pub fn load_children(&mut self, path: PathBuf, ctx: &Wake) {
        let Some(ws) = self.workspace.clone() else {
            return;
        };
        if self.folder_busy {
            return;
        }
        self.folder_busy = true;
        let tx = self.tx.clone();
        let ctx = ctx.clone();
        crate::localization::spawn(move || {
            let result = ws.list(&path);
            let _ = tx.send(Completed::Children(ws, path, result));
            ctx.notify();
        });
    }
    pub fn presentation_key(&self) -> PresentationKey {
        (
            self.document
                .as_ref()
                .map(|d| (d.id.clone(), blake3::hash(d.text.as_bytes()))),
            self.revision,
            self.dirty,
            self.busy(),
            self.status.clone(),
            self.error.clone(),
        )
    }
    pub fn poll(&mut self, ctx: &Wake) {
        self.ensure_session();
        if matches!(&self.phase, Phase::Snapshot { since, .. } if since.elapsed() > Duration::from_secs(5))
        {
            self.fail(crate::localization::t("native.editor.noAck").into());
        }
        if self
            .autosave_request
            .is_some_and(|(_, _, since)| since.elapsed() > Duration::from_secs(5))
        {
            self.fail(crate::localization::t("native.editor.noSaveSnapshot").into());
            if let Some(s) = &mut self.session {
                s.needs_snapshot = false;
            }
        }
        while let Ok(message) = self.rx.try_recv() {
            match message {
                Completed::Root(Ok((ws, rows))) => {
                    self.workspace = Some(ws);
                    self.document = None;
                    self.session = None;
                    self.dirty = false;
                    self.revision = 0;
                    self.folder_busy = false;
                    self.tree_update = Some(rows);
                    self.phase = Phase::Idle;
                    self.error = None;
                    self.status = "Select a text file".into();
                    self.show_document();
                }
                Completed::File(Ok(doc)) => {
                    self.document = Some(doc);
                    self.session = None;
                    self.dirty = false;
                    self.revision = 0;
                    self.phase = Phase::Idle;
                    self.error = None;
                    self.ensure_session();
                    self.status = "Opened".into();
                    self.show_document();
                }
                Completed::Save {
                    id,
                    sequence,
                    result,
                } => {
                    if !self.session.as_ref().is_some_and(|s| s.id == id) {
                        continue;
                    }
                    self.read_generation += 1;
                    let completion = self.session.as_mut().unwrap().complete(
                        sequence,
                        result
                            .as_ref()
                            .map(|r| (r.document.text.clone(), r.updated))
                            .map_err(Clone::clone),
                    );
                    match completion {
                        Completion::Saved => {
                            self.document = Some(result.unwrap().document);
                            self.error = None;
                            self.status = "Saved".into();
                        }
                        Completion::Adopted => {
                            self.document = Some(result.unwrap().document);
                            self.error = None;
                            self.sync_state();
                            self.show_storage_update();
                        }
                        Completion::Failed(error) => {
                            self.error = Some(error);
                        }
                        Completion::Retired => {}
                    }
                }
                Completed::Observed {
                    id,
                    generation,
                    result,
                } => {
                    self.observing = false;
                    if generation != self.read_generation
                        || !matches!(self.phase, Phase::Idle)
                        || !self.session.as_ref().is_some_and(|s| s.id == id)
                    {
                        continue;
                    }
                    match result {
                        Ok(doc) => match self.session.as_mut().unwrap().observe(&doc.text) {
                            StorageObservation::OwnWrite => {}
                            StorageObservation::Baseline => {
                                self.document = Some(doc);
                            }
                            StorageObservation::Adopted => {
                                self.document = Some(doc);
                                self.error = None;
                                self.sync_state();
                                self.show_storage_update();
                            }
                        },
                        Err(error) => self.error = Some(error),
                    }
                }
                Completed::Root(Err(error)) | Completed::File(Err(error)) => self.fail(error),
                Completed::Children(ws, path, result) => {
                    if self
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
        self.pump(ctx);
        if matches!(self.phase, Phase::Idle) {
            if self.autosave_request.is_none()
                && let Some(s) = &mut self.session
                && s.needs_snapshot
            {
                self.serial += 1;
                self.autosave_request = Some((self.serial, s.epoch, Instant::now()));
                s.needs_snapshot = false;
                self.outgoing
                    .push(json!({"kind":"snapshot","request":self.serial,"freeze":false}));
            }
            if !self.observing
                && Instant::now() >= self.next_observation
                && let (Some(ws), Some(doc)) = (&self.workspace, &self.document)
            {
                let (ws, doc, tx, wake, generation) = (
                    ws.clone(),
                    doc.clone(),
                    self.tx.clone(),
                    ctx.clone(),
                    self.read_generation,
                );
                self.observing = true;
                self.next_observation = Instant::now() + Duration::from_millis(500);
                crate::localization::spawn(move || {
                    let result = ws.observe(&doc);
                    let _ = tx.send(Completed::Observed {
                        id: doc.id,
                        generation,
                        result,
                    });
                    wake.notify();
                });
            }
        }
        if self.document.is_some() && !self.allow_quit {
            ctx.after(Duration::from_millis(
                if matches!(self.phase, Phase::Idle) && self.autosave_request.is_none() {
                    500
                } else {
                    100
                },
            ));
        }
    }
}
#[cfg(test)]
mod tests;
