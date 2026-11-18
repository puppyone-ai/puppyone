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
        w.draw(cx).clear(cx);
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
                w.draw(cx).clear(cx);
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
/// A hidden clean tab gives up its live editor to stay within the live
/// slot budget (`WB-01`), but the document is still open: coming back to it
/// re-creates the view, and its undo history is still there (the product
/// keeps a document's history for as long as it is open).
#[gpui::test]
fn a_hibernated_tab_keeps_its_undo_history_when_it_comes_back(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("a.md"), "# Original\n").unwrap();
    std::fs::write(temp.path().join("b.md"), "# Second\n").unwrap();
    let (view, cx) = setup(cx);
    let settle =
        |view: &Entity<Shell>, cx: &mut VisualTestContext, ready: &dyn Fn(&Shell, &App) -> bool| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            loop {
                view.update_in(cx, |s, w, cx| s.receive(w, cx));
                cx.run_until_parked();
                cx.update(|w, cx| {
                    w.draw(cx).clear(cx);
                });
                if view.read_with(cx, |s, cx| ready(s, cx)) {
                    break;
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "Workbench did not settle"
                );
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
        };
    let open = |view: &Entity<Shell>, cx: &mut VisualTestContext, path: &'static str| {
        view.update(cx, |s, cx| {
            s.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFile(path.into())))
        });
        settle(view, cx, &|s, cx| {
            !s.files(cx).busy()
                && s.files(cx)
                    .opened()
                    .is_some_and(|(_, p)| p == std::path::Path::new(path))
        });
    };
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| {
            d.set_max_live_slots(1);
            d.begin(Intent::OpenFolder(temp.path().into()))
        })
    });
    settle(&view, cx, &|s, cx| s.files(cx).state().is_some());
    open(&view, cx, "a.md");
    let (key, first_view) = view.read_with(cx, |s, cx| {
        (
            s.files(cx)
                .state()
                .unwrap()
                .layout
                .active_editor()
                .unwrap()
                .to_owned(),
            s.editor.read(cx).front.downgrade(),
        )
    });
    cx.simulate_keystrokes("cmd-right cmd-left cmd-shift-right");
    cx.simulate_input("Retained");
    settle(&view, cx, &|s, cx| {
        !s.files(cx).saving() && !s.files(cx).dirty
    });
    assert_eq!(
        std::fs::read_to_string(temp.path().join("a.md")).unwrap(),
        "# Retained\n"
    );
    open(&view, cx, "b.md");
    settle(&view, cx, &|s, cx| s.files(cx).is_hibernated(&key));
    assert!(
        first_view.upgrade().is_none(),
        "the hibernated document's editor must actually be released"
    );
    open(&view, cx, "a.md");
    view.read_with(cx, |s, cx| {
        assert_eq!(s.files(cx).document.as_ref().unwrap().text, "# Retained\n");
    });
    command(&view, cx, Command::Undo);
    settle(&view, cx, &|s, cx| {
        !s.files(cx).saving() && !s.files(cx).dirty
    });
    assert_eq!(
        std::fs::read_to_string(temp.path().join("a.md")).unwrap(),
        "# Original\n"
    );
}
/// A page that edited holds the only copy of its undo history (the web
/// engine's model cannot be detached), so the live slot budget (`WB-01`)
/// never releases it while it is hidden; a clean Markdown copy goes instead.
#[gpui::test]
fn a_hidden_page_holding_its_undo_history_is_not_hibernated(cx: &mut TestAppContext) {
    let flow = |prompt: &str| {
        format!(
            "{{\"kind\":\"puppyflow\",\"version\":1,\"title\":\"Matrix\",\"description\":\"\",\"steps\":[{{\"id\":\"step_matrix\",\"agent\":\"codex\",\"prompt\":\"{prompt}\",\"enabled\":true}}]}}\n"
        )
    };
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("flow.puppyflow"), flow("alpha")).unwrap();
    std::fs::write(temp.path().join("a.md"), "# A\n").unwrap();
    std::fs::write(temp.path().join("b.md"), "# B\n").unwrap();
    let (view, cx) = setup(cx);
    let settle =
        |view: &Entity<Shell>, cx: &mut VisualTestContext, ready: &dyn Fn(&Shell, &App) -> bool| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            loop {
                view.update_in(cx, |s, w, cx| s.receive(w, cx));
                cx.run_until_parked();
                cx.update(|w, cx| {
                    w.draw(cx).clear(cx);
                });
                if view.read_with(cx, |s, cx| ready(s, cx)) {
                    break;
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "Workbench did not settle"
                );
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
        };
    let open = |view: &Entity<Shell>, cx: &mut VisualTestContext, path: &'static str| {
        view.update(cx, |s, cx| {
            s.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFile(path.into())))
        });
        settle(view, cx, &|s, cx| {
            !s.files(cx).busy()
                && s.files(cx)
                    .opened()
                    .is_some_and(|(_, p)| p == std::path::Path::new(path))
        });
    };
    let active_key = |view: &Entity<Shell>, cx: &mut VisualTestContext| {
        view.read_with(cx, |s, cx| {
            s.files(cx)
                .state()
                .unwrap()
                .layout
                .active_editor()
                .unwrap()
                .to_owned()
        })
    };
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| {
            d.set_max_live_slots(1);
            d.begin(Intent::OpenFolder(temp.path().into()))
        })
    });
    settle(&view, cx, &|s, cx| s.files(cx).state().is_some());
    open(&view, cx, "flow.puppyflow");
    let flow_key = active_key(&view, cx);
    let page = view.read_with(cx, |s, cx| s.editor.read(cx).front.clone());
    let generation = page
        .read_with(cx, |h, cx| h.page_generation(cx))
        .expect("a PuppyFlow page");
    let edit =
        serde_json::json!({"type": "content", "generation": generation, "text": flow("human")});
    assert!(page.update(cx, |h, cx| h.page_deliver(&edit.to_string(), cx)));
    settle(&view, cx, &|s, cx| {
        !s.files(cx).saving() && !s.files(cx).dirty
    });
    assert_eq!(
        std::fs::read_to_string(temp.path().join("flow.puppyflow")).unwrap(),
        flow("human")
    );
    open(&view, cx, "a.md");
    let a_key = active_key(&view, cx);
    open(&view, cx, "b.md");
    settle(&view, cx, &|s, cx| s.files(cx).is_hibernated(&a_key));
    view.read_with(cx, |s, cx| {
        assert!(!s.files(cx).is_hibernated(&flow_key));
        assert!(s.files(cx).slot_for_key(&flow_key).is_some());
    });
    assert!(page.read_with(cx, |h, cx| h.holds_page_history(cx)));
}

