//! In-window application menu bar rendered inside the title bar on platforms
//! without a global system menu bar (Windows and Linux).
//!
//! Reads the single menu model (`cx.get_menus()`, falling back to
//! `app::menus::app_menus()`) and renders each top-level menu with
//! `ui::components::PopoverMenu` + `ui::components::Menu`, dispatching the
//! menu item's GPUI `Action` directly to the active window.
use crate::{
    platform::conventions::Conventions,
    theme,
    ui::components::{Button, ButtonVariant, Menu as UiMenu, MenuItem as UiMenuItem, PopoverMenu},
};
use gpui::{prelude::*, *};
use gpui_kit::base::h_flex;

/// Renders the compact in-window menu bar when the current OS does not host a
/// global system menu bar. Returns `None` on macOS.
pub fn render(cx: &App) -> Option<AnyElement> {
    if Conventions::current().uses_system_menu_bar {
        return None;
    }
    let menus: Vec<OwnedMenu> = cx.get_menus().unwrap_or_else(|| {
        crate::app::menus::app_menus()
            .into_iter()
            .map(Menu::owned)
            .collect()
    });
    let mut row = h_flex().h_full().items_center().gap(px(1.));
    let mut any = false;
    for (index, menu) in menus.into_iter().enumerate() {
        if menu.disabled || menu.items.is_empty() {
            continue;
        }
        any = true;
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
    any.then(|| row.into_any_element())
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
