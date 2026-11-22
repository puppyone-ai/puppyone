//! `DocumentPreview` (`document-preview.css`): the fallback surface for files
//! without a built-in viewer (`VW-30`), plus in-pane oversized explanation cards
//! (`RG-02`) and panic-isolated viewer fault recovery cards (`RG-23`).
//!
//! Local files first request a bounded, timeout-protected Quick Look preview or
//! system thumbnail on a background worker (`<= 400ms`), showing the preview
//! alongside file format/size summary and "Open in default app" before falling
//! back to the striped summary card.
#[cfg(test)]
use crate::editor::registry::SpecialSurfaceProbe;
#[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
use crate::editor::registry::SurfaceTestProbe;
use crate::{
    editor::registry::{SurfaceInput, SurfaceRequest, ViewerSurface, format_byte_limit},
    localization::{t, tf},
    platform::image_transcode::{self, QUICK_LOOK_TIMEOUT, ThumbnailKind},
    theme,
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant},
    },
    workspace::{PreviewData, PreviewResource, Workspace},
};
use gpui::{prelude::*, *};
use std::{
    path::{Path, PathBuf},
    rc::Rc,
    sync::Arc,
    time::Duration,
};

const UI_GUARD_TIMEOUT: Duration = Duration::from_millis(400);

/// `document-placeholder`: Quick Look / system thumbnail preview or striped
/// summary ("Binary file · EXT · 12.4 KB") + "Open in default app".
pub fn open_binary(
    request: &SurfaceRequest,
    _: &mut Window,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    let (local_path, known_bytes) = resolve_local_and_size(
        request.name,
        request.input,
        request.workspace.as_ref(),
        request.folder.as_deref(),
    );
    let label: SharedString = t("editor.preview.binaryFile").to_owned().into();
    let name = request.name.to_owned();
    let workspace = request.workspace.clone();
    let view = cx.new(|cx| {
        let mut preview = DocumentPreview::new(label, name, workspace);
        preview.bind_target(local_path, known_bytes, cx);
        preview
    });
    Box::new(PlaceholderSurface { view })
}

/// Options for [`open_oversized`] (`RG-02`).
pub struct OversizedOptions {
    pub name: String,
    pub size_bytes: u64,
    pub limit_bytes: u64,
    pub local_path: Option<PathBuf>,
    pub can_reveal_in_finder: bool,
}

/// Opens an in-pane explanation card when a file exceeds its viewer's manifest
/// budget (`RG-02`), without reading the file body or dropping the slot.
pub fn open_oversized(options: OversizedOptions, cx: &mut App) -> Box<dyn ViewerSurface> {
    let view = cx.new(|_| OversizedCard { options });
    Box::new(OversizedSurface { view })
}

pub type FaultActionCallback = Rc<dyn Fn(&mut Window, &mut App)>;

/// Options for [`open_faulted`] (`RG-23`).
pub struct FaultedOptions {
    pub name: String,
    pub diagnostic: String,
    pub local_path: Option<PathBuf>,
    pub can_switch_plain_text: bool,
    pub on_close: FaultActionCallback,
    pub on_switch_plain_text: Option<FaultActionCallback>,
}

/// Opens an in-pane recovery card when a viewer panics during factory open,
/// event dispatch, or rendering (`RG-23`).
pub fn open_faulted(options: FaultedOptions, cx: &mut App) -> Box<dyn ViewerSurface> {
    let view = cx.new(|_| FaultedCard { options });
    Box::new(FaultedSurface { view })
}

