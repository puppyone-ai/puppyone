//! Shell commands. Keyboard shortcuts and the native menu bar dispatch typed
//! GPUI actions; every action, button and protocol message resolves to one
//! [`Command`] handled by `Shell::command`.
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
    #[cfg(any(test, feature = "dev-capture"))]
    ProjectMenu,
    #[cfg(any(test, feature = "dev-capture"))]
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
    /// Cloud Header → History (`CloudWorkspaceHeaderTools`).
    CloudHistory,
    /// `DP-05` Exit 1: open read-only comparison view for a held Cloud conflict.
    CompareCloudConflict,
    /// `DP-05` Exit 2: rebase local draft onto remote revision and write.
    KeepLocalCloudDraft,
    /// `DP-05` Exit 3: accept remote baseline and clear conflict.
    ReloadCloudBaseline,
    /// `DP-05` Exit 4: save local draft as `<stem> (conflict copy).<ext>` and reload original.
    SaveConflictCopy,
    /// `DP-31`: normalize mixed/`CR` line endings and thaw editor to read-write.
    NormalizeLineEndings,
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
    /// `WB-02`: explicitly unload a clean background project without closing the window.
    CloseBackgroundProject,
}
impl Command {
    /// The editor host protocol names pane-menu commands (`ClientMessage::Action`).
    pub fn from_protocol(name: &str) -> Option<Self> {
        Some(match name {
            "open-external" => Self::OpenExternal,
            "close-file" => Self::CloseFile,
            "save" => Self::Save,
            "reload" => Self::Reload,
            "normalize-line-endings" => Self::NormalizeLineEndings,
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
    CloseBackgroundProject => CloseBackgroundProject,
}

pub use super::menus::app_menus;

/// The window's command router: what each [`Command`] does to the window
/// and the owners it routes to.
mod events;
mod pump;
mod route;
