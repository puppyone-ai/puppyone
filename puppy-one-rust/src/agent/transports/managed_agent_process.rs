//! `transports/managed-agent-process.mjs`: one native Agent launched in an
//! isolated process group (Unix) or Win32 Job Object (Windows) so termination
//! reaches its descendants.
use crate::{
    agent::{
        agent_error::{AgentError, AgentResult},
        discovery::{
            command_environment::EnvMap, windows::process_invocation::resolve_process_invocation,
        },
    },
    platform::process::{self, BootstrapPipe, SubtreeGuard},
};
use std::path::Path;
use tokio::process::{Child, Command};

/// Owned parts of a [`ManagedAgentProcess`].
///
/// Decomposing through [`ManagedAgentProcess::into_parts`] ensures the caller
/// takes explicit ownership of `subtree` alongside `child` instead of letting
/// `SubtreeGuard` drop early (which terminates the Win32 Job Object on Windows).
pub struct ManagedProcessParts {
    pub child: Child,
    pub pid: Option<u32>,
    pub grouped: bool,
    pub subtree: SubtreeGuard,
}

/// A launched native Agent process and its OS subtree containment guard.
#[must_use = "dropping ManagedAgentProcess terminates the managed process subtree on Windows"]
pub struct ManagedAgentProcess {
    child: Child,
    pid: Option<u32>,
    grouped: bool,
    subtree: SubtreeGuard,
}

impl ManagedAgentProcess {
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    pub fn grouped(&self) -> bool {
        self.grouped
    }

    pub fn child_mut(&mut self) -> &mut Child {
        &mut self.child
    }

    /// Terminates this managed process and its isolated descendants.
    pub fn terminate(&self, force: bool) -> bool {
        self.subtree.terminate(force)
    }

    /// Decomposes the managed process into its child handle and subtree guard.
    pub fn into_parts(self) -> ManagedProcessParts {
        ManagedProcessParts {
            child: self.child,
            pid: self.pid,
            grouped: self.grouped,
            subtree: self.subtree,
        }
    }
}

/// `createManagedAgentProcess({ spawn, executablePath, args, options })`.
/// A `bootstrap` envelope is delivered over the OS bootstrap pipe (fd 3 on
/// Unix; `PUPPYONE_BOOTSTRAP_HANDLE` on Windows).
pub fn create_managed_agent_process(
    executable_path: &Path,
    args: &[String],
    cwd: &Path,
    environment: Option<&[(String, String)]>,
    bootstrap: Option<&[u8]>,
) -> AgentResult<ManagedAgentProcess> {
    let mut command = match executable_path.to_str() {
        Some(executable) => {
            let invocation_env: EnvMap = match environment {
                Some(entries) => entries.iter().cloned().collect(),
                None => std::env::vars().collect(),
            };
            let invocation = resolve_process_invocation(
                executable,
                args,
                process::node_platform(),
                &invocation_env,
            )?;
            let mut command = Command::new(&invocation.file);
            process::apply_tokio_args(&mut command, &invocation.args, invocation.verbatim_arguments);
            command
        }
        None => {
            let mut command = Command::new(executable_path);
            command.args(args);
            command
        }
    };
    command
        .current_dir(cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(false);
    if let Some(environment) = environment {
        command.env_clear();
        command.envs(environment.iter().map(|(k, v)| (k.as_str(), v.as_str())));
    }
    process::isolate_tokio(&mut command);
    let pipe = match bootstrap {
        Some(_) => Some(BootstrapPipe::attach_tokio(&mut command)?),
        None => None,
    };
    let child = command.spawn().map_err(AgentError::from)?;
    let pid = child.id();
    let subtree = SubtreeGuard::attach_pid(pid);
    if let (Some(pipe), Some(payload)) = (pipe, bootstrap) {
        pipe.deliver_async(payload.to_vec());
    }
    Ok(ManagedAgentProcess {
        child,
        pid,
        grouped: true,
        subtree,
    })
}

/// `terminateManagedAgentProcess(processHandle, signal)`: terminates the
/// harness and its isolated descendants; falls back to the direct child.
pub fn terminate_managed_agent_process(pid: Option<u32>, grouped: bool, force: bool) -> bool {
    let Some(pid) = pid.filter(|p| *p > 0) else {
        return false;
    };
    process::terminate_pid(pid, grouped, force)
}

/// The Node name of a terminating POSIX signal (`"SIGTERM"`).
pub fn signal_name(signal: i32) -> String {
    process::signal_name(signal)
}
