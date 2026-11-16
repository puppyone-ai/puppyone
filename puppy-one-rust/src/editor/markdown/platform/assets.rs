//! `AssetBroker` (`TA-42`, `TA-50`, `TA-51`, `TODO-33`, `TODO-91`):
//! async, cancellable, bounded LRU cache (`64 MiB` decoded bitmap bytes, `256`
//! entries) keyed by `(workspace_id, canonical_path_or_url, content_stamp)`,
//! with workspace symlink/canonical containment verification, DNS-pinned HTTPS
//! remote fetching on a shared runtime, and retryable transient failures.
use super::policy::{
    self, AssetFailure, ContentStamp, MAX_REMOTE_IMAGE_BYTES, MAX_WORKSPACE_ASSET_BYTES,
};
use crate::editor::{markdown::shared::media_source::MediaSource, registry::DocumentAssets};
use gpui::{App, ImageFormat, RenderImage};
use std::{
    cell::RefCell,
    collections::HashMap,
    path::Path,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

/// Maximum decoded bitmap entries kept in `AssetBroker` (`TODO-91`).
pub const MAX_CACHE_ENTRIES: usize = 256;
/// Maximum total decoded bitmap bytes (`64 MiB`, `TODO-91`).
pub const MAX_CACHE_BYTES: usize = 64 * 1024 * 1024;
const REMOTE_TIMEOUT: Duration = Duration::from_secs(20);
/// SVG rasterises at Retina scale (`2.0x`).
const SVG_SCALE: f32 = 2.;

/// Cooperative cancellation token attached to each in-flight asset decode/fetch.
#[derive(Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

/// Composite cache key: `(workspace_id, canonical_path_or_url, content_stamp)`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct AssetKey {
    pub workspace_id: String,
    pub target: String,
    pub stamp: ContentStamp,
}

impl AssetKey {
    pub fn logical_id(&self) -> (&str, &str) {
        (&self.workspace_id, &self.target)
    }
}

/// Decoded asset state returned to Markdown widgets.
#[derive(Clone)]
pub enum AssetState<I = Arc<RenderImage>> {
    Loading,
    Ready { image: I, width: f32, height: f32 },
    Failed(AssetFailure),
}

struct Entry<I> {
    state: AssetState<I>,
    bytes: usize,
    used: u64,
    generation: u64,
    cancel: Option<CancelToken>,
}

/// Pure, deterministic LRU + cancellation + retry core of `AssetBroker`,
/// generic over bitmap handle `I` for fast unit testing (`TODO-33`, `TODO-91`).
pub struct BrokerCore<I> {
    entries: HashMap<AssetKey, Entry<I>>,
    revisions: HashMap<(String, String), u64>,
    clock: u64,
    next_generation: u64,
    max_entries: usize,
    max_bytes: usize,
    total_bytes: usize,
}

impl<I: Clone> Default for BrokerCore<I> {
    fn default() -> Self {
        Self::new(MAX_CACHE_ENTRIES, MAX_CACHE_BYTES)
    }
}

