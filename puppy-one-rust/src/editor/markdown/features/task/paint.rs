//! Task checkbox and completed-item strikethrough (`TODO-46`):
//! - Checkbox: a `1.05em` box centred in the list marker slot within a `24px`
//!   hit target; checked boxes fill with `--po-accent` and show a check mark.
//! - Completed strikethrough: paints a non-interactive `1px` line-through per
//!   wrapped row in `TaskStyle.completed_decoration`
//!   (`--po-md-task-completed-decoration-color`), distinct from the muted text
//!   colour (`--po-md-task-completed-color`).
use super::style::TaskStyle;
use crate::editor::view::{
    projection::LeafText,
    render::{RenderCx, chromium_baseline, primary_metrics},
    style::{Embed, Paint, Rect, TextStyle},
    widget::{LineEmbed, WidgetCx},
};
use gpui::{prelude::*, *};
use std::{
    hash::{Hash, Hasher},
    ops::Range,
    rc::Rc,
};

/// Builds a `LineStyle::embed` that paints the completed-task strikethrough
/// using `style.completed_decoration` (`--po-md-task-completed-decoration-color`)
/// over the live editable Kit text leaf (`TODO-46`).
pub fn completed_strike_embed(
    range: &Range<usize>,
    text: &TextStyle,
    nowrap: bool,
    task: &TaskStyle,
) -> Embed {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (
        "task-completed-strike",
        range.start,
        range.end,
        text.family(),
        text.size.to_bits(),
        text.weight.to_bits(),
        text.italic,
        nowrap,
        task.completed_decoration.r.to_bits(),
        task.completed_decoration.g.to_bits(),
        task.completed_decoration.b.to_bits(),
        task.completed_decoration.a.to_bits(),
    )
        .hash(&mut h);
    Embed {
        key: h.finish(),
        content: Rc::new(CompletedStrike {
            text: text.clone(),
            nowrap,
            color: task.completed_decoration,
        }),
    }
}

pub struct CompletedStrike {
    pub text: TextStyle,
    pub nowrap: bool,
    pub color: Rgba,
}

impl CompletedStrike {
    fn shaping_runs(leaf: &LeafText, style: &TextStyle) -> Vec<TextRun> {
        let base = RenderCx::font(style);
        let mono = TextStyle {
            mono: true,
            ..style.clone()
        }
        .family();
        let make_run = |len: usize, bold: bool, italic: bool, code: bool| TextRun {
            len,
            font: Font {
                family: if code {
                    mono.clone()
                } else {
                    base.family.clone()
                },
                weight: if bold { FontWeight::BOLD } else { base.weight },
                style: if italic {
                    FontStyle::Italic
                } else {
                    base.style
                },
                ..base.clone()
            },
            color: style.color.into(),
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let mut runs = Vec::new();
        let mut at = 0;
        for (r, m) in &leaf.marks {
            if r.start > at {
                runs.push(make_run(r.start - at, false, false, false));
            }
            runs.push(make_run(r.len(), m.bold, m.italic, m.code));
            at = r.end;
        }
        if at < leaf.text.len() {
            runs.push(make_run(leaf.text.len() - at, false, false, false));
        }
        runs
    }
}

impl LineEmbed for CompletedStrike {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let scale = cx.render.scale;
        let row_lh = (self.text.line_height_px() * scale * 64.).floor() / (scale * 64.);
        let d = cx.render.decorations;
        let replaced: Vec<(Range<usize>, SharedString)> = d
            .inline_widgets_in(&cx.source)
            .iter()
            .filter(|w| w.replaces_text())
            .map(|w| {
                let room = cx.render.rooms.iter().find(|r| r.range == w.range);
                (
                    w.range.clone(),
                    room.map_or_else(|| w.display_text().clone(), |r| r.text.clone()),
                )
            })
            .collect();
        let hidden = d.hidden_in(&cx.source);
        let marks = d.marks_in(&cx.source);
        let leaf = LeafText::build_from_buffer(
            cx.render.doc,
            cx.source.clone(),
            &hidden,
            &replaced,
            &marks,
            false,
        );
        if leaf.text.is_empty() {
            return (div().size_full().into_any_element(), row_lh);
        }
        let wrap = (!self.nowrap).then(|| cx.render.snap(cx.width));
        let runs = Self::shaping_runs(&leaf, &self.text);
        let shaped = cx.render.window.text_system().shape_text(
            leaf.text.clone().into(),
            px(self.text.size),
            &runs,
            wrap.map(px),
            None,
        );
        let Some(line) = shaped.ok().and_then(|lines| lines.into_iter().next()) else {
            return (div().size_full().into_any_element(), row_lh);
        };
        let rows = line.wrap_boundaries.len() + 1;
        let total_height = rows as f32 * row_lh;
        let primary = primary_metrics(cx.render.window, &self.text);
        let mut row_spans: Vec<Option<(f32, f32)>> = vec![None; rows];
        for (byte_idx, ch) in leaf.text.char_indices() {
            let end_idx = byte_idx + ch.len_utf8();
            let (Some(p0), Some(p1)) = (
                line.position_for_index(byte_idx, px(row_lh)),
                line.position_for_index(end_idx, px(row_lh)),
            ) else {
                continue;
            };
            let (y0, y1) = (f32::from(p0.y), f32::from(p1.y));
            if (y1 - y0).abs() > 0.5 {
                // Soft-wrap boundary space: belongs to neither row's visible strike span.
                continue;
            }
            let r = ((y0 / row_lh.max(1.)).round() as usize).min(rows - 1);
            let (x0, x1) = (f32::from(p0.x), f32::from(p1.x));
            if x1 > x0 {
                row_spans[r] = Some(match row_spans[r] {
                    Some((min_x, max_x)) => (min_x.min(x0), max_x.max(x1)),
                    None => (x0, x1),
                });
            }
        }
        let mut rules = Vec::new();
        for (r, span) in row_spans.into_iter().enumerate() {
            let Some((x0, x1)) = span else { continue };
            let baseline = chromium_baseline(scale, &self.text, primary, r as f32 * row_lh);
            let strike_y = cx.render.snap(baseline - 0.28 * self.text.size);
            rules.push(
                div()
                    .absolute()
                    .left(px(x0))
                    .top(px(strike_y))
                    .w(px((x1 - x0).max(0.)))
                    .h(px(1.))
                    .bg(self.color)
                    .into_any_element(),
            );
        }
        (
            div()
                .relative()
                .w(px(cx.width))
                .h(px(total_height))
                .children(rules)
                .into_any_element(),
            total_height,
        )
    }
}

