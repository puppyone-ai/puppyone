//! The window's Cloud services: the Agents, the plan page, the hosted
//! workbench.
use super::*;
use core::prelude::v1::test;

/// C-3, N-6: the Agents in a hosted workspace stand beside Share, someone
/// asking to join first. Any mark opens their card and the same mark closes
/// it; a press outside closes it; Manage agents opens over the window.
#[gpui::test]
fn the_agents_stand_beside_share_and_open_their_card(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let base = cloud_project_responder();
    let responder = with_catalog(std::sync::Arc::new(move |request| {
        let path = request.path.as_str();
        if path.ends_with("/agent-links") && request.method == reqwest::Method::GET {
            return Ok(serde_json::json!({"code": 0, "data": {"links": [],
                "connections": [{"id": "c1", "name": "Claude Code", "admission": "sign_in",
                    "grant_id": "g1", "connected_at": "2026-10-30T12:00:00Z", "expires_at": null}],
                "pending": [{"id": "r1", "name": "Codex", "admission": "sign_in",
                    "requested_at": "2026-10-30T12:00:00Z", "expires_at": "2026-10-30T12:10:00Z"}]}}));
        }
        if path.ends_with("/access/sessions") {
            return Ok(serde_json::json!({"code": 0, "data": []}));
        }
        base(request)
    }));
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle_cloud(&view, cx, "the Agents", &|s, cx| {
        s.cloud.read(cx).agents.read(cx).manageable
    });
    draw(cx);
    let request = cx.debug_bounds("cloud-workspace-agent:r1").unwrap();
    let agent = cx.debug_bounds("cloud-workspace-agent:c1").unwrap();
    let seat = cx
        .debug_bounds("cloud-workspace-tool:invite-agent")
        .unwrap();
    assert!(request.origin.x < agent.origin.x && agent.origin.x < seat.origin.x);
    cx.simulate_click(agent.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert_eq!(s.chrome.read(cx).popover, Some(Popover::Agents))
    });
    let card = cx.debug_bounds("cloud-agents-panel").unwrap();
    assert!((f32::from(card.size.width) - 320.).abs() < 0.5);
    assert!(card.origin.y > agent.origin.y);
    assert!(cx.debug_bounds("cloud-agent-row:c1").is_some());
    // Another mark moves the card; the same one closes it.
    cx.simulate_click(seat.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert_eq!(s.chrome.read(cx).popover, Some(Popover::Agents));
        assert_eq!(
            s.cloud.read(cx).agents.read(cx).opener,
            crate::features::cloud::Opener::Invite
        );
    });
    cx.simulate_click(seat.center(), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| assert_eq!(s.chrome.read(cx).popover, None));
    // A press outside closes it.
    cx.simulate_click(agent.center(), Modifiers::none());
    draw(cx);
    cx.simulate_click(point(px(400.), px(500.)), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| assert_eq!(s.chrome.read(cx).popover, None));
    // Manage agents takes the card's place, and Escape closes it.
    cx.simulate_click(agent.center(), Modifiers::none());
    draw(cx);
    let manage = cx.debug_bounds("cloud-agents-manage").unwrap();
    cx.simulate_click(manage.center(), Modifiers::none());
    settle_cloud(&view, cx, "Manage agents", &|s, cx| {
        s.cloud
            .read(cx)
            .agents
            .read(cx)
            .manage
            .as_ref()
            .is_some_and(|m| m.inventory.connections.len() == 1)
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(s.chrome.read(cx).popover, None);
        assert!(s.top_dialog(cx).as_deref() == Some("ManageAgents"));
    });
    command(&view, cx, Command::Escape);
    view.read_with(cx, |s, cx| {
        assert!(s.dialogs.read(cx).is_empty());
        assert!(s.cloud.read(cx).agents.read(cx).manage.is_none());
    });
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
        assert!(!s.sidebar.read(cx).workbench.read(cx).cloud_location())
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle_cloud(&view, cx, "the hosted Agent", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
            && s.sidebar.read(cx).workbench.read(cx).cloud_location()
    });
    view.read_with(cx, |s, cx| {
        let offered = s
            .sidebar
            .read(cx)
            .workbench
            .read(cx)
            .visible_installations();
        assert_eq!(offered.len(), 1);
        assert_eq!(
            offered[0].label,
            crate::features::desktop_agent::HOSTED_AGENT_LABEL
        );
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
            && !s.sidebar.read(cx).workbench.read(cx).cloud_location()
    });
}

