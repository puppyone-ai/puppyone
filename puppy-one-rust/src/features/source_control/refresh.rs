//! When the repository is read again (`gitRefreshScheduler.ts`,
//! `remoteRefreshPolicy.ts`, `git-metadata-watch-service.mjs`): status reads
//! are debounced invalidations from the working tree and the Git metadata,
//! plus a read on focus once stale; the sync remote is fetched only while the
//! window is focused, every few minutes and on focus once stale.
use super::{ResultValue, Snapshot, git, project_sections};
use gpui::Context;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

/// `GIT_REFRESH_DEBOUNCE_MS`.
pub const DEBOUNCE: Duration = Duration::from_millis(250);
/// `GIT_FOCUS_STALE_MS`.
pub const FOCUS_STALE: Duration = Duration::from_secs(5);
pub const RETRY_INITIAL: Duration = Duration::from_millis(250);
pub const RETRY_MAX: Duration = Duration::from_secs(30);
/// `REMOTE_FETCH_INTERVAL_MS`, `REMOTE_FETCH_FOCUS_STALE_MS`,
/// `REMOTE_FETCH_MIN_GAP_MS`.
pub const REMOTE_INTERVAL: Duration = Duration::from_secs(180);
pub const REMOTE_FOCUS_STALE: Duration = Duration::from_secs(60);
pub const REMOTE_MIN_GAP: Duration = Duration::from_secs(15);

/// `shouldFetchRemote`: a focused, online window, past the minimum gap.
pub fn should_fetch_remote(
    focused: bool,
    since_last: Option<Duration>,
    minimum_gap: Duration,
) -> bool {
    focused && since_last.is_none_or(|since| since >= minimum_gap)
}

/// `shouldIgnoreMetadataChange`: lock files, objects and watcher cookies are
/// noise; `relative` is the path inside the Git directory.
pub fn metadata_noise(relative: &str) -> bool {
    relative.ends_with(".lock")
        || relative == "objects"
        || relative.starts_with("objects/")
        || relative.contains("cookies")
        || relative.ends_with(".cookie")
}

