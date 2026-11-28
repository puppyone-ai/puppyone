//! Core-owned inline widgets (product `core/widgets/inlineWidgets.ts`).
//!
//! Core inline atoms (`Atom::Escape`, `Atom::Text`, and future `<br>` line
//! breaks) are modeled here; task checkboxes and horizontal rules stay in
//! `features/task` and `features/rule` per `architecture/features.md`.
pub use crate::editor::markdown::core::plans::Atom;
