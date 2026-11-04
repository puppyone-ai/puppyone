//! `CloudWorkspaceHeaderTools`' Agents: `CloudWorkspaceAgentPeople` (the
//! marks beside Share, an empty seat to invite one), the Agents card under
//! them (`CloudWorkspaceAgentsPanel` with `CloudWorkspaceAgentInvite`) and
//! Manage agents (`CloudWorkspaceAgentsDialog`). An Agent asking to join
//! comes first, since only the owner can move it on; then whoever is at
//! work. The marks are the same in the Header and in the lists, so an Agent
//! looks like itself in both (`ReachMemberMark`).
use super::*;
use crate::{
    features::{
        cloud_agents::{self, CopyStatus, Opener},
        source_control::{relative_time, short_date},
    },
    localization::{t as tr, tf},
    theme::metric,
    ui::{
        agent_brands,
        components::{Button, ButtonVariant, Dialog, Icon},
    },
    workspace::cloud::agents::{Admission, AgentRequest, WorkspaceAgent, connect_message},
};
use gpui_kit::{
    base::{Disableable as _, Popover as KitPopover, h_flex, v_flex},
    component::Sizable as _,
};
use std::{cell::Cell, rc::Rc};

/// Enough faces to recognize the room; the rest are a count.
const VISIBLE_AGENT_LIMIT: usize = 3;
/// `preferredWidth={320}`, `gap={6}`, `--share-inset: 6px`.
const PANEL_WIDTH: f32 = 320.;
const PANEL_GAP: f32 = 6.;
const PANEL_INSET: f32 = 6.;
const MARK: f32 = 22.;

/// The Header's Agents anchor: the card hangs under it, and a press inside
/// it is the marks' own, not a press outside the card.
pub(super) type AgentsAnchor = Rc<Cell<Bounds<Pixels>>>;

/// How a mark sits on its surface.
#[derive(Clone, Copy, PartialEq)]
enum Seat {
    /// The Header: at rest only its outline.
    Header,
    /// A list on the card or the dialog, on `ground`.
    List(Rgba),
}

/// `ReachMemberMark`: an Agent is its brand, else its initial, in one round
/// mark. Lit (filled, in its own colours, with the success lamp) means at
/// work right now; at rest it is grey. Asking to join is a dashed edge.
fn agent_mark(name: &str, active: bool, waiting: bool, seat: Seat, t: Theme) -> Div {
    let ground = match seat {
        Seat::Header => theme::cloud_header(&t),
        Seat::List(ground) => ground,
    };
    let quiet = !active && !waiting;
    let fg = if quiet { t.muted } else { t.text };
    let brand = agent_brands::resolve(None, None, Some(name));
    let inner: AnyElement = match brand {
        Some(brand) if agent_brands::tile(brand) => agent_brands::artwork(brand, t.dark, MARK)
            .rounded_full()
            .when(quiet, |i| i.grayscale(true).opacity(0.7))
            .into_any_element(),
        Some(brand) => match agent_brands::monochrome(brand) {
            Some(path) => svg()
                .path(path)
                .size(px(MARK * 0.62))
                .text_color(fg)
                .when(quiet, |s| s.opacity(0.7))
                .into_any_element(),
            None => agent_brands::artwork(brand, t.dark, MARK * 0.62 * brand.scale)
                .when(quiet, |i| i.grayscale(true).opacity(0.7))
                .into_any_element(),
        },
        None => div()
            .text_size(px(theme::ty().ui.micro))
            .line_height(px(1. * theme::ty().ui.micro))
            .font_weight(FontWeight::MEDIUM)
            .child(
                name.trim()
                    .chars()
                    .next()
                    .map(|c| c.to_uppercase().to_string())
                    .unwrap_or_default(),
            )
            .into_any_element(),
    };
    let fill = if active {
        Some(theme::mix(t.panel_raised, ground, 0.92))
    } else if waiting || seat == Seat::Header {
        None
    } else {
        Some(ground)
    };
    // The lamp and the request dot carry a ring of the surface they sit on.
    let dot = |color: Rgba, inset: f32| {
        div()
            .absolute()
            .bottom(px(-inset - 1.5))
            .right(px(-inset - 1.5))
            .size(px(9.))
            .rounded_full()
            .border(px(1.5))
            .border_color(ground)
            .bg(color)
    };
    div()
        .relative()
        .size(px(MARK))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded_full()
        .when_some(fill, |d, fill| d.bg(fill))
        .border_1()
        .when(waiting, |d| {
            d.border_dashed().border_color(theme::alpha(fg, 0.55))
        })
        .when(!waiting, |d| d.border_color(theme::alpha(fg, 0.30)))
        .text_color(fg)
        .child(inner)
        .when(active, |d| d.child(dot(t.success, 1.)))
        .when(waiting && seat == Seat::Header, |d| {
            d.child(dot(t.accent, 2.))
        })
}

