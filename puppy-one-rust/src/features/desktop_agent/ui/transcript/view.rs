//! `ui/AgentTranscript.tsx` with `TranscriptRow`: the conversation's
//! virtualized rows, its follow-the-latest scroll and unread count, and the
//! disclosure state of its steps. Its container hands it every change as a
//! [`TranscriptInput`]; it re-measures only the rows that changed, and while
//! an answer streams it alone redraws.
use super::super::agent_chat_view_model::AgentChatViewModel;
use super::super::agent_history_presentation::agent_history_notice;
use super::super::agent_theme::AgentTheme;
use super::super::agent_tool_group_presentation::{AgentTranscriptRow, group_agent_tool_rows};
use super::live_tail::live_tail;
use super::transcript_layout::{AGENT_TIMELINE_SPACING, build_agent_timeline_layout};
use super::transcript_rows::{
    PendingTranscriptSubmission, STANDARD_CONTROL_SIZE, build_agent_timeline,
};
use crate::agent::contract::dto::{AgentProjection, Part};
use crate::features::desktop_agent::application::agent_controller_state::{
    AgentControllerState, AgentSubmissionStage,
};
use crate::localization::{Arg, t, tf};
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// `--agent-content-max`, transcript padding and the 12px gutter.
pub(super) const CONTENT_MAX: f32 = 900.;
pub(super) const PAD_TOP: f32 = 12.;
pub(super) const PAD_BOTTOM: f32 = 24.;
pub(super) const INSET: f32 = 12.;

/// What the transcript shows of its conversation: the projection, the
/// submission still on its way, and what the live tail says.
#[derive(Clone, Default)]
pub struct TranscriptInput {
    pub projection: AgentProjection,
    pub pending: Option<PendingTranscriptSubmission>,
    pub submission_stage: Option<AgentSubmissionStage>,
    pub runtime_label: String,
    pub working: bool,
    pub startup_loading: bool,
}
impl TranscriptInput {
    /// The transcript's part of a chat's state and view model.
    pub fn of(state: &AgentControllerState, view: &AgentChatViewModel) -> Self {
        let pending = (state
            .pending_prompt
            .as_deref()
            .is_some_and(|p| !p.is_empty())
            || !view.pending_references.is_empty())
        .then(|| PendingTranscriptSubmission {
            id: view
                .pending_submission_id
                .clone()
                .unwrap_or_else(|| "pending-submission".into()),
            prompt: state.pending_prompt.clone().unwrap_or_default(),
            references: view.pending_references.clone(),
            prompt_mentions: view.pending_prompt_mentions.clone(),
        });
        Self {
            projection: state.projection.clone(),
            pending,
            submission_stage: view.submission_stage,
            runtime_label: view.runtime.runtime_label.clone(),
            working: view.working,
            startup_loading: view.startup_loading,
        }
    }
}

/// What the transcript asks of its container.
pub enum TranscriptEvent {
    /// `onOpenFile(path)`: a path a step named.
    OpenFile(String),
}
impl EventEmitter<TranscriptEvent> for TranscriptView {}

pub struct TranscriptView {
    pub(super) input: TranscriptInput,
    pub(super) list: ListState,
    pub(super) rows: Vec<AgentTranscriptRow>,
    pub(super) parts: HashMap<String, Arc<Part>>,
    pub(super) row_signatures: Vec<(String, blake3::Hash)>,
    /// The space after each row (`buildAgentTimelineLayout`).
    pub(super) gaps: Vec<f32>,
    /// What arrived while the view did not follow the latest row (the
    /// list's tail mode: any scroll toward the start releases it, reaching
    /// the bottom or Jump to latest takes it up again).
    unread: usize,
    pub(super) width: f32,
    /// Standalone shell disclosures (`rowId:partId`).
    pub(super) expanded: HashSet<String>,
    /// Long answers shown in full (`AgentMarkdownDocument`'s `expanded`).
    pub(super) full_answers: HashSet<String>,
    /// `AgentToolActivityGroup`'s single open step, per row.
    pub(super) group_selected: HashMap<String, String>,
    pub(super) open_folds: HashSet<String>,
    pub(super) run_summary_open: bool,
    pub(super) history_notice_open: bool,
    /// `useAgentStreamPresentation`: each streaming answer's displayed text,
    /// and the frame driver that catches it up.
    pub(super) stream_text: HashMap<String, String>,
    pub(super) stream_frames: Option<Task<()>>,
    /// `seenPartIdsRef`: parts already shown, or there when the
    /// conversation first showed; only others enter with motion.
    pub(super) seen_parts: HashSet<String>,
    seeded: bool,
    /// Rows fading in (`.desktop-agent-virtual-row.is-new`), by row id.
    pub(super) entering: HashMap<String, crate::ui::motion::Timeline>,
    /// `prefers-reduced-motion: reduce`: rows enter without motion.
    pub(super) reduce_motion: bool,
}

