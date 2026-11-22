//! Unified application menus and global keybindings (`window-chrome-and-menus.md`).
//!
//! One menu model drives both the macOS system menu bar (`cx.set_menus`) and
//! the in-window menu bar rendered inside the title bar on Windows and Linux.
pub mod keymap;
pub mod model;

pub use keymap::{bind_keys, on_app_actions};
pub use model::{app_menus, dock_menu};
