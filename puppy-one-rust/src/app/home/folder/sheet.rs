//! Miniature asset preview sheets peeking between `folder-back` and
//! `folder-front` (`ProjectFolderGlyph.tsx` and `.project-folder-preview`).
use super::super::previews::{PreviewKind, ProjectAssetPreview};
use crate::{
    theme::{self, Theme},
    ui::moments::paint,
};
use gpui::{prelude::*, *};
use gpui_kit::base::h_flex;

fn fade_color(color: Rgba, strength: Option<f32>, t: Theme) -> Rgba {
    strength.map_or(color, |w| theme::mix(color, t.canvas, w))
}

fn preview_accent(kind: PreviewKind, t: Theme) -> Rgba {
    match kind {
        PreviewKind::Html => t.file.html,
        PreviewKind::Md => t.file.markdown,
        PreviewKind::Csv => t.file.sheet,
        PreviewKind::Other => t.file.default,
    }
}

pub(super) fn grid_sheet_placements(
    count: usize,
) -> (&'static [(f32, f32, f32)], &'static [usize]) {
    match count {
        1 => (&[(30., 4., 1.5)], &[0]),
        2 => (&[(16., 6., -4.5), (44., 4., 4.5)], &[0, 1]),
        _ => (
            &[(8., 8., -6.5), (30., 3., 1.5), (52., 8., 6.5)],
            &[0, 2, 1],
        ),
    }
}

pub(super) fn compact_sheet_placements(count: usize) -> (&'static [(f32, f32)], &'static [usize]) {
    match count {
        1 => (&[(9.5, 1.5)], &[0]),
        2 => (&[(6.5, 2.), (12.5, 1.)], &[0, 1]),
        _ => (&[(4., 3.), (9.5, 1.), (15., 3.)], &[0, 2, 1]),
    }
}

fn rotate_point(local: (f32, f32), origin: (f32, f32), degrees: f32, w: f32, h: f32) -> (f32, f32) {
    let (cx, cy) = (origin.0 + w / 2., origin.1 + h / 2.);
    let (dx, dy) = (origin.0 + local.0 - cx, origin.1 + local.1 - cy);
    let (sin, cos) = degrees.to_radians().sin_cos();
    (cx + dx * cos - dy * sin, cy + dx * sin + dy * cos)
}

fn badge_width(label: &str) -> f32 {
    match label {
        "HTML" => 22.,
        "CSV" => 18.,
        _ => 14.5,
    }
}

pub(super) fn render_grid_sheet(
    preview: &ProjectAssetPreview,
    placement: (f32, f32, f32),
    left_shoulder_badge: bool,
    fade: Option<f32>,
    t: Theme,
) -> Div {
    let (left, top, degrees) = placement;
    let (w, h) = (44., 37.);
    let pad = 4.;
    let gap = 2.5;
    let kind = preview.kind;
    let badge = kind.badge();
    let accent = preview_accent(kind, t);

    let card_bg = fade_color(t.panel_raised, fade, t);
    let card_border = fade_color(t.border_subtle, fade, t);
    let shadow_ink = fade_color(
        theme::alpha(t.shadow, if t.dark { 0.24 } else { 0.16 }),
        fade,
        t,
    );
    let title_ink = fade_color(theme::mix(t.text, t.panel_raised, 0.52), fade, t);
    let line_ink = fade_color(theme::mix(t.text, t.panel_raised, 0.13), fade, t);
    let badge_bg = fade_color(theme::mix(accent, t.panel_raised, 0.16), fade, t);
    let badge_ink = fade_color(theme::mix(accent, t.text, 0.88), fade, t);

    let draw = paint::paint(move |bounds, window| {
        let origin = point(bounds.origin.x + px(left), bounds.origin.y + px(top));
        let pivot = point(origin.x + px(w / 2.), origin.y + px(h / 2.));
        let rect = |window: &mut Window,
                    lx: f32,
                    ly: f32,
                    rw: f32,
                    rh: f32,
                    radius: f32,
                    fill: Option<Rgba>,
                    stroke: Option<(f32, Rgba)>| {
            paint::turned_rect(
                window,
                point(origin.x + px(lx), origin.y + px(ly)),
                size(px(rw), px(rh)),
                radius,
                pivot,
                degrees,
                fill,
                stroke,
            );
        };

        // Soft low-elevation shadow + card body.
        paint::turned_rect(
            window,
            point(origin.x, origin.y + px(1.5)),
            size(px(w), px(h)),
            4.,
            pivot,
            degrees,
            Some(shadow_ink),
            None,
        );
        rect(
            window,
            0.,
            0.,
            w,
            h,
            4.,
            Some(card_bg),
            Some((1., card_border)),
        );

        // Title bar (`margin-block-start: 9px` when badge sits on the left shoulder).
        let inner_w = w - pad * 2.;
        let title_y = pad + if left_shoulder_badge { 9. } else { 0. };
        let title_w = inner_w * if kind == PreviewKind::Csv { 0.32 } else { 0.42 };
        rect(
            window,
            pad,
            title_y,
            title_w,
            3.,
            1.5,
            Some(title_ink),
            None,
        );

        // Kind-specific miniature content.
        let content_y = title_y + 3. + gap;
        match kind {
            PreviewKind::Html => {
                let chart_bottom = h - pad;
                let usable_h = (chart_bottom - content_y - 3.).max(6.);
                let bars_w = inner_w - 3.;
                let bar_w = (bars_w - 5.) / 3.;
                for (idx, (height_frac, opacity)) in [(0.42, 0.6), (0.66, 0.8), (0.90, 1.0)]
                    .into_iter()
                    .enumerate()
                {
                    let bh = usable_h * height_frac;
                    let bx = pad + 1.5 + idx as f32 * (bar_w + 2.5);
                    let by = chart_bottom - 1. - bh;
                    let fill =
                        fade_color(theme::mix(accent, t.panel_raised, 0.56 * opacity), fade, t);
                    rect(window, bx, by, bar_w, bh, 1., Some(fill), None);
                }
                rect(
                    window,
                    pad,
                    chart_bottom - 1.,
                    inner_w,
                    1.,
                    0.5,
                    Some(card_border),
                    None,
                );
            }
            PreviewKind::Csv => {
                let cell_w = (inner_w - 3.) / 3.;
                let row0 = fade_color(theme::mix(accent, t.panel_raised, 0.42), fade, t);
                let row1 = fade_color(theme::mix(accent, t.panel_raised, 0.16), fade, t);
                for row in 0..2 {
                    let cy = content_y + row as f32 * (3.5 + 1.5);
                    let fill = if row == 0 { row0 } else { row1 };
                    for col in 0..3 {
                        let cx = pad + col as f32 * (cell_w + 1.5);
                        rect(window, cx, cy, cell_w, 3.5, 1., Some(fill), None);
                    }
                }
            }
            PreviewKind::Md | PreviewKind::Other => {
                rect(
                    window,
                    pad,
                    content_y,
                    inner_w,
                    2.5,
                    1.25,
                    Some(line_ink),
                    None,
                );
                rect(
                    window,
                    pad,
                    content_y + 2.5 + gap,
                    inner_w * 0.74,
                    2.5,
                    1.25,
                    Some(line_ink),
                    None,
                );
            }
        }

        if let Some(label) = badge {
            let bw = badge_width(label);
            let bx = if left_shoulder_badge {
                2.5
            } else {
                w - 2.5 - bw
            };
            rect(window, bx, 2.5, bw, 9., 2., Some(badge_bg), None);
        }
    });

    let layer = div().absolute().inset_0().child(draw);
    let Some(label) = badge else {
        return layer;
    };
    let bw = badge_width(label);
    let bx = if left_shoulder_badge {
        2.5
    } else {
        w - 2.5 - bw
    };
    let (center_x, center_y) = rotate_point((bx + bw / 2., 2.5 + 4.5), (left, top), degrees, w, h);
    layer.child(
        div()
            .absolute()
            .left(px(center_x - bw / 2.))
            .top(px(center_y - 4.5))
            .w(px(bw))
            .h(px(9.))
            .flex()
            .items_center()
            .justify_center()
            .font_family(theme::MONO)
            .text_size(px(7.))
            .line_height(px(7.))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(badge_ink)
            .child(label),
    )
}

