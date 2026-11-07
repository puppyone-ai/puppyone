//! The project lifecycle: failures, openings, a newer choice.
use super::*;
use core::prelude::v1::test;

#[gpui::test]
fn a_project_that_cannot_open_reports_why_and_retries(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let missing = temp.path().join("gone");
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| s.open_project(missing.clone(), w, cx));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        if view.read_with(cx, |s, cx| s.has_dialog("ProjectFailure", cx)) {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "no failure dialog");
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    view.read_with(cx, |s, cx| {
        let Some((path, message)) = s.dialogs.read(cx).project_failure() else {
            panic!("the failure is the top dialog")
        };
        assert_eq!(&path, &missing);
        assert!(!message.is_empty());
        // Not the generic error dialog.
        assert!(s.files(cx).error.is_none());
    });
    // Retry opens the same folder again: the dialog goes, the opening
    // starts, and (the folder still missing) the same failure returns. A
    // fast failure may already be back when Retry returns.
    view.update_in(cx, |s, w, cx| {
        s.command(Command::RetryProjectOpen, w, cx);
        let failed_again = s.dialogs.read(cx).failed_project().as_ref() == Some(&missing);
        assert!(s.files(cx).opening_root() || failed_again);
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        if view.read_with(cx, |s, cx| {
            s.top_dialog(cx).as_deref() == Some("ProjectFailure")
                && s.dialogs.read(cx).failed_project().as_ref() == Some(&missing)
        }) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the retry did not run"
        );
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}
/// An opening is not over until its result is applied: between the worker
/// finishing and the window taking the result, the Header still names the
/// project it opens and no failure is reported.
#[gpui::test]
fn an_opening_stays_open_until_its_result_is_applied(cx: &mut TestAppContext) {
    let (view, cx, Linked { _temp, .. }) =
        linked_checkout(cx, with_catalog(cloud_project_responder()));
    settle_cloud(&view, cx, "the association", &|s, cx| {
        s.cloud.read(cx).repository.read(cx).context.project() == Some("project-a")
    });
    settle_cloud(&view, cx, "the catalog", &|s, cx| {
        s.home
            .read(cx)
            .project_items(cx)
            .iter()
            .any(|i| i.cloud_project.as_deref() == Some("project-a"))
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    // The worker finishes while nothing on this thread runs.
    std::thread::sleep(std::time::Duration::from_millis(300));
    view.read_with(cx, |s, cx| {
        assert!(s.files(cx).cloud_opening().is_some());
        assert_eq!(
            s.chrome.read(cx).opening_project_name(cx).as_deref(),
            Some("Fixture Cloud")
        );
        assert!(!s.has_dialog("CloudRecovery", cx));
    });
    settle_cloud(&view, cx, "the Cloud project", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
    });
    view.read_with(cx, |s, cx| {
        assert!(s.files(cx).cloud_opening().is_none());
        assert_eq!(s.chrome.read(cx).opening_project_name(cx), None);
    });
}
/// W-3: a Cloud project chosen on the Homepage is entered at once. Its
/// window waits (the Header names it, the Explorer column and the mark
/// stand in), and Escape abandons it for the Homepage again.
#[gpui::test]
fn a_cloud_project_is_entered_at_once_and_escape_abandons_it(cx: &mut TestAppContext) {
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new(|request| {
        if request.path.ends_with("/workbench/files") {
            std::thread::sleep(std::time::Duration::from_millis(600));
        }
        cloud_project_responder()(request)
    });
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(with_catalog(responder));
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    settle_cloud(&view, cx, "the catalog", &|s, cx| {
        s.home
            .read(cx)
            .project_items(cx)
            .iter()
            .any(|i| i.label == "Fixture Cloud")
    });
    view.read_with(cx, |s, cx| assert!(s.home_visible(cx)));
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.opening(cx));
        assert!(!s.home_visible(cx));
        assert_eq!(
            s.chrome.read(cx).opening_project_name(cx).as_deref(),
            Some("Fixture Cloud")
        );
    });
    assert!(cx.debug_bounds("project-preparation").is_some());
    command(&view, cx, Command::Escape);
    view.read_with(cx, |s, cx| {
        assert!(!s.opening(cx));
        assert!(s.home_visible(cx));
        assert!(s.hosted_project(cx).is_none());
    });
    assert!(cx.debug_bounds("project-preparation").is_none());
}
/// W-6: choosing another project while one is still opening replaces it.
#[gpui::test]
fn a_newer_choice_replaces_a_project_still_opening(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let first = temp.path().canonicalize().unwrap().join("first");
    let second = temp.path().canonicalize().unwrap().join("second");
    for dir in [&first, &second] {
        std::fs::create_dir(dir).unwrap();
        std::fs::write(dir.join("a.md"), "# A\n").unwrap();
    }
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        s.open_project(first.clone(), w, cx);
        assert_eq!(s.files(cx).preparing_root(), Some(first.as_path()));
        s.open_project(second.clone(), w, cx);
        assert_eq!(s.files(cx).preparing_root(), Some(second.as_path()));
    });
    settle_cloud(&view, cx, "the second project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(second.as_path())
    });
}
