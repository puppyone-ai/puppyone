//! The window's Cloud services: the Agents, the plan page, the hosted
//! workbench.
use super::*;
use core::prelude::v1::test;

/// `CloudWorkspaceAgentsTool`: the Agents of a hosted workspace are one
/// quiet Header entry. A request keeps its own card under the entry until
/// it is answered; pressing the entry meanwhile only brings its Deny into
/// reach. Then the entry opens the list of who has access, whose Invite
/// turns to the invite dialog; Escape closes each.
#[gpui::test]
fn the_agents_are_one_quiet_header_entry_with_their_list(cx: &mut TestAppContext) {
    use std::sync::{Arc, Mutex};
    let (view, cx) = setup(cx);
    let base = cloud_project_responder();
    let pending = Arc::new(Mutex::new(true));
    let decided = Arc::new(Mutex::new(Vec::<String>::new()));
    let (asking, answers) = (pending.clone(), decided.clone());
    let responder = with_catalog(Arc::new(move |request| {
        let path = request.path.as_str();
        if path.ends_with("/agent-links") && request.method == reqwest::Method::GET {
            let mut inventory = serde_json::json!({"links": [],
                "connections": [{"id": "c1", "name": "Claude Code", "admission": "sign_in",
                    "grant_id": "g1", "connected_at": "2026-10-30T12:00:00Z", "expires_at": null}]});
            if *asking.lock().unwrap() {
                inventory["pending"] = serde_json::json!([{"id": "r1", "name": "Robo",
                    "avatar": "other", "admission": "sign_in",
                    "requested_at": "2026-10-30T12:00:00Z", "expires_at": "2026-10-30T12:10:00Z"}]);
            }
            return Ok(serde_json::json!({"code": 0, "data": inventory}));
        }
        if path.ends_with("/decision") {
            answers.lock().unwrap().push(path.to_owned());
            *asking.lock().unwrap() = false;
            return Ok(serde_json::json!({}));
        }
        if path.ends_with("/access/sessions") {
            return Ok(serde_json::json!({"code": 0, "data": []}));
        }
        base(request)
    }));
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
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle_cloud(&view, cx, "the Agents", &|s, cx| {
        let agents = s.cloud.read(cx).agents.read(cx);
        agents.manageable && !agents.requests.is_empty()
    });
    draw(cx);
    let entry = cx.debug_bounds("cloud-workspace-agents").unwrap();
    // No faces in the Header: one entry, and no seat or `+` beside it.
    for id in [
        "cloud-workspace-agent:r1",
        "cloud-workspace-agent-stack",
        "cloud-workspace-agent-add",
        "cloud-workspace-tool:invite-agent",
    ] {
        assert!(cx.debug_bounds(id).is_none(), "{id}");
    }
    // The request's own card, below the entry, until it is answered.
    let card = cx.debug_bounds("cloud-agent-request-card").unwrap();
    assert!((f32::from(card.size.width) - 288.).abs() < 0.5);
    assert!(card.origin.y > entry.origin.y);
    command(&view, cx, Command::Escape);
    cx.simulate_click(point(px(400.), px(500.)), Modifiers::none());
    draw(cx);
    assert!(cx.debug_bounds("cloud-agent-request-card").is_some());
    // The entry brings the decision into keyboard reach without making it.
    cx.simulate_click(entry.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(!s.has_dialog("Agents", cx));
        assert!(!s.cloud.read(cx).agents_panel);
    });
    // Allow, from the card (the kit's buttons carry no selectors).
    view.update(cx, |s, cx| {
        s.cloud
            .read(cx)
            .agents
            .clone()
            .update(cx, |a, cx| a.decide("r1", true, cx))
    });
    settle_cloud(&view, cx, "the answer", &|s, cx| {
        s.cloud.read(cx).agents.read(cx).requests.is_empty()
    });
    assert_eq!(
        decided.lock().unwrap().as_slice(),
        ["/agent-links/connections/r1/decision"]
    );
    draw(cx);
    assert!(cx.debug_bounds("cloud-agent-request-card").is_none());
    // The entry opens the list: everyone with access, each on its row.
    let entry = cx.debug_bounds("cloud-workspace-agents").unwrap();
    cx.simulate_click(entry.center(), Modifiers::none());
    draw(cx);
    let panel = cx.debug_bounds("cloud-agents-panel").unwrap();
    assert!(panel.origin.y > entry.origin.y);
    assert!(panel.right() <= entry.right() + px(1.));
    assert!(cx.debug_bounds("cloud-agents-panel-row:c1").is_some());
    view.read_with(cx, |s, cx| assert!(!s.has_dialog("Agents", cx)));
    // Escape closes it; the entry opens it again.
    command(&view, cx, Command::Escape);
    assert!(cx.debug_bounds("cloud-agents-panel").is_none());
    cx.simulate_click(entry.center(), Modifiers::none());
    draw(cx);
    // Its Invite turns to the invite dialog, and the list goes.
    click(cx, "cloud-agents-panel-invite");
    view.read_with(cx, |s, cx| {
        assert!(s.top_dialog(cx).as_deref() == Some("Agents"));
        assert_eq!(
            s.cloud.read(cx).agents.read(cx).opener,
            crate::features::cloud::Opener::Invite
        );
        assert!(!s.cloud.read(cx).agents_panel);
    });
    assert!(cx.debug_bounds("cloud-agent-invite").is_some());
    assert!(cx.debug_bounds("cloud-agents-panel").is_none());
    command(&view, cx, Command::Escape);
    view.read_with(cx, |s, cx| {
        assert!(s.dialogs.read(cx).is_empty());
        assert!(!s.cloud.read(cx).agents.read(cx).invite_open);
    });
}