fn resolve_local_and_size(
    name: &str,
    input: SurfaceInput<'_>,
    workspace: Option<&Arc<Workspace>>,
    folder: Option<&Path>,
) -> (Option<PathBuf>, Option<u64>) {
    if let SurfaceInput::Resource(resource) = input {
        match resource.data() {
            Ok(PreviewData::LocalFile(path)) => return (Some(path.clone()), None),
            Ok(PreviewData::Bytes { bytes, .. }) => return (None, Some(bytes.len() as u64)),
            Err(_) => {}
        }
    }
    if let Some(ws) = workspace
        && let Ok(abs) = ws.absolute(Path::new(name))
    {
        return (Some(abs), None);
    }
    if let Some(folder) = folder
        && let Some(file_name) = Path::new(name).file_name()
    {
        return (Some(folder.join(file_name)), None);
    }
    (None, None)
}

/// `binaryFileType`: the name's extension, upper-cased.
fn file_type(name: &str) -> Option<String> {
    let name = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let dot = name.rfind('.')?;
    (dot > 0 && dot < name.len() - 1).then(|| name[dot + 1..].to_uppercase())
}

fn display_name(name: &str) -> String {
    name.rsplit(['/', '\\']).next().unwrap_or(name).to_owned()
}

pub fn format_file_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    if bytes < 1024 {
        format!("{bytes} B")
    } else if (bytes as f64) < MB {
        format!("{:.1} KB", bytes as f64 / KB)
    } else if (bytes as f64) < GB {
        format!("{:.1} MB", bytes as f64 / MB)
    } else {
        format!("{:.2} GB", bytes as f64 / GB)
    }
}

struct OversizedSurface {
    view: Entity<OversizedCard>,
}

impl ViewerSurface for OversizedSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }

    fn rebind_name(&self, name: &str, cx: &mut App) {
        let name = name.to_owned();
        self.view.update(cx, |v, cx| {
            v.options.name = name;
            cx.notify();
        });
    }

    #[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
    fn as_test_probe(&self) -> Option<&dyn SurfaceTestProbe> {
        Some(self)
    }
}

#[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
impl SurfaceTestProbe for OversizedSurface {
    #[cfg(test)]
    fn special_surface(&self, cx: &App) -> Option<SpecialSurfaceProbe> {
        let o = &self.view.read(cx).options;
        Some(SpecialSurfaceProbe {
            kind: "oversized",
            size_bytes: Some(o.size_bytes),
            limit_bytes: Some(o.limit_bytes),
            can_open_default_app: o.local_path.is_some(),
            can_reveal_in_finder: o.can_reveal_in_finder && o.local_path.is_some(),
            can_switch_plain_text: false,
            detail: format!(
                "{} / {}",
                format_file_size(o.size_bytes),
                format_byte_limit(o.limit_bytes)
            ),
        })
    }
}

struct OversizedCard {
    options: OversizedOptions,
}

impl Render for OversizedCard {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t_ = cx.palette();
        let data_size = theme::ty().editor.data;
        let limit_text = format_byte_limit(self.options.limit_bytes);
        let explanation = tf(
            "editor.unavailable.resourceLimit",
            &[("limit", limit_text.clone().into())],
        );
        let mut details = Vec::new();
        if let Some(ext) = file_type(&self.options.name) {
            details.push(ext);
        }
        details.push(format_file_size(self.options.size_bytes));
        let summary = details.join(" · ");

        let local_for_open = self.options.local_path.clone();
        let local_for_reveal = self
            .options
            .local_path
            .clone()
            .filter(|_| self.options.can_reveal_in_finder);

        let mut actions: Vec<AnyElement> = Vec::new();
        if let Some(path) = local_for_open {
            actions.push(
                Button::new("oversized-open-default")
                    .variant(ButtonVariant::Secondary)
                    .label(t("editor.openDefaultApp"))
                    .on_click(move |_, window, cx| {
                        crate::editor::question::open_external(
                            Some(window.window_handle()),
                            path.clone(),
                            |_, _| {},
                            cx,
                        );
                    })
                    .into_any_element(),
            );
        }
        if let Some(path) = local_for_reveal {
            actions.push(
                Button::new("oversized-reveal-finder")
                    .variant(ButtonVariant::Secondary)
                    .label(t(
                        crate::platform::conventions::Conventions::current().reveal_label_key
                    ))
                    .on_click(move |_, _, _| {
                        let _ = crate::platform::desktop::reveal(&path);
                    })
                    .into_any_element(),
            );
        }

