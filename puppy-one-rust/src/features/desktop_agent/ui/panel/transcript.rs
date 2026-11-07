//! `ui/AgentTranscript.tsx`, `TranscriptRow`, `AgentPartRenderer`,
//! `AgentMessagePart`, `AgentTurnSummary`, `AgentToolActivityGroup`, the live
//! tail (`AgentRunStatus`, `AgentConnectionStatus`) and `AgentHistoryNotice`.
use super::super::activity::agent_activity_views::{
    ActivityShell, ActivityView, ShellDetail, StatusIcon, activity_view, status_icon,
};
use super::super::activity::agent_tool_steps::{AgentToolStepSegment, agent_tool_step_segments};
use super::super::agent_chat_view_model::AgentChatViewModel;
use super::super::agent_history_presentation::agent_history_notice;
use super::super::agent_theme::AgentTheme;
use super::super::agent_tool_group_presentation::group_agent_tool_rows;
use super::super::transcript::transcript_layout::{
    AGENT_TIMELINE_SPACING, build_agent_timeline_layout,
};
use super::super::transcript::transcript_rows::{
    PendingTranscriptSubmission, STANDARD_CONTROL_SIZE, build_agent_timeline,
};
use super::AgentChatTabPanel;
use super::elements::{
    EVIDENCE_RAIL_INLINE, OpenFile, context_divider, evidence_branch, evidence_tree, mention_chip,
    metadata_element, plan_list, prose_branch, run_feedback, status_icon_element, step_icon,
    step_line, subject_element,
};
use crate::agent::contract::dto::{AgentProjection, ConnectionStatus, Part, Turn};
use crate::features::desktop_agent::application::agent_controller_state::{
    AgentControllerState, AgentSubmissionStage,
};
use crate::features::desktop_agent::domain::agent_activity_presentation::{
    format_agent_duration, output_for_activity,
};
use crate::features::desktop_agent::domain::agent_prompt_mentions::{
    PromptPart, is_agent_media_display, split_agent_prompt_mentions,
};
use crate::features::desktop_agent::domain::agent_stream_presentation::split_streaming_markdown;
use crate::localization::{Arg, bidi_isolate, format_number, t, tf};
use crate::text;
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

/// `--agent-content-max`, transcript padding and the 12px gutter.
const CONTENT_MAX: f32 = 900.;
const PAD_TOP: f32 = 12.;
const PAD_BOTTOM: f32 = 24.;
const INSET: f32 = 12.;
/// `AGENT_RUN_ELAPSED_LABEL_THRESHOLD_MS`.
pub const AGENT_RUN_ELAPSED_LABEL_THRESHOLD_MS: i64 = 5_000;
const MAX_VISIBLE_RUN_DURATION_MS: i64 = 30 * 24 * 60 * 60 * 1_000;

/// `agentRunStatusCode(projection, working)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunStatus {
    Thinking,
    Working,
}

/// The parts the transcript reads (`projection.parts`, or the original
/// message/activity shape).
fn typed_parts(projection: &AgentProjection) -> Vec<Arc<Part>> {
    if !projection.parts.is_empty() {
        return projection.parts.clone();
    }
    projection
        .messages
        .iter()
        .map(|message| Arc::new(Part::of_message(message)))
        .chain(
            projection
                .activities
                .iter()
                .map(|activity| Arc::new(Part::of_activity(activity))),
        )
        .collect()
}

fn updated(part: &Arc<Part>) -> i64 {
    part.updated_sequence.unwrap_or(part.sequence)
}

/// `agentRunStatusCode(projection, working)`: presentation only; it never
/// fabricates model content or Harness history.
pub fn agent_run_status_code(projection: &AgentProjection, working: bool) -> Option<RunStatus> {
    if !working || !projection.approvals.is_empty() || !projection.questions.is_empty() {
        return None;
    }
    let turn_id = projection.running_turn()?;
    let mut visible: Vec<Arc<Part>> = typed_parts(projection)
        .into_iter()
        .filter(|part| {
            part.turn_id.as_deref() == Some(turn_id)
                && !["user", "usage", "permission", "question"].contains(&part.kind.as_str())
        })
        .collect();
    visible.sort_by_key(updated);
    let Some(latest) = visible.last() else {
        return Some(RunStatus::Thinking);
    };
    match latest.kind.as_str() {
        "assistant" => return (!latest.streaming).then_some(RunStatus::Working),
        "error" | "warning" => return None,
        _ => {}
    }
    if [
        "running",
        "pending",
        "in-progress",
        "waiting-for-user",
        "blocked",
    ]
    .contains(&latest.status.as_str())
    {
        return Some(if latest.kind == "reasoning" {
            RunStatus::Thinking
        } else {
            RunStatus::Working
        });
    }
    // A completed tool/reasoning item while the turn is still active means
    // the native harness has resumed work and needs a fresh pulse.
    Some(RunStatus::Working)
}

