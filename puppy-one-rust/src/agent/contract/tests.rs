//! `tests/architecture/agent/sessions/electron.agent-contract-schema.test.mjs`.
use super::event_schema::{assert_agent_event_envelope, sanitize_agent_event_envelope};
use super::js;
use super::runtime_schema::{
    assert_agent_runtime_capabilities, normalize_reference_input_capabilities,
};
use super::schema::{assert_agent_ipc_response, parse_agent_ipc_request};
use core::prelude::v1::test;
use serde_json::{Value, json};

fn event(event_type: &str, payload: Value) -> Value {
    json!({
        "schemaVersion": 1,
        "sequence": 1,
        "sessionId": "session-1",
        "runtimeId": "fixture",
        "provider": "fixture",
        "providerSessionId": "native-1",
        "turnId": "turn-1",
        "itemId": "item-1",
        "emittedAt": "2026-07-11T00:00:00.000Z",
        "type": event_type,
        "payload": payload,
    })
}

fn with(base: &Value, extra: Value) -> Value {
    let mut out = base.clone();
    for (key, value) in extra.as_object().unwrap() {
        out[key] = value.clone();
    }
    out
}

fn err(result: Result<impl std::fmt::Debug, super::ContractError>) -> String {
    result.unwrap_err().0
}

#[test]
fn bounds_inline_attachment_input_and_strips_renderer_mime_claims() {
    let context = json!({"rootPath": "/workspace", "epoch": "draft"});
    let bytes = js::uint8array(&[1, 2]);
    assert_eq!(
        parse_agent_ipc_request(
            "agent:reference-stage",
            &with(&context, json!({"sources": [
                {"name": "clipboard.png", "bytes": bytes, "mime": "image/png", "authorized": true},
                {"path": "/selected/image.png"},
            ]})),
        )
        .unwrap(),
        with(&context, json!({"sources": [{"name": "clipboard.png", "bytes": bytes}, {"path": "/selected/image.png"}]}))
    );
    let image = json!({"name": "image.png", "bytes": bytes});
    for input in [
        json!({"sources": []}),
        json!({"sources": vec![image.clone(); 33]}),
        json!({"sourcePaths": ["/selected/image.png"], "sources": [image]}),
        json!({"sources": [{"path": "/selected/image.png", "bytes": bytes}]}),
        json!({"sources": [{"name": "../image.png", "bytes": bytes}]}),
        json!({"sources": [{"name": "image.png", "bytes": []}]}),
        json!({"sources": [{"name": "image.png", "bytes": js::uint8array(&[])}]}),
        json!({"sources": [
            {"name": "image.png", "bytes": js::uint8array(&vec![0; 25 * 1024 * 1024])},
            {"name": "more.png", "bytes": bytes},
        ]}),
    ] {
        let message = err(parse_agent_ipc_request(
            "agent:reference-stage",
            &with(&context, input),
        ));
        assert!(message.contains("Invalid Agent contract"), "{message}");
    }
}

