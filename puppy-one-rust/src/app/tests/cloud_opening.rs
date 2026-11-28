//! The window's Cloud projects: opening, joining, authority, recovery,
//! putting a folder in the Cloud.
use super::*;
use core::prelude::v1::test;

/// ADR-001: a folder and its Cloud project are two projects. The linked
/// folder's "Who can open it" on the Homepage opens the Cloud project, which
/// takes this window's place (no second window); the Cloud project's menu
/// offers the folder.
#[gpui::test]
fn a_linked_folder_opens_its_cloud_project_in_the_same_window(cx: &mut TestAppContext) {
    use super::audience::AudienceAction;
    use super::project_place::Place;
    use std::sync::atomic::{AtomicBool, Ordering};
    // The opening is held until the Header has been read while it opens.
    let hold = std::sync::Arc::new(AtomicBool::new(false));
    let base = cloud_project_responder();
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new({
        let hold = hold.clone();
        move |request| {
            while hold.load(Ordering::SeqCst) && request.path.contains("/workbench") {
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
            base(request)
        }
    });
    let (view, cx, Linked { root, _temp, .. }) = linked_checkout(cx, with_catalog(responder));
    settle_cloud(&view, cx, "the association", &|s, cx| {
        s.cloud.read(cx).repository.read(cx).context.project() == Some("project-a")
            && s.home
                .read(cx)
                .project_items(cx)
                .iter()
                .any(|i| i.cloud_project.as_deref() == Some("project-a"))
    });
    let windows = cx.update(|_, cx| cx.windows().len());
    let local_key = view.read_with(cx, |s, cx| s.files(cx).workspace_key().unwrap().to_owned());
    let menu = view.read_with(cx, |s, cx| s.place_menu_now(cx).unwrap());
    assert_eq!(menu.place, Place::Local);
    // On the Homepage the folder is listed, as opening it remembers it, and
    // linked to its Cloud copy once its remote is read.
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.remember_project(&root, 1))
    });
    command(&view, cx, Command::Home);
    let path = root.to_string_lossy().into_owned();
    settle_cloud(&view, cx, "the folder's link", &|s, cx| {
        s.home
            .read(cx)
            .project_items(cx)
            .iter()
            .any(|i| i.local_path.as_deref() == Some(path.as_str()) && i.linked.is_some())
    });
    // Who can open it: the Cloud copy hangs under its audience, with Open.
    let audience = view.read_with(cx, |s, cx| {
        let home = s.home.read(cx);
        let root = root.to_string_lossy();
        let item = home
            .project_items(cx)
            .into_iter()
            .find(|i| i.local_path.as_deref() == Some(root.as_ref()))
            .expect("the folder on the Homepage");
        home.audience_of_id(&item.id, cx).unwrap()
    });
    let action = audience
        .team
        .and_then(|t| t.copy)
        .or(audience.devices_copy)
        .and_then(|c| c.open)
        .expect("Open the Cloud copy");
    assert_eq!(action, AudienceAction::OpenCloud("project-a".into()));
    hold.store(true, Ordering::SeqCst);
    view.update_in(cx, |s, w, cx| s.home_audience_action(action, w, cx));
    view.read_with(cx, |s, cx| {
        assert!(s.chrome.read(cx).popover.is_none());
        // The Header names the Cloud project while it opens.
        assert_eq!(
            s.chrome.read(cx).opening_project_name(cx).as_deref(),
            Some("Fixture Cloud")
        );
    });
    hold.store(false, Ordering::SeqCst);
    settle_cloud(&view, cx, "the Cloud project", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(s.session.project.read(cx).record.name, "Fixture Cloud");
        assert_ne!(s.files(cx).workspace_key(), Some(local_key.as_str()));
        assert_eq!(s.place_menu_now(cx).unwrap().place, Place::Cloud);
    });
    assert_eq!(cx.update(|_, cx| cx.windows().len()), windows);
    // The folder is its own project again, in this window too.
    view.update_in(cx, |s, w, cx| s.open_project(root.clone(), w, cx));
    settle_cloud(&view, cx, "the folder", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(root.as_path()) && s.hosted_project(cx).is_none()
    });
    assert_eq!(cx.update(|_, cx| cx.windows().len()), windows);
}

/// Signed out, Put in the Cloud asks to sign in first, and Escape closes it.
#[gpui::test]
fn put_in_the_cloud_signed_out_asks_to_sign_in_and_escape_closes_it(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("a.md"), "# A\n").unwrap();
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::account_fixture();
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| {
        let account = crate::features::cloud::account::install_fixture(broker, browser, cx);
        account.update(cx, |a, _| a.sign_out());
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while cx.update(|_, cx| crate::features::cloud::account::has_account(cx)) {
        cx.run_until_parked();
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(root.clone())))
    });
    settle_cloud(&view, cx, "the local project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(root.as_path())
    });
    view.update_in(cx, |s, w, cx| {
        s.cloud.update(cx, |c, cx| c.put_in_cloud(w, cx))
    });
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.has_dialog("CloudPublish", cx));
        // The folder stays the open project.
        assert_eq!(s.workspace_root(cx).as_deref(), Some(root.as_path()));
    });
    command(&view, cx, Command::Escape);
    view.read_with(cx, |s, cx| assert!(s.dialogs.read(cx).is_empty()));
}