impl TranscriptView {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let list = ListState::new(0, ListAlignment::Top, px(300.));
        list.set_follow_mode(FollowMode::Tail);
        let weak = cx.entity().downgrade();
        list.set_scroll_handler(move |event, _, cx| {
            let _ = weak.update(cx, |s, cx| {
                if event.is_following_tail {
                    s.unread = 0;
                }
                cx.notify();
            });
        });
        Self {
            input: TranscriptInput::default(),
            list,
            rows: Vec::new(),
            parts: HashMap::new(),
            row_signatures: Vec::new(),
            gaps: Vec::new(),
            unread: 0,
            width: 0.,
            expanded: HashSet::new(),
            full_answers: HashSet::new(),
            group_selected: HashMap::new(),
            open_folds: HashSet::new(),
            run_summary_open: false,
            history_notice_open: false,
            stream_text: HashMap::new(),
            stream_frames: None,
            seen_parts: HashSet::new(),
            seeded: false,
            entering: HashMap::new(),
            reduce_motion: crate::platform::accessibility::reduce_motion(),
        }
    }
    /// The conversation changed.
    pub fn set_input(&mut self, input: TranscriptInput, cx: &mut Context<Self>) {
        self.input = input;
        self.refresh();
        self.sync_stream_presentation(cx);
        cx.notify();
    }
    /// A submission follows the latest row again.
    pub fn follow_latest(&mut self) {
        self.unread = 0;
        self.list.set_follow_mode(FollowMode::Tail);
    }
    /// Whether the view follows the latest row.
    pub(super) fn following(&self) -> bool {
        self.list.is_following_tail()
    }
    /// Dev captures: the first tool group opens its command step; `false`
    /// until the conversation shows one.
    #[cfg(feature = "dev-capture")]
    pub fn lab_expand_command(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(row) = self
            .rows
            .iter()
            .find(|row| row.tool_group)
            .map(|row| row.row.id.clone())
        else {
            return false;
        };
        if let Some(part) = self
            .parts
            .keys()
            .find(|id| id.contains("tool-command"))
            .cloned()
        {
            self.group_selected.insert(row.clone(), part);
            self.splice_row(&row);
            cx.notify();
        }
        true
    }
    /// Rebuild the timeline and re-measure only rows whose content changed.
    pub(super) fn refresh(&mut self) {
        let input = &self.input;
        let timeline = build_agent_timeline(
            &input.projection,
            STANDARD_CONTROL_SIZE,
            input.pending.as_ref(),
        );
        let rows = group_agent_tool_rows(&timeline.rows, &timeline.parts, STANDARD_CONTROL_SIZE);
        let layout_rows: Vec<_> = rows.iter().map(|row| row.row.clone()).collect();
        let layout =
            build_agent_timeline_layout(&layout_rows, &HashMap::new(), AGENT_TIMELINE_SPACING);
        self.gaps = layout.gaps.iter().map(|gap| *gap as f32).collect();
        let tail = live_tail(input);
        let history_notice = agent_history_notice(&input.projection);
        self.parts = timeline.parts;
        self.rows = rows;
        if !self.seeded {
            self.seeded = true;
            let shown = self
                .rows
                .iter()
                .flat_map(|row| row.part_ids.iter().cloned());
            self.seen_parts.extend(shown);
        }
        let mut next: Vec<(String, blake3::Hash)> = self
            .rows
            .iter()
            .map(|row| (row.row.id.clone(), self.row_signature(row)))
            .collect();
        if tail.connection.is_some() || tail.working.is_some() {
            let mut hasher = blake3::Hasher::new();
            hasher.update(format!("{:?}", tail.connection).as_bytes());
            if let Some((label, summary)) = &tail.working {
                hasher.update(label.as_bytes());
                hasher.update(
                    summary
                        .as_ref()
                        .map(|s| s.1.as_str())
                        .unwrap_or_default()
                        .as_bytes(),
                );
            }
            hasher.update(&[u8::from(self.run_summary_open)]);
            next.push(("live-tail".into(), hasher.finalize()));
        }
        if let Some(first) = next.first_mut()
            && let Some(notice) = history_notice
        {
            let mut hasher = blake3::Hasher::new();
            hasher.update(first.1.as_bytes());
            hasher.update(&[1, u8::from(self.history_notice_open)]);
            hasher.update(notice.kind.as_bytes());
            hasher.update(notice.message_key.as_bytes());
            for reason in notice.reason_keys {
                hasher.update(reason.as_bytes());
            }
            first.1 = hasher.finalize();
        }
        let previous = std::mem::take(&mut self.row_signatures);
        let added = next.len().saturating_sub(previous.len());
        if next.len() < previous.len()
            || next.first().map(|x| &x.0) != previous.first().map(|x| &x.0)
        {
            self.list.reset(next.len());
        } else {
            for (index, signature) in next.iter().enumerate().take(previous.len()) {
                if previous.get(index) != Some(signature) {
                    self.list.splice(index..index + 1, 1);
                }
            }
            if next.len() > previous.len() {
                self.list
                    .splice(previous.len()..previous.len(), next.len() - previous.len());
            }
        }
        if !self.following() && (added > 0 || next != previous) {
            self.unread = (self.unread + added.max(1)).min(99);
        }
        self.row_signatures = next;
        if self.following() {
            self.unread = 0;
            self.list.scroll_to(ListOffset {
                item_ix: self.row_signatures.len(),
                offset_in_item: px(0.),
            });
        }
    }

    fn row_signature(
        &self,
        row: &super::super::agent_tool_group_presentation::AgentTranscriptRow,
    ) -> blake3::Hash {
        let mut hasher = blake3::Hasher::new();
        hasher.update(row.row.id.as_bytes());
        hasher.update(row.row.kind.as_bytes());
        for id in &row.part_ids {
            if let Some(part) = self.parts.get(id) {
                hasher.update(format!("{part:?}").as_bytes());
            }
            if self.full_answers.contains(id) {
                hasher.update(b"full");
            }
        }
        hasher.update(
            self.group_selected
                .get(&row.row.id)
                .map_or("", String::as_str)
                .as_bytes(),
        );
        for key in self
            .open_folds
            .iter()
            .filter(|k| k.starts_with(&row.row.id))
        {
            hasher.update(key.as_bytes());
        }
        for key in self.expanded.iter().filter(|k| k.starts_with(&row.row.id)) {
            hasher.update(key.as_bytes());
        }
        hasher.finalize()
    }

    /// Re-measure one row after its disclosure state changed.
    pub(super) fn splice_row(&mut self, row_id: &str) {
        if let Some(index) = self.rows.iter().position(|r| r.row.id == row_id) {
            self.list.splice(index..index + 1, 1);
            let signature = self.row_signature(&self.rows[index]);
            if let Some(entry) = self.row_signatures.get_mut(index) {
                entry.1 = signature;
            }
        }
    }
}

