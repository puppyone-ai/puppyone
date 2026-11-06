use super::*;
use crate::{
    cloud_auth::model::ApiRequest,
    workspace::cloud::agent::{Error, Event, Transport},
};
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::sync::atomic::AtomicUsize;

type Handler = Box<dyn Fn(&ApiRequest) -> Result<Value, Error> + Send + Sync>;
/// A scripted Cloud: every request is recorded; `handler` answers.
struct Fake {
    requests: Mutex<Vec<(String, String, Value)>>,
    handler: Mutex<Handler>,
    events: Mutex<Vec<Vec<Event>>>,
    event_reads: AtomicUsize,
}
impl Fake {
    fn new(
        handler: impl Fn(&ApiRequest) -> Result<Value, Error> + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            requests: Mutex::default(),
            handler: Mutex::new(Box::new(handler)),
            events: Mutex::default(),
            event_reads: AtomicUsize::new(0),
        })
    }
    fn set(&self, handler: impl Fn(&ApiRequest) -> Result<Value, Error> + Send + Sync + 'static) {
        *self.handler.lock().unwrap() = Box::new(handler);
    }
    fn count(&self, method: &str, prefix: &str) -> usize {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|(m, p, _)| m == method && p.starts_with(prefix))
            .count()
    }
    fn bodies(&self, path: &str) -> Vec<Value> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, p, _)| p == path)
            .map(|(_, _, b)| b.clone())
            .collect()
    }
}
impl Transport for Fake {
    fn request(&self, request: ApiRequest) -> Result<Value, Error> {
        self.requests.lock().unwrap().push((
            request.method.to_string(),
            request.path.clone(),
            request.body.clone().unwrap_or_default(),
        ));
        (self.handler.lock().unwrap())(&request)
    }
    fn events(&self, _: &str, _: u64, _: &Cancellation) -> Result<Vec<Event>, Error> {
        self.event_reads.fetch_add(1, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(20));
        Ok(self.events.lock().unwrap().pop().unwrap_or_default())
    }
}
fn status(code: u16) -> Error {
    Error {
        status: Some(code),
        unknown: false,
        message: format!("HTTP {code}"),
    }
}
fn lost() -> Error {
    Error {
        status: None,
        unknown: true,
        message: "outcome unknown".into(),
    }
}
fn run(id: &str, request: &str, state: &str, sequence: u64) -> Value {
    json!({"id": id, "project_id": "project-a", "workbench_id": "wb-1", "agent_id": "agent-1",
        "session_id": "session-1", "request_id": request, "prompt": "hello", "state": state,
        "sequence": sequence, "snapshot": {"text": format!("reply {sequence}")},
        "created_at": format!("2026-10-30T00:00:0{}Z", id.len() % 10), "updated_at": "2026-10-30T00:00:00Z"})
}
struct Setup {
    fake: Arc<Fake>,
    hub: Arc<Hub>,
    published: Arc<AtomicUsize>,
    _dir: tempfile::TempDir,
}
fn setup(fake: Arc<Fake>) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let published = Arc::new(AtomicUsize::new(0));
    let hub = Hub::new(
        Client::new(fake.clone(), "project-a".into(), "wb-1".into()),
        "puppyone-cloud://api/user-1/project-a/root/".into(),
        dir.path().to_path_buf(),
        Box::new({
            let published = published.clone();
            move || {
                published.fetch_add(1, Ordering::SeqCst);
            }
        }),
    );
    Setup {
        fake,
        hub,
        published,
        _dir: dir,
    }
}
fn controller(hub: &Arc<Hub>, key: &str) -> CloudAgentController {
    let (wake, _rx) = Wake::channel();
    CloudAgentController::new(hub.clone(), key, None, wake).unwrap()
}
fn settle(c: &CloudAgentController, what: &str, ready: impl Fn(&CloudAgentState) -> bool) {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        if ready(&c.snapshot()) {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "{what} did not settle"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
/// The transcript's (role, text) rows.
fn texts(state: &CloudAgentState) -> Vec<(String, String)> {
    project_cloud_agent_runs(&state.runs)
        .messages
        .iter()
        .map(|m| {
            (
                m["role"].as_str().unwrap_or_default().to_string(),
                m["text"].as_str().unwrap_or_default().to_string(),
            )
        })
        .collect()
}

#[test]
fn an_empty_tab_sends_nothing() {
    let s = setup(Fake::new(|_| Ok(json!({}))));
    let c = controller(&s.hub, "tab-1");
    std::thread::sleep(Duration::from_millis(500));
    assert!(s.fake.requests.lock().unwrap().is_empty());
    assert_eq!(s.fake.event_reads.load(Ordering::SeqCst), 0);
    assert!(c.snapshot().runs.is_empty());
}

#[test]
fn a_lost_receipt_is_queried_then_resubmitted_with_the_same_uuid() {
    let fake = Fake::new(|r| {
        if r.path == "/agents/runs" {
            Err(lost())
        } else {
            Err(status(404))
        }
    });
    let s = setup(fake);
    let c = controller(&s.hub, "tab-1");
    c.set_draft("hello".into());
    c.submit("hello".into());
    settle(&c, "the lost receipt", |state| {
        state.error.is_some() && !state.submitting
    });
    // The tab keeps its unconfirmed submission, and its draft.
    assert!(!c.can_release());
    assert_eq!(c.snapshot().draft, "hello");
    // Another message waits for this one.
    c.submit("something else".into());
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(s.fake.count("POST", "/agents/runs"), 1);
    // The same text again: the receipt is queried first, then the same UUID.
    s.fake.set(|r| {
        if r.path.starts_with("/agents/requests/") {
            Err(status(404))
        } else if r.path == "/agents/runs" {
            let request = r.body.as_ref().unwrap()["request_id"]
                .as_str()
                .unwrap()
                .to_owned();
            Ok(run("run-1", &request, "succeeded", 3))
        } else {
            Ok(run("run-1", "x", "succeeded", 3))
        }
    });
    c.retry();
    settle(&c, "the confirmed run", |state| {
        state.session_id.as_deref() == Some("session-1")
    });
    let bodies = s.fake.bodies("/agents/runs");
    assert_eq!(bodies.len(), 2);
    assert_eq!(bodies[0]["request_id"], bodies[1]["request_id"]);
    assert_eq!(s.fake.count("GET", "/agents/requests/project-a/"), 1);
    settle(&c, "the release", |state| {
        state.pending.is_none() && !state.submitting
    });
    assert!(c.can_release());
    // A confirmed prompt leaves the composer.
    assert!(c.snapshot().draft.is_empty());
    let rows = texts(&c.snapshot());
    assert!(rows.contains(&("user".into(), "hello".into())));
    assert!(rows.contains(&("assistant".into(), "reply 3".into())));
}

#[test]
fn a_definite_refusal_forgets_the_submission() {
    let s = setup(Fake::new(|_| Err(status(422))));
    let c = controller(&s.hub, "tab-1");
    c.submit("hello".into());
    settle(&c, "the refusal", |state| state.error.is_some());
    // Forgetting the submission is a write of its own; the tab may go once
    // it has landed.
    settle(&c, "the release", |_| c.can_release());
}

#[test]
fn a_pending_receipt_survives_a_restart_and_is_confirmed_on_load() {
    let s = setup(Fake::new(|_| Err(lost())));
    let first = controller(&s.hub, "tab-1");
    first.submit("hello".into());
    settle(&first, "the lost receipt", |state| state.error.is_some());
    let request = s.fake.bodies("/agents/runs")[0]["request_id"]
        .as_str()
        .unwrap()
        .to_owned();
    drop(first);
    s.fake.set(move |r| {
        if r.path == format!("/agents/requests/project-a/{request}") {
            Ok(run("run-1", &request, "succeeded", 2))
        } else if r.path.ends_with("/runs") {
            Ok(json!([run("run-1", &request, "succeeded", 2)]))
        } else {
            Ok(run("run-1", &request, "succeeded", 2))
        }
    });
    let again = controller(&s.hub, "tab-1");
    settle(&again, "the confirmed receipt", |state| {
        state.session_id.as_deref() == Some("session-1") && !state.runs.is_empty()
    });
    assert!(again.can_release());
    // Confirmation never submits a second time.
    assert_eq!(s.fake.count("POST", "/agents/runs"), 1);
}

#[test]
fn closing_a_tab_never_stops_its_run() {
    let fake = Fake::new(|r| {
        if r.path == "/agents/runs" {
            Ok(run(
                "run-1",
                r.body.as_ref().unwrap()["request_id"].as_str().unwrap(),
                "running",
                1,
            ))
        } else {
            Ok(run("run-1", "x", "running", 1))
        }
    });
    let s = setup(fake);
    let c = controller(&s.hub, "tab-1");
    c.submit("hello".into());
    settle(&c, "the running turn", CloudAgentState::running);
    drop(c);
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(s.fake.count("POST", "/agents/runs/run-1/stop"), 0);
}

#[test]
fn stop_and_approvals_target_the_exact_run_and_a_retry_keeps_its_decision() {
    let fake = Fake::new(|r| {
        let mut value = run("run-1", "req", "waiting_approval", 2);
        value["tools"] = json!([{"call_id": "call-1", "name": "bash", "input": {"command": "ls"}, "state": "waiting"}]);
        if r.path == "/agents/runs" {
            value["request_id"] = r.body.as_ref().unwrap()["request_id"].clone();
        }
        Ok(value)
    });
    let s = setup(fake);
    let c = controller(&s.hub, "tab-1");
    c.submit("hello".into());
    settle(&c, "the approval", |state| {
        !project_cloud_agent_runs(&state.runs).approvals.is_empty()
    });
    let projection = project_cloud_agent_runs(&c.snapshot().runs);
    let approval = projection.approvals[0].clone();
    assert_eq!(approval["kind"], "command");
    assert_eq!(approval["command"], "ls");
    let call = approval["requestId"].as_str().unwrap().to_string();
    c.approve(call.clone(), true);
    std::thread::sleep(Duration::from_millis(150));
    c.approve(call.clone(), true);
    std::thread::sleep(Duration::from_millis(150));
    // A different answer to the same call is refused.
    c.approve(call, false);
    std::thread::sleep(Duration::from_millis(150));
    let decisions = s.fake.bodies("/agents/runs/run-1/approvals/call-1");
    assert_eq!(decisions.len(), 2);
    assert_eq!(decisions[0]["decision_id"], decisions[1]["decision_id"]);
    assert_eq!(decisions[0]["allow"], true);
    c.stop();
    std::thread::sleep(Duration::from_millis(150));
    assert_eq!(s.fake.count("POST", "/agents/runs/run-1/stop"), 1);
}

#[test]
fn events_resume_by_sequence_a_reset_replaces_and_a_commit_publishes_once() {
    let fake = Fake::new(|r| {
        if r.path == "/agents/runs" {
            return Ok(run(
                "run-1",
                r.body.as_ref().unwrap()["request_id"].as_str().unwrap(),
                "running",
                1,
            ));
        }
        let mut done = run("run-1", "req", "succeeded", 9);
        done["publication"] = json!({"status": "committed"});
        Ok(done)
    });
    let s = setup(fake);
    let mut reset = serde_json::from_value::<Value>(run("run-1", "req", "running", 5)).unwrap();
    reset["snapshot"]["text"] = json!("partial");
    s.fake.events.lock().unwrap().push(vec![Event {
        id: 5,
        event: "reset".into(),
        data: reset,
    }]);
    let c = controller(&s.hub, "tab-1");
    c.submit("hello".into());
    settle(&c, "the finished run", |state| {
        !state.running()
            && state.session_id.is_some()
            && texts(state).iter().any(|(_, text)| text == "reply 9")
    });
    std::thread::sleep(Duration::from_millis(700));
    assert_eq!(s.published.load(Ordering::SeqCst), 1);
}

#[test]
fn one_history_request_per_agent_and_an_open_conversation_is_not_opened_twice() {
    let fake = Fake::new(|r| {
        if r.path == "/agents/sessions" {
            std::thread::sleep(Duration::from_millis(100));
            return Ok(json!([
                {"id": "session-1", "agent_id": "agent-1", "mode": "cloud_pi", "title": "First", "updated_at": "2026-10-02T00:00:00Z"},
                {"id": "session-2", "agent_id": "agent-1", "mode": "cloud_pi", "title": "Second", "updated_at": "2026-10-01T00:00:00Z"}]));
        }
        if r.path == "/agents/runs" {
            return Ok(run(
                "run-1",
                r.body.as_ref().unwrap()["request_id"].as_str().unwrap(),
                "succeeded",
                1,
            ));
        }
        if r.path.ends_with("/runs") {
            return Ok(json!([run("run-1", "req", "succeeded", 1)]));
        }
        Ok(run("run-1", "req", "succeeded", 1))
    });
    let s = setup(fake);
    let a = controller(&s.hub, "tab-a");
    a.submit("hello".into());
    settle(&a, "tab A's session", |state| {
        state.session_id.as_deref() == Some("session-1")
    });
    // Two refreshes at once: one request for the one known Agent.
    s.hub.refresh_history();
    s.hub.refresh_history();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !s.hub.history().loaded {
        assert!(
            std::time::Instant::now() < deadline,
            "the shared history did not settle"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(s.fake.count("GET", "/agents/sessions"), 1);
    let sessions = s.hub.history().sessions;
    assert_eq!(sessions.len(), 2);
    // Opening the conversation another tab shows is refused; the other one
    // opens with its runs.
    let (wake, _rx) = Wake::channel();
    let open = sessions.iter().find(|s| s.id == "session-1").cloned();
    assert!(CloudAgentController::new(s.hub.clone(), "tab-b", open, wake.clone()).is_err());
    let other = sessions.iter().find(|s| s.id == "session-2").cloned();
    let b = CloudAgentController::new(s.hub.clone(), "tab-b", other, wake).unwrap();
    assert_eq!(b.snapshot().session_id.as_deref(), Some("session-2"));
}
