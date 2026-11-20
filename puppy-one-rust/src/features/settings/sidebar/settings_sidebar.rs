//! Settings' sidebar on the sidebar components. The first group is headed by
//! the scope switcher, one of the sidebar's own rows: the space Settings
//! manages (a person's circle for Personal, a rounded square for a team
//! space) with a quiet chevron, no chrome until hovered. Its menu lists
//! Personal, then the team spaces with the reader's role and plan, then
//! creating one.
use super::super::settings_workspace_surface::{SettingsEvent, SettingsWorkspaceSurface};
use super::settings_sidebar_model::groups;
use crate::{
    localization::t as tr,
    theme::{self, metric},
    ui::{
        appearance::ActiveAppearance,
        components::{
            Icon, MenuItem, PersonMark, PopoverMenu, RowVariant, SidebarGroup, SidebarRow,
            SurfaceCorners, SurfaceStyledExt,
        },
    },
    workspace::cloud::spaces::{PlanKey, Space, mark_initial, mark_tone},
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Selectable as _, v_flex},
    component::Sizable as _,
};

/// The mark a space is shown with: Personal is the person, every other
/// space its rounded square.
pub(in crate::features::settings) fn scope_mark(space: &Space, email: Option<&str>) -> AnyElement {
    match email.filter(|_| space.is_default) {
        Some(email) => {
            PersonMark::new(mark_tone(email) as usize, mark_initial(email)).into_any_element()
        }
        None => crate::features::cloud::space_mark(space).into_any_element(),
    }
}
/// The reader's role and the space's plan, as the switcher's menu says them.
fn role_and_plan(space: &Space) -> String {
    let plan = tr(&format!(
        "settings.plan.name.{}",
        PlanKey::of(space.plan_id.as_deref().unwrap_or("free")).key()
    ))
    .to_owned();
    match space.role.as_deref().filter(|_| !space.is_default) {
        Some(role) => {
            let key = format!("native.space.role.{role}");
            match tr(&key) {
                text if text == key => plan,
                text => format!("{text} · {plan}"),
            }
        }
        None => plan,
    }
}

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
            .surface_corners(metric::TASK_DIALOG_RADIUS, SurfaceCorners::bottom_left())
            .border_r_1()
            .border_color(t.border_subtle)
            .py(px(metric::SIDEBAR_LIST_PADDING_BLOCK))
            .px(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .overflow_y_scroll()
            .track_scroll(&self.sidebar_scroll);
        let menu_width = width - metric::SIDEBAR_ROW_LEFT_GAP - metric::SIDEBAR_ROW_RIGHT_GAP;
        nav.children(
            groups(self.visibility(cx))
                .into_iter()
                .enumerate()
                .map(|(index, group)| {
                    let mut heading =
                        SidebarGroup::new((!group.switcher).then(|| tr(group.key).into()));
                    if group.switcher
                        && let Some(space) = &space
                    {
                        heading = heading.child(self.scope_switcher(space, menu_width, cx));
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

    /// The scope switcher: a row like the ones under it, and its menu.
    fn scope_switcher(
        &self,
        current: &Space,
        menu_width: f32,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let email = crate::features::cloud::account::snapshot(cx)
            .and_then(|s| s.account)
            .map(|a| a.email);
        let spaces = crate::features::cloud::global_spaces_read(cx)
            .map(|s| s.spaces().to_vec())
            .unwrap_or_default();
        let entity = cx.entity();
        let current_id = current.id.clone();
        let trigger = SidebarRow::new("settings-scope")
            .variant(RowVariant::Nav)
            .leading(scope_mark(current, email.as_deref()))
            .label(crate::features::cloud::space_name(current))
            .child(
                Icon::new("chevrons-up-down")
                    .with_size(px(14.))
                    .color(t.subtle),
            );
        PopoverMenu::new("settings-scope-menu")
            .trigger(trigger)
            .menu(move |menu, _, cx| {
                let t = cx.palette();
                let section = |label: &str| {
                    div()
                        .px(px(8.))
                        .pt(px(6.))
                        .pb(px(2.))
                        .text_size(px(theme::ty().ui.meta))
                        .line_height(px(theme::ty().ui.meta * 1.5))
                        .text_color(t.subtle)
                        .child(label.to_owned())
                };
                let option = |space: &Space| {
                    let id = space.id.clone();
                    let entity = entity.clone();
                    let chosen = space.id == current_id;
                    let mut item = MenuItem::new(crate::features::cloud::space_name(space))
                        .icon_element(scope_mark(space, email.as_deref()))
                        .detail_below(role_and_plan(space))
                        .on_click(move |_, cx| {
                            let id = id.clone();
                            entity.update(cx, |s, cx| s.switch_scope(id, cx));
                        });
                    if chosen {
                        item = item
                            .selected(true)
                            .trailing(Icon::new("check").small().stroke(2.).color(t.muted));
                    }
                    item
                };
                let personal: Vec<MenuItem> =
                    spaces.iter().filter(|s| s.is_default).map(option).collect();
                let teams: Vec<MenuItem> = spaces
                    .iter()
                    .filter(|s| !s.is_default)
                    .map(option)
                    .collect();
                let mut menu = menu.w(px(menu_width.max(200.)));
                if !personal.is_empty() {
                    menu = menu.items(personal);
                }
                if !teams.is_empty() {
                    menu = menu
                        .child_element(section(tr("native.space.teamSpaces")))
                        .items(teams);
                }
                let entity = entity.clone();
                menu.separator().item(
                    MenuItem::new(tr("settings.space.create"))
                        .icon_sized(Icon::new("plus").with_size(px(15.)).stroke(2.))
                        .on_click(move |_, cx| {
                            entity.update(cx, |_, cx| cx.emit(SettingsEvent::CreateSpace))
                        }),
                )
            })
            .into_any_element()
    }
}
