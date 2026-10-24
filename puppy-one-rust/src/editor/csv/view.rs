//! The CSV table editor (viewers/csv/CsvTableEditor.tsx with
//! csv-table-editor.css and the shared editable-table.css): a bordered grid
//! with a record-number gutter and an optional header record, placed in the
//! content inset of a scrollport that owns both axes; the header record and
//! the gutter are sticky. Cells show their values the way the product's
//! `<input>`s do; the active cell is a native editor (`EditorView`) at the same
//! place and style whose edits and history go to the CSV model. The add-row /
//! add-column rails and the expansion corner appear while the table is
//! hovered. Source mode (`CsvSourceEditor` → `PlainTextEditor`) edits the raw
//! text.
use super::{
    cell::{CellRequest, CellSession, CellText, Outbox, display},
    document::{self, Delimiter},
    layout::{ColumnLayout, MAX_WIDTH},
    model::{Change, CsvModel},
    operations::Operation,
    preferences,
    theme::CsvTheme,
};
use crate::{
    editor::{
        frame::{self, FrameTheme},
        table::{
            COLUMN_MIN_WIDTH,
            menu::{Item, MenuEvent, TableMenu},
            paint::{Draw, Sides, layer},
        },
        text::selection::Selection,
        tokens::Tokens,
        view::{
            EditorView,
            decoration::{Decorations, Surface},
            editor::EditorEvent,
            extension::PlainText,
            style::{Edges, LineHeight, LineStyle, TextStyle},
            render::{RenderCx, primary_metrics},
        },
    },
    localization::t,
    typography::Scale,
};
use gpui::{prelude::*, *};
use std::rc::Rc;

actions!(csv_table, [Undo, Redo]);

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([KeyBinding::new("cmd-z", Undo, Some("CsvTable")), KeyBinding::new("cmd-shift-z", Redo, Some("CsvTable"))]);
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CsvEvent {
    Changed,
    /// A workspace reference's candidate paths, for the host to open.
    OpenReference(Vec<String>),
}

/// Which band of the grid a point falls in (front-most first, as the sticky
/// z-order paints them).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Hit {
    Corner,
    Index(usize),
    Cell(usize, usize),
}

/// The scrollport: its scroll offset, size and window origin (for
/// virtualisation and pointer mapping).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct Viewport {
    pub(super) scroll: Point<f32>,
    pub(super) size: Size<f32>,
    pub(super) origin: Option<Point<Pixels>>,
}

/// The CSV table editor, composed of its parts: the document model and
/// column layout, presentation, the scrollport, the active cell, the shared
/// table gestures and menu, the expansion corner, reference cells and find.
pub struct CsvEditor {
    /// The document's identity for its view preferences.
    document_id: String,
    model: CsvModel,
    layout: ColumnLayout,
    theme: CsvTheme,
    frame: FrameTheme,
    /// The first record is presented as a sticky header
    /// (`readCsvFirstRecordAsHeaderPreference`, default: the model's guess).
    pub header: bool,
    pub row_numbers: bool,
    pub read_only: bool,
    /// Live table, or the source editor.
    live: bool,
    source: Option<(Entity<EditorView>, Subscription)>,
    focus: FocusHandle,
    port: Viewport,
    /// The cell being edited.
    cell: Option<CellSession>,
    /// Grips, drag, structural selection, column resize.
    gestures: Gestures,
    menu: Option<OpenMenu>,
    /// The expansion corner's drag and size picker.
    expansion: expand::Expanding,
    refs: references::ReferenceCells,
    find: find::Find,
    /// Dev capture: a cell to activate once mounted (`PUPPYONE_CSV_ACTIVE`).
    pending_active: Option<(usize, usize)>,
}

impl EventEmitter<CsvEvent> for CsvEditor {}

impl Focusable for CsvEditor {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl CsvEditor {
    pub fn new(document_id: &str, name: &str, text: &str, dark: bool, scale: Scale, cx: &mut Context<Self>) -> Self {
        let delimiter: Delimiter = document::infer_delimiter(name, text);
        let model = CsvModel::new(text, delimiter);
        // Stored view state wins over the defaults (`readCsv…Preference`).
        let stored = preferences::read(document_id);
        let widths = stored.column_layout.as_ref().filter(|(d, w)| *d == delimiter && w.len() == model.column_count()).map(|(_, w)| w.as_slice());
        let layout = ColumnLayout::new(&model, widths);
        let header = stored.first_record_as_header.unwrap_or(model.content().suggested_header);
        let theme = CsvTheme::resolve(dark, scale);
        let mut this = Self {
            document_id: document_id.to_owned(),
            model,
            layout,
            frame: FrameTheme::resolve(dark, scale, theme.surface),
            theme,
            header,
            row_numbers: stored.show_row_numbers.unwrap_or(true),
            read_only: false,
            live: true,
            source: None,
            focus: cx.focus_handle(),
            port: Viewport::default(),
            cell: None,
            gestures: Gestures::default(),
            menu: None,
            expansion: Default::default(),
            refs: Default::default(),
            find: Default::default(),
            pending_active: None,
        };
        let pair = |key: &str| {
            let v = std::env::var(key).ok()?;
            let (a, b) = v.split_once(',')?;
            Some((a.trim().parse().ok()?, b.trim().parse().ok()?))
        };
        this.pending_active = pair("PUPPYONE_CSV_ACTIVE");
        // Dev capture: start scrolled (`x,y`).
        if let Some((x, y)) = pair("PUPPYONE_CSV_SCROLL") {
            this.port.scroll = point(x as f32, y as f32);
        }
        this
    }

