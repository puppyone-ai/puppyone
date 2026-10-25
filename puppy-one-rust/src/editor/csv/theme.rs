//! The CSV viewer's presentation contract, typed (`csv-table-editor.css` and
//! the shared `editable-table.css`, resolved by
//! `tools/import-editor-theme.mjs --csv` into assets/editor/csv-theme.json).
use crate::{
    editor::{
        table::style::EditableTableStyle,
        tokens::{Tokens, over},
        view::style::{Edges, LineHeight, TextStyle},
    },
    typography::Scale,
};
use gpui::Rgba;

#[derive(Clone, Debug, PartialEq)]
pub struct CsvTheme {
    pub dark: bool,
    pub scale: Scale,
    pub surface: Rgba,
    /// Body cells (`.csv-table-editor__body-cell input`).
    pub body: TextStyle,
    /// Header cells (`th input`: header colour and weight).
    pub header: TextStyle,
    /// Record numbers (`.csv-table-editor__record-index-label`).
    pub index: TextStyle,
    pub index_opacity: f32,
    pub index_background: Rgba,
    pub index_width: f32,
    pub header_background: Rgba,
    /// The shared editable-table contract (grid, rails, grips, selection).
    pub table: EditableTableStyle,
    pub inset: Edges,
    pub selection: Rgba,
    pub selection_inactive: Rgba,
    pub caret: Rgba,
    pub link: Rgba,
    pub control: Rgba,
    pub text_muted: Rgba,
}

impl CsvTheme {
    pub fn resolve(dark: bool, scale: Scale) -> Self {
        let t = Tokens::csv(dark, scale);
        let size = t.len("--po-editable-table-font-size", 16.);
        let line_height = LineHeight::Factor(t.number("--po-editable-table-line-height"));
        let body = TextStyle {
            size,
            weight: 400.,
            italic: false,
            mono: false,
            color: t.color("--po-editable-table-body-color"),
            tabular: false,
            line_height,
        };
        // Sticky cells layer their tint over the editor background so content
        // scrolling beneath never shows through.
        let editor = t.color("--po-editor-bg");
        Self {
            dark,
            scale,
            surface: t.color("--po-csv-surface-background"),
            header: TextStyle {
                weight: t.number("--po-editable-table-header-font-weight"),
                color: t.color("--po-editable-table-header-color"),
                ..body.clone()
            },
            // `.csv-table-editor__record-index` / `-label`: disabled text,
            // tabular numbers, the table size at `line-height: 1`.
            index: TextStyle {
                color: t.color("--po-text-disabled"),
                tabular: true,
                line_height: LineHeight::Factor(1.),
                ..body.clone()
            },
            index_opacity: 0.78,
            index_background: over(t.color("--csv-table-record-index-background"), editor),
            index_width: t.len("--csv-table-record-index-width", size),
            header_background: over(
                t.color("--po-editable-table-sticky-header-background"),
                editor,
            ),
            table: EditableTableStyle::resolve(t, size),
            inset: Edges::new(
                t.len("--csv-table-content-block-start-inset", size),
                t.len("--csv-table-content-inline-end-inset", size),
                t.len("--csv-table-content-block-end-inset", size),
                t.len("--csv-table-content-inline-start-inset", size),
            ),
            selection: t.color("--po-selection-background"),
            selection_inactive: t.color("--po-selection-inactive-background"),
            caret: t.color("--po-text"),
            link: t.color("--po-csv-link-color"),
            control: t.color("--po-control"),
            text_muted: t.color("--po-text-muted"),
            body,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_the_reference_table_geometry() {
        let t = CsvTheme::resolve(true, Scale::Medium);
        assert_eq!(
            (
                t.body.size,
                t.header.weight,
                t.table.row_min_height,
                t.index_width
            ),
            (13., 650., 31., 31.)
        );
        assert!((t.body.line_height_px() - 18.85).abs() < 1e-4);
        assert_eq!(t.table.cell_padding, Edges::new(6., 10., 6., 10.));
        assert_eq!(t.inset, Edges::all(32.));
    }
}
