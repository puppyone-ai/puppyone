//! `tests/integration/agent/security/electron.agent-ipc-authorization.test.mjs`
//! and `tests/integration/agent/references/electron.agent-reference-ipc.test.mjs`:
//! the request entry authorizes roots and references before the service.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::application::agent_requests::{AgentRequestService, AgentRequests};
use crate::agent::application::ports::Pending;
use crate::agent::application::tests_support::run_local;
use crate::agent::connections::local_agent_inventory::{
    LocalAgentInventoryOptions, create_local_agent_inventory,
};
use crate::agent::connections::tools::local_agent_tool_registry::LocalAgentToolDescriptor;
use crate::agent::contract::operation_error::read_agent_operation_failure;
use crate::agent::contract::protocol::AgentOperation;
use crate::agent::infrastructure::attachments::agent_attachment_store::{
    AgentAttachmentStore, AttachmentStoreOptions,
};
use crate::agent::sender::Sender;
use crate::clock;
use base64::Engine;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::path::Path;
use std::rc::Rc;

type Calls = Rc<RefCell<Vec<(String, u64, Value, Option<String>)>>>;
type StartTurn = Rc<dyn Fn(Value) -> AgentResult<Value>>;

/// `createMockAgentService()`: records each call; `startTurn` is scripted.
struct FakeService {
    calls: Calls,
    start_turn: StartTurn,
    capabilities: Value,
}

impl FakeService {
    fn record(
        &self,
        method: &str,
        sender: &Sender,
        request: Value,
        root: Option<String>,
    ) -> Pending<Value> {
        self.calls
            .borrow_mut()
            .push((method.into(), sender.id(), request.clone(), root));
        let value = match method {
            "createSession" | "resumeSession" => ipc_snapshot(),
            "openSession" => json!({ "status": "opened", "snapshot": ipc_snapshot() }),
            "steerTurn" => json!({ "sessionId": "s", "turnId": "t", "accepted": true }),
            "resolveQuestion" => json!({ "requestId": "r", "resolved": true }),
            "startTurn" => {
                let result = (self.start_turn)(request);
                return Box::pin(async move { result });
            }
            _ => Value::Null,
        };
        Box::pin(async move { Ok(value) })
    }
}

macro_rules! recorded {
    ($($name:ident => $method:literal),* $(,)?) => {
        $(fn $name(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
            self.record($method, sender, request, Some(root))
        })*
    };
}

impl AgentRequestService for FakeService {
    fn discover_providers(
        &self,
        sender: &Sender,
        request: Value,
        root: Option<String>,
    ) -> Pending<Value> {
        self.record("discoverProviders", sender, request, root)
    }
    fn list_models(&self, sender: &Sender, request: Value, root: Option<String>) -> Pending<Value> {
        self.record("listModels", sender, request, root)
    }
    fn read_account(
        &self,
        sender: &Sender,
        request: Value,
        root: Option<String>,
    ) -> Pending<Value> {
        self.record("readAccount", sender, request, root)
    }
    recorded! {
        create_session => "createSession",
        resume_session => "resumeSession",
        open_session => "openSession",
        replay => "replay",
        attach_session => "attachSession",
        acknowledge_session => "acknowledgeSession",
        read_session_watermark => "readSessionWatermark",
        detach_session => "detachSession",
        list_sessions => "listSessions",
        fork_session => "forkSession",
        archive_session => "archiveSession",
        delete_session => "deleteSession",
        close_session => "closeSession",
        start_turn => "startTurn",
        steer_turn => "steerTurn",
        interrupt_turn => "interruptTurn",
        compact_session => "compactSession",
        resolve_approval => "resolveApproval",
        resolve_question => "resolveQuestion",
    }
    fn get_reference_input_capabilities(
        &self,
        _sender: &Sender,
        _session_id: Option<Value>,
        _root: String,
    ) -> Pending<Value> {
        let capabilities = self.capabilities.clone();
        Box::pin(async move { Ok(capabilities) })
    }
}

