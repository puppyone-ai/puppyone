//! The window's Cloud services: the Agents, the plan page, the hosted
//! workbench.
use super::*;
use core::prelude::v1::test;

/// qubits `ba74bd20d`, `8a7c78a3a`: the Agents in a hosted workspace. Only
/// what is live stands on its own — someone asking to join first — and the
/// Agents at rest are one stack. A request keeps its own card under the
/// Header until it is answered; pressing a mark meanwhile only brings its
/// Deny into reach. Then any mark opens the Agents dialog, whose seat shows
/// how to invite; Escape closes it.
#[gpui::test]
fn the_agents_stand_in_the_header_and_open_their_dialog(cx: &mut TestAppContext) {
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
    let request = cx.debug_bounds("cloud-workspace-agent:r1").unwrap();
    let stack = cx.debug_bounds("cloud-workspace-agent-stack").unwrap();
    let add = cx.debug_bounds("cloud-workspace-agent-add").unwrap();
    assert!(request.origin.x < stack.origin.x);
    assert!(stack.origin.x < add.origin.x);
    // Somebody is here, so there is no empty seat in the Header.
    assert!(
        cx.debug_bounds("cloud-workspace-tool:invite-agent")
            .is_none()
    );
    // The request's own card, below the Header, until it is answered.
    let card = cx.debug_bounds("cloud-agent-request-card").unwrap();
    assert!((f32::from(card.size.width) - 288.).abs() < 0.5);
    assert!(card.origin.y > request.origin.y);
    command(&view, cx, Command::Escape);
    cx.simulate_click(point(px(400.), px(500.)), Modifiers::none());
    draw(cx);
    assert!(cx.debug_bounds("cloud-agent-request-card").is_some());
    // A mark brings the decision into keyboard reach without making it.
    cx.simulate_click(stack.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| assert!(!s.has_dialog("Agents", cx)));
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
    // Any mark opens the dialog: the roster, then the invite seat.
    let stack = cx.debug_bounds("cloud-workspace-agent-stack").unwrap();
    cx.simulate_click(stack.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.top_dialog(cx).as_deref() == Some("Agents"));
        assert_eq!(
            s.cloud.read(cx).agents.read(cx).opener,
            crate::features::cloud::Opener::More
        );
    });
    let tile = cx.debug_bounds("cloud-agent-row:c1").unwrap();
    let seat = cx.debug_bounds("cloud-agent-invite-seat").unwrap();
    assert!(tile.origin.x < seat.origin.x);
    assert!(cx.debug_bounds("cloud-agent-invite").is_none());
    // The seat turns the dialog to the invite.
    cx.simulate_click(seat.center(), Modifiers::none());
    draw(cx);
    assert!(cx.debug_bounds("cloud-agent-invite").is_some());
    assert!(cx.debug_bounds("cloud-agent-row:c1").is_none());
    command(&view, cx, Command::Escape);
    view.read_with(cx, |s, cx| {
        assert!(s.dialogs.read(cx).is_empty());
        assert!(!s.cloud.read(cx).agents.read(cx).invite_open);
    });
    // Clicking the solid circular `+` button beside existing Agents opens the
    // dialog straight into the invite.
    let add = cx.debug_bounds("cloud-workspace-agent-add").unwrap();
    cx.simulate_click(add.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.top_dialog(cx).as_deref() == Some("Agents"));
        assert_eq!(
            s.cloud.read(cx).agents.read(cx).opener,
            crate::features::cloud::Opener::Invite
        );
    });
    assert!(cx.debug_bounds("cloud-agent-invite").is_some());
    command(&view, cx, Command::Escape);
}

