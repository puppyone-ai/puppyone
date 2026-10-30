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
            p if p.starts_with("/projects/") && p.matches('/').count() == 2 => {
                project(id, &["project.settings.manage", "access_surface.manage"])
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
fn creating_an_mcp_endpoint_shows_its_key_once_and_closing_forgets_it(cx: &mut TestAppContext) {
    let f = fake(|r| {
        if r.path == "/mcp-endpoints" && r.method == reqwest::Method::POST {
            return Ok(
                json!({"id": "m1", "project_id": "p", "name": "MCP Server", "api_key": "pwk_once"}),
            );
        }
        cloud("p")(r)
    });
    let (view, cx) = open(cx, f.clone(), Section::Mcp);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    view.update(cx, |s, cx| {
        let root = access::views("p", &[])[0].clone();
        s.create_mcp(root, cx)
    });
    let loaded = view.clone();
    settle(cx, "the key", &|cx| {
        loaded.read_with(cx, |s, _| s.issued.is_some() && !s.busy)
    });
    draw(cx);
    assert_eq!(f.count("POST", "/mcp-endpoints"), 1);
    view.update(cx, |s, cx| s.close(cx));
    view.read_with(cx, |s, _| {
        assert!(s.issued.is_none() && s.details.is_none() && s.client.is_none());
    });
}

#[gpui::test]
fn a_failed_mutation_says_so_and_is_not_replayed(cx: &mut TestAppContext) {
    let f = fake(|r| {
        if r.method == reqwest::Method::DELETE {
            return Err(services::Error::Unknown);
        }
        cloud("p")(r)
    });
    let (view, cx) = open(cx, f.clone(), Section::Access);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    view.update(cx, |s, cx| s.delete_scope("s1".into(), cx));
    let loaded = view.clone();
    settle(cx, "the failure", &|cx| {
        loaded.read_with(cx, |s, _| s.notice.is_some() && !s.busy)
    });
    assert_eq!(f.count("DELETE", "/projects/p/scopes/s1"), 1);
}

#[gpui::test]
fn create_access_reads_folders_on_demand_and_refuses_a_path_with_access(cx: &mut TestAppContext) {
    let f = fake(|r| {
        if r.path.ends_with("/ls") {
            let at = r
                .query
                .iter()
                .find(|(k, _)| k == "path")
                .map_or("", |(_, v)| v.as_str());
            let child = if at.is_empty() {
                "docs".to_owned()
            } else {
                format!("{at}/deep")
            };
            return Ok(json!({"path": at, "entries": [
                {"name": "x", "path": child, "type": "folder"},
                {"name": "f.md", "path": "f.md", "type": "file"}]}));
        }
        if r.path.ends_with("/scopes") && r.method == reqwest::Method::GET {
            return Ok(
                json!([{"id": "s1", "project_id": "p", "name": "Taken", "path": "/taken/",
                "max_mode": "r"}]),
            );
        }
        if r.path.ends_with("/scopes") {
            return Ok(
                json!({"id": "s2", "project_id": "p", "name": "docs", "path": "docs",
                "max_mode": "r"}),
            );
        }
        cloud("p")(r)
    });
    let (view, cx) = open(cx, f.clone(), Section::Access);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    view.update(cx, |s, cx| s.begin_create(cx));
    let loaded = view.clone();
    settle(cx, "the root folders", &|cx| {
        loaded.read_with(cx, |s, _| {
            s.creating.as_ref().is_some_and(|c| c.folders == ["docs"])
        })
    });
    draw(cx);
    view.update(cx, |s, cx| s.read_folder("docs".into(), cx));
    let loaded = view.clone();
    settle(cx, "the subfolder", &|cx| {
        loaded.read_with(cx, |s, _| {
            s.creating
                .as_ref()
                .is_some_and(|c| c.folders == ["docs/deep"])
        })
    });
    // A path with access already is refused without a request.
    view.update(cx, |s, cx| {
        s.choose_path("taken".into(), cx);
        s.create_access(cx);
        assert!(s.creating.is_some() && s.notice.is_some());
    });
    assert_eq!(f.count("POST", "/projects/p/scopes"), 0);
    view.update(cx, |s, cx| {
        s.choose_path("docs".into(), cx);
        assert_eq!(s.scope_name.read(cx).text(), "docs");
        s.create_access(cx);
    });
    let reads = f.clone();
    settle(cx, "the Scope", &|_| {
        reads.count("POST", "/projects/p/scopes") == 1
    });
}

type Sent = Arc<Mutex<Vec<Value>>>;
/// `cloud`, with a configured CLI, a tool-limited endpoint and a Scope; every
/// change's body is kept, and `refused` answers it with a failure instead.
fn configured(
    sent: Sent,
    refused: bool,
    capabilities: &'static [&'static str],
) -> impl Fn(&ApiRequest) -> services::Result<Value> + Send + Sync {
    let base = cloud("p");
    move |r| {
        let scope = json!({"id": "s1", "project_id": "p", "name": "Docs", "path": "docs",
            "max_mode": "rw", "exclude": ["dist"]});
        if r.method != reqwest::Method::GET {
            sent.lock()
                .unwrap()
                .push(r.body.clone().unwrap_or_default());
            if refused {
                return Err(services::Error::Status(500));
            }
            return Ok(
                if r.method == reqwest::Method::PATCH && r.path.contains("/scopes/") {
                    scope
                } else if r.method == reqwest::Method::PATCH {
                    json!({"id": "c1", "project_id": "p", "kind": "cli",
                    "target": {"kind": "project_root", "project_id": "p"}})
                } else {
                    json!({"id": "m1", "project_id": "p", "name": "MCP Server"})
                },
            );
        }
        match r.path.as_str() {
            p if p.ends_with("/access/surfaces") => Ok(json!([
                {"id": "m1", "project_id": "p", "kind": "mcp", "status": "active",
                 "target": {"kind": "project_root", "project_id": "p"}},
                {"id": "c1", "project_id": "p", "kind": "cli", "status": "active",
                 "config": {"profile": "ops", "command_permissions": {"allowed": ["ls", "cat"]}},
                 "target": {"kind": "project_root", "project_id": "p"}}])),
            "/mcp-endpoints" => Ok(json!([{"id": "m1", "project_id": "p", "name": "MCP Server",
                "tools_config": {"filesystem": {"allowed": ["fs_ls"]},
                    "bound_tools": [{"tool_id": "t"}]}}])),
            p if p.ends_with("/scopes") => Ok(json!([scope])),
            p if p.starts_with("/projects/") && p.matches('/').count() == 2 => {
                Ok(project("p", capabilities))
            }
            _ => base(r),
        }
    }
}
fn point(view: &Entity<CloudServices>, cx: &VisualTestContext, id: &str) -> access::Point {
    view.read_with(cx, |s, _| {
        s.details.as_ref().unwrap().rows("p", Catalog::All)
    })
    .into_iter()
    .find(|p| p.id.ends_with(id) && p.surface.is_some())
    .unwrap_or_else(|| panic!("no point {id}"))
}
const MANAGER: &[&str] = &["access_surface.manage"];

