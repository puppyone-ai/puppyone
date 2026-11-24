//! The table widget (features/table/tableWidget.ts with
//! markdown-table-widget.css and the shared editable-table.css contract):
//! `.cm-md-table-widget-wrap` (rhythm gap below), the scrollport's handle
//! gutter above, the bordered rounded table with its header row. Every cell
//! is a Kit text leaf over the cell's source range, edited in place.
//!
//! Interactive rails, grips, resize rail, and menu overlay live in
//! [`super::controls`] (`TODO-31`).
use super::{
    interaction::{Geometry, LayoutLink, TableUi},
    layout,
    model::{Alignment, Table},
    scroll::{self, Link, Rail},
    style::TableStyle,
    viewport::{self, RAIL_HEIGHT},
};
use crate::editor::{
    markdown::{
        platform::sessions::{Sessions, column_layout},
        shared::widgets::ring,
    },
    view::{
        style::TextStyle,
        widget::{BlockWidget, WidgetCx},
    },
};
use gpui::{prelude::*, *};
use std::{
    cell::Cell,
    hash::{Hash, Hasher},
    rc::Rc,
};

/// The sessions' feature id (`featureId: "markdown-table"`).
pub(super) const SESSION_FEATURE: &str = "markdown-table";

#[cfg(test)]
thread_local! {
    static LAST_TABLE_UI: std::cell::RefCell<Option<WeakEntity<TableUi>>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
pub(crate) fn last_table_ui_for_tests() -> Option<Entity<TableUi>> {
    LAST_TABLE_UI.with(|slot| slot.borrow().as_ref().and_then(WeakEntity::upgrade))
}

#[cfg(test)]
pub(crate) fn clear_last_table_ui_for_tests() {
    LAST_TABLE_UI.with(|slot| *slot.borrow_mut() = None);
}

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

/// `createMarkdownTableViewportKey`: the table's content, not its position.
pub(super) fn identity(table: &Table) -> u64 {
    let mut h = std::hash::DefaultHasher::new();
    table.alignments.hash(&mut h);
    for row in &table.rows {
        row.header.hash(&mut h);
        for cell in &row.cells {
            cell.text.hash(&mut h);
        }
    }
    h.finish()
}

/// The sessions this widget instance mounted: (session, mount) of its
/// inline viewport and of its column layout.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Mounted {
    viewport: (u64, u64),
    layout: (u64, u64),
}

pub struct TableWidget {
    pub(super) table: Table,
    pub(super) style: TableStyle,
    header: TextStyle,
    body: TextStyle,
    pub(super) dark: bool,
    sessions: Option<Sessions>,
    /// Where explicit column tracks persist (the document).
    namespace: Option<String>,
    identity: u64,
    mounted: Cell<Option<Mounted>>,
}

