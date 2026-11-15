//! `ui/transcript`: the conversation view (`AgentTranscript`), its rows,
//! steps and live tail, the transcript's vertical rhythm and viewport
//! anchors.
mod activity;
mod live_tail;
mod parts;
mod stream;
#[cfg(test)]
mod tests;
pub mod transcript_layout;
pub mod transcript_rows;
/// The ported viewport anchors; product views keep their own scroll
/// position, so only the tests use them.
#[cfg(test)]
pub mod transcript_viewport;
mod view;

pub use view::{TranscriptEvent, TranscriptInput, TranscriptView};
