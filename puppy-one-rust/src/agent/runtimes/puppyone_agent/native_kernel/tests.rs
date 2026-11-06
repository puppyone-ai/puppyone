//! The in-process kernel behind the product's Built-in Agent adapter: the
//! model-connection binding, the shared Pi RPC client and its event
//! normalizer, with a scripted model in place of the network.
use super::super::model_client::Completion;
use super::super::native_model_connections::{
    NativeModelConnectionPort, connection_catalog, product_connection_id,
};
use super::super::puppyone_agent_adapter::PuppyOneAgentAdapter;
use super::super::puppyone_agent_identity::PUPPYONE_AGENT_RUNTIME_DESCRIPTOR;
use super::{Complete, CompleteRequest, native_kernel_readiness, native_kernel_spawner};
use crate::agent::application::tests_support::run_local;
use crate::agent::protocols::pi_rpc::pi_rpc_runtime_adapter::PiAdapterOptions;
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::agent::runtimes::puppyone_agent::model_connection_binding::ModelConnectionPort;
use crate::model_connections::configuration::ModelConnection;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::VecDeque;
use std::path::Path;
use std::rc::Rc;

type Events = Rc<RefCell<Vec<Value>>>;

const CONNECTION: &str = "00000000-0000-4000-8000-000000000001";

fn connection(generation: &str) -> ModelConnection {
    ModelConnection {
        id: CONNECTION.into(),
        name: "Local".into(),
        endpoint: "http://localhost:11434/v1".into(),
        model: "qwen3".into(),
        images: false,
        authenticated: false,
        credential_id: None,
        generation: generation.into(),
        managed: false,
    }
}

fn route() -> String {
    format!("{}/qwen3", product_connection_id(CONNECTION))
}

fn port(generation: Rc<RefCell<String>>) -> Rc<dyn ModelConnectionPort> {
    Rc::new(NativeModelConnectionPort::new(Rc::new(move || {
        let generation = generation.borrow().clone();
        Box::pin(async move { Ok(vec![connection(&generation)]) })
    })))
}

/// One scripted model round.
enum Step {
    Reply(Vec<(&'static str, &'static str)>, Completion),
    /// Never answers (until the turn is interrupted).
    Hang,
}

fn text(text: &str) -> Completion {
    Completion {
        text: text.into(),
        usage: json!({ "prompt_tokens": 12, "completion_tokens": 3 }),
        ..Default::default()
    }
}

fn call(id: &str, name: &str, arguments: Value) -> Completion {
    Completion {
        calls: vec![
            json!({ "id": id, "type": "function", "function": { "name": name, "arguments": arguments.to_string() } }),
        ],
        ..Default::default()
    }
}

struct Model {
    steps: RefCell<VecDeque<Step>>,
    contexts: RefCell<Vec<Vec<Value>>>,
}

fn scripted(steps: Vec<Step>) -> (Rc<Model>, Complete) {
    let model = Rc::new(Model {
        steps: RefCell::new(steps.into()),
        contexts: RefCell::default(),
    });
    let script = model.clone();
    let complete: Complete = Rc::new(move |request: CompleteRequest| {
        script.contexts.borrow_mut().push(request.context.clone());
        let step = script.steps.borrow_mut().pop_front();
        Box::pin(async move {
            match step {
                Some(Step::Reply(deltas, completion)) => {
                    for (kind, chunk) in deltas {
                        (request.delta)(kind, chunk);
                    }
                    Ok(completion)
                }
                Some(Step::Hang) => futures_util::future::pending().await,
                None => Err("The script has no more model rounds.".into()),
            }
        })
    });
    (model, complete)
}

fn adapter(
    workspace: &Path,
    data: &Path,
    complete: Complete,
    generation: Rc<RefCell<String>>,
) -> (PuppyOneAgentAdapter, Events) {
    adapter_reporting(workspace, data, complete, generation, Rc::default())
}

