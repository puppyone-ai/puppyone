//! `DatabaseViewer` (`viewers/database` with `database-preview.css`): object
//! tabs, Data / Schema, a paged read-only grid with a sticky header and record
//! index, the floating pager and the product's failure copy. Queries run on
//! the background executor through `platform::database`; the foreground only
//! lays out the page.
//!
//! `createDatabasePreviewReader`'s lifecycle: a session sleeps after a minute
//! without reads and is reopened after five; a Next page that lands on a new
//! session starts over from the first page and says so.
use crate::{
    editor::{
        registry::{SurfaceInput, SurfaceRequest, ViewerSurface},
        tokens::Tokens,
    },
    localization::t,
    platform::database::{
        CellKind, Failure, IDLE, MAX_SOURCE_BYTES, Object, PAGE_COLUMNS, Page, Session,
    },
    theme,
    typography::Scale,
    ui::{appearance::ActiveAppearance, components::Icon, loading::LoadingMark},
    workspace::{PreviewData, PreviewResource},
};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

/// `.database-preview__frame` padding.
const FRAME: (f32, f32, f32) = (28., 32., 76.);
/// `.database-preview__record-index`.
const INDEX_WIDTH: f32 = 34.;
const CELL_MIN: f32 = 112.;
const CELL_MAX: f32 = 360.;
const CELL_PAD_X: f32 = 10.;
const ROW_MIN: f32 = 32.;

