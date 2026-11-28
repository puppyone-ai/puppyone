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
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
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
/// While a project opens, the right sidebar's column waits in its place
/// (its Agent is not bound yet: no tabs from before), with or without a
/// Header, and both column edges stay so the layout never jumps.
#[gpui::test]
fn the_right_sidebar_waits_in_its_column_while_a_project_opens(cx: &mut TestAppContext) {
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new(|request| {
        if request.path.ends_with("/workbench/files") {
            std::thread::sleep(std::time::Duration::from_millis(600));
        }
        cloud_project_responder()(request)
    });
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(with_catalog(responder));
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs.store.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            p.state.experimental.hidden_header = true;
        });
        s.panes.update(cx, |p, cx| p.set_right_open(true, cx));
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "the catalog", &|s, cx| {
        s.home
            .read(cx)
            .project_items(cx)
            .iter()
            .any(|i| i.label == "Fixture Cloud")
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    draw(cx);
    view.read_with(cx, |s, cx| assert!(s.opening(cx)));
    let column = view.read_with(cx, |s, _| s.frame.layout.auxiliary);
    let waiting = cx
        .debug_bounds("right-sidebar-waiting")
        .expect("the right sidebar's column waits");
    assert!((f32::from(waiting.origin.x) - column.x).abs() < 0.5);
    assert!((f32::from(waiting.size.width) - column.w).abs() < 0.5);
    // Windows draws its window controls in a row atop the right column.
    let controls = if cfg!(target_os = "windows") {
        crate::theme::HEADER
    } else {
        0.
    };
    assert_eq!(
        f32::from(waiting.origin.y),
        controls,
        "from the top without a Header"
    );
    assert!(cx.debug_bounds("right-sash").is_some(), "its edge stays");
    assert!(
        cx.debug_bounds("left-sash").is_some(),
        "the Explorer's edge stays"
    );
    command(&view, cx, Command::Escape);
    draw(cx);
    assert!(cx.debug_bounds("right-sidebar-waiting").is_none());
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
    // A small folder's worker may finish before it is looked at; either
    // way, the latest choice is the one under way.
    let chosen = |s: &Shell, cx: &App, dir: &std::path::Path| {
        s.files(cx).preparing_root() == Some(dir) || s.workspace_root(cx).as_deref() == Some(dir)
    };
    view.update_in(cx, |s, w, cx| {
        s.open_project(first.clone(), w, cx);
        assert!(chosen(s, cx, &first));
        s.open_project(second.clone(), w, cx);
        assert!(chosen(s, cx, &second));
        assert_ne!(s.files(cx).preparing_root(), Some(first.as_path()));
    });
    settle_cloud(&view, cx, "the second project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(second.as_path())
    });
}

/// Regression for pre-loaded preferences (`3394b48c3`): when `preferences.json`
/// already exists on disk, `PreferencesStore` starts with `loaded == true` and
/// does not emit `PreferencesChanged` later. A launch with `restore_last = true`
/// must still restore the last project, pane layout and right-sidebar surface
/// immediately instead of staying stuck on `RestoringWorkspaceScreen` forever.
#[gpui::test]
fn preloaded_preferences_restore_last_project_and_layout_without_hanging(cx: &mut TestAppContext) {
    use crate::features::settings::{Preferences, PreferencesStore, RightSidebarSurface};
    cx.executor().allow_parking();
    cx.update(|cx| {
        bind_keys(cx);
        crate::ui::input::bind_keys(cx);
        crate::editor::view::bind_keys(cx);
        crate::editor::csv::bind_keys(cx);
        crate::editor::host::bind_keys(cx);
    });

    let project_dir = tempfile::tempdir().unwrap();
    let project_root = project_dir.path().canonicalize().unwrap();
    std::fs::write(project_root.join("welcome.md"), "# Welcome\n").unwrap();

    let data_dir = tempfile::tempdir().unwrap();
    let mut saved = Preferences {
        sidebar_collapsed: true,
        explorer_width: 260.,
        right_sidebar_width: 400.,
        right_sidebar_surface: RightSidebarSurface::History,
        ..Default::default()
    };
    saved.remember_project(&project_root, 1);
    std::fs::write(
        data_dir.path().join("preferences.json"),
        serde_json::to_string(&saved).unwrap(),
    )
    .unwrap();

    let mut content = None;
    let (_, vcx) = cx.add_window_view(|w, cx| {
        let store = cx.new(|cx| PreferencesStore::isolated(data_dir.path().to_path_buf(), cx));
        assert!(
            store.read(cx).loaded,
            "saved preferences load synchronously"
        );
        let plan = windows::LaunchPlan {
            file: None,
            workspace: None,
            open_first: None,
            restore_last: true,
        };
        let view = cx.new(|cx| Shell::build(false, store, plan, w, cx));
        content = Some(view.clone());
        gpui_kit::base::Root::new(view, w, cx)
    });
    let view = content.unwrap();

    // Stored layout and sidebar surface are applied immediately on build, and
    // `restore_last` is already consumed (never stuck waiting for an event).
    view.read_with(vcx, |s, cx| {
        assert!(!s.session.project.read(cx).record.restore_last);
        assert_eq!(
            (
                s.panes.read(cx).explorer().open,
                s.panes.read(cx).explorer().width,
                s.panes.read(cx).right().width,
            ),
            (false, 260., 400.)
        );
        assert!(s.sidebar.read(cx).is(Surface::Git));
        assert!(s.sidebar.read(cx).source_control.read(cx).history_open());
    });

    // The remembered folder finishes opening and leaves the restoring state.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while view.read_with(vcx, |s, cx| {
        s.workspace_root(cx).as_deref() != Some(project_root.as_path()) || s.restoring(cx)
    }) {
        assert!(
            std::time::Instant::now() < deadline,
            "last project never finished restoring"
        );
        vcx.run_until_parked();
        view.update_in(vcx, |s, w, cx| s.receive(w, cx));
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    view.read_with(vcx, |s, cx| {
        assert!(!s.restoring(cx));
        assert!(!s.home_visible(cx));
    });
}

