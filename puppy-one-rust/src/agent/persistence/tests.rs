//! `tests/integration/agent/history/electron.agent-conversation-catalog.test.mjs`,
//! `electron.agent-history-catalog-concurrency.test.mjs` and
//! `tests/unit/agent/sessions/electron.agent-session-repository.test.mjs`.
use super::agent_conversation_catalog::{
    AgentConversationCatalog, CatalogFileSystem, CatalogOptions, ReconcileScope,
};
use super::agent_session_repository::AgentSessionRepository;
use crate::agent::application::tests_support::run_local;
use crate::agent::cache::ephemeral_agent_session_cache::EphemeralAgentSessionCache;
use crate::agent::contract::js;
use core::prelude::v1::test;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::Rc;

struct Fixture {
    _directory: tempfile::TempDir,
    file_path: PathBuf,
    catalog: AgentConversationCatalog,
}

fn fixture_with(max_records: Option<i64>) -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let file_path = directory.path().join("catalog.json");
    let catalog = AgentConversationCatalog::new(CatalogOptions {
        file_path: file_path.clone(),
        max_records,
        ..Default::default()
    })
    .unwrap();
    Fixture {
        _directory: directory,
        file_path,
        catalog,
    }
}

fn fixture() -> Fixture {
    fixture_with(None)
}

fn open(file_path: &Path) -> AgentConversationCatalog {
    AgentConversationCatalog::new(CatalogOptions {
        file_path: file_path.to_path_buf(),
        ..Default::default()
    })
    .unwrap()
}

fn record(provider_session_id: &str) -> Value {
    json!({
        "workspaceRoot": "/workspace",
        "runtimeId": "codex",
        "providerSessionId": provider_session_id,
        "title": "Conversation",
        "createdAt": "2026-09-01T00:00:00.000Z",
        "updatedAt": "2026-09-01T00:00:00.000Z",
    })
}

fn scope(workspace_root: &str, runtime_id: &str, ids: &[&str]) -> ReconcileScope {
    ReconcileScope {
        workspace_root: Some(workspace_root.into()),
        runtime_id: Some(runtime_id.into()),
        provider_session_ids: ids.iter().map(|id| id.to_string()).collect(),
        ..Default::default()
    }
}

fn ids(records: &[Value], key: &str) -> Vec<String> {
    records
        .iter()
        .map(|entry| entry[key].as_str().unwrap().to_string())
        .collect()
}

// ---------------------------------------------------------------------------
// Agent conversation catalog.

#[test]
fn persists_only_bounded_routing_metadata_and_native_session_pointers_across_restarts() {
    run_local(async {
        let Fixture {
            _directory,
            file_path,
            catalog,
        } = fixture();
        catalog
            .save(&json!({
                "sessionId": "product-session",
                "workspaceRoot": "/workspace",
                "runtimeId": "codex",
                "runtime": { "id": "codex", "displayName": "Codex" },
                "providerSessionId": "native-thread",
                "title": "Fix tests",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-01T00:00:01.000Z",
                "selectedProviderId": "openai",
                "selectedModel": "gpt-5.6",
                "selectedVariant": "fast",
                "selectedEffort": "high",
                "selectedMode": "build",
                "capabilityRevision": "codex-app-server:1",
                "availability": "available",
                "events": [{ "type": "assistant.completed", "payload": { "text": "private transcript" } }],
                "secret": "sk-not-allowed",
            }))
            .await
            .unwrap();
        let raw = std::fs::read_to_string(&file_path).unwrap();
        assert!(!raw.contains("private transcript"));
        assert!(!raw.contains("sk-not-allowed"));
        let restarted = open(&file_path);
        let latest = restarted
            .find_latest("/workspace", Some("codex"))
            .await
            .unwrap()
            .unwrap();
        for (key, value) in [
            ("sessionId", "product-session"),
            ("providerSessionId", "native-thread"),
            ("selectedProviderId", "openai"),
            ("selectedModel", "gpt-5.6"),
            ("selectedVariant", "fast"),
            ("selectedEffort", "high"),
            ("capabilityRevision", "codex-app-server:1"),
        ] {
            assert_eq!(latest[key], value, "{key}");
        }
        assert_eq!(
            restarted
                .list(Some("/workspace"), &json!({}))
                .await
                .unwrap()
                .len(),
            1
        );
    });
}

