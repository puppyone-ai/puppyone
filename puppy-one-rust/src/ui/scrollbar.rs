//! The product scrollbar (`[data-po-scrollbar]`, `styles/scrollbars.css`).
//!
//! Kit's base scrollbar painted over a scroll owner's viewport; the product
//! geometry and activity (a transient thumb shown while the owner is hovered
//! or for 900 ms after it scrolls) are installed globally by
//! `theme::product_scrollbar`.
use gpui::{App, ElementId, ScrollHandle, Window};
use gpui_kit::base::{Scrollbar, ScrollbarHandle};

/// The vertical scrollbar of `handle`'s viewport. Append it as the owner's
/// last child, or an ancestor's: it paints where the handle reports the
/// viewport, so the owner's own scrolling never moves it.
pub fn vertical<H: ScrollbarHandle + Clone>(id: impl Into<ElementId>, handle: &H) -> Scrollbar {
    Scrollbar::vertical(handle).id(id)
}

/// Both scrollbars of a two-axis viewport (a page or a table).
pub fn both<H: ScrollbarHandle + Clone>(id: impl Into<ElementId>, handle: &H) -> Scrollbar {
    Scrollbar::new(handle).id(id)
}

/// A scroll handle kept with the element `id`, for owners that have none.
pub fn handle(id: impl Into<ElementId>, window: &mut Window, cx: &mut App) -> ScrollHandle {
    window
        .use_keyed_state(id, cx, |_, _| ScrollHandle::new())
        .read(cx)
        .clone()
}
