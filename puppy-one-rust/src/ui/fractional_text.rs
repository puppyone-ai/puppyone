//! Wrapping text laid out at its exact CSS line height.
//!
//! GPUI's text element rounds the line height to whole points
//! (`TextStyle::line_height_in_pixels`), so a 26.25px Markdown line or a
//! 34.5px heading drifts from the product's layout a little more with every
//! line. Chromium keeps fractional line boxes; this element measures and
//! paints wrapped lines at the unrounded height (GPUI's line painter already
//! accepts it) and keeps the measured width fractional too.
use gpui::*;
use std::{cell::RefCell, rc::Rc};

pub struct FractionalText {
    text: SharedString,
    runs: Option<Vec<TextRun>>,
    laid: Rc<RefCell<Option<Laid>>>,
}

struct Laid {
    width: Pixels,
    lines: Vec<WrappedLine>,
    line_height: Pixels,
}

/// `text` in the ambient text style, wrapped at the available width, with
/// the style's line height kept fractional.
pub fn fractional_text(text: impl Into<SharedString>) -> FractionalText {
    FractionalText {
        text: text.into(),
        runs: None,
        laid: Rc::default(),
    }
}

impl FractionalText {
    /// Explicit runs (fonts and colours) covering the whole text.
    pub fn with_runs(mut self, runs: Vec<TextRun>) -> Self {
        self.runs = Some(runs);
        self
    }
}

fn shape(
    text: &SharedString,
    font_size: Pixels,
    runs: &[TextRun],
    wrap_width: Option<Pixels>,
    line_height: Pixels,
    window: &mut Window,
) -> Laid {
    let lines: Vec<WrappedLine> = window
        .text_system()
        .shape_text(text.clone(), font_size, runs, wrap_width, None)
        .map(|lines| lines.into_iter().collect())
        .unwrap_or_default();
    let width = lines
        .iter()
        .map(|line| line.size(line_height).width)
        .fold(Pixels::ZERO, Pixels::max);
    Laid {
        width,
        lines,
        line_height,
    }
}

impl IntoElement for FractionalText {
    type Element = Self;
    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for FractionalText {
    type RequestLayoutState = (Pixels, Vec<TextRun>);
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
        _: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let style = window.text_style();
        let rem = window.rem_size();
        let font_size = style.font_size.to_pixels(rem);
        let line_height = style.line_height.to_pixels(font_size.into(), rem);
        let runs = self
            .runs
            .clone()
            .unwrap_or_else(|| vec![style.to_run(self.text.len())]);
        let (text, measure_runs, laid) = (self.text.clone(), runs.clone(), self.laid.clone());
        let layout_id =
            window.request_measured_layout(Style::default(), move |known, available, window, _| {
                let wrap_width = known.width.or(match available.width {
                    AvailableSpace::Definite(width) => Some(width),
                    _ => None,
                });
                let shaped = shape(
                    &text,
                    font_size,
                    &measure_runs,
                    wrap_width,
                    line_height,
                    window,
                );
                let height = shaped
                    .lines
                    .iter()
                    .map(|line| line.size(line_height).height)
                    .fold(Pixels::ZERO, |sum, h| sum + h);
                let size = size(shaped.width, height);
                *laid.borrow_mut() = Some(shaped);
                size
            });
        (layout_id, (font_size, runs))
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        _: &mut Window,
        _: &mut App,
    ) {
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        (font_size, runs): &mut Self::RequestLayoutState,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        // Reuse the measured lines when they fit the final box; otherwise
        // wrap again at the width layout settled on.
        let fits = self
            .laid
            .borrow()
            .as_ref()
            .is_some_and(|laid| laid.width <= bounds.size.width + px(0.01));
        if !fits {
            let line_height = window
                .text_style()
                .line_height
                .to_pixels((*font_size).into(), window.rem_size());
            let shaped = shape(
                &self.text,
                *font_size,
                runs,
                Some(bounds.size.width),
                line_height,
                window,
            );
            *self.laid.borrow_mut() = Some(shaped);
        }
        let laid = self.laid.borrow();
        let Some(laid) = laid.as_ref() else { return };
        let mut origin = bounds.origin;
        for line in &laid.lines {
            line.paint(origin, laid.line_height, TextAlign::Left, None, window, cx)
                .ok();
            origin.y += line.size(laid.line_height).height;
        }
    }
}
