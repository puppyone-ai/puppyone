//! `connections/probes/codex-local-probe.mjs`: the Codex CLI's version, and
//! its app-server's account and model evidence through a short-lived
//! inventory connection.
use super::bounded_probe_command::{create_probe_environment, run_bounded_probe_command};
use super::executable_candidates::assert_executable_identity;
use super::versioned_local_agent_probe::normalize_probe_source;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::{self, Obj};
use crate::agent::event_loop::AbortSignal;
use crate::agent::node_path;
use crate::agent::transports::bounded_process_probe::{ProbeOptions, ProbeRunner};
use crate::agent::transports::jsonl_rpc_connection::{
    ConnectionEvent, ConnectionOptions, RequestOptions,
};
use crate::agent::transports::rpc_connection::{ConnectionFactory, jsonl_rpc_connection_factory};
use crate::platform::common::command_environment::EnvMap;
use crate::platform::local_agent_installation::executable_resolver::ResolvedCandidate;
use futures_util::future::LocalBoxFuture;
use regex::Regex;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::LazyLock;

/// `MIN_LOCAL_CODEX_VERSION`.
pub const MIN_LOCAL_CODEX_VERSION: &str = "0.144.1";

static VERSION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:codex(?:-cli)?\s+)?(\d+\.\d+\.\d+)").expect("pattern"));

/// `parseCodexLocalVersion(value)`.
pub fn parse_codex_local_version(value: &str) -> Option<String> {
    VERSION
        .captures(value)
        .map(|captures| captures[1].to_string())
}

/// `inspectCodexProtocol({ candidate, appVersion, workspaceRoot, env, signal, connectionFactory })`.
#[derive(Clone)]
pub struct InspectRequest {
    pub candidate: ResolvedCandidate,
    pub app_version: String,
    pub workspace_root: Option<String>,
    pub env: EnvMap,
    pub signal: Option<AbortSignal>,
    pub connection_factory: Option<ConnectionFactory>,
}

/// `inspectProtocol(request)`.
pub type InspectProtocol =
    Rc<dyn Fn(InspectRequest) -> LocalBoxFuture<'static, AgentResult<Value>>>;

/// `probeCodexLocal({ … })` inputs. A supplied `run_command` stands in for
/// the process and skips identity checks.
#[derive(Clone, Default)]
pub struct CodexProbeOptions {
    pub candidate: Option<ResolvedCandidate>,
    pub run_command: Option<ProbeRunner>,
    pub inspect_protocol: Option<InspectProtocol>,
    pub app_version: Option<String>,
    pub workspace_root: Option<String>,
    pub env: Option<EnvMap>,
    pub signal: Option<AbortSignal>,
}

fn base_codex(source: Option<&str>) -> Obj {
    Obj::new()
        .set("id", "codex")
        .set("displayName", "Codex")
        .set("authentication", "unknown")
        .set("protocolCompatible", false)
        .set("hasModels", false)
        .set("source", normalize_probe_source(source))
}

fn missing_codex() -> Value {
    base_codex(None)
        .set("installation", "not-found")
        .set("version", Value::Null)
        .build()
}

