//! Chrome shared by replaced block widgets (markdown-editor.css "Rich
//! replaced blocks"): a 2px ring on the block's surface — the hover ring
//! while hovered or focused, the selected ring when the document selection
//! covers the whole block (`is-doc-selected`).
use crate::editor::tokens::Tokens;
use gpui::Rgba;

#[derive(Clone, Debug, PartialEq)]
pub struct BlockStyle {
    /// `--po-md-block-radius`.
    pub radius: f32,
    /// `--cm-md-block-hover-ring` / `--cm-md-block-selected-ring`.
    pub hover_ring: Rgba,
    pub selected_ring: Rgba,
    /// `box-shadow: 0 0 0 2px var(--cm-md-block-current-ring)`.
    pub ring_width: f32,
}

impl BlockStyle {
    pub fn resolve(t: &Tokens, size: f32) -> Self {
        Self {
            radius: t.len("--po-md-block-radius", size),
            hover_ring: t.color("--cm-md-block-hover-ring"),
            selected_ring: t.color("--cm-md-block-selected-ring"),
            ring_width: 2.,
        }
    }
}
