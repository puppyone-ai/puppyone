//! `text-unified` (`TextUnifiedDiff`): numbered lines with their `+` / `-`
//! marker, tinted by kind, long lines wrapped; hunks separated by a hairline.
use super::{DiffPalette, Row};
use crate::{
    formats::FileFormat,
    localization::{t as tr, tf},
    platform::git_diff::{DiffLine, FileDiff, LineKind},
    theme,
};
use gpui::{prelude::*, *};
use gpui_kit::base::h_flex;

pub(super) fn rows(index: usize, file: &FileDiff, _: &FileFormat, rows: &mut Vec<Row>) {
    let truncated = || -> SharedString {
        if file.omitted_lines > 0 {
            tf(
                "source-control.diff.truncatedCount",
                &[("count", (file.omitted_lines as i64).into())],
            )
            .into()
        } else {
            tr("source-control.diff.truncated").into()
        }
    };
    if file.lines.is_empty() {
        let text = if file.truncated {
            truncated()
        } else {
            tr("source-control.diff.noText").into()
        };
        rows.push(Row::Placeholder {
            file: index,
            text,
            last: true,
        });
        return;
    }
    let start = rows.len();
    for (line, diff) in file.lines.iter().enumerate() {
        if diff.kind == LineKind::Hunk {
            // `.desktop-diff-hunk-separator:first-child { display: none }`.
            if line > 0 {
                rows.push(Row::Separator { file: index });
            }
        } else {
            rows.push(Row::Line {
                file: index,
                line,
                last: false,
            });
        }
    }
    if file.truncated {
        rows.push(Row::Placeholder {
            file: index,
            text: truncated(),
            last: true,
        });
    } else if let Some(Row::Line { last, .. }) = rows[start..].last_mut() {
        *last = true;
    }
}

/// Tabs at the browser's 8-column stops (`white-space: pre-wrap`).
fn expand_tabs(text: &str) -> String {
    if !text.contains('\t') {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len() + 8);
    let mut column = 0;
    for c in text.chars() {
        if c == '\t' {
            let width = 8 - column % 8;
            out.extend(std::iter::repeat_n(' ', width));
            column += width;
        } else {
            out.push(c);
            column += 1;
        }
    }
    out
}

/// `.desktop-diff-line`.
pub(super) fn line(line: &DiffLine, p: &DiffPalette, density: super::Density) -> Div {
    let t = p.t;
    let (bg, fg, prefix, prefix_color) = match line.kind {
        LineKind::Add => (p.added_bg, p.added_text, "+", t.success),
        LineKind::Remove => (p.removed_bg, p.removed_text, "-", t.danger),
        _ => (p.code_bg, t.muted, " ", t.muted),
    };
    let number = if line.kind == LineKind::Remove {
        line.old_line
    } else {
        line.new_line.or(line.old_line)
    };
    h_flex()
        .items_start()
        .min_h(px(18.))
        .bg(bg)
        .text_color(fg)
        .font_family(theme::MONO)
        .text_size(px(density.code_size()))
        .line_height(px(18.))
        .child(
            // `.line-number`: the density's width; the shared code-editor rule
            // (`code-editor.css`) wins the cascade for its colour and its
            // 12px inset, the diff's own opacity still applies.
            div()
                .w(px(density.number_width()))
                .flex_shrink_0()
                .pr(px(12.))
                .text_right()
                .text_color(theme::alpha(t.text_disabled, 0.52))
                .child(number.map(|n| n.to_string()).unwrap_or_default()),
        )
        .child(
            // `font-weight: 650` on the mono face: its 600 instance.
            div()
                .w(px(18.))
                .flex_shrink_0()
                .text_center()
                .font_family("PuppyOne Geist Mono 600")
                .text_color(prefix_color)
                .child(prefix),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .pr(px(10.))
                .child(if line.text.is_empty() {
                    " ".to_owned()
                } else {
                    expand_tabs(&line.text)
                }),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn tabs_expand_to_eight_column_stops() {
        assert_eq!(expand_tabs("a\tb"), "a       b");
        assert_eq!(expand_tabs("\t\tx"), " ".repeat(16) + "x");
        assert_eq!(expand_tabs("plain"), "plain");
    }
}
