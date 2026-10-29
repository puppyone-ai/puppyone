//! Format-aware file diffs (`source-control/diff`): the Diff Registry
//! (`core/registry.ts`) picks one renderer per file from its format, and
//! `GitFileDiffSurface` frames it in a card (name, change badge, line
//! totals). Changes and History share it.
//!
//! The card is laid out as rows of one virtualized list — header, lines,
//! hunk separators, placeholders, the binary summary — so long patches only
//! lay out what is visible; the first and last rows of a card draw its
//! border and corners.
mod binary_summary;
mod text_unified;

use crate::{
    formats::{self, FileFormat},
    localization::t as tr,
    platform::git_diff::{FileDiff, Status},
    theme::{self, Theme},
};
use gpui::{prelude::*, *};
use gpui_kit::base::h_flex;
use std::rc::Rc;

/// `DiffViewerContribution`. Every native renderer reads the Git patch;
/// the Word redline would need the revision pair (`resource-pair`).
pub struct DiffViewer {
    #[cfg_attr(not(test), allow(dead_code))]
    pub id: &'static str,
    matches: fn(&FileDiff, &FileFormat) -> bool,
    /// The product's renderer exists natively; others are passed over.
    native: bool,
    rows: fn(usize, &FileDiff, &FileFormat, &mut Vec<Row>),
}

/// `DIFF_VIEWERS`, in match order; the binary summary matches everything.
static VIEWERS: [DiffViewer; 3] = [
    // The Word redline needs the OpenXML revision pair and its worker; the
    // native build summarises Word files like any other binary for now.
    DiffViewer {
        id: "docx-redline",
        matches: |_, format| format.id == "docx",
        native: false,
        rows: binary_summary::rows,
    },
    DiffViewer {
        id: "text-unified",
        matches: |file, format| !file.binary && (format.is_text_like() || !file.lines.is_empty()),
        native: true,
        rows: text_unified::rows,
    },
    DiffViewer {
        id: "binary-summary",
        matches: |_, _| true,
        native: true,
        rows: binary_summary::rows,
    },
];

/// `resolveDiffViewer`: the file's format, then the first renderer that
/// accepts it.
pub fn resolve(file: &FileDiff) -> (&'static DiffViewer, &'static FileFormat) {
    let name = if file.path.is_empty() {
        file.old_path.as_deref().unwrap_or_default()
    } else {
        &file.path
    };
    let format = formats::of(name);
    let viewer = VIEWERS
        .iter()
        .filter(|v| v.native)
        .find(|v| (v.matches)(file, format))
        .unwrap_or(&VIEWERS[2]);
    (viewer, format)
}

/// One row of the diff list.
#[derive(Clone, Debug, PartialEq)]
pub enum Row {
    /// Vertical space (page padding, the gap between cards).
    Space(f32),
    /// `.desktop-file-diff-header`: the card's top edge.
    Header { file: usize },
    Line {
        file: usize,
        line: usize,
        last: bool,
    },
    /// `.desktop-diff-hunk-separator` (never before the first hunk).
    Separator { file: usize },
    /// `.desktop-diff-placeholder`.
    Placeholder {
        file: usize,
        text: SharedString,
        last: bool,
    },
    /// `.desktop-binary-diff-summary`.
    Binary { file: usize, last: bool },
}

/// Where a diff list sits: Changes is a compact sidebar list
/// (`.desktop-git-changes-sidebar` overrides), a History commit a page.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Density {
    Sidebar,
    Page,
}
impl Density {
    /// `.desktop-commit-detail` inline padding.
    pub fn inline(self) -> f32 {
        match self {
            Self::Sidebar => 14.,
            Self::Page => 18.,
        }
    }
    /// Space above the first card (a commit's summary brings its own).
    fn top(self) -> f32 {
        match self {
            Self::Sidebar => 8.,
            Self::Page => 0.,
        }
    }
    /// `.desktop-file-diff-list` gap.
    fn gap(self) -> f32 {
        match self {
            Self::Sidebar => 8.,
            Self::Page => 10.,
        }
    }
    /// `.desktop-diff-line` font size and the line number column.
    fn code_size(self) -> f32 {
        match self {
            Self::Sidebar => theme::ty().ui.caption,
            Self::Page => theme::ty().ui.meta,
        }
    }
    fn number_width(self) -> f32 {
        match self {
            Self::Sidebar => 32.,
            Self::Page => 42.,
        }
    }
}
const PAD_BOTTOM: f32 = 32.;

/// The rows of a file diff list (`desktop-file-diff-list`).
pub fn rows(files: &[FileDiff], density: Density) -> Vec<Row> {
    let mut rows = Vec::new();
    if density.top() > 0. {
        rows.push(Row::Space(density.top()));
    }
    for (index, file) in files.iter().enumerate() {
        if index > 0 {
            rows.push(Row::Space(density.gap()));
        }
        rows.push(Row::Header { file: index });
        let (viewer, format) = resolve(file);
        (viewer.rows)(index, file, format, &mut rows);
    }
    rows.push(Row::Space(PAD_BOTTOM));
    rows
}

