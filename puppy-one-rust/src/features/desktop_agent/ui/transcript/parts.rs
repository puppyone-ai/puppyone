//! `TranscriptRow`, `AgentPartRenderer` and `AgentMessagePart`: one row of
//! the transcript, the user's prompt and the Agent's answer.
use super::super::agent_markdown_policy::initial_window;
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

/// `desktop-agent-part-in`'s duration.
const ENTRANCE: std::time::Duration = std::time::Duration::from_millis(140);

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
        let row_id = self
            .rows
            .get(index)
            .map_or_else(|| "live-tail".to_owned(), |row| row.row.id.clone());
        let (body, entrance, gap) = match self.rows.get(index).cloned() {
            Some(row) => {
                let parts: Vec<Arc<Part>> = row
                    .part_ids
                    .iter()
                    .filter_map(|id| self.parts.get(id).cloned())
                    .collect();
                let entrance = self.entrance(&row.row.id, &parts, window);
                let body = match parts.first() {
                    None => div().into_any_element(),
                    Some(_) if row.tool_group => self.render_tool_group(&row.row.id, &parts, cx),
                    Some(part) => self.render_part(&row.row.id, part, content_width, window, cx),
                };
                (body, entrance, self.gaps.get(index).copied().unwrap_or(0.))
            }
            None => (self.render_live_tail(cx), None, 0.),
        };
        let tail_padding = if self.rows.get(index).is_none() {
            8.
        } else {
            0.
        };
        let notice = (index == 0)
            .then(|| self.render_history_notice(&self.input.projection, &a, cx))
            .flatten();
        let entering = format!("agent-row-entering:{row_id}");
        div()
            .debug_selector(move || format!("agent-row:{row_id}"))
            .w_full()
            .pl(px(INSET))
            .pr(px(INSET))
            .when(index == 0, |d| d.pt(px(PAD_TOP)))
            .children(notice)
            .pb(px(gap + tail_padding + if last { PAD_BOTTOM } else { 0. }))
            .child(
                div()
                    .w_full()
                    .max_w(px(CONTENT_MAX))
                    .mx_auto()
                    .when_some(entrance, |d, opacity| {
                        d.opacity(opacity).debug_selector(move || entering)
                    })
                    .child(body),
            )
            .into_any_element()
    }

    /// `TranscriptRow`'s entrance: a row whose first part was never shown
    /// (and is not the user's prompt or a turn summary) fades in once,
    /// 140ms on `cubic-bezier(0.2, 0.75, 0.25, 1)`; its opacity while it does.
    fn entrance(&mut self, row_id: &str, parts: &[Arc<Part>], window: &mut Window) -> Option<f32> {
        let first = parts.first()?;
        if !self.seen_parts.contains(&first.id)
            && !matches!(first.kind.as_str(), "user" | "turn-summary")
            && !self.reduce_motion
        {
            self.entering.insert(
                row_id.to_owned(),
                crate::ui::motion::Timeline::start(ENTRANCE),
            );
        }
        self.seen_parts
            .extend(parts.iter().map(|part| part.id.clone()));
        let timeline = self.entering.get(row_id)?;
        if timeline.finished() {
            self.entering.remove(row_id);
            return None;
        }
        window.request_animation_frame();
        Some(crate::ui::motion::cubic_bezier(
            0.2,
            0.75,
            0.25,
            1.,
            timeline.time(),
        ))
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
            "assistant" => self.render_assistant_message(row_id, part, content_width, window, cx),
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
                let selector = format!("agent-turn-summary:{label}");
                div()
                    .debug_selector(move || selector)
                    .child(run_feedback(label.into(), None, &a))
                    .into_any_element()
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
        // Every layer is held to the panel's width so the prompt wraps
        // inside the bubble at any panel width.
        let mut body = h_flex()
            .w_full()
            .min_w_0()
            .flex_wrap()
            .items_baseline()
            .gap_y(px(2.));
        for segment in split_agent_prompt_mentions(&text, &mentions) {
            body = match segment {
                PromptPart::Text(text) => {
                    body.child(div().min_w_0().max_w_full().whitespace_normal().child(text))
                }
                PromptPart::Mention { text, .. } => body.child(mention_chip(a, text, false)),
            };
        }
        // A turn sent to another model than the one before says so above
        // the prompt; the conversation continues on that model.
        let switched = part.switched_to_model.as_deref().map(|model| {
            div()
                .mb(px(6.))
                .text_size(px(m.left.meta))
                .line_height(px(m.right.meta_line_height))
                .text_color(a.text_muted)
                .child(tf(
                    "native.agent.turn.modelSwitched",
                    &[("model", Arg::Text(model.to_string()))],
                ))
        });
        let selector = format!("agent-user-message:{}", part.id);
        let bubble =
            v_flex()
                .debug_selector(move || selector)
                .w_full()
                .min_w_0()
                .overflow_hidden()
                .px(px(12.))
                .py(px(8.))
                .rounded(px(8.))
                .border_1()
                .border_color(a.user_message_border)
                .bg(a.user_message_surface)
                .when(!media.is_empty(), |d| {
                    d.child(h_flex().gap(px(6.)).mb(px(6.)).children(media.iter().map(
                        |reference| {
                            let selector = format!("agent-media:{}", reference.display_name);
                            div()
                                .debug_selector(move || selector)
                                .px(px(6.))
                                .py(px(2.))
                                .rounded(px(4.))
                                .border_1()
                                .border_color(a.border_subtle)
                                .text_size(px(m.left.meta))
                                .text_color(a.text_muted)
                                .child(reference.display_name.clone())
                        },
                    )))
                })
                .when(!text.is_empty(), |d| {
                    d.child(
                        div()
                            .w_full()
                            .min_w_0()
                            .text_size(px(m.left.content))
                            .line_height(px(m.left.content * 1.6))
                            .text_color(a.text)
                            .child(body),
                    )
                })
                .children(delivery.map(|label| {
                    let selector = format!("agent-delivery:{label}");
                    div()
                        .debug_selector(move || selector)
                        .mt(px(4.))
                        .text_size(px(m.left.meta))
                        .line_height(px(m.right.meta_line_height))
                        .text_color(a.text_muted)
                        .child(label)
                }));
        v_flex()
            .w_full()
            .min_w_0()
            .children(switched)
            .child(bubble)
            .into_any_element()
    }

    /// `AgentMessagePart` for the Agent: the answer stays in the document
    /// flow; incomplete Markdown streams as a plain tail.
    fn render_assistant_message(
        &self,
        row_id: &str,
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
        // `createInitialAgentMarkdownWindow`: a long answer shows its first
        // window until it is opened in full.
        let full = self.full_answers.contains(&id);
        let (shown, truncated) = if full {
            (text.clone(), false)
        } else {
            initial_window(&text)
        };
        let (stable, tail) = if streaming {
            split_streaming_markdown(&shown)
        } else {
            (shown, String::new())
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
                            cx,
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
                let selector = format!("agent-reply-state:{label}");
                div()
                    .debug_selector(move || selector)
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
            .when(full || truncated, |d| {
                // `.desktop-agent-markdown-disclosure`.
                let row = row_id.to_owned();
                let answer = id.clone();
                d.child(
                    div().px(px(12.)).flex().child(
                        div()
                            .id(SharedString::from(format!("agent-md-disclosure-{id}")))
                            .debug_selector(move || {
                                let key = if full {
                                    "agent.markdown.collapse"
                                } else {
                                    "agent.markdown.showFull"
                                };
                                format!("agent-md-disclosure:{}", t(key))
                            })
                            .mt(px(8.))
                            .h(px(theme::control()))
                            .px(px(9.))
                            .flex()
                            .items_center()
                            .flex_none()
                            .border_1()
                            .border_color(a.border_subtle)
                            .rounded(px(9.))
                            .bg(a.control_surface)
                            .text_size(px(m.left.content))
                            .text_color(a.text_muted)
                            .cursor(theme::clickable_cursor())
                            .hover(move |s| {
                                s.border_color(palette.border_strong)
                                    .bg(palette.hover)
                                    .text_color(palette.text)
                            })
                            .on_click(cx.listener(move |s, _, _, cx| {
                                if !s.full_answers.remove(&answer) {
                                    s.full_answers.insert(answer.clone());
                                }
                                s.splice_row(&row);
                                cx.notify();
                            }))
                            .child(t(if full {
                                "agent.markdown.collapse"
                            } else {
                                "agent.markdown.showFull"
                            })),
                    ),
                )
            })
            .when(part.truncated == Some(true), |d| {
                d.child(
                    div()
                        .debug_selector(|| "agent-reply-partial".into())
                        .px(px(12.))
                        .text_size(px(m.left.meta))
                        .text_color(a.text_muted)
                        .child(t("agent.message.partial")),
                )
            })
            .into_any_element()
    }
}
