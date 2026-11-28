//! Floating surfaces over native web content.
//!
//! A native child view (an HTML page's WebView) draws above everything GPUI
//! paints. A floating surface that may cross one (a menu, a popover, a
//! tooltip) reports the shape it painted here; after the frame the web host
//! cuts those shapes out of its views. The surface shows whole and the page
//! around it stays live, where hiding the page would blank the window.
use gpui::{prelude::*, *};
use std::{cell::RefCell, collections::HashMap};

/// A painted shape in window coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cutout {
    pub bounds: Bounds<Pixels>,
    pub radius: f32,
}

/// Shapes a window that never hosts web content keeps at most.
const MAX_PER_WINDOW: usize = 64;

thread_local! {
    static CUTOUTS: RefCell<HashMap<u64, Vec<Cutout>>> = RefCell::new(HashMap::new());
}

fn window_key(window: &Window) -> u64 {
    window.window_handle().window_id().as_u64()
}

/// `bounds` (clipped to the current content mask) painted in this frame
/// over whatever native content lies beneath.
pub fn report(window: &Window, bounds: Bounds<Pixels>, radius: f32) {
    let bounds = bounds.intersect(&window.content_mask().bounds);
    if bounds.size.width <= px(0.) || bounds.size.height <= px(0.) {
        return;
    }
    let key = window_key(window);
    CUTOUTS.with(|c| {
        let mut all = c.borrow_mut();
        let list = all.entry(key).or_default();
        if list.len() < MAX_PER_WINDOW {
            list.push(Cutout { bounds, radius });
        }
    });
}

/// The shapes `window_id` reported since the last call: the web host takes
/// them after each frame, so each frame reports afresh.
pub fn take(window_id: u64) -> Vec<Cutout> {
    CUTOUTS.with(|c| c.borrow_mut().remove(&window_id).unwrap_or_default())
}

/// An empty element over its positioned parent, `inset` within each edge,
/// that reports that shape as it prepaints.
pub fn reporter(inset: f32, radius: f32) -> impl IntoElement {
    canvas(
        move |bounds, window, _| report(window, bounds, radius),
        |_, _, _, _| {},
    )
    .absolute()
    .top(px(inset))
    .left(px(inset))
    .right(px(inset))
    .bottom(px(inset))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::components::SurfaceFrame;
    use core::prelude::v1::test;

    struct Surfaces;
    impl Render for Surfaces {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div()
                .size_full()
                .child(
                    SurfaceFrame::menu("menu")
                        .absolute()
                        .left(px(10.))
                        .top(px(20.))
                        .w(px(100.))
                        .h(px(50.)),
                )
                .child(
                    SurfaceFrame::card("card")
                        .absolute()
                        .left(px(200.))
                        .top(px(20.))
                        .w(px(80.))
                        .h(px(40.)),
                )
        }
    }

    #[gpui::test]
    fn a_floating_surface_reports_its_border_box_and_an_inline_card_does_not(
        cx: &mut TestAppContext,
    ) {
        cx.update(gpui_kit::init);
        let (_, cx) = cx.add_window_view(|_, _| Surfaces);
        cx.simulate_resize(size(px(400.), px(300.)));
        cx.run_until_parked();
        let id = cx.update(|window, _| window.window_handle().window_id().as_u64());
        let shapes = take(id);
        assert_eq!(
            shapes.last(),
            Some(&Cutout {
                bounds: Bounds::new(point(px(10.), px(20.)), size(px(100.), px(50.))),
                radius: crate::theme::metric::MENU_RADIUS,
            })
        );
        assert!(
            shapes.iter().all(|s| s.bounds.origin.x < px(200.)),
            "an inline card covers nothing: {shapes:?}"
        );
        // Taken once: the next frame reports afresh.
        assert!(take(id).is_empty());
    }
}