#[gpui::test]
fn a_permission_change_goes_back_with_the_rest_of_its_record(cx: &mut TestAppContext) {
    let sent = Sent::default();
    let f = fake(configured(sent.clone(), false, MANAGER));
    let (view, cx) = open(cx, f.clone(), Section::Access);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    let cli = point(&view, cx, "cli:p");
    assert_eq!(cli.surface.as_deref(), Some("c1"));
    view.update(cx, |s, cx| {
        s.expanded = Some(cli.id.clone());
        s.set_permissions(&cli, &["ls"].into_iter().collect(), cx)
    });
    draw(cx);
    let idle = view.clone();
    settle(cx, "the CLI change", &|cx| {
        idle.read_with(cx, |s, _| !s.busy && !s.loading)
    });
    assert_eq!(f.count("PATCH", "/projects/p/access/surfaces/c1"), 1);
    assert_eq!(
        sent.lock().unwrap().as_slice(),
        [json!({"config": {"profile": "ops", "command_permissions": {"allowed": ["ls"]}}})]
    );
    sent.lock().unwrap().clear();

    let mcp = point(&view, cx, "m1");
    view.update(cx, |s, cx| {
        s.set_permissions(&mcp, &["fs_cat"].into_iter().collect(), cx)
    });
    let idle = view.clone();
    settle(cx, "the MCP change", &|cx| {
        idle.read_with(cx, |s, _| !s.busy && !s.loading)
    });
    assert_eq!(f.count("PUT", "/mcp-endpoints/m1"), 1);
    assert_eq!(
        sent.lock().unwrap().as_slice(),
        [
            json!({"tools_config": {"version": 1, "filesystem": {"allowed": ["fs_cat"]},
            "shell": {"enabled": false}, "custom_tools": [{"tool_id": "t"}]}})
        ]
    );
}

#[gpui::test]
fn without_the_capability_access_can_be_read_but_not_changed(cx: &mut TestAppContext) {
    let sent = Sent::default();
    let f = fake(configured(
        sent.clone(),
        false,
        &["project.settings.manage"],
    ));
    let (view, cx) = open(cx, f.clone(), Section::Access);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    let mcp = point(&view, cx, "m1");
    view.update(cx, |s, cx| {
        s.expanded = Some(mcp.id.clone());
        s.begin_create(cx);
        s.set_permissions(&mcp, &["fs_cat"].into_iter().collect(), cx);
        s.create_mcp(access::views("p", &[])[0].clone(), cx);
        s.delete_scope("s1".into(), cx);
        s.scope_edit = Some(("s1".into(), "r"));
        let scope = s.details.as_ref().unwrap().scopes[0].clone();
        s.save_scope(scope, cx);
    });
    draw(cx);
    cx.run_until_parked();
    view.read_with(cx, |s, _| {
        assert!(s.creating.is_none() && !s.busy);
    });
    assert!(sent.lock().unwrap().is_empty());
}

#[gpui::test]
fn scope_settings_save_together_and_a_refusal_keeps_the_draft(cx: &mut TestAppContext) {
    let sent = Sent::default();
    let f = fake(configured(sent.clone(), true, MANAGER));
    let (view, cx) = open(cx, f.clone(), Section::Access);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    let scope = view.read_with(cx, |s, _| s.details.as_ref().unwrap().scopes[0].clone());
    assert_eq!(scope.exclude, ["dist"]);
    view.update(cx, |s, cx| s.toggle_scope_settings(&scope, cx));
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(!s.scope_dirty(&scope, cx), "a form just opened is clean");
    });
    view.update(cx, |s, cx| {
        s.scope_edit_name
            .update(cx, |i, cx| i.set_text(" Guides ", cx));
        s.scope_exclude
            .update(cx, |i, cx| i.set_text("dist\n\n .cache \n", cx));
        s.scope_edit.as_mut().unwrap().1 = "r";
    });
    draw(cx);
    view.read_with(cx, |s, cx| assert!(s.scope_dirty(&scope, cx)));

    // Discarding comes back to what the server holds.
    view.update(cx, |s, cx| s.fill_scope_form(&scope, cx));
    view.read_with(cx, |s, cx| assert!(!s.scope_dirty(&scope, cx)));
    view.update(cx, |s, cx| {
        s.scope_edit_name
            .update(cx, |i, cx| i.set_text(" Guides ", cx));
        s.scope_exclude
            .update(cx, |i, cx| i.set_text("dist\n\n .cache \n", cx));
        s.scope_edit.as_mut().unwrap().1 = "r";
        s.save_scope(scope.clone(), cx);
    });
    let idle = view.clone();
    settle(cx, "the refusal", &|cx| idle.read_with(cx, |s, _| !s.busy));
    assert_eq!(
        sent.lock().unwrap().as_slice(),
        [json!({"name": "Guides", "max_mode": "r", "exclude": ["dist", ".cache"]})]
    );
    view.read_with(cx, |s, cx| {
        assert!(s.notice.is_some(), "a refusal is reported");
        assert!(s.scope_dirty(&scope, cx), "and the draft is still there");
    });
    assert_eq!(
        f.count("PATCH", "/projects/p/scopes/s1"),
        1,
        "never replayed"
    );
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

fn shared_cloud(
    r: &ApiRequest,
    created: &std::sync::atomic::AtomicUsize,
) -> services::Result<Value> {
    use std::sync::atomic::Ordering;
    match r.path.as_str() {
        "/mcp-endpoints" if r.method == reqwest::Method::POST => {
            created.fetch_add(1, Ordering::SeqCst);
            let body = r.body.clone().unwrap();
            Ok(
                json!({"id": "e1", "project_id": "p", "name": body["name"], "api_key": "pwk_once",
                "status": "active", "path": body["path"], "accesses": body["accesses"]}),
            )
        }
        "/mcp-endpoints" if created.load(Ordering::SeqCst) > 0 => Ok(json!([
            {"id": "e1", "project_id": "p", "name": "Claude", "status": "active", "path": "",
             "created_at": "2026-10-01T00:00:00Z",
             "accesses": [{"path": "", "readonly": true}]}])),
        _ => cloud("p")(r),
    }
}

