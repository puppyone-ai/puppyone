//! The Homepage and the project actions: the list, first run, entry dialogs, templates, drags, the intro.
use super::*;
use core::prelude::v1::test;

/// ADR-001: the Homepage lists a linked folder and its Cloud project as two
/// entries (the folder carries the link); each opens in this window.
#[gpui::test]
fn the_homepage_lists_a_linked_folder_and_its_cloud_project_as_two_entries(
    cx: &mut TestAppContext,
) {
    use crate::workspace::cloud::catalog::Location;
    let temp = tempfile::tempdir().unwrap();
    let linked = temp.path().canonicalize().unwrap().join("linked");
    let plain = temp.path().canonicalize().unwrap().join("plain");
    for dir in [&linked, &plain] {
        std::fs::create_dir(dir).unwrap();
        std::fs::write(dir.join("a.md"), "# A\n").unwrap();
    }
    let git = |args: &[&str]| {
        assert!(
            std::process::Command::new("git")
                .args(args)
                .current_dir(&linked)
                .status()
                .unwrap()
                .success()
        )
    };
    git(&["init", "-q"]);
    git(&[
        "remote",
        "add",
        "origin",
        "http://127.0.0.1:18080/git/project-a.git",
    ]);
    let project = cloud_project_responder();
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new(move |request| {
        if request.path.ends_with("/projects/") {
            return Ok(serde_json::json!({"code": 0, "data": [
                {"id": "project-a", "name": "Fixture Cloud", "updated_at": "2026-01-01T00:00:00Z",
                 "capabilities": ["project.settings.manage"]},
                {"id": "project-b", "name": "Hosted only"}
            ]}));
        }
        if request.path.ends_with("/commits") {
            return Ok(serde_json::json!({"code": 0, "data": {"commits": []}}));
        }
        project(request)
    });
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            p.state.remember_project(&plain, 2);
            p.state.remember_project(&linked, 1);
        });
        s.refresh_cloud_catalog(true, cx);
        // The Header project menu hydrates the same list as the Homepage.
        s.set_popover(Some(Popover::Project), cx);
    });
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
    let locations = |s: &Shell, cx: &App| {
        s.home
            .read(cx)
            .project_items(cx)
            .iter()
            .map(|i| (i.label.clone(), i.location()))
            .collect::<Vec<_>>()
    };
    settle_cloud(&view, cx, "the catalog", &|s, cx| {
        let found = locations(s, cx);
        found.len() == 4 && found.iter().any(|(_, l)| *l == Location::Linked)
    });
    let items = view.read_with(cx, |s, cx| {
        let found = locations(s, cx);
        assert!(found.contains(&("linked".into(), Location::Linked)));
        assert!(found.contains(&("plain".into(), Location::Local)));
        assert!(found.contains(&("Fixture Cloud".into(), Location::CloudOnly)));
        assert!(found.contains(&("Hosted only".into(), Location::CloudOnly)));
        s.home.read(cx).project_items(cx)
    });
    let folder = items.iter().find(|i| i.label == "linked").unwrap();
    assert_eq!(
        folder.linked,
        Some(crate::workspace::cloud::catalog::Linked {
            id: "project-a".into(),
            name: "Fixture Cloud".into()
        })
    );
    assert_eq!(folder.cloud_project, None);
    let cloud = items.iter().find(|i| i.label == "Fixture Cloud").unwrap();
    assert_eq!(cloud.local_path, None);
    assert!(cloud.actions.is_some_and(|a| a.rename && !a.delete));
    // The Cloud entry opens in this window.
    let windows = cx.update(|_, cx| cx.windows().len());
    view.update(cx, |s, cx| s.set_popover(None, cx));
    view.update_in(cx, |s, w, cx| s.open_item(cloud, w, cx));
    settle_cloud(&view, cx, "the Cloud opening", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
    });
    // And the folder from the Homepage replaces it.
    view.update_in(cx, |s, w, cx| {
        s.command(Command::Home, w, cx);
        s.open_item(folder, w, cx)
    });
    settle_cloud(&view, cx, "the folder", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(linked.as_path()) && s.hosted_project(cx).is_none()
    });
    assert_eq!(cx.update(|_, cx| cx.windows().len()), windows);
}
#[gpui::test]
fn the_rail_offers_rename_and_unlink_for_a_remembered_project(cx: &mut TestAppContext) {
    use super::project_actions::Target;
    let (view, cx) = setup(cx);
    let path = PathBuf::from("/p/notes");
    let target = Target::Local {
        path: path.clone(),
        name: "notes".into(),
    };
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.remember_project(&path, 1));
        let target = target.clone();
        let actions = s.chrome.read(cx).project_actions.clone();
        actions.update(cx, |a, cx| {
            a.open(
                target,
                Bounds::new(point(px(20.), px(80.)), size(px(0.), px(0.))),
                false,
                size(px(1180.), px(760.)),
                None,
                cx,
            )
        });
    });
    draw(cx);
    view.update_in(cx, |s, w, cx| {
        assert!(s.chrome.read(cx).project_actions.read(cx).menu.is_some());
        s.chrome
            .read(cx)
            .project_actions
            .clone()
            .update(cx, |a, cx| a.begin_project_rename(target.clone(), w, cx));
        assert!(s.chrome.read(cx).project_actions.read(cx).menu.is_none());
        let Some(input) = s
            .chrome
            .read(cx)
            .project_actions
            .read(cx)
            .rename
            .as_ref()
            .map(|r| r.input.clone())
        else {
            panic!("no rename dialog")
        };
        input.update(cx, |i, cx| i.set_text(String::from("Field notes"), cx));
        s.chrome
            .read(cx)
            .project_actions
            .clone()
            .update(cx, |a, cx| a.submit_project_rename(w, cx));
    });
    view.read_with(cx, |s, cx| {
        assert!(s.dialogs.read(cx).is_empty());
        assert_eq!(
            s.prefs.store.read(cx).state.recent_projects[0].name,
            "Field notes"
        );
    });
    // Unlink forgets the Project (its files stay where they are).
    view.update_in(cx, |s, w, cx| {
        s.chrome
            .read(cx)
            .project_actions
            .clone()
            .update(cx, |a, cx| a.ask_confirm(target, w, cx));
    });
    draw(cx);
    view.update_in(cx, |s, w, cx| {
        s.chrome
            .read(cx)
            .project_actions
            .clone()
            .update(cx, |a, cx| a.confirm_project_change(w, cx))
    });
    view.read_with(cx, |s, cx| {
        assert!(s.dialogs.read(cx).is_empty());
        assert!(s.prefs.store.read(cx).state.recent_projects.is_empty())
    });
}
/// `renameCloudProject` and `deleteCloudProject`: the Project changes for
/// everyone, so the account's catalog follows the server's answer.
#[gpui::test]
fn a_cloud_entry_renames_and_deletes_its_project(cx: &mut TestAppContext) {
    use super::project_actions::Target;
    let requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    // The server's one Project: its name, or gone.
    let server = std::sync::Arc::new(std::sync::Mutex::new(Some(String::from("Fixture Cloud"))));
    let seen = requests.clone();
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new(move |request| {
        seen.lock()
            .unwrap()
            .push(format!("{} {}", request.method, request.path));
        let mut project = server.lock().unwrap();
        Ok(match (request.method.as_str(), request.path.as_str()) {
            ("PUT", "/projects/project-a") => {
                assert_eq!(request.body, Some(serde_json::json!({"name": "Renamed"})));
                *project = Some("Renamed".into());
                serde_json::json!({"code": 0, "data": {"id": "project-a", "name": "Renamed"}})
            }
            ("DELETE", "/projects/project-a") => {
                *project = None;
                serde_json::json!({"code": 0, "data": null})
            }
            (_, path) if path.ends_with("/projects/") => {
                let data: Vec<_> = project
                    .iter()
                    .map(|name| {
                        serde_json::json!({"id": "project-a", "name": name,
                            "capabilities": ["project.settings.manage", "project.delete"]})
                    })
                    .collect();
                serde_json::json!({"code": 0, "data": data})
            }
            _ => serde_json::json!({}),
        })
    });
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true);
        s.refresh_cloud_catalog(true, cx);
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "the catalog", &|s, cx| {
        s.home
            .read(cx)
            .project_items(cx)
            .iter()
            .any(|i| i.label == "Fixture Cloud")
    });
    let item = view.read_with(cx, |s, cx| {
        s.home
            .read(cx)
            .project_items(cx)
            .into_iter()
            .find(|i| i.label == "Fixture Cloud")
            .unwrap()
    });
    let target = Target::of(&item).unwrap();
    assert_eq!(
        target,
        Target::Cloud {
            project: "project-a".into(),
            name: "Fixture Cloud".into(),
            rename: true,
            delete: true
        }
    );
    view.update_in(cx, |s, w, cx| {
        s.chrome
            .read(cx)
            .project_actions
            .clone()
            .update(cx, |a, cx| a.begin_project_rename(target.clone(), w, cx));
        let Some(input) = s
            .chrome
            .read(cx)
            .project_actions
            .read(cx)
            .rename
            .as_ref()
            .map(|r| r.input.clone())
        else {
            panic!("no rename dialog")
        };
        input.update(cx, |i, cx| i.set_text(String::from("Renamed"), cx));
        s.chrome
            .read(cx)
            .project_actions
            .clone()
            .update(cx, |a, cx| a.submit_project_rename(w, cx));
    });
    settle_cloud(&view, cx, "the rename", &|s, cx| {
        s.dialogs.read(cx).is_empty()
            && s.home
                .read(cx)
                .project_items(cx)
                .iter()
                .any(|i| i.label == "Renamed")
    });
    view.update_in(cx, |s, w, cx| {
        s.chrome
            .read(cx)
            .project_actions
            .clone()
            .update(cx, |a, cx| a.ask_confirm(target, w, cx));
    });
    view.update_in(cx, |s, w, cx| {
        s.chrome
            .read(cx)
            .project_actions
            .clone()
            .update(cx, |a, cx| a.confirm_project_change(w, cx))
    });
    settle_cloud(&view, cx, "the deletion", &|s, cx| {
        s.dialogs.read(cx).is_empty() && s.home.read(cx).project_items(cx).is_empty()
    });
    let requests = requests.lock().unwrap();
    assert!(requests.iter().any(|r| r == "PUT /projects/project-a"));
    assert!(requests.iter().any(|r| r == "DELETE /projects/project-a"));
}
#[gpui::test]
fn first_run_offers_sign_in_once_on_an_empty_launch(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // A signed-out account (a restored session would complete the first
    // run as soon as it is seen).
    let (broker, browser) = crate::cloud::auth::account_fixture();
    broker.sign_out();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
    while broker.subscribe().borrow().status != crate::cloud::auth::Status::SignedOut {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    let account =
        cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "the signed-out account", &|_, cx| {
        crate::features::cloud::account::status(cx) == Some(crate::cloud::auth::Status::SignedOut)
    });
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.loaded = true;
            p.change(|p| p.experimental.cloud_workspace = true, cx);
        })
    });
    draw(cx);
    view.read_with(cx, |s, cx| assert!(s.home.read(cx).first_run_sign_in(cx)));
    // Continue locally completes it for good.
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, cx| {
            h.complete_first_run(cx);
            h.sync_first_run(cx)
        });
    });
    view.read_with(cx, |s, cx| {
        assert!(!s.home.read(cx).first_run_sign_in(cx));
        assert!(s.prefs.store.read(cx).state.first_run_sign_in_completed);
    });
    let _ = account;
}
/// Preferences loaded with Cloud on, as a launch has them.
fn launch_with_cloud(view: &Entity<Shell>, cx: &mut VisualTestContext) {
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.loaded = true;
            p.change(|p| p.experimental.cloud_workspace = true, cx);
        })
    });
    draw(cx);
}
fn first_run(view: &Entity<Shell>, cx: &mut VisualTestContext) -> bool {
    view.read_with(cx, |s, cx| s.home.read(cx).first_run_sign_in(cx))
}

