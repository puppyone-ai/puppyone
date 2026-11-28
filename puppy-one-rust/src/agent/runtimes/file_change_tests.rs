//! The native event -> Main -> display -> replay contract exercised by
//! `tests/unit/agent/references/electron.agent-file-change-evidence.test.mjs`.
use crate::agent::domain::agent_event_workspace_paths::normalize_agent_event_workspace_paths;
use crate::agent::domain::agent_session_actor::{ActorOptions, EventInput, SessionActor};
use crate::agent::protocols::acp::acp_event_normalizer::AcpEventNormalizer;
use crate::agent::protocols::pi_rpc::pi_event_normalizer::{PiEventState, normalize_pi_rpc_event};
use crate::agent::runtimes::claude::claude_events::{ClaudeEventState, normalize_claude_message};
use crate::agent::runtimes::codex::codex_events::normalize_item_lifecycle;
use core::prelude::v1::test;
use serde_json::{Value, json};

const BEFORE: &str = "source\nold\nend\n";
const AFTER: &str = "source\nnew\nextra\nend\n";
const DIFF: &str = "@@ -1,3 +1,4 @@\n source\n-old\n+new\n+extra\n end\n";

fn native_events(runtime: &str) -> Vec<Value> {
    let path = "/workspace/src/example.ts";
    match runtime {
        "codex" => normalize_item_lifecycle(
            Some(
                &json!({"id": "edit", "type": "fileChange", "status": "completed",
                "changes": [{"path": path, "kind": "update", "diff": DIFF}]}),
            ),
            "completed",
            &json!("native"),
            &json!("turn"),
        ),
        "claude" => {
            let mut state = ClaudeEventState::new(Some("turn"), false);
            [
                json!({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "edit", "name": "Edit",
                    "input": {"file_path": path, "old_string": BEFORE, "new_string": AFTER}}]}}),
                json!({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "edit", "content": "Updated"}]}}),
            ].iter().flat_map(|message| normalize_claude_message(message, &mut state)).collect()
        }
        "pi" => {
            let mut state = PiEventState::new(Some("turn"), Some("native"), "pi", "Pi");
            [
                json!({"type": "tool_execution_start", "toolCallId": "edit", "toolName": "edit",
                    "args": {"path": path, "edits": [{"oldText": BEFORE, "newText": AFTER}]}}),
                json!({"type": "tool_execution_end", "toolCallId": "edit", "isError": false,
                    "result": {"content": [{"type": "text", "text": "Updated"}], "details": {
                        "patch": DIFF, "diff": " 1 source\n-2 old\n+2 new\n+3 extra\n 4 end", "firstChangedLine": 2}}}),
            ].iter().flat_map(|message| normalize_pi_rpc_event(message, &mut state)).collect()
        }
        "cursor"
        | "opencode-native"
        | "workbuddy-china"
        | "workbuddy-international"
        | "hermes"
        | "puppyone-agent" => {
            // These are the exact ACP fixture routes in the frozen TS test.
            // This validates edge translation, not vendor CLI transport startup.
            let mut normalizer = AcpEventNormalizer::new(Some("turn"));
            [
                json!({"sessionUpdate": "tool_call", "toolCallId": "edit", "title": "Edit", "kind": "edit", "status": "in_progress",
                    "content": [{"type": "diff", "path": path, "oldText": BEFORE, "newText": AFTER}]}),
                json!({"sessionUpdate": "tool_call_update", "toolCallId": "edit", "status": "completed"}),
            ].iter().flat_map(|update| normalizer.normalize(&json!({"sessionId": "native", "update": update}))).collect()
        }
        _ => panic!("unknown fixture runtime: {runtime}"),
    }
}

fn assert_edit_survives_main_and_replay(runtime: &str) {
    let events = native_events(runtime);
    assert!(!events.is_empty(), "{runtime} must emit native events");
    let actor = SessionActor::new(ActorOptions::default()).unwrap();
    for event in events {
        actor
            .append_event(EventInput {
                session_id: "session".into(),
                runtime_id: runtime.into(),
                provider_session_id: Some("native".into()),
                event: normalize_agent_event_workspace_paths(&event, "/workspace"),
            })
            .unwrap();
    }
    let replay = SessionActor::new(ActorOptions {
        events: actor.events(),
        ..Default::default()
    })
    .unwrap();
    for display in [actor.display(), replay.display()] {
        let edits: Vec<_> = display
            .parts
            .iter()
            .filter(|part| part["kind"] == "file-change")
            .collect();
        assert_eq!(edits.len(), 1, "{runtime}");
        let changes = edits[0]["detail"]["changes"].as_array().unwrap();
        assert_eq!(changes.len(), 1, "{runtime}");
        assert_eq!(changes[0]["path"], "src/example.ts", "{runtime}");
        assert_eq!(changes[0]["additions"], 2, "{runtime}");
        assert_eq!(changes[0]["deletions"], 1, "{runtime}");
        assert!(
            changes[0]["diff"]
                .as_str()
                .unwrap()
                .contains("-old\n+new\n+extra"),
            "{runtime}"
        );
        assert_eq!(
            changes[0]["blocks"],
            json!([{"removed": "old", "added": "new\nextra"}]),
            "{runtime}"
        );
    }
}

