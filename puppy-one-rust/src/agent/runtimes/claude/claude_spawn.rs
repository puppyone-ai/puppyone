//! `runtimes/claude/claude-spawn.mjs`: the Agent SDK's spawn hook for
//! Node-backed and native Claude Code installs. Every process is owned
//! until it exits, so the adapter can wait for its own processes.
use super::claude_agent_sdk::{SpawnClaudeCodeProcess, SpawnOptions};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js;
use crate::agent::event_loop::{AbortSignal, Timer, set_timeout, spawn};
use crate::agent::node_path;
use crate::agent::transports::jsonl_rpc_connection::{
    ConnectionOptions, ProcessIo, Spawner, spawn_managed_process,
};
use futures_util::FutureExt;
use futures_util::future::{LocalBoxFuture, join_all};
use regex::Regex;
use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::Notify;

static NODE_ENTRYPOINT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\.(?:c?js|mjs)$").expect("pattern"));

/// `waitForManagedAgentExit`'s default bound.
const EXIT_CONFIRMATION_MS: u64 = 3_500;
const FORCE_KILL_MS: u64 = 2_000;

/// `fsModule.accessSync(path, X_OK)`.
pub type ExecutableCheck = Rc<dyn Fn(&Path) -> bool>;

/// `createClaudeSpawn({ spawn, fsModule, onStderr })`.
#[derive(Clone, Default)]
pub struct ClaudeSpawnOptions {
    pub spawn: Option<Spawner>,
    pub is_executable: Option<ExecutableCheck>,
    pub on_stderr: Option<super::claude_agent_sdk::StderrSink>,
    /// `process.platform`.
    pub platform: Option<String>,
    /// `process.execPath`.
    pub exec_path: Option<PathBuf>,
}

/// One owned process (`lease`).
struct Lease {
    signal: Option<AbortSignal>,
    exited: Cell<bool>,
    exit: Notify,
    kill: Rc<dyn Fn(bool) -> bool>,
    kill_timer: RefCell<Option<Timer>>,
    stopping: Cell<bool>,
    abort_listener: Cell<Option<u64>>,
}

impl Lease {
    /// `lease.stop()`: SIGTERM, then SIGKILL after two seconds.
    fn stop(self: &Rc<Self>) {
        if self.exited.get() || self.stopping.replace(true) {
            return;
        }
        (self.kill)(false);
        let lease = Rc::downgrade(self);
        *self.kill_timer.borrow_mut() = Some(set_timeout(FORCE_KILL_MS, move || {
            if let Some(lease) = lease.upgrade()
                && !lease.exited.get()
            {
                (lease.kill)(true);
            }
        }));
    }

    async fn wait(self: Rc<Self>) -> AgentResult<()> {
        let confirmed = async {
            loop {
                let notified = self.exit.notified();
                if self.exited.get() {
                    return;
                }
                notified.await;
            }
        };
        tokio::time::timeout(Duration::from_millis(EXIT_CONFIRMATION_MS), confirmed)
            .await
            .map_err(|_| AgentError::new("Native Agent process exit could not be confirmed."))
    }
}

/// The spawn hook (`launch`, `launch.waitForExit`, `launch.dispose`).
#[derive(Clone)]
pub struct ClaudeSpawn(Rc<Inner>);

struct Inner {
    options: ClaudeSpawnOptions,
    processes: RefCell<Vec<Rc<Lease>>>,
    closed: Cell<bool>,
}

fn invalid_text(value: &str) -> bool {
    value.contains(['\r', '\n', '\0'])
}

impl ClaudeSpawn {
    pub fn new(options: ClaudeSpawnOptions) -> Self {
        Self(Rc::new(Inner {
            options,
            processes: RefCell::default(),
            closed: Cell::new(false),
        }))
    }

    /// The number of processes still owned.
    pub fn active(&self) -> usize {
        self.0.processes.borrow().len()
    }

