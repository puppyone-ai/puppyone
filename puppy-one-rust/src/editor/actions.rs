//! Native menus and key bindings map into typed document commands at the bridge.
use gpui::*;
#[derive(Clone, PartialEq, serde::Deserialize, Action)]
#[action(no_json)]
pub(crate) struct EditorAction {
    pub name: String,
}
/// Display text comes from the caller, keyed by the command name (plus
/// `format` for the menu title), so the editor adapter owns no copy.
pub fn format_menu(label: impl Fn(&'static str) -> SharedString) -> Menu {
    let item =
        |name: &'static str| MenuItem::action(label(name), EditorAction { name: name.into() });
    Menu {
        name: label("format"),
        disabled: false,
        items: vec![
            item("bold"),
            item("italic"),
            MenuItem::separator(),
            item("paragraph"),
            item("h1"),
            item("h2"),
            item("quote"),
            MenuItem::separator(),
            item("new-table"),
            item("add-row"),
            item("add-column"),
            item("delete-row"),
            item("delete-column"),
        ],
    }
}
pub fn bind_keys(cx: &mut App) {
    for modifier in ["cmd", "ctrl"] {
        for (key, name) in [("b", "bold"), ("i", "italic"), ("enter", "new-paragraph")] {
            cx.bind_keys([KeyBinding::new(
                &format!("{modifier}-{key}"),
                EditorAction { name: name.into() },
                Some("NativeMarkdown"),
            )]);
        }
    }
}
