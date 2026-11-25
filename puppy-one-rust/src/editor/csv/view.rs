//! The CSV table editor (viewers/csv/CsvTableEditor.tsx with
//! csv-table-editor.css and the shared editable-table.css): a bordered grid
//! with a record-number gutter and an optional header record, placed in the
//! content inset of a scrollport that owns both axes; the header record and
//! the gutter are sticky. Static cells render on canvas layers; the active
//! cell mounts one native `EditorView` whose session commits as a single
//! table-level undo step (`CS-03`) and supports multi-line values (`CS-06`).
//! Unclosed quotes lock the grid to read-only with an offending-row highlight
//! and a repair banner into Source mode (`CS-05`). Large inputs preview their
//! first screen immediately while parsing finishes in the background (`CS-13`).
use super::{
    cell::{CellRequest, CellSession, CellText, Outbox, first_line, normalize_newlines},
    document::{self, Delimiter},
    layout::{ColumnLayout, MAX_WIDTH},
    model::{Change, CsvModel},
    operations::Operation,
    preferences,
    theme::CsvTheme,
};
use crate::{
    editor::{
        document_session::models::{ModelHandle, ModelKind, ModelLease},
        frame::{self, FrameTheme},
        table::{
            COLUMN_MIN_WIDTH,
            menu::{Item, MenuEvent, TableMenu},
            paint::{Draw, Sides, layer},
        },
        text::selection::Selection,
        tokens::Tokens,
        view::{
            EditorView, InsertSoftNewline,
            decoration::{Decorations, Surface},
            editor::EditorEvent,
            extension::PlainText,
            render::{RenderCx, primary_metrics},
            style::{Edges, LineHeight, LineStyle, TextStyle},
        },
    },
    localization::t,
    theme::Theme,
    typography::Scale,
};
use gpui::{prelude::*, *};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    sync::Arc,
};

/// Inputs larger than `256 KiB` preview synchronously and finish parsing on
/// GPUI's background executor (`CS-13`).
pub const BACKGROUND_PARSE_BYTES: usize = 256 * 1024;
const PREVIEW_RECORDS: usize = 100;
const NOTICE_BANNER_HEIGHT: f32 = 36.;

actions!(csv_table, [Undo, Redo]);

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("secondary-z", Undo, Some("CsvTable")),
        KeyBinding::new("secondary-shift-z", Redo, Some("CsvTable")),
        KeyBinding::new(
            "alt-enter",
            InsertSoftNewline,
            Some("CsvCell > PuppyEditor"),
        ),
    ]);
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CsvEvent {
    Changed,
    FindResult {
        current: usize,
        total: usize,
    },
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
    /// The Sub Theme the styles were resolved under (`tokens::theme_key`).
    theme_key: u64,
    /// The first record is presented as a sticky header
    /// (`readCsvFirstRecordAsHeaderPreference`, default: the model's guess).
    pub header: bool,
    pub row_numbers: bool,
    pub read_only: bool,
    /// True while a large CSV is still finishing background parsing (`CS-13`).
    loading: bool,
    parse_generation: u64,
    parse_task: Option<Task<()>>,
    /// Non-blocking notice when an external reload deleted an actively edited row (`DP-04`).
    conflict_restored: bool,
    /// Live table, or the source editor.
    live: bool,
    /// `!hideSourceView`: the table viewer declares no source toggle
    /// (`providerPolicy.sourceToggle` is false), so its source view, the
    /// toggle and the shortcut are off unless a host turns them on (or an
    /// unclosed quote directs the user to Source mode to repair it, `CS-05`).
    pub source_view: bool,
    source: Option<(Entity<EditorView>, Subscription)>,
    /// `--po-editor-chrome-inset-block-start`: room above the frame for
    /// chrome floating over it (a file window's title bar); the pinned
    /// header stops below it.
    chrome_inset: f32,
    focus: FocusHandle,
    focus_subscriptions: Vec<Subscription>,
    pub(super) column_grip_focus: FocusHandle,
    pub(super) row_grip_focus: FocusHandle,
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
    /// Dev capture: a cell to activate once mounted (`PUPPYONE_CSV_ACTIVE`, `CS-15`).
    #[cfg(any(test, feature = "dev-capture"))]
    pending_active: Option<(usize, usize)>,
    /// Set on the document's table view: its model outlives it.
    model_lease: Option<ModelLease>,
}

impl Drop for CsvEditor {
    fn drop(&mut self) {
        let Some(lease) = self.model_lease.take() else {
            return;
        };
        if self.loading || self.model.undo_len() + self.model.redo_len() == 0 {
            return;
        }
        let empty = CsvModel::new("", self.model.delimiter());
        lease.detach(std::mem::replace(&mut self.model, empty));
    }
}

impl EventEmitter<CsvEvent> for CsvEditor {}

impl Focusable for CsvEditor {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl CsvEditor {
    pub fn new(
        document_id: &str,
        name: &str,
        text: &str,
        dark: bool,
        scale: Scale,
        cx: &mut Context<Self>,
    ) -> Self {
        let delimiter: Delimiter = document::infer_delimiter(name, text);
        let large = text.len() > BACKGROUND_PARSE_BYTES;
        let initial_text = if large {
            document::first_screen_prefix(text, PREVIEW_RECORDS)
        } else {
            text
        };
        let model = CsvModel::new(initial_text, delimiter);
        let full_rc = large.then(|| {
            let rc = Rc::new(text.to_owned());
            model.set_cached_text(rc.clone());
            rc
        });
        // Stored view state wins over the defaults (`readCsv…Preference`).
        let stored = preferences::read(document_id);
        let widths = stored.widths_for(delimiter, model.column_count());
        let layout = ColumnLayout::new(&model, widths);
        let header = stored
            .first_record_as_header
            .unwrap_or(model.content().suggested_header);
        let theme = CsvTheme::resolve(dark, scale);
        let mut this = Self {
            document_id: document_id.to_owned(),
            model,
            layout,
            frame: FrameTheme::resolve(dark, scale, theme.surface),
            theme,
            theme_key: crate::editor::tokens::theme_key(),
            header,
            row_numbers: stored.show_row_numbers.unwrap_or(true),
            read_only: false,
            loading: large,
            parse_generation: u64::from(large),
            parse_task: None,
            conflict_restored: false,
            live: true,
            source_view: false,
            source: None,
            chrome_inset: 0.,
            focus: cx.focus_handle(),
            focus_subscriptions: Vec::new(),
            column_grip_focus: cx.focus_handle(),
            row_grip_focus: cx.focus_handle(),
            port: Viewport::default(),
            cell: None,
            gestures: Gestures::default(),
            menu: None,
            expansion: Default::default(),
            refs: Default::default(),
            find: Default::default(),
            #[cfg(any(test, feature = "dev-capture"))]
            pending_active: None,
            model_lease: None,
        };
        if let Some(full_rc) = full_rc {
            let generation = this.parse_generation;
            let bg_text: Arc<str> = Arc::from(text);
            let bg = cx
                .background_executor()
                .spawn(async move { CsvModel::parse_standalone(&bg_text, delimiter) });
            let stored_header = stored.first_record_as_header;
            let stored_widths = stored
                .column_layout
                .filter(|(d, _)| *d == delimiter)
                .map(|(_, w)| w);
            this.parse_task = Some(cx.spawn(async move |this, cx| {
                let parsed = bg.await;
                let _ = this.update(cx, |this, cx| {
                    if this.parse_generation != generation {
                        return;
                    }
                    this.parse_task = None;
                    this.loading = false;
                    this.model.install_parsed(parsed, full_rc);
                    if stored_header.is_none() {
                        this.header = this.model.content().suggested_header;
                    }
                    let widths_slice = stored_widths
                        .as_deref()
                        .filter(|w| w.len() == this.model.column_count());
                    this.layout = ColumnLayout::new(&this.model, widths_slice);
                    if let Some(cell) = &this.cell {
                        let editor = cell.editor.clone();
                        let ro = this.grid_read_only();
                        editor.update(cx, |e, cx| e.set_read_only(ro, cx));
                    }
                    this.find_changed(cx);
                    this.clamp_scroll();
                    cx.notify();
                });
            }));
        }
        #[cfg(any(test, feature = "dev-capture"))]
        {
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
        }
        this
    }

