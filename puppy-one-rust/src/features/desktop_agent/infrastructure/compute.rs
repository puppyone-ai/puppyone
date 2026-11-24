//! What Chat reads of the app's model connections (`useModelConnections`):
//! each ready connection's source and PuppyOne compute's state, projected
//! directly from the unified [`crate::features::model_connections::ModelConnectionsStore`].
use crate::agent::model_connections::{ManagedComputeSnapshot, ModelConnectionSnapshot};
use crate::agent::runtimes::puppyone_agent::native_model_connections::catalog_revision;
use gpui::App;
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

    /// Direct projection from the `po-agent` authority snapshot.
    pub(crate) fn of_snapshot(snap: &ManagedComputeSnapshot, sign_in_failed: bool) -> Self {
        Self {
            signed_in: snap.signed_in,
            available: snap.available,
            reason: snap.reason.key(),
            error_code: snap.error_code.map(|c| c.key()),
            trial_credit_micro_usd: snap.trial_credit_micro_usd,
            pending: snap.pending,
            sign_in_failed,
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

/// Projects the unified `po-agent` snapshot into the Chat panel's display model
/// without any blocking disk or network I/O.
pub(crate) fn project_compute_snapshot(
    snap: &ModelConnectionSnapshot,
    sign_in_failed: bool,
) -> ComputeSnapshot {
    let connections = snap.agent_connections();
    ComputeSnapshot {
        revision: catalog_revision(&connections),
        sources: snap.ready_sources(),
        managed: Some(ManagedCompute::of_snapshot(&snap.managed, sign_in_failed)),
    }
}

/// Reads the current snapshot from the app's unified store without blocking.
pub(crate) fn current_compute_snapshot(cx: &App, sign_in_failed: bool) -> Option<ComputeSnapshot> {
    crate::features::model_connections::snapshot(cx)
        .map(|snap| project_compute_snapshot(&snap, sign_in_failed))
}