impl<I: Clone> BrokerCore<I> {
    pub fn new(max_entries: usize, max_bytes: usize) -> Self {
        Self {
            entries: HashMap::new(),
            revisions: HashMap::new(),
            clock: 0,
            next_generation: 0,
            max_entries: max_entries.max(1),
            max_bytes: max_bytes.max(1),
            total_bytes: 0,
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn total_bytes(&self) -> usize {
        self.total_bytes
    }

    /// Current synthetic revision for hosted/non-disk workspace targets.
    pub fn revision(&self, workspace_id: &str, target: &str) -> u64 {
        self.revisions
            .get(&(workspace_id.to_owned(), target.to_owned()))
            .copied()
            .unwrap_or(0)
    }

    /// Bumps the revision of `(workspace_id, target)` and evicts stale versions.
    pub fn bump_revision(&mut self, workspace_id: &str, target: &str) -> u64 {
        let pair = (workspace_id.to_owned(), target.to_owned());
        let next = self.revisions.get(&pair).copied().unwrap_or(0) + 1;
        self.revisions.insert(pair, next);
        self.purge_target(workspace_id, target, None);
        next
    }

    /// Looks up `key` (updating LRU recency) or starts a new cancellable load,
    /// returning `Err((generation, cancel_token))` only when the caller must
    /// spawn the background load (deduplicating concurrent `Loading` hits).
    pub fn get_or_begin(&mut self, key: AssetKey) -> Result<AssetState<I>, (u64, CancelToken)> {
        // Purge any older content-stamp entries for the same `(workspace_id, target)`.
        self.purge_target(&key.workspace_id, &key.target, Some(&key.stamp));
        self.clock += 1;
        let now = self.clock;
        if let Some(entry) = self.entries.get_mut(&key) {
            if !matches!(entry.state, AssetState::Loading) {
                entry.used = now;
            }
            return Ok(entry.state.clone());
        }
        self.next_generation += 1;
        let generation = self.next_generation;
        let token = CancelToken::new();
        self.entries.insert(
            key,
            Entry {
                state: AssetState::Loading,
                bytes: 0,
                used: u64::MAX,
                generation,
                cancel: Some(token.clone()),
            },
        );
        Err((generation, token))
    }

    /// Completes an in-flight load if `generation` is still current and uncancelled.
    pub fn settle(
        &mut self,
        key: AssetKey,
        generation: u64,
        result: Result<(I, f32, f32, usize), AssetFailure>,
    ) -> bool {
        let current = self.entries.get(&key);
        if current.is_none_or(|e| {
            e.generation != generation || e.cancel.as_ref().is_some_and(CancelToken::is_cancelled)
        }) {
            return false;
        }
        if let Some(old) = self.entries.remove(&key) {
            self.total_bytes = self.total_bytes.saturating_sub(old.bytes);
        }
        self.clock += 1;
        let used = self.clock;
        match result {
            Ok((image, width, height, bytes)) => {
                if bytes > self.max_bytes {
                    self.entries.insert(
                        key,
                        Entry {
                            state: AssetState::Failed(AssetFailure::ExceedsLimit {
                                limit_bytes: self.max_bytes as u64,
                            }),
                            bytes: 0,
                            used,
                            generation,
                            cancel: None,
                        },
                    );
                } else {
                    self.total_bytes += bytes;
                    self.entries.insert(
                        key,
                        Entry {
                            state: AssetState::Ready {
                                image,
                                width,
                                height,
                            },
                            bytes,
                            used,
                            generation,
                            cancel: None,
                        },
                    );
                }
            }
            Err(failure) => {
                self.entries.insert(
                    key,
                    Entry {
                        state: AssetState::Failed(failure),
                        bytes: 0,
                        used,
                        generation,
                        cancel: None,
                    },
                );
            }
        }
        self.evict_lru();
        true
    }

    /// Cancels an active or failed entry for `(workspace_id, target)` so the
    /// next render retries loading cleanly (`TODO-33`).
    pub fn retry(&mut self, workspace_id: &str, target: &str) {
        self.purge_target(workspace_id, target, None);
    }

    /// Cancels a specific `AssetKey` if currently loading or cached.
    pub fn cancel(&mut self, key: &AssetKey) {
        if let Some(removed) = self.entries.remove(key) {
            if let Some(cancel) = removed.cancel {
                cancel.cancel();
            }
            self.total_bytes = self.total_bytes.saturating_sub(removed.bytes);
        }
    }

    fn purge_target(
        &mut self,
        workspace_id: &str,
        target: &str,
        keep_stamp: Option<&ContentStamp>,
    ) {
        let stale: Vec<AssetKey> = self
            .entries
            .keys()
            .filter(|k| {
                k.workspace_id == workspace_id
                    && k.target == target
                    && keep_stamp.is_none_or(|s| &k.stamp != s)
            })
            .cloned()
            .collect();
        for k in stale {
            self.cancel(&k);
        }
    }

    fn evict_lru(&mut self) {
        while self.entries.len() > self.max_entries || self.total_bytes > self.max_bytes {
            let Some(oldest) = self
                .entries
                .iter()
                .filter(|(_, e)| !matches!(e.state, AssetState::Loading))
                .min_by_key(|(_, e)| e.used)
                .map(|(k, _)| k.clone())
            else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.total_bytes = self.total_bytes.saturating_sub(removed.bytes);
            }
        }
    }
}

thread_local! {
    static BROKER: RefCell<BrokerCore<Arc<RenderImage>>> = RefCell::new(BrokerCore::default());
}

pub(super) fn shared_runtime() -> Option<&'static tokio::runtime::Runtime> {
    static RUNTIME: OnceLock<Option<tokio::runtime::Runtime>> = OnceLock::new();
    RUNTIME
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .thread_name("po-md-asset")
                .enable_all()
                .build()
                .ok()
        })
        .as_ref()
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
            let rev = BROKER.with(|b| b.borrow().revision(&assets.workspace, &target));
            Ok(AssetKey {
                workspace_id: assets.workspace.clone(),
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
            MediaSource::Remote(url) => fetch_remote(url, &cancel_bg)?,
            MediaSource::Data(bytes) => bytes.clone(),
        };
        if cancel_bg.is_cancelled() {
            return Err(AssetFailure::Network("Cancelled".into()));
        }
        decode_bitmap(bytes, &svg).ok_or(AssetFailure::InvalidFormat)
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
                        b.borrow_mut().bump_revision(&assets.workspace, &target);
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

fn sniff_format(bytes: &[u8]) -> Option<ImageFormat> {
    let head = &bytes[..bytes.len().min(512)];
    Some(match head {
        [0x89, b'P', b'N', b'G', ..] => ImageFormat::Png,
        [0xff, 0xd8, 0xff, ..] => ImageFormat::Jpeg,
        [b'G', b'I', b'F', b'8', ..] => ImageFormat::Gif,
        [
            b'R',
            b'I',
            b'F',
            b'F',
            _,
            _,
            _,
            _,
            b'W',
            b'E',
            b'B',
            b'P',
            ..,
        ] => ImageFormat::Webp,
        [b'B', b'M', ..] => ImageFormat::Bmp,
        [0, 0, 1, 0, ..] => ImageFormat::Ico,
        [b'I', b'I', 42, 0, ..] | [b'M', b'M', 0, 42, ..] => ImageFormat::Tiff,
        _ if String::from_utf8_lossy(head).contains("<svg") => ImageFormat::Svg,
        _ => return None,
    })
}

fn decode_bitmap(
    bytes: Vec<u8>,
    svg: &gpui::SvgRenderer,
) -> Option<(Arc<RenderImage>, f32, f32, usize)> {
    let format = sniff_format(&bytes)?;
    if format == ImageFormat::Svg {
        let image = svg.render_single_frame(&bytes, SVG_SCALE).ok()?;
        let size = image.size(0);
        let decoded_bytes = (size.width.0.max(1) as usize) * (size.height.0.max(1) as usize) * 4;
        return Some((
            image,
            size.width.0 as f32 / SVG_SCALE,
            size.height.0 as f32 / SVG_SCALE,
            decoded_bytes,
        ));
    }
    let image = gpui::Image::from_bytes(format, bytes)
        .to_image_data(svg.clone())
        .ok()?;
    let size = image.size(0);
    let decoded_bytes = (size.width.0.max(1) as usize) * (size.height.0.max(1) as usize) * 4;
    Some((
        image,
        size.width.0 as f32,
        size.height.0 as f32,
        decoded_bytes,
    ))
}

fn fetch_remote(url: &str, cancel: &CancelToken) -> Result<Vec<u8>, AssetFailure> {
    let endpoint = policy::resolve_public_endpoint(url).map_err(AssetFailure::Network)?;
    let client = policy::build_pinned_https_client(&endpoint, REMOTE_TIMEOUT, false)
        .map_err(AssetFailure::Network)?;
    let runtime =
        shared_runtime().ok_or_else(|| AssetFailure::Network("Runtime unavailable".into()))?;
    runtime.block_on(async {
        let mut response = client
            .get(endpoint.url.as_str())
            .send()
            .await
            .map_err(|e| AssetFailure::Network(e.to_string().into()))?;
        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AssetFailure::NotFound);
        }
        if !status.is_success() {
            return Err(AssetFailure::Network(
                format!("HTTP {}", status.as_u16()).into(),
            ));
        }
        if let Some(len) = response.content_length()
            && len > MAX_REMOTE_IMAGE_BYTES as u64
        {
            return Err(AssetFailure::ExceedsLimit {
                limit_bytes: MAX_REMOTE_IMAGE_BYTES as u64,
            });
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| AssetFailure::Network(e.to_string().into()))?
        {
            if cancel.is_cancelled() {
                return Err(AssetFailure::Network("Cancelled".into()));
            }
            if body.len().saturating_add(chunk.len()) > MAX_REMOTE_IMAGE_BYTES {
                return Err(AssetFailure::ExceedsLimit {
                    limit_bytes: MAX_REMOTE_IMAGE_BYTES as u64,
                });
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn file_key(name: &str, len: u64, modified_ns: u128) -> AssetKey {
        AssetKey {
            workspace_id: "ws-1".into(),
            target: name.into(),
            stamp: ContentStamp::File { len, modified_ns },
        }
    }

    #[test]
    fn lru_evicts_oldest_by_entry_cap_and_decoded_byte_budget() {
        // Entry cap eviction (`max_entries = 3`).
        let mut by_count: BrokerCore<&'static str> = BrokerCore::new(3, 1024);
        for (i, label) in [(1, "a"), (2, "b"), (3, "c")] {
            let k = file_key(label, i, 1);
            let (g, _) = by_count.get_or_begin(k.clone()).err().unwrap();
            assert!(by_count.settle(k, g, Ok((label, 10., 10., 100))));
        }
        // Touch "a" so "b" becomes least recently used.
        assert!(matches!(
            by_count.get_or_begin(file_key("a", 1, 1)),
            Ok(AssetState::Ready { image: "a", .. })
        ));
        let k_d = file_key("d", 4, 1);
        let (gen_d, _) = by_count.get_or_begin(k_d.clone()).err().unwrap();
        by_count.settle(k_d, gen_d, Ok(("d", 10., 10., 100)));
        assert_eq!(by_count.len(), 3);
        assert!(
            by_count.get_or_begin(file_key("b", 2, 1)).is_err(),
            "b evicted"
        );
        assert!(matches!(
            by_count.get_or_begin(file_key("a", 1, 1)),
            Ok(AssetState::Ready { image: "a", .. })
        ));

        // Byte budget eviction (`max_bytes = 250`).
        let mut by_bytes: BrokerCore<&'static str> = BrokerCore::new(16, 250);
        for (name, bytes) in [("img1", 120usize), ("img2", 120), ("img3", 120)] {
            let k = file_key(name, bytes as u64, 1);
            let (g, _) = by_bytes.get_or_begin(k.clone()).err().unwrap();
            by_bytes.settle(k, g, Ok((name, 10., 10., bytes)));
        }
        assert!(by_bytes.total_bytes() <= 250);
        assert_eq!(by_bytes.len(), 2);
        assert!(by_bytes.get_or_begin(file_key("img1", 120, 1)).is_err());
    }

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

    #[test]
    fn transient_failure_is_retryable_and_in_flight_cancels_cleanly() {
        let mut broker: BrokerCore<&'static str> = BrokerCore::new(16, 4096);
        let key = AssetKey {
            workspace_id: String::new(),
            target: "https://cdn.example.com/pic.png".into(),
            stamp: ContentStamp::Immutable,
        };
        let (gen1, token1) = broker.get_or_begin(key.clone()).err().unwrap();
        // Concurrent request for the same key deduplicates onto `Loading`.
        assert!(matches!(
            broker.get_or_begin(key.clone()),
            Ok(AssetState::Loading)
        ));
        assert!(!token1.is_cancelled());

        // Settle transient failure.
        broker.settle(
            key.clone(),
            gen1,
            Err(AssetFailure::Network("timeout".into())),
        );
        assert!(matches!(
            broker.get_or_begin(key.clone()),
            Ok(AssetState::Failed(AssetFailure::Network(_)))
        ));

        // Explicit retry clears the failed entry so the next request succeeds!
        broker.retry("", "https://cdn.example.com/pic.png");
        let (gen2, token2) = broker
            .get_or_begin(key.clone())
            .err()
            .expect("retry must allow re-fetching");

        // If cancelled mid-flight, stale settle is ignored.
        broker.cancel(&key);
        assert!(token2.is_cancelled());
        assert!(!broker.settle(key.clone(), gen2, Ok(("late", 10., 10., 40))));

        // Subsequent attempt settles Ready cleanly.
        let (gen3, _) = broker.get_or_begin(key.clone()).err().unwrap();
        assert!(broker.settle(key.clone(), gen3, Ok(("recovered", 20., 20., 80))));
        assert!(matches!(
            broker.get_or_begin(key),
            Ok(AssetState::Ready {
                image: "recovered",
                ..
            })
        ));
    }
}
