//! The Header chrome: its popovers, focus, menus and the introductions.
use super::*;
use core::prelude::v1::test;

#[gpui::test]
fn native_buttons_toggle_slots_and_open_settings(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // Collapsed, the Explorer's expand button is in the Header.
    command(&view, cx, Command::ToggleExplorer);
    view.update(cx, |s, cx| assert!(!s.panes.read(cx).explorer().open));
    draw(cx);
    let expand = cx
        .debug_bounds("expand-explorer")
        .expect("collapsed explorer renders expand button in header");
    cx.simulate_click(expand.center(), Modifiers::none());
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
        w.draw(cx).clear(cx);
    });
    view.update(cx, |s, cx| {
        s.dialogs.read(cx).settings.clone().update(cx, |s, cx| {
            s.select_page(crate::features::settings::Page::LocalAgents, cx)
        });
        cx.notify();
    });
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
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
/// `the Header's place, and the way to every other place`: in a project
/// window the place menu offers Home, this computer with a way to start a
/// space, then the account and Settings, and Home goes Home; signed out it
/// offers this computer and Sign in. With the project rail on, the Header
/// keeps the place alone.
#[gpui::test]
fn the_place_menu_offers_home_the_places_and_the_account_or_sign_in(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::account_fixture();
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    settle_cloud(&view, cx, "the account", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    let row = |key: &str| -> &'static str {
        Box::leak(format!("menu-item:{}", crate::localization::t(key)).into_boxed_str())
    };
    let device = row(if cfg!(target_os = "macos") {
        "shell.workspaceSwitcher.location.thisMac"
    } else {
        "shell.workspaceSwitcher.location.thisComputer"
    });
    let open = |cx: &mut VisualTestContext| {
        command(&view, cx, Command::LocationMenu);
        draw(cx);
        draw(cx);
    };
    open(cx);
    for key in [
        "shell.workspaceSwitcher.home",
        "settings.space.create",
        "settings.sidebar.account",
        "shell.navigation.settings",
    ] {
        assert!(cx.debug_bounds(row(key)).is_some(), "{key}");
    }
    assert!(cx.debug_bounds(device).is_some());
    assert!(cx.debug_bounds(row("cloud.auth.signIn")).is_none());
    let home = cx
        .debug_bounds(row("shell.workspaceSwitcher.home"))
        .unwrap();
    cx.simulate_click(home.center(), Modifiers::none());
    view.read_with(cx, |s, cx| {
        assert!(s.session.project.read(cx).home);
        assert!(s.chrome.read(cx).popover.is_none());
    });
    view.update(cx, |s, cx| {
        s.session.project.update(cx, |p, _| p.home = false)
    });
    cx.update(|_, cx| crate::features::cloud::account::sign_out(cx));
    settle_cloud(&view, cx, "signed out", &|_, cx| {
        !crate::features::cloud::account::has_account(cx)
    });
    open(cx);
    assert!(cx.debug_bounds(device).is_some());
    assert!(cx.debug_bounds(row("cloud.auth.signIn")).is_some());
    for key in ["settings.space.create", "settings.sidebar.account"] {
        assert!(cx.debug_bounds(row(key)).is_none(), "{key}");
    }
    command(&view, cx, Command::Escape);
    draw(cx);
    assert!(cx.debug_bounds("header-project").is_some());
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |store, cx| {
            store.change(|p| p.project_switcher_rail = true, cx)
        })
    });
    draw(cx);
    assert!(
        cx.debug_bounds("header-project").is_none(),
        "the rail names the project"
    );
}
/// `WindowNavigation`: a signed-in account stays out of a project
/// window's Header end. On the Homepage the brand opens the places and the
/// account, with no way to the page it is on; a place shows it there and
/// closes the menu.
#[gpui::test]
fn the_homepage_brand_opens_the_places_and_the_account_but_not_home(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::account_fixture();
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    settle_cloud(&view, cx, "the account", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    for end in ["header-account", "header-sign-in"] {
        assert!(cx.debug_bounds(end).is_none(), "{end}");
    }
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false)
    });
    command(&view, cx, Command::Home);
    // The Homepage ends with the account's own circle instead (native).
    assert!(cx.debug_bounds("header-account").is_some());
    let brand = cx.debug_bounds("homepage-brand").unwrap();
    cx.simulate_click(brand.center(), Modifiers::none());
    draw(cx);
    draw(cx);
    let row = |key: &str| -> &'static str {
        Box::leak(format!("menu-item:{}", crate::localization::t(key)).into_boxed_str())
    };
    let device = row(if cfg!(target_os = "macos") {
        "shell.workspaceSwitcher.location.thisMac"
    } else {
        "shell.workspaceSwitcher.location.thisComputer"
    });
    assert!(cx.debug_bounds(device).is_some(), "the places");
    assert!(cx.debug_bounds(row("settings.sidebar.account")).is_some());
    assert!(
        cx.debug_bounds(row("shell.workspaceSwitcher.home"))
            .is_none()
    );
    let place = cx.debug_bounds(device).unwrap();
    cx.simulate_click(place.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.chrome.read(cx).popover.is_none());
        assert_eq!(
            s.home.read(cx).place_focus.as_ref().map(|f| f.0.clone()),
            Some(super::home::groups::GroupId::LocalOnly)
        );
    });
    assert!(cx.debug_bounds(device).is_none());
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
    if crate::platform::conventions::Conventions::current().uses_system_menu_bar {
        assert_eq!(
            menus[0].name.as_ref(),
            crate::app::windows::application_name()
        );
    } else {
        assert_eq!(
            menus[0].name.as_ref(),
            crate::localization::t("native.menu.file")
        );
    }
    cx.simulate_keystrokes("secondary-,");
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
    if crate::platform::conventions::Conventions::current().uses_system_menu_bar {
        assert_eq!(names.len(), 7, "{names:?}");
        assert_eq!(names[0], crate::app::windows::application_name());
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
    } else {
        assert_eq!(names.len(), 6, "{names:?}");
        assert_eq!(
            [&names[1], &names[2], &names[4], &names[5]],
            ["Edit", "View", "Window", "Help"]
        );
        let file: Vec<String> = menus[0]
            .items
            .iter()
            .filter_map(|item| match item {
                gpui::MenuItem::Action { name, .. } => Some(name.to_string()),
                _ => None,
            })
            .collect();
        assert!(file.iter().any(|n| n == "Close Window"), "{file:?}");
    }
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

