//! Port of `AgentTranscript`, `TranscriptRow`, `AgentMessagePart`,
//! `AgentTurnSummary` and the live tail (`AgentRunStatus`) with
//! `styles/transcript.css`. Rows come from `domain::agent_timeline`; the list is
//! top-aligned and follows the end while pinned, like the product viewport.
use super::super::super::domain::{
    agent_activity_presentation::duration_parts,
    agent_timeline::{self, Row, RowKind},
};
use super::agent_activity::{context_divider, run_feedback};
use super::agent_theme::AgentTheme;
use super::*;
use crate::{
    features::desktop_agent::application::agent_session_controller::now_ms,
    localization::{t as tr, tf},
    theme,
};

/// `--agent-content-max`, transcript padding and the 12px product scrollbar gutter.
const CONTENT_MAX: f32 = 900.;
const PAD_TOP: f32 = 12.;
const PAD_BOTTOM: f32 = 24.;
const INSET: f32 = 12.;
/// `AGENT_RUN_ELAPSED_LABEL_THRESHOLD_MS`.
const ELAPSED_LABEL_MS: u64 = 5_000;
/// `--desktop-sidebar-navigation-fade-size`.
const EDGE_FADE: f32 = 18.;

/// `formatAgentDuration`.
pub(super) fn format_duration(ms: u64) -> String {
    duration_parts(ms)
        .into_iter()
        .map(|(key, value)| tf(key, &[("value", (value as i64).into())]).to_string())
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Clone, Copy, PartialEq)]
enum RunStatus {
    Thinking,
    Working,
}

impl AgentChat {
    fn assistant_roles(&self) -> Vec<String> {
        vec![
            self.session.snapshot().runtime.clone(),
            self.installation.label.clone(),
        ]
    }

    /// `agentRunStatusCode`: what the running turn is doing, from its latest part.
    fn run_status(&self) -> Option<RunStatus> {
        let snapshot = self.session.snapshot();
        if snapshot.state != State::Running || !snapshot.interactions.is_empty() {
            return None;
        }
        let messages = &snapshot.messages;
        let start = messages
            .iter()
            .rposition(|m| m.role == "You")
            .map_or(0, |i| i + 1);
        let roles = self.assistant_roles();
        let Some(latest) = messages[start..].iter().rev().find(|m| m.role != "System") else {
            return Some(RunStatus::Thinking);
        };
        if roles.contains(&latest.role) {
            return (latest.status != "running").then_some(RunStatus::Working);
        }
        if matches!(
            latest.status.as_str(),
            "running"
                | "pending"
                | "in-progress"
                | "in_progress"
                | "inProgress"
                | "waiting-for-user"
                | "blocked"
        ) {
            return Some(if latest.role == "Reasoning" {
                RunStatus::Thinking
            } else {
                RunStatus::Working
            });
        }
        Some(RunStatus::Working)
    }

    pub(super) fn live_status_visible(&self) -> bool {
        self.live_status().is_some()
    }
    /// The live tail's label (`workingStatus`) and the running reasoning summary.
    fn live_status(&self) -> Option<(String, Option<String>)> {
        let snapshot = self.session.snapshot();
        if snapshot.state == State::Starting && self.session.awaiting_session() {
            return Some((
                tf(
                    "agent.transcript.preparing",
                    &[("agent", self.installation.label.clone().into())],
                )
                .into(),
                None,
            ));
        }
        let status = self.run_status()?;
        let label = tr(match status {
            RunStatus::Thinking => "agent.activity.thinking",
            RunStatus::Working => "agent.activity.working",
        });
        let elapsed = self
            .session
            .running
            .map(|turn| turn.active_elapsed_ms(now_ms()));
        let label = match elapsed.filter(|ms| *ms >= ELAPSED_LABEL_MS) {
            Some(ms) => tf(
                "agent.transcript.runElapsed",
                &[
                    ("status", label.to_string().into()),
                    ("duration", format_duration(ms / 1_000 * 1_000).into()),
                ],
            )
            .into(),
            None => label.to_string(),
        };
        let summary = (status == RunStatus::Thinking)
            .then(|| {
                snapshot
                    .messages
                    .iter()
                    .rev()
                    .take_while(|m| m.role != "You")
                    .find(|m| m.role == "Reasoning")
                    .map(|m| m.text.trim().chars().take(2_048).collect::<String>())
                    .filter(|s| !s.is_empty())
            })
            .flatten();
        Some((label, summary))
    }

