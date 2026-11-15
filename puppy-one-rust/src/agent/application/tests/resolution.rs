//! Authoritative runtime resolution through the public AgentService boundary.
use super::harness::{FakePersistence, create_sender};
use crate::agent::agent_error::AgentResult;
use crate::agent::application::agent_service::{AgentService, AgentServiceOptions};
use crate::agent::application::tests_support::run_local;
use crate::agent::connections::runtime_discovery_cache::CachedRuntimeDiscovery;
use crate::agent::runtime::agent_runtime_port::{
    AdapterFuture, AdapterOptions, AgentRuntimeAdapter,
};
use crate::agent::runtime::agent_runtime_registry::{
    AgentRuntimeRegistry, RuntimeDefinition, RuntimeDiscovery,
};
use crate::agent::runtime::agent_session_history_port::SessionHistoryPort;
use crate::agent::tasks::CancelSignal;
use core::prelude::v1::test;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::rc::Rc;

fn failure(code: &str) -> Value {
    json!({ "runtimeId": "cursor", "provider": "cursor", "status": "error", "code": code, "version": "2026.08.25", "minimumVersion": null,
        "executablePath": "/tools/cursor-agent", "argsPrefix": [], "environment": {}, "source": "user-installed", "compatibility": "acp-v1",
        "inspectionFallback": "runtime-handshake", "message": "Cursor status timed out." })
}
fn inspection() -> Value {
    json!({ "account": { "account": { "type": "cursor", "email": null, "planType": null }, "requiresOpenaiAuth": false },
        "providers": [], "models": [{ "id": "cursor/auto", "model": "cursor/auto", "displayName": "Auto", "isDefault": true }], "modes": [], "commands": [], "capabilities": { "fork": true }, "warnings": [] })
}
struct Fixed(Value);
impl RuntimeDiscovery for Fixed {
    fn discover(&self, _: bool, _: CancelSignal) -> LocalBoxFuture<'static, AgentResult<Value>> {
        let value = self.0.clone();
        Box::pin(async move { Ok(value) })
    }
}
struct Adapter {
    options: AdapterOptions,
    inspected: Cell<usize>,
    bootstraps: RefCell<Vec<Value>>,
    forks: Cell<usize>,
    discovered: Rc<Cell<usize>>,
    native_id: Rc<RefCell<String>>,
    disposed: Cell<usize>,
}
impl AgentRuntimeAdapter for Adapter {
    fn inspect(&self) -> AdapterFuture<'_, Value> {
        self.inspected.set(self.inspected.get() + 1);
        Box::pin(async { Ok(inspection()) })
    }
    fn create_session(&self, _: Value) -> AdapterFuture<'_, Value> {
        panic!("bootstrap must own inspection and creation")
    }
    fn resume_session(&self, _: Value) -> AdapterFuture<'_, Value> {
        panic!("bootstrap must own inspection and resume")
    }
    fn bootstrap_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.bootstraps.borrow_mut().push(request.clone());
        let id = if request["kind"] == "resume" {
            request["threadId"].as_str().unwrap().to_string()
        } else {
            "cursor-session".into()
        };
        *self.native_id.borrow_mut() = id.clone();
        Box::pin(async move {
            Ok(
                json!({ "inspection": inspection(), "providerSession": { "providerSessionId": id, "title": "Cursor session", "model": "cursor/auto", "createdAt": "1970-01-01T00:00:00.000Z", "updatedAt": "1970-01-01T00:00:00.000Z" } }),
            )
        })
    }
    fn start_turn(&self, _: Value) -> AdapterFuture<'_, Value> {
        Box::pin(async { Ok(json!({ "turnId": "turn-active" })) })
    }
    fn interrupt_turn(&self, _: Value) -> AdapterFuture<'_, Value> {
        Box::pin(async { Ok(Value::Null) })
    }
    fn dispose(&self) -> AdapterFuture<'_, ()> {
        self.disposed.set(self.disposed.get() + 1);
        Box::pin(async { Ok(()) })
    }
    fn implements(&self, method: &str) -> bool {
        matches!(
            method,
            "bootstrapSession" | "forkSession" | "getSessionHistoryPort"
        )
    }
    fn fork_session(&self, _: Value) -> AdapterFuture<'_, Value> {
        self.forks.set(self.forks.get() + 1);
        Box::pin(async { Ok(json!({ "providerSessionId": "cursor-fork" })) })
    }
    fn session_history_port(&self) -> Option<Rc<dyn SessionHistoryPort>> {
        Some(Rc::new(History {
            discovered: self.discovered.clone(),
            native_id: self.native_id.clone(),
        }))
    }
}
struct History {
    discovered: Rc<Cell<usize>>,
    native_id: Rc<RefCell<String>>,
}
impl SessionHistoryPort for History {
    fn source_scope_id(&self) -> Option<String> {
        Some("default".into())
    }
    fn implements(&self, method: &str) -> bool {
        matches!(method, "discover" | "hydrate")
    }
    fn discover(&self, _: Option<String>, _: usize, _: CancelSignal) -> AdapterFuture<'_, Value> {
        self.discovered.set(self.discovered.get() + 1);
        Box::pin(async {
            Ok(
                json!({ "supported": true, "sessions": [{ "providerSessionId": "cursor-history", "title": "History", "createdAt": "1970-01-01T00:00:00.000Z", "updatedAt": "1970-01-01T00:00:00.000Z" }], "nextCursor": null }),
            )
        })
    }
    fn hydrate(&self, _: CancelSignal) -> AdapterFuture<'_, Value> {
        let id = self.native_id.borrow().clone();
        Box::pin(async move {
            Ok(json!({ "events": [], "coverage": "unknown", "providerSessionId": id }))
        })
    }
}
struct Harness {
    service: AgentService,
    registry: AgentRuntimeRegistry,
    adapters: Rc<RefCell<Vec<Rc<Adapter>>>>,
    persistence: Rc<FakePersistence>,
}
impl Harness {
    fn new(discovery: Rc<dyn RuntimeDiscovery>) -> Self {
        let adapters: Rc<RefCell<Vec<Rc<Adapter>>>> = Rc::default();
        let captured = adapters.clone();
        let registry = AgentRuntimeRegistry::new(vec![RuntimeDefinition {
            manifest: json!({ "id": "cursor", "displayName": "Cursor Agent", "priority": 1,
                "execution": { "kind": "local-process", "distribution": "user-installed", "controller": "bundled-adapter" },
                "protocol": { "kind": "acp", "transport": "stdio-json-rpc" }, "integration": { "kind": "native-protocol", "adapter": "generic-acp" },
                "trust": { "level": "first-party", "publisher": "Cursor" }, "ownership": { "harness": "runtime", "credentials": ["runtime"], "models": "runtime", "billing": ["runtime"], "session": "runtime" } }),
            discovery, create_adapter: Rc::new(move |options| {
                let adapter = Rc::new(Adapter { options, inspected: Cell::new(0), bootstraps: RefCell::default(), forks: Cell::new(0), discovered: Rc::default(), native_id: Rc::new(RefCell::new("cursor-session".into())), disposed: Cell::new(0) });
                captured.borrow_mut().push(adapter.clone()); Ok(adapter as Rc<dyn AgentRuntimeAdapter>)
            }), dispose: None,
        }], None, None).unwrap();
        let persistence = Rc::new(FakePersistence::default());
        let service = AgentService::new(AgentServiceOptions {
            runtime_registry: registry.clone(),
            session_cache: Rc::new(persistence.clone()),
            conversation_catalog: Some(Rc::new(persistence.clone())),
            logger: None,
            attachment_store: None,
            process_supervisor: None,
        });
        Self {
            service,
            registry,
            adapters,
            persistence,
        }
    }
    fn fallback() -> Self {
        Self::new(Rc::new(Fixed(failure("AUTHENTICATION_PROBE_TIMED_OUT"))))
    }
    async fn close(&self) {
        self.service.close_all().await.unwrap();
        self.registry.dispose().await.unwrap();
    }
}
fn create_request() -> Value {
    json!({ "runtimeId": "cursor", "model": "cursor/auto" })
}

