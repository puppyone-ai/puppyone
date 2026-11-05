//! `domain/agent-degraded-recovery.ts`.
use crate::agent::contract::display_types::AgentDisplay;
use serde_json::Value;

/// `ActiveAgentDegradedRecovery`.
#[derive(Clone, Debug, PartialEq)]
pub struct ActiveAgentDegradedRecovery {
    pub turn_id: String,
    pub recovery: Value,
}

/// `activeAgentDegradedRecovery(projection)`: only the latest settled turn
/// may offer an active continuation action.
pub fn active_agent_degraded_recovery(
    projection: &AgentDisplay,
) -> Option<ActiveAgentDegradedRecovery> {
    if projection
        .running_turn_id()
        .is_some_and(|id| !id.is_empty())
    {
        return None;
    }
    let latest = projection.turns.last()?;
    if latest["status"] != "completed"
        || latest["completionQuality"] != "degraded"
        || latest["recovery"]["kind"] != "degraded-completion"
    {
        return None;
    }
    Some(ActiveAgentDegradedRecovery {
        turn_id: latest["id"].as_str().unwrap_or_default().to_string(),
        recovery: latest["recovery"].clone(),
    })
}
