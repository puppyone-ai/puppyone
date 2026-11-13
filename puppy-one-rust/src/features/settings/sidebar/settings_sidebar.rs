//! Port of `settings/sidebar/SettingsSidebar.tsx` on the sidebar components.
use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::settings_sidebar_model::groups;
use crate::{
    localization::t as tr,
    theme::metric,
    ui::{
        appearance::ActiveAppearance,
        components::{RowVariant, SidebarGroup, SidebarRow},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Selectable as _, h_flex, v_flex};
impl SettingsWorkspaceSurface {
    pub(in crate::features::settings) fn sidebar(
        &self,
        width: f32,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let t = cx.palette();
        let space = self.settings_space(cx);
        let nav = v_flex()
            .id("settings-navigation")
            .w(px(width))
            .h_full()
            .flex_shrink_0()
            .bg(t.sidebar)
            .border_r_1()
            .border_color(t.border_subtle)
            .py(px(metric::SIDEBAR_LIST_PADDING_BLOCK))
            .px(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .overflow_y_scroll()
            .track_scroll(&self.sidebar_scroll);
        nav.children(
            groups(self.visibility(cx))
                .into_iter()
                .enumerate()
                .map(|(index, group)| {
                    let mut heading = SidebarGroup::new(Some(tr(group.key).into()));
                    // The Space group is headed by the space Settings manages:
                    // its mark, its name and its plan (`SettingsSidebar`).
                    if group.key == "settings.space.group"
                        && let Some(space) = &space
                    {
                        heading = heading.heading(
                            h_flex()
                                .w_full()
                                .min_w_0()
                                .gap(px(6.))
                                .text_color(t.muted)
                                .child(crate::features::cloud::space_mark(space))
                                .child(
                                    div()
                                        .min_w_0()
                                        .truncate()
                                        .child(crate::features::cloud::space_name(space)),
                                )
                                .children(crate::features::cloud::space_plan_badge(space)),
                        );
                    }
                    heading
                        .first(index == 0)
                        .children(group.items.into_iter().map(|item| {
                            SidebarRow::new(item.key)
                                .variant(RowVariant::Nav)
                                .icon(item.icon)
                                .label(tr(item.key))
                                .selected(self.page == item.page)
                                .on_click(
                                    cx.listener(move |s, _, _, cx| s.select_page(item.page, cx)),
                                )
                        }))
                }),
        )
        .child(crate::ui::scrollbar::vertical(
            "settings-navigation-scrollbar",
            &self.sidebar_scroll,
        ))
    }
}
