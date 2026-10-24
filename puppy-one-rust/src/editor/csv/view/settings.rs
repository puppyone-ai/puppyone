//! View settings the pane menu contributes (header record, row numbers,
//! column fitting) and their per-document persistence.
use super::*;

/// A view item the pane menu shows for this editor
/// (`publishPaneMenuContribution`).
#[derive(Clone, Debug, PartialEq)]
pub struct ViewItem {
    pub id: &'static str,
    pub label: &'static str,
    /// Toggles carry their state; commands have none.
    pub checked: Option<bool>,
}

impl CsvEditor {
    // --- view settings (pane menu) ---------------------------------------------

    /// `viewItems` of the CSV pane menu contribution.
    pub fn view_items(&self) -> Vec<ViewItem> {
        if !self.live {
            return Vec::new();
        }
        vec![
            ViewItem { id: "csv-header-row", label: t("editor.csv.headerToggle"), checked: Some(self.header) },
            ViewItem { id: "csv-row-numbers", label: t("editor.csv.rowNumbersToggle"), checked: Some(self.row_numbers) },
            ViewItem { id: "csv-fit-columns-to-viewport", label: t("editor.csv.fitToViewport"), checked: None },
            ViewItem { id: "csv-reset-column-widths", label: t("editor.csv.resetColumnWidths"), checked: None },
        ]
    }

    pub fn view_command(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        match id {
            "csv-header-row" => self.set_header(!self.header, window, cx),
            "csv-row-numbers" => {
                self.row_numbers = !self.row_numbers;
                let show = self.row_numbers;
                preferences::update(&self.document_id, |e| e.show_row_numbers = Some(show));
                cx.notify();
            }
            "csv-fit-columns-to-viewport" => self.fit_columns_to_viewport(cx),
            "csv-reset-column-widths" => {
                self.layout.reset(&self.model);
                self.commit_widths();
                cx.notify();
            }
            _ => {}
        }
    }

    /// The first record is presented as a header or as data; the CSV text is
    /// unchanged. The active cell's text style depends on it, so it is
    /// re-opened in place.
    pub fn set_header(&mut self, header: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.header == header {
            return;
        }
        self.header = header;
        preferences::update(&self.document_id, |e| e.first_record_as_header = Some(header));
        if let Some(cell) = &self.cell {
            let (row, column) = (cell.row, cell.column);
            let caret = cell.editor.read(cx).state().selection.head;
            self.activate(row, column, Some(caret), window, cx);
        }
        cx.notify();
    }

    /// `getAvailableCsvColumnWidth`: the scrollport less the content insets,
    /// the action gutter and the record gutter.
    pub(super) fn fit_columns_to_viewport(&mut self, cx: &mut Context<Self>) {
        let t = &self.theme;
        let available = (self.port.size.width - t.inset.left - t.inset.right - t.table.action_gutter - self.index_width()).max(0.);
        self.layout.fit(available);
        self.commit_widths();
        cx.notify();
    }

    /// `commitColumnWidths`: persist the tracks with the document's dialect.
    pub(super) fn commit_widths(&self) {
        let (delimiter, widths) = (self.model.delimiter(), self.layout.widths.clone());
        preferences::update(&self.document_id, |e| e.column_layout = Some((delimiter, widths)));
    }

    /// Follow structural changes (`syncFromDocument` persists new tracks).
    pub(super) fn sync_layout(&mut self) {
        if self.layout.sync(&self.model) {
            self.commit_widths();
        }
    }
}