/// `moves only the active state when switching Projects`, `announces the
/// active Project and routes selection through the host`: a rail mark
/// enters its project in this window, and every mark keeps its place
/// though the project just entered becomes the most recent.
#[gpui::test]
fn a_rail_mark_enters_its_project_and_the_marks_keep_their_places(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let alpha = temp.path().canonicalize().unwrap().join("alpha");
    let beta = temp.path().canonicalize().unwrap().join("beta");
    for dir in [&alpha, &beta] {
        std::fs::create_dir(dir).unwrap();
        std::fs::write(dir.join("a.md"), "# A\n").unwrap();
    }
    let (view, cx) = setup(cx);
    let store = view.read_with(cx, |s, _| s.prefs.store.clone());
    store.update(cx, |store, cx| {
        store.change(
            |p| {
                p.project_switcher_rail = true;
                p.remember_project(&beta, 1);
                p.remember_project(&alpha, 2);
            },
            cx,
        )
    });
    view.update_in(cx, |s, w, cx| s.open_project(alpha.clone(), w, cx));
    settle_cloud(&view, cx, "alpha", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(alpha.as_path())
    });
    draw(cx);
    let top = |cx: &mut VisualTestContext, name: &str| {
        let selector: &'static str = Box::leak(format!("rail-project-{name}").into_boxed_str());
        cx.debug_bounds(selector).map(|b| b.top())
    };
    let places = (top(cx, "alpha").unwrap(), top(cx, "beta").unwrap());
    assert!(places.0 < places.1);
    let mark = cx.debug_bounds("rail-project-beta").unwrap().center();
    cx.simulate_click(mark, Modifiers::none());
    settle_cloud(&view, cx, "beta", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(beta.as_path())
    });
    // The project entered becomes the most recent; the marks stay.
    store.update(cx, |store, cx| {
        store.change(|p| p.remember_project(&beta, 3), cx)
    });
    draw(cx);
    assert_eq!(
        store.read_with(cx, |s, _| s.state.recent_projects[0].path.clone()),
        beta
    );
    assert_eq!(
        (top(cx, "alpha").unwrap(), top(cx, "beta").unwrap()),
        places
    );
}

