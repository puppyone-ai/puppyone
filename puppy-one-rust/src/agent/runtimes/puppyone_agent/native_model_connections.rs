//! The Built-in Agent's model-connection port over this app's own model
//! connections (`modelConnections.catalog()` / `acquire` / `validate` /
//! `release` in `electron/main.mjs`). Each saved connection serves its one
//! model; PuppyOne compute serves its catalog. A lease names the connection
//! and model only: the native kernel resolves the credential itself, so no
//! secret crosses the bootstrap envelope.
use super::model_connection_binding::ModelConnectionPort;
use crate::agent::agent_error::AgentResult;
use crate::agent::model_connections::configuration::{self, ModelConnection};
use crate::agent::model_connections::schema::{connection_error, model_route, parse_model_route};
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

/// A connection's window when its endpoint does not report one.
pub const DEFAULT_CONTEXT_WINDOW: u64 = 128_000;

/// Reads every connection the Built-in Agent may use (blocking: the
/// keychain-free configuration file and PuppyOne compute's catalog).
pub type ConnectionSource =
    Rc<dyn Fn() -> LocalBoxFuture<'static, AgentResult<Vec<ModelConnection>>>>;

/// The production source, off the host thread: the saved connections and
/// PuppyOne compute through `account`.
pub fn configured_connections(
    account: crate::agent::model_connections::ComputeAccountRef,
) -> ConnectionSource {
    Rc::new(move || {
        let account = account.clone();
        Box::pin(async move {
            tokio::task::spawn_blocking(move || {
                let mut connections =
                    configuration::load().map_err(crate::agent::agent_error::AgentError::new)?;
                connections.extend(configuration::managed(account.as_ref()));
                Ok(connections)
            })
            .await
            .map_err(|error| crate::agent::agent_error::AgentError::new(error.to_string()))?
        })
    })
}

/// `mc_<uuid>`: a saved connection's product identity.
pub fn product_connection_id(id: &str) -> String {
    format!("mc_{}", id.to_lowercase())
}

/// A connection's generation as the product's positive integer.
pub fn config_generation(generation: &str) -> u64 {
    let digest = blake3::hash(generation.as_bytes());
    let mut bytes = [0u8; 8];
    bytes[..6].copy_from_slice(&digest.as_bytes()[..6]);
    u64::from_le_bytes(bytes) + 1
}

fn model_entry(connection: &ModelConnection) -> Value {
    json!({
        "id": connection.model,
        "name": connection.model,
        "available": true,
        "contextWindow": DEFAULT_CONTEXT_WINDOW,
        "capabilities": {
            "text": "supported",
            "tools": "supported",
            "images": if connection.images { "supported" } else { "unsupported" },
        },
    })
}

/// `modelConnections.catalog()`: connections and their ready catalogs.
pub fn connection_catalog(connections: &[ModelConnection]) -> Value {
    let mut order: Vec<String> = Vec::new();
    let mut grouped: HashMap<String, Vec<&ModelConnection>> = HashMap::new();
    for connection in connections {
        let id = product_connection_id(&connection.id);
        if !grouped.contains_key(&id) {
            order.push(id.clone());
        }
        grouped.entry(id).or_default().push(connection);
    }
    let mut entries = Vec::new();
    let mut catalogs = Vec::new();
    for id in order {
        let members = &grouped[&id];
        let first = members[0];
        let generation = config_generation(&first.generation);
        entries.push(json!({
            "id": id,
            "name": first.name,
            "configGeneration": generation,
            "driver": if first.managed { "puppyone" } else { "openai-compatible" },
            "sourceKind": if first.managed { "managed" } else { "user" },
            "defaultModelId": first.model,
        }));
        catalogs.push(json!({
            "connectionId": id,
            "status": "ready",
            "configGeneration": generation,
            "models": members.iter().map(|c| model_entry(c)).collect::<Vec<_>>(),
        }));
    }
    let revision = blake3::hash(
        serde_json::to_string(&json!([entries, catalogs]))
            .unwrap_or_default()
            .as_bytes(),
    )
    .to_hex()[..16]
        .to_string();
    json!({ "revision": revision, "connections": entries, "catalogs": catalogs })
}

/// The configuration a lease authorizes (`readModelConfiguration`'s
/// envelope, without the credential).
pub fn lease_configuration(members: &[&ModelConnection], selected: &ModelConnection) -> Value {
    json!({
        "schemaVersion": 1,
        "connectionId": product_connection_id(&selected.id),
        "connectionName": selected.name,
        "securityGeneration": selected.generation,
        "configGeneration": config_generation(&selected.generation),
        "baseUrl": selected.endpoint,
        "auth": if selected.authenticated { "bearer" } else { "none" },
        "managed": selected.managed,
        "selectedModelId": selected.model,
        "models": members.iter().map(|c| model_entry(c)).collect::<Vec<_>>(),
    })
}

