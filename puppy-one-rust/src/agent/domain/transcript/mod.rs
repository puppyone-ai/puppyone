//! `electron/main/agent/domain/transcript`: the display projection of a
//! session's canonical events.
pub mod content_readers;
pub mod display_control;
pub mod display_projection;
pub mod display_window;
pub mod file_change;
pub mod message_identity;
pub mod provider_activity_policy;
pub mod provider_notice_policy;
#[cfg(test)]
mod tests;
pub mod transcript_indexes;
pub mod transcript_reducer;
pub mod turn_lifecycle;
pub mod turn_timing;
