//! Port of `transport/hook-session-auth.mjs`, `transport/hook-ingest-server.mjs`
//! and `security/activity-frame-policy.mjs`: a per-user Unix socket that
//! accepts one newline-terminated frame per connection, each carrying a
//! token issued to one prepared terminal session.
use super::{SCHEMA_VERSION, identifier, limits, projector::Projected, valid_provider_id};
use serde_json::Value;
use std::{
    collections::HashMap,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

/// `createHookSessionAuth`: one 32-byte token per terminal session; only its
/// SHA-256 digest is kept.
pub struct Auth {
    sessions: HashMap<String, Issued>,
    ttl: Duration,
}
struct Issued {
    provider_id: String,
    digest: [u8; 32],
    expires: Instant,
}
impl Default for Auth {
    fn default() -> Self {
        Self {
            sessions: HashMap::new(),
            ttl: Duration::from_secs(12 * 60 * 60),
        }
    }
}
impl Auth {
    pub fn issue(&mut self, terminal_session_id: &str, provider_id: &str) -> String {
        use base64::Engine as _;
        let mut bytes = [0u8; 32];
        // Without the OS generator no token is issued (verification fails).
        if getrandom::fill(&mut bytes).is_err() {
            self.sessions.remove(terminal_session_id);
            return String::new();
        }
        let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
        self.sessions.insert(
            terminal_session_id.into(),
            Issued {
                provider_id: provider_id.into(),
                digest: digest(&token),
                expires: Instant::now() + self.ttl,
            },
        );
        token
    }
    pub fn verify(&mut self, terminal_session_id: &str, provider_id: &str, token: &str) -> bool {
        if token.len() < 32 || token.len() > 128 {
            return false;
        }
        let Some(issued) = self.sessions.get(terminal_session_id) else {
            return false;
        };
        if issued.expires <= Instant::now() {
            self.sessions.remove(terminal_session_id);
            return false;
        }
        if issued.provider_id != "*" && issued.provider_id != provider_id {
            return false;
        }
        // Constant-time comparison of the digests.
        let actual = digest(token);
        actual
            .iter()
            .zip(issued.digest.iter())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
    }
    pub fn revoke(&mut self, terminal_session_id: &str) -> bool {
        self.sessions.remove(terminal_session_id).is_some()
    }
}
fn digest(token: &str) -> [u8; 32] {
    use sha2::Digest as _;
    sha2::Sha256::digest(token.as_bytes()).into()
}

/// `parseHookIngestEnvelope`.
#[derive(Clone, Debug, PartialEq)]
pub struct Envelope {
    pub terminal_session_id: String,
    pub provider_id: String,
    pub token: String,
    pub payload: Projected,
}
impl Envelope {
    pub fn parse(value: &Value) -> Option<Self> {
        if value.get("schemaVersion").and_then(Value::as_u64) != Some(SCHEMA_VERSION) {
            return None;
        }
        let text = |key: &str| {
            value
                .get(key)
                .and_then(Value::as_str)
                .filter(|v| identifier(v, 128))
                .map(str::to_owned)
        };
        let provider_id = value
            .get("providerId")
            .and_then(Value::as_str)
            .filter(|p| valid_provider_id(p))?;
        Some(Self {
            terminal_session_id: text("terminalSessionId")?,
            token: text("token")?,
            provider_id: provider_id.into(),
            payload: Projected::from_json(value.get("payload")?)?,
        })
    }
    pub fn to_frame(&self) -> String {
        let mut frame = serde_json::json!({
            "schemaVersion": SCHEMA_VERSION,
            "terminalSessionId": self.terminal_session_id,
            "providerId": self.provider_id,
            "token": self.token,
            "payload": self.payload.to_json(),
        })
        .to_string();
        frame.push('\n');
        frame
    }
}

/// `resolveEndpoint`: `<runtime>/activity.sock`, or a per-user directory
/// under the temporary directory when that path is too long for a socket.
pub fn endpoint(runtime_dir: &Path) -> PathBuf {
    use sha2::Digest as _;
    let preferred = runtime_dir.join("activity.sock");
    if preferred.as_os_str().len() <= 96 {
        return preferred;
    }
    let hash = sha2::Sha256::digest(runtime_dir.to_string_lossy().as_bytes());
    let identity: String = hash.iter().take(6).map(|b| format!("{b:02x}")).collect();
    #[cfg(unix)]
    let user = unsafe { libc::getuid() };
    #[cfg(not(unix))]
    let user = std::process::id();
    std::env::temp_dir()
        .join(format!("puppyone-aa-{user}-{identity}"))
        .join("activity.sock")
}

/// A frame that passed the envelope policy and its session's token.
pub type Handler = Arc<dyn Fn(Envelope) -> bool + Send + Sync>;
/// The listening socket. Dropping it stops accepting and removes the socket.
pub struct Server {
    pub endpoint: PathBuf,
    stop: Arc<std::sync::atomic::AtomicBool>,
}
const MAX_CONNECTIONS: usize = 16;
impl Server {
    /// `start`: a private directory (0700), a fresh socket (0600) and an
    /// accept thread. `verify` checks the envelope's token.
    #[cfg(unix)]
    pub fn start(
        endpoint: PathBuf,
        verify: Arc<dyn Fn(&Envelope) -> bool + Send + Sync>,
        handle: Handler,
    ) -> std::io::Result<Self> {
        use std::os::unix::{fs::PermissionsExt, net::UnixListener};
        let dir = endpoint.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
        std::fs::create_dir_all(dir)?;
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        match std::fs::remove_file(&endpoint) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
            _ => {}
        }
        let listener = UnixListener::bind(&endpoint)?;
        let _ = std::fs::set_permissions(&endpoint, std::fs::Permissions::from_mode(0o600));
        listener.set_nonblocking(true)?;
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stopping = stop.clone();
        let active = Arc::new(AtomicUsize::new(0));
        std::thread::Builder::new()
            .name("agent-activity-ingest".into())
            .spawn(move || {
                while !stopping.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            if active.load(Ordering::Relaxed) >= MAX_CONNECTIONS {
                                continue;
                            }
                            active.fetch_add(1, Ordering::Relaxed);
                            let (verify, handle, active) =
                                (verify.clone(), handle.clone(), active.clone());
                            std::thread::spawn(move || {
                                let _ = stream.set_nonblocking(false);
                                let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
                                if let Some(frame) = read_frame(stream) {
                                    process_frame(&frame, verify.as_ref(), handle.as_ref());
                                }
                                active.fetch_sub(1, Ordering::Relaxed);
                            });
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(20))
                        }
                        Err(_) => std::thread::sleep(Duration::from_millis(100)),
                    }
                }
            })?;
        Ok(Self { endpoint, stop })
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = std::fs::remove_file(&self.endpoint);
    }
}