/// One of the Header's marks.
struct HeaderMark {
    id: String,
    name: String,
    active: bool,
    waiting: bool,
    status: Option<String>,
}
/// Requests first, then whoever is at work.
fn header_marks(agents: &[WorkspaceAgent], requests: &[AgentRequest]) -> Vec<HeaderMark> {
    let now = cloud_agents::now_ms() / 1000;
    let mut working: Vec<&WorkspaceAgent> = agents.iter().collect();
    working.sort_by_key(|a| !a.active);
    requests
        .iter()
        .map(|r| HeaderMark {
            id: r.id.clone(),
            name: r.name.clone(),
            active: false,
            waiting: true,
            status: Some(tr("cloud.share.agent.request.status").to_string()),
        })
        .chain(working.into_iter().map(|a| HeaderMark {
            id: a.agent.id.clone(),
            name: a.agent.name.clone(),
            active: a.active,
            waiting: false,
            status: cloud_agents::status(a, now),
        }))
        .collect()
}

/// `.desktop-titlebar-cloud-agent`: a round compact button.
fn mark_button(id: SharedString, label: String, pressed: bool, t: Theme) -> Stateful<Div> {
    div()
        .id(id.clone())
        .debug_selector(move || id.to_string())
        .size(px(theme::control_compact()))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded_full()
        .text_color(t.muted)
        .cursor(theme::clickable_cursor())
        .hover(|s| s.bg(t.hover).text_color(t.text))
        .when(pressed, |d| d.bg(t.hover))
        .tooltip(crate::ui::components::tooltip(label))
}