pub(super) fn render_compact_sheet(
    preview: &ProjectAssetPreview,
    placement: (f32, f32),
    fade: Option<f32>,
    t: Theme,
) -> Div {
    let (left, top) = placement;
    let kind = preview.kind;
    let accent = preview_accent(kind, t);
    let card_bg = fade_color(t.panel_raised, fade, t);
    let card_border = fade_color(t.border_subtle, fade, t);
    let title_ink = fade_color(theme::mix(t.text, t.panel_raised, 0.52), fade, t);
    let line_ink = fade_color(theme::mix(t.text, t.panel_raised, 0.13), fade, t);

    let content: AnyElement =
        match kind {
            PreviewKind::Html => h_flex()
                .flex_1()
                .w_full()
                .items_end()
                .gap(px(1.))
                .px(px(1.))
                .border_b_1()
                .border_color(card_border)
                .children([(0.42, 0.6), (0.66, 0.8), (0.90, 1.0)].into_iter().map(
                    |(frac, opacity)| {
                        div()
                            .flex_1()
                            .h(relative(frac))
                            .rounded_t(px(1.))
                            .bg(fade_color(
                                theme::mix(accent, t.panel_raised, 0.56 * opacity),
                                fade,
                                t,
                            ))
                    },
                ))
                .into_any_element(),
            PreviewKind::Csv => div()
                .flex()
                .flex_col()
                .gap(px(1.))
                .w_full()
                .children((0..2).map(|row| {
                    let fill = fade_color(
                        theme::mix(accent, t.panel_raised, if row == 0 { 0.42 } else { 0.16 }),
                        fade,
                        t,
                    );
                    h_flex().w_full().gap(px(1.)).children(
                        (0..3).map(|_| div().flex_1().h(px(1.5)).rounded(px(0.5)).bg(fill)),
                    )
                }))
                .into_any_element(),
            PreviewKind::Md | PreviewKind::Other => div()
                .flex()
                .flex_col()
                .gap(px(1.))
                .w_full()
                .child(div().w_full().h(px(1.5)).rounded(px(0.75)).bg(line_ink))
                .child(
                    div()
                        .w(relative(0.74))
                        .h(px(1.5))
                        .rounded(px(0.75))
                        .bg(line_ink),
                )
                .into_any_element(),
        };

    div()
        .absolute()
        .left(px(left))
        .top(px(top))
        .w(px(15.))
        .h(px(12.))
        .p(px(2.))
        .gap(px(1.))
        .flex()
        .flex_col()
        .overflow_hidden()
        .rounded(px(2.))
        .bg(card_bg)
        .border_1()
        .border_color(card_border)
        .child(
            div()
                .w(relative(if kind == PreviewKind::Csv { 0.32 } else { 0.42 }))
                .h(px(1.5))
                .rounded(px(0.75))
                .bg(title_ink),
        )
        .child(content)
}
