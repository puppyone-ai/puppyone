//! Video embed model and workspace resolution (`markdownVideoModel.ts`, `MA-04`: zero `gpui`).
use crate::editor::{
    markdown::{
        platform::policy::AssetFailure,
        shared::media::{MediaSource, parse_video_size, resolve_embed_media},
    },
    navigation::ReferenceContext,
};
use std::{
    ops::Range,
    path::{Path, PathBuf},
};

/// Reveal the video embed's raw Markdown source line (`TA-52`).
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct ShowSource(pub Range<usize>);

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct VideoBlock {
    /// The embed's line.
    pub range: Range<usize>,
    /// The embed's target as written.
    pub href: String,
    /// The alias, unless it is a size.
    pub title: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

impl VideoBlock {
    /// `createMarkdownVideoModel` for an embed of `href` with `alias`.
    pub fn new(range: Range<usize>, href: String, alias: Option<&str>) -> Self {
        let parsed = alias.and_then(parse_video_size);
        Self {
            range,
            href,
            title: alias.filter(|_| parsed.is_none()).map(str::to_owned),
            width: parsed.map(|(w, _)| w),
            height: parsed.and_then(|(_, h)| h),
        }
    }

    /// `fallbackLabel`: what a video that cannot play says.
    pub fn label(&self) -> &str {
        self.title.as_deref().unwrap_or(&self.href)
    }
}

/// Resolves a video embed target strictly inside the active workspace.
pub fn resolve_workspace_video(
    document: &Path,
    href: &str,
    references: Option<&ReferenceContext>,
) -> Result<PathBuf, AssetFailure> {
    match resolve_embed_media(document, href, references) {
        Ok(MediaSource::Workspace(path)) => Ok(path),
        _ => Err(AssetFailure::Blocked),
    }
}
