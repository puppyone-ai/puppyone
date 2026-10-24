//! Editor-agnostic text core (CodeMirror `@codemirror/state` counterpart):
//! buffer, change sets, selection, transactions, history and word motion.
//! No GPUI, parser or file-system dependency.
pub mod buffer;
pub mod change;
pub mod history;
pub mod selection;
pub mod state;
pub mod words;