#[gpui::test]
fn signing_out_revokes_the_hosted_selection_and_returns_home(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let (broker, browser) =
        crate::cloud::auth::responding_account_fixture(cloud_project_responder());
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let account =
        cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    let settle = |view: &Entity<Shell>,
                  cx: &mut VisualTestContext,
                  what: &str,
                  ready: &dyn Fn(&Shell, &App) -> bool| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            cx.update(|w, cx| {
                w.draw(cx).clear(cx);
            });
            if cx.update(|_, cx| ready(view.read(cx), cx)) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "{what} did not settle"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    };
    settle(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle(&view, cx, "the hosted Project", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
    });
    // Signing out revokes it: no hosted Project, the Homepage shows, and
    // nothing is left to reuse under another session.
    cx.update(|_, cx| account.update(cx, |a, _| a.sign_out()));
    settle(&view, cx, "the revocation", &|s, cx| {
        s.hosted_project(cx).is_none() && s.session.project.read(cx).record.cloud.is_none()
    });
    view.read_with(cx, |s, cx| {
        assert!(s.session.project.read(cx).home);
        assert!(s.session.project.read(cx).record.authority.is_none());
    });
}

#[gpui::test]
fn turning_cloud_off_cancels_an_opening_in_flight(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // A responder that never answers the root read keeps the opening going.
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new(|request| {
        if request.path.ends_with("/workbench/files") {
            std::thread::sleep(std::time::Duration::from_millis(400));
        }
        cloud_project_responder()(request)
    });
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while !cx.update(|_, cx| crate::features::cloud::account::has_account(cx)) {
        cx.run_until_parked();
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    view.read_with(cx, |s, cx| assert!(s.files(cx).cloud_opening().is_some()));
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.change(|p| p.experimental.cloud_workspace = false, cx)
        })
    });
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.files(cx).cloud_opening().is_none());
        assert!(s.session.project.read(cx).record.authority.is_none());
    });
    // The late root never commits.
    std::thread::sleep(std::time::Duration::from_millis(600));
    view.update_in(cx, |s, w, cx| s.receive(w, cx));
    cx.run_until_parked();
    view.read_with(cx, |s, cx| assert!(s.hosted_project(cx).is_none()));
}

