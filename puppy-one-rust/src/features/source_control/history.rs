//! The History view: `GitHistoryTimeline` (commits grouped by local day,
//! each with its change totals and a four-file preview) and the commit
//! summary of `GitCommitDetail` above the commit's file diffs.
use super::{DetailKind, SourceControl, diff};
use crate::{
    localization::{self, t as tr, tf},
    platform::{
        git_diff::{self, Status},
        git_history::{CommitChange, CommitSummary},
    },
    theme::{self, metric},
    ui::{
        appearance::ActiveAppearance,
        components::{FileIcon, Icon},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};
use std::collections::HashSet;

/// `HISTORY_VISIBLE_FILE_LIMIT` and the row metrics
/// (`--desktop-history-*-row-size`).
const VISIBLE_FILES: usize = 4;
const DATE_ROW: f32 = 36.;
const COMMIT_BASE_ROW: f32 = 30.;
const FILE_ROW: f32 = 16.;
/// `scrollbar-gutter: stable` keeps the overlay scrollbar's 12px.
const SCROLLBAR_GUTTER: f32 = 12.;

/// One row of the timeline list.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum TimelineRow {
    /// `.desktop-history-list` block padding.
    Space(f32),
    Date {
        key: String,
        label: String,
        collapsed: bool,
    },
    Commit(usize),
}

pub(super) type Day = (i32, u32, u32);

/// The local calendar day of a Unix time.
pub(super) fn local_day(secs: i64) -> Day {
    #[cfg(unix)]
    {
        // SAFETY: `localtime_r` writes only into `tm`.
        let mut tm: libc::tm = unsafe { std::mem::zeroed() };
        let t = secs as libc::time_t;
        if !unsafe { libc::localtime_r(&t, &mut tm) }.is_null() {
            return (tm.tm_year + 1900, tm.tm_mon as u32 + 1, tm.tm_mday as u32);
        }
    }
    let days = secs.div_euclid(86_400);
    // Civil from days (UTC) when the zone is unavailable.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    ((yoe + era * 400 + i64::from(m <= 2)) as i32, m, d)
}
/// The day an ISO date in the local zone falls on (`2026-10-24T…`).
fn iso_day(iso: &str) -> Option<Day> {
    let date = iso.get(..10)?;
    let mut parts = date.split('-');
    let day = (
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    );
    (day.1 >= 1 && day.1 <= 12 && day.2 >= 1).then_some(day)
}

/// `createHistoryRows`: newest day first; today and yesterday by name,
/// others as a short date (with the year only when it is not this year).
pub(super) fn timeline(
    commits: &[CommitSummary],
    collapsed: &HashSet<String>,
    now: i64,
) -> Vec<TimelineRow> {
    let today = local_day(now);
    let yesterday = local_day(now - 86_400);
    let mut groups: Vec<(Option<Day>, Vec<usize>)> = Vec::new();
    for (index, commit) in commits.iter().enumerate() {
        let day = commit.created_at.as_deref().and_then(iso_day);
        match groups.iter_mut().find(|(d, _)| *d == day) {
            Some((_, members)) => members.push(index),
            None => groups.push((day, vec![index])),
        }
    }
    // Dated groups newest first, the undated group last.
    groups.sort_by(|(a, _), (b, _)| match (a, b) {
        (Some(a), Some(b)) => b.cmp(a),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });
    let mut rows = vec![TimelineRow::Space(8.)];
    for (day, members) in groups {
        let key = day.map_or("unavailable".to_owned(), |(y, m, d)| {
            format!("{y:04}-{m:02}-{d:02}")
        });
        let label = match day {
            None => tr("source-control.history.dateUnavailable").to_owned(),
            Some(day) if day == today => localization::relative_day(0),
            Some(day) if day == yesterday => localization::relative_day(-1),
            Some((y, m, d)) => localization::month_day((y != today.0).then_some(y), m, d),
        };
        let is_collapsed = collapsed.contains(&key);
        rows.push(TimelineRow::Date {
            key,
            label,
            collapsed: is_collapsed,
        });
        if !is_collapsed {
            rows.extend(members.into_iter().map(TimelineRow::Commit));
        }
    }
    rows.push(TimelineRow::Space(12.));
    rows
}

