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
    assert!(request.origin.x < stack.origin.x);
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
    assert!(cx.debug_bounds("cloud-agent-invite-steps").is_none());
    cx.simulate_click(seat.center(), Modifiers::none());
    draw(cx);
    assert!(cx.debug_bounds("cloud-agent-invite-steps").is_some());
    command(&view, cx, Command::Escape);
    view.read_with(cx, |s, cx| {
        assert!(s.dialogs.read(cx).is_empty());
        assert!(!s.cloud.read(cx).agents.read(cx).invite_open);
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
        let _ = w.draw(cx);
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
        let _ = w.draw(cx);
    });
    settings.update(cx, |s, cx| s.select_page(Page::Account, cx));
    wait_for_plan(&settings, cx, |p| !p.loading && p.summary.is_some());
    assert_eq!(
        settings.read_with(cx, |s, cx| s.account_plan_reading(cx)),
        Some("Personal · Team".to_owned())
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
