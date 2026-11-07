//! `application/ConversationHistoryController.ts`: project-scoped,
//! query-only state owner. It never creates or resumes a live Chat session.
use super::agent_client_port::{AgentClient as _, AgentClientPort, AgentClientProvider};
use super::agent_error::agent_known_error;
use super::ui_runtime::{Task, UiRuntime, detach, launch, resolved, unstarted};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::dto::{
    CatalogCoverage, RuntimeCatalogEntry, SessionDiscovery, SessionMetadata, SessionsPage,
};
use crate::agent::contract::protocol::{ListSessions, RuntimeQuery};
use crate::features::desktop_agent::domain::agent_backend_routing::list_enabled_agent_runtimes;
use futures_util::future::{LocalBoxFuture, join, join_all};
use std::cell::{Cell, RefCell};
use std::rc::Rc;

pub const HISTORY_PAGE_SIZE: u64 = 20;
pub const AGENT_HISTORY_CATALOG_TIMEOUT_MS: u64 = 8_000;
pub const AGENT_HISTORY_RUNTIME_TIMEOUT_MS: u64 = 8_000;
pub const AGENT_HISTORY_SOURCE_TIMEOUT_MS: u64 = 20_000;

/// `NativeScanContinuation`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeScanContinuation {
    pub cursor: String,
    pub scan_id: String,
}

/// `ConversationHistoryState`. Records keep their insertion order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ConversationHistoryState {
    pub sessions: Vec<SessionMetadata>,
    pub runtimes: Vec<RuntimeCatalogEntry>,
    pub loading: bool,
    pub loaded: bool,
    pub refreshing: bool,
    pub loading_more: bool,
    pub next_cursors: Vec<(String, NativeScanContinuation)>,
    pub catalog_next_cursor: Option<String>,
    pub sources: Vec<(String, SessionDiscovery)>,
    pub catalog_coverage: Option<CatalogCoverage>,
    pub error: Option<String>,
}

impl ConversationHistoryState {
    /// `state.nextCursors[runtimeId]`.
    pub fn next_cursor(&self, runtime_id: &str) -> Option<&NativeScanContinuation> {
        self.next_cursors
            .iter()
            .find(|(id, _)| id == runtime_id)
            .map(|(_, c)| c)
    }
    /// `state.sources[runtimeId]`.
    pub fn source(&self, runtime_id: &str) -> Option<&SessionDiscovery> {
        self.sources
            .iter()
            .find(|(id, _)| id == runtime_id)
            .map(|(_, s)| s)
    }
}

/// `Partial<ConversationHistoryState>`.
#[derive(Default)]
struct Patch {
    sessions: Option<Vec<SessionMetadata>>,
    runtimes: Option<Vec<RuntimeCatalogEntry>>,
    loading: Option<bool>,
    loaded: Option<bool>,
    refreshing: Option<bool>,
    loading_more: Option<bool>,
    next_cursors: Option<Vec<(String, NativeScanContinuation)>>,
    catalog_next_cursor: Option<Option<String>>,
    sources: Option<Vec<(String, SessionDiscovery)>>,
    catalog_coverage: Option<Option<CatalogCoverage>>,
    error: Option<Option<String>>,
}

type Listener = Rc<dyn Fn()>;

/// `new ConversationHistoryController(workspaceRoot, clientProvider)`.
#[derive(Clone)]
pub struct ConversationHistoryController(Rc<Inner>);

struct Inner {
    workspace_root: String,
    client_provider: AgentClientProvider,
    runtime: Rc<dyn UiRuntime>,
    state: RefCell<ConversationHistoryState>,
    revision: Cell<u64>,
    listeners: RefCell<Vec<(u64, Listener)>>,
    next_listener: Cell<u64>,
    generation: Cell<u64>,
    catalog_request: Cell<u64>,
    active: Cell<bool>,
    catalog_loaded: Cell<bool>,
    runtime_inspection_complete: Cell<bool>,
    auto_refresh_generation: Cell<Option<u64>>,
    refresh_promise: RefCell<Option<(u64, Task<()>)>>,
    load_more_promise: RefCell<Option<(u64, Task<()>)>>,
    next_task: Cell<u64>,
}

fn message_of(error: &AgentError) -> String {
    error.message.clone()
}

