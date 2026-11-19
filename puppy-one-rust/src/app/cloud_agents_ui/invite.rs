//! `AgentInviteFlow`: adding an Agent, in two steps that are both on the
//! page from the start, so copying is never mistaken for the end. Step 1
//! is the message and what to do with it, in one card beside its picture;
//! once copied, the step stays open on the one thing left to do and waits
//! for the Agent, with the time the message has left. Only the Agent's
//! arrival ticks it. Step 2 is where the Agent asks to join, answered where
//! it asks; letting it in ends the invite on the Agent itself.
use super::*;
use crate::features::cloud::{CopyStatus, InvitePhase};
use crate::workspace::cloud::agents::AgentRequest;

/// The steps' numbers, and the thread between them.
const NODE: f32 = 22.;
const NODE_GAP: f32 = 12.;
/// `line-height: 1.5` at the dialog's 13px.
const LINE: f32 = 19.5;

/// A step's number: the one at hand, one still to come, or done.
#[derive(Clone, Copy, PartialEq)]
enum Mark {
    Now,
    Later,
    Done,
}

/// A command in the invite: 30px, 8px corners, the dialog's 13px at 500.
fn action(id: &str, label: impl Into<SharedString>, variant: ButtonVariant) -> Button {
    let ghost = variant == ButtonVariant::Ghost;
    Button::new(SharedString::from(id.to_owned()))
        .variant(variant)
        .label(label)
        .h(px(30.))
        .px(px(if ghost { 10. } else { 12. }))
        .gap(px(6.))
        .rounded(px(8.))
        .text_size(px(theme::ty().ui.meta))
        .font_weight(FontWeight::MEDIUM)
}
fn copy_icon() -> Icon {
    Icon::new("copy").with_size(px(14.)).stroke(2.)
}

/// An Agent as itself on a round ground: its brand, else its creature.
pub(super) fn face(name: &str, avatar: Option<&str>, size: f32, t: Theme) -> Div {
    let ground = theme::mix(t.text, t.overlay, 0.06);
    div()
        .size(px(size))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded_full()
        .overflow_hidden()
        .bg(ground)
        .child(match agent_brand(name, avatar) {
            Some(brand) => agent_brands::image(brand, t.dark, size * 0.6).into_any_element(),
            None => img(agent_creature::image(name, true, ground))
                .size(px(size))
                .into_any_element(),
        })
}

