//! Blockquotes (`.cm-md-blockquote`).
use crate::editor::tokens::Tokens;
use gpui::Rgba;

#[derive(Clone, Debug, PartialEq)]
pub struct QuoteStyle {
    /// `--po-md-blockquote-color` (also the inline foreground).
    pub color: Rgba,
    /// `--po-md-blockquote-border-color` / `-width`: the left rule.
    pub border_color: Rgba,
    pub border_width: f32,
    /// `--po-md-blockquote-padding-inline`.
    pub padding: f32,
}

impl QuoteStyle {
    pub fn resolve(t: &Tokens, size: f32) -> Self {
        Self {
            color: t.color("--po-md-blockquote-color"),
            border_color: t.color("--po-md-blockquote-border-color"),
            border_width: t.len("--po-md-blockquote-border-width", size),
            padding: t.len("--po-md-blockquote-padding-inline", size),
        }
    }
}
