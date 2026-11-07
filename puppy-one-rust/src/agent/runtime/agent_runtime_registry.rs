//! `runtime/agent-runtime-registry.mjs`: the registered runtimes, their
//! discovery and the adapters they create.
use super::agent_runtime_manifest::{
    define_agent_runtime_manifest, runtime_descriptor_from_manifest,
};
use super::agent_runtime_port::{AdapterFuture, AdapterOptions, AgentRuntimeAdapter};
use super::agent_session_history_port::SessionHistoryPort;
use super::runtime_discovery_supervisor::RuntimeDiscoverySupervisor;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::Obj;
use crate::agent::contract::runtime_schema::{
    assert_agent_runtime_readiness, sanitize_agent_runtime_descriptor,
};
use crate::agent::tasks::{CancelSignal, SharedTask, shared};
use futures_util::future::{LocalBoxFuture, join_all};
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::{Rc, Weak};

/// A runtime's native discovery (`definition.discovery`).
pub trait RuntimeDiscovery {
    /// `discovery.discover({ refresh, signal })`: the runtime's readiness.
    fn discover(
        &self,
        refresh: bool,
        signal: CancelSignal,
    ) -> LocalBoxFuture<'static, AgentResult<Value>>;
}

type AdapterFactory = Rc<dyn Fn(AdapterOptions) -> AgentResult<Rc<dyn AgentRuntimeAdapter>>>;

/// One runtime definition, as a runtime module exports it.
#[derive(Clone)]
pub struct RuntimeDefinition {
    pub manifest: Value,
    pub discovery: Rc<dyn RuntimeDiscovery>,
    pub create_adapter: AdapterFactory,
    pub dispose: Option<Rc<dyn Fn() -> LocalBoxFuture<'static, AgentResult<()>>>>,
    pub has_active_resources: Option<Rc<dyn Fn() -> bool>>,
}

/// A registered definition: its validated manifest and public descriptor.
pub struct RegisteredRuntime {
    pub definition: RuntimeDefinition,
    pub manifest: Value,
    pub descriptor: Value,
}

/// One `discover()` row.
#[derive(Clone, Debug)]
pub struct RuntimeCatalogEntry {
    pub descriptor: Value,
    pub readiness: Value,
}

struct RegistryState {
    discovery: RuntimeDiscoverySupervisor,
    definitions: Vec<Rc<RegisteredRuntime>>,
    adapters: RefCell<HashMap<u64, Rc<TrackedAdapter>>>,
    next_adapter: Cell<u64>,
    disposed: Cell<bool>,
    disposal: RefCell<Option<SharedTask<AgentResult<()>>>>,
    default_runtime_id: String,
}

/// `AgentRuntimeRegistry` (and the `AgentRuntimeHost` facade over it).
#[derive(Clone)]
pub struct AgentRuntimeRegistry(Rc<RegistryState>);

pub type AgentRuntimeHost = AgentRuntimeRegistry;

impl AgentRuntimeRegistry {
    /// `new AgentRuntimeRegistry(definitions, { defaultRuntimeId, discoveryTimeoutMs })`.
    pub fn new(
        definitions: Vec<RuntimeDefinition>,
        default_runtime_id: Option<&str>,
        discovery_timeout_ms: Option<u64>,
    ) -> AgentResult<Self> {
        let mut registered: Vec<Rc<RegisteredRuntime>> = Vec::new();
        for definition in definitions {
            let manifest = define_agent_runtime_manifest(&definition.manifest)?;
            let descriptor = runtime_descriptor_from_manifest(&manifest)?;
            let id = manifest["id"].as_str().unwrap_or_default().to_string();
            if registered
                .iter()
                .any(|entry| entry.manifest["id"] == id.as_str())
            {
                return Err(AgentError::new(format!("Duplicate Agent runtime: {id}")));
            }
            registered.push(Rc::new(RegisteredRuntime {
                definition,
                manifest,
                descriptor,
            }));
        }
        if registered.is_empty() {
            return Err(AgentError::new(
                "At least one Agent runtime must be registered.",
            ));
        }
        let state = RegistryState {
            discovery: RuntimeDiscoverySupervisor::new(discovery_timeout_ms),
            definitions: registered,
            adapters: RefCell::default(),
            next_adapter: Cell::new(0),
            disposed: Cell::new(false),
            disposal: RefCell::new(None),
            default_runtime_id: String::new(),
        };
        let mut registry = Self(Rc::new(state));
        let default_id = default_runtime_id
            .map(str::to_string)
            .or_else(|| {
                registry
                    .descriptors()
                    .first()
                    .and_then(|d| d["id"].as_str().map(str::to_string))
            })
            .unwrap_or_default();
        if registry.require(&default_id).is_err() {
            return Err(AgentError::new(format!(
                "Default Agent runtime is not registered: {default_id}"
            )));
        }
        Rc::get_mut(&mut registry.0)
            .expect("a fresh registry")
            .default_runtime_id = default_id;
        Ok(registry)
    }

