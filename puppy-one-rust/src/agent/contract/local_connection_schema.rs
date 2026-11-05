//! `shared/agent-contract/local-connection-schema.mjs`.
use super::js::{self, Obj};
use super::validation::{
    Contract, assert_array, assert_record, contract_error, enum_value, required_opaque_id,
    required_string,
};
use serde_json::Value;

pub const INSTALLATION_STATES: &[&str] = &["not-found", "detected", "unsupported", "broken"];
pub const AUTHENTICATION_STATES: &[&str] =
    &["unknown", "signed-out", "signed-in", "expired", "error"];
pub const INTEGRATION_STATES: &[&str] = &[
    "inventory-only",
    "setup-required",
    "protocol-unavailable",
    "ready",
    "incompatible",
    "blocked",
    // Read-only compatibility for older journal/UI fixtures.
    "bridge-required",
];
pub const SOURCES: &[&str] = &[
    "configured",
    "user-installation",
    "system-installation",
    "path-installation",
    "application-bundle",
];
pub const ACTIONS: &[&str] = &["refresh", "learn-more"];

/// Validate and project main-process inventory data onto the public DTO.
/// Returning a new object is intentional: executable paths, raw command
/// output, environment data and future internal fields cannot cross IPC by
/// accident.
pub fn sanitize_agent_local_connections_snapshot(value: &Value) -> Contract<Value> {
    let snapshot = assert_record(Some(value), "Local Agent connections snapshot")?;
    let connections = assert_array(snapshot.get("connections"), "Local Agent connections")?;
    if connections.len() > 16 {
        return Err(contract_error("connections", "contains too many entries"));
    }
    let scanned_at = required_string(snapshot.get("scannedAt"), "scannedAt", 64)?;
    if js::date_parse(&scanned_at).is_none() {
        return Err(contract_error("scannedAt", "must be an ISO timestamp"));
    }
    let warnings = assert_array(snapshot.get("warnings"), "Local Agent warnings")?;
    if warnings.len() > 16 {
        return Err(contract_error("warnings", "contains too many entries"));
    }
    let connections = connections
        .iter()
        .enumerate()
        .map(|(index, connection)| sanitize_connection(connection, index))
        .collect::<Contract<Vec<_>>>()?;
    let warnings = warnings
        .iter()
        .enumerate()
        .map(|(index, warning)| required_string(Some(warning), &format!("warnings[{index}]"), 512))
        .collect::<Contract<Vec<_>>>()?;
    Ok(Obj::new()
        .set("connections", connections)
        .set("scannedAt", scanned_at)
        .set("warnings", warnings)
        .build())
}

fn sanitize_connection(value: &Value, index: usize) -> Contract<Value> {
    let label = |key: &str| format!("connections[{index}].{key}");
    let connection = assert_record(Some(value), &format!("connections[{index}]"))?;
    let capabilities = assert_record(connection.get("capabilities"), &label("capabilities"))?;
    let actions = assert_array(connection.get("actions"), &label("actions"))?;
    if actions.len() > 8 {
        return Err(contract_error(
            &label("actions"),
            "contains too many entries",
        ));
    }
    let version = match connection.get("version") {
        Some(Value::Null) => Value::Null,
        other => Value::String(required_string(other, &label("version"), 80)?),
    };
    let capability = |key: &str| {
        required_boolean(
            capabilities.get(key),
            &label(&format!("capabilities.{key}")),
        )
    };
    Ok(Obj::new()
        .set(
            "id",
            required_opaque_id(connection.get("id"), &label("id"))?,
        )
        .set(
            "displayName",
            required_string(connection.get("displayName"), &label("displayName"), 80)?,
        )
        .set(
            "installation",
            enum_value(
                connection.get("installation"),
                &label("installation"),
                INSTALLATION_STATES,
            )?,
        )
        .set("version", version)
        .set(
            "authentication",
            enum_value(
                connection.get("authentication"),
                &label("authentication"),
                AUTHENTICATION_STATES,
            )?,
        )
        .set(
            "integration",
            enum_value(
                connection.get("integration"),
                &label("integration"),
                INTEGRATION_STATES,
            )?,
        )
        .set(
            "capabilities",
            Obj::new()
                .set("versionProbe", capability("versionProbe")?)
                .set("authenticationProbe", capability("authenticationProbe")?)
                .set("protocolProbe", capability("protocolProbe")?)
                .build(),
        )
        .set(
            "selectable",
            required_boolean(connection.get("selectable"), &label("selectable"))?,
        )
        .set(
            "statusMessage",
            required_string(
                connection.get("statusMessage"),
                &label("statusMessage"),
                512,
            )?,
        )
        .set(
            "actions",
            actions
                .iter()
                .enumerate()
                .map(|(action_index, action)| sanitize_action(action, index, action_index))
                .collect::<Contract<Vec<_>>>()?,
        )
        .opt(
            "source",
            match connection.get("source") {
                None => None,
                source => Some(enum_value(source, &label("source"), SOURCES)?),
            },
        )
        .build())
}

fn sanitize_action(value: &Value, connection_index: usize, action_index: usize) -> Contract<Value> {
    let label = format!("connections[{connection_index}].actions[{action_index}]");
    let action = assert_record(Some(value), &label)?;
    Ok(Obj::new()
        .set(
            "id",
            enum_value(action.get("id"), &format!("{label}.id"), ACTIONS)?,
        )
        .set(
            "label",
            required_string(action.get("label"), &format!("{label}.label"), 80)?,
        )
        .build())
}

fn required_boolean(value: Option<&Value>, label: &str) -> Contract<bool> {
    value
        .and_then(Value::as_bool)
        .ok_or_else(|| contract_error(label, "must be a boolean"))
}
