//! Feature-agnostic Markdown interaction rules (product `core/interaction/`).
//!
//! Whole-block selection state (`WidgetState::selected`) is computed by the
//! generic editor engine (`src/editor/view/widget.rs`); future Markdown-level
//! interaction rules (such as the heading outline rail) land here.
