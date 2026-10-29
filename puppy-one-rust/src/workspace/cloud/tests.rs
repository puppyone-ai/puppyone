//! Real loopback HTTP + streaming fixtures with synthetic auth and injected
//! memory storage. Never a native vault, hosted project, browser or deployment.
use super::*;
use crate::cloud_auth::{self as auth, Environment};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Condvar, Mutex,
        atomic::{AtomicBool, AtomicUsize},
        mpsc,
    },
    thread,
};
const GENERATION: &str = "9bb16f54-dfe9-4d26-8c68-c7b1ae97d859";

fn opening_row(state: &str) -> Value {
    json!({"id":"workspace-a","project_id":"project-a","generation":GENERATION,"state":state,"operation":null})
}
fn explicit_open(
    f: &Fixture,
    cancel: &Cancellation,
    progress: impl FnMut(opening::Phase),
) -> std::result::Result<Prepared, opening::Failure> {
    opening::prepare(
        f.broker.clone(),
        f.binding.clone(),
        Target::ProjectRoot {
            project_id: "project-a".into(),
        },
        cancel,
        false,
        progress,
    )
}

#[test]
fn explicit_opening_reuses_running_workbench_and_reads_files_before_handoff() {
    let f = Fixture::new();
    let mut phases = Vec::new();
    let prepared = explicit_open(&f, &Cancellation::default(), |p| phases.push(p)).unwrap();
    let (workspace, root) = prepared.into_parts().unwrap();
    assert_eq!(
        phases,
        vec![opening::Phase::Checking, opening::Phase::Files]
    );
    assert!(!root.is_empty());
    assert!(workspace.local_root().is_none());
    assert_eq!(f.state.count("POST", "/workbench"), 0);
    assert_eq!(f.state.count("GET", "/workbench"), 1);
    assert_eq!(f.state.count("GET", "/files"), 1);
}

#[test]
fn explicit_opening_wakes_once_and_only_observes_pending_operation() {
    let f = Fixture::new();
    f.state
        .opening_status
        .lock()
        .unwrap()
        .extend([opening_row("paused"), opening_row("running")]);
    let mut pending = opening_row("starting");
    pending["operation"] = json!({"pending":true,"deadline":null,"error":null,"retryable":true});
    *f.state.opening_reply.lock().unwrap() = Some(pending);
    let mut phases = Vec::new();
    let prepared = explicit_open(&f, &Cancellation::default(), |p| phases.push(p)).unwrap();
    assert_eq!(
        phases,
        vec![
            opening::Phase::Checking,
            opening::Phase::Connecting,
            opening::Phase::Files
        ]
    );
    assert_eq!(f.state.count("POST", "/workbench"), 1);
    assert_eq!(f.state.count("GET", "/workbench"), 2);
    assert!(
        f.state
            .requests
            .lock()
            .unwrap()
            .iter()
            .any(|(m, p)| m == "GET" && p.ends_with("workbench?wait_seconds=20"))
    );
    assert!(prepared.into_parts().is_ok());
}

#[test]
fn explicit_opening_recovery_and_access_denial_never_wake() {
    for retained in ["retained", "cleanup_pending"] {
        let f = Fixture::new();
        *f.state.runtime.lock().unwrap() = Some(opening_row(retained));
        let error = explicit_open(&f, &Cancellation::default(), |_| {})
            .err()
            .unwrap();
        assert_eq!(error.code, "workspace-recovery-required");
        assert_eq!(error.recovery, opening::Recovery::None);
        assert_eq!(f.state.count("POST", "/workbench"), 0);
    }
    let f = Fixture::new();
    *f.state.context.lock().unwrap() = Some(
        json!({"target":{"kind":"project_root","project_id":"project-a"},"project":{"id":"project-a","name":"Fixture","capabilities":[]},"scope_path":null}),
    );
    assert_eq!(
        explicit_open(&f, &Cancellation::default(), |_| {})
            .err()
            .unwrap()
            .recovery,
        opening::Recovery::None
    );
    assert_eq!(f.state.count("GET", "/workbench"), 0);
}

#[test]
fn explicit_opening_generation_replacement_and_deadline_fail_before_files() {
    for expired in [false, true] {
        let f = Fixture::new();
        let mut replaced = opening_row("running");
        replaced["generation"] = json!(uuid::Uuid::new_v4().to_string());
        f.state
            .opening_status
            .lock()
            .unwrap()
            .extend([opening_row("paused"), replaced]);
        let mut pending = opening_row("starting");
        pending["operation"] = json!({"pending":true,"deadline":if expired {Some("2000-01-01T00:00:00Z")} else {None},"error":null,"retryable":true});
        *f.state.opening_reply.lock().unwrap() = Some(pending);
        assert!(explicit_open(&f, &Cancellation::default(), |_| {}).is_err());
        assert_eq!(f.state.count("GET", "/files"), 0);
        assert_eq!(f.state.count("POST", "/workbench"), 1);
        assert_eq!(
            f.state.count("GET", "/workbench"),
            if expired { 1 } else { 2 }
        );
    }
}

#[test]
fn explicit_opening_cancelled_at_files_cannot_deliver_a_provider() {
    let f = Fixture::new();
    let cancel = Cancellation::default();
    let result = explicit_open(&f, &cancel, |phase| {
        if phase == opening::Phase::Files {
            cancel.cancel()
        }
    });
    assert!(result.is_err());
    assert_eq!(f.state.count("GET", "/files"), 0);
}