    /// The canonical file text of the current mode.
    pub fn text(&self, cx: &App) -> String {
        match &self.source {
            Some((source, _)) if !self.live => source.read(cx).text().to_owned(),
            _ => (*self.model.text()).clone(),
        }
    }

    pub fn composing(&self, cx: &App) -> bool {
        self.cell.as_ref().is_some_and(|c| c.editor.read(cx).composing()) || self.source.as_ref().is_some_and(|(s, _)| s.read(cx).composing())
    }

    /// External replacement from storage (not undoable).
    pub fn replace_text(&mut self, text: &str, cx: &mut Context<Self>) {
        self.model.replace_content(text);
        self.sync_layout();
        self.find_changed();
        self.cell = None;
        if let Some((source, _)) = &self.source {
            source.update(cx, |s, cx| s.replace_text(text, cx));
        }
        cx.notify();
    }

    pub fn set_appearance(&mut self, dark: bool, scale: Scale, cx: &mut Context<Self>) {
        if self.theme.dark == dark && self.theme.scale == scale {
            return;
        }
        self.theme = CsvTheme::resolve(dark, scale);
        self.frame = FrameTheme::resolve(dark, scale, self.theme.surface);
        // Editors carry resolved styles: rebuild them in the new appearance.
        self.cell = None;
        if let Some((source, _)) = self.source.take() {
            let text = source.read(cx).text().to_owned();
            self.source = Some(self.source_editor(&text, cx));
        }
        cx.notify();
    }

    pub fn set_read_only(&mut self, read_only: bool, cx: &mut Context<Self>) {
        if self.read_only == read_only {
            return;
        }
        self.read_only = read_only;
        let editors: Vec<_> = self.cell.as_ref().map(|c| c.editor.clone()).into_iter().chain(self.source.as_ref().map(|(s, _)| s.clone())).collect();
        for editor in editors {
            editor.update(cx, |e, cx| {
                e.read_only = read_only;
                cx.notify();
            });
        }
        cx.notify();
    }

    /// The pane's "source" command flips live / source like the toggle.
    pub fn toggle_mode(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let live = !self.live;
        self.set_live(live, window, cx);
    }

    pub fn undo(&mut self, redo: bool, window: &mut Window, cx: &mut Context<Self>) {
        if !self.live {
            if let Some((source, _)) = &self.source {
                source.update(cx, |s, cx| s.undo(redo, cx));
            }
            return;
        }
        if self.read_only || !self.model.undo(redo) {
            return;
        }
        self.sync_layout();
        self.refresh_cell(cx);
        self.find_changed();
        let _ = window;
        cx.emit(CsvEvent::Changed);
        cx.notify();
    }

    /// Where keyboard focus belongs: the active cell, the source editor or
    /// the table.
    pub fn focus_target(&self, cx: &App) -> FocusHandle {
        if let Some(cell) = &self.cell {
            cell.editor.read(cx).focus_handle(cx)
        } else if let (Some((source, _)), false) = (&self.source, self.live) {
            source.read(cx).focus_handle(cx)
        } else {
            self.focus.clone()
        }
    }

    // --- geometry (content coordinates) -------------------------------------

