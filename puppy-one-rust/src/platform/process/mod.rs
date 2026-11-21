//! Bounded, cancellable child processes, isolated process groups / Windows
//! Job Objects, and bootstrap pipes (`capabilities.md`). No process or pipe is
//! owned by a view.
mod pipes;
#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

/// Environment variable naming an inheritable bootstrap handle on Windows
/// (Unix children receive the bootstrap read end on fd 3).
pub const WINDOWS_BOOTSTRAP_HANDLE_ENV: &str = "PUPPYONE_BOOTSTRAP_HANDLE";

/// OS-owned subtree containment handle (Win32 Job Object on Windows; no-op on
/// Unix where `process_group(0)` already isolates the subtree).
pub struct SubtreeGuard {
    #[cfg(windows)]
    _job: Option<windows::JobHandle>,
}

impl SubtreeGuard {
    /// Attaches a spawned child process to an OS subtree guard (Job Object on
    /// Windows) so closing or terminating the guard reaps all descendants.
    pub fn attach_pid(pid: Option<u32>) -> Self {
        #[cfg(windows)]
        {
            Self {
                _job: pid.and_then(windows::attach_job),
            }
        }
        #[cfg(not(windows))]
        {
            let _ = pid;
            Self {}
        }
    }
}

/// Platform bootstrap pipe handed to a managed child process at spawn time.
pub struct BootstrapPipe {
    #[cfg(unix)]
    inner: unix::BootstrapPipe,
    #[cfg(windows)]
    inner: windows::BootstrapPipe,
}

impl BootstrapPipe {
    /// Creates an OS bootstrap pipe and configures `command` so the child
    /// inherits the read end (fd 3 on Unix; inheritable handle + env var on Windows).
    pub fn attach_tokio(command: &mut tokio::process::Command) -> std::io::Result<Self> {
        #[cfg(unix)]
        {
            Ok(Self {
                inner: unix::attach_bootstrap_pipe(command)?,
            })
        }
        #[cfg(windows)]
        {
            Ok(Self {
                inner: windows::attach_bootstrap_pipe(command)?,
            })
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = command;
            Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "A bootstrap pipe is unavailable on this platform.",
            ))
        }
    }

    /// Closes the parent's copy of the read end and writes `payload` to the
    /// child on a detached background thread, then closes the write end.
    pub fn deliver_async(self, payload: Vec<u8>) {
        #[cfg(unix)]
        self.inner.deliver_async(payload);
        #[cfg(windows)]
        self.inner.deliver_async(payload);
    }
}

/// Configures a `std::process::Command` in its own isolated process group.
pub fn isolate(command: &mut Command) {
    #[cfg(unix)]
    unix::isolate_std(command);
    #[cfg(windows)]
    windows::isolate_std(command);
    #[cfg(not(any(unix, windows)))]
    let _ = command;
}

/// Configures a `tokio::process::Command` in its own isolated process group.
pub fn isolate_tokio(command: &mut tokio::process::Command) {
    #[cfg(unix)]
    unix::isolate_tokio(command);
    #[cfg(windows)]
    windows::isolate_tokio(command);
    #[cfg(not(any(unix, windows)))]
    let _ = command;
}

/// Terminates a spawned child and its isolated descendants.
pub fn terminate(child: &mut std::process::Child) {
    #[cfg(unix)]
    unix::terminate_child(child);
    #[cfg(windows)]
    windows::terminate_child(child);
    #[cfg(not(any(unix, windows)))]
    {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Terminates a managed process by PID (and its process group when `grouped`).
pub fn terminate_pid(pid: u32, grouped: bool, force: bool) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        unix::terminate_pid(pid, grouped, force)
    }
    #[cfg(windows)]
    {
        windows::terminate_pid(pid, grouped, force)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (grouped, force);
        false
    }
}

/// The Node name of a POSIX terminating signal (`"SIGTERM"`).
#[cfg(unix)]
pub fn signal_name(signal: i32) -> String {
    unix::signal_name(signal)
}

pub fn bounded_read(mut reader: impl Read, max: usize) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut buf = [0; 8192];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            return Ok(bytes);
        }
        if bytes.len() + n > max {
            return Err(std::io::Error::other("Process output exceeded its limit"));
        }
        bytes.extend_from_slice(&buf[..n]);
    }
}

