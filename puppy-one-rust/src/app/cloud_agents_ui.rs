//! `CloudWorkspaceHeaderTools`' Agents: one quiet entry in the Header
//! (`CloudWorkspaceAgentsTool`) that only speaks up when it matters — who
//! is working now, or that an Agent asks to join — and the list it opens
//! (`CloudWorkspaceAgentsPanel`): who works now, everyone with access, how
//! they got in and for how long, removal, and the way to invite the next
//! one. The persistent card of an Agent asking to join
//! (`CloudWorkspaceAgentRequestCard`) hangs under the same entry, and the
//! invite itself stays in the Agents dialog (`dialog`, `invite`).
use super::window_cloud::WindowCloud;
use super::*;
use crate::features::cloud::{CloudAgents, Opener, agent_status};
use crate::features::source_control::{relative_time, short_date};
use crate::localization::{t as tr, tf};
use crate::ui::{
    agent_brands, agent_creature,
    components::{Button, ButtonVariant, Icon, SurfaceFrame, tooltip},
    moments::paint,
};
use crate::workspace::cloud::agents::{Admission, AgentRequest, WorkspaceAgent};
use gpui_kit::{
    base::{Disableable as _, Positioner, h_flex, v_flex},
    component::Sizable as _,
};
use std::{cell::Cell, rc::Rc, time::Duration};
mod dialog;
mod invite;
mod paste_art;

const CARD_WIDTH: f32 = 288.;
/// The mark in a card, larger than in the Header, as a face on a card is.
const CARD_MARK: f32 = 56.;
/// The list under the Header's Agents entry.
const PANEL_WIDTH: f32 = 324.;
/// An Agent's avatar mark in the list.
const ROW_MARK: f32 = 32.;
/// Miniature Agent logo stack inside the Header's Agents entry — echoes
/// Homepage `SpaceAgents` (`18px` rounded-`5px` tiles) at titlebar scale.
const HEADER_STACK_MAX: usize = 3;
const HEADER_TILE: f32 = 18.;
const HEADER_TILE_RADIUS: f32 = 5.;
const HEADER_TILE_OVERLAP: f32 = 6.;

/// The Header's Agents anchor: the list and the request card hang under it.
pub(super) type AgentsAnchor = Rc<Cell<Bounds<Pixels>>>;

/// How an Agent's mark is drawn where it stands.
#[derive(Clone, Copy, PartialEq)]
pub(super) struct Look {
    pub size: f32,
    /// The surface it stands on, which rings it.
    pub ground: Rgba,
    pub active: bool,
    pub waiting: bool,
    /// The Header greys a brand at rest; lists show it as itself.
    pub header: bool,
}

/// The brand the Agent chose, else the one its name names; none for an
/// Agent that chose "other", which is drawn as its own creature.
pub(super) fn agent_brand(
    name: &str,
    avatar: Option<&str>,
) -> Option<&'static agent_brands::Brand> {
    if avatar == Some("other") {
        None
    } else {
        avatar
            .and_then(agent_brands::get)
            .or_else(|| agent_brands::resolve(None, None, Some(name)))
    }
}

