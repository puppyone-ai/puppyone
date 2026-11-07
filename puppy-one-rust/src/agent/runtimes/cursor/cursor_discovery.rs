//! `runtimes/cursor/cursor-discovery.mjs`.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::connections::probes::cursor_local_probe::probe_cursor_local;
use crate::agent::connections::runtime_discovery_cache::{CacheOptions, CachedRuntimeDiscovery};
use crate::agent::contract::js::Obj;
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::discovery::executable_discovery_port::{
    DiscoveryPortOptions, ExecutableDiscoveryPort, ReadEnvironment,
};
use crate::agent::installation::executable_resolver::{
    LocalAgentExecutableResolver, Observation, ResolvedCandidate,
};
use crate::agent::tasks::CancelSignal;
use crate::agent::transports::bounded_process_probe::ProbeRunner;
use futures_util::future::LocalBoxFuture;
use serde_json::Value;
use std::path::PathBuf;
use std::rc::Rc;

/// `discoverCursorBackend({ … })` inputs.
#[derive(Clone, Default)]
pub struct CursorDiscoveryOptions {
    pub env: Option<EnvMap>,
    pub platform: Option<String>,
    pub homedir: Option<PathBuf>,
    pub read_environment: Option<ReadEnvironment>,
    /// `probe`'s command runner (skips identity checks when given).
    pub run_command: Option<ProbeRunner>,
    /// `resolveCandidate()`.
    pub resolve_candidate: Option<ResolveCandidate>,
    /// `probe({ candidate, env, signal })`.
    pub probe: Option<CursorProbe>,
}

/// `resolveCandidate()`.
pub type ResolveCandidate =
    Rc<dyn Fn() -> LocalBoxFuture<'static, AgentResult<Option<ResolvedCandidate>>>>;

/// `probe({ candidate, env, signal })`.
pub type CursorProbe =
    Rc<dyn Fn(Option<ResolvedCandidate>, EnvMap) -> LocalBoxFuture<'static, Value>>;

/// `createCursorDiscovery({ cache, ...discoveryOptions })`.
pub fn create_cursor_discovery(
    options: CursorDiscoveryOptions,
    cache: Option<CacheOptions>,
) -> CachedRuntimeDiscovery {
    CachedRuntimeDiscovery::new(
        Rc::new(move |signal| {
            let options = options.clone();
            Box::pin(async move { discover_cursor_backend(options, Some(signal)).await })
        }),
        cache,
    )
}

fn environment_value(environment: &EnvMap) -> Value {
    Value::Object(
        environment
            .iter()
            .map(|(key, value)| (key.clone(), Value::from(value.as_str())))
            .collect(),
    )
}

