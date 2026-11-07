//! The SDK's `Query`: the stream-json control protocol over a
//! [`ProcessTransport`]. SDK messages are iterated; `control_request`s from
//! the CLI (`can_use_tool`, …) are answered; the SDK's own requests
//! (`initialize`, `interrupt`, `set_model`, `set_permission_mode`) are
//! correlated by request id.
use super::process_transport::{ProcessTransport, abort_error, is_abort_error};
use super::{CanUseTool, ClaudeQuery, PermissionOptions, PromptSource, QueryOptions, SystemPrompt};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::{self, Obj};
use crate::agent::tasks::{Canceller, SharedTask, shared};
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{Notify, oneshot};
use tokio::task::spawn_local;

type Pending = oneshot::Sender<AgentResult<Value>>;

/// The message stream's end: done, or failed with an error not yet read.
enum StreamEnd {
    Done,
    Failed(AgentError),
}

/// `new Query(transport, …)`.
#[derive(Clone)]
pub struct ProcessQuery(Rc<Inner>);

struct Inner {
    transport: ProcessTransport,
    abort: Canceller,
    can_use_tool: Option<CanUseTool>,
    pending: RefCell<HashMap<String, Pending>>,
    cancel_controllers: RefCell<HashMap<String, Canceller>>,
    queue: RefCell<VecDeque<Value>>,
    end: RefCell<Option<StreamEnd>>,
    messages: Notify,
    cleanup_performed: Cell<bool>,
    first_result: Cell<bool>,
    first_result_notify: Notify,
    last_error_result_text: RefCell<Option<String>>,
    initialization: RefCell<Option<SharedTask<AgentResult<Value>>>>,
}

/// `Math.random().toString(36).substring(2, 15)`.
fn request_id() -> String {
    let bytes = uuid::Uuid::new_v4().into_bytes();
    bytes
        .iter()
        .take(13)
        .map(|byte| {
            let digit = byte % 36;
            char::from(if digit < 10 {
                b'0' + digit
            } else {
                b'a' + digit - 10
            })
        })
        .collect()
}

/// `query({ prompt, options })`.
pub fn query(prompt: Rc<dyn PromptSource>, options: QueryOptions) -> AgentResult<ProcessQuery> {
    let abort = options.abort_controller.clone().unwrap_or_default();
    let transport = ProcessTransport::spawn(&options, &abort)?;
    let query = ProcessQuery(Rc::new(Inner {
        transport,
        abort,
        can_use_tool: options.can_use_tool.clone(),
        pending: RefCell::default(),
        cancel_controllers: RefCell::default(),
        queue: RefCell::default(),
        end: RefCell::default(),
        messages: Notify::new(),
        cleanup_performed: Cell::new(false),
        first_result: Cell::new(false),
        first_result_notify: Notify::new(),
        last_error_result_text: RefCell::default(),
        initialization: RefCell::default(),
    }));
    spawn_local(query.clone().read_messages());
    let initialize = {
        let query = query.clone();
        let system_prompt = options.system_prompt.clone();
        shared(async move { query.initialize(system_prompt).await })
    };
    spawn_local({
        let initialize = initialize.clone();
        async move {
            let _ = initialize.await;
        }
    });
    *query.0.initialization.borrow_mut() = Some(initialize);
    spawn_local(query.clone().stream_input(prompt));
    Ok(query)
}

impl ProcessQuery {
    fn enqueue(&self, message: Value) {
        self.0.queue.borrow_mut().push_back(message);
        self.0.messages.notify_waiters();
    }

    fn finish(&self, end: StreamEnd) {
        let mut slot = self.0.end.borrow_mut();
        if slot.is_none() {
            *slot = Some(end);
        }
        drop(slot);
        self.0.messages.notify_waiters();
    }

    fn resolve_first_result(&self) {
        self.0.first_result.set(true);
        self.0.first_result_notify.notify_waiters();
    }