/// `AgentAvatarMark`: the brand the Agent chose (else the one its name
/// names), or its own creature; a brand sits in a round mark, quiet at
/// rest. At work the mark fills, hops and wears the success lamp; asking to
/// join it waits behind a dashed edge.
pub(super) fn agent_mark(name: &str, avatar: Option<&str>, look: Look, t: Theme) -> AnyElement {
    let brand = agent_brand(name, avatar);
    let Look {
        size,
        ground,
        active,
        waiting,
        header,
    } = look;
    let ink = if active || waiting { t.text } else { t.muted };
    let drawing: AnyElement = match brand {
        None => {
            let scale = if waiting { 0.68 } else { 1. };
            img(agent_creature::image(name, active, ground))
                .size(px(size * scale))
                .flex_none()
                .into_any_element()
        }
        Some(brand) if agent_brands::tile(brand) => {
            let inner = if !waiting && !header {
                (size - 2.).max(0.)
            } else {
                size
            };
            agent_brands::artwork(brand, t.dark, inner)
                .rounded_full()
                .when(!active && header, |i| i.grayscale(true).opacity(0.7))
                .when(!active && !header, |i| i.opacity(0.92))
                .into_any_element()
        }
        Some(brand) => match agent_brands::monochrome(brand) {
            Some(path) => svg()
                .path(path)
                .size(px(size * 0.56))
                .text_color(ink)
                .when(!active && header, |s| s.opacity(0.7))
                .when(!active && !header, |s| s.opacity(0.88))
                .into_any_element(),
            None => agent_brands::artwork(brand, t.dark, size * 0.56 * brand.scale)
                .when(!active && header, |i| i.grayscale(true).opacity(0.7))
                .when(!active && !header, |i| i.opacity(0.92))
                .into_any_element(),
        },
    };
    let creature = brand.is_none();
    let tile = brand.is_some_and(agent_brands::tile);
    let fill = if waiting || creature || tile {
        None
    } else if active {
        Some(theme::mix(t.panel_raised, ground, 0.92))
    } else if header {
        Some(theme::mix(ink, ground, 0.14))
    } else {
        Some(theme::mix(t.text, ground, 0.055))
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
    let mark = div()
        .relative()
        .size(px(size))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded_full()
        .when_some(fill, |d, fill| d.bg(fill))
        .when(waiting, |d| {
            d.border_1()
                .border_dashed()
                .border_color(theme::alpha(ink, 0.55))
        })
        .when(!waiting && !creature && !header, |d| {
            d.border_1().border_color(theme::alpha(t.text, 0.12))
        })
        .text_color(ink)
        .child(drawing)
        .when(active, |d| d.child(dot(t.success, 0.5)))
        .when(waiting && header, |d| d.child(dot(t.accent, 1.)));
    if hops(
        active,
        header,
        crate::platform::accessibility::reduce_motion(),
    ) {
        hop(mark, name)
    } else {
        mark.into_any_element()
    }
}

/// Only a Header mark at work hops, and never for a person who asked for
/// less motion (`agent-avatar.css`: `prefers-reduced-motion` stills
/// `[data-reach-activity]`).
fn hops(active: bool, header: bool, reduce_motion: bool) -> bool {
    active && header && !reduce_motion
}

/// Compact `AgentAvatarMark` inside a Homepage Agent tile (`18 × 18`, `4px`
/// radius) or a Cloud folder's corner stack (`14 × 14`, `3px` radius):
/// `.onboarding-agent.is-face .desktop-project-reach-mark` and
/// `.onboarding-project-folder-agent .desktop-project-reach-mark`.
pub(in crate::app) fn compact_agent_face(
    name: &str,
    avatar: Option<&str>,
    size: f32,
    radius: f32,
    ground: Rgba,
    t: Theme,
) -> AnyElement {
    let brand = if avatar == Some("other") {
        None
    } else {
        avatar
            .and_then(agent_brands::get)
            .or_else(|| agent_brands::resolve(None, None, Some(name)))
    };
    let inner: AnyElement = match brand {
        None => img(agent_creature::image(name, false, ground))
            .size(px(size))
            .rounded(px(radius))
            .flex_none()
            .into_any_element(),
        Some(brand) => match agent_brands::monochrome(brand) {
            Some(path) => svg()
                .path(path)
                .size(px(size))
                .text_color(t.text)
                .into_any_element(),
            None => agent_brands::artwork(brand, t.dark, size)
                .rounded(px(radius))
                .into_any_element(),
        },
    };
    div()
        .size(px(size))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .overflow_hidden()
        .rounded(px(radius))
        .text_color(t.text)
        .child(inner)
        .into_any_element()
}
/// `desktop-project-reach-hop`: a mark at work hops now and then.
fn hop(mark: Div, name: &str) -> AnyElement {
    let lift = |delta: f32| -> f32 {
        // 0%, 26%, 100%: rest; 5%: up 3; 10%: down; 15%: up 2; 20%: down.
        let keys = [
            (0., 0.),
            (0.05, -3.),
            (0.10, 0.),
            (0.15, -2.),
            (0.20, 0.),
            (0.26, 0.),
        ];
        for pair in keys.windows(2) {
            let ((a, ya), (b, yb)) = (pair[0], pair[1]);
            if delta >= a && delta <= b {
                return ya + (yb - ya) * (delta - a) / (b - a);
            }
        }
        0.
    };
    div()
        .relative()
        .child(mark)
        .with_animation(
            SharedString::from(format!("agent-hop:{name}")),
            Animation::new(Duration::from_millis(2800)).repeat(),
            move |d, delta| d.top(px(lift(delta))),
        )
        .into_any_element()
}

/// What the Header's Agents entry says.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Presence {
    /// Nobody works: a quiet icon like History's.
    Quiet,
    /// Somebody works: their name, or how many work.
    Working(String),
    /// An Agent asks to join and this person may answer.
    Asking,
}
fn presence(agents: &[WorkspaceAgent], requests: &[AgentRequest], manageable: bool) -> Presence {
    if manageable && !requests.is_empty() {
        return Presence::Asking;
    }
    let mut working = agents.iter().filter(|a| a.active);
    match (working.next(), working.count()) {
        (None, _) => Presence::Quiet,
        (Some(one), 0) => Presence::Working(one.agent.name.clone()),
        (Some(_), more) => {
            Presence::Working(tf("native.agents.working", &[("count", (more + 1).into())]))
        }
    }
}

/// Concise scannable copy for one Agent row: its name, live status or relative
/// recency, and the single distinguishing access line (`Ends Dec 24`,
/// `Since Oct 30`, or `Via link · Ends Dec 24`).
struct RowFace {
    name: String,
    live: bool,
    when: String,
    detail: Option<String>,
}
fn row_face(agent: &WorkspaceAgent, now: i64) -> RowFace {
    let when = if agent.active {
        tr("native.agents.active").to_string()
    } else if !agent.activity_known {
        String::new()
    } else {
        match &agent.last_active_at {
            Some(at) => relative_time(at, now).unwrap_or_default(),
            None => tr("cloud.share.agent.status.none").to_string(),
        }
    };
    let stay = match agent.agent.expires_at.as_deref().and_then(short_date) {
        Some(date) => Some(tf("native.agents.ends", &[("date", date.into())])),
        None => short_date(&agent.agent.connected_at)
            .map(|date| tf("native.agents.since", &[("date", date.into())])),
    };
    let mut parts = Vec::with_capacity(2);
    if agent.agent.admission == Admission::Link {
        parts.push(tr("native.agents.viaLink").to_string());
    }
    if let Some(stay) = stay {
        parts.push(stay);
    }
    RowFace {
        name: agent.agent.name.clone(),
        live: agent.active,
        when,
        detail: (!parts.is_empty()).then(|| parts.join(" · ")),
    }
}

