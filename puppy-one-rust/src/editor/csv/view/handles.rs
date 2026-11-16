//! Row and column drag handles (`CsvTableControls`, editable-table.css): a
//! grip for the hovered column on its top edge and one for the hovered data
//! row on the gutter's outer edge. Docked inside the sticky header / gutter
//! cell once the scrollport leaves less than 9px outside. Focusable for
//! keyboard access (`Enter` / `Space` opens the axis menu, `CS-14`), and
//! animated across tracks with an `80ms` fade-in and `160ms` slide unless the
//! system prefers reduced motion (`TB-03`).
use super::*;

use crate::editor::table::{
    controls::{self, GripHandlers, GripOptions},
    interaction,
};
pub(super) use crate::editor::table::{
    interaction::{Hover, OUTER_REACH, StructureDrag, Tracks},
    operation::Axis,
};

/// The CSV grid as the shared table controls see it (content coordinates,
/// natural row positions).
pub(super) struct CsvTracks<'a>(pub(super) &'a CsvEditor);

impl Tracks for CsvTracks<'_> {
    fn rows(&self) -> usize {
        self.0.rows()
    }
    fn columns(&self) -> usize {
        self.0.columns()
    }
    fn first_movable(&self) -> usize {
        self.0.first_movable()
    }
    fn row_span(&self, row: usize) -> (f32, f32) {
        (self.0.row_y(row), self.0.theme.table.row_min_height)
    }
    fn column_span(&self, column: usize) -> (f32, f32) {
        (self.0.column_x(column), self.0.column_width(column))
    }
    fn table(&self) -> Bounds<f32> {
        let ((x, y), (w, h)) = (self.0.table_origin(), self.0.table_size());
        Draw::rect(x, y, w, h)
    }
}

impl CsvEditor {
    pub(super) fn first_movable(&self) -> usize {
        usize::from(self.header)
    }

    pub(super) fn to_content(&self, position: Point<Pixels>) -> Option<(f32, f32)> {
        let origin = self.port.origin?;
        Some((
            f32::from(position.x - origin.x) + self.port.scroll.x,
            f32::from(position.y - origin.y) + self.port.scroll.y,
        ))
    }

    pub(super) fn sync_grip_motion(&mut self, reduce_motion: bool) -> bool {
        let col = self
            .column_grip_shown()
            .map(|c| (c, self.column_grip(c).0.origin.x));
        let row = self
            .row_grip_shown()
            .map(|r| (r, self.row_grip(r).0.origin.y));
        let mut changed = self.gestures.column_motion.retarget(col, reduce_motion);
        changed |= self.gestures.row_motion.retarget(row, reduce_motion);
        changed
    }

    pub(super) fn advance_grip_motion(&mut self, reduce_motion: bool) -> bool {
        let c = self.gestures.column_motion.tick(reduce_motion);
        let r = self.gestures.row_motion.tick(reduce_motion);
        c || r
    }

    /// The pointer moved over the table: the resize rail follows data cells,
    /// the grips follow cells and record numbers. Both stay put while a
    /// gesture or the menu owns the pointer.
    pub(super) fn pointer_moved(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        if self.gestures.resizing.is_some() || self.gestures.drag.is_some() {
            return;
        }
        let Some((x, y)) = self.to_content(position) else {
            return;
        };
        let hit = self.hit(x, y);
        let mut changed = false;
        if let Some(Hit::Cell(_, column)) = hit
            && self.gestures.resize_hover != Some(column)
        {
            self.gestures.resize_hover = Some(column);
            changed = true;
        }
        if self.menu.is_none() {
            let hover = match hit {
                Some(Hit::Cell(row, column)) => Some(Hover {
                    row: Some(row),
                    column: Some(column),
                }),
                Some(Hit::Index(row)) => Some(Hover {
                    row: Some(row),
                    column: None,
                }),
                _ => None,
            };
            if let Some(hover) = hover.filter(|h| *h != self.gestures.hover) {
                self.gestures.hover = hover;
                changed = true;
            }
        }
        changed |= self.sync_grip_motion(cx.reduce_motion());
        if changed {
            cx.notify();
        }
    }