impl Render for TranscriptView {
    /// `desktop-agent-conversation-region`.
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let tail = live_tail(&self.input);
        let has_live_tail = tail.connection.is_some() || tail.working.is_some();
        let mut region = div().relative().size_full();
        if self.row_signatures.is_empty() {
            if let Some(notice) = self.render_history_notice(&self.input.projection, &a, cx) {
                // Native history can be partial or unverified even when no
                // messages were returned. It must not depend on a first row.
                region = region.child(div().w_full().px(px(INSET)).pt(px(PAD_TOP)).child(notice));
            } else if self.input.startup_loading && !has_live_tail {
                region = region.child(
                    div()
                        .debug_selector(|| "agent-startup-loading".into())
                        .size_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(super::super::elements::dots(
                            "agent-startup-loading",
                            a.loader,
                        )),
                );
            }
        } else {
            let weak = cx.weak_entity();
            let entity = cx.entity();
            region = region
                .child(
                    list(self.list.clone(), move |index, window, cx| {
                        weak.update(cx, |s, cx| s.render_row(index, window, cx))
                            .unwrap_or_else(|_| div().into_any_element())
                    })
                    .size_full(),
                )
                .child(
                    canvas(
                        move |bounds, _, cx| {
                            entity.update(cx, |s, cx| {
                                let width = f32::from(bounds.size.width);
                                if (s.width - width).abs() > 0.5 {
                                    s.width = width;
                                    s.list.reset(s.row_signatures.len());
                                    cx.notify();
                                }
                            });
                        },
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .size_full(),
                )
                .child(transcript_top_fade(&self.list, a.canvas))
                .child(crate::ui::scrollbar::vertical(
                    "agent-transcript-scrollbar",
                    &self.list,
                ));
            if !self.following() && !self.rows.is_empty() {
                let label: SharedString = if self.unread > 0 {
                    tf(
                        "agent.transcript.jumpLatestUnread",
                        &[("count", Arg::Number(self.unread as i64))],
                    )
                    .into()
                } else {
                    t("agent.transcript.jumpLatest").into()
                };
                region = region.child(
                    div()
                        .id("agent-jump-latest")
                        .debug_selector(|| "agent-jump-latest".into())
                        .absolute()
                        .bottom(px(12.))
                        .right(px(16.))
                        .size(px(28.))
                        .rounded_full()
                        .border_1()
                        .border_color(a.border_subtle)
                        .bg(palette.menu_bg)
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor(theme::clickable_cursor())
                        .tooltip(crate::ui::components::tooltip(label))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.follow_latest();
                            cx.notify();
                        }))
                        .child(
                            Icon::new("arrow-down")
                                .with_size(px(15.))
                                .color(a.text_muted),
                        ),
                );
            }
        }
        region.into_any_element()
    }
}

