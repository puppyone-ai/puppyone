//! Runtime registry acceptance from the pinned TypeScript discovery suites.
use super::agent_runtime_manifest::{
    define_agent_runtime_manifest, runtime_descriptor_from_manifest,
};
use super::agent_runtime_port::{AdapterFuture, AdapterOptions, AgentRuntimeAdapter};
use super::agent_runtime_registry::{AgentRuntimeRegistry, RuntimeDefinition, RuntimeDiscovery};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::application::processes::agent_process_supervisor::AgentProcessSupervisor;
use crate::agent::application::runtime_resolution::runtime_resolution_coordinator::RuntimeResolutionCoordinator;
use crate::agent::application::tests_support::{run_local, run_paused_local};
use crate::agent::connections::runtime_discovery_cache::CachedRuntimeDiscovery;
use crate::agent::tasks::CancelSignal;
use core::prelude::v1::test;
use futures_util::future::{LocalBoxFuture, join_all};
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::{Duration, Instant};
use tokio::sync::oneshot;

type DiscoveryBehavior = dyn Fn(usize, CancelSignal) -> LocalBoxFuture<'static, AgentResult<Value>>;
struct Probe {
    calls: RefCell<Vec<(bool, CancelSignal)>>,
    behavior: Rc<DiscoveryBehavior>,
}
impl Probe {
    fn new(
        behavior: impl Fn(usize, CancelSignal) -> LocalBoxFuture<'static, AgentResult<Value>> + 'static,
    ) -> Rc<Self> {
        Rc::new(Self {
            calls: RefCell::default(),
            behavior: Rc::new(behavior),
        })
    }
    fn ready(id: &'static str) -> Rc<Self> {
        Self::new(move |_, _| Box::pin(async move { Ok(ready(id)) }))
    }
    fn count(&self) -> usize {
        self.calls.borrow().len()
    }
}
impl RuntimeDiscovery for Probe {
    fn discover(
        &self,
        refresh: bool,
        signal: CancelSignal,
    ) -> LocalBoxFuture<'static, AgentResult<Value>> {
        self.calls.borrow_mut().push((refresh, signal.clone()));
        (self.behavior)(self.count(), signal)
    }
}
type InspectBehavior = dyn Fn() -> LocalBoxFuture<'static, AgentResult<Value>>;
#[derive(Default)]
struct Adapter {
    inspections: Cell<usize>,
    disposals: Cell<usize>,
    dispose_failures: Cell<usize>,
    inspection: RefCell<Option<Rc<InspectBehavior>>>,
}
impl AgentRuntimeAdapter for Adapter {
    fn inspect(&self) -> AdapterFuture<'_, Value> {
        self.inspections.set(self.inspections.get() + 1);
        if let Some(inspection) = self.inspection.borrow().as_ref() {
            return inspection();
        }
        Box::pin(async {
            Ok(
                json!({ "account": { "account": null, "requiresOpenaiAuth": false }, "providers": [], "models": [], "modes": [], "commands": [], "capabilities": {}, "warnings": [] }),
            )
        })
    }
    fn create_session(&self, selection: Value) -> AdapterFuture<'_, Value> {
        Box::pin(async move { Ok(selection) })
    }
    fn resume_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(async move { Ok(request) })
    }
    fn start_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(async move { Ok(request) })
    }
    fn interrupt_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(async move { Ok(request) })
    }
    fn dispose(&self) -> AdapterFuture<'_, ()> {
        self.disposals.set(self.disposals.get() + 1);
        if self.dispose_failures.get() > 0 {
            self.dispose_failures.set(self.dispose_failures.get() - 1);
            return Box::pin(async { Err(AgentError::new("cleanup failed")) });
        }
        Box::pin(async { Ok(()) })
    }
}
fn manifest(id: &str, priority: u32) -> Value {
    json!({ "id": id, "priority": priority, "displayName": id,
        "execution": { "kind": "local-process", "distribution": "user-installed", "controller": "bundled-adapter" },
        "protocol": { "kind": "rpc", "transport": "stdio-json-rpc" },
        "integration": { "kind": "specialized-native", "adapter": "specialized" },
        "trust": { "level": "first-party", "publisher": "Fixture" },
        "ownership": { "harness": "runtime", "credentials": ["runtime"], "models": "runtime", "billing": ["runtime"], "session": "runtime" }
    })
}
fn ready(id: &str) -> Value {
    json!({ "runtimeId": id, "status": "ready", "code": "READY", "executablePath": format!("/{id}") })
}
fn definition(
    id: &str,
    priority: u32,
    discovery: Rc<dyn RuntimeDiscovery>,
    adapter: Rc<Adapter>,
) -> RuntimeDefinition {
    RuntimeDefinition {
        manifest: manifest(id, priority),
        discovery,
        create_adapter: Rc::new(move |_| Ok(adapter.clone() as Rc<dyn AgentRuntimeAdapter>)),
        dispose: None,
    }
}
fn resolver(registry: &AgentRuntimeRegistry) -> RuntimeResolutionCoordinator {
    RuntimeResolutionCoordinator::new(registry.clone(), AgentProcessSupervisor::new(None), None)
}
async fn wait_until(ready: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !ready() {
        assert!(Instant::now() < deadline, "native probe did not settle");
        tokio::task::yield_now().await;
    }
}