fn click(cx: &mut VisualTestContext, selector: &'static str) {
    let bounds = cx
        .debug_bounds(selector)
        .unwrap_or_else(|| panic!("missing selector `{selector}`"));
    cx.simulate_click(bounds.center(), Modifiers::none());
    draw(cx);
}

/// The invite, end to end: both steps from the start; copying keeps step 1
/// open on pasting and the wait; the Agent asks to join inside the dialog
/// (the Header's card waits while it is open) and, let in, ends the invite.
#[gpui::test]
fn the_invite_waits_for_the_agent_and_lets_it_in_where_it_asks(cx: &mut TestAppContext) {
    use std::sync::{Arc, Mutex};
    let (view, cx) = setup(cx);
    let base = cloud_project_responder();
    // 0: nobody, also once the message is out; 1: Claude Code asks; 2: let in;
    // 3: it has connected.
    let stage = Arc::new(Mutex::new(0));
    let state = stage.clone();
    let responder = with_catalog(Arc::new(move |request| {
        let path = request.path.as_str();
        let mut stage = state.lock().unwrap();
        if path.ends_with("/agent-links") && request.method == reqwest::Method::POST {
            return Ok(serde_json::json!({"code": 0,
                "data": {"agent_url": "https://api.puppyone.ai/agent/pai_secret0123456789"}}));
        }
        if path.ends_with("/decision") {
            *stage = 2;
            return Ok(serde_json::json!({}));
        }
        if path.ends_with("/agent-links") {
            let (connections, pending) = match *stage {
                0 => (serde_json::json!([]), serde_json::json!([])),
                1 => (
                    serde_json::json!([]),
                    serde_json::json!([{"id": "r1", "name": "Claude Code",
                    "avatar": "claude", "admission": "sign_in",
                    "requested_at": "2026-10-30T12:00:00Z", "expires_at": "2026-10-30T12:10:00Z"}]),
                ),
                _ => (
                    serde_json::json!([{"id": "c1", "name": "Claude Code", "avatar": "claude",
                    "admission": "sign_in", "grant_id": "g1",
                    "connected_at": "2026-10-30T12:00:00Z", "expires_at": null}]),
                    serde_json::json!([]),
                ),
            };
            return Ok(serde_json::json!({"code": 0, "data": {"links": [],
                "connections": connections, "pending": pending}}));
        }
        if path.ends_with("/access/sessions") {
            let sessions = if *stage == 3 {
                serde_json::json!([{"grant_id": "g1", "state": "active",
                    "created_at": "2026-10-30T12:00:00Z", "closed_at": null,
                    "lease_until": "2099-01-01T00:00:00Z", "commands_running": 1,
                    "last_command_at": "2026-10-30T12:00:05Z"}])
            } else {
                serde_json::json!([])
            };
            return Ok(serde_json::json!({"code": 0, "data": sessions}));
        }
        drop(stage);
        base(request)
    }));
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
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle_cloud(&view, cx, "the Agents", &|s, cx| {
        s.cloud.read(cx).agents.read(cx).manageable
    });
    draw(cx);
    // With nobody here yet, the Agents entry goes straight to inviting.
    click(cx, "cloud-workspace-agents");
    // Both steps from the start, and the message beside its picture.
    assert!(cx.debug_bounds("cloud-agent-invite-step:1").is_some());
    assert!(cx.debug_bounds("cloud-agent-invite-step:2").is_some());
    let card = cx.debug_bounds("cloud-agent-invite-card").unwrap();
    let art = cx.debug_bounds("cloud-agent-paste-art").unwrap();
    assert!(card.contains(&art.center()));
    assert!(cx.debug_bounds("cloud-agent-invite-next").is_none());
    let agents = view.read_with(cx, |s, cx| s.cloud.read(cx).agents.clone());
    // Copy (the kit's buttons carry no selectors): step 1 stays open on
    // pasting, until Claude Code asks to join inside the dialog.
    agents.update(cx, |a, cx| a.copy_invite(cx));
    settle_cloud(&view, cx, "the message out", &|s, cx| {
        s.cloud.read(cx).agents.read(cx).copy == crate::features::cloud::CopyStatus::Copied
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-agent-invite-next").is_some());
    // Claude Code follows the message; the next read finds it asking.
    *stage.lock().unwrap() = 1;
    agents.update(cx, |a, cx| a.refresh(cx));
    settle_cloud(&view, cx, "the knock", &|s, cx| {
        !s.cloud.read(cx).agents.read(cx).requests.is_empty()
    });
    draw(cx);
    view.read_with(cx, |s, cx| assert!(s.has_dialog("Agents", cx)));
    assert!(cx.debug_bounds("cloud-agent-invite-ask:r1").is_some());
    assert!(cx.debug_bounds("cloud-agent-request-card").is_none());
    agents.update(cx, |a, cx| a.decide("r1", true, cx));
    // Allowed is not in: the invite waits until the Agent reaches the workspace.
    settle_cloud(&view, cx, "the Agent allowed", &|s, cx| {
        s.cloud.read(cx).agents.read(cx).invite_phase()
            == crate::features::cloud::InvitePhase::Connecting
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-agent-invite-connecting").is_some());
    assert!(cx.debug_bounds("cloud-agent-invite-joined").is_none());
    // Past a first machine start it says the Agent has not connected yet.
    agents.update(cx, |a, cx| {
        if let crate::features::cloud::Invite::Joined { since, .. } = &mut a.invite_flow {
            *since -= 11 * 60 * 1000;
        }
        cx.notify();
    });
    draw(cx);
    assert!(
        cx.debug_bounds("cloud-agent-invite-not-connected")
            .is_some()
    );
    assert!(cx.debug_bounds("cloud-agent-invite-connecting").is_none());
    *stage.lock().unwrap() = 3;
    agents.update(cx, |a, cx| a.refresh(cx));
    settle_cloud(&view, cx, "the Agent in", &|s, cx| {
        s.cloud.read(cx).agents.read(cx).invite_phase()
            == crate::features::cloud::InvitePhase::Joined
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-agent-invite-joined").is_some());
    command(&view, cx, Command::Escape);
    view.read_with(cx, |s, cx| assert!(s.dialogs.read(cx).is_empty()));
}

/// Signed in with Cloud on and `project-a` open; `agents` answers what it
/// takes (the data, or a refusal) and leaves the rest to the project. The
/// returned function signs a user in again, as a new sign-in does.
fn open_with_agents(
    view: &Entity<Shell>,
    cx: &mut VisualTestContext,
    agents: impl Fn(
        &crate::cloud::auth::model::ApiRequest,
    ) -> Option<crate::cloud::auth::model::Result<serde_json::Value>>
    + Send
    + Sync
    + 'static,
) -> Box<dyn Fn(&str)> {
    let base = cloud_project_responder();
    let responder = with_catalog(std::sync::Arc::new(move |request| match agents(request) {
        Some(answer) => answer.map(|data| serde_json::json!({"code": 0, "data": data})),
        None => base(request),
    }));
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    let kept = broker.clone();
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    Box::new(move |user| crate::cloud::auth::sign_in_again(&kept, user))
}
fn connection(id: &str, name: &str) -> serde_json::Value {
    serde_json::json!({"id": id, "name": name, "admission": "sign_in",
        "grant_id": format!("g-{id}"), "connected_at": "2026-10-30T12:00:00Z", "expires_at": null})
}
fn asking_to_join(id: &str, name: &str) -> serde_json::Value {
    serde_json::json!([{"id": id, "name": name, "admission": "sign_in",
        "requested_at": "2026-10-30T12:00:00Z", "expires_at": "2026-10-30T12:10:00Z"}])
}
/// A connection of `grant` running a command now.
fn at_work(grant: &str) -> serde_json::Value {
    let now = crate::clock::now_ms();
    serde_json::json!([{"grant_id": grant, "state": "active",
        "created_at": crate::clock::iso_string(now - 60_000), "closed_at": null,
        "lease_until": crate::clock::iso_string(now + 3_600_000)}])
}

/// `CloudWorkspaceAgentsTool` while Agents work: the entry names the one
/// at work (or how many), and its list puts them first, says how each got
/// in, and lets each be removed once confirmed on its own row. An Agent
/// asking to join turns the entry to its request, and the list closes.
#[gpui::test]
fn the_entry_names_who_works_and_its_list_puts_them_first(cx: &mut TestAppContext) {
    use std::sync::{Arc, Mutex};
    let (view, cx) = setup(cx);
    let asking = Arc::new(Mutex::new(false));
    let pending = asking.clone();
    let _sign_in_again = open_with_agents(&view, cx, move |request| {
        if request.path.ends_with("/agent-links") {
            let mut inventory = serde_json::json!({"links": [], "connections": [
                connection("c1", "Cursor"), connection("c2", "Grok Bot"),
                connection("c3", "Gemini CLI")]});
            if *pending.lock().unwrap() {
                inventory["pending"] = asking_to_join("r1", "Claude Code");
            }
            return Some(Ok(inventory));
        }
        if request.path.ends_with("/access/sessions") {
            return Some(Ok(at_work("g-c2")));
        }
        None
    });
    settle_cloud(&view, cx, "the Agents", &|s, cx| {
        s.cloud.read(cx).agents.read(cx).agents.len() == 3
    });
    draw(cx);
    let cloud = view.read_with(cx, |s, _| s.cloud.clone());
    let entry = cx.debug_bounds("cloud-workspace-agents").unwrap();
    assert!(cx.debug_bounds("cloud-workspace-agent:c2").is_none());
    cx.simulate_click(entry.center(), Modifiers::none());
    draw(cx);
    // The one at work first, then the others in their order.
    let rows: Vec<_> = ["c2", "c1", "c3"]
        .iter()
        .map(|id| {
            cx.debug_bounds(Box::leak(
                format!("cloud-agents-panel-row:{id}").into_boxed_str(),
            ))
            .unwrap()
        })
        .collect();
    assert!(rows[0].origin.y < rows[1].origin.y && rows[1].origin.y < rows[2].origin.y);
    // Removing asks on the row first, writing nothing yet.
    click(cx, "cloud-agents-panel-remove:c1");
    let agents = cloud.read_with(cx, |c, _| c.agents.clone());
    agents.read_with(cx, |a, _| assert_eq!(a.confirming.as_deref(), Some("c1")));
    assert!(cx.debug_bounds("cloud-agents-panel-remove:c1").is_none());
    agents.update(cx, |a, cx| a.confirm_remove(None, cx));
    draw(cx);
    // A press outside closes the list.
    cx.simulate_click(point(px(400.), px(500.)), Modifiers::none());
    draw(cx);
    assert!(cx.debug_bounds("cloud-agents-panel").is_none());
    // An Agent asking to join: its own card under the entry, and the list
    // closes; a press on the entry brings Deny into reach and opens nothing.
    cx.simulate_click(entry.center(), Modifiers::none());
    draw(cx);
    assert!(cx.debug_bounds("cloud-agents-panel").is_some());
    *asking.lock().unwrap() = true;
    agents.update(cx, |a, cx| a.refresh(cx));
    settle_cloud(&view, cx, "the request", &|s, cx| {
        !s.cloud.read(cx).agents.read(cx).requests.is_empty()
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-agents-panel").is_none());
    assert!(cx.debug_bounds("cloud-agent-request-card").is_some());
    let deny = cloud.read_with(cx, |c, _| c.deny_focus.clone());
    cx.update(|w, _| assert!(!deny.is_focused(w)));
    let entry = cx.debug_bounds("cloud-workspace-agents").unwrap();
    cx.simulate_click(entry.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(!s.has_dialog("Agents", cx));
        assert!(!s.cloud.read(cx).agents_panel);
    });
    cx.update(|w, _| assert!(deny.is_focused(w)));
}

/// `CloudWorkspaceAgentsPanel` opened from the entry writes nothing; an
/// Agent let in from its request card joins the list. Removing everyone
/// leaves the entry, which then goes straight to inviting. Someone the
/// server will not show the Agents is offered nothing about them.
#[gpui::test]
fn the_list_writes_nothing_until_asked_and_the_entry_stays_when_the_last_one_goes(
    cx: &mut TestAppContext,
) {
    use std::sync::{Arc, Mutex};
    #[derive(Default)]
    struct Room {
        here: Vec<serde_json::Value>,
        asking: bool,
        denied: bool,
        writes: Vec<String>,
    }
    let (view, cx) = setup(cx);
    let room = Arc::new(Mutex::new(Room {
        here: vec![connection("c1", "Codex"), connection("c2", "Claude Code")],
        ..Default::default()
    }));
    let state = room.clone();
    let _sign_in_again = open_with_agents(&view, cx, move |request| {
        let mut room = state.lock().unwrap();
        let path = request.path.as_str();
        let about_agents = path.contains("/agent-links") || path.contains("/access/grants/");
        if request.method != reqwest::Method::GET && about_agents {
            room.writes.push(format!("{} {path}", request.method));
        }
        if path.ends_with("/agent-links") && request.method == reqwest::Method::GET {
            if room.denied {
                return Some(Err(crate::cloud::auth::Error::Http(403)));
            }
            let mut inventory = serde_json::json!({"links": [], "connections": room.here});
            if room.asking {
                inventory["pending"] = asking_to_join("r1", "Cursor");
            }
            return Some(Ok(inventory));
        }
        if path.ends_with("/decision") {
            room.asking = false;
            return Some(Ok(serde_json::json!({})));
        }
        if let Some(grant) = path.strip_prefix("/projects/project-a/access/grants/") {
            room.here.retain(|c| c["grant_id"] != grant);
            return Some(Ok(serde_json::json!({})));
        }
        if path.ends_with("/access/sessions") {
            return Some(Ok(at_work("g-c2")));
        }
        None
    });
    settle_cloud(&view, cx, "the Agents", &|s, cx| {
        s.cloud.read(cx).agents.read(cx).agents.len() == 2
    });
    draw(cx);
    let agents = view.read_with(cx, |s, cx| s.cloud.read(cx).agents.clone());
    click(cx, "cloud-workspace-agents");
    assert!(cx.debug_bounds("cloud-agents-panel-row:c1").is_some());
    assert!(cx.debug_bounds("cloud-agents-panel-row:c2").is_some());
    // The one at work offers nothing to watch without a computer screen.
    assert!(cx.debug_bounds("cloud-agents-panel-watch:c2").is_none());
    command(&view, cx, Command::Escape);
    // Someone asks to join; let in where it asks (the card's buttons carry
    // no selectors), then it is on the list.
    room.lock().unwrap().asking = true;
    agents.update(cx, |a, cx| a.refresh(cx));
    settle_cloud(&view, cx, "the request", &|s, cx| {
        !s.cloud.read(cx).agents.read(cx).requests.is_empty()
    });
    assert!(room.lock().unwrap().writes.is_empty());
    agents.update(cx, |a, cx| a.decide("r1", true, cx));
    settle_cloud(&view, cx, "the answer", &|s, cx| {
        s.cloud.read(cx).agents.read(cx).requests.is_empty()
    });
    // Both removed, each confirmed first.
    for id in ["c1", "c2"] {
        agents.update(cx, |a, cx| {
            a.confirm_remove(Some(id.into()), cx);
            a.remove(id, cx)
        });
        settle_cloud(&view, cx, "the removal", &|s, cx| {
            !s.cloud
                .read(cx)
                .agents
                .read(cx)
                .agents
                .iter()
                .any(|a| a.agent.id == id)
        });
    }
    draw(cx);
    assert_eq!(
        room.lock().unwrap().writes,
        [
            "POST /agent-links/connections/r1/decision",
            "PATCH /projects/project-a/access/grants/g-c1",
            "PATCH /projects/project-a/access/grants/g-c2",
        ]
    );
    // With nobody left, the entry stays and goes straight to inviting.
    room.lock().unwrap().here.clear();
    agents.update(cx, |a, cx| a.refresh(cx));
    settle_cloud(&view, cx, "nobody left", &|s, cx| {
        s.cloud.read(cx).agents.read(cx).agents.is_empty()
    });
    draw(cx);
    click(cx, "cloud-workspace-agents");
    view.read_with(cx, |s, cx| {
        assert!(s.has_dialog("Agents", cx));
        assert!(s.cloud.read(cx).agents.read(cx).invite_open);
    });
    command(&view, cx, Command::Escape);
    // Not shown to this person: nothing about Agents at all.
    room.lock().unwrap().denied = true;
    agents.update(cx, |a, cx| a.refresh(cx));
    settle_cloud(&view, cx, "the refusal", &|s, cx| {
        !s.cloud.read(cx).agents.read(cx).manageable
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-workspace-agents").is_none());
}

/// A hosted Project with nobody here yet, on a signed-in fixture account.
fn open_empty_project(view: &Entity<Shell>, cx: &mut VisualTestContext) -> Box<dyn Fn(&str)> {
    let sign_in_again = open_with_agents(view, cx, |request| {
        if request.path.ends_with("/agent-links") {
            return Some(Ok(serde_json::json!({"links": [], "connections": []})));
        }
        if request.path.ends_with("/access/sessions") {
            return Some(Ok(serde_json::json!([])));
        }
        None
    });
    settle_cloud(view, cx, "the Project", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
    });
    sign_in_again
}
/// `project-a` shown as the signed-in identity sees it, its Agents dialog
/// opened from the Agents entry (nobody is here, so it invites).
fn open_invite(view: &Entity<Shell>, cx: &mut VisualTestContext) {
    let elsewhere = view.read_with(cx, |s, cx| {
        s.hosted_project(cx).as_deref() != Some("project-a") && !s.cloud.read(cx).session().opening
    });
    if elsewhere {
        view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    }
    settle_cloud(view, cx, "the seat", &|s, cx| {
        let agents = s.cloud.read(cx).agents.read(cx);
        s.hosted_project(cx).as_deref() == Some("project-a")
            && agents.manageable
            && agents.scope_key().is_some()
    });
    click(cx, "cloud-workspace-agents");
    view.read_with(cx, |s, cx| assert!(s.has_dialog("Agents", cx)));
}

/// `CloudWorkspaceHeaderTools`' scope: an Agents dialog open for one
/// Project and identity ends when the sign-in, the account or the Project
/// changes (the hosted Project itself ends with the identity that opened
/// it); nothing of it is inherited.
#[gpui::test]
fn the_agents_dialog_ends_with_its_project_and_identity(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let sign_in_again = open_empty_project(&view, cx);
    for user in ["alice", "bob"] {
        open_invite(&view, cx);
        sign_in_again(user);
        settle_cloud(&view, cx, user, &|s, cx| !s.has_dialog("Agents", cx));
    }
    open_invite(&view, cx);
    view.update(cx, |s, cx| s.open_cloud("project-b".into(), cx));
    settle_cloud(&view, cx, "another Project", &|s, cx| {
        !s.has_dialog("Agents", cx)
    });
}

/// Signing out ends an open Agents dialog and leaves no entry to open it
/// again.
#[gpui::test]
fn signing_out_ends_the_agents_dialog_and_its_seat(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let _sign_in_again = open_empty_project(&view, cx);
    open_invite(&view, cx);
    cx.update(|_, cx| crate::features::cloud::account::sign_out(cx));
    settle_cloud(&view, cx, "signing out", &|s, cx| {
        !s.has_dialog("Agents", cx) && !crate::features::cloud::account::has_account(cx)
    });
    assert!(cx.debug_bounds("cloud-workspace-agents").is_none());
}

/// C-10.1/10.2: in Cloud the right sidebar's workbench is the hosted Agent —
/// one Puppyone Agent recipe, no local discovery or shell — and opening it
/// sends nothing; back in the folder the local workbench returns.
#[gpui::test]
fn the_hosted_project_gets_the_cloud_agent_workbench_and_this_mac_gets_its_own(
    cx: &mut TestAppContext,
) {
    let agent_requests = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let base = cloud_project_responder();
    let responder = with_catalog({
        let agent_requests = agent_requests.clone();
        std::sync::Arc::new(move |request| {
            if request.path.starts_with("/agents") {
                agent_requests.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            base(request)
        })
    });
    let (view, cx, Linked { root, _temp, .. }) = linked_checkout(cx, responder);
    settle_cloud(&view, cx, "the association", &|s, cx| {
        s.cloud.read(cx).repository.read(cx).context.project() == Some("project-a")
    });
    view.read_with(cx, |s, cx| {
        assert!(!s.sidebar.read(cx).launcher.read(cx).is_hosted())
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle_cloud(&view, cx, "the hosted Agent", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
            && s.sidebar.read(cx).launcher.read(cx).is_hosted()
    });
    view.read_with(cx, |s, cx| {
        let offered = s.sidebar.read(cx).launcher.read(cx).visible_installations();
        assert_eq!(offered.len(), 1);
        assert_eq!(offered[0].label, crate::features::cloud::HOSTED_AGENT_LABEL);
    });
    // `History among a Cloud project's Header tools`: the hosted Project's
    // record is offered in its Header, and this Mac's Changes are not.
    draw(cx);
    assert!(cx.debug_bounds("header-cloud-history").is_some());
    assert!(cx.debug_bounds("header-changes").is_none());
    assert!(cx.debug_bounds("header-agent").is_some());
    // Opening the Agent sidebar sends nothing.
    view.update_in(cx, |s, w, cx| s.command(Command::ToggleRightSidebar, w, cx));
    draw(cx);
    std::thread::sleep(std::time::Duration::from_millis(200));
    draw(cx);
    assert_eq!(agent_requests.load(std::sync::atomic::Ordering::SeqCst), 0);
    view.update_in(cx, |s, w, cx| s.open_project(root.clone(), w, cx));
    settle_cloud(&view, cx, "the local workbench", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(root.as_path())
            && !s.sidebar.read(cx).launcher.read(cx).is_hosted()
    });
    draw(cx);
    assert!(
        cx.debug_bounds("header-cloud-history").is_none(),
        "a folder has no hosted record to show"
    );
    assert!(cx.debug_bounds("header-changes").is_some());
}

/// The account's own space as v0.4.4 lists it, and the billing service's
/// answers for it; `usage_org` is the space the usage says it belongs to,
/// `down` makes every billing read fail.
fn plan_responder(
    usage_org: &'static str,
    reads: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    down: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> crate::cloud::auth::Responder {
    use std::sync::atomic::Ordering;
    std::sync::Arc::new(move |request| {
        if request.path.starts_with("/billing") {
            reads.fetch_add(1, Ordering::SeqCst);
            if down.load(Ordering::SeqCst) {
                return Err(crate::cloud::auth::Error::Response(
                    503,
                    None,
                    Default::default(),
                ));
            }
        }
        Ok(match request.path.as_str() {
            "/organizations/" => serde_json::json!([{"id": "org-1", "name": "One",
                "is_default": true, "role": "owner", "can_manage_space": true,
                "can_create_projects": true, "billing_plan_id": "team_v2"}]),
            "/organizations/org-1/access" => serde_json::json!({"org_id": "org-1",
                "user_id": "u1", "role": "owner", "can_manage_billing": true}),
            "/billing/catalog" => serde_json::json!({"schema_version": "1.0", "plans": [
                {"id": "free", "name": "Free", "public": true}]}),
            "/billing/organizations/org-1/summary" => serde_json::json!({"org_id": "org-1",
                "plan_id": "team_v2", "status": "active", "seat_quantity": 1,
                "portal_available": true}),
            "/billing/organizations/org-1/usage" => serde_json::json!({
                "runtime": {"org_id": usage_org, "available_units": 7},
                "storage": {"logical_bytes": 1024, "limit_bytes": 2048}}),
            "/billing/organizations/org-1/operations" => serde_json::json!([]),
            "/organizations/org-1/members" => serde_json::json!([
                {"user_id": "u-owner", "email": "owner@example.com", "role": "owner"},
                {"user_id": "u-sam", "display_name": "Sam", "role": "viewer"}]),
            _ => serde_json::json!({}),
        })
    })
}
/// Signed in with Cloud on, the account's spaces read, and Settings.
fn plan_window(
    cx: &mut TestAppContext,
    responder: crate::cloud::auth::Responder,
) -> (
    Entity<Shell>,
    &mut VisualTestContext,
    Entity<crate::features::settings::SettingsWorkspaceSurface>,
) {
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "the account's spaces", &|_, cx| {
        crate::features::cloud::global_spaces_read(cx).is_some_and(|s| !s.spaces().is_empty())
    });
    let settings = view.read_with(cx, |s, cx| s.dialogs.read(cx).settings.clone());
    (view, cx, settings)
}
fn wait_for_plan(
    settings: &Entity<crate::features::settings::SettingsWorkspaceSurface>,
    cx: &mut VisualTestContext,
    ready: impl Fn(&crate::features::cloud::PlanSnapshot) -> bool,
) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !settings.read_with(cx, |s, _| ready(s.plan_snapshot())) {
        cx.run_until_parked();
        assert!(
            std::time::Instant::now() < deadline,
            "the plan did not settle"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
}

/// `useAccountPlan` (PL-5): the space's usage is shown under it.
#[gpui::test]
fn the_plan_page_shows_the_spaces_own_usage(cx: &mut TestAppContext) {
    plan_usage_case(cx, "org-1", true);
}
/// Usage the server says belongs to another space is never shown under this
/// one, and the load says it failed.
#[gpui::test]
fn the_plan_page_never_shows_another_spaces_usage(cx: &mut TestAppContext) {
    plan_usage_case(cx, "org-2", false);
}
fn plan_usage_case(cx: &mut TestAppContext, owner: &'static str, shown: bool) {
    use crate::features::settings::Page;
    let responder = plan_responder(owner, Default::default(), Default::default());
    let (_view, cx, settings) = plan_window(cx, responder);
    settings.update(cx, |s, cx| s.select_page(Page::Plan, cx));
    wait_for_plan(&settings, cx, |p| !p.loading && p.summary.is_some());
    settings.read_with(cx, |s, _| {
        let snapshot = s.plan_snapshot();
        assert_eq!(snapshot.usage.is_some(), shown);
        assert_eq!(snapshot.error, !shown);
        assert_eq!(snapshot.organization.as_deref(), Some("org-1"));
        assert_eq!(snapshot.can_manage_billing, Some(true));
    });
}

/// PL-5: with payments off nothing of billing is read; with them on the
/// space's plan is the server's, and an outage keeps the readings last held
/// and says it failed instead of inventing a Free holding.
#[gpui::test]
fn the_plan_page_reads_billing_only_with_payments_on_and_keeps_readings_through_an_outage(
    cx: &mut TestAppContext,
) {
    use crate::features::settings::Page;
    use std::sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    };
    let (reads, down) = (
        Arc::new(AtomicUsize::new(0)),
        Arc::new(AtomicBool::new(false)),
    );
    let (view, cx, settings) =
        plan_window(cx, plan_responder("org-1", reads.clone(), down.clone()));
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.payments = false)
    });
    settings.update(cx, |s, cx| s.select_page(Page::Plan, cx));
    cx.run_until_parked();
    std::thread::sleep(std::time::Duration::from_millis(100));
    cx.run_until_parked();
    assert_eq!(reads.load(Ordering::SeqCst), 0);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.payments = true)
    });
    settings.update(cx, |s, cx| s.select_page(Page::Plan, cx));
    wait_for_plan(&settings, cx, |p| !p.loading && p.summary.is_some());
    settings.read_with(cx, |s, _| {
        let summary = s.plan_snapshot().summary.as_ref().unwrap();
        assert!(summary.held());
        assert_eq!(summary.plan_id, "team_v2");
    });
    // An outage: what was read stays on the page, and the load says so.
    down.store(true, Ordering::SeqCst);
    settings.update(cx, |s, cx| s.refresh_plan_for_test(cx));
    wait_for_plan(&settings, cx, |p| !p.loading && p.error);
    settings.read_with(cx, |s, _| {
        assert_eq!(
            s.plan_snapshot()
                .summary
                .as_ref()
                .map(|s| s.plan_id.as_str()),
            Some("team_v2")
        );
    });
}

/// ST-1/ST-2, MB-1: Settings manages the account's own space as Personal:
/// its Account and Plan, never Space settings, and its Members because
/// someone else is already in it (read without opening Members).
#[gpui::test]
fn settings_manage_one_space_its_members_and_its_plan(cx: &mut TestAppContext) {
    use crate::features::settings::Page;
    let responder = plan_responder("org-1", Default::default(), Default::default());
    let (_view, cx, settings) = plan_window(cx, responder);
    settings.read_with(cx, |s, cx| {
        assert_eq!(s.settings_space(cx).map(|s| s.id), Some("org-1".to_owned()));
        assert!(s.page_available(Page::Account, cx));
        assert!(s.page_available(Page::Plan, cx));
        assert!(!s.page_available(Page::SpaceSettings, cx));
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while settings.read_with(cx, |s, _| s.space_members()).is_none() {
        cx.run_until_parked();
        assert!(std::time::Instant::now() < deadline, "members did not load");
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(
        settings.read_with(cx, |s, _| s.space_members()),
        Some((2, true))
    );
    settings.read_with(cx, |s, cx| assert!(s.page_available(Page::Space, cx)));
    settings.update(cx, |s, cx| s.select_page(Page::Space, cx));
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    settings.read_with(cx, |s, _| assert!(s.page_shown(Page::Space)));
}

/// `CreateTeamDialog`: a space starts from the place menu; once made, the
/// spaces are read again and Settings opens on its Members, the keyboard in
/// the invitation field.
#[gpui::test]
fn a_space_made_from_the_place_menu_opens_its_members_ready_to_invite(cx: &mut TestAppContext) {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    let created = Arc::new(AtomicBool::new(false));
    let base = plan_responder("org-1", Default::default(), Default::default());
    let responder: crate::cloud::auth::Responder = Arc::new({
        let created = created.clone();
        move |request| {
            let made = created.load(Ordering::SeqCst);
            let studio = serde_json::json!({"id": "org-2", "name": "Studio",
                "role": "owner", "can_manage_space": true, "can_create_projects": true,
                "billing_plan_id": "free"});
            match (request.method.as_str(), request.path.as_str()) {
                ("POST", "/organizations/") => {
                    assert_eq!(request.body, Some(serde_json::json!({"name": "Studio"})));
                    created.store(true, Ordering::SeqCst);
                    Ok(studio)
                }
                ("GET", "/organizations/") if made => Ok(serde_json::json!([
                    {"id": "org-1", "name": "One", "is_default": true, "role": "owner",
                        "can_manage_space": true, "can_create_projects": true}, studio])),
                (_, "/organizations/org-2/access") => Ok(serde_json::json!({"org_id": "org-2",
                    "user_id": "u1", "role": "owner", "can_manage_billing": true})),
                (_, "/organizations/org-2/members") => Ok(serde_json::json!([
                    {"user_id": "u1", "email": "owner@example.com", "role": "owner"}])),
                ("POST", "/organizations/org-2/invite") => {
                    assert_eq!(
                        request.body,
                        Some(serde_json::json!({"email": "sam@example.com", "role": "viewer"}))
                    );
                    Ok(serde_json::json!({"invite_url": "https://puppyone.ai/invite/studio-1"}))
                }
                _ => base(request),
            }
        }
    });
    let (view, cx, settings) = plan_window(cx, responder);
    view.update_in(cx, |s, w, cx| {
        s.navigate(chrome::navigation::Navigate::CreateSpace, w, cx)
    });
    view.read_with(cx, |s, cx| assert!(s.has_dialog("CreateSpace", cx)));
    view.update(cx, |s, cx| {
        s.cloud.update(cx, |c, cx| {
            let name = c.create_space.as_ref().unwrap().name.clone();
            name.update(cx, |input, cx| input.set_text("Studio", cx));
            c.confirm_create_space(cx)
        })
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while settings.read_with(cx, |s, _| s.space_members()) != Some((1, true)) {
        cx.run_until_parked();
        assert!(
            std::time::Instant::now() < deadline,
            "the space did not open"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    view.read_with(cx, |s, cx| {
        assert!(!s.has_dialog("CreateSpace", cx));
        assert!(s.cloud.read(cx).create_space.is_none());
    });
    cx.update(|w, cx| {
        let settings = settings.read(cx);
        assert_eq!(
            settings.settings_space(cx).map(|s| s.id),
            Some("org-2".to_owned())
        );
        assert!(settings.invite_focused(w, cx));
    });
    // Inviting a collaborator surfaces a copyable invitation link.
    settings.update(cx, |s, cx| {
        s.invite_member_for_test("sam@example.com", cx);
    });
    let invite_deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while settings.read_with(cx, |s, _| s.space_invite_url().map(str::to_owned))
        != Some("https://puppyone.ai/invite/studio-1".to_owned())
    {
        cx.run_until_parked();
        assert!(
            std::time::Instant::now() < invite_deadline,
            "the invitation link did not appear"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    draw(cx);
    let copy_bounds = cx
        .debug_bounds("space-copy-invite")
        .expect("copy button drawn");
    cx.simulate_click(copy_bounds.center(), Modifiers::none());
    assert_eq!(
        cx.read_from_clipboard().and_then(|item| item.text()),
        Some("https://puppyone.ai/invite/studio-1".to_owned())
    );
}

/// qubits `6f896add1`: Share is retired. A folder of a linked checkout
/// offers no "Share with…", and no Header tool shares the project.
#[gpui::test]
fn a_linked_folder_offers_no_share(cx: &mut TestAppContext) {
    use explorer::MenuAt;
    let (view, cx, Linked { _temp, .. }) =
        linked_checkout(cx, with_catalog(cloud_project_responder()));
    settle_cloud(&view, cx, "the association", &|s, cx| {
        s.cloud.read(cx).repository.read(cx).context.project() == Some("project-a")
    });
    let explorer = explorer_of(&view, cx);
    settle_cloud(&view, cx, "the rows", &|s, cx| {
        s.explorer
            .session
            .read(cx)
            .tree()
            .rows
            .iter()
            .any(|r| r.folder)
    });
    let folder = session_of(&view, cx).read_with(cx, |e, _| {
        e.tree().rows.iter().position(|r| r.folder).unwrap()
    });
    let share = crate::localization::t("workspace.node.shareWith").to_owned();
    let labels = explorer.update(cx, |e, cx| {
        e.open_node_menu(folder, MenuAt::Pointer(point(px(100.), px(100.))), cx);
        let labels = e.open_menu_labels(cx);
        e.dismiss_menu(cx);
        labels
    });
    assert!(!labels.is_empty());
    assert!(!labels.contains(&share));
    draw(cx);
    assert!(cx.debug_bounds("cloud-share").is_none());
}

/// Two spaces the account is in: its own, and a team it owns.
fn two_spaces_responder(
    removed: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
) -> crate::cloud::auth::Responder {
    let base = plan_responder("org-1", Default::default(), Default::default());
    std::sync::Arc::new(
        move |request| match (request.method.as_str(), request.path.as_str()) {
            (_, "/organizations/") => Ok(serde_json::json!([
            {"id": "org-1", "name": "One", "is_default": true, "role": "owner",
                "can_manage_space": true, "can_create_projects": true},
            {"id": "org-2", "name": "Studio", "role": "owner", "can_manage_space": true,
                "can_create_projects": true, "billing_plan_id": "free"}])),
            (_, "/organizations/org-2/access") => Ok(serde_json::json!({"org_id": "org-2",
            "user_id": "u1", "role": "owner", "can_manage_billing": true})),
            ("GET", "/organizations/org-2/members") => Ok(serde_json::json!([
            {"user_id": "u1", "email": "owner@example.com", "role": "owner"},
            {"user_id": "u2", "email": "mia@example.com", "role": "member"}])),
            ("DELETE", path) => {
                removed.lock().unwrap().push(path.to_owned());
                Ok(serde_json::json!({}))
            }
            _ => base(request),
        },
    )
}

/// Settings by scope (Vercel's): Personal is the account and its plan; the
/// switcher turns Settings to a team space its reader owns, which opens on
/// its Members and lists its settings; asking for Account turns it back.
#[gpui::test]
fn the_scope_switcher_turns_settings_between_personal_and_a_team(cx: &mut TestAppContext) {
    use crate::features::settings::Page;
    let (_view, cx, settings) = plan_window(cx, two_spaces_responder(Default::default()));
    settings.update(cx, |s, cx| s.select_page(Page::Account, cx));
    settings.read_with(cx, |s, cx| {
        assert_eq!(s.settings_space(cx).map(|s| s.id), Some("org-1".to_owned()));
        assert!(s.page_shown(Page::Account));
        assert!(s.page_available(Page::Plan, cx));
        assert!(!s.page_available(Page::SpaceSettings, cx));
    });
    settings.update(cx, |s, cx| s.switch_scope_for_test("org-2", cx));
    settings.read_with(cx, |s, cx| {
        assert_eq!(s.settings_space(cx).map(|s| s.id), Some("org-2".to_owned()));
        // Account is Personal's, so the team opens on its first page.
        assert!(s.page_shown(Page::Space));
        assert!(!s.page_available(Page::Account, cx));
        assert!(s.page_available(Page::SpaceSettings, cx));
    });
    // Plan stays Plan across the switch: the same page of the other space.
    settings.update(cx, |s, cx| s.select_page(Page::Plan, cx));
    settings.update(cx, |s, cx| s.switch_scope_for_test("org-1", cx));
    settings.read_with(cx, |s, cx| {
        assert_eq!(s.settings_space(cx).map(|s| s.id), Some("org-1".to_owned()));
        assert!(s.page_shown(Page::Plan));
    });
    settings.update(cx, |s, cx| s.switch_scope_for_test("org-2", cx));
    settings.update(cx, |s, cx| s.select_page(Page::Account, cx));
    settings.read_with(cx, |s, cx| {
        assert_eq!(s.settings_space(cx).map(|s| s.id), Some("org-1".to_owned()));
        assert!(s.page_shown(Page::Account));
    });
}

/// The switcher's Create space closes Settings for the window's dialog.
#[gpui::test]
fn creating_a_space_from_settings_opens_the_windows_dialog(cx: &mut TestAppContext) {
    let (view, cx, settings) = plan_window(cx, two_spaces_responder(Default::default()));
    settings.update(cx, |_, cx| {
        cx.emit(crate::features::settings::SettingsEvent::CreateSpace)
    });
    cx.run_until_parked();
    view.read_with(cx, |s, cx| assert!(s.has_dialog("CreateSpace", cx)));
}

/// Removing a member is asked from their row's menu and confirmed on the
/// line under it; only the confirmation sends it.
#[gpui::test]
fn removing_a_member_waits_for_its_confirmation(cx: &mut TestAppContext) {
    use crate::features::settings::Page;
    let removed = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let (view, cx, settings) = plan_window(cx, two_spaces_responder(removed.clone()));
    view.update_in(cx, |s, w, cx| {
        s.open_space_settings("org-2".into(), false, w, cx)
    });
    settings.read_with(cx, |s, _| assert!(s.page_shown(Page::Space)));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while settings.read_with(cx, |s, _| s.space_members()) != Some((2, true)) {
        cx.run_until_parked();
        assert!(std::time::Instant::now() < deadline, "members did not load");
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    settings.update(cx, |s, cx| s.ask_to_remove_for_test("u2", cx));
    draw(cx);
    assert!(removed.lock().unwrap().is_empty());
    cx.update(|w, cx| {
        use gpui_kit::test::TestWindowExt as _;
        w.click("space-remove-u2", cx)
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while removed.lock().unwrap().is_empty() {
        cx.run_until_parked();
        assert!(
            std::time::Instant::now() < deadline,
            "the removal was not sent"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(
        removed.lock().unwrap().as_slice(),
        ["/organizations/org-2/members/u2"]
    );
}
