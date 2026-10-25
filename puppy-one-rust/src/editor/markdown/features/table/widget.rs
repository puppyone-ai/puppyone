//! The table widget (features/table/tableWidget.ts with
//! markdown-table-widget.css and the shared editable-table.css contract):
//! `.cm-md-table-widget-wrap` (rhythm gap below), the scrollport's handle
//! gutter above, the bordered rounded table with its header row. Every cell
//! is a Kit text leaf over the cell's source range, edited in place.
//!
//! Its controls are the shared editable-table ones (`editor::table`): the
//! add-row / add-column rails, row and column grips (drag to move, click
//! for the axis menu), the right-click action menu, the drop indicator and
//! the structural selection; their state lives in keyed element state
//! (`interaction::TableUi`) and every edit is a table command.
use super::{
    commands,
    interaction::{Frame, Geometry, TableUi},
    model::{self, Alignment, Table},
    style::TableStyle,
};
use crate::editor::{
    markdown::shared::ring,
    table::{
        controls::{self, GripHandlers},
        interaction::{self as gestures, Tracks},
        menu::Scope,
        operation::{Axis, Operation},
        paint::{Draw, layer},
    },
    view::{
        style::TextStyle,
        widget::{BlockWidget, WidgetCx},
    },
};
use gpui::{prelude::*, *};
use std::rc::Rc;

/// `.po-editable-table-interaction-root`: rails reveal while it is hovered.
const GROUP: &str = "md-table";

/// Column tracks: each width plus its end border (none after the last).
fn column_spans(widths: &[f32]) -> Vec<(f32, f32)> {
    let mut x = 1.;
    widths
        .iter()
        .enumerate()
        .map(|(c, w)| {
            let border = if c + 1 < widths.len() { 1. } else { 0. };
            let span = (x, w + border);
            x += w + 1.;
            span
        })
        .collect()
}

/// A grip's hit target: columns straddle the table's top edge at the
/// column centre, rows its leading edge at the row centre.
fn grip_bounds(g: &Geometry, axis: Axis, index: usize) -> Bounds<f32> {
    let (w, h) = controls::grip_size(axis);
    let (x, y) = match axis {
        Axis::Column => {
            let (left, width) = g.column_span(index);
            (left + width / 2. - w / 2., g.table.origin.y - h / 2.)
        }
        Axis::Row => {
            let (top, height) = g.row_span(index);
            (g.table.origin.x - w / 2., top + height / 2. - h / 2.)
        }
    };
    Bounds {
        origin: point(x, y),
        size: size(w, h),
    }
}

pub struct TableWidget {
    table: Table,
    style: TableStyle,
    header: TextStyle,
    body: TextStyle,
    dark: bool,
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
}

fn text_align(a: Alignment) -> TextAlign {
    match a {
        Alignment::Center => TextAlign::Center,
        Alignment::Right => TextAlign::Right,
        _ => TextAlign::Left,
    }
}

