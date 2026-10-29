//! When the repository is read again (`gitRefreshScheduler.ts`,
//! `remoteRefreshPolicy.ts`, `git-metadata-watch-service.mjs`): status reads
//! are debounced invalidations from the working tree and the Git metadata,
//! plus a read on focus once stale; the sync remote is fetched only while the
//! window is focused, every few minutes and on focus once stale.
use std::time::Duration;

/// `GIT_REFRESH_DEBOUNCE_MS`.
pub const DEBOUNCE: Duration = Duration::from_millis(250);
/// `GIT_FOCUS_STALE_MS`.
pub const FOCUS_STALE: Duration = Duration::from_secs(5);
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

/// `getRemoteFetchTarget`: the upstream's remote; a local-only branch never
/// touches the network.
pub fn remote_target(upstream: Option<&str>) -> Option<&str> {
    let (remote, branch) = upstream?.split_once('/')?;
    (!remote.is_empty() && !branch.is_empty()).then_some(remote)
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

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn remote_fetches_need_focus_a_gap_and_an_upstream() {
        let s = Duration::from_secs;
        assert!(should_fetch_remote(true, None, REMOTE_MIN_GAP));
        assert!(!should_fetch_remote(false, None, REMOTE_MIN_GAP));
        assert!(!should_fetch_remote(true, Some(s(10)), REMOTE_MIN_GAP));
        assert!(should_fetch_remote(true, Some(s(15)), REMOTE_MIN_GAP));
        assert!(!should_fetch_remote(true, Some(s(59)), REMOTE_FOCUS_STALE));
        assert_eq!(remote_target(Some("origin/main")), Some("origin"));
        assert_eq!(remote_target(Some("upstream/feature/x")), Some("upstream"));
        assert_eq!(remote_target(Some("main")), None);
        assert_eq!(remote_target(None), None);
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
