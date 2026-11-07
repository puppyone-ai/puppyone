//! The main row as the window paints it: the side panes' frames under the
//! editor, and the panes' edges above it (`CollapsiblePaneFrame`,
//! `.po-pane-edge-resize-handle`).
//!
//! A pane's content is a plane at its open width, anchored at the pane's
//! outer edge. While a frame moves, or a drag narrows it, the plane is wider
//! than the frame, and the editor — painted after the planes, opaque and
//! occluding the pointer — covers the rest. Nothing is clipped: the product
//! clips the plane with the frame's viewport, but a GPUI cached view whose
//! clip changes renders again, so clipping would rebuild the Explorer and
//! the right sidebar at every frame of the motion. Covered, they keep their
//! bounds and are reused.
use super::{PaneFrames, PaneLayout, ResizeIntent, Side};
use crate::{
    geometry::Rect,
    theme,
    ui::{appearance::ActiveAppearance, components::ResizeHandle},
};
use gpui::{prelude::*, *};
use gpui_kit::base::Disableable as _;

fn at(r: Rect) -> Div {
    div()
        .absolute()
        .left(px(r.x))
        .top(px(r.y))
        .w(px(r.w))
        .h(px(r.h))
}

/// The panes' planes under the editor (window coordinates).
#[derive(IntoElement, Default)]
pub(in crate::app) struct PaneStack {
    start: Option<(Rect, AnyElement)>,
    end: Option<(Rect, AnyElement)>,
    main: Option<Div>,
}
impl PaneStack {
    pub fn new() -> Self {
        Self::default()
    }
    /// The Explorer column's plane, while its frame shows.
    pub fn start(mut self, plane: Rect, content: impl IntoElement) -> Self {
        self.start = Some((plane, content.into_any_element()));
        self
    }
    /// The right sidebar's plane, while its frame shows.
    pub fn end(mut self, plane: Rect, content: impl IntoElement) -> Self {
        self.end = Some((plane, content.into_any_element()));
        self
    }
    /// The editor between the frames' edges, over the planes.
    pub fn main(mut self, editor: Div) -> Self {
        self.main = Some(editor);
        self
    }
}
impl RenderOnce for PaneStack {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .children(self.start.map(|(plane, content)| at(plane).child(content)))
            .children(self.end.map(|(plane, content)| at(plane).child(content)))
            .children(self.main.map(|main| main.occlude()))
    }
}

/// `onKeyboardResize`: the keys a focused edge takes.
fn intent(key: &str) -> Option<ResizeIntent> {
    Some(match key {
        "left" => ResizeIntent::Decrease,
        "right" => ResizeIntent::Increase,
        "home" => ResizeIntent::Minimum,
        "end" => ResizeIntent::Maximum,
        _ => return None,
    })
}

