//! `CloudWorkspaceHeaderTools`' Agents: `CloudWorkspaceAgentPeople` (whoever
//! is live, each its own button, then the Agents at rest as one stack, or an
//! empty seat while nobody is here), the card an Agent's mark shows under
//! the pointer (`CloudWorkspaceAgentCard`), the persistent card of an Agent
//! asking to join (`CloudWorkspaceAgentRequestCard`) and the Agents dialog
//! (`dialog`). The mark is the same everywhere (`AgentAvatarMark`), so an
//! Agent looks like itself in the Header, its card and the dialog.
use super::window_cloud::WindowCloud;
use super::*;
use crate::features::cloud::{Opener, agent_status};
use crate::features::source_control::{relative_time, short_date};
use crate::localization::{t as tr, tf};
use crate::ui::{
    agent_brands, agent_creature,
    components::{Button, ButtonVariant, Icon},
};
use crate::workspace::cloud::agents::{Admission, AgentRequest, WorkspaceAgent};
use gpui_kit::{
    base::{Disableable as _, Positioner, h_flex, v_flex},
    component::Sizable as _,
};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
    time::Duration,
};
mod dialog;
mod paste_art;

/// Enough faces to recognize the room; the rest are a count.
const VISIBLE_AGENT_LIMIT: usize = 3;
/// Long enough that passing over the Header shows nothing; the card then
/// follows the pointer at once.
const CARD_DELAY: Duration = Duration::from_millis(350);
const CARD_WIDTH: f32 = 288.;
/// The mark in a card, larger than in the Header, as a face on a card is.
const CARD_MARK: f32 = 56.;

/// The Header's Agents anchor: the request card hangs under it.
pub(super) type AgentsAnchor = Rc<Cell<Bounds<Pixels>>>;

/// Where each Header face is, for the card under the one pointed at, and
/// which card shows.
#[derive(Default)]
pub(super) struct AgentCards {
    faces: Rc<RefCell<HashMap<String, Bounds<Pixels>>>>,
    /// The face whose card shows.
    pub(super) shown: Option<String>,
    timer: Option<gpui::Task<()>>,
}

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