/// `getChangeTotals`.
fn totals(changes: &[CommitChange]) -> (usize, u64, u64) {
    changes
        .iter()
        .fold((0, 0, 0), |(files, added, deleted), c| {
            (
                files + 1,
                added + u64::from(c.additions.unwrap_or(0)),
                deleted + u64::from(c.deletions.unwrap_or(0)),
            )
        })
}
/// `formatNumber(value, { notation: "compact", maximumFractionDigits: 1 })`.
fn compact(value: u64) -> String {
    let scaled = |v: f64, unit: &str| {
        let rounded = (v * 10.).round() / 10.;
        if rounded.fract() == 0. {
            format!("{}{unit}", rounded as u64)
        } else {
            format!("{rounded:.1}{unit}")
        }
    };
    match value {
        v if v < 1_000 => v.to_string(),
        v if v < 1_000_000 => scaled(v as f64 / 1_000., "K"),
        v => scaled(v as f64 / 1_000_000., "M"),
    }
}

/// A view that shows the History timeline: the local Git History, and the
/// Cloud History sidebar, which maps Cloud commits to the same summaries
/// (`CloudWorkspaceHistorySidebar` → `GitHistoryTimeline`).
pub(super) trait TimelineHost: Sized + 'static {
    fn timeline_rows(&self) -> &[TimelineRow];
    fn timeline_commits(&self) -> &[CommitSummary];
    /// The commit whose detail is open.
    fn selected_commit(&self) -> Option<&str>;
    fn timeline_icon_theme(&self) -> &str;
    fn toggle_day(&mut self, key: &str, cx: &mut Context<Self>);
    fn open_commit(&mut self, index: usize, cx: &mut Context<Self>);
}