    pub fn default_runtime_id(&self) -> &str {
        &self.0.default_runtime_id
    }

    /// `registry.descriptors()`.
    pub fn descriptors(&self) -> Vec<Value> {
        let mut descriptors: Vec<Value> = self
            .0
            .definitions
            .iter()
            .filter_map(|entry| sanitize_agent_runtime_descriptor(&entry.descriptor).ok())
            .collect();
        descriptors.sort_by(|left, right| {
            let priority = |d: &Value| d["priority"].as_i64().unwrap_or(0);
            priority(right).cmp(&priority(left)).then_with(|| {
                left["id"]
                    .as_str()
                    .unwrap_or("")
                    .cmp(right["id"].as_str().unwrap_or(""))
            })
        });
        descriptors
    }

    /// `registry.manifests()`: Main-process-only manifests.
    pub fn manifests(&self) -> Vec<Value> {
        self.descriptors()
            .iter()
            .filter_map(|d| self.require(d["id"].as_str().unwrap_or("")).ok())
            .map(|entry| entry.manifest.clone())
            .collect()
    }

    /// `registry.discover({ refresh, runtimeId })`.
    pub async fn discover(
        &self,
        refresh: bool,
        runtime_id: Option<&str>,
    ) -> Vec<RuntimeCatalogEntry> {
        let descriptors: Vec<Value> = self
            .descriptors()
            .into_iter()
            .filter(|descriptor| runtime_id.is_none_or(|id| descriptor["id"] == id))
            .collect();
        let rows = descriptors.into_iter().map(|descriptor| {
            let registry = self.clone();
            async move {
                let id = descriptor["id"].as_str().unwrap_or("").to_string();
                let result = match registry.require(&id) {
                    Ok(definition) => {
                        let discovery = definition.definition.discovery.clone();
                        let expected = id.clone();
                        registry
                            .0
                            .discovery
                            .run(&id, move |signal| {
                                Box::pin(async move {
                                    let result = discovery.discover(refresh, signal).await?;
                                    assert_agent_runtime_readiness(&result)?;
                                    let reported = result
                                        .get("runtimeId")
                                        .filter(|v| !v.is_null())
                                        .or(result.get("provider"))
                                        .and_then(Value::as_str);
                                    if reported.is_some_and(|reported| !reported.is_empty() && reported != expected) {
                                        return Err(AgentError::new(
                                            "Discovery returned a different Agent runtime identity.",
                                        ));
                                    }
                                    Ok(result)
                                })
                            })
                            .await
                    }
                    Err(error) => Err(error),
                };
                let readiness = result.unwrap_or_else(|error| {
                    Obj::new()
                        .set("runtimeId", id.as_str())
                        .set("provider", id.as_str())
                        .set("status", "error")
                        .set("code", "RUNTIME_DISCOVERY_FAILED")
                        .set("version", Value::Null)
                        .set("minimumVersion", Value::Null)
                        .set("executablePath", Value::Null)
                        .set("environment", serde_json::json!({}))
                        .set("message", error.message)
                        .build()
                });
                RuntimeCatalogEntry { descriptor, readiness }
            }
        });
        join_all(rows).await
    }

