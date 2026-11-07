//! `connections/probes/cursor-local-probe.mjs`: Cursor Agent's version and
//! sign-in state. Cursor's cold CLI bootstrap and account lookup exceed the
//! generic local probe budget, so both commands get their own bounds.
use super::bounded_probe_command::{create_probe_environment, run_bounded_probe_command};
use super::executable_candidates::assert_executable_identity;
use super::versioned_local_agent_probe::normalize_probe_source;
use crate::agent::agent_error::AgentResult;
use crate::agent::contract::js::{self, Obj};
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::event_loop::AbortSignal;
use crate::agent::installation::executable_resolver::ResolvedCandidate;
use crate::agent::transports::bounded_process_probe::{ProbeOptions, ProbeResult, ProbeRunner};
use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

const CURSOR_VERSION_PROBE_TIMEOUT_MS: u64 = 5_000;
const CURSOR_STATUS_PROBE_TIMEOUT_MS: u64 = 10_000;

static VERSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(\d{4}\.\d{2}\.\d{2}(?:-[A-Za-z0-9._-]+)?|\d+\.\d+\.\d+)\b")
        .expect("version pattern")
});
static EXPIRED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"expired|session has expired|credentials? expired").expect("pattern")
});
static SIGNED_OUT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"not authenticated|not logged[ -]?in|signed[ -]?out|login required|please (?:log|sign)[ -]?in")
        .expect("pattern")
});
static SIGNED_IN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"authenticated|logged[ -]?in|signed[ -]?in").expect("pattern"));
static FAILED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\berror\b|failed|secitemcopymatching|unable to").expect("pattern")
});
static TIMED_OUT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)timed out").expect("pattern"));

/// `parseCursorLocalVersion(value)`.
pub fn parse_cursor_local_version(value: &str) -> Option<String> {
    VERSION
        .captures(value)
        .and_then(|captures| captures.get(1))
        .map(|m| m.as_str().to_string())
}

/// `parseCursorAuthentication(value)`: negative evidence first.
pub fn parse_cursor_authentication(value: &str) -> &'static str {
    let status = value.to_lowercase();
    if EXPIRED.is_match(&status) {
        "expired"
    } else if SIGNED_OUT.is_match(&status) {
        "signed-out"
    } else if SIGNED_IN.is_match(&status) {
        "signed-in"
    } else if FAILED.is_match(&status) {
        "error"
    } else {
        "unknown"
    }
}

fn base_cursor(source: Option<&str>) -> Obj {
    Obj::new()
        .set("id", "cursor-agent")
        .set("displayName", "Cursor Agent")
        .set("authentication", "unknown")
        .set("protocolCompatible", true)
        .set("hasModels", false)
        .set("source", normalize_probe_source(source))
}

fn broken_cursor(source: Option<&str>, diagnostic: Option<String>) -> Value {
    base_cursor(source)
        .set("installation", "broken")
        .set("version", Value::Null)
        .set("authentication", "error")
        .opt(
            "diagnostic",
            diagnostic.map(|d| js::head16(d.trim(), 4_000).to_string()),
        )
        .build()
}

fn probe_failure_diagnostic(probe: &str, result: &ProbeResult) -> String {
    let termination = match (&result.signal, result.code) {
        (Some(signal), _) => format!("signal {signal}"),
        (None, Some(code)) => format!("exit code {code}"),
        (None, None) => "an unknown exit status".into(),
    };
    let output = format!("{}\n{}", result.stdout, result.stderr);
    let output = js::head16(output.trim(), 3_500);
    if output.is_empty() {
        format!("Cursor {probe} probe ended with {termination}.")
    } else {
        format!("Cursor {probe} probe ended with {termination}. {output}")
    }
}

