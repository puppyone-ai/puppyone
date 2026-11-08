//! `puppyone open` (`shared/cli-control-contract/protocol.mjs`,
//! `electron/main/cli-control/*`): the per-user socket the command line
//! talks to. Each connection carries one JSON line in each direction; a
//! request is untrusted input from another process of the same user, and
//! nothing here reads or lists files for the caller. Only the current user
//! can reach the socket: its directory is 0700 and the socket 0600.
//!
//! The protocol is a cross-repository contract, pinned byte for byte at
//! `contracts/cli-control-protocol.mjs`.
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    os::unix::{
        fs::{MetadataExt, PermissionsExt},
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    time::Duration,
};

/// `CLI_CONTROL_PROTOCOL` / `CLI_CONTROL_MIN_PROTOCOL`.
pub const PROTOCOL: u64 = 1;
pub const MIN_PROTOCOL: u64 = 1;
/// `CLI_LAUNCH_ARGUMENT`: passed by the CLI when it starts the app to
/// deliver one request.
pub const LAUNCH_ARGUMENT: &str = "--puppyone-cli-launch";
/// `CLI_CONTROL_LIMITS`.
pub const REQUEST_BYTES: usize = 64 * 1024;
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
pub const MAX_PATHS: usize = 32;
pub const MAX_PATH_LENGTH: usize = 4096;
pub const LAUNCH_WAIT: Duration = Duration::from_secs(10);
/// `CLI_INFO_PLIST_KEYS`: what the CLI reads before it starts the app.
pub const PLIST_PROTOCOL: &str = "PuppyOneCliProtocol";
pub const PLIST_USER_DATA_NAME: &str = "PuppyOneCliUserDataName";
pub const PLIST_OPEN_EXTENSIONS: &str = "PuppyOneOpenExtensions";
pub const PLIST_OPEN_MAX_BYTES: &str = "PuppyOneOpenMaxBytes";
/// `CLI_CONTROL_ERROR_CODES`.
pub const ERROR_CODES: [&str; 7] = [
    "BAD_REQUEST",
    "PROTOCOL_UNSUPPORTED",
    "PATH_NOT_FOUND",
    "NOT_A_FILE_OR_FOLDER",
    "UNSUPPORTED_TYPE",
    "FILE_TOO_LARGE",
    "OPEN_FAILED",
];
/// `sockaddr_un.sun_path` is 104 bytes on macOS, the terminator included.
const MAX_SOCKET_PATH_BYTES: usize = 103;

/// `resolveCliControlEndpoint`: where the app listens for one user and one
/// data directory. The CLI computes the same path from Info.plist; a long
/// home directory falls back to a per-user directory under /tmp.
pub fn endpoint(user_data: &Path, uid: u32) -> PathBuf {
    let preferred = user_data.join("cli").join("control.sock");
    if preferred.as_os_str().len() <= MAX_SOCKET_PATH_BYTES {
        return preferred;
    }
    use sha2::Digest;
    let digest = sha2::Sha256::digest(user_data.as_os_str().as_encoded_bytes());
    let identity: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    PathBuf::from("/tmp")
        .join(format!("puppyone-cli-{uid}"))
        .join(format!("{identity}.sock"))
}

/// Who answers: `{ name, version, channel }`.
#[derive(Clone, Debug)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub channel: String,
}

/// A request that passed the protocol's checks.
#[derive(Clone, Debug, PartialEq)]
pub enum Request {
    Hello,
    /// Absolute paths, and whether the app comes to the front.
    Open {
        paths: Vec<String>,
        activate: bool,
    },
}

