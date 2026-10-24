//! The editable-table action menu (`.po-editable-table-context-menu`,
//! CsvTableMenu.tsx): a 236px `desktop-menu-surface` of icon toolbars, one per
//! section (rows / columns / layout), each item a 32px icon button with its
//! label as tooltip. Arrow keys, Home / End and type-ahead move between
//! enabled items; Enter / Space run one; Escape closes and returns focus;
//! pressing outside closes.
use super::operation::Alignment;
use crate::{
    localization::t,
    theme::{self, Theme, metric},
    ui::components::{MenuVariant, tooltip},
};
use gpui::{prelude::*, *};

#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    /// What the owner runs (`operation.type` / `id`).
    pub id: &'static str,
    /// `table-<icon>.svg` (editableTableMenuIcons.ts).
    pub icon: &'static str,
    pub label: SharedString,
    pub disabled: bool,
    pub danger: bool,
    /// A radio item's current choice (`.selected`).
    pub selected: bool,
}

impl Item {
    pub fn new(id: &'static str, icon: &'static str, label: impl Into<SharedString>) -> Self {
        Self {
            id,
            icon,
            label: label.into(),
            disabled: false,
            danger: false,
            selected: false,
        }
    }
    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }
    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
    pub fn danger(mut self) -> Self {
        self.danger = true;
        self
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum MenuEvent {
    Run(&'static str),
    /// `onClose(restoreFocus)`.
    Dismiss {
        restore_focus: bool,
    },
}

pub struct TableMenu {
    sections: Vec<Vec<Item>>,
    dark: bool,
    focus: FocusHandle,
    /// The item keyboard focus is on (flattened index).
    selected: Option<usize>,
    /// `:focus-visible`: only after keyboard navigation.
    keyboard: bool,
}

impl EventEmitter<MenuEvent> for TableMenu {}

impl Focusable for TableMenu {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

/// The menu's width (`.po-editable-table-context-menu { width: 236px }`).
pub const WIDTH: f32 = 236.;

impl TableMenu {
    pub fn new(sections: Vec<Vec<Item>>, dark: bool, cx: &mut Context<Self>) -> Self {
        let mut this = Self {
            sections,
            dark,
            focus: cx.focus_handle(),
            selected: None,
            keyboard: false,
        };
        // The first enabled item takes focus on open.
        this.selected = this.enabled().first().copied();
        this
    }

    fn items(&self) -> impl Iterator<Item = &Item> {
        self.sections.iter().flatten()
    }

    fn enabled(&self) -> Vec<usize> {
        self.items()
            .enumerate()
            .filter(|(_, i)| !i.disabled)
            .map(|(n, _)| n)
            .collect()
    }

    fn run(&mut self, index: usize, cx: &mut Context<Self>) {
        if let Some(item) = self.items().nth(index).filter(|i| !i.disabled) {
            let id = item.id;
            cx.emit(MenuEvent::Run(id));
            cx.emit(MenuEvent::Dismiss {
                restore_focus: false,
            });
        }
    }

    /// `handleMenuKeyDown`.
    fn key(&mut self, event: &KeyDownEvent, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        if key == "escape" {
            cx.stop_propagation();
            cx.emit(MenuEvent::Dismiss {
                restore_focus: true,
            });
            return;
        }
        let enabled = self.enabled();
        if enabled.is_empty() {
            return;
        }
        let current = self
            .selected
            .and_then(|s| enabled.iter().position(|e| *e == s));
        let n = enabled.len();
        let next = match key {
            "down" | "right" => Some(current.map_or(0, |c| (c + 1) % n)),
            "up" | "left" => Some(current.map_or(n - 1, |c| (c + n - 1) % n)),
            "home" => Some(0),
            "end" => Some(n - 1),
            "enter" | "space" => {
                if let Some(c) = current {
                    cx.stop_propagation();
                    self.run(enabled[c], cx);
                }
                return;
            }
            _ => {
                let m = &event.keystroke.modifiers;
                let typed = event.keystroke.key_char.as_deref().filter(|c| {
                    c.chars().count() == 1 && *c != " " && !m.alt && !m.control && !m.platform
                });
                typed.and_then(|c| {
                    let query = c.to_lowercase();
                    let items: Vec<&Item> = self.items().collect();
                    (1..=n)
                        .map(|offset| (current.map_or(n - 1, |c| c) + offset) % n)
                        .find(|&k| items[enabled[k]].label.to_lowercase().starts_with(&query))
                })
            }
        };
        if let Some(next) = next {
            cx.stop_propagation();
            self.selected = Some(enabled[next]);
            self.keyboard = true;
            cx.notify();
        }
    }
}

impl Render for TableMenu {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = Theme::new(self.dark);
        let selected = self.selected.filter(|_| self.keyboard);
        let mut index = 0;
        let mut surface = div()
            .id("po-editable-table-context-menu")
            .track_focus(&self.focus)
            .occlude()
            .flex()
            .flex_col()
            .w(px(WIDTH))
            .p(px(metric::MENU_PADDING))
            .border_1()
            .border_color(t.border)
            .rounded(px(metric::MENU_RADIUS))
            .bg(t.menu_bg)
            .shadow(MenuVariant::Default.shadow(t))
            .on_key_down(cx.listener(|this, e: &KeyDownEvent, _, cx| this.key(e, cx)))
            .on_mouse_down_out(cx.listener(|_, _, _, cx| {
                cx.emit(MenuEvent::Dismiss {
                    restore_focus: false,
                })
            }))
            // Presses inside never reach the table beneath.
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_mouse_down(MouseButton::Right, |_, _, cx| cx.stop_propagation());
        for (s, section) in self.sections.iter().enumerate() {
            let mut list = div().flex().gap(px(4.));
            for item in section {
                let n = index;
                index += 1;
                let (fg, hover_bg) = if item.danger {
                    (t.danger, theme::alpha(t.danger, 0.10))
                } else {
                    (t.muted, t.hover)
                };
                let hover_fg = if item.danger { t.danger } else { t.text };
                let shown = (selected == Some(n) || item.selected) && !item.disabled;
                let group: SharedString = format!("table-menu-item-{n}").into();
                let icon = svg()
                    .path(format!("icons/table-{}.svg", item.icon))
                    .size(px(17.))
                    .text_color(if item.disabled {
                        t.text_disabled
                    } else if shown {
                        hover_fg
                    } else {
                        fg
                    })
                    .when(!item.disabled, |s| {
                        s.group_hover(group.clone(), move |s| s.text_color(hover_fg))
                    });
                let button = div()
                    .id(("table-menu-item", n))
                    .group(group)
                    .flex()
                    .items_center()
                    .justify_center()
                    .size(px(32.))
                    .flex_shrink_0()
                    .rounded(px(metric::CONTROL_RADIUS))
                    .tooltip(tooltip(item.label.clone()))
                    .when(item.disabled, |d| d.opacity(0.58))
                    .when(shown, |d| d.bg(hover_bg))
                    .when(!item.disabled, |d| {
                        d.cursor(theme::clickable_cursor())
                            .hover(move |s| s.bg(hover_bg))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                cx.stop_propagation();
                                this.run(n, cx);
                            }))
                    })
                    .child(icon);
                list = list.child(button);
            }
            // `.desktop-menu-section + .desktop-menu-section`.
            let section = div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .when(s > 0, |d| {
                    d.mt(px(6.)).pt(px(6.)).border_t_1().border_color(t.divider)
                })
                .child(list);
            surface = surface.child(section);
        }
        surface
    }
}

