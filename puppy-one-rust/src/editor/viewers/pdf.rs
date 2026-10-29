//! `PdfViewer` (`viewers/pdf/PdfViewer.tsx`): the product embeds Chromium's
//! PDF viewer with `toolbar=0&navpanes=0`; natively the same engine
//! (PDFium, `platform::pdf`) renders pages that this surface lays out.
//!
//! Chrome (pending, failure and Retry, the pane's Reload) follows the
//! product; page content is the engine's (close, not a pixel contract).
//! Pages fit the width when wider than the pane, otherwise show at 100%
//! (1 pt = 4/3 px); ⌘= / ⌘- / ⌘0 zoom. Only pages near the viewport render,
//! at device resolution, and a superseded zoom level is ignored.
use crate::{
    editor::{
        registry::{PaneEntries, SurfaceInput, SurfaceRequest, ViewerSurface},
        workbench::pane::{Item, ItemKind},
    },
    localization::{t, tf},
    platform::pdf::{self, Failure, PageSize, Reply},
    theme,
    ui::{appearance::ActiveAppearance, loading::LoadingMark},
    workspace::{PreviewData, PreviewResource},
};
use gpui::{prelude::*, *};
use std::{cell::Cell, collections::HashMap, rc::Rc, sync::Arc};

actions!(pdf_viewer, [ZoomIn, ZoomOut, ZoomReset]);
const CONTEXT: &str = "PdfViewer";
/// Points to CSS pixels at 100% (Chromium: 96 / 72).
const PX_PER_PT: f32 = 4. / 3.;
const PAGE_GAP: f32 = 8.;
const MARGIN: f32 = 16.;
const ZOOM_STEPS: [f32; 13] = [
    0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1., 1.1, 1.25, 1.5, 2., 3.,
];

pub fn bind_keys(cx: &mut App) {
    for modifier in ["cmd", "ctrl"] {
        cx.bind_keys([
            KeyBinding::new(&format!("{modifier}-="), ZoomIn, Some(CONTEXT)),
            KeyBinding::new(&format!("{modifier}-+"), ZoomIn, Some(CONTEXT)),
            KeyBinding::new(&format!("{modifier}--"), ZoomOut, Some(CONTEXT)),
            KeyBinding::new(&format!("{modifier}-0"), ZoomReset, Some(CONTEXT)),
        ]);
    }
}

pub fn open(request: &SurfaceRequest, _: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let resource = match request.input {
        SurfaceInput::Resource(resource) => Some(resource.clone()),
        _ => None,
    };
    let id = request.id.to_owned();
    let view = cx.new(|cx| {
        let mut view = PdfView::new(id, cx);
        view.load(resource, cx);
        view
    });
    Box::new(PdfSurface { view })
}