#[gpui::test]
fn the_same_cloud_target_joins_its_pending_opening(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let roots = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = roots.clone();
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new(move |request| {
        if request.path.ends_with("/repository-context") {
            counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
        cloud_project_responder()(request)
    });
    let (broker, browser, _) = crate::cloud::auth::responding_live_account_fixture(responder);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while !cx.update(|_, cx| crate::features::cloud::account::has_account(cx)) {
        cx.run_until_parked();
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    // A second click on the same Project joins the pending opening.
    view.update(cx, |s, cx| {
        s.open_cloud("project-a".into(), cx);
        s.open_cloud("project-a".into(), cx);
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while view.read_with(cx, |s, cx| s.hosted_project(cx).is_none()) {
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        assert!(
            std::time::Instant::now() < deadline,
            "opening did not settle"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(roots.load(std::sync::atomic::Ordering::SeqCst), 1);
}

/// A hosted Project whose lease the service ends reopens on its own, out of
/// sight and without a dialog; one that keeps losing it asks the person, and
/// Retry rebinds the same host.
#[gpui::test]
fn a_project_that_keeps_losing_its_lease_reopens_once_then_offers_retry(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // The fixture transport has no event stream: every lease ends as soon
    // as the Project is open.
    let roots = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = roots.clone();
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new(move |request| {
        if request.path.ends_with("/repository-context") {
            counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        cloud_project_responder()(request)
    });
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    let settle = |view: &Entity<Shell>,
                  cx: &mut VisualTestContext,
                  what: &str,
                  ready: &dyn Fn(&Shell, &App) -> bool| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            cx.update(|w, cx| {
                w.draw(cx).clear(cx);
            });
            if cx.update(|_, cx| ready(view.read(cx), cx)) {
                break;
            }
            // Nothing about it is a dialog, and no opening shows.
            if cx.update(|_, cx| view.read(cx).hosted_project(cx).is_some()) {
                view.read_with(cx, |s, cx| {
                    assert!(!s.modal(cx), "a dialog showed");
                    assert!(s.files(cx).cloud_opening().is_none());
                });
            }
            assert!(
                std::time::Instant::now() < deadline,
                "{what} did not settle"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    };
    settle(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle(&view, cx, "the hosted Project", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
    });
    settle(&view, cx, "the workspace notice", &|s, cx| {
        s.session.project.read(cx).record.notice.is_some()
    });
    // Reopened once on its own, under a new lease, then it asked.
    assert_eq!(roots.load(std::sync::atomic::Ordering::SeqCst), 2);
    let (key, second) = view.read_with(cx, |s, cx| {
        assert!(!s.modal(cx));
        assert!(!s.session.project.read(cx).record.reconnecting);
        assert!(!s.home_visible(cx));
        let second = s.files(cx).workspace.clone().unwrap();
        assert!(second.lost());
        (s.files(cx).workspace_key().unwrap().to_owned(), second)
    });
    // It does not reopen again on its own.
    for _ in 0..20 {
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(roots.load(std::sync::atomic::Ordering::SeqCst), 2);
    view.update(cx, |s, cx| s.retry_workspace_surface(cx));
    settle(&view, cx, "the rebound host", &|s, cx| {
        s.files(cx)
            .workspace
            .as_ref()
            .is_some_and(|ws| !std::sync::Arc::ptr_eq(ws, &second))
    });
    // The same retained host, bound to the new lease.
    view.read_with(cx, |s, cx| {
        assert_eq!(s.files(cx).workspace_key(), Some(key.as_str()));
        assert_eq!(s.hosted_project(cx).as_deref(), Some("project-a"));
    });
    let reopened = crate::platform::diagnostics::recorded("[cloud-recovery] quiet reopen ended");
    assert!(
        reopened.iter().any(|l| l["fields"]["outcome"] == "rebound"),
        "{reopened:?}"
    );
}

/// The service replaced the hosted Workspace while a document was open: the
/// window reopens it quietly, the document stays open in its place, and the
/// person on the Homepage stays there.
#[gpui::test]
fn a_replaced_workspace_reopens_quietly_and_keeps_its_document(cx: &mut TestAppContext) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let (view, cx) = setup(cx);
    let roots = std::sync::Arc::new(AtomicUsize::new(0));
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new({
        let roots = roots.clone();
        move |request| {
            let path = request.path.as_str();
            if path.ends_with("/repository-context") {
                roots.fetch_add(1, Ordering::SeqCst);
            }
            if path.ends_with("/workbench/file") {
                return Ok(cloud_file(b"# Cloud\n"));
            }
            cloud_project_responder()(request)
        }
    });
    let (broker, browser, replace) = crate::cloud::auth::responding_live_account_fixture(responder);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle_cloud(&view, cx, "the hosted Project", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
    });
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFile("cloud.md".into())))
    });
    let opened = |s: &Shell, cx: &App| {
        s.files(cx)
            .opened()
            .is_some_and(|(_, path)| path == std::path::Path::new("cloud.md"))
    };
    settle_cloud(&view, cx, "the document", &opened);
    let first = view.read_with(cx, |s, cx| s.files(cx).workspace.clone().unwrap());
    // The person goes to the Homepage; the Project stays open behind it.
    command(&view, cx, Command::Home);
    view.read_with(cx, |s, cx| assert!(s.home_visible(cx)));
    // The service replaces the Workspace: its change stream ends.
    replace.store(true, std::sync::atomic::Ordering::SeqCst);
    settle_cloud(&view, cx, "the quiet reopen", &|s, cx| {
        assert!(!s.modal(cx), "a dialog showed: {:?}", s.files(cx).error);
        assert!(s.files(cx).cloud_opening().is_none());
        s.files(cx)
            .workspace
            .as_ref()
            .is_some_and(|ws| !std::sync::Arc::ptr_eq(ws, &first))
            && !s.session.project.read(cx).record.reconnecting
    });
    assert_eq!(roots.load(Ordering::SeqCst), 2);
    view.read_with(cx, |s, cx| {
        assert!(s.session.project.read(cx).record.notice.is_none());
        // Still on the Homepage, the document still open behind it.
        assert!(s.home_visible(cx));
        assert!(opened(s, cx));
    });
}

/// A file asked for in the moment the hosted Project lost its lease opens
/// once it is back, without a dialog.
#[gpui::test]
fn a_file_asked_for_while_reconnecting_opens_once_the_project_is_back(cx: &mut TestAppContext) {
    use std::sync::atomic::{AtomicBool, Ordering};
    let (view, cx) = setup(cx);
    // The reopen is held until the file has been asked for.
    let hold = std::sync::Arc::new(AtomicBool::new(false));
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new({
        let hold = hold.clone();
        move |request| {
            let path = request.path.as_str();
            if path.ends_with("/repository-context") {
                while hold.load(Ordering::SeqCst) {
                    std::thread::sleep(std::time::Duration::from_millis(2));
                }
            }
            if path.ends_with("/workbench/file") {
                return Ok(cloud_file(b"# Cloud\n"));
            }
            cloud_project_responder()(request)
        }
    });
    let (broker, browser, replace) = crate::cloud::auth::responding_live_account_fixture(responder);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle_cloud(&view, cx, "the hosted Project", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
    });
    hold.store(true, Ordering::SeqCst);
    replace.store(true, Ordering::SeqCst);
    settle_cloud(&view, cx, "the reconnecting notice", &|s, cx| {
        s.session.project.read(cx).record.reconnecting
    });
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFile("cloud.md".into())))
    });
    hold.store(false, Ordering::SeqCst);
    settle_cloud(&view, cx, "the document", &|s, cx| {
        assert!(!s.modal(cx), "a dialog showed");
        s.files(cx)
            .opened()
            .is_some_and(|(_, path)| path == std::path::Path::new("cloud.md"))
    });
    view.read_with(cx, |s, cx| {
        assert!(!s.session.project.read(cx).record.reconnecting);
        assert!(s.session.project.read(cx).record.notice.is_none());
    });
}

#[gpui::test]
fn a_failed_opening_offers_its_recovery_and_retry_repeats_that_opening(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let attempts = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = attempts.clone();
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new(move |request| {
        if request.path.ends_with("/repository-context")
            && counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0
        {
            return Err(crate::cloud::auth::Error::Response(
                503,
                None,
                Default::default(),
            ));
        }
        cloud_project_responder()(request)
    });
    let (broker, browser, _) = crate::cloud::auth::responding_live_account_fixture(responder);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    let settle = |view: &Entity<Shell>,
                  cx: &mut VisualTestContext,
                  what: &str,
                  ready: &dyn Fn(&Shell, &App) -> bool| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            cx.update(|w, cx| {
                w.draw(cx).clear(cx);
            });
            if cx.update(|_, cx| ready(view.read(cx), cx)) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "{what} did not settle"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    };
    settle(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle(&view, cx, "the recovery", &|s, cx| {
        s.has_dialog("CloudRecovery", cx)
    });
    view.update(cx, |s, cx| {
        let Some((project, failure)) = s.cloud.read(cx).recovery.as_ref() else {
            panic!("no recovery")
        };
        let (project, failure) = (project.clone(), failure.clone());
        assert_eq!(project, "project-a");
        // 5xx: the service is unavailable, retry; the status is a detail.
        assert_eq!(failure.code, "service-unavailable");
        assert_eq!(failure.status, Some(503));
        assert!(matches!(
            failure.recovery,
            crate::workspace::cloud::opening::Recovery::Retry
        ));
        cx.notify();
    });
    draw(cx);
    // Retry repeats the same opening, which now succeeds.
    view.update(cx, |s, cx| {
        s.cloud.update(cx, |c, cx| c.close_cloud_recovery(cx));
        s.open_cloud("project-a".into(), cx);
    });
    settle(&view, cx, "the retried opening", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
    });
    assert_eq!(attempts.load(std::sync::atomic::Ordering::SeqCst), 2);
}