    /// `launch(options)`.
    pub fn launch_process(&self, options: SpawnOptions) -> AgentResult<ProcessIo> {
        let inner = &self.0;
        if inner.closed.get() {
            return Err(AgentError::new("Claude Code process owner has closed."));
        }
        options.signal.throw_if_aborted()?;
        let mut command = options.command.clone();
        let mut args = options.args.clone();
        let path_value = options.env.get("PATH").map(String::as_str);
        if NODE_ENTRYPOINT.is_match(&command) {
            let Some(node) = self.resolve_node_executable(path_value) else {
                return Err(AgentError::new(
                    "Claude Code is Node-backed, but a Node executable was not found in its runtime PATH.",
                ));
            };
            args.insert(0, command);
            command = node;
        } else if command == "node"
            && let Some(node) = self.resolve_node_executable(path_value)
        {
            command = node;
        }
        if !node_path::is_absolute(&command) || invalid_text(&command) {
            return Err(AgentError::new(
                "Claude Code process command must be an absolute validated path.",
            ));
        }
        if args
            .iter()
            .any(|argument| js::len16(argument) > 4_096 || invalid_text(argument))
        {
            return Err(AgentError::new(
                "Claude Code process arguments are invalid.",
            ));
        }
        let Some(cwd) = options
            .cwd
            .as_deref()
            .filter(|cwd| node_path::is_absolute(cwd) && !invalid_text(cwd))
        else {
            return Err(AgentError::new(
                "Claude Code process working directory must be absolute.",
            ));
        };
        let connection = ConnectionOptions {
            executable_path: PathBuf::from(&command),
            args,
            cwd: PathBuf::from(cwd),
            env: Some(options.env.clone().into_iter().collect()),
            ..Default::default()
        };
        let mut io = match inner.options.spawn.as_ref() {
            Some(spawn) => spawn(&connection)?,
            None => spawn_managed_process(&connection)?,
        };
        let lease = Rc::new(Lease {
            signal: Some(options.signal.clone()),
            exited: Cell::new(false),
            exit: Notify::new(),
            kill: io.kill.clone(),
            kill_timer: RefCell::default(),
            stopping: Cell::new(false),
            abort_listener: Cell::new(None),
        });
        inner.processes.borrow_mut().push(lease.clone());
        // The exit is observed here first, so the lease is released even if
        // the SDK never awaits it.
        let exit = std::mem::replace(&mut io.exit, Box::pin(futures_util::future::pending()));
        let observed = exit.shared();
        let owner = Rc::downgrade(&self.0);
        let released = lease.clone();
        spawn({
            let observed = observed.clone();
            async move {
                let _ = observed.await;
                released.exited.set(true);
                if let Some(timer) = released.kill_timer.borrow_mut().take() {
                    timer.clear();
                }
                if let (Some(listener), Some(signal)) =
                    (released.abort_listener.take(), released.signal.as_ref())
                {
                    signal.remove_listener(listener);
                }
                if let Some(owner) = owner.upgrade() {
                    owner
                        .processes
                        .borrow_mut()
                        .retain(|entry| !Rc::ptr_eq(entry, &released));
                }
                released.exit.notify_waiters();
            }
        });
        io.exit = Box::pin(observed);
        let stderr: Box<dyn AsyncRead + Unpin> =
            std::mem::replace(&mut io.stderr, Box::new(tokio::io::empty()));
        let on_stderr = inner.options.on_stderr.clone();
        spawn(async move {
            let mut stderr = stderr;
            let mut buffer = vec![0u8; 16 * 1024];
            while let Ok(read) = stderr.read(&mut buffer).await {
                if read == 0 {
                    break;
                }
                if let Some(on_stderr) = on_stderr.as_ref() {
                    let chunk = String::from_utf8_lossy(&buffer[..read]);
                    let start = js::len16(&chunk).saturating_sub(8_192);
                    on_stderr(js::tail16(&chunk, start));
                }
            }
        });
        if options.signal.aborted() {
            lease.stop();
        } else {
            let target = Rc::downgrade(&lease);
            let listener = options.signal.add_listener(move || {
                if let Some(lease) = target.upgrade() {
                    lease.stop();
                }
            });
            lease.abort_listener.set(Some(listener));
        }
        Ok(io)
    }

    /// `launch.waitForExit({ signal })`: the processes launched with
    /// `signal` (or every process).
    pub fn wait_for_exit_of(
        &self,
        signal: Option<&AbortSignal>,
    ) -> LocalBoxFuture<'static, AgentResult<()>> {
        let leases: Vec<Rc<Lease>> = self
            .0
            .processes
            .borrow()
            .iter()
            .filter(|lease| {
                signal.is_none_or(|signal| {
                    lease
                        .signal
                        .as_ref()
                        .is_some_and(|owned| owned.same(signal))
                })
            })
            .cloned()
            .collect();
        Box::pin(async move {
            let results = join_all(leases.into_iter().map(Lease::wait)).await;
            if results.iter().any(Result::is_err) {
                return Err(AgentError::new(
                    "Claude Code processes have not all exited.",
                ));
            }
            Ok(())
        })
    }

    /// `launch.dispose()`.
    pub async fn dispose(&self) -> AgentResult<()> {
        self.0.closed.set(true);
        let leases = self.0.processes.borrow().clone();
        for lease in &leases {
            lease.stop();
        }
        self.wait_for_exit_of(None).await
    }

    /// `resolveNodeExecutable(PATH, fsModule)`.
    fn resolve_node_executable(&self, path_value: Option<&str>) -> Option<String> {
        let options = &self.0.options;
        let platform = options.platform.clone().unwrap_or_else(|| {
            crate::platform::common::bounded_process_probe::node_platform().to_string()
        });
        let windows = platform == "win32";
        let separator = if windows { ';' } else { ':' };
        let names: &[&str] = if windows {
            &["node.exe", "node"]
        } else {
            &["node"]
        };
        let mut candidates: Vec<PathBuf> = Vec::new();
        for directory in path_value
            .unwrap_or("")
            .split(separator)
            .filter(|d| node_path::is_absolute(d))
        {
            for name in names {
                candidates.push(Path::new(directory).join(name));
            }
        }
        let exec_path = options
            .exec_path
            .clone()
            .or_else(|| std::env::current_exe().ok());
        if let Some(exec_path) = exec_path
            && exec_path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().to_lowercase().starts_with("node"))
        {
            candidates.push(exec_path);
        }
        let check: ExecutableCheck = options
            .is_executable
            .clone()
            .unwrap_or_else(|| Rc::new(is_executable_file));
        candidates
            .into_iter()
            .find(|candidate| check(candidate))
            .map(|candidate| candidate.to_string_lossy().into_owned())
    }
}

fn is_executable_file(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let Ok(path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
            return false;
        };
        unsafe { libc::access(path.as_ptr(), libc::X_OK) == 0 }
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

impl SpawnClaudeCodeProcess for ClaudeSpawn {
    fn launch(&self, options: SpawnOptions) -> AgentResult<ProcessIo> {
        self.launch_process(options)
    }
    fn wait_for_exit(
        &self,
        signal: Option<AbortSignal>,
    ) -> LocalBoxFuture<'static, AgentResult<()>> {
        self.wait_for_exit_of(signal.as_ref())
    }
}

/// `createClaudeSpawn(options)`.
pub fn create_claude_spawn(options: ClaudeSpawnOptions) -> ClaudeSpawn {
    ClaudeSpawn::new(options)
}
