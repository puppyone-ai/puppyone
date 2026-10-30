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
fn runtime(hub: &Arc<Hub>, key: &str) -> CloudAgentRuntime {
    let (wake, _rx) = Wake::channel();
    CloudAgentRuntime::new(hub.clone(), key, false, wake)
}
fn settle(rt: &mut CloudAgentRuntime, what: &str, ready: impl Fn(&SessionSnapshot) -> bool) {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        rt.poll();
        if ready(rt.snapshot()) {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "{what} did not settle"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn an_empty_tab_and_a_new_chat_send_nothing() {
    let s = setup(Fake::new(|_| Ok(json!({}))));
    let mut rt = runtime(&s.hub, "tab-1");
    std::thread::sleep(Duration::from_millis(300));
    rt.poll();
    rt.new_thread();
    std::thread::sleep(Duration::from_millis(200));
    rt.poll();
    assert!(s.fake.requests.lock().unwrap().is_empty());
    assert_eq!(s.fake.event_reads.load(Ordering::SeqCst), 0);
    assert_eq!(rt.snapshot().runtime, LABEL);
    assert!(rt.snapshot().messages.is_empty());
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
    let mut rt = runtime(&s.hub, "tab-1");
    rt.send("hello".into());
    settle(&mut rt, "the lost receipt", |snap| snap.error.is_some());
    // The tab keeps its unconfirmed submission.
    assert!(!rt.can_release());
    // Another message waits for this one.
    rt.send("something else".into());
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
    rt.send("hello".into());
    settle(&mut rt, "the confirmed run", |snap| {
        snap.thread.as_deref() == Some("session-1")
    });
    let bodies = s.fake.bodies("/agents/runs");
    assert_eq!(bodies.len(), 2);
    assert_eq!(bodies[0]["request_id"], bodies[1]["request_id"]);
    assert_eq!(s.fake.count("GET", "/agents/requests/project-a/"), 1);
    assert!(rt.can_release());
    let texts: Vec<_> = rt
        .snapshot()
        .messages
        .iter()
        .map(|m| (m.role.clone(), m.text.clone()))
        .collect();
    assert!(texts.contains(&("You".into(), "hello".into())));
    assert!(texts.contains(&(LABEL.into(), "reply 3".into())));
}

#[test]
fn a_definite_refusal_forgets_the_submission() {
    let s = setup(Fake::new(|_| Err(status(422))));
    let mut rt = runtime(&s.hub, "tab-1");
    rt.send("hello".into());
    settle(&mut rt, "the refusal", |snap| snap.error.is_some());
    settle(&mut rt, "the release", |_| true);
    assert!(rt.can_release());
}

#[test]
fn a_pending_receipt_survives_a_restart_and_is_confirmed_on_load() {
    let s = setup(Fake::new(|_| Err(lost())));
    let mut first = runtime(&s.hub, "tab-1");
    first.send("hello".into());
    settle(&mut first, "the lost receipt", |snap| snap.error.is_some());
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
    let mut again = runtime(&s.hub, "tab-1");
    settle(&mut again, "the confirmed receipt", |snap| {
        snap.thread.as_deref() == Some("session-1") && !snap.messages.is_empty()
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
    let mut rt = runtime(&s.hub, "tab-1");
    rt.send("hello".into());
    settle(&mut rt, "the running turn", |snap| {
        snap.state == State::Running
    });
    drop(rt);
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
    let mut rt = runtime(&s.hub, "tab-1");
    rt.send("hello".into());
    settle(&mut rt, "the approval", |snap| {
        !snap.interactions.is_empty()
    });
    let interaction = rt.snapshot().interactions[0].clone();
    assert!(matches!(
        interaction.kind,
        InteractionKind::Approval { command: true, .. }
    ));
    rt.resolve(&interaction.id, Resolution::Approval(Decision::Accept));
    std::thread::sleep(Duration::from_millis(150));
    rt.resolve(&interaction.id, Resolution::Approval(Decision::Accept));
    std::thread::sleep(Duration::from_millis(150));
    // A different answer to the same call is refused.
    rt.resolve(&interaction.id, Resolution::Approval(Decision::Decline));
    std::thread::sleep(Duration::from_millis(150));
    let decisions = s.fake.bodies("/agents/runs/run-1/approvals/call-1");
    assert_eq!(decisions.len(), 2);
    assert_eq!(decisions[0]["decision_id"], decisions[1]["decision_id"]);
    assert_eq!(decisions[0]["allow"], true);
    rt.stop();
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
    let mut rt = runtime(&s.hub, "tab-1");
    rt.send("hello".into());
    settle(&mut rt, "the finished run", |snap| {
        snap.state == State::Idle
            && snap.thread.is_some()
            && snap.messages.iter().any(|m| m.text == "reply 9")
    });
    std::thread::sleep(Duration::from_millis(700));
    assert_eq!(s.published.load(Ordering::SeqCst), 1);
}

#[test]
fn one_history_request_per_agent_and_open_conversations_are_not_offered() {
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
    let mut a = runtime(&s.hub, "tab-a");
    a.send("hello".into());
    settle(&mut a, "tab A's session", |snap| {
        snap.thread.as_deref() == Some("session-1")
    });
    let mut b = runtime(&s.hub, "tab-b");
    // Two tabs refresh at once: one request for the one known Agent.
    a.list_history();
    b.list_history();
    settle(&mut b, "the shared history", |snap| {
        !snap.history.is_empty()
    });
    assert_eq!(s.fake.count("GET", "/agents/sessions"), 1);
    let offered: Vec<_> = b.snapshot().history.iter().map(|h| h.id.clone()).collect();
    assert_eq!(offered, vec!["session-2".to_string()]);
    // Resuming the open one is refused; the other opens with its runs.
    b.resume("session-1".into());
    settle(&mut b, "the refusal", |snap| {
        snap.error.is_some() && !snap.history_mode
    });
    assert_eq!(b.snapshot().thread, None);
}