/// One miniature `18×18` squircle Agent logo for the Header stack: its real
/// brand artwork (tile or monochrome/icon) or its deterministic creature —
/// never a generic robot or person silhouette. A `quiet` logo (an Agent at
/// rest) is drawn in greyscale on a ground that sinks into the Header, so a
/// stack of idle Agents reads as a soft watermark rather than bright stickers.
fn header_agent_tile(
    name: &str,
    avatar: Option<&str>,
    active: bool,
    waiting: bool,
    quiet: bool,
    ring_ground: Rgba,
    t: Theme,
) -> Div {
    let brand = agent_brand(name, avatar);
    let tile = div()
        .relative()
        .size(px(HEADER_TILE))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(HEADER_TILE_RADIUS))
        .shadow(vec![paint::ring(ring_ground, px(1.5))]);
    if waiting {
        return tile
            .bg(t.header)
            .border_1()
            .border_dashed()
            .border_color(theme::alpha(t.text, 0.45))
            .child(compact_agent_face(name, avatar, 12., 3., t.header, t));
    }
    let ground = if quiet {
        theme::mix(t.text, t.header, 0.06)
    } else {
        t.panel_raised
    };
    let edge = theme::alpha(t.text, if quiet { 0.08 } else { 0.12 });
    match brand {
        Some(brand) if agent_brands::tile(brand) => tile
            .child(
                agent_brands::artwork(brand, t.dark, HEADER_TILE)
                    .rounded(px(HEADER_TILE_RADIUS))
                    .when(quiet, |i| i.grayscale(true)),
            )
            .child(
                div()
                    .absolute()
                    .inset_0()
                    .rounded(px(HEADER_TILE_RADIUS))
                    .border_1()
                    .border_color(theme::alpha(t.text, if quiet { 0.10 } else { 0.14 })),
            ),
        Some(brand) => {
            let mark: AnyElement = match agent_brands::monochrome(brand) {
                Some(path) => svg()
                    .path(path)
                    .size(px(12.))
                    .text_color(if quiet { t.muted } else { t.text })
                    .into_any_element(),
                None => agent_brands::artwork(brand, t.dark, (12. * brand.scale).min(14.))
                    .when(quiet, |i| i.grayscale(true))
                    .into_any_element(),
            };
            tile.bg(ground).border_1().border_color(edge).child(mark)
        }
        None => tile.bg(ground).border_1().border_color(edge).child(
            img(agent_creature::image(name, active, ground))
                .size(px(15.))
                .flex_none()
                .when(quiet, |i| i.grayscale(true)),
        ),
    }
}

/// Ordered faces for the Header's miniature logo stack: working Agents first,
/// then most recently active, capped at [`HEADER_STACK_MAX`].
fn header_stack_agents<'a>(agents: &'a [WorkspaceAgent]) -> Vec<&'a WorkspaceAgent> {
    let mut ordered: Vec<&WorkspaceAgent> = agents.iter().collect();
    ordered.sort_by(|a, b| {
        b.active
            .cmp(&a.active)
            .then_with(|| b.last_active_at.cmp(&a.last_active_at))
    });
    ordered
}

/// Compact overlapping stack of up to 3 real Agent squircle logos. Frontmost
/// logo renders on top at the left; trailing logos tuck smoothly behind with a
/// subtle depth fade and a `1.5px` cutout ring. With `quiet`, every Agent not
/// at work (or asking) is drawn in greyscale.
fn header_agent_stack(
    faces: &[(&str, Option<&str>, bool, bool)],
    quiet: bool,
    ring_ground: Rgba,
    t: Theme,
) -> Div {
    let shown = faces.len().min(HEADER_STACK_MAX);
    let more = faces.len().saturating_sub(HEADER_STACK_MAX);
    let step = HEADER_TILE - HEADER_TILE_OVERLAP;
    let width = HEADER_TILE + shown.saturating_sub(1) as f32 * step;
    let depth = [1.0_f32, 0.90, 0.78];
    let tiles = (0..shown).rev().map(|idx| {
        let (name, avatar, active, waiting) = faces[idx];
        let resting = quiet && !active && !waiting;
        header_agent_tile(name, avatar, active, waiting, resting, ring_ground, t)
            .absolute()
            .top_0()
            .left(px(idx as f32 * step))
            .opacity(depth[idx.min(depth.len() - 1)])
    });
    h_flex()
        .flex_none()
        .items_center()
        .child(
            div()
                .relative()
                .flex_none()
                .w(px(width))
                .h(px(HEADER_TILE))
                .children(tiles),
        )
        .when(more > 0, |d| {
            d.child(
                div()
                    .ml(px(5.))
                    .text_size(px(theme::ty().ui.micro))
                    .line_height(px(14.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.subtle)
                    .child(format!("+{more}")),
            )
        })
}

/// Empty-project Header slot: a quiet `18×18` dashed squircle with `+`, ready
/// to turn into the first Agent's logo once invited.
fn header_empty_slot(group: &str, t: Theme) -> Div {
    div()
        .size(px(HEADER_TILE))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(HEADER_TILE_RADIUS))
        .border_1()
        .border_dashed()
        .border_color(theme::alpha(t.muted, 0.55))
        .text_color(t.muted)
        .group_hover(SharedString::from(group.to_owned()), |d| {
            d.border_color(theme::alpha(t.text, 0.65))
                .text_color(t.text)
        })
        .child(
            Icon::new("plus")
                .with_size(px(10.))
                .stroke(2.2)
                .group_hover_color(SharedString::from(group.to_owned()), t.text),
        )
}

impl WindowCloud {
    /// The project menu's Agents row: who is here as the same miniature
    /// logos the Header shows (greyscale at rest, colour at work), whoever
    /// works first; `None` while nobody is listed.
    pub(in crate::app) fn agents_menu_stack(&self, cx: &App) -> Option<AnyElement> {
        let agents = self.agents.read(cx);
        if agents.agents.is_empty() {
            return None;
        }
        let t = cx.palette();
        let faces: Vec<(&str, Option<&str>, bool, bool)> = header_stack_agents(&agents.agents)
            .into_iter()
            .map(|a| {
                (
                    a.agent.name.as_str(),
                    a.agent.avatar.as_deref(),
                    a.active,
                    false,
                )
            })
            .collect();
        Some(header_agent_stack(&faces, true, t.header, t).into_any_element())
    }

