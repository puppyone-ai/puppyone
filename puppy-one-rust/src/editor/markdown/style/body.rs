//! Body text and paragraph rhythm (`.cm-editor` / `.cm-scroller` font,
//! `.cm-line` gaps in markdown-content.css).
use crate::editor::{
    tokens::Tokens,
    view::style::{LineHeight, TextStyle},
};

#[derive(Clone, Debug, PartialEq)]
pub struct BodyStyle {
    /// `--po-md-content-size` / `-weight` / `-color` / `-line-height`.
    pub text: TextStyle,
    /// `--po-md-source-line-gap`: below every flowing line.
    pub source_line_gap: f32,
    /// `--po-md-paragraph-gap-before` / `-after`.
    pub paragraph_gap_before: f32,
    pub paragraph_gap_after: f32,
}

impl BodyStyle {
    pub fn resolve(t: &Tokens, size: f32) -> Self {
        let len = |name: &str| t.len(name, size);
        Self {
            text: TextStyle {
                size,
                weight: t.number("--po-md-content-weight"),
                italic: false,
                mono: false,
                color: t.color("--po-md-content-color"),
                tabular: false,
                line_height: LineHeight::Factor(t.number("--po-md-content-line-height")),
            },
            source_line_gap: len("--po-md-source-line-gap"),
            paragraph_gap_before: len("--po-md-paragraph-gap-before"),
            paragraph_gap_after: len("--po-md-paragraph-gap-after"),
        }
    }
}