    /// Make this the document's table view (`DocumentModels`): it continues
    /// the table model, and so the history, a destroyed view left for the
    /// same text, and leaves its own behind when it is dropped.
    pub fn attach_model(&mut self, models: &ModelHandle) {
        let (delimiter, text) = (self.model.delimiter(), self.model.text());
        let Some((lease, retained)) = models.attach::<CsvModel>(ModelKind::Table, |model| {
            model.delimiter() == delimiter && model.text() == text
        }) else {
            return;
        };
        self.model_lease = Some(lease);
        let Some(model) = retained else {
            return;
        };
        // The retained model is complete: no background parse is needed.
        self.parse_generation += 1;
        self.parse_task = None;
        self.loading = false;
        self.model = model;
        let stored = preferences::read(&self.document_id);
        if stored.first_record_as_header.is_none() {
            self.header = self.model.content().suggested_header;
        }
        let widths = stored.widths_for(delimiter, self.model.column_count());
        self.layout = ColumnLayout::new(&self.model, widths);
    }

    pub fn is_live(&self) -> bool {
        self.live
    }

    pub fn is_loading(&self) -> bool {
        self.loading
    }

    pub fn has_unclosed_quote(&self) -> Option<usize> {
        self.model.has_unclosed_quote()
    }

    pub fn source_editor_entity(&self) -> Option<Entity<EditorView>> {
        self.source.as_ref().map(|(s, _)| s.clone())
    }

    pub(super) fn grid_read_only(&self) -> bool {
        self.read_only || self.loading || !self.model.input_enabled()
    }

    fn sync_editor_read_only(&self, cx: &mut Context<Self>) {
        let grid_ro = self.grid_read_only();
        if let Some(cell) = &self.cell {
            let editor = cell.editor.clone();
            editor.update(cx, |e, cx| e.set_read_only(grid_ro, cx));
        }
        let source_ro = self.read_only;
        if let Some((source, _)) = &self.source {
            let source = source.clone();
            source.update(cx, |e, cx| e.set_read_only(source_ro, cx));
        }
    }

    /// End every transient pointer gesture, menu and picker (`CS-11`).
    pub(super) fn cancel_transient_gestures(&mut self) {
        self.menu = None;
        if let Some(r) = self.gestures.cancel_transient() {
            self.layout.set_width(r.column, r.start_width);
        }
        if let Some(drag) = self.expansion.drag.take() {
            self.port.scroll.x = drag.start_scroll_x;
        }
        self.expansion.picker = None;
    }

    pub(super) fn clamp_scroll(&mut self) {
        if self.port.size.width <= 0. || self.port.size.height <= 0. {
            return;
        }
        let (cw, ch) = self.content_size();
        self.port.scroll = point(
            self.port
                .scroll
                .x
                .clamp(0., (cw - self.port.size.width).max(0.)),
            self.port
                .scroll
                .y
                .clamp(0., (ch - self.port.size.height).max(0.)),
        );
    }

    /// The canonical file text of the current mode.
    pub fn text(&self, cx: &App) -> String {
        match &self.source {
            Some((source, _)) if !self.live => source.read(cx).text().to_owned(),
            _ => {
                let draft = self
                    .cell
                    .as_ref()
                    .filter(|c| c.dirty.get())
                    .map(|c| (c.row, c.column, c.committed_draft.borrow().clone()));
                self.model
                    .text_with_draft(draft.as_ref().map(|(r, c, s)| (*r, *c, s.as_str())))
            }
        }
    }

    pub fn composing(&self, cx: &App) -> bool {
        self.cell
            .as_ref()
            .is_some_and(|c| c.editor.read(cx).composing())
            || self
                .source
                .as_ref()
                .is_some_and(|(s, _)| s.read(cx).composing())
    }

    fn structural_identity(&self) -> Option<(Axis, u64)> {
        self.gestures.structural.and_then(|(axis, idx)| match axis {
            Axis::Row => self.model.rows().get(idx).map(|r| (Axis::Row, r.id)),
            Axis::Column => self
                .model
                .content()
                .columns
                .get(idx)
                .map(|&id| (Axis::Column, id)),
        })
    }

    fn restore_structural_identity(&mut self, saved: Option<(Axis, u64)>) {
        self.gestures.structural = saved.and_then(|(axis, id)| match axis {
            Axis::Row => self.model.row_index_by_id(id).map(|r| (Axis::Row, r)),
            Axis::Column => self.model.column_index_by_id(id).map(|c| (Axis::Column, c)),
        });
        if self.header && self.gestures.structural == Some((Axis::Row, 0)) {
            self.gestures.structural = None;
        }
    }

    /// External replacement from storage: reconciled by record-level diff so
    /// unchanged identities, column widths, selection and undo history survive
    /// (`CS-10`, `CS-11`, `DP-02`–`DP-04`).
    pub fn replace_text(&mut self, text: &str, cx: &mut Context<Self>) {
        self.cancel_transient_gestures();
        self.parse_generation += 1;
        self.parse_task = None;
        self.loading = false;
        self.conflict_restored = false;

        let saved_structural = self.structural_identity();

        // Preserve uncommitted cell session text across external reload (`DP-04`).
        let pending_session = self.cell.as_ref().and_then(|cell| {
            let row_id = self.model.rows().get(cell.row)?.id;
            let col_id = *self.model.content().columns.get(cell.column)?;
            let was_dirty = cell.dirty.get();
            Some((row_id, col_id, was_dirty))
        });

        let mut uncommitted: Option<(u64, u64, String)> = None;
        if let Some((row_id, col_id, true)) = pending_session
            && let Some(cell) = &self.cell
        {
            cell.editor.update(cx, |e, cx| e.abandon_composition(cx));
            let draft = normalize_newlines(cell.editor.read(cx).text()).into_owned();
            uncommitted = Some((row_id, col_id, draft));
        } else if let Some(cell) = self.cell.take() {
            cell.editor.update(cx, |e, cx| e.abandon_composition(cx));
        }

        self.model.adopt_text(text);
        self.restore_structural_identity(saved_structural);
        self.sync_layout();

        if let Some((row_id, col_id, draft)) = uncommitted {
            let new_row = self.model.row_index_by_id(row_id);
            let new_col = self.model.column_index_by_id(col_id).unwrap_or(0);
            let can_keep = !self.grid_read_only() && new_col < self.columns();
            if let (Some(nr), true) = (new_row, self.cell.is_some()) {
                if can_keep {
                    if let Some(cell) = self.cell.as_mut() {
                        cell.row = nr;
                        cell.column = new_col;
                        *cell.committed_draft.borrow_mut() = draft;
                        cell.dirty.set(true);
                    }
                } else {
                    self.cell = None;
                }
            } else {
                // `DP-04`: target record was deleted externally; preserve the
                // uncommitted text as a single undoable recovery row!
                self.cell = None;
                if self.model.append_recovery_row(new_col, &draft) {
                    self.conflict_restored = true;
                    cx.emit(CsvEvent::Changed);
                }
            }
        }

        if let Some((source, _)) = &self.source {
            source.update(cx, |s, cx| s.replace_text(text, cx));
        }
        self.sync_editor_read_only(cx);
        self.find_changed(cx);
        self.clamp_scroll();
        cx.notify();
    }

