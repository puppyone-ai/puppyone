//! Pure-Rust authority tests for `ModelConnectionService`:
//! managed compute trial/failure/context_window, split config vs security
//! generations, active lease revocation, tool-capability gating, and
//! `AgentHost` automatic `RuntimeReadinessStore` invalidation.
use super::{
    ComputeAccount, ServiceComputeAccount,
    configuration::{self, Auth, Driver, ModelConnection, SourceKind},
    drivers::CatalogModel,
    managed::{Answer, Failed, ManagedGateway, ManagedSession},
    service::ModelConnectionService,
    snapshot::{CatalogStatus, ConnectionCatalog},
    wallet::{ErrorCode, Reason, UsageStatus},
};
use crate::agent::contract::protocol::{AgentRequest, AgentResponse, RuntimeQuery};
use crate::agent::host::agent_host::{AgentHostHandle, AgentHostOptions};
use crate::cloud::auth::model::{Binding, Environment};
use reqwest::Method;
use serde_json::{Value, json};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

struct ScriptedGateway {
    catalog: Mutex<Result<Value, Failed>>,
    balance: Mutex<Result<Value, Failed>>,
    trial: Mutex<Result<Value, Failed>>,
    usage: Mutex<Result<Value, Failed>>,
    calls: Mutex<Vec<String>>,
}
impl ScriptedGateway {
    fn new(trial_credit: i64, initial_balance: i64) -> Arc<Self> {
        Arc::new(Self {
            catalog: Mutex::new(Ok(json!({
                "sandbox": true,
                "trial_credit_micro_usd": trial_credit,
                "packs": [{"id": "pack-5", "price_cents": 500}],
                "models": [
                    {"id": "deepseek/deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash", "context_window": 1_000_000}
                ]
            }))),
            balance: Mutex::new(Ok(json!({
                "balance_micro_usd": initial_balance,
                "reserved_micro_usd": 0,
                "available_micro_usd": initial_balance,
                "trial_granted_micro_usd": 0
            }))),
            trial: Mutex::new(Ok(json!({
                "balance_micro_usd": trial_credit,
                "reserved_micro_usd": 0,
                "available_micro_usd": trial_credit,
                "trial_granted_micro_usd": trial_credit
            }))),
            usage: Mutex::new(Err(Failed)),
            calls: Mutex::new(vec![]),
        })
    }
}
impl ManagedGateway for ScriptedGateway {
    fn public(&self, path: &str) -> Answer {
        self.calls.lock().unwrap().push(format!("PUBLIC {path}"));
        let res = self.catalog.lock().unwrap().clone();
        Box::pin(async move { res })
    }
    fn request(
        &self,
        _binding: Option<Binding>,
        method: Method,
        path: &str,
        _body: Option<Value>,
        _idempotency_key: Option<String>,
    ) -> Answer {
        self.calls.lock().unwrap().push(format!("{method} {path}"));
        let res = match path {
            "/ai/balance" => self.balance.lock().unwrap().clone(),
            "/ai/trial" => {
                let granted = self.trial.lock().unwrap().clone();
                if granted.is_ok() {
                    *self.balance.lock().unwrap() = granted.clone();
                }
                granted
            }
            p if p.starts_with("/ai/usage/") => self.usage.lock().unwrap().clone(),
            _ => Err(Failed),
        };
        Box::pin(async move { res })
    }
}

fn test_binding(user: &str, epoch: u64) -> Binding {
    Binding {
        user: user.into(),
        instance: uuid::Uuid::new_v4(),
        epoch,
        environment: Environment::new(
            "https://qubits-api.puppyone.ai/api/v1",
            "https://qubits-try.puppyone.ai",
        )
        .unwrap(),
    }
}