/// `--desktop-git-diff-*`: the card's palette.
#[derive(Clone, Copy)]
pub struct DiffPalette {
    pub code_bg: Rgba,
    pub header_bg: Rgba,
    pub added_bg: Rgba,
    pub removed_bg: Rgba,
    pub added_text: Rgba,
    pub removed_text: Rgba,
    pub t: Theme,
}
impl DiffPalette {
    pub fn new(t: Theme) -> Self {
        let code_bg = theme::mix(t.panel, t.inset, 0.62);
        Self {
            code_bg,
            header_bg: theme::mix(t.inset, t.panel, 0.72),
            added_bg: theme::mix(t.success, code_bg, 0.07),
            removed_bg: theme::mix(t.danger, code_bg, 0.07),
            added_text: theme::mix(t.muted, t.success, 0.82),
            removed_text: theme::mix(t.muted, t.danger, 0.82),
            t,
        }
    }
}

/// Opens a working-tree file from a diff (binary summaries offer it).
pub type OpenFile = Rc<dyn Fn(&str, &mut Window, &mut App)>;

/// What a row needs besides the files.
pub struct RowContext<'a> {
    pub files: &'a [FileDiff],
    pub density: Density,
    pub palette: DiffPalette,
    /// Open a working-tree file (binary summaries offer it); `None` where
    /// the file cannot be opened (deleted, remote, history).
    pub open_file: Option<OpenFile>,
}

/// A card row's frame: the card's side borders, its top or bottom edge.
fn frame(p: &DiffPalette, top: bool, bottom: bool) -> Div {
    let radius = px(6.);
    div()
        .border_l_1()
        .border_r_1()
        .border_color(p.t.border_subtle)
        .when(top, |d| {
            d.border_t_1().rounded_tl(radius).rounded_tr(radius)
        })
        .when(bottom, |d| {
            d.border_b_1().rounded_bl(radius).rounded_br(radius)
        })
        .overflow_hidden()
        .bg(p.code_bg)
}

/// A list row: the page's inline padding around the card row (a list
/// item's own margins are not laid out).
pub fn render_row(row: &Row, cx: &RowContext) -> AnyElement {
    div()
        .px(px(cx.density.inline()))
        .child(card_row(row, cx))
        .into_any_element()
}

fn card_row(row: &Row, cx: &RowContext) -> AnyElement {
    let p = &cx.palette;
    match row {
        Row::Space(height) => div().h(px(*height)).into_any_element(),
        Row::Header { file } => header(&cx.files[*file], p).into_any_element(),
        Row::Line { file, line, last } => frame(p, false, *last)
            .child(text_unified::line(
                &cx.files[*file].lines[*line],
                p,
                cx.density,
            ))
            .into_any_element(),
        Row::Separator { .. } => frame(p, false, false)
            .child(
                div()
                    .h(px(7.))
                    .border_t_1()
                    .border_color(theme::alpha(p.t.border_subtle, 0.55)),
            )
            .into_any_element(),
        Row::Placeholder { text, last, .. } => frame(p, false, *last)
            .child(
                div()
                    .px(px(16.))
                    .py(px(14.))
                    .text_size(px(theme::ty().ui.meta))
                    .line_height(relative(theme::NORMAL_LINE_HEIGHT))
                    .font_family(theme::SANS_ITALIC)
                    .italic()
                    .text_color(p.t.subtle)
                    .child(text.clone()),
            )
            .into_any_element(),
        Row::Binary { file, last } => frame(p, false, *last)
            .child(binary_summary::summary(
                &cx.files[*file],
                p,
                cx.open_file.clone(),
            ))
            .into_any_element(),
    }
}

/// `getGitFileName`: the name, or `old → new` when a rename changed it.
fn file_name(file: &FileDiff) -> String {
    let name = |p: &str| p.rsplit('/').next().unwrap_or(p).to_owned();
    match file.old_path.as_deref().filter(|o| *o != file.path) {
        Some(old) if name(old) != name(&file.path) => {
            format!("{} → {}", name(old), name(&file.path))
        }
        _ => name(&file.path),
    }
}

/// `getGitChangeLabel` and the badge's tone.
fn change(status: Status, t: &Theme) -> (&'static str, Rgba) {
    match status {
        Status::Added => ("source-control.diff.change.added", t.success),
        Status::Deleted => ("source-control.diff.change.deleted", t.danger),
        Status::Renamed => ("source-control.diff.change.renamed", t.accent),
        Status::Copied => ("source-control.diff.change.copied", t.accent),
        Status::Modified => ("source-control.diff.change.modified", t.accent),
        Status::Changed => ("source-control.diff.change.changed", t.muted),
    }
}

