//! `domain/agent-degraded-recovery.ts`.
use crate::agent::contract::dto::{AgentProjection, TurnRecovery};

/// `ActiveAgentDegradedRecovery`.
#[derive(Clone, Debug, PartialEq)]
pub struct ActiveAgentDegradedRecovery {
    pub turn_id: String,
    pub recovery: TurnRecovery,
}

/// `activeAgentDegradedRecovery(projection)`: only the latest settled turn
/// may offer an active continuation action.
pub fn active_agent_degraded_recovery(
    projection: &AgentProjection,
) -> Option<ActiveAgentDegradedRecovery> {
    if projection.running_turn().is_some() {
        return None;
    }
    let latest = projection.turns.last()?;
    let recovery = latest.recovery.as_ref()?;
    if latest.status != "completed"
        || latest.completion_quality.as_deref() != Some("degraded")
        || recovery.kind != "degraded-completion"
    {
        return None;
    }
    Some(ActiveAgentDegradedRecovery {
        turn_id: latest.id.clone(),
        recovery: recovery.clone(),
    })
}
