//! The editor surface (`.markdown-codemirror-editor`, `.cm-content`): the
//! reading rail, its gutter, selection and caret.
use crate::editor::{tokens::Tokens, view::style::Edges};
use gpui::Rgba;

#[derive(Clone, Debug, PartialEq)]
pub struct SurfaceStyle {
    /// `--po-md-surface-background`.
    pub background: Rgba,
    /// `--po-markdown-editor-text-width`: the reading rail.
    pub text_width: f32,
    /// `--po-markdown-editor-gutter-min`: the rail's minimum inset.
    pub gutter: f32,
    /// `--po-md-selection-bg` / `--po-md-selection-inactive-bg`.
    pub selection: Rgba,
    pub selection_inactive: Rgba,
    /// `.cm-content { caret-color: var(--po-text) }`.
    pub caret: Rgba,
}

impl SurfaceStyle {
    pub fn resolve(t: &Tokens, size: f32) -> Self {
        Self {
            background: t.color("--po-md-surface-background"),
            text_width: t.len("--po-markdown-editor-text-width", size),
            gutter: t.len("--po-markdown-editor-gutter-min", size),
            selection: t.color("--po-md-selection-bg"),
            selection_inactive: t.color("--po-md-selection-inactive-bg"),
            caret: t.color("--po-text"),
        }
    }

    /// `.cm-content` insets.
    pub fn insets(&self) -> Edges {
        Edges::all(self.gutter)
    }
}