struct PdfSurface {
    view: Entity<PdfView>,
}
impl ViewerSurface for PdfSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }
    fn rebind_resource(&self, resource: &PreviewResource, cx: &mut App) {
        let resource = resource.clone();
        self.view.update(cx, |v, cx| v.load(Some(resource), cx));
    }
    fn focus_handle(&self, cx: &App) -> Option<FocusHandle> {
        Some(self.view.read(cx).focus.clone())
    }
    /// The product's pane item: `pdf-reload` ("Reload page").
    fn pane(&self, cx: &App) -> PaneEntries {
        let view = self.view.read(cx);
        PaneEntries {
            segmented: None,
            items: vec![Item {
                id: "pdf-reload",
                label: t("editor.app.reload").into(),
                kind: ItemKind::Command {
                    disabled: view.resource.is_none() || matches!(view.phase, Phase::Checking),
                },
            }],
            find: false,
        }
    }
    fn pane_item(&self, id: &'static str, _: &mut Window, cx: &mut App) {
        if id == "pdf-reload" {
            self.view.update(cx, |v, cx| v.reload(cx));
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Phase {
    Checking,
    Ready,
    Failed(Failure),
}
struct Rendered {
    generation: u64,
    width: u32,
    image: Arc<RenderImage>,
}
pub struct PdfView {
    id: String,
    resource: Option<PreviewResource>,
    document: Option<pdf::Document>,
    phase: Phase,
    sizes: Vec<PageSize>,
    pages: HashMap<usize, Rendered>,
    requested: HashMap<usize, (u64, u32)>,
    /// `None`: automatic (fit the width when wider than the pane, else 100%).
    zoom: Option<f32>,
    generation: u64,
    load: u64,
    scroll: ScrollHandle,
    viewport: Rc<Cell<Size<Pixels>>>,
    focus: FocusHandle,
    _replies: Option<Task<()>>,
}
impl PdfView {
    fn new(id: String, cx: &mut Context<Self>) -> Self {
        Self {
            id,
            resource: None,
            document: None,
            phase: Phase::Checking,
            sizes: vec![],
            pages: HashMap::new(),
            requested: HashMap::new(),
            zoom: None,
            generation: 0,
            load: 0,
            scroll: ScrollHandle::new(),
            viewport: Rc::new(Cell::new(Size::default())),
            focus: cx.focus_handle(),
            _replies: None,
        }
    }
    fn reload(&mut self, cx: &mut Context<Self>) {
        let resource = self.resource.clone();
        self.load(resource, cx);
    }
    fn load(&mut self, resource: Option<PreviewResource>, cx: &mut Context<Self>) {
        self.resource = resource;
        self.document = None;
        self.sizes.clear();
        self.pages.clear();
        self.requested.clear();
        self.load += 1;
        self.generation += 1;
        let Some(resource) = self.resource.clone() else {
            self.phase = Phase::Failed(Failure::Resource);
            cx.notify();
            return;
        };
        let source = match resource.data() {
            Ok(PreviewData::LocalFile(path)) => pdf::Source::File(path.clone()),
            Ok(PreviewData::Bytes { bytes, .. }) => pdf::Source::Bytes(bytes.to_vec()),
            Err(_) => {
                self.phase = Phase::Failed(Failure::Resource);
                cx.notify();
                return;
            }
        };
        self.phase = Phase::Checking;
        let max_bytes = crate::editor::registry::source_budget("document.pdf");
        let (tx, rx) = async_channel::unbounded();
        let owner = crate::platform::tasks::Owner::new("pdf", self.id.clone(), self.load);
        self.document = Some(pdf::Document::open(source, max_bytes, owner, tx));
        let load = self.load;
        self._replies = Some(cx.spawn(async move |this, cx| {
            while let Ok(reply) = rx.recv().await {
                if this
                    .update(cx, |v, cx| {
                        if v.load == load {
                            v.receive(reply, cx)
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        }));
        cx.notify();
    }
    fn receive(&mut self, reply: Reply, cx: &mut Context<Self>) {
        match reply {
            Reply::Opened(sizes) if self.phase == Phase::Checking => {
                self.sizes = sizes;
                self.phase = if self.sizes.is_empty() {
                    Phase::Failed(Failure::Resource)
                } else {
                    Phase::Ready
                };
            }
            Reply::Opened(_) => {}
            // A late timeout after the document opened is not a failure.
            Reply::Failed(failure) if self.phase == Phase::Checking => {
                self.phase = Phase::Failed(failure);
                self.document = None;
            }
            Reply::Failed(_) => {}
            Reply::Page(bitmap) => {
                if bitmap.generation != self.generation {
                    return;
                }
                let Some(buffer) =
                    image::RgbaImage::from_raw(bitmap.width, bitmap.height, bitmap.bgra)
                else {
                    return;
                };
                let frame = image::Frame::new(buffer);
                self.pages.insert(
                    bitmap.page,
                    Rendered {
                        generation: bitmap.generation,
                        width: bitmap.width,
                        image: Arc::new(RenderImage::new(vec![frame])),
                    },
                );
            }
        }
        cx.notify();
    }
    /// CSS pixels per point at the current zoom.
    fn scale(&self) -> f32 {
        let available = (f32::from(self.viewport.get().width) - 2. * MARGIN).max(1.);
        let widest = self
            .sizes
            .iter()
            .map(|s| s.width)
            .fold(0., f32::max)
            .max(1.);
        match self.zoom {
            Some(zoom) => zoom * PX_PER_PT,
            None => (available / widest).min(PX_PER_PT),
        }
    }
    fn effective_zoom(&self) -> f32 {
        self.scale() / PX_PER_PT
    }
    fn step_zoom(&mut self, direction: i32, cx: &mut Context<Self>) {
        let current = self.effective_zoom();
        let next = if direction > 0 {
            ZOOM_STEPS.iter().copied().find(|z| *z > current + 0.001)
        } else {
            ZOOM_STEPS
                .iter()
                .rev()
                .copied()
                .find(|z| *z < current - 0.001)
        };
        if let Some(next) = next {
            self.zoom = Some(next);
            self.generation += 1;
            self.requested.clear();
            cx.notify();
        }
    }
    /// Asks the engine for pages near the viewport at device resolution.
    fn request_visible(&mut self, scale_factor: f32) {
        let Some(document) = self.document.as_ref() else {
            return;
        };
        let scale = self.scale();
        let viewport = self.viewport.get();
        let top = -f32::from(self.scroll.offset().y);
        let height = f32::from(viewport.height).max(1.);
        let (from, to) = (top - height, top + 2. * height);
        let mut y = MARGIN;
        for (index, size) in self.sizes.iter().enumerate() {
            let h = size.height * scale;
            if y + h >= from && y <= to {
                let width = (size.width * scale * scale_factor).round().max(1.) as u32;
                let fresh = self
                    .pages
                    .get(&index)
                    .is_some_and(|p| p.generation == self.generation && p.width == width);
                let pending = self.requested.get(&index) == Some(&(self.generation, width));
                if !fresh && !pending {
                    document.render(index, width, self.generation);
                    self.requested.insert(index, (self.generation, width));
                }
            }
            y += h + PAGE_GAP;
        }
    }
    fn failure(&self, failure: Failure, cx: &mut Context<Self>) -> AnyElement {
        let p = cx.palette();
        let message = match failure {
            Failure::Limit => tf(
                "editor.unavailable.resourceLimit",
                &[(
                    "limit",
                    format!(
                        "{} MiB",
                        crate::editor::registry::source_budget("a.pdf") / 1024 / 1024
                    )
                    .into(),
                )],
            ),
            Failure::Timeout => t("editor.pdf.timeout").to_owned(),
            Failure::Resource => tf(
                "editor.resource.unavailable",
                &[("kind", t("editor.resource.kind.pdf").into())],
            ),
        };
        // `.editor-state.danger` with the shell's Retry button.
        div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(7.))
            .p(px(24.))
            .bg(p.canvas)
            .text_size(px(theme::ty().ui.meta))
            .text_color(p.danger)
            .child(message)
            .child(
                div()
                    .id("pdf-retry")
                    .min_h(px(theme::control_tight()))
                    .px(px(8.))
                    .py(px(2.))
                    .flex()
                    .items_center()
                    .border_1()
                    .border_color(p.border_subtle)
                    .rounded(px(4.))
                    .bg(p.control)
                    .text_color(p.muted)
                    .hover(move |d| d.bg(p.control_hover).text_color(p.text))
                    .cursor(theme::clickable_cursor())
                    .child(t("common.action.retry"))
                    .on_click(cx.listener(|v, _, _, cx| v.reload(cx))),
            )
            .into_any_element()
    }
}
impl Focusable for PdfView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl Render for PdfView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = cx.palette();
        let viewport = self.viewport.clone();
        let measure = canvas(
            move |bounds, _, _| viewport.set(bounds.size),
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();
        let body: AnyElement = match self.phase {
            Phase::Failed(failure) => return self.failure(failure, cx).into_any_element(),
            Phase::Checking => div()
                .size_full()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(8.))
                .bg(p.panel_raised)
                .text_size(px(theme::ty().ui.meta))
                .text_color(p.subtle)
                .child(LoadingMark::new("pdf-pending"))
                .child(t("editor.preview.loading"))
                .into_any_element(),
            Phase::Ready => {
                self.request_visible(window.scale_factor());
                let scale = self.scale();
                let mut column = div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(PAGE_GAP))
                    .py(px(MARGIN))
                    .px(px(MARGIN))
                    .min_w_full();
                for (index, size) in self.sizes.iter().enumerate() {
                    let (w, h) = (size.width * scale, size.height * scale);
                    let page = div()
                        .id(("pdf-page", index))
                        .flex_none()
                        .w(px(w))
                        .h(px(h))
                        .bg(gpui::white())
                        .shadow(vec![BoxShadow {
                            color: hsla(0., 0., 0., 0.3),
                            offset: point(px(0.), px(1.)),
                            blur_radius: px(4.),
                            spread_radius: px(0.),
                            inset: false,
                        }]);
                    let page = match self.pages.get(&index) {
                        Some(rendered) => page.child(
                            img(ImageSource::from(rendered.image.clone()))
                                .w(px(w))
                                .h(px(h))
                                .object_fit(ObjectFit::Fill),
                        ),
                        None => page,
                    };
                    column = column.child(page);
                }
                div()
                    .id("pdf-scroll")
                    .size_full()
                    .overflow_scroll()
                    .track_scroll(&self.scroll)
                    .bg(p.panel_raised)
                    .on_scroll_wheel(cx.listener(|_, _, _, cx| cx.notify()))
                    .child(column)
                    .into_any_element()
            }
        };
        div()
            .id("pdf-preview-surface")
            .relative()
            .size_full()
            .overflow_hidden()
            .track_focus(&self.focus)
            .key_context(CONTEXT)
            .on_action(cx.listener(|v, _: &ZoomIn, _, cx| v.step_zoom(1, cx)))
            .on_action(cx.listener(|v, _: &ZoomOut, _, cx| v.step_zoom(-1, cx)))
            .on_action(cx.listener(|v, _: &ZoomReset, _, cx| {
                v.zoom = None;
                v.generation += 1;
                v.requested.clear();
                cx.notify();
            }))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|v, _, window, cx| v.focus.focus(window, cx)),
            )
            .child(measure)
            .child(body)
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[gpui::test]
    fn a_pdf_opens_fits_the_pane_and_renders_its_page(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        if pdf::library_path().is_none() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.pdf"), crate::platform::pdf::test_pdf()).unwrap();
        let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(std::path::Path::new("a.pdf")).unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = PdfView::new("a.pdf".into(), cx);
            view.load(Some(resource), cx);
            view
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            cx.run_until_parked();
            cx.update(|w, cx| {
                let _ = w.draw(cx);
            });
            if view.read_with(cx, |v, _| {
                v.phase == Phase::Ready && v.pages.contains_key(&0)
            }) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "the page never rendered"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        view.read_with(cx, |v, _| {
            assert_eq!(v.sizes.len(), 1);
            // 200 pt fits at 100% (≈267 px) in the test window.
            assert!((v.effective_zoom() - 1.).abs() < 0.01 || v.effective_zoom() < 1.);
        });
        // ⌘= zooms in one product step and supersedes earlier renders.
        let before = view.read_with(cx, |v, _| v.generation);
        view.update(cx, |v, cx| v.step_zoom(1, cx));
        view.read_with(cx, |v, _| assert_eq!(v.generation, before + 1));
    }

    #[gpui::test]
    fn a_non_pdf_reports_the_resource_failure_with_retry(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.pdf"), b"not a pdf").unwrap();
        let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(std::path::Path::new("a.pdf")).unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = PdfView::new("a.pdf".into(), cx);
            view.load(Some(resource), cx);
            view
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while view.read_with(cx, |v, _| v.phase == Phase::Checking) {
            cx.run_until_parked();
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        view.read_with(cx, |v, _| {
            assert_eq!(v.phase, Phase::Failed(Failure::Resource))
        });
    }
}
