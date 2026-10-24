//! Markdown features (product editor/markdown/features): each complex
//! capability is a vertical slice — model, plan compiler, decorations,
//! widget, commands and style together — implementing
//! `core::feature::MarkdownFeature`. The built-in list is
//! `markdown/composition.rs`.
pub mod code_block;
pub mod rule;
pub mod table;
pub mod task;
