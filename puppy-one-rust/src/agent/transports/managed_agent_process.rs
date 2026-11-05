//! `transports/managed-agent-process.mjs`: one native Agent launched as an
//! isolated POSIX process group, so termination reaches its descendants.
use crate::agent::agent_error::{AgentError, AgentResult};
use std::path::Path;
use tokio::process::{Child, Command};

/// A launched native Agent process.
pub struct ManagedAgentProcess {
    pub child: Child,
    pub pid: Option<u32>,
    pub grouped: bool,
}

/// `createManagedAgentProcess({ spawn, executablePath, args, options })`.
pub fn create_managed_agent_process(
    executable_path: &Path,
    args: &[String],
    cwd: &Path,
    environment: Option<&[(String, String)]>,
) -> AgentResult<ManagedAgentProcess> {
    let mut command = Command::new(executable_path);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(false);
    if let Some(environment) = environment {
        command.env_clear();
        command.envs(environment.iter().map(|(k, v)| (k.as_str(), v.as_str())));
    }
    #[cfg(unix)]
    command.process_group(0);
    let child = command.spawn().map_err(AgentError::from)?;
    let pid = child.id();
    Ok(ManagedAgentProcess {
        child,
        pid,
        grouped: cfg!(unix),
    })
}

/// `terminateManagedAgentProcess(processHandle, signal)`: the harness and
/// its descendants; falls back to the direct child.
pub fn terminate_managed_agent_process(pid: Option<u32>, grouped: bool, force: bool) -> bool {
    let Some(pid) = pid.filter(|p| *p > 0) else {
        return false;
    };
    #[cfg(unix)]
    {
        let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
        // Only signal the process group created at launch, never the app's own group.
        if grouped && unsafe { libc::kill(-(pid as i32), signal) } == 0 {
            return true;
        }
        unsafe { libc::kill(pid as i32, signal) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = (grouped, force);
        false
    }
}

/// The Node name of a terminating signal (`"SIGTERM"`).
#[cfg(unix)]
pub fn signal_name(signal: i32) -> String {
    match signal {
        libc::SIGTERM => "SIGTERM".into(),
        libc::SIGKILL => "SIGKILL".into(),
        libc::SIGINT => "SIGINT".into(),
        libc::SIGHUP => "SIGHUP".into(),
        libc::SIGPIPE => "SIGPIPE".into(),
        other => format!("SIG{other}"),
    }
}