#[gpui::test]
fn a_share_issues_one_key_and_the_same_share_is_reused_without_another(cx: &mut TestAppContext) {
    let created = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = created.clone();
    let f = fake(move |r| shared_cloud(r, &counter));
    let (view, cx) = open(cx, f.clone(), Section::Share);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    draw(cx);
    let claude = share::TARGETS[2];
    view.update(cx, |s, cx| {
        s.begin_share(claude, cx);
        s.issue_share(cx);
    });
    let loaded = view.clone();
    settle(cx, "the issued key", &|cx| {
        loaded.read_with(cx, |s, _| {
            matches!(
                s.share_flow.as_ref().map(|f| &f.phase),
                Some(SharePhase::Ready { key: Some(_), .. })
            )
        })
    });
    draw(cx);
    let loaded = view.clone();
    settle(cx, "the new share in the list", &|cx| {
        loaded.read_with(cx, |s, _| !s.share_rows().is_empty() && !s.loading)
    });
    // Asking again reuses the endpoint: nothing created, no key to show.
    view.update(cx, |s, cx| {
        s.begin_share(claude, cx);
        s.issue_share(cx);
        assert!(matches!(
            s.share_flow.as_ref().map(|f| &f.phase),
            Some(SharePhase::Ready {
                key: None,
                reused: true,
                ..
            })
        ));
    });
    draw(cx);
    assert_eq!(f.count("POST", "/mcp-endpoints"), 1);
}

#[gpui::test]
fn a_link_target_never_creates_a_key(cx: &mut TestAppContext) {
    let f = fake(cloud("p"));
    let (view, cx) = open(cx, f.clone(), Section::Share);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    let person = share::TARGETS
        .iter()
        .copied()
        .find(|t| t.id == "person")
        .unwrap();
    view.update(cx, |s, cx| {
        s.begin_share(person, cx);
        s.issue_share(cx);
        assert!(matches!(
            s.share_flow.as_ref().map(|f| &f.phase),
            Some(SharePhase::Ready {
                key: None,
                endpoint: None,
                ..
            })
        ));
    });
    draw(cx);
    assert_eq!(f.count("POST", "/mcp-endpoints"), 0);
}

#[gpui::test]
fn a_folder_share_makes_its_scope_first_and_a_failure_offers_retry(cx: &mut TestAppContext) {
    let f = fake(|r| {
        if r.path == "/mcp-endpoints" && r.method == reqwest::Method::POST {
            return Err(services::Error::Status(503));
        }
        if r.path.ends_with("/scopes") && r.method == reqwest::Method::POST {
            return Ok(
                json!({"id": "s", "project_id": "p", "name": "docs", "path": "docs", "max_mode": "r"}),
            );
        }
        cloud("p")(r)
    });
    let (view, cx) = open(cx, f.clone(), Section::Share);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    view.update(cx, |s, cx| {
        s.begin_share(share::TARGETS[0], cx);
        s.share_flow.as_mut().unwrap().path = "docs".into();
        s.issue_share(cx);
    });
    let loaded = view.clone();
    settle(cx, "the failure", &|cx| {
        loaded.read_with(cx, |s, _| {
            matches!(
                s.share_flow.as_ref().map(|f| &f.phase),
                Some(SharePhase::Failed)
            )
        })
    });
    draw(cx);
    assert_eq!(f.count("POST", "/projects/p/scopes"), 1);
}

#[gpui::test]
fn stopping_a_share_deletes_its_endpoint_and_a_failure_changes_nothing(cx: &mut TestAppContext) {
    let created = Arc::new(std::sync::atomic::AtomicUsize::new(1));
    let counter = created.clone();
    let f = fake(move |r| {
        if r.method == reqwest::Method::DELETE {
            return Err(services::Error::Status(503));
        }
        shared_cloud(r, &counter)
    });
    let (view, cx) = open(cx, f.clone(), Section::Share);
    let loaded = view.clone();
    settle(cx, "the reader", &|cx| {
        loaded.read_with(cx, |s, _| !s.share_rows().is_empty())
    });
    draw(cx);
    view.update(cx, |s, cx| {
        s.confirm_delete = Some("e1".into());
        s.stop_share("e1".into(), cx);
    });
    let loaded = view.clone();
    settle(cx, "the failure", &|cx| {
        loaded.read_with(cx, |s, _| s.stop_failed && !s.busy)
    });
    draw(cx);
    view.read_with(cx, |s, _| assert_eq!(s.share_rows().len(), 1));
    assert_eq!(f.count("DELETE", "/mcp-endpoints/e1"), 1);
}

/// A shared Project whose answers the test steers.
#[derive(Default)]
struct Awaited {
    created: std::sync::atomic::AtomicUsize,
    /// `e1` has been read.
    read: std::sync::atomic::AtomicBool,
    /// The share list fails.
    down: std::sync::atomic::AtomicBool,
    /// `e1` no longer exists.
    gone: std::sync::atomic::AtomicBool,
}
fn awaited_cloud(state: Arc<Awaited>) -> Arc<Fake> {
    use std::sync::atomic::Ordering::SeqCst;
    fake(move |r| {
        let list = r.path == "/mcp-endpoints" && r.method == reqwest::Method::GET;
        if list && state.down.load(SeqCst) {
            return Err(services::Error::Status(503));
        }
        if list && state.gone.load(SeqCst) {
            return Ok(json!([]));
        }
        if r.method == reqwest::Method::DELETE {
            state.gone.store(true, SeqCst);
            return Ok(json!({}));
        }
        if state.read.load(SeqCst) && r.path.ends_with("/dashboard/resources") {
            let at = chrono::Utc::now() + chrono::TimeDelta::minutes(1);
            return Ok(json!({"project": {"id": "p", "name": "N"},
                "resources": [{"resource_kind": "access", "kind": "mcp", "project_id": "p",
                    "resource_id": "e1", "last_activity_at": at.to_rfc3339()}],
                "nodes": {"total": 2, "folders": 1, "files": 1, "storage_bytes": 2048}}));
        }
        shared_cloud(r, &state.created)
    })
}
/// A share just issued and handed over: its wizard closed, nothing read yet.
fn awaiting(
    cx: &mut TestAppContext,
    state: Arc<Awaited>,
) -> (Entity<CloudServices>, &mut VisualTestContext, Arc<Fake>) {
    let f = awaited_cloud(state);
    let (view, cx) = open(cx, f.clone(), Section::Share);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    view.update(cx, |s, cx| {
        s.begin_share(share::TARGETS[2], cx);
        s.issue_share(cx);
    });
    let loaded = view.clone();
    settle(cx, "the issued share in the list", &|cx| {
        loaded.read_with(cx, |s, _| {
            !s.loading
                && !s.share_rows().is_empty()
                && matches!(
                    s.share_flow.as_ref().map(|f| &f.phase),
                    Some(SharePhase::Ready { key: Some(_), .. })
                )
        })
    });
    view.update(cx, |s, cx| s.finish_share(cx));
    (view, cx, f)
}
fn status_of(view: &Entity<CloudServices>, cx: &mut VisualTestContext) -> share::Status {
    view.read_with(cx, |s, _| share::status(&s.share_rows(), s.awaited()))
}
fn is_waiting(view: &Entity<CloudServices>, cx: &mut VisualTestContext) -> bool {
    view.read_with(cx, |s, _| s.pending_share.is_some())
}

