//! `CloudWorkspaceAgentsDialog`: everything about a project's Agents,
//! opened straight from the Header. Who is here, in a wrapping grid, each as
//! itself with when it last worked; an Agent asking to join among them, let
//! in where it stands; and an empty seat with a + at the end of the grid
//! that invites the next one (`CloudWorkspaceAgentInvite`). An invite lets
//! one Agent in and is then spent, so there are no links to look after.
use super::*;
use crate::features::cloud::CopyStatus;
use crate::ui::components::Dialog;
use crate::workspace::cloud::agents::INVITABLE;

/// The roster meets each Agent as itself, larger than in the Header.
const TILE_MARK: f32 = 48.;
/// `minmax(112px, 1fr)` with `gap: 8px 4px`.
const TILE_MIN: f32 = 112.;
const TILE_GAP: f32 = 4.;
const DIALOG_WIDTH: f32 = 560.;
/// The dialog's width within its body's inline padding.
const ROSTER_WIDTH: f32 = DIALOG_WIDTH - 2. * 20.;

/// Equal seats wrap below rather than making the dialog scroll sideways.
fn columns(width: f32) -> (usize, f32) {
    let count = (((width + TILE_GAP) / (TILE_MIN + TILE_GAP)).floor() as usize).max(1);
    let tile = (width - TILE_GAP * (count - 1) as f32) / count as f32;
    (count, tile)
}