/// `currentAgentReasoningSummary(projection)`.
pub fn current_agent_reasoning_summary(projection: &AgentProjection) -> Option<(String, String)> {
    let turn_id = projection.running_turn()?;
    let parts: Vec<Arc<Part>> = if projection.parts.is_empty() {
        projection
            .activities
            .iter()
            .map(|a| Arc::new(Part::of_activity(a)))
            .collect()
    } else {
        projection.parts.clone()
    };
    let mut reasoning: Vec<Arc<Part>> = parts
        .into_iter()
        .filter(|part| part.kind == "reasoning" && part.turn_id.as_deref() == Some(turn_id))
        .collect();
    reasoning.sort_by_key(updated);
    let latest = reasoning.pop()?;
    let summary = match latest.detail.text("delta") {
        Some(delta) => delta.to_string(),
        None => output_for_activity(&*latest),
    };
    let summary = text::head16(text::trim(&summary), 2_048).to_string();
    (!summary.is_empty()).then(|| (latest.id.clone(), summary))
}

/// `agentSubmissionStatusLabel(stage, runtimeLabel, palette)`.
pub fn agent_submission_status_label(
    stage: Option<AgentSubmissionStage>,
    runtime_label: &str,
) -> Option<String> {
    match stage? {
        AgentSubmissionStage::PreparingSession => Some(tf(
            "agent.transcript.preparing",
            &[("agent", Arg::Text(bidi_isolate(runtime_label)))],
        )),
        AgentSubmissionStage::StartingTurn => Some(t("agent.transcript.startingTurn").into()),
    }
}

/// `agentRunActiveElapsedMs(turn, nowMs)`: active Agent work time from
/// event timestamps.
pub fn agent_run_active_elapsed_ms(turn: Option<&Turn>, now_ms: i64) -> Option<i64> {
    let turn = turn?;
    if turn.status != "running" {
        return None;
    }
    let started = turn.started_at_ms? as i64;
    let wall = (now_ms - started).max(0);
    let settled_wait = turn.user_wait_duration_ms.unwrap_or(0.).max(0.) as i64;
    let open_wait = turn
        .user_wait_started_at_ms
        .map_or(0, |at| (now_ms - at as i64).max(0));
    Some(MAX_VISIBLE_RUN_DURATION_MS.min((wall - settled_wait - open_wait).max(0)))
}

/// The live tail (`hasLiveTail`): the label and a running reasoning summary.
struct LiveTail {
    connection: Option<ConnectionStatus>,
    working: Option<(String, Option<(String, String)>)>,
}

fn live_tail(state: &AgentControllerState, view: &AgentChatViewModel) -> LiveTail {
    let projection = &state.projection;
    let connection = projection.connection_status.clone();
    let submission =
        agent_submission_status_label(view.submission_stage, &view.runtime.runtime_label);
    let run_status = if connection.is_none() && submission.is_none() {
        agent_run_status_code(projection, view.working)
    } else {
        None
    };
    let running_turn = projection
        .turns
        .iter()
        .find(|turn| projection.running_turn_id.as_deref() == Some(turn.id.as_str()))
        .map(|turn| (**turn).clone());
    let elapsed = run_status
        .and_then(|_| agent_run_active_elapsed_ms(running_turn.as_ref(), crate::clock::now_ms()))
        .filter(|ms| *ms >= AGENT_RUN_ELAPSED_LABEL_THRESHOLD_MS);
    let status_label = run_status.map(|status| {
        t(match status {
            RunStatus::Thinking => "agent.activity.thinking",
            RunStatus::Working => "agent.activity.working",
        })
        .to_string()
    });
    let working = if connection.is_some() {
        None
    } else {
        submission.or_else(|| {
            status_label.map(|label| match elapsed {
                Some(ms) => tf(
                    "agent.transcript.runElapsed",
                    &[
                        ("status", Arg::Text(label.clone())),
                        (
                            "duration",
                            Arg::Text(format_agent_duration((ms / 1_000 * 1_000) as f64)),
                        ),
                    ],
                ),
                None => label,
            })
        })
    };
    let summary = (run_status == Some(RunStatus::Thinking))
        .then(|| current_agent_reasoning_summary(projection))
        .flatten();
    LiveTail {
        connection,
        working: working.map(|label| (label, summary)),
    }
}

