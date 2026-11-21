#![cfg(test)]
use super::*;
use base64::Engine as _;
use core::prelude::v1::test;
use sha2::Digest as _;
#[path = "updates_test_fixtures.rs"]
mod fixtures;
use fixtures::{Feed, Fixture};
#[cfg(target_os = "macos")]
#[path = "updates_preparation_tests.rs"]
mod preparation;

fn service(feed: &Feed, automatic: bool, cx: &mut gpui::TestAppContext) -> Fixture {
    Fixture::new(
        feed,
        build_identity::Channel::Dev,
        "0.4.4-dev.ga",
        automatic,
        cx,
    )
}

fn settle(
    service: &Entity<Updates>,
    cx: &mut gpui::TestAppContext,
    done: impl Fn(&Updates) -> bool,
) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    while !service.read_with(cx, |s, _| done(s)) {
        assert!(
            std::time::Instant::now() < deadline,
            "{:?}",
            service.read_with(cx, |s, _| s.state.clone())
        );
        cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

fn feed_file(channel: &str) -> String {
    updates::platform_feed_filename(channel, crate::platform::os::Os::current())
}

fn feed_path(channel: &str) -> String {
    format!("/feed/{}", feed_file(channel))
}

fn feed_for(version: &str, archive: &[u8]) -> Vec<u8> {
    let digest = base64::engine::general_purpose::STANDARD.encode(sha2::Sha512::digest(archive));
    let name = archive_name(version);
    format!(
        "version: {version}\nfiles:\n  - url: {name}\n    sha512: {digest}\n    size: {}\npath: {name}\nsha512: {digest}\nreleaseDate: '2026-11-15T00:00:00.000Z'\n",
        archive.len()
    )
    .into_bytes()
}

/// `electron.update-service.test.mjs`: a newer version is offered, and
/// downloaded by itself once automatic downloads are turned on; the
/// archive is checked against the feed before anything uses it.
#[gpui::test]
fn a_newer_version_is_offered_downloaded_and_checked(cx: &mut gpui::TestAppContext) {
    cx.executor().allow_parking();
    let archive = b"not really a zip".to_vec();
    let version = "0.4.5-dev.gb";
    let name = archive_name(version);
    let feed = Feed::new(vec![
        (feed_file("dev"), feed_for(version, &archive)),
        (name, archive),
    ]);
    let updates = service(&feed, false, cx);
    updates.update(cx, |u, cx| u.check(cx));
    settle(&updates, cx, |u| !u.busy);
    updates.read_with(cx, |u, _| {
        assert_eq!(u.state.status, Status::Available);
        assert_eq!(u.state.available_version.as_deref(), Some(version));
        assert_eq!(titlebar(&u.state), Some(Titlebar::Available));
    });
    // Turning automatic downloads on downloads it; with nowhere to
    // prepare it, the update stops at an honest error.
    updates.update(cx, |u, cx| u.set_automatically_download(true, cx).unwrap());
    settle(&updates, cx, |u| !u.busy);
    updates.read_with(cx, |u, _| {
        assert_eq!(u.state.status, Status::Error);
        assert_eq!(
            u.state.error.as_deref(),
            Some("This installation cannot be updated in place.")
        );
    });
}

#[gpui::test]
fn an_older_or_tampered_update_is_never_offered(cx: &mut gpui::TestAppContext) {
    cx.executor().allow_parking();
    let older = Feed::new(vec![(feed_file("dev"), feed_for("0.4.3-dev.gz", b"x"))]);
    let updates = service(&older, true, cx);
    updates.update(cx, |u, cx| u.check(cx));
    settle(&updates, cx, |u| !u.busy);
    updates.read_with(cx, |u, _| {
        assert_eq!(u.state.status, Status::NotAvailable);
        assert_eq!(u.state.available_version, None);
    });
    // A payload that does not match its digest is refused.
    let version = "0.4.5-dev.gb";
    let name = archive_name(version);
    let tampered = feed_for(version, b"the archive");
    let feed = Feed::new(vec![
        (feed_file("dev"), tampered),
        (name, b"another one".to_vec()),
    ]);
    let updates = service(&feed, true, cx);
    updates.update(cx, |u, cx| u.check(cx));
    settle(&updates, cx, |u| !u.busy);
    updates.read_with(cx, |u, _| {
        assert_eq!(u.state.status, Status::Error);
        assert!(
            u.state.error.as_deref().unwrap().contains("SHA-512"),
            "{:?}",
            u.state.error
        );
    });
}

#[gpui::test]
fn stable_and_internal_rejections_never_download_or_request_a_quit(cx: &mut gpui::TestAppContext) {
    cx.executor().allow_parking();
    use build_identity::Channel::{Internal, Stable};
    for (channel, current, version, expected) in [
        (Stable, "1.4.0", "1.3.9", Status::NotAvailable),
        (Stable, "1.4.0", "1.4.0", Status::NotAvailable),
        (Stable, "1.4.0", "1.4.1-internal.80", Status::Error),
        (Stable, "1.4.0", "latest", Status::Error),
        (
            Internal,
            "1.4.0-internal.80",
            "1.4.0-internal.79",
            Status::NotAvailable,
        ),
        (
            Internal,
            "1.4.0-internal.80",
            "1.4.0-internal.80",
            Status::NotAvailable,
        ),
        (Internal, "1.4.0-internal.80", "1.4.0", Status::Error),
    ] {
        let metadata = feed_file(channel.key());
        let feed = Feed::new(vec![(
            metadata.clone(),
            feed_for(version, b"no archive should be fetched"),
        )]);
        let updates = Fixture::new(&feed, channel, current, true, cx);
        for manual in [false, true] {
            updates.update(cx, |u, cx| {
                if manual {
                    u.update_now(cx)
                } else {
                    u.check(cx)
                }
            });
            settle(&updates, cx, |u| !u.busy);
            updates.read_with(cx, |u, _| {
                assert_eq!(u.state.status, expected, "{current} -> {version}");
                assert!(u.state.available_version.is_none());
                assert!(u.candidate.is_none());
                assert!(!u.restart_requested);
                assert!(!u.downloads.exists());
            });
        }
        assert_eq!(feed.requests(), vec![format!("/feed/{metadata}"); 2]);
        assert_eq!(updates.quits(cx), 0);
    }
}

#[gpui::test]
fn repeated_checks_share_one_operation_and_waiters_receive_its_settled_state(
    cx: &mut gpui::TestAppContext,
) {
    use std::{cell::RefCell, rc::Rc};
    cx.executor().allow_parking();
    let feed = Feed::new(vec![]);
    let updates = service(&feed, false, cx);
    let outcomes = Rc::new(RefCell::new(Vec::new()));
    updates.update(cx, |u, cx| {
        u.check(cx);
        u.check(cx);
        u.update_now(cx);
        for id in [1, 2] {
            let outcomes = outcomes.clone();
            u.after(
                move |state, _| outcomes.borrow_mut().push((id, state.clone())),
                cx,
            );
        }
        assert_eq!(u.state.status, Status::Checking);
        assert_eq!(u.waiting.len(), 2);
    });
    assert!(outcomes.borrow().is_empty());
    settle(&updates, cx, |u| !u.busy);
    cx.run_until_parked();
    let expected = updates.read_with(cx, |u, _| u.state.clone());
    assert_eq!(expected.status, Status::Error);
    assert_eq!(*outcomes.borrow(), [(1, expected.clone()), (2, expected)]);
    assert!(updates.read_with(cx, |u, _| u.waiting.is_empty()));
    feed.put(
        &feed_file("dev"),
        feed_for("0.4.5-dev.gb", b"not downloaded"),
    );
    updates.update(cx, |u, cx| u.update_now(cx));
    settle(&updates, cx, |u| !u.busy);
    updates.update(cx, |u, cx| {
        assert_eq!(u.state.status, Status::Available);
        assert!(u.state.error.is_none());
        u.check(cx); // Manual-download mode reuses the existing candidate.
        let outcomes = outcomes.clone();
        u.after(
            move |state, _| outcomes.borrow_mut().push((3, state.clone())),
            cx,
        );
    });
    cx.run_until_parked();
    assert_eq!(feed.requests(), vec![feed_path("dev"); 2]);
    assert_eq!(outcomes.borrow().len(), 3);
    assert_eq!(outcomes.borrow()[2].1.status, Status::Available);
    assert_eq!(updates.quits(cx), 0);
}

#[gpui::test]
fn a_failed_preference_write_preserves_service_state_and_can_be_retried(
    cx: &mut gpui::TestAppContext,
) {
    let feed = Feed::new(vec![]);
    let updates = service(&feed, true, cx);
    std::fs::write(updates.profile(), b"occupied").unwrap();
    let error = updates
        .update(cx, |u, cx| u.set_automatically_download(false, cx))
        .unwrap_err();
    assert!(matches!(
        error.kind(),
        std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::NotADirectory
    ));
    assert!(updates.read_with(cx, |u, _| u.state.automatically_download));
    assert_eq!(std::fs::read(updates.profile()).unwrap(), b"occupied");
    std::fs::remove_file(updates.profile()).unwrap();
    updates.update(cx, |u, cx| u.set_automatically_download(false, cx).unwrap());
    assert!(!updates.read_with(cx, |u, _| u.state.automatically_download));
    assert!(!updates::read_automatic_download(&updates.profile()));
    assert!(feed.requests().is_empty());
    assert_eq!(updates.quits(cx), 0);
}

#[gpui::test]
fn disabled_service_commands_do_not_write_check_download_or_quit(cx: &mut gpui::TestAppContext) {
    use build_identity::Channel::{Dev, Internal, Stable};
    for (channel, packaged) in [
        (Dev, false),
        (Dev, true),
        (Internal, false),
        (Stable, false),
    ] {
        let feed = Feed::new(vec![]);
        let updates = service(&feed, true, cx);
        let identity = build_identity::Identity {
            channel,
            packaged,
            ..build_identity::current()
        };
        let config = updates::configuration(&identity, |_| None);
        let reason = updates::disabled_reason(&config, packaged, || {
            panic!("disabled before native signature inspection")
        });
        assert!(reason.is_some());
        updates.update(cx, |u, cx| {
            u.config = config;
            u.state = UpdateState::new(channel, identity.version, reason, true);
            let original = u.state.clone();
            assert_eq!(original.status, Status::Disabled);
            assert_eq!(original.error, None);
            for _ in 0..2 {
                u.start_background_checks(cx);
                u.check(cx);
                u.update_now(cx);
                u.set_automatically_download(false, cx).unwrap();
                u.quit_cancelled(cx);
                u.install_on_exit();
                assert_eq!(u.state, original);
            }
            assert!(u._schedule.is_none());
            assert!(!u.busy);
            assert!(!u.restart_requested);
        });
        cx.run_until_parked();
        assert!(feed.requests().is_empty());
        assert!(!updates.profile().exists());
        assert!(!updates.root.path().join("downloads").exists());
        assert_eq!(updates.quits(cx), 0);
    }
}

#[cfg(target_os = "macos")]
#[gpui::test]
fn automatic_manual_and_enabled_downloads_prepare_once_without_restarting(
    cx: &mut gpui::TestAppContext,
) {
    cx.executor().allow_parking();
    for mode in ["automatic", "manual", "enabled", "internal"] {
        let (channel, current, version) = if mode == "internal" {
            (
                build_identity::Channel::Internal,
                "1.4.0-internal.80",
                "1.4.0-internal.81",
            )
        } else {
            (build_identity::Channel::Stable, "1.4.0", "1.4.1")
        };
        let feed = Feed::new(vec![]);
        let updates = Fixture::new(&feed, channel, current, mode != "enabled", cx);
        let archive = updates.prepare_target(version, cx);
        let name = archive_name(version);
        let metadata = feed_file(channel.key());
        feed.put(&metadata, feed_for(version, &archive));
        feed.put(&name, archive);
        if mode == "manual" {
            updates.update(cx, |u, cx| u.set_automatically_download(false, cx).unwrap());
            assert!(!updates::read_automatic_download(&updates.profile()));
        }
        updates.update(cx, |u, cx| {
            if mode == "internal" {
                u.update_now(cx)
            } else {
                u.check(cx)
            }
        });
        settle(&updates, cx, |u| !u.busy);
        if matches!(mode, "manual" | "enabled") {
            assert_eq!(
                updates.read_with(cx, |u, _| u.state.status),
                Status::Available
            );
            assert_eq!(feed.requests(), [format!("/feed/{metadata}")]);
            updates.update(cx, |u, cx| {
                if mode == "manual" {
                    u.update_now(cx)
                } else {
                    u.set_automatically_download(true, cx).unwrap()
                }
            });
            settle(&updates, cx, |u| !u.busy);
        }
        updates.read_with(cx, |u, _| {
            assert_eq!(u.state.status, Status::Downloaded, "{mode}: {:?}", u.state);
            assert_eq!(u.state.available_version.as_deref(), Some(version));
            assert!(u.state.progress.is_none());
            assert!(u.state.error.is_none());
            assert_eq!(u.state.automatically_download, mode != "manual");
        });
        if mode == "enabled" {
            assert!(
                updates
                    .profile()
                    .join("desktop-update-preferences.json")
                    .is_file()
            );
            assert!(updates::read_automatic_download(&updates.profile()));
        }
        assert_eq!(
            updates.installed_version(),
            current,
            "preparation must not replace the running app"
        );
        updates.update(cx, |u, cx| {
            u.check(cx);
            u.check(cx);
        });
        cx.run_until_parked();
        assert_eq!(
            feed.requests(),
            [format!("/feed/{metadata}"), format!("/feed/{name}")]
        );
        assert_eq!(updates.quits(cx), 0);
        if mode == "internal" {
            updates.update(cx, |u, cx| u.update_now(cx));
            cx.run_until_parked();
            assert_eq!(updates.quits(cx), 1);
            assert_eq!(
                updates.read_with(cx, |u, _| u.state.status),
                Status::Installing
            );
            updates.update(cx, |u, cx| u.quit_cancelled(cx));
        }
    }
}

#[cfg(target_os = "macos")]
#[gpui::test]
fn disabling_automatic_updates_during_download_preserves_the_in_flight_archive(
    cx: &mut gpui::TestAppContext,
) {
    cx.executor().allow_parking();
    let feed = Feed::new(vec![]);
    let updates = service(&feed, true, cx);
    let version = "0.4.5-dev.gb";
    let archive = updates.prepare_target(version, cx);
    let name = archive_name(version);
    feed.put("dev-mac.yml", feed_for(version, &archive));
    feed.put(&name, archive);
    updates.update(cx, |u, cx| u.check(cx));
    // Step only until the service publishes Downloading. Its synchronous I/O
    // futures run on the deterministic test dispatcher, so blocking the HTTP
    // reply while draining that dispatcher would also block this test thread.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    while updates.read_with(cx, |u, _| u.state.status != Status::Downloading) {
        assert!(
            std::time::Instant::now() < deadline,
            "download did not start"
        );
        cx.executor().tick();
    }
    updates.update(cx, |u, cx| {
        u.set_automatically_download(false, cx).unwrap();
        assert_eq!(u.state.status, Status::Downloading);
        assert!(!u.state.automatically_download);
        assert!(u.busy);
        u.check(cx);
        u.update_now(cx);
    });
    assert!(!updates::read_automatic_download(&updates.profile()));
    settle(&updates, cx, |u| !u.busy);
    updates.read_with(cx, |u, _| {
        assert_eq!(u.state.status, Status::Downloaded, "{:?}", u.state);
        assert!(!u.state.automatically_download);
    });
    assert_eq!(
        feed.requests(),
        ["/feed/dev-mac.yml".to_owned(), format!("/feed/{name}")]
    );
    assert_eq!(updates.quits(cx), 0);
}

