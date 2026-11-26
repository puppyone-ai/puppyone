//! The Homepage's place groups (v0.4.4 `OnboardingProjectGroups`): projects
//! by the place that holds them, and a folder dropped on a space opening its
//! confirmed publication to that space.
use super::*;
use core::prelude::v1::test;

/// Two spaces and a project in each; everything else as `fallback`.
fn with_spaces(fallback: crate::cloud::auth::Responder) -> crate::cloud::auth::Responder {
    std::sync::Arc::new(move |request| {
        let path = request.path.as_str();
        if path == "/organizations/" {
            return Ok(serde_json::json!({"code": 0, "data": [
                {"id": "me", "name": "Alex", "is_default": true, "can_create_projects": true},
                {"id": "team-1", "name": "Design", "can_create_projects": true}]}));
        }
        if path == "/projects/" {
            return Ok(serde_json::json!({"code": 0, "data": [
                {"id": "p-todo", "name": "Todo", "org_id": "me", "updated_at": "2026-10-01T00:00:00Z"},
                {"id": "p-issues", "name": "Issues", "org_id": "team-1", "updated_at": "2026-10-02T00:00:00Z"}]}));
        }
        fallback(request)
    })
}

/// A signed-in account with Cloud on, `folder` remembered, the Homepage up.
fn home_with_spaces<'a>(
    cx: &'a mut TestAppContext,
    folder: &std::path::Path,
) -> (Entity<Shell>, &'a mut VisualTestContext) {
    let (view, cx) = setup(cx);
    let (broker, browser) =
        crate::cloud::auth::responding_account_fixture(with_spaces(cloud_project_responder()));
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs.store.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            p.state.remember_project(folder, 1);
        });
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    command(&view, cx, Command::Home);
    settle_cloud(&view, cx, "the groups", &|s, cx| {
        let home = s.home.read(cx);
        !home.list_held()
            && home.spaces.read(cx).status() == crate::features::cloud::SpacesStatus::Ready
            && home.visible_projects(cx).len() == 3
    });
    draw(cx);
    (view, cx)
}

/// Switches Home to the legacy stacked `Classic` layout for tests that
/// inspect vertically stacked groups together.
fn use_classic_home(view: &Entity<Shell>, cx: &mut VisualTestContext) {
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.change(
                |p| {
                    p.experimental.home_space_layout =
                        crate::features::settings::HomeSpaceLayout::Classic
                },
                cx,
            )
        })
    });
    draw(cx);
}

#[gpui::test]
fn the_homepage_groups_projects_by_the_place_that_holds_them(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    let (view, cx) = home_with_spaces(cx, &folder);
    use_classic_home(&view, cx);
    let local = cx.debug_bounds("home-group:local-only").expect("This Mac");
    let personal = cx
        .debug_bounds("home-group:space:me")
        .expect("the account's own space");
    let team = cx
        .debug_bounds("home-group:space:team-1")
        .expect("the shared space");
    // This computer, then the default space, then the others by name.
    assert!(local.origin.y < personal.origin.y && personal.origin.y < team.origin.y);
    // Each project sits in its place's group.
    let issues = cx.debug_bounds("home-project:cloud:p-issues").unwrap();
    let todo = cx.debug_bounds("home-project:cloud:p-todo").unwrap();
    assert!(team.contains(&issues.center()));
    assert!(personal.contains(&todo.center()));
    let notes: &'static str =
        Box::leak(format!("home-project:local:{}", folder.display()).into_boxed_str());
    assert!(local.contains(&cx.debug_bounds(notes).unwrap().center()));
}

#[gpui::test]
fn a_folder_dropped_on_a_team_opens_its_publication_to_that_team(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    std::fs::write(folder.join("a.md"), "# A\n").unwrap();
    let (view, cx) = home_with_spaces(cx, &folder);
    use_classic_home(&view, cx);
    let notes: &'static str =
        Box::leak(format!("home-project:local:{}", folder.display()).into_boxed_str());
    let from = cx.debug_bounds(notes).unwrap().center();
    cx.simulate_mouse_down(from, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_move(
        point(from.x + px(8.), from.y + px(4.)),
        Some(MouseButton::Left),
        Modifiers::default(),
    );
    draw(cx);
    // While it is dragged, the space takes it and says what letting go does.
    let team = cx.debug_bounds("home-group:space:team-1").unwrap();
    let over = point(team.center().x, team.origin.y + px(6.));
    cx.simulate_mouse_move(over, Some(MouseButton::Left), Modifiers::default());
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.home.read(cx).drop_over,
            Some(super::home::groups::GroupId::Space("team-1".into()))
        )
    });
    cx.simulate_mouse_up(over, MouseButton::Left, Modifiers::default());
    // The exact folder opens, then its publication, to that team only.
    settle_cloud(&view, cx, "the publication", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(folder.as_path())
            && s.has_dialog("CloudPublish", cx)
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.cloud.read(cx).publish.read(cx).target.as_deref(),
            Some("team-1")
        );
    });
}

