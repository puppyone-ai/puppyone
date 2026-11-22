//! Interactive rails, row/column grips, column resize handle, pointer capture
//! canvas, and context menu overlay for [`super::widget::TableWidget`] (`TODO-31`).
use super::{
    commands,
    interaction::{Frame, Geometry, TableUi},
    menu as table_menu,
    operation::{can_insert_column, can_insert_row},
    widget::{GROUP, TableWidget},
};
use crate::editor::{
    table::{
        controls::{self as shared_controls, GripHandlers, ResizeHandlers},
        interaction::{self as gestures, Resizing, StructureDrag, Tracks},
        menu::Scope,
        operation::{Axis, Operation},
        paint::{Draw, layer},
        style::EditableTableStyle,
    },
    view::widget::WidgetCx,
};
use gpui::{prelude::*, *};
use std::rc::Rc;

/// A grip's hit target: columns straddle the table's top edge at the
/// column centre, rows its leading edge at the row centre.
pub(crate) fn grip_bounds(g: &Geometry, axis: Axis, index: usize) -> Bounds<f32> {
    let (w, h) = shared_controls::grip_size(axis);
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

fn build_surface(id: &str, table_bounds: Bounds<f32>, ui: &Entity<TableUi>) -> Stateful<Div> {
    let (moved, left, right, down) = (ui.clone(), ui.clone(), ui.clone(), ui.clone());
    div()
        .id(SharedString::from(format!("{id}-surface")))
        .absolute()
        .left(px(table_bounds.origin.x))
        .top(px(table_bounds.origin.y))
        .w(px(table_bounds.size.width))
        .h(px(table_bounds.size.height))
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
                let hit =
                    local.and_then(|(x, y)| u.frame.as_ref().and_then(|f| f.geometry.hit(x, y)));
                if let Some((row, column)) = hit {
                    u.open_menu(Scope::Cell, row, column, position, None, window, cx);
                }
            })
        })
}

#[allow(clippy::too_many_arguments)]
fn build_grips(
    id: &str,
    style: &EditableTableStyle,
    geometry: &Geometry,
    hover: gestures::Hover,
    drag: Option<StructureDrag>,
    menu_source: Option<(Axis, usize)>,
    ui: &Entity<TableUi>,
) -> Vec<AnyElement> {
    let (rows, columns) = (geometry.rows.len(), geometry.columns.len());
    let dragging = drag.is_some_and(|d| d.moved);
    let active = |axis: Axis, index: usize| {
        drag.is_some_and(|d| d.axis == axis && d.source == index)
            || menu_source == Some((axis, index))
    };
    let shown = [
        (
            Axis::Column,
            hover
                .column
                .filter(|_| !drag.is_some_and(|d| d.moved && d.axis == Axis::Row)),
        ),
        (
            Axis::Row,
            hover
                .row
                .filter(|r| *r >= 1 && !drag.is_some_and(|d| d.moved && d.axis == Axis::Column)),
        ),
    ];
    let mut grips = Vec::new();
    for (axis, index) in shown.into_iter().filter_map(|(a, i)| Some((a, i?))) {
        if index >= if axis == Axis::Row { rows } else { columns } {
            continue;
        }
        let (press, menu_ui, hover_ui) = (ui.clone(), ui.clone(), ui.clone());
        let bounds = grip_bounds(geometry, axis, index);
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
                        Axis::Column => (u.gestures.hover.row.unwrap_or(1), index, Scope::Column),
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
        grips.push(shared_controls::grip(
            style,
            axis,
            grip_id,
            bounds,
            active(axis, index),
            dragging,
            handlers,
        ));
    }
    grips
}

#[allow(clippy::too_many_arguments)]
fn build_resize_rail(
    id: &str,
    style: &EditableTableStyle,
    geometry: &Geometry,
    rail_column: Option<usize>,
    resizing: Option<Resizing>,
    widths: &Rc<Vec<f32>>,
    natural: &Rc<dyn Fn(usize) -> f32>,
    ui: &Entity<TableUi>,
) -> Option<AnyElement> {
    let columns = geometry.columns.len();
    let column = rail_column.filter(|c| *c < columns)?;
    let (left, width) = geometry.columns[column];
    let (press, fit) = (ui.clone(), ui.clone());
    let (press_widths, fit_widths) = (widths.clone(), widths.clone());
    let natural = natural.clone();
    let t = geometry.table;
    Some(shared_controls::resize_rail(
        style,
        SharedString::from(format!("{id}-resize")),
        left + width - 0.5,
        t.origin.y,
        t.size.height,
        resizing.is_some(),
        ResizeHandlers {
            press: Rc::new(move |x, _, cx| {
                press.update(cx, |u, cx| u.start_resize(column, x, &press_widths, cx))
            }),
            auto_fit: Rc::new(move |_, cx| {
                fit.update(cx, |u, cx| {
                    u.set_width(column, natural(column), &fit_widths);
                    cx.notify();
                })
            }),
        },
    ))
}

