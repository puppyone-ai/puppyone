//! `transports/executable-discovery.mjs`: installation selection belongs to
//! the platform; the runtime owns readiness probes.
use crate::agent::agent_error::AgentResult;
use crate::agent::contract::js::{self, Obj};
use crate::agent::event_loop::AbortSignal;
use crate::agent::node_path;
use crate::platform::common::bounded_process_probe::{
    ProbeOptions, ProbeResult, ProbeRunner, default_probe_runner, node_platform,
};
use crate::platform::common::command_environment::{EnvMap, normalize_environment};
use crate::platform::common::executable_discovery_port::{
    DiscoveryPortOptions, ExecutableDiscoveryPort, ReadEnvironment,
};
use crate::platform::local_agent_installation::executable_resolver::{
    AcceptCandidate, LocalAgentExecutableResolver, Observation, ObservationRequest,
    ResolutionContext, assert_executable_identity, resolve_executable_observation,
};
use crate::platform::local_agent_installation::installation_definition::{CandidateSpec, NameSpec};
use futures_util::future::LocalBoxFuture;
use regex::Regex;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;

/// `executableDiscoveryLimits`.
pub mod limits {
    pub const VERSION_TIMEOUT_MS: u64 = 4_000;
    pub const MAX_DISCOVERY_OUTPUT: usize = 64 * 1024;
}

/// `parseVersion(output)`.
pub type ParseVersion = Rc<dyn Fn(&str) -> Option<String>>;

/// `buildEnvironment(baseEnv, overrides, { homedir, platform })`.
pub type BuildEnvironment = Rc<dyn Fn(&EnvMap, &EnvMap, &Path, &str) -> EnvMap>;

/// `buildProbeEnvironment(environment, { executablePath, homedir, platform })`.
pub type BuildProbeEnvironment =
    Rc<dyn Fn(EnvMap, String, PathBuf, String) -> LocalBoxFuture<'static, AgentResult<EnvMap>>>;

/// `validateCandidate({ candidate, resolvedPath })`.
pub type ValidateCandidate = Arc<dyn Fn(&str, &str) -> AgentResult<bool> + Send + Sync>;

/// `discoverExecutable({ … })` options.
#[derive(Clone)]
pub struct DiscoverExecutableOptions {
    pub installation_id: Option<String>,
    pub executable_names: Vec<NameSpec>,
    pub additional_candidates: Vec<String>,
    /// `None` reads the host environment.
    pub env: Option<EnvMap>,
    pub platform: Option<String>,
    pub homedir: Option<PathBuf>,
    pub parse_version: ParseVersion,
    pub minimum_version: Option<String>,
    pub label: String,
    pub build_environment: Option<BuildEnvironment>,
    pub build_probe_environment: Option<BuildProbeEnvironment>,
    pub validate_candidate: Option<ValidateCandidate>,
    pub search_path: bool,
    pub read_environment: Option<ReadEnvironment>,
    pub signal: Option<AbortSignal>,
    /// `spawn` for the version probe.
    pub run_probe: Option<ProbeRunner>,
}

impl DiscoverExecutableOptions {
    pub fn new(label: &str, parse_version: ParseVersion) -> Self {
        Self {
            installation_id: None,
            executable_names: Vec::new(),
            additional_candidates: Vec::new(),
            env: None,
            platform: None,
            homedir: None,
            parse_version,
            minimum_version: None,
            label: label.into(),
            build_environment: None,
            build_probe_environment: None,
            validate_candidate: None,
            search_path: true,
            read_environment: None,
            signal: None,
            run_probe: None,
        }
    }
}