/// `probeCursorLocal({ candidate, runCommand, env, signal })`. A supplied
/// `run_command` stands in for the process and skips identity checks.
pub async fn probe_cursor_local(
    candidate: Option<&ResolvedCandidate>,
    run_command: Option<ProbeRunner>,
    env: &EnvMap,
    signal: Option<AbortSignal>,
) -> Value {
    let Some(candidate) = candidate else {
        return base_cursor(None)
            .set("installation", "not-found")
            .set("version", Value::Null)
            .build();
    };
    let source = Some(candidate.source.as_str());
    let run = |path: String, args: Vec<String>, options: ProbeOptions| {
        let runner = run_command.clone();
        async move {
            match runner {
                Some(runner) => runner(path, args, options).await,
                None => run_bounded_probe_command(&path, &args, options).await,
            }
        }
    };
    let executable = |candidate: &ResolvedCandidate| {
        let checked = run_command.is_none();
        let candidate = candidate.clone();
        async move {
            if checked {
                assert_executable_identity(&candidate).await
            } else {
                Ok::<String, crate::agent::agent_error::AgentError>(
                    candidate.executable_path.clone(),
                )
            }
        }
    };
    let probe_environment = create_probe_environment(env);
    let command = |args: &[&str]| -> Vec<String> {
        let mut command = candidate.args_prefix.clone();
        command.extend(args.iter().map(|arg| arg.to_string()));
        command
    };
    let version_result: AgentResult<ProbeResult> = async {
        let path = executable(candidate).await?;
        run(
            path,
            command(&["--version"]),
            ProbeOptions {
                env: Some(probe_environment.clone()),
                signal: signal.clone(),
                timeout_ms: CURSOR_VERSION_PROBE_TIMEOUT_MS,
                label: "Cursor version probe".into(),
                ..Default::default()
            },
        )
        .await
    }
    .await;
    let version_result = match version_result {
        Ok(result) => result,
        Err(error) => return broken_cursor(source, Some(error.message)),
    };
    let version = parse_cursor_local_version(&format!(
        "{}\n{}",
        version_result.stdout, version_result.stderr
    ));
    let Some(version) = version.filter(|_| version_result.code == Some(0)) else {
        return broken_cursor(
            source,
            Some(probe_failure_diagnostic("version", &version_result)),
        );
    };
    let mut authentication: &str;
    let mut diagnostic: Option<String> = None;
    let mut exit_code: Option<i32> = None;
    let mut exit_signal: Option<String> = None;
    let mut failure: Option<&str> = None;
    let status: AgentResult<ProbeResult> = async {
        let path = executable(candidate).await?;
        run(
            path,
            command(&["status"]),
            ProbeOptions {
                env: Some(probe_environment.clone()),
                signal: signal.clone(),
                timeout_ms: CURSOR_STATUS_PROBE_TIMEOUT_MS,
                label: "Cursor status probe".into(),
                ..Default::default()
            },
        )
        .await
    }
    .await;
    match status {
        Ok(result) => {
            authentication =
                parse_cursor_authentication(&format!("{}\n{}", result.stdout, result.stderr));
            exit_code = result.code;
            exit_signal = result.signal.clone();
            if result.code != Some(0) && !matches!(authentication, "signed-out" | "expired") {
                authentication = "error";
            }
            if matches!(authentication, "error" | "unknown") {
                diagnostic = Some(probe_failure_diagnostic("status", &result));
            }
            if authentication == "error" {
                failure = Some(
                    if result.signal.is_some() || result.code.is_some_and(|code| code >= 128) {
                        "crashed"
                    } else {
                        "failed"
                    },
                );
            }
        }
        Err(error) => {
            authentication = "error";
            failure = Some(if TIMED_OUT.is_match(&error.message) {
                "timed-out"
            } else {
                "failed"
            });
            diagnostic = Some(error.message);
        }
    }
    base_cursor(source)
        .set("installation", "detected")
        .set("version", version)
        .set("authentication", authentication)
        .opt("authenticationDiagnostic", diagnostic)
        .opt("authenticationExitCode", exit_code)
        .opt("authenticationSignal", exit_signal)
        .opt("authenticationFailure", failure)
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    #[test]
    fn normalizes_cursor_versions_plus_negative_first_authentication() {
        assert_eq!(
            parse_cursor_local_version("2026.07.09-a3815c0").as_deref(),
            Some("2026.07.09-a3815c0")
        );
        assert_eq!(
            parse_cursor_authentication("Not authenticated. Run cursor-agent login."),
            "signed-out"
        );
        assert_eq!(
            parse_cursor_authentication("Not authenticated: credentials expired."),
            "expired"
        );
        assert_eq!(
            parse_cursor_authentication("Authenticated as local@example.test"),
            "signed-in"
        );
        assert_eq!(
            parse_cursor_authentication("ERROR: SecItemCopyMatching failed -50"),
            "error"
        );
        assert_eq!(json!(parse_cursor_authentication("")), json!("unknown"));
    }
}