    fn rows(&self) -> usize {
        self.model.rows().len()
    }
    fn columns(&self) -> usize {
        self.model.column_count()
    }
    fn header_rows(&self) -> usize {
        usize::from(self.header && self.rows() > 0)
    }
    fn index_width(&self) -> f32 {
        if self.row_numbers { self.theme.index_width } else { 0. }
    }
    fn table_origin(&self) -> (f32, f32) {
        (self.theme.inset.left, self.theme.inset.top)
    }
    /// Rows / columns drawn, an expansion preview included.
    fn total_rows(&self) -> usize {
        self.rows() + self.preview().rows
    }
    fn total_columns(&self) -> usize {
        self.columns() + self.preview().columns
    }
    /// A column's track (previewed columns are `cell-min-width`).
    fn column_width(&self, column: usize) -> f32 {
        self.layout.widths.get(column).copied().unwrap_or(ADDED_COLUMN_WIDTH)
    }
    /// Left edge of a column's cell box.
    fn column_x(&self, column: usize) -> f32 {
        let n = column.min(self.layout.widths.len());
        self.theme.inset.left + 1. + self.index_width() + self.layout.widths[..n].iter().sum::<f32>() + (column - n) as f32 * ADDED_COLUMN_WIDTH
    }
    fn row_y(&self, row: usize) -> f32 {
        self.theme.inset.top + 1. + row as f32 * self.theme.table.row_min_height
    }
    fn table_size(&self) -> (f32, f32) {
        let w = 2. + self.index_width() + self.layout.widths.iter().sum::<f32>() + self.preview().columns as f32 * ADDED_COLUMN_WIDTH;
        let h = 2. + self.total_rows() as f32 * self.theme.table.row_min_height;
        (w, h)
    }
    fn content_size(&self) -> (f32, f32) {
        let (w, h) = self.table_size();
        let t = &self.theme;
        (t.inset.left + w + t.inset.right + t.table.action_gutter, t.inset.top + h + t.inset.bottom + t.table.action_gutter)
    }
    /// The sticky header record's top (`inset-block-start: 0` within the
    /// table).
    fn header_y(&self) -> f32 {
        let (_, ty) = self.table_origin();
        let (_, th) = self.table_size();
        self.row_y(0).max(self.port.scroll.y).min(ty + th - 1. - self.theme.table.row_min_height)
    }
    /// The sticky record gutter's left edge.
    fn index_x(&self) -> f32 {
        let (tx, _) = self.table_origin();
        let (tw, _) = self.table_size();
        (tx + 1.).max(self.port.scroll.x).min(tx + tw - 1. - self.index_width())
    }
    /// `data-inline-scrolled`: the gutter gains a leading border.
    fn inline_scrolled(&self) -> bool {
        self.port.scroll.x.abs() > 0.5
    }
    /// Where a row is drawn (the header record sticks).
    fn row_top(&self, row: usize) -> f32 {
        if self.header && row == 0 { self.header_y() } else { self.row_y(row) }
    }
    fn style(&self, row: usize) -> &TextStyle {
        if self.header && row == 0 { &self.theme.header } else { &self.theme.body }
    }
    /// A cell's border box height: every row is `row-min-height` tall, the
    /// bottom border inside it except on the last row.
    fn cell_bottom_border(&self, row: usize) -> f32 {
        if row + 1 == self.total_rows() { 0. } else { 1. }
    }
    fn cell_end_border(&self, column: usize) -> f32 {
        if column + 1 == self.total_columns() { 0. } else { 1. }
    }
    /// `border-*-radius: radius - 1px` on the table's four corner cells.
    fn corner_radius(&self, row: usize, first: bool, last: bool) -> Corners<f32> {
        let r = (self.theme.table.radius - 1.).max(0.);
        let (top, bottom) = (row == 0, row + 1 == self.total_rows());
        Corners {
            top_left: if top && first { r } else { 0. },
            top_right: if top && last { r } else { 0. },
            bottom_right: if bottom && last { r } else { 0. },
            bottom_left: if bottom && first { r } else { 0. },
        }
    }
    fn cell_radius(&self, row: usize, column: usize) -> Corners<f32> {
        self.corner_radius(row, column == 0 && !self.row_numbers, column + 1 == self.total_columns())
    }
    /// The text style of a cell's `<input>` and its inner editor's top within
    /// the cell. The input is `height: 100%`, so Chromium drops the authored
    /// line height on the inner editor (`line-height: normal`,
    /// text_control_inner_elements.cc) and centres that line box in the
    /// content box.
    fn input_text(&self, row: usize, window: &Window) -> (TextStyle, f32) {
        let style = self.style(row);
        let (a, d) = primary_metrics(window, style);
        let normal = a.round() + d.round();
        let p = self.theme.table.cell_padding;
        let content = self.theme.table.row_min_height - self.cell_bottom_border(row) - p.top - p.bottom;
        (TextStyle { line_height: LineHeight::Px(normal), ..style.clone() }, p.top + (content - normal) / 2.)
    }

    // --- cell editing ---------------------------------------------------------

    fn surface(&self) -> Surface {
        Surface {
            content: Edges::default(),
            max_text_width: None,
            background: Rgba::default(),
            selection: self.theme.selection,
            selection_inactive: self.theme.selection_inactive,
            caret: self.theme.caret,
            caret_width: 1.,
            link: self.theme.link,
            inline_code: self.theme.body.color,
        }
    }

    /// Activate a cell (`requestFocus`): keyboard focus selects the value; a
    /// press puts the caret at `caret`.
    fn activate(&mut self, row: usize, column: usize, caret: Option<usize>, window: &mut Window, cx: &mut Context<Self>) {
        let value = display(self.model.rows().get(row).and_then(|r| r.cells.get(column)).map_or("", String::as_str));
        let outbox = Outbox::default();
        let p = self.theme.table.cell_padding;
        let (style, top) = self.input_text(row, window);
        let line = LineStyle { padding: Edges::new(top, self.end_padding(row, column), 0., p.left), nowrap: true, ..LineStyle::new(style) };
        let extension = CellText { line: Rc::new(line), surface: self.surface(), outbox: outbox.clone() };
        let read_only = self.read_only;
        let selection = match caret {
            Some(c) => Selection::cursor(c.min(value.len())),
            None => Selection::range(0, value.len()),
        };
        let editor = cx.new(|cx| {
            let mut e = EditorView::new(&value, Box::new(extension), cx);
            e.read_only = read_only;
            e.set_selection(selection, cx);
            e
        });
        let changed = cx.subscribe(&editor, move |this: &mut Self, editor, event: &EditorEvent, cx| {
            let EditorEvent::Changed(_) = event;
            let mut text = editor.read(cx).text().to_owned();
            if text.contains(['\n', '\r']) {
                // `<input>` value sanitisation: pasted line breaks are dropped.
                let head = editor.read(cx).state().selection.head;
                let caret = display(&text[..head]).len();
                text = display(&text);
                editor.update(cx, |e, cx| {
                    e.replace_text(&text, cx);
                    e.set_selection(Selection::cursor(caret), cx);
                });
            }
            if this.model.set_cell(row, column, &text) {
                this.find_changed();
                cx.emit(CsvEvent::Changed);
            }
            cx.notify();
        });
        let requests = cx.observe_in(&editor, window, |this: &mut Self, _, window, cx| this.handle_request(window, cx));
        self.cell = Some(CellSession { row, column, editor: editor.clone(), outbox, _subscriptions: vec![changed, requests] });
        let handle = editor.read(cx).focus_handle(cx);
        handle.focus(window, cx);
        self.reveal(row, column);
        cx.notify();
    }

