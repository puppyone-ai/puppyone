//! The Agent host thread end to end: a window's requests reach the
//! service on the host thread and its session frames come back.
use super::agent_host::{AgentHostHandle, AgentHostServices, window_root_authorizer};
use crate::agent::application::tests::harness::{HarnessOptions, create_service_harness};
use crate::agent::contract::operation_error::read_agent_operation_failure;
use crate::agent::ipc::agent_ipc::AgentIpcHandlers;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::rc::Rc;
use std::sync::{Arc, Mutex};

fn start() -> AgentHostHandle {
    AgentHostHandle::start(Box::new(|roots| {
        let harness = create_service_harness(HarnessOptions::default());
        Ok(AgentHostServices {
            handlers: AgentIpcHandlers {
                agent_service: Rc::new(harness.service.clone()),
                local_agent_inventory: None,
                authorize_workspace_root: window_root_authorizer(roots),
                resolve_workspace_resource: None,
                attachment_store: None,
                pick_workspace_paths: None,
            },
            service: harness.service,
            attachment_store: None,
        })
    }))
    .unwrap()
}

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

#[test]
fn serves_a_window_on_the_host_thread_and_returns_its_session_frames() {
    let host = start();
    let workspace = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(workspace.path())
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let frames: Arc<Mutex<Vec<(String, Value)>>> = Arc::default();
    let sink = frames.clone();
    host.open_window(
        7,
        Box::new(move |channel, payload| {
            sink.lock().unwrap().push((channel.to_string(), payload));
        }),
    );
    let unauthorized = block_on(host.invoke(
        7,
        "agent:session-create",
        json!({ "rootPath": root, "runtimeId": "codex" }),
    ));
    let failure = read_agent_operation_failure(&unauthorized)
        .unwrap()
        .unwrap();
    assert!(
        failure["message"]
            .as_str()
            .unwrap()
            .contains("open project")
    );

    host.authorize_roots(7, [root.clone()]);
    let snapshot = block_on(host.invoke(
        7,
        "agent:session-create",
        json!({ "rootPath": root, "runtimeId": "codex" }),
    ));
    assert!(
        read_agent_operation_failure(&snapshot).unwrap().is_none(),
        "{snapshot}"
    );
    let session = snapshot["session"].clone();
    assert_eq!(session["runtimeId"], "codex");
    let attach = block_on(host.invoke(
        7,
        "agent:session-attach",
        json!({
            "rootPath": root,
            "sessionId": session["id"],
            "instanceId": session["instanceId"],
        }),
    ));
    assert!(
        read_agent_operation_failure(&attach).unwrap().is_none(),
        "{attach}"
    );
    let control = &attach["snapshot"]["control"];
    let acknowledged = block_on(host.invoke(
        7,
        "agent:session-feed-ack",
        json!({
            "rootPath": root,
            "sessionId": session["id"],
            "instanceId": session["instanceId"],
            "subscriptionId": attach["subscriptionId"],
            "streamId": control["streamId"],
            "revision": control["revision"],
        }),
    ));
    assert!(
        read_agent_operation_failure(&acknowledged)
            .unwrap()
            .is_none(),
        "{acknowledged}"
    );
    let started = block_on(host.invoke(
        7,
        "agent:turn-start",
        json!({
            "rootPath": root,
            "sessionId": session["id"],
            "instanceId": session["instanceId"],
            "prompt": "Hello",
        }),
    ));
    assert!(
        read_agent_operation_failure(&started).unwrap().is_none(),
        "{started}"
    );
    for _ in 0..200 {
        if frames
            .lock()
            .unwrap()
            .iter()
            .any(|(channel, _)| channel == "agent:session-frame")
        {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert!(
        frames
            .lock()
            .unwrap()
            .iter()
            .any(|(channel, _)| channel == "agent:session-frame"),
        "attach={attach} started={started} frames={:?}",
        frames.lock().unwrap()
    );

    let other = block_on(host.invoke(
        9,
        "agent:session-replay",
        json!({
            "rootPath": root, "sessionId": session["id"], "instanceId": session["instanceId"],
        }),
    ));
    assert!(read_agent_operation_failure(&other).unwrap().is_some());
    host.close_window(7);
    block_on(host.shutdown());
}