fn broken_codex(source: Option<&str>) -> Value {
    base_codex(source)
        .set("installation", "broken")
        .set("version", Value::Null)
        .set("authentication", "error")
        .build()
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

/// `compareVersions(left, right)`.
fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    let parts = |value: &str| -> Vec<f64> {
        value
            .split('.')
            .map(|part| part.parse::<f64>().unwrap_or(f64::NAN))
            .collect()
    };
    let (left, right) = (parts(left), parts(right));
    for index in 0..left.len().max(right.len()) {
        let value = |parts: &[f64]| {
            parts
                .get(index)
                .copied()
                .filter(|v| !v.is_nan() && *v != 0.0)
                .unwrap_or(0.0)
        };
        let difference = value(&left) - value(&right);
        if difference != 0.0 {
            return if difference < 0.0 {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
    }
    std::cmp::Ordering::Equal
}

/// `probeCodexLocal(options)`.
pub async fn probe_codex_local(options: CodexProbeOptions) -> Value {
    let Some(candidate) = options.candidate.clone() else {
        return missing_codex();
    };
    let source = Some(candidate.source.as_str());
    let env = options
        .env
        .clone()
        .unwrap_or_else(|| std::env::vars().collect());
    let checked = options.run_command.is_none();
    let probe = async {
        let executable_path = if checked {
            assert_executable_identity(&candidate).await?
        } else {
            candidate.executable_path.clone()
        };
        let mut args = candidate.args_prefix.clone();
        args.push("--version".into());
        let probe_options = ProbeOptions {
            env: Some(create_probe_environment(&env)),
            signal: options.signal.clone(),
            ..Default::default()
        };
        let result = match options.run_command.as_ref() {
            Some(run) => run(executable_path.clone(), args, probe_options).await?,
            None => run_bounded_probe_command(&executable_path, &args, probe_options).await?,
        };
        Ok::<_, AgentError>((executable_path, result))
    }
    .await;
    let Ok((executable_path, result)) = probe else {
        return broken_codex(source);
    };
    let Some(version) = parse_codex_local_version(&format!("{}\n{}", result.stdout, result.stderr))
        .filter(|_| result.code == Some(0))
    else {
        return broken_codex(source);
    };
    if compare_versions(&version, MIN_LOCAL_CODEX_VERSION).is_lt() {
        return base_codex(source)
            .set("installation", "unsupported")
            .set("version", version)
            .build();
    }
    let protocol = async {
        let protocol_executable = if checked {
            assert_executable_identity(&candidate).await?
        } else {
            executable_path
        };
        let request = InspectRequest {
            candidate: ResolvedCandidate {
                executable_path: protocol_executable,
                ..candidate.clone()
            },
            app_version: options
                .app_version
                .clone()
                .unwrap_or_else(|| "0.0.0".into()),
            workspace_root: Some(
                options
                    .workspace_root
                    .clone()
                    .unwrap_or_else(|| node_path::homedir().to_string_lossy().into_owned()),
            ),
            env: create_probe_environment(&env),
            signal: options.signal.clone(),
            connection_factory: None,
        };
        match options.inspect_protocol.as_ref() {
            Some(inspect) => inspect(request).await,
            None => inspect_codex_protocol(request).await,
        }
    }
    .await
    .unwrap_or_else(
        |_| json!({ "authentication": "error", "protocolCompatible": false, "hasModels": false }),
    );
    base_codex(source)
        .set("installation", "detected")
        .set("version", version)
        .set(
            "authentication",
            normalize_authentication(protocol.get("authentication")),
        )
        .set(
            "protocolCompatible",
            protocol.get("protocolCompatible") == Some(&Value::Bool(true)),
        )
        .set(
            "hasModels",
            protocol.get("hasModels") == Some(&Value::Bool(true)),
        )
        .build()
}

fn cancelled() -> AgentError {
    AgentError::new("Codex inventory probe was cancelled.")
}

/// `inspectCodexProtocol(request)`: `initialize`, then `account/read` and
/// `model/list` on a bounded connection that refuses server requests.
pub async fn inspect_codex_protocol(request: InspectRequest) -> AgentResult<Value> {
    if request.signal.as_ref().is_some_and(AbortSignal::aborted) {
        return Err(cancelled());
    }
    let factory = request
        .connection_factory
        .clone()
        .unwrap_or_else(jsonl_rpc_connection_factory);
    let mut args = request.candidate.args_prefix.clone();
    args.extend(["app-server", "--listen", "stdio://"].map(str::to_string));
    let connection = factory(ConnectionOptions {
        executable_path: PathBuf::from(&request.candidate.executable_path),
        args,
        cwd: PathBuf::from(
            request
                .workspace_root
                .clone()
                .filter(|root| !root.is_empty())
                .unwrap_or_else(|| node_path::homedir().to_string_lossy().into_owned()),
        ),
        env: Some(request.env.clone().into_iter().collect()),
        max_line_bytes: Some(256 * 1024),
        max_stderr_bytes: Some(16 * 1024),
        max_pending: Some(4),
        force_kill_timeout_ms: Some(250),
        spawner: None,
        bootstrap: None,
    })?;
    {
        let target = Rc::downgrade(&connection);
        connection.on(Rc::new(move |event| {
            if let ConnectionEvent::Request(message) = event
                && let Some(id) = message.get("id")
                && let Some(connection) = target.upgrade()
            {
                let _ = connection.respond_error(
                    id.clone(),
                    -32601,
                    "Inventory probes do not accept server requests.",
                );
            }
        }));
    }
    let listener = request.signal.as_ref().map(|signal| {
        let target = Rc::downgrade(&connection);
        signal.add_listener(move || {
            if let Some(connection) = target.upgrade() {
                connection.dispose("Codex inventory probe cancelled.", false);
            }
        })
    });
    let options = || RequestOptions {
        timeout_ms: Some(1_500),
        ..Default::default()
    };
    let result = async {
        if request.signal.as_ref().is_some_and(AbortSignal::aborted) {
            connection.dispose("Codex inventory probe cancelled.", false);
            return Err(cancelled());
        }
        connection
            .request(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "puppyone_desktop_inventory",
                        "title": "PuppyOne Desktop",
                        "version": js::head16(
                            if request.app_version.is_empty() { "0.0.0" } else { &request.app_version },
                            80,
                        ),
                    },
                    "capabilities": { "experimentalApi": false, "requestAttestation": false },
                }),
                options(),
            )
            .await?;
        connection.notify("initialized", None)?;
        let (account, models) = futures_util::join!(
            connection.request("account/read", json!({ "refreshToken": false }), options()),
            connection.request(
                "model/list",
                json!({ "includeHidden": false, "limit": 1 }),
                options()
            ),
        );
        Ok(json!({
            "authentication": match account {
                Ok(account) => codex_authentication(&account),
                Err(_) => "error",
            },
            "protocolCompatible": true,
            "hasModels": models.is_ok_and(|models| {
                models.get("data").and_then(Value::as_array).is_some_and(|data| !data.is_empty())
            }),
        }))
    }
    .await;
    if let (Some(signal), Some(listener)) = (request.signal.as_ref(), listener) {
        signal.remove_listener(listener);
    }
    connection.dispose("Codex inventory probe complete.", false);
    result
}

fn codex_authentication(result: &Value) -> &'static str {
    if result.get("account").is_some_and(Value::is_object) {
        "signed-in"
    } else if result.get("requiresOpenaiAuth") == Some(&Value::Bool(true)) {
        "signed-out"
    } else {
        "unknown"
    }
}
