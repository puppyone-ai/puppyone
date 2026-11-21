//! Single source of truth for application and Dock menus across all platforms.
use crate::{
    app::command::{
        About, CheckForUpdates, CloseWindow, ManageExecutions, Minimize, NewWindow, OpenHelp,
        OpenSettings, Quit, ToggleFullScreen, Zoom,
    },
    app::menus::keymap::{HideApp, HideOtherApps, ShowAllApps},
    localization::t as tr,
    platform::{conventions::Conventions, os::Os},
    ui,
};
use gpui::*;

/// The Dock menu (`createDockMenuTemplate`).
pub fn dock_menu() -> Vec<MenuItem> {
    vec![MenuItem::action(tr("native.dock.newWindow"), NewWindow)]
}

/// The application menu model for the host OS (`createApplicationMenuTemplate`).
pub fn app_menus() -> Vec<Menu> {
    app_menus_for_conventions(Conventions::current())
}

/// Builds the application menu model for `os`.
pub fn app_menus_for_os(os: Os) -> Vec<Menu> {
    app_menus_for_conventions(Conventions::for_os(os))
}

/// Builds the application menu model for `conventions`.
///
/// On macOS (`uses_system_menu_bar == true`) this includes the AppKit-standard
/// application menu (`Services`, `Hide`, `Hide Others`, `Show All`). On Windows
/// and Linux, those macOS-only items are omitted while keeping Settings, Check
/// for Updates, About, and Quit reachable under File / Help.
pub fn app_menus_for_conventions(conventions: Conventions) -> Vec<Menu> {
    let app = crate::app::windows::application_name();

    if conventions.uses_system_menu_bar {
        return vec![
            Menu {
                disabled: false,
                name: app.into(),
                items: vec![
                    MenuItem::action(format!("About {app}"), About),
                    MenuItem::action(tr("native.menu.checkForUpdates"), CheckForUpdates),
                    MenuItem::separator(),
                    MenuItem::action(tr("native.menu.settings"), OpenSettings),
                    MenuItem::separator(),
                    MenuItem::os_submenu("Services", SystemMenuType::Services),
                    MenuItem::separator(),
                    MenuItem::action(format!("Hide {app}"), HideApp),
                    MenuItem::action("Hide Others", HideOtherApps),
                    MenuItem::action("Show All", ShowAllApps),
                    MenuItem::separator(),
                    MenuItem::action(format!("Quit {app}"), Quit),
                ],
            },
            Menu {
                disabled: false,
                name: tr("native.menu.file").into(),
                items: vec![
                    MenuItem::action(tr("native.dock.newWindow"), NewWindow),
                    MenuItem::separator(),
                    MenuItem::action(tr("native.execution.title"), ManageExecutions),
                    MenuItem::action("Close Window", CloseWindow),
                ],
            },
            ui::input::edit_menu(),
            Menu {
                disabled: false,
                name: "View".into(),
                items: vec![MenuItem::action("Toggle Full Screen", ToggleFullScreen)],
            },
            crate::features::sub_theme_catalog::theme_menu(|key| tr(key).into()),
            Menu {
                disabled: false,
                name: "Window".into(),
                items: vec![
                    MenuItem::action("Minimize", Minimize),
                    MenuItem::action("Zoom", Zoom),
                ],
            },
            Menu {
                disabled: false,
                name: "Help".into(),
                items: vec![],
            },
        ];
    }

    vec![
        Menu {
            disabled: false,
            name: tr("native.menu.file").into(),
            items: vec![
                MenuItem::action(tr("native.dock.newWindow"), NewWindow),
                MenuItem::separator(),
                MenuItem::action(tr("native.menu.settings"), OpenSettings),
                MenuItem::action(tr("native.execution.title"), ManageExecutions),
                MenuItem::separator(),
                MenuItem::action("Close Window", CloseWindow),
                MenuItem::action(format!("Quit {app}"), Quit),
            ],
        },
        ui::input::edit_menu(),
        Menu {
            disabled: false,
            name: "View".into(),
            items: vec![MenuItem::action("Toggle Full Screen", ToggleFullScreen)],
        },
        crate::features::sub_theme_catalog::theme_menu(|key| tr(key).into()),
        Menu {
            disabled: false,
            name: "Window".into(),
            items: vec![
                MenuItem::action(tr("native.window.minimize"), Minimize),
                MenuItem::action(tr("native.window.maximize"), Zoom),
            ],
        },
        Menu {
            disabled: false,
            name: "Help".into(),
            items: vec![
                MenuItem::action(tr("native.menu.checkForUpdates"), CheckForUpdates),
                MenuItem::action("Feedback", OpenHelp),
                MenuItem::separator(),
                MenuItem::action(format!("About {app}"), About),
            ],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn windows_and_linux_menus_omit_macos_services_and_expose_settings_and_quit() {
        let mac = app_menus_for_os(Os::Macos);
        let win = app_menus_for_os(Os::Windows);
        let linux = app_menus_for_os(Os::Linux);

        assert_eq!(mac.len(), 7);
        assert_eq!(win.len(), 6);
        assert_eq!(linux.len(), 6);

        for menus in [&win, &linux] {
            for menu in menus {
                assert!(
                    menu.items
                        .iter()
                        .all(|item| !matches!(item, MenuItem::SystemMenu(_))),
                    "non-macOS menus must not include macOS SystemMenu items"
                );
            }
            assert!(!menus.last().unwrap().items.is_empty());
        }
    }
}
