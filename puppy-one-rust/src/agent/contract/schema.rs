//! `shared/agent-contract/schema.mjs`: every request the Renderer makes of
//! Main, parsed and stripped before workspace authorization, and every
//! response, checked before the Renderer reads it.
use super::constants::{AGENT_SESSION_OPEN_ERROR_CODES, limits};
use super::display_schema::{assert_agent_display, assert_agent_display_patch};
use super::event_schema::assert_agent_event_envelope;
use super::history_schema::{history_cursor, history_native_id};
use super::js::{self, Obj};
use super::local_connection_schema::sanitize_agent_local_connections_snapshot;
use super::reference_identity::normalize_agent_workspace_relative_path;
use super::runtime_schema::{
    assert_agent_inference_provider, assert_agent_inspection, assert_agent_model,
    sanitize_agent_runtime_descriptor,
};
use super::validation::{
    Contract, StringRule, assert_array, assert_record, assert_runtime_id, compact_opaque_id,
    contract_error, enum_value, non_negative_integer, optional_boolean,
    optional_nullable_opaque_id, optional_record, optional_runtime_id, optional_string,
    positive_integer, required_opaque_id, required_string, required_string_with, type_error,
};
use super::workspace_resource_reference::parse_workspace_resource_reference;
use crate::clock;
use crate::text;
use serde_json::{Map, Value};
use std::collections::HashSet;

use limits::{
    MAX_COMMAND_ERROR_LENGTH, MAX_COMMAND_FINGERPRINT_LENGTH, MAX_CONTROL_REASON_LENGTH,
    MAX_MESSAGE_LENGTH, MAX_PATH_LENGTH, MAX_REFERENCE_COUNT,
};

type Record = Map<String, Value>;

/// `parseAgentIpcRequest(channel, value)`.
pub fn parse_agent_ipc_request(channel: &str, value: &Value) -> Contract<Value> {
    let mut request = parse_agent_request_body(channel, value)?;
    let map = request.as_object_mut().expect("request bodies are objects");
    if !js::nullish(js::get(value, "instanceId")) {
        map.insert(
            "instanceId".into(),
            required_opaque_id(js::get(value, "instanceId"), "instanceId")?.into(),
        );
    }
    if matches!(
        channel,
        "agent:session-create" | "agent:session-open" | "agent:session-resume"
    ) {
        for key in ["itemId", "creationId"] {
            if !js::nullish(js::get(value, key)) {
                map.insert(
                    key.into(),
                    required_opaque_id(js::get(value, key), key)?.into(),
                );
            }
        }
    }
    Ok(request)
}

fn root_path(input: &Record) -> Contract<String> {
    required_string(input.get("rootPath"), "rootPath", MAX_PATH_LENGTH)
}

fn session_id(input: &Record) -> Contract<String> {
    required_opaque_id(input.get("sessionId"), "sessionId")
}

