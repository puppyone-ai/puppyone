//! Code block presentation (markdown-code-widgets.css `.cm-md-code-widget`,
//! `.cm-md-code-panel`, and the code lines in source mode).
use crate::editor::{
    tokens::Tokens,
    view::style::{Edges, LineHeight, TextStyle},
};
use gpui::Rgba;

pub use crate::editor::code::highlight::SyntaxColors;

#[derive(Clone, Debug, PartialEq)]
pub struct CodeBlockStyle {
    /// `--po-md-code-block-background` / `-color`.
    pub background: Rgba,
    pub color: Rgba,
    /// `--po-md-code-block-font-size` / `-font-weight` / `-line-height`.
    pub size: f32,
    pub weight: f32,
    pub line_height: f32,
    /// `--po-md-code-block-padding` / `-radius`, at the code size.
    pub padding: Edges,
    pub radius: f32,
    /// `--po-md-code-block-gap-before` / `-after`: the widget's rhythm.
    pub gap_before: f32,
    pub gap_after: f32,
    /// `--po-md-code-caret-color` / `--po-md-code-focus-background`.
    pub caret: Rgba,
    pub focus_background: Rgba,
    pub syntax: SyntaxColors,
}

impl CodeBlockStyle {
    pub fn resolve(t: &Tokens, size: f32) -> Self {
        let code = t.len("--po-md-code-block-font-size", size);
        Self {
            background: t.color("--po-md-code-block-background"),
            color: t.color("--po-md-code-block-color"),
            size: code,
            weight: t.number("--po-md-code-block-font-weight"),
            line_height: t.len("--po-md-code-block-line-height", code),
            padding: t.edges_at("--po-md-code-block-padding", code),
            radius: t.len("--po-md-code-block-radius", code),
            gap_before: t.len("--po-md-code-block-gap-before", size),
            gap_after: t.len("--po-md-code-block-gap-after", size),
            caret: t.color("--po-md-code-caret-color"),
            focus_background: t.color("--po-md-code-focus-background"),
            syntax: SyntaxColors {
                comment: t.color("--po-md-syntax-comment"),
                keyword: t.color("--po-md-syntax-keyword"),
                string: t.color("--po-md-syntax-string"),
                constant: t.color("--po-md-syntax-constant"),
                special: t.color("--po-md-syntax-special"),
                type_name: t.color("--po-md-syntax-type"),
                function: t.color("--po-md-syntax-function"),
                property: t.color("--po-md-syntax-property"),
                operator: t.color("--po-md-syntax-operator"),
                meta: t.color("--po-md-syntax-meta"),
                invalid: t.color("--po-md-error-color"),
            },
        }
    }

    /// The code text (`white-space: pre`, code line height).
    pub fn text(&self) -> TextStyle {
        TextStyle {
            size: self.size,
            weight: self.weight,
            italic: false,
            mono: true,
            color: self.color,
            tabular: false,
            line_height: LineHeight::Px(self.line_height),
        }
    }
}
