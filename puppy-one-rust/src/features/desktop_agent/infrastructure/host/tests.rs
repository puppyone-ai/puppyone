//! The Renderer controllers over the window client and the Agent host
//! thread, end to end.
use super::agent_host_client::AgentHostClient;
use super::project_agent_client::create_project_agent_client_provider;
use crate::agent::application::agent_requests::AgentRequests;
use crate::agent::application::tests::harness::{HarnessOptions, create_service_harness, run};
use crate::agent::host::agent_host::{AgentHostHandle, AgentHostServices, window_root_authorizer};
use crate::features::desktop_agent::application::agent_client_port::AgentClientPort;
use crate::features::desktop_agent::application::agent_controller_state::{
    AgentSessionPreparation, ReplicaStatus,
};
use crate::features::desktop_agent::application::agent_session_controller::AgentSessionController;
use crate::features::desktop_agent::application::ui_runtime::TokioUiRuntime;
use std::rc::Rc;

fn start_host() -> AgentHostHandle {
    AgentHostHandle::start(Box::new(|roots| {
        let harness = create_service_harness(HarnessOptions::default());
        Ok(AgentHostServices {
            requests: AgentRequests {
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
    .expect("host")
}

async fn eventually(condition: impl Fn() -> bool) {
    for _ in 0..400 {
        if condition() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    assert!(condition(), "the condition never held");
}

#[test]
fn a_controller_prepares_a_session_and_renders_its_turn_through_the_host() {
    let host = start_host();
    let workspace = tempfile::tempdir().expect("workspace");
    let root = std::fs::canonicalize(workspace.path())
        .expect("root")
        .to_string_lossy()
        .into_owned();
    host.authorize_roots(11, [root.clone()]);
    let runtime = TokioUiRuntime::create();
    let shutdown = host.clone();
    run(async move {
        let client = AgentHostClient::connect(host, 11, &runtime);
        let port: Rc<dyn AgentClientPort> = client.clone();
        let provider = create_project_agent_client_provider(Rc::new(move || Some(port.clone())));
        let controller = AgentSessionController::new(&root, provider, runtime.clone());
        assert!(
            controller
                .initialize_for_runtime("codex")
                .await
                .expect("initialize")
        );
        assert!(controller.prepare_session().await);
        let state = controller.get_snapshot();
        assert_eq!(state.session_preparation, AgentSessionPreparation::Ready);
        eventually(|| controller.get_snapshot().replica_status == ReplicaStatus::Live).await;
        assert!(controller.submit("Hello").await.expect("submit"));
        eventually(|| {
            controller.store().read(|state| {
                state
                    .projection
                    .messages
                    .iter()
                    .any(|message| message.text == "Hello")
            })
        })
        .await;
        assert_eq!(controller.get_snapshot().error, None);
        controller.dispose(false);
        drop(client);
    });
    run(async move { shutdown.shutdown().await });
}

#[test]
fn an_unopened_project_fails_with_the_structured_operation_failure() {
    let host = start_host();
    let runtime = TokioUiRuntime::create();
    let shutdown = host.clone();
    run(async move {
        let client = AgentHostClient::connect(host, 12, &runtime);
        let port: Rc<dyn AgentClientPort> = client.clone();
        let controller = AgentSessionController::new(
            "/not-open",
            Rc::new(move || Some(port.clone())),
            runtime.clone(),
        );
        controller.initialize(false).await.expect("initialize");
        let error = controller.get_snapshot().error.expect("error");
        assert_eq!(error.code, "unknown");
        assert!(
            error.operation.as_ref().is_some_and(|o| !o.code.is_empty()),
            "{error:?}"
        );
        assert!(
            error
                .detail
                .as_deref()
                .unwrap_or_default()
                .contains("open project"),
            "{error:?}"
        );
        controller.dispose(false);
    });
    run(async move { shutdown.shutdown().await });
}