fn parse_agent_request_body(channel: &str, value: &Value) -> Contract<Value> {
    let input = optional_record(Some(value), channel)?;
    let field = |key: &str| input.get(key);
    Ok(match channel {
        "agent:providers-discover"
        | "agent:local-connections-discover"
        | "agent:models-list"
        | "agent:account-read" => Obj::new()
            .opt(
                "rootPath",
                optional_string(field("rootPath"), "rootPath", MAX_PATH_LENGTH)?,
            )
            .opt("runtimeId", optional_runtime_id(field("runtimeId"))?)
            .opt("refresh", optional_boolean(field("refresh"), "refresh")?)
            .build(),
        "agent:session-create" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .opt("runtimeId", optional_runtime_id(field("runtimeId"))?)
            .opt("model", optional_string(field("model"), "model", 512)?)
            .opt("effort", optional_string(field("effort"), "effort", 160)?)
            .opt("mode", optional_string(field("mode"), "mode", 160)?)
            .build(),
        "agent:session-resume" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .opt(
                "sessionId",
                compact_opaque_id(field("sessionId"), "sessionId")?,
            )
            .opt("runtimeId", optional_runtime_id(field("runtimeId"))?)
            .build(),
        "agent:session-open" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .set("sessionId", session_id(&input)?)
            .set(
                "runtimeId",
                assert_runtime_id(field("runtimeId"), "runtimeId")?,
            )
            .build(),
        "agent:session-replay" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .set("sessionId", session_id(&input)?)
            .set(
                "afterSequence",
                non_negative_integer(field("afterSequence"), "afterSequence")?,
            )
            .build(),
        "agent:session-attach" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .set("sessionId", session_id(&input)?)
            .build(),
        "agent:session-feed-ack" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .set("sessionId", session_id(&input)?)
            .set(
                "subscriptionId",
                required_opaque_id(field("subscriptionId"), "subscriptionId")?,
            )
            .set(
                "streamId",
                required_opaque_id(field("streamId"), "streamId")?,
            )
            .set(
                "revision",
                non_negative_integer(field("revision"), "revision")?,
            )
            .build(),
        "agent:session-feed-watermark" | "agent:session-detach" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .set("sessionId", session_id(&input)?)
            .set(
                "subscriptionId",
                required_opaque_id(field("subscriptionId"), "subscriptionId")?,
            )
            .build(),
        "agent:sessions-list" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .opt("runtimeId", optional_runtime_id(field("runtimeId"))?)
            .opt(
                "includeArchived",
                optional_boolean(field("includeArchived"), "includeArchived")?,
            )
            .opt(
                "discoverNative",
                optional_boolean(field("discoverNative"), "discoverNative")?,
            )
            .opt("catalogCursor", history_cursor(field("catalogCursor"))?)
            .opt("cursor", history_cursor(field("cursor"))?)
            .opt("scanId", compact_opaque_id(field("scanId"), "scanId")?)
            .opt("limit", optional_page_size(field("limit"), "limit")?)
            .build(),
        "agent:session-fork" | "agent:session-archive" | "agent:session-delete" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .set("sessionId", session_id(&input)?)
            .opt(
                "messageId",
                compact_opaque_id(field("messageId"), "messageId")?,
            )
            .opt(
                "archiveNative",
                optional_boolean(field("archiveNative"), "archiveNative")?,
            )
            .opt(
                "deleteNative",
                optional_boolean(field("deleteNative"), "deleteNative")?,
            )
            .build(),
        "agent:session-close" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .set("sessionId", session_id(&input)?)
            .opt(
                "removePersistence",
                optional_boolean(field("removePersistence"), "removePersistence")?,
            )
            .build(),
        "agent:reference-stage" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .set("epoch", required_opaque_id(field("epoch"), "epoch")?)
            .spread(&attachment_stage_sources(&input)?)
            .build(),
        "agent:reference-revoke" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .set(
                "tokens",
                bounded_opaque_id_array(field("tokens"), "tokens", MAX_REFERENCE_COUNT)?,
            )
            .build(),
        "agent:reference-resolve-workspace" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .set(
                "paths",
                bounded_string_array(field("paths"), "paths", MAX_REFERENCE_COUNT, 16_384)?,
            )
            .build(),
        "agent:reference-pick-workspace" => Obj::new().set("rootPath", root_path(&input)?).build(),
        "agent:command-dispatch" => {
            let kind = enum_value(
                field("kind"),
                "kind",
                &["start", "steer", "interrupt", "approval", "question"],
            )?;
            let channel_for_kind = match kind {
                "start" => "agent:turn-start",
                "steer" => "agent:turn-steer",
                "interrupt" => "agent:turn-interrupt",
                "approval" => "agent:approval-resolve",
                _ => "agent:question-resolve",
            };
            Obj::new()
                .set("kind", kind)
                .spread(&parse_agent_ipc_request(
                    channel_for_kind,
                    &Value::Object(input.clone()),
                )?)
                .build()
        }
        "agent:turn-start" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .set("sessionId", session_id(&input)?)
            .opt(
                "commandId",
                compact_opaque_id(field("commandId"), "commandId")?,
            )
            .opt(
                "recoveryOfTurnId",
                compact_opaque_id(field("recoveryOfTurnId"), "recoveryOfTurnId")?,
            )
            .spread(&command_preconditions(&input)?)
            .set(
                "prompt",
                required_string_with(
                    field("prompt"),
                    "prompt",
                    MAX_MESSAGE_LENGTH,
                    StringRule::VERBATIM,
                )?,
            )
            .opt("model", optional_string(field("model"), "model", 512)?)
            .opt("effort", optional_string(field("effort"), "effort", 160)?)
            .opt("mode", optional_string(field("mode"), "mode", 160)?)
            .opt(
                "referenceEpoch",
                compact_opaque_id(field("referenceEpoch"), "referenceEpoch")?,
            )
            .opt(
                "attachments",
                optional_references(field("attachments"), "attachments")?,
            )
            .opt(
                "contextReferences",
                optional_references(field("contextReferences"), "contextReferences")?,
            )
            .opt(
                "references",
                optional_draft_references(field("references"), "references")?,
            )
            .opt(
                "promptMentions",
                optional_prompt_mentions(field("promptMentions"), "promptMentions")?,
            )
            .build(),
        "agent:turn-steer" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .set("sessionId", session_id(&input)?)
            .set("turnId", required_opaque_id(field("turnId"), "turnId")?)
            .opt(
                "commandId",
                compact_opaque_id(field("commandId"), "commandId")?,
            )
            .spread(&command_preconditions(&input)?)
            .set(
                "message",
                required_string_with(
                    field("message"),
                    "message",
                    MAX_MESSAGE_LENGTH,
                    StringRule::VERBATIM,
                )?,
            )
            .opt(
                "referenceEpoch",
                compact_opaque_id(field("referenceEpoch"), "referenceEpoch")?,
            )
            .opt(
                "references",
                optional_draft_references(field("references"), "references")?,
            )
            .opt(
                "promptMentions",
                optional_prompt_mentions(field("promptMentions"), "promptMentions")?,
            )
            .build(),
        "agent:turn-interrupt" | "agent:session-compact" => {
            let interrupt = channel == "agent:turn-interrupt";
            let mut body = Obj::new()
                .set("rootPath", root_path(&input)?)
                .set("sessionId", session_id(&input)?)
                .opt(
                    "commandId",
                    compact_opaque_id(field("commandId"), "commandId")?,
                );
            if interrupt {
                body = body
                    .spread(&command_preconditions(&input)?)
                    .set("turnId", required_opaque_id(field("turnId"), "turnId")?);
            }
            body.build()
        }
        "agent:approval-resolve" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .set("sessionId", session_id(&input)?)
            .set("turnId", required_opaque_id(field("turnId"), "turnId")?)
            .set(
                "requestId",
                required_opaque_id(field("requestId"), "requestId")?,
            )
            .opt(
                "commandId",
                compact_opaque_id(field("commandId"), "commandId")?,
            )
            .spread(&command_preconditions(&input)?)
            .set(
                "decision",
                enum_value(
                    field("decision"),
                    "decision",
                    &["accept", "acceptForSession", "decline", "cancel"],
                )?,
            )
            .build(),
        "agent:question-resolve" => Obj::new()
            .set("rootPath", root_path(&input)?)
            .set("sessionId", session_id(&input)?)
            .set("turnId", required_opaque_id(field("turnId"), "turnId")?)
            .set(
                "requestId",
                required_opaque_id(field("requestId"), "requestId")?,
            )
            .opt(
                "commandId",
                compact_opaque_id(field("commandId"), "commandId")?,
            )
            .spread(&command_preconditions(&input)?)
            .opt(
                "answer",
                optional_question_answer(field("answer"), "answer")?,
            )
            .opt(
                "answers",
                optional_answer_matrix(field("answers"), "answers")?,
            )
            .opt("rejected", optional_boolean(field("rejected"), "rejected")?)
            .build(),
        _ => return Err(type_error(format!("Unknown Agent IPC channel: {channel}"))),
    })
}

/// `assertAgentIpcResponse(channel, value)`.
pub fn assert_agent_ipc_response(channel: &str, value: &Value) -> Contract<Value> {
    match channel {
        "agent:providers-discover" => assert_agent_inspection(value).map(|_| value.clone()),
        "agent:local-connections-discover" => sanitize_agent_local_connections_snapshot(value),
        "agent:models-list" => {
            for model in assert_array(Some(value), "models")? {
                assert_agent_model(model)?;
            }
            Ok(value.clone())
        }
        "agent:account-read" => {
            if !value.is_null() {
                assert_record(Some(value), "account state")?;
            }
            Ok(value.clone())
        }
        "agent:session-create" | "agent:session-replay" | "agent:session-fork" => {
            assert_agent_session_snapshot(value).map(|_| value.clone())
        }
        "agent:session-resume" => {
            if !value.is_null() {
                assert_agent_session_snapshot(value)?;
            }
            Ok(value.clone())
        }
        "agent:session-attach" => {
            let receipt = assert_record(Some(value), "Agent session feed receipt")?;
            required_opaque_id(receipt.get("subscriptionId"), "subscriptionId")?;
            assert_agent_session_snapshot(receipt.get("snapshot").unwrap_or(&Value::Null))?;
            Ok(value.clone())
        }
        "agent:session-open" => sanitize_agent_session_open_result(value),
        "agent:sessions-list" => sanitize_agent_sessions_list_response(value),
        "agent:session-archive"
        | "agent:session-delete"
        | "agent:session-close"
        | "agent:session-feed-ack"
        | "agent:session-feed-watermark"
        | "agent:session-detach"
        | "agent:reference-revoke"
        | "agent:command-dispatch"
        | "agent:turn-start"
        | "agent:turn-steer"
        | "agent:turn-interrupt"
        | "agent:session-compact"
        | "agent:approval-resolve"
        | "agent:question-resolve" => {
            assert_record(Some(value), &format!("{channel} response"))?;
            Ok(value.clone())
        }
        "agent:reference-stage"
        | "agent:reference-resolve-workspace"
        | "agent:reference-pick-workspace" => {
            let entries = assert_array(Some(value), &format!("{channel} response"))?;
            entries
                .iter()
                .enumerate()
                .map(|(index, entry)| {
                    sanitize_draft_reference(entry, &format!("{channel}[{index}]"), false)
                })
                .collect::<Contract<Vec<_>>>()
                .map(Value::Array)
        }
        _ => Err(type_error(format!("Unknown Agent IPC channel: {channel}"))),
    }
}

