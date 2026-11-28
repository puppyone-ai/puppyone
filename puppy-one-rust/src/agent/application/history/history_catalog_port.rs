//! `application/history/history-catalog-port.mjs`: only metadata
//! operations are granted to History query handlers. The port is the
//! catalog trait itself ([`HistoryCatalog`]); a missing catalog answers
//! every call with "History catalog is unavailable."
use super::super::ports::{Guard, HistoryCatalog, Pending};
use crate::agent::agent_error::AgentError;
use serde_json::Value;
use std::rc::Rc;

/// `createHistoryCatalogPort(catalog)`.
pub fn create_history_catalog_port(
    catalog: Option<Rc<dyn HistoryCatalog>>,
) -> Rc<dyn HistoryCatalog> {
    match catalog {
        Some(catalog) => catalog,
        None => Rc::new(Unavailable),
    }
}

struct Unavailable;

fn unavailable<T: 'static>() -> Pending<T> {
    Box::pin(async { Err(AgentError::new("History catalog is unavailable.")) })
}

impl HistoryCatalog for Unavailable {
    fn list(&self, _workspace_root: String, _options: Value) -> Pending<Vec<Value>> {
        unavailable()
    }
    fn get_revision(&self) -> Pending<i64> {
        unavailable()
    }
    fn get_coverage(&self) -> Pending<Value> {
        unavailable()
    }
    fn apply_native_page(
        &self,
        _entries: Vec<Value>,
        _scope: Value,
        _reconcile_missing: bool,
        _guard: Guard,
    ) -> Pending<Value> {
        unavailable()
    }
}