#[gpui::test]
fn an_unlinked_folder_puts_itself_in_the_cloud_from_the_place_menu(cx: &mut TestAppContext) {
    use crate::cloud::publication::fixtures::{Fake, coordinator};
    let (temp, fake) = Fake::new();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("a.md"), "# A\n").unwrap();
    std::process::Command::new("git")
        .args(["init", "-q", "-b", "main"])
        .current_dir(&root)
        .status()
        .unwrap();
    let (view, cx) = setup(cx);
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new(|request| {
        if request.path.ends_with("/organizations/") {
            return Ok(serde_json::json!({"code": 0, "data": [{"id": "org-1", "name": "Mine"}]}));
        }
        cloud_project_responder()(request)
    });
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
        let fake = fake.clone();
        crate::features::cloud::install_factory(
            std::sync::Arc::new(move |_, _| coordinator(&fake).0),
            cx,
        );
    });
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(root.clone())))
    });
    settle_cloud(&view, cx, "the local project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(root.as_path())
    });
    // No Cloud remote: the folder's activation entry opens its publication.
    view.update_in(cx, |s, w, cx| {
        s.cloud.update(cx, |c, cx| c.put_in_cloud(w, cx))
    });
    settle_cloud(&view, cx, "the organization", &|s, cx| {
        s.has_dialog("CloudPublish", cx)
            && s.cloud.read(cx).publish.read(cx).selected.as_deref() == Some("org-1")
    });
    // Upload to Cloud runs the publication; the dialog can go to the
    // background while the Header states the run.
    view.update(cx, |s, cx| {
        s.cloud.read(cx).publish.clone().update(cx, |p, cx| {
            p.start(crate::cloud::publication::Action::Initialize, cx)
        })
    });
    // Escape puts the dialog away without cancelling the publication.
    command(&view, cx, Command::Escape);
    view.read_with(cx, |s, cx| assert!(!s.has_dialog("CloudPublish", cx)));
    settle_cloud(&view, cx, "the publication", &|s, cx| {
        let p = s.cloud.read(cx).publish.read(cx);
        if let Some(error) = p.outcome.as_ref().and_then(|o| o.error.as_ref()) {
            panic!("{error:?}");
        }
        p.published.as_deref() == Some("project-a")
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.cloud.read(cx).publish.read(cx).header_status(),
            Some(crate::features::cloud::HeaderStatus::Completed)
        );
        // Finished while its dialog was put away: the Header announces it.
        assert_eq!(
            s.cloud.read(cx).publish.read(cx).header_mark(),
            Some(crate::features::cloud::HeaderStatus::Completed)
        );
        // The folder stays open: its Cloud project is another project.
        assert_eq!(s.workspace_root(cx).as_deref(), Some(root.as_path()));
        assert!(s.hosted_project(cx).is_none());
        assert!(
            crate::cloud::publication::journal::Journal::in_git_dir(&fake.git_dir)
                .read()
                .unwrap()
                .is_none()
        );
    });
}

#[gpui::test]
fn a_vanished_cloud_projects_link_is_ended_from_its_notice(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("a.md"), "# A\n").unwrap();
    let git = |args: &[&str]| {
        assert!(
            std::process::Command::new("git")
                .args(args)
                .current_dir(&root)
                .status()
                .unwrap()
                .success()
        )
    };
    git(&["init", "-q", "-b", "main"]);
    let url = "http://127.0.0.1:18080/git/project-a.git";
    git(&["remote", "add", "puppyone", url]);
    let authorizations = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = authorizations.clone();
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new(move |request| {
        if request.path.ends_with("/repository-context") {
            counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            return Err(crate::cloud::auth::Error::Http(404));
        }
        cloud_project_responder()(request)
    });
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    let settle = |view: &Entity<Shell>,
                  cx: &mut VisualTestContext,
                  what: &str,
                  ready: &dyn Fn(&Shell, &App) -> bool| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            cx.update(|w, cx| {
                w.draw(cx).clear(cx);
            });
            if cx.update(|_, cx| ready(view.read(cx), cx)) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "{what} did not settle"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    };
    settle(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(root.clone())))
    });
    settle(&view, cx, "the missing association", &|s, cx| {
        matches!(
            s.cloud.read(cx).repository.read(cx).context,
            crate::workspace::cloud::repository::Context::NotFound { .. }
        )
    });
    // The place states the missing link; it can be ended instead.
    view.read_with(cx, |s, cx| {
        let link = s.place_menu_now(cx).and_then(|m| m.link);
        assert!(matches!(
            link,
            Some((super::project_place::Notice::Missing, _))
        ));
    });
    settle(&view, cx, "the reviewed remote", &|s, cx| {
        s.cloud.read(cx).disconnectable(cx)
    });
    view.update_in(cx, |s, w, cx| {
        s.cloud.update(cx, |c, cx| c.open_disconnect(w, cx))
    });
    view.read_with(cx, |s, cx| {
        assert!(s.has_dialog("CloudDisconnect", cx));
        assert_eq!(
            s.cloud.read(cx).disconnect.as_ref().map(|d| d.url.as_str()),
            Some(url)
        );
    });
    // A connection that changed after it was reviewed is not ended: the
    // link stays and the dialog says ending it failed.
    git(&[
        "remote",
        "set-url",
        "puppyone",
        "http://127.0.0.1:18080/git/other.git",
    ]);
    view.update(cx, |s, cx| {
        s.cloud.update(cx, |c, cx| c.confirm_disconnect(cx))
    });
    settle(&view, cx, "the refused detach", &|s, cx| {
        s.cloud
            .read(cx)
            .disconnect
            .as_ref()
            .is_some_and(|d| d.failed && !d.busy)
    });
    view.read_with(cx, |s, cx| assert!(s.has_dialog("CloudDisconnect", cx)));
    git(&["remote", "set-url", "puppyone", url]);
    view.update(cx, |s, cx| {
        s.cloud.update(cx, |c, cx| c.confirm_disconnect(cx))
    });
    settle(&view, cx, "the local detach", &|s, cx| {
        matches!(
            s.cloud.read(cx).repository.read(cx).context,
            crate::workspace::cloud::repository::Context::LocalOnly
        ) && !s.has_dialog("CloudDisconnect", cx)
    });
    // Only the folder's Git connection went; the files stay.
    assert!(root.join("a.md").exists());
    let remotes = std::process::Command::new("git")
        .args(["remote"])
        .current_dir(&root)
        .output()
        .unwrap();
    assert!(String::from_utf8_lossy(&remotes.stdout).trim().is_empty());
}