/// `ipcSnapshot()`.
fn ipc_snapshot() -> Value {
    let actor =
        crate::agent::domain::agent_session_actor::AgentSessionActor::new(Default::default())
            .unwrap();
    let now = clock::now_iso();
    let snapshot = actor.snapshot();
    crate::agent::contract::js::Obj::new()
        .set("cursor", snapshot.cursor)
        .set("control", snapshot.control)
        .set("display", snapshot.display.to_value())
        .set("timeline", snapshot.timeline)
        .set(
            "session",
            json!({
                "id": "session-1",
                "runtimeId": "codex",
                "provider": "codex",
                "providerSessionId": "thread-1",
                "workspaceRoot": "/canonical/workspace",
                "title": "Session",
                "createdAt": now,
                "updatedAt": now,
                "terminalState": "idle",
                "selectedModel": null,
                "activeTurnId": null,
                "lastSequence": 0,
            }),
        )
        .set("account", Value::Null)
        .set("models", json!([]))
        .set("capabilities", Value::Null)
        .set("events", json!([]))
        .set("partial", false)
        .set("firstAvailableSequence", 0)
        .set("lastSequence", 0)
        .build()
}

/// `semanticReferenceCapabilities()`.
fn semantic_reference_capabilities() -> Value {
    json!({
        "schemaVersion": 1,
        "workspace": { "files": true, "directories": true },
        "attachments": {
            "image": { "accepted": true, "mimeTypes": ["image/png"] },
            "text": { "accepted": false },
            "audio": { "accepted": false },
            "video": { "accepted": false },
            "binary": { "accepted": false },
        },
        "limits": { "maxCount": 32, "maxBytesPerReference": 26214400, "maxTotalBytes": 26214400 },
        "steer": false,
        "attachmentOnly": false,
    })
}

fn open_capabilities() -> Value {
    json!({
        "schemaVersion": 1,
        "workspace": { "files": true, "directories": true },
        "attachments": {
            "image": { "accepted": true },
            "text": { "accepted": true },
            "audio": { "accepted": true },
            "video": { "accepted": true },
            "binary": { "accepted": true },
        },
        "limits": { "maxCount": 32, "maxBytesPerReference": 26214400, "maxTotalBytes": 26214400 },
        "steer": false,
        "attachmentOnly": false,
    })
}

fn sender(id: u64) -> Sender {
    Sender::new(id, Rc::new(|_| {}))
}

/// `clientHandler(handler)`: a failure envelope becomes an error.
async fn call(
    handlers: &AgentRequests,
    sender: &Sender,
    operation: AgentOperation,
    request: Value,
) -> AgentResult<Value> {
    let response = handlers.handle_value(sender, operation, &request).await;
    match read_agent_operation_failure(&response).map_err(AgentError::from)? {
        Some(failure) => Err(AgentError::new(
            failure["message"]
                .as_str()
                .unwrap_or("Agent operation failed."),
        )),
        None => Ok(response),
    }
}

fn handlers_for(
    service: Rc<FakeService>,
    workspace: Option<String>,
    store: Option<AgentAttachmentStore>,
) -> AgentRequests {
    AgentRequests {
        agent_service: service,
        local_agent_inventory: Some(
            create_local_agent_inventory(LocalAgentInventoryOptions {
                tool_descriptors: Some(vec![LocalAgentToolDescriptor {
                    id: "codex".into(),
                    installation_id: None,
                    display_name: "Codex".into(),
                    executable_names: Some(vec!["codex".into()]),
                    probe: Some(Rc::new(|_| Box::pin(async { Ok(json!({})) }))),
                    unavailable_message: "Codex unavailable.".into(),
                }]),
                resolve_candidate: Some(Rc::new(|_, _| Box::pin(async { Ok(None) }))),
                ..Default::default()
            })
            .unwrap(),
        ),
        authorize_workspace_root: Rc::new(move |_sender, requested| {
            let workspace = workspace.clone();
            Box::pin(async move {
                match workspace {
                    Some(workspace) if requested == workspace => Ok(workspace),
                    Some(_) => Err(AgentError::new("Workspace mismatch")),
                    None if requested == "/workspace" => Ok("/canonical/workspace".into()),
                    None => Err(AgentError::new("Requested workspace root does not match")),
                }
            })
        }),
        resolve_workspace_resource: None,
        attachment_store: store,
        pick_workspace_paths: None,
    }
}

fn fake_service(start_turn: StartTurn, capabilities: Value) -> (Rc<FakeService>, Calls) {
    let calls: Calls = Rc::default();
    (
        Rc::new(FakeService {
            calls: calls.clone(),
            start_turn,
            capabilities,
        }),
        calls,
    )
}