    /// `CloudWorkspaceAgentsTool`: the Header's one Agents entry, built from
    /// the real Agent logos themselves (never a generic robot or people icon).
    /// Quiet miniature stack while nobody works; active logo(s) + green dot +
    /// name while working; waiting logo + accent dot when an Agent asks to
    /// join; quiet dashed `+` squircle when no Agent is here yet.
    pub(super) fn agents_control(&self, cx: &App) -> Option<AnyElement> {
        let agents = self.agents.read(cx);
        let listed = !agents.agents.is_empty() || !agents.requests.is_empty();
        // Until it is known whether this person may invite, the entry holds
        // its place: a Project on its way in for the signed-in account, or
        // one being asked about. With nothing to ask about there is none.
        let checking = agents.checking()
            || (self.session().opening && crate::features::cloud::account::has_account(cx));
        if !listed && !agents.manageable && !checking {
            return None;
        }
        let t = cx.palette();
        let ty = theme::ty().header;
        let label = tr("cloud.share.agent.title");
        let disabled = checking && !listed;
        let press = self.listener(|s, _: &ClickEvent, window, cx| s.press_agents_entry(window, cx));
        let entry: AnyElement = match presence(&agents.agents, &agents.requests, agents.manageable)
        {
            Presence::Working(who) => {
                let active_faces: Vec<(&str, Option<&str>, bool, bool)> = agents
                    .agents
                    .iter()
                    .filter(|a| a.active)
                    .map(|a| {
                        (
                            a.agent.name.as_str(),
                            a.agent.avatar.as_deref(),
                            true,
                            false,
                        )
                    })
                    .collect();
                let ring_ground = if self.agents_panel {
                    t.active
                } else {
                    theme::mix(t.text, t.header, 0.05)
                };
                div()
                    .id("cloud-workspace-agents")
                    .debug_selector(|| "cloud-workspace-agents".into())
                    .role(Role::Button)
                    .aria_label(format!("{label} · {who}"))
                    .h(px(theme::control_compact()))
                    .max_w(px(210.))
                    .px(px(7.))
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .rounded(px(theme::metric::TOOLBAR_ACTION_RADIUS))
                    .text_size(px(ty.meta))
                    .line_height(px(ty.meta_line_height))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.text)
                    .when(self.agents_panel, |d| d.bg(t.active))
                    .when(!self.agents_panel, |d| d.bg(theme::alpha(t.text, 0.05)))
                    .hover(|d| d.bg(t.active))
                    .cursor(theme::clickable_cursor())
                    .child(header_agent_stack(&active_faces, false, ring_ground, t))
                    .child(div().size(px(6.)).flex_none().rounded_full().bg(t.success))
                    .child(div().min_w_0().truncate().child(who))
                    .on_click(press)
                    .into_any_element()
            }
            presence => {
                let asking = presence == Presence::Asking;
                let group = "cloud-workspace-agents-entry";
                let ring_ground = if self.agents_panel {
                    t.selected
                } else {
                    t.header
                };
                let faces: Vec<(&str, Option<&str>, bool, bool)> = if asking {
                    let mut list: Vec<(&str, Option<&str>, bool, bool)> = agents
                        .requests
                        .iter()
                        .take(1)
                        .map(|r| (r.name.as_str(), r.avatar.as_deref(), false, true))
                        .collect();
                    list.extend(header_stack_agents(&agents.agents).into_iter().map(|a| {
                        (
                            a.agent.name.as_str(),
                            a.agent.avatar.as_deref(),
                            a.active,
                            false,
                        )
                    }));
                    list
                } else {
                    header_stack_agents(&agents.agents)
                        .into_iter()
                        .map(|a| {
                            (
                                a.agent.name.as_str(),
                                a.agent.avatar.as_deref(),
                                a.active,
                                false,
                            )
                        })
                        .collect()
                };
                // At rest the logos are a greyscale watermark at half
                // strength; the pointer brings them up a little, and an open
                // list shows them in their own colours.
                let quiet = !self.agents_panel;
                let content: AnyElement = if faces.is_empty() {
                    header_empty_slot(group, t).into_any_element()
                } else {
                    header_agent_stack(&faces, quiet, ring_ground, t)
                        .when(quiet && !asking, |d| {
                            d.opacity(0.5).group_hover(group, |d| d.opacity(0.85))
                        })
                        .into_any_element()
                };
                let mut button = div()
                    .id("cloud-workspace-agents")
                    .debug_selector(|| "cloud-workspace-agents".into())
                    .group(group)
                    .relative()
                    .role(Role::Button)
                    .aria_label(label)
                    .h(px(theme::control_compact()))
                    .min_w(px(theme::metric::TITLEBAR_TOOL_ACTION_WIDTH))
                    .px(px(7.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(theme::metric::TOOLBAR_ACTION_RADIUS))
                    .when(self.agents_panel, |d| d.bg(t.selected))
                    .when(disabled, |d| d.opacity(0.55))
                    .when(!disabled, |d| {
                        d.cursor(theme::clickable_cursor())
                            .hover(|d| {
                                d.bg(if self.agents_panel {
                                    t.selected
                                } else {
                                    t.hover
                                })
                            })
                            .tooltip(tooltip(label))
                            .on_click(press)
                    })
                    .child(content);
                if asking {
                    button = button.child(
                        div()
                            .absolute()
                            .top(px(5.))
                            .right(px(5.))
                            .size(px(7.))
                            .rounded_full()
                            .bg(t.accent)
                            .border(px(1.5))
                            .border_color(t.header),
                    );
                }
                button.into_any_element()
            }
        };
        let anchor = self.agents_anchor.clone();
        let mut control = div()
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .child(entry)
            .child(
                canvas(move |bounds, _, _| anchor.set(bounds), |_, _, _, _| {})
                    .absolute()
                    .size_full(),
            );
        if let Some(panel) = self.agents_panel(cx) {
            control = control.child(panel);
        }
        if let Some(card) = self.request_card(cx) {
            control = control.child(card);
        }
        Some(control.into_any_element())
    }

