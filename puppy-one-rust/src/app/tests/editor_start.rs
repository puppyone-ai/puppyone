//! Empty-project start view (Scheme B) and quiet no-open-file list (Scheme A)
//! in the single empty editor pane, plus the Explorer empty-state note.
use super::*;
use crate::{
    app::editor_start::{StartAgent, StartContext, StartInvite},
    editor::workbench::layout::Direction,
    features::create_new::Entry,
};
use core::prelude::v1::test;
use std::path::Path;

fn settle(view: &Entity<Shell>, cx: &mut VisualTestContext, ready: &dyn Fn(&Shell, &App) -> bool) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        draw(cx);
        if view.read_with(cx, |s, cx| ready(s, cx)) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "Workbench did not settle"
        );
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}

fn begin(view: &Entity<Shell>, cx: &mut VisualTestContext, intent: Intent) {
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| d.begin(intent))
    });
}

fn open_folder(view: &Entity<Shell>, cx: &mut VisualTestContext, root: &Path) {
    begin(view, cx, Intent::OpenFolder(root.into()));
    settle(view, cx, &|s, cx| {
        s.files(cx).state().is_some()
            && !s.files(cx).folder_busy
            && !s.files(cx).awaiting_initial_open()
            && s.explorer.session.read(cx).workspace().is_some()
    });
}

fn click_selector(cx: &mut VisualTestContext, selector: &'static str) {
    let bounds = cx
        .debug_bounds(selector)
        .unwrap_or_else(|| panic!("expected debug selector `{selector}` to be visible"));
    cx.simulate_click(bounds.center(), Modifiers::default());
    draw(cx);
}

#[gpui::test]
fn empty_project_shows_start_view_and_compact_explorer_empty_state(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let (view, cx) = setup(cx);
    open_folder(&view, cx, temp.path());

    assert!(
        cx.debug_bounds("editor-start-empty").is_some(),
        "empty writable project shows the start view"
    );
    assert!(cx.debug_bounds("editor-start-closed").is_none());
    assert!(cx.debug_bounds("editor-start-readonly").is_none());

    for selector in [
        "editor-start-create:md",
        "editor-start-create:csv",
        "editor-start-create:html",
        "editor-start-create:whiteboard",
        "editor-start-drop",
    ] {
        assert!(
            cx.debug_bounds(selector).is_some(),
            "expected `{selector}` on the empty-project start view"
        );
    }
    assert!(
        cx.debug_bounds("editor-start-create:folder").is_none(),
        "Folder entry is excluded from paper tiles"
    );

    let note = cx
        .debug_bounds("explorer-empty-note")
        .expect("Explorer shows the empty-project note");
    assert!(
        note.size.height > px(0.),
        "Explorer empty note has non-zero bounds"
    );
}

#[gpui::test]
fn loading_state_hides_start_view(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let (view, cx) = setup(cx);
    open_folder(&view, cx, temp.path());
    assert!(cx.debug_bounds("editor-start-empty").is_some());

    // While folder listing / opening is in flight, never flash the start view.
    view.update_in(cx, |s, w, cx| {
        s.session.docs.update(cx, |d, _| d.folder_busy = true);
        s.sync_editor(w, cx);
    });
    draw(cx);
    assert!(
        cx.debug_bounds("editor-start-empty").is_none(),
        "loading project must not show the empty start view"
    );

    // Restoring folder_busy brings it back.
    view.update_in(cx, |s, w, cx| {
        s.session.docs.update(cx, |d, _| d.folder_busy = false);
        s.sync_editor(w, cx);
    });
    draw(cx);
    assert!(cx.debug_bounds("editor-start-empty").is_some());

    // Before the Explorer listing arrives (`listed == false`), never show it.
    let session = session_of(&view, cx);
    session.update(cx, |s, cx| s.clear_workspace(cx));
    draw(cx);
    assert!(
        cx.debug_bounds("editor-start-empty").is_none(),
        "unlisted workspace must not flash the empty start view"
    );
}