#[gpui::test]
fn a_refused_association_leaves_the_account_catalog_usable(cx: &mut TestAppContext) {
    let base = cloud_project_responder();
    let responder = with_catalog(std::sync::Arc::new(move |request| {
        if request.path.ends_with("/repository-context") {
            return Err(crate::cloud::auth::Error::Http(403));
        }
        base(request)
    }));
    let (view, cx, Linked { root, _temp, .. }) = linked_checkout(cx, responder);
    settle_cloud(&view, cx, "the refusal", &|s, cx| {
        s.cloud.read(cx).repository.read(cx).context
            == crate::workspace::cloud::repository::Context::NotAuthorized
    });
    // The catalog still loads and lists the Cloud Project (merged by the
    // checkout's trusted locator, not by the refused authorization).
    settle_cloud(&view, cx, "the catalog", &|s, cx| {
        s.home
            .read(cx)
            .project_items(cx)
            .iter()
            .any(|i| i.cloud_project.as_deref() == Some("project-a"))
    });
    view.update(cx, |s, cx| {
        assert_eq!(s.workspace_root(cx).as_deref(), Some(root.as_path()));
        assert_eq!(
            s.cloud.read(cx).catalog.read(cx).state,
            crate::features::cloud::CatalogState::Ready(vec![
                crate::workspace::cloud::catalog::CloudEntry {
                    id: "project-a".into(),
                    name: "Fixture Cloud".into(),
                    updated: Some(1_790_812_800_000),
                    ..Default::default()
                }
            ])
        );
        assert!(!s.modal(cx));
    });
}

/// A Cloud project that fails to open from a folder leaves the folder open
/// with the failure's recovery over it; nothing navigates.
#[gpui::test]
fn a_failed_cloud_opening_keeps_the_folder_open_with_its_recovery(cx: &mut TestAppContext) {
    let base = cloud_project_responder();
    let responder = with_catalog(std::sync::Arc::new(move |request| {
        if request.path.ends_with("/workbench/files") {
            return Err(crate::cloud::auth::Error::Http(503));
        }
        base(request)
    }));
    let (view, cx, Linked { root, _temp, .. }) = linked_checkout(cx, responder);
    settle_cloud(&view, cx, "the association", &|s, cx| {
        s.cloud.read(cx).repository.read(cx).context.project() == Some("project-a")
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle_cloud(&view, cx, "the failure", &|s, cx| {
        s.has_dialog("CloudRecovery", cx)
            && s.cloud
                .read(cx)
                .recovery
                .as_ref()
                .is_some_and(|(p, _)| p == "project-a")
    });
    // The catalog loads on its own clock and still lists the project.
    settle_cloud(&view, cx, "the catalog", &|s, cx| {
        s.home
            .read(cx)
            .project_items(cx)
            .iter()
            .any(|i| i.cloud_project.as_deref() == Some("project-a"))
    });
    view.update(cx, |s, cx| {
        // Still the folder, never the project picker or the Homepage.
        assert_eq!(s.workspace_root(cx).as_deref(), Some(root.as_path()));
        assert!(!s.home_visible(cx));
        assert!(!s.has_dialog("ProjectEntry", cx));
        assert!(s.hosted_project(cx).is_none());
        assert!(s.files(cx).cloud_opening().is_none());
        assert!(s.has_dialog("CloudRecovery", cx));
    });
}

#[gpui::test]
fn a_catalog_reload_keeps_an_open_failure_and_retry_reopens_that_project(cx: &mut TestAppContext) {
    use std::sync::atomic::{AtomicBool, Ordering};
    let failing = std::sync::Arc::new(AtomicBool::new(true));
    let base = cloud_project_responder();
    let responder = with_catalog({
        let failing = failing.clone();
        std::sync::Arc::new(move |request| {
            if failing.load(Ordering::SeqCst) && request.path.ends_with("/workbench/files") {
                return Err(crate::cloud::auth::Error::Http(503));
            }
            base(request)
        })
    });
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    // Turning Cloud on loads the catalog.
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.change(|p| p.experimental.cloud_workspace = true, cx)
        })
    });
    settle_cloud(&view, cx, "the catalog", &|s, cx| {
        matches!(
            s.cloud.read(cx).catalog.read(cx).state,
            crate::features::cloud::CatalogState::Ready(_)
        )
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle_cloud(&view, cx, "the open failure", &|s, cx| {
        s.has_dialog("CloudRecovery", cx)
    });
    // Reloading the catalog leaves the failure in place.
    view.update(cx, |s, cx| s.refresh_cloud_catalog(true, cx));
    settle_cloud(&view, cx, "the reloaded catalog", &|s, cx| {
        matches!(
            s.cloud.read(cx).catalog.read(cx).state,
            crate::features::cloud::CatalogState::Ready(_)
        )
    });
    view.update(cx, |s, cx| {
        assert!(
            s.has_dialog("CloudRecovery", cx)
                && s.cloud
                    .read(cx)
                    .recovery
                    .as_ref()
                    .is_some_and(|(p, _)| p == "project-a")
        );
        assert!(s.hosted_project(cx).is_none());
    });
    // Retry repeats that opening, not a list refresh.
    failing.store(false, Ordering::SeqCst);
    view.update(cx, |s, cx| {
        s.cloud.update(cx, |c, cx| c.close_cloud_recovery(cx));
        s.open_cloud("project-a".into(), cx);
    });
    settle_cloud(&view, cx, "the reopened project", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
    });
}