fn optional_page_size(value: Option<&Value>, label: &str) -> Contract<Option<i64>> {
    if js::nullish(value) {
        return Ok(None);
    }
    let normalized = non_negative_integer(value, label)?;
    if !(1..=100).contains(&normalized) {
        return Err(contract_error(label, "must be between 1 and 100"));
    }
    Ok(Some(normalized))
}

/// `assertAgentSessionSnapshot(value)`.
pub fn assert_agent_session_snapshot(value: &Value) -> Contract<()> {
    let snapshot = assert_record(Some(value), "Agent session snapshot")?;
    assert_agent_session_metadata(snapshot.get("session"))?;
    assert_agent_display(snapshot.get("display").unwrap_or(&Value::Null))?;
    let optional_list = |key: &str, label: &str| -> Contract<Vec<Value>> {
        match snapshot.get(key) {
            None | Some(Value::Null) => Ok(Vec::new()),
            some => assert_array(some, label).cloned(),
        }
    };
    for provider in optional_list("providers", "Agent session providers")? {
        assert_agent_inference_provider(&provider)?;
    }
    for model in optional_list("models", "Agent session models")? {
        assert_agent_model(&model)?;
    }
    for event in assert_array(snapshot.get("events"), "Agent session events")? {
        assert_agent_event_envelope(event)?;
    }
    if !snapshot
        .get("firstAvailableSequence")
        .and_then(js::safe_integer)
        .is_some_and(|n| n >= 0)
    {
        return Err(contract_error(
            "firstAvailableSequence",
            "must be a non-negative integer",
        ));
    }
    if !snapshot
        .get("lastSequence")
        .and_then(js::safe_integer)
        .is_some_and(|n| n >= 0)
    {
        return Err(contract_error(
            "lastSequence",
            "must be a non-negative integer",
        ));
    }
    assert_agent_session_cursor(snapshot.get("cursor"), "Agent session snapshot.cursor")?;
    assert_agent_session_control_view(
        snapshot.get("control").unwrap_or(&Value::Null),
        "Agent session snapshot.control",
    )?;
    if snapshot.contains_key("timeline") {
        let timeline = assert_record(snapshot.get("timeline"), "Agent session snapshot.timeline")?;
        for event in assert_array(
            timeline.get("events"),
            "Agent session snapshot.timeline.events",
        )? {
            assert_agent_event_envelope(event)?;
        }
        if timeline.contains_key("checkpointEvents") {
            for event in assert_array(
                timeline.get("checkpointEvents"),
                "Agent session snapshot.timeline.checkpointEvents",
            )? {
                assert_agent_event_envelope(event)?;
            }
        }
        non_negative_integer(
            timeline.get("firstAvailableSequence"),
            "Agent session snapshot.timeline.firstAvailableSequence",
        )?;
        non_negative_integer(
            timeline.get("lastSequence"),
            "Agent session snapshot.timeline.lastSequence",
        )?;
    }
    let cursor = &value["cursor"];
    let control = &value["control"];
    if cursor.get("streamId") != control.get("streamId")
        || cursor.get("revision") != control.get("revision")
    {
        return Err(contract_error(
            "Agent session snapshot.cursor",
            "must match the control state version",
        ));
    }
    Ok(())
}

fn assert_agent_session_cursor(value: Option<&Value>, label: &str) -> Contract<()> {
    let cursor = assert_record(value, label)?;
    required_opaque_id(cursor.get("streamId"), &format!("{label}.streamId"))?;
    non_negative_integer(cursor.get("revision"), &format!("{label}.revision"))?;
    Ok(())
}

/// `assertAgentSessionControl(value, label)`: Main's full control record.
pub fn assert_agent_session_control(value: &Value, label: &str) -> Contract<()> {
    validate_session_control(value, label, false)
}

/// `assertAgentSessionControlView(value, label)`: the Renderer's view, which
/// carries no input bodies.
pub fn assert_agent_session_control_view(value: &Value, label: &str) -> Contract<()> {
    validate_session_control(value, label, true)?;
    if js::json_byte_length(value) > 1024 * 1024 {
        return Err(contract_error(
            label,
            "exceeds the control transport budget",
        ));
    }
    Ok(())
}

