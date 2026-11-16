use super::*;
use crate::features::project_import::SOURCES;
use core::prelude::v1::test;

#[test]
fn the_experiment_opens_the_other_apps_and_coming_soon_stays_last() {
    let ready: Vec<_> = visible(false).map(|s| s.id).collect();
    assert_eq!(ready, ["github", "gitlab"]);
    assert_eq!(visible(true).count(), SOURCES.len());
    assert_eq!(
        crate::features::project_import::preview(false)
            .map(|s| s.id)
            .collect::<Vec<_>>(),
        ["github", "gitlab"]
    );
    assert_eq!(
        crate::features::project_import::preview(true)
            .map(|s| s.id)
            .collect::<Vec<_>>(),
        ["github", "gitlab", "obsidian"]
    );
    let mut folders = HashMap::new();
    let source = |id| SOURCES.iter().find(|s| s.id == id).unwrap();
    assert_eq!(status(source("github"), &folders), None);
    assert_eq!(
        status(source("notion"), &folders),
        Some("onboarding.entry.import.directUnavailable")
    );
    assert!(disabled(source("obsidian"), &folders), "still reading");
    folders.insert("obsidian", Folders::Found(vec![]));
    assert_eq!(
        status(source("obsidian"), &folders),
        Some("onboarding.entry.import.app.notFound")
    );
    assert!(disabled(source("obsidian"), &folders));
    folders.insert("obsidian", Folders::Failed);
    assert!(
        !disabled(source("obsidian"), &folders),
        "a failed read can be retried"
    );
    folders.insert(
        "obsidian",
        Folders::Found(vec![AppFolder {
            path: "/v".into(),
            name: "v".into(),
            last_used_at: None,
        }]),
    );
    assert_eq!(status(source("obsidian"), &folders), None);
    assert!(!disabled(source("obsidian"), &folders));
}

use crate::app::tests::{settle_cloud, setup};
use tokio::sync::oneshot;

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        let _ = w.draw(cx);
        w.simulate_next_frame(cx);
        let _ = w.draw(cx);
    });
}
fn click(cx: &mut VisualTestContext, selector: &'static str) {
    draw(cx);
    let bounds = cx
        .debug_bounds(selector)
        .unwrap_or_else(|| panic!("missing {selector}"));
    cx.simulate_click(bounds.center(), Modifiers::default());
    draw(cx);
}
fn show_home(shell: &Entity<crate::app::Shell>, cx: &mut VisualTestContext) {
    shell.update_in(cx, |s, w, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.home.update(cx, |h, _| {
            h.intro_empty = Some(true);
            h.intro = None;
        });
        s.command(Command::Home, w, cx);
    });
    settle_cloud(shell, cx, "empty Homepage", &|s, cx| {
        s.home_visible(cx) && !s.home.read(cx).list_held()
    });
}
fn pending_read(
    h: &mut Homepage,
    cx: &mut Context<Homepage>,
) -> oneshot::Sender<Result<Vec<AppFolder>, String>> {
    let picker = h.import_picker.as_mut().unwrap();
    picker.folders.insert("obsidian", Folders::Loading);
    let (send, receive) = oneshot::channel();
    let task = cx
        .background_executor()
        .spawn(async move { receive.await.unwrap() });
    finish_app_folder_read(
        task,
        picker.identity.clone(),
        picker.attempt,
        "obsidian",
        cx,
    );
    send
}
fn pending_add(
    h: &mut Homepage,
    w: &mut Window,
    cx: &mut Context<Homepage>,
) -> oneshot::Sender<Option<Vec<PathBuf>>> {
    let picker = h.import_picker.as_mut().unwrap();
    picker.source = Some(SOURCES.iter().find(|s| s.id == "obsidian").unwrap());
    picker.adding = true;
    let (send, receive) = oneshot::channel();
    let task = cx
        .background_executor()
        .spawn(async move { receive.await.unwrap() });
    finish_add_app_folders(task, picker.identity.clone(), "obsidian", w, cx);
    send
}

