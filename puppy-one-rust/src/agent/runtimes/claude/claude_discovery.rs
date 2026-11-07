//! `runtimes/claude/claude-discovery.mjs`: the user's Claude Code CLI, its
//! version and the streaming controls the Agent SDK requires.
use super::claude_agent_sdk::{CLAUDE_AGENT_SDK_VERSION, ClaudeSdk, NativeClaudeSdk};
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
    discover_executable, environment_map, run_bounded,
};
use regex::Regex;
use serde_json::Value;
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::LazyLock;

/// `CLAUDE_CODE_TESTED_BASELINE`: compatibility is verified through the
/// official SDK initialization handshake. A version floor would reject
/// working native installations without proving a protocol
/// incompatibility.
pub const CLAUDE_CODE_TESTED_BASELINE: Option<&str> = None;

static VERSION_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:claude(?:\s+code)?\s+)?v?(\d+\.\d+\.\d+)(?:\s+\(Claude Code\))?$")
        .expect("pattern")
});

/// `sdkLoader()`.
pub type SdkLoader = Rc<dyn Fn() -> AgentResult<Rc<dyn ClaudeSdk>>>;

/// The bundled SDK.
pub fn default_sdk_loader() -> SdkLoader {
    Rc::new(|| Ok(Rc::new(NativeClaudeSdk::default()) as Rc<dyn ClaudeSdk>))
}

/// `discoverClaudeRuntime({ … })` inputs.
#[derive(Clone, Default)]
pub struct ClaudeDiscoveryOptions {
    pub env: Option<EnvMap>,
    pub platform: Option<String>,
    pub homedir: Option<PathBuf>,
    pub read_environment: Option<ReadEnvironment>,
    pub run_probe: Option<ProbeRunner>,
    pub tmpdir: Option<PathBuf>,
    pub sdk_loader: Option<SdkLoader>,
    pub discover: Option<DiscoverFn>,
    pub probe: Option<RunBounded>,
}

/// `createClaudeDiscovery({ cache, ...discoveryOptions })`.
pub fn create_claude_discovery(
    options: ClaudeDiscoveryOptions,
    cache: Option<CacheOptions>,
) -> CachedRuntimeDiscovery {
    CachedRuntimeDiscovery::new(
        Rc::new(move |signal| {
            let options = options.clone();
            Box::pin(async move { discover_claude_runtime(options, Some(signal)).await })
        }),
        cache,
    )
}

/// `fs.promises.mkdtemp(prefix)`.
fn make_temp_dir(tmpdir: &Path, prefix: &str) -> std::io::Result<PathBuf> {
    let directory = tmpdir.join(format!(
        "{prefix}{}",
        &uuid::Uuid::new_v4().simple().to_string()[..6]
    ));
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&directory)?;
    Ok(directory)
}

