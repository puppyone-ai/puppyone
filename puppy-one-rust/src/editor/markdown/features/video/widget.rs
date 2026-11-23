//! `.cm-md-video-widget` (markdown-inline-widgets.css): a panel as wide as
//! the column up to 760px and at least 180px tall, on a near-black
//! backdrop with the block radius and rings. Until the video's metadata is
//! in it is a 16:9 loading tile; then the player fills the panel's width,
//! as tall as the video (or its `x360` height) up to 70% of the window or
//! 720px, centred; a video that cannot play (`> 32 MiB`, missing file,
//! blocked path, or playback error) renders a visible fallback card (`TA-52`,
//! `TODO-37`) with the failure reason plus `Retry` and `Source code` actions.
use super::{ID, ShowSource, VideoBlock, player};
use crate::{
    editor::{
        markdown::{
            platform::policy::AssetFailure,
            shared::widgets::{
                fallback::{FallbackSummary, action_pill},
                ring,
            },
            style::{BlockStyle, MarkdownTheme},
        },
        registry::DocumentAssets,
        tokens::{Tokens, over},
        view::{
            command::Command,
            widget::{BlockWidget, WidgetCx},
        },
    },
    localization::{t, tf},
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
    /// Resolved workspace-relative path or policy rejection (`TA-51`).
    path: Result<PathBuf, AssetFailure>,
    assets: Option<DocumentAssets>,
    chrome: BlockStyle,
    dark: bool,
    backdrop: Rgba,
    loading: Rgba,
}

enum Shown {
    Loading,
    Playing(f32),
    Failed(AssetFailure),
}

fn format_limit_mb(limit_bytes: u64) -> String {
    let mib = (limit_bytes as f64 / (1024.0 * 1024.0)).round() as u64;
    format!("{} MB", mib.max(1))
}

/// Computes the user-visible fallback summary for a failed video (`TA-52`).
pub fn describe_video_failure(label: &str, failure: &AssetFailure) -> FallbackSummary {
    let kind = t("editor.resource.kind.video");
    let (reason, retryable) = match failure {
        AssetFailure::ExceedsLimit { limit_bytes } => (
            tf(
                "editor.unavailable.resourceLimit",
                &[("limit", format_limit_mb(*limit_bytes).into())],
            ),
            true,
        ),
        AssetFailure::NotFound => (
            tf(
                "editor.resource.loadFailed",
                &[("kind", kind.into()), ("detail", "File not found".into())],
            ),
            true,
        ),
        AssetFailure::Blocked => (
            tf("editor.resource.unavailable", &[("kind", kind.into())]),
            false,
        ),
        AssetFailure::InvalidFormat => (t("editor.resource.unsupported.video").to_owned(), true),
        AssetFailure::Network(detail) => (
            tf(
                "editor.resource.loadFailed",
                &[
                    ("kind", kind.into()),
                    ("detail", crate::localization::bidi_isolate(detail).into()),
                ],
            ),
            true,
        ),
    };
    FallbackSummary {
        title: label.to_owned(),
        reason,
        retryable,
    }
}

impl VideoBlockWidget {
    pub fn new(
        block: VideoBlock,
        path: Result<PathBuf, AssetFailure>,
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

    fn render_fallback_card(
        &self,
        failure: &AssetFailure,
        media_key: Option<player::Key>,
        cx: &WidgetCx,
    ) -> AnyElement {
        let app = Theme::new(self.dark);
        let ty = theme::ty().ui;
        let summary = describe_video_failure(self.block.label(), failure);
        let send = cx.sender();
        let range = self.block.range.clone();
        let can_retry = summary.retryable && media_key.is_some();
        div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(8.))
            .p(px(PLACEHOLDER_PADDING))
            .text_center()
            .child(
                div()
                    .max_w_full()
                    .truncate()
                    .text_size(px(ty.body))
                    .font_weight(FontWeight(600.))
                    .text_color(app.text)
                    .child(SharedString::from(summary.title)),
            )
            .child(
                div()
                    .max_w_full()
                    .truncate()
                    .text_size(px(ty.meta))
                    .text_color(app.muted)
                    .child(SharedString::from(summary.reason)),
            )
            .child(
                div()
                    .pt(px(4.))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .when(can_retry, |row| {
                        let key = media_key.clone().unwrap();
                        row.child(action_pill(
                            cx.id("md-video-retry"),
                            t("common.action.retry"),
                            self.dark,
                            move |_, app_cx| player::retry(&key, app_cx),
                        ))
                    })
                    .child(action_pill(
                        cx.id("md-video-source"),
                        t("editor.mode.source"),
                        self.dark,
                        move |window, app_cx| {
                            send(Command::new(ID, ShowSource(range.clone())), window, app_cx);
                        },
                    )),
            )
            .into_any_element()
    }
}

impl BlockWidget for VideoBlockWidget {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let width = cx.width.min(MAX_WIDTH);
        let viewport = f32::from(cx.render.window.viewport_size().height);
        let cap = (viewport * MAX_PLAYER_VIEWPORT).min(MAX_PLAYER_HEIGHT);
        let editor = cx.render.view.entity_id();
        let media_key = self
            .path
            .as_ref()
            .ok()
            .map(|p| (editor, self.block.range.start, 0usize, p.clone()));
        let player = match (&self.path, &self.assets, &media_key) {
            (Ok(_), Some(assets), Some(key)) => Some(player::get(
                player::Request {
                    key: key.clone(),
                    media: player::Media::Video,
                    title: self.block.title.as_deref(),
                    background: theme::video_black(),
                    assets,
                    dark: self.dark,
                },
                cx.render.window,
                cx.render.app,
            )),
            _ => None,
        };
        let shown = match (&self.path, &player) {
            (Err(failure), _) => Shown::Failed(failure.clone()),
            (Ok(_), None) => Shown::Failed(AssetFailure::NotFound),
            (Ok(_), Some(p)) => {
                if let Some(failure) = p.failure() {
                    Shown::Failed(failure)
                } else if let Some((w, h)) = p.size.get() {
                    let natural = width * h / w;
                    let height = self.block.height.map_or(natural, |h| h as f32);
                    Shown::Playing(height.min(cap).max(1.))
                } else {
                    Shown::Loading
                }
            }
        };
        let height = match &shown {
            Shown::Loading => (width * 9. / 16.).max(MIN_HEIGHT),
            Shown::Playing(h) => h.max(MIN_HEIGHT),
            Shown::Failed(_) => MIN_HEIGHT,
        };
        let c = &self.chrome;
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
            Shown::Failed(ref failure) => {
                panel.child(self.render_fallback_card(failure, media_key, cx))
            }
            Shown::Playing(h) => {
                let player = player.clone();
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

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn oversized_and_missing_videos_surface_visible_fallback_reasons() {
        let oversized = describe_video_failure(
            "demo.mp4",
            &AssetFailure::ExceedsLimit {
                limit_bytes: 32 * 1024 * 1024,
            },
        );
        assert_eq!(oversized.title, "demo.mp4");
        assert!(
            oversized.reason.contains("32 MB"),
            "expected 32 MB limit in fallback reason, got {:?}",
            oversized.reason
        );
        assert!(oversized.retryable);

        let missing = describe_video_failure("missing.mp4", &AssetFailure::NotFound);
        assert!(
            missing.reason.contains("File not found"),
            "expected missing detail in fallback reason, got {:?}",
            missing.reason
        );
        assert!(missing.retryable);

        let blocked = describe_video_failure("../secret.mp4", &AssetFailure::Blocked);
        assert!(!blocked.reason.is_empty());
        assert!(!blocked.retryable);
    }
}