    fn row_signature(&self, row: &Row) -> blake3::Hash {
        let messages = &self.session.snapshot().messages;
        let mut hasher = blake3::Hasher::new();
        hasher.update(row.id.as_bytes());
        hasher.update(format!("{:?}{}", row.kind, row.gap_after).as_bytes());
        for &index in &row.parts {
            if let Some(m) = messages.get(index) {
                hasher.update(m.id.as_bytes());
                hasher.update(m.text.as_bytes());
                hasher.update(m.status.as_bytes());
                hasher.update(m.input.as_deref().unwrap_or("").as_bytes());
            }
        }
        hasher.update(
            self.rail_selected
                .get(&row.id)
                .map_or("", String::as_str)
                .as_bytes(),
        );
        hasher.update(&[u8::from(self.rail_overflow.contains(&row.id))]);
        for key in self.expanded.iter().filter(|k| k.starts_with(&row.id)) {
            hasher.update(key.as_bytes());
        }
        hasher.finalize()
    }

    /// Rebuild the timeline and re-measure only rows whose content changed.
    pub(super) fn refresh_transcript(&mut self) {
        let roles = self.assistant_roles();
        let roles: Vec<&str> = roles.iter().map(String::as_str).collect();
        let rows = agent_timeline::build(
            &self.session.snapshot().messages,
            &roles,
            &self.session.turn_timings,
        );
        self.rows = rows;
        let tail = self.live_status().is_some();
        let mut next: Vec<(String, blake3::Hash)> = self
            .rows
            .iter()
            .map(|r| (r.id.clone(), self.row_signature(r)))
            .collect();
        if tail {
            let (label, summary) = self.live_status().unwrap_or_default();
            let mut hasher = blake3::Hasher::new();
            hasher.update(label.as_bytes());
            hasher.update(summary.unwrap_or_default().as_bytes());
            hasher.update(&[u8::from(self.run_summary_open)]);
            next.push(("live-tail".into(), hasher.finalize()));
        }
        let previous = std::mem::take(&mut self.row_signatures);
        let added = next.len().saturating_sub(previous.len());
        if next.len() < previous.len()
            || next.first().map(|x| &x.0) != previous.first().map(|x| &x.0)
        {
            self.transcript.reset(next.len());
        } else {
            for (i, signature) in next.iter().enumerate().take(previous.len()) {
                if previous.get(i) != Some(signature) {
                    self.transcript.splice(i..i + 1, 1);
                }
            }
            if next.len() > previous.len() {
                self.transcript
                    .splice(previous.len()..previous.len(), next.len() - previous.len());
            }
        }
        if !self.follow && added > 0 {
            self.unread = (self.unread + added).min(99);
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

    /// Re-measure one row after its disclosure state changed.
    pub(super) fn splice_row(&mut self, row_id: &str) {
        if let Some(index) = self.rows.iter().position(|r| r.id == row_id) {
            self.transcript.splice(index..index + 1, 1);
            if let Some(signature) = self.rows.get(index).map(|r| self.row_signature(r))
                && let Some(entry) = self.row_signatures.get_mut(index)
            {
                entry.1 = signature;
            }
        }
    }

    pub(super) fn render_row(&mut self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let t = Theme::new(self.dark);
        let a = AgentTheme::new(&t);
        let m = theme::ty();
        let last = index + 1 == self.row_signatures.len();
        let content_width = (self.transcript_width - 2. * INSET).clamp(0., CONTENT_MAX);
        let (body, gap) = if let Some(row) = self.rows.get(index).cloned() {
            let messages = &self.session.snapshot().messages;
            let first = row.parts.first().and_then(|&i| messages.get(i)).cloned();
            let body = match (&row.kind, first) {
                (RowKind::User, Some(message)) => {
                    let delivery = match message.status.as_str() {
                        "queued" => Some(tr("agent.status.queued")),
                        "failed" | "not-sent" => Some(tr("agent.status.notSent")),
                        _ => None,
                    };
                    column()
                        .w_full()
                        .px(px(12.))
                        .py(px(8.))
                        .rounded(px(8.))
                        .border_1()
                        .border_color(a.user_message_border)
                        .bg(a.user_message_surface)
                        .child(
                            div()
                                .text_size(px(m.left.content))
                                .line_height(px(m.left.content * 1.6))
                                .text_color(a.text)
                                .whitespace_normal()
                                .child(message.text.clone()),
                        )
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
                (RowKind::Assistant, Some(message)) => {
                    let terminal = matches!(
                        message.status.as_str(),
                        "failed" | "interrupted" | "cancelled"
                    )
                    .then(|| {
                        tr(&format!(
                            "agent.turn.status.{}",
                            if message.status == "cancelled" {
                                "interrupted"
                            } else {
                                message.status.as_str()
                            }
                        ))
                        .to_string()
                    });
                    div()
                        .relative()
                        .w_full()
                        .pt(px(2.))
                        .child(
                            div()
                                .px(px(12.))
                                .when(terminal.is_some(), |d| d.pr(px(84.)))
                                .child(super::super::agent_markdown::render(
                                    &message_preview(&message.text),
                                    t,
                                    index,
                                    cx,
                                )),
                        )
                        .children(terminal.map(|label| {
                            div()
                                .absolute()
                                .right_0()
                                .bottom_0()
                                .text_size(px(m.left.meta))
                                .text_color(if message.status == "failed" {
                                    t.danger
                                } else {
                                    a.text_muted
                                })
                                .child(label)
                        }))
                        .into_any_element()
                }
                (RowKind::TurnSummary(timing), _) => run_feedback(
                    tf(
                        "agent.turn.workedFor",
                        &[("duration", format_duration(timing.duration_ms).into())],
                    )
                    .into(),
                    None,
                    &a,
                )
                .into_any_element(),
                (RowKind::Reasoning, Some(message)) => self.render_reasoning(&message, &row.id, cx),
                (RowKind::Plan, Some(message)) => self.render_plan(&message, &row.id, cx),
                (RowKind::Compaction { .. }, Some(message)) => {
                    let label = if message.status == "running" {
                        tr("agent.activity.compactingContext")
                    } else {
                        tr("agent.activity.contextCompacted")
                    };
                    context_divider(label.into(), &a)
                }
                (RowKind::ToolGroup, _) => self.render_tool_group(&row, content_width, cx),
                _ => div().into_any_element(),
            };
            (body, row.gap_after)
        } else {
            (self.render_live_tail(cx), 0.)
        };
        let tail_padding = if self.rows.get(index).is_none() {
            8.
        } else {
            0.
        };
        div()
            .w_full()
            .pl(px(INSET))
            .pr(px(INSET))
            .when(index == 0, |d| d.pt(px(PAD_TOP)))
            .pb(px(gap + tail_padding + if last { PAD_BOTTOM } else { 0. }))
            .child(div().w_full().max_w(px(CONTENT_MAX)).mx_auto().child(body))
            .into_any_element()
    }

    /// `desktop-agent-live-tail`: "Thinking"/"Working · 12s" with dots; a
    /// running reasoning summary can be disclosed beneath it.
    fn render_live_tail(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = Theme::new(self.dark);
        let a = AgentTheme::new(&t);
        let Some((label, summary)) = self.live_status() else {
            return div().into_any_element();
        };
        let indicator = run_feedback(label.into(), Some("agent-live-tail".into()), &a);
        let Some(summary) = summary else {
            return indicator.into_any_element();
        };
        let open = self.run_summary_open;
        column()
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
                        s.refresh_transcript();
                        cx.notify();
                    })),
            )
            .when(open, |d| {
                d.child(
                    div()
                        .mt(px(1.))
                        .mx(px(12.))
                        .py(px(4.))
                        .pl(px(12.))
                        .border_l_1()
                        .border_color(a.border_subtle)
                        .text_size(px(theme::ty().left.content))
                        .line_height(px(theme::ty().left.content * 1.55))
                        .italic()
                        .text_color(a.text_muted)
                        .whitespace_normal()
                        .child(summary),
                )
            })
            .into_any_element()
    }

    /// The scrolling transcript with its top edge fade and Jump to latest.
    pub(super) fn render_transcript(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = Theme::new(self.dark);
        let a = AgentTheme::new(&t);
        let weak = cx.weak_entity();
        let entity = cx.entity();
        let scrolled = {
            let top = self.transcript.logical_scroll_top();
            top.item_ix > 0 || top.offset_in_item > px(0.)
        };
        let unread = self.unread;
        let jump_label: SharedString = if unread > 0 {
            tf(
                "agent.transcript.jumpLatestUnread",
                &[("count", (unread as i64).into())],
            )
            .into()
        } else {
            tr("agent.transcript.jumpLatest").into()
        };
        div()
            .relative()
            .flex_1()
            .min_h_0()
            .child(
                list(self.transcript.clone(), move |i, _, cx| {
                    weak.update(cx, |s, cx| s.render_row(i, cx))
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
            .when(scrolled, |d| {
                // `.desktop-agent-transcript-wrap::before`: canvas → 78% canvas → transparent.
                d.child(
                    column()
                        .absolute()
                        .top_0()
                        .left_0()
                        .right(px(INSET))
                        .h(px(EDGE_FADE))
                        .child(div().h(px(EDGE_FADE * 0.46)).bg(linear_gradient(
                            180.,
                            linear_color_stop(a.canvas, 0.),
                            linear_color_stop(a.edge_fade, 1.),
                        )))
                        .child(div().flex_1().bg(linear_gradient(
                            180.,
                            linear_color_stop(a.edge_fade, 0.),
                            linear_color_stop(theme::alpha(a.canvas, 0.), 1.),
                        ))),
                )
            })
            .when(!self.follow && !self.rows.is_empty(), |d| {
                d.child(
                    div()
                        .absolute()
                        .bottom(px(12.))
                        .w_full()
                        .flex()
                        .justify_center()
                        .child(
                            gpui_kit::base::Button::new("agent-jump-latest")
                                .accessibility_label(jump_label.clone())
                                .size(px(theme::control()))
                                .rounded_full()
                                .border_1()
                                .border_color(a.border_subtle)
                                .bg(a.question_surface)
                                .text_color(a.text)
                                .cursor(theme::clickable_cursor())
                                .hover(move |s| s.bg(a.row_hover))
                                .tooltip(crate::ui::tooltip(tr("agent.transcript.jumpLatest")))
                                .child(crate::ui::icon_stroke("arrow-down", 15., 2., a.text))
                                .on_click(cx.listener(|s, _, _, cx| {
                                    s.follow = true;
                                    s.unread = 0;
                                    s.refresh_transcript();
                                    cx.notify()
                                })),
                        ),
                )
            })
            .into_any_element()
    }

    /// `AgentEmptyState`: the monochrome runtime mark (click to spin) and prompt.
    pub(super) fn render_empty(&mut self, cx: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        let a = AgentTheme::new(&t);
        let turns = self.logo_turns;
        let spin = tf(
            "agent.empty.spinLogo",
            &[("agent", self.installation.label.clone().into())],
        );
        let mark: AnyElement =
            match super::super::agent_brand_mark::svg_path(self.runtime(), self.dark) {
                Some(path) => svg()
                    .path(path)
                    .size(px(28.))
                    .text_color(a.empty_brand)
                    .with_animation(
                        ElementId::NamedInteger("agent-logo-spin".into(), turns as u64),
                        // `transform 780ms cubic-bezier(0.16, 0.86, 0.22, 1.1)`: a soft overshoot.
                        Animation::new(std::time::Duration::from_millis(780)).with_easing(
                            |x: f32| {
                                let overshoot = 1. - (1. - x).powi(3);
                                overshoot + 0.04 * (std::f32::consts::PI * x).sin()
                            },
                        ),
                        move |el, delta| {
                            let angle = if turns == 0 {
                                0.
                            } else {
                                delta * std::f32::consts::TAU
                            };
                            el.with_transformation(Transformation::rotate(radians(angle)))
                        },
                    )
                    .into_any_element(),
                // Raster marks have no monochrome form; present them quietly.
                None => div()
                    .opacity(0.55)
                    .child(
                        super::super::agent_brand_mark::brand_image(self.runtime(), self.dark, 28.)
                            .grayscale(true),
                    )
                    .into_any_element(),
            };
        // The dock overlays the transcript; the empty state centres above it.
        column()
            .flex_1()
            .items_center()
            .justify_center()
            .gap(px(14.))
            .px(px(12.))
            .child(
                gpui_kit::base::Button::new("agent-empty-logo")
                    .accessibility_label(spin.clone())
                    // `--po-control-size-roomy` with a -4px margin.
                    .size(px(theme::control() + 4.))
                    .m(px(-4.))
                    .rounded_full()
                    .cursor(theme::clickable_cursor())
                    .tooltip(crate::ui::tooltip(spin))
                    .child(mark)
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.logo_turns += 1;
                        cx.notify()
                    })),
            )
            .child(
                div()
                    .text_size(px(theme::ty().left.content))
                    .line_height(px(theme::ty().left.content * 1.4))
                    .text_color(a.text_subtle)
                    .child(tr("agent.empty.prompt")),
            )
    }
}