/// `OnboardingProjectEntryDialog`: a team's project is an empty Cloud
/// project in that team's space, made once however often Create is retried,
/// and opened at once.
#[gpui::test]
fn a_team_project_is_made_once_in_its_space_and_opens(cx: &mut TestAppContext) {
    use super::home::create_project::Audience;
    use std::sync::{Arc, Mutex};
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    type Posts = Arc<Mutex<Vec<(serde_json::Value, Option<String>)>>>;
    let posts: Posts = Default::default();
    let seen = posts.clone();
    let creating: crate::cloud::auth::Responder = Arc::new(move |request| {
        if request.method == reqwest::Method::POST && request.path == "/projects/" {
            let mut seen = seen.lock().unwrap();
            seen.push((
                request.body.clone().unwrap(),
                request.idempotency_key.clone(),
            ));
            if seen.len() == 1 {
                return Err(crate::cloud::auth::Error::Response(
                    503,
                    None,
                    Default::default(),
                ));
            }
            return Ok(serde_json::json!({"code": 0, "data":
                {"id": "p-new", "name": "Plans", "org_id": "team-1"}}));
        }
        cloud_project_responder()(request)
    });
    let sandbox_puts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let puts = sandbox_puts.clone();
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(Arc::new({
        let spaces = with_spaces(cloud_project_responder());
        move |request| {
            if request.path.ends_with("/workbench/sandbox") {
                puts.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
            }
            if request.method == reqwest::Method::POST {
                creating(request)
            } else {
                spaces(request)
            }
        }
    }));
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs.store.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            p.state.remember_project(&folder, 1);
        });
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    command(&view, cx, Command::Home);
    settle_cloud(&view, cx, "the spaces", &|s, cx| {
        s.home.read(cx).spaces.read(cx).status() == crate::features::cloud::SpacesStatus::Ready
    });
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.begin_create_project(w, cx);
            // Both spaces take projects: Only this computer and Team, the
            // space named in Team's menu.
            assert_eq!(
                h.create_audiences(cx),
                vec![Audience::Local, Audience::Team]
            );
            assert_eq!(h.creatable_teams(cx).len(), 2);
            h.create
                .as_ref()
                .unwrap()
                .destination
                .name
                .update(cx, |input, cx| input.set_text("Plans".to_owned(), cx));
            h.choose_create_audience(Audience::Team, Some("team-1".into()), cx);
        })
    });
    draw(cx);
    assert!(cx.debug_bounds("create-project-stored-cloud").is_some());
    // Without the Cloud Computer screen experiment there is nothing to choose.
    assert!(cx.debug_bounds("create-project-advanced").is_none());
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.submit_create_project(w, cx))
    });
    settle_cloud(&view, cx, "the failed creation", &|s, cx| {
        s.home
            .read(cx)
            .create
            .as_ref()
            .is_some_and(|c| !c.submitting && c.error.is_some())
    });
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.submit_create_project(w, cx))
    });
    settle_cloud(&view, cx, "the Cloud project", &|s, cx| {
        s.home.read(cx).create.is_none()
            && s.session.project.read(cx).record.cloud.as_deref() == Some("p-new")
    });
    let posts = posts.lock().unwrap();
    assert_eq!(posts.len(), 2);
    assert_eq!(
        posts[0].0,
        serde_json::json!({"name": "Plans", "org_id": "team-1"})
    );
    // The retry is the same operation.
    assert!(posts[0].1.is_some());
    assert_eq!(posts[0].1, posts[1].1);
    // No Cloud Computer choice was made, so none was sent.
    assert_eq!(sandbox_puts.load(std::sync::atomic::Ordering::Acquire), 0);
}

