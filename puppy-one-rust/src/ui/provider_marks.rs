//! Model provider and local service marks (`assets/providers/`, LobeHub
//! Icons): one-colour marks are drawn in the row's text colour, coloured
//! marks as they are; a provider without a published mark falls back to the
//! Lucide glyph of its kind.
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;

/// A provider's mark file under `assets/providers/` and whether it is one
/// colour.
pub type Mark = (&'static str, bool);

/// `mark` in a `size` square, else the glyph of a local service or an API.
pub fn provider_mark(
    mark: Option<Mark>,
    local: bool,
    size: f32,
    color: impl Into<Hsla>,
) -> AnyElement {
    let color = color.into();
    let slot = || {
        div()
            .size(px(size))
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
    };
    match mark {
        Some((mark, true)) => slot()
            .child(
                svg()
                    .path(SharedString::from(format!("providers/{mark}")))
                    .size(px(size * 0.86))
                    .text_color(color),
            )
            .into_any_element(),
        Some((mark, false)) => slot()
            .child(
                img(SharedString::from(format!("providers/{mark}")))
                    .size(px(size * 0.86))
                    .object_fit(ObjectFit::Contain),
            )
            .into_any_element(),
        None => slot()
            .child(
                Icon::new(if local { "server" } else { "key-round" })
                    .with_size(px(size))
                    .stroke(2.)
                    .color(color),
            )
            .into_any_element(),
    }
}