#[gpui::test]
fn folder_read_receipts_cannot_cross_picker_or_retry_lifetimes(cx: &mut TestAppContext) {
    let (shell, cx) = setup(cx);
    for reopen in [true, false] {
        let (old, current) = shell.update_in(cx, |s, w, cx| {
            s.home.update(cx, |h, cx| {
                h.begin_import(w, cx);
                let first_attempt = h.import_picker.as_ref().unwrap().attempt;
                let old = pending_read(h, cx);
                if reopen {
                    h.close_import(w, cx);
                    h.begin_import(w, cx);
                    assert_eq!(
                        h.import_picker.as_ref().unwrap().attempt,
                        first_attempt,
                        "a per-picker sequence alone cannot reject the old reply"
                    );
                } else {
                    h.list_app_folders(cx);
                }
                (old, pending_read(h, cx))
            })
        });
        current.send(Ok(vec![])).unwrap();
        draw(cx);
        old.send(Err("retired read".into())).unwrap();
        draw(cx);
        shell.read_with(cx, |s, cx| {
            assert_eq!(
                s.home
                    .read(cx)
                    .import_picker
                    .as_ref()
                    .unwrap()
                    .folders
                    .get("obsidian"),
                Some(&Folders::Found(vec![]))
            );
        });
    }
}

#[gpui::test]
fn stale_add_receipts_neither_add_recents_nor_close_or_error_a_new_picker(cx: &mut TestAppContext) {
    let (shell, cx) = setup(cx);
    let root = tempfile::tempdir().unwrap();
    let old_path = root.path().join("old");
    for reply in [Some(vec![old_path.clone()]), None] {
        let (old, current) = shell.update_in(cx, |s, w, cx| {
            s.home.update(cx, |h, cx| {
                h.begin_import(w, cx);
                let old = pending_add(h, w, cx);
                h.close_import(w, cx);
                h.begin_import(w, cx);
                (old, pending_add(h, w, cx))
            })
        });
        old.send(reply).unwrap();
        draw(cx);
        shell.read_with(cx, |s, cx| {
            let h = s.home.read(cx);
            let p = h.import_picker.as_ref().unwrap();
            assert!(p.adding);
            assert!(p.error.is_none());
            assert!(!h.listed(&old_path, cx));
            assert!(h.dialog_open(DialogKey::ImportRepository, cx));
        });
        current.send(None).unwrap();
        draw(cx);
        shell.read_with(cx, |s, cx| {
            let p = s.home.read(cx).import_picker.as_ref().unwrap();
            assert!(!p.adding);
            assert_eq!(
                p.error.as_deref(),
                Some(tr("onboarding.entry.import.app.readFailed"))
            );
        });
    }
}

