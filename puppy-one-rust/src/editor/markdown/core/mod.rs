//! Format-agnostic Markdown pipeline (product `editor/markdown/core`).
pub mod classes;
pub mod commands;
pub mod content_language;
pub mod decorations;
pub mod feature;
pub mod links;
pub mod plans;
pub mod presentation;
pub mod state;
// Elements carry their marker spans as `Vec<Range>`; a single-marker list
// (`vec![a..b]`) is the intended value, not a mistyped range collection.
#[expect(
    clippy::single_range_in_vec_init,
    reason = "marker lists are Vec<Range<usize>>; one-marker lists are intended"
)]
pub mod syntax;
