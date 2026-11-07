//! `runtimes/hermes/hermes-discovery.mjs`.
use crate::agent::agent_error::AgentResult;
use crate::agent::agent_events::redact_secret_text;
use crate::agent::connections::runtime_discovery_cache::{CacheOptions, CachedRuntimeDiscovery};
use crate::agent::contract::js::{self, Obj};
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::discovery::executable_discovery_port::ReadEnvironment;
use crate::agent::tasks::CancelSignal;
use crate::agent::transports::bounded_process_probe::ProbeRunner;
use crate::agent::transports::executable_discovery::{
    BoundedRun, DiscoverExecutableOptions, DiscoverFn, RunBounded, build_agent_environment,
    discover_executable, environment_map, parse_semantic_version, run_bounded,
};
use crate::text;
use regex::Regex;
use serde_json::Value;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::LazyLock;

pub const MINIMUM_HERMES_ACP_VERSION: &str = "0.16.0";
/// `hermesDiscoveryLimits`.
pub mod limits {
    pub const ACP_CHECK_TIMEOUT_MS: u64 = 8_000;
    pub const ACP_CHECK_MAX_BYTES: usize = 64 * 1024;
}

static CHECK_OK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Hermes ACP check OK").expect("pattern"));

/// `discoverHermesExecutable({ … })` inputs.
#[derive(Clone, Default)]
pub struct HermesDiscoveryOptions {
    pub env: Option<EnvMap>,
    pub platform: Option<String>,
    pub homedir: Option<PathBuf>,
    pub read_environment: Option<ReadEnvironment>,
    pub run_probe: Option<ProbeRunner>,
    pub configured_executable: Option<String>,
    pub discover: Option<DiscoverFn>,
    pub probe: Option<RunBounded>,
}

/// `createHermesDiscovery({ cache, ...discoveryOptions })`.
pub fn create_hermes_discovery(
    options: HermesDiscoveryOptions,
    cache: Option<CacheOptions>,
) -> CachedRuntimeDiscovery {
    CachedRuntimeDiscovery::new(
        Rc::new(move |signal| {
            let options = options.clone();
            Box::pin(async move { discover_hermes_executable(options, Some(signal)).await })
        }),
        cache,
    )
}

/// `discoverHermesExecutable(options)`.
pub async fn discover_hermes_executable(
    options: HermesDiscoveryOptions,
    signal: Option<CancelSignal>,
) -> AgentResult<Value> {
    let mut discovery =
        DiscoverExecutableOptions::new("Hermes Agent", Rc::new(parse_hermes_version));
    discovery.installation_id = Some("hermes".into());
    discovery.additional_candidates = options.configured_executable.clone().into_iter().collect();
    discovery.env = options.env.clone();
    discovery.platform = options.platform.clone();
    discovery.homedir = options.homedir.clone();
    discovery.read_environment = options.read_environment.clone();
    discovery.run_probe = options.run_probe.clone();
    discovery.signal = signal.clone();
    discovery.minimum_version = Some(MINIMUM_HERMES_ACP_VERSION.into());
    discovery.build_environment = Some(Rc::new(|base, login, _homedir, platform| {
        build_hermes_environment(base, login, platform)
    }));
    let discovered = match options.discover.as_ref() {
        Some(discover) => discover(discovery).await?,
        None => discover_executable(discovery).await?,
    };
    let mut readiness = discovered.clone();
    let executable_path = discovered
        .get("executablePath")
        .and_then(Value::as_str)
        .filter(|p| !p.is_empty());
    if discovered["status"] == "ready"
        && let Some(executable_path) = executable_path
    {
        let mut args: Vec<String> = discovered["argsPrefix"]
            .as_array()
            .map(|args| {
                args.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        args.extend(["acp".to_string(), "--check".to_string()]);
        let run = BoundedRun {
            file: executable_path.to_string(),
            args,
            env: environment_map(discovered.get("environment")),
            timeout_ms: limits::ACP_CHECK_TIMEOUT_MS,
            max_bytes: limits::ACP_CHECK_MAX_BYTES,
            label: "Hermes ACP".into(),
            signal: signal.clone(),
        };
        let probe = match options.probe.as_ref() {
            Some(probe) => probe(run).await,
            None => run_bounded(options.run_probe.clone(), run).await,
        };
        match probe {
            Ok(result) => {
                let output = format!("{}\n{}", result.stdout, result.stderr);
                if result.code != Some(0) || !CHECK_OK.is_match(&output) {
                    readiness = Obj::from(&discovered)
                        .set("status", "protocol-unavailable")
                        .set("code", "PROTOCOL_UNAVAILABLE")
                        .set(
                            "message",
                            "Hermes Agent is installed, but its official ACP dependencies are unavailable. Run `hermes acp --check` in a terminal.",
                        )
                        .set("diagnostic", text::head16(output.trim(), 4_000))
                        .build();
                }
            }
            Err(error) => {
                if let Some(signal) = signal.as_ref() {
                    signal.check()?;
                }
                readiness = Obj::from(&discovered)
                    .set("status", "protocol-unavailable")
                    .set("code", "PROTOCOL_PROBE_FAILED")
                    .set(
                        "message",
                        "Hermes Agent could not verify its official ACP endpoint. Run `hermes acp --check` in a terminal.",
                    )
                    .set("diagnostic", error.message)
                    .build();
            }
        }
    }
    Ok(runtime_readiness("hermes", &discovered, &readiness, true))
}

/// `{ provider, runtimeId, source, compatibility, ...readiness, selectable?, message, diagnostic? }`.
pub(crate) fn runtime_readiness(
    runtime_id: &str,
    discovered: &Value,
    readiness: &Value,
    selectable: bool,
) -> Value {
    let ready = readiness["status"] == "ready";
    let installed = discovered.get("executablePath").is_some_and(js::truthy);
    let diagnostic = readiness
        .get("diagnostic")
        .filter(|d| js::truthy(d))
        .map(|d| redact_secret_text(&js::to_js_string(Some(d))));
    Obj::new()
        .set("provider", runtime_id)
        .set("runtimeId", runtime_id)
        .set(
            "source",
            if installed {
                "user-installed"
            } else {
                "missing"
            },
        )
        .set(
            "compatibility",
            if ready { "acp-v1" } else { "unavailable" },
        )
        .spread(readiness)
        .opt("selectable", selectable.then_some(ready))
        .set(
            "message",
            redact_secret_text(&js::to_js_string(readiness.get("message"))),
        )
        .opt("diagnostic", diagnostic)
        .build()
}

/// `parseHermesVersion(value)`.
pub fn parse_hermes_version(value: &str) -> Option<String> {
    parse_semantic_version(value, "")
}

/// `buildHermesEnvironment(baseEnv, loginEnv, options)`.
pub fn build_hermes_environment(base: &EnvMap, login: &EnvMap, platform: &str) -> EnvMap {
    let mut environment = build_agent_environment(base, login, platform);
    environment.insert("PUPPYONE_AGENT_BACKEND".into(), "hermes".into());
    environment
}