/// `discoverClaudeRuntime(options)`.
pub async fn discover_claude_runtime(
    options: ClaudeDiscoveryOptions,
    signal: Option<AbortSignal>,
) -> AgentResult<Value> {
    let loader = options
        .sdk_loader
        .clone()
        .unwrap_or_else(default_sdk_loader);
    if let Err(error) = loader() {
        let base = options
            .env
            .clone()
            .unwrap_or_else(|| std::env::vars().collect());
        let platform = options.platform.clone().unwrap_or_else(|| {
            crate::agent::discovery::bounded_process_probe::node_platform().to_string()
        });
        let environment = build_agent_environment(&base, &EnvMap::new(), &platform);
        return Ok(Obj::new()
            .set("runtimeId", "claude")
            .set("provider", "claude")
            .set("status", "error")
            .set("code", "RUNTIME_DISCOVERY_FAILED")
            .set("version", Value::Null)
            .set("minimumVersion", CLAUDE_CODE_TESTED_BASELINE)
            .set("sdkVersion", CLAUDE_AGENT_SDK_VERSION)
            .set("executablePath", Value::Null)
            .set(
                "environment",
                serde_json::to_value(environment).unwrap_or_default(),
            )
            .set("source", "missing")
            .set("compatibility", "unavailable")
            .set(
                "message",
                redact_secret_text(&format!(
                    "Claude Agent SDK is unavailable: {}",
                    error.message
                )),
            )
            .build());
    }
    let tmpdir = options.tmpdir.clone().unwrap_or_else(std::env::temp_dir);
    let probe_directory: Rc<RefCell<Option<PathBuf>>> = Rc::default();
    let mut discovery = DiscoverExecutableOptions::new(
        "Claude Code",
        Rc::new(|value: &str| parse_claude_version(value)),
    );
    discovery.installation_id = Some("claude".into());
    discovery.env = options.env.clone();
    discovery.platform = options.platform.clone();
    discovery.homedir = options.homedir.clone();
    discovery.read_environment = options.read_environment.clone();
    discovery.run_probe = options.run_probe.clone();
    discovery.signal = signal.clone();
    discovery.minimum_version = CLAUDE_CODE_TESTED_BASELINE.map(str::to_string);
    discovery.build_environment = Some(Rc::new(|base, login, _homedir, platform| {
        build_agent_environment(base, login, platform)
    }));
    discovery.build_probe_environment = Some({
        let (tmpdir, probe_directory) = (tmpdir.clone(), probe_directory.clone());
        Rc::new(
            move |environment: EnvMap, _executable, _homedir, _platform| {
                let (tmpdir, probe_directory) = (tmpdir.clone(), probe_directory.clone());
                Box::pin(async move {
                    let directory = make_temp_dir(&tmpdir, "puppyone-claude-version-probe-")?;
                    *probe_directory.borrow_mut() = Some(directory.clone());
                    let mut environment = environment;
                    environment.insert(
                        "CLAUDE_CONFIG_DIR".into(),
                        directory.to_string_lossy().into_owned(),
                    );
                    Ok(environment)
                })
            },
        )
    });
    let local = match options.discover.as_ref() {
        Some(discover) => discover(discovery).await,
        None => discover_executable(discovery).await,
    };
    // Probe cleanup is best-effort and must never hide the discovery result.
    if let Some(directory) = probe_directory.borrow_mut().take() {
        let _ = std::fs::remove_dir_all(directory);
    }
    let local = local?;
    let mut compatible = local.clone();
    let executable_path = local
        .get("executablePath")
        .and_then(Value::as_str)
        .filter(|p| !p.is_empty())
        .map(str::to_string);
    if local["status"] == "ready"
        && let Some(executable_path) = executable_path.clone()
    {
        let probe = async {
            let directory = make_temp_dir(&tmpdir, "puppyone-claude-capability-probe-")?;
            let mut env = environment_map(local.get("environment"));
            env.insert(
                "CLAUDE_CONFIG_DIR".into(),
                directory.to_string_lossy().into_owned(),
            );
            let run = BoundedRun {
                file: executable_path,
                args: vec!["--help".into()],
                env,
                timeout_ms: 4_000,
                max_bytes: 64 * 1024,
                label: "Claude Code Agent SDK capability".into(),
                signal: signal.clone(),
            };
            let result = match options.probe.as_ref() {
                Some(probe) => probe(run).await,
                None => run_bounded(options.run_probe.clone(), run).await,
            };
            let _ = std::fs::remove_dir_all(&directory);
            result
        }
        .await;
        compatible = match probe {
            Ok(probe) => {
                let help = format!("{}\n{}", probe.stdout, probe.stderr);
                if probe.code != Some(0) || !has_secure_sdk_capabilities(&help) {
                    Obj::from(&local)
                        .set("status", "protocol-unavailable")
                        .set("code", "PROTOCOL_UNAVAILABLE")
                        .set(
                            "message",
                            "Claude Code is installed, but this build does not expose the secure streaming controls required by the official Agent SDK.",
                        )
                        .set(
                            "diagnostic",
                            "Required native capabilities: streaming JSON input/output and setting-source isolation.",
                        )
                        .build()
                } else {
                    local.clone()
                }
            }
            Err(error) => Obj::from(&local)
                .set("status", "protocol-unavailable")
                .set("code", "PROTOCOL_PROBE_FAILED")
                .set(
                    "message",
                    "Claude Code is installed, but its official Agent SDK capabilities could not be verified.",
                )
                .set("diagnostic", error.message)
                .build(),
        };
    }
    let use_local = compatible["status"] == "ready";
    let message = if use_local {
        format!(
            "Claude Code {} is ready for the official Agent SDK compatibility handshake.",
            js::to_js_string(local.get("version"))
        )
    } else if compatible["status"] == "not-installed" {
        "Claude Code was not found. Install the native Claude Code product, configure an API key or supported cloud provider, then refresh.".into()
    } else {
        redact_secret_text(&js::to_js_string(compatible.get("message")))
    };
    let diagnostic = compatible
        .get("diagnostic")
        .filter(|d| js::truthy(d))
        .map(|d| redact_secret_text(&js::to_js_string(Some(d))));
    Ok(Obj::new()
        .set("runtimeId", "claude")
        .set("provider", "claude")
        .spread(&compatible)
        .set("status", compatible["status"].clone())
        .set(
            "version",
            local.get("version").cloned().unwrap_or(Value::Null),
        )
        .set("minimumVersion", CLAUDE_CODE_TESTED_BASELINE)
        .set("sdkVersion", CLAUDE_AGENT_SDK_VERSION)
        .set("executablePath", executable_path.clone())
        .set(
            "source",
            if executable_path.is_some() {
                "user-installed"
            } else {
                "missing"
            },
        )
        .set(
            "compatibility",
            if use_local {
                "native-sdk-local-cli"
            } else {
                "unavailable"
            },
        )
        .set("message", message)
        .opt("diagnostic", diagnostic)
        .build())
}

fn has_secure_sdk_capabilities(help: &str) -> bool {
    [
        "--input-format",
        "--output-format",
        "--setting-sources",
        "--permission-mode",
    ]
    .iter()
    .all(|flag| help.contains(flag))
}

/// `parseClaudeVersion(value)`.
pub fn parse_claude_version(value: &str) -> Option<String> {
    value.lines().find_map(|line| {
        VERSION_LINE
            .captures(js::trim(line))
            .map(|captures| captures[1].to_string())
    })
}