/// `useFirstRunSignIn`: a build without an account never gates the launch.
/// A sign-in that succeeded once is remembered across a later signed-out
/// launch, and so is having had a project after the history is cleared.
#[gpui::test]
fn first_run_remembers_a_sign_in_or_a_project_for_good(cx: &mut TestAppContext) {
    use crate::features::cloud::account;
    let (view, cx) = setup(cx);
    launch_with_cloud(&view, cx);
    assert!(!first_run(&view, cx));
    let (broker, browser, control) = crate::cloud::auth::sign_in_fixture();
    cx.update(|_, cx| account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "the signed-out account", &|_, cx| {
        account::status(cx) == Some(crate::cloud::auth::Status::SignedOut)
    });
    assert!(first_run(&view, cx));
    control.complete("alice");
    settle_cloud(&view, cx, "signing in", &|s, cx| {
        account::has_account(cx) && s.prefs.store.read(cx).state.first_run_sign_in_completed
    });
    cx.update(|_, cx| account::sign_out(cx));
    settle_cloud(&view, cx, "signing out", &|_, cx| !account::has_account(cx));
    assert!(!first_run(&view, cx));
    // A fresh first run on this launch, but a project already opened.
    let folder = std::path::PathBuf::from("/tmp/puppyone-first-run-project");
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.change(
                |p| {
                    p.first_run_sign_in_completed = false;
                    p.remember_project(&folder, 1);
                },
                cx,
            )
        })
    });
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.prefs.store.read(cx).state.first_run_sign_in_completed)
    });
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, cx| p.change(|p| p.forget_project(&folder), cx))
    });
    draw(cx);
    assert!(!first_run(&view, cx));
}