/// §15 "User signs out after link": the Header shows the sign-in gate, and
/// signing in again resolves the same Project instead of offering to
/// create one.
#[gpui::test]
fn signing_out_after_a_link_gates_the_header_and_signing_in_finds_the_same_project(
    cx: &mut TestAppContext,
) {
    use crate::workspace::cloud::repository::{CloudState, Context};
    let (view, cx, Linked { relogin, _temp, .. }) =
        linked_checkout(cx, with_catalog(cloud_project_responder()));
    settle_cloud(&view, cx, "the association", &|s, cx| {
        s.cloud.read(cx).repository.read(cx).context.project() == Some("project-a")
    });
    cx.update(|_, cx| crate::features::cloud::account::sign_out(cx));
    settle_cloud(&view, cx, "the sign-in gate", &|s, cx| {
        let signed_in = crate::features::cloud::account::has_account(cx);
        !signed_in
            && s.cloud
                .read(cx)
                .repository
                .read(cx)
                .context
                .cloud_state(signed_in)
                == CloudState::SignedOut
    });
    relogin();
    settle_cloud(&view, cx, "signing in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    settle_cloud(&view, cx, "the same Project", &|s, cx| {
        crate::features::cloud::account::has_account(cx)
            && s.cloud.read(cx).repository.read(cx).context.project() == Some("project-a")
    });
    view.read_with(cx, |s, cx| {
        assert!(!matches!(
            s.cloud.read(cx).repository.read(cx).context,
            Context::LocalOnly | Context::NotFound { .. }
        ));
        assert!(s.cloud.read(cx).publish.read(cx).outcome.is_none());
    });
}

/// C-15.2: each injected failure reaches the Homepage opening's recovery
/// with the product's code and action; the failure never navigates.
#[gpui::test]
fn injected_opening_failures_reach_the_recovery_with_the_product_code(cx: &mut TestAppContext) {
    use crate::cloud::auth::{Error, ServiceCode};
    use crate::workspace::cloud::opening::Recovery;
    let cases: Vec<(&str, Error, &str, Recovery)> = vec![
        (
            "/workbench",
            Error::Unavailable,
            "connection-unreachable",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Response(504, None, Default::default()),
            "connection-timeout",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Response(408, None, Default::default()),
            "connection-timeout",
            Recovery::Retry,
        ),
        // A generic 5xx names the service only at the project stage.
        (
            "/workbench",
            Error::Response(503, None, Default::default()),
            "workspace-open-failed",
            Recovery::Retry,
        ),
        (
            "/repository-context",
            Error::Response(503, None, Default::default()),
            "service-unavailable",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Response(429, None, Default::default()),
            "service-busy",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Http(426),
            "app-update-required",
            Recovery::None,
        ),
        (
            "/workbench",
            Error::Http(402),
            "workspace-plan-required",
            Recovery::Account,
        ),
        (
            "/workbench",
            Error::Http(403),
            "workspace-access-denied",
            Recovery::None,
        ),
        (
            "/workbench",
            Error::Http(404),
            "workspace-service-unavailable",
            Recovery::None,
        ),
        (
            "/repository-context",
            Error::Http(404),
            "project-unavailable",
            Recovery::None,
        ),
        (
            "/repository-context",
            Error::Http(403),
            "project-access-denied",
            Recovery::None,
        ),
        (
            "/repository-context",
            Error::Response(
                503,
                Some("project_authorization_unavailable"),
                Default::default(),
            ),
            "access-check-unavailable",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Response(503, Some("database_schema_outdated"), Default::default()),
            "service-updating",
            Recovery::Retry,
        ),
        // Replaced while opening, twice: reopened once, then reported.
        (
            "/workbench",
            Error::Service(409, ServiceCode::GenerationChanged),
            "workspace-changed",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Response(503, Some("workbench_disk_lost"), Default::default()),
            "workspace-disk-lost",
            Recovery::Retry,
        ),
    ];
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let mut seen = vec![];
    for (suffix, error, _, _) in &cases {
        let base = cloud_project_responder();
        let (suffix, error) = (*suffix, *error);
        let responder: crate::cloud::auth::Responder = std::sync::Arc::new(move |request| {
            if request.path.ends_with(suffix) {
                return Err(error);
            }
            base(request)
        });
        let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
        cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
        settle_cloud(&view, cx, "sign-in", &|_, cx| {
            crate::features::cloud::account::has_account(cx)
        });
        view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
        settle_cloud(&view, cx, "the recovery", &|s, cx| {
            s.has_dialog("CloudRecovery", cx)
        });
        view.update(cx, |s, cx| {
            let failure = s.cloud.read(cx).recovery.as_ref().map(|(_, f)| f.clone());
            let failure = failure.unwrap();
            seen.push((failure.code, failure.recovery));
            assert!(s.hosted_project(cx).is_none());
            s.cloud.update(cx, |c, cx| c.close_cloud_recovery(cx));
        });
    }
    let expected: Vec<_> = cases.iter().map(|(_, _, c, r)| (*c, *r)).collect();
    assert_eq!(seen, expected);
}

