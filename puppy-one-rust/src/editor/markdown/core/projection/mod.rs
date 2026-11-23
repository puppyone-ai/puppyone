//! Document projection windows, deferred-tail lifecycle, and view-independent
//! conformance snapshots (product `core/projection/`).
//!
//! Pure, `gpui`-free logic (`R10`): decides which line/byte windows need
//! parsing and decoration for incremental edits and reveal overlays, and
//! manages the detached deferred tail so edits in the prefix stay `O(|window|)`.
pub mod conformance;
pub mod document;
pub mod range;

pub use conformance::ConformanceSnapshot;
pub use document::{DeferredTail, Parsed};
pub use range::{
    IncrementalWindow, ProjectionRequest, changed_range, incremental_required_byte,
    incremental_window, merge_ranges, reveal_line_spans, reveal_required_byte,
};
