//! `runtimes/puppyone-agent/model-connection-binding.mjs`: a session's
//! lease on one model connection, and the worker launch that receives the
//! connection's private configuration over a dedicated pipe.
use super::puppyone_agent_environment::strip_puppyone_provider_credentials;
use crate::agent::agent_error::AgentResult;
use crate::agent::protocols::pi_rpc::pi_rpc_client::{PiClient, PiClientOptions, PiRpcClient};
use crate::agent::transports::jsonl_rpc_connection::{
    ConnectionOptions, Spawner, spawn_managed_process,
};
use crate::model_connections::schema::{connection_error, model_route, parse_model_route};
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::rc::Rc;

/// The model-connection authority the Built-in Agent leases from.
pub trait ModelConnectionPort {
    /// `port.read()`: the connections snapshot.
    fn read(&self) -> LocalBoxFuture<'static, AgentResult<Value>>;
    /// `port.acquire(route)`: `{ leaseId, configuration }`.
    fn acquire(&self, _route: Option<String>) -> LocalBoxFuture<'static, AgentResult<Value>> {
        Box::pin(async { Err(connection_error("AUTHORITY_REQUIRED")) })
    }
    /// `port.validate(leaseId, route)`.
    fn validate(
        &self,
        _lease_id: String,
        _route: Option<String>,
    ) -> LocalBoxFuture<'static, AgentResult<()>> {
        Box::pin(async { Err(connection_error("AUTHORITY_REQUIRED")) })
    }
    /// `port.release(leaseId)`.
    fn release(&self, _lease_id: String) -> LocalBoxFuture<'static, AgentResult<()>> {
        Box::pin(async { Ok(()) })
    }
}

/// `connectionModels(snapshot)`: ready, current, text-and-tools models.
pub fn connection_models(snapshot: &Value) -> AgentResult<Vec<Value>> {
    let empty = Vec::new();
    let catalogs = snapshot["catalogs"].as_array().unwrap_or(&empty);
    let mut models = Vec::new();
    for connection in snapshot["connections"].as_array().unwrap_or(&empty) {
        let id = connection["id"].as_str().unwrap_or("");
        let Some(catalog) = catalogs.iter().find(|entry| entry["connectionId"] == id) else {
            continue;
        };
        if catalog["status"] != "ready"
            || catalog["configGeneration"] != connection["configGeneration"]
        {
            continue;
        }
        if connection["driver"] == "unsloth" && connection["serverToolsDisabled"] != true {
            continue;
        }
        for model in catalog["models"].as_array().unwrap_or(&empty) {
            if model["available"] != true
                || !crate::agent::contract::js::truthy(&model["contextWindow"])
                || model["capabilities"]["text"] != "supported"
                || model["capabilities"]["tools"] != "supported"
            {
                continue;
            }
            let model_id = model["id"].as_str().unwrap_or("");
            let route = model_route(id, model_id)?;
            models.push(json!({
                "id": route,
                "model": route,
                "modelId": model["id"],
                "providerId": id,
                "connectionId": id,
                "displayName": model["name"],
                "description": connection["name"],
                "isDefault": connection["defaultModelId"] == model["id"],
                "contextWindow": model["contextWindow"],
                "modelCapabilities": model["capabilities"],
                "variants": [],
                "defaultVariant": null,
            }));
        }
    }
    Ok(models)
}

/// `spawnWithModelConfiguration(configuration, spawn)`: the configuration
/// travels over a private pipe (fd 3) that closes after one bounded
/// envelope, never argv, the environment, RPC history or a file.
pub fn spawn_with_model_configuration(configuration: Value, spawn: Option<Spawner>) -> Spawner {
    let payload = configuration.to_string().into_bytes();
    Rc::new(move |options: &ConnectionOptions| {
        let mut options = options.clone();
        let env: crate::agent::discovery::command_environment::EnvMap = options
            .env
            .clone()
            .unwrap_or_default()
            .into_iter()
            .collect();
        let mut env = strip_puppyone_provider_credentials(&env);
        env.insert("PUPPYONE_MODEL_CONNECTION_BOOTSTRAP".into(), "1".into());
        env.insert("PI_OFFLINE".into(), "1".into());
        options.env = Some(env.into_iter().collect());
        options.bootstrap = Some(payload.clone());
        match spawn.as_ref() {
            Some(spawn) => spawn(&options),
            None => spawn_managed_process(&options),
        }
    })
}