#[gpui::test]
fn a_share_stays_awaited_after_its_wizard_closes_until_it_is_read(cx: &mut TestAppContext) {
    let state = Arc::<Awaited>::default();
    let (view, cx, _f) = awaiting(cx, state.clone());
    assert_eq!(status_of(&view, cx), share::Status::Waiting);
    draw(cx);
    state.read.store(true, std::sync::atomic::Ordering::SeqCst);
    view.update(cx, |s, cx| s.reload_shares(cx));
    let loaded = view.clone();
    settle(cx, "the first read", &|cx| !is_waiting(&loaded, cx));
    assert_eq!(status_of(&view, cx), share::Status::Shared);
    draw(cx);
}

/// `pollIntervalMs`: every five seconds, and not one read after the end.
#[gpui::test]
fn the_wait_rereads_on_its_interval_and_stops_with_the_wait(cx: &mut TestAppContext) {
    let state = Arc::<Awaited>::default();
    let (view, cx, f) = awaiting(cx, state.clone());
    let lists = f.count("GET", "/mcp-endpoints");
    let project_reads = f.count("GET", "/projects/p");
    cx.executor().advance_clock(RECEIPT_POLL);
    cx.run_until_parked();
    assert_eq!(f.count("GET", "/mcp-endpoints"), lists + 1);
    // Only the shares: a whole refresh would redo every page's read.
    assert_eq!(f.count("GET", "/projects/p"), project_reads);
    state.read.store(true, std::sync::atomic::Ordering::SeqCst);
    cx.executor().advance_clock(RECEIPT_POLL);
    cx.run_until_parked();
    assert!(!is_waiting(&view, cx));
    let ended = f.count("GET", "/mcp-endpoints");
    cx.executor().advance_clock(RECEIPT_POLL * 4);
    cx.run_until_parked();
    assert_eq!(f.count("GET", "/mcp-endpoints"), ended);
}

/// One bad answer is not an answer: neither the reread nor a whole refresh
/// may empty the list or end the wait. A real answer still does.
#[gpui::test]
fn a_failed_reread_keeps_the_list_and_the_wait(cx: &mut TestAppContext) {
    use std::sync::atomic::Ordering::SeqCst;
    let state = Arc::<Awaited>::default();
    let (view, cx, _f) = awaiting(cx, state.clone());
    state.down.store(true, SeqCst);
    view.update(cx, |s, cx| s.reload_shares(cx));
    cx.run_until_parked();
    view.update(cx, |s, cx| s.refresh(cx));
    let loaded = view.clone();
    settle(cx, "the failed refresh", &|cx| {
        loaded.read_with(cx, |s, _| !s.loading)
    });
    view.read_with(cx, |s, _| {
        assert!(s.details.as_ref().unwrap().failed);
        assert_eq!(s.share_rows().len(), 1);
    });
    assert!(is_waiting(&view, cx));
    assert_eq!(status_of(&view, cx), share::Status::Waiting);
    state.down.store(false, SeqCst);
    state.gone.store(true, SeqCst);
    view.update(cx, |s, cx| s.reload_shares(cx));
    let loaded = view.clone();
    settle(cx, "the real answer", &|cx| !is_waiting(&loaded, cx));
    assert_eq!(status_of(&view, cx), share::Status::Published);
}

/// The reread runs for minutes behind whatever the user went on to do.
#[gpui::test]
fn a_wait_rereads_only_the_shares_and_leaves_the_page_being_edited(cx: &mut TestAppContext) {
    let state = Arc::<Awaited>::default();
    let (view, cx, f) = awaiting(cx, state);
    view.update(cx, |s, cx| {
        s.select(Section::Settings, cx);
        s.name.update(cx, |i, cx| i.set_text("Edited", cx));
    });
    let epoch = view.read_with(cx, |s, _| s.epoch);
    let project_reads = f.count("GET", "/projects/p");
    let lists = f.count("GET", "/mcp-endpoints");
    view.update(cx, |s, cx| s.reload_shares(cx));
    cx.run_until_parked();
    assert_eq!(f.count("GET", "/mcp-endpoints"), lists + 1);
    assert_eq!(f.count("GET", "/projects/p"), project_reads);
    view.read_with(cx, |s, cx| {
        assert_eq!(s.name.read(cx).text(), "Edited");
        // A delete or a save in flight compares this; the reread leaves it.
        assert_eq!(s.epoch, epoch);
    });
}

#[gpui::test]
fn a_wait_survives_the_dialog_but_not_its_project(cx: &mut TestAppContext) {
    let state = Arc::<Awaited>::default();
    let (view, cx, f) = awaiting(cx, state);
    view.update(cx, |s, cx| s.close(cx));
    assert!(is_waiting(&view, cx));
    let again = f.clone();
    view.update(cx, |s, cx| {
        s.open_with(Client::new(again), "p".into(), Section::Share, cx)
    });
    let loaded = view.clone();
    settle(cx, "the reopened details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some() && !s.loading)
    });
    assert!(is_waiting(&view, cx));
    view.update(cx, |s, cx| s.close(cx));
    view.update(cx, |s, cx| {
        s.open_with(Client::new(f), "q".into(), Section::Share, cx)
    });
    assert!(!is_waiting(&view, cx));
}

/// Opening starts from nothing, so a failed read there has an empty list to
/// show. That says nothing about the share; only a real answer ends a wait.
#[gpui::test]
fn a_failed_read_on_reopening_does_not_end_the_wait(cx: &mut TestAppContext) {
    use std::sync::atomic::Ordering::SeqCst;
    let state = Arc::<Awaited>::default();
    let (view, cx, f) = awaiting(cx, state.clone());
    view.update(cx, |s, cx| s.close(cx));
    state.down.store(true, SeqCst);
    let again = f.clone();
    view.update(cx, |s, cx| {
        s.open_with(Client::new(again), "p".into(), Section::Share, cx)
    });
    let loaded = view.clone();
    settle(cx, "the failed read", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some() && !s.loading)
    });
    view.read_with(cx, |s, _| assert!(s.share_rows().is_empty()));
    assert!(is_waiting(&view, cx));
    state.down.store(false, SeqCst);
    view.update(cx, |s, cx| s.reload_shares(cx));
    cx.run_until_parked();
    assert_eq!(status_of(&view, cx), share::Status::Waiting);
}

/// `onIssued` carries the share's own creation time when it is reused.
#[gpui::test]
fn a_share_issued_long_ago_is_not_awaited_again(cx: &mut TestAppContext) {
    let state = Arc::<Awaited>::default();
    state.created.store(1, std::sync::atomic::Ordering::SeqCst);
    let f = awaited_cloud(state);
    let (view, cx) = open(cx, f, Section::Share);
    let loaded = view.clone();
    settle(cx, "the reader", &|cx| {
        loaded.read_with(cx, |s, _| !s.share_rows().is_empty())
    });
    view.update(cx, |s, cx| {
        s.begin_share(share::TARGETS[2], cx);
        s.issue_share(cx);
    });
    view.read_with(cx, |s, _| {
        assert!(matches!(
            s.share_flow.as_ref().map(|f| &f.phase),
            Some(SharePhase::Ready { reused: true, .. })
        ))
    });
    assert!(!is_waiting(&view, cx));
}