/// `STREAM_FRAME_MS`: live text commits align to paint.
const STREAM_FRAME_MS: u64 = 16;

impl AgentChatTabPanel {
    /// `useAgentStreamPresentation(text, streaming)`: the provider text stays
    /// authoritative; a streaming answer catches up a bounded step per frame,
    /// and anything else shows at once.
    fn presented_text(&self, id: &str, text: &str, streaming: bool) -> String {
        match self.stream_text.get(id) {
            Some(displayed) if streaming && text.starts_with(displayed.as_str()) => {
                displayed.clone()
            }
            _ => text.to_string(),
        }
    }

    /// Tracks the streaming answers and drives their frames while one lags.
    pub(super) fn sync_stream_presentation(&mut self, cx: &mut Context<Self>) {
        let streaming: HashMap<String, String> = self
            .parts
            .iter()
            .filter(|(_, part)| part.kind == "assistant" && part.streaming)
            .map(|(id, part)| (id.clone(), part.text.clone()))
            .collect();
        // A new answer shows its text as it first arrives (`useState(text)`).
        self.stream_text.retain(|id, displayed| {
            streaming
                .get(id)
                .is_some_and(|text| text.starts_with(displayed.as_str()))
        });
        for (id, text) in &streaming {
            self.stream_text
                .entry(id.clone())
                .or_insert_with(|| text.clone());
        }
        let lagging = self
            .stream_text
            .iter()
            .any(|(id, displayed)| streaming.get(id) != Some(displayed));
        if !lagging || self.stream_frames.is_some() {
            return;
        }
        self.stream_frames = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(STREAM_FRAME_MS))
                    .await;
                let more = this.update(cx, |s, cx| s.advance_stream_frame(cx));
                if !matches!(more, Ok(true)) {
                    break;
                }
            }
        }));
    }

    /// One frame: every lagging answer takes its next step (`nextAgentStreamText`).
    fn advance_stream_frame(&mut self, cx: &mut Context<Self>) -> bool {
        use crate::features::desktop_agent::domain::agent_stream_presentation::next_agent_stream_text;
        let mut stepped = Vec::new();
        let mut lagging = false;
        for (id, displayed) in self.stream_text.iter_mut() {
            let Some(part) = self.parts.get(id) else {
                continue;
            };
            let text = part.text.clone();
            if *displayed == text {
                continue;
            }
            *displayed = next_agent_stream_text(displayed, &text);
            lagging |= *displayed != text;
            stepped.push(id.clone());
        }
        for id in stepped {
            if let Some(row) = self
                .rows
                .iter()
                .find(|row| row.part_ids.contains(&id))
                .map(|row| row.row.id.clone())
            {
                self.splice_row(&row);
            }
        }
        cx.notify();
        if !lagging {
            self.stream_frames = None;
        }
        lagging
    }

    /// Rebuild the timeline and re-measure only rows whose content changed.
    pub(super) fn refresh_transcript(
        &mut self,
        state: &AgentControllerState,
        view: &AgentChatViewModel,
    ) {
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
        let timeline =
            build_agent_timeline(&state.projection, STANDARD_CONTROL_SIZE, pending.as_ref());
        let rows = group_agent_tool_rows(&timeline.rows, &timeline.parts, STANDARD_CONTROL_SIZE);
        self.parts = timeline.parts;
        self.rows = rows;
        let tail = live_tail(state, view);
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
            && agent_history_notice(&state.projection).is_some()
        {
            let mut hasher = blake3::Hasher::new();
            hasher.update(first.1.as_bytes());
            hasher.update(&[1, u8::from(self.history_notice_open)]);
            first.1 = hasher.finalize();
        }
        let previous = std::mem::take(&mut self.row_signatures);
        let added = next.len().saturating_sub(previous.len());
        if next.len() < previous.len()
            || next.first().map(|x| &x.0) != previous.first().map(|x| &x.0)
        {
            self.transcript.reset(next.len());
        } else {
            for (index, signature) in next.iter().enumerate().take(previous.len()) {
                if previous.get(index) != Some(signature) {
                    self.transcript.splice(index..index + 1, 1);
                }
            }
            if next.len() > previous.len() {
                self.transcript
                    .splice(previous.len()..previous.len(), next.len() - previous.len());
            }
        }
        if !self.follow && (added > 0 || next != previous) {
            self.unread = (self.unread + added.max(1)).min(99);
        }
        self.row_signatures = next;
        if self.follow {
            self.unread = 0;
            self.transcript.scroll_to(ListOffset {
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
            self.transcript.splice(index..index + 1, 1);
            let signature = self.row_signature(&self.rows[index]);
            if let Some(entry) = self.row_signatures.get_mut(index) {
                entry.1 = signature;
            }
        }
    }

    /// `desktop-agent-conversation-region` (+ the empty-state overlay).
    pub(super) fn render_conversation(
        &mut self,
        state: &AgentControllerState,
        view: &AgentChatViewModel,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let tail = live_tail(state, view);
        let has_live_tail = tail.connection.is_some() || tail.working.is_some();
        let mut region = div().relative().flex_1().min_h_0();
        if self.row_signatures.is_empty() {
            if view.startup_loading && !has_live_tail {
                region = region.child(
                    div()
                        .size_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(super::elements::dots("agent-startup-loading", a.loader)),
                );
            }
        } else {
            let weak = cx.weak_entity();
            let entity = cx.entity();
            region = region
                .child(
                    list(self.transcript.clone(), move |index, window, cx| {
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
                                if (s.transcript_width - width).abs() > 0.5 {
                                    s.transcript_width = width;
                                    s.transcript.reset(s.row_signatures.len());
                                    cx.notify();
                                }
                            });
                        },
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .size_full(),
                )
                .child(transcript_top_fade(&self.transcript, a.canvas))
                .child(crate::ui::scrollbar::vertical(
                    "agent-transcript-scrollbar",
                    &self.transcript,
                ));
            if !self.follow && !self.rows.is_empty() {
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
                            s.follow = true;
                            s.unread = 0;
                            s.transcript.scroll_to(ListOffset {
                                item_ix: s.row_signatures.len(),
                                offset_in_item: px(0.),
                            });
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
        if view.show_ready_empty_state {
            region = region.child(
                div()
                    .absolute()
                    .inset_0()
                    .child(self.render_empty_state(view, cx)),
            );
        }
        region.into_any_element()
    }

    fn render_row(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let state = self.state();
        let view = self.view_model(&state);
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let last = index + 1 == self.row_signatures.len();
        let content_width = (self.transcript_width - 2. * INSET).clamp(0., CONTENT_MAX);
        let layout_rows: Vec<_> = self.rows.iter().map(|row| row.row.clone()).collect();
        let layout =
            build_agent_timeline_layout(&layout_rows, &HashMap::new(), AGENT_TIMELINE_SPACING);
        let (body, gap) = match self.rows.get(index).cloned() {
            Some(row) => {
                let parts: Vec<Arc<Part>> = row
                    .part_ids
                    .iter()
                    .filter_map(|id| self.parts.get(id).cloned())
                    .collect();
                let body = match parts.first() {
                    None => div().into_any_element(),
                    Some(_) if row.tool_group => {
                        self.render_tool_group(&row.row.id, &parts, &view, cx)
                    }
                    Some(part) => {
                        self.render_part(&row.row.id, part, &view, content_width, window, cx)
                    }
                };
                (body, layout.gaps.get(index).copied().unwrap_or(0.) as f32)
            }
            None => (self.render_live_tail(&state, &view, cx), 0.),
        };
        let tail_padding = if self.rows.get(index).is_none() {
            8.
        } else {
            0.
        };
        let notice = (index == 0)
            .then(|| self.render_history_notice(&state.projection, &a, cx))
            .flatten();
        div()
            .w_full()
            .pl(px(INSET))
            .pr(px(INSET))
            .when(index == 0, |d| d.pt(px(PAD_TOP)))
            .children(notice)
            .pb(px(gap + tail_padding + if last { PAD_BOTTOM } else { 0. }))
            .child(div().w_full().max_w(px(CONTENT_MAX)).mx_auto().child(body))
            .into_any_element()
    }

    /// `AgentPartRenderer`.
    fn render_part(
        &mut self,
        row_id: &str,
        part: &Part,
        view: &AgentChatViewModel,
        content_width: f32,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        match part.kind.as_str() {
            "user" => self.render_user_message(part, &a),
            "assistant" => self.render_assistant_message(part, view, content_width, window, cx),
            "turn-summary" => {
                let duration = format_agent_duration(part.duration_ms.unwrap_or(0.));
                let label = if part.completion_quality.as_deref() == Some("degraded") {
                    tf(
                        "agent.recovery.degraded.turnSummary",
                        &[("duration", Arg::Text(duration))],
                    )
                } else {
                    tf("agent.turn.workedFor", &[("duration", Arg::Text(duration))])
                };
                run_feedback(label.into(), None, &a).into_any_element()
            }
            "notification" | "usage" | "permission" | "question" => div().into_any_element(),
            "unknown" => self.render_unregistered(part, &a),
            kind if [
                "reasoning",
                "plan",
                "tool",
                "command",
                "file-change",
                "warning",
                "error",
                "system",
            ]
            .contains(&kind) =>
            {
                self.render_activity(row_id, part, false, cx)
            }
            _ => self.render_unregistered(part, &a),
        }
    }

    fn render_unregistered(&self, part: &Part, a: &AgentTheme) -> AnyElement {
        let label = if part.event_type.is_some() {
            Some(part.label.clone())
                .filter(|l| !l.is_empty())
                .unwrap_or_else(|| {
                    t(&format!(
                        "agent.part.{}",
                        part.label_code.as_deref().unwrap_or("unsupported-event")
                    ))
                    .into()
                })
        } else {
            t("agent.part.update").into()
        };
        div()
            .px(px(12.))
            .text_size(px(theme::ty().left.meta))
            .text_color(a.text_subtle)
            .child(label)
            .into_any_element()
    }

    /// `AgentMessagePart` for the user: quiet full-width row, media
    /// references above the prompt, mentions inline.
    fn render_user_message(&self, part: &Part, a: &AgentTheme) -> AnyElement {
        let m = theme::ty();
        let references = part.references.clone().unwrap_or_default();
        let media: Vec<_> = references
            .iter()
            .filter(|r| is_agent_media_display(r))
            .cloned()
            .collect();
        let text = part.text.clone();
        let mentions = part.prompt_mentions.clone().unwrap_or_default();
        let delivery = part
            .delivery_status
            .as_deref()
            .filter(|status| !["accepted", "dispatching"].contains(status))
            .map(|status| {
                t(match status {
                    "queued" => "agent.status.queued",
                    "outcome-unknown" => "agent.status.deliveryUnknown",
                    _ => "agent.status.notSent",
                })
                .to_string()
            });
        let mut body = h_flex().flex_wrap().items_baseline().gap_y(px(2.));
        for segment in split_agent_prompt_mentions(&text, &mentions) {
            body = match segment {
                PromptPart::Text(text) => body.child(div().whitespace_normal().child(text)),
                PromptPart::Mention { text, .. } => body.child(mention_chip(a, text, false)),
            };
        }
        v_flex()
            .w_full()
            .px(px(12.))
            .py(px(8.))
            .rounded(px(8.))
            .border_1()
            .border_color(a.user_message_border)
            .bg(a.user_message_surface)
            .when(!media.is_empty(), |d| {
                d.child(
                    h_flex()
                        .gap(px(6.))
                        .mb(px(6.))
                        .children(media.iter().map(|reference| {
                            div()
                                .px(px(6.))
                                .py(px(2.))
                                .rounded(px(4.))
                                .border_1()
                                .border_color(a.border_subtle)
                                .text_size(px(m.left.meta))
                                .text_color(a.text_muted)
                                .child(reference.display_name.clone())
                        })),
                )
            })
            .when(!text.is_empty(), |d| {
                d.child(
                    div()
                        .text_size(px(m.left.content))
                        .line_height(px(m.left.content * 1.6))
                        .text_color(a.text)
                        .child(body),
                )
            })
            .children(delivery.map(|label| {
                div()
                    .mt(px(4.))
                    .text_size(px(m.left.meta))
                    .line_height(px(m.right.meta_line_height))
                    .text_color(a.text_muted)
                    .child(label)
            }))
            .into_any_element()
    }

    /// `AgentMessagePart` for the Agent: the answer stays in the document
    /// flow; incomplete Markdown streams as a plain tail.
    fn render_assistant_message(
        &self,
        part: &Part,
        _view: &AgentChatViewModel,
        content_width: f32,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let m = theme::ty();
        let streaming = part.streaming;
        let id = part.id.clone();
        let text = self.presented_text(&id, &part.text, streaming);
        let order = part.sequence.max(0) as u64 * 10;
        let (stable, tail) = if streaming {
            split_streaming_markdown(&text)
        } else {
            (text.clone(), String::new())
        };
        let body = if text.is_empty() && streaming {
            "…".to_string()
        } else {
            stable
        };
        let terminal = part
            .terminal_state
            .as_deref()
            .filter(|state| *state != "completed")
            .map(|state| {
                (
                    state.to_string(),
                    t(&format!("agent.turn.status.{state}")).to_string(),
                )
            });
        div()
            .relative()
            .w_full()
            .pt(px(2.))
            .child(
                div()
                    .px(px(12.))
                    .when(!body.is_empty(), |d| {
                        d.child(super::super::agent_markdown::render(
                            &body,
                            palette,
                            &id,
                            order,
                            content_width - 24.,
                            window,
                        ))
                    })
                    .when(!tail.is_empty(), |d| {
                        d.child(
                            div()
                                .text_size(px(m.left.content))
                                .line_height(px(m.left.content * 1.6))
                                .whitespace_normal()
                                .text_color(a.text)
                                .child(tail),
                        )
                    }),
            )
            .children(terminal.map(|(state, label)| {
                div()
                    .px(px(12.))
                    .mt(px(4.))
                    .text_size(px(m.left.meta))
                    .text_color(if state == "failed" {
                        palette.danger
                    } else {
                        a.text_muted
                    })
                    .child(label)
            }))
            .when(part.truncated == Some(true), |d| {
                d.child(
                    div()
                        .px(px(12.))
                        .text_size(px(m.left.meta))
                        .text_color(a.text_muted)
                        .child(t("agent.message.partial")),
                )
            })
            .into_any_element()
    }

    /// An activity part standalone, or as one step of a tool group.
    fn render_activity(
        &mut self,
        row_id: &str,
        part: &Part,
        in_group: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        match activity_view(part) {
            ActivityView::Hidden => div().into_any_element(),
            ActivityView::ContextDivider(label) => context_divider(label.into(), &a),
            ActivityView::Notice { error, label } => h_flex()
                .mx(px(4.))
                .mb(px(6.))
                .gap(px(6.))
                .text_size(px(theme::ty().left.meta))
                .text_color(if error {
                    palette.danger
                } else {
                    palette.warning
                })
                .child(
                    Icon::new("circle-alert")
                        .with_size(px(12.))
                        .color(if error {
                            palette.danger
                        } else {
                            palette.warning
                        }),
                )
                .child(div().min_w_0().whitespace_normal().child(label))
                .into_any_element(),
            ActivityView::Shell(shell) => self.render_shell(row_id, part, &shell, in_group, cx),
        }
    }

    /// `AgentActivityShell`: a step line whose detail opens beneath it.
    fn render_shell(
        &mut self,
        row_id: &str,
        part: &Part,
        shell: &ActivityShell,
        in_group: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let part_id = part.id.clone();
        let key = format!("{row_id}:{part_id}");
        let has_detail = shell.has_detail();
        let expanded = if in_group {
            self.group_selected.get(row_id) == Some(&part_id)
        } else {
            self.expanded.contains(&key) != shell.default_expanded
        };
        let failed = matches!(status_icon(&shell.status), StatusIcon::Failed { .. });
        let line = step_line(
            SharedString::from(format!("tool-step-{key}")),
            step_icon(format!("step-{key}"), shell.icon, failed, &a, &palette),
            shell.title.clone(),
            shell
                .subject
                .as_ref()
                .map(|subject| subject_element(subject, &a)),
            shell
                .metadata
                .as_ref()
                .map(|metadata| metadata_element(metadata, &a)),
            status_icon_element(&status_icon(&shell.status), &a, &palette),
            has_detail,
            shell.active(),
            &a,
        );
        let line = if has_detail {
            let (row, id) = (row_id.to_string(), part_id.clone());
            line.on_click(cx.listener(move |s, _, _, cx| {
                if in_group {
                    if s.group_selected.get(&row) == Some(&id) {
                        s.group_selected.remove(&row);
                    } else {
                        s.group_selected.insert(row.clone(), id.clone());
                    }
                } else {
                    let key = format!("{row}:{id}");
                    if !s.expanded.remove(&key) {
                        s.expanded.insert(key);
                    }
                }
                s.splice_row(&row);
                cx.notify();
            }))
        } else {
            line
        };
        let weak = cx.weak_entity();
        let open_file: OpenFile = Rc::new(move |path, _, cx| {
            let _ = weak.update(cx, |s, cx| s.open_file(path, cx));
        });
        let detail = (expanded && has_detail).then(|| match &shell.detail {
            ShellDetail::Evidence(nodes) => {
                evidence_branch(evidence_tree(&key, nodes, Some(open_file), &a)).into_any_element()
            }
            ShellDetail::Prose { text, plan } => prose_branch(
                v_flex()
                    .gap(px(6.))
                    .children(text.clone().map(|text| {
                        div()
                            .id(SharedString::from(format!("{key}-prose")))
                            .max_h(px(220.))
                            .overflow_y_scroll()
                            .text_size(px(theme::ty().left.content))
                            .line_height(px(theme::ty().left.content * 1.55))
                            .text_color(a.text_muted)
                            .whitespace_normal()
                            .child(text)
                    }))
                    .when(!plan.is_empty(), |d| d.child(plan_list(plan, &a)))
                    .into_any_element(),
                &a,
            )
            .into_any_element(),
        });
        v_flex()
            .min_w_0()
            .when(!in_group, |d| d.mx(px(4.)).mb(px(2.)))
            .child(line)
            .children(detail)
            .into_any_element()
    }

    /// `AgentToolActivityGroup`: one line per step; long runs of settled
    /// exploration fold into one "Explored" line.
    fn render_tool_group(
        &mut self,
        row_id: &str,
        parts: &[Arc<Part>],
        _view: &AgentChatViewModel,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        // Drop a selection whose step left the group.
        if let Some(selected) = self.group_selected.get(row_id)
            && !parts.iter().any(|part| part.id == *selected)
        {
            self.group_selected.remove(row_id);
        }
        let mut group = v_flex().min_w_0().mx(px(4.)).mb(px(8.));
        for segment in agent_tool_step_segments(parts) {
            match segment {
                AgentToolStepSegment::Step { part, .. } => {
                    group = group.child(self.render_activity(row_id, &part, true, cx));
                }
                AgentToolStepSegment::Explored {
                    id,
                    parts: folded,
                    files,
                    searches,
                } => {
                    let key = format!("{row_id}:{id}");
                    let open = self.open_folds.contains(&key);
                    let summary = crate::localization::and_list(
                        &[
                            (files > 0).then(|| {
                                tf(
                                    "agent.toolStep.files",
                                    &[
                                        ("count", Arg::Number(files as i64)),
                                        ("value", Arg::Text(format_number(files as i64))),
                                    ],
                                )
                            }),
                            (searches > 0).then(|| {
                                tf(
                                    "agent.toolStep.searches",
                                    &[
                                        ("count", Arg::Number(searches as i64)),
                                        ("value", Arg::Text(format_number(searches as i64))),
                                    ],
                                )
                            }),
                        ]
                        .into_iter()
                        .flatten()
                        .collect::<Vec<_>>(),
                    );
                    let chevron = Icon::new("chevron-right")
                        .with_size(px(13.))
                        .stroke(2.)
                        .color(a.tool_glyph)
                        .when(open, |icon| icon.rotate(std::f32::consts::FRAC_PI_2));
                    let (toggle, splice) = (key.clone(), row_id.to_string());
                    let line = step_line(
                        SharedString::from(format!("tool-fold-{key}")),
                        chevron.into_any_element(),
                        t("agent.toolStep.explored").into(),
                        Some(subject_element(
                            &super::super::activity::agent_activity_views::StepSubject::Text(
                                summary,
                            ),
                            &a,
                        )),
                        None,
                        None,
                        true,
                        false,
                        &a,
                    )
                    .on_click(cx.listener(move |s, _, _, cx| {
                        if !s.open_folds.remove(&toggle) {
                            s.open_folds.insert(toggle.clone());
                        }
                        s.splice_row(&splice);
                        cx.notify();
                    }));
                    let mut fold = v_flex().min_w_0().child(line);
                    if open {
                        let mut body = v_flex()
                            .min_w_0()
                            .ml(px(EVIDENCE_RAIL_INLINE))
                            .pl(px(6.))
                            .border_l_1()
                            .border_color(a.border_subtle);
                        for part in &folded {
                            body = body.child(self.render_activity(row_id, part, true, cx));
                        }
                        fold = fold.child(body);
                    }
                    group = group.child(fold);
                }
            }
        }
        group.into_any_element()
    }

    /// `AgentHistoryNotice`.
    fn render_history_notice(
        &self,
        projection: &AgentProjection,
        a: &AgentTheme,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let notice = agent_history_notice(projection)?;
        let m = theme::ty();
        let open = self.history_notice_open;
        Some(
            div()
                .w_full()
                .max_w(px(CONTENT_MAX))
                .mx_auto()
                .mb(px(12.))
                .px(px(12.))
                .py(px(3.))
                .text_color(a.text_subtle)
                .text_size(px(m.right.caption))
                .line_height(px(m.right.meta_line_height))
                .child(
                    h_flex()
                        .id("agent-history-notice")
                        .gap(px(7.))
                        .cursor(theme::clickable_cursor())
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.history_notice_open = !s.history_notice_open;
                            let state = s.state();
                            let view = s.view_model(&state);
                            s.refresh_transcript(&state, &view);
                            cx.notify();
                        }))
                        .child(
                            Icon::new("info")
                                .with_size(px(14.))
                                .stroke(2.)
                                .color(a.text_subtle),
                        )
                        .child(t(notice.message_key)),
                )
                .when(open, |d| {
                    d.children(
                        notice
                            .reason_keys
                            .iter()
                            .map(|key| div().mt(px(6.)).whitespace_normal().child(t(key))),
                    )
                })
                .into_any_element(),
        )
    }

    /// `desktop-agent-live-tail`: the connection status and the run status
    /// with its running reasoning summary.
    fn render_live_tail(
        &mut self,
        state: &AgentControllerState,
        view: &AgentChatViewModel,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let m = theme::ty();
        let tail = live_tail(state, view);
        let mut column = v_flex().gap(px(6.));
        if let Some(status) = tail.connection {
            // `AgentConnectionStatus`.
            let reconnecting = status.state == "reconnecting";
            let fallback = if reconnecting {
                t("agent.connection.reconnecting")
            } else {
                t("agent.connection.fallback")
            };
            let attempt = match (status.attempt, status.max_attempts) {
                (Some(attempt), Some(max)) if attempt > 0 && max > 0 => format!(" {attempt}/{max}"),
                _ => String::new(),
            };
            let label = Some(status.message.clone())
                .filter(|m| !m.is_empty())
                .unwrap_or_else(|| format!("{fallback}{attempt}"));
            column = column.child(
                h_flex()
                    .px(px(12.))
                    .gap(px(6.))
                    .text_size(px(m.left.meta))
                    .text_color(a.text_subtle)
                    .child(
                        Icon::new(if reconnecting {
                            "loader-circle"
                        } else {
                            "arrow-left-right"
                        })
                        .with_size(px(12.))
                        .color(a.text_subtle),
                    )
                    .child(label),
            );
        }
        if let Some((label, summary)) = tail.working {
            let indicator = run_feedback(label.into(), Some("agent-live-tail".into()), &a);
            match summary {
                None => column = column.child(indicator),
                Some((_, summary)) => {
                    let open = self.run_summary_open;
                    column = column.child(
                        v_flex()
                            .max_w(px(520.))
                            .items_start()
                            .child(
                                div()
                                    .id("agent-run-status-toggle")
                                    .rounded(px(6.))
                                    .cursor(theme::clickable_cursor())
                                    .hover(move |s| s.bg(a.row_hover))
                                    .child(indicator)
                                    .on_click(cx.listener(|s, _, _, cx| {
                                        s.run_summary_open = !s.run_summary_open;
                                        let state = s.state();
                                        let view = s.view_model(&state);
                                        s.refresh_transcript(&state, &view);
                                        cx.notify();
                                    })),
                            )
                            .when(open, |d| {
                                d.child(
                                    div()
                                        .mt(px(4.))
                                        .px(px(12.))
                                        .text_size(px(m.left.meta))
                                        .line_height(px(m.left.meta * 1.5))
                                        .italic()
                                        .text_color(a.text_muted)
                                        .whitespace_normal()
                                        .child(summary),
                                )
                            }),
                    );
                }
            }
        }
        column.into_any_element()
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
