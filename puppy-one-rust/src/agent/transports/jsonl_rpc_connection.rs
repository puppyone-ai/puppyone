//! `transports/jsonl-rpc-connection.mjs`: a JSON-RPC 2.0 connection over a
//! native Agent's stdio, one JSON object per line.
use super::jsonl_stream::{Framed, JsonlFramer};
#[cfg(unix)]
use super::managed_agent_process::signal_name;
use super::managed_agent_process::{create_managed_agent_process, terminate_managed_agent_process};
use super::native_request_ledger::{LateResponse, NativeRequestLedger, Taken};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js::{self, Obj};
use crate::agent::tasks::{CancelSignal, spawn_after};
use crate::text;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Notify, mpsc};
use tokio::task::JoinHandle;
use tokio::task::spawn_local;

pub const JSONL_RPC_MAX_LINE_BYTES: usize = 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES: usize = 64 * 1024;
const DEFAULT_MAX_PENDING: usize = 128;
const DEFAULT_FORCE_KILL_TIMEOUT_MS: u64 = 2_000;

/// `JsonlRpcRequestTimeoutError`.
pub fn jsonl_rpc_request_timeout_error(method: &str) -> AgentError {
    let mut error = AgentError::coded(
        "JSONL_RPC_TIMEOUT",
        format!("JSONL-RPC request timed out: {method}"),
    )
    .with_name("JsonlRpcRequestTimeoutError");
    error.delivery_outcome = Some("unknown".into());
    error.extra = Some(json!({ "method": method }));
    error
}

/// `JsonlRpcDeliveryUnknownError`.
pub fn jsonl_rpc_delivery_unknown_error(method: &str, message: &str) -> AgentError {
    let mut error = AgentError::coded("JSONL_RPC_DELIVERY_UNKNOWN", redact_secret_text(message))
        .with_name("JsonlRpcDeliveryUnknownError");
    error.delivery_outcome = Some("unknown".into());
    error.extra = Some(json!({ "method": method }));
    error
}

/// `JsonlRpcErrorResponse`: the native side answered with an error.
pub fn jsonl_rpc_error_response(
    method: &str,
    code: i64,
    message: &str,
    data: Option<Value>,
) -> AgentError {
    let mut error =
        AgentError::coded(&code.to_string(), message).with_name("JsonlRpcErrorResponse");
    error.extra = Some(json!({ "method": method, "rpcCode": code, "data": data }));
    error
}

/// The numeric JSON-RPC error code of a [`jsonl_rpc_error_response`].
pub fn rpc_error_code(error: &AgentError) -> Option<i64> {
    if error.name.as_deref() != Some("JsonlRpcErrorResponse") {
        return None;
    }
    error.extra.as_ref().and_then(|e| e["rpcCode"].as_i64())
}

/// What the connection emits (the product's EventEmitter events).
#[derive(Clone, Debug)]
pub enum ConnectionEvent {
    /// A request from the native side (`{ id, method, params }`).
    Request(Value),
    /// A notification (`{ method, params }`).
    Notification(Value),
    ProtocolError(AgentError),
    /// `{ code, signal, error, diagnostics, expected }`.
    Exit(Value),
}

/// A launched process's pipes, exit and termination (`spawn(...)` in the
/// product, injectable for tests).
pub struct ProcessIo {
    pub stdin: Box<dyn tokio::io::AsyncWrite + Unpin>,
    pub stdout: Box<dyn tokio::io::AsyncRead + Unpin>,
    pub stderr: Box<dyn tokio::io::AsyncRead + Unpin>,
    /// Resolves with `(code, signal, error)` once the process is gone.
    pub exit: futures_util::future::LocalBoxFuture<
        'static,
        (Option<i32>, Option<String>, Option<AgentError>),
    >,
    /// Signals the process (group); `true` forces it.
    pub kill: Rc<dyn Fn(bool) -> bool>,
}

/// Launches the native process for a connection.
pub type Spawner = Rc<dyn Fn(&ConnectionOptions) -> AgentResult<ProcessIo>>;

