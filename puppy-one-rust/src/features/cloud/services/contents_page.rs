//! The Homepage section: the Project's contents and its services.
use super::*;

impl CloudServices {
    pub(super) fn contents(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let Some(details) = self.details.clone() else {
            return self.loading_row(t);
        };
        let id = self.project.clone().unwrap_or_default();
        let name = details
            .project
            .as_ref()
            .map_or(id.clone(), |p| p.name.clone());
        let manage = details
            .project
            .as_ref()
            .is_some_and(|p| p.can("project.settings.manage"));
        let rows = details.rows(&id, Catalog::All);
        let (_, active) = access::metrics(&rows);
        let storage = details
            .dashboard
            .as_ref()
            .and_then(|d| d.nodes.storage_bytes)
            .map_or("—".to_owned(), format_bytes);
        let updated = latest_update(&details).unwrap_or_else(|| "—".into());
        let fact = |id: &'static str, label: &str, value: String| {
            v_flex()
                .id(id)
                .gap(px(2.))
                .px(px(10.))
                .py(px(6.))
                .rounded(px(6.))
                .hover(|d| d.bg(t.hover))
                .child(
                    div()
                        .text_size(px(ty.caption))
                        .text_color(t.subtle)
                        .child(tr(label)),
                )
                .child(
                    div()
                        .text_size(px(ty.meta))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.text)
                        .child(value),
                )
        };
        let card = |id: &'static str,
                    title: &str,
                    detail: &str,
                    section: Section,
                    cx: &mut Context<Self>| {
            v_flex()
                .id(id)
                .flex_1()
                .min_w_0()
                .gap(px(4.))
                .p(px(12.))
                .border_1()
                .border_color(t.border)
                .rounded(px(8.))
                .hover(|d| d.bg(t.hover))
                .on_click(cx.listener(move |s, _, _, cx| s.select(section, cx)))
                .child(
                    div()
                        .text_size(px(ty.meta))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.text)
                        .child(tr(title)),
                )
                .child(
                    div()
                        .text_size(px(ty.caption))
                        .text_color(t.muted)
                        .child(tr(detail)),
                )
        };
        let mut entries: Vec<services::TreeEntry> = details
            .tree
            .as_ref()
            .map(|tree| tree.entries.clone())
            .unwrap_or_default();
        entries.sort_by(|a, b| {
            (a.kind != "folder")
                .cmp(&(b.kind != "folder"))
                .then_with(|| a.name.cmp(&b.name))
        });
        let list = v_flex().children(entries.into_iter().take(50).enumerate().map(|(i, entry)| {
            h_flex()
                .id(("cloud-entry", i))
                .h(px(28.))
                .gap(px(8.))
                .text_size(px(ty.meta))
                .text_color(t.text)
                .child(
                    (if entry.kind == "folder" {
                        Icon::product(ProductIcon::Folder)
                    } else {
                        Icon::new("file")
                    })
                    .with_size(px(14.))
                    .color(t.muted),
                )
                .child(entry.name)
        }));
        v_flex()
            .gap(px(16.))
            .child(
                h_flex()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_size(px(ty.body + 4.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t.text)
                            .child(name),
                    )
                    .when(manage, |h| {
                        h.child(
                            Button::new("cloud-open-settings")
                                .variant(ButtonVariant::Secondary)
                                .icon(Icon::new("settings").with_size(px(13.)).color(t.muted))
                                .accessibility_label(tr("cloud.route.settings.title"))
                                .on_click(
                                    cx.listener(|s, _, _, cx| s.select(Section::Settings, cx)),
                                ),
                        )
                    })
                    .child(
                        Button::new("cloud-refresh")
                            .variant(ButtonVariant::Secondary)
                            .icon(Icon::new("refresh-cw").with_size(px(13.)).color(t.muted))
                            .accessibility_label(tr("cloud.common.refresh"))
                            .on_click(cx.listener(|s, _, _, cx| s.refresh(cx))),
                    ),
            )
            .child(
                h_flex()
                    .gap(px(8.))
                    .child(fact(
                        "cloud-fact-storage",
                        "cloud.overview.storageUsed",
                        storage,
                    ))
                    .child(
                        fact("cloud-fact-updated", "cloud.overview.lastUpdated", updated)
                            .on_click(cx.listener(|s, _, _, cx| s.select(Section::History, cx))),
                    )
                    .child(
                        fact(
                            "cloud-fact-connections",
                            "cloud.overview.activeConnections",
                            active.to_string(),
                        )
                        .on_click(cx.listener(|s, _, _, cx| s.select(Section::Access, cx))),
                    ),
            )
            .when(details.failed, |d| {
                d.child(
                    h_flex()
                        .gap(px(8.))
                        .child(
                            div()
                                .text_size(px(ty.caption))
                                .text_color(t.danger)
                                .child(tr("cloud.team.loadFailed")),
                        )
                        .child(
                            Button::new("cloud-retry")
                                .variant(ButtonVariant::Secondary)
                                .label(tr("cloud.common.retry"))
                                .on_click(cx.listener(|s, _, _, cx| s.refresh(cx))),
                        ),
                )
            })
            .child(
                div()
                    .text_size(px(ty.meta))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.text)
                    .child(tr("cloud.access.create.intentQuestion")),
            )
            .child(
                h_flex()
                    .items_start()
                    .gap(px(8.))
                    .child(card(
                        "cloud-action-mcp",
                        "cloud.access.create.intent.agent.label",
                        "cloud.access.create.intent.agent.preview",
                        Section::Mcp,
                        cx,
                    ))
                    .child(card(
                        "cloud-action-cli",
                        "cloud.access.create.intent.cli.label",
                        "cloud.route.cli.description",
                        Section::Cli,
                        cx,
                    ))
                    .child(card(
                        "cloud-action-git",
                        "cloud.access.create.intent.git.label",
                        "cloud.route.git-sync.description",
                        Section::GitSync,
                        cx,
                    )),
            )
            .child(list)
            .into_any_element()
    }
}
