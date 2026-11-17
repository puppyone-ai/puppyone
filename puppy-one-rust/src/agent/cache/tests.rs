//! `tests/integration/agent/sessions/electron.agent-persistence.test.mjs`.
use super::ephemeral_agent_session_cache::{EphemeralAgentSessionCache, policy};
use crate::agent::application::tests_support::run_local;
use crate::agent::contract::js;
use crate::clock;
use core::prelude::v1::test;
use serde_json::{Value, json};

fn record(session_id: &str, events: Vec<Value>) -> Value {
    let last = events
        .last()
        .map_or(json!(0), |event| event["sequence"].clone());
    json!({
        "sessionId": session_id,
        "workspaceRoot": "/workspace",
        "runtimeId": "codex",
        "runtime": { "id": "codex", "displayName": "Codex", "kind": "native-cli" },
        "providerSessionId": format!("thread-{session_id}"),
        "title": session_id,
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:01.000Z",
        "terminalState": "idle",
        "selectedModel": "gpt-5",
        "lastSequence": last,
        "events": events,
    })
}

fn event(sequence: i64, kind: &str, payload: Value) -> Value {
    json!({
        "schemaVersion": 1,
        "sequence": sequence,
        "sessionId": "session-1",
        "runtimeId": "codex",
        "provider": "codex",
        "providerSessionId": "thread-1",
        "turnId": "turn-1",
        "itemId": null,
        "emittedAt": clock::iso_string(sequence * 1_000),
        "type": kind,
        "payload": payload,
    })
}

fn entries(directory: &std::path::Path) -> Vec<String> {
    std::fs::read_dir(directory)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect()
}

#[test]
fn keeps_bounded_redacted_recovery_events_in_memory_only() {
    run_local(async {
        let user_data = tempfile::tempdir().unwrap();
        let cache = EphemeralAgentSessionCache::new(Some(user_data.path()), None, None);
        cache
            .save(&record(
                "session-1",
                vec![
                    event(
                        1,
                        "command.output.delta",
                        json!({ "delta": "AWS_SECRET_ACCESS_KEY=raw-secret" }),
                    ),
                    event(
                        2,
                        "tool.completed",
                        json!({ "outputPreview": "CLIENT_SECRET=retained-secret" }),
                    ),
                    event(
                        3,
                        "usage.updated",
                        json!({ "total": { "inputTokens": 12, "outputTokens": 4 } }),
                    ),
                ],
            ))
            .await
            .unwrap();
        let stored = cache.read_all().await.remove(0);
        let types: Vec<&str> = stored["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["type"].as_str().unwrap())
            .collect();
        assert_eq!(types, ["tool.completed", "usage.updated"]);
        let text = stored.to_string();
        assert!(!text.contains("raw-secret"));
        assert!(!text.contains("retained-secret"));
        assert_eq!(
            stored["events"][1]["payload"]["total"],
            json!({ "inputTokens": 12, "outputTokens": 4 })
        );
        assert!(entries(user_data.path()).is_empty());
    });
}

#[test]
fn removes_the_legacy_durable_chat_journal_and_never_recreates_it() {
    run_local(async {
        let user_data = tempfile::tempdir().unwrap();
        let legacy = user_data.path().join(policy::LEGACY_JOURNAL_FILENAME);
        let stale = user_data
            .path()
            .join(format!("{}.12345.tmp", policy::LEGACY_JOURNAL_FILENAME));
        let journal = json!({ "version": 3, "sessions": [record("legacy", vec![])] }).to_string();
        std::fs::write(&legacy, &journal).unwrap();
        std::fs::write(&stale, &journal).unwrap();
        let cache = EphemeralAgentSessionCache::new(Some(user_data.path()), None, None);
        assert!(cache.read_all().await.is_empty());
        assert!(!legacy.exists());
        assert!(!stale.exists());
        cache.save(&record("current", vec![])).await.unwrap();
        assert!(!legacy.exists());
    });
}

#[test]
fn does_not_restore_conversations_in_a_new_application_process_cache() {
    run_local(async {
        let user_data = tempfile::tempdir().unwrap();
        let first = EphemeralAgentSessionCache::new(Some(user_data.path()), None, None);
        first
            .save(&record(
                "session-1",
                vec![event(
                    1,
                    "assistant.completed",
                    json!({ "text": "private chat" }),
                )],
            ))
            .await
            .unwrap();
        assert_eq!(
            first
                .find_latest("/workspace", Some("codex"))
                .await
                .unwrap()["sessionId"],
            "session-1"
        );
        let restarted = EphemeralAgentSessionCache::new(Some(user_data.path()), None, None);
        assert!(
            restarted
                .find_latest("/workspace", Some("codex"))
                .await
                .is_none()
        );
        const { assert!(!policy::DURABLE) };
    });
}

#[test]
fn supports_process_local_replacement_and_explicit_removal_for_live_recovery() {
    run_local(async {
        let user_data = tempfile::tempdir().unwrap();
        let cache = EphemeralAgentSessionCache::new(Some(user_data.path()), None, None);
        cache.save(&record("session-1", vec![])).await.unwrap();
        let updated = js::with(
            &js::with(&record("session-1", vec![]), "title", "Updated"),
            "updatedAt",
            "2026-01-01T00:00:02.000Z",
        );
        cache.save(&updated).await.unwrap();
        let all = cache.read_all().await;
        assert_eq!(all.len(), 1);
        assert_eq!(all[0]["sessionId"], "session-1");
        assert_eq!(all[0]["title"], "Updated");
        let listed = crate::agent::application::ports::SessionCache::list(
            &cache,
            "/workspace".into(),
            json!({}),
        )
        .await
        .unwrap();
        assert!(listed.is_empty());
        cache.remove("session-1").await;
        assert!(
            cache
                .find_by_id("session-1", Some("/workspace"))
                .await
                .is_none()
        );
    });
}

#[test]
fn retains_independent_process_local_recovery_snapshots_for_same_workspace_tabs() {
    run_local(async {
        let user_data = tempfile::tempdir().unwrap();
        let cache = EphemeralAgentSessionCache::new(Some(user_data.path()), None, None);
        cache
            .save(&record(
                "session-1",
                vec![event(1, "assistant.completed", json!({ "text": "first" }))],
            ))
            .await
            .unwrap();
        cache
            .save(&record(
                "session-2",
                vec![event(1, "assistant.completed", json!({ "text": "second" }))],
            ))
            .await
            .unwrap();
        assert_eq!(
            cache
                .find_by_id("session-1", Some("/workspace"))
                .await
                .unwrap()["sessionId"],
            "session-1"
        );
        assert_eq!(
            cache
                .find_by_id("session-2", Some("/workspace"))
                .await
                .unwrap()["sessionId"],
            "session-2"
        );
        assert_eq!(cache.read_all().await.len(), 2);
    });
}
