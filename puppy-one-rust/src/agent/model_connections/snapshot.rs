//! Immutable authority snapshot published by [`super::service::ModelConnectionService`]:
//! custom saved connections, probed catalogs, PuppyOne managed compute wallet
//! state, and the derived list of eligible Built-in Agent routes.
use super::configuration::{Driver, ModelConnection};
use super::drivers::CatalogModel;
use super::wallet::{Balance, Catalog, ErrorCode, Reason, Usage};
use std::collections::HashMap;

/// Observation status of one custom model connection's remote/local catalog.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CatalogStatus {
    #[default]
    Idle,
    Refreshing,
    Ready,
    Stale,
    Failed,
}
impl CatalogStatus {
    pub fn key(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Refreshing => "refreshing",
            Self::Ready => "ready",
            Self::Stale => "stale",
            Self::Failed => "failed",
        }
    }
}

/// Cached catalog observation for one saved custom connection.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConnectionCatalog {
    pub connection_id: String,
    pub config_generation: String,
    pub status: CatalogStatus,
    pub models: Vec<CatalogModel>,
    pub error_code: Option<String>,
}

/// Public snapshot of the PuppyOne managed compute wallet.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ManagedComputeSnapshot {
    pub signed_in: bool,
    pub available: bool,
    pub reason: Reason,
    pub error_code: Option<ErrorCode>,
    pub catalog: Option<Catalog>,
    pub balance: Option<Balance>,
    pub last_usage: Option<Usage>,
    pub pending: bool,
    pub trial_credit_micro_usd: i64,
    pub session_key: Option<String>,
    pub checkout_failed: bool,
}
impl ManagedComputeSnapshot {
    pub fn failed(&self) -> bool {
        self.error_code.is_some() || self.checkout_failed
    }
}

/// Single authoritative snapshot shared across `AgentHost`, Settings, Account,
/// and Chat panels.
#[derive(Clone, Debug, Default)]
pub struct ModelConnectionSnapshot {
    pub revision: u64,
    pub payments_enabled: bool,
    pub connections: Vec<ModelConnection>,
    pub catalogs: HashMap<String, ConnectionCatalog>,
    pub managed: ManagedComputeSnapshot,
    /// Ready managed compute entries (empty unless `payments_enabled && managed.available`).
    pub managed_connections: Vec<ModelConnection>,
}

impl ModelConnectionSnapshot {
    /// Connections and models eligible for the Built-in Agent right now,
    /// enforcing Connection Rules:
    /// - Unsloth requires `server_tools_disabled == true`;
    /// - Custom models require a non-zero context budget AND tool-support
    ///   evidence (reported by the service or persisted `verify` at the
    ///   connection's current security generation; migrated legacy entries
    ///   retain compatibility until edited);
    /// - Managed models appear only while `payments_enabled && managed.available`,
    ///   carrying the real `context_window` reported by `/ai/catalog`.
    pub fn agent_connections(&self) -> Vec<ModelConnection> {
        let mut eligible = Vec::new();
        for conn in &self.connections {
            if conn.driver == Driver::Unsloth && !conn.server_tools_disabled {
                continue;
            }
            if let Some(catalog) = self.catalogs.get(&conn.id)
                && catalog.config_generation == conn.generation
                && matches!(catalog.status, CatalogStatus::Ready | CatalogStatus::Stale)
            {
                for m in &catalog.models {
                    let context = m.context.or(conn.manual_context_window);
                    let Some(context) = context.filter(|c| *c > 0) else {
                        continue;
                    };
                    let verified = conn.is_verified(&m.id);
                    let tools_supported = verified || m.tools == Some(true);
                    if !tools_supported {
                        continue;
                    }
                    eligible.push(ModelConnection {
                        model: m.id.clone(),
                        manual_context_window: Some(context),
                        images: m.images,
                        ..conn.clone()
                    });
                }
                continue;
            }
            // Before a catalog probe completes, only models with durable
            // verification evidence at the current security generation (or
            // migrated legacy connections) and a context budget are offered.
            if let Some(context) = conn.manual_context_window.filter(|c| *c > 0) {
                let mut seen: Vec<String> = Vec::new();
                for id in [&conn.default_model_id, &conn.manual_model_id]
                    .into_iter()
                    .flatten()
                    .chain(conn.verifications.keys())
                {
                    if seen.contains(id) {
                        continue;
                    }
                    if conn.is_verified(id) || conn.legacy_migrated {
                        seen.push(id.clone());
                        eligible.push(ModelConnection {
                            model: id.clone(),
                            manual_context_window: Some(context),
                            ..conn.clone()
                        });
                    }
                }
            }
        }
        if self.payments_enabled && self.managed.available {
            eligible.extend(self.managed_connections.iter().cloned());
        }
        eligible
    }

    /// Source kind map keyed by product connection id (`mc_<uuid>`) for all
    /// currently eligible connections.
    pub fn ready_sources(&self) -> HashMap<String, &'static str> {
        self.agent_connections()
            .iter()
            .map(|c| {
                let kind = if c.managed {
                    "managed"
                } else {
                    c.source_kind.key()
                };
                (format!("mc_{}", c.id.to_lowercase()), kind)
            })
            .collect()
    }
}