        div()
            .id("oversized-document-surface")
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .p(px(32.))
            .bg(t_.canvas)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(12.))
                    .max_w(px(460.))
                    .px(px(28.))
                    .py(px(22.))
                    .rounded(px(theme::metric::CARD_RADIUS))
                    .border_1()
                    .border_color(t_.border_subtle)
                    .bg(t_.panel_raised)
                    .child(
                        div()
                            .max_w_full()
                            .truncate()
                            .text_size(px(theme::ty().ui.body))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t_.text)
                            .child(display_name(&self.options.name)),
                    )
                    .child(
                        div()
                            .text_size(px(data_size))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t_.muted)
                            .child(summary),
                    )
                    .child(
                        div()
                            .text_size(px(data_size))
                            .line_height(relative(1.45))
                            .text_color(t_.subtle)
                            .text_center()
                            .child(explanation),
                    )
                    .when(!actions.is_empty(), |d| {
                        d.child(
                            div()
                                .flex()
                                .flex_wrap()
                                .items_center()
                                .justify_center()
                                .gap(px(8.))
                                .children(actions),
                        )
                    }),
            )
    }
}

struct FaultedSurface {
    view: Entity<FaultedCard>,
}

impl ViewerSurface for FaultedSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }

    #[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
    fn as_test_probe(&self) -> Option<&dyn SurfaceTestProbe> {
        Some(self)
    }
}

#[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
impl SurfaceTestProbe for FaultedSurface {
    #[cfg(test)]
    fn special_surface(&self, cx: &App) -> Option<SpecialSurfaceProbe> {
        let o = &self.view.read(cx).options;
        Some(SpecialSurfaceProbe {
            kind: "faulted",
            size_bytes: None,
            limit_bytes: None,
            can_open_default_app: o.local_path.is_some(),
            can_reveal_in_finder: false,
            can_switch_plain_text: o.can_switch_plain_text && o.on_switch_plain_text.is_some(),
            detail: o.diagnostic.clone(),
        })
    }
}

struct FaultedCard {
    options: FaultedOptions,
}

impl Render for FaultedCard {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t_ = cx.palette();
        let data_size = theme::ty().editor.data;
        let on_close = self.options.on_close.clone();
        let local_for_open = self.options.local_path.clone();
        let switch_plain = self
            .options
            .on_switch_plain_text
            .clone()
            .filter(|_| self.options.can_switch_plain_text);

        let mut actions: Vec<AnyElement> = Vec::new();
        if let Some(switch_cb) = switch_plain {
            actions.push(
                Button::new("faulted-switch-plain-text")
                    .variant(ButtonVariant::Secondary)
                    .label("Switch to Plain Text")
                    .on_click(move |_, window, cx| switch_cb(window, cx))
                    .into_any_element(),
            );
        }
        if let Some(path) = local_for_open {
            actions.push(
                Button::new("faulted-open-default")
                    .variant(ButtonVariant::Secondary)
                    .label(t("editor.openDefaultApp"))
                    .on_click(move |_, window, cx| {
                        crate::editor::question::open_external(
                            Some(window.window_handle()),
                            path.clone(),
                            |_, _| {},
                            cx,
                        );
                    })
                    .into_any_element(),
            );
        }
        actions.push(
            Button::new("faulted-close")
                .variant(ButtonVariant::Secondary)
                .label(t("common.action.close"))
                .on_click(move |_, window, cx| on_close(window, cx))
                .into_any_element(),
        );

