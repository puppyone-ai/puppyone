//! What Chat reads of the app's model connections (`useModelConnections`):
//! each ready connection's source and PuppyOne compute's state, read from
//! the Built-in Agent's connection catalog.
use crate::agent::model_connections::ComputeAccount as _;
use crate::agent::model_connections::configuration;
use crate::agent::runtimes::puppyone_agent::native_model_connections::{
    catalog_revision, product_connection_id,
};
use std::collections::HashMap;

/// `snapshot.managed`: PuppyOne compute for the signed-in account.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ManagedCompute {
    pub signed_in: bool,
    pub available: bool,
    /// `"ready"`, `"sign-in-required"` or `"insufficient-credit"`.
    pub reason: &'static str,
}

/// What Chat reads of the app's model connections (`useModelConnections`).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ComputeSnapshot {
    pub revision: String,
    /// Each ready connection's source kind (`managed`, `api` or `local`).
    pub sources: HashMap<String, &'static str>,
    pub managed: Option<ManagedCompute>,
}

fn local_endpoint(endpoint: &str) -> bool {
    reqwest::Url::parse(endpoint)
        .is_ok_and(|url| matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
}

/// Reads the connections (blocking: the configuration file and PuppyOne
/// compute's cached catalog).
pub(crate) fn read_compute_snapshot() -> ComputeSnapshot {
    let mut connections = configuration::load().unwrap_or_default();
    let account = super::host::agent_host_global::CloudCompute;
    let managed = configuration::managed(&account);
    let signed_in = account.current().is_some();
    let available = !managed.is_empty();
    connections.extend(managed);
    ComputeSnapshot {
        revision: catalog_revision(&connections),
        sources: connections
            .iter()
            .map(|c| {
                let kind = if c.managed {
                    "managed"
                } else if local_endpoint(&c.endpoint) {
                    "local"
                } else {
                    "api"
                };
                (product_connection_id(&c.id), kind)
            })
            .collect(),
        managed: Some(ManagedCompute {
            signed_in,
            available,
            reason: if !signed_in {
                "sign-in-required"
            } else if !available {
                "insufficient-credit"
            } else {
                "ready"
            },
        }),
    }
}
