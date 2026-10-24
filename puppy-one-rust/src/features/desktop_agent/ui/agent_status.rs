//! Port of `AgentPanelStatus` (readiness / failure / recovery) plus command
//! suggestions (`composer/AgentCommandSuggestions`) and failed-draft recovery.
use super::*;
use crate::{
    localization::{t as tr, tf},
    theme,
    ui::icon_sized,
};
impl AgentChat {
    pub(super) fn render_status(&mut self, cx: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        let m = theme::ty();
        let mut region = column().flex_shrink_0().px(px(12.)).gap(px(6.));
        let banner = |icon: &str, color: Rgba, text: SharedString| {
            row()
                .w_full()
                .items_start()
                .gap(px(8.))
                .mt(px(10.))
                .px(px(12.))
                .py(px(8.))
                .rounded(px(8.))
                .border_1()
                .border_color(theme::mix(color, t.divider, 0.34))
                .bg(theme::alpha(color, 0.07))
                .text_size(px(m.right.caption))
                .text_color(t.sidebar_text)
                .child(icon_sized(icon, 14., color))
                .child(div().flex_1().min_w_0().whitespace_normal().child(text))
        };
        if let Some(notice) = &self.session.snapshot().notice {
            region = region.child(banner("info", t.subtle, notice.clone().into()));
        }
        if let Some(error) = &self.session.snapshot().error {
            let failed = self.session.snapshot().state == State::Failed;
            let label = self.installation.label.clone();
            region = region.child(
                column()
                    .gap(px(6.))
                    .when(!failed, |d| {
                        d.child(banner("circle-alert", t.danger, error.clone().into()))
                    })
                    // `AgentStatusCard tone="recovery"`: heading, recovery hint,
                    // the raw detail behind a Diagnostics disclosure, Reconnect.
                    .when(failed, |d| {
                        let open = self.diagnostics_open;
                        d.child(
                            banner(
                                "circle-alert",
                                t.danger,
                                tf("agent.readiness.sessionFailed", &[("agent", label.into())])
                                    .into(),
                            )
                            .font_weight(FontWeight::MEDIUM),
                        )
                        .child(
                            div()
                                .px(px(12.))
                                .text_size(px(m.right.caption))
                                .text_color(t.subtle)
                                .whitespace_normal()
                                .child(tr("agent.readiness.sessionRecovery")),
                        )
                        .child(
                            row()
                                .id("agent-diagnostics")
                                .px(px(12.))
                                .gap(px(4.))
                                .text_size(px(m.right.caption))
                                .text_color(t.muted)
                                .cursor(theme::clickable_cursor())
                                .child(icon_sized(
                                    if open {
                                        "chevron-down"
                                    } else {
                                        "chevron-right"
                                    },
                                    12.,
                                    t.muted,
                                ))
                                .child(tr("agent.header.diagnostics"))
                                .on_click(cx.listener(|s, _, _, cx| {
                                    s.diagnostics_open = !s.diagnostics_open;
                                    cx.notify();
                                })),
                        )
                        .when(open, |d| {
                            d.child(
                                div()
                                    .mx(px(12.))
                                    .px(px(8.))
                                    .py(px(6.))
                                    .rounded(px(6.))
                                    .bg(t.inset)
                                    .font_family("Menlo")
                                    .text_size(px(m.right.caption))
                                    .text_color(t.sidebar_text)
                                    .whitespace_normal()
                                    .child(SharedString::from(error.clone())),
                            )
                        })
                    })
                    .when(failed, |d| {
                        d.child(
                            row().child(
                                crate::ui::action_button(
                                    "reconnect-agent",
                                    tr("agent.readiness.reconnect"),
                                    Some("rotate-ccw"),
                                    crate::ui::Tone::Default,
                                    false,
                                    t,
                                )
                                .on_click(cx.listener(
                                    |s, _, _, cx| {
                                        s.session.replace_client(native_agent_client::create(
                                            s.installation.clone(),
                                            s.root.clone(),
                                            true,
                                            s.wake.clone(),
                                        ));
                                        s.answers.clear();
                                        cx.notify();
                                    },
                                )),
                            ),
                        )
                    }),
            );
        }
        if let Some(error) = &self.session.draft_error {
            region = region.child(banner("circle-alert", t.warning, error.clone().into()));
        }
        if self.session.recoverable.is_some() {
            region = region.child(
                row().pt(px(6.)).child(
                    crate::ui::action_button(
                        "restore-agent-draft",
                        tr("native.agent.restoreDraft"),
                        Some("undo-2"),
                        crate::ui::Tone::Default,
                        false,
                        t,
                    )
                    .tooltip(crate::ui::tooltip(tr("native.agent.restoreDraftDetail")))
                    .on_click(cx.listener(|s, _, _, cx| {
                        if let Some(text) = s.session.recover_draft() {
                            s.set_draft(text, cx);
                        }
                        cx.notify();
                    })),
                ),
            );
        }
        region
    }
    /// Slash-command suggestions above the composer.
    pub(super) fn render_commands(&mut self, cx: &mut Context<Self>) -> Option<Div> {
        let t = Theme::new(self.dark);
        let draft = self.composer.read(cx).text().to_owned();
        if !draft.starts_with('/') || draft.contains(' ') {
            return None;
        }
        let needle = draft.trim_start_matches('/').to_lowercase();
        let commands: Vec<_> = self
            .session
            .snapshot()
            .commands
            .iter()
            .filter(|(name, _)| name.to_lowercase().starts_with(&needle))
            .take(8)
            .cloned()
            .collect();
        if commands.is_empty() {
            return None;
        }
        let mut list = column()
            .mx(px(12.))
            .p(px(4.))
            .rounded(px(8.))
            .border_1()
            .border_color(t.border)
            .bg(t.menu_bg)
            .shadow(crate::ui::menu::menu_shadow(t));
        for (index, (name, description)) in commands.into_iter().enumerate() {
            list = list.child(
                row()
                    .id(("agent-command", index))
                    .h(px(theme::control()))
                    .px(px(8.))
                    .gap(px(8.))
                    .rounded(px(6.))
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover))
                    .text_size(px(theme::ty().left.content))
                    .child(div().text_color(t.text).child(format!("/{name}")))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_size(px(theme::ty().left.meta))
                            .text_color(t.subtle)
                            .child(description),
                    )
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.set_draft(format!("/{name} "), cx);
                        cx.notify();
                    })),
            );
        }
        Some(list)
    }
}
