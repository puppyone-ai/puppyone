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

fn durable_preferences(
    shell: &Entity<crate::app::Shell>,
    cx: &mut VisualTestContext,
    directory: &Path,
) -> Entity<PreferencesStore> {
    let preferences = cx.new(|cx| PreferencesStore::isolated(directory.to_path_buf(), cx));
    shell.update(cx, |s, cx| {
        s.home
            .update(cx, |h, _| h.preferences = preferences.clone());
    });
    crate::app::tests::settle_cloud(shell, cx, "isolated preferences", &|_, cx| {
        preferences.read(cx).loaded
    });
    preferences
}
fn complete_publication(
    shell: &Entity<crate::app::Shell>,
    cx: &mut VisualTestContext,
    project: &Path,
) {
    let (_, finish) = shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.begin_import(w, cx);
            h.choose_import_source("github", w, cx);
            pending(h, w, cx)
        })
    });
    finish.send(Ok((true, project.to_path_buf()))).unwrap();
}
fn await_open_failure(shell: &Entity<crate::app::Shell>, cx: &mut VisualTestContext) {
    crate::app::tests::settle_cloud(shell, cx, "retained imported project", &|s, cx| {
        s.home
            .read(cx)
            .import
            .as_ref()
            .is_some_and(|i| i.imported.is_some() && i.cloning.is_none() && i.error.is_some())
    });
    shell.read_with(cx, |s, cx| {
        assert!(s.workspace_root(cx).is_none());
        assert_eq!(
            s.home.read(cx).import.as_ref().unwrap().error.as_deref(),
            Some(tr("onboarding.entry.import.openFailed"))
        );
    });
}
fn retry_publication(
    shell: &Entity<crate::app::Shell>,
    cx: &mut VisualTestContext,
    project: &Path,
) {
    shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.submit_import(w, cx))
    });
    crate::app::tests::settle_cloud(shell, cx, "retry published project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(project) && s.home.read(cx).import.is_none()
    });
}

#[gpui::test]
fn failed_recent_project_persistence_retains_publication_and_retry_opens_only_after_durable_ack(
    cx: &mut TestAppContext,
) {
    let (shell, cx) = crate::app::tests::setup(cx);
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    let project = root.join("published");
    std::fs::create_dir(&project).unwrap();
    std::fs::write(project.join("note.md"), "original").unwrap();
    let profile = root.join("profile");
    std::fs::create_dir(&profile).unwrap();
    let preferences = durable_preferences(&shell, cx, &profile);
    // A directory at the atomic replacement destination is a real, portable
    // persistence failure, even when the test user could bypass chmod.
    std::fs::create_dir(profile.join("preferences.json")).unwrap();
    complete_publication(&shell, cx, &project);
    await_open_failure(&shell, cx);
    preferences.read_with(cx, |p, _| {
        assert!(p.error.is_some());
        assert!(!p.drained());
        assert_eq!(p.state.recent_projects[0].path, project);
    });
    std::fs::remove_dir(profile.join("preferences.json")).unwrap();
    std::fs::write(project.join("note.md"), "edited after publication").unwrap();
    retry_publication(&shell, cx, &project);
    let stored: crate::features::settings::Preferences =
        serde_json::from_slice(&std::fs::read(profile.join("preferences.json")).unwrap()).unwrap();
    assert_eq!(stored.recent_projects.len(), 1);
    assert_eq!(stored.recent_projects[0].path, project);
    assert_eq!(
        std::fs::read_to_string(project.join("note.md")).unwrap(),
        "edited after publication"
    );
    preferences.read_with(cx, |p, _| assert!(p.drained()));
}

#[gpui::test]
fn actual_open_failure_after_the_probe_keeps_a_durable_recent_and_retries_the_published_directory(
    cx: &mut TestAppContext,
) {
    let (shell, cx) = crate::app::tests::setup(cx);
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    let project = root.join("published");
    let held = root.join("temporarily-unavailable");
    std::fs::create_dir(&project).unwrap();
    std::fs::write(project.join("note.md"), "published").unwrap();
    let profile = root.join("profile");
    std::fs::create_dir(&profile).unwrap();
    durable_preferences(&shell, cx, &profile);
    // The initial probe succeeded, but the folder disappears before the real
    // DocumentSession opening. Only the actual opening result may close UI.
    std::fs::rename(&project, &held).unwrap();
    complete_publication(&shell, cx, &project);
    await_open_failure(&shell, cx);
    let stored: crate::features::settings::Preferences =
        serde_json::from_slice(&std::fs::read(profile.join("preferences.json")).unwrap()).unwrap();
    assert_eq!(stored.recent_projects[0].path, project);
    std::fs::rename(&held, &project).unwrap();
    std::fs::write(project.join("note.md"), "edited while unavailable").unwrap();
    retry_publication(&shell, cx, &project);
    assert_eq!(
        std::fs::read_to_string(project.join("note.md")).unwrap(),
        "edited while unavailable"
    );
}

