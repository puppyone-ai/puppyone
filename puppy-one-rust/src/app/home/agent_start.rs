//! `AgentProjectStartDialog`: starts a project by handing its first brief to
//! one of the person's Local Agents. PuppyOne creates a blank folder (numbered
//! when its name is already taken in the chosen location), opens it, and hands
//! the prompt to a fresh chat tab on that Agent's runtime.
use super::{
    agent_strip::{HomepageLocalAgent, agent_brand_mark},
    create_project::{Destination, default_location, rand_suffix},
    *,
};
use crate::{
    platform::templates,
    ui::{
        components::Dialog,
        form_input::{InputEvent, TextInput},
    },
};

const NAME_LIMIT: usize = 32;
const PROMPT_MAX: usize = 2000;

/// `suggestProjectName(prompt, fallback)`: the prompt's first phrase without
/// characters a folder name may not contain, truncated to 32 characters, or
/// `fallback` when empty.
pub(in crate::app) fn suggest_project_name(prompt: &str, fallback: &str) -> String {
    let first = prompt
        .split([
            '\n', '。', '！', '？', '!', '?', '；', ';', '：', ':', '，', ',',
        ])
        .next()
        .unwrap_or("");
    let cleaned: String = first
        .chars()
        .map(|ch| {
            if matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
                || ch.is_control()
                || ch == '\u{7f}'
            {
                ' '
            } else {
                ch
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let sliced: String = cleaned.chars().take(NAME_LIMIT).collect();
    let trimmed = sliced.trim_end_matches(['.', ' ']).trim();
    if trimmed.is_empty() {
        fallback.to_owned()
    } else {
        trimmed.to_owned()
    }
}

pub(in crate::app) struct AgentStart {
    pub(in crate::app) agent: HomepageLocalAgent,
    pub(in crate::app) prompt: Entity<TextInput>,
    pub(in crate::app) destination: Destination,
    pub(in crate::app) fallback_name: String,
    pub(in crate::app) last_auto_name: String,
    pub(in crate::app) name_edited: bool,
    pub(in crate::app) submitting: bool,
    pub(in crate::app) error: Option<String>,
}

impl Homepage {
    /// Opens `AgentProjectStartDialog` for `agent`, focusing the prompt field.
    pub(in crate::app) fn begin_agent_start(
        &mut self,
        agent: HomepageLocalAgent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let suffix = format!("{:04X}", rand_suffix());
        let fallback_name = format!("{} {suffix}", tr("onboarding.entry.create.defaultName"));
        let placeholder = tr("onboarding.agentStart.promptPlaceholder");
        let prompt = cx.new(|cx| {
            let mut input = TextInput::new(placeholder, true, PROMPT_MAX, window, cx);
            input.appearance = false;
            input.min_height = 66.;
            input.prompt_text = Some((theme::ty().ui.body, 22.));
            input.placeholder_color = Some(|t| t.subtle);
            input
        });
        let name =
            self.project_name_input(fallback_name.clone(), window, cx, Self::submit_agent_start);
        cx.subscribe_in(
            &prompt,
            window,
            |s, prompt_entity, event, w, cx| match event {
                InputEvent::Changed => {
                    let text = prompt_entity.read(cx).text().to_owned();
                    let sync_target = s.agent_start.as_mut().and_then(|start| {
                        start.error = None;
                        (!start.name_edited).then(|| {
                            let suggested = suggest_project_name(&text, &start.fallback_name);
                            start.last_auto_name = suggested.clone();
                            (start.destination.name.clone(), suggested)
                        })
                    });
                    if let Some((name_input, suggested)) = sync_target {
                        name_input.update(cx, |input, cx| input.set_text(suggested, cx));
                    }
                    cx.notify();
                }
                InputEvent::Submit => s.submit_agent_start(w, cx),
            },
        )
        .detach();
        cx.subscribe_in(&name, window, |s, name_entity, event, _, cx| {
            if matches!(event, InputEvent::Changed) {
                let current = name_entity.read(cx).text().to_owned();
                if let Some(start) = s.agent_start.as_mut()
                    && current != start.last_auto_name
                {
                    start.name_edited = true;
                    start.error = None;
                    cx.notify();
                }
            }
        })
        .detach();
        prompt.read(cx).focus_handle(cx).focus(window, cx);
        self.agent_start = Some(AgentStart {
            agent,
            prompt,
            destination: Destination {
                name,
                location: default_location(),
                choosing: false,
            },
            last_auto_name: fallback_name.clone(),
            fallback_name,
            name_edited: false,
            submitting: false,
            error: None,
        });
        self.open_dialog(DialogKey::AgentStart, cx);
        cx.notify();
    }

    pub(in crate::app) fn close_agent_start(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.agent_start.as_ref().is_some_and(|s| s.submitting) {
            return;
        }
        self.agent_start = None;
        if self.close_dialog(DialogKey::AgentStart, cx) {
            self.window_focus.focus(window, cx);
            cx.notify();
        }
    }

    pub(in crate::app) fn submit_agent_start(
        &mut self,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(start) = self.agent_start.as_mut() else {
            return;
        };
        if start.submitting || start.destination.choosing {
            return;
        }
        let words = start.prompt.read(cx).text().trim().to_owned();
        let folder = start.destination.name.read(cx).text().trim().to_owned();
        let Some(location) = start.destination.location.clone() else {
            return;
        };
        if words.is_empty() || folder.is_empty() {
            return;
        }
        let runtime_id = start.agent.runtime_id.clone();
        let created = templates::require_project_name(&folder)
            .and_then(|valid| templates::free_name(&location, valid))
            .and_then(|free| templates::materialize(&location, &free, &templates::Plan::default()));
        match created {
            Ok(path) => {
                self.agent_start = None;
                self.close_dialog(DialogKey::AgentStart, cx);
                cx.emit(HomeEvent::OpenAgentCreated {
                    path,
                    runtime_id,
                    prompt: words,
                });
            }
            Err(error) => {
                if let Some(start) = self.agent_start.as_mut() {
                    start.error = Some(error);
                }
                cx.notify();
            }
        }
    }

    pub(in crate::app) fn agent_start_dialog(
        &self,
        start: &AgentStart,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let host = self.weak.clone();
        let agent_name = crate::localization::bidi_isolate(&start.agent.label);
        let title = tf(
            "onboarding.agents.start",
            &[("agent", agent_name.clone().into())],
        );
        let prompt_label = tf(
            "onboarding.agentStart.promptLabel",
            &[("agent", agent_name.clone().into())],
        );
        let note = tf(
            "onboarding.agentStart.note",
            &[("agent", agent_name.clone().into())],
        );
        let submit_label = if start.submitting {
            tr("onboarding.entry.create.submitting").to_owned()
        } else {
            tf(
                "onboarding.agentStart.submit",
                &[("agent", agent_name.into())],
            )
        };
        let busy = start.submitting || start.destination.choosing;
        let has_prompt = !start.prompt.read(cx).text().trim().is_empty();
        let has_name = !start.destination.name.read(cx).text().trim().is_empty();
        let can_submit = !busy && has_prompt && has_name && start.destination.location.is_some();
        let prompt_focused = start.prompt.read(cx).focus_handle(cx).is_focused(window);
        let narrow = f32::from(window.viewport_size().width) <= 480.;

        let heading = h_flex()
            .min_w_0()
            .items_center()
            .gap(px(10.))
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .size(px(28.))
                    .items_center()
                    .justify_center()
                    .rounded(px(7.))
                    .bg(theme::alpha(t.text, 0.07))
                    .child(agent_brand_mark(
                        Some(&start.agent.icon_key),
                        &start.agent.label,
                        20.,
                        6.,
                        t.text,
                        t,
                    )),
            )
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(ty.label))
                    .line_height(px(18.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.muted)
                    .child(title),
            );

        let prompt_focus = start.prompt.read(cx).focus_handle(cx);
        let ask_box = div()
            .id("agent-start-ask")
            .flex()
            .min_w_0()
            .items_start()
            .gap(px(11.))
            .p(px(12.))
            .rounded(px(12.))
            .border_1()
            .border_color(if prompt_focused {
                t.focus_ring
            } else {
                t.border_strong
            })
            .bg(t.panel_raised)
            .when(!busy, |d| {
                d.cursor(CursorStyle::IBeam)
                    .on_mouse_down(MouseButton::Left, move |_, w, cx| {
                        prompt_focus.focus(w, cx);
                    })
            })
            .child(div().mt(px(1.)).flex_none().child(agent_brand_mark(
                Some(&start.agent.icon_key),
                &start.agent.label,
                28.,
                8.,
                t.text,
                t,
            )))
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap(px(4.))
                    .child(
                        div()
                            .text_size(px(ty.caption))
                            .line_height(px(16.))
                            .text_color(t.muted)
                            .child(prompt_label),
                    )
                    .child(
                        div()
                            .w_full()
                            .min_h(px(66.))
                            .text_color(t.text)
                            .child(start.prompt.clone()),
                    ),
            );

        let fields = if narrow {
            v_flex()
                .gap(px(12.))
                .child(self.name_field(&start.destination, start.submitting, cx))
                .child(self.location_field(
                    &start.destination,
                    start.submitting,
                    "onboarding.entry.create.locationLabel",
                    cx,
                ))
        } else {
            // `grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 12px`.
            h_flex()
                .w_full()
                .min_w_0()
                .items_start()
                .gap(px(12.))
                .child(
                    div()
                        .flex_grow(1.)
                        .flex_shrink(1.)
                        .flex_basis(px(0.))
                        .min_w_0()
                        .child(self.name_field(&start.destination, start.submitting, cx)),
                )
                .child(
                    div()
                        .flex_grow(1.15)
                        .flex_shrink(1.)
                        .flex_basis(px(0.))
                        .min_w_0()
                        .child(self.location_field(
                            &start.destination,
                            start.submitting,
                            "onboarding.entry.create.locationLabel",
                            cx,
                        )),
                )
        };

        let submit_ink = if can_submit {
            t.text_inverse
        } else {
            t.text_disabled
        };
        let mut submit_btn = Button::new("agent-start-submit")
            .variant(ButtonVariant::Solid)
            .label(submit_label)
            .disabled(!can_submit)
            .on_click(cx.listener(|s, _, w, cx| s.submit_agent_start(w, cx)));
        if !start.submitting {
            submit_btn = submit_btn.leading(agent_brand_mark(
                Some(&start.agent.icon_key),
                &start.agent.label,
                16.,
                4.,
                submit_ink,
                t,
            ));
        }

        Dialog::new("agent-project-start")
            .width(500.)
            .inset(22.)
            .body_padding(6., 18.)
            .center_header()
            .heading(heading)
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.close_agent_start(w, cx));
            })
            .child(
                v_flex()
                    .gap(px(14.))
                    .child(ask_box)
                    .child(fields)
                    .child(
                        div()
                            .text_size(px(ty.caption))
                            .line_height(px(18.6))
                            .text_color(t.muted)
                            .child(note),
                    )
                    .children(start.error.clone().map(|error| {
                        div()
                            .text_size(px(ty.meta))
                            .line_height(px(18.))
                            .text_color(t.danger)
                            .child(error)
                    })),
            )
            .footer(
                Button::new("agent-start-cancel")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .disabled(busy)
                    .on_click(cx.listener(|s, _, w, cx| s.close_agent_start(w, cx))),
            )
            .footer(submit_btn)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn suggest_project_name_extracts_first_clean_clause_or_falls_back() {
        assert_eq!(
            suggest_project_name(
                "Build a Q4 revenue dashboard, then export CSV",
                "Project ABCD"
            ),
            "Build a Q4 revenue dashboard"
        );
        assert_eq!(
            suggest_project_name("整理上周会议纪要。生成行动项", "Project ABCD"),
            "整理上周会议纪要"
        );
        assert_eq!(
            suggest_project_name("a\\b/c*d\"e<f>g|h...", "Project ABCD"),
            "a b c d e f g h"
        );
        assert_eq!(
            suggest_project_name("Q4 Plan: milestones? yes", "Project ABCD"),
            "Q4 Plan"
        );
        assert_eq!(
            suggest_project_name("   \n  ", "Project ABCD"),
            "Project ABCD"
        );
        let long = "1234567890123456789012345678901234567890";
        assert_eq!(
            suggest_project_name(long, "Project ABCD").chars().count(),
            32
        );
    }
}
