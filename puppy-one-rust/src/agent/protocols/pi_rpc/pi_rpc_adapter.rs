//! Pi's official JSONL RPC. Modern runs complete at agent_settled, after retries.
use crate::agent::persistence::session_catalog::Catalog;
use crate::{
    agent::{
        domain::{
            agent_session_model::*,
            reference_input::{Prompt, ReferenceContent},
        },
        runtime::agent_runtime_port::AgentRuntimePort,
        transports::jsonl_rpc_connection::{Connection, Event},
    },
    wake::Wake,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    time::{Duration, Instant},
};
pub struct Session {
    catalog: Catalog,
    connection: Connection,
    executable: PathBuf,
    root: PathBuf,
    wake: Wake,
    snapshot: SessionSnapshot,
    next: u64,
    pending: HashMap<String, (String, Instant)>,
    dialogs: HashMap<String, String>,
    message_id: String,
    serial: u64,
    expected: Option<String>,
    settled_events: bool,
    turn_error: Option<String>,
}
impl Session {
    pub fn new(executable: PathBuf, root: PathBuf, history: bool, wake: Wake) -> Self {
        let connection =
            Connection::spawn(executable.clone(), args(None), root.clone(), wake.clone());
        let mut s = Self::connected(connection, executable, root, history, wake);
        s.bootstrap();
        s
    }
    fn connected(
        connection: Connection,
        executable: PathBuf,
        root: PathBuf,
        history: bool,
        wake: Wake,
    ) -> Self {
        let mut snapshot = SessionSnapshot::new("Pi", history);
        snapshot.capabilities = Capabilities {
            history: true,
            models: true,
            steer: true,
            compact: true,
            rename: true,
            images: true,
            text_references: true,
            ..Default::default()
        };
        Self {
            catalog: Catalog::new(&root, "pi", wake.clone()),
            connection,
            executable,
            root,
            wake,
            snapshot,
            next: 0,
            pending: HashMap::new(),
            dialogs: HashMap::new(),
            message_id: String::new(),
            serial: 0,
            expected: None,
            settled_events: false,
            turn_error: None,
        }
    }
    fn bootstrap(&mut self) {
        for method in [
            "get_state",
            "get_available_models",
            "get_commands",
            "get_available_thinking_levels",
        ] {
            self.request(method, json!({}));
        }
    }
    fn request(&mut self, method: &str, mut payload: Value) {
        self.next += 1;
        let id = format!("puppyone-{}", self.next);
        payload["id"] = json!(id);
        payload["type"] = json!(method);
        match self.connection.send(payload) {
            Ok(()) => {
                self.pending.insert(id, (method.into(), Instant::now()));
            }
            Err(e) => self.snapshot.fail(e),
        }
    }
    fn project(&mut self, message: &Value, id: &str) {
        let role = match message["role"].as_str() {
            Some("user") => "You".into(),
            Some("assistant") => self.snapshot.runtime.clone(),
            Some("toolResult") => message["toolName"].as_str().unwrap_or("Tool").into(),
            _ => "System".into(),
        };
        let mut text = String::new();
        for part in message["content"].as_array().into_iter().flatten() {
            if let Some(value) = part["text"].as_str() {
                text.push_str(value);
            } else if part["type"] == "toolCall" {
                self.snapshot.tool_call(
                    part["id"].as_str().unwrap_or("tool"),
                    part["name"].as_str().unwrap_or("Tool"),
                    part["arguments"].to_string(),
                    "running",
                );
            } else if let Some(thought) = part["thinking"].as_str() {
                self.snapshot
                    .upsert(format!("{id}:thinking"), "Reasoning", thought, "");
            }
        }
        if let Some(content) = message["content"].as_str() {
            text = content.into();
        }
        if !text.is_empty() {
            self.snapshot
                .upsert(id, role, text, message["stopReason"].as_str().unwrap_or(""));
        }
    }
    fn observe_outcome(&mut self, message: &Value) {
        if message["role"] != "assistant" {
            return;
        }
        match message["stopReason"].as_str() {
            Some("error") => {
                self.turn_error = Some(bounded_text(
                    message["errorMessage"]
                        .as_str()
                        .unwrap_or("Pi model request failed")
                        .into(),
                    4096,
                ));
            }
            Some("stop" | "length" | "toolUse") => self.turn_error = None,
            _ => {}
        }
    }
    fn finish_run(&mut self, aborted: bool) {
        if self.snapshot.turn.is_none() {
            return;
        }
        let interrupted = aborted || self.snapshot.state == State::Stopping;
        self.snapshot.error = if interrupted {
            None
        } else {
            self.turn_error.take()
        };
        self.snapshot.notice = None;
        self.snapshot.finish(if interrupted {
            "interrupted"
        } else if self.snapshot.error.is_some() {
            "failed"
        } else {
            "completed"
        });
        self.request("get_session_stats", json!({}));
    }
    fn handle(&mut self, v: Value) {
        let kind = v["type"].as_str().unwrap_or("");
        if kind == "response" {
            let id = v["id"].as_str().unwrap_or("");
            let Some((method, _)) = self.pending.remove(id) else {
                return;
            };
            if v["command"].as_str() != Some(method.as_str()) {
                self.snapshot.fail("Pi response did not match its command");
                return;
            }
            if v["success"] != true {
                self.snapshot.error =
                    Some(v["error"].as_str().unwrap_or("Pi request failed").into());
                if matches!(
                    method.as_str(),
                    "get_state" | "get_messages" | "switch_session" | "new_session"
                ) {
                    self.snapshot.state = State::Failed;
                } else if method == "prompt" {
                    self.snapshot.finish("rejected");
                }
                self.snapshot.revision += 1;
                return;
            }
            let data = &v["data"];
            match method.as_str() {
                "prompt" => {
                    if data["disposition"].is_string() {
                        self.settled_events = true;
                    }
                    if data["disposition"] == "handled" {
                        self.snapshot.finish("handled");
                        self.snapshot.notice =
                            Some("Pi handled the command without starting a model run".into());
                    }
                }
                "get_state" => {
                    if let Some(id) = data["sessionId"].as_str() {
                        if self.expected.as_ref().is_some_and(|e| e != id) {
                            self.snapshot.fail("Pi resumed a different session; the requested conversation was not opened");
                            return;
                        }
                        self.snapshot.thread = Some(id.into());
                    }
                    self.snapshot.model = data["model"]["id"].as_str().map(|id| {
                        format!(
                            "{}/{}",
                            data["model"]["provider"].as_str().unwrap_or(""),
                            id
                        )
                    });
                    self.snapshot.effort = data["thinkingLevel"].as_str().map(str::to_owned);
                    if let Some(name) = data["sessionName"].as_str() {
                        self.snapshot.title = name.into();
                    }
                    if self.snapshot.state == State::Starting {
                        self.snapshot.state = if self.snapshot.history_mode {
                            self.catalog.list();
                            State::History
                        } else {
                            State::Idle
                        };
                    }
                    if self.expected.take().is_some() {
                        // Do not accept a new prompt until the history response is installed.
                        self.snapshot.state = State::Starting;
                        self.request("get_messages", json!({}));
                    }
                }
                "get_available_models" => {
                    self.snapshot.models = data["models"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|m| {
                            let id = m["id"].as_str()?;
                            Some((
                                format!("{}/{}", m["provider"].as_str().unwrap_or(""), id),
                                m["name"].as_str().unwrap_or(id).into(),
                            ))
                        })
                        .collect();
                    if self.snapshot.models.is_empty() {
                        self.snapshot.notice = Some(
                            "Configure a model provider with the Pi CLI, then reconnect.".into(),
                        );
                    }
                }
                "get_commands" => {
                    self.snapshot.commands = data["commands"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|c| {
                            Some((
                                c["name"].as_str()?.into(),
                                c["description"].as_str().unwrap_or("").into(),
                            ))
                        })
                        .collect()
                }
                "get_available_thinking_levels" => {
                    self.snapshot.efforts = data["levels"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|v| v.as_str().map(str::to_owned))
                        .collect()
                }
                "new_session" | "switch_session" | "set_model" | "set_thinking_level"
                | "set_session_name" => {
                    if data["cancelled"] == true {
                        self.snapshot.notice = Some("Pi cancelled the session operation".into());
                    }
                    self.request("get_state", json!({}));
                }
                "get_messages" => {
                    self.snapshot.messages.clear();
                    for (i, m) in data["messages"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .enumerate()
                    {
                        self.project(m, &format!("history-{i}"));
                    }
                    if self.snapshot.state == State::Starting {
                        self.snapshot.state = State::Idle;
                    }
                }
                "abort" => {
                    if self.snapshot.state == State::Stopping && !self.settled_events {
                        self.finish_run(true);
                    }
                }
                "compact" => {
                    self.snapshot.notice = Some("Conversation context compacted".into());
                }
                "get_session_stats" => {
                    self.snapshot.usage = format!(
                        "{} messages · {} tokens",
                        data["totalMessages"].as_u64().unwrap_or(0),
                        data["tokens"]["total"].as_u64().unwrap_or(0)
                    )
                }
                _ => {}
            }
            self.snapshot.revision += 1;
            return;
        }
        match kind {
            "agent_start" => {
                if self.snapshot.state != State::Stopping {
                    self.snapshot.state = State::Running;
                }
                self.pending.retain(|_, (method, _)| method != "prompt");
            }
            "agent_end" => {
                if let Some(message) = v["messages"]
                    .as_array()
                    .and_then(|messages| messages.iter().rev().find(|m| m["role"] == "assistant"))
                {
                    self.observe_outcome(message);
                }
                // willRetry is present on the modern session-level event contract,
                // including successful runs with false. A low-level end isn't idle.
                self.settled_events |= v.get("willRetry").is_some();
                if !self.settled_events {
                    self.finish_run(false);
                }
            }
            "agent_settled" => {
                self.settled_events = true;
                self.finish_run(v["aborted"] == true);
            }
            "auto_retry_start" => {
                self.settled_events = true;
                self.snapshot.notice = Some(format!(
                    "Pi is retrying the model request ({}/{})",
                    v["attempt"].as_u64().unwrap_or(1),
                    v["maxAttempts"].as_u64().unwrap_or(1)
                ));
            }
            "auto_retry_end" if v["success"] == false => {
                self.turn_error = Some(bounded_text(
                    v["finalError"]
                        .as_str()
                        .unwrap_or("Pi model retries failed")
                        .into(),
                    4096,
                ));
            }
            "message_start" => {
                self.serial += 1;
                self.message_id = format!("message-{}", self.serial);
            }
            "message_update" => {
                let event = &v["assistantMessageEvent"];
                match event["type"].as_str() {
                    Some("text_delta") => self.snapshot.delta(
                        &self.message_id,
                        &self.snapshot.runtime.clone(),
                        event["delta"].as_str().unwrap_or(""),
                    ),
                    Some("thinking_delta") => self.snapshot.delta(
                        &format!("{}:thinking", self.message_id),
                        "Reasoning",
                        event["delta"].as_str().unwrap_or(""),
                    ),
                    _ => {}
                }
            }
            "message_end" => {
                let id = self.message_id.clone();
                self.project(&v["message"], &id);
                self.observe_outcome(&v["message"]);
            }
            "tool_execution_start" => self.snapshot.tool_call(
                v["toolCallId"].as_str().unwrap_or("tool"),
                v["toolName"].as_str().unwrap_or("Tool"),
                v["args"].to_string(),
                "running",
            ),
            "tool_execution_update" | "tool_execution_end" => {
                let result = if kind == "tool_execution_end" {
                    &v["result"]
                } else {
                    &v["partialResult"]
                };
                let text = result["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|p| p["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                self.snapshot.tool_result(
                    v["toolCallId"].as_str().unwrap_or("tool"),
                    v["toolName"].as_str().unwrap_or("Tool"),
                    text,
                    if kind == "tool_execution_end" {
                        if v["isError"] == true {
                            "failed"
                        } else {
                            "completed"
                        }
                    } else {
                        "running"
                    },
                );
            }
            "extension_ui_request" => {
                let method = v["method"].as_str().unwrap_or("");
                let id = v["id"].clone();
                if matches!(method, "confirm" | "select" | "input" | "editor") {
                    let kind = if method == "confirm" {
                        InteractionKind::Approval {
                            command: false,
                            prompt: format!(
                                "{}\n{}",
                                v["title"].as_str().unwrap_or("Confirm"),
                                v["message"].as_str().unwrap_or("")
                            ),
                            decisions: vec![Decision::Accept, Decision::Decline],
                            title: v["title"].as_str().unwrap_or("Confirm").into(),
                            command_line: None,
                            cwd: None,
                            reason: v["message"].as_str().map(str::to_owned),
                        }
                    } else {
                        InteractionKind::Questions(vec![Question {
                            // `input`/`editor` take free text; `select` offers options.
                            custom: method != "select",
                            id: "answer".into(),
                            text: v["title"].as_str().unwrap_or("Pi needs your input").into(),
                            options: v["options"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter_map(|o| o.as_str().map(str::to_owned))
                                .collect(),
                            ..Default::default()
                        }])
                    };
                    self.dialogs.insert(id.to_string(), method.into());
                    self.snapshot.interactions.push(Interaction {
                        id,
                        thread: self.snapshot.thread.clone().unwrap_or_default(),
                        turn: self.snapshot.turn.clone().unwrap_or_default(),
                        kind,
                    });
                } else if method == "notify" {
                    self.snapshot.notice = v["message"].as_str().map(str::to_owned);
                }
            }
            "auto_compaction_start" | "compaction_start" => {
                self.snapshot.notice = Some(kind.replace('_', " "))
            }
            "auto_compaction_end" | "compaction_end" | "auto_retry_end" => {
                self.snapshot.notice = None
            }
            _ => {}
        }
        self.snapshot.revision += 1;
    }
}
impl AgentRuntimePort for Session {
    fn snapshot(&self) -> &SessionSnapshot {
        &self.snapshot
    }
    fn poll(&mut self) {
        if let Some(result) = self.catalog.poll() {
            match result {
                Ok(entries) => self.snapshot.history = entries,
                Err(e) => self.snapshot.notice = Some(e),
            }
            self.snapshot.revision += 1;
        }
        if !self.snapshot.messages.is_empty()
            && let Some(id) = &self.snapshot.thread
        {
            self.catalog.remember(id, &self.snapshot.title);
        }
        for event in self.connection.drain(64) {
            match event {
                Event::Message(v) => self.handle(v),
                Event::Error(e) => self.snapshot.fail(e),
                Event::Exited if self.snapshot.state != State::Failed => self
                    .snapshot
                    .fail("Pi exited; resume history before retrying work"),
                Event::Exited => {}
            }
        }
        let expired = self
            .pending
            .iter()
            .filter(|(_, (_, at))| at.elapsed() > Duration::from_secs(120))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in expired {
            if let Some((method, _)) = self.pending.remove(&id) {
                self.snapshot.fail(format!(
                    "{method} timed out; delivery unknown. Nothing was replayed."
                ));
            }
        }
    }
    fn send(&mut self, text: String) {
        self.submit(Prompt::text(text))
    }
    fn submit(&mut self, prompt: Prompt) {
        if self.snapshot.state != State::Idle {
            return;
        }
        self.snapshot.state = State::Running;
        self.snapshot.error = None;
        self.snapshot.notice = None;
        self.turn_error = None;
        self.snapshot.turn = Some(uuid::Uuid::new_v4().to_string());
        self.snapshot.upsert(
            uuid::Uuid::new_v4().to_string(),
            "You",
            prompt.display(),
            "",
        );
        let images = prompt
            .references
            .iter()
            .filter_map(|r| {
                if let ReferenceContent::Image { mime, data } = &r.content {
                    Some(json!({"type":"image","mimeType":mime,"data":data}))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        self.request(
            "prompt",
            json!({"message":prompt.text_with_references(),"images":images}),
        );
    }
    fn steer(&mut self, text: String) {
        if self.snapshot.state == State::Running {
            self.request("steer", json!({"message":text}));
            self.snapshot
                .upsert(uuid::Uuid::new_v4().to_string(), "You", text, "steering");
        }
    }
    fn stop(&mut self) {
        if self.snapshot.state == State::Running {
            for i in &self.snapshot.interactions {
                let _ = self
                    .connection
                    .send(json!({"type":"extension_ui_response","id":i.id,"cancelled":true}));
            }
            self.snapshot.interactions.clear();
            self.dialogs.clear();
            self.snapshot.state = State::Stopping;
            self.request("clear_queue", json!({}));
            self.request("abort", json!({}));
        }
    }
    fn resume(&mut self, id: String) {
        if self.snapshot.busy() {
            return;
        }
        self.connection = Connection::spawn(
            self.executable.clone(),
            args(Some(&id)),
            self.root.clone(),
            self.wake.clone(),
        );
        self.pending.clear();
        self.settled_events = false;
        self.turn_error = None;
        self.snapshot.error = None;
        self.snapshot.messages.clear();
        self.snapshot.state = State::Starting;
        self.snapshot.history_mode = false;
        self.expected = Some(id);
        self.bootstrap();
    }
    fn list_history(&mut self) {
        if !self.snapshot.busy() {
            self.catalog.list();
            self.snapshot.history_mode = true;
            self.snapshot.state = State::History;
            self.snapshot.revision += 1;
        }
    }
    fn new_thread(&mut self) {
        if !self.snapshot.busy() {
            self.snapshot.messages.clear();
            self.snapshot.history_mode = false;
            self.snapshot.state = State::Starting;
            self.request("new_session", json!({}));
        }
    }
    fn resolve(&mut self, id: &Value, response: Resolution) {
        if matches!(self.snapshot.state, State::Failed | State::Stopping) {
            return;
        }
        let Some(index) = self.snapshot.interactions.iter().position(|i| {
            &i.id == id
                && Some(i.thread.as_str()) == self.snapshot.thread.as_deref()
                && Some(i.turn.as_str()) == self.snapshot.turn.as_deref()
        }) else {
            return;
        };
        let mut result = json!({"type":"extension_ui_response","id":id});
        match response {
            Resolution::Approval(decision) => {
                result["confirmed"] = json!(decision == Decision::Accept)
            }
            Resolution::Answers(answers) => {
                result["value"] = json!(
                    answers
                        .values()
                        .flatten()
                        .next()
                        .cloned()
                        .unwrap_or_default()
                )
            }
            _ => return,
        }
        match self.connection.send(result) {
            Ok(()) => {
                self.snapshot.interactions.remove(index);
                self.dialogs.remove(&id.to_string());
            }
            Err(e) => self.snapshot.fail(e),
        }
        self.snapshot.revision += 1;
    }
    fn select_model(&mut self, model: Option<String>) {
        if let Some(model) = model
            && let Some((provider, id)) = model.split_once('/')
            && !self.snapshot.busy()
        {
            self.request("set_model", json!({"provider":provider,"modelId":id}));
        }
    }
    fn select_effort(&mut self, effort: String) {
        if !self.snapshot.busy() {
            self.request("set_thinking_level", json!({"level":effort}));
        }
    }
    fn compact(&mut self) {
        if !self.snapshot.busy() {
            self.request("compact", json!({}));
        }
    }
    fn rename(&mut self, name: String) {
        if !self.snapshot.busy() && !name.trim().is_empty() {
            self.request("set_session_name", json!({"name":name}));
        }
    }
}
fn args(id: Option<&str>) -> Vec<String> {
    let mut args = vec!["--mode".into(), "rpc".into(), "--no-approve".into()];
    if let Some(id) = id {
        args.extend(["--session".into(), id.into()]);
    }
    args
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn modern_pi_waits_through_retries_and_preserves_final_model_errors() {
        let (connection, rx, _) = Connection::harness();
        let mut s = Session::connected(
            connection,
            PathBuf::new(),
            PathBuf::from("/tmp"),
            false,
            Wake::default(),
        );
        s.snapshot.thread = Some("session".into());
        s.snapshot.state = State::Idle;
        s.send("hello".into());
        let request = rx.try_recv().unwrap();
        s.handle(json!({"type":"response","id":request["id"],"command":"prompt","success":true,"data":{"disposition":"started"}}));
        let turn = s.snapshot.turn.clone();
        s.handle(json!({"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"model overloaded"}}));
        s.handle(json!({"type":"agent_end","willRetry":true}));
        s.handle(json!({"type":"auto_retry_start","attempt":1,"maxAttempts":3}));
        assert_eq!(s.snapshot.state, State::Running);
        assert!(s.snapshot.error.is_none());
        s.send("must not overlap retry".into());
        assert!(rx.try_recv().is_err());
        s.handle(json!({"type":"agent_start"}));
        assert_eq!(s.snapshot.turn, turn);
        s.handle(json!({"type":"message_start"}));
        s.handle(json!({"type":"message_end","message":{"role":"assistant","stopReason":"stop","content":[{"type":"text","text":"ok"}]}}));
        s.handle(json!({"type":"agent_end","willRetry":false}));
        assert_eq!(s.snapshot.state, State::Running);
        s.handle(json!({"type":"agent_settled","aborted":false}));
        assert_eq!(s.snapshot.state, State::Idle);
        assert!(s.snapshot.error.is_none());
        s.send("retryable user draft".into());
        s.handle(json!({"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"model unavailable"}}));
        s.handle(json!({"type":"agent_end","willRetry":false}));
        assert_eq!(s.snapshot.state, State::Running);
        s.handle(json!({"type":"agent_settled","aborted":false}));
        assert_eq!(s.snapshot.error.as_deref(), Some("model unavailable"));
        assert_eq!(s.snapshot.usage, "failed");
        s.send("explicit retry".into());
        assert!(s.snapshot.error.is_none());
        assert!(s.turn_error.is_none());
    }
    #[test]
    fn pi_history_hydration_blocks_new_prompts_until_installed() {
        let (connection, rx, _) = Connection::harness();
        let mut s = Session::connected(
            connection,
            PathBuf::new(),
            PathBuf::from("/tmp"),
            false,
            Wake::default(),
        );
        s.expected = Some("saved-session".into());
        s.request("get_state", json!({}));
        let state = rx.try_recv().unwrap();
        s.handle(json!({"type":"response","id":state["id"],"command":"get_state","success":true,"data":{"sessionId":"saved-session"}}));
        assert_eq!(s.snapshot.state, State::Starting);
        let history = rx.try_recv().unwrap();
        assert_eq!(history["type"], "get_messages");
        s.send("too early".into());
        assert!(rx.try_recv().is_err());
        s.handle(json!({"type":"response","id":history["id"],"command":"get_messages","success":true,"data":{"messages":[{"role":"assistant","content":[{"type":"text","text":"saved reply"}]}]}}));
        assert_eq!(s.snapshot.state, State::Idle);
        assert_eq!(s.snapshot.messages[0].text, "saved reply");
        s.send("continue".into());
        assert_eq!(rx.try_recv().unwrap()["type"], "prompt");
    }
    #[test]
    fn receipt_does_not_finish_work_and_duplicate_receipt_does_not_replay() {
        let (c, rx, _) = Connection::harness();
        let mut s = Session::connected(
            c,
            PathBuf::new(),
            PathBuf::from("/tmp"),
            false,
            Wake::default(),
        );
        s.snapshot.thread = Some("session".into());
        s.snapshot.state = State::Idle;
        s.send("test".into());
        let request = rx.try_recv().unwrap();
        let receipt =
            json!({"type":"response","id":request["id"],"command":"prompt","success":true});
        s.handle(receipt.clone());
        assert_eq!(s.snapshot.state, State::Running);
        s.handle(receipt);
        s.handle(json!({"type":"message_start","message":{"role":"assistant"}}));
        s.handle(json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}));
        s.handle(json!({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}));
        s.handle(json!({"type":"agent_end"}));
        assert_eq!(s.snapshot.state, State::Idle);
        assert_eq!(
            s.snapshot
                .messages
                .iter()
                .filter(|m| m.role == "Pi")
                .count(),
            1
        );
    }
}