#[test]
fn managed_service_claims_trial_preserves_context_window_and_never_caches_failures() {
    let dir = tempfile::tempdir().unwrap();
    let gw = ScriptedGateway::new(1_000_000, 0);
    // Start with a gateway outage on /ai/balance.
    *gw.balance.lock().unwrap() = Err(Failed);
    let service = ModelConnectionService::with_gateway(
        dir.path().to_path_buf(),
        None,
        Some(gw.clone()),
        Duration::from_secs(5),
    );
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        service.set_payments(true);
        service.adopt_session(Some(ManagedSession::of(test_binding("u1", 1))));
        service.refresh_managed_now(true).await;
        let snap = service.snapshot();
        assert_eq!(snap.managed.reason, Reason::GatewayUnavailable);
        assert_eq!(snap.managed.error_code, Some(ErrorCode::GatewayUnavailable));
        assert!(snap.agent_connections().is_empty());

        // Gateway recovers: forced refresh claims trial automatically and
        // surfaces DeepSeek with its real 1M context window.
        *gw.balance.lock().unwrap() = Ok(json!({
            "balance_micro_usd": 0,
            "reserved_micro_usd": 0,
            "available_micro_usd": 0,
            "trial_granted_micro_usd": 0
        }));
        service.refresh_managed_now(true).await;
        let snap = service.snapshot();
        assert_eq!(snap.managed.reason, Reason::Ready);
        assert_eq!(snap.managed.balance.unwrap().available_micro_usd, 1_000_000);
        let eligible = snap.agent_connections();
        assert_eq!(eligible.len(), 1);
        assert_eq!(eligible[0].model, "deepseek/deepseek-v4.1-flash");
        assert_eq!(eligible[0].manual_context_window, Some(1_000_000));
        assert!(
            gw.calls
                .lock()
                .unwrap()
                .iter()
                .any(|c| c == "POST /ai/trial"),
            "trial must be claimed automatically"
        );

        // Acquiring a managed lease succeeds; disabling Payments revokes it
        // immediately via its Cancellation token.
        let route = format!("mc_{}/{}", eligible[0].id.to_lowercase(), eligible[0].model);
        let acquired = service.acquire_lease(Some(&route)).unwrap();
        let lease_id = acquired["leaseId"].as_str().unwrap().to_owned();
        let cancel = service.lease_cancellation(&lease_id).unwrap();
        assert!(!cancel.is_cancelled());
        service.set_payments(false);
        assert!(
            cancel.is_cancelled(),
            "disabling Payments must cancel active managed lease"
        );
        assert!(service.validate_lease(&lease_id, Some(&route)).is_err());
    });
}