/// `FirstRunSignInScreen`: while the browser hands off it says it waits,
/// and Sign in stays pressable to start it again (a closed browser page
/// never strands anyone). An error is shown and the gate stays, and
/// Continue locally completes the first run.
#[gpui::test]
fn first_run_waits_on_the_browser_and_continues_locally_after_an_error(cx: &mut TestAppContext) {
    use crate::features::cloud::account;
    let (view, cx) = setup(cx);
    let (broker, browser, control) = crate::cloud::auth::sign_in_fixture();
    cx.update(|_, cx| account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "the signed-out account", &|_, cx| {
        account::status(cx) == Some(crate::cloud::auth::Status::SignedOut)
    });
    launch_with_cloud(&view, cx);
    assert!(first_run(&view, cx));
    // The Homepage, not the visual fixture's project.
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false)
    });
    command(&view, cx, Command::Home);
    assert!(cx.debug_bounds("first-run-waiting").is_none());
    let sign_in = cx.debug_bounds("first-run-sign-in").unwrap();
    cx.simulate_click(sign_in.center(), Modifiers::none());
    settle_cloud(&view, cx, "the handoff", &|_, cx| {
        account::status(cx) == Some(crate::cloud::auth::Status::SigningIn)
    });
    assert!(cx.debug_bounds("first-run-waiting").is_some());
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while control.starts() < 1 {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    // Asked again while waiting: it starts again.
    let sign_in = cx.debug_bounds("first-run-sign-in").unwrap();
    cx.simulate_click(sign_in.center(), Modifiers::none());
    while control.starts() < 2 {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    control.fail(crate::cloud::auth::Error::Unavailable);
    settle_cloud(&view, cx, "the error", &|_, cx| {
        account::snapshot(cx)
            .is_some_and(|s| s.status == crate::cloud::auth::Status::SignedOut && s.error.is_some())
    });
    assert!(cx.debug_bounds("first-run-error").is_some());
    assert!(cx.debug_bounds("first-run-waiting").is_none());
    assert!(first_run(&view, cx));
    let local = cx.debug_bounds("first-run-continue").unwrap();
    cx.simulate_click(local.center(), Modifiers::none());
    draw(cx);
    assert!(!first_run(&view, cx));
    view.read_with(cx, |s, cx| {
        assert!(s.prefs.store.read(cx).state.first_run_sign_in_completed)
    });
}
/// v0.4.4 `OnboardingImportDialog`: Import lists its sources first; a
/// repository source takes only its own provider's URLs, and Back returns
/// to the list.
#[gpui::test]
fn import_starts_from_its_sources_and_a_repository_takes_only_its_provider(
    cx: &mut TestAppContext,
) {
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.begin_import(w, cx))
    });
    view.read_with(cx, |s, cx| {
        let home = s.home.read(cx);
        assert!(home.import.is_none(), "the list comes first");
        let ids: Vec<_> = home.import_sources(cx).iter().map(|s| s.id).collect();
        assert_eq!(
            ids,
            ["github", "gitlab"],
            "other apps wait for the experiment"
        );
    });
    view.update_in(cx, |s, w, cx| {
        s.home
            .update(cx, |h, cx| h.choose_import_source("github", w, cx))
    });
    // An unsupported URL, or another provider's, is refused before anything runs.
    for url in [
        "https://example.com/a/b",
        "https://gitlab.com/group/project",
    ] {
        view.update_in(cx, |s, w, cx| {
            let Some(input) = s.home.read(cx).import.as_ref().map(|i| i.url.clone()) else {
                panic!("no repository step")
            };
            input.update(cx, |i, cx| i.set_text(String::from(url), cx));
            s.home.update(cx, |h, cx| h.submit_import(w, cx));
        });
        draw(cx);
        view.read_with(cx, |s, cx| {
            assert!(s.has_dialog("ImportRepository", cx));
            assert!(
                !s.home.read(cx).repository_busy(),
                "invalid URLs must not start a clone"
            );
            assert!(s.workspace_root(cx).is_none());
        });
    }
    // Imported, but its folder can't be opened: the dialog stays to open
    // it again, and opening it again once it is there opens it.
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().canonicalize().unwrap().join("repository");
    let open_again = |view: &Entity<Shell>, cx: &mut VisualTestContext| {
        view.update_in(cx, |s, w, cx| {
            s.home.update(cx, |h, cx| h.submit_import(w, cx))
        });
        draw(cx);
    };
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, _| {
            h.import.as_mut().unwrap().imported = Some(project.clone())
        })
    });
    open_again(&view, cx);
    view.read_with(cx, |s, cx| {
        assert!(s.has_dialog("ImportRepository", cx));
        assert!(s.workspace_root(cx).is_none());
    });
    std::fs::create_dir(&project).unwrap();
    open_again(&view, cx);
    settle_cloud(&view, cx, "the imported project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(project.as_path())
    });
    view.read_with(cx, |s, cx| assert!(!s.has_dialog("ImportRepository", cx)));
}

