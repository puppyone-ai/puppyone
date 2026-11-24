//! What Chat reads of the app's model connections (`useModelConnections`):
//! each ready connection's source and PuppyOne compute's state, read from
//! the Built-in Agent's connection catalog.
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
    /// Each ready connection's source kind (`managed`, `api` or `local`).
    pub sources: HashMap<String, &'static str>,
    pub managed: Option<ManagedCompute>,
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
                } else {
                    c.source_kind.key()
                };
                (product_connection_id(&c.id), kind)
            })
            .collect(),
        managed: None,
    }
}