/// `routes the create launcher through the three existing Project entry
/// paths`, `hands the in-project launcher off to the shared Import flow`:
/// the rail's create action opens one launcher offering creating a
/// project, opening a folder and importing (with its source marks); a
/// choice closes it and starts that flow.
#[gpui::test]
fn the_rail_create_action_offers_the_three_project_entries(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let entry = |cx: &mut VisualTestContext| {
        view.read_with(cx, |s, cx| {
            s.dialogs.read(cx).contains(DialogKey::ProjectEntry)
        })
    };
    for (route, started) in [("Create", "create"), ("Import", "import")] {
        command(&view, cx, Command::CreateNew);
        draw(cx);
        assert!(entry(cx));
        for option in [
            "project-entry-Create",
            "project-entry-OpenFolder",
            "project-entry-Import",
        ] {
            assert!(cx.debug_bounds(option).is_some(), "{option}");
        }
        assert!(cx.debug_bounds("import-preview-github").is_some());
        assert!(cx.debug_bounds("import-preview-gitlab").is_some());
        let selector: &'static str = Box::leak(format!("project-entry-{route}").into_boxed_str());
        let option = cx.debug_bounds(selector).unwrap().center();
        cx.simulate_click(option, Modifiers::none());
        draw(cx);
        assert!(!entry(cx));
        view.read_with(cx, |s, cx| {
            let home = s.home.read(cx);
            match started {
                "create" => assert!(home.create.is_some()),
                _ => assert!(home.import_picker.is_some()),
            }
        });
        view.update(cx, |s, cx| {
            s.home.update(cx, |h, _| {
                h.create = None;
                h.import_picker = None;
            })
        });
    }
}

/// `desktop explorer Header expansion`: a collapsed Explorer gets one
/// Header action that expands it, beside the project; an open one gets none,
/// even in a compact window. With the editor's tabs in the Header the
/// project button still opens its menu beside them, and without them there
/// is no tab column. The project rail sits below the full-width Header.
#[gpui::test]
fn the_header_expands_a_collapsed_explorer_and_keeps_the_project_beside_editor_tabs(
    cx: &mut TestAppContext,
) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap().join("alpha");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("a.md"), "# A\n").unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| s.open_project(root.clone(), w, cx));
    settle_cloud(&view, cx, "the project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(root.as_path())
    });
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFile("a.md".into())))
    });
    settle_cloud(&view, cx, "the document", &|s, cx| {
        s.files(cx).opened().is_some()
    });
    draw(cx);
    let explorer_open =
        |cx: &mut VisualTestContext| view.read_with(cx, |s, cx| s.panes.read(cx).explorer().open);
    assert!(explorer_open(cx));
    assert!(cx.debug_bounds("expand-explorer").is_none());
    assert!(cx.debug_bounds("header-project").is_some());
    command(&view, cx, Command::ToggleExplorer);
    draw(cx);
    assert!(!explorer_open(cx));
    assert!(cx.debug_bounds("header-project").is_some());
    let expand = cx.debug_bounds("expand-explorer").expect("one way back");
    cx.simulate_click(expand.center(), Modifiers::none());
    draw(cx);
    assert!(explorer_open(cx));
    assert!(cx.debug_bounds("expand-explorer").is_none());
    cx.simulate_resize(size(px(640.), px(600.)));
    draw(cx);
    assert!(explorer_open(cx), "a compact window keeps the Explorer");
    assert!(cx.debug_bounds("expand-explorer").is_none());
    cx.simulate_resize(size(px(1280.), px(800.)));
    draw(cx);
    assert!(
        cx.debug_bounds("editor-tabs").is_none(),
        "no empty tab column"
    );
    let store = view.read_with(cx, |s, _| s.prefs.store.clone());
    store.update(cx, |store, cx| {
        store.change(|p| p.experimental.editor_tabs_in_header = true, cx)
    });
    draw(cx);
    assert!(cx.debug_bounds("editor-tabs").is_some());
    let project = cx.debug_bounds("header-project").unwrap();
    cx.simulate_click(project.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.chrome.read(cx).popover,
            Some(super::chrome::Popover::Project)
        )
    });
    command(&view, cx, Command::Escape);
    store.update(cx, |store, cx| {
        store.change(
            |p| {
                p.experimental.editor_tabs_in_header = false;
                p.project_switcher_rail = true;
                p.remember_project(&root, 1);
            },
            cx,
        )
    });
    draw(cx);
    let mark = cx.debug_bounds("rail-project-alpha").expect("the rail");
    assert!(
        mark.origin.y >= px(crate::theme::HEADER),
        "the rail starts below the Header: {mark:?}"
    );
}

/// `DesktopTitlebarActions`: a folder's Header offers its Changes, and the
/// Agent entry beside them only while the Header Agent tool is on.
#[gpui::test]
fn the_folder_header_offers_changes_and_the_agent_only_while_its_tool_is_on(
    cx: &mut TestAppContext,
) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| s.open_project(root.clone(), w, cx));
    settle_cloud(&view, cx, "the folder", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(root.as_path())
    });
    let store = view.read_with(cx, |s, _| s.prefs.store.clone());
    for on in [true, false, true] {
        store.update(cx, |store, cx| store.change(|p| p.header_terminal = on, cx));
        draw(cx);
        assert!(cx.debug_bounds("header-changes").is_some(), "{on}");
        assert_eq!(cx.debug_bounds("header-agent").is_some(), on);
    }
}