/// v0.4.4 app folders: with the experiment on, the folders another app
/// records are listed, and the chosen ones join the Homepage where they are.
#[gpui::test]
fn folders_another_app_records_join_the_homepage_in_place(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let vault = root.join("Vault");
    std::fs::create_dir(&vault).unwrap();
    std::fs::create_dir_all(root.join("data/obsidian")).unwrap();
    std::fs::write(
        root.join("data/obsidian/obsidian.json"),
        serde_json::json!({ "vaults": { "a": { "path": vault, "ts": 1 } } }).to_string(),
    )
    .unwrap();
    let places = crate::platform::app_folders::Places {
        home: root.join("home"),
        app_data: root.join("data"),
    };
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.other_app_imports = true);
        s.home.update(cx, |h, cx| {
            h.app_places = Some(places);
            h.begin_import(w, cx)
        })
    });
    use super::home::import_sources::Folders;
    let found = |s: &Shell, cx: &App, app: &str| {
        s.home
            .read(cx)
            .import_picker
            .as_ref()
            .and_then(|p| p.folders.get(app).cloned())
    };
    settle_cloud(
        &view,
        cx,
        "the vaults",
        &|s, cx| matches!(found(s, cx, "obsidian"), Some(Folders::Found(f)) if f.len() == 1),
    );
    // An app that is not installed has nothing to offer.
    view.read_with(cx, |s, cx| {
        assert_eq!(found(s, cx, "vscode"), Some(Folders::Found(vec![])));
    });
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.choose_import_source("obsidian", w, cx);
            h.toggle_app_folder(vault.clone(), cx);
            h.add_app_folders(w, cx)
        })
    });
    settle_cloud(&view, cx, "the vault on the Homepage", &|s, cx| {
        s.prefs
            .store
            .read(cx)
            .state
            .recent_projects
            .first()
            .is_some_and(|p| p.path == vault)
    });
    view.read_with(cx, |s, cx| {
        assert!(!s.has_dialog("ImportRepository", cx));
        // Listed, not opened.
        assert!(s.workspace_root(cx).is_none());
    });
}
#[gpui::test]
fn create_new_opens_the_project_entry_launcher_and_hands_off(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    command(&view, cx, Command::CreateNew);
    view.read_with(cx, |s, cx| {
        assert!(s.top_dialog(cx).as_deref() == Some("ProjectEntry"))
    });
    // Escape closes the launcher without choosing.
    command(&view, cx, Command::Escape);
    view.read_with(cx, |s, cx| assert!(s.dialogs.read(cx).is_empty()));
    command(&view, cx, Command::CreateNew);
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.choose_project_entry(super::home::project_entry::Route::Create, w, cx)
        })
    });
    view.read_with(cx, |s, cx| {
        assert!(!s.has_dialog("ProjectEntry", cx));
        assert!(s.top_dialog(cx).as_deref() == Some("CreateProject"));
    });
    command(&view, cx, Command::Escape);
    command(&view, cx, Command::CreateNew);
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.choose_project_entry(super::home::project_entry::Route::Import, w, cx)
        })
    });
    view.read_with(cx, |s, cx| {
        assert!(s.top_dialog(cx).as_deref() == Some("ImportRepository"))
    });
}
/// H-20: a new project starts with Getting started, which opens first.
#[gpui::test]
fn a_new_project_opens_on_its_getting_started_guide(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let parent = temp.path().canonicalize().unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.home.update(cx, |h, cx| {
            h.begin_create_project(w, cx);
            let create = h.create.as_mut().unwrap();
            create.destination.location = Some(parent.clone());
            create
                .destination
                .name
                .update(cx, |input, cx| input.set_text("Notes".to_owned(), cx));
        });
    });
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.submit_create_project(w, cx))
    });
    settle_cloud(&view, cx, "the new project", &|s, cx| {
        s.files(cx)
            .opened()
            .is_some_and(|(_, relative)| relative == std::path::Path::new("Getting Started.md"))
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(s.workspace_root(cx), Some(parent.join("Notes")));
        assert!(s.dialogs.read(cx).is_empty());
    });
}
/// H-20, W-7: a template link opens its card; "Get a copy" writes the
/// verified files under a name no folder has, and the copy opens on its
/// first document — in a window of its own when a project is open here.
/// v0.4.4 `claimCopiedTemplateOnce`: someone who installed from the store
/// page with its link copied is offered the template on a first launch,
/// once per profile; any other copied text is left alone.
#[gpui::test]
fn a_link_copied_from_the_store_is_offered_once_on_a_first_launch(cx: &mut TestAppContext) {
    crate::platform::templates::store::install_test_store(&[("Plan.md", "# Week\n")]);
    let (view, cx) = setup(cx);
    let link = format!(
        "https://www.puppyone.ai/t/{}",
        crate::platform::templates::package::fixtures::ID
    );
    cx.update(|_, cx| cx.write_to_clipboard(ClipboardItem::new_string(link.clone())));
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false)
    });
    command(&view, cx, Command::Home);
    settle_cloud(&view, cx, "the copied link", &|s, cx| {
        s.home.read(cx).template.as_ref().is_some_and(|i| i.copied)
    });
    view.read_with(cx, |s, cx| {
        assert!(s.prefs.store.read(cx).state.copied_template_checked);
        assert!(
            s.home
                .read(cx)
                .template
                .as_ref()
                .unwrap()
                .url
                .ends_with(crate::platform::templates::package::fixtures::ID)
        );
    });
    // Put away, it is not offered again from the same clipboard.
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.close_template(w, cx))
    });
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.offer_copied_template(w, cx))
    });
    view.read_with(cx, |s, cx| assert!(s.home.read(cx).template.is_none()));
}