    fn handle_request(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(cell) = &self.cell else { return };
        let Some(request) = cell.outbox.take() else { return };
        let (row, column) = (cell.row, cell.column);
        match request {
            CellRequest::Next { backwards } => {
                // `handleCellKeyDown`: Tab walks the cells in reading order and
                // stops at either end.
                let columns = self.columns();
                let linear = row * columns + column;
                let next = if backwards { linear.checked_sub(1) } else { Some(linear + 1) };
                if let Some(next) = next.filter(|n| *n < self.rows() * columns) {
                    self.activate(next / columns, next % columns, None, window, cx);
                }
            }
            CellRequest::History { redo } => self.undo(redo, window, cx),
        }
    }

    /// After a model change, show the active cell's current value.
    fn refresh_cell(&mut self, cx: &mut Context<Self>) {
        let Some(cell) = &self.cell else { return };
        let (row, column) = (cell.row, cell.column);
        if row >= self.rows() || column >= self.columns() {
            self.cell = None;
            return;
        }
        let value = display(&self.model.rows()[row].cells[column]);
        let editor = cell.editor.clone();
        if editor.read(cx).text() != value {
            editor.update(cx, |e, cx| e.replace_text(&value, cx));
        }
    }

    /// Keep a cell clear of the viewport edges and the sticky bands.
    fn reveal(&mut self, row: usize, column: usize) {
        let (vw, vh) = (self.port.size.width, self.port.size.height);
        if vw <= 0. || vh <= 0. {
            return;
        }
        let (x, w) = (self.column_x(column), self.layout.widths[column]);
        let (y, h) = (self.row_y(row), self.theme.table.row_min_height);
        let sticky_top = if self.header && row > 0 { h } else { 0. };
        let sticky_left = self.index_width();
        let (cw, ch) = self.content_size();
        let mut scroll = self.port.scroll;
        if y + h > scroll.y + vh {
            scroll.y = y + h - vh;
        }
        if y - sticky_top < scroll.y {
            scroll.y = y - sticky_top;
        }
        if x + w > scroll.x + vw {
            scroll.x = x + w - vw;
        }
        if x - sticky_left < scroll.x {
            scroll.x = x - sticky_left;
        }
        self.port.scroll = point(scroll.x.clamp(0., (cw - vw).max(0.)), scroll.y.clamp(0., (ch - vh).max(0.)));
    }

    fn add_row(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let change = self.model.append_row(self.header);
        self.after_structure(change, window, cx);
    }

    fn add_column(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let change = self.model.append_column(self.header);
        self.after_structure(change, window, cx);
    }

    fn after_structure(&mut self, change: Change, window: &mut Window, cx: &mut Context<Self>) {
        if change.changed {
            self.sync_layout();
            self.find_changed();
            cx.emit(CsvEvent::Changed);
        }
        if let Some(focus) = change.focus {
            self.activate(focus.row, focus.column, None, window, cx);
        }
        cx.notify();
    }

    /// `applyStructureOperation`: reordering is not a request to edit a cell
    /// (the edit session ends); every other operation focuses its target.
    fn apply_operation(&mut self, operation: Operation, row: usize, column: usize, window: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        let moving = operation.move_axis();
        if moving.is_some() && self.cell.take().is_some() {
            self.focus.focus(window, cx);
        }
        let mut change = self.model.apply(self.header, operation, row, column);
        if let Some(axis) = moving {
            // Menu, keyboard and drop moves leave the moved row / column
            // selected at its destination.
            if change.changed {
                self.gestures.structural = change.focus.map(|f| (axis, if axis == Axis::Row { f.row } else { f.column }));
            }
            change.focus = None;
        }
        self.after_structure(change, window, cx);
    }

    // --- modes ------------------------------------------------------------------

    /// `.plain-text-editor__surface`: the content face at the reading weight.
    fn source_style(&self) -> TextStyle {
        let t = Tokens::csv(self.theme.dark, self.theme.scale);
        TextStyle {
            size: t.len("--po-text-size-content", 16.),
            weight: t.number("--po-plain-text-reading-weight"),
            italic: false,
            mono: false,
            color: self.theme.text_muted,
            tabular: false,
            line_height: LineHeight::Factor(1.68),
        }
    }