    /// `cleanup(error)`.
    fn cleanup(&self, error: Option<AgentError>) {
        let inner = &self.0;
        if inner.cleanup_performed.replace(true) {
            return;
        }
        let controllers: Vec<Canceller> = inner
            .cancel_controllers
            .borrow_mut()
            .drain()
            .map(|(_, c)| c)
            .collect();
        for controller in controllers {
            controller.cancel(abort_error("The operation was aborted."));
        }
        inner.transport.close();
        let reason = error
            .clone()
            .unwrap_or_else(|| AgentError::new("Query closed before response received"));
        let pending: Vec<Pending> = inner.pending.borrow_mut().drain().map(|(_, p)| p).collect();
        for sender in pending {
            let _ = sender.send(Err(reason.clone()));
        }
        self.finish(match error {
            Some(error) => StreamEnd::Failed(error),
            None => StreamEnd::Done,
        });
    }

    /// `readMessages()`.
    async fn read_messages(self) {
        if let Some(stdout) = self.0.transport.take_stdout() {
            let mut reader = BufReader::new(stdout);
            let mut line = Vec::new();
            loop {
                line.clear();
                match reader.read_until(b'\n', &mut line).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
                let text = String::from_utf8_lossy(&line);
                let text = text.trim();
                if text.is_empty() {
                    continue;
                }
                // Non-JSON stdout is diagnostic noise, never a message.
                if let Ok(message) = serde_json::from_str::<Value>(text) {
                    self.dispatch(message);
                }
            }
        }
        let exited = match self.0.transport.exit_error() {
            Some(error) => Err(error),
            None => self.0.transport.wait_for_exit().await,
        };
        self.resolve_first_result();
        match exited {
            Ok(()) => {
                self.finish(StreamEnd::Done);
                self.cleanup(None);
            }
            Err(error) => {
                let replaced = self
                    .0
                    .last_error_result_text
                    .borrow()
                    .clone()
                    .filter(|_| !is_abort_error(&error))
                    .map(|text| {
                        AgentError::new(format!("Claude Code returned an error result: {text}"))
                    });
                let error = replaced.unwrap_or(error);
                self.finish(StreamEnd::Failed(error.clone()));
                self.cleanup(Some(error));
            }
        }
    }

    fn dispatch(&self, message: Value) {
        let kind = message.get("type").and_then(Value::as_str).unwrap_or("");
        let subtype = message.get("subtype").and_then(Value::as_str);
        match kind {
            "control_response" => {
                let response = message.get("response").cloned().unwrap_or(Value::Null);
                let id = js::to_js_string(response.get("request_id"));
                let sender = self.0.pending.borrow_mut().remove(&id);
                if let Some(sender) = sender {
                    if response.get("subtype").and_then(Value::as_str) == Some("success") {
                        let _ = sender.send(Ok(response));
                    } else {
                        let _ = sender.send(Err(AgentError::new(js::to_js_string(
                            response.get("error"),
                        ))));
                        for request in response
                            .get("pending_permission_requests")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                        {
                            if request.pointer("/request/subtype").and_then(Value::as_str)
                                == Some("can_use_tool")
                            {
                                spawn_local(self.clone().handle_control_request(request.clone()));
                            }
                        }
                    }
                }
                return;
            }
            "control_request" => {
                spawn_local(self.clone().handle_control_request(message));
                return;
            }
            "control_cancel_request" => {
                let id = js::to_js_string(message.get("request_id"));
                let controller = self.0.cancel_controllers.borrow_mut().remove(&id);
                if let Some(controller) = controller {
                    controller.cancel(abort_error("The operation was aborted."));
                }
                return;
            }
            "keep_alive" | "transcript_mirror" => return,
            "system" if matches!(subtype, Some("post_turn_summary" | "task_summary")) => {
                self.enqueue(message);
                return;
            }
            "result" => {
                let text = (message.get("is_error") == Some(&Value::Bool(true))).then(|| {
                    if subtype == Some("success") {
                        js::to_js_string(message.get("result"))
                    } else {
                        message
                            .get("errors")
                            .and_then(Value::as_array)
                            .map(|errors| {
                                errors
                                    .iter()
                                    .map(|e| js::to_js_string(Some(e)))
                                    .collect::<Vec<_>>()
                                    .join("; ")
                            })
                            .unwrap_or_default()
                    }
                });
                *self.0.last_error_result_text.borrow_mut() = text;
                self.resolve_first_result();
            }
            "system" if subtype == Some("session_state_changed") => {}
            _ => {
                *self.0.last_error_result_text.borrow_mut() = None;
            }
        }
        self.enqueue(message);
    }

