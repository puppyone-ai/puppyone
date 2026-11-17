//! The Markdown table widget's interaction state (tableDragLayer.ts,
//! tableContextMenu.ts, tableStructuralSelectionState.ts), kept across
//! frames in keyed element state: the hovered cell, a grip drag, the
//! structural selection a move leaves, the open action menu, and column
//! tracks set by the resize rail (`tableColumnLayoutController.ts`: view
//! state, outside the source and its history). Every edit it requests is a
//! table `Structure` command through the editor.
use super::{
    commands, layout,
    model::COLUMN_LIMIT,
    operation::{can_insert_column, can_insert_row},
};
use crate::editor::{
    table::{
        interaction::{Gestures, Hover, Resizing, StructureDrag, Tracks},
        menu::{self, Extras, MenuEvent, Scope, TableMenu, Target},
        operation::{Alignment, Axis, Operation},
    },
    view::widget::{CommandSender, Focuser},
};
use gpui::{prelude::*, *};

/// The rendered table's tracks, in block-local coordinates.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Geometry {
    pub table: Bounds<f32>,
    /// Each row's top and height (its bottom border included).
    pub rows: Vec<(f32, f32)>,
    /// Each column's left and width (its end border included).
    pub columns: Vec<(f32, f32)>,
}

impl Tracks for Geometry {
    fn rows(&self) -> usize {
        self.rows.len()
    }
    fn columns(&self) -> usize {
        self.columns.len()
    }
    /// The header row never moves.
    fn first_movable(&self) -> usize {
        1
    }
    fn row_span(&self, row: usize) -> (f32, f32) {
        self.rows[row]
    }
    fn column_span(&self, column: usize) -> (f32, f32) {
        self.columns[column]
    }
    fn table(&self) -> Bounds<f32> {
        self.table
    }
}

impl Geometry {
    /// The cell under a block-local point.
    pub fn hit(&self, x: f32, y: f32) -> Option<(usize, usize)> {
        let t = self.table;
        if x < t.origin.x
            || y < t.origin.y
            || x >= t.origin.x + t.size.width
            || y >= t.origin.y + t.size.height
        {
            return None;
        }
        let row = self
            .rows
            .iter()
            .position(|(top, h)| y >= *top && y < top + h)?;
        let column = self
            .columns
            .iter()
            .position(|(left, w)| x >= *left && x < left + w)?;
        Some((row, column))
    }
}

pub struct OpenMenu {
    pub menu: Entity<TableMenu>,
    pub position: Point<Pixels>,
    pub row: usize,
    pub column: usize,
    /// The row / column a grip menu describes (outlined while open).
    pub source: Option<(Axis, usize)>,
    _subscription: Subscription,
}

/// What the widget tells its state each frame.
#[derive(Clone)]
pub struct Frame {
    pub geometry: Geometry,
    /// Source start of the table (identifies it to its commands).
    pub table: usize,
    pub alignments: Vec<Alignment>,
    pub dark: bool,
    pub sender: CommandSender,
    pub focus_editor: Focuser,
}

#[derive(Default)]
pub struct TableUi {
    /// Grips, drag and structural selection (shared with CSV).
    pub gestures: Gestures,
    pub menu: Option<OpenMenu>,
    /// Window position of the block origin (last paint).
    pub origin: Option<Point<Pixels>>,
    pub frame: Option<Frame>,
    /// Explicit column tracks (resized or auto-fitted); automatic until set.
    pub widths: Option<Vec<f32>>,
    /// The resized column's track while the rail is held.
    pub live: Option<f32>,
}

impl TableUi {
    fn local(&self, position: Point<Pixels>) -> Option<(f32, f32)> {
        let o = self.origin?;
        Some((f32::from(position.x - o.x), f32::from(position.y - o.y)))
    }

    /// The pointer moved over the table: grips follow the hovered cell,
    /// unless a drag or the menu holds them.
    pub fn pointer_moved(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        if self.gestures.drag.is_some() || self.menu.is_some() {
            return;
        }
        let (Some((x, y)), Some(frame)) = (self.local(position), &self.frame) else {
            return;
        };
        if let Some((row, column)) = frame.geometry.hit(x, y) {
            // The resize rail follows the hovered column.
            if self.gestures.resizing.is_none() && self.gestures.resize_hover != Some(column) {
                self.gestures.resize_hover = Some(column);
                cx.notify();
            }
            let hover = Hover {
                row: Some(row),
                column: Some(column),
            };
            if hover != self.gestures.hover {
                self.gestures.hover = hover;
                cx.notify();
            }
        }
    }

