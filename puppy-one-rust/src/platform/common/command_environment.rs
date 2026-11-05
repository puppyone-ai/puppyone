//! `platform/common/command-environment.mjs`: one fresh, private user
//! command environment per scan. No completed environment cache.
use super::bounded_process_probe::{ProbeOptions, ProbeRunner, default_probe_runner};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::event_loop::AbortSignal;
use crate::agent::node_path::flavor::{posix_basename, posix_is_absolute};
use crate::platform::windows::command_environment::read_windows_command_environment;
use regex::Regex;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

/// A process environment (`{ NAME: value }`).
pub type EnvMap = BTreeMap<String, String>;

/// `commandEnvironmentPolicy`.
pub mod policy {
    pub const TIMEOUT_MS: u64 = 4_000;
    pub const MAX_OUTPUT_BYTES: usize = 256 * 1024;
}

static ENVIRONMENT_KEY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z_][A-Za-z0-9_]*$").expect("environment key pattern"));

/// `{ environment, complete, source, reasonCode }`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnvironmentSnapshot {
    pub environment: EnvMap,
    pub complete: bool,
    pub source: String,
    pub reason_code: Option<String>,
}

/// `readUserCommandEnvironment({ env, platform, homedir, signal, runProbe, timeoutMs })`.
pub struct ReadEnvironmentOptions {
    pub env: EnvMap,
    pub platform: String,
    pub homedir: PathBuf,
    pub signal: Option<AbortSignal>,
    pub run_probe: Option<ProbeRunner>,
    pub timeout_ms: Option<u64>,
}

/// `readUserCommandEnvironment(options)`.
pub async fn read_user_command_environment(
    options: ReadEnvironmentOptions,
) -> AgentResult<EnvironmentSnapshot> {
    let abort = |signal: Option<&AbortSignal>| signal.map_or(Ok(()), AbortSignal::throw_if_aborted);
    abort(options.signal.as_ref())?;
    let inherited = normalize_environment(options.env.iter(), &options.platform);
    let run_probe = options
        .run_probe
        .clone()
        .unwrap_or_else(default_probe_runner);
    let timeout_ms = options.timeout_ms.unwrap_or(policy::TIMEOUT_MS);
    let windows = options.platform == "win32";
    let read = if windows {
        read_windows_command_environment(
            &inherited,
            &options.homedir,
            options.signal.clone(),
            &run_probe,
            timeout_ms,
        )
        .await
    } else {
        read_posix_command_environment(
            &inherited,
            &options.platform,
            &options.homedir,
            options.signal.clone(),
            &run_probe,
            timeout_ms,
        )
        .await
    };
    match read {
        Ok(environment) => {
            abort(options.signal.as_ref())?;
            Ok(EnvironmentSnapshot {
                environment,
                complete: true,
                source: if windows {
                    "windows-environment"
                } else {
                    "shell-environment"
                }
                .into(),
                reason_code: None,
            })
        }
        Err(_) => {
            abort(options.signal.as_ref())?;
            Ok(EnvironmentSnapshot {
                environment: inherited,
                complete: false,
                source: "inherited-environment".into(),
                reason_code: Some("environment-unavailable".into()),
            })
        }
    }
}

/// `resolveDefaultDesktopShell({ platform, environment })`
/// (`platform/shell-policy.mjs`).
pub fn resolve_default_desktop_shell(platform: &str, environment: &EnvMap) -> String {
    let read = |key: &str| environment.get(key).filter(|v| !v.is_empty()).cloned();
    if platform == "win32" {
        return read("ComSpec")
            .or_else(|| read("COMSPEC"))
            .unwrap_or_else(|| "cmd.exe".into());
    }
    if let Some(shell) = read("SHELL") {
        return shell;
    }
    if platform == "darwin" {
        "/bin/zsh".into()
    } else {
        "/bin/bash".into()
    }
}

async fn read_posix_command_environment(
    env: &EnvMap,
    platform: &str,
    homedir: &Path,
    signal: Option<AbortSignal>,
    run_probe: &ProbeRunner,
    timeout_ms: u64,
) -> AgentResult<EnvMap> {
    let shell = resolve_default_desktop_shell(platform, env);
    let name = posix_basename(&shell).to_string();
    if !posix_is_absolute(&shell)
        || !["zsh", "bash", "fish", "sh", "dash", "ksh"].contains(&name.as_str())
    {
        return Err(AgentError::new("Unsupported environment shell."));
    }
    let marker = format!("puppyone-env-{}", uuid::Uuid::new_v4());
    let begin = format!("{marker}-begin");
    let end = format!("{marker}-end");
    // Never interpolate paths, CLI names or environment values into shell source.
    let command = format!(r"printf '\0{begin}\0'; /usr/bin/env -0; printf '\0{end}\0'");
    let args: Vec<String> = if name == "fish" {
        vec![
            "--login".into(),
            "--interactive".into(),
            "--command".into(),
            command,
        ]
    } else {
        vec!["-ilc".into(), command]
    };
    let mut probe_env = env.clone();
    probe_env.insert("PUPPYONE_RESOLVING_ENVIRONMENT".into(), "1".into());
    probe_env.insert("DISABLE_AUTO_UPDATE".into(), "true".into());
    let result = run_probe(
        shell,
        args,
        ProbeOptions {
            env: Some(probe_env),
            cwd: Some(homedir.to_path_buf()),
            signal,
            timeout_ms,
            max_output_bytes: policy::MAX_OUTPUT_BYTES,
            label: "Desktop command environment".into(),
            platform: platform.to_string(),
            isolated_process_group: true,
        },
    )
    .await?;
    if result.code != Some(0) {
        return Err(AgentError::new("Shell environment failed."));
    }
    let opening = format!("\0{begin}\0");
    let closing = format!("\0{end}\0");
    let start = result.stdout.find(&opening);
    let finish = start.and_then(|start| {
        let from = start + opening.len();
        result.stdout[from..]
            .find(&closing)
            .map(|offset| from + offset)
    });
    let (Some(start), Some(finish)) = (start, finish) else {
        return Err(AgentError::new("Shell environment framing failed."));
    };
    let parsed: Vec<(String, String)> = result.stdout[start + opening.len()..finish]
        .split('\0')
        .filter_map(|entry| {
            let separator = entry.find('=').filter(|s| *s > 0)?;
            Some((
                entry[..separator].to_string(),
                entry[separator + 1..].to_string(),
            ))
        })
        .collect();
    let mut environment = normalize_environment(parsed.iter().map(|(k, v)| (k, v)), platform);
    if !environment.contains_key("PATH") {
        return Err(AgentError::new("Shell environment has no PATH."));
    }
    for key in ["PUPPYONE_RESOLVING_ENVIRONMENT", "DISABLE_AUTO_UPDATE"] {
        match env.get(key) {
            Some(value) => {
                environment.insert(key.into(), value.clone());
            }
            None => {
                environment.remove(key);
            }
        }
    }
    Ok(environment)
}

/// `normalizeEnvironment(env, platform)`.
pub fn normalize_environment<'a>(
    env: impl IntoIterator<Item = (&'a String, &'a String)>,
    platform: &str,
) -> EnvMap {
    let mut result = EnvMap::new();
    for (raw_key, value) in env {
        if !ENVIRONMENT_KEY.is_match(raw_key) || value.contains('\0') {
            continue;
        }
        let key = if platform == "win32"
            && (raw_key.eq_ignore_ascii_case("path") || raw_key.eq_ignore_ascii_case("pathext"))
        {
            raw_key.to_uppercase()
        } else {
            raw_key.clone()
        };
        result.insert(key, value.clone());
    }
    result
}
