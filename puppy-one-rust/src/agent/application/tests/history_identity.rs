//! Exact-open acceptance over the actual durable catalog and process-local
//! repository, with an isolated scripted native runtime.
use super::harness::{CODEX_MANIFEST, RecordingLogger, create_sender, run, settle};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::application::agent_service::{AgentService, AgentServiceOptions};
use crate::agent::application::ports::Pending;
use crate::agent::cache::ephemeral_agent_session_cache::EphemeralAgentSessionCache;
use crate::agent::persistence::agent_conversation_catalog::{
    AgentConversationCatalog, CatalogOptions,
};
use crate::agent::persistence::agent_session_repository::AgentSessionRepository;
use crate::agent::runtime::agent_runtime_port::{
    AdapterFuture, AdapterOptions, AgentRuntimeAdapter,
};
use crate::agent::runtime::agent_runtime_registry::{
    AgentRuntimeRegistry, RuntimeDefinition, RuntimeDiscovery,
};
use crate::agent::runtime::agent_session_history_port::SessionHistoryPort;
use crate::agent::tasks::CancelSignal;
use core::prelude::v1::test;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::path::Path;
use std::rc::Rc;
use tokio::sync::oneshot;
use tokio::task::spawn_local;

type CreateHook = Rc<dyn Fn(AdapterOptions) -> Pending<()>>;
type Hydration = Rc<dyn Fn(AdapterOptions, String) -> Pending<Value>>;
#[derive(Default)]
struct Hooks {
    create: RefCell<Option<CreateHook>>,
    hydrations: RefCell<VecDeque<Hydration>>,
}
struct Adapter {
    options: AdapterOptions,
    hooks: Rc<Hooks>,
    source: String,
    native_id: Rc<RefCell<String>>,
    creates: Cell<usize>,
    resumes: RefCell<Vec<String>>,
    disposed: Cell<bool>,
}
fn metadata(id: &str) -> Value {
    json!({"workspaceRoot":"/workspace","runtimeId":"codex","providerSessionId":id,"title":"History","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","model":"model"})
}
fn event(kind: &str, id: &str, payload: Value) -> Value {
    json!({"type":kind,"providerSessionId":id,"turnId":"turn-1","payload":payload})
}
impl AgentRuntimeAdapter for Adapter {
    fn inspect(&self) -> AdapterFuture<'_, Value> {
        Box::pin(async {
            Ok(
                json!({"account":{"account":{"type":"test"},"requiresOpenaiAuth":false},"models":[{"id":"model","model":"model","displayName":"Model","isDefault":true}],"capabilities":{}}),
            )
        })
    }
    fn create_session(&self, _: Value) -> AdapterFuture<'_, Value> {
        self.creates.set(self.creates.get() + 1);
        let hook = self.hooks.create.borrow().clone();
        let options = self.options.clone();
        Box::pin(async move {
            if let Some(hook) = hook {
                hook(options).await?;
            }
            Ok(metadata("native-1"))
        })
    }
    fn resume_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        let id = request["threadId"].as_str().unwrap().to_string();
        self.resumes.borrow_mut().push(id.clone());
        *self.native_id.borrow_mut() = id.clone();
        Box::pin(async move { Ok(metadata(&id)) })
    }
    fn start_turn(&self, _: Value) -> AdapterFuture<'_, Value> {
        (self.options.on_event)(event("turn.started", &self.native_id.borrow(), json!({})));
        Box::pin(async { Ok(json!({"turnId":"turn-1"})) })
    }
    fn interrupt_turn(&self, _: Value) -> AdapterFuture<'_, Value> {
        Box::pin(async { Ok(Value::Null) })
    }
    fn dispose(&self) -> AdapterFuture<'_, ()> {
        self.disposed.set(true);
        Box::pin(async { Ok(()) })
    }
    fn implements(&self, name: &str) -> bool {
        name == "getSessionHistoryPort"
    }
    fn session_history_port(&self) -> Option<Rc<dyn SessionHistoryPort>> {
        Some(Rc::new(History {
            options: self.options.clone(),
            hooks: self.hooks.clone(),
            source: self.source.clone(),
            native_id: self.native_id.clone(),
        }))
    }
}
struct History {
    options: AdapterOptions,
    hooks: Rc<Hooks>,
    source: String,
    native_id: Rc<RefCell<String>>,
}
impl SessionHistoryPort for History {
    fn source_scope_id(&self) -> Option<String> {
        Some(self.source.clone())
    }
    fn implements(&self, name: &str) -> bool {
        name == "hydrate"
    }
    fn hydrate(&self, _: CancelSignal) -> AdapterFuture<'_, Value> {
        let id = self.native_id.borrow().clone();
        let scripted = self.hooks.hydrations.borrow_mut().pop_front();
        let options = self.options.clone();
        Box::pin(async move {
            if let Some(scripted) = scripted {
                scripted(options, id).await
            } else {
                Ok(json!({"providerSessionId":id,"events":[],"coverage":"complete"}))
            }
        })
    }
}
struct Ready;
impl RuntimeDiscovery for Ready {
    fn discover(&self, _: bool, _: CancelSignal) -> LocalBoxFuture<'static, AgentResult<Value>> {
        Box::pin(async {
            Ok(
                json!({"runtimeId":"codex","status":"ready","code":"READY","executablePath":"/usr/bin/fake","environment":{}}),
            )
        })
    }
}
struct Harness {
    api: AgentService,
    catalog: AgentConversationCatalog,
    adapters: Rc<RefCell<Vec<Rc<Adapter>>>>,
    hooks: Rc<Hooks>,
}
impl Harness {
    fn open(file: &Path, source: &str) -> Self {
        let catalog = AgentConversationCatalog::new(CatalogOptions {
            file_path: file.into(),
            max_records: Some(2),
            ..Default::default()
        })
        .unwrap();
        let adapters: Rc<RefCell<Vec<Rc<Adapter>>>> = Rc::default();
        let hooks = Rc::new(Hooks::default());
        let made = adapters.clone();
        let scripted = hooks.clone();
        let source = source.to_string();
        let definition = RuntimeDefinition {
            manifest: serde_json::from_str(CODEX_MANIFEST).unwrap(),
            discovery: Rc::new(Ready),
            create_adapter: Rc::new(move |options| {
                let adapter = Rc::new(Adapter {
                    options,
                    hooks: scripted.clone(),
                    source: source.clone(),
                    native_id: Rc::new(RefCell::new("native-1".into())),
                    creates: Cell::new(0),
                    resumes: RefCell::default(),
                    disposed: Cell::new(false),
                });
                made.borrow_mut().push(adapter.clone());
                Ok(adapter)
            }),
            dispose: None,
        };
        let registry = AgentRuntimeRegistry::new(vec![definition], None, None).unwrap();
        let repository = AgentSessionRepository::new(
            EphemeralAgentSessionCache::new(None, None, None),
            catalog.clone(),
        );
        let api = AgentService::new(AgentServiceOptions {
            runtime_registry: registry,
            session_cache: Rc::new(repository),
            conversation_catalog: Some(Rc::new(catalog.clone())),
            logger: Some(Rc::new(RecordingLogger::default())),
            attachment_store: None,
            process_supervisor: None,
        });
        Self {
            api,
            catalog,
            adapters,
            hooks,
        }
    }
    fn adapter(&self, index: usize) -> Rc<Adapter> {
        self.adapters.borrow()[index].clone()
    }
    async fn saved(&self) -> Value {
        self.catalog
            .upsert_native(&metadata("native-1"))
            .await
            .unwrap()
    }
    async fn find(&self, id: &Value) -> Value {
        self.catalog
            .find_by_id(id.as_str().unwrap(), None)
            .await
            .unwrap()
            .unwrap()
    }
    async fn wait_available(&self, id: &Value) {
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if self.find(id).await["availability"] == "available" {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }
}
fn fixture() -> (tempfile::TempDir, std::path::PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("catalog.json");
    (directory, path)
}

#[test]
fn discovered_identity_is_adopted_before_new_session_events_are_published() {
    run(async {
        let (_directory, path) = fixture();
        let h = Harness::open(&path, "default");
        let (started, observed) = oneshot::channel();
        let (release, wait) = oneshot::channel();
        let started = RefCell::new(Some(started));
        let wait = RefCell::new(Some(wait));
        *h.hooks.create.borrow_mut() = Some(Rc::new(move |options| {
            (options.on_event)(event("session.started", "native-1", json!({"title":"New"})));
            started.borrow_mut().take().unwrap().send(()).unwrap();
            let wait = wait.borrow_mut().take().unwrap();
            Box::pin(async move {
                wait.await.unwrap();
                Ok(())
            })
        }));
        let service = h.api.clone();
        let (owner, _) = create_sender(1);
        let pending = spawn_local(async move {
            service
                .create_session(&owner, &json!({"runtimeId":"codex"}), "/workspace")
                .await
        });
        observed.await.unwrap();
        let discovered = h.saved().await;
        release.send(()).unwrap();
        let snapshot = pending.await.unwrap().unwrap();
        assert_eq!(snapshot["session"]["id"], discovered["sessionId"]);
        let events = snapshot["events"].as_array().unwrap();
        assert!(!events.is_empty());
        assert!(
            events
                .iter()
                .all(|e| e["sessionId"] == discovered["sessionId"])
        );
        assert_eq!(h.api.get_session_count(), 1);
        h.api.close_all().await.unwrap();
    });
}

#[test]
fn start_receipt_and_mismatched_persistence_evidence_cannot_promote_a_saved_locator() {
    run(async {
        let (_directory, path) = fixture();
        let h = Harness::open(&path, "default");
        let (owner, _) = create_sender(1);
        let created = h
            .api
            .create_session(&owner, &json!({"runtimeId":"codex"}), "/workspace")
            .await
            .unwrap();
        let id = &created["session"]["id"];
        h.api
            .start_turn(
                &owner,
                &json!({"sessionId":id,"prompt":"Hello"}),
                Some("/workspace"),
            )
            .await
            .unwrap();
        let report = h.adapter(0).options.on_session_persisted.clone().unwrap();
        report(json!({"providerSessionId":"wrong","sourceScopeId":"default"}));
        settle().await;
        assert_eq!(h.find(id).await["availability"], "unverified");
        report(json!({"providerSessionId":"native-1","sourceScopeId":"other-profile"}));
        settle().await;
        assert!(
            h.catalog
                .list(Some("/workspace"), &json!({}))
                .await
                .unwrap()
                .is_empty()
        );
        report(json!({"providerSessionId":"native-1","sourceScopeId":"default"}));
        h.wait_available(id).await;
        h.api.close_all().await.unwrap();
    });
}

#[test]
fn changed_native_profile_is_rejected_before_resume_without_tombstoning_history() {
    run(async {
        let (_directory, path) = fixture();
        let h = Harness::open(&path, "profile-b");
        let mut native = metadata("native-1");
        native["sourceScopeId"] = json!("profile-a");
        let saved = h.catalog.upsert_native(&native).await.unwrap();
        let (owner, _) = create_sender(1);
        let error = h
            .api
            .resume_session(
                &owner,
                &json!({"sessionId":saved["sessionId"],"runtimeId":"codex"}),
                "/workspace",
            )
            .await
            .unwrap_err();
        assert!(error.message.contains("history source changed"));
        assert!(h.adapter(0).resumes.borrow().is_empty());
        assert_eq!(
            h.find(&saved["sessionId"]).await["availability"],
            "available"
        );
        h.api.close_all().await.unwrap();
    });
}

#[test]
fn partial_history_projects_coverage_and_replays_newer_live_observations_after_history() {
    run(async {
        let (_directory, path) = fixture();
        let h = Harness::open(&path, "default");
        h.hooks.hydrations.borrow_mut().push_back(Rc::new(|options,id| {
            (options.on_event)(event("turn.completed",&id,json!({"status":"completed"})));
            Box::pin(async move {let mut answer=event("assistant.completed",&id,json!({"text":"Answer"}));answer["itemId"]=json!("answer");Ok(json!({"providerSessionId":id,"coverage":"partial","events":[event("turn.started",&id,json!({"restored":true,"prompt":"Old"})),answer]}))})
        }));
        let saved = h.saved().await;
        let (owner, _) = create_sender(1);
        let result = h
            .api
            .open_session(
                &owner,
                &json!({"sessionId":saved["sessionId"],"runtimeId":"codex"}),
                "/workspace",
            )
            .await
            .unwrap();
        assert_eq!(result["status"], "opened");
        let snapshot = &result["snapshot"];
        assert_eq!(snapshot["session"]["historyCoverage"], "partial");
        assert_eq!(snapshot["display"]["history"]["coverage"], "partial");
        assert_eq!(snapshot["control"]["execution"]["status"], "ended");
        assert_eq!(
            snapshot["control"]["execution"]["nativeOutcome"],
            "completed"
        );
        let events = snapshot["events"].as_array().unwrap();
        assert_eq!(events[events.len() - 2]["type"], "turn.completed");
        h.api.close_all().await.unwrap();
    });
}

#[test]
fn restart_restores_complete_native_messages_without_misclassifying_old_sequence_numbers_as_loss() {
    run(async {
        let (_directory, path) = fixture();
        let first = Harness::open(&path, "default");
        let (owner, _) = create_sender(1);
        let created = first
            .api
            .create_session(&owner, &json!({"runtimeId":"codex"}), "/workspace")
            .await
            .unwrap();
        let id = created["session"]["id"].clone();
        first
            .api
            .start_turn(
                &owner,
                &json!({"sessionId":id,"prompt":"Hello"}),
                Some("/workspace"),
            )
            .await
            .unwrap();
        assert_eq!(
            first
                .api
                .list_sessions(&owner, &json!({"discoverNative":false}), "/workspace")
                .await
                .unwrap()["sessions"],
            json!([])
        );
        (first.adapter(0).options.on_event)(event(
            "turn.completed",
            "native-1",
            json!({"status":"completed"}),
        ));
        first
            .adapter(0)
            .options
            .on_session_persisted
            .as_ref()
            .unwrap()(json!({"providerSessionId":"native-1","sourceScopeId":"default"}));
        first.api.close_all().await.unwrap();
        let persisted = first.find(&id).await;
        assert!(persisted["lastSequence"].as_i64().unwrap() > 0);
        assert!(persisted.get("events").is_none());
        let restarted = Harness::open(&path, "default");
        restarted.hooks.hydrations.borrow_mut().push_back(Rc::new(|_,native|Box::pin(async move {let mut answer=event("assistant.completed",&native,json!({"text":"Hello back"}));answer["itemId"]=json!("answer");Ok(json!({"providerSessionId":native,"coverage":"complete","events":[event("turn.started",&native,json!({"restored":true,"prompt":"Hello"})),answer,event("turn.completed",&native,json!({"status":"completed"}))]}))})));
        let (owner, _) = create_sender(2);
        let listed = restarted
            .api
            .list_sessions(&owner, &json!({"discoverNative":false}), "/workspace")
            .await
            .unwrap();
        assert_eq!(listed["sessions"].as_array().unwrap().len(), 1);
        assert_eq!(listed["sessions"][0]["id"], id);
        let opened = restarted
            .api
            .open_session(
                &owner,
                &json!({"sessionId":id,"runtimeId":"codex"}),
                "/workspace",
            )
            .await
            .unwrap();
        assert_eq!(opened["status"], "opened");
        let snapshot = &opened["snapshot"];
        assert_eq!(snapshot["session"]["id"], id);
        assert!(
            snapshot["events"][0]["sequence"].as_i64().unwrap()
                > persisted["lastSequence"].as_i64().unwrap()
        );
        assert_eq!(snapshot["partial"], true);
        assert_eq!(
            snapshot["display"]["history"],
            json!({"coverage":"complete","reason":null})
        );
        assert_eq!(snapshot["display"]["displayWindow"]["truncated"], false);
        assert_eq!(snapshot["display"]["missingRanges"], json!([]));
        let messages: Vec<_> = snapshot["display"]["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["text"].as_str().unwrap())
            .collect();
        assert_eq!(messages, ["Hello", "Hello back"]);
        assert_eq!(restarted.adapter(0).creates.get(), 0);
        restarted.api.close_all().await.unwrap();
    });
}

#[test]
fn transient_history_read_failure_keeps_the_same_saved_target_available_for_retry() {
    run(async {
        let (_directory, path) = fixture();
        let h = Harness::open(&path, "default");
        h.hooks.hydrations.borrow_mut().push_back(Rc::new(|_, _| {
            Box::pin(async { Err(AgentError::new("Native read timed out")) })
        }));
        let saved = h.saved().await;
        let request = json!({"sessionId":saved["sessionId"],"runtimeId":"codex"});
        let (owner, _) = create_sender(1);
        let result = h
            .api
            .open_session(&owner, &request, "/workspace")
            .await
            .unwrap();
        assert_eq!(result["status"], "failed");
        assert_eq!(result["error"]["code"], "HISTORY_READ_FAILED");
        assert_eq!(result["error"]["retryable"], true);
        assert_eq!(
            h.find(&saved["sessionId"]).await["availability"],
            "available"
        );
        assert_eq!(h.api.get_session_count(), 0);
        let retried = h
            .api
            .open_session(&owner, &request, "/workspace")
            .await
            .unwrap();
        assert_eq!(retried["status"], "opened");
        assert_eq!(retried["snapshot"]["session"]["id"], saved["sessionId"]);
        assert_eq!(
            retried["snapshot"]["session"]["providerSessionId"],
            saved["providerSessionId"]
        );
        assert_eq!(h.adapters.borrow().len(), 2);
        assert!(h.adapters.borrow().iter().all(|a| a.creates.get() == 0));
        h.api.close_all().await.unwrap();
    });
}

#[test]
fn history_for_another_native_conversation_and_cross_workspace_live_resume_are_refused() {
    run(async {
        let (_directory, path) = fixture();
        let h = Harness::open(&path, "default");
        h.hooks.hydrations.borrow_mut().push_back(Rc::new(|_, _| {
            Box::pin(async {
                Ok(json!({"providerSessionId":"wrong","coverage":"complete","events":[]}))
            })
        }));
        let saved = h.saved().await;
        let (owner, _) = create_sender(1);
        assert_eq!(
            h.api
                .open_session(
                    &owner,
                    &json!({"sessionId":saved["sessionId"],"runtimeId":"codex"}),
                    "/workspace"
                )
                .await
                .unwrap()["status"],
            "failed"
        );
        let (owner, _) = create_sender(2);
        let live = h
            .api
            .create_session(&owner, &json!({"runtimeId":"codex"}), "/workspace")
            .await
            .unwrap();
        let error = h
            .api
            .resume_session(
                &owner,
                &json!({"sessionId":live["session"]["id"],"runtimeId":"codex"}),
                "/wrong",
            )
            .await
            .unwrap_err();
        assert!(error.message.to_lowercase().contains("workspace"));
        h.api.close_all().await.unwrap();
    });
}
