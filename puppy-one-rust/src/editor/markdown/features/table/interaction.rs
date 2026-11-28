//! The Markdown table widget's interaction state (tableDragLayer.ts,
//! tableContextMenu.ts, tableStructuralSelectionState.ts), kept across
//! frames in keyed element state: the hovered cell, a grip drag, the
//! structural selection a move leaves, the open action menu, and column
//! tracks set by the resize rail (`tableColumnLayoutController.ts`: view
//! state, outside the source and its history). Every edit it requests is a
//! table `Structure` command through the editor.
use super::{commands, focus, layout, menu as table_menu, model::COLUMN_LIMIT};
use crate::editor::{
    markdown::platform::sessions::column_layout,
    table::{
        interaction::{Gestures, Hover, Resizing, StructureDrag, Tracks},
        menu::{MenuEvent, Scope, TableMenu},
        operation::{Alignment, Axis, Operation},
    },
    view::widget::{CommandSender, Focuser},
};
use gpui::{prelude::*, *};

pub use table_menu::OpenMenu;

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

/// The mounted column layout session the widget's tracks live in.
#[derive(Clone)]
pub struct LayoutLink {
    pub store: column_layout::Shared,
    pub id: u64,
    pub mount: u64,
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
    pub layout: Option<LayoutLink>,
}

#[derive(Default)]
pub struct TableUi {
    /// Grips, drag and structural selection (shared with CSV).
    pub gestures: Gestures,
    pub menu: Option<OpenMenu>,
    /// Window position of the block origin (last paint).
    pub origin: Option<Point<Pixels>>,
    pub frame: Option<Frame>,
    /// The resized column's track while the rail is held.
    pub live: Option<f32>,
    /// The caret position whose column was last brought into view.
    pub revealed: Option<usize>,
    /// The scrollbar rail of a table wider than the reading column.
    pub rail: Option<super::scroll::Rail>,
    pub(super) _subscriptions: Vec<Subscription>,
}

impl TableUi {
    /// Cancel any active drag or resize gesture (e.g., on window blur)
    /// without opening a menu or modifying the document.
    pub fn cancel_active_gesture(&mut self, cx: &mut Context<Self>) {
        focus::cancel_active_gesture(self, cx);
    }

    /// Handle window-level Escape: cancel an active drag/resize or clear a
    /// structural selection wherever focus is (leaving an open menu to handle
    /// its own Escape and focus restoration).
    pub fn handle_escape(&mut self, cx: &mut Context<Self>) -> bool {
        focus::handle_escape(self, cx)
    }
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
            if let Some(link) = self.frame.as_ref().and_then(|f| f.layout.as_ref()) {
                link.store
                    .borrow_mut()
                    .set_widths(link.id, link.mount, &next);
            }
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
        let sections = table_menu::build_sections(frame, scope, row, column);
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
                    focus::restore_editor_focus(self, window, cx);
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
                self.gestures.structural =
                    table_menu::moved(operation, row, column, &frame.geometry);
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
