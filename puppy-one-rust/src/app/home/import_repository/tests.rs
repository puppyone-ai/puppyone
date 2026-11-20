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

fn cancellable_attempt(
    shell: &Entity<crate::app::Shell>,
    cx: &mut VisualTestContext,
) -> (Arc<AtomicBool>, Arc<repository_import::Publication>, Reply) {
    shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.begin_import(w, cx);
            h.choose_import_source("github", w, cx);
            let (cancel, finish) = pending(h, w, cx);
            let (publication, progress) = repository_import::Publication::new(cancel.clone());
            let publication = Arc::new(publication);
            h.import.as_mut().unwrap().publication = Some(publication.clone());
            h.observe_import_publication(cancel.clone(), progress, cx);
            cx.notify();
            (cancel, publication, finish)
        })
    })
}
fn click_import_cancel(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    let bounds = cx
        .debug_bounds("import-cancel")
        .expect("import cancel button is missing");
    cx.simulate_click(bounds.center(), Modifiers::default());
    cx.run_until_parked();
}

#[gpui::test]
fn active_import_cancel_retires_its_owner_without_waiting_for_clone_completion(
    cx: &mut TestAppContext,
) {
    let (shell, cx) = crate::app::tests::setup(cx);
    let (cancel, _publication, finish) = cancellable_attempt(&shell, cx);
    click_import_cancel(cx);
    assert!(cancel.load(Ordering::Acquire));
    shell.read_with(cx, |s, cx| assert!(s.home.read(cx).import.is_none()));
    finish
        .send(Err("cancelled clone completed late".into()))
        .unwrap();
    cx.run_until_parked();
    shell.read_with(cx, |s, cx| assert!(s.workspace_root(cx).is_none()));
}

#[gpui::test]
fn publication_defers_cancel_escape_and_close_until_its_result(cx: &mut TestAppContext) {
    let (shell, cx) = crate::app::tests::setup(cx);
    let (cancel, publication, finish) = cancellable_attempt(&shell, cx);
    let (entered, in_publication) = std::sync::mpsc::channel();
    let (release, released) = std::sync::mpsc::channel();
    let commit = std::thread::spawn(move || {
        publication.commit::<()>(|| {
            entered.send(()).unwrap();
            released
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap();
            Err("publication refused destination".into())
        })
    });
    in_publication
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    click_import_cancel(cx);
    cx.simulate_keystrokes("escape");
    cx.run_until_parked();
    shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.close_import(w, cx);
            h.begin_import(w, cx);
        })
    });
    shell.read_with(cx, |s, cx| {
        let h = s.home.read(cx);
        assert!(h.owns_import_attempt(&cancel));
        assert!(h.dialog_open(DialogKey::ImportRepository, cx));
    });
    assert!(
        !cancel.load(Ordering::Acquire),
        "publication was reported as cancelled"
    );
    release.send(()).unwrap();
    assert!(commit.join().unwrap().is_err());
    finish
        .send(Err("publication refused destination".into()))
        .unwrap();
    cx.run_until_parked();
    shell.read_with(cx, |s, cx| {
        let h = s.home.read(cx);
        assert!(!h.repository_busy());
        assert_eq!(
            h.import.as_ref().unwrap().error.as_deref(),
            Some("publication refused destination")
        );
    });
    click_import_cancel(cx);
    shell.read_with(cx, |s, cx| assert!(s.home.read(cx).import.is_none()));
}

