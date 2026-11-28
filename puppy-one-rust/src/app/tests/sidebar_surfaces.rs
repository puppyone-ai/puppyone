//! The right sidebar: its surfaces, the Header entries, Changes and History.
use super::*;
use core::prelude::v1::test;

#[gpui::test]
fn hiding_or_switching_the_changes_sidebar_rolls_back_its_section_drag(cx: &mut TestAppContext) {
    use crate::platform::git::{Change, Snapshot};
    let (view, cx) = setup(cx);
    cx.update(|_, cx| cx.set_reduce_motion(true));
    cx.simulate_resize(size(px(1280.), px(500.)));
    let sidebar = view.read_with(cx, |s, _| s.sidebar.clone());
    let git = sidebar.read_with(cx, |s, _| s.source_control.clone());
    git.update(cx, |s, cx| {
        s.receive_snapshot_for_test(
            Snapshot {
                head: "fixture-head".into(),
                branch: "main".into(),
                changes: (0..30)
                    .flat_map(|i| {
                        [
                            Change {
                                path: format!("staged-{i}.md"),
                                original: None,
                                index: 'M',
                                worktree: ' ',
                            },
                            Change {
                                path: format!("working-{i}.md"),
                                original: None,
                                index: ' ',
                                worktree: 'M',
                            },
                        ]
                    })
                    .collect(),
                ..Default::default()
            },
            cx,
        )
    });
    sidebar.update(cx, |s, cx| s.toggle_git(cx));
    cx.run_until_parked();
    draw(cx);
    let height = |cx: &mut VisualTestContext| {
        f32::from(cx.debug_bounds("git-panel-Staged").unwrap().size.height)
    };
    for switch_surface in [false, true] {
        let before = height(cx);
        let at = cx.debug_bounds("git-section-resize").unwrap().center();
        cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
        let end = at + point(px(0.), px(25.));
        cx.simulate_mouse_move(end, Some(MouseButton::Left), Modifiers::default());
        draw(cx);
        assert!(height(cx) > before + 20.);
        sidebar.update(cx, |s, cx| {
            if switch_surface {
                s.toggle_agent(cx);
            } else {
                s.toggle_git(cx);
            }
        });
        draw(cx);
        cx.simulate_mouse_up(end, MouseButton::Left, Modifiers::default());
        sidebar.update(cx, |s, cx| s.toggle_git(cx));
        cx.run_until_parked();
        draw(cx);
        assert!((height(cx) - before).abs() <= 1.);
    }
}