#[cfg(target_os = "macos")]
#[gpui::test]
fn cancelled_restarts_keep_the_prepared_app_and_ordinary_quit_installs_without_relaunch(
    cx: &mut gpui::TestAppContext,
) {
    cx.executor().allow_parking();
    let feed = Feed::new(vec![]);
    let updates = service(&feed, true, cx);
    let version = "0.4.5-dev.gb";
    let archive = updates.prepare_target(version, cx);
    let name = archive_name(version);
    feed.put("dev-mac.yml", feed_for(version, &archive));
    feed.put(&name, archive);
    updates.update(cx, |u, cx| u.update_now(cx));
    settle(&updates, cx, |u| !u.busy);
    assert_eq!(
        updates.read_with(cx, |u, _| u.state.status),
        Status::Downloaded
    );
    for attempt in 1..=2 {
        updates.update(cx, |u, cx| {
            u.update_now(cx);
            u.update_now(cx);
            u.check(cx);
        });
        cx.run_until_parked();
        assert_eq!(updates.quits(cx), attempt);
        assert_eq!(
            updates.read_with(cx, |u, _| u.state.status),
            Status::Installing
        );
        assert_eq!(updates.installed_version(), "0.4.4-dev.ga");
        updates.update(cx, |u, cx| {
            u.quit_cancelled(cx);
            u.quit_cancelled(cx);
            assert_eq!(u.state.status, Status::Downloaded);
            assert!(!u.restart_requested);
        });
    }
    // Exercise the real atomic swap only after cancellation clears relaunch.
    updates.update(cx, |u, _| u.install_on_exit());
    assert_eq!(updates.installed_version(), version);
    assert!(
        updates
            .root
            .path()
            .join("staging/previous/PuppyOne Update Fixture.app")
            .is_dir()
    );
    assert!(
        !updates.root.path().join("staging.log").exists(),
        "ordinary quit must not spawn the relaunch helper"
    );
    assert_eq!(
        feed.requests(),
        ["/feed/dev-mac.yml".to_owned(), format!("/feed/{name}")]
    );
    assert_eq!(updates.quits(cx), 2);
    updates.update(cx, |u, _| u.install_on_exit());
    assert_eq!(updates.installed_version(), version);
}