/// What a table menu targets (`CsvTableMenuTarget`, `MarkdownTableMenuTarget`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    /// A cell: rows and columns (and the format's extras).
    Cell,
    /// A column grip or header cell: columns (and column extras).
    Column,
    /// A row grip or record number: rows.
    Row,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Target {
    pub scope: Scope,
    pub row: usize,
    pub column: usize,
    pub rows: usize,
    pub columns: usize,
    /// The first row that moves (1 under a header).
    pub first_movable: usize,
}

/// The sections a format adds after rows and columns.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Extras {
    /// CSV: "Auto fit column".
    pub auto_fit: bool,
    /// Markdown: the column's alignment radios (current choice).
    pub alignment: Option<Alignment>,
    /// Markdown: "Delete table".
    pub delete_table: bool,
}

/// The menu's sections (CsvTableMenu / tableContextMenu.ts).
pub fn sections(target: Target, extras: Extras) -> Vec<Vec<Item>> {
    let Target {
        scope,
        row,
        column,
        rows,
        columns,
        first_movable,
    } = target;
    let row_items = vec![
        Item::new(
            "insert-row-above",
            "insert-row-above",
            t("editor.table.insertRowAbove"),
        )
        .disabled(row < first_movable),
        Item::new(
            "insert-row-below",
            "insert-row-below",
            t("editor.table.insertRowBelow"),
        ),
        Item::new(
            "duplicate-row",
            "duplicate-row",
            t("editor.table.duplicateRow"),
        )
        .disabled(row < first_movable),
        Item::new("move-row-up", "move-up", t("editor.table.moveRowUp"))
            .disabled(row <= first_movable),
        Item::new("move-row-down", "move-down", t("editor.table.moveRowDown"))
            .disabled(row < first_movable || row + 1 >= rows),
        Item::new("delete-row", "delete", t("editor.table.deleteRow"))
            .danger()
            .disabled(row < first_movable),
    ];
    let column_items = vec![
        Item::new(
            "insert-column-left",
            "insert-column-left",
            t("editor.table.insertColumnLeft"),
        ),
        Item::new(
            "insert-column-right",
            "insert-column-right",
            t("editor.table.insertColumnRight"),
        ),
        Item::new(
            "move-column-left",
            "move-left",
            t("editor.table.moveColumnLeft"),
        )
        .disabled(column == 0),
        Item::new(
            "move-column-right",
            "move-right",
            t("editor.table.moveColumnRight"),
        )
        .disabled(column + 1 >= columns),
        Item::new("delete-column", "delete", t("editor.table.deleteColumn"))
            .danger()
            .disabled(columns <= 1),
    ];
    let mut column_extras = Vec::new();
    if extras.auto_fit {
        column_extras.push(vec![Item::new(
            "auto-fit-column",
            "auto-fit-column",
            t("editor.csv.autoFitColumn"),
        )]);
    }
    if let Some(current) = extras.alignment {
        // An unmarked delimiter renders left-aligned.
        let current = if current == Alignment::None {
            Alignment::Left
        } else {
            current
        };
        column_extras.push(vec![
            Item::new("align-left", "align-left", t("editor.table.alignLeft"))
                .selected(current == Alignment::Left),
            Item::new(
                "align-center",
                "align-center",
                t("editor.table.alignCenter"),
            )
            .selected(current == Alignment::Center),
            Item::new("align-right", "align-right", t("editor.table.alignRight"))
                .selected(current == Alignment::Right),
        ]);
    }
    let table_items = extras
        .delete_table
        .then(|| vec![Item::new("delete-table", "delete", t("editor.table.deleteTable")).danger()]);
    match scope {
        Scope::Row => vec![row_items],
        Scope::Column => std::iter::once(column_items).chain(column_extras).collect(),
        Scope::Cell => [row_items, column_items]
            .into_iter()
            .chain(column_extras)
            .chain(table_items)
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use gpui::TestAppContext;

    fn menu(cx: &mut TestAppContext) -> (Entity<TableMenu>, &mut gpui::VisualTestContext) {
        let sections = vec![
            vec![
                Item::new("a", "move-up", "Alpha").disabled(true),
                Item::new("b", "move-down", "Beta"),
            ],
            vec![
                Item::new("c", "delete", "Charlie").danger(),
                Item::new("d", "auto-fit-column", "Beryl"),
            ],
        ];
        let (view, cx) = cx.add_window_view(move |_, cx| TableMenu::new(sections, true, cx));
        (view, cx)
    }

    #[gpui::test]
    fn keys_move_over_enabled_items_and_run_them(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        let (view, cx) = menu(cx);
        let events = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let sink = events.clone();
        cx.update(|_, cx| {
            cx.subscribe(&view, move |_, e: &MenuEvent, _| {
                sink.borrow_mut().push(e.clone())
            })
            .detach()
        });
        view.update_in(cx, |m, w, cx| m.focus.focus(w, cx));
        // Opens on the first enabled item, not yet visibly focused.
        view.update(cx, |m, _| {
            assert_eq!((m.selected, m.keyboard), (Some(1), false))
        });
        cx.simulate_keystrokes("down");
        view.update(cx, |m, _| {
            assert_eq!((m.selected, m.keyboard), (Some(2), true))
        });
        cx.simulate_keystrokes("end up up");
        view.update(cx, |m, _| assert_eq!(m.selected, Some(1)));
        // Type-ahead from the current item: "b" finds the next B… (Beryl).
        cx.simulate_keystrokes("b");
        view.update(cx, |m, _| assert_eq!(m.selected, Some(3)));
        cx.simulate_keystrokes("enter");
        assert_eq!(
            *events.borrow(),
            vec![
                MenuEvent::Run("d"),
                MenuEvent::Dismiss {
                    restore_focus: false
                }
            ]
        );
        cx.simulate_keystrokes("escape");
        assert_eq!(
            events.borrow().last(),
            Some(&MenuEvent::Dismiss {
                restore_focus: true
            })
        );
    }
}
