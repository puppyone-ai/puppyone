//! `ui/agent-history-presentation.ts`: local replay gaps do not establish
//! that native chat messages were lost.
use crate::agent::contract::display_types::AgentDisplay;

/// `agentHistoryNotice(display)`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentHistoryNotice {
    pub kind: String,
    pub message_key: &'static str,
    pub reason_keys: Vec<&'static str>,
}

pub fn agent_history_notice(display: &AgentDisplay) -> Option<AgentHistoryNotice> {
    let history = display.get("history").cloned().unwrap_or_default();
    let truncated = display
        .get("displayWindow")
        .is_some_and(|window| window["truncated"] == true);
    let coverage = history["coverage"].as_str().unwrap_or_default();
    let limited = coverage == "partial" || coverage == "unknown";
    if !truncated && !limited {
        return None;
    }
    let mut reason_keys = Vec::new();
    if truncated {
        reason_keys.push("agent.transcript.historyReason.displayWindow");
    }
    if limited {
        reason_keys.push(match history["reason"].as_str().unwrap_or("unverified") {
            "read-limit" => "agent.transcript.historyReason.readLimit",
            "unsupported" => "agent.transcript.historyReason.unsupported",
            _ => "agent.transcript.historyReason.unverified",
        });
    }
    Some(AgentHistoryNotice {
        kind: if truncated {
            "window".into()
        } else {
            coverage.to_string()
        },
        message_key: if truncated {
            "agent.transcript.historyWindow"
        } else if coverage == "partial" {
            "agent.transcript.historyPartial"
        } else {
            "agent.transcript.historyUnknown"
        },
        reason_keys,
    })
}
