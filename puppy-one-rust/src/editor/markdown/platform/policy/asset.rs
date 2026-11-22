//! Markdown asset size limits, `data:` URL validation, and workspace
//! filesystem containment policy (`platform/policy/asset.rs`, `TA-51`, `TA-52`).
use crate::{
    editor::{
        markdown::shared::media::{
            self, MAX_DATA_BYTES, MAX_DATA_ENCODED_LEN, MediaSource, MediaSourceError,
        },
        registry::format_byte_limit,
    },
    localization::{t, tf},
};
use gpui::SharedString;
use std::{
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

pub use media::{
    MAX_DATA_BYTES as DATA_URL_MAX_BYTES, MAX_DATA_ENCODED_LEN as DATA_URL_MAX_ENCODED_LEN,
};

/// Workspace media byte budget (`MARKDOWN_ASSET_MAX_BYTES`, `32 MiB`).
pub const MAX_WORKSPACE_ASSET_BYTES: u64 = 32 * 1024 * 1024;
/// Remote `https:` image response budget (`32 MiB`).
pub const MAX_REMOTE_IMAGE_BYTES: usize = 32 * 1024 * 1024;

/// Structured failure classification for Markdown assets and media (`TA-52`).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum AssetFailure {
    NotFound,
    ExceedsLimit { limit_bytes: u64 },
    Blocked,
    Network(SharedString),
    InvalidFormat,
}

impl AssetFailure {
    pub fn from_source_error(err: MediaSourceError) -> Self {
        match err {
            MediaSourceError::DataTooLarge { limit_bytes } => Self::ExceedsLimit { limit_bytes },
            MediaSourceError::Empty
            | MediaSourceError::Blocked
            | MediaSourceError::OutsideWorkspace => Self::Blocked,
        }
    }

    /// Whether a user-triggered retry should re-attempt loading the resource.
    pub fn is_retryable(&self) -> bool {
        !matches!(self, Self::Blocked)
    }

    /// Concise, user-visible explanation of why the asset/media could not render (`TA-52`).
    pub fn user_reason(&self, kind_key: &'static str) -> String {
        let kind = t(kind_key);
        match self {
            Self::ExceedsLimit { limit_bytes } => tf(
                "editor.unavailable.resourceLimit",
                &[("limit", format_byte_limit(*limit_bytes).into())],
            ),
            Self::NotFound => tf(
                "editor.resource.loadFailed",
                &[("kind", kind.into()), ("detail", "File not found".into())],
            ),
            Self::Blocked => tf("editor.resource.unavailable", &[("kind", kind.into())]),
            Self::Network(detail) => tf(
                "editor.resource.loadFailed",
                &[
                    ("kind", kind.into()),
                    (
                        "detail",
                        if detail.is_empty() {
                            "Network error".into()
                        } else {
                            crate::localization::bidi_isolate(detail).into()
                        },
                    ),
                ],
            ),
            Self::InvalidFormat => tf(
                "editor.resource.loadFailed",
                &[
                    ("kind", kind.into()),
                    ("detail", "Unsupported or corrupted format".into()),
                ],
            ),
        }
    }
}

/// Content version stamp used by `AssetBroker` to invalidate stale bitmaps when
/// local files change on disk (`TODO-33`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ContentStamp {
    File { len: u64, modified_ns: u128 },
    Revision(u64),
    Immutable,
}

/// Validates and decodes a `data:image/*` URL (`<= 2 MiB`), rejecting oversized
/// encoded strings in $O(1)$ before Base64/percent decoding (`TA-51`).
pub fn validate_data_image_url(href: &str) -> Result<Vec<u8>, AssetFailure> {
    debug_assert_eq!(MAX_DATA_ENCODED_LEN, MAX_DATA_BYTES * 4 / 3 + 64);
    media::decode_raster_data_url(href).map_err(AssetFailure::from_source_error)
}

