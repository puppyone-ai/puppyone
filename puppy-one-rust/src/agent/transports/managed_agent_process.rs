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
/// A `bootstrap` envelope is written to the child's fd 3, which then
/// closes; it is not inherited further than the child.
pub fn create_managed_agent_process(
    executable_path: &Path,
    args: &[String],
    cwd: &Path,
    environment: Option<&[(String, String)]>,
    bootstrap: Option<&[u8]>,
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
    #[cfg(unix)]
    let pipe = match bootstrap {
        Some(_) => Some(bootstrap_pipe(&mut command)?),
        None => None,
    };
    #[cfg(not(unix))]
    if bootstrap.is_some() {
        return Err(AgentError::new(
            "A bootstrap pipe is unavailable on this platform.",
        ));
    }
    let child = command.spawn().map_err(AgentError::from)?;
    #[cfg(unix)]
    if let (Some((read, write)), Some(payload)) = (pipe, bootstrap) {
        drop(read);
        let payload = payload.to_vec();
        std::thread::spawn(move || {
            use std::io::Write;
            let mut pipe = std::fs::File::from(write);
            let _ = pipe.write_all(&payload);
        });
    }
    let pid = child.id();
    Ok(ManagedAgentProcess {
        child,
        pid,
        grouped: cfg!(unix),
    })
}

/// A close-on-exec pipe whose read end the child receives as fd 3.
#[cfg(unix)]
fn bootstrap_pipe(
    command: &mut Command,
) -> AgentResult<(std::os::fd::OwnedFd, std::os::fd::OwnedFd)> {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    let mut fds = [0; 2];
    if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let (read, write) = unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) };
    for fd in [read.as_raw_fd(), write.as_raw_fd()] {
        unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) };
    }
    let source = read.as_raw_fd();
    unsafe {
        command.pre_exec(move || {
            if source == 3 {
                // dup2 onto itself keeps close-on-exec; clear it instead.
                if libc::fcntl(3, libc::F_SETFD, 0) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
            } else if libc::dup2(source, 3) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    Ok((read, write))
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