#[test]
fn selected_catalog_and_operation_never_probe_an_unrelated_stuck_runtime() {
    run_local(async {
        for refresh in [false, true] {
            let healthy = Probe::ready("healthy");
            let stuck = Probe::new(|_, _| Box::pin(std::future::pending()));
            let adapter = Rc::new(Adapter::default());
            let registry = AgentRuntimeRegistry::new(
                vec![
                    definition("healthy", 2, healthy.clone(), adapter.clone()),
                    definition("stuck", 1, stuck.clone(), Rc::default()),
                ],
                None,
                None,
            )
            .unwrap();
            let resolver = resolver(&registry);
            let catalog = resolver
                .query_catalog(
                    &json!({ "runtimeId": "healthy", "refresh": refresh }),
                    Some("/workspace"),
                )
                .await
                .unwrap();
            assert_eq!(catalog["selectedRuntimeId"], "healthy");
            assert_eq!(catalog["readiness"]["status"], "ready");
            assert_eq!(catalog["runtimes"].as_array().unwrap().len(), 1);
            assert_eq!(catalog["runtimes"][0]["descriptor"]["id"], "healthy");
            assert_eq!(adapter.inspections.get(), 1);
            assert_eq!(stuck.count(), 0);
            assert_eq!(
                resolver
                    .resolve_for_operation(Some("healthy"), "/workspace", "create", false)
                    .await
                    .unwrap()
                    .descriptor["id"],
                "healthy"
            );
            assert_eq!(stuck.count(), 0);
            registry.dispose().await.unwrap();
        }
    });
}

#[test]
fn unbound_catalog_discovers_every_runtime_without_creating_an_adapter() {
    run_local(async {
        let first = Probe::ready("first");
        let second = Probe::new(|_, _| {
            Box::pin(async {
                Ok(
                    json!({ "runtimeId": "second", "status": "not-installed", "code": "RUNTIME_NOT_INSTALLED" }),
                )
            })
        });
        let adapter = Rc::new(Adapter::default());
        let mut definitions = vec![
            definition("first", 2, first.clone(), adapter.clone()),
            definition("second", 1, second.clone(), adapter.clone()),
        ];
        for definition in &mut definitions {
            definition.create_adapter =
                Rc::new(|_| panic!("unbound inventory must not construct an adapter"));
        }
        let registry = AgentRuntimeRegistry::new(definitions, None, None).unwrap();
        let catalog = resolver(&registry)
            .query_catalog(&json!({}), None)
            .await
            .unwrap();
        let ids: Vec<_> = catalog["runtimes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["descriptor"]["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["first", "second"]);
        assert_eq!(
            (first.count(), second.count(), adapter.inspections.get()),
            (1, 1, 0)
        );
        registry.dispose().await.unwrap();
    });
}

#[test]
fn clearing_inspection_reuses_fresh_executable_evidence() {
    run_local(async {
        let probe = Probe::ready("healthy");
        let loader = probe.clone();
        let cache = Rc::new(CachedRuntimeDiscovery::new(
            Rc::new(move |signal| loader.discover(false, signal)),
            None,
        ));
        let adapter = Rc::new(Adapter::default());
        let registry = AgentRuntimeRegistry::new(
            vec![definition("healthy", 1, cache, adapter.clone())],
            None,
            None,
        )
        .unwrap();
        let resolver = resolver(&registry);
        for _ in 0..2 {
            resolver
                .query_catalog(&json!({ "runtimeId": "healthy" }), Some("/workspace"))
                .await
                .unwrap();
        }
        assert_eq!(adapter.inspections.get(), 1);
        resolver.clear();
        resolver
            .query_catalog(&json!({ "runtimeId": "healthy" }), Some("/workspace"))
            .await
            .unwrap();
        assert_eq!(
            (
                adapter.inspections.get(),
                probe.count(),
                adapter.disposals.get()
            ),
            (2, 1, 2)
        );
        registry.dispose().await.unwrap();
    });
}

