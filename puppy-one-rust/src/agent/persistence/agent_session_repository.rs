//! `persistence/agent-session-repository.mjs`: process-local replay events
//! joined with the durable metadata-only native-session catalog. The event
//! cache wins while the process is alive; the catalog is the restart
//! boundary and never receives transcript payloads.
use super::agent_conversation_catalog::{AgentConversationCatalog, ReconcileScope};
use crate::agent::agent_error::AgentResult;
use crate::agent::application::ports::{HistoryCatalog, Pending, SessionCache};
use crate::agent::cache::ephemeral_agent_session_cache::EphemeralAgentSessionCache;
use crate::agent::contract::js::{self, Obj};
use serde_json::Value;
use std::rc::Rc;

/// `createAgentSessionRepository({ eventCache, conversationCatalog })`.
#[derive(Clone)]
pub struct AgentSessionRepository {
    event_cache: EphemeralAgentSessionCache,
    catalog: AgentConversationCatalog,
}

impl AgentSessionRepository {
    pub fn new(event_cache: EphemeralAgentSessionCache, catalog: AgentConversationCatalog) -> Self {
        Self {
            event_cache,
            catalog,
        }
    }

    /// `repository.save(record, { promoteCatalog })`.
    pub async fn save(&self, record: &Value, promote_catalog: bool) -> AgentResult<()> {
        let promoted = js::with(record, "availability", "available");
        let (cached, catalogued) = futures_util::join!(self.event_cache.save(record), async {
            if promote_catalog {
                self.catalog.save(&promoted).await.map(drop)
            } else {
                Ok(())
            }
        });
        cached?;
        catalogued
    }

    /// `repository.upsertNative(record)`.
    pub async fn upsert_native(&self, record: &Value) -> AgentResult<Value> {
        self.catalog.upsert_native(record).await
    }

    /// `repository.reconcileNative(scope)`.
    pub async fn reconcile_native(&self, scope: ReconcileScope) -> AgentResult<Value> {
        self.catalog.reconcile_native(scope).await
    }

    /// `repository.markUnavailable(sessionId, unavailableAt)`.
    pub async fn mark_unavailable(
        &self,
        session_id: &str,
        unavailable_at: Option<String>,
    ) -> AgentResult<bool> {
        self.catalog
            .mark_unavailable(session_id, unavailable_at)
            .await
    }

    /// `repository.findById(sessionId, workspaceRoot)`: availability
    /// belongs to the durable catalog; the replay cache deliberately does
    /// not model History lifecycle state.
    pub async fn find_by_id(
        &self,
        session_id: &str,
        workspace_root: Option<&str>,
    ) -> AgentResult<Option<Value>> {
        let (live, catalogued) = futures_util::join!(
            self.event_cache.find_by_id(session_id, workspace_root),
            self.catalog.find_by_id(session_id, workspace_root),
        );
        let catalogued = catalogued?;
        Ok(match (live, catalogued) {
            (None, catalogued) => catalogued,
            (Some(live), None) => Some(live),
            (Some(live), Some(catalogued)) => Some(
                Obj::from(&catalogued)
                    .spread(&live)
                    .set(
                        "availability",
                        catalogued
                            .get("availability")
                            .cloned()
                            .unwrap_or(Value::Null),
                    )
                    .build(),
            ),
        })
    }

    /// `repository.findLatest(workspaceRoot, runtimeId)`.
    pub async fn find_latest(
        &self,
        workspace_root: &str,
        runtime_id: Option<&str>,
    ) -> AgentResult<Option<Value>> {
        if let Some(live) = self
            .event_cache
            .find_latest(workspace_root, runtime_id)
            .await
        {
            return Ok(Some(live));
        }
        self.catalog.find_latest(workspace_root, runtime_id).await
    }

    /// `repository.list(workspaceRoot, options)`.
    pub async fn list(
        &self,
        workspace_root: Option<&str>,
        options: &Value,
    ) -> AgentResult<Vec<Value>> {
        self.catalog.list(workspace_root, options).await
    }

    /// `repository.archive(sessionId, archivedAt)`.
    pub async fn archive(&self, session_id: &str, archived_at: Option<String>) -> AgentResult<()> {
        let (_, archived) = futures_util::join!(
            self.event_cache.archive(session_id, archived_at.clone()),
            self.catalog.archive(session_id, archived_at),
        );
        archived.map(drop)
    }

    /// `repository.remove(sessionId)`.
    pub async fn remove(&self, session_id: &str) -> AgentResult<()> {
        let (_, removed) = futures_util::join!(
            self.event_cache.remove(session_id),
            self.catalog.remove(session_id),
        );
        removed.map(drop)
    }

    /// `repository.readAll()`.
    pub async fn read_all(&self) -> Vec<Value> {
        self.event_cache.read_all().await
    }

    /// `repository.clear()`.
    pub fn clear(&self) {
        self.event_cache.clear();
    }
}

impl SessionCache for AgentSessionRepository {
    fn supports(&self, method: &str) -> bool {
        matches!(method, "bindNative" | "markUnavailable")
    }
    fn save(&self, record: Value, promote_catalog: bool) -> Pending<()> {
        let repository = self.clone();
        Box::pin(async move { repository.save(&record, promote_catalog).await })
    }
    fn find_by_id(
        &self,
        session_id: String,
        workspace_root: Option<String>,
    ) -> Pending<Option<Value>> {
        let repository = self.clone();
        Box::pin(async move {
            repository
                .find_by_id(&session_id, workspace_root.as_deref())
                .await
        })
    }
    fn find_latest(
        &self,
        workspace_root: String,
        runtime_id: Option<String>,
    ) -> Pending<Option<Value>> {
        let repository = self.clone();
        Box::pin(async move {
            repository
                .find_latest(&workspace_root, runtime_id.as_deref())
                .await
        })
    }
    #[cfg(test)]
    fn list(&self, workspace_root: String, options: Value) -> Pending<Vec<Value>> {
        let repository = self.clone();
        Box::pin(async move {
            let root = Some(workspace_root.as_str()).filter(|root| !root.is_empty());
            repository.list(root, &options).await
        })
    }
    fn archive(&self, session_id: String, archived_at: String) -> Pending<()> {
        let repository = self.clone();
        Box::pin(async move {
            repository
                .archive(&session_id, Some(archived_at).filter(|a| !a.is_empty()))
                .await
        })
    }
    fn remove(&self, session_id: String) -> Pending<()> {
        let repository = self.clone();
        Box::pin(async move { repository.remove(&session_id).await })
    }
    fn bind_native(&self, record: Value) -> Pending<Value> {
        let catalog = self.catalog.clone();
        Box::pin(async move { catalog.bind_native(&record).await })
    }
    fn mark_unavailable(&self, session_id: String) -> Pending<()> {
        let repository = self.clone();
        Box::pin(async move {
            repository
                .mark_unavailable(&session_id, None)
                .await
                .map(drop)
        })
    }
    fn history_catalog(&self) -> Option<Rc<dyn HistoryCatalog>> {
        Some(Rc::new(self.catalog.clone()))
    }
}