#[gpui::test]
fn failed_app_records_retry_through_the_button_and_add_only_still_recorded_folders(
    cx: &mut TestAppContext,
) {
    let (shell, cx) = setup(cx);
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let notes = root.join("Notes");
    let removed = root.join("Removed");
    let added = root.join("Already added");
    for path in [&notes, &removed, &added] {
        std::fs::create_dir(path).unwrap();
    }
    std::fs::write(notes.join("note.md"), "keep in place").unwrap();
    let record = root.join("data/obsidian/obsidian.json");
    std::fs::create_dir_all(record.parent().unwrap()).unwrap();
    std::fs::write(&record, "invalid json").unwrap();
    shell.update_in(cx, |s, w, cx| {
        s.prefs.store.update(cx, |p, _| {
            p.state.experimental.other_app_imports = true;
            p.state.add_recent_projects(std::slice::from_ref(&added), 1);
        });
        s.home.update(cx, |h, cx| {
            h.app_places = Some(app_folders::Places {
                home: root.join("home"),
                app_data: root.join("data"),
            });
            h.begin_import(w, cx);
        });
    });
    settle_cloud(&shell, cx, "failed app read", &|s, cx| {
        s.home
            .read(cx)
            .import_picker
            .as_ref()
            .unwrap()
            .folders
            .get("obsidian")
            == Some(&Folders::Failed)
    });
    click(cx, "import-source-obsidian");
    shell.read_with(cx, |s, cx| {
        assert_eq!(
            s.home
                .read(cx)
                .import_picker
                .as_ref()
                .unwrap()
                .source
                .unwrap()
                .id,
            "obsidian"
        )
    });
    std::fs::write(&record, serde_json::json!({"vaults": {
        "a": {"path": notes, "ts": 3}, "b": {"path": removed, "ts": 2}, "c": {"path": added, "ts": 1}
    }}).to_string()).unwrap();
    click(cx, "import-app-retry");
    settle_cloud(
        &shell,
        cx,
        "retried app read",
        &|s, cx| matches!(s.home.read(cx).import_picker.as_ref().unwrap().folders.get("obsidian"), Some(Folders::Found(f)) if f.len() == 3),
    );
    assert!(cx.debug_bounds("import-app-retry").is_none());
    click(cx, "import-app-folder-2"); // Already listed: non-interactive.
    shell.read_with(cx, |s, cx| {
        assert!(
            s.home
                .read(cx)
                .import_picker
                .as_ref()
                .unwrap()
                .chosen
                .is_empty()
        )
    });
    click(cx, "import-app-add"); // No selection: disabled.
    shell.read_with(cx, |s, cx| assert!(s.home.read(cx).import_picker.is_some()));
    click(cx, "import-app-folder-0");
    click(cx, "import-app-folder-1");
    // The source changes after discovery. The real add operation must read it again.
    std::fs::write(&record, serde_json::json!({"vaults": {"a": {"path": notes, "ts": 3}, "c": {"path": added, "ts": 1}}}).to_string()).unwrap();
    click(cx, "import-app-add");
    settle_cloud(&shell, cx, "added in place", &|s, cx| {
        s.home.read(cx).import_picker.is_none()
    });
    shell.read_with(cx, |s, cx| {
        let h = s.home.read(cx);
        let paths: Vec<_> = h
            .preferences
            .read(cx)
            .state
            .recent_projects
            .iter()
            .map(|p| p.path.clone())
            .collect();
        assert_eq!(paths, [notes.clone(), added.clone()]);
        assert!(s.workspace_root(cx).is_none());
    });
    assert_eq!(
        std::fs::read_to_string(notes.join("note.md")).unwrap(),
        "keep in place"
    );
    assert!(removed.is_dir());
}

#[gpui::test]
fn live_import_preferences_refresh_marks_scan_apps_and_retire_hidden_requests(
    cx: &mut TestAppContext,
) {
    let (shell, cx) = setup(cx);
    show_home(&shell, cx);
    let root = tempfile::tempdir().unwrap();
    shell.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            *p = PreferencesStore::isolated(root.path().join("preferences"), cx);
        })
    });
    settle_cloud(&shell, cx, "durable preference owner", &|s, cx| {
        s.prefs.store.read(cx).loaded
    });
    shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.app_places = Some(app_folders::Places {
                home: root.path().join("home"),
                app_data: root.path().join("data"),
            });
            h.begin_import(w, cx);
        })
    });
    draw(cx);
    assert!(cx.debug_bounds("import-source-obsidian").is_none());
    assert!(cx.debug_bounds("import-preview-obsidian").is_none());
    shell.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.change(|p| p.experimental.other_app_imports = true, cx)
        })
    });
    settle_cloud(&shell, cx, "live app discovery", &|s, cx| {
        let p = s.home.read(cx).import_picker.as_ref().unwrap();
        p.folders.len() == 4 && p.folders.values().all(|f| *f == Folders::Found(vec![]))
    });
    assert!(cx.debug_bounds("import-source-obsidian").is_some());
    assert!(cx.debug_bounds("import-preview-obsidian").is_some());
    settle_cloud(&shell, cx, "persisted import preference", &|s, cx| {
        s.prefs.store.read(cx).drained()
    });
    let stored: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.path().join("preferences/preferences.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(stored["experimental"]["other_app_imports"], true);
    let (read, add) = shell.update_in(cx, |s, w, cx| {
        s.home
            .update(cx, |h, cx| (pending_read(h, cx), pending_add(h, w, cx)))
    });
    shell.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.change(|p| p.experimental.other_app_imports = false, cx)
        })
    });
    draw(cx);
    read.send(Err("retired read".into())).unwrap();
    add.send(Some(vec![root.path().join("stale")])).unwrap();
    draw(cx);
    shell.read_with(cx, |s, cx| {
        let h = s.home.read(cx);
        let p = h.import_picker.as_ref().unwrap();
        assert!(p.source.is_none() && p.folders.is_empty() && p.error.is_none() && !p.adding);
        assert!(h.preferences.read(cx).state.recent_projects.is_empty());
    });
    assert!(cx.debug_bounds("import-source-obsidian").is_none());
    assert!(cx.debug_bounds("import-preview-obsidian").is_none());
}