pub fn open(request: &SurfaceRequest, _: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let resource = match request.input {
        SurfaceInput::Resource(resource) => Some(resource.clone()),
        _ => None,
    };
    let (dark, scale) = (request.dark, request.scale);
    let view = cx.new(|cx| {
        let mut view = DatabaseView::new(resource, dark, scale);
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
    /// A new revision of the file reads it again.
    fn rebind_resource(&self, resource: &PreviewResource, cx: &mut App) {
        let resource = resource.clone();
        self.view.update(cx, |view, cx| {
            view.resource = Some(resource);
            view.reload(cx);
        });
    }
    fn apply(&self, _: bool, dark: bool, scale: Scale, _: &mut Window, cx: &mut App) {
        self.view.update(cx, |view, cx| {
            view.dark = dark;
            view.scale = scale;
            cx.notify();
        });
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tab {
    Data,
    Schema,
}
type Shared = Arc<Mutex<Session>>;

pub struct DatabaseView {
    resource: Option<PreviewResource>,
    dark: bool,
    scale: Scale,
    /// The file the sessions open (a private copy for Cloud bytes).
    source: Option<PathBuf>,
    session: Option<Shared>,
    /// `info`: listed once the database opened.
    objects: Option<Vec<Object>>,
    selected: Option<usize>,
    /// `writeViewState("database")`: the object and column window to
    /// return to when the file is read again.
    remembered: (String, usize),
    tab: Tab,
    page: Option<Page>,
    failure: Option<Failure>,
    busy: bool,
    restarted: bool,
    epoch: u64,
    scroll: ScrollHandle,
    idle: Option<Task<()>>,
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
/// What a background read brings back.
struct Read {
    session: Shared,
    objects: Vec<Object>,
    selected: usize,
    page: Page,
    continued: bool,
}
impl DatabaseView {
    fn new(resource: Option<PreviewResource>, dark: bool, scale: Scale) -> Self {
        Self {
            resource,
            dark,
            scale,
            source: None,
            session: None,
            objects: None,
            selected: None,
            remembered: (String::new(), 0),
            tab: Tab::Data,
            page: None,
            failure: None,
            busy: true,
            restarted: false,
            epoch: 0,
            scroll: ScrollHandle::new(),
            idle: None,
            _temporary: None,
        }
    }
    /// The surface's effect: open the file and read the remembered object.
    fn reload(&mut self, cx: &mut Context<Self>) {
        self.epoch += 1;
        self.busy = true;
        self.failure = None;
        self.objects = None;
        self.page = None;
        self.restarted = false;
        self.session = None;
        self.idle = None;
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
                    Err(_) => return self.fail(Failure::Unavailable, cx),
                }
            }
            None => return self.fail(Failure::Unavailable, cx),
        };
        self.source = Some(path.clone());
        let remembered = self.remembered.clone();
        let task = cx.background_executor().spawn(async move {
            let session = Session::open(&path, MAX_SOURCE_BYTES)?;
            let objects = session.objects().to_vec();
            let readable = |o: &Object| o.unreadable.is_none();
            let Some(selected) = objects
                .iter()
                .position(|o| o.name == remembered.0 && readable(o))
                .or_else(|| objects.iter().position(readable))
            else {
                return Ok((Arc::new(Mutex::new(session)), objects, None));
            };
            let mut page = session.page(selected, 0, 0)?;
            let offset = if objects[selected].name == remembered.0 {
                remembered.1
            } else {
                0
            };
            if offset > 0 && offset < page.columns.len() {
                page = session.page(selected, 0, offset)?;
            }
            Ok::<_, Failure>((
                Arc::new(Mutex::new(session)),
                objects,
                Some((selected, page)),
            ))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |v, cx| {
                if v.epoch != epoch {
                    return;
                }
                v.busy = false;
                match result {
                    Ok((session, objects, read)) => {
                        v.objects = Some(objects);
                        if let Some((selected, page)) = read {
                            v.selected = Some(selected);
                            v.remember(selected, page.column_offset);
                            v.page = Some(page);
                        }
                        v.arm(session, cx);
                    }
                    Err(failure) => v.failure = Some(failure),
                }
                cx.notify();
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
    fn remember(&mut self, selected: usize, column_offset: usize) {
        if let Some(object) = self.objects.as_ref().and_then(|o| o.get(selected)) {
            self.remembered = (object.name.clone(), column_offset);
        }
    }
    /// Keep the session until it has been idle for a minute.
    fn arm(&mut self, session: Shared, cx: &mut Context<Self>) {
        self.session = Some(session.clone());
        self.idle = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(IDLE).await;
            let _ = this.update(cx, |v, _| {
                if v.session.as_ref().is_some_and(|s| Arc::ptr_eq(s, &session)) {
                    v.session = None;
                }
            });
        }));
    }
    /// `read(objectId, offset, next)`.
    fn read(&mut self, object: usize, column_offset: usize, next: bool, cx: &mut Context<Self>) {
        let Some(name) = self
            .objects
            .as_ref()
            .and_then(|o| o.get(object))
            .filter(|o| o.unreadable.is_none())
            .map(|o| o.name.clone())
        else {
            return;
        };
        let Some(source) = self.source.clone() else {
            return;
        };
        if self.busy {
            return;
        }
        self.busy = true;
        self.failure = None;
        self.restarted = false;
        self.idle = None;
        let epoch = self.epoch;
        let session = self.session.take();
        let cursor = self
            .page
            .as_ref()
            .filter(|_| next)
            .map(|p| (p.epoch, p.offset + p.rows.len()));
        let task = cx.background_executor().spawn(async move {
            let session = match session.filter(|s| !s.lock().unwrap().ended()) {
                Some(session) => session,
                None => Arc::new(Mutex::new(Session::open(&source, MAX_SOURCE_BYTES)?)),
            };
            let (objects, selected, page, continued) = {
                let current = session.lock().unwrap();
                let objects = current.objects().to_vec();
                let selected = objects
                    .iter()
                    .position(|o| o.name == name && o.unreadable.is_none())
                    .ok_or(Failure::Unsupported)?;
                // A cursor never continues on another snapshot.
                let (continued, offset) = match cursor {
                    Some((epoch, offset)) if epoch == current.epoch => (true, offset),
                    _ => (false, 0),
                };
                let page = current.page(selected, offset, column_offset)?;
                (objects, selected, page, continued)
            };
            Ok::<_, Failure>(Read {
                session,
                objects,
                selected,
                page,
                continued,
            })
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |v, cx| {
                if v.epoch != epoch {
                    return;
                }
                v.busy = false;
                match result {
                    Ok(read) => {
                        v.objects = Some(read.objects);
                        v.selected = Some(read.selected);
                        v.remember(read.selected, read.page.column_offset);
                        v.restarted = next && !read.continued;
                        v.page = Some(read.page);
                        v.arm(read.session, cx);
                    }
                    Err(failure) => {
                        v.page = None;
                        v.failure = Some(failure);
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    /// `openExternalFile(document.path)`: local files only.
    fn local_path(&self) -> Option<PathBuf> {
        match self.resource.as_ref()?.data().ok()? {
            PreviewData::LocalFile(path) => Some(path.clone()),
            PreviewData::Bytes { .. } => None,
        }
    }
    fn open_external(&mut self, cx: &mut Context<Self>) {
        if let Some(path) = self.local_path()
            && crate::platform::desktop::open(&path).is_err()
        {
            self.fail(Failure::Unavailable, cx);
        }
    }
}

/// The page's column widths: each column's widest value within the cell
/// bounds, widened together to the table's `min(100%, 680px)`.
fn column_widths(page: &Page, schema: bool, available: f32, window: &mut Window) -> Vec<f32> {
    let style = window.text_style();
    let ty = theme::ty();
    let measure = |text: &str, size: f32, weight: FontWeight, window: &mut Window| {
        let line = text.lines().next().unwrap_or_default();
        if line.is_empty() {
            return 0.;
        }
        let run = TextRun {
            len: line.len(),
            font: Font {
                weight,
                ..style.font()
            },
            color: Hsla::default(),
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        f32::from(
            window
                .text_system()
                .shape_line(line.to_owned().into(), px(size), &[run], None)
                .width,
        )
    };
    let data = ty.editor.data;
    let caption = ty.ui.caption;
    let fit = |w: f32| (w + CELL_PAD_X * 2. + 1.).clamp(CELL_MIN, CELL_MAX);
    let mut widths: Vec<f32> = if schema {
        let field = page.visible.iter().fold(
            measure(t("editor.database.field"), data, FontWeight(620.), window),
            |w, c| w.max(measure(&c.name, data, FontWeight(550.), window)),
        );
        let kind = page.visible.iter().fold(
            measure(t("editor.database.type"), data, FontWeight(620.), window),
            |w, c| {
                let badge = measure(&c.native_type, ty.ui.micro, FontWeight::NORMAL, window) + 12.;
                w.max(badge + if c.primary_key { 5. + 26. } else { 0. })
            },
        );
        vec![fit(field), fit(kind)]
    } else {
        page.visible
            .iter()
            .enumerate()
            .map(|(c, column)| {
                let mut width = measure(&column.name, data, FontWeight(620.), window);
                for row in &page.rows {
                    let Some(cell) = row.get(c) else { continue };
                    let (text, size) = cell_text(cell);
                    let size = if size { caption } else { data };
                    width = width.max(measure(&text, size, FontWeight::NORMAL, window));
                }
                fit(width)
            })
            .collect()
    };
    let index = if schema { 0. } else { INDEX_WIDTH };
    let minimum = available.min(680.) - 2.;
    let total: f32 = widths.iter().sum::<f32>() + index;
    if total < minimum && !widths.is_empty() {
        let extra = (minimum - total) / widths.len() as f32;
        widths.iter_mut().for_each(|w| *w += extra);
    }
    widths
}
/// A cell's text and whether it shows at caption size.
fn cell_text(cell: &crate::platform::database::Cell) -> (String, bool) {
    match cell.kind {
        // SQL token; distinct from an empty string.
        CellKind::Null => ("NULL".into(), true),
        CellKind::Blob => (format!("BLOB · {} B", cell.bytes), true),
        _ if cell.truncated => (format!("{}…", cell.text), false),
        _ => (cell.text.clone(), false),
    }
}

/// `DatabaseIconButton`: 28px, its 14px glyph, a tooltip.
fn icon_button(
    id: impl Into<ElementId>,
    icon: &'static str,
    label: &'static str,
    active: bool,
    disabled: bool,
    p: theme::Theme,
) -> Stateful<Div> {
    let hover = theme::alpha(p.hover, 0.56);
    div()
        .id(id)
        .size(px(28.))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(6.))
        .text_color(if active { p.text } else { p.muted })
        .when(active, |d| d.bg(hover))
        .when(disabled, |d| d.opacity(0.3))
        .when(!disabled, |d| {
            d.cursor(theme::clickable_cursor())
                .hover(move |s| s.bg(hover).text_color(p.text))
        })
        .tooltip(crate::ui::components::tooltip(t(label)))
        .child(Icon::new(icon).with_size(px(14.)))
}
fn separator(p: theme::Theme) -> Div {
    div()
        .w(px(1.))
        .h(px(15.))
        .flex_none()
        .mx(px(3.))
        .bg(theme::alpha(p.divider, 0.78))
}

impl DatabaseView {
    /// `.database-preview__failure` / `__empty`.
    fn notice(&self, icon: &'static str, size: f32, text: &'static str, p: theme::Theme) -> Div {
        let ty = theme::ty();
        div()
            .m_auto()
            .max_w(px(420.))
            .p(px(30.))
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(11.))
            .text_size(px(ty.ui.hint))
            .line_height(relative(1.55))
            .text_color(p.muted)
            .text_center()
            .child(
                Icon::new(icon)
                    .stroke(1.5)
                    .with_size(px(size))
                    .color(p.text_disabled),
            )
            .child(t(text))
    }
    fn render_toolbar(&self, objects: &[Object], cx: &mut Context<Self>) -> Div {
        let p = cx.palette();
        let editor_bg = Tokens::get(self.dark, self.scale).color("--po-editor-bg");
        let ty = theme::ty();
        let mut tabs = div()
            .id("database-objects")
            .flex()
            .flex_1()
            .min_w_0()
            .self_stretch()
            .items_stretch()
            .overflow_x_scroll();
        let count = objects.len();
        for (index, object) in objects.iter().enumerate() {
            let selected = self.selected == Some(index);
            let unreadable = object.unreadable;
            let inaccessible = self.busy || unreadable.is_some();
            // The divider hides beside the selected or hovered tab and
            // after the last one.
            let next_selected = self.selected == Some(index + 1);
            let divider = !selected && !next_selected && index + 1 < count;
            let label: SharedString = match unreadable {
                Some(reason) => format!("{} · {}", object.name, t(reason.message_key())).into(),
                None => object.name.clone().into(),
            };
            let hover = theme::alpha(p.hover, 0.42);
            tabs = tabs.child(
                div()
                    .id(("database-object", index))
                    .group(SharedString::from(format!("database-object-{index}")))
                    .relative()
                    .h(px(32.))
                    .max_w(px(190.))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .px(px(12.))
                    .rounded_t(px(8.))
                    .text_size(px(ty.ui.caption))
                    .text_color(if selected { p.text } else { p.muted })
                    .when(selected, |d| {
                        d.bg(editor_bg).font_weight(FontWeight::MEDIUM)
                    })
                    .when(!selected && unreadable.is_some(), |d| d.opacity(0.38))
                    .when(!selected && !inaccessible, |d| {
                        d.cursor(theme::clickable_cursor())
                            .hover(move |s| s.bg(hover).text_color(p.text))
                    })
                    .when(unreadable.is_some(), |d| {
                        d.tooltip(crate::ui::components::tooltip(label.clone()))
                    })
                    .child(Icon::new("table-2").with_size(px(13.)).opacity(0.72))
                    .child(div().min_w_0().truncate().child(object.name.clone()))
                    .when(divider, |d| {
                        d.child(
                            div()
                                .absolute()
                                .top(px(9.))
                                .bottom(px(9.))
                                .right_0()
                                .w(px(1.))
                                .bg(theme::alpha(p.divider, 0.8))
                                .group_hover(
                                    SharedString::from(format!("database-object-{index}")),
                                    |s| s.opacity(0.),
                                ),
                        )
                    })
                    .on_click(cx.listener(move |v, _, _, cx| {
                        if !inaccessible {
                            let offset = 0;
                            v.read(index, offset, false, cx);
                        }
                    })),
            );
        }
        let external = self.local_path().is_some();
        let actions = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(2.))
            .ml(px(8.))
            .mb(px(4.))
            .when(self.busy, |d| {
                d.child(
                    div()
                        .size(px(24.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(p.muted)
                        .child(
                            svg()
                                .path("icons/loader-circle.svg")
                                .size(px(13.))
                                .text_color(p.muted)
                                .with_animation(
                                    "database-busy",
                                    Animation::new(std::time::Duration::from_millis(800)).repeat(),
                                    |svg, delta| {
                                        svg.with_transformation(Transformation::rotate(percentage(
                                            delta,
                                        )))
                                    },
                                ),
                        ),
                )
            })
            .child(
                icon_button(
                    "database-data",
                    "rows-3",
                    "editor.database.data",
                    self.tab == Tab::Data,
                    false,
                    p,
                )
                .on_click(cx.listener(|v, _, _, cx| {
                    v.tab = Tab::Data;
                    cx.notify();
                })),
            )
            .child(
                icon_button(
                    "database-schema",
                    "columns-3",
                    "editor.database.schema",
                    self.tab == Tab::Schema,
                    false,
                    p,
                )
                .on_click(cx.listener(|v, _, _, cx| {
                    v.tab = Tab::Schema;
                    cx.notify();
                })),
            )
            .child(separator(p))
            .child(
                icon_button(
                    "database-reload",
                    "refresh-cw",
                    "editor.database.reload",
                    false,
                    false,
                    p,
                )
                .on_click(cx.listener(|v, _, _, cx| v.reload(cx))),
            )
            .when(external, |d| {
                d.child(
                    icon_button(
                        "database-external",
                        "external-link",
                        "editor.openDefaultApp",
                        false,
                        false,
                        p,
                    )
                    .on_click(cx.listener(|v, _, _, cx| v.open_external(cx))),
                )
            });
        div()
            .flex()
            .flex_none()
            .items_center()
            .min_w_0()
            .min_h(px(36.))
            .pt(px(4.))
            .px(px(7.))
            .bg(theme::mix(p.control, editor_bg, 0.55))
            .border_b_1()
            .border_color(theme::alpha(p.divider, 0.64))
            // `.database-preview__engine` (hidden below 720px).
            .child(
                div()
                    .size(px(28.))
                    .flex_none()
                    .mb(px(4.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(p.muted)
                    .child(Icon::new("database").with_size(px(15.))),
            )
            .child(tabs)
            .child(actions)
    }
    fn render_grid(&self, page: &Page, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = cx.palette();
        let ty = theme::ty();
        let editor_bg = Tokens::get(self.dark, self.scale).color("--po-editor-bg");
        let border = theme::alpha(p.divider, 0.76);
        let header_bg = theme::mix(p.control, editor_bg, 0.22);
        let index_bg = theme::mix(p.control, editor_bg, 0.16);
        let schema = self.tab == Tab::Schema;
        let viewport = self.scroll.bounds().size.width;
        let available = (f32::from(viewport) - FRAME.1 * 2.).max(0.);
        let widths = column_widths(page, schema, available, window);
        // `position: sticky`: how far the header and the record index have
        // been carried with the scroll.
        let offset = self.scroll.offset();
        let carried_y = (-f32::from(offset.y) - FRAME.0 - 1.).max(0.);
        let carried_x = (-f32::from(offset.x) - FRAME.1 - 1.).max(0.);
        let text = theme::mix(p.text, p.muted, 0.78);
        let head_text = theme::mix(p.text, p.muted, 0.88);
        let columns = widths.len();
        let cell = |width: f32, last: bool| {
            div()
                .w(px(width))
                .flex_none()
                .min_h(px(ROW_MIN))
                .px(px(CELL_PAD_X))
                .py(px(6.))
                .border_b_1()
                .when(!last, |d| d.border_r_1())
                .border_color(border)
                .whitespace_normal()
        };
        let index_cell = |label: Option<String>, bg: Rgba| {
            div()
                .absolute()
                .top_0()
                .bottom_0()
                .left(px(carried_x))
                .w(px(INDEX_WIDTH))
                .px(px(4.))
                .flex()
                .items_center()
                .justify_center()
                .border_r_1()
                .border_b_1()
                .border_color(border)
                .bg(editor_bg)
                .child(div().absolute().inset_0().bg(bg))
                .text_size(px(ty.ui.caption))
                .text_color(p.text_disabled)
                .children(label.map(|l| div().relative().child(l)))
        };
        let header = |visible: bool| {
            let mut row = div().flex().relative().bg(editor_bg);
            if !schema {
                row = row.child(div().w(px(INDEX_WIDTH)).flex_none());
            }
            let names: Vec<SharedString> = if schema {
                vec![
                    t("editor.database.field").into(),
                    t("editor.database.type").into(),
                ]
            } else {
                page.visible.iter().map(|c| c.name.clone().into()).collect()
            };
            for (c, name) in names.into_iter().enumerate() {
                row = row.child(
                    cell(widths[c], c + 1 == columns)
                        .bg(header_bg)
                        .text_color(head_text)
                        .font_weight(FontWeight(620.))
                        .child(name),
                );
            }
            if !schema {
                row = row.child(index_cell(None, index_bg));
            }
            row.when(!visible, |d| d.invisible())
        };
        let mut table = div()
            .relative()
            .flex()
            .flex_col()
            .border_1()
            .border_color(border)
            .text_size(px(ty.editor.data))
            .line_height(relative(1.45))
            .text_color(text)
            .child(header(false));
        if schema {
            let count = page.visible.len();
            for (r, column) in page.visible.iter().enumerate() {
                let last_row = r + 1 == count;
                let badge = |label: String, key: bool| {
                    div()
                        .min_h(px(18.))
                        .px(px(6.))
                        .flex()
                        .items_center()
                        .rounded_full()
                        .text_size(px(ty.ui.micro))
                        .line_height(px(18.))
                        .when(!key, |d| {
                            d.bg(theme::alpha(p.control, 0.54))
                                .text_color(p.muted)
                                .font_family(theme::MONO)
                        })
                        .when(key, |d| {
                            d.ml(px(5.))
                                .bg(theme::alpha(p.accent, 0.12))
                                .text_color(theme::mix(p.accent, p.text, 0.72))
                                .font_weight(FontWeight(650.))
                        })
                        .child(label)
                };
                table = table.child(
                    div()
                        .id(("database-schema-row", r))
                        .flex()
                        .child(
                            cell(widths[0], false)
                                .when(last_row, |d| d.border_b_0())
                                .text_color(p.text)
                                .font_weight(FontWeight(550.))
                                .child(column.name.clone()),
                        )
                        .child(
                            cell(widths[1], true)
                                .when(last_row, |d| d.border_b_0())
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .child(badge(column.native_type.clone(), false))
                                        // Stable database schema token.
                                        .when(column.primary_key, |d| {
                                            d.child(badge("PK".into(), true))
                                        }),
                                ),
                        ),
                );
            }
        } else {
            let count = page.rows.len();
            let hover = theme::alpha(p.hover, 0.44);
            for (r, row) in page.rows.iter().enumerate() {
                let last_row = r + 1 == count;
                let mut line = div()
                    .flex()
                    .relative()
                    .child(div().w(px(INDEX_WIDTH)).flex_none());
                for (c, value) in row.iter().enumerate().take(columns) {
                    let (label, small) = cell_text(value);
                    line = line.child(
                        cell(widths[c], c + 1 == columns)
                            .id(("database-cell", r * PAGE_COLUMNS + c))
                            .when(last_row, |d| d.border_b_0())
                            .hover(move |s| s.bg(hover))
                            .when(small, |d| d.text_size(px(ty.ui.caption)))
                            .when(value.kind == CellKind::Null, |d| {
                                d.text_color(p.text_disabled)
                            })
                            .when(value.kind == CellKind::Blob, |d| d.text_color(p.muted))
                            .child(label),
                    );
                }
                line = line.child(
                    index_cell(Some((page.offset + r + 1).to_string()), index_bg)
                        .when(last_row, |d| d.border_b_0()),
                );
                table = table.child(line);
            }
        }
        // The sticky header, painted over the rows it scrolls past.
        table = table.child(
            div()
                .absolute()
                .left_0()
                .top(px(carried_y))
                .child(header(true)),
        );
        div()
            .id("database-scroll")
            .flex_1()
            .min_h_0()
            .overflow_scroll()
            .track_scroll(&self.scroll)
            .on_scroll_wheel(cx.listener(|_, _, _, cx| cx.notify()))
            .child(
                div()
                    .min_w_full()
                    .min_h_full()
                    .pt(px(FRAME.0))
                    .px(px(FRAME.1))
                    .pb(px(FRAME.2))
                    .flex()
                    .items_start()
                    .child(table),
            )
            .child(crate::ui::scrollbar::both(
                "database-scrollbar",
                &self.scroll,
            ))
            .into_any_element()
    }
    /// `.database-preview__pager`.
    fn render_pager(&self, page: &Page, columns_per_page: usize, cx: &mut Context<Self>) -> Div {
        let p = cx.palette();
        let ty = theme::ty();
        let Some(selected) = self.selected else {
            return div();
        };
        let busy = self.busy;
        let offset = page.column_offset;
        let column_pages = page.columns.len() > columns_per_page;
        let range = if page.rows.is_empty() {
            "0".to_owned()
        } else {
            format!("{}–{}", page.offset + 1, page.offset + page.rows.len())
        };
        let border = theme::alpha(theme::mix(p.divider, p.muted, 82. / 90.), 0.9);
        div()
            .absolute()
            .right(px(18.))
            .bottom(px(16.))
            .h(px(34.))
            .flex()
            .items_center()
            .gap(px(1.))
            .pt(px(2.))
            .pb(px(2.))
            .pr(px(3.))
            .pl(px(10.))
            .border_1()
            .border_color(border)
            .rounded(px(9.))
            .bg(theme::alpha(p.panel, 0.91))
            .shadow(vec![BoxShadow {
                color: theme::alpha(p.shadow, 0.18).into(),
                offset: point(px(0.), px(4.)),
                blur_radius: px(18.),
                spread_radius: px(0.),
                inset: false,
            }])
            .text_size(px(ty.ui.caption))
            .when(self.restarted, |d| {
                d.child(
                    div()
                        .min_w_0()
                        .max_w(px(180.))
                        .mr(px(8.))
                        .truncate()
                        .text_color(p.muted)
                        .line_height(relative(1.2))
                        .child(t("editor.database.restarted")),
                )
            })
            .child(
                div()
                    .min_w(px(42.))
                    .mr(px(2.))
                    .text_center()
                    .text_color(p.muted)
                    .child(range),
            )
            .child(
                icon_button(
                    "database-first",
                    "chevrons-left",
                    "editor.database.first",
                    false,
                    busy || page.offset == 0,
                    p,
                )
                .on_click(cx.listener(move |v, _, _, cx| {
                    if v.page.as_ref().is_some_and(|p| p.offset > 0) {
                        v.read(selected, offset, false, cx)
                    }
                })),
            )
            .child(
                icon_button(
                    "database-next",
                    "chevron-right",
                    "editor.database.next",
                    false,
                    busy || !page.has_more,
                    p,
                )
                .on_click(cx.listener(move |v, _, _, cx| {
                    if v.page.as_ref().is_some_and(|p| p.has_more) {
                        v.read(selected, offset, true, cx)
                    }
                })),
            )
            .when(column_pages, |d| {
                let total = page.columns.len();
                d.child(separator(p))
                    .child(
                        Icon::new("columns-3")
                            .with_size(px(13.))
                            .color(p.text_disabled),
                    )
                    .child(
                        icon_button(
                            "database-previous-columns",
                            "chevron-left",
                            "editor.database.previousColumns",
                            false,
                            busy || offset == 0,
                            p,
                        )
                        .on_click(cx.listener(move |v, _, _, cx| {
                            if offset > 0 {
                                v.read(selected, offset.saturating_sub(columns_per_page), false, cx)
                            }
                        })),
                    )
                    .child(
                        icon_button(
                            "database-next-columns",
                            "chevron-right",
                            "editor.database.nextColumns",
                            false,
                            busy || offset + columns_per_page >= total,
                            p,
                        )
                        .on_click(cx.listener(move |v, _, _, cx| {
                            if offset + columns_per_page < total {
                                v.read(selected, offset + columns_per_page, false, cx)
                            }
                        })),
                    )
            })
    }
}

impl Render for DatabaseView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = cx.palette();
        let editor_bg = Tokens::get(self.dark, self.scale).color("--po-editor-bg");
        let root = div()
            .id("database-preview")
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(editor_bg)
            .text_color(p.text);
        if let Some(failure) = self.failure {
            let external = self.local_path().is_some();
            return root
                .child(
                    self.notice("database", 22., failure.message_key(), p)
                        .child(
                            div()
                                .flex()
                                .gap(px(3.))
                                .child(
                                    icon_button(
                                        "database-failure-reload",
                                        "refresh-cw",
                                        "editor.database.reload",
                                        false,
                                        false,
                                        p,
                                    )
                                    .on_click(cx.listener(|v, _, _, cx| v.reload(cx))),
                                )
                                .when(external, |d| {
                                    d.child(
                                        icon_button(
                                            "database-failure-external",
                                            "external-link",
                                            "editor.openDefaultApp",
                                            false,
                                            false,
                                            p,
                                        )
                                        .on_click(cx.listener(|v, _, _, cx| v.open_external(cx))),
                                    )
                                }),
                        ),
                )
                .into_any_element();
        }
        let Some(objects) = self.objects.clone() else {
            // `DocumentSurfacePending`.
            return root
                .items_center()
                .justify_center()
                .gap(px(8.))
                .text_size(px(theme::ty().ui.meta))
                .text_color(p.subtle)
                .child(LoadingMark::new("database-pending"))
                .child(t("editor.loadingFile"))
                .into_any_element();
        };
        let toolbar = self.render_toolbar(&objects, cx);
        let root = root.child(toolbar);
        match self.page.clone() {
            Some(page) => {
                let grid = self.render_grid(&page, window, cx);
                let pager = self.render_pager(&page, PAGE_COLUMNS, cx);
                root.child(grid).child(pager).into_any_element()
            }
            None => root
                .child(self.notice("table-2", 20., "editor.database.empty", p))
                .into_any_element(),
        }
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
            let mut view = DatabaseView::new(Some(resource), false, Scale::default());
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
            assert_eq!(v.objects.as_ref().unwrap().len(), 1);
            let page = v.page.as_ref().unwrap();
            assert_eq!(page.rows.len(), 2);
            assert_eq!(page.rows[1][1].kind, CellKind::Null);
            assert_eq!(cell_text(&page.rows[1][1]), ("NULL".into(), true));
        });
    }

    #[gpui::test]
    fn next_pages_continue_on_their_snapshot_and_restart_on_a_new_one(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rows.db");
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch("CREATE VIEW v AS SELECT 1; CREATE TABLE t(a INTEGER PRIMARY KEY, b);")
            .unwrap();
        for i in 0..120 {
            c.execute("INSERT INTO t(b) VALUES (?1)", [i]).unwrap();
        }
        drop(c);
        let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(std::path::Path::new("rows.db")).unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = DatabaseView::new(Some(resource), false, Scale::default());
            view.reload(cx);
            view
        });
        let settle = |cx: &mut VisualTestContext| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while view.read_with(cx, |v, _| v.busy) {
                cx.run_until_parked();
                assert!(std::time::Instant::now() < deadline);
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        };
        settle(cx);
        let table = view.read_with(cx, |v, _| {
            let objects = v.objects.as_ref().unwrap();
            assert_eq!(objects.len(), 2);
            // The view stays listed but cannot be read; the table opens.
            assert!(
                objects
                    .iter()
                    .any(|o| o.name == "v" && o.unreadable.is_some())
            );
            v.selected.unwrap()
        });
        view.update(cx, |v, cx| v.read(table, 0, true, cx));
        settle(cx);
        view.read_with(cx, |v, _| {
            let page = v.page.as_ref().unwrap();
            assert_eq!((page.offset, page.rows.len()), (50, 50));
            assert!(!v.restarted);
        });
        // The session slept: the next page starts over and says so.
        view.update(cx, |v, cx| {
            v.session = None;
            v.read(table, 0, true, cx);
        });
        settle(cx);
        view.update(cx, |v, cx| {
            assert_eq!(v.page.as_ref().unwrap().offset, 0);
            assert!(v.restarted);
            v.tab = Tab::Schema;
            cx.notify();
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
    }
}
