//! `tests/unit/agent/history/desktop-agent.history-controller.test.ts`.
use super::fake_client::FakeClient;
use super::session_feed::{settle, wait_for};
use super::support::{Deferred, assert_match};
use crate::agent::agent_error::AgentError;
use crate::agent::application::tests::harness::run;
use crate::features::desktop_agent::application::agent_client_port::{
    AgentClientPort, ClientFuture,
};
use crate::features::desktop_agent::application::conversation_history_controller::{
    ConversationHistoryController, NativeScanContinuation,
};
use crate::features::desktop_agent::application::ui_runtime::TokioUiRuntime;
use serde_json::{Value, json};
use std::cell::Cell;
use std::rc::Rc;

fn controller(root: &str, client: &Rc<FakeClient>) -> ConversationHistoryController {
    let port: Rc<dyn AgentClientPort> = client.clone();
    ConversationHistoryController::new(
        root,
        Rc::new(move || Some(port.clone())),
        TokioUiRuntime::create(),
    )
}

/// `historyClient({ listAgentSessions, runtimes })`.
fn history_client(
    list: impl Fn(Value) -> ClientFuture + 'static,
    runtimes: Vec<Value>,
) -> Rc<FakeClient> {
    let client = FakeClient::new();
    client.resolve(
        "discoverAgentRuntimes",
        json!({
            "runtimes": runtimes, "selectedRuntimeId": null, "runtime": null, "readiness": null, "account": null,
            "providers": [], "models": [], "modes": [], "commands": [], "capabilities": null, "warnings": [],
        }),
    );
    client.handle("listAgentSessions", list);
    for method in [
        "createAgentSession",
        "resumeAgentSession",
        "openAgentSession",
    ] {
        client.resolve(method, Value::Null);
    }
    client
}

fn runtime(id: &str) -> Value {
    json!({
        "descriptor": { "id": id, "displayName": id, "ownership": { "session": "runtime" } },
        "readiness": {
            "runtimeId": id, "provider": id, "status": "ready", "code": "READY", "version": "1.0.0",
            "minimumVersion": null, "message": "Ready", "selectable": true,
        },
    })
}

fn saved_session(id: &str) -> Value {
    json!({
        "id": id, "runtimeId": "codex", "runtime": { "id": "codex", "displayName": "Codex" },
        "providerSessionId": format!("native-{id}"), "title": id, "workspaceRoot": "/workspace",
        "createdAt": "2026-09-01T00:00:00.000Z", "updatedAt": "2026-09-01T00:00:00.000Z", "terminalState": "idle",
        "selectedProviderId": null, "selectedModel": null, "selectedEffort": null, "selectedMode": null,
        "origin": "native-discovery", "availability": "available", "archivedAt": null,
    })
}

fn not_requested() -> Value {
    json!({ "runtimeId": null, "status": "not-requested", "nextCursor": null, "scanId": null, "indexed": 0, "warnings": [] })
}

fn catalog(sessions: Vec<Value>, discovery: Value) -> Value {
    json!({ "sessions": sessions, "discovery": discovery, "warnings": [] })
}

fn ok(value: Value) -> ClientFuture {
    Box::pin(async move { Ok(value) })
}

fn ids(controller: &ConversationHistoryController) -> Vec<String> {
    controller
        .get_snapshot()
        .sessions
        .iter()
        .map(|entry| entry["id"].as_str().unwrap_or_default().to_string())
        .collect()
}

fn native(request: &Value) -> bool {
    request["discoverNative"] == true
}

#[test]
fn ignores_refreshed_metadata_after_the_workspace_is_deactivated() {
    run(async {
        let client = history_client(|_| ok(catalog(Vec::new(), not_requested())), Vec::new());
        let history = controller("/workspace", &client);
        history.activate();
        wait_for(|| history.get_snapshot().loaded).await;
        let discovery = Deferred::new();
        client.handle_once("discoverAgentRuntimes", discovery.handler());
        let pending = history.refresh();
        history.deactivate();
        history.activate();
        wait_for(|| history.get_snapshot().loaded).await;
        let current = history.revision();
        let mut inspection = client.implementation("discoverAgentRuntimes")(json!({}))
            .await
            .expect("inspection");
        inspection["runtimes"] = json!([runtime("codex")]);
        discovery.resolve(inspection);
        pending.await;
        assert_eq!(history.revision(), current);
        assert!(!history.get_snapshot().refreshing);
        assert!(!client.calls("listAgentSessions").iter().any(native));
        history.dispose();
    });
}

