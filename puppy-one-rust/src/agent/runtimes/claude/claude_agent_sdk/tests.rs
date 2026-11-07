//! The Agent SDK equivalent against the SDK's own behavior: CLI arguments,
//! the stream-json control protocol and the transcript-store helpers.
use super::process_transport::{build_args, build_env};
use super::query::query;
use super::sessions::{
    fork_session, get_session_info, get_session_messages, list_sessions, sanitize_path,
};
use super::{
    CanUseTool, ClaudeQuery, ForkSessionOptions, ListSessionsOptions, PermissionOptions,
    PromptSource, QueryOptions, SessionMessagesOptions, SpawnClaudeCodeProcess, SpawnOptions,
    SystemPrompt,
};
use crate::agent::agent_error::AgentResult;
use crate::agent::application::tests_support::run_local;
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::runtimes::claude::claude_message_channel::ClaudeMessageChannel;
use crate::agent::transports::jsonl_rpc_connection::{ConnectionOptions, ProcessIo, Spawner};
use crate::agent::transports::test_support::{FakeChild, fake_spawner};
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;

fn base_options() -> QueryOptions {
    QueryOptions {
        cwd: Some("/workspace".into()),
        env: Some(EnvMap::new()),
        path_to_claude_code_executable: Some("/tools/claude".into()),
        include_partial_messages: true,
        setting_sources: Some(vec!["user".into()]),
        ..Default::default()
    }
}

fn allow_everything() -> CanUseTool {
    Rc::new(|_tool, input, _options| {
        Box::pin(async move { Ok(json!({ "behavior": "allow", "updatedInput": input })) })
    })
}

#[test]
fn builds_the_sdk_cli_arguments_in_the_sdk_order() {
    let mut options = base_options();
    options.model = Some("claude-sonnet".into());
    options.effort = Some("high".into());
    options.permission_mode = Some("plan".into());
    options.session_id = Some("2f1c8a3e-0000-4000-8000-000000000001".into());
    options.can_use_tool = Some(allow_everything());
    assert_eq!(
        build_args(&options),
        [
            "--output-format",
            "stream-json",
            "--verbose",
            "--input-format",
            "stream-json",
            "--effort",
            "high",
            "--model",
            "claude-sonnet",
            "--permission-prompt-tool",
            "stdio",
            "--setting-sources=user",
            "--permission-mode",
            "plan",
            "--include-partial-messages",
            "--session-id",
            "2f1c8a3e-0000-4000-8000-000000000001",
        ]
    );
    let mut resumed = base_options();
    resumed.resume = Some("2f1c8a3e-0000-4000-8000-000000000001".into());
    resumed.include_partial_messages = false;
    resumed.setting_sources = None;
    assert_eq!(
        build_args(&resumed)[5..],
        [
            "--resume",
            "2f1c8a3e-0000-4000-8000-000000000001",
            "--permission-mode",
            "default",
        ]
    );
}

#[test]
fn builds_the_sdk_process_environment() {
    let mut options = base_options();
    options.env = Some(EnvMap::from([
        ("PATH".into(), "/usr/bin".into()),
        ("NODE_OPTIONS".into(), "--inspect".into()),
        ("DEBUG".into(), "1".into()),
        ("CLAUDE_CONFIG_DIR".into(), "/profile".into()),
    ]));
    let env = build_env(&options);
    assert_eq!(env["CLAUDE_CODE_ENTRYPOINT"], "sdk-ts");
    assert_eq!(env["CLAUDE_AGENT_SDK_VERSION"], "0.3.159");
    assert_eq!(env["CLAUDE_CONFIG_DIR"], "/profile");
    assert!(!env.contains_key("NODE_OPTIONS"));
    assert!(!env.contains_key("DEBUG"));
}

#[test]
fn sanitizes_project_directories_like_the_sdk() {
    assert_eq!(sanitize_path("/tmp/a b/c"), "-tmp-a-b-c");
    let long = format!("/Users/test/{}/é😀", "x".repeat(240));
    let sanitized = sanitize_path(&long);
    // `node`: the SDK's `F0` over the same path.
    assert_eq!(sanitized, format!("-Users-test-{}-xk9p44", "x".repeat(188)));
}