#[test]
fn discovery_deadline_quarantines_one_noncooperative_probe_across_refresh_storms() {
    run_paused_local(async {
        let (reply, pending) = oneshot::channel();
        let pending = RefCell::new(Some(pending));
        let settled = Rc::new(Cell::new(false));
        let done = settled.clone();
        let stuck = Probe::new(move |_, _| {
            let pending = pending.borrow_mut().take();
            let done = done.clone();
            Box::pin(async move {
                if let Some(pending) = pending {
                    let value = pending.await.unwrap();
                    done.set(true);
                    Ok(value)
                } else {
                    Ok(ready("stuck"))
                }
            })
        });
        let registry = AgentRuntimeRegistry::new(
            vec![
                definition("healthy", 2, Probe::ready("healthy"), Rc::default()),
                definition("stuck", 1, stuck.clone(), Rc::default()),
            ],
            None,
            Some(100),
        )
        .unwrap();
        let first = {
            let registry = registry.clone();
            tokio::task::spawn_local(async move { registry.discover(false, None).await })
        };
        let concurrent = {
            let registry = registry.clone();
            tokio::task::spawn_local(async move { registry.discover(true, None).await })
        };
        wait_until(|| stuck.count() == 1).await;
        tokio::time::advance(Duration::from_millis(100)).await;
        let rows = first.await.unwrap();
        let joined = concurrent.await.unwrap();
        assert_eq!(rows[0].readiness["status"], "ready");
        assert_eq!(rows[1].readiness["status"], "error");
        assert_eq!(rows[1].readiness["code"], "RUNTIME_DISCOVERY_FAILED");
        assert!(
            rows[1].readiness["message"]
                .as_str()
                .unwrap()
                .contains("timed out")
        );
        assert_eq!(rows[1].readiness, joined[1].readiness);
        assert!(stuck.calls.borrow()[0].1.is_cancelled());
        let storm = join_all((0..20).map(|_| registry.discover(true, Some("stuck")))).await;
        assert!(
            storm
                .iter()
                .all(|result| result[0].readiness["status"] == "error")
        );
        assert_eq!(stuck.count(), 1);
        reply.send(ready("stuck")).unwrap();
        wait_until(|| settled.get()).await;
        tokio::task::yield_now().await;
        assert_eq!(rows[1].readiness["status"], "error");
        assert_eq!(
            registry.discover(true, Some("stuck")).await[0].readiness["status"],
            "ready"
        );
        assert_eq!(stuck.count(), 2);
        registry.dispose().await.unwrap();
    });
}

#[test]
fn cooperative_deadline_aborts_the_probe_and_allows_a_fresh_attempt() {
    run_paused_local(async {
        let settled = Rc::new(Cell::new(false));
        let done = settled.clone();
        let probe = Probe::new(move |count, signal| {
            let done = done.clone();
            Box::pin(async move {
                if count == 1 {
                    let reason = signal.cancelled().await;
                    done.set(true);
                    Err(reason)
                } else {
                    Ok(ready("backend"))
                }
            })
        });
        let registry = AgentRuntimeRegistry::new(
            vec![definition("backend", 1, probe.clone(), Rc::default())],
            None,
            Some(100),
        )
        .unwrap();
        let attempt = {
            let registry = registry.clone();
            tokio::task::spawn_local(async move { registry.discover(false, None).await })
        };
        wait_until(|| probe.count() == 1).await;
        tokio::time::advance(Duration::from_millis(100)).await;
        assert_eq!(attempt.await.unwrap()[0].readiness["status"], "error");
        wait_until(|| settled.get()).await;
        tokio::task::yield_now().await;
        assert!(probe.calls.borrow()[0].1.is_cancelled());
        assert_eq!(
            registry.discover(true, None).await[0].readiness["status"],
            "ready"
        );
        assert_eq!(probe.count(), 2);
        registry.dispose().await.unwrap();
    });
}