/// A CSV in a local folder: a cell edit, an added field, an added record and
/// a size picker growth each reach the file through the document session's
/// conditional writes, and the grid shows the grown table.
#[gpui::test]
fn a_local_csv_persists_each_cell_and_structure_change(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("Untitled.csv");
    std::fs::write(&file, "Column 1,Column 2").unwrap();
    let (view, cx) = setup(cx);
    let settle =
        |view: &Entity<Shell>, cx: &mut VisualTestContext, ready: &dyn Fn(&Shell, &App) -> bool| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            loop {
                view.update_in(cx, |s, w, cx| s.receive(w, cx));
                cx.run_until_parked();
                cx.update(|w, cx| {
                    w.draw(cx).clear(cx);
                });
                if view.read_with(cx, |s, cx| ready(s, cx)) {
                    break;
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "Workbench did not settle"
                );
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
        };
    let saved = |view: &Entity<Shell>, cx: &mut VisualTestContext, expected: &str| {
        settle(view, cx, &|s, cx| {
            !s.files(cx).saving() && !s.files(cx).dirty
        });
        assert_eq!(std::fs::read_to_string(&file).unwrap(), expected);
    };
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(temp.path().into())))
    });
    settle(&view, cx, &|s, cx| s.files(cx).state().is_some());
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFile("Untitled.csv".into())))
    });
    settle(&view, cx, &|s, cx| {
        !s.files(cx).busy() && s.editor.read(cx).front.read(cx).csv_editor().is_some()
    });
    let table = view.read_with(cx, |s, cx| {
        s.editor.read(cx).front.read(cx).csv_editor().unwrap()
    });
    table.read_with(cx, |t, _| assert!(!t.read_only && t.is_live()));
    let replace = |cx: &mut VisualTestContext, previous: &str, next: &str| {
        table.update_in(cx, |t, w, cx| {
            assert_eq!(t.find_query(previous, cx).total, 1);
            t.find_focus_editor(w, cx);
        });
        cx.run_until_parked();
        cx.simulate_input(next);
        cx.simulate_keystrokes("enter");
    };
    replace(cx, "Column 1", "Updated");
    saved(&view, cx, "Updated,Column 2");
    table.update_in(cx, |t, w, cx| t.press_add_column(w, cx));
    saved(&view, cx, "Updated,Column 2,");
    table.update_in(cx, |t, w, cx| t.press_add_row(w, cx));
    saved(&view, cx, "Updated,Column 2,\n,,");
    table.update_in(cx, |t, w, cx| t.press_expand(2, 2, w, cx));
    saved(&view, cx, "Updated,Column 2,,,\n,,,,\n,,,,\n,,,,");
    replace(cx, "Updated", "Persisted");
    saved(&view, cx, "Persisted,Column 2,,,\n,,,,\n,,,,\n,,,,");
    table.read_with(cx, |t, cx| {
        let text = t.text(cx);
        assert_eq!(text.lines().count(), 4);
        assert!(text.lines().all(|line| line.split(',').count() == 5));
    });
}

