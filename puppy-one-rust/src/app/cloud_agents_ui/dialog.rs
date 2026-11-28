//! `CloudWorkspaceAgentsDialog`: everything about a project's Agents,
//! opened straight from the Header. Who is here, in a wrapping grid, each as
//! itself with when it last worked; an Agent asking to join among them, let
//! in where it stands; and an empty seat with a + at the end of the grid
//! that turns the dialog to inviting the next one (`invite`). An invite
//! lets one Agent in and is then spent, so there are no links to look after.
use super::*;
use crate::ui::components::Dialog;

/// The roster meets each Agent as itself, larger than in the Header.
const TILE_MARK: f32 = 48.;
/// `minmax(112px, 1fr)` with `gap: 8px 4px`.
const TILE_MIN: f32 = 112.;
const TILE_GAP: f32 = 4.;
const DIALOG_WIDTH: f32 = 500.;
/// The body's inline padding.
const INLINE: f32 = 20.;
/// The dialog's width within its body's inline padding.
const ROSTER_WIDTH: f32 = DIALOG_WIDTH - 2. * INLINE;

/// Equal seats wrap below rather than making the dialog scroll sideways.
fn columns(width: f32) -> (usize, f32) {
    let count = (((width + TILE_GAP) / (TILE_MIN + TILE_GAP)).floor() as usize).max(1);
    let tile = (width - TILE_GAP * (count - 1) as f32) / count as f32;
    (count, tile)
}

/// `agentRecency`: the tile names the Agent, so under it is only when it
/// last worked; one at work says so (in the success colour).
fn recency(agent: &WorkspaceAgent, now: i64) -> Option<String> {
    match (&agent.last_active_at, agent.active || !agent.activity_known) {
        (Some(at), false) => relative_time(at, now),
        _ => agent_status(agent, now),
    }
}