/// The hidden settings under a Cloud project's space: a desktop chosen
/// there is saved before the project first opens, so its first Cloud
/// Computer has one. A failed save keeps the dialog; Create again hands back
/// the same project and saves it then.
#[gpui::test]
fn a_cloud_project_saves_its_desktop_before_it_first_opens(cx: &mut TestAppContext) {
    use super::home::create_project::Audience;
    use std::sync::{Arc, Mutex};
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    // Every request about the new project, in order: `METHOD path body`.
    let log: Arc<Mutex<Vec<String>>> = Default::default();
    let seen = log.clone();
    let puts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(Arc::new({
        let spaces = with_spaces(cloud_project_responder());
        move |request| {
            let creating = request.method == reqwest::Method::POST && request.path == "/projects/";
            if creating || request.path.starts_with("/projects/p-new") {
                seen.lock().unwrap().push(format!(
                    "{} {} {}",
                    request.method,
                    request.path,
                    request.body.clone().unwrap_or_default()
                ));
            }
            if creating {
                return Ok(serde_json::json!({"code": 0, "data":
                    {"id": "p-new", "name": "Plans", "org_id": "team-1"}}));
            }
            if request.path == "/projects/p-new/workbench/sandbox" {
                if puts.fetch_add(1, std::sync::atomic::Ordering::AcqRel) == 0 {
                    return Err(crate::cloud::auth::Error::Response(
                        503,
                        None,
                        Default::default(),
                    ));
                }
                return Ok(serde_json::json!({"code": 0, "data": {
                    "profile": "base", "next_profile": "desktop",
                    "settings": {"desktop": true}, "features": []}}));
            }
            spaces(request)
        }
    }));
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs.store.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            p.state.experimental.cloud_computer_screen = true;
            p.state.remember_project(&folder, 1);
        });
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    command(&view, cx, Command::Home);
    settle_cloud(&view, cx, "the spaces", &|s, cx| {
        s.home.read(cx).spaces.read(cx).status() == crate::features::cloud::SpacesStatus::Ready
    });
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.begin_create_project(w, cx);
            h.create
                .as_ref()
                .unwrap()
                .destination
                .name
                .update(cx, |input, cx| input.set_text("Plans".to_owned(), cx));
        })
    });
    draw(cx);
    // A project kept on this computer has no Cloud Computer to choose.
    assert!(cx.debug_bounds("create-project-advanced").is_none());
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, cx| {
            h.choose_create_audience(Audience::Team, Some("team-1".into()), cx)
        })
    });
    draw(cx);
    // Under the space, hidden until asked for; off until chosen.
    assert!(cx.debug_bounds("create-project-advanced").is_some());
    assert!(cx.debug_bounds("create-project-cloud-desktop").is_none());
    let advanced = cx.debug_bounds("create-project-advanced").unwrap();
    cx.simulate_click(advanced.center(), Modifiers::none());
    draw(cx);
    assert!(cx.debug_bounds("create-project-cloud-desktop").is_some());
    view.read_with(cx, |s, cx| {
        assert!(!s.home.read(cx).create.as_ref().unwrap().cloud_desktop);
    });
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, cx| h.choose_cloud_desktop(true, cx))
    });
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.submit_create_project(w, cx))
    });
    settle_cloud(&view, cx, "the failed save", &|s, cx| {
        s.home
            .read(cx)
            .create
            .as_ref()
            .is_some_and(|c| !c.submitting && c.error.is_some())
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.home.read(cx).create.as_ref().unwrap().error.as_deref(),
            Some(crate::localization::t("cloud.settings.computer.failed"))
        );
        assert_ne!(
            s.session.project.read(cx).record.cloud.as_deref(),
            Some("p-new")
        );
    });
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.submit_create_project(w, cx))
    });
    settle_cloud(&view, cx, "the Cloud project", &|s, cx| {
        s.home.read(cx).create.is_none()
            && s.session.project.read(cx).record.cloud.as_deref() == Some("p-new")
    });
    let log = log.lock().unwrap();
    let create = r#"POST /projects/ {"name":"Plans","org_id":"team-1"}"#;
    let save = r#"PUT /projects/p-new/workbench/sandbox {"desktop":true}"#;
    // Made once per Create, saved after each, and nothing about the project
    // before the choice is saved.
    assert_eq!(log[..4], [create, save, create, save]);
}

