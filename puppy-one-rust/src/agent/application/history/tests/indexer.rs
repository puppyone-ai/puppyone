//! Acceptance for bounded native history scans, using the real resolver and
//! process supervisor with a scripted native history port and catalog boundary.
use super::*;
use crate::agent::application::ports::Pending;
use crate::agent::application::runtime_resolution::runtime_readiness_store::RuntimeReadinessStore;
use crate::agent::application::tests::harness::{CODEX_MANIFEST, run_paused, settle};
use crate::agent::runtime::agent_runtime_port::AdapterFuture;
use crate::agent::runtime::agent_runtime_registry::{RuntimeDefinition, RuntimeDiscovery};
use crate::agent::runtime::agent_session_history_port::SessionHistoryPort;
use crate::agent::tasks::CancelSignal;
use core::prelude::v1::test;
use futures_util::future::LocalBoxFuture;
use std::collections::VecDeque;
use tokio::sync::oneshot;
use tokio::task::spawn_local;

const ROOT: &str = "/workspace/a";
fn proof() -> Value {
    json!({"scopeComplete": true, "snapshotId": "snapshot-a"})
}
fn locator(id: &str) -> Value {
    json!({"providerSessionId": id, "title": id, "createdAt": "2026-09-01T00:00:00.000Z", "updatedAt": "2026-09-01T00:00:00.000Z"})
}
fn page(id: &str, next: Option<&str>, coverage: Value) -> Value {
    json!({"supported": true, "sessions": [locator(id)], "nextCursor": next, "coverage": coverage})
}
fn ready() -> Value {
    json!({"provider": "codex", "status": "ready", "code": "READY", "selectable": true, "executablePath": "/usr/local/bin/codex", "environment": {}, "message": "ready"})
}
#[derive(Default)]
struct Script {
    pages: RefCell<VecDeque<Pending<Value>>>,
    discoveries: RefCell<Vec<(Option<String>, usize)>>,
    installations: RefCell<VecDeque<Pending<Value>>>,
    creates: Cell<usize>,
    disposals: Cell<usize>,
    disposal_failure: Cell<bool>,
}
struct Discovery(Rc<Script>);
impl RuntimeDiscovery for Discovery {
    fn discover(&self, _: bool, _: CancelSignal) -> LocalBoxFuture<'static, AgentResult<Value>> {
        self.0
            .installations
            .borrow_mut()
            .pop_front()
            .unwrap_or_else(|| Box::pin(async { Ok(ready()) }))
    }
}
struct Adapter(Rc<Script>);
impl AgentRuntimeAdapter for Adapter {
    fn inspect(&self) -> AdapterFuture<'_, Value> {
        panic!("history must not inspect a live session")
    }
    fn create_session(&self, _: Value) -> AdapterFuture<'_, Value> {
        panic!("history must not create a chat")
    }
    fn resume_session(&self, _: Value) -> AdapterFuture<'_, Value> {
        panic!("history must not resume a chat")
    }
    fn start_turn(&self, _: Value) -> AdapterFuture<'_, Value> {
        panic!("history must not run a turn")
    }
    fn interrupt_turn(&self, _: Value) -> AdapterFuture<'_, Value> {
        panic!("history must not interrupt a turn")
    }
    fn dispose(&self) -> AdapterFuture<'_, ()> {
        self.0.disposals.set(self.0.disposals.get() + 1);
        let fail = self.0.disposal_failure.get();
        Box::pin(async move {
            if fail {
                Err(AgentError::new("dispose failed"))
            } else {
                Ok(())
            }
        })
    }
    fn implements(&self, name: &str) -> bool {
        name == "getSessionHistoryPort"
    }
    fn session_history_port(&self) -> Option<Rc<dyn SessionHistoryPort>> {
        Some(Rc::new(History(self.0.clone())))
    }
}
struct History(Rc<Script>);
impl SessionHistoryPort for History {
    fn source_scope_id(&self) -> Option<String> {
        Some("default".into())
    }
    fn implements(&self, name: &str) -> bool {
        name == "discover"
    }
    fn discover(
        &self,
        cursor: Option<String>,
        limit: usize,
        _: CancelSignal,
    ) -> AdapterFuture<'_, Value> {
        self.0.discoveries.borrow_mut().push((cursor, limit));
        self.0
            .pages
            .borrow_mut()
            .pop_front()
            .unwrap_or_else(|| Box::pin(async { Ok(page("a", None, Value::Null)) }))
    }
}
#[derive(Default)]
struct Catalog {
    calls: RefCell<Vec<Value>>,
    pending: RefCell<Option<Pending<Value>>>,
    truncated: Cell<bool>,
}
impl HistoryCatalog for Catalog {
    fn list(&self, _: String, _: Value) -> Pending<Vec<Value>> {
        panic!("indexing does not query a renderer list")
    }
    fn get_revision(&self) -> Pending<i64> {
        Box::pin(async { Ok(3) })
    }
    fn get_coverage(&self) -> Pending<Value> {
        panic!("indexing does not query renderer coverage")
    }
    fn apply_native_page(
        &self,
        entries: Vec<Value>,
        scope: Value,
        reconcile: bool,
        guard: Guard,
    ) -> Pending<Value> {
        self.calls
            .borrow_mut()
            .push(json!({"entries": entries, "scope": scope, "reconcileMissing": reconcile}));
        let pending = self.pending.borrow_mut().take();
        let truncated = self.truncated.get();
        Box::pin(async move {
            guard()?;
            if let Some(pending) = pending {
                pending.await
            } else {
                Ok(json!({"indexed": entries.len(),"sessions": entries,"truncated":truncated}))
            }
        })
    }
}
struct Harness {
    indexer: NativeConversationIndexer,
    script: Rc<Script>,
    catalog: Rc<Catalog>,
    readiness: RuntimeReadinessStore,
    supervisor: AgentProcessSupervisor,
}
fn harness() -> Harness {
    let script = Rc::new(Script::default());
    let factory = script.clone();
    let registry = AgentRuntimeRegistry::new(
        vec![RuntimeDefinition {
            manifest: serde_json::from_str(CODEX_MANIFEST).unwrap(),
            discovery: Rc::new(Discovery(script.clone())),
            create_adapter: Rc::new(move |_| {
                factory.creates.set(factory.creates.get() + 1);
                Ok(Rc::new(Adapter(factory.clone())))
            }),
            dispose: None,
        }],
        None,
        Some(10_000),
    )
    .unwrap();
    let catalog = Rc::new(Catalog::default());
    let supervisor = AgentProcessSupervisor::new(Some(1));
    let readiness = RuntimeReadinessStore::new(None, None);
    readiness.set("codex", ROOT, ready(), json!({"live": "unchanged"}));
    let coordinator = RuntimeResolutionCoordinator::new(
        registry.clone(),
        supervisor.clone(),
        Some(readiness.clone()),
    );
    let mut indexer =
        NativeConversationIndexer::new(registry, coordinator, catalog.clone(), supervisor.clone());
    Rc::get_mut(&mut indexer.0).unwrap().discovery_timeout_ms = 10;
    Harness {
        indexer,
        script,
        catalog,
        readiness,
        supervisor,
    }
}
impl Harness {
    fn page(&self, value: Value) {
        self.script
            .pages
            .borrow_mut()
            .push_back(Box::pin(async move { Ok(value) }));
    }
    async fn start(&self) -> Value {
        self.indexer
            .refresh(ROOT, "codex", Value::Null, None, Some(json!(1)), Some(7))
            .await
    }
    async fn next(&self, first: &Value) -> Value {
        self.indexer
            .refresh(
                ROOT,
                "codex",
                first["nextCursor"].clone(),
                first["scanId"].as_str().map(str::to_string),
                Some(json!(1)),
                Some(7),
            )
            .await
    }
}
fn deferred() -> (oneshot::Sender<AgentResult<Value>>, Pending<Value>) {
    let (reply, wait) = oneshot::channel();
    (reply, Box::pin(async move { wait.await.unwrap() }))
}
fn spawn_start(h: &Harness) -> tokio::task::JoinHandle<Value> {
    let indexer = h.indexer.clone();
    spawn_local(async move {
        indexer
            .refresh(ROOT, "codex", Value::Null, None, Some(json!(1)), Some(7))
            .await
    })
}

