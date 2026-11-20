//! Real first-push transport against Git's permissive smart-HTTP backend.
//! This proves the CLI's lease, not Cloud API authentication or TLS behavior.
use super::*;
use crate::platform::process::{self, OutputLimits, OutputOptions};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::Duration,
};

pub(super) fn git(root: &Path, args: &[&str]) -> String {
    String::from_utf8(
        process::run(
            Path::new("/usr/bin/git"),
            args,
            root,
            None,
            Duration::from_secs(10),
            &AtomicBool::new(false),
        )
        .unwrap(),
    )
    .unwrap()
    .trim()
    .to_owned()
}

pub(super) struct Server {
    pub(super) root: tempfile::TempDir,
    address: SocketAddr,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    pub(super) attempts: Arc<Mutex<Vec<String>>>,
}
impl Server {
    pub(super) fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        git(root.path(), &["init", "-q", "--bare", "repo.git"]);
        git(
            &root.path().join("repo.git"),
            &["config", "http.receivepack", "true"],
        );
        git(
            &root.path().join("repo.git"),
            &["config", "receive.denyNonFastForwards", "false"],
        );
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let project_root = root.path().to_path_buf();
        let attempts = Arc::new(Mutex::new(vec![]));
        let observed = attempts.clone();
        let thread = std::thread::spawn(move || {
            for incoming in listener.incoming() {
                let socket = incoming.unwrap();
                if stopped.load(Ordering::Acquire) {
                    break;
                }
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                socket
                    .set_write_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut reader = BufReader::new(socket);
                let mut first = String::new();
                reader.read_line(&mut first).unwrap();
                let fields: Vec<_> = first.split_whitespace().collect();
                assert_eq!(fields.len(), 3, "invalid fixture HTTP request");
                let (route, query) = fields[1].split_once('?').unwrap_or((fields[1], ""));
                assert!(
                    route.starts_with("/repo.git/"),
                    "unexpected fixture repository"
                );
                let mut headers = std::collections::HashMap::new();
                let mut header_bytes = first.len();
                loop {
                    let mut line = String::new();
                    assert!(
                        reader.read_line(&mut line).unwrap() > 0,
                        "truncated HTTP header"
                    );
                    header_bytes += line.len();
                    assert!(header_bytes <= 64 * 1024);
                    if line == "\r\n" {
                        break;
                    }
                    let (name, value) = line.trim_end().split_once(':').unwrap();
                    headers.insert(name.to_ascii_lowercase(), value.trim().to_string());
                }
                assert!(
                    !headers.contains_key("transfer-encoding"),
                    "small fixture must use a bounded body"
                );
                let length: usize = headers
                    .get("content-length")
                    .map_or(0, |s| s.parse().unwrap());
                assert!(length <= 1024 * 1024);
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                if fields[0] == "POST" {
                    assert!(matches!(
                        route,
                        "/repo.git/git-receive-pack" | "/repo.git/git-upload-pack"
                    ));
                    if route.ends_with("/git-receive-pack") {
                        observed.lock().unwrap().push(
                            headers
                                .get("x-puppyone-initial-attempt")
                                .cloned()
                                .unwrap_or_default(),
                        );
                    }
                }
                let root_value = project_root.to_str().unwrap();
                let content_length = length.to_string();
                let content_type = headers
                    .get("content-type")
                    .map(String::as_str)
                    .unwrap_or("");
                let protocol = headers
                    .get("git-protocol")
                    .map(String::as_str)
                    .unwrap_or("");
                let env = [
                    ("GIT_PROJECT_ROOT", root_value),
                    ("GIT_HTTP_EXPORT_ALL", "1"),
                    ("REQUEST_METHOD", fields[0]),
                    ("PATH_INFO", route),
                    ("QUERY_STRING", query),
                    ("CONTENT_LENGTH", &content_length),
                    ("CONTENT_TYPE", content_type),
                    ("REMOTE_USER", "fixture"),
                    ("REMOTE_ADDR", "127.0.0.1"),
                    ("GIT_PROTOCOL", protocol),
                ];
                let response = process::run_output_with(
                    Path::new("/usr/bin/git"),
                    &["http-backend"],
                    &project_root,
                    Some(&body),
                    Duration::from_secs(5),
                    &AtomicBool::new(false),
                    OutputOptions {
                        limits: OutputLimits {
                            stdout: 2 * 1024 * 1024,
                            stderr: 128 * 1024,
                        },
                        environment: &env,
                    },
                )
                .unwrap()
                .stdout;
                let (split, delimiter) = response
                    .windows(4)
                    .position(|b| b == b"\r\n\r\n")
                    .map(|i| (i, 4))
                    .or_else(|| {
                        response
                            .windows(2)
                            .position(|b| b == b"\n\n")
                            .map(|i| (i, 2))
                    })
                    .unwrap();
                let raw_headers = std::str::from_utf8(&response[..split]).unwrap();
                let status = raw_headers
                    .lines()
                    .find_map(|line| line.strip_prefix("Status: "))
                    .unwrap_or("200 OK");
                let body = &response[split + delimiter..];
                let mut socket = reader.into_inner();
                write!(
                    socket,
                    "HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: {}\r\n",
                    body.len()
                )
                .unwrap();
                for header in raw_headers.lines().filter(|h| !h.starts_with("Status:")) {
                    write!(socket, "{}\r\n", header.trim_end()).unwrap();
                }
                socket.write_all(b"\r\n").unwrap();
                socket.write_all(body).unwrap();
            }
        });
        Self {
            root,
            address,
            stop,
            thread: Some(thread),
            attempts,
        }
    }
    pub(super) fn url(&self) -> String {
        format!("http://{}/repo.git", self.address)
    }
    pub(super) fn bare(&self) -> std::path::PathBuf {
        self.root.path().join("repo.git")
    }
    fn main(&self) -> String {
        git(&self.bare(), &["rev-parse", "refs/heads/main"])
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = TcpStream::connect(self.address);
        if let Some(thread) = self.thread.take() {
            let outcome = thread.join();
            if !std::thread::panicking() {
                outcome.unwrap();
            }
        }
    }
}

