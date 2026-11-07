//! `runtimes/codex/codex-discovery.mjs`.
use crate::agent::agent_error::AgentResult;
use crate::agent::agent_events::redact_secret_text;
use crate::agent::connections::runtime_discovery_cache::{CacheOptions, CachedRuntimeDiscovery};
use crate::agent::contract::js::Obj;
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::discovery::executable_discovery_port::ReadEnvironment;
use crate::agent::event_loop::AbortSignal;
use crate::agent::transports::bounded_process_probe::ProbeRunner;
#[allow(unused_imports)]
pub use crate::agent::transports::executable_discovery::compare_versions;
use crate::agent::transports::executable_discovery::{
    DiscoverExecutableOptions, build_agent_environment, discover_executable, parse_semantic_version,
};
use serde_json::Value;
use std::path::PathBuf;
use std::rc::Rc;

/// The oldest app-server schema exercised by the checked-in protocol
/// fixture. Versions below this floor are not advertised as compatible.
pub const MIN_SUPPORTED_CODEX_VERSION: &str = "0.144.1";

/// `discoverCodexExecutable({ … })` inputs.
#[derive(Clone, Default)]
pub struct CodexDiscoveryOptions {
    pub env: Option<EnvMap>,
    pub platform: Option<String>,
    pub homedir: Option<PathBuf>,
    pub read_environment: Option<ReadEnvironment>,
    /// `spawn` for the version probe.
    pub run_probe: Option<ProbeRunner>,
}

/// `createCodexDiscovery({ cache, ...discoveryOptions })`.
pub fn create_codex_discovery(
    options: CodexDiscoveryOptions,
    cache: Option<CacheOptions>,
) -> CachedRuntimeDiscovery {
    CachedRuntimeDiscovery::new(
        Rc::new(move |signal| {
            let options = options.clone();
            Box::pin(async move { discover_codex_executable(options, Some(signal)).await })
        }),
        cache,
    )
}

/// `discoverCodexExecutable(options)`.
pub async fn discover_codex_executable(
    options: CodexDiscoveryOptions,
    signal: Option<AbortSignal>,
) -> AgentResult<Value> {
    let mut discovery = DiscoverExecutableOptions::new("Codex", Rc::new(parse_codex_version));
    discovery.installation_id = Some("codex".into());
    discovery.env = options.env;
    discovery.platform = options.platform;
    discovery.homedir = options.homedir;
    discovery.read_environment = options.read_environment;
    discovery.run_probe = options.run_probe;
    discovery.signal = signal;
    discovery.minimum_version = Some(MIN_SUPPORTED_CODEX_VERSION.into());
    discovery.build_environment = Some(Rc::new(|base, login, _homedir, platform| {
        build_provider_environment(base, login, platform)
    }));
    let result = discover_executable(discovery).await?;
    let text = |key: &str| {
        result
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let diagnostic = result
        .get("diagnostic")
        .and_then(Value::as_str)
        .filter(|d| !d.is_empty())
        .map(redact_secret_text);
    Ok(Obj::new()
        .set("provider", "codex")
        .set("runtimeId", "codex")
        .spread(&result)
        .set("message", redact_secret_text(&text("message")))
        .opt("diagnostic", diagnostic)
        .build())
}

/// `parseCodexVersion(value)`.
pub fn parse_codex_version(value: &str) -> Option<String> {
    parse_semantic_version(value, "codex(?:-cli)?")
}

/// `buildProviderEnvironment(baseEnv, loginEnv, options)`.
pub fn build_provider_environment(base: &EnvMap, login: &EnvMap, platform: &str) -> EnvMap {
    build_agent_environment(base, login, platform)
}