struct Gate {
    held: AtomicBool,
    arrived: AtomicUsize,
    lock: Mutex<()>,
    changed: Condvar,
}
impl Gate {
    fn new() -> Self {
        Self {
            held: AtomicBool::new(false),
            arrived: AtomicUsize::new(0),
            lock: Mutex::new(()),
            changed: Condvar::new(),
        }
    }
    fn block(&self, stop: &AtomicBool) {
        self.arrived.fetch_add(1, Ordering::SeqCst);
        let mut lock = self.lock.lock().unwrap();
        while self.held.load(Ordering::SeqCst) && !stop.load(Ordering::SeqCst) {
            lock = self
                .changed
                .wait_timeout(lock, Duration::from_millis(10))
                .unwrap()
                .0;
        }
    }
    fn release(&self) {
        self.held.store(false, Ordering::SeqCst);
        self.changed.notify_all();
    }
}
struct State {
    files: Mutex<BTreeMap<String, Option<Vec<u8>>>>,
    requests: Mutex<Vec<(String, String)>>,
    streams: Mutex<HashMap<usize, mpsc::Sender<String>>>,
    stream_count: AtomicUsize,
    read: Gate,
    write: Gate,
    stop: AtomicBool,
    readonly: AtomicBool,
    denied: AtomicBool,
    drop_write_reply: AtomicBool,
    stream_disconnects: AtomicUsize,
    stream_401: AtomicUsize,
    stream_wrong_type: AtomicBool,
    expires: AtomicUsize,
    file_failure: Mutex<Option<(u16, &'static str)>>,
    context: Mutex<Option<Value>>,
    runtime: Mutex<Option<Value>>,
    opening_status: Mutex<std::collections::VecDeque<Value>>,
    opening_reply: Mutex<Option<Value>>,
    file_reply: Mutex<Option<Value>>,
}
impl State {
    fn new() -> Self {
        Self {
            files: Mutex::new(BTreeMap::from([
                ("live.md".into(), Some(b"live before Git\n".to_vec())),
                ("image.png".into(), Some(vec![137, 80, 78, 71, 0, 255])),
            ])),
            requests: Mutex::new(Vec::new()),
            streams: Mutex::new(HashMap::new()),
            stream_count: AtomicUsize::new(0),
            read: Gate::new(),
            write: Gate::new(),
            stop: AtomicBool::new(false),
            readonly: AtomicBool::new(false),
            denied: AtomicBool::new(false),
            drop_write_reply: AtomicBool::new(false),
            stream_disconnects: AtomicUsize::new(0),
            stream_401: AtomicUsize::new(0),
            stream_wrong_type: AtomicBool::new(false),
            expires: AtomicUsize::new(3600),
            file_failure: Mutex::new(None),
            context: Mutex::new(None),
            runtime: Mutex::new(None),
            opening_status: Mutex::default(),
            opening_reply: Mutex::new(None),
            file_reply: Mutex::new(None),
        }
    }
    fn count(&self, method: &str, suffix: &str) -> usize {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|(m, p)| m == method && p.split('?').next().unwrap().ends_with(suffix))
            .count()
    }
    fn event(&self, value: &str) {
        for sender in self.streams.lock().unwrap().values() {
            let _ = sender.send(value.into());
        }
    }
    fn reset(&self) {
        self.event(&format!(
            "event: change\r\ndata: {{\"generation\":\"{GENERATION}\",\"reset\":true}}\r\n\r\n"
        ));
    }
}
struct Fixture {
    state: Arc<State>,
    broker: Arc<Broker>,
    binding: Binding,
    server: Option<thread::JoinHandle<()>>,
}
impl Fixture {
    fn new() -> Self {
        Self::with_expiry(3600)
    }
    fn with_expiry(expires: usize) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let environment = Environment::new(&format!("{origin}/api/v1"), &origin).unwrap();
        let state = Arc::new(State::new());
        state.expires.store(expires, Ordering::SeqCst);
        let shared = state.clone();
        let server = thread::spawn(move || {
            let mut threads = Vec::new();
            while !shared.stop.load(Ordering::SeqCst) {
                if let Ok((stream, _)) = listener.accept() {
                    let state = shared.clone();
                    let origin = origin.clone();
                    threads.push(thread::spawn(move || connection(stream, state, &origin)));
                } else {
                    thread::sleep(Duration::from_millis(2));
                }
            }
            for child in threads {
                let _ = child.join();
            }
        });
        let (broker, binding) = auth::protocol_fixture(environment);
        Self {
            state,
            broker,
            binding,
            server: Some(server),
        }
    }
    fn prepare(&self) -> Result<Prepared> {
        prepare_running(
            self.broker.clone(),
            self.binding.clone(),
            Target::ProjectRoot {
                project_id: "project-a".into(),
            },
            &Cancellation::default(),
        )
    }
    fn open(&self) -> Arc<Workspace> {
        self.scoped().0
    }
    fn scoped(&self) -> (Arc<Workspace>, Arc<Shared>) {
        let prepared = self.prepare().unwrap();
        let shared = prepared.shared.clone();
        (prepared.into_parts().unwrap().0, shared)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.state.stop.store(true, Ordering::SeqCst);
        self.state.read.release();
        self.state.write.release();
        let _ = self.server.take().unwrap().join();
    }
}
fn reply(stream: &mut TcpStream, status: u16, value: Value) {
    let body = value.to_string();
    let _ = write!(
        stream,
        "HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}
fn failure(stream: &mut TcpStream, status: u16, code: &str) {
    reply(
        stream,
        status,
        json!({"code":status,"message":"upstream-private-detail", "data":{"code":code}}),
    );
}
fn connection(mut stream: TcpStream, state: Arc<State>, origin: &str) {
    // macOS can inherit O_NONBLOCK from the listening socket.
    stream.set_nonblocking(false).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    stream
        .set_write_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let mut raw = Vec::new();
    let (method, raw_path, authorized, body) = loop {
        let mut part = [0; 16384];
        let Ok(n) = stream.read(&mut part) else {
            return;
        };
        if n == 0 {
            return;
        }
        raw.extend_from_slice(&part[..n]);
        assert!(raw.len() < 13 * 1024 * 1024);
        let mut headers = [httparse::EMPTY_HEADER; 32];
        let mut request = httparse::Request::new(&mut headers);
        let Ok(httparse::Status::Complete(offset)) = request.parse(&raw) else {
            continue;
        };
        let length = request
            .headers
            .iter()
            .find(|h| h.name.eq_ignore_ascii_case("content-length"))
            .map(|h| {
                std::str::from_utf8(h.value)
                    .unwrap()
                    .parse::<usize>()
                    .unwrap()
            })
            .unwrap_or(0);
        if raw.len() < offset + length {
            continue;
        }
        let body = if length == 0 {
            Value::Null
        } else {
            serde_json::from_slice(&raw[offset..offset + length]).unwrap()
        };
        break (
            request.method.unwrap().to_owned(),
            request.path.unwrap().to_owned(),
            request.headers.iter().any(|h| {
                h.name.eq_ignore_ascii_case("authorization")
                    && h.value == b"Bearer synthetic-access"
            }),
            body,
        );
    };
    state
        .requests
        .lock()
        .unwrap()
        .push((method.clone(), raw_path.clone()));
    let url = url::Url::parse(&format!("{origin}{raw_path}")).unwrap();
    let path = url.path();
    if path == "/api/v1/auth/config" {
        reply(
            &mut stream,
            200,
            json!({"supabase_url":origin,"supabase_anon_key":"sb_publishable_fixture"}),
        );
        return;
    }
    if path == "/auth/v1/token" {
        reply(
            &mut stream,
            200,
            json!({"access_token":"synthetic-access","refresh_token":"synthetic-refresh","expires_in":state.expires.load(Ordering::SeqCst),"user":{"id":"fixture-user","email":"fixture@example.test"}}),
        );
        return;
    }
    if path == "/auth/v1/logout" || path == "/api/v1/auth/initialize" {
        reply(&mut stream, 200, json!({}));
        return;
    }
    assert!(authorized);
    assert!(!raw_path.contains("synthetic"));
    if path.ends_with("/repository-context") {
        assert!(
            String::from_utf8_lossy(&raw)
                .to_ascii_lowercase()
                .contains("\r\nx-puppyone-repository-contract: 2\r\n")
        );
        assert_eq!(method, "POST");
        assert_eq!(
            body["target"],
            json!({"kind":"project_root","project_id":"project-a"})
        );
        let capabilities = if state.readonly.load(Ordering::SeqCst) {
            vec!["content.read"]
        } else {
            vec!["content.read", "content.write"]
        };
        let value = state.context.lock().unwrap().clone().unwrap_or_else(|| json!({"target":{"kind":"project_root","project_id":"project-a"},"project":{"id":"project-a","name":"Fixture","capabilities":capabilities},"scope_path":null}));
        reply(&mut stream, 200, json!({"code":0,"data":value}));
        return;
    }
    if path.ends_with("/workbench") {
        if method == "POST" {
            let value = state
                .opening_reply
                .lock()
                .unwrap()
                .clone()
                .expect("only explicit opening fixtures permit wake");
            reply(&mut stream, 200, value);
            return;
        }
        assert_eq!(method, "GET", "provider must never allocate/wake compute");
        let value = state.opening_status.lock().unwrap().pop_front().or_else(|| state.runtime.lock().unwrap().clone()).unwrap_or_else(|| json!({"id":"workspace-a","project_id":"project-a","generation":GENERATION,"state":"running","target_ref":"refs/heads/main"}));
        reply(&mut stream, 200, json!({"workspace":value}));
        return;
    }
    let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(
        query.get("generation").map(String::as_str),
        Some(GENERATION)
    );
    if state.denied.load(Ordering::SeqCst) {
        failure(&mut stream, 403, "access_denied");
        return;
    }
    if let Some((status, code)) = *state.file_failure.lock().unwrap() {
        failure(&mut stream, status, code);
        return;
    }
    if path.ends_with("/events") {
        if state
            .stream_401
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            .is_ok()
        {
            failure(&mut stream, 401, "unauthorized");
            return;
        }
        if state.stream_wrong_type.load(Ordering::SeqCst) {
            reply(&mut stream, 200, json!({"not":"SSE"}));
            return;
        }
        let id = state.stream_count.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        state.streams.lock().unwrap().insert(id, tx);
        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nConnection: close\r\n\r\n");
        let _ = write!(
            stream,
            "event: change\ndata: {{\"generation\":\"{GENERATION}\",\"reset\":true}}\n\n"
        );
        if state
            .stream_disconnects
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            .is_err()
        {
            while !state.stop.load(Ordering::SeqCst) {
                let value = rx
                    .recv_timeout(Duration::from_millis(10))
                    .unwrap_or_else(|_| ": keepalive\n\n".into());
                if stream.write_all(value.as_bytes()).is_err() {
                    break;
                }
            }
        }
        state.streams.lock().unwrap().remove(&id);
        return;
    }
    let name = query.get("path").cloned().unwrap_or_default();
    if method == "GET" && path.ends_with("/file") {
        let file = state.files.lock().unwrap().get(&name).cloned();
        state.read.block(&state.stop);
        let Some(Some(bytes)) = file else {
            failure(&mut stream, 404, "file_not_found");
            return;
        };
        let value = state.file_reply.lock().unwrap().clone().unwrap_or_else(|| json!({"name":Path::new(&name).file_name().unwrap().to_str().unwrap(),"kind":"file","size":bytes.len(),"content_base64":STANDARD.encode(&bytes),"revision":model::digest(&bytes)}));
        reply(&mut stream, 200, value);
        return;
    }
    if method == "GET" && path.ends_with("/files") {
        let values: Vec<_> = state.files.lock().unwrap().iter().filter(|(p,_)| Path::new(p).parent() == Some(Path::new(&name))).map(|(p,b)| json!({"name":Path::new(p).file_name().unwrap().to_str().unwrap(),"kind":if b.is_some(){"file"}else{"directory"},"size":b.as_ref().map_or(0,Vec::len)})).collect();
        reply(&mut stream, 200, json!({"entries":values}));
        return;
    }
    if method == "PUT" && path.ends_with("/file") {
        state.write.block(&state.stop);
        let name = body["path"].as_str().unwrap();
        let bytes = STANDARD
            .decode(body["content_base64"].as_str().unwrap())
            .unwrap();
        let mut files = state.files.lock().unwrap();
        match (files.get(name), body["expected_revision"].as_str()) {
            (None, Some(_)) => {
                failure(&mut stream, 404, "file_not_found");
                return;
            }
            (Some(_), None) => {
                failure(&mut stream, 409, "file_conflict");
                return;
            }
            (Some(Some(old)), Some(version)) if model::digest(old) != version => {
                failure(&mut stream, 409, "file_conflict");
                return;
            }
            _ => {}
        }
        let value = json!({"size":bytes.len(),"revision":model::digest(&bytes)});
        files.insert(name.into(), Some(bytes));
        if !state.drop_write_reply.load(Ordering::SeqCst) {
            reply(&mut stream, 200, value);
        }
        return;
    }
    if method == "POST" && path.ends_with("/files") {
        let name = body["path"].as_str().unwrap();
        let mut files = state.files.lock().unwrap();
        match body["action"].as_str().unwrap() {
            "mkdir" => {
                if files.contains_key(name) {
                    failure(&mut stream, 409, "file_conflict");
                    return;
                }
                files.insert(name.into(), None);
            }
            "remove" => {
                if files.remove(name).is_none() {
                    failure(&mut stream, 404, "file_not_found");
                    return;
                }
                files.retain(|p, _| !Path::new(p).starts_with(name));
            }
            "move" => {
                let dest = body["destination"].as_str().unwrap();
                if files.contains_key(dest) {
                    failure(&mut stream, 409, "file_conflict");
                    return;
                }
                let Some(value) = files.remove(name) else {
                    failure(&mut stream, 404, "file_not_found");
                    return;
                };
                files.insert(dest.into(), value);
            }
            action => panic!("unexpected action {action}"),
        }
        reply(&mut stream, 200, json!({}));
        return;
    }
    panic!("unexpected protocol request {method} {path}");
}
fn wait(mut ready: impl FnMut() -> bool) {
    let until = Instant::now() + Duration::from_secs(8);
    while !ready() {
        assert!(Instant::now() < until, "fixture did not settle");
        thread::sleep(Duration::from_millis(5));
    }
}
fn p(name: &str) -> &Path {
    Path::new(name)
}
fn subscription(ws: &Workspace) -> (super::super::Subscription, Arc<AtomicUsize>) {
    let count = Arc::new(AtomicUsize::new(0));
    let c = count.clone();
    (
        ws.watch_root(Arc::new(move || {
            c.fetch_add(1, Ordering::SeqCst);
        }))
        .unwrap(),
        count,
    )
}

#[test]
fn live_files_share_the_facade_without_a_local_root_or_git_fallback() {
    let f = Fixture::new();
    let ws = f.open();
    assert!(ws.local_root().is_none());
    assert_eq!(ws.text_limit(), 8 * 1024 * 1024);
    let doc = ws.read(p("live.md")).unwrap();
    assert_eq!(doc.text, "live before Git\n");
    let saved = ws.save(&doc, "native live change\n").unwrap();
    assert!(!saved.updated);
    assert_eq!(saved.document.text, "native live change\n");
    assert_eq!(
        f.state.files.lock().unwrap()["live.md"],
        Some(b"native live change\n".to_vec())
    );
    let preview = ws.resource(p("image.png")).unwrap();
    assert!(
        matches!(preview.data().unwrap(),PreviewData::Bytes { bytes, .. } if bytes.as_ref()==[137,80,78,71,0,255])
    );
    assert!(
        !ws.capabilities().copy && !ws.capabilities().import && !ws.capabilities().local_actions
    );
    assert!(ws.absolute(p("live.md")).is_err());
    assert_eq!(f.state.count("POST", "/workbench"), 0);
    assert!(
        f.state
            .requests
            .lock()
            .unwrap()
            .iter()
            .all(|(_, p)| !p.contains("/git/") && !p.contains("/content"))
    );
}
#[test]
fn mutations_are_no_clobber_and_cas_returns_remote_bytes_without_replaying() {
    let f = Fixture::new();
    let ws = f.open();
    let old = ws.read(p("live.md")).unwrap();
    f.state
        .files
        .lock()
        .unwrap()
        .insert("live.md".into(), Some(b"agent edit\n".to_vec()));
    let rejected = ws.save(&old, "draft").unwrap();
    assert!(rejected.updated);
    assert_eq!(rejected.document.text, "agent edit\n");
    assert_eq!(f.state.count("PUT", "/file"), 1);
    assert_eq!(
        ws.create_entry(p(""), "live.md", false, "overwrite")
            .unwrap_err()
            .kind,
        ErrorKind::AlreadyExists
    );
    ws.create_entry(p(""), "folder", true, "").unwrap();
    ws.create_entry(p(""), "new.md", false, "new").unwrap();
    ws.rename_entry(p("new.md"), "renamed.md").unwrap();
    ws.move_entry(p("renamed.md"), p("folder")).unwrap();
    assert_eq!(ws.list(p("folder")).unwrap().len(), 1);
    ws.remove_entry(p("folder/renamed.md")).unwrap();
    assert_eq!(
        ws.read(p("folder/renamed.md")).unwrap_err().kind,
        ErrorKind::NotFound
    );
}
#[test]
fn exact_authorized_root_and_running_generation_are_required_before_handoff() {
    let f = Fixture::new();
    let before = f.state.requests.lock().unwrap().len();
    assert!(
        prepare_running(
            f.broker.clone(),
            f.binding.clone(),
            Target::Scope {
                project_id: "project-a".into(),
                scope_id: "scope".into()
            },
            &Cancellation::default()
        )
        .is_err()
    );
    assert_eq!(f.state.requests.lock().unwrap().len(), before);
    for context in [
        json!({"target":{"kind":"project_root","project_id":"other"},"project":{"id":"project-a","name":"x","capabilities":["content.read"]}}),
        json!({"target":{"kind":"project_root","project_id":"project-a"},"project":{"id":"other","name":"x","capabilities":["content.read"]}}),
        json!({"target":{"kind":"project_root","project_id":"project-a"},"project":{"id":"project-a","name":"x","capabilities":[]}}),
        json!({"target":{"kind":"project_root","project_id":"project-a"},"project":{"id":"project-a","name":"x","capabilities":["content.read"]},"scope_path":"private"}),
    ] {
        *f.state.context.lock().unwrap() = Some(context);
        assert!(f.prepare().is_err());
    }
    *f.state.context.lock().unwrap() = None;
    for state in ["pending", "retained", "cleanup_pending", "error"] {
        *f.state.runtime.lock().unwrap() = Some(
            json!({"id":"workspace-a","project_id":"project-a","generation":GENERATION,"state":state}),
        );
        assert!(f.prepare().is_err());
    }
    *f.state.runtime.lock().unwrap() = None;
    f.state.denied.store(true, Ordering::SeqCst);
    assert!(f.prepare().is_err());
    assert_eq!(f.state.count("POST", "/workbench"), 0);
}
#[test]
fn readonly_grants_and_invalid_paths_fail_before_mutation_dispatch() {
    let f = Fixture::new();
    f.state.readonly.store(true, Ordering::SeqCst);
    let ws = f.open();
    let doc = ws.read(p("live.md")).unwrap();
    assert_eq!(ws.save(&doc, "x").unwrap_err().kind, ErrorKind::Unsupported);
    assert!(ws.create_entry(p(""), "x", false, "").is_err());
    for path in [
        "/absolute",
        "../escape",
        "a/../b",
        ".git/config",
        "a\\b",
        "C:drive",
    ] {
        assert!(ws.read(p(path)).is_err(), "{path}");
    }
    assert_eq!(f.state.count("PUT", "/file"), 0);
}
#[test]
fn content_integrity_and_foreign_revisions_fail_closed() {
    let f = Fixture::new();
    let ws = f.open();
    let doc = ws.read(p("live.md")).unwrap();
    for field in ["name", "kind", "size", "revision", "content_base64"] {
        let bytes = b"x";
        let mut value = json!({"name":"live.md","kind":"file","size":1,"revision":model::digest(bytes),"content_base64":STANDARD.encode(bytes)});
        value[field] = json!("wrong");
        *f.state.file_reply.lock().unwrap() = Some(value);
        assert!(ws.read(p("live.md")).is_err(), "{field}");
    }
    *f.state.file_reply.lock().unwrap() = None;
    let mut revision = doc.revision.clone();
    revision.0 = revision
        .0
        .replace(GENERATION, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert!(
        ws.provider
            .write(&RelativePath::new(p("live.md")).unwrap(), &revision, "bad")
            .is_err()
    );
    assert!(
        ws.provider
            .write(
                &RelativePath::new(p("other.md")).unwrap(),
                &doc.revision,
                "bad"
            )
            .is_err()
    );
    assert_eq!(f.state.count("PUT", "/file"), 0);
}
#[test]
fn cloud_text_limit_and_original_bom_crlf_are_preserved() {
    let f = Fixture::new();
    f.state.files.lock().unwrap().insert(
        "live.md".into(),
        Some(b"\xef\xbb\xbfone\r\ntwo\r\n".to_vec()),
    );
    let ws = f.open();
    let doc = ws.read(p("live.md")).unwrap();
    assert_eq!(doc.text, "one\ntwo\n");
    ws.save(&doc, "new\n").unwrap();
    assert_eq!(
        f.state.files.lock().unwrap()["live.md"],
        Some(b"\xef\xbb\xbfnew\r\n".to_vec())
    );
    let large = "x".repeat(8 * 1024 * 1024);
    ws.create_entry(p(""), "large.txt", false, &large).unwrap();
    let doc = ws.read(p("large.txt")).unwrap();
    assert_eq!(doc.text.len(), large.len());
    let count = f.state.count("PUT", "/file");
    assert!(ws.save(&doc, &"x".repeat(8 * 1024 * 1024 + 1)).is_err());
    assert_eq!(f.state.count("PUT", "/file"), count);
}
#[test]
fn uncertain_write_is_never_replayed_or_reported_as_not_written() {
    let f = Fixture::new();
    let ws = f.open();
    let doc = ws.read(p("live.md")).unwrap();
    f.state.drop_write_reply.store(true, Ordering::SeqCst);
    assert_eq!(
        ws.save(&doc, "possibly committed").unwrap_err().kind,
        ErrorKind::OutcomeUnknown
    );
    assert_eq!(f.state.count("PUT", "/file"), 1);
    assert_eq!(
        f.state.files.lock().unwrap()["live.md"],
        Some(b"possibly committed".to_vec())
    );
}
#[test]
fn lease_revocation_interrupts_reads_and_rejects_late_mutation_receipts() {
    for mutation in [false, true] {
        let f = Fixture::new();
        let ws = f.open();
        let doc = ws.read(p("live.md")).unwrap();
        let gate = if mutation {
            &f.state.write
        } else {
            &f.state.read
        };
        let initial = gate.arrived.load(Ordering::SeqCst);
        gate.held.store(true, Ordering::SeqCst);
        let worker = ws.clone();
        let task = thread::spawn(move || {
            if mutation {
                worker.save(&doc, "late").map(|_| ())
            } else {
                worker.read(p("live.md")).map(|_| ())
            }
        });
        wait(|| gate.arrived.load(Ordering::SeqCst) > initial);
        ws.revoke();
        wait(|| task.is_finished());
        let error = task.join().unwrap().unwrap_err();
        assert_eq!(
            error.kind,
            if mutation {
                ErrorKind::OutcomeUnknown
            } else {
                ErrorKind::StaleLease
            }
        );
        gate.release();
        assert!(ws.read(p("live.md")).is_err());
        assert_eq!(f.state.count("PUT", "/file"), usize::from(mutation));
    }
}
#[test]
fn preview_authority_is_not_a_snapshot_boolean_and_handles_are_independent() {
    let f = Fixture::new();
    let first = f.open();
    let second = f.open();
    let a = first.read(p("live.md")).unwrap();
    let b = second.read(p("live.md")).unwrap();
    assert_eq!(a.identity, b.identity);
    let preview = first.resource(p("image.png")).unwrap();
    first.revoke();
    assert!(preview.data().is_err());
    assert!(second.read(p("live.md")).is_ok());
    let preview = second.resource(p("image.png")).unwrap();
    f.broker.sign_out();
    wait(|| f.broker.subscribe().borrow().account.is_none());
    assert!(preview.data().is_err());
    assert!(second.read(p("live.md")).is_err());
}
#[test]
fn permission_loss_revokes_previously_acquired_preview_access() {
    for code in ["access_denied", "file_conflict", "file_not_found"] {
        let f = Fixture::new();
        let ws = f.open();
        let preview = ws.resource(p("image.png")).unwrap();
        *f.state.file_failure.lock().unwrap() = Some((403, code));
        assert!(ws.read(p("live.md")).is_err());
        assert!(preview.data().is_err());
    }
}
#[test]
fn concurrent_reads_coalesce_and_invalidation_fences_an_old_result() {
    let f = Fixture::new();
    let (ws, shared) = f.scoped();
    f.state.read.held.store(true, Ordering::SeqCst);
    let barrier = Arc::new(std::sync::Barrier::new(9));
    let mut tasks = Vec::new();
    for _ in 0..8 {
        let ws = ws.clone();
        let barrier = barrier.clone();
        tasks.push(thread::spawn(move || {
            barrier.wait();
            ws.read(p("live.md"))
        }));
    }
    barrier.wait();
    wait(|| f.state.read.arrived.load(Ordering::SeqCst) == 1);
    thread::sleep(Duration::from_millis(75));
    assert_eq!(f.state.count("GET", "/file"), 1);
    f.state.read.release();
    for task in tasks {
        assert!(task.join().unwrap().is_ok());
    }
    let (watch, count) = subscription(&ws);
    wait(|| shared.epoch.load(Ordering::SeqCst) >= 2);
    let _ = watch.next();
    f.state.read.held.store(true, Ordering::SeqCst);
    let worker = ws.clone();
    let task = thread::spawn(move || worker.read(p("live.md")));
    wait(|| f.state.read.arrived.load(Ordering::SeqCst) >= 2);
    let before = count.load(Ordering::SeqCst);
    f.state.reset();
    wait(|| count.load(Ordering::SeqCst) > before);
    f.state.read.release();
    assert!(task.join().unwrap().is_err());
    assert!(ws.read(p("live.md")).is_ok());
}
#[test]
fn document_and_tree_subscriptions_share_one_stream_and_last_drop_stops_it() {
    let f = Fixture::new();
    let (ws, shared) = f.scoped();
    let doc = ws.read(p("live.md")).unwrap();
    let (root, count) = subscription(&ws);
    wait(|| shared.epoch.load(Ordering::SeqCst) >= 2);
    let document = ws.watch(&doc, Arc::new(|| {})).unwrap();
    assert_eq!(f.state.stream_count.load(Ordering::SeqCst), 1);
    let _ = root.next();
    let _ = document.next();
    let epoch = shared.epoch.load(Ordering::SeqCst);
    let before = count.load(Ordering::SeqCst);
    for _ in 0..20 {
        f.state.reset();
    }
    wait(|| shared.epoch.load(Ordering::SeqCst) >= epoch + 20);
    assert_eq!(
        count.load(Ordering::SeqCst),
        before + 1,
        "one wake per unconsumed slot, not per frame"
    );
    assert!(matches!(root.next(), Some(WatchEvent::Invalidated)));
    assert!(root.next().is_none());
    assert!(matches!(document.next(), Some(WatchEvent::Invalidated)));
    drop(root);
    assert_eq!(f.state.streams.lock().unwrap().len(), 1);
    drop(document);
    wait(|| f.state.streams.lock().unwrap().is_empty());
    let (_next, _) = subscription(&ws);
    wait(|| shared.epoch.load(Ordering::SeqCst) >= epoch + 22);
    assert_eq!(f.state.stream_count.load(Ordering::SeqCst), 2);
}
#[test]
fn reconnect_revalidates_without_wake_and_wrong_generation_retires_the_lease() {
    let f = Fixture::new();
    f.state.stream_disconnects.store(1, Ordering::SeqCst);
    let (ws, shared) = f.scoped();
    let preview = ws.resource(p("image.png")).unwrap();
    let (watch, _) = subscription(&ws);
    wait(|| {
        f.state.stream_count.load(Ordering::SeqCst) >= 2 && shared.epoch.load(Ordering::SeqCst) >= 5
    });
    assert!(ws.read(p("live.md")).is_ok());
    assert_eq!(f.state.count("POST", "/workbench"), 0);
    f.state
        .event("event: change\ndata: {\"generation\":\"replacement\",\"reset\":true}\n\n");
    wait(|| preview.data().is_err());
    assert!(matches!(watch.next(), Some(WatchEvent::Failed(_))));
    let n = f.state.stream_count.load(Ordering::SeqCst);
    thread::sleep(Duration::from_millis(100));
    assert_eq!(f.state.stream_count.load(Ordering::SeqCst), n);
}
#[test]
fn subscription_revalidates_a_change_between_read_and_registration() {
    let f = Fixture::new();
    let (ws, shared) = f.scoped();
    let doc = ws.read(p("live.md")).unwrap();
    let (_root, _) = subscription(&ws);
    wait(|| shared.epoch.load(Ordering::SeqCst) >= 2);
    f.state.files.lock().unwrap().insert(
        "live.md".into(),
        Some(b"changed before subscription".to_vec()),
    );
    f.state.reset();
    wait(|| shared.epoch.load(Ordering::SeqCst) >= 3);
    let document = ws.watch(&doc, Arc::new(|| {})).unwrap();
    assert!(matches!(document.next(), Some(WatchEvent::Invalidated)));
    assert_eq!(
        ws.observe(&doc).unwrap().text,
        "changed before subscription"
    );
    assert_eq!(f.state.stream_count.load(Ordering::SeqCst), 1);
}
#[test]
fn readiness_receipts_expire_and_cancellation_prevents_any_api_dispatch() {
    let f = Fixture::new();
    let mut prepared = f.prepare().unwrap();
    prepared.expires = Instant::now();
    assert!(prepared.into_parts().is_err());
    let cancel = Cancellation::default();
    cancel.cancel();
    let count = f.state.requests.lock().unwrap().len();
    assert!(
        prepare_running(
            f.broker.clone(),
            f.binding.clone(),
            Target::ProjectRoot {
                project_id: "project-a".into()
            },
            &cancel
        )
        .is_err()
    );
    assert_eq!(f.state.requests.lock().unwrap().len(), count);
}
#[test]
fn service_generation_errors_are_not_misclassified_as_file_conflicts() {
    let f = Fixture::new();
    let ws = f.open();
    let preview = ws.resource(p("image.png")).unwrap();
    let doc = ws.read(p("live.md")).unwrap();
    *f.state.file_failure.lock().unwrap() = Some((409, "workbench_generation_changed"));
    assert_eq!(
        ws.save(&doc, "draft").unwrap_err().kind,
        ErrorKind::OutcomeUnknown
    );
    assert!(preview.data().is_err());
    assert_eq!(f.state.count("PUT", "/file"), 1);
    assert_eq!(
        f.state.count("GET", "/file"),
        2,
        "generation failure must not fetch a conflict baseline from another runtime"
    );
}
#[test]
fn streaming_auth_refresh_and_planned_renewal_do_not_exhaust_reconnect_budget() {
    let f = Fixture::with_expiry(3);
    let (ws, shared) = f.scoped();
    f.state.stream_401.store(1, Ordering::SeqCst);
    let (watch, _) = subscription(&ws);
    wait(|| shared.epoch.load(Ordering::SeqCst) >= 2);
    let _ = watch.next();
    wait(|| {
        f.state.stream_count.load(Ordering::SeqCst) >= 2 && shared.epoch.load(Ordering::SeqCst) >= 4
    });
    assert!(matches!(watch.next(), Some(WatchEvent::Invalidated)));
    assert!(ws.read(p("live.md")).is_ok());
    assert!(f.state.count("POST", "/auth/v1/token") >= 2);
}
#[test]
fn non_sse_responses_fail_closed_and_transport_reconnects_are_bounded() {
    for wrong_type in [true, false] {
        let f = Fixture::new();
        f.state
            .stream_wrong_type
            .store(wrong_type, Ordering::SeqCst);
        f.state.stream_disconnects.store(100, Ordering::SeqCst);
        let ws = f.open();
        let preview = ws.resource(p("image.png")).unwrap();
        let (watch, _) = subscription(&ws);
        wait(|| preview.data().is_err());
        assert!(matches!(watch.next(), Some(WatchEvent::Failed(_))));
        assert_eq!(
            f.state.count("GET", "/events"),
            if wrong_type { 1 } else { 4 }
        );
        assert_eq!(f.state.count("POST", "/workbench"), 0);
    }
}
#[test]
fn directory_contract_rejects_duplicates_escape_names_and_unbounded_results() {
    let root = RelativePath::new(p("")).unwrap();
    for value in [
        json!({"entries":[{"name":"../escape","kind":"file","size":0}]}),
        json!({"entries":[{"name":".git","kind":"directory","size":0}]}),
        json!({"entries":[{"name":"x","kind":"file","size":0},{"name":"x","kind":"file","size":0}]}),
        json!({"entries":vec![json!({"name":"x","kind":"file","size":0});10001]}),
    ] {
        assert!(model::entries(value, &root).is_err());
    }
}
#[test]
fn parser_handles_fragmented_utf8_crlf_and_bounded_reset_only_frames() {
    let message = format!(
        "event: change\r\ndata: {{\"generation\":\"{GENERATION}\",\"reset\":true,\"paths\":[\"你好.md\"]}}\r\n\r\n"
    );
    let mut parser = events::Parser::default();
    let mut count = 0;
    for byte in message.bytes() {
        parser
            .feed(&[byte], GENERATION, &mut || count += 1)
            .unwrap();
    }
    assert_eq!(count, 1);
    for message in [
        "event: change\ndata: {}\n\n",
        "event: change\ndata: invalid\n\n",
        "event: unavailable\ndata: {}\n\n",
    ] {
        assert!(
            events::Parser::default()
                .feed(message.as_bytes(), GENERATION, &mut || panic!(
                    "invalid reset"
                ))
                .is_err()
        );
    }
    assert!(
        events::Parser::default()
            .feed(&vec![b'x'; 32769], GENERATION, &mut || {})
            .is_err()
    );
    assert_eq!(
        events::Parser::default().feed(
            b"event: unavailable\ndata: {\"retryable\":true}\n\n",
            GENERATION,
            &mut || {}
        ),
        Err(auth::Error::Unavailable)
    );
}
#[test]
fn database_previews_refuse_active_sidecars_and_keep_one_snapshot() {
    let f = Fixture::new();
    let sqlite = b"SQLite format 3\0rest".to_vec();
    f.state
        .files
        .lock()
        .unwrap()
        .insert("data.sqlite".into(), Some(sqlite.clone()));
    let ws = f.open();
    let preview = ws.resource(p("data.sqlite")).unwrap();
    match preview.data().unwrap() {
        PreviewData::Bytes { bytes, .. } => assert_eq!(&bytes[..], &sqlite[..]),
        other => panic!("{other:?}"),
    }
    // A write-ahead log beside it means the database needs recovery.
    f.state
        .files
        .lock()
        .unwrap()
        .insert("data.sqlite-wal".into(), Some(vec![1, 2, 3]));
    let refused = ws.resource(p("data.sqlite")).unwrap_err();
    assert_eq!(refused.kind, ErrorKind::Unsupported);
    // Other files are not checked for sidecars.
    assert!(ws.resource(p("image.png")).is_ok());
}