#[test]
fn refreshes_runtime_discovery_and_the_catalog_after_initial_discovery_fails() {
    run(async {
        let client = history_client(
            |request| {
                ok(if native(&request) {
                    catalog(
                        vec![saved_session("recovered")],
                        json!({ "runtimeId": "codex", "status": "complete", "indexed": 1, "nextCursor": null, "scanId": null, "warnings": [] }),
                    )
                } else {
                    catalog(Vec::new(), not_requested())
                })
            },
            vec![runtime("codex")],
        );
        client.reject_once("discoverAgentRuntimes", AgentError::new("discovery failed"));
        let history = controller("/workspace", &client);
        history.activate();
        wait_for(|| history.get_snapshot().loaded).await;
        assert!(
            history
                .get_snapshot()
                .error
                .unwrap_or_default()
                .contains("discovery failed")
        );
        let first = history.refresh();
        assert!(history.refresh().ptr_eq(&first));
        first.await;
        assert_eq!(
            client.last_call("discoverAgentRuntimes"),
            Some(json!({ "rootPath": "/workspace", "refresh": true }))
        );
        assert_eq!(client.count("discoverAgentRuntimes"), 2);
        assert_eq!(
            client
                .calls("listAgentSessions")
                .iter()
                .filter(|r| !native(r))
                .count(),
            2
        );
        let state = history.get_snapshot();
        assert_eq!(state.error, None);
        assert!(!state.refreshing);
        assert_eq!(ids(&history), vec!["recovered"]);
        assert_eq!(client.count("openAgentSession"), 0);
        history.dispose();
    });
}

#[test]
fn refreshes_a_failed_catalog_even_when_no_runtime_has_native_history() {
    run(async {
        let client = history_client(
            |_| {
                ok(catalog(
                    vec![saved_session("catalog-recovered")],
                    not_requested(),
                ))
            },
            Vec::new(),
        );
        client.reject_once("listAgentSessions", AgentError::new("catalog failed"));
        let history = controller("/workspace", &client);
        history.activate();
        wait_for(|| history.get_snapshot().loaded).await;
        history.refresh().await;
        let state = history.get_snapshot();
        assert_eq!(state.error, None);
        assert!(!state.refreshing);
        assert_eq!(ids(&history), vec!["catalog-recovered"]);
        history.dispose();
    });
}

#[test]
fn loads_catalog_pages_beyond_the_initial_window_without_a_live_session() {
    run(async {
        let client = history_client(|_| ok(catalog(Vec::new(), not_requested())), Vec::new());
        let mut first = catalog(vec![saved_session("first")], not_requested());
        first["sessionListKind"] = json!("page");
        first["catalogNextCursor"] = json!("catalog-page-2");
        let mut older = catalog(vec![saved_session("older")], not_requested());
        older["sessionListKind"] = json!("page");
        older["catalogNextCursor"] = Value::Null;
        older["excludedSessionIds"] = json!(["first"]);
        client.resolve_once("listAgentSessions", first);
        client.resolve_once("listAgentSessions", older);
        let history = controller("/workspace", &client);
        history.activate();
        wait_for(|| history.get_snapshot().loaded).await;
        assert_eq!(
            history.get_snapshot().catalog_next_cursor.as_deref(),
            Some("catalog-page-2")
        );
        history.load_more().await;
        assert_match(
            &client.calls("listAgentSessions")[1],
            &json!({ "catalogCursor": "catalog-page-2", "discoverNative": false }),
        );
        assert_eq!(ids(&history), vec!["older"]);
        assert_eq!(history.get_snapshot().catalog_next_cursor, None);
        assert_eq!(client.count("openAgentSession"), 0);
        history.deactivate();
    });
}