pub fn run(
    executable: &Path,
    args: &[&str],
    root: &Path,
    input: Option<&[u8]>,
    timeout: Duration,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, String> {
    run_output(
        executable,
        args,
        root,
        input,
        timeout,
        cancel,
        OutputLimits {
            stdout: 8 * 1024 * 1024,
            stderr: 256 * 1024,
        },
    )
    .map(|output| output.stdout)
}

/// Captured streams share the same child/pipe lifetime and cancellation owner.
/// Callers such as Office need successful stderr warnings as well as stdout.
pub struct Output {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}
#[derive(Clone, Copy)]
pub struct OutputLimits {
    pub stdout: usize,
    pub stderr: usize,
}
/// Per-command overrides are applied only to the child, never to this process.
pub struct OutputOptions<'a> {
    pub limits: OutputLimits,
    pub environment: &'a [(&'a str, &'a str)],
}
pub fn run_output(
    executable: &Path,
    args: &[&str],
    root: &Path,
    input: Option<&[u8]>,
    timeout: Duration,
    cancel: &AtomicBool,
    limits: OutputLimits,
) -> Result<Output, String> {
    run_output_with(
        executable,
        args,
        root,
        input,
        timeout,
        cancel,
        OutputOptions {
            limits,
            environment: &[],
        },
    )
}
pub fn run_output_with(
    executable: &Path,
    args: &[&str],
    root: &Path,
    input: Option<&[u8]>,
    timeout: Duration,
    cancel: &AtomicBool,
    options: OutputOptions<'_>,
) -> Result<Output, String> {
    let limits = options.limits;
    const CANCELLED: &str = "Command cancelled, timed out, or exceeded its output limit";
    if cancel.load(Ordering::Acquire) || timeout.is_zero() {
        return Err(CANCELLED.into());
    }
    let started = Instant::now();
    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(root)
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .envs(options.environment.iter().copied())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    isolate(&mut command);
    let child = command.spawn().map_err(|e| e.to_string())?;
    let _subtree = SubtreeGuard::attach_pid(Some(child.id()));
    thread::scope(move |scope| {
        // The owner lives inside the scope: any worker-start failure terminates
        // the child before scoped threads are joined, including blocked stdin.
        let stop = Arc::new(AtomicBool::new(false));
        let overflow = Arc::new(AtomicBool::new(false));
        let mut owner = ProcessOwner {
            child,
            stop: stop.clone(),
            settled: false,
        };
        let stdin = owner.child.stdin.take().expect("piped stdin");
        let stdout = owner.child.stdout.take().expect("piped stdout");
        let stderr = owner.child.stderr.take().expect("piped stderr");
        let stdin_ready = pipes::nonblocking(&stdin).map_err(|e| e.to_string())?;
        let stdout_ready = pipes::nonblocking(&stdout).map_err(|e| e.to_string())?;
        let stderr_ready = pipes::nonblocking(&stderr).map_err(|e| e.to_string())?;
        let out_stop = stop.clone();
        let out_limit = overflow.clone();
        let out = thread::Builder::new()
            .name("command-stdout".into())
            .spawn_scoped(scope, move || {
                let result = pipes::read(stdout, stdout_ready, limits.stdout, &out_stop);
                if result.is_err() {
                    out_limit.store(true, Ordering::Release);
                }
                result
            })
            .map_err(|e| e.to_string())?;
        let err_stop = stop.clone();
        let err_limit = overflow.clone();
        let err = thread::Builder::new()
            .name("command-stderr".into())
            .spawn_scoped(scope, move || {
                let result = pipes::read(stderr, stderr_ready, limits.stderr, &err_stop);
                if result.is_err() {
                    err_limit.store(true, Ordering::Release);
                }
                result
            })
            .map_err(|e| e.to_string())?;
        let mut writer = Some(
            thread::Builder::new()
                .name("command-stdin".into())
                .spawn_scoped(scope, move || {
                    pipes::write(stdin, stdin_ready, input.unwrap_or_default(), &stop)
                })
                .map_err(|e| e.to_string())?,
        );
        let mut written = None;
        let mut exited = None;
        let mut result = loop {
            if cancel.load(Ordering::Acquire)
                || overflow.load(Ordering::Acquire)
                || started.elapsed() >= timeout
            {
                break Err(CANCELLED.to_owned());
            }
            if writer.as_ref().is_some_and(|writer| writer.is_finished()) {
                written = Some(
                    writer
                        .take()
                        .unwrap()
                        .join()
                        .map_err(|_| "Input writer failed".to_owned())
                        .and_then(|r| r.map_err(|e| e.to_string())),
                );
            }
            if let Some(Err(error)) = &written {
                break Err(error.clone());
            }
            if exited.is_none() {
                match owner.child.try_wait() {
                    Ok(status) => exited = status,
                    Err(error) => break Err(error.to_string()),
                }
            }
            // A reaped parent is not completion while descendants hold a pipe.
            if writer.is_none()
                && out.is_finished()
                && err.is_finished()
                && let Some(status) = exited
            {
                break Ok(status);
            }
            thread::sleep(Duration::from_millis(10));
        };
        if let Err(reason) = &result {
            if let Err(error) = owner.terminate() {
                result = Err(format!("{reason}; process cleanup failed: {error}"));
            }
        } else {
            owner.settled = true;
        }
        let output = out.join().map_err(|_| "Output reader failed".to_owned());
        let errors = err.join().map_err(|_| "Error reader failed".to_owned());
        if let Some(writer) = writer {
            let _ = writer.join();
        }
        let status = result?;
        let output = output?.map_err(|e| e.to_string())?;
        let errors = errors?.map_err(|e| e.to_string())?;
        if status.success() {
            Ok(Output {
                stdout: output,
                stderr: errors,
            })
        } else {
            let error = String::from_utf8_lossy(&errors).trim().to_owned();
            Err(if error.is_empty() {
                String::from_utf8_lossy(&output).trim().to_owned()
            } else {
                error
            })
        }
    })
}

struct ProcessOwner {
    child: std::process::Child,
    stop: Arc<AtomicBool>,
    settled: bool,
}
impl ProcessOwner {
    fn terminate(&mut self) -> Result<(), String> {
        if self.settled {
            return Ok(());
        }
        self.stop.store(true, Ordering::Release);
        terminate(&mut self.child);
        self.settled = true;
        #[cfg(unix)]
        {
            unix::wait_process_group_gone(self.child.id())
        }
        #[cfg(not(unix))]
        Ok(())
    }
}
impl Drop for ProcessOwner {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}

#[cfg(all(test, unix))]
mod tests;