#[test]
fn custom_connections_require_tool_evidence_and_preserve_leases_across_rename() {
    let dir = tempfile::tempdir().unwrap();
    let service = ModelConnectionService::with_gateway(
        dir.path().to_path_buf(),
        None,
        None,
        Duration::from_secs(5),
    );
    let id = uuid::Uuid::new_v4().to_string();
    let conn = ModelConnection {
        id: id.clone(),
        name: "Local Ollama".into(),
        endpoint: "http://127.0.0.1:11434/v1".into(),
        source_kind: SourceKind::Local,
        driver: Driver::Ollama,
        auth: Auth::None,
        default_model_id: Some("qwen3:8b".into()),
        manual_context_window: Some(32768),
        ..Default::default()
    };
    let (saved, _) = configuration::save_at(dir.path(), conn, None).unwrap();
    service.reload_saved().unwrap();

    // Before its catalog is read, the model the user chose (the default)
    // is offered with the connection's context budget; nothing else is.
    let chosen = service.snapshot().agent_connections();
    assert_eq!(
        chosen.iter().map(|c| c.model.as_str()).collect::<Vec<_>>(),
        ["qwen3:8b"]
    );
    assert_eq!(chosen[0].manual_context_window, Some(32768));

    // Once catalog reports `tools: Some(true)` for qwen3:8b, `tools: Some(false)`
    // for embed-only and nothing for a model the user did not choose, ONLY
    // qwen3:8b becomes eligible with its real context window: a model needs
    // tool evidence or the user's choice, and a refusal of tools wins.
    service.set_catalog_for_test(ConnectionCatalog {
        connection_id: id.clone(),
        config_generation: saved.generation.clone(),
        status: CatalogStatus::Ready,
        models: vec![
            CatalogModel {
                id: "qwen3:8b".into(),
                name: "Qwen3 8B".into(),
                loaded: Some(true),
                tools: Some(true),
                images: Some(true),
                context: Some(65536),
                max_context: Some(65536),
                remote: false,
            },
            CatalogModel {
                id: "no-tools".into(),
                name: "No Tools".into(),
                loaded: Some(true),
                tools: Some(false),
                images: Some(false),
                context: Some(8192),
                max_context: Some(8192),
                remote: false,
            },
            CatalogModel {
                id: "unknown-tools".into(),
                name: "Unknown Tools".into(),
                loaded: Some(true),
                tools: None,
                images: None,
                context: Some(8192),
                max_context: Some(8192),
                remote: false,
            },
        ],
        error_code: None,
    });
    let eligible = service.snapshot().agent_connections();
    assert_eq!(eligible.len(), 1);
    assert_eq!(eligible[0].model, "qwen3:8b");
    assert_eq!(eligible[0].manual_context_window, Some(65536));
    assert_eq!(eligible[0].images, Some(true));

    // Acquire a lease, then rename the connection (non-security edit):
    // security_generation stays equal and the active lease remains valid!
    let route = format!("mc_{}/qwen3:8b", id.to_lowercase());
    let acquired = service.acquire_lease(Some(&route)).unwrap();
    let lease_id = acquired["leaseId"].as_str().unwrap().to_owned();
    let cancel = service.lease_cancellation(&lease_id).unwrap();
    let mut renamed = saved.clone();
    renamed.name = "Workstation Ollama".into();
    let (after_rename, security_changed) =
        configuration::save_at(dir.path(), renamed, None).unwrap();
    assert!(!security_changed);
    assert_eq!(after_rename.security_gen(), saved.security_gen());
    service.reload_saved().unwrap();
    service.set_catalog_for_test(ConnectionCatalog {
        connection_id: id.clone(),
        config_generation: after_rename.generation.clone(),
        status: CatalogStatus::Ready,
        models: vec![CatalogModel {
            id: "qwen3:8b".into(),
            name: "Qwen3 8B".into(),
            loaded: Some(true),
            tools: Some(true),
            images: Some(true),
            context: Some(65536),
            max_context: Some(65536),
            remote: false,
        }],
        error_code: None,
    });
    assert!(!cancel.is_cancelled());
    assert!(service.validate_lease(&lease_id, Some(&route)).is_ok());

    // Changing endpoint is security-sensitive and immediately revokes the lease.
    let mut moved = after_rename;
    moved.endpoint = "http://127.0.0.1:11435/v1".into();
    let (_, security_changed) = configuration::save_at(dir.path(), moved, None).unwrap();
    assert!(security_changed);
    service.revoke_connection_leases(&id);
    assert!(cancel.is_cancelled());
    assert!(service.validate_lease(&lease_id, Some(&route)).is_err());
}

#[test]
fn agent_host_automatically_invalidates_builtin_readiness_when_wallet_becomes_ready() {
    let dir = tempfile::tempdir().unwrap();
    let gw = ScriptedGateway::new(1_000_000, 0);
    let service = ModelConnectionService::with_gateway(
        dir.path().to_path_buf(),
        None,
        Some(gw),
        Duration::from_secs(5),
    );
    let host = AgentHostHandle::start_production(AgentHostOptions {
        user_data_path: dir.path().to_path_buf(),
        model_connections: Some(service.clone()),
        compute_account: None,
        app_version: "0.5.0-test".into(),
        app_path: None,
        executable_path: std::env::current_exe()
            .ok()
            .map(|p| p.to_string_lossy().into_owned()),
    })
    .unwrap();
    host.open_window(1, Box::new(|_| {}));

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        // 1. Inspect before sign-in -> 0 models, RUNTIME_SETUP_REQUIRED.
        let before = host
            .request(
                1,
                AgentRequest::DiscoverRuntimes(RuntimeQuery {
                    root_path: None,
                    runtime_id: Some("puppyone-agent".into()),
                    refresh: Some(false),
                }),
            )
            .await
            .unwrap();
        let AgentResponse::Inspection(before) = before else {
            panic!("expected inspection");
        };
        assert!(before.models.is_empty());

        // 2. Enable payments, sign in, and refresh wallet -> trial claimed!
        service.set_payments(true);
        service.adopt_session(Some(ManagedSession::of(test_binding("u1", 1))));
        service.refresh_managed_now(true).await;
        assert_eq!(service.snapshot().managed.reason, Reason::Ready);
        assert_eq!(service.snapshot().agent_connections().len(), 1);
        // Let the readiness-sync watcher deliver InvalidateReadiness.
        tokio::time::sleep(Duration::from_millis(50)).await;

        // 3. Re-inspect with `refresh: Some(false)` (just like
        //    AgentSessionController::refresh_model_connections): must NOT hit
        //    a stale 5-minute empty cache!
        let after = host
            .request(
                1,
                AgentRequest::DiscoverRuntimes(RuntimeQuery {
                    root_path: None,
                    runtime_id: Some("puppyone-agent".into()),
                    refresh: Some(false),
                }),
            )
            .await
            .unwrap();
        let AgentResponse::Inspection(after) = after else {
            panic!("expected inspection");
        };
        assert_eq!(
            after.models.len(),
            1,
            "after inspection: readiness={:?} warnings={:?}",
            after.readiness,
            after.warnings
        );
        assert_eq!(
            after.models[0].model_id.as_deref(),
            Some("deepseek/deepseek-v4.1-flash")
        );
        assert_eq!(after.models[0].context_window, Some(1_000_000.0));
        host.shutdown().await;
    });
}