#[gpui::test]
fn split_empty_pane_hides_start_view_and_keeps_close_button(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("a.md"), "# A\n").unwrap();
    let (view, cx) = setup(cx);
    open_folder(&view, cx, temp.path());

    begin(&view, cx, Intent::OpenFile("a.md".into()));
    settle(&view, cx, &|s, cx| s.files(cx).opened().is_some());

    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| {
            d.state_mut().unwrap().split(Direction::Horizontal)
        })
    });
    settle(&view, cx, &|s, cx| {
        s.files(cx)
            .state()
            .is_some_and(|state| state.layout.root.panes().len() == 2)
    });

    let empty_pane = view.read_with(cx, |s, cx| {
        s.files(cx).state().unwrap().layout.active.clone()
    });
    let close_selector: &'static str =
        Box::leak(format!("close-empty:{empty_pane}").into_boxed_str());
    assert!(
        cx.debug_bounds(close_selector).is_some(),
        "split empty pane keeps its close × button"
    );
    assert!(cx.debug_bounds("editor-start-empty").is_none());
    assert!(cx.debug_bounds("editor-start-closed").is_none());
}

#[gpui::test]
fn read_only_empty_project_shows_text_without_buttons(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let (view, cx) = setup(cx);
    open_folder(&view, cx, temp.path());

    let read_only = crate::workspace::Workspace::from_provider(std::sync::Arc::new(
        crate::workspace::testing::Memory::new("memory://read-only/empty/"),
    ))
    .unwrap();
    let session = session_of(&view, cx);
    session.update(cx, |s, cx| s.load_workspace(read_only, vec![], cx));
    view.update_in(cx, |s, w, cx| s.sync_editor(w, cx));
    draw(cx);

    assert!(
        cx.debug_bounds("editor-start-readonly").is_some(),
        "read-only empty project renders only the quiet empty message"
    );
    for forbidden in [
        "editor-start-empty",
        "editor-start-create:md",
        "editor-start-drop",
        "editor-start-agent-row",
        "editor-start-invite-agent",
    ] {
        assert!(
            cx.debug_bounds(forbidden).is_none(),
            "read-only empty project must not show `{forbidden}`"
        );
    }
}

#[gpui::test]
fn a_kind_row_makes_an_untitled_file_at_once_and_opens_it(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let (view, cx) = setup(cx);
    open_folder(&view, cx, temp.path());

    click_selector(cx, "editor-start-create:csv");
    settle(&view, cx, &|s, cx| {
        s.files(cx).opened().map(|(_, p)| p) == Some(Path::new("Untitled.csv"))
    });
    assert!(
        view.read_with(cx, |s, cx| s.dialogs.read(cx).create_form().is_none()),
        "no name is asked for"
    );
    assert!(temp.path().join("Untitled.csv").is_file());
    assert!(cx.debug_bounds("editor-start-empty").is_none());

    // The next one of the same kind takes the next free name.
    view.update_in(cx, |s, w, cx| {
        s.start_create(Entry::Csv, PathBuf::new(), w, cx)
    });
    settle(&view, cx, &|s, cx| {
        s.files(cx).opened().map(|(_, p)| p) == Some(Path::new("Untitled 2.csv"))
    });
    assert!(temp.path().join("Untitled 2.csv").is_file());
}

#[gpui::test]
fn a_new_folder_still_asks_for_its_name(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let (view, cx) = setup(cx);
    open_folder(&view, cx, temp.path());
    view.update_in(cx, |s, w, cx| {
        s.start_create(Entry::Folder, PathBuf::new(), w, cx)
    });
    draw(cx);
    let kind = view.read_with(cx, |s, cx| {
        s.dialogs
            .read(cx)
            .create_form()
            .map(|form| form.read(cx).kind())
    });
    assert_eq!(kind, Some(Entry::Folder));
}

