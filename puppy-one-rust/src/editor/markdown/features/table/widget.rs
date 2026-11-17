//! The table widget (features/table/tableWidget.ts with
//! markdown-table-widget.css and the shared editable-table.css contract):
//! `.cm-md-table-widget-wrap` (rhythm gap below), the scrollport's handle
//! gutter above, the bordered rounded table with its header row. Every cell
//! is a Kit text leaf over the cell's source range, edited in place.
//!
//! Interactive rails, grips, resize rail, and menu overlay live in
//! [`super::controls`] (`TODO-31`).
use super::{
    interaction::{Geometry, TableUi, bounded_widths},
    layout,
    model::{Alignment, Table},
    style::TableStyle,
};
use crate::editor::{
    markdown::shared::ring,
    view::{
        style::TextStyle,
        widget::{BlockWidget, WidgetCx},
    },
};
use gpui::{prelude::*, *};
use std::rc::Rc;

/// `.po-editable-table-interaction-root`: rails reveal while it is hovered.
pub(super) const GROUP: &str = "md-table";

/// Column tracks include the end border (CSS `box-sizing: border-box`).
fn column_spans(widths: &[f32]) -> Vec<(f32, f32)> {
    let mut x = 1.;
    widths
        .iter()
        .map(|w| {
            let span = (x, *w);
            x += w;
            span
        })
        .collect()
}

pub struct TableWidget {
    pub(super) table: Table,
    pub(super) style: TableStyle,
    header: TextStyle,
    body: TextStyle,
    pub(super) dark: bool,
}

impl TableWidget {
    /// `body_weight`: the content weight body cells inherit.
    pub fn new(table: &Table, style: &TableStyle, body_weight: f32, dark: bool) -> Self {
        Self {
            table: table.clone(),
            style: style.clone(),
            header: style.cell_text(true, body_weight),
            body: style.cell_text(false, body_weight),
            dark,
        }
    }

    fn render_grid(
        &self,
        widths: &[f32],
        table_width: f32,
        table_top: f32,
        cx: &mut WidgetCx,
    ) -> (Vec<AnyElement>, Vec<(f32, f32)>, f32) {
        let m = &self.style;
        let p = m.cell_padding;
        let columns = widths.len();
        let rows = self.table.rows.len();
        let mut cells = Vec::new();
        let mut y = 1.;
        let mut row_spans = Vec::with_capacity(rows);
        for (r, row) in self.table.rows.iter().enumerate() {
            let style = if row.header { &self.header } else { &self.body };
            let row_top = y;
            let mut height: f32 = m.row_min_height;
            let mut x = 1.;
            let mut row_cells = Vec::with_capacity(row.cells.len());
            for (c, cell) in row.cells.iter().enumerate() {
                let w = widths[c];
                let border = if c + 1 < columns { 1. } else { 0. };
                let wrap = (w - border - p.left - p.right).max(0.);
                let (element, text_height) = cx.render.text_aligned(
                    cell.range.clone(),
                    style,
                    false,
                    Some(wrap),
                    false,
                    table_top,
                    x + p.left,
                    row_top + p.top,
                    text_align(self.table.alignments[c]),
                );
                height = height.max(p.top + text_height + p.bottom);
                row_cells.push(element);
                x += w;
            }
            if row.header {
                cells.push(
                    div()
                        .absolute()
                        .left_0()
                        .top(px(row_top))
                        .w(px(table_width))
                        .h(px(height))
                        .bg(m.header_background)
                        .into_any_element(),
                );
            }
            cells.extend(row_cells);
            let mut bx = 1.;
            for w in &widths[..columns.saturating_sub(1)] {
                bx += w;
                cells.push(
                    div()
                        .absolute()
                        .left(px(bx - 1.))
                        .top(px(row_top))
                        .w(px(1.))
                        .h(px(height))
                        .bg(m.cell_border)
                        .into_any_element(),
                );
            }
            row_spans.push((row_top, height + if r + 1 < rows { 1. } else { 0. }));
            y += height;
            if r + 1 < rows {
                cells.push(
                    div()
                        .absolute()
                        .left_0()
                        .top(px(y))
                        .w(px(table_width))
                        .h(px(1.))
                        .bg(m.cell_border)
                        .into_any_element(),
                );
                y += 1.;
            }
        }
        (cells, row_spans, y + 1.)
    }
}

fn text_align(a: Alignment) -> TextAlign {
    match a {
        Alignment::Center => TextAlign::Center,
        Alignment::Right => TextAlign::Right,
        _ => TextAlign::Left,
    }
}

impl BlockWidget for TableWidget {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let (top, width) = (cx.top, cx.width);
        let m = &self.style.clone();
        let inset = m.cell_padding.left + m.cell_padding.right + 1.;
        let automatic = layout::column_widths(&self.table, width, m.size, inset);
        let table_start = self.table.range.start;
        let expected_cols = automatic.len();
        let ui = cx
            .render
            .window
            .use_keyed_state(cx.id("md-table-ui"), cx.render.app, |_, _| TableUi {
                widths: bounded_widths(table_start, expected_cols),
                ..TableUi::default()
            });
        let state = ui.read(cx.render.app);
        let mut widths = state
            .widths
            .clone()
            .filter(|w| w.len() == expected_cols)
            .or_else(|| bounded_widths(table_start, expected_cols))
            .unwrap_or(automatic);
        if let (Some(resizing), Some(live)) = (state.gestures.resizing, state.live)
            && let Some(track) = widths.get_mut(resizing.column)
        {
            *track = live;
        }
        let table_width = 2. + widths.iter().sum::<f32>();
        let table_top = top + m.handle_gutter;
        let (cells, row_spans, table_height) =
            self.render_grid(&widths, table_width, table_top, cx);
        let selected = cx.state.selected.then_some(if cx.state.editor_focused {
            m.document_selection
        } else {
            m.document_selection_inactive
        });
        let frame = div()
            .absolute()
            .left_0()
            .top_0()
            .w(px(table_width))
            .h(px(table_height))
            .rounded(px(m.radius))
            .border_1()
            .border_color(selected.unwrap_or(m.border));
        let table = div()
            .absolute()
            .left_0()
            .top(px(m.handle_gutter))
            .w(px(table_width))
            .h(px(table_height))
            .rounded(px(m.radius))
            .overflow_hidden()
            .bg(m.background)
            .children(cells)
            .child(frame);
        let table = match selected {
            Some(color) => div()
                .absolute()
                .left_0()
                .top(px(m.handle_gutter))
                .w(px(table_width))
                .h(px(table_height))
                .child(table.top_0())
                .child(ring::ring((table_width, table_height), m.radius, 1., color)),
            None => table,
        };
        let geometry = Geometry {
            table: Bounds {
                origin: point(0., m.handle_gutter),
                size: size(table_width, table_height),
            },
            rows: row_spans
                .iter()
                .map(|(t, h)| (m.handle_gutter + t, *h))
                .collect(),
            columns: column_spans(&widths),
        };
        let height = m.handle_gutter + table_height + m.action_gutter + m.wrap_bottom;
        let block = cx
            .render
            .block_box(top, cx.left, width.max(table_width), height)
            .group(GROUP)
            .child(table);
        let element = if cx.state.read_only {
            block.into_any_element()
        } else {
            let (table_model, font) = (self.table.clone(), m.size);
            let natural = Rc::new(move |column| {
                layout::natural_width(&table_model, column, width, font, inset)
            });
            self.controls(block, geometry, ui, Rc::new(widths), natural, cx)
        };
        (element.into_any_element(), height)
    }
}