fn archive_name(version: &str) -> String {
    let arch = build_identity::node_architecture();
    match crate::platform::os::Os::current() {
        crate::platform::os::Os::Windows => format!("puppyone-{version}-win-{arch}-setup.exe"),
        crate::platform::os::Os::Linux | crate::platform::os::Os::Other => {
            format!("puppyone-{version}-linux-{arch}.AppImage")
        }
        crate::platform::os::Os::Macos => format!("puppyone-gpui-{version}-{arch}.zip"),
    }
}

#[gpui::test]
fn fixtures_release_their_profile_and_http_listener(cx: &mut gpui::TestAppContext) {
    let feed = Feed::new(vec![]);
    let listening = feed.listening();
    let updates = service(&feed, true, cx);
    updates.update(cx, |u, cx| u.set_automatically_download(false, cx).unwrap());
    let root = updates.root.path().to_path_buf();
    assert!(root.exists());
    drop(updates);
    cx.run_until_parked();
    assert!(!root.exists());
    assert!(listening());
    drop(feed);
    // The listener belongs to the worker thread, which drop joins. (Probing
    // the port raced with other tests binding the same ephemeral port.)
    assert!(!listening(), "the feed's worker and its listener are gone");
}

#[cfg(target_os = "macos")]
#[gpui::test]
fn a_prepared_update_installs_on_ordinary_quit_without_a_restart_request(
    cx: &mut gpui::TestAppContext,
) {
    cx.executor().allow_parking();
    let feed = Feed::new(vec![]);
    let updates = service(&feed, true, cx);
    let version = "0.4.5-dev.gb";
    let archive = updates.prepare_target(version, cx);
    let name = archive_name(version);
    feed.put("dev-mac.yml", feed_for(version, &archive));
    feed.put(&name, archive);
    updates.update(cx, |u, cx| u.check(cx));
    settle(&updates, cx, |u| !u.busy);
    updates.update(cx, |u, _| {
        assert_eq!(u.state.status, Status::Downloaded);
        assert!(!u.restart_requested);
        u.install_on_exit();
    });
    assert_eq!(updates.installed_version(), version);
    assert!(
        updates
            .root
            .path()
            .join("staging/previous/PuppyOne Update Fixture.app")
            .is_dir()
    );
    assert!(!updates.root.path().join("staging.log").exists());
    assert_eq!(updates.quits(cx), 0);
    assert_eq!(
        feed.requests(),
        ["/feed/dev-mac.yml".to_owned(), format!("/feed/{name}")]
    );
}