impl WindowCloud {
    pub(in crate::app) fn agents_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let agents = self.agents.read(cx);
        let host = self.weak.clone();
        let project = agents.project_name().unwrap_or_default().to_owned();
        let inviting = agents.invite_open;
        let change_failed = agents.change_failed || agents.decision_failed;
        // The title on the project's name, as the invite's mockup sets it:
        // 15px at 600 beside the name at the dialog's 13px.
        let heading = h_flex()
            .items_baseline()
            .gap(px(8.))
            .min_w_0()
            // `padding: 18px 20px 4px` on a row the 26px close button holds
            // open: the title 4px below the dialog's 14px, and the row 34px.
            .pt(px(4.))
            .pb(px(7.5))
            .child(
                div()
                    .flex_none()
                    .text_size(px(ty.body_large))
                    .line_height(px(22.5))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.text)
                    .child(tr(if inviting {
                        "native.agentInvite.title"
                    } else {
                        "cloud.share.agent.title"
                    })),
            )
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(ty.meta))
                    .text_color(t.subtle)
                    .child(project),
            );
        let body = if inviting {
            self.invite_flow(cx)
        } else {
            v_flex()
                .id("cloud-agents-roster-section")
                .debug_selector(|| "cloud-agents-roster-section".into())
                .gap(px(6.))
                .min_w_0()
                .child(self.roster(cx))
                .when(change_failed, |d| {
                    d.child(
                        div()
                            .text_size(px(ty.caption))
                            .line_height(px(16.))
                            .text_color(t.danger)
                            .child(tr("cloud.share.agent.changeFailed")),
                    )
                })
                .into_any_element()
        };
        Dialog::new("cloud-agents-dialog")
            .width(DIALOG_WIDTH)
            .heading(heading)
            .header_bottom(0.)
            .center_header()
            .body_inline(INLINE)
            .body_padding(14., 20.)
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.close_agents_dialog(w, cx));
            })
            .child(body)
    }
    /// The grid: requests first, then whoever is at work, then the ones at
    /// rest, and the invite seat last.
    fn roster(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let agents = self.agents.read(cx);
        let (_, width) = columns(ROSTER_WIDTH);
        let requests = agents.requests.clone();
        let mut sorted = agents.agents.clone();
        sorted.sort_by_key(|a| !a.active);
        let mut tiles: Vec<AnyElement> = requests
            .iter()
            .map(|r| self.asking_tile(r, width, cx))
            .collect();
        tiles.extend(sorted.iter().map(|a| self.agent_tile(a, width, cx)));
        tiles.push(self.invite_seat(width, cx));
        div()
            .w(px(ROSTER_WIDTH))
            .pb(px(4.))
            .flex()
            .flex_wrap()
            .gap_x(px(TILE_GAP))
            .gap_y(px(8.))
            .children(tiles)
    }
    /// `.desktop-cloud-agent-tile`.
    fn tile(id: SharedString, width: f32) -> Stateful<Div> {
        let group = id.to_string();
        v_flex()
            .id(id.clone())
            .debug_selector(move || id.to_string())
            .group(group)
            .relative()
            .w(px(width))
            .flex_none()
            .items_center()
            .gap(px(2.))
            .px(px(8.))
            .pt(px(12.))
            .pb(px(10.))
            .rounded(px(12.))
    }
    fn tile_name(name: String, t: Theme) -> Div {
        div()
            .max_w_full()
            .text_center()
            .text_size(px(theme::ty().ui.caption))
            .line_height(px(16.))
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.text)
            .line_clamp(2)
            .child(name)
    }
    /// `AgentTile`: its mark, its name and when it last worked. Removing
    /// asks once, on the tile itself, so a slip never takes an Agent out.
    fn agent_tile(&self, agent: &WorkspaceAgent, width: f32, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let agents = self.agents.read(cx);
        let id = agent.agent.id.clone();
        let confirming = agents.confirming.as_deref() == Some(id.as_str());
        let removing = agents.removing.as_deref() == Some(id.as_str());
        let ground = t.overlay;
        let group = format!("cloud-agent-row:{id}");
        let entity = self.agents.clone();
        let mut tile = Self::tile(group.clone().into(), width)
            .when(!confirming, |d| d.hover(|d| d.bg(t.hover)))
            .when(confirming, |d| {
                d.bg(theme::alpha(t.danger, 0.08))
                    .border_1()
                    .border_color(theme::alpha(t.danger, 0.35))
            })
            .child(div().mb(px(6.)).child(agent_mark(
                &agent.agent.name,
                agent.agent.avatar.as_deref(),
                Look {
                    size: TILE_MARK,
                    ground,
                    active: agent.active,
                    waiting: false,
                    header: false,
                },
                t,
            )))
            .child(Self::tile_name(agent.agent.name.clone(), t));
        let label = format!("{} {}", tr("cloud.share.agent.remove"), agent.agent.name);
        if confirming {
            let keep = entity.clone();
            let remove = entity.clone();
            let target = id.clone();
            tile = tile.child(
                h_flex()
                    .flex_wrap()
                    .justify_center()
                    .gap(px(4.))
                    .mt(px(6.))
                    .child(
                        Button::new(SharedString::from(format!("cloud-agent-keep:{id}")))
                            .variant(ButtonVariant::Ghost)
                            .label(tr("cloud.share.agent.keep"))
                            .disabled(removing)
                            .on_click(move |_, _, cx| {
                                keep.update(cx, |a, cx| a.confirm_remove(None, cx))
                            }),
                    )
                    .child(
                        Button::new(SharedString::from(format!(
                            "cloud-agent-remove-confirm:{id}"
                        )))
                        .variant(ButtonVariant::SolidDanger)
                        .label(tr("cloud.share.agent.remove"))
                        .accessibility_label(label)
                        .disabled(removing)
                        .on_click(move |_, _, cx| remove.update(cx, |a, cx| a.remove(&target, cx))),
                    ),
            );
        } else {
            let recency = recency(agent, crate::clock::now_ms() / 1000);
            let confirm = entity.clone();
            let target = id.clone();
            tile = tile
                .children(recency.map(|state| {
                    div()
                        .max_w_full()
                        .truncate()
                        .text_size(px(ty.micro))
                        .line_height(px(14.))
                        .text_color(if agent.active { t.success } else { t.subtle })
                        .child(state)
                }))
                .child(
                    div()
                        .id(SharedString::from(format!("cloud-agent-remove:{id}")))
                        .debug_selector({
                            let id = id.clone();
                            move || format!("cloud-agent-remove:{id}")
                        })
                        .absolute()
                        .top(px(6.))
                        .right(px(6.))
                        .size(px(20.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded_full()
                        .bg(theme::alpha(t.text, 0.10))
                        .text_color(t.muted)
                        .opacity(0.)
                        .group_hover(group, |d| d.opacity(1.))
                        .hover(|d| d.text_color(t.danger))
                        .cursor(theme::clickable_cursor())
                        .tooltip(crate::ui::components::tooltip(label))
                        .child(Icon::new("x").with_size(px(12.)).stroke(2.2))
                        .on_click(move |_, _, cx| {
                            confirm.update(cx, |a, cx| a.confirm_remove(Some(target.clone()), cx))
                        }),
                );
        }
        tile.into_any_element()
    }
    /// `AgentAskingTile`: an Agent asking to join, in the row with the
    /// others, answered where it stands.
    fn asking_tile(
        &self,
        request: &AgentRequest,
        width: f32,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let deciding = self.agents.read(cx).deciding.contains(&request.id);
        let answer = |allow: bool| {
            let entity = self.agents.clone();
            let id = request.id.clone();
            move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                entity.update(cx, |a, cx| a.decide(&id, allow, cx));
            }
        };
        Self::tile(format!("cloud-agent-request:{}", request.id).into(), width)
            .bg(theme::alpha(t.accent, 0.07))
            .child(div().mb(px(6.)).child(agent_mark(
                &request.name,
                request.avatar.as_deref(),
                Look {
                    size: TILE_MARK,
                    ground: t.overlay,
                    active: false,
                    waiting: true,
                    header: false,
                },
                t,
            )))
            .child(Self::tile_name(request.name.clone(), t))
            .child(
                div()
                    .text_size(px(ty.micro))
                    .line_height(px(14.))
                    .text_color(t.subtle)
                    .child(tr("cloud.share.agent.request.status")),
            )
            .child(
                h_flex()
                    .flex_wrap()
                    .justify_center()
                    .gap(px(4.))
                    .mt(px(6.))
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
                        .on_click(answer(false)),
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
                        .on_click(answer(true)),
                    ),
            )
            .into_any_element()
    }
    /// `AgentInviteSeat`: the empty seat at the end of the row; pressing it
    /// turns the dialog to the invite.
    fn invite_seat(&self, width: f32, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let start = self.agents.clone();
        Self::tile("cloud-agent-invite-seat".into(), width)
            .hover(|d| d.bg(theme::alpha(t.accent, 0.08)))
            .cursor(theme::clickable_cursor())
            .child(
                div()
                    .relative()
                    .mb(px(6.))
                    .size(px(TILE_MARK))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .border(px(1.5))
                    .border_dashed()
                    .border_color(theme::alpha(t.accent, 0.7))
                    .bg(theme::alpha(t.accent, 0.08))
                    .text_color(t.accent_text)
                    .child(Icon::new("plus").with_size(px(20.)).stroke(1.75)),
            )
            .child(
                div()
                    .text_size(px(theme::ty().ui.caption))
                    .line_height(px(16.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.accent_text)
                    .child(tr("cloud.share.agent.invite.seat")),
            )
            .on_click(move |_, _, cx| start.update(cx, |a, cx| a.start_invite(cx)))
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn seats_wrap_in_equal_columns() {
        assert_eq!(columns(ROSTER_WIDTH).0, 4);
        let (count, tile) = columns(ROSTER_WIDTH);
        assert!((tile * count as f32 + TILE_GAP * (count - 1) as f32 - ROSTER_WIDTH).abs() < 0.01);
        assert_eq!(columns(100.).0, 1);
    }

    /// `agentRecency`: under a tile's name, "Working now" for the one at
    /// work, else only how long ago it last worked, or that it has not.
    #[test]
    fn a_tile_says_only_when_its_agent_last_worked() {
        let now = 1_793_361_600; // 2026-10-30T12:00:00Z
        let tile = |active: bool, last: Option<&str>, known: bool| WorkspaceAgent {
            agent: crate::workspace::cloud::agents::ConnectedAgent {
                id: "c1".into(),
                name: "Codex".into(),
                avatar: None,
                admission: Admission::SignIn,
                grant_id: "g1".into(),
                connected_at: String::new(),
                expires_at: None,
            },
            active,
            last_active_at: last.map(str::to_owned),
            activity_known: known,
        };
        assert_eq!(
            recency(&tile(true, Some("2026-10-30T11:59:00Z"), true), now).as_deref(),
            Some("Working now")
        );
        assert_eq!(
            recency(&tile(false, Some("2026-10-30T10:00:00Z"), true), now).as_deref(),
            Some("2 hours ago")
        );
        assert_eq!(
            recency(&tile(false, None, true), now).as_deref(),
            Some("No recent work")
        );
        assert_eq!(recency(&tile(false, None, false), now), None);
    }
}
