//! The wide table's scrollport input and its reading-rail scrollbar
//! (`tableInlineViewportController.ts`, `.cm-md-table-scrollbar-rail`):
//! horizontal wheel and trackpad deltas, and Shift with a vertical wheel,
//! scroll the table; vertical scrolling stays with the document. The rail
//! is the product scrollbar over a reading-column track, mapped onto the
//! table's offset.
use super::viewport::{self, Geometry, RAIL_HEIGHT};
use crate::editor::{
    markdown::platform::sessions::inline_viewport::{Position, Shared},
    view::EditorView,
};
use gpui::{prelude::*, *};
use gpui_kit::base::ScrollbarHandle;
use std::{cell::Cell, rc::Rc};

/// The mounted viewport session a table scrolls, with this frame's tracks.
#[derive(Clone)]
pub struct Link {
    pub store: Shared,
    pub id: u64,
    pub mount: u64,
    pub geometry: Rc<Geometry>,
    pub view: WeakEntity<EditorView>,
}

impl Link {
    /// The logical offset the session's anchor gives these tracks.
    pub fn offset(&self) -> f32 {
        let position = self
            .store
            .borrow_mut()
            .get(self.id)
            .map_or(Position::Start, |s| s.position);
        viewport::offset(position, &self.geometry)
    }

    /// Scroll to the logical `offset`, keeping it as an anchor. Returns
    /// whether the table moved.
    pub fn scroll_to(&self, offset: f32) -> bool {
        let next = offset.clamp(0., self.geometry.max);
        if (next - self.offset()).abs() < 0.01 {
            return false;
        }
        self.store.borrow_mut().capture(
            self.id,
            self.mount,
            viewport::position(next, &self.geometry),
        );
        true
    }

    fn redraw(&self, cx: &mut App) {
        let _ = self.view.update(cx, |_, cx| cx.notify());
    }
}

/// Wheel input over the scrollport `area` (block-local), in front of the
/// document's own scrolling.
pub fn wheel(link: Link, area: Bounds<f32>) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |bounds, _, window, _| {
            let link = link.clone();
            window.on_mouse_event(move |e: &ScrollWheelEvent, phase, _, cx| {
                if phase != DispatchPhase::Bubble || !bounds.contains(&e.position) {
                    return;
                }
                let delta = e.delta.pixel_delta(px(16.));
                let (dx, dy) = (f32::from(delta.x), f32::from(delta.y));
                let horizontal = if dx.abs() > dy.abs() {
                    dx
                } else if e.modifiers.shift && dx == 0. && dy != 0. {
                    dy
                } else {
                    return;
                };
                // `overscroll-behavior-x: contain`: a horizontal gesture never
                // reaches the document, also at the table's edges.
                cx.stop_propagation();
                if link.scroll_to(link.offset() - horizontal) {
                    link.redraw(cx);
                }
            });
        },
    )
    .absolute()
    .left(px(area.origin.x))
    .top(px(area.origin.y))
    .w(px(area.size.width))
    .h(px(area.size.height))
}

/// The scrollbar rail's handle: the reading-column track, whose range is
/// the table's (`mapInlineScrollOffset` both ways).
#[derive(Clone)]
pub struct Rail {
    link: Link,
    bounds: Rc<Cell<Bounds<Pixels>>>,
}

impl Rail {
    pub fn new(link: Link) -> Self {
        Self {
            link,
            bounds: Rc::default(),
        }
    }

    fn rail_max(&self) -> f32 {
        // The rail's content is its width plus the table's range.
        self.link.geometry.max
    }
}

impl ScrollbarHandle for Rail {
    fn viewport_bounds(&self) -> Bounds<Pixels> {
        self.bounds.get()
    }

    fn offset(&self) -> Point<Pixels> {
        let g = &self.link.geometry;
        point(
            px(-viewport::map_offset(
                self.link.offset(),
                g.max,
                self.rail_max(),
            )),
            px(0.),
        )
    }

    fn set_offset(&self, offset: Point<Pixels>) {
        let g = &self.link.geometry;
        let target = viewport::map_offset(-f32::from(offset.x), self.rail_max(), g.max);
        self.link.scroll_to(target);
    }

    fn content_size(&self) -> Size<Pixels> {
        let b = self.bounds.get();
        size(b.size.width + px(self.rail_max()), b.size.height)
    }
}

/// The rail under the table: `width` wide at block-local `top`.
pub fn rail(id: ElementId, rail: &Rail, width: f32, top: f32) -> AnyElement {
    let bounds = rail.bounds.clone();
    div()
        .debug_selector(|| "md-table-scrollbar-rail".into())
        .absolute()
        .left_0()
        .top(px(top))
        .w(px(width))
        .h(px(RAIL_HEIGHT))
        .child(
            canvas(move |b, _, _| bounds.set(b), |_, _, _, _| {})
                .absolute()
                .size_full(),
        )
        .child(crate::ui::scrollbar::horizontal(id, rail))
        .into_any_element()
}
