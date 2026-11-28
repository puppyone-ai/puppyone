//! Shared text-editing actions and the application Edit menu. Form fields
//! (`form_input`, GPUI Kit inputs) and the terminal handle these actions;
//! the OS menu dispatches them to whatever is focused.
use gpui::*;

actions!(text_input, [SelectAll, Paste, Cut, Copy, Undo, Redo]);

/// Installs GPUI Kit (its key bindings and theme) once per application,
/// and the edit shortcuts the Edit menu shows as its key equivalents.
pub fn bind_keys(cx: &mut App) {
    if cx.try_global::<gpui_kit::component::Theme>().is_none() {
        gpui_kit::init(cx);
    }
    cx.bind_keys([
        KeyBinding::new("secondary-a", SelectAll, Some("TextInput")),
        KeyBinding::new("secondary-c", Copy, Some("TextInput")),
        KeyBinding::new("secondary-x", Cut, Some("TextInput")),
        KeyBinding::new("secondary-v", Paste, Some("TextInput")),
        KeyBinding::new("secondary-z", Undo, Some("TextInput")),
        KeyBinding::new("secondary-shift-z", Redo, Some("TextInput")),
        KeyBinding::new("secondary-y", Redo, Some("TextInput")),
    ]);
    crate::ui::components::bind_menu_keys(cx);
    crate::ui::components::bind_hints(cx);
}
/// The caller supplies display text for the stable item ids (`edit`, `undo`,
/// `redo`, `cut`, `copy`, `paste`, `selectAll`), keeping copy out of this primitive.
pub fn edit_menu() -> Menu {
    // `role: "editMenu"` with Electron's labels.
    Menu {
        disabled: false,
        name: "Edit".into(),
        items: vec![
            MenuItem::os_action("Undo", Undo, OsAction::Undo),
            MenuItem::os_action("Redo", Redo, OsAction::Redo),
            MenuItem::separator(),
            MenuItem::os_action("Cut", Cut, OsAction::Cut),
            MenuItem::os_action("Copy", Copy, OsAction::Copy),
            MenuItem::os_action("Paste", Paste, OsAction::Paste),
            MenuItem::action("Paste and Match Style", Paste),
            MenuItem::os_action("Select All", SelectAll, OsAction::SelectAll),
        ],
    }
}

/// Byte offset of a UTF-16 offset (platform text input ranges).
pub fn utf16_to_byte(text: &str, offset: usize) -> usize {
    let mut units = 0;
    for (byte, c) in text.char_indices() {
        if units >= offset {
            return byte;
        }
        units += c.len_utf16();
    }
    text.len()
}
/// Bold / italic marks of one character.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Mark {
    pub bold: bool,
    pub italic: bool,
}
/// A field's text, marks and selection, for undo and restore.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InputSnapshot {
    pub text: String,
    pub marks: Vec<Mark>,
    pub anchor: usize,
    pub cursor: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn utf16_offsets_map_to_char_boundaries() {
        assert_eq!(utf16_to_byte("a中🐶b", 0), 0);
        assert_eq!(utf16_to_byte("a中🐶b", 2), 4);
        // The emoji is two UTF-16 units and four bytes.
        assert_eq!(utf16_to_byte("a中🐶b", 4), 8);
        assert_eq!(utf16_to_byte("a中🐶b", 9), 9);
    }
}
