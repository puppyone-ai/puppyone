//! Table presentation (markdown-table-widget.css with the editable-table
//! contract resolved on `.cm-md-table-widget-wrap`).
use crate::editor::{
    table::style::EditableTableStyle,
    tokens::Tokens,
    view::style::{Edges, LineHeight, TextStyle},
};
use gpui::Rgba;

#[derive(Clone, Debug, PartialEq)]
pub struct TableStyle {
    /// `--po-md-table-color`: table lines in source mode.
    pub color: Rgba,
    /// `--po-md-table-header-color` / `-body-color` / `-header-weight`.
    pub header_color: Rgba,
    pub body_color: Rgba,
    pub header_weight: f32,
    /// `--po-md-table-font-size` / `-line-height`.
    pub size: f32,
    pub line_height: f32,
    /// `--po-md-table-background` / `-header-background`.
    pub background: Rgba,
    pub header_background: Rgba,
    /// `--po-md-table-border` / `-cell-border` / `-cell-padding`.
    pub border: Rgba,
    pub cell_border: Rgba,
    pub cell_padding: Edges,
    /// `--po-editable-table-handle-gutter` / `-action-gutter`.
    pub handle_gutter: f32,
    pub action_gutter: f32,
    /// `.cm-md-table-widget-wrap { padding-block: 0 18px }`.
    pub wrap_bottom: f32,
    /// `--po-editable-table-radius` / `-row-min-height`.
    pub radius: f32,
    pub row_min_height: f32,
    /// `--po-editable-table-structure-background`.
    pub structure_background: Rgba,
    /// `--cm-md-table-document-selection`: the block-selected frame.
    pub document_selection: Rgba,
    pub document_selection_inactive: Rgba,
    /// The shared editable-table contract (rails, grips, selection).
    pub editable: EditableTableStyle,
}

impl TableStyle {
    pub fn resolve(t: &Tokens, size: f32) -> Self {
        let table = t.len("--po-md-table-font-size", size);
        Self {
            color: t.color("--po-md-table-color"),
            header_color: t.color("--po-md-table-header-color"),
            body_color: t.color("--po-md-table-body-color"),
            header_weight: t.number("--po-md-table-header-weight"),
            size: table,
            line_height: t.number("--po-md-table-line-height"),
            background: t.color("--po-md-table-background"),
            header_background: t.color("--po-md-table-header-background"),
            border: t.color("--po-md-table-border"),
            cell_border: t.color("--po-md-table-cell-border"),
            cell_padding: t.edges_at("--po-md-table-cell-padding", table),
            handle_gutter: t.len("--po-editable-table-handle-gutter", table),
            action_gutter: t.len("--po-editable-table-action-gutter", table),
            wrap_bottom: 18.,
            radius: t.len("--po-editable-table-radius", table),
            row_min_height: t.len("--po-editable-table-row-min-height", table),
            structure_background: t.color("--po-editable-table-structure-background"),
            document_selection: t.color("--po-md-selection-bg"),
            document_selection_inactive: t.color("--po-md-selection-inactive-bg"),
            editable: EditableTableStyle::resolve(t, table),
        }
    }

    /// Cell text (`th` takes the header colour and weight).
    pub fn cell_text(&self, header: bool, weight: f32) -> TextStyle {
        let text = TextStyle {
            size: self.size,
            weight,
            italic: false,
            mono: false,
            color: self.body_color,
            tabular: false,
            line_height: LineHeight::Factor(self.line_height),
        };
        if header {
            TextStyle {
                weight: self.header_weight,
                color: self.header_color,
                ..text
            }
        } else {
            text
        }
    }
}