    pub fn set_appearance(&mut self, dark: bool, scale: Scale, cx: &mut Context<Self>) {
        let theme_key = crate::editor::tokens::theme_key();
        if self.theme.dark == dark && self.theme.scale == scale && self.theme_key == theme_key {
            return;
        }
        self.cancel_transient_gestures();
        self.theme_key = theme_key;
        self.theme = CsvTheme::resolve(dark, scale);
        self.frame = FrameTheme::resolve(dark, scale, self.theme.surface);
        // Editors carry resolved styles: rebuild them in the new appearance.
        self.flush_cell(cx);
        self.cell = None;
        if let Some((source, _)) = self.source.take() {
            source.update(cx, |s, cx| s.commit_composition(cx));
            let text = source.read(cx).text().to_owned();
            self.source = Some(self.source_editor(&text, cx));
        }
        self.clamp_scroll();
        cx.notify();
    }

    pub fn set_read_only(&mut self, read_only: bool, cx: &mut Context<Self>) {
        if self.read_only == read_only {
            return;
        }
        if read_only {
            self.cancel_transient_gestures();
        }
        self.read_only = read_only;
        self.sync_editor_read_only(cx);
        cx.notify();
    }

    fn mode_toggle_shown(&self) -> bool {
        self.source_view || !self.live || self.model.has_unclosed_quote().is_some()
    }

    /// The pane's "source" command flips live / source like the toggle.
    pub fn toggle_mode(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.mode_toggle_shown() {
            return;
        }
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
        // As in the editors, undo waits for an open composition.
        if self.read_only || self.loading || self.composing(cx) || !self.model.undo(redo) {
            return;
        }
        self.conflict_restored = false;
        self.sync_layout();
        self.sync_editor_read_only(cx);
        self.refresh_cell(cx);
        self.find_changed(cx);
        self.clamp_scroll();
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
        self.model.row_count()
    }
    fn columns(&self) -> usize {
        self.model.column_count()
    }
    fn header_rows(&self) -> usize {
        usize::from(self.header && self.rows() > 0)
    }
    fn index_width(&self) -> f32 {
        if self.row_numbers {
            self.theme.index_width
        } else {
            0.
        }
    }
    fn banner_offset(&self) -> f32 {
        if self.model.has_unclosed_quote().is_some() || self.conflict_restored {
            NOTICE_BANNER_HEIGHT
        } else {
            0.
        }
    }
    fn table_origin(&self) -> (f32, f32) {
        (
            self.theme.inset.left,
            self.theme.inset.top + self.chrome_inset + self.banner_offset(),
        )
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
        self.layout
            .widths
            .get(column)
            .copied()
            .unwrap_or(ADDED_COLUMN_WIDTH)
    }
    /// Left edge of a column's cell box.
    fn column_x(&self, column: usize) -> f32 {
        let n = column.min(self.layout.widths.len());
        self.theme.inset.left
            + 1.
            + self.index_width()
            + self.layout.widths[..n].iter().sum::<f32>()
            + (column - n) as f32 * ADDED_COLUMN_WIDTH
    }
    fn row_y(&self, row: usize) -> f32 {
        self.table_origin().1 + 1. + row as f32 * self.theme.table.row_min_height
    }
    /// Tests: a window point inside cell (`row`, `column`), as last painted.
    #[cfg(test)]
    pub(crate) fn cell_point_for_tests(&self, row: usize, column: usize) -> Point<Pixels> {
        let origin = self.port.origin.expect("the table is painted");
        point(
            origin.x + px(self.column_x(column) + 5. - self.port.scroll.x),
            origin.y + px(self.row_y(row) + 5. - self.port.scroll.y),
        )
    }
    fn table_size(&self) -> (f32, f32) {
        let w = 2.
            + self.index_width()
            + self.layout.widths.iter().sum::<f32>()
            + self.preview().columns as f32 * ADDED_COLUMN_WIDTH;
        let h = 2. + self.total_rows() as f32 * self.theme.table.row_min_height;
        (w, h)
    }
    fn content_size(&self) -> (f32, f32) {
        let (w, h) = self.table_size();
        let t = &self.theme;
        (
            t.inset.left + w + t.inset.right + t.table.action_gutter,
            self.table_origin().1 + h + t.inset.bottom + t.table.action_gutter,
        )
    }
    /// The sticky header record's top (`inset-block-start: 0` within the
    /// table).
    fn header_y(&self) -> f32 {
        let (_, ty) = self.table_origin();
        let (_, th) = self.table_size();
        self.row_y(0)
            .max(self.port.scroll.y + self.chrome_inset + self.banner_offset())
            .min(ty + th - 1. - self.theme.table.row_min_height)
    }
    /// The sticky record gutter's left edge.
    fn index_x(&self) -> f32 {
        let (tx, _) = self.table_origin();
        let (tw, _) = self.table_size();
        (tx + 1.)
            .max(self.port.scroll.x)
            .min(tx + tw - 1. - self.index_width())
    }
    /// `data-inline-scrolled`: the gutter gains a leading border.
    fn inline_scrolled(&self) -> bool {
        self.port.scroll.x.abs() > 0.5
    }
    /// Where a row is drawn (the header record sticks).
    fn row_top(&self, row: usize) -> f32 {
        if self.header && row == 0 {
            self.header_y()
        } else {
            self.row_y(row)
        }
    }
    fn style(&self, row: usize) -> &TextStyle {
        if self.header && row == 0 {
            &self.theme.header
        } else {
            &self.theme.body
        }
    }
    /// A cell's border box height: every row is `row-min-height` tall, the
    /// bottom border inside it except on the last row.
    fn cell_bottom_border(&self, row: usize) -> f32 {
        if row + 1 == self.total_rows() { 0. } else { 1. }
    }
    fn cell_end_border(&self, column: usize) -> f32 {
        if column + 1 == self.total_columns() {
            0.
        } else {
            1.
        }
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
        self.corner_radius(
            row,
            column == 0 && !self.row_numbers,
            column + 1 == self.total_columns(),
        )
    }
    /// The text style of a cell's `<input>` and its inner editor's top within
    /// the cell.
    fn input_text(&self, row: usize, window: &Window) -> (TextStyle, f32) {
        let style = self.style(row);
        let (a, d) = primary_metrics(window, style);
        let normal = a.round() + d.round();
        let p = self.theme.table.cell_padding;
        let content =
            self.theme.table.row_min_height - self.cell_bottom_border(row) - p.top - p.bottom;
        (
            TextStyle {
                line_height: LineHeight::Px(normal),
                ..style.clone()
            },
            p.top + (content - normal) / 2.,
        )
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
            inline_code: Some(self.theme.body.color),
            ..Default::default()
        }
    }

