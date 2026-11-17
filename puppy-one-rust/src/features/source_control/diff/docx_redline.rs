//! `docx-redline` (`DocxRedlineView`): a Word document's body changes —
//! the document's state, word and block totals, each changed block with
//! its place and word-level additions and removals, and what the
//! comparison leaves out. Each part is one list row inside the card.
use super::{DiffPalette, Row};
use crate::{
    formats::FileFormat,
    localization::{t as tr, tf},
    platform::{
        docx_redline::{BlockKind, Change, ChangeKind, Presentation, SegmentKind, State},
        git_diff::FileDiff,
    },
    theme,
    ui::components::Icon,
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};

/// One part of the redline, in order.
#[derive(Clone, Debug, PartialEq)]
pub enum Part {
    /// `.desktop-docx-diff-state.error`: why there is no redline.
    Error,
    /// `.desktop-docx-diff-state`: no body change to show.
    Unchanged,
    /// `.desktop-docx-redline-document-state` (added, deleted, empty).
    DocumentState,
    Summary,
    Change(usize),
    /// `.desktop-docx-redline-limit`.
    Limit,
    /// `.desktop-docx-redline-fidelity`.
    Fidelity,
}

/// `.desktop-docx-redline { padding: 14px; gap: 12px }`; the changes list
/// `gap: 7px`.
const PAD: f32 = 14.;
const GAP: f32 = 12.;
const CHANGE_GAP: f32 = 7.;

pub(super) fn rows(index: usize, file: &FileDiff, _: &FileFormat, rows: &mut Vec<Row>) {
    let parts = match &file.redline {
        Some(Ok(model)) if !model.changes.is_empty() => {
            let mut parts = Vec::new();
            if model.state != State::Ready {
                parts.push(Part::DocumentState);
            }
            parts.push(Part::Summary);
            parts.extend((0..model.changes.len()).map(Part::Change));
            if model.truncated {
                parts.push(Part::Limit);
            }
            parts.push(Part::Fidelity);
            parts
        }
        Some(Ok(_)) => vec![Part::Unchanged],
        _ => vec![Part::Error],
    };
    let count = parts.len();
    let mut previous: Option<&Part> = None;
    for (i, part) in parts.iter().enumerate() {
        let top = match (previous, part) {
            (None, _) => 0.,
            (Some(Part::Change(_)), Part::Change(_)) => CHANGE_GAP,
            _ => GAP,
        };
        rows.push(Row::Redline {
            file: index,
            part: part.clone(),
            top,
            last: i + 1 == count,
        });
        previous = Some(part);
    }
}

/// One part, padded as the panel lays it out: the panel's padding before
/// the first part and after the last, the gap before the others.
pub(super) fn part(file: &FileDiff, part: &Part, top: f32, last: bool, p: &DiffPalette) -> Div {
    let t = p.t;
    let first = top == 0. && !matches!(part, Part::Error | Part::Unchanged);
    let body = match (&file.redline, part) {
        (redline, Part::Error) => {
            let message = match redline {
                Some(Err(message)) => message.as_str(),
                _ => "",
            };
            state(
                true,
                tr("source-control.diff.docx.unavailable").into(),
                vec![tf(
                    "source-control.diff.docx.unavailableDetail",
                    &[(
                        "detail",
                        crate::localization::bidi_isolate(message).as_str().into(),
                    )],
                )],
                p,
            )
        }
        (Some(Ok(model)), Part::Unchanged) => state(
            false,
            state_label(model.state).into(),
            vec![
                tr("source-control.diff.docx.noParagraphChanges").into(),
                tr("source-control.diff.docx.fidelity.bodyTextV1").into(),
            ],
            p,
        ),
        (Some(Ok(model)), Part::DocumentState) => document_state(model.state, p),
        (Some(Ok(model)), Part::Summary) => summary(model, p),
        (Some(Ok(model)), Part::Change(i)) => model
            .changes
            .get(*i)
            .map_or_else(div, |change| block(change, p)),
        (Some(Ok(_)), Part::Limit) => note(tr("source-control.diff.docx.truncated").into(), p),
        (Some(Ok(_)), Part::Fidelity) => {
            note(tr("source-control.diff.docx.fidelity.bodyTextV1").into(), p)
        }
        _ => div(),
    };
    let panel = matches!(part, Part::Error | Part::Unchanged);
    div()
        .bg(theme::mix(t.panel, t.inset, 0.72))
        .when(!panel, |d| {
            d.px(px(PAD))
                .pt(px(if first { PAD } else { top }))
                .when(last, |d| d.pb(px(PAD)))
        })
        .child(body)
}

/// `documentStateLabel`.
fn state_label(state: State) -> &'static str {
    tr(match state {
        State::Added => "source-control.diff.docx.state.added",
        State::Deleted => "source-control.diff.docx.state.deleted",
        State::Empty => "source-control.diff.docx.state.empty",
        State::Ready => "source-control.diff.docx.state.ready",
    })
}

/// `.desktop-docx-diff-state`: a 72px panel with a title and its lines.
fn state(error: bool, title: SharedString, lines: Vec<String>, p: &DiffPalette) -> Div {
    let t = p.t;
    let m = theme::ty();
    h_flex()
        .min_h(px(72.))
        .items_center()
        .gap(px(8.))
        .p(px(PAD))
        .text_size(px(m.ui.meta))
        .text_color(if error { t.danger } else { t.muted })
        .when(error, |d| {
            d.child(Icon::new("file-warning").with_size(px(16.)).color(t.danger))
        })
        .child(
            v_flex()
                .flex_1()
                .min_w_0()
                .gap(px(2.))
                .child(div().font_weight(FontWeight::BOLD).child(title))
                .children(lines.into_iter().map(|line| {
                    div()
                        .text_size(px(m.ui.caption))
                        .text_color(t.subtle)
                        .child(line)
                })),
        )
}