    /// `pointerleave` of the surface (its grips included): hide the rail and
    /// the grips unless a gesture or the menu holds them.
    pub(super) fn pointer_left(&mut self, cx: &mut Context<Self>) {
        if self.gestures.surface_hovered || self.gestures.grip_hovered {
            return;
        }
        let mut changed = false;
        if self.gestures.resizing.is_none() && self.gestures.resize_hover.take().is_some() {
            changed = true;
        }
        if self.gestures.drag.is_none()
            && self.menu.is_none()
            && self.gestures.hover != Hover::default()
        {
            self.gestures.hover = Hover::default();
            changed = true;
        }
        changed |= self.sync_grip_motion(cx.reduce_motion());
        if changed {
            cx.notify();
        }
    }

    /// The column grip's anchor: the top cell of the column (the header
    /// record, else the first record), centred on its top edge; docked into
    /// a stuck header.
    pub(super) fn column_grip(&self, column: usize) -> (Bounds<f32>, bool) {
        let x = self.column_x(column) + self.column_width(column) / 2.;
        let top = self.row_top(0);
        let docked = self.header && top - self.port.scroll.y < OUTER_REACH;
        let y = if docked { top + 4. } else { top - 12. };
        (Draw::rect(x - 16., y, 32., 24.), docked)
    }

    /// The row grip's anchor: the record number's outer edge (the first data
    /// cell's without the gutter), vertically centred; docked into the gutter
    /// near the scrollport edge.
    pub(super) fn row_grip(&self, row: usize) -> (Bounds<f32>, bool) {
        let (left, gutter) = if self.row_numbers {
            (self.index_x(), true)
        } else {
            (self.column_x(0), false)
        };
        let center = self.row_top(row) + self.theme.table.row_min_height / 2.;
        let near = left - self.port.scroll.x < OUTER_REACH;
        let x = match (near, gutter) {
            (true, true) => left + 4.,
            (true, false) => self.port.scroll.x - 12.,
            _ => left - 12.,
        };
        (Draw::rect(x, center - 16., 24., 32.), near && gutter)
    }

    pub(super) fn column_grip_shown(&self) -> Option<usize> {
        let column = self.gestures.hover.column.filter(|c| *c < self.columns())?;
        if self.grid_read_only()
            || self
                .gestures
                .drag
                .is_some_and(|d| d.moved && d.axis == Axis::Row)
        {
            return None;
        }
        // A focused header cell keeps its text: its docked grip steps aside.
        let (_, docked) = self.column_grip(column);
        let editing_header = self.header
            && self
                .cell
                .as_ref()
                .is_some_and(|c| c.row == 0 && c.column == column);
        (!(docked && editing_header)).then_some(column)
    }

    pub(super) fn row_grip_shown(&self) -> Option<usize> {
        let row = self
            .gestures
            .hover
            .row
            .filter(|r| *r >= self.first_movable() && *r < self.rows())?;
        if self.grid_read_only()
            || self
                .gestures
                .drag
                .is_some_and(|d| d.moved && d.axis == Axis::Column)
        {
            return None;
        }
        Some(row)
    }

    pub(super) fn column_grip_target(&self, window: &Window) -> Option<usize> {
        if self.grid_read_only() {
            return None;
        }
        self.column_grip_shown().or_else(|| {
            if !self.column_grip_focus.is_focused(window) {
                return None;
            }
            match self.gestures.structural {
                Some((Axis::Column, c)) if c < self.columns() => Some(c),
                _ => (self.columns() > 0).then_some(0),
            }
        })
    }

    pub(super) fn row_grip_target(&self, window: &Window) -> Option<usize> {
        if self.grid_read_only() {
            return None;
        }
        self.row_grip_shown().or_else(|| {
            if !self.row_grip_focus.is_focused(window) {
                return None;
            }
            let first = self.first_movable();
            match self.gestures.structural {
                Some((Axis::Row, r)) if r >= first && r < self.rows() => Some(r),
                _ => (first < self.rows()).then_some(first),
            }
        })
    }