fn validate_session_control(value: &Value, label: &str, view: bool) -> Contract<()> {
    let at = |path: &str| format!("{label}.{path}");
    let control = assert_record(Some(value), label)?;
    if control.get("schemaVersion") != Some(&Value::from(1)) {
        return Err(contract_error(&at("schemaVersion"), "must equal 1"));
    }
    required_opaque_id(control.get("streamId"), &at("streamId"))?;
    required_opaque_id(control.get("sessionEpoch"), &at("sessionEpoch"))?;
    non_negative_integer(control.get("revision"), &at("revision"))?;
    non_negative_integer(control.get("adapterGeneration"), &at("adapterGeneration"))?;
    non_negative_integer(control.get("runGeneration"), &at("runGeneration"))?;
    let connection = assert_record(control.get("connection"), &at("connection"))?;
    let status = enum_value(
        connection.get("status"),
        &at("connection.status"),
        &[
            "connecting",
            "connected",
            "recovering",
            "disconnected",
            "exited",
        ],
    )?;
    if !js::nullish(connection.get("reason")) {
        optional_string(
            connection.get("reason"),
            &at("connection.reason"),
            MAX_CONTROL_REASON_LENGTH,
        )?;
    }
    if !js::nullish(connection.get("recoveryState")) {
        enum_value(
            connection.get("recoveryState"),
            &at("connection.recoveryState"),
            &["reconnecting", "fallback"],
        )?;
    }
    if !js::nullish(connection.get("attempt")) {
        positive_integer(connection.get("attempt"), &at("connection.attempt"))?;
    }
    if !js::nullish(connection.get("maxAttempts")) {
        positive_integer(connection.get("maxAttempts"), &at("connection.maxAttempts"))?;
    }
    if status != "recovering"
        && ["recoveryState", "attempt", "maxAttempts"]
            .iter()
            .any(|key| !js::nullish(connection.get(*key)))
    {
        return Err(contract_error(
            &at("connection"),
            "must not retain recovery details outside recovery",
        ));
    }
    let recoveries = match control.get("recoveries") {
        None | Some(Value::Null) => &Vec::new(),
        some => assert_array(some, &at("recoveries"))?,
    };
    if recoveries.len() > 64 {
        return Err(contract_error(
            &at("recoveries"),
            "exceeds the recovery budget",
        ));
    }
    let mut recovery_ids = HashSet::new();
    for entry in recoveries {
        let recovery = assert_record(Some(entry), "recovery")?;
        let id = required_opaque_id(recovery.get("id"), "recovery.id")?;
        if !recovery_ids.insert(id) {
            return Err(contract_error("recovery.id", "must be unique"));
        }
        enum_value(
            recovery.get("scope"),
            "recovery.scope",
            &["transport", "upstream-request"],
        )?;
        enum_value(
            recovery.get("state"),
            "recovery.state",
            &["reconnecting", "fallback"],
        )?;
        optional_nullable_opaque_id(recovery.get("turnId"), "recovery.turnId")?;
        optional_nullable_opaque_id(recovery.get("requestId"), "recovery.requestId")?;
        non_negative_integer(
            recovery.get("adapterGeneration"),
            "recovery.adapterGeneration",
        )?;
        non_negative_integer(recovery.get("runGeneration"), "recovery.runGeneration")?;
        optional_string(
            recovery.get("message"),
            "recovery.message",
            MAX_CONTROL_REASON_LENGTH,
        )?;
        if recovery.get("attempt") != Some(&Value::Null) {
            positive_integer(recovery.get("attempt"), "recovery.attempt")?;
        }
        if recovery.get("maxAttempts") != Some(&Value::Null) {
            positive_integer(recovery.get("maxAttempts"), "recovery.maxAttempts")?;
        }
    }
    let execution = assert_record(control.get("execution"), &at("execution"))?;
    enum_value(
        execution.get("status"),
        &at("execution.status"),
        &["idle", "starting", "active", "ended", "outcome-unknown"],
    )?;
    optional_nullable_opaque_id(execution.get("activeTurnId"), &at("execution.activeTurnId"))?;
    optional_nullable_opaque_id(
        execution.get("uncertainTurnId"),
        &at("execution.uncertainTurnId"),
    )?;
    if !js::nullish(execution.get("startedAtMs")) {
        non_negative_integer(execution.get("startedAtMs"), &at("execution.startedAtMs"))?;
    }
    if !js::nullish(execution.get("nativeOutcome")) {
        enum_value(
            execution.get("nativeOutcome"),
            &at("execution.nativeOutcome"),
            &["completed", "failed", "interrupted"],
        )?;
    }
    enum_value(
        execution.get("certainty"),
        &at("execution.certainty"),
        &["confirmed", "unknown"],
    )?;
    let commands = assert_array(control.get("commands"), &at("commands"))?;
    let mut command_ids = HashSet::new();
    for (index, entry) in commands.iter().enumerate() {
        let at = |path: &str| format!("{label}.commands[{index}].{path}");
        let command = assert_record(Some(entry), &format!("{label}.commands[{index}]"))?;
        let command_id = required_opaque_id(command.get("commandId"), &at("commandId"))?;
        if !command_ids.insert(command_id) {
            return Err(contract_error(
                &format!("{label}.commands"),
                "must not contain duplicate command ids",
            ));
        }
        for key in ["requestId", "operationId", "targetTurnId", "userMessageId"] {
            optional_nullable_opaque_id(command.get(key), &at(key))?;
        }
        let kind = enum_value(
            command.get("kind"),
            &at("kind"),
            &["start", "steer", "interrupt", "approval", "question"],
        )?;
        let status = enum_value(
            command.get("status"),
            &at("status"),
            &[
                "queued",
                "dispatching",
                "accepted",
                "rejected",
                "cancelled",
                "outcome-unknown",
            ],
        )?;
        if !js::nullish(command.get("error")) {
            optional_string(command.get("error"), &at("error"), MAX_COMMAND_ERROR_LENGTH)?;
        }
        required_string(
            command.get("intentFingerprint"),
            &at("intentFingerprint"),
            MAX_COMMAND_FINGERPRINT_LENGTH,
        )?;
        if !command.get("wasQueued").is_some_and(Value::is_boolean) {
            return Err(contract_error(&at("wasQueued"), "must be a boolean"));
        }
        if view && command.contains_key("intent") {
            return Err(contract_error(
                label,
                "must not expose command input bodies",
            ));
        }
        if !view
            && kind == "start"
            && (matches!(status, "queued" | "dispatching") || command.contains_key("intent"))
        {
            assert_control_command_intent(command.get("intent"), &at("intent"))?;
        } else if kind != "start" && !js::nullish(command.get("intent")) {
            return Err(contract_error(
                &at("intent"),
                "is only valid for start commands",
            ));
        }
    }
    let queue = assert_array(control.get("queue"), &at("queue"))?
        .iter()
        .enumerate()
        .map(|(index, entry)| required_opaque_id(Some(entry), &format!("{label}.queue[{index}]")))
        .collect::<Contract<Vec<_>>>()?;
    if queue.iter().collect::<HashSet<_>>().len() != queue.len() {
        return Err(contract_error(
            &at("queue"),
            "must not contain duplicate command ids",
        ));
    }
    for command_id in &queue {
        if !commands.iter().any(|command| {
            command.get("commandId").and_then(Value::as_str) == Some(command_id)
                && command.get("status") == Some(&Value::from("queued"))
        }) {
            return Err(contract_error(
                &at("queue"),
                "must reference queued command records",
            ));
        }
    }
    let interaction = assert_record(control.get("interaction"), &at("interaction"))?;
    for (index, entry) in assert_array(interaction.get("approvals"), &at("interaction.approvals"))?
        .iter()
        .enumerate()
    {
        assert_control_blocker(
            entry,
            &format!("{label}.interaction.approvals[{index}]"),
            false,
            view,
        )?;
    }
    for (index, entry) in assert_array(interaction.get("questions"), &at("interaction.questions"))?
        .iter()
        .enumerate()
    {
        assert_control_blocker(
            entry,
            &format!("{label}.interaction.questions[{index}]"),
            true,
            view,
        )?;
    }
    for (index, entry) in assert_array(control.get("terminalTurns"), &at("terminalTurns"))?
        .iter()
        .enumerate()
    {
        required_opaque_id(Some(entry), &format!("{label}.terminalTurns[{index}]"))?;
    }
    if !js::nullish(control.get("pendingSubmission")) {
        let submission = assert_record(control.get("pendingSubmission"), &at("pendingSubmission"))?;
        required_opaque_id(
            submission.get("commandId"),
            &at("pendingSubmission.commandId"),
        )?;
        required_opaque_id(
            submission.get("operationId"),
            &at("pendingSubmission.operationId"),
        )?;
        non_negative_integer(
            submission.get("adapterGeneration"),
            &at("pendingSubmission.adapterGeneration"),
        )?;
        if view {
            if ["prompt", "promptMentions", "referenceDisplays"]
                .iter()
                .any(|key| submission.contains_key(*key))
            {
                return Err(contract_error(
                    label,
                    "must not expose pending input bodies",
                ));
            }
        } else {
            required_string_with(
                submission.get("prompt"),
                &at("pendingSubmission.prompt"),
                MAX_MESSAGE_LENGTH,
                StringRule::VERBATIM,
            )?;
            assert_array(
                submission.get("promptMentions"),
                &at("pendingSubmission.promptMentions"),
            )?;
            assert_array(
                submission.get("referenceDisplays"),
                &at("pendingSubmission.referenceDisplays"),
            )?;
        }
    }
    Ok(())
}