/// `.desktop-agent-transcript-wrap::before` (`agentTranscriptFadeGeometry`):
/// once the transcript scrolls, its top edge fades into the canvas. Read at
/// paint time so the fade follows every scroll frame.
fn transcript_top_fade(transcript: &ListState, canvas_color: Rgba) -> impl IntoElement {
    let transcript = transcript.clone();
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let offset = transcript.scroll_px_offset_for_scrollbar();
            let max = transcript.max_offset_for_scrollbar();
            let fade = top_fade(f32::from(offset.y), f32::from(max.y));
            if fade <= 0. {
                return;
            }
            // linear-gradient(to bottom, canvas 0%, canvas/78% 46%, transparent
            // 100%) at height 18px x fade and opacity fade. GPUI gradients have
            // two stops, so the curve is two quads joined on a device-pixel row.
            let scale = window.scale_factor();
            let top = f32::from(bounds.top());
            let bottom = top + theme::metric::SIDEBAR_NAVIGATION_FADE_SIZE * fade;
            let mid = ((top + (bottom - top) * 0.46) * scale).round() / scale;
            let left = bounds.origin.x;
            let width = (bounds.size.width - px(TRANSCRIPT_FADE_SCROLLBAR_INSET)).max(px(0.));
            let band = |from: f32, to: f32, y0: f32, y1: f32| {
                fill(
                    Bounds::new(point(left, px(y0)), size(width, px(y1 - y0))),
                    linear_gradient(
                        180.,
                        linear_color_stop(theme::alpha(canvas_color, from * fade), 0.),
                        linear_color_stop(theme::alpha(canvas_color, to * fade), 1.),
                    ),
                )
            };
            window.paint_quad(band(1., 0.78, top, mid));
            window.paint_quad(band(0.78, 0., mid, bottom));
        },
    )
    .absolute()
    .top_0()
    .left_0()
    .right_0()
    .h(px(theme::metric::SIDEBAR_NAVIGATION_FADE_SIZE))
}

/// `--desktop-sidebar-navigation-fade-scrollbar-inset`: the scrollbar's 12px
/// and 8px of air stay clear of the fade.
const TRANSCRIPT_FADE_SCROLLBAR_INSET: f32 = 20.;

/// `useTranscriptViewport.updateEdges`' `topFade`: the scrolled distance over
/// 24px, zero unless the transcript overflows by more than 1px. `offset_y` is
/// GPUI's (non-positive) scroll offset, `max_y` the maximum scroll distance.
pub(super) fn top_fade(offset_y: f32, max_y: f32) -> f32 {
    if max_y <= 1. {
        return 0.;
    }
    (-offset_y).clamp(0., max_y).min(24.) / 24.
}

#[cfg(test)]
mod tests {
    use super::top_fade;
    use core::prelude::v1::test;

    #[test]
    fn the_top_fade_follows_the_first_24px_of_scroll() {
        assert_eq!(top_fade(0., 400.), 0.);
        assert_eq!(top_fade(-12., 400.), 0.5);
        assert_eq!(top_fade(-300., 400.), 1.);
        assert_eq!(top_fade(-12., 1.), 0.);
    }
}