impl TableWidget {
    /// Rails, grips, menu, indicator and outline over the table `block`.
    fn controls(&self, block: Div, geometry: Geometry, cx: &mut WidgetCx) -> AnyElement {
        let style = self.style.editable.clone();
        let table_start = self.table.range.start;
        let ui = cx
            .render
            .window
            .use_keyed_state(cx.id("md-table-ui"), cx.render.app, |_, _| {
                TableUi::default()
            });
        let frame = Frame {
            geometry: geometry.clone(),
            table: table_start,
            alignments: self.table.alignments.clone(),
            dark: self.dark,
            sender: cx.sender(),
            focus_editor: cx.focuser(),
        };
        ui.update(cx.render.app, |u, _| u.frame = Some(frame));
        let state = ui.read(cx.render.app);
        let (hover, drag, outline_target) =
            (state.gestures.hover, state.gestures.drag, state.outline());
        let menu = state
            .menu
            .as_ref()
            .map(|m| (m.position, m.menu.clone(), m.source));
        let menu_source = menu.as_ref().and_then(|m| m.2);
        let id = format!("md-table-{table_start}");
        let sender = cx.sender();
        // The rails insert after the last row / column.
        let (rows, columns) = (geometry.rows.len(), geometry.columns.len());
        let (add_row, add_column) = (sender.clone(), sender.clone());
        let rails = controls::rails(
            &style,
            &id,
            GROUP.into(),
            geometry.table,
            Rc::new(move |window, cx| {
                add_row(
                    commands::structure(
                        table_start,
                        Operation::InsertRowBelow,
                        rows.saturating_sub(1),
                        0,
                    ),
                    window,
                    cx,
                )
            }),
            Rc::new(move |window, cx| {
                add_column(
                    commands::structure(
                        table_start,
                        Operation::InsertColumnRight,
                        0,
                        columns.saturating_sub(1),
                    ),
                    window,
                    cx,
                )
            }),
        );
        // The table surface: hover follows cells; a secondary press opens
        // the cell actions; a press on a cell ends a structural selection.
        let (moved, left, right, down) = (ui.clone(), ui.clone(), ui.clone(), ui.clone());
        let t = geometry.table;
        let surface = div()
            .id(SharedString::from(format!("{id}-surface")))
            .absolute()
            .left(px(t.origin.x))
            .top(px(t.origin.y))
            .w(px(t.size.width))
            .h(px(t.size.height))
            .on_mouse_move(move |e: &MouseMoveEvent, _, cx| {
                moved.update(cx, |u, cx| u.pointer_moved(e.position, cx))
            })
            .on_hover(move |hovered, window, cx| {
                let hovered = *hovered;
                left.update(cx, |u, _| u.gestures.surface_hovered = hovered);
                if !hovered {
                    let left = left.clone();
                    window.defer(cx, move |_, cx| left.update(cx, |u, cx| u.pointer_left(cx)));
                }
            })
            .on_mouse_down(MouseButton::Left, move |_, _, cx| {
                down.update(cx, |u, cx| {
                    if u.gestures.structural.take().is_some() {
                        cx.notify();
                    }
                })
            })
            .on_mouse_down(MouseButton::Right, move |e: &MouseDownEvent, window, cx| {
                cx.stop_propagation();
                let position = e.position;
                right.update(cx, |u, cx| {
                    let local = u
                        .origin
                        .map(|o| (f32::from(position.x - o.x), f32::from(position.y - o.y)));
                    let hit = local
                        .and_then(|(x, y)| u.frame.as_ref().and_then(|f| f.geometry.hit(x, y)));
                    if let Some((row, column)) = hit {
                        u.open_menu(Scope::Cell, row, column, position, None, window, cx);
                    }
                })
            });
        // Grips for the hovered column and body row.
        let dragging = drag.is_some_and(|d| d.moved);
        let active = |axis: Axis, index: usize| {
            drag.is_some_and(|d| d.axis == axis && d.source == index)
                || menu_source == Some((axis, index))
        };
        let mut grips = Vec::new();
        let shown = [
            (
                Axis::Column,
                hover
                    .column
                    .filter(|_| !drag.is_some_and(|d| d.moved && d.axis == Axis::Row)),
            ),
            (
                Axis::Row,
                hover.row.filter(|r| {
                    *r >= 1 && !drag.is_some_and(|d| d.moved && d.axis == Axis::Column)
                }),
            ),
        ];
        for (axis, index) in shown.into_iter().filter_map(|(a, i)| Some((a, i?))) {
            if index >= if axis == Axis::Row { rows } else { columns } {
                continue;
            }
            let (press, menu_ui, hover_ui) = (ui.clone(), ui.clone(), ui.clone());
            let bounds = grip_bounds(&geometry, axis, index);
            let handlers = GripHandlers {
                press: Rc::new(move |position, _, cx| {
                    press.update(cx, |u, cx| u.start_drag(axis, position, cx))
                }),
                menu: Rc::new(move |window, cx| {
                    menu_ui.update(cx, |u, cx| {
                        let Some(origin) = u.origin else { return };
                        let at = point(
                            origin.x + px(bounds.origin.x + 5.),
                            origin.y + px(bounds.origin.y + bounds.size.height - 5. + 4.),
                        );
                        let (row, column, scope) = match axis {
                            Axis::Column => {
                                (u.gestures.hover.row.unwrap_or(1), index, Scope::Column)
                            }
                            Axis::Row => (index, u.gestures.hover.column.unwrap_or(0), Scope::Row),
                        };
                        u.open_menu(scope, row, column, at, Some((axis, index)), window, cx);
                    })
                }),
                hover: Rc::new(move |hovered, window, cx| {
                    hover_ui.update(cx, |u, _| u.gestures.grip_hovered = hovered);
                    if !hovered {
                        let hover_ui = hover_ui.clone();
                        window.defer(cx, move |_, cx| {
                            hover_ui.update(cx, |u, cx| u.pointer_left(cx))
                        });
                    }
                }),
            };
            let grip_id = SharedString::from(format!(
                "{id}-{}-grip",
                if axis == Axis::Row { "row" } else { "column" }
            ));
            grips.push(controls::grip(
                &style,
                axis,
                grip_id,
                bounds,
                active(axis, index),
                dragging,
                handlers,
            ));
        }
        // The drop indicator and the structural selection perimeter.
        let draws: Vec<Draw> = drag
            .and_then(|d| d.indicator(&geometry, &style))
            .into_iter()
            .chain(
                outline_target
                    .and_then(|(axis, index)| gestures::outline(&geometry, &style, axis, index)),
            )
            .collect();
        // The block origin in window coordinates, and pointer capture while a
        // grip is held (`setPointerCapture`).
        let (origin_ui, capture) = (ui.clone(), ui.clone());
        let held = drag.map(|d| (d.axis, d.source));
        let measure = canvas(
            move |bounds, _, cx| origin_ui.update(cx, |u, _| u.origin = Some(bounds.origin)),
            move |_, _, window, _| {
                let Some((axis, source)) = held else { return };
                let (moving, release, escape) = (capture.clone(), capture.clone(), capture.clone());
                window.on_mouse_event(move |e: &MouseMoveEvent, phase, _, cx| {
                    if phase == DispatchPhase::Capture {
                        moving.update(cx, |u, cx| u.drag_to(e.position, cx));
                    }
                });
                window.on_mouse_event(move |e: &MouseUpEvent, phase, window, cx| {
                    if phase == DispatchPhase::Capture && e.button == MouseButton::Left {
                        release.update(cx, |u, cx| {
                            let grip = u
                                .frame
                                .as_ref()
                                .map(|f| grip_bounds(&f.geometry, axis, source))
                                .unwrap_or_default();
                            u.end_drag(false, grip, window, cx)
                        });
                    }
                });
                window.on_key_event(move |e: &KeyDownEvent, phase, window, cx| {
                    if phase == DispatchPhase::Capture && e.keystroke.key == "escape" {
                        escape.update(cx, |u, cx| u.end_drag(true, Bounds::default(), window, cx));
                    }
                });
            },
        )
        .absolute()
        .left_0()
        .top_0()
        .size_full();
        let overlay = menu.map(|(position, menu, _)| {
            deferred(
                anchored()
                    .position(position)
                    .snap_to_window_with_margin(px(8.))
                    .child(menu),
            )
            .with_priority(1)
        });
        block
            .child(measure)
            .child(surface)
            .children(rails)
            .child(layer(draws))
            .children(grips)
            .when(dragging, |d| d.cursor(CursorStyle::ClosedHand))
            .children(overlay)
            .into_any_element()
    }
}

