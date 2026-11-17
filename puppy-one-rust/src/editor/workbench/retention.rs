//! Workbench live-instance and background-project LRU retention (`WB-01`,
//! `WB-02`, `WB-30`).
//!
//! Open document references (`Catalog`) are cheap; live editor instances
//! (`Documents`, `DocumentEditor`, WebViews) and background project `Host`s are
//! bounded. Any slot or project with unsaved input, in-flight I/O, active IME
//! composition, held resource operations, unflushable drafts or Cloud conflicts
//! is strictly pinned and never evicted.

use crate::editor::document_session::models::DocumentModels;
use std::path::PathBuf;

/// Default maximum live `Slot`s retained per workspace (`WB-01`).
pub const MAX_LIVE_SLOTS: usize = 16;

/// Default maximum clean background project `Host`s retained per window (`WB-02`).
pub const MAX_BACKGROUND_HOSTS: usize = 3;

/// Metadata retained for a hibernated clean tab (`WB-01`) so it can re-hydrate
/// through the workspace Provider on re-activation without holding a live
/// `WorkingCopy` or `DocumentEditor`. The document is still open: its
/// retained models (undo history) wait here for its next view.
#[derive(Debug)]
pub struct HibernatedSlot {
    pub path: PathBuf,
    pub failed_at_navigation: Option<u64>,
    pub models: DocumentModels,
}

/// Snapshot of a live slot evaluated by the retention policy (`WB-01`).
#[derive(Clone, Debug)]
pub struct SlotCandidate {
    pub id: u64,
    pub key: String,
    pub visible: bool,
    pub admitted: bool,
    pub closing: bool,
    pub restoring: bool,
    pub dirty: bool,
    pub saving_or_busy: bool,
    pub cloud_conflict: bool,
    pub unflushable_draft: bool,
    pub owned_by_mutation: bool,
    pub composing: bool,
    /// The undo history lives only in the open page and would die with it.
    pub page_history: bool,
}

impl SlotCandidate {
    /// Returns `true` if this slot MUST stay live and cannot be hibernated (`WB-01`).
    pub fn is_pinned(&self) -> bool {
        self.visible
            || !self.admitted
            || self.closing
            || self.restoring
            || self.dirty
            || self.saving_or_busy
            || self.cloud_conflict
            || self.unflushable_draft
            || self.owned_by_mutation
            || self.composing
            || self.page_history
    }
}

/// Selects clean hidden slots to hibernate so total live slots stay `<= max_live_slots`
/// whenever possible without touching pinned slots (`WB-01`).
///
/// `mru` is ordered most-recently-used first (`Catalog::mru` convention: index `0`
/// is most recent). Returned `SlotId`s are ordered oldest-first.
pub fn select_slots_to_hibernate(
    candidates: &[SlotCandidate],
    mru: &[String],
    max_live_slots: usize,
) -> Vec<u64> {
    let cap = max_live_slots.max(1);
    let live_count = candidates
        .iter()
        .filter(|c| c.admitted && !c.closing && !c.restoring)
        .count();
    if live_count <= cap {
        return Vec::new();
    }
    let excess = live_count - cap;
    let mut evictable: Vec<&SlotCandidate> = candidates.iter().filter(|c| !c.is_pinned()).collect();

    // Rank: items absent from `mru` are oldest (`group = 1`), otherwise higher
    // `mru` index is older (`group = 0, pos`). Sort oldest-first.
    let mru_rank = |c: &SlotCandidate| -> (u8, usize) {
        match mru.iter().position(|k| k == &c.key) {
            Some(pos) => (0, pos),
            None => (1, usize::MAX),
        }
    };
    evictable.sort_by(|a, b| {
        let ra = mru_rank(a);
        let rb = mru_rank(b);
        rb.cmp(&ra).then_with(|| a.id.cmp(&b.id))
    });

    evictable.into_iter().take(excess).map(|c| c.id).collect()
}

/// Snapshot of a project `Host` evaluated by the background-host cap (`WB-02`).
#[derive(Clone, Debug)]
pub struct BackgroundHostCandidate {
    pub key: String,
    pub active: bool,
    pub restoring_or_loading_metadata: bool,
    pub has_unsaved_or_busy_slots: bool,
    pub has_pending_mutations: bool,
}

impl BackgroundHostCandidate {
    /// Returns `true` if this host is a clean, idle background project eligible
    /// for unload (`WB-02`).
    pub fn can_unload(&self) -> bool {
        !self.active
            && !self.restoring_or_loading_metadata
            && !self.has_unsaved_or_busy_slots
            && !self.has_pending_mutations
    }
}