#[test]
fn newly_installed_cli_can_start_despite_a_cached_negative_inventory() {
    run_local(async {
        let installed = Rc::new(Cell::new(false));
        let state = installed.clone();
        let calls = Rc::new(Cell::new(0));
        let counted = calls.clone();
        let discovery = Rc::new(CachedRuntimeDiscovery::new(
            Rc::new(move |_| {
                counted.set(counted.get() + 1);
                let installed = state.get();
                Box::pin(async move {
                    let mut value = failure("READY");
                    value.as_object_mut().unwrap().remove("inspectionFallback");
                    value["status"] = json!(if installed { "ready" } else { "not-installed" });
                    if !installed {
                        value["code"] = json!("RUNTIME_NOT_INSTALLED");
                        value["executablePath"] = Value::Null;
                    }
                    Ok(value)
                })
            }),
            None,
        ));
        let harness = Harness::new(discovery.clone());
        let (owner, _) = create_sender(11);
        assert_eq!(
            harness
                .service
                .discover_providers(&json!({ "runtimeId": "cursor" }), Some("/workspace"))
                .await
                .unwrap()["readiness"]["status"],
            "not-installed"
        );
        installed.set(true);
        assert_eq!(
            discovery
                .discover(false, CancelSignal::default())
                .await
                .unwrap()["status"],
            "not-installed"
        );
        let created = harness
            .service
            .create_session(&owner, &create_request(), "/workspace")
            .await
            .unwrap();
        assert_eq!(created["session"]["providerSessionId"], "cursor-session");
        assert_eq!(calls.get(), 2);
        harness.close().await;
    });
}