#[gpui::test]
fn source_buttons_start_focused_activate_by_keyboard_and_reject_unavailable_sources(
    cx: &mut TestAppContext,
) {
    let (shell, cx) = setup(cx);
    shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.begin_import(w, cx))
    });
    draw(cx);
    shell.update_in(cx, |s, w, cx| {
        assert!(
            s.home
                .read(cx)
                .import_picker
                .as_ref()
                .unwrap()
                .first_source_focus
                .is_focused(w)
        );
        s.home
            .update(cx, |h, cx| h.choose_import_source("obsidian", w, cx));
        assert!(
            s.home
                .read(cx)
                .import_picker
                .as_ref()
                .unwrap()
                .source
                .is_none()
        );
    });
    let keystroke = Keystroke::parse("enter").unwrap();
    cx.simulate_event(KeyDownEvent {
        keystroke: keystroke.clone(),
        is_held: false,
        prefer_character_input: false,
    });
    cx.simulate_event(KeyUpEvent { keystroke });
    draw(cx);
    shell.read_with(cx, |s, cx| assert!(s.home.read(cx).import.is_some()));
    let root = tempfile::tempdir().unwrap();
    shell.update_in(cx, |s, w, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.other_app_imports = true);
        s.home.update(cx, |h, cx| {
            h.app_places = Some(app_folders::Places {
                home: root.path().join("home"),
                app_data: root.path().join("data"),
            });
            h.begin_import(w, cx);
        });
    });
    for selector in [
        "import-source-notion",
        "import-source-google-drive",
        "import-source-airtable",
        "import-source-vscode",
    ] {
        click(cx, selector);
        shell.read_with(cx, |s, cx| {
            let h = s.home.read(cx);
            assert!(h.import_picker.as_ref().unwrap().source.is_none());
            assert!(h.import.is_none());
        });
    }
    assert!(!cx.did_prompt_for_paths());
}

#[gpui::test]
fn import_entry_icon_label_and_preview_marks_open_the_same_source_picker(cx: &mut TestAppContext) {
    let (shell, cx) = setup(cx);
    show_home(&shell, cx);
    let root = tempfile::tempdir().unwrap();
    shell.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.change(|p| p.experimental.other_app_imports = true, cx)
        });
        s.home.update(cx, |h, _| {
            h.app_places = Some(app_folders::Places {
                home: root.path().join("home"),
                app_data: root.path().join("data"),
            })
        });
    });
    for selector in [
        "home-import",
        "home-import-icon",
        "home-import-label",
        "import-preview-github",
        "import-preview-obsidian",
    ] {
        click(cx, selector);
        shell.read_with(cx, |s, cx| {
            let h = s.home.read(cx);
            assert!(h.dialog_open(DialogKey::ImportRepository, cx));
            assert_eq!(h.import_sources(cx).len(), 9);
            assert!(h.import_picker.as_ref().unwrap().source.is_none());
            assert!(h.import.is_none());
        });
        assert!(!cx.did_prompt_for_paths());
        cx.simulate_keystrokes("escape");
        draw(cx);
        shell.read_with(cx, |s, cx| assert!(s.home.read(cx).import_picker.is_none()));
    }
}

