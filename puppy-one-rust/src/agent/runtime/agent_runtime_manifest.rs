//! `runtime/agent-runtime-manifest.mjs`: the main-process-only facts that
//! classify one Agent runtime. Launch commands, executable paths,
//! credentials and environment maps are deliberately excluded; discovery and
//! concrete adapters own those, the manifest owns stable routing semantics.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::runtime_schema::sanitize_agent_runtime_descriptor;
use crate::text;
use regex::Regex;
use serde_json::{Map, Value};
use std::sync::LazyLock;

pub const AGENT_RUNTIME_MANIFEST_VERSION: i64 = 1;

const EXECUTION_KINDS: &[&str] = &[
    "managed-local-process",
    "local-process",
    "sdk-mediated-process",
    "remote-service",
];
const DISTRIBUTIONS: &[&str] = &["bundled", "user-installed", "managed-download", "remote"];
const CONTROLLERS: &[&str] = &["bundled-adapter", "bundled-sdk", "remote-client"];
const PROTOCOL_KINDS: &[&str] = &["acp", "app-server", "agent-sdk", "rpc", "http-api"];
const PROTOCOL_TRANSPORTS: &[&str] = &["stdio-json-rpc", "stdio-jsonl", "in-process-sdk", "https"];
const INTEGRATION_KINDS: &[&str] = &[
    "managed-harness",
    "specialized-native",
    "native-protocol",
    "compatibility-bridge",
    "user-defined",
];
const ADAPTER_KINDS: &[&str] = &["specialized", "generic-acp", "custom"];
const TRUST_LEVELS: &[&str] = &[
    "bundled-verified",
    "first-party",
    "reviewed-bridge",
    "user-defined",
];
const OWNERS: &[&str] = &["puppyone", "runtime", "user-provider"];

static RUNTIME_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9-]{1,39}$").expect("runtime id"));

fn invalid(path: &str, reason: &str) -> AgentError {
    AgentError::new(format!("Invalid Agent runtime manifest: {path} {reason}."))
        .with_name("TypeError")
}

fn record<'a>(value: Option<&'a Value>, label: &str) -> AgentResult<&'a Map<String, Value>> {
    value
        .and_then(Value::as_object)
        .ok_or_else(|| invalid(label, "must be an object"))
}

fn exact_keys(value: &Map<String, Value>, label: &str, allowed: &[&str]) -> AgentResult<()> {
    match value.keys().find(|key| !allowed.contains(&key.as_str())) {
        Some(unknown) => Err(invalid(
            label,
            &format!("contains unsupported field {unknown}"),
        )),
        None => Ok(()),
    }
}

fn text(value: Option<&Value>, label: &str, limit: usize) -> AgentResult<String> {
    let Some(text) = value
        .and_then(Value::as_str)
        .filter(|t| !text::trim(t).is_empty())
    else {
        return Err(invalid(label, "must be non-empty text"));
    };
    let normalized = text::trim(text);
    if text::len16(normalized) > limit {
        return Err(invalid(label, &format!("exceeds {limit} characters")));
    }
    Ok(normalized.to_string())
}

fn optional_text(value: Option<&Value>, label: &str, limit: usize) -> AgentResult<Option<String>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(None),
        some => text(some, label, limit).map(Some),
    }
}

fn choice<'a>(value: Option<&Value>, label: &str, allowed: &[&'a str]) -> AgentResult<&'a str> {
    let text = value.and_then(Value::as_str);
    allowed
        .iter()
        .find(|entry| Some(**entry) == text)
        .copied()
        .ok_or_else(|| invalid(label, &format!("must be one of {}", allowed.join(", "))))
}

fn owner_list(value: Option<&Value>, label: &str) -> AgentResult<Vec<&'static str>> {
    let Some(entries) = value
        .and_then(Value::as_array)
        .filter(|e| !e.is_empty() && e.len() <= OWNERS.len())
    else {
        return Err(invalid(label, "must be a non-empty bounded owner list"));
    };
    let mut normalized = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let owner = choice(Some(entry), &format!("{label}[{index}]"), OWNERS)?;
        if normalized.contains(&owner) {
            return Err(invalid(label, "must not contain duplicates"));
        }
        normalized.push(owner);
    }
    Ok(normalized)
}

