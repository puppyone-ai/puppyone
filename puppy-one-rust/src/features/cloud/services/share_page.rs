//! The Share page and its wizard.
use super::*;

impl CloudServices {
    /// `CloudShareHome`: who can read the Project, and who else could.
    pub(super) fn share_page(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let Some(details) = self.details.clone() else {
            return self.loading_row(t);
        };
        if let Some(flow) = self.share_flow.clone() {
            return self.share_wizard(flow, &details, t, cx);
        }
        if self.share_readers {
            return self.share_readers_step(t, cx);
        }
        let name = details
            .project
            .as_ref()
            .map_or(String::new(), |p| p.name.clone());
        let mut page = v_flex()
            .gap(px(12.))
            .child(
                div()
                    .text_size(px(ty.body + 2.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.text)
                    .child(tr("cloud.share.location.shareAction")),
            )
            .child(
                div()
                    .text_size(px(ty.meta))
                    .text_color(t.muted)
                    .child(tf("cloud.share.readers.title", &[("project", name.into())])),
            );
        page = page.child(self.share_status_card(t, cx));
        page = page.child(
            div()
                .pt(px(8.))
                .text_size(px(ty.meta))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.text)
                .child(tr("cloud.share.target.question")),
        );
        // `.desktop-share-page-target-grid`: two columns of targets, each a
        // mark, its name and preview, and an arrow.
        let tile = |index: usize, target: share::Target, cx: &mut Context<Self>| {
            h_flex()
                .id(("cloud-share-target", index))
                .flex_1()
                .min_w_0()
                .min_h(px(62.))
                .gap(px(10.))
                .px(px(11.))
                .py(px(9.))
                .border_1()
                .border_color(t.border)
                .rounded(px(10.))
                .text_color(t.muted)
                .hover(|d| d.bg(t.hover).text_color(t.text))
                .on_click(cx.listener(move |s, _, _, cx| s.begin_share(target, cx)))
                .child(share_target_mark(&target, t))
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .gap(px(2.))
                        .child(
                            div()
                                .truncate()
                                .text_size(px(ty.meta))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.text)
                                .child(target_label(&target)),
                        )
                        .child(
                            div()
                                .text_size(px(ty.caption))
                                .text_color(t.muted)
                                .child(tr(&format!("cloud.share.target.{}.preview", target.id))),
                        ),
                )
                .child(Icon::new("arrow-right").with_size(px(14.)))
        };
        let mut grid = v_flex().gap(px(8.));
        let targets: Vec<_> = share::TARGETS.iter().copied().enumerate().collect();
        for pair in targets.chunks(2) {
            let mut row = h_flex().gap(px(8.)).items_stretch();
            for (index, target) in pair.iter().copied() {
                row = row.child(tile(index, target, cx));
            }
            if pair.len() == 1 {
                row = row.child(div().flex_1());
            }
            grid = grid.child(row);
        }
        page.child(grid).into_any_element()
    }
    pub(super) fn share_wizard(
        &mut self,
        flow: ShareFlow,
        details: &Details,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let ty = theme::ty().ui;
        let label = target_label(&flow.target);
        let heading = div()
            .text_size(px(ty.body + 2.))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(t.text)
            .child(label.clone());
        let back = Button::new("cloud-share-back")
            .variant(ButtonVariant::Secondary)
            .icon(Icon::new("arrow-left").with_size(px(13.)).color(t.muted))
            .label(tr("cloud.share.action.back"))
            .on_click(cx.listener(|s, _, _, cx| {
                s.share_epoch += 1;
                s.share_flow = None;
                cx.notify();
            }));
        let page = v_flex()
            .gap(px(12.))
            .child(h_flex().child(back))
            .child(heading);
        match flow.phase.clone() {
            SharePhase::Choose => {
                let folders = scope_folders(details, &self.share_path);
                let option = |id: (&'static str, usize),
                              path: String,
                              text: String,
                              cx: &mut Context<Self>| {
                    let chosen = flow.path == path;
                    Button::new(id)
                        .variant(if chosen {
                            ButtonVariant::Solid
                        } else {
                            ButtonVariant::Secondary
                        })
                        .label(text)
                        .on_click(cx.listener(move |s, _, _, cx| {
                            if let Some(flow) = &mut s.share_flow {
                                flow.path = path.clone();
                            }
                            cx.notify();
                        }))
                };
                let mut scope = h_flex().flex_wrap().gap(px(6.)).child(option(
                    ("cloud-share-path", 0),
                    String::new(),
                    tr("cloud.share.scope.whole").to_owned(),
                    cx,
                ));
                for (index, folder) in folders.into_iter().enumerate() {
                    let text = access::path_label(&folder);
                    scope = scope.child(option(("cloud-share-path", index + 1), folder, text, cx));
                }
                let page = page
                    .child(
                        div()
                            .text_size(px(ty.meta))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(tr("cloud.share.scope.question")),
                    )
                    .child(scope);
                let page = if flow.target.channel == share::Channel::Mcp {
                    let mode = |id: &'static str,
                                value: &'static str,
                                key: &str,
                                cx: &mut Context<Self>| {
                        Button::new(id)
                            .variant(if flow.mode == value {
                                ButtonVariant::Solid
                            } else {
                                ButtonVariant::Secondary
                            })
                            .label(tr(key))
                            .on_click(cx.listener(move |s, _, _, cx| {
                                if let Some(flow) = &mut s.share_flow {
                                    flow.mode = value;
                                }
                                cx.notify();
                            }))
                    };
                    let read = mode("cloud-share-read", "r", "cloud.share.scope.readOnly", cx);
                    let write = mode("cloud-share-write", "rw", "cloud.share.scope.readWrite", cx);
                    page.child(h_flex().gap(px(6.)).child(read).child(write))
                } else {
                    page
                };
                page.child(
                    h_flex().justify_end().child(
                        Button::new("cloud-share-next")
                            .variant(ButtonVariant::Solid)
                            .label(tr("cloud.share.action.next"))
                            .on_click(cx.listener(|s, _, _, cx| s.issue_share(cx))),
                    ),
                )
                .into_any_element()
            }
            SharePhase::Publishing => {
                let project = details.project.as_ref().map_or("", |p| p.name.as_str());
                page.child(div().text_size(px(ty.meta)).text_color(t.text).child(tf(
                    "cloud.share.publish.title",
                    &[
                        ("project", project.into()),
                        ("target", label.clone().into()),
                    ],
                )))
                .child(div().text_size(px(ty.meta)).text_color(t.muted).child(tf(
                    "cloud.share.publish.why",
                    &[("target", label.clone().into())],
                )))
                .into_any_element()
            }
            SharePhase::Issuing => page
                .child(div().text_size(px(ty.meta)).text_color(t.muted).child(tf(
                    "cloud.share.publish.issuing",
                    &[("target", label.clone().into())],
                )))
                .into_any_element(),
            SharePhase::Failed => page
                .child(
                    div().text_size(px(ty.meta)).text_color(t.danger).child(
                        self.publish_failure
                            .clone()
                            .unwrap_or_else(|| tr("cloud.share.error.issueFailed").to_owned()),
                    ),
                )
                .child(
                    h_flex().child(
                        Button::new("cloud-share-retry")
                            .variant(ButtonVariant::Secondary)
                            .label(tr("cloud.share.action.retry"))
                            .on_click(cx.listener(|s, _, _, cx| s.retry_share(cx))),
                    ),
                )
                .into_any_element(),
            SharePhase::Ready { key, reused, .. } => {
                let connected = self.share_connected(&flow);
                let copy_row =
                    |id: &'static str, title: &str, value: String, cx: &mut Context<Self>| {
                        let copied = value.clone();
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
                                            .child(tr(title)),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(ty.caption))
                                            .font_family("Geist Mono")
                                            .text_color(t.text)
                                            .child(value),
                                    ),
                            )
                            .child(
                                Button::new(id)
                                    .variant(ButtonVariant::Secondary)
                                    .label(tr("cloud.share.action.copy"))
                                    .on_click(
                                        cx.listener(move |s, _, _, cx| s.copy(copied.clone(), cx)),
                                    ),
                            )
                    };
                let mut page = page.child(
                    div()
                        .text_size(px(ty.meta))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.text)
                        .child(tf(
                            "cloud.share.handoff.title",
                            &[("target", label.clone().into())],
                        )),
                );
                for step in 1..=flow.target.steps {
                    page = page.child(div().text_size(px(ty.meta)).text_color(t.text).child(
                        format!(
                            "{step}. {}",
                            tr(&format!(
                                "cloud.share.handoff.{}.step{step}",
                                flow.target.id
                            ))
                        ),
                    ));
                }
                let landed = connected || flow.target.channel == share::Channel::Link;
                let environment = account::environment(cx);
                if flow.target.channel == share::Channel::Mcp {
                    let server = environment
                        .as_ref()
                        .map(|e| services::mcp_server_url(e.api()))
                        .unwrap_or_default();
                    page = page.child(copy_row(
                        "cloud-share-url",
                        "cloud.share.handoff.serverUrl",
                        server,
                        cx,
                    ));
                    page = match key {
                        Some(key) => page.child(copy_row(
                            "cloud-share-key",
                            "cloud.share.handoff.apiKey",
                            key,
                            cx,
                        )),
                        None if reused => page.child(
                            div()
                                .text_size(px(ty.caption))
                                .text_color(t.muted)
                                .child(tr("cloud.share.handoff.apiKeyReused")),
                        ),
                        None => page,
                    };
                    page = page.child(div().text_size(px(ty.caption)).text_color(t.muted).child(
                        tf(
                            if connected {
                                "cloud.share.receipt.connected"
                            } else {
                                "cloud.share.receipt.waiting"
                            },
                            &[("target", label.clone().into())],
                        ),
                    ));
                } else if let Some(link) = environment.as_ref().and_then(|e| {
                    let project = self.project.as_deref()?;
                    crate::workspace::cloud::locator::resource_url(
                        e.web(),
                        project,
                        &flow.path,
                        true,
                    )
                    .ok()
                }) {
                    page = page
                        .child(copy_row(
                            "cloud-share-link",
                            "cloud.share.handoff.link",
                            link,
                            cx,
                        ))
                        .child(
                            div()
                                .text_size(px(ty.caption))
                                .text_color(t.muted)
                                .child(tr("cloud.share.handoff.linkNote")),
                        );
                }
                let docs = flow.target.docs;
                page.children(docs.map(|url| {
                    Button::new("cloud-share-docs")
                        .variant(ButtonVariant::Secondary)
                        .label(tf(
                            "cloud.share.handoff.docs",
                            &[("target", label.clone().into())],
                        ))
                        .on_click(move |_, _, cx| cx.open_url(url))
                }))
                .child(
                    h_flex()
                        .justify_end()
                        .gap(px(8.))
                        .child(
                            Button::new("cloud-share-another")
                                .variant(ButtonVariant::Secondary)
                                .label(tr("cloud.share.action.shareAnother"))
                                .on_click(cx.listener(|s, _, _, cx| {
                                    s.share_epoch += 1;
                                    s.share_flow = None;
                                    s.share_readers =
                                        s.share_rows().iter().any(share::Share::active);
                                    cx.notify();
                                })),
                        )
                        .child(
                            Button::new("cloud-share-done")
                                .variant(if landed {
                                    ButtonVariant::Solid
                                } else {
                                    ButtonVariant::Secondary
                                })
                                .label(tr("cloud.share.action.done"))
                                .on_click(cx.listener(|s, _, _, cx| s.finish_share(cx))),
                        ),
                )
                .into_any_element()
            }
        }
    }
}

/// `ShareTargetMark`: the brand's own mark for an Agent product, else a
/// glyph for what the target is, on a 32px plate.
pub(super) fn share_target_mark(target: &share::Target, t: Theme) -> Div {
    use crate::ui::agent_brands;
    let brand = match target.id {
        "viktor" | "manus" | "claude" | "chatgpt" => agent_brands::get(target.id),
        _ => None,
    };
    let mark: AnyElement = match brand {
        // The ChatGPT artwork exists only in white: drawn as the monochrome
        // mark in the surface's own text colour.
        Some(brand) if brand.id == "chatgpt" => svg()
            .path(agent_brands::monochrome(brand).unwrap_or_default())
            .size(px(16.))
            .text_color(t.text)
            .into_any_element(),
        Some(brand) => agent_brands::image(brand, t.dark, 16.).into_any_element(),
        None => Icon::new(match target.id {
            "mcp" => "mcp-logo",
            "person" => "user-round",
            "slack-bot" => "message-circle",
            "grok" => "sparkles",
            _ => "share-2",
        })
        .with_size(px(16.))
        .into_any_element(),
    };
    div()
        .size(px(32.))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(8.))
        .bg(t.hover)
        .child(mark)
}
