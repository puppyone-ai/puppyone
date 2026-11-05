//! `shared/agent-contract/runtime-schema.mjs`: runtime inspection,
//! capabilities, descriptors and readiness as they cross to the Renderer.
use super::constants::{AGENT_RUNTIME_CAPABILITIES, agent_readiness_codes, readiness_code_status};
use super::js::{self, Obj};
use super::validation::{
    Contract, assert_array, assert_record, assert_runtime_id, enum_value, required_string,
    type_error,
};
use regex::Regex;
use serde_json::{Map, Value};
use std::sync::LazyLock;

const CAPABILITY_METHODS: &[(&str, &str)] = &[
    ("manualApprovals", "resolveApproval"),
    ("structuredQuestions", "resolveQuestion"),
    ("fork", "forkSession"),
    ("steer", "steerTurn"),
    ("compaction", "compactSession"),
];
const MAX_REFERENCE_BYTES: i64 = 25 * 1024 * 1024;

static EXTENSION_KEY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._/-]{1,120}$").expect("extension key pattern"));
static MIME_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^[a-z0-9][a-z0-9!#$&^_.+-]{0,79}/(?:\*|[a-z0-9][a-z0-9!#$&^_.+-]{0,79})$")
        .expect("mime pattern")
});
static FILE_EXTENSION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^\.[a-z0-9][a-z0-9._+-]{0,31}$").expect("extension pattern"));

static EMPTY: LazyLock<Value> = LazyLock::new(|| Value::Object(Map::new()));

/// `assertAgentInspection(value)`.
pub fn assert_agent_inspection(value: &Value) -> Contract<()> {
    let inspection = assert_record(Some(value), "Agent inspection")?;
    if let Some(runtime) = inspection.get("runtime") {
        assert_runtime_descriptor(runtime)?;
    }
    if let Some(readiness) = inspection.get("readiness").filter(|r| !r.is_null()) {
        assert_agent_runtime_readiness(readiness)?;
    }
    let list = |key: &str| -> Contract<Vec<Value>> {
        match inspection.get(key) {
            None | Some(Value::Null) => Ok(Vec::new()),
            some => assert_array(some, &format!("Agent inspection.{key}")).cloned(),
        }
    };
    for provider in list("providers")? {
        assert_agent_inference_provider(&provider)?;
    }
    for model in list("models")? {
        assert_agent_model(&model)?;
    }
    for mode in list("modes")? {
        assert_named_entry(&mode, "mode", "id")?;
    }
    for command in list("commands")? {
        assert_named_entry(&command, "command", "name")?;
    }
    normalize_capability_snapshot(inspection.get("capabilities").unwrap_or(&EMPTY));
    for warning in list("warnings")? {
        required_string(Some(&warning), "warning", 32_768)?;
    }
    Ok(())
}

/// `assertAgentRuntimeCapabilities(adapter, capabilities, runtimeId)`: a
/// runtime that advertises a capability implements its method.
pub fn assert_agent_runtime_capabilities(
    implements: impl Fn(&str) -> bool,
    capabilities: &Value,
    runtime_id: &str,
) -> Contract<Value> {
    let normalized = normalize_capability_snapshot(capabilities);
    for (capability, method) in CAPABILITY_METHODS {
        if normalized.get(capability) == Some(&Value::Bool(true)) && !implements(method) {
            return Err(type_error(format!(
                "Agent runtime {runtime_id} advertises {capability} but is missing {method}()."
            )));
        }
    }
    Ok(normalized)
}

/// `normalizeCapabilitySnapshot(value)`.
pub fn normalize_capability_snapshot(value: &Value) -> Value {
    let source = if value.is_object() { value } else { &EMPTY };
    let field = |key: &str| js::get(source, key);
    let mut out = Obj::new();
    for capability in AGENT_RUNTIME_CAPABILITIES {
        out.insert(capability, field(capability) == Some(&Value::Bool(true)));
    }
    let revision = bounded_optional_text(field("revision"), 160);
    out.opt("revision", (!revision.is_empty()).then_some(revision))
        .opt("protocol", normalize_capability_protocol(field("protocol")))
        .opt(
            "constraints",
            normalize_capability_constraints(field("constraints")),
        )
        .opt(
            "history",
            normalize_session_history_capabilities(field("history")),
        )
        .opt(
            "recovery",
            normalize_native_recovery_capabilities(field("recovery")),
        )
        .opt(
            "modelConnections",
            (field("modelConnections") == Some(&Value::Bool(true))).then_some(true),
        )
        .opt(
            "readOnly",
            (field("readOnly") == Some(&Value::Bool(true))).then_some(true),
        )
        .set(
            "referenceInputs",
            normalize_reference_input_capabilities(field("referenceInputs"), source),
        )
        .build()
}

