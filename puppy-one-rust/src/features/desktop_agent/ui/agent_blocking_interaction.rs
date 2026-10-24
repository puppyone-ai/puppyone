//! Port of `AgentApprovalDock` and `AgentQuestionDock` (`styles/blocking.css`),
//! plus native MCP forms and ACP permission choices on the same card. Pending
//! interactions sit in the dock above the composer and cannot scroll away.
use super::agent_theme::AgentTheme;
use super::*;
use crate::{
    localization::{t as tr, tf},
    theme,
    ui::icon_stroke,
};

#[derive(Clone, Copy, PartialEq)]
enum ButtonTone {
    Quiet,
    Secondary,
    Primary,
}

impl AgentChat {
    /// `.desktop-agent-button` in the approval footer (10px inline padding).
    fn dock_button(
        &self,
        id: impl Into<ElementId>,
        label: SharedString,
        tone: ButtonTone,
        radius: f32,
        disabled: bool,
    ) -> gpui_kit::base::Button {
        let t = Theme::new(self.dark);
        let a = AgentTheme::new(&t);
        let (border, bg, fg, hover_bg, hover_border) = match tone {
            ButtonTone::Quiet => (
                theme::alpha(a.border_subtle, 0.),
                None,
                a.text_subtle,
                Some(a.row_hover),
                None,
            ),
            ButtonTone::Secondary => (
                a.border_subtle,
                None,
                a.text_muted,
                Some(a.row_hover),
                Some(a.border),
            ),
            ButtonTone::Primary => (
                a.text,
                Some(a.text),
                a.canvas,
                Some(a.primary_hover),
                Some(a.primary_hover),
            ),
        };
        gpui_kit::base::Button::new(id)
            .accessibility_label(label.clone())
            .h(px(theme::control()))
            .px(px(10.))
            .rounded(px(radius))
            .border_1()
            .border_color(border)
            .when_some(bg, |b, bg| b.bg(bg))
            .text_size(px(theme::ty().left.content))
            .line_height(relative(1.))
            .font_weight(if tone == ButtonTone::Primary {
                FontWeight::MEDIUM
            } else {
                FontWeight::NORMAL
            })
            .text_color(fg)
            .whitespace_nowrap()
            .when(disabled, |b| b.opacity(0.45))
            .when(!disabled, |b| {
                b.cursor(theme::clickable_cursor()).hover(move |s| {
                    let s = if let Some(bg) = hover_bg { s.bg(bg) } else { s };
                    let s = if let Some(border) = hover_border {
                        s.border_color(border)
                    } else {
                        s
                    };
                    if tone == ButtonTone::Primary {
                        s
                    } else {
                        s.text_color(a.text)
                    }
                })
            })
            .disabled(disabled)
            .child(label)
    }

