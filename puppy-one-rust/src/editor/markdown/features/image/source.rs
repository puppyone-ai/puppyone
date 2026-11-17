//! Image media source facade (`TA-41`, `TA-51`, `TODO-30`, `TODO-36`):
//! delegates reference parsing and `O(1)` pre-decode `data:image/*` length
//! checks to [`crate::editor::markdown::shared::media_source`], mapping
//! rejections onto [`AssetFailure`] for visible fallback cards (`TA-52`).
pub use crate::editor::markdown::shared::media_source::{
    MediaSource as Source, MediaSourceError, workspace_path,
};

use crate::editor::{markdown::platform::policy::AssetFailure, navigation::ReferenceContext};
use std::path::Path;

fn map_error(err: MediaSourceError) -> AssetFailure {
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
pub fn markdown_checked(document: &Path, href: &str) -> Result<Source, AssetFailure> {
    crate::editor::markdown::shared::media_source::resolve_markdown_media(document, href)
        .map_err(map_error)
}

/// Evaluates an Obsidian `![[target]]` image embed reference, preserving the
/// specific policy failure reason (`TA-51`, `TA-52`).
pub fn embed_checked(
    document: &Path,
    target: &str,
    references: Option<&ReferenceContext>,
) -> Result<Source, AssetFailure> {
    crate::editor::markdown::shared::media_source::resolve_embed_media(document, target, references)
        .map_err(map_error)
}

/// Convenience wrapper returning `Some(Source)` when allowed by policy.
pub fn markdown(document: &Path, href: &str) -> Option<Source> {
    markdown_checked(document, href).ok()
}

/// Convenience wrapper for Obsidian `![[target]]` embeds.
pub fn embed(
    document: &Path,
    target: &str,
    references: Option<&ReferenceContext>,
) -> Option<Source> {
    embed_checked(document, target, references).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::markdown::shared::media_source::MAX_DATA_BYTES;
    use core::prelude::v1::test;
    use std::path::PathBuf;

    #[test]
    fn sources_follow_the_asset_policy() {
        let doc = Path::new("notes/day.md");
        let ws = |p: &str| Some(Source::Workspace(PathBuf::from(p)));
        assert_eq!(markdown(doc, "img/a%20b.png?x=1"), ws("notes/img/a b.png"));
        assert_eq!(markdown(doc, "../top.png"), ws("top.png"));
        assert_eq!(markdown(doc, "/assets/x.png"), ws("assets/x.png"));
        assert_eq!(markdown(doc, "../../out.png"), None);
        assert_eq!(markdown(doc, "http://x.test/a.png"), None);
        assert_eq!(markdown(doc, "file:///etc/a.png"), None);
        assert_eq!(
            markdown(doc, "https://x.test/a.png"),
            Some(Source::Remote("https://x.test/a.png".into()))
        );
        assert_eq!(
            markdown(doc, "data:image/png;base64,iVBO"),
            Some(Source::Data(vec![0x89, 0x50, 0x4e]))
        );
        assert_eq!(markdown(doc, "data:text/html,<b>"), None);
        assert_eq!(embed(doc, "pic.png", None), ws("notes/pic.png"));
        assert_eq!(embed(doc, "media/pic.png", None), ws("media/pic.png"));
    }

    #[test]
    fn oversized_data_image_url_returns_exceeds_limit_before_decode() {
        let doc = Path::new("notes/day.md");
        let huge = format!(
            "data:image/png;base64,{}",
            "!".repeat(MAX_DATA_BYTES * 4 / 3 + 128)
        );
        assert_eq!(
            markdown_checked(doc, &huge),
            Err(AssetFailure::ExceedsLimit {
                limit_bytes: MAX_DATA_BYTES as u64,
            })
        );
    }
}