    /// A press on the Agents entry. While a request waits it brings its
    /// Deny into keyboard reach, without answering it; with nobody here yet
    /// it goes straight to inviting; otherwise it opens or closes the list.
    pub(super) fn press_agents_entry(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let agents = self.agents.read(cx);
        if agents.manageable && !agents.requests.is_empty() {
            self.deny_focus.focus(window, cx);
            return;
        }
        if agents.agents.is_empty() {
            self.press_agents(Opener::Invite, window, cx);
            return;
        }
        self.agents.update(cx, |a, cx| a.confirm_remove(None, cx));
        self.agents_panel = !self.agents_panel;
        self.computer_peek = false;
        cx.notify();
    }

    /// Closes the Agents list, if it is open.
    pub(super) fn close_agents_panel(&mut self, cx: &mut Context<Self>) -> bool {
        if !self.agents_panel {
            return false;
        }
        self.agents_panel = false;
        self.agents.update(cx, |a, cx| a.confirm_remove(None, cx));
        cx.notify();
        true
    }

    /// `CloudWorkspaceAgentsPanel`: whoever works first, then everyone with
    /// access, each with its avatar, name, recency and concise access detail.
    /// Removing asks once, on the row. `Invite` turns to the invite dialog.
    fn agents_panel(&self, cx: &App) -> Option<AnyElement> {
        if !self.agents_panel {
            return None;
        }
        let agents = self.agents.read(cx);
        let t = cx.palette();
        let ty = theme::ty().ui;
        let now = crate::clock::now_ms() / 1000;
        let count = agents.agents.len();
        let mut sorted: Vec<&WorkspaceAgent> = agents.agents.iter().collect();
        sorted.sort_by_key(|a| !a.active);
        let rows = sorted
            .into_iter()
            .map(|agent| self.panel_row(agents, agent, now, cx))
            .collect::<Vec<_>>();
        let invite = self.listener(|s, _: &ClickEvent, window, cx| {
            s.agents_panel = false;
            s.press_agents(Opener::Invite, window, cx);
        });
        let anchor = self.agents_anchor.clone();
        let close = self.listener(move |s, event: &MouseDownEvent, _, cx| {
            // A press on the entry itself toggles it instead.
            if !anchor.get().contains(&event.position) {
                s.close_agents_panel(cx);
            }
        });
        let panel = SurfaceFrame::popover_card("cloud-agents-panel")
            .debug_selector(|| "cloud-agents-panel".into())
            .absorb_mouse_down()
            .on_mouse_down_out(close)
            .w(px(PANEL_WIDTH))
            .child(
                h_flex()
                    .items_center()
                    .justify_between()
                    .pl(px(14.))
                    .pr(px(10.))
                    .py(px(10.))
                    .border_b_1()
                    .border_color(t.shell_divider)
                    .child(
                        h_flex()
                            .items_center()
                            .gap(px(7.))
                            .min_w_0()
                            .child(
                                div()
                                    .text_size(px(ty.meta))
                                    .line_height(px(18.))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(t.text)
                                    .child(tr("cloud.share.agent.title")),
                            )
                            .when(count > 0, |d| {
                                d.child(
                                    div()
                                        .flex_none()
                                        .h(px(18.))
                                        .px(px(6.))
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .rounded_full()
                                        .bg(theme::alpha(t.text, 0.06))
                                        .text_size(px(ty.micro))
                                        .line_height(px(14.))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(t.subtle)
                                        .child(count.to_string()),
                                )
                            }),
                    )
                    .when(agents.manageable, |d| {
                        d.child(
                            Button::new("cloud-agents-panel-invite")
                                .debug_selector(|| "cloud-agents-panel-invite".into())
                                .variant(ButtonVariant::Outline)
                                .icon(Icon::new("plus").with_size(px(12.)).stroke(2.))
                                .label(tr("native.agents.invite"))
                                .h(px(24.))
                                .px(px(8.))
                                .gap(px(4.))
                                .rounded(px(6.))
                                .text_size(px(ty.caption))
                                .font_weight(FontWeight::MEDIUM)
                                .on_click(invite),
                        )
                    }),
            )
            .child(
                v_flex()
                    .id("cloud-agents-panel-list")
                    .max_h(px(340.))
                    .overflow_y_scroll()
                    .p(px(6.))
                    .gap(px(2.))
                    .children(rows),
            )
            .when(agents.change_failed, |d| {
                d.child(
                    div()
                        .px(px(14.))
                        .pb(px(10.))
                        .text_size(px(ty.micro))
                        .line_height(px(15.))
                        .text_color(t.danger)
                        .child(tr("cloud.share.agent.changeFailed")),
                )
            });
        let anchor = self.agents_anchor.get();
        let left = (f32::from(anchor.right()) - PANEL_WIDTH).max(8.);
        Some(
            deferred(
                Positioner::corner(Anchor::TopLeft, point(px(left), anchor.bottom() + px(6.)))
                    .margin(px(8.))
                    .occlude()
                    .child(panel),
            )
            .with_priority(gpui_kit::base::POPUP_PRIORITY)
            .into_any_element(),
        )
    }