    /// `registry.select(catalog, preferredRuntimeId)`.
    pub fn select<'a>(
        &self,
        catalog: &'a [RuntimeCatalogEntry],
        preferred: Option<&str>,
    ) -> Option<&'a RuntimeCatalogEntry> {
        let runtime_id = preferred
            .filter(|p| !p.is_empty())
            .unwrap_or(&self.0.default_runtime_id);
        catalog
            .iter()
            .find(|entry| entry.descriptor["id"] == runtime_id)
    }

    /// `registry.createAdapter(runtimeId, options)`: dispose is idempotent and
    /// tracked until it settles, so shutdown can release every adapter.
    pub fn create_adapter(
        &self,
        runtime_id: &str,
        options: AdapterOptions,
    ) -> AgentResult<Rc<dyn AgentRuntimeAdapter>> {
        if self.0.disposed.get() {
            return Err(AgentError::new("Agent runtime registry has closed."));
        }
        let definition = self.require(runtime_id)?;
        let inner = (definition.definition.create_adapter)(options)?;
        let id = self.0.next_adapter.get() + 1;
        self.0.next_adapter.set(id);
        let tracked = Rc::new(TrackedAdapter {
            inner,
            registry: Rc::downgrade(&self.0),
            id,
            disposal: RefCell::new(None),
            closed: Cell::new(false),
        });
        // Track even an adapter nobody disposes: shutdown still releases it.
        self.0.adapters.borrow_mut().insert(id, tracked.clone());
        Ok(tracked)
    }

    /// `registry.require(runtimeId)`.
    pub fn require(&self, runtime_id: &str) -> AgentResult<Rc<RegisteredRuntime>> {
        self.0
            .definitions
            .iter()
            .find(|entry| entry.manifest["id"] == runtime_id)
            .cloned()
            .ok_or_else(|| AgentError::new(format!("Unknown Agent runtime: {runtime_id}")))
    }

    /// `registry.dispose()`.
    pub fn dispose(&self) -> SharedTask<AgentResult<()>> {
        if let Some(disposal) = self.0.disposal.borrow().clone() {
            return disposal;
        }
        self.0.disposed.set(true);
        self.0.discovery.dispose();
        let adapters: Vec<Rc<TrackedAdapter>> =
            self.0.adapters.borrow().values().cloned().collect();
        let definitions: Vec<Rc<RegisteredRuntime>> = self.0.definitions.clone();
        let state = self.0.clone();
        let disposal = shared(async move {
            let mut failures = Vec::new();
            for result in join_all(adapters.iter().map(|adapter| adapter.dispose())).await {
                if let Err(error) = result {
                    failures.push(error);
                }
            }
            for definition in definitions {
                if let Some(dispose) = &definition.definition.dispose
                    && let Err(error) = dispose().await
                {
                    failures.push(error);
                }
            }
            *state.disposal.borrow_mut() = None;
            if failures.is_empty() {
                Ok(())
            } else {
                Err(AgentError::new(
                    "One or more Agent runtimes failed to dispose cleanly.",
                ))
            }
        });
        *self.0.disposal.borrow_mut() = Some(disposal.clone());
        disposal
    }

    /// `registry.hasActiveResources()`.
    pub fn has_active_resources(&self) -> bool {
        if !self.0.adapters.borrow().is_empty() || self.0.discovery.has_active_resources() {
            return true;
        }
        self.0.definitions.iter().any(|entry| {
            entry
                .definition
                .has_active_resources
                .as_ref()
                .is_some_and(|active| active())
        })
    }
}

