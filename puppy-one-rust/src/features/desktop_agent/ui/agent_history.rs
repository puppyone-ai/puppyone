//! Port of `AgentConversationHistory` / `workbench/AgentChatHistoryBrowser`:
//! search, open and archive saved chats; mutations use controller commands.
use super::*;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::{Button, Icon, IconButton};
use crate::{
    localization::{t as tr, tf},
    theme,
};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;
impl AgentChat {
    pub(super) fn render_history(&mut self, cx: &mut Context<Self>) -> Stateful<Div> {
        let t = cx.palette();
        let m = theme::ty();
        let snapshot = self.session.snapshot().clone();
        let mut history = v_flex()
            .id("agent-history")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .px(px(12.))
            .py(px(12.))
            .gap(px(8.))
            .child(
                h_flex()
                    .gap(px(8.))
                    .child(
                        Button::new("history-back")
                            .icon("chevron-left")
                            .label(tr("agent.history.back"))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.session.new_thread();
                                cx.notify();
                            })),
                    )
                    .child(
                        div()
                            .flex_1()
                            .text_size(px(m.left.content))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(tr("agent.history.title")),
                    ),
            )
            .child(self.history_filter.clone());
        if snapshot.history.is_empty() {
            history = history.child(
                div()
                    .py(px(20.))
                    .text_size(px(m.right.caption))
                    .text_color(t.subtle)
                    .child(if snapshot.state == State::Starting {
                        tr("agent.history.loading")
                    } else {
                        tr("agent.history.notFound")
                    }),
            );
        }
        let query = self.history_filter.read(cx).text().to_lowercase();
        let mut matches = 0;
        for (i, entry) in snapshot
            .history
            .iter()
            .enumerate()
            .filter(|(_, e)| e.title.to_lowercase().contains(&query))
        {
            matches += 1;
            let id = entry.id.clone();
            let archive_id = id.clone();
            let open = tf(
                "agent.history.open",
                &[("title", entry.title.clone().into())],
            );
            history = history.child(
                h_flex()
                    .id(("history", i))
                    .w_full()
                    .min_h(px(theme::control() + 4.))
                    .px(px(8.))
                    .gap(px(8.))
                    .rounded(px(theme::metric::SIDEBAR_ROW_RADIUS))
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(theme::alpha(t.hover, 0.86)))
                    .text_size(px(m.left.content))
                    .text_color(t.sidebar_text)
                    .child(Icon::new("message-square").color(t.subtle))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .child(entry.title.clone()),
                    )
                    .when(snapshot.capabilities.archive, |d| {
                        d.child(
                            IconButton::new(("archive-history", i), "x")
                                .with_size(px(22.))
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    cx.stop_propagation();
                                    s.session.archive(archive_id.clone());
                                    cx.notify();
                                })),
                        )
                    })
                    .tooltip(crate::ui::components::tooltip(open))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.session.resume(id.clone());
                        cx.notify();
                    })),
            );
        }
        if !snapshot.history.is_empty() && matches == 0 {
            history = history.child(
                div()
                    .py(px(12.))
                    .text_size(px(m.right.caption))
                    .text_color(t.subtle)
                    .child(tr("agent.history.noMatches")),
            );
        }
        if snapshot.cursor.is_some() {
            history = history.child(
                h_flex().child(
                    Button::new("more-history")
                        .label(tr("agent.history.loadMore"))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.session.list_history();
                            cx.notify();
                        })),
                ),
            );
        }
        history
    }
}
