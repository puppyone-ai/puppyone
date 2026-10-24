//! Provider session state; GUI visibility never controls execution or identity.
use crate::agent::domain::reference_input::{Prompt, ReferenceContent};
use crate::{
    agent::{
        domain::agent_session_model::*,
        runtime::agent_runtime_port::AgentRuntimePort,
        transports::jsonl_rpc_connection::{Connection, Event},
    },
    wake::Wake,
};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    time::{Duration, Instant},
};

pub struct Session {
    connection: Connection,
    root: PathBuf,
    next: u64,
    pending: HashMap<u64, (String, Instant)>,
    completed: HashSet<String>,
    special: HashMap<String, (String, Value)>,
    reconcile_stop: bool,
    stop_retries: usize,
    snapshot: SessionSnapshot,
}
impl Session {
    pub fn new(executable: PathBuf, root: PathBuf, history: bool, wake: Wake) -> Self {
        Self::from_connection(
            Connection::spawn(
                executable,
                vec!["app-server".into(), "--listen".into(), "stdio://".into()],
                root.clone(),
                wake,
            ),
            root,
            history,
        )
    }
    fn from_connection(connection: Connection, root: PathBuf, history: bool) -> Self {
        let mut s = Self {
            connection,
            root,
            next: 0,
            pending: HashMap::new(),
            completed: HashSet::new(),
            special: HashMap::new(),
            reconcile_stop: false,
            stop_retries: 0,
            snapshot: {
                let mut snapshot = SessionSnapshot::new("Codex", history);
                snapshot.capabilities = Capabilities {
                    history: true,
                    models: true,
                    modes: true,
                    fork: true,
                    steer: true,
                    compact: true,
                    archive: true,
                    rename: true,
                    images: true,
                    text_references: true,
                };
                snapshot.modes = vec![
                    ("workspace-write".into(), "Code".into()),
                    ("read-only".into(), "Ask".into()),
                ];
                snapshot.mode = Some("workspace-write".into());
                snapshot
            },
        };
        s.request("initialize",json!({"clientInfo":{"name":"puppyone_gpui","title":"PuppyOne GPUI","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":false}}));
        s
    }
    fn request(&mut self, method: &str, params: Value) {
        self.next += 1;
        let id = self.next;
        match self
            .connection
            .send(json!({"id":id,"method":method,"params":params}))
        {
            Ok(()) => {
                self.pending.insert(id, (method.into(), Instant::now()));
            }
            Err(e) => self.fail(e),
        }
    }
    fn fail(&mut self, error: String) {
        self.snapshot.error = Some(error);
        self.snapshot.state = State::Failed;
        self.snapshot.revision += 1;
    }
    pub fn busy(&self) -> bool {
        self.snapshot.busy()
    }
    pub fn send(&mut self, text: String) {
        self.submit(Prompt::text(text));
    }
    fn submit(&mut self, prompt: Prompt) {
        let text = prompt.display();
        if self.snapshot.state != State::Idle || text.trim().is_empty() {
            return;
        }
        let Some(thread) = self.snapshot.thread.clone() else {
            return;
        };
        let id = uuid::Uuid::new_v4().to_string();
        self.push(Message {
            id: id.clone(),
            role: "You".into(),
            text: text.clone(),
            status: String::new(),
        });
        self.snapshot.error = None;
        self.snapshot.state = State::Running;
        if self.snapshot.title == "Codex" {
            self.snapshot.title = text.chars().take(42).collect();
        }
        self.request("turn/start",json!({"threadId":thread,"clientUserMessageId":id,"input":codex_input(&prompt),"cwd":self.root,"approvalPolicy":"on-request","model":self.snapshot.model,"effort":self.snapshot.effort,"sandboxPolicy":if self.snapshot.mode.as_deref()==Some("read-only"){json!({"type":"readOnly"})}else{json!({"type":"workspaceWrite","writableRoots":[self.root],"networkAccess":false})}}));
    }
    pub fn stop(&mut self) {
        if let (Some(thread), Some(turn)) = (&self.snapshot.thread, &self.snapshot.turn) {
            self.snapshot.state = State::Stopping;
            self.stop_retries = 0;
            self.request("turn/interrupt", json!({"threadId":thread,"turnId":turn}));
        }
    }
    pub fn resume(&mut self, id: String) {
        if self.busy() {
            return;
        }
        self.snapshot.state = State::Starting;
        self.snapshot.error = None;
        self.snapshot.history_mode = false;
        self.snapshot.messages.clear();
        self.request("thread/resume",json!({"threadId":id,"cwd":self.root,"approvalPolicy":"on-request","sandbox":"workspace-write"}));
    }
    pub fn list_history(&mut self) {
        if self.busy() {
            return;
        }
        if !self.snapshot.history_mode {
            self.snapshot.history.clear();
            self.snapshot.cursor = None;
        }
        if self
            .pending
            .values()
            .any(|(method, _)| method == "thread/list")
        {
            return;
        }
        self.snapshot.history_mode = true;
        self.snapshot.state = State::History;
        self.request(
            "thread/list",
            json!({"cwd":self.root,"limit":50,"cursor":self.snapshot.cursor,"sortKey":"updated_at"}),
        );
    }
    pub fn new_thread(&mut self) {
        if self.busy() {
            return;
        }
        self.snapshot.history_mode = false;
        self.snapshot.state = State::Starting;
        self.snapshot.messages.clear();
        self.start_thread();
    }
    fn start_thread(&mut self) {
        self.request("thread/start",json!({"cwd":self.root,"approvalPolicy":"on-request","sandbox":"workspace-write","ephemeral":false}));
    }
    pub fn resolve(&mut self, id: &Value, response: Resolution) {
        if matches!(self.snapshot.state, State::Failed | State::Stopping) {
            return;
        }
        if let Some(index) = self.snapshot.interactions.iter().position(|i| &i.id == id) {
            let interaction = &self.snapshot.interactions[index];
            if Some(interaction.thread.as_str()) != self.snapshot.thread.as_deref()
                || (!interaction.turn.is_empty()
                    && Some(interaction.turn.as_str()) != self.snapshot.turn.as_deref())
            {
                self.snapshot.error = Some("This request belongs to a completed turn".into());
                return;
            }
            let response = match (&interaction.kind, response) {
                (InteractionKind::Form { .. }, Resolution::Form { decision, values }) => {
                    let Some((_, params)) = self.special.get(&id.to_string()) else {
                        return;
                    };
                    let content = if decision == Decision::Accept && params["mode"] != "url" {
                        match crate::agent::domain::interaction_form::validate(
                            &params["requestedSchema"],
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
                    json!({"action": match decision { Decision::Accept=>"accept", Decision::Decline=>"decline", Decision::Cancel=>"cancel" }, "content":content})
                }
                (InteractionKind::Permission { options, .. }, Resolution::Choice(choice))
                    if options.iter().any(|o| o.0 == choice) =>
                {
                    let Some((_, params)) = self.special.get(&id.to_string()) else {
                        return;
                    };
                    json!({"permissions":if choice=="allow"{params["permissions"].clone()}else{json!({})},"scope":"turn"})
                }
                (InteractionKind::Approval { decisions, .. }, Resolution::Approval(decision))
                    if decisions.contains(&decision) =>
                {
                    json!({"decision": match decision { Decision::Accept => "accept", Decision::Decline => "decline", Decision::Cancel => "cancel" }})
                }
                (InteractionKind::Questions(questions), Resolution::Answers(answers))
                    if questions.iter().all(|q| answers.contains_key(&q.id)) =>
                {
                    let answers: serde_json::Map<String, Value> = answers
                        .into_iter()
                        .map(|(key, answer)| (key, json!({"answers":answer})))
                        .collect();
                    json!({"answers":answers})
                }
                _ => {
                    self.snapshot.error =
                        Some("This response does not match the pending interaction".into());
                    self.snapshot.revision += 1;
                    return;
                }
            };
            match self.connection.send(json!({"id":id,"result":response})) {
                Ok(()) => {
                    self.snapshot.interactions.remove(index);
                    self.special.remove(&id.to_string());
                }
                Err(e) => self.fail(e),
            }
            self.snapshot.revision += 1;
        }
    }
    pub fn poll(&mut self) {
        for event in self.connection.drain(64) {
            match event {
                Event::Message(value) => self.handle(value),
                Event::Error(e) => self.fail(e),
                Event::Exited => {
                    if self.snapshot.state != State::Failed {
                        self.fail("Agent process exited. Open a new tab or resume this conversation from History.".into());
                    }
                }
            }
        }
        let timed_out = self
            .pending
            .iter()
            .filter(|(_, (_, at))| at.elapsed() > Duration::from_secs(60))
            .map(|(id, (method, _))| (*id, method.clone()))
            .collect::<Vec<_>>();
        for (id, method) in timed_out {
            self.pending.remove(&id);
            if !matches!(method.as_str(), "model/list" | "account/read") {
                self.fail(format!("{method} timed out. Delivery may have occurred; reopen History to reconcile before retrying."));
            }
        }
    }
    fn push(&mut self, message: Message) {
        self.snapshot.messages.push(message);
        self.snapshot.bound();
        if self.snapshot.messages.len() > 2000 {
            self.snapshot.messages.remove(0);
        }
        self.snapshot.revision += 1;
    }
    fn item(&mut self, item: &Value, history: bool) {
        let kind = item["type"].as_str().unwrap_or("");
        let id = item["id"].as_str().unwrap_or("").to_owned();
        let (role, text) = match kind {
            "agentMessage" => ("Codex", item["text"].as_str().unwrap_or("").to_owned()),
            "userMessage" if history => (
                "You",
                item["content"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v["text"].as_str())
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default(),
            ),
            "commandExecution" => (
                "Command",
                format!(
                    "{}\n{}",
                    item["command"].as_str().unwrap_or(""),
                    item["aggregatedOutput"].as_str().unwrap_or("")
                ),
            ),
            "fileChange" => (
                "File changes",
                item["changes"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .map(|v| {
                                format!(
                                    "{}\n{}",
                                    v["path"].as_str().unwrap_or(""),
                                    v["diff"].as_str().unwrap_or("")
                                )
                            })
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default(),
            ),
            "mcpToolCall" => (
                "Tool",
                format!(
                    "{} · {}",
                    item["server"].as_str().unwrap_or(""),
                    item["tool"].as_str().unwrap_or("")
                ) + &format!("\n{}", item.get("result").unwrap_or(&Value::Null)),
            ),
            "webSearch" => ("Search", item["query"].as_str().unwrap_or("").into()),
            "reasoning" => (
                "Reasoning",
                item["summary"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|v| v.as_str().or(v["text"].as_str()))
                    .collect::<Vec<_>>()
                    .join("\n"),
            ),
            "plan" => ("Plan", item["text"].as_str().unwrap_or("").into()),
            "contextCompaction" => ("System", "Conversation context compacted".into()),
            "dynamicToolCall" => (
                "Tool",
                format!(
                    "{}\n{}",
                    item["tool"].as_str().unwrap_or("Tool"),
                    item["contentItems"]
                ),
            ),
            "collabAgentToolCall" => (
                "Agent task",
                format!(
                    "{}\n{}",
                    item["tool"].as_str().unwrap_or("Task"),
                    item["prompt"].as_str().unwrap_or("")
                ),
            ),
            _ => return,
        };
        let status = item["status"].as_str().unwrap_or("").into();
        let text = bounded(text);
        if let Some(message) = self.snapshot.messages.iter_mut().find(|m| m.id == id) {
            message.text = text;
            message.status = status;
            self.snapshot.revision += 1;
        } else {
            self.push(Message {
                id,
                role: role.into(),
                text,
                status,
            });
        }
    }
    fn delta(&mut self, id: &str, role: &str, delta: &str) {
        self.snapshot.delta(id, role, delta);
    }
    fn handle(&mut self, value: Value) {
        if let Some(method) = value["method"].as_str() {
            let params = &value["params"];
            if value.get("id").is_some() {
                if params["threadId"].as_str() != self.snapshot.thread.as_deref()
                    || (!(method == "mcpServer/elicitation/request" && params["turnId"].is_null())
                        && params["turnId"].as_str() != self.snapshot.turn.as_deref())
                {
                    let _=self.connection.send(json!({"id":value["id"],"error":{"code":-32600,"message":"Session ownership mismatch"}}));
                    return;
                }
                if matches!(
                    method,
                    "mcpServer/elicitation/request" | "item/permissions/requestApproval"
                ) {
                    let kind = if method == "mcpServer/elicitation/request" {
                        let fields = if params["mode"] == "url" {
                            Ok(vec![])
                        } else {
                            crate::agent::domain::interaction_form::fields(
                                &params["requestedSchema"],
                            )
                        };
                        let fields = match fields {
                            Ok(f) => f,
                            Err(e) => {
                                let _ = self
                                    .connection
                                    .send(json!({"id":value["id"],"result":{"action":"cancel"}}));
                                self.snapshot.error = Some(e);
                                self.snapshot.revision += 1;
                                return;
                            }
                        };
                        InteractionKind::Form {
                            prompt: format!(
                                "{}: {}",
                                params["serverName"].as_str().unwrap_or("MCP"),
                                params["message"].as_str().unwrap_or("Provide input")
                            ),
                            fields,
                            url: params["url"].as_str().map(str::to_owned),
                        }
                    } else {
                        InteractionKind::Permission {
                            prompt: format!(
                                "{}\n{}",
                                params["reason"]
                                    .as_str()
                                    .unwrap_or("Additional permissions requested"),
                                serde_json::to_string_pretty(&params["permissions"])
                                    .unwrap_or_default()
                            ),
                            options: vec![
                                ("allow".into(), "Allow for this turn".into()),
                                ("deny".into(), "Deny".into()),
                            ],
                        }
                    };
                    self.special
                        .insert(value["id"].to_string(), (method.into(), params.clone()));
                    self.snapshot.interactions.push(Interaction {
                        id: value["id"].clone(),
                        thread: params["threadId"].as_str().unwrap_or("").into(),
                        turn: params["turnId"].as_str().unwrap_or("").into(),
                        kind,
                    });
                    self.snapshot.revision += 1;
                    return;
                }
                if matches!(
                    method,
                    "item/commandExecution/requestApproval"
                        | "item/fileChange/requestApproval"
                        | "item/tool/requestUserInput"
                ) {
                    let kind = if method == "item/tool/requestUserInput" {
                        InteractionKind::Questions(
                            params["questions"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .map(|q| Question {
                                    id: q["id"].as_str().unwrap_or("").into(),
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
                        let decisions = match params["availableDecisions"].as_array() {
                            Some(values) => values
                                .iter()
                                .filter_map(|v| match v.as_str() {
                                    Some("accept") => Some(Decision::Accept),
                                    Some("decline") => Some(Decision::Decline),
                                    Some("cancel") => Some(Decision::Cancel),
                                    _ => None,
                                })
                                .collect(),
                            None => vec![Decision::Accept, Decision::Decline],
                        };
                        InteractionKind::Approval {
                            command: method.contains("commandExecution"),
                            prompt: params["command"]
                                .as_str()
                                .or(params["reason"].as_str())
                                .unwrap_or("The Agent requests permission to continue.")
                                .into(),
                            decisions,
                        }
                    };
                    self.snapshot.interactions.push(Interaction {
                        id: value["id"].clone(),
                        thread: params["threadId"].as_str().unwrap_or("").into(),
                        turn: params["turnId"].as_str().unwrap_or("").into(),
                        kind,
                    });
                    self.snapshot.revision += 1;
                } else {
                    let _=self.connection.send(json!({"id":value["id"],"error":{"code":-32601,"message":"Unsupported interaction"}}));
                    self.snapshot.error = Some(format!(
                        "Unsupported Agent interaction was declined: {method}"
                    ));
                }
                return;
            }
            if let Some(thread) = params["threadId"].as_str()
                && self.snapshot.thread.as_deref() != Some(thread)
            {
                return;
            }
            match method {
                "turn/started" => {
                    if let Some(id) = params["turn"]["id"].as_str()
                        && !self.completed.contains(id)
                    {
                        self.snapshot.turn = Some(id.into());
                        self.snapshot.state = State::Running;
                        self.pending.retain(|_, (method, _)| method != "turn/start");
                    }
                }
                "turn/completed" => {
                    if let Some(id) = params["turn"]["id"].as_str() {
                        self.completed.insert(id.into());
                        if self.snapshot.turn.as_deref() == Some(id) || self.snapshot.turn.is_none()
                        {
                            self.snapshot.turn = None;
                            self.snapshot.interactions.retain(|i| i.turn.is_empty());
                            let retained = self
                                .snapshot
                                .interactions
                                .iter()
                                .map(|i| i.id.to_string())
                                .collect::<HashSet<_>>();
                            self.special.retain(|id, _| retained.contains(id));
                            let status = params["turn"]["status"].as_str().unwrap_or("failed");
                            self.snapshot.state = State::Idle;
                            self.snapshot.usage = status.into();
                            if status == "failed" {
                                self.snapshot.error = Some(
                                    params["turn"]["error"]["message"]
                                        .as_str()
                                        .unwrap_or("Turn failed")
                                        .into(),
                                );
                            }
                        }
                    }
                }
                "item/started" | "item/completed" => self.item(&params["item"], false),
                "item/agentMessage/delta" => self.delta(
                    params["itemId"].as_str().unwrap_or(""),
                    "Codex",
                    params["delta"].as_str().unwrap_or(""),
                ),
                "item/commandExecution/outputDelta" => self.delta(
                    params["itemId"].as_str().unwrap_or(""),
                    "Command",
                    params["delta"].as_str().unwrap_or(""),
                ),
                "serverRequest/resolved" => self
                    .snapshot
                    .interactions
                    .retain(|i| i.id != params["requestId"]),
                "thread/tokenUsage/updated" => {
                    let total = &params["tokenUsage"]["total"];
                    self.snapshot.usage = format!(
                        "{} input · {} output tokens",
                        total["inputTokens"].as_u64().unwrap_or(0),
                        total["outputTokens"].as_u64().unwrap_or(0)
                    );
                }
                "error" => {
                    self.snapshot.error = Some(
                        params["error"]["message"]
                            .as_str()
                            .unwrap_or("Agent error")
                            .into(),
                    )
                }
                _ => {}
            }
            self.snapshot.revision += 1;
            return;
        }
        let Some(id) = value["id"].as_u64() else {
            return;
        };
        let Some((method, _)) = self.pending.remove(&id) else {
            return;
        };
        if let Some(error) = value.get("error") {
            if method == "turn/interrupt" {
                // A turn may finish between the Stop click and the RPC response.
                // A failed cancellation receipt is never evidence that a completed turn failed.
                if self.snapshot.state == State::Stopping {
                    self.reconcile_stop = true;
                    self.request(
                        "thread/read",
                        json!({"threadId":self.snapshot.thread,"includeTurns":true}),
                    );
                }
                return;
            } else if matches!(
                method.as_str(),
                "model/list"
                    | "account/read"
                    | "thread/name/set"
                    | "thread/archive"
                    | "thread/compact/start"
                    | "thread/fork"
                    | "turn/steer"
            ) {
                self.snapshot.error = Some(
                    error["message"]
                        .as_str()
                        .unwrap_or("Model list unavailable")
                        .into(),
                );
            } else {
                self.fail(
                    error["message"]
                        .as_str()
                        .unwrap_or("Agent request failed")
                        .into(),
                );
            }
            return;
        }
        let result = &value["result"];
        match method.as_str() {
            "initialize" => {
                let _ = self.connection.send(json!({"method":"initialized"}));
                self.request("model/list", json!({"limit":100}));
                self.request("account/read", json!({"refreshToken":false}));
                if self.snapshot.history_mode {
                    self.snapshot.state = State::History;
                    self.list_history();
                } else {
                    self.start_thread();
                }
            }
            "model/list" => {
                if let Some(models) = result["data"].as_array() {
                    self.snapshot.efforts = models
                        .iter()
                        .flat_map(|m| {
                            m["supportedReasoningEfforts"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter_map(|e| e["reasoningEffort"].as_str().map(str::to_owned))
                        })
                        .collect();
                    self.snapshot.efforts.sort();
                    self.snapshot.efforts.dedup();
                    self.snapshot.models = models
                        .iter()
                        .filter_map(|m| {
                            Some((
                                m["model"].as_str()?.into(),
                                m["displayName"].as_str().unwrap_or("Model").into(),
                            ))
                        })
                        .collect();
                }
            }
            "thread/start" | "thread/resume" | "thread/fork" => {
                let thread = &result["thread"];
                if let Some(id) = thread["id"].as_str() {
                    self.snapshot.thread = Some(id.into());
                    self.snapshot.model = result["model"].as_str().map(str::to_owned);
                    self.snapshot.state = State::Idle;
                    if matches!(method.as_str(), "thread/resume" | "thread/fork") {
                        self.snapshot.messages.clear();
                        if let Some(turns) = thread["turns"].as_array() {
                            for turn in turns {
                                if let Some(items) = turn["items"].as_array() {
                                    for item in items {
                                        self.item(item, true);
                                    }
                                }
                            }
                        } else {
                            self.request("thread/read", json!({"threadId":id,"includeTurns":true}));
                        }
                    }
                } else {
                    self.fail("Agent returned no conversation identity".into());
                }
            }
            "account/read" => {
                self.snapshot.account = result["account"]["email"]
                    .as_str()
                    .or(result["account"]["type"].as_str())
                    .unwrap_or("CLI account")
                    .into();
            }
            "thread/compact/start" => {
                self.snapshot.notice = Some("Context compaction requested".into());
            }
            "thread/archive" => {
                self.snapshot.history.clear();
                self.snapshot.cursor = None;
                self.list_history();
            }
            "turn/steer" => {
                self.snapshot.notice = Some("Follow-up delivered to the active turn".into());
            }
            "thread/read" => {
                if self.reconcile_stop {
                    self.reconcile_stop = false;
                    if self.snapshot.state != State::Stopping {
                        return;
                    }
                    let target = result["thread"]["turns"].as_array().and_then(|turns| {
                        turns
                            .iter()
                            .find(|t| t["id"].as_str() == self.snapshot.turn.as_deref())
                    });
                    if let Some(turn) = target {
                        if matches!(
                            turn["status"].as_str(),
                            Some("completed" | "interrupted" | "failed")
                        ) {
                            self.handle(json!({"method":"turn/completed","params":{"threadId":self.snapshot.thread,"turn":turn}}));
                        } else if self.stop_retries < 2 {
                            self.stop_retries += 1;
                            self.request(
                                "turn/interrupt",
                                json!({"threadId":self.snapshot.thread,"turnId":self.snapshot.turn}),
                            );
                        } else {
                            self.snapshot.error=Some("The Agent has not confirmed Stop; execution may still be running. Retry Stop or close this tab to terminate its process.".into());
                            self.snapshot.state = State::Running;
                        }
                    } else {
                        self.fail("Unable to reconcile this turn after Stop. Close the tab to terminate its process; reopen History before retrying work.".into());
                    }
                    self.snapshot.revision += 1;
                    return;
                }
                if let Some(turns) = result["thread"]["turns"].as_array() {
                    for turn in turns {
                        if let Some(items) = turn["items"].as_array() {
                            for item in items {
                                self.item(item, true);
                            }
                        }
                    }
                }
            }
            "thread/list" => {
                if let Some(entries) = result["data"].as_array() {
                    for e in entries {
                        if let Some(id) = e["id"].as_str() {
                            self.snapshot.history.push(HistoryEntry {
                                id: id.into(),
                                title: e["name"]
                                    .as_str()
                                    .or(e["preview"].as_str())
                                    .unwrap_or("Untitled conversation")
                                    .chars()
                                    .take(100)
                                    .collect(),
                            });
                        }
                    }
                }
                self.snapshot.cursor = result["nextCursor"].as_str().map(str::to_owned);
            }
            "turn/start" => {
                if let Some(id) = result["turn"]["id"].as_str()
                    && !self.completed.contains(id)
                {
                    self.snapshot.turn = Some(id.into());
                    self.snapshot.state = State::Running;
                }
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
    fn submit(&mut self, prompt: Prompt) {
        Session::submit(self, prompt)
    }
    fn steer(&mut self, text: String) {
        if let (Some(thread), Some(turn)) = (&self.snapshot.thread, &self.snapshot.turn) {
            let params = json!({"threadId":thread,"expectedTurnId":turn,"input":codex_input(&Prompt::text(text.clone()))});
            self.request("turn/steer", params);
            self.snapshot
                .upsert(uuid::Uuid::new_v4().to_string(), "You", text, "steering");
        }
    }
    fn fork(&mut self) {
        if !self.busy() {
            self.request("thread/fork",json!({"threadId":self.snapshot.thread,"cwd":self.root,"approvalPolicy":"on-request","sandbox":"workspace-write"}));
        }
    }
    fn compact(&mut self) {
        if !self.busy() {
            self.request(
                "thread/compact/start",
                json!({"threadId":self.snapshot.thread}),
            );
        }
    }
    fn archive(&mut self, id: String) {
        if !self.busy() {
            self.request("thread/archive", json!({"threadId":id}));
        }
    }
    fn rename(&mut self, name: String) {
        let name = name.trim();
        if !self.busy() && !name.is_empty() {
            self.request(
                "thread/name/set",
                json!({"threadId":self.snapshot.thread,"name":name}),
            );
            self.snapshot.title = name.into();
            self.snapshot.revision += 1;
        }
    }
    fn select_mode(&mut self, mode: String) {
        if !self.busy() && self.snapshot.modes.iter().any(|m| m.0 == mode) {
            self.snapshot.mode = Some(mode);
            self.snapshot.revision += 1;
        }
    }
    fn select_effort(&mut self, effort: String) {
        if !self.busy() && self.snapshot.efforts.contains(&effort) {
            self.snapshot.effort = Some(effort);
            self.snapshot.revision += 1;
        }
    }
    fn poll(&mut self) {
        Session::poll(self)
    }
    fn send(&mut self, text: String) {
        Session::send(self, text)
    }
    fn stop(&mut self) {
        Session::stop(self)
    }
    fn resume(&mut self, id: String) {
        Session::resume(self, id)
    }
    fn list_history(&mut self) {
        Session::list_history(self)
    }
    fn new_thread(&mut self) {
        Session::new_thread(self)
    }
    fn resolve(&mut self, id: &Value, response: Resolution) {
        Session::resolve(self, id, response)
    }
    fn select_model(&mut self, model: Option<String>) {
        if self.snapshot.state == State::Idle {
            self.snapshot.model = model;
            self.snapshot.revision += 1;
        }
    }
}

fn codex_input(prompt: &Prompt) -> Vec<Value> {
    let mut input =
        vec![json!({"type":"text","text":prompt.text_with_references(),"text_elements":[]})];
    for r in &prompt.references {
        if let ReferenceContent::Image { mime, data } = &r.content {
            input.push(json!({"type":"image","url":format!("data:{mime};base64,{data}")}));
        }
    }
    input
}
fn bounded(mut text: String) -> String {
    let mut end = (2 * 1024 * 1024).min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Session, std::sync::mpsc::Receiver<Value>) {
        let (connection, requests, _) = Connection::harness();
        let mut session = Session::from_connection(connection, PathBuf::from("/tmp"), false);
        requests.try_recv().unwrap();
        session.pending.clear();
        session.snapshot.thread = Some("thread".into());
        session.snapshot.state = State::Idle;
        (session, requests)
    }
    #[test]
    fn late_start_receipt_cannot_revive_a_completed_turn() {
        let (mut s, _requests) = fixture();
        s.pending.insert(10, ("turn/start".into(), Instant::now()));
        s.handle(
            json!({"method":"turn/started","params":{"threadId":"thread","turn":{"id":"turn"}}}),
        );
        s.handle(json!({"method":"turn/completed","params":{"threadId":"thread","turn":{"id":"turn","status":"completed"}}}));
        s.handle(json!({"id":10,"result":{"turn":{"id":"turn"}}}));
        assert_eq!(s.snapshot.state, State::Idle);
        assert!(s.snapshot.turn.is_none());
    }
    #[test]
    fn late_interrupt_error_preserves_a_completed_turn() {
        let (mut s, requests) = fixture();
        s.snapshot.turn = Some("turn".into());
        s.snapshot.state = State::Running;
        s.stop();
        let stop = requests.try_recv().unwrap();
        s.handle(json!({"method":"turn/completed","params":{"threadId":"thread","turn":{"id":"turn","status":"completed"}}}));
        s.handle(json!({"id":stop["id"],"error":{"message":"no active turn to interrupt"}}));
        assert_eq!(s.snapshot.state, State::Idle);
        assert_eq!(s.snapshot.usage, "completed");
        assert!(s.snapshot.error.is_none());
        assert!(requests.try_recv().is_err());
    }
    #[test]
    fn interrupt_error_reconciles_the_exact_turn_without_replaying_work() {
        let (mut s, requests) = fixture();
        s.snapshot.turn = Some("turn".into());
        s.snapshot.state = State::Running;
        s.stop();
        let stop = requests.try_recv().unwrap();
        s.handle(json!({"id":stop["id"],"error":{"message":"no active turn to interrupt"}}));
        let read = requests.try_recv().unwrap();
        assert_eq!(read["method"], "thread/read");
        assert_eq!(read["params"]["threadId"], "thread");
        s.handle(json!({"id":read["id"],"result":{"thread":{"turns":[{"id":"older","status":"failed"},{"id":"turn","status":"interrupted"}]}}}));
        assert_eq!(s.snapshot.state, State::Idle);
        assert_eq!(s.snapshot.usage, "interrupted");
        assert!(s.snapshot.error.is_none());
        assert!(requests.try_recv().is_err());
    }
    #[test]
    fn typed_questions_preserve_wire_identity_and_reject_an_approval_answer() {
        let (mut s, requests) = fixture();
        s.snapshot.turn = Some("turn".into());
        s.snapshot.state = State::Running;
        s.handle(json!({"id":"ask-1","method":"item/tool/requestUserInput","params":{"threadId":"thread","turnId":"turn","questions":[{"id":"choice","question":"Choose one","options":[{"label":"A"},{"label":"B"}]}]}}));
        let InteractionKind::Questions(questions) = &s.snapshot.interactions[0].kind else {
            panic!("expected typed questions");
        };
        assert_eq!(questions[0].options, ["A", "B"]);
        s.resolve(&json!("ask-1"), Resolution::Approval(Decision::Accept));
        assert!(requests.try_recv().is_err());
        assert_eq!(s.snapshot.interactions.len(), 1);
        s.resolve(
            &json!("ask-1"),
            Resolution::Answers([("choice".into(), vec!["B".into()])].into()),
        );
        assert_eq!(
            requests.try_recv().unwrap(),
            json!({"id":"ask-1","result":{"answers":{"choice":{"answers":["B"]}}}})
        );
        assert!(s.snapshot.interactions.is_empty());
    }
    #[test]
    fn approvals_require_exact_session_and_turn_and_resolve_once() {
        let (mut s, requests) = fixture();
        s.snapshot.turn = Some("turn".into());
        s.snapshot.state = State::Running;
        s.handle(json!({"id":"approval-1","method":"item/commandExecution/requestApproval","params":{"threadId":"wrong","turnId":"turn","command":"test"}}));
        assert!(s.snapshot.interactions.is_empty());
        assert_eq!(requests.try_recv().unwrap()["error"]["code"], -32600);
        s.handle(json!({"id":7,"method":"item/commandExecution/requestApproval","params":{"threadId":"thread","turnId":"turn","command":"test"}}));
        assert_eq!(s.snapshot.interactions.len(), 1);
        s.resolve(&json!(7), Resolution::Approval(Decision::Decline));
        s.resolve(&json!(7), Resolution::Approval(Decision::Accept));
        assert_eq!(
            requests.try_recv().unwrap(),
            json!({"id":7,"result":{"decision":"decline"}})
        );
        assert!(requests.try_recv().is_err());
    }
    #[test]
    fn stream_history_and_terminal_events_have_one_projection() {
        let (mut s, _requests) = fixture();
        s.delta("item", "Codex", "hello");
        s.item(
            &json!({"id":"item","type":"agentMessage","text":"hello world"}),
            true,
        );
        assert_eq!(s.snapshot.messages.len(), 1);
        assert_eq!(s.snapshot.messages[0].text, "hello world");
        s.snapshot.turn = Some("current".into());
        s.snapshot.state = State::Running;
        s.handle(json!({"method":"turn/completed","params":{"threadId":"thread","turn":{"id":"older","status":"completed"}}}));
        assert_eq!(s.snapshot.state, State::Running);
        s.handle(json!({"method":"item/agentMessage/delta","params":{"threadId":"other-project","itemId":"item","delta":"wrong"}}));
        assert_eq!(s.snapshot.messages[0].text, "hello world");
    }
    #[test]
    fn mcp_form_is_validated_and_permission_grants_match_the_request() {
        let (mut s, rx) = fixture();
        s.handle(json!({"id":"form","method":"mcpServer/elicitation/request","params":{"threadId":"thread","turnId":null,"serverName":"fixture","mode":"form","message":"Select","requestedSchema":{"type":"object","properties":{"count":{"type":"integer","minimum":1}},"required":["count"]}}}));
        s.resolve(
            &json!("form"),
            Resolution::Form {
                decision: Decision::Accept,
                values: std::collections::BTreeMap::from([("count".into(), "bad".into())]),
            },
        );
        assert!(rx.try_recv().is_err());
        s.resolve(
            &json!("form"),
            Resolution::Form {
                decision: Decision::Accept,
                values: std::collections::BTreeMap::from([("count".into(), "2".into())]),
            },
        );
        assert_eq!(rx.try_recv().unwrap()["result"]["content"]["count"], 2);
        s.snapshot.turn = Some("turn".into());
        s.snapshot.state = State::Running;
        s.handle(json!({"id":"permissions","method":"item/permissions/requestApproval","params":{"threadId":"thread","turnId":"turn","permissions":{"network":{"enabled":true}},"reason":"Fixture"}}));
        s.resolve(&json!("permissions"), Resolution::Choice("allow".into()));
        let receipt = rx.try_recv().unwrap();
        assert_eq!(receipt["result"]["scope"], "turn");
        assert_eq!(
            receipt["result"]["permissions"],
            json!({"network":{"enabled":true}})
        );
    }
    fn wait(session: &mut Session, predicate: impl Fn(&Session) -> bool) {
        let start = Instant::now();
        loop {
            session.poll();
            assert_ne!(
                session.snapshot.state,
                State::Failed,
                "{:?}",
                session.snapshot.error
            );
            if predicate(session) {
                return;
            }
            assert!(
                start.elapsed() < Duration::from_secs(90),
                "Agent timeout: {:?}, {:?}",
                session.snapshot.state,
                session.snapshot.error
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    /// Explicit opt-in: uses the locally authenticated Codex CLI against a disposable project.
    #[test]
    #[ignore = "live Agent inference; run explicitly with --ignored"]
    fn live_codex_roundtrip_resume_and_stop() {
        let executable = crate::agent::connections::local_agent_inventory::discover()
            .into_iter()
            .find(|i| i.runtime == crate::agent::runtime::agent_runtime_registry::Runtime::Codex)
            .expect("Codex must be installed")
            .executable;
        let dir = tempfile::Builder::new()
            .prefix("puppyone-agent-test-")
            .tempdir()
            .unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("AGENTS.md"),"This is a disposable PuppyOne GUI integration test. Follow the user's request precisely.\n").unwrap();
        let mut session = Session::new(executable.clone(), root.clone(), false, Wake::default());
        wait(&mut session, |s| s.snapshot.state == State::Idle);
        let token = format!("GPUI_{}", uuid::Uuid::new_v4().simple());
        session.send(format!(
            "Remember this token: {token}. Reply with only that token. Do not use tools."
        ));
        wait(&mut session, |s| s.snapshot.state == State::Idle);
        assert!(
            session
                .snapshot
                .messages
                .iter()
                .any(|m| m.role == "Codex" && m.text.contains(&token)),
            "{:?}",
            session.snapshot.messages
        );
        let thread = session.snapshot.thread.clone().unwrap();
        drop(session);
        let mut resumed = Session::new(executable, root, true, Wake::default());
        wait(&mut resumed, |s| {
            s.snapshot.state == State::History
                && !s.pending.values().any(|(m, _)| m == "thread/list")
        });
        resumed.resume(thread.clone());
        wait(&mut resumed, |s| s.snapshot.state == State::Idle);
        assert_eq!(resumed.snapshot.thread.as_deref(), Some(thread.as_str()));
        resumed.send(
            "What token did I ask you to remember? Reply with only the token; do not use tools."
                .into(),
        );
        wait(&mut resumed, |s| s.snapshot.state == State::Idle);
        assert!(
            resumed
                .snapshot
                .messages
                .iter()
                .rev()
                .find(|m| m.role == "Codex")
                .unwrap()
                .text
                .contains(&token)
        );
        resumed.send("Use a shell tool to write exactly GPUI_TOOL_OK to result.txt in this disposable workspace, then run sleep 30 in the same shell invocation. After it finishes reply DONE. Do not just describe the command: execute it.".into());
        wait(&mut resumed, |s| {
            s.snapshot.turn.is_some() && dir.path().join("result.txt").exists()
        });
        assert_eq!(
            std::fs::read_to_string(dir.path().join("result.txt"))
                .unwrap()
                .trim(),
            "GPUI_TOOL_OK"
        );
        resumed.stop();
        wait(&mut resumed, |s| s.snapshot.state == State::Idle);
        assert_eq!(resumed.snapshot.usage, "interrupted");
        use crate::agent::domain::reference_input::{Reference, ReferenceContent};
        AgentRuntimePort::fork(&mut resumed);
        wait(&mut resumed, |s| {
            s.snapshot.thread.as_ref() != Some(&thread)
        });
        let forked = resumed.snapshot.thread.clone().unwrap();
        AgentRuntimePort::rename(&mut resumed, "GPUI native fork fixture".into());
        wait(&mut resumed, |s| {
            !s.pending.values().any(|(m, _)| m == "thread/name/set")
        });
        assert!(
            resumed.snapshot.error.is_none(),
            "{:?}",
            resumed.snapshot.error
        );
        AgentRuntimePort::select_mode(&mut resumed, "read-only".into());
        resumed.submit(Prompt {
            text: "Reply only with the exact token in the attached reference. Do not use tools."
                .into(),
            references: vec![Reference {
                id: "fixture-reference".into(),
                name: "note.txt".into(),
                source: "explicit test fixture".into(),
                bytes: 18,
                content: ReferenceContent::Text("GPUI_REFERENCE_OK".into()),
            }],
        });
        wait(&mut resumed, |s| s.snapshot.state == State::Idle);
        assert!(
            resumed
                .snapshot
                .messages
                .iter()
                .rev()
                .find(|m| m.role == "Codex")
                .unwrap()
                .text
                .contains("GPUI_REFERENCE_OK")
        );
        assert_eq!(resumed.snapshot.thread.as_ref(), Some(&forked));
        println!(
            "LIVE_AGENT_OK: streaming, second turn, native thread resume, real file write, interrupt, fork, rename, text reference; disposable workspace only"
        );
    }
}
