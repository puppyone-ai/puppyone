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
    /// Whether closing the last window terminates the application.
    pub last_window_close_quits: bool,
    /// Whether the sidebar reserves bottom footer space for non-macOS navigation.
    pub sidebar_footer_visible: bool,
    /// Ordered OS-native UI + CJK fallback font families.
    pub ui_font_fallbacks: &'static [&'static str],
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
                last_window_close_quits: false,
                sidebar_footer_visible: false,
                ui_font_fallbacks: &["PingFang SC", "Hiragino Sans GB"],
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
                last_window_close_quits: true,
                sidebar_footer_visible: true,
                ui_font_fallbacks: &["Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei"],
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
                last_window_close_quits: true,
                sidebar_footer_visible: true,
                ui_font_fallbacks: &["Noto Sans CJK SC", "Noto Sans", "DejaVu Sans"],
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

        assert!(!mac.last_window_close_quits);
        assert!(win.last_window_close_quits);
        assert!(linux.last_window_close_quits);

        assert_eq!(mac.reveal_label_key, "workspace.node.revealInFinder");
        assert_eq!(win.reveal_label_key, "native.desktop.showInExplorer");
        assert_eq!(linux.reveal_label_key, "native.desktop.showInFiles");
    }
}
