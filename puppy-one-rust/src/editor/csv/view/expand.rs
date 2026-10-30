//! The expansion corner (`CsvTableResizeControl`): drag it outward to grow
//! the table by whole rows (31px) and 96px columns — previewed in the table
//! itself with an accent frame and a dimensions status — or click it for a
//! 6×6 size picker. Vertical growth is bounded by the remaining viewport;
//! horizontal growth edge-scrolls. Escape, blur or lost capture cancel.
use super::*;
use crate::{
    editor::csv::operations::{MAX_COLUMNS, MAX_DATA_ROWS},
    localization::{Arg, tf},
    theme::{Theme, metric},
    ui::components::MenuVariant,
};
use std::time::Instant;

const ACTIVATION: f32 = 8.;
const PICKER_ROWS: usize = 6;
const PICKER_COLUMNS: usize = 6;
const EDGE_ZONE: f32 = 48.;
const EDGE_SPEED: f32 = 600.;
/// `EDITABLE_TABLE_COLUMN_MIN_WIDTH`: the width of an added column.
pub(super) const ADDED_COLUMN_WIDTH: f32 = COLUMN_MIN_WIDTH;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Expansion {
    pub(super) rows: usize,
    pub(super) columns: usize,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct ExpandDrag {
    pub(super) start: Point<Pixels>,
    pub(super) current: Point<Pixels>,
    pub(super) moved: bool,
    pub(super) base_rows: usize,
    pub(super) base_columns: usize,
    pub(super) max_rows: usize,
    pub(super) max_columns: usize,
    /// The scrollport's vertical extent in window coordinates (pointer clamp).
    pub(super) bounds: (f32, f32),
    pub(super) start_scroll_x: f32,
    pub(super) auto_scroll: f32,
    pub(super) last_frame: Option<Instant>,
    pub(super) preview: Expansion,
}

/// The expansion corner's state (`CsvTableResizeControl`): a drag in
/// progress and the open size picker.
#[derive(Default)]
pub(super) struct Expanding {
    pub(super) drag: Option<ExpandDrag>,
    pub(super) picker: Option<Picker>,
}

pub(super) struct Picker {
    pub(super) selection: Expansion,
    /// `:focus-visible` on the selected cell after keyboard use.
    pub(super) keyboard: bool,
    pub(super) focus: FocusHandle,
}

/// `snapOutwardDistanceToTrackCount`: a track counts once the edge crosses
/// its midpoint.
pub(super) fn snap(distance: f32, track: f32, maximum: usize) -> usize {
    let track = if track.is_finite() && track > 0. {
        track
    } else {
        1.
    };
    (((distance.max(0.) + track / 2.) / track).floor() as usize).min(maximum)
}

/// `getCsvExpansionEdgeVelocity`: px/s while the pointer presses into the
/// trailing 48px of the scrollport.
pub(super) fn edge_velocity(pointer_x: f32, viewport_right: f32) -> f32 {
    ((pointer_x - (viewport_right - EDGE_ZONE)) / EDGE_ZONE).clamp(0., 1.) * EDGE_SPEED
}

fn dimensions(rows: usize, columns: usize) -> String {
    tf(
        "editor.csv.dimensions",
        &[
            ("rows", Arg::Number(rows as i64)),
            ("columns", Arg::Number(columns as i64)),
        ],
    )
}

fn delta(e: Expansion) -> String {
    format!("+{} × +{}", e.rows, e.columns)
}

impl CsvEditor {
    pub(super) fn data_rows(&self) -> usize {
        self.rows() - self.header_rows()
    }

    /// The live drag preview (empty unless a drag has moved).
    pub(super) fn preview(&self) -> Expansion {
        self.expansion
            .drag
            .filter(|d| d.moved)
            .map(|d| d.preview)
            .unwrap_or_default()
    }

    fn available(&self) -> (usize, usize) {
        (
            MAX_DATA_ROWS.saturating_sub(self.data_rows()),
            MAX_COLUMNS.saturating_sub(self.columns()),
        )
    }

    pub(super) fn start_expand(
        &mut self,
        position: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (rows, columns) = self.available();
        if self.read_only || (rows == 0 && columns == 0) {
            return;
        }
        let Some(origin) = self.port.origin else {
            return;
        };
        self.expansion.picker = None;
        self.close_menu(false, window, cx);
        // Vertical growth uses the canvas left below the table.
        let (_, ty) = self.table_origin();
        let (_, th) = self.table_size();
        let surface_bottom = f32::from(origin.y) + ty + th - self.port.scroll.y;
        let viewport = (
            f32::from(origin.y),
            f32::from(origin.y) + self.port.size.height,
        );
        let max_rows = rows.min(
            ((viewport.1 - surface_bottom).max(0.) / self.theme.table.row_min_height).floor()
                as usize,
        );
        self.expansion.drag = Some(ExpandDrag {
            start: position,
            current: position,
            moved: false,
            base_rows: self.data_rows(),
            base_columns: self.columns(),
            max_rows,
            max_columns: columns,
            bounds: viewport,
            start_scroll_x: self.port.scroll.x,
            auto_scroll: 0.,
            last_frame: None,
            preview: Expansion::default(),
        });
        cx.notify();
    }

    fn publish_preview(&mut self, cx: &mut Context<Self>) {
        let Some(mut drag) = self.expansion.drag else {
            return;
        };
        let y = f32::from(drag.current.y).clamp(drag.bounds.0, drag.bounds.1);
        let preview = Expansion {
            rows: snap(
                y - f32::from(drag.start.y),
                self.theme.table.row_min_height,
                drag.max_rows,
            ),
            columns: snap(
                f32::from(drag.current.x - drag.start.x) + drag.auto_scroll,
                ADDED_COLUMN_WIDTH,
                drag.max_columns,
            ),
        };
        if preview != drag.preview {
            drag.preview = preview;
            self.expansion.drag = Some(drag);
            cx.notify();
        }
    }

    pub(super) fn drag_expand(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let Some(mut drag) = self.expansion.drag else {
            return;
        };
        let y = f32::from(position.y).clamp(drag.bounds.0, drag.bounds.1);
        let (dx, dy) = (
            f32::from(position.x - drag.start.x),
            y - f32::from(drag.start.y),
        );
        if !drag.moved && dx.hypot(dy) < ACTIVATION {
            return;
        }
        drag.moved = true;
        drag.current = position;
        self.expansion.drag = Some(drag);
        self.publish_preview(cx);
        cx.notify();
    }

    /// One edge-scroll frame (`advanceAutoScroll`); returns whether to keep
    /// animating.
    pub(super) fn advance_expand_scroll(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(mut drag) = self.expansion.drag.filter(|d| d.moved) else {
            return false;
        };
        let Some(origin) = self.port.origin else {
            return false;
        };
        let velocity = edge_velocity(
            f32::from(drag.current.x),
            f32::from(origin.x) + self.port.size.width,
        );
        if velocity == 0. || drag.preview.columns >= drag.max_columns {
            drag.last_frame = None;
            self.expansion.drag = Some(drag);
            return false;
        }
        let now = Instant::now();
        let elapsed = drag
            .last_frame
            .map_or(16., |t| (now - t).as_secs_f32() * 1000.)
            .clamp(0., 32.);
        drag.last_frame = Some(now);
        drag.auto_scroll += velocity * elapsed / 1000.;
        self.expansion.drag = Some(drag);
        self.publish_preview(cx);
        // The new tracks exist before scrolling into them.
        let (cw, _) = self.content_size();
        self.port.scroll.x =
            (drag.start_scroll_x + drag.auto_scroll).min((cw - self.port.size.width).max(0.));
        cx.notify();
        true
    }

    /// Release: a drag grows the table to its preview; a click toggles the
    /// size picker. `cancel` restores the scroll position.
    pub(super) fn end_expand(&mut self, cancel: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(drag) = self.expansion.drag.take() else {
            return;
        };
        cx.notify();
        if cancel {
            self.port.scroll.x = drag.start_scroll_x;
            return;
        }
        if !drag.moved {
            self.toggle_picker(window, cx);
            return;
        }
        if drag.preview != Expansion::default() {
            self.expand_to(
                drag.base_rows + drag.preview.rows,
                drag.base_columns + drag.preview.columns,
                window,
                cx,
            );
        }
    }

    fn expand_to(
        &mut self,
        data_rows: usize,
        columns: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.expansion.picker = None;
        let row = self.rows().saturating_sub(1);
        self.apply_operation(
            Operation::ExpandToShape { data_rows, columns },
            row,
            0,
            window,
            cx,
        );
    }

    fn picker_size(&self) -> (usize, usize) {
        let (rows, columns) = self.available();
        (rows.min(PICKER_ROWS), columns.min(PICKER_COLUMNS))
    }

    pub(super) fn toggle_picker(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (rows, columns) = self.picker_size();
        if self.expansion.picker.take().is_some() || rows == 0 || columns == 0 {
            cx.notify();
            return;
        }
        let focus = cx.focus_handle();
        focus.focus(window, cx);
        self.expansion.picker = Some(Picker {
            selection: Expansion {
                rows: 1,
                columns: 1,
            },
            keyboard: false,
            focus,
        });
        cx.notify();
    }

    /// `movePickerSelection`.
    fn picker_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let (rows, columns) = self.picker_size();
        let Some(picker) = &mut self.expansion.picker else {
            return;
        };
        let Expansion {
            rows: r,
            columns: c,
        } = picker.selection;
        let next = match event.keystroke.key.as_str() {
            "up" => (r.saturating_sub(1), c),
            "down" => (r + 1, c),
            "left" => (r, c.saturating_sub(1)),
            "right" => (r, c + 1),
            "enter" | "space" => {
                cx.stop_propagation();
                let (data_rows, cols) = (self.data_rows() + r, self.columns() + c);
                self.expand_to(data_rows, cols, window, cx);
                return;
            }
            "escape" => {
                cx.stop_propagation();
                self.expansion.picker = None;
                self.focus.focus(window, cx);
                cx.notify();
                return;
            }
            _ => return,
        };
        cx.stop_propagation();
        picker.selection = Expansion {
            rows: next.0.clamp(1, rows),
            columns: next.1.clamp(1, columns),
        };
        picker.keyboard = true;
        cx.notify();
    }

    /// The size picker (`.csv-table-editor__resize-picker`): a 200px menu
    /// surface above the corner, right-aligned to it.
    pub(super) fn picker_element(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let picker = self.expansion.picker.as_ref()?;
        let t = Theme::new(self.theme.dark);
        let (tx, ty) = self.table_origin();
        let (tw, th) = self.table_size();
        let (rows, columns) = self.picker_size();
        let selection = picker.selection;
        let text = |weight: f32, color: Rgba| {
            let style = TextStyle {
                size: self.theme.body.size,
                weight,
                italic: false,
                mono: false,
                color,
                tabular: true,
                line_height: LineHeight::Factor(1.2),
            };
            let mut d = div().whitespace_nowrap();
            style.apply(d.style());
            d
        };
        let cell_border = crate::theme::mix(t.divider, t.muted, 0.9);
        let cell_bg = crate::theme::mix(t.control, Rgba::default(), 0.38);
        let selected_border = crate::theme::mix(t.accent, t.divider, 0.58);
        let selected_bg = crate::theme::mix(t.accent, t.control, 0.18);
        let focus_ring = self.theme.table.focus_ring;
        let mut grid = div().flex().flex_col().gap(px(3.));
        for row in 1..=rows {
            let mut line = div().flex().gap(px(3.));
            for column in 1..=columns {
                let chosen = row <= selection.rows && column <= selection.columns;
                let focused = picker.keyboard && selection == Expansion { rows: row, columns };
                let label = tf(
                    "editor.csv.expandTo",
                    &[
                        ("rows", Arg::Number((self.data_rows() + row) as i64)),
                        ("columns", Arg::Number((self.columns() + column) as i64)),
                    ],
                );
                line = line.child(
                    div()
                        .id(("csv-resize-picker-cell", row * 16 + column))
                        .size(px(16.))
                        .rounded(px(3.))
                        .border_1()
                        .border_color(if chosen { selected_border } else { cell_border })
                        .bg(if chosen { selected_bg } else { cell_bg })
                        .cursor(crate::theme::clickable_cursor())
                        .when(focused, |d| {
                            d.shadow(vec![BoxShadow {
                                color: focus_ring.into(),
                                offset: point(px(0.), px(0.)),
                                blur_radius: px(0.),
                                spread_radius: px(1.5),
                                inset: false,
                            }])
                        })
                        .tooltip(crate::ui::components::tooltip(label))
                        .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                            if *hovered && let Some(p) = &mut this.expansion.picker {
                                p.selection = Expansion {
                                    rows: row,
                                    columns: column,
                                };
                                cx.notify();
                            }
                        }))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            let (data_rows, cols) =
                                (this.data_rows() + row, this.columns() + column);
                            this.expand_to(data_rows, cols, window, cx);
                        })),
                );
            }
            grid = grid.child(line);
        }
        let summary = div()
            .flex()
            .items_baseline()
            .gap(px(12.))
            .child(
                text(650., t.text)
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .text_ellipsis()
                    .child(dimensions(
                        self.data_rows() + selection.rows,
                        self.columns() + selection.columns,
                    )),
            )
            .child(text(400., t.muted).flex_shrink_0().child(delta(selection)));
        let width = 200.;
        let right = tx + tw + self.theme.table.action_gutter;
        let bottom = ty + th - 6.;
        Some(
            deferred(
                div()
                    .absolute()
                    .left(px(right - width))
                    .top(px(bottom))
                    .child(
                        div()
                            .id("csv-resize-picker")
                            .track_focus(&picker.focus)
                            .occlude()
                            .absolute()
                            .bottom_0()
                            .left_0()
                            .w(px(width))
                            .flex()
                            .flex_col()
                            .gap(px(8.))
                            .p(px(9.))
                            .border_1()
                            .border_color(t.border)
                            .rounded(px(metric::MENU_RADIUS))
                            .child(crate::ui::components::menu::padding_box_fill(
                                metric::MENU_RADIUS,
                                t.menu_bg,
                            ))
                            .shadow(MenuVariant::Default.shadow(t))
                            .on_key_down(cx.listener(|this, e: &KeyDownEvent, window, cx| {
                                this.picker_key(e, window, cx)
                            }))
                            .on_mouse_down_out(cx.listener(|this, _, _, cx| {
                                if this.expansion.picker.take().is_some() {
                                    cx.notify();
                                }
                            }))
                            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                            .child(summary)
                            .child(grid),
                    ),
            )
            .with_priority(2)
            .into_any_element(),
        )
    }

    /// `.csv-table-editor__resize-status`: the projected dimensions while a
    /// drag adds rows or columns (bottom-right of the editor).
    pub(super) fn expand_status(&self) -> Option<AnyElement> {
        let preview = self.preview();
        if preview == Expansion::default() {
            return None;
        }
        let drag = self.expansion.drag?;
        let t = Theme::new(self.theme.dark);
        let text = |weight: f32, color: Rgba| {
            let style = TextStyle {
                size: self.theme.body.size,
                weight,
                italic: false,
                mono: false,
                color,
                tabular: false,
                line_height: LineHeight::Factor(1.2),
            };
            let mut d = div().whitespace_nowrap();
            style.apply(d.style());
            d
        };
        // `--po-elevation-low`.
        let shadow = BoxShadow {
            color: crate::theme::alpha(t.shadow, 0.28).into(),
            offset: point(px(0.), px(2.)),
            blur_radius: px(4.),
            spread_radius: px(-2.),
            inset: false,
        };
        Some(
            div()
                .absolute()
                .right(px(6.))
                .bottom(px(7.))
                .flex()
                .items_baseline()
                .gap(px(8.))
                .px(px(8.))
                .py(px(5.))
                .border_1()
                .border_color(t.border)
                .rounded(px(7.))
                .bg(crate::theme::mix(t.panel_raised, Rgba::default(), 0.96))
                .shadow(vec![shadow])
                .child(text(650., t.text).child(dimensions(
                    drag.base_rows + preview.rows,
                    drag.base_columns + preview.columns,
                )))
                .child(text(400., t.muted).child(delta(preview)))
                .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{edge_velocity, snap};

    #[test]
    fn drags_snap_to_whole_tracks_past_their_midpoint() {
        assert_eq!(snap(15., 31., 9), 0);
        assert_eq!(snap(15.5, 31., 9), 1);
        assert_eq!(snap(100., 31., 9), 3);
        assert_eq!(snap(-40., 31., 9), 0);
        assert_eq!(snap(1000., 96., 2), 2);
    }

    #[test]
    fn edge_scrolling_ramps_up_inside_the_trailing_zone() {
        assert_eq!(edge_velocity(900., 1000.), 0.);
        assert_eq!(edge_velocity(976., 1000.), 300.);
        assert_eq!(edge_velocity(1100., 1000.), 600.);
    }
}
