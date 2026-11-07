//! `connections/probes/versioned-local-agent-probe.mjs`: an
//! installation-only probe for terminal-launched Agents without a native
//! integration contract.
use super::bounded_probe_command::{create_probe_environment, run_bounded_probe_command};
use super::executable_candidates::assert_executable_identity;
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::installation::executable_resolver::ResolvedCandidate;
use crate::agent::transports::bounded_process_probe::ProbeOptions;
use regex::Regex;
use serde_json::{Value, json};
use std::sync::LazyLock;

static VERSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?)\b").expect("version pattern")
});

/// `parseVersionedLocalAgentVersion(value)`.
pub fn parse_versioned_local_agent_version(value: &str) -> Option<String> {
    VERSION
        .captures(value)
        .and_then(|captures| captures.get(1))
        .map(|m| m.as_str().to_string())
}

/// `normalizeSource(source)`.
pub fn normalize_probe_source(source: Option<&str>) -> Value {
    match source {
        Some(
            source @ ("configured"
            | "user-installation"
            | "system-installation"
            | "path-installation"
            | "application-bundle"),
        ) => Value::from(source),
        _ => Value::Null,
    }
}

/// `probeVersionedLocalAgent({ candidate, id, displayName, env, signal })`.
pub async fn probe_versioned_local_agent(
    candidate: Option<&ResolvedCandidate>,
    id: &str,
    display_name: &str,
    env: &EnvMap,
    signal: Option<crate::agent::tasks::CancelSignal>,
) -> Value {
    let base = json!({
        "id": id,
        "displayName": display_name,
        "authentication": "unknown",
        "protocolCompatible": false,
        "hasModels": false,
        "source": normalize_probe_source(candidate.map(|c| c.source.as_str())),
    });
    let with = |installation: &str, version: Option<String>| {
        crate::agent::contract::js::Obj::from(&base)
            .set("installation", installation)
            .set("version", version)
            .build()
    };
    let Some(candidate) = candidate else {
        return with("not-found", None);
    };
    let probe = async {
        let executable_path = assert_executable_identity(candidate).await?;
        let mut args = candidate.args_prefix.clone();
        args.push("--version".into());
        run_bounded_probe_command(
            &executable_path,
            &args,
            ProbeOptions {
                env: Some(create_probe_environment(env)),
                signal,
                timeout_ms: 4_000,
                ..Default::default()
            },
        )
        .await
    }
    .await;
    match probe {
        Ok(result) => match parse_versioned_local_agent_version(&format!(
            "{}\n{}",
            result.stdout, result.stderr
        )) {
            Some(version) if result.code == Some(0) => with("detected", Some(version)),
            _ => with("broken", None),
        },
        Err(_) => with("broken", None),
    }
}
