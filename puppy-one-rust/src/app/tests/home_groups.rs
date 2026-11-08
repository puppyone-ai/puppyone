//! The Homepage's audience groups (qubits `d21029000`, `80a49d147`,
//! `83322da3d`): projects by who can open them, and a folder dropped on a
//! team's group opening its confirmed publication to that team.
use super::*;
use core::prelude::v1::test;

/// Two spaces and a project in each; everything else as `fallback`.
fn with_spaces(fallback: crate::cloud::auth::Responder) -> crate::cloud::auth::Responder {
    std::sync::Arc::new(move |request| {
        let path = request.path.as_str();
        if path == "/organizations/" {
            return Ok(serde_json::json!({"code": 0, "data": [
                {"id": "me", "name": "Alex", "kind": "personal", "can_create_projects": true},
                {"id": "team-1", "name": "Design", "kind": "team", "can_create_projects": true}]}));
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
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs.store.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            p.state.remember_project(folder, 1);
        });
    });
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
fn the_homepage_groups_projects_by_who_can_open_them(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("Notes");
    std::fs::create_dir(&folder).unwrap();
    let (_view, cx) = home_with_spaces(cx, &folder);
    let team = cx
        .debug_bounds("home-group:team-shared")
        .expect("Team Share Project");
    let personal = cx
        .debug_bounds("home-group:personal-shared")
        .expect("My Share Project");
    let local = cx
        .debug_bounds("home-group:local-only")
        .expect("On this computer");
    assert!(team.origin.y < personal.origin.y && personal.origin.y < local.origin.y);
    // Each project sits in its audience's group.
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
    // While it is dragged, the team takes it and says what letting go does.
    let team = cx.debug_bounds("home-group:team-shared").unwrap();
    let over = point(team.center().x, team.origin.y + px(6.));
    cx.simulate_mouse_move(over, Some(MouseButton::Left), Modifiers::default());
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.home.read(cx).drop_over,
            Some(super::home::groups::GroupId::TeamShared)
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