#[test]
fn makes_an_earlier_workspace_generation_inert_after_deactivation() {
    run(async {
        let client = history_client(|_| ok(catalog(Vec::new(), not_requested())), Vec::new());
        let first_catalog = Deferred::new();
        client.handle_once("listAgentSessions", first_catalog.handler());
        client.resolve_once(
            "listAgentSessions",
            catalog(vec![saved_session("new-generation")], not_requested()),
        );
        let history = controller("/workspace", &client);
        history.activate();
        history.deactivate();
        history.activate();
        wait_for(|| ids(&history) == vec!["new-generation"]).await;
        first_catalog.resolve(catalog(
            vec![saved_session("stale-generation")],
            not_requested(),
        ));
        settle().await;
        assert_eq!(ids(&history), vec!["new-generation"]);
        for method in [
            "createAgentSession",
            "resumeAgentSession",
            "openAgentSession",
        ] {
            assert_eq!(client.count(method), 0);
        }
    });
}

#[test]
fn keeps_concurrent_workspace_catalogs_isolated() {
    run(async {
        let client = history_client(
            |request| {
                let id = if request["rootPath"] == "/workspace/a" {
                    "workspace-a"
                } else {
                    "workspace-b"
                };
                ok(catalog(vec![saved_session(id)], not_requested()))
            },
            Vec::new(),
        );
        let first = controller("/workspace/a", &client);
        let second = controller("/workspace/b", &client);
        first.activate();
        second.activate();
        wait_for(|| ids(&first) == vec!["workspace-a"] && ids(&second) == vec!["workspace-b"])
            .await;
        let calls = client.calls("listAgentSessions");
        assert!(calls.iter().any(|r| r["rootPath"] == "/workspace/a"));
        assert!(calls.iter().any(|r| r["rootPath"] == "/workspace/b"));
    });
}

fn native_complete(runtime_id: &str) -> Value {
    json!({ "runtimeId": runtime_id, "status": "complete", "nextCursor": null, "scanId": null, "indexed": 0, "warnings": [] })
}

#[test]
fn coalesces_same_tick_refreshes_into_one_native_scan() {
    run(async {
        let native_page = Deferred::new();
        let page = native_page.clone();
        let client = history_client(
            move |request| {
                if native(&request) {
                    page.promise()
                } else {
                    ok(catalog(Vec::new(), not_requested()))
                }
            },
            vec![runtime("codex")],
        );
        let history = controller("/workspace", &client);
        history.activate();
        wait_for(|| {
            client
                .calls("listAgentSessions")
                .iter()
                .filter(|r| native(r))
                .count()
                == 1
        })
        .await;
        let first = history.refresh();
        let second = history.refresh();
        assert!(first.ptr_eq(&second));
        assert_eq!(
            client
                .calls("listAgentSessions")
                .iter()
                .filter(|r| native(r))
                .count(),
            1
        );
        native_page.resolve(catalog(Vec::new(), native_complete("codex")));
        first.await;
        assert!(!history.get_snapshot().refreshing);
    });
}

#[test]
fn marks_an_empty_history_loaded_only_after_the_initial_native_scan() {
    run(async {
        let native_page = Deferred::new();
        let page = native_page.clone();
        let client = history_client(
            move |request| {
                if native(&request) {
                    page.promise()
                } else {
                    ok(catalog(Vec::new(), not_requested()))
                }
            },
            vec![runtime("codex")],
        );
        let history = controller("/workspace", &client);
        history.activate();
        wait_for(|| {
            client
                .calls("listAgentSessions")
                .iter()
                .filter(|r| native(r))
                .count()
                == 1
        })
        .await;
        let state = history.get_snapshot();
        assert!(state.sessions.is_empty());
        assert!(state.loading && !state.loaded && state.refreshing);
        native_page.resolve(catalog(Vec::new(), native_complete("codex")));
        wait_for(|| {
            let state = history.get_snapshot();
            state.sessions.is_empty() && !state.loading && state.loaded && !state.refreshing
        })
        .await;
    });
}