/// `spawnClaudeCodeProcess` over a scripted child.
struct FakeLaunch {
    spawner: Spawner,
    launched: RefCell<Vec<(String, Vec<String>, EnvMap)>>,
}

impl SpawnClaudeCodeProcess for FakeLaunch {
    fn launch(&self, options: SpawnOptions) -> AgentResult<ProcessIo> {
        self.launched.borrow_mut().push((
            options.command.clone(),
            options.args.clone(),
            options.env.clone(),
        ));
        (self.spawner)(&ConnectionOptions {
            executable_path: PathBuf::from(&options.command),
            args: options.args,
            cwd: PathBuf::from(options.cwd.unwrap_or_default()),
            env: Some(options.env.into_iter().collect()),
            ..Default::default()
        })
    }
}

/// `(toolName, options.title)`.
type Permission = (String, Option<Value>);

async fn settle() {
    for _ in 0..16 {
        tokio::task::yield_now().await;
    }
}

fn control_requests(child: &FakeChild, subtype: &str) -> Vec<Value> {
    child
        .messages()
        .into_iter()
        .filter(|m| m["type"] == "control_request" && m["request"]["subtype"] == subtype)
        .collect()
}

async fn respond(child: &FakeChild, request: &Value, response: Value) {
    let frame = json!({
        "type": "control_response",
        "response": { "subtype": "success", "request_id": request["request_id"], "response": response },
    });
    child.stdout(&format!("{frame}\n")).await;
}

#[test]
fn drives_the_native_stream_json_control_protocol() {
    run_local(async {
        let (spawner, child) = fake_spawner(true);
        let launch = Rc::new(FakeLaunch {
            spawner,
            launched: RefCell::default(),
        });
        let permissions: Rc<RefCell<Vec<Permission>>> = Rc::default();
        let mut options = base_options();
        options.spawn_claude_code_process = Some(launch.clone());
        options.system_prompt = Some(SystemPrompt::Preset {
            preset: "claude_code".into(),
            append: Some("Workspace rules".into()),
        });
        options.can_use_tool = Some({
            let permissions = permissions.clone();
            Rc::new(move |tool, input, options: PermissionOptions| {
                permissions.borrow_mut().push((tool, options.title.clone()));
                Box::pin(async move { Ok(json!({ "behavior": "allow", "updatedInput": input })) })
            })
        });
        let channel = ClaudeMessageChannel::new(Rc::new(|_| {}));
        let query = query(Rc::new(channel.clone()) as Rc<dyn PromptSource>, options).unwrap();
        settle().await;
        let (command, args, env) = launch.launched.borrow()[0].clone();
        assert_eq!(command, "/tools/claude");
        assert!(args.contains(&"--permission-prompt-tool".to_string()));
        assert_eq!(env["CLAUDE_CODE_ENTRYPOINT"], "sdk-ts");

        let initialize = control_requests(&child, "initialize");
        assert_eq!(
            initialize[0]["request"],
            json!({ "subtype": "initialize", "appendSystemPrompt": "Workspace rules" })
        );
        respond(
            &child,
            &initialize[0],
            json!({ "models": [{ "value": "claude-sonnet" }] }),
        )
        .await;
        let initialized = query.initialization_result().await.unwrap();
        assert_eq!(initialized["models"][0]["value"], "claude-sonnet");

        channel
            .enqueue(json!({ "type": "user", "message": { "role": "user", "content": "Hi" } }))
            .unwrap();
        settle().await;
        assert!(child.messages().iter().any(|m| m["type"] == "user"));

        child
            .stdout(&format!(
                "{}\n",
                json!({
                    "type": "control_request",
                    "request_id": "native-1",
                    "request": {
                        "subtype": "can_use_tool",
                        "tool_name": "Bash",
                        "input": { "command": "ls" },
                        "tool_use_id": "toolu_1",
                        "title": "Run ls",
                    },
                })
            ))
            .await;
        settle().await;
        assert_eq!(
            permissions.borrow()[0],
            ("Bash".to_string(), Some(json!("Run ls")))
        );
        let response = child
            .messages()
            .into_iter()
            .find(|m| m["type"] == "control_response")
            .unwrap();
        assert_eq!(
            response["response"],
            json!({
                "subtype": "success",
                "request_id": "native-1",
                "response": { "behavior": "allow", "updatedInput": { "command": "ls" }, "toolUseID": "toolu_1" },
            })
        );

        child.stdout("not json\n").await;
        child
            .stdout(&format!(
                "{}\n{}\n",
                json!({ "type": "keep_alive" }),
                json!({ "type": "assistant", "session_id": "s", "message": { "content": [{ "type": "text", "text": "Hello" }] } }),
            ))
            .await;
        let message = query.next().await.unwrap().unwrap();
        assert_eq!(message["type"], "assistant");

        let interrupt = {
            let query = query.clone();
            crate::agent::event_loop::spawn(async move { query.interrupt().await.unwrap() })
        };
        settle().await;
        let request = control_requests(&child, "interrupt");
        respond(&child, &request[0], json!({})).await;
        interrupt.await.unwrap();

        child
            .stdout(&format!(
                "{}\n",
                json!({ "type": "result", "subtype": "error_during_execution", "is_error": true, "errors": ["Provider overloaded"] })
            ))
            .await;
        assert_eq!(query.next().await.unwrap().unwrap()["type"], "result");
        child.end_stdout();
        child.exit(Some(1), None);
        let error = query.next().await.unwrap().unwrap_err();
        assert_eq!(
            error.message,
            "Claude Code returned an error result: Provider overloaded"
        );
        assert!(query.next().await.is_none());
    });
}

