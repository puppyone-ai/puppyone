//! `AssetBroker` (`platform/brokers/assets/`, `TA-42`, `TA-50`, `TA-51`,
//! `TODO-33`, `TODO-91`): async, cancellable, bounded LRU cache (`64 MiB`
//! decoded bitmap bytes, `256` entries) keyed by `(workspace_id,
//! canonical_path_or_url, content_stamp)`.
pub mod cache;
pub mod decode;
pub mod fetch;

pub use cache::{
    AssetKey, AssetState, BrokerCore, CancelToken, MAX_CACHE_BYTES, MAX_CACHE_ENTRIES,
};
#[cfg(test)]
pub(crate) use decode::decode_svg_bitmap;
pub(in crate::editor::markdown::platform::brokers) use fetch::shared_runtime;

use crate::editor::{
    markdown::{
        platform::policy::{self, AssetFailure, ContentStamp, MAX_WORKSPACE_ASSET_BYTES},
        shared::media::MediaSource,
    },
    registry::DocumentAssets,
};
use gpui::{App, RenderImage};
use std::{cell::RefCell, path::Path, sync::Arc};

thread_local! {
    static BROKER: RefCell<BrokerCore<Arc<RenderImage>>> = RefCell::new(BrokerCore::default());
}

/// Resolves the [`AssetKey`] of `source` under `assets`, verifying local
/// workspace symlink/canonical containment and reading filesystem content stamps
/// so modified local files invalidate stale cached bitmaps (`TA-50`, `TA-51`).
pub fn resolve_key(
    source: &MediaSource,
    assets: Option<&DocumentAssets>,
) -> Result<AssetKey, AssetFailure> {
    match source {
        MediaSource::Workspace(path) => {
            let Some(assets) = assets else {
                return Err(AssetFailure::Blocked);
            };
            if let Some(root) = policy::local_workspace_root(&assets.workspace) {
                let (canon, stamp) =
                    policy::verify_workspace_file(&root, path, MAX_WORKSPACE_ASSET_BYTES)?;
                return Ok(AssetKey {
                    workspace_id: assets.workspace.clone(),
                    target: canon.to_string_lossy().into_owned(),
                    stamp,
                });
            }
            let target = path.to_string_lossy().into_owned();
            let workspace_id = assets.workspace_identity();
            let rev = BROKER.with(|b| b.borrow().revision(&workspace_id, &target));
            Ok(AssetKey {
                workspace_id: workspace_id.into_owned(),
                target,
                stamp: ContentStamp::Revision(rev),
            })
        }
        MediaSource::Remote(url) => {
            let canonical = policy::allowed_https_href(url).ok_or(AssetFailure::Blocked)?;
            Ok(AssetKey {
                workspace_id: String::new(),
                target: canonical,
                stamp: ContentStamp::Immutable,
            })
        }
        MediaSource::Data(bytes) => Ok(AssetKey {
            workspace_id: String::new(),
            target: format!("data:{}", blake3::hash(bytes).to_hex()),
            stamp: ContentStamp::File {
                len: bytes.len() as u64,
                modified_ns: 0,
            },
        }),
    }
}

/// Probes a workspace video/audio file against symlink containment and the
/// `32 MiB` Markdown asset budget (`TA-51`, `TA-52`).
pub fn probe_workspace_media(
    path: &Path,
    assets: Option<&DocumentAssets>,
) -> Result<(), AssetFailure> {
    let Some(assets) = assets else {
        return Err(AssetFailure::Blocked);
    };
    if let Some(root) = policy::local_workspace_root(&assets.workspace) {
        policy::verify_workspace_file(&root, path, MAX_WORKSPACE_ASSET_BYTES)?;
        return Ok(());
    }
    Ok(())
}