/// `new JsonlRpcConnection({ executablePath, args, cwd, env, spawn, … })`.
#[derive(Clone, Default)]
pub struct ConnectionOptions {
    pub executable_path: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Option<Vec<(String, String)>>,
    pub max_line_bytes: Option<usize>,
    pub max_stderr_bytes: Option<usize>,
    pub max_pending: Option<usize>,
    pub force_kill_timeout_ms: Option<u64>,
    /// `spawn`: the default launches a managed process group.
    pub spawner: Option<Spawner>,
    /// A private bootstrap envelope delivered on the child's fd 3, which
    /// closes after the envelope (`stdio: [..., "pipe"]`).
    pub bootstrap: Option<Vec<u8>>,
}

/// The default spawner: an isolated process group with piped stdio.
pub fn spawn_managed_process(options: &ConnectionOptions) -> AgentResult<ProcessIo> {
    let mut process = create_managed_agent_process(
        &options.executable_path,
        &options.args,
        Path::new(&options.cwd),
        options.env.as_deref(),
        options.bootstrap.as_deref(),
    )?;
    let (pid, grouped) = (process.pid, process.grouped);
    let stdin = process
        .child
        .stdin
        .take()
        .ok_or_else(|| AgentError::new("The native process has no stdin."))?;
    let stdout = process
        .child
        .stdout
        .take()
        .ok_or_else(|| AgentError::new("The native process has no stdout."))?;
    let stderr = process
        .child
        .stderr
        .take()
        .ok_or_else(|| AgentError::new("The native process has no stderr."))?;
    let mut child = process.child;
    Ok(ProcessIo {
        stdin: Box::new(stdin),
        stdout: Box::new(stdout),
        stderr: Box::new(stderr),
        exit: Box::pin(async move {
            match child.wait().await {
                Ok(status) => {
                    #[cfg(unix)]
                    let signal =
                        std::os::unix::process::ExitStatusExt::signal(&status).map(signal_name);
                    #[cfg(not(unix))]
                    let signal: Option<String> = None;
                    (status.code(), signal, None)
                }
                Err(error) => (None, None, Some(AgentError::from(error))),
            }
        }),
        kill: Rc::new(move |force| terminate_managed_agent_process(pid, grouped, force)),
    })
}

/// `request(method, params, { timeoutMs, signal, onLateResponse })`.
#[derive(Clone, Default)]
pub struct RequestOptions {
    pub timeout_ms: Option<u64>,
    pub signal: Option<CancelSignal>,
    pub on_late_response: Option<LateResponse>,
}

type Listener = Rc<dyn Fn(ConnectionEvent)>;

struct Inner {
    max_line_bytes: usize,
    max_stderr_bytes: usize,
    max_pending: usize,
    force_kill_timeout_ms: u64,
    next_request_id: Rc<Cell<u64>>,
    requests: NativeRequestLedger,
    stderr: RefCell<String>,
    closed: Cell<bool>,
    exit_info: RefCell<Option<Value>>,
    exit_expected: Cell<bool>,
    close_reason: RefCell<Option<String>>,
    force_kill_timer: RefCell<Option<JoinHandle<()>>>,
    kill: Rc<dyn Fn(bool) -> bool>,
    writer: RefCell<Option<mpsc::UnboundedSender<Vec<u8>>>>,
    queued_bytes: Rc<Cell<usize>>,
    listeners: RefCell<Vec<(u64, Listener)>>,
    next_listener: Cell<u64>,
    exited: Notify,
}

#[derive(Clone)]
pub struct JsonlRpcConnection(Rc<Inner>);

fn valid_argument(value: &str) -> bool {
    text::len16(value) <= 4_096 && !value.contains(['\r', '\n', '\0'])
}

