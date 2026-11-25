//! Keyboard focus for document menus (`DesktopMenu`'s roving focus).
//! Pointer and keyboard activation share the row's action and close policy;
//! disabled and informational rows never participate in navigation.
//!
//! The arrows wrap and Home/End reach the ends; the keyboard starts on the
//! current choice. A row with a submenu opens it when it takes focus;
//! ArrowRight, Enter or Space move into it, and ArrowLeft or Escape there
//! close it and return to its row. Escape closes an open submenu before its
//! menu; Tab leaves the menu (its owner returns focus to the trigger).
//!
//! The keys are bindings in the menu's own context, so they win over the
//! surface the menu opened from (the Explorer's arrows, the window's Tab).
use super::*;

gpui::actions!(
    desktop_menu,
    [
        SelectNext,
        SelectPrevious,
        SelectFirst,
        SelectLast,
        Activate,
        OpenSubmenu,
        LeaveSubmenu,
        CloseSubmenu,
        LeaveMenu
    ]
);

/// The key context of a keyboard menu (`DesktopMenu`).
pub(super) const KEY_CONTEXT: &str = "DesktopMenu";

pub fn bind_keys(cx: &mut App) {
    let c = Some(KEY_CONTEXT);
    cx.bind_keys([
        KeyBinding::new("down", SelectNext, c),
        KeyBinding::new("up", SelectPrevious, c),
        KeyBinding::new("home", SelectFirst, c),
        KeyBinding::new("end", SelectLast, c),
        KeyBinding::new("enter", Activate, c),
        KeyBinding::new("space", Activate, c),
        KeyBinding::new("right", OpenSubmenu, c),
        KeyBinding::new("left", LeaveSubmenu, c),
        KeyBinding::new("escape", CloseSubmenu, c),
        KeyBinding::new("tab", LeaveMenu, c),
        KeyBinding::new("shift-tab", LeaveMenu, c),
    ]);
}

/// Where an arrow, Home or End moves.
#[derive(Clone, Copy)]
pub(super) enum Step {
    Next,
    Previous,
    First,
    Last,
}

enum Kind {
    Action { action: Handler, stays_open: bool },
    Submenu,
}

struct Row {
    id: ElementId,
    focus: FocusHandle,
    kind: Kind,
    /// The current choice (`aria-checked`): where the keyboard starts.
    current: bool,
}

/// A submenu's link back to the row that opened it.
#[derive(Clone)]
pub(super) struct Parent {
    pub(super) trigger: FocusHandle,
    /// The opening menu's submenus.
    pub(super) coordinator: Entity<SubmenuCoordinator>,
    pub(super) row: ElementId,
}

pub(super) struct Keyboard {
    pub(super) scope: FocusHandle,
    rows: Vec<Row>,
    /// This menu's own submenus.
    coordinator: Option<Entity<SubmenuCoordinator>>,
    dismiss: Option<Handler>,
    escape: Option<Handler>,
    parent: Option<Parent>,
}