/// `withDeadline(operation, timeoutMs, label)`.
async fn with_deadline<T>(
    runtime: &Rc<dyn UiRuntime>,
    operation: LocalBoxFuture<'static, AgentResult<T>>,
    timeout_ms: u64,
    label: &str,
) -> AgentResult<T> {
    let timer = runtime.sleep(timeout_ms);
    tokio::select! {
        biased;
        result = operation => result,
        () = timer => Err(AgentError::new(format!("{label} timed out."))),
    }
}

/// `historyRuntimes(runtimes)`.
fn history_runtimes(runtimes: &[RuntimeCatalogEntry]) -> Vec<RuntimeCatalogEntry> {
    runtimes
        .iter()
        .filter(|entry| {
            entry.readiness.is_ready()
                && entry
                    .descriptor
                    .ownership
                    .as_ref()
                    .is_some_and(|o| o.session == "runtime")
        })
        .cloned()
        .collect()
}

/// `sortSessions(sessions)`: newest first, stable.
fn sort_sessions(mut sessions: Vec<SessionMetadata>) -> Vec<SessionMetadata> {
    sessions
        .sort_by(|left, right| crate::text::locale_compare(&right.updated_at, &left.updated_at));
    sessions
}

/// `entry.runtimeId ?? entry.provider`.
fn session_runtime(entry: &SessionMetadata) -> &str {
    entry.runtime_id.as_deref().unwrap_or(&entry.provider)
}

/// `sourceWarnings(sources)`.
fn source_warnings(sources: &[(String, SessionDiscovery)]) -> Option<String> {
    let warnings: Vec<String> = sources
        .iter()
        .flat_map(|(id, source)| {
            source
                .warnings
                .iter()
                .map(move |warning| format!("{id}: {warning}"))
        })
        .collect();
    (!warnings.is_empty()).then(|| warnings.join("\n"))
}

/// `{ ...record, [key]: value }`.
fn with_entry<T>(record: &[(String, T)], key: &str, value: T) -> Vec<(String, T)>
where
    T: Clone,
{
    let mut next = record.to_vec();
    match next.iter_mut().find(|(k, _)| k == key) {
        Some(slot) => slot.1 = value,
        None => next.push((key.to_string(), value)),
    }
    next
}

/// `new Map(entries.map((entry) => [entry.id, entry])).values()`.
fn dedupe_by_id(entries: Vec<SessionMetadata>) -> Vec<SessionMetadata> {
    let mut merged: Vec<SessionMetadata> = Vec::new();
    for entry in entries {
        match merged.iter_mut().find(|existing| existing.id == entry.id) {
            Some(existing) => *existing = entry,
            None => merged.push(entry),
        }
    }
    merged
}

impl ConversationHistoryController {
    pub fn new(
        workspace_root: &str,
        client_provider: AgentClientProvider,
        runtime: Rc<dyn UiRuntime>,
    ) -> Self {
        Self(Rc::new(Inner {
            workspace_root: workspace_root.to_string(),
            client_provider,
            runtime,
            state: RefCell::default(),
            revision: Cell::new(0),
            listeners: RefCell::default(),
            next_listener: Cell::new(0),
            generation: Cell::new(0),
            catalog_request: Cell::new(0),
            active: Cell::new(false),
            catalog_loaded: Cell::new(false),
            runtime_inspection_complete: Cell::new(false),
            auto_refresh_generation: Cell::new(None),
            refresh_promise: RefCell::default(),
            load_more_promise: RefCell::default(),
            next_task: Cell::new(0),
        }))
    }

    /// `getSnapshot()` (a copy).
    pub fn get_snapshot(&self) -> ConversationHistoryState {
        self.0.state.borrow().clone()
    }

    /// Increments with every published state (`getSnapshot()` identity).
    pub fn revision(&self) -> u64 {
        self.0.revision.get()
    }