fn record(value: Option<&Value>) -> &Value {
    value.filter(|v| v.is_object()).unwrap_or(&EMPTY)
}

fn one_of<'a>(value: Option<&'a Value>, allowed: &[&str]) -> Option<&'a str> {
    value
        .and_then(Value::as_str)
        .filter(|v| allowed.contains(v))
}

fn normalize_native_recovery_capabilities(value: Option<&Value>) -> Option<Value> {
    let value = value.filter(|v| v.is_object())?;
    let strategy = one_of(
        js::get(value, "strategy"),
        &[
            "unsupported",
            "cursor-replay",
            "snapshot-reload",
            "object-reconciliation",
        ],
    )?;
    let active = one_of(
        js::get(value, "activeExecution"),
        &["confirmed", "outcome-unknown"],
    )?;
    Some(
        Obj::new()
            .set("strategy", strategy)
            .set("activeExecution", active)
            .set(
                "atomicHandoff",
                js::get(value, "atomicHandoff") == Some(&Value::Bool(true)),
            )
            .build(),
    )
}

fn normalize_session_history_capabilities(value: Option<&Value>) -> Option<Value> {
    let value = value.filter(|v| v.is_object())?;
    Some(
        Obj::new()
            .set(
                "discovery",
                one_of(js::get(value, "discovery"), &["paged"]).unwrap_or("unsupported"),
            )
            .set(
                "exactOpen",
                one_of(js::get(value, "exactOpen"), &["supported"]).unwrap_or("unsupported"),
            )
            .set(
                "hydration",
                one_of(
                    js::get(value, "hydration"),
                    &["push-replay", "snapshot", "paged"],
                )
                .unwrap_or("unsupported"),
            )
            .build(),
    )
}

fn normalize_capability_protocol(value: Option<&Value>) -> Option<Value> {
    let value = value.filter(|v| v.is_object())?;
    let name = bounded_optional_text(js::get(value, "name"), 80);
    let version = match js::get(value, "version").and_then(js::safe_integer) {
        Some(n) if n >= 0 => Value::from(n),
        _ => Value::String(bounded_optional_text(js::get(value, "version"), 80)),
    };
    if name.is_empty() || version == "" {
        return None;
    }
    let agent_version = bounded_optional_text(js::get(value, "agentVersion"), 80);
    let mut extensions = Map::new();
    if let Some(map) = js::get(value, "extensions").and_then(Value::as_object) {
        for (key, entry) in map {
            if extensions.len() >= 64 {
                break;
            }
            if EXTENSION_KEY.is_match(key)
                && js::safe_integer(entry).is_some_and(|n| (0..=1_000_000).contains(&n))
            {
                extensions.insert(key.clone(), entry.clone());
            }
        }
    }
    Some(
        Obj::new()
            .set("name", name)
            .set("version", version)
            .opt(
                "agentVersion",
                (!agent_version.is_empty()).then_some(agent_version),
            )
            .opt(
                "extensions",
                (!extensions.is_empty()).then_some(Value::Object(extensions)),
            )
            .build(),
    )
}

fn normalize_capability_constraints(value: Option<&Value>) -> Option<Value> {
    let value = value.filter(|v| v.is_object())?;
    let switches = ["turn-boundary", "session-boundary", "unsupported"];
    let constraints = Obj::new()
        .opt(
            "modelSwitch",
            one_of(js::get(value, "modelSwitch"), &switches),
        )
        .opt(
            "modeSwitch",
            one_of(js::get(value, "modeSwitch"), &switches),
        )
        .opt(
            "forkRequiresIdle",
            js::get(value, "forkRequiresIdle").and_then(Value::as_bool),
        )
        .opt(
            "compactionRequiresIdle",
            js::get(value, "compactionRequiresIdle").and_then(Value::as_bool),
        )
        .map();
    (!constraints.is_empty()).then_some(Value::Object(constraints))
}

