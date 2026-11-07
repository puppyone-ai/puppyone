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
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
    });
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
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true);
        s.refresh_cloud_catalog(true, cx);
    });
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
    cx.run_until_parked();
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
#[gpui::test]
fn an_unsupported_repository_url_is_refused_before_cloning(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let parent = temp.path().canonicalize().unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.begin_import(w, cx))
    });
    // An unsupported URL is refused before anything runs.
    view.update_in(cx, |s, w, cx| {
        let Some(url) = s.home.read(cx).import.as_ref().map(|i| i.url.clone()) else {
            panic!("no import dialog")
        };
        url.update(cx, |i, cx| {
            i.set_text(String::from("https://example.com/a/b"), cx)
        });
        s.home.update(cx, |h, cx| h.submit_import(w, cx));
    });
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.has_dialog("ImportRepository", cx));
        assert!(s.workspace_root(cx).is_none());
    });
    let _ = parent;
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
/// H-20: a new project starts with Getting started, which opens first;
/// "Paste template link" refuses anything but a template link.
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
    cx.update(|_, cx| cx.write_to_clipboard(ClipboardItem::new_string("just words".into())));
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.paste_template_link(w, cx))
    });
    view.update(cx, |s, cx| {
        let home = s.home.read(cx);
        let create = home.create.as_ref().unwrap();
        assert_eq!(
            create.error.as_deref(),
            Some(crate::localization::t("onboarding.template.noLink"))
        );
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
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.submit_template(w, cx))
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
/// the settled order), and signing out removes it.
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
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
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
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| s.refresh_cloud_catalog(true, cx));
    settle_cloud(&view, cx, "the fresh catalog", &|s, cx| {
        let c = s.cloud.read(cx).catalog.read(cx);
        c.fresh && matches!(c.state, State::Ready(_))
    });
    assert!(dir.path().join("cloud-project-catalog.v1.json").exists());
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