    /// `subscribe(listener)`: the returned closure unsubscribes.
    pub fn subscribe(&self, listener: Rc<dyn Fn()>) -> impl FnOnce() + 'static {
        let id = self.0.next_listener.get() + 1;
        self.0.next_listener.set(id);
        self.0.listeners.borrow_mut().push((id, listener));
        let inner = Rc::downgrade(&self.0);
        move || {
            if let Some(inner) = inner.upgrade() {
                inner
                    .listeners
                    .borrow_mut()
                    .retain(|(listener, _)| *listener != id);
            }
        }
    }

    pub fn activate(&self) {
        let inner = &self.0;
        if inner.active.get() {
            return;
        }
        inner.active.set(true);
        let generation = inner.generation.get() + 1;
        inner.generation.set(generation);
        inner.catalog_loaded.set(false);
        inner.runtime_inspection_complete.set(false);
        inner.auto_refresh_generation.set(None);
        inner.patch(Patch {
            loading: Some(true),
            loaded: Some(false),
            refreshing: Some(false),
            loading_more: Some(false),
            error: Some(None),
            next_cursors: Some(Vec::new()),
            catalog_next_cursor: Some(None),
            sources: Some(Vec::new()),
            catalog_coverage: Some(None),
            ..Default::default()
        });
        detach(
            &inner.runtime,
            inner.clone().load_initial_catalog(generation),
        );
        detach(&inner.runtime, inner.clone().inspect_runtimes(generation));
    }

    pub fn deactivate(&self) {
        self.0.deactivate();
    }

    pub fn dispose(&self) {
        self.0.deactivate();
        self.0.listeners.borrow_mut().clear();
    }

    pub fn refresh(&self) -> Task<()> {
        let inner = &self.0;
        if !inner.active.get() {
            return resolved(());
        }
        inner.start_refresh(inner.generation.get(), true)
    }

    pub fn load_more(&self) -> Task<()> {
        let inner = &self.0;
        if !inner.active.get() {
            return resolved(());
        }
        if let Some((_, task)) = inner.load_more_promise.borrow().as_ref() {
            return task.clone();
        }
        let generation = inner.generation.get();
        let id = inner.task_id();
        let operation = inner.clone();
        let task = unstarted(async move {
            operation.clone().run_load_more(generation).await;
            let current = operation
                .load_more_promise
                .borrow()
                .as_ref()
                .is_some_and(|(task, _)| *task == id);
            if current {
                *operation.load_more_promise.borrow_mut() = None;
            }
        });
        *inner.load_more_promise.borrow_mut() = Some((id, task.clone()));
        launch(&inner.runtime, &task);
        task
    }
}

impl Inner {
    fn task_id(&self) -> u64 {
        let id = self.next_task.get() + 1;
        self.next_task.set(id);
        id
    }

    fn deactivate(&self) {
        if !self.active.get() {
            return;
        }
        self.active.set(false);
        self.generation.set(self.generation.get() + 1);
        *self.refresh_promise.borrow_mut() = None;
        *self.load_more_promise.borrow_mut() = None;
    }

    fn is_current(&self, generation: u64) -> bool {
        self.active.get() && generation == self.generation.get()
    }

    fn read<R>(&self, read: impl FnOnce(&ConversationHistoryState) -> R) -> R {
        read(&self.state.borrow())
    }

    fn patch(&self, patch: Patch) {
        if !self.active.get() {
            return;
        }
        {
            let mut state = self.state.borrow_mut();
            if let Some(value) = patch.sessions {
                state.sessions = value;
            }
            if let Some(value) = patch.runtimes {
                state.runtimes = value;
            }
            if let Some(value) = patch.loading {
                state.loading = value;
            }
            if let Some(value) = patch.loaded {
                state.loaded = value;
            }
            if let Some(value) = patch.refreshing {
                state.refreshing = value;
            }
            if let Some(value) = patch.loading_more {
                state.loading_more = value;
            }
            if let Some(value) = patch.next_cursors {
                state.next_cursors = value;
            }
            if let Some(value) = patch.catalog_next_cursor {
                state.catalog_next_cursor = value;
            }
            if let Some(value) = patch.sources {
                state.sources = value;
            }
            if let Some(value) = patch.catalog_coverage {
                state.catalog_coverage = value;
            }
            if let Some(value) = patch.error {
                state.error = value;
            }
        }
        self.revision.set(self.revision.get() + 1);
        let listeners: Vec<Rc<dyn Fn()>> = self
            .listeners
            .borrow()
            .iter()
            .map(|(_, l)| l.clone())
            .collect();
        for listener in listeners {
            listener();
        }
    }

    fn require_client(&self) -> AgentResult<Rc<dyn AgentClientPort>> {
        (self.client_provider)().ok_or_else(|| agent_known_error("native-bridge-unavailable", None))
    }

