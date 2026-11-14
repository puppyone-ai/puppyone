//! `TranscriptRow`, `AgentPartRenderer` and `AgentMessagePart`: one row of
//! the transcript, the user's prompt and the Agent's answer.
use super::super::agent_theme::AgentTheme;
use super::super::elements::{mention_chip, run_feedback};
use super::view::{CONTENT_MAX, INSET, PAD_BOTTOM, PAD_TOP, TranscriptView};
use crate::agent::contract::dto::Part;
use crate::features::desktop_agent::domain::agent_activity_presentation::format_agent_duration;
use crate::features::desktop_agent::domain::agent_prompt_mentions::{
    PromptPart, is_agent_media_display, split_agent_prompt_mentions,
};
use crate::features::desktop_agent::domain::agent_stream_presentation::split_streaming_markdown;
use crate::localization::{Arg, t, tf};
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use std::sync::Arc;

impl TranscriptView {
    pub(super) fn render_row(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let last = index + 1 == self.row_signatures.len();
        let content_width = (self.width - 2. * INSET).clamp(0., CONTENT_MAX);
        let (body, gap) = match self.rows.get(index).cloned() {
            Some(row) => {
                let parts: Vec<Arc<Part>> = row
                    .part_ids
                    .iter()
                    .filter_map(|id| self.parts.get(id).cloned())
                    .collect();
                let body = match parts.first() {
                    None => div().into_any_element(),
                    Some(_) if row.tool_group => self.render_tool_group(&row.row.id, &parts, cx),
                    Some(part) => self.render_part(&row.row.id, part, content_width, window, cx),
                };
                (body, self.gaps.get(index).copied().unwrap_or(0.))
            }
            None => (self.render_live_tail(cx), 0.),
        };
        let tail_padding = if self.rows.get(index).is_none() {
            8.
        } else {
            0.
        };
        let notice = (index == 0)
            .then(|| self.render_history_notice(&self.input.projection, &a, cx))
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
        content_width: f32,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        match part.kind.as_str() {
            "user" => self.render_user_message(part, &a),
            "assistant" => self.render_assistant_message(part, content_width, window, cx),
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
}
