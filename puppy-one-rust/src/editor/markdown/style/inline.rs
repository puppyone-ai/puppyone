//! Inline roles (`.cm-md-syntax-*`, `.cm-md-inline-code`, links and revealed
//! markup in markdown-content.css).
use crate::editor::{tokens::Tokens, view::style::Edges};
use gpui::Rgba;

#[derive(Clone, Debug, PartialEq)]
pub struct InlineStyle {
    /// `--po-md-strong-color` / `-weight`.
    pub strong_color: Rgba,
    pub strong_weight: f32,
    /// `--po-md-emphasis-color`.
    pub emphasis_color: Rgba,
    /// `--po-md-strikethrough-color`.
    pub strike_color: Rgba,
    /// `--po-md-link-color`.
    pub link_color: Rgba,
    /// `--po-md-markup-color`: revealed delimiters.
    pub markup_color: Rgba,
    /// `--po-md-inline-code-color` / `-background` / `-padding`.
    /// `None` is CSS `currentColor`: inherit the paragraph / quote / heading.
    pub code_color: Option<Rgba>,
    pub code_background: Rgba,
    pub code_padding: Edges,
    /// `--po-md-inline-code-font-size` (`None`: unset, inherited).
    pub code_size: Option<f32>,
}

impl InlineStyle {
    pub fn resolve(t: &Tokens, size: f32) -> Self {
        let code_size = (!t.raw("--po-md-inline-code-font-size").is_empty())
            .then(|| t.len("--po-md-inline-code-font-size", size));
        Self {
            strong_color: t.color("--po-md-strong-color"),
            strong_weight: t.number("--po-md-strong-weight"),
            emphasis_color: t.color("--po-md-emphasis-color"),
            strike_color: t.color("--po-md-strikethrough-color"),
            link_color: t.color("--po-md-link-color"),
            markup_color: t.color("--po-md-markup-color"),
            code_color: (t.raw("--po-md-inline-code-color") != "currentColor")
                .then(|| t.color("--po-md-inline-code-color")),
            code_background: t.color("--po-md-inline-code-background"),
            code_padding: t.edges_at("--po-md-inline-code-padding", code_size.unwrap_or(size)),
            code_size,
        }
    }
}