/// Selects clean background project keys to unload when the total number of
/// background hosts exceeds `max_background_hosts` (`WB-02`).
///
/// `host_mru` is ordered most-recently-active first (`0` is most recent).
/// Returned workspace keys are ordered oldest-first.
pub fn select_background_hosts_to_unload(
    candidates: &[BackgroundHostCandidate],
    host_mru: &[String],
    max_background_hosts: usize,
) -> Vec<String> {
    let bg_count = candidates.iter().filter(|c| !c.active).count();
    if bg_count <= max_background_hosts {
        return Vec::new();
    }
    let excess = bg_count - max_background_hosts;
    let mut unloadable: Vec<&BackgroundHostCandidate> =
        candidates.iter().filter(|c| c.can_unload()).collect();

    let rank = |c: &BackgroundHostCandidate| -> (u8, usize) {
        match host_mru.iter().position(|k| k == &c.key) {
            Some(pos) => (0, pos),
            None => (1, usize::MAX),
        }
    };
    unloadable.sort_by(|a, b| {
        let ra = rank(a);
        let rb = rank(b);
        rb.cmp(&ra).then_with(|| a.key.cmp(&b.key))
    });

    unloadable
        .into_iter()
        .take(excess)
        .map(|c| c.key.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean_slot(id: u64, key: &str, visible: bool) -> SlotCandidate {
        SlotCandidate {
            id,
            key: key.into(),
            visible,
            admitted: true,
            closing: false,
            restoring: false,
            dirty: false,
            saving_or_busy: false,
            cloud_conflict: false,
            unflushable_draft: false,
            owned_by_mutation: false,
            composing: false,
            page_history: false,
        }
    }

    #[test]
    fn hibernates_oldest_clean_hidden_slots_and_never_touches_pinned_states() {
        let mut dirty = clean_slot(2, "dirty.md", false);
        dirty.dirty = true;
        let mut composing = clean_slot(3, "ime.md", false);
        composing.composing = true;
        let candidates = vec![
            clean_slot(1, "oldest.md", false),
            dirty,
            composing,
            clean_slot(4, "recent.md", false),
            clean_slot(5, "active.md", true),
        ];
        // MRU: active.md (0), recent.md (1), ime.md (2), dirty.md (3), oldest.md (4).
        let mru = vec![
            "active.md".into(),
            "recent.md".into(),
            "ime.md".into(),
            "dirty.md".into(),
            "oldest.md".into(),
        ];
        // Cap = 3, live = 5 -> excess = 2. Only `oldest.md` (1) and `recent.md` (4)
        // are evictable because `dirty.md`, `ime.md`, and `active.md` are pinned!
        let evicted = select_slots_to_hibernate(&candidates, &mru, 3);
        assert_eq!(evicted, vec![1, 4]);
    }

    #[test]
    fn a_page_holding_the_only_undo_history_is_never_hibernated() {
        let mut page = clean_slot(1, "map.contextmap", false);
        page.page_history = true;
        let candidates = vec![
            page,
            clean_slot(2, "notes.md", false),
            clean_slot(3, "active.md", true),
        ];
        let mru = vec![
            "active.md".into(),
            "notes.md".into(),
            "map.contextmap".into(),
        ];
        // The page is the oldest, but only the clean Markdown copy may go:
        // its history outlives its view, the page's would not.
        assert_eq!(select_slots_to_hibernate(&candidates, &mru, 1), vec![2]);
    }

    #[test]
    fn unloads_oldest_clean_background_hosts_and_protects_dirty_or_active_hosts() {
        let candidates = vec![
            BackgroundHostCandidate {
                key: "ws-active".into(),
                active: true,
                restoring_or_loading_metadata: false,
                has_unsaved_or_busy_slots: false,
                has_pending_mutations: false,
            },
            BackgroundHostCandidate {
                key: "ws-dirty".into(),
                active: false,
                restoring_or_loading_metadata: false,
                has_unsaved_or_busy_slots: true,
                has_pending_mutations: false,
            },
            BackgroundHostCandidate {
                key: "ws-old-clean".into(),
                active: false,
                restoring_or_loading_metadata: false,
                has_unsaved_or_busy_slots: false,
                has_pending_mutations: false,
            },
            BackgroundHostCandidate {
                key: "ws-mid-clean".into(),
                active: false,
                restoring_or_loading_metadata: false,
                has_unsaved_or_busy_slots: false,
                has_pending_mutations: false,
            },
            BackgroundHostCandidate {
                key: "ws-new-clean".into(),
                active: false,
                restoring_or_loading_metadata: false,
                has_unsaved_or_busy_slots: false,
                has_pending_mutations: false,
            },
        ];
        let mru = vec![
            "ws-active".into(),
            "ws-new-clean".into(),
            "ws-mid-clean".into(),
            "ws-dirty".into(),
            "ws-old-clean".into(),
        ];
        // 4 background hosts, max = 2 -> excess = 2; `ws-dirty` is protected,
        // so `ws-old-clean` then `ws-mid-clean` are selected.
        let unloaded = select_background_hosts_to_unload(&candidates, &mru, 2);
        assert_eq!(unloaded, vec!["ws-old-clean", "ws-mid-clean"]);
    }
}
