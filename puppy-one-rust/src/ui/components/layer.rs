//! Layers over content that stays in the tree: the Homepage over a project,
//! a project's preparation over the one it replaces.
//!
//! Two GPUI facts make a fill alone the wrong cover:
//! 1. GPUI hit-tests every hitbox under the pointer, not only the topmost.
//!    Content painted beneath a layer keeps its hover styles and cursor, takes
//!    presses and focus, and scrolls, unless the layer occludes it
//!    (`InteractiveElement::occlude`).
//! 2. Native web content (`web_host`) draws above everything GPUI paints. A
//!    layer reports its shape (`native_cover`); a view the shape covers whole
//!    hides rather than showing through.
//!
//! Floating surfaces get the same from [`SurfaceFrame`](super::SurfaceFrame),
//! and dialogs from their host.
use crate::ui::native_cover;
use gpui::{prelude::*, *};

/// A window-sized layer over everything painted before it.
pub fn cover() -> Div {
    covering(div().absolute().top_0().left_0().size_full())
}

/// `layer`, positioned by its caller, made a cover: nothing beneath it takes
/// the pointer, and native web content beneath it hides.
pub fn covering<E: InteractiveElement + ParentElement>(layer: E) -> E {
    layer.occlude().child(native_cover::reporter(0., 0.))
}
