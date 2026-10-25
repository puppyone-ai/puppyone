//! `.po-pane-edge-resize-handle` / `.desktop-terminal-splitter`: the hit lane
//! of a draggable boundary and its one-pixel painter, shared by the shell's
//! pane edges and the workbench splits.
//!
//! The lane is transparent and wider than what it paints. Its stroke rests
//! transparent (or [`rest`](ResizeHandle::rest)), takes
//! `--po-pane-resizer-hover-color` under the pointer and the active colour
//! with a 1px ring while dragged. A pane edge also paints the frame's own
//! divider at the lane's start, the stroke beside it (`.po-pane-edge-chrome`).
//!
//! The owner positions and sizes the lane (`Styled`) and runs the drag from
//! [`on_drag_start`](ResizeHandle::on_drag_start).
use crate::ui::appearance::ActiveAppearance;
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable, StyledExt as _};
use std::rc::Rc;

type DragStart = Rc<dyn Fn(&MouseDownEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct ResizeHandle {
    id: ElementId,
    base: Stateful<Div>,
    style: StyleRefinement,
    axis: Axis,
    stroke: f32,
    divider: Option<Rgba>,
    rest: Option<Rgba>,
    hover: Option<Rgba>,
    cursor: Option<CursorStyle>,
    resizing: bool,
    disabled: bool,
    on_drag_start: Option<DragStart>,
}
impl ResizeHandle {
    /// The lane of a boundary between panes laid out along `axis`
    /// (`Horizontal`: side by side, so the lane is dragged left and right).
    pub fn new(id: impl Into<ElementId>, axis: Axis) -> Self {
        let id = id.into();
        Self {
            base: div().id(id.clone()),
            id,
            style: StyleRefinement::default(),
            axis,
            stroke: 0.,
            divider: None,
            rest: None,
            hover: None,
            cursor: None,
            resizing: false,
            disabled: false,
            on_drag_start: None,
        }
    }
    /// The stroke's offset from the lane's start (default 0).
    pub fn stroke_at(mut self, offset: f32) -> Self {
        self.stroke = offset;
        self
    }
    /// The pane frame's own 1px edge, painted at the lane's start whatever
    /// the state (`.po-pane-edge-chrome::before`).
    pub fn divider(mut self, color: Rgba) -> Self {
        self.divider = Some(color);
        self
    }
    /// The stroke at rest (default transparent).
    pub fn rest(mut self, color: Rgba) -> Self {
        self.rest = Some(color);
        self
    }
    /// The stroke under the pointer (default `--po-pane-resizer-hover-color`).
    pub fn hover(mut self, color: Rgba) -> Self {
        self.hover = Some(color);
        self
    }
    /// The pointer over the lane (default: resize along the axis).
    pub fn cursor(mut self, cursor: CursorStyle) -> Self {
        self.cursor = Some(cursor);
        self
    }
    /// Being dragged: the active colour and its ring. A lane being dragged
    /// stays grabbable even when disabled.
    pub fn resizing(mut self, resizing: bool) -> Self {
        self.resizing = resizing;
        self
    }
    /// A primary press on the lane starts the owner's drag.
    pub fn on_drag_start(
        mut self,
        handler: impl Fn(&MouseDownEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_drag_start = Some(Rc::new(handler));
        self
    }
}
/// Disabled: the stroke stays painted but the lane cannot be grabbed (a pane
/// that is closing, `onPointerDown` while collapsed).
impl Disableable for ResizeHandle {
    fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}
impl Styled for ResizeHandle {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl InteractiveElement for ResizeHandle {
    fn interactivity(&mut self) -> &mut Interactivity {
        self.base.interactivity()
    }
}
impl StatefulInteractiveElement for ResizeHandle {}
impl RenderOnce for ResizeHandle {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let horizontal = self.axis == Axis::Horizontal;
        let grabbable = !self.disabled || self.resizing;
        let group = SharedString::from(format!("resize-handle-{}", self.id));
        let hover = self.hover.unwrap_or(t.pane_resizer_hover);
        // A 1px line across the lane at `offset` from its start.
        let line = move |offset: f32| {
            div()
                .absolute()
                .when(horizontal, |d| {
                    d.top_0().bottom_0().left(px(offset)).w(px(1.))
                })
                .when(!horizontal, |d| {
                    d.left_0().right_0().top(px(offset)).h(px(1.))
                })
        };
        let cursor = self.cursor.unwrap_or(if horizontal {
            CursorStyle::ResizeLeftRight
        } else {
            CursorStyle::ResizeUpDown
        });
        self.base
            .group(group.clone())
            .when(grabbable, |d| d.cursor(cursor))
            .when_some(self.on_drag_start.filter(|_| grabbable), |d, handler| {
                d.on_mouse_down(MouseButton::Left, move |event, window, cx| {
                    handler(event, window, cx)
                })
            })
            .children(self.divider.map(|color| line(0.).bg(color)))
            .child(
                line(self.stroke)
                    .when_some(self.rest, |d, color| d.bg(color))
                    .when(self.resizing, |d| {
                        d.bg(t.pane_resizer_active).shadow(vec![BoxShadow {
                            inset: false,
                            color: t.pane_resizer_ring.into(),
                            offset: point(px(0.), px(0.)),
                            blur_radius: px(0.),
                            spread_radius: px(1.),
                        }])
                    })
                    .when(!self.resizing && !self.disabled, |d| {
                        d.group_hover(group, move |s| s.bg(hover))
                    }),
            )
            .refine_style(&self.style)
    }
}