impl JsonlRpcConnection {
    /// Launches the native process and starts reading its output.
    pub fn spawn(options: ConnectionOptions) -> AgentResult<Self> {
        let executable = options.executable_path.to_string_lossy().into_owned();
        if !options.executable_path.is_absolute() || !valid_argument(&executable) {
            return Err(
                AgentError::new("An absolute JSONL-RPC executable path is required.")
                    .with_name("TypeError"),
            );
        }
        if options
            .args
            .iter()
            .any(|argument| !valid_argument(argument))
        {
            return Err(
                AgentError::new("JSONL-RPC process arguments are invalid.").with_name("TypeError")
            );
        }
        let cwd = options.cwd.to_string_lossy().into_owned();
        if !options.cwd.is_absolute() || cwd.contains(['\r', '\n', '\0']) {
            return Err(
                AgentError::new("An absolute JSONL-RPC working directory is required.")
                    .with_name("TypeError"),
            );
        }
        let spawner = options
            .spawner
            .clone()
            .unwrap_or_else(|| Rc::new(spawn_managed_process));
        let io = match spawner(&options) {
            Ok(io) => io,
            Err(error) => {
                let connection = Self::with(&options, Rc::new(|_| false));
                // A launch failure arrives as the process `error` event.
                let target = connection.clone();
                spawn_local(async move { target.handle_exit(None, None, Some(error)) });
                return Ok(connection);
            }
        };
        let ProcessIo {
            mut stdin,
            mut stdout,
            mut stderr,
            exit,
            kill,
            ..
        } = io;
        let connection = Self::with(&options, kill);
        let (writer, mut lines) = mpsc::unbounded_channel::<Vec<u8>>();
        *connection.0.writer.borrow_mut() = Some(writer);
        {
            let target = connection.clone();
            let queued = connection.0.queued_bytes.clone();
            spawn_local(async move {
                while let Some(line) = lines.recv().await {
                    let length = line.len();
                    let written = stdin.write_all(&line).await;
                    let flushed = match written {
                        Ok(()) => stdin.flush().await,
                        Err(error) => Err(error),
                    };
                    queued.set(queued.get().saturating_sub(length));
                    if let Err(error) = flushed {
                        if !target.closed() {
                            target.dispose(&redact_secret_text(&error.to_string()), false);
                        }
                        return;
                    }
                }
                let _ = stdin.shutdown().await;
            });
        }
        {
            let target = connection.clone();
            spawn_local(async move {
                let mut framer = JsonlFramer::new(target.0.max_line_bytes);
                let mut buffer = vec![0u8; 64 * 1024];
                loop {
                    let read = stdout.read(&mut buffer).await;
                    let Ok(count) = read else { break };
                    if count == 0 || target.closed() {
                        break;
                    }
                    for framed in framer.push(&buffer[..count]) {
                        if target.closed() {
                            break;
                        }
                        match framed {
                            Framed::Line(line) => target.receive_line(&line),
                            Framed::Overflow => target.protocol_failure(
                                "The JSONL-RPC process emitted a line larger than the safety limit.",
                            ),
                        }
                    }
                }
            });
        }
        {
            let target = connection.clone();
            spawn_local(async move {
                let mut buffer = vec![0u8; 8192];
                while let Ok(count) = stderr.read(&mut buffer).await {
                    if count == 0 {
                        break;
                    }
                    target.receive_stderr(&buffer[..count]);
                }
            });
        }
        {
            let target = connection.clone();
            spawn_local(async move {
                let (code, signal, error) = exit.await;
                target.handle_exit(code, signal, error);
            });
        }
        Ok(connection)
    }

    fn with(options: &ConnectionOptions, kill: Rc<dyn Fn(bool) -> bool>) -> Self {
        let next_request_id = Rc::new(Cell::new(1u64));
        let issued = next_request_id.clone();
        let inner = Inner {
            max_line_bytes: options.max_line_bytes.unwrap_or(JSONL_RPC_MAX_LINE_BYTES),
            max_stderr_bytes: options.max_stderr_bytes.unwrap_or(DEFAULT_MAX_STDERR_BYTES),
            max_pending: options.max_pending.unwrap_or(DEFAULT_MAX_PENDING),
            force_kill_timeout_ms: options
                .force_kill_timeout_ms
                .unwrap_or(DEFAULT_FORCE_KILL_TIMEOUT_MS),
            next_request_id: next_request_id.clone(),
            requests: NativeRequestLedger::new(
                512,
                Rc::new(move |id: &str| {
                    id.parse::<u64>().is_ok_and(|serial| {
                        serial > 0 && serial < issued.get() && !id.starts_with('0')
                    })
                }),
            ),
            stderr: RefCell::default(),
            closed: Cell::new(false),
            exit_info: RefCell::new(None),
            exit_expected: Cell::new(false),
            close_reason: RefCell::new(None),
            force_kill_timer: RefCell::new(None),
            kill,
            writer: RefCell::new(None),
            queued_bytes: Rc::default(),
            listeners: RefCell::default(),
            next_listener: Cell::new(0),
            exited: Notify::new(),
        };
        Self(Rc::new(inner))
    }

