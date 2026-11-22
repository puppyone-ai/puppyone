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
    /// Each ready connection's source kind (`managed`, `oauth`, `api` or `local`).
    pub sources: HashMap<String, &'static str>,
    /// Each ready connection's brand mark under `assets/providers/` and
    /// whether it is one colour (`providers::Provider::mark`).
    pub marks: HashMap<String, (&'static str, bool)>,
    /// Each connection's name, shown under its models in Chat's picker so
    /// models from several services (Ollama, MLX…) tell apart.
    pub names: HashMap<String, String>,
    pub managed: Option<ManagedCompute>,
}

/// PuppyOne compute for Settings: `(signed in, credit available)`, or
/// `None` while Payments is off and compute is not offered (blocking: the
/// account's cached directory).
pub fn read_managed_status() -> Option<(bool, bool)> {
    let account = super::host::agent_host_global::CloudCompute;
    let signed_in = account.current().is_some();
    let available = signed_in && !configuration::managed(&account).is_empty();
    Some((signed_in, available))
}

/// Brings every connection's Chat models up to its service's catalog
/// (blocking, throttled per connection); `true` when one was saved.
pub(crate) fn sync_offered_models() -> bool {
    crate::features::model_connections::sync_offered()
}

/// Reads the connections (blocking: the configuration file and PuppyOne
/// compute's cached catalog).
pub(crate) fn read_compute_snapshot() -> ComputeSnapshot {
    let mut connections: Vec<configuration::ModelConnection> = configuration::load()
        .unwrap_or_default()
        .iter()
        .flat_map(configuration::ModelConnection::members)
        .collect();
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
                } else if c.auth == configuration::Auth::Oauth {
                    "oauth"
                } else {
                    c.source_kind.key()
                };
                (product_connection_id(&c.id), kind)
            })
            .collect(),
        marks: connections
            .iter()
            .filter_map(|c| {
                let provider = c.provider()?;
                Some((
                    product_connection_id(&c.id),
                    (provider.mark?, provider.monochrome),
                ))
            })
            .collect(),
        names: connections
            .iter()
            .map(|c| (product_connection_id(&c.id), c.name.clone()))
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
