//! Pure-data UI conventions for each desktop OS (`window-chrome-and-menus.md`).
//! Upper layers read [`Conventions::current()`] instead of branching on
//! `cfg(target_os)`. Tests may call [`Conventions::for_os`] to verify rendering
//! for any platform on any host.
use super::os::Os;

/// Which side of the title bar carries window control buttons.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WindowControlsSide {
    /// macOS traffic lights on the leading (left) edge.
    Leading,
    /// Windows / Linux minimize, maximize, and close buttons on the trailing (right) edge.
    Trailing,
}

/// Native start-at-login mechanism supported by this OS.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartAtLoginMechanism {
    /// macOS `~/Library/LaunchAgents/<label>.plist`.
    LaunchAgent,
    /// No native start-at-login registration implemented on this OS.
    Unsupported,
}

/// Default non-sandboxed shell family for local host execution fixtures.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostShellKind {
    /// POSIX `/bin/sh -c`.
    PosixSh,
    /// Windows `cmd.exe /C`.
    CmdExe,
}

/// Pure UI convention table for one operating system.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Conventions {
    pub os: Os,
    /// Localization key for revealing a file in the OS file manager.
    pub reveal_label_key: &'static str,
    /// Localization key for the HTML file-window reveal action.
    pub html_reveal_label_key: &'static str,
    /// Localization key for "This Mac" vs "This computer".
    pub this_computer_label_key: &'static str,
    /// Localization key for the Homepage "On this Mac" vs "Local only" group.
    pub onboarding_local_only_key: &'static str,
    /// Localization key for the Computer Mode "This Mac" vs "This computer" header.
    pub onboarding_computer_mode_title_key: &'static str,
    /// Localization key for paste shortcut hint in Cloud invite views.
    pub paste_shortcut_key: &'static str,
    /// Display symbol/prefix for the primary command modifier (`⌘` vs `Ctrl+`).
    pub primary_modifier_symbol: &'static str,
    /// Display symbol/prefix for the alternate modifier (`⌥` vs `Alt+`).
    pub alt_modifier_symbol: &'static str,
    /// Display symbol/prefix for the shift modifier (`⇧` vs `Shift+`).
    pub shift_modifier_symbol: &'static str,
    /// Leading (macOS) vs trailing (Windows/Linux) window control buttons.
    pub window_controls_side: WindowControlsSide,
    /// Whether the OS hosts a global top system menu bar (macOS) vs an
    /// in-window menu bar rendered inside the title bar (Windows/Linux).
    pub uses_system_menu_bar: bool,
    /// Whether the app renders custom minimize/maximize/close window controls
    /// inside the client title bar.
    pub uses_custom_titlebar_controls: bool,
    /// Whether the platform window should request explicit client-side window
    /// decorations from GPUI.
    pub uses_client_window_decorations: bool,
    /// Whether custom trailing caption buttons must gate on
    /// `Decorations::Client` (true on Linux X11/Wayland to avoid double title
    /// bars under server-side decorations; false on Windows, where GPUI hides
    /// the OS title bar via `appears_transparent` while reporting
    /// `Decorations::Server`).
    pub caption_controls_depend_on_csd: bool,
    /// Whether GPUI's native non-client hit-testing (`WM_NCHITTEST` /
    /// `WindowControlArea`) owns caption button clicks, Snap Layouts,
    /// titlebar dragging, double-click maximize/restore, and right-click
    /// system menus (Windows). When true, views must not intercept those
    /// regions with `on_mouse_down` + `stop_propagation()`.
    pub native_nonclient_window_controls: bool,
    /// Whether the in-window menu bar collapses into a single compact menu
    /// button on the leading edge of the title bar (modern Windows / Linux).
    pub compact_app_menu: bool,
    /// Whether closing the last window terminates the application.
    pub last_window_close_quits: bool,
    /// Whether the sidebar reserves bottom footer space for utility launchers
    /// (Settings / Feedback). Disabled on every desktop OS once Settings and
    /// Help/Feedback live in the system menu bar (macOS) or the top-left
    /// compact title-bar menu (Windows / Linux).
    pub sidebar_footer_visible: bool,
    /// Whether text editors install Emacs-style `Ctrl+A`/`Ctrl+E`/`Ctrl+D` line
    /// navigation bindings (standard on macOS, where `Ctrl` is separate from `Cmd`).
    pub emacs_line_bindings: bool,
    /// Whether terminal clipboard shortcuts use the platform modifier (`Cmd+C/V/A`
    /// on macOS) instead of `Ctrl+Shift+C/V/A` (Windows/Linux).
    pub terminal_clipboard_uses_platform_modifier: bool,
    /// Whether shell keybindings include macOS app-visibility shortcuts (`Hide`,
    /// `Hide Others`, `Minimize`, `Ctrl+Cmd+F`) instead of `F11` fullscreen.
    pub has_macos_app_visibility_shortcuts: bool,
    /// Whether the sans-serif UI font stack appends OS CJK fallback families
    /// explicitly (needed on Windows/Linux; macOS CoreText cascades system UI).
    pub append_ui_font_fallbacks: bool,
    /// Ordered OS-native UI + CJK fallback font families.
    pub ui_font_fallbacks: &'static [&'static str],
    /// The platform's monospaced face: SF Mono (`ui-monospace`) on macOS.
    pub mono_font: &'static str,
    /// The platform's serif face: New York (`ui-serif`) on macOS.
    pub serif_font: &'static str,
    /// Whether CSS `ui-monospace` and `ui-serif` name system faces GPUI can
    /// load (macOS's SF Mono and New York); elsewhere they name none.
    pub system_keyword_faces: bool,
    /// Default built-in Git credential helper when no explicit helper is configured.
    pub default_git_credential_helper: Option<&'static str>,
    /// Native mechanism for starting the local host daemon at login.
    pub start_at_login_mechanism: StartAtLoginMechanism,
    /// Default non-sandboxed shell family for local host execution fixtures.
    pub host_shell_kind: HostShellKind,
    /// Whether managed in-app local agent installation candidates are probed.
    pub supports_managed_agent_installs: bool,
}