#[gpui::test]
fn the_default_picker_is_one_named_dialog_with_two_labelled_source_buttons(
    cx: &mut TestAppContext,
) {
    let (shell, cx) = setup(cx);
    show_home(&shell, cx);
    click(cx, "home-import");
    // The initial focus is assigned after the new modal has joined the focus tree.
    draw(cx);
    assert!(cx.debug_bounds("dialog-leading").is_none());
    assert!(!cx.did_prompt_for_paths());
    shell.update_in(cx, |s, w, cx| {
        let home = s.home.read(cx);
        let picker = home.import_picker.as_ref().unwrap();
        assert!(home.import.is_none() && picker.source.is_none());
        assert!(
            picker.first_source_focus.is_focused(w),
            "wanted {:?}, actual {:?}, initial {}, dialog {:?}, home {}",
            picker.first_source_focus,
            w.focused(cx),
            picker.focused_initial,
            home.top_dialog(cx),
            s.home_visible(cx)
        );
        assert_eq!(
            home.import_sources(cx)
                .iter()
                .map(|s| s.id)
                .collect::<Vec<_>>(),
            ["github", "gitlab"]
        );
        let snapshots = gpui_kit::base::test_support::snapshots(w);
        let dialogs: Vec<_> = snapshots
            .iter()
            .filter(|s| s.role() == Some(gpui::Role::Dialog))
            .collect();
        assert_eq!(dialogs.len(), 1);
        assert_eq!(
            dialogs[0].label(),
            Some(tr("onboarding.entry.import.title"))
        );
        for (id, label) in [
            ("import-source-github", "GitHub"),
            ("import-source-gitlab", "GitLab"),
        ] {
            let sources: Vec<_> = snapshots
                .iter()
                .filter(|s| s.path().contains(&ElementId::from(id)))
                .collect();
            assert_eq!(sources.len(), 1, "source has no nested controls");
            assert_eq!(sources[0].role(), Some(gpui::Role::Button));
            assert_eq!(sources[0].label(), Some(label));
            assert_ne!(sources[0].disabled(), Some(true));
        }
    });
}

#[gpui::test]
fn mounted_import_steps_focus_once_and_return_to_the_first_source(cx: &mut TestAppContext) {
    let (shell, cx) = setup(cx);
    show_home(&shell, cx);
    click(cx, "home-import");
    // Activate the initial button through the native keyboard path.
    let keystroke = Keystroke::parse("enter").unwrap();
    cx.simulate_event(KeyDownEvent {
        keystroke: keystroke.clone(),
        is_held: false,
        prefer_character_input: false,
    });
    cx.simulate_event(KeyUpEvent { keystroke });
    draw(cx);
    shell.update_in(cx, |s, w, cx| {
        let import = s.home.read(cx).import.as_ref().unwrap();
        assert_eq!(
            s.home
                .read(cx)
                .import_picker
                .as_ref()
                .unwrap()
                .source
                .unwrap()
                .id,
            "github"
        );
        assert!(import.url.read(cx).focus_handle(cx).is_focused(w));
    });
    cx.simulate_input("https://github.com/owner/repository.git");
    cx.simulate_keystrokes("tab");
    let tabbed = cx.update(|w, cx| w.focused(cx).unwrap());
    draw(cx);
    shell.update_in(cx, |s, w, cx| {
        let input = s.home.read(cx).import.as_ref().unwrap().url.read(cx);
        assert!(!input.focus_handle(cx).is_focused(w));
        assert!(
            tabbed.is_focused(w),
            "rerender must not restart initial focus"
        );
        assert_eq!(input.text(), "https://github.com/owner/repository.git");
    });
    click(cx, "import-back");
    shell.update_in(cx, |s, w, cx| {
        let home = s.home.read(cx);
        assert!(home.import.is_none());
        assert!(
            home.import_picker
                .as_ref()
                .unwrap()
                .first_source_focus
                .is_focused(w)
        );
    });
    click(cx, "import-source-gitlab");
    shell.update_in(cx, |s, w, cx| {
        let import = s.home.read(cx).import.as_ref().unwrap();
        assert_eq!(
            s.home
                .read(cx)
                .import_picker
                .as_ref()
                .unwrap()
                .source
                .unwrap()
                .id,
            "gitlab"
        );
        assert!(import.url.read(cx).focus_handle(cx).is_focused(w));
    });
}

