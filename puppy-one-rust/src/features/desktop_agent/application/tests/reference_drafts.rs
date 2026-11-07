//! `tests/unit/agent/references/desktop-agent.resource-reference-drafts.test.ts`.
use super::fake_client::FakeClient;
use super::session_feed::wait_for;
use super::support::{Deferred, Deferreds};
use crate::agent::agent_error::AgentError;
use crate::agent::application::tests::harness::run;
use crate::features::desktop_agent::application::agent_client_port::{
    AgentClientPort, AgentFile, AgentFileSource,
};
use crate::features::desktop_agent::application::agent_controller_state::AgentControllerState;
use crate::features::desktop_agent::application::agent_error::agent_operation_error;
use crate::features::desktop_agent::application::agent_reference_draft_manager::{
    AgentReferenceDraftManager, AgentReferenceDraftManagerOptions,
};
use crate::features::desktop_agent::application::agent_reference_preview_store::AgentReferenceVisualPreview;
use crate::features::desktop_agent::application::agent_session_controller::AgentControllerStore;
use crate::features::desktop_agent::application::ui_runtime::TokioUiRuntime;
use crate::features::desktop_agent::fixtures::{json_of, typed};
use serde_json::{Value, json};
use std::cell::Cell;
use std::rc::Rc;

struct Fixture {
    manager: AgentReferenceDraftManager,
    store: Rc<AgentControllerStore>,
    bridge: Rc<FakeClient>,
}

impl Fixture {
    fn references(&self) -> Vec<Value> {
        self.store
            .read(|state| state.references.iter().map(json_of).collect())
    }
}

/// `fixture(resolve, attachments)`: the bridge's methods are set up by the
/// caller.
fn fixture(bridge: Rc<FakeClient>) -> Fixture {
    let state = AgentControllerState {
        inspection: Some(typed(json!({ "capabilities": { "referenceInputs": {
            "workspace": { "files": true, "directories": true, "crossRoots": true },
            "attachments": { "image": { "accepted": true } },
            "limits": { "maxCount": 32, "maxBytesPerReference": 100, "maxTotalBytes": 1000 },
        } } }))),
        ..Default::default()
    };
    let store = Rc::new(AgentControllerStore::plain(state));
    let port: Rc<dyn AgentClientPort> = bridge.clone();
    let manager = AgentReferenceDraftManager::new(AgentReferenceDraftManagerOptions {
        workspace_root: "/repo-a".into(),
        bridge_provider: Rc::new(move || Some(port.clone())),
        store: store.clone(),
        runtime: TokioUiRuntime::create(),
        append_text: Rc::new(|_| {}),
    });
    Fixture {
        manager,
        store,
        bridge,
    }
}

fn reference() -> Value {
    json!({
        "id": "b", "kind": "workspace-entry", "entryType": "file", "relativePath": "docs/b.md", "displayName": "b.md",
        "status": "ready", "resourceUri": "puppyone-local://workspace/b/docs/b.md", "workspaceName": "repo-b",
    })
}

fn image(name: &str, contents: &str) -> AgentFile {
    AgentFile {
        name: name.into(),
        mime: "image/png".into(),
        size: contents.len() as f64,
        source: AgentFileSource::Bytes(Rc::new(contents.as_bytes().to_vec())),
    }
}

fn staged(id: &str, token: &str, name: &str, size: u64) -> Value {
    json!({ "id": id, "kind": "staged-attachment", "token": token, "displayName": name, "mime": "image/png", "size": size, "status": "ready" })
}