fn assert_control_command_intent(value: Option<&Value>, label: &str) -> Contract<()> {
    let intent = assert_record(value, label)?;
    let prompt = required_string_with(
        intent.get("prompt"),
        &format!("{label}.prompt"),
        MAX_MESSAGE_LENGTH,
        StringRule::VERBATIM,
    )?;
    let list = |key: &str| -> Contract<Vec<Value>> {
        match intent.get(key) {
            None | Some(Value::Null) => Ok(Vec::new()),
            some => assert_array(some, &format!("{label}.{key}")).cloned(),
        }
    };
    assert_control_prompt_mentions(
        &list("promptMentions")?,
        &prompt,
        &format!("{label}.promptMentions"),
    )?;
    assert_control_reference_displays(
        &list("referenceDisplays")?,
        &format!("{label}.referenceDisplays"),
    )?;
    for (key, limit) in [("model", 512), ("effort", 160), ("mode", 160)] {
        if !js::nullish(intent.get(key)) {
            optional_string(intent.get(key), &format!("{label}.{key}"), limit)?;
        }
    }
    Ok(())
}

fn assert_control_prompt_mentions(mentions: &[Value], prompt: &str, label: &str) -> Contract<()> {
    if mentions.len() > MAX_REFERENCE_COUNT {
        return Err(contract_error(
            label,
            &format!("may contain at most {MAX_REFERENCE_COUNT} entries"),
        ));
    }
    let length = text::len16(prompt) as i64;
    for (index, entry) in mentions.iter().enumerate() {
        let at = format!("{label}[{index}]");
        let mention = assert_record(Some(entry), &at)?;
        required_opaque_id(mention.get("referenceId"), &format!("{at}.referenceId"))?;
        let start = non_negative_integer(mention.get("start"), &format!("{at}.start"))?;
        let end = non_negative_integer(mention.get("end"), &format!("{at}.end"))?;
        if end <= start || end > length {
            return Err(contract_error(
                &at,
                "must identify a non-empty prompt range",
            ));
        }
    }
    Ok(())
}

fn assert_control_reference_displays(displays: &[Value], label: &str) -> Contract<()> {
    if displays.len() > MAX_REFERENCE_COUNT {
        return Err(contract_error(
            label,
            &format!("may contain at most {MAX_REFERENCE_COUNT} entries"),
        ));
    }
    for (index, entry) in displays.iter().enumerate() {
        let at = |key: &str| format!("{label}[{index}].{key}");
        let display = assert_record(Some(entry), &format!("{label}[{index}]"))?;
        required_opaque_id(display.get("id"), &at("id"))?;
        enum_value(
            display.get("kind"),
            &at("kind"),
            &["workspace-file", "workspace-directory", "attachment"],
        )?;
        required_string(display.get("displayName"), &at("displayName"), 512)?;
        if display.contains_key("relativePath") {
            required_string(
                display.get("relativePath"),
                &at("relativePath"),
                MAX_PATH_LENGTH,
            )?;
        }
        if display.contains_key("mime") {
            required_string(display.get("mime"), &at("mime"), 160)?;
        }
        if display.contains_key("size") {
            non_negative_integer(display.get("size"), &at("size"))?;
        }
    }
    Ok(())
}

fn assert_control_blocker(value: &Value, label: &str, question: bool, view: bool) -> Contract<()> {
    let blocker = assert_record(Some(value), label)?;
    required_opaque_id(blocker.get("requestId"), &format!("{label}.requestId"))?;
    optional_nullable_opaque_id(blocker.get("turnId"), &format!("{label}.turnId"))?;
    optional_nullable_opaque_id(blocker.get("itemId"), &format!("{label}.itemId"))?;
    assert_runtime_id(blocker.get("runtimeId"), &format!("{label}.runtimeId"))?;
    if view && (blocker.contains_key("event") || blocker.contains_key("questions")) {
        return Err(contract_error(
            label,
            "must not expose native blocker bodies",
        ));
    }
    if question && !view {
        assert_array(blocker.get("questions"), &format!("{label}.questions"))?;
    }
    if let Some(event) = blocker.get("event") {
        assert_agent_event_envelope(event)?;
    }
    Ok(())
}

/// `assertAgentSessionFrame(value)`.
pub fn assert_agent_session_frame(value: &Value) -> Contract<()> {
    let frame = assert_record(Some(value), "Agent session frame")?;
    let frame_type = frame.get("type").and_then(Value::as_str);
    if frame_type == Some("delta") {
        assert_agent_display_patch(frame.get("displayPatch").unwrap_or(&Value::Null))?;
    }
    required_opaque_id(
        frame.get("subscriptionId"),
        "Agent session frame.subscriptionId",
    )?;
    required_opaque_id(frame.get("streamId"), "Agent session frame.streamId")?;
    let revision = non_negative_integer(frame.get("revision"), "Agent session frame.revision")?;
    if frame_type == Some("resync-required") {
        return Ok(());
    }
    if frame_type != Some("delta") {
        return Err(contract_error(
            "Agent session frame.type",
            "is not supported",
        ));
    }
    let base_revision = non_negative_integer(
        frame.get("baseRevision"),
        "Agent session frame.baseRevision",
    )?;
    if revision <= base_revision {
        return Err(contract_error(
            "Agent session frame.revision",
            "must advance baseRevision",
        ));
    }
    let control = frame.get("control").unwrap_or(&Value::Null);
    assert_agent_session_control_view(control, "Agent session frame.control")?;
    if control.get("streamId") != frame.get("streamId")
        || control.get("revision").and_then(js::safe_integer) != Some(revision)
    {
        return Err(contract_error(
            "Agent session frame.control",
            "must match the frame version",
        ));
    }
    assert_agent_session_metadata(frame.get("session"))
}

fn assert_agent_session_metadata(value: Option<&Value>) -> Contract<()> {
    let session = assert_record(value, "Agent session")?;
    required_opaque_id(session.get("id"), "Agent session.id")?;
    if !js::nullish(session.get("instanceId")) {
        required_opaque_id(session.get("instanceId"), "Agent session.instanceId")?;
    }
    let runtime = match session.get("runtimeId") {
        None | Some(Value::Null) => session.get("provider"),
        some => some,
    };
    assert_runtime_id(runtime, "Agent session.runtimeId")?;
    required_string(
        session.get("workspaceRoot"),
        "Agent session.workspaceRoot",
        MAX_PATH_LENGTH,
    )?;
    required_string(session.get("title"), "Agent session.title", 512)?;
    Ok(())
}

