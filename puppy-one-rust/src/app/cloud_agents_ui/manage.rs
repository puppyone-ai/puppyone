//! Manage Agents: the dialog that lists the Project's Agents and their
//! actions.
use super::*;

impl WindowCloud {
    /// `CloudWorkspaceAgentsDialog`: everything that can be changed about
    /// who is in a project, in one place.
    pub(in crate::app) fn manage_agents_dialog(&self, cx: &App) -> Dialog {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let agents = self.agents.read(cx);
        let entity = self.agents.clone();
        let host = self.weak.clone();
        let now = crate::clock::now_ms() / 1000;
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
                    known.and_then(|a| agent_status(a, now)),
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
pub(in crate::app) fn row_action(
    id: &'static str,
    icon: &'static str,
    label: String,
    t: Theme,
) -> Stateful<Div> {
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