#[test]
fn keeps_a_failed_continuation_retryable_instead_of_dropping_its_cursor() {
    run(async {
        let native_calls = Rc::new(Cell::new(0));
        let counter = native_calls.clone();
        let client = history_client(
            move |request| {
                if !native(&request) {
                    return ok(catalog(Vec::new(), not_requested()));
                }
                counter.set(counter.get() + 1);
                if request.get("cursor").is_none() {
                    return ok(catalog(
                        Vec::new(),
                        json!({ "runtimeId": "cursor", "status": "partial", "nextCursor": "page-2", "scanId": "scan-a", "indexed": 1, "warnings": [] }),
                    ));
                }
                if counter.get() == 2 {
                    return Box::pin(async { Err(AgentError::new("provider page failed")) });
                }
                ok(catalog(
                    Vec::new(),
                    json!({ "runtimeId": "cursor", "status": "complete", "nextCursor": null, "scanId": null, "indexed": 1, "warnings": [] }),
                ))
            },
            vec![runtime("cursor")],
        );
        let history = controller("/workspace", &client);
        history.activate();
        let continuation = NativeScanContinuation {
            cursor: "page-2".into(),
            scan_id: "scan-a".into(),
        };
        wait_for(|| history.get_snapshot().next_cursor("cursor") == Some(&continuation)).await;
        history.load_more().await;
        assert_eq!(
            history.get_snapshot().next_cursor("cursor"),
            Some(&continuation)
        );
        assert!(
            history
                .get_snapshot()
                .error
                .unwrap_or_default()
                .to_lowercase()
                .contains("provider page failed")
        );
        history.load_more().await;
        assert!(history.get_snapshot().next_cursors.is_empty());
        assert!(client.calls("listAgentSessions").iter().any(|request| {
            request["runtimeId"] == "cursor"
                && request["cursor"] == "page-2"
                && request["scanId"] == "scan-a"
        }));
    });
}

#[test]
fn publishes_a_healthy_source_while_another_native_source_waits() {
    run(async {
        let slow = Deferred::new();
        let pending = slow.clone();
        let client = history_client(
            move |request| {
                if !native(&request) {
                    return ok(catalog(Vec::new(), not_requested()));
                }
                if request["runtimeId"] == "cursor" {
                    return pending.promise();
                }
                ok(catalog(
                    vec![saved_session("ready-now")],
                    json!({ "runtimeId": "codex", "status": "complete", "indexed": 1, "nextCursor": null, "scanId": null, "warnings": [] }),
                ))
            },
            vec![runtime("codex"), runtime("cursor")],
        );
        let history = controller("/workspace", &client);
        history.activate();
        wait_for(|| ids(&history) == vec!["ready-now"]).await;
        let state = history.get_snapshot();
        assert!(state.refreshing);
        assert_eq!(
            state.source("codex").map(|s| s["status"].clone()),
            Some(json!("complete"))
        );
        slow.resolve(catalog(
            Vec::new(),
            json!({ "runtimeId": "cursor", "status": "failed", "indexed": 0, "nextCursor": null, "scanId": null, "warnings": ["source failed"] }),
        ));
        history.refresh().await;
        assert_eq!(ids(&history), vec!["ready-now"]);
        assert!(
            history
                .get_snapshot()
                .error
                .unwrap_or_default()
                .contains("cursor")
        );
        assert_eq!(client.count("openAgentSession"), 0);
        history.deactivate();
    });
}

#[test]
fn preserves_rows_and_retry_position_for_a_failed_page_and_clears_expired_ones() {
    run(async {
        let call = Rc::new(Cell::new(0));
        let counter = call.clone();
        let client = history_client(
            move |request| {
                if !native(&request) {
                    return ok(catalog(vec![saved_session("kept")], not_requested()));
                }
                counter.set(counter.get() + 1);
                if counter.get() == 1 {
                    return ok(catalog(
                        vec![saved_session("kept")],
                        json!({ "runtimeId": "codex", "status": "partial", "indexed": 1, "nextCursor": "page-2", "scanId": "scan-a", "warnings": [] }),
                    ));
                }
                ok(catalog(
                    Vec::new(),
                    json!({
                        "runtimeId": "codex", "status": "failed", "indexed": 0, "nextCursor": null, "scanId": null,
                        "warnings": ["page failed"], "retryable": counter.get() == 2,
                    }),
                ))
            },
            vec![runtime("codex")],
        );
        let history = controller("/workspace", &client);
        history.activate();
        wait_for(|| history.get_snapshot().next_cursor("codex").is_some()).await;
        history.load_more().await;
        assert_eq!(
            history.get_snapshot().next_cursor("codex"),
            Some(&NativeScanContinuation {
                cursor: "page-2".into(),
                scan_id: "scan-a".into()
            })
        );
        assert_eq!(ids(&history), vec!["kept"]);
        history.load_more().await;
        assert!(history.get_snapshot().next_cursors.is_empty());
        assert_eq!(ids(&history), vec!["kept"]);
        history.deactivate();
    });
}