    /// Commit the active cell session's pending edits as a single table-level
    /// undo step on `CsvModel` (`CS-03`). Untouched sessions (`!dirty`, even on
    /// multi-line cells) never dirty or rewrite the model (`CS-06`).
    fn flush_cell(&mut self, cx: &mut Context<Self>) {
        let Some(cell) = &self.cell else { return };
        let (row, column, editor, dirty, draft) = (
            cell.row,
            cell.column,
            cell.editor.clone(),
            cell.dirty.clone(),
            cell.committed_draft.clone(),
        );
        editor.update(cx, |e, cx| e.commit_composition(cx));
        if !dirty.get() {
            return;
        }
        let value = normalize_newlines(editor.read(cx).text()).into_owned();
        *draft.borrow_mut() = value.clone();
        dirty.set(false);
        if self.model.set_cell(row, column, &value) {
            self.find_cell_changed(row, column, &value, cx);
        }
    }

    /// End the edit session before the table's structure changes or on explicit
    /// `Enter` / `Escape` exit; true when there was one.
    fn end_cell(&mut self, cx: &mut Context<Self>) -> bool {
        self.flush_cell(cx);
        self.cell.take().is_some()
    }

    /// Activate a cell (`requestFocus`): keyboard focus selects the value; a
    /// press puts the caret at `caret`.
    pub(super) fn activate(
        &mut self,
        row: usize,
        column: usize,
        caret: Option<usize>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.flush_cell(cx);
        let raw_value = self
            .model
            .rows()
            .get(row)
            .map_or("", |r| r.cell_or_empty(column));
        let value = normalize_newlines(raw_value).into_owned();
        let outbox = Outbox::default();
        let dirty = Rc::new(Cell::new(false));
        let committed_draft = Rc::new(RefCell::new(value.clone()));
        let p = self.theme.table.cell_padding;
        let end_pad = self.end_padding(row, column);
        let (style, top) = self.input_text(row, window);
        let first = LineStyle {
            padding: Edges::new(top, end_pad, 0., p.left),
            nowrap: true,
            ..LineStyle::new(style.clone())
        };
        let continuation = LineStyle {
            padding: Edges::new(0., end_pad, 0., p.left),
            nowrap: true,
            ..LineStyle::new(style)
        };
        let extension = CellText {
            first_line: Rc::new(first),
            continuation_line: Rc::new(continuation),
            surface: self.surface(),
            outbox: outbox.clone(),
            dirty: dirty.clone(),
        };
        let read_only = self.grid_read_only();
        let selection = match caret {
            Some(c) => Selection::cursor(c.min(value.len())),
            None => Selection::range(0, value.len()),
        };
        let editor = cx.new(|cx| {
            let mut e = EditorView::new(&value, Box::new(extension), cx);
            e.set_read_only(read_only, cx);
            e.set_selection(selection, cx);
            e
        });
        let draft_sink = committed_draft.clone();
        // Edits inside the active cell stay in `EditorView`'s own history until
        // the session flushes (`CS-03`), while keeping snapshots, dirty state
        // and incremental find live (`CS-06`, `CS-12`).
        let changed = cx.subscribe(
            &editor,
            move |this: &mut Self, editor, event: &EditorEvent, cx| {
                let EditorEvent::Changed(_) = event else {
                    return;
                };
                let text = normalize_newlines(editor.read(cx).text()).into_owned();
                *draft_sink.borrow_mut() = text.clone();
                this.find_cell_changed(row, column, &text, cx);
                cx.emit(CsvEvent::Changed);
                cx.notify();
            },
        );
        let requests = cx.observe_in(&editor, window, |this: &mut Self, _, window, cx| {
            this.handle_request(window, cx)
        });
        let handle = editor.read(cx).focus_handle(cx);
        let blur = cx.on_blur(&handle, window, |this, _, cx| {
            this.flush_cell(cx);
        });
        self.cell = Some(CellSession {
            row,
            column,
            dirty,
            committed_draft,
            editor: editor.clone(),
            outbox,
            _subscriptions: vec![changed, requests, blur],
        });
        handle.focus(window, cx);
        self.reveal(row, column);
        cx.notify();
    }

    fn handle_request(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(cell) = &self.cell else { return };
        let Some(request) = cell.outbox.take() else {
            return;
        };
        let (row, column) = (cell.row, cell.column);
        match request {
            CellRequest::Next { backwards } => {
                // `handleCellKeyDown`: Tab walks the cells in reading order and
                // stops at either end.
                let columns = self.columns();
                let linear = row * columns + column;
                let next = if backwards {
                    linear.checked_sub(1)
                } else {
                    Some(linear + 1)
                };
                if let Some(next) = next.filter(|n| *n < self.rows() * columns) {
                    self.activate(next / columns, next % columns, None, window, cx);
                } else {
                    // Even at the boundary, Tab commits the session so `⌘Z` undoes it cleanly.
                    self.flush_cell(cx);
                }
            }
            CellRequest::History { redo } => self.undo(redo, window, cx),
            CellRequest::Commit | CellRequest::Escape => {
                self.end_cell(cx);
                self.focus.focus(window, cx);
                cx.notify();
            }
        }
    }

    /// After a model change, show the active cell's current value.
    fn refresh_cell(&mut self, cx: &mut Context<Self>) {
        let Some(cell) = &self.cell else { return };
        let (row, column) = (cell.row, cell.column);
        if row >= self.rows() || column >= self.columns() {
            if let Some(cell) = self.cell.take() {
                cell.editor.update(cx, |e, cx| e.abandon_composition(cx));
            }
            return;
        }
        let value = normalize_newlines(self.model.rows()[row].cell_or_empty(column)).into_owned();
        *cell.committed_draft.borrow_mut() = value.clone();
        cell.dirty.set(false);
        let editor = cell.editor.clone();
        if editor.read(cx).text() != value {
            editor.update(cx, |e, cx| e.replace_text(&value, cx));
        }
    }

