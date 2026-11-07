//! The collaborators `createAgentService` is composed from. The product
//! passes duck-typed objects (`sessionCache`, `conversationCatalog`,
//! `attachmentStore`) and probes optional methods with
//! `typeof x.method === "function"`; here each is a trait whose optional
//! methods are named by `supports`.
use crate::agent::agent_error::{AgentError, AgentResult};
use futures_util::future::LocalBoxFuture;
use serde_json::Value;
use std::rc::Rc;

pub type Pending<T> = LocalBoxFuture<'static, AgentResult<T>>;

fn unsupported<T: 'static>(method: &'static str) -> Pending<T> {
    Box::pin(async move { Err(AgentError::new(format!("{method} is unavailable."))) })
}

/// Called by a catalog write between validation and publication; failing
/// it abandons the write (`guard()`).
pub type Guard = Rc<dyn Fn() -> AgentResult<()>>;

/// `sessionCache` (the session repository in production).
pub trait SessionCache {
    /// Whether an optional method exists (`bindNative`, `markUnavailable`).
    fn supports(&self, _method: &str) -> bool {
        false
    }
    /// `cache.save(record, { promoteCatalog })`.
    fn save(&self, record: Value, promote_catalog: bool) -> Pending<()>;
    /// `cache.findById(sessionId, workspaceRoot)`.
    fn find_by_id(
        &self,
        session_id: String,
        workspace_root: Option<String>,
    ) -> Pending<Option<Value>>;
    /// `cache.findLatest(workspaceRoot, runtimeId)`.
    fn find_latest(
        &self,
        workspace_root: String,
        runtime_id: Option<String>,
    ) -> Pending<Option<Value>>;
    /// `cache.list(workspaceRoot, options)`.
    #[cfg(test)]
    fn list(&self, workspace_root: String, options: Value) -> Pending<Vec<Value>>;
    /// `cache.archive(sessionId, archivedAt)`.
    fn archive(&self, session_id: String, archived_at: String) -> Pending<()>;
    /// `cache.remove(sessionId)`.
    fn remove(&self, session_id: String) -> Pending<()>;
    /// `cache.bindNative(record)`: the bound record.
    fn bind_native(&self, _record: Value) -> Pending<Value> {
        unsupported("bindNative")
    }
    /// `cache.markUnavailable(sessionId)`.
    fn mark_unavailable(&self, _session_id: String) -> Pending<()> {
        unsupported("markUnavailable")
    }
    /// `cache.historyCatalog`.
    fn history_catalog(&self) -> Option<Rc<dyn HistoryCatalog>> {
        None
    }
}

/// The metadata-only History catalog operations (`historyCatalog`).
pub trait HistoryCatalog {
    /// Whether `listPage` exists.
    fn supports_list_page(&self) -> bool {
        false
    }
    /// `catalog.listPage(workspaceRoot, options)`.
    fn list_page(&self, _workspace_root: String, _options: Value) -> Pending<Value> {
        unsupported("listPage")
    }
    /// `catalog.list(workspaceRoot, options)`.
    fn list(&self, workspace_root: String, options: Value) -> Pending<Vec<Value>>;
    /// `catalog.getRevision()`.
    fn get_revision(&self) -> Pending<i64>;
    /// `catalog.getCoverage()`.
    fn get_coverage(&self) -> Pending<Value>;
    /// `catalog.applyNativePage({ entries, scope, reconcileMissing, guard })`.
    fn apply_native_page(
        &self,
        entries: Vec<Value>,
        scope: Value,
        reconcile_missing: bool,
        guard: Guard,
    ) -> Pending<Value>;
}

/// The attachment staging store the service and IPC use.
pub trait AttachmentStore {
    /// Whether an optional method exists.
    fn supports(&self, method: &str) -> bool;
    /// `store.releaseLease({ ownerId, workspaceRoot, tokens, leaseId })`.
    fn release_lease(&self, _request: Value) -> Pending<()> {
        unsupported("releaseLease")
    }
    /// `store.revokeLeased(...)`, falling back to `store.revoke(...)`.
    fn revoke(&self, _request: Value) -> Pending<Value> {
        unsupported("revoke")
    }
    /// `store.revokeOwner(ownerId)`.
    fn revoke_owner(&self, _owner_id: u64) -> Pending<()> {
        unsupported("revokeOwner")
    }
    /// `store.revokeWorkspace(ownerId, workspaceRoot)`.
    #[cfg(test)]
    fn revoke_workspace(&self, _owner_id: u64, _workspace_root: String) -> Pending<()> {
        unsupported("revokeWorkspace")
    }
    /// `store.close()`.
    fn close(&self) -> Pending<()> {
        Box::pin(async { Ok(()) })
    }
}

/// `logger`.
pub trait Logger {
    fn warn(&self, message: &str, detail: Value);
}

/// The default logger: diagnostics go to standard error.
pub struct ConsoleLogger;

impl Logger for ConsoleLogger {
    fn warn(&self, message: &str, detail: Value) {
        if detail.is_null() {
            eprintln!("{message}");
        } else {
            eprintln!("{message} {detail}");
        }
    }
}