#[gpui::test]
fn repeated_initialization_keeps_the_existing_service_and_its_profile(
    cx: &mut gpui::TestAppContext,
) {
    let feed = Feed::new(vec![]);
    let updates = service(&feed, false, cx);
    let expected = updates.entity_id();
    cx.update(|cx| {
        cx.set_global(Service(updates.clone()));
        init(
            |_| panic!("duplicate startup must not replace the quit handler"),
            cx,
        );
        init(
            |_| panic!("duplicate startup must not replace the quit handler"),
            cx,
        );
        let current = global(cx).unwrap();
        assert_eq!(current.entity_id(), expected);
        assert!(!current.read(cx).state.automatically_download);
        assert_eq!(current.read(cx).data_dir, updates.profile());
    });
    assert!(feed.requests().is_empty());
}

#[gpui::test]
fn background_checks_start_once_follow_the_cadence_and_stop_with_the_service(
    cx: &mut gpui::TestAppContext,
) {
    use std::time::Duration;
    cx.executor().allow_parking();
    let feed = Feed::new(vec![(
        feed_file("stable"),
        feed_for("1.4.0", b"not downloaded"),
    )]);
    let updates = Fixture::new(&feed, build_identity::Channel::Stable, "1.4.0", false, cx);
    updates.update(cx, |u, cx| {
        u.start_background_checks(cx);
        u.start_background_checks(cx);
    });
    cx.run_until_parked(); // Arm the first timer without advancing the test clock.
    cx.executor().advance_clock(Duration::from_millis(14_999));
    cx.run_until_parked();
    assert!(feed.requests().is_empty());
    assert_eq!(updates.read_with(cx, |u, _| u.state.status), Status::Idle);
    cx.executor().advance_clock(Duration::from_millis(1));
    cx.run_until_parked();
    settle(&updates, cx, |u| !u.busy);
    assert_eq!(feed.requests(), [feed_path("stable")]);
    assert_eq!(
        updates.read_with(cx, |u, _| u.state.status),
        Status::NotAvailable
    );
    // The Settings/manual command remains available between automatic checks.
    updates.update(cx, |u, cx| u.check(cx));
    settle(&updates, cx, |u| !u.busy);
    assert_eq!(feed.requests().len(), 2);
    cx.executor()
        .advance_clock(Duration::from_millis(21_599_999));
    cx.run_until_parked();
    assert_eq!(feed.requests().len(), 2);
    cx.executor().advance_clock(Duration::from_millis(1));
    cx.run_until_parked();
    settle(&updates, cx, |u| !u.busy);
    assert_eq!(feed.requests().len(), 3);
    feed.put(
        &feed_file("stable"),
        feed_for("1.4.1", b"pending manual download"),
    );
    updates.update(cx, |u, cx| u.check(cx));
    settle(&updates, cx, |u| !u.busy);
    assert_eq!(
        updates.read_with(cx, |u, _| u.state.status),
        Status::Available
    );
    for status in [
        Status::Available,
        Status::Downloading,
        Status::Downloaded,
        Status::Installing,
    ] {
        updates.update(cx, |u, cx| u.publish(|state| state.status = status, cx));
        cx.executor()
            .advance_clock(Duration::from_secs(6 * 60 * 60));
        cx.run_until_parked();
        assert_eq!(
            feed.requests().len(),
            4,
            "{status:?} must keep the current candidate"
        );
    }
    let weak = updates.downgrade();
    drop(updates);
    cx.run_until_parked();
    assert!(weak.upgrade().is_none());
    cx.executor()
        .advance_clock(Duration::from_secs(6 * 60 * 60));
    cx.run_until_parked();
    assert_eq!(feed.requests().len(), 4);
}

