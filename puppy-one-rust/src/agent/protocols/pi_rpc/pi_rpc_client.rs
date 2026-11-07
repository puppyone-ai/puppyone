//! `protocols/pi-rpc/pi-rpc-client.mjs`: a strict LF-delimited client for
//! Pi's official, non-JSON-RPC RPC protocol.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js;
use crate::agent::tasks::spawn_after;
use crate::agent::transports::jsonl_rpc_connection::{
    ConnectionOptions, ProcessIo, RequestOptions, Spawner, spawn_managed_process,
};
use crate::agent::transports::jsonl_stream::{Framed, JsonlFramer};
use crate::agent::transports::native_request_ledger::{NativeRequestLedger, Taken};
use crate::text;
use futures_util::future::LocalBoxFuture;
use regex::Regex;
use serde_json::{Map, Value, json};
use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Notify, mpsc};
use tokio::task::JoinHandle;
use tokio::task::spawn_local;

pub const PI_RPC_MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES: usize = 64 * 1024;
const DEFAULT_MAX_PENDING: usize = 64;
const DEFAULT_FORCE_KILL_TIMEOUT_MS: u64 = 2_000;

static COMMAND_TYPE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9_]{0,79}$").expect("pattern"));
static REQUEST_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^puppyone-([1-9][0-9]*)$").expect("pattern"));

fn command_error(code: &str, name: &str, message: String, command: &str) -> AgentError {
    let mut error = AgentError::coded(code, message).with_name(name);
    error.extra = Some(json!({ "command": command }));
    error
}

/// `PiRpcRequestTimeoutError`.
pub fn pi_rpc_request_timeout_error(command: &str) -> AgentError {
    let mut error = command_error(
        "PI_RPC_TIMEOUT",
        "PiRpcRequestTimeoutError",
        format!("Pi RPC request timed out: {command}"),
        command,
    );
    error.delivery_outcome = Some("unknown".into());
    error
}

/// `PiRpcDeliveryUnknownError`.
pub fn pi_rpc_delivery_unknown_error(command: &str, message: &str) -> AgentError {
    let mut error = command_error(
        "PI_RPC_DELIVERY_UNKNOWN",
        "PiRpcDeliveryUnknownError",
        redact_secret_text(message),
        command,
    );
    error.delivery_outcome = Some("unknown".into());
    error
}

/// `PiRpcErrorResponse`.
pub fn pi_rpc_error_response(command: &str, message: &str) -> AgentError {
    command_error(
        "PI_RPC_ERROR",
        "PiRpcErrorResponse",
        format!("{command}: {message}"),
        command,
    )
}

/// What the client emits.
#[derive(Clone, Debug)]
pub enum PiClientEvent {
    /// A native session event (`{ type, … }`).
    Event(Value),
    ProtocolError(AgentError),
    /// `{ code, signal, error, diagnostics, expected }`.
    Exit(Value),
}

/// `new PiRpcClient({ … })`.
#[derive(Clone, Default)]
pub struct PiClientOptions {
    pub executable_path: String,
    pub args_prefix: Vec<String>,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: Option<Vec<(String, String)>>,
    pub spawner: Option<Spawner>,
    pub max_line_bytes: Option<usize>,
    pub max_stderr_bytes: Option<usize>,
    pub max_pending: Option<usize>,
    pub force_kill_timeout_ms: Option<u64>,
    pub sensitive_values: Vec<String>,
}

