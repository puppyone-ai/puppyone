//! The Agents card under the Header's marks: who is at work, who waits, and
//! the invitation to bring an Agent in.
use super::manage::row_action;
use super::*;

impl WindowCloud {
    /// `CloudWorkspaceAgentsPanel`.
    pub(in crate::app) fn agents_panel(&self, cx: &App) -> Stateful<Div> {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let agents = self.agents.read(cx);
        let entity = self.agents.clone();
        let control = agents.manageable;
        let listed = !agents.agents.is_empty() || !agents.requests.is_empty();
        let now = cloud_agents::now_ms() / 1000;
        let ground = t.header;
        let caption = |text: String| {
            div()
                .text_size(px(ty.caption))
                .line_height(px(16.))
                .text_color(t.muted)
                .child(text)
        };
        let name = |text: String| {
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .text_size(px(ty.control))
                .text_color(t.text)
                .child(text)
        };
        let mut card =
            share_panel::card("cloud-agents-panel", t, PANEL_WIDTH, PANEL_INSET, px(560.))
                .gap(px(PANEL_GAP));
        let anchor = self.agents_anchor.clone();
        let host = self.weak.clone();
        card = card.on_mouse_down_out(move |event, _, cx| {
            if !anchor.get().contains(&event.position) {
                let _ = host.update(cx, |s, cx| s.close_agents(cx));
            }
        });
        if control && !agents.requests.is_empty() {
            let rows = agents.requests.iter().map(|request| {
                let deciding = agents.deciding.contains(&request.id);
                let decide = |allow: bool| {
                    let entity = entity.clone();
                    let id = request.id.clone();
                    move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                        entity.update(cx, |a, cx| a.decide(&id, allow, cx));
                    }
                };
                let when = relative_time(&request.requested_at, now).unwrap_or_default();
                h_flex()
                    .min_h(px(44.))
                    .px(px(8.))
                    .gap(px(10.))
                    .items_center()
                    .min_w_0()
                    .child(agent_mark(
                        &request.name,
                        false,
                        true,
                        Seat::List(ground),
                        t,
                    ))
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .child(name(request.name.clone()).line_height(px(18.)))
                            .child(
                                caption(format!(
                                    "{} · {when}",
                                    tr("cloud.share.agent.request.status")
                                ))
                                .truncate(),
                            ),
                    )
                    .child(
                        h_flex()
                            .flex_none()
                            .gap(px(2.))
                            .child(
                                Button::new(SharedString::from(format!(
                                    "cloud-agent-request-deny:{}",
                                    request.id
                                )))
                                .variant(ButtonVariant::Ghost)
                                .label(tr("cloud.share.agent.request.deny"))
                                .accessibility_label(format!(
                                    "{} {}",
                                    tr("cloud.share.agent.request.deny"),
                                    request.name
                                ))
                                .disabled(deciding)
                                .h(px(theme::control_compact()))
                                .px(px(8.))
                                .text_size(px(ty.caption))
                                .on_click(decide(false)),
                            )
                            .child(
                                Button::new(SharedString::from(format!(
                                    "cloud-agent-request-allow:{}",
                                    request.id
                                )))
                                .variant(ButtonVariant::Solid)
                                .label(tr("cloud.share.agent.request.allow"))
                                .accessibility_label(format!(
                                    "{} {}",
                                    tr("cloud.share.agent.request.allow"),
                                    request.name
                                ))
                                .disabled(deciding)
                                .h(px(theme::control_compact()))
                                .px(px(11.))
                                .text_size(px(ty.caption))
                                .font_weight(FontWeight::MEDIUM)
                                .on_click(decide(true)),
                            ),
                    )
            });
            card = card.child(v_flex().gap(px(2.)).children(rows));
        }
        if agents.decision_failed {
            card = card.child(
                div()
                    .px(px(8.))
                    .text_size(px(ty.caption))
                    .line_height(px(16.))
                    .text_color(t.danger)
                    .child(tr("cloud.share.agent.changeFailed")),
            );
        }
        if !agents.agents.is_empty() {
            let rows = agents.agents.iter().map(|agent| {
                h_flex()
                    .debug_selector({
                        let id = agent.agent.id.clone();
                        move || format!("cloud-agent-row:{id}")
                    })
                    .min_h(px(theme::control_roomy()))
                    .px(px(8.))
                    .gap(px(10.))
                    .items_center()
                    .min_w_0()
                    .child(agent_mark(
                        &agent.agent.name,
                        agent.active,
                        false,
                        Seat::List(ground),
                        t,
                    ))
                    .child(name(agent.agent.name.clone()))
                    .children(
                        cloud_agents::status(agent, now).map(|state| caption(state).flex_none()),
                    )
            });
            let after_requests = control && !agents.requests.is_empty();
            card = card.child(
                v_flex()
                    .gap(px(2.))
                    .when(after_requests, |d| {
                        d.mx(px(-PANEL_INSET))
                            .px(px(PANEL_INSET))
                            .pt(px(6.))
                            .border_t_1()
                            .border_color(t.shell_divider)
                    })
                    .children(rows),
            );
        }
        if control || !agents.agents.is_empty() {
            let alone = !listed;
            let mut foot = v_flex().when(!alone, |d| {
                d.mx(px(-PANEL_INSET))
                    .px(px(PANEL_INSET))
                    .pt(px(6.))
                    .border_t_1()
                    .border_color(t.shell_divider)
            });
            if control {
                foot = foot.child(self.agents_invite(listed, cx));
            }
            if !agents.agents.is_empty() {
                let host = self.weak.clone();
                foot = foot.child(
                    row_action(
                        "cloud-agents-manage",
                        "settings",
                        tr("cloud.share.agent.manage").to_string(),
                        t,
                    )
                    .on_click(move |_, _, cx| {
                        let _ = host.update(cx, |s, cx| s.open_manage_agents(cx));
                    }),
                );
            }
            card = card.child(foot);
        }
        card
    }
    /// `CloudWorkspaceAgentInvite`: the start of the prompt, the button that
    /// copies it, and what to do with it. Once the card lists Agents, the
    /// form waits behind one row until it is asked for.
    pub(in crate::app) fn agents_invite(&self, compact: bool, cx: &App) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let agents = self.agents.read(cx);
        let entity = self.agents.clone();
        let waiting = agents.waiting();
        let note = |id: &'static str| {
            h_flex()
                .gap(px(6.))
                .items_center()
                .text_size(px(ty.caption))
                .line_height(px(16.))
                .text_color(t.muted)
                .child(
                    Icon::new("loader-circle")
                        .with_size(px(12.))
                        .stroke(2.2)
                        .spinning(id),
                )
                .child(tr("cloud.share.agent.invite.waiting"))
        };
        if compact && !agents.open_links && !agents.expanded {
            let expand = entity.clone();
            return v_flex()
                .child(
                    row_action(
                        "cloud-agent-invite-open",
                        "plus",
                        tr("cloud.share.agent.invite.another").to_string(),
                        t,
                    )
                    .on_click(move |_, _, cx| expand.update(cx, |a, cx| a.expand_invite(cx))),
                )
                .when(waiting, |d| {
                    d.child(
                        note("cloud-agent-invite-waiting")
                            .pl(px(40.))
                            .pr(px(8.))
                            .pb(px(6.)),
                    )
                })
                .into_any_element();
        }
        let api = crate::features::cloud::account::environment(cx)
            .map(|e| e.api().to_owned())
            .unwrap_or_default();
        let prompt = connect_message(
            agents.project_name().unwrap_or_default(),
            &crate::workspace::cloud::agents::link_preview(&api),
        );
        let copied = agents.copy == CopyStatus::Copied;
        // The prompt's plate as painted over the card.
        let plate = theme::mix(Rgba { a: 1., ..t.hover }, t.header, t.hover.a);
        let mut form = v_flex()
            .p(px(10.))
            .gap(px(10.))
            .min_w_0()
            .child(
                div()
                    .text_size(px(ty.meta))
                    .line_height(px(20.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.text)
                    .child(tr("cloud.share.agent.invite.title")),
            )
            .child(
                // Two lines of the prompt, the second fading where the
                // link would begin, since only copying makes it.
                div()
                    .relative()
                    .px(px(10.))
                    .py(px(8.))
                    .rounded(px(metric::CONTROL_RADIUS))
                    .bg(t.hover)
                    .text_color(t.muted)
                    .text_size(px(ty.caption))
                    .line_height(px(18.))
                    .child(div().line_clamp(2).child(prompt))
                    .child(
                        div()
                            .absolute()
                            .left(px(10.))
                            .right(px(10.))
                            .bottom(px(8.))
                            .h(px(18.))
                            .bg(linear_gradient(
                                90.,
                                linear_color_stop(theme::alpha(plate, 0.), 0.30),
                                linear_color_stop(plate, 0.92),
                            )),
                    ),
            );
        if agents.open_links {
            let options = [Admission::SignIn, Admission::Link].map(|option| {
                let checked = agents.admission == option;
                let (label, description, id) = match option {
                    Admission::SignIn => (
                        "cloud.share.agent.signIn.label",
                        "cloud.share.agent.signIn.description",
                        "sign_in",
                    ),
                    Admission::Link => (
                        "cloud.share.agent.link.label",
                        "cloud.share.agent.link.description",
                        "link",
                    ),
                };
                let warn = checked && option == Admission::Link;
                let choose = entity.clone();
                div()
                    .id(SharedString::from(format!("agent-admission:{id}")))
                    .debug_selector(move || format!("agent-admission:{id}"))
                    .flex()
                    .gap(px(10.))
                    .px(px(12.))
                    .pt(px(9.))
                    .pb(px(10.))
                    .rounded(px(8.))
                    .cursor(theme::clickable_cursor())
                    .when(checked, |d| d.bg(t.selected))
                    .when(!checked, |d| d.hover(|s| s.bg(t.hover)))
                    .child(
                        div()
                            .mt(px(3.))
                            .size(px(14.))
                            .flex_none()
                            .rounded_full()
                            .when(checked, |d| {
                                d.border(px(4.))
                                    .border_color(if warn { t.warning } else { t.text })
                            })
                            .when(!checked, |d| d.border(px(1.5)).border_color(t.subtle)),
                    )
                    .child(
                        v_flex()
                            .gap(px(2.))
                            .min_w_0()
                            .child(
                                div()
                                    .text_size(px(ty.meta))
                                    .line_height(px(20.))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.text)
                                    .child(tr(label)),
                            )
                            .child(
                                div()
                                    .text_size(px(ty.meta))
                                    .line_height(relative(1.5))
                                    .text_color(if warn { t.text } else { t.muted })
                                    .child(tr(description)),
                            ),
                    )
                    .on_click(move |_, _, cx| choose.update(cx, |a, cx| a.choose(option, cx)))
            });
            form = form.child(v_flex().gap(px(2.)).children(options));
        }
        let copy = entity.clone();
        form = form
            .child(
                h_flex()
                    .flex_wrap()
                    .items_center()
                    .gap_x(px(10.))
                    .gap_y(px(6.))
                    .child(
                        Button::new("cloud-agent-invite")
                            .variant(ButtonVariant::Solid)
                            .when(copied, |b| b.icon(Icon::new("check").with_size(px(14.))))
                            .label(tr(match agents.copy {
                                CopyStatus::Copying => "cloud.common.copying",
                                CopyStatus::Copied => "cloud.share.action.copied",
                                _ => "cloud.share.agent.invite.copy",
                            }))
                            .disabled(agents.copy == CopyStatus::Copying)
                            .h(px(theme::control_compact()))
                            .px(px(11.))
                            .text_size(px(ty.caption))
                            .font_weight(FontWeight::MEDIUM)
                            .on_click(move |_, _, cx| copy.update(cx, |a, cx| a.copy_invite(cx))),
                    )
                    .when(waiting && !copied, |d| {
                        d.child(note("cloud-agent-invite-form-waiting"))
                    }),
            )
            .child(
                div()
                    .text_size(px(ty.caption))
                    .line_height(px(16.))
                    .text_color(t.muted)
                    .child(tr("cloud.share.agent.invite.hint")),
            );
        let alert = match agents.copy {
            CopyStatus::Failed => Some("cloud.share.agent.failed"),
            CopyStatus::NotOwner => Some("cloud.share.agent.notOwner"),
            _ => None,
        };
        form.children(alert.map(|key| {
            div()
                .text_size(px(ty.caption))
                .line_height(px(16.))
                .text_color(t.danger)
                .child(tr(key))
        }))
        .into_any_element()
    }
}
