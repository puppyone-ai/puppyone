//! Native Claude CLI control protocol; all tool approvals remain explicit UI interactions.
use crate::{
    agent::{
        domain::{
            agent_session_model::*,
            reference_input::{Prompt, ReferenceContent},
        },
        persistence::session_catalog::Catalog,
        runtime::agent_runtime_port::AgentRuntimePort,
        transports::jsonl_rpc_connection::{Connection, Event},
    },
    wake::Wake,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};
enum History {
    List(Vec<HistoryEntry>),
    Messages(Result<Vec<Value>, String>),
}
pub struct Session {
    connection: Connection,
    executable: PathBuf,
    root: PathBuf,
    wake: Wake,
    snapshot: SessionSnapshot,
    next: u64,
    pending: HashMap<String, (String, Value, Instant)>,
    requests: HashMap<String, Value>,
    stream_id: String,
    tool_id: String,
    history_rx: Option<Receiver<History>>,
    initialized: bool,
    expected: Option<String>,
    catalog: Catalog,
}
impl Session {
    pub fn new(executable: PathBuf, root: PathBuf, history: bool, wake: Wake) -> Self {
        let id = uuid::Uuid::new_v4().to_string();
        let connection = Connection::spawn(
            executable.clone(),
            args(&id, false, false),
            root.clone(),
            wake.clone(),
        );
        let mut s = Self::connected(connection, executable, root, history, wake);
        s.snapshot.thread = Some(id);
        s.request("initialize", json!({"hooks":{}}));
        if history {
            s.load_history(None);
        }
        s
    }
    fn connected(
        connection: Connection,
        executable: PathBuf,
        root: PathBuf,
        history: bool,
        wake: Wake,
    ) -> Self {
        let mut snapshot = SessionSnapshot::new("Claude Code", history);
        snapshot.capabilities = Capabilities {
            history: true,
            models: true,
            modes: true,
            fork: true,
            steer: true,
            rename: true,
            images: true,
            text_references: true,
            ..Default::default()
        };
        snapshot.modes = vec![
            ("default".into(), "Code".into()),
            ("plan".into(), "Plan".into()),
        ];
        snapshot.mode = Some("default".into());
        Self {
            connection,
            executable,
            catalog: Catalog::new(&root, "claude", wake.clone()),
            root,
            wake,
            snapshot,
            next: 0,
            pending: HashMap::new(),
            requests: HashMap::new(),
            stream_id: String::new(),
            tool_id: String::new(),
            history_rx: None,
            initialized: false,
            expected: None,
        }
    }
    fn request(&mut self, method: &str, mut request: Value) {
        self.next += 1;
        let id = format!("puppyone-{}", self.next);
        request["subtype"] = json!(method);
        match self
            .connection
            .send(json!({"type":"control_request","request_id":id,"request":request}))
        {
            Ok(()) => {
                self.pending
                    .insert(id, (method.into(), request, Instant::now()));
            }
            Err(e) => self.snapshot.fail(e),
        }
    }
    fn ready(&mut self) {
        if self.initialized && self.history_rx.is_none() && self.snapshot.state == State::Starting {
            self.snapshot.state = if self.snapshot.history_mode {
                State::History
            } else {
                State::Idle
            };
        }
    }
    fn reconnect(&mut self, id: String, resume: bool, fork: bool) {
        self.connection = Connection::spawn(
            self.executable.clone(),
            args(&id, resume, fork),
            self.root.clone(),
            self.wake.clone(),
        );
        self.pending.clear();
        self.requests.clear();
        self.snapshot.interactions.clear();
        self.snapshot.messages.clear();
        self.snapshot.history_mode = false;
        self.snapshot.state = State::Starting;
        self.snapshot.error = None;
        self.initialized = false;
        self.expected = if resume && !fork {
            Some(id.clone())
        } else {
            None
        };
        self.snapshot.thread = if fork { None } else { Some(id.clone()) };
        self.request("initialize", json!({"hooks":{}}));
        if resume {
            self.load_history(Some(id));
        }
    }
    fn load_history(&mut self, id: Option<String>) {
        let (tx, rx) = mpsc::sync_channel(1);
        self.history_rx = Some(rx);
        let root = self.root.clone();
        let wake = self.wake.clone();
        std::thread::spawn(move || {
            let result = match id {
                Some(id) => History::Messages(super::history::load(&root, &id)),
                None => History::List(super::history::list(&root)),
            };
            let _ = tx.send(result);
            wake.notify();
        });
    }
    fn project(&mut self, v: &Value) {
        let message = &v["message"];
        let id = message["id"]
            .as_str()
            .or(v["uuid"].as_str())
            .unwrap_or(&self.stream_id)
            .to_owned();
        let role = if v["type"] == "user" {
            "You"
        } else {
            "Claude Code"
        };
        let mut text = String::new();
        for block in message["content"].as_array().into_iter().flatten() {
            match block["type"].as_str() {
                Some("text") => text.push_str(block["text"].as_str().unwrap_or("")),
                Some("thinking") => self.snapshot.upsert(
                    format!("{id}:thinking"),
                    "Reasoning",
                    block["thinking"].as_str().unwrap_or(""),
                    "",
                ),
                Some("tool_use") => self.snapshot.tool_call(
                    block["id"].as_str().unwrap_or("tool"),
                    block["name"].as_str().unwrap_or("Tool"),
                    block["input"].to_string(),
                    "running",
                ),
                Some("tool_result") => {
                    let output =
                        block["content"]
                            .as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| {
                                block["content"]
                                    .as_array()
                                    .into_iter()
                                    .flatten()
                                    .filter_map(|c| c["text"].as_str())
                                    .collect::<Vec<_>>()
                                    .join("\n")
                            });
                    self.snapshot.tool_result(
                        block["tool_use_id"].as_str().unwrap_or("tool"),
                        "Tool",
                        output,
                        if block["is_error"] == true {
                            "failed"
                        } else {
                            "completed"
                        },
                    );
                }
                _ => {}
            }
        }
        if let Some(content) = message["content"].as_str() {
            text = content.into();
        }
        if !text.is_empty() {
            self.snapshot.upsert(id, role, text, "");
        }
    }
    fn handle(&mut self, v: Value) {
        match v["type"].as_str().unwrap_or("") {
            "control_response" => {
                let response = &v["response"];
                let id = response["request_id"].as_str().unwrap_or("");
                let Some((method, request, _)) = self.pending.remove(id) else {
                    return;
                };
                if response["subtype"] != "success" {
                    if method == "interrupt" && self.snapshot.state == State::Idle {
                        return;
                    }
                    self.snapshot.error = Some(
                        response["error"]
                            .as_str()
                            .unwrap_or("Claude operation failed")
                            .into(),
                    );
                    if method == "initialize" {
                        self.snapshot.state = State::Failed;
                    }
                    self.snapshot.revision += 1;
                    return;
                }
                let data = &response["response"];
                match method.as_str() {
                    "initialize" => {
                        self.initialized = true;
                        self.snapshot.models = data["models"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(|m| {
                                Some((
                                    m["value"].as_str()?.into(),
                                    m["displayName"]
                                        .as_str()
                                        .or(m["description"].as_str())
                                        .unwrap_or("Model")
                                        .into(),
                                ))
                            })
                            .collect();
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
                            .collect();
                        self.snapshot.account = data["account"]["email"]
                            .as_str()
                            .or(data["account"]["subscriptionType"].as_str())
                            .unwrap_or("CLI account")
                            .into();
                        self.ready();
                    }
                    "set_model" => {
                        self.snapshot.model = request["model"].as_str().map(str::to_owned)
                    }
                    "set_permission_mode" => {
                        self.snapshot.mode = request["mode"].as_str().map(str::to_owned)
                    }
                    "rename_session" => {
                        self.snapshot.title =
                            request["title"].as_str().unwrap_or("Claude Code").into()
                    }
                    _ => {}
                }
            }
            "system" => {
                if v["subtype"] == "init" {
                    if let Some(id) = v["session_id"].as_str() {
                        if self.expected.as_ref().is_some_and(|e| e != id) {
                            self.snapshot
                                .fail("Claude resumed a different native session");
                            return;
                        }
                        self.snapshot.thread = Some(id.into());
                        self.expected = None;
                    }
                    self.snapshot.model = v["model"].as_str().map(str::to_owned);
                } else if v["subtype"] == "compact_boundary" {
                    self.snapshot.notice = Some("Conversation context compacted".into());
                } else if let Some(message) = v["message"].as_str() {
                    self.snapshot.upsert(
                        v["uuid"].as_str().unwrap_or("system"),
                        "System",
                        message,
                        "",
                    );
                }
            }
            "stream_event" => {
                let e = &v["event"];
                match e["type"].as_str() {
                    Some("message_start") => {
                        self.stream_id = e["message"]["id"].as_str().unwrap_or("assistant").into()
                    }
                    Some("content_block_start") => {
                        let block = &e["content_block"];
                        if block["type"] == "tool_use" {
                            self.tool_id = block["id"].as_str().unwrap_or("tool").into();
                            self.snapshot.tool_call(
                                self.tool_id.clone(),
                                block["name"].as_str().unwrap_or("Tool"),
                                "",
                                "running",
                            );
                        }
                    }
                    Some("content_block_delta") => {
                        let delta = &e["delta"];
                        match delta["type"].as_str() {
                            Some("text_delta") => self.snapshot.delta(
                                &self.stream_id,
                                "Claude Code",
                                delta["text"].as_str().unwrap_or(""),
                            ),
                            Some("thinking_delta") => self.snapshot.delta(
                                &format!("{}:thinking", self.stream_id),
                                "Reasoning",
                                delta["thinking"].as_str().unwrap_or(""),
                            ),
                            Some("input_json_delta") => self.snapshot.tool_input_delta(
                                &self.tool_id,
                                "Tool",
                                delta["partial_json"].as_str().unwrap_or(""),
                            ),
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
            "assistant" | "user" => self.project(&v),
            "result" => {
                let stopped = self.snapshot.state == State::Stopping;
                self.snapshot.finish(if stopped {
                    "interrupted"
                } else if v["is_error"] == true {
                    "failed"
                } else {
                    "completed"
                });
                self.snapshot.usage = format!(
                    "{} input · {} output tokens · ${:.4}",
                    v["usage"]["input_tokens"].as_u64().unwrap_or(0),
                    v["usage"]["output_tokens"].as_u64().unwrap_or(0),
                    v["total_cost_usd"].as_f64().unwrap_or(0.)
                );
                if v["is_error"] == true {
                    let details = v["errors"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join("\n");
                    self.snapshot.error = Some(if details.is_empty() {
                        v["result"]
                            .as_str()
                            .filter(|s| !s.is_empty())
                            .or(v["subtype"].as_str())
                            .unwrap_or("Claude turn failed")
                            .to_owned()
                    } else {
                        details
                    });
                }
            }
            "control_request" => {
                let id = v["request_id"].clone();
                let request = &v["request"];
                if request["subtype"] == "elicitation" {
                    let fields = if request["mode"] == "url" {
                        Ok(vec![])
                    } else {
                        crate::agent::domain::interaction_form::fields(&request["requested_schema"])
                    };
                    match fields {
                        Ok(fields) => {
                            self.requests.insert(id.to_string(), request.clone());
                            self.snapshot.interactions.push(Interaction {
                                id,
                                thread: self.snapshot.thread.clone().unwrap_or_default(),
                                turn: self.snapshot.turn.clone().unwrap_or_default(),
                                kind: InteractionKind::Form {
                                    prompt: request["message"]
                                        .as_str()
                                        .unwrap_or("MCP needs input")
                                        .into(),
                                    fields,
                                    url: request["url"].as_str().map(str::to_owned),
                                },
                            });
                        }
                        Err(e) => {
                            let _=self.connection.send(json!({"type":"control_response","response":{"subtype":"success","request_id":id,"response":{"action":"cancel"}}}));
                            self.snapshot.error = Some(e);
                        }
                    }
                    self.snapshot.revision += 1;
                    return;
                }
                if request["subtype"] != "can_use_tool" {
                    let _=self.connection.send(json!({"type":"control_response","response":{"subtype":"error","request_id":id,"error":"Unsupported native interaction"}}));
                    return;
                }
                let input = &request["input"];
                let kind = if request["tool_name"] == "AskUserQuestion" {
                    InteractionKind::Questions(
                        input["questions"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .map(|q| Question {
                                id: q["question"].as_str().unwrap_or("answer").into(),
                                text: q["question"].as_str().unwrap_or("").into(),
                                options: q["options"]
                                    .as_array()
                                    .into_iter()
                                    .flatten()
                                    .filter_map(|o| o["label"].as_str().map(str::to_owned))
                                    .collect(),
                            })
                            .collect(),
                    )
                } else {
                    InteractionKind::Approval {
                        command: request["tool_name"] == "Bash",
                        prompt: format!(
                            "{}\n{}",
                            request["tool_name"].as_str().unwrap_or("Tool"),
                            input
                        ),
                        decisions: vec![Decision::Accept, Decision::Decline],
                    }
                };
                self.requests.insert(id.to_string(), request.clone());
                self.snapshot.interactions.push(Interaction {
                    id,
                    thread: self.snapshot.thread.clone().unwrap_or_default(),
                    turn: self.snapshot.turn.clone().unwrap_or_default(),
                    kind,
                });
            }
            "control_cancel_request" => {
                self.requests.remove(&v["request_id"].to_string());
                self.snapshot
                    .interactions
                    .retain(|i| i.id != v["request_id"]);
            }
            "tool_progress" => {
                self.snapshot.notice = Some(format!(
                    "{} · {}s",
                    v["tool_name"].as_str().unwrap_or("Tool"),
                    v["elapsed_time_seconds"].as_f64().unwrap_or(0.)
                ))
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
        for event in self.connection.drain(64) {
            match event {
                Event::Message(v) => self.handle(v),
                Event::Error(e) => self.snapshot.fail(e),
                Event::Exited if self.snapshot.state != State::Failed => self
                    .snapshot
                    .fail("Claude connection exited; reopen history before retrying work"),
                Event::Exited => {}
            }
        }
        if let Some(result) = self.history_rx.as_ref().and_then(|rx| rx.try_recv().ok()) {
            self.history_rx = None;
            match result {
                History::List(entries) => {
                    self.snapshot.history = entries;
                    for e in &self.snapshot.history {
                        self.catalog.remember(&e.id, &e.title);
                    }
                }
                History::Messages(Ok(messages)) => {
                    for m in messages {
                        self.project(&m);
                    }
                }
                History::Messages(Err(e)) => self.snapshot.notice = Some(e),
            }
            self.ready();
            self.snapshot.revision += 1;
        }
        if let Some(Ok(entries)) = self.catalog.poll() {
            for entry in entries {
                if !self.snapshot.history.iter().any(|e| e.id == entry.id) {
                    self.snapshot.history.push(entry);
                }
            }
            self.snapshot.revision += 1;
        }
        if !self.snapshot.messages.is_empty()
            && let Some(id) = &self.snapshot.thread
        {
            self.catalog.remember(id, &self.snapshot.title);
        }
        let expired = self
            .pending
            .iter()
            .filter(|(_, (_, _, at))| at.elapsed() > Duration::from_secs(60))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in expired {
            if let Some((method, _, _)) = self.pending.remove(&id) {
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
        let id = uuid::Uuid::new_v4().to_string();
        let mut content = vec![json!({"type":"text","text":prompt.text_with_references()})];
        for r in &prompt.references {
            if let ReferenceContent::Image { mime, data } = &r.content {
                content.push(json!({"type":"image","source":{"type":"base64","media_type":mime,"data":data}}));
            }
        }
        let message = json!({"type":"user","uuid":id,"session_id":self.snapshot.thread.clone().unwrap_or_default(),"message":{"role":"user","content":content},"parent_tool_use_id":null});
        match self.connection.send(message) {
            Ok(()) => {
                self.snapshot.state = State::Running;
                self.snapshot.turn = Some(id.clone());
                self.snapshot.upsert(id, "You", prompt.display(), "");
            }
            Err(e) => self.snapshot.fail(e),
        }
    }
    fn steer(&mut self, text: String) {
        if self.snapshot.state == State::Running {
            let id = uuid::Uuid::new_v4().to_string();
            let message = json!({"type":"user","uuid":id,"session_id":self.snapshot.thread,"message":{"role":"user","content":text},"parent_tool_use_id":null});
            match self.connection.send(message) {
                Ok(()) => self.snapshot.upsert(id, "You", text, "queued"),
                Err(e) => self.snapshot.fail(e),
            }
        }
    }
    fn stop(&mut self) {
        if self.snapshot.state == State::Running {
            self.snapshot.state = State::Stopping;
            self.request("interrupt", json!({}));
        }
    }
    fn resume(&mut self, id: String) {
        if !self.snapshot.busy() {
            self.reconnect(id, true, false)
        }
    }
    fn list_history(&mut self) {
        if !self.snapshot.busy() {
            self.snapshot.history_mode = true;
            self.snapshot.state = State::History;
            self.catalog.list();
            self.load_history(None);
        }
    }
    fn new_thread(&mut self) {
        if !self.snapshot.busy() {
            self.reconnect(uuid::Uuid::new_v4().to_string(), false, false)
        }
    }
    fn resolve(&mut self, id: &Value, response: Resolution) {
        if matches!(self.snapshot.state, State::Failed | State::Stopping) {
            return;
        }
        let Some(index) = self.snapshot.interactions.iter().position(|i| {
            &i.id == id
                && Some(i.thread.as_str()) == self.snapshot.thread.as_deref()
                && (i.turn.is_empty() || Some(i.turn.as_str()) == self.snapshot.turn.as_deref())
        }) else {
            return;
        };
        let Some(request) = self.requests.get(&id.to_string()) else {
            return;
        };
        let result = match (&self.snapshot.interactions[index].kind, response) {
            (InteractionKind::Form { .. }, Resolution::Form { decision, values }) => {
                let content = if decision == Decision::Accept && request["mode"] != "url" {
                    match crate::agent::domain::interaction_form::validate(
                        &request["requested_schema"],
                        &values,
                    ) {
                        Ok(v) => v,
                        Err(e) => {
                            self.snapshot.error = Some(e);
                            self.snapshot.revision += 1;
                            return;
                        }
                    }
                } else {
                    Value::Null
                };
                json!({"action":match decision{Decision::Accept=>"accept",Decision::Decline=>"decline",Decision::Cancel=>"cancel"},"content":content})
            }
            (InteractionKind::Approval { .. }, Resolution::Approval(Decision::Accept)) => {
                json!({"behavior":"allow","updatedInput":request["input"]})
            }
            (InteractionKind::Approval { .. }, Resolution::Approval(_)) => {
                json!({"behavior":"deny","message":"User declined this operation"})
            }
            (InteractionKind::Questions(_), Resolution::Answers(answers)) => {
                let mut input = request["input"].clone();
                input["answers"] = json!(
                    answers
                        .into_iter()
                        .map(|(key, values)| (key, values.join(", ")))
                        .collect::<HashMap<_, _>>()
                );
                json!({"behavior":"allow","updatedInput":input})
            }
            _ => return,
        };
        match self.connection.send(json!({"type":"control_response","response":{"subtype":"success","request_id":id,"response":result}})){Ok(())=>{self.snapshot.interactions.remove(index);self.requests.remove(&id.to_string());},Err(e)=>self.snapshot.fail(e)}
        self.snapshot.revision += 1;
    }
    fn select_model(&mut self, model: Option<String>) {
        if !self.snapshot.busy() {
            self.request("set_model", json!({"model":model}));
        }
    }
    fn select_mode(&mut self, mode: String) {
        if !self.snapshot.busy() && matches!(mode.as_str(), "default" | "plan") {
            self.request("set_permission_mode", json!({"mode":mode}));
        }
    }
    fn rename(&mut self, name: String) {
        if !self.snapshot.busy() && !name.trim().is_empty() {
            self.request("rename_session", json!({"title":name}));
        }
    }
    fn fork(&mut self) {
        if !self.snapshot.busy()
            && let Some(id) = self.snapshot.thread.clone()
        {
            self.reconnect(id, true, true)
        }
    }
}
fn args(id: &str, resume: bool, fork: bool) -> Vec<String> {
    let mut args = [
        "--print",
        "--verbose",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--permission-prompt-tool",
        "stdio",
        "--permission-mode",
        "default",
    ]
    .map(str::to_owned)
    .to_vec();
    args.extend([
        if resume { "--resume" } else { "--session-id" }.into(),
        id.into(),
    ]);
    if fork {
        args.push("--fork-session".into());
    }
    args
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn permissions_keep_original_tool_input_and_resolve_once() {
        let (c, rx, _) = Connection::harness();
        let mut s = Session::connected(
            c,
            PathBuf::new(),
            PathBuf::from("/tmp"),
            false,
            Wake::default(),
        );
        s.snapshot.thread = Some("session".into());
        s.snapshot.turn = Some("turn".into());
        s.snapshot.state = State::Running;
        s.handle(json!({"type":"control_request","request_id":"permission","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"echo test"}}}));
        s.resolve(&json!("permission"), Resolution::Approval(Decision::Accept));
        let result = rx.try_recv().unwrap();
        assert_eq!(
            result["response"]["response"]["updatedInput"]["command"],
            "echo test"
        );
        s.resolve(&json!("permission"), Resolution::Approval(Decision::Accept));
        assert!(rx.try_recv().is_err());
    }
}