#[test]
fn authorizes_create_and_resume_roots_before_invoking_the_service() {
    run_local(async {
        let (service, calls) = fake_service(
            Rc::new(|_| Ok(json!({}))),
            semantic_reference_capabilities(),
        );
        let handlers = handlers_for(service, None, None);
        let owner = sender(7);
        let rejected = call(
            &handlers,
            &owner,
            AgentOperation::CreateSession,
            json!({ "rootPath": "/other" }),
        )
        .await
        .unwrap_err();
        assert!(rejected.message.contains("does not match"));
        assert!(calls.borrow().is_empty());
        for (operation, method) in [
            (AgentOperation::CreateSession, "createSession"),
            (AgentOperation::ResumeSession, "resumeSession"),
        ] {
            call(
                &handlers,
                &owner,
                operation,
                json!({ "rootPath": "/workspace" }),
            )
            .await
            .unwrap();
            let last = calls.borrow().last().cloned().unwrap();
            assert_eq!(
                last,
                (
                    method.to_string(),
                    7,
                    json!({ "rootPath": "/workspace" }),
                    Some("/canonical/workspace".to_string())
                )
            );
        }
        let open =
            json!({ "rootPath": "/workspace", "sessionId": "saved-session", "runtimeId": "codex" });
        call(&handlers, &owner, AgentOperation::OpenSession, open.clone())
            .await
            .unwrap();
        assert_eq!(calls.borrow().last().unwrap().2, open);
        assert!(
            call(
                &handlers,
                &owner,
                AgentOperation::DiscoverLocalConnections,
                json!({ "rootPath": "/workspace", "refresh": true })
            )
            .await
            .is_ok()
        );
        let mismatch = call(
            &handlers,
            &owner,
            AgentOperation::DiscoverLocalConnections,
            json!({ "rootPath": "/other" }),
        )
        .await
        .unwrap_err();
        assert!(mismatch.message.contains("does not match"));
    });
}

#[test]
fn registers_the_full_bridge_list_including_fail_closed_steer_and_question_handlers() {
    run_local(async {
        // Every product channel is a Main operation.
        assert_eq!(AgentOperation::MAIN.len(), 27);
        let (service, calls) = fake_service(
            Rc::new(|_| Ok(json!({}))),
            semantic_reference_capabilities(),
        );
        let handlers = handlers_for(service, None, None);
        let owner = sender(8);
        let steer = json!({ "rootPath": "/workspace", "sessionId": "s", "turnId": "t", "message": "steer" });
        call(&handlers, &owner, AgentOperation::SteerTurn, steer.clone())
            .await
            .unwrap();
        assert_eq!(
            calls.borrow().last().cloned().unwrap(),
            (
                "steerTurn".to_string(),
                8,
                steer,
                Some("/canonical/workspace".to_string())
            )
        );
        let question =
            json!({ "rootPath": "/workspace", "sessionId": "s", "turnId": "t", "requestId": "r" });
        call(
            &handlers,
            &owner,
            AgentOperation::ResolveQuestion,
            question.clone(),
        )
        .await
        .unwrap();
        assert_eq!(
            calls.borrow().last().cloned().unwrap(),
            (
                "resolveQuestion".to_string(),
                8,
                question,
                Some("/canonical/workspace".to_string())
            )
        );
    });
}

// ---------------------------------------------------------------------------
// Agent reference IPC authorization.

