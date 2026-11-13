//! The Header chrome: its popovers, focus, menus and the introductions.
use super::*;
use core::prelude::v1::test;

#[gpui::test]
fn native_buttons_toggle_slots_and_open_settings(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // Collapsed, the Explorer's expand button is in the Header.
    command(&view, cx, Command::ToggleExplorer);
    view.update(cx, |s, cx| assert!(!s.panes.read(cx).explorer().open));
    cx.simulate_click(point(px(100.), px(20.)), Modifiers::none());
    view.update(cx, |s, cx| assert!(s.panes.read(cx).explorer().open));
    command(&view, cx, Command::ToggleRightSidebar);
    view.update(cx, |s, cx| assert!(s.panes.read(cx).right().open));
    command(&view, cx, Command::Settings);
    view.update(cx, |s, cx| {
        assert_eq!(s.dialogs.read(cx).task(), Some(Task::Settings))
    });
    let retained = view.update(cx, |s, cx| {
        s.dialogs.read(cx).settings.clone().update(cx, |s, cx| {
            s.select_page(crate::features::settings::Page::ModelConnections, cx)
        });
        cx.notify();
        s.dialogs.read(cx).settings.entity_id()
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.update(cx, |s, cx| {
        s.dialogs.read(cx).settings.clone().update(cx, |s, cx| {
            s.select_page(crate::features::settings::Page::LocalAgents, cx)
        });
        cx.notify();
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    command(&view, cx, Command::Escape);
    command(&view, cx, Command::Settings);
    view.update(cx, |s, cx| {
        assert_eq!(s.dialogs.read(cx).settings.entity_id(), retained)
    });
}
#[gpui::test]
fn project_popup_toggle_outside_and_escape_restore_focus(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::ProjectMenu);
    view.update(cx, |s, cx| {
        assert_eq!(s.chrome.read(cx).popover, Some(Popover::Project))
    });
    command(&view, cx, Command::ProjectMenu);
    view.update(cx, |s, cx| assert!(s.chrome.read(cx).popover.is_none()));
    command(&view, cx, Command::ProjectMenu);
    cx.simulate_click(point(px(30.), px(700.)), Modifiers::none());
    view.update(cx, |s, cx| assert!(s.chrome.read(cx).popover.is_none()));
    command(&view, cx, Command::ProjectMenu);
    cx.simulate_keystrokes("escape");
    view.update_in(cx, |s, w, cx| {
        assert!(s.chrome.read(cx).popover.is_none());
        assert!(s.chrome.read(cx).project_focus.is_focused(w));
    });
}
/// `WindowNavigationRows`: the current place is checked; choosing a place
/// closes the menu and opens the Homepage on it. Escape closes the menu
/// and returns to the Header.
#[gpui::test]
fn a_place_opens_the_homepage_on_it_and_escape_closes_the_menu(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // The place menu shows only with an account service and Cloud on.
    let (broker, browser) = crate::cloud::auth::account_fixture();
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    draw(cx);
    command(&view, cx, Command::LocationMenu);
    draw(cx);
    draw(cx);
    let device = crate::localization::t(if cfg!(target_os = "macos") {
        "shell.workspaceSwitcher.location.thisMac"
    } else {
        "shell.workspaceSwitcher.location.thisComputer"
    });
    let selector: &'static str = Box::leak(format!("menu-item:{device}").into_boxed_str());
    assert!(
        cx.debug_bounds(selector).is_some(),
        "the place menu is open"
    );
    command(&view, cx, Command::Escape);
    view.update_in(cx, |s, w, cx| {
        assert!(s.chrome.read(cx).popover.is_none());
        assert!(s.chrome.read(cx).project_focus.is_focused(w));
    });
    command(&view, cx, Command::LocationMenu);
    draw(cx);
    draw(cx);
    let row = cx
        .debug_bounds(selector)
        .expect("the place menu opens again");
    cx.simulate_click(row.center(), Modifiers::none());
    view.read_with(cx, |s, cx| {
        assert!(s.chrome.read(cx).popover.is_none());
        assert!(s.session.project.read(cx).home);
        assert_eq!(
            s.home.read(cx).place_focus.as_ref().map(|f| f.0.clone()),
            Some(super::home::groups::GroupId::LocalOnly)
        );
    });
}
#[gpui::test]
fn project_menu_home_shows_the_homepage_and_hides_the_editor(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::ProjectMenu);
    command(&view, cx, Command::Home);
    view.update(cx, |s, cx| {
        assert!(s.session.project.read(cx).home && s.chrome.read(cx).popover.is_none());
        // Fixture shells stay on the workspace surface for visual capture.
        assert!(!s.home_visible(cx));
    });
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false)
    });
    view.update(cx, |s, cx| assert!(s.home_visible(cx)));
}
#[gpui::test]
fn opening_settings_dismisses_popup_without_document_transition(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::ProjectMenu);
    command(&view, cx, Command::Settings);
    view.update(cx, |s, cx| {
        assert_eq!(s.dialogs.read(cx).task(), Some(Task::Settings));
        assert!(s.chrome.read(cx).popover.is_none());
        assert!(matches!(s.files(cx).phase, Phase::Idle));
        assert!(s.files(cx).outgoing.is_empty());
    });
}
#[cfg(target_os = "macos")]
#[gpui::test]
fn macos_has_no_sidebar_footer_and_settings_stays_in_the_app_menu(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.read_with(cx, |s, _| {
        assert_eq!(s.frame.layout.footer.h, 0.);
        assert_eq!(
            s.frame.layout.explorer.bottom(),
            s.frame.layout.editor.bottom()
        );
    });
    let menus = app_menus();
    assert_eq!(menus[0].name.as_ref(), "PuppyOne");
    cx.simulate_keystrokes("cmd-,");
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert_eq!(s.dialogs.read(cx).task(), Some(Task::Settings))
    });
    cx.simulate_keystrokes("escape");
    view.read_with(cx, |s, cx| assert_eq!(s.dialogs.read(cx).task(), None));
}
#[gpui::test]
fn app_menu_about_and_check_for_updates_follow_the_product_menu(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // `createApplicationMenuTemplate`: the app, File, Edit, View, Theme,
    // Window and Help menus; File holds New Window, Manage Executions and
    // Close Window only.
    let menus = app_menus();
    let names: Vec<String> = menus.iter().map(|m| m.name.to_string()).collect();
    assert_eq!(names.len(), 7, "{names:?}");
    assert_eq!(names[0], "PuppyOne");
    assert_eq!(
        [&names[2], &names[3], &names[5], &names[6]],
        ["Edit", "View", "Window", "Help"]
    );
    let file: Vec<String> = menus[1]
        .items
        .iter()
        .filter_map(|item| match item {
            gpui::MenuItem::Action { name, .. } => Some(name.to_string()),
            _ => None,
        })
        .collect();
    assert_eq!(file.len(), 3, "{file:?}");
    assert_eq!(file[2], "Close Window");
    // About is the system's panel, never a dialog of the window.
    command(&view, cx, Command::About);
    view.read_with(cx, |s, cx| assert!(s.dialogs.read(cx).is_empty()));
    // No update service in this build: the native "Updates Unavailable".
    command(&view, cx, Command::CheckForUpdates);
    assert!(cx.has_pending_prompt());
    view.read_with(cx, |s, cx| assert!(s.dialogs.read(cx).is_empty()));
    cx.simulate_prompt_answer("OK");
    assert!(!cx.has_pending_prompt());
}
#[gpui::test]
fn escape_acknowledges_the_header_introduction_wherever_focus_is(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.replace(Documents::default()));
        s.session.docs.update(cx, |d, _| {
            d.workspace = Some(crate::workspace::Workspace::open(temp.path()).unwrap())
        });
        s.receive(w, cx);
    });
    // The entry is measured on one frame and introduced on the next.
    draw(cx);
    draw(cx);
    view.update(cx, |s, cx| {
        assert_eq!(
            s.chrome.read(cx).coachmarks.read(cx).active(),
            Some(coachmarks::Coachmark::Agent)
        );
        assert!(s.chrome.read(cx).coachmarks.read(cx).shown(cx));
    });
    // Nothing in the overlay holds focus; Escape still reaches it.
    view.update_in(cx, |s, w, cx| s.frame.focus.focus(w, cx));
    cx.simulate_keystrokes("escape");
    draw(cx);
    view.update(cx, |s, cx| {
        assert!(!s.chrome.read(cx).coachmarks.read(cx).shown(cx));
        assert!(s.prefs.store.read(cx).state.header_coachmarks.agent);
    });
    // A dialog hides it, and Escape then answers the dialog, not the overlay.
    let mut prefs = view.read_with(cx, |s, cx| s.prefs.store.read(cx).state.clone());
    prefs.header_coachmarks.agent = false;
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, cx| p.change(|p| *p = prefs, cx));
        s.chrome
            .read(cx)
            .coachmarks
            .clone()
            .update(cx, |c, _| c.state = Default::default());
    });
    draw(cx);
    draw(cx);
    view.update(cx, |s, cx| {
        assert!(s.chrome.read(cx).coachmarks.read(cx).shown(cx))
    });
    command(&view, cx, Command::Settings);
    view.update(cx, |s, cx| {
        assert!(!s.chrome.read(cx).coachmarks.read(cx).shown(cx))
    });
    cx.simulate_keystrokes("escape");
    draw(cx);
    view.update(cx, |s, cx| {
        assert!(s.dialogs.read(cx).is_empty());
        assert!(!s.prefs.store.read(cx).state.header_coachmarks.agent);
        assert!(s.chrome.read(cx).coachmarks.read(cx).shown(cx));
    });
}