#[gpui::test]
fn refused_navigation_retains_the_published_project_for_retry(cx: &mut TestAppContext) {
    let (shell, cx) = crate::app::tests::setup(cx);
    let project = tempfile::tempdir().unwrap();
    let path = project.path().canonicalize().unwrap();
    shell.update(cx, |s, cx| {
        s.session.project.update(cx, |p, _| p.picking = true)
    });
    complete_publication(&shell, cx, &path);
    await_open_failure(&shell, cx);
    shell.update(cx, |s, cx| {
        s.session.project.update(cx, |p, _| {
            assert!(p.record.pending_import.is_none());
            p.picking = false;
        })
    });
    retry_publication(&shell, cx, &path);
}

#[gpui::test]
fn late_opening_receipts_cannot_finish_a_replaced_import(cx: &mut TestAppContext) {
    let (shell, cx) = crate::app::tests::setup(cx);
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().to_path_buf();
    for opened in [false, true] {
        let (old, old_finish, current, finish) = shell.update_in(cx, |s, w, cx| {
            let values = s.home.update(cx, |h, cx| {
                h.begin_import(w, cx);
                h.choose_import_source("github", w, cx);
                let (old, old_finish) = pending(h, w, cx);
                h.close_import(w, cx);
                h.begin_import(w, cx);
                h.choose_import_source("gitlab", w, cx);
                let (current, finish) = pending(h, w, cx);
                (old, old_finish, current, finish)
            });
            s.session.project.update(cx, |p, _| {
                p.record.pending_import = Some((path.clone(), values.0.clone()))
            });
            s.finish_import_opening(&path, opened, cx);
            values
        });
        assert!(old.load(Ordering::Relaxed));
        shell.read_with(cx, |s, cx| {
            let h = s.home.read(cx);
            assert!(h.owns_import_attempt(&current));
            let import = h.import.as_ref().unwrap();
            assert_eq!(import.provider, Provider::GitLab);
            assert!(import.error.is_none());
        });
        old_finish.send(Err("retired".into())).unwrap();
        finish.send(Err("current".into())).unwrap();
        cx.run_until_parked();
    }
}

#[gpui::test]
fn a_late_persistence_acknowledgement_cannot_open_or_mutate_a_replaced_import(
    cx: &mut TestAppContext,
) {
    use crate::platform::preference_storage::Event;
    let (shell, cx) = crate::app::tests::setup(cx);
    let mut channels = None;
    let preferences = cx.new(|cx| {
        let (store, writes, events) = PreferencesStore::controlled(cx);
        channels = Some((writes, events));
        store
    });
    let (writes, events) = channels.unwrap();
    events.try_send(Event::Loaded(Ok(None))).unwrap();
    cx.run_until_parked();
    shell.update(cx, |s, cx| {
        s.home
            .update(cx, |h, _| h.preferences = preferences.clone())
    });
    let project = tempfile::tempdir().unwrap();
    complete_publication(&shell, cx, project.path());
    cx.run_until_parked();
    let write = writes
        .try_recv()
        .expect("publication never requested persistence");
    shell.read_with(cx, |s, cx| {
        assert!(s.workspace_root(cx).is_none());
        assert!(s.home.read(cx).repository_busy());
    });
    let (current, finish) = shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.close_import(w, cx);
            h.begin_import(w, cx);
            h.choose_import_source("gitlab", w, cx);
            pending(h, w, cx)
        })
    });
    events
        .try_send(Event::Saved(write.revision, Ok(())))
        .unwrap();
    cx.run_until_parked();
    shell.read_with(cx, |s, cx| {
        assert!(s.workspace_root(cx).is_none());
        assert!(s.session.project.read(cx).record.pending_import.is_none());
        let h = s.home.read(cx);
        assert!(h.owns_import_attempt(&current));
        assert!(h.import.as_ref().unwrap().imported.is_none());
        assert!(h.import.as_ref().unwrap().error.is_none());
    });
    finish.send(Err("current request".into())).unwrap();
    cx.run_until_parked();
}
