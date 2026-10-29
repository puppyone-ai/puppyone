//! Agent file activity: the optional Hooks that let a local Agent CLI running
//! in a PuppyOne terminal report which workspace files it reads and writes.
//!
//! Ports `shared/agent-activity-contract`, `electron/main/agent-activity` and
//! `electron/main/terminal-agent/activity`:
//! - `registration`: the user-owned Hook entries in `~/.codex/hooks.json`,
//!   `~/.claude/settings.json` and `~/.cursor/hooks.json`, and the bridge
//!   script they run (`bridge-installer.mjs`, `owned-config-mutation.mjs`,
//!   `cursor-cli-hook-config.mjs`, `hook-registration-service.mjs`);
//! - `hook`: the bridge process itself. The product's own executable runs
//!   with [`hook::FLAG`] instead of a Node script (`puppyone-agent-hook.mjs`);
//! - `projector` / `shell_intent`: the payload projection done in the hook
//!   process, so raw provider input never reaches the app;
//! - `adapters`: provider event names to phases and operations;
//! - `transport`: the per-user Unix socket, session tokens and frame policy;
//! - `service` / `path_policy`: claims, leases and workspace containment;
//! - `host`: one process-wide host that prepares terminal sessions.
pub mod adapters;
pub mod hook;
pub mod host;
pub mod path_policy;
pub mod projector;
pub mod registration;
pub mod service;
pub mod shell_intent;
pub mod transport;

use std::{path::PathBuf, time::Duration};

pub const SCHEMA_VERSION: u64 = 1;
/// `AGENT_ACTIVITY_LIMITS`.
pub mod limits {
    use std::time::Duration;
    pub const FRAME_BYTES: usize = 64 * 1024;
    pub const PATH_LENGTH: usize = 4_096;
    pub const PROVIDER_ID_LENGTH: usize = 40;
    pub const STRING_LENGTH: usize = 512;
    pub const TARGETS_PER_ACTIVITY: usize = 32;
    pub const ACTIVE_CLAIMS_PER_WINDOW: usize = 256;
    pub const ACTIVE_CLAIM_LEASE: Duration = Duration::from_secs(2 * 60);
    pub const COMPLETED_LINGER: Duration = Duration::from_millis(4_000);
}
pub const COMPLETED_LINGER: Duration = limits::COMPLETED_LINGER;

/// The environment a prepared terminal session hands to the bridge.
pub mod env {
    pub const ENDPOINT: &str = "PUPPYONE_AGENT_ACTIVITY_ENDPOINT";
    pub const TOKEN: &str = "PUPPYONE_AGENT_ACTIVITY_TOKEN";
    pub const PROVIDER: &str = "PUPPYONE_AGENT_ACTIVITY_PROVIDER";
    pub const TERMINAL_SESSION_ID: &str = "PUPPYONE_AGENT_ACTIVITY_TERMINAL_SESSION_ID";
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Phase {
    Started,
    Completed,
    Failed,
    Cancelled,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Operation {
    Read,
    Search,
    Write,
    Delete,
    Move,
    Command,
    Subagent,
    Tool,
}
impl Operation {
    /// `operationKind`: reads and searches read; everything else writes.
    pub fn reading(self) -> bool {
        matches!(self, Self::Read | Self::Search)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Access {
    Read,
    Search,
    Write,
    Delete,
    MoveFrom,
    MoveTo,
}
impl Access {
    /// `WRITE_LIKE_ACCESS`: a target that may not exist yet.
    pub fn write_like(self) -> bool {
        matches!(
            self,
            Self::Write | Self::Delete | Self::MoveFrom | Self::MoveTo
        )
    }
}
/// `AgentActivityPublicTarget`: a path relative to the session's workspace.
/// Every target is `exact` (a named path); the contract's `inferred` targets
/// are produced by no provider and never become claims.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PublicTarget {
    pub relative: String,
    pub access: Access,
}
/// `AgentActivityEvent`, plus the session's workspace root so a window can
/// match targets against its own absolute paths.
#[derive(Clone, Debug, PartialEq)]
pub struct PublicEvent {
    pub activity_id: String,
    pub provider_id: String,
    pub terminal_session_id: String,
    pub phase: Phase,
    pub operation: Operation,
    pub targets: Vec<PublicTarget>,
    /// Milliseconds since the Unix epoch.
    pub occurred_at: u64,
    pub root: PathBuf,
}

pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}
/// `^[a-z][a-z0-9-]{0,39}$`.
pub fn valid_provider_id(value: &str) -> bool {
    let mut chars = value.chars();
    value.len() <= limits::PROVIDER_ID_LENGTH
        && chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}
/// A bounded identifier: non-empty, at most `max` characters, no NUL/CR/LF.
pub(crate) fn identifier(value: &str, max: usize) -> bool {
    !value.is_empty() && value.chars().count() <= max && !value.contains(['\0', '\r', '\n'])
}
/// A bounded path: non-empty, at most 4096 characters, no control characters.
pub(crate) fn bounded_path(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= limits::PATH_LENGTH
        && !value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