#[test]
fn late_discovery_cannot_seed_the_cache_after_its_host_deadline() {
    run_paused_local(async {
        let (reply, pending) = oneshot::channel();
        let pending = RefCell::new(Some(pending));
        let settled = Rc::new(Cell::new(false));
        let done = settled.clone();
        let probe = Probe::new(move |_, _| {
            let pending = pending.borrow_mut().take();
            let done = done.clone();
            Box::pin(async move {
                if let Some(pending) = pending {
                    let value = pending.await.unwrap();
                    done.set(true);
                    Ok(value)
                } else {
                    let mut value = ready("backend");
                    value["message"] = json!("fresh evidence");
                    Ok(value)
                }
            })
        });
        let loader = probe.clone();
        let cache = Rc::new(CachedRuntimeDiscovery::new(
            Rc::new(move |signal| loader.discover(false, signal)),
            None,
        ));
        let registry = AgentRuntimeRegistry::new(
            vec![definition("backend", 1, cache, Rc::default())],
            None,
            Some(100),
        )
        .unwrap();
        let attempt = {
            let registry = registry.clone();
            tokio::task::spawn_local(async move { registry.discover(false, None).await })
        };
        wait_until(|| probe.count() == 1).await;
        tokio::time::advance(Duration::from_millis(100)).await;
        assert_eq!(attempt.await.unwrap()[0].readiness["status"], "error");
        let mut expired = ready("backend");
        expired["message"] = json!("expired evidence");
        reply.send(expired).unwrap();
        wait_until(|| settled.get()).await;
        tokio::task::yield_now().await;
        assert_eq!(
            registry.discover(false, None).await[0].readiness["message"],
            "fresh evidence"
        );
        assert_eq!(probe.count(), 2);
        registry.dispose().await.unwrap();
    });
}

#[test]
fn shutdown_settles_observers_and_never_restarts_a_late_failed_probe() {
    run_local(async {
        let (reply, pending) = oneshot::channel::<AgentResult<Value>>();
        let pending = RefCell::new(Some(pending));
        let settled = Rc::new(Cell::new(false));
        let done = settled.clone();
        let probe = Probe::new(move |_, _| {
            let pending = pending.borrow_mut().take().unwrap();
            let done = done.clone();
            Box::pin(async move {
                let result = pending.await.unwrap();
                done.set(true);
                result
            })
        });
        let registry = AgentRuntimeRegistry::new(
            vec![definition("backend", 1, probe.clone(), Rc::default())],
            None,
            None,
        )
        .unwrap();
        let attempt = {
            let registry = registry.clone();
            tokio::task::spawn_local(async move { registry.discover(false, None).await })
        };
        wait_until(|| probe.count() == 1).await;
        registry.dispose().await.unwrap();
        let rows = attempt.await.unwrap();
        assert_eq!(rows[0].readiness["status"], "error");
        assert!(
            rows[0].readiness["message"]
                .as_str()
                .unwrap()
                .contains("closed")
        );
        assert!(probe.calls.borrow()[0].1.is_cancelled());
        reply
            .send(Err(AgentError::new("late native failure")))
            .unwrap();
        wait_until(|| settled.get()).await;
        assert_eq!(
            registry.discover(false, None).await[0].readiness["status"],
            "error"
        );
        assert_eq!(probe.count(), 1);
    });
}

#[test]
fn discovery_identity_and_status_pairs_fail_closed_but_legacy_provider_identity_works() {
    run_local(async {
        for (evidence, expected, message) in [
            (ready("other"), "error", "identity"),
            (
                json!({ "provider": "backend", "status": "ready", "code": "READY" }),
                "ready",
                "",
            ),
            (
                json!({ "runtimeId": "backend", "status": "installed-not-authenticated", "code": "AUTHENTICATION_PROBE_FAILED" }),
                "error",
                "incompatible with status",
            ),
        ] {
            let probe = Probe::new(move |_, _| {
                let evidence = evidence.clone();
                Box::pin(async move { Ok(evidence) })
            });
            let registry = AgentRuntimeRegistry::new(
                vec![definition("backend", 1, probe, Rc::default())],
                None,
                None,
            )
            .unwrap();
            let rows = registry.discover(false, None).await;
            assert_eq!(rows[0].readiness["status"], expected);
            if expected == "error" {
                assert_eq!(rows[0].readiness["code"], "RUNTIME_DISCOVERY_FAILED");
                assert!(
                    rows[0].readiness["message"]
                        .as_str()
                        .unwrap()
                        .contains(message)
                );
            }
            registry.dispose().await.unwrap();
        }
    });
}