fn staging(root: &Path) -> AgentAttachmentStore {
    AgentAttachmentStore::new(AttachmentStoreOptions {
        root_path: root.join("staging"),
        ..Default::default()
    })
    .unwrap()
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn last_start(calls: &Calls) -> Value {
    calls
        .borrow()
        .iter()
        .rev()
        .find(|(method, ..)| method == "startTurn")
        .map(|(_, _, request, _)| request.clone())
        .unwrap()
}

#[test]
fn delivers_a_pathless_image_through_main_authorization_to_every_native_image_encoder() {
    run_local(async {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let store = staging(root.path());
        let bytes = base64::engine::general_purpose::STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4AWP8DwQMQMDEAAUAPfgEADYYS7QAAAAASUVORK5CYII=")
            .unwrap();
        let (service, calls) = fake_service(
            Rc::new(|_| Ok(json!({ "sessionId": "image-session", "turnId": "image-turn" }))),
            open_capabilities(),
        );
        let handlers = handlers_for(service, Some(text(&workspace)), Some(store.clone()));
        let owner = sender(41);
        let draft = call(&handlers, &owner, AgentOperation::StageReferences, json!({
            "rootPath": text(&workspace), "epoch": "image-draft",
            "sources": [{ "name": "clipboard.png", "bytes": crate::agent::contract::js::uint8array(&bytes) }],
        }))
        .await
        .unwrap()[0]
            .clone();
        call(&handlers, &owner, AgentOperation::StartTurn, json!({
            "rootPath": text(&workspace), "sessionId": "image-session", "prompt": "Describe the image",
            "referenceEpoch": "image-draft", "references": [draft],
        }))
        .await
        .unwrap();
        let references = last_start(&calls)["references"]
            .as_array()
            .cloned()
            .unwrap();
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let codex = crate::agent::runtimes::codex::codex_reference_input::build_codex_turn_input(
            "Describe the image",
            &references,
            Some(&text(&workspace)),
        )
        .unwrap();
        let image = codex
            .iter()
            .find(|block| block["type"] == "localImage")
            .unwrap();
        assert_eq!(
            std::fs::read(image["path"].as_str().unwrap()).unwrap(),
            bytes
        );
        let claude =
            crate::agent::runtimes::claude::claude_prompt_input::build_claude_user_message_content(
                "Describe the image",
                &references,
                &text(&workspace),
            )
            .unwrap();
        let claude_image = claude
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["type"] == "image")
            .unwrap()
            .clone();
        assert_eq!(claude_image["source"]["data"], encoded.as_str());
        let pi = crate::agent::protocols::pi_rpc::pi_prompt_input::build_pi_turn_input(
            "Describe the image",
            &references,
            Some(&text(&workspace)),
            None,
        )
        .unwrap();
        assert_eq!(pi.images[0]["data"], encoded.as_str());
        let profile = crate::agent::protocols::acp::acp_prompt_input::AcpReferenceProfile {
            image: true,
            embedded_text: false,
        };
        let materialized =
            crate::agent::protocols::acp::acp_prompt_input::materialize_acp_references(
                &references,
                profile,
            )
            .unwrap();
        let acp = crate::agent::protocols::acp::acp_prompt_input::build_acp_prompt_blocks(
            "Describe the image",
            None,
            &materialized,
            &text(&workspace),
            profile,
        )
        .unwrap();
        assert_eq!(
            acp.iter().find(|b| b["type"] == "image").unwrap()["data"],
            encoded.as_str()
        );
        store.close().await;
    });
}

#[test]
fn turns_a_preload_file_grant_into_an_owner_bound_one_use_snapshot() {
    run_local(async {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("workspace");
        let source = root.path().join("outside.txt");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::write(&source, "immutable input").unwrap();
        let store = staging(root.path());
        let adapter_input: Rc<RefCell<String>> = Rc::default();
        let read = adapter_input.clone();
        let (service, calls) = fake_service(
            Rc::new(move |request: Value| {
                *read.borrow_mut() =
                    std::fs::read_to_string(request["references"][0]["path"].as_str().unwrap())
                        .unwrap();
                Ok(json!({ "sessionId": "session-1", "turnId": "turn-1" }))
            }),
            open_capabilities(),
        );
        let handlers = handlers_for(service, Some(text(&workspace)), Some(store.clone()));
        let owner = sender(7);
        let draft = call(
            &handlers,
            &owner,
            AgentOperation::StageReferences,
            json!({
                "rootPath": text(&workspace), "epoch": "draft-a", "sourcePaths": [text(&source)],
            }),
        )
        .await
        .unwrap()[0]
            .clone();
        assert_eq!(draft["kind"], "staged-attachment");
        assert_eq!(draft["status"], "ready");
        assert!(draft.get("path").is_none());
        assert!(!draft.to_string().contains(&text(&source)));
        let mentions = json!([{ "referenceId": draft["id"], "start": 4, "end": 16 }]);
        call(&handlers, &owner, AgentOperation::StartTurn, json!({
            "rootPath": text(&workspace), "sessionId": "session-1", "prompt": "use @outside.txt",
            "promptMentions": mentions, "referenceEpoch": "draft-a", "references": [draft],
        }))
        .await
        .unwrap();
        let forwarded = last_start(&calls);
        let authorized = &forwarded["references"][0];
        assert_eq!(authorized["authorized"], true);
        assert_eq!(authorized["kind"], "staged-attachment");
        assert_eq!(authorized["name"], "outside.txt");
        assert_ne!(authorized["path"], text(&source).as_str());
        assert_eq!(forwarded["promptMentions"], mentions);
        assert_eq!(*adapter_input.borrow(), "immutable input");
        let snapshot = authorized["path"].as_str().unwrap().to_string();
        assert!(Path::new(&snapshot).exists());
        let replay = call(
            &handlers,
            &owner,
            AgentOperation::StartTurn,
            json!({
                "rootPath": text(&workspace), "sessionId": "session-1", "prompt": "replay grant",
                "referenceEpoch": "draft-a", "references": [draft],
            }),
        )
        .await
        .unwrap_err();
        assert!(
            regex::Regex::new(r"(?i)in use|leased|invalid")
                .unwrap()
                .is_match(&replay.message)
        );
        store.revoke_owner(7);
        assert!(!Path::new(&snapshot).exists());
        store.close().await;
    });
}