#[test]
fn sign_out_account_switch_and_connection_removal_immediately_revoke_active_leases() {
    let dir = tempfile::tempdir().unwrap();
    let gw = ScriptedGateway::new(0, 5_000_000);
    let service = ModelConnectionService::with_gateway(
        dir.path().to_path_buf(),
        None,
        Some(gw),
        Duration::from_secs(5),
    );
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        service.set_payments(true);
        service.adopt_session(Some(ManagedSession::of(test_binding("user-a", 1))));
        service.refresh_managed_now(true).await;

        let route_a = {
            let conn = &service.snapshot().agent_connections()[0];
            format!("mc_{}/{}", conn.id.to_lowercase(), conn.model)
        };
        let lease_a = service.acquire_lease(Some(&route_a)).unwrap()["leaseId"]
            .as_str()
            .unwrap()
            .to_owned();
        let cancel_a = service.lease_cancellation(&lease_a).unwrap();
        assert!(!cancel_a.is_cancelled());

        // Switching accounts immediately revokes user-a's managed lease.
        service.adopt_session(Some(ManagedSession::of(test_binding("user-b", 2))));
        assert!(cancel_a.is_cancelled());
        assert!(service.validate_lease(&lease_a, Some(&route_a)).is_err());

        // Refresh under user-b, acquire a lease, then sign out -> revoked.
        service.refresh_managed_now(true).await;
        let route_b = {
            let conn = &service.snapshot().agent_connections()[0];
            format!("mc_{}/{}", conn.id.to_lowercase(), conn.model)
        };
        let lease_b = service.acquire_lease(Some(&route_b)).unwrap()["leaseId"]
            .as_str()
            .unwrap()
            .to_owned();
        let cancel_b = service.lease_cancellation(&lease_b).unwrap();
        service.adopt_session(None);
        assert!(cancel_b.is_cancelled());
        assert!(service.validate_lease(&lease_b, Some(&route_b)).is_err());

        // Removing a custom connection immediately revokes its active lease.
        let id = uuid::Uuid::new_v4().to_string();
        let conn = ModelConnection {
            id: id.clone(),
            name: "Removable".into(),
            endpoint: "http://127.0.0.1:11434/v1".into(),
            source_kind: SourceKind::Local,
            driver: Driver::Ollama,
            auth: Auth::None,
            manual_context_window: Some(16384),
            ..Default::default()
        };
        let (saved, _) = configuration::save_at(dir.path(), conn, None).unwrap();
        service.reload_saved().unwrap();
        service.set_catalog_for_test(ConnectionCatalog {
            connection_id: id.clone(),
            config_generation: saved.generation.clone(),
            status: CatalogStatus::Ready,
            models: vec![CatalogModel {
                id: "qwen3:8b".into(),
                name: "Qwen3".into(),
                loaded: Some(true),
                tools: Some(true),
                images: Some(false),
                context: Some(16384),
                max_context: Some(16384),
                remote: false,
            }],
            error_code: None,
        });
        let custom_route = format!("mc_{}/qwen3:8b", id.to_lowercase());
        let custom_lease = service.acquire_lease(Some(&custom_route)).unwrap()["leaseId"]
            .as_str()
            .unwrap()
            .to_owned();
        let custom_cancel = service.lease_cancellation(&custom_lease).unwrap();
        assert!(!custom_cancel.is_cancelled());
        service.remove(&id, &saved.generation).unwrap();
        assert!(custom_cancel.is_cancelled());
        assert!(
            service
                .validate_lease(&custom_lease, Some(&custom_route))
                .is_err()
        );
    });
}