#[gpui::test]
fn revoking_the_awaited_share_ends_the_wait(cx: &mut TestAppContext) {
    let state = Arc::<Awaited>::default();
    let (view, cx, f) = awaiting(cx, state);
    view.update(cx, |s, cx| {
        s.share_readers = true;
        cx.notify();
    });
    draw(cx);
    view.update(cx, |s, cx| {
        s.confirm_delete = Some("e1".into());
        cx.notify();
    });
    draw(cx);
    view.update(cx, |s, cx| s.stop_share("e1".into(), cx));
    let loaded = view.clone();
    settle(cx, "the ended wait", &|cx| !is_waiting(&loaded, cx));
    assert_eq!(status_of(&view, cx), share::Status::Published);
    draw(cx);
    assert_eq!(f.count("DELETE", "/mcp-endpoints/e1"), 1);
}

#[gpui::test]
fn turning_sharing_off_ends_the_wait_and_leaves_the_section(cx: &mut TestAppContext) {
    let state = Arc::<Awaited>::default();
    let (view, cx, _f) = awaiting(cx, state);
    view.update(cx, |s, cx| s.sync_sharing(true, cx));
    assert!(is_waiting(&view, cx));
    view.read_with(cx, |s, _| assert_eq!(s.section, Section::Share));
    view.update(cx, |s, cx| s.sync_sharing(false, cx));
    assert!(!is_waiting(&view, cx));
    view.read_with(cx, |s, _| assert_eq!(s.section, Section::Contents));
}

/// `openShareWizard(null, path)`: past the readers, and from that folder.
#[gpui::test]
fn a_folder_from_the_explorer_starts_the_share_there(cx: &mut TestAppContext) {
    let state = Arc::<Awaited>::default();
    state.created.store(1, std::sync::atomic::Ordering::SeqCst);
    let (view, cx) = open(cx, awaited_cloud(state), Section::Share);
    let loaded = view.clone();
    settle(cx, "the reader", &|cx| {
        loaded.read_with(cx, |s, _| !s.share_rows().is_empty())
    });
    view.update(cx, |s, cx| s.start_from("a/deep".into(), cx));
    draw(cx);
    view.read_with(cx, |s, _| {
        assert!(!s.share_readers);
        let details = s.details.as_ref().unwrap();
        // Deeper than the top level: it leads the list instead of vanishing.
        assert_eq!(scope_folders(details, "a/deep"), ["a/deep", "a"]);
        assert_eq!(scope_folders(details, "a"), ["a"]);
        assert_eq!(scope_folders(details, ""), ["a"]);
    });
    view.update(cx, |s, cx| s.begin_share(share::TARGETS[2], cx));
    draw(cx);
    view.read_with(cx, |s, _| {
        assert_eq!(s.share_flow.as_ref().unwrap().path, "a/deep")
    });
    // Done ends that task: the next share is of the whole Project again.
    view.update(cx, |s, cx| {
        s.finish_share(cx);
        s.begin_share(share::TARGETS[2], cx);
    });
    view.read_with(cx, |s, _| {
        assert_eq!(s.share_flow.as_ref().unwrap().path, "")
    });
}

fn watch_resumes(
    view: &Entity<CloudServices>,
    cx: &mut VisualTestContext,
) -> Arc<std::sync::atomic::AtomicUsize> {
    let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let seen = count.clone();
    let view = view.clone();
    cx.update(|_, cx| {
        cx.subscribe(&view, move |_, _: &ResumePublication, _| {
            seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        })
        .detach()
    });
    count
}
fn phase_of(view: &Entity<CloudServices>, cx: &mut VisualTestContext) -> SharePhase {
    view.read_with(cx, |s, _| s.share_flow.as_ref().unwrap().phase.clone())
}
/// A wizard past its scope step, with the first publication stopped.
fn share_held_back(
    cx: &mut TestAppContext,
    publication: Publication,
) -> (Entity<CloudServices>, &mut VisualTestContext, Arc<Fake>) {
    let state = Arc::<Awaited>::default();
    let f = awaited_cloud(state);
    let (view, cx) = open(cx, f.clone(), Section::Share);
    let loaded = view.clone();
    settle(cx, "the details", &|cx| {
        loaded.read_with(cx, |s, _| s.details.is_some())
    });
    view.update(cx, |s, cx| {
        s.sync_publication(publication, None, cx);
        s.begin_share(share::TARGETS[2], cx);
    });
    (view, cx, f)
}

/// `publishPending`: the Project exists, its content has not arrived. The
/// Agent gets nothing until the push finished.
#[gpui::test]
fn a_share_finishes_the_first_publication_before_it_issues_anything(cx: &mut TestAppContext) {
    use std::sync::atomic::Ordering::SeqCst;
    let (view, cx, f) = share_held_back(cx, Publication::Pending);
    let resumes = watch_resumes(&view, cx);
    view.update(cx, |s, cx| s.issue_share(cx));
    cx.run_until_parked();
    assert!(matches!(phase_of(&view, cx), SharePhase::Publishing));
    draw(cx);
    assert_eq!(resumes.load(SeqCst), 1);
    assert_eq!(f.count("POST", "/mcp-endpoints"), 0);
    view.update(cx, |s, cx| s.sync_publication(Publication::Busy, None, cx));
    assert!(matches!(phase_of(&view, cx), SharePhase::Publishing));
    assert_eq!(f.count("POST", "/mcp-endpoints"), 0);
    view.update(cx, |s, cx| s.sync_publication(Publication::Clear, None, cx));
    let loaded = view.clone();
    settle(cx, "the issued key", &|cx| {
        loaded.read_with(cx, |s, _| {
            matches!(
                s.share_flow.as_ref().map(|f| &f.phase),
                Some(SharePhase::Ready { key: Some(_), .. })
            )
        })
    });
    assert_eq!(f.count("POST", "/mcp-endpoints"), 1);
    assert_eq!(resumes.load(SeqCst), 1);
}

/// A link is a promise of content too.
#[gpui::test]
fn a_link_waits_for_the_first_publication_as_well(cx: &mut TestAppContext) {
    let (view, cx, _f) = share_held_back(cx, Publication::Pending);
    let person = share::TARGETS.iter().copied().find(|t| t.id == "person");
    view.update(cx, |s, cx| {
        s.begin_share(person.unwrap(), cx);
        s.issue_share(cx);
    });
    assert!(matches!(phase_of(&view, cx), SharePhase::Publishing));
}

