//! One line of text with CSS `letter-spacing` (GPUI's text style has none):
//! the line is shaped once, then each glyph is painted with the tracking
//! added after every character before it, and the measured width includes
//! it, as Chromium lays it out. Used where the product tightens a heading
//! (`letter-spacing: -0.035em` on the homepage prompt).
use gpui::*;

pub struct TrackedText {
    text: SharedString,
    /// Tracking as a share of the font size (`-0.035` for `-0.035em`).
    em: f32,
}

/// `text` in the ambient text style, tracked by `em` of its font size.
pub fn tracked_text(text: impl Into<SharedString>, em: f32) -> TrackedText {
    TrackedText {
        text: text.into(),
        em,
    }
}

struct Laid {
    line: ShapedLine,
    line_height: Pixels,
    tracking: Pixels,
    color: Hsla,
}

fn shape(text: &SharedString, em: f32, window: &mut Window) -> Laid {
    let style = window.text_style();
    let rem = window.rem_size();
    let font_size = style.font_size.to_pixels(rem);
    let line_height = style.line_height.to_pixels(font_size.into(), rem);
    let run = style.to_run(text.len());
    let line = window
        .text_system()
        .shape_line(text.clone(), font_size, &[run], None);
    Laid {
        line,
        line_height,
        tracking: font_size * em,
        color: style.color,
    }
}
fn glyph_count(line: &ShapedLine) -> usize {
    line.runs.iter().map(|run| run.glyphs.len()).sum()
}

impl IntoElement for TrackedText {
    type Element = Self;
    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for TrackedText {
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
        let laid = shape(&self.text, self.em, window);
        let width = laid.line.width + laid.tracking * glyph_count(&laid.line) as f32;
        let mut style = Style::default();
        style.size.width = width.max(Pixels::ZERO).into();
        style.size.height = laid.line_height.into();
        (window.request_layout(style, None, cx), ())
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
        _: &mut App,
    ) {
        let laid = shape(&self.text, self.em, window);
        let padding_top = (laid.line_height - laid.line.ascent - laid.line.descent) / 2.;
        let baseline = bounds.origin.y + padding_top + laid.line.ascent;
        let font_size = laid.line.font_size;
        let mut index = 0;
        for run in &laid.line.runs {
            for glyph in &run.glyphs {
                let origin = point(
                    bounds.origin.x + glyph.position.x + laid.tracking * index as f32,
                    baseline,
                );
                if glyph.is_emoji {
                    window
                        .paint_emoji(origin, run.font_id, glyph.id, font_size)
                        .ok();
                } else {
                    window
                        .paint_glyph(origin, run.font_id, glyph.id, font_size, laid.color)
                        .ok();
                }
                index += 1;
            }
        }
    }
}