    /// Keep a cell clear of the viewport edges and the sticky bands.
    fn reveal(&mut self, row: usize, column: usize) {
        let (vw, vh) = (self.port.size.width, self.port.size.height);
        if vw <= 0. || vh <= 0. || column >= self.layout.widths.len() {
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
        let min_top = sticky_top + self.chrome_inset + self.banner_offset();
        if y - min_top < scroll.y {
            scroll.y = y - min_top;
        }
        if x + w > scroll.x + vw {
            scroll.x = x + w - vw;
        }
        if x - sticky_left < scroll.x {
            scroll.x = x - sticky_left;
        }
        self.port.scroll = point(
            scroll.x.clamp(0., (cw - vw).max(0.)),
            scroll.y.clamp(0., (ch - vh).max(0.)),
        );
    }

    fn add_row(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.grid_read_only() {
            return;
        }
        self.end_cell(cx);
        let change = self.model.append_row(self.header);
        self.after_structure(change, window, cx);
    }

    fn add_column(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.grid_read_only() {
            return;
        }
        self.end_cell(cx);
        let change = self.model.append_column(self.header);
        self.after_structure(change, window, cx);
    }

    /// Window tests press the table's growth controls: the add-record and
    /// add-field rails, and a size picker choice adding `rows` and `columns`.
    #[cfg(feature = "test-support")]
    pub fn press_add_row(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.add_row(window, cx);
    }
    #[cfg(feature = "test-support")]
    pub fn press_add_column(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.add_column(window, cx);
    }
    #[cfg(feature = "test-support")]
    pub fn press_expand(
        &mut self,
        rows: usize,
        columns: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (data_rows, all_columns) = (self.data_rows(), self.columns());
        self.expand_to(data_rows + rows, all_columns + columns, window, cx);
    }

    fn after_structure(&mut self, change: Change, window: &mut Window, cx: &mut Context<Self>) {
        if change.changed {
            self.sync_layout();
            self.find_changed(cx);
            self.clamp_scroll();
            cx.emit(CsvEvent::Changed);
        }
        if let Some(focus) = change.focus {
            self.activate(focus.row, focus.column, None, window, cx);
        }
        cx.notify();
    }

    /// `applyStructureOperation`: reordering is not a request to edit a cell
    /// (the edit session ends); every other operation focuses its target.
    pub(super) fn apply_operation(
        &mut self,
        operation: Operation,
        row: usize,
        column: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.grid_read_only() {
            return;
        }
        let moving = operation.move_axis();
        let had_cell = self.end_cell(cx);
        let mut change = self.model.apply(self.header, operation, row, column);
        if had_cell && (moving.is_some() || change.focus.is_none()) {
            // No cell takes over: keyboard focus stays with the table.
            self.focus.focus(window, cx);
        }
        if let Some(axis) = moving {
            // Menu, keyboard and drop moves leave the moved row / column
            // selected at its destination.
            if change.changed {
                self.gestures.structural = change
                    .focus
                    .map(|f| (axis, if axis == Axis::Row { f.row } else { f.column }));
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
            face: Default::default(),
        }
    }

    /// See `chrome_inset`.
    pub fn set_chrome_inset(&mut self, top: f32, cx: &mut Context<Self>) {
        if self.chrome_inset != top {
            self.chrome_inset = top;
            if let Some((source, _)) = &self.source {
                source.update(cx, |e, cx| e.set_chrome_inset(top, cx));
            }
            cx.notify();
        }
    }
    /// Current `(scroll_x, scroll_y)` of the CSV grid (`WB-10`).
    pub fn view_scroll(&self) -> (f32, f32) {
        (self.port.scroll.x, self.port.scroll.y)
    }

    /// Restores `(scroll_x, scroll_y)` on the CSV grid, clamping when viewport size is known (`WB-10`, `WB-11`).
    pub fn set_view_scroll(&mut self, scroll_x: f32, scroll_y: f32, cx: &mut Context<Self>) {
        let x = if scroll_x.is_finite() && scroll_x >= 0. {
            scroll_x
        } else {
            0.
        };
        let y = if scroll_y.is_finite() && scroll_y >= 0. {
            scroll_y
        } else {
            0.
        };
        self.port.scroll = point(x, y);
        if self.port.size.width > 0. && self.port.size.height > 0. {
            self.clamp_scroll();
        }
        cx.notify();
    }

    /// How far the table (or the source) is scrolled, and whether its top
    /// edge is the pinned header row.
    pub fn scroll_state(&self, cx: &App) -> (f32, bool) {
        match (&self.source, self.live) {
            (Some((source, _)), false) => (source.read(cx).scroll_top(), false),
            _ => (self.port.scroll.y, self.header_rows() > 0),
        }
    }
    fn source_editor(
        &self,
        text: &str,
        cx: &mut Context<Self>,
    ) -> (Entity<EditorView>, Subscription) {
        let line = Rc::new(LineStyle::new(self.source_style()));
        let surface = Surface {
            max_text_width: Some(900.),
            background: self.theme.surface,
            ..self.surface()
        };
        let (read_only, chrome_inset) = (self.read_only, self.chrome_inset);
        let editor = cx.new(|cx| {
            let mut e = EditorView::new(
                text,
                Box::new(PlainText {
                    line,
                    decorations: Decorations {
                        surface,
                        ..Default::default()
                    },
                }),
                cx,
            );
            e.set_read_only(read_only, cx);
            e.set_chrome_inset(chrome_inset, cx);
            e
        });
        let sub = cx.subscribe(&editor, |_, _, _: &EditorEvent, cx| {
            cx.emit(CsvEvent::Changed)
        });
        (editor, sub)
    }

    pub fn set_live(&mut self, live: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.live == live {
            return;
        }
        self.cancel_transient_gestures();
        if live {
            // The draft re-enters the structured view via record-level diff (`CS-10`).
            let saved_structural = self.structural_identity();
            if let Some((source, _)) = self.source.take() {
                source.update(cx, |s, cx| s.commit_composition(cx));
                let text = source.read(cx).text().to_owned();
                if let Some(cell) = self.cell.take() {
                    cell.editor.update(cx, |e, cx| e.abandon_composition(cx));
                }
                if text != *self.model.text() {
                    self.parse_generation += 1;
                    self.parse_task = None;
                    self.loading = false;
                    self.model.adopt_text(&text);
                    self.restore_structural_identity(saved_structural);
                    self.sync_layout();
                    self.find_changed(cx);
                    self.clamp_scroll();
                }
            }
            self.focus.focus(window, cx);
        } else {
            self.flush_cell(cx);
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
        let in_index =
            self.row_numbers && x >= self.index_x() && x < self.index_x() + self.index_width();
        let row = if in_header {
            0
        } else {
            (((y - self.row_y(0)) / row_h).floor().max(0.) as usize)
                .min(self.rows().saturating_sub(1))
        };
        if in_index {
            return Some(if in_header {
                Hit::Corner
            } else {
                Hit::Index(row)
            });
        }
        let column = (0..self.columns())
            .find(|&c| x >= self.column_x(c) && x < self.column_x(c) + self.layout.widths[c])?;
        Some(Hit::Cell(row, column))
    }

    /// A press in a cell activates it with the caret at the pointer.
    fn press(
        &mut self,
        position: Point<Pixels>,
        modifiers: Modifiers,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(origin) = self.port.origin else {
            return;
        };
        let x = f32::from(position.x - origin.x) + self.port.scroll.x;
        let y = f32::from(position.y - origin.y) + self.port.scroll.y;
        let Some(Hit::Cell(row, column)) = self.hit(x, y) else {
            return;
        };
        // Pressing a cell ends a structural selection.
        if self.gestures.structural.take().is_some() {
            cx.notify();
        }
        if self.press_reference(row, column, x, modifiers, window, cx) {
            return;
        }
        if self
            .cell
            .as_ref()
            .is_some_and(|c| c.row == row && c.column == column)
        {
            return;
        }
        let (first, _) = first_line(self.model.rows()[row].cell_or_empty(column));
        let local = x - self.column_x(column) - self.theme.table.cell_padding.left;
        let caret = caret_at(window, self.style(row), first, local);
        self.activate(row, column, Some(caret), window, cx);
    }

    // --- painting -----------------------------------------------------------------

    /// A cell box and, unless it is being edited, its value (`CS-05`, `CS-06`).
    fn draw_cell(
        &self,
        row: usize,
        column: usize,
        background: Rgba,
        window: &Window,
        out: &mut Vec<Draw>,
    ) {
        let t = &self.theme;
        let (x, y, w) = (
            self.column_x(column),
            self.row_top(row),
            self.column_width(column),
        );
        let border = Sides {
            top: 0.,
            right: self.cell_end_border(column),
            bottom: self.cell_bottom_border(row),
            left: 0.,
        };
        // Previewed cells (`.csv-table-editor__expansion-cell`) are empty and
        // keep the table background.
        let expansion = row >= self.rows() || column >= self.columns();
        let offending = !expansion && self.model.has_unclosed_quote() == Some(row);
        let background = if expansion {
            Rgba::default()
        } else if offending {
            let warning = Theme::new(t.dark).warning;
            if background.a > 0. {
                crate::theme::mix(warning, background, 0.18)
            } else {
                crate::theme::alpha(warning, 0.14)
            }
        } else {
            background
        };
        out.push(Draw::Cell {
            bounds: Draw::rect(x, y, w, t.table.row_min_height),
            background,
            border,
            border_color: t.table.cell_border,
            radius: self.cell_radius(row, column),
        });
        if offending {
            let warning = Theme::new(t.dark).warning;
            out.push(Draw::Cell {
                bounds: Draw::rect(
                    x,
                    y,
                    w - border.right,
                    t.table.row_min_height - border.bottom,
                ),
                background: Rgba::default(),
                border: Sides {
                    top: 1.,
                    bottom: 1.,
                    left: if column == 0 && !self.row_numbers {
                        2.
                    } else {
                        0.
                    },
                    right: 0.,
                },
                border_color: crate::theme::alpha(warning, 0.62),
                radius: Corners::default(),
            });
        }
        if expansion {
            return;
        }
        self.draw_find(row, column, out);
        if self
            .cell
            .as_ref()
            .is_some_and(|c| c.row == row && c.column == column)
        {
            return;
        }
        // A docked column grip covers its header cell's text.
        if self.header && row == 0 && self.grip_covered_header() == Some(column) {
            return;
        }
        if self.draw_reference(row, column, out) {
            return;
        }
        let value = self.model.rows()[row].cell_or_empty(column);
        if value.is_empty() {
            return;
        }
        let (first, multiline) = first_line(value);
        let (style, inner) = self.input_text(row, window);
        let p = t.table.cell_padding;
        let content_w = (w - border.right - p.left - p.right).max(0.);
        let badge_reserve = if multiline { 18. } else { 0. };
        let text_w = (content_w - badge_reserve).max(0.);
        let cell_h = t.table.row_min_height - border.bottom;
        let clip = Draw::rect(x + p.left, y, text_w, cell_h);
        if !first.is_empty() {
            out.push(Draw::Text {
                text: first.to_owned().into(),
                style,
                x: x + p.left,
                line_top: y + inner,
                center: None,
                clip,
                ellipsis: multiline,
                underline: None,
            });
        }
        if multiline && content_w >= 16. {
            // Subtle `↵` badge indicating additional lines inside the cell (`CS-06`).
            let badge_size = 15.;
            let bx = x + w - border.right - p.right - badge_size;
            let by = y + (cell_h - badge_size) / 2.;
            out.push(Draw::Cell {
                bounds: Draw::rect(bx, by, badge_size, badge_size),
                background: crate::theme::alpha(t.control, 0.72),
                border: Sides {
                    top: 1.,
                    right: 1.,
                    bottom: 1.,
                    left: 1.,
                },
                border_color: t.table.cell_border,
                radius: Corners {
                    top_left: 3.,
                    top_right: 3.,
                    bottom_right: 3.,
                    bottom_left: 3.,
                },
            });
            let badge_style = TextStyle {
                size: (t.body.size - 2.).max(9.),
                color: t.text_muted,
                line_height: LineHeight::Factor(1.),
                ..t.body.clone()
            };
            let badge_line_top = by + (badge_size - badge_style.line_height_px()) / 2.;
            out.push(Draw::Text {
                text: "↵".into(),
                style: badge_style,
                x: bx,
                line_top: badge_line_top,
                center: Some(badge_size),
                clip: Draw::rect(bx, by, badge_size, badge_size),
                ellipsis: false,
                underline: None,
            });
        }
    }

    /// A record-number cell (the header record's is blank).
    fn draw_index(&self, row: usize, out: &mut Vec<Draw>) {
        let t = &self.theme;
        let (x, y, w) = (self.index_x(), self.row_top(row), self.index_width());
        let left = if self.inline_scrolled() { 1. } else { 0. };
        let border = Sides {
            top: 0.,
            right: 1.,
            bottom: self.cell_bottom_border(row),
            left,
        };
        let offending = row < self.rows() && self.model.has_unclosed_quote() == Some(row);
        let warning = Theme::new(t.dark).warning;
        let bg = if offending {
            crate::theme::mix(warning, t.index_background, 0.22)
        } else {
            t.index_background
        };
        out.push(Draw::Cell {
            bounds: Draw::rect(x, y, w, t.table.row_min_height),
            background: bg,
            border,
            border_color: t.table.cell_border,
            radius: self.corner_radius(row, true, false),
        });
        if offending {
            out.push(Draw::Cell {
                bounds: Draw::rect(x + left, y, 2., t.table.row_min_height - border.bottom),
                background: warning,
                border: Sides::default(),
                border_color: Rgba::default(),
                radius: Corners::default(),
            });
        }
        if left > 0. {
            out.push(Draw::Cell {
                bounds: Draw::rect(x, y, 1., t.table.row_min_height),
                background: Rgba::default(),
                border: Sides {
                    left: 1.,
                    ..Sides::default()
                },
                border_color: t.table.border,
                radius: Corners::default(),
            });
        }
        if self.header && row == 0 || self.grip_covered_index() == Some(row) {
            return;
        }
        let color = if offending {
            warning
        } else if row >= self.rows() {
            crate::theme::mix(t.table.accent, t.index.color, 0.36)
        } else {
            t.index.color
        };
        let style = TextStyle {
            color: Rgba {
                a: color.a * if offending { 1. } else { t.index_opacity },
                ..color
            },
            ..t.index.clone()
        };
        let content_h = t.table.row_min_height - border.bottom;
        let label_h = t.table.row_min_height - 1.;
        let label_top = y + (content_h - label_h) / 2.;
        let line_top = label_top + (label_h - style.line_height_px()) / 2.;
        let content_w = w - left - 1.;
        let number = row + 1 - self.header_rows();
        let clip = Draw::rect(x + left, y, content_w, content_h);
        out.push(Draw::Text {
            text: number.to_string().into(),
            style,
            x: x + left,
            line_top,
            center: Some(content_w),
            clip,
            ellipsis: false,
            underline: None,
        });
    }

    fn visible(&self) -> (std::ops::Range<usize>, Vec<usize>) {
        let (rows, row_h) = (self.total_rows(), self.theme.table.row_min_height);
        let (vw, vh) = (self.port.size.width.max(1.), self.port.size.height.max(1.));
        let first = (((self.port.scroll.y - self.row_y(0)) / row_h)
            .floor()
            .max(0.) as usize)
            .min(rows);
        let last =
            ((((self.port.scroll.y + vh - self.row_y(0)) / row_h).floor() as usize) + 1).min(rows);
        let columns = (0..self.total_columns())
            .filter(|&c| {
                let x = self.column_x(c);
                x + self.column_width(c) > self.port.scroll.x && x < self.port.scroll.x + vw
            })
            .collect();
        (first..last, columns)
    }

    /// The active cell's editor and its 2px focus outline (expanding vertically
    /// while editing a multi-line value, `CS-06`).
    fn active_cell(&self, cx: &App) -> Option<(usize, AnyElement)> {
        let cell = self.cell.as_ref()?;
        let t = &self.theme;
        let (row, column) = (cell.row, cell.column);
        let (x, y, w) = (
            self.column_x(column),
            self.row_top(row),
            self.column_width(column),
        );
        let lines = cell.editor.read(cx).state().doc.line_count().max(1);
        let extra = (lines - 1) as f32 * self.style(row).line_height_px();
        let box_h = (t.table.row_min_height + extra).min(t.table.row_min_height * 6.);
        let inner_h = if lines > 1 {
            box_h - 1.
        } else {
            t.table.row_min_height - self.cell_bottom_border(row)
        };
        let fill = if self.header && row == 0 {
            t.header_background
        } else {
            t.surface
        };
        let editor = div()
            .key_context("CsvCell")
            .absolute()
            .left(px(x))
            .top(px(y))
            .w(px(w - self.cell_end_border(column)))
            .h(px(inner_h))
            .when(lines > 1, |d| d.bg(fill))
            .overflow_hidden()
            .child(cell.editor.clone());
        // A structural selection owns the perimeter: no cell outline.
        let s = t.table.focus_stroke;
        let ring = self.structure_outline().is_none().then(|| Draw::Cell {
            bounds: Draw::rect(x, y, w, box_h),
            background: Rgba::default(),
            border: Sides {
                top: s,
                right: s,
                bottom: s,
                left: s,
            },
            border_color: t.table.focus_ring,
            radius: self.cell_radius(row, column),
        });
        Some((
            row,
            div()
                .absolute()
                .left_0()
                .top_0()
                .size_full()
                .child(editor)
                .child(layer(ring.into_iter().collect()))
                .into_any_element(),
        ))
    }

    /// Top banner shown when an unclosed quote forces the grid read-only (`CS-05`)
    /// or when an external reload preserved uncommitted cell edits (`DP-04`).
    fn notice_banner(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if !self.live {
            return None;
        }
        let unclosed = self.model.has_unclosed_quote();
        if unclosed.is_none() && !self.conflict_restored {
            return None;
        }
        let palette = Theme::new(self.theme.dark);
        let text_style = TextStyle {
            size: self.theme.body.size,
            weight: 500.,
            italic: false,
            mono: false,
            color: palette.text,
            tabular: false,
            line_height: LineHeight::Factor(1.2),
            face: Default::default(),
        };
        let make_label = |msg: String| {
            let mut d = div().whitespace_nowrap().overflow_hidden().text_ellipsis();
            text_style.apply(d.style());
            d.child(msg)
        };
        let (message, show_repair) = if let Some(row) = unclosed {
            (
                format!(
                    "{} — row {} (table is read-only)",
                    t("editor.csv.warning.unclosedQuote"),
                    row + 1
                ),
                !self.read_only,
            )
        } else {
            (
                "File changed on disk; unsaved cell text was kept as an undoable row.".to_owned(),
                false,
            )
        };
        let mut bar = div()
            .id("csv-notice-banner")
            .occlude()
            .absolute()
            .left_0()
            .top(px(self.chrome_inset))
            .w_full()
            .h(px(NOTICE_BANNER_HEIGHT))
            .px(px(14.))
            .flex()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .bg(crate::theme::mix(palette.warning, palette.panel, 0.14))
            .border_b_1()
            .border_color(crate::theme::alpha(palette.warning, 0.42))
            .child(make_label(message));
        if show_repair {
            let hover_bg = palette.hover;
            let btn_style = TextStyle {
                weight: 600.,
                color: palette.text,
                ..text_style
            };
            let mut btn_label = div().whitespace_nowrap();
            btn_style.apply(btn_label.style());
            bar = bar.child(
                div()
                    .id("csv-unclosed-quote-repair")
                    .px(px(10.))
                    .py(px(4.))
                    .rounded(px(5.))
                    .border_1()
                    .border_color(palette.border)
                    .bg(palette.control)
                    .cursor(crate::theme::clickable_cursor())
                    .hover(move |s| s.bg(hover_bg))
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.set_live(false, window, cx);
                    }))
                    .child(btn_label.child("Open Source")),
            );
        }
        Some(bar.into_any_element())
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
            border: Sides {
                top: 1.,
                right: 1.,
                bottom: 1.,
                left: 1.,
            },
            // `[data-resize-preview]`: the frame takes the selection colour.
            border_color: if self.preview() == Expansion::default() {
                t.table.border
            } else {
                t.table.selection_border
            },
            radius: Corners {
                top_left: t.table.radius,
                top_right: t.table.radius,
                bottom_right: t.table.radius,
                bottom_left: t.table.radius,
            },
        }];
        for row in rows.start.max(header_rows)..rows.end {
            for &column in &columns {
                self.draw_cell(row, column, Rgba::default(), window, &mut body);
            }
        }
        let active = self.active_cell(cx);
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
        let grid_ro = self.grid_read_only();
        let surface = div()
            .id("csv-table-surface")
            .group(GROUP)
            .absolute()
            .left(px(tx))
            .top(px(ty))
            .w(px(tw + t.table.action_gutter))
            .h(px(th + t.table.action_gutter))
            .on_mouse_down(MouseButton::Left, move |e: &MouseDownEvent, window, cx| {
                let _ = weak.update(cx, |this, cx| {
                    this.press(e.position, e.modifiers, window, cx)
                });
            })
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(|this, e: &MouseDownEvent, window, cx| {
                    this.context_menu(e.position, window, cx)
                }),
            )
            .on_mouse_move(cx.listener(|this, e: &MouseMoveEvent, window, cx| {
                this.pointer_moved(e.position, cx);
                if let Some((x, _)) = this.to_content(e.position) {
                    this.hover_label(x, window, cx);
                }
            }))
            .when(self.refs.hovered_label.is_some(), |d| {
                d.cursor(CursorStyle::PointingHand)
            })
            .on_hover(cx.listener(|this, hovered: &bool, window, cx| {
                this.gestures.surface_hovered = *hovered;
                if !*hovered {
                    cx.defer_in(window, |this, _, cx| this.pointer_left(cx));
                }
            }))
            .child(
                div()
                    .absolute()
                    .left(px(-tx))
                    .top(px(-ty))
                    .w(px(cw))
                    .h(px(ch))
                    .children(if grid_ro || self.gestures.drag.is_some_and(|d| d.moved) {
                        Vec::new()
                    } else {
                        self.structure_controls(GROUP, cx)
                    }),
            );
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
            .children(self.drag_layer(window, cx))
            .children(if grid_ro || self.gestures.drag.is_some() {
                None
            } else {
                self.resize_rail(cx)
            })
            .children(self.picker_element(cx))
            .into_any_element()
    }

    fn scroll_by(&mut self, delta: Point<Pixels>, scale: f32, cx: &mut Context<Self>) {
        let (cw, ch) = self.content_size();
        let x = (self.port.scroll.x - f32::from(delta.x))
            .clamp(0., (cw - self.port.size.width).max(0.));
        let y = (self.port.scroll.y - f32::from(delta.y))
            .clamp(0., (ch - self.port.size.height).max(0.));
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
    let run = TextRun {
        len: text.len(),
        font: RenderCx::font(style),
        color: black(),
        background_color: None,
        underline: None,
        strikethrough: None,
    };
    let line = window.text_system().shape_line(
        SharedString::from(text.to_owned()),
        px(style.size),
        &[run],
        None,
    );
    line.closest_index_for_x(px(x))
}