#[gpui::test]
fn git_header_uses_changes_outlet_and_terminal_returns_to_retained_workbench(
    cx: &mut TestAppContext,
) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::Changes);
    view.update(cx, |s, cx| assert!(!s.panes.read(cx).right().open));
    let dir = tempfile::tempdir().unwrap();
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| {
            d.workspace = Some(crate::workspace::Workspace::open(dir.path()).unwrap())
        });
    });
    command(&view, cx, Command::Changes);
    view.update(cx, |s, cx| {
        assert!(s.right_shows(Surface::Git, cx));
        assert!(!s.modal(cx));
    });
    command(&view, cx, Command::ToggleRightSidebar);
    view.update(cx, |s, cx| assert!(s.right_shows(Surface::Agent, cx)));
    command(&view, cx, Command::Changes);
    command(&view, cx, Command::Changes);
    // Closing keeps Changes on screen while the frame closes, and stored.
    view.update(cx, |s, cx| {
        assert!(!s.panes.read(cx).right().open && s.sidebar.read(cx).is(Surface::Git));
        assert_eq!(
            s.prefs.store.read(cx).state.right_sidebar_surface,
            crate::features::settings::RightSidebarSurface::Changes
        );
    });
}
/// `useGitPresentation` / `handleToggleAgentWorkbench`: an entry closes the
/// sidebar only when it shows its own surface, else switches to it; what
/// shows stays while closed, and a pulled-out sidebar never opens on a
/// hosted Project's History.
#[gpui::test]
fn the_header_entries_switch_and_close_the_right_sidebar(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        let sidebar = s.sidebar.clone();
        let open = |s: &Shell, cx: &App| s.panes.read(cx).right().open;
        let is = |surface, cx: &App| sidebar.read(cx).is(surface);
        sidebar.update(cx, |b, cx| b.toggle_git(cx));
        assert!(open(s, cx) && is(Surface::Git, cx));
        sidebar.update(cx, |b, cx| b.toggle_agent(cx));
        assert!(open(s, cx) && is(Surface::Agent, cx));
        sidebar.update(cx, |b, cx| b.toggle_agent(cx));
        assert!(!open(s, cx) && is(Surface::Agent, cx));
        sidebar.update(cx, |b, cx| b.toggle_git(cx));
        assert!(open(s, cx));
        sidebar.update(cx, |b, cx| b.toggle_git(cx));
        assert!(!open(s, cx) && is(Surface::Git, cx));
        // No hosted Project to read: History cannot open, and it is the
        // surface only until the sidebar is pulled out.
        assert!(!sidebar.update(cx, |b, cx| b.toggle_cloud_history("project", cx)));
        assert!(!open(s, cx) && is(Surface::CloudHistory, cx));
        sidebar.update(cx, |b, _| b.pulled_out());
        assert!(is(Surface::Agent, cx));
    });
}
#[gpui::test]
fn the_right_sidebar_keeps_and_restores_its_surface(cx: &mut TestAppContext) {
    use crate::features::settings::RightSidebarSurface;
    let (view, cx) = setup(cx);
    let dir = tempfile::tempdir().unwrap();
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| {
            d.workspace = Some(crate::workspace::Workspace::open(dir.path()).unwrap())
        });
    });
    // History is the surface while the sidebar is closed: pulling it out
    // reopens on History, the Header entry reveals the Changes list.
    command(&view, cx, Command::Changes);
    view.update(cx, |s, cx| {
        s.sidebar
            .read(cx)
            .source_control
            .clone()
            .update(cx, |c, cx| c.open_history(cx))
    });
    cx.run_until_parked();
    let stored = |view: &Entity<Shell>, cx: &mut VisualTestContext| {
        view.read_with(cx, |s, cx| {
            s.prefs.store.read(cx).state.right_sidebar_surface
        })
    };
    assert_eq!(stored(&view, cx), RightSidebarSurface::History);
    command(&view, cx, Command::Changes);
    view.update(cx, |s, cx| {
        assert!(!s.panes.read(cx).right().open && s.sidebar.read(cx).is(Surface::Git));
        assert!(s.sidebar.read(cx).source_control.read(cx).history_open());
    });
    assert_eq!(stored(&view, cx), RightSidebarSurface::History);
    command(&view, cx, Command::Changes);
    view.update(cx, |s, cx| {
        assert!(s.right_shows(Surface::Git, cx));
        assert!(!s.sidebar.read(cx).source_control.read(cx).history_open());
    });
    assert_eq!(stored(&view, cx), RightSidebarSurface::Changes);
    // The Agent is Chat; closing it keeps Chat.
    command(&view, cx, Command::ToggleRightSidebar);
    command(&view, cx, Command::ToggleRightSidebar);
    view.update(cx, |s, cx| {
        assert!(!s.panes.read(cx).right().open && s.sidebar.read(cx).is(Surface::Agent))
    });
    assert_eq!(stored(&view, cx), RightSidebarSurface::Chat);
    // A new window starts closed on the stored surface, once.
    view.update_in(cx, |s, w, cx| {
        let preferences = s.prefs.store.clone();
        preferences.update(cx, |store, cx| {
            store.change(
                |p| p.right_sidebar_surface = RightSidebarSurface::History,
                cx,
            )
        });
        let panes = cx.new(|cx| panes::PaneLayout::new(false, w, cx));
        let sidebar = cx
            .new(|cx| right_sidebar::RightSidebar::new(Surface::Agent, preferences, panes, w, cx));
        sidebar.update(cx, |b, cx| {
            assert!(b.is(Surface::Git));
            assert!(b.source_control.read(cx).history_open());
            b.restore(RightSidebarSurface::Chat, cx);
            assert!(b.is(Surface::Git));
        });
    });
}
#[gpui::test]
fn changes_open_file_opens_it_in_the_editor(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("notes.md"), "# Notes\n").unwrap();
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.replace(Documents::default()));
        s.session.docs.update(cx, |d, _| {
            d.workspace = Some(crate::workspace::Workspace::open(temp.path()).unwrap())
        });
    });
    view.update(cx, |s, cx| {
        s.sidebar
            .read(cx)
            .source_control
            .clone()
            .update(cx, |_, cx| {
                cx.emit(
                    crate::features::source_control::SourceControlEvent::OpenFile(
                        "notes.md".into(),
                    ),
                )
            })
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        if view.read_with(cx, |s, cx| s.files(cx).document.is_some()) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the file did not open"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.files(cx).document.as_ref().unwrap().relative,
            std::path::Path::new("notes.md")
        )
    });
}
#[gpui::test]
fn cloud_history_closes_outside_a_hosted_project(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // No hosted Project: the Header command does nothing.
    command(&view, cx, Command::CloudHistory);
    view.read_with(cx, |s, cx| {
        assert!(!s.right_shows(Surface::CloudHistory, cx))
    });
    // A History sidebar without its scope closes as it opens.
    view.update(cx, |s, cx| {
        let sidebar = s.sidebar.clone();
        assert!(!sidebar.update(cx, |b, cx| b.toggle_cloud_history("project", cx)));
        s.panes.update(cx, |p, cx| p.set_right_open(true, cx));
    });
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    view.read_with(cx, |s, cx| {
        assert!(!s.panes.read(cx).right().open);
        assert!(!s.sidebar.read(cx).cloud_history.read(cx).is_open());
    });
}