#[test]
fn answers_unsupported_control_requests_and_rejects_pending_requests_on_close() {
    run_local(async {
        let (spawner, child) = fake_spawner(true);
        let mut options = base_options();
        options.spawn_claude_code_process = Some(Rc::new(FakeLaunch {
            spawner,
            launched: RefCell::default(),
        }));
        let channel = ClaudeMessageChannel::new(Rc::new(|_| {}));
        let query = query(Rc::new(channel), options).unwrap();
        settle().await;
        child
            .stdout(&format!(
                "{}\n{}\n",
                json!({ "type": "control_request", "request_id": "e-1", "request": { "subtype": "elicitation" } }),
                json!({ "type": "control_request", "request_id": "c-1", "request": { "subtype": "can_use_tool", "tool_name": "Bash" } }),
            ))
            .await;
        settle().await;
        let responses: Vec<Value> = child
            .messages()
            .into_iter()
            .filter(|m| m["type"] == "control_response")
            .map(|m| m["response"].clone())
            .collect();
        assert_eq!(
            responses[0],
            json!({ "subtype": "success", "request_id": "e-1", "response": { "action": "decline" } })
        );
        assert_eq!(
            responses[1],
            json!({ "subtype": "error", "request_id": "c-1", "error": "canUseTool callback is not provided." })
        );
        query.close();
        let error = query.initialization_result().await.unwrap_err();
        assert_eq!(error.message, "Query closed before response received");
        assert!(query.next().await.is_none());
    });
}

// ---------------------------------------------------------------------------
// The transcript store.

struct Store {
    _temp: tempfile::TempDir,
    root: PathBuf,
    workspace: String,
    project: PathBuf,
}

fn store() -> Store {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("profile");
    let workspace = temp.path().join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let canonical = std::fs::canonicalize(&workspace)
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let project = root.join("projects").join(sanitize_path(&canonical));
    std::fs::create_dir_all(&project).unwrap();
    Store {
        _temp: temp,
        root,
        workspace: canonical,
        project,
    }
}

const FIRST: &str = "11111111-1111-4111-8111-111111111111";
const SECOND: &str = "22222222-2222-4222-8222-222222222222";

fn write_transcript(path: &Path, entries: &[Value]) {
    let text: String = entries.iter().map(|entry| format!("{entry}\n")).collect();
    std::fs::write(path, text).unwrap();
}

