//! `runtime-resolution/runtime-resolution-coordinator.mjs`: the
//! authoritative resolver of which runtime an operation may use, and the
//! renderer-safe catalog it answers.
use super::super::agent_input_policy::readiness_with_account_state;
use super::super::processes::agent_process_supervisor::AgentProcessSupervisor;
use super::runtime_readiness_store::RuntimeReadinessStore;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::runtime_schema::{
    normalize_capability_snapshot, sanitize_agent_runtime_descriptor,
};
use crate::agent::runtime::agent_runtime_port::{AdapterOptions, assert_agent_runtime_inspection};
use crate::agent::runtime::agent_runtime_registry::{
    AgentRuntimeRegistry, RuntimeCatalogEntry, public_runtime_readiness,
};
use crate::agent::runtime::agent_runtime_resolution::agent_runtime_resolution_error;
use crate::agent::tasks::{SharedTask, shared};
use crate::text;
use regex::Regex;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::LazyLock;

static RUNTIME_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9-]{1,39}$").expect("runtime id"));

/// `resolveForOperation(...)`'s result.
#[derive(Clone, Debug)]
pub struct ResolvedRuntime {
    pub descriptor: Value,
    /// The internal (launch) readiness, promoted when publicly ready.
    pub readiness: Value,
    pub public_readiness: Value,
    pub protocol_verification_required: bool,
    pub generation: u64,
}

#[derive(Clone)]
pub struct RuntimeResolutionCoordinator {
    registry: AgentRuntimeRegistry,
    supervisor: AgentProcessSupervisor,
    store: RuntimeReadinessStore,
    inspection_flights: Rc<RefCell<HashMap<String, SharedTask<AgentResult<Value>>>>>,
}

fn neutral_inspection_root() -> String {
    std::env::temp_dir().to_string_lossy().into_owned()
}

impl RuntimeResolutionCoordinator {
    /// `createRuntimeResolutionCoordinator({ runtimeRegistry, processSupervisor, readinessStore })`.
    pub fn new(
        registry: AgentRuntimeRegistry,
        supervisor: AgentProcessSupervisor,
        store: Option<RuntimeReadinessStore>,
    ) -> Self {
        Self {
            registry,
            supervisor,
            store: store.unwrap_or_else(|| RuntimeReadinessStore::new(None, None)),
            inspection_flights: Rc::default(),
        }
    }

    /// `coordinator.queryCatalog(request, workspaceRoot)`.
    pub async fn query_catalog(
        &self,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        let runtime_id = request
            .get("runtimeId")
            .and_then(Value::as_str)
            .map(str::to_string);
        validate_requested_runtime(runtime_id.as_deref(), false)?;
        let refresh = js::truthy_opt(request.get("refresh"));
        if refresh {
            self.store.clear();
        }
        let generation = self.store.generation();
        // A bound conversation must not wait for unrelated CLI installation/auth
        // probes. Only the unbound launcher/history query needs the full catalog.
        let catalog = self.registry.discover(refresh, runtime_id.as_deref()).await;
        let selected = select_requested_runtime(&catalog, runtime_id.as_deref(), false)?;
        let mut runtimes: Vec<Value> = catalog
            .iter()
            .map(|entry| {
                Ok(json!({
                    "descriptor": sanitize_agent_runtime_descriptor(&entry.descriptor)?,
                    "readiness": public_runtime_readiness(entry)?,
                }))
            })
            .collect::<AgentResult<_>>()?;
        let Some(selected) = selected else {
            return Ok(empty_catalog(runtimes));
        };
        let public_readiness = public_runtime_readiness(&selected)?;
        let protocol_fallback = allows_protocol_verification(&selected.readiness);
        if public_readiness["status"] != "ready" && !protocol_fallback {
            return Ok(unavailable_catalog(runtimes, &selected, &public_readiness));
        }
        let inspection_root = workspace_root
            .filter(|r| !r.is_empty())
            .map(str::to_string)
            .unwrap_or_else(neutral_inspection_root);
        let id = selected.descriptor["id"].as_str().unwrap_or("").to_string();
        if !refresh && let Some(cached) = self.store.get(&id, &inspection_root) {
            update_runtime_row(&mut runtimes, &id, &cached.public_readiness);
            return Ok(catalog_result(
                runtimes,
                &selected,
                &cached.public_readiness,
                &cached.inspection,
            ));
        }
        match self
            .inspect_runtime_single_flight(&selected, &inspection_root, generation)
            .await
        {
            Ok(inspection) => {
                let effective =
                    effective_readiness_after_inspection(&selected, &public_readiness, &inspection);
                if self.store.generation() == generation {
                    self.store.set(
                        &id,
                        &inspection_root,
                        effective.clone(),
                        promote_internal_readiness(&selected.readiness, &effective),
                        inspection.clone(),
                        "protocol-handshake",
                    );
                }
                update_runtime_row(&mut runtimes, &id, &effective);
                Ok(catalog_result(runtimes, &selected, &effective, &inspection))
            }
            Err(error) => {
                let message = redact_secret_text(&error.message);
                let failed =
                    failed_inspection_readiness(&public_readiness, protocol_fallback, &message);
                self.store.invalidate(&id, &inspection_root);
                update_runtime_row(&mut runtimes, &id, &failed);
                Ok(
                    Obj::from(&unavailable_catalog(runtimes, &selected, &failed))
                        .set("warnings", vec![message])
                        .build(),
                )
            }
        }
    }

