//! Native menus and key bindings map into typed document commands at the bridge.
use gpui::*;
#[derive(Clone, PartialEq, serde::Deserialize, Action)]
#[action(no_json)]
pub(crate) struct EditorAction {
    pub name: String,
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
