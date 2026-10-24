//! Insert a semantic block without touching history, focus or persistence.
use crate::native_editor::core::{
    document::{Block, Document, Kind, Style},
    text::Text,
};
pub fn new_paragraph() -> Kind {
    Kind::Text(Style::Paragraph, Text::default())
}
pub fn insert_after(document: &mut Document, block: usize, kind: Kind) -> (usize, usize) {
    let index = (block + 1).min(document.blocks.len());
    document.blocks.insert(index, Block::new(kind));
    (index, 0)
}