#[test]
fn parses_and_strips_ipc_input_before_workspace_authorization() {
    assert_eq!(
        parse_agent_ipc_request(
            "agent:local-connections-discover",
            &json!({"rootPath": "/workspace", "refresh": true, "executablePath": "/private/should-not-cross"}),
        )
        .unwrap(),
        json!({"rootPath": "/workspace", "refresh": true})
    );
    assert_eq!(
        parse_agent_ipc_request(
            "agent:turn-start",
            &json!({
                "rootPath": "/workspace",
                "sessionId": "session-1",
                "recoveryOfTurnId": "turn-original",
                "prompt": "  keep whitespace  ",
                "effort": "high",
                "unknownPrivilegedField": {"shell": true},
                "attachments": [{"path": "/workspace/a.md", "name": "a.md", "bytes": "not-authorized"}],
                "promptMentions": [{"referenceId": "ref-a", "start": 2, "end": 7, "privatePath": "/private/a.md"}],
            }),
        )
        .unwrap(),
        json!({
            "rootPath": "/workspace",
            "sessionId": "session-1",
            "recoveryOfTurnId": "turn-original",
            "prompt": "  keep whitespace  ",
            "effort": "high",
            "attachments": [{"path": "/workspace/a.md", "name": "a.md"}],
            "promptMentions": [{"referenceId": "ref-a", "start": 2, "end": 7}],
        })
    );
    let reference = json!({
        "id": "ref-a",
        "kind": "workspace-entry",
        "entryType": "file",
        "relativePath": "docs/a.md",
        "displayName": "a.md",
        "mime": "text/markdown",
        "size": 4,
        "status": "ready",
    });
    assert_eq!(
        parse_agent_ipc_request(
            "agent:turn-start",
            &json!({
                "rootPath": "/workspace",
                "sessionId": "session-1",
                "prompt": "Review @docs/a.md",
                "references": [with(&reference, json!({"path": "/private/renderer-path-must-not-cross"}))],
            }),
        )
        .unwrap(),
        json!({
            "rootPath": "/workspace",
            "sessionId": "session-1",
            "prompt": "Review @docs/a.md",
            "references": [reference],
        })
    );
    let message = err(parse_agent_ipc_request(
        "agent:turn-start",
        &json!({
            "rootPath": "/workspace",
            "sessionId": "session-1",
            "prompt": "Review",
            "references": [{
                "id": "ref-a", "kind": "workspace-entry", "entryType": "file",
                "relativePath": "../private/a.md", "displayName": "a.md", "status": "ready",
            }],
        }),
    ));
    assert!(message.contains("workspace-relative"), "{message}");
    let message = err(parse_agent_ipc_request(
        "agent:approval-resolve",
        &json!({"rootPath": "/workspace", "sessionId": "s", "turnId": "t", "requestId": "r", "decision": "always-and-never-ask"}),
    ));
    assert!(
        message.starts_with("Invalid Agent contract: decision"),
        "{message}"
    );
    assert_eq!(
        parse_agent_ipc_request(
            "agent:command-dispatch",
            &json!({
                "kind": "interrupt",
                "rootPath": "/workspace",
                "sessionId": "session-1",
                "turnId": "turn-2",
                "commandId": "command-2",
                "expectedSessionEpoch": "epoch-1",
                "expectedAdapterGeneration": 3,
                "expectedRunGeneration": 7,
                "nativeHandle": "must-not-cross",
            }),
        )
        .unwrap(),
        json!({
            "kind": "interrupt",
            "rootPath": "/workspace",
            "sessionId": "session-1",
            "turnId": "turn-2",
            "commandId": "command-2",
            "expectedSessionEpoch": "epoch-1",
            "expectedAdapterGeneration": 3,
            "expectedRunGeneration": 7,
        })
    );
}