/// `AuxiliaryPanelHost.contentVisible`: the workbench presents its items
/// only while the open sidebar shows it; closing the sidebar or switching
/// it to Changes withdraws them, reopening restores them.
#[gpui::test]
fn the_workbench_is_visible_only_while_the_open_sidebar_shows_it(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let visible = |view: &Entity<Shell>, cx: &mut VisualTestContext| {
        cx.run_until_parked();
        view.read_with(cx, |s, cx| {
            let shows = s.right_shows(Surface::Agent, cx);
            let visible = s.sidebar.read(cx).workbench.read(cx).content_visible();
            assert_eq!(visible, shows);
            visible
        })
    };
    let initially = visible(&view, cx);
    command(&view, cx, Command::ToggleRightSidebar);
    assert_ne!(visible(&view, cx), initially);
    if !visible(&view, cx) {
        command(&view, cx, Command::ToggleRightSidebar);
    }
    assert!(visible(&view, cx), "open on the workbench");
    let dir = tempfile::tempdir().unwrap();
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| {
            d.workspace = Some(crate::workspace::Workspace::open(dir.path()).unwrap())
        });
    });
    command(&view, cx, Command::Changes);
    assert!(!visible(&view, cx), "Changes replaces the workbench");
    command(&view, cx, Command::ToggleRightSidebar);
    assert!(visible(&view, cx), "back on the workbench");
    command(&view, cx, Command::ToggleRightSidebar);
    assert!(!visible(&view, cx), "closed");
}

/// `unified Agent workbench titlebar entry`: the Header's Agent entry is
/// one toggle with no menu: it shows the right sidebar's Agent workbench
/// and hides it again, and no second Chat entry stands beside it.
#[gpui::test]
fn the_header_agent_entry_is_one_toggle_without_a_menu(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.update(|w, _| w.activate_window());
    draw(cx);
    let shown =
        |cx: &mut VisualTestContext| view.update(cx, |s, cx| s.right_shows(Surface::Agent, cx));
    let before = shown(cx);
    for expected in [!before, before] {
        let entry = cx.debug_bounds("header-agent").expect("the Agent entry");
        cx.simulate_click(entry.center(), Modifiers::default());
        draw(cx);
        assert_eq!(shown(cx), expected, "one click toggles the workbench");
    }
}

