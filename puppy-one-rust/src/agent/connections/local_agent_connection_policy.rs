//! `connections/local-agent-connection-policy.mjs`: a probe's evidence as a
//! public local connection. Only a detected, signed-in, protocol-compatible
//! installation with models is selectable.
use crate::agent::contract::js;
use regex::Regex;
use serde_json::{Value, json};
use std::sync::LazyLock;

const SAFE_SOURCES: &[&str] = &[
    "configured",
    "user-installation",
    "system-installation",
    "path-installation",
    "application-bundle",
];

static ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9._-]{0,79}$").expect("pattern"));
static VERSION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._+-]+$").expect("pattern"));
static LINE_BREAKS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\r\n\x00]+").expect("pattern"));

/// `deriveLocalConnection(probe, gates)`.
pub fn derive_local_connection(probe: Option<&Value>, gates: Option<&Value>) -> Value {
    let empty = json!({});
    let probe = probe.unwrap_or(&Value::Null);
    let field = |key: &str| probe.get(key);
    let installation = normalize_installation(field("installation"));
    let authentication = normalize_authentication(field("authentication"));
    let version = safe_version(field("version"));
    let protocol_compatible = field("protocolCompatible") == Some(&Value::Bool(true));
    let has_models = field("hasModels") == Some(&Value::Bool(true));
    let ready = installation == "detected"
        && authentication == "signed-in"
        && protocol_compatible
        && has_models
        && {
            // Omitted gates preserve the legacy default: only explicit false
            // denies admission.
            let gates = gates.unwrap_or(&empty);
            gates.get("backendRegistered") != Some(&Value::Bool(false))
                && gates.get("workspaceAllowed") != Some(&Value::Bool(false))
        };
    let integration = derive_integration(ready, installation, authentication, protocol_compatible);
    let mut connection = json!({
        "id": normalize_id(field("id")),
        "displayName": safe_text(field("displayName"), "Local Agent", 80),
        "installation": installation,
        "version": version,
        "authentication": authentication,
        "integration": integration,
        "capabilities": {
            "versionProbe": version.is_some(),
            "authenticationProbe": authentication != "unknown",
            "protocolProbe": protocol_compatible,
        },
        "selectable": integration == "ready",
        "statusMessage": status_message(
            field("displayName"),
            installation,
            authentication,
            version.as_deref(),
            field("unavailableMessage"),
            protocol_compatible,
            has_models,
            ready,
        ),
        "actions": actions_for(installation),
    });
    if let Some(source) = field("source")
        .and_then(Value::as_str)
        .filter(|source| SAFE_SOURCES.contains(source))
    {
        connection["source"] = Value::from(source);
    }
    connection
}

fn derive_integration(
    ready: bool,
    installation: &str,
    authentication: &str,
    protocol_compatible: bool,
) -> &'static str {
    if ready {
        return "ready";
    }
    match installation {
        "unsupported" => return "incompatible",
        "broken" => return "blocked",
        "detected" => {}
        _ => return "inventory-only",
    }
    if !protocol_compatible {
        return "protocol-unavailable";
    }
    if matches!(authentication, "error" | "unknown") {
        return "blocked";
    }
    "setup-required"
}

#[allow(clippy::too_many_arguments)]
fn status_message(
    display_name: Option<&Value>,
    installation: &str,
    authentication: &str,
    version: Option<&str>,
    unavailable_message: Option<&Value>,
    protocol_compatible: bool,
    has_models: bool,
    ready: bool,
) -> String {
    let label = safe_text(display_name, "Local Agent", 80);
    let suffix = version.map(|v| format!(" {v}")).unwrap_or_default();
    match installation {
        "not-found" => return format!("{label} was not found in known installation locations."),
        "unsupported" => {
            return format!("{label}{suffix} is older than the tested compatibility baseline.");
        }
        "broken" => {
            return format!(
                "{label} was detected, but its version or status probe could not be completed safely."
            );
        }
        _ => {}
    }
    if !protocol_compatible {
        let unavailable = safe_text(
            unavailable_message,
            "This PuppyOne build does not support its native Agent protocol.",
            256,
        );
        return format!("{label}{suffix} is detected. {unavailable}");
    }
    match authentication {
        "signed-out" => {
            return format!(
                "{label}{suffix} is detected but requires sign-in. Refresh after signing in with its documented CLI flow."
            );
        }
        "expired" => {
            return format!("{label}{suffix} is detected, but its local session has expired.");
        }
        "error" => {
            return format!(
                "{label}{suffix} is detected, but its authentication state could not be read."
            );
        }
        "unknown" => {
            return format!(
                "{label}{suffix} is detected, but its authentication status was not recognized."
            );
        }
        _ => {}
    }
    if !has_models {
        return format!(
            "{label}{suffix} is detected, but no compatible text-and-tools model is available."
        );
    }
    if ready {
        return format!("{label}{suffix} is ready for native Agent sessions.");
    }
    format!("{label}{suffix} is detected but is not enabled for this workspace.")
}

fn actions_for(installation: &str) -> Value {
    if installation == "not-found" {
        return json!([{ "id": "learn-more", "label": "Learn more" }]);
    }
    json!([
        { "id": "refresh", "label": "Refresh" },
        { "id": "learn-more", "label": "Learn why" },
    ])
}

fn normalize_installation(value: Option<&Value>) -> &'static str {
    match value.and_then(Value::as_str) {
        Some("not-found") => "not-found",
        Some("detected") => "detected",
        Some("unsupported") => "unsupported",
        _ => "broken",
    }
}

fn normalize_authentication(value: Option<&Value>) -> &'static str {
    match value.and_then(Value::as_str) {
        Some("signed-out") => "signed-out",
        Some("signed-in") => "signed-in",
        Some("expired") => "expired",
        Some("error") => "error",
        _ => "unknown",
    }
}

/// `normalizeId(value)`.
fn normalize_id(value: Option<&Value>) -> String {
    let raw = value
        .filter(|v| js::truthy(v))
        .map(|v| js::to_js_string(Some(v)))
        .unwrap_or_else(|| "local-agent".into());
    let normalized = js::trim(&raw).to_lowercase();
    if ID.is_match(&normalized) {
        normalized
    } else {
        "local-agent".into()
    }
}

fn safe_version(value: Option<&Value>) -> Option<String> {
    let normalized = js::trim(value.and_then(Value::as_str).unwrap_or(""));
    (!normalized.is_empty() && js::len16(normalized) <= 80 && VERSION.is_match(normalized))
        .then(|| normalized.to_string())
}

/// `safeText(value, fallback, limit)`.
fn safe_text(value: Option<&Value>, fallback: &str, limit: usize) -> String {
    let normalized = value
        .and_then(Value::as_str)
        .map(|text| js::trim(&LINE_BREAKS.replace_all(text, " ")).to_string())
        .unwrap_or_default();
    let text = if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized
    };
    js::head16(&text, limit).to_string()
}
