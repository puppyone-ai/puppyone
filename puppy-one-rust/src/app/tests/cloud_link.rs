//! The app's own link to a Cloud project and one of its hosted Agent
//! conversations (`<scheme>://cloud/projects/{id}?session={id}`).
use super::*;
use crate::cloud::auth::{Error as AuthError, Responder};
use crate::features::cloud::CloudAgentConversation;
use crate::features::workbench::ItemKind;
use core::prelude::v1::test;
use serde_json::json;
use std::sync::{Arc, Mutex};

/// An unstamped test build is the Development channel.
fn link(project: &str, session: Option<&str>) -> String {
    match session {
        Some(session) => {
            format!("puppyone-development://cloud/projects/{project}?session={session}")
        }
        None => format!("puppyone-development://cloud/projects/{project}"),
    }
}

/// A Project id of its own per run: a window keeps the tabs of the Project
/// it shows between runs, so a fixed id would fill its Agent's tabs up.
fn fresh_project() -> String {
    format!("project-{}", uuid::Uuid::new_v4())
}

/// The Cloud: `project` opens, `project-denied` refuses its person, and
/// `sess-1` and `sess-2` are conversations of this person's `project`.
fn responder(seen: Arc<Mutex<Vec<String>>>, project: &str) -> Responder {
    let project = project.to_owned();
    Arc::new(move |request| {
        seen.lock().unwrap().push(request.path.clone());
        let path = request.path.as_str();
        if path.contains("project-denied") {
            return Err(AuthError::Http(403));
        }
        if let Some(session) = request
            .path
            .strip_prefix("/agents/sessions/")
            .and_then(|rest| rest.strip_suffix("/runs"))
        {
            return match session {
                "sess-1" | "sess-2" => Ok(json!({"data": [{
                    "id": format!("run-{session}"), "project_id": project,
                    "agent_id": "agent-1", "session_id": session,
                    "request_id": "req", "prompt": "Tidy the notes", "state": "succeeded",
                    "sequence": 3, "snapshot": {"text": "Done"},
                    "created_at": "2026-11-01T00:00:00Z", "updated_at": "2026-11-01T00:01:00Z"}]})),
                _ => Err(AuthError::Http(404)),
            };
        }
        Ok(if path.ends_with("/repository-context") {
            json!({"code": 0, "data": {
                "target": {"kind": "project_root", "project_id": project},
                "project": {"id": project, "name": "Fixture Cloud",
                            "capabilities": ["content.read", "content.write"]},
                "scope_path": null}})
        } else if path.ends_with("/workbench/files") {
            json!({"entries": [{"name": "cloud.md", "kind": "file", "size": 3}]})
        } else if path.ends_with("/workbench") {
            json!({"workspace": {"id": "workspace-a", "project_id": project,
                "generation": "9bb16f54-dfe9-4d26-8c68-c7b1ae97d859", "state": "running",
                "target_ref": "refs/heads/main"}})
        } else {
            json!({})
        })
    })
}

fn signed_in(
    cx: &mut TestAppContext,
    responder: Responder,
) -> (Entity<Shell>, &mut VisualTestContext, tempfile::TempDir) {
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    // The window leaves its fixture project for the Homepage, where a link
    // opens its project in place.
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(root.clone())))
    });
    settle_cloud(&view, cx, "a local project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(root.as_path())
    });
    command(&view, cx, Command::Home);
    assert!(view.read_with(cx, |s, cx| s.on_home(cx)));
    (view, cx, temp)
}

/// The platform hands a link to the app outside any window's update.
fn open_link(cx: &mut VisualTestContext, url: String) -> bool {
    let claimed = Arc::new(Mutex::new(None));
    let result = claimed.clone();
    cx.update(|_, cx| {
        cx.defer(move |cx| {
            *result.lock().unwrap() = Some(windows::open_launch_urls(vec![url], cx));
        })
    });
    cx.run_until_parked();
    claimed.lock().unwrap().expect("the link was handled")
}

/// The hosted conversation the window's right sidebar shows.
fn shown_session(view: &Entity<Shell>, cx: &mut VisualTestContext) -> Option<String> {
    view.read_with(cx, |s, cx| {
        let chat = s
            .sidebar
            .read(cx)
            .workbench
            .read(cx)
            .active_item_view(ItemKind::Chat)?
            .downcast::<CloudAgentConversation>()
            .ok()?;
        chat.read(cx).chat().snapshot().session_id
    })
}

fn hosted(view: &Entity<Shell>, cx: &mut VisualTestContext, project: &str) -> bool {
    view.read_with(cx, |s, cx| s.hosted_project(cx).as_deref() == Some(project))
}

fn agent_requests(seen: &Arc<Mutex<Vec<String>>>) -> usize {
    seen.lock()
        .unwrap()
        .iter()
        .filter(|p| p.starts_with("/agents/"))
        .count()
}

/// A project that is not open opens as the Homepage opens it, in the window
/// in front (which shows the Homepage), and then shows the conversation.
#[gpui::test]
fn a_link_opens_the_project_and_then_its_conversation(cx: &mut TestAppContext) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let project = fresh_project();
    let (view, cx, _temp) = signed_in(cx, responder(seen.clone(), &project));
    let windows = cx.update(|_, cx| windows::count(cx));
    assert!(open_link(cx, link(&project, Some("sess-1"))));
    settle_cloud(&view, cx, "the project", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some(project.as_str())
    });
    settle_cloud(&view, cx, "the conversation", &|_, _| true);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while shown_session(&view, cx).is_none() {
        assert!(
            std::time::Instant::now() < deadline,
            "the conversation did not open"
        );
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(shown_session(&view, cx).as_deref(), Some("sess-1"));
    assert!(view.read_with(cx, |s, cx| s.right_shows(Surface::Agent, cx)));
    assert_eq!(cx.update(|_, cx| windows::count(cx)), windows);
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.session.project.read(cx).record.pending_agent_session,
            None
        )
    });
}

