//! `protocols/acp/acp-methods.mjs`: ACP method names and their legacy
//! aliases.
use crate::agent::agent_error::{AgentError, AgentResult};
use std::collections::HashMap;

pub const ACP_PROTOCOL_VERSION: i64 = 1;

const METHOD_CANDIDATES: &[(&str, &[&str])] = &[
    ("initialize", &["initialize"]),
    ("authenticate", &["authenticate"]),
    ("newSession", &["session/new", "newSession"]),
    ("loadSession", &["session/load", "loadSession"]),
    ("resumeSession", &["session/resume", "resumeSession"]),
    ("listSessions", &["session/list", "listSessions"]),
    ("closeSession", &["session/close", "closeSession"]),
    ("forkSession", &["session/fork", "forkSession"]),
    ("deleteSession", &["session/delete", "deleteSession"]),
    ("prompt", &["session/prompt", "prompt"]),
    ("cancel", &["session/cancel", "cancel"]),
    ("setModel", &["session/set_model", "setSessionModel"]),
    ("setMode", &["session/set_mode", "setSessionMode"]),
    (
        "setConfigOption",
        &["session/set_config_option", "setSessionConfigOption"],
    ),
];

/// `ACP_SERVER_NOTIFICATION_ALIASES.sessionUpdate`.
pub const SESSION_UPDATE_ALIASES: &[&str] = &["session/update", "sessionUpdate"];

/// `ACP_SERVER_REQUEST_ALIASES`.
pub mod request_aliases {
    pub const REQUEST_PERMISSION: &[&str] = &["session/request_permission", "requestPermission"];
    pub const READ_TEXT_FILE: &[&str] = &["fs/read_text_file", "fs/readTextFile"];
    pub const WRITE_TEXT_FILE: &[&str] = &["fs/write_text_file", "fs/writeTextFile"];
}

/// `methodOverrides`: a logical method's explicit native names.
pub type MethodOverrides = HashMap<String, Vec<String>>;

/// `acpMethodCandidates(logicalMethod, overrides)`.
pub fn acp_method_candidates(
    logical_method: &str,
    overrides: &MethodOverrides,
) -> AgentResult<Vec<String>> {
    if let Some(names) = overrides
        .get(logical_method)
        .filter(|names| !names.is_empty())
    {
        return Ok(names.iter().filter(|n| !n.is_empty()).cloned().collect());
    }
    METHOD_CANDIDATES
        .iter()
        .find(|(method, _)| *method == logical_method)
        .map(|(_, candidates)| candidates.iter().map(|c| c.to_string()).collect())
        .ok_or_else(|| AgentError::new(format!("Unknown ACP logical method: {logical_method}")))
}