    /// `coordinator.resolveForOperation({ runtimeId, workspaceRoot, operation, refresh })`.
    pub async fn resolve_for_operation(
        &self,
        runtime_id: Option<&str>,
        workspace_root: &str,
        operation: &str,
        refresh: bool,
    ) -> AgentResult<ResolvedRuntime> {
        validate_requested_runtime(runtime_id, true)?;
        if refresh {
            self.store.clear();
        }
        let catalog = self.registry.discover(refresh, runtime_id).await;
        let selected =
            select_requested_runtime(&catalog, runtime_id, true)?.expect("a required runtime");
        let public_readiness = public_runtime_readiness(&selected)?;
        let verification = public_readiness["status"] != "ready"
            && allows_protocol_verification(&selected.readiness);
        if public_readiness["status"] != "ready" && !verification {
            return Err(agent_runtime_resolution_error(
                selected.descriptor["id"].as_str().unwrap_or(""),
                operation,
                None,
                &public_readiness,
                None,
            ));
        }
        let cached = self.store.get(
            selected.descriptor["id"].as_str().unwrap_or(""),
            workspace_root,
        );
        let effective = match cached {
            Some(cached) if cached.public_readiness["status"] == "ready" => cached.public_readiness,
            _ => public_readiness,
        };
        Ok(ResolvedRuntime {
            readiness: promote_internal_readiness(&selected.readiness, &effective),
            descriptor: selected.descriptor,
            public_readiness: effective,
            protocol_verification_required: verification,
            generation: self.store.generation(),
        })
    }

    /// `coordinator.recordOperationSuccess({ runtimeId, workspaceRoot, readiness, descriptor, inspection })`.
    pub fn record_operation_success(
        &self,
        runtime_id: &str,
        workspace_root: &str,
        readiness: &Value,
        descriptor: &Value,
        inspection: &Value,
    ) {
        let entry = RuntimeCatalogEntry {
            descriptor: descriptor.clone(),
            readiness: readiness.clone(),
        };
        let Ok(public_base) = public_runtime_readiness(&entry) else {
            return;
        };
        let effective = effective_readiness_after_inspection(&entry, &public_base, inspection);
        self.store.set(
            runtime_id,
            workspace_root,
            effective.clone(),
            promote_internal_readiness(readiness, &effective),
            inspection.clone(),
            "live-operation",
        );
    }

    /// `coordinator.recordOperationFailure({ runtimeId, workspaceRoot })`.
    pub fn record_operation_failure(&self, runtime_id: &str, workspace_root: &str) {
        self.store.invalidate(runtime_id, workspace_root);
    }

    /// `coordinator.clear()`.
    pub fn clear(&self) -> u64 {
        self.inspection_flights.borrow_mut().clear();
        self.store.clear()
    }

    async fn inspect_runtime(
        registry: AgentRuntimeRegistry,
        supervisor: AgentProcessSupervisor,
        selected: RuntimeCatalogEntry,
        workspace_root: String,
    ) -> AgentResult<Value> {
        let id = selected.descriptor["id"].as_str().unwrap_or("").to_string();
        let adapter = registry.create_adapter(
            &id,
            AdapterOptions::detached(selected.readiness.clone(), &workspace_root),
        )?;
        let result = supervisor
            .run_start(&format!("{id}:catalog-inspect"), None, || adapter.inspect())
            .await
            .and_then(|inspected| {
                assert_agent_runtime_inspection(adapter.as_ref(), &inspected, &id)
            })
            .map(|inspection| normalize_inspection(&inspection, &selected.descriptor));
        let disposed = adapter.dispose().await;
        let inspection = result?;
        disposed?;
        Ok(inspection)
    }

    async fn inspect_runtime_single_flight(
        &self,
        selected: &RuntimeCatalogEntry,
        workspace_root: &str,
        generation: u64,
    ) -> AgentResult<Value> {
        let key = format!(
            "{generation}\0{}\0{workspace_root}",
            selected.descriptor["id"].as_str().unwrap_or("")
        );
        let existing = self.inspection_flights.borrow().get(&key).cloned();
        if let Some(existing) = existing {
            return existing.await;
        }
        let flights = self.inspection_flights.clone();
        let flight_key = key.clone();
        let flight = shared(Self::inspect_runtime(
            self.registry.clone(),
            self.supervisor.clone(),
            selected.clone(),
            workspace_root.to_string(),
        ));
        self.inspection_flights
            .borrow_mut()
            .insert(key, flight.clone());
        let result = flight.clone().await;
        let mut flights = flights.borrow_mut();
        if flights
            .get(&flight_key)
            .is_some_and(|current| current.ptr_eq(&flight))
        {
            flights.remove(&flight_key);
        }
        result
    }
}