fn show_url_dialog(
    shell: &Entity<crate::app::Shell>,
    cx: &mut VisualTestContext,
    provider: Provider,
) {
    shell.update_in(cx, |s, w, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.home.update(cx, |h, _| {
            h.intro_empty = Some(true);
            h.intro = None;
        });
        s.command(Command::Home, w, cx);
        s.home.update(cx, |h, cx| {
            h.begin_import(w, cx);
            h.choose_import_source(
                match provider {
                    Provider::GitHub => "github",
                    Provider::GitLab => "gitlab",
                },
                w,
                cx,
            );
        });
    });
    crate::app::tests::settle_cloud(shell, cx, "URL dialog", &|s, cx| {
        s.home_visible(cx) && !s.home.read(cx).list_held()
    });
    draw_url_dialog(cx);
}
fn draw_url_dialog(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
}
fn type_url(shell: &Entity<crate::app::Shell>, cx: &mut VisualTestContext, text: &str) {
    shell.update_in(cx, |s, w, cx| {
        s.home
            .read(cx)
            .import
            .as_ref()
            .unwrap()
            .url
            .read(cx)
            .focus_handle(cx)
            .focus(w, cx);
    });
    cx.simulate_keystrokes("secondary-a");
    cx.simulate_input(text);
    draw_url_dialog(cx);
}
fn click_import(cx: &mut VisualTestContext) {
    let bounds = cx.debug_bounds("import-submit").expect("Import button");
    cx.simulate_click(bounds.center(), Modifiers::default());
    draw_url_dialog(cx);
}
#[gpui::test]
fn unsupported_repository_urls_explain_the_error_on_the_native_input_and_block_submit(
    cx: &mut TestAppContext,
) {
    let (shell, cx) = crate::app::tests::setup(cx);
    for (provider, wrong) in [
        (Provider::GitHub, "https://gitlab.com/a/b"),
        (Provider::GitLab, "https://github.com/a/b"),
    ] {
        show_url_dialog(&shell, cx, provider);
        assert!(cx.debug_bounds("import-url-hint").is_none());
        for value in [
            wrong,
            "https://github.com.evil.test/a/b",
            "https://example.com/github.com/a/b",
            "not a repository",
        ] {
            type_url(&shell, cx, value);
            assert!(cx.debug_bounds("import-url-hint").is_some(), "{value}");
            cx.update(|w, _| {
                let snapshots = gpui_kit::base::test_support::snapshots(w);
                let hint = snapshots
                    .iter()
                    .find(|s| s.path().contains(&ElementId::from("import-url-hint")))
                    .expect("rendered validation alert");
                assert_eq!(hint.role(), Some(gpui::Role::Alert));
                assert!(hint.label().unwrap().contains(provider.label()));
                let submit = snapshots
                    .iter()
                    .find(|s| s.path().contains(&ElementId::from("import-submit")))
                    .expect("native submit button");
                assert_eq!(submit.disabled(), Some(true));
            });
            shell.read_with(cx, |s, cx| {
                let import = s.home.read(cx).import.as_ref().unwrap();
                let input = import.url.read(cx);
                let node = input
                    .accessibility_node
                    .as_ref()
                    .expect("rendered native input node");
                assert_eq!(node.role(), gpui::Role::UrlInput);
                assert_eq!(node.label(), Some(tr("onboarding.entry.clone.urlLabel")));
                assert_eq!(node.invalid(), Some(gpui::accesskit::Invalid::True));
                assert_eq!(node.description(), input.invalid_description.as_deref());
                assert!(node.description().unwrap().contains(provider.label()));
            });
            click_import(cx);
            shell.read_with(cx, |s, cx| {
                let i = s.home.read(cx).import.as_ref().unwrap();
                assert!(
                    i.cloning.is_none() && i.error.is_none(),
                    "disabled button must not dispatch submit"
                );
            });
            assert!(!cx.did_prompt_for_paths());
        }
        shell.update(cx, |s, cx| {
            s.home.update(cx, |h, _| {
                h.import.as_mut().unwrap().error = Some("old failure".into())
            })
        });
        let valid = match provider {
            Provider::GitHub => "https://github.com/a/b.git",
            Provider::GitLab => "git@gitlab.com:group/sub/repo.git",
        };
        type_url(&shell, cx, valid);
        assert!(cx.debug_bounds("import-url-hint").is_none());
        shell.read_with(cx, |s, cx| {
            let i = s.home.read(cx).import.as_ref().unwrap();
            assert!(
                i.error.is_none(),
                "typing retires the previous request error"
            );
            let node = i.url.read(cx).accessibility_node.as_ref().unwrap();
            assert!(node.invalid().is_none() && node.description().is_none());
        });
    }
}
#[gpui::test]
fn repository_fields_are_locked_while_cloning_or_retrying_an_imported_project(
    cx: &mut TestAppContext,
) {
    let (shell, cx) = crate::app::tests::setup(cx);
    show_url_dialog(&shell, cx, Provider::GitHub);
    let value = "https://github.com/a/b.git";
    type_url(&shell, cx, value);
    let (_, finish) = shell.update_in(cx, |s, w, cx| s.home.update(cx, |h, cx| pending(h, w, cx)));
    draw_url_dialog(cx);
    for imported in [false, true] {
        if imported {
            finish_imported_for_test(&shell, cx);
        }
        cx.simulate_input("must not edit");
        draw_url_dialog(cx);
        shell.read_with(cx, |s, cx| {
            let input = s.home.read(cx).import.as_ref().unwrap().url.read(cx);
            assert_eq!(input.text(), value);
            assert!(input.accessibility_node.as_ref().unwrap().is_disabled());
        });
    }
    finish.send(Err("retired".into())).unwrap();
    draw_url_dialog(cx);
}
fn finish_imported_for_test(shell: &Entity<crate::app::Shell>, cx: &mut VisualTestContext) {
    shell.update(cx, |s, cx| {
        s.home.update(cx, |h, cx| {
            let i = h.import.as_mut().unwrap();
            i.cloning = None;
            i.imported = i.location.clone();
            cx.notify();
        })
    });
    draw_url_dialog(cx);
}
#[gpui::test]
fn absent_import_destination_prompts_once_and_cancellation_keeps_the_typed_url(
    cx: &mut TestAppContext,
) {
    let (shell, cx) = crate::app::tests::setup(cx);
    show_url_dialog(&shell, cx, Provider::GitLab);
    shell.update(cx, |s, cx| {
        s.home
            .update(cx, |h, _| h.import.as_mut().unwrap().location = None)
    });
    let value = "git@gitlab.com:group/sub/repo.git";
    type_url(&shell, cx, value);
    click_import(cx);
    assert!(cx.did_prompt_for_paths());
    shell.read_with(cx, |s, cx| {
        let i = s.home.read(cx).import.as_ref().unwrap();
        assert!(i.choosing && i.cloning.is_none());
        assert!(
            i.url
                .read(cx)
                .accessibility_node
                .as_ref()
                .unwrap()
                .is_disabled()
        );
    });
    click_import(cx);
    cx.simulate_path_prompt_response(|options| {
        assert!(options.directories && !options.files && !options.multiple);
        None
    });
    draw_url_dialog(cx);
    shell.read_with(cx, |s, cx| {
        let i = s.home.read(cx).import.as_ref().unwrap();
        assert!(!i.choosing && i.cloning.is_none() && i.error.is_none());
        assert_eq!(i.url.read(cx).text(), value);
        assert!(
            !i.url
                .read(cx)
                .accessibility_node
                .as_ref()
                .unwrap()
                .is_disabled()
        );
    });
    // Choosing a destination resumes the same request. An existing final path
    // fails before Git can run, keeping this real UI test entirely offline.
    let parent = tempfile::tempdir().unwrap();
    std::fs::create_dir(parent.path().join("repo")).unwrap();
    click_import(cx);
    cx.simulate_path_prompt_response(|_| Some(vec![parent.path().to_path_buf()]));
    crate::app::tests::settle_cloud(&shell, cx, "existing import destination", &|s, cx| {
        s.home
            .read(cx)
            .import
            .as_ref()
            .is_some_and(|i| i.error.is_some())
    });
    shell.read_with(cx, |s, cx| {
        let i = s.home.read(cx).import.as_ref().unwrap();
        assert_eq!(i.location.as_deref(), Some(parent.path()));
        assert!(i.error.as_ref().unwrap().contains("already exists"));
    });
}
#[gpui::test]
fn create_and_import_share_an_owned_test_destination_without_opening_a_picker(
    cx: &mut TestAppContext,
) {
    let (shell, cx) = crate::app::tests::setup(cx);
    let created = shell.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.begin_create_project(w, cx);
            h.create
                .as_ref()
                .unwrap()
                .destination
                .location
                .clone()
                .unwrap()
        })
    });
    show_url_dialog(&shell, cx, Provider::GitHub);
    shell.read_with(cx, |s, cx| {
        assert_eq!(
            s.home.read(cx).import.as_ref().unwrap().location.as_ref(),
            Some(&created)
        )
    });
    assert!(created.ends_with("Documents/PuppyOne"));
    std::fs::create_dir(created.join("repo")).unwrap();
    type_url(&shell, cx, "https://github.com/owner/repo.git");
    click_import(cx);
    crate::app::tests::settle_cloud(&shell, cx, "default destination used", &|s, cx| {
        s.home
            .read(cx)
            .import
            .as_ref()
            .is_some_and(|i| i.error.is_some())
    });
    assert!(!cx.did_prompt_for_paths());
    shell.read_with(cx, |s, cx| {
        assert!(
            s.home
                .read(cx)
                .import
                .as_ref()
                .unwrap()
                .error
                .as_ref()
                .unwrap()
                .contains("already exists")
        )
    });
}