/// `normalizeReferenceInputCapabilities(value, legacy)`.
pub fn normalize_reference_input_capabilities(value: Option<&Value>, legacy: &Value) -> Value {
    let source = record(value);
    let field = |key: &str| js::get(source, key);
    let is_true = |v: Option<&Value>| v == Some(&Value::Bool(true));
    let legacy_context = is_true(js::get(legacy, "contextReferences"));
    let legacy_attachments = is_true(js::get(legacy, "attachments"));
    let workspace = record(field("workspace"));
    let attachments = record(field("attachments"));
    let limits = record(field("limits"));
    let legacy_mime_types = string_list(field("acceptedMimeTypes"), |e| MIME_PATTERN.is_match(e));
    let legacy_generic_accepted = reference_transport_accepted(field("genericFiles"));
    let workspace_flag = |key: &str, legacy_key: &str| {
        is_true(js::get(workspace, key))
            || (js::get(workspace, key).is_none()
                && (is_true(field(legacy_key)) || (field(legacy_key).is_none() && legacy_context)))
    };
    let limit = |key: &str, legacy_key: &str, fallback: i64| {
        let value = match js::get(limits, key) {
            None | Some(Value::Null) => field(legacy_key),
            some => some,
        };
        bounded_positive_integer(value, fallback, fallback)
    };
    let mut workspace_out = Obj::new();
    if is_true(js::get(workspace, "crossRoots")) {
        workspace_out.insert("crossRoots", true);
    }
    Obj::new()
        .set("schemaVersion", 1)
        .set(
            "workspace",
            workspace_out
                .set("files", workspace_flag("files", "workspaceFiles"))
                .set(
                    "directories",
                    workspace_flag("directories", "workspaceDirectories"),
                )
                .build(),
        )
        .set(
            "attachments",
            Obj::new()
                .set(
                    "image",
                    normalize_attachment_capability(
                        js::get(attachments, "image"),
                        reference_transport_accepted(field("images"))
                            || (field("images").is_none() && legacy_attachments),
                        Some(legacy_mime_types),
                    ),
                )
                .set(
                    "text",
                    normalize_attachment_capability(
                        js::get(attachments, "text"),
                        legacy_generic_accepted,
                        None,
                    ),
                )
                .set(
                    "audio",
                    normalize_attachment_capability(js::get(attachments, "audio"), false, None),
                )
                .set(
                    "video",
                    normalize_attachment_capability(js::get(attachments, "video"), false, None),
                )
                .set(
                    "binary",
                    normalize_attachment_capability(
                        js::get(attachments, "binary"),
                        legacy_generic_accepted,
                        None,
                    ),
                )
                .build(),
        )
        .set(
            "limits",
            Obj::new()
                .set("maxCount", limit("maxCount", "maxReferences", 32))
                .set(
                    "maxBytesPerReference",
                    limit(
                        "maxBytesPerReference",
                        "maxReferenceBytes",
                        MAX_REFERENCE_BYTES,
                    ),
                )
                .set(
                    "maxTotalBytes",
                    limit(
                        "maxTotalBytes",
                        "maxTotalReferenceBytes",
                        MAX_REFERENCE_BYTES,
                    ),
                )
                .build(),
        )
        .set("steer", is_true(field("steer")))
        .set("attachmentOnly", is_true(field("attachmentOnly")))
        .build()
}

fn normalize_attachment_capability(
    value: Option<&Value>,
    fallback_accepted: bool,
    fallback_mime_types: Option<Vec<String>>,
) -> Value {
    let source = record(value);
    let mime_types = match js::get(source, "mimeTypes") {
        None | Some(Value::Null) => fallback_mime_types.unwrap_or_default(),
        some => string_list(some, |e| MIME_PATTERN.is_match(e)),
    };
    let extensions = string_list(js::get(source, "extensions"), |e| {
        FILE_EXTENSION.is_match(e)
    });
    let accepted = js::get(source, "accepted") == Some(&Value::Bool(true))
        || (js::get(source, "accepted").is_none() && fallback_accepted);
    let max_bytes = js::get(source, "maxBytes")
        .and_then(js::safe_integer)
        .filter(|n| *n > 0 && *n <= MAX_REFERENCE_BYTES);
    Obj::new()
        .set("accepted", accepted)
        .opt("mimeTypes", (!mime_types.is_empty()).then_some(mime_types))
        .opt("extensions", (!extensions.is_empty()).then_some(extensions))
        .opt("maxBytes", max_bytes)
        .build()
}

