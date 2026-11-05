//! `platform/common/bounded-process-probe.mjs`: one short-lived child with
//! bounded output, a hard deadline and cancellation. Runtime probes and
//! platform environment acquisition share these budgets.
use super::command_environment::EnvMap;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::event_loop::AbortSignal;
use crate::agent::node_path::flavor::{posix_is_absolute, win32_is_absolute};
use crate::platform::windows::process_invocation::resolve_process_invocation;
use futures_util::future::LocalBoxFuture;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};

/// `runBoundedProcessProbe(file, args, options)` options.
#[derive(Clone)]
pub struct ProbeOptions {
    /// `None` inherits the host environment.
    pub env: Option<EnvMap>,
    pub cwd: Option<PathBuf>,
    pub timeout_ms: u64,
    pub max_output_bytes: usize,
    pub signal: Option<AbortSignal>,
    pub label: String,
    pub platform: String,
    pub isolated_process_group: bool,
}

impl Default for ProbeOptions {
    fn default() -> Self {
        Self {
            env: None,
            cwd: None,
            timeout_ms: 1_500,
            max_output_bytes: 16 * 1024,
            signal: None,
            label: "Desktop process probe".into(),
            platform: node_platform().into(),
            isolated_process_group: false,
        }
    }
}

/// `{ stdout, stderr, code, signal }`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProbeResult {
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i32>,
    pub signal: Option<String>,
}

/// An injectable probe (`runProbe`).
pub type ProbeRunner = Rc<
    dyn Fn(String, Vec<String>, ProbeOptions) -> LocalBoxFuture<'static, AgentResult<ProbeResult>>,
>;

/// The default runner.
pub fn default_probe_runner() -> ProbeRunner {
    Rc::new(|file, args, options| {
        Box::pin(async move { run_bounded_process_probe(&file, &args, options).await })
    })
}

/// `process.platform`.
pub fn node_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "win32"
    } else {
        "linux"
    }
}

fn validate_launch(executable_path: &str, args: &[String]) -> AgentResult<()> {
    let unsafe_text = |value: &str| value.contains(['\r', '\n', '\0']);
    if !(posix_is_absolute(executable_path) || win32_is_absolute(executable_path))
        || unsafe_text(executable_path)
    {
        return Err(
            AgentError::new("Local Agent probes require a safe absolute executable path.")
                .with_name("TypeError"),
        );
    }
    if args.len() > 16
        || args
            .iter()
            .any(|arg| crate::agent::contract::js::len16(arg) > 4_096 || unsafe_text(arg))
    {
        return Err(
            AgentError::new("Local Agent probe arguments are invalid.").with_name("TypeError")
        );
    }
    Ok(())
}

async fn read_bounded(
    mut reader: impl AsyncRead + Unpin,
    total: Arc<AtomicUsize>,
    limit: usize,
) -> Result<Vec<u8>, ()> {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => return Ok(bytes),
            Ok(count) => {
                if total.fetch_add(count, Ordering::Relaxed) + count > limit {
                    return Err(());
                }
                bytes.extend_from_slice(&buffer[..count]);
            }
        }
    }
}

/// `runBoundedProcessProbe(executablePath, args, options)`.
pub async fn run_bounded_process_probe(
    executable_path: &str,
    args: &[String],
    options: ProbeOptions,
) -> AgentResult<ProbeResult> {
    validate_launch(executable_path, args)?;
    let label = options.label.clone();
    let failure = |reason: &str| AgentError::new(format!("{label} {reason}"));
    if options.signal.as_ref().is_some_and(AbortSignal::aborted) {
        return Err(failure("was cancelled."));
    }
    let inherited: EnvMap;
    let env = match options.env.as_ref() {
        Some(env) => env,
        None => {
            inherited = std::env::vars().collect();
            &inherited
        }
    };
    let invocation = resolve_process_invocation(executable_path, args, &options.platform, env)
        .map_err(|_| failure("could not start."))?;
    let mut command = tokio::process::Command::new(&invocation.file);
    command
        .args(&invocation.args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = options.cwd.as_ref() {
        command.current_dir(cwd);
    }
    if let Some(env) = options.env.as_ref() {
        command.env_clear().envs(env);
    }
    let grouped = options.isolated_process_group && options.platform != "win32";
    #[cfg(unix)]
    if grouped {
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|_| failure("could not start."))?;
    let pid = child.id();
    let kill = |child: &mut tokio::process::Child| {
        #[cfg(unix)]
        if grouped && let Some(pid) = pid.filter(|p| *p > 0) {
            // Only the probe's own process group, never the app's.
            if unsafe { libc::kill(-(pid as i32), libc::SIGKILL) } == 0 {
                return;
            }
        }
        let _ = child.start_kill();
    };
    let total = Arc::new(AtomicUsize::new(0));
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let limit = options.max_output_bytes;
    let output = async {
        let (stdout, stderr) = tokio::join!(
            read_bounded(stdout, total.clone(), limit),
            read_bounded(stderr, total.clone(), limit)
        );
        match (stdout, stderr) {
            (Ok(stdout), Ok(stderr)) => Ok((stdout, stderr)),
            _ => Err(()),
        }
    };
    let deadline =
        tokio::time::Instant::now() + Duration::from_millis(options.timeout_ms.clamp(1, 10_000));
    let cancelled = async {
        match options.signal.as_ref() {
            Some(signal) => {
                signal.aborted_reason().await;
            }
            None => futures_util::future::pending::<()>().await,
        }
    };
    enum Outcome {
        Output(Result<(Vec<u8>, Vec<u8>), ()>),
        Timeout,
        Cancelled,
    }
    let outcome = tokio::select! {
        output = output => Outcome::Output(output),
        _ = tokio::time::sleep_until(deadline) => Outcome::Timeout,
        _ = cancelled => Outcome::Cancelled,
    };
    let (stdout, stderr) = match outcome {
        Outcome::Output(Ok(output)) => output,
        Outcome::Output(Err(())) => {
            kill(&mut child);
            return Err(failure("output exceeded the safety limit."));
        }
        Outcome::Timeout => {
            kill(&mut child);
            return Err(failure("timed out."));
        }
        Outcome::Cancelled => {
            kill(&mut child);
            return Err(failure("was cancelled."));
        }
    };
    let status = tokio::select! {
        status = child.wait() => status.map_err(|_| failure("could not start."))?,
        _ = tokio::time::sleep_until(deadline) => {
            kill(&mut child);
            return Err(failure("timed out."));
        }
    };
    #[cfg(unix)]
    let signal = std::os::unix::process::ExitStatusExt::signal(&status)
        .map(crate::agent::transports::managed_agent_process::signal_name);
    #[cfg(not(unix))]
    let signal: Option<String> = None;
    Ok(ProbeResult {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        code: status.code(),
        signal,
    })
}
