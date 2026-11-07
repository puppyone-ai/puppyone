//! `application/history/native-conversation-indexer.mjs`: bounded History
//! scans own their query resources and a metadata-only catalog port.
use super::super::ports::{Guard, HistoryCatalog};
use super::super::processes::agent_process_supervisor::AgentProcessSupervisor;
use super::super::runtime_resolution::runtime_resolution_coordinator::RuntimeResolutionCoordinator;
use super::history_operation::{history_failure, observe_history_operation};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::history_schema::{
    history_cursor, history_locators, history_page_size, limits,
};
use crate::agent::contract::js::Obj;
use crate::agent::runtime::agent_runtime_port::{AdapterOptions, AgentRuntimeAdapter};
use crate::agent::runtime::agent_runtime_registry::AgentRuntimeRegistry;
use crate::agent::runtime::agent_session_history_port::resolve_agent_session_history_port;
use crate::agent::tasks::{Canceller, SharedTask, shared};
use crate::clock;
use crate::text;
use regex::Regex;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::sync::Notify;

pub const DEFAULT_NATIVE_CONVERSATION_DISCOVERY_TIMEOUT_MS: i64 = 15_000;
const CLEANUP_TIMEOUT_MS: u64 = 2_000;
const SCAN_TTL_MS: i64 = 5 * 60_000;

static SOURCE_SCOPE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._/-]{1,512}$").expect("source scope"));

struct Scan {
    id: String,
    key: String,
    workspace_root: String,
    runtime_id: String,
    owner_id: Option<u64>,
    started_at: i64,
    expires_at: Cell<i64>,
    provider_session_ids: RefCell<HashSet<String>>,
    cursors: RefCell<HashSet<String>>,
    next_cursor: RefCell<Option<String>>,
    pages: Cell<usize>,
    page_size: usize,
    snapshot: RefCell<Option<String>>,
    authoritative: Cell<bool>,
    source_scope_id: RefCell<Option<String>>,
    started_revision: Cell<Option<i64>>,
    pending: RefCell<Option<SharedTask<Value>>>,
    controller: RefCell<Option<Canceller>>,
}

struct Resource {
    key: String,
    workspace_root: String,
    owner_id: Option<u64>,
    adapter: RefCell<Option<Rc<dyn AgentRuntimeAdapter>>>,
    cleanup: RefCell<Option<SharedTask<AgentResult<()>>>>,
    closed: Cell<bool>,
    done: Notify,
}

struct State {
    registry: AgentRuntimeRegistry,
    coordinator: RuntimeResolutionCoordinator,
    catalog: Rc<dyn HistoryCatalog>,
    supervisor: AgentProcessSupervisor,
    discovery_timeout_ms: i64,
    scan_timeout_ms: i64,
    max_pages: usize,
    max_entries: usize,
    max_scans: usize,
    scans: RefCell<HashMap<String, Rc<Scan>>>,
    latest: RefCell<HashMap<String, Rc<Scan>>>,
    resources: RefCell<HashMap<String, Rc<Resource>>>,
    disposed: Cell<bool>,
}

#[derive(Clone)]
pub struct NativeConversationIndexer(Rc<State>);

fn response(runtime_id: &str, status: &str) -> Value {
    json!({ "runtimeId": runtime_id, "status": status, "nextCursor": null, "scanId": null, "indexed": 0, "warnings": [] })
}

fn failed(runtime_id: &str, error: &AgentError) -> Value {
    Obj::from(&response(runtime_id, "failed"))
        .set("retryable", error.retryable != Some(false))
        .set(
            "warnings",
            vec![text::head16(&redact_secret_text(&error.message), 4_000).to_string()],
        )
        .build()
}