/// The client surface adapters hold (`clientFactory(options)`).
pub trait PiClient {
    /// `client.request(type, payload, options)`.
    fn request(
        &self,
        kind: &str,
        payload: Value,
        options: RequestOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Value>>;
    /// `client.respondExtensionUi(message)`.
    fn respond_extension_ui(&self, message: Value) -> AgentResult<()>;
    fn on(&self, listener: Rc<dyn Fn(PiClientEvent)>) -> u64;
    fn closed(&self) -> bool;
    /// `client.getDiagnostics()`.
    fn diagnostics(&self) -> String;
    /// `client.dispose(reason, { expected })`.
    fn dispose(&self, reason: &str, expected: bool);
    /// `client.waitForExit()`.
    fn wait_for_exit(&self) -> LocalBoxFuture<'static, AgentResult<Value>>;
}

/// `clientFactory(options)`.
pub type PiClientFactory = Rc<dyn Fn(PiClientOptions) -> AgentResult<Rc<dyn PiClient>>>;

/// The production factory.
pub fn pi_rpc_client_factory() -> PiClientFactory {
    Rc::new(|options| Ok(Rc::new(PiRpcClient::spawn(options)?) as Rc<dyn PiClient>))
}

type Listener = Rc<dyn Fn(PiClientEvent)>;

struct Inner {
    max_line_bytes: usize,
    max_stderr_bytes: usize,
    max_pending: usize,
    force_kill_timeout_ms: u64,
    sensitive_values: Vec<String>,
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

/// `PiRpcClient`.
#[derive(Clone)]
pub struct PiRpcClient(Rc<Inner>);

fn valid_argument(value: &str) -> bool {
    text::len16(value) <= 4_096 && !value.contains(['\r', '\n', '\0'])
}

fn validate_launch(executable_path: &str, args: &[String], cwd: &str) -> AgentResult<()> {
    let type_error = |message: &str| AgentError::new(message).with_name("TypeError");
    if !crate::platform::paths::is_absolute(executable_path)
        || executable_path.contains(['\r', '\n', '\0'])
    {
        return Err(type_error("Pi RPC requires an absolute executable path."));
    }
    if args.len() > 16 || args.iter().any(|arg| !valid_argument(arg)) {
        return Err(type_error("Pi RPC process arguments are invalid."));
    }
    if !crate::platform::paths::is_absolute(cwd) || cwd.contains(['\r', '\n', '\0']) {
        return Err(type_error("Pi RPC requires an absolute working directory."));
    }
    Ok(())
}

fn bounded_payload(value: &Value) -> Map<String, Value> {
    value
        .as_object()
        .map(|map| {
            map.iter()
                .take(64)
                .filter(|(key, _)| {
                    !matches!(
                        key.as_str(),
                        "id" | "type" | "__proto__" | "constructor" | "prototype"
                    )
                })
                .map(|(key, entry)| (key.clone(), entry.clone()))
                .collect()
        })
        .unwrap_or_default()
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

impl PiRpcClient {
    /// Launches `pi --mode rpc --no-approve …` and starts reading it.
    pub fn spawn(options: PiClientOptions) -> AgentResult<Self> {
        let mut launch_args = options.args_prefix.clone();
        launch_args.extend(options.args.iter().cloned());
        validate_launch(&options.executable_path, &launch_args, &options.cwd)?;
        let mut args = options.args_prefix.clone();
        args.extend(["--mode".into(), "rpc".into(), "--no-approve".into()]);
        args.extend(options.args.iter().cloned());
        let connection = ConnectionOptions {
            executable_path: PathBuf::from(&options.executable_path),
            args,
            cwd: PathBuf::from(&options.cwd),
            env: options.env.clone(),
            spawner: options.spawner.clone(),
            ..Default::default()
        };
        let spawner = options
            .spawner
            .clone()
            .unwrap_or_else(|| Rc::new(spawn_managed_process));
        let io = match spawner(&connection) {
            Ok(io) => io,
            Err(error) => {
                let client = Self::with(&options, Rc::new(|_| false));
                let target = client.clone();
                spawn_local(async move { target.handle_exit(None, None, Some(error)) });
                return Ok(client);
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
        let client = Self::with(&options, kill);
        let (writer, mut lines) = mpsc::unbounded_channel::<Vec<u8>>();
        *client.0.writer.borrow_mut() = Some(writer);
        {
            let target = client.clone();
            let queued = client.0.queued_bytes.clone();
            spawn_local(async move {
                while let Some(line) = lines.recv().await {
                    let length = line.len();
                    let written = match stdin.write_all(&line).await {
                        Ok(()) => stdin.flush().await,
                        Err(error) => Err(error),
                    };
                    queued.set(queued.get().saturating_sub(length));
                    if let Err(error) = written {
                        if !target.closed() {
                            target.dispose_with(&redact_secret_text(&error.to_string()), false);
                        }
                        return;
                    }
                }
                let _ = stdin.shutdown().await;
            });
        }
        {
            let target = client.clone();
            spawn_local(async move {
                let mut framer = JsonlFramer::new(target.0.max_line_bytes);
                let mut buffer = vec![0u8; 64 * 1024];
                while let Ok(count) = stdout.read(&mut buffer).await {
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
                                "Pi RPC emitted a line larger than the safety limit.",
                            ),
                        }
                    }
                }
            });
        }
        {
            let target = client.clone();
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
            let target = client.clone();
            spawn_local(async move {
                let (code, signal, error) = exit.await;
                target.handle_exit(code, signal, error);
            });
        }
        Ok(client)
    }

    fn with(options: &PiClientOptions, kill: Rc<dyn Fn(bool) -> bool>) -> Self {
        let next_request_id = Rc::new(Cell::new(1u64));
        let issued = next_request_id.clone();
        Self(Rc::new(Inner {
            max_line_bytes: options.max_line_bytes.unwrap_or(PI_RPC_MAX_LINE_BYTES),
            max_stderr_bytes: options.max_stderr_bytes.unwrap_or(DEFAULT_MAX_STDERR_BYTES),
            max_pending: options.max_pending.unwrap_or(DEFAULT_MAX_PENDING),
            force_kill_timeout_ms: options
                .force_kill_timeout_ms
                .unwrap_or(DEFAULT_FORCE_KILL_TIMEOUT_MS),
            sensitive_values: options
                .sensitive_values
                .iter()
                .filter(|s| !s.is_empty())
                .cloned()
                .collect(),
            next_request_id,
            requests: NativeRequestLedger::new(
                512,
                Rc::new(move |id: &str| {
                    REQUEST_ID
                        .captures(id)
                        .and_then(|captures| captures[1].parse::<u64>().ok())
                        .is_some_and(|serial| serial < issued.get())
                }),
            ),
            stderr: RefCell::default(),
            closed: Cell::new(false),
            exit_info: RefCell::default(),
            exit_expected: Cell::new(false),
            close_reason: RefCell::default(),
            force_kill_timer: RefCell::default(),
            kill,
            writer: RefCell::default(),
            queued_bytes: Rc::default(),
            listeners: RefCell::default(),
            next_listener: Cell::new(0),
            exited: Notify::new(),
        }))
    }

    /// `redactSensitive(text)`: launch secrets never reach events or logs.
    fn redact_sensitive(&self, text: &str) -> String {
        let mut result = text.to_string();
        for secret in &self.0.sensitive_values {
            let escaped = serde_json::to_string(secret).unwrap_or_default();
            let escaped = &escaped[1..escaped.len().saturating_sub(1)];
            if !escaped.is_empty() {
                result = result.replace(escaped, "[redacted]");
            }
            result = result.replace(secret.as_str(), "[redacted]");
        }
        result
    }

    fn emit(&self, event: PiClientEvent) {
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

    pub fn exit_info(&self) -> Option<Value> {
        self.0.exit_info.borrow().clone()
    }

    /// `client.request(type, payload, { timeoutMs, signal, onLateResponse })`.
    pub async fn request_now(
        &self,
        kind: &str,
        payload: Value,
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
            return Err(AgentError::new("Pi RPC is not connected."));
        }
        if self.0.requests.pending_count() >= self.0.max_pending {
            return Err(AgentError::new("Too many pending Pi RPC requests."));
        }
        if !COMMAND_TYPE.is_match(kind) {
            return Err(AgentError::new("Pi RPC command type is invalid.").with_name("TypeError"));
        }
        let serial = self.0.next_request_id.get();
        self.0.next_request_id.set(serial + 1);
        let id = format!("puppyone-{serial}");
        let mut message = Map::new();
        message.insert("id".into(), Value::from(id.as_str()));
        message.insert("type".into(), Value::from(kind));
        message.extend(bounded_payload(&payload));
        let (timeout_kind, abort_kind) = (kind.to_string(), kind.to_string());
        self.0
            .requests
            .request(
                &id,
                kind,
                options.timeout_ms.unwrap_or(20_000),
                options.signal.as_ref(),
                move || pi_rpc_request_timeout_error(&timeout_kind),
                move || {
                    pi_rpc_delivery_unknown_error(
                        &abort_kind,
                        "Native RPC request aborted after dispatch.",
                    )
                },
                || self.write(&Value::Object(message)),
                options.on_late_response,
            )
            .await
    }

    /// `client.respondExtensionUi(message)`.
    pub fn respond_extension_ui_now(&self, message: &Value) -> AgentResult<()> {
        if message.get("type").and_then(Value::as_str) != Some("extension_ui_response")
            || !message.get("id").is_some_and(Value::is_string)
        {
            return Err(
                AgentError::new("Pi extension UI response is invalid.").with_name("TypeError")
            );
        }
        self.write(message)
    }

    /// `client.waitForExit({ timeoutMs })`.
    pub async fn wait_for_exit_now(&self, timeout_ms: Option<u64>) -> AgentResult<Value> {
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

    /// `client.getDiagnostics()`.
    pub fn diagnostics_now(&self) -> String {
        let stderr = self.0.stderr.borrow();
        redact_secret_text(&self.redact_sensitive(tail_bytes(&stderr, self.0.max_stderr_bytes)))
    }

    /// `client.dispose(reason, { expected })`.
    pub fn dispose_with(&self, reason: &str, expected: bool) {
        if self.0.closed.replace(true) {
            return;
        }
        self.0.exit_expected.set(expected);
        let reason = redact_secret_text(&self.redact_sensitive(reason));
        *self.0.close_reason.borrow_mut() = Some(reason.clone());
        self.reject_pending(&AgentError::new(reason));
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

    fn write(&self, message: &Value) -> AgentResult<()> {
        let writer = self.0.writer.borrow().clone();
        let Some(writer) = writer.filter(|_| !self.closed()) else {
            return Err(AgentError::new("Pi RPC stdin is unavailable."));
        };
        let mut bytes = serde_json::to_vec(message).unwrap_or_default();
        bytes.push(b'\n');
        if bytes.len() > self.0.max_line_bytes {
            return Err(AgentError::new("Pi RPC request exceeded the safety limit."));
        }
        let command = message
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("response")
            .to_string();
        if self.0.queued_bytes.get() + bytes.len() > self.0.max_line_bytes * 4 {
            self.dispose_with("The native RPC write buffer is full.", false);
            return Err(pi_rpc_delivery_unknown_error(
                &command,
                "The native RPC write buffer is full.",
            ));
        }
        self.0
            .queued_bytes
            .set(self.0.queued_bytes.get() + bytes.len());
        if writer.send(bytes).is_err() {
            return Err(pi_rpc_delivery_unknown_error(
                &command,
                "Pi RPC write outcome is unknown.",
            ));
        }
        Ok(())
    }

    fn receive_line(&self, line: &str) {
        let Ok(message) = serde_json::from_str::<Value>(&self.redact_sensitive(line)) else {
            self.protocol_failure("Pi RPC emitted malformed protocol data.");
            return;
        };
        if !message.is_object() || !message.get("type").is_some_and(Value::is_string) {
            self.protocol_failure("Pi RPC emitted an invalid message.");
            return;
        }
        if message["type"] == "response" {
            self.receive_response(&message);
            return;
        }
        self.emit(PiClientEvent::Event(message));
    }

    fn receive_response(&self, message: &Value) {
        let id = message.get("id").and_then(Value::as_str).unwrap_or("");
        let reply = |method: &str| -> Result<AgentResult<Value>, ()> {
            if message.get("command").and_then(Value::as_str) != Some(method) {
                return Err(());
            }
            Ok(if message.get("success") == Some(&Value::Bool(true)) {
                Ok(message.get("data").cloned().unwrap_or(Value::Null))
            } else {
                let detail = message
                    .get("error")
                    .filter(|e| js::truthy(e))
                    .map(|e| js::to_js_string(Some(e)))
                    .unwrap_or_else(|| "Unknown Pi RPC error".into());
                Err(pi_rpc_error_response(method, &redact_secret_text(&detail)))
            })
        };
        match self.0.requests.take(id) {
            Taken::Duplicate => {
                self.protocol_failure("Native RPC emitted an duplicate response id.")
            }
            Taken::Unknown => self.protocol_failure("Native RPC emitted an unknown response id."),
            // An issued request whose late-receipt window expired.
            Taken::Expired => {}
            Taken::Pending(sender, method) => match reply(&method) {
                Ok(result) => {
                    let _ = sender.send(result);
                }
                Err(()) => {
                    let _ = sender.send(Err(pi_rpc_error_response(
                        &method,
                        "response command did not match the request",
                    )));
                    self.protocol_failure("Pi RPC response correlation failed.");
                }
            },
            Taken::Late(handler, method) => match reply(&method) {
                Ok(result) => {
                    if let Some(handler) = handler {
                        handler(result);
                    }
                }
                Err(()) => self.protocol_failure("Pi RPC response correlation failed."),
            },
        }
    }

    fn receive_stderr(&self, chunk: &[u8]) {
        if self.closed() {
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
        self.emit(PiClientEvent::ProtocolError(AgentError::new(message)));
        self.dispose_with(message, false);
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
            "diagnostics": self.diagnostics_now(),
        });
        *self.0.exit_info.borrow_mut() = Some(info.clone());
        self.0.closed.set(true);
        self.0.writer.borrow_mut().take();
        let message = error.map(|e| e.message).unwrap_or_else(|| match code {
            Some(code) => format!("Pi RPC process exited with code {code}."),
            None => "Pi RPC process exited.".into(),
        });
        self.reject_pending(&AgentError::new(message));
        self.0.exited.notify_waiters();
        self.emit(PiClientEvent::Exit(js::with(&info, "expected", expected)));
    }

    fn reject_pending(&self, error: &AgentError) {
        self.0.requests.close(|method| {
            if error.delivery_outcome.as_deref() == Some("unknown") {
                error.clone()
            } else {
                pi_rpc_delivery_unknown_error(method, &error.message)
            }
        });
    }
}

impl PiClient for PiRpcClient {
    fn request(
        &self,
        kind: &str,
        payload: Value,
        options: RequestOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Value>> {
        let client = self.clone();
        let kind = kind.to_string();
        Box::pin(async move { client.request_now(&kind, payload, options).await })
    }

    fn respond_extension_ui(&self, message: Value) -> AgentResult<()> {
        self.respond_extension_ui_now(&message)
    }

    fn on(&self, listener: Rc<dyn Fn(PiClientEvent)>) -> u64 {
        let id = self.0.next_listener.get() + 1;
        self.0.next_listener.set(id);
        self.0.listeners.borrow_mut().push((id, listener));
        id
    }

    fn closed(&self) -> bool {
        PiRpcClient::closed(self)
    }

    fn diagnostics(&self) -> String {
        self.diagnostics_now()
    }

    fn dispose(&self, reason: &str, expected: bool) {
        self.dispose_with(reason, expected);
    }

    fn wait_for_exit(&self) -> LocalBoxFuture<'static, AgentResult<Value>> {
        let client = self.clone();
        Box::pin(async move { client.wait_for_exit_now(None).await })
    }
}

/// A scripted Pi client (the product tests' `FakePiClient`).
#[cfg(test)]
pub mod fake {
    use super::*;
    use std::cell::RefCell;

    /// A request interceptor: `Some(answer)` replaces the scripted reply.
    pub type Intercept =
        Rc<dyn Fn(&str, &Value) -> Option<LocalBoxFuture<'static, AgentResult<Value>>>>;

    pub struct FakePiClient {
        pub options: PiClientOptions,
        pub closed: Cell<bool>,
        pub calls: RefCell<Vec<(String, Value)>>,
        pub extension_responses: RefCell<Vec<Value>>,
        pub state: RefCell<Value>,
        pub intercept: RefCell<Option<Intercept>>,
        /// While set, `waitForExit()` waits for this gate.
        pub exit_gate: RefCell<Option<Rc<tokio::sync::Notify>>>,
        listeners: RefCell<Vec<Listener>>,
    }

    impl FakePiClient {
        pub fn new(options: PiClientOptions) -> Rc<Self> {
            Rc::new(Self {
                options,
                closed: Cell::new(false),
                calls: RefCell::default(),
                extension_responses: RefCell::default(),
                state: RefCell::new(json!({
                    "sessionId": "pi-session",
                    "sessionName": "Pi test",
                    "model": { "provider": "openai-codex", "id": "gpt-5.6-sol" },
                    "thinkingLevel": "high",
                })),
                intercept: RefCell::default(),
                exit_gate: RefCell::default(),
                listeners: RefCell::default(),
            })
        }

        /// `client.emit("event", message)`.
        pub fn emit(&self, message: Value) {
            let listeners = self.listeners.borrow().clone();
            for listener in listeners {
                listener(PiClientEvent::Event(message.clone()));
            }
        }

        fn answer(&self, kind: &str, payload: &Value) -> Value {
            match kind {
                "get_state" => self.state.borrow().clone(),
                "get_available_models" => json!({ "models": [{
                    "provider": "openai-codex",
                    "id": "gpt-5.6-sol",
                    "name": "GPT-5.6-Sol",
                    "reasoning": true,
                    "contextWindow": 256_000,
                    "thinkingLevelMap": { "xhigh": "xhigh" },
                }] }),
                "get_commands" => {
                    json!({ "commands": [{ "name": "review", "description": "Review changes", "source": "extension" }] })
                }
                "get_available_thinking_levels" => {
                    json!({ "levels": ["off", "low", "medium", "high", "xhigh"] })
                }
                "set_model" => {
                    self.state.borrow_mut()["model"] =
                        json!({ "provider": payload["provider"], "id": payload["modelId"] });
                    json!({})
                }
                "set_thinking_level" => {
                    self.state.borrow_mut()["thinkingLevel"] = payload["level"].clone();
                    json!({})
                }
                "get_messages" => json!({ "messages": [] }),
                _ => json!({}),
            }
        }
    }

    impl PiClient for FakePiClient {
        fn request(
            &self,
            kind: &str,
            payload: Value,
            _options: RequestOptions,
        ) -> LocalBoxFuture<'static, AgentResult<Value>> {
            let intercept = self.intercept.borrow().clone();
            if let Some(answer) = intercept.and_then(|intercept| intercept(kind, &payload)) {
                return answer;
            }
            self.calls
                .borrow_mut()
                .push((kind.to_string(), payload.clone()));
            let value = self.answer(kind, &payload);
            Box::pin(async move { Ok(value) })
        }

        fn respond_extension_ui(&self, message: Value) -> AgentResult<()> {
            self.extension_responses.borrow_mut().push(message);
            Ok(())
        }

        fn on(&self, listener: Rc<dyn Fn(PiClientEvent)>) -> u64 {
            self.listeners.borrow_mut().push(listener);
            self.listeners.borrow().len() as u64
        }

        fn closed(&self) -> bool {
            self.closed.get()
        }

        fn diagnostics(&self) -> String {
            String::new()
        }

        fn dispose(&self, _reason: &str, _expected: bool) {
            self.closed.set(true);
        }

        fn wait_for_exit(&self) -> LocalBoxFuture<'static, AgentResult<Value>> {
            let gate = self.exit_gate.borrow().clone();
            Box::pin(async move {
                if let Some(gate) = gate {
                    gate.notified().await;
                }
                Ok(json!({ "expected": true }))
            })
        }
    }
}