/// `GitFileDiffSurface contentMode="metadata"` (Cloud History, which has
/// paths but no bodies): the header alone as a closed card, without its rule.
pub fn metadata(file: &FileDiff, p: &DiffPalette) -> Div {
    header_card(file, p, true)
}
/// `GitFileDiffSurface`'s header: identity, change badge, line totals.
fn header(file: &FileDiff, p: &DiffPalette) -> Div {
    header_card(file, p, false)
}
fn header_card(file: &FileDiff, p: &DiffPalette, closed: bool) -> Div {
    let t = p.t;
    let m = theme::ty();
    let (label, tone) = change(file.status, &t);
    let badge_bg = if file.status == Status::Changed {
        t.control
    } else {
        theme::alpha(tone, 0.08)
    };
    let stat = file.additions.zip(file.deletions).map(|(added, deleted)| {
        h_flex()
            .flex_shrink_0()
            .gap(px(6.))
            .text_size(px(m.left.meta))
            .font_weight(FontWeight::SEMIBOLD)
            .child(div().text_color(t.success).child(format!("+{added}")))
            .child(
                div()
                    .text_color(t.danger)
                    .child(format!("\u{2212}{deleted}")),
            )
    });
    div()
        .border_1()
        .when(!closed, |d| d.border_b_0())
        .border_color(t.border_subtle)
        .rounded_tl(px(6.))
        .rounded_tr(px(6.))
        .when(closed, |d| d.rounded_bl(px(6.)).rounded_br(px(6.)))
        .overflow_hidden()
        // `.desktop-file-diff` (code ground, the border) around
        // `.desktop-file-diff-header` (header ground).
        .bg(p.code_bg)
        .child(
            h_flex()
                .bg(p.header_bg)
                .min_h(px(32.))
                .px(px(10.))
                .gap(px(8.))
                .when(!closed, |d| d.border_b_1())
                // `[data-content-mode="metadata"]`: 7 px above and below
                // the name (a 35 px card).
                .when(closed, |d| d.py(px(7.)))
                .border_color(t.border_subtle)
                .text_color(t.muted)
                .child(
                    h_flex()
                        .flex_1()
                        .min_w_0()
                        .gap(px(6.))
                        .child(
                            div()
                                .min_w_0()
                                .truncate()
                                .text_size(px(m.left.content))
                                .line_height(px(m.left.line_height))
                                .text_color(t.text)
                                .child(file_name(file)),
                        )
                        .child(
                            div()
                                .flex_shrink_0()
                                .flex()
                                .items_center()
                                .h(px(18.))
                                .px(px(5.))
                                .rounded(px(4.))
                                .bg(badge_bg)
                                .text_color(tone)
                                .text_size(px(m.left.meta))
                                .font_weight(FontWeight::MEDIUM)
                                .child(tr(label)),
                        ),
                )
                .children(stat),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::git_diff::{DiffLine, LineKind, Side};
    use core::prelude::v1::test;

    pub(super) fn file(path: &str, binary: bool, lines: &[(LineKind, &str)]) -> FileDiff {
        FileDiff {
            path: path.into(),
            old_path: None,
            status: Status::Modified,
            additions: (!binary).then_some(1),
            deletions: (!binary).then_some(1),
            binary,
            lines: lines
                .iter()
                .map(|(kind, text)| DiffLine {
                    kind: *kind,
                    text: text.to_string(),
                    old_line: Some(1),
                    new_line: Some(1),
                })
                .collect(),
            truncated: false,
            omitted_lines: 0,
            revision: binary.then_some((Side::Present(Some(1)), Side::Present(Some(2)))),
        }
    }

    #[test]
    fn each_file_resolves_to_the_products_renderer() {
        use LineKind::*;
        assert_eq!(
            resolve(&file("src/app.ts", false, &[(Add, "x")])).0.id,
            "text-unified"
        );
        assert_eq!(resolve(&file("logo.png", true, &[])).0.id, "binary-summary");
        // Word files fall to the summary until the redline is native.
        assert_eq!(
            resolve(&file("Report.docx", true, &[])).0.id,
            "binary-summary"
        );
        // A text-like format with no textual lines still uses the unified view.
        assert_eq!(resolve(&file("notes.md", false, &[])).0.id, "text-unified");
    }

    #[test]
    fn the_list_lays_out_cards_with_their_hunks() {
        use LineKind::*;
        let files = vec![
            file(
                "a.ts",
                false,
                &[
                    (Hunk, "@@"),
                    (Remove, "x"),
                    (Add, "y"),
                    (Hunk, "@@"),
                    (Context, "z"),
                ],
            ),
            file("b.png", true, &[]),
        ];
        let rows = rows(&files, Density::Sidebar);
        assert_eq!(
            rows,
            vec![
                Row::Space(8.),
                Row::Header { file: 0 },
                Row::Line {
                    file: 0,
                    line: 1,
                    last: false
                },
                Row::Line {
                    file: 0,
                    line: 2,
                    last: false
                },
                Row::Separator { file: 0 },
                Row::Line {
                    file: 0,
                    line: 4,
                    last: true
                },
                Row::Space(8.),
                Row::Header { file: 1 },
                Row::Binary {
                    file: 1,
                    last: true
                },
                Row::Space(PAD_BOTTOM),
            ]
        );
        let renamed = FileDiff {
            old_path: Some("docs/old.txt".into()),
            ..file("docs/new.txt", false, &[])
        };
        assert_eq!(file_name(&renamed), "old.txt → new.txt");
    }
}
