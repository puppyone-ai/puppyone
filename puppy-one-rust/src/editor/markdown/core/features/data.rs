//! Shared pure data types exchanged between `core/` and feature slices
//! (product `core/features/markdownFeatureData.ts`).
//!
//! Pure data contract (`R10`: zero `gpui` references). Feature-owned models
//! live inside their respective `features/<name>/model.rs` directories.
pub use crate::editor::markdown::core::syntax::{Element, Kind, Span};