fn conversation(session: &str, cwd: &str) -> Vec<Value> {
    vec![
        json!({ "type": "user", "uuid": "a0000000-0000-4000-8000-000000000001", "parentUuid": null, "sessionId": session, "cwd": cwd, "timestamp": "2026-01-01T00:00:00.000Z", "gitBranch": "main", "message": { "role": "user", "content": "Fix the login bug" } }),
        json!({ "type": "assistant", "uuid": "a0000000-0000-4000-8000-000000000002", "parentUuid": "a0000000-0000-4000-8000-000000000001", "sessionId": session, "timestamp": "2026-01-01T00:00:01.000Z", "message": { "id": "msg_1", "role": "assistant", "content": [{ "type": "text", "text": "Looking." }] } }),
        json!({ "type": "user", "uuid": "a0000000-0000-4000-8000-000000000003", "parentUuid": "a0000000-0000-4000-8000-000000000002", "sessionId": session, "isMeta": true, "timestamp": "2026-01-01T00:00:02.000Z", "message": { "role": "user", "content": "<system-reminder>meta</system-reminder>" } }),
        json!({ "type": "progress", "uuid": "a0000000-0000-4000-8000-000000000004", "parentUuid": "a0000000-0000-4000-8000-000000000003", "sessionId": session, "timestamp": "2026-01-01T00:00:03.000Z" }),
        json!({ "type": "assistant", "uuid": "a0000000-0000-4000-8000-000000000005", "parentUuid": "a0000000-0000-4000-8000-000000000004", "sessionId": session, "timestamp": "2026-01-01T00:00:04.000Z", "message": { "id": "msg_2", "role": "assistant", "content": [{ "type": "text", "text": "Fixed." }] } }),
        json!({ "type": "assistant", "uuid": "a0000000-0000-4000-8000-000000000006", "parentUuid": "a0000000-0000-4000-8000-000000000001", "sessionId": session, "isSidechain": true, "timestamp": "2026-01-01T00:00:05.000Z", "message": { "id": "msg_3", "role": "assistant", "content": [{ "type": "text", "text": "Sidechain." }] } }),
        json!({ "type": "custom-title", "sessionId": session, "customTitle": "Login fix" }),
    ]
}

#[test]
fn lists_and_describes_workspace_sessions_from_the_transcript_store() {
    let store = store();
    write_transcript(
        &store.project.join(format!("{FIRST}.jsonl")),
        &conversation(FIRST, &store.workspace),
    );
    write_transcript(
        &store.project.join(format!("{SECOND}.jsonl")),
        &[
            json!({ "type": "user", "uuid": "b0000000-0000-4000-8000-000000000001", "sessionId": SECOND, "cwd": store.workspace, "timestamp": "2026-01-02T00:00:00.000Z", "message": { "role": "user", "content": [{ "type": "text", "text": "<command-name>/review</command-name>" }] } }),
        ],
    );
    std::fs::write(store.project.join("not-a-session.jsonl"), "{}\n").unwrap();
    let dir = Some(store.workspace.clone());
    let all = list_sessions(
        &store.root,
        &ListSessionsOptions {
            dir: dir.clone(),
            ..Default::default()
        },
    );
    assert_eq!(all.len(), 2);
    let first = all.iter().find(|s| s["sessionId"] == FIRST).unwrap();
    assert_eq!(first["summary"], "Login fix");
    assert_eq!(first["customTitle"], "Login fix");
    assert_eq!(first["firstPrompt"], "Fix the login bug");
    assert_eq!(first["gitBranch"], "main");
    assert_eq!(first["cwd"], Value::from(store.workspace.as_str()));
    assert_eq!(first["createdAt"], 1_767_225_600_000i64);
    let second = all.iter().find(|s| s["sessionId"] == SECOND).unwrap();
    assert_eq!(second["summary"], "/review");

    let page = list_sessions(
        &store.root,
        &ListSessionsOptions {
            dir: dir.clone(),
            limit: Some(1),
            offset: Some(1),
            include_worktrees: Some(false),
        },
    );
    assert_eq!(page.len(), 1);
    assert!(all.iter().any(|s| s["sessionId"] == page[0]["sessionId"]));

    let info = get_session_info(&store.root, FIRST, dir.as_deref()).unwrap();
    assert_eq!(info["summary"], "Login fix");
    assert!(get_session_info(&store.root, "not-a-uuid", dir.as_deref()).is_none());
    assert!(
        get_session_info(
            &store.root,
            "33333333-3333-4333-8333-333333333333",
            dir.as_deref()
        )
        .is_none()
    );
}