impl WindowCloud {
    pub(in crate::app) fn agents_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let agents = self.agents.read(cx);
        let host = self.weak.clone();
        let project = agents.project_name().unwrap_or_default().to_owned();
        let nobody = agents.agents.is_empty() && agents.requests.is_empty();
        let invite_open = agents.invite_open;
        let copy = agents.copy;
        let change_failed = agents.change_failed || agents.decision_failed;
        let heading = h_flex()
            .items_baseline()
            .gap(px(10.))
            .min_w_0()
            .child(
                div()
                    .flex_none()
                    .text_size(px(ty.control))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(tr("cloud.share.agent.title")),
            )
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(ty.meta))
                    .text_color(t.muted)
                    .child(project),
            );
        let roster = if nobody {
            self.first_invite(cx).into_any_element()
        } else {
            self.roster(cx).into_any_element()
        };
        let alert = |text: &'static str| {
            div()
                .text_size(px(ty.caption))
                .line_height(px(16.))
                .text_color(t.danger)
                .child(tr(text))
        };
        let fold = self.agents.clone();
        Dialog::new("cloud-agents-dialog")
            .width(DIALOG_WIDTH)
            .heading(heading)
            .body_padding(4., 18.)
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.close_agents_dialog(w, cx));
            })
            .child(
                v_flex()
                    .id("cloud-agents-roster-section")
                    .debug_selector(|| "cloud-agents-roster-section".into())
                    .gap(px(6.))
                    .min_w_0()
                    // A press anywhere but the seat and the steps folds them.
                    .on_mouse_down(MouseButton::Left, move |_, _, cx| {
                        fold.update(cx, |a, cx| {
                            if a.invite_open && a.agents.len() + a.requests.len() > 0 {
                                a.close_invite(cx)
                            }
                        });
                    })
                    .child(roster)
                    .when(invite_open, |d| d.child(self.invite_steps(cx)))
                    .when(copy == CopyStatus::Failed, |d| {
                        d.child(alert("cloud.share.agent.failed"))
                    })
                    .when(copy == CopyStatus::NotOwner, |d| {
                        d.child(alert("cloud.share.agent.notOwner"))
                    })
                    .when(change_failed, |d| {
                        d.child(alert("cloud.share.agent.changeFailed"))
                    }),
            )
    }
    /// `AgentFirstInvite`: with nobody here yet, the seat is the whole
    /// page, with one line on what it does.
    fn first_invite(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let open = self.agents.read(cx).invite_open;
        let seat = self.invite_seat_bounds.clone();
        let toggle = self.agents.clone();
        h_flex()
            .gap(px(18.))
            .pt(px(6.))
            .px(px(2.))
            .pb(px(2.))
            .child(
                div()
                    .id("cloud-agent-invite-seat")
                    .debug_selector(|| "cloud-agent-invite-seat".into())
                    .relative()
                    .size(px(64.))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .border(px(1.5))
                    .when(!open, |d| d.border_dashed())
                    .border_color(theme::alpha(t.accent, 0.7))
                    .bg(theme::alpha(t.accent, if open { 0.14 } else { 0.08 }))
                    .text_color(t.accent_text)
                    .cursor(theme::clickable_cursor())
                    .child(Icon::new("plus").with_size(px(28.)).stroke(1.5))
                    .child(
                        canvas(move |bounds, _, _| seat.set(bounds), |_, _, _, _| {})
                            .absolute()
                            .size_full(),
                    )
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_click(move |_, _, cx| toggle.update(cx, |a, cx| a.toggle_invite(cx))),
            )
            .child(
                v_flex()
                    .flex_1()
                    .gap(px(2.))
                    .min_w_0()
                    .child(
                        div()
                            .text_size(px(ty.control))
                            .line_height(px(20.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t.text)
                            .child(tr("cloud.share.agent.invite.first")),
                    )
                    .child(
                        div()
                            .text_size(px(ty.meta))
                            .line_height(px(18.))
                            .text_color(t.muted)
                            .child(tr("cloud.share.agent.invite.firstDescription")),
                    ),
            )
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
            let now = crate::clock::now_ms() / 1000;
            // `agentRecency`: the tile names the Agent, so under it is only
            // when it last worked; one at work says so in the success colour.
            let recency = match (&agent.last_active_at, agent.active || !agent.activity_known) {
                (Some(at), false) => relative_time(at, now),
                _ => agent_status(agent, now),
            };
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
    /// shows how to invite.
    fn invite_seat(&self, width: f32, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let open = self.agents.read(cx).invite_open;
        let seat = self.invite_seat_bounds.clone();
        let toggle = self.agents.clone();
        Self::tile("cloud-agent-invite-seat".into(), width)
            .when(open, |d| d.bg(theme::alpha(t.accent, 0.08)))
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
                    .when(!open, |d| d.border_dashed())
                    .border_color(theme::alpha(t.accent, 0.7))
                    .bg(theme::alpha(t.accent, if open { 0.14 } else { 0.08 }))
                    .text_color(t.accent_text)
                    .child(Icon::new("plus").with_size(px(20.)).stroke(1.75))
                    .child(
                        canvas(move |bounds, _, _| seat.set(bounds), |_, _, _, _| {})
                            .absolute()
                            .size_full(),
                    ),
            )
            .child(
                div()
                    .text_size(px(theme::ty().ui.caption))
                    .line_height(px(16.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.accent_text)
                    .child(tr("cloud.share.agent.invite.seat")),
            )
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(move |_, _, cx| toggle.update(cx, |a, cx| a.toggle_invite(cx)))
            .into_any_element()
    }
    /// `AgentInviteSteps`: one step at a time, pointing at the seat that
    /// was pressed. First the prompt and the button that copies it; once
    /// copied, the one thing left to do, with the drawing of doing it.
    fn invite_steps(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let agents = self.agents.read(cx);
        let copied = agents.copy == CopyStatus::Copied;
        let copying = agents.copy == CopyStatus::Copying;
        let prompt = agents.prompt().unwrap_or_default();
        let ground = theme::mix(t.text, t.menu_bg, 0.05);
        // Where the seat is, so the steps point at what was pressed.
        let seat = self.invite_seat_bounds.get().center().x;
        let number = |n: usize, done: bool| {
            div()
                .size(px(20.))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded_full()
                .text_size(px(ty.micro))
                .font_weight(FontWeight::SEMIBOLD)
                .map(|d| {
                    if done {
                        d.bg(theme::alpha(t.success, 0.16))
                            .text_color(t.success)
                            .child(Icon::new("check").with_size(px(12.)).stroke(2.6))
                    } else {
                        d.bg(t.accent)
                            .text_color(t.text_inverse)
                            .child(n.to_string())
                    }
                })
        };
        let text = || {
            v_flex()
                .gap(px(8.))
                .min_w_0()
                .flex_1()
                .text_size(px(ty.meta))
                .line_height(px(20.))
                .text_color(t.text)
        };
        let copy = self.agents.clone();
        let copy_button = Button::new("cloud-agent-share-copy")
            .variant(if copied {
                ButtonVariant::Success
            } else {
                ButtonVariant::FilledPrimary
            })
            .icon(Icon::new(if copied { "check" } else { "copy" }).with_size(px(13.)))
            .label(tr(match agents.copy {
                CopyStatus::Copying => "cloud.common.copying",
                CopyStatus::Copied => "cloud.share.action.copied",
                _ => "cloud.share.action.copy",
            }))
            .disabled(copying)
            .on_click(move |_, _, cx| copy.update(cx, |a, cx| a.copy_invite(cx)));
        let step_one = h_flex()
            .items_start()
            .gap(px(10.))
            .child(number(1, copied))
            .child(
                text()
                    .child(tr("cloud.share.agent.invite.step.copy"))
                    .child(
                        h_flex()
                            .items_end()
                            .gap(px(12.))
                            .py(px(10.))
                            .pl(px(12.))
                            .pr(px(10.))
                            .rounded(px(8.))
                            .bg(t.menu_bg)
                            .child(
                                div()
                                    .id("cloud-agent-invite-prompt")
                                    .debug_selector(|| "cloud-agent-invite-prompt".into())
                                    .flex_1()
                                    .min_w_0()
                                    .font_family("Geist Mono")
                                    .text_size(px(ty.micro))
                                    .line_height(px(17.))
                                    .text_color(t.muted)
                                    .child(prompt),
                            )
                            .child(div().flex_none().child(copy_button)),
                    ),
            );
        let step_two = copied.then(|| {
            let logos = INVITABLE
                .iter()
                .filter_map(|id| agent_brands::get(id))
                .map(|brand| {
                    div()
                        .size(px(26.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded_full()
                        .border_1()
                        .border_color(t.shell_divider)
                        .bg(t.menu_bg)
                        .overflow_hidden()
                        .child(agent_brands::image(brand, t.dark, 26. * 0.64))
                });
            h_flex()
                .items_start()
                .gap(px(10.))
                .child(number(2, false))
                .child(
                    h_flex()
                        .items_start()
                        .gap(px(16.))
                        .flex_1()
                        .min_w_0()
                        .child(
                            text()
                                .child(tr("cloud.share.agent.invite.step.paste"))
                                .child(h_flex().flex_wrap().gap(px(6.)).children(logos)),
                        )
                        .child(paste_art::drawing(t)),
                )
        });
        div()
            .id("cloud-agent-invite-steps")
            .debug_selector(|| "cloud-agent-invite-steps".into())
            .relative()
            .mt(px(4.))
            .rounded(px(12.))
            .border_1()
            .border_color(t.shell_divider)
            .bg(ground)
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            // The point under the seat that was pressed, over the top edge.
            .child(
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, _| {
                        let x = seat.clamp(bounds.left() + px(16.), bounds.right() - px(16.));
                        let y = bounds.origin.y - px(1.);
                        let mut fill = PathBuilder::fill();
                        fill.move_to(point(x - px(7.), y + px(0.5)));
                        fill.line_to(point(x, y - px(6.5)));
                        fill.line_to(point(x + px(7.), y + px(0.5)));
                        fill.close();
                        if let Ok(path) = fill.build() {
                            window.paint_path(path, ground);
                        }
                        let mut edge = PathBuilder::stroke(px(1.));
                        edge.move_to(point(x - px(7.), y));
                        edge.line_to(point(x, y - px(7.)));
                        edge.line_to(point(x + px(7.), y));
                        if let Ok(path) = edge.build() {
                            window.paint_path(path, t.shell_divider);
                        }
                    },
                )
                .absolute()
                .size_full(),
            )
            .child(
                v_flex()
                    .px(px(14.))
                    .py(px(12.))
                    .gap(px(14.))
                    .child(step_one)
                    .children(step_two),
            )
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
}
