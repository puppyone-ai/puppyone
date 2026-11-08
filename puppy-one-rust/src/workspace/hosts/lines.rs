//! The `puppyone-files` channel (`transport.files_subsystem`): one JSON
//! object per line in both directions — numbered requests and replies, and
//! watches whose events carry the watch's number. The host serves it
//! (`serve`); the access side multiplexes requests over it (`FilesClient`).
use super::{
    files::{FileService, Watch},
    protocol::{
        CLIENT_READ_TIMEOUT, CLIENT_WRITE_TIMEOUT, Capability, MAX_LINE_BYTES,
        MAX_REQUESTS_IN_FLIGHT, MAX_WATCHES_PER_CHANNEL, Request, status,
    },
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader},
    sync::{mpsc, oneshot},
};

/// Error codes passed to the client as they are; anything else is
/// `file_operation_failed`.
const FILE_ERRORS: [&str; 15] = [
    "invalid_path",
    "not_found",
    "already_exists",
    "not_empty",
    "folder_unavailable",
    "root_changed",
    "unsupported_file",
    "too_many_entries",
    "invalid_content",
    "revision_required",
    "conflict",
    "not_allowed",
    "too_large",
    "unsupported",
    "file_operation_failed",
];

/// Whether this computer still allows the folder `capability` now.
pub type Allow = Arc<dyn Fn(Capability) -> bool + Send + Sync>;

/// Reads lines of at most `MAX_LINE_BYTES`; `None` at the end or past it.
async fn next_line<R: AsyncRead + Unpin>(reader: &mut BufReader<R>) -> Option<Vec<u8>> {
    let mut line = Vec::new();
    loop {
        let buffer = reader.fill_buf().await.ok()?;
        if buffer.is_empty() {
            return None;
        }
        match buffer.iter().position(|b| *b == b'\n') {
            Some(end) => {
                line.extend_from_slice(&buffer[..end]);
                reader.consume(end + 1);
                return (line.len() <= MAX_LINE_BYTES).then_some(line);
            }
            None => {
                let n = buffer.len();
                line.extend_from_slice(buffer);
                reader.consume(n);
                if line.len() > MAX_LINE_BYTES {
                    return None;
                }
            }
        }
    }
}
/// Writes each value as one line until every sender is gone.
fn writer<W: AsyncWrite + Unpin + Send + 'static>(mut write: W) -> mpsc::UnboundedSender<Value> {
    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    tokio::spawn(async move {
        while let Some(value) = rx.recv().await {
            let mut line = value.to_string();
            line.push('\n');
            if write.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
        let _ = write.shutdown().await;
    });
    tx
}

/// Serves the files protocol on `stream` for `folder` until it closes.
pub async fn serve<S>(
    stream: S,
    files: Arc<FileService>,
    git: Option<Arc<super::git::GitService>>,
    folder: String,
    allow: Allow,
) where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (read, write) = tokio::io::split(stream);
    let mut reader = BufReader::new(read);
    let send = writer(write);
    let inflight = Arc::new(AtomicUsize::new(0));
    let mut watches: HashMap<u64, Watch> = HashMap::new();
    while let Some(line) = next_line(&mut reader).await {
        let Ok(message) = serde_json::from_slice::<Value>(&line) else {
            break;
        };
        let Some(id) = message["id"].as_u64() else {
            break;
        };
        match message["op"].as_str() {
            Some("unwatch") => {
                watches.remove(&id);
            }
            Some("watch") => {
                let ended = json!({"watch": id, "paths": [], "reset": true, "ended": true});
                if watches.len() >= MAX_WATCHES_PER_CHANNEL || !allow(Capability::Read) {
                    let _ = send.send(ended);
                    continue;
                }
                let events = send.clone();
                match files.watch(&folder, move |paths, reset| {
                    let _ = events.send(json!({"watch": id, "paths": paths, "reset": reset}));
                }) {
                    Ok(watch) => {
                        watches.insert(id, watch);
                        let _ = send.send(json!({"id": id, "result": {"watching": true}}));
                    }
                    Err(_) => {
                        let _ = send.send(ended);
                    }
                }
            }
            Some("request") => {
                if inflight.load(Ordering::SeqCst) >= MAX_REQUESTS_IN_FLIGHT {
                    let _ = send.send(json!({"id": id, "error": "too_large"}));
                    continue;
                }
                let Ok(request) = serde_json::from_value::<Request>(message["request"].clone())
                else {
                    let _ = send.send(json!({"id": id, "error": "unsupported"}));
                    continue;
                };
                inflight.fetch_add(1, Ordering::SeqCst);
                let (files, git, folder, allow, send, inflight) = (
                    files.clone(),
                    git.clone(),
                    folder.clone(),
                    allow.clone(),
                    send.clone(),
                    inflight.clone(),
                );
                tokio::spawn(async move {
                    let outcome = tokio::task::spawn_blocking(move || {
                        // This computer's consent, read again for each request.
                        if !allow(Capability::Read) {
                            return Err("folder_unavailable");
                        }
                        if let Request::Git(operation) = &request {
                            // Git runs code: it needs this computer's own
                            // consent for the folder, and editing.
                            let git = git
                                .filter(|_| allow(Capability::Git) && allow(Capability::Write))
                                .ok_or("folder_unavailable")?;
                            return git.run(&files.root(&folder, Capability::Git)?, operation);
                        }
                        files.run(&folder, &request)
                    })
                    .await
                    .unwrap_or(Err("file_operation_failed"));
                    let reply = match outcome {
                        Ok(result) => json!({"id": id, "result": result}),
                        Err(code) => json!({"id": id, "error":
                            if FILE_ERRORS.contains(&code) { code } else { "file_operation_failed" }}),
                    };
                    let _ = send.send(reply);
                    inflight.fetch_sub(1, Ordering::SeqCst);
                });
            }
            _ => {
                let _ = send.send(json!({"id": id, "error": "unsupported"}));
            }
        }
    }
}