fn adapter_reporting(
    workspace: &Path,
    data: &Path,
    complete: Complete,
    generation: Rc<RefCell<String>>,
    persisted: Events,
) -> (PuppyOneAgentAdapter, Events) {
    let events: Events = Rc::default();
    let readiness = native_kernel_readiness(&data.to_string_lossy(), "/bin/sh").unwrap();
    let mut options = PiAdapterOptions::new(
        readiness,
        &workspace.to_string_lossy(),
        PUPPYONE_AGENT_RUNTIME_DESCRIPTOR.clone(),
        String::new(),
    );
    let sink = events.clone();
    options.on_event = Rc::new(move |event| sink.borrow_mut().push(event));
    options.project_instruction_loader = Some(Rc::new(|_| Ok(None)));
    options.spawner = Some(native_kernel_spawner(complete));
    options.on_session_persisted = Some(Rc::new(move |identity| {
        persisted.borrow_mut().push(identity)
    }));
    (
        PuppyOneAgentAdapter::new(options, Some(port(generation))).unwrap(),
        events,
    )
}

async fn until(events: &Events, kind: &str) -> Value {
    for _ in 0..1_000 {
        if let Some(event) = events.borrow().iter().find(|e| e["type"] == kind) {
            return event.clone();
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    let seen: Vec<Value> = events.borrow().iter().map(|e| e["type"].clone()).collect();
    panic!("no {kind} event; saw {seen:?}");
}

fn kinds(events: &Events) -> Vec<String> {
    events
        .borrow()
        .iter()
        .filter_map(|e| e["type"].as_str().map(str::to_string))
        .collect()
}

fn directories() -> (tempfile::TempDir, tempfile::TempDir) {
    (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap())
}

fn root(dir: &tempfile::TempDir) -> std::path::PathBuf {
    std::fs::canonicalize(dir.path()).unwrap()
}

#[test]
fn a_prompt_streams_through_the_kernel_and_settles() {
    let (workspace, data) = directories();
    run_local(async move {
        let (model, complete) = scripted(vec![Step::Reply(
            vec![("reasoning", "Thinking."), ("text", "Hel"), ("text", "lo")],
            Completion {
                reasoning: "Thinking.".into(),
                ..text("Hello")
            },
        )]);
        let generation = Rc::new(RefCell::new("g1".to_string()));
        let persisted: Events = Rc::default();
        let (adapter, events) = adapter_reporting(
            &root(&workspace),
            data.path(),
            complete,
            generation,
            persisted.clone(),
        );
        let inspection = adapter.inspect().await.unwrap();
        assert_eq!(inspection["models"][0]["model"], route());
        assert_eq!(inspection["account"]["requiresRuntimeSetup"], false);
        let session = adapter
            .create_session(json!({ "model": route() }))
            .await
            .unwrap();
        assert!(session["providerSessionId"].is_string());
        assert_eq!(session["model"], route());
        let turn = adapter
            .start_turn(json!({ "prompt": "Hello", "model": route() }))
            .await
            .unwrap();
        let completed = until(&events, "turn.completed").await;
        assert_eq!(completed["turnId"], turn["turnId"]);
        // The saved session confirms its native persistence (`sessionFile`).
        for _ in 0..200 {
            if !persisted.borrow().is_empty() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert_eq!(
            persisted.borrow()[0]["providerSessionId"],
            session["providerSessionId"]
        );
        let all = events.borrow().clone();
        let deltas: Vec<&str> = all
            .iter()
            .filter(|e| e["type"] == "assistant.delta")
            .filter_map(|e| e["payload"]["delta"].as_str())
            .collect();
        assert_eq!(deltas, ["Hel", "lo"]);
        let answer = all
            .iter()
            .find(|e| e["type"] == "assistant.completed")
            .unwrap();
        assert_eq!(answer["payload"]["text"], "Hello");
        // The answer completes the item its deltas streamed into.
        let streamed = all.iter().find(|e| e["type"] == "assistant.delta").unwrap();
        assert_eq!(answer["itemId"], streamed["itemId"]);
        assert!(kinds(&events).contains(&"reasoning.summary.delta".to_string()));
        assert!(kinds(&events).contains(&"usage.updated".to_string()));
        let context = model.contexts.borrow()[0].clone();
        assert_eq!(context[0]["role"], "system");
        assert_eq!(context[1], json!({ "role": "user", "content": "Hello" }));
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn a_write_waits_for_approval_and_reports_its_change() {
    let (workspace, data) = directories();
    let project = root(&workspace);
    let target = project.join("notes.md");
    run_local(async move {
        let (model, complete) = scripted(vec![
            Step::Reply(
                vec![],
                call(
                    "call-1",
                    "write",
                    json!({ "path": "notes.md", "content": "hi\n" }),
                ),
            ),
            Step::Reply(vec![("text", "Done")], text("Done")),
        ]);
        let generation = Rc::new(RefCell::new("g1".to_string()));
        let (adapter, events) = adapter(&project, data.path(), complete, generation);
        adapter
            .create_session(json!({ "model": route() }))
            .await
            .unwrap();
        let turn = adapter
            .start_turn(json!({ "prompt": "Write notes", "model": route() }))
            .await
            .unwrap();
        let approval = until(&events, "approval.requested").await;
        assert_eq!(approval["payload"]["kind"], "file-change");
        assert_eq!(approval["payload"]["toolName"], "write");
        assert!(
            !project.join("notes.md").exists(),
            "nothing runs before approval"
        );
        adapter
            .resolve_approval(json!({
                "requestId": approval["payload"]["requestId"],
                "decision": "accept",
                "turnId": turn["turnId"],
            }))
            .await
            .unwrap();
        until(&events, "turn.completed").await;
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "hi\n");
        let all = events.borrow().clone();
        let tool = all.iter().find(|e| e["type"] == "tool.completed").unwrap();
        assert_eq!(tool["payload"]["kind"], "file-change");
        assert_eq!(tool["payload"]["status"], "completed");
        assert!(
            tool["payload"]["changes"]
                .as_array()
                .is_some_and(|c| !c.is_empty())
        );
        // The second round saw the tool's receipt.
        let second = model.contexts.borrow()[1].clone();
        assert_eq!(second[2]["tool_calls"][0]["id"], "call-1");
        assert_eq!(second[3]["role"], "tool");
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn a_declined_command_never_runs_and_a_path_outside_the_project_ends_the_prompt() {
    let (workspace, data) = directories();
    let project = root(&workspace);
    run_local(async move {
        let (model, complete) = scripted(vec![
            Step::Reply(
                vec![],
                call("call-1", "bash", json!({ "command": "touch ran" })),
            ),
            Step::Reply(
                vec![],
                call("call-2", "read", json!({ "path": "../secret" })),
            ),
            Step::Reply(vec![("text", "unreachable")], text("unreachable")),
        ]);
        let generation = Rc::new(RefCell::new("g1".to_string()));
        let (adapter, events) = adapter(&project, data.path(), complete, generation);
        adapter
            .create_session(json!({ "model": route() }))
            .await
            .unwrap();
        let turn = adapter
            .start_turn(json!({ "prompt": "Go", "model": route() }))
            .await
            .unwrap();
        let approval = until(&events, "approval.requested").await;
        assert_eq!(approval["payload"]["kind"], "command");
        adapter
            .resolve_approval(json!({
                "requestId": approval["payload"]["requestId"],
                "decision": "decline",
                "turnId": turn["turnId"],
            }))
            .await
            .unwrap();
        until(&events, "turn.completed").await;
        assert!(!project.join("ran").exists());
        let failed: Vec<Value> = events
            .borrow()
            .iter()
            .filter(|e| e["type"] == "tool.completed")
            .map(|e| e["payload"]["status"].clone())
            .collect();
        assert_eq!(failed, ["failed", "failed"]);
        assert_eq!(
            model.contexts.borrow().len(),
            2,
            "the blocked path ended the prompt"
        );
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn interrupting_a_turn_settles_it_as_interrupted() {
    let (workspace, data) = directories();
    run_local(async move {
        let (_, complete) = scripted(vec![Step::Hang]);
        let generation = Rc::new(RefCell::new("g1".to_string()));
        let (adapter, events) = adapter(&root(&workspace), data.path(), complete, generation);
        adapter
            .create_session(json!({ "model": route() }))
            .await
            .unwrap();
        let turn = adapter
            .start_turn(json!({ "prompt": "Wait", "model": route() }))
            .await
            .unwrap();
        until(&events, "turn.started").await;
        adapter
            .interrupt_turn(json!({ "turnId": turn["turnId"] }))
            .await
            .unwrap();
        let interrupted = until(&events, "turn.interrupted").await;
        assert_eq!(interrupted["turnId"], turn["turnId"]);
        adapter.dispose().await.unwrap();
    });
}

#[test]
fn a_saved_session_reopens_with_its_history_and_a_missing_one_is_unavailable() {
    let (workspace, data) = directories();
    let project = root(&workspace);
    run_local(async move {
        let (_, complete) = scripted(vec![Step::Reply(vec![("text", "Hi")], text("Hi"))]);
        let generation = Rc::new(RefCell::new("g1".to_string()));
        let (first, events) = adapter(&project, data.path(), complete, generation.clone());
        let session = first
            .create_session(json!({ "model": route() }))
            .await
            .unwrap();
        first
            .start_turn(json!({ "prompt": "Hello", "model": route() }))
            .await
            .unwrap();
        until(&events, "turn.completed").await;
        first.dispose().await.unwrap();

        let (_, complete) = scripted(vec![]);
        let (second, _) = adapter(&project, data.path(), complete, generation.clone());
        let resumed = second
            .resume_session(json!({ "threadId": session["providerSessionId"], "model": route() }))
            .await
            .unwrap();
        assert_eq!(resumed["providerSessionId"], session["providerSessionId"]);
        let history = second.read_history_result().await.unwrap();
        let events = history["events"].as_array().unwrap();
        assert_eq!(events[0]["type"], "turn.started");
        assert_eq!(events[0]["payload"]["prompt"], "Hello");
        assert!(
            events
                .iter()
                .any(|e| e["type"] == "assistant.completed" && e["payload"]["text"] == "Hi")
        );
        second.dispose().await.unwrap();

        let (_, complete) = scripted(vec![]);
        let (third, _) = adapter(&project, data.path(), complete, generation);
        let missing = third
            .resume_session(
                json!({ "threadId": "00000000-0000-4000-8000-0000000000ff", "model": route() }),
            )
            .await
            .unwrap_err();
        assert!(
            missing.is("AGENT_PROVIDER_SESSION_UNAVAILABLE"),
            "{missing:?}"
        );
        third.dispose().await.unwrap();
    });
}

#[test]
fn the_catalog_groups_compute_models_and_a_changed_connection_revokes_its_lease() {
    let compute = |model: &str| ModelConnection {
        id: "00000000-0000-4000-8000-0000000000aa".into(),
        name: "PuppyOne".into(),
        endpoint: "https://api.example/ai".into(),
        model: model.into(),
        images: false,
        authenticated: false,
        credential_id: None,
        generation: "managed-1".into(),
        managed: true,
    };
    let catalog = connection_catalog(&[connection("g1"), compute("a/one"), compute("b/two")]);
    assert_eq!(catalog["connections"].as_array().unwrap().len(), 2);
    assert_eq!(
        catalog["catalogs"][1]["models"].as_array().unwrap().len(),
        2
    );
    assert_eq!(catalog["connections"][1]["sourceKind"], "managed");
    run_local(async {
        let generation = Rc::new(RefCell::new("g1".to_string()));
        let port = port(generation.clone());
        let lease = port.acquire(Some(route())).await.unwrap();
        assert_eq!(lease["configuration"]["selectedModelId"], "qwen3");
        assert!(lease["configuration"].get("apiKey").is_none());
        let id = lease["leaseId"].as_str().unwrap().to_string();
        port.validate(id.clone(), Some(route())).await.unwrap();
        *generation.borrow_mut() = "g2".into();
        let changed = port.validate(id, Some(route())).await.unwrap_err();
        assert!(changed.is("MODEL_BINDING_CHANGED"), "{changed:?}");
    });
}