fn successful_repository_entry(
    cx: &mut TestAppContext,
    provider: Provider,
    default_location: bool,
) {
    let (shell, cx) = crate::app::tests::setup(cx);
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path().canonicalize().unwrap();
    let source = root.join("source");
    let profile = root.join("profile");
    let chosen = root.join("chosen");
    for dir in [&source, &profile, &chosen] {
        std::fs::create_dir(dir).unwrap();
    }
    let git = |dir: &Path, args: &[&str]| {
        crate::platform::process::run(
            Path::new("/usr/bin/git"),
            args,
            dir,
            None,
            std::time::Duration::from_secs(10),
            &AtomicBool::new(false),
        )
        .unwrap()
    };
    git(&source, &["init", "-q", "-b", "main"]);
    std::fs::write(
        source.join("README.md"),
        "# Imported\n\nLocal transport fixture.\n",
    )
    .unwrap();
    git(&source, &["add", "README.md"]);
    git(
        &source,
        &[
            "-c",
            "user.name=Import Test",
            "-c",
            "user.email=import@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "core.hooksPath=/dev/null",
            "commit",
            "-q",
            "-m",
            "fixture",
        ],
    );
    let original_head = git(&source, &["rev-parse", "HEAD"]);
    shell.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            *p = PreferencesStore::isolated(profile.clone(), cx)
        })
    });
    crate::app::tests::settle_cloud(&shell, cx, "shared isolated preferences", &|s, cx| {
        s.prefs.store.read(cx).loaded
    });
    show_url_dialog(&shell, cx, provider);
    let (url, name, mark, placeholder) = match provider {
        Provider::GitHub => (
            "https://github.com/owner/repository.git",
            "repository",
            "import-provider-github",
            "https://github.com/owner/repository.git",
        ),
        Provider::GitLab => (
            "git@gitlab.com:group/sub/knowledge-base.git",
            "knowledge-base",
            "import-provider-gitlab",
            "https://gitlab.com/owner/repository.git",
        ),
    };
    assert!(cx.debug_bounds(mark).is_some());
    assert!(cx.debug_bounds("dialog-leading").is_none());
    assert!(cx.debug_bounds("import-url-hint").is_none());
    cx.update(|w, _| {
        let snapshots = gpui_kit::base::test_support::snapshots(w);
        let dialog = snapshots
            .iter()
            .find(|s| s.role() == Some(gpui::Role::Dialog))
            .expect("native modal node");
        assert_eq!(
            dialog.label(),
            Some(
                tf(
                    "onboarding.entry.import.repository.title",
                    &[("provider", provider.label().into())]
                )
                .as_str()
            )
        );
        let submit = snapshots
            .iter()
            .find(|s| s.path().contains(&ElementId::from("import-submit")))
            .unwrap();
        assert_eq!(submit.label(), Some(tr("onboarding.entry.clone.submit")));
        assert_eq!(submit.disabled(), Some(true));
    });
    shell.read_with(cx, |s, cx| {
        let input = s.home.read(cx).import.as_ref().unwrap().url.read(cx);
        let node = input.accessibility_node.as_ref().unwrap();
        assert_eq!(node.placeholder(), Some(placeholder));
        assert_eq!(node.role(), gpui::Role::UrlInput);
    });
    let parent = if default_location {
        shell.read_with(cx, |s, cx| {
            s.home
                .read(cx)
                .import
                .as_ref()
                .unwrap()
                .location
                .clone()
                .unwrap()
        })
    } else {
        shell.update(cx, |s, cx| {
            s.home
                .update(cx, |h, _| h.import.as_mut().unwrap().location = None)
        });
        chosen.clone()
    };
    let target = parent.join(name);
    let requests = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    shell.update(cx, |s, cx| {
        s.home.update(cx, |h, _| {
            let (source, target, requests) = (source.clone(), target.clone(), requests.clone());
            h.import.as_mut().unwrap().clone_transport =
                Some(Arc::new(move |staging, requested_url, cancel| {
                    requests.lock().unwrap().push(requested_url.to_owned());
                    assert_eq!(
                        requested_url, url,
                        "only the transport URL is redirected to the local fixture"
                    );
                    assert!(!target.exists(), "publication has not happened");
                    crate::platform::process::run(
                        Path::new("/usr/bin/git"),
                        &["clone", "--quiet", "--", source.to_str().unwrap(), "."],
                        staging,
                        None,
                        std::time::Duration::from_secs(10),
                        cancel,
                    )?;
                    Ok(())
                }));
        })
    });
    type_url(&shell, cx, &format!("  {url}  "));
    click_import(cx);
    if default_location {
        assert!(!cx.did_prompt_for_paths());
    } else {
        assert!(cx.did_prompt_for_paths());
        cx.simulate_path_prompt_response(|options| {
            assert!(options.directories && !options.files && !options.multiple);
            Some(vec![chosen])
        });
    }
    crate::app::tests::settle_cloud(&shell, cx, "published imported project opened", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(target.as_path())
            && s.home.read(cx).import.is_none()
            && s.prefs.store.read(cx).drained()
    });
    assert_eq!(*requests.lock().unwrap(), [url.to_owned()]);
    assert_eq!(git(&target, &["rev-parse", "HEAD"]), original_head);
    assert_eq!(
        std::fs::read(target.join("README.md")).unwrap(),
        std::fs::read(source.join("README.md")).unwrap()
    );
    let stored: crate::features::settings::Preferences =
        serde_json::from_slice(&std::fs::read(profile.join("preferences.json")).unwrap()).unwrap();
    assert_eq!(stored.recent_projects.len(), 1);
    assert_eq!(stored.recent_projects[0].path, target);
    assert_eq!(
        std::fs::read_dir(parent).unwrap().count(),
        1,
        "no staging directories survive"
    );
    shell.read_with(cx, |s, cx| {
        assert!(!s.home.read(cx).dialog_open(DialogKey::ImportRepository, cx))
    });
}
#[gpui::test]
fn github_import_uses_the_default_location_and_opens_the_durably_recorded_clone(
    cx: &mut TestAppContext,
) {
    successful_repository_entry(cx, Provider::GitHub, true);
}
#[gpui::test]
fn gitlab_import_chooses_a_missing_destination_and_opens_the_durably_recorded_clone(
    cx: &mut TestAppContext,
) {
    successful_repository_entry(cx, Provider::GitLab, false);
}