/// Requests decoded bitmap `source` through `AssetBroker`.
pub fn get(
    source: &MediaSource,
    assets: Option<&DocumentAssets>,
    cx: &mut App,
) -> AssetState<Arc<RenderImage>> {
    let key = match resolve_key(source, assets) {
        Ok(key) => key,
        Err(failure) => return AssetState::Failed(failure),
    };
    let begin = BROKER.with(|b| b.borrow_mut().get_or_begin(key.clone()));
    let (generation, cancel) = match begin {
        Ok(state) => return state,
        Err(pair) => pair,
    };
    let source = source.clone();
    let read = assets.map(|a| a.read.clone());
    let workspace_id = assets.map(|a| a.workspace.clone()).unwrap_or_default();
    let svg = cx.svg_renderer();
    let cancel_bg = cancel.clone();
    let task = cx.background_executor().spawn(async move {
        if cancel_bg.is_cancelled() {
            return Err(AssetFailure::Network("Cancelled".into()));
        }
        let bytes = match &source {
            MediaSource::Workspace(path) => {
                if let Some(root) = policy::local_workspace_root(&workspace_id) {
                    policy::verify_workspace_file(&root, path, MAX_WORKSPACE_ASSET_BYTES)?;
                }
                let Some(read) = read else {
                    return Err(AssetFailure::Blocked);
                };
                match read(path) {
                    Some(bytes) if bytes.len() as u64 <= MAX_WORKSPACE_ASSET_BYTES => bytes,
                    Some(_) => {
                        return Err(AssetFailure::ExceedsLimit {
                            limit_bytes: MAX_WORKSPACE_ASSET_BYTES,
                        });
                    }
                    None => return Err(AssetFailure::NotFound),
                }
            }
            MediaSource::Remote(url) => fetch::fetch_remote(url, &cancel_bg)?,
            MediaSource::Data(bytes) => bytes.clone(),
        };
        if cancel_bg.is_cancelled() {
            return Err(AssetFailure::Network("Cancelled".into()));
        }
        decode::decode_bitmap(bytes, &svg).ok_or(AssetFailure::InvalidFormat)
    });
    cx.spawn(async move |cx| {
        let outcome = task.await;
        if cancel.is_cancelled() {
            return;
        }
        let settled = BROKER.with(|b| b.borrow_mut().settle(key, generation, outcome));
        if settled {
            cx.update(|cx| cx.refresh_windows());
        }
    })
    .detach();
    AssetState::Loading
}

/// Clears any failed/cached entry for `(source, assets)` so the next frame retries (`TODO-33`).
pub fn retry(source: &MediaSource, assets: Option<&DocumentAssets>, cx: &mut App) {
    match source {
        MediaSource::Workspace(path) => {
            if let Some(assets) = assets {
                if let Some(root) = policy::local_workspace_root(&assets.workspace)
                    && let Ok((canon, _)) = policy::verify_workspace_file(&root, path, u64::MAX)
                {
                    let target = canon.to_string_lossy().into_owned();
                    BROKER.with(|b| b.borrow_mut().retry(&assets.workspace, &target));
                } else {
                    let target = path.to_string_lossy().into_owned();
                    BROKER.with(|b| {
                        b.borrow_mut()
                            .bump_revision(&assets.workspace_identity(), &target);
                    });
                }
            }
        }
        MediaSource::Remote(url) => {
            if let Some(canonical) = policy::allowed_https_href(url) {
                BROKER.with(|b| b.borrow_mut().retry("", &canonical));
            }
        }
        MediaSource::Data(bytes) => {
            let target = format!("data:{}", blake3::hash(bytes).to_hex());
            BROKER.with(|b| b.borrow_mut().retry("", &target));
        }
    }
    cx.refresh_windows();
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn modified_local_file_invalidates_stale_cached_bitmap() {
        let dir = tempfile::tempdir().unwrap();
        let img_path = dir.path().join("diagram.png");
        std::fs::write(&img_path, b"v1").unwrap();
        let assets = DocumentAssets {
            workspace: url::Url::from_directory_path(dir.path())
                .unwrap()
                .to_string(),
            document: "notes/readme.md".into(),
            read: Arc::new(|_| None),
        };
        let source = MediaSource::Workspace("diagram.png".into());

        let mut broker: BrokerCore<&'static str> = BrokerCore::new(16, 4096);
        let key_v1 = resolve_key(&source, Some(&assets)).unwrap();
        let (gen_v1, _) = broker.get_or_begin(key_v1.clone()).err().unwrap();
        broker.settle(key_v1.clone(), gen_v1, Ok(("bitmap-v1", 32., 32., 64)));
        assert!(matches!(
            broker.get_or_begin(key_v1.clone()),
            Ok(AssetState::Ready {
                image: "bitmap-v1",
                ..
            })
        ));

        // Modify the local file on disk (changing size / content stamp).
        std::fs::write(&img_path, b"version-2-updated-bytes").unwrap();
        let key_v2 = resolve_key(&source, Some(&assets)).unwrap();
        assert_ne!(key_v1, key_v2, "file content stamp must change on edit");

        // Requesting `key_v2` misses cache AND purges stale `key_v1`!
        let (gen_v2, _) = broker
            .get_or_begin(key_v2.clone())
            .err()
            .expect("modified file must trigger fresh decode");
        assert_eq!(broker.total_bytes(), 0, "stale v1 bitmap bytes freed");
        broker.settle(key_v2.clone(), gen_v2, Ok(("bitmap-v2", 64., 64., 128)));
        assert!(matches!(
            broker.get_or_begin(key_v2),
            Ok(AssetState::Ready {
                image: "bitmap-v2",
                ..
            })
        ));
    }
}
