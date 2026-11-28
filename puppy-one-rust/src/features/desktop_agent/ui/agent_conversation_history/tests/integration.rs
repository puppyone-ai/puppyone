//! History controller and window input share the real GPUI scheduler.
use super::*;

fn controller_source(
    cx: &mut TestAppContext,
    client: &Rc<crate::features::desktop_agent::application::tests::fake_client::FakeClient>,
) -> crate::features::desktop_agent::application::conversation_history_controller::ConversationHistoryController{
    use crate::features::desktop_agent::application::agent_client_port::AgentClientPort;
    use crate::features::desktop_agent::application::conversation_history_controller::ConversationHistoryController;
    use crate::features::desktop_agent::infrastructure::host::window_runtime::WindowUiRuntime;
    let port: Rc<dyn AgentClientPort> = client.clone();
    cx.update(|cx| {
        let runtime = WindowUiRuntime::create(cx);
        client.set_runtime(runtime.clone());
        ConversationHistoryController::new(
            "/workspace",
            Rc::new(move || Some(port.clone())),
            runtime,
        )
    })
}

fn history_client()
-> Rc<crate::features::desktop_agent::application::tests::fake_client::FakeClient> {
    use crate::features::desktop_agent::application::tests::fake_client::FakeClient;
    let client = FakeClient::new();
    client.resolve(
        "discoverAgentRuntimes",
        json!({"runtimes": [], "warnings": []}),
    );
    client.resolve("listAgentSessions", json!({"sessions": [], "discovery": {"status": "not-requested", "warnings": []}, "warnings": []}));
    client
}

#[gpui::test]
fn stalled_runtime_inspection_and_catalog_requests_end_loading_at_their_deadlines(
    cx: &mut TestAppContext,
) {
    use crate::features::desktop_agent::application::conversation_history_controller::{
        AGENT_HISTORY_CATALOG_TIMEOUT_MS, AGENT_HISTORY_RUNTIME_TIMEOUT_MS,
    };
    for (method, deadline) in [
        ("discoverAgentRuntimes", AGENT_HISTORY_RUNTIME_TIMEOUT_MS),
        ("listAgentSessions", AGENT_HISTORY_CATALOG_TIMEOUT_MS),
    ] {
        let client = history_client();
        client.handle_once(method, |_| Box::pin(futures_util::future::pending()));
        let history = controller_source(cx, &client);
        let (_, _, cx) = setup(cx, Rc::new(history.clone()), true);
        cx.run_until_parked();
        draw(cx);
        assert_eq!(client.count("listAgentSessions"), 1);
        assert!(
            cx.debug_bounds("history-message:Loading chat history")
                .is_some(),
            "{method}"
        );
        assert!(cx.debug_bounds("history-message:No chat history").is_none());
        cx.executor()
            .advance_clock(std::time::Duration::from_millis(deadline - 1));
        cx.run_until_parked();
        draw(cx);
        assert!(
            cx.debug_bounds("history-message:Loading chat history")
                .is_some()
        );
        cx.executor()
            .advance_clock(std::time::Duration::from_millis(1));
        cx.run_until_parked();
        draw(cx);
        assert!(
            cx.debug_bounds("history-message:Loading chat history")
                .is_none()
        );
        assert!(
            cx.debug_bounds("history-message:Some chat history could not be refreshed.")
                .is_some(),
            "{method}: {:?}",
            history.get_snapshot()
        );
        assert!(cx.debug_bounds("history-message:No chat history").is_none());
        assert_eq!(client.frame_subscription_count(), 0);
        for method in [
            "createAgentSession",
            "resumeAgentSession",
            "openAgentSession",
        ] {
            assert_eq!(client.count(method), 0);
        }
        click(cx, "history-refresh");
        cx.run_until_parked();
        draw(cx);
        assert!(history.get_snapshot().loaded);
        assert!(history.get_snapshot().error.is_none());
        assert!(
            cx.debug_bounds("history-message:Some chat history could not be refreshed.")
                .is_none()
        );
        history.dispose();
    }
}