    fn start_refresh(self: &Rc<Self>, generation: u64, refresh_metadata: bool) -> Task<()> {
        if let Some((_, task)) = self.refresh_promise.borrow().as_ref() {
            return task.clone();
        }
        let id = self.task_id();
        let operation = self.clone();
        let task = unstarted(async move {
            operation
                .clone()
                .run_refresh(generation, refresh_metadata)
                .await;
            let current = operation
                .refresh_promise
                .borrow()
                .as_ref()
                .is_some_and(|(task, _)| *task == id);
            if current {
                *operation.refresh_promise.borrow_mut() = None;
            }
        });
        *self.refresh_promise.borrow_mut() = Some((id, task.clone()));
        launch(&self.runtime, &task);
        task
    }

    async fn load_initial_catalog(self: Rc<Self>, generation: u64) {
        if let Err(error) = self.clone().load_catalog(generation).await
            && self.is_current(generation)
        {
            self.patch(Patch {
                error: Some(Some(message_of(&error))),
                ..Default::default()
            });
        }
        if self.is_current(generation) {
            self.catalog_loaded.set(true);
            self.maybe_auto_refresh(generation);
        }
    }

    async fn inspect_runtimes(self: Rc<Self>, generation: u64) {
        if let Err(error) = self.clone().discover_runtimes(generation, false).await
            && self.is_current(generation)
        {
            let error = self
                .read(|state| state.error.clone())
                .unwrap_or_else(|| message_of(&error));
            self.patch(Patch {
                error: Some(Some(error)),
                ..Default::default()
            });
        }
        if self.is_current(generation) {
            self.runtime_inspection_complete.set(true);
            self.maybe_auto_refresh(generation);
        }
    }

    async fn discover_runtimes(self: Rc<Self>, generation: u64, refresh: bool) -> AgentResult<()> {
        let call = self.require_client()?.discover_runtimes(RuntimeQuery {
            root_path: Some(self.workspace_root.clone()),
            refresh: Some(refresh),
            ..RuntimeQuery::default()
        });
        let inspection = with_deadline(
            &self.runtime,
            call,
            AGENT_HISTORY_RUNTIME_TIMEOUT_MS,
            "Agent runtime discovery",
        )
        .await?;
        if self.is_current(generation) {
            self.patch(Patch {
                runtimes: Some(list_enabled_agent_runtimes(Some(&inspection), None)),
                ..Default::default()
            });
        }
        Ok(())
    }

    fn maybe_auto_refresh(self: &Rc<Self>, generation: u64) {
        if !self.is_current(generation)
            || !self.catalog_loaded.get()
            || !self.runtime_inspection_complete.get()
        {
            return;
        }
        if self.auto_refresh_generation.get() == Some(generation) {
            return;
        }
        self.auto_refresh_generation.set(Some(generation));
        if self.read(|state| history_runtimes(&state.runtimes).is_empty()) {
            self.finish_initial_load(generation);
            return;
        }
        let refresh = self.start_refresh(generation, false);
        let inner = self.clone();
        detach(&self.runtime, async move {
            refresh.await;
            inner.finish_initial_load(generation);
        });
    }

    fn finish_initial_load(&self, generation: u64) {
        if self.is_current(generation) {
            self.patch(Patch {
                loading: Some(false),
                loaded: Some(true),
                ..Default::default()
            });
        }
    }

    async fn run_refresh(self: Rc<Self>, generation: u64, refresh_metadata: bool) {
        if self.load_more_promise.borrow().is_some() {
            return;
        }
        let mut metadata_errors: Vec<String> = if refresh_metadata {
            Vec::new()
        } else {
            self.read(|state| state.error.clone()).into_iter().collect()
        };
        self.patch(Patch {
            refreshing: Some(true),
            error: Some(None),
            next_cursors: Some(Vec::new()),
            sources: Some(Vec::new()),
            ..Default::default()
        });
        let completed: bool = async {
            if refresh_metadata {
                let (catalog, runtimes) = join(
                    self.clone().load_catalog(generation),
                    self.clone().discover_runtimes(generation, true),
                )
                .await;
                if !self.is_current(generation) {
                    return false;
                }
                if let Err(error) = catalog {
                    metadata_errors.push(message_of(&error));
                }
                if let Err(error) = runtimes {
                    metadata_errors.push(message_of(&error));
                }
            }
            let runtimes = self.read(|state| history_runtimes(&state.runtimes));
            join_all(runtimes.iter().map(|runtime| {
                let id = runtime.descriptor.id.clone();
                self.clone().load_source(generation, id, None)
            }))
            .await;
            true
        }
        .await;
        let _ = completed;
        if self.is_current(generation) {
            let mut errors = metadata_errors;
            if let Some(warnings) = self.read(|state| source_warnings(&state.sources)) {
                errors.push(warnings);
            }
            let errors: Vec<String> = errors.into_iter().filter(|e| !e.is_empty()).collect();
            self.patch(Patch {
                refreshing: Some(false),
                error: Some((!errors.is_empty()).then(|| errors.join("\n"))),
                ..Default::default()
            });
        }
    }

