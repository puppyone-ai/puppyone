//! `DatabaseViewer` (`viewers/database`): object tabs, Data / Schema, a paged
//! read-only grid with a record index column, and the product's failure
//! copy. Queries run on the background executor through
//! `platform::database`; the foreground only lays out the page.
use crate::{
    editor::registry::{SurfaceInput, SurfaceRequest, ViewerSurface},
    localization::{t, tf},
    platform::database::{Cell, Failure, Object, PAGE_COLUMNS, Page, Session},
    theme,
    ui::appearance::ActiveAppearance,
    workspace::{PreviewData, PreviewResource},
};
use gpui::{prelude::*, *};
use std::sync::{Arc, Mutex};

/// `database-preview` resourcePolicy.maxSourceBytes (8 GiB).
const BUDGET: u64 = 8 * 1024 * 1024 * 1024;

pub fn open(request: &SurfaceRequest, _: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let resource = match request.input {
        SurfaceInput::Resource(resource) => Some(resource.clone()),
        _ => None,
    };
    let view = cx.new(|cx| {
        let mut view = DatabaseView::new(resource);
        view.reload(cx);
        view
    });
    Box::new(DatabaseSurface { view })
}

struct DatabaseSurface {
    view: Entity<DatabaseView>,
}
impl ViewerSurface for DatabaseSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tab {
    Data,
    Schema,
}
pub struct DatabaseView {
    resource: Option<PreviewResource>,
    session: Option<Arc<Mutex<Session>>>,
    objects: Vec<Object>,
    selected: usize,
    tab: Tab,
    page: Option<Page>,
    failure: Option<Failure>,
    busy: bool,
    epoch: u64,
    scroll: ScrollHandle,
    /// The private copy of Cloud bytes; removed with the preview.
    _temporary: Option<tempfile::TempDir>,
}
/// `source.{ext}` keeps the engine's extension; the name never comes from
/// a path segment.
fn bytes_name(resource: &Option<PreviewResource>) -> String {
    let ext = resource
        .as_ref()
        .and_then(|r| {
            r.identity
                .path
                .as_path()
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
        })
        .filter(|e| e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| "db".into());
    format!("source.{ext}")
}
impl DatabaseView {
    fn new(resource: Option<PreviewResource>) -> Self {
        Self {
            resource,
            session: None,
            objects: vec![],
            selected: 0,
            tab: Tab::Data,
            page: None,
            failure: None,
            busy: true,
            epoch: 0,
            scroll: ScrollHandle::new(),
            _temporary: None,
        }
    }
    fn reload(&mut self, cx: &mut Context<Self>) {
        self.epoch += 1;
        self.busy = true;
        self.failure = None;
        self.page = None;
        let epoch = self.epoch;
        let path = match self.resource.as_ref().and_then(|r| r.data().ok()) {
            Some(PreviewData::LocalFile(path)) => path.clone(),
            // Cloud bytes (already checked for sidecars and a stable
            // revision by the provider) become a private, read-only
            // temporary copy that lives as long as this preview.
            Some(PreviewData::Bytes { bytes, .. }) => {
                match crate::platform::webview::private_copy(&bytes_name(&self.resource), bytes) {
                    Ok((dir, path)) => {
                        self._temporary = Some(dir);
                        path
                    }
                    Err(_) => {
                        self.fail(Failure::Unavailable, cx);
                        return;
                    }
                }
            }
            None => {
                self.fail(Failure::Unavailable, cx);
                return;
            }
        };
        let task = cx.background_executor().spawn(async move {
            let session = Session::open(&path, BUDGET)?;
            let objects = session.objects()?;
            Ok::<_, Failure>((session, objects))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |v, cx| {
                if v.epoch != epoch {
                    return;
                }
                match result {
                    Ok((session, objects)) => {
                        v.session = Some(Arc::new(Mutex::new(session)));
                        v.objects = objects;
                        v.selected = v.selected.min(v.objects.len().saturating_sub(1));
                        v.busy = false;
                        v.load_page(0, 0, cx);
                    }
                    Err(failure) => v.fail(failure, cx),
                }
            });
        })
        .detach();
        cx.notify();
    }
    fn fail(&mut self, failure: Failure, cx: &mut Context<Self>) {
        self.failure = Some(failure);
        self.busy = false;
        cx.notify();
    }
    fn load_page(&mut self, offset: usize, first_column: usize, cx: &mut Context<Self>) {
        let (Some(session), Some(object)) = (
            self.session.clone(),
            self.objects.get(self.selected).cloned(),
        ) else {
            cx.notify();
            return;
        };
        self.busy = true;
        let epoch = self.epoch;
        let task = cx
            .background_executor()
            .spawn(async move { session.lock().unwrap().page(&object, offset, first_column) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |v, cx| {
                if v.epoch != epoch {
                    return;
                }
                v.busy = false;
                match result {
                    Ok(page) => v.page = Some(page),
                    Err(failure) => v.failure = Some(failure),
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    fn select(&mut self, index: usize, cx: &mut Context<Self>) {
        self.selected = index;
        self.load_page(0, 0, cx);
    }
}

impl Render for DatabaseView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = cx.palette();
        let ty = theme::ty();
        let border = theme::alpha(p.divider, 0.76);
        let header_bg = theme::mix(p.control, p.canvas, 0.22);
        let index_bg = theme::mix(p.control, p.canvas, 0.16);
        if let Some(failure) = self.failure {
            return div()
                .size_full()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(8.))
                .p(px(24.))
                .bg(p.canvas)
                .text_size(px(ty.ui.meta))
                .text_color(p.danger)
                .child(t(failure.message_key()))
                .child(
                    div()
                        .id("database-reload")
                        .px(px(8.))
                        .py(px(2.))
                        .border_1()
                        .border_color(p.border_subtle)
                        .rounded(px(4.))
                        .bg(p.control)
                        .text_color(p.muted)
                        .cursor(theme::clickable_cursor())
                        .child(t("editor.database.reload"))
                        .on_click(cx.listener(|v, _, _, cx| v.reload(cx))),
                )
                .into_any_element();
        }
        let tab_button = |id: &'static str, label: &'static str, active: bool| {
            div()
                .id(id)
                .h(px(32.))
                .px(px(10.))
                .flex()
                .items_center()
                .text_size(px(ty.ui.meta))
                .text_color(if active { p.text } else { p.muted })
                .when(active, |d| d.border_b_2().border_color(p.accent))
                .cursor(theme::clickable_cursor())
                .child(t(label))
        };
        let mut objects = div()
            .id("database-objects")
            .flex()
            .flex_1()
            .min_w_0()
            .overflow_x_scroll();
        for (index, object) in self.objects.iter().enumerate() {
            let active = index == self.selected;
            objects = objects.child(
                div()
                    .id(("database-object", index))
                    .h(px(32.))
                    .max_w(px(190.))
                    .px(px(10.))
                    .flex()
                    .items_center()
                    .flex_none()
                    .text_size(px(ty.ui.meta))
                    .text_color(if active { p.text } else { p.muted })
                    .when(active, |d| d.border_b_2().border_color(p.accent))
                    .cursor(theme::clickable_cursor())
                    .child(div().truncate().child(object.name.clone()))
                    .on_click(cx.listener(move |v, _, _, cx| v.select(index, cx))),
            );
        }
        let toolbar = div()
            .flex()
            .flex_none()
            .items_center()
            .min_h(px(36.))
            .px(px(8.))
            .gap(px(8.))
            .border_b_1()
            .border_color(border)
            .child(objects)
            .child(
                tab_button(
                    "database-data",
                    "editor.database.data",
                    self.tab == Tab::Data,
                )
                .on_click(cx.listener(|v, _, _, cx| {
                    v.tab = Tab::Data;
                    cx.notify();
                })),
            )
            .child(
                tab_button(
                    "database-schema",
                    "editor.database.schema",
                    self.tab == Tab::Schema,
                )
                .on_click(cx.listener(|v, _, _, cx| {
                    v.tab = Tab::Schema;
                    cx.notify();
                })),
            )
            .child(
                tab_button("database-reload-action", "editor.database.reload", false)
                    .on_click(cx.listener(|v, _, _, cx| v.reload(cx))),
            );
        let cell = |text: SharedString, bg: Option<Rgba>, muted: bool| {
            div()
                .min_w(px(96.))
                .max_w(px(320.))
                .px(px(8.))
                .py(px(4.))
                .border_r_1()
                .border_b_1()
                .border_color(border)
                .when_some(bg, |d, bg| d.bg(bg))
                .text_color(if muted { p.subtle } else { p.text })
                .truncate()
                .child(text)
        };
        let mut grid = div().flex().flex_col().text_size(px(ty.ui.meta));
        let object = self.objects.get(self.selected);
        match (self.tab, object) {
            (_, None) if !self.busy => {
                grid = grid.child(
                    div()
                        .p(px(16.))
                        .text_color(p.subtle)
                        .child(t("editor.database.empty")),
                );
            }
            (Tab::Schema, Some(object)) => {
                grid = grid.child(
                    div()
                        .flex()
                        .child(cell(
                            t("editor.database.field").into(),
                            Some(header_bg),
                            false,
                        ))
                        .child(cell(
                            t("editor.database.type").into(),
                            Some(header_bg),
                            false,
                        )),
                );
                for column in &object.columns {
                    grid = grid.child(
                        div()
                            .flex()
                            .child(cell(column.name.clone().into(), None, false))
                            .child(cell(column.native_type.clone().into(), None, true)),
                    );
                }
            }
            (Tab::Data, Some(_)) => {
                if let Some(page) = &self.page {
                    let mut head = div()
                        .flex()
                        .child(cell("".into(), Some(header_bg), false).min_w(px(48.)));
                    for name in &page.columns {
                        head = head.child(cell(name.clone().into(), Some(header_bg), false));
                    }
                    grid = grid.child(head);
                    for (r, row) in page.rows.iter().enumerate() {
                        let mut line = div().flex().child(
                            cell(
                                (page.offset + r + 1).to_string().into(),
                                Some(index_bg),
                                true,
                            )
                            .min_w(px(48.)),
                        );
                        for value in row {
                            let (text, muted): (SharedString, bool) = match value {
                                Cell::Null => ("NULL".into(), true),
                                Cell::Text(t) | Cell::Number(t) => (t.clone().into(), false),
                                Cell::Blob(_) => (t("editor.database.complex").into(), true),
                                Cell::Truncated(t) => (format!("{t}…").into(), false),
                            };
                            line = line.child(cell(text, None, muted));
                        }
                        grid = grid.child(line);
                    }
                }
            }
            _ => {}
        }
        let footer = self
            .page
            .as_ref()
            .filter(|_| self.tab == Tab::Data)
            .map(|page| {
                let start = page.offset + usize::from(!page.rows.is_empty());
                let end = page.offset + page.rows.len();
                let (offset, first_column, more) = (page.offset, page.first_column, page.has_more);
                let columns = self
                    .objects
                    .get(self.selected)
                    .map_or(0, |o| o.columns.len());
                let pager = |id: &'static str, label: &'static str, enabled: bool| {
                    div()
                        .id(id)
                        .px(px(8.))
                        .py(px(2.))
                        .rounded(px(4.))
                        .text_color(if enabled { p.text } else { p.text_disabled })
                        .when(enabled, |d| {
                            d.hover(move |d| d.bg(p.hover))
                                .cursor(theme::clickable_cursor())
                        })
                        .child(t(label))
                };
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(8.))
                    .px(px(12.))
                    .h(px(32.))
                    .border_t_1()
                    .border_color(border)
                    .text_size(px(ty.ui.meta))
                    .text_color(p.subtle)
                    .child(tf(
                        "editor.database.rows",
                        &[
                            ("start", (start as i64).into()),
                            ("end", (end as i64).into()),
                        ],
                    ))
                    .child(div().flex_1())
                    .child(
                        pager("database-first", "editor.database.first", offset > 0).on_click(
                            cx.listener(move |v, _, _, cx| v.load_page(0, first_column, cx)),
                        ),
                    )
                    .child(
                        pager("database-next", "editor.database.next", more).on_click(cx.listener(
                            move |v, _, _, cx| {
                                if more {
                                    v.load_page(
                                        offset + crate::platform::database::PAGE_ROWS,
                                        first_column,
                                        cx,
                                    )
                                }
                            },
                        )),
                    )
                    .child(
                        pager(
                            "database-previous-columns",
                            "editor.database.previousColumns",
                            first_column > 0,
                        )
                        .on_click(cx.listener(move |v, _, _, cx| {
                            v.load_page(offset, first_column.saturating_sub(PAGE_COLUMNS), cx)
                        })),
                    )
                    .child(
                        pager(
                            "database-next-columns",
                            "editor.database.nextColumns",
                            first_column + PAGE_COLUMNS < columns,
                        )
                        .on_click(cx.listener(move |v, _, _, cx| {
                            if first_column + PAGE_COLUMNS < columns {
                                v.load_page(offset, first_column + PAGE_COLUMNS, cx)
                            }
                        })),
                    )
            });
        div()
            .id("database-preview")
            .size_full()
            .flex()
            .flex_col()
            .bg(p.canvas)
            .child(toolbar)
            .child(
                div()
                    .id("database-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_scroll()
                    .track_scroll(&self.scroll)
                    .child(grid),
            )
            .children(footer)
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[gpui::test]
    fn a_sqlite_file_lists_tables_and_pages_rows(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.sqlite");
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch("CREATE TABLE t(a, b); INSERT INTO t VALUES (1, 'x'), (2, NULL);")
            .unwrap();
        drop(c);
        let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(std::path::Path::new("app.sqlite")).unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = DatabaseView::new(Some(resource));
            view.reload(cx);
            view
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while view.read_with(cx, |v, _| v.page.is_none() && v.failure.is_none()) {
            cx.run_until_parked();
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        view.read_with(cx, |v, _| {
            assert_eq!(v.objects.len(), 1);
            let page = v.page.as_ref().unwrap();
            assert_eq!(page.rows.len(), 2);
            assert_eq!(page.rows[1][1], Cell::Null);
        });
    }
}