fn select_requested_runtime(
    catalog: &[RuntimeCatalogEntry],
    value: Option<&str>,
    required: bool,
) -> AgentResult<Option<RuntimeCatalogEntry>> {
    validate_requested_runtime(value, required)?;
    let Some(value) = value else {
        return Ok(None);
    };
    let selected = catalog
        .iter()
        .find(|entry| entry.descriptor["id"] == value)
        .cloned();
    if selected.is_none() && required {
        return Err(AgentError::new(format!(
            "Agent runtime {value} is not registered."
        )));
    }
    Ok(selected)
}

fn validate_requested_runtime(value: Option<&str>, required: bool) -> AgentResult<()> {
    let Some(value) = value else {
        if required {
            return Err(AgentError::new(
                "Choose an Agent before starting an Agent session.",
            ));
        }
        return Ok(());
    };
    if !RUNTIME_ID.is_match(value) {
        return Err(AgentError::new("Agent runtime selection is invalid."));
    }
    Ok(())
}

fn allows_protocol_verification(readiness: &Value) -> bool {
    readiness["inspectionFallback"] == "runtime-handshake"
}

fn effective_readiness_after_inspection(
    selected: &RuntimeCatalogEntry,
    public_readiness: &Value,
    inspection: &Value,
) -> Value {
    let name = selected.descriptor["displayName"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let inspected = if allows_protocol_verification(&selected.readiness) {
        Obj::from(public_readiness)
            .set("status", "ready")
            .set("code", "READY")
            .set("selectable", true)
            .set(
                "message",
                format!("{name} authentication was verified through its native protocol."),
            )
            .build()
    } else {
        public_readiness.clone()
    };
    readiness_with_account_state(&inspected, &inspection["account"], &name)
}

fn promote_internal_readiness(internal: &Value, public: &Value) -> Value {
    if public["status"] != "ready" {
        return internal.clone();
    }
    Obj::from(internal)
        .set("status", "ready")
        .set("code", "READY")
        .set("selectable", true)
        .set("message", public["message"].clone())
        .build()
}

fn failed_inspection_readiness(public: &Value, protocol_fallback: bool, message: &str) -> Value {
    if protocol_fallback {
        let diagnostic = [
            public["diagnostic"]
                .as_str()
                .filter(|d| !d.is_empty())
                .map(str::to_string),
            Some(format!("Native protocol fallback failed: {message}")),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
        return Obj::from(public)
            .set("selectable", false)
            .set("diagnostic", text::head16(&diagnostic, 4_000))
            .build();
    }
    Obj::from(public)
        .set("status", "error")
        .set("code", "RUNTIME_INSPECTION_FAILED")
        .set("selectable", false)
        .set("message", message)
        .build()
}

fn list(value: &Value, key: &str) -> Value {
    Value::Array(
        value
            .get(key)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    )
}

fn normalize_inspection(inspection: &Value, descriptor: &Value) -> Value {
    let runtime = inspection
        .get("runtime")
        .filter(|r| js::truthy(r))
        .unwrap_or(descriptor);
    Obj::new()
        .set(
            "account",
            inspection.get("account").cloned().unwrap_or(Value::Null),
        )
        .set("providers", list(inspection, "providers"))
        .set("models", list(inspection, "models"))
        .set("modes", list(inspection, "modes"))
        .set("commands", list(inspection, "commands"))
        .set(
            "capabilities",
            normalize_capability_snapshot(inspection.get("capabilities").unwrap_or(&Value::Null)),
        )
        .set(
            "runtime",
            sanitize_agent_runtime_descriptor(runtime).unwrap_or_else(|_| descriptor.clone()),
        )
        .set("warnings", list(inspection, "warnings"))
        .build()
}

fn empty_catalog(runtimes: Vec<Value>) -> Value {
    json!({
        "runtimes": runtimes, "selectedRuntimeId": null, "readiness": null, "account": null,
        "providers": [], "models": [], "modes": [], "commands": [], "capabilities": null, "warnings": [],
    })
}

fn unavailable_catalog(
    runtimes: Vec<Value>,
    selected: &RuntimeCatalogEntry,
    readiness: &Value,
) -> Value {
    json!({
        "runtimes": runtimes, "selectedRuntimeId": selected.descriptor["id"], "readiness": readiness,
        "account": null, "providers": [], "models": [], "modes": [], "commands": [], "capabilities": null,
        "runtime": selected.descriptor, "warnings": [],
    })
}

fn catalog_result(
    runtimes: Vec<Value>,
    selected: &RuntimeCatalogEntry,
    readiness: &Value,
    inspection: &Value,
) -> Value {
    Obj::new()
        .set("runtimes", runtimes)
        .set("selectedRuntimeId", selected.descriptor["id"].clone())
        .set("readiness", readiness.clone())
        .spread(inspection)
        .build()
}

fn update_runtime_row(runtimes: &mut [Value], runtime_id: &str, readiness: &Value) {
    if let Some(entry) = runtimes
        .iter_mut()
        .find(|entry| entry["descriptor"]["id"] == runtime_id)
    {
        entry["readiness"] = readiness.clone();
    }
}