    fn dock_input(
        &mut self,
        key: String,
        placeholder: SharedString,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<crate::ui::form_input::TextInput> {
        let input = self
            .answers
            .entry(key)
            .or_insert_with(|| {
                cx.new(|cx| {
                    crate::ui::form_input::TextInput::new(placeholder, false, 8000, window, cx)
                })
            })
            .clone();
        input.update(cx, |i, _| i.dark = self.dark);
        input
    }

    pub(super) fn render_interaction(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let interaction = self.session.snapshot().interactions.first().cloned()?;
        let queue = self.session.snapshot().interactions.len();
        let t = Theme::new(self.dark);
        let a = AgentTheme::new(&t);
        let m = theme::ty();
        let id = interaction.id.clone();
        let card = |padding: f32| {
            column()
                .id("agent-interaction-dock")
                .relative()
                .w_full()
                .max_w(px(900.))
                .mx_auto()
                .max_h(px(360.))
                .overflow_y_scroll()
                .flex_shrink_0()
                .p(px(padding))
                .rounded(px(8.))
                .border_1()
                .border_color(a.blocking_border)
                .bg(a.blocking_surface)
                .text_size(px(m.left.content))
                .text_color(a.text)
        };
        let element = match &interaction.kind {
            InteractionKind::Approval {
                title,
                command_line,
                cwd,
                reason,
                prompt,
                decisions,
                ..
            } => {
                let title = if title.trim().is_empty() {
                    prompt.lines().next().unwrap_or_default().trim().to_owned()
                } else {
                    title.trim().to_owned()
                };
                let title = if title.is_empty() {
                    tr("agent.approval.required").to_string()
                } else {
                    title
                };
                let reason = reason.as_ref().map(|r| r.trim().to_owned()).filter(|r| {
                    !r.is_empty()
                        && r.split_whitespace()
                            .collect::<Vec<_>>()
                            .join(" ")
                            .to_lowercase()
                            != title.to_lowercase()
                });
                let status: SharedString = if queue > 1 {
                    tf(
                        "agent.approval.pending",
                        &[("count", (queue as i64).into())],
                    )
                    .into()
                } else {
                    tr("agent.approval.waiting").into()
                };
                let show_details = command_line.is_some() || cwd.is_some() || reason.is_some();
                let mut details = column().gap(px(6.)).mt(px(8.)).pl(px(32.)).min_w_0();
                if let Some(command) = command_line {
                    details = details.child(
                        div()
                            .id("approval-command")
                            .max_h(px(76.))
                            .overflow_y_scroll()
                            .font_family(theme::MONO)
                            .text_size(px(m.right.code))
                            .line_height(px(m.right.code * 1.5))
                            .text_color(a.text_muted)
                            .whitespace_normal()
                            .child(command.clone()),
                    );
                }
                let meta = |text: String| {
                    div()
                        .text_size(px(m.left.meta))
                        .line_height(px(m.left.meta * 1.5))
                        .text_color(a.text_muted)
                        .whitespace_normal()
                        .child(text)
                };
                if let Some(cwd) = cwd {
                    details = details.child(meta(tf(
                        "agent.approval.inPath",
                        &[("path", cwd.clone().into())],
                    )));
                }
                if let Some(reason) = reason {
                    details = details.child(meta(reason));
                }
                let mut actions = row().justify_end().flex_wrap().gap(px(4.)).mt(px(10.));
                let ordered = [
                    (Decision::Decline, ButtonTone::Quiet),
                    (Decision::AcceptForSession, ButtonTone::Secondary),
                    (Decision::Accept, ButtonTone::Primary),
                ];
                for (decision, tone) in ordered {
                    let key = crate::features::desktop_agent::domain::agent_chat_presentation::decision_label(decision);
                    if decision != Decision::Decline && !decisions.contains(&decision) {
                        continue;
                    }
                    let id = id.clone();
                    actions = actions.child(
                        self.dock_button(
                            SharedString::from(format!("approval-{key}")),
                            tr(key).into(),
                            tone,
                            6.,
                            false,
                        )
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.session.resolve(&id, Resolution::Approval(decision));
                            cx.notify();
                        })),
                    );
                }
                let mut card = card(10.).child(
                    // `.desktop-agent-approval-heading`: 24px icon, title, status.
                    row()
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
                                .child(icon_stroke("shield-alert", 14., 1.7, a.blocking_icon)),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .text_size(px(m.left.content))
                                .line_height(px(m.left.line_height))
                                .font_weight(FontWeight::MEDIUM)
                                .whitespace_normal()
                                .child(title),
                        )
                        .child(
                            div()
                                .flex_shrink_0()
                                .text_size(px(m.left.meta))
                                .text_color(a.blocking_icon)
                                .whitespace_nowrap()
                                .child(status),
                        ),
                );
                if show_details {
                    card = card.child(details);
                }
                // `::before` attention ring: three soft pulses, then it rests.
                card.child(
                    div()
                        .absolute()
                        .inset_0()
                        .rounded(px(8.))
                        .border_1()
                        .border_color(a.blocking_attention_border)
                        .with_animation(
                            "approval-attention",
                            Animation::new(std::time::Duration::from_millis(7_800)),
                            |ring, delta| {
                                let phase = (delta * 3.).fract();
                                let wave = 0.5 - 0.5 * (phase * std::f32::consts::TAU).cos();
                                ring.opacity(if delta >= 1. {
                                    0.34
                                } else {
                                    0.34 + 0.44 * wave
                                })
                            },
                        ),
                )
                .child(actions)
                .into_any_element()
            }
            InteractionKind::Questions(questions) => {
                let mut card = card(12.).child(
                    row()
                        .gap(px(8.))
                        .text_size(px(m.left.content))
                        .text_color(a.text)
                        .child(icon_stroke("circle-help", 15., 2., a.text))
                        .child(
                            div()
                                .font_weight(FontWeight::BOLD)
                                .child(tr("agent.question.inputNeeded")),
                        )
                        .when(queue > 1, |d| {
                            d.child(div().ml_auto().text_color(t.muted).child(tf(
                                "agent.question.pending",
                                &[("count", (queue as i64).into())],
                            )))
                        }),
                );
                let mut complete = !questions.is_empty();
                for (index, question) in questions.iter().enumerate() {
                    let key = format!("{id}:{}", question.id);
                    let chosen = self.question_choices.get(&key).cloned().unwrap_or_default();
                    let other = (question.options.is_empty() || question.custom).then(|| {
                        let placeholder: SharedString = if question.options.is_empty() {
                            tr("agent.question.typeAnswer").into()
                        } else {
                            tr("agent.question.other").into()
                        };
                        self.dock_input(format!("{key}:other"), placeholder, window, cx)
                    });
                    let typed = other
                        .as_ref()
                        .map(|i| i.read(cx).text().trim().to_owned())
                        .unwrap_or_default();
                    complete &= !chosen.is_empty() || !typed.is_empty();
                    let legend: SharedString = if question.header.trim().is_empty() {
                        tf(
                            "agent.question.number",
                            &[("number", ((index + 1) as i64).into())],
                        )
                        .into()
                    } else {
                        question.header.clone().into()
                    };
                    // `fieldset`: the 19px legend sits in flow on the top border
                    // (drawn through its middle); content starts 10px below it.
                    let legend_height = m.right.meta_line_height;
                    let mut fieldset = column()
                        .relative()
                        .mt(px(10.))
                        .pt(px(legend_height + 10.))
                        .px(px(11.))
                        .pb(px(11.))
                        .child(
                            div()
                                .absolute()
                                .top(px((legend_height - 1.) / 2.))
                                .bottom_0()
                                .left_0()
                                .right_0()
                                .rounded(px(10.))
                                .border_1()
                                .border_color(a.border_subtle),
                        )
                        .child(
                            div()
                                .absolute()
                                .top_0()
                                .left(px(11.))
                                .h(px(legend_height))
                                .px(px(5.))
                                .bg(a.blocking_surface)
                                .text_size(px(m.left.meta))
                                .line_height(px(legend_height))
                                .text_color(a.text_muted)
                                .child(legend),
                        )
                        .child(
                            div()
                                .mb(px(8.))
                                .text_size(px(m.left.content))
                                .line_height(px(m.left.content * 1.5))
                                .whitespace_normal()
                                .child(question.text.clone()),
                        );
                    for (option_index, option) in question.options.iter().enumerate() {
                        let selected = chosen.contains(option);
                        let description = question
                            .descriptions
                            .get(option_index)
                            .filter(|d| !d.trim().is_empty())
                            .cloned();
                        let key = key.clone();
                        let value = option.clone();
                        let multiple = question.multiple;
                        fieldset = fieldset.child(
                            row()
                                .id(SharedString::from(format!("{key}:option:{option_index}")))
                                .items_start()
                                .gap(px(8.))
                                // `label { margin: 7px 0 }` collapsed with the 8px question
                                // margin and between siblings: 7px after each option.
                                .mb(px(7.))
                                .cursor(theme::clickable_cursor())
                                // Native radio: 13px with `margin: 3px 3px 0 5px`.
                                .child(
                                    div()
                                        .pl(px(5.))
                                        .pr(px(3.))
                                        .pt(px(3.))
                                        .child(choice_mark(selected, multiple, &t)),
                                )
                                .child(
                                    column()
                                        .min_w_0()
                                        .child(
                                            div()
                                                .font_weight(FontWeight::BOLD)
                                                .line_height(px(m.left.line_height))
                                                .child(option.clone()),
                                        )
                                        .children(description.map(|d| {
                                            div()
                                                .text_size(px(m.left.meta))
                                                .text_color(t.muted)
                                                .child(d)
                                        })),
                                )
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    let entry = s.question_choices.entry(key.clone()).or_default();
                                    if multiple {
                                        if let Some(at) = entry.iter().position(|v| v == &value) {
                                            entry.remove(at);
                                        } else {
                                            entry.push(value.clone());
                                        }
                                    } else {
                                        *entry = vec![value.clone()];
                                    }
                                    cx.notify();
                                })),
                        );
                    }
                    if let Some(input) = other {
                        // `.desktop-agent-question-input`: 36px field on the control surface.
                        input.update(cx, |i, _| {
                            i.appearance = false;
                            i.prompt_text = Some((m.left.content, m.left.line_height));
                            i.placeholder_color = Some(t.muted);
                        });
                        fieldset = fieldset.child(
                            div()
                                .h(px(theme::control() + 4.))
                                .px(px(6.))
                                .flex()
                                .items_center()
                                .rounded(px(10.))
                                .border_1()
                                .border_color(a.border)
                                .bg(a.control_surface)
                                .text_size(px(m.left.content))
                                .child(input),
                        );
                    }
                    card = card.child(fieldset);
                }
                let skip_id = id.clone();
                let skip_questions = questions.clone();
                let continue_id = id.clone();
                let continue_questions = questions.clone();
                let footer_button = |label: SharedString, primary: bool, disabled: bool| {
                    gpui_kit::base::Button::new(SharedString::from(format!("question-{label}")))
                        .accessibility_label(label.clone())
                        .min_h(px(theme::control()))
                        .px(px(12.))
                        .gap(px(5.))
                        .rounded(px(10.))
                        .border_1()
                        .border_color(if primary { a.text } else { a.border_subtle })
                        .bg(if primary { a.text } else { a.control_surface })
                        .text_color(if primary { a.canvas } else { a.text })
                        .text_size(px(m.left.content))
                        .when(!disabled, |b| b.cursor(theme::clickable_cursor()))
                        .disabled(disabled)
                        .child(label)
                };
                card.child(
                    row()
                        .justify_end()
                        .gap(px(6.))
                        .mt(px(9.))
                        .child(
                            footer_button(tr("agent.question.skip").into(), false, false).on_click(
                                cx.listener(move |s, _, _, cx| {
                                    let answers = skip_questions
                                        .iter()
                                        .map(|q| (q.id.clone(), vec![]))
                                        .collect();
                                    s.session.resolve(&skip_id, Resolution::Answers(answers));
                                    cx.notify();
                                }),
                            ),
                        )
                        .child(
                            footer_button(tr("agent.question.continue").into(), true, !complete)
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    let mut answers = std::collections::BTreeMap::new();
                                    for question in &continue_questions {
                                        let key = format!("{continue_id}:{}", question.id);
                                        let mut values = s
                                            .question_choices
                                            .get(&key)
                                            .cloned()
                                            .unwrap_or_default();
                                        if let Some(input) = s.answers.get(&format!("{key}:other"))
                                        {
                                            let typed = input.read(cx).text().trim().to_owned();
                                            if !typed.is_empty() {
                                                if question.multiple {
                                                    values.push(typed)
                                                } else {
                                                    values = vec![typed]
                                                }
                                            }
                                        }
                                        answers.insert(question.id.clone(), values);
                                    }
                                    s.session
                                        .resolve(&continue_id, Resolution::Answers(answers));
                                    cx.notify();
                                })),
                        ),
                )
                .into_any_element()
            }
            InteractionKind::Permission { prompt, options } => {
                let mut actions = row().justify_end().flex_wrap().gap(px(4.)).mt(px(10.));
                for (index, (option, label)) in options.iter().enumerate() {
                    let id = id.clone();
                    let option = option.clone();
                    let tone = if index == 0 {
                        ButtonTone::Primary
                    } else {
                        ButtonTone::Secondary
                    };
                    actions = actions.child(
                        self.dock_button(
                            ("permission-option", index),
                            label.clone().into(),
                            tone,
                            6.,
                            false,
                        )
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.session.resolve(&id, Resolution::Choice(option.clone()));
                            cx.notify();
                        })),
                    );
                }
                card(10.)
                    .child(approval_heading(
                        tr("agent.approval.required").into(),
                        tr("agent.approval.waiting").into(),
                        &a,
                    ))
                    .child(
                        div()
                            .mt(px(8.))
                            .pl(px(32.))
                            .text_size(px(m.left.meta))
                            .text_color(a.text_muted)
                            .whitespace_normal()
                            .child(prompt.clone()),
                    )
                    .child(actions)
                    .into_any_element()
            }
            InteractionKind::Form {
                prompt,
                fields,
                url,
            } => {
                let mut card = card(12.)
                    .gap(px(8.))
                    .child(approval_heading(
                        tr("agent.question.inputNeeded").into(),
                        SharedString::default(),
                        &a,
                    ))
                    .child(div().whitespace_normal().child(prompt.clone()));
                if let Some(url) = url
                    .as_ref()
                    .filter(|u| u.starts_with("https://") || u.starts_with("http://localhost"))
                {
                    let target = url.clone();
                    card = card.child(
                        row().child(
                            self.dock_button(
                                "open-mcp-url",
                                url.clone().into(),
                                ButtonTone::Secondary,
                                6.,
                                false,
                            )
                            .on_click(move |_, _, cx| cx.open_url(&target)),
                        ),
                    );
                }
                let mut keys = Vec::new();
                for field in fields {
                    let key = format!("{id}:form:{}", field.id);
                    keys.push((field.id.clone(), key.clone()));
                    let hint: SharedString = if field.options.is_empty() {
                        field.kind.clone().into()
                    } else {
                        format!("{} · {}", field.kind, field.options.join(", ")).into()
                    };
                    let input = self.dock_input(key, hint, window, cx);
                    card = card
                        .child(
                            div()
                                .text_size(px(m.left.meta))
                                .text_color(a.text_muted)
                                .child(format!(
                                    "{}{}",
                                    field.label,
                                    if field.required { " *" } else { "" }
                                )),
                        )
                        .child(input);
                }
                let mut actions = row().justify_end().gap(px(4.));
                for (decision, tone, key) in [
                    (Decision::Cancel, ButtonTone::Quiet, "common.action.cancel"),
                    (
                        Decision::Decline,
                        ButtonTone::Secondary,
                        "agent.approval.deny",
                    ),
                    (
                        Decision::Accept,
                        ButtonTone::Primary,
                        "agent.question.continue",
                    ),
                ] {
                    let id = id.clone();
                    let keys = keys.clone();
                    actions = actions.child(
                        self.dock_button(
                            SharedString::from(format!("form-{key}")),
                            tr(key).into(),
                            tone,
                            6.,
                            false,
                        )
                        .on_click(cx.listener(move |s, _, _, cx| {
                            let values = keys
                                .iter()
                                .filter_map(|(id, key)| {
                                    Some((
                                        id.clone(),
                                        s.answers.get(key)?.read(cx).text().to_owned(),
                                    ))
                                })
                                .collect();
                            s.session
                                .resolve(&id, Resolution::Form { decision, values });
                            cx.notify();
                        })),
                    );
                }
                card.child(actions).into_any_element()
            }
        };
        Some(element)
    }
}

