//! `runtimes/puppyone-agent/puppyone-agent-discovery.mjs`: only PuppyOne's
//! bundled worker; there is deliberately no PATH fallback.
use super::puppyone_agent_environment::build_puppyone_agent_environment;
use super::puppyone_agent_identity::PUPPYONE_AGENT_RUNTIME_ID;
use super::puppyone_agent_kernel::{
    PUPPYONE_PI_KERNEL, PUPPYONE_PI_KERNEL_PROTOCOL, PUPPYONE_PI_KERNEL_VERSION,
};
use super::puppyone_agent_public_identity::BUILT_IN_AGENT_DISPLAY_NAME;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::connections::runtime_discovery_cache::{CacheOptions, CachedRuntimeDiscovery};
use crate::agent::contract::js::{self, Obj};
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::tasks::CancelSignal;
use crate::agent::transports::executable_discovery::{BoundedRun, RunBounded, run_bounded};
use crate::platform::paths;
use crate::text;
use serde_json::{Value, json};
use std::rc::Rc;

/// The bundled worker below the application root.
pub const PUPPYONE_AGENT_WORKER_PATH: &str =
    "electron/main/agent/runtimes/puppyone-agent/worker/main.mjs";

/// `discoverPuppyOneAgentWorker({ … })` inputs.
#[derive(Clone, Default)]
pub struct PuppyOneDiscoveryOptions {
    pub app_path: Option<String>,
    pub user_data_path: Option<String>,
    pub executable_path: Option<String>,
    pub env: Option<EnvMap>,
    pub platform: Option<String>,
    pub probe: Option<RunBounded>,
}

/// `createPuppyOneAgentDiscovery({ cache, ...discoveryOptions })`.
pub fn create_puppyone_agent_discovery(
    options: PuppyOneDiscoveryOptions,
    cache: Option<CacheOptions>,
) -> CachedRuntimeDiscovery {
    CachedRuntimeDiscovery::new(
        Rc::new(move |signal| {
            let options = options.clone();
            Box::pin(async move { discover_puppyone_agent_worker(options, Some(signal)).await })
        }),
        cache,
    )
}