#[gpui::test]
fn project_with_files_and_none_open_shows_quiet_recent_list(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("a.md"), "# A\n").unwrap();
    std::fs::write(temp.path().join("b.md"), "# B\n").unwrap();
    std::fs::create_dir_all(temp.path().join("notes")).unwrap();
    std::fs::write(temp.path().join("notes/c.md"), "# C\n").unwrap();
    std::fs::write(temp.path().join("d.md"), "# D\n").unwrap();

    let (view, cx) = setup(cx);
    open_folder(&view, cx, temp.path());

    // Open four files in sequence so MRU order is d.md, notes/c.md, b.md, a.md.
    for path in ["a.md", "b.md", "notes/c.md", "d.md"] {
        begin(&view, cx, Intent::OpenFile(path.into()));
        settle(&view, cx, &|s, cx| {
            s.files(cx)
                .opened()
                .is_some_and(|(_, p)| p == Path::new(path))
        });
    }

    // Close every open editor so the single pane becomes empty while files exist.
    loop {
        let active = view.read_with(cx, |s, cx| {
            let key = s.files(cx).state()?.layout.active_editor()?.to_owned();
            let slot = s.files(cx).slot_for_key(&key)?;
            Some((key, slot))
        });
        let Some((key, slot)) = active else { break };
        view.update(cx, |s, cx| {
            s.session.docs.update(cx, |d, _| d.close_slot(slot))
        });
        settle(&view, cx, &|s, cx| {
            s.files(cx)
                .state()
                .is_some_and(|st| st.layout.active_editor() != Some(key.as_str()))
        });
    }
    draw(cx);

    assert!(
        cx.debug_bounds("editor-start-closed").is_some(),
        "non-empty project with no open tab shows the quiet no-open-file list"
    );
    assert!(cx.debug_bounds("editor-start-empty").is_none());
    assert!(cx.debug_bounds("editor-start-recent:0").is_some());
    assert!(cx.debug_bounds("editor-start-recent:1").is_some());
    assert!(cx.debug_bounds("editor-start-recent:2").is_some());
    assert!(
        cx.debug_bounds("editor-start-recent:3").is_none(),
        "at most 3 recent files are shown"
    );
    assert!(
        cx.debug_bounds("editor-start-create:md").is_some(),
        "the file kinds follow the recent list"
    );

    // Clicking the newest recent file reopens d.md and leaves the start view.
    click_selector(cx, "editor-start-recent:0");
    settle(&view, cx, &|s, cx| {
        s.files(cx).opened().map(|(_, p)| p) == Some(Path::new("d.md"))
    });
    assert!(cx.debug_bounds("editor-start-closed").is_none());
}

#[gpui::test]
fn start_view_agent_row_follows_local_and_cloud_context(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let (view, cx) = setup(cx);
    open_folder(&view, cx, temp.path());

    // Local with no detected agents: agent row is hidden.
    view.update(cx, |s, cx| {
        s.editor.update(cx, |e, cx| {
            e.set_start_context(
                StartContext {
                    hosted: false,
                    loading: false,
                    cloud_agents_manageable: false,
                    local_agents: Vec::new(),
                    ..Default::default()
                },
                cx,
            )
        });
    });
    draw(cx);
    assert!(cx.debug_bounds("editor-start-agent-row").is_none());

    // Local with detected agents: agent chips appear.
    view.update(cx, |s, cx| {
        s.editor.update(cx, |e, cx| {
            e.set_start_context(
                StartContext {
                    hosted: false,
                    loading: false,
                    cloud_agents_manageable: false,
                    local_agents: vec![StartAgent {
                        runtime_id: "claude".into(),
                        icon_key: "claude",
                        label: "Claude Code".into(),
                    }],
                    ..Default::default()
                },
                cx,
            )
        });
    });
    draw(cx);
    assert!(cx.debug_bounds("editor-start-agent-row").is_some());
    assert!(cx.debug_bounds("editor-start-agent:claude").is_some());

    // A Cloud project its viewer cannot manage: no hand-off.
    let cloud = |cx: &mut VisualTestContext, manageable: bool, invite: StartInvite| {
        view.update(cx, |s, cx| {
            s.editor.update(cx, |e, cx| {
                e.set_start_context(
                    StartContext {
                        hosted: true,
                        cloud_agents_manageable: manageable,
                        invite,
                        ..Default::default()
                    },
                    cx,
                )
            });
        });
        draw(cx);
    };
    cloud(cx, false, StartInvite::Give);
    assert!(cx.debug_bounds("editor-start-copy-invite").is_none());
    assert!(cx.debug_bounds("editor-start-agent-row").is_none());

    // Its owner hands it to an Agent from the start view, step by step.
    cloud(cx, true, StartInvite::Give);
    assert!(cx.debug_bounds("editor-start-handoff").is_some());
    assert!(cx.debug_bounds("editor-start-copy-invite").is_some());
    assert!(
        view.read_with(cx, |s, cx| s.editor.read(cx).shows_cloud_handoff(cx)),
        "the start view answers the Agents in place of the Header"
    );
    cloud(cx, true, StartInvite::Waiting);
    assert!(cx.debug_bounds("editor-start-waiting").is_some());
    cloud(
        cx,
        true,
        StartInvite::Knocking {
            request: "r1".into(),
            name: "Claude".into(),
            deciding: false,
        },
    );
    assert!(cx.debug_bounds("editor-start-knock").is_some());
    assert!(cx.debug_bounds("editor-start-allow").is_some());
    assert!(cx.debug_bounds("editor-start-copy-invite").is_none());
    cloud(cx, true, StartInvite::Joined("Claude".into()));
    assert!(cx.debug_bounds("editor-start-joined").is_some());
}