/// `onManageSpace`: a space's "Members & plan" opens Settings on that one
/// space's Members, whatever space a project on screen belongs to.
#[gpui::test]
fn members_and_plan_open_settings_on_that_space(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    let (view, cx) = home_with_spaces(cx, &folder);
    view.update(cx, |s, cx| {
        s.home.update(cx, |_, cx| {
            cx.emit(home::HomeEvent::ManageSpace("team-1".into()))
        })
    });
    view.read_with(cx, |s, cx| {
        assert!(s.has_dialog("Task(Settings)", cx));
        let settings = s.dialogs.read(cx).settings.read(cx);
        assert_eq!(
            settings.settings_space(cx).map(|s| s.id),
            Some("team-1".to_owned())
        );
        assert!(settings.page_shown(crate::features::settings::Page::Space));
    });
    // Closing Settings and reopening with ⌘, clears the earlier space lock
    // (`openSettingsDialog` resets `settingsSpaceRequest` to null).
    command(&view, cx, Command::Settings);
    view.read_with(cx, |s, cx| assert!(!s.has_dialog("Task(Settings)", cx)));
    command(&view, cx, Command::Settings);
    view.read_with(cx, |s, cx| {
        assert!(s.has_dialog("Task(Settings)", cx));
        let settings = s.dialogs.read(cx).settings.read(cx);
        assert_eq!(
            settings.settings_space(cx).map(|s| s.id),
            Some("me".to_owned())
        );
    });
}

/// The personal space's Cloud Agents stand at the end of that space's
/// heading, beside its members, and nowhere else.
#[gpui::test]
fn the_personal_spaces_agents_stand_with_its_heading(cx: &mut TestAppContext) {
    use super::home::discovery::HomepageCloudAgent;
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    let (view, cx) = home_with_spaces(cx, &folder);
    use_classic_home(&view, cx);
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, cx| {
            h.discovery.cloud_details_override = true;
            h.discovery.cloud_agents = vec![HomepageCloudAgent {
                id: "agent-cloud-1".into(),
                name: "Review Bot".into(),
                avatar: None,
                last_active_at: Some("2026-11-15T08:00:00Z".into()),
            }];
            cx.notify();
        })
    });
    draw(cx);
    let face = cx
        .debug_bounds("home-cloud-agent:agent-cloud-1")
        .expect("the Agent's face");
    let personal = cx.debug_bounds("home-group:space:me").unwrap();
    let team = cx.debug_bounds("home-group:space:team-1").unwrap();
    assert!(personal.contains(&face.center()));
    assert!(!team.contains(&face.center()));
}

/// Hiding the Header on Home takes the bar and brand away while keeping the
/// page where it was and the account circle in place so Account and Settings
/// stay reachable.
#[gpui::test]
fn hiding_the_header_on_home_keeps_the_page_where_it_was(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    let (view, cx) = home_with_spaces(cx, &folder);
    let before = cx.debug_bounds("home-arc-head").expect("the Arc heading");
    let account_before = cx
        .debug_bounds("header-account")
        .expect("the account circle");
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.change(|p| p.experimental.hidden_header = true, cx)
        })
    });
    draw(cx);
    assert!(cx.debug_bounds("homepage-brand").is_none());
    let account_after = cx
        .debug_bounds("header-account")
        .expect("account circle remains reachable");
    assert_eq!(account_before, account_after);
    let after = cx.debug_bounds("home-arc-head").expect("the Arc heading");
    assert_eq!(before.origin, after.origin, "nothing moves up");
    cx.simulate_click(account_after.center(), Modifiers::default());
    draw(cx);
    draw(cx);
    let account_item: &'static str = Box::leak(
        format!(
            "menu-item:{}",
            crate::localization::t("settings.sidebar.account")
        )
        .into_boxed_str(),
    );
    let settings_item: &'static str = Box::leak(
        format!(
            "menu-item:{}",
            crate::localization::t("shell.navigation.settings")
        )
        .into_boxed_str(),
    );
    assert!(cx.debug_bounds(account_item).is_some());
    assert!(cx.debug_bounds(settings_item).is_some());
}

