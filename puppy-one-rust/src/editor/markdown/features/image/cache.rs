//! Markdown image asset access (`TA-42`, `TODO-33`, `TODO-91`):
//! delegates all bitmap decoding, bounded LRU caching (`64 MiB` / `256` entries),
//! file content-stamp invalidation, symlink containment checks, and DNS-pinned
//! HTTPS fetching to [`crate::editor::markdown::platform::brokers::assets`].
pub use crate::editor::markdown::platform::brokers::assets::AssetState as State;

use super::source::Source;
use crate::editor::{markdown::platform::brokers::assets, registry::DocumentAssets};
use gpui::App;

/// Queries or starts an async bounded load for `source` inside `assets`.
pub fn get(source: &Source, assets: Option<&DocumentAssets>, cx: &mut App) -> State {
    assets::get(source, assets, cx)
}

/// Clears a transient failure on `source` so the next render retries (`TA-52`).
pub fn retry(source: &Source, assets: Option<&DocumentAssets>, cx: &mut App) {
    assets::retry(source, assets, cx);
}