/// When saved preferences exist on disk without any valid remembered project,
/// a launch with `restore_last = true` leaves `RestoringWorkspaceScreen`
/// immediately and shows the Homepage (and a fresh profile without saved
/// preferences transitions once the worker delivers `Event::Fresh`).
#[gpui::test]
fn restore_last_releases_to_homepage_for_both_preloaded_and_fresh_profiles(
    cx: &mut TestAppContext,
) {
    use crate::features::settings::{Preferences, PreferencesStore};
    cx.executor().allow_parking();
    cx.update(|cx| {
        bind_keys(cx);
        crate::ui::input::bind_keys(cx);
        crate::editor::view::bind_keys(cx);
        crate::editor::csv::bind_keys(cx);
        crate::editor::host::bind_keys(cx);
    });

    // Case 1: Pre-loaded preferences with no existing recent projects.
    let preloaded_dir = tempfile::tempdir().unwrap();
    std::fs::write(
        preloaded_dir.path().join("preferences.json"),
        serde_json::to_string(&Preferences::default()).unwrap(),
    )
    .unwrap();
    let mut preloaded_view = None;
    let (_, vcx1) = cx.add_window_view(|w, cx| {
        let store = cx.new(|cx| PreferencesStore::isolated(preloaded_dir.path().to_path_buf(), cx));
        assert!(store.read(cx).loaded);
        let plan = windows::LaunchPlan {
            file: None,
            workspace: None,
            open_first: None,
            restore_last: true,
        };
        let view = cx.new(|cx| Shell::build(false, store, plan, w, cx));
        preloaded_view = Some(view.clone());
        gpui_kit::base::Root::new(view, w, cx)
    });
    let preloaded_view = preloaded_view.unwrap();
    preloaded_view.read_with(vcx1, |s, cx| {
        assert!(!s.restoring(cx), "preloaded empty profile must not hang");
        assert!(s.home_visible(cx));
    });

    // Case 2: Fresh profile (worker loads asynchronously via `Event::Fresh`).
    let fresh_dir = tempfile::tempdir().unwrap();
    let mut fresh_view = None;
    let (_, vcx2) = cx.add_window_view(|w, cx| {
        let store = cx.new(|cx| PreferencesStore::isolated(fresh_dir.path().to_path_buf(), cx));
        assert!(!store.read(cx).loaded);
        let plan = windows::LaunchPlan {
            file: None,
            workspace: None,
            open_first: None,
            restore_last: true,
        };
        let view = cx.new(|cx| Shell::build(false, store, plan, w, cx));
        fresh_view = Some(view.clone());
        gpui_kit::base::Root::new(view, w, cx)
    });
    let fresh_view = fresh_view.unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while fresh_view.read_with(vcx2, |s, cx| s.restoring(cx)) {
        assert!(
            std::time::Instant::now() < deadline,
            "fresh profile never finished restoring"
        );
        vcx2.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    fresh_view.read_with(vcx2, |s, cx| {
        assert!(!s.restoring(cx));
        assert!(s.home_visible(cx));
    });
}