    /// Focus the column or row grip handle for `index` (`CS-14`).
    pub fn focus_grip(
        &mut self,
        axis: Axis,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.grid_read_only() {
            return;
        }
        match axis {
            Axis::Column if index < self.columns() => {
                self.gestures.hover.column = Some(index);
                self.gestures.column_motion.snap_immediate();
                self.column_grip_focus.focus(window, cx);
                cx.notify();
            }
            Axis::Row if index >= self.first_movable() && index < self.rows() => {
                self.gestures.hover.row = Some(index);
                self.gestures.row_motion.snap_immediate();
                self.row_grip_focus.focus(window, cx);
                cx.notify();
            }
            _ => {}
        }
    }

    /// The header cell whose text a docked column grip covers.
    pub(super) fn grip_covered_header(&self) -> Option<usize> {
        let column = self.column_grip_shown()?;
        (self.header && self.column_grip(column).1).then_some(column)
    }

    /// The record number a docked row grip covers.
    pub(super) fn grip_covered_index(&self) -> Option<usize> {
        let row = self.row_grip_shown()?;
        self.row_grip(row).1.then_some(row)
    }

    /// The row / column with a perimeter: a drag source, a grip menu's
    /// target, else the persistent selection after a move.
    pub(super) fn structure_outline(&self) -> Option<(Axis, usize)> {
        self.gestures
            .outline(self.menu.as_ref().and_then(|m| m.source))
    }

    // --- gestures -------------------------------------------------------------------

    pub(super) fn start_structure_drag(
        &mut self,
        axis: Axis,
        position: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let source = match axis {
            Axis::Row => self.row_grip_target(window),
            Axis::Column => self.column_grip_target(window),
        };
        let Some(source) = source else { return };
        self.close_menu(false, window, cx);
        self.gestures.resizing = None;
        self.gestures.structural = None;
        self.gestures.column_motion.snap_immediate();
        self.gestures.row_motion.snap_immediate();
        self.gestures.drag = Some(StructureDrag::new(axis, source, position));
        cx.notify();
    }

    pub(super) fn drag_structure(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let (Some(mut drag), Some(content)) = (self.gestures.drag, self.to_content(position))
        else {
            return;
        };
        if drag.track(position, content, &CsvTracks(self)) {
            self.gestures.drag = Some(drag);
            cx.notify();
        }
    }

    /// Release: a drag applies its move; a click opens the axis menu below
    /// the grip. `cancel` (Escape, lost capture) drops the gesture.
    pub(super) fn end_structure_drag(
        &mut self,
        cancel: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(drag) = self.gestures.drag.take() else {
            return;
        };
        cx.notify();
        if cancel {
            return;
        }
        if !drag.moved {
            self.open_grip_menu(drag.axis, drag.source, window, cx);
            return;
        }
        if let Some((operation, row, column)) =
            drag.operation(&CsvTracks(self), self.gestures.hover)
        {
            self.apply_operation(operation, row, column, window, cx);
        }
    }

    /// `openMenu`: the axis actions, anchored below the grip's visual (below
    /// the stuck header cell when docked); the row / column stays outlined
    /// while the menu is open.
    pub(super) fn open_grip_menu(
        &mut self,
        axis: Axis,
        source: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let origin = self.port.origin.unwrap_or_default();
        self.gestures.structural = None;
        self.gestures.column_motion.snap_immediate();
        self.gestures.row_motion.snap_immediate();
        let to_window = |x: f32, y: f32| {
            point(
                origin.x + px(x - self.port.scroll.x),
                origin.y + px(y - self.port.scroll.y),
            )
        };
        let (kind, row, column, position) = match axis {
            Axis::Column => {
                let (grip, docked) = self.column_grip(source);
                let visual_left = grip.origin.x + 5.;
                let below = if docked {
                    self.row_top(0) + self.theme.table.row_min_height
                } else {
                    grip.origin.y + 5. + 14.
                };
                let row = self
                    .gestures
                    .hover
                    .row
                    .unwrap_or(self.first_movable().min(self.rows().saturating_sub(1)));
                (
                    MenuKind::Column,
                    row,
                    source,
                    to_window(visual_left, below + 4.),
                )
            }
            Axis::Row => {
                let (grip, _) = self.row_grip(source);
                (
                    MenuKind::Row,
                    source,
                    self.gestures.hover.column.unwrap_or(0),
                    to_window(grip.origin.x + 5., grip.origin.y + 5. + 22. + 4.),
                )
            }
        };
        self.open_menu(
            kind,
            row,
            column,
            position,
            Some((axis, source)),
            window,
            cx,
        );
    }

