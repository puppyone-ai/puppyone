//! `runtimes/workbuddy/workbuddy-discovery.mjs`.
use super::workbuddy_channels::WorkBuddyChannel;
use super::workbuddy_config_directory::work_buddy_config_directory;
use super::workbuddy_environment::WORKBUDDY_HOST_ENVIRONMENT;
use crate::agent::agent_error::AgentResult;
use crate::agent::connections::runtime_discovery_cache::{CacheOptions, CachedRuntimeDiscovery};
use crate::agent::contract::js::{self, Obj};
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::discovery::executable_discovery_port::ReadEnvironment;
use crate::agent::event_loop::AbortSignal;
use crate::agent::runtimes::hermes::hermes_discovery::runtime_readiness;
use crate::agent::transports::bounded_process_probe::ProbeRunner;
use crate::agent::transports::executable_discovery::{
    BoundedRun, DiscoverExecutableOptions, DiscoverFn, RunBounded, build_agent_environment,
    discover_executable, environment_map, parse_semantic_version, run_bounded,
};
use regex::Regex;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::LazyLock;

/// `workBuddyDiscoveryLimits`.
pub mod limits {
    pub const ACP_PROBE_TIMEOUT_MS: u64 = 4_000;
    pub const ACP_PROBE_MAX_BYTES: usize = 64 * 1024;
}

static ACP_FLAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)(?:^|\s)--acp(?:\s|,|$)").expect("pattern"));

/// `discoverWorkBuddyExecutable({ … })` inputs.
#[derive(Clone, Default)]
pub struct WorkBuddyDiscoveryOptions {
    pub env: Option<EnvMap>,
    pub platform: Option<String>,
    pub homedir: Option<PathBuf>,
    pub read_environment: Option<ReadEnvironment>,
    pub run_probe: Option<ProbeRunner>,
    pub configured_executable: Option<String>,
    pub discover: Option<DiscoverFn>,
    pub probe: Option<RunBounded>,
}

/// `createWorkBuddyDiscovery(channel, { cache, ...discoveryOptions })`.
pub fn create_work_buddy_discovery(
    channel: WorkBuddyChannel,
    options: WorkBuddyDiscoveryOptions,
    cache: Option<CacheOptions>,
) -> CachedRuntimeDiscovery {
    CachedRuntimeDiscovery::new(
        Rc::new(move |signal| {
            let options = options.clone();
            Box::pin(
                async move { discover_work_buddy_executable(channel, options, Some(signal)).await },
            )
        }),
        cache,
    )
}

/// `workBuddyProbeEnvironment(environment)`.
fn work_buddy_probe_environment(mut environment: EnvMap) -> EnvMap {
    environment.insert("CODEBUDDY_DISABLE_COMPILE_CACHE".into(), "1".into());
    environment
}

/// `discoverWorkBuddyExecutable({ channel, ...options })`.
pub async fn discover_work_buddy_executable(
    channel: WorkBuddyChannel,
    options: WorkBuddyDiscoveryOptions,
    signal: Option<AbortSignal>,
) -> AgentResult<Value> {
    let mut discovery =
        DiscoverExecutableOptions::new(channel.display_name, Rc::new(parse_work_buddy_version));
    discovery.installation_id = Some(channel.installation_id.into());
    discovery.additional_candidates = options.configured_executable.clone().into_iter().collect();
    discovery.env = options.env.clone();
    discovery.platform = options.platform.clone();
    discovery.homedir = options.homedir.clone();
    discovery.read_environment = options.read_environment.clone();
    discovery.run_probe = options.run_probe.clone();
    discovery.signal = signal.clone();
    discovery.build_environment = Some(Rc::new(move |base, login, homedir, platform| {
        build_work_buddy_environment(&channel, base, login, Some(homedir), platform)
    }));
    discovery.build_probe_environment = Some(Rc::new(|environment, _, _, _| {
        Box::pin(async move { Ok(work_buddy_probe_environment(environment)) })
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
        let mut args: Vec<String> = result["argsPrefix"]
            .as_array()
            .map(|args| {
                args.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        args.push("--help".into());
        let run = BoundedRun {
            file: executable_path.to_string(),
            args,
            env: work_buddy_probe_environment(environment_map(result.get("environment"))),
            timeout_ms: limits::ACP_PROBE_TIMEOUT_MS,
            max_bytes: limits::ACP_PROBE_MAX_BYTES,
            label: format!("{} ACP", channel.display_name),
            signal: signal.clone(),
        };
        let probe = match options.probe.as_ref() {
            Some(probe) => probe(run).await,
            None => run_bounded(options.run_probe.clone(), run).await,
        };
        match probe {
            Ok(probe) => {
                let help = format!("{}\n{}", probe.stdout, probe.stderr);
                if probe.code != Some(0) || !ACP_FLAG.is_match(&help) {
                    readiness = Obj::from(&result)
                        .set("status", "protocol-unavailable")
                        .set("code", "PROTOCOL_UNAVAILABLE")
                        .set(
                            "message",
                            format!(
                                "This {} installation does not expose a usable Agent Client Protocol endpoint.",
                                channel.display_name
                            ),
                        )
                        .set("diagnostic", js::head16(help.trim(), 4_000))
                        .build();
                }
            }
            Err(error) => {
                if let Some(signal) = signal.as_ref() {
                    signal.throw_if_aborted()?;
                }
                readiness = Obj::from(&result)
                    .set("status", "protocol-unavailable")
                    .set("code", "PROTOCOL_PROBE_FAILED")
                    .set(
                        "message",
                        format!(
                            "This {} installation could not verify its Agent Client Protocol endpoint.",
                            channel.display_name
                        ),
                    )
                    .set("diagnostic", error.message)
                    .build();
            }
        }
    }
    Ok(runtime_readiness(channel.id, &result, &readiness, true))
}

/// `parseWorkBuddyVersion(value)`.
pub fn parse_work_buddy_version(value: &str) -> Option<String> {
    parse_semantic_version(value, "")
}

/// `buildWorkBuddyEnvironment(channel, baseEnv, loginEnv, options)`.
pub fn build_work_buddy_environment(
    channel: &WorkBuddyChannel,
    base: &EnvMap,
    login: &EnvMap,
    homedir: Option<&Path>,
    platform: &str,
) -> EnvMap {
    let mut environment = build_agent_environment(base, login, platform);
    let read = |key: &str| environment.get(key).cloned();
    let default_home = crate::agent::node_path::homedir();
    let directory = work_buddy_config_directory(channel, &read, homedir.unwrap_or(&default_home))
        .to_string_lossy()
        .into_owned();
    for (key, value) in WORKBUDDY_HOST_ENVIRONMENT {
        environment.insert(key.to_string(), value.to_string());
    }
    environment.insert("WORKBUDDY_CONFIG_DIR".into(), directory.clone());
    environment.insert("CODEBUDDY_CONFIG_DIR".into(), directory);
    environment.insert(
        "CODEBUDDY_INTERNET_ENVIRONMENT".into(),
        channel.route.into(),
    );
    environment.insert("PUPPYONE_AGENT_BACKEND".into(), channel.id.into());
    environment
}
