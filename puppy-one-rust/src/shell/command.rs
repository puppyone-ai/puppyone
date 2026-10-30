//! Shell commands. Keyboard shortcuts and the native menu bar dispatch typed
//! GPUI actions; every action, button and protocol message resolves to one
//! [`Command`] handled by `Shell::command`.
use crate::{localization::t as tr, ui};
use gpui::*;

/// Everything the shell can be asked to do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    Undo,
    Redo,
    Save,
    Reload,
    CloseFile,
    /// Editor pane menu "Open in default app".
    OpenExternal,
    /// Close this window through its barrier (window close button, or one
    /// window's share of an app quit).
    Quit,
    /// ⌘Q / app menu Quit: every window closes through its own barrier.
    QuitApp,
    QuitWithProcesses,
    CancelProcessQuit,
    OpenFolder,
    /// `openProjectLauncher`: the Project entry launcher.
    CreateNew,
    /// `ProjectNavigationFailure` → Retry / Close.
    RetryProjectOpen,
    CloseProjectFailure,
    ToggleExplorer,
    ToggleRightSidebar,
    Settings,
    Feedback,
    // The Header opens its menus directly; capture scenarios and tests
    // drive them through these commands.
    #[cfg_attr(not(feature = "dev-capture"), allow(dead_code))]
    ProjectMenu,
    #[cfg_attr(not(feature = "dev-capture"), allow(dead_code))]
    LocationMenu,
    Home,
    Escape,
    /// View → Toggle Markdown Source.
    ToggleMarkdownSource,
    ClearError,
    RetryFileOperation,
    Changes,
    /// Cloud Header → Share (`CloudWorkspaceShareDialog`).
    ShareCloud,
    /// Local Header → Share: the Cloud services dialog (`openCloudDialogAt`).
    CloudServices,
    CloseShare,
    CopyShareLink,
    /// Cloud Header → History (`CloudWorkspaceHeaderTools`).
    CloudHistory,
    /// The Cloud conflict notice's "Discard edits and reload".
    ReloadCloudBaseline,
    /// File → Manage Running Sessions (`file.manageExecutions`).
    ManageExecutions,
    /// File/Dock → New Window (`file.newWindow`, ⌘N).
    NewWindow,
    /// App menu → About PuppyOne.
    About,
    CloseAbout,
    /// App menu → Check for Updates… (grouped with About).
    CheckForUpdates,
    /// Window menu.
    Minimize,
    Zoom,
    CloseExecutions,
}
impl Command {
    /// The editor host protocol names pane-menu commands (`ClientMessage::Action`).
    pub fn from_protocol(name: &str) -> Option<Self> {
        Some(match name {
            "open-external" => Self::OpenExternal,
            "close-file" => Self::CloseFile,
            "save" => Self::Save,
            "reload" => Self::Reload,
            _ => return None,
        })
    }
}

macro_rules! shell_actions {
    ($($action:ident => $command:ident),* $(,)?) => {
        actions!(shell, [$($action),*]);
        /// Route each shell action on `element` to `handler`.
        pub fn on_shell_actions<E: InteractiveElement>(
            element: E,
            handler: impl Fn(Command, &mut Window, &mut App) + Clone + 'static,
        ) -> E {
            let mut element = element;
            $(
                let h = handler.clone();
                element = element.on_action(move |_: &$action, window, cx| h(Command::$command, window, cx));
            )*
            element
        }
        /// Global handlers, for menu bar actions dispatched with nothing focused.
        pub fn on_global_shell_actions(cx: &mut App, handler: impl Fn(Command, &mut App) + Clone + 'static) {
            $(
                let h = handler.clone();
                cx.on_action(move |_: &$action, cx| h(Command::$command, cx));
            )*
        }
    };
}
shell_actions! {
    ToggleExplorer => ToggleExplorer,
    ToggleRightSidebar => ToggleRightSidebar,
    OpenSettings => Settings,
    OpenFolder => OpenFolder,
    Save => Save,
    Reload => Reload,
    CloseFile => CloseFile,
    Quit => QuitApp,
    Escape => Escape,
    ToggleMarkdownSource => ToggleMarkdownSource,
    ManageExecutions => ManageExecutions,
    NewWindow => NewWindow,
    About => About,
    CheckForUpdates => CheckForUpdates,
    Minimize => Minimize,
    Zoom => Zoom,
    CloseWindow => Quit,
    OpenHelp => Feedback,
}

/// The Dock menu (`createDockMenuTemplate`).
pub fn dock_menu() -> Vec<MenuItem> {
    vec![MenuItem::action(tr("native.dock.newWindow"), NewWindow)]
}

