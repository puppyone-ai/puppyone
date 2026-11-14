//! `.cm-md-video-widget` (markdown-inline-widgets.css): a panel as wide as
//! the column up to 760px and at least 180px tall, on a near-black
//! backdrop with the block radius and rings. Until the video's metadata is
//! in it is a 16:9 loading tile; then the player fills the panel's width,
//! as tall as the video (or its `x360` height) up to 70% of the window or
//! 720px, centred; a video that cannot play shows its title or source.
use super::{VideoBlock, player};
use crate::{
    editor::{
        markdown::{
            shared::ring,
            style::{BlockStyle, MarkdownTheme},
        },
        registry::DocumentAssets,
        tokens::{Tokens, over},
        view::widget::{BlockWidget, WidgetCx},
    },
    theme::{self, Theme},
};
use gpui::{prelude::*, *};
use std::path::PathBuf;

/// `width: min(100%, 760px); min-height: 180px`.
const MAX_WIDTH: f32 = 760.;
const MIN_HEIGHT: f32 = 180.;
/// `.cm-md-video-player { max-height: min(70vh, 720px) }`.
const MAX_PLAYER_HEIGHT: f32 = 720.;
const MAX_PLAYER_VIEWPORT: f32 = 0.7;
/// `.cm-md-video-placeholder { padding: 16px }`.
const PLACEHOLDER_PADDING: f32 = 16.;

pub struct VideoBlockWidget {
    block: VideoBlock,
    /// The video's workspace path, if it resolves to one.
    path: Option<PathBuf>,
    assets: Option<DocumentAssets>,
    chrome: BlockStyle,
    dark: bool,
    /// `color-mix(in srgb, #000 82%, var(--po-control))`.
    backdrop: Rgba,
    /// `.is-loading`: `color-mix(in srgb, var(--po-control) 32%, #000)`.
    loading: Rgba,
}

enum Shown {
    Loading,
    /// The player's height.
    Playing(f32),
    Failed,
}

impl VideoBlockWidget {
    pub fn new(
        block: VideoBlock,
        path: Option<PathBuf>,
        assets: Option<DocumentAssets>,
        theme: &MarkdownTheme,
    ) -> Self {
        let t = Tokens::get(theme.dark, theme.scale);
        let control = over(t.color("--po-control"), t.color("--po-editor-bg"));
        Self {
            block,
            path,
            assets,
            chrome: theme.block.clone(),
            dark: theme.dark,
            backdrop: theme::shade(control, 0.18),
            loading: theme::shade(control, 0.32),
        }
    }
}

impl BlockWidget for VideoBlockWidget {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let width = cx.width.min(MAX_WIDTH);
        let viewport = f32::from(cx.render.window.viewport_size().height);
        let cap = (viewport * MAX_PLAYER_VIEWPORT).min(MAX_PLAYER_HEIGHT);
        let editor = cx.render.view.entity_id();
        let player = match (&self.path, &self.assets) {
            (Some(path), Some(assets)) => player::get(
                player::Request {
                    key: (editor, self.block.range.start, 0, path.clone()),
                    media: player::Media::Video,
                    title: self.block.title.as_deref(),
                    background: theme::video_black(),
                    assets,
                    dark: self.dark,
                },
                cx.render.window,
                cx.render.app,
            ),
            _ => None,
        };
        let shown = match &player {
            Some(p) if p.failed.get() => Shown::Failed,
            Some(p) => match p.size.get() {
                Some((w, h)) => {
                    let natural = width * h / w;
                    let height = self.block.height.map_or(natural, |h| h as f32);
                    Shown::Playing(height.min(cap).max(1.))
                }
                None => Shown::Loading,
            },
            None => Shown::Failed,
        };
        let height = match shown {
            Shown::Loading => (width * 9. / 16.).max(MIN_HEIGHT),
            Shown::Playing(h) => h.max(MIN_HEIGHT),
            Shown::Failed => MIN_HEIGHT,
        };
        let c = &self.chrome;
        let app = Theme::new(self.dark);
        let mut panel = div()
            .absolute()
            .left_0()
            .top_0()
            .w(px(width))
            .h(px(height))
            .rounded(px(c.radius))
            .overflow_hidden()
            .bg(self.backdrop);
        panel = match shown {
            Shown::Loading => panel.child(div().size_full().bg(self.loading)),
            Shown::Failed => panel.child(
                div()
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .p(px(PLACEHOLDER_PADDING))
                    .text_size(px(theme::ty().ui.meta))
                    .text_color(app.muted)
                    .child(SharedString::from(self.block.label().to_owned())),
            ),
            Shown::Playing(h) => {
                let player = player.clone();
                // The panel's corners while the player fills it.
                let radius = if h >= height { c.radius } else { 0. };
                panel.child(
                    canvas(
                        |_, _, _| {},
                        move |bounds, _, window, _| {
                            if let Some(player) = &player {
                                player.place(bounds, window.content_mask().bounds, radius);
                            }
                        },
                    )
                    .absolute()
                    .left_0()
                    .top(px((height - h) / 2.))
                    .w(px(width))
                    .h(px(h)),
                )
            }
        };
        let size = (width, height);
        let frame = if cx.state.selected {
            ring::ring(size, c.radius, c.ring_width, c.selected_ring)
        } else if cx.state.focus_within() {
            ring::ring(size, c.radius, c.ring_width, c.hover_ring)
        } else {
            let hover = c.hover_ring;
            ring::outline(size, c.radius, c.ring_width)
                .group_hover("md-video", move |st| st.border_color(hover))
        };
        let surface = div()
            .absolute()
            .left_0()
            .top_0()
            .w(px(width))
            .h(px(height))
            .group("md-video")
            .child(panel)
            .child(frame);
        (
            cx.block_box(height).child(surface).into_any_element(),
            height,
        )
    }
}