/// `.desktop-docx-redline-document-state`: an uppercase badge, green for
/// a new document and red for a removed one.
fn document_state(state: State, p: &DiffPalette) -> Div {
    let t = p.t;
    let m = theme::ty();
    let color = match state {
        State::Added => t.success,
        State::Deleted => t.danger,
        _ => t.accent,
    };
    h_flex().child(
        div()
            .px(px(7.))
            .py(px(3.))
            .rounded(px(4.))
            .bg(theme::alpha(color, 0.08))
            .text_color(color)
            .text_size(px(m.ui.micro))
            .font_weight(FontWeight(650.))
            .child(state_label(state).to_uppercase()),
    )
}

/// `.desktop-docx-redline-summary`: words added and deleted, blocks
/// changed.
fn summary(model: &Presentation, p: &DiffPalette) -> Div {
    let t = p.t;
    let m = theme::ty();
    let count = |key: &str, n: usize| tf(key, &[("count", (n as i64).into())]);
    h_flex()
        .flex_wrap()
        .gap_x(px(12.))
        .gap_y(px(6.))
        .text_size(px(m.ui.caption))
        .text_color(t.subtle)
        .child(div().text_color(t.success).child(count(
            "source-control.diff.docx.wordsAdded",
            model.stats.words_added,
        )))
        .child(div().text_color(t.danger).child(count(
            "source-control.diff.docx.wordsDeleted",
            model.stats.words_deleted,
        )))
        .child(count(
            "source-control.diff.docx.blocksChanged",
            model.stats.blocks_changed,
        ))
}

/// `blockKindLabel`.
fn kind_label(kind: BlockKind) -> &'static str {
    tr(match kind {
        BlockKind::TableRow => "source-control.diff.docx.block.tableRow",
        BlockKind::ListItem => "source-control.diff.docx.block.listItem",
        BlockKind::Heading => "source-control.diff.docx.block.heading",
        BlockKind::Paragraph => "source-control.diff.docx.block.paragraph",
    })
}

/// `formatLocation`.
fn location(change: &Change) -> String {
    let number = |i: usize| ((i + 1) as i64).into();
    match (change.before, change.after) {
        (Some(before), Some(after)) => tf(
            "source-control.diff.docx.location.changed",
            &[("before", number(before)), ("after", number(after))],
        ),
        (Some(i), None) | (None, Some(i)) => tf(
            "source-control.diff.docx.location.paragraph",
            &[("number", number(i))],
        ),
        (None, None) => tr("source-control.diff.docx.location.document").into(),
    }
}

/// `.desktop-docx-redline-block`: the block's kind and place beside its
/// text, additions and removals marked, on a rule coloured by the change.
fn block(change: &Change, p: &DiffPalette) -> Div {
    let t = p.t;
    let m = theme::ty();
    let rule = match change.kind {
        ChangeKind::Added => theme::mix(t.success, t.divider, 0.62),
        ChangeKind::Deleted => theme::mix(t.danger, t.divider, 0.62),
        ChangeKind::Modified => theme::mix(t.accent, t.divider, 0.46),
    };
    let mut text = String::new();
    let mut highlights = Vec::new();
    for segment in &change.segments {
        let start = text.len();
        text.push_str(&segment.text);
        let style = match segment.kind {
            SegmentKind::Equal => continue,
            SegmentKind::Add => HighlightStyle {
                color: Some(theme::mix(t.success, t.text, 0.64).into()),
                background_color: Some(theme::alpha(t.success, 0.13).into()),
                ..Default::default()
            },
            SegmentKind::Remove => HighlightStyle {
                color: Some(theme::mix(t.danger, t.text, 0.62).into()),
                background_color: Some(theme::alpha(t.danger, 0.12).into()),
                strikethrough: Some(StrikethroughStyle {
                    thickness: px(1.),
                    color: Some(theme::mix(t.danger, t.text, 0.62).into()),
                }),
                ..Default::default()
            },
        };
        highlights.push((start..text.len(), style));
    }
    h_flex()
        .items_start()
        .gap(px(10.))
        .py(px(9.))
        .px(px(10.))
        .border_l_2()
        .border_color(rule)
        .rounded(px(3.))
        .bg(theme::alpha(t.control, 0.32))
        .child(
            v_flex()
                .w(px(94.))
                .flex_none()
                .gap(px(1.))
                .text_size(px(m.ui.micro))
                .text_color(t.subtle)
                .child(kind_label(change.block))
                .child(
                    div()
                        .font_family(theme::MONO)
                        .text_color(t.text_disabled)
                        .child(location(change)),
                ),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .text_size(px(m.ui.meta))
                .line_height(relative(1.6))
                .text_color(t.muted)
                .whitespace_normal()
                .child(StyledText::new(text).with_highlights(highlights)),
        )
}

/// `.desktop-docx-redline-fidelity` / `-limit`: a ruled footnote.
fn note(text: SharedString, p: &DiffPalette) -> Div {
    let t = p.t;
    let m = theme::ty();
    div()
        .pt(px(8.))
        .border_t_1()
        .border_color(t.border_subtle)
        .text_size(px(m.ui.micro))
        .line_height(relative(1.45))
        .text_color(t.text_disabled)
        .child(text)
}