/// Signed in, the Homepage Header ends with the person's circle: it names
/// who is signed in and signs them out.
#[gpui::test]
fn the_header_account_circle_names_the_account_and_signs_out(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    let (view, cx) = home_with_spaces(cx, &folder);
    assert!(cx.debug_bounds("header-sign-in").is_none());
    let circle = cx
        .debug_bounds("header-account")
        .expect("the account circle");
    cx.simulate_click(circle.center(), Modifiers::default());
    draw(cx);
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert_eq!(s.chrome.read(cx).popover, Some(Popover::Account))
    });
    let email = cx
        .update(|_, cx| crate::features::cloud::account::snapshot(cx))
        .and_then(|s| s.account)
        .map(|a| a.email)
        .unwrap();
    let email_row: &'static str = Box::leak(format!("menu-item:{email}").into_boxed_str());
    assert!(cx.debug_bounds(email_row).is_some());
    let sign_out = crate::localization::t("settings.account.signOut");
    let sign_out: &'static str = Box::leak(format!("menu-item:{sign_out}").into_boxed_str());
    let row = cx.debug_bounds(sign_out).unwrap().center();
    cx.simulate_click(row, Modifiers::default());
    settle_cloud(&view, cx, "the signed-out account", &|_, cx| {
        !crate::features::cloud::account::has_account(cx)
    });
    draw(cx);
    assert!(cx.debug_bounds("header-account").is_none());
}

/// Arc is the default Home. Its page stays on the app's own neutral canvas
/// (no Space tint, no colour picker, no `+` menu up top), and each Space
/// ends its projects with a dashed New project tile. In a Cloud Space it asks
/// only for the name, already kept in that Space.
#[gpui::test]
fn a_cloud_spaces_new_project_tile_asks_only_for_the_name(cx: &mut TestAppContext) {
    use crate::features::settings::HomeSpaceLayout;
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    let (view, cx) = home_with_spaces(cx, &folder);
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.prefs.store.read(cx).state.experimental.home_space_layout,
            HomeSpaceLayout::Arc,
            "Arc horizontal swipe is the default Home layout"
        );
    });
    let personal_pill = cx
        .debug_bounds("home-arc-dock:space:me")
        .expect("Personal pill in Arc dock");
    cx.simulate_click(personal_pill.center(), Modifiers::default());
    draw(cx);
    assert!(
        cx.debug_bounds("home-space-add").is_none(),
        "no top-right create menu"
    );
    assert!(
        cx.debug_bounds("home-space-color").is_none(),
        "no colour picker"
    );
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.home.read(cx).home_palette(cx).canvas,
            cx.palette().canvas,
            "the page keeps the app's neutral canvas"
        );
    });
    let tile = cx
        .debug_bounds("home-new-project")
        .expect("dashed New project tile");
    cx.simulate_click(tile.center(), Modifiers::default());
    draw(cx);
    view.read_with(cx, |s, cx| {
        let home = s.home.read(cx);
        let create = home.create.as_ref().expect("the name step");
        assert!(create.scoped);
        assert_eq!(create.audience, super::home::create_project::Audience::Team);
        assert_eq!(create.team.as_deref(), Some("me"));
    });
    assert!(
        cx.debug_bounds("create-audience:local").is_none(),
        "no local / Cloud choice"
    );
    assert!(
        cx.debug_bounds("create-project-stored-cloud").is_none(),
        "no place row"
    );
}