/// `discoverPuppyOneAgentWorker(options)`.
pub async fn discover_puppyone_agent_worker(
    options: PuppyOneDiscoveryOptions,
    signal: Option<CancelSignal>,
) -> AgentResult<Value> {
    let worker_path = options.app_path.as_deref().map(|app| {
        paths::resolve(app, PUPPYONE_AGENT_WORKER_PATH)
            .to_string_lossy()
            .into_owned()
    });
    let profile_path = options.user_data_path.as_deref().map(|data| {
        paths::resolve(data, "agent-runtime/puppyone-agent")
            .to_string_lossy()
            .into_owned()
    });
    let platform = options.platform.clone().unwrap_or_else(|| {
        crate::agent::discovery::bounded_process_probe::node_platform().to_string()
    });
    let base_env = options
        .env
        .clone()
        .unwrap_or_else(|| std::env::vars().collect());
    let environment = match profile_path.as_deref() {
        Some(profile) => build_puppyone_agent_environment(&base_env, profile, &platform)?,
        None => EnvMap::new(),
    };
    let executable_path = options
        .executable_path
        .clone()
        .filter(|path| paths::is_absolute(path));
    let base = json!({
        "provider": PUPPYONE_AGENT_RUNTIME_ID,
        "runtimeId": PUPPYONE_AGENT_RUNTIME_ID,
        "source": "bundled",
        "pinnedVersion": PUPPYONE_PI_KERNEL["version"],
        "upstreamCommit": PUPPYONE_PI_KERNEL["sourceCommit"],
        "executablePath": executable_path,
        "argsPrefix": worker_path.iter().collect::<Vec<_>>(),
        "environment": environment,
        "version": null,
        "compatibility": "unavailable",
    });
    let probed = async {
        if let Some(signal) = signal.as_ref() {
            signal.check()?;
        }
        let (Some(worker), Some(profile), Some(executable)) =
            (worker_path.as_ref(), profile_path.as_ref(), executable_path.as_ref())
        else {
            return Err(AgentError::new(format!(
                "{BUILT_IN_AGENT_DISPLAY_NAME} launch paths are unavailable."
            )));
        };
        let metadata = std::fs::symlink_metadata(worker)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(AgentError::new(format!(
                "The bundled {BUILT_IN_AGENT_DISPLAY_NAME} worker is invalid."
            )));
        }
        let run = BoundedRun {
            file: executable.clone(),
            args: vec![worker.clone(), "--probe".into()],
            env: environment.clone(),
            timeout_ms: 8_000,
            max_bytes: 64 * 1024,
            label: format!("{BUILT_IN_AGENT_DISPLAY_NAME} Pi SDK"),
            signal: signal.clone(),
        };
        let probe = match options.probe.as_ref() {
            Some(probe) => probe(run).await?,
            None => run_bounded(None, run).await?,
        };
        let result = parse_puppyone_worker_probe(&probe.stdout)?;
        if probe.code != Some(0) || result["ready"] != true {
            return Err(AgentError::new(if probe.stderr.is_empty() {
                "The bundled Pi SDK worker rejected its version probe.".to_string()
            } else {
                probe.stderr.clone()
            }));
        }
        let version = js::to_js_string(result.get("version"));
        if version != PUPPYONE_PI_KERNEL_VERSION || result["protocol"] != PUPPYONE_PI_KERNEL_PROTOCOL {
            let found = if version.is_empty() {
                "an unknown version".to_string()
            } else {
                version.clone()
            };
            return Ok(Obj::from(&base)
                .set("version", version)
                .set("status", "unsupported-version")
                .set("code", "RUNTIME_VERSION_UNSUPPORTED")
                .set(
                    "message",
                    format!(
                        "{BUILT_IN_AGENT_DISPLAY_NAME} expected Pi SDK {PUPPYONE_PI_KERNEL_VERSION}, but found {found}."
                    ),
                )
                .build());
        }
        Ok(Obj::from(&base)
            .set("version", version)
            .set("status", "ready")
            .set("code", "READY")
            .set("message", format!("{BUILT_IN_AGENT_DISPLAY_NAME} is ready."))
            .set("compatibility", PUPPYONE_PI_KERNEL_PROTOCOL)
            .set("workerPath", worker.clone())
            .set("profilePath", profile.clone())
            .build())
    }
    .await;
    match probed {
        Ok(readiness) => Ok(readiness),
        Err(error) => {
            if let Some(signal) = signal.as_ref() {
                signal.check()?;
            }
            Ok(Obj::from(&base)
                .set("status", "error")
                .set("code", "RUNTIME_DISCOVERY_FAILED")
                .set(
                    "message",
                    "This PuppyOne build could not start its managed Agent kernel. Update or reinstall PuppyOne, then retry.",
                )
                .set("diagnostic", redact_secret_text(&error.message))
                .build())
        }
    }
}

/// `parsePuppyOneWorkerProbe(value)`.
pub fn parse_puppyone_worker_probe(value: &str) -> AgentResult<Value> {
    let lines: Vec<&str> = value
        .trim()
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .filter(|line| !line.is_empty())
        .collect();
    if lines.len() != 1 || text::len16(lines[0]) > 4_000 {
        return Err(AgentError::new(format!(
            "{BUILT_IN_AGENT_DISPLAY_NAME} worker returned an invalid probe."
        )));
    }
    let result: Value = serde_json::from_str(lines[0])
        .map_err(|error| AgentError::new(error.to_string()).with_name("SyntaxError"))?;
    if result.get("schema").and_then(Value::as_str) != Some("puppyone-pi-worker-probe/v1")
        || result.get("product").and_then(Value::as_str) != Some(PUPPYONE_AGENT_RUNTIME_ID)
        || !result.get("version").is_some_and(Value::is_string)
        || !result.get("protocol").is_some_and(Value::is_string)
        || !result.get("ready").is_some_and(Value::is_boolean)
    {
        return Err(AgentError::new(format!(
            "{BUILT_IN_AGENT_DISPLAY_NAME} worker probe did not match its contract."
        )));
    }
    Ok(result)
}
