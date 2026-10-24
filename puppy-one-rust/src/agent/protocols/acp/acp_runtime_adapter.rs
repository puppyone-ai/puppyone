//! ACP v1 host shared by Cursor, Hermes, OpenCode and WorkBuddy.
//! Optional commands are enabled only from the server's negotiated capabilities.
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
struct Pending {
    method: String,
    params: Value,
    at: Instant,
}
pub struct Session {
    connection: Connection,
    root: PathBuf,
    snapshot: SessionSnapshot,
    next: u64,
    pending: HashMap<u64, Pending>,
    requests: HashMap<String, Value>,
    load: bool,
    turn_counter: u64,
    chunk: String,
    chunk_serial: u64,
    chunk_role: String,
    config: HashMap<String, String>,
}
impl Session {
    pub fn new(
        executable: PathBuf,
        args: Vec<String>,
        root: PathBuf,
        label: &str,
        history: bool,
        wake: Wake,
    ) -> Self {
        Self::connected(
            Connection::spawn(executable, args, root.clone(), wake),
            root,
            label,
            history,
        )
    }
    pub(crate) fn connected(
        connection: Connection,
        root: PathBuf,
        label: &str,
        history: bool,
    ) -> Self {
        let mut s = Self {
            connection,
            root,
            snapshot: SessionSnapshot::new(label, history),
            next: 0,
            pending: HashMap::new(),
            requests: HashMap::new(),
            load: false,
            turn_counter: 0,
            chunk: String::new(),
            chunk_serial: 0,
            chunk_role: String::new(),
            config: HashMap::new(),
        };
        s.request("initialize",json!({"protocolVersion":1,"clientInfo":{"name":"puppyone-gpui","version":env!("CARGO_PKG_VERSION")},"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}}));
        s
    }
    fn request(&mut self, method: &str, params: Value) {
        if self.pending.len() >= 64 {
            self.snapshot.fail("Too many pending Agent operations");
            return;
        }
        self.next += 1;
        let id = self.next;
        match self
            .connection
            .send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
        {
            Ok(()) => {
                self.pending.insert(
                    id,
                    Pending {
                        method: method.into(),
                        params,
                        at: Instant::now(),
                    },
                );
            }
            Err(e) => self.snapshot.fail(e),
        }
    }
    fn new_session(&mut self) {
        self.snapshot.state = State::Starting;
        self.snapshot.history_mode = false;
        self.snapshot.messages.clear();
        self.snapshot.thread = None;
        self.request("session/new", json!({"cwd":self.root,"mcpServers":[]}));
    }
    fn config(&mut self, result: &Value) {
        if let Some(m) = result["models"]["availableModels"].as_array() {
            self.snapshot.models = m
                .iter()
                .filter_map(|m| {
                    Some((
                        m["modelId"].as_str()?.into(),
                        m["name"].as_str().unwrap_or("Model").into(),
                    ))
                })
                .collect();
            self.snapshot.model = result["models"]["currentModelId"]
                .as_str()
                .map(str::to_owned);
            self.snapshot.capabilities.models = !self.snapshot.models.is_empty();
        }
        if let Some(m) = result["modes"]["availableModes"].as_array() {
            self.snapshot.modes = m
                .iter()
                .filter_map(|m| {
                    Some((
                        m["id"].as_str()?.into(),
                        m["name"].as_str().unwrap_or("Mode").into(),
                    ))
                })
                .collect();
            self.snapshot.mode = result["modes"]["currentModeId"].as_str().map(str::to_owned);
            self.snapshot.capabilities.modes = !self.snapshot.modes.is_empty();
        }
        if let Some(options) = result["configOptions"].as_array() {
            for option in options {
                let category = option["category"].as_str().unwrap_or("");
                let id = option["id"]
                    .as_str()
                    .or(option["configId"].as_str())
                    .unwrap_or("");
                let mut entries = Vec::new();
                for entry in option["options"].as_array().into_iter().flatten() {
                    if let Some(group) = entry["options"].as_array() {
                        for e in group {
                            if let Some(value) = e["value"].as_str() {
                                entries.push((
                                    value.into(),
                                    e["name"].as_str().unwrap_or(value).into(),
                                ));
                            }
                        }
                    } else if let Some(value) = entry["value"].as_str() {
                        entries
                            .push((value.into(), entry["name"].as_str().unwrap_or(value).into()));
                    }
                }
                self.config.insert(category.into(), id.into());
                let selected = option["currentValue"].as_str().map(str::to_owned);
                match category {
                    "model" => {
                        self.snapshot.models = entries;
                        self.snapshot.model = selected;
                        self.snapshot.capabilities.models = true;
                    }
                    "mode" => {
                        self.snapshot.modes = entries;
                        self.snapshot.mode = selected;
                        self.snapshot.capabilities.modes = true;
                    }
                    "thought_level" => {
                        self.snapshot.efforts = entries.into_iter().map(|e| e.0).collect();
                        self.snapshot.effort = selected;
                    }
                    _ => {}
                }
            }
        }
    }
    fn update(&mut self, params: &Value) {
        if params["sessionId"].as_str() != self.snapshot.thread.as_deref() {
            return;
        }
        let u = &params["update"];
        match u["sessionUpdate"].as_str().unwrap_or("") {
            "agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk" => {
                let role = match u["sessionUpdate"].as_str() {
                    Some("agent_thought_chunk") => "Reasoning".to_string(),
                    Some("user_message_chunk") => "You".into(),
                    _ => self.snapshot.runtime.clone(),
                };
                if self.chunk_role != role || self.chunk.is_empty() {
                    self.chunk_serial += 1;
                    self.chunk = format!("chunk-{}", self.chunk_serial);
                    self.chunk_role = role.clone();
                }
                self.snapshot.delta(
                    &self.chunk,
                    &role,
                    u["content"]["text"].as_str().unwrap_or(""),
                );
            }
            "tool_call" | "tool_call_update" => {
                self.chunk.clear();
                let id = u["toolCallId"].as_str().unwrap_or("tool");
                let previous = self.snapshot.messages.iter().find(|m| m.id == id);
                let text = if u.get("content").is_some() {
                    u["content"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|c| match c["type"].as_str() {
                            Some("diff") => format!(
                                "{}\n{}",
                                c["path"].as_str().unwrap_or(""),
                                c["newText"].as_str().unwrap_or("")
                            ),
                            _ => c["content"]["text"].as_str().unwrap_or("").into(),
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                } else {
                    previous.map(|m| m.text.clone()).unwrap_or_default()
                };
                let title = u["title"]
                    .as_str()
                    .map(str::to_owned)
                    .or_else(|| previous.map(|m| m.role.clone()))
                    .unwrap_or("Tool".into());
                let status = u["status"]
                    .as_str()
                    .map(str::to_owned)
                    .or_else(|| previous.map(|m| m.status.clone()))
                    .unwrap_or_default();
                // ACP `kind` (read/edit/search/execute/fetch/think…) names the
                // tool for presentation; `rawInput` is the request.
                let name = match u["kind"].as_str() {
                    Some("execute") => "bash".to_owned(),
                    Some("read") => "read".to_owned(),
                    Some("edit") | Some("delete") | Some("move") => "edit".to_owned(),
                    Some("search") => "grep".to_owned(),
                    Some("fetch") => "fetch".to_owned(),
                    _ => title.clone(),
                };
                let input = u.get("rawInput").filter(|v| !v.is_null()).map(|v| {
                    let mut input = v.clone();
                    if let Some(object) = input.as_object_mut()
                        && !object.contains_key("description")
                    {
                        object.insert("description".into(), Value::String(title.clone()));
                    }
                    input.to_string()
                });
                if let Some(input) = input {
                    self.snapshot.tool_call(id, &name, input, status.clone());
                }
                self.snapshot.tool_result(id, name, text, status);
            }
            "plan" => {
                let text = u["entries"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|p| {
                        format!(
                            "- [{}] {}",
                            if p["status"] == "completed" { "x" } else { " " },
                            p["content"].as_str().unwrap_or("")
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                self.snapshot.upsert("plan", "Plan", text, "");
            }
            "current_mode_update" => {
                self.snapshot.mode = u["currentModeId"].as_str().map(str::to_owned)
            }
            "config_option_update" => self.config(u),
            "available_commands_update" => {
                self.snapshot.commands = u["availableCommands"]
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
            "session_info_update" => {
                if let Some(name) = u["title"].as_str() {
                    self.snapshot.title = name.into();
                }
            }
            "usage_update" => {
                self.snapshot.usage = format!(
                    "{} / {} context tokens",
                    u["used"].as_u64().unwrap_or(0),
                    u["size"].as_u64().unwrap_or(0)
                )
            }
            _ => {}
        }
        self.snapshot.revision += 1;
    }
    fn handle(&mut self, v: Value) {
        if let Some(method) = v["method"].as_str() {
            let p = &v["params"];
            if v.get("id").is_some() {
                let id = v["id"].clone();
                if p["sessionId"].as_str() != self.snapshot.thread.as_deref()
                    || self.snapshot.turn.is_none()
                    || self.snapshot.state != State::Running
                {
                    let _=self.connection.send(json!({"jsonrpc":"2.0","id":id,"error":{"code":-32600,"message":"Session ownership mismatch"}}));
                    return;
                }
                let kind = if matches!(method, "session/request_permission" | "requestPermission") {
                    let options = p["options"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|o| {
                            Some((
                                o["optionId"].as_str()?.into(),
                                o["name"].as_str().unwrap_or("Decision").into(),
                            ))
                        })
                        .collect();
                    InteractionKind::Permission {
                        prompt: p["toolCall"]["title"]
                            .as_str()
                            .or(p["title"].as_str())
                            .unwrap_or("Allow this Agent operation?")
                            .into(),
                        options,
                    }
                } else if method == "cursor/ask_question" {
                    InteractionKind::Questions(
                        p["questions"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .map(|q| Question {
                                id: q["id"].as_str().unwrap_or("answer").into(),
                                text: q["prompt"]
                                    .as_str()
                                    .or(q["question"].as_str())
                                    .unwrap_or("")
                                    .into(),
                                options: q["options"]
                                    .as_array()
                                    .into_iter()
                                    .flatten()
                                    .filter_map(|o| {
                                        o["label"].as_str().or(o.as_str()).map(str::to_owned)
                                    })
                                    .collect(),
                            })
                            .collect(),
                    )
                } else {
                    let _=self.connection.send(json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Client capability is not supported"}}));
                    return;
                };
                self.requests.insert(id.to_string(), p.clone());
                self.snapshot.interactions.push(Interaction {
                    id,
                    thread: self.snapshot.thread.clone().unwrap_or_default(),
                    turn: self.snapshot.turn.clone().unwrap_or_default(),
                    kind,
                });
                self.snapshot.revision += 1;
            } else if matches!(method, "session/update" | "sessionUpdate") {
                self.update(p);
            }
            return;
        }
        let Some(id) = v["id"].as_u64() else {
            return;
        };
        let Some(request) = self.pending.remove(&id) else {
            if id > self.next {
                self.snapshot
                    .fail("ACP returned an unknown request identity");
            }
            return;
        };
        if let Some(error) = v.get("error") {
            self.snapshot.error = Some(
                error["message"]
                    .as_str()
                    .unwrap_or("Agent operation failed")
                    .into(),
            );
            if matches!(
                request.method.as_str(),
                "initialize" | "session/new" | "session/load" | "session/fork"
            ) {
                self.snapshot.state = State::Failed;
            } else if request.method == "session/prompt" {
                self.snapshot.finish("failed");
            }
            self.snapshot.revision += 1;
            return;
        }
        let result = &v["result"];
        match request.method.as_str() {
            "initialize" => {
                if result["protocolVersion"] != 1 {
                    self.snapshot.fail("Agent did not negotiate ACP v1");
                    return;
                }
                let caps = &result["agentCapabilities"];
                self.load = caps["loadSession"] == true;
                self.snapshot.capabilities = Capabilities {
                    history: self.load && caps["sessionCapabilities"].get("list").is_some(),
                    images: caps["promptCapabilities"]["image"] == true,
                    text_references: true,
                    fork: caps["sessionCapabilities"].get("fork").is_some(),
                    ..Default::default()
                };
                self.snapshot.account =
                    result["agentInfo"]["version"].as_str().unwrap_or("").into();
                if self.snapshot.history_mode && self.snapshot.capabilities.history {
                    self.snapshot.state = State::History;
                    self.list_history();
                } else {
                    self.new_session();
                }
            }
            "session/new" | "session/load" | "session/fork" => {
                if let Some(id) = result["sessionId"]
                    .as_str()
                    .or(request.params["sessionId"].as_str())
                {
                    self.snapshot.thread = Some(id.into());
                    self.snapshot.state = State::Idle;
                    self.snapshot.history_mode = false;
                    self.config(result);
                } else {
                    self.snapshot.fail("Agent returned no session identity");
                }
            }
            "session/prompt" => self
                .snapshot
                .finish(result["stopReason"].as_str().unwrap_or("completed")),
            "session/list" => {
                for e in result["sessions"].as_array().into_iter().flatten() {
                    if e["cwd"]
                        .as_str()
                        .is_some_and(|cwd| std::path::Path::new(cwd) != self.root)
                    {
                        continue;
                    }
                    if let Some(id) = e["sessionId"].as_str()
                        && !self.snapshot.history.iter().any(|h| h.id == id)
                    {
                        self.snapshot.history.push(HistoryEntry {
                            id: id.into(),
                            title: e["title"]
                                .as_str()
                                .unwrap_or("Untitled conversation")
                                .into(),
                        });
                    }
                }
                self.snapshot.cursor = result["nextCursor"].as_str().map(str::to_owned);
            }
            "session/set_config_option" => self.config(result),
            "session/set_model" => {
                self.snapshot.model = request.params["modelId"].as_str().map(str::to_owned)
            }
            "session/set_mode" => {
                self.snapshot.mode = request.params["modeId"].as_str().map(str::to_owned)
            }
            _ => {}
        }
        self.snapshot.revision += 1;
    }
    fn select(&mut self, category: &str, value: String, legacy: &str, key: &str) {
        if self.snapshot.busy() {
            return;
        }
        if let Some(id) = self.config.get(category) {
            self.request(
                "session/set_config_option",
                json!({"sessionId":self.snapshot.thread,"configId":id,"value":value}),
            );
        } else {
            let mut params = json!({"sessionId":self.snapshot.thread});
            params[key] = json!(value);
            self.request(legacy, params);
        }
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
                    .fail("Agent connection exited; reopen native history before retrying work"),
                Event::Exited => {}
            }
        }
        let expired = self
            .pending
            .iter()
            .filter(|(_, p)| {
                p.method != "session/prompt" && p.at.elapsed() > Duration::from_secs(60)
            })
            .map(|(id, _)| *id)
            .collect::<Vec<_>>();
        for id in expired {
            if let Some(p) = self.pending.remove(&id) {
                self.snapshot.fail(format!(
                    "{} timed out; its delivery is unknown. No operation was replayed.",
                    p.method
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
        self.chunk.clear();
        self.turn_counter += 1;
        self.snapshot.turn = Some(format!("turn-{}", self.turn_counter));
        self.snapshot.state = State::Running;
        self.snapshot.error = None;
        self.snapshot.upsert(
            uuid::Uuid::new_v4().to_string(),
            "You",
            prompt.display(),
            "",
        );
        let mut blocks = vec![json!({"type":"text","text":prompt.text_with_references()})];
        for r in &prompt.references {
            if let ReferenceContent::Image { mime, data } = &r.content {
                blocks.push(json!({"type":"image","mimeType":mime,"data":data}));
            }
        }
        self.request(
            "session/prompt",
            json!({"sessionId":self.snapshot.thread,"prompt":blocks}),
        );
    }
    fn stop(&mut self) {
        if self.snapshot.state != State::Running {
            return;
        }
        let pending = self
            .snapshot
            .interactions
            .iter()
            .map(|i| i.id.clone())
            .collect::<Vec<_>>();
        for id in pending {
            let _ = self.connection.send(
                json!({"jsonrpc":"2.0","id":id,"result":{"outcome":{"outcome":"cancelled"}}}),
            );
        }
        self.snapshot.interactions.clear();
        self.requests.clear();
        let _=self.connection.send(json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":self.snapshot.thread}}));
        self.snapshot.state = State::Stopping;
        self.snapshot.revision += 1;
    }
    fn resume(&mut self, id: String) {
        if self.snapshot.busy() || !self.load {
            return;
        }
        self.snapshot.messages.clear();
        self.snapshot.thread = Some(id.clone());
        self.snapshot.state = State::Starting;
        self.request(
            "session/load",
            json!({"sessionId":id,"cwd":self.root,"mcpServers":[]}),
        );
    }
    fn list_history(&mut self) {
        if self.snapshot.busy() || !self.snapshot.capabilities.history {
            return;
        }
        if !self.snapshot.history_mode {
            self.snapshot.history.clear();
            self.snapshot.cursor = None;
        }
        self.snapshot.history_mode = true;
        self.snapshot.state = State::History;
        self.request(
            "session/list",
            json!({"cwd":self.root,"cursor":self.snapshot.cursor}),
        );
    }
    fn new_thread(&mut self) {
        if !self.snapshot.busy() {
            self.new_session()
        }
    }
    fn resolve(&mut self, id: &Value, response: Resolution) {
        if matches!(self.snapshot.state, State::Failed | State::Stopping) {
            return;
        }
        let Some(i) = self.snapshot.interactions.iter().position(|i| {
            &i.id == id
                && Some(i.thread.as_str()) == self.snapshot.thread.as_deref()
                && Some(i.turn.as_str()) == self.snapshot.turn.as_deref()
        }) else {
            return;
        };
        let result = match (&self.snapshot.interactions[i].kind, response) {
            (InteractionKind::Permission { options, .. }, Resolution::Choice(option))
                if options.iter().any(|o| o.0 == option) =>
            {
                json!({"outcome":{"outcome":"selected","optionId":option}})
            }
            (InteractionKind::Questions(_), Resolution::Answers(answers)) => {
                json!({"answers":answers})
            }
            _ => return,
        };
        match self
            .connection
            .send(json!({"jsonrpc":"2.0","id":id,"result":result}))
        {
            Ok(()) => {
                self.snapshot.interactions.remove(i);
                self.requests.remove(&id.to_string());
            }
            Err(e) => self.snapshot.fail(e),
        }
        self.snapshot.revision += 1;
    }
    fn select_model(&mut self, model: Option<String>) {
        if let Some(model) = model {
            self.select("model", model, "session/set_model", "modelId")
        }
    }
    fn select_mode(&mut self, mode: String) {
        self.select("mode", mode, "session/set_mode", "modeId")
    }
    fn select_effort(&mut self, effort: String) {
        if self.config.contains_key("thought_level") {
            self.select(
                "thought_level",
                effort,
                "session/set_config_option",
                "value",
            )
        }
    }
    fn fork(&mut self) {
        if !self.snapshot.busy() && self.snapshot.capabilities.fork {
            self.snapshot.state = State::Starting;
            self.request(
                "session/fork",
                json!({"sessionId":self.snapshot.thread,"cwd":self.root}),
            );
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capability_negotiation_stream_and_permission_keep_native_identity() {
        let (c, rx, _) = Connection::harness();
        let mut s = Session::connected(c, PathBuf::from("/tmp"), "Test ACP", false);
        let init = rx.try_recv().unwrap();
        s.handle(json!({"id":init["id"],"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"list":{}}}}}));
        let new = rx.try_recv().unwrap();
        s.handle(json!({"id":new["id"],"result":{"sessionId":"native"}}));
        s.send("hello".into());
        let prompt = rx.try_recv().unwrap();
        s.handle(json!({"method":"session/update","params":{"sessionId":"native","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}}}}));
        s.handle(json!({"id":"ask","method":"session/request_permission","params":{"sessionId":"native","toolCall":{"title":"write"},"options":[{"optionId":"once","name":"Allow once"}]}}));
        s.resolve(&json!("ask"), Resolution::Choice("not-offered".into()));
        assert!(rx.try_recv().is_err());
        s.resolve(&json!("ask"), Resolution::Choice("once".into()));
        assert_eq!(
            rx.try_recv().unwrap()["result"]["outcome"]["optionId"],
            "once"
        );
        s.handle(json!({"id":prompt["id"],"result":{"stopReason":"end_turn"}}));
        assert_eq!(s.snapshot.state, State::Idle);
        assert_eq!(s.snapshot.messages.last().unwrap().text, "hello");
    }
}