    /// Subscribes to the connection's events; returns the id `off` takes.
    pub fn on(&self, listener: impl Fn(ConnectionEvent) + 'static) -> u64 {
        let id = self.0.next_listener.get() + 1;
        self.0.next_listener.set(id);
        self.0.listeners.borrow_mut().push((id, Rc::new(listener)));
        id
    }

    pub fn off(&self, id: u64) {
        self.0
            .listeners
            .borrow_mut()
            .retain(|(listener, _)| *listener != id);
    }

    fn emit(&self, event: ConnectionEvent) {
        let listeners: Vec<Listener> = self
            .0
            .listeners
            .borrow()
            .iter()
            .map(|(_, l)| l.clone())
            .collect();
        for listener in listeners {
            listener(event.clone());
        }
    }

    pub fn closed(&self) -> bool {
        self.0.closed.get()
    }

    /// `connection.exitInfo`.
    pub fn exit_info(&self) -> Option<Value> {
        self.0.exit_info.borrow().clone()
    }

    /// `connection.request(method, params, options)`.
    pub async fn request(
        &self,
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> AgentResult<Value> {
        if let Some(signal) = options.signal.as_ref()
            && signal.is_cancelled()
        {
            return Err(signal.reason().unwrap_or_else(|| {
                AgentError::new("Native RPC request aborted before dispatch.")
            }));
        }
        if self.closed() {
            return Err(AgentError::new("The JSONL-RPC process is not connected."));
        }
        if self.0.requests.pending_count() >= self.0.max_pending {
            return Err(AgentError::new("Too many pending JSONL-RPC requests."));
        }
        let id = self.0.next_request_id.get();
        self.0.next_request_id.set(id + 1);
        let method_name = method.to_string();
        let timeout_method = method_name.clone();
        let abort_method = method_name.clone();
        self.0
            .requests
            .request(
                &id.to_string(),
                method,
                options.timeout_ms.unwrap_or(20_000),
                options.signal.as_ref(),
                move || jsonl_rpc_request_timeout_error(&timeout_method),
                move || {
                    jsonl_rpc_delivery_unknown_error(
                        &abort_method,
                        "Native RPC request aborted after dispatch.",
                    )
                },
                || self.write(json!({ "method": method_name, "id": id, "params": params })),
                options.on_late_response,
            )
            .await
    }

    /// `connection.notify(method, params)`.
    pub fn notify(&self, method: &str, params: Option<Value>) -> AgentResult<()> {
        let message = match params {
            Some(params) => json!({ "method": method, "params": params }),
            None => json!({ "method": method }),
        };
        self.write(message)
    }

    /// `connection.respond(id, result)`.
    pub fn respond(&self, id: Value, result: Value) -> AgentResult<()> {
        self.write(json!({ "id": id, "result": result }))
    }

    /// `connection.respondError(id, code, message)`.
    pub fn respond_error(&self, id: Value, code: i64, message: &str) -> AgentResult<()> {
        self.write(
            json!({ "id": id, "error": { "code": code, "message": redact_secret_text(message) } }),
        )
    }

    /// `connection.waitForExit({ timeoutMs })`.
    pub async fn wait_for_exit(&self, timeout_ms: Option<u64>) -> AgentResult<Value> {
        let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(3_500));
        let wait = async {
            loop {
                let notified = self.0.exited.notified();
                if let Some(info) = self.exit_info() {
                    return info;
                }
                notified.await;
            }
        };
        tokio::time::timeout(timeout, wait)
            .await
            .map_err(|_| AgentError::new("Native Agent process exit could not be confirmed."))
    }