/// `discoverExecutable(options)`: the runtime's internal readiness.
pub async fn discover_executable(options: DiscoverExecutableOptions) -> AgentResult<Value> {
    let signal = options.signal.clone();
    let abort = || {
        signal
            .as_ref()
            .map_or(Ok(()), AbortSignal::throw_if_aborted)
    };
    abort()?;
    let env = options
        .env
        .clone()
        .unwrap_or_else(|| std::env::vars().collect());
    let platform = options
        .platform
        .clone()
        .unwrap_or_else(|| node_platform().into());
    let homedir = options.homedir.clone().unwrap_or_else(node_path::homedir);
    let label = options.label.clone();
    let mut context: Option<ResolutionContext> = None;
    let observation = match options.installation_id.as_deref() {
        Some(installation_id) => {
            let resolver = LocalAgentExecutableResolver::new(
                None,
                ExecutableDiscoveryPort::new(DiscoveryPortOptions {
                    node_platform: Some(platform.clone()),
                    env: Some(env.clone()),
                    homedir: Some(homedir.clone()),
                    read_environment: options.read_environment.clone(),
                    find_registered_applications: None,
                }),
            );
            let extra: Vec<CandidateSpec> = options
                .additional_candidates
                .iter()
                .map(|path| CandidateSpec::new(path.clone(), "explicit-configuration"))
                .collect();
            let resolved = async {
                let created = resolver.create_context(signal.clone()).await?;
                context = Some(created.clone());
                resolver
                    .resolve(installation_id, Some(created), extra)
                    .await
            }
            .await;
            match resolved {
                Ok(observation) => observation,
                Err(_) => {
                    abort()?;
                    Observation::Failed {
                        reason_code: "context-error".into(),
                    }
                }
            }
        }
        None => {
            // Managed distributions supply verified explicit candidates and
            // never load the user's shell or fall back to a same-named user
            // installation.
            let candidates: Vec<String> = options
                .additional_candidates
                .iter()
                .filter(|file| !file.is_empty())
                .cloned()
                .collect();
            let names = if options.executable_names.is_empty() {
                let mut names: Vec<NameSpec> = Vec::new();
                for file in &candidates {
                    let name = NameSpec::Text(node_path::basename(file));
                    if !names.contains(&name) {
                        names.push(name);
                    }
                }
                names
            } else {
                options.executable_names.clone()
            };
            let accept = options
                .validate_candidate
                .clone()
                .map(|validate| -> AcceptCandidate {
                    Arc::new(move |candidate| {
                        validate(&candidate.executable_path, &candidate.canonical_identity)
                    })
                });
            let search_env = if options.search_path {
                env.clone()
            } else {
                EnvMap::from([("PATH".to_string(), String::new())])
            };
            let observation = resolve_executable_observation(ObservationRequest {
                names,
                configured_candidates: candidates
                    .iter()
                    .map(|file| CandidateSpec::new(file.clone(), "managed-candidate"))
                    .collect(),
                accept_candidate: accept,
                env: search_env,
                platform: platform.clone(),
                signal: signal.clone(),
                ..Default::default()
            })
            .await?;
            match observation {
                Observation::Found {
                    mut candidate,
                    reason_code,
                } => {
                    candidate.executable_path = candidate.canonical_identity.clone();
                    Observation::Found {
                        candidate,
                        reason_code,
                    }
                }
                other => other,
            }
        }
    };
    abort()?;
    let candidate = match &observation {
        Observation::Found { candidate, .. } => Some(candidate.clone()),
        _ => None,
    };
    let build_environment = options.build_environment.clone().unwrap_or_else(|| {
        Rc::new(|base, overrides, _homedir, platform| {
            build_agent_environment(base, overrides, platform)
        })
    });
    let base_environment = candidate
        .as_ref()
        .and_then(|c| c.environment.clone())
        .or_else(|| context.as_ref().map(|c| c.environment.clone()))
        .unwrap_or_else(|| env.clone());
    let environment = build_environment(&base_environment, &EnvMap::new(), &homedir, &platform);
    let executable_path = candidate.as_ref().map(|c| c.executable_path.clone());
    let base = Obj::new()
        .set("version", Value::Null)
        .opt("minimumVersion", options.minimum_version.clone())
        .set("executablePath", executable_path.clone())
        .set(
            "argsPrefix",
            candidate
                .as_ref()
                .map(|c| c.args_prefix.clone())
                .unwrap_or_default(),
        )
        .set(
            "invokedAs",
            candidate.as_ref().map(|c| c.invoked_as.clone()),
        )
        .set("environment", environment_value(&environment));
    let Some(candidate) = candidate else {
        let failed = observation.status() == "failed";
        return Ok(base
            .set("status", if failed { "error" } else { "not-installed" })
            .set(
                "code",
                if failed {
                    "RUNTIME_DISCOVERY_FAILED"
                } else {
                    "RUNTIME_NOT_INSTALLED"
                },
            )
            .set(
                "message",
                if failed {
                    format!("{label} installation could not be checked. Refresh to retry.")
                } else {
                    format!("{label} was not found. Install it, complete its setup in a terminal, then refresh.")
                },
            )
            .opt("diagnostic", observation.reason_code().map(str::to_string))
            .build());
    };
    let executable_path = executable_path.unwrap_or_default();
    let probe = async {
        assert_executable_identity(&candidate).await?;
        let probe_environment = match options.build_probe_environment.as_ref() {
            Some(build) => {
                build(
                    environment.clone(),
                    executable_path.clone(),
                    homedir.clone(),
                    platform.clone(),
                )
                .await?
            }
            None => environment.clone(),
        };
        let mut args = candidate.args_prefix.clone();
        args.push("--version".into());
        run_bounded(
            options.run_probe.clone(),
            BoundedRun {
                file: executable_path.clone(),
                args,
                env: probe_environment,
                timeout_ms: limits::VERSION_TIMEOUT_MS,
                max_bytes: limits::MAX_DISCOVERY_OUTPUT,
                label: label.clone(),
                signal: signal.clone(),
            },
        )
        .await
    }
    .await;
    let result = match probe {
        Ok(result) => result,
        Err(error) => {
            abort()?;
            return Ok(base
                .set("status", "error")
                .set("code", "RUNTIME_DISCOVERY_FAILED")
                .set("message", error.message)
                .build());
        }
    };
    let version = (options.parse_version)(&format!("{}\n{}", result.stdout, result.stderr));
    let Some(version) = version.clone().filter(|_| result.code == Some(0)) else {
        return Ok(base
            .set("status", "unsupported-version")
            .set("code", "RUNTIME_VERSION_UNVERIFIED")
            .set("version", version)
            .set(
                "message",
                format!(
                    "The installed {label} version could not be verified. Update it and refresh."
                ),
            )
            .build());
    };
    if let Some(minimum) = options.minimum_version.as_deref()
        && compare_versions(&version, minimum) < 0
    {
        return Ok(base
            .set("status", "unsupported-version")
            .set("code", "RUNTIME_VERSION_UNSUPPORTED")
            .set("version", version.as_str())
            .set(
                "message",
                format!("{label} {version} is older than the tested baseline {minimum}."),
            )
            .build());
    }
    Ok(base
        .set("status", "ready")
        .set("code", "READY")
        .set("version", version)
        .set("message", format!("{label} is ready."))
        .opt("diagnostic", observation.reason_code().map(str::to_string))
        .build())
}

