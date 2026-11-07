//! The dialog's frame: its navigation, the section's heading and the
//! content it routes to.
use super::*;

impl CloudServices {
    pub(super) fn navigation(&self, t: Theme, cx: &mut Context<Self>) -> impl IntoElement {
        let ty = theme::ty().ui;
        let active = match self.section.nav() {
            Section::Share if !self.share => Section::Contents,
            other => other,
        };
        let mut nav = v_flex()
            .id("cloud-services-navigation")
            .w(px(208.))
            .h_full()
            .flex_shrink_0()
            .p(px(8.))
            .gap(px(2.))
            .border_r_1()
            .border_color(t.divider);
        let groups = [
            ("cloud.sidebar.projectGroup", {
                let mut entries = vec![(Section::Contents, Icon::product(ProductIcon::Home))];
                if self.share {
                    entries.push((Section::Share, Icon::new("share-2")));
                }
                entries
            }),
            (
                "cloud.sidebar.connectionsGroup",
                vec![
                    // `McpLogoIcon`, the protocol's own mark.
                    (Section::Mcp, Icon::new("mcp-logo")),
                    (Section::Cli, Icon::new("square-terminal")),
                ],
            ),
            ("cloud.sidebar.organizationGroup", {
                let mut entries = vec![(Section::Team, Icon::new("users"))];
                if crate::features::flags::CLOUD_BILLING {
                    entries.push((Section::Billing, Icon::new("credit-card")));
                }
                entries
            }),
        ];
        for (group, entries) in groups {
            nav = nav.child(
                div()
                    .px(px(8.))
                    .pt(px(10.))
                    .pb(px(4.))
                    .text_size(px(ty.caption))
                    .text_color(t.subtle)
                    .child(tr(group)),
            );
            for (section, icon) in entries {
                let selected = section == active;
                nav = nav.child(
                    h_flex()
                        .id(SharedString::from(format!("cloud-nav-{}", section.route())))
                        .h(px(30.))
                        .px(px(8.))
                        .gap(px(8.))
                        .rounded(px(6.))
                        .text_size(px(ty.meta))
                        .text_color(if selected { t.text } else { t.muted })
                        .when(selected, |d| d.bg(t.selected))
                        .hover(|d| d.bg(t.hover))
                        .on_click(cx.listener(move |s, _, _, cx| s.select(section, cx)))
                        .child(icon.with_size(px(14.)))
                        .child(if section == Section::Share {
                            tr("cloud.share.location.shareAction").to_owned()
                        } else {
                            tr(&format!("cloud.route.{}.label", section.route())).to_owned()
                        }),
                );
            }
        }
        nav
    }
    pub(super) fn content(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let notice = self.notice.clone().map(|text| {
            div()
                .text_size(px(theme::ty().ui.caption))
                .text_color(t.muted)
                .child(text)
                .into_any_element()
        });
        let page = match self.section {
            Section::Contents => self.contents(t, cx),
            Section::History => self.history(t, cx),
            Section::Settings => self.settings(t, cx),
            Section::Team => self.team(t, cx),
            Section::Share => self.share_page(t, cx),
            Section::Billing => self.billing_view(t, cx),
            _ => self.access(t, cx),
        };
        v_flex()
            .gap(px(16.))
            .children(notice)
            .child(page)
            .into_any_element()
    }
    pub(super) fn heading(&self, t: Theme) -> Div {
        let ty = theme::ty().ui;
        v_flex()
            .gap(px(4.))
            .child(
                div()
                    .text_size(px(ty.body + 2.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.text)
                    .child(self.section.title()),
            )
            .child(
                div()
                    .text_size(px(ty.meta))
                    .text_color(t.muted)
                    .child(self.section.description()),
            )
    }
    pub(super) fn back(&self, t: Theme, cx: &mut Context<Self>) -> impl IntoElement {
        h_flex().child(
            Button::new("cloud-back")
                .variant(ButtonVariant::Secondary)
                .icon(Icon::new("arrow-left").with_size(px(13.)).color(t.muted))
                .label(tr("cloud.route.contents.label"))
                .on_click(cx.listener(|s, _, _, cx| s.select(Section::Contents, cx))),
        )
    }
    pub(super) fn loading_row(&self, t: Theme) -> AnyElement {
        div()
            .text_size(px(theme::ty().ui.meta))
            .text_color(t.muted)
            .child(tr("cloud.common.loading"))
            .into_any_element()
    }
}