/// `createModelConnectionBinding(port)`.
pub struct ModelConnectionBinding {
    port: Rc<dyn ModelConnectionPort>,
    lease: RefCell<Option<Value>>,
    disposed: Cell<bool>,
    read_only: Cell<bool>,
}

impl ModelConnectionBinding {
    pub fn new(port: Rc<dyn ModelConnectionPort>) -> Rc<Self> {
        Rc::new(Self {
            port,
            lease: RefCell::default(),
            disposed: Cell::new(false),
            read_only: Cell::new(false),
        })
    }

    /// `binding.configuration`.
    pub fn configuration(&self) -> Option<Value> {
        self.lease
            .borrow()
            .as_ref()
            .map(|lease| lease["configuration"].clone())
    }

    /// `binding.enableReadOnly()`.
    pub fn enable_read_only(&self) -> AgentResult<()> {
        if self.lease.borrow().is_some() {
            return Err(connection_error("AUTHORITY_REQUIRED"));
        }
        self.read_only.set(true);
        Ok(())
    }

    /// `binding.acquire(route)`.
    pub async fn acquire(&self, route: Option<&str>) -> AgentResult<()> {
        if self.disposed.get() {
            return Err(connection_error("LEASE_REVOKED"));
        }
        if self.lease.borrow().is_some() {
            return self.validate(route).await;
        }
        let acquired = self.port.acquire(route.map(str::to_string)).await?;
        if self.disposed.get() {
            let _ = self
                .port
                .release(crate::agent::contract::js::to_js_string(
                    acquired.get("leaseId"),
                ))
                .await;
            return Err(connection_error("LEASE_REVOKED"));
        }
        *self.lease.borrow_mut() = Some(acquired);
        Ok(())
    }

    /// `binding.validate(route)`.
    pub async fn validate(&self, route: Option<&str>) -> AgentResult<()> {
        let lease = self.lease.borrow().clone();
        let Some(lease) = lease.filter(|_| !self.disposed.get()) else {
            return Err(connection_error("LEASE_REVOKED"));
        };
        let selection = parse_model_route(route)?;
        let configuration = &lease["configuration"];
        if configuration["connectionId"] != selection.connection_id.as_str() {
            return Err(connection_error("NEW_SESSION_REQUIRED"));
        }
        let available = configuration["models"].as_array().is_some_and(|models| {
            models
                .iter()
                .any(|m| m["id"] == selection.model_id.as_str())
        });
        if !available {
            return Err(connection_error("MODEL_UNAVAILABLE"));
        }
        self.port
            .validate(
                crate::agent::contract::js::to_js_string(lease.get("leaseId")),
                route.map(str::to_string),
            )
            .await
    }

    /// `binding.createClient(options)`.
    pub fn create_client(&self, mut options: PiClientOptions) -> AgentResult<Rc<dyn PiClient>> {
        let env: crate::agent::discovery::command_environment::EnvMap = options
            .env
            .clone()
            .unwrap_or_default()
            .into_iter()
            .collect();
        if self.read_only.get() && !self.disposed.get() {
            let mut env = strip_puppyone_provider_credentials(&env);
            env.insert("PUPPYONE_MODEL_CONNECTION_READ_ONLY".into(), "1".into());
            env.insert("PI_OFFLINE".into(), "1".into());
            options.env = Some(env.into_iter().collect());
            return Ok(Rc::new(PiRpcClient::spawn(options)?));
        }
        let lease = self.lease.borrow().clone();
        let Some(lease) = lease.filter(|_| !self.disposed.get()) else {
            return Err(connection_error("AUTHORITY_REQUIRED"));
        };
        let configuration = lease["configuration"].clone();
        options.spawner = Some(spawn_with_model_configuration(
            configuration.clone(),
            options.spawner.clone(),
        ));
        options.sensitive_values = configuration["apiKey"]
            .as_str()
            .filter(|key| !key.is_empty())
            .map(|key| vec![key.to_string()])
            .unwrap_or_default();
        Ok(Rc::new(PiRpcClient::spawn(options)?))
    }

    /// `binding.dispose()`.
    pub async fn dispose(&self) -> AgentResult<()> {
        self.disposed.set(true);
        let previous = self.lease.borrow_mut().take();
        if let Some(previous) = previous {
            self.port
                .release(crate::agent::contract::js::to_js_string(
                    previous.get("leaseId"),
                ))
                .await?;
        }
        Ok(())
    }
}