#[test]
fn timed_out_discovery_releases_admission_without_invalidating_live_readiness() {
    run_paused(async {
        let h = harness();
        h.script
            .pages
            .borrow_mut()
            .push_back(Box::pin(futures_util::future::pending()));
        let result = h.start().await;
        assert_eq!(result["status"], "failed");
        assert_eq!(result["indexed"], 0);
        assert!(
            result["warnings"][0]
                .as_str()
                .unwrap()
                .contains("timed out")
        );
        assert_eq!(h.script.disposals.get(), 1);
        // An actual subsequent start must acquire the sole permit promptly.
        tokio::time::timeout(
            Duration::from_millis(1),
            h.supervisor.run_start(None, || async { Ok(()) }),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(
            h.readiness.get("codex", ROOT).unwrap().inspection,
            json!({"live":"unchanged"})
        );
    });
}
#[test]
fn resolution_deadline_prevents_late_adapter_creation_and_catalog_writes() {
    run_paused(async {
        let h = harness();
        let (reply, pending) = deferred();
        h.script.installations.borrow_mut().push_back(pending);
        assert_eq!(h.start().await["status"], "failed");
        let _ = reply.send(Ok(ready()));
        settle().await;
        assert_eq!(h.script.creates.get(), 0);
        assert!(h.catalog.calls.borrow().is_empty());
    });
}
#[test]
fn reconciles_only_when_every_page_proves_one_complete_source_snapshot() {
    run_paused(async {
        let h = harness();
        h.page(page("a", Some("page-2"), proof()));
        h.page(page("b", None, proof()));
        let first = h.start().await;
        assert_eq!(first["status"], "partial");
        assert_eq!(first["coverage"], "unknown");
        assert_eq!(h.catalog.calls.borrow()[0]["reconcileMissing"], false);
        let second = h.next(&first).await;
        assert_eq!(second["status"], "complete");
        assert_eq!(second["coverage"], "complete");
        assert!(second["scanId"].is_null());
        let calls = h.catalog.calls.borrow();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1]["reconcileMissing"], true);
        let scope = &calls[1]["scope"];
        assert_eq!(scope["startedRevision"], 3);
        assert_eq!(scope["sourceScopeId"], "default");
        let mut ids: Vec<_> = scope["providerSessionIds"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        ids.sort();
        assert_eq!(ids, ["a", "b"]);
    });
}
#[test]
fn absent_incomplete_or_changed_coverage_never_tombstones_unseen_history() {
    for coverage in [
        Value::Null,
        json!({"scopeComplete":false,"snapshotId":null}),
        json!({"scopeComplete":true,"snapshotId":"changed"}),
    ] {
        run_paused(async {
            let h = harness();
            h.page(page("a", Some("page-2"), proof()));
            h.page(page("b", None, coverage));
            let first = h.start().await;
            let second = h.next(&first).await;
            assert_eq!(second["status"], "complete");
            assert_eq!(second["coverage"], "unknown");
            let calls = h.catalog.calls.borrow();
            assert_eq!(calls.len(), 2);
            assert!(calls.iter().all(|c| c["reconcileMissing"] == false));
        });
    }
}
#[test]
fn failed_page_keeps_its_exact_continuation_for_retry_without_committing() {
    run_paused(async {
        let h = harness();
        h.page(page("a", Some("page-2"), Value::Null));
        h.script
            .pages
            .borrow_mut()
            .push_back(Box::pin(async { Err(AgentError::new("page failed")) }));
        h.page(page("b", None, Value::Null));
        let first = h.start().await;
        let failed = h.next(&first).await;
        assert_eq!(failed["status"], "failed");
        assert_eq!(failed["retryable"], true);
        assert_eq!(failed["nextCursor"], "page-2");
        assert_eq!(failed["scanId"], first["scanId"]);
        assert_eq!(h.catalog.calls.borrow().len(), 1);
        let retried = h.next(&first).await;
        assert_eq!(retried["status"], "complete");
        assert_eq!(retried["indexed"], 1);
        assert_eq!(
            *h.script.discoveries.borrow(),
            [
                (None, 1),
                (Some("page-2".into()), 1),
                (Some("page-2".into()), 1)
            ]
        );
    });
}
#[test]
fn rejects_scope_page_size_and_cursor_mismatches_before_native_work() {
    run_paused(async {
        let h = harness();
        h.page(page("a", Some("page-2"), Value::Null));
        let first = h.start().await;
        for (root, runtime, limit, cursor) in [
            ("/workspace/b", "codex", 1, "page-2"),
            (ROOT, "cursor", 1, "page-2"),
            (ROOT, "codex", 2, "page-2"),
            (ROOT, "codex", 1, "page-3"),
        ] {
            let result = h
                .indexer
                .refresh(
                    root,
                    runtime,
                    json!(cursor),
                    first["scanId"].as_str().map(str::to_string),
                    Some(json!(limit)),
                    Some(7),
                )
                .await;
            assert_eq!(result["status"], "failed");
            assert_eq!(result["retryable"], false);
        }
        assert_eq!(h.script.discoveries.borrow().len(), 1);
        assert_eq!(h.catalog.calls.borrow().len(), 1);
    });
}
#[test]
fn malformed_page_is_rejected_whole_before_any_catalog_write() {
    for result in [
        json!({"supported":true,"sessions":[locator("valid"),{"title":"no id"}],"nextCursor":null}),
        json!({"supported":true,"sessions":null,"nextCursor":null}),
        json!({"supported":true,"sessions":[locator("a")],"nextCursor":{}}),
        json!({"supported":true,"sessions":[locator("a")],"nextCursor":"x".repeat(1025)}),
    ] {
        run_paused(async {
            let h = harness();
            h.page(result);
            let result = h
                .indexer
                .refresh(ROOT, "codex", Value::Null, None, Some(json!(2)), Some(7))
                .await;
            assert_eq!(result["status"], "failed");
            assert_eq!(result["indexed"], 0);
            assert!(h.catalog.calls.borrow().is_empty());
            assert_eq!(h.script.disposals.get(), 1);
        });
    }
}
#[test]
fn repeated_cursor_ends_the_scan_without_committing_a_duplicate_page() {
    run_paused(async {
        let h = harness();
        h.page(page("a", Some("page-2"), Value::Null));
        h.page(page("b", Some("page-2"), Value::Null));
        let first = h.start().await;
        let result = h.next(&first).await;
        assert_eq!(result["status"], "failed");
        assert_eq!(result["retryable"], false);
        assert_eq!(h.catalog.calls.borrow().len(), 1);
    });
}
#[test]
fn superseded_scan_cannot_commit_a_late_native_response() {
    run_paused(async {
        let h = harness();
        let (reply, pending) = deferred();
        h.script.pages.borrow_mut().push_back(pending);
        h.page(page("new", None, proof()));
        let old = spawn_start(&h);
        settle().await;
        assert_eq!(h.script.discoveries.borrow().len(), 1);
        let new = spawn_start(&h);
        settle().await;
        let _ = reply.send(Ok(page("old", None, proof())));
        assert_eq!(new.await.unwrap()["status"], "complete");
        let old = old.await.unwrap();
        assert_eq!(old["status"], "failed");
        assert_eq!(old["retryable"], false);
        let calls = h.catalog.calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["entries"][0]["providerSessionId"], "new");
    });
}
#[test]
fn duplicate_continuations_share_one_native_call_and_one_catalog_transaction() {
    run_paused(async {
        let h = harness();
        h.page(page("a", Some("page-2"), Value::Null));
        let (reply, pending) = deferred();
        h.script.pages.borrow_mut().push_back(pending);
        let first = h.start().await;
        let launch = || {
            let indexer = h.indexer.clone();
            let first = first.clone();
            spawn_local(async move {
                indexer
                    .refresh(
                        ROOT,
                        "codex",
                        first["nextCursor"].clone(),
                        first["scanId"].as_str().map(str::to_string),
                        Some(json!(1)),
                        Some(7),
                    )
                    .await
            })
        };
        let one = launch();
        let two = launch();
        settle().await;
        assert_eq!(h.script.discoveries.borrow().len(), 2);
        reply.send(Ok(page("b", None, Value::Null))).unwrap();
        let one = one.await.unwrap();
        let two = two.await.unwrap();
        assert_eq!(one, two);
        assert_eq!(one["status"], "complete");
        assert_eq!(h.catalog.calls.borrow().len(), 2);
    });
}
#[test]
fn failed_disposal_quarantines_the_source_instead_of_spawning_another_adapter() {
    run_paused(async {
        let h = harness();
        h.script.disposal_failure.set(true);
        h.start().await;
        assert_eq!(h.start().await["status"], "failed");
        assert_eq!(h.script.creates.get(), 1);
    });
}
#[test]
fn pending_catalog_commit_is_reported_as_unknown_and_requires_a_new_scan() {
    run_paused(async {
        let h = harness();
        let (reply, pending) = deferred();
        *h.catalog.pending.borrow_mut() = Some(pending);
        let result = h.start().await;
        assert_eq!(result["status"], "failed");
        assert_eq!(result["retryable"], false);
        assert_eq!(result["catalogCommit"], "pending");
        assert_eq!(result["indexed"], 0);
        let _ = reply.send(Ok(json!({"indexed":1})));
        settle().await;
        assert!(h.indexer.0.scans.borrow().is_empty());
    });
}
#[test]
fn page_budget_stops_unbounded_scans_and_reports_catalog_capacity() {
    run_paused(async {
        let mut h = harness();
        Rc::get_mut(&mut h.indexer.0).unwrap().max_pages = 1;
        h.catalog.truncated.set(true);
        h.page(page("a", Some("page-2"), Value::Null));
        h.page(page("b", None, Value::Null));
        let first = h.start().await;
        assert_eq!(first["warnings"].as_array().unwrap().len(), 1);
        assert!(first["warnings"][0].as_str().unwrap().contains("capacity"));
        let second = h.next(&first).await;
        assert_eq!(second["status"], "failed");
        assert_eq!(second["retryable"], false);
        assert_eq!(h.catalog.calls.borrow().len(), 1);
    });
}