    /// The pointer left the table and its grips.
    pub fn pointer_left(&mut self, cx: &mut Context<Self>) {
        if !self.gestures.surface_hovered
            && !self.gestures.grip_hovered
            && self.gestures.resizing.is_none()
            && self.gestures.resize_hover.take().is_some()
        {
            cx.notify();
        }
        if !self.gestures.surface_hovered
            && !self.gestures.grip_hovered
            && self.gestures.drag.is_none()
            && self.menu.is_none()
            && self.gestures.hover != Hover::default()
        {
            self.gestures.hover = Hover::default();
            cx.notify();
        }
    }

    /// The rail pressed at window `x` on `column` of tracks `widths`.
    pub fn start_resize(&mut self, column: usize, x: f32, widths: &[f32], cx: &mut Context<Self>) {
        let Some(start_width) = widths.get(column).copied() else {
            return;
        };
        self.menu = None;
        self.gestures.resizing = Some(Resizing {
            column,
            start_x: x,
            start_width,
        });
        self.live = Some(start_width);
        cx.notify();
    }

    pub fn resize_to(&mut self, x: f32, cx: &mut Context<Self>) {
        let Some(resizing) = self.gestures.resizing else {
            return;
        };
        let width = layout::clamp(resizing.width(x, f32::MIN, f32::MAX));
        if self.live != Some(width) {
            self.live = Some(width);
            cx.notify();
        }
    }

    /// Release commits the track to `widths` (the tracks shown); Escape or a
    /// lost capture restores it.
    pub fn end_resize(&mut self, cancel: bool, widths: &[f32], cx: &mut Context<Self>) {
        let (Some(resizing), live) = (self.gestures.resizing.take(), self.live.take()) else {
            return;
        };
        if let (false, Some(width)) = (cancel, live) {
            self.set_width(resizing.column, width, widths);
        }
        cx.notify();
    }

    /// `commitWidths`: one column's explicit track, the others as shown,
    /// bounded by `COLUMN_LIMIT` (`TODO-31`).
    pub fn set_width(&mut self, column: usize, width: f32, widths: &[f32]) {
        let mut next: Vec<f32> = widths
            .iter()
            .take(COLUMN_LIMIT)
            .copied()
            .map(layout::clamp)
            .collect();
        if let Some(track) = next.get_mut(column) {
            *track = layout::clamp(width);
            if let Some(frame) = &self.frame {
                record_bounded_widths(frame.table, next.clone());
            }
            self.widths = Some(next);
        }
    }

    pub fn start_drag(&mut self, axis: Axis, position: Point<Pixels>, cx: &mut Context<Self>) {
        let source = match axis {
            Axis::Column => self.gestures.hover.column,
            Axis::Row => self.gestures.hover.row.filter(|r| *r >= 1),
        };
        let Some(source) = source else { return };
        self.menu = None;
        self.gestures.structural = None;
        self.gestures.drag = Some(StructureDrag::new(axis, source, position));
        cx.notify();
    }

    pub fn drag_to(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let (Some(mut drag), Some(local), Some(frame)) =
            (self.gestures.drag, self.local(position), &self.frame)
        else {
            return;
        };
        if drag.track(position, local, &frame.geometry) {
            self.gestures.drag = Some(drag);
            cx.notify();
        }
    }

    /// Release: a drag moves its row / column and selects it at the
    /// destination; a click opens the axis menu below the grip.
    pub fn end_drag(
        &mut self,
        cancel: bool,
        grip: Bounds<f32>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(drag) = self.gestures.drag.take() else {
            return;
        };
        cx.notify();
        let Some(frame) = self.frame.clone() else {
            return;
        };
        if cancel {
            return;
        }
        if !drag.moved {
            let position = self.origin.map(|o| {
                point(
                    o.x + px(grip.origin.x + 5.),
                    o.y + px(grip.origin.y + grip.size.height - 5. + 4.),
                )
            });
            let (row, column) = match drag.axis {
                Axis::Column => (self.gestures.hover.row.unwrap_or(1), drag.source),
                Axis::Row => (drag.source, self.gestures.hover.column.unwrap_or(0)),
            };
            let scope = if drag.axis == Axis::Column {
                Scope::Column
            } else {
                Scope::Row
            };
            if let Some(position) = position {
                self.open_menu(
                    scope,
                    row,
                    column,
                    position,
                    Some((drag.axis, drag.source)),
                    window,
                    cx,
                );
            }
            return;
        }
        if let Some((operation, row, column)) = drag.operation(&frame.geometry, self.gestures.hover)
        {
            self.gestures.structural = drag.target(&frame.geometry).map(|t| (drag.axis, t));
            (frame.sender)(
                commands::structure(frame.table, operation, row, column),
                window,
                cx,
            );
        }
    }