fn sanitize_agent_sessions_list_response(value: &Value) -> Contract<Value> {
    let response = assert_record(Some(value), "session list")?;
    let discovery = assert_record(response.get("discovery"), "session list.discovery")?;
    let mut out = Obj::new();
    if let Some(coverage) = response.get("catalogCoverage").filter(|c| js::truthy(c)) {
        out.insert(
            "catalogCoverage",
            Obj::new()
                .set(
                    "truncated",
                    optional_boolean(js::get(coverage, "truncated"), "catalog.truncated")?
                        == Some(true),
                )
                .set(
                    "capacity",
                    non_negative_integer(js::get(coverage, "capacity"), "catalog.capacity")?,
                )
                .set(
                    "retained",
                    non_negative_integer(js::get(coverage, "retained"), "catalog.retained")?,
                )
                .build(),
        );
    }
    if response.contains_key("excludedSessionIds") {
        let ids = assert_array(
            response.get("excludedSessionIds"),
            "session list.excludedSessionIds",
        )?;
        out.insert(
            "excludedSessionIds",
            ids.iter()
                .take(500)
                .map(|id| required_opaque_id(Some(id), "excluded session id"))
                .collect::<Contract<Vec<_>>>()?,
        );
    }
    if response.contains_key("catalogNextCursor") {
        out.insert(
            "catalogNextCursor",
            history_cursor(response.get("catalogNextCursor"))?,
        );
    }
    if response.contains_key("sessionListKind") {
        out.insert(
            "sessionListKind",
            enum_value(
                response.get("sessionListKind"),
                "sessionListKind",
                &["page"],
            )?,
        );
    }
    let sessions = assert_array(response.get("sessions"), "session list.sessions")?
        .iter()
        .take(1000)
        .enumerate()
        .map(|(index, session)| {
            sanitize_agent_session_list_item(session, &format!("session list.sessions[{index}]"))
        })
        .collect::<Contract<Vec<_>>>()?;
    let mut discovery_out = Obj::new()
        .set(
            "runtimeId",
            optional_runtime_id(discovery.get("runtimeId"))?.map_or(Value::Null, Value::from),
        )
        .set(
            "status",
            enum_value(
                discovery.get("status"),
                "session list.discovery.status",
                &[
                    "not-requested",
                    "unsupported",
                    "partial",
                    "complete",
                    "failed",
                ],
            )?,
        )
        .set("nextCursor", history_cursor(discovery.get("nextCursor"))?)
        .set(
            "scanId",
            match optional_nullable_opaque_id(
                discovery.get("scanId"),
                "session list.discovery.scanId",
            )? {
                None => Value::Null,
                Some(id) => id,
            },
        );
    if !js::nullish(discovery.get("catalogCommit")) {
        discovery_out.insert(
            "catalogCommit",
            enum_value(
                discovery.get("catalogCommit"),
                "history.catalogCommit",
                &["pending"],
            )?,
        );
    }
    if !js::nullish(discovery.get("retryable")) {
        discovery_out.insert(
            "retryable",
            optional_boolean(discovery.get("retryable"), "history.retryable")?,
        );
    }
    if !js::nullish(discovery.get("sourceScopeId")) {
        discovery_out.insert(
            "sourceScopeId",
            require_history_native_id(discovery.get("sourceScopeId"))?,
        );
    }
    if !js::nullish(discovery.get("coverage")) {
        discovery_out.insert(
            "coverage",
            enum_value(
                discovery.get("coverage"),
                "history.coverage",
                &["complete", "unknown"],
            )?,
        );
    }
    let discovery_out = discovery_out
        .set(
            "indexed",
            non_negative_integer(discovery.get("indexed"), "session list.discovery.indexed")?,
        )
        .set(
            "warnings",
            safe_warnings(discovery.get("warnings"), "session list.discovery.warnings")?,
        );
    Ok(out
        .set("sessions", sessions)
        .set("discovery", discovery_out.build())
        .set(
            "warnings",
            safe_warnings(response.get("warnings"), "session list.warnings")?,
        )
        .build())
}

fn sanitize_agent_session_open_result(value: &Value) -> Contract<Value> {
    let result = assert_record(Some(value), "Agent session open result")?;
    let status = enum_value(
        result.get("status"),
        "Agent session open result.status",
        &["opened", "failed"],
    )?;
    if status == "opened" {
        let snapshot = result.get("snapshot").unwrap_or(&Value::Null);
        assert_agent_session_snapshot(snapshot)?;
        return Ok(Obj::new()
            .set("status", status)
            .set("snapshot", snapshot.clone())
            .build());
    }
    let error = assert_record(result.get("error"), "Agent session open result.error")?;
    Ok(Obj::new()
        .set("status", status)
        .set(
            "error",
            Obj::new()
                .set(
                    "code",
                    enum_value(
                        error.get("code"),
                        "Agent session open result.error.code",
                        AGENT_SESSION_OPEN_ERROR_CODES,
                    )?,
                )
                .set(
                    "message",
                    required_string(
                        error.get("message"),
                        "Agent session open result.error.message",
                        1_000,
                    )?,
                )
                .set(
                    "retryable",
                    optional_boolean(
                        error.get("retryable"),
                        "Agent session open result.error.retryable",
                    )? == Some(true),
                )
                .build(),
        )
        .build())
}

fn sanitize_agent_session_list_item(value: &Value, label: &str) -> Contract<Value> {
    let at = |key: &str| format!("{label}.{key}");
    let session = assert_record(Some(value), label)?;
    let runtime = match session.get("runtimeId") {
        None | Some(Value::Null) => session.get("provider"),
        some => some,
    };
    let runtime_id = assert_runtime_id(runtime, &at("runtimeId"))?;
    let provider = match session.get("provider") {
        None | Some(Value::Null) => {
            assert_runtime_id(Some(&Value::from(runtime_id.clone())), &at("provider"))?
        }
        some => assert_runtime_id(some, &at("provider"))?,
    };
    let selected = |key: &str, limit: usize| -> Contract<Value> {
        Ok(optional_string(session.get(key), &at(key), limit)?.map_or(Value::Null, Value::from))
    };
    Ok(Obj::new()
        .set("id", required_opaque_id(session.get("id"), &at("id"))?)
        .set("runtimeId", runtime_id)
        .opt(
            "runtime",
            match session.get("runtime") {
                None | Some(Value::Null) => None,
                Some(runtime) => Some(sanitize_agent_runtime_descriptor(runtime)?),
            },
        )
        .set("provider", provider)
        .set(
            "providerSessionId",
            match session.get("providerSessionId") {
                None | Some(Value::Null) => Value::Null,
                some => Value::from(require_history_native_id(some)?),
            },
        )
        .set(
            "workspaceRoot",
            required_string(
                session.get("workspaceRoot"),
                &at("workspaceRoot"),
                MAX_PATH_LENGTH,
            )?,
        )
        .set(
            "title",
            required_string(session.get("title"), &at("title"), 512)?,
        )
        .set(
            "createdAt",
            iso_timestamp(session.get("createdAt"), &at("createdAt"))?,
        )
        .set(
            "updatedAt",
            iso_timestamp(session.get("updatedAt"), &at("updatedAt"))?,
        )
        .opt(
            "updatedAtKnown",
            optional_boolean(session.get("updatedAtKnown"), &at("updatedAtKnown"))?,
        )
        .set(
            "terminalState",
            enum_value(
                session.get("terminalState"),
                &at("terminalState"),
                &[
                    "idle",
                    "running",
                    "completed",
                    "failed",
                    "interrupted",
                    "provider-exited",
                    "outcome-unknown",
                ],
            )?,
        )
        .set("selectedModel", selected("selectedModel", 512)?)
        .set("selectedEffort", selected("selectedEffort", 160)?)
        .set("selectedMode", selected("selectedMode", 160)?)
        .set(
            "lastSequence",
            non_negative_integer(session.get("lastSequence"), &at("lastSequence"))?,
        )
        .opt(
            "archivedAt",
            match session.get("archivedAt") {
                None | Some(Value::Null) => None,
                some => Some(iso_timestamp(some, &at("archivedAt"))?),
            },
        )
        .opt(
            "partial",
            optional_boolean(session.get("partial"), &at("partial"))?,
        )
        .opt(
            "origin",
            match session.get("origin") {
                None | Some(Value::Null) => None,
                some => Some(enum_value(
                    some,
                    &at("origin"),
                    &["puppyone", "native-discovery"],
                )?),
            },
        )
        .build())
}

