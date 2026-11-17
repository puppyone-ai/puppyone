//! `ExternalViewerChooser`: several installed Viewer Packs match a document
//! equally; the user picks one and its host surface opens in place.
use crate::workspace::{PreviewResource, Workspace};
use crate::{
    editor::{
        navigation::ReferenceContext,
        registry::{
            DocumentAssets, SourceKind, SurfaceInput, SurfaceRequest, ViewerSurface,
            packs::{ExternalSurfaceFactory, PackContribution},
        },
    },
    formats::FileFormat,
    localization::tf,
    platform::webview,
    theme,
    typography::Scale,
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant},
    },
};
use gpui::{prelude::*, *};
use std::{path::PathBuf, sync::Arc};

pub fn chooser(
    request: &SurfaceRequest,
    candidates: Vec<PackContribution>,
    render: ExternalSurfaceFactory,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    let path = match request.input {
        SurfaceInput::Resource(path) => Some(path.clone()),
        _ => None,
    };
    let view = cx.new(|_| Chooser {
        id: request.id.to_owned(),
        name: request.name.to_owned(),
        path,
        format: request.format,
        dark: request.dark,
        scale: request.scale,
        workspace: request.workspace.clone(),
        folder: request.folder.clone(),
        web_source: request.web_source.clone(),
        assets: request.assets.clone(),
        references: request.references.clone(),
        source_kind: request.source_kind,
        candidates,
        render,
        opened: None,
    });
    Box::new(ChooserSurface { view })
}

struct ChooserSurface {
    view: Entity<Chooser>,
}
impl ViewerSurface for ChooserSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }
}

struct Chooser {
    id: String,
    name: String,
    path: Option<PreviewResource>,
    format: &'static FileFormat,
    dark: bool,
    scale: Scale,
    workspace: Option<Arc<Workspace>>,
    folder: Option<PathBuf>,
    web_source: Option<webview::Source>,
    assets: Option<DocumentAssets>,
    references: Option<ReferenceContext>,
    source_kind: SourceKind,
    candidates: Vec<PackContribution>,
    render: ExternalSurfaceFactory,
    opened: Option<Box<dyn ViewerSurface>>,
}

impl Chooser {
    fn choose(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let request = SurfaceRequest {
            id: &self.id,
            name: &self.name,
            input: match &self.path {
                Some(path) => SurfaceInput::Resource(path),
                None => SurfaceInput::None,
            },
            format: self.format,
            resolved_extension: None,
            dark: self.dark,
            scale: self.scale,
            workspace: self.workspace.clone(),
            file_mode: false,
            folder: self.folder.clone(),
            web_source: self.web_source.clone(),
            assets: self.assets.clone(),
            references: self.references.clone(),
            source_kind: self.source_kind,
        };
        self.opened = Some((self.render)(&request, &self.candidates[index], window, cx));
        cx.notify();
    }
}

impl Render for Chooser {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(opened) = &self.opened {
            return opened.element();
        }
        let t = cx.palette();
        let name = self
            .name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(&self.name)
            .to_owned();
        div()
            .id("external-viewer-chooser")
            .size_full()
            .flex()
            .items_center()
            .flex_col()
            .justify_center()
            .gap(px(12.))
            .p(px(32.))
            .bg(t.canvas)
            .child(
                div()
                    .text_size(px(theme::ty().editor.data))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.text)
                    .child(tf("editor.viewer.chooseFor", &[("name", name.into())])),
            )
            .children(self.candidates.iter().enumerate().map(|(index, pack)| {
                Button::new(("viewer-pack", index))
                    .variant(ButtonVariant::Secondary)
                    .label(format!(
                        "{} — {} · v{}",
                        pack.label, pack.publisher, pack.version
                    ))
                    .on_click(cx.listener(move |s, _, window, cx| s.choose(index, window, cx)))
            }))
            .into_any_element()
    }
}
