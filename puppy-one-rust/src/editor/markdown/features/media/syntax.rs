//! Obsidian media embed syntax (`![[image]]`, `![[clip.mp4]]`), moved from
//! `core/syntax/lines.rs` per `MA-13` (product `features/media/obsidianMediaEmbed.ts`).
use crate::editor::markdown::{
    core::{
        links,
        syntax::{Element, Kind},
    },
    shared::token_scan,
};

/// An image file by its extension (`OBSIDIAN_IMAGE_EXTENSIONS`).
pub fn is_image_path(target: &str) -> bool {
    let path = target.split(['#', '?']).next().unwrap_or(target);
    path.rsplit_once('.').is_some_and(|(_, ext)| {
        matches!(
            ext.to_ascii_lowercase().as_str(),
            "avif" | "bmp" | "gif" | "jpeg" | "jpg" | "png" | "svg" | "webp"
        )
    })
}

/// A video file by its extension (`VIDEO_EXTENSIONS`: what the engine plays).
pub fn is_video_path(target: &str) -> bool {
    let path = target.split(['#', '?']).next().unwrap_or(target);
    path.rsplit_once('.').is_some_and(|(_, ext)| {
        matches!(
            ext.to_ascii_lowercase().as_str(),
            "3g2" | "3gp" | "3gpp" | "m4v" | "mov" | "mp4" | "ogv" | "qt" | "webm"
        )
    })
}

/// Recognize Obsidian `![[target|alias]]` image and video embeds on one
/// eligible line or table cell.
pub fn recognize_media_embeds(line_start: usize, line_text: &str, out: &mut Vec<Element>) {
    if !line_text.contains("![[") {
        return;
    }
    let bytes = line_text.as_bytes();
    for token in links::find_wiki_links(line_text) {
        if token.range.start == 0
            || bytes[token.range.start - 1] != b'!'
            || token_scan::is_escaped(bytes, token.range.start - 1)
        {
            continue;
        }
        let kind = if is_image_path(&token.target) {
            Some(Kind::ImageEmbed)
        } else if is_video_path(&token.target) {
            Some(Kind::VideoEmbed)
        } else {
            None
        };
        if let Some(kind) = kind {
            let from = line_start + token.range.start - 1;
            let to = line_start + token.range.end;
            let range = from..to;
            let mut e = Element::new(kind, range.clone(), vec![range], None);
            e.href = Some(token.target.clone());
            let inner = &line_text[token.range.start + 2..token.range.end - 2];
            e.text = inner
                .split_once('|')
                .map(|(_, alias)| alias.trim().to_owned());
            out.push(e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// `keeps image and video policy capabilities distinct`: an embed is an
    /// image or a video by its extension, never both.
    #[test]
    fn images_and_videos_are_distinct_kinds() {
        assert!(is_video_path("assets/clip.mp4") && !is_image_path("assets/clip.mp4"));
        assert!(is_image_path("assets/poster.png") && !is_video_path("assets/poster.png"));
    }
}
