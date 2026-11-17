//! Keyboard focus for flat document menus. Pointer and keyboard activation
//! share the row's action and close policy; disabled and informational rows
//! never participate in navigation.
use super::*;

struct Row {
    id: ElementId,
    focus: FocusHandle,
    action: Handler,
    stays_open: bool,
}

pub(super) struct Keyboard {
    pub(super) scope: FocusHandle,
    rows: Vec<Row>,
    dismiss: Option<Handler>,
}

impl Keyboard {
    pub(super) fn new(
        id: &ElementId,
        entries: &[MenuEntry],
        dismiss: Option<Handler>,
        scope: Option<FocusHandle>,
        window: &mut Window,
        cx: &mut App,
    ) -> Self {
        let mut rows = Vec::new();
        let mut add = |fallback: ElementId, item: &MenuItem| {
            if item.disabled || item.fact || item.line || item.submenu.is_some() {
                return;
            }
            let Some(action) = item.on_click.clone() else {
                return;
            };
            let row_id = item.id.clone().unwrap_or(fallback);
            let focus = window
                .use_keyed_state(child_id(&row_id, "keyboard-focus"), cx, |_, cx| {
                    cx.focus_handle()
                })
                .read(cx)
                .clone();
            rows.push(Row {
                id: row_id,
                focus,
                action,
                stays_open: item.stay_open,
            });
        };
        for (index, entry) in entries.iter().enumerate() {
            match entry {
                MenuEntry::Item(item) => add(child_id(id, index.to_string()), item),
                MenuEntry::List(items, _) => {
                    for (row_index, item) in items.iter().enumerate() {
                        add(child_id(id, format!("{index}-{row_index}")), item);
                    }
                }
                _ => {}
            }
        }
        let scope = scope.unwrap_or_else(|| {
            window
                .use_keyed_state(child_id(id, "keyboard-scope"), cx, |_, cx| {
                    cx.focus_handle()
                })
                .read(cx)
                .clone()
        });
        let previous = window.use_keyed_state(child_id(id, "keyboard-rows"), cx, |_, _| {
            Vec::<FocusHandle>::new()
        });
        let previous_rows = previous.read(cx);
        let needs_focus = previous_rows.is_empty()
            || (previous_rows.iter().any(|focus| focus.is_focused(window))
                && !rows.iter().any(|row| row.focus.is_focused(window)));
        if needs_focus {
            rows.first()
                .map_or(&scope, |row| &row.focus)
                .focus(window, cx);
        }
        previous.update(cx, |previous, _| {
            *previous = rows.iter().map(|row| row.focus.clone()).collect()
        });
        Self {
            rows,
            dismiss,
            scope,
        }
    }

    pub(super) fn focus(&self, id: &ElementId) -> Option<FocusHandle> {
        self.rows
            .iter()
            .find(|row| &row.id == id)
            .map(|row| row.focus.clone())
    }

    pub(super) fn key_down(&self, event: &KeyDownEvent, window: &mut Window, cx: &mut App) -> bool {
        if self.rows.is_empty() || event.keystroke.modifiers != Modifiers::default() {
            return false;
        }
        let current = self
            .rows
            .iter()
            .position(|row| row.focus.is_focused(window));
        let next = match event.keystroke.key.as_str() {
            "home" => 0,
            "end" => self.rows.len() - 1,
            "down" => current.map_or(0, |i| (i + 1) % self.rows.len()),
            "up" => current.map_or(self.rows.len() - 1, |i| {
                (i + self.rows.len() - 1) % self.rows.len()
            }),
            "enter" | "space" => {
                let Some(index) = current else { return false };
                cx.stop_propagation();
                window.prevent_default();
                let row = &self.rows[index];
                (row.action)(window, cx);
                if row.stays_open {
                    row.focus.focus(window, cx);
                } else if let Some(dismiss) = &self.dismiss {
                    dismiss(window, cx);
                }
                return true;
            }
            _ => return false,
        };
        cx.stop_propagation();
        window.prevent_default();
        self.rows[next].focus.focus(window, cx);
        true
    }
}
