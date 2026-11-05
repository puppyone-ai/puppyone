//! `connections/probes/bounded-probe-command.mjs`: a minimal probe
//! environment that never forwards credential-shaped variables.
use crate::agent::agent_error::AgentResult;
use crate::agent::transports::bounded_process_probe::{
    ProbeOptions, ProbeResult, run_bounded_process_probe,
};
use crate::platform::common::command_environment::EnvMap;

pub const LOCAL_AGENT_PROBE_TIMEOUT_MS: u64 = 1_500;
pub const LOCAL_AGENT_PROBE_MAX_OUTPUT_BYTES: usize = 16 * 1024;

const ENVIRONMENT_ALLOWLIST: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
];

/// `createProbeEnvironment(baseEnv)`.
pub fn create_probe_environment(base: &EnvMap) -> EnvMap {
    let mut environment: EnvMap = ENVIRONMENT_ALLOWLIST
        .iter()
        .filter_map(|key| {
            base.get(*key)
                .filter(|value| {
                    crate::agent::contract::js::len16(value) <= 8_192 && !value.contains('\0')
                })
                .map(|value| (key.to_string(), value.clone()))
        })
        .collect();
    environment.insert("TERM".into(), "dumb".into());
    environment.insert("NO_COLOR".into(), "1".into());
    environment.insert("PUPPYONE_AGENT_PROBE".into(), "1".into());
    environment
}

/// `runBoundedProbeCommand(executablePath, args, options)`: the host's
/// minimal environment unless `options.env` is given.
pub async fn run_bounded_probe_command(
    executable_path: &str,
    args: &[String],
    mut options: ProbeOptions,
) -> AgentResult<ProbeResult> {
    if options.env.is_none() {
        options.env = Some(create_probe_environment(&std::env::vars().collect()));
    }
    run_bounded_process_probe(executable_path, args, options).await
}