    /// `connection.getDiagnostics()`.
    pub fn diagnostics(&self) -> String {
        let stderr = self.0.stderr.borrow();
        let tail = tail_bytes(&stderr, self.0.max_stderr_bytes);
        redact_secret_text(tail)
    }

    /// `connection.dispose(reason, { expected })`.
    pub fn dispose(&self, reason: &str, expected: bool) {
        if self.0.closed.replace(true) {
            return;
        }
        self.0.exit_expected.set(expected);
        *self.0.close_reason.borrow_mut() = Some(redact_secret_text(reason));
        self.reject_pending(&AgentError::new(reason));
        // Closing the writer channel ends stdin.
        self.0.writer.borrow_mut().take();
        (self.0.kill)(false);
        if self.exit_info().is_none() && self.0.force_kill_timeout_ms > 0 {
            let target = self.clone();
            let timer = spawn_after(
                Duration::from_millis(self.0.force_kill_timeout_ms),
                move || {
                    target.0.force_kill_timer.borrow_mut().take();
                    if target.exit_info().is_none() {
                        (target.0.kill)(true);
                    }
                },
            );
            *self.0.force_kill_timer.borrow_mut() = Some(timer);
        }
    }

    fn write(&self, message: Value) -> AgentResult<()> {
        let writer = self.0.writer.borrow().clone();
        let Some(writer) = writer.filter(|_| !self.closed()) else {
            return Err(AgentError::new("JSONL-RPC process stdin is unavailable."));
        };
        // Codex tolerates the compact shape, but ACP implementations use a strict
        // JSON-RPC 2.0 decoder. Always emit the protocol discriminator so the
        // shared transport is standards-compliant for every native runtime.
        let line = Obj::new().set("jsonrpc", "2.0").spread(&message).build();
        let mut bytes = serde_json::to_vec(&line).unwrap_or_default();
        bytes.push(b'\n');
        if bytes.len() > self.0.max_line_bytes {
            return Err(AgentError::new(
                "JSONL-RPC request exceeded the safety limit.",
            ));
        }
        let method = message["method"].as_str().unwrap_or("response").to_string();
        if self.0.queued_bytes.get() + bytes.len() > self.0.max_line_bytes * 4 {
            self.dispose("Native RPC write outcome is unknown.", false);
            return Err(jsonl_rpc_delivery_unknown_error(
                &method,
                "The native RPC write buffer is full.",
            ));
        }
        self.0
            .queued_bytes
            .set(self.0.queued_bytes.get() + bytes.len());
        if writer.send(bytes).is_err() {
            self.dispose("Native RPC write outcome is unknown.", false);
            return Err(jsonl_rpc_delivery_unknown_error(
                &method,
                "JSONL-RPC write outcome is unknown.",
            ));
        }
        Ok(())
    }

