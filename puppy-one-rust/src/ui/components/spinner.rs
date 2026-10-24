//! Small activity indicators.
use gpui::{prelude::*, *};

/// `.desktop-terminal-launcher-discovery-spinner`: a ring in `track` whose
/// top arc in `color` turns once every 900ms.
#[derive(IntoElement)]
pub struct Spinner {
    id: ElementId,
    size: Pixels,
    track: Hsla,
    color: Hsla,
}
impl Spinner {
    pub fn new(id: impl Into<ElementId>, track: impl Into<Hsla>, color: impl Into<Hsla>) -> Self {
        Self {
            id: id.into(),
            size: px(11.),
            track: track.into(),
            color: color.into(),
        }
    }
    pub fn size_px(mut self, size: f32) -> Self {
        self.size = px(size);
        self
    }
}
impl RenderOnce for Spinner {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .relative()
            .size(self.size)
            .child(
                svg()
                    .path("icons/spinner-track.svg")
                    .absolute()
                    .size(self.size)
                    .text_color(self.track),
            )
            .child(
                svg()
                    .path("icons/spinner-arc.svg")
                    .absolute()
                    .size(self.size)
                    .text_color(self.color)
                    .with_animation(
                        self.id,
                        Animation::new(std::time::Duration::from_millis(900)).repeat(),
                        |arc, delta| {
                            arc.with_transformation(Transformation::rotate(radians(
                                delta * std::f32::consts::TAU,
                            )))
                        },
                    ),
            )
    }
}