    // --- painting -------------------------------------------------------------------

    /// A grip (shared `controls::grip_with_options`) wired to this table's gestures.
    pub(super) fn grip(
        &self,
        axis: Axis,
        bounds: Bounds<f32>,
        opacity: f32,
        active: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let id = match axis {
            Axis::Column => "csv-column-handle",
            Axis::Row => "csv-row-handle",
        };
        let focus = match axis {
            Axis::Column => &self.column_grip_focus,
            Axis::Row => &self.row_grip_focus,
        };
        let dragging = self.gestures.drag.is_some_and(|d| d.moved);
        let (press, menu, hover) = (
            cx.entity().downgrade(),
            cx.entity().downgrade(),
            cx.entity().downgrade(),
        );
        let handlers = GripHandlers {
            press: Rc::new(move |position, window, cx| {
                let _ = press.update(cx, |this, cx| {
                    this.start_structure_drag(axis, position, window, cx)
                });
            }),
            menu: Rc::new(move |window, cx| {
                let _ = menu.update(cx, |this, cx| {
                    let source = match axis {
                        Axis::Row => this.row_grip_target(window),
                        Axis::Column => this.column_grip_target(window),
                    };
                    if let Some(source) = source {
                        this.open_grip_menu(axis, source, window, cx);
                    }
                });
            }),
            hover: Rc::new(move |hovered, window, cx| {
                let _ = hover.update(cx, |this, cx| {
                    this.gestures.grip_hovered = hovered;
                    if !hovered {
                        cx.defer_in(window, |this, _, cx| this.pointer_left(cx));
                    }
                });
            }),
        };
        controls::grip_with_options(
            &self.theme.table,
            axis,
            id.into(),
            bounds,
            active,
            dragging,
            GripOptions {
                focus: Some(focus),
                opacity,
            },
            handlers,
        )
    }

    /// The drag layer (z 5): both grips and the drop indicator.
    pub(super) fn drag_layer(&self, window: &Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let mut out = Vec::new();
        let reduce_motion = cx.reduce_motion();
        let active = |axis: Axis, source: usize| {
            self.gestures
                .drag
                .is_some_and(|d| d.axis == axis && d.source == source)
                || self.menu.as_ref().and_then(|m| m.source) == Some((axis, source))
        };
        if let Some(column) = self.column_grip_target(window) {
            let (mut bounds, _) = self.column_grip(column);
            let is_active = active(Axis::Column, column);
            let (visual_x, opacity) = if is_active {
                (bounds.origin.x, 1.)
            } else {
                self.gestures
                    .column_motion
                    .sample(bounds.origin.x, reduce_motion)
            };
            bounds.origin.x = visual_x;
            out.push(self.grip(Axis::Column, bounds, opacity, is_active, cx));
        }
        if let Some(row) = self.row_grip_target(window) {
            let (mut bounds, _) = self.row_grip(row);
            let is_active = active(Axis::Row, row);
            let (visual_y, opacity) = if is_active {
                (bounds.origin.y, 1.)
            } else {
                self.gestures
                    .row_motion
                    .sample(bounds.origin.y, reduce_motion)
            };
            bounds.origin.y = visual_y;
            out.push(self.grip(Axis::Row, bounds, opacity, is_active, cx));
        }
        if let Some(indicator) = self.drop_indicator() {
            out.push(layer(vec![indicator]).into_any_element());
        }
        out
    }

    /// The drop indicator of a moving drag.
    pub(super) fn drop_indicator(&self) -> Option<Draw> {
        self.gestures
            .drag?
            .indicator(&CsvTracks(self), &self.theme.table)
    }

    /// The structural selection perimeter (z 4).
    pub(super) fn outline(&self) -> Option<Draw> {
        let (axis, index) = self.structure_outline()?;
        interaction::outline(&CsvTracks(self), &self.theme.table, axis, index)
    }
}
