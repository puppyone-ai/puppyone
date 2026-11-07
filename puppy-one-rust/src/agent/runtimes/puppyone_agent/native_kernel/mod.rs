//! The Built-in Agent's kernel, in process: the bundled worker's
//! `puppyone-pi-rpc-v1` protocol (`worker/runtime.mjs` under Pi's
//! `runRpcMode`), served by the native inference loop and workspace tools
//! instead of the Pi SDK and Node. The shared Pi RPC client talks to it
//! over in-memory pipes exactly as it talks to the worker process, so the
//! Built-in Agent adapter, its model-connection binding and the event
//! normalizer stay the product's.
mod session;
mod tools;
mod turn;

#[cfg(test)]
mod tests;

pub use turn::{Complete, CompleteRequest};

use super::puppyone_agent_public_identity::BUILT_IN_AGENT_DISPLAY_NAME;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::event_loop::spawn;
use crate::agent::transports::jsonl_rpc_connection::{ConnectionOptions, ProcessIo, Spawner};
use serde_json::{Value, json};
use session::Session;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, watch};

/// How the client launched the kernel (`parseWorkerArguments` with the
/// worker's environment and bootstrap envelope).
#[derive(Clone, Debug)]
struct Launch {
    cwd: PathBuf,
    profile: PathBuf,
    no_session: bool,
    session_id: Option<String>,
    read_only: bool,
    configuration: Option<Value>,
}