        div()
            .id("faulted-viewer-surface")
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .p(px(32.))
            .bg(t_.canvas)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(12.))
                    .max_w(px(460.))
                    .px(px(28.))
                    .py(px(22.))
                    .rounded(px(theme::metric::CARD_RADIUS))
                    .border_1()
                    .border_color(t_.border_subtle)
                    .bg(t_.panel_raised)
                    .child(
                        div()
                            .max_w_full()
                            .truncate()
                            .text_size(px(theme::ty().ui.body))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t_.text)
                            .child(display_name(&self.options.name)),
                    )
                    .child(
                        div()
                            .text_size(px(data_size))
                            .line_height(relative(1.45))
                            .text_color(t_.danger)
                            .text_center()
                            .child(self.options.diagnostic.clone()),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .justify_center()
                            .gap(px(8.))
                            .children(actions),
                    ),
            )
    }
}

struct PlaceholderSurface {
    view: Entity<DocumentPreview>,
}

impl ViewerSurface for PlaceholderSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }

    fn rebind_name(&self, name: &str, cx: &mut App) {
        let name = name.to_owned();
        self.view.update(cx, |v, cx| v.rebind_name(name, cx));
    }

    fn rebind_resource(&self, resource: &PreviewResource, cx: &mut App) {
        let resource = resource.clone();
        self.view
            .update(cx, |v, cx| v.rebind_resource(&resource, cx));
    }

    #[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
    fn as_test_probe(&self) -> Option<&dyn SurfaceTestProbe> {
        Some(self)
    }
}

#[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
impl SurfaceTestProbe for PlaceholderSurface {
    /// `detail` is the text the card shows: the summary, and the name only
    /// beside a preview image.
    #[cfg(test)]
    fn special_surface(&self, cx: &App) -> Option<SpecialSurfaceProbe> {
        let v = self.view.read(cx);
        let summary = std::iter::once(v.label.to_string())
            .chain(v.details())
            .collect::<Vec<_>>()
            .join(" · ");
        Some(SpecialSurfaceProbe {
            kind: "placeholder",
            size_bytes: v.byte_size,
            limit_bytes: None,
            can_open_default_app: v.local_path.is_some(),
            can_reveal_in_finder: false,
            can_switch_plain_text: false,
            detail: match v.thumbnail {
                Some(_) => format!("{}\n{summary}", display_name(&v.name)),
                None => summary,
            },
        })
    }
}

struct RenderedThumbnail {
    image: Arc<RenderImage>,
    width: u32,
    height: u32,
    kind: ThumbnailKind,
}

pub struct DocumentPreview {
    label: SharedString,
    name: String,
    file_type: Option<String>,
    workspace: Option<Arc<Workspace>>,
    local_path: Option<PathBuf>,
    byte_size: Option<u64>,
    thumbnail: Option<RenderedThumbnail>,
    settled: bool,
    generation: u64,
    _task: Option<Task<()>>,
    _guard: Option<Task<()>>,
}

impl DocumentPreview {
    fn new(label: SharedString, name: String, workspace: Option<Arc<Workspace>>) -> Self {
        let file_type = file_type(&name);
        Self {
            label,
            name,
            file_type,
            workspace,
            local_path: None,
            byte_size: None,
            thumbnail: None,
            settled: true,
            generation: 0,
            _task: None,
            _guard: None,
        }
    }

    fn release_thumbnail(&mut self, cx: &mut Context<Self>) {
        if let Some(thumb) = self.thumbnail.take() {
            cx.drop_image(thumb.image, None);
        }
    }

    fn rebind_name(&mut self, name: String, cx: &mut Context<Self>) {
        self.file_type = file_type(&name);
        self.name = name;
        let next_local = self
            .workspace
            .as_ref()
            .and_then(|ws| ws.absolute(Path::new(&self.name)).ok());
        if next_local.is_some() {
            self.bind_target(next_local, None, cx);
        } else {
            cx.notify();
        }
    }

