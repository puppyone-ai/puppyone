//! The editor surface (`.markdown-codemirror-editor`, `.cm-content`): the
//! reading rail, its gutter, selection and caret.
use crate::editor::{
    tokens::{Tokens, over},
    view::style::Edges,
};
use gpui::Rgba;

#[derive(Clone, Debug, PartialEq)]
pub struct SurfaceStyle {
    /// `--po-md-surface-background`.
    pub background: Rgba,
    /// `--po-markdown-editor-text-width`: the reading rail.
    pub text_width: f32,
    /// `--po-markdown-editor-gutter-min`: the rail's minimum inset.
    pub gutter: f32,
    /// `.cm-scroller { scrollbar-gutter: stable both-edges }`, measured by
    /// Chromium on the reference platform (not part of the block inset).
    pub scrollbar_gutter: f32,
    /// `text-selection.css`: the Markdown selection tints pre-composited
    /// over `--po-canvas`, so overlapping line fragments paint no seams.
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
            scrollbar_gutter: t.scrollbar_gutter,
            selection: over(t.color("--po-md-selection-bg"), t.color("--po-canvas")),
            selection_inactive: over(
                t.color("--po-md-selection-inactive-bg"),
                t.color("--po-canvas"),
            ),
            caret: t.color("--po-text"),
        }
    }

    /// `.cm-content` insets.
    pub fn insets(&self) -> Edges {
        Edges::new(
            self.gutter,
            self.gutter + self.scrollbar_gutter,
            self.gutter,
            self.gutter + self.scrollbar_gutter,
        )
    }
}
