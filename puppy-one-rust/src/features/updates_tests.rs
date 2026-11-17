#![cfg(test)]
use super::*;
use base64::Engine as _;
use core::prelude::v1::test;
use sha2::Digest as _;
#[path = "updates_test_fixtures.rs"]
mod fixtures;
use fixtures::{Feed, Fixture};

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

fn feed_for(version: &str, archive: &[u8]) -> Vec<u8> {
    let digest = base64::engine::general_purpose::STANDARD.encode(sha2::Sha512::digest(archive));
    let arch = build_identity::node_architecture();
    format!(
        "version: {version}\nfiles:\n  - url: puppyone-gpui-{version}-{arch}.zip\n    sha512: {digest}\n    size: {}\npath: puppyone-gpui-{version}-{arch}.zip\nsha512: {digest}\nreleaseDate: '2026-11-15T00:00:00.000Z'\n",
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
        ("dev-mac.yml".into(), feed_for(version, &archive)),
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
            Some(if cfg!(target_os = "macos") {
                "This installation cannot be updated in place."
            } else {
                "Auto updates are available on macOS only."
            })
        );
    });
}

#[gpui::test]
fn an_older_or_tampered_update_is_never_offered(cx: &mut gpui::TestAppContext) {
    cx.executor().allow_parking();
    let older = Feed::new(vec![("dev-mac.yml".into(), feed_for("0.4.3-dev.gz", b"x"))]);
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
        ("dev-mac.yml".into(), tampered),
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
        let metadata = format!("{}-mac.yml", channel.key());
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
    feed.put("dev-mac.yml", feed_for("0.4.5-dev.gb", b"not downloaded"));
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
    assert_eq!(feed.requests(), vec!["/feed/dev-mac.yml"; 2]);
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
    let feed = Feed::new(vec![]);
    let updates = service(&feed, true, cx);
    updates.update(cx, |u, cx| {
        u.state = UpdateState::new(
            build_identity::Channel::Dev,
            "0.4.4-dev.ga".into(),
            Some("unavailable fixture".into()),
            true,
        );
        let original = u.state.clone();
        u.check(cx);
        u.update_now(cx);
        u.set_automatically_download(false, cx).unwrap();
        u.quit_cancelled(cx);
        u.install_on_exit();
        assert_eq!(u.state, original);
        assert!(!u.busy);
        assert!(!u.restart_requested);
    });
    cx.run_until_parked();
    assert!(feed.requests().is_empty());
    assert!(!updates.profile().exists());
    assert!(!updates.root.path().join("downloads").exists());
    assert_eq!(updates.quits(cx), 0);
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
        let metadata = format!("{}-mac.yml", channel.key());
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
    format!(
        "puppyone-gpui-{version}-{}.zip",
        build_identity::node_architecture()
    )
}

#[gpui::test]
fn fixtures_release_their_profile_and_http_listener(cx: &mut gpui::TestAppContext) {
    let feed = Feed::new(vec![]);
    let address = feed.url.socket_addrs(|| None).unwrap()[0];
    let updates = service(&feed, true, cx);
    updates.update(cx, |u, cx| u.set_automatically_download(false, cx).unwrap());
    let root = updates.root.path().to_path_buf();
    assert!(root.exists());
    drop(updates);
    cx.run_until_parked();
    assert!(!root.exists());
    drop(feed);
    assert!(
        std::net::TcpStream::connect_timeout(&address, std::time::Duration::from_secs(1)).is_err()
    );
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
