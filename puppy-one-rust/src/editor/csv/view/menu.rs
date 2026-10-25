//! The table's action menu (`CsvTableMenu` via `CsvTableControls`): its
//! targets, sections and operations.
use super::*;
use crate::editor::table::menu::{self, Extras, Scope, Target};

/// `CsvTableMenuTarget.kind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum MenuKind {
    Cell,
    Column,
    Row,
}

pub(super) struct OpenMenu {
    pub(super) menu: Entity<TableMenu>,
    pub(super) position: Point<Pixels>,
    pub(super) row: usize,
    pub(super) column: usize,
    /// The row / column a grip menu describes (outlined while open).
    pub(super) source: Option<(Axis, usize)>,
    pub(super) _subscription: Subscription,
}

impl CsvEditor {
    // --- the table menu ---------------------------------------------------------

    /// `CsvTableMenu`'s sections for a target (shared sections plus
    /// "Auto fit column").
    pub(super) fn menu_sections(
        &self,
        kind: MenuKind,
        row: usize,
        column: usize,
    ) -> Vec<Vec<Item>> {
        let scope = match kind {
            MenuKind::Cell => Scope::Cell,
            MenuKind::Column => Scope::Column,
            MenuKind::Row => Scope::Row,
        };
        let target = Target {
            scope,
            row,
            column,
            rows: self.rows(),
            columns: self.columns(),
            first_movable: self.first_movable(),
        };
        menu::sections(
            target,
            Extras {
                auto_fit: true,
                ..Default::default()
            },
        )
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "the menu target (kind, cell, position, grip) plus GPUI's window and cx"
    )]
    pub(super) fn open_menu(
        &mut self,
        kind: MenuKind,
        row: usize,
        column: usize,
        position: Point<Pixels>,
        source: Option<(Axis, usize)>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let sections = self.menu_sections(kind, row, column);
        let dark = self.theme.dark;
        let menu = cx.new(|cx| TableMenu::new(sections, dark, cx));
        let subscription = cx.subscribe_in(
            &menu,
            window,
            |this: &mut Self, _, event: &MenuEvent, window, cx| {
                this.menu_event(event.clone(), window, cx)
            },
        );
        let handle = menu.read(cx).focus_handle(cx);
        handle.focus(window, cx);
        self.menu = Some(OpenMenu {
            menu,
            position,
            row,
            column,
            source,
            _subscription: subscription,
        });
        cx.notify();
    }

    pub(super) fn close_menu(
        &mut self,
        restore_focus: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.menu.take().is_none() {
            return;
        }
        if restore_focus {
            let handle = self.focus_target(cx);
            handle.focus(window, cx);
        }
        cx.notify();
    }

    pub(super) fn menu_event(
        &mut self,
        event: MenuEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            MenuEvent::Dismiss { restore_focus } => self.close_menu(restore_focus, window, cx),
            MenuEvent::Run(id) => {
                let Some((row, column)) = self.menu.as_ref().map(|m| (m.row, m.column)) else {
                    return;
                };
                if id == "auto-fit-column" {
                    return self.auto_fit(column, cx);
                }
                let Some(operation) = Operation::from_menu_id(id) else {
                    return;
                };
                self.apply_operation(operation, row, column, window, cx);
            }
        }
    }

    /// `contextmenu` on the table: a record number opens its row's actions
    /// (data rows only); a cell opens the cell actions (column actions on the
    /// header record).
    pub(super) fn context_menu(
        &mut self,
        position: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(origin) = self.port.origin else {
            return;
        };
        let x = f32::from(position.x - origin.x) + self.port.scroll.x;
        let y = f32::from(position.y - origin.y) + self.port.scroll.y;
        let target = match self.hit(x, y) {
            Some(Hit::Index(row)) if row >= usize::from(self.header) => {
                Some((MenuKind::Row, row, 0))
            }
            Some(Hit::Cell(row, column)) => Some((
                if self.header && row == 0 {
                    MenuKind::Column
                } else {
                    MenuKind::Cell
                },
                row,
                column,
            )),
            _ => None,
        };
        if let Some((kind, row, column)) = target {
            self.menu = None;
            self.open_menu(kind, row, column, position, None, window, cx);
        }
    }
}