#[gpui::test]
fn a_run_that_stops_fails_the_share_and_retry_asks_again(cx: &mut TestAppContext) {
    use std::sync::atomic::Ordering::SeqCst;
    let (view, cx, f) = share_held_back(cx, Publication::Pending);
    let resumes = watch_resumes(&view, cx);
    view.update(cx, |s, cx| s.issue_share(cx));
    view.update(cx, |s, cx| s.sync_publication(Publication::Busy, None, cx));
    view.update(cx, |s, cx| {
        s.sync_publication(Publication::Pending, Some("No space left".into()), cx)
    });
    assert!(matches!(phase_of(&view, cx), SharePhase::Failed));
    view.read_with(cx, |s, _| {
        assert_eq!(s.publish_failure.as_deref(), Some("No space left"))
    });
    draw(cx);
    assert_eq!(f.count("POST", "/mcp-endpoints"), 0);
    view.update(cx, |s, cx| s.retry_share(cx));
    cx.run_until_parked();
    assert!(matches!(phase_of(&view, cx), SharePhase::Publishing));
    assert_eq!(resumes.load(SeqCst), 2);
}

/// Retry forgets the request that failed: a run started elsewhere since then
/// is not this share's, so its stopping is not this share's failure.
#[gpui::test]
fn retry_forgets_the_request_that_failed(cx: &mut TestAppContext) {
    use std::sync::atomic::Ordering::SeqCst;
    let (view, cx, _f) = share_held_back(cx, Publication::Pending);
    let resumes = watch_resumes(&view, cx);
    view.update(cx, |s, cx| s.issue_share(cx));
    view.update(cx, |s, cx| s.sync_publication(Publication::Busy, None, cx));
    view.update(cx, |s, cx| {
        s.sync_publication(Publication::Pending, None, cx)
    });
    assert!(matches!(phase_of(&view, cx), SharePhase::Failed));
    view.update(cx, |s, cx| s.sync_publication(Publication::Busy, None, cx));
    view.update(cx, |s, cx| s.retry_share(cx));
    view.update(cx, |s, cx| {
        s.sync_publication(Publication::Pending, None, cx)
    });
    cx.run_until_parked();
    assert!(matches!(phase_of(&view, cx), SharePhase::Publishing));
    assert_eq!(resumes.load(SeqCst), 2);
}

/// Someone else's run is waited for, not started again; when it stops, this
/// share asks for itself instead of inheriting a failure it never saw.
#[gpui::test]
fn a_run_already_going_is_waited_for_and_not_started_twice(cx: &mut TestAppContext) {
    use std::sync::atomic::Ordering::SeqCst;
    let (view, cx, _f) = share_held_back(cx, Publication::Busy);
    let resumes = watch_resumes(&view, cx);
    view.update(cx, |s, cx| s.issue_share(cx));
    cx.run_until_parked();
    assert!(matches!(phase_of(&view, cx), SharePhase::Publishing));
    assert_eq!(resumes.load(SeqCst), 0);
    view.update(cx, |s, cx| {
        s.sync_publication(Publication::Pending, None, cx)
    });
    cx.run_until_parked();
    assert!(matches!(phase_of(&view, cx), SharePhase::Publishing));
    assert_eq!(resumes.load(SeqCst), 1);
}

#[gpui::test]
fn a_run_that_cannot_start_does_not_leave_the_share_waiting(cx: &mut TestAppContext) {
    let (view, cx, _f) = share_held_back(cx, Publication::Pending);
    view.update(cx, |s, cx| {
        s.issue_share(cx);
        s.publication_refused(cx);
    });
    assert!(matches!(phase_of(&view, cx), SharePhase::Failed));
}

/// A billing Cloud: one quote, then an operation the test ends.
struct Billed {
    keys: Mutex<Vec<(String, Option<String>)>>,
    owner: std::sync::atomic::AtomicBool,
    confirm_fails: std::sync::atomic::AtomicBool,
    finished: std::sync::atomic::AtomicBool,
    /// The server allows seat changes and holds one waiting member change.
    seats: std::sync::atomic::AtomicBool,
    bodies: Mutex<Vec<(String, Value)>>,
}
impl Billed {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            keys: Mutex::default(),
            owner: std::sync::atomic::AtomicBool::new(true),
            confirm_fails: std::sync::atomic::AtomicBool::new(false),
            finished: std::sync::atomic::AtomicBool::new(false),
            seats: std::sync::atomic::AtomicBool::new(false),
            bodies: Mutex::default(),
        })
    }
    fn count(&self, path: &str) -> usize {
        let keys = self.keys.lock().unwrap();
        keys.iter().filter(|(p, _)| p == path).count()
    }
    fn sent(&self, path: &str) -> Vec<Value> {
        let bodies = self.bodies.lock().unwrap();
        bodies
            .iter()
            .filter(|(p, _)| p == path)
            .map(|(_, body)| body.clone())
            .collect()
    }
    fn answer(&self, r: &ApiRequest) -> services::Result<Value> {
        use std::sync::atomic::Ordering;
        if let Some(body) = &r.body {
            let mut bodies = self.bodies.lock().unwrap();
            bodies.push((r.path.clone(), body.clone()));
        }
        self.keys
            .lock()
            .unwrap()
            .push((r.path.clone(), r.idempotency_key.clone()));
        let quote = json!({"quote_id": "q", "org_id": "org-1", "target_plan_id": "team",
            "target_seats": 2, "currency": "USD", "delta_amount_cents": 2000,
            "target_amount_cents": 4000, "application_mode": "checkout",
            "expires_at": "2099-01-01T00:00:00Z"});
        let operation = |state: &str, terminal: bool| {
            json!({"id": "op", "org_id": "org-1", "kind": "checkout", "state": state,
                "terminal": terminal, "quote_id": "q", "target_plan_id": "team",
                "target_seat_quantity": 2})
        };
        Ok(match r.path.as_str() {
            "/organizations/" => json!([{"id": "org-1", "name": "One"}]),
            "/organizations/org-1/access" => json!({"org_id": "org-1",
                "can_manage_billing": self.owner.load(Ordering::SeqCst)}),
            "/billing/catalog" => json!({"schema_version": "1.0", "plans": [
                {"id": "team", "name": "Team", "public": true, "purchasable": true,
                 "currency": "USD", "price_per_seat_cents": 2000,
                 "seats": {"minimum": 2, "maximum": 10}}]}),
            "/billing/organizations/org-1/summary" => json!({"org_id": "org-1",
                "plan_id": if self.finished.load(Ordering::SeqCst) { "team" } else { "free" },
                "status": "active", "seat_quantity": 1,
                "seat_changes_available": self.seats.load(Ordering::SeqCst)}),
            "/billing/organizations/org-1/usage" => json!({
                "runtime": {"org_id": "org-1", "available_units": 10, "reserved_units": 1,
                    "consumed_units": 2},
                "storage": {"logical_bytes": 2048, "limit_bytes": null}}),
            "/billing/organizations/org-1/operations" if self.seats.load(Ordering::SeqCst) => {
                json!([{"id": "member", "org_id": "org-1", "kind": "member_activation",
                    "state": "requires_action", "terminal": false, "action_required": true,
                    "target_seat_quantity": 3}])
            }
            "/billing/organizations/org-1/operations" => json!([]),
            "/billing/organizations/org-1/plan/quote" => quote,
            "/billing/organizations/org-1/seats/quote" => {
                let mut seat = quote.clone();
                seat["quote_id"] = json!("sq");
                seat["target_seats"] = json!(3);
                seat["application_mode"] = json!("seat_change");
                seat
            }
            "/billing/organizations/org-1/seats/change" => {
                let mut seat = quote.clone();
                seat["quote_id"] = json!("sq");
                seat["target_seats"] = json!(3);
                seat["application_mode"] = json!("seat_change");
                seat["operation"] = json!({"id": "member", "org_id": "org-1",
                    "kind": "member_activation", "state": "succeeded", "terminal": true,
                    "quote_id": "sq", "target_plan_id": "team", "target_seat_quantity": 3});
                seat
            }
            "/billing/organizations/org-1/checkout" => {
                if self.confirm_fails.load(Ordering::SeqCst) {
                    return Err(services::Error::Unknown);
                }
                json!({"checkout_id": "c", "checkout_url": "https://pay.example.com/c",
                    "quote": quote, "operation": operation("pending", false)})
            }
            "/billing/organizations/org-1/operations/op" => {
                if self.finished.load(Ordering::SeqCst) {
                    operation("succeeded", true)
                } else {
                    operation("processing", false)
                }
            }
            _ => cloud("p")(r)?,
        })
    }
}
struct BilledTransport(Arc<Billed>);
impl services::Transport for BilledTransport {
    fn request(&self, request: ApiRequest) -> services::Result<Value> {
        self.0.answer(&request)
    }
}
fn open_billing(
    cx: &mut TestAppContext,
    billed: Arc<Billed>,
) -> (Entity<CloudServices>, &mut VisualTestContext) {
    open_billing_over(cx, BilledTransport(billed))
}
fn open_billing_over(
    cx: &mut TestAppContext,
    transport: impl services::Transport + 'static,
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
        s.open_with(
            Client::new(Arc::new(transport)),
            "p".into(),
            Section::Billing,
            cx,
        )
    });
    (view, cx)
}

