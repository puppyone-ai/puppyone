//! Window events must reach every retained native editor's persistence owner.
use super::*;
use crate::editor::host::DocumentEditor;
use core::prelude::v1::test;
use std::time::Duration;

fn snapshot_serials(view: &Entity<Shell>, cx: &mut VisualTestContext, slots: &[u64]) -> Vec<u64> {
    view.read_with(cx, |s, cx| {
        slots
            .iter()
            .map(|id| s.files(cx).slot(*id).unwrap().snapshot_request_serial())
            .collect()
    })
}

fn open_project_files(
    view: &Entity<Shell>,
    cx: &mut VisualTestContext,
    root: &std::path::Path,
    names: &[&str],
) -> Vec<(u64, Entity<DocumentEditor>)> {
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(root.into())));
    });
    settle_cloud(view, cx, "auto-save project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(root)
    });
    names
        .iter()
        .map(|name| {
            view.update(cx, |s, cx| {
                s.session
                    .docs
                    .update(cx, |d, _| d.begin(Intent::OpenFile((*name).into())));
            });
            settle_cloud(view, cx, "auto-save document", &|s, cx| {
                s.files(cx)
                    .opened()
                    .is_some_and(|(_, path)| path == std::path::Path::new(name))
            });
            view.read_with(cx, |s, cx| {
                (s.files(cx).active_slot(), s.editor.read(cx).front.clone())
            })
        })
        .collect()
}

fn type_draft(editor: &Entity<DocumentEditor>, cx: &mut VisualTestContext) {
    editor.update_in(cx, |e, window, cx| e.lab_type(" draft", window, cx));
    cx.run_until_parked();
    assert_eq!(
        editor.read_with(cx, |e, cx| e.text(cx)),
        Some("saved draft".into())
    );
}

fn pump(view: &Entity<Shell>, cx: &mut VisualTestContext) {
    view.update_in(cx, |s, window, cx| s.receive(window, cx));
    cx.run_until_parked();
}

#[gpui::test]
fn window_blur_writes_all_pending_editors_once_and_leaves_idle_editors_untouched(
    cx: &mut TestAppContext,
) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    for name in ["first.txt", "second.txt", "idle.txt"] {
        std::fs::write(root.join(name), "saved").unwrap();
    }
    let (view, cx) = setup(cx);
    let editors = open_project_files(&view, cx, &root, &["first.txt", "second.txt", "idle.txt"]);
    let slots: Vec<_> = editors.iter().map(|(id, _)| *id).collect();
    cx.update(|window, _| window.activate_window());
    // Hidden native hosts are input-gated. Type through each active tab,
    // retaining both pending drafts when the idle third tab is brought back.
    for (index, name) in ["first.txt", "second.txt", "idle.txt"].iter().enumerate() {
        view.update(cx, |s, cx| {
            s.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFile((*name).into())));
        });
        pump(&view, cx);
        if index < 2 {
            type_draft(&editors[index].1, cx);
        }
    }
    assert_eq!(snapshot_serials(&view, cx, &slots), [0, 0, 0]);

    cx.deactivate_window();
    pump(&view, cx);
    assert_eq!(snapshot_serials(&view, cx, &slots), [1, 1, 0]);
    settle_cloud(&view, cx, "all blur saves", &|s, cx| {
        editors.iter().all(|(id, _)| {
            s.files(cx)
                .slot(*id)
                .is_some_and(|d| !d.dirty && !d.saving())
        })
    });
    for name in ["first.txt", "second.txt"] {
        assert_eq!(
            std::fs::read_to_string(root.join(name)).unwrap(),
            "saved draft"
        );
    }
    assert_eq!(
        std::fs::read_to_string(root.join("idle.txt")).unwrap(),
        "saved"
    );
    assert_eq!(
        view.read_with(cx, |s, cx| s.files(cx).active_slot()),
        editors[2].0
    );

    cx.simulate_visibility_change(WindowVisibility::Hidden);
    std::thread::sleep(Duration::from_millis(2100));
    pump(&view, cx);
    assert_eq!(snapshot_serials(&view, cx, &slots), [1, 1, 0]);
}

#[gpui::test]
fn window_visibility_flushes_pending_typing_only_when_hidden(cx: &mut TestAppContext) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hidden.txt");
    std::fs::write(&path, "saved").unwrap();
    let (view, cx) = setup(cx);
    file_window_parity::bind(&view, cx, path.clone());
    settle_cloud(&view, cx, "file window", &|s, cx| {
        s.files(cx).document.is_some()
    });
    let editor = view.read_with(cx, |s, cx| {
        s.file.as_ref().unwrap().read(cx).file_editor(cx).unwrap()
    });
    let slot = view.read_with(cx, |s, cx| s.files(cx).active_slot());
    type_draft(&editor, cx);
    assert_eq!(snapshot_serials(&view, cx, &[slot]), [0]);

    cx.simulate_visibility_change(WindowVisibility::Visible);
    pump(&view, cx);
    assert_eq!(
        snapshot_serials(&view, cx, &[slot]),
        [0],
        "becoming visible must retain the idle delay"
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "saved");

    cx.simulate_visibility_change(WindowVisibility::Hidden);
    pump(&view, cx);
    assert_eq!(
        snapshot_serials(&view, cx, &[slot]),
        [1],
        "hiding must request the pending snapshot now"
    );
    settle_cloud(&view, cx, "hidden file save", &|s, cx| {
        !s.files(cx).dirty && !s.files(cx).saving()
    });
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "saved draft");
    cx.simulate_visibility_change(WindowVisibility::Hidden);
    cx.simulate_visibility_change(WindowVisibility::Visible);
    std::thread::sleep(Duration::from_millis(2100));
    pump(&view, cx);
    assert_eq!(snapshot_serials(&view, cx, &[slot]), [1]);
}

#[gpui::test]
fn retired_editor_drains_once_and_later_window_events_cannot_write_it_again(
    cx: &mut TestAppContext,
) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    let path = root.join("retired.txt");
    std::fs::write(&path, "saved").unwrap();
    let (view, cx) = setup(cx);
    let (slot, editor) = open_project_files(&view, cx, &root, &["retired.txt"]).remove(0);
    type_draft(&editor, cx);
    assert_eq!(snapshot_serials(&view, cx, &[slot]), [0]);
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| {
            d.close_slot(slot);
            assert_eq!(d.slot(slot).unwrap().snapshot_request_serial(), 1);
        })
    });
    settle_cloud(&view, cx, "retired editor", &|s, cx| {
        s.files(cx).slot(slot).is_none()
    });
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "saved draft");

    let saved_metadata = std::fs::metadata(&path).unwrap().modified().unwrap();
    editor.update_in(cx, |e, window, cx| e.lab_type(" stale input", window, cx));
    cx.deactivate_window();
    cx.simulate_visibility_change(WindowVisibility::Hidden);
    std::thread::sleep(Duration::from_millis(2100));
    pump(&view, cx);
    assert!(view.read_with(cx, |s, cx| s.files(cx).slot(slot).is_none()));
    assert_eq!(
        std::fs::metadata(&path).unwrap().modified().unwrap(),
        saved_metadata
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "saved draft");
}