#[test]
fn migrates_the_former_workbuddy_runtime_id_at_the_durable_catalog_boundary() {
    run_local(async {
        let Fixture {
            _directory,
            file_path,
            ..
        } = fixture();
        let homedir = PathBuf::from(std::env::var("HOME").unwrap_or_default());
        let source_scope_id =
            crate::agent::runtimes::workbuddy::workbuddy_history_source::work_buddy_history_source(
                &crate::agent::runtimes::workbuddy::workbuddy_channels::WORKBUDDY_CHINA_CHANNEL,
                &|key| std::env::var(key).ok(),
                &homedir,
            );
        std::fs::write(
            &file_path,
            json!({
                "version": 2,
                "truncated": false,
                "records": [{
                    "sessionId": "legacy-workbuddy-session",
                    "workspaceRoot": "/workspace",
                    "runtimeId": "workbuddy",
                    "runtime": { "id": "workbuddy", "displayName": "WorkBuddy", "kind": "native-cli" },
                    "providerSessionId": "native-workbuddy-thread",
                    "sourceScopeId": source_scope_id,
                    "title": "Legacy WorkBuddy session",
                    "createdAt": "2026-01-01T00:00:00.000Z",
                    "updatedAt": "2026-01-01T00:00:01.000Z",
                    "availability": "available",
                }],
            })
            .to_string(),
        )
        .unwrap();
        let catalog = open(&file_path);
        let china = catalog
            .list(
                Some("/workspace"),
                &json!({ "runtimeId": "workbuddy-china" }),
            )
            .await
            .unwrap();
        assert_eq!(china.len(), 1);
        assert_eq!(china[0]["sessionId"], "legacy-workbuddy-session");
        assert_eq!(china[0]["runtimeId"], "workbuddy-china");
        assert_eq!(china[0]["runtime"]["id"], "workbuddy-china");
        assert_eq!(china[0]["runtime"]["displayName"], "WorkBuddy (China)");
        assert!(
            catalog
                .list(
                    Some("/workspace"),
                    &json!({ "runtimeId": "workbuddy-international" })
                )
                .await
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn keeps_legacy_unverified_locators_internal_until_a_turn_or_native_scan_confirms_them() {
    run_local(async {
        let Fixture { catalog, .. } = fixture();
        let legacy = json!({
            "sessionId": "legacy-empty-session",
            "workspaceRoot": "/workspace",
            "runtimeId": "codex",
            "runtime": { "id": "codex", "displayName": "Codex" },
            "providerSessionId": "native-thread-without-rollout",
            "title": "Codex session",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "updatedAt": "2026-01-01T00:00:01.000Z",
        });
        catalog.save(&legacy).await.unwrap();
        assert!(
            catalog
                .list(Some("/workspace"), &json!({}))
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            catalog
                .find_latest("/workspace", Some("codex"))
                .await
                .unwrap()
                .is_none()
        );
        let unverified = catalog
            .list(Some("/workspace"), &json!({ "includeUnverified": true }))
            .await
            .unwrap();
        assert_eq!(unverified.len(), 1);
        assert_eq!(unverified[0]["sessionId"], "legacy-empty-session");
        assert_eq!(unverified[0]["availability"], "unverified");
        catalog
            .save(&js::with(&legacy, "availability", "available"))
            .await
            .unwrap();
        let listed = catalog.list(Some("/workspace"), &json!({})).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0]["sessionId"], "legacy-empty-session");
        assert_eq!(listed[0]["availability"], "available");
    });
}

#[test]
fn upserts_one_stable_product_locator_for_a_native_conversation_discovered_more_than_once() {
    run_local(async {
        let Fixture {
            _directory,
            file_path,
            catalog,
        } = fixture();
        let first = catalog
            .upsert_native(&json!({
                "workspaceRoot": "/workspace",
                "runtimeId": "codex",
                "runtime": { "id": "codex", "displayName": "Codex" },
                "providerSessionId": "native-thread",
                "title": "Initial title",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-01T00:00:01.000Z",
                "events": [{ "payload": { "text": "must not be persisted" } }],
            }))
            .await
            .unwrap();
        let second = catalog
            .upsert_native(&json!({
                "workspaceRoot": "/workspace",
                "runtimeId": "codex",
                "runtime": { "id": "codex", "displayName": "Codex" },
                "providerSessionId": "native-thread",
                "title": "Updated title",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-02T00:00:00.000Z",
            }))
            .await
            .unwrap();
        assert_eq!(second["sessionId"], first["sessionId"]);
        let listed = catalog
            .list(Some("/workspace"), &json!({ "runtimeId": "codex" }))
            .await
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0]["sessionId"], first["sessionId"]);
        assert_eq!(listed[0]["providerSessionId"], "native-thread");
        assert_eq!(listed[0]["title"], "Updated title");
        assert_eq!(listed[0]["origin"], "native-discovery");
        assert!(
            !std::fs::read_to_string(&file_path)
                .unwrap()
                .contains("must not be persisted")
        );
    });
}