    fn rebind_resource(&mut self, resource: &PreviewResource, cx: &mut Context<Self>) {
        match resource.data() {
            Ok(PreviewData::LocalFile(path)) => self.bind_target(Some(path.clone()), None, cx),
            Ok(PreviewData::Bytes { bytes, .. }) => {
                self.bind_target(None, Some(bytes.len() as u64), cx)
            }
            Err(_) => self.bind_target(None, None, cx),
        }
    }

    fn bind_target(
        &mut self,
        local_path: Option<PathBuf>,
        known_bytes: Option<u64>,
        cx: &mut Context<Self>,
    ) {
        self.release_thumbnail(cx);
        self.local_path = local_path.clone();
        self.byte_size = known_bytes;
        self.generation += 1;
        self._task = None;
        self._guard = None;

        let Some(path) = local_path else {
            self.settled = true;
            cx.notify();
            return;
        };

        self.settled = false;
        let generation = self.generation;
        let worker = cx.background_executor().spawn(async move {
            image_transcode::quick_look_preview(&path, 512, QUICK_LOOK_TIMEOUT)
        });
        self._task = Some(cx.spawn(async move |this, cx| {
            let info = worker.await;
            let _ = this.update(cx, |v, cx| {
                if v.generation != generation {
                    return;
                }
                if let Some(sz) = info.byte_size {
                    v.byte_size = Some(sz);
                }
                if let Some(thumb) = info.thumbnail
                    && let Some(buf) = image::RgbaImage::from_raw(
                        thumb.frame.width,
                        thumb.frame.height,
                        thumb.frame.bgra,
                    )
                {
                    let frame = image::Frame::new(buf);
                    v.thumbnail = Some(RenderedThumbnail {
                        image: Arc::new(RenderImage::new(vec![frame])),
                        width: thumb.frame.width,
                        height: thumb.frame.height,
                        kind: thumb.kind,
                    });
                }
                v.settled = true;
                cx.notify();
            });
        }));

        let timer = cx.background_executor().timer(UI_GUARD_TIMEOUT);
        self._guard = Some(cx.spawn(async move |this, cx| {
            timer.await;
            let _ = this.update(cx, |v, cx| {
                if v.generation == generation && !v.settled {
                    v.settled = true;
                    cx.notify();
                }
            });
        }));
        cx.notify();
    }

    fn open_in_default_app(&self, window: &Window, cx: &mut App) {
        if let Some(path) = &self.local_path {
            crate::editor::question::open_external(
                Some(window.window_handle()),
                path.clone(),
                |_, _| {},
                cx,
            );
        }
    }

    /// The summary after the label: the file type and size when known.
    fn details(&self) -> Vec<String> {
        let mut details = Vec::new();
        if let Some(kind) = &self.file_type {
            details.push(kind.clone());
        }
        if let Some(bytes) = self.byte_size {
            details.push(format_file_size(bytes));
        }
        details
    }

    fn summary_line(&self, t_: theme::Theme) -> Div {
        let details = self.details();
        div()
            .flex()
            .flex_wrap()
            .justify_center()
            .child(self.label.clone())
            .children((!details.is_empty()).then(|| {
                div()
                    .text_color(t_.text_disabled)
                    .child(format!(" · {}", details.join(" · ")))
            }))
    }
}

impl Render for DocumentPreview {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t_ = cx.palette();
        let size = theme::ty().editor.data;
        let along = window.scale_factor() * std::f32::consts::SQRT_2;

        let open_button = self.local_path.is_some().then(|| {
            Button::new("placeholder-open-default")
                .variant(ButtonVariant::Secondary)
                .label(t("editor.openDefaultApp"))
                .on_click(cx.listener(|v, _, window, cx| v.open_in_default_app(window, cx)))
        });