#[test]
fn preserves_the_structured_failure_reason() {
    for kind in ["attachment", "workspace"] {
        run(async move {
            let error = agent_operation_error(typed(json!({
                "schemaVersion": 1, "code": "PROJECT_CLOSING", "message": "This project is closing.",
                "stage": "authorization", "retryable": true, "actions": [],
            })));
            let bridge = FakeClient::new();
            bridge.reject("resolveAgentWorkspaceReferences", error.clone());
            bridge.reject("stageAgentAttachments", error);
            let f = fixture(bridge);
            if kind == "attachment" {
                f.manager
                    .stage_external_files(vec![image("image.png", "image")])
                    .await
                    .expect("stage");
            } else {
                f.manager
                    .add_workspace_paths(vec!["image.png".into()], Vec::new())
                    .await
                    .expect("add");
            }
            assert_eq!(
                f.references()[0]["error"],
                json!({ "code": "PROJECT_CLOSING", "message": "This project is closing.", "stage": "authorization", "retryable": true }),
                "{kind}"
            );
        });
    }
}

#[test]
fn keeps_legacy_failures_bounded_without_inventing_retry_policy() {
    run(async {
        let bridge = FakeClient::new();
        bridge.resolve("resolveAgentWorkspaceReferences", json!([]));
        bridge.reject(
            "stageAgentAttachments",
            AgentError::new("read failed\n".repeat(100)),
        );
        let f = fixture(bridge);
        f.manager
            .stage_external_files(vec![image("image.png", "image")])
            .await
            .expect("stage");
        let error = f.references()[0]["error"].clone();
        assert_eq!(error["code"], "staging-failed");
        let message = error["message"].as_str().unwrap_or_default();
        assert!(message.chars().count() <= 500);
        assert!(!message.contains('\n'));
        assert!(error.get("retryable").is_none());
    });
}

#[test]
fn does_not_resurrect_an_image_removed_reset_or_disposed_during_staging() {
    for action in ["remove", "reset", "dispose"] {
        run(async move {
            let bridge = FakeClient::new();
            bridge.resolve("resolveAgentWorkspaceReferences", json!([]));
            let complete = Deferred::new();
            bridge.handle_once("stageAgentAttachments", complete.handler());
            bridge.resolve("revokeAgentAttachments", json!({ "revoked": 1 }));
            let f = fixture(bridge);
            let pending = f
                .manager
                .stage_external_files(vec![image("image.png", "image")]);
            let pending_reference = f.references()[0].clone();
            match action {
                "remove" => f
                    .manager
                    .remove(pending_reference["id"].as_str().unwrap_or_default()),
                "reset" => {
                    f.manager
                        .reset(f.store.read(|state| state.references.clone()))
                        .await
                }
                _ => f.manager.dispose_renderer_resources(),
            }
            complete.resolve(json!([staged(
                "staged-image",
                "image-token",
                "image.png",
                5
            )]));
            assert_eq!(pending.await.expect("stage"), 0, "{action}");
            assert!(
                !f.references()
                    .iter()
                    .any(|entry| entry["id"] == "staged-image")
            );
            assert!(
                f.bridge
                    .calls("revokeAgentAttachments")
                    .contains(&json!({ "rootPath": "/repo-a", "tokens": ["image-token"] }))
            );
        });
    }
}

#[test]
fn publishes_each_completed_image_without_removing_its_pending_sibling() {
    run(async {
        let bridge = FakeClient::new();
        bridge.resolve("resolveAgentWorkspaceReferences", json!([]));
        let finish = Deferreds::default();
        bridge.handle("stageAgentAttachments", finish.handler());
        let f = fixture(bridge);
        let pending = f.manager.stage_external_files(vec![
            image("first.png", "first"),
            image("second.png", "second"),
        ]);
        finish
            .get(0)
            .resolve(json!([staged("first", "first-token", "first.png", 5)]));
        wait_for(|| {
            let mut statuses: Vec<String> = f
                .references()
                .iter()
                .map(|entry| entry["status"].as_str().unwrap_or_default().to_string())
                .collect();
            statuses.sort();
            statuses == ["ready", "resolving"]
        })
        .await;
        finish
            .get(1)
            .resolve(json!([staged("second", "second-token", "second.png", 6)]));
        assert_eq!(pending.await.expect("stage"), 2);
        let ids: Vec<Value> = f
            .references()
            .iter()
            .map(|entry| entry["id"].clone())
            .collect();
        assert_eq!(ids, vec![json!("first"), json!("second")]);
    });
}

