//! What Chat reads of the app's model connections (`useModelConnections`):
//! each ready connection's source and PuppyOne compute's state, read from
//! the Built-in Agent's connection catalog.
use crate::agent::contract::dto::Model;
use crate::agent::model_connections::ComputeAccount as _;
use crate::agent::model_connections::configuration;
use crate::agent::runtimes::puppyone_agent::native_model_connections::{
    catalog_revision, product_connection_id,
};
use std::collections::HashMap;

/// `snapshot.managed`: PuppyOne compute for the signed-in account.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ManagedCompute {
    pub signed_in: bool,
    pub available: bool,
    /// `"ready"`, `"loading"`, `"gateway-unavailable"`,
    /// `"sign-in-required"` or `"insufficient-credit"`.
    pub reason: &'static str,
    /// `errorCode`: why the last refresh failed.
    pub error_code: Option<&'static str>,
    /// `trialCreditMicroUsd`: the server's one-time credit per account.
    pub trial_credit_micro_usd: i64,
    /// A refresh is in flight (`state.pending.managed`).
    pub pending: bool,
    /// The last browser sign-in could not start (`AUTHENTICATION_FAILED`).
    pub sign_in_failed: bool,
}

impl ManagedCompute {
    /// The app's compute wallet as Chat reads it.
    pub(crate) fn of(wallet: &crate::features::model_connections::ComputeWallet) -> Self {
        let reason = wallet.reason();
        Self {
            signed_in: wallet.signed_in(),
            available: reason == crate::features::model_connections::ComputeReason::Ready,
            reason: reason.key(),
            error_code: wallet.error_code().map(|c| c.key()),
            trial_credit_micro_usd: wallet.trial_credit_micro_usd(),
            pending: wallet.pending,
            sign_in_failed: wallet.sign_in_failed,
        }
    }
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

impl ComputeSnapshot {
    /// The source kind of `model`'s connection, while it is ready.
    pub fn source(&self, model: &Model) -> Option<&'static str> {
        self.sources.get(model.connection_id.as_deref()?).copied()
    }
    /// The name of the connection `id`.
    pub fn name(&self, id: &str) -> Option<&str> {
        self.names.get(id).map(String::as_str)
    }
    /// The brand mark of the connection `id`.
    pub fn mark(&self, id: &str) -> Option<(&'static str, bool)> {
        self.marks.get(id).copied()
    }
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
/// (throttled per connection); `true` when one was saved. The reads block
/// on the network (up to 15s), so they run on a thread of their own, not on
/// GPUI's shared background executor.
pub(crate) async fn sync_offered_models() -> bool {
    let (tx, rx) = async_channel::bounded(1);
    crate::localization::spawn(move || {
        let _ = tx.send_blocking(crate::features::model_connections::sync_offered());
    });
    rx.recv().await.unwrap_or(false)
}

/// Reads the connections (blocking: the configuration file and PuppyOne
/// compute's cached catalog). The wallet's state is the app's
/// ([`ManagedCompute::of`]), which the panel follows.
pub(crate) fn read_compute_snapshot() -> ComputeSnapshot {
    let mut connections: Vec<configuration::ModelConnection> = configuration::load()
        .unwrap_or_default()
        .iter()
        .flat_map(configuration::ModelConnection::members)
        .collect();
    let account = super::host::agent_host_global::CloudCompute;
    connections.extend(configuration::managed(&account));
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
        managed: None,
    }
}