impl super::SourceControl {
    /// Something may have changed in the repository (the working tree or
    /// its metadata): read the status once the burst settles
    /// (`GIT_REFRESH_DEBOUNCE_MS`).
    pub fn invalidate(&mut self, cx: &mut Context<Self>) {
        if self.root.is_none() {
            return;
        }
        if !self.focused || self.busy || self.read_ticket.is_some() {
            self.dirty = true;
            return;
        }
        // Restart the quiet period from the latest event in the burst.
        self.debounce = None;
        self.debounce = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(DEBOUNCE).await;
            let _ = this.update(cx, |s, cx| {
                s.debounce = None;
                s.request_read(false, cx);
            });
        }));
    }
    /// Window focus: a stale status is read again (`GIT_FOCUS_STALE_MS`) and
    /// the sync remote is fetched once it is stale too.
    pub fn set_focused(&mut self, focused: bool, cx: &mut Context<Self>) {
        let was_focused = self.focused;
        self.focused = focused;
        if was_focused || !focused || self.root.is_none() {
            return;
        }
        if self.dirty
            || self.error.is_some()
            || self.last_successful_refresh.is_none_or(|at| {
                cx.background_executor().now().saturating_duration_since(at) >= FOCUS_STALE
            })
        {
            self.refresh(cx);
        }
        self.request_fetch(REMOTE_FOCUS_STALE, cx);
    }
    /// A silent fetch of the upstream's remote, past `gap` since the last
    /// attempt; never for a local-only branch, never while unfocused.
    pub(super) fn request_fetch(&mut self, gap: Duration, cx: &mut Context<Self>) {
        // `getRemoteFetchTarget`: the sync target's remote; a local-only
        // branch never touches the network.
        let Some(remote) = self
            .snapshot
            .as_ref()
            .and_then(|s| s.target.as_ref())
            .map(|t| t.remote.clone())
        else {
            return;
        };
        if self.fetching
            || !should_fetch_remote(
                self.focused,
                self.last_fetch
                    .map(|at| cx.background_executor().now().saturating_duration_since(at)),
                gap,
            )
        {
            return;
        }
        self.fetching = true;
        self.last_fetch = Some(cx.background_executor().now());
        self.task(move |root, cancel| ResultValue::Fetched(git::fetch(&root, &remote, cancel)));
        cx.notify();
    }
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        self.request_read(true, cx);
    }
    pub(super) fn request_read(&mut self, immediate: bool, cx: &mut Context<Self>) {
        if self.root.is_none() {
            return;
        }
        if self.busy || self.read_ticket.is_some() || (!immediate && !self.focused) {
            self.dirty = true;
            self.dirty_immediate |= immediate;
            return;
        }
        self.debounce = None;
        self.refresh_retry = None;
        self.busy = true;
        self.dirty = false;
        self.dirty_immediate = false;
        self.refresh_generation += 1;
        let generation = self.refresh_generation;
        self.read_ticket = Some(generation);
        let cancel = Arc::new(AtomicBool::new(false));
        self.read_cancel = Some(cancel.clone());
        let reader = self.status_reader.clone();
        let read_cancel = cancel.clone();
        self.task_with(cancel, move |root, _| {
            ResultValue::Read(reader(root, read_cancel), generation)
        });
        cx.notify();
    }
    pub(super) fn schedule_refresh_retry(&mut self, cx: &mut Context<Self>) {
        if self.root.is_none() || !self.focused || self.refresh_retry.is_some() {
            return;
        }
        let delay = self.retry_delay;
        self.retry_delay = (delay * 2).min(RETRY_MAX);
        self.refresh_retry = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(delay).await;
            let _ = this.update(cx, |s, cx| {
                s.refresh_retry = None;
                // Retry is foreground reconciliation, never a background read.
                s.request_read(false, cx);
            });
        }));
    }
    pub(super) fn failed_status(&mut self, error: String, cx: &mut Context<Self>) {
        if repository_absent(&error) {
            // TS returns an ordinary isRepo=false snapshot here. Absence is
            // not a transient error and must not become an idle polling loop.
            self.snapshot = None;
            self.repository_absent = true;
            self.sections.clear();
            self.history_cancel.store(true, Ordering::Relaxed);
            self.history_ticket += 1;
            self.history = Default::default();
            self.history_loaded = true;
            self.rebuild_timeline();
            self.detail_cancel.store(true, Ordering::Relaxed);
            self.selection += 1;
            self.detail = None;
            self.applied_generation = self.refresh_generation;
            self.last_successful_refresh = Some(cx.background_executor().now());
            self.refresh_retry = None;
            self.retry_delay = RETRY_INITIAL;
            self.error = None;
        } else {
            self.error = Some(error);
            self.schedule_refresh_retry(cx);
        }
    }
    pub(super) fn publish_status(&mut self, snapshot: Snapshot, cx: &mut Context<Self>) {
        let changed = self.snapshot.as_ref() != Some(&snapshot);
        if changed {
            self.sections = project_sections(&snapshot);
        }
        self.snapshot = Some(snapshot);
        self.repository_absent = false;
        self.error = None;
        self.last_successful_refresh = Some(cx.background_executor().now());
        self.refresh_retry = None;
        self.retry_delay = RETRY_INITIAL;
        if self.history_open && changed {
            self.load_history();
        }
    }
    pub(super) fn apply_mutation_status(&mut self, snapshot: Snapshot, cx: &mut Context<Self>) {
        self.refresh_generation += 1;
        self.applied_generation = self.refresh_generation;
        if let Some(cancel) = &self.read_cancel {
            cancel.store(true, Ordering::Relaxed);
        }
        self.debounce = None;
        self.dirty = false;
        self.dirty_immediate = false;
        self.publish_status(snapshot, cx);
    }
}

pub(super) fn repository_absent(error: &str) -> bool {
    error.to_ascii_lowercase().contains("not a git repository")
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn remote_fetches_need_focus_and_a_gap() {
        let s = Duration::from_secs;
        assert!(should_fetch_remote(true, None, REMOTE_MIN_GAP));
        assert!(!should_fetch_remote(false, None, REMOTE_MIN_GAP));
        assert!(!should_fetch_remote(true, Some(s(10)), REMOTE_MIN_GAP));
        assert!(should_fetch_remote(true, Some(s(15)), REMOTE_MIN_GAP));
        assert!(!should_fetch_remote(true, Some(s(59)), REMOTE_FOCUS_STALE));
    }

    #[test]
    fn metadata_noise_is_filtered_like_the_product() {
        for noise in [
            "index.lock",
            "HEAD.lock",
            "objects",
            "objects/ab/cdef",
            "x.cookie",
        ] {
            assert!(metadata_noise(noise), "{noise}");
        }
        for signal in [
            "HEAD",
            "index",
            "refs/heads/main",
            "packed-refs",
            "FETCH_HEAD",
            "MERGE_HEAD",
        ] {
            assert!(!metadata_noise(signal), "{signal}");
        }
    }
}