#[test]
fn codex_edits_survive_main_and_replay() {
    assert_edit_survives_main_and_replay("codex");
}
#[test]
fn claude_edits_survive_main_and_replay() {
    assert_edit_survives_main_and_replay("claude");
}
#[test]
fn pi_edits_survive_main_and_replay() {
    assert_edit_survives_main_and_replay("pi");
}
#[test]
fn cursor_edits_survive_main_and_replay() {
    assert_edit_survives_main_and_replay("cursor");
}
#[test]
fn opencode_edits_survive_main_and_replay() {
    assert_edit_survives_main_and_replay("opencode-native");
}
#[test]
fn workbuddy_china_edits_survive_main_and_replay() {
    assert_edit_survives_main_and_replay("workbuddy-china");
}
#[test]
fn workbuddy_international_edits_survive_main_and_replay() {
    assert_edit_survives_main_and_replay("workbuddy-international");
}
#[test]
fn hermes_edits_survive_main_and_replay() {
    assert_edit_survives_main_and_replay("hermes");
}
#[test]
fn builtin_acp_fixture_edits_survive_main_and_replay() {
    assert_edit_survives_main_and_replay("puppyone-agent");
}

#[test]
fn pi_batch_edits_and_legacy_numbered_output_preserve_the_same_blocks() {
    let mut state = PiEventState::new(Some("turn"), Some("native"), "pi", "Pi");
    let start = normalize_pi_rpc_event(
        &json!({"type": "tool_execution_start", "toolCallId": "edit", "toolName": "edit",
        "args": {"path": "file", "edits": [{"oldText": "old", "newText": "new"}, {"oldText": "first @@ literal", "newText": "second"}]}}),
        &mut state,
    );
    assert_eq!(start[0]["payload"]["changes"].as_array().unwrap().len(), 1);
    let change = &start[0]["payload"]["changes"][0];
    assert_eq!(change["additions"], 2);
    assert_eq!(change["deletions"], 2);
    assert_eq!(
        change["blocks"],
        json!([{"removed": "old", "added": "new"}, {"removed": "first @@ literal", "added": "second"}])
    );
    let end = normalize_pi_rpc_event(
        &json!({"type": "tool_execution_end", "toolCallId": "edit", "result": {"content": [],
        "details": {"diff": "  97 context\n- 98 old\n+ 98 new\n     ...\n-102 first @@ literal\n+102 second"}}}),
        &mut state,
    );
    assert_eq!(end[0]["payload"]["changes"][0]["blocks"], change["blocks"]);
    assert_eq!(end[0]["payload"]["changes"][0]["basis"], "native");
}

#[test]
fn acp_diff_creation_omitted_fields_and_explicit_clearing_are_distinct() {
    let mut normalizer = AcpEventNormalizer::new(Some("turn"));
    let mut send = |mut update: Value| {
        update["toolCallId"] = json!("edit");
        normalizer.normalize(&json!({"sessionId": "native", "update": update}))
    };
    let initial = send(
        json!({"sessionUpdate": "tool_call", "kind": "edit", "content": [{"type": "diff", "path": "file", "oldText": null, "newText": "created\n"}]}),
    );
    let change = &initial[0]["payload"]["changes"][0];
    assert_eq!(change["kind"], "add");
    assert_eq!(change["additions"], 1);
    assert_eq!(change["deletions"], 0);
    let omitted = send(json!({"sessionUpdate": "tool_call_update", "status": "completed"}));
    assert_eq!(
        omitted.last().unwrap()["payload"]["changes"],
        initial[0]["payload"]["changes"]
    );
    let cleared = send(json!({"sessionUpdate": "tool_call_update", "content": []}));
    assert_eq!(cleared.last().unwrap()["payload"]["changes"], json!([]));
}