#[test]
fn managed_inference_reservation_and_finish_refresh_balance_and_receipt() {
    let dir = tempfile::tempdir().unwrap();
    let gw = ScriptedGateway::new(0, 5_000_000);
    let service = ModelConnectionService::with_gateway(
        dir.path().to_path_buf(),
        None,
        Some(gw.clone()),
        Duration::from_secs(5),
    );
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        let binding = test_binding("receipt-user", 1);
        service.set_payments(true);
        service.adopt_session(Some(ManagedSession::of(binding.clone())));
        service.refresh_managed_now(true).await;

        let reservation = "00000000-0000-4000-8000-000000000042";
        let account = ServiceComputeAccount(service.clone());
        account.note_reservation(&binding, reservation, "deepseek/deepseek-v4.1-flash");
        let pending_usage = service.snapshot().managed.last_usage.clone().unwrap();
        assert_eq!(pending_usage.reservation_id, reservation);
        assert_eq!(pending_usage.status, UsageStatus::Pending);

        // Server settles the charge and deducts balance; on_inference_finished
        // triggers a forced refresh of both /ai/balance and /ai/usage/{id}.
        *gw.balance.lock().unwrap() = Ok(json!({
            "balance_micro_usd": 4_950_000,
            "reserved_micro_usd": 0,
            "available_micro_usd": 4_950_000,
            "trial_granted_micro_usd": 0
        }));
        *gw.usage.lock().unwrap() = Ok(json!({
            "reservation_id": reservation,
            "model_id": "deepseek/deepseek-v4.1-flash",
            "status": "settled",
            "charged_micro_usd": 50_000,
            "price_book_id": "pb-1",
            "usage": {
                "input_tokens": 120,
                "cached_tokens": 20,
                "output_tokens": 80
            }
        }));

        let mut updates = service.subscribe();
        account.on_inference_finished();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let snap = updates.borrow_and_update().clone();
                if snap
                    .managed
                    .last_usage
                    .as_ref()
                    .is_some_and(|u| u.status == UsageStatus::Settled)
                {
                    assert_eq!(snap.managed.balance.unwrap().available_micro_usd, 4_950_000);
                    let u = snap.managed.last_usage.as_ref().unwrap();
                    assert_eq!(u.charged_micro_usd, Some(50_000));
                    assert_eq!(u.input_tokens, Some(120));
                    assert_eq!(u.cached_tokens, Some(20));
                    assert_eq!(u.output_tokens, Some(80));
                    break;
                }
                updates.changed().await.unwrap();
            }
        })
        .await
        .expect("settled receipt and refreshed balance must arrive promptly");
    });
}