#[test]
fn tombstones_only_missing_locators_in_the_fully_scanned_workspace_and_runtime() {
    run_local(async {
        let Fixture { catalog, .. } = fixture();
        let base = json!({
            "runtime": { "id": "cursor", "displayName": "Cursor" },
            "title": "Saved chat",
            "createdAt": "2026-09-01T00:00:00.000Z",
            "updatedAt": "2026-09-01T00:00:01.000Z",
            "availability": "available",
        });
        let with = |fields: Value| js::Obj::from(&base).spread(&fields).build();
        catalog.save(&with(json!({ "sessionId": "keep", "workspaceRoot": "/workspace/a", "runtimeId": "cursor", "providerSessionId": "native-keep" }))).await.unwrap();
        catalog.save(&with(json!({ "sessionId": "stale", "workspaceRoot": "/workspace/a", "runtimeId": "cursor", "providerSessionId": "native-stale" }))).await.unwrap();
        catalog.save(&with(json!({ "sessionId": "other-root", "workspaceRoot": "/workspace/b", "runtimeId": "cursor", "providerSessionId": "native-other" }))).await.unwrap();
        catalog.save(&with(json!({
            "sessionId": "other-runtime", "workspaceRoot": "/workspace/a", "runtimeId": "codex",
            "runtime": { "id": "codex", "displayName": "Codex" }, "providerSessionId": "thread-other",
        }))).await.unwrap();
        let mut stale_scope = scope("/workspace/a", "cursor", &["native-keep"]);
        stale_scope.reconciled_at = Some("2026-09-01T01:00:00.000Z".into());
        assert_eq!(
            catalog.reconcile_native(stale_scope).await.unwrap(),
            json!({ "unavailableSessionIds": ["stale"] })
        );
        let listed = ids(
            &catalog
                .list(Some("/workspace/a"), &json!({}))
                .await
                .unwrap(),
            "sessionId",
        );
        assert!(listed.contains(&"keep".to_string()));
        assert!(listed.contains(&"other-runtime".to_string()));
        assert!(!listed.contains(&"stale".to_string()));
        assert_eq!(
            ids(
                &catalog
                    .list(Some("/workspace/b"), &json!({}))
                    .await
                    .unwrap(),
                "sessionId"
            ),
            ["other-root"]
        );
        let stale = catalog
            .find_by_id("stale", Some("/workspace/a"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stale["availability"], "unavailable");
        assert_eq!(stale["unavailableAt"], "2026-09-01T01:00:00.000Z");
    });
}

#[test]
fn reactivates_a_tombstone_without_changing_its_stable_product_id() {
    run_local(async {
        let Fixture { catalog, .. } = fixture();
        catalog
            .save(&json!({
                "sessionId": "stable-product-id",
                "workspaceRoot": "/workspace",
                "runtimeId": "cursor",
                "runtime": { "id": "cursor", "displayName": "Cursor" },
                "providerSessionId": "native-eventual",
                "title": "Saved chat",
                "createdAt": "2026-09-01T00:00:00.000Z",
                "updatedAt": "2026-09-01T00:00:01.000Z",
            }))
            .await
            .unwrap();
        catalog
            .reconcile_native(scope("/workspace", "cursor", &[]))
            .await
            .unwrap();
        let restored = catalog
            .upsert_native(&json!({
                "workspaceRoot": "/workspace",
                "runtimeId": "cursor",
                "runtime": { "id": "cursor", "displayName": "Cursor" },
                "providerSessionId": "native-eventual",
                "title": "Now durable",
                "createdAt": "2026-09-01T00:00:00.000Z",
                "updatedAt": "2026-09-01T02:00:00.000Z",
            }))
            .await
            .unwrap();
        assert_eq!(restored["sessionId"], "stable-product-id");
        assert_eq!(restored["availability"], "available");
        assert_eq!(restored["origin"], "puppyone");
        assert_eq!(restored["title"], "Now durable");
    });
}

// ---------------------------------------------------------------------------
// History catalog transaction and identity.

/// A file system whose reads and renames can be held or failed.
#[derive(Default)]
struct GatedFileSystem {
    read_gate: RefCell<Option<tokio::sync::oneshot::Receiver<()>>>,
    rename_gate: RefCell<Option<tokio::sync::oneshot::Receiver<()>>>,
    rename_failure: Cell<bool>,
    renames: Cell<usize>,
}

impl CatalogFileSystem for Rc<GatedFileSystem> {
    fn read(&self, path: &Path) -> LocalBoxFuture<'static, std::io::Result<String>> {
        let gate = self.read_gate.borrow_mut().take();
        let path = path.to_path_buf();
        Box::pin(async move {
            let contents = std::fs::read_to_string(path);
            if let Some(gate) = gate {
                let _ = gate.await;
            }
            contents
        })
    }
    fn rename(&self, from: &Path, to: &Path) -> LocalBoxFuture<'static, std::io::Result<()>> {
        self.renames.set(self.renames.get() + 1);
        let gate = self.rename_gate.borrow_mut().take();
        let fail = self.rename_failure.replace(false);
        let (from, to) = (from.to_path_buf(), to.to_path_buf());
        Box::pin(async move {
            if let Some(gate) = gate {
                let _ = gate.await;
            }
            if fail {
                return Err(std::io::Error::other("disk write failed"));
            }
            std::fs::rename(from, to)
        })
    }
}

