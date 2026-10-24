//! `binary-summary` (`BinarySummaryDiff`): what changed when nothing can be
//! compared line by line — the format, the size on each side, and the
//! current file to open.
use super::{DiffPalette, Row};
use crate::{
    formats::FileFormat,
    localization::t as tr,
    platform::git_diff::{FileDiff, Side},
    theme,
    ui::components::{Button, ButtonVariant, Icon},
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};

pub(super) fn rows(index: usize, _: &FileDiff, _: &FileFormat, rows: &mut Vec<Row>) {
    rows.push(Row::Binary {
        file: index,
        last: true,
    });
}

/// `formatBytes` with `Intl.NumberFormat` short units (`en`).
fn bytes(size: Option<u64>) -> String {
    let Some(size) = size else {
        return tr("source-control.diff.binary.unavailable").into();
    };
    let one_decimal = |value: f64| {
        let rounded = (value * 10.).round() / 10.;
        if rounded.fract() == 0. {
            format!("{}", rounded as u64)
        } else {
            format!("{rounded:.1}")
        }
    };
    match size {
        s if s < 1024 => format!("{s} byte"),
        s if s < 1024 * 1024 => format!("{} kB", one_decimal(s as f64 / 1024.)),
        s => format!("{} MB", one_decimal(s as f64 / (1024. * 1024.))),
    }
}

/// `.desktop-binary-diff-side`.
fn side(label: &'static str, side: &Side, p: &DiffPalette) -> Div {
    let t = p.t;
    let m = theme::ty();
    let missing = matches!(side, Side::Missing);
    h_flex()
        .flex_1()
        .min_w_0()
        .justify_between()
        .gap(px(8.))
        .py(px(8.))
        .px(px(10.))
        .border_1()
        .border_color(t.border_subtle)
        .when(missing, |d| d.border_dashed().opacity(0.72))
        .rounded(px(5.))
        .bg(theme::alpha(t.control, 0.4))
        .text_size(px(m.left.meta))
        .line_height(relative(theme::NORMAL_LINE_HEIGHT))
        .text_color(t.subtle)
        .child(tr(label))
        .child(
            div()
                .min_w_0()
                .truncate()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(t.muted)
                .child(match side {
                    Side::Missing => tr("source-control.diff.binary.notPresent").to_owned(),
                    Side::Present(size) => bytes(*size),
                }),
        )
}

pub(super) fn summary(file: &FileDiff, p: &DiffPalette, open_file: Option<super::OpenFile>) -> Div {
    let t = p.t;
    let m = theme::ty();
    let (_, format) = super::resolve(file);
    let path = file.path.clone();
    v_flex()
        .gap(px(12.))
        .p(px(14.))
        .bg(theme::mix(t.panel, t.inset, 0.72))
        .child(
            h_flex()
                .items_start()
                .gap(px(9.))
                .text_color(t.muted)
                .child(Icon::new("file-warning").with_size(px(16.)).color(t.muted))
                .child(
                    v_flex()
                        .gap(px(2.))
                        .child(
                            div()
                                .text_size(px(m.ui.meta))
                                .line_height(relative(theme::NORMAL_LINE_HEIGHT))
                                .font_weight(FontWeight(650.))
                                .text_color(t.text)
                                .child(format.label.clone()),
                        )
                        .child(
                            div()
                                .text_size(px(m.left.meta))
                                .line_height(relative(1.45))
                                .text_color(t.subtle)
                                .child(tr("source-control.diff.binary.noSemanticDiff")),
                        ),
                ),
        )
        .children(file.revision.as_ref().map(|(before, after)| {
            h_flex()
                .gap(px(8.))
                .child(side("source-control.diff.binary.before", before, p))
                .child(side("source-control.diff.binary.after", after, p))
        }))
        .children(open_file.map(|open| {
            h_flex().child(
                Button::new(SharedString::from(format!("binary-open-{path}")))
                    .variant(ButtonVariant::Raised)
                    .icon("external-link")
                    .label(tr("source-control.diff.binary.openCurrentFile"))
                    .on_click(move |_, window, cx| open(&path, window, cx)),
            )
        }))
}

#[cfg(test)]
mod tests {
    use super::bytes;
    use core::prelude::v1::test;

    #[test]
    fn sizes_read_like_intl_short_units() {
        assert_eq!(bytes(Some(100)), "100 byte");
        assert_eq!(bytes(Some(1536)), "1.5 kB");
        assert_eq!(bytes(Some(2048)), "2 kB");
        assert_eq!(bytes(Some(5 * 1024 * 1024 + 300_000)), "5.3 MB");
    }
}
