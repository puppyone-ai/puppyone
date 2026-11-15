//! The live tail (`AgentRunStatus`, `AgentConnectionStatus`) and
//! `AgentHistoryNotice`, with the run-status rules they follow.
use super::super::agent_history_presentation::agent_history_notice;
use super::super::agent_theme::AgentTheme;
use super::super::elements::run_feedback;
use super::view::{CONTENT_MAX, TranscriptInput, TranscriptView};
use crate::agent::contract::dto::{AgentProjection, ConnectionStatus, Part, Turn};
use crate::features::desktop_agent::application::agent_controller_state::AgentSubmissionStage;
use crate::features::desktop_agent::domain::agent_activity_presentation::{
    format_agent_duration, output_for_activity,
};
use crate::localization::{Arg, bidi_isolate, t, tf};
use crate::text;
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;
use std::sync::Arc;

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
pub(super) struct LiveTail {
    pub connection: Option<ConnectionStatus>,
    pub working: Option<(String, Option<(String, String)>)>,
}

pub(super) fn live_tail(input: &TranscriptInput) -> LiveTail {
    let projection = &input.projection;
    let connection = projection.connection_status.clone();
    let submission = agent_submission_status_label(input.submission_stage, &input.runtime_label);
    let run_status = if connection.is_none() && submission.is_none() {
        agent_run_status_code(projection, input.working)
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

impl TranscriptView {
    /// `AgentHistoryNotice`.
    pub(super) fn render_history_notice(
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
                            s.refresh();
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
    pub(super) fn render_live_tail(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let m = theme::ty();
        let tail = live_tail(&self.input);
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
                                        s.refresh();
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
