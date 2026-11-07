//! The right sidebar: its surfaces, the Header entries, Changes and History.
use super::*;
use core::prelude::v1::test;

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
        let panes = cx.new(|cx| panes::PaneLayout::new(false, w, cx));
        let sidebar = cx
            .new(|cx| right_sidebar::RightSidebar::new(Surface::Agent, preferences, panes, w, cx));
        sidebar.update(cx, |b, cx| {
            b.restore(RightSidebarSurface::History, cx);
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
        let _ = w.draw(cx);
    });
    view.read_with(cx, |s, cx| {
        assert!(!s.panes.read(cx).right().open);
        assert!(!s.sidebar.read(cx).cloud_history.read(cx).is_open());
    });
}