/// `DesktopTooltipLayer`: a hint shows only after the pointer rests on its
/// control for half a second and goes as soon as the pointer leaves.
#[gpui::test]
fn a_header_hint_waits_for_the_pointer_to_rest_and_goes_when_it_leaves(cx: &mut TestAppContext) {
    let (_view, cx) = setup(cx);
    cx.update(|w, _| w.activate_window());
    draw(cx);
    let rest = |cx: &mut VisualTestContext, ms: u64| {
        cx.executor()
            .advance_clock(std::time::Duration::from_millis(ms));
        cx.run_until_parked();
        draw(cx);
    };
    let entry = cx.debug_bounds("header-agent").expect("the Agent entry");
    // The pointer arrives and moves on within the entry.
    cx.simulate_mouse_move(entry.center(), None, Modifiers::default());
    draw(cx);
    cx.simulate_mouse_move(
        entry.center() + point(px(1.), px(0.)),
        None,
        Modifiers::default(),
    );
    rest(cx, 400);
    assert!(cx.debug_bounds("tooltip").is_none(), "not yet");
    rest(cx, 150);
    assert!(cx.debug_bounds("tooltip").is_some(), "after a rest");
    cx.simulate_mouse_move(point(px(5.), px(400.)), None, Modifiers::default());
    draw(cx);
    assert!(cx.debug_bounds("tooltip").is_none(), "gone on leave");
    rest(cx, 1_000);
    assert!(cx.debug_bounds("tooltip").is_none());
}

/// Option A ("1 tab = 1 page"): opening an empty Agent workbench creates one
/// real `New tab` launcher; closing that last tab collapses the right sidebar
/// with no ghost launcher left behind; reopening creates a fresh `New tab` and
/// focuses its composer.
#[gpui::test]
fn closing_last_workbench_tab_collapses_right_sidebar_and_reopening_creates_fresh_tab(
    cx: &mut TestAppContext,
) {
    let (view, cx) = setup(cx);
    cx.update(|w, cx| {
        w.activate_window();
        cx.set_reduce_motion(true);
    });
    let dir = tempfile::tempdir().unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| {
            d.workspace = Some(crate::workspace::Workspace::open(dir.path()).unwrap());
        });
        s.sidebar.update(cx, |b, cx| b.enter(&ws, cx));
    });
    if !view.read_with(cx, |s, cx| s.right_shows(Surface::Agent, cx)) {
        command(&view, cx, Command::ToggleRightSidebar);
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        cx.run_until_parked();
        draw(cx);
        let ready = view.read_with(cx, |s, cx| {
            s.sidebar.read(cx).workbench.read(cx).tab_count() == 1
        });
        if ready {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "initial New tab launcher did not appear after opening right sidebar"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }

    let first_tab = view
        .read_with(cx, |s, cx| {
            s.sidebar.read(cx).workbench.read(cx).active_tab()
        })
        .expect("initial launcher tab is active");
    assert!(cx.debug_bounds("launcher-heading").is_some());
    assert!(cx.debug_bounds("launcher-composer-input").is_some());

    // Click the tab's real close button in the workbench header.
    let close_selector: &'static str =
        Box::leak(format!("workbench-close-{first_tab}").into_boxed_str());
    let close_bounds = cx
        .debug_bounds(close_selector)
        .expect("active launcher tab renders its close button");
    cx.simulate_click(close_bounds.center(), Modifiers::default());
    cx.run_until_parked();
    draw(cx);

    view.read_with(cx, |s, cx| {
        assert!(
            !s.panes.read(cx).right().open,
            "closing the last tab collapses the right sidebar"
        );
        let wb = s.sidebar.read(cx).workbench.read(cx);
        assert!(!wb.content_visible());
        assert_eq!(wb.tab_count(), 0);
    });
    assert!(
        cx.debug_bounds("launcher-heading").is_none(),
        "no un-tabbed ghost launcher renders after closing the last tab"
    );
    assert!(cx.debug_bounds("launcher-composer-input").is_none());

    // Reopening via Header / ⌘J creates a fresh New tab and focuses its composer.
    command(&view, cx, Command::ToggleRightSidebar);
    cx.run_until_parked();
    draw(cx);

    let second_tab = view.read_with(cx, |s, cx| {
        assert!(s.panes.read(cx).right().open);
        assert!(s.right_shows(Surface::Agent, cx));
        let wb = s.sidebar.read(cx).workbench.read(cx);
        assert!(wb.content_visible());
        assert_eq!(wb.tab_count(), 1);
        wb.active_tab().expect("fresh launcher tab is active")
    });
    assert_ne!(second_tab, first_tab);
    assert!(cx.debug_bounds("launcher-heading").is_some());
    assert!(cx.debug_bounds("launcher-composer-input").is_some());
    assert!(
        cx.update(|window, cx| {
            view.read(cx)
                .sidebar
                .read(cx)
                .launcher
                .read(cx)
                .tab_input(second_tab)
                .expect("fresh tab mounts its own hero input")
                .focus_handle(cx)
                .contains_focused(window, cx)
        }),
        "reopening the right sidebar focuses the fresh New tab's hero composer"
    );
}