    async fn run_load_more(self: Rc<Self>, generation: u64) {
        if self.refresh_promise.borrow().is_some() {
            return;
        }
        let (pending, catalog_cursor) = self.read(|state| {
            (
                state.next_cursors.clone(),
                state.catalog_next_cursor.clone(),
            )
        });
        if pending.is_empty() && catalog_cursor.is_none() {
            return;
        }
        self.patch(Patch {
            loading_more: Some(true),
            error: Some(None),
            ..Default::default()
        });
        let mut loads: Vec<LocalBoxFuture<'static, ()>> = pending
            .into_iter()
            .map(|(runtime_id, continuation)| {
                Box::pin(
                    self.clone()
                        .load_source(generation, runtime_id, Some(continuation)),
                ) as LocalBoxFuture<'static, ()>
            })
            .collect();
        if let Some(cursor) = catalog_cursor {
            loads.push(Box::pin(self.clone().load_catalog_page(generation, cursor)));
        }
        join_all(loads).await;
        if self.is_current(generation) {
            self.patch(Patch {
                loading_more: Some(false),
                ..Default::default()
            });
        }
    }

    async fn load_source(
        self: Rc<Self>,
        generation: u64,
        runtime_id: String,
        continuation: Option<NativeScanContinuation>,
    ) {
        let result: AgentResult<()> = async {
            let request = ListSessions {
                root_path: self.workspace_root.clone(),
                runtime_id: Some(runtime_id.clone()),
                discover_native: Some(true),
                limit: Some(HISTORY_PAGE_SIZE as i64),
                cursor: continuation.as_ref().map(|c| c.cursor.clone()),
                scan_id: continuation.as_ref().map(|c| c.scan_id.clone()),
                ..ListSessions::default()
            };
            let call = self.require_client()?.list_sessions(request);
            let response = with_deadline(
                &self.runtime,
                call,
                AGENT_HISTORY_SOURCE_TIMEOUT_MS,
                &format!("{runtime_id} history"),
            )
            .await?;
            if !self.is_current(generation) {
                return Ok(());
            }
            let discovery = response.discovery.clone();
            if discovery.runtime_id.as_deref() != Some(runtime_id.as_str()) {
                return Err(AgentError::new(
                    "History response has a different Agent identity.",
                ));
            }
            let state = self.state.borrow().clone();
            let mut cursors = state.next_cursors.clone();
            let next_cursor = discovery.next_cursor.as_deref().filter(|c| !c.is_empty());
            let scan_id = discovery.scan_id.as_deref().filter(|s| !s.is_empty());
            if let (Some(cursor), Some(scan_id)) = (next_cursor, scan_id) {
                cursors = with_entry(
                    &cursors,
                    &runtime_id,
                    NativeScanContinuation {
                        cursor: cursor.to_string(),
                        scan_id: scan_id.to_string(),
                    },
                );
            } else if discovery.status == "failed"
                && discovery.retryable != Some(false)
                && let Some(continuation) = &continuation
            {
                cursors = with_entry(&cursors, &runtime_id, continuation.clone());
            } else {
                cursors.retain(|(id, _)| *id != runtime_id);
            }
            let sources = with_entry(&state.sources, &runtime_id, discovery.clone());
            // Merge this native page immediately. Only explicit exclusions
            // remove rows; absence from a page is not evidence that a
            // conversation disappeared.
            let excluded: Vec<String> = response.excluded_session_ids.clone().unwrap_or_default();
            let mine = |entry: &&SessionMetadata| session_runtime(entry) == runtime_id.as_str();
            let others: Vec<SessionMetadata> = state
                .sessions
                .iter()
                .filter(|e| !mine(e))
                .cloned()
                .collect();
            let incoming: Vec<SessionMetadata> =
                response.sessions.iter().filter(mine).cloned().collect();
            let retained: Vec<SessionMetadata> = if discovery.status == "failed"
                || response.session_list_kind.as_deref() == Some("page")
            {
                state.sessions.iter().filter(mine).cloned().collect()
            } else {
                Vec::new()
            };
            let source_sessions = dedupe_by_id(retained.into_iter().chain(incoming).collect());
            self.catalog_request.set(self.catalog_request.get() + 1);
            let sessions = sort_sessions(
                others
                    .into_iter()
                    .chain(source_sessions)
                    .filter(|entry| !excluded.contains(&entry.id))
                    .collect(),
            );
            let catalog_next_cursor = (continuation.is_none())
                .then(|| {
                    response
                        .catalog_next_cursor
                        .clone()
                        .filter(|c| !c.is_empty())
                })
                .flatten();
            let coverage = response
                .catalog_coverage
                .clone()
                .or(state.catalog_coverage.clone());
            let error = source_warnings(&sources);
            self.patch(Patch {
                sources: Some(sources),
                next_cursors: Some(cursors),
                sessions: Some(sessions),
                catalog_next_cursor: catalog_next_cursor.map(Some),
                catalog_coverage: Some(coverage),
                error: Some(error),
                ..Default::default()
            });
            Ok(())
        }
        .await;
        if let Err(error) = result {
            if !self.is_current(generation) {
                return;
            }
            let failed = SessionDiscovery {
                runtime_id: Some(runtime_id.clone()),
                status: "failed".into(),
                indexed: 0,
                next_cursor: continuation.as_ref().map(|c| c.cursor.clone()),
                scan_id: continuation.as_ref().map(|c| c.scan_id.clone()),
                retryable: Some(true),
                warnings: vec![message_of(&error)],
                ..SessionDiscovery::default()
            };
            let sources = self.read(|state| with_entry(&state.sources, &runtime_id, failed));
            let error = source_warnings(&sources);
            self.patch(Patch {
                sources: Some(sources),
                error: Some(error),
                ..Default::default()
            });
        }
    }