    fn source_editor(&self, text: &str, cx: &mut Context<Self>) -> (Entity<EditorView>, Subscription) {
        let line = Rc::new(LineStyle::new(self.source_style()));
        let surface = Surface { max_text_width: Some(900.), background: self.theme.surface, ..self.surface() };
        let read_only = self.read_only;
        let editor = cx.new(|cx| {
            let mut e = EditorView::new(text, Box::new(PlainText { line, decorations: Decorations { surface, ..Default::default() } }), cx);
            e.read_only = read_only;
            e
        });
        let sub = cx.subscribe(&editor, |_, _, _: &EditorEvent, cx| cx.emit(CsvEvent::Changed));
        (editor, sub)
    }

    fn set_live(&mut self, live: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.live == live {
            return;
        }
        if live {
            // The draft re-enters the structured view (`TextEditorFrame`).
            if let Some((source, _)) = self.source.take() {
                let text = source.read(cx).text().to_owned();
                if text != *self.model.text() {
                    self.model.replace_content(&text);
                    self.sync_layout();
                    self.find_changed();
                }
            }
            self.focus.focus(window, cx);
        } else {
            self.cell = None;
            let text = (*self.model.text()).clone();
            let (editor, sub) = self.source_editor(&text, cx);
            let handle = editor.read(cx).focus_handle(cx);
            handle.focus(window, cx);
            self.source = Some((editor, sub));
        }
        self.live = live;
        cx.notify();
    }

    // --- hit testing --------------------------------------------------------------

    fn hit(&self, x: f32, y: f32) -> Option<Hit> {
        let (tx, ty) = self.table_origin();
        let (tw, th) = self.table_size();
        if x < tx + 1. || y < ty + 1. || x >= tx + tw - 1. || y >= ty + th - 1. {
            return None;
        }
        let row_h = self.theme.table.row_min_height;
        let in_header = self.header && y >= self.header_y() && y < self.header_y() + row_h;
        let in_index = self.row_numbers && x >= self.index_x() && x < self.index_x() + self.index_width();
        let row = if in_header { 0 } else { (((y - self.row_y(0)) / row_h).floor().max(0.) as usize).min(self.rows().saturating_sub(1)) };
        if in_index {
            return Some(if in_header { Hit::Corner } else { Hit::Index(row) });
        }
        let column = (0..self.columns()).find(|&c| x >= self.column_x(c) && x < self.column_x(c) + self.layout.widths[c])?;
        Some(Hit::Cell(row, column))
    }

    /// A press in a cell activates it with the caret at the pointer.
    fn press(&mut self, position: Point<Pixels>, modifiers: Modifiers, window: &mut Window, cx: &mut Context<Self>) {
        let Some(origin) = self.port.origin else { return };
        let x = f32::from(position.x - origin.x) + self.port.scroll.x;
        let y = f32::from(position.y - origin.y) + self.port.scroll.y;
        let Some(Hit::Cell(row, column)) = self.hit(x, y) else { return };
        // Pressing a cell ends a structural selection.
        if self.gestures.structural.take().is_some() {
            cx.notify();
        }
        if self.press_reference(row, column, x, modifiers, window, cx) {
            return;
        }
        if self.cell.as_ref().is_some_and(|c| c.row == row && c.column == column) {
            return;
        }
        let value = display(self.model.rows()[row].cells.get(column).map_or("", String::as_str));
        let local = x - self.column_x(column) - self.theme.table.cell_padding.left;
        let caret = caret_at(window, self.style(row), &value, local);
        self.activate(row, column, Some(caret), window, cx);
    }

    // --- painting -----------------------------------------------------------------

    /// A cell box and, unless it is being edited, its value.
    fn draw_cell(&self, row: usize, column: usize, background: Rgba, window: &Window, out: &mut Vec<Draw>) {
        let t = &self.theme;
        let (x, y, w) = (self.column_x(column), self.row_top(row), self.column_width(column));
        let border = Sides { top: 0., right: self.cell_end_border(column), bottom: self.cell_bottom_border(row), left: 0. };
        // Previewed cells (`.csv-table-editor__expansion-cell`) are empty and
        // keep the table background.
        let expansion = row >= self.rows() || column >= self.columns();
        let background = if expansion { Rgba::default() } else { background };
        out.push(Draw::Cell { bounds: Draw::rect(x, y, w, t.table.row_min_height), background, border, border_color: t.table.cell_border, radius: self.cell_radius(row, column) });
        if expansion {
            return;
        }
        self.draw_find(row, column, out);
        if self.cell.as_ref().is_some_and(|c| c.row == row && c.column == column) {
            return;
        }
        // A docked column grip covers its header cell's text.
        if self.header && row == 0 && self.grip_covered_header() == Some(column) {
            return;
        }
        if self.draw_reference(row, column, out) {
            return;
        }
        let value = self.model.rows()[row].cells.get(column).map_or("", String::as_str);
        if value.is_empty() {
            return;
        }
        let (style, inner) = self.input_text(row, window);
        let p = t.table.cell_padding;
        let content_w = (w - border.right - p.left - p.right).max(0.);
        let clip = Draw::rect(x + p.left, y, content_w, t.table.row_min_height - border.bottom);
        out.push(Draw::Text { text: display(value).into(), style, x: x + p.left, line_top: y + inner, center: None, clip, ellipsis: false, underline: None });
    }