/// The local time now, for day grouping.
pub(super) fn now() -> i64 {
    if let Some(clock) = crate::lab::clock() {
        return clock;
    }
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// The virtual timeline list of `host`.
pub(super) fn timeline_list<H: TimelineHost>(state: ListState, cx: &mut Context<H>) -> List {
    let host = cx.weak_entity();
    list(state, move |i, _, cx| {
        host.update(cx, |s, cx| timeline_row(s, i, cx))
            .unwrap_or_else(|_| div().into_any_element())
    })
    .flex_1()
    .min_h_0()
}

fn timeline_row<H: TimelineHost>(host: &H, index: usize, cx: &mut Context<H>) -> AnyElement {
    let content = match host.timeline_rows().get(index) {
        Some(TimelineRow::Space(height)) => return div().h(px(*height)).into_any_element(),
        Some(TimelineRow::Date {
            key,
            label,
            collapsed,
        }) => date_row(index, key, label, *collapsed, cx),
        Some(TimelineRow::Commit(commit)) => {
            // `.desktop-history-row { margin: 2px 0 }`: between two commits
            // of a day the margins add up (32 px apart); before a day
            // heading the row ends after 30.
            let before_commit = matches!(
                host.timeline_rows().get(index + 1),
                Some(TimelineRow::Commit(_))
            );
            div()
                .w_full()
                .when(before_commit, |d| d.pb(px(2.)))
                .child(commit_row(host, *commit, cx))
                .into_any_element()
        }
        None => return div().into_any_element(),
    };
    // `.desktop-history-list` inline padding, with the stable scrollbar
    // gutter on the trailing side.
    div()
        .w_full()
        .pl(px(10.))
        .pr(px(10. + SCROLLBAR_GUTTER))
        .child(content)
        .into_any_element()
}
/// `.desktop-history-date-group`: a disclosure, the day, a hairline.
fn date_row<H: TimelineHost>(
    index: usize,
    key: &str,
    label: &str,
    collapsed: bool,
    cx: &mut Context<H>,
) -> AnyElement {
    let t = cx.palette();
    let m = theme::ty();
    let key = key.to_owned();
    // A commit row's 2px top margin collapses out of its list row, so a
    // day heading is followed by 2px before the commit.
    h_flex()
        .id(("history-day", index))
        .w_full()
        .h(px(DATE_ROW))
        .mb(px(2.))
        .px(px(2.))
        .gap(px(7.))
        .cursor(theme::clickable_cursor())
        .text_color(t.muted)
        .child(
            Icon::product(crate::ui::components::ProductIcon::Disclosure)
                .with_size(px(13.))
                .color(t.muted)
                .rotate(if collapsed {
                    0.
                } else {
                    std::f32::consts::FRAC_PI_2
                }),
        )
        .child(
            div()
                .flex_shrink_0()
                .truncate()
                .text_size(px(m.left.content))
                .line_height(px(m.left.line_height))
                .child(label.to_owned()),
        )
        .child(div().flex_1().h(px(1.)).bg(theme::alpha(t.divider, 0.72)))
        .on_click(cx.listener(move |s, _, _, cx| s.toggle_day(&key, cx)))
        .into_any_element()
}
/// `GitHistoryRow`.
fn commit_row<H: TimelineHost>(host: &H, index: usize, cx: &mut Context<H>) -> AnyElement {
    let t = cx.palette();
    let m = theme::ty();
    let commit = &host.timeline_commits()[index];
    let (_, added, deleted) = totals(&commit.changes);
    let visible = commit.changes.len().min(VISIBLE_FILES);
    let hidden = commit.changes.len() - visible;
    let height = COMMIT_BASE_ROW + (visible + usize::from(hidden > 0)) as f32 * FILE_ROW;
    let group = SharedString::from(format!("history-row-{index}"));
    let selected = host.selected_commit() == Some(commit.id.as_str());
    let message = if commit.message.is_empty() {
        tr("source-control.commit.noMessage").to_owned()
    } else {
        commit.message.clone()
    };
    let stat = (added > 0 || deleted > 0).then(|| {
        h_flex()
            .flex_shrink_0()
            .gap(px(4.))
            .pr(px(metric::SIDEBAR_ROW_CONTENT_RIGHT))
            .text_size(px(m.ui.micro))
            .when(added > 0, |d| {
                d.child(
                    div()
                        .text_color(theme::mix(t.success, t.subtle, 0.52))
                        .child(format!("+{}", compact(added))),
                )
            })
            .when(deleted > 0, |d| {
                d.child(
                    div()
                        .text_color(theme::mix(t.danger, t.subtle, 0.52))
                        .child(format!("-{}", compact(deleted))),
                )
            })
    });
    let icon_theme = host.timeline_icon_theme().to_owned();
    let files = (visible > 0).then(|| {
        v_flex()
            .w_full()
            .min_w_0()
            .pr(px(metric::SIDEBAR_ROW_CONTENT_RIGHT))
            .text_size(px(m.right.meta))
            .line_height(px(FILE_ROW))
            .text_color(t.subtle)
            .children(
                commit.changes[..visible]
                    .iter()
                    .map(|change| file_preview(change, &icon_theme, t)),
            )
            .when(hidden > 0, |d| {
                d.child(
                    div()
                        .h(px(FILE_ROW))
                        .pl(px(18.))
                        .truncate()
                        .text_color(t.text_disabled)
                        .child(format!(
                            "+{}",
                            tf("source-control.commit.files", &[("count", hidden.into())])
                        )),
                )
            })
    });
    div()
        .w_full()
        .pb(px(4.))
        .child(
            h_flex()
                .id(("history-commit", index))
                .w_full()
                .group(group.clone())
                .h(px(height - 4.))
                .items_start()
                .overflow_hidden()
                .pl(px(20.))
                .rounded(px(metric::SIDEBAR_ROW_RADIUS))
                .cursor(theme::clickable_cursor())
                .text_color(t.muted)
                .when(selected, |d| d.bg(t.selected).text_color(t.text))
                .when(!selected, |d| {
                    d.hover(move |s| s.bg(t.hover).text_color(t.text))
                })
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .h_full()
                        .justify_center()
                        .gap(px(2.))
                        .overflow_hidden()
                        .child(
                            h_flex()
                                .w_full()
                                .min_w_0()
                                .gap(px(8.))
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .truncate()
                                        .text_size(px(m.left.content))
                                        .line_height(px(m.left.line_height))
                                        .text_color(if selected { t.text } else { t.muted })
                                        .group_hover(group, move |s| s.text_color(t.text))
                                        .child(message),
                                )
                                .children(stat),
                        )
                        .children(files),
                )
                .on_click(cx.listener(move |s, _, _, cx| s.open_commit(index, cx))),
        )
        .into_any_element()
}
/// `GitHistoryFilePreview`: icon, an added / deleted marker, the path.
fn file_preview(change: &CommitChange, icon_theme: &str, t: crate::theme::Theme) -> Div {
    let path = match (&change.old_path, change.status) {
        (Some(old), Status::Renamed) => format!("{old} → {}", change.path),
        _ => change.path.clone(),
    };
    let marker = match change.status {
        Status::Added => Some(("+", theme::mix(t.success, t.subtle, 0.48))),
        Status::Deleted => Some(("\u{2212}", theme::mix(t.danger, t.subtle, 0.48))),
        _ => None,
    };
    let deleted = change.status == Status::Deleted;
    h_flex()
        .w_full()
        .h(px(FILE_ROW))
        .min_w_0()
        .gap(px(4.))
        .overflow_hidden()
        .child(
            div()
                .flex_none()
                .size(px(14.))
                .flex()
                .items_center()
                .justify_center()
                .opacity(0.72)
                .child(FileIcon::file(change.path.clone(), icon_theme.to_owned()).size_px(14.)),
        )
        .children(marker.map(|(text, color)| {
            div()
                .flex_none()
                .font_weight(FontWeight(650.))
                .text_color(color)
                .child(text)
        }))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .when(deleted, |d| d.text_color(t.text_disabled).line_through())
                .child(path),
        )
}