#[test]
fn manifest_is_the_only_descriptor_source_and_its_owned_projection_cannot_mutate_it() {
    let mut source = manifest("grok-build", 1);
    source["protocol"] = json!({ "kind": "acp", "transport": "stdio-json-rpc" });
    source["integration"] = json!({ "kind": "native-protocol", "adapter": "generic-acp" });
    source["trust"] = json!({ "level": "first-party", "publisher": "xAI" });
    let native = define_agent_runtime_manifest(&source).unwrap();
    let mut descriptor = runtime_descriptor_from_manifest(&native).unwrap();
    assert_eq!(descriptor["id"], "grok-build");
    assert_eq!(descriptor["kind"], "native-protocol");
    assert_eq!(descriptor["distribution"], "user-installed");
    for key in ["protocol", "integration", "trust"] {
        assert_eq!(descriptor[key], source[key]);
    }
    assert!(descriptor.get("launch").is_none());
    descriptor["ownership"]["credentials"][0] = json!("user-provider");
    assert_eq!(native["ownership"]["credentials"], json!(["runtime"]));
    let mut pi = manifest("pi", 1);
    pi["protocol"]["transport"] = json!("stdio-jsonl");
    pi["ownership"]["credentials"] = json!(["user-provider"]);
    pi["ownership"]["billing"] = json!(["user-provider"]);
    let descriptor =
        runtime_descriptor_from_manifest(&define_agent_runtime_manifest(&pi).unwrap()).unwrap();
    for key in ["protocol", "integration", "ownership"] {
        assert_eq!(descriptor[key], pi[key]);
    }
    for (field, value, reason) in [
        (
            "protocol",
            json!({ "kind": "rpc", "transport": "stdio-json-rpc" }),
            "generic-acp requires protocol.kind acp",
        ),
        (
            "integration",
            json!({ "kind": "compatibility-bridge", "adapter": "generic-acp" }),
            "compatibility-bridge requires reviewed-bridge trust",
        ),
        (
            "launch",
            json!({ "command": "agent" }),
            "unsupported field launch",
        ),
    ] {
        let mut invalid = source.clone();
        invalid[field] = value;
        assert!(
            define_agent_runtime_manifest(&invalid)
                .unwrap_err()
                .message
                .contains(reason)
        );
    }
    let mut invalid = definition("backend", 1, Probe::ready("backend"), Rc::default());
    invalid.manifest = Value::Null;
    assert!(AgentRuntimeRegistry::new(vec![invalid], None, None).is_err());
}

#[test]
fn registry_cleanup_attempts_every_backend_and_disposes_tracked_adapters_once() {
    run_local(async {
        let calls = Rc::new(RefCell::new(Vec::new()));
        let adapter = Rc::new(Adapter::default());
        let mut definitions = Vec::new();
        for (id, priority, fail) in [("first", 2, true), ("second", 1, false)] {
            let mut definition = definition(id, priority, Probe::ready(id), adapter.clone());
            let calls = calls.clone();
            definition.dispose = Some(Rc::new(move || {
                calls.borrow_mut().push(id);
                Box::pin(async move {
                    if fail {
                        Err(AgentError::new("first failed"))
                    } else {
                        Ok(())
                    }
                })
            }));
            definitions.push(definition);
        }
        let registry = AgentRuntimeRegistry::new(definitions, None, None).unwrap();
        let tracked = registry
            .create_adapter(
                "first",
                AdapterOptions::detached(ready("first"), "/workspace"),
            )
            .unwrap();
        let payload = json!({ "marker": "provider-neutral" });
        assert_eq!(
            tracked.create_session(payload.clone()).await.unwrap(),
            payload
        );
        tracked.dispose().await.unwrap();
        assert!(
            registry
                .dispose()
                .await
                .unwrap_err()
                .message
                .contains("failed to dispose cleanly")
        );
        assert_eq!(*calls.borrow(), ["first", "second"]);
        assert_eq!(adapter.disposals.get(), 1);
        assert!(
            registry
                .create_adapter(
                    "first",
                    AdapterOptions::detached(ready("first"), "/workspace")
                )
                .is_err()
        );
    });
}

fn failed_cursor_probe() -> Value {
    json!({ "runtimeId": "cursor", "provider": "cursor", "status": "error", "code": "AUTHENTICATION_PROBE_FAILED", "version": "2026.08.1", "minimumVersion": null,
        "executablePath": "/tools/cursor-agent", "environment": {}, "inspectionFallback": "runtime-handshake",
        "message": "Cursor status failed.", "diagnostic": "Cursor status probe ended with exit code 139." })
}
fn cursor_inspection() -> Value {
    json!({ "account": { "account": { "type": "cursor", "email": null, "planType": null }, "requiresOpenaiAuth": false },
        "providers": [], "models": [{ "id": "cursor/auto", "model": "cursor/auto", "displayName": "Auto", "description": "Cursor automatic model", "isDefault": true }],
        "modes": [], "commands": [], "capabilities": {}, "warnings": [] })
}
fn cursor_registry(adapter: Rc<Adapter>) -> AgentRuntimeRegistry {
    let discovery = Probe::new(|_, _| Box::pin(async { Ok(failed_cursor_probe()) }));
    AgentRuntimeRegistry::new(
        vec![definition("cursor", 1, discovery, adapter)],
        None,
        None,
    )
    .unwrap()
}

