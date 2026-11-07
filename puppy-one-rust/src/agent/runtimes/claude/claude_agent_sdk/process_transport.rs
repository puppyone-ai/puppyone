//! The SDK's `ProcessTransport`: the native Claude Code CLI launched with
//! stream-json stdio, its arguments and environment, stdin writes and the
//! exit observation.
use super::{CLAUDE_AGENT_SDK_VERSION, QueryOptions, SpawnOptions};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::tasks::{CancelSignal, Canceller, spawn_after};
use crate::agent::transports::jsonl_rpc_connection::{
    ConnectionOptions, ProcessIo, spawn_managed_process,
};
use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Notify, mpsc};
use tokio::task::spawn_local;

/// `Tx`: the grace a closed CLI gets to exit on stdin EOF.
const CLOSE_GRACE_MS: u64 = 2_000;
const FORCE_KILL_MS: u64 = 5_000;

/// The SDK's `AbortError`.
pub fn abort_error(message: &str) -> AgentError {
    AgentError::new(message).with_name("AbortError")
}

pub fn is_abort_error(error: &AgentError) -> bool {
    error.name.as_deref() == Some("AbortError")
}

fn truthy_flag(value: Option<&String>) -> bool {
    value.is_some_and(|value| {
        matches!(
            value.trim().to_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

/// The process environment `query()` builds (`processEnv`).
pub fn build_env(options: &QueryOptions) -> EnvMap {
    let mut env = options
        .env
        .clone()
        .unwrap_or_else(|| std::env::vars().collect());
    if env
        .get("CLAUDE_CODE_ENTRYPOINT")
        .is_none_or(String::is_empty)
    {
        env.insert("CLAUDE_CODE_ENTRYPOINT".into(), "sdk-ts".into());
    }
    if env
        .get("CLAUDE_AGENT_SDK_VERSION")
        .is_none_or(String::is_empty)
    {
        env.insert(
            "CLAUDE_AGENT_SDK_VERSION".into(),
            CLAUDE_AGENT_SDK_VERSION.into(),
        );
    }
    env.remove("NODE_OPTIONS");
    if truthy_flag(env.get("DEBUG_CLAUDE_AGENT_SDK")) {
        env.insert("DEBUG".into(), "1".into());
    } else {
        env.remove("DEBUG");
    }
    env
}

/// The CLI arguments `ProcessTransport.initialize()` builds.
pub fn build_args(options: &QueryOptions) -> Vec<String> {
    let mut args: Vec<String> = [
        "--output-format",
        "stream-json",
        "--verbose",
        "--input-format",
        "stream-json",
    ]
    .map(str::to_string)
    .to_vec();
    let mut push = |flag: &str, value: &str| {
        args.push(flag.into());
        args.push(value.into());
    };
    if let Some(effort) = options.effort.as_deref().filter(|e| !e.is_empty()) {
        push("--effort", effort);
    }
    if let Some(model) = options.model.as_deref().filter(|m| !m.is_empty()) {
        push("--model", model);
    }
    if options.can_use_tool.is_some() {
        push("--permission-prompt-tool", "stdio");
    }
    if let Some(resume) = options.resume.as_deref().filter(|r| !r.is_empty()) {
        push("--resume", resume);
    }
    if let Some(sources) = options.setting_sources.as_ref() {
        args.push(format!("--setting-sources={}", sources.join(",")));
    }
    let mode = options.permission_mode.as_deref().unwrap_or("default");
    args.push("--permission-mode".into());
    args.push(mode.into());
    if options.include_partial_messages {
        args.push("--include-partial-messages".into());
    }
    if let Some(session_id) = options.session_id.as_deref().filter(|s| !s.is_empty()) {
        args.push("--session-id".into());
        args.push(session_id.into());
    }
    args
}

/// `isNativeBinary(path)`: anything but a JavaScript entrypoint.
fn native_binary(path: &str) -> bool {
    ![".js", ".mjs", ".tsx", ".ts", ".jsx"]
        .iter()
        .any(|suffix| path.ends_with(suffix))
}

/// `(code, signal, error)` once the process is gone.
type ExitSignal = (Option<i32>, Option<String>, Option<AgentError>);

#[derive(Default)]
struct ExitState {
    exited: Cell<bool>,
    error: RefCell<Option<AgentError>>,
    notify: Notify,
}

/// `new ProcessTransport(options)`.
pub struct ProcessTransport(Rc<Inner>);

struct Inner {
    abort: CancelSignal,
    forwarded: Canceller,
    writer: RefCell<Option<mpsc::UnboundedSender<Vec<u8>>>>,
    input_ended: Cell<bool>,
    stdout: RefCell<Option<Box<dyn AsyncRead + Unpin>>>,
    exit: Rc<ExitState>,
    kill: Rc<dyn Fn(bool) -> bool>,
    ready: Cell<bool>,
    abort_listener: Cell<Option<u64>>,
}

impl Clone for ProcessTransport {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl ProcessTransport {
    /// Launches the CLI (`initialize()`).
    pub fn spawn(options: &QueryOptions, abort: &Canceller) -> AgentResult<Self> {
        let Some(executable) = options
            .path_to_claude_code_executable
            .clone()
            .filter(|path| !path.is_empty())
        else {
            return Err(AgentError::new(format!(
                "Native CLI binary for {}-{} not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set options.pathToClaudeCodeExecutable.",
                crate::agent::discovery::bounded_process_probe::node_platform(),
                std::env::consts::ARCH,
            )));
        };
        let args = build_args(options);
        let (command, args) = if native_binary(&executable) {
            (executable, args)
        } else {
            (
                "node".to_string(),
                std::iter::once(executable).chain(args).collect(),
            )
        };
        let forwarded = Canceller::new();
        let spawn_options = SpawnOptions {
            command,
            args,
            cwd: options.cwd.clone(),
            env: build_env(options),
            signal: forwarded.signal(),
        };
        let io = match options.spawn_claude_code_process.as_ref() {
            Some(launch) => launch.launch(spawn_options)?,
            None => spawn_local_process(spawn_options, options.stderr.clone())?,
        };
        let ProcessIo {
            stdin,
            stdout,
            stderr: _,
            exit,
            kill,
        } = io;
        let (writer, mut queue) = mpsc::unbounded_channel::<Vec<u8>>();
        spawn_local(async move {
            let mut stdin = stdin;
            while let Some(bytes) = queue.recv().await {
                if stdin.write_all(&bytes).await.is_err() || stdin.flush().await.is_err() {
                    break;
                }
            }
            let _ = stdin.shutdown().await;
        });
        let state = Rc::new(ExitState::default());
        let transport = Self(Rc::new(Inner {
            abort: abort.signal(),
            forwarded,
            writer: RefCell::new(Some(writer)),
            input_ended: Cell::new(false),
            stdout: RefCell::new(Some(stdout)),
            exit: state.clone(),
            kill,
            ready: Cell::new(false),
            abort_listener: Cell::new(None),
        }));
        let abort_signal = abort.signal();
        spawn_local(async move {
            let (code, signal, error): ExitSignal = exit.await;
            let exit_error = if abort_signal.is_cancelled() {
                Some(abort_error("Claude Code process aborted by user"))
            } else if let Some(error) = error {
                Some(AgentError::new(format!(
                    "Failed to spawn Claude Code process: {}",
                    error.message
                )))
            } else {
                process_exit_error(code, signal.as_deref())
            };
            state.exited.set(true);
            *state.error.borrow_mut() = exit_error;
            state.notify.notify_waiters();
        });
        let weak = Rc::downgrade(&transport.0);
        let listener = abort.signal().on_cancel(move || {
            if let Some(inner) = weak.upgrade() {
                ProcessTransport(inner).close();
            }
        });
        transport.0.abort_listener.set(Some(listener));
        if abort.signal().is_cancelled() {
            transport.close();
        }
        transport.0.ready.set(!abort.signal().is_cancelled());
        Ok(transport)
    }

    /// The CLI's stdout, once (`readMessages()`).
    pub fn take_stdout(&self) -> Option<Box<dyn AsyncRead + Unpin>> {
        self.0.stdout.borrow_mut().take()
    }

    /// `write(data)`.
    pub fn write(&self, data: String) -> AgentResult<()> {
        let inner = &self.0;
        if inner.abort.is_cancelled() {
            return Err(abort_error("Operation aborted"));
        }
        if !inner.ready.get() {
            return Err(AgentError::new("ProcessTransport is not ready for writing"));
        }
        if inner.input_ended.get() {
            return Ok(());
        }
        if inner.exit.exited.get() {
            return Err(AgentError::new("Cannot write to terminated process"));
        }
        if let Some(error) = inner.exit.error.borrow().as_ref() {
            return Err(AgentError::new(format!(
                "Cannot write to process that exited with error: {}",
                error.message
            )));
        }
        let Some(writer) = inner.writer.borrow().clone() else {
            return Err(AgentError::new("ProcessTransport is not ready for writing"));
        };
        writer.send(data.into_bytes()).map_err(|_| {
            inner.ready.set(false);
            AgentError::new("Failed to write to process stdin: stdin closed")
        })
    }

    /// `endInput()`: closes the CLI's stdin.
    pub fn end_input(&self) {
        self.0.input_ended.set(true);
        self.0.writer.borrow_mut().take();
    }

    /// `close()`: ends stdin; a CLI that does not exit within the grace is
    /// terminated.
    pub fn close(&self) {
        let inner = &self.0;
        inner.writer.borrow_mut().take();
        inner.input_ended.set(true);
        if let Some(listener) = inner.abort_listener.take() {
            inner.abort.forget(listener);
        }
        let forward = {
            let (abort, forwarded) = (inner.abort.clone(), inner.forwarded.clone());
            move || {
                if let Some(reason) = abort.reason() {
                    forwarded.cancel(reason);
                }
            }
        };
        if inner.exit.exited.get() {
            forward();
        } else {
            let (exit, kill) = (inner.exit.clone(), inner.kill.clone());
            drop(spawn_after(
                Duration::from_millis(CLOSE_GRACE_MS),
                move || {
                    if exit.exited.get() {
                        forward();
                        return;
                    }
                    kill(false);
                    let (exit, kill) = (exit.clone(), kill.clone());
                    drop(spawn_after(
                        Duration::from_millis(FORCE_KILL_MS),
                        move || {
                            if !exit.exited.get() {
                                kill(true);
                            }
                        },
                    ));
                    forward();
                },
            ));
        }
        inner.ready.set(false);
    }

    /// The exit error, once the process has exited.
    pub fn exit_error(&self) -> Option<AgentError> {
        self.0.exit.error.borrow().clone()
    }

    /// `waitForExit()`: rejects with the exit error.
    pub async fn wait_for_exit(&self) -> AgentResult<()> {
        let state = self.0.exit.clone();
        loop {
            let notified = state.notify.notified();
            if state.exited.get() {
                return match state.error.borrow().clone() {
                    Some(error) => Err(error),
                    None => Ok(()),
                };
            }
            notified.await;
        }
    }
}

/// `getProcessExitError(code, signal)`.
fn process_exit_error(code: Option<i32>, signal: Option<&str>) -> Option<AgentError> {
    match (code, signal) {
        (Some(code), _) if code != 0 => Some(AgentError::new(format!(
            "Claude Code process exited with code {code}"
        ))),
        (_, Some(signal)) => Some(AgentError::new(format!(
            "Claude Code process terminated by signal {signal}"
        ))),
        _ => None,
    }
}

/// `spawnLocalProcess(options)`: without a custom spawn hook.
fn spawn_local_process(
    options: SpawnOptions,
    on_stderr: Option<super::StderrSink>,
) -> AgentResult<ProcessIo> {
    let debug = truthy_flag(options.env.get("DEBUG_CLAUDE_AGENT_SDK"));
    let mut io = spawn_managed_process(&ConnectionOptions {
        executable_path: PathBuf::from(&options.command),
        args: options.args,
        cwd: options
            .cwd
            .map(PathBuf::from)
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_default(),
        env: Some(options.env.into_iter().collect()),
        ..Default::default()
    })?;
    let mut stderr: Box<dyn AsyncRead + Unpin> =
        std::mem::replace(&mut io.stderr, Box::new(tokio::io::empty()));
    spawn_local(async move {
        let mut buffer = vec![0u8; 8_192];
        while let Ok(read) = stderr.read(&mut buffer).await {
            if read == 0 {
                break;
            }
            let text = String::from_utf8_lossy(&buffer[..read]);
            if debug {
                eprintln!("{text}");
            }
            if let Some(on_stderr) = on_stderr.as_ref() {
                on_stderr(&text);
            }
        }
    });
    let kill = io.kill.clone();
    options.signal.on_cancel(move || {
        kill(false);
    });
    Ok(io)
}
