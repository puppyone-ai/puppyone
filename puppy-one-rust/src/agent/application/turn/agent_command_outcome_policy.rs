//! `application/turn/agent-command-outcome-policy.mjs`: native request
//! failures are either authoritative rejections or ambiguous delivery
//! failures. Only the native boundary may mark delivery as unknown;
//! message-text guessing would make protocol and mock behavior diverge.
use crate::agent::agent_error::AgentError;

/// `isAgentDeliveryOutcomeUnknown(error)`.
pub fn is_agent_delivery_outcome_unknown(error: &AgentError) -> bool {
    error.delivery_outcome.as_deref() == Some("unknown")
        || matches!(
            error.code.as_deref(),
            Some(
                "JSONL_RPC_TIMEOUT"
                    | "JSONL_RPC_DELIVERY_UNKNOWN"
                    | "PI_RPC_TIMEOUT"
                    | "PI_RPC_DELIVERY_UNKNOWN"
            )
        )
}

/// `agentDeliveryOutcomeUnknownError(message)`.
pub fn agent_delivery_outcome_unknown_error(message: &str) -> AgentError {
    let mut error = AgentError::coded("AGENT_DELIVERY_UNKNOWN", message)
        .with_name("AgentDeliveryOutcomeUnknownError");
    error.delivery_outcome = Some("unknown".into());
    error
}