/// The box and its hit target for a marker slot (`left`, `width`) on a row
/// at `top` of `line_height`, at font size `em`.
pub fn checkbox(
    style: &TaskStyle,
    checked: bool,
    slot: (f32, f32),
    top: f32,
    line_height: f32,
    em: f32,
) -> (Vec<Paint>, Rect) {
    let (left, width) = slot;
    let size = style.box_em * em;
    let hit_x = left + (width - style.hit) / 2.;
    let hit_y = top + line_height / 2. - style.hit / 2.;
    let bx = hit_x + (style.hit - size) / 2.;
    let by = hit_y + (style.hit - size) / 2.;
    let (border, background) = if checked {
        (style.checked, Some(style.checked))
    } else {
        (style.box_border, None)
    };
    let mut paints = vec![Paint::Quad {
        rect: Rect::new(bx, by, size, size),
        background,
        radii: [style.radius; 4],
        border: style.border_width,
        border_color: Some(border),
    }];
    if checked {
        paints.push(check_mark(style, bx, by, size, em));
    }
    (paints, Rect::new(hit_x, hit_y, style.hit, style.hit))
}

/// The checked box's `::after`: a 0.3em × 0.55em box with 0.13em right and
/// bottom borders, rotated 45° about its centre, centred in the checkbox
/// content box and raised by its -0.1em top margin.
fn check_mark(style: &TaskStyle, bx: f32, by: f32, size: f32, em: f32) -> Paint {
    let (w, h, t) = (0.3 * em, 0.55 * em, 0.13 * em);
    let (bw, bh) = (w + t, h + t);
    let inner = size - 2. * style.border_width;
    let cx = bx + style.border_width + inner / 2.;
    let cy = by + style.border_width + (inner - (bh - 0.1 * em)) / 2. - 0.1 * em + bh / 2.;
    let shape = [(w, 0.), (bw, 0.), (bw, bh), (0., bh), (0., h), (w, h)];
    let (sin, cos) = std::f32::consts::FRAC_PI_4.sin_cos();
    let points = shape
        .iter()
        .map(|&(x, y)| {
            let (dx, dy) = (x - bw / 2., y - bh / 2.);
            (cx + dx * cos - dy * sin, cy + dx * sin + dy * cos)
        })
        .collect();
    Paint::Polygon {
        points,
        color: style.check,
    }
}