#[gpui::test]
fn retired_import_frame_callbacks_cannot_steal_focus(cx: &mut TestAppContext) {
    let (shell, cx) = setup(cx);
    for repository in [false, true] {
        shell.update_in(cx, |s, w, cx| {
            s.home.update(cx, |h, cx| {
                h.begin_import(w, cx);
                if repository {
                    h.choose_import_source("github", w, cx);
                    h.focus_repository_after_mount(w, cx);
                } else {
                    h.focus_source_list_after_mount(w, cx);
                }
                h.close_import(w, cx);
            });
            s.frame.focus.focus(w, cx);
        });
        draw(cx);
        shell.update_in(cx, |s, w, cx| {
            assert!(s.home.read(cx).import_picker.is_none());
            assert!(s.frame.focus.is_focused(w));
        });
    }
    shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.begin_import(w, cx);
            h.focus_source_list_after_mount(w, cx);
            h.choose_import_source("github", w, cx);
            h.focus_repository_after_mount(w, cx);
            h.close_import(w, cx);
            h.begin_import(w, cx);
            h.choose_import_source("gitlab", w, cx);
        });
    });
    draw(cx);
    shell.update_in(cx, |s, w, cx| {
        let home = s.home.read(cx);
        assert_eq!(
            home.import_picker.as_ref().unwrap().source.unwrap().id,
            "gitlab"
        );
        assert!(
            home.import
                .as_ref()
                .unwrap()
                .url
                .read(cx)
                .focus_handle(cx)
                .is_focused(w)
        );
    });
    // A still-live import under another modal must not take its keyboard.
    shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.begin_import(w, cx);
            h.focus_source_list_after_mount(w, cx);
        });
        s.show_error("another modal", cx);
        s.frame.focus.focus(w, cx);
    });
    draw(cx);
    shell.update_in(cx, |s, w, cx| {
        assert!(s.home.read(cx).import_picker.is_some());
        assert!(s.frame.focus.is_focused(w));
    });
}
#[gpui::test]
fn an_unavailable_import_entry_keeps_its_label_and_brand_marks_inert(cx: &mut TestAppContext) {
    let (shell, cx) = setup(cx);
    show_home(&shell, cx);
    shell.update(cx, |s, cx| {
        s.home.update(cx, |h, cx| {
            h.session.busy = true;
            cx.notify();
        })
    });
    draw(cx);
    cx.update(|w, _| {
        let snapshots = gpui_kit::base::test_support::snapshots(w);
        let entry: Vec<_> = snapshots
            .iter()
            .filter(|s| s.path().contains(&ElementId::from("home-import")))
            .collect();
        assert_eq!(
            entry.len(),
            1,
            "label and marks cannot be nested controls or focus stops"
        );
        assert_eq!(entry[0].role(), Some(gpui::Role::Button));
        assert_eq!(entry[0].disabled(), Some(true));
    });
    for selector in [
        "home-import-label",
        "home-import-icon",
        "import-preview-github",
        "import-preview-gitlab",
    ] {
        click(cx, selector);
        shell.read_with(cx, |s, cx| {
            let h = s.home.read(cx);
            assert!(h.import_picker.is_none() && h.import.is_none());
        });
        assert!(!cx.did_prompt_for_paths());
    }
    shell.update(cx, |s, cx| {
        s.home.update(cx, |h, cx| {
            h.session.busy = false;
            cx.notify();
        })
    });
    click(cx, "home-import-label");
    shell.read_with(cx, |s, cx| assert!(s.home.read(cx).import_picker.is_some()));
}
