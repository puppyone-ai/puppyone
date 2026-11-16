//! Markdown platform capability layer (`TA-42`, `TA-50`, `TA-51`, `TA-52`):
//! brokers (`assets`, `render`, `embed`, `link`), centralized `policy`, and the
//! `HtmlPlatformBridge` adapter injected into `shared::html_surface::Surface`.
//! Never imports `markdown::features` or `markdown::composition` (`R7`).
pub mod assets;
pub mod embed;
pub mod link;
pub mod policy;
pub mod render;

use crate::editor::{
    markdown::{
        shared::{
            html_surface::{HtmlMediaPort, ImageLoad, MediaKind},
            media_source::MediaSource,
        },
        style::MarkdownTheme,
    },
    registry::DocumentAssets,
    tokens::Tokens,
    view::{editor::EditorView, render::RenderCx},
};
use gpui::{prelude::*, *};
use std::path::Path;

/// Concrete `HtmlMediaPort` backed by `AssetBroker` and `EmbedBroker`, passed
/// by HTML and MDX widgets into `shared::html_surface::Surface`.
pub struct HtmlPlatformBridge<'a> {
    pub theme: &'a MarkdownTheme,
    pub assets: Option<&'a DocumentAssets>,
    pub view: WeakEntity<EditorView>,
    pub block: usize,
}

impl<'a> HtmlPlatformBridge<'a> {
    pub fn new(
        theme: &'a MarkdownTheme,
        assets: Option<&'a DocumentAssets>,
        view: WeakEntity<EditorView>,
        block: usize,
    ) -> Self {
        Self {
            theme,
            assets,
            view,
            block,
        }
    }
}

impl HtmlMediaPort for HtmlPlatformBridge<'_> {
    fn load_image(&mut self, source: &MediaSource, app: &mut App) -> ImageLoad {
        match assets::get(source, self.assets, app) {
            assets::AssetState::Loading => ImageLoad::Loading,
            assets::AssetState::Ready {
                image,
                width,
                height,
            } => ImageLoad::Ready {
                image,
                width,
                height,
            },
            assets::AssetState::Failed(reason) => ImageLoad::Failed(Some(SharedString::from(
                reason.user_reason("editor.resource.kind.image"),
            ))),
        }
    }

    fn render_media(
        &mut self,
        kind: MediaKind,
        path: Option<&Path>,
        title: Option<&str>,
        dims: (Option<f32>, Option<f32>),
        index: usize,
        available: f32,
        render: &mut RenderCx,
    ) -> Option<AnyElement> {
        let (path, doc_assets, view) = (path?, self.assets?, self.view.upgrade()?);
        let t = Tokens::get(self.theme.dark, self.theme.scale);
        let background = match kind {
            MediaKind::Video => t.color("--po-md-media-background"),
            MediaKind::Audio => t.color("--po-editor-bg"),
        };
        let player = embed::get_media_player(
            embed::MediaRequest {
                key: (view.entity_id(), self.block, index, path.to_path_buf()),
                kind,
                title,
                background,
                assets: doc_assets,
                dark: self.theme.dark,
            },
            render.window,
            render.app,
        );
        if player.failure().is_some() {
            return None;
        }
        let (width, height, radius) = match kind {
            MediaKind::Audio => (embed::AUDIO_SIZE.0.min(available), embed::AUDIO_SIZE.1, 0.),
            MediaKind::Video => {
                let (nw, nh) = player.size.get().unwrap_or((300., 150.));
                let (mut w, mut h) = match dims {
                    (Some(w), Some(h)) => (w, h),
                    (Some(w), None) => (w, w * nh / nw),
                    (None, Some(h)) => (h * nw / nh, h),
                    (None, None) => (nw, nh),
                };
                if w > available {
                    h *= available / w;
                    w = available;
                }
                let viewport = f32::from(render.window.viewport_size().height);
                let cap = (viewport * 0.7).min(720.);
                if h > cap {
                    w *= cap / h;
                    h = cap;
                }
                (w, h, self.theme.block.radius)
            }
        };
        let ready = player.size.get().is_some();
        Some(
            div()
                .w(px(width))
                .h(px(height))
                .rounded(px(radius))
                .bg(background)
                .child(
                    canvas(
                        |_, _, _| {},
                        move |bounds, _, window, _| {
                            if ready {
                                player.place(bounds, window.content_mask().bounds, radius);
                            }
                        },
                    )
                    .size_full(),
                )
                .into_any_element(),
        )
    }
}