#[test]
fn rejects_cross_window_grants_and_raw_external_workspace_paths() {
    run_local(async {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("workspace");
        let source = root.path().join("external.txt");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::write(&source, "external").unwrap();
        std::fs::write(workspace.join("inside.txt"), "inside").unwrap();
        let store = staging(root.path());
        let (service, _) = fake_service(
            Rc::new(|_| Ok(json!({ "accepted": true }))),
            open_capabilities(),
        );
        let handlers = handlers_for(service, Some(text(&workspace)), Some(store.clone()));
        let draft = call(&handlers, &sender(11), AgentOperation::StageReferences, json!({
            "rootPath": text(&workspace), "epoch": "draft-owner", "sourcePaths": [text(&source)],
        }))
        .await
        .unwrap()[0]
            .clone();
        let workspace_draft = call(
            &handlers,
            &sender(11),
            AgentOperation::ResolveWorkspaceReferences,
            json!({
                "rootPath": text(&workspace), "paths": ["inside.txt"],
            }),
        )
        .await
        .unwrap()[0]
            .clone();
        assert_eq!(workspace_draft["relativePath"], "inside.txt");
        assert_eq!(workspace_draft["status"], "ready");
        assert!(
            workspace_draft.get("path").is_none() && workspace_draft.get("authorized").is_none()
        );
        assert!(!workspace_draft.to_string().contains(&text(&workspace)));
        let stolen = call(
            &handlers,
            &sender(12),
            AgentOperation::StartTurn,
            json!({
                "rootPath": text(&workspace), "sessionId": "session-1", "prompt": "steal",
                "referenceEpoch": "draft-owner", "references": [draft],
            }),
        )
        .await
        .unwrap_err();
        assert!(
            regex::Regex::new(r"(?i)invalid|belongs")
                .unwrap()
                .is_match(&stolen.message)
        );
        let raw = call(&handlers, &sender(11), AgentOperation::StartTurn, json!({
            "rootPath": text(&workspace), "sessionId": "session-1", "prompt": "raw path",
            "references": [{
                "id": "raw-external", "kind": "workspace-entry", "entryType": "file",
                "relativePath": "../external.txt", "displayName": "external.txt", "status": "ready",
            }],
        }))
        .await
        .unwrap_err();
        assert!(raw.message.contains("workspace-relative"));
        store.close().await;
    });
}

#[test]
fn keeps_staged_grants_isolated_when_one_window_owns_multiple_workspaces() {
    run_local(async {
        let root = tempfile::tempdir().unwrap();
        let (a, b) = (
            root.path().join("workspace-a"),
            root.path().join("workspace-b"),
        );
        let source = root.path().join("shared.md");
        std::fs::create_dir(&a).unwrap();
        std::fs::create_dir(&b).unwrap();
        std::fs::write(&source, "workspace-bound input").unwrap();
        let store = staging(root.path());
        let owner = sender(17);
        let (service_a, _) = fake_service(Rc::new(|_| Ok(json!({}))), open_capabilities());
        let (service_b, _) = fake_service(Rc::new(|_| Ok(json!({}))), open_capabilities());
        let handlers_a = handlers_for(service_a, Some(text(&a)), Some(store.clone()));
        let handlers_b = handlers_for(service_b, Some(text(&b)), Some(store.clone()));
        let draft = call(
            &handlers_a,
            &owner,
            AgentOperation::StageReferences,
            json!({
                "rootPath": text(&a), "epoch": "workspace-a-draft", "sourcePaths": [text(&source)],
            }),
        )
        .await
        .unwrap()[0]
            .clone();
        let crossed = call(
            &handlers_b,
            &owner,
            AgentOperation::StartTurn,
            json!({
                "rootPath": text(&b), "sessionId": "session-b", "prompt": "cross workspace",
                "referenceEpoch": "workspace-a-draft", "references": [draft],
            }),
        )
        .await
        .unwrap_err();
        assert!(
            regex::Regex::new(r"(?i)invalid|belongs|workspace")
                .unwrap()
                .is_match(&crossed.message)
        );
        store.close().await;
    });
}

