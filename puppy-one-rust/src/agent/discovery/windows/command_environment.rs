//! `platform/windows/command-environment.mjs`: a new child of Desktop
//! inherits its old PATH, so the persistent PATH is read afresh.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::discovery::bounded_process_probe::{ProbeOptions, ProbeRunner};
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::event_loop::AbortSignal;
use crate::agent::node_path::flavor::{win32_is_absolute, win32_join};
use serde_json::Value;
use std::path::Path;

/// `readWindowsCommandEnvironment({ env, homedir, signal, runProbe, timeoutMs })`.
pub async fn read_windows_command_environment(
    env: &EnvMap,
    homedir: &Path,
    signal: Option<AbortSignal>,
    run_probe: &ProbeRunner,
    timeout_ms: u64,
) -> AgentResult<EnvMap> {
    let system_root = ["SystemRoot", "SYSTEMROOT", "windir"]
        .iter()
        .find_map(|key| env.get(*key).filter(|v| !v.is_empty()))
        .filter(|root| win32_is_absolute(root))
        .ok_or_else(|| AgentError::new("Windows system root unavailable."))?;
    let file = win32_join(&[
        system_root,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
    ]);
    let script = [
        "$ErrorActionPreference='Stop'",
        "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)",
        "$m=[Environment]::GetEnvironmentVariables('Machine')",
        "$u=[Environment]::GetEnvironmentVariables('User')",
        "foreach($k in $m.Keys){[Environment]::SetEnvironmentVariable($k,[string]$m[$k],'Process')}",
        "foreach($k in $u.Keys){if($k -ine 'Path'){[Environment]::SetEnvironmentVariable($k,[string]$u[$k],'Process')}}",
        "$p=@($m['Path'],$u['Path']) | Where-Object { $null -ne $_ -and $_ -ne '' }",
        "$v=@{PATH=[Environment]::ExpandEnvironmentVariables(($p -join ';'));PATHEXT=[Environment]::GetEnvironmentVariable('PATHEXT')}",
        "[Console]::Write(($v | ConvertTo-Json -Compress))",
    ]
    .join("; ");
    let result = run_probe(
        file,
        vec![
            "-NoLogo".into(),
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-Command".into(),
            script,
        ],
        ProbeOptions {
            env: Some(env.clone()),
            cwd: Some(homedir.to_path_buf()),
            signal,
            timeout_ms,
            max_output_bytes: 256 * 1024,
            label: "Windows command environment".into(),
            platform: "win32".into(),
            isolated_process_group: false,
        },
    )
    .await?;
    if result.code != Some(0) {
        return Err(AgentError::new("Windows environment failed."));
    }
    let values: Value = serde_json::from_str(result.stdout.trim_start_matches('\u{feff}'))
        .map_err(|error| AgentError::new(error.to_string()))?;
    let path = values
        .get("PATH")
        .and_then(Value::as_str)
        .filter(|path| !path.contains('\0'))
        .ok_or_else(|| AgentError::new("Windows PATH unavailable."))?;
    let mut environment = env.clone();
    environment.insert("PATH".into(), path.to_string());
    if let Some(extensions) = values.get("PATHEXT").and_then(Value::as_str) {
        environment.insert("PATHEXT".into(), extensions.to_string());
    }
    Ok(environment)
}