#[gpui::test]
fn a_template_link_gets_a_copy(cx: &mut TestAppContext) {
    crate::platform::templates::store::install_test_store(&[("Plan.md", "# Week\n")]);
    let temp = tempfile::tempdir().unwrap();
    let parent = temp.path().canonicalize().unwrap();
    std::fs::create_dir(parent.join("Weekly plan")).unwrap();
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false)
    });
    command(&view, cx, Command::Home);
    cx.update(|_, cx| {
        cx.write_to_clipboard(ClipboardItem::new_string(format!(
            "https://www.puppyone.ai/t/{}",
            crate::platform::templates::package::fixtures::ID
        )))
    });
    // ⌘V on the Homepage takes the link.
    command(&view, cx, Command::PasteTemplateLink);
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, _| {
            let Some(import) = h.template.as_deref_mut() else {
                panic!("the template card");
            };
            import.destination.location = Some(parent.clone());
        })
    });
    settle_cloud(&view, cx, "the template", &|s, cx| {
        s.home
            .read(cx)
            .template
            .as_ref()
            .is_some_and(|i| i.detail.is_some())
    });
    view.read_with(cx, |s, cx| {
        let Some(import) = s.home.read(cx).template.as_deref() else {
            unreachable!()
        };
        // A display name becomes a folder name.
        assert_eq!(import.destination.name.read(cx).text(), "Weekly plan");
    });
    // A second "Get a copy" while the first is on its way creates nothing.
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.submit_template(w, cx);
            h.submit_template(w, cx);
        })
    });
    settle_cloud(&view, cx, "the copy", &|s, cx| {
        s.files(cx)
            .opened()
            .is_some_and(|(_, relative)| relative == std::path::Path::new("Plan.md"))
    });
    view.read_with(cx, |s, cx| {
        // "Weekly plan" was taken, so the copy is numbered.
        assert_eq!(s.workspace_root(cx), Some(parent.join("Weekly plan 2")));
        assert!(s.dialogs.read(cx).is_empty());
    });
    assert_eq!(
        std::fs::read_to_string(parent.join("Weekly plan 2/Plan.md")).unwrap(),
        "# Week\n"
    );
    assert!(!parent.join("Weekly plan 3").exists());
    // With a project open here, the next copy opens in a window of its own.
    let link = format!(
        "https://www.puppyone.ai/t/{}",
        crate::platform::templates::package::fixtures::ID
    );
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.open_template_link(link, w, cx))
    });
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, _| {
            let Some(import) = h.template.as_deref_mut() else {
                panic!("the template card");
            };
            assert!(import.new_window);
            import.destination.location = Some(parent.clone());
        })
    });
    settle_cloud(&view, cx, "the template again", &|s, cx| {
        s.home
            .read(cx)
            .template
            .as_ref()
            .is_some_and(|i| i.detail.is_some())
    });
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.submit_template(w, cx))
    });
    settle_cloud(&view, cx, "the second window", &|_, cx| {
        windows::count(cx) == 2
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(s.workspace_root(cx), Some(parent.join("Weekly plan 2")));
    });
    assert!(parent.join("Weekly plan 3/Plan.md").is_file());
}
/// H-16: a local project dragged off the Homepage carries its absolute
/// path, which also goes to the clipboard; the row dims while it moves.
#[gpui::test]
fn a_homepage_project_drags_out_as_its_path(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Field Notes");
    std::fs::create_dir(&folder).unwrap();
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs
            .store
            .update(cx, |p, _| p.state.remember_project(&folder, 1));
    });
    command(&view, cx, Command::Home);
    settle_cloud(&view, cx, "the Homepage list", &|s, cx| {
        !s.home.read(cx).list_held()
    });
    draw(cx);
    let id = view.read_with(cx, |s, cx| {
        s.home.read(cx).visible_projects(cx)[0].id.clone()
    });
    let selector: &'static str = Box::leak(format!("home-project:{id}").into_boxed_str());
    let row = cx.debug_bounds(selector).unwrap();
    let from = row.center();
    cx.simulate_mouse_down(from, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_move(
        point(from.x + px(40.), from.y + px(30.)),
        Some(MouseButton::Left),
        Modifiers::default(),
    );
    draw(cx);
    let path = folder.to_string_lossy().into_owned();
    assert_eq!(
        cx.read_from_clipboard().and_then(|c| c.text()),
        Some(path.clone())
    );
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.home.read(cx).dragging_path.as_deref(),
            Some(path.as_str())
        )
    });
    cx.simulate_mouse_up(
        point(from.x + px(40.), from.y + px(30.)),
        MouseButton::Left,
        Modifiers::default(),
    );
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.home.read(cx).dragging_path.is_none());
        // Dragging is not opening.
        assert!(s.home_visible(cx));
    });
}
#[gpui::test]
fn an_empty_homepage_plays_its_intro_then_shows_the_analytics_disclosure(cx: &mut TestAppContext) {
    use crate::{features::telemetry, platform::telemetry::Level};
    cx.update(|cx| {
        telemetry::install_fixture(Some(telemetry::fixture(Level::Basic, true, true)), cx)
    });
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false)
    });
    command(&view, cx, Command::Home);
    // Home holds the list until its dates are read.
    cx.run_until_parked();
    draw(cx);
    view.update(cx, |s, cx| {
        let home = s.home.read(cx);
        assert!(!home.list_held());
        assert!(s.home_visible(cx) && home.project_items(cx).is_empty());
        assert!(home.intro.is_some());
        // The disclosure waits for the intro.
        assert!(!home.disclosure_shown);
    });
    assert!(cx.debug_bounds("onboarding-empty-state-intro").is_some());
    assert!(cx.debug_bounds("onboarding-telemetry-disclosure").is_none());
    let advance = |s: &mut Shell, cx: &mut Context<Shell>| {
        s.home.update(cx, |h, _| {
            h.intro
                .as_mut()
                .unwrap()
                .advance(std::time::Duration::from_millis(1200))
        })
    };
    view.update(cx, advance);
    draw(cx);
    draw(cx);
    view.update(cx, |s, cx| {
        let home = s.home.read(cx);
        assert!(home.intro.is_none() && home.disclosure_shown);
    });
    assert!(cx.debug_bounds("onboarding-empty-state-intro").is_none());
    let disclosure = cx.debug_bounds("onboarding-telemetry-disclosure").unwrap();
    // Bottom end corner: 24px in, 16px up.
    let window = cx.update(|w, _| w.viewport_size());
    assert!((f32::from(window.width - disclosure.right()) - 24.).abs() < 0.5);
    assert!((f32::from(window.height - disclosure.bottom()) - 16.).abs() < 0.5);

    // Once seen, a Homepage shown again replays the intro but asks no more.
    let state = cx.update(|_, cx| telemetry::global(cx).unwrap());
    state.update(cx, |t, _| {
        t.snapshot = Some(telemetry::fixture(Level::Basic, true, false))
    });
    let fixture = |on: bool| {
        move |s: &mut Shell, w: &mut Window, cx: &mut Context<Shell>| {
            s.session.project.update(cx, |p, _| p.record.fixture = on);
            s.receive(w, cx)
        }
    };
    view.update_in(cx, fixture(true));
    draw(cx);
    view.update_in(cx, fixture(false));
    draw(cx);
    view.update(cx, |s, cx| {
        let home = s.home.read(cx);
        assert!(home.intro.is_some() && !home.disclosure_shown);
    });
    view.update(cx, advance);
    draw(cx);
    draw(cx);
    assert!(cx.debug_bounds("onboarding-telemetry-disclosure").is_none());

    // Reduced motion: no intro at all.
    cx.update(|_, cx| cx.set_reduce_motion(true));
    view.update_in(cx, fixture(true));
    draw(cx);
    view.update_in(cx, fixture(false));
    draw(cx);
    view.update(cx, |s, cx| assert!(s.home.read(cx).intro.is_none()));
}
/// N-12: an account's last list stands in for its first answer (not as
/// the settled order), listing opens no project by itself, and signing out
/// removes it.
#[gpui::test]
fn the_last_catalog_stands_in_until_the_fresh_one_and_leaves_on_sign_out(cx: &mut TestAppContext) {
    use crate::features::cloud::CatalogState as State;
    use std::sync::atomic::{AtomicBool, Ordering};
    let dir = tempfile::tempdir().unwrap();
    let slow = std::sync::Arc::new(AtomicBool::new(false));
    let responder = with_catalog({
        let slow = slow.clone();
        std::sync::Arc::new(move |request| {
            if slow.load(Ordering::SeqCst) && request.path.ends_with("/projects/") {
                std::thread::sleep(std::time::Duration::from_millis(400));
            }
            cloud_project_responder()(request)
        })
    });
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true);
        let cache = dir.path().to_path_buf();
        s.cloud
            .read(cx)
            .catalog
            .clone()
            .update(cx, |c, _| c.cache_dir = Some(cache));
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| s.refresh_cloud_catalog(true, cx));
    settle_cloud(&view, cx, "the fresh catalog", &|s, cx| {
        let c = s.cloud.read(cx).catalog.read(cx);
        c.fresh && matches!(c.state, State::Ready(_))
    });
    assert!(dir.path().join("cloud-project-catalog.v1.json").exists());
    // Listing the projects opens none of them.
    view.read_with(cx, |s, cx| {
        assert!(s.hosted_project(cx).is_none() && s.files(cx).cloud_opening().is_none())
    });
    // The next launch: the cached list shows at once, not yet settled.
    slow.store(true, Ordering::SeqCst);
    view.update(cx, |s, cx| {
        s.cloud.read(cx).catalog.clone().update(cx, |c, _| c.forget());
        s.refresh_cloud_catalog(false, cx);
        let c = s.cloud.read(cx).catalog.read(cx);
        assert!(!c.fresh);
        assert!(
            matches!(&c.state, State::Ready(entries) if entries.iter().any(|e| e.name == "Fixture Cloud"))
        );
    });
    settle_cloud(&view, cx, "the fresh answer", &|s, cx| {
        s.cloud.read(cx).catalog.read(cx).fresh
    });
    // Signing out removes the names.
    cx.update(|_, cx| crate::features::cloud::account::sign_out(cx));
    settle_cloud(&view, cx, "the signed-out account", &|_, cx| {
        !crate::features::cloud::account::has_account(cx)
    });
    // The fixture account was installed after the window, so the shell
    // does not observe it; the app's account change refreshes the catalog.
    view.update(cx, |s, cx| s.refresh_cloud_catalog(false, cx));
    settle_cloud(&view, cx, "the cleared cache", &|_, _| {
        !dir.path().join("cloud-project-catalog.v1.json").exists()
    });
}