/// `useAccountCloudWorkspace`: a workspace that moved while it was opening
/// is opened again once by itself, and the user hears nothing.
#[gpui::test]
fn a_workspace_replaced_while_opening_is_opened_again_once(cx: &mut TestAppContext) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let replaced = std::sync::Arc::new(AtomicUsize::new(0));
    let counted = replaced.clone();
    let base = cloud_project_responder();
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new(move |request| {
        if request.path.ends_with("/workbench") && counted.fetch_add(1, Ordering::SeqCst) == 0 {
            return Err(crate::cloud::auth::Error::Service(
                409,
                crate::cloud::auth::ServiceCode::NotRunning,
            ));
        }
        base(request)
    });
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle_cloud(&view, cx, "the hosted Project", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
    });
    view.read_with(cx, |s, cx| assert!(!s.has_dialog("CloudRecovery", cx)));
    assert!(replaced.load(Ordering::SeqCst) >= 2);
}

/// `ProjectNavigationFailure`: the server's code and request id beside the
/// message, with Copy details; and one local log line naming no project.
#[gpui::test]
fn a_failed_opening_names_its_code_and_request_for_a_report(cx: &mut TestAppContext) {
    use crate::cloud::auth::{Error, model::Diagnostic};
    let diagnostic = Diagnostic::read(
        &serde_json::json!({"data": {"code": "workbench_disk_lost", "retryable": true}}),
        Some("req-7f3a"),
    );
    let base = cloud_project_responder();
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new(move |request| {
        if request.path.ends_with("/workbench") {
            return Err(Error::Response(
                503,
                Some("workbench_disk_lost"),
                diagnostic,
            ));
        }
        base(request)
    });
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle_cloud(&view, cx, "the recovery", &|s, cx| {
        s.has_dialog("CloudRecovery", cx)
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-open-diagnostic").is_some());
    let failure = view.read_with(cx, |s, cx| s.cloud.read(cx).recovery.clone().unwrap().1);
    assert_eq!(failure.code, "workspace-disk-lost");
    assert_eq!(
        failure.diagnostic(),
        Some((Some("workbench_disk_lost".into()), Some("req-7f3a".into())))
    );
    let lines = crate::platform::diagnostics::recorded("[cloud-opening] request failed");
    let line = lines
        .iter()
        .find(|l| l["fields"]["request_id"] == "req-7f3a")
        .expect("the opening's log line");
    assert_eq!(line["fields"]["stage"], "status");
    assert_eq!(line["fields"]["code"], "workbench_disk_lost");
    assert!(!line.to_string().contains("project-a"));
}

#[gpui::test]
fn open_post_and_root_files_failures_surface_diagnostics_in_recovery_dialog(
    cx: &mut TestAppContext,
) {
    use crate::cloud::auth::{Error, model::Diagnostic};
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });

    for (stage, req_id) in [("open", "req-open-ui"), ("files", "req-files-ui")] {
        let diagnostic = Diagnostic::read(
            &serde_json::json!({"data": {"code": "workbench_preparing", "retryable": true}}),
            Some(req_id),
        );
        let base = cloud_project_responder();
        let responder: crate::cloud::auth::Responder = std::sync::Arc::new(move |request| {
            if stage == "open" && request.path.ends_with("/workbench") {
                if request.method == reqwest::Method::GET {
                    return Ok(serde_json::json!({
                        "workspace": {
                            "id": "workspace-a",
                            "project_id": "project-a",
                            "generation": "9bb16f54-dfe9-4d26-8c68-c7b1ae97d859",
                            "state": "paused",
                            "operation": null
                        }
                    }));
                }
                return Err(Error::Response(
                    503,
                    Some("workbench_preparing"),
                    diagnostic,
                ));
            }
            if stage == "files" && request.path.ends_with("/workbench/files") {
                return Err(Error::Response(
                    503,
                    Some("workbench_preparing"),
                    diagnostic,
                ));
            }
            base(request)
        });
        let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
        cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
        settle_cloud(&view, cx, "sign-in", &|_, cx| {
            crate::features::cloud::account::has_account(cx)
        });
        view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
        settle_cloud(&view, cx, "the recovery", &|s, cx| {
            s.has_dialog("CloudRecovery", cx)
        });
        draw(cx);
        assert!(
            cx.debug_bounds("cloud-open-diagnostic").is_some(),
            "missing diagnostic in stage {stage}"
        );
        let failure = view.read_with(cx, |s, cx| s.cloud.read(cx).recovery.clone().unwrap().1);
        assert_eq!(failure.code, "workspace-preparing");
        assert_eq!(
            failure.diagnostic(),
            Some((Some("workbench_preparing".into()), Some(req_id.into())))
        );
        let lines = crate::platform::diagnostics::recorded("[cloud-opening] request failed");
        let line = lines
            .iter()
            .find(|l| l["fields"]["request_id"] == req_id)
            .expect("the opening's log line");
        assert_eq!(line["fields"]["stage"], stage);
        assert_eq!(line["fields"]["code"], "workbench_preparing");
        view.update(cx, |s, cx| {
            s.cloud.update(cx, |c, cx| c.close_cloud_recovery(cx));
        });
    }
}

