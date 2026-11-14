//! `AgentQuestionDock`: the runtime's questions, their options and free
//! answers, Skip and Continue.
use super::super::agent_theme::AgentTheme;
use super::super::panel::elements::{ButtonTone, agent_button};
use super::{DockEvent, DocksView};
use crate::agent::contract::dto::Question;
use crate::features::desktop_agent::application::agent_session_controller::QuestionResolution;
use crate::localization::{Arg, t, tf};
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use crate::ui::form_input::TextInput;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;

impl DocksView {
    /// `AgentQuestionDock`.
    pub(super) fn render_question_dock(
        &mut self,
        request: &Question,
        queue_length: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t_ = cx.palette();
        let a = AgentTheme::new(&t_);
        let m = theme::ty();
        let resolving = self.data.question_resolving;
        let request_id = request.request_id.clone();
        let questions = request.questions.clone();
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
            let header = Some(question.header.clone())
                .filter(|h| !h.is_empty())
                .unwrap_or_else(|| {
                    tf(
                        "agent.question.number",
                        &[("number", Arg::Number(index as i64 + 1))],
                    )
                });
            let options = question.options.clone();
            let multiple = question.multiple;
            let custom = question.custom;
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
                        .child(question.question.clone()),
                );
            for option in &options {
                let label = option.label.clone();
                let checked = selected.contains(&label);
                let description = Some(option.description.clone()).filter(|d| !d.is_empty());
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
                            options.iter().map(|o| o.label.clone()).collect::<Vec<_>>(),
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
                    .on_click(cx.listener(move |_, _, _, cx| {
                        let _ = &skip_request;
                        cx.emit(DockEvent::Answer(QuestionResolution {
                            rejected: Some(true),
                            ..QuestionResolution::default()
                        }));
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
                        cx.emit(DockEvent::Answer(QuestionResolution {
                            answers: Some(values),
                            ..QuestionResolution::default()
                        }));
                    })),
                ),
        )
        .child(crate::ui::scrollbar::vertical(
            "agent-interaction-dock-scrollbar",
            &self.scroll,
        ))
        .into_any_element()
    }
}