impl Drop for TableWidget {
    /// The widget went away: its sessions detach, unless a replacement
    /// already mounted them.
    fn drop(&mut self) {
        if let (Some(sessions), Some(m)) = (&self.sessions, self.mounted.get()) {
            if let Ok(mut store) = sessions.viewports.try_borrow_mut() {
                store.detach(m.viewport.0, m.viewport.1);
            }
            if let Ok(mut store) = sessions.layouts.try_borrow_mut() {
                store.detach(m.layout.0, m.layout.1);
            }
        }
    }
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
            sessions: None,
            namespace: None,
            identity: identity(table),
            mounted: Cell::new(None),
        }
    }

    /// The view's sessions, and the document explicit tracks persist under.
    pub fn with_sessions(mut self, sessions: Option<Sessions>, namespace: Option<String>) -> Self {
        self.sessions = sessions;
        self.namespace = namespace;
        self
    }

    /// Mount this instance's sessions once (`acquire`).
    fn mount(&self, automatic: &[f32], width: f32) -> Option<(Sessions, Mounted)> {
        let sessions = self.sessions.clone()?;
        if let Some(m) = self.mounted.get() {
            return Some((sessions, m));
        }
        let range = self.table.range.clone();
        let v =
            sessions
                .viewports
                .borrow_mut()
                .acquire(SESSION_FEATURE, range.clone(), self.identity);
        let l = sessions.layouts.borrow_mut().acquire(
            SESSION_FEATURE,
            automatic,
            Some(width),
            range,
            self.namespace.as_deref(),
            self.identity,
        );
        let m = Mounted {
            viewport: (v.id, v.mount),
            layout: (l.id, l.mount),
        };
        self.mounted.set(Some(m));
        Some((sessions, m))
    }

    /// The column tracks: the session's, with automatic ones laid out again
    /// only when the reading width changed (`reflowAutomaticWidths`).
    fn tracks(&self, sessions: &Sessions, m: Mounted, automatic: Vec<f32>, width: f32) -> Vec<f32> {
        let mut store = sessions.layouts.borrow_mut();
        let Some(session) = store.get(m.layout.0) else {
            return automatic;
        };
        let stale = session
            .auto_layout_width
            .is_none_or(|w| (w - width).abs() >= 1.);
        if !session.explicit && (stale || session.widths.len() != automatic.len()) {
            store.set_auto_widths(m.layout.0, m.layout.1, &automatic, width);
            return automatic;
        }
        let mut widths = session.widths;
        widths.resize(automatic.len(), column_layout::MIN_WIDTH);
        widths
    }

    /// The column the caret is in, when it is in a cell.
    fn caret_column(&self, caret: usize) -> Option<usize> {
        self.table.rows.iter().find_map(|row| {
            row.cells
                .iter()
                .position(|c| c.range.start <= caret && caret <= c.range.end)
        })
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
                let (element, text_height) = cx.render.inline_content_aligned(
                    cell.range.clone(),
                    style,
                    wrap,
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
        let (top, width, gutter) = (cx.top, cx.width, cx.left);
        let m = &self.style.clone();
        let inset = m.cell_padding.left + m.cell_padding.right + 1.;
        let automatic = layout::column_widths(&self.table, width, m.size, inset);
        let owner_view = cx.render.view.clone();
        let ui =
            cx.render
                .window
                .use_keyed_state(cx.id("md-table-ui"), cx.render.app, |window, cx| {
                    let notify_owner = cx.observe_self(move |_, cx| {
                        let _ = owner_view.update(cx, |_, cx| cx.notify());
                    });
                    let activation =
                        cx.observe_window_activation(window, |u: &mut TableUi, w, cx| {
                            if !w.is_window_active() {
                                u.cancel_active_gesture(cx);
                            }
                        });
                    let weak_ui = cx.weak_entity();
                    let own_window = window.window_handle();
                    let escape = cx.intercept_keystrokes(move |event, window, cx| {
                        if window.window_handle() != own_window || event.keystroke.key != "escape" {
                            return;
                        }
                        let _ = weak_ui.update(cx, |u, cx| {
                            if u.handle_escape(cx) {
                                cx.stop_propagation();
                            }
                        });
                    });
                    TableUi {
                        _subscriptions: vec![notify_owner, activation, escape],
                        ..TableUi::default()
                    }
                });
        #[cfg(test)]
        LAST_TABLE_UI.with(|slot| *slot.borrow_mut() = Some(ui.downgrade()));
        let mounted = self.mount(&automatic, width);
        let mut widths = match &mounted {
            Some((sessions, m)) => self.tracks(sessions, *m, automatic, width),
            None => automatic,
        };
        let state = ui.read(cx.render.app);
        if let (Some(resizing), Some(live)) = (state.gestures.resizing, state.live)
            && let Some(track) = widths.get_mut(resizing.column)
        {
            *track = live;
        }
        let table_width = 2. + widths.iter().sum::<f32>();
        // The scrollport reaches the editor's edges; the table starts at the
        // reading column and scrolls by its logical offset.
        let view_geometry = Rc::new(viewport::Geometry::new(
            widths.clone(),
            table_width,
            width,
            gutter,
        ));
        let link = mounted.as_ref().map(|(sessions, m)| Link {
            store: sessions.viewports.clone(),
            id: m.viewport.0,
            mount: m.viewport.1,
            geometry: view_geometry.clone(),
            view: cx.render.view.clone(),
        });
        // `revealColumn`: the caret's column comes into view as it moves.
        let caret = cx.state.selection.1;
        let caret_column = (cx.state.focus_within() && !cx.state.selected)
            .then(|| self.caret_column(caret))
            .flatten();
        if let Some(link) = &link {
            let revealed = state.revealed;
            if let Some(column) = caret_column
                && revealed != Some(caret)
            {
                link.scroll_to(viewport::reveal(link.offset(), column, &view_geometry));
            }
            let next = caret_column.map(|_| caret);
            if next != revealed {
                ui.update(cx.render.app, |u, _| u.revealed = next);
            }
        }
        let offset = link.as_ref().map_or(0., Link::offset);
        let x = -offset;
        let table_top = top + m.handle_gutter;
        let (cells, row_spans, table_height) =
            self.render_grid(&widths, table_width, table_top, cx);
        let selected = cx.state.selected.then_some(if cx.state.editor_focused {
            m.document_selection
        } else {
            m.document_selection_inactive
        });
        let frame_state = if selected.is_some() {
            "md-table-frame:selected"
        } else {
            "md-table-frame:resting"
        };
        let frame = div()
            .debug_selector(move || frame_state.into())
            .absolute()
            .left_0()
            .top_0()
            .w(px(table_width))
            .h(px(table_height))
            .rounded(px(m.radius))
            .border_1()
            .border_color(selected.unwrap_or(m.border));
        let table = div()
            .debug_selector(|| "md-table-surface".into())
            .absolute()
            .left(px(x))
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
                .left(px(x))
                .top(px(m.handle_gutter))
                .w(px(table_width))
                .h(px(table_height))
                .child(table.left_0().top_0())
                .child(ring::ring((table_width, table_height), m.radius, 1., color)),
            None => table,
        };
        let geometry = Geometry {
            table: Bounds {
                origin: point(x, m.handle_gutter),
                size: size(table_width, table_height),
            },
            rows: row_spans
                .iter()
                .map(|(t, h)| (m.handle_gutter + t, *h))
                .collect(),
            columns: column_spans(&widths)
                .into_iter()
                .map(|(left, w)| (left + x, w))
                .collect(),
        };
        let scrollport = m.handle_gutter + table_height + m.action_gutter;
        let overflows = view_geometry.overflows();
        let height = scrollport + if overflows { RAIL_HEIGHT } else { 0. } + m.wrap_bottom;
        let mut block = cx
            .render
            .block_box(top, cx.left, width, height)
            .group(GROUP)
            .child(table);
        let rail = link
            .as_ref()
            .filter(|_| overflows)
            .map(|link| Rail::new(link.clone()));
        if let (Some(link), Some(rail)) = (&link, &rail) {
            let area = Bounds {
                origin: point(-gutter, 0.),
                size: size(view_geometry.viewport, scrollport),
            };
            block = block
                .child(scroll::wheel(link.clone(), area))
                .child(scroll::rail(
                    cx.id("md-table-scrollbar"),
                    rail,
                    width,
                    scrollport,
                ));
        }
        ui.update(cx.render.app, |u, _| u.rail = rail);
        let element = if cx.state.read_only {
            block.into_any_element()
        } else {
            let (table_model, font) = (self.table.clone(), m.size);
            let natural = Rc::new(move |column| {
                layout::natural_width(&table_model, column, width, font, inset)
            });
            let layout_link = mounted.map(|(sessions, m)| LayoutLink {
                store: sessions.layouts,
                id: m.layout.0,
                mount: m.layout.1,
            });
            self.controls(
                block,
                geometry,
                ui,
                Rc::new(widths),
                natural,
                layout_link,
                cx,
            )
        };
        (element.into_any_element(), height)
    }
}