impl NativeConversationIndexer {
    /// `createNativeConversationIndexer({ runtimeRegistry, runtimeResolutionCoordinator, catalog, processSupervisor, … })`.
    pub fn new(
        registry: AgentRuntimeRegistry,
        coordinator: RuntimeResolutionCoordinator,
        catalog: Rc<dyn HistoryCatalog>,
        supervisor: AgentProcessSupervisor,
    ) -> Self {
        Self(Rc::new(State {
            registry,
            coordinator,
            catalog,
            supervisor,
            discovery_timeout_ms: DEFAULT_NATIVE_CONVERSATION_DISCOVERY_TIMEOUT_MS,
            scan_timeout_ms: 10 * 60_000,
            max_pages: 100,
            max_entries: 10_000,
            max_scans: 100,
            scans: RefCell::default(),
            latest: RefCell::default(),
            resources: RefCell::default(),
            disposed: Cell::new(false),
        }))
    }

    fn current(&self, scan: &Rc<Scan>) -> bool {
        !self.0.disposed.get()
            && self
                .0
                .latest
                .borrow()
                .get(&scan.key)
                .is_some_and(|s| Rc::ptr_eq(s, scan))
            && self
                .0
                .scans
                .borrow()
                .get(&scan.id)
                .is_some_and(|s| Rc::ptr_eq(s, scan))
    }

    fn expire(&self, scan: &Rc<Scan>, reason: Option<AgentError>) {
        if let (Some(controller), Some(reason)) = (scan.controller.borrow().clone(), reason) {
            controller.cancel(reason);
        }
        self.0.scans.borrow_mut().remove(&scan.id);
        let mut latest = self.0.latest.borrow_mut();
        if latest.get(&scan.key).is_some_and(|s| Rc::ptr_eq(s, scan)) {
            latest.remove(&scan.key);
        }
    }

    /// `indexer.refresh(request)`.
    pub async fn refresh(
        &self,
        workspace_root: &str,
        runtime_id: &str,
        cursor: Value,
        scan_id: Option<String>,
        limit: Option<Value>,
        owner_id: Option<u64>,
    ) -> Value {
        let admitted = (|| {
            if self.0.disposed.get() {
                return Err(history_failure(
                    "History queries are closed.",
                    Some("HISTORY_CLOSED"),
                    Some(false),
                ));
            }
            let now = clock::now_ms();
            let expired: Vec<Rc<Scan>> = self
                .0
                .scans
                .borrow()
                .values()
                .filter(|scan| {
                    scan.expires_at.get() <= now || now - scan.started_at >= self.0.scan_timeout_ms
                })
                .cloned()
                .collect();
            for scan in expired {
                self.expire(
                    &scan,
                    Some(history_failure(
                        "History scan expired. Refresh history.",
                        Some("HISTORY_SCAN_EXPIRED"),
                        Some(false),
                    )),
                );
            }
            let key = serde_json::to_string(&(workspace_root, runtime_id)).unwrap_or_default();
            let cursor = history_cursor(Some(&cursor))?;
            let page_size = history_page_size(limit.as_ref());
            let scan = if cursor.is_some() {
                let scan = scan_id
                    .as_deref()
                    .and_then(|id| self.0.scans.borrow().get(id).cloned());
                let valid = scan.as_ref().is_some_and(|scan| {
                    scan.key == key
                        && self.current(scan)
                        && *scan.next_cursor.borrow() == cursor
                        && scan.page_size == page_size
                });
                let Some(scan) = scan.filter(|_| valid) else {
                    return Err(history_failure(
                        "History continuation is no longer valid. Refresh history.",
                        Some("HISTORY_SCAN_EXPIRED"),
                        Some(false),
                    ));
                };
                if let Some(pending) = scan.pending.borrow().clone() {
                    return Ok((scan.clone(), cursor, Some(pending)));
                }
                scan
            } else {
                if scan_id.is_some() {
                    return Err(history_failure(
                        "History continuation is invalid.",
                        Some("HISTORY_SCAN_EXPIRED"),
                        Some(false),
                    ));
                }
                if let Some(previous) = self.0.latest.borrow().get(&key).cloned() {
                    self.expire(
                        &previous,
                        Some(history_failure(
                            "History scan was superseded.",
                            Some("HISTORY_SCAN_EXPIRED"),
                            Some(false),
                        )),
                    );
                }
                if self.0.scans.borrow().len() >= self.0.max_scans
                    || (!self.0.resources.borrow().contains_key(&key)
                        && self.0.resources.borrow().len() >= self.0.max_scans)
                {
                    return Err(history_failure(
                        "Too many History scans. Try again after a scan finishes.",
                        None,
                        None,
                    ));
                }
                let scan = Rc::new(Scan {
                    id: uuid::Uuid::new_v4().to_string(),
                    key: key.clone(),
                    workspace_root: workspace_root.to_string(),
                    runtime_id: runtime_id.to_string(),
                    owner_id,
                    started_at: now,
                    expires_at: Cell::new(now + SCAN_TTL_MS),
                    provider_session_ids: RefCell::default(),
                    cursors: RefCell::default(),
                    next_cursor: RefCell::new(None),
                    pages: Cell::new(0),
                    page_size,
                    snapshot: RefCell::new(None),
                    authoritative: Cell::new(true),
                    source_scope_id: RefCell::new(None),
                    started_revision: Cell::new(None),
                    pending: RefCell::new(None),
                    controller: RefCell::new(None),
                });
                self.0
                    .scans
                    .borrow_mut()
                    .insert(scan.id.clone(), scan.clone());
                self.0.latest.borrow_mut().insert(key, scan.clone());
                scan
            };
            Ok((scan, cursor, None))
        })();
        let (scan, cursor, pending) = match admitted {
            Ok(admitted) => admitted,
            Err(error) => return failed(runtime_id, &error),
        };
        if let Some(pending) = pending {
            return pending.await;
        }
        let indexer = self.clone();
        let page_scan = scan.clone();
        let page_size = scan.page_size;
        let operation = shared(async move { indexer.run_page(page_scan, cursor, page_size).await });
        *scan.pending.borrow_mut() = Some(operation.clone());
        let result = operation.clone().await;
        if scan
            .pending
            .borrow()
            .as_ref()
            .is_some_and(|p| p.ptr_eq(&operation))
        {
            *scan.pending.borrow_mut() = None;
        }
        result
    }