/// Full-shell end-to-end regression: dragging a file directly from the left
/// Explorer (`tree-row-name:AGENTS.md`) across the window into the right
/// sidebar's `New tab` Hero Composer (`launcher-composer-input`) drops cleanly,
/// inserts the atomic `@AGENTS.md` mention chip, and keeps the draft ready to
/// send.
#[gpui::test]
fn dragging_explorer_file_into_launcher_composer_works_end_to_end(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("AGENTS.md"), "# Agents\n").unwrap();
    let (view, cx) = setup(cx);
    cx.update(|w, cx| {
        w.activate_window();
        cx.set_reduce_motion(true);
    });
    let settle =
        |view: &Entity<Shell>, cx: &mut VisualTestContext, ready: &dyn Fn(&Shell, &App) -> bool| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            loop {
                view.update_in(cx, |s, w, cx| s.receive(w, cx));
                cx.run_until_parked();
                draw(cx);
                if view.read_with(cx, |s, cx| ready(s, cx)) {
                    break;
                }
                assert!(std::time::Instant::now() < deadline, "Shell did not settle");
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
        };
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(temp.path().into())));
    });
    settle(&view, cx, &|s, cx| {
        s.explorer
            .session
            .read(cx)
            .tree()
            .rows
            .iter()
            .any(|r| r.path == std::path::Path::new("AGENTS.md"))
    });
    if !view.read_with(cx, |s, cx| s.right_shows(Surface::Agent, cx)) {
        cx.update(|_, cx| cx.set_reduce_motion(true));
        command(&view, cx, Command::ToggleRightSidebar);
    }
    cx.update(|_, cx| cx.set_reduce_motion(true));
    settle(&view, cx, &|s, cx| {
        s.sidebar.read(cx).workbench.read(cx).tab_count() == 1
            && s.frame.layout.editor.right() <= s.frame.layout.auxiliary.x + 0.5
    });
    draw(cx);

    let row = cx
        .debug_bounds("tree-row-name:AGENTS.md")
        .expect("AGENTS.md renders in left Explorer")
        .center();
    let target = cx
        .debug_bounds("launcher-composer-input")
        .expect("Hero Composer input renders in right sidebar")
        .center();

    cx.simulate_mouse_down(row, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_move(
        point(row.x + px(8.), row.y + px(4.)),
        Some(MouseButton::Left),
        Modifiers::default(),
    );
    draw(cx);
    assert!(
        cx.update(|_, cx| cx.has_active_drag()),
        "dragging AGENTS.md from left Explorer must activate a ResourceDrag"
    );
    cx.simulate_mouse_move(target, Some(MouseButton::Left), Modifiers::default());
    draw(cx);
    cx.simulate_mouse_up(target, MouseButton::Left, Modifiers::default());
    cx.run_until_parked();
    draw(cx);

    let tab = view
        .read_with(cx, |s, cx| {
            s.sidebar.read(cx).workbench.read(cx).active_tab()
        })
        .unwrap();
    let text = view.read_with(cx, |s, cx| {
        s.sidebar
            .read(cx)
            .launcher
            .read(cx)
            .tab_input(tab)
            .unwrap()
            .read(cx)
            .current_text(cx)
    });
    assert!(
        cx.debug_bounds("agent-mention:@AGENTS.md").is_some(),
        "dropping AGENTS.md from left Explorer into right sidebar New tab composer must insert @AGENTS.md chip (text={text:?})"
    );
    assert!(
        text.contains("@AGENTS.md"),
        "composer buffer must contain @AGENTS.md token text, got {text:?}"
    );
}
