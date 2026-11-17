//! Editor-agnostic text core (CodeMirror `@codemirror/state` counterpart):
//! rope buffer, change sets, anchors, selection, transactions, history and word
//! motion. No GPUI, parser or file-system dependency.
pub mod anchor;
pub mod buffer;
pub mod change;
pub mod history;
pub mod rope;
pub mod search;
pub mod selection;
pub mod state;
pub mod words;

pub use anchor::{Anchor, AnchorRange};