pub fn bind_keys(cx: &mut App) {
    for modifier in ["cmd", "ctrl"] {
        let key = |k: &str| format!("{modifier}-{k}");
        cx.bind_keys([
            KeyBinding::new(&key("b"), ToggleExplorer, None),
            KeyBinding::new(&key("j"), ToggleRightSidebar, None),
            KeyBinding::new(&key(","), OpenSettings, None),
            KeyBinding::new(&key("o"), OpenFolder, None),
            KeyBinding::new(&key("s"), Save, None),
            KeyBinding::new(&key("w"), CloseFile, None),
            KeyBinding::new(&key("q"), Quit, None),
            KeyBinding::new(&key("n"), NewWindow, None),
        ]);
    }
    cx.bind_keys([
        KeyBinding::new("cmd-h", HideApp, None),
        KeyBinding::new("alt-cmd-h", HideOtherApps, None),
        KeyBinding::new("cmd-m", Minimize, None),
    ]);
    cx.bind_keys([KeyBinding::new("escape", Escape, None)]);
    super::explorer::bind_keys(cx);
}

/// Native menu bar in the current locale; rebuilt when the locale changes.
pub fn app_menus() -> Vec<Menu> {
    vec![
        // `createApplicationMenuTemplate`: About and Check for Updates
        // together, then Settings, the system items and Quit.
        Menu {
            disabled: false,
            name: "PuppyOne".into(),
            items: vec![
                MenuItem::action(tr("native.menu.about"), About),
                MenuItem::action(tr("native.menu.checkForUpdates"), CheckForUpdates),
                MenuItem::separator(),
                MenuItem::action(tr("native.menu.settings"), OpenSettings),
                MenuItem::separator(),
                MenuItem::os_submenu(tr("native.menu.services"), SystemMenuType::Services),
                MenuItem::separator(),
                MenuItem::action(tr("native.menu.hide"), HideApp),
                MenuItem::action(tr("native.menu.hideOthers"), HideOtherApps),
                MenuItem::action(tr("native.menu.showAll"), ShowAllApps),
                MenuItem::separator(),
                MenuItem::action(tr("native.menu.quit"), Quit),
            ],
        },
        Menu {
            disabled: false,
            name: tr("native.menu.file").into(),
            items: vec![
                MenuItem::action(tr("native.dock.newWindow"), NewWindow),
                MenuItem::separator(),
                MenuItem::action(tr("shell.workspaceSwitcher.openFolder"), OpenFolder),
                MenuItem::action(tr("native.menu.reload"), Reload),
                MenuItem::action(tr("native.menu.closeFile"), CloseFile),
                MenuItem::separator(),
                MenuItem::action(tr("native.execution.title"), ManageExecutions),
                MenuItem::action(tr("native.menu.closeWindow"), CloseWindow),
            ],
        },
        ui::input::edit_menu(|id| tr(&format!("native.menu.edit.{id}")).into()),
        crate::editor::actions::format_menu(|id| tr(&format!("native.menu.format.{id}")).into()),
        Menu {
            disabled: false,
            name: tr("native.menu.view").into(),
            items: vec![MenuItem::action(
                tr("native.menu.toggleSource"),
                ToggleMarkdownSource,
            )],
        },
        crate::features::sub_theme_catalog::theme_menu(|key| tr(key).into()),
        Menu {
            disabled: false,
            name: tr("native.menu.window").into(),
            items: vec![
                MenuItem::action(tr("native.menu.minimize"), Minimize),
                MenuItem::action(tr("native.menu.zoom"), Zoom),
            ],
        },
        Menu {
            disabled: false,
            name: tr("native.menu.help").into(),
            items: vec![MenuItem::action(tr("shell.feedback.label"), OpenHelp)],
        },
    ]
}
// App-level visibility commands need no window.
actions!(shell, [HideApp, HideOtherApps, ShowAllApps]);
/// The application-scoped menu actions (hide/show).
pub fn on_app_actions(cx: &mut App) {
    cx.on_action(|_: &HideApp, cx| cx.hide());
    cx.on_action(|_: &HideOtherApps, cx| cx.hide_other_apps());
    cx.on_action(|_: &ShowAllApps, cx| cx.unhide_other_apps());
    // Theme menu: the selection belongs to the effective colour mode.
    use crate::features::sub_theme_catalog::{self, OpenThemesFolder, SelectSubTheme};
    use crate::ui::appearance::ActiveAppearance as _;
    cx.on_action(|_: &OpenThemesFolder, cx| sub_theme_catalog::open_directory(cx));
    cx.on_action(|action: &SelectSubTheme, cx| {
        let Some(store) = super::windows::preferences(cx) else {
            return;
        };
        let (dark, id) = (cx.is_dark(), action.id.clone());
        store.update(cx, |p, cx| p.change(|p| p.sub_theme_ids.set(dark, id), cx));
    });
}