fn reference_transport_accepted(value: Option<&Value>) -> bool {
    one_of(value, &["data-url", "local-snapshot", "resource"]).is_some()
}

fn string_list(value: Option<&Value>, predicate: impl Fn(&str) -> bool) -> Vec<String> {
    let Some(entries) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    for entry in entries {
        let Some(text) = entry.as_str() else { continue };
        if text.is_empty() || js::len16(text) > 160 {
            continue;
        }
        let normalized = js::trim(text).to_lowercase();
        if predicate(&normalized) && !out.contains(&normalized) {
            out.push(normalized);
        }
    }
    out.truncate(64);
    out
}

fn bounded_positive_integer(value: Option<&Value>, fallback: i64, maximum: i64) -> i64 {
    value
        .and_then(js::safe_integer)
        .filter(|n| *n > 0 && *n <= maximum)
        .unwrap_or(fallback)
}

fn assert_runtime_descriptor(value: &Value) -> Contract<()> {
    let descriptor = assert_record(Some(value), "runtime descriptor")?;
    assert_runtime_id(descriptor.get("id"), "runtime descriptor.id")?;
    required_string(
        descriptor.get("displayName"),
        "runtime descriptor.displayName",
        160,
    )?;
    Ok(())
}

/// `sanitizeAgentRuntimeDescriptor(value)`: project a trusted/native
/// descriptor onto the bounded Renderer-safe DTO.
pub fn sanitize_agent_runtime_descriptor(value: &Value) -> Contract<Value> {
    let descriptor = assert_record(Some(value), "runtime descriptor")?;
    let id = assert_runtime_id(descriptor.get("id"), "runtime descriptor.id")?;
    let display_name = required_string(
        descriptor.get("displayName"),
        "runtime descriptor.displayName",
        160,
    )?;
    let text = |key: &str, limit: usize| {
        let text = bounded_optional_text(descriptor.get(key), limit);
        (!text.is_empty()).then_some(text)
    };
    let pair = |key: &str, a: (&str, usize), b: (&str, usize)| -> Option<Value> {
        let value = descriptor.get(key).filter(|v| v.is_object())?;
        let first = bounded_optional_text(js::get(value, a.0), a.1);
        let second = bounded_optional_text(js::get(value, b.0), b.1);
        (!first.is_empty() && !second.is_empty())
            .then(|| Obj::new().set(a.0, first).set(b.0, second).build())
    };
    let execution = descriptor
        .get("execution")
        .filter(|v| v.is_object())
        .and_then(|v| {
            let kind = bounded_optional_text(js::get(v, "kind"), 80);
            let distribution = bounded_optional_text(js::get(v, "distribution"), 80);
            let controller = bounded_optional_text(js::get(v, "controller"), 80);
            (!kind.is_empty() && !distribution.is_empty() && !controller.is_empty()).then(|| {
                Obj::new()
                    .set("kind", kind)
                    .set("distribution", distribution)
                    .set("controller", controller)
                    .build()
            })
        });
    Ok(Obj::new()
        .set("id", id.clone())
        .set("displayName", display_name)
        .set(
            "description",
            bounded_optional_text(descriptor.get("description"), 2_000),
        )
        .set("kind", text("kind", 80).unwrap_or_else(|| "native".into()))
        .set("iconKey", text("iconKey", 80).unwrap_or(id))
        .set(
            "priority",
            descriptor
                .get("priority")
                .and_then(js::safe_integer)
                .unwrap_or(0),
        )
        .opt("distribution", text("distribution", 80))
        .opt("version", text("version", 80))
        .opt("source", text("source", 80))
        .opt("compatibility", text("compatibility", 120))
        .opt("execution", execution)
        .opt(
            "protocol",
            pair("protocol", ("kind", 80), ("transport", 80)),
        )
        .opt(
            "integration",
            pair("integration", ("kind", 80), ("adapter", 80)),
        )
        .opt("trust", pair("trust", ("level", 80), ("publisher", 160)))
        .opt(
            "ownership",
            sanitize_runtime_ownership(descriptor.get("ownership")),
        )
        .build())
}