#[test]
fn structured_account_setup_routes_to_authentication_expiry_or_runtime_setup() {
    for (account, code) in [
        (
            json!({ "account": null, "requiresOpenaiAuth": true }),
            "AUTHENTICATION_REQUIRED",
        ),
        (
            json!({ "account": null, "requiresOpenaiAuth": true, "setupReason": "authentication-expired" }),
            "AUTHENTICATION_EXPIRED",
        ),
        (
            json!({ "account": null, "requiresOpenaiAuth": false, "requiresRuntimeSetup": true }),
            "RUNTIME_SETUP_REQUIRED",
        ),
    ] {
        let mut readiness = ready("fixture");
        readiness["selectable"] = json!(true);
        let result = crate::agent::application::agent_input_policy::readiness_with_account_state(
            &readiness,
            &account,
            "Fixture Agent",
        );
        assert_eq!(result["status"], "installed-not-authenticated");
        assert_eq!(result["code"], code);
        assert_eq!(result["selectable"], false);
    }
}

#[test]
fn authoritative_handshake_recovers_a_failed_status_probe() {
    run_local(async {
        let adapter = Rc::new(Adapter::default());
        *adapter.inspection.borrow_mut() =
            Some(Rc::new(|| Box::pin(async { Ok(cursor_inspection()) })));
        let registry = cursor_registry(adapter.clone());
        let result = resolver(&registry)
            .query_catalog(&json!({ "runtimeId": "cursor" }), Some("/workspace"))
            .await
            .unwrap();
        assert_eq!(adapter.inspections.get(), 1);
        assert_eq!(result["readiness"]["status"], "ready");
        assert_eq!(result["readiness"]["code"], "READY");
        assert_eq!(result["readiness"]["selectable"], true);
        assert!(
            result["readiness"]["message"]
                .as_str()
                .unwrap()
                .contains("verified through its native protocol")
        );
        registry.dispose().await.unwrap();
    });
}

#[test]
fn failed_authoritative_handshake_preserves_the_probe_reason_and_diagnostic() {
    run_local(async {
        let adapter = Rc::new(Adapter::default());
        *adapter.inspection.borrow_mut() = Some(Rc::new(|| {
            Box::pin(async { Err(AgentError::new("ACP handshake exited unexpectedly")) })
        }));
        let registry = cursor_registry(adapter.clone());
        let result = resolver(&registry)
            .query_catalog(&json!({ "runtimeId": "cursor" }), Some("/workspace"))
            .await
            .unwrap();
        assert_eq!(adapter.inspections.get(), 1);
        assert_eq!(result["readiness"]["status"], "error");
        assert_eq!(result["readiness"]["code"], "AUTHENTICATION_PROBE_FAILED");
        assert_eq!(result["readiness"]["selectable"], false);
        assert_eq!(result["readiness"]["message"], "Cursor status failed.");
        assert!(
            regex::Regex::new(
                "(?i)exit code 139.*fallback failed.*ACP handshake exited unexpectedly"
            )
            .unwrap()
            .is_match(result["readiness"]["diagnostic"].as_str().unwrap())
        );
        registry.dispose().await.unwrap();
    });
}

#[test]
fn concurrent_protocol_verification_shares_one_inspection_per_runtime_and_workspace() {
    run_local(async {
        let (reply, pending) = oneshot::channel();
        let pending = RefCell::new(Some(pending));
        let adapter = Rc::new(Adapter::default());
        *adapter.inspection.borrow_mut() = Some(Rc::new(move || {
            let pending = pending
                .borrow_mut()
                .take()
                .expect("duplicated protocol verification");
            Box::pin(async move { Ok(pending.await.unwrap()) })
        }));
        let registry = cursor_registry(adapter.clone());
        let resolver = resolver(&registry);
        let first = {
            let resolver = resolver.clone();
            tokio::task::spawn_local(async move {
                resolver
                    .query_catalog(&json!({ "runtimeId": "cursor" }), Some("/workspace"))
                    .await
            })
        };
        let second = {
            let resolver = resolver.clone();
            tokio::task::spawn_local(async move {
                resolver
                    .query_catalog(&json!({ "runtimeId": "cursor" }), Some("/workspace"))
                    .await
            })
        };
        wait_until(|| adapter.inspections.get() == 1).await;
        reply.send(cursor_inspection()).unwrap();
        for result in [
            first.await.unwrap().unwrap(),
            second.await.unwrap().unwrap(),
        ] {
            assert_eq!(result["readiness"]["status"], "ready");
        }
        assert_eq!(adapter.inspections.get(), 1);
        assert_eq!(adapter.disposals.get(), 1);
        registry.dispose().await.unwrap();
    });
}