        let card = if let Some(thumb) = &self.thumbnail {
            let (max_w, max_h) = match thumb.kind {
                ThumbnailKind::QuickLook => (340., 240.),
                ThumbnailKind::SystemIcon => (72., 72.),
            };
            let scale = (max_w / thumb.width.max(1) as f32)
                .min(max_h / thumb.height.max(1) as f32)
                .min(1.0);
            let (dw, dh) = (
                (thumb.width.max(1) as f32 * scale).max(24.),
                (thumb.height.max(1) as f32 * scale).max(24.),
            );
            div()
                .id("placeholder-quicklook-card")
                .flex()
                .flex_col()
                .items_center()
                .gap(px(12.))
                .max_w(px(420.))
                .px(px(28.))
                .py(px(22.))
                .rounded(px(theme::metric::CARD_RADIUS))
                .border_1()
                .border_color(t_.border_subtle)
                .bg(t_.panel_raised)
                .child(
                    img(ImageSource::from(thumb.image.clone()))
                        .w(px(dw))
                        .h(px(dh))
                        .object_fit(ObjectFit::Contain)
                        .rounded(px(6.)),
                )
                .child(
                    div()
                        .max_w_full()
                        .truncate()
                        .text_size(px(theme::ty().ui.body))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(t_.text)
                        .child(display_name(&self.name)),
                )
                .child(
                    div()
                        .text_size(px(size))
                        .line_height(relative(1.45))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t_.muted)
                        .child(self.summary_line(t_)),
                )
                .children(open_button)
                .into_any_element()
        } else {
            // `.document-preview__summary`: striped fallback card (+ Open in default app when local).
            div()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(12.))
                .max_w_full()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .items_center()
                        .gap(px(4.))
                        .max_w_full()
                        .px(px(24.))
                        .py(px(16.))
                        .border_1()
                        .border_color(theme::alpha(t_.muted, 0.42))
                        .bg(pattern_slash(
                            theme::alpha(t_.muted, 0.32),
                            along,
                            15. * along,
                        ))
                        .text_size(px(size))
                        .line_height(relative(1.45))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t_.muted)
                        .child(self.summary_line(t_)),
                )
                .children(open_button)
                .into_any_element()
        };

        // `role="status"`: the pane names the file it cannot preview.
        div()
            .id("document-preview")
            .role(Role::Status)
            .aria_label(tf(
                "editor.preview.unavailableFor",
                &[("name", display_name(&self.name).into())],
            ))
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .p(px(32.))
            .bg(t_.canvas)
            .child(card)
            .test_support()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_file_type_is_the_upper_cased_extension() {
        assert_eq!(file_type("assets/model.glb").as_deref(), Some("GLB"));
        assert_eq!(file_type(".env"), None);
        assert_eq!(file_type("Makefile"), None);
        assert_eq!(file_type("trailing."), None);
        assert_eq!(format_file_size(512), "512 B");
        assert_eq!(format_file_size(2048), "2.0 KB");
    }

    #[gpui::test]
    fn local_placeholder_resolves_preview_and_size_within_timeout(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        let dir = tempfile::tempdir().unwrap();
        let img = image::RgbaImage::from_pixel(64, 48, image::Rgba([60, 140, 220, 255]));
        let mut buf = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut buf, image::ImageFormat::Png)
            .unwrap();
        let raw = buf.into_inner();
        let expected_len = raw.len() as u64;
        std::fs::write(dir.path().join("asset.qqqq"), &raw).unwrap();
        let ws = Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(Path::new("asset.qqqq")).unwrap();

        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut preview =
                DocumentPreview::new("Binary file".into(), "asset.qqqq".into(), Some(ws));
            preview.rebind_resource(&resource, cx);
            preview
        });

        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while !view.read_with(cx, |v, _| v.settled) {
            cx.run_until_parked();
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }

        view.read_with(cx, |v, _| {
            assert!(v.local_path.is_some());
            assert_eq!(v.byte_size, Some(expected_len));
            assert_eq!(v.file_type.as_deref(), Some("QQQQ"));
            if crate::platform::capabilities::Capabilities::probe()
                .quick_look_thumbnails
                .is_available()
            {
                assert!(v.thumbnail.is_some());
            }
        });
    }
}
