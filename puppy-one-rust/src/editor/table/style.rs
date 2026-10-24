//! The shared editable-table contract (editable-table.css `--po-editable-table-*`):
//! grid strokes, cell geometry, the structure rails, drag grips, structural
//! selection and resize rail. Both CSV and Markdown resolve it from their own
//! token sets (the tokens are bound on each format's table wrapper).
use crate::editor::{
    tokens::{Tokens, over},
    view::style::Edges,
};
use gpui::Rgba;

#[derive(Clone, Debug, PartialEq)]
pub struct EditableTableStyle {
    /// `--po-editable-table-border` / `-cell-border`.
    pub border: Rgba,
    pub cell_border: Rgba,
    /// `--po-editable-table-radius` / `-row-min-height` / `-cell-padding`.
    pub radius: f32,
    pub row_min_height: f32,
    pub cell_padding: Edges,
    /// `--po-editable-table-handle-gutter` / `-action-gutter`.
    pub handle_gutter: f32,
    pub action_gutter: f32,
    /// The add rails (`--po-editable-table-structure-*`).
    pub structure_background: Rgba,
    pub structure_hover_background: Rgba,
    pub structure_hover_border: Rgba,
    pub structure_hover_color: Rgba,
    /// `--po-editable-table-cell-focus-ring` and its stroke.
    pub focus_ring: Rgba,
    pub focus_stroke: f32,
    /// Grips: the face (`--po-editable-table-handle-background`, the border
    /// tint over the editor base, rim included), its dots and their hover.
    pub handle_background: Rgba,
    pub handle_color: Rgba,
    pub handle_hover_color: Rgba,
    /// `--po-editable-table-selection-border` / `-stroke`: structural
    /// selection, pressed grips, drop indicator.
    pub selection_border: Rgba,
    pub selection_stroke: f32,
    /// `--po-accent`: the column resize rail.
    pub accent: Rgba,
}

impl EditableTableStyle {
    /// At the table's font size (`em` lengths).
    pub fn resolve(t: &Tokens, size: f32) -> Self {
        let editor = t.color("--po-editor-bg");
        Self {
            border: t.color("--po-editable-table-border"),
            cell_border: t.color("--po-editable-table-cell-border"),
            radius: t.len("--po-editable-table-radius", size),
            row_min_height: t.len("--po-editable-table-row-min-height", size),
            cell_padding: t.edges_at("--po-editable-table-cell-padding", size),
            handle_gutter: t.len("--po-editable-table-handle-gutter", size),
            action_gutter: t.len("--po-editable-table-action-gutter", size),
            structure_background: t.color("--po-editable-table-structure-background"),
            structure_hover_background: t.color("--po-editable-table-structure-hover-background"),
            structure_hover_border: t.color("--po-editable-table-structure-hover-border"),
            structure_hover_color: t.color("--po-editable-table-structure-hover-color"),
            focus_ring: t.color("--po-editable-table-cell-focus-ring"),
            focus_stroke: t.len("--po-editable-table-selection-stroke", size),
            handle_background: over(t.color("--po-editable-table-handle-border"), editor),
            handle_color: t.color("--po-editable-table-handle-color"),
            handle_hover_color: t.color("--po-text"),
            selection_border: t.color("--po-editable-table-selection-border"),
            selection_stroke: t.len("--po-editable-table-selection-stroke", size),
            accent: t.color("--po-accent"),
        }
    }
}