#[test]
fn rejects_malformed_main_to_renderer_responses_and_blocking_events() {
    let connection = json!({
        "id": "codex",
        "displayName": "Codex CLI",
        "installation": "detected",
        "version": "0.144.1",
        "authentication": "signed-in",
        "integration": "bridge-required",
        "capabilities": {"versionProbe": true, "authenticationProbe": true, "protocolProbe": true},
        "selectable": false,
        "statusMessage": "Detected; direct harness not enabled.",
        "actions": [{"id": "refresh", "label": "Refresh"}],
        "source": "user-installation",
    });
    assert_eq!(
        assert_agent_ipc_response(
            "agent:local-connections-discover",
            &json!({
                "connections": [with(&connection, json!({
                    "executablePath": "/Users/private/.local/bin/codex",
                    "rawStatus": "private@example.test",
                }))],
                "scannedAt": "2026-07-12T00:00:00.000Z",
                "warnings": [],
                "environment": {"OPENAI_API_KEY": "secret"},
            }),
        )
        .unwrap(),
        json!({"connections": [connection], "scannedAt": "2026-07-12T00:00:00.000Z", "warnings": []})
    );
    assert!(
        assert_agent_ipc_response(
            "agent:local-connections-discover",
            &json!({
                "connections": [{"id": "codex", "displayName": "Codex CLI", "installation": "ready"}],
                "scannedAt": "not-a-date",
                "warnings": [],
            }),
        )
        .is_err()
    );
    assert!(
        err(assert_agent_ipc_response(
            "agent:session-create",
            &json!({"session": {"id": "s", "runtimeId": "codex", "provider": "codex", "title": "Session"}}),
        ))
        .contains("workspaceRoot")
    );
    assert!(
        err(assert_agent_event_envelope(&event(
            "approval.requested",
            json!({})
        )))
        .contains("requestId")
    );
    assert!(
        assert_agent_event_envelope(&event("assistant.delta", json!({"delta": "safe"}))).is_ok()
    );
    assert!(
        assert_agent_event_envelope(&event("user.message", json!({"text": "follow up"}))).is_ok()
    );
    assert!(
        err(assert_agent_event_envelope(&event(
            "user.message",
            json!({})
        )))
        .contains("user.message).payload.text")
    );
    assert!(
        assert_agent_event_envelope(&event(
            "provider.connection.updated",
            json!({"state": "reconnecting", "attempt": 2, "maxAttempts": 5}),
        ))
        .is_ok()
    );
    assert!(
        err(assert_agent_event_envelope(&event(
            "provider.connection.updated",
            json!({"state": "maybe"}),
        )))
        .contains("connection.updated).payload.state")
    );
    let reference_display = json!({"id": "ref-1", "kind": "attachment", "displayName": "capture.png", "mime": "image/png", "size": 3});
    assert!(
        assert_agent_event_envelope(&event(
            "turn.started",
            json!({"referenceDisplays": [reference_display]})
        ))
        .is_ok()
    );
    assert!(
        assert_agent_event_envelope(&event(
            "turn.started",
            json!({"recoveryOfTurnId": "turn-original"})
        ))
        .is_ok()
    );
    assert!(
        assert_agent_event_envelope(&event(
            "turn.completed",
            json!({
                "completionQuality": "degraded",
                "failureScope": "upstream-request",
                "failureCode": "CURSOR_HTTP2_STREAM_CANCEL",
                "retryable": true,
                "transportHealth": "healthy",
                "sideEffects": "possible",
            }),
        ))
        .is_ok()
    );
    assert!(
        err(assert_agent_event_envelope(&event(
            "turn.completed",
            json!({"completionQuality": "degraded", "failureCode": "INCOMPLETE_RECOVERY_FACT"}),
        )))
        .contains("failureScope")
    );
    assert!(
        assert_agent_event_envelope(&event(
            "turn.started",
            json!({
                "prompt": "See @capture.png",
                "referenceDisplays": [reference_display],
                "promptMentions": [{"referenceId": "ref-1", "start": 4, "end": 16}],
            }),
        ))
        .is_ok()
    );
    assert!(
        err(assert_agent_event_envelope(&event(
            "turn.started",
            json!({"prompt": "short", "promptMentions": [{"referenceId": "ref-1", "start": 0, "end": 99}]}),
        )))
        .contains("range")
    );
    assert!(
        err(assert_agent_event_envelope(&event(
            "turn.started",
            json!({"referenceDisplays": [with(&reference_display, json!({"token": "opaque-secret"}))]}),
        )))
        .contains("renderer-safe reference metadata")
    );
    assert!(
        err(assert_agent_event_envelope(&event(
            "turn.started",
            json!({"referenceDisplays": [with(&reference_display, json!({"kind": "workspace-file", "relativePath": "/private/source.txt"}))]}),
        )))
        .contains("workspace-relative")
    );
    assert!(
        err(assert_agent_ipc_response(
            "agent:providers-discover",
            &json!({
                "readiness": {"runtimeId": "opencode", "status": "ready", "code": "READY"},
                "providers": [{"id": "openai", "displayName": "OpenAI", "modelCount": -1}],
                "models": [], "capabilities": {}, "warnings": [],
            }),
        ))
        .contains("modelCount")
    );
    assert!(
        err(assert_agent_ipc_response(
            "agent:providers-discover",
            &json!({
                "readiness": {"runtimeId": "cursor", "status": "installed-not-authenticated", "code": "AUTHENTICATION_PROBE_FAILED"},
                "providers": [], "models": [], "capabilities": {}, "warnings": [],
            }),
        ))
        .contains("incompatible with status")
    );
}

#[test]
fn keeps_canonical_content_fields_and_strips_unknown_native_provenance() {
    let sanitized = sanitize_agent_event_envelope(&event(
        "tool.completed",
        json!({
            "kind": "mcp",
            "result": {"content": [{"type": "text", "text": "visible result"}], "error": null, "success": true, "truncated": false},
            "nativePrivateTrace": {"token": "must-not-cross"},
        }),
    ))
    .unwrap();
    assert_eq!(
        sanitized["payload"]["result"]["content"][0]["text"],
        "visible result"
    );
    assert!(sanitized["payload"].get("nativePrivateTrace").is_none());
}

