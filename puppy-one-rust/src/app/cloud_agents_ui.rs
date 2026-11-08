//! `CloudWorkspaceHeaderTools`' Agents: `CloudWorkspaceAgentPeople` (the
//! marks beside Share, an empty seat to invite one), the Agents card under
//! them (`CloudWorkspaceAgentsPanel` with `CloudWorkspaceAgentInvite`) and
//! Manage agents (`CloudWorkspaceAgentsDialog`). An Agent asking to join
//! comes first, since only the owner can move it on; then whoever is at
//! work. The marks are the same in the Header and in the lists, so an Agent
//! looks like itself in both (`ReachMemberMark`).
use super::window_cloud::WindowCloud;
use super::*;
use crate::features::cloud::{CopyStatus, Opener, agent_status};
use crate::features::source_control::relative_time;
use crate::features::source_control::short_date;
use crate::localization::t as tr;
use crate::localization::tf;
use crate::theme::metric;
use crate::ui::agent_brands;
use crate::ui::components::Button;
use crate::ui::components::ButtonVariant;
use crate::ui::components::Dialog;
use crate::ui::components::Icon;
use crate::workspace::cloud::agents::Admission;
use crate::workspace::cloud::agents::AgentRequest;
use crate::workspace::cloud::agents::WorkspaceAgent;
use crate::workspace::cloud::agents::connect_message;
use gpui_kit::{
    base::{Disableable as _, Popover as KitPopover, h_flex, v_flex},
    component::Sizable as _,
};
use std::{cell::Cell, rc::Rc};
mod manage;
mod panel;

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
        Seat::Header => t.header,
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
    let now = crate::clock::now_ms() / 1000;
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
            status: agent_status(a, now),
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

impl WindowCloud {
    /// `CloudWorkspaceHeaderTools`' Agents anchor: the marks, the overflow
    /// count and the invite seat, and the card they open. Nothing when the
    /// account may not manage the list and nobody is in it.
    pub(super) fn agents_control(&self, cx: &App) -> Option<AnyElement> {
        let agents = self.agents.read(cx);
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
        let show = self.agents.update(cx, |a, _| a.press(opener, open));
        self.show_popover(show.then_some(Popover::Agents), cx);
    }
    fn close_agents(&mut self, cx: &mut Context<Self>) {
        if self.popover == Some(Popover::Agents) {
            self.show_popover(None, cx);
        }
    }
    /// `onManage`: the card gives way to Manage agents.
    pub(super) fn open_manage_agents(&mut self, cx: &mut Context<Self>) {
        self.show_popover(None, cx);
        self.agents.update(cx, |a, cx| a.open_manage(cx));
        if !self.dialog_open(DialogKey::ManageAgents, cx) {
            self.open_dialog(DialogKey::ManageAgents, cx);
        }
        cx.notify();
    }
    pub(super) fn close_manage_agents(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.close_dialog(DialogKey::ManageAgents, cx);
        self.agents.update(cx, |a, cx| a.close_manage(cx));
        self.focus_window(window, cx);
        cx.notify();
    }
    /// The hosted Project at its root keeps its Agents current; anything
    /// else forgets them, and Manage agents goes with them.
    pub(super) fn sync_cloud_agents(&mut self, cx: &mut Context<Self>) {
        let project = self.hosted().filter(|_| {
            !self.session().opening && !self.session().file_mode && self.cloud_enabled(cx)
        });
        let open = self.popover == Some(Popover::Agents);
        let name = self.session().name.clone();
        self.agents.update(cx, |a, cx| {
            a.sync(project.as_deref().map(|p| (p, name.as_str())), open, cx)
        });
        if self.agents.read(cx).manage.is_none() {
            self.close_dialog(DialogKey::ManageAgents, cx);
        }
        if open && self.agents_control_hidden(cx) {
            self.show_popover(None, cx);
        }
    }
    /// The card has nothing to stand on once nobody is listed and the list
    /// cannot be managed.
    fn agents_control_hidden(&self, cx: &App) -> bool {
        let agents = self.agents.read(cx);
        agents.agents.is_empty() && agents.requests.is_empty() && !agents.manageable
    }
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

/// A card under the Header on the project menu's own surface, `inset` from
/// its edge.
pub(super) fn card(
    id: &'static str,
    t: Theme,
    width: f32,
    inset: f32,
    max_height: Pixels,
) -> Stateful<Div> {
    v_flex()
        .id(id)
        .debug_selector(move || id.into())
        .occlude()
        .w(px(width))
        .max_h(max_height)
        .overflow_y_scroll()
        .p(px(inset))
        .rounded(px(crate::theme::metric::MENU_RADIUS))
        .border_1()
        .border_color(t.shell_divider)
        .bg(t.header)
        .text_color(t.text)
        .shadow(vec![
            BoxShadow {
                color: theme::alpha(t.shadow, 0.45).into(),
                offset: point(px(0.), px(2.)),
                blur_radius: px(4.),
                spread_radius: px(0.),
                inset: false,
            },
            BoxShadow {
                color: theme::alpha(t.shadow, 0.70).into(),
                offset: point(px(0.), px(12.)),
                blur_radius: px(28.),
                spread_radius: px(-8.),
                inset: false,
            },
        ])
}