#[gpui::test]
fn background_checks_retry_errors_on_the_next_interval(cx: &mut gpui::TestAppContext) {
    cx.executor().allow_parking();
    let feed = Feed::new(vec![]);
    let updates = service(&feed, false, cx);
    updates.update(cx, |u, cx| u.start_background_checks(cx));
    cx.run_until_parked();
    cx.executor().advance_clock(updates::INITIAL_CHECK);
    cx.run_until_parked();
    settle(&updates, cx, |u| !u.busy);
    assert_eq!(updates.read_with(cx, |u, _| u.state.status), Status::Error);
    assert_eq!(feed.requests().len(), 1);
    feed.put(&feed_file("dev"), feed_for("0.4.4-dev.ga", b"same version"));
    cx.executor().advance_clock(updates::CHECK_INTERVAL);
    cx.run_until_parked();
    settle(&updates, cx, |u| !u.busy);
    updates.read_with(cx, |u, _| {
        assert_eq!(u.state.status, Status::NotAvailable);
        assert!(u.state.error.is_none());
    });
    assert_eq!(feed.requests().len(), 2);
}

#[gpui::test]
fn disabled_updates_never_schedule_background_checks(cx: &mut gpui::TestAppContext) {
    cx.executor().allow_parking();
    let feed = Feed::new(vec![]);
    let updates = service(&feed, true, cx);
    updates.update(cx, |u, cx| {
        u.state = UpdateState::new(
            build_identity::Channel::Dev,
            "0.4.4-dev.ga".into(),
            Some("disabled fixture".into()),
            true,
        );
        u.start_background_checks(cx);
        u.start_background_checks(cx);
        assert!(u._schedule.is_none());
    });
    cx.executor()
        .advance_clock(updates::INITIAL_CHECK + updates::CHECK_INTERVAL);
    cx.run_until_parked();
    assert!(feed.requests().is_empty());
    assert_eq!(
        updates.read_with(cx, |u, _| u.state.status),
        Status::Disabled
    );
}

#[path = "updates_menu_tests.rs"]
mod menu;
