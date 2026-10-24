//! Lists (`.cm-md-list-line`, markers, nesting rail; lengths at the content
//! size).
use crate::editor::{tokens::Tokens, view::style::Align};
use gpui::Rgba;

#[derive(Clone, Debug, PartialEq)]
pub struct ListStyle {
    /// `--po-md-list-color`.
    pub color: Rgba,
    /// `--po-md-list-marker-color` / `-weight`; tabular numerals when
    /// `--po-md-list-marker-numeric-variant` asks for them.
    pub marker_color: Rgba,
    pub marker_weight: f32,
    pub marker_tabular: bool,
    /// `--po-md-list-marker-width` / `-gap`.
    pub marker_width: f32,
    pub marker_gap: f32,
    /// `--po-md-list-inset` / `--po-md-list-indent-step`.
    pub inset: f32,
    pub indent_step: f32,
    /// `--po-md-ordered-marker-suffix-width` / `-align`.
    pub ordered_suffix_width: f32,
    pub ordered_align: Align,
    /// `--po-md-list-item-gap`.
    pub item_gap: f32,
}

impl ListStyle {
    pub fn resolve(t: &Tokens, size: f32) -> Self {
        let len = |name: &str| t.len(name, size);
        Self {
            color: t.color("--po-md-list-color"),
            marker_color: t.color("--po-md-list-marker-color"),
            marker_weight: t.number("--po-md-list-marker-weight"),
            marker_tabular: t.raw("--po-md-list-marker-numeric-variant").contains("tabular-nums"),
            marker_width: len("--po-md-list-marker-width"),
            marker_gap: len("--po-md-list-marker-gap"),
            inset: len("--po-md-list-inset"),
            indent_step: len("--po-md-list-indent-step"),
            ordered_suffix_width: len("--po-md-ordered-marker-suffix-width"),
            ordered_align: match t.raw("--po-md-ordered-marker-align") {
                "start" | "flex-start" | "left" => Align::Start,
                "center" => Align::Center,
                _ => Align::End,
            },
            item_gap: len("--po-md-list-item-gap"),
        }
    }
}