    /// Open the table actions at a window position.
    #[expect(
        clippy::too_many_arguments,
        reason = "the menu target (scope, cell, position, grip) plus GPUI's window and cx"
    )]
    pub fn open_menu(
        &mut self,
        scope: Scope,
        row: usize,
        column: usize,
        position: Point<Pixels>,
        source: Option<(Axis, usize)>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(frame) = &self.frame else { return };
        let g = &frame.geometry;
        let target = Target {
            scope,
            row,
            column,
            rows: g.rows.len(),
            columns: g.columns.len(),
            first_movable: 1,
        };
        let extras = Extras {
            alignment: Some(frame.alignments.get(column).copied().unwrap_or_default()),
            delete_table: true,
            ..Default::default()
        };
        let mut sections = menu::sections(target, extras);
        let row_insert_ok = can_insert_row(g.rows.len(), g.columns.len());
        let col_insert_ok = can_insert_column(g.rows.len(), g.columns.len());
        for section in &mut sections {
            for item in section {
                match Operation::from_menu_id(item.id) {
                    Some(
                        Operation::InsertRowAbove
                        | Operation::InsertRowBelow
                        | Operation::DuplicateRow,
                    ) if !row_insert_ok => {
                        item.disabled = true;
                    }
                    Some(Operation::InsertColumnLeft | Operation::InsertColumnRight)
                        if !col_insert_ok =>
                    {
                        item.disabled = true;
                    }
                    _ => {}
                }
            }
        }
        let dark = frame.dark;
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
        self.gestures.structural = None;
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

    fn menu_event(&mut self, event: MenuEvent, window: &mut Window, cx: &mut Context<Self>) {
        let Some(frame) = self.frame.clone() else {
            return;
        };
        match event {
            MenuEvent::Dismiss { restore_focus } => {
                self.menu = None;
                if restore_focus {
                    (frame.focus_editor)(window, cx);
                }
                cx.notify();
            }
            MenuEvent::Run(id) => {
                let (Some(open), Some(operation)) = (&self.menu, Operation::from_menu_id(id))
                else {
                    return;
                };
                let (row, column) = (open.row, open.column);
                // Moves leave the moved row / column selected.
                self.gestures.structural = moved(operation, row, column, &frame.geometry);
                (frame.sender)(
                    commands::structure(frame.table, operation, row, column),
                    window,
                    cx,
                );
            }
        }
    }

    /// The perimeter: a drag source, a grip menu's target, else the
    /// selection a move left.
    pub fn outline(&self) -> Option<(Axis, usize)> {
        self.gestures
            .outline(self.menu.as_ref().and_then(|m| m.source))
    }
}

/// Where a menu move puts its row / column.
fn moved(operation: Operation, row: usize, column: usize, g: &Geometry) -> Option<(Axis, usize)> {
    let (rows, columns) = (g.rows.len(), g.columns.len());
    match operation {
        Operation::MoveRowUp if row > 1 => Some((Axis::Row, row - 1)),
        Operation::MoveRowDown if row >= 1 && row + 1 < rows => Some((Axis::Row, row + 1)),
        Operation::MoveColumnLeft if column > 0 => Some((Axis::Column, column - 1)),
        Operation::MoveColumnRight if column + 1 < columns => Some((Axis::Column, column + 1)),
        _ => None,
    }
}

const MAX_BOUNDED_TABLE_STATES: usize = 64;

thread_local! {
    static BOUNDED_WIDTHS: std::cell::RefCell<std::collections::VecDeque<(usize, Vec<f32>)>> =
        const { std::cell::RefCell::new(std::collections::VecDeque::new()) };
}

pub fn bounded_widths(table_start: usize, expected_cols: usize) -> Option<Vec<f32>> {
    BOUNDED_WIDTHS.with(|store| {
        let mut q = store.borrow_mut();
        let pos = q
            .iter()
            .position(|(k, w)| *k == table_start && w.len() == expected_cols)?;
        let entry = q.remove(pos)?;
        let widths = entry.1.clone();
        q.push_back(entry);
        Some(widths)
    })
}

pub fn record_bounded_widths(table_start: usize, mut widths: Vec<f32>) {
    widths.truncate(COLUMN_LIMIT);
    BOUNDED_WIDTHS.with(|store| {
        let mut q = store.borrow_mut();
        if let Some(pos) = q.iter().position(|(k, _)| *k == table_start) {
            q.remove(pos);
        }
        while q.len() >= MAX_BOUNDED_TABLE_STATES {
            q.pop_front();
        }
        q.push_back((table_start, widths));
    });
}
