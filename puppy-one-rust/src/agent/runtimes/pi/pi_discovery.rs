//! `runtimes/pi/pi-discovery.mjs`.
use crate::agent::agent_error::AgentResult;
use crate::agent::agent_events::redact_secret_text;
use crate::agent::connections::runtime_discovery_cache::{CacheOptions, CachedRuntimeDiscovery};
use crate::agent::contract::js::{self, Obj};
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::discovery::executable_discovery_port::ReadEnvironment;
use crate::agent::event_loop::AbortSignal;
use crate::agent::transports::bounded_process_probe::ProbeRunner;
use crate::agent::transports::executable_discovery::{
    BoundedRun, DiscoverExecutableOptions, DiscoverFn, RunBounded, build_agent_environment,
    discover_executable, environment_map, parse_semantic_version, run_bounded,
};
use regex::Regex;
use serde_json::Value;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::LazyLock;

static ASSISTANT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)AI coding assistant").expect("pattern"));
static MODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"--mode\s+<mode>").expect("pattern"));
static RPC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)rpc").expect("pattern"));

/// `discoverPiExecutable({ … })` inputs.
#[derive(Clone, Default)]
pub struct PiDiscoveryOptions {
    pub env: Option<EnvMap>,
    pub platform: Option<String>,
    pub homedir: Option<PathBuf>,
    pub read_environment: Option<ReadEnvironment>,
    pub run_probe: Option<ProbeRunner>,
    pub configured_executable: Option<String>,
    pub discover: Option<DiscoverFn>,
    pub probe: Option<RunBounded>,
}

/// `createPiDiscovery({ cache, ...discoveryOptions })`.
pub fn create_pi_discovery(
    options: PiDiscoveryOptions,
    cache: Option<CacheOptions>,
) -> CachedRuntimeDiscovery {
    CachedRuntimeDiscovery::new(
        Rc::new(move |signal| {
            let options = options.clone();
            Box::pin(async move { discover_pi_executable(options, Some(signal)).await })
        }),
        cache,
    )
}

/// `discoverPiExecutable(options)`.
pub async fn discover_pi_executable(
    options: PiDiscoveryOptions,
    signal: Option<AbortSignal>,
) -> AgentResult<Value> {
    let mut discovery =
        DiscoverExecutableOptions::new("Pi", Rc::new(|value| parse_semantic_version(value, "")));
    discovery.installation_id = Some("pi".into());
    discovery.additional_candidates = options.configured_executable.clone().into_iter().collect();
    discovery.env = options.env.clone();
    discovery.platform = options.platform.clone();
    discovery.homedir = options.homedir.clone();
    discovery.read_environment = options.read_environment.clone();
    discovery.run_probe = options.run_probe.clone();
    discovery.signal = signal.clone();
    discovery.build_environment = Some(Rc::new(|base, login, _homedir, platform| {
        build_agent_environment(base, login, platform)
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
            args: vec!["--help".into()],
            env: environment_map(result.get("environment")),
            timeout_ms: 4_000,
            max_bytes: 64 * 1024,
            label: "Pi RPC".into(),
            signal: signal.clone(),
        };
        let probe = match options.probe.as_ref() {
            Some(probe) => probe(run).await,
            None => run_bounded(options.run_probe.clone(), run).await,
        };
        match probe {
            Ok(probe) => {
                let output = format!("{}\n{}", probe.stdout, probe.stderr);
                if probe.code != Some(0)
                    || !ASSISTANT.is_match(&output)
                    || !MODE.is_match(&output)
                    || !RPC.is_match(&output)
                {
                    readiness = Obj::from(&result)
                        .set("status", "protocol-unavailable")
                        .set("code", "PROTOCOL_UNAVAILABLE")
                        .set(
                            "message",
                            "This Pi installation does not expose its official RPC mode.",
                        )
                        .set("diagnostic", js::head16(output.trim(), 4_000))
                        .build();
                }
            }
            Err(error) => {
                readiness = Obj::from(&result)
                    .set("status", "protocol-unavailable")
                    .set("code", "PROTOCOL_PROBE_FAILED")
                    .set(
                        "message",
                        "Pi's RPC capability could not be inspected safely.",
                    )
                    .set("diagnostic", error.message)
                    .build();
            }
        }
    }
    let ready = readiness["status"] == "ready";
    let installed = result.get("executablePath").is_some_and(js::truthy);
    let diagnostic = readiness
        .get("diagnostic")
        .filter(|d| js::truthy(d))
        .map(|d| redact_secret_text(&js::to_js_string(Some(d))));
    Ok(Obj::new()
        .set("provider", "pi")
        .set("runtimeId", "pi")
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
            if ready { "pi-rpc-v1" } else { "unavailable" },
        )
        .spread(&readiness)
        .set(
            "message",
            redact_secret_text(&js::to_js_string(readiness.get("message"))),
        )
        .opt("diagnostic", diagnostic)
        .build())
}