#[gpui::test]
fn projects_home_toolbar_and_agent_start_create_blank_project_with_seeded_chat(
    cx: &mut TestAppContext,
) {
    use super::home::discovery::{HomepageCloudAgent, HomepageLocalAgent};
    let temp = tempfile::tempdir().unwrap();
    let parent = temp.path().canonicalize().unwrap();
    let existing = parent.join("existing");
    std::fs::create_dir(&existing).unwrap();
    std::fs::write(existing.join("Overview.md"), "# Overview\n").unwrap();
    // Pre-occupy the first suggested folder name so numbering (` 2`) is verified.
    std::fs::create_dir(parent.join("Draft Q4 launch plan")).unwrap();

    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::ui::form_input::bind_keys(cx);
    });
    let (view, cx) = setup(cx);
    let claude = HomepageLocalAgent {
        runtime_id: "claude".into(),
        label: "Claude Code".into(),
        icon_key: "claude".into(),
        connected: true,
    };
    let all_local = vec![
        claude.clone(),
        HomepageLocalAgent {
            runtime_id: "codex".into(),
            label: "Codex".into(),
            icon_key: "codex".into(),
            connected: false,
        },
        HomepageLocalAgent {
            runtime_id: "cursor".into(),
            label: "Cursor".into(),
            icon_key: "cursor".into(),
            connected: false,
        },
        HomepageLocalAgent {
            runtime_id: "opencode-native".into(),
            label: "OpenCode".into(),
            icon_key: "opencode".into(),
            connected: false,
        },
        HomepageLocalAgent {
            runtime_id: "pi".into(),
            label: "Pi".into(),
            icon_key: "pi".into(),
            connected: false,
        },
        HomepageLocalAgent {
            runtime_id: "workbuddy-china".into(),
            label: "WorkBuddy (China)".into(),
            icon_key: "workbuddy".into(),
            connected: false,
        },
    ];
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs
            .store
            .update(cx, |p, _| p.state.remember_project(&existing, 1));
        s.home.update(cx, |h, _| {
            h.discovery.local_agents_override = Some(all_local);
            h.discovery.cloud_details_override = true;
            h.discovery.cloud_agents = vec![HomepageCloudAgent {
                id: "agent-cloud-1".into(),
                name: "Review Bot".into(),
                avatar: None,
                last_active_at: Some("2026-11-15T08:00:00Z".into()),
            }];
        });
    });
    command(&view, cx, Command::Home);
    settle_cloud(&view, cx, "the Homepage list", &|s, cx| {
        !s.home.read(cx).list_held()
            && s.home
                .read(cx)
                .discovery
                .local_previews
                .contains_key(existing.as_path())
    });
    draw(cx);

    // One toolbar: the ways to start at its start, sort and layout at its
    // end, never overlapping, at every width.
    let assert_toolbar_bounds = |cx: &mut VisualTestContext, expected_col_w: f32| {
        let header = cx.debug_bounds("home-header-row").unwrap();
        let start_actions = cx.debug_bounds("home-start-actions").unwrap();
        let agents = cx.debug_bounds("home-new-project-agents").unwrap();
        let layout = cx.debug_bounds("home-view-controls").unwrap();
        assert!(
            (f32::from(header.size.width) - expected_col_w).abs() < 1.0,
            "header width {:?} != expected {expected_col_w}",
            header.size.width
        );
        assert!(
            (f32::from(layout.right()) - f32::from(header.right())).abs() < 1.0,
            "layout switch right {:?} != header right {:?}",
            layout.right(),
            header.right()
        );
        assert!(
            agents.right() <= start_actions.right() && agents.left() > start_actions.left(),
            "New project's Agents stay inside the start actions"
        );
        assert!(
            f32::from(layout.left()) >= f32::from(start_actions.right()) + 11.0,
            "view controls {:?} collided with start actions {:?}",
            layout.left(),
            start_actions.right()
        );
    };

    // Standard wide viewport (`760px` column), compact macOS window (`958×625`,
    // `760px` column), and narrow viewport (`620×625`, `564px` column).
    assert_toolbar_bounds(cx, 760.);
    cx.simulate_resize(size(px(958.), px(625.)));
    draw(cx);
    assert_toolbar_bounds(cx, 760.);
    cx.simulate_resize(size(px(620.), px(625.)));
    draw(cx);
    assert_toolbar_bounds(cx, 564.);
    cx.simulate_resize(size(px(1280.), px(800.)));
    draw(cx);
    assert_toolbar_bounds(cx, 760.);
    // No Agent marks stand in the toolbar on their own.
    assert!(cx.debug_bounds("home-agent-strip").is_none());

    // New project's menu: its last row opens Settings on Local Agents.
    let open_agents = |cx: &mut VisualTestContext| {
        let chevron = cx.debug_bounds("home-new-project-agents").unwrap().center();
        cx.simulate_click(chevron, Modifiers::default());
        draw(cx);
        draw(cx);
    };
    open_agents(cx);
    let settings_label = crate::localization::t("settings.localAgents.title");
    let settings_item: &'static str =
        Box::leak(format!("menu-item:{settings_label}").into_boxed_str());
    let item = cx.debug_bounds(settings_item).unwrap().center();
    cx.simulate_click(item, Modifiers::default());
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert_eq!(s.dialogs.read(cx).task(), Some(Task::Settings));
    });
    command(&view, cx, Command::Escape);
    draw(cx);

    // Each Local Agent is offered by what choosing it does; Claude Code
    // opens `AgentProjectStartDialog`, syncs the folder name from the prompt
    // until edited, and submits a blank folder.
    open_agents(cx);
    let start_label = crate::localization::tf(
        "onboarding.agents.start",
        &[(
            "agent",
            crate::localization::bidi_isolate("Claude Code").into(),
        )],
    );
    let start_item: &'static str = Box::leak(format!("menu-item:{start_label}").into_boxed_str());
    let item = cx.debug_bounds(start_item).unwrap().center();
    cx.simulate_click(item, Modifiers::default());
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert_eq!(s.top_dialog(cx).as_deref(), Some("AgentStart"));
    });
    let prompt = view.update_in(cx, |s, _, cx| {
        s.home.update(cx, |h, _| {
            let start = h.agent_start.as_mut().unwrap();
            start.destination.location = Some(parent.clone());
            start.prompt.clone()
        })
    });
    prompt.update_in(cx, |i, w, cx| {
        i.replace_text_in_range(None, "Draft Q4 launch plan, then outline milestones", w, cx);
    });
    draw(cx);
    view.read_with(cx, |s, cx| {
        let start = s.home.read(cx).agent_start.as_ref().unwrap();
        assert!(!start.name_edited);
        assert_eq!(
            start.destination.name.read(cx).text(),
            "Draft Q4 launch plan"
        );
    });

    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.submit_agent_start(w, cx));
    });
    let expected_root = parent.join("Draft Q4 launch plan 2");
    settle_cloud(&view, cx, "the Agent-started project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(expected_root.as_path())
            && s.right_shows(Surface::Agent, cx)
    });
    draw(cx);
    assert!(expected_root.is_dir());
    assert!(
        !expected_root.join("Getting Started.md").exists(),
        "Agent-started folder stays blank until the Agent writes to it"
    );
    view.read_with(cx, |s, cx| {
        assert!(s.dialogs.read(cx).is_empty());
        assert_eq!(
            s.prefs
                .store
                .read(cx)
                .state
                .agent_routing
                .selected_runtime_id
                .as_deref(),
            Some("claude")
        );
    });
}
/// The Homepage over a project takes the pointer from it: the editor beneath,
/// laid out but not drawn, neither scrolls under the wheel nor takes the
/// focus from a press on the page.
#[gpui::test]
fn the_homepage_takes_the_pointer_from_the_project_beneath_it(cx: &mut TestAppContext) {
    let projects = tempfile::tempdir().unwrap();
    let folder = projects.path().canonicalize().unwrap().join("Field Notes");
    std::fs::create_dir(&folder).unwrap();
    let (view, cx) = setup(cx);
    cx.simulate_resize(size(px(1280.), px(800.)));
    let _document = open_long_document(&view, cx);
    let editor = view.read_with(cx, |s, _| s.frame.layout.editor);
    let blank = point(px(editor.x + editor.w / 2.), px(editor.bottom() - 40.));
    // In the project, the wheel there scrolls the document.
    wheel_down(cx, blank);
    let scrolled = document_scroll(&view, cx);
    assert!(scrolled > 0., "the document scrolls in its project");
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs
            .store
            .update(cx, |p, _| p.state.remember_project(&folder, 1));
    });
    command(&view, cx, Command::Home);
    settle_cloud(&view, cx, "the Homepage list", &|s, cx| {
        !s.home.read(cx).list_held()
    });
    draw(cx);
    view.read_with(cx, |s, cx| assert!(s.home_visible(cx)));
    let focused = cx.update(|w, cx| w.focused(cx));
    wheel_down(cx, blank);
    cx.simulate_mouse_down(blank, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_up(blank, MouseButton::Left, Modifiers::default());
    draw(cx);
    assert_eq!(
        cx.update(|w, cx| w.focused(cx)),
        focused,
        "a press on the page focuses nothing beneath it"
    );
    assert_eq!(
        document_scroll(&view, cx),
        scrolled,
        "the document under the Homepage stays where it was"
    );
}

