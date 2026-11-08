//! The access side (`host-ssh-client.mjs`, `remote-host-client.mjs`): folders
//! on the owner's other computers. One SSH connection per folder inside a
//! Cloud byte tunnel; for each connection a fresh Ed25519 key, a five-minute
//! certificate from the Cloud for that device, and the host key checked
//! against the one the Cloud registered. The Cloud relays bytes it cannot
//! read. Reads may retry a lost connection; a mutation is sent once and an
//! uncertain result is reported, never replayed.
use super::{
    lines::{FilesClient, HostError},
    protocol::{Capability, MAX_TUNNEL_CHUNK_BYTES, Request},
    ssh::{Access, new_key, public_line},
};
use crate::cloud::auth::{
    Broker, Cancellation, Error as AuthError,
    model::{ApiRequest, Binding},
};
use futures_util::{Sink, SinkExt, Stream, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite::{Error as SocketError, Message};

/// The runtime the access side's connections live on. Callers outside it
/// (the editor's workers) wait on it with `block_on`.
pub fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("puppyone-hosts")
            .enable_all()
            .build()
            .expect("hosts runtime")
    })
}

fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.hyphenated().to_string() == value.to_lowercase())
        && value.len() == 36
}

/// One of the owner's computers in `GET /hosts`.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Device {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub platform: String,
    /// "active" or "paused".
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub revision: i64,
    #[serde(default)]
    pub online: bool,
    #[serde(default)]
    pub last_seen_at: Option<String>,
    #[serde(default)]
    pub folders: Vec<Folder>,
}
/// A folder a computer offers, with what it allows.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub revision: i64,
    #[serde(default, deserialize_with = "known_capabilities")]
    pub capabilities: Vec<Capability>,
}
/// Capabilities this App knows; anything newer is ignored, never guessed.
fn known_capabilities<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<Capability>, D::Error> {
    let values = Vec::<Value>::deserialize(d)?;
    Ok(values
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect())
}
impl Device {
    pub fn paused(&self) -> bool {
        self.state == "paused"
    }
}
impl Folder {
    pub fn paused(&self) -> bool {
        self.state == "paused"
    }
    pub fn writable(&self) -> bool {
        self.capabilities.contains(&Capability::Write)
    }
}
/// The catalog's computers with valid identities; names are display text.
pub fn parse_catalog(value: &Value) -> Result<Vec<Device>, HostError> {
    let devices = value["devices"]
        .as_array()
        .ok_or_else(|| HostError::new("file_operation_failed"))?;
    Ok(devices
        .iter()
        .filter_map(|d| serde_json::from_value::<Device>(d.clone()).ok())
        .filter(|d| uuid(&d.id))
        .map(|mut d| {
            d.id = d.id.to_lowercase();
            d.name = d.name.trim().chars().take(120).collect();
            d.folders
                .retain(|f| uuid(&f.id) && !f.name.trim().is_empty());
            for folder in &mut d.folders {
                folder.id = folder.id.to_lowercase();
                folder.name = folder.name.trim().chars().take(120).collect();
            }
            d
        })
        .collect())
}

/// A WebSocket carrying the tunnel's bytes.
pub trait Socket:
    Stream<Item = Result<Message, SocketError>> + Sink<Message, Error = SocketError> + Unpin + Send
{
}
impl<T> Socket for T where
    T: Stream<Item = Result<Message, SocketError>>
        + Sink<Message, Error = SocketError>
        + Unpin
        + Send
{
}

/// What the Cloud does for the access side, as the signed-in account. Calls
/// block; the service runs them off its runtime's workers.
pub trait Cloud: Send + Sync {
    fn catalog(&self) -> Result<Value, HostError>;
    /// `POST /hosts/devices/{device}/ssh-certificate`.
    fn certificate(&self, device: &str, public_key: &str) -> Result<Value, HostError>;
    /// The origin a tunnel uses when the certificate names no gateway.
    fn origin(&self) -> url::Url;
    fn tunnel(&self, url: &url::Url) -> Result<Box<dyn Socket>, HostError>;
}

/// `normalize`: a Cloud refusal keeps its status; anything else is a lost network.
pub fn auth_failure(error: &AuthError) -> HostError {
    let status = match error {
        AuthError::Http(status)
        | AuthError::Service(status, _)
        | AuthError::Response(status, ..) => *status,
        AuthError::InvalidCredentials | AuthError::Expired => 401,
        AuthError::Unavailable | AuthError::Cancelled | AuthError::SessionChanged => 0,
        _ => 400,
    };
    let code = match status {
        0 => "network_unavailable",
        403 | 404 => "folder_unavailable",
        _ => "file_operation_failed",
    };
    HostError {
        code: code.into(),
        status,
        outcome_unknown: matches!(error, AuthError::OutcomeUnknown),
    }
}

