//! Explicit scalar↔UTF-8 projection between the laboratory model and GPUI input.
use crate::{
    input::InputSnapshot,
    model::{Selection, TextNode},
};
pub fn byte_index(text: &str, scalar: usize) -> usize {
    text.char_indices()
        .nth(scalar)
        .map(|(i, _)| i)
        .unwrap_or(text.len())
}
pub fn input_snapshot(node: &TextNode, selection: Selection) -> InputSnapshot {
    InputSnapshot {
        text: node.content.text.clone(),
        marks: node.content.marks.clone(),
        anchor: byte_index(&node.content.text, selection.anchor),
        cursor: byte_index(&node.content.text, selection.cursor),
    }
}
pub fn selection(node: u64, input: &InputSnapshot) -> Selection {
    Selection {
        node,
        anchor: input.text[..input.anchor].chars().count(),
        cursor: input.text[..input.cursor].chars().count(),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_scalar_and_byte_selection_roundtrip() {
        let node = TextNode {
            id: 1,
            content: crate::model::RichText::new("甲🐶e\u{301}"),
        };
        let s = Selection {
            node: 1,
            anchor: 1,
            cursor: 3,
        };
        let input = input_snapshot(&node, s);
        assert_eq!(input.anchor, 3);
        assert_eq!(input.cursor, 8);
        assert_eq!(selection(1, &input), s);
    }
}
