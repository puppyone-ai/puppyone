//! A single-line label laid out at its exact shaped advance.
//!
//! GPUI's text element rounds a line's measured width up to a whole point
//! (`size.width.ceil()` in `elements/text.rs`), while Chromium keeps the
//! fractional width (LayoutUnits). Content-sized controls built on it (row
//! actions, badges) therefore come out up to 1pt wider than the product's,
//! pushing every neighbouring track by that much. This element measures with
//! the same shaper and keeps the fraction; it inherits the ambient text style
//! and repaints with the style active at paint time, so hover colours apply.
//! It never wraps or truncates: use it for short, single-line labels only.
use gpui::*;

pub struct ExactText {
    text: SharedString,
}

/// `text` sized to its exact advance (no whole-point rounding).
pub fn exact_text(text: impl Into<SharedString>) -> ExactText {
    ExactText { text: text.into() }
}

impl ExactText {
    fn shape(&self, window: &mut Window) -> (ShapedLine, Pixels) {
        let style = window.text_style();
        let rem = window.rem_size();
        let line = window.text_system().shape_line(
            self.text.clone(),
            style.font_size.to_pixels(rem),
            &[style.to_run(self.text.len())],
            None,
        );
        (line, style.line_height_in_pixels(rem))
    }
}

impl IntoElement for ExactText {
    type Element = Self;
    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for ExactText {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let (line, line_height) = self.shape(window);
        let mut style = Style::default();
        style.size.width = line.width.into();
        style.size.height = line_height.into();
        style.flex_shrink = 0.;
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        _: &mut Window,
        _: &mut App,
    ) {
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        let (line, _) = self.shape(window);
        line.paint(
            bounds.origin,
            bounds.size.height,
            TextAlign::Left,
            None,
            window,
            cx,
        )
        .ok();
    }
}
