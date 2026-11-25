//! `cloudAgentClient.ts` and `cloud-agent-event-reader.mjs`: the hosted
//! Agent's durable run API for one authorized Project and its running
//! workbench (`agent-client.md`). Every answer must belong to that Project;
//! receipts must echo their request. Event reads are bounded batches —
//! closing a read cancels only the subscription, never the server-owned run.
use crate::cloud::auth::{
    self as auth, Broker, Cancellation, StreamEvent,
    model::{ApiRequest, Binding},
};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

/// The hosted target an Agent conversation runs against: the same identity
/// (account binding and generation) as the Cloud files on screen.
#[derive(Clone)]
pub struct AgentTarget {
    pub broker: Arc<Broker>,
    pub binding: Binding,
    pub project: String,
    pub workbench: String,
    /// The workspace's storage identity (API, account, Project, root): the
    /// persistence namespace of conversations and pending receipts.
    pub storage: String,
}
impl std::fmt::Debug for AgentTarget {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentTarget")
            .field("project", &self.project)
            .field("workbench", &self.workbench)
            .field("storage", &self.storage)
            .finish()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ToolResult {
    #[serde(default)]
    pub content: Vec<Value>,
    #[serde(default, rename = "isError")]
    pub is_error: bool,
    #[serde(default)]
    pub details: Option<Value>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Tool {
    pub call_id: String,
    pub name: String,
    #[serde(default)]
    pub input: Value,
    /// `waiting | approved | rejected | executing | completed`.
    pub state: String,
    #[serde(default)]
    pub result: Option<ToolResult>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct RunSnapshot {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub code: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub project_id: String,
    #[serde(default)]
    pub workbench_id: Option<String>,
    pub agent_id: String,
    pub session_id: String,
    pub request_id: String,
    #[serde(default)]
    pub prompt: String,
    /// `CloudRunState`.
    pub state: String,
    #[serde(default)]
    pub sequence: u64,
    #[serde(default)]
    pub stop_requested: bool,
    #[serde(default)]
    pub snapshot: RunSnapshot,
    #[serde(default)]
    pub publication: Option<Value>,
    /// Command receipts omit tools; `None` keeps the last known ones.
    #[serde(default)]
    pub tools: Option<Vec<Tool>>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}
impl Run {
    /// `cloudRunActive`.
    pub fn active(&self) -> bool {
        matches!(
            self.state.as_str(),
            "queued" | "running" | "waiting_approval" | "publishing"
        )
    }
    /// `publication.status === "committed"`: the run's changes were accepted.
    pub fn committed(&self) -> bool {
        self.publication
            .as_ref()
            .and_then(|p| p.get("status"))
            .and_then(Value::as_str)
            == Some("committed")
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub agent_id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub updated_at: String,
}
/// A durable submission: the request UUID and body are kept until the server
/// confirms or definitely refuses them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Submission {
    pub request_id: String,
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Event {
    pub id: u64,
    pub event: String,
    pub data: Value,
}

/// A failed call: the HTTP status and allowlisted server code when the server
/// answered, its request id for diagnostics, or whether a mutation's outcome
/// is unknown (its receipt must be queried).
#[derive(Clone, Debug, PartialEq)]
pub struct Error {
    pub status: Option<u16>,
    pub code: Option<&'static str>,
    pub request_id: Option<String>,
    pub unknown: bool,
    pub message: String,
}
impl Error {
    fn invalid(message: &str) -> Self {
        Self {
            status: None,
            code: None,
            request_id: None,
            unknown: false,
            message: message.into(),
        }
    }
    /// A definite refusal (4xx): the request was not accepted.
    pub fn refused(&self) -> bool {
        self.status.is_some_and(|s| (400..500).contains(&s))
    }
    /// Access ended (401, 403, 404): observation stops instead of retrying.
    pub fn terminal(&self) -> bool {
        matches!(self.status, Some(401 | 403 | 404))
    }
    /// The server rejected the pinned workbench handle because it slept, moved
    /// to another generation, or is not the interactive default workbench.
    pub fn is_workbench_stale(&self) -> bool {
        matches!(
            (self.status, self.code),
            (
                Some(404 | 409),
                Some(
                    "workbench_not_found"
                        | "workbench_not_running"
                        | "workbench_generation_changed"
                        | "interactive_workspace_required"
                )
            )
        )
    }
    fn service_code(code: auth::ServiceCode) -> &'static str {
        match code {
            auth::ServiceCode::FileConflict => "file_conflict",
            auth::ServiceCode::FileNotFound => "file_not_found",
            auth::ServiceCode::GenerationChanged => "workbench_generation_changed",
            auth::ServiceCode::NotRunning => "workbench_not_running",
            auth::ServiceCode::WorkbenchNotFound => "workbench_not_found",
            auth::ServiceCode::OperationRejected => "file_operation_rejected",
        }
    }
    pub(crate) fn from_auth(error: auth::Error) -> Self {
        let (status, code, request_id) = match error {
            auth::Error::Http(s) => (Some(s), None, None),
            auth::Error::Service(s, code) => (Some(s), Some(Self::service_code(code)), None),
            auth::Error::Response(s, code, diagnostic) => (
                Some(s),
                code,
                diagnostic.request_id.map(|id| id.as_str().to_owned()),
            ),
            auth::Error::InvalidCredentials => (Some(401), None, None),
            _ => (None, None, None),
        };
        Self {
            status,
            code,
            request_id,
            unknown: error == auth::Error::OutcomeUnknown,
            message: error.to_string(),
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
pub type Result<T> = std::result::Result<T, Error>;

/// The authenticated request bridge (Main's `requestCloudSessionApi`).
pub trait Transport: Send + Sync {
    fn request(&self, request: ApiRequest) -> Result<Value>;
    /// One bounded batch of a run's events after `after`.
    fn events(&self, run: &str, after: u64, cancel: &Cancellation) -> Result<Vec<Event>>;
    /// Resolves the live default workbench id for `project` when a submission's
    /// pinned workbench handle is stale (aligned with `cloudWorkspaceClient.ensure`).
    fn ensure_workbench(&self, _project: &str) -> Result<Option<String>> {
        Ok(None)
    }
}

/// `readCloudAgentEventBatch` limits.
pub const BATCH_EVENTS: usize = 64;
pub const BATCH_BYTES: usize = 512 * 1024;
pub const BATCH_WAIT: Duration = Duration::from_secs(10);

/// The SSE frames of one bounded batch: at most 64 events, ending early at a
/// `reset` or `terminal` event or at an idle heartbeat after some events.
#[derive(Default)]
pub struct Batch {
    buffer: Vec<u8>,
    pub events: Vec<Event>,
    pub done: bool,
}
impl Batch {
    /// Feeds a chunk; `Ok(true)` once the batch is complete.
    pub fn feed(&mut self, chunk: &[u8]) -> Result<bool> {
        self.buffer.extend_from_slice(chunk);
        // CRLF framing; a trailing lone CR waits for its LF.
        let mut normalized = Vec::with_capacity(self.buffer.len());
        let mut i = 0;
        while i < self.buffer.len() {
            if self.buffer[i] == b'\r' && self.buffer.get(i + 1) == Some(&b'\n') {
                i += 1;
                continue;
            }
            normalized.push(self.buffer[i]);
            i += 1;
        }
        self.buffer = normalized;
        if self.buffer.len() > BATCH_BYTES {
            return Err(Error::invalid(
                "Cloud Agent event exceeds the transport limit.",
            ));
        }
        while let Some(end) = self.buffer.windows(2).position(|w| w == b"\n\n") {
            let frame: Vec<u8> = self.buffer.drain(..end + 2).take(end).collect();
            let frame = String::from_utf8(frame)
                .map_err(|_| Error::invalid("Cloud Agent returned an invalid event."))?;
            // An idle heartbeat is not EOF: keep waiting unless events are due.
            if frame.starts_with(':') {
                if !self.events.is_empty() {
                    self.done = true;
                    return Ok(true);
                }
                continue;
            }
            let Some(event) = parse_event(&frame)? else {
                continue;
            };
            let last = matches!(event.event.as_str(), "reset" | "terminal");
            self.events.push(event);
            if last || self.events.len() == BATCH_EVENTS {
                self.done = true;
                return Ok(true);
            }
        }
        Ok(false)
    }
}
fn parse_event(frame: &str) -> Result<Option<Event>> {
    let (mut data, mut event, mut id) = (Vec::new(), "message".to_owned(), String::new());
    for line in frame.split('\n') {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.strip_prefix(' ').unwrap_or(value);
        match name {
            "data" => data.push(value.to_owned()),
            "event" => event = value.to_owned(),
            "id" => id = value.to_owned(),
            _ => {}
        }
    }
    if data.is_empty() {
        return Ok(None);
    }
    if id.is_empty() || id.len() > 15 || !id.bytes().all(|b| b.is_ascii_digit()) {
        return Err(Error::invalid(
            "Cloud Agent returned an invalid event cursor.",
        ));
    }
    let data = serde_json::from_str(&data.join("\n"))
        .map_err(|_| Error::invalid("Cloud Agent returned an invalid event."))?;
    Ok(Some(Event {
        id: id.parse().unwrap_or(0),
        event,
        data,
    }))
}

/// The Broker-backed transport: the target's own binding, never another.
pub struct BrokerTransport {
    pub broker: Arc<Broker>,
    pub binding: Binding,
    pub cancel: Cancellation,
    /// How long one read waits for events (`maxWaitMs`).
    pub wait: Duration,
}
impl Transport for BrokerTransport {
    fn request(&self, request: ApiRequest) -> Result<Value> {
        self.broker
            .request_scoped(&self.binding, &request, &self.cancel)
            .map_err(Error::from_auth)
    }
    fn events(&self, run: &str, after: u64, cancel: &Cancellation) -> Result<Vec<Event>> {
        let request = ApiRequest {
            method: Method::GET,
            path: format!("/agents/runs/{}/events", segment(run)?),
            query: vec![("after".into(), after.to_string())],
            body: None,
            idempotency_key: None,
        };
        let read = cancel.child();
        let expired = Arc::new(AtomicBool::new(false));
        let timer = {
            let (read, expired) = (read.clone(), expired.clone());
            let wait = self.wait;
            std::thread::spawn(move || {
                let deadline = std::time::Instant::now() + wait;
                while std::time::Instant::now() < deadline {
                    if read.check().is_err() {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                expired.store(true, Ordering::SeqCst);
                read.cancel();
            })
        };
        let mut batch = Batch::default();
        let mut failure = None;
        let result = self
            .broker
            .stream(&self.binding, &request, &read, &mut |event| {
                if let StreamEvent::Data(bytes) = event {
                    match batch.feed(bytes) {
                        Ok(true) => return Err(auth::Error::Cancelled),
                        Ok(false) => {}
                        Err(error) => {
                            failure = Some(error);
                            return Err(auth::Error::Cancelled);
                        }
                    }
                }
                Ok(())
            });
        read.cancel();
        let _ = timer.join();
        if let Some(error) = failure {
            return Err(error);
        }
        match result {
            Ok(()) => Ok(batch.events),
            Err(_) if batch.done || expired.load(Ordering::SeqCst) => Ok(batch.events),
            Err(error) => Err(Error::from_auth(error)),
        }
    }
    fn ensure_workbench(&self, project: &str) -> Result<Option<String>> {
        let path = format!("/projects/{}/workbench", segment(project)?);
        let extract = |value: &Value| -> Option<(String, bool)> {
            let row = value.get("workspace").unwrap_or(value);
            if row.get("project_id").and_then(Value::as_str) != Some(project) {
                return None;
            }
            let id = row
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())?;
            let running = row.get("state").and_then(Value::as_str) == Some("running")
                && row.pointer("/operation/pending").and_then(Value::as_bool) != Some(true);
            Some((id.to_owned(), running))
        };
        let status = self.request(ApiRequest {
            method: Method::GET,
            path: path.clone(),
            query: vec![],
            body: None,
            idempotency_key: None,
        })?;
        if let Some((id, true)) = extract(&status) {
            return Ok(Some(id));
        }
        // Prompt submission is an explicit user action (`cloudWorkspaceClient.ensure`).
        let woken = self.request(ApiRequest {
            method: Method::POST,
            path,
            query: vec![],
            body: None,
            idempotency_key: None,
        })?;
        Ok(extract(&woken).map(|(id, _)| id))
    }
}

/// An identifier safe to place in a path segment.
fn segment(id: &str) -> Result<&str> {
    if !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        Ok(id)
    } else {
        Err(Error::invalid("Cloud Agent identifier is invalid."))
    }
}
/// `cloudApiRequest`: a `{code, data}` envelope yields its `data`.
fn unwrap(value: Value) -> Value {
    match value {
        Value::Object(mut map) if map.contains_key("data") => {
            map.remove("data").unwrap_or(Value::Null)
        }
        value => value,
    }
}
fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(unwrap(value))
        .map_err(|_| Error::invalid("Cloud Agent returned an invalid response."))
}

/// `CloudAgentClient`.
#[derive(Clone)]
pub struct Client {
    transport: Arc<dyn Transport>,
    pub project: String,
    workbench: Arc<Mutex<String>>,
}
impl Client {
    pub fn new(transport: Arc<dyn Transport>, project: String, workbench: String) -> Self {
        Self {
            transport,
            project,
            workbench: Arc::new(Mutex::new(workbench)),
        }
    }
    pub fn workbench(&self) -> String {
        self.workbench.lock().unwrap().clone()
    }
    fn call(
        &self,
        method: Method,
        path: String,
        query: Vec<(String, String)>,
        body: Option<Value>,
    ) -> Result<Value> {
        self.transport.request(ApiRequest {
            method,
            path,
            query,
            body,
            idempotency_key: None,
        })
    }
    fn owned(&self, run: Run) -> Result<Run> {
        if run.project_id != self.project {
            return Err(Error::invalid("Cloud Agent returned a different project."));
        }
        Ok(run)
    }
    fn submit_for(&self, input: &Submission, workbench: &str) -> Result<Run> {
        let mut body = serde_json::to_value(input).unwrap_or_default();
        body["workbench_id"] = json!(workbench);
        body["project_id"] = json!(self.project);
        let run: Run =
            decode(self.call(Method::POST, "/agents/runs".into(), vec![], Some(body))?)?;
        let run = self.owned(run)?;
        if run.workbench_id.as_deref() != Some(workbench) {
            return Err(Error::invalid(
                "Cloud Agent returned a different workspace.",
            ));
        }
        if run.request_id != input.request_id
            || input
                .session_id
                .as_ref()
                .is_some_and(|s| *s != run.session_id)
        {
            return Err(Error::invalid(
                "Cloud Agent returned a different submission receipt.",
            ));
        }
        Ok(run)
    }
    pub fn submit(&self, input: &Submission) -> Result<Run> {
        let current = self.workbench();
        match self.submit_for(input, &current) {
            Ok(run) => Ok(run),
            Err(error) if error.is_workbench_stale() => {
                let Some(refreshed) = self.transport.ensure_workbench(&self.project)? else {
                    return Err(error);
                };
                *self.workbench.lock().unwrap() = refreshed.clone();
                self.submit_for(input, &refreshed)
            }
            Err(error) => Err(error),
        }
    }
    pub fn receipt(&self, request: &str) -> Result<Run> {
        let path = format!(
            "/agents/requests/{}/{}",
            segment(&self.project)?,
            segment(request)?
        );
        let run = self.owned(decode(self.call(Method::GET, path, vec![], None)?)?)?;
        if run.request_id != request {
            return Err(Error::invalid("Cloud Agent returned a different request."));
        }
        Ok(run)
    }
    pub fn snapshot(&self, id: &str) -> Result<Run> {
        let path = format!("/agents/runs/{}", segment(id)?);
        let run = self.owned(decode(self.call(Method::GET, path, vec![], None)?)?)?;
        if run.id != id {
            return Err(Error::invalid("Cloud Agent returned a different run."));
        }
        Ok(run)
    }
    /// The session's latest runs (at most 100).
    pub fn runs(&self, session: &str) -> Result<Vec<Run>> {
        let path = format!("/agents/sessions/{}/runs", segment(session)?);
        let runs: Vec<Run> = decode(self.call(
            Method::GET,
            path,
            vec![("limit".into(), "100".into())],
            None,
        )?)?;
        runs.into_iter()
            .map(|run| {
                let run = self.owned(run)?;
                if run.session_id != session {
                    return Err(Error::invalid("Cloud Agent returned a different session."));
                }
                Ok(run)
            })
            .collect()
    }
    /// One named query per Agent (at most 200 sessions).
    pub fn sessions(&self, agent: &str) -> Result<Vec<Session>> {
        let rows: Vec<Session> = decode(self.call(
            Method::GET,
            "/agents/sessions".into(),
            vec![
                ("project_id".into(), self.project.clone()),
                ("agent_id".into(), agent.to_owned()),
                ("limit".into(), "200".into()),
            ],
            None,
        )?)?;
        Ok(rows
            .into_iter()
            .filter(|row| row.mode == "cloud_pi" && row.agent_id == agent)
            .collect())
    }
    pub fn events(&self, run: &str, after: u64, cancel: &Cancellation) -> Result<Vec<Event>> {
        self.transport.events(run, after, cancel)
    }
    pub fn stop(&self, run: &str) -> Result<Run> {
        let path = format!("/agents/runs/{}/stop", segment(run)?);
        self.owned(decode(self.call(Method::POST, path, vec![], None)?)?)
    }
    pub fn approve(&self, run: &str, call: &str, decision: &str, allow: bool) -> Result<Run> {
        let path = format!(
            "/agents/runs/{}/approvals/{}",
            segment(run)?,
            segment(call)?
        );
        let body = json!({"decision_id": decision, "allow": allow});
        self.owned(decode(self.call(
            Method::POST,
            path,
            vec![],
            Some(body),
        )?)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn a_batch_ends_at_64_events_a_reset_a_terminal_or_a_heartbeat_after_events() {
        let frame = |id: u64, event: &str| {
            format!("id: {id}\r\nevent: {event}\r\ndata: {{\"n\":{id}}}\r\n\r\n")
        };
        // A heartbeat before any event keeps waiting; after one, it ends the batch.
        let mut batch = Batch::default();
        assert!(!batch.feed(b": keepalive\n\n").unwrap());
        let text = frame(1, "delta");
        let (a, b) = text.as_bytes().split_at(9);
        assert!(!batch.feed(a).unwrap());
        assert!(!batch.feed(b).unwrap());
        assert!(batch.feed(b": keepalive\n\n").unwrap());
        assert_eq!(batch.events[0].id, 1);
        assert_eq!(batch.events[0].data, json!({"n": 1}));
        for last in ["reset", "terminal"] {
            let mut batch = Batch::default();
            let text = format!(
                "{}{}{}",
                frame(1, "delta"),
                frame(2, last),
                frame(3, "delta")
            );
            assert!(batch.feed(text.as_bytes()).unwrap());
            assert_eq!(batch.events.len(), 2);
        }
        let mut batch = Batch::default();
        let many: String = (1..=70).map(|i| frame(i, "delta")).collect();
        assert!(batch.feed(many.as_bytes()).unwrap());
        assert_eq!(batch.events.len(), BATCH_EVENTS);
    }

    /// `electron.cloud-agent-event-reader.test.mjs`: "decodes split UTF-8 and
    /// CRLF, returns a terminal batch" — the TS frames, one byte at a time.
    #[test]
    fn frames_split_inside_utf8_decode_and_a_terminal_ends_the_batch() {
        let frame = |id: u64, event: &str, data: Value| {
            format!("id: {id}\r\nevent: {event}\r\ndata: {data}\r\n\r\n")
        };
        let text = frame(1, "text_delta", json!({"text": "你好"}))
            + &frame(2, "terminal", json!({"state": "succeeded"}));
        let mut batch = Batch::default();
        let mut ended = false;
        for byte in text.as_bytes() {
            ended = batch.feed(std::slice::from_ref(byte)).unwrap();
        }
        assert!(ended);
        let events: Vec<_> = batch
            .events
            .iter()
            .map(|e| (e.id, e.event.as_str(), e.data.clone()))
            .collect();
        assert_eq!(
            events,
            [
                (1, "text_delta", json!({"text": "你好"})),
                (2, "terminal", json!({"state": "succeeded"}))
            ]
        );
    }

    #[test]
    fn invalid_cursors_and_oversized_frames_fail_the_read() {
        let mut batch = Batch::default();
        assert!(batch.feed(b"id: x\ndata: {}\n\n").is_err());
        let mut batch = Batch::default();
        assert!(batch.feed(b"id: 1234567890123456\ndata: {}\n\n").is_err());
        let mut batch = Batch::default();
        let huge = vec![b'a'; BATCH_BYTES + 1];
        assert!(batch.feed(&huge).is_err());
        // A frame without data is skipped.
        let mut batch = Batch::default();
        assert!(!batch.feed(b"event: ping\n\n").unwrap());
    }

    struct Scripted(std::sync::Mutex<Vec<(String, Value)>>, Value);
    impl Transport for Scripted {
        fn request(&self, request: ApiRequest) -> Result<Value> {
            self.0
                .lock()
                .unwrap()
                .push((request.path.clone(), request.body.unwrap_or_default()));
            Ok(self.1.clone())
        }
        fn events(&self, _: &str, _: u64, _: &Cancellation) -> Result<Vec<Event>> {
            Ok(vec![])
        }
    }
    fn run(project: &str) -> Value {
        json!({"code": 0, "data": {"id": "run-1", "project_id": project, "workbench_id": "wb-1",
            "agent_id": "agent-1", "session_id": "session-1", "request_id": "req-1",
            "prompt": "hi", "state": "queued", "sequence": 0}})
    }

    #[test]
    fn answers_must_belong_to_the_project_workspace_and_request() {
        let client = |reply: Value| {
            let transport = Arc::new(Scripted(Default::default(), reply));
            (
                Client::new(transport.clone(), "project-a".into(), "wb-1".into()),
                transport,
            )
        };
        let input = Submission {
            request_id: "req-1".into(),
            prompt: "hi".into(),
            session_id: None,
            agent_id: None,
        };
        let (ok, transport) = client(run("project-a"));
        assert_eq!(ok.submit(&input).unwrap().id, "run-1");
        let (path, body) = transport.0.lock().unwrap()[0].clone();
        assert_eq!(path, "/agents/runs");
        assert_eq!(body["workbench_id"], "wb-1");
        assert_eq!(body["project_id"], "project-a");
        assert_eq!(body["request_id"], "req-1");
        assert!(body.get("session_id").is_none());
        let (other, _) = client(run("project-b"));
        assert!(other.submit(&input).is_err());
        assert!(other.snapshot("run-1").is_err());
        let (ok, _) = client(run("project-a"));
        assert!(ok.receipt("req-2").is_err());
        assert!(ok.snapshot("run-2").is_err());
        assert!(ok.snapshot("../x").is_err());
        let mut moved = run("project-a");
        moved["data"]["workbench_id"] = json!("wb-2");
        let (moved, _) = client(moved);
        assert!(moved.submit(&input).is_err());
    }

    #[test]
    fn history_keeps_only_this_agents_cloud_sessions() {
        let rows = json!({"data": [
            {"id": "s1", "agent_id": "agent-1", "mode": "cloud_pi", "updated_at": "2026-10-01T00:00:00Z"},
            {"id": "s2", "agent_id": "agent-2", "mode": "cloud_pi", "updated_at": "2026-10-01T00:00:00Z"},
            {"id": "s3", "agent_id": "agent-1", "mode": "chat", "updated_at": "2026-10-01T00:00:00Z"}]});
        let transport = Arc::new(Scripted(Default::default(), rows));
        let client = Client::new(transport, "project-a".into(), "wb-1".into());
        let sessions = client.sessions("agent-1").unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "s1");
    }

    #[test]
    fn from_auth_preserves_allowlisted_code_and_request_id() {
        let diag = auth::model::Diagnostic::read(&json!({}), Some("req-abc-123"));
        let err = Error::from_auth(auth::Error::Response(
            409,
            Some("agent_model_unconfigured"),
            diag,
        ));
        assert_eq!(err.status, Some(409));
        assert_eq!(err.code, Some("agent_model_unconfigured"));
        assert_eq!(err.request_id.as_deref(), Some("req-abc-123"));

        let stale = Error::from_auth(auth::Error::Service(409, auth::ServiceCode::NotRunning));
        assert_eq!(stale.status, Some(409));
        assert_eq!(stale.code, Some("workbench_not_running"));
        assert!(stale.is_workbench_stale());
    }

    #[test]
    fn submit_refreshes_stale_workbench_once_and_updates_client_handle() {
        struct StaleThenReady {
            attempts: std::sync::atomic::AtomicUsize,
            ensures: std::sync::atomic::AtomicUsize,
            seen_workbenches: Mutex<Vec<String>>,
        }
        impl Transport for StaleThenReady {
            fn request(&self, request: ApiRequest) -> Result<Value> {
                let wb = request
                    .body
                    .as_ref()
                    .and_then(|b| b["workbench_id"].as_str())
                    .unwrap_or_default()
                    .to_owned();
                self.seen_workbenches.lock().unwrap().push(wb.clone());
                if self.attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                    return Err(Error::from_auth(auth::Error::Service(
                        404,
                        auth::ServiceCode::WorkbenchNotFound,
                    )));
                }
                let mut reply = run("project-a");
                reply["data"]["workbench_id"] = json!(wb);
                Ok(reply)
            }
            fn events(&self, _: &str, _: u64, _: &Cancellation) -> Result<Vec<Event>> {
                Ok(vec![])
            }
            fn ensure_workbench(&self, project: &str) -> Result<Option<String>> {
                assert_eq!(project, "project-a");
                self.ensures.fetch_add(1, Ordering::SeqCst);
                Ok(Some("wb-2".into()))
            }
        }
        let transport = Arc::new(StaleThenReady {
            attempts: Default::default(),
            ensures: Default::default(),
            seen_workbenches: Mutex::default(),
        });
        let client = Client::new(transport.clone(), "project-a".into(), "wb-1".into());
        let input = Submission {
            request_id: "req-1".into(),
            prompt: "hi".into(),
            session_id: None,
            agent_id: None,
        };
        let submitted = client.submit(&input).unwrap();
        assert_eq!(submitted.workbench_id.as_deref(), Some("wb-2"));
        assert_eq!(client.workbench(), "wb-2");
        assert_eq!(transport.ensures.load(Ordering::SeqCst), 1);
        assert_eq!(
            *transport.seen_workbenches.lock().unwrap(),
            vec!["wb-1".to_owned(), "wb-2".to_owned()]
        );
    }
}