fn sanitize_runtime_ownership(value: Option<&Value>) -> Option<Value> {
    let value = value.filter(|v| v.is_object())?;
    let text = |key: &str| bounded_optional_text(js::get(value, key), 80);
    let (harness, models, session) = (text("harness"), text("models"), text("session"));
    let credentials = sanitize_owner_list(js::get(value, "credentials"));
    let billing = sanitize_owner_list(js::get(value, "billing"));
    (!harness.is_empty()
        && !models.is_empty()
        && !session.is_empty()
        && !credentials.is_empty()
        && !billing.is_empty())
    .then(|| {
        Obj::new()
            .set("harness", harness)
            .set("credentials", credentials)
            .set("models", models)
            .set("billing", billing)
            .set("session", session)
            .build()
    })
}

fn sanitize_owner_list(value: Option<&Value>) -> Vec<String> {
    let Some(entries) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    for entry in entries {
        let text = bounded_optional_text(Some(entry), 80);
        if !text.is_empty() && !out.contains(&text) {
            out.push(text);
        }
    }
    out.truncate(8);
    out
}

/// `assertAgentRuntimeReadiness(value)`.
pub fn assert_agent_runtime_readiness(value: &Value) -> Contract<()> {
    let readiness = assert_record(Some(value), "runtime readiness")?;
    let runtime = match readiness.get("runtimeId") {
        None | Some(Value::Null) => readiness.get("provider"),
        some => some,
    };
    assert_runtime_id(runtime, "runtime readiness.runtimeId")?;
    let status = enum_value(
        readiness.get("status"),
        "runtime readiness.status",
        &[
            "not-installed",
            "installed-not-authenticated",
            "unsupported-version",
            "protocol-unavailable",
            "ready",
            "error",
        ],
    )?;
    let codes = agent_readiness_codes();
    let code = enum_value(readiness.get("code"), "runtime readiness.code", &codes)?;
    if readiness_code_status(code) != Some(status) {
        return Err(type_error(format!(
            "runtime readiness.code {code} is incompatible with status {status}."
        )));
    }
    Ok(())
}

/// `assertAgentModel(value)`.
pub fn assert_agent_model(value: &Value) -> Contract<()> {
    let model = assert_record(Some(value), "Agent model")?;
    required_string(model.get("id"), "Agent model.id", 512)?;
    required_string(model.get("model"), "Agent model.model", 512)?;
    required_string(model.get("displayName"), "Agent model.displayName", 512)?;
    if model.contains_key("providerId") {
        required_string(model.get("providerId"), "Agent model.providerId", 160)?;
    }
    if model.contains_key("modelId") {
        required_string(model.get("modelId"), "Agent model.modelId", 300)?;
    }
    Ok(())
}

/// `assertAgentInferenceProvider(value)`.
pub fn assert_agent_inference_provider(value: &Value) -> Contract<()> {
    let provider = assert_record(Some(value), "Agent inference provider")?;
    required_string(provider.get("id"), "Agent inference provider.id", 160)?;
    required_string(
        provider.get("displayName"),
        "Agent inference provider.displayName",
        160,
    )?;
    if !js::nullish(provider.get("source")) {
        required_string(
            provider.get("source"),
            "Agent inference provider.source",
            40,
        )?;
    }
    if !js::nullish(provider.get("defaultModel")) {
        required_string(
            provider.get("defaultModel"),
            "Agent inference provider.defaultModel",
            512,
        )?;
    }
    if !provider
        .get("modelCount")
        .and_then(js::safe_integer)
        .is_some_and(|n| (0..=500).contains(&n))
    {
        return Err(type_error(
            "Agent inference provider.modelCount must be a bounded non-negative integer.",
        ));
    }
    Ok(())
}

fn assert_named_entry(value: &Value, label: &str, id_key: &str) -> Contract<()> {
    let entry = assert_record(Some(value), &format!("Agent {label}"))?;
    required_string(entry.get(id_key), &format!("Agent {label}.{id_key}"), 512)?;
    Ok(())
}

fn bounded_optional_text(value: Option<&Value>, limit: usize) -> String {
    value
        .and_then(Value::as_str)
        .map(|text| js::head16(js::trim(text), limit).to_string())
        .unwrap_or_default()
}