/// `useAccountPlan`: "Never show one organization's money under another's
/// name." The server answering for the wrong organization shows nothing.
#[gpui::test]
fn the_plan_page_never_shows_another_organizations_usage(cx: &mut TestAppContext) {
    use crate::features::settings::Page;
    for (owner, shown) in [("org-1", true), ("org-2", false)] {
        let responder: crate::cloud::auth::Responder = std::sync::Arc::new(move |request| {
            Ok(match request.path.as_str() {
                "/organizations/" => serde_json::json!([{"id": "org-1", "name": "One"}]),
                "/billing/organizations/org-1/summary" => serde_json::json!({"org_id": "org-1",
                    "plan_id": "personal", "status": "active", "seat_quantity": 1}),
                "/billing/organizations/org-1/usage" => serde_json::json!({
                    "runtime": {"org_id": owner, "available_units": 7},
                    "storage": {"logical_bytes": 1024, "limit_bytes": 2048}}),
                _ => serde_json::json!({}),
            })
        });
        let (view, cx) = setup(cx);
        let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
        cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
        settle_cloud(&view, cx, "sign-in", &|_, cx| {
            crate::features::cloud::account::has_account(cx)
        });
        let settings = view.read_with(cx, |s, cx| s.dialogs.read(cx).settings.clone());
        settings.update(cx, |s, cx| s.select_page(Page::Plan, cx));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while settings
            .read_with(cx, |s, _| s.plan_summary_held())
            .is_none()
        {
            cx.run_until_parked();
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert_eq!(settings.read_with(cx, |s, _| s.plan_usage_read()), shown);
    }
}

/// C-13.2: with payments off no price is read; with them on the account's
/// plan is the server's, and an outage keeps the published offer.
#[gpui::test]
fn the_plan_page_reads_billing_only_with_payments_on_and_survives_an_outage(
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
    let responder: crate::cloud::auth::Responder = {
        let (reads, down) = (reads.clone(), down.clone());
        Arc::new(move |request| {
            if request.path.starts_with("/billing") || request.path == "/organizations/" {
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
                "/organizations/" => serde_json::json!([{"id": "org-1", "name": "One"}]),
                "/billing/catalog" => serde_json::json!({"schema_version": "1.0", "plans": [
                    {"id": "personal", "name": "Personal", "public": true, "purchasable": true,
                     "currency": "USD", "price_per_seat_cents": 2500}]}),
                "/billing/organizations/org-1/summary" => serde_json::json!({"org_id": "org-1",
                    "plan_id": "personal", "status": "active", "seat_quantity": 1,
                    "portal_available": true}),
                "/billing/organizations/org-1/usage" => serde_json::json!({
                    "runtime": {"org_id": "org-1"},
                    "storage": {"logical_bytes": 1024, "limit_bytes": 2048}}),
                _ => serde_json::json!({}),
            })
        })
    };
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    let settings = view.read_with(cx, |s, cx| s.dialogs.read(cx).settings.clone());
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
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while settings
        .read_with(cx, |s, _| s.plan_summary_held())
        .is_none()
    {
        cx.run_until_parked();
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(
        settings.read_with(cx, |s, _| s.plan_summary_held()),
        Some(true)
    );
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    // An outage leaves the page on the published offer, with no plan held.
    down.store(true, Ordering::SeqCst);
    settings.update(cx, |s, cx| s.select_page(Page::Plan, cx));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while settings
        .read_with(cx, |s, _| s.plan_summary_held())
        .is_some()
    {
        cx.run_until_parked();
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
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