/// The access side through the account's broker.
pub struct BrokerCloud {
    pub broker: Arc<Broker>,
    pub binding: Binding,
    pub cancel: Cancellation,
}
impl Cloud for BrokerCloud {
    fn catalog(&self) -> Result<Value, HostError> {
        let request = ApiRequest {
            idempotency_key: None,
            method: reqwest::Method::GET,
            path: "/hosts".into(),
            query: vec![],
            body: None,
        };
        self.broker
            .request_scoped(&self.binding, &request, &self.cancel)
            .map_err(|e| auth_failure(&e))
    }
    fn certificate(&self, device: &str, public_key: &str) -> Result<Value, HostError> {
        if !uuid(device) {
            return Err(HostError::new("invalid_request"));
        }
        let request = ApiRequest {
            idempotency_key: None,
            method: reqwest::Method::POST,
            path: format!("/hosts/devices/{device}/ssh-certificate"),
            query: vec![],
            body: Some(json!({ "public_key": public_key })),
        };
        self.broker
            .request_scoped(&self.binding, &request, &self.cancel)
            .map_err(|e| auth_failure(&e))
    }
    fn origin(&self) -> url::Url {
        let api = url::Url::parse(self.binding.environment.api()).expect("validated API");
        url::Url::parse(&api.origin().ascii_serialization()).expect("origin")
    }
    fn tunnel(&self, url: &url::Url) -> Result<Box<dyn Socket>, HostError> {
        self.broker
            .host_tunnel(&self.binding, url, &self.cancel)
            .map(|socket| Box::new(socket) as Box<dyn Socket>)
            .map_err(|e| auth_failure(&e))
    }
}