#[test]
fn negotiated_capabilities_drop_unknown_metadata_and_require_real_operations() {
    use super::agent_session_history_port::assert_agent_session_history_capabilities;
    use crate::agent::contract::runtime_schema::{
        assert_agent_runtime_capabilities, normalize_capability_snapshot,
    };
    let capabilities = normalize_capability_snapshot(&json!({
        "streamingText": true, "revision": "cursor-acp:1",
        "protocol": { "name": "acp", "version": 1, "agentVersion": "2026.08.1", "extensions": { "cursor.askQuestion": 1, "unsafe": "drop" } },
        "constraints": { "modelSwitch": "turn-boundary", "forkRequiresIdle": true, "unsafe": "drop" },
        "history": { "discovery": "paged", "exactOpen": "supported", "hydration": "paged", "unsafe": "drop" },
        "recovery": { "strategy": "object-reconciliation", "activeExecution": "outcome-unknown", "atomicHandoff": false, "unsafe": true }, "unknownCapability": true,
    }));
    assert_eq!(capabilities["streamingText"], true);
    assert_eq!(capabilities["revision"], "cursor-acp:1");
    assert_eq!(
        capabilities["protocol"],
        json!({ "name": "acp", "version": 1, "agentVersion": "2026.08.1", "extensions": { "cursor.askQuestion": 1 } })
    );
    assert_eq!(
        capabilities["constraints"],
        json!({ "modelSwitch": "turn-boundary", "forkRequiresIdle": true })
    );
    assert_eq!(
        capabilities["history"],
        json!({ "discovery": "paged", "exactOpen": "supported", "hydration": "paged" })
    );
    assert_eq!(
        capabilities["recovery"],
        json!({ "strategy": "object-reconciliation", "activeExecution": "outcome-unknown", "atomicHandoff": false })
    );
    assert!(capabilities.get("unknownCapability").is_none());
    let error = assert_agent_runtime_capabilities(
        |_| false,
        &json!({ "structuredQuestions": true }),
        "broken",
    )
    .unwrap_err();
    assert!(error.to_string().contains("structuredQuestions"));
    assert!(error.to_string().contains("resolveQuestion"));
    let error = assert_agent_session_history_capabilities(&Adapter::default(), &json!({ "resume": true, "sessionHistory": true, "history": { "discovery": "paged", "exactOpen": "supported", "hydration": "snapshot" } }), "broken-history").unwrap_err();
    assert!(error.message.contains("SessionHistoryPort.discover"));
}

#[test]
fn every_native_adapter_implements_its_advertised_operations_and_history_contract() {
    use super::agent_session_history_port::assert_agent_session_history_capabilities;
    use crate::agent::contract::runtime_schema::assert_agent_runtime_capabilities;
    use crate::agent::protocols::acp::acp_runtime_adapter::{
        AcpAdapterOptions, AcpRuntimeAdapter, BASE_ACP_CAPABILITIES,
    };
    use crate::agent::protocols::pi_rpc::pi_rpc_runtime_adapter::{
        PI_CAPABILITIES, PiAdapterOptions,
    };
    use crate::agent::runtimes::claude::claude_agent_sdk_adapter::{
        CLAUDE_CAPABILITIES, ClaudeAdapterOptions, ClaudeAgentSdkAdapter,
    };
    use crate::agent::runtimes::codex::codex_app_server_adapter::{
        CODEX_CAPABILITIES, CodexAdapterOptions, CodexAppServerAdapter,
    };
    use crate::agent::runtimes::cursor::cursor_acp_adapter::cursor_acp_adapter;
    use crate::agent::runtimes::pi::pi_rpc_adapter::pi_rpc_adapter;
    run_local(async {
        let readiness = json!({ "executablePath": "/tools/fixture", "environment": {} });
        let codex = CodexAppServerAdapter::new(CodexAdapterOptions {
            executable_path: "/tools/codex".into(),
            environment: Some(json!({})),
            workspace_root: "/workspace".into(),
            app_version: "test".into(),
            spawner: None,
            connection_factory: None,
            on_event: Rc::new(|_| {}),
            on_exit: Rc::new(|_| {}),
            on_session_persisted: None,
        });
        let claude =
            ClaudeAgentSdkAdapter::new(ClaudeAdapterOptions::new(readiness.clone(), "/workspace"));
        let acp = AcpRuntimeAdapter::new(AcpAdapterOptions::new(
            readiness.clone(),
            "/workspace",
            json!({ "id": "opencode-acp", "displayName": "OpenCode" }),
        ))
        .unwrap();
        let cursor = cursor_acp_adapter(AcpAdapterOptions::new(
            readiness.clone(),
            "/workspace",
            json!({ "id": "cursor", "displayName": "Cursor" }),
        ))
        .unwrap();
        let pi = pi_rpc_adapter(PiAdapterOptions::new(
            readiness,
            "/workspace",
            json!({ "id": "pi", "displayName": "Pi" }),
            "default".into(),
        ))
        .unwrap();
        let mut acp_caps = BASE_ACP_CAPABILITIES.clone();
        acp_caps["revision"] = json!("opencode-acp:1");
        acp_caps["protocol"] = json!({ "name": "acp", "version": 1 });
        let mut cursor_caps = acp_caps.clone();
        cursor_caps["structuredQuestions"] = json!(true);
        cursor_caps["revision"] = json!("cursor-acp:1");
        let adapters: Vec<(&str, &dyn AgentRuntimeAdapter, &Value)> = vec![
            ("codex", &codex, &CODEX_CAPABILITIES),
            ("claude", &claude, &CLAUDE_CAPABILITIES),
            ("opencode-acp", &acp, &acp_caps),
            ("cursor", &cursor, &cursor_caps),
            ("pi", &pi, &PI_CAPABILITIES),
        ];
        for (id, adapter, capabilities) in adapters {
            let normalized = assert_agent_runtime_capabilities(
                |method| adapter.implements(method),
                capabilities,
                id,
            )
            .unwrap();
            assert_agent_session_history_capabilities(adapter, &normalized, id).unwrap();
            assert!(!normalized["revision"].as_str().unwrap().is_empty());
            assert!(!normalized["protocol"]["name"].as_str().unwrap().is_empty());
            adapter.dispose().await.unwrap();
        }
        assert_eq!(
            PI_CAPABILITIES["history"],
            json!({ "discovery": "unsupported", "exactOpen": "supported", "hydration": "snapshot" })
        );
    });
}