    /// A record-number cell (the header record's is blank).
    fn draw_index(&self, row: usize, out: &mut Vec<Draw>) {
        let t = &self.theme;
        let (x, y, w) = (self.index_x(), self.row_top(row), self.index_width());
        let left = if self.inline_scrolled() { 1. } else { 0. };
        let border = Sides { top: 0., right: 1., bottom: self.cell_bottom_border(row), left };
        let border_color = t.table.cell_border;
        out.push(Draw::Cell { bounds: Draw::rect(x, y, w, t.table.row_min_height), background: t.index_background, border, border_color, radius: self.corner_radius(row, true, false) });
        if left > 0. {
            // `border-inline-start: 1px solid var(--po-editable-table-border)`.
            out.push(Draw::Cell { bounds: Draw::rect(x, y, 1., t.table.row_min_height), background: Rgba::default(), border: Sides { left: 1., ..Sides::default() }, border_color: t.table.border, radius: Corners::default() });
        }
        if self.header && row == 0 || self.grip_covered_index() == Some(row) {
            return;
        }
        // `.csv-table-editor__record-index-label`: a `row-min-height - 1px`
        // flex box centred in the cell (`vertical-align: middle`), its text
        // at `line-height: 1` centred in it.
        // Previewed records number on in an accent-tinted colour.
        let color = if row >= self.rows() { crate::theme::mix(t.table.accent, t.index.color, 0.36) } else { t.index.color };
        let style = TextStyle { color: Rgba { a: color.a * t.index_opacity, ..color }, ..t.index.clone() };
        let content_h = t.table.row_min_height - border.bottom;
        let label_h = t.table.row_min_height - 1.;
        let label_top = y + (content_h - label_h) / 2.;
        let line_top = label_top + (label_h - style.line_height_px()) / 2.;
        let content_w = w - left - 1.;
        let number = row + 1 - self.header_rows();
        let clip = Draw::rect(x + left, y, content_w, content_h);
        out.push(Draw::Text { text: number.to_string().into(), style, x: x + left, line_top, center: Some(content_w), clip, ellipsis: false, underline: None });
    }

    fn visible(&self) -> (std::ops::Range<usize>, Vec<usize>) {
        let (rows, row_h) = (self.total_rows(), self.theme.table.row_min_height);
        let (vw, vh) = (self.port.size.width.max(1.), self.port.size.height.max(1.));
        let first = (((self.port.scroll.y - self.row_y(0)) / row_h).floor().max(0.) as usize).min(rows);
        let last = ((((self.port.scroll.y + vh - self.row_y(0)) / row_h).floor() as usize) + 1).min(rows);
        let columns = (0..self.total_columns())
            .filter(|&c| {
                let x = self.column_x(c);
                x + self.column_width(c) > self.port.scroll.x && x < self.port.scroll.x + vw
            })
            .collect();
        (first..last, columns)
    }

    /// The active cell's editor and its 2px focus outline (inside the border
    /// box, following the corner radius).
    fn active_cell(&self) -> Option<(usize, AnyElement)> {
        let cell = self.cell.as_ref()?;
        let t = &self.theme;
        let (row, column) = (cell.row, cell.column);
        let (x, y, w) = (self.column_x(column), self.row_top(row), self.column_width(column));
        let editor = div()
            .absolute()
            .left(px(x))
            .top(px(y))
            .w(px(w - self.cell_end_border(column)))
            .h(px(t.table.row_min_height - self.cell_bottom_border(row)))
            .overflow_hidden()
            .child(cell.editor.clone());
        // A structural selection owns the perimeter: no cell outline.
        let s = t.table.focus_stroke;
        let ring = self.structure_outline().is_none().then(|| Draw::Cell {
            bounds: Draw::rect(x, y, w, t.table.row_min_height),
            background: Rgba::default(),
            border: Sides { top: s, right: s, bottom: s, left: s },
            border_color: t.table.focus_ring,
            radius: self.cell_radius(row, column),
        });
        Some((row, div().absolute().left_0().top_0().size_full().child(editor).child(layer(ring.into_iter().collect())).into_any_element()))
    }