/// Without the Header (experimental): the panes reach the window's top; the
/// sidebar toggle, the place and the project stand over the Explorer and
/// keep their places when it closes; the tools stand above the document,
/// never over the right sidebar. A narrowed Explorer shortens the place
/// before the project.
#[gpui::test]
fn the_hidden_header_keeps_the_project_over_the_explorer_and_the_tools_above_the_document(
    cx: &mut TestAppContext,
) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap().join("alpha-app");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("a.md"), "# A\n").unwrap();
    let (view, cx) = setup(cx);
    cx.update(|_, cx| cx.set_reduce_motion(true));
    cx.simulate_resize(size(px(1280.), px(800.)));
    view.update_in(cx, |s, w, cx| s.open_project(root.clone(), w, cx));
    settle_cloud(&view, cx, "the project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(root.as_path())
    });
    // Measure the untruncated widths before narrowing inside the Explorer.
    draw(cx);
    let full_place = cx
        .debug_bounds("project-place")
        .expect("the place")
        .size
        .width;
    let full_project = cx
        .debug_bounds("header-project")
        .expect("the project")
        .size
        .width;
    let store = view.read_with(cx, |s, _| s.prefs.store.clone());
    store.update(cx, |store, cx| {
        store.change(|p| p.experimental.hidden_header = true, cx)
    });
    draw(cx);
    let header = px(crate::theme::HEADER);
    let layout = |cx: &mut VisualTestContext| view.read_with(cx, |s, _| s.frame.layout);
    let explorer = layout(cx).explorer;
    let toggle = cx
        .debug_bounds("collapse-explorer")
        .expect("the sidebar toggle");
    let project = cx.debug_bounds("header-project").expect("the project");
    for part in [toggle, project] {
        assert!(part.bottom() <= header, "at the top: {part:?}");
        assert!(
            part.right() <= px(explorer.right()),
            "over the Explorer: {part:?}"
        );
    }
    let changes = cx.debug_bounds("header-changes").expect("Changes");
    assert!(changes.bottom() <= header);
    assert!(changes.left() >= px(layout(cx).editor.x));
    // Its menu hangs below it as in the Header.
    cx.simulate_click(project.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.chrome.read(cx).popover,
            Some(super::chrome::Popover::Project)
        )
    });
    command(&view, cx, Command::Escape);
    // A narrower Explorer shortens the place before the project.
    let set_explorer_width = |cx: &mut VisualTestContext, width: f32| {
        view.update(cx, |s, cx| {
            s.panes.update(cx, |p, cx| {
                p.restore(
                    super::panes::StoredPanes {
                        explorer_width: width,
                        ..p.stored()
                    },
                    cx,
                )
            })
        });
        draw(cx);
    };
    set_explorer_width(cx, 300.);
    let place_300 = cx
        .debug_bounds("project-place")
        .expect("the place at 300")
        .size
        .width;
    let project_300 = cx
        .debug_bounds("header-project")
        .expect("the project at 300")
        .size
        .width;
    assert!(
        place_300 < full_place,
        "place gives way first at 300px: {place_300:?} vs {full_place:?}"
    );
    assert_eq!(
        project_300, full_project,
        "project stays untruncated at 300px: {project_300:?} vs {full_project:?}"
    );
    set_explorer_width(cx, 260.);
    let place_260 = cx
        .debug_bounds("project-place")
        .expect("the place at 260")
        .size
        .width;
    let project_260 = cx
        .debug_bounds("header-project")
        .expect("the project at 260")
        .size
        .width;
    assert!(
        place_260 <= px(crate::theme::control()),
        "place shrinks down to its mark first: {place_260:?}"
    );
    assert!(
        project_260 >= px(super::chrome::PROJECT_MIN_WIDTH),
        "project keeps at least PROJECT_MIN_WIDTH at 260px: {project_260:?}"
    );
    assert!(
        full_place - place_260 > full_project - project_260,
        "place gives up more width than project: place {full_place:?}->{place_260:?}, project {full_project:?}->{project_260:?}"
    );
    // Collapsed, the expand button and the project stay in the top 40px.
    command(&view, cx, Command::ToggleExplorer);
    draw(cx);
    let expand = cx
        .debug_bounds("expand-explorer")
        .expect("collapsed explorer shows expand button");
    let collapsed_project = cx
        .debug_bounds("header-project")
        .expect("collapsed explorer keeps the project");
    for part in [expand, collapsed_project] {
        assert!(
            part.bottom() <= header,
            "at the top when collapsed: {part:?}"
        );
    }
}