impl Shell {
    /// `CloudWorkspaceHeaderTools`' Agents anchor: the marks, the overflow
    /// count and the invite seat, and the card they open. Nothing when the
    /// account may not manage the list and nobody is in it.
    pub(super) fn agents_control(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let agents = self.cloud_agents.read(cx);
        let listed = !agents.agents.is_empty() || !agents.requests.is_empty();
        if !listed && !agents.manageable {
            return None;
        }
        let t = cx.palette();
        let open = self.popover == Some(Popover::Agents);
        let marks = header_marks(&agents.agents, &agents.requests);
        let overflow = marks.len().saturating_sub(VISIBLE_AGENT_LIMIT);
        let opener = agents.opener.clone();
        let press = |opener: Opener| {
            let host = self.weak.clone();
            move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| s.press_agents(opener.clone(), cx));
            }
        };
        let mut row = h_flex().gap(px(2.)).items_center();
        for mark in marks.iter().take(VISIBLE_AGENT_LIMIT) {
            let label = [Some(mark.name.clone()), mark.status.clone()]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" · ");
            let pressed = open && opener == Opener::Agent(mark.id.clone());
            row = row.child(
                mark_button(
                    SharedString::from(format!("cloud-workspace-agent:{}", mark.id)),
                    label,
                    pressed,
                    t,
                )
                .child(agent_mark(
                    &mark.name,
                    mark.active,
                    mark.waiting,
                    Seat::Header,
                    t,
                ))
                .on_click(press(Opener::Agent(mark.id.clone()))),
            );
        }
        if overflow > 0 {
            row = row.child(
                mark_button(
                    "cloud-workspace-agent-more".into(),
                    tr("cloud.share.agent.connected").to_string(),
                    open && opener == Opener::More,
                    t,
                )
                .child(
                    div()
                        .size(px(MARK))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(theme::ty().ui.micro))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.muted)
                        .child(tf("shell.projectReach.more", &[("count", overflow.into())])),
                )
                .on_click(press(Opener::More)),
            );
        }
        if agents.manageable {
            let invite_open = open && opener == Opener::Invite;
            row = row.child(
                mark_button(
                    "cloud-workspace-tool:invite-agent".into(),
                    tr("cloud.share.agent.invite.title").to_string(),
                    invite_open,
                    t,
                )
                .when(invite_open, |d| d.text_color(t.text))
                .child(
                    div()
                        .size(px(MARK))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded_full()
                        .border_1()
                        .border_dashed()
                        .border_color(theme::alpha(t.muted, 0.45))
                        .child(Icon::new("plus").with_size(px(12.)).stroke(2.)),
                )
                .on_click(press(Opener::Invite)),
            );
        }
        let anchor = self.agents_anchor.clone();
        let trigger = div()
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .mr(px(6.))
            .child(row)
            .child(
                canvas(move |bounds, _, _| anchor.set(bounds), |_, _, _, _| {})
                    .absolute()
                    .size_full(),
            )
            .into_any_element();
        let panel = open.then(|| self.agents_panel(cx).into_any_element());
        let host = self.weak.clone();
        Some(
            KitPopover::new("cloud-agents-panel")
                .anchor(Anchor::TopCenter)
                .offset(px(PANEL_GAP))
                // The marks open and close the card themselves.
                .mouse_button(MouseButton::Navigate(NavigationDirection::Forward))
                .overlay_closable(false)
                .open(open)
                .on_open_change(move |opened, _, cx| {
                    if !*opened {
                        let _ = host.update(cx, |s, cx| s.close_agents(cx));
                    }
                })
                .trigger_with(move |_, _, _| trigger)
                .content(move |_, _, _| panel.unwrap_or_else(|| div().into_any_element()))
                .into_any_element(),
        )
    }
    /// A mark, the count or the seat was pressed.
    pub(super) fn press_agents(&mut self, opener: Opener, cx: &mut Context<Self>) {
        let open = self.popover == Some(Popover::Agents);
        let show = self.cloud_agents.update(cx, |a, _| a.press(opener, open));
        self.popover = show.then_some(Popover::Agents);
        cx.notify();
    }
    fn close_agents(&mut self, cx: &mut Context<Self>) {
        if self.popover == Some(Popover::Agents) {
            self.popover = None;
            cx.notify();
        }
    }
    /// `onManage`: the card gives way to Manage agents.
    pub(super) fn open_manage_agents(&mut self, cx: &mut Context<Self>) {
        self.popover = None;
        self.cloud_agents.update(cx, |a, cx| a.open_manage(cx));
        if !self.modals.iter().any(|m| matches!(m, Modal::ManageAgents)) {
            self.modals.open(Modal::ManageAgents);
        }
        cx.notify();
    }
    pub(super) fn close_manage_agents(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.modals.remove(|m| matches!(m, Modal::ManageAgents));
        self.cloud_agents.update(cx, |a, cx| a.close_manage(cx));
        self.focus.focus(window, cx);
        cx.notify();
    }
    /// The hosted Project at its root keeps its Agents current; anything
    /// else forgets them, and Manage agents goes with them.
    pub(super) fn sync_cloud_agents(&mut self, cx: &mut Context<Self>) {
        let project = self
            .hosted_project()
            .filter(|_| !self.opening() && !self.file_mode() && self.cloud_enabled(cx));
        let open = self.popover == Some(Popover::Agents);
        let name = self.project.clone();
        self.cloud_agents.update(cx, |a, cx| {
            a.sync(project.as_deref().map(|p| (p, name.as_str())), open, cx)
        });
        if self.cloud_agents.read(cx).manage.is_none()
            && self.modals.iter().any(|m| matches!(m, Modal::ManageAgents))
        {
            self.modals.remove(|m| matches!(m, Modal::ManageAgents));
        }
        if open && self.agents_control_hidden(cx) {
            self.popover = None;
        }
    }
    /// The card has nothing to stand on once nobody is listed and the list
    /// cannot be managed.
    fn agents_control_hidden(&self, cx: &App) -> bool {
        let agents = self.cloud_agents.read(cx);
        agents.agents.is_empty() && agents.requests.is_empty() && !agents.manageable
    }

    /// `CloudWorkspaceAgentsPanel`.
    fn agents_panel(&self, cx: &App) -> Stateful<Div> {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let agents = self.cloud_agents.read(cx);
        let entity = self.cloud_agents.clone();
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
    fn agents_invite(&self, compact: bool, cx: &App) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let agents = self.cloud_agents.read(cx);
        let entity = self.cloud_agents.clone();
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
        let api = crate::features::cloud_account::environment(cx)
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

    /// `CloudWorkspaceAgentsDialog`: everything that can be changed about
    /// who is in a project, in one place.
    pub(super) fn manage_agents_dialog(&self, cx: &App) -> Dialog {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let agents = self.cloud_agents.read(cx);
        let entity = self.cloud_agents.clone();
        let host = self.weak.clone();
        let now = cloud_agents::now_ms() / 1000;
        let ground = t.panel;
        let (connections, links, change_failed) = agents
            .manage
            .as_ref()
            .map(|m| {
                (
                    m.inventory.connections.clone(),
                    m.inventory.links.clone(),
                    m.change_failed,
                )
            })
            .unwrap_or_default();
        let live = |grant: &str| agents.agents.iter().find(|a| a.agent.grant_id == grant);
        let mut body = v_flex().gap(px(16.));
        if connections.is_empty() {
            body = body.child(
                div()
                    .text_size(px(ty.meta))
                    .text_color(t.muted)
                    .child(tr("cloud.share.agent.empty")),
            );
        } else {
            let rows = connections.iter().map(|agent| {
                let known = live(&agent.grant_id);
                let facts = [
                    known.and_then(|a| cloud_agents::status(a, now)),
                    Some(
                        tr(match agent.admission {
                            Admission::SignIn => "cloud.share.agent.detail.approved",
                            Admission::Link => "cloud.share.agent.detail.joinedByLink",
                        })
                        .to_string(),
                    ),
                    agent
                        .expires_at
                        .as_deref()
                        .and_then(short_date)
                        .map(|date| tf("cloud.share.agent.detail.ends", &[("date", date.into())])),
                ]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" · ");
                let remove = entity.clone();
                let grant = agent.grant_id.clone();
                h_flex()
                    .min_h(px(48.))
                    .gap(px(12.))
                    .items_center()
                    .min_w_0()
                    .child(agent_mark(
                        &agent.name,
                        known.is_some_and(|a| a.active),
                        false,
                        Seat::List(ground),
                        t,
                    ))
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(ty.control))
                                    .text_color(t.text)
                                    .child(agent.name.clone()),
                            )
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(ty.caption))
                                    .line_height(px(16.))
                                    .text_color(t.muted)
                                    .child(facts),
                            ),
                    )
                    .child(
                        Button::new(SharedString::from(format!(
                            "cloud-agent-remove:{}",
                            agent.id
                        )))
                        .variant(ButtonVariant::Secondary)
                        .label(tr("cloud.share.agent.remove"))
                        .accessibility_label(format!(
                            "{} {}",
                            tr("cloud.share.agent.remove"),
                            agent.name
                        ))
                        .h(px(theme::control_compact()))
                        .px(px(11.))
                        .text_size(px(ty.caption))
                        .on_click(move |_, _, cx| remove.update(cx, |a, cx| a.remove(&grant, cx))),
                    )
            });
            body = body.child(v_flex().gap(px(4.)).children(rows));
        }
        if !links.is_empty() {
            body = body.child(
                v_flex()
                    .gap(px(4.))
                    .pt(px(12.))
                    .border_t_1()
                    .border_color(t.shell_divider)
                    .child(
                        div()
                            .text_size(px(ty.meta))
                            .line_height(px(20.))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(tr("cloud.share.agent.links")),
                    )
                    .child(
                        v_flex()
                            .gap(px(2.))
                            .text_size(px(ty.caption))
                            .line_height(px(18.))
                            .text_color(t.muted)
                            .children(links.iter().map(|link| {
                                div().child(tf(
                                    "cloud.share.agent.linkExpires",
                                    &[(
                                        "date",
                                        short_date(&link.expires_at).unwrap_or_default().into(),
                                    )],
                                ))
                            })),
                    ),
            );
        }
        if change_failed {
            body = body.child(
                div()
                    .text_size(px(ty.caption))
                    .line_height(px(16.))
                    .text_color(t.danger)
                    .child(tr("cloud.share.agent.changeFailed")),
            );
        }
        // The service ends links and connections together, so the button
        // says both.
        if !links.is_empty() || connections.len() > 1 {
            let stop = entity.clone();
            body = body.child(
                h_flex().justify_end().child(
                    div()
                        .id("cloud-agent-share-stop")
                        .debug_selector(|| "cloud-agent-share-stop".into())
                        .rounded(px(4.))
                        .text_size(px(ty.caption))
                        .line_height(px(20.))
                        .text_color(t.muted)
                        .cursor(theme::clickable_cursor())
                        .hover(|s| s.text_color(t.danger))
                        .child(tr("cloud.share.agent.removeAll"))
                        .on_click(move |_, _, cx| stop.update(cx, |a, cx| a.remove_all(cx))),
                ),
            );
        }
        Dialog::new("cloud-agents-dialog")
            .width(520.)
            .title(tr("cloud.share.agent.manage"))
            .body_inline(20.)
            .body_padding(4., 20.)
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.close_manage_agents(w, cx));
            })
            .child(body)
    }
}