/// `defineAgentRuntimeManifest(value)`.
pub fn define_agent_runtime_manifest(value: &Value) -> AgentResult<Value> {
    let source = record(Some(value), "manifest")?;
    exact_keys(
        source,
        "manifest",
        &[
            "schemaVersion",
            "id",
            "displayName",
            "description",
            "iconKey",
            "priority",
            "execution",
            "protocol",
            "integration",
            "trust",
            "ownership",
            "source",
            "compatibility",
        ],
    )?;
    let schema_version = match source.get("schemaVersion") {
        None | Some(Value::Null) => AGENT_RUNTIME_MANIFEST_VERSION,
        Some(version) => version.as_i64().unwrap_or(-1),
    };
    if schema_version != AGENT_RUNTIME_MANIFEST_VERSION {
        return Err(invalid(
            "schemaVersion",
            &format!("must be {AGENT_RUNTIME_MANIFEST_VERSION}"),
        ));
    }
    let id = source
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| RUNTIME_ID.is_match(id))
        .ok_or_else(|| invalid("id", "is invalid"))?
        .to_string();
    let display_name = text(source.get("displayName"), "displayName", 160)?;
    let execution = record(source.get("execution"), "execution")?;
    let protocol = record(source.get("protocol"), "protocol")?;
    let integration = record(source.get("integration"), "integration")?;
    let trust = record(source.get("trust"), "trust")?;
    let ownership = record(source.get("ownership"), "ownership")?;
    exact_keys(
        execution,
        "execution",
        &["kind", "distribution", "controller"],
    )?;
    exact_keys(protocol, "protocol", &["kind", "transport"])?;
    exact_keys(integration, "integration", &["kind", "adapter"])?;
    exact_keys(trust, "trust", &["level", "publisher"])?;
    exact_keys(
        ownership,
        "ownership",
        &["harness", "credentials", "models", "billing", "session"],
    )?;
    let icon_key =
        optional_text(source.get("iconKey"), "iconKey", 80)?.unwrap_or_else(|| id.clone());
    let manifest = Obj::new()
        .set("schemaVersion", schema_version)
        .set("id", id)
        .set("displayName", display_name)
        .opt(
            "description",
            optional_text(source.get("description"), "description", 2_000)?,
        )
        .set("iconKey", icon_key)
        .set(
            "priority",
            source
                .get("priority")
                .and_then(js::safe_integer)
                .unwrap_or(0),
        )
        .set(
            "execution",
            Obj::new()
                .set(
                    "kind",
                    choice(execution.get("kind"), "execution.kind", EXECUTION_KINDS)?,
                )
                .set(
                    "distribution",
                    choice(
                        execution.get("distribution"),
                        "execution.distribution",
                        DISTRIBUTIONS,
                    )?,
                )
                .set(
                    "controller",
                    choice(
                        execution.get("controller"),
                        "execution.controller",
                        CONTROLLERS,
                    )?,
                )
                .build(),
        )
        .set(
            "protocol",
            Obj::new()
                .set(
                    "kind",
                    choice(protocol.get("kind"), "protocol.kind", PROTOCOL_KINDS)?,
                )
                .set(
                    "transport",
                    choice(
                        protocol.get("transport"),
                        "protocol.transport",
                        PROTOCOL_TRANSPORTS,
                    )?,
                )
                .build(),
        )
        .set(
            "integration",
            Obj::new()
                .set(
                    "kind",
                    choice(
                        integration.get("kind"),
                        "integration.kind",
                        INTEGRATION_KINDS,
                    )?,
                )
                .set(
                    "adapter",
                    choice(
                        integration.get("adapter"),
                        "integration.adapter",
                        ADAPTER_KINDS,
                    )?,
                )
                .build(),
        )
        .set(
            "trust",
            Obj::new()
                .set(
                    "level",
                    choice(trust.get("level"), "trust.level", TRUST_LEVELS)?,
                )
                .set(
                    "publisher",
                    text(trust.get("publisher"), "trust.publisher", 160)?,
                )
                .build(),
        )
        .set(
            "ownership",
            Obj::new()
                .set(
                    "harness",
                    choice(ownership.get("harness"), "ownership.harness", OWNERS)?,
                )
                .set(
                    "credentials",
                    owner_list(ownership.get("credentials"), "ownership.credentials")?,
                )
                .set(
                    "models",
                    choice(ownership.get("models"), "ownership.models", OWNERS)?,
                )
                .set(
                    "billing",
                    owner_list(ownership.get("billing"), "ownership.billing")?,
                )
                .set(
                    "session",
                    choice(ownership.get("session"), "ownership.session", OWNERS)?,
                )
                .build(),
        )
        .opt("source", optional_text(source.get("source"), "source", 80)?)
        .opt(
            "compatibility",
            optional_text(source.get("compatibility"), "compatibility", 120)?,
        )
        .build();
    validate_relationships(&manifest)?;
    Ok(manifest)
}

/// `runtimeDescriptorFromManifest(value)`: the bounded public projection;
/// never exposes operational launch data.
pub fn runtime_descriptor_from_manifest(value: &Value) -> AgentResult<Value> {
    let manifest = define_agent_runtime_manifest(value)?;
    let field = |key: &str| manifest.get(key).cloned();
    Ok(sanitize_agent_runtime_descriptor(
        &Obj::new()
            .opt("id", field("id"))
            .opt("displayName", field("displayName"))
            .opt("description", field("description"))
            .opt("iconKey", field("iconKey"))
            .opt("priority", field("priority"))
            .set("kind", manifest["integration"]["kind"].clone())
            .set(
                "distribution",
                manifest["execution"]["distribution"].clone(),
            )
            .opt("execution", field("execution"))
            .opt("protocol", field("protocol"))
            .opt("integration", field("integration"))
            .opt("trust", field("trust"))
            .opt("ownership", field("ownership"))
            .opt("source", field("source"))
            .opt("compatibility", field("compatibility"))
            .build(),
    )?)
}

fn validate_relationships(manifest: &Value) -> AgentResult<()> {
    let at = |a: &str, b: &str| manifest[a][b].as_str().unwrap_or("");
    if at("integration", "adapter") == "generic-acp" && at("protocol", "kind") != "acp" {
        return Err(invalid(
            "integration.adapter",
            "generic-acp requires protocol.kind acp",
        ));
    }
    if at("integration", "kind") == "compatibility-bridge"
        && at("trust", "level") != "reviewed-bridge"
    {
        return Err(invalid(
            "trust.level",
            "compatibility-bridge requires reviewed-bridge trust",
        ));
    }
    if at("integration", "kind") == "user-defined" && at("trust", "level") != "user-defined" {
        return Err(invalid(
            "trust.level",
            "user-defined integration requires user-defined trust",
        ));
    }
    if at("trust", "level") == "bundled-verified"
        && !matches!(
            at("execution", "distribution"),
            "bundled" | "managed-download"
        )
    {
        return Err(invalid(
            "execution.distribution",
            "bundled-verified trust requires bundled or managed-download distribution",
        ));
    }
    if at("execution", "kind") == "remote-service" && at("protocol", "transport") != "https" {
        return Err(invalid(
            "protocol.transport",
            "remote-service requires https",
        ));
    }
    Ok(())
}
