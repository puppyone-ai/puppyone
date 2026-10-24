//! Code nodes are source text; editing and history stay document-wide.
use crate::native_editor::core::{document::Kind, text::Text};
pub fn new_code() -> Kind {
    Kind::Code {
        language: String::new(),
        text: Text::default(),
    }
}