impl BlockWidget for TableWidget {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let (top, width) = (cx.top, cx.width);
        let m = &self.style.clone();
        let widths = model::column_widths(&self.table);
        let columns = widths.len();
        // `border: 1px` around a `border-collapse: separate` grid whose cells
        // draw right / bottom borders except on the last column / row.
        let table_width = 2. + widths.iter().sum::<f32>() + columns.saturating_sub(1) as f32;
        let table_top = top + m.handle_gutter;
        let p = m.cell_padding;
        let mut cells = Vec::new();
        let mut y = 1.;
        let rows = self.table.rows.len();
        let mut row_spans = Vec::with_capacity(rows);
        for (r, row) in self.table.rows.iter().enumerate() {
            let style = if row.header { &self.header } else { &self.body };
            let row_top = y;
            let mut height: f32 = m.row_min_height;
            let mut x = 1.;
            let mut row_cells = Vec::new();
            for (c, cell) in row.cells.iter().enumerate() {
                let w = widths[c];
                let wrap = (w - p.left - p.right).max(0.);
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
                x += w + 1.;
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
            // Cell borders: right of every column but the last, bottom of
            // every row but the last.
            let mut bx = 1.;
            for w in &widths[..columns.saturating_sub(1)] {
                bx += w;
                cells.push(
                    div()
                        .absolute()
                        .left(px(bx))
                        .top(px(row_top))
                        .w(px(1.))
                        .h(px(height))
                        .bg(m.cell_border)
                        .into_any_element(),
                );
                bx += 1.;
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
        let table_height = y + 1.;
        // The outer border is an overlay so cell coordinates include it. A
        // selection sweeping over the table selects it as one block: its
        // frame takes the selection colour with a 1px ring.
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
            // `box-shadow: 0 0 0 1px` outside the border, not under the
            // translucent body.
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
            self.controls(block, geometry, cx)
        };
        (element.into_any_element(), height)
    }
}
