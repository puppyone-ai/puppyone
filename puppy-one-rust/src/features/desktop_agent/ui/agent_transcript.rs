//! Port of `AgentTranscript` + `AgentMessagePart` + activity renderers:
//! user prompts are quiet full-width rows, Agent answers stay in the document
//! flow, reasoning and plans are collapsible activities, and tool calls render
//! as compact rows with a provider-neutral glyph whose evidence expands inline.
use super::super::super::domain::agent_chat_presentation::ToolKind;
use super::*;
use crate::{
    localization::{t as tr, tf},
    theme,
    ui::icon_sized,
};
#[derive(Clone, Copy, PartialEq)]
enum Part {
    User,
    Assistant,
    Reasoning,
    Plan,
    Tool,
}
impl AgentChat {
    fn part(&self, role: &str) -> Part {
        let runtime = &self.session.snapshot().runtime;
        if role == "You" {
            Part::User
        } else if role == runtime || role == self.installation.label {
            Part::Assistant
        } else if role == "Reasoning" {
            Part::Reasoning
        } else if role == "Plan" {
            Part::Plan
        } else {
            Part::Tool
        }
    }
    pub(super) fn render_message(&mut self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let t = Theme::new(self.dark);
        let m = theme::ty();
        let messages = &self.session.snapshot().messages;
        let Some(message) = messages.get(index).cloned() else {
            return div().into_any_element();
        };
        let part = self.part(&message.role);
        let previous = index
            .checked_sub(1)
            .and_then(|i| messages.get(i))
            .map(|p| self.part(&p.role));
        // `--agent-message-turn-gap` between turns; work rows sit closer together.
        let top = match (previous, part) {
            (None, _) => 16.,
            (Some(Part::User), _) | (_, Part::User) => 24.,
            (
                Some(Part::Tool | Part::Reasoning | Part::Plan),
                Part::Tool | Part::Reasoning | Part::Plan,
            ) => 2.,
            _ => 8.,
        };
        let expanded = self.expanded.contains(&message.id);
        let id = message.id.clone();
        let toggle = cx.listener(move |s, _, _, cx| {
            if !s.expanded.remove(&id) {
                s.expanded.insert(id.clone());
            }
            s.transcript.splice(index..index + 1, 1);
            cx.notify();
        });
        let inset = theme::metric::SIDEBAR_ROW_LEFT_GAP;
        let body: AnyElement = match part {
            Part::User => {
                let status = match message.status.as_str() {
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
                    .border_color(theme::alpha(t.divider, 0.62))
                    .bg(t.hover)
                    .text_size(px(m.left.content))
                    .line_height(rems(1.6))
                    .text_color(t.text)
                    .child(div().whitespace_normal().child(message.text.clone()))
                    .children(status.map(|s| {
                        div()
                            .pt(px(4.))
                            .text_size(px(m.left.meta))
                            .text_color(t.subtle)
                            .child(s)
                    }))
                    .into_any_element()
            }
            Part::Assistant => {
                let copy = message.text.clone();
                let group = SharedString::from(format!("agent-message-{index}"));
                div()
                    .relative()
                    .group(group.clone())
                    .w_full()
                    .px(px(12.))
                    .text_size(px(m.left.content))
                    .line_height(rems(1.6))
                    .child(super::super::agent_markdown::render(
                        &message_preview(&message.text),
                        t,
                        index,
                        cx,
                    ))
                    .child(
                        crate::ui::icon_button(("copy-message", index), "copy", t)
                            .size(px(24.))
                            .absolute()
                            .top(px(-4.))
                            .right(px(4.))
                            .accessibility_label(tr("common.action.copy"))
                            .invisible()
                            .group_hover(group, |s| s.visible())
                            .on_click(move |_, _, cx| {
                                cx.write_to_clipboard(ClipboardItem::new_string(copy.clone()))
                            }),
                    )
                    .into_any_element()
            }
            Part::Reasoning | Part::Plan | Part::Tool => {
                let running = matches!(
                    message.status.as_str(),
                    "running" | "in_progress" | "inProgress" | "pending"
                );
                let failed = matches!(message.status.as_str(), "failed" | "error");
                let (glyph, title): (&str, String) = match part {
                    Part::Reasoning => (
                        "brain",
                        tr(if running {
                            "agent.activity.thinking"
                        } else {
                            "agent.activity.thoughtBriefly"
                        })
                        .into(),
                    ),
                    Part::Plan => ("list-todo", tr("agent.activity.plan-updated").into()),
                    _ => {
                        let first_line = message
                            .text
                            .lines()
                            .find(|l| !l.trim().is_empty())
                            .unwrap_or_default()
                            .chars()
                            .take(120)
                            .collect::<String>();
                        let title = if first_line.is_empty() {
                            message.role.clone()
                        } else {
                            format!("{} · {first_line}", message.role)
                        };
                        (ToolKind::of(&message.role).icon(), title)
                    }
                };
                let status_label = if failed {
                    Some((tr("agent.status.failed"), t.danger))
                } else if running {
                    Some((tr("agent.status.running"), t.subtle))
                } else {
                    None
                };
                let fg = if running {
                    theme::mix(t.text, t.sidebar_text, 0.78)
                } else {
                    t.sidebar_text
                };
                let summary = row()
                    .id(("activity", index))
                    .w_full()
                    .min_h(px(30.))
                    .px(px(8.))
                    .gap(px(8.))
                    .rounded(px(theme::metric::SIDEBAR_ROW_RADIUS))
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(theme::alpha(t.hover, 0.86)))
                    .text_size(px(m.left.content))
                    .text_color(fg)
                    .child(icon_sized(glyph, 15., fg))
                    .child(div().flex_1().min_w_0().truncate().child(title))
                    .children(status_label.map(|(label, color)| {
                        div()
                            .flex_shrink_0()
                            .text_size(px(m.left.meta))
                            .text_color(color)
                            .child(label)
                    }))
                    .child(icon_sized(
                        if expanded {
                            "chevron-down"
                        } else {
                            "chevron-right"
                        },
                        12.,
                        t.subtle,
                    ))
                    .on_click(toggle);
                let mut activity = column()
                    .w_full()
                    .mx(px(4.))
                    .rounded(px(14.))
                    .border_1()
                    .border_color(if expanded {
                        t.divider
                    } else {
                        theme::alpha(t.divider, 0.)
                    })
                    .when(expanded, |d| d.bg(theme::alpha(t.control, 0.58)))
                    .child(summary);
                if expanded {
                    let text = message_preview(&message.text);
                    let detail = if part == Part::Plan || part == Part::Reasoning {
                        super::super::agent_markdown::render(&text, t, index + 1_000_000, cx)
                            .into_any_element()
                    } else {
                        div()
                            .font_family("Menlo")
                            .text_size(px(m.right.code))
                            .line_height(rems(1.5))
                            .whitespace_normal()
                            .child(text)
                            .into_any_element()
                    };
                    activity = activity.child(
                        div()
                            .id(("activity-detail", index))
                            .max_h(px(230.))
                            .overflow_y_scroll()
                            .pt(px(6.))
                            .pr(px(14.))
                            .pb(px(14.))
                            .pl(px(34.))
                            .text_color(t.sidebar_text)
                            .child(detail),
                    );
                }
                activity.into_any_element()
            }
        };
        div()
            .w_full()
            .px(px(inset))
            .pt(px(top))
            .child(div().w_full().max_w(px(900.)).mx_auto().child(body))
            .into_any_element()
    }
    /// `AgentEmptyState`: monochrome runtime mark (click to spin) + prompt.
    pub(super) fn render_empty(&mut self, cx: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        let color = theme::mix(t.subtle, t.agent(), 0.64);
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
                    .text_color(color)
                    .with_animation(
                        ElementId::NamedInteger("agent-logo-spin".into(), turns as u64),
                        Animation::new(std::time::Duration::from_millis(600))
                            .with_easing(ease_in_out),
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
        column()
            .flex_1()
            .items_center()
            .justify_center()
            .gap(px(14.))
            .px(px(12.))
            .child(
                gpui_kit::base::Button::new("agent-empty-logo")
                    .accessibility_label(spin.clone())
                    .size(px(theme::control() + 4.))
                    .flex()
                    .items_center()
                    .justify_center()
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
                    .line_height(rems(1.4))
                    .text_color(t.subtle)
                    .child(tr("agent.empty.prompt")),
            )
    }
}
