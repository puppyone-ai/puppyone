//! Paragraph/heading/quote conversion preserves inline text and marks.
use crate::native_editor::core::document::{Document, Kind, Style};
pub fn set_style(document: &mut Document, block: usize, next: Style) {
    if let Some(block) = document.blocks.get_mut(block)
        && let Kind::Text(style, _) = &mut block.kind
    {
        *style = next;
    }
}