/// One frame: bytes up to the first newline, at most 64 KiB in total.
fn read_frame(mut stream: impl Read) -> Option<String> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..n]);
        if buffer.len() > limits::FRAME_BYTES {
            return None;
        }
        if let Some(end) = buffer.iter().position(|b| *b == b'\n') {
            buffer.truncate(end);
            return String::from_utf8(buffer).ok();
        }
    }
}
/// `processFrame`: parse, apply the envelope policy, verify the token, hand over.
pub fn process_frame(
    frame: &str,
    verify: &(dyn Fn(&Envelope) -> bool + Send + Sync),
    handle: &(dyn Fn(Envelope) -> bool + Send + Sync),
) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(frame) else {
        return false;
    };
    let Some(envelope) = Envelope::parse(&value) else {
        return false;
    };
    verify(&envelope) && handle(envelope)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn tokens_belong_to_one_session_and_provider() {
        let mut auth = Auth::default();
        let token = auth.issue("t1", "codex");
        assert!(token.len() >= 43);
        assert!(auth.verify("t1", "codex", &token));
        assert!(!auth.verify("t1", "claude", &token));
        assert!(!auth.verify("t2", "codex", &token));
        assert!(!auth.verify("t1", "codex", &format!("{token}x")));
        let shell = auth.issue("t2", "*");
        assert!(auth.verify("t2", "claude", &shell));
        // Re-issuing replaces the old token; revoking ends it.
        let again = auth.issue("t1", "codex");
        assert!(!auth.verify("t1", "codex", &token));
        assert!(auth.verify("t1", "codex", &again));
        assert!(auth.revoke("t1"));
        assert!(!auth.verify("t1", "codex", &again));
        auth.ttl = Duration::ZERO;
        let expired = auth.issue("t3", "pi");
        assert!(!auth.verify("t3", "pi", &expired));
    }
    #[test]
    fn long_runtime_directories_use_a_short_private_socket_path() {
        let short = endpoint(Path::new("/tmp/x"));
        assert_eq!(short, PathBuf::from("/tmp/x/activity.sock"));
        let long = endpoint(&Path::new("/").join("a".repeat(120)));
        assert!(long.as_os_str().len() < 104);
        assert!(long.to_string_lossy().contains("puppyone-aa-"));
    }
    #[cfg(unix)]
    #[test]
    fn the_socket_accepts_one_verified_frame_per_connection() {
        use std::io::Write as _;
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("rt/activity.sock");
        let received = Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = received.clone();
        let server = Server::start(
            socket.clone(),
            Arc::new(|e: &Envelope| e.token == "t".repeat(40)),
            Arc::new(move |e| {
                sink.lock().unwrap().push(e);
                true
            }),
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt as _;
        assert_eq!(
            std::fs::metadata(&socket).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let envelope = |token: String| Envelope {
            terminal_session_id: "t1".into(),
            provider_id: "codex".into(),
            token,
            payload: Projected {
                event_name: "PreToolUse".into(),
                session_id: None,
                turn_id: None,
                tool_call_id: "c".into(),
                tool_name: "Read".into(),
                cwd: "/".into(),
                input: Default::default(),
            },
        };
        for token in ["t".repeat(40), "u".repeat(40)] {
            let mut stream = std::os::unix::net::UnixStream::connect(&socket).unwrap();
            stream
                .write_all(envelope(token).to_frame().as_bytes())
                .unwrap();
        }
        let mut stream = std::os::unix::net::UnixStream::connect(&socket).unwrap();
        stream.write_all(b"not json\n").unwrap();
        drop(stream);
        let deadline = Instant::now() + Duration::from_secs(5);
        while received.lock().unwrap().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(*received.lock().unwrap(), [envelope("t".repeat(40))]);
        drop(server);
        assert!(!socket.exists());
    }
}
