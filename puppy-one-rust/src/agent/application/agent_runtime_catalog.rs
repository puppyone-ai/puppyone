//! `application/agent-runtime-catalog.mjs`: the renderer-safe catalog
//! facade over the authoritative Main resolver.
use super::runtime_resolution::runtime_readiness_store::DEFAULT_SUCCESS_TTL_MS;
use super::runtime_resolution::runtime_resolution_coordinator::RuntimeResolutionCoordinator;
use crate::agent::agent_error::AgentResult;
use serde_json::Value;

pub const INSPECTION_CACHE_TTL_MS: i64 = DEFAULT_SUCCESS_TTL_MS;

#[derive(Clone)]
pub struct AgentRuntimeCatalog {
    coordinator: RuntimeResolutionCoordinator,
}

impl AgentRuntimeCatalog {
    pub fn new(coordinator: RuntimeResolutionCoordinator) -> Self {
        Self { coordinator }
    }
    pub async fn discover(
        &self,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        self.coordinator
            .query_catalog(request, workspace_root)
            .await
    }
    pub async fn list_models(
        &self,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        Ok(self
            .coordinator
            .query_catalog(request, workspace_root)
            .await?["models"]
            .clone())
    }
    pub async fn read_account(
        &self,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        Ok(self
            .coordinator
            .query_catalog(request, workspace_root)
            .await?["account"]
            .clone())
    }
    pub fn clear(&self) -> u64 {
        self.coordinator.clear()
    }
}
