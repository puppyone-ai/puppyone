//! The Agent host thread and its window bridge.
pub mod agent_host;
mod codex_repair;
pub use codex_repair::{RepairResult, repair_codex};
#[cfg(test)]
mod tests;

mod installation_host;
pub use crate::agent::installation::executable_resolver::{
    Observation as InstallationObservation, ResolvedCandidate as InstallationCandidate,
};
pub use crate::agent::installation::installation_service::{
    ProductResult as InstallationResult, Progress as InstallationProgress,
    Snapshot as InstallationSnapshot, Status as InstallationStatus,
};
pub use installation_host::{InstallationEvent, InstallationHost, resolve_installation_now};

mod terminal_launch;
pub use terminal_launch::{
    TerminalAgentLaunch, TerminalLaunchResolver, resolve_terminal_launch_now,
};