/// `runBounded(spawn, file, args, { env, timeoutMs, maxBytes, label, signal })`.
#[derive(Clone)]
pub struct BoundedRun {
    pub file: String,
    pub args: Vec<String>,
    pub env: EnvMap,
    pub timeout_ms: u64,
    pub max_bytes: usize,
    pub label: String,
    pub signal: Option<AbortSignal>,
}

/// An injectable `runBounded` (`probe`).
pub type RunBounded = Rc<dyn Fn(BoundedRun) -> LocalBoxFuture<'static, AgentResult<ProbeResult>>>;

/// An injectable `discoverExecutable` (`discover`).
pub type DiscoverFn =
    Rc<dyn Fn(DiscoverExecutableOptions) -> LocalBoxFuture<'static, AgentResult<Value>>>;

/// `runBounded(spawn, file, args, options)`.
pub async fn run_bounded(
    run_probe: Option<ProbeRunner>,
    run: BoundedRun,
) -> AgentResult<ProbeResult> {
    let run_probe = run_probe.unwrap_or_else(default_probe_runner);
    run_probe(
        run.file,
        run.args,
        ProbeOptions {
            env: Some(run.env),
            timeout_ms: run.timeout_ms,
            max_output_bytes: run.max_bytes,
            label: format!("{} discovery", run.label),
            signal: run.signal,
            ..Default::default()
        },
    )
    .await
}

/// A readiness `environment` object as a process environment.
pub fn environment_map(value: Option<&Value>) -> EnvMap {
    value
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A process environment as a readiness `environment` object.
pub fn environment_value(environment: &EnvMap) -> Value {
    Value::Object(
        environment
            .iter()
            .map(|(key, value)| (key.clone(), Value::from(value.as_str())))
            .collect(),
    )
}

/// `buildAgentEnvironment(baseEnv, overrides, { platform })`.
pub fn build_agent_environment(base: &EnvMap, overrides: &EnvMap, platform: &str) -> EnvMap {
    let mut merged = base.clone();
    merged.extend(
        overrides
            .iter()
            .map(|(key, value)| (key.clone(), value.clone())),
    );
    let mut environment = normalize_environment(merged.iter(), platform);
    environment.insert("TERM".into(), "dumb".into());
    environment.insert("PUPPYONE_AGENT".into(), "1".into());
    environment
}

/// `parseSemanticVersion(value, prefixPattern)`.
pub fn parse_semantic_version(value: &str, prefix_pattern: &str) -> Option<String> {
    let prefix = if prefix_pattern.is_empty() {
        String::new()
    } else {
        format!(r"(?:{prefix_pattern}\s+)?")
    };
    let pattern = Regex::new(&format!(r"(?i){prefix}(\d+\.\d+\.\d+)")).ok()?;
    pattern
        .captures(value)
        .and_then(|captures| captures.get(1))
        .map(|m| m.as_str().to_string())
}

/// `compareVersions(left, right)`.
pub fn compare_versions(left: &str, right: &str) -> i32 {
    let parts = |value: &str| -> Vec<f64> {
        value
            .split('.')
            .map(|part| {
                let number = js::to_number(Some(&Value::from(part)));
                if number.is_nan() { 0.0 } else { number }
            })
            .collect()
    };
    let (left, right) = (parts(left), parts(right));
    for index in 0..left.len().max(right.len()) {
        let difference =
            left.get(index).copied().unwrap_or(0.0) - right.get(index).copied().unwrap_or(0.0);
        if difference != 0.0 {
            return if difference < 0.0 { -1 } else { 1 };
        }
    }
    0
}