/// Resolves a Markdown image `href` against policy rules.
pub fn resolve_image_reference(document: &Path, href: &str) -> Result<MediaSource, AssetFailure> {
    media::resolve_markdown_media(document, href).map_err(AssetFailure::from_source_error)
}

/// Extracts a local filesystem root directory from `DocumentAssets.workspace`
/// when backed by a local `file://` grant or local directory path.
pub fn local_workspace_root(workspace_id: &str) -> Option<PathBuf> {
    if workspace_id.is_empty() {
        return None;
    }
    if let Ok(url) = url::Url::parse(workspace_id)
        && url.scheme() == "file"
        && let Ok(path) = url.to_file_path()
        && path.is_dir()
    {
        return Some(path);
    }
    let candidate = Path::new(workspace_id);
    (candidate.is_absolute() && candidate.is_dir()).then(|| candidate.to_path_buf())
}

/// Verifies that `relative` stays strictly inside `workspace_root` without
/// traversing symlinks (`TA-51`), exists as a regular file within `max_bytes`,
/// and returns its canonical path and [`ContentStamp`].
pub fn verify_workspace_file(
    workspace_root: &Path,
    relative: &Path,
    max_bytes: u64,
) -> Result<(PathBuf, ContentStamp), AssetFailure> {
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(AssetFailure::Blocked);
    }
    let canon_root = workspace_root
        .canonicalize()
        .map_err(|_| AssetFailure::NotFound)?;
    let mut cursor = workspace_root.to_path_buf();
    for component in relative.components() {
        cursor.push(component);
        let meta = std::fs::symlink_metadata(&cursor).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AssetFailure::NotFound
            } else {
                AssetFailure::Blocked
            }
        })?;
        if meta.file_type().is_symlink() {
            return Err(AssetFailure::Blocked);
        }
    }
    let canon_file = cursor.canonicalize().map_err(|_| AssetFailure::Blocked)?;
    if !canon_file.starts_with(&canon_root) {
        return Err(AssetFailure::Blocked);
    }
    let meta = std::fs::symlink_metadata(&canon_file).map_err(|_| AssetFailure::NotFound)?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(AssetFailure::Blocked);
    }
    if meta.len() > max_bytes {
        return Err(AssetFailure::ExceedsLimit {
            limit_bytes: max_bytes,
        });
    }
    let modified_ns = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    Ok((
        canon_file,
        ContentStamp::File {
            len: meta.len(),
            modified_ns,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn oversized_data_image_url_is_rejected_before_decode() {
        let payload = "A".repeat(MAX_DATA_ENCODED_LEN + 8);
        let href = format!("data:image/png;base64,{payload}");
        assert_eq!(
            validate_data_image_url(&href),
            Err(AssetFailure::ExceedsLimit {
                limit_bytes: MAX_DATA_BYTES as u64,
            })
        );
    }

    #[test]
    fn workspace_containment_refuses_escaping_symlinks_and_oversized_files() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(ws.path().join("ok.png"), b"1234").unwrap();
        std::fs::write(outside.path().join("secret.png"), b"secret").unwrap();

        let (_, stamp) =
            verify_workspace_file(ws.path(), Path::new("ok.png"), 1024).expect("valid file");
        assert!(matches!(stamp, ContentStamp::File { len: 4, .. }));

        assert_eq!(
            verify_workspace_file(ws.path(), Path::new("ok.png"), 2),
            Err(AssetFailure::ExceedsLimit { limit_bytes: 2 })
        );
        assert_eq!(
            verify_workspace_file(ws.path(), Path::new("missing.png"), 1024),
            Err(AssetFailure::NotFound)
        );
        assert_eq!(
            verify_workspace_file(ws.path(), Path::new("../secret.png"), 1024),
            Err(AssetFailure::Blocked)
        );

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                outside.path().join("secret.png"),
                ws.path().join("escape.png"),
            )
            .unwrap();
            assert_eq!(
                verify_workspace_file(ws.path(), Path::new("escape.png"), 1024),
                Err(AssetFailure::Blocked)
            );
        }
    }
}