impl Conventions {
    /// Conventions for the host OS this binary targets.
    pub const fn current() -> Self {
        Self::for_os(Os::current())
    }

    /// Conventions for a specific OS (deterministic for cross-OS UI testing).
    pub const fn for_os(os: Os) -> Self {
        match os {
            Os::Macos => Self {
                os,
                reveal_label_key: "workspace.node.revealInFinder",
                html_reveal_label_key: "fileMode.html.revealInFinder",
                this_computer_label_key: "shell.workspaceSwitcher.location.thisMac",
                onboarding_local_only_key: "onboarding.sharing.thisMac",
                onboarding_computer_mode_title_key: "onboarding.computerMode.thisMacTitle",
                paste_shortcut_key: "cloud.share.agent.invite.scene.pasteMac",
                primary_modifier_symbol: "⌘",
                alt_modifier_symbol: "⌥",
                shift_modifier_symbol: "⇧",
                window_controls_side: WindowControlsSide::Leading,
                uses_system_menu_bar: true,
                uses_custom_titlebar_controls: false,
                uses_client_window_decorations: false,
                caption_controls_depend_on_csd: false,
                native_nonclient_window_controls: false,
                compact_app_menu: false,
                last_window_close_quits: false,
                sidebar_footer_visible: false,
                emacs_line_bindings: true,
                terminal_clipboard_uses_platform_modifier: true,
                has_macos_app_visibility_shortcuts: true,
                append_ui_font_fallbacks: false,
                ui_font_fallbacks: &["PingFang SC", "Hiragino Sans GB"],
                mono_font: ".AppleSystemUIFontMonospaced",
                serif_font: ".AppleSystemUIFontSerif",
                system_keyword_faces: true,
                default_git_credential_helper: Some("osxkeychain"),
                start_at_login_mechanism: StartAtLoginMechanism::LaunchAgent,
                host_shell_kind: HostShellKind::PosixSh,
                supports_managed_agent_installs: true,
            },
            Os::Windows => Self {
                os,
                reveal_label_key: "native.desktop.showInExplorer",
                html_reveal_label_key: "native.desktop.showInExplorer",
                this_computer_label_key: "shell.workspaceSwitcher.location.thisComputer",
                onboarding_local_only_key: "onboarding.sharing.localOnly",
                onboarding_computer_mode_title_key: "onboarding.computerMode.thisComputerTitle",
                paste_shortcut_key: "cloud.share.agent.invite.scene.pasteOther",
                primary_modifier_symbol: "Ctrl+",
                alt_modifier_symbol: "Alt+",
                shift_modifier_symbol: "Shift+",
                window_controls_side: WindowControlsSide::Trailing,
                uses_system_menu_bar: false,
                uses_custom_titlebar_controls: true,
                uses_client_window_decorations: true,
                caption_controls_depend_on_csd: false,
                native_nonclient_window_controls: true,
                compact_app_menu: true,
                last_window_close_quits: true,
                sidebar_footer_visible: false,
                emacs_line_bindings: false,
                terminal_clipboard_uses_platform_modifier: false,
                has_macos_app_visibility_shortcuts: false,
                append_ui_font_fallbacks: true,
                ui_font_fallbacks: &["Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei"],
                mono_font: "Consolas",
                serif_font: "Georgia",
                system_keyword_faces: false,
                default_git_credential_helper: None,
                start_at_login_mechanism: StartAtLoginMechanism::Unsupported,
                host_shell_kind: HostShellKind::CmdExe,
                supports_managed_agent_installs: false,
            },
            Os::Linux | Os::Other => Self {
                os,
                reveal_label_key: "native.desktop.showInFiles",
                html_reveal_label_key: "native.desktop.showInFiles",
                this_computer_label_key: "shell.workspaceSwitcher.location.thisComputer",
                onboarding_local_only_key: "onboarding.sharing.localOnly",
                onboarding_computer_mode_title_key: "onboarding.computerMode.thisComputerTitle",
                paste_shortcut_key: "cloud.share.agent.invite.scene.pasteOther",
                primary_modifier_symbol: "Ctrl+",
                alt_modifier_symbol: "Alt+",
                shift_modifier_symbol: "Shift+",
                window_controls_side: WindowControlsSide::Trailing,
                uses_system_menu_bar: false,
                uses_custom_titlebar_controls: true,
                uses_client_window_decorations: false,
                caption_controls_depend_on_csd: true,
                native_nonclient_window_controls: false,
                compact_app_menu: true,
                last_window_close_quits: true,
                sidebar_footer_visible: false,
                emacs_line_bindings: false,
                terminal_clipboard_uses_platform_modifier: false,
                has_macos_app_visibility_shortcuts: false,
                append_ui_font_fallbacks: true,
                ui_font_fallbacks: &["Noto Sans CJK SC", "Noto Sans", "DejaVu Sans"],
                mono_font: "DejaVu Sans Mono",
                serif_font: "DejaVu Serif",
                system_keyword_faces: false,
                default_git_credential_helper: None,
                start_at_login_mechanism: StartAtLoginMechanism::Unsupported,
                host_shell_kind: HostShellKind::PosixSh,
                supports_managed_agent_installs: false,
            },
        }
    }