#[gpui::test]
fn a_non_owner_sees_no_prices_and_requests_none(cx: &mut TestAppContext) {
    let billed = Billed::new();
    billed
        .owner
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let (view, cx) = open_billing(cx, billed.clone());
    let loaded = view.clone();
    settle(cx, "the membership", &|cx| {
        loaded.read_with(cx, |s, _| {
            s.billing.membership == billing::Membership::Member
        })
    });
    draw(cx);
    assert!(
        !billed
            .keys
            .lock()
            .unwrap()
            .iter()
            .any(|(p, _)| p == "/billing/catalog"),
        "a member reads no catalog"
    );
}

#[gpui::test]
fn success_is_the_servers_word_and_a_retry_keeps_its_key(cx: &mut TestAppContext) {
    use std::sync::atomic::Ordering;
    let billed = Billed::new();
    billed.confirm_fails.store(true, Ordering::SeqCst);
    let (view, cx) = open_billing(cx, billed.clone());
    let loaded = view.clone();
    settle(cx, "the owner's page", &|cx| {
        loaded.read_with(cx, |s, _| {
            s.billing.membership == billing::Membership::Owner
        })
    });
    draw(cx);
    let plan = view.read_with(cx, |s, _| {
        s.billing.catalog.as_ref().unwrap().plans[0].clone()
    });
    view.update(cx, |s, cx| s.request_quote(plan, cx));
    let loaded = view.clone();
    settle(cx, "the quote", &|cx| {
        loaded.read_with(cx, |s, _| s.billing.quote.is_some())
    });
    draw(cx);
    // A lost confirmation keeps the quote and its key.
    view.update(cx, |s, cx| s.confirm_quote(cx));
    let loaded = view.clone();
    settle(cx, "the failure", &|cx| {
        loaded.read_with(cx, |s, _| s.billing.error.is_some() && !s.billing.acting)
    });
    billed.confirm_fails.store(false, Ordering::SeqCst);
    view.update(cx, |s, cx| s.confirm_quote(cx));
    let loaded = view.clone();
    settle(cx, "the operation", &|cx| {
        loaded.read_with(cx, |s, _| s.billing.polling.is_some())
    });
    let keys: Vec<_> = billed
        .keys
        .lock()
        .unwrap()
        .iter()
        .filter(|(p, _)| p.ends_with("/checkout"))
        .map(|(_, k)| k.clone().unwrap())
        .collect();
    assert_eq!(keys.len(), 2);
    assert_eq!(keys[0], keys[1]);
    // Opening the browser changed nothing: the plan is still the old one.
    view.read_with(cx, |s, _| {
        assert_eq!(s.billing.summary.as_ref().unwrap().plan_id, "free");
    });
    draw(cx);
    // The server's terminal state is what ends it.
    billed.finished.store(true, Ordering::SeqCst);
    cx.executor()
        .advance_clock(std::time::Duration::from_secs(5));
    let loaded = view.clone();
    settle(cx, "the new plan", &|cx| {
        cx.executor()
            .advance_clock(std::time::Duration::from_secs(5));
        loaded.read_with(cx, |s, _| {
            s.billing.polling.is_none()
                && s.billing
                    .summary
                    .as_ref()
                    .is_some_and(|x| x.plan_id == "team")
        })
    });
}

#[gpui::test]
fn another_organization_clears_the_quote_and_its_keys(cx: &mut TestAppContext) {
    let billed = Billed::new();
    let (view, cx) = open_billing(cx, billed.clone());
    let loaded = view.clone();
    settle(cx, "the owner's page", &|cx| {
        loaded.read_with(cx, |s, _| {
            s.billing.membership == billing::Membership::Owner
        })
    });
    view.update(cx, |s, cx| {
        let first = s.billing.keys.key("intent", "scope");
        s.select_organization("org-1".into(), cx);
        assert!(s.billing.quote.is_none() && s.billing.catalog.is_none());
        assert_ne!(s.billing.keys.key("intent", "scope"), first);
    });
}

