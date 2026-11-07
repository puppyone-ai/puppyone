//! `ui/transcript`: transcript rows, vertical rhythm and viewport anchors.
pub mod transcript_layout;
pub mod transcript_rows;
/// The ported viewport anchors; product views keep their own scroll
/// position, so only the tests use them.
#[cfg(test)]
pub mod transcript_viewport;