    fn render_live(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        const GROUP: &str = "csv-table-surface";
        let t = self.theme.clone();
        let (tx, ty) = self.table_origin();
        let (tw, th) = self.table_size();
        let (rows, columns) = self.visible();
        let header_rows = self.header_rows();
        // z 0 – 1: the frame, body cells, the active body cell.
        let mut body = vec![Draw::Cell {
            bounds: Draw::rect(tx, ty, tw, th),
            background: Rgba::default(),
            border: Sides { top: 1., right: 1., bottom: 1., left: 1. },
            // `[data-resize-preview]`: the frame takes the selection colour.
            border_color: if self.preview() == Expansion::default() { t.table.border } else { t.table.selection_border },
            radius: Corners { top_left: t.table.radius, top_right: t.table.radius, bottom_right: t.table.radius, bottom_left: t.table.radius },
        }];
        for row in rows.start.max(header_rows)..rows.end {
            for &column in &columns {
                self.draw_cell(row, column, Rgba::default(), window, &mut body);
            }
        }
        let active = self.active_cell();
        let (active_body, active_header) = match active {
            Some((row, e)) if self.header && row == 0 => (None, Some(e)),
            Some((_, e)) => (Some(e), None),
            None => (None, None),
        };
        // z 2: the record gutter; z 3: the header record; z 4: their corner.
        let mut gutter = Vec::new();
        if self.row_numbers {
            for row in rows.start.max(header_rows)..rows.end {
                self.draw_index(row, &mut gutter);
            }
        }
        let mut header = Vec::new();
        let mut corner = Vec::new();
        if header_rows > 0 {
            for &column in &columns {
                self.draw_cell(0, column, t.header_background, window, &mut header);
            }
            if self.row_numbers {
                self.draw_index(0, &mut corner);
            }
        }
        let weak = cx.entity().downgrade();
        let (cw, ch) = self.content_size();
        let surface = div()
            .id("csv-table-surface")
            .group(GROUP)
            .absolute()
            .left(px(tx))
            .top(px(ty))
            .w(px(tw + t.table.action_gutter))
            .h(px(th + t.table.action_gutter))
            .on_mouse_down(MouseButton::Left, move |e: &MouseDownEvent, window, cx| {
                let _ = weak.update(cx, |this, cx| this.press(e.position, e.modifiers, window, cx));
            })
            .on_mouse_down(MouseButton::Right, cx.listener(|this, e: &MouseDownEvent, window, cx| this.context_menu(e.position, window, cx)))
            .on_mouse_move(cx.listener(|this, e: &MouseMoveEvent, window, cx| {
                this.pointer_moved(e.position, cx);
                if let Some((x, _)) = this.to_content(e.position) {
                    this.hover_label(x, window, cx);
                }
            }))
            .when(self.refs.hovered_label.is_some(), |d| d.cursor(CursorStyle::PointingHand))
            .on_hover(cx.listener(|this, hovered: &bool, window, cx| {
                // `pointerleave` of the surface; its grips overhang it, so
                // the check waits for their hover state.
                this.gestures.surface_hovered = *hovered;
                if !*hovered {
                    cx.defer_in(window, |this, _, cx| this.pointer_left(cx));
                }
            }))
            // The surface's controls overhang it; their coordinates are the
            // content's.
            .child(div().absolute().left(px(-tx)).top(px(-ty)).w(px(cw)).h(px(ch)).children(if self.read_only || self.gestures.drag.is_some_and(|d| d.moved) { Vec::new() } else { self.structure_controls(GROUP, cx) }));
        div()
            .absolute()
            .left(px(-self.port.scroll.x))
            .top(px(-self.port.scroll.y))
            .w(px(cw))
            .h(px(ch))
            .child(surface)
            .child(layer(body))
            .children(active_body)
            .children(self.reference_overlays(cx))
            .child(layer(gutter))
            .child(layer(header))
            .children(active_header)
            .child(layer(corner))
            .child(layer(self.outline().into_iter().collect()))
            .children(self.drag_layer(cx))
            .children(if self.read_only || self.gestures.drag.is_some() { None } else { self.resize_rail(cx) })
            .children(self.picker_element(cx))
            .into_any_element()
    }