/// The panes' edges above the editor in a window `w` wide beside a `rail`
/// wide project rail: each moving or open frame's resize lane, the closed
/// right sidebar's pull-out lane at the window edge, and the window-wide
/// pointer tracking of a drag.
pub(in crate::app) fn edges(
    panes: &Entity<PaneLayout>,
    frames: &PaneFrames,
    w: f32,
    rail: f32,
    window: &Window,
    cx: &App,
) -> Vec<AnyElement> {
    let t = cx.palette();
    let state = panes.read(cx);
    let editor = frames.layout.editor;
    // `.po-pane-edge-resize-handle` + `.po-pane-edge-chrome`: an 8px
    // transparent lane whose only paint is the 1px divider — the Explorer's
    // own last column, the right sidebar's first — plus the adjacent hover /
    // active stroke (and ring while dragging). A focused edge is a tab stop
    // that resizes with the arrow keys and shows its stroke.
    let sash = |side: Side| {
        // The frames' edges, also mid-motion: the main pane follows them.
        let x = match side {
            Side::Start => editor.x - 1.,
            Side::End => editor.right(),
        };
        let focus = state.focus(side).clone();
        let (on_drag, on_key) = (panes.downgrade(), panes.downgrade());
        ResizeHandle::new(
            match side {
                Side::Start => "left-sash",
                Side::End => "right-sash",
            },
            Axis::Horizontal,
        )
        .divider(t.sidebar_divider)
        .stroke_at(1.)
        .resizing(state.dragging() == Some(side))
        .focused(focus.is_focused(window))
        .focus_ring()
        // A pane that is closing (or previewing closed) keeps its edge
        // painted but cannot be grabbed (`onPointerDown` while collapsed).
        .disabled(!state.pane(side).open)
        .on_drag_start(move |e: &MouseDownEvent, _, cx| {
            cx.stop_propagation();
            let _ = on_drag.update(cx, |p, cx| p.begin_drag(side, e.position, cx));
        })
        .track_focus(&focus)
        .on_key_down(move |e: &KeyDownEvent, _, cx| {
            if let Some(intent) = intent(&e.keystroke.key) {
                cx.stop_propagation();
                let shift = e.keystroke.modifiers.shift;
                let _ = on_key.update(cx, |p, cx| p.resize_by_keyboard(side, intent, shift, cx));
            }
        })
        .absolute()
        .left(px(x))
        .top(px(editor.y))
        .w(px(theme::metric::PANE_SASH))
        .h(px(editor.h))
        .into_any_element()
    };
    let mut edges = vec![];
    // Each frame owns its edge while it is on screen; a closed right
    // sidebar keeps its lane at the window edge.
    if editor.x > rail + 0.5 {
        edges.push(sash(Side::Start));
    }
    if editor.right() < w - 0.5 {
        edges.push(sash(Side::End));
    } else if !state.right().open {
        // `.po-collapsed-pane-edge-handle--inline-end`: a 12px lane at the
        // window edge to pull the closed sidebar back out, marked by a
        // faint line that firms up on hover or focus. It is the right
        // edge's tab stop while the sidebar is closed and takes its keys.
        let lane = theme::pane::COLLAPSED_EDGE_HIT;
        let focus = state.focus(Side::End).clone();
        let (on_drag, on_key) = (panes.downgrade(), panes.downgrade());
        edges.push(
            ResizeHandle::new("right-collapsed-edge", Axis::Horizontal)
                .stroke_at(lane - 1.)
                .rest(theme::alpha(t.shell_divider, 0.72))
                .hover(t.border_strong)
                .focused(focus.is_focused(window))
                .cursor(CursorStyle::ResizeLeft)
                .on_drag_start(move |e: &MouseDownEvent, _, cx| {
                    cx.stop_propagation();
                    let _ = on_drag.update(cx, |p, cx| p.begin_drag(Side::End, e.position, cx));
                })
                .track_focus(&focus)
                .on_key_down(move |e: &KeyDownEvent, _, cx| {
                    if let Some(intent) = intent(&e.keystroke.key) {
                        cx.stop_propagation();
                        let shift = e.keystroke.modifiers.shift;
                        let _ = on_key.update(cx, |p, cx| {
                            p.resize_collapsed_by_keyboard(intent, shift, cx)
                        });
                    }
                })
                .absolute()
                .left(px(w - lane))
                .top(px(editor.y))
                .w(px(lane))
                .h(px(editor.h))
                .into_any_element(),
        );
    }
    edges.push(drag_tracking(panes.downgrade()));
    edges
}

/// A drag follows the pointer anywhere in the window and ends on release
/// (`setPointerCapture`). Registered every frame, so a release that comes
/// before the next frame still ends the drag.
fn drag_tracking(panes: WeakEntity<PaneLayout>) -> AnyElement {
    canvas(
        |_, _, _| {},
        move |_, _, window, _| {
            let moves = panes.clone();
            window.on_mouse_event(move |e: &MouseMoveEvent, phase, _, cx| {
                if phase == DispatchPhase::Bubble {
                    let _ = moves.update(cx, |p, cx| p.move_drag(e.position, cx));
                }
            });
            let releases = panes.clone();
            window.on_mouse_event(move |e: &MouseUpEvent, phase, _, cx| {
                if phase == DispatchPhase::Bubble && e.button == MouseButton::Left {
                    let _ = releases.update(cx, |p, cx| {
                        if p.move_drag(e.position, cx) {
                            p.end_drag(true, cx);
                        }
                    });
                }
            });
        },
    )
    .absolute()
    .size_0()
    .into_any_element()
}