/// `AgentAvatarMark`: the brand the Agent chose (else the one its name
/// names), or its own creature; a brand sits in a round mark, quiet at
/// rest. At work the mark fills, hops and wears the success lamp; asking to
/// join it waits behind a dashed edge.
pub(super) fn agent_mark(name: &str, avatar: Option<&str>, look: Look, t: Theme) -> AnyElement {
    let brand = if avatar == Some("other") {
        None
    } else {
        avatar
            .and_then(agent_brands::get)
            .or_else(|| agent_brands::resolve(None, None, Some(name)))
    };
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
        Some(brand) if agent_brands::tile(brand) => agent_brands::artwork(brand, t.dark, size)
            .rounded_full()
            .when(!active && header, |i| i.grayscale(true))
            .when(!active, |i| i.opacity(0.7))
            .into_any_element(),
        Some(brand) => match agent_brands::monochrome(brand) {
            Some(path) => svg()
                .path(path)
                .size(px(size * 0.62))
                .text_color(ink)
                .when(!active, |s| s.opacity(0.7))
                .into_any_element(),
            None => agent_brands::artwork(brand, t.dark, size * 0.62 * brand.scale)
                .when(!active && header, |i| i.grayscale(true))
                .when(!active, |i| i.opacity(0.7))
                .into_any_element(),
        },
    };
    let creature = brand.is_none();
    let fill = if waiting || creature {
        None
    } else if active {
        Some(theme::mix(t.panel_raised, ground, 0.92))
    } else if header {
        Some(theme::mix(ink, ground, 0.14))
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
            d.border_1().border_color(theme::alpha(ink, 0.30))
        })
        .text_color(ink)
        .child(drawing)
        .when(active, |d| d.child(dot(t.success, 0.5)))
        .when(waiting && header, |d| d.child(dot(t.accent, 1.)));
    if active && header {
        hop(mark, name)
    } else {
        mark.into_any_element()
    }
}
/// `desktop-project-reach-hop`: a mark at work hops now and then; a person
/// who asked for less motion sees it still.
fn hop(mark: Div, name: &str) -> AnyElement {
    if crate::platform::accessibility::reduce_motion() {
        return mark.into_any_element();
    }
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

/// A Header mark: an Agent at work, or one asking to join.
struct Live {
    id: String,
    name: String,
    avatar: Option<String>,
    active: bool,
    waiting: bool,
    status: Option<String>,
}
/// What the Header shows of who is here: who is live (requests, then
/// whoever is at work), the first three on their own, and everyone else as
/// one stack.
fn people(agents: &[WorkspaceAgent], requests: &[AgentRequest]) -> (Vec<Live>, Vec<Live>) {
    let now = crate::clock::now_ms() / 1000;
    let mark = |a: &WorkspaceAgent| Live {
        id: a.agent.id.clone(),
        name: a.agent.name.clone(),
        avatar: a.agent.avatar.clone(),
        active: a.active,
        waiting: false,
        status: agent_status(a, now),
    };
    let mut live: Vec<Live> = requests
        .iter()
        .map(|r| Live {
            id: r.id.clone(),
            name: r.name.clone(),
            avatar: r.avatar.clone(),
            active: false,
            waiting: true,
            status: Some(tr("cloud.share.agent.request.status").to_string()),
        })
        .chain(agents.iter().filter(|a| a.active).map(mark))
        .collect();
    let mut resting = live.split_off(live.len().min(VISIBLE_AGENT_LIMIT));
    resting.extend(agents.iter().filter(|a| !a.active).map(mark));
    (live, resting)
}

/// `.desktop-titlebar-cloud-agent`: a mark is its button's own circle.
fn mark_button(id: SharedString, label: String, t: Theme) -> Stateful<Div> {
    div()
        .id(id.clone())
        .debug_selector(move || id.to_string())
        .h(px(theme::control_compact()))
        .min_w(px(theme::control_compact()))
        .flex_none()
        .flex()
        .items_center()
        .rounded_full()
        .text_color(t.muted)
        .cursor(theme::clickable_cursor())
        .tooltip(crate::ui::components::tooltip(label))
}
/// Records where a face is, for the card under it.
fn measured(faces: &Rc<RefCell<HashMap<String, Bounds<Pixels>>>>, id: &str) -> impl IntoElement {
    let (faces, id) = (faces.clone(), id.to_owned());
    canvas(
        move |bounds, _, _| {
            faces.borrow_mut().insert(id, bounds);
        },
        |_, _, _, _| {},
    )
    .absolute()
    .size_full()
}

impl WindowCloud {
    /// `CloudWorkspaceHeaderTools`' Agents anchor: who is live, the stack of
    /// the ones at rest and, while nobody is here, the empty seat; the
    /// card of the face pointed at and an unanswered request's card.
    /// Nothing when the account may not manage the list and nobody is in it.
    pub(super) fn agents_control(&self, cx: &App) -> Option<AnyElement> {
        let agents = self.agents.read(cx);
        let listed = !agents.agents.is_empty() || !agents.requests.is_empty();
        let checking = !agents.known;
        let seat = !listed && (agents.manageable || checking);
        if !listed && !seat {
            return None;
        }
        let t = cx.palette();
        let size = theme::control_compact();
        let ground = t.header;
        let (live, resting) = people(&agents.agents, &agents.requests);
        let faces = self.agent_cards.faces.clone();
        let hover = |id: String| {
            let host = self.weak.clone();
            move |hovered: &bool, _: &mut Window, cx: &mut App| {
                let id = id.clone();
                let _ = host.update(cx, |s, cx| s.hover_agent(hovered.then_some(id), cx));
            }
        };
        let press = |opener: Opener| {
            let host = self.weak.clone();
            move |_: &ClickEvent, window: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| s.press_agents(opener.clone(), window, cx));
            }
        };
        let mut row = h_flex().gap(px(6.)).items_center();
        for mark in &live {
            let label = [Some(mark.name.clone()), mark.status.clone()]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" · ");
            row = row.child(
                mark_button(
                    SharedString::from(format!("cloud-workspace-agent:{}", mark.id)),
                    label,
                    t,
                )
                .relative()
                .child(agent_mark(
                    &mark.name,
                    mark.avatar.as_deref(),
                    Look {
                        size,
                        ground,
                        active: mark.active,
                        waiting: mark.waiting,
                        header: true,
                    },
                    t,
                ))
                .child(measured(&faces, &mark.id))
                .on_hover(hover(mark.id.clone()))
                .on_click(press(Opener::Agent(mark.id.clone()))),
            );
        }
        if !resting.is_empty() {
            row = row.child(self.resting_stack(&resting, size, ground, cx));
        }
        if seat {
            row = row.child(self.empty_seat(checking, cx));
        }
        let anchor = self.agents_anchor.clone();
        let mut control = div()
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
            );
        if let Some(card) = self.agent_card(cx) {
            control = control.child(card);
        }
        if let Some(card) = self.request_card(cx) {
            control = control.child(card);
        }
        Some(control.into_any_element())
    }
    /// `RestingAgents`: stacked like a pile of tokens with the first in
    /// front, and a count past three. Each face still shows its own card.
    fn resting_stack(&self, resting: &[Live], size: f32, ground: Rgba, cx: &App) -> AnyElement {
        let t = cx.palette();
        let stacked = &resting[..resting.len().min(VISIBLE_AGENT_LIMIT)];
        let overflow = resting.len() - stacked.len();
        let step = size * 0.28;
        let width = size + step * (stacked.len().saturating_sub(1)) as f32;
        let label = resting
            .iter()
            .map(|r| r.name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let faces = self.agent_cards.faces.clone();
        // Painted back to front, so the first covers the ones behind it.
        let mut pile = div().relative().w(px(width)).h(px(size)).flex_none();
        for (index, face) in stacked.iter().enumerate().rev() {
            let host = self.weak.clone();
            let id = face.id.clone();
            pile = pile.child(
                div()
                    .id(SharedString::from(format!(
                        "cloud-workspace-agent-face:{}",
                        face.id
                    )))
                    .absolute()
                    .top_0()
                    .left(px(step * index as f32))
                    .size(px(size))
                    .rounded_full()
                    // A ring of the Header's colour keeps each face apart.
                    .shadow(vec![BoxShadow {
                        color: ground.into(),
                        offset: point(px(0.), px(0.)),
                        blur_radius: px(0.),
                        spread_radius: px(1.5),
                        inset: false,
                    }])
                    .child(agent_mark(
                        &face.name,
                        face.avatar.as_deref(),
                        Look {
                            size,
                            ground,
                            active: false,
                            waiting: false,
                            header: true,
                        },
                        t,
                    ))
                    .child(measured(&faces, &face.id))
                    .on_hover(move |hovered, _, cx| {
                        let id = id.clone();
                        let _ = host.update(cx, |s, cx| s.hover_agent(hovered.then_some(id), cx));
                    }),
            );
        }
        let host = self.weak.clone();
        mark_button("cloud-workspace-agent-stack".into(), label, t)
            .gap(px(5.))
            .child(pile)
            .when(overflow > 0, |d| {
                d.child(
                    div()
                        .mr(px(2.))
                        .text_size(px(theme::ty().ui.caption))
                        .text_color(t.muted)
                        .child(tf("shell.projectReach.more", &[("count", overflow.into())])),
                )
            })
            .on_click(move |_, window, cx| {
                let _ = host.update(cx, |s, cx| s.press_agents(Opener::More, window, cx));
            })
            .into_any_element()
    }
    /// `InviteAgentTool`: an empty seat where the Agents will be. While the
    /// server says whether this person may invite, it holds its place.
    fn empty_seat(&self, checking: bool, cx: &App) -> AnyElement {
        let t = cx.palette();
        let size = theme::control_compact();
        let host = self.weak.clone();
        let label = tr(if checking {
            "shell.workspaceSwitcher.location.checking"
        } else {
            "cloud.share.agent.invite.title"
        });
        mark_button(
            "cloud-workspace-tool:invite-agent".into(),
            label.to_string(),
            t,
        )
        .when(checking, |d| d.opacity(0.7).cursor_default())
        .when(!checking, |d| {
            d.hover(|d| d.text_color(t.text))
                .on_click(move |_, window, cx| {
                    let _ = host.update(cx, |s, cx| s.press_agents(Opener::Invite, window, cx));
                })
        })
        .child(
            div()
                .size(px(size))
                .flex()
                .items_center()
                .justify_center()
                .rounded_full()
                .border_1()
                .border_dashed()
                .border_color(theme::alpha(t.muted, 0.45))
                .child(if checking {
                    Icon::new("loader-circle")
                        .with_size(px(13.))
                        .stroke(2.)
                        .spinning("cloud-agent-seat-checking")
                } else {
                    Icon::new("plus").with_size(px(13.)).stroke(2.)
                }),
        )
        .into_any_element()
    }
    /// A face was pointed at or left. The first card waits a moment, so
    /// passing over the Header shows nothing; then it follows the pointer
    /// from face to face at once.
    pub(super) fn hover_agent(&mut self, face: Option<String>, cx: &mut Context<Self>) {
        let suppressed =
            self.dialog_open(DialogKey::Agents, cx) || !self.agents.read(cx).requests.is_empty();
        let cards = &mut self.agent_cards;
        cards.timer = None;
        match face {
            Some(face) if !suppressed => {
                if cards.shown.is_some() {
                    cards.shown = Some(face);
                    cx.notify();
                } else {
                    cards.timer = Some(cx.spawn(async move |this, cx| {
                        cx.background_executor().timer(CARD_DELAY).await;
                        let _ = this.update(cx, |s, cx| {
                            s.agent_cards.shown = Some(face);
                            cx.notify();
                        });
                    }));
                }
            }
            _ => {
                if cards.shown.take().is_some() {
                    cx.notify();
                }
            }
        }
    }
    /// `CloudWorkspaceAgentCard`: an Agent at a glance under its mark —
    /// when it last worked, then the Agent, how it got in and how long it
    /// may stay. It only reads, so it never takes the pointer.
    fn agent_card(&self, cx: &App) -> Option<AnyElement> {
        let id = self.agent_cards.shown.as_ref()?;
        let anchor = *self.agent_cards.faces.borrow().get(id)?;
        let agents = self.agents.read(cx);
        let t = cx.palette();
        let ty = theme::ty().ui;
        let now = crate::clock::now_ms() / 1000;
        let (name, avatar, live, when, facts) =
            if let Some(agent) = agents.agents.iter().find(|a| &a.agent.id == id) {
                let joined = tr(match agent.agent.admission {
                    Admission::SignIn => "cloud.share.agent.detail.approved",
                    Admission::Link => "cloud.share.agent.detail.joinedByLink",
                })
                .to_string();
                let stay = match agent.agent.expires_at.as_deref().and_then(short_date) {
                    Some(date) => tf("cloud.share.agent.detail.ends", &[("date", date.into())]),
                    None => tf(
                        "cloud.share.agent.detail.since",
                        &[(
                            "date",
                            short_date(&agent.agent.connected_at)
                                .unwrap_or_default()
                                .into(),
                        )],
                    ),
                };
                (
                    agent.agent.name.clone(),
                    agent.agent.avatar.clone(),
                    agent.active,
                    agent_status(agent, now).unwrap_or_default(),
                    vec![joined, stay],
                )
            } else {
                let request = agents.requests.iter().find(|r| &r.id == id)?;
                (
                    request.name.clone(),
                    request.avatar.clone(),
                    false,
                    format!(
                        "{} · {}",
                        tr("cloud.share.agent.request.status"),
                        relative_time(&request.requested_at, now).unwrap_or_default()
                    ),
                    vec![],
                )
            };
        let ground = t.menu_bg;
        let card = v_flex()
            .id("cloud-agent-card")
            .debug_selector(|| "cloud-agent-card".into())
            .w(px(CARD_WIDTH))
            .rounded(px(12.))
            .border_1()
            .border_color(t.shell_divider)
            .bg(ground)
            .text_color(t.text)
            .shadow(card_shadow(t))
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
                    .text_color(if live { t.text } else { t.muted })
                    .when(live, |d| {
                        d.child(div().size(px(7.)).flex_none().rounded_full().bg(t.success))
                    })
                    .child(when),
            )
            .child(
                h_flex()
                    .gap(px(14.))
                    .p(px(14.))
                    .child(agent_mark(
                        &name,
                        avatar.as_deref(),
                        Look {
                            size: CARD_MARK,
                            ground,
                            active: live,
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
                                    .child(name),
                            )
                            .children(facts.into_iter().enumerate().map(|(index, fact)| {
                                div()
                                    .text_size(px(ty.caption))
                                    .line_height(px(17.))
                                    .text_color(if index == 0 { t.muted } else { t.subtle })
                                    .child(fact)
                            })),
                    ),
            );
        let center = anchor.center().x;
        let left = (f32::from(center) - CARD_WIDTH / 2.).max(8.);
        Some(
            deferred(
                Positioner::corner(Anchor::TopLeft, point(px(left), anchor.bottom() + px(6.)))
                    .margin(px(8.))
                    .child(card),
            )
            .with_priority(gpui_kit::base::POPUP_PRIORITY + 1)
            .into_any_element(),
        )
    }
    /// `CloudWorkspaceAgentRequestCard`: the oldest request, below the
    /// Header until it is answered. Nothing dismisses it — no outside
    /// press, no Escape, no hover lifetime; the server's next list removes
    /// an answered or expired request and brings the next. It does not take
    /// the editor's focus when it arrives; pressing a Header mark brings
    /// Deny into keyboard reach.
    fn request_card(&self, cx: &App) -> Option<AnyElement> {
        let agents = self.agents.read(cx);
        if !agents.manageable {
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
        let card = v_flex()
            .id("cloud-agent-request-card")
            .debug_selector(|| "cloud-agent-request-card".into())
            .occlude()
            .w(px(CARD_WIDTH))
            .rounded(px(12.))
            .border_1()
            .border_color(t.shell_divider)
            .bg(ground)
            .text_color(t.text)
            .shadow(card_shadow(t))
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
    /// A mark, the stack or the seat: the Agents open straight into their
    /// dialog. While a request waits, the press brings its Deny into
    /// keyboard reach instead, without answering it.
    pub(super) fn press_agents(
        &mut self,
        opener: Opener,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.hover_agent(None, cx);
        if !self.agents.read(cx).requests.is_empty() && self.agents.read(cx).manageable {
            self.deny_focus.focus(window, cx);
            return;
        }
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
    /// else forgets them, and their dialog goes with them. A request takes
    /// the place of the dialog, never another overlay beside it.
    pub(super) fn sync_cloud_agents(&mut self, cx: &mut Context<Self>) {
        let project = self.hosted().filter(|_| {
            !self.session().opening && !self.session().file_mode && self.cloud_enabled(cx)
        });
        let name = self.session().name.clone();
        let open = self.dialog_open(DialogKey::Agents, cx);
        self.agents.update(cx, |a, cx| {
            a.sync(project.as_deref().map(|p| (p, name.as_str())), open, cx)
        });
        let agents = self.agents.read(cx);
        let listed = !agents.agents.is_empty() || !agents.requests.is_empty();
        let pending = agents.manageable && !agents.requests.is_empty();
        let gone =
            agents.project_name().is_none() || (!listed && !agents.manageable && agents.known);
        if open && (pending || gone) {
            self.close_dialog(DialogKey::Agents, cx);
        }
        if pending || gone {
            self.agent_cards.shown = None;
            self.agent_cards.timer = None;
        }
    }
}

/// The card's shadow, as a menu's.
fn card_shadow(t: Theme) -> Vec<BoxShadow> {
    vec![
        BoxShadow {
            color: theme::alpha(t.shadow, 0.35).into(),
            offset: point(px(0.), px(2.)),
            blur_radius: px(4.),
            spread_radius: px(0.),
            inset: false,
        },
        BoxShadow {
            color: theme::alpha(t.shadow, 0.60).into(),
            offset: point(px(0.), px(12.)),
            blur_radius: px(32.),
            spread_radius: px(-6.),
            inset: false,
        },
    ]
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

    /// `CloudWorkspaceAgentPeople`: only what is live stands on its own —
    /// an Agent asking to join, then whoever is at work — at most three;
    /// everyone else is one stack.
    #[test]
    fn requests_lead_then_whoever_is_at_work_and_the_rest_rest() {
        let request = AgentRequest {
            id: "r".into(),
            name: "Codex".into(),
            avatar: None,
            admission: Admission::SignIn,
            requested_at: "2026-10-30T12:00:00Z".into(),
            expires_at: String::new(),
        };
        let agents = [
            agent("a", false),
            agent("b", true),
            agent("c", true),
            agent("d", true),
        ];
        let (live, resting) = people(&agents, &[request]);
        let ids = |marks: &[Live]| marks.iter().map(|m| m.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&live), ["r", "b", "c"]);
        assert!(live[0].waiting);
        // The one at work past three, then the ones at rest.
        assert_eq!(ids(&resting), ["d", "a"]);
        let (live, resting) = people(&[agent("a", false)], &[]);
        assert!(live.is_empty());
        assert_eq!(ids(&resting), ["a"]);
    }
}