#[test]
fn bounds_native_history_discovery_and_strips_transcript_shaped_list_fields() {
    assert_eq!(
        parse_agent_ipc_request(
            "agent:sessions-list",
            &json!({
                "rootPath": "/workspace", "runtimeId": "codex", "discoverNative": true, "cursor": "page-2",
                "scanId": "scan-1", "limit": 20, "scanPrivateDatabase": true,
            }),
        )
        .unwrap(),
        json!({"rootPath": "/workspace", "runtimeId": "codex", "discoverNative": true, "cursor": "page-2", "scanId": "scan-1", "limit": 20})
    );
    let response = assert_agent_ipc_response(
        "agent:sessions-list",
        &json!({
            "sessions": [{
                "id": "session-1", "runtimeId": "codex", "provider": "codex", "providerSessionId": "thread-1",
                "workspaceRoot": "/workspace", "title": "Saved thread",
                "createdAt": "2026-08-29T00:00:00.000Z", "updatedAt": "2026-08-30T00:00:00.000Z",
                "terminalState": "idle", "selectedModel": null, "lastSequence": 0, "origin": "native-discovery",
                "transcript": [{"role": "user", "text": "must not cross"}],
                "events": [{"payload": {"secret": true}}],
            }],
            "discovery": {"runtimeId": "codex", "status": "partial", "nextCursor": "page-3", "scanId": "scan-1", "indexed": 1, "warnings": []},
            "warnings": [],
        }),
    )
    .unwrap();
    assert!(response["sessions"][0].get("transcript").is_none());
    assert!(response["sessions"][0].get("events").is_none());
    assert_eq!(response["discovery"]["scanId"], "scan-1");
    assert!(
        err(assert_agent_ipc_response(
            "agent:sessions-list",
            &json!({
                "sessions": [],
                "discovery": {"runtimeId": "codex", "status": "scanning-everything", "nextCursor": null, "indexed": 0, "warnings": []},
                "warnings": [],
            }),
        ))
        .contains("discovery.status")
    );
}

#[test]
fn preserves_structured_exact_session_open_failures() {
    assert_eq!(
        parse_agent_ipc_request(
            "agent:session-open",
            &json!({"rootPath": "/workspace", "sessionId": "saved-session", "runtimeId": "cursor", "providerSessionId": "must-not-cross"}),
        )
        .unwrap(),
        json!({"rootPath": "/workspace", "sessionId": "saved-session", "runtimeId": "cursor"})
    );
    assert_eq!(
        assert_agent_ipc_response(
            "agent:session-open",
            &json!({
                "status": "failed",
                "error": {"code": "SESSION_NOT_FOUND", "message": "This saved session is unavailable.", "retryable": false, "diagnostic": "private"},
            }),
        )
        .unwrap(),
        json!({
            "status": "failed",
            "error": {"code": "SESSION_NOT_FOUND", "message": "This saved session is unavailable.", "retryable": false},
        })
    );
}

#[test]
fn requires_methods_for_capabilities_a_runtime_advertises() {
    assert!(
        err(assert_agent_runtime_capabilities(
            |_| false,
            &json!({"manualApprovals": true}),
            "fixture"
        ))
        .contains("resolveApproval")
    );
    assert_eq!(
        assert_agent_runtime_capabilities(
            |method| method == "resolveApproval",
            &json!({"manualApprovals": true}),
            "fixture",
        )
        .unwrap()["manualApprovals"],
        true
    );
}

#[test]
fn fails_unknown_legacy_reference_transports_into_the_semantic_attachment_contract() {
    let normalized = normalize_reference_input_capabilities(
        Some(&json!({"images": "future-transport"})),
        &json!({"attachments": true}),
    );
    assert_eq!(normalized["schemaVersion"], 1);
    for kind in ["image", "text", "binary"] {
        assert_eq!(normalized["attachments"][kind]["accepted"], false);
    }
    let normalized = normalize_reference_input_capabilities(
        Some(&json!({"attachments": {"binary": {"accepted": true, "delivery": "unsafe"}}})),
        &json!({}),
    );
    assert!(
        normalized["attachments"]["binary"]
            .get("delivery")
            .is_none()
    );
}
