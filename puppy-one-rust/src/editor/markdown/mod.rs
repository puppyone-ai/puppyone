//! Native Markdown editor (product `src/shared-ui/editor/markdown`):
//! the Markdown source is the only document truth; syntax → plans and block
//! rhythm → two-layer decorations (`TA-11`) → the generic GPUI view (`editor::view`).
//!
//! - `extension.rs`: `MarkdownExtension` assembling `core`, `composition`,
//!   `platform`, and optional `addons` into `EditorExtension`
//! - `pipeline.rs`: cached incremental parse → plan → decoration pipeline
//! - `config.rs`: typed configuration `StateEffect`s and formatting command helpers
//! - `composition/`: the built-in features per dialect
//! - `core/`: the format pipeline (incremental syntax, incremental plans,
//!   two-layer decorations, state, commands) and the feature contract
//! - `features/`: one vertical slice per capability
//! - `platform/`: capability brokers and policies
//! - `shared/`: dependency-floor helpers
//! - `addons/`: optional view add-ons (`block_drag`, `TA-60`, `R8`)
//! - `style/`: one typed style per element type, the line cascade and the
//!   inline mark mapping; every value is a product token
mod addons;
pub mod composition;
mod config;
pub mod core;
mod extension;
pub mod features;
mod pipeline;
pub mod platform;
pub mod shared;
pub mod style;
#[cfg(test)]
mod tests;

pub use self::{
    config::{
        FORMAT_FEATURE_ID, SetAssets, SetDialect, SetLivePreview, SetReferences, ToggleLivePreview,
        format_command,
    },
    core::{
        commands::{FormatCommand, block_move::set_enabled as set_block_drag_enabled},
        links::{find_links, find_wiki_links},
        presentation::source_highlight::source_highlights,
    },
    extension::{
        Heading0, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6, InsertLink,
        KEY_CONTEXT, MarkdownExtension, ToggleBold, ToggleBulletList, ToggleCode, ToggleItalic,
        ToggleOrderedList, ToggleQuote, ToggleStrike, ToggleTaskList, ToggleUnderline,
    },
};

#[cfg(test)]
pub(crate) use self::extension::{begin_block_drag_for_tests, finish_block_drag_for_tests};