#[test]
fn durable_verification_survives_restart_stale_catalog_retains_models_and_unsloth_guard() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let dir = tempfile::tempdir().unwrap();
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        // Loopback OpenAI-compatible server: request #1 returns 200 OK with one
        // model, request #2 returns 500 to test `CatalogStatus::Stale`.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            for (status, body) in [
                ("200 OK", r#"{"data":[{"id":"gpt-5-mini"}]}"#),
                ("500 Internal Server Error", r#"{"error":"boom"}"#),
            ] {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = [0u8; 2048];
                let _ = sock.read(&mut buf).await;
                let resp = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
            }
        });

        let id = uuid::Uuid::new_v4().to_string();
        let conn = ModelConnection {
            id: id.clone(),
            name: "Local OpenAI".into(),
            endpoint: format!("http://127.0.0.1:{port}/v1"),
            source_kind: SourceKind::Local,
            driver: Driver::OpenaiCompatible,
            auth: Auth::None,
            manual_context_window: Some(32768),
            ..Default::default()
        };
        let (saved, _) = configuration::save_at(dir.path(), conn, None).unwrap();
        configuration::record_verification_at(
            dir.path(),
            &id,
            "gpt-5-mini",
            saved.security_gen(),
        )
        .unwrap();

        // Simulate full app restart with a brand-new service instance: verified
        // model must be immediately eligible BEFORE any catalog probe runs.
        let restarted = ModelConnectionService::with_gateway(
            dir.path().to_path_buf(),
            None,
            None,
            Duration::from_secs(5),
        );
        let initial_eligible = restarted.snapshot().agent_connections();
        assert_eq!(initial_eligible.len(), 1);
        assert_eq!(initial_eligible[0].model, "gpt-5-mini");

        // Probe #1 succeeds -> Ready; Probe #2 fails with HTTP 500 -> Stale
        // retaining the previously discovered model.
        let models = restarted.refresh_connection(&id).await.unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(
            restarted.snapshot().catalogs[&id].status,
            CatalogStatus::Ready
        );
        let err = restarted.refresh_connection(&id).await.unwrap_err();
        assert_eq!(err, "HTTP_500");
        let stale_cat = &restarted.snapshot().catalogs[&id];
        assert_eq!(stale_cat.status, CatalogStatus::Stale);
        assert_eq!(stale_cat.models.len(), 1);
        assert_eq!(stale_cat.error_code.as_deref(), Some("HTTP_500"));
        assert_eq!(restarted.snapshot().agent_connections().len(), 1);
        server.await.unwrap();

        // Changing endpoint rotates security_generation and clears durable verification.
        let current = restarted.snapshot().connections[0].clone();
        let mut moved = current;
        moved.endpoint = format!("http://127.0.0.1:{}/v1", port.wrapping_add(1).max(1024));
        let (_, sec_changed) = configuration::save_at(dir.path(), moved, None).unwrap();
        assert!(sec_changed);
        let after_move = ModelConnectionService::with_gateway(
            dir.path().to_path_buf(),
            None,
            None,
            Duration::from_secs(5),
        );
        assert!(
            after_move.snapshot().agent_connections().is_empty(),
            "endpoint move must invalidate prior verification"
        );

        // Unsloth requires `server_tools_disabled == true` before exposing any model.
        let unsloth_id = uuid::Uuid::new_v4().to_string();
        let unsloth = ModelConnection {
            id: unsloth_id.clone(),
            name: "Unsloth".into(),
            endpoint: "http://127.0.0.1:8000/v1".into(),
            source_kind: SourceKind::Local,
            driver: Driver::Unsloth,
            auth: Auth::None,
            server_tools_disabled: false,
            manual_context_window: Some(32768),
            ..Default::default()
        };
        let (saved_unsloth, _) = configuration::save_at(dir.path(), unsloth, None).unwrap();
        after_move.reload_saved().unwrap();
        after_move.set_catalog_for_test(ConnectionCatalog {
            connection_id: unsloth_id.clone(),
            config_generation: saved_unsloth.generation.clone(),
            status: CatalogStatus::Ready,
            models: vec![CatalogModel {
                id: "unsloth-qwen".into(),
                name: "Unsloth Qwen".into(),
                loaded: Some(true),
                tools: Some(true),
                images: Some(false),
                context: Some(32768),
                max_context: Some(32768),
                remote: false,
            }],
            error_code: None,
        });
        assert!(
            after_move.snapshot().agent_connections().is_empty(),
            "Unsloth with server tools still enabled must be gated out"
        );
        let mut enabled_safe = saved_unsloth;
        enabled_safe.server_tools_disabled = true;
        let (saved_safe, _) = configuration::save_at(dir.path(), enabled_safe, None).unwrap();
        after_move.reload_saved().unwrap();
        after_move.set_catalog_for_test(ConnectionCatalog {
            connection_id: unsloth_id.clone(),
            config_generation: saved_safe.generation.clone(),
            status: CatalogStatus::Ready,
            models: vec![CatalogModel {
                id: "unsloth-qwen".into(),
                name: "Unsloth Qwen".into(),
                loaded: Some(true),
                tools: Some(true),
                images: Some(false),
                context: Some(32768),
                max_context: Some(32768),
                remote: false,
            }],
            error_code: None,
        });
        let final_eligible = after_move.snapshot().agent_connections();
        assert_eq!(final_eligible.len(), 1);
        assert_eq!(final_eligible[0].model, "unsloth-qwen");
    });
}

