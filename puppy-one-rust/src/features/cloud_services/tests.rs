use super::*;
use crate::cloud_auth::model::ApiRequest;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::sync::Mutex;

type Handler = Box<dyn Fn(&ApiRequest) -> services::Result<Value> + Send + Sync>;
struct Fake(Mutex<Handler>, Mutex<Vec<(String, String)>>);
impl services::Transport for Fake {
    fn request(&self, request: ApiRequest) -> services::Result<Value> {
        self.1
            .lock()
            .unwrap()
            .push((request.method.to_string(), request.path.clone()));
        (self.0.lock().unwrap())(&request)
    }
}
impl Fake {
    fn count(&self, method: &str, path: &str) -> usize {
        let log = self.1.lock().unwrap();
        log.iter().filter(|(m, p)| m == method && p == path).count()
    }
}
fn project(id: &str, capabilities: &[&str]) -> Value {
    json!({"id": id, "name": format!("Project {id}"), "updated_at": "2026-10-01T00:00:00Z",
        "capabilities": capabilities})
}
/// A Project with one active MCP surface and one active CLI surface.
fn cloud(id: &'static str) -> impl Fn(&ApiRequest) -> services::Result<Value> + Send + Sync {
    move |r| {
        let surface = |sid: &str, kind: &str, status: &str| {
            json!({"id": sid, "project_id": id, "kind": kind, "status": status,
                "target": {"kind": "project_root", "project_id": id}})
        };
        Ok(match r.path.as_str() {
            p if p.ends_with("/dashboard/resources") => json!({
                "project": {"id": id, "name": "N"}, "resources": [],
                "nodes": {"total": 2, "folders": 1, "files": 1, "storage_bytes": 2048}}),
            p if p.ends_with("/ls") => json!({"path": "", "entries": [
                {"name": "b.md", "path": "b.md", "type": "file"},
                {"name": "a", "path": "a", "type": "folder"}]}),
            p if p.ends_with("/access/surfaces") => json!([
                surface("m1", "mcp", "active"),
                surface("c1", "cli", "paused")
            ]),
            p if p.ends_with("/scopes") => json!([]),
            p if p.ends_with("/access-point") => {
                json!({"project_id": id, "url": "https://api.test/git/p.git", "scopes": []})
            }
            "/mcp-endpoints" => json!([]),
            p if p.ends_with("/commits") => json!({"project_id": id, "snapshot_id": "a".repeat(64),
                "refs_included": true, "graph_health": "complete", "unreadable_commit_ids": [],
                "has_more": false, "next_cursor": null, "total": 2, "refs": [],
                "head_commit_id": "b".repeat(40), "commits": [
                    {"commit_id": "b".repeat(40), "parent_ids": ["a".repeat(40)], "who": "Ada",
                     "message": "Second", "changes": []},
                    {"commit_id": "a".repeat(40), "parent_ids": [], "who": "Ada",
                     "message": "First", "changes": []}]}),
            p if p.contains("/regenerate-key") => {
                json!({"access_surface_id": "m1", "credential": "pwk_secret"})
            }
            p if p.starts_with("/projects/") && p.matches('/').count() == 2 => {
                project(id, &["project.settings.manage"])
            }
            "/organizations/" => json!([{"id": "org-1", "name": "One"}]),
            p if p.ends_with("/members") => json!([
                {"id": "m", "user_id": "u", "email": "a@b.co", "role": "owner"}]),
            p if p.ends_with("/entitlements") => {
                json!({"org_id": "org-1", "plan_id": "team", "seat_quantity": 5})
            }
            p if p.ends_with("/seat-usage") => json!({"billable_seat_quantity": 2}),
            _ => json!({}),
        })
    }
}
fn open(
    cx: &mut TestAppContext,
    fake: Arc<Fake>,
    section: Section,
) -> (Entity<CloudServices>, &mut VisualTestContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let mut entity = None;
    let (_, cx) = cx.add_window_view(|w, cx| {
        let view = cx.new(|cx| CloudServices::new(w, cx));
        entity = Some(view.clone());
        gpui_kit::base::Root::new(view, w, cx)
    });
    let view = entity.unwrap();
    view.update(cx, |s, cx| {
        s.open_with(Client::new(fake), "p".into(), section, cx)
    });
    (view, cx)
}
fn fake(
    handler: impl Fn(&ApiRequest) -> services::Result<Value> + Send + Sync + 'static,
) -> Arc<Fake> {
    Arc::new(Fake(Mutex::new(Box::new(handler)), Mutex::default()))
}
fn settle(cx: &mut VisualTestContext, what: &str, ready: &dyn Fn(&mut VisualTestContext) -> bool) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !ready(cx) {
        cx.run_until_parked();
        assert!(
            std::time::Instant::now() < deadline,
            "{what} did not settle"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}
fn draw(cx: &mut VisualTestContext) {
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
}

#[gpui::test]
fn the_homepage_counts_ready_access_and_every_page_renders(cx: &mut TestAppContext) {
    let f = fake(cloud("p"));
    let (view, cx) = open(cx, f.clone(), Section::Contents);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    view.read_with(cx, |s, _| {
        let details = s.details.as_ref().unwrap();
        assert!(!details.failed);
        assert_eq!(details.history.as_ref().unwrap().commits.len(), 2);
        let (configured, ready) = access::metrics(&details.rows("p", Catalog::All));
        assert_eq!((configured, ready), (2, 1));
        assert_eq!(format_bytes(2048), "2.0 KB");
    });
    for section in [
        Section::Mcp,
        Section::Cli,
        Section::GitSync,
        Section::Access,
        Section::History,
        Section::Settings,
        Section::Team,
        Section::Contents,
    ] {
        view.update(cx, |s, cx| s.select(section, cx));
        draw(cx);
    }
    // Changing page reads nothing again.
    assert_eq!(f.count("GET", "/projects/p"), 1);
}

#[gpui::test]
fn a_load_replaced_by_another_project_is_dropped(cx: &mut TestAppContext) {
    let f = fake(|r| {
        std::thread::sleep(std::time::Duration::from_millis(40));
        cloud("a")(r)
    });
    let (view, cx) = open(cx, f.clone(), Section::Contents);
    *f.0.lock().unwrap() = Box::new(cloud("b"));
    view.update(cx, |s, cx| {
        s.open_with(Client::new(f.clone()), "b".into(), Section::Contents, cx)
    });
    let loaded = view.clone();
    settle(cx, "the second Project", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    view.read_with(cx, |s, _| {
        assert_eq!(
            s.details.as_ref().unwrap().project.as_ref().unwrap().id,
            "b"
        );
    });
}

#[gpui::test]
fn one_organization_is_chosen_but_several_wait_for_the_user(cx: &mut TestAppContext) {
    let f = fake(|r| {
        if r.path == "/organizations/" {
            return Ok(json!([{"id": "org-1", "name": "One"}, {"id": "org-2", "name": "Two"}]));
        }
        cloud("p")(r)
    });
    let (view, cx) = open(cx, f.clone(), Section::Team);
    let loaded = view.clone();
    settle(cx, "the organizations", &|cx| {
        loaded.read_with(cx, |s, _| !s.team.organizations.is_empty())
    });
    view.read_with(cx, |s, _| assert_eq!(s.team.selected, None));
    assert_eq!(f.count("GET", "/organizations/org-1/members"), 0);
    view.update(cx, |s, cx| s.select_organization("org-1".into(), cx));
    let loaded = view.clone();
    settle(cx, "the members", &|cx| {
        loaded.read_with(cx, |s, _| !s.team.members.is_empty())
    });
    let f = fake(cloud("p"));
    view.update(cx, |s, cx| {
        s.open_with(Client::new(f), "p".into(), Section::Team, cx)
    });
    let loaded = view.clone();
    settle(cx, "the only organization", &|cx| {
        loaded.read_with(cx, |s, _| {
            s.team.selected.is_some() && s.team.seats.is_some()
        })
    });
}

#[gpui::test]
fn a_one_time_key_shows_once_and_closing_forgets_it(cx: &mut TestAppContext) {
    let f = fake(cloud("p"));
    let (view, cx) = open(cx, f.clone(), Section::Mcp);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    view.update(cx, |s, cx| s.regenerate("m1".into(), cx));
    let loaded = view.clone();
    settle(cx, "the credential", &|cx| {
        loaded.read_with(cx, |s, _| s.issued.is_some())
    });
    draw(cx);
    view.update(cx, |s, cx| s.close(cx));
    view.read_with(cx, |s, _| {
        assert!(s.issued.is_none() && s.details.is_none() && s.client.is_none());
    });
}

#[gpui::test]
fn a_failed_mutation_says_so_and_is_not_replayed(cx: &mut TestAppContext) {
    let f = fake(|r| {
        if r.method == reqwest::Method::POST {
            return Err(services::Error::Unknown);
        }
        cloud("p")(r)
    });
    let (view, cx) = open(cx, f.clone(), Section::Mcp);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    view.update(cx, |s, cx| s.set_paused("m1".into(), true, cx));
    let loaded = view.clone();
    settle(cx, "the failure", &|cx| {
        loaded.read_with(cx, |s, _| s.notice.is_some() && !s.busy)
    });
    assert_eq!(f.count("POST", "/projects/p/access/surfaces/m1/pause"), 1);
}

#[gpui::test]
fn one_failed_resource_leaves_the_others_and_offers_retry(cx: &mut TestAppContext) {
    let f = fake(|r| {
        if r.path.ends_with("/commits") {
            return Err(services::Error::Status(503));
        }
        cloud("p")(r)
    });
    let (view, cx) = open(cx, f.clone(), Section::Contents);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    view.read_with(cx, |s, _| {
        let details = s.details.as_ref().unwrap();
        assert!(details.failed && details.history.is_none() && details.dashboard.is_some());
    });
    view.update(cx, |s, cx| s.select(Section::History, cx));
    draw(cx);
    view.update(cx, |s, cx| s.refresh(cx));
    let reads = f.clone();
    settle(cx, "the second read", &|_| {
        reads.count("GET", "/content/p/commits") == 2
    });
}
