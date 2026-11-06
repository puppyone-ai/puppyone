//! `AgentApprovalDock` and `AgentQuestionDock` (`styles/blocking.css`):
//! pending interactions sit above the composer and cannot scroll away.
use super::super::agent_chat_view_model::AgentChatViewModel;
use super::super::agent_theme::AgentTheme;
use super::status::{ButtonTone, agent_button};
use super::{AgentChatTabPanel, text_of};
use crate::localization::{Arg, bidi_isolate, t, tf};
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use crate::ui::form_input::TextInput;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;
use serde_json::{Value, json};

/// `normalizeApprovalCopy(value)`.
fn normalize_copy(value: &str) -> String {
    crate::agent::contract::js::trim(value)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// `distinctApprovalReason(reason, title)`.
fn distinct_reason(reason: Option<&str>, title: &str) -> Option<String> {
    let reason = reason?;
    let normalized = normalize_copy(reason);
    (!normalized.is_empty() && normalized != normalize_copy(title))
        .then(|| crate::agent::contract::js::trim(reason).to_string())
}

/// `approvalActionLabel(action)`.
fn action_label(action: &Value) -> String {
    let kind = action["type"].as_str().unwrap_or("action");
    let name = action["name"].as_str();
    let target = action["path"]
        .as_str()
        .or_else(|| action["command"].as_str());
    [Some(name.unwrap_or(kind)), target]
        .into_iter()
        .flatten()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(": ")
}

impl AgentChatTabPanel {
    fn dock_card(&self, a: &AgentTheme) -> Stateful<Div> {
        let m = theme::ty();
        v_flex()
            .id("agent-interaction-dock")
            .relative()
            .w_full()
            .max_w(px(900.))
            .mx_auto()
            .max_h(px(360.))
            .overflow_y_scroll()
            .track_scroll(&self.dock_scroll)
            .flex_shrink_0()
            .p(px(10.))
            .rounded(px(8.))
            .border_1()
            .border_color(a.blocking_border)
            .bg(a.blocking_surface)
            .text_size(px(m.left.content))
            .text_color(a.text)
    }

    /// `AgentApprovalDock`.
    pub(super) fn render_approval_dock(
        &mut self,
        approval: &Value,
        queue_length: usize,
        view: &AgentChatViewModel,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t_ = cx.palette();
        let a = AgentTheme::new(&t_);
        let m = theme::ty();
        let resolving = view.approval_resolving;
        let runtime_label = view.runtime.runtime_label.clone();
        let decisions: Vec<String> = approval["availableDecisions"]
            .as_array()
            .map(|d| {
                d.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let can_allow_for_session = decisions.iter().any(|d| d == "acceptForSession");
        let raw_title =
            crate::agent::contract::js::trim(approval["title"].as_str().unwrap_or_default())
                .to_string();
        let title = if raw_title.is_empty() {
            t("agent.approval.required").to_string()
        } else {
            raw_title
        };
        let reason = distinct_reason(approval["reason"].as_str(), &title);
        let status = if resolving {
            t("agent.approval.resolving").to_string()
        } else if queue_length > 1 {
            tf(
                "agent.approval.pending",
                &[("count", Arg::Number(queue_length as i64))],
            )
        } else {
            t("agent.approval.waiting").to_string()
        };
        let command = approval["command"]
            .as_str()
            .filter(|c| !c.is_empty())
            .map(str::to_string);
        let cwd = approval["cwd"]
            .as_str()
            .filter(|c| !c.is_empty())
            .map(str::to_string);
        let network = approval["networkApprovalContext"]
            .as_object()
            .map(|context| {
                format!(
                    "{}://{}",
                    context
                        .get("protocol")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    context
                        .get("host")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                )
            });
        let grant_root = approval["grantRoot"]
            .as_str()
            .filter(|g| !g.is_empty())
            .map(str::to_string);
        let actions: Vec<String> = if command.is_none() {
            approval["commandActions"]
                .as_array()
                .map(|actions| actions.iter().take(5).map(action_label).collect())
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let policy = approval["policyChangeRequested"] == true;
        let meta = |text: String| {
            div()
                .text_size(px(m.left.meta))
                .line_height(px(m.left.meta * 1.5))
                .text_color(a.text_muted)
                .whitespace_normal()
                .child(text)
        };
        let code = |text: String| {
            div()
                .font_family(theme::MONO)
                .text_size(px(m.right.code))
                .line_height(px(m.right.code * 1.5))
                .text_color(a.text_muted)
                .whitespace_normal()
                .child(text)
        };
        let show_details = command.is_some()
            || cwd.is_some()
            || network.is_some()
            || grant_root.is_some()
            || !actions.is_empty()
            || reason.is_some()
            || policy;
        let mut details = v_flex().gap(px(6.)).mt(px(8.)).pl(px(32.)).min_w_0();
        if let Some(command) = command {
            details = details.child(code(command));
        }
        if let Some(cwd) = cwd {
            details = details.child(meta(tf(
                "agent.approval.inPath",
                &[("path", Arg::Text(bidi_isolate(&cwd)))],
            )));
        }
        if let Some(network) = network {
            details = details
                .child(meta(t("agent.approval.networkTarget").into()))
                .child(code(network));
        }
        if let Some(root) = grant_root {
            details = details
                .child(meta(t("agent.approval.writeScope").into()))
                .child(code(root));
        }
        for action in actions {
            details = details.child(meta(format!("• {action}")));
        }
        if let Some(reason) = reason {
            details = details.child(meta(reason));
        }
        if policy {
            details = details.child(meta(tf(
                "agent.approval.policyNote",
                &[("agent", Arg::Text(bidi_isolate(&runtime_label)))],
            )));
        }
        let resolve = |decision: &'static str| {
            cx.listener(move |s: &mut Self, _, _, cx| {
                drop(s.controller.resolve_approval(Value::from(decision)));
                cx.notify();
            })
        };
        let mut footer = h_flex().justify_end().flex_wrap().gap(px(4.)).mt(px(10.));
        footer = footer.child(
            agent_button(
                "approval-deny",
                t("agent.approval.deny").into(),
                ButtonTone::Quiet,
                resolving,
                &a,
            )
            .on_click(resolve("decline")),
        );
        if can_allow_for_session {
            footer = footer.child(
                agent_button(
                    "approval-session",
                    t("agent.approval.allowSession").into(),
                    ButtonTone::Secondary,
                    resolving,
                    &a,
                )
                .on_click(resolve("acceptForSession")),
            );
        }
        footer = footer.child(
            agent_button(
                "approval-once",
                t("agent.approval.allowOnce").into(),
                ButtonTone::Primary,
                resolving,
                &a,
            )
            .on_click(resolve("accept")),
        );
        self.dock_card(&a)
            .child(
                h_flex()
                    .gap(px(8.))
                    .min_w_0()
                    .child(
                        div()
                            .size(px(24.))
                            .flex_shrink_0()
                            .rounded(px(6.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(a.blocking_icon_surface)
                            .child(
                                Icon::new("shield-alert")
                                    .with_size(px(14.))
                                    .stroke(1.7)
                                    .color(a.blocking_icon),
                            ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .font_weight(FontWeight::MEDIUM)
                            .whitespace_normal()
                            .child(title),
                    )
                    .child(
                        div()
                            .flex_shrink_0()
                            .text_size(px(m.left.meta))
                            .text_color(a.text_subtle)
                            .child(status),
                    ),
            )
            .when(show_details, |d| d.child(details))
            .child(footer)
            .into_any_element()
    }

    /// `AgentQuestionDock`.
    pub(super) fn render_question_dock(
        &mut self,
        request: &Value,
        queue_length: usize,
        view: &AgentChatViewModel,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t_ = cx.palette();
        let a = AgentTheme::new(&t_);
        let m = theme::ty();
        let resolving = view.question_resolving;
        let request_id = text_of(&request["requestId"]);
        let questions = request["questions"].as_array().cloned().unwrap_or_default();
        let answers = self
            .question_answers
            .get(&request_id)
            .cloned()
            .unwrap_or_default();
        let complete = !questions.is_empty()
            && (0..questions.len()).all(|index| {
                answers
                    .get(&index)
                    .is_some_and(|values| values.iter().any(|answer| !answer.trim().is_empty()))
            });
        let mut card = self.dock_card(&a).child(
            h_flex()
                .gap(px(8.))
                .child(
                    Icon::new("circle-help")
                        .with_size(px(15.))
                        .color(a.blocking_icon),
                )
                .child(
                    div()
                        .font_weight(FontWeight::MEDIUM)
                        .child(t("agent.question.inputNeeded")),
                )
                .when(queue_length > 1, |d| {
                    d.child(
                        div()
                            .text_size(px(m.left.meta))
                            .text_color(a.text_subtle)
                            .child(tf(
                                "agent.question.pending",
                                &[("count", Arg::Number(queue_length as i64))],
                            )),
                    )
                }),
        );
        for (index, question) in questions.iter().enumerate() {
            let header = question["header"]
                .as_str()
                .filter(|h| !h.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| {
                    tf(
                        "agent.question.number",
                        &[("number", Arg::Number(index as i64 + 1))],
                    )
                });
            let options = question["options"].as_array().cloned().unwrap_or_default();
            let multiple = question["multiple"] == true;
            let custom = question["custom"] == true;
            let selected = answers.get(&index).cloned().unwrap_or_default();
            let mut fieldset = v_flex()
                .mt(px(10.))
                .gap(px(4.))
                .child(
                    div()
                        .font_weight(FontWeight::MEDIUM)
                        .text_size(px(m.left.content))
                        .child(header),
                )
                .child(
                    div()
                        .text_size(px(m.left.content))
                        .text_color(a.text_muted)
                        .whitespace_normal()
                        .child(text_of(&question["question"])),
                );
            for option in &options {
                let label = text_of(&option["label"]);
                let checked = selected.contains(&label);
                let description = option["description"]
                    .as_str()
                    .filter(|d| !d.is_empty())
                    .map(str::to_string);
                let (request, value) = (request_id.clone(), label.clone());
                fieldset = fieldset.child(
                    h_flex()
                        .id(SharedString::from(format!(
                            "question-{request_id}-{index}-{label}"
                        )))
                        .items_start()
                        .gap(px(8.))
                        .px(px(6.))
                        .py(px(4.))
                        .rounded(px(6.))
                        .when(!resolving, |d| {
                            d.cursor(theme::clickable_cursor())
                                .hover(move |s| s.bg(a.row_hover))
                        })
                        .on_click(cx.listener(move |s, _, _, cx| {
                            if resolving {
                                return;
                            }
                            let answers = s.question_answers.entry(request.clone()).or_default();
                            let current = answers.entry(index).or_default();
                            if multiple {
                                if current.contains(&value) {
                                    current.retain(|answer| answer != &value);
                                } else {
                                    current.push(value.clone());
                                }
                            } else {
                                *current = vec![value.clone()];
                            }
                            cx.notify();
                        }))
                        .child(
                            Icon::new(match (multiple, checked) {
                                (true, true) => "square-check",
                                (true, false) => "square",
                                (false, true) => "circle-dot",
                                (false, false) => "circle",
                            })
                            .with_size(px(14.))
                            .color(if checked {
                                a.text
                            } else {
                                a.text_subtle
                            }),
                        )
                        .child(
                            v_flex()
                                .min_w_0()
                                .child(div().font_weight(FontWeight::MEDIUM).child(label))
                                .children(description.map(|d| {
                                    div()
                                        .text_size(px(m.left.meta))
                                        .text_color(a.text_subtle)
                                        .whitespace_normal()
                                        .child(d)
                                })),
                        ),
                );
            }
            if options.is_empty() || custom {
                let key = format!("{request_id}:{index}");
                let placeholder: SharedString = if options.is_empty() {
                    t("agent.question.typeAnswer").into()
                } else {
                    t("agent.question.other").into()
                };
                let input = self
                    .question_inputs
                    .entry(key)
                    .or_insert_with(|| {
                        let entity =
                            cx.new(|cx| TextInput::new(placeholder, false, 8_000, window, cx));
                        let (request, option_labels) = (
                            request_id.clone(),
                            options
                                .iter()
                                .map(|o| text_of(&o["label"]))
                                .collect::<Vec<_>>(),
                        );
                        cx.observe(&entity, move |s: &mut Self, input, cx| {
                            let custom = input.read(cx).text().to_string();
                            let answers = s.question_answers.entry(request.clone()).or_default();
                            let current = answers.entry(index).or_default();
                            let chosen: Vec<String> = current
                                .iter()
                                .filter(|a| option_labels.contains(a))
                                .cloned()
                                .collect();
                            *current = if multiple {
                                chosen
                                    .into_iter()
                                    .chain((!custom.is_empty()).then_some(custom))
                                    .collect()
                            } else if custom.is_empty() {
                                Vec::new()
                            } else {
                                vec![custom]
                            };
                            cx.notify();
                        })
                        .detach();
                        entity
                    })
                    .clone();
                fieldset = fieldset.child(div().mt(px(4.)).child(input));
            }
            card = card.child(fieldset);
        }
        let skip_request = request.clone();
        let answer_request = request_id.clone();
        let count = questions.len();
        card.child(
            h_flex()
                .justify_end()
                .gap(px(4.))
                .mt(px(10.))
                .child(
                    agent_button(
                        "question-skip",
                        t("agent.question.skip").into(),
                        ButtonTone::Quiet,
                        resolving,
                        &a,
                    )
                    .on_click(cx.listener(move |s, _, _, cx| {
                        let _ = &skip_request;
                        drop(s.controller.resolve_question(json!({ "rejected": true })));
                        cx.notify();
                    })),
                )
                .child(
                    agent_button(
                        "question-continue",
                        t("agent.question.continue").into(),
                        ButtonTone::Primary,
                        resolving || !complete,
                        &a,
                    )
                    .on_click(cx.listener(move |s, _, _, cx| {
                        let answers = s
                            .question_answers
                            .get(&answer_request)
                            .cloned()
                            .unwrap_or_default();
                        let values: Vec<Vec<String>> = (0..count)
                            .map(|index| answers.get(&index).cloned().unwrap_or_default())
                            .collect();
                        drop(s.controller.resolve_question(json!({ "answers": values })));
                        cx.notify();
                    })),
                ),
        )
        .into_any_element()
    }
}
