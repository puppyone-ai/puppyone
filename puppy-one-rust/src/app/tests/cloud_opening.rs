//! The window's Cloud projects: opening, joining, authority, recovery,
//! putting a folder in the Cloud.
use super::*;
use core::prelude::v1::test;

/// ADR-001: a folder and its Cloud project are two projects. The linked
/// folder's place menu opens the Cloud project, which takes this window's
/// place (no second window); the Cloud project's menu offers the folder.
#[gpui::test]
fn a_linked_folder_opens_its_cloud_project_in_the_same_window(cx: &mut TestAppContext) {
    use super::project_place::{Action, Place};
    let (view, cx, Linked { root, _temp, .. }) =
        linked_checkout(cx, with_catalog(cloud_project_responder()));
    settle_cloud(&view, cx, "the association", &|s, cx| {
        s.cloud.read(cx).repository.read(cx).context.project() == Some("project-a")
    });
    let windows = cx.update(|_, cx| cx.windows().len());
    let local_key = view.read_with(cx, |s, cx| s.files(cx).workspace_key().unwrap().to_owned());
    let menu = view.read_with(cx, |s, cx| s.place_menu_now(cx).unwrap());
    assert_eq!(menu.place, Place::Local);
    let Some(action @ Action::OpenCloudProject { .. }) = menu.action else {
        panic!("no Open Cloud project: {menu:?}")
    };
    // ⌘-less: the Header command opens the same menu.
    command(&view, cx, Command::LocationMenu);
    view.read_with(cx, |s, cx| {
        assert_eq!(s.chrome.read(cx).popover, Some(Popover::Place))
    });
    view.update_in(cx, |s, w, cx| {
        s.cloud
            .update(cx, |c, cx| c.run_place_action(action, w, cx))
    });
    view.read_with(cx, |s, cx| {
        assert!(s.chrome.read(cx).popover.is_none());
        // The Header names the Cloud project while it opens.
        assert_eq!(
            s.chrome.read(cx).opening_project_name(cx).as_deref(),
            Some("Fixture Cloud")
        );
    });
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
    cx.update(|_, cx| {
        let account = crate::features::cloud::account::install_fixture(broker, browser, cx);
        account.update(cx, |a, _| a.sign_out());
    });
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
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
    let account =
        cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let settle = |view: &Entity<Shell>,
                  cx: &mut VisualTestContext,
                  what: &str,
                  ready: &dyn Fn(&Shell, &App) -> bool| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            cx.update(|w, cx| {
                let _ = w.draw(cx);
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
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
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
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
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
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
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

#[gpui::test]
fn a_failed_cloud_subscription_offers_retry_which_rebinds_the_same_host(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // The fixture transport has no event stream: the subscription fails.
    let (broker, browser) =
        crate::cloud::auth::responding_account_fixture(cloud_project_responder());
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let settle = |view: &Entity<Shell>,
                  cx: &mut VisualTestContext,
                  what: &str,
                  ready: &dyn Fn(&Shell, &App) -> bool| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            cx.update(|w, cx| {
                let _ = w.draw(cx);
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
    settle(&view, cx, "the workspace notice", &|s, cx| {
        s.session.project.read(cx).record.notice.is_some()
    });
    // A notice floats; it is not a dialog.
    view.read_with(cx, |s, cx| assert!(!s.modal(cx)));
    let (key, first) = view.read_with(cx, |s, cx| {
        (
            s.files(cx).workspace_key().unwrap().to_owned(),
            s.files(cx).workspace.clone().unwrap(),
        )
    });
    view.update(cx, |s, cx| s.retry_workspace_surface(cx));
    settle(&view, cx, "the rebound host", &|s, cx| {
        s.files(cx)
            .workspace
            .as_ref()
            .is_some_and(|ws| !std::sync::Arc::ptr_eq(ws, &first))
    });
    // The same retained host, bound to the new lease.
    view.read_with(cx, |s, cx| {
        assert_eq!(s.files(cx).workspace_key(), Some(key.as_str()));
        assert_eq!(s.hosted_project(cx).as_deref(), Some("project-a"));
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
            return Err(crate::cloud::auth::Error::Response(503, None));
        }
        cloud_project_responder()(request)
    });
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let settle = |view: &Entity<Shell>,
                  cx: &mut VisualTestContext,
                  what: &str,
                  ready: &dyn Fn(&Shell, &App) -> bool| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            cx.update(|w, cx| {
                let _ = w.draw(cx);
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
    use super::project_place::Action;
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
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
        let fake = fake.clone();
        crate::features::cloud::install_factory(
            std::sync::Arc::new(move |_, _| coordinator(&fake).0),
            cx,
        );
    });
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
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
    // No Cloud remote: the place menu's one action is Put in the Cloud.
    settle_cloud(&view, cx, "the place menu", &|s, cx| {
        s.place_menu_now(cx).and_then(|m| m.action)
            == Some(Action::PutInCloud { continuing: false })
    });
    view.update_in(cx, |s, w, cx| {
        s.cloud.update(cx, |c, cx| {
            c.run_place_action(Action::PutInCloud { continuing: false }, w, cx)
        })
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
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let settle = |view: &Entity<Shell>,
                  cx: &mut VisualTestContext,
                  what: &str,
                  ready: &dyn Fn(&Shell, &App) -> bool| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            cx.update(|w, cx| {
                let _ = w.draw(cx);
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
    // Nothing is offered to replace it; the link can be ended instead.
    view.read_with(cx, |s, cx| {
        assert_eq!(s.place_menu_now(cx).and_then(|m| m.action), None)
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
    view.update(cx, |s, cx| {
        // Still the folder, never the project picker or the Homepage.
        assert_eq!(s.workspace_root(cx).as_deref(), Some(root.as_path()));
        assert!(!s.home_visible(cx));
        assert!(!s.has_dialog("ProjectEntry", cx));
        assert!(s.hosted_project(cx).is_none());
        assert!(s.files(cx).cloud_opening().is_none());
        // The catalog is untouched.
        assert!(
            s.home
                .read(cx)
                .project_items(cx)
                .iter()
                .any(|i| i.cloud_project.as_deref() == Some("project-a"))
        );
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
            Error::Response(504, None),
            "connection-timeout",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Response(408, None),
            "connection-timeout",
            Recovery::Retry,
        ),
        // A generic 5xx names the service only at the project stage.
        (
            "/workbench",
            Error::Response(503, None),
            "workspace-open-failed",
            Recovery::Retry,
        ),
        (
            "/repository-context",
            Error::Response(503, None),
            "service-unavailable",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Response(429, None),
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
            Error::Response(503, Some("project_authorization_unavailable")),
            "access-check-unavailable",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Response(503, Some("database_schema_outdated")),
            "service-updating",
            Recovery::Retry,
        ),
        (
            "/workbench",
            Error::Service(409, ServiceCode::GenerationChanged),
            "workspace-open-failed",
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
