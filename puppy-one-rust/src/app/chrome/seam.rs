//! Without the Header (experimental): a project window's panes run up to
//! its top, and the Header's parts stand over them — the sidebar toggle,
//! the place and the project over the Explorer, the tools over the
//! document. The window tells the chrome each frame where the panes leave
//! those parts ([`Seam`]), paints the panes' grounds under it ([`ground`])
//! and fades the document scrolled up to it ([`document_fade`]).
use super::super::{at, editor_area::EditorArea, panes::Layout, window_cloud::WindowCloud};
use crate::{
    geometry::Rect,
    theme,
    ui::{
        appearance::ActiveAppearance,
        scroll_edge::{self, Edge},
    },
};
use gpui::{prelude::*, *};

/// Where the panes leave the Header's parts this frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::app) struct Seam {
    /// The Explorer column's end while it shows (the rail included): the
    /// sidebar toggle, the place and the project stay over it.
    pub sidebar: Option<f32>,
    /// The right sidebar's share of the window's end: the actions stop
    /// before it, above the document.
    pub end: f32,
}
impl Seam {
    /// In a `w` wide window laid out as `layout`, its Explorer `shown`.
    pub fn new(layout: &Layout, w: f32, shown: bool) -> Self {
        Self {
            sidebar: shown.then_some(layout.editor.x),
            end: w - layout.editor.right(),
        }
    }
}

/// Under the chrome: the panes' grounds over the Header's strip, and
/// the document's fade below it (not over the Cloud screen).
pub(in crate::app) fn underlay(
    layout: &Layout,
    w: f32,
    cloud: &Entity<WindowCloud>,
    editor: &Entity<EditorArea>,
    cx: &App,
) -> Vec<AnyElement> {
    let front = (!cloud.read(cx).screen_shown(cx)).then(|| editor.read(cx).front.clone());
    let fade = front.map(|front| document_fade(layout, front, cx).into_any_element());
    fade.into_iter()
        .chain(
            ground(layout, w, cx)
                .into_iter()
                .map(IntoElement::into_any_element),
        )
        .collect()
}

/// The panes' grounds over the Header's strip, under the chrome: the
/// rail's and the Explorer's, the document's and the right sidebar's, each
/// pane with its hairline edge.
fn ground(layout: &Layout, w: f32, cx: &App) -> Vec<Div> {
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

/// The front document scrolled up under the tools fades into the window's
/// top instead of being cut at it; never a pinned header row, which is the
/// edge already. Read at paint time so it follows every scroll frame.
fn document_fade(
    layout: &Layout,
    front: Entity<crate::editor::host::DocumentEditor>,
    cx: &App,
) -> impl IntoElement {
    let canvas_ground = cx.palette().canvas;
    let editor = layout.editor;
    let height = theme::metric::DOCUMENT_TOP_FADE;
    gpui::canvas(
        |_, _, _| {},
        move |bounds, _, window, cx| {
            let (scroll, pinned) = front.read(cx).scroll_state(cx);
            let strength = if pinned {
                0.
            } else {
                scroll_edge::strength(scroll)
            };
            scroll_edge::paint(window, bounds, Edge::Top, canvas_ground, height, strength);
        },
    )
    .absolute()
    .left(px(editor.x))
    .top(px(editor.y))
    .w(px(editor.w))
    .h(px(height))
}
