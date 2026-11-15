//! The Agent host thread end to end: a window's typed requests reach the
//! service on the host thread and its session frames come back as events.
use super::agent_host::{AgentHostHandle, AgentHostServices, window_root_authorizer};
use crate::agent::application::agent_requests::AgentRequests;
use crate::agent::application::tests::harness::{HarnessOptions, create_service_harness};
use crate::agent::contract::dto::SessionFrame;
use crate::agent::contract::protocol::{
    AgentEvent, AgentRequest, AgentResponse, CreateSession, FeedAck, SessionTarget, StartTurn,
};
use core::prelude::v1::test;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

fn start() -> AgentHostHandle {
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
    let events: Arc<Mutex<Vec<AgentEvent>>> = Arc::default();
    let sink = events.clone();
    host.open_window(7, Box::new(move |event| sink.lock().unwrap().push(event)));
    let create = || {
        AgentRequest::CreateSession(CreateSession {
            root_path: root.clone(),
            runtime_id: Some("codex".into()),
            ..Default::default()
        })
    };
    let unauthorized = block_on(host.request(7, create())).unwrap_err();
    assert!(unauthorized.message.contains("open project"));

    host.authorize_roots(7, [root.clone()]);
    let Ok(AgentResponse::Snapshot(snapshot)) = block_on(host.request(7, create())) else {
        panic!("a snapshot");
    };
    let session = snapshot.session.clone();
    assert_eq!(session.runtime_id.as_deref(), Some("codex"));
    let target = SessionTarget {
        root_path: root.clone(),
        session_id: session.id.clone(),
        instance_id: session.instance_id.clone(),
    };
    let Ok(AgentResponse::FeedReceipt(receipt)) =
        block_on(host.request(7, AgentRequest::AttachSession(target.clone())))
    else {
        panic!("a receipt");
    };
    let control = receipt
        .snapshot
        .as_ref()
        .expect("a valid snapshot")
        .control
        .clone();
    let acknowledged = block_on(host.request(
        7,
        AgentRequest::AcknowledgeFeed(FeedAck {
            root_path: root.clone(),
            session_id: session.id.clone(),
            instance_id: session.instance_id.clone(),
            subscription_id: receipt.subscription_id.clone(),
            stream_id: control.stream_id.clone(),
            revision: control.revision,
        }),
    ));
    assert!(
        matches!(acknowledged, Ok(AgentResponse::FeedAcknowledgement(_))),
        "{acknowledged:?}"
    );
    let started = block_on(host.request(
        7,
        AgentRequest::StartTurn(StartTurn {
            root_path: root.clone(),
            session_id: session.id.clone(),
            preconditions: crate::agent::contract::protocol::CommandPreconditions {
                instance_id: session.instance_id.clone(),
                ..Default::default()
            },
            prompt: "Hello".into(),
            ..Default::default()
        }),
    ));
    assert!(started.is_ok(), "{started:?}");
    let delta = || {
        events
            .lock()
            .unwrap()
            .iter()
            .any(|event| matches!(event, AgentEvent::SessionFrame(SessionFrame::Delta { .. })))
    };
    for _ in 0..200 {
        if delta() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert!(delta(), "events={:?}", events.lock().unwrap());

    let other = block_on(host.request(
        9,
        AgentRequest::AttachSession(SessionTarget {
            root_path: root,
            session_id: session.id.clone(),
            instance_id: None,
        }),
    ));
    assert!(other.is_err());
    host.close_window(7);
    block_on(host.shutdown());
}

#[test]
fn shutdown_waits_for_active_sessions_or_inspected_sidecars_and_coalesces_duplicate_quits() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;
    for has_session in [false, true] {
        let disposing = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let calls = Arc::new(AtomicUsize::new(0));
        let (prepared, ready) = tokio::sync::oneshot::channel();
        let (host_disposing, host_release, host_calls) =
            (disposing.clone(), release.clone(), calls.clone());
        let host = AgentHostHandle::start(Box::new(move |roots| {
            let backend_dispose = if !has_session {
                let disposing = host_disposing.clone();
                let release = host_release.clone();
                let calls = host_calls.clone();
                Some(Rc::new(move || {
                    calls.fetch_add(1, Ordering::SeqCst);
                    disposing.notify_one();
                    let release = release.clone();
                    Box::pin(async move {
                        release.notified().await;
                        Ok(())
                    })
                        as futures_util::future::LocalBoxFuture<
                            'static,
                            crate::agent::agent_error::AgentResult<()>,
                        >
                })
                    as Rc<
                        dyn Fn() -> futures_util::future::LocalBoxFuture<
                            'static,
                            crate::agent::agent_error::AgentResult<()>,
                        >,
                    >)
            } else {
                None
            };
            let harness = create_service_harness(HarnessOptions {
                runtime_dispose: backend_dispose,
                ..Default::default()
            });
            let service = harness.service.clone();
            let services = AgentHostServices {
                requests: AgentRequests {
                    agent_service: Rc::new(service.clone()),
                    local_agent_inventory: None,
                    authorize_workspace_root: window_root_authorizer(roots),
                    resolve_workspace_resource: None,
                    attachment_store: None,
                    pick_workspace_paths: None,
                },
                service,
                attachment_store: None,
            };
            tokio::task::spawn_local(async move {
                if has_session {
                    let sender = crate::agent::application::tests::harness::create_sender(98).0;
                    harness
                        .service
                        .create_session(
                            &sender,
                            &serde_json::json!({"runtimeId":"codex"}),
                            "/workspace",
                        )
                        .await
                        .unwrap();
                } else {
                    harness
                        .service
                        .discover_providers(
                            &serde_json::json!({"runtimeId":"codex"}),
                            Some("/workspace"),
                        )
                        .await
                        .unwrap();
                    assert_eq!(harness.service.get_session_count(), 0);
                }
                assert_eq!(harness.adapters.borrow().len(), 1);
                if has_session {
                    harness.adapter(0).once("dispose", move |_| {
                        host_calls.fetch_add(1, Ordering::SeqCst);
                        host_disposing.notify_one();
                        let release = host_release.clone();
                        Box::pin(async move {
                            release.notified().await;
                            Ok(serde_json::Value::Null)
                        })
                    });
                }
                prepared.send(()).unwrap();
            });
            Ok(services)
        }))
        .unwrap();
        block_on(async {
            tokio::time::timeout(Duration::from_secs(3), ready)
                .await
                .unwrap()
                .unwrap();
            let first = host.shutdown();
            let second = host.shutdown();
            tokio::pin!(first);
            tokio::pin!(second);
            tokio::time::timeout(Duration::from_secs(3), disposing.notified())
                .await
                .unwrap();
            assert!(matches!(
                futures_util::poll!(&mut first),
                std::task::Poll::Pending
            ));
            assert!(matches!(
                futures_util::poll!(&mut second),
                std::task::Poll::Pending
            ));
            release.notify_one();
            tokio::time::timeout(Duration::from_secs(3), async {
                first.await;
                second.await
            })
            .await
            .unwrap();
        });
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn an_empty_host_does_not_hold_up_an_updater_quit() {
    let host = start();
    block_on(async {
        tokio::time::timeout(std::time::Duration::from_secs(2), host.shutdown())
            .await
            .unwrap();
        // A repeated quit after shutdown also completes without another drain.
        tokio::time::timeout(std::time::Duration::from_secs(2), host.shutdown())
            .await
            .unwrap();
    });
}