#[gpui::test]
fn initial_native_scan_keeps_the_browser_loading_until_the_recovered_row_is_published(
    cx: &mut TestAppContext,
) {
    use crate::features::desktop_agent::application::tests::support::Deferred;
    let client = history_client();
    client.resolve("discoverAgentRuntimes", json!({"runtimes": [{
        "descriptor": {"id": "codex", "displayName": "Codex", "ownership": {"session": "runtime"}},
        "readiness": {"runtimeId": "codex", "status": "ready", "code": "READY"}
    }]}));
    let native = Deferred::new();
    let native_request = native.clone();
    let catalog_calls = Rc::new(Cell::new(0));
    let calls = catalog_calls.clone();
    client.handle("listAgentSessions", move |request| {
        if request["discoverNative"] == true {
            return native_request.promise();
        }
        calls.set(calls.get() + 1);
        let sessions = if calls.get() == 1 { vec![] } else { vec![saved()] };
        Box::pin(async move { Ok(json!({"sessions": sessions, "discovery": {"status": "not-requested"}, "warnings": []})) })
    });
    let history = controller_source(cx, &client);
    let (_, _, cx) = setup(cx, Rc::new(history.clone()), true);
    cx.run_until_parked();
    draw(cx);
    assert!(
        client
            .calls("listAgentSessions")
            .iter()
            .any(|request| request["runtimeId"] == "codex" && request["discoverNative"] == true)
    );
    assert!(
        cx.debug_bounds("history-message:Loading chat history")
            .is_some()
    );
    assert!(cx.debug_bounds("history-message:No chat history").is_none());
    native.resolve(json!({"sessions": [saved()], "discovery": {"runtimeId": "codex", "status": "complete", "coverage": "complete", "indexed": 1, "warnings": []}, "warnings": []}));
    cx.run_until_parked();
    draw(cx);
    assert!(cx.debug_bounds("history-option:saved").is_some());
    assert!(
        cx.debug_bounds("history-message:Loading chat history")
            .is_none()
    );
    assert!(cx.debug_bounds("history-message:No chat history").is_none());
    assert_eq!(
        catalog_calls.get(),
        1,
        "the returned native page publishes the row directly"
    );
    history.dispose();
}

fn runtime_entry(id: &str, label: &str) -> Value {
    json!({
        "descriptor": {"id": id, "displayName": label, "ownership": {"session": "runtime"}},
        "readiness": {"runtimeId": id, "status": "ready", "code": "READY"}
    })
}

#[gpui::test]
fn clicking_load_more_keeps_the_native_cursor_and_scan_epoch_together(cx: &mut TestAppContext) {
    let client = history_client();
    client.resolve(
        "discoverAgentRuntimes",
        json!({"runtimes": [runtime_entry("codex", "Codex")]}),
    );
    client.handle("listAgentSessions", |request| {
        let page = if request["discoverNative"] != true {
            json!({"sessions": [], "discovery": {"status": "not-requested"}})
        } else if request["cursor"].is_null() {
            json!({"sessions": [saved()], "discovery": {"runtimeId": "codex", "status": "partial", "indexed": 1, "nextCursor": "provider-page-2", "scanId": "scan-epoch-a", "warnings": []}})
        } else {
            json!({"sessions": [saved()], "discovery": {"runtimeId": "codex", "status": "complete", "coverage": "complete", "indexed": 1, "nextCursor": null, "scanId": null, "warnings": []}})
        };
        Box::pin(async move { Ok(page) })
    });
    let history = controller_source(cx, &client);
    let (_, _, cx) = setup(cx, Rc::new(history.clone()), true);
    cx.run_until_parked();
    draw(cx);
    click(cx, "history-more");
    cx.run_until_parked();
    draw(cx);
    assert_eq!(
        client.last_call("listAgentSessions").unwrap(),
        json!({
            "rootPath": "/workspace", "runtimeId": "codex", "discoverNative": true,
            "limit": 20, "cursor": "provider-page-2", "scanId": "scan-epoch-a"
        })
    );
    assert!(cx.debug_bounds("history-more").is_none());
    assert!(cx.debug_bounds("history-option:saved").is_some());
    history.dispose();
}