/// `openDroppedWorkspaceInCurrentWindow`: one folder dropped on the
/// Homepage opens here; a file or several items open nothing and ask for
/// one local folder.
#[gpui::test]
fn a_folder_dropped_on_the_homepage_opens_here(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let parent = temp.path().canonicalize().unwrap();
    let notes = parent.join("Notes");
    let other = parent.join("Other");
    for folder in [&notes, &other] {
        std::fs::create_dir(folder).unwrap();
    }
    std::fs::write(parent.join("loose.md"), "# Loose\n").unwrap();
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false)
    });
    command(&view, cx, Command::Home);
    let before = view.read_with(cx, |s, cx| s.workspace_root(cx));
    for dropped in [
        vec![parent.join("loose.md")],
        vec![notes.clone(), other.clone()],
    ] {
        view.update(cx, |s, cx| {
            s.home.update(cx, |h, cx| {
                h.error = None;
                h.drop_on_homepage(&dropped, cx);
            })
        });
        view.read_with(cx, |s, cx| {
            assert!(s.home.read(cx).error.is_some(), "{dropped:?}");
            assert_eq!(s.workspace_root(cx), before, "{dropped:?}");
        });
    }
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, cx| {
            h.drop_on_homepage(std::slice::from_ref(&notes), cx)
        })
    });
    settle_cloud(&view, cx, "the dropped folder", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(notes.as_path())
    });
    view.read_with(cx, |s, cx| assert!(s.home.read(cx).error.is_none()));
}

