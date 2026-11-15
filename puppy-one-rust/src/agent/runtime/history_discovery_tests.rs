//! Native history list acceptance: malformed pages must never become deletion evidence.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::application::tests_support::run_local;
use crate::agent::protocols::acp::acp_client::AcpClient;
use crate::agent::protocols::acp::acp_history_discovery::discover_acp_history;
use crate::agent::runtimes::claude::claude_agent_sdk::{
    ClaudeQuery, ClaudeSdk, ForkSessionOptions, ListSessionsOptions, PromptSource, QueryOptions,
    SessionMessagesOptions,
};
use crate::agent::runtimes::claude::claude_history_discovery::discover_claude_history;
use crate::agent::runtimes::codex::codex_history_discovery::discover_codex_history;
use crate::agent::runtimes::codex::codex_history_reader::CodexRequest;
use crate::agent::tasks::Canceller;
use crate::agent::transports::rpc_connection::fake::FakeConnection;
use core::prelude::v1::test;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

#[derive(Default)]
struct HistorySdk {
    calls: RefCell<Vec<ListSessionsOptions>>,
    pages: RefCell<VecDeque<Vec<Value>>>,
}
impl ClaudeSdk for HistorySdk {
    fn query(&self, _: Rc<dyn PromptSource>, _: QueryOptions) -> AgentResult<Rc<dyn ClaudeQuery>> {
        panic!("history list must not start a conversation")
    }
    fn list_sessions(
        &self,
        options: ListSessionsOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Vec<Value>>> {
        self.calls.borrow_mut().push(options);
        let page = self
            .pages
            .borrow_mut()
            .pop_front()
            .expect("unexpected SDK list call");
        Box::pin(async move { Ok(page) })
    }
    fn get_session_info(
        &self,
        _: &str,
        _: Option<&str>,
    ) -> LocalBoxFuture<'static, AgentResult<Option<Value>>> {
        panic!("metadata list must not open a session")
    }
    fn get_session_messages(
        &self,
        _: &str,
        _: SessionMessagesOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Vec<Value>>> {
        panic!("metadata list must not read transcripts")
    }
    fn fork_session(
        &self,
        _: &str,
        _: ForkSessionOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Value>> {
        panic!("metadata list must not fork a session")
    }
}

#[test]
fn claude_advances_raw_pages_even_when_workspace_filtering_removes_every_row() {
    run_local(async {
        let sdk = HistorySdk {
            pages: RefCell::new(VecDeque::from([
                vec![json!({ "sessionId": "other", "cwd": "/other", "lastModified": 0 })],
                vec![json!({ "sessionId": "wanted", "cwd": "/workspace", "lastModified": 0 })],
            ])),
            ..Default::default()
        };
        let first = discover_claude_history(&sdk, "/workspace", None, Some(&json!(1)), None)
            .await
            .unwrap();
        assert_eq!(first["sessions"], json!([]));
        assert_eq!(first["nextCursor"], "1");
        let next = discover_claude_history(
            &sdk,
            "/workspace",
            first["nextCursor"].as_str(),
            Some(&json!(1)),
            None,
        )
        .await
        .unwrap();
        assert_eq!(next["sessions"].as_array().unwrap().len(), 1);
        assert_eq!(next["sessions"][0]["providerSessionId"], "wanted");
        assert_eq!(
            sdk.calls.borrow()[1],
            ListSessionsOptions {
                dir: Some("/workspace".into()),
                offset: Some(1),
                limit: Some(1),
                include_worktrees: None
            }
        );
    });
}

#[test]
fn codex_rejects_missing_null_object_and_text_pages_instead_of_claiming_an_empty_source() {
    run_local(async {
        for data in [
            None,
            Some(Value::Null),
            Some(json!({})),
            Some(json!("invalid")),
        ] {
            let mut result = json!({ "nextCursor": null });
            if let Some(data) = data {
                result["data"] = data;
            }
            let request: Rc<CodexRequest> = Rc::new(move |_, _| {
                let result = result.clone();
                Box::pin(async move { Ok(result) })
            });
            let error = discover_codex_history(request.as_ref(), "/workspace", None, None, None)
                .await
                .unwrap_err();
            assert!(error.message.contains("invalid session page"));
        }
    });
}

#[test]
fn codex_round_trips_opaque_native_cursors_without_trimming() {
    run_local(async {
        let calls = Rc::new(RefCell::new(Vec::new()));
        let captured = calls.clone();
        let cursor = " opaque cursor with spaces ";
        let request: Rc<CodexRequest> = Rc::new(move |method, params| {
            captured.borrow_mut().push((method.to_string(), params));
            Box::pin(async move { Ok(json!({ "data": [], "nextCursor": cursor })) })
        });
        let page = discover_codex_history(request.as_ref(), "/workspace", Some(cursor), None, None)
            .await
            .unwrap();
        assert_eq!(page["nextCursor"], cursor);
        assert_eq!(calls.borrow().len(), 1);
        assert_eq!(calls.borrow()[0].0, "thread/list");
        assert_eq!(calls.borrow()[0].1["cursor"], cursor);
    });
}

#[test]
fn acp_uses_the_servers_page_size_and_rejects_malformed_lists() {
    run_local(async {
        for legacy in [false, true] {
            let connection = FakeConnection::new();
            connection.result("initialize", json!({ "protocolVersion": 1, "agentCapabilities": if legacy { json!({ "listSessions": true }) } else { json!({ "sessionCapabilities": { "list": {} } }) } }));
            let sessions: Vec<Value> = (0..35)
                .map(|i| json!({ "sessionId": format!("native/{i}"), "cwd": "/workspace" }))
                .collect();
            connection.result(
                "session/list",
                json!({ "sessions": sessions, "nextCursor": " next " }),
            );
            let client = AcpClient::new(
                connection.clone(),
                None,
                Default::default(),
                Default::default(),
            );
            client.initialize(None, None).await.unwrap();
            let page =
                discover_acp_history(&client, "/workspace", "Agent", Some(" previous "), None)
                    .await
                    .unwrap();
            assert_eq!(page["sessions"].as_array().unwrap().len(), 35);
            for (i, row) in page["sessions"].as_array().unwrap().iter().enumerate() {
                assert_eq!(row["providerSessionId"], format!("native/{i}"));
            }
            assert_eq!(page["nextCursor"], " next ");
            assert_eq!(page["coverage"]["scopeComplete"], false);
            assert_eq!(
                connection.requests_of("session/list"),
                [json!({ "cwd": "/workspace", "cursor": " previous " })]
            );
            connection.result("session/list", json!({ "sessions": null }));
            assert!(
                discover_acp_history(&client, "/workspace", "Agent", None, None)
                    .await
                    .unwrap_err()
                    .message
                    .contains("invalid session page")
            );
            client.dispose();
        }
    });
}

#[test]
fn cancelled_claude_history_query_never_calls_the_native_sdk() {
    run_local(async {
        let sdk = HistorySdk::default();
        let controller = Canceller::new();
        controller.cancel(AgentError::new("cancelled"));
        let error =
            discover_claude_history(&sdk, "/workspace", None, None, Some(&controller.signal()))
                .await
                .unwrap_err();
        assert!(error.message.contains("cancelled"));
        assert!(sdk.calls.borrow().is_empty());
    });
}