/// Waits for the tunnel's `ready`; a refusal arrives as `{type: "error", code}`.
async fn ready(socket: &mut Box<dyn Socket>) -> Result<(), HostError> {
    let wait = async {
        while let Some(message) = socket.next().await {
            let Ok(Message::Text(text)) = message else {
                if message.is_err() {
                    break;
                }
                continue;
            };
            let Ok(frame) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            return if frame["type"] == "ready" {
                Ok(())
            } else {
                Err(HostError::new(
                    frame["code"].as_str().unwrap_or("tunnel_unavailable"),
                ))
            };
        }
        Err(HostError::new("network_unavailable"))
    };
    tokio::time::timeout(Duration::from_secs(20), wait)
        .await
        .map_err(|_| HostError::new("device_offline"))?
}
/// The tunnel's binary messages as a byte stream (`socketStream`).
pub(super) fn bytes(socket: Box<dyn Socket>) -> tokio::io::DuplexStream {
    let (near, far) = tokio::io::duplex(256 * 1024);
    let (mut sink, mut source) = socket.split();
    let (mut read, mut write) = tokio::io::split(far);
    tokio::spawn(async move {
        while let Some(Ok(message)) = source.next().await {
            match message {
                Message::Binary(data) => {
                    if write.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
        let _ = write.shutdown().await;
    });
    tokio::spawn(async move {
        let mut buffer = vec![0u8; MAX_TUNNEL_CHUNK_BYTES];
        loop {
            match read.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if sink
                        .send(Message::Binary(buffer[..n].to_vec().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
        let _ = sink.close().await;
    });
    near
}

/// A change on the other computer, or why the folder cannot be seen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FolderEvent {
    /// Paths changed; `reset` asks for a rescan.
    Change { paths: Vec<String>, reset: bool },
    /// The computer is out of reach for now; watching resumes on its own.
    Offline(String),
    /// The folder is gone for this account (`folder_unavailable`, a denial).
    Unavailable(HostError),
}

type Slot = Arc<tokio::sync::Mutex<Option<Arc<Access>>>>;
/// The access side's connections, one per folder.
pub struct Hosts {
    cloud: Arc<dyn Cloud>,
    slots: Mutex<HashMap<String, Slot>>,
    retry_delays: Vec<Duration>,
}
impl Hosts {
    pub fn new(cloud: Arc<dyn Cloud>) -> Arc<Self> {
        Arc::new(Self {
            cloud,
            slots: Mutex::default(),
            retry_delays: vec![Duration::from_millis(250), Duration::from_secs(1)],
        })
    }
    async fn blocking<T: Send + 'static>(
        &self,
        work: impl FnOnce(&dyn Cloud) -> Result<T, HostError> + Send + 'static,
    ) -> Result<T, HostError> {
        let cloud = self.cloud.clone();
        tokio::task::spawn_blocking(move || work(cloud.as_ref()))
            .await
            .map_err(|_| HostError::new("network_unavailable"))?
    }
    /// The owner's computers and what each offers.
    pub async fn catalog(&self) -> Result<Vec<Device>, HostError> {
        let value = self.blocking(|cloud| cloud.catalog()).await?;
        parse_catalog(&value)
    }
    async fn connect(&self, folder: &str) -> Result<Access, HostError> {
        let devices = self.catalog().await?;
        let device = devices
            .iter()
            .find(|d| d.folders.iter().any(|f| f.id == folder))
            .ok_or_else(|| HostError::new("folder_unavailable"))?;
        if !device.online {
            return Err(HostError::new("device_offline"));
        }
        let key = new_key();
        let (id, line) = (device.id.clone(), public_line(&key));
        let issued = self
            .blocking(move |cloud| cloud.certificate(&id, &line))
            .await?;
        let (Some(certificate), Some(host_key)) =
            (issued["certificate"].as_str(), issued["host_key"].as_str())
        else {
            return Err(HostError::new("folder_unavailable"));
        };
        let base = issued["gateway_url"]
            .as_str()
            .filter(|v| !v.is_empty())
            .and_then(|v| url::Url::parse(v).ok())
            .unwrap_or_else(|| self.cloud.origin());
        let mut url = base
            .join(&format!("/api/v1/hosts/folders/{folder}/tunnel"))
            .map_err(|_| HostError::new("tunnel_unavailable"))?;
        let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
        url.set_scheme(scheme)
            .map_err(|_| HostError::new("tunnel_unavailable"))?;
        let mut socket = self.blocking(move |cloud| cloud.tunnel(&url)).await?;
        ready(&mut socket).await?;
        Access::connect(bytes(socket), folder, key, certificate, host_key).await
    }
    /// The folder's open connection, or a new one.
    pub async fn access(&self, folder: &str) -> Result<Arc<Access>, HostError> {
        if !uuid(folder) {
            return Err(HostError::new("invalid_request"));
        }
        let folder = folder.to_lowercase();
        let slot = self
            .slots
            .lock()
            .unwrap()
            .entry(folder.clone())
            .or_default()
            .clone();
        let mut current = slot.lock().await;
        if let Some(open) = current.as_ref().filter(|a| !a.is_closed()) {
            return Ok(open.clone());
        }
        let access = Arc::new(self.connect(&folder).await?);
        *current = Some(access.clone());
        Ok(access)
    }
    pub async fn files(&self, folder: &str) -> Result<FilesClient, HostError> {
        self.access(folder).await?.files().await
    }
    /// Ends the folder's connection; the next use makes a new one.
    pub fn close(&self, folder: &str) {
        let slot = self.slots.lock().unwrap().remove(&folder.to_lowercase());
        if let Some(slot) = slot {
            runtime().spawn(async move {
                if let Some(access) = slot.lock().await.take() {
                    access.close().await;
                }
            });
        }
    }
    pub fn close_all(&self) {
        let folders: Vec<String> = self.slots.lock().unwrap().keys().cloned().collect();
        for folder in folders {
            self.close(&folder);
        }
    }
    /// One file request. Reads retry a lost connection or a slow host twice;
    /// a mutation is sent once.
    pub async fn request(&self, folder: &str, request: &Request) -> Result<Value, HostError> {
        let attempts = if request.mutating() {
            1
        } else {
            self.retry_delays.len() + 1
        };
        let mut last = HostError::new("network_unavailable");
        for attempt in 0..attempts {
            let outcome = match self.files(folder).await {
                Ok(files) => files.request(request).await,
                Err(error) => Err(error),
            };
            match outcome {
                Ok(value) => return Ok(value),
                Err(error) => {
                    let retry = matches!(error.status, 0 | 502 | 504) && attempt + 1 < attempts;
                    last = error;
                    if !retry {
                        break;
                    }
                    self.close(folder);
                    tokio::time::sleep(self.retry_delays[attempt]).await;
                }
            }
        }
        Err(last)
    }
    /// Streams the folder's changes to `emit` until it returns false. A
    /// retryable outage reconnects with backoff and then asks for a rescan;
    /// a refusal ends the watch.
    pub async fn watch(&self, folder: &str, emit: impl Fn(FolderEvent) -> bool) {
        let delays = [500, 1000, 3000, 10_000].map(Duration::from_millis);
        let (mut attempt, mut missed) = (0usize, false);
        loop {
            let watching = match self.files(folder).await {
                Ok(files) => files.watch().await,
                Err(error) => Err(error),
            };
            let code = match watching {
                Ok((guard, mut events)) => {
                    // Changes made while this computer could not see the folder: rescan.
                    if missed
                        && !emit(FolderEvent::Change {
                            paths: vec![],
                            reset: true,
                        })
                    {
                        return;
                    }
                    while let Some(Some((paths, reset))) = events.recv().await {
                        attempt = 0;
                        if !emit(FolderEvent::Change { paths, reset }) {
                            drop(guard);
                            return;
                        }
                    }
                    drop(guard);
                    "device_offline".to_owned()
                }
                Err(error) if matches!(error.status, 401 | 403 | 404) => {
                    emit(FolderEvent::Unavailable(error));
                    return;
                }
                Err(error) => error.code,
            };
            missed = true;
            if !emit(FolderEvent::Offline(code)) {
                return;
            }
            tokio::time::sleep(delays[attempt.min(delays.len() - 1)]).await;
            attempt += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::{FOLDER, fake};
    use super::*;

    /// Opening a folder on another computer end to end, in memory: catalog,
    /// certificate, tunnel and SSH; one connection serves every request, and
    /// an offline computer or a refused tunnel says why.
    #[test]
    fn a_folder_on_another_computer_opens_through_the_cloud_tunnel() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        std::fs::write(root.join("note.md"), "hello").unwrap();
        let cloud = fake(root.clone());
        let hosts = Hosts::new(cloud.clone());
        runtime().block_on(async {
            let devices = hosts.catalog().await.unwrap();
            assert_eq!(devices.len(), 1);
            assert_eq!(
                devices[0].folders[0].capabilities,
                [
                    Capability::Read,
                    Capability::Write,
                    Capability::Shell,
                    Capability::Git
                ]
            );
            assert!(devices[0].folders[0].writable());
            // Git rides the files channel as named operations.
            let status = hosts
                .request(
                    FOLDER,
                    &Request::Git(super::super::git::GitRequest {
                        op: "status".into(),
                        ..Default::default()
                    }),
                )
                .await
                .unwrap();
            assert_eq!(status["isRepo"], false);
            let read = hosts
                .request(
                    FOLDER,
                    &Request::Read {
                        path: "note.md".into(),
                    },
                )
                .await
                .unwrap();
            assert_eq!(read["content_base64"], "aGVsbG8=");
            hosts
                .request(
                    FOLDER,
                    &Request::Write {
                        path: "new.md".into(),
                        content_base64: "aGk=".into(),
                        expected_revision: Some(None),
                    },
                )
                .await
                .unwrap();
            assert_eq!(std::fs::read_to_string(root.join("new.md")).unwrap(), "hi");
            assert_eq!(
                *cloud.tunnels.lock().unwrap(),
                [format!(
                    "wss://api.puppyone.ai/api/v1/hosts/folders/{FOLDER}/tunnel"
                )]
            );
            hosts.close(FOLDER);
            *cloud.online.lock().unwrap() = false;
            let offline = hosts
                .request(
                    FOLDER,
                    &Request::List {
                        path: String::new(),
                    },
                )
                .await
                .unwrap_err();
            assert_eq!(offline.code, "device_offline");
            *cloud.online.lock().unwrap() = true;
            *cloud.refuse.lock().unwrap() = Some("device_busy");
            let busy = hosts
                .request(
                    FOLDER,
                    &Request::List {
                        path: String::new(),
                    },
                )
                .await
                .unwrap_err();
            assert_eq!((busy.code.as_str(), busy.status), ("device_busy", 503));
            assert!(hosts.access("../etc").await.is_err());
        });
    }

    /// A watch reports changes, and after the computer was out of reach it
    /// asks for a rescan; an unshared folder ends it.
    #[test]
    fn a_remote_watch_reports_changes_and_rescans_after_an_outage() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let cloud = fake(root.clone());
        let hosts = Hosts::new(cloud.clone());
        let (events, received) = std::sync::mpsc::channel();
        let watcher = hosts.clone();
        runtime().spawn(async move {
            watcher
                .watch(FOLDER, move |event| events.send(event).is_ok())
                .await
        });
        // The host begins every watch with a rescan.
        let first = received.recv_timeout(Duration::from_secs(10)).unwrap();
        assert!(
            matches!(first, FolderEvent::Change { reset: true, .. }),
            "{first:?}"
        );
        std::fs::write(root.join("changed.md"), "x").unwrap();
        // The change itself, or a rescan that covers it.
        let changed = received.recv_timeout(Duration::from_secs(10)).unwrap();
        assert!(
            matches!(&changed, FolderEvent::Change { paths, reset } if *reset || paths.iter().any(|p| p == "changed.md")),
            "{changed:?}"
        );
        hosts.close(FOLDER);
        let mut seen = Vec::new();
        while let Ok(event) = received.recv_timeout(Duration::from_secs(10)) {
            let reset = event
                == FolderEvent::Change {
                    paths: vec![],
                    reset: true,
                };
            seen.push(event);
            if reset {
                break;
            }
        }
        assert!(
            matches!(seen.first(), Some(FolderEvent::Offline(_))),
            "{seen:?}"
        );
        assert!(
            matches!(seen.last(), Some(FolderEvent::Change { reset: true, .. })),
            "{seen:?}"
        );
    }
}