fn build_pointer_capture_canvas(
    ui: &Entity<TableUi>,
    resizing: Option<Resizing>,
    held: Option<(Axis, usize)>,
    widths: Rc<Vec<f32>>,
) -> Canvas<()> {
    let (origin_ui, capture, resize) = (ui.clone(), ui.clone(), ui.clone());
    canvas(
        move |bounds, _, cx| origin_ui.update(cx, |u, _| u.origin = Some(bounds.origin)),
        move |_, _, window, _| {
            if resizing.is_some() {
                let (moving, release) = (resize.clone(), resize.clone());
                let up_widths = widths.clone();
                window.on_mouse_event(move |e: &MouseMoveEvent, phase, _, cx| {
                    if phase == DispatchPhase::Capture {
                        moving.update(cx, |u, cx| u.resize_to(f32::from(e.position.x), cx));
                    }
                });
                window.on_mouse_event(move |e: &MouseUpEvent, phase, _, cx| {
                    if phase == DispatchPhase::Capture && e.button == MouseButton::Left {
                        cx.stop_propagation();
                        release.update(cx, |u, cx| u.end_resize(false, &up_widths, cx));
                    }
                });
            }
            if let Some((axis, source)) = held {
                let (moving, release) = (capture.clone(), capture.clone());
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
            }
        },
    )
    .absolute()
    .left_0()
    .top_0()
    .size_full()
}

impl TableWidget {
    /// Rails, grips, the resize rail, menu, indicator and outline over the
    /// table `block`, whose column tracks are `widths` (`natural`: each
    /// column's auto-fit width).
    pub(super) fn controls(
        &self,
        block: Div,
        geometry: Geometry,
        ui: Entity<TableUi>,
        widths: Rc<Vec<f32>>,
        natural: Rc<dyn Fn(usize) -> f32>,
        cx: &mut WidgetCx,
    ) -> AnyElement {
        let style = self.style.editable.clone();
        let table_start = cx.source.start;
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
        let resizing = state.gestures.resizing;
        let rail_column = resizing
            .map(|r| r.column)
            .or(state.gestures.resize_hover)
            .filter(|_| drag.is_none());
        let menu = state
            .menu
            .as_ref()
            .map(|m| (m.position, m.menu.clone(), m.source));
        let menu_source = menu.as_ref().and_then(|m| m.2);
        let id = format!("md-table-{table_start}");
        let sender = cx.sender();
        let (rows, columns) = (geometry.rows.len(), geometry.columns.len());
        let (add_row, add_column) = (sender.clone(), sender);
        let rails = shared_controls::rails(
            &style,
            &id,
            GROUP.into(),
            geometry.table,
            Rc::new(move |window, cx| {
                if can_insert_row(rows, columns) {
                    add_row(
                        commands::structure(
                            table_start,
                            Operation::InsertRowBelow,
                            rows.saturating_sub(1),
                            0,
                        ),
                        window,
                        cx,
                    );
                }
            }),
            Rc::new(move |window, cx| {
                if can_insert_column(rows, columns) {
                    add_column(
                        commands::structure(
                            table_start,
                            Operation::InsertColumnRight,
                            0,
                            columns.saturating_sub(1),
                        ),
                        window,
                        cx,
                    );
                }
            }),
        );
        let surface = build_surface(&id, geometry.table, &ui);
        let grips = build_grips(&id, &style, &geometry, hover, drag, menu_source, &ui);
        let rail = build_resize_rail(
            &id,
            &style,
            &geometry,
            rail_column,
            resizing,
            &widths,
            &natural,
            &ui,
        );
        let draws: Vec<Draw> = drag
            .and_then(|d| d.indicator(&geometry, &style))
            .into_iter()
            .chain(
                outline_target
                    .and_then(|(axis, index)| gestures::outline(&geometry, &style, axis, index)),
            )
            .collect();
        let measure =
            build_pointer_capture_canvas(&ui, resizing, drag.map(|d| (d.axis, d.source)), widths);
        let dragging = drag.is_some_and(|d| d.moved);
        let overlay = menu.map(|(position, menu, _)| table_menu::overlay_element(position, menu));
        block
            .child(measure)
            .child(surface)
            .children(rails)
            .child(layer(draws))
            .children(grips)
            .children(rail)
            .when(dragging, |d| d.cursor(CursorStyle::ClosedHand))
            .when(resizing.is_some(), |d| {
                d.cursor(CursorStyle::ResizeLeftRight)
            })
            .children(overlay)
            .into_any_element()
    }
}
