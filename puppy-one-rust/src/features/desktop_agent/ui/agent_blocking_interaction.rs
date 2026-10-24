//! Port of `AgentApprovalDock` / `AgentQuestionDock` and MCP forms: blocking
//! requests docked above the composer, outside the transcript scroller.
use super::*;
use crate::{
    localization::{t as tr, tf},
    theme,
    ui::{Tone, action_button, icon_sized},
};
impl AgentChat {
    pub(super) fn render_interaction(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<Stateful<Div>> {
        let t = Theme::new(self.dark);
        // Pending interaction cards are outside the transcript scroller and cannot be lost in output.
        if let Some(interaction) = self.session.snapshot().interactions.first().cloned() {
            let id = interaction.id.clone();
            let attention = theme::mix(t.warning, t.divider, 0.48);
            let heading = |label: SharedString| {
                row()
                    .gap(px(8.))
                    .child(
                        div()
                            .size(px(22.))
                            .rounded(px(6.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(theme::alpha(t.warning, 0.10))
                            .child(icon_sized(
                                "shield-alert",
                                13.,
                                theme::mix(t.warning, t.sidebar_text, 0.62),
                            )),
                    )
                    .child(
                        div()
                            .text_size(px(theme::ty().left.content))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(label),
                    )
            };
            let mut card = column()
                .id("agent-interaction-dock")
                .max_h(px(320.))
                .overflow_y_scroll()
                .flex_shrink_0()
                .mx(px(12.))
                .mt(px(8.))
                .p(px(12.))
                .gap(px(8.))
                .rounded(px(8.))
                .border_1()
                .border_color(attention)
                .bg(theme::mix(t.panel_raised, t.agent(), 0.52))
                .text_size(px(theme::ty().left.content))
                .text_color(t.sidebar_text);
            if let InteractionKind::Form {
                prompt,
                fields,
                url,
            } = &interaction.kind
            {
                card = card
                    .child(heading(tr("agent.question.inputNeeded").into()))
                    .child(prompt.clone());
                if let Some(url) = url
                    .as_ref()
                    .filter(|u| u.starts_with("https://") || u.starts_with("http://localhost"))
                {
                    let target = url.clone();
                    card = card.child(
                        row().child(
                            action_button(
                                "open-mcp-url",
                                url.clone(),
                                Some("external-link"),
                                Tone::Default,
                                false,
                                t,
                            )
                            .on_click(move |_, _, cx| cx.open_url(&target)),
                        ),
                    );
                }
                let mut keys = Vec::new();
                for field in fields {
                    let key = format!("{id}:form:{}", field.id);
                    keys.push((field.id.clone(), key.clone()));
                    let input = self
                        .answers
                        .entry(key)
                        .or_insert_with(|| {
                            cx.new(|cx| {
                                TextInput::new(
                                    format!(
                                        "{}{}",
                                        field.kind,
                                        if field.options.is_empty() {
                                            String::new()
                                        } else {
                                            format!(" · {}", field.options.join(", "))
                                        }
                                    ),
                                    false,
                                    8000,
                                    window,
                                    cx,
                                )
                            })
                        })
                        .clone();
                    input.update(cx, |i, _| i.dark = self.dark);
                    card = card
                        .child(div().child(format!(
                            "{}{}",
                            field.label,
                            if field.required { " *" } else { "" }
                        )))
                        .child(input);
                }
                let mut actions = row().gap(px(6.));
                for (index, decision) in [Decision::Accept, Decision::Decline, Decision::Cancel]
                    .into_iter()
                    .enumerate()
                {
                    let id = id.clone();
                    let keys = keys.clone();
                    actions = actions.child(
                        action_button(
                            ("form-action", index),
                            tr(match decision {
                                Decision::Accept => "agent.question.continue",
                                Decision::Decline => "agent.approval.deny",
                                Decision::Cancel => "common.action.cancel",
                            }),
                            None,
                            if decision == Decision::Accept {
                                Tone::Primary
                            } else {
                                Tone::Default
                            },
                            false,
                            t,
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
                card = card.child(actions);
            }
            if let InteractionKind::Questions(questions) = &interaction.kind {
                card = card.child(heading(tr("agent.question.inputNeeded").into()));
                let mut keys = Vec::new();
                for (i, q) in questions.iter().enumerate() {
                    let qid = q.id.clone();
                    let key = format!("{id}:{qid}");
                    keys.push((qid, key.clone()));
                    let input = self
                        .answers
                        .entry(key.clone())
                        .or_insert_with(|| {
                            cx.new(|cx| {
                                TextInput::new(
                                    tr("agent.question.typeAnswer"),
                                    false,
                                    8000,
                                    window,
                                    cx,
                                )
                            })
                        })
                        .clone();
                    input.update(cx, |i, _| i.dark = self.dark);
                    card = card.child(
                        div()
                            .text_size(px(theme::ty().left.meta))
                            .text_color(t.subtle)
                            .child(tf("agent.question.number", &[("number", (i + 1).into())])),
                    );
                    card = card.child(div().text_color(t.text).child(q.text.clone()));
                    let mut option_row = row().flex_wrap().gap(px(6.));
                    {
                        let options = &q.options;
                        for (j, option) in options.iter().enumerate() {
                            let label = option.clone();
                            let value = label.clone();
                            let input = input.clone();
                            option_row = option_row.child(
                                action_button(
                                    ("answer-option", i * 100 + j),
                                    label,
                                    None,
                                    Tone::Default,
                                    false,
                                    t,
                                )
                                .on_click(move |_, _, cx| {
                                    input.update(cx, |input, cx| {
                                        input.restore(
                                            crate::ui::input::InputSnapshot {
                                                text: value.clone(),
                                                marks: vec![],
                                                anchor: value.len(),
                                                cursor: value.len(),
                                            },
                                            cx,
                                        )
                                    });
                                }),
                            );
                        }
                    }
                    card = card.child(option_row).child(input);
                }
                card = card.child(
                    row().child(
                        action_button(
                            "submit-answers",
                            tr("agent.question.continue"),
                            None,
                            Tone::Primary,
                            false,
                            t,
                        )
                        .on_click(cx.listener(move |s, _, _, cx| {
                            let mut answers = std::collections::BTreeMap::new();
                            for (qid, key) in &keys {
                                if let Some(input) = s.answers.get(key) {
                                    answers.insert(
                                        qid.clone(),
                                        vec![input.read(cx).text().to_owned()],
                                    );
                                }
                            }
                            s.session.resolve(&id, Resolution::Answers(answers));
                            cx.notify();
                        })),
                    ),
                );
            } else if let InteractionKind::Permission { prompt, options } = &interaction.kind {
                card = card
                    .child(heading(tr("agent.approval.required").into()))
                    .child(prompt.clone());
                let mut controls = row().flex_wrap().gap(px(6.));
                for (i, (option, label)) in options.iter().enumerate() {
                    let id = id.clone();
                    let option = option.clone();
                    controls = controls.child(
                        action_button(
                            ("permission-option", i),
                            label.clone(),
                            None,
                            if i == 0 { Tone::Primary } else { Tone::Default },
                            false,
                            t,
                        )
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.session.resolve(&id, Resolution::Choice(option.clone()));
                            cx.notify();
                        })),
                    );
                }
                card = card.child(controls);
            } else if let InteractionKind::Approval {
                command,
                prompt,
                decisions,
            } = &interaction.kind
            {
                let label = self.installation.label.clone();
                card = card
                    .child(heading(tr("agent.approval.waiting").into()))
                    .child(
                        div()
                            .text_size(px(theme::ty().left.meta))
                            .text_color(t.subtle)
                            .child(if *command {
                                tr("agent.activity.command").to_owned()
                            } else {
                                tr("agent.activity.file-changes").to_owned()
                            }),
                    )
                    .child(
                        div()
                            .p(px(8.))
                            .rounded(px(6.))
                            .bg(theme::alpha(t.control, 0.88))
                            .font_family("Menlo")
                            .text_size(px(theme::ty().right.code))
                            .text_color(t.text)
                            .child(prompt.clone()),
                    );
                let _ = tf("agent.approval.ariaLabel", &[("agent", label.into())]);
                let mut controls = row().gap(px(8.));
                for (i, decision) in decisions.iter().copied().enumerate() {
                    let id = id.clone();
                    let label = tr(decision_label(decision));
                    controls = controls.child(
                        action_button(
                            ("approval", i),
                            label,
                            None,
                            if decision == Decision::Accept {
                                Tone::Primary
                            } else {
                                Tone::Default
                            },
                            false,
                            t,
                        )
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.session.resolve(&id, Resolution::Approval(decision));
                            cx.notify();
                        })),
                    );
                }
                card = card.child(controls);
            }
            return Some(card);
        }

        None
    }
}