/// On this computer, clicking the dashed New project tile opens the create
/// dialog immediately defaulted to `Documents/PuppyOne` (never popping Finder
/// first, never asking local vs Cloud), and offers detected local Agents,
/// Open a folder, and Import right inside the dialog instead of in a top-right
/// menu.
#[gpui::test]
fn a_local_new_project_defaults_to_puppyone_and_offers_detected_agents(cx: &mut TestAppContext) {
    use super::home::discovery::HomepageLocalAgent;
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    let (view, cx) = home_with_spaces(cx, &folder);
    view.update(cx, |s, cx| {
        s.home.update(cx, |h, cx| {
            h.discovery.local_agents_override = Some(vec![HomepageLocalAgent {
                runtime_id: "claude".into(),
                label: "Claude Code".into(),
                icon_key: "claude".into(),
                connected: true,
            }]);
            cx.notify();
        });
    });
    draw(cx);
    assert!(
        cx.debug_bounds("home-space-more").is_none(),
        "no top-right create menu"
    );
    let tile = cx
        .debug_bounds("home-new-project")
        .expect("dashed New project tile");
    cx.simulate_click(tile.center(), Modifiers::default());
    draw(cx);
    view.read_with(cx, |s, cx| {
        let home = s.home.read(cx);
        let create = home
            .create
            .as_ref()
            .expect("create dialog opens immediately");
        assert!(create.scoped);
        assert_eq!(
            create.audience,
            super::home::create_project::Audience::Local
        );
        assert_eq!(
            create
                .destination
                .location
                .as_deref()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str()),
            Some("PuppyOne"),
            "defaults to Documents/PuppyOne"
        );
    });
    assert!(
        cx.debug_bounds("create-audience:team").is_none(),
        "no local / Cloud choice"
    );
    assert!(cx.debug_bounds("create-project-location-line").is_some());
    // The other ways in sit on the footer row, level with Cancel / Create.
    let cancel = cx.debug_bounds("create-project-cancel").expect("Cancel");
    for id in ["create-open-folder", "create-import"] {
        let link = cx.debug_bounds(id).expect(id);
        assert!(
            (link.center().y - cancel.center().y).abs() < px(2.),
            "{id} shares the Cancel / Create row"
        );
        assert!(
            link.right() < cancel.left(),
            "{id} {link:?} overlaps Cancel {cancel:?}"
        );
    }
    // Start with Agent is Experimental and off by default.
    assert!(cx.debug_bounds("create-start-with-agent").is_none());
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.change(|p| p.experimental.start_with_agent = true, cx)
        })
    });
    draw(cx);
    let trigger = cx
        .debug_bounds("create-start-with-agent")
        .expect("Start with Agent once the Experimental switch is on");
    cx.simulate_click(trigger.center(), Modifiers::default());
    draw(cx);
    draw(cx);
    let claude = cx
        .debug_bounds("menu-item:Claude Code")
        .expect("detected Agent in the menu");
    cx.simulate_click(claude.center(), Modifiers::default());
    draw(cx);
    view.read_with(cx, |s, cx| {
        let home = s.home.read(cx);
        assert!(home.create.is_none());
        let start = home
            .agent_start
            .as_ref()
            .expect("hands off to Agent start dialog");
        assert_eq!(start.agent.runtime_id, "claude");
    });
}

/// Default Home (`Arc`) keeps the floating bottom dock visible even when
/// signed out, showing This Mac beside a quiet Cloud sign-in entry that opens
/// the Sign in dialog.
#[gpui::test]
fn signed_out_home_shows_arc_dock_with_sign_in_guidance(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    let (view, cx) = setup(cx);
    let (broker, browser, _control) = crate::cloud::auth::sign_in_fixture();
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs.store.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            p.state.remember_project(&folder, 1);
        });
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "signed-out account", &|_, cx| {
        crate::features::cloud::account::status(cx)
            == Some(crate::features::cloud::account::Status::SignedOut)
    });
    command(&view, cx, Command::Home);
    settle_cloud(&view, cx, "signed-out home", &|s, cx| {
        !s.home.read(cx).list_held()
    });
    draw(cx);
    assert!(cx.debug_bounds("home-arc-dock").is_some());
    assert!(cx.debug_bounds("home-arc-dock:local-only").is_some());
    let sign_in = cx
        .debug_bounds("home-arc-dock-sign-in")
        .expect("signed-out dock guides user to sign in");
    cx.simulate_click(sign_in.center(), Modifiers::default());
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.has_dialog("SignIn", cx));
    });
}

