//! Explicit acceptance against installed CLIs. These use the production
//! discovery and adapter factories, never fake transports. Inference requires
//! `tools/verify-agent-runtimes.py --live` and the user's existing login.
use crate::agent::{
    application::tests_support::run_local,
    runtime::{
        agent_runtime_port::{
            AdapterOptions, AgentRuntimeAdapter, assert_agent_runtime_inspection,
        },
        agent_runtime_registry::RuntimeDefinition,
    },
    tasks::Canceller,
};
use futures_util::FutureExt;
use serde_json::{Value, json};
use std::{cell::RefCell, panic::AssertUnwindSafe, rc::Rc, time::Duration};

type Events = Rc<RefCell<Vec<Value>>>;
fn definition(id: &str) -> RuntimeDefinition {
    match id {
        "codex" => super::codex::codex_runtime_definition::create_codex_runtime_definition(
            None, None, None,
        ),
        "claude" => super::claude::claude_runtime_definition::create_claude_runtime_definition(
            Default::default(),
        ),
        "cursor" => super::cursor::cursor_runtime_definition::create_cursor_runtime_definition(
            None, None, None,
        ),
        "pi" => super::pi::pi_runtime_definition::create_pi_runtime_definition(None),
        _ => panic!("unknown acceptance runtime"),
    }
}
async fn open(id: &str, root: &str, events: Events) -> Rc<dyn AgentRuntimeAdapter> {
    let definition = definition(id);
    let cancel = Canceller::new();
    let readiness = tokio::time::timeout(
        Duration::from_secs(60),
        definition.discovery.discover(true, cancel.signal()),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        readiness["status"], "ready",
        "{id} is not ready: {}",
        readiness["code"]
    );
    let mut options = AdapterOptions::detached(readiness, root);
    options.on_event = Rc::new(move |event| {
        if std::env::var("PUPPYONE_LIVE_TRACE").as_deref() == Ok("1")
            && event["type"]
                .as_str()
                .is_some_and(|kind| kind.starts_with("turn.") || kind == "assistant.completed")
        {
            eprintln!("native event {} for {}", event["type"], event["turnId"]);
        }
        events.borrow_mut().push(event);
    });
    (definition.create_adapter)(options).unwrap()
}
async fn terminal(events: &Events, turn: &Value) -> Value {
    tokio::time::timeout(Duration::from_secs(90), async {
        loop {
            if let Some(event) = events
                .borrow()
                .iter()
                .find(|e| {
                    e["turnId"] == turn["turnId"]
                        && matches!(
                            e["type"].as_str(),
                            Some("turn.completed" | "turn.failed" | "turn.interrupted")
                        )
                })
                .cloned()
            {
                return event;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!(
            "runtime never settled turn {}; observed event types: {:?}",
            turn["turnId"],
            events
                .borrow()
                .iter()
                .map(|event| (&event["type"], &event["turnId"]))
                .collect::<Vec<_>>()
        )
    })
}
async fn completed(events: &Events, turn: &Value) {
    let outcome = terminal(events, turn).await;
    assert_eq!(
        outcome["type"],
        "turn.completed",
        "{}",
        crate::agent::agent_events::redact_secret_text(&outcome.to_string())
    );
}
async fn ready_to_interrupt(id: &str, events: &Events, turn: &Value) {
    tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            if let Some(terminal) = events.borrow().iter().find(|e| {
                e["turnId"] == turn["turnId"]
                    && matches!(
                        e["type"].as_str(),
                        Some("turn.failed" | "turn.completed" | "turn.interrupted")
                    )
            }) {
                panic!(
                    "turn settled before the interruption probe: {}",
                    crate::agent::agent_events::redact_secret_text(&terminal.to_string())
                );
            }
            if events.borrow().iter().any(|e| {
                e["turnId"] == turn["turnId"]
                    && (id == "codex" && e["type"] == "turn.started"
                        || matches!(
                            e["type"].as_str(),
                            Some("assistant.delta" | "reasoning.summary.delta")
                        ))
            }) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("runtime never confirmed execution of the turn to interrupt");
}
async fn dispose_after<T>(
    adapter: &dyn AgentRuntimeAdapter,
    future: impl std::future::Future<Output = T>,
) -> T {
    let result = AssertUnwindSafe(future).catch_unwind().await;
    let disposed = tokio::time::timeout(Duration::from_secs(10), adapter.dispose()).await;
    match result {
        Ok(value) => {
            disposed.unwrap().unwrap();
            value
        }
        Err(error) => std::panic::resume_unwind(error),
    }
}

fn handshake(id: &str) {
    run_local(async {
        let workspace = tempfile::tempdir().unwrap();
        let root = workspace.path().canonicalize().unwrap();
        let adapter = open(id, root.to_str().unwrap(), Rc::default()).await;
        dispose_after(adapter.as_ref(), async {
            let inspection = tokio::time::timeout(Duration::from_secs(60), adapter.inspect())
                .await
                .unwrap()
                .unwrap();
            assert_agent_runtime_inspection(adapter.as_ref(), &inspection, id).unwrap();
        })
        .await;
    });
}

// Separate libtest cases ensure an unavailable runtime cannot prevent the
// other installed runtimes from producing their own acceptance evidence.
#[test]
#[ignore = "requires an installed and authenticated Codex CLI; no inference"]
fn live_codex_handshake() {
    handshake("codex");
}
#[test]
#[ignore = "requires an installed and authenticated Claude CLI; no inference"]
fn live_claude_handshake() {
    handshake("claude");
}
#[test]
#[ignore = "requires an installed and authenticated Cursor CLI; no inference"]
fn live_cursor_handshake() {
    handshake("cursor");
}
#[test]
#[ignore = "requires an installed and authenticated Pi CLI; no inference"]
fn live_pi_handshake() {
    handshake("pi");
}

fn roundtrip(id: &str) {
    assert_eq!(
        std::env::var("PUPPYONE_LIVE_INFERENCE").as_deref(),
        Ok("1"),
        "run through verify-agent-runtimes.py --live"
    );
    run_local(async {
        let workspace = tempfile::tempdir().unwrap();
        let root = workspace.path().canonicalize().unwrap();
        let root = root.to_str().unwrap();
        let marker = format!("PUPPYONE_PARITY_{}", uuid::Uuid::new_v4().simple());
        let events: Events = Rc::default();
        let first = open(id, root, events.clone()).await;
        let session = dispose_after(first.as_ref(), async {
            let inspection = first.inspect().await.unwrap();
            assert_agent_runtime_inspection(first.as_ref(), &inspection, id).unwrap();
            assert_eq!(inspection["capabilities"]["resume"], true);
            // An explicit per-session model lets acceptance use an available
            // authenticated provider without changing the user's CLI default.
            let model = std::env::var(format!("PUPPYONE_LIVE_{}_MODEL", id.to_ascii_uppercase())).ok();
            let params = model.as_ref().map_or_else(|| json!({}), |model| json!({"model": model}));
            let session = first.create_session(params).await.unwrap();
            eprintln!("{id}: first session created (model: {})", model.as_deref().unwrap_or("runtime default"));
            let turn = first.start_turn(json!({"prompt":format!("Remember this acceptance marker for the next message: {marker}. Reply with exactly that marker. Do not use tools or modify any files.")})).await.unwrap();
            completed(&events, &turn).await;
            eprintln!("{id}: first turn completed");
            let all = events.borrow();
            assert!(all.iter().any(|e| e["type"] == "assistant.delta" && e["payload"]["delta"].as_str().is_some_and(|s| !s.is_empty())), "no streamed text");
            assert!(all.iter().any(|e| e["type"] == "assistant.completed" && e["payload"]["text"].as_str().is_some_and(|s| s.contains(&marker))), "missing final answer");
            session
        }).await;
        assert!(
            session["providerSessionId"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
        );
        let events: Events = Rc::default();
        let second = open(id, root, events.clone()).await;
        dispose_after(second.as_ref(), async {
            let resumed = second.resume_session(json!({"threadId":session["providerSessionId"]})).await.unwrap();
            assert_eq!(resumed["providerSessionId"], session["providerSessionId"]);
            eprintln!("{id}: session resumed through a new adapter");
            let recall = second.start_turn(json!({"prompt":"Reply with exactly the acceptance marker from my previous message. Do not use tools or modify any files."})).await.unwrap();
            completed(&events, &recall).await;
            eprintln!("{id}: recalled turn completed");
            assert!(events.borrow().iter().any(|e| e["turnId"] == recall["turnId"] && e["type"] == "assistant.completed" && e["payload"]["text"].as_str().is_some_and(|s| s.contains(&marker))), "resumed runtime lost the previous conversation");
            let turn = second.start_turn(json!({"prompt":"Without tools, write a long numbered explanation of the integers from 1 to 1000."})).await.unwrap();
            // Codex's RPC receipt can precede native execution. Its
            // turn.started notification is the authoritative stop boundary;
            // waiting for a first token would unnecessarily wait out thinking.
            // Other adapters may announce their local queue as turn.started,
            // so their native streaming activity is the execution boundary.
            ready_to_interrupt(id, &events, &turn).await;
            second.interrupt_turn(json!({"turnId":turn["turnId"]})).await.unwrap();
            assert_eq!(terminal(&events, &turn).await["type"], "turn.interrupted");
            let all = events.borrow();
            assert_eq!(all.iter().filter(|e| e["turnId"] == turn["turnId"] && matches!(e["type"].as_str(), Some("turn.completed" | "turn.failed" | "turn.interrupted"))).count(), 1);
        }).await;
    });
}
#[test]
#[ignore = "real authenticated Codex inference, resume and interruption"]
fn live_codex_roundtrip_resume_and_stop() {
    roundtrip("codex");
}
#[test]
#[ignore = "real authenticated Claude inference, resume and interruption"]
fn live_claude_stream_and_resume() {
    roundtrip("claude");
}
#[test]
#[ignore = "real authenticated Cursor inference, resume and interruption"]
fn live_cursor_stream_and_resume() {
    roundtrip("cursor");
}
#[test]
#[ignore = "real authenticated Pi inference, resume and interruption"]
fn live_pi_stream_and_resume() {
    roundtrip("pi");
}
