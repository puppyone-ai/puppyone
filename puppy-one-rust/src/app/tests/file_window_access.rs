//! File windows must carry a single-document capability below the UI gate.
use super::*;
use core::prelude::v1::test;
use std::{path::Path, sync::Arc};

fn files() -> (tempfile::TempDir, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    for name in [
        "note.md",
        "secret.txt",
        ".env",
        "other.md",
        "image.png",
        "clip.mp3",
        "clip.mp4",
    ] {
        std::fs::write(root.join(name), name).unwrap();
    }
    std::fs::create_dir(root.join("folder")).unwrap();
    (temp, root)
}

fn workspace(
    view: &Entity<Shell>,
    cx: &mut VisualTestContext,
    root: &Path,
) -> Arc<crate::workspace::Workspace> {
    super::file_window_parity::bind(view, cx, root.join("note.md"));
    settle_cloud(view, cx, "bound file", &|s, cx| {
        s.files(cx).document.is_some()
    });
    view.read_with(cx, |s, cx| s.files(cx).workspace.clone().unwrap())
}

#[gpui::test]
fn bound_file_access_refuses_neighbour_reads_and_general_previews(cx: &mut TestAppContext) {
    let (_temp, root) = files();
    let (view, cx) = setup(cx);
    let ws = workspace(&view, cx, &root);
    let bound = ws.read(Path::new("note.md")).unwrap();
    assert!(ws.resource(Path::new("note.md")).is_ok());
    for name in [
        "secret.txt",
        "other.md",
        "image.png",
        "folder/note.md",
        "../note.md",
        "",
    ] {
        assert!(ws.read(Path::new(name)).is_err(), "read: {name}");
        assert!(
            ws.resource(Path::new(name)).is_err(),
            "general preview: {name}"
        );
    }
    let saved = ws.save(&bound, "bound document remains writable").unwrap();
    assert!(!saved.updated);
    assert_eq!(
        std::fs::read_to_string(root.join("note.md")).unwrap(),
        "bound document remains writable"
    );
    assert_eq!(
        std::fs::read_to_string(root.join("secret.txt")).unwrap(),
        "secret.txt"
    );
}

#[gpui::test]
fn bound_file_access_refuses_folder_operations_and_root_watches(cx: &mut TestAppContext) {
    let (_temp, root) = files();
    let (view, cx) = setup(cx);
    let ws = workspace(&view, cx, &root);
    let empty = Path::new("");
    let bound = Path::new("note.md");
    assert!(ws.list(empty).is_err());
    assert!(ws.create_entry(empty, "created.md", false, "no").is_err());
    assert!(ws.rename_entry(bound, "renamed.md").is_err());
    assert!(ws.move_entry(bound, Path::new("folder")).is_err());
    assert!(ws.copy_entry(bound, Path::new("folder")).is_err());
    assert!(ws.remove_entry(bound).is_err());
    assert!(ws.import_external(&root.join("secret.txt"), empty).is_err());
    assert!(ws.watch_root(Arc::new(|| {})).is_err());
    assert!(view.read_with(cx, |s, cx| s.files(cx).watching()));
}

#[gpui::test]
fn bound_file_markdown_assets_allow_only_media_and_the_bound_document(cx: &mut TestAppContext) {
    let (_temp, root) = files();
    let (view, cx) = setup(cx);
    let _ws = workspace(&view, cx, &root);
    let assets = view.read_with(cx, |s, cx| {
        crate::editor::registry::document_assets(&s.files(cx).document.as_ref().unwrap().id)
            .unwrap()
    });
    for name in ["note.md", "image.png", "clip.mp3", "clip.mp4"] {
        assert_eq!((assets.read)(Path::new(name)).unwrap(), name.as_bytes());
    }
    for name in ["secret.txt", ".env", "other.md", "../secret.txt", ""] {
        assert!((assets.read)(Path::new(name)).is_none(), "asset: {name}");
    }
}

#[gpui::test]
fn bound_file_growth_after_preflight_never_opens_an_oversized_document(cx: &mut TestAppContext) {
    let (_temp, root) = files();
    let file = file_mode::FileTarget::of(root.join("note.md")).unwrap();
    assert_eq!(file.admission, file_mode::Admission::Readable);
    std::fs::write(
        &file.path,
        vec![b'x'; file_mode::MAX_EDITOR_BYTES as usize + 1],
    )
    .unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.bind_file(file, false, w, cx);
    });
    settle_cloud(&view, cx, "oversized read outcome", &|s, cx| {
        s.files(cx).document.is_some() || s.session.docs.read(cx).error.is_some()
    });
    view.read_with(cx, |s, cx| {
        assert!(
            s.files(cx).document.is_none(),
            "preflight must not be the only size boundary"
        );
        assert_eq!(
            s.file.as_ref().unwrap().read(cx).shown(cx),
            file_mode::Shown::Unavailable(None)
        );
    });
}

#[gpui::test]
fn bound_file_read_failure_after_preflight_shows_an_unavailable_document(cx: &mut TestAppContext) {
    let (_temp, root) = files();
    let file = file_mode::FileTarget::of(root.join("note.md")).unwrap();
    std::fs::remove_file(&file.path).unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.bind_file(file, false, w, cx);
    });
    settle_cloud(&view, cx, "failed file read", &|s, cx| {
        s.session.docs.read(cx).error.is_some()
    });
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.files(cx).document.is_none());
        assert_eq!(
            s.file.as_ref().unwrap().read(cx).shown(cx),
            file_mode::Shown::Unavailable(None)
        );
    });
    assert!(cx.debug_bounds("file-mode-unavailable").is_some());
}

fn fail_parent_open(view: &Entity<Shell>, cx: &mut VisualTestContext, root: &Path) {
    let file = file_mode::FileTarget::of(root.join("note.md")).unwrap();
    std::fs::remove_dir_all(root).unwrap();
    view.update_in(cx, |s, w, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.bind_file(file, false, w, cx);
    });
    settle_cloud(view, cx, "parent admission failure", &|s, cx| {
        s.dialogs.read(cx).failed_project().is_some()
    });
}

#[gpui::test]
fn bound_file_parent_admission_failure_remains_unavailable_after_dismissing_the_error(
    cx: &mut TestAppContext,
) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap().join("parent");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("note.md"), "bound").unwrap();
    let (view, cx) = setup(cx);
    fail_parent_open(&view, cx, &root);
    command(&view, cx, Command::CloseProjectFailure);
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.file.as_ref().unwrap().read(cx).shown(cx),
            file_mode::Shown::Unavailable(None)
        )
    });
    assert!(cx.debug_bounds("file-mode-unavailable").is_some());
}

#[gpui::test]
fn bound_file_retry_never_upgrades_to_a_parent_project_grant(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap().join("parent");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("note.md"), "bound").unwrap();
    let (view, cx) = setup(cx);
    fail_parent_open(&view, cx, &root);
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("note.md"), "restored").unwrap();
    std::fs::write(root.join("other.md"), "neighbour").unwrap();
    command(&view, cx, Command::RetryProjectOpen);
    settle_cloud(&view, cx, "recovered bound file", &|s, cx| {
        s.files(cx).document.is_some()
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(s.files(cx).document.as_ref().unwrap().text, "restored");
        let ws = s.files(cx).workspace.as_ref().unwrap();
        assert!(
            ws.list(Path::new("")).is_err(),
            "retry widened the file grant"
        );
        assert!(ws.read(Path::new("other.md")).is_err());
        assert!(s.prefs.store.read(cx).state.recent_projects.is_empty());
    });
}