#[gpui::test]
fn native_source_limits_and_catalog_capacity_are_visible_without_hiding_saved_chats(
    cx: &mut TestAppContext,
) {
    let client = history_client();
    client.resolve(
        "discoverAgentRuntimes",
        json!({"runtimes": [runtime_entry("codex", "Codex"), runtime_entry("cursor", "Cursor")]}),
    );
    client.handle("listAgentSessions", |request| {
        let id = request["runtimeId"].as_str().unwrap_or("");
        let native = request["discoverNative"] == true;
        let sessions = if id == "codex" { vec![saved()] } else { vec![] };
        let page = json!({"sessions": sessions, "catalogCoverage": {"truncated": true, "capacity": 500, "retained": 500}, "discovery": {
            "runtimeId": if native { Some(id) } else { None },
            "status": if !native { "not-requested" } else if id == "codex" { "complete" } else { "unsupported" },
            "coverage": "unknown", "indexed": 1, "warnings": []
        }});
        Box::pin(async move { Ok(page) })
    });
    let history = controller_source(cx, &client);
    let (_, _, cx) = setup(cx, Rc::new(history.clone()), true);
    cx.run_until_parked();
    draw(cx);
    assert!(cx.debug_bounds("history-option:saved").is_some());
    assert!(cx.debug_bounds("history-message:No chat history").is_none());
    click(cx, "history-source-summary");
    assert!(cx.debug_bounds("history-source-note:Codex: This Agent cannot confirm that its history list is complete.").is_some());
    assert!(
        cx.debug_bounds("history-source-note:Cursor: History lookup is not supported.")
            .is_some()
    );
    assert!(history.get_snapshot().catalog_coverage.unwrap().truncated);
    assert!(
        cx.debug_bounds("history-warning:The local history limit was reached. Some conversations are not retained in this list.")
            .is_some()
    );
    assert!(history.get_snapshot().error.is_none());
    history.dispose();
}

#[gpui::test]
fn one_failed_native_source_does_not_block_a_healthy_opaque_target_or_back_navigation(
    cx: &mut TestAppContext,
) {
    use crate::agent::agent_error::AgentError;
    let client = history_client();
    client.resolve("discoverAgentRuntimes", json!({"runtimes": [runtime_entry("codex", "Codex"), runtime_entry("claude", "Claude Code")]}));
    client.handle("listAgentSessions", |request| {
        let id = request["runtimeId"].as_str().map(str::to_string);
        Box::pin(async move {
            if id.as_deref() == Some("claude") { return Err(AgentError::new("Claude history unavailable")); }
            Ok(json!({"sessions": [saved()], "discovery": {"runtimeId": id,
                "status": if id.is_some() { "complete" } else { "not-requested" }, "coverage": "complete", "warnings": []}}))
        })
    });
    let history = controller_source(cx, &client);
    let (_, events, cx) = setup(cx, Rc::new(history.clone()), true);
    cx.run_until_parked();
    draw(cx);
    let requests = client.calls("listAgentSessions");
    for id in ["codex", "claude"] {
        assert!(
            requests
                .iter()
                .any(|r| r["runtimeId"] == id && r["discoverNative"] == true)
        );
    }
    assert!(
        requests
            .iter()
            .any(|r| r["rootPath"] == "/workspace" && r["discoverNative"] == false)
    );
    assert_eq!(
        history.get_snapshot().source("claude").unwrap().status,
        "failed"
    );
    assert!(cx.debug_bounds("history-option:saved").is_some());
    click(cx, "history-option:saved");
    assert_eq!(
        *events.borrow(),
        vec![
            json!({"type": "open", "id": "saved", "title": "Saved design", "runtimeId": "codex", "sessionId": "saved"})
        ]
    );
    click(cx, "history-back");
    assert_eq!(events.borrow().last().unwrap(), &json!({"type": "back"}));
    assert_eq!(client.count("openAgentSession"), 0);
    history.dispose();
}
