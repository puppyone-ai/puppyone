//! Settings and Team, with the organization chooser.
use super::*;

impl CloudServices {
    pub(super) fn settings(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let Some(details) = self.details.clone() else {
            return self.loading_row(t);
        };
        let project = details.project.clone().unwrap_or_default();
        if !project.can("project.settings.manage") {
            return v_flex()
                .gap(px(8.))
                .child(self.back(t, cx))
                .child(
                    div()
                        .text_size(px(ty.meta))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.text)
                        .child(tr("cloud.settings.restrictedTitle")),
                )
                .child(
                    div()
                        .text_size(px(ty.caption))
                        .text_color(t.muted)
                        .child(tr("cloud.settings.restrictedDetail")),
                )
                .into_any_element();
        }
        let field = |label: &str, input: Entity<TextInput>| {
            v_flex()
                .gap(px(4.))
                .child(
                    div()
                        .text_size(px(ty.caption))
                        .text_color(t.muted)
                        .child(tr(label)),
                )
                .child(input)
        };
        let visibility = project.visibility.as_deref().unwrap_or("org");
        let id = project.id.clone();
        let remote = details.identity.as_ref().map(|i| i.url.clone());
        v_flex()
            .gap(px(12.))
            .child(self.back(t, cx))
            .child(self.heading(t))
            .child(field("cloud.common.name", self.name.clone()))
            .child(field(
                "cloud.settings.description",
                self.description.clone(),
            ))
            .child(field("cloud.git.branch", self.branch.clone()))
            .child(
                div()
                    .text_size(px(ty.caption))
                    .text_color(t.muted)
                    .child(tr("cloud.settings.branchHelp")),
            )
            .child(
                h_flex().justify_end().child(
                    Button::new("cloud-settings-save")
                        .variant(ButtonVariant::Solid)
                        .label(tr(if self.busy {
                            "cloud.common.saving"
                        } else {
                            "cloud.common.saveChanges"
                        }))
                        .disabled(self.busy)
                        .on_click(cx.listener(|s, _, _, cx| s.save_general(cx))),
                ),
            )
            .child(
                div()
                    .text_size(px(ty.meta))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.text)
                    .child(tr("cloud.settings.visibilityTitle")),
            )
            .child(
                h_flex()
                    .gap(px(6.))
                    .child(
                        Button::new("cloud-visibility-org")
                            .variant(if visibility == "org" {
                                ButtonVariant::Solid
                            } else {
                                ButtonVariant::Secondary
                            })
                            .label(tr("cloud.settings.visibilityOrganization"))
                            .disabled(self.busy || visibility == "org")
                            .on_click(cx.listener(|s, _, _, cx| s.set_visibility("org", cx))),
                    )
                    .child(
                        Button::new("cloud-visibility-private")
                            .variant(if visibility == "private" {
                                ButtonVariant::Solid
                            } else {
                                ButtonVariant::Secondary
                            })
                            .label(tr("cloud.settings.visibilityPrivate"))
                            .disabled(self.busy || visibility == "private")
                            .on_click(cx.listener(|s, _, _, cx| s.set_visibility("private", cx))),
                    ),
            )
            .child(
                h_flex()
                    .gap(px(8.))
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .text_size(px(ty.caption))
                                    .text_color(t.muted)
                                    .child(tr("cloud.project.id")),
                            )
                            .child(
                                div()
                                    .text_size(px(ty.caption))
                                    .font_family("Geist Mono")
                                    .text_color(t.text)
                                    .child(id.clone()),
                            ),
                    )
                    .child(
                        Button::new("cloud-copy-id")
                            .variant(ButtonVariant::Secondary)
                            .label(tr("cloud.common.copyValue"))
                            .on_click(cx.listener(move |s, _, _, cx| s.copy(id.clone(), cx))),
                    ),
            )
            .children(remote.map(|url| {
                v_flex()
                    .child(
                        div()
                            .text_size(px(ty.caption))
                            .text_color(t.muted)
                            .child(tr("cloud.overview.repositoryRemote")),
                    )
                    .child(
                        div()
                            .text_size(px(ty.caption))
                            .font_family("Geist Mono")
                            .text_color(t.text)
                            .child(url),
                    )
            }))
            .into_any_element()
    }
    /// `CloudOrganizationSelector`: only when there is a choice to make.
    pub(super) fn organization_chooser(&self, cx: &mut Context<Self>) -> Option<Div> {
        (self.team.organizations.len() > 1).then(|| {
            let selected = self.team.selected.clone();
            let buttons: Vec<_> = self
                .team
                .organizations
                .iter()
                .enumerate()
                .map(|(index, org)| {
                    let id = org.id.clone();
                    Button::new(("cloud-org", index))
                        .variant(if selected.as_deref() == Some(org.id.as_str()) {
                            ButtonVariant::Solid
                        } else {
                            ButtonVariant::Secondary
                        })
                        .label(org.name.clone())
                        .on_click(
                            cx.listener(move |s, _, _, cx| s.select_organization(id.clone(), cx)),
                        )
                })
                .collect();
            h_flex().gap(px(6.)).children(buttons)
        })
    }
    pub(super) fn team(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let team = self.team.clone();
        let web = account::environment(cx).map(|e| e.web().to_owned());
        let mut page = v_flex().gap(px(12.)).child(self.heading(t));
        page = page.children(self.organization_chooser(cx));
        let invite = Button::new("cloud-invite")
            .variant(ButtonVariant::Solid)
            .icon(Icon::new("mail").with_size(px(14.)))
            .label(tr("cloud.team.inviteMember"))
            .disabled(team.selected.is_none())
            .on_click(move |_, _, cx| {
                if let Some(web) = &web {
                    cx.open_url(&format!("{}/team", web.trim_end_matches('/')));
                }
            });
        page = page.child(h_flex().justify_end().child(invite));
        if team.failed {
            return page
                .child(
                    div()
                        .text_size(px(ty.meta))
                        .text_color(t.danger)
                        .child(tr("cloud.team.loadFailed")),
                )
                .into_any_element();
        }
        if team.loading {
            return page.child(self.loading_row(t)).into_any_element();
        }
        if let (Some(entitlements), Some(seats)) = (&team.entitlements, &team.seats) {
            page = page.child(
                div()
                    .text_size(px(ty.caption))
                    .text_color(t.muted)
                    .child(tf(
                        "cloud.team.seatsUsed",
                        &[
                            ("used", (seats.billable_seat_quantity as i64).into()),
                            ("limit", (entitlements.seat_quantity as i64).into()),
                            ("plan", entitlements.plan_id.clone().into()),
                        ],
                    )),
            );
        }
        page.children(team.members.iter().map(|member| {
            let name = member
                .display_name
                .clone()
                .or_else(|| member.email.clone())
                .unwrap_or_else(|| tr("cloud.team.cloudUser").to_owned());
            h_flex()
                .h(px(32.))
                .gap(px(8.))
                .text_size(px(ty.meta))
                .text_color(t.text)
                .child(div().flex_1().min_w_0().child(name))
                .child(div().text_size(px(ty.caption)).text_color(t.muted).child(
                    match member.role.as_str() {
                        "owner" => tr("cloud.team.role.owner"),
                        "member" => tr("cloud.team.role.member"),
                        "viewer" => tr("cloud.team.role.viewer"),
                        _ => "",
                    },
                ))
        }))
        .into_any_element()
    }
}
