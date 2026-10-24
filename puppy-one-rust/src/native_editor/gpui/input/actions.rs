use super::*;
actions!(
    text_input,
    [
        Backspace,
        Delete,
        Left,
        Right,
        SelectLeft,
        SelectRight,
        SelectAll,
        Home,
        End,
        LineStart,
        LineEnd,
        SelectLineStart,
        SelectLineEnd,
        SelectStart,
        SelectEnd,
        WordLeft,
        WordRight,
        SelectWordLeft,
        SelectWordRight,
        ShowCharacterPalette,
        Paste,
        Cut,
        Copy,
        Undo,
        Redo,
        Enter,
        SoftEnter,
        Tab,
        BackTab,
        Up,
        Down,
        SelectUp,
        SelectDown
    ]
);
pub fn bind_keys(cx: &mut App) {
    if cx.try_global::<gpui_kit::component::Theme>().is_none() {
        gpui_kit::init(cx);
    }
    cx.bind_keys([
        KeyBinding::new("backspace", Backspace, Some("TextInput")),
        KeyBinding::new("delete", Delete, Some("TextInput")),
        KeyBinding::new("left", Left, Some("TextInput")),
        KeyBinding::new("right", Right, Some("TextInput")),
        KeyBinding::new("shift-left", SelectLeft, Some("TextInput")),
        KeyBinding::new("shift-right", SelectRight, Some("TextInput")),
        KeyBinding::new("up", Up, Some("TextInput")),
        KeyBinding::new("down", Down, Some("TextInput")),
        KeyBinding::new("shift-up", SelectUp, Some("TextInput")),
        KeyBinding::new("shift-down", SelectDown, Some("TextInput")),
        KeyBinding::new("home", Home, Some("TextInput")),
        KeyBinding::new("cmd-up", Home, Some("TextInput")),
        KeyBinding::new("cmd-down", End, Some("TextInput")),
        KeyBinding::new("cmd-shift-up", SelectStart, Some("TextInput")),
        KeyBinding::new("cmd-shift-down", SelectEnd, Some("TextInput")),
        KeyBinding::new("cmd-shift-left", SelectLineStart, Some("TextInput")),
        KeyBinding::new("cmd-shift-right", SelectLineEnd, Some("TextInput")),
        KeyBinding::new("alt-left", WordLeft, Some("TextInput")),
        KeyBinding::new("alt-right", WordRight, Some("TextInput")),
        KeyBinding::new("alt-shift-left", SelectWordLeft, Some("TextInput")),
        KeyBinding::new("alt-shift-right", SelectWordRight, Some("TextInput")),
        KeyBinding::new("end", End, Some("TextInput")),
        KeyBinding::new("enter", Enter, Some("TextInput")),
        KeyBinding::new("shift-enter", SoftEnter, Some("TextInput")),
        KeyBinding::new("tab", Tab, Some("TextInput")),
        KeyBinding::new("shift-tab", BackTab, Some("TextInput")),
    ]);
    for modifier in ["cmd", "ctrl"] {
        cx.bind_keys([
            KeyBinding::new(&format!("{modifier}-left"), LineStart, Some("TextInput")),
            KeyBinding::new(&format!("{modifier}-right"), LineEnd, Some("TextInput")),
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
