use super::*;
use core::prelude::v1::test;
use std::sync::atomic::Ordering;
use tokio::sync::oneshot;

type Reply = oneshot::Sender<Result<(bool, PathBuf), String>>;

fn pending(
    home: &mut Homepage,
    window: &mut Window,
    cx: &mut Context<Homepage>,
) -> (Arc<AtomicBool>, Reply) {
    let cancel = Arc::new(AtomicBool::new(false));
    home.import.as_mut().unwrap().cloning = Some(cancel.clone());
    let (send, receive) = oneshot::channel();
    let task = cx.background_executor().spawn(async move {
        receive
            .await
            .unwrap_or_else(|_| Err("fixture closed".into()))
    });
    home.finish_import(task, window, cx);
    (cancel, send)
}

#[gpui::test]
fn closed_import_completions_cannot_change_a_reopened_dialog(cx: &mut TestAppContext) {
    let (shell, cx) = crate::app::tests::setup(cx);
    let root = tempfile::tempdir().unwrap();
    for result in [
        Err("old request failed".into()),
        Ok((false, root.path().join("old-unavailable"))),
        Ok((true, root.path().to_path_buf())),
    ] {
        let (old, finish, current, current_finish) = shell.update_in(cx, |s, w, cx| {
            s.home.update(cx, |h, cx| {
                h.begin_import(w, cx);
                h.choose_import_source("github", w, cx);
                let (old, finish) = pending(h, w, cx);
                h.close_import(w, cx);
                h.begin_import(w, cx);
                h.choose_import_source("gitlab", w, cx);
                let (current, current_finish) = pending(h, w, cx);
                (old, finish, current, current_finish)
            })
        });
        assert!(old.load(Ordering::Relaxed));
        finish.send(result).unwrap();
        cx.run_until_parked();
        shell.read_with(cx, |s, cx| {
            let h = s.home.read(cx);
            let import = h.import.as_ref().expect("new dialog stays open");
            assert_eq!(import.provider, Provider::GitLab);
            assert!(
                import
                    .cloning
                    .as_ref()
                    .is_some_and(|c| Arc::ptr_eq(c, &current))
            );
            assert!(import.error.is_none());
            assert!(import.imported.is_none());
            assert!(s.workspace_root(cx).is_none());
        });
        current_finish.send(Err("current failure".into())).unwrap();
        cx.run_until_parked();
        shell.read_with(cx, |s, cx| {
            let import = s.home.read(cx).import.as_ref().unwrap();
            assert!(import.cloning.is_none());
            assert_eq!(import.error.as_deref(), Some("current failure"));
        });
    }
}

#[gpui::test]
fn replacing_or_dropping_import_state_cancels_its_owned_worker(cx: &mut TestAppContext) {
    let (shell, cx) = crate::app::tests::setup(cx);
    let (first, finish) = shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.begin_import(w, cx);
            h.choose_import_source("github", w, cx);
            pending(h, w, cx)
        })
    });
    shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.begin_import(w, cx));
    });
    assert!(
        first.load(Ordering::Relaxed),
        "replacing the owner cancels its worker"
    );
    finish.send(Err("retired".into())).unwrap();
    cx.run_until_parked();
    let (second, finish) = shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.choose_import_source("gitlab", w, cx);
            pending(h, w, cx)
        })
    });
    shell.update(cx, |s, cx| {
        s.home.update(cx, |h, _| drop(h.import.take()));
    });
    assert!(
        second.load(Ordering::Relaxed),
        "dropping the owner cancels its worker"
    );
    finish.send(Err("retired".into())).unwrap();
    cx.run_until_parked();
}

#[gpui::test]
fn folder_picker_replies_belong_to_the_idle_import_that_requested_them(cx: &mut TestAppContext) {
    let (shell, cx) = crate::app::tests::setup(cx);
    let root = tempfile::tempdir().unwrap();
    for replaced in [true, false] {
        let (expected, pending_reply) = shell.update_in(cx, |s, w, cx| {
            s.home.update(cx, |h, cx| {
                h.begin_import(w, cx);
                h.choose_import_source("github", w, cx);
                h.choose_import_location(w, cx);
                if replaced {
                    h.close_import(w, cx);
                    h.begin_import(w, cx);
                    h.choose_import_source("gitlab", w, cx);
                }
                let expected = h.import.as_ref().unwrap().location.clone();
                let reply = (!replaced).then(|| pending(h, w, cx).1);
                (expected, reply)
            })
        });
        assert!(cx.did_prompt_for_paths());
        cx.simulate_path_prompt_response(|options| {
            assert!(options.directories && !options.files && !options.multiple);
            Some(vec![root.path().to_path_buf()])
        });
        cx.run_until_parked();
        shell.read_with(cx, |s, cx| {
            assert_eq!(s.home.read(cx).import.as_ref().unwrap().location, expected);
        });
        if let Some(reply) = pending_reply {
            reply.send(Err("finished".into())).unwrap();
            cx.run_until_parked();
        }
    }
    shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.choose_import_location(w, cx));
    });
    cx.simulate_path_prompt_response(|_| Some(vec![root.path().to_path_buf()]));
    cx.run_until_parked();
    shell.read_with(cx, |s, cx| {
        assert_eq!(
            s.home.read(cx).import.as_ref().unwrap().location.as_deref(),
            Some(root.path())
        );
    });
}

#[gpui::test]
fn retry_opens_the_published_project_and_preserves_edits_without_recloning(
    cx: &mut TestAppContext,
) {
    let (shell, cx) = crate::app::tests::setup(cx);
    let root = tempfile::tempdir().unwrap();
    let project = root.path().canonicalize().unwrap().join("repository");
    std::fs::create_dir(&project).unwrap();
    std::fs::write(project.join("note.md"), "published").unwrap();
    let (_, finish) = shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.begin_import(w, cx);
            h.choose_import_source("github", w, cx);
            pending(h, w, cx)
        })
    });
    // A completed publication whose first availability probe failed. The
    // actual completion handler must retain the exact directory for retry.
    finish.send(Ok((false, project.clone()))).unwrap();
    cx.run_until_parked();
    shell.read_with(cx, |s, cx| {
        let import = s.home.read(cx).import.as_ref().unwrap();
        assert_eq!(import.imported.as_ref(), Some(&project));
        assert!(import.cloning.is_none());
        assert_eq!(
            import.error.as_deref(),
            Some(tr("onboarding.entry.import.openFailed"))
        );
        assert!(
            import.url.read(cx).text().is_empty(),
            "a retry must not require URL revalidation"
        );
        assert!(s.workspace_root(cx).is_none());
    });
    std::fs::write(project.join("note.md"), "edited after publication").unwrap();
    shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.submit_import(w, cx));
    });
    crate::app::tests::settle_cloud(&shell, cx, "published import retry", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(project.as_path())
    });
    shell.read_with(cx, |s, cx| assert!(s.home.read(cx).import.is_none()));
    assert_eq!(
        std::fs::read_to_string(project.join("note.md")).unwrap(),
        "edited after publication"
    );
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
}