pub fn failure(code: &str, message: &str) -> Value {
    json!({"ok": false, "error": {"code": code, "message": message}})
}
fn envelope(app: &AppInfo, fields: Value) -> Value {
    let mut value = json!({
        "ok": true,
        "protocol": PROTOCOL,
        "minProtocol": MIN_PROTOCOL,
        "app": {"name": app.name, "version": app.version, "channel": app.channel},
    });
    if let (Some(value), Some(fields)) = (value.as_object_mut(), fields.as_object()) {
        value.extend(fields.clone());
    }
    value
}
/// The answer to `hello`: what `open` accepts.
pub fn hello(app: &AppInfo, extensions: &[String], max_bytes: u64) -> Value {
    envelope(
        app,
        json!({"open": {"extensions": extensions, "maxBytes": max_bytes}}),
    )
}
/// The answer to `open`: one result per requested path.
pub fn opened(app: &AppInfo, results: Vec<Value>) -> Value {
    envelope(app, json!({ "results": results }))
}
/// One path's outcome; `path` is the path as it was requested.
pub fn result(path: &str, outcome: Result<Opened, (&'static str, String)>) -> Value {
    match outcome {
        Ok(opened) => json!({
            "path": path,
            "status": if opened.focused { "focused" } else { "opened" },
            "kind": if opened.folder { "folder" } else { "file" },
            "window": if opened.folder { "project" } else { "file" },
        }),
        Err((code, message)) => json!({
            "path": path,
            "status": "rejected",
            "error": {"code": code, "message": message},
        }),
    }
}
/// Where a path went: a folder's project window or a file's own window,
/// new or already open.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Opened {
    pub folder: bool,
    pub focused: bool,
}

/// `createCliControlRequests`' checks. `Err` is the whole answer.
pub fn parse(line: &str, app: &AppInfo) -> Result<Request, Value> {
    if line.len() > REQUEST_BYTES {
        return Err(failure("BAD_REQUEST", "The request is too large."));
    }
    let request: Value = serde_json::from_str(line).unwrap_or(Value::Null);
    let Some(protocol) = request
        .as_object()
        .and_then(|r| r.get("protocol"))
        .and_then(Value::as_i64)
    else {
        return Err(failure(
            "BAD_REQUEST",
            "The request is not a command-line request.",
        ));
    };
    if protocol < MIN_PROTOCOL as i64 || protocol > PROTOCOL as i64 {
        let mut answer = failure(
            "PROTOCOL_UNSUPPORTED",
            &format!("PuppyOne speaks protocol {MIN_PROTOCOL} to {PROTOCOL}."),
        );
        answer["protocol"] = json!(PROTOCOL);
        answer["minProtocol"] = json!(MIN_PROTOCOL);
        answer["app"] = json!({"name": app.name, "version": app.version, "channel": app.channel});
        return Err(answer);
    }
    match request["type"].as_str() {
        Some("hello") => Ok(Request::Hello),
        Some("open") => {
            let paths = request["paths"].as_array().filter(|paths| {
                !paths.is_empty()
                    && paths.len() <= MAX_PATHS
                    && paths.iter().all(|p| p.as_str().is_some_and(request_path))
            });
            let Some(paths) = paths else {
                return Err(failure(
                    "BAD_REQUEST",
                    &format!("Send 1 to {MAX_PATHS} absolute paths."),
                ));
            };
            let activate = match &request["activate"] {
                Value::Null => true,
                Value::Bool(activate) => *activate,
                _ => {
                    return Err(failure("BAD_REQUEST", "activate must be true or false."));
                }
            };
            Ok(Request::Open {
                paths: paths
                    .iter()
                    .filter_map(|p| p.as_str().map(str::to_owned))
                    .collect(),
                activate,
            })
        }
        _ => Err(failure("BAD_REQUEST", "Unknown request type.")),
    }
}
fn request_path(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= MAX_PATH_LENGTH
        && !value.contains('\0')
        && Path::new(value).is_absolute()
}

static SERVING: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
/// The endpoint this app answers at, once it listens; terminals name it
/// (`PUPPYONE_CLI_ENDPOINT`) so `puppyone open` reaches this app.
pub fn serving() -> Option<&'static Path> {
    SERVING.get().map(PathBuf::as_path)
}
/// The `.app` a packaged build runs from (`PUPPYONE_APP_PATH`).
pub fn bundle_path() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let bundle = executable.parent()?.parent()?.parent()?.to_path_buf();
    (bundle.extension().and_then(|e| e.to_str()) == Some("app")).then_some(bundle)
}
/// A request on its way to the app, and where its answer goes.
pub struct Incoming {
    pub request: Result<Request, Value>,
    pub reply: async_channel::Sender<Value>,
}