impl TimelineHost for SourceControl {
    fn timeline_rows(&self) -> &[TimelineRow] {
        &self.timeline
    }
    fn timeline_commits(&self) -> &[CommitSummary] {
        &self.history.commits
    }
    fn selected_commit(&self) -> Option<&str> {
        match self.detail.as_ref().map(|d| &d.kind) {
            Some(DetailKind::Commit(c)) => Some(c.id.as_str()),
            _ => None,
        }
    }
    fn timeline_icon_theme(&self) -> &str {
        &self.icon_theme
    }
    fn toggle_day(&mut self, key: &str, cx: &mut Context<Self>) {
        if !self.collapsed_days.remove(key) {
            self.collapsed_days.insert(key.to_owned());
        }
        self.rebuild_timeline();
        cx.notify();
    }
    fn open_commit(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(commit) = self.history.commits.get(index).cloned() else {
            return;
        };
        let id = commit.id.clone();
        self.open_detail(
            DetailKind::Commit(commit),
            move |root, cancel| git_diff::commit_detail(&root, &id, cancel),
            cx,
        );
    }
}

impl SourceControl {
    /// Rebuild the timeline after new history or a collapsed day.
    pub(super) fn rebuild_timeline(&mut self) {
        self.timeline = timeline(&self.history.commits, &self.collapsed_days, now());
        self.timeline_list.reset(self.timeline.len());
    }
    /// `GitHistoryTimeline`.
    pub(super) fn history_view(&self, cx: &mut Context<Self>) -> AnyElement {
        if self.history.commits.is_empty() {
            return Self::centered_note(
                tr(if self.history_loaded {
                    "source-control.history.noCommits"
                } else {
                    "source-control.status.readingHistory"
                }),
                cx.palette(),
            )
            .into_any_element();
        }
        timeline_list(self.timeline_list.clone(), cx).into_any_element()
    }
    /// `GitCommitDetail`'s summary: the message and `HEAD`, the copyable id,
    /// the change totals.
    pub(super) fn commit_summary(
        &self,
        commit: &CommitSummary,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let m = theme::ty();
        let files = match self.detail.as_ref().and_then(|d| d.files.as_ref()) {
            Some(Ok(files)) if !files.is_empty() => files
                .iter()
                .map(|f| CommitChange {
                    path: f.path.clone(),
                    old_path: f.old_path.clone(),
                    status: f.status,
                    additions: f.additions,
                    deletions: f.deletions,
                })
                .collect(),
            _ => commit.changes.clone(),
        };
        let (count, added, deleted) = totals(&files);
        let head = self.history.head.as_deref() == Some(commit.id.as_str());
        let copied = self.copied.as_deref() == Some(commit.id.as_str());
        let id = commit.id.clone();
        v_flex()
            .w_full()
            .px(px(diff::Density::Page.inline()))
            .pt(px(12.))
            .pb(px(16.))
            .gap(px(10.))
            .child(
                h_flex()
                    .w_full()
                    .min_w_0()
                    .gap(px(8.))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .text_size(px(m.right.heading2))
                            .line_height(relative(1.35))
                            .font_weight(FontWeight(650.))
                            .text_color(t.text)
                            .child(if commit.message.is_empty() {
                                tr("source-control.commit.noMessage").to_owned()
                            } else {
                                commit.message.clone()
                            }),
                    )
                    .when(head, |d| {
                        d.child(
                            div()
                                .flex_none()
                                .flex()
                                .items_center()
                                .h(px(16.))
                                .px(px(4.))
                                .border_1()
                                .border_color(theme::alpha(t.success, 0.2))
                                .rounded(px(3.))
                                .bg(theme::alpha(t.success, 0.07))
                                .text_color(theme::mix(t.success, t.muted, 0.52))
                                .text_size(px(m.ui.micro))
                                .line_height(relative(1.))
                                .font_weight(FontWeight(620.))
                                .child("HEAD"),
                        )
                    }),
            )
            .child(
                h_flex()
                    .w_full()
                    .min_w_0()
                    .justify_between()
                    .gap(px(12.))
                    .child(
                        h_flex()
                            .id("commit-id-copy")
                            .min_w_0()
                            .h(px(22.))
                            .px(px(5.))
                            .gap(px(5.))
                            .rounded(px(4.))
                            .overflow_hidden()
                            .cursor(theme::clickable_cursor())
                            .text_color(t.subtle)
                            .hover(move |s| s.bg(t.hover).text_color(t.muted))
                            .text_size(px(m.left.meta))
                            .line_height(relative(1.))
                            .child(
                                div()
                                    .text_color(t.text_disabled)
                                    .child(tr("source-control.commit.id")),
                            )
                            .child(
                                div()
                                    .font_family(theme::MONO)
                                    .child(commit.id.chars().take(8).collect::<String>()),
                            )
                            .child(if copied {
                                Icon::new("check").with_size(px(12.)).stroke(2.)
                            } else {
                                Icon::new("copy").with_size(px(12.))
                            })
                            .on_click(cx.listener(move |s, _, _, cx| {
                                cx.write_to_clipboard(ClipboardItem::new_string(id.clone()));
                                s.copied = Some(id.clone());
                                let copied = id.clone();
                                cx.spawn(async move |this, cx| {
                                    cx.background_executor()
                                        .timer(std::time::Duration::from_millis(1500))
                                        .await;
                                    let _ = this.update(cx, |s, cx| {
                                        if s.copied.as_deref() == Some(copied.as_str()) {
                                            s.copied = None;
                                            cx.notify();
                                        }
                                    });
                                })
                                .detach();
                                cx.notify();
                            })),
                    )
                    .child(
                        h_flex()
                            .flex_none()
                            .gap(px(8.))
                            .text_size(px(m.left.meta))
                            .line_height(relative(theme::NORMAL_LINE_HEIGHT))
                            .text_color(t.subtle)
                            .child(tf(
                                "source-control.commit.filesChanged",
                                &[("count", count.into())],
                            ))
                            .child(div().text_color(t.success).child(format!("+{added}")))
                            .child(div().text_color(t.danger).child(format!("-{deleted}"))),
                    ),
            )
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn commit(id: &str, created_at: Option<&str>) -> CommitSummary {
        CommitSummary {
            id: id.into(),
            parents: vec![],
            author_name: "A".into(),
            author_email: String::new(),
            created_at: created_at.map(str::to_owned),
            message: id.into(),
            changes: vec![],
        }
    }

