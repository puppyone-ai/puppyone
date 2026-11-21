//! `AgentRuntimeLauncher`: choosing a runtime establishes the chat's harness;
//! a runtime that cannot be chosen says why.
use super::super::agent_chat_view_model::AgentChatViewModel;
use super::super::agent_theme::AgentTheme;
use super::AgentChatTabPanel;
use crate::features::desktop_agent::domain::agent_backend_routing::is_selectable_agent_backend;
use crate::localization::t;
use crate::theme;
use crate::ui::agent_brand_mark::{AgentMark, brand_image};
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;

impl AgentChatTabPanel {
    /// `AgentRuntimeLauncher`: choosing a row establishes the harness
    /// boundary.
    pub(super) fn render_launcher(
        &mut self,
        view: &AgentChatViewModel,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let m = theme::ty();
        let mut list = v_flex().gap(px(2.));
        for entry in &view.runtime.agent_runtimes {
            let id = entry.descriptor.id.clone();
            let name = entry.descriptor.display_name.clone();
            let icon_key = entry
                .descriptor
                .icon_key
                .clone()
                .unwrap_or_else(|| id.clone());
            let ready = is_selectable_agent_backend(entry);
            let runtime_id = id.clone();
            list = list.child(
                h_flex()
                    .id(SharedString::from(format!("agent-launch-{id}")))
                    .h(px(theme::control()))
                    .px(px(8.))
                    .gap(px(8.))
                    .rounded(px(6.))
                    .cursor(theme::navigation_cursor())
                    .hover(move |s| s.bg(a.row_hover))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.select_routed_runtime(runtime_id.clone(), cx);
                        cx.notify();
                    }))
                    .children(
                        AgentMark::from_icon_key(&icon_key)
                            .map(|runtime| brand_image(runtime, palette.dark, 16.)),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_color(a.text)
                            .child(name),
                    )
                    .when(!ready, |d| {
                        d.child(
                            Icon::new("circle-alert")
                                .with_size(px(13.))
                                .stroke(1.7)
                                .color(a.text_subtle),
                        )
                    }),
            );
        }
        if view.runtime.agent_runtimes.is_empty() {
            list = list.child(
                div()
                    .px(px(8.))
                    .py(px(12.))
                    .text_color(a.text_subtle)
                    .child(t("agent.launcher.noneAvailable")),
            );
        }
        v_flex()
            .size_full()
            .items_center()
            .justify_center()
            .child(
                v_flex()
                    .w(px(280.))
                    .gap(px(8.))
                    .child(
                        h_flex()
                            .px(px(8.))
                            .gap(px(6.))
                            .text_size(px(m.right.caption))
                            .text_color(a.text_subtle)
                            .child(div().flex_1().child(t("agent.launcher.title")))
                            .child(
                                div()
                                    .id("agent-launcher-refresh")
                                    .size(px(22.))
                                    .rounded(px(5.))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .cursor(theme::clickable_cursor())
                                    .hover(move |s| s.bg(a.row_hover))
                                    .tooltip(crate::ui::components::tooltip(t(
                                        "agent.launcher.scanAgain",
                                    )))
                                    .on_click(cx.listener(|s, _, _, cx| {
                                        drop(s.controller.initialize(true));
                                        cx.notify();
                                    }))
                                    .child(
                                        Icon::new("refresh-cw")
                                            .with_size(px(12.))
                                            .stroke(1.7)
                                            .color(a.text_subtle),
                                    ),
                            ),
                    )
                    .child(list),
            )
            .into_any_element()
    }
}
