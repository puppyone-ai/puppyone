//! The History toolbar: Back, the title, search and the source details.
use super::*;

impl HistoryBrowser {
    fn toolbar_button(
        &self,
        id: &'static str,
        label: &'static str,
        icon: AnyElement,
        disabled: bool,
        a: AgentTheme,
    ) -> Stateful<Div> {
        div()
            .id(id)
            .size(px(BUTTON))
            .flex_shrink_0()
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(6.))
            .border_1()
            .border_color(theme::alpha(a.text, 0.))
            .text_color(a.text_subtle)
            .when(disabled, |d| d.opacity(0.5))
            .when(!disabled, |d| {
                d.hover(move |s| s.bg(a.row_hover).text_color(a.text))
            })
            .tooltip(tooltip(label))
            .child(icon)
    }

    pub(super) fn toolbar(
        &mut self,
        permission: bool,
        a: AgentTheme,
        cx: &mut Context<Self>,
    ) -> Div {
        let back = self
            .toolbar_button(
                "history-back",
                tr("agent.history.back"),
                Icon::new("arrow-left")
                    .stroke(1.7)
                    .color(a.text_subtle)
                    .into_any_element(),
                false,
                a,
            )
            .on_click(cx.listener(|s, _, _, cx| s.back(cx)));
        let mut bar = div()
            .h(px(TOOLBAR))
            .flex_shrink_0()
            .w_full()
            .px(px(12.))
            .flex()
            .items_center()
            .gap(px(6.))
            .child(back);
        if permission {
            return bar;
        }
        let state = self.source.snapshot();
        let busy = (state.sessions.is_empty() && (state.loading || !state.loaded))
            || state.refreshing
            || state.loading_more;
        let refreshing = state.refreshing;
        let slot = div().flex_1().min_w_0().flex().justify_end().map(|slot| {
            if self.search_open {
                // `.desktop-agent-history-search`.
                let focused = self.search_focused;
                slot.child(
                    div()
                        .id("history-search")
                        .w_full()
                        .h(px(BUTTON))
                        .pl(px(6.))
                        .pr(px(6.))
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .rounded(px(6.))
                        .border_1()
                        .border_color(if focused {
                            a.launcher_focus_border
                        } else {
                            theme::alpha(a.text, 0.)
                        })
                        .bg(if focused {
                            a.control_surface
                        } else {
                            a.launcher_placeholder_surface
                        })
                        .child(
                            div().w(px(16.)).flex().justify_center().child(
                                Icon::new("search")
                                    .with_size(px(13.))
                                    .stroke(1.7)
                                    .color(a.launcher_placeholder_text),
                            ),
                        )
                        .child(div().flex_1().min_w_0().child(self.search.clone())),
                )
            } else {
                slot.child(
                    self.toolbar_button(
                        "history-search-open",
                        tr("agent.history.search"),
                        Icon::new("search")
                            .stroke(1.7)
                            .color(a.text_subtle)
                            .into_any_element(),
                        false,
                        a,
                    )
                    .on_click(cx.listener(|s, _, window, cx| {
                        s.search_open = true;
                        s.search.read(cx).focus_handle(cx).focus(window, cx);
                        cx.notify();
                    })),
                )
            }
        });
        let icon = if refreshing {
            spinning(
                "history-refresh-spin",
                "refresh-cw",
                12.,
                1.7,
                a.text_subtle,
            )
        } else {
            Icon::new("refresh-cw")
                .xsmall()
                .stroke(1.7)
                .color(a.text_subtle)
                .into_any_element()
        };
        let refresh = self
            .toolbar_button(
                "history-refresh",
                tr("agent.history.refresh"),
                icon,
                busy,
                a,
            )
            .when(!busy, |d| {
                d.on_click(cx.listener(|s, _, _, cx| {
                    s.source.refresh();
                    cx.notify();
                }))
            });
        bar = bar.child(slot).child(refresh);
        bar
    }
}