/// `createCliControlServer().start()`: listens at `endpoint` on a thread of
/// its own; each request reaches the app through the channel, and its
/// answer goes back on the connection, even after the client stopped
/// sending (`allowHalfOpen`).
pub fn serve(endpoint: &Path, app: AppInfo) -> std::io::Result<async_channel::Receiver<Incoming>> {
    let directory = endpoint.parent().unwrap_or(Path::new("/"));
    prepare_directory(directory)?;
    match std::fs::remove_file(endpoint) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error),
        _ => {}
    }
    let listener = UnixListener::bind(endpoint)?;
    std::fs::set_permissions(endpoint, std::fs::Permissions::from_mode(0o600))?;
    let _ = SERVING.set(endpoint.to_path_buf());
    let (tx, rx) = async_channel::unbounded();
    std::thread::Builder::new()
        .name("puppyone-cli-control".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let (tx, app) = (tx.clone(), app.clone());
                let _ = std::thread::Builder::new()
                    .name("puppyone-cli-request".into())
                    .spawn(move || accept(stream, &tx, &app));
            }
        })?;
    Ok(rx)
}
/// The /tmp fallback is shared ground: never listen inside someone else's
/// directory.
fn prepare_directory(directory: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(directory)?;
    let metadata = std::fs::symlink_metadata(directory)?;
    let uid = unsafe { libc::getuid() };
    if !metadata.is_dir() || metadata.uid() != uid {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "The command-line control directory is not owned by this user.",
        ));
    }
    if metadata.mode() & 0o077 != 0 {
        std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
fn accept(mut stream: UnixStream, tx: &async_channel::Sender<Incoming>, app: &AppInfo) {
    let _ = stream.set_read_timeout(Some(REQUEST_TIMEOUT));
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let line = loop {
        match stream.read(&mut chunk) {
            // Stopped sending before a whole request: nothing to answer.
            Ok(0) | Err(_) => return,
            Ok(n) => {
                buffer.extend_from_slice(&chunk[..n]);
                if let Some(end) = buffer.iter().position(|b| *b == b'\n') {
                    buffer.truncate(end);
                    break buffer;
                }
                if buffer.len() > REQUEST_BYTES {
                    return;
                }
            }
        }
    };
    let request = match String::from_utf8(line) {
        Ok(line) => parse(&line, app),
        Err(_) => Err(failure(
            "BAD_REQUEST",
            "The request is not a command-line request.",
        )),
    };
    let (reply, answer) = async_channel::bounded(1);
    let response = if tx.send_blocking(Incoming { request, reply }).is_ok() {
        answer
            .recv_blocking()
            .unwrap_or_else(|_| failure("OPEN_FAILED", "PuppyOne could not handle the request."))
    } else {
        failure("OPEN_FAILED", "PuppyOne could not handle the request.")
    };
    let mut line = response.to_string();
    line.push('\n');
    let _ = stream.write_all(line.as_bytes());
    let _ = stream.shutdown(std::net::Shutdown::Both);
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn app() -> AppInfo {
        AppInfo {
            name: "PuppyOne".into(),
            version: "1.0.0".into(),
            channel: "dev".into(),
        }
    }

    /// The pinned contract, byte for byte, and these constants with it.
    #[test]
    fn the_protocol_is_the_pinned_contract() {
        use sha2::Digest;
        let contract = include_str!("../../contracts/cli-control-protocol.mjs");
        let digest: String = sha2::Sha256::digest(contract.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(digest, CONTRACT_DIGEST);
        for needle in [
            format!("CLI_CONTROL_PROTOCOL = {PROTOCOL};"),
            format!("CLI_CONTROL_MIN_PROTOCOL = {MIN_PROTOCOL};"),
            format!("CLI_LAUNCH_ARGUMENT = \"{LAUNCH_ARGUMENT}\";"),
            "requestBytes: 64 * 1024,".into(),
            "requestTimeoutMs: 5_000,".into(),
            format!("maxPaths: {MAX_PATHS},"),
            "maxPathLength: 4_096,".into(),
            "launchWaitMs: 10_000,".into(),
            format!("protocol: \"{PLIST_PROTOCOL}\","),
            format!("userDataName: \"{PLIST_USER_DATA_NAME}\","),
            format!("openExtensions: \"{PLIST_OPEN_EXTENSIONS}\","),
            format!("openMaxBytes: \"{PLIST_OPEN_MAX_BYTES}\","),
        ] {
            assert!(contract.contains(&needle), "{needle}");
        }
        let listed = contract
            .split("CLI_CONTROL_ERROR_CODES = Object.freeze([")
            .nth(1)
            .and_then(|rest| rest.split("]);").next())
            .unwrap();
        let codes: Vec<&str> = listed
            .split(',')
            .map(|c| c.trim().trim_matches('"'))
            .filter(|c| !c.is_empty())
            .collect();
        assert_eq!(codes, ERROR_CODES);
    }

    #[test]
    fn requests_are_checked_before_anything_opens() {
        let app = app();
        let code = |line: &str| parse(line, &app).unwrap_err()["error"]["code"].clone();
        assert_eq!(code("not json"), "BAD_REQUEST");
        assert_eq!(code(r#"{"type":"hello"}"#), "BAD_REQUEST");
        assert_eq!(
            code(r#"{"protocol":2,"type":"hello"}"#),
            "PROTOCOL_UNSUPPORTED"
        );
        assert_eq!(code(r#"{"protocol":1,"type":"list"}"#), "BAD_REQUEST");
        assert_eq!(
            code(r#"{"protocol":1,"type":"open","paths":[]}"#),
            "BAD_REQUEST"
        );
        assert_eq!(
            code(r#"{"protocol":1,"type":"open","paths":["relative"]}"#),
            "BAD_REQUEST"
        );
        assert_eq!(
            code(r#"{"protocol":1,"type":"open","paths":["/a"],"activate":"yes"}"#),
            "BAD_REQUEST"
        );
        let many = format!(
            r#"{{"protocol":1,"type":"open","paths":[{}]}}"#,
            vec!["\"/a\""; MAX_PATHS + 1].join(",")
        );
        assert_eq!(code(&many), "BAD_REQUEST");
        assert_eq!(
            parse(
                r#"{"protocol":1,"type":"open","paths":["/a","/b"],"activate":false}"#,
                &app
            ),
            Ok(Request::Open {
                paths: vec!["/a".into(), "/b".into()],
                activate: false
            })
        );
        assert_eq!(
            parse(r#"{"protocol":1,"type":"hello"}"#, &app),
            Ok(Request::Hello)
        );
        let answer = hello(&app, &[".md".into()], 1024);
        assert_eq!(answer["ok"], true);
        assert_eq!(answer["open"]["extensions"][0], ".md");
        assert_eq!(answer["app"]["channel"], "dev");
    }

    #[test]
    fn the_endpoint_falls_back_under_tmp_for_a_long_home() {
        assert_eq!(
            endpoint(
                Path::new("/Users/a/Library/Application Support/PuppyOne"),
                501
            ),
            PathBuf::from("/Users/a/Library/Application Support/PuppyOne/cli/control.sock")
        );
        let long = PathBuf::from(format!("/Users/{}/PuppyOne", "x".repeat(100)));
        let fallback = endpoint(&long, 501);
        assert!(fallback.starts_with("/tmp/puppyone-cli-501"));
        assert_eq!(fallback.extension().and_then(|e| e.to_str()), Some("sock"));
        assert_eq!(fallback.file_stem().unwrap().len(), 16);
    }

    /// A client that sends its line and stops sending still gets its
    /// answer on the same connection.
    #[test]
    fn a_half_closed_request_is_answered() {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("cli/control.sock");
        let incoming = serve(&socket, app()).unwrap();
        std::thread::spawn(move || {
            while let Ok(Incoming { request, reply }) = incoming.recv_blocking() {
                let answer = match request {
                    Ok(Request::Hello) => hello(&app(), &[], 1),
                    Ok(Request::Open { paths, .. }) => opened(
                        &app(),
                        paths
                            .iter()
                            .map(|p| {
                                result(p, Err(("PATH_NOT_FOUND", format!("{p} does not exist."))))
                            })
                            .collect(),
                    ),
                    Err(answer) => answer,
                };
                let _ = reply.send_blocking(answer);
            }
        });
        let mode = std::fs::metadata(&socket).unwrap().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let mut client = UnixStream::connect(&socket).unwrap();
        client
            .write_all(b"{\"protocol\":1,\"type\":\"open\",\"paths\":[\"/nowhere\"]}\n")
            .unwrap();
        client.shutdown(std::net::Shutdown::Write).unwrap();
        let mut answer = String::new();
        client.read_to_string(&mut answer).unwrap();
        let answer: Value = serde_json::from_str(answer.trim()).unwrap();
        assert_eq!(answer["results"][0]["status"], "rejected");
        assert_eq!(answer["results"][0]["error"]["code"], "PATH_NOT_FOUND");
    }
}

#[cfg(test)]
const CONTRACT_DIGEST: &str = "5e6f53c3b594f56aa2b0ee7232f5fc93a76e6e3085dd49024753de5ec1133d2a";