#[test]
fn catalog_recovery_allows_each_transient_probe_failure_to_bootstrap_once() {
    run_local(async {
        for code in [
            "AUTHENTICATION_PROBE_FAILED",
            "AUTHENTICATION_PROBE_CRASHED",
            "AUTHENTICATION_PROBE_TIMED_OUT",
            "AUTHENTICATION_STATUS_UNKNOWN",
        ] {
            let harness = Harness::new(Rc::new(Fixed(failure(code))));
            let (owner, _) = create_sender(11);
            let catalog = harness
                .service
                .discover_providers(&json!({ "runtimeId": "cursor" }), Some("/workspace"))
                .await
                .unwrap();
            assert_eq!(catalog["readiness"]["status"], "ready");
            assert_eq!(catalog["readiness"]["code"], "READY");
            let created = harness
                .service
                .create_session(&owner, &create_request(), "/workspace")
                .await
                .unwrap();
            assert_eq!(created["session"]["runtimeId"], "cursor");
            assert_eq!(created["session"]["providerSessionId"], "cursor-session");
            {
                let adapters = harness.adapters.borrow();
                assert_eq!(adapters.len(), 2);
                assert_eq!(adapters[0].inspected.get(), 1);
                assert_eq!(adapters[1].bootstraps.borrow().len(), 1);
                assert_eq!(adapters[1].inspected.get(), 0);
            }
            harness.close().await;
        }
    });
}

#[test]
fn explicit_sign_out_blocks_creation_before_constructing_an_adapter() {
    run_local(async {
        let mut evidence = failure("AUTHENTICATION_REQUIRED");
        evidence["status"] = json!("installed-not-authenticated");
        evidence["message"] = json!("Sign in to Cursor Agent.");
        evidence
            .as_object_mut()
            .unwrap()
            .remove("inspectionFallback");
        let harness = Harness::new(Rc::new(Fixed(evidence)));
        let (owner, _) = create_sender(11);
        let error = harness
            .service
            .create_session(&owner, &create_request(), "/workspace")
            .await
            .unwrap_err();
        assert_eq!(error.name.as_deref(), Some("AgentRuntimeResolutionError"));
        assert_eq!(error.code.as_deref(), Some("AUTHENTICATION_REQUIRED"));
        assert_eq!(error.operation.as_deref(), Some("create"));
        assert_eq!(error.retryable, Some(false));
        assert!(harness.adapters.borrow().is_empty());
        harness.close().await;
    });
}