    /// `handleControlRequest(request)`.
    async fn handle_control_request(self, message: Value) {
        let id = js::to_js_string(message.get("request_id"));
        let controller = Canceller::new();
        self.0
            .cancel_controllers
            .borrow_mut()
            .insert(id.clone(), controller.clone());
        let result = self.process_control_request(&message, &controller).await;
        if !self.0.cleanup_performed.get() {
            let response = match result {
                Ok(response) => json!({
                    "type": "control_response",
                    "response": { "subtype": "success", "request_id": id, "response": response },
                }),
                Err(error) => json!({
                    "type": "control_response",
                    "response": { "subtype": "error", "request_id": id, "error": error.message },
                }),
            };
            let _ = self
                .0
                .transport
                .write(format!("{}\n", js::stringify(&response)));
        }
        self.0.cancel_controllers.borrow_mut().remove(&id);
    }

    /// `processControlRequest(request, signal)`.
    async fn process_control_request(
        &self,
        message: &Value,
        controller: &Canceller,
    ) -> AgentResult<Value> {
        let request = message.get("request").cloned().unwrap_or(Value::Null);
        let field = |key: &str| request.get(key).filter(|v| !v.is_null()).cloned();
        match request.get("subtype").and_then(Value::as_str).unwrap_or("") {
            "can_use_tool" => {
                let Some(can_use_tool) = self.0.can_use_tool.clone() else {
                    return Err(AgentError::new("canUseTool callback is not provided."));
                };
                let options = PermissionOptions {
                    signal: Some(controller.signal()),
                    suggestions: field("permission_suggestions"),
                    blocked_path: field("blocked_path"),
                    decision_reason: field("decision_reason"),
                    title: field("title"),
                    display_name: field("display_name"),
                    description: field("description"),
                    tool_use_id: field("tool_use_id"),
                    agent_id: field("agent_id"),
                };
                let result = can_use_tool(
                    js::to_js_string(request.get("tool_name")),
                    request.get("input").cloned().unwrap_or(Value::Null),
                    options,
                )
                .await?;
                Ok(Obj::from(&result)
                    .opt("toolUseID", field("tool_use_id"))
                    .build())
            }
            "hook_callback" => Err(AgentError::new(format!(
                "No hook callback found for ID: {}",
                js::to_js_string(request.get("callback_id"))
            ))),
            "mcp_message" => Err(AgentError::new(format!(
                "SDK MCP server not found: {}",
                js::to_js_string(request.get("server_name"))
            ))),
            "elicitation" => Ok(json!({ "action": "decline" })),
            "oauth_token_refresh" => {
                Err(AgentError::new("getOAuthToken callback is not provided."))
            }
            "host_auth_token_refresh" => Err(AgentError::new(
                "getHostAuthToken callback is not provided.",
            )),
            subtype => Err(AgentError::new(format!(
                "Unsupported control request subtype: {subtype}"
            ))),
        }
    }

    /// `request(payload)`: the CLI's `control_response`.
    async fn request(&self, payload: Value) -> AgentResult<Value> {
        let id = request_id();
        let (sender, receiver) = oneshot::channel();
        self.0.pending.borrow_mut().insert(id.clone(), sender);
        let frame = json!({ "request_id": id, "type": "control_request", "request": payload });
        if let Err(error) = self
            .0
            .transport
            .write(format!("{}\n", js::stringify(&frame)))
        {
            self.0.pending.borrow_mut().remove(&id);
            return Err(error);
        }
        receiver
            .await
            .unwrap_or_else(|_| Err(AgentError::new("Query closed before response received")))
    }

