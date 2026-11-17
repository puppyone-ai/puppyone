//! The editor area over the documents runtime: keyboard saves, tabs, splits, native history, references, Finder drops.
use super::*;
use core::prelude::v1::test;

#[gpui::test]
fn native_keyboard_autosaves_and_closes_without_prompt_and_adopts_disk(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("native.md");
    std::fs::write(&path, b"\xef\xbb\xbf# Original\r\n\r\nBody\r\n").unwrap();
    let workspace = crate::workspace::Workspace::open(temp.path()).unwrap();
    let document = workspace.read(std::path::Path::new("native.md")).unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.replace(Documents::default()));
        s.session
            .docs
            .update(cx, |d, _| d.workspace = Some(workspace));
        s.session
            .docs
            .update(cx, |d, _| d.document = Some(document.clone()));
        s.session.docs.update(cx, |d, _| {
            d.outgoing.push(crate::documents::HostMessage::Open {
                id: document.id.clone(),
                name: "native.md".into(),
                text: document.text.clone(),
                revision: 0,
                external: false,
            })
        });
        s.sync_editor(w, cx);
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    // Home lands on the heading's visible start (after its hidden marker);
    // then select the title and replace it.
    cx.simulate_keystrokes("cmd-right cmd-left cmd-shift-right");
    cx.simulate_input("Native 中🐶");
    let settle = |view: &Entity<Shell>, cx: &mut VisualTestContext| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            if !view.read_with(cx, |s, cx| s.files(cx).busy() || s.files(cx).saving()) {
                break;
            }
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    };
    settle(&view, cx);
    assert_eq!(
        std::fs::read(&path).unwrap(),
        "\u{feff}# Native 中🐶\r\n\r\nBody\r\n".as_bytes()
    );
    std::fs::write(&path, "External edit\n").unwrap();
    // A user edit racing the external writer is reconciled at the storage port.
    cx.simulate_input("local");
    settle(&view, cx);
    view.update(cx, |s, cx| {
        assert!(!s.files(cx).dirty);
        assert!(s.files(cx).error.is_none());
        assert_eq!(
            s.files(cx).document.as_ref().unwrap().text,
            "External edit\n"
        );
    });
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "External edit\n");
    command(&view, cx, Command::CloseFile);
    settle(&view, cx);
    view.update(cx, |s, cx| assert!(s.files(cx).document.is_none()));
}
/// `handleEditorShortcut`: ⌃Tab steps through a project's editor tabs and
/// ⌘W closes the active one; with none open, ⌘W closes the window.
#[gpui::test]
fn ctrl_tab_steps_through_the_tabs_and_cmd_w_closes_one_then_the_window(cx: &mut TestAppContext) {
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join("a.md"), "# A\n").unwrap();
    std::fs::write(folder.path().join("b.md"), "# B\n").unwrap();
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false)
    });
    let settle =
        |view: &Entity<Shell>, cx: &mut VisualTestContext, ready: &dyn Fn(&Shell, &App) -> bool| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            loop {
                view.update_in(cx, |s, w, cx| s.receive(w, cx));
                cx.run_until_parked();
                if view.read_with(cx, |s, cx| ready(s, cx)) {
                    break;
                }
                assert!(std::time::Instant::now() < deadline, "did not settle");
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
        };
    let opened = |s: &Shell, cx: &App| s.files(cx).opened().map(|(_, p)| p.to_owned());
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(folder.path().into())))
    });
    settle(&view, cx, &|s, cx| s.files(cx).state().is_some());
    for name in ["a.md", "b.md"] {
        view.update(cx, |s, cx| {
            s.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFile(name.into())))
        });
        settle(&view, cx, &|s, cx| {
            opened(s, cx) == Some(PathBuf::from(name))
        });
    }
    command(&view, cx, Command::NextEditor);
    settle(&view, cx, &|s, cx| {
        opened(s, cx) == Some(PathBuf::from("a.md"))
    });
    command(&view, cx, Command::PreviousEditor);
    settle(&view, cx, &|s, cx| {
        opened(s, cx) == Some(PathBuf::from("b.md"))
    });
    command(&view, cx, Command::CloseEditorOrWindow);
    settle(&view, cx, &|s, cx| {
        opened(s, cx) == Some(PathBuf::from("a.md"))
    });
    command(&view, cx, Command::CloseEditorOrWindow);
    settle(&view, cx, &|s, cx| {
        s.files(cx)
            .state()
            .is_some_and(|w| w.catalog.editors.is_empty())
    });
    view.read_with(cx, |s, cx| assert!(!s.files(cx).allow_quit));
    // No editor left: the window closes.
    view.update_in(cx, |s, w, cx| {
        s.command(Command::CloseEditorOrWindow, w, cx)
    });
    cx.run_until_parked();
    assert!(cx.read(|app| app.windows().is_empty()));
}
#[gpui::test]
fn workbench_tabs_splits_and_project_switch_retain_the_same_native_history(
    cx: &mut TestAppContext,
) {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    std::fs::write(first.path().join("a.md"), "# Original\n").unwrap();
    std::fs::write(first.path().join("b.md"), "# Second\n").unwrap();
    let (view, cx) = setup(cx);
    let settle =
        |view: &Entity<Shell>, cx: &mut VisualTestContext, ready: &dyn Fn(&Shell, &App) -> bool| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            loop {
                view.update_in(cx, |s, w, cx| s.receive(w, cx));
                cx.run_until_parked();
                if view.read_with(cx, |s, cx| ready(s, cx)) {
                    break;
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "Workbench did not settle"
                );
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
            cx.update(|w, cx| {
                let _ = w.draw(cx);
            });
        };
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(first.path().into())))
    });
    settle(&view, cx, &|s, cx| s.files(cx).state().is_some());
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFile("a.md".into())))
    });
    settle(&view, cx, &|s, cx| s.files(cx).opened().is_some());
    let (slot, entity, key) = view.read_with(cx, |s, cx| {
        (
            s.files(cx).active_slot(),
            s.editor.read(cx).front.entity_id(),
            s.files(cx)
                .state()
                .unwrap()
                .layout
                .active_editor()
                .unwrap()
                .to_owned(),
        )
    });
    cx.simulate_keystrokes("cmd-right cmd-left cmd-shift-right");
    cx.simulate_input("Retained");
    settle(&view, cx, &|s, cx| !s.files(cx).saving());
    assert_eq!(
        std::fs::read_to_string(first.path().join("a.md")).unwrap(),
        "# Retained\n"
    );
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| {
            d.state_mut()
                .unwrap()
                .split(crate::editor::workbench::layout::Direction::Horizontal)
        });
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFile("b.md".into())));
    });
    settle(&view, cx, &|s, cx| {
        s.files(cx)
            .opened()
            .is_some_and(|(_, p)| p == std::path::Path::new("b.md"))
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(s.files(cx).visible_slots().len(), 2);
        assert_eq!(s.editor.read(cx).hosts[&slot].entity_id(), entity);
    });
    view.update_in(cx, |s, w, cx| {
        let pane = s.files(cx).state().unwrap().layout.active.clone();
        s.session
            .docs
            .update(cx, |d, _| d.state_mut().unwrap().close_pane(&pane));
        s.session.docs.update(cx, |d, _| d.activate(&key));
        s.sync_editor(w, cx);
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(s.files(cx).state().unwrap().catalog.editors.len(), 2);
        assert_eq!(s.editor.read(cx).front.entity_id(), entity);
    });
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(second.path().into())))
    });
    settle(&view, cx, &|s, cx| {
        s.files(cx)
            .state()
            .is_some_and(|state| state.catalog.editors.is_empty())
    });
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| {
            d.begin(Intent::OpenFolder(first.path().canonicalize().unwrap()))
        })
    });
    settle(&view, cx, &|s, cx| s.files(cx).active_slot() == slot);
    view.read_with(cx, |s, cx| {
        assert_eq!(s.editor.read(cx).front.entity_id(), entity)
    });
    command(&view, cx, Command::Undo);
    settle(&view, cx, &|s, cx| !s.files(cx).saving());
    assert_eq!(
        std::fs::read_to_string(first.path().join("a.md")).unwrap(),
        "# Original\n"
    );
}
#[gpui::test]
fn renaming_a_hidden_document_rebinds_its_native_history_without_changing_focus(
    cx: &mut TestAppContext,
) {
    use std::path::Path;
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("notes.md"), "# Notes\n").unwrap();
    std::fs::write(temp.path().join("unrelated.md"), "# Other\n").unwrap();
    let (view, cx) = setup(cx);
    let explorer = session_of(&view, cx);
    // Real workers answer: pump the shell (and its frames, where the
    // Explorer hears about the documents) until `done`.
    let settle = |cx: &mut VisualTestContext, done: &dyn Fn(&Shell, &App) -> bool| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            draw(cx);
            cx.run_until_parked();
            if view.read_with(cx, |s, cx| done(s, cx)) {
                break;
            }
            assert!(std::time::Instant::now() < deadline, "timed out");
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    };
    let root = temp.path().to_path_buf();
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(root)))
    });
    settle(cx, &|s, cx| {
        s.explorer
            .session
            .read(cx)
            .tree()
            .index_of(Path::new("notes.md"))
            .is_some()
    });
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFile("notes.md".into())))
    });
    let opened = |name: &'static str| {
        move |s: &Shell, cx: &App| {
            !s.files(cx).busy()
                && s.files(cx)
                    .document
                    .as_ref()
                    .is_some_and(|d| d.relative == Path::new(name))
        }
    };
    settle(cx, &opened("notes.md"));
    let (slot, entity, session) = view.read_with(cx, |s, cx| {
        (
            s.files(cx).active_slot(),
            s.editor.read(cx).front.entity_id(),
            s.files(cx).document.as_ref().unwrap().id.clone(),
        )
    });
    cx.simulate_keystrokes("cmd-right cmd-left cmd-shift-right");
    cx.simulate_input("Edited");
    settle(cx, &|s, cx| !s.files(cx).saving());
    assert_eq!(
        std::fs::read_to_string(temp.path().join("notes.md")).unwrap(),
        "# Edited\n"
    );
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFile("unrelated.md".into())))
    });
    settle(cx, &opened("unrelated.md"));
    let unrelated = view.read_with(cx, |s, cx| s.files(cx).active_slot());
    // Drain the hidden affected copy, not the unrelated focused copy. Waiting
    // for the entire workbench to become empty would deadlock with multiple tabs.
    explorer.update(cx, |e, cx| {
        e.rename("notes.md".into(), "renamed.md".into(), cx)
    });
    settle(cx, &|s, cx| {
        !s.explorer.session.read(cx).busy()
            && s.files(cx).slot(slot).is_some_and(|f| {
                f.opened()
                    .is_some_and(|(_, p)| p == Path::new("renamed.md"))
            })
    });
    assert!(temp.path().join("renamed.md").exists());
    assert!(!temp.path().join("notes.md").exists());
    view.read_with(cx, |s, cx| {
        assert!(s.files(cx).retained_slots().contains(&unrelated));
        assert_eq!(s.files(cx).state().unwrap().catalog.editors.len(), 2);
        assert_eq!(s.files(cx).active_slot(), unrelated);
        assert_eq!(s.editor.read(cx).hosts[&slot].entity_id(), entity);
        assert_eq!(
            s.files(cx)
                .slot(slot)
                .unwrap()
                .document
                .as_ref()
                .unwrap()
                .id,
            session
        );
    });
    explorer.read_with(cx, |e, _| {
        assert_eq!(e.tree().selected, Path::new("renamed.md"));
        assert!(!e.busy());
    });
    view.update_in(cx, |s, w, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFile("renamed.md".into())));
        s.sync_editor(w, cx);
    });
    command(&view, cx, Command::Undo);
    settle(cx, &|s, cx| !s.files(cx).saving());
    assert_eq!(
        std::fs::read_to_string(temp.path().join("renamed.md")).unwrap(),
        "# Notes\n"
    );
    assert!(!temp.path().join("notes.md").exists());
}
#[gpui::test]
fn csv_references_use_real_workspace_and_follow_directory_rebinds(cx: &mut TestAppContext) {
    use crate::editor::navigation::Reference;
    fn settle(
        view: &Entity<Shell>,
        cx: &mut VisualTestContext,
        ready: impl Fn(&Shell, &App) -> bool,
    ) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            view.update_in(cx, |s, w, cx| s.receive(w, cx));
            cx.run_until_parked();
            if view.read_with(cx, |s, cx| ready(s, cx)) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "reference workbench did not settle"
            );
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
    }
    fn path(csv: &Entity<crate::editor::csv::CsvEditor>, cx: &App, row: usize) -> Option<String> {
        match csv.read(cx).reference(row, 1) {
            Some(Reference::Workspace { path, .. }) => path,
            _ => None,
        }
    }
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    std::fs::create_dir(first.path().join("dir")).unwrap();
    std::fs::write(first.path().join("dir/Target.md"), "# First target").unwrap();
    std::fs::write(
        first.path().join("dir/table.csv"),
        "name,link\nnote,[[Target]]\nlater,[[Later]]\n",
    )
    .unwrap();
    std::fs::write(second.path().join("Target.md"), "# Second target").unwrap();
    std::fs::write(
        second.path().join("table.csv"),
        "name,link\nnote,[[Target]]\n",
    )
    .unwrap();
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(first.path().into())))
    });
    settle(&view, cx, |s, cx| s.files(cx).state().is_some());
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.load_children("dir".into()))
    });
    settle(&view, cx, |s, cx| {
        s.explorer
            .session
            .read(cx)
            .tree()
            .rows
            .iter()
            .any(|row| row.path == std::path::Path::new("dir/table.csv"))
    });
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFile("dir/table.csv".into())))
    });
    settle(&view, cx, |s, cx| {
        s.editor.read(cx).front.read(cx).csv_editor().is_some()
    });
    let csv = view.read_with(cx, |s, cx| {
        s.editor.read(cx).front.read(cx).csv_editor().unwrap()
    });
    assert_eq!(
        cx.read(|cx| path(&csv, cx, 1)),
        Some("dir/Target.md".into())
    );
    assert_eq!(cx.read(|cx| path(&csv, cx, 2)), None);
    std::fs::write(first.path().join("dir/Later.md"), "# Later").unwrap();
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.load_children("dir".into()))
    });
    settle(&view, cx, |_, cx| {
        path(&csv, cx, 2).as_deref() == Some("dir/Later.md")
    });
    csv.update_in(cx, |csv, w, cx| {
        assert!(csv.activate_reference(1, 1, w, cx));
    });
    settle(&view, cx, |s, cx| {
        s.files(cx)
            .opened()
            .is_some_and(|(_, p)| p == std::path::Path::new("dir/Target.md"))
    });
    let explorer = view.read_with(cx, |s, _| s.explorer.session.clone());
    explorer.update(cx, |e, cx| e.rename("dir".into(), "moved".into(), cx));
    settle(&view, cx, |s, cx| {
        !s.files(cx).busy()
            && !s.explorer.session.read(cx).busy()
            && path(&csv, cx, 1).as_deref() == Some("moved/Target.md")
    });
    assert!(first.path().join("moved/table.csv").exists());
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(second.path().into())))
    });
    settle(&view, cx, |s, cx| {
        s.files(cx).workspace.as_ref().is_some_and(|w| {
            w.local_root() == Some(second.path().canonicalize().unwrap().as_path())
        })
    });
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFile("table.csv".into())))
    });
    settle(&view, cx, |s, cx| {
        s.editor
            .read(cx)
            .front
            .read(cx)
            .csv_editor()
            .is_some_and(|other| other != csv)
    });
    let other = view.read_with(cx, |s, cx| {
        s.editor.read(cx).front.read(cx).csv_editor().unwrap()
    });
    assert_eq!(cx.read(|cx| path(&other, cx, 1)), Some("Target.md".into()));
    assert_eq!(
        cx.read(|cx| path(&csv, cx, 1)),
        Some("moved/Target.md".into()),
        "hidden editors retain their own workspace resolver"
    );
    other.update_in(cx, |csv, w, cx| {
        assert!(csv.activate_reference(1, 1, w, cx));
    });
    settle(&view, cx, |s, cx| {
        s.files(cx)
            .opened()
            .is_some_and(|(_, p)| p == std::path::Path::new("Target.md"))
    });
}
#[gpui::test]
fn finder_drops_open_only_one_file_of_this_workspace(cx: &mut TestAppContext) {
    let (view, vcx) = setup(cx);
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    std::fs::create_dir(root.join("docs")).unwrap();
    std::fs::write(root.join("docs/a.md"), "a").unwrap();
    std::fs::write(root.join("b.md"), "b").unwrap();
    let outside = tempfile::tempdir().unwrap();
    view.update(vcx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(root.clone())))
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while view.read_with(vcx, |s, cx| {
        s.workspace_root(cx).is_none()
            || !s
                .explorer
                .session
                .read(cx)
                .tree()
                .is_folder(std::path::Path::new("docs"))
    }) {
        assert!(std::time::Instant::now() < deadline);
        vcx.run_until_parked();
        view.update_in(vcx, |s, w, cx| s.receive(w, cx));
    }
    let drop = |paths: Vec<std::path::PathBuf>| ExternalPaths(paths.into());
    view.read_with(vcx, |s, cx| {
        assert_eq!(
            s.editor
                .read(cx)
                .external_document(&drop(vec![root.join("docs/a.md")]), cx),
            Some("docs/a.md".into())
        );
        // Folders, several files and files outside the project are not admitted.
        for paths in [
            vec![root.join("docs")],
            vec![root.join("docs/a.md"), root.join("b.md")],
            vec![outside.path().join("c.md")],
            vec![root.clone()],
        ] {
            assert_eq!(s.editor.read(cx).external_document(&drop(paths), cx), None);
        }
    });
}