impl Render for CsvEditor {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.focus_subscriptions.is_empty() {
            cx.defer_in(window, |this, window, cx| {
                if this.focus_subscriptions.is_empty() {
                    let on_focus = cx.on_focus(&this.focus, window, |this, _, cx| {
                        this.flush_cell(cx);
                    });
                    let on_blur = cx.on_blur(&this.focus, window, |this, _, cx| {
                        this.flush_cell(cx);
                    });
                    let on_activation = cx.observe_window_activation(window, |this, window, cx| {
                        if !window.is_window_active() {
                            this.cancel_transient_gestures();
                            cx.notify();
                        }
                    });
                    this.focus_subscriptions = vec![on_focus, on_blur, on_activation];
                }
            });
        }
        #[cfg(any(test, feature = "dev-capture"))]
        if let Some((row, column)) = self.pending_active.take() {
            cx.defer_in(window, move |this, window, cx| {
                if row < this.rows() && column < this.columns() {
                    let len =
                        normalize_newlines(this.model.rows()[row].cell_or_empty(column)).len();
                    this.activate(row, column, Some(len), window, cx);
                }
            });
        }
        let weak = cx.entity().downgrade();
        let (w_live, w_source) = (weak.clone(), weak.clone());
        let toggle = self.mode_toggle_shown().then(|| {
            frame::mode_toggle(
                &self.frame,
                self.live,
                move |window, cx| {
                    let _ = w_live.update(cx, |this, cx| this.set_live(true, window, cx));
                },
                move |window, cx| {
                    let _ = w_source.update(cx, |this, cx| this.set_live(false, window, cx));
                },
            )
        });
        let banner = self.notice_banner(cx);
        let body = if self.live {
            self.render_live(window, cx)
        } else {
            match &self.source {
                Some((source, _)) => div().size_full().child(source.clone()).into_any_element(),
                None => div().into_any_element(),
            }
        };
        let resizing = self.gestures.resizing.is_some();
        let expanding = self.expansion.drag.is_some();
        let dragging = self.gestures.drag.is_some();
        let grabbing = self.gestures.drag.is_some_and(|d| d.moved);
        let capture = weak.clone();
        let measure = canvas(
            move |bounds, window, cx| {
                let _ = weak.update(cx, |this, cx| {
                    let viewport =
                        size(f32::from(bounds.size.width), f32::from(bounds.size.height));
                    if this.port.size != viewport || this.port.origin != Some(bounds.origin) {
                        this.port.size = viewport;
                        this.port.origin = Some(bounds.origin);
                        this.clamp_scroll();
                        cx.notify();
                    }
                    let mut animating = this.advance_expand_scroll(cx);
                    if this.advance_grip_motion(cx.reduce_motion()) {
                        animating = true;
                        cx.notify();
                    }
                    if animating {
                        window.request_animation_frame();
                    }
                });
            },
            move |_, _, window, _| {
                if expanding {
                    let (moving, releasing) = (capture.clone(), capture.clone());
                    window.on_mouse_event(move |e: &MouseMoveEvent, phase, _, cx| {
                        if phase == DispatchPhase::Capture {
                            let _ = moving.update(cx, |this, cx| this.drag_expand(e.position, cx));
                        }
                    });
                    window.on_mouse_event(move |e: &MouseUpEvent, phase, window, cx| {
                        if phase == DispatchPhase::Capture && e.button == MouseButton::Left {
                            let _ =
                                releasing.update(cx, |this, cx| this.end_expand(false, window, cx));
                        }
                    });
                }
                if dragging {
                    let (moving, releasing) = (capture.clone(), capture.clone());
                    window.on_mouse_event(move |e: &MouseMoveEvent, phase, _, cx| {
                        if phase == DispatchPhase::Capture {
                            let _ =
                                moving.update(cx, |this, cx| this.drag_structure(e.position, cx));
                        }
                    });
                    window.on_mouse_event(move |e: &MouseUpEvent, phase, window, cx| {
                        if phase == DispatchPhase::Capture && e.button == MouseButton::Left {
                            let _ = releasing
                                .update(cx, |this, cx| this.end_structure_drag(false, window, cx));
                        }
                    });
                }
                if !resizing {
                    return;
                }
                let (moving, releasing) = (capture.clone(), capture.clone());
                window.on_mouse_event(move |e: &MouseMoveEvent, phase, _, cx| {
                    if phase == DispatchPhase::Capture {
                        let _ = moving
                            .update(cx, |this, cx| this.drag_resize(f32::from(e.position.x), cx));
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
        let top_cover = self.chrome_inset + self.banner_offset();
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
                    this.focus.focus(window, cx);
                    cx.notify();
                } else if this.cell.is_some() && !this.composing(cx) {
                    cx.stop_propagation();
                    this.end_cell(cx);
                    this.focus.focus(window, cx);
                    cx.notify();
                }
            }))
            .on_action(cx.listener(|this, _: &Undo, window, cx| this.undo(false, window, cx)))
            .on_action(cx.listener(|this, _: &Redo, window, cx| this.undo(true, window, cx)))
            .on_scroll_wheel(cx.listener(|this, e: &ScrollWheelEvent, window, cx| {
                this.close_menu(false, window, cx);
                if this.live {
                    this.scroll_by(
                        e.delta.pixel_delta(window.line_height()),
                        window.scale_factor(),
                        cx,
                    );
                }
            }))
            .child(measure)
            .child(body)
            .when(
                self.live && top_cover > 0. && self.port.scroll.y > 0.,
                |d| {
                    d.child(
                        div()
                            .absolute()
                            .top_0()
                            .left_0()
                            .w_full()
                            .h(px(top_cover))
                            .bg(self.theme.surface),
                    )
                },
            )
            .children(banner)
            .children(self.expand_status())
            .children(toggle)
            .children(self.menu.as_ref().map(|m| {
                deferred(
                    anchored()
                        .position(m.position)
                        .snap_to_window_with_margin(px(8.))
                        .child(m.menu.clone()),
                )
                .with_priority(1)
            }))
    }
}
