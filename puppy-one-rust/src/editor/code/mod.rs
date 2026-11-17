//! Code-language, syntax roles (`--po-md-syntax-*`), passive decorations,
//! indent guides, folding, editing behaviours, and the unified [`CodeExtension`]
//! on [`crate::editor::view::EditorView`] (`CE-01`–`CE-12`).
pub mod decorate;
pub mod editing;
pub mod extension;
pub mod folding;
pub mod highlight;
pub mod language;