#[test]
fn does_not_revoke_the_retained_token_when_a_cancelled_acquisition_deduplicates_to_it() {
    run(async {
        let image_reference = staged("image", "image-token", "image.png", 5);
        let bridge = FakeClient::new();
        bridge.resolve("resolveAgentWorkspaceReferences", json!([]));
        bridge.resolve_once("stageAgentAttachments", json!([image_reference]));
        let complete = Deferred::new();
        bridge.handle_once("stageAgentAttachments", complete.handler());
        bridge.resolve("revokeAgentAttachments", json!({ "revoked": 1 }));
        let f = fixture(bridge);
        let file = image("image.png", "image");
        assert_eq!(
            f.manager
                .stage_external_files(vec![file.clone()])
                .await
                .expect("stage"),
            1
        );
        let pending = f.manager.stage_external_files(vec![file]);
        let resolving = f
            .references()
            .into_iter()
            .find(|entry| entry["status"] == "resolving")
            .expect("resolving");
        f.manager
            .remove(resolving["id"].as_str().unwrap_or_default());
        complete.resolve(json!([image_reference]));
        assert_eq!(pending.await.expect("stage"), 0);
        assert_eq!(f.references(), vec![image_reference]);
        assert_eq!(f.bridge.count("revokeAgentAttachments"), 0);
    });
}

#[test]
fn keeps_valid_entries_when_another_source_fails_and_retries_the_original_owner() {
    run(async {
        let bridge = FakeClient::new();
        bridge.resolve_once("resolveAgentWorkspaceReferences", json!([reference()]));
        bridge.reject_once(
            "resolveAgentWorkspaceReferences",
            AgentError::new("Missing source"),
        );
        bridge.resolve_once("resolveAgentWorkspaceReferences", json!([reference()]));
        let f = fixture(bridge);
        let missing = "puppyone-local://workspace/missing/docs/%E4%B8%AD%E6%96%87.md";
        let uri = reference()["resourceUri"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        assert_eq!(
            f.manager
                .add_workspace_paths(vec![uri, missing.into()], Vec::new())
                .await
                .expect("add"),
            1
        );
        let failed = f
            .references()
            .into_iter()
            .find(|entry| entry["status"] == "error")
            .expect("failed");
        assert_eq!(failed["displayName"], "中文.md");
        f.manager.retry(failed["id"].as_str().unwrap_or_default());
        wait_for(|| f.bridge.count("resolveAgentWorkspaceReferences") == 3).await;
        assert_eq!(
            f.bridge.calls("resolveAgentWorkspaceReferences")[2],
            json!({ "rootPath": "/repo-a", "paths": [missing] })
        );
    });
}

#[test]
fn discards_a_late_resolution_after_reset_and_releases_its_preview() {
    run(async {
        let bridge = FakeClient::new();
        let complete = Deferred::new();
        bridge.handle_once("resolveAgentWorkspaceReferences", complete.handler());
        let f = fixture(bridge);
        let released = Rc::new(Cell::new(0));
        let counter = released.clone();
        let is_current = f.manager.capture_acquisition();
        let uri = reference()["resourceUri"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        let pending = f.manager.add_workspace_paths(
            vec![uri.clone()],
            vec![(
                uri,
                AgentReferenceVisualPreview {
                    url: "blob:preview".into(),
                    release: Some(Rc::new(move || counter.set(counter.get() + 1))),
                },
            )],
        );
        f.manager.reset(Vec::new()).await;
        assert!(!is_current());
        complete.resolve(json!([reference()]));
        assert_eq!(pending.await.expect("add"), 0);
        assert!(f.references().is_empty());
        assert_eq!(released.get(), 1);
    });
}