/// A local edit whose save keeps failing stays in its document while the
/// person switches to another file and back: the text, the dirty state and
/// the failure are still there, and the file on disk is untouched.
#[cfg(unix)]
#[gpui::test]
fn a_failing_save_keeps_its_edit_and_failure_across_switching_files(cx: &mut TestAppContext) {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("alpha.md"), "alpha").unwrap();
    std::fs::write(temp.path().join("bravo.md"), "bravo").unwrap();
    let (view, cx) = setup(cx);
    let settle =
        |view: &Entity<Shell>, cx: &mut VisualTestContext, ready: &dyn Fn(&Shell, &App) -> bool| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            loop {
                view.update_in(cx, |s, w, cx| s.receive(w, cx));
                cx.run_until_parked();
                cx.update(|w, cx| {
                    w.draw(cx).clear(cx);
                });
                if view.read_with(cx, |s, cx| ready(s, cx)) {
                    break;
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "Workbench did not settle: {:?}",
                    view.read_with(cx, |s, cx| {
                        let f = s.files(cx);
                        (
                            f.status.clone(),
                            f.dirty,
                            f.saving(),
                            f.save_error.clone(),
                            f.error.clone(),
                            s.editor.read(cx).front.read(cx).text(cx),
                        )
                    })
                );
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
        };
    let open = |view: &Entity<Shell>, cx: &mut VisualTestContext, path: &'static str| {
        view.update(cx, |s, cx| {
            s.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFile(path.into())))
        });
        settle(view, cx, &|s, cx| {
            !s.files(cx).busy()
                && s.files(cx)
                    .opened()
                    .is_some_and(|(_, p)| p == std::path::Path::new(path))
        });
    };
    let shown = |view: &Entity<Shell>, cx: &mut VisualTestContext| {
        view.read_with(cx, |s, cx| s.editor.read(cx).front.read(cx).text(cx))
    };
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(temp.path().into())))
    });
    settle(&view, cx, &|s, cx| s.files(cx).state().is_some());
    open(&view, cx, "alpha.md");
    // The folder refuses new files, so every atomic save fails; the guard
    // gives it back even when an assertion fails.
    struct Writable(std::path::PathBuf, std::fs::Permissions);
    impl Drop for Writable {
        fn drop(&mut self) {
            let _ = std::fs::set_permissions(&self.0, self.1.clone());
        }
    }
    let _writable = Writable(
        temp.path().to_path_buf(),
        std::fs::metadata(temp.path()).unwrap().permissions(),
    );
    std::fs::set_permissions(temp.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
    cx.simulate_keystrokes("cmd-down");
    cx.simulate_input(" changed");
    settle(&view, cx, &|s, cx| s.files(cx).save_error.is_some());
    assert_eq!(shown(&view, cx).as_deref(), Some("alpha changed"));
    open(&view, cx, "bravo.md");
    assert_eq!(shown(&view, cx).as_deref(), Some("bravo"));
    open(&view, cx, "alpha.md");
    assert_eq!(shown(&view, cx).as_deref(), Some("alpha changed"));
    view.read_with(cx, |s, cx| {
        assert!(s.files(cx).dirty);
        assert!(s.files(cx).save_error.is_some());
    });
    assert_eq!(
        std::fs::read_to_string(temp.path().join("alpha.md")).unwrap(),
        "alpha"
    );
}

/// An HTML file in a local folder is edited in its source view, chosen as
/// a person would from the pane menu, and the edit autosaves to the file.
#[gpui::test]
fn a_local_html_source_edit_persists_to_the_file(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("page.html");
    let initial = "<!doctype html><h1>Before</h1>";
    std::fs::write(&file, initial).unwrap();
    let (view, cx) = setup(cx);
    let settle =
        |view: &Entity<Shell>, cx: &mut VisualTestContext, ready: &dyn Fn(&Shell, &App) -> bool| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            loop {
                view.update_in(cx, |s, w, cx| s.receive(w, cx));
                cx.run_until_parked();
                cx.update(|w, cx| {
                    w.draw(cx).clear(cx);
                });
                if view.read_with(cx, |s, cx| ready(s, cx)) {
                    break;
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "Workbench did not settle"
                );
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
        };
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(temp.path().into())))
    });
    settle(&view, cx, &|s, cx| s.files(cx).state().is_some());
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFile("page.html".into())))
    });
    settle(&view, cx, &|s, cx| {
        !s.files(cx).busy() && s.editor.read(cx).front.read(cx).viewer_id() == Some("html-artifact")
    });
    let host = view.read_with(cx, |s, cx| s.editor.read(cx).front.clone());
    host.update_in(cx, |h, w, cx| h.lab_pane_segment("source", w, cx));
    // The menu keeps focus for its keyboard; the person then clicks the text.
    host.update_in(cx, |h, w, cx| h.focus_document(w, cx));
    settle(&view, cx, &|_, _| true);
    cx.simulate_keystrokes("cmd-down");
    cx.simulate_input("<!-- After -->");
    settle(&view, cx, &|s, cx| {
        !s.files(cx).saving() && !s.files(cx).dirty
    });
    assert_eq!(
        std::fs::read_to_string(&file).unwrap(),
        format!("{initial}<!-- After -->")
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
            w.draw(cx).clear(cx);
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