/// `opening a Cloud project from the cached list`: chosen while the
/// session is still being restored, it waits instead of saying nobody is
/// signed in, and opens once the session turns up; signed out once the
/// session is known to be gone; never if the person went elsewhere first.
#[gpui::test]
fn opening_a_cloud_project_waits_for_the_restoring_session(cx: &mut TestAppContext) {
    use crate::cloud::auth::Status;
    let (view, cx) = setup(cx);
    let (broker, browser) =
        crate::cloud::auth::responding_account_fixture(cloud_project_responder());
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let account =
        cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "the account", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    let signed_in = account.read_with(cx, |a, _| a.snapshot.clone().unwrap());
    let set = |cx: &mut VisualTestContext, status: Status| {
        account.update(cx, |a, cx| {
            let mut snapshot = signed_in.clone();
            snapshot.status = status;
            if status != Status::Authenticated {
                snapshot.account = None;
            }
            a.snapshot = Some(snapshot);
            cx.notify();
        });
        draw(cx);
    };
    let errors = |cx: &mut VisualTestContext| {
        view.read_with(cx, |s, cx| {
            s.dialog_names(cx)
                .into_iter()
                .filter(|n| n.starts_with("Error("))
                .count()
        })
    };
    let opening = |cx: &mut VisualTestContext| {
        view.read_with(cx, |s, cx| s.files(cx).cloud_opening().is_some())
    };

    // Waits for the session, then opens.
    set(cx, Status::Restoring);
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    draw(cx);
    assert!(!opening(cx), "nothing opens before the session is known");
    assert_eq!(errors(cx), 0, "not reported as signed out");
    set(cx, Status::Authenticated);
    assert!(opening(cx), "it opens once the session turns up");
    assert_eq!(errors(cx), 0);
    settle_cloud(&view, cx, "the project", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
    });

    // Signed out only once the session is known to be gone.
    set(cx, Status::Restoring);
    view.update(cx, |s, cx| s.open_cloud("project-b".into(), cx));
    draw(cx);
    assert_eq!(errors(cx), 0);
    set(cx, Status::SignedOut);
    assert_eq!(errors(cx), 1, "now it is known that nobody is signed in");
    view.read_with(cx, |s, cx| {
        assert!(
            s.dialog_names(cx)
                .iter()
                .any(|n| n.contains(crate::localization::t(
                    "cloud.message.project-sign-in-required"
                )))
        )
    });
    assert!(view.read_with(cx, |s, cx| {
        s.session.project.read(cx).awaiting_session.is_none()
    }));

    // A project the person has since left is not opened.
    set(cx, Status::Restoring);
    view.update(cx, |s, cx| s.open_cloud("project-c".into(), cx));
    let elsewhere = tempfile::tempdir().unwrap();
    view.update_in(cx, |s, window, cx| {
        s.open_project(elsewhere.path().to_path_buf(), window, cx)
    });
    set(cx, Status::Authenticated);
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.session.project.read(cx).awaiting_session.is_none());
        assert_ne!(
            s.session.project.read(cx).record.cloud.as_deref(),
            Some("project-c")
        );
    });
}

/// `resolves an exact Scope while preserving its owning Project` and
/// `never broadens a scoped checkout into its whole Cloud project`: a Scope
/// checkout is resolved as its exact Scope (its place in the Project kept),
/// is said to be linked to its Project, and offers no way to open the whole
/// Project.
#[gpui::test]
fn a_scope_checkout_is_linked_to_its_project_but_never_opens_it(cx: &mut TestAppContext) {
    use super::project_place::{LinkedEntry, Notice, linked_entry, notice_act};
    use std::sync::{Arc, Mutex};
    let asked = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let base = cloud_project_responder();
    let responder: crate::cloud::auth::Responder = Arc::new({
        let asked = asked.clone();
        move |request| {
            if request.path.ends_with("/repository-context") {
                let target = request
                    .body
                    .as_ref()
                    .map(|b| b["target"].clone())
                    .unwrap_or_default();
                asked.lock().unwrap().push(target.clone());
                return Ok(serde_json::json!({"code": 0, "data": {
                    "target": target,
                    "project": {"id": "project-a", "name": "Notes", "capabilities": ["content.read"]},
                    "scope_path": "docs"}}));
            }
            base(request)
        }
    });
    let (view, cx, _linked) = linked_checkout_at(
        cx,
        responder,
        "http://127.0.0.1:18080/git/project-a/scopes/scope-docs.git",
    );
    settle_cloud(&view, cx, "the association", &|s, cx| {
        s.cloud.read(cx).repository.read(cx).context.project() == Some("project-a")
    });
    assert_eq!(
        *asked.lock().unwrap(),
        [serde_json::json!({"kind": "scope", "project_id": "project-a", "scope_id": "scope-docs"})]
    );
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.cloud.read(cx).repository.read(cx).context,
            crate::workspace::cloud::repository::Context::Resolved {
                project: "project-a".into(),
                name: "Notes".into(),
                scope: Some("docs".into()),
            }
        );
        let notice = s.cloud.read(cx).local_folder_notice(cx).expect("a notice");
        assert_eq!(
            notice,
            Notice::Linked {
                project: "project-a".into(),
                name: Some("Notes".into()),
                openable: false,
            }
        );
        assert_eq!(notice_act(&notice, true), None, "it only explains");
        assert!(s.hosted_project(cx).is_none());
        assert!(s.files(cx).cloud_opening().is_none());
    });
    assert_eq!(linked_entry(false, false), LinkedEntry::Explain);
    assert_eq!(linked_entry(false, true), LinkedEntry::Publish);
}
