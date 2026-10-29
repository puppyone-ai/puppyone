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
    Quit,
    QuitWithProcesses,
    CancelProcessQuit,
    OpenFolder,
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
    /// File → Manage Running Sessions (`file.manageExecutions`).
    ManageExecutions,
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
    Quit => Quit,
    Escape => Escape,
    ToggleMarkdownSource => ToggleMarkdownSource,
    ManageExecutions => ManageExecutions,
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
        ]);
    }
    cx.bind_keys([KeyBinding::new("escape", Escape, None)]);
    super::explorer::bind_keys(cx);
}

/// Native menu bar in the current locale; rebuilt when the locale changes.
pub fn app_menus() -> Vec<Menu> {
    vec![
        Menu {
            disabled: false,
            name: "PuppyOne".into(),
            items: vec![
                MenuItem::action(tr("native.menu.settings"), OpenSettings),
                MenuItem::separator(),
                MenuItem::action(tr("native.menu.quit"), Quit),
            ],
        },
        Menu {
            disabled: false,
            name: tr("native.menu.file").into(),
            items: vec![
                MenuItem::action(tr("shell.workspaceSwitcher.openFolder"), OpenFolder),
                MenuItem::action(tr("native.menu.reload"), Reload),
                MenuItem::action(tr("native.menu.closeFile"), CloseFile),
                MenuItem::separator(),
                MenuItem::action(tr("native.execution.title"), ManageExecutions),
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
    ]
}
