//! FA (v0.4.4 `folder-availability/*`): a project whose folder moved or
//! went away says so on the Homepage and in its window, and is found again.
use super::*;
use core::prelude::v1::test;

/// A folder renamed where it was: the Homepage fades it and says why;
/// opening it offers the folder found, which then takes its place.
#[gpui::test]
fn a_renamed_folder_is_found_again_from_the_homepage(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let notes = root.join("Notes");
    std::fs::create_dir(&notes).unwrap();
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs
            .store
            .update(cx, |p, _| p.state.remember_project(&notes, 1));
    });
    command(&view, cx, Command::Home);
    // While it is there, what it is gets remembered.
    settle_cloud(&view, cx, "its identity", &|s, cx| {
        s.prefs.store.read(cx).state.recent_projects[0]
            .fs_identity
            .is_some()
    });
    let renamed = root.join("Notes 2026");
    std::fs::rename(&notes, &renamed).unwrap();
    view.update_in(cx, |s, _, cx| {
        s.home
            .update(cx, |h, cx| h.open_unavailable(notes.clone(), cx))
    });
    settle_cloud(&view, cx, "the folder found", &|s, cx| {
        s.home
            .read(cx)
            .folder_status(&notes)
            .is_some_and(|status| status.found.as_deref() == Some(renamed.as_path()))
    });
    view.read_with(cx, |s, cx| {
        assert!(s.has_dialog("ProjectFolder", cx));
        assert!(s.workspace_root(cx).is_none(), "nothing opened");
    });
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, cx| {
            h.relocate_folder(notes.clone(), renamed.clone(), cx)
        })
    });
    settle_cloud(&view, cx, "the record moved", &|s, cx| {
        let state = &s.prefs.store.read(cx).state;
        state.recent_projects[0].path == renamed && !s.has_dialog("ProjectFolder", cx)
    });
    view.read_with(cx, |s, cx| {
        let state = &s.prefs.store.read(cx).state;
        assert_eq!(state.recent_projects.len(), 1);
        assert_eq!(state.recent_projects[0].name, "Notes 2026");
        assert!(s.home.read(cx).folder_status(&notes).is_none());
    });
}

/// The open project's folder goes away: its window says so and the rest
/// keeps working; using the folder found opens it from its new place.
#[cfg(unix)]
#[gpui::test]
fn a_window_whose_folder_moved_says_so_and_follows_it(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let notes = root.join("Notes");
    std::fs::create_dir(&notes).unwrap();
    std::fs::write(notes.join("a.md"), "# A\n").unwrap();
    let (view, cx) = setup(cx);
    // Opening remembers it (a test opens without remembering).
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.remember_project(&notes, 1))
    });
    view.update_in(cx, |s, w, cx| s.open_project(notes.clone(), w, cx));
    settle_cloud(&view, cx, "the project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(notes.as_path())
    });
    // Its identity is learned while the project list is read.
    command(&view, cx, Command::ProjectMenu);
    settle_cloud(&view, cx, "its identity", &|s, cx| {
        s.prefs
            .store
            .read(cx)
            .state
            .recent_projects
            .iter()
            .any(|p| p.path == notes && p.fs_identity.is_some())
    });
    command(&view, cx, Command::Escape);
    let read_error = |view: &Entity<Shell>, cx: &mut VisualTestContext| {
        view.update(cx, |s, cx| {
            s.home
                .update(cx, |h, cx| h.file_error("No such file".into(), cx))
        })
    };
    assert_eq!(
        read_error(&view, cx),
        "No such file",
        "a folder that is there"
    );
    let moved = root.join("Notes (moved)");
    std::fs::rename(&notes, &moved).unwrap();
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, cx| h.check_window_folder(cx))
    });
    settle_cloud(&view, cx, "the notice", &|s, cx| {
        s.home
            .read(cx)
            .window_folder
            .as_ref()
            .is_some_and(|(path, status)| {
                *path == notes && status.found.as_deref() == Some(moved.as_path())
            })
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(s.folder_notices(cx).len(), 1);
        assert_eq!(
            s.workspace_root(cx).as_deref(),
            Some(notes.as_path()),
            "still open"
        );
    });
    // Its files say why they don't open.
    assert_eq!(
        read_error(&view, cx),
        "This file’s folder can’t be opened right now."
    );
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, cx| {
            h.relocate_folder(notes.clone(), moved.clone(), cx)
        })
    });
    settle_cloud(&view, cx, "the project at its new place", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(moved.as_path())
    });
    view.read_with(cx, |s, cx| {
        assert!(s.folder_notices(cx).is_empty());
        assert!(
            !s.prefs
                .store
                .read(cx)
                .state
                .recent_projects
                .iter()
                .any(|p| p.path == notes)
        );
    });
}

/// `missingProjectFolder.test.tsx`: `never lets an older answer that
/// arrives late replace a newer one` — two probes of the window's folder
/// overlap; the newer says it is there, then the older, late, says it is
/// missing: the window keeps the newer answer.
#[gpui::test]
fn a_late_answer_never_replaces_a_newer_one(cx: &mut TestAppContext) {
    use super::home::FolderStatus;
    use crate::platform::folder_availability::State;
    let temp = tempfile::tempdir().unwrap();
    let notes = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&notes).unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| s.open_project(notes.clone(), w, cx));
    settle_cloud(&view, cx, "the project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(notes.as_path())
    });
    let missing = FolderStatus {
        state: State::Missing,
        found: None,
    };
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, cx| {
            let older = h.begin_window_folder_probe();
            let newer = h.begin_window_folder_probe();
            h.answer_window_folder(newer, notes.clone(), None, cx);
            h.answer_window_folder(older, notes.clone(), Some(missing.clone()), cx);
            assert_eq!(h.window_folder, None, "the newer answer stands");
            // The newest probe's own answer still counts.
            h.answer_window_folder(newer, notes.clone(), Some(missing), cx);
            assert!(h.window_folder.is_some());
        })
    });
}
