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
    /// Close the active editor (the pane menu's close).
    CloseFile,
    /// ⌘W (`handleEditorShortcut`): the active editor of a project's
    /// documents closes; with none, the window does (the menu's Close Window).
    CloseEditorOrWindow,
    /// ⌃Tab / ⌃⇧Tab: the next or previous editor tab.
    NextEditor,
    PreviousEditor,
    /// View → Toggle Full Screen.
    ToggleFullScreen,
    /// Editor pane menu "Open in default app".
    OpenExternal,
    /// Close this window through its barrier (window close button, or one
    /// window's share of an app quit).
    Quit,
    /// ⌘Q / app menu Quit: every window closes through its own barrier.
    QuitApp,
    QuitWithProcesses,
    CancelProcessQuit,
    /// A close a document could not save for: "Keep Window Open" / "Close
    /// Anyway".
    KeepWindowOpen,
    CloseAnyway,
    /// A file window's unsaved edits on close: Save, Don't Save, Cancel.
    SaveFileAndClose,
    DiscardFileChanges,
    CancelFileClose,
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
    /// ⌘V outside a text field: a template link on the clipboard opens its
    /// card; anything else keeps its usual paste.
    PasteTemplateLink,
    /// ⌘/ or ⇧⌘M in a Markdown document: live view ↔ source
    /// (`isModeToggleShortcut`).
    ToggleMarkdownSource,
    ClearError,
    RetryFileOperation,
    Changes,
    /// Local Header → Share: the Cloud services dialog (`openCloudDialogAt`).
    CloudServices,
    /// Cloud Header → History (`CloudWorkspaceHeaderTools`).
    CloudHistory,
    /// The Cloud conflict notice's "Discard edits and reload".
    ReloadCloudBaseline,
    /// File → Manage Running Sessions (`file.manageExecutions`).
    ManageExecutions,
    /// File/Dock → New Window (`file.newWindow`, ⌘N).
    NewWindow,
    /// App menu → About PuppyOne (the system panel).
    About,
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
    PasteTemplateLink => PasteTemplateLink,
    ToggleMarkdownSource => ToggleMarkdownSource,
    ManageExecutions => ManageExecutions,
    NewWindow => NewWindow,
    About => About,
    CheckForUpdates => CheckForUpdates,
    Minimize => Minimize,
    Zoom => Zoom,
    CloseWindow => CloseEditorOrWindow,
    OpenHelp => Feedback,
    NextEditor => NextEditor,
    PreviousEditor => PreviousEditor,
    ToggleFullScreen => ToggleFullScreen,
}

/// The Dock menu (`createDockMenuTemplate`).
pub fn dock_menu() -> Vec<MenuItem> {
    vec![MenuItem::action(tr("native.dock.newWindow"), NewWindow)]
}

pub fn bind_keys(cx: &mut App) {
    for modifier in ["cmd", "ctrl"] {
        let key = |k: &str| format!("{modifier}-{k}");
        // The product's own shortcuts: the menu's ⌘, ⌘N ⌘W ⌘Q, ⌘S in a
        // document, ⌘/ and ⇧⌘M for Markdown's view, ⌘V on the Homepage.
        cx.bind_keys([
            KeyBinding::new(&key(","), OpenSettings, None),
            KeyBinding::new(&key("s"), Save, None),
            KeyBinding::new(&key("w"), CloseWindow, None),
            KeyBinding::new(&key("q"), Quit, None),
            KeyBinding::new(&key("n"), NewWindow, None),
            KeyBinding::new(&key("/"), ToggleMarkdownSource, None),
            KeyBinding::new(&key("shift-m"), ToggleMarkdownSource, None),
            KeyBinding::new(&key("v"), PasteTemplateLink, Some("Homepage")),
        ]);
    }
    cx.bind_keys([
        KeyBinding::new("ctrl-tab", NextEditor, None),
        KeyBinding::new("ctrl-shift-tab", PreviousEditor, None),
        KeyBinding::new("ctrl-cmd-f", ToggleFullScreen, None),
    ]);
    cx.bind_keys([
        KeyBinding::new("cmd-h", HideApp, None),
        KeyBinding::new("alt-cmd-h", HideOtherApps, None),
        KeyBinding::new("cmd-m", Minimize, None),
    ]);
    cx.bind_keys([KeyBinding::new("escape", Escape, None)]);
    super::explorer::bind_keys(cx);
}

/// The native menu bar (`createApplicationMenuTemplate`); rebuilt when the
/// locale changes. The product localizes its own commands; Electron's role
/// items and menus (`menu-item-roles`) keep Electron's English labels, and
/// the page-only View items (reload, developer tools, page zoom) have no
/// native window to act on.
pub fn app_menus() -> Vec<Menu> {
    let app = super::windows::APP_NAME;
    vec![
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
        // AppKit adds Bring All to Front and the window list to the menu
        // named "Window".
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
