//! Without the Header (experimental): a project window's panes run up to
//! its top, and the Header's parts stand over them. The window tells the
//! chrome each frame where the panes leave those parts ([`Seam`]) and paints
//! the panes' grounds under it ([`ground`]).
use super::super::{at, panes::Layout};
use crate::{geometry::Rect, theme, ui::appearance::ActiveAppearance};
use gpui::{prelude::*, *};

/// Where the panes leave the Header's parts this frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::app) struct Seam {
    /// The right sidebar's share of the window's end: the actions stop
    /// before it, above the document.
    pub end: f32,
    /// The Explorer shows: the place and the project sit at its bottom
    /// instead of at the top.
    pub context_in_sidebar: bool,
}
impl Seam {
    /// In a `w` wide window laid out as `layout`.
    pub fn new(layout: &Layout, w: f32, context_in_sidebar: bool) -> Self {
        Self {
            end: w - layout.editor.right(),
            context_in_sidebar,
        }
    }
}

/// The panes' grounds over the Header's strip, under the chrome: the
/// rail's and the Explorer's, the document's and the right sidebar's, each
/// pane with its hairline edge.
pub(in crate::app) fn ground(layout: &Layout, w: f32, cx: &App) -> Vec<Div> {
    let t = cx.palette();
    let (h, editor) = (layout.header.h, layout.editor);
    let (start, end) = (editor.x.max(0.), editor.right().min(w));
    let hairline = theme::metric::SHELL_DIVIDER_WIDTH;
    let edge = |x: f32| at(Rect::new(x, 0., hairline, h)).bg(t.sidebar_divider);
    let mut ground = vec![at(Rect::new(start, 0., end - start, h)).bg(t.canvas)];
    if start > 0. {
        ground.push(at(Rect::new(0., 0., start, h)).bg(t.sidebar));
        ground.push(edge(start - hairline));
    }
    if end < w {
        ground.push(at(Rect::new(end, 0., w - end, h)).bg(t.auxiliary()));
        ground.push(edge(end));
    }
    ground
}
