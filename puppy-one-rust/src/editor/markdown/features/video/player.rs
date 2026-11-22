//! Workspace media player facade (`TA-42`, `TODO-35`):
//! delegates `WebHost` creation, per-window LRU capacity pooling, `32 MiB`
//! workspace budget verification, and failure retry to
//! [`crate::editor::markdown::platform::embed`].
pub use crate::editor::markdown::platform::embed::{
    AUDIO_SIZE, MediaKey as Key, MediaPlayer as Player, media_page,
};
pub use crate::editor::markdown::shared::media::MediaKind as Media;

use crate::editor::{markdown::platform::embed, registry::DocumentAssets};
use gpui::{App, Rgba, Window};
use std::rc::Rc;

/// Media player request forwarded to [`embed::get_media_player`].
pub struct Request<'a> {
    pub key: Key,
    pub media: Media,
    pub title: Option<&'a str>,
    pub background: Rgba,
    pub assets: &'a DocumentAssets,
    pub dark: bool,
}

/// Acquires or creates a bounded per-window media player for `request.key`.
pub fn get(request: Request, window: &mut Window, cx: &mut App) -> Rc<Player> {
    embed::get_media_player(
        embed::MediaRequest {
            key: request.key,
            kind: request.media,
            title: request.title,
            background: request.background,
            assets: request.assets,
            dark: request.dark,
        },
        window,
        cx,
    )
}

/// Clears a failed media player slot so the next frame retries (`TA-52`).
pub fn retry(key: &Key, cx: &mut App) {
    embed::retry_media(key, cx);
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_page_plays_the_served_file_and_reports_back() {
        let html = media_page(
            Media::Video,
            "puppyone-preview://local/a%20b.mp4",
            Some("A \"clip\""),
            "BLACK",
        );
        assert!(html.contains(
            r#"<video controls preload="metadata" playsinline src="puppyone-preview://local/a%20b.mp4""#
        ));
        assert!(html.contains(r#"aria-label="A &quot;clip&quot;""#));
        assert!(html.contains("background:BLACK"));
        assert!(html.contains("video.videoWidth"));
        let audio = media_page(Media::Audio, "x.mp3", None, "BG");
        assert!(audio.contains(r#"<audio controls preload="metadata""#));
        assert!(audio.contains(r#"post("size:"+"300:54")"#));
    }
}