#[test]
fn inline_acp_images_fit_below_the_jsonl_frame_budget() {
    use crate::agent::protocols::acp::acp_limits::ACP_INLINE_IMAGE_MAX_BYTES;
    use crate::agent::protocols::acp::acp_runtime_adapter::BASE_ACP_CAPABILITIES;
    assert_eq!(
        BASE_ACP_CAPABILITIES["referenceInputs"]["attachments"]["image"]["maxBytes"],
        json!(ACP_INLINE_IMAGE_MAX_BYTES)
    );
    assert!(
        BASE_ACP_CAPABILITIES["referenceInputs"]["attachments"]["image"]["maxBytes"]
            .as_u64()
            .unwrap()
            < 1024 * 1024
    );
}

#[test]
fn registry_coalesces_shutdown_and_retains_failed_adapter_cleanup_for_retry() {
    run_local(async {
        let first = Rc::new(Adapter::default());
        first.dispose_failures.set(1);
        let second = Rc::new(Adapter::default());
        let registry = AgentRuntimeRegistry::new(
            vec![
                definition("first", 2, Probe::ready("first"), first.clone()),
                definition("second", 1, Probe::ready("second"), second.clone()),
            ],
            None,
            None,
        )
        .unwrap();
        let (first_refs, second_refs) = (Rc::strong_count(&first), Rc::strong_count(&second));
        registry
            .create_adapter(
                "first",
                AdapterOptions::detached(ready("first"), "/workspace"),
            )
            .unwrap();
        registry
            .create_adapter(
                "second",
                AdapterOptions::detached(ready("second"), "/workspace"),
            )
            .unwrap();
        assert_eq!(Rc::strong_count(&first), first_refs + 1);
        assert_eq!(Rc::strong_count(&second), second_refs + 1);
        let one = registry.dispose();
        let two = registry.dispose();
        let (one, two) = futures_util::join!(one, two);
        assert!(one.unwrap_err().message.contains("failed to dispose"));
        assert!(two.is_err());
        assert_eq!((first.disposals.get(), second.disposals.get()), (1, 1));
        assert_eq!(Rc::strong_count(&first), first_refs + 1);
        assert_eq!(Rc::strong_count(&second), second_refs);
        assert!(
            registry
                .create_adapter(
                    "first",
                    AdapterOptions::detached(ready("first"), "/workspace")
                )
                .is_err()
        );
        registry.dispose().await.unwrap();
        assert_eq!((first.disposals.get(), second.disposals.get()), (2, 1));
        assert_eq!(Rc::strong_count(&first), first_refs);
        assert_eq!(Rc::strong_count(&second), second_refs);
    });
}