#[test]
fn separate_workspaces_bootstrap_independent_native_connections() {
    run_local(async {
        let harness = Harness::fallback();
        let (owner, _) = create_sender(11);
        let first = harness
            .service
            .create_session(&owner, &create_request(), "/workspace-a")
            .await
            .unwrap();
        let second = harness
            .service
            .create_session(&owner, &create_request(), "/workspace-b")
            .await
            .unwrap();
        assert_ne!(first["session"]["id"], second["session"]["id"]);
        {
            let adapters = harness.adapters.borrow();
            assert_eq!(adapters.len(), 2);
            assert!(adapters.iter().all(|a| a.bootstraps.borrow().len() == 1));
            assert_eq!(adapters[0].options.workspace_root, "/workspace-a");
            assert_eq!(adapters[1].options.workspace_root, "/workspace-b");
        }
        harness.close().await;
    });
}

#[test]
fn resume_and_fork_use_the_same_runtime_authority_and_native_identity() {
    run_local(async {
        for fork in [false, true] {
            let harness = Harness::fallback();
            let (owner, _) = create_sender(11);
            let created = harness
                .service
                .create_session(&owner, &create_request(), "/workspace")
                .await
                .unwrap();
            let request = json!({ "sessionId": created["session"]["id"], "runtimeId": "cursor" });
            let next = if fork {
                harness
                    .service
                    .fork_session(&owner, &request, Some("/workspace"))
                    .await
                    .unwrap()
            } else {
                harness
                    .service
                    .close_session(&owner, &request, Some("/workspace"))
                    .await
                    .unwrap();
                harness
                    .service
                    .resume_session(&owner, &request, "/workspace")
                    .await
                    .unwrap()
            };
            if fork {
                assert_ne!(next["session"]["id"], created["session"]["id"]);
            } else {
                assert_eq!(next["session"]["id"], created["session"]["id"]);
            }
            {
                let adapters = harness.adapters.borrow();
                assert_eq!(adapters.len(), 2);
                assert_eq!(adapters[0].forks.get(), usize::from(fork));
                let bootstraps = adapters[1].bootstraps.borrow();
                assert_eq!(bootstraps.len(), 1);
                assert_eq!(bootstraps[0]["kind"], "resume");
                assert_eq!(
                    bootstraps[0]["threadId"],
                    if fork {
                        "cursor-fork"
                    } else {
                        "cursor-session"
                    }
                );
            }
            harness.close().await;
        }
    });
}

#[test]
fn native_history_uses_shared_resolution_and_records_its_runtime_identity() {
    run_local(async {
        let harness = Harness::fallback();
        let (owner, _) = create_sender(11);
        let result = harness
            .service
            .list_sessions(
                &owner,
                &json!({ "runtimeId": "cursor", "discoverNative": true }),
                "/workspace",
            )
            .await
            .unwrap();
        assert_eq!(result["discovery"]["status"], "complete");
        assert_eq!(result["discovery"]["indexed"], 1);
        {
            let adapters = harness.adapters.borrow();
            assert_eq!(adapters.len(), 1);
            assert_eq!(adapters[0].discovered.get(), 1);
        }
        let rows = harness.persistence.upserts.borrow();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["runtimeId"], "cursor");
        assert_eq!(rows[0]["providerSessionId"], "cursor-history");
        drop(rows);
        harness.close().await;
    });
}

#[test]
fn unexpected_live_process_exit_invalidates_cached_protocol_readiness() {
    run_local(async {
        let harness = Harness::fallback();
        let (owner, _) = create_sender(11);
        harness
            .service
            .discover_providers(&json!({ "runtimeId": "cursor" }), Some("/workspace"))
            .await
            .unwrap();
        let created = harness
            .service
            .create_session(&owner, &create_request(), "/workspace")
            .await
            .unwrap();
        assert_eq!(harness.adapters.borrow().len(), 2);
        harness
            .service
            .start_turn(
                &owner,
                &json!({ "sessionId": created["session"]["id"], "prompt": "Keep running" }),
                Some("/workspace"),
            )
            .await
            .unwrap();
        let live = harness.adapters.borrow()[1].clone();
        (live.options.on_exit)(json!({ "expected": false, "diagnostics": "process exited" }));
        harness
            .service
            .discover_providers(&json!({ "runtimeId": "cursor" }), Some("/workspace"))
            .await
            .unwrap();
        {
            let adapters = harness.adapters.borrow();
            assert_eq!(adapters.len(), 3);
            assert_eq!(adapters[2].inspected.get(), 1);
        }
        harness.close().await;
    });
}