fn configured(root: &Path, server: &Server) -> (Cli, Record) {
    // The credential store is private fixture data. No system keychain/helper
    // receives this deliberately fake secret.
    let helper = format!(
        "store --file={}",
        server.root.path().join("credentials").display()
    );
    let cli = Cli {
        helper: Some(helper),
    };
    let url = server.url();
    let config = cli
        .prepare_credential_config(root, &url, "fixture-op")
        .unwrap();
    let commit = cli.source_commit(root, "main").unwrap();
    let mut record = super::super::initial_record(&request(root), "fixture", &commit);
    record.project_id = Some("fixture-project".into());
    record.credential_id = Some("fixture-credential".into());
    record.canonical_remote_url = Some(url);
    record.credential_username = Some(api::GIT_USERNAME.into());
    record.credential_config_snapshot = Some(config);
    record.remote_add_intent = true;
    assert!(cli.configure_remote(root, &record, "pwg_fixture").unwrap());
    (cli, record)
}

#[test]
fn real_first_push_sends_the_pinned_commit_and_reconciles_an_identical_retry() {
    let local = repository();
    let server = Server::new();
    let (cli, record) = configured(local.path(), &server);
    // The checkout advances after the journal pins the upload.
    std::fs::write(local.path().join("later.md"), "not part of this upload").unwrap();
    git(local.path(), &["add", "later.md"]);
    git(local.path(), &["commit", "-qm", "later"]);
    let later = git(local.path(), &["rev-parse", "HEAD"]);
    assert_ne!(later, record.attempt.commit_oid);
    cli.push(local.path(), &record, "pwg_fixture").unwrap();
    assert_eq!(server.main(), record.attempt.commit_oid);
    assert_eq!(
        server.attempts.lock().unwrap().as_slice(),
        std::slice::from_ref(&record.attempt.attempt_id)
    );
    assert!(!git(&server.bare(), &["ls-tree", "-r", "--name-only", "main"]).contains("later.md"));
    cli.push(local.path(), &record, "pwg_fixture").unwrap();
    assert_eq!(server.main(), record.attempt.commit_oid);
    assert_eq!(
        server.attempts.lock().unwrap().len(),
        1,
        "same-tip retry must not upload again"
    );
    cli.cleanup(local.path(), &record).unwrap();
    assert_eq!(
        server.main(),
        record.attempt.commit_oid,
        "local cleanup cannot delete Cloud history"
    );
}

#[test]
fn real_first_push_refuses_a_competing_main_even_when_the_server_allows_forcing() {
    let local = repository();
    let server = Server::new();
    let (cli, record) = configured(local.path(), &server);
    let other = repository();
    std::fs::write(other.path().join("cloud.md"), "someone else's change").unwrap();
    git(other.path(), &["add", "cloud.md"]);
    git(other.path(), &["commit", "-qm", "Cloud change"]);
    git(
        other.path(),
        &["push", server.bare().to_str().unwrap(), "main"],
    );
    let competing = server.main();
    let error = cli.push(local.path(), &record, "pwg_fixture").unwrap_err();
    assert_eq!(error.code, Code::RemoteRefConflict);
    assert!(!error.retryable);
    assert_eq!(server.main(), competing);
    assert!(
        server.attempts.lock().unwrap().is_empty(),
        "stale lease must reject before upload"
    );
    // Positive control: this private test server permits the overwrite that
    // the production initial-push client must refuse.
    git(
        local.path(),
        &[
            "push",
            "--force",
            server.bare().to_str().unwrap(),
            &format!("{}:refs/heads/main", record.attempt.commit_oid),
        ],
    );
    assert_eq!(server.main(), record.attempt.commit_oid);
}

#[test]
fn real_first_push_requires_absence_even_when_updating_main_would_be_a_fast_forward() {
    let local = repository();
    let server = Server::new();
    git(
        local.path(),
        &["push", server.bare().to_str().unwrap(), "main"],
    );
    let existing = server.main();
    std::fs::write(local.path().join("next.md"), "next local change").unwrap();
    git(local.path(), &["add", "next.md"]);
    git(local.path(), &["commit", "-qm", "next"]);
    let (cli, record) = configured(local.path(), &server);
    assert_ne!(existing, record.attempt.commit_oid);
    let error = cli.push(local.path(), &record, "pwg_fixture").unwrap_err();
    assert_eq!(error.code, Code::RemoteRefConflict);
    assert_eq!(server.main(), existing);
    assert!(server.attempts.lock().unwrap().is_empty());
    // Ordinary Git would accept this update: the initial-publication lease
    // enforces absence, a stronger precondition than fast-forward safety.
    git(
        local.path(),
        &["push", server.bare().to_str().unwrap(), "main"],
    );
    assert_eq!(server.main(), record.attempt.commit_oid);
}
