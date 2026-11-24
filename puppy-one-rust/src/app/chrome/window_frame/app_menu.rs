//! In-window application menu rendered inside the title bar on platforms
//! without a global system menu bar (Windows and Linux).
//!
//! Reads the single menu model (`cx.get_menus()`, falling back to
//! `app::menus::app_menus()`). When `Conventions::compact_app_menu` is set
//! (Windows and Linux best practice), renders a single compact menu trigger
//! (`≡`) on the leading edge of the title bar so navigation and tabs keep full
//! horizontal space; each top-level menu (`File`, `Edit`, `View`, `Theme`,
//! `Window`, `Help`) opens cleanly as a submenu.
use crate::{
    app::command::{OpenSettings, Quit},
    localization::t as tr,
    platform::conventions::Conventions,
    theme,
    ui::components::{
        Button, ButtonVariant, IconButton, Menu as UiMenu, MenuItem as UiMenuItem, PopoverMenu,
    },
};
use gpui::{prelude::*, *};
use gpui_kit::base::h_flex;

/// Renders the in-window application menu when the current OS does not host a
/// global system menu bar. Returns `None` on macOS.
pub fn render(cx: &App) -> Option<AnyElement> {
    let conventions = Conventions::current();
    if conventions.uses_system_menu_bar {
        return None;
    }
    let menus: Vec<OwnedMenu> = cx
        .get_menus()
        .unwrap_or_else(|| {
            crate::app::menus::app_menus()
                .into_iter()
                .map(Menu::owned)
                .collect()
        })
        .into_iter()
        .filter(|m| !m.disabled && !m.items.is_empty())
        .collect();
    if menus.is_empty() {
        return None;
    }

    if conventions.compact_app_menu {
        let app = crate::app::windows::application_name();
        let settings_shortcut = conventions.format_primary_shortcut(",");
        let quit_shortcut = conventions.format_primary_shortcut("Q");
        let trigger = IconButton::new("app-menu-trigger", "menu")
            .debug_selector(|| "app-menu-trigger".into())
            .label(tr("native.window.menu"))
            .w(px(theme::control()))
            .rounded(px(theme::metric::TOOLBAR_ACTION_RADIUS));
        let popover = PopoverMenu::new("app-menu-popover")
            .anchor(Anchor::TopLeft)
            .offset(px(2.))
            .trigger(trigger)
            .menu(move |mut ui_menu, _, _| {
                ui_menu = ui_menu.w(px(210.));
                for (index, menu) in menus.iter().enumerate() {
                    let sub_items = menu.items.clone();
                    let sub_id = format!("app-menu-group-{index}");
                    ui_menu = ui_menu.item(
                        UiMenuItem::new(menu.name.clone())
                            .id(("app-menu-group-row", index))
                            .submenu(move |_, _| {
                                populate_menu(UiMenu::new(sub_id.clone()), &sub_items)
                            }),
                    );
                }
                ui_menu
                    .separator()
                    .item(
                        UiMenuItem::new(tr("native.menu.settings"))
                            .id("app-menu-settings")
                            .shortcut(settings_shortcut)
                            .on_click(|window, cx| {
                                window.dispatch_action(Box::new(OpenSettings), cx);
                            }),
                    )
                    .separator()
                    .item(
                        UiMenuItem::new(format!("Quit {app}"))
                            .id("app-menu-quit")
                            .shortcut(quit_shortcut)
                            .on_click(|window, cx| {
                                window.dispatch_action(Box::new(Quit), cx);
                            }),
                    )
            });
        return Some(popover.into_any_element());
    }

    let mut row = h_flex().h_full().items_center().gap(px(1.));
    for (index, menu) in menus.into_iter().enumerate() {
        let name = menu.name.clone();
        let items = menu.items;
        let button = Button::new(("app-menu-trigger", index))
            .debug_selector(move || format!("app-menu-{index}"))
            .variant(ButtonVariant::Titlebar)
            .label(name.clone())
            .accessibility_label(name)
            .px(px(6.))
            .text_size(px(theme::ty().header.meta));
        let popover = PopoverMenu::new(("app-menu-popover", index))
            .anchor(Anchor::TopLeft)
            .offset(px(2.))
            .trigger(button)
            .menu(move |ui_menu, _, _| populate_menu(ui_menu, &items));
        row = row.child(popover);
    }
    Some(row.into_any_element())
}

fn populate_menu(mut ui_menu: UiMenu, items: &[OwnedMenuItem]) -> UiMenu {
    let mut prev_separator = true;
    for (idx, item) in items.iter().enumerate() {
        match item {
            OwnedMenuItem::Separator => {
                if !prev_separator {
                    ui_menu = ui_menu.separator();
                    prev_separator = true;
                }
            }
            OwnedMenuItem::SystemMenu(_) => {}
            OwnedMenuItem::Action {
                name,
                action,
                checked,
                disabled,
                ..
            } => {
                prev_separator = false;
                let action_box = action.boxed_clone();
                let mut row = UiMenuItem::new(name.clone())
                    .id(("app-menu-item", idx))
                    .disabled(*disabled)
                    .on_click(move |window, cx| {
                        window.dispatch_action(action_box.boxed_clone(), cx);
                    });
                if *checked {
                    row = row.checked(true);
                }
                ui_menu = ui_menu.item(row);
            }
            OwnedMenuItem::Submenu(sub) => {
                if sub.items.is_empty() {
                    continue;
                }
                prev_separator = false;
                let sub_items = sub.items.clone();
                let sub_id = format!("app-submenu-{idx}");
                let row = UiMenuItem::new(sub.name.clone())
                    .id(("app-menu-sub", idx))
                    .disabled(sub.disabled)
                    .submenu(move |_, _| populate_menu(UiMenu::new(sub_id.clone()), &sub_items));
                ui_menu = ui_menu.item(row);
            }
        }
    }
    ui_menu
}