struct Lease {
    connection_id: String,
    security_generation: String,
}

/// `modelConnectionPort` over the app's connections.
pub struct NativeModelConnectionPort {
    source: ConnectionSource,
    leases: Rc<RefCell<HashMap<String, Lease>>>,
}

impl NativeModelConnectionPort {
    pub fn new(source: ConnectionSource) -> Self {
        Self {
            source,
            leases: Rc::default(),
        }
    }
}

impl ModelConnectionPort for NativeModelConnectionPort {
    fn read(&self) -> LocalBoxFuture<'static, AgentResult<Value>> {
        let source = self.source.clone();
        Box::pin(async move { Ok(connection_catalog(&source().await?)) })
    }

    fn acquire(&self, route: Option<String>) -> LocalBoxFuture<'static, AgentResult<Value>> {
        let (source, leases) = (self.source.clone(), self.leases.clone());
        Box::pin(async move {
            let connections = source().await?;
            let selected = match route.as_deref() {
                Some(route) => {
                    let route = parse_model_route(Some(route))?;
                    connections
                        .iter()
                        .find(|c| {
                            product_connection_id(&c.id) == route.connection_id
                                && c.model == route.model_id
                        })
                        .ok_or_else(|| connection_error("MODEL_UNAVAILABLE"))?
                }
                None => connections
                    .first()
                    .ok_or_else(|| connection_error("CONNECTION_UNAVAILABLE"))?,
            };
            // The route is validated as the product writes it.
            model_route(&product_connection_id(&selected.id), &selected.model)?;
            let members: Vec<&ModelConnection> =
                connections.iter().filter(|c| c.id == selected.id).collect();
            let lease_id = uuid::Uuid::new_v4().to_string();
            leases.borrow_mut().insert(
                lease_id.clone(),
                Lease {
                    connection_id: selected.id.clone(),
                    security_generation: selected.generation.clone(),
                },
            );
            Ok(json!({
                "leaseId": lease_id,
                "configuration": lease_configuration(&members, selected),
            }))
        })
    }

    fn validate(
        &self,
        lease_id: String,
        route: Option<String>,
    ) -> LocalBoxFuture<'static, AgentResult<()>> {
        let (source, leases) = (self.source.clone(), self.leases.clone());
        Box::pin(async move {
            let (connection_id, generation) = match leases.borrow().get(&lease_id) {
                Some(lease) => (
                    lease.connection_id.clone(),
                    lease.security_generation.clone(),
                ),
                None => return Err(connection_error("LEASE_REVOKED")),
            };
            let connections = source().await?;
            let current = connections.iter().find(|c| c.id == connection_id);
            match current {
                Some(current) if current.generation == generation => {}
                Some(_) => return Err(connection_error("MODEL_BINDING_CHANGED")),
                None => return Err(connection_error("CONNECTION_UNAVAILABLE")),
            }
            if let Some(route) = route.as_deref() {
                let route = parse_model_route(Some(route))?;
                if !connections.iter().any(|c| {
                    c.id == connection_id
                        && product_connection_id(&c.id) == route.connection_id
                        && c.model == route.model_id
                }) {
                    return Err(connection_error("MODEL_UNAVAILABLE"));
                }
            }
            Ok(())
        })
    }

    fn release(&self, lease_id: String) -> LocalBoxFuture<'static, AgentResult<()>> {
        self.leases.borrow_mut().remove(&lease_id);
        Box::pin(async { Ok(()) })
    }
}

/// The connection a lease's configuration names, from `connections`.
pub fn resolve_leased_connection(
    configuration: &Value,
    model_id: &str,
    connections: &[ModelConnection],
) -> AgentResult<ModelConnection> {
    let connection_id = configuration["connectionId"].as_str().unwrap_or_default();
    let generation = configuration["securityGeneration"]
        .as_str()
        .unwrap_or_default();
    let matching: Vec<&ModelConnection> = connections
        .iter()
        .filter(|c| product_connection_id(&c.id) == connection_id)
        .collect();
    if matching.is_empty() {
        return Err(connection_error("CONNECTION_UNAVAILABLE"));
    }
    if matching.iter().any(|c| c.generation != generation) {
        return Err(connection_error("MODEL_BINDING_CHANGED"));
    }
    matching
        .into_iter()
        .find(|c| c.model == model_id)
        .cloned()
        .ok_or_else(|| connection_error("MODEL_UNAVAILABLE"))
}
