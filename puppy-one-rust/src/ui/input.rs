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
    for modifier in ["cmd", "ctrl"] {
        cx.bind_keys([
            KeyBinding::new(&format!("{modifier}-a"), SelectAll, Some("TextInput")),
            KeyBinding::new(&format!("{modifier}-c"), Copy, Some("TextInput")),
            KeyBinding::new(&format!("{modifier}-x"), Cut, Some("TextInput")),
            KeyBinding::new(&format!("{modifier}-v"), Paste, Some("TextInput")),
            KeyBinding::new(&format!("{modifier}-z"), Undo, Some("TextInput")),
            KeyBinding::new(&format!("{modifier}-shift-z"), Redo, Some("TextInput")),
            KeyBinding::new(&format!("{modifier}-y"), Redo, Some("TextInput")),
        ]);
    }
}
/// The caller supplies display text for the stable item ids (`edit`, `undo`,
/// `redo`, `cut`, `copy`, `paste`, `selectAll`), keeping copy out of this primitive.
pub fn edit_menu(label: impl Fn(&'static str) -> SharedString) -> Menu {
    Menu {
        disabled: false,
        name: label("edit"),
        items: vec![
            MenuItem::os_action(label("undo"), Undo, OsAction::Undo),
            MenuItem::os_action(label("redo"), Redo, OsAction::Redo),
            MenuItem::separator(),
            MenuItem::os_action(label("cut"), Cut, OsAction::Cut),
            MenuItem::os_action(label("copy"), Copy, OsAction::Copy),
            MenuItem::os_action(label("paste"), Paste, OsAction::Paste),
            MenuItem::os_action(label("selectAll"), SelectAll, OsAction::SelectAll),
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
