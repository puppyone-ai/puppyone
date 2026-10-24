//! Port of `settings/sidebar/SettingsSidebar.tsx` on the shared sidebar primitives.
use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::settings_sidebar_model::groups;
use crate::{
    localization::t as tr,
    theme::{Theme, metric},
    ui::{column, sidebar_group, sidebar_row},
};
use gpui::{prelude::*, *};
impl SettingsWorkspaceSurface {
    pub(in crate::features::settings) fn sidebar(
        &self,
        width: f32,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let t = Theme::new(self.dark());
        let mut nav = column()
            .id("settings-navigation")
            .w(px(width))
            .h_full()
            .flex_shrink_0()
            .bg(t.sidebar)
            .border_r_1()
            .border_color(t.border_subtle)
            .py(px(metric::SIDEBAR_LIST_PADDING_BLOCK))
            .px(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .overflow_y_scroll();
        for (index, group) in groups(self.visibility(cx)).into_iter().enumerate() {
            let mut g = sidebar_group(Some(tr(group.key).into()), index == 0, t);
            for item in group.items {
                g = g.child(
                    sidebar_row(
                        item.key,
                        Some(item.icon),
                        tr(item.key),
                        self.page == item.page,
                        false,
                        t,
                    )
                    .on_click(cx.listener(move |s, _, _, cx| s.select_page(item.page, cx))),
                );
            }
            nav = nav.child(g);
        }
        nav
    }
}
