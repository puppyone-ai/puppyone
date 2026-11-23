//! Markdown image model, sizing geometry, and asset policy mapping
//! (`markdownImageModel.ts`, `markdownImageSize.ts`, `MA-04`: zero `gpui`).
use crate::editor::{
    markdown::{
        platform::policy::AssetFailure,
        shared::media::{
            MediaSource, MediaSourceError, resolve_embed_media, resolve_markdown_media,
        },
    },
    navigation::ReferenceContext,
};
use std::{ops::Range, path::Path};

/// `.cm-md-image-widget img { max-height: 320px }` (inline images).
pub const INLINE_MAX_HEIGHT: f32 = 320.;

/// Reveal an image line's source (double click / fallback Source action), the caret after `![`.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct ShowSource {
    pub line: Range<usize>,
    pub caret: usize,
}

/// One resolved image (or linked image) item on a line.
pub struct Item {
    /// The image's (or its link's) source.
    pub range: Range<usize>,
    /// What a placeholder says: the alt text, else the source.
    pub label: String,
    pub size: Option<(f32, Option<f32>)>,
    pub source: Result<MediaSource, AssetFailure>,
    pub link: Option<String>,
    /// The image's own source (inside its link, if linked).
    pub image: Range<usize>,
}

fn map_media_error(err: MediaSourceError) -> AssetFailure {
    match err {
        MediaSourceError::DataTooLarge { limit_bytes } => {
            AssetFailure::ExceedsLimit { limit_bytes }
        }
        MediaSourceError::Empty
        | MediaSourceError::Blocked
        | MediaSourceError::OutsideWorkspace => AssetFailure::Blocked,
    }
}

/// Evaluates a Markdown `![alt](href)` image reference, preserving the specific
/// policy/budget failure reason (`TA-51`, `TA-52`).
pub fn resolve_markdown(document: &Path, href: &str) -> Result<MediaSource, AssetFailure> {
    resolve_markdown_media(document, href).map_err(map_media_error)
}

/// Evaluates an Obsidian `![[target]]` image embed reference, preserving the
/// specific policy failure reason (`TA-51`, `TA-52`).
pub fn resolve_embed(
    document: &Path,
    target: &str,
    references: Option<&ReferenceContext>,
) -> Result<MediaSource, AssetFailure> {
    resolve_embed_media(document, target, references).map_err(map_media_error)
}

/// Width and height of an image of natural size `natural` in `available`:
/// its `alt|size`, an inline one at most 320px tall, within the column.
pub fn fit(
    size: Option<(f32, Option<f32>)>,
    block: bool,
    natural: (f32, f32),
    available: f32,
) -> (f32, f32) {
    let (nw, nh) = (natural.0.max(1.), natural.1.max(1.));
    let (mut w, mut h) = match size {
        Some((w, Some(h))) => (w, h),
        Some((w, None)) => (w, nh * w / nw),
        None => (nw, nh),
    };
    let auto_height = !matches!(size, Some((_, Some(_))));
    if !block && auto_height && h > INLINE_MAX_HEIGHT {
        w *= INLINE_MAX_HEIGHT / h;
        h = INLINE_MAX_HEIGHT;
    }
    if w > available {
        if auto_height {
            h *= available / w;
        }
        w = available;
    }
    (w, h)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::markdown::shared::media::MAX_DATA_BYTES;
    use core::prelude::v1::test;
    use std::path::PathBuf;

    #[test]
    fn sources_follow_the_asset_policy() {
        let doc = Path::new("notes/day.md");
        let ws = |p: &str| Some(MediaSource::Workspace(PathBuf::from(p)));
        assert_eq!(
            resolve_markdown(doc, "img/a%20b.png?x=1").ok(),
            ws("notes/img/a b.png")
        );
        assert_eq!(resolve_markdown(doc, "../top.png").ok(), ws("top.png"));
        assert_eq!(
            resolve_markdown(doc, "/assets/x.png").ok(),
            ws("assets/x.png")
        );
        assert_eq!(resolve_markdown(doc, "../../out.png").ok(), None);
        assert_eq!(resolve_markdown(doc, "http://x.test/a.png").ok(), None);
        assert_eq!(resolve_markdown(doc, "file:///etc/a.png").ok(), None);
        assert_eq!(
            resolve_markdown(doc, "https://x.test/a.png").ok(),
            Some(MediaSource::Remote("https://x.test/a.png".into()))
        );
        assert_eq!(
            resolve_markdown(doc, "data:image/png;base64,iVBO").ok(),
            Some(MediaSource::Data(vec![0x89, 0x50, 0x4e]))
        );
        assert_eq!(resolve_markdown(doc, "data:text/html,<b>").ok(), None);
        assert_eq!(
            resolve_embed(doc, "pic.png", None).ok(),
            ws("notes/pic.png")
        );
        assert_eq!(
            resolve_embed(doc, "media/pic.png", None).ok(),
            ws("media/pic.png")
        );
    }

    #[test]
    fn oversized_data_image_url_returns_exceeds_limit_before_decode() {
        let doc = Path::new("notes/day.md");
        let huge = format!(
            "data:image/png;base64,{}",
            "!".repeat(MAX_DATA_BYTES * 4 / 3 + 128)
        );
        assert_eq!(
            resolve_markdown(doc, &huge),
            Err(AssetFailure::ExceedsLimit {
                limit_bytes: MAX_DATA_BYTES as u64,
            })
        );
    }
}