    fn receive_line(&self, line: &str) {
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            self.protocol_failure("The JSONL-RPC process emitted malformed protocol data.");
            return;
        };
        if !message.is_object() {
            self.protocol_failure("The JSONL-RPC process emitted an invalid message.");
            return;
        }
        if !js::nullish(message.get("jsonrpc")) && message["jsonrpc"] != "2.0" {
            self.protocol_failure("The JSONL-RPC process emitted an invalid protocol version.");
            return;
        }
        let has_id = message.get("id").is_some();
        if has_id && !(message["id"].is_string() || js::is_safe_integer(&message["id"])) {
            self.protocol_failure("The JSONL-RPC process emitted an invalid message id.");
            return;
        }
        let has_method = message["method"].as_str().is_some_and(|m| !m.is_empty());
        if has_method && has_id {
            self.emit(ConnectionEvent::Request(message));
        } else if has_method {
            self.emit(ConnectionEvent::Notification(message));
        } else if has_id {
            self.receive_response(&message);
        } else {
            self.protocol_failure("The JSONL-RPC process emitted an unclassifiable message.");
        }
    }

    fn receive_response(&self, message: &Value) {
        let has_result = message.get("result").is_some();
        let has_error = message.get("error").is_some();
        let invalid_error = has_error
            && (!message["error"]["code"]
                .as_f64()
                .is_some_and(|c| c.fract() == 0.0)
                || !message["error"]["message"].is_string());
        if has_result == has_error || invalid_error {
            self.protocol_failure("The JSONL-RPC process emitted an invalid response envelope.");
            return;
        }
        let id = match &message["id"] {
            Value::String(id) => id.clone(),
            other => other.to_string(),
        };
        let result = if has_error {
            let detail = message["error"]["message"]
                .as_str()
                .map(redact_secret_text)
                .unwrap_or_else(|| "Unknown JSON-RPC error".into());
            Err((
                message["error"]["code"].as_i64().unwrap_or(-32603),
                detail,
                message["error"].get("data").cloned(),
            ))
        } else {
            Ok(message["result"].clone())
        };
        match self.0.requests.take(&id) {
            Taken::Duplicate => {
                self.protocol_failure("Native RPC emitted an duplicate response id.")
            }
            Taken::Unknown => self.protocol_failure("Native RPC emitted an unknown response id."),
            Taken::Expired => {}
            Taken::Pending(reply, method) => {
                let _ = reply.send(result.map_err(|(code, detail, data)| {
                    jsonl_rpc_error_response(&method, code, &format!("{method}: {detail}"), data)
                }));
            }
            Taken::Late(handler, method) => {
                if let Some(handler) = handler {
                    handler(result.map_err(|(code, detail, data)| {
                        jsonl_rpc_error_response(
                            &method,
                            code,
                            &format!("{method}: {detail}"),
                            data,
                        )
                    }));
                }
            }
        }
    }

    fn receive_stderr(&self, chunk: &[u8]) {
        if self.closed() && self.exit_info().is_some() {
            return;
        }
        let mut stderr = self.0.stderr.borrow_mut();
        stderr.push_str(&String::from_utf8_lossy(chunk));
        if stderr.len() > self.0.max_stderr_bytes {
            let kept = tail_bytes(&stderr, self.0.max_stderr_bytes).to_string();
            *stderr = kept;
        }
    }

    fn protocol_failure(&self, message: &str) {
        self.emit(ConnectionEvent::ProtocolError(AgentError::new(message)));
        self.dispose(message, false);
    }

    fn handle_exit(&self, code: Option<i32>, signal: Option<String>, error: Option<AgentError>) {
        if self.exit_info().is_some() {
            return;
        }
        if let Some(timer) = self.0.force_kill_timer.borrow_mut().take() {
            timer.abort();
        }
        let expected = self.0.exit_expected.get();
        let error_text = match &error {
            Some(error) => Some(redact_secret_text(&error.message)),
            None if expected => None,
            None => self.0.close_reason.borrow().clone(),
        };
        let info = json!({
            "code": code,
            "signal": signal,
            "error": error_text,
            "diagnostics": self.diagnostics(),
        });
        *self.0.exit_info.borrow_mut() = Some(info.clone());
        self.0.closed.set(true);
        self.0.writer.borrow_mut().take();
        let message = error.map(|e| e.message).unwrap_or_else(|| match code {
            Some(code) => format!("JSONL-RPC process exited with code {code}."),
            None => "JSONL-RPC process exited.".into(),
        });
        self.reject_pending(&AgentError::new(message));
        self.0.exited.notify_waiters();
        self.emit(ConnectionEvent::Exit(js::with(&info, "expected", expected)));
    }

    fn reject_pending(&self, error: &AgentError) {
        self.0.requests.close(|method| {
            if error.delivery_outcome.as_deref() == Some("unknown") {
                error.clone()
            } else {
                jsonl_rpc_delivery_unknown_error(method, &error.message)
            }
        });
    }
}

fn tail_bytes(text: &str, limit: usize) -> &str {
    if text.len() <= limit {
        return text;
    }
    let mut start = text.len() - limit;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
}