/// `.desktop-cloud-agents-row-action`: a menu row with its 15px icon in a
/// 22px slot, so it lines up with the marks above it.
fn row_action(id: &'static str, icon: &'static str, label: String, t: Theme) -> Stateful<Div> {
    let ty = theme::ty().ui;
    let group = SharedString::from(format!("{id}-group"));
    h_flex()
        .id(id)
        .debug_selector(move || id.into())
        .group(group.clone())
        .min_h(px(theme::control_roomy()))
        .px(px(8.))
        .gap(px(10.))
        .items_center()
        .rounded(px(metric::CONTROL_RADIUS))
        .text_size(px(ty.control))
        .line_height(px(18.))
        .text_color(t.muted)
        .cursor(theme::clickable_cursor())
        .hover(|s| s.bg(t.hover).text_color(t.text))
        .child(
            div()
                .size(px(MARK))
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .child(
                    Icon::new(icon)
                        .with_size(px(15.))
                        .stroke(1.75)
                        .group_hover_color(group, t.text),
                ),
        )
        .child(div().flex_1().min_w_0().truncate().child(label))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::cloud::agents::{AgentRequest, ConnectedAgent};
    use core::prelude::v1::test;

    fn agent(id: &str, active: bool) -> WorkspaceAgent {
        WorkspaceAgent {
            agent: ConnectedAgent {
                id: id.into(),
                name: id.into(),
                admission: Admission::SignIn,
                grant_id: format!("g-{id}"),
                connected_at: String::new(),
                expires_at: None,
            },
            active,
            last_active_at: None,
            activity_known: true,
        }
    }

    #[test]
    fn requests_lead_then_whoever_is_at_work() {
        let request = AgentRequest {
            id: "r".into(),
            name: "Codex".into(),
            admission: Admission::SignIn,
            requested_at: "2026-10-30T12:00:00Z".into(),
            expires_at: String::new(),
        };
        let marks = header_marks(&[agent("a", false), agent("b", true)], &[request]);
        assert_eq!(
            marks
                .iter()
                .map(|m| (m.id.as_str(), m.waiting))
                .collect::<Vec<_>>(),
            vec![("r", true), ("b", false), ("a", false)]
        );
    }
}
