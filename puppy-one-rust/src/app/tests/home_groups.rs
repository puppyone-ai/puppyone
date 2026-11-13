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

#[gpui::test]
fn the_homepage_groups_projects_by_the_place_that_holds_them(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    let (_view, cx) = home_with_spaces(cx, &folder);
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
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(Arc::new({
        let spaces = with_spaces(cloud_project_responder());
        move |request| {
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
}