/// On Home with Spaces, a local project's `⋯` menu replaces "Who can open it"
/// with a `Move to ▸` submenu listing every writable Cloud Space.
#[gpui::test]
fn a_local_projects_menu_offers_move_to_space_submenu(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    std::fs::write(folder.join("a.md"), "# A\n").unwrap();
    let (view, cx) = home_with_spaces(cx, &folder);
    let audience = view.read_with(cx, |s, cx| {
        let home = s.home.read(cx);
        let item = home
            .visible_projects(cx)
            .into_iter()
            .find(|i| i.local_path.is_some())
            .expect("the local project");
        (item.id.clone(), home.audience_of_id(&item.id, cx).unwrap())
    });
    assert_eq!(
        audience
            .1
            .spaces
            .iter()
            .map(|s| s.id.as_str())
            .collect::<Vec<_>>(),
        vec!["me", "team-1"]
    );
    // Open the project's `⋯` menu directly and confirm `Move to ▸` appears
    // without the legacy "Who can open it" items.
    view.update_in(cx, |s, w, cx| {
        let viewport = w.viewport_size();
        let target = super::project_actions::Target::Local {
            path: folder.clone(),
            name: "Notes".into(),
        };
        let actions = s.chrome.read(cx).project_actions.clone();
        actions.update(cx, |a, cx| {
            a.open(
                target,
                Bounds::new(point(px(200.), px(200.)), size(px(28.), px(28.))),
                true,
                viewport,
                Some(audience.0.clone()),
                w,
                cx,
            );
            a.set_audience(Some(audience.1.clone()), cx);
        });
    });
    draw(cx);
    let only_this: &'static str = Box::leak(
        format!(
            "menu-item:{}",
            crate::localization::t("shell.projectAudience.onlyThisComputer")
        )
        .into_boxed_str(),
    );
    assert!(cx.debug_bounds(only_this).is_none());
    let move_to: &'static str = Box::leak(
        format!(
            "menu-item:{}",
            crate::localization::t("home.project.moveTo")
        )
        .into_boxed_str(),
    );
    let move_bounds = cx.debug_bounds(move_to).expect("Move to submenu row");
    // Hover / right-arrow into `Move to ▸` to reveal both Spaces.
    cx.simulate_mouse_move(move_bounds.center(), None, Modifiers::default());
    draw(cx);
    draw(cx);
    let design: &'static str = Box::leak("menu-item:Design".to_owned().into_boxed_str());
    let design_bounds = cx
        .debug_bounds(design)
        .expect("Design Space inside Move to submenu");
    cx.simulate_click(design_bounds.center(), Modifiers::default());
    settle_cloud(&view, cx, "the publication to Design", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(folder.as_path())
            && s.has_dialog("CloudPublish", cx)
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.cloud.read(cx).publish.read(cx).target.as_deref(),
            Some("team-1")
        );
    });
}

/// Every Cloud project folder on the Homepage (both Personal and Team spaces)
/// renders its connected Agents at the folder's bottom-right corner in Grid
/// view and inline in List view.
#[gpui::test]
fn cloud_project_folders_show_connected_agents_on_homepage(cx: &mut TestAppContext) {
    use super::home::folder::FolderAgentBadge;
    use crate::features::settings::HomepageLayout;

    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    let (view, cx) = home_with_spaces(cx, &folder);
    use_classic_home(&view, cx);

    view.update(cx, |s, cx| {
        s.home.update(cx, |h, cx| {
            h.discovery.cloud_details_override = true;
            h.discovery.cloud_project_agents.insert(
                "p-todo".into(),
                vec![FolderAgentBadge {
                    id: "a-grok".into(),
                    name: "Grok Bot".into(),
                    avatar: None,
                    active: true,
                }],
            );
            h.discovery.cloud_project_agents.insert(
                "p-issues".into(),
                vec![
                    FolderAgentBadge {
                        id: "a-1".into(),
                        name: "Grok Bot".into(),
                        avatar: None,
                        active: false,
                    },
                    FolderAgentBadge {
                        id: "a-2".into(),
                        name: "Codex".into(),
                        avatar: Some("codex".into()),
                        active: false,
                    },
                    FolderAgentBadge {
                        id: "a-3".into(),
                        name: "Claude".into(),
                        avatar: Some("claude".into()),
                        active: true,
                    },
                    FolderAgentBadge {
                        id: "a-4".into(),
                        name: "Cursor".into(),
                        avatar: Some("cursor".into()),
                        active: false,
                    },
                ],
            );
            cx.notify();
        });
    });
    draw(cx);

    // Grid view: both personal-space (`p-todo`) and team-space (`p-issues`)
    // folders show their corner Agent stack inside the folder bounds.
    let todo_card = cx.debug_bounds("home-project:cloud:p-todo").unwrap();
    let todo_agents = cx
        .debug_bounds("home-folder-agents:p-todo")
        .expect("personal-space folder shows connected Agent corner badge");
    assert!(todo_card.contains(&todo_agents.center()));

    let issues_card = cx.debug_bounds("home-project:cloud:p-issues").unwrap();
    let issues_agents = cx
        .debug_bounds("home-folder-agents:p-issues")
        .expect("team-space folder shows connected Agent corner badges");
    assert!(issues_card.contains(&issues_agents.center()));

    // List view: both projects show inline Agent badges.
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.change(|p| p.homepage_project_layout = HomepageLayout::List, cx)
        })
    });
    draw(cx);
    assert!(
        cx.debug_bounds("home-row-agents:p-todo").is_some(),
        "personal-space list row shows connected Agent badge"
    );
    assert!(
        cx.debug_bounds("home-row-agents:p-issues").is_some(),
        "team-space list row shows connected Agent badges"
    );
}
