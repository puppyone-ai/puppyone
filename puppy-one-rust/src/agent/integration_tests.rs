use super::{
    bootstrap::create_agent_runtime_host, connections::local_agent_inventory,
    domain::agent_session_model::State, runtime::agent_runtime_registry::Runtime,
};
use crate::wake::Wake;
use std::time::{Duration, Instant};
#[test]
#[ignore = "starts installed native Agent CLIs in disposable projects; run explicitly"]
fn live_installed_runtime_handshakes() {
    for installation in local_agent_inventory::discover() {
        if !matches!(
            installation.runtime,
            Runtime::Codex | Runtime::Claude | Runtime::Cursor | Runtime::OpenCode | Runtime::Pi
        ) {
            continue;
        }
        let dir = tempfile::Builder::new()
            .prefix("puppyone-runtime-handshake-")
            .tempdir()
            .unwrap();
        let root = dir.path().canonicalize().unwrap();
        let mut client: Box<dyn super::runtime::agent_runtime_port::AgentRuntimePort> =
            if installation.runtime == Runtime::OpenCode {
                // Protocol verification uses a disposable config. The installed user profile has
                // an unrelated plugin bootstrap failure; production continues to honor that profile.
                let connection =
                    super::transports::jsonl_rpc_connection::Connection::spawn_with_env(
                        installation.executable.clone(),
                        vec!["acp".into(), format!("--cwd={}", root.display())],
                        root.clone(),
                        Wake::default(),
                        vec![(
                            "XDG_CONFIG_HOME".into(),
                            root.join("config").to_string_lossy().into_owned(),
                        )],
                    );
                Box::new(
                    super::protocols::acp::acp_runtime_adapter::Session::connected(
                        connection, root, "OpenCode", false,
                    ),
                )
            } else {
                create_agent_runtime_host::create(
                    installation.clone(),
                    root,
                    false,
                    Wake::default(),
                )
            };
        let start = Instant::now();
        loop {
            client.poll();
            if client.snapshot().state == State::Idle {
                break;
            }
            assert_ne!(
                client.snapshot().state,
                State::Failed,
                "{}: {:?}",
                installation.label,
                client.snapshot().error
            );
            assert!(
                start.elapsed() < Duration::from_secs(45),
                "{} startup timeout",
                installation.label
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        println!(
            "NATIVE_HANDSHAKE_OK: {}{}",
            installation.label,
            if installation.runtime == Runtime::OpenCode {
                " (isolated config)"
            } else {
                ""
            }
        );
    }
}
#[test]
#[ignore = "live Claude inference using existing CLI login and a disposable workspace"]
fn live_claude_stream_and_resume() {
    let installation = local_agent_inventory::discover()
        .into_iter()
        .find(|i| i.runtime == Runtime::Claude)
        .expect("Claude installed");
    let dir = tempfile::Builder::new()
        .prefix("puppyone-claude-live-")
        .tempdir()
        .unwrap();
    let root = dir.path().canonicalize().unwrap();
    let mut client = create_agent_runtime_host::create(
        installation.clone(),
        root.clone(),
        false,
        Wake::default(),
    );
    fn wait(
        client: &mut Box<dyn super::runtime::agent_runtime_port::AgentRuntimePort>,
        predicate: impl Fn(&super::domain::agent_session_model::SessionSnapshot) -> bool,
    ) {
        let start = Instant::now();
        loop {
            client.poll();
            assert_ne!(
                client.snapshot().state,
                State::Failed,
                "{:?}",
                client.snapshot().error
            );
            if predicate(client.snapshot()) {
                break;
            }
            assert!(
                start.elapsed() < Duration::from_secs(100),
                "Claude timed out: {:?}",
                client.snapshot().error
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    wait(&mut client, |s| s.state == State::Idle);
    let token = format!("CLAUDE_{}", uuid::Uuid::new_v4().simple());
    client.send(format!(
        "Remember {token}. Reply only with that token. Do not use tools."
    ));
    wait(&mut client, |s| s.state == State::Idle);
    assert!(
        client
            .snapshot()
            .messages
            .iter()
            .any(|m| m.role == "Claude Code" && m.text.contains(&token)),
        "{:?}",
        client.snapshot().error
    );
    let id = client.snapshot().thread.clone().unwrap();
    drop(client);
    let mut resumed = create_agent_runtime_host::create(installation, root, false, Wake::default());
    wait(&mut resumed, |s| s.state == State::Idle);
    resumed.resume(id);
    wait(&mut resumed, |s| s.state == State::Idle);
    resumed.send(
        "What token did I ask you to remember? Reply only with that token. Do not use tools."
            .into(),
    );
    wait(&mut resumed, |s| s.state == State::Idle);
    assert!(
        resumed
            .snapshot()
            .messages
            .iter()
            .rev()
            .find(|m| m.role == "Claude Code")
            .unwrap()
            .text
            .contains(&token)
    );
    println!("LIVE_CLAUDE_OK: streaming and exact native resume");
}

fn live_native_conversation(runtime: Runtime) {
    use super::{
        domain::agent_session_model::SessionSnapshot, runtime::agent_runtime_port::AgentRuntimePort,
    };
    let installation = local_agent_inventory::discover()
        .into_iter()
        .find(|i| i.runtime == runtime)
        .expect("Requested native Agent is installed");
    let label = installation.label.clone();
    let dir = tempfile::Builder::new()
        .prefix("puppyone-native-conversation-")
        .tempdir()
        .unwrap();
    let root = dir.path().canonicalize().unwrap();
    fn wait(client: &mut Box<dyn AgentRuntimePort>, predicate: impl Fn(&SessionSnapshot) -> bool) {
        let started = Instant::now();
        loop {
            client.poll();
            let snapshot = client.snapshot();
            assert_ne!(
                snapshot.state,
                State::Failed,
                "{}: {:?}",
                snapshot.runtime,
                snapshot.error
            );
            assert!(
                snapshot.interactions.is_empty(),
                "No-tools conversation unexpectedly requested approval"
            );
            if predicate(snapshot) {
                return;
            }
            assert!(
                started.elapsed() < Duration::from_secs(80),
                "{} timed out: {:?}",
                snapshot.runtime,
                snapshot.error
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    let mut client = create_agent_runtime_host::create(
        installation.clone(),
        root.clone(),
        false,
        Wake::default(),
    );
    wait(&mut client, |s| s.state == State::Idle);
    let token = format!("NATIVE_{}", uuid::Uuid::new_v4().simple());
    client.send(format!(
        "Remember this token: {token}. Reply only with the token. Do not use any tools."
    ));
    wait(&mut client, |s| s.state == State::Idle);
    let answered = |snapshot: &SessionSnapshot| {
        snapshot
            .messages
            .iter()
            .rev()
            .find(|m| m.role == label)
            .is_some_and(|m| m.text.contains(&token))
    };
    assert!(
        answered(client.snapshot()),
        "{label} did not answer: error={:?}, notice={:?}",
        client.snapshot().error,
        client.snapshot().notice
    );
    let thread = client
        .snapshot()
        .thread
        .clone()
        .expect("Native session identity");
    let old_ids: Vec<_> = client
        .snapshot()
        .messages
        .iter()
        .map(|m| m.id.clone())
        .collect();
    client.send(
        "What token did I ask you to remember? Reply only with that token. Do not use tools."
            .into(),
    );
    wait(&mut client, |s| s.state == State::Idle);
    assert!(
        client
            .snapshot()
            .messages
            .iter()
            .any(|m| m.role == label && !old_ids.contains(&m.id) && m.text.contains(&token)),
        "{label}: second-turn context was not preserved: {:?}",
        client.snapshot().error
    );
    drop(client);
    let mut resumed = create_agent_runtime_host::create(installation, root, false, Wake::default());
    wait(&mut resumed, |s| s.state == State::Idle);
    resumed.resume(thread.clone());
    wait(&mut resumed, |s| s.state == State::Idle);
    assert_eq!(
        resumed.snapshot().thread.as_deref(),
        Some(thread.as_str()),
        "{label} did not restore the exact native session"
    );
    // Pi's history hydration is a separate response; wait before sending a new turn.
    wait(&mut resumed, |s| answered(s));
    let old_ids: Vec<_> = resumed
        .snapshot()
        .messages
        .iter()
        .map(|m| m.id.clone())
        .collect();
    resumed.send(
        "What token did I ask you to remember? Reply only with that token. Do not use tools."
            .into(),
    );
    wait(&mut resumed, |s| s.state == State::Idle);
    assert!(
        resumed
            .snapshot()
            .messages
            .iter()
            .any(|m| m.role == label && !old_ids.contains(&m.id) && m.text.contains(&token)),
        "{label}: native resume lost context: error={:?}, old_ids={old_ids:?}, final_reply={:?}, ids={:?}",
        resumed.snapshot().error,
        resumed
            .snapshot()
            .messages
            .iter()
            .rev()
            .find(|m| m.role == label)
            .map(|m| (
                &m.id,
                super::domain::agent_session_model::bounded_text(m.text.clone(), 512)
            )),
        resumed
            .snapshot()
            .messages
            .iter()
            .map(|m| (&m.id, &m.role))
            .collect::<Vec<_>>()
    );
    println!("LIVE_NATIVE_OK: {label} reply, second turn and exact native resume");
}
#[test]
#[ignore = "live Cursor inference using existing CLI login and a disposable workspace"]
fn live_cursor_stream_and_resume() {
    live_native_conversation(Runtime::Cursor);
}
#[test]
#[ignore = "live Pi inference using existing CLI model configuration and a disposable workspace"]
fn live_pi_stream_and_resume() {
    live_native_conversation(Runtime::Pi);
}

#[test]
#[ignore = "loopback HTTP and disposable native session storage; run with PUPPYONE_RUST_DATA_DIR"]
fn native_puppyone_http_approval_resume_fork_stop_and_binding() {
    use super::{
        domain::{
            agent_session_model::{Decision, Resolution},
            reference_input::Prompt,
        },
        runtime::agent_runtime_port::AgentRuntimePort,
        runtimes::puppyone_agent::{
            adapter::Session,
            configuration::{self, ModelConnection},
        },
    };
    use serde_json::{Value, json};
    use std::io::{BufRead, BufReader, Read, Write};
    let storage = std::env::var_os("PUPPYONE_RUST_DATA_DIR").expect("Use isolated test storage");
    assert!(std::path::Path::new(&storage).starts_with("/private/tmp"));
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
    let (sent_tx, sent_rx) = std::sync::mpsc::channel();
    let server = std::thread::spawn(move || {
        for index in 0..5 {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut header = String::new();
            let mut length = 0usize;
            loop {
                header.clear();
                reader.read_line(&mut header).unwrap();
                if header == "\r\n" {
                    break;
                }
                if header.to_lowercase().starts_with("content-length:") {
                    length = header.split(':').nth(1).unwrap().trim().parse().unwrap();
                }
            }
            assert!(length < 2 * 1024 * 1024);
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let request: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(request["model"], "fixture-model");
            sent_tx.send(index).unwrap();
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
            let value = if index == 0 || index == 2 {
                json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":format!("tool-{index}"),"type":"function","function":{"name":"write","arguments":json!({"path":if index==0{"approved.txt"}else{"denied.txt"},"content":"NATIVE_RUST_TOOL_OK"}).to_string()}}]}}]})
            } else {
                json!({"choices":[{"delta":{"content":if index==4{"partial"}else{"FINISHED"}}}]})
            };
            write!(socket, "data: {value}\n\n").unwrap();
            socket.flush().unwrap();
            if index == 4 {
                let mut byte = [0];
                let _ = reader.read(&mut byte);
                break;
            }
            write!(socket, "data: [DONE]\n\n").unwrap();
            socket.flush().unwrap();
        }
    });
    let c = ModelConnection {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Fixture".into(),
        endpoint,
        model: "fixture-model".into(),
        images: false,
        authenticated: false,
        credential_id: None,
        generation: String::new(),
    };
    configuration::save(c.clone(), None).unwrap();
    assert!(
        configuration::save(c.clone(), None).is_err(),
        "stale configuration must not overwrite a newer generation"
    );
    let dir = tempfile::Builder::new()
        .prefix("puppyone-native-agent-")
        .tempdir()
        .unwrap();
    let root = dir.path().canonicalize().unwrap();
    fn wait(
        s: &mut Session,
        p: impl Fn(&super::domain::agent_session_model::SessionSnapshot) -> bool,
    ) {
        let at = Instant::now();
        loop {
            s.poll();
            assert_ne!(
                s.snapshot().state,
                State::Failed,
                "{:?}",
                s.snapshot().error
            );
            if p(s.snapshot()) {
                break;
            }
            assert!(
                at.elapsed() < Duration::from_secs(15),
                "{:?}",
                s.snapshot().error
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    let mut s = Session::new(root.clone(), false, Wake::default());
    wait(&mut s, |s| s.state == State::Idle);
    s.select_model(Some(c.route()));
    wait(&mut s, |s| s.model == Some(c.route()));
    s.submit(Prompt::text("Write the approved fixture".into()));
    wait(&mut s, |s| !s.interactions.is_empty());
    assert!(!root.join("approved.txt").exists());
    s.resolve(&json!("foreign"), Resolution::Approval(Decision::Accept));
    assert!(!root.join("approved.txt").exists());
    let id = s.snapshot().interactions[0].id.clone();
    s.resolve(&id, Resolution::Approval(Decision::Accept));
    wait(&mut s, |s| s.state == State::Idle);
    assert!(s.snapshot().error.is_none(), "{:?}", s.snapshot().error);
    assert_eq!(
        std::fs::read_to_string(root.join("approved.txt")).unwrap(),
        "NATIVE_RUST_TOOL_OK"
    );
    let original = s.snapshot().thread.clone().unwrap();
    s.rename("Native fixture".into());
    wait(&mut s, |s| s.title == "Native fixture");
    s.fork();
    wait(&mut s, |s| s.thread.as_ref() != Some(&original));
    let fork = s.snapshot().thread.clone().unwrap();
    assert_ne!(original, fork);
    s.resume(original.clone());
    wait(&mut s, |s| {
        s.state == State::Idle && s.thread.as_ref() == Some(&original)
    });
    assert!(
        s.snapshot()
            .messages
            .iter()
            .any(|m| m.text.contains("FINISHED"))
    );
    s.send("Decline the next write".into());
    wait(&mut s, |s| !s.interactions.is_empty());
    let id = s.snapshot().interactions[0].id.clone();
    s.resolve(&id, Resolution::Approval(Decision::Decline));
    wait(&mut s, |s| s.state == State::Idle);
    assert!(!root.join("denied.txt").exists());
    s.send("Wait for cancellation".into());
    wait(&mut s, |s| {
        s.messages.iter().any(|m| m.text.contains("partial"))
    });
    s.stop();
    wait(&mut s, |s| s.state == State::Idle);
    assert_eq!(s.snapshot().usage, "interrupted");
    let current = configuration::load()
        .unwrap()
        .into_iter()
        .find(|item| item.id == c.id)
        .unwrap();
    configuration::save(current, None).unwrap();
    s.send("This must not contact a changed endpoint".into());
    wait(&mut s, |s| s.state == State::Idle);
    assert!(
        s.snapshot()
            .error
            .as_deref()
            .unwrap_or("")
            .contains("connection changed")
    );
    s.list_history();
    wait(&mut s, |s| s.state == State::History);
    assert!(s.snapshot().history.iter().any(|h| h.id == original));
    assert!(s.snapshot().history.iter().any(|h| h.id == fork));
    let current = configuration::load()
        .unwrap()
        .into_iter()
        .find(|item| item.id == c.id)
        .unwrap();
    assert!(configuration::remove(&current.id, "stale-generation").is_err());
    configuration::remove(&current.id, &current.generation).unwrap();
    assert!(
        configuration::save(current, None).is_err(),
        "a deleted connection must not be resurrected by a stale editor"
    );
    assert!(
        !configuration::load()
            .unwrap()
            .iter()
            .any(|item| item.id == c.id)
    );
    drop(s);
    server.join().unwrap();
    assert_eq!(sent_rx.try_iter().count(), 5);
    println!(
        "NATIVE_PUPPYONE_OK: real HTTP SSE, approval-before-write, decline, exact resume, fork, stop, binding fence, durable history"
    );
}
