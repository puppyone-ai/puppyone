//! `runtimes/opencode-native/opencode-native-discovery.mjs`: the user's
//! OpenCode installation.
use crate::agent::agent_error::AgentResult;
use crate::agent::connections::runtime_discovery_cache::{CacheOptions, CachedRuntimeDiscovery};
use crate::agent::contract::js::{self, Obj};
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::discovery::executable_discovery_port::ReadEnvironment;
use crate::agent::event_loop::AbortSignal;
use crate::agent::runtimes::hermes::hermes_discovery::runtime_readiness;
use crate::agent::runtimes::opencode_protocol::opencode_security_policy::OPEN_CODE_HOST_SAFETY_ENVIRONMENT;
use crate::agent::runtimes::opencode_protocol::opencode_version::parse_open_code_version;
use crate::agent::transports::bounded_process_probe::ProbeRunner;
use crate::agent::transports::executable_discovery::{
    BoundedRun, DiscoverExecutableOptions, DiscoverFn, RunBounded, build_agent_environment,
    discover_executable, environment_map, run_bounded,
};
use serde_json::Value;
use std::path::PathBuf;
use std::rc::Rc;

/// `discoverUserOpenCodeExecutable({ … })` inputs.
#[derive(Clone, Default)]
pub struct OpenCodeDiscoveryOptions {
    pub env: Option<EnvMap>,
    pub platform: Option<String>,
    pub homedir: Option<PathBuf>,
    pub read_environment: Option<ReadEnvironment>,
    pub run_probe: Option<ProbeRunner>,
    pub configured_executable: Option<String>,
    pub discover: Option<DiscoverFn>,
    pub probe: Option<RunBounded>,
}

/// `createUserOpenCodeDiscovery({ cache, ...discoveryOptions })`.
pub fn create_user_open_code_discovery(
    options: OpenCodeDiscoveryOptions,
    cache: Option<CacheOptions>,
) -> CachedRuntimeDiscovery {
    CachedRuntimeDiscovery::new(
        Rc::new(move |signal| {
            let options = options.clone();
            Box::pin(async move { discover_user_open_code_executable(options, Some(signal)).await })
        }),
        cache,
    )
}

/// `discoverUserOpenCodeExecutable(options)`.
pub async fn discover_user_open_code_executable(
    options: OpenCodeDiscoveryOptions,
    signal: Option<AbortSignal>,
) -> AgentResult<Value> {
    let mut discovery =
        DiscoverExecutableOptions::new("OpenCode", Rc::new(parse_open_code_version));
    discovery.installation_id = Some("opencode".into());
    discovery.additional_candidates = options.configured_executable.clone().into_iter().collect();
    discovery.env = options.env.clone();
    discovery.platform = options.platform.clone();
    discovery.homedir = options.homedir.clone();
    discovery.read_environment = options.read_environment.clone();
    discovery.run_probe = options.run_probe.clone();
    discovery.signal = signal.clone();
    discovery.build_environment = Some(Rc::new(|base, login, _homedir, platform| {
        build_user_open_code_environment(base, login, platform)
    }));
    let result = match options.discover.as_ref() {
        Some(discover) => discover(discovery).await?,
        None => discover_executable(discovery).await?,
    };
    let mut readiness = result.clone();
    if result["status"] == "ready"
        && let Some(executable_path) = result
            .get("executablePath")
            .and_then(Value::as_str)
            .filter(|p| !p.is_empty())
    {
        let run = BoundedRun {
            file: executable_path.to_string(),
            args: vec!["acp".into(), "--help".into()],
            env: environment_map(result.get("environment")),
            timeout_ms: 4_000,
            max_bytes: 64 * 1024,
            label: "OpenCode ACP".into(),
            signal: signal.clone(),
        };
        let probe = match options.probe.as_ref() {
            Some(probe) => probe(run).await,
            None => run_bounded(options.run_probe.clone(), run).await,
        };
        match probe {
            Ok(probe) if probe.code != Some(0) => {
                let output = format!("{}\n{}", probe.stdout, probe.stderr);
                readiness = Obj::from(&result)
                    .set("status", "protocol-unavailable")
                    .set("code", "PROTOCOL_UNAVAILABLE")
                    .set(
                        "message",
                        "This OpenCode installation does not expose a usable Agent Client Protocol endpoint.",
                    )
                    .set("diagnostic", js::head16(output.trim(), 4_000))
                    .build();
            }
            Ok(_) => {}
            Err(error) => {
                readiness = Obj::from(&result)
                    .set("status", "protocol-unavailable")
                    .set("code", "PROTOCOL_PROBE_FAILED")
                    .set(
                        "message",
                        "This OpenCode installation could not start its Agent Client Protocol endpoint.",
                    )
                    .set("diagnostic", error.message)
                    .build();
            }
        }
    }
    Ok(runtime_readiness(
        "opencode-native",
        &result,
        &readiness,
        false,
    ))
}

/// `buildUserOpenCodeEnvironment(baseEnv, loginEnv, options)`: the user's
/// explicit OpenCode profile, auth and provider environment stay; Built-in
/// Agent's managed profile exists only in its own child environment, so this
/// independently constructed map never inherits it from that sibling.
pub fn build_user_open_code_environment(base: &EnvMap, login: &EnvMap, platform: &str) -> EnvMap {
    let mut environment = build_agent_environment(base, login, platform);
    environment.insert("OPENCODE_CLIENT".into(), "puppyone-desktop-native".into());
    environment.insert("PUPPYONE_AGENT_BACKEND".into(), "opencode-native".into());
    for (key, value) in OPEN_CODE_HOST_SAFETY_ENVIRONMENT {
        environment.insert(key.to_string(), value.to_string());
    }
    environment
}