fn gated(file_path: &Path) -> (AgentConversationCatalog, Rc<GatedFileSystem>) {
    let file_system = Rc::new(GatedFileSystem::default());
    let catalog = AgentConversationCatalog::new(CatalogOptions {
        file_path: file_path.to_path_buf(),
        file_system: Some(Rc::new(file_system.clone())),
        ..Default::default()
    })
    .unwrap();
    (catalog, file_system)
}

async fn settle() {
    for _ in 0..16 {
        tokio::task::yield_now().await;
    }
}

#[test]
fn allocates_one_product_id_under_concurrent_discovery_and_after_restart() {
    run_local(async {
        let Fixture {
            _directory,
            file_path,
            catalog,
        } = fixture();
        let native = record("native/a");
        let results =
            futures_util::future::join_all((0..12).map(|_| catalog.upsert_native(&native))).await;
        let ids: std::collections::HashSet<String> = results
            .iter()
            .map(|r| {
                r.as_ref().unwrap()["sessionId"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(ids.len(), 1);
        assert_eq!(catalog.list(None, &json!({})).await.unwrap().len(), 1);
        let next = open(&file_path)
            .upsert_native(&record("native/a"))
            .await
            .unwrap();
        assert_eq!(next["sessionId"], results[0].as_ref().unwrap()["sessionId"]);
    });
}

#[test]
fn shares_first_load_between_all_readers_and_writers_instead_of_observing_a_temporary_empty_catalog()
 {
    run_local(async {
        let Fixture {
            _directory,
            file_path,
            catalog,
        } = fixture();
        let initial = catalog.upsert_native(&record("existing")).await.unwrap();
        let (restarted, file_system) = gated(&file_path);
        let (release, gate) = tokio::sync::oneshot::channel();
        *file_system.read_gate.borrow_mut() = Some(gate);
        let read = {
            let restarted = restarted.clone();
            let id = initial["sessionId"].as_str().unwrap().to_string();
            tokio::task::spawn_local(async move {
                let found = restarted.find_by_id(&id, None).await.unwrap().unwrap();
                assert_eq!(found["providerSessionId"], "existing");
            })
        };
        let finished = Rc::new(Cell::new(false));
        let write = {
            let (restarted, finished) = (restarted.clone(), finished.clone());
            tokio::task::spawn_local(async move {
                restarted.upsert_native(&record("new")).await.unwrap();
                finished.set(true);
            })
        };
        settle().await;
        assert!(!finished.get());
        let _ = release.send(());
        read.await.unwrap();
        write.await.unwrap();
        let memory = restarted.list(None, &json!({})).await.unwrap();
        let disk = open(&file_path).list(None, &json!({})).await.unwrap();
        assert_eq!(memory, disk);
        let mut natives = ids(&memory, "providerSessionId");
        natives.sort();
        assert_eq!(natives, ["existing", "new"]);
    });
}

#[test]
fn preserves_archive_selections_and_live_observations_while_refreshing_native_metadata() {
    run_local(async {
        let Fixture { catalog, .. } = fixture();
        let original = catalog.upsert_native(&record("native")).await.unwrap();
        catalog
            .save(
                &js::Obj::from(&original)
                    .set("selectedModel", "chosen-model")
                    .set("terminalState", "running")
                    .set("lastSequence", 42)
                    .build(),
            )
            .await
            .unwrap();
        let id = original["sessionId"].as_str().unwrap();
        catalog
            .archive(id, Some("2026-09-02T00:00:00.000Z".into()))
            .await
            .unwrap();
        catalog
            .upsert_native(
                &js::Obj::from(&record("native"))
                    .set("title", "New native title")
                    .set("selectedModel", "old-model")
                    .set("archivedAt", Value::Null)
                    .set("lastSequence", 0)
                    .set("terminalState", "idle")
                    .build(),
            )
            .await
            .unwrap();
        assert!(catalog.list(None, &json!({})).await.unwrap().is_empty());
        let found = catalog.find_by_id(id, None).await.unwrap().unwrap();
        assert_eq!(found["title"], "New native title");
        assert_eq!(found["archivedAt"], "2026-09-02T00:00:00.000Z");
        assert_eq!(found["selectedModel"], "chosen-model");
        assert_eq!(found["terminalState"], "running");
        assert_eq!(found["lastSequence"], 42);
    });
}

#[test]
fn does_not_hide_records_created_or_confirmed_after_the_scan_began() {
    run_local(async {
        let Fixture { catalog, .. } = fixture();
        let existing = catalog.upsert_native(&record("confirmed")).await.unwrap();
        let stale = catalog.upsert_native(&record("stale")).await.unwrap();
        // Pin the stored observation timestamps on both sides of the scan.
        // Reconciliation must use committed revisions even when dates tie.
        let same_date = "2026-09-01T00:00:00.000Z";
        for entry in [&existing, &stale] {
            catalog
                .save(&js::with(entry, "lastSeenAt", same_date))
                .await
                .unwrap();
        }
        let started = catalog.get_revision().await.unwrap();
        let confirmed = catalog.upsert_native(&record("confirmed")).await.unwrap();
        let created = catalog.upsert_native(&record("created")).await.unwrap();
        for entry in [&confirmed, &created] {
            catalog
                .save(&js::with(entry, "lastSeenAt", same_date))
                .await
                .unwrap();
        }
        let before_scan = catalog.list(None, &json!({})).await.unwrap();
        assert_eq!(before_scan.len(), 3);
        assert!(
            before_scan
                .iter()
                .all(|entry| entry["lastSeenAt"] == same_date)
        );
        let mut page_scope = scope("/workspace", "codex", &[]);
        page_scope.started_revision = Some(started);
        catalog
            .apply_native_page_with(Vec::new(), page_scope, true, None)
            .await
            .unwrap();
        let availability = |entry: &Value| {
            let catalog = catalog.clone();
            let id = entry["sessionId"].as_str().unwrap().to_string();
            async move { catalog.find_by_id(&id, None).await.unwrap().unwrap()["availability"].clone() }
        };
        assert_eq!(availability(&existing).await, "available");
        assert_eq!(availability(&created).await, "available");
        assert_eq!(availability(&stale).await, "unavailable");
    });
}

#[test]
fn rolls_back_the_whole_page_on_validation_or_disk_replacement_failure() {
    run_local(async {
        let directory = tempfile::tempdir().unwrap();
        let file_path = directory.path().join("catalog.json");
        let (catalog, file_system) = gated(&file_path);
        catalog.upsert_native(&record("existing")).await.unwrap();
        let before = std::fs::read_to_string(&file_path).unwrap();
        assert!(
            catalog
                .apply_native_page_with(
                    vec![record("good"), record("invalid id")],
                    ReconcileScope::default(),
                    false,
                    None,
                )
                .await
                .is_err()
        );
        file_system.rename_failure.set(true);
        let error = catalog
            .apply_native_page_with(vec![record("good")], ReconcileScope::default(), false, None)
            .await
            .unwrap_err();
        assert!(error.message.contains("disk write failed"));
        assert_eq!(std::fs::read_to_string(&file_path).unwrap(), before);
        assert_eq!(
            ids(
                &catalog.list(None, &json!({})).await.unwrap(),
                "providerSessionId"
            ),
            ["existing"]
        );
        let files: Vec<String> = std::fs::read_dir(directory.path())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(files, ["catalog.json"]);
        catalog.upsert_native(&record("retry")).await.unwrap();
        assert_eq!(catalog.list(None, &json!({})).await.unwrap().len(), 2);
    });
}

#[test]
fn serves_the_last_committed_catalog_while_a_disk_write_is_still_settling() {
    run_local(async {
        let directory = tempfile::tempdir().unwrap();
        let file_path = directory.path().join("catalog.json");
        let (catalog, file_system) = gated(&file_path);
        catalog.upsert_native(&record("existing")).await.unwrap();
        let (release, gate) = tokio::sync::oneshot::channel();
        *file_system.rename_gate.borrow_mut() = Some(gate);
        let renames = file_system.renames.get();
        let write = {
            let catalog = catalog.clone();
            tokio::task::spawn_local(async move {
                catalog.upsert_native(&record("pending")).await.unwrap();
            })
        };
        settle().await;
        assert_eq!(file_system.renames.get(), renames + 1);
        assert_eq!(
            ids(
                &catalog.list(None, &json!({})).await.unwrap(),
                "providerSessionId"
            ),
            ["existing"]
        );
        let _ = release.send(());
        write.await.unwrap();
        assert_eq!(catalog.list(None, &json!({})).await.unwrap().len(), 2);
    });
}

#[test]
fn preserves_malformed_stored_data_rather_than_overwriting_it() {
    run_local(async {
        for contents in [
            "invalid JSON".to_string(),
            json!({ "version": 1, "records": [{}] }).to_string(),
        ] {
            let directory = tempfile::tempdir().unwrap();
            let file_path = directory.path().join("catalog.json");
            std::fs::write(&file_path, &contents).unwrap();
            let warnings = Rc::new(Cell::new(0));
            let counter = warnings.clone();
            let catalog = AgentConversationCatalog::new(CatalogOptions {
                file_path: file_path.clone(),
                logger: Some(Rc::new(move |_| counter.set(counter.get() + 1))),
                ..Default::default()
            })
            .unwrap();
            assert!(catalog.list(None, &json!({})).await.is_err());
            assert!(catalog.upsert_native(&record("new")).await.is_err());
            assert_eq!(std::fs::read_to_string(&file_path).unwrap(), contents);
            assert!(warnings.get() > 0);
        }
    });
}

#[test]
fn partitions_native_identity_and_reconciliation_by_source_as_well_as_workspace_and_runtime() {
    run_local(async {
        let Fixture { catalog, .. } = fixture();
        let a = catalog
            .upsert_native(&js::with(&record("same"), "sourceScopeId", "profile-a"))
            .await
            .unwrap();
        let b = catalog
            .upsert_native(&js::with(&record("same"), "sourceScopeId", "profile-b"))
            .await
            .unwrap();
        assert_ne!(a["sessionId"], b["sessionId"]);
        let mut profile = scope("/workspace", "codex", &[]);
        profile.source_scope_id = Some("profile-a".into());
        catalog.reconcile_native(profile).await.unwrap();
        let availability = |id: &Value| {
            let catalog = catalog.clone();
            let id = id.as_str().unwrap().to_string();
            async move { catalog.find_by_id(&id, None).await.unwrap().unwrap()["availability"].clone() }
        };
        assert_eq!(availability(&b["sessionId"]).await, "available");
        assert_eq!(availability(&a["sessionId"]).await, "unavailable");
    });
}

#[test]
fn uses_the_same_native_id_rules_through_persistence_and_the_event_envelope() {
    run_local(async {
        let Fixture { catalog, .. } = fixture();
        let native_id = format!("profile/{}", "a".repeat(500));
        catalog.upsert_native(&record(&native_id)).await.unwrap();
        use crate::agent::agent_error::AgentResult;
        use crate::agent::application::history::agent_history_queries::AgentHistoryQueries;
        use crate::agent::application::history::native_conversation_indexer::NativeConversationIndexer;
        use crate::agent::application::processes::agent_process_supervisor::AgentProcessSupervisor;
        use crate::agent::application::runtime_resolution::runtime_resolution_coordinator::RuntimeResolutionCoordinator;
        use crate::agent::runtime::agent_runtime_registry::{
            AgentRuntimeRegistry, RuntimeDefinition, RuntimeDiscovery,
        };
        use crate::agent::tasks::CancelSignal;
        struct NoDiscovery;
        impl RuntimeDiscovery for NoDiscovery {
            fn discover(
                &self,
                _: bool,
                _: CancelSignal,
            ) -> LocalBoxFuture<'static, AgentResult<Value>> {
                panic!("a catalog-only query must not probe native runtimes");
            }
        }
        let registry = AgentRuntimeRegistry::new(
            vec![RuntimeDefinition {
                manifest: serde_json::from_str(
                    crate::agent::application::tests::harness::CODEX_MANIFEST,
                )
                .unwrap(),
                discovery: Rc::new(NoDiscovery),
                create_adapter: Rc::new(|_| {
                    panic!("a catalog-only query must not start an adapter")
                }),
                dispose: None,
            }],
            None,
            None,
        )
        .unwrap();
        let supervisor = AgentProcessSupervisor::new(None);
        let coordinator =
            RuntimeResolutionCoordinator::new(registry.clone(), supervisor.clone(), None);
        let indexer = NativeConversationIndexer::new(
            registry,
            coordinator,
            Rc::new(catalog.clone()),
            supervisor,
        );
        let queries = AgentHistoryQueries::new(Rc::new(catalog), indexer);
        let (sender, _) = crate::agent::application::tests::harness::create_sender(71);
        let listed = queries
            .list_sessions(&sender, &json!({}), "/workspace")
            .await
            .unwrap();
        let public = crate::agent::contract::schema::assert_agent_ipc_response(
            "agent:sessions-list",
            &listed,
        )
        .unwrap();
        assert_eq!(public["sessions"].as_array().unwrap().len(), 1);
        assert_eq!(
            public["sessions"][0]["providerSessionId"],
            native_id.as_str()
        );
        let envelope = crate::agent::agent_events::create_agent_event_envelope(
            crate::agent::agent_events::EnvelopeInput {
                sequence: 1,
                session_id: "product-id".into(),
                runtime_id: "codex".into(),
                provider_session_id: Some(native_id.clone()),
                turn_id: None,
                item_id: None,
                event_type: "assistant.completed".into(),
                payload: json!({ "text": "Restored answer" }),
                emitted_at: None,
            },
        )
        .unwrap();
        assert_eq!(envelope["providerSessionId"], native_id.as_str());
    });
}

#[test]
fn retains_identity_metadata_independently_of_catalog_page_capacity() {
    run_local(async {
        let Fixture {
            _directory,
            file_path,
            catalog,
        } = fixture_with(Some(1));
        catalog.upsert_native(&record("a")).await.unwrap();
        let result = catalog
            .apply_native_page_with(vec![record("b")], ReconcileScope::default(), false, None)
            .await
            .unwrap();
        assert_eq!(result["truncated"], false);
        assert_eq!(
            catalog.get_coverage().await.unwrap(),
            json!({ "truncated": false, "capacity": 1, "retained": 2 })
        );
        let coverage = open(&file_path).get_coverage().await.unwrap();
        assert_eq!(coverage["truncated"], false);
        assert_eq!(coverage["retained"], 2);
    });
}

// ---------------------------------------------------------------------------
// Agent session repository durability boundary.

fn repository() -> (
    tempfile::TempDir,
    AgentSessionRepository,
    AgentConversationCatalog,
    EphemeralAgentSessionCache,
) {
    let directory = tempfile::tempdir().unwrap();
    let catalog = open(&directory.path().join("catalog.json"));
    let cache = EphemeralAgentSessionCache::new(None, None, None);
    let repository = AgentSessionRepository::new(cache.clone(), catalog.clone());
    (directory, repository, catalog, cache)
}

fn session(session_id: &str) -> Value {
    json!({
        "sessionId": session_id,
        "workspaceRoot": "/workspace",
        "runtimeId": "codex",
        "providerSessionId": format!("native-{session_id}"),
        "title": "Conversation",
        "createdAt": "2026-09-01T00:00:00.000Z",
        "updatedAt": "2026-09-01T00:00:00.000Z",
    })
}

#[test]
fn keeps_allocated_empty_sessions_process_local_until_a_durable_checkpoint() {
    run_local(async {
        let (_directory, repository, catalog, cache) = repository();
        repository.save(&session("empty"), false).await.unwrap();
        assert!(cache.find_by_id("empty", None).await.is_some());
        assert!(catalog.find_by_id("empty", None).await.unwrap().is_none());
        repository.save(&session("durable"), true).await.unwrap();
        let durable = catalog.find_by_id("durable", None).await.unwrap().unwrap();
        assert_eq!(durable["availability"], "available");
    });
}

#[test]
fn preserves_process_local_replay_when_discovery_changes_catalog_availability() {
    run_local(async {
        let (_directory, repository, _catalog, cache) = repository();
        repository.save(&session("stale-a"), true).await.unwrap();
        repository.save(&session("stale-b"), true).await.unwrap();
        let reconciled = repository
            .reconcile_native(scope("/workspace", "codex", &[]))
            .await
            .unwrap();
        assert_eq!(
            reconciled["unavailableSessionIds"],
            json!(["stale-a", "stale-b"])
        );
        repository.mark_unavailable("stale-a", None).await.unwrap();
        assert!(cache.find_by_id("stale-a", None).await.is_some());
        repository.remove("stale-a").await.unwrap();
        assert!(cache.find_by_id("stale-a", None).await.is_none());
    });
}

#[test]
fn joins_live_replay_with_the_catalogs_authoritative_availability_for_exact_open() {
    run_local(async {
        let (_directory, repository, catalog, cache) = repository();
        catalog
            .save(&js::with(&session("durable"), "availability", "available"))
            .await
            .unwrap();
        let replay = json!([{
            "schemaVersion": 1, "sequence": 1, "sessionId": "durable", "runtimeId": "codex",
            "provider": "codex", "providerSessionId": "native-durable", "turnId": "turn-1",
            "itemId": null, "emittedAt": "2026-09-01T00:00:00.000Z",
            "type": "turn.started", "payload": {"status": "running"},
        }]);
        let live = js::with(
            &js::with(&session("durable"), "title", "Live title"),
            "events",
            replay.clone(),
        );
        cache.save(&live).await.unwrap();
        let joined = repository
            .find_by_id("durable", Some("/workspace"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(joined["providerSessionId"], "native-durable");
        assert_eq!(joined["title"], "Live title");
        assert_eq!(joined["availability"], "available");
        assert_eq!(joined["events"], replay);
        catalog.mark_unavailable("durable", None).await.unwrap();
        let unavailable = repository
            .find_by_id("durable", Some("/workspace"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(unavailable["availability"], "unavailable");
        assert_eq!(unavailable["events"], replay);
    });
}

#[test]
fn catalog_page_limits_preserve_every_identity_across_restart_and_reject_cross_root_cursors() {
    run_local(async {
        let Fixture {
            _directory,
            file_path,
            catalog,
        } = fixture_with(Some(2));
        let mut saved = Vec::new();
        for i in 0..5 {
            saved.push(
                catalog
                    .upsert_native(&record(&format!("native-{i}")))
                    .await
                    .unwrap(),
            );
        }
        let restarted = AgentConversationCatalog::new(CatalogOptions {
            file_path,
            max_records: Some(2),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(
            restarted.upsert_native(&record("native-0")).await.unwrap()["sessionId"],
            saved[0]["sessionId"]
        );
        let mut cursor = Value::Null;
        let mut collected = Vec::new();
        let mut cross_root_cursor = None;
        for _ in 0..5 {
            let page = restarted
                .list_page("/workspace", &json!({"cursor": cursor}))
                .await
                .unwrap();
            let rows = page["sessions"].as_array().unwrap();
            assert!(rows.len() <= 2);
            collected.extend(ids(rows, "sessionId"));
            cursor = page["nextCursor"].clone();
            if !cursor.is_null() {
                cross_root_cursor = Some(cursor.clone());
            }
            if cursor.is_null() {
                break;
            }
        }
        assert!(cursor.is_null(), "catalog pagination must terminate");
        collected.sort();
        let mut expected = ids(&saved, "sessionId");
        expected.sort();
        assert_eq!(collected, expected);
        assert!(
            restarted
                .find_by_id(saved[0]["sessionId"].as_str().unwrap(), Some("/workspace"))
                .await
                .unwrap()
                .is_some()
        );
        let coverage = restarted.get_coverage().await.unwrap();
        assert_eq!(coverage["truncated"], false);
        assert_eq!(coverage["retained"], 5);
        let error = restarted
            .list_page("/another", &json!({"cursor": cross_root_cursor.unwrap()}))
            .await
            .unwrap_err();
        assert!(error.message.to_lowercase().contains("cursor"));
    });
}

#[test]
fn archived_exclusions_and_visible_rows_share_one_page_budget_without_deleting_identity() {
    run_local(async {
        let Fixture { catalog, .. } = fixture_with(Some(2));
        let mut saved = Vec::new();
        for i in 0..7 {
            saved.push(
                catalog
                    .upsert_native(&record(&format!("native-{i}")))
                    .await
                    .unwrap(),
            );
        }
        for row in &saved[..5] {
            catalog
                .archive(row["sessionId"].as_str().unwrap(), None)
                .await
                .unwrap();
        }
        let mut cursor = Value::Null;
        let mut visible = Vec::new();
        let mut excluded = Vec::new();
        for _ in 0..7 {
            let page = catalog
                .list_page("/workspace", &json!({"cursor":cursor}))
                .await
                .unwrap();
            let rows = page["sessions"].as_array().unwrap();
            let omitted = page["excludedSessionIds"].as_array().unwrap();
            assert!(rows.len() + omitted.len() <= 2);
            visible.extend(ids(rows, "sessionId"));
            excluded.extend(omitted.iter().map(|v| v.as_str().unwrap().to_string()));
            cursor = page["nextCursor"].clone();
            if cursor.is_null() {
                break;
            }
        }
        assert!(cursor.is_null());
        visible.sort();
        excluded.sort();
        let mut expected_visible = ids(&saved[5..], "sessionId");
        expected_visible.sort();
        let mut expected_excluded = ids(&saved[..5], "sessionId");
        expected_excluded.sort();
        assert_eq!(visible, expected_visible);
        assert_eq!(excluded, expected_excluded);
        assert!(
            catalog
                .find_by_id(saved[0]["sessionId"].as_str().unwrap(), None)
                .await
                .unwrap()
                .is_some()
        );
        assert_eq!(
            catalog
                .list_page("/workspace", &json!({"includeArchived":true}))
                .await
                .unwrap()["excludedSessionIds"],
            json!([])
        );
    });
}

#[test]
fn concurrent_reservation_and_discovery_share_an_identity_that_cannot_be_rebound() {
    run_local(async {
        let Fixture { catalog, .. } = fixture();
        let native = js::with(&record("native-1"), "sourceScopeId", "profile-a");
        let reservation = js::with(&native, "sessionId", "product-a");
        let (reserved, discovered) = futures_util::join!(
            catalog.bind_native(&reservation),
            catalog.upsert_native(&native)
        );
        let reserved = reserved.unwrap();
        let discovered = discovered.unwrap();
        assert_eq!(discovered["sessionId"], reserved["sessionId"]);
        let other = catalog
            .upsert_native(&js::with(&record("native-1"), "sourceScopeId", "profile-b"))
            .await
            .unwrap();
        assert_ne!(other["sessionId"], reserved["sessionId"]);
        let rebound = js::Obj::from(&record("another-native"))
            .set("sessionId", reserved["sessionId"].clone())
            .set("sourceScopeId", "profile-a")
            .build();
        assert!(
            catalog
                .save(&rebound)
                .await
                .unwrap_err()
                .message
                .contains("rebound")
        );
        assert_eq!(
            catalog
                .find_by_id(reserved["sessionId"].as_str().unwrap(), None)
                .await
                .unwrap()
                .unwrap()["providerSessionId"],
            "native-1"
        );
    });
}