    /// Formats a primary-modifier shortcut label (e.g. `"⌘C"` on macOS, `"Ctrl+C"` elsewhere).
    pub fn format_primary_shortcut(&self, key: &str) -> String {
        format!("{}{key}", self.primary_modifier_symbol)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conventions_differ_cleanly_across_all_three_desktop_oses() {
        let mac = Conventions::for_os(Os::Macos);
        let win = Conventions::for_os(Os::Windows);
        let linux = Conventions::for_os(Os::Linux);

        assert_eq!(mac.format_primary_shortcut("C"), "⌘C");
        assert_eq!(win.format_primary_shortcut("C"), "Ctrl+C");
        assert_eq!(linux.format_primary_shortcut("C"), "Ctrl+C");

        assert_eq!(mac.window_controls_side, WindowControlsSide::Leading);
        assert_eq!(win.window_controls_side, WindowControlsSide::Trailing);
        assert_eq!(linux.window_controls_side, WindowControlsSide::Trailing);

        assert!(mac.uses_system_menu_bar);
        assert!(!win.uses_system_menu_bar);
        assert!(!linux.uses_system_menu_bar);

        assert!(!mac.uses_custom_titlebar_controls);
        assert!(win.uses_custom_titlebar_controls);
        assert!(linux.uses_custom_titlebar_controls);

        assert!(!win.caption_controls_depend_on_csd);
        assert!(linux.caption_controls_depend_on_csd);
        assert!(win.native_nonclient_window_controls);
        assert!(!mac.native_nonclient_window_controls);
        assert!(!linux.native_nonclient_window_controls);
        assert!(!mac.compact_app_menu);
        assert!(win.compact_app_menu);
        assert!(linux.compact_app_menu);

        assert!(!mac.sidebar_footer_visible);
        assert!(!win.sidebar_footer_visible);
        assert!(!linux.sidebar_footer_visible);

        assert!(!mac.last_window_close_quits);
        assert!(win.last_window_close_quits);
        assert!(linux.last_window_close_quits);

        assert_eq!(mac.reveal_label_key, "workspace.node.revealInFinder");
        assert_eq!(win.reveal_label_key, "native.desktop.showInExplorer");
        assert_eq!(linux.reveal_label_key, "native.desktop.showInFiles");
    }
}
