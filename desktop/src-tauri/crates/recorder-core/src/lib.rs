mod agents;
mod cloud;
mod db;
mod diff;
mod restore;
mod scanner;
mod session;
mod snapshot;

pub use session::{desktop_status, demo_sessions, DesktopStatus, SessionSummary};

#[derive(Debug, thiserror::Error)]
pub enum RecorderError {
    #[error("recorder core is not implemented yet")]
    NotImplemented,
}
