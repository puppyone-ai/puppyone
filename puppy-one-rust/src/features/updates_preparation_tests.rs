//! The network completion hands an owned archive to real background preparation.
use super::*;
use std::{cell::RefCell, io::Write, path::PathBuf, rc::Rc};

fn deliver(
    service: &Fixture,
    bytes: &[u8],
    offered: &str,
    downloaded: &str,
    cx: &mut gpui::TestAppContext,
) -> PathBuf {
    let mut file = tempfile::NamedTempFile::new_in(service.root.path()).unwrap();
    file.write_all(bytes).unwrap();
    let archive = file.into_temp_path();
    let path = archive.to_path_buf();
    service.update(cx, |u, cx| {
        u.candidate = Some(Candidate {
            version: offered.into(),
            url: u.config.feed.as_ref().unwrap().join("update.zip").unwrap(),
            sha512: base64::engine::general_purpose::STANDARD.encode(sha2::Sha512::digest(bytes)),
            size: bytes.len() as u64,
        });
        u.busy = true;
        u.publish(
            |s| {
                s.available_version = Some(offered.into());
                s.status = Status::Downloading;
            },
            cx,
        );
        u.downloaded(Ok((archive, downloaded.into())), cx);
    });
    path
}

#[gpui::test]
fn preparation_yields_the_foreground_and_only_verified_completion_offers_restart(
    cx: &mut gpui::TestAppContext,
) {
    cx.executor().allow_parking();
    let feed = Feed::new(vec![]);
    let updates = service(&feed, false, cx);
    let version = "0.4.5-dev.gb";
    let archive = updates.prepare_target(version, cx);
    let path = deliver(&updates, &archive, version, version, cx);
    let settled = Rc::new(RefCell::new(Vec::new()));
    let observed = settled.clone();
    updates.update(cx, |u, cx| {
        assert_eq!(u.state.status, Status::Downloading);
        assert!(u.busy);
        assert_eq!(titlebar(&u.state), None);
        u.after(
            move |state, _| observed.borrow_mut().push(state.clone()),
            cx,
        );
        u.check(cx);
        u.update_now(cx);
        u.install_on_exit();
        assert_eq!(u.state.status, Status::Downloading);
    });
    assert!(settled.borrow().is_empty());
    assert!(path.is_file(), "the background job owns its archive");
    assert!(!updates.root.path().join("staging/next").exists());
    assert_eq!(updates.installed_version(), "0.4.4-dev.ga");
    settle(&updates, cx, |u| !u.busy);
    cx.run_until_parked();
    assert!(!path.exists(), "completed preparation retires its archive");
    assert_eq!(settled.borrow().len(), 1);
    assert_eq!(settled.borrow()[0].status, Status::Downloaded);
    assert_eq!(
        settled.borrow()[0].available_version.as_deref(),
        Some(version)
    );
    assert_eq!(settled.borrow()[0].progress, None);
    assert_eq!(settled.borrow()[0].error, None);
    assert_eq!(updates.quits(cx), 0);
    assert!(feed.requests().is_empty());
    updates.update(cx, |u, cx| {
        assert_eq!(titlebar(&u.state), Some(Titlebar::Ready));
        u.update_now(cx);
        assert_eq!(u.state.status, Status::Installing);
    });
    cx.run_until_parked();
    assert_eq!(updates.quits(cx), 1);
    // Cancel this fixture's quit before an ordinary, non-relaunch swap.
    updates.update(cx, |u, cx| {
        u.quit_cancelled(cx);
        u.install_on_exit();
    });
    assert_eq!(updates.installed_version(), version);
    assert!(feed.requests().is_empty());
}

#[gpui::test]
fn stale_downloaded_versions_never_prepare_or_install_an_older_app(cx: &mut gpui::TestAppContext) {
    cx.executor().allow_parking();
    for (received, status) in [
        ("0.4.3", Status::NotAvailable),
        ("0.4.4", Status::NotAvailable),
        ("0.4.6-internal.1", Status::Error),
        ("latest", Status::Error),
        ("0.4.6", Status::Error),
    ] {
        let feed = Feed::new(vec![]);
        let updates = Fixture::new(&feed, build_identity::Channel::Stable, "0.4.4", false, cx);
        let archive = updates.prepare_target(received, cx);
        let path = deliver(&updates, &archive, "0.4.5", received, cx);
        settle(&updates, cx, |u| !u.busy);
        updates.update(cx, |u, _| {
            assert_eq!(u.state.status, status, "{received}");
            assert_eq!(u.state.available_version, None);
            assert!(u.candidate.is_none());
            assert_eq!(titlebar(&u.state), None);
            u.install_on_exit();
        });
        assert_eq!(updates.installed_version(), "0.4.4");
        assert_eq!(updates.quits(cx), 0);
        assert!(!path.exists());
        assert!(!updates.root.path().join("staging/next").exists());
        assert!(feed.requests().is_empty());
    }
}