    async fn load_catalog(self: Rc<Self>, generation: u64) -> AgentResult<SessionsPage> {
        let request = self.catalog_request.get() + 1;
        self.catalog_request.set(request);
        let call = self.require_client()?.list_sessions(ListSessions {
            root_path: self.workspace_root.clone(),
            include_archived: Some(false),
            discover_native: Some(false),
            ..ListSessions::default()
        });
        let response = with_deadline(
            &self.runtime,
            call,
            AGENT_HISTORY_CATALOG_TIMEOUT_MS,
            "Chat history catalog",
        )
        .await?;
        if self.is_current(generation) && request == self.catalog_request.get() {
            self.patch(Patch {
                sessions: Some(sort_sessions(response.sessions.clone())),
                catalog_coverage: Some(response.catalog_coverage.clone()),
                catalog_next_cursor: Some(response.catalog_next_cursor.clone()),
                ..Default::default()
            });
        }
        Ok(response)
    }

    async fn load_catalog_page(self: Rc<Self>, generation: u64, cursor: String) {
        let result: AgentResult<()> = async {
            let call = self.require_client()?.list_sessions(ListSessions {
                root_path: self.workspace_root.clone(),
                discover_native: Some(false),
                catalog_cursor: Some(cursor.clone()),
                ..ListSessions::default()
            });
            let response = with_deadline(
                &self.runtime,
                call,
                AGENT_HISTORY_CATALOG_TIMEOUT_MS,
                "Chat history catalog",
            )
            .await?;
            if !self.is_current(generation)
                || self.read(|state| state.catalog_next_cursor.as_deref() != Some(cursor.as_str()))
            {
                return Ok(());
            }
            let excluded: Vec<String> = response.excluded_session_ids.clone().unwrap_or_default();
            let current = self.read(|state| state.sessions.clone());
            let merged = dedupe_by_id(
                current
                    .into_iter()
                    .chain(response.sessions.clone())
                    .filter(|entry| !excluded.contains(&entry.id))
                    .collect(),
            );
            self.patch(Patch {
                sessions: Some(sort_sessions(merged)),
                catalog_next_cursor: Some(response.catalog_next_cursor.clone()),
                ..Default::default()
            });
            Ok(())
        }
        .await;
        if let Err(error) = result
            && self.is_current(generation)
        {
            self.patch(Patch {
                error: Some(Some(message_of(&error))),
                ..Default::default()
            });
        }
    }
}
