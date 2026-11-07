//! `runtimes/puppyone-agent/puppyone-agent-history-source.mjs`.
use crate::agent::runtime::history_source_scope::local_history_source_scope;
use crate::platform::paths;
use std::path::PathBuf;

/// `puppyOneAgentHistorySource(profilePath)`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PuppyOneAgentHistorySource {
    pub root: PathBuf,
    pub sessions: PathBuf,
    pub source_scope_id: String,
}

/// `puppyOneAgentHistorySource(profilePath)`.
pub fn puppyone_agent_history_source(profile_path: &str) -> PuppyOneAgentHistorySource {
    let root = paths::absolute(profile_path);
    let sessions = root.join("sessions");
    let source_scope_id = local_history_source_scope(
        "puppyone-agent",
        &[
            ("root", Some(root.to_string_lossy().into_owned())),
            ("sessions", Some(sessions.to_string_lossy().into_owned())),
        ],
        &[
            ("root", Some(String::new())),
            ("sessions", Some(String::new())),
        ],
    );
    PuppyOneAgentHistorySource {
        root,
        sessions,
        source_scope_id,
    }
}