/// `going Home from a project`: Home arrives at once with the waiting mark
/// standing in for the list, and the list shows once its projects' dates
/// are read; a hold never outlasts the budget, and an earlier hold's
/// budget does not release a later one.
#[gpui::test]
fn going_home_holds_only_the_list_until_its_dates_or_the_budget(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let alpha = temp.path().canonicalize().unwrap().join("alpha");
    let gamma = temp.path().canonicalize().unwrap().join("gamma");
    let dated = |dir: &std::path::Path, secs: u64| {
        let file = std::fs::File::create(dir.join("a.md")).unwrap();
        file.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs))
            .unwrap();
    };
    for (dir, secs) in [(&alpha, 1_000_000), (&gamma, 2_000_000)] {
        std::fs::create_dir(dir).unwrap();
        dated(dir, secs);
    }
    let (view, cx) = setup(cx);
    let store = view.read_with(cx, |s, _| s.prefs.store.clone());
    store.update(cx, |store, cx| {
        store.change(
            |p| {
                p.remember_project(&alpha, 1);
                p.remember_project(&gamma, 2);
            },
            cx,
        )
    });
    let order = |cx: &mut VisualTestContext| {
        view.read_with(cx, |s, cx| {
            s.home
                .read(cx)
                .visible_projects(cx)
                .iter()
                .filter_map(|item| item.local_path.clone())
                .collect::<Vec<_>>()
        })
    };
    view.update_in(cx, |s, w, cx| s.open_project(alpha.clone(), w, cx));
    settle_cloud(&view, cx, "alpha", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(alpha.as_path())
    });
    let held = |cx: &mut VisualTestContext| view.read_with(cx, |s, cx| s.home.read(cx).list_held());
    command(&view, cx, Command::Home);
    view.read_with(cx, |s, cx| {
        assert!(s.home_visible(cx));
        let home = s.home.read(cx);
        assert!(home.visible_projects(cx).is_empty());
        assert!(home.has_projects(cx), "a held list is not an empty one");
    });
    assert!(held(cx));
    settle_cloud(&view, cx, "the dates", &|s, cx| {
        !s.home.read(cx).list_held()
    });
    let path = |p: &std::path::Path| p.to_string_lossy().into_owned();
    assert_eq!(order(cx), [path(&gamma), path(&alpha)]);
    // Work in alpha, then Home again: a new visit, in the new order.
    view.update_in(cx, |s, w, cx| s.open_project(alpha.clone(), w, cx));
    settle_cloud(&view, cx, "alpha", &|s, cx| !s.home_visible(cx));
    dated(&alpha, 3_000_000);
    command(&view, cx, Command::Home);
    settle_cloud(&view, cx, "the new dates", &|s, cx| {
        !s.home.read(cx).list_held()
    });
    assert_eq!(order(cx), [path(&alpha), path(&gamma)]);
    // In a project, nothing reads the list: only the budget releases it.
    view.update_in(cx, |s, w, cx| s.open_project(alpha.clone(), w, cx));
    settle_cloud(&view, cx, "alpha again", &|s, cx| !s.home_visible(cx));
    let hold = |cx: &mut VisualTestContext| {
        view.update(cx, |s, cx| s.home.update(cx, |h, cx| h.hold_list(cx)))
    };
    let ms = std::time::Duration::from_millis;
    hold(cx);
    cx.executor().advance_clock(ms(2_000));
    hold(cx);
    cx.executor().advance_clock(ms(2_000));
    assert!(held(cx), "the earlier hold's budget leaves the later one");
    cx.executor().advance_clock(ms(1_999));
    assert!(held(cx));
    cx.executor().advance_clock(ms(1));
    assert!(!held(cx));
}

/// `waits for the signed-in session, because signed out is not yet known
/// while it restores`, `shows the list once, in final order`, `does not
/// take back a Homepage released before a slow session turned up`, `holds
/// a Homepage whose user signs in, and shows the account's whole list
/// together`, `stops holding that sign-in at the budget`: the first
/// Homepage waits while the Cloud session restores and then for the
/// account's list, and shows it whole; released by the budget before a
/// slow session turned up, it is not held again when the session does,
/// but a person signing in later holds it again, never past the budget.
#[gpui::test]
fn the_first_homepage_waits_for_the_session_and_the_whole_list(cx: &mut TestAppContext) {
    use crate::cloud::auth::Status;
    let (view, cx) = setup(cx);
    let (broker, browser) =
        crate::cloud::auth::responding_account_fixture(with_catalog(cloud_project_responder()));
    let account =
        cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "the account", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    let signed_in = account.read_with(cx, |a, _| a.snapshot.clone().unwrap());
    let set = |cx: &mut VisualTestContext, status: Status| {
        account.update(cx, |a, cx| {
            let mut snapshot = signed_in.clone();
            snapshot.status = status;
            if status != Status::Authenticated {
                snapshot.account = None;
            }
            a.snapshot = Some(snapshot);
            cx.notify();
        });
        view.update(cx, |s, cx| {
            s.refresh_cloud_catalog(false, cx);
            s.home.update(cx, |h, cx| h.refresh(cx));
        });
        draw(cx);
    };
    let held = |cx: &mut VisualTestContext| {
        view.read_with(cx, |s, cx| s.home.read(cx).first_paint_held(cx))
    };
    set(cx, Status::Restoring);
    launch_with_cloud(&view, cx);
    view.update(cx, |s, cx| {
        s.session.project.update(cx, |p, _| {
            p.record.fixture = false;
            p.home = true;
        })
    });
    draw(cx);
    view.read_with(cx, |s, cx| assert!(s.home_visible(cx)));
    // The local projects are read; the session is what it waits for.
    settle_cloud(&view, cx, "the local read", &|s, cx| {
        !s.home.read(cx).reading
    });
    std::thread::sleep(std::time::Duration::from_millis(20));
    draw(cx);
    assert!(
        held(cx),
        "signed out is not yet known while the session restores"
    );
    set(cx, Status::Authenticated);
    settle_cloud(&view, cx, "the whole list", &|s, cx| {
        let home = s.home.read(cx);
        !home.first_paint_held(cx)
            && home
                .visible_projects(cx)
                .iter()
                .any(|i| i.label == "Fixture Cloud")
    });
    // A later launch whose session outlasts the budget is released...
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, _| h.relaunch_first_paint())
    });
    set(cx, Status::Restoring);
    assert!(held(cx));
    view.update(cx, |s, cx| s.home.update(cx, |h, _| h.expire_first_paint()));
    draw(cx);
    draw(cx);
    assert!(!held(cx));
    // ...and is not taken back when the session turns up.
    set(cx, Status::Authenticated);
    assert!(!held(cx));
    // Signed out, then signing in: the account's list is held again.
    set(cx, Status::SignedOut);
    assert!(!held(cx));
    let home = view.read_with(cx, |s, _| s.home.clone());
    let was_held = std::rc::Rc::new(std::cell::Cell::new(false));
    let _watch = cx.update(|_, cx| {
        let was_held = was_held.clone();
        cx.observe(&home, move |home, cx| {
            if home.read(cx).first_paint_held(cx) {
                was_held.set(true);
            }
        })
    });
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, _| h.restart_first_paint())
    });
    set(cx, Status::Authenticated);
    settle_cloud(&view, cx, "the signed-in list", &|s, cx| {
        !s.home.read(cx).first_paint_held(cx)
    });
    assert!(
        was_held.get(),
        "a sign-in holds the list until the account's list settles"
    );
}