/// `discoverCursorBackend(options)`.
pub async fn discover_cursor_backend(
    options: CursorDiscoveryOptions,
    signal: Option<CancelSignal>,
) -> AgentResult<Value> {
    if let Some(signal) = signal.as_ref() {
        signal.check()?;
    }
    let env = options
        .env
        .clone()
        .unwrap_or_else(|| std::env::vars().collect());
    let candidate = match options.resolve_candidate.as_ref() {
        Some(resolve) => resolve().await?,
        None => {
            let resolver = LocalAgentExecutableResolver::new(
                None,
                ExecutableDiscoveryPort::new(DiscoveryPortOptions {
                    node_platform: options.platform.clone(),
                    env: Some(env.clone()),
                    homedir: options.homedir.clone(),
                    read_environment: options.read_environment.clone(),
                    find_registered_applications: None,
                }),
            );
            let context = resolver.create_context(signal.clone()).await?;
            match resolver
                .resolve("cursor", Some(context), Vec::new())
                .await?
            {
                Observation::Failed { reason_code } => return Err(AgentError::new(reason_code)),
                Observation::Found { candidate, .. } => Some(*candidate),
                Observation::NotFound { .. } => None,
            }
        }
    };
    let environment = candidate
        .as_ref()
        .and_then(|c| c.environment.clone())
        .unwrap_or_else(|| env.clone());
    let result = match options.probe.as_ref() {
        Some(probe) => probe(candidate.clone(), environment.clone()).await,
        None => {
            probe_cursor_local(
                candidate.as_ref(),
                options.run_command.clone(),
                &environment,
                signal,
            )
            .await
        }
    };
    let field = |key: &str| result.get(key).and_then(Value::as_str);
    let base = Obj::new()
        .set("runtimeId", "cursor")
        .set("provider", "cursor")
        .set(
            "version",
            result.get("version").cloned().unwrap_or(Value::Null),
        )
        .set("minimumVersion", Value::Null)
        .set(
            "executablePath",
            candidate.as_ref().map(|c| c.executable_path.clone()),
        )
        .set(
            "argsPrefix",
            candidate
                .as_ref()
                .map(|c| c.args_prefix.clone())
                .unwrap_or_default(),
        )
        .set("environment", environment_value(&environment))
        .set(
            "source",
            result
                .get("source")
                .filter(|s| !s.is_null())
                .cloned()
                .unwrap_or_else(|| {
                    Value::from(if candidate.is_some() {
                        "user-installed"
                    } else {
                        "missing"
                    })
                }),
        )
        .set("compatibility", "acp-v1");
    let diagnostic = |key: &str| field(key).filter(|d| !d.is_empty()).map(redact_secret_text);
    if field("installation") == Some("not-found") {
        return Ok(base
            .set("status", "not-installed")
            .set("code", "RUNTIME_NOT_INSTALLED")
            .set("message", "Cursor Agent was not found.")
            .build());
    }
    if field("installation") != Some("detected") {
        return Ok(base
            .set("status", "error")
            .set("code", "RUNTIME_DISCOVERY_FAILED")
            .set(
                "message",
                "Cursor Agent was detected, but its installation could not be inspected safely.",
            )
            .opt("diagnostic", diagnostic("diagnostic"))
            .build());
    }
    match field("authentication") {
        Some("signed-out") => Ok(base
            .set("status", "installed-not-authenticated")
            .set("code", "AUTHENTICATION_REQUIRED")
            .set("selectable", false)
            .set(
                "message",
                "Cursor Agent is installed; sign in with Cursor before starting its ACP Agent.",
            )
            .build()),
        Some("expired") => Ok(base
            .set("status", "installed-not-authenticated")
            .set("code", "AUTHENTICATION_EXPIRED")
            .set("selectable", false)
            .set(
                "message",
                "Cursor Agent's local sign-in has expired. Sign in again, then retry.",
            )
            .build()),
        Some("error") => {
            let (code, message) = match field("authenticationFailure") {
                Some("crashed") => (
                    "AUTHENTICATION_PROBE_CRASHED",
                    "Cursor Agent's sign-in command crashed before it could report the authentication state.",
                ),
                Some("timed-out") => (
                    "AUTHENTICATION_PROBE_TIMED_OUT",
                    "Cursor Agent's sign-in command timed out before it could report the authentication state.",
                ),
                _ => (
                    "AUTHENTICATION_PROBE_FAILED",
                    "Cursor Agent's sign-in command failed, so PuppyOne could not verify the authentication state.",
                ),
            };
            Ok(base
                .set("status", "error")
                .set("code", code)
                .set("selectable", false)
                .set("inspectionFallback", "runtime-handshake")
                .set("message", message)
                .opt("diagnostic", diagnostic("authenticationDiagnostic"))
                .build())
        }
        Some("signed-in") => {
            let version = field("version").unwrap_or("");
            Ok(base
                .set("status", "ready")
                .set("code", "READY")
                .set("selectable", true)
                .set(
                    "message",
                    format!("Cursor Agent {version} is ready through ACP.")
                        .trim()
                        .to_string(),
                )
                .build())
        }
        _ => Ok(base
            .set("status", "error")
            .set("code", "AUTHENTICATION_STATUS_UNKNOWN")
            .set("selectable", false)
            .set("inspectionFallback", "runtime-handshake")
            .set(
                "message",
                "Cursor Agent returned an unrecognized sign-in status.",
            )
            .opt("diagnostic", diagnostic("authenticationDiagnostic"))
            .build()),
    }
}
