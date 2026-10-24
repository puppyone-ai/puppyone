//! Compatibility exports for shared native text actions and the historical probe.
//! The document input implementation is maintained by native_editor/gpui.
#[path = "../native_editor/gpui/input.rs"]
mod document_input;
pub use document_input::*;