#[test]
fn reads_the_main_conversation_chain_without_meta_sidechain_or_progress_entries() {
    let store = store();
    write_transcript(
        &store.project.join(format!("{FIRST}.jsonl")),
        &conversation(FIRST, &store.workspace),
    );
    let messages = get_session_messages(
        &store.root,
        FIRST,
        &SessionMessagesOptions {
            dir: Some(store.workspace.clone()),
            ..Default::default()
        },
    );
    let uuids: Vec<&str> = messages
        .iter()
        .map(|m| m["uuid"].as_str().unwrap())
        .collect();
    assert_eq!(
        uuids,
        [
            "a0000000-0000-4000-8000-000000000001",
            "a0000000-0000-4000-8000-000000000002",
            "a0000000-0000-4000-8000-000000000005",
        ]
    );
    assert_eq!(
        messages[0],
        json!({
            "type": "user",
            "uuid": "a0000000-0000-4000-8000-000000000001",
            "session_id": FIRST,
            "message": { "role": "user", "content": "Fix the login bug" },
            "parent_tool_use_id": null,
            "timestamp": "2026-01-01T00:00:00.000Z",
        })
    );
    let paged = get_session_messages(
        &store.root,
        FIRST,
        &SessionMessagesOptions {
            dir: Some(store.workspace.clone()),
            limit: Some(1),
            offset: Some(1),
            ..Default::default()
        },
    );
    assert_eq!(paged.len(), 1);
    assert_eq!(paged[0]["uuid"], "a0000000-0000-4000-8000-000000000002");
}

#[test]
fn skips_the_pre_compaction_prefix_of_large_transcripts() {
    let store = store();
    let mut entries = vec![
        json!({ "type": "user", "uuid": "c0000000-0000-4000-8000-000000000001", "sessionId": FIRST, "message": { "role": "user", "content": "Old prompt" } }),
        json!({ "type": "progress", "uuid": "c0000000-0000-4000-8000-000000000002", "parentUuid": "c0000000-0000-4000-8000-000000000001", "sessionId": FIRST, "padding": "x".repeat(5_300_000) }),
    ];
    entries.push(json!({ "type": "system", "subtype": "compact_boundary", "uuid": "c0000000-0000-4000-8000-000000000003", "parentUuid": null, "sessionId": FIRST }));
    entries.push(json!({ "type": "user", "uuid": "c0000000-0000-4000-8000-000000000004", "parentUuid": "c0000000-0000-4000-8000-000000000003", "sessionId": FIRST, "message": { "role": "user", "content": "Summary" } }));
    write_transcript(&store.project.join(format!("{FIRST}.jsonl")), &entries);
    let messages = get_session_messages(
        &store.root,
        FIRST,
        &SessionMessagesOptions {
            dir: Some(store.workspace.clone()),
            ..Default::default()
        },
    );
    let uuids: Vec<&str> = messages
        .iter()
        .map(|m| m["uuid"].as_str().unwrap())
        .collect();
    assert_eq!(uuids, ["c0000000-0000-4000-8000-000000000004"]);
}

#[test]
fn forks_a_session_up_to_a_message_with_fresh_identities() {
    let store = store();
    write_transcript(
        &store.project.join(format!("{FIRST}.jsonl")),
        &conversation(FIRST, &store.workspace),
    );
    let forked = fork_session(
        &store.root,
        FIRST,
        &ForkSessionOptions {
            dir: Some(store.workspace.clone()),
            up_to_message_id: Some("a0000000-0000-4000-8000-000000000002".into()),
            title: None,
        },
    )
    .unwrap();
    let id = forked["sessionId"].as_str().unwrap();
    let text = std::fs::read_to_string(store.project.join(format!("{id}.jsonl"))).unwrap();
    let entries: Vec<Value> = text
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0]["sessionId"], id);
    assert_eq!(entries[0]["parentUuid"], Value::Null);
    assert_eq!(entries[1]["parentUuid"], entries[0]["uuid"]);
    assert_ne!(entries[0]["uuid"], "a0000000-0000-4000-8000-000000000001");
    assert_eq!(
        entries[1]["forkedFrom"],
        json!({ "sessionId": FIRST, "messageUuid": "a0000000-0000-4000-8000-000000000002" })
    );
    assert_eq!(entries[1]["isSidechain"], false);
    assert_eq!(entries[2]["type"], "custom-title");
    assert_eq!(entries[2]["customTitle"], "Login fix (fork)");
    let keys: Vec<&String> = entries[0].as_object().unwrap().keys().collect();
    assert_eq!(keys[..3], ["type", "uuid", "parentUuid"]);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(store.project.join(format!("{id}.jsonl")))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
    let missing = fork_session(
        &store.root,
        FIRST,
        &ForkSessionOptions {
            dir: Some(store.workspace.clone()),
            up_to_message_id: Some("d0000000-0000-4000-8000-000000000009".into()),
            title: None,
        },
    )
    .unwrap_err();
    assert_eq!(
        missing.message,
        format!("Message d0000000-0000-4000-8000-000000000009 not found in session {FIRST}")
    );
}