#[gpui::test]
fn a_waiting_member_change_is_settled_by_its_own_seat_quote(cx: &mut TestAppContext) {
    use std::sync::atomic::Ordering;
    let billed = Billed::new();
    billed.seats.store(true, Ordering::SeqCst);
    let (view, cx) = open_billing(cx, billed.clone());
    let loaded = view.clone();
    settle(cx, "the billing page", &|cx| {
        loaded.read_with(cx, |s, _| {
            s.billing.membership == billing::Membership::Owner
        })
    });
    draw(cx);
    let waiting = view.read_with(cx, |s, _| {
        crate::workspace::cloud::billing::actionable_seat(&s.billing.operations).cloned()
    });
    view.update(cx, |s, cx| s.request_seat_quote(waiting, cx));
    let quoted = view.clone();
    settle(cx, "the seat quote", &|cx| {
        quoted.read_with(cx, |s, _| s.billing.quote.is_some())
    });
    draw(cx);
    let quote = "/billing/organizations/org-1/seats/quote";
    assert_eq!(
        billed.sent(quote),
        [json!({"seat_quantity": 3, "operation_id": "member"})]
    );
    view.read_with(cx, |s, _| {
        assert_eq!(s.billing.seats, 3, "the page shows what was quoted");
        assert_eq!(s.billing.quoted_operation.as_deref(), Some("member"));
    });
    view.update(cx, |s, cx| s.confirm_quote(cx));
    let change = "/billing/organizations/org-1/seats/change";
    let done = billed.clone();
    settle(cx, "the seat change", &|_| !done.sent(change).is_empty());
    assert_eq!(
        billed.sent(change),
        [json!({"quote_id": "sq", "operation_id": "member"})]
    );
    let reread = billed.clone();
    let page = view.clone();
    settle(cx, "the reread", &|cx| {
        reread.count("/billing/organizations/org-1/summary") == 2
            && page.read_with(cx, |s, _| {
                s.billing.membership == billing::Membership::Owner
            })
    });
    assert_eq!(
        billed.count("/billing/organizations/org-1/operations/member"),
        0,
        "what already ended is not watched"
    );
    view.read_with(cx, |s, _| {
        assert!(s.billing.polling.is_none());
        // The list still says it waits; what was seen to end stays ended.
        assert!(crate::workspace::cloud::billing::actionable_seat(&s.billing.operations).is_none());
    });
}

#[gpui::test]
fn a_seat_count_a_member_change_needs_settles_that_change(cx: &mut TestAppContext) {
    use std::sync::atomic::Ordering;
    let billed = Billed::new();
    billed.seats.store(true, Ordering::SeqCst);
    let (view, cx) = open_billing(cx, billed.clone());
    let loaded = view.clone();
    settle(cx, "the billing page", &|cx| {
        loaded.read_with(cx, |s, _| {
            s.billing.membership == billing::Membership::Owner
        })
    });
    view.update(cx, |s, cx| {
        s.billing.seats = 3;
        s.request_seat_quote(None, cx);
    });
    let quoted = view.clone();
    settle(cx, "the seat quote", &|cx| {
        quoted.read_with(cx, |s, _| s.billing.quote.is_some())
    });
    assert_eq!(
        billed.sent("/billing/organizations/org-1/seats/quote"),
        [json!({"seat_quantity": 3, "operation_id": "member"})]
    );
}

#[gpui::test]
fn seats_change_only_when_the_server_allows_it(cx: &mut TestAppContext) {
    let billed = Billed::new();
    let (view, cx) = open_billing(cx, billed.clone());
    let loaded = view.clone();
    settle(cx, "the billing page", &|cx| {
        loaded.read_with(cx, |s, _| {
            s.billing.membership == billing::Membership::Owner
        })
    });
    draw(cx);
    view.update(cx, |s, cx| s.request_seat_quote(None, cx));
    cx.run_until_parked();
    assert!(
        billed
            .sent("/billing/organizations/org-1/seats/quote")
            .is_empty()
    );
    view.read_with(cx, |s, _| assert!(!s.billing.acting));
}

/// Billing, with one path answering something else.
struct Rewrite(Arc<Billed>, &'static str, Value);
impl services::Transport for Rewrite {
    fn request(&self, request: ApiRequest) -> services::Result<Value> {
        if request.path.ends_with(self.1) {
            return Ok(self.2.clone());
        }
        self.0.answer(&request)
    }
}
/// The owner's page, with a plan quoted and confirmed.
fn confirm_a_plan(view: &Entity<CloudServices>, cx: &mut VisualTestContext) {
    let loaded = view.clone();
    settle(cx, "the billing page", &|cx| {
        loaded.read_with(cx, |s, _| {
            s.billing.membership == billing::Membership::Owner
        })
    });
    let plan = view.read_with(cx, |s, _| {
        s.billing.catalog.as_ref().unwrap().plans[0].clone()
    });
    view.update(cx, |s, cx| s.request_quote(plan, cx));
    let quoted = view.clone();
    settle(cx, "the quote", &|cx| {
        quoted.read_with(cx, |s, _| s.billing.quote.is_some())
    });
    view.update(cx, |s, cx| s.confirm_quote(cx));
}

#[gpui::test]
fn usage_of_another_organization_fails_the_page(cx: &mut TestAppContext) {
    let foreign = json!({"runtime": {"org_id": "org-2"}, "storage": {}});
    let (view, cx) = open_billing_over(cx, Rewrite(Billed::new(), "/usage", foreign));
    let failed = view.clone();
    settle(cx, "the failure", &|cx| {
        failed.read_with(cx, |s, _| {
            s.billing.membership == billing::Membership::Failed
        })
    });
    view.read_with(cx, |s, _| {
        assert!(s.billing.summary.is_none() && s.billing.usage.is_none());
    });
    draw(cx);
}

#[gpui::test]
fn an_operation_of_another_organization_ends_the_watch(cx: &mut TestAppContext) {
    let foreign = json!({"id": "op", "org_id": "org-2", "kind": "checkout",
        "state": "processing", "terminal": false});
    let (view, cx) = open_billing_over(cx, Rewrite(Billed::new(), "/operations/op", foreign));
    confirm_a_plan(&view, cx);
    let ended = view.clone();
    settle(cx, "the mismatch", &|cx| {
        cx.executor()
            .advance_clock(std::time::Duration::from_secs(5));
        ended.read_with(cx, |s, _| s.billing.error.is_some())
    });
    view.read_with(cx, |s, _| {
        assert_eq!(
            s.billing.error,
            Some(crate::workspace::cloud::billing::MISMATCH)
        );
        assert!(s.billing.polling.is_none(), "the watch ended");
    });
}

#[gpui::test]
fn a_failed_operation_stays_said_through_the_reread(cx: &mut TestAppContext) {
    let billed = Billed::new();
    let failed = json!({"id": "op", "org_id": "org-1", "kind": "checkout", "state": "failed",
        "terminal": true, "quote_id": "q", "target_plan_id": "team",
        "target_seat_quantity": 2});
    let (view, cx) = open_billing_over(cx, Rewrite(billed.clone(), "/operations/op", failed));
    confirm_a_plan(&view, cx);
    let reread = billed.clone();
    let page = view.clone();
    settle(cx, "the reread", &|cx| {
        cx.executor()
            .advance_clock(std::time::Duration::from_secs(5));
        reread.count("/billing/organizations/org-1/summary") == 2
            && page.read_with(cx, |s, _| {
                s.billing.membership == billing::Membership::Owner
            })
    });
    view.read_with(cx, |s, _| {
        assert_eq!(s.billing.error, Some("cloud.billing.changeFailed"));
        assert!(s.billing.polling.is_none());
    });
    draw(cx);
}