#[gpui::test]
fn preparation_failure_finishes_waiters_and_retires_the_archive_before_retry(
    cx: &mut gpui::TestAppContext,
) {
    cx.executor().allow_parking();
    let feed = Feed::new(vec![]);
    let updates = service(&feed, false, cx);
    let version = "0.4.5-dev.gb";
    let archive = updates.prepare_target(version, cx);
    let invalid = deliver(&updates, b"not a zip", version, version, cx);
    assert_eq!(
        updates.read_with(cx, |u, _| u.state.status),
        Status::Downloading
    );
    let settled = Rc::new(RefCell::new(Vec::new()));
    let observed = settled.clone();
    updates.update(cx, |u, cx| {
        u.after(move |s, _| observed.borrow_mut().push(s.clone()), cx)
    });
    settle(&updates, cx, |u| !u.busy);
    cx.run_until_parked();
    assert_eq!(settled.borrow().len(), 1);
    assert_eq!(settled.borrow()[0].status, Status::Error);
    assert!(
        settled.borrow()[0]
            .error
            .as_ref()
            .is_some_and(|s| !s.is_empty())
    );
    assert_eq!(settled.borrow()[0].progress, None);
    assert!(!invalid.exists());
    updates.update(cx, |u, _| u.install_on_exit());
    assert_eq!(updates.installed_version(), "0.4.4-dev.ga");
    let valid = deliver(&updates, &archive, version, version, cx);
    settle(&updates, cx, |u| !u.busy);
    assert_eq!(
        updates.read_with(cx, |u, _| u.state.status),
        Status::Downloaded
    );
    assert!(!valid.exists());
    updates.update(cx, |u, _| u.install_on_exit());
    assert_eq!(updates.installed_version(), version);
    assert_eq!(updates.quits(cx), 0);
}

#[gpui::test]
fn superseded_preparation_cannot_offer_or_install_its_old_payload(cx: &mut gpui::TestAppContext) {
    cx.executor().allow_parking();
    let feed = Feed::new(vec![]);
    let updates = service(&feed, false, cx);
    let version = "0.4.5-dev.gb";
    let bytes = updates.prepare_target(version, cx);
    let path = deliver(&updates, &bytes, version, version, cx);
    updates.update(cx, |u, _| {
        // Even another payload with the same version has different ownership.
        u.candidate.as_mut().unwrap().sha512 =
            base64::engine::general_purpose::STANDARD.encode([7; 64]);
        u.waiting.push(Box::new(|_, _| {
            panic!("old preparation must not finish a new operation")
        }));
    });
    cx.run_until_parked();
    assert!(!path.exists());
    updates.update(cx, |u, _| {
        assert_eq!(u.state.status, Status::Downloading);
        assert!(u.busy);
        assert_eq!(u.waiting.len(), 1);
        assert_eq!(titlebar(&u.state), None);
        assert!(
            !u.prepared.as_mut().unwrap().install_on_exit(false),
            "superseded readiness was revoked"
        );
    });
    assert_eq!(updates.installed_version(), "0.4.4-dev.ga");
    assert_eq!(updates.quits(cx), 0);
}

fn begin_download(updates: &Fixture, bytes: &[u8], cx: &mut gpui::TestAppContext) {
    updates.update(cx, |u, cx| {
        let version = "0.4.5-dev.gb";
        u.candidate = Some(Candidate {
            version: version.into(),
            url: u
                .config
                .feed
                .as_ref()
                .unwrap()
                .join("feed/update.zip")
                .unwrap(),
            sha512: base64::engine::general_purpose::STANDARD.encode(sha2::Sha512::digest(bytes)),
            size: bytes.len() as u64,
        });
        u.busy = true;
        u.publish(
            |s| {
                s.status = Status::Available;
                s.available_version = Some(version.into());
            },
            cx,
        );
        u.start_download(cx);
    });
}

#[gpui::test]
fn superseded_download_success_and_failure_cannot_publish_progress_or_finish_waiters(
    cx: &mut gpui::TestAppContext,
) {
    cx.executor().allow_parking();
    for served in [true, false] {
        let bytes = b"an archive payload";
        let feed = Feed::new(if served {
            vec![("update.zip".into(), bytes.to_vec())]
        } else {
            vec![]
        });
        let updates = service(&feed, false, cx);
        begin_download(&updates, bytes, cx);
        let replacement_progress = Progress {
            percent: 42.,
            ..Progress::default()
        };
        updates.update(cx, |u, _| {
            u.candidate.as_mut().unwrap().sha512 =
                base64::engine::general_purpose::STANDARD.encode([7; 64]);
            u.state.progress = Some(replacement_progress);
            u.waiting.push(Box::new(|_, _| {
                panic!("old download must not finish a new operation")
            }));
        });
        cx.run_until_parked();
        updates.read_with(cx, |u, _| {
            assert_eq!(u.state.status, Status::Downloading);
            assert_eq!(u.state.progress, Some(replacement_progress));
            assert_eq!(u.state.error, None);
            assert_eq!(u.waiting.len(), 1);
            assert!(u.busy);
        });
        assert_eq!(feed.requests(), ["/feed/update.zip"]);
        assert_eq!(
            std::fs::read_dir(updates.root.path().join("downloads"))
                .unwrap()
                .count(),
            0
        );
    }
}

#[gpui::test]
fn releasing_the_service_cancels_queued_downloads_without_recreating_its_profile(
    cx: &mut gpui::TestAppContext,
) {
    cx.executor().allow_parking();
    let bytes = b"an archive payload";
    let feed = Feed::new(vec![("update.zip".into(), bytes.to_vec())]);
    let updates = service(&feed, false, cx);
    let root = updates.root.path().to_path_buf();
    let weak = updates.downgrade();
    begin_download(&updates, bytes, cx);
    drop(updates);
    // GPUI retires unreferenced entities at an App transaction boundary.
    // Flush that boundary before allowing queued background work to run.
    cx.update(|_| {});
    cx.run_until_parked();
    assert!(weak.upgrade().is_none());
    assert!(
        feed.requests().is_empty(),
        "retired service must not contact the feed"
    );
    assert!(
        !root.exists(),
        "retired tasks must not recreate the released profile"
    );
}