/// A failure as the editor understands it: the code, its HTTP-like status,
/// and whether a mutation may have been applied anyway (never replay it).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostError {
    pub code: String,
    pub status: u16,
    pub outcome_unknown: bool,
}
impl HostError {
    pub fn new(code: &str) -> Self {
        Self {
            code: code.to_owned(),
            status: status(code),
            outcome_unknown: false,
        }
    }
    fn lost(mutating: bool) -> Self {
        Self {
            outcome_unknown: mutating,
            ..Self::new("network_unavailable")
        }
    }
}
impl std::fmt::Display for HostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.code)
    }
}
impl std::error::Error for HostError {}

/// A watch's event: changed paths, or a reset (rescan); `None` when the
/// watch or the connection ended.
pub type WatchEvent = Option<(Vec<String>, bool)>;

struct Pending {
    reply: oneshot::Sender<Result<Value, HostError>>,
    mutating: bool,
}
#[derive(Default)]
struct Shared {
    pending: HashMap<u64, Pending>,
    watches: HashMap<u64, mpsc::UnboundedSender<WatchEvent>>,
}

/// The access side of one `puppyone-files` channel.
#[derive(Clone)]
pub struct FilesClient {
    send: mpsc::UnboundedSender<Value>,
    shared: Arc<Mutex<Shared>>,
    next: Arc<AtomicU64>,
    closed: Arc<AtomicBool>,
}
impl FilesClient {
    pub fn new<S>(stream: S) -> Self
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let (read, write) = tokio::io::split(stream);
        let client = Self {
            send: writer(write),
            shared: Arc::default(),
            next: Arc::new(AtomicU64::new(1)),
            closed: Arc::default(),
        };
        let (shared, closed) = (client.shared.clone(), client.closed.clone());
        tokio::spawn(async move {
            let mut reader = BufReader::new(read);
            while let Some(line) = next_line(&mut reader).await {
                let Ok(message) = serde_json::from_slice::<Value>(&line) else {
                    break;
                };
                let mut shared = shared.lock().unwrap();
                if let Some(watch) = message["watch"].as_u64() {
                    if message["ended"] == true {
                        if let Some(refused) = shared.pending.remove(&watch) {
                            let _ = refused
                                .reply
                                .send(Err(HostError::new("folder_unavailable")));
                        }
                        if let Some(events) = shared.watches.remove(&watch) {
                            let _ = events.send(None);
                        }
                    } else if let Some(events) = shared.watches.get(&watch) {
                        let paths = message["paths"]
                            .as_array()
                            .map(|paths| {
                                paths
                                    .iter()
                                    .filter_map(|p| p.as_str().map(str::to_owned))
                                    .collect()
                            })
                            .unwrap_or_default();
                        let _ = events.send(Some((paths, message["reset"] == true)));
                    }
                    continue;
                }
                let Some(id) = message["id"].as_u64() else {
                    continue;
                };
                if let Some(waiter) = shared.pending.remove(&id) {
                    let outcome = match message["error"].as_str() {
                        Some(code) => Err(HostError::new(code)),
                        None => Ok(message["result"].clone()),
                    };
                    let _ = waiter.reply.send(outcome);
                }
            }
            closed.store(true, Ordering::SeqCst);
            let mut shared = shared.lock().unwrap();
            for (_, waiter) in shared.pending.drain() {
                // The host may or may not have applied a mutation in flight.
                let _ = waiter.reply.send(Err(HostError::lost(waiter.mutating)));
            }
            for (_, events) in shared.watches.drain() {
                let _ = events.send(None);
            }
        });
        client
    }
    pub fn is_open(&self) -> bool {
        !self.closed.load(Ordering::SeqCst)
    }
    /// One request; a read gives up after 20 s, a write after 45 s, and a
    /// write whose reply never came is `outcome_unknown`.
    pub async fn request(&self, request: &Request) -> Result<Value, HostError> {
        let mutating = request.mutating();
        if !self.is_open() {
            return Err(HostError::lost(false));
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (reply, answer) = oneshot::channel();
        self.shared
            .lock()
            .unwrap()
            .pending
            .insert(id, Pending { reply, mutating });
        if self
            .send
            .send(json!({"id": id, "op": "request", "request": request}))
            .is_err()
        {
            self.shared.lock().unwrap().pending.remove(&id);
            return Err(HostError::lost(false));
        }
        let limit = if mutating {
            CLIENT_WRITE_TIMEOUT
        } else {
            CLIENT_READ_TIMEOUT
        };
        match tokio::time::timeout(limit, answer).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => Err(HostError::lost(mutating)),
            Err(_) => {
                self.shared.lock().unwrap().pending.remove(&id);
                Err(HostError {
                    outcome_unknown: mutating,
                    ..HostError::new("device_timeout")
                })
            }
        }
    }
    /// Starts a watch; its events arrive on the receiver until it or the
    /// connection ends (`None`). Dropping the guard unwatches.
    pub async fn watch(
        &self,
    ) -> Result<(WatchGuard, mpsc::UnboundedReceiver<WatchEvent>), HostError> {
        if !self.is_open() {
            return Err(HostError::lost(false));
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (events, receiver) = mpsc::unbounded_channel();
        let (reply, answer) = oneshot::channel();
        {
            let mut shared = self.shared.lock().unwrap();
            shared.watches.insert(id, events);
            shared.pending.insert(
                id,
                Pending {
                    reply,
                    mutating: false,
                },
            );
        }
        let _ = self.send.send(json!({"id": id, "op": "watch"}));
        match tokio::time::timeout(CLIENT_READ_TIMEOUT, answer).await {
            Ok(Ok(Ok(_))) => Ok((
                WatchGuard {
                    id,
                    send: self.send.clone(),
                    shared: self.shared.clone(),
                },
                receiver,
            )),
            Ok(Ok(Err(error))) => {
                self.shared.lock().unwrap().watches.remove(&id);
                Err(error)
            }
            _ => {
                let mut shared = self.shared.lock().unwrap();
                shared.watches.remove(&id);
                shared.pending.remove(&id);
                Err(HostError::new("device_timeout"))
            }
        }
    }
}
/// A running watch on the access side; dropping it unwatches.
pub struct WatchGuard {
    id: u64,
    send: mpsc::UnboundedSender<Value>,
    shared: Arc<Mutex<Shared>>,
}
impl Drop for WatchGuard {
    fn drop(&mut self) {
        if self
            .shared
            .lock()
            .unwrap()
            .watches
            .remove(&self.id)
            .is_some()
        {
            let _ = self.send.send(json!({"id": self.id, "op": "unwatch"}));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::files::{Folders, Grant};
    use super::*;

    struct One(std::path::PathBuf);
    impl Folders for One {
        fn resolve(&self, folder: &str) -> Option<Grant> {
            (folder == "f").then(|| Grant {
                root: self.0.clone(),
                active: true,
                capabilities: vec![Capability::Read, Capability::Write],
            })
        }
    }

    /// The protocol both ways over one stream: requests, errors, a watch,
    /// and the end of the connection failing what is in flight.
    #[tokio::test]
    async fn the_files_channel_carries_requests_errors_and_watches() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        std::fs::write(root.join("a.md"), "hello").unwrap();
        let files = Arc::new(FileService::new(Arc::new(One(root.clone()))));
        let (host, access) = tokio::io::duplex(64 * 1024);
        let served = tokio::spawn(serve(host, files, None, "f".into(), Arc::new(|_| true)));
        let client = FilesClient::new(access);
        let read = client
            .request(&Request::Read {
                path: "a.md".into(),
            })
            .await
            .unwrap();
        assert_eq!(read["content_base64"], "aGVsbG8=");
        let missing = client
            .request(&Request::Read {
                path: "nope.md".into(),
            })
            .await
            .unwrap_err();
        assert_eq!((missing.code.as_str(), missing.status), ("not_found", 404));
        let (guard, mut events) = client.watch().await.unwrap();
        assert_eq!(events.recv().await.unwrap(), Some((vec![], true)));
        std::fs::write(root.join("b.md"), "b").unwrap();
        loop {
            match tokio::time::timeout(std::time::Duration::from_secs(5), events.recv())
                .await
                .expect("a change")
            {
                Some(Some((paths, reset))) if reset || paths.iter().any(|p| p == "b.md") => break,
                Some(_) => continue,
                None => panic!("the watch ended"),
            }
        }
        drop(guard);
        served.abort();
        // The host is gone: requests fail as a lost network.
        let lost = client
            .request(&Request::Mkdir { path: "c".into() })
            .await
            .unwrap_err();
        assert_eq!(lost.code, "network_unavailable");
    }
}
