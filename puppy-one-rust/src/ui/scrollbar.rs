//! The product scrollbar (`[data-po-scrollbar]`, `styles/scrollbars.css`).
//!
//! Kit's base scrollbar painted over a scroll owner's viewport; the product
//! geometry and activity (a transient thumb shown while the owner is hovered
//! or for 900 ms after it scrolls) are installed globally by
//! `theme::product_scrollbar`.
use gpui::{App, Div, ElementId, ParentElement as _, ScrollHandle, Styled as _, Window, div};
use gpui_kit::base::{Scrollbar, ScrollbarHandle};

/// The vertical scrollbar of `handle`'s viewport. Append it as the owner's
/// last child, or an ancestor's: it paints where the handle reports the
/// viewport, so the owner's own scrolling never moves it.
pub fn vertical<H: ScrollbarHandle + Clone>(id: impl Into<ElementId>, handle: &H) -> Div {
    unmeasured(Scrollbar::vertical(handle).id(id))
}

/// Both scrollbars of a two-axis viewport (a page or a table).
pub fn both<H: ScrollbarHandle + Clone>(id: impl Into<ElementId>, handle: &H) -> Div {
    unmeasured(Scrollbar::new(handle).id(id))
}

/// Kit lays its scrollbar out over the whole parent (absolute, 100%), and a
/// GPUI scroller measures every child, absolute ones included: inside a
/// padded owner it would stretch the content to the padding box and add the
/// padding to the scroll range (a page that fits could still scroll). A
/// zero-size box at the static position keeps it out of the content while
/// it still paints over the handle's viewport.
fn unmeasured(scrollbar: Scrollbar) -> Div {
    div().absolute().size_0().child(scrollbar)
}

/// A scroll handle kept with the element `id`, for owners that have none.
pub fn handle(id: impl Into<ElementId>, window: &mut Window, cx: &mut App) -> ScrollHandle {
    window
        .use_keyed_state(id, cx, |_, _| ScrollHandle::new())
        .read(cx)
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{
        Context, InteractiveElement as _, IntoElement, Render, StatefulInteractiveElement as _,
        TestAppContext, px, size,
    };

    struct Padded {
        handle: ScrollHandle,
        content: f32,
    }
    impl Render for Padded {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full().child(
                div()
                    .id("scroller")
                    .w(px(200.))
                    .h(px(100.))
                    .pt(px(30.))
                    .pb(px(20.))
                    .px(px(16.))
                    .overflow_y_scroll()
                    .track_scroll(&self.handle)
                    .child(div().w_full().h(px(self.content)))
                    .child(vertical("scrollbar", &self.handle)),
            )
        }
    }

    #[gpui::test]
    fn a_padded_owner_scrolls_only_as_far_as_its_content(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        for (content, max) in [(40., 0.), (50., 0.), (90., 40.)] {
            let handle = ScrollHandle::new();
            let (_, cx) = cx.add_window_view(|_, _| Padded {
                handle: handle.clone(),
                content,
            });
            cx.simulate_resize(size(px(400.), px(300.)));
            cx.run_until_parked();
            assert_eq!(handle.max_offset().y, px(max), "content {content}");
            assert_eq!(handle.max_offset().x, px(0.), "content {content}");
        }
    }
}