/// A model the user chose for Chat (its default or a synced Chat model) is
/// offered even when its service reports nothing about tools, as models with
/// tool evidence are; a model the service reports refusing tools never is.
#[test]
fn chosen_models_are_offered_without_tool_evidence_unless_they_refuse_tools() {
    let dir = tempfile::tempdir().unwrap();
    let service = ModelConnectionService::with_gateway(
        dir.path().to_path_buf(),
        None,
        None,
        Duration::from_secs(5),
    );
    let id = uuid::Uuid::new_v4().to_string();
    let conn = ModelConnection {
        id: id.clone(),
        name: "MLX".into(),
        endpoint: "http://127.0.0.1:8080/v1".into(),
        source_kind: SourceKind::Local,
        driver: Driver::OpenaiCompatible,
        auth: Auth::None,
        default_model_id: Some("qwen-9b".into()),
        chat_models: vec!["gemma-4b".into(), "embedder".into()],
        manual_context_window: Some(32768),
        ..Default::default()
    };
    let (saved, _) = configuration::save_at(dir.path(), conn, None).unwrap();
    service.reload_saved().unwrap();
    let model = |id: &str, tools: Option<bool>| CatalogModel {
        id: id.into(),
        name: id.into(),
        loaded: None,
        tools,
        images: None,
        context: None,
        max_context: None,
        remote: false,
    };
    service.set_catalog_for_test(ConnectionCatalog {
        connection_id: id.clone(),
        config_generation: saved.generation.clone(),
        status: CatalogStatus::Ready,
        models: vec![
            model("qwen-9b", None),
            model("gemma-4b", None),
            model("embedder", Some(false)),
            model("unchosen", None),
        ],
        error_code: None,
    });
    let offered: Vec<String> = service
        .snapshot()
        .agent_connections()
        .into_iter()
        .map(|c| c.model)
        .collect();
    assert_eq!(offered, ["qwen-9b", "gemma-4b"]);
}

/// `connectionRuntime.test.mjs`: `bounds parallel metadata requests and
/// cancels queued work` — at most two metadata requests are open at once;
/// a third waits its turn, and cancelled while waiting it never reaches the
/// service.
#[test]
fn metadata_requests_run_two_at_a_time_and_a_waiting_one_can_be_cancelled() {
    use super::drivers;
    use std::io::{Read as _, Write as _};
    use std::time::Duration;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (arrived, held) = std::sync::mpsc::channel::<std::net::TcpStream>();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let _ = arrived.send(stream);
        }
    });
    let conn = ModelConnection {
        endpoint: format!("http://127.0.0.1:{port}/v1"),
        driver: Driver::OpenaiCompatible,
        ..Default::default()
    };
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    let client = drivers::metadata_client().unwrap();
    let cancel = tokio_util::sync::CancellationToken::new();
    let read = |cancel: Option<tokio_util::sync::CancellationToken>| {
        let (client, conn) = (client.clone(), conn.clone());
        runtime.spawn(async move {
            let work = drivers::list_models(&client, &conn, None);
            match cancel {
                Some(cancel) => drivers::until_cancelled(work, &cancel).await,
                None => work.await,
            }
        })
    };
    let (first, second) = (read(None), read(None));
    let mut open: Vec<_> = (0..2)
        .map(|_| {
            held.recv_timeout(Duration::from_secs(10))
                .expect("two requests")
        })
        .collect();
    let third = read(Some(cancel.clone()));
    assert!(
        held.recv_timeout(Duration::from_millis(300)).is_err(),
        "a third waits its turn"
    );
    cancel.cancel();
    let third = runtime
        .block_on(async { tokio::time::timeout(Duration::from_secs(5), third).await })
        .expect("a cancelled read ends at once");
    assert_eq!(third.unwrap().unwrap_err(), "CANCELLED");
    for stream in &mut open {
        let mut request = [0u8; 2048];
        let _ = stream.read(&mut request);
        let body = r#"{"data":[]}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
    }
    assert!(runtime.block_on(first).unwrap().is_ok());
    assert!(runtime.block_on(second).unwrap().is_ok());
    assert!(
        held.recv_timeout(Duration::from_millis(300)).is_err(),
        "the cancelled request never reached the service"
    );
}