fn approval_heading(title: SharedString, status: SharedString, a: &AgentTheme) -> Div {
    let m = theme::ty();
    row()
        .gap(px(8.))
        .child(
            div()
                .size(px(24.))
                .flex_shrink_0()
                .rounded(px(6.))
                .flex()
                .items_center()
                .justify_center()
                .bg(a.blocking_icon_surface)
                .child(icon_stroke("shield-alert", 14., 1.7, a.blocking_icon)),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .font_weight(FontWeight::MEDIUM)
                .line_height(px(m.left.line_height))
                .child(title),
        )
        .child(
            div()
                .text_size(px(m.left.meta))
                .text_color(a.blocking_icon)
                .child(status),
        )
}

/// Native radio / checkbox glyph of the question options.
fn choice_mark(selected: bool, multiple: bool, t: &Theme) -> Div {
    let base = div()
        .size(px(13.))
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_center()
        .border_1()
        .border_color(theme::alpha(t.text, 0.3))
        .bg(theme::alpha(t.text, 0.12));
    let base = if multiple {
        base.rounded(px(3.))
    } else {
        base.rounded_full()
    };
    if selected {
        base.bg(t.accent).border_color(t.accent).child(if multiple {
            icon_stroke("check", 10., 3., t.text_inverse).into_any_element()
        } else {
            div()
                .size(px(5.))
                .rounded_full()
                .bg(t.text_inverse)
                .into_any_element()
        })
    } else {
        base
    }
}