impl WindowCloud {
    /// The invite: the steps, or the Agent it brought in.
    pub(super) fn invite_flow(&self, cx: &mut Context<Self>) -> AnyElement {
        let agents = self.agents.read(cx);
        if matches!(
            agents.invite_phase(),
            InvitePhase::Joined | InvitePhase::Connecting
        ) {
            return self.invite_joined(cx);
        }
        let t = cx.palette();
        let phase = agents.invite_phase();
        let knocking = phase == InvitePhase::Knocking;
        let asking = agents.requests.clone();
        let one = if knocking {
            let name = asking.first().map(|r| r.name.clone()).unwrap_or_default();
            self.step(
                1,
                Mark::Done,
                tf("native.agentInvite.got", &[("name", name.into())]),
                None,
                true,
                t,
            )
        } else {
            self.step(
                1,
                Mark::Now,
                tr("native.agentInvite.send").into(),
                Some(self.invite_give(phase, cx).into_any_element()),
                true,
                t,
            )
        };
        let two = self.step(
            2,
            if knocking { Mark::Now } else { Mark::Later },
            tr("native.agentInvite.letIn").into(),
            Some(if knocking {
                v_flex()
                    .children(asking.iter().map(|r| self.invite_ask(r, cx)))
                    .into_any_element()
            } else {
                div()
                    .text_color(t.subtle)
                    .line_height(px(LINE))
                    .child(tr("native.agentInvite.letInHint"))
                    .into_any_element()
            }),
            false,
            t,
        );
        v_flex()
            .id("cloud-agent-invite")
            .debug_selector(|| "cloud-agent-invite".into())
            .min_w_0()
            .text_size(px(theme::ty().ui.meta))
            .line_height(px(LINE))
            .child(one)
            .child(div().mt(px(4.)).child(two))
            .into_any_element()
    }
    /// One step: its number, its title and, while it is at hand, its body.
    /// The first carries the thread down to the second.
    fn step(
        &self,
        n: usize,
        mark: Mark,
        title: String,
        body: Option<AnyElement>,
        thread: bool,
        t: Theme,
    ) -> Div {
        let node = div()
            .relative()
            .size(px(NODE))
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded_full()
            .font_weight(FontWeight::SEMIBOLD)
            .line_height(px(NODE))
            .map(|d| match mark {
                Mark::Now => d.bg(t.text).text_color(t.text_inverse).child(n.to_string()),
                Mark::Later => d
                    .bg(t.overlay)
                    .border_1()
                    .border_color(t.border_strong)
                    .text_color(t.subtle)
                    .child(n.to_string()),
                Mark::Done => d
                    .bg(theme::alpha(t.success, 0.14))
                    .text_color(t.success)
                    .child(Icon::new("check").with_size(px(12.)).stroke(3.)),
            });
        div()
            .relative()
            .debug_selector(move || format!("cloud-agent-invite-step:{n}"))
            .when(thread, |d| {
                d.child(
                    div()
                        .absolute()
                        .left(px(NODE / 2. - 0.5))
                        .top(px(NODE + 4.))
                        .bottom(px(-2.))
                        .w(px(1.))
                        .bg(t.border_strong),
                )
            })
            .child(
                h_flex().items_start().gap(px(NODE_GAP)).child(node).child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .when(thread, |d| d.pb(px(14.)))
                        .child(
                            div()
                                .line_height(px(NODE))
                                .map(|d| match mark {
                                    Mark::Now => {
                                        d.font_weight(FontWeight::MEDIUM).text_color(t.text)
                                    }
                                    Mark::Later => {
                                        d.font_weight(FontWeight::MEDIUM).text_color(t.muted)
                                    }
                                    Mark::Done => d.text_color(t.muted),
                                })
                                .child(title),
                        )
                        .children(body),
                ),
            )
    }
    /// Step 1 at hand: what to send and what to do with it; once it is out,
    /// the one thing left and the wait; lapsed, a new one.
    fn invite_give(&self, phase: InvitePhase, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let agents = self.agents.read(cx);
        let alert = |key: &'static str| div().mt(px(8.)).text_color(t.danger).child(tr(key));
        let copy_failed = agents.copy == CopyStatus::Failed;
        let not_owner = agents.copy == CopyStatus::NotOwner;
        let entity = self.agents.clone();
        if phase == InvitePhase::Lapsed {
            return v_flex().child(
                h_flex()
                    .id("cloud-agent-invite-lapsed")
                    .mt(px(12.))
                    .gap(px(10.))
                    .justify_between()
                    .items_center()
                    .px(px(12.))
                    .py(px(10.))
                    .rounded(px(10.))
                    .bg(t.control)
                    .border_1()
                    .border_color(t.border)
                    .text_color(t.muted)
                    .child(div().min_w_0().child(tr("native.agentInvite.lapsed")))
                    .child(
                        action(
                            "cloud-agent-invite-renew",
                            tr("native.agentInvite.renew"),
                            ButtonVariant::FilledPrimary,
                        )
                        .disabled(agents.copy == CopyStatus::Copying)
                        .on_click(move |_, _, cx| entity.update(cx, |a, cx| a.copy_invite(cx))),
                    ),
            );
        }
        let waiting = phase == InvitePhase::Waiting;
        let (lead, link) = agents.prompt_parts().unwrap_or_default();
        let message = div()
            .id("cloud-agent-invite-prompt")
            .debug_selector(|| "cloud-agent-invite-prompt".into())
            .text_color(t.muted)
            .when(waiting, |d| d.opacity(0.55))
            .child(StyledText::new(format!("{lead}{link}")).with_highlights([(
                lead.len()..lead.len() + link.len(),
                HighlightStyle {
                    color: Some(t.accent_text.into()),
                    ..Default::default()
                },
            )]));
        let copy = {
            let entity = entity.clone();
            move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                entity.update(cx, |a, cx| a.copy_invite(cx))
            }
        };
        let button = if waiting {
            let fresh = agents.fresh_copy;
            action(
                "cloud-agent-share-copy",
                tr(if fresh {
                    "cloud.share.action.copied"
                } else {
                    "native.agentInvite.copyAgain"
                }),
                ButtonVariant::Ghost,
            )
            .leading(copy_icon())
            .when(fresh, |b| {
                b.bg(theme::alpha(t.success, 0.14))
                    .text_color(t.success)
                    .px(px(12.))
            })
            .disabled(agents.copy == CopyStatus::Copying)
            .on_click(copy)
        } else {
            action(
                "cloud-agent-share-copy",
                tr(if agents.copy == CopyStatus::Copying {
                    "cloud.common.copying"
                } else {
                    "native.agentInvite.copy"
                }),
                ButtonVariant::FilledPrimary,
            )
            .leading(copy_icon())
            .disabled(agents.copy == CopyStatus::Copying)
            .on_click(copy)
        };
        // The message and its picture, one card: the picture's height is
        // the card's.
        let card = h_flex()
            .id("cloud-agent-invite-card")
            .debug_selector(|| "cloud-agent-invite-card".into())
            .mt(px(10.))
            .items_stretch()
            .rounded(px(10.))
            .overflow_hidden()
            .bg(theme::alpha(t.inset, 0.3))
            .border_1()
            .border_color(t.border)
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .justify_between()
                    .gap(px(12.))
                    .px(px(14.))
                    .py(px(12.))
                    .child(message)
                    .child(h_flex().child(button)),
            )
            .child(
                div()
                    .w(px(paste_art::WIDTH))
                    .min_h(px(124.))
                    .flex_none()
                    .flex()
                    .items_center()
                    .border_l_1()
                    .border_color(t.border)
                    .bg(theme::alpha(t.accent, 0.05))
                    .child(paste_art::drawing(t)),
            );
        let paste_key = tr(if cfg!(target_os = "macos") {
            "cloud.share.agent.invite.scene.pasteMac"
        } else {
            "cloud.share.agent.invite.scene.pasteOther"
        });
        let remaining = agents.remaining_secs();
        let next = waiting.then(|| {
            v_flex()
                .id("cloud-agent-invite-next")
                .debug_selector(|| "cloud-agent-invite-next".into())
                .mt(px(12.))
                .px(px(12.))
                .py(px(10.))
                .rounded(px(10.))
                .bg(theme::alpha(t.accent, 0.08))
                .border_1()
                .border_color(theme::alpha(t.accent, 0.22))
                .child(
                    h_flex()
                        .gap(px(8.))
                        .items_center()
                        .text_color(t.text)
                        .child(
                            Icon::new("arrow-right")
                                .with_size(px(14.))
                                .stroke(2.)
                                .color(t.accent_text),
                        )
                        .child(div().min_w_0().child(tr("native.agentInvite.paste")))
                        .child(
                            div()
                                .flex_none()
                                .h(px(20.))
                                .px(px(6.))
                                .flex()
                                .items_center()
                                .rounded(px(5.))
                                .bg(theme::alpha(t.text, 0.08))
                                .line_height(px(20.))
                                .child(paste_key),
                        ),
                )
                .child(
                    h_flex()
                        .mt(px(6.))
                        .gap(px(8.))
                        .items_center()
                        .text_color(t.muted)
                        .child(
                            Icon::new("loader-circle")
                                .with_size(px(14.))
                                .stroke(2.)
                                .color(t.accent_text)
                                .spinning("cloud-agent-invite-waiting"),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .child(tr("native.agentInvite.waiting")),
                        )
                        .child(div().flex_none().text_color(t.subtle).child(format!(
                            "{}:{:02}",
                            remaining / 60,
                            remaining % 60
                        ))),
                )
        });
        v_flex()
            .when(!waiting, |d| {
                d.child(
                    div()
                        .text_color(t.subtle)
                        .child(tr("native.agentInvite.sendHint")),
                )
            })
            .child(card)
            .children(next)
            .when(copy_failed, |d| d.child(alert("cloud.share.agent.failed")))
            .when(not_owner, |d| d.child(alert("cloud.share.agent.notOwner")))
            .when_some(
                agents.turned_away.clone().filter(|_| !waiting),
                |d, name| {
                    d.child(div().mt(px(8.)).text_color(t.subtle).child(tf(
                        "native.agentInvite.turnedAway",
                        &[("name", name.into())],
                    )))
                },
            )
    }
    /// An Agent asking to join, answered in the step that asked for it.
    fn invite_ask(&self, request: &AgentRequest, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let agents = self.agents.read(cx);
        let deciding = agents.deciding.contains(&request.id);
        let answer = |allow: bool| {
            let entity = self.agents.clone();
            let id = request.id.clone();
            move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                entity.update(cx, |a, cx| a.decide(&id, allow, cx));
            }
        };
        v_flex()
            .id(SharedString::from(format!(
                "cloud-agent-invite-ask:{}",
                request.id
            )))
            .debug_selector({
                let id = request.id.clone();
                move || format!("cloud-agent-invite-ask:{id}")
            })
            .mt(px(10.))
            .p(px(12.))
            .rounded(px(10.))
            .bg(theme::alpha(t.accent, 0.08))
            .border_1()
            .border_color(theme::alpha(t.accent, 0.30))
            .child(
                h_flex()
                    .gap(px(10.))
                    .items_center()
                    .child(face(&request.name, request.avatar.as_deref(), 32., t))
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.text)
                                    .child(tf(
                                        "native.agentInvite.wants",
                                        &[("name", request.name.clone().into())],
                                    )),
                            )
                            .child(
                                div()
                                    .text_color(t.muted)
                                    .child(tr("native.agentInvite.access")),
                            ),
                    ),
            )
            .when(agents.decision_failed, |d| {
                d.child(
                    div()
                        .mt(px(8.))
                        .text_color(t.danger)
                        .child(tr("cloud.share.agent.changeFailed")),
                )
            })
            .child(
                h_flex()
                    .mt(px(12.))
                    .justify_end()
                    .gap(px(8.))
                    .child(
                        action(
                            &format!("cloud-agent-request-deny:{}", request.id),
                            tr("cloud.share.agent.request.deny"),
                            ButtonVariant::Ghost,
                        )
                        .accessibility_label(format!(
                            "{} {}",
                            tr("cloud.share.agent.request.deny"),
                            request.name
                        ))
                        .disabled(deciding)
                        .on_click(answer(false)),
                    )
                    .child(
                        action(
                            &format!("cloud-agent-request-allow:{}", request.id),
                            tr("cloud.share.agent.request.allow"),
                            ButtonVariant::FilledPrimary,
                        )
                        .accessibility_label(format!(
                            "{} {}",
                            tr("cloud.share.agent.request.allow"),
                            request.name
                        ))
                        .disabled(deciding)
                        .on_click(answer(true)),
                    ),
            )
            .into_any_element()
    }
    /// The invite ends on the Agent it brought in: let in, it is in once it
    /// has reached the workspace, and until then it is waited for.
    fn invite_joined(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let agents = self.agents.read(cx);
        let Some(agent) = agents.joined() else {
            return div().into_any_element();
        };
        let name = agent.agent.name.clone();
        let avatar = agent.agent.avatar.clone();
        let joined = agents.invite_phase() == InvitePhase::Joined;
        let (title, hint) = match (joined, agents.connect_overdue()) {
            (true, _) => ("native.agentInvite.joined", "native.agentInvite.joinedHint"),
            (false, false) => (
                "native.agentInvite.connecting",
                "native.agentInvite.connectingHint",
            ),
            (false, true) => (
                "native.agentInvite.notConnected",
                "native.agentInvite.notConnectedHint",
            ),
        };
        let another = self.agents.clone();
        let host = self.weak.clone();
        v_flex()
            .id("cloud-agent-invite-joined")
            .debug_selector(move || {
                if joined {
                    "cloud-agent-invite-joined".into()
                } else {
                    "cloud-agent-invite-connecting".into()
                }
            })
            .items_center()
            .pt(px(18.))
            .px(px(8.))
            .pb(px(4.))
            .text_size(px(theme::ty().ui.meta))
            .line_height(px(LINE))
            .child(
                div()
                    .relative()
                    .mb(px(12.))
                    .child(face(&name, avatar.as_deref(), 52., t))
                    .when(joined, |face| {
                        face.child(
                            div()
                                .absolute()
                                .right(px(-2.))
                                .bottom(px(-2.))
                                .size(px(20.))
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded_full()
                                .bg(t.success)
                                .border(px(3.))
                                .border_color(t.overlay)
                                .text_color(t.text_inverse)
                                .child(Icon::new("check").with_size(px(11.)).stroke(3.4)),
                        )
                    }),
            )
            .child(
                div()
                    .text_size(px(theme::ty().ui.body_large))
                    .line_height(px(22.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.text)
                    .child(tf(title, &[("name", name.into())])),
            )
            .child(
                div()
                    .mt(px(4.))
                    .text_center()
                    .text_color(t.muted)
                    .child(tr(hint)),
            )
            .child(
                h_flex()
                    .mt(px(18.))
                    .gap(px(8.))
                    .justify_center()
                    .child(
                        action(
                            "cloud-agent-invite-another",
                            tr("native.agentInvite.another"),
                            ButtonVariant::Ghost,
                        )
                        .on_click(move |_, _, cx| another.update(cx, |a, cx| a.reset_invite(cx))),
                    )
                    .child(
                        action(
                            "cloud-agent-invite-done",
                            tr("cloud.share.action.done"),
                            ButtonVariant::FilledPrimary,
                        )
                        .on_click(move |_, window, cx| {
                            let _ = host.update(cx, |s, cx| s.close_agents_dialog(window, cx));
                        }),
                    ),
            )
            .into_any_element()
    }
}