    /// One Agent in the list: its real avatar mark (brand or creature), its
    /// name and concise expiry/join metadata, and right-aligned recency that
    /// cleanly yields to a subtle remove action on hover.
    fn panel_row(
        &self,
        agents: &CloudAgents,
        agent: &WorkspaceAgent,
        now: i64,
        cx: &App,
    ) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let id = agent.agent.id.clone();
        let face = row_face(agent, now);
        let group = format!("cloud-agents-panel-row:{id}");
        let avatar = agent_mark(
            &agent.agent.name,
            agent.agent.avatar.as_deref(),
            Look {
                size: ROW_MARK,
                ground: t.menu_bg,
                active: agent.active,
                waiting: false,
                header: false,
            },
            t,
        );
        let row = h_flex()
            .id(SharedString::from(group.clone()))
            .debug_selector({
                let group = group.clone();
                move || group
            })
            .group(group.clone())
            .relative()
            .items_center()
            .gap(px(11.))
            .px(px(8.))
            .py(px(8.))
            .rounded(px(8.))
            .child(avatar);
        if agents.confirming.as_deref() == Some(id.as_str()) {
            let removing = agents.removing.as_deref() == Some(id.as_str());
            let (keep, remove) = (self.agents.clone(), self.agents.clone());
            let target = id.clone();
            return row
                .bg(theme::alpha(t.danger, 0.08))
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .gap(px(1.))
                        .child(
                            div()
                                .truncate()
                                .text_size(px(ty.meta))
                                .line_height(px(17.))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.text)
                                .child(tf(
                                    "native.agents.removeConfirm",
                                    &[("name", face.name.clone().into())],
                                )),
                        )
                        .child(
                            div()
                                .truncate()
                                .text_size(px(ty.micro))
                                .line_height(px(15.))
                                .text_color(t.subtle)
                                .child(tr("native.agents.removeDetail")),
                        ),
                )
                .child(
                    h_flex()
                        .flex_none()
                        .gap(px(4.))
                        .child(
                            Button::new(SharedString::from(format!(
                                "cloud-agents-panel-keep:{id}"
                            )))
                            .variant(ButtonVariant::Ghost)
                            .label(tr("cloud.share.agent.keep"))
                            .h(px(24.))
                            .px(px(8.))
                            .rounded(px(6.))
                            .text_size(px(ty.caption))
                            .disabled(removing)
                            .on_click(move |_, _, cx| {
                                keep.update(cx, |a, cx| a.confirm_remove(None, cx))
                            }),
                        )
                        .child(
                            Button::new(SharedString::from(format!(
                                "cloud-agents-panel-remove-confirm:{id}"
                            )))
                            .variant(ButtonVariant::SolidDanger)
                            .label(tr("cloud.share.agent.remove"))
                            .h(px(24.))
                            .px(px(8.))
                            .rounded(px(6.))
                            .text_size(px(ty.caption))
                            .disabled(removing)
                            .on_click(move |_, _, cx| {
                                remove.update(cx, |a, cx| a.remove(&target, cx))
                            }),
                        ),
                )
                .into_any_element();
        }
        let watch = (face.live && self.screen.read(cx).entry_available(cx)).then(|| {
            let host = self.weak.clone();
            div()
                .id(SharedString::from(format!("cloud-agents-panel-watch:{id}")))
                .debug_selector({
                    let id = id.clone();
                    move || format!("cloud-agents-panel-watch:{id}")
                })
                .flex_none()
                .px(px(7.))
                .h(px(22.))
                .flex()
                .items_center()
                .rounded(px(5.))
                .bg(theme::alpha(t.text, 0.06))
                .text_size(px(ty.micro))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.muted)
                .cursor(theme::clickable_cursor())
                .hover(|d| d.bg(theme::alpha(t.text, 0.12)).text_color(t.text))
                .child(tr("native.agents.watch"))
                .on_click(move |_, window, cx| {
                    let _ = host.update(cx, |s, cx| {
                        s.agents_panel = false;
                        if !s.screen.read(cx).is_shown(cx) {
                            s.toggle_computer(window, cx);
                        }
                        cx.notify();
                    });
                })
        });
        let remove = agents.manageable.then(|| {
            let confirm = self.agents.clone();
            let target = id.clone();
            let label = format!("{} {}", tr("cloud.share.agent.remove"), face.name);
            div()
                .absolute()
                .inset_0()
                .flex()
                .items_center()
                .justify_end()
                .opacity(0.)
                .group_hover(group.clone(), |d| d.opacity(1.))
                .child(
                    div()
                        .id(SharedString::from(format!(
                            "cloud-agents-panel-remove:{id}"
                        )))
                        .debug_selector({
                            let id = id.clone();
                            move || format!("cloud-agents-panel-remove:{id}")
                        })
                        .size(px(24.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(6.))
                        .text_color(t.subtle)
                        .hover(|d| d.bg(theme::alpha(t.danger, 0.12)).text_color(t.danger))
                        .cursor(theme::clickable_cursor())
                        .tooltip(tooltip(label))
                        .child(Icon::new("x").with_size(px(12.)).stroke(2.))
                        .on_click(move |_, _, cx| {
                            confirm.update(cx, |a, cx| a.confirm_remove(Some(target.clone()), cx))
                        }),
                )
        });
        let trailing = h_flex()
            .flex_none()
            .items_center()
            .gap(px(6.))
            .children(watch)
            .child(
                div()
                    .relative()
                    .min_w(px(24.))
                    .min_h(px(24.))
                    .flex()
                    .items_center()
                    .justify_end()
                    .when(!face.when.is_empty(), |d| {
                        d.child(
                            div()
                                .text_size(px(ty.micro))
                                .line_height(px(15.))
                                .text_color(if face.live { t.success } else { t.subtle })
                                .when(face.live, |d| d.font_weight(FontWeight::MEDIUM))
                                .when(agents.manageable, |d| {
                                    d.group_hover(group.clone(), |d| d.opacity(0.))
                                })
                                .child(face.when.clone()),
                        )
                    })
                    .children(remove),
            );
        row.hover(|d| d.bg(t.hover))
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap(px(2.))
                    .child(
                        div()
                            .truncate()
                            .text_size(px(ty.meta))
                            .line_height(px(17.))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(face.name),
                    )
                    .children(face.detail.map(|detail| {
                        div()
                            .truncate()
                            .text_size(px(ty.micro))
                            .line_height(px(15.))
                            .text_color(theme::alpha(t.subtle, 0.88))
                            .child(detail)
                    })),
            )
            .child(trailing)
            .into_any_element()
    }

    /// `CloudWorkspaceAgentRequestCard`: the oldest request, below the
    /// Header until it is answered. Nothing dismisses it — no outside
    /// press, no Escape, no hover lifetime; the server's next list removes
    /// an answered or expired request and brings the next. It does not take
    /// the editor's focus when it arrives; pressing a Header mark brings
    /// Deny into keyboard reach.
    fn request_card(&self, cx: &App) -> Option<AnyElement> {
        let agents = self.agents.read(cx);
        // The open dialog answers it instead, never a second overlay.
        if !agents.manageable || self.dialog_open(DialogKey::Agents, cx) {
            return None;
        }
        let request = agents.requests.first()?;
        let t = cx.palette();
        let ty = theme::ty().ui;
        let now = crate::clock::now_ms() / 1000;
        let ground = t.menu_bg;
        let deciding = agents.deciding.contains(&request.id);
        let count = agents.requests.len();
        let project = agents.project_name().unwrap_or_default().to_owned();
        let answer = |allow: bool| {
            let entity = self.agents.clone();
            let id = request.id.clone();
            move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                entity.update(cx, |a, cx| a.decide(&id, allow, cx));
            }
        };
        let card = SurfaceFrame::popover_card("cloud-agent-request-card")
            .debug_selector(|| "cloud-agent-request-card".into())
            .w(px(CARD_WIDTH))
            .child(
                h_flex()
                    .gap(px(7.))
                    .px(px(14.))
                    .py(px(9.))
                    .border_b_1()
                    .border_color(t.shell_divider)
                    .text_size(px(ty.caption))
                    .line_height(px(16.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.muted)
                    .child(format!(
                        "{} · {}",
                        tr("cloud.share.agent.request.status"),
                        relative_time(&request.requested_at, now).unwrap_or_default()
                    ))
                    .when(count > 1, |d| {
                        d.child(div().ml_auto().child(tf(
                            "cloud.share.agent.request.count",
                            &[("count", count.into())],
                        )))
                    }),
            )
            .child(
                h_flex()
                    .gap(px(14.))
                    .p(px(14.))
                    .child(agent_mark(
                        &request.name,
                        request.avatar.as_deref(),
                        Look {
                            size: CARD_MARK,
                            ground,
                            active: false,
                            waiting: false,
                            header: false,
                        },
                        t,
                    ))
                    .child(
                        v_flex()
                            .gap(px(1.))
                            .min_w_0()
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(ty.control))
                                    .line_height(px(20.))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(request.name.clone()),
                            )
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(ty.caption))
                                    .line_height(px(17.))
                                    .text_color(t.muted)
                                    .child(project),
                            ),
                    ),
            )
            .child(
                div()
                    .px(px(14.))
                    .pb(px(12.))
                    .text_size(px(ty.caption))
                    .line_height(px(18.))
                    .text_color(t.muted)
                    .child(tr("cloud.share.agent.request.access")),
            )
            .when(agents.decision_failed, |d| {
                d.child(
                    div()
                        .px(px(14.))
                        .pb(px(12.))
                        .text_size(px(ty.caption))
                        .line_height(px(18.))
                        .text_color(t.danger)
                        .child(tr("cloud.share.agent.changeFailed")),
                )
            })
            .child(
                h_flex()
                    .justify_end()
                    .gap(px(8.))
                    .px(px(14.))
                    .pb(px(14.))
                    .child(
                        Button::new("cloud-agent-request-deny")
                            .variant(ButtonVariant::Pattern)
                            .label(tr("cloud.share.agent.request.deny"))
                            .accessibility_label(format!(
                                "{} {}",
                                tr("cloud.share.agent.request.deny"),
                                request.name
                            ))
                            .track_focus(&self.deny_focus)
                            .disabled(deciding)
                            .on_click(answer(false)),
                    )
                    .child(
                        Button::new("cloud-agent-request-allow")
                            .variant(ButtonVariant::PatternPrimary)
                            .label(tr("cloud.share.agent.request.allow"))
                            .accessibility_label(format!(
                                "{} {}",
                                tr("cloud.share.agent.request.allow"),
                                request.name
                            ))
                            .disabled(deciding)
                            .on_click(answer(true)),
                    ),
            );
        let anchor = self.agents_anchor.get();
        let left = (f32::from(anchor.right()) - CARD_WIDTH).max(8.);
        Some(
            deferred(
                Positioner::corner(Anchor::TopLeft, point(px(left), anchor.bottom() + px(6.)))
                    .margin(px(8.))
                    .occlude()
                    .child(card),
            )
            .with_priority(gpui_kit::base::POPUP_PRIORITY)
            .into_any_element(),
        )
    }
    /// The invite (or, from a capture, another opener): the Agents dialog.
    /// While a request waits, the press brings its Deny into keyboard reach
    /// instead, without answering it.
    pub(super) fn press_agents(
        &mut self,
        opener: Opener,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.agents.read(cx).requests.is_empty() && self.agents.read(cx).manageable {
            self.deny_focus.focus(window, cx);
            return;
        }
        self.agents_panel = false;
        self.show_popover(None, cx);
        self.agents.update(cx, |a, cx| a.open(opener, cx));
        if !self.dialog_open(DialogKey::Agents, cx) {
            self.open_dialog(DialogKey::Agents, cx);
        }
        self.refresh(cx);
    }
    pub(super) fn close_agents_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.close_dialog(DialogKey::Agents, cx);
        self.focus_window(window, cx);
        self.refresh(cx);
    }
    /// The hosted Project at its root keeps its Agents current; anything
    /// else forgets them, and their dialog goes with them. An open dialog
    /// answers a request itself; the Header's card waits until it closes.
    pub(super) fn sync_cloud_agents(&mut self, cx: &mut Context<Self>) {
        let project = self.hosted().filter(|_| {
            !self.session().opening && !self.session().file_mode && self.cloud_enabled(cx)
        });
        let name = self.session().name.clone();
        let open = self.dialog_open(DialogKey::Agents, cx);
        let before = self.agents.read(cx).scope_key().map(str::to_owned);
        self.agents.update(cx, |a, cx| {
            a.sync(project.as_deref().map(|p| (p, name.as_str())), open, cx)
        });
        // A dialog open for one Project and identity ends with them: another
        // Project, account, sign-in or host never inherits it.
        let revoked = before.is_some() && self.agents.read(cx).scope_key() != before.as_deref();
        // The Agent at work here: the Header's Computer button marks it.
        let operator = self
            .agents
            .read(cx)
            .agents
            .iter()
            .find(|a| a.active)
            .map(|a| SharedString::from(a.agent.name.clone()));
        self.screen.update(cx, |s, cx| s.set_operator(operator, cx));
        let agents = self.agents.read(cx);
        let listed = !agents.agents.is_empty() || !agents.requests.is_empty();
        let pending = agents.manageable && !agents.requests.is_empty();
        let gone =
            agents.project_name().is_none() || (!listed && !agents.manageable && agents.known);
        // An open dialog answers a request itself, where the Agent asks.
        if open && (gone || revoked) {
            self.close_dialog(DialogKey::Agents, cx);
        }
        // The list closes with its Project, and while a request waits on
        // its own card.
        if (pending || gone || revoked) && self.agents_panel {
            self.agents_panel = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::cloud::agents::ConnectedAgent;
    use core::prelude::v1::test;

    fn agent(id: &str, active: bool) -> WorkspaceAgent {
        WorkspaceAgent {
            agent: ConnectedAgent {
                id: id.into(),
                name: id.into(),
                avatar: None,
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

    /// `agentPresenceMotion`: only a working Header mark would hop, and none
    /// for a person who asked for less motion (lists and cards never hop).
    #[test]
    fn only_a_working_header_mark_hops_and_never_with_reduced_motion() {
        assert!(hops(true, true, false));
        assert!(!hops(true, true, true));
        assert!(!hops(false, true, false));
        assert!(!hops(true, false, false));
    }

    /// `CloudWorkspaceAgentsTool`: quiet while nobody works; who works, by
    /// name or by count, while they do; an Agent asking to join first.
    #[test]
    fn the_header_entry_says_who_works_and_who_asks() {
        let request = AgentRequest {
            id: "r".into(),
            name: "Codex".into(),
            avatar: None,
            admission: Admission::SignIn,
            requested_at: "2026-10-30T12:00:00Z".into(),
            expires_at: String::new(),
        };
        let quiet = [named("a", "Grok Bot", false), named("b", "Cursor", false)];
        assert_eq!(presence(&quiet, &[], true), Presence::Quiet);
        let one = [named("a", "Grok Bot", true), named("b", "Cursor", false)];
        assert_eq!(
            presence(&one, &[], true),
            Presence::Working("Grok Bot".into())
        );
        let two = [named("a", "Grok Bot", true), named("b", "Cursor", true)];
        assert_eq!(
            presence(&two, &[], true),
            Presence::Working("2 agents".into())
        );
        assert_eq!(presence(&two, &[request.clone()], true), Presence::Asking);
        // Someone who may not answer a request sees who works instead.
        assert_eq!(
            presence(&one, &[request], false),
            Presence::Working("Grok Bot".into())
        );
    }

    fn named(id: &str, name: &str, active: bool) -> WorkspaceAgent {
        let mut agent = agent(id, active);
        agent.agent.name = name.into();
        agent
    }

    /// `AgentAvatarMark`: the picture an Agent chose when it connected,
    /// over anything read from its name; "other" is a choice of no brand,
    /// and a picture this build does not know is no choice at all. Without
    /// a brand it is its own creature, never a letter of its name.
    #[test]
    fn an_agent_shows_the_brand_it_chose_else_its_names_else_a_creature() {
        let brand = |name: &str, avatar: Option<&str>| agent_brand(name, avatar).map(|b| b.id);
        assert_eq!(brand("Grok Bot", None), Some("grok-bot"));
        assert_eq!(brand("Research helper", None), None);
        assert_eq!(brand("秘书小陈", None), None);
        assert_eq!(brand("薄肌孙教练", Some("grok-bot")), Some("grok-bot"));
        assert_eq!(brand("Claude helper", Some("other")), None);
        assert_eq!(
            brand("Codex", Some("a-picture-this-build-does-not-know")),
            Some("codex")
        );
    }

    /// `CloudWorkspaceAgentsPanel`: concise row copy — live state or short
    /// recency without boilerplate prefixes, and expiry/join metadata that
    /// only tags link admission.
    #[test]
    fn a_panel_row_keeps_status_and_access_concise() {
        let now = 1_793_361_600; // 2026-10-30T12:00:00Z
        let mut working = named("c1", "Codex", true);
        working.agent.expires_at = Some("2026-11-29T12:00:00Z".into());
        let mut earlier = named("c2", "Grok Bot", false);
        earlier.last_active_at = Some("2026-10-30T10:00:00Z".into());
        earlier.agent.connected_at = "2026-10-30T09:00:00Z".into();
        earlier.agent.admission = Admission::Link;
        let mut idle = named("c3", "Cursor", false);
        idle.agent.connected_at = "2026-10-29T12:00:00Z".into();

        let face = row_face(&working, now);
        assert!(face.live);
        assert_eq!(
            (face.name.as_str(), face.when.as_str()),
            ("Codex", "Working")
        );
        assert_eq!(face.detail.as_deref(), Some("Ends Nov 29"));

        let face = row_face(&earlier, now);
        assert!(!face.live);
        assert_eq!(face.when, "2 hours ago");
        assert_eq!(face.detail.as_deref(), Some("Via link · Since Oct 30"));

        let face = row_face(&idle, now);
        assert_eq!(face.when, "No recent work");
        assert_eq!(face.detail.as_deref(), Some("Since Oct 29"));

        let roster = [idle, earlier, working];
        let ordered = header_stack_agents(&roster);
        let ids: Vec<&str> = ordered.iter().map(|a| a.agent.id.as_str()).collect();
        assert_eq!(ids, ["c1", "c2", "c3"]);
    }
}