fn parse_launch(options: &ConnectionOptions) -> Result<Launch, String> {
    let env: HashMap<String, String> = options
        .env
        .clone()
        .unwrap_or_default()
        .into_iter()
        .collect();
    let profile = env
        .get("PUPPYONE_AGENT_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or("PUPPYONE_AGENT_HOME must be an absolute path.")?;
    let mut no_session = false;
    let mut session_id = None;
    let mut values = options.args.iter().take(16);
    while let Some(value) = values.next() {
        match value.as_str() {
            "--mode" => {
                if values.next().map(String::as_str) != Some("rpc") {
                    return Err(format!(
                        "{BUILT_IN_AGENT_DISPLAY_NAME} worker supports only Pi RPC mode."
                    ));
                }
            }
            // Compatibility flag owned by the shared Pi RPC launcher. Policy
            // remains enabled.
            "--no-approve" => {}
            "--no-session" => no_session = true,
            "--session" => {
                let id = values.next().cloned().unwrap_or_default();
                if !session::valid_session_id(&id) {
                    return Err(format!(
                        "{BUILT_IN_AGENT_DISPLAY_NAME} session id is invalid."
                    ));
                }
                session_id = Some(id);
            }
            other => {
                return Err(format!(
                    "Unsupported {BUILT_IN_AGENT_DISPLAY_NAME} worker argument: {}",
                    crate::agent::contract::js::head16(other, 120)
                ));
            }
        }
    }
    if no_session && session_id.is_some() {
        return Err(format!(
            "{BUILT_IN_AGENT_DISPLAY_NAME} cannot combine --no-session and --session."
        ));
    }
    let read_only = env
        .get("PUPPYONE_MODEL_CONNECTION_READ_ONLY")
        .map(String::as_str)
        == Some("1");
    let configuration = match (
        env.get("PUPPYONE_MODEL_CONNECTION_BOOTSTRAP")
            .map(String::as_str),
        options.bootstrap.as_ref(),
    ) {
        (Some("1"), Some(bytes)) if bytes.len() <= 512 * 1024 => Some(
            serde_json::from_slice::<Value>(bytes)
                .ok()
                .filter(|value| value["schemaVersion"] == 1)
                .ok_or("Model connection: INVALID_CONFIGURATION")?,
        ),
        (Some("1"), _) => return Err("Model connection: AUTHORITY_REQUIRED".into()),
        _ => None,
    };
    Ok(Launch {
        cwd: options.cwd.clone(),
        profile,
        no_session,
        session_id,
        read_only,
        configuration,
    })
}

/// The process boundary for the Pi RPC client: `spawn(...)` that starts
/// the kernel on the current (host) thread.
pub fn native_kernel_spawner(complete: Complete) -> Spawner {
    Rc::new(
        move |options: &ConnectionOptions| -> AgentResult<ProcessIo> {
            let (client_stdin, worker_stdin) = tokio::io::duplex(1 << 20);
            let (worker_stdout, client_stdout) = tokio::io::duplex(1 << 20);
            let (mut worker_stderr, client_stderr) = tokio::io::duplex(64 << 10);
            let (exit, exited) = oneshot::channel::<i32>();
            let (stop, stopped) = watch::channel(false);
            let launch = parse_launch(options);
            let complete = complete.clone();
            spawn(async move {
                match launch.and_then(|launch| Kernel::start(launch, complete)) {
                    Err(message) => {
                        // A worker that cannot start reports on stderr and exits;
                        // the client reads the report before it sees the exit.
                        let _ = worker_stderr.write_all(message.as_bytes()).await;
                        let _ = worker_stderr.shutdown().await;
                        drop(worker_stdout);
                        for _ in 0..4 {
                            tokio::task::yield_now().await;
                        }
                        let _ = exit.send(1);
                        // Its stdin stays readable until the client lets go, so
                        // a request already in flight is answered by the exit.
                        let mut stdin = BufReader::new(worker_stdin).lines();
                        while let Ok(Some(_)) = stdin.next_line().await {}
                    }
                    Ok((kernel, lines)) => {
                        let writer = spawn(write_lines(lines, worker_stdout));
                        kernel.serve(worker_stdin, stopped).await;
                        kernel.close();
                        let _ = writer.await;
                        drop(worker_stderr);
                        let _ = exit.send(0);
                    }
                }
            });
            Ok(ProcessIo {
                stdin: Box::new(client_stdin),
                stdout: Box::new(client_stdout),
                stderr: Box::new(client_stderr),
                exit: Box::pin(async move {
                    match exited.await {
                        Ok(code) => (Some(code), None, None),
                        Err(_) => (None, Some("SIGKILL".into()), None),
                    }
                }),
                kill: Rc::new(move |_force| stop.send(true).is_ok()),
                pid: None,
            })
        },
    )
}

/// `None` ends the output stream.
type Line = Option<Vec<u8>>;

async fn write_lines(
    mut lines: mpsc::UnboundedReceiver<Line>,
    mut stdout: tokio::io::DuplexStream,
) {
    while let Some(Some(line)) = lines.recv().await {
        if stdout.write_all(&line).await.is_err() || stdout.flush().await.is_err() {
            break;
        }
    }
    let _ = stdout.shutdown().await;
}

/// A running prompt: its abort switch and queued steering.
struct Run {
    aborted: Arc<AtomicBool>,
    abort: watch::Sender<bool>,
    steering: RefCell<Vec<Value>>,
}

impl Run {
    fn abort(&self) {
        self.aborted.store(true, Ordering::Release);
        let _ = self.abort.send(true);
    }
}

pub(super) struct Kernel {
    launch: Launch,
    complete: Complete,
    out: mpsc::UnboundedSender<Line>,
    session: RefCell<Session>,
    model: RefCell<Option<Value>>,
    thinking_level: RefCell<String>,
    run: RefCell<Option<Rc<Run>>>,
    compacting: Cell<bool>,
    approvals: RefCell<HashMap<String, oneshot::Sender<bool>>>,
    closed: Cell<bool>,
}

impl Kernel {
    fn start(
        launch: Launch,
        complete: Complete,
    ) -> Result<(Rc<Self>, mpsc::UnboundedReceiver<Line>), String> {
        let session = match launch.session_id.as_deref() {
            Some(id) => Session::open(&launch.profile, &launch.cwd, id)?,
            None => Session::create(&launch.cwd, launch.no_session),
        };
        let configuration = launch.configuration.clone();
        let (out, lines) = mpsc::unbounded_channel();
        let kernel = Rc::new(Self {
            launch,
            complete,
            out,
            session: RefCell::new(session),
            model: RefCell::default(),
            thinking_level: RefCell::new("off".into()),
            run: RefCell::default(),
            compacting: Cell::new(false),
            approvals: RefCell::default(),
            closed: Cell::new(false),
        });
        // `createConnectionModelRuntime`: the leased connection's selected
        // model is current.
        if let Some(configuration) = configuration.as_ref() {
            let selected = configuration["selectedModelId"]
                .as_str()
                .unwrap_or_default();
            *kernel.model.borrow_mut() = kernel
                .models()
                .into_iter()
                .find(|model| model["id"] == selected);
        }
        Ok((kernel, lines))
    }

    async fn serve(
        self: &Rc<Self>,
        stdin: tokio::io::DuplexStream,
        mut stopped: watch::Receiver<bool>,
    ) {
        let mut lines = BufReader::new(stdin).lines();
        loop {
            tokio::select! {
                line = lines.next_line() => match line {
                    Ok(Some(line)) => self.handle(&line),
                    _ => break,
                },
                _ = stopped.changed() => break,
            }
        }
    }

    fn close(&self) {
        self.closed.set(true);
        if let Some(run) = self.run.borrow().clone() {
            run.abort();
        }
        self.approvals.borrow_mut().clear();
        let _ = self.out.send(None);
    }

    pub(super) fn emit(&self, message: Value) {
        if self.closed.get() {
            return;
        }
        let mut bytes = serde_json::to_vec(&message).unwrap_or_default();
        bytes.push(b'\n');
        let _ = self.out.send(Some(bytes));
    }

    fn respond(&self, id: &Value, command: &str, result: Result<Value, String>) {
        let mut message = json!({ "type": "response", "id": id, "command": command });
        match result {
            Ok(data) => {
                message["success"] = Value::Bool(true);
                message["data"] = data;
            }
            Err(error) => {
                message["success"] = Value::Bool(false);
                message["error"] = Value::from(error);
            }
        }
        self.emit(message);
    }

    fn handle(self: &Rc<Self>, line: &str) {
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let kind = message["type"].as_str().unwrap_or_default().to_string();
        if kind == "extension_ui_response" {
            let id = message["id"].as_str().unwrap_or_default();
            if let Some(answer) = self.approvals.borrow_mut().remove(id) {
                let _ = answer.send(message["confirmed"] == true);
            }
            return;
        }
        let id = message["id"].clone();
        let result = match kind.as_str() {
            "get_state" => Ok(self.state()),
            "get_available_models" => Ok(json!({ "models": self.models() })),
            "get_commands" => Ok(json!({ "commands": [] })),
            "get_available_thinking_levels" => Ok(json!({ "levels": ["off"] })),
            "set_model" => self.set_model(&message),
            "set_thinking_level" => {
                *self.thinking_level.borrow_mut() =
                    message["level"].as_str().unwrap_or("off").to_string();
                Ok(json!({}))
            }
            "set_session_name" => {
                let name = message["name"]
                    .as_str()
                    .map(|n| crate::agent::contract::js::head16(n.trim(), 200).to_string());
                self.session.borrow_mut().name = name.filter(|n| !n.is_empty());
                self.persist().map(|()| json!({}))
            }
            "get_messages" => Ok(json!({ "messages": self.session.borrow().messages })),
            "prompt" => self.prompt(&message),
            "steer" | "follow_up" => self.steer(&message),
            "abort" => {
                if let Some(run) = self.run.borrow().clone() {
                    run.abort();
                }
                Ok(json!({}))
            }
            "compact" => {
                let kernel = self.clone();
                spawn(async move {
                    let result = turn::compact(&kernel).await;
                    kernel.respond(&id, "compact", result);
                });
                return;
            }
            _ => Err(format!("Unknown command: {kind}")),
        };
        self.respond(&id, &kind, result);
    }

    /// The leased connection's models (`get_available_models`).
    fn models(&self) -> Vec<Value> {
        let Some(configuration) = self.launch.configuration.as_ref() else {
            return Vec::new();
        };
        let provider = configuration["connectionId"].clone();
        configuration["models"]
            .as_array()
            .map(|models| {
                models
                    .iter()
                    .map(|model| {
                        let images = model["capabilities"]["images"] == "supported";
                        json!({
                            "provider": provider,
                            "id": model["id"],
                            "name": model["name"],
                            "contextWindow": model["contextWindow"],
                            "reasoning": false,
                            "input": if images { json!(["text", "image"]) } else { json!(["text"]) },
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn state(&self) -> Value {
        let session = self.session.borrow();
        json!({
            "sessionId": session.id,
            "sessionName": session.name,
            "sessionFile": session.file(&self.launch.profile),
            "model": *self.model.borrow(),
            "thinkingLevel": *self.thinking_level.borrow(),
            "isStreaming": self.run.borrow().is_some(),
            "isCompacting": self.compacting.get(),
            "messageCount": session.messages.len(),
            "pendingMessageCount": self.run.borrow().as_ref().map_or(0, |run| run.steering.borrow().len()),
        })
    }

    fn set_model(&self, message: &Value) -> Result<Value, String> {
        let found = self
            .models()
            .into_iter()
            .find(|model| {
                model["provider"] == message["provider"] && model["id"] == message["modelId"]
            })
            .ok_or_else(|| "Model connection: MODEL_UNAVAILABLE".to_string())?;
        *self.model.borrow_mut() = Some(found.clone());
        Ok(found)
    }

    fn persist(&self) -> Result<(), String> {
        self.session.borrow_mut().save(&self.launch.profile)
    }

    fn prompt(self: &Rc<Self>, message: &Value) -> Result<Value, String> {
        if self.launch.read_only || self.launch.configuration.is_none() {
            return Err("Read-only history cannot perform inference.".into());
        }
        if self.run.borrow().is_some() || self.compacting.get() {
            return Err(format!(
                "{BUILT_IN_AGENT_DISPLAY_NAME} is already processing a prompt."
            ));
        }
        let model = self
            .model
            .borrow()
            .clone()
            .ok_or_else(|| "Model connection: MODEL_REQUIRED".to_string())?;
        let user = turn::user_message(message);
        let (abort, aborted_signal) = watch::channel(false);
        let run = Rc::new(Run {
            aborted: Arc::new(AtomicBool::new(false)),
            abort,
            steering: RefCell::default(),
        });
        *self.run.borrow_mut() = Some(run.clone());
        let kernel = self.clone();
        spawn(async move {
            turn::run(&kernel, &run, aborted_signal, model, user).await;
            let mut current = kernel.run.borrow_mut();
            if current
                .as_ref()
                .is_some_and(|active| Rc::ptr_eq(active, &run))
            {
                *current = None;
            }
        });
        Ok(json!({}))
    }

    fn steer(&self, message: &Value) -> Result<Value, String> {
        let run =
            self.run.borrow().clone().ok_or_else(|| {
                format!("{BUILT_IN_AGENT_DISPLAY_NAME} is not processing a prompt.")
            })?;
        run.steering.borrow_mut().push(turn::user_message(message));
        Ok(json!({}))
    }

    /// `ctx.ui.confirm(PUPPYONE_AGENT_APPROVAL_PROTOCOL, request)`.
    async fn confirm(&self, request: &Value, mut aborted: watch::Receiver<bool>) -> bool {
        let id = uuid::Uuid::new_v4().to_string();
        let (answer, answered) = oneshot::channel();
        self.approvals.borrow_mut().insert(id.clone(), answer);
        self.emit(json!({
            "type": "extension_ui_request",
            "id": id,
            "method": "confirm",
            "title": super::puppyone_agent_kernel::PUPPYONE_AGENT_APPROVAL_PROTOCOL,
            "message": request.to_string(),
        }));
        let confirmed = tokio::select! {
            answer = answered => answer.unwrap_or(false),
            _ = aborted.wait_for(|aborted| *aborted) => false,
        };
        self.approvals.borrow_mut().remove(&id);
        confirmed
    }
}

/// The production [`Complete`]: the leased connection through the native
/// model client (PuppyOne compute through the signed-in broker).
pub fn configured_complete() -> Complete {
    Rc::new(|request: CompleteRequest| {
        Box::pin(async move {
            let configuration = request.configuration.clone();
            let model_id = request.model_id.clone();
            let connection = tokio::task::spawn_blocking(move || {
                let mut connections = super::configuration::load()?;
                connections.extend(super::configuration::managed());
                super::native_model_connections::resolve_leased_connection(
                    &configuration,
                    &model_id,
                    &connections,
                )
                .map_err(|error| error.message)
            })
            .await
            .map_err(|error| error.to_string())??;
            let delta = request.delta.clone();
            super::model_client::complete(
                &connection,
                &request.context,
                request.tools,
                |kind, text| delta(kind, text),
            )
            .await
        })
    })
}

/// The readiness of the in-process kernel (`discoverPuppyOneAgentWorker`).
pub fn native_kernel_readiness(user_data_path: &str, executable_path: &str) -> AgentResult<Value> {
    use super::puppyone_agent_identity::PUPPYONE_AGENT_RUNTIME_ID;
    use super::puppyone_agent_kernel::{PUPPYONE_PI_KERNEL, PUPPYONE_PI_KERNEL_PROTOCOL};
    let profile = crate::agent::node_path::resolve(user_data_path, "agent-runtime/puppyone-agent")
        .to_string_lossy()
        .into_owned();
    if !crate::agent::node_path::is_absolute(executable_path) {
        return Err(AgentError::new(format!(
            "{BUILT_IN_AGENT_DISPLAY_NAME} launch paths are unavailable."
        )));
    }
    let base: crate::agent::discovery::command_environment::EnvMap = std::env::vars().collect();
    let platform = crate::agent::discovery::bounded_process_probe::node_platform();
    let environment = super::puppyone_agent_environment::build_puppyone_agent_environment(
        &base, &profile, platform,
    )?;
    Ok(json!({
        "provider": PUPPYONE_AGENT_RUNTIME_ID,
        "runtimeId": PUPPYONE_AGENT_RUNTIME_ID,
        "source": "bundled",
        "pinnedVersion": PUPPYONE_PI_KERNEL["version"],
        "upstreamCommit": PUPPYONE_PI_KERNEL["sourceCommit"],
        "executablePath": executable_path,
        "argsPrefix": [],
        "environment": environment,
        "version": env!("CARGO_PKG_VERSION"),
        "kernel": "native",
        "status": "ready",
        "code": "READY",
        "message": format!("{BUILT_IN_AGENT_DISPLAY_NAME} is ready."),
        "compatibility": PUPPYONE_PI_KERNEL_PROTOCOL,
        "profilePath": profile,
    }))
}

/// `createPuppyOneAgentDiscovery()` for the in-process kernel.
pub fn create_native_kernel_discovery(
    user_data_path: String,
    executable_path: String,
) -> crate::agent::connections::runtime_discovery_cache::CachedRuntimeDiscovery {
    crate::agent::connections::runtime_discovery_cache::CachedRuntimeDiscovery::new(
        Rc::new(move |_signal| {
            let readiness = native_kernel_readiness(&user_data_path, &executable_path);
            Box::pin(async move { readiness })
        }),
        None,
    )
}