impl Keyboard {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn new(
        id: &ElementId,
        entries: &[MenuEntry],
        coordinator: Option<Entity<SubmenuCoordinator>>,
        dismiss: Option<Handler>,
        escape: Option<Handler>,
        parent: Option<Parent>,
        scope: Option<FocusHandle>,
        window: &mut Window,
        cx: &mut App,
    ) -> Self {
        let mut rows = Vec::new();
        let mut add = |fallback: ElementId, item: &MenuItem| {
            if item.disabled || item.fact || item.line {
                return;
            }
            let row_id = item.id.clone().unwrap_or(fallback);
            let kind = match (&item.submenu, &item.on_click) {
                (Some(_), _) => Kind::Submenu,
                (None, Some(action)) => Kind::Action {
                    action: action.clone(),
                    stays_open: item.stay_open,
                },
                (None, None) => return,
            };
            let focus = window
                .use_keyed_state(child_id(&row_id, "keyboard-focus"), cx, |_, cx| {
                    cx.focus_handle()
                })
                .read(cx)
                .clone();
            rows.push(Row {
                id: row_id,
                focus,
                kind,
                current: item.radio == Some(true) || item.checked == Some(true),
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
        let needs_focus = match &parent {
            // A submenu takes focus only when the keyboard moves into it.
            Some(parent) => parent.coordinator.update(cx, |s, _| {
                let entered = s.entered && s.active.as_ref() == Some(&parent.row);
                s.entered = false;
                entered
            }),
            None => {
                previous_rows.is_empty()
                    || (previous_rows.iter().any(|focus| focus.is_focused(window))
                        && !rows.iter().any(|row| row.focus.is_focused(window)))
            }
        };
        if needs_focus {
            rows.iter()
                .find(|row| row.current)
                .or(rows.first())
                .map_or(&scope, |row| &row.focus)
                .focus(window, cx);
        }
        previous.update(cx, |previous, _| {
            *previous = rows.iter().map(|row| row.focus.clone()).collect()
        });
        Self {
            rows,
            coordinator,
            dismiss,
            escape,
            parent,
            scope,
        }
    }

    pub(super) fn focus(&self, id: &ElementId) -> Option<FocusHandle> {
        self.rows
            .iter()
            .find(|row| &row.id == id)
            .map(|row| row.focus.clone())
    }

    /// Opens `row`'s submenu (`entered`: and moves the keyboard into it),
    /// or with `None` closes the open one.
    fn show(&self, row: Option<&ElementId>, entered: bool, cx: &mut App) {
        if let Some(coordinator) = &self.coordinator {
            coordinator.update(cx, |s, cx| {
                if s.active.as_ref() != row || s.entered != entered {
                    s.epoch += 1;
                    s.active = row.cloned();
                    s.entered = entered;
                    cx.notify();
                }
            });
        }
    }

    /// Moves focus to row `index`: a submenu row opens its submenu (without
    /// entering it); any other row closes the open one.
    fn focus_row(&self, index: usize, window: &mut Window, cx: &mut App) {
        let row = &self.rows[index];
        let submenu = matches!(row.kind, Kind::Submenu).then_some(&row.id);
        self.show(submenu, false, cx);
        row.focus.focus(window, cx);
    }

    /// Escape: an open submenu closes and its row keeps focus; in a submenu,
    /// the submenu itself closes. `false` when the menu has none of these.
    pub(super) fn close_submenu(&self, window: &mut Window, cx: &mut App) -> bool {
        if let Some(parent) = &self.parent {
            parent.coordinator.update(cx, |s, cx| {
                s.epoch += 1;
                s.active = None;
                s.entered = false;
                cx.notify();
            });
            parent.trigger.focus(window, cx);
            return true;
        }
        let open = self
            .coordinator
            .as_ref()
            .and_then(|coordinator| coordinator.read(cx).active.clone());
        let Some(open) = open else {
            return false;
        };
        self.show(None, false, cx);
        if let Some(row) = self.rows.iter().find(|row| row.id == open) {
            row.focus.focus(window, cx);
        }
        true
    }

    /// The Escape action: a submenu first, then the menu's own Escape;
    /// otherwise the surface around the menu answers.
    pub(super) fn escape(&self, window: &mut Window, cx: &mut App) {
        if self.close_submenu(window, cx) {
            return;
        }
        match &self.escape {
            Some(escape) => escape(window, cx),
            None => cx.propagate(),
        }
    }

    /// Tab: the menu closes; its owner returns focus to the trigger.
    pub(super) fn leave(&self, window: &mut Window, cx: &mut App) {
        match &self.dismiss {
            Some(dismiss) => dismiss(window, cx),
            None => cx.propagate(),
        }
    }

    fn current(&self, window: &Window) -> Option<usize> {
        self.rows
            .iter()
            .position(|row| row.focus.is_focused(window))
    }

    /// The arrows, Home and End.
    pub(super) fn step(&self, step: Step, window: &mut Window, cx: &mut App) {
        if self.rows.is_empty() {
            return cx.propagate();
        }
        let (current, last) = (self.current(window), self.rows.len() - 1);
        let next = match step {
            Step::First => 0,
            Step::Last => last,
            Step::Next => current.map_or(0, |i| (i + 1) % self.rows.len()),
            Step::Previous => current.map_or(last, |i| (i + last) % self.rows.len()),
        };
        self.focus_row(next, window, cx);
    }

    /// Enter or Space: the row's action (a submenu row opens and is
    /// entered); ArrowRight only enters a submenu.
    pub(super) fn activate(&self, submenu_only: bool, window: &mut Window, cx: &mut App) {
        let Some(row) = self.current(window).map(|i| &self.rows[i]) else {
            return cx.propagate();
        };
        match &row.kind {
            Kind::Submenu => self.show(Some(&row.id), true, cx),
            Kind::Action { .. } if submenu_only => cx.propagate(),
            Kind::Action { action, stays_open } => {
                action(window, cx);
                if *stays_open {
                    row.focus.focus(window, cx);
                } else if let Some(dismiss) = &self.dismiss {
                    dismiss(window, cx);
                }
            }
        }
    }

    /// ArrowLeft in a submenu: back to its row.
    pub(super) fn leave_submenu(&self, window: &mut Window, cx: &mut App) {
        if self.parent.is_none() || !self.close_submenu(window, cx) {
            cx.propagate();
        }
    }
}