    fn scroll_by(&mut self, delta: Point<Pixels>, scale: f32, cx: &mut Context<Self>) {
        let (cw, ch) = self.content_size();
        let x = (self.port.scroll.x - f32::from(delta.x)).clamp(0., (cw - self.port.size.width).max(0.));
        let y = (self.port.scroll.y - f32::from(delta.y)).clamp(0., (ch - self.port.size.height).max(0.));
        let next = point((x * scale).round() / scale, (y * scale).round() / scale);
        if next != self.port.scroll {
            self.port.scroll = next;
            cx.notify();
        }
    }
}

mod controls;
mod expand;
mod find;
mod handles;
mod menu;
mod references;
mod resize;
mod settings;
#[cfg(test)]
mod tests;

pub use {find::FindResult, settings::ViewItem};
use crate::editor::table::interaction::Gestures;
use {
    expand::{ADDED_COLUMN_WIDTH, Expansion},
    handles::{Axis, Hover},
    menu::{MenuKind, OpenMenu},
};

/// The caret boundary of `text` nearest to `x` (shaped like the cell).
fn caret_at(window: &Window, style: &TextStyle, text: &str, x: f32) -> usize {
    if text.is_empty() || x <= 0. {
        return 0;
    }
    let run = TextRun { len: text.len(), font: RenderCx::font(style), color: black(), background_color: None, underline: None, strikethrough: None };
    let line = window.text_system().shape_line(SharedString::from(text.to_owned()), px(style.size), &[run], None);
    line.closest_index_for_x(px(x))
}

impl Render for CsvEditor {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some((row, column)) = self.pending_active.take() {
            cx.defer_in(window, move |this, window, cx| {
                if row < this.rows() && column < this.columns() {
                    let len = display(&this.model.rows()[row].cells[column]).len();
                    this.activate(row, column, Some(len), window, cx);
                }
            });
        }
        let weak = cx.entity().downgrade();
        let (w_live, w_source) = (weak.clone(), weak.clone());
        let toggle = frame::mode_toggle(
            &self.frame,
            self.live,
            move |window, cx| {
                let _ = w_live.update(cx, |this, cx| this.set_live(true, window, cx));
            },
            move |window, cx| {
                let _ = w_source.update(cx, |this, cx| this.set_live(false, window, cx));
            },
        );
        let body = if self.live {
            self.render_live(window, cx)
        } else {
            match &self.source {
                Some((source, _)) => div().size_full().child(source.clone()).into_any_element(),
                None => div().into_any_element(),
            }
        };
        // The scrollport's size and window origin, for virtualisation and
        // pointer mapping.
        let resizing = self.gestures.resizing.is_some();
        let expanding = self.expansion.drag.is_some();
        let dragging = self.gestures.drag.is_some();
        let grabbing = self.gestures.drag.is_some_and(|d| d.moved);
        let capture = weak.clone();
        let measure = canvas(
            move |bounds, window, cx| {
                let _ = weak.update(cx, |this, cx| {
                    let viewport = size(f32::from(bounds.size.width), f32::from(bounds.size.height));
                    if this.port.size != viewport || this.port.origin != Some(bounds.origin) {
                        this.port.size = viewport;
                        this.port.origin = Some(bounds.origin);
                        cx.notify();
                    }
                    // Expansion edge-scrolling runs once per frame.
                    if this.advance_expand_scroll(cx) {
                        window.request_animation_frame();
                    }
                });
            },
            move |_, _, window, _| {
                // A gesture owns the pointer until release, wherever it goes
                // (`setPointerCapture`).
                if expanding {
                    let (moving, releasing) = (capture.clone(), capture.clone());
                    window.on_mouse_event(move |e: &MouseMoveEvent, phase, _, cx| {
                        if phase == DispatchPhase::Capture {
                            let _ = moving.update(cx, |this, cx| this.drag_expand(e.position, cx));
                        }
                    });
                    window.on_mouse_event(move |e: &MouseUpEvent, phase, window, cx| {
                        if phase == DispatchPhase::Capture && e.button == MouseButton::Left {
                            let _ = releasing.update(cx, |this, cx| this.end_expand(false, window, cx));
                        }
                    });
                }
                if dragging {
                    let (moving, releasing) = (capture.clone(), capture.clone());
                    window.on_mouse_event(move |e: &MouseMoveEvent, phase, _, cx| {
                        if phase == DispatchPhase::Capture {
                            let _ = moving.update(cx, |this, cx| this.drag_structure(e.position, cx));
                        }
                    });
                    window.on_mouse_event(move |e: &MouseUpEvent, phase, window, cx| {
                        if phase == DispatchPhase::Capture && e.button == MouseButton::Left {
                            let _ = releasing.update(cx, |this, cx| this.end_structure_drag(false, window, cx));
                        }
                    });
                }
                if !resizing {
                    return;
                }
                let (moving, releasing) = (capture.clone(), capture.clone());
                window.on_mouse_event(move |e: &MouseMoveEvent, phase, _, cx| {
                    if phase == DispatchPhase::Capture {
                        let _ = moving.update(cx, |this, cx| this.drag_resize(f32::from(e.position.x), cx));
                    }
                });
                window.on_mouse_event(move |e: &MouseUpEvent, phase, _, cx| {
                    if phase == DispatchPhase::Capture && e.button == MouseButton::Left {
                        let _ = releasing.update(cx, |this, cx| this.end_resize(false, cx));
                    }
                });
            },
        )
        .absolute()
        .size_full();
        div()
            .id("csv-table-editor")
            .key_context("CsvTable")
            .track_focus(&self.focus)
            .relative()
            .size_full()
            .overflow_hidden()
            .bg(self.theme.surface)
            .when(resizing, |d| d.cursor(CursorStyle::ResizeLeftRight))
            .when(grabbing, |d| d.cursor(CursorStyle::ClosedHand))
            .capture_key_down(cx.listener(|this, e: &KeyDownEvent, window, cx| {
                if e.keystroke.key != "escape" {
                    return;
                }
                if this.gestures.resizing.is_some() {
                    cx.stop_propagation();
                    this.end_resize(true, cx);
                } else if this.expansion.drag.is_some() {
                    cx.stop_propagation();
                    this.end_expand(true, window, cx);
                } else if this.gestures.drag.is_some() {
                    cx.stop_propagation();
                    this.end_structure_drag(true, window, cx);
                } else if this.gestures.structural.take().is_some() {
                    cx.stop_propagation();
                    cx.notify();
                }
            }))
            .on_action(cx.listener(|this, _: &Undo, window, cx| this.undo(false, window, cx)))
            .on_action(cx.listener(|this, _: &Redo, window, cx| this.undo(true, window, cx)))
            .on_scroll_wheel(cx.listener(|this, e: &ScrollWheelEvent, window, cx| {
                this.close_menu(false, window, cx);
                if this.live {
                    this.scroll_by(e.delta.pixel_delta(window.line_height()), window.scale_factor(), cx);
                }
            }))
            .child(measure)
            .child(body)
            .children(self.expand_status())
            .child(toggle)
            .children(self.menu.as_ref().map(|m| deferred(anchored().position(m.position).snap_to_window_with_margin(px(8.)).child(m.menu.clone())).with_priority(1)))
    }
}