    async fn run_page(&self, scan: Rc<Scan>, cursor: Option<String>, limit: usize) -> Value {
        let controller = Canceller::new();
        *scan.controller.borrow_mut() = Some(controller.clone());
        let remaining = self
            .0
            .discovery_timeout_ms
            .min(self.0.scan_timeout_ms - (clock::now_ms() - scan.started_at))
            .max(1) as u64;
        let timer = {
            let controller = controller.clone();
            crate::agent::tasks::spawn_after(
                std::time::Duration::from_millis(remaining),
                move || controller.cancel(history_failure("History query timed out.", None, None)),
            )
        };
        let indexed = Rc::new(Cell::new(0i64));
        let commit_pending = Rc::new(Cell::new(false));
        let resource_slot: Rc<RefCell<Option<Rc<Resource>>>> = Rc::default();
        let guard = {
            let indexer = self.clone();
            let scan = scan.clone();
            let signal = controller.signal();
            Rc::new(move || {
                if !indexer.current(&scan) {
                    return Err(history_failure(
                        "History scan was superseded. Refresh history.",
                        Some("HISTORY_SCAN_EXPIRED"),
                        Some(false),
                    ));
                }
                signal.check()
            }) as Guard
        };
        let page = observe_history_operation(
            self.page_body(
                &scan,
                cursor.clone(),
                limit,
                &controller,
                guard.clone(),
                indexed.clone(),
                commit_pending.clone(),
                resource_slot.clone(),
            ),
            &controller.signal(),
        )
        .await;
        timer.abort();
        let result = match page.and_then(|page| guard().map(|()| page)) {
            Ok(None) => {
                self.expire(&scan, None);
                response(&scan.runtime_id, "unsupported")
            }
            Ok(Some(page)) => {
                let next_cursor = page["nextCursor"].as_str().map(str::to_string);
                if next_cursor.is_none() {
                    self.expire(&scan, None);
                }
                let complete = page["authoritative"] == true && next_cursor.is_none();
                Obj::from(&response(&scan.runtime_id, if next_cursor.is_some() { "partial" } else { "complete" }))
                    .set("indexed", indexed.get())
                    .set("nextCursor", next_cursor.clone())
                    .set("scanId", next_cursor.as_ref().map(|_| scan.id.clone()))
                    .set("sourceScopeId", page["sourceScopeId"].clone())
                    .set("sessions", page["sessions"].clone())
                    .set("coverage", if complete { "complete" } else { "unknown" })
                    .set(
                        "warnings",
                        if page["truncated"] == true {
                            json!(["The local history catalog reached its capacity; some records are not retained."])
                        } else {
                            json!([])
                        },
                    )
                    .build()
            }
            Err(error) => {
                // List failures never invalidate live-session readiness or mutate its state.
                let retryable =
                    !commit_pending.get() && error.retryable != Some(false) && self.current(&scan);
                if !retryable {
                    self.expire(&scan, Some(error.clone()));
                }
                let mut out =
                    Obj::from(&failed(&scan.runtime_id, &error)).set("indexed", indexed.get());
                if commit_pending.get() {
                    out = out.set("catalogCommit", "pending").set(
                        "warnings",
                        json!(["The history catalog write is still settling. Refresh history before continuing."]),
                    );
                }
                out.set("retryable", retryable)
                    .set("nextCursor", if retryable { cursor.clone() } else { None })
                    .set(
                        "scanId",
                        if retryable && cursor.is_some() {
                            Some(scan.id.clone())
                        } else {
                            None
                        },
                    )
                    .build()
            }
        };
        let resource = resource_slot.borrow().clone();
        if let Some(resource) = resource {
            // Keep a stalled cleanup quarantined; repeated refreshes cannot spawn more native resources.
            let cleanup = self.dispose_resource(&resource);
            let _ = tokio::time::timeout(Duration::from_millis(CLEANUP_TIMEOUT_MS), cleanup).await;
        }
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn page_body(
        &self,
        scan: &Rc<Scan>,
        cursor: Option<String>,
        limit: usize,
        controller: &Canceller,
        guard: Guard,
        indexed: Rc<Cell<i64>>,
        commit_pending: Rc<Cell<bool>>,
        resource_slot: Rc<RefCell<Option<Rc<Resource>>>>,
    ) -> AgentResult<Option<Value>> {
        // Includes waiting for cleanup, runtime resolution, process admission and catalog submission.
        loop {
            let previous = self.0.resources.borrow().get(&scan.key).cloned();
            match previous {
                Some(previous) if !previous.closed.get() => previous.done.notified().await,
                _ => break,
            }
        }
        guard()?;
        let resource = Rc::new(Resource {
            key: scan.key.clone(),
            workspace_root: scan.workspace_root.clone(),
            owner_id: scan.owner_id,
            adapter: RefCell::new(None),
            cleanup: RefCell::new(None),
            closed: Cell::new(false),
            done: Notify::new(),
        });
        self.0
            .resources
            .borrow_mut()
            .insert(scan.key.clone(), resource.clone());
        *resource_slot.borrow_mut() = Some(resource.clone());
        if scan.started_revision.get().is_none() {
            scan.started_revision
                .set(Some(self.0.catalog.get_revision().await?));
        }
        guard()?;
        let selected = self
            .0
            .coordinator
            .resolve_for_operation(
                Some(&scan.runtime_id),
                &scan.workspace_root,
                "history",
                false,
            )
            .await?;
        guard()?;
        if selected.descriptor["ownership"]["session"] != "runtime" {
            return Ok(None);
        }
        let signal = controller.signal();
        self.0
            .supervisor
            .run_start(Some(&signal), || async {
                observe_history_operation(
                    async {
                        guard()?;
                        let adapter = self
                            .0
                            .registry
                            .create_adapter(&scan.runtime_id, AdapterOptions::detached(selected.readiness.clone(), &scan.workspace_root))?;
                        *resource.adapter.borrow_mut() = Some(adapter.clone());
                        let port = resolve_agent_session_history_port(adapter.as_ref())?;
                        let Some(port) = port.filter(|p| p.implements("discover")) else {
                            return Ok(None);
                        };
                        let expected_scope = scan.source_scope_id.borrow().clone();
                        if let (Some(expected), Some(actual)) = (&expected_scope, port.source_scope_id())
                            && *expected != actual
                        {
                            return Err(history_failure("History source changed. Refresh history.", Some("HISTORY_SOURCE_CHANGED"), Some(false)));
                        }
                        let result = port.discover(cursor.clone(), limit, signal.clone()).await?;
                        guard()?;
                        if result["supported"] == false {
                            return Ok(None);
                        }
                        if result["supported"] != true {
                            return Err(history_failure("Native history returned an invalid result.", None, None));
                        }
                        let locators = history_locators(result.get("sessions"), Some(limits::NATIVE_PAGE))?;
                        let next_cursor = history_cursor(result.get("nextCursor"))?;
                        if let Some(next) = &next_cursor
                            && (Some(next) == cursor.as_ref() || scan.cursors.borrow().contains(next))
                        {
                            return Err(history_failure(
                                "Native history cursor did not advance. Refresh history.",
                                Some("HISTORY_CURSOR_LOOP"),
                                Some(false),
                            ));
                        }
                        if scan.pages.get() >= self.0.max_pages
                            || scan.provider_session_ids.borrow().len() + locators.len() > self.0.max_entries
                        {
                            return Err(history_failure(
                                "History scan reached its resource limit. Refresh history.",
                                Some("HISTORY_SCAN_LIMIT"),
                                Some(false),
                            ));
                        }
                        let source_scope_id = result["sourceScopeId"]
                            .as_str()
                            .map(str::to_string)
                            .or_else(|| port.source_scope_id())
                            .unwrap_or_else(|| "default".into());
                        if !SOURCE_SCOPE.is_match(&source_scope_id) {
                            return Err(history_failure("Native history returned an invalid source identity.", None, None));
                        }
                        if expected_scope.as_ref().is_some_and(|expected| *expected != source_scope_id) {
                            return Err(history_failure("History source changed. Refresh history.", Some("HISTORY_SOURCE_CHANGED"), Some(false)));
                        }
                        let snapshot = result["coverage"]["snapshotId"].as_str().map(str::to_string);
                        let proof = result["coverage"]["scopeComplete"] == true
                            && snapshot.as_ref().is_some_and(|s| !s.is_empty() && text::len16(s) <= 1024);
                        let authoritative = scan.authoritative.get()
                            && proof
                            && scan.snapshot.borrow().as_ref().is_none_or(|previous| Some(previous) == snapshot.as_ref());
                        let mut seen = scan.provider_session_ids.borrow().clone();
                        for locator in &locators {
                            if let Some(id) = locator["providerSessionId"].as_str() {
                                seen.insert(id.to_string());
                            }
                        }
                        guard()?;
                        commit_pending.set(true);
                        let entries: Vec<Value> = locators
                            .iter()
                            .map(|locator| {
                                Obj::from(locator)
                                    .set("workspaceRoot", scan.workspace_root.as_str())
                                    .set("runtimeId", scan.runtime_id.as_str())
                                    .set("runtime", selected.descriptor.clone())
                                    .set("sourceScopeId", source_scope_id.as_str())
                                    .build()
                            })
                            .collect();
                        let scope = json!({
                            "workspaceRoot": scan.workspace_root, "runtimeId": scan.runtime_id, "sourceScopeId": source_scope_id,
                            "providerSessionIds": seen.iter().cloned().collect::<Vec<_>>(), "startedRevision": scan.started_revision.get(),
                        });
                        let committed = self
                            .0
                            .catalog
                            .apply_native_page(entries, scope, next_cursor.is_none() && authoritative, guard.clone())
                            .await;
                        commit_pending.set(false);
                        let committed = committed?;
                        indexed.set(committed["indexed"].as_i64().unwrap_or(0));
                        guard()?;
                        scan.pages.set(scan.pages.get() + 1);
                        *scan.provider_session_ids.borrow_mut() = seen;
                        *scan.source_scope_id.borrow_mut() = Some(source_scope_id.clone());
                        scan.authoritative.set(authoritative);
                        *scan.snapshot.borrow_mut() = snapshot;
                        if let Some(cursor) = &cursor {
                            scan.cursors.borrow_mut().insert(cursor.clone());
                        }
                        *scan.next_cursor.borrow_mut() = next_cursor.clone();
                        scan.expires_at.set(clock::now_ms() + SCAN_TTL_MS);
                        Ok(Some(json!({
                            "nextCursor": next_cursor, "authoritative": authoritative, "sourceScopeId": source_scope_id,
                            "sessions": committed["sessions"], "truncated": committed["truncated"],
                        })))
                    },
                    &signal,
                )
                .await
            })
            .await
    }

    fn dispose_resource(&self, resource: &Rc<Resource>) -> SharedTask<AgentResult<()>> {
        if resource.closed.get() {
            return shared(async { Ok(()) });
        }
        if let Some(cleanup) = resource.cleanup.borrow().clone() {
            return cleanup;
        }
        let state = self.0.clone();
        let target = resource.clone();
        let cleanup = shared(async move {
            let adapter = target.adapter.borrow().clone();
            let result = match adapter {
                Some(adapter) => adapter.dispose().await,
                None => Ok(()),
            };
            if result.is_ok() {
                target.closed.set(true);
                target.done.notify_waiters();
                let mut resources = state.resources.borrow_mut();
                if resources
                    .get(&target.key)
                    .is_some_and(|r| Rc::ptr_eq(r, &target))
                {
                    resources.remove(&target.key);
                }
            }
            *target.cleanup.borrow_mut() = None;
            result
        });
        *resource.cleanup.borrow_mut() = Some(cleanup.clone());
        cleanup
    }

    async fn close_matching(&self, matches: impl Fn(&str, Option<u64>) -> bool) -> AgentResult<()> {
        let scans: Vec<Rc<Scan>> = self
            .0
            .scans
            .borrow()
            .values()
            .filter(|scan| matches(&scan.workspace_root, scan.owner_id))
            .cloned()
            .collect();
        for scan in scans {
            self.expire(
                &scan,
                Some(history_failure(
                    "The project has closed.",
                    Some("PROJECT_STALE"),
                    Some(false),
                )),
            );
        }
        let resources: Vec<Rc<Resource>> = self
            .0
            .resources
            .borrow()
            .values()
            .filter(|resource| matches(&resource.workspace_root, resource.owner_id))
            .cloned()
            .collect();
        let mut failed = false;
        for resource in resources {
            failed |= self.dispose_resource(&resource).await.is_err();
        }
        if failed {
            return Err(AgentError::new(
                "History query resources could not be closed.",
            ));
        }
        Ok(())
    }

    /// `indexer.closeWorkspace(workspaceRoot)`.
    #[cfg(test)]
    pub async fn close_workspace(&self, workspace_root: &str) -> AgentResult<()> {
        let root = workspace_root.to_string();
        self.close_matching(move |resource_root, _| resource_root == root)
            .await
    }

    /// `indexer.closeOwner(ownerId)`.
    #[cfg(test)]
    pub async fn close_owner(&self, owner_id: u64) -> AgentResult<()> {
        self.close_matching(move |_, owner| owner == Some(owner_id))
            .await
    }

    /// `indexer.dispose()`.
    pub async fn dispose(&self) -> AgentResult<()> {
        self.0.disposed.set(true);
        let scans: Vec<Rc<Scan>> = self.0.scans.borrow().values().cloned().collect();
        for scan in scans {
            self.expire(
                &scan,
                Some(history_failure(
                    "History queries are closed.",
                    Some("HISTORY_CLOSED"),
                    Some(false),
                )),
            );
        }
        self.close_matching(|_, _| true).await
    }
}