    #[test]
    fn commits_group_by_day_newest_first() {
        // 2026-10-25 12:00 UTC; local day math is checked at noon so any
        // zone within ±12h keeps the calendar day.
        let now = 1_792_929_600;
        let today = local_day(now);
        let iso = |(y, m, d): Day| format!("{y:04}-{m:02}-{d:02}T09:00:00+00:00");
        let commits = vec![
            commit("a", Some(&iso(today))),
            commit("b", Some(&iso(local_day(now - 86_400)))),
            commit("c", Some("2026-10-22T10:15:00+08:00")),
            commit("d", Some("2025-01-05T10:15:00+08:00")),
            commit("e", None),
            commit("f", Some(&iso(today))),
        ];
        let rows = timeline(&commits, &HashSet::new(), now);
        let labels: Vec<String> = rows
            .iter()
            .filter_map(|r| match r {
                TimelineRow::Date { label, .. } => Some(label.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(
            labels,
            [
                "today",
                "yesterday",
                "Oct 22",
                "Jan 5, 2025",
                "Date unavailable"
            ]
        );
        assert_eq!(
            rows[1..4],
            [
                TimelineRow::Date {
                    key: format!("{:04}-{:02}-{:02}", today.0, today.1, today.2),
                    label: "today".into(),
                    collapsed: false
                },
                TimelineRow::Commit(0),
                TimelineRow::Commit(5)
            ]
        );
        // A collapsed day keeps its heading and hides its commits.
        let collapsed: HashSet<String> = ["2026-10-22".to_owned()].into();
        let rows = timeline(&commits, &collapsed, now);
        assert!(!rows.contains(&TimelineRow::Commit(2)));
        assert_eq!(compact(1234), "1.2K");
        assert_eq!(compact(78), "78");
    }
}