/// The real Claude Code CLI's initialization handshake (no inference).
/// `cargo test … -- --ignored claude_agent_sdk_live`.
#[test]
#[ignore]
fn claude_agent_sdk_live_initialization_handshake() {
    run_local(async {
        let executable = std::env::var("CLAUDE_CODE_EXECUTABLE").unwrap_or_else(|_| {
            String::from_utf8(
                std::process::Command::new("sh")
                    .args(["-lc", "command -v claude"])
                    .output()
                    .unwrap()
                    .stdout,
            )
            .unwrap()
            .trim()
            .to_string()
        });
        let controller = crate::agent::event_loop::AbortController::new();
        let mut options = base_options();
        options.env = None;
        options.cwd = Some(std::env::temp_dir().to_string_lossy().into_owned());
        options.path_to_claude_code_executable = Some(executable);
        options.abort_controller = Some(controller.clone());
        options.can_use_tool = Some(allow_everything());
        options.system_prompt = Some(SystemPrompt::Preset {
            preset: "claude_code".into(),
            append: None,
        });
        let channel = ClaudeMessageChannel::new(Rc::new(|_| {}));
        let query = query(Rc::new(channel), options).unwrap();
        let initialized = tokio::time::timeout(
            std::time::Duration::from_secs(60),
            query.initialization_result(),
        )
        .await
        .unwrap()
        .unwrap();
        let models = initialized["models"].as_array().map_or(0, Vec::len);
        let commands = initialized["commands"].as_array().map_or(0, Vec::len);
        println!(
            "models={models} commands={commands} account-keys={:?}",
            initialized["account"]
                .as_object()
                .map(|a| a.keys().cloned().collect::<Vec<_>>())
        );
        assert!(models > 0);
        controller.abort(crate::agent::agent_error::AgentError::new("done"));
        query.close();
    });
}

/// Writes this SDK's session-helper results for `CLAUDE_SDK_PARITY_DIR` to
/// `CLAUDE_SDK_PARITY_OUT`, for comparison with the official SDK.
#[test]
#[ignore]
fn claude_agent_sdk_parity_dump() {
    let dir = std::env::var("CLAUDE_SDK_PARITY_DIR").unwrap();
    let out = std::env::var("CLAUDE_SDK_PARITY_OUT").unwrap();
    let root = super::sessions::claude_config_dir();
    let options = ListSessionsOptions {
        dir: Some(dir.clone()),
        limit: Some(8),
        offset: Some(1),
        include_worktrees: None,
    };
    let page = list_sessions(&root, &options);
    let all = list_sessions(
        &root,
        &ListSessionsOptions {
            dir: Some(dir.clone()),
            ..Default::default()
        },
    );
    let details: Vec<Value> = page
        .iter()
        .map(|session| {
            let id = session["sessionId"].as_str().unwrap();
            json!({
                "info": get_session_info(&root, id, Some(&dir)),
                "messages": get_session_messages(&root, id, &SessionMessagesOptions {
                    dir: Some(dir.clone()),
                    limit: Some(1_000),
                    ..Default::default()
                }),
            })
        })
        .collect();
    std::fs::write(
        out,
        serde_json::to_string(&json!({ "page": page, "all": all, "details": details })).unwrap(),
    )
    .unwrap();
}