#[test]
fn resolves_one_portable_workspace_identity_against_the_assigned_session_root_at_send_time() {
    run_local(async {
        let root = tempfile::tempdir().unwrap();
        let (a, b) = (
            root.path().join("checkout-a"),
            root.path().join("worktree-b"),
        );
        for (workspace, content) in [(&a, "checkout"), (&b, "worktree")] {
            std::fs::create_dir_all(workspace.join("docs")).unwrap();
            std::fs::write(workspace.join("docs/notes.md"), content).unwrap();
        }
        let store = staging(root.path());
        let owner = sender(31);
        let (service_a, calls_a) = fake_service(
            Rc::new(|_| Ok(json!({ "sessionId": "session-a", "turnId": "turn-a" }))),
            open_capabilities(),
        );
        let (service_b, calls_b) = fake_service(
            Rc::new(|_| Ok(json!({ "sessionId": "session-b", "turnId": "turn-b" }))),
            open_capabilities(),
        );
        let handlers_a = handlers_for(service_a, Some(text(&a)), Some(store.clone()));
        let handlers_b = handlers_for(service_b, Some(text(&b)), Some(store.clone()));
        let portable = call(
            &handlers_a,
            &owner,
            AgentOperation::ResolveWorkspaceReferences,
            json!({
                "rootPath": text(&a), "paths": ["docs/notes.md"],
            }),
        )
        .await
        .unwrap()[0]
            .clone();
        call(
            &handlers_b,
            &owner,
            AgentOperation::StartTurn,
            json!({
                "rootPath": text(&b), "sessionId": "session-b", "prompt": "Review @docs/notes.md",
                "promptMentions": [{ "referenceId": portable["id"], "start": 7, "end": 21 }],
                "references": [portable],
            }),
        )
        .await
        .unwrap();
        assert_eq!(portable["relativePath"], "docs/notes.md");
        assert_eq!(portable["displayName"], "notes.md");
        assert!(portable.get("path").is_none());
        let start = calls_b.borrow().last().cloned().unwrap();
        assert_eq!(start.3.as_deref(), Some(text(&b).as_str()));
        let reference = &start.2["references"][0];
        assert_eq!(reference["id"], portable["id"]);
        assert_eq!(reference["relativePath"], "docs/notes.md");
        assert_eq!(
            reference["path"],
            text(&std::fs::canonicalize(b.join("docs/notes.md")).unwrap()).as_str()
        );
        assert!(
            calls_a
                .borrow()
                .iter()
                .all(|(method, ..)| method != "startTurn")
        );
        store.close().await;
    });
}

#[test]
fn releases_a_failed_turn_lease_so_the_unchanged_draft_can_retry() {
    run_local(async {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("workspace");
        let source = root.path().join("retry.txt");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::write(&source, "retry").unwrap();
        let store = staging(root.path());
        let attempts = Rc::new(std::cell::Cell::new(0));
        let counter = attempts.clone();
        let (service, _) = fake_service(
            Rc::new(move |_| {
                counter.set(counter.get() + 1);
                if counter.get() == 1 {
                    Err(AgentError::new("native start failed"))
                } else {
                    Ok(json!({ "sessionId": "session-1", "turnId": "turn-2" }))
                }
            }),
            open_capabilities(),
        );
        let handlers = handlers_for(service, Some(text(&workspace)), Some(store.clone()));
        let owner = sender(21);
        let draft = call(&handlers, &owner, AgentOperation::StageReferences, json!({
            "rootPath": text(&workspace), "epoch": "retry-draft", "sourcePaths": [text(&source)],
        }))
        .await
        .unwrap()[0]
            .clone();
        let request = json!({
            "rootPath": text(&workspace), "sessionId": "session-1", "prompt": "retry",
            "referenceEpoch": "retry-draft", "references": [draft],
        });
        let failed = call(
            &handlers,
            &owner,
            AgentOperation::StartTurn,
            request.clone(),
        )
        .await
        .unwrap_err();
        assert!(failed.message.contains("native start failed"));
        let retried = call(&handlers, &owner, AgentOperation::StartTurn, request)
            .await
            .unwrap();
        assert_eq!(retried["turnId"], "turn-2");
        assert_eq!(attempts.get(), 2);
        store.close().await;
    });
}