/// A window that already shows the project comes forward and shows the
/// conversation; no second window opens for it.
#[gpui::test]
fn a_link_to_an_open_project_brings_its_window_forward(cx: &mut TestAppContext) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let project = fresh_project();
    let (first, cx, _temp) = signed_in(cx, responder(seen.clone(), &project));
    first.update_in(cx, |s, w, cx| {
        s.open_cloud_link(project.clone(), None, w, cx)
    });
    settle_cloud(&first, cx, "the project", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some(project.as_str())
    });
    assert_eq!(shown_session(&first, cx), None);
    // Another window comes to the front.
    let mut second = None;
    let (_, second_cx) = cx.add_window_view(|w, cx| {
        let view = cx.new(|cx| Shell::new(w, cx));
        second = Some(view.clone());
        gpui_kit::base::Root::new(view, w, cx)
    });
    let second = second.unwrap();
    second_cx.update(|w, _| w.activate_window());
    let front = |cx: &mut VisualTestContext| {
        cx.update(|_, cx| windows::active(cx).map(|(_, shell)| shell.entity_id()))
    };
    assert_eq!(front(second_cx), Some(second.entity_id()));
    let windows = second_cx.update(|_, cx| windows::count(cx));
    assert!(open_link(second_cx, link(&project, Some("sess-2"))));
    assert_eq!(
        front(second_cx),
        Some(first.entity_id()),
        "the window showing the project came forward"
    );
    assert_eq!(second_cx.update(|_, cx| windows::count(cx)), windows);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while shown_session(&first, second_cx).is_none() {
        assert!(
            std::time::Instant::now() < deadline,
            "the conversation did not open"
        );
        first.update_in(second_cx, |s, w, cx| s.receive(w, cx));
        second_cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(shown_session(&first, second_cx).as_deref(), Some("sess-2"));
    assert!(!hosted(&second, second_cx, &project));
}

/// A conversation that is unknown or not this person's opens the project
/// and nothing else: no tab, no error.
#[gpui::test]
fn a_conversation_that_is_not_theirs_only_opens_the_project(cx: &mut TestAppContext) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let project = fresh_project();
    let (view, cx, _temp) = signed_in(cx, responder(seen.clone(), &project));
    assert!(open_link(cx, link(&project, Some("sess-unknown"))));
    settle_cloud(&view, cx, "the project", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some(project.as_str())
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while !seen
        .lock()
        .unwrap()
        .iter()
        .any(|p| p == "/agents/sessions/sess-unknown/runs")
    {
        assert!(
            std::time::Instant::now() < deadline,
            "the conversation was never asked for"
        );
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    for _ in 0..20 {
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(shown_session(&view, cx), None);
    view.read_with(cx, |s, cx| {
        assert!(
            s.dialog_names(cx).iter().all(|n| !n.starts_with("Error(")),
            "no error: {:?}",
            s.dialog_names(cx)
        )
    });
    // A malformed session is the same as none: nothing is asked of the Cloud.
    let before = agent_requests(&seen);
    assert!(open_link(cx, link(&project, Some("a%2Fb"))));
    draw(cx);
    assert_eq!(agent_requests(&seen), before);
}

/// A project this person cannot open does not open: the ordinary opening
/// says so, and no conversation of it is asked for or shown.
#[gpui::test]
fn a_link_to_a_project_without_access_only_notifies(cx: &mut TestAppContext) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let project = fresh_project();
    let (view, cx, _temp) = signed_in(cx, responder(seen.clone(), &project));
    assert!(open_link(cx, link("project-denied", Some("sess-1"))));
    settle_cloud(&view, cx, "the notice", &|s, cx| {
        s.has_dialog("CloudRecovery", cx)
    });
    view.read_with(cx, |s, cx| {
        let (project, failure) = s.cloud.read(cx).recovery.as_ref().expect("a recovery");
        assert_eq!(project, "project-denied");
        assert_eq!(failure.code, "project-access-denied");
        assert!(s.hosted_project(cx).is_none());
        assert_eq!(
            s.session.project.read(cx).record.pending_agent_session,
            None
        );
    });
    crate::localization::set_current("en");
    assert_eq!(
        crate::localization::t("cloud.message.project-access-denied"),
        "You don’t have access to this project."
    );
    assert_eq!(agent_requests(&seen), 0);
    assert_eq!(shown_session(&view, cx), None);
}

/// Nobody is signed in: the opening's own sign-in notice, nothing opened.
#[gpui::test]
fn a_link_while_signed_out_asks_to_sign_in(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(root.clone())))
    });
    settle_cloud(&view, cx, "a local project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(root.as_path())
    });
    command(&view, cx, Command::Home);
    assert!(open_link(cx, link("project-a", Some("sess-1"))));
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.hosted_project(cx).is_none());
        assert!(
            s.dialog_names(cx)
                .iter()
                .any(|n| n.contains(crate::localization::t(
                    "cloud.message.project-sign-in-required"
                )))
        );
        assert_eq!(
            s.session.project.read(cx).record.pending_agent_session,
            None
        );
    });
    // Other hosts, other schemes and bad ids are not this link.
    assert!(!open_link(cx, "puppyone://cloud/projects/project-a".into()));
    assert!(open_link(
        cx,
        "puppyone-development://cloud/projects/a%2Fb".into()
    ));
}