/// The invite, end to end: both steps from the start; copying keeps step 1
/// open on pasting and the wait; the Agent asks to join inside the dialog
/// (the Header's card waits while it is open) and, let in, ends the invite.
#[gpui::test]
fn the_invite_waits_for_the_agent_and_lets_it_in_where_it_asks(cx: &mut TestAppContext) {
    use std::sync::{Arc, Mutex};
    let (view, cx) = setup(cx);
    let base = cloud_project_responder();
    // 0: nobody, also once the message is out; 1: Claude Code asks; 2: let in.
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
            return Ok(serde_json::json!({"code": 0, "data": []}));
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
    let seat = cx
        .debug_bounds("cloud-workspace-tool:invite-agent")
        .unwrap();
    cx.simulate_click(seat.center(), Modifiers::none());
    draw(cx);
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

/// `CloudWorkspaceAgentPeople`'s cards: the one at work stands alone
/// before the stack of the ones at rest. Resting on a face shows its card
/// after a moment — where faces overlap, the one in front — then the card
/// follows the pointer across the stack at once and leaves with it. The
/// faces show no tooltip over it (the `+` beside them does). No card covers
/// the Agents dialog or a request's own card.
#[gpui::test]
fn a_face_shows_its_card_after_a_moment_and_never_over_a_request(cx: &mut TestAppContext) {
    use std::{
        sync::{Arc, Mutex},
        time::Duration,
    };
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
    let working = cx.debug_bounds("cloud-workspace-agent:c2").unwrap();
    let stack = cx.debug_bounds("cloud-workspace-agent-stack").unwrap();
    assert!(working.origin.x < stack.origin.x);
    assert!(cx.debug_bounds("cloud-workspace-agent:c1").is_none());
    // Each card hangs from its own face.
    let faces = view.read_with(cx, |s, cx| {
        s.cloud.read(cx).agent_cards.faces.borrow().clone()
    });
    for (id, selector) in [
        ("c1", "cloud-workspace-agent-face:c1"),
        ("c3", "cloud-workspace-agent-face:c3"),
    ] {
        assert_eq!(faces[id], cx.debug_bounds(selector).unwrap(), "{id}");
    }
    assert_eq!(faces["c2"], working);
    let front = cx.debug_bounds("cloud-workspace-agent-face:c1").unwrap();
    let behind = cx.debug_bounds("cloud-workspace-agent-face:c3").unwrap();
    assert!(front.origin.x < behind.origin.x && behind.origin.x < front.right());
    let cloud = view.read_with(cx, |s, _| s.cloud.clone());
    let shown =
        |cx: &mut VisualTestContext| cloud.read_with(cx, |c, _| c.agent_cards.shown.clone());
    let rest = |cx: &mut VisualTestContext, at: Duration| {
        cx.executor().advance_clock(at);
        cx.run_until_parked();
        draw(cx);
    };
    // Where the faces overlap, the one in front, after a moment.
    let overlap = point(behind.origin.x + px(1.), front.center().y);
    cx.simulate_mouse_move(overlap, None, Modifiers::none());
    draw(cx);
    assert_eq!(shown(cx), None);
    assert!(cx.debug_bounds("cloud-agent-card").is_none());
    rest(cx, Duration::from_millis(350));
    assert_eq!(shown(cx).as_deref(), Some("c1"));
    assert!(cx.debug_bounds("cloud-agent-card").is_some());
    // Across the stack the card follows at once.
    let past = point(front.right() + px(2.), front.center().y);
    cx.simulate_mouse_move(past, None, Modifiers::none());
    draw(cx);
    assert_eq!(shown(cx).as_deref(), Some("c3"));
    // However long the pointer rests there, no tooltip joins the card.
    rest(cx, Duration::from_secs(2));
    assert!(cx.debug_bounds("tooltip").is_none());
    // Off the Agents, the card goes.
    cx.simulate_mouse_move(point(px(5.), px(400.)), None, Modifiers::none());
    draw(cx);
    assert_eq!(shown(cx), None);
    assert!(cx.debug_bounds("cloud-agent-card").is_none());
    // The working mark's own card, after a moment again.
    cx.simulate_mouse_move(working.center(), None, Modifiers::none());
    draw(cx);
    assert_eq!(shown(cx), None);
    rest(cx, Duration::from_millis(350));
    assert_eq!(shown(cx).as_deref(), Some("c2"));
    // The `+` beside them is named by its tooltip.
    let add = cx.debug_bounds("cloud-workspace-agent-add").unwrap();
    cx.simulate_mouse_move(add.center(), None, Modifiers::none());
    rest(cx, Duration::from_secs(2));
    assert_eq!(shown(cx), None);
    assert!(cx.debug_bounds("tooltip").is_some());
    cx.simulate_mouse_move(point(px(5.), px(400.)), None, Modifiers::none());
    draw(cx);
    // The dialog open: no card.
    cx.simulate_click(stack.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| assert!(s.has_dialog("Agents", cx)));
    cloud.update(cx, |c, cx| c.hover_agent(Some("c1".into()), cx));
    rest(cx, Duration::from_millis(350));
    assert_eq!(shown(cx), None);
    command(&view, cx, Command::Escape);
    // An Agent asking to join: its own card, and no card over it.
    *asking.lock().unwrap() = true;
    let agents = cloud.read_with(cx, |c, _| c.agents.clone());
    agents.update(cx, |a, cx| a.refresh(cx));
    settle_cloud(&view, cx, "the request", &|s, cx| {
        !s.cloud.read(cx).agents.read(cx).requests.is_empty()
    });
    draw(cx);
    let request = cx.debug_bounds("cloud-workspace-agent:r1").unwrap();
    cx.simulate_mouse_move(request.center(), None, Modifiers::none());
    rest(cx, Duration::from_millis(350));
    assert_eq!(shown(cx), None);
    assert!(cx.debug_bounds("cloud-agent-card").is_none());
    assert!(cx.debug_bounds("cloud-agent-request-card").is_some());
    // It arrived without taking the keyboard; pressing a mark brings its
    // Deny into reach and opens nothing.
    let deny = cloud.read_with(cx, |c, _| c.deny_focus.clone());
    cx.update(|w, _| assert!(!deny.is_focused(w)));
    cx.simulate_click(request.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| assert!(!s.has_dialog("Agents", cx)));
    cx.update(|w, _| assert!(deny.is_focused(w)));
}

/// `CloudWorkspaceAgentsDialog`, opened from any Agent and closed from its
/// own button, writing nothing: everyone in one grid — an Agent asking to
/// join first, then the one at work, then the rest — and the invite seat
/// last. Removing the last Agent leaves the empty seat in the Header and the
/// dialog open. Someone the server will not show the Agents is offered
/// nothing about them.
#[gpui::test]
fn the_dialog_meets_everyone_in_one_grid_and_stays_when_the_last_one_goes(cx: &mut TestAppContext) {
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
    // From the one at work, marking it as the one that opened it; closed
    // from its own button.
    let working = cx.debug_bounds("cloud-workspace-agent:c2").unwrap();
    cx.simulate_click(working.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| assert!(s.has_dialog("Agents", cx)));
    assert_eq!(
        agents.read_with(cx, |a, _| a.opener.clone()),
        crate::features::cloud::Opener::Agent("c2".into())
    );
    let close = cx.debug_bounds("dialog-close").unwrap();
    cx.simulate_click(close.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| assert!(!s.has_dialog("Agents", cx)));
    // From the stack; then someone asks to join while it is open.
    let stack = cx.debug_bounds("cloud-workspace-agent-stack").unwrap();
    cx.simulate_click(stack.center(), Modifiers::none());
    room.lock().unwrap().asking = true;
    agents.update(cx, |a, cx| a.refresh(cx));
    settle_cloud(&view, cx, "the request", &|s, cx| {
        !s.cloud.read(cx).agents.read(cx).requests.is_empty()
    });
    draw(cx);
    view.read_with(cx, |s, cx| assert!(s.has_dialog("Agents", cx)));
    let mut tiles: Vec<(&str, Bounds<Pixels>)> = [
        "cloud-agent-invite-seat",
        "cloud-agent-row:c1",
        "cloud-agent-row:c2",
        "cloud-agent-request:r1",
    ]
    .into_iter()
    .map(|id| (id, cx.debug_bounds(id).unwrap()))
    .collect();
    tiles.sort_by(|a, b| {
        (a.1.origin.y, a.1.origin.x)
            .partial_cmp(&(b.1.origin.y, b.1.origin.x))
            .unwrap()
    });
    assert_eq!(
        tiles.iter().map(|t| t.0).collect::<Vec<_>>(),
        [
            "cloud-agent-request:r1",
            "cloud-agent-row:c2",
            "cloud-agent-row:c1",
            "cloud-agent-invite-seat"
        ]
    );
    assert!(room.lock().unwrap().writes.is_empty());
    // Let in where it asks (the kit's buttons carry no selectors).
    agents.update(cx, |a, cx| a.decide("r1", true, cx));
    settle_cloud(&view, cx, "the answer", &|s, cx| {
        s.cloud.read(cx).agents.read(cx).requests.is_empty()
    });
    // Both removed from their tiles: the last one leaves the empty seat.
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
    view.read_with(cx, |s, cx| assert!(s.has_dialog("Agents", cx)));
    assert!(cx.debug_bounds("cloud-workspace-agent-stack").is_none());
    assert!(
        cx.debug_bounds("cloud-workspace-tool:invite-agent")
            .is_some()
    );
    command(&view, cx, Command::Escape);
    // Not shown to this person: nothing about Agents at all.
    room.lock().unwrap().denied = true;
    agents.update(cx, |a, cx| a.refresh(cx));
    settle_cloud(&view, cx, "the refusal", &|s, cx| {
        !s.cloud.read(cx).agents.read(cx).manageable
    });
    draw(cx);
    for id in [
        "cloud-workspace-tool:invite-agent",
        "cloud-workspace-agent-stack",
        "cloud-workspace-agent-add",
    ] {
        assert!(cx.debug_bounds(id).is_none(), "{id}");
    }
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
/// opened from the empty seat.
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
    let seat = cx
        .debug_bounds("cloud-workspace-tool:invite-agent")
        .unwrap();
    cx.simulate_click(seat.center(), Modifiers::none());
    draw(cx);
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

/// Signing out ends an open Agents dialog and leaves no seat to open it
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
    assert!(
        cx.debug_bounds("cloud-workspace-tool:invite-agent")
            .is_none()
    );
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

/// ST-1/ST-2, MB-1, AP-1: Settings manages the account's own space: the
/// Space group lists Members and Plan under its name, Members reads the
/// space's people for its owner, and Account reads the space's plan.
#[gpui::test]
fn settings_manage_one_space_its_members_and_its_plan(cx: &mut TestAppContext) {
    use crate::features::settings::Page;
    let responder = plan_responder("org-1", Default::default(), Default::default());
    let (_view, cx, settings) = plan_window(cx, responder);
    settings.read_with(cx, |s, cx| {
        assert_eq!(s.settings_space(cx).map(|s| s.id), Some("org-1".to_owned()));
        assert!(s.page_available(Page::Space, cx));
    });
    settings.update(cx, |s, cx| s.select_page(Page::Space, cx));
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
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    settings.update(cx, |s, cx| s.select_page(Page::Account, cx));
    wait_for_plan(&settings, cx, |p| !p.loading && p.summary.is_some());
    assert_eq!(
        settings.read_with(cx, |s, cx| s.account_plan_reading(cx)),
        Some("Personal · Team".to_owned())
    );
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