fn safe_warnings(value: Option<&Value>, label: &str) -> Contract<Vec<String>> {
    assert_array(value, label)?
        .iter()
        .take(50)
        .enumerate()
        .map(|(index, entry)| required_string(Some(entry), &format!("{label}[{index}]"), 4_000))
        .collect()
}

fn iso_timestamp(value: Option<&Value>, label: &str) -> Contract<String> {
    let input = required_string(value, label, 64)?;
    clock::date_parse(&input)
        .map(clock::iso_string)
        .ok_or_else(|| contract_error(label, "must be an ISO timestamp"))
}

fn optional_references(value: Option<&Value>, label: &str) -> Contract<Option<Vec<Value>>> {
    if js::nullish(value) {
        return Ok(None);
    }
    let references = assert_array(value, label)?;
    if references.len() > MAX_REFERENCE_COUNT {
        return Err(contract_error(
            label,
            &format!("may contain at most {MAX_REFERENCE_COUNT} entries"),
        ));
    }
    references
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let at = format!("{label}[{index}]");
            let reference = assert_record(Some(entry), &at)?;
            Ok(Obj::new()
                .set(
                    "path",
                    required_string(
                        reference.get("path"),
                        &format!("{at}.path"),
                        MAX_PATH_LENGTH,
                    )?,
                )
                .opt(
                    "name",
                    optional_string(reference.get("name"), &format!("{at}.name"), 512)?,
                )
                .build())
        })
        .collect::<Contract<Vec<_>>>()
        .map(Some)
}

fn command_preconditions(input: &Record) -> Contract<Value> {
    let integer = |key: &str| -> Contract<Option<i64>> {
        match input.get(key) {
            None | Some(Value::Null) => Ok(None),
            some => non_negative_integer(some, key).map(Some),
        }
    };
    Ok(Obj::new()
        .opt(
            "expectedSessionEpoch",
            compact_opaque_id(input.get("expectedSessionEpoch"), "expectedSessionEpoch")?,
        )
        .opt(
            "expectedAdapterGeneration",
            integer("expectedAdapterGeneration")?,
        )
        .opt("expectedRunGeneration", integer("expectedRunGeneration")?)
        .build())
}

fn optional_draft_references(value: Option<&Value>, label: &str) -> Contract<Option<Vec<Value>>> {
    if js::nullish(value) {
        return Ok(None);
    }
    let references = assert_array(value, label)?;
    if references.len() > MAX_REFERENCE_COUNT {
        return Err(contract_error(
            label,
            &format!("may contain at most {MAX_REFERENCE_COUNT} entries"),
        ));
    }
    references
        .iter()
        .enumerate()
        .map(|(index, entry)| sanitize_draft_reference(entry, &format!("{label}[{index}]"), true))
        .collect::<Contract<Vec<_>>>()
        .map(Some)
}

fn optional_prompt_mentions(value: Option<&Value>, label: &str) -> Contract<Option<Vec<Value>>> {
    if js::nullish(value) {
        return Ok(None);
    }
    let mentions = assert_array(value, label)?;
    if mentions.len() > MAX_REFERENCE_COUNT {
        return Err(contract_error(
            label,
            &format!("may contain at most {MAX_REFERENCE_COUNT} entries"),
        ));
    }
    mentions
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let at = format!("{label}[{index}]");
            let mention = assert_record(Some(entry), &at)?;
            Ok(Obj::new()
                .set(
                    "referenceId",
                    required_opaque_id(mention.get("referenceId"), &format!("{at}.referenceId"))?,
                )
                .set(
                    "start",
                    non_negative_integer(mention.get("start"), &format!("{at}.start"))?,
                )
                .set(
                    "end",
                    non_negative_integer(mention.get("end"), &format!("{at}.end"))?,
                )
                .build())
        })
        .collect::<Contract<Vec<_>>>()
        .map(Some)
}

/// `sanitizeDraftReference(value, label, requireReady)`.
pub fn sanitize_draft_reference(
    value: &Value,
    label: &str,
    require_ready: bool,
) -> Contract<Value> {
    let at = |key: &str| format!("{label}.{key}");
    let reference = assert_record(Some(value), label)?;
    let kind = enum_value(
        reference.get("kind"),
        &at("kind"),
        &["workspace-entry", "staged-attachment"],
    )?;
    let status = enum_value(
        reference.get("status"),
        &at("status"),
        &["resolving", "ready", "error"],
    )?;
    if require_ready && status != "ready" {
        return Err(contract_error(
            &at("status"),
            "must be ready before submission",
        ));
    }
    let base = Obj::new()
        .set("id", required_opaque_id(reference.get("id"), &at("id"))?)
        .set("kind", kind)
        .set(
            "displayName",
            required_string(reference.get("displayName"), &at("displayName"), 512)?,
        )
        .set("status", status);
    if kind == "workspace-entry" {
        let Some(relative_path) =
            normalize_agent_workspace_relative_path(reference.get("relativePath"))
        else {
            return Err(contract_error(
                &at("relativePath"),
                "must remain workspace-relative",
            ));
        };
        let resource_uri = match reference.get("resourceUri") {
            None => None,
            some => Some(required_string(some, &at("resourceUri"), 16_384)?),
        };
        let resource = resource_uri
            .as_deref()
            .filter(|uri| !uri.is_empty())
            .map(parse_workspace_resource_reference)
            .transpose()?;
        if resource
            .as_ref()
            .is_some_and(|r| r.relative_path != relative_path)
        {
            return Err(contract_error(
                &at("resourceUri"),
                "must match the relative path",
            ));
        }
        let mut out = base
            .set(
                "entryType",
                enum_value(
                    reference.get("entryType"),
                    &at("entryType"),
                    &["file", "directory"],
                )?,
            )
            .set("relativePath", relative_path);
        if let Some(resource) = resource {
            out = out
                .set("resourceUri", resource_uri.unwrap_or_default())
                .set("workspaceFolderId", resource.folder_id);
        }
        return Ok(out
            .opt(
                "workspaceName",
                match reference.get("workspaceName") {
                    None => None,
                    some => Some(required_string(some, &at("workspaceName"), 512)?),
                },
            )
            .opt(
                "mime",
                match reference.get("mime") {
                    None => None,
                    some => Some(required_string(some, &at("mime"), 160)?),
                },
            )
            .opt(
                "size",
                match reference.get("size") {
                    None => None,
                    some => Some(non_negative_integer(some, &at("size"))?),
                },
            )
            .build());
    }
    Ok(base
        .set(
            "token",
            required_opaque_id(reference.get("token"), &at("token"))?,
        )
        .set(
            "mime",
            required_string(reference.get("mime"), &at("mime"), 160)?,
        )
        .set(
            "size",
            non_negative_integer(reference.get("size"), &at("size"))?,
        )
        .build())
}