/// `publicRuntimeReadiness(entry)`.
pub fn public_runtime_readiness(entry: &RuntimeCatalogEntry) -> AgentResult<Value> {
    let readiness = &entry.readiness;
    let text = |key: &str| readiness.get(key).filter(|v| !v.is_null()).cloned();
    let status = readiness["status"].as_str().unwrap_or("error").to_string();
    let id = entry.descriptor["id"]
        .as_str()
        .or(readiness["runtimeId"].as_str())
        .or(readiness["provider"].as_str())
        .unwrap_or("unknown")
        .to_string();
    let result = Obj::new()
        .set("runtimeId", id.as_str())
        .set(
            "provider",
            entry.descriptor["id"]
                .as_str()
                .or(readiness["provider"].as_str())
                .unwrap_or("unknown"),
        )
        .set("status", status.as_str())
        .set(
            "code",
            text("code").unwrap_or(Value::from("RUNTIME_DISCOVERY_FAILED")),
        )
        .set("version", text("version").unwrap_or(Value::Null))
        .set(
            "minimumVersion",
            text("minimumVersion").unwrap_or(Value::Null),
        )
        .set("message", text("message").unwrap_or(Value::from("")))
        .set("source", text("source").unwrap_or(Value::from("external")))
        .set(
            "compatibility",
            text("compatibility").unwrap_or(Value::from("unknown")),
        )
        .set(
            "selectable",
            status == "ready" && readiness["selectable"] != false,
        )
        .opt(
            "diagnostic",
            text("diagnostic").filter(crate::agent::contract::js::truthy),
        )
        .build();
    assert_agent_runtime_readiness(&result)?;
    Ok(result)
}

/// An adapter the registry created and tracks until its disposal settles.
struct TrackedAdapter {
    inner: Rc<dyn AgentRuntimeAdapter>,
    registry: Weak<RegistryState>,
    id: u64,
    disposal: RefCell<Option<SharedTask<AgentResult<()>>>>,
    closed: Cell<bool>,
}

impl AgentRuntimeAdapter for TrackedAdapter {
    fn inspect(&self) -> AdapterFuture<'_, Value> {
        self.inner.inspect()
    }
    fn create_session(&self, selection: Value) -> AdapterFuture<'_, Value> {
        self.inner.create_session(selection)
    }
    fn resume_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.inner.resume_session(request)
    }
    fn start_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.inner.start_turn(request)
    }
    fn interrupt_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.inner.interrupt_turn(request)
    }
    fn dispose(&self) -> AdapterFuture<'_, ()> {
        if self.closed.get() {
            return Box::pin(async { Ok(()) });
        }
        if let Some(disposal) = self.disposal.borrow().clone() {
            return Box::pin(disposal);
        }
        let inner = self.inner.clone();
        let registry = self.registry.clone();
        let id = self.id;
        let disposal = shared(async move {
            let result = inner.dispose().await;
            if result.is_ok()
                && let Some(registry) = registry.upgrade()
            {
                registry.adapters.borrow_mut().remove(&id);
            }
            result
        });
        *self.disposal.borrow_mut() = Some(disposal.clone());
        Box::pin(async move {
            let result = disposal.await;
            if result.is_ok() {
                self.closed.set(true);
            }
            *self.disposal.borrow_mut() = None;
            result
        })
    }
    fn implements(&self, name: &str) -> bool {
        self.inner.implements(name)
    }
    fn bootstrap_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.inner.bootstrap_session(request)
    }
    fn steer_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.inner.steer_turn(request)
    }
    fn resolve_approval(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.inner.resolve_approval(request)
    }
    fn resolve_question(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.inner.resolve_question(request)
    }
    fn fork_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.inner.fork_session(request)
    }
    fn compact_session(&self) -> AdapterFuture<'_, Value> {
        self.inner.compact_session()
    }
    fn archive_native_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.inner.archive_native_session(request)
    }
    fn delete_native_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.inner.delete_native_session(request)
    }
    fn reference_mention_delivery(&self, reference: &Value) -> Option<&'static str> {
        self.inner.reference_mention_delivery(reference)
    }
    fn session_history_port(&self) -> Option<Rc<dyn SessionHistoryPort>> {
        self.inner.session_history_port()
    }
}