    /// `initialize()`: the CLI's initialization result.
    async fn initialize(&self, system_prompt: Option<SystemPrompt>) -> AgentResult<Value> {
        let mut payload = Obj::new().set("subtype", "initialize");
        match system_prompt {
            None => payload = payload.set("systemPrompt", json!([""])),
            Some(SystemPrompt::Text(text)) => payload = payload.set("systemPrompt", json!([text])),
            Some(SystemPrompt::Preset { append, .. }) => {
                payload = payload.opt("appendSystemPrompt", append);
            }
        }
        let response = self.request(payload.build()).await?;
        Ok(response.get("response").cloned().unwrap_or(Value::Null))
    }

    /// `waitForFirstResult()`.
    async fn wait_for_first_result(&self) {
        let signal = self.0.abort.signal();
        loop {
            let notified = self.0.first_result_notify.notified();
            if self.0.first_result.get() || signal.is_cancelled() {
                return;
            }
            tokio::select! {
                () = notified => {}
                _ = signal.cancelled() => return,
            }
        }
    }

    /// `streamInput(prompt)`: user messages until the prompt ends, then EOF.
    async fn stream_input(self, prompt: Rc<dyn PromptSource>) {
        let mut count = 0;
        while let Some(message) = prompt.next().await {
            count += 1;
            if self.0.abort.signal().is_cancelled() {
                break;
            }
            if let Err(error) = self
                .0
                .transport
                .write(format!("{}\n", js::stringify(&message)))
            {
                if !is_abort_error(&error) {
                    self.0.abort.cancel(error);
                }
                return;
            }
        }
        if count > 0 && self.0.can_use_tool.is_some() {
            self.wait_for_first_result().await;
        }
        self.0.transport.end_input();
    }

    async fn next_message(self) -> Option<AgentResult<Value>> {
        loop {
            let notified = self.0.messages.notified();
            if let Some(message) = self.0.queue.borrow_mut().pop_front() {
                return Some(Ok(message));
            }
            let end = self.0.end.borrow_mut().take();
            match end {
                Some(StreamEnd::Done) => {
                    *self.0.end.borrow_mut() = Some(StreamEnd::Done);
                    self.cleanup(None);
                    return None;
                }
                Some(StreamEnd::Failed(error)) => {
                    *self.0.end.borrow_mut() = Some(StreamEnd::Done);
                    self.cleanup(Some(error.clone()));
                    return Some(Err(error));
                }
                None => notified.await,
            }
        }
    }

    async fn control(self, payload: Value) -> AgentResult<()> {
        self.request(payload).await.map(drop)
    }
}

impl ClaudeQuery for ProcessQuery {
    fn next(&self) -> LocalBoxFuture<'static, Option<AgentResult<Value>>> {
        Box::pin(self.clone().next_message())
    }
    fn initialization_result(&self) -> LocalBoxFuture<'static, AgentResult<Value>> {
        let initialization = self.0.initialization.borrow().clone();
        Box::pin(async move {
            match initialization {
                Some(initialization) => initialization.await,
                None => Err(AgentError::new("Query closed before response received")),
            }
        })
    }
    fn set_model(&self, model: Option<String>) -> LocalBoxFuture<'static, AgentResult<()>> {
        let payload = Obj::new()
            .set("subtype", "set_model")
            .opt("model", model)
            .build();
        Box::pin(self.clone().control(payload))
    }
    fn set_permission_mode(&self, mode: String) -> LocalBoxFuture<'static, AgentResult<()>> {
        Box::pin(
            self.clone()
                .control(json!({ "subtype": "set_permission_mode", "mode": mode })),
        )
    }
    fn interrupt(&self) -> LocalBoxFuture<'static, AgentResult<()>> {
        Box::pin(self.clone().control(json!({ "subtype": "interrupt" })))
    }
    fn close(&self) {
        self.cleanup(None);
    }
}