fn attachment_stage_sources(input: &Record) -> Contract<Value> {
    let Some(sources) = input.get("sources") else {
        return Ok(Obj::new()
            .set(
                "sourcePaths",
                bounded_string_array(
                    input.get("sourcePaths"),
                    "sourcePaths",
                    MAX_REFERENCE_COUNT,
                    MAX_PATH_LENGTH,
                )?,
            )
            .build());
    };
    if input.contains_key("sourcePaths") {
        return Err(contract_error(
            "sources",
            "cannot be combined with sourcePaths",
        ));
    }
    let sources = assert_array(Some(sources), "sources")?;
    if sources.is_empty() || sources.len() > MAX_REFERENCE_COUNT {
        return Err(contract_error("sources", "has an invalid count"));
    }
    let mut byte_length = 0;
    let parsed = sources
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let at = format!("sources[{index}]");
            let source = assert_record(Some(value), &at)?;
            if source.contains_key("path") {
                if source.contains_key("bytes") {
                    return Err(contract_error(&at, "cannot contain both a path and bytes"));
                }
                return Ok(Obj::new()
                    .set(
                        "path",
                        required_string(
                            source.get("path"),
                            &format!("{at}.path"),
                            MAX_PATH_LENGTH,
                        )?,
                    )
                    .build());
            }
            let name = required_string(source.get("name"), &format!("{at}.name"), 512)?;
            if name
                .chars()
                .any(|c| c == '\\' || c == '/' || c <= '\u{1f}' || c == '\u{7f}')
            {
                return Err(contract_error(&at, "has an invalid file name"));
            }
            let Some(bytes) = source
                .get("bytes")
                .and_then(js::as_uint8array)
                .filter(|b| !b.is_empty())
            else {
                return Err(contract_error(&at, "requires non-empty bytes"));
            };
            byte_length += bytes.len();
            if byte_length > limits::MAX_TOTAL_REFERENCE_BYTES {
                return Err(contract_error(&at, "exceeds the 25 MB inline byte limit"));
            }
            Ok(Obj::new()
                .set("name", name)
                .set("bytes", source["bytes"].clone())
                .build())
        })
        .collect::<Contract<Vec<_>>>()?;
    Ok(Obj::new().set("sources", parsed).build())
}

fn bounded_string_array(
    value: Option<&Value>,
    label: &str,
    maximum_entries: usize,
    maximum_length: usize,
) -> Contract<Vec<String>> {
    let entries = assert_array(value, label)?;
    if entries.is_empty() || entries.len() > maximum_entries {
        return Err(contract_error(
            label,
            &format!("must contain 1-{maximum_entries} entries"),
        ));
    }
    entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            required_string(Some(entry), &format!("{label}[{index}]"), maximum_length)
        })
        .collect()
}

fn bounded_opaque_id_array(
    value: Option<&Value>,
    label: &str,
    maximum_entries: usize,
) -> Contract<Vec<String>> {
    let entries = assert_array(value, label)?;
    if entries.len() > maximum_entries {
        return Err(contract_error(
            label,
            &format!("may contain at most {maximum_entries} entries"),
        ));
    }
    entries
        .iter()
        .enumerate()
        .map(|(index, entry)| required_opaque_id(Some(entry), &format!("{label}[{index}]")))
        .collect()
}

fn optional_question_answer(value: Option<&Value>, label: &str) -> Contract<Option<Value>> {
    match value {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(Value::Null)),
        Some(Value::String(_)) => Ok(Some(bounded_answer(value, label)?.into())),
        Some(Value::Array(entries)) => {
            if entries.len() > 100 {
                return Err(contract_error(label, "contains too many entries"));
            }
            entries
                .iter()
                .enumerate()
                .map(|(index, entry)| match entry {
                    Value::Array(items) => items
                        .iter()
                        .take(100)
                        .enumerate()
                        .map(|(item_index, item)| {
                            bounded_answer(Some(item), &format!("{label}[{index}][{item_index}]"))
                                .map(Value::from)
                        })
                        .collect::<Contract<Vec<_>>>()
                        .map(Value::Array),
                    _ => bounded_answer(Some(entry), &format!("{label}[{index}]")).map(Value::from),
                })
                .collect::<Contract<Vec<_>>>()
                .map(|answers| Some(Value::Array(answers)))
        }
        Some(_) => Err(contract_error(label, "must be text, an array, or null")),
    }
}

fn optional_answer_matrix(value: Option<&Value>, label: &str) -> Contract<Option<Value>> {
    match value {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(Value::Null)),
        Some(Value::Array(rows)) if rows.len() <= 100 => rows
            .iter()
            .enumerate()
            .map(|(row_index, row)| {
                let Some(row) = row.as_array().filter(|r| r.len() <= 100) else {
                    return Err(contract_error(
                        &format!("{label}[{row_index}]"),
                        "must be a bounded array",
                    ));
                };
                row.iter()
                    .enumerate()
                    .map(|(entry_index, entry)| {
                        bounded_answer(Some(entry), &format!("{label}[{row_index}][{entry_index}]"))
                            .map(Value::from)
                    })
                    .collect::<Contract<Vec<_>>>()
                    .map(Value::Array)
            })
            .collect::<Contract<Vec<_>>>()
            .map(|rows| Some(Value::Array(rows))),
        Some(_) => Err(contract_error(label, "must be a bounded array")),
    }
}

fn bounded_answer(value: Option<&Value>, label: &str) -> Contract<String> {
    required_string_with(value, label, 8_192, StringRule::VERBATIM)
}

fn require_history_native_id(value: Option<&Value>) -> Contract<String> {
    history_native_id(value).ok_or_else(|| type_error("Invalid native History session id."))
}
