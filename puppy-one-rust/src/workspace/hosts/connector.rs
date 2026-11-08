//! This computer's outbound device connection (`host-connector.mjs`): no
//! listening port. Each challenge is asked for with a device-signed request,
//! so it stays online with nobody signed in here. It serves byte tunnels,
//! each one SSH session that ends on this computer's SSH server; the Cloud
//! admits a tunnel for a folder and relays bytes it cannot read. The old
//! plaintext file, watch and execution frames are refused.
//!
//! Transport loss retries with backoff (1 s doubling to 15 s); a socket
//! silent for 30 s is dead. A definite revocation (close 4004 or a
//! `device_revoked` refusal) stops for good; close 4005 means the Cloud no
//! longer serves this protocol, so it stops until the App is updated.
use super::{
    identity::{DeviceIdentity, Owner},
    protocol::PROTOCOL_VERSION,
    registry::Registry,
    remote::{Socket, runtime},
    ssh::HostSsh,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::{SinkExt, StreamExt, future::BoxFuture};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite::{Message, protocol::frame::coding::CloseCode};

pub const CLOSE_REVOKED: u16 = 4004;
pub const CLOSE_UNSUPPORTED: u16 = 4005;
const HEARTBEAT: Duration = Duration::from_secs(10);
const SILENT: Duration = Duration::from_secs(30);
const MAX_RETRY: Duration = Duration::from_secs(15);
const MAX_TUNNELS: usize = 16;
const TUNNEL_CHUNK: usize = 48 * 1024;
const MAX_FRAME_CHARACTERS: usize = 12 * 1024 * 1024;

/// A challenge refusal: the status, and the Cloud's code and clock.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Refused {
    pub status: u16,
    pub code: Option<String>,
    pub server_time: Option<i64>,
}
/// What the device connection asks of the Cloud; none of it is an account's.
pub trait Gateway: Send + Sync {
    /// `POST /hosts/devices/{device}/device-challenge`, signed by the device.
    fn challenge(&self, device: &str, body: Value) -> BoxFuture<'static, Result<Value, Refused>>;
    fn connect(&self, url: url::Url) -> BoxFuture<'static, Result<Box<dyn Socket>, String>>;
    /// `GET /hosts/ssh-authority`: the public keys user certificates are signed with.
    fn authorities(&self) -> BoxFuture<'static, Result<Vec<String>, String>>;
    fn deployment(&self) -> &str;
}

/// `deviceChallengeRequestPayload`.
pub fn challenge_payload(account: &str, device: &str, timestamp: i64) -> String {
    format!("puppyone-device-challenge-v1\n{account}\n{device}\n{timestamp}")
}
/// `deviceSocketUrl`: a gateway the challenge names must be in the same
/// host family and on the device's own path.
pub fn device_socket_url(
    deployment: &str,
    device: &str,
    connect: Option<&str>,
) -> Option<url::Url> {
    let mut url = match connect.filter(|c| !c.is_empty()) {
        Some(connect) => {
            let url = url::Url::parse(connect).ok()?;
            let origin = format!(
                "{}://{}",
                url.scheme(),
                &url[url::Position::BeforeHost..url::Position::AfterPort]
            );
            let family = crate::cloud::auth::model::Environment::new(
                &format!("{origin}/api/v1"),
                "https://puppyone.ai",
            )
            .is_ok();
            if !family
                || url.path() != format!("/api/v1/hosts/devices/{device}/connect")
                || url.query().is_some()
                || url.fragment().is_some()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return None;
            }
            url
        }
        None => url::Url::parse(&format!("{deployment}/hosts/devices/{device}/connect")).ok()?,
    };
    let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
    url.set_scheme(scheme).ok()?;
    Some(url)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum State {
    #[default]
    Off,
    Connecting,
    Online,
    Offline,
    /// The Cloud no longer serves this App's protocol.
    Outdated,
}
impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Connecting => "connecting",
            Self::Online => "online",
            Self::Offline => "offline",
            Self::Outdated => "outdated",
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Status {
    pub state: State,
    pub device: Option<String>,
    pub tunnels: usize,
    pub last_access: Option<String>,
}

/// How one connection ended.
enum Ended {
    Stopped,
    Revoked,
    Outdated,
    Lost { was_online: bool },
}

struct Shared {
    gateway: Arc<dyn Gateway>,
    identity: Arc<DeviceIdentity>,
    registry: Arc<Registry>,
    status: Mutex<Status>,
    on_change: Box<dyn Fn(&Status) + Send + Sync>,
    on_revoked: Box<dyn Fn(&Owner) + Send + Sync>,
    hello: Value,
    /// Learned from the Cloud when this computer's clock is off.
    clock_offset: Mutex<i64>,
    run: Mutex<Option<(u64, tokio::sync::watch::Sender<bool>)>>,
    next: std::sync::atomic::AtomicU64,
}
impl Shared {
    fn update(&self, change: impl FnOnce(&mut Status)) {
        let status = {
            let mut status = self.status.lock().unwrap();
            change(&mut status);
            status.clone()
        };
        (self.on_change)(&status);
    }
}

#[derive(Clone)]
pub struct Connector(Arc<Shared>);
impl Connector {
    pub fn new(
        gateway: Arc<dyn Gateway>,
        identity: Arc<DeviceIdentity>,
        registry: Arc<Registry>,
        app_version: &str,
        on_change: impl Fn(&Status) + Send + Sync + 'static,
        on_revoked: impl Fn(&Owner) + Send + Sync + 'static,
    ) -> Self {
        let version = Some(app_version)
            .filter(|v| {
                !v.is_empty()
                    && v.len() <= 64
                    && v.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
                    && v.chars()
                        .all(|c| c.is_ascii_alphanumeric() || "._+-".contains(c))
            })
            .unwrap_or("unknown");
        Self(Arc::new(Shared {
            gateway,
            identity,
            registry,
            status: Mutex::default(),
            on_change: Box::new(on_change),
            on_revoked: Box::new(on_revoked),
            hello: json!({"protocol": PROTOCOL_VERSION, "boot_id": uuid::Uuid::new_v4().to_string(),
                "app_version": version}),
            clock_offset: Mutex::new(0),
            run: Mutex::new(None),
            next: Default::default(),
        }))
    }
    pub fn status(&self) -> Status {
        self.0.status.lock().unwrap().clone()
    }
    pub fn is_active(&self) -> bool {
        self.0.run.lock().unwrap().is_some()
    }
    /// Serves `owner`'s tunnels through `ssh` until stopped; transport
    /// failures retry with the same identity.
    pub fn connect(&self, owner: Owner, ssh: HostSsh) {
        self.stop();
        let id = self
            .0
            .next
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let (stop, stopped) = tokio::sync::watch::channel(false);
        *self.0.run.lock().unwrap() = Some((id, stop));
        let shared = self.0.clone();
        shared.update(|s| {
            s.state = State::Connecting;
            s.device = Some(owner.device_id.clone());
        });
        runtime().spawn(async move {
            let mut delay = Duration::from_secs(1);
            loop {
                let ended = session(&shared, &owner, &ssh, stopped.clone()).await;
                let current = shared.run.lock().unwrap().as_ref().map(|(i, _)| *i) == Some(id);
                if !current {
                    return;
                }
                match ended {
                    Ended::Stopped => return,
                    Ended::Revoked => {
                        *shared.run.lock().unwrap() = None;
                        shared.update(|s| *s = Status::default());
                        (shared.on_revoked)(&owner);
                        return;
                    }
                    Ended::Outdated => {
                        *shared.run.lock().unwrap() = None;
                        shared.update(|s| {
                            s.state = State::Outdated;
                            s.tunnels = 0;
                        });
                        return;
                    }
                    Ended::Lost { was_online } => {
                        if was_online {
                            delay = Duration::from_secs(1);
                        }
                        shared.update(|s| {
                            s.state = State::Offline;
                            s.tunnels = 0;
                        });
                        let mut stopped = stopped.clone();
                        tokio::select! {
                            _ = tokio::time::sleep(delay) => {}
                            _ = stopped.changed() => {}
                        }
                        if *stopped.borrow() {
                            return;
                        }
                        delay = (delay * 2).min(MAX_RETRY);
                        shared.update(|s| s.state = State::Connecting);
                    }
                }
            }
        });
    }
    /// Ends the connection and every tunnel it carried.
    pub fn stop(&self) {
        if let Some((_, stop)) = self.0.run.lock().unwrap().take() {
            let _ = stop.send(true);
        }
        self.0.update(|s| *s = Status::default());
    }
}

/// One connection: challenge, socket, `ready`, then tunnels until it ends.
async fn session(
    shared: &Arc<Shared>,
    owner: &Owner,
    ssh: &HostSsh,
    mut stopped: tokio::sync::watch::Receiver<bool>,
) -> Ended {
    let lost = Ended::Lost { was_online: false };
    let (account, device) = (owner.account_id.as_str(), owner.device_id.as_str());
    // A device-signed challenge request; once more with the Cloud's clock.
    let mut challenge = None;
    for attempt in 0..2 {
        let timestamp = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or_default())
            + *shared.clock_offset.lock().unwrap();
        let Ok(signature) = shared
            .identity
            .sign(owner, &challenge_payload(account, device, timestamp))
        else {
            return lost;
        };
        let body = json!({"owner": account, "timestamp": timestamp, "signature": signature});
        match shared.gateway.challenge(device, body).await {
            Ok(value) => {
                challenge = Some(value);
                break;
            }
            Err(refused) => {
                if refused.status == 403 && refused.code.as_deref() == Some("device_revoked") {
                    return Ended::Revoked;
                }
                if refused.status == 401
                    && refused.code.as_deref() == Some("device_clock_skew")
                    && attempt == 0
                    && let Some(server) = refused.server_time
                {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or_default();
                    *shared.clock_offset.lock().unwrap() = server - now;
                    continue;
                }
                return lost;
            }
        }
    }
    let Some(challenge) = challenge else {
        return lost;
    };
    let ids = [&challenge["challenge_id"], &challenge["epoch"]];
    let (Some(challenge_id), Some(epoch), Some(nonce)) = (
        ids[0].as_str().filter(|v| uuid::Uuid::parse_str(v).is_ok()),
        ids[1].as_str().filter(|v| uuid::Uuid::parse_str(v).is_ok()),
        challenge["nonce"].as_str(),
    ) else {
        return lost;
    };
    let payload =
        format!("puppyone-device-v1\n{account}\n{device}\n{challenge_id}\n{epoch}\n{nonce}");
    let Ok(signature) = shared.identity.sign(owner, &payload) else {
        return lost;
    };
    let Some(url) = device_socket_url(
        shared.gateway.deployment(),
        device,
        challenge["connect_url"].as_str(),
    ) else {
        return lost;
    };
    let Ok(Ok(mut socket)) =
        tokio::time::timeout(Duration::from_secs(15), shared.gateway.connect(url)).await
    else {
        return lost;
    };
    let mut hello = json!({"owner": account, "challenge_id": challenge_id, "epoch": epoch,
        "nonce": nonce, "signature": signature});
    for (key, value) in shared.hello.as_object().into_iter().flatten() {
        hello[key] = value.clone();
    }
    if socket
        .send(Message::Text(hello.to_string().into()))
        .await
        .is_err()
    {
        return lost;
    }
    // `ready` for this epoch first; anything else ends the attempt.
    let ready = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    let frame: Value = serde_json::from_str(&text).unwrap_or_default();
                    return frame["type"] == "ready" && frame["epoch"] == epoch;
                }
                Some(Ok(Message::Close(frame))) => {
                    return frame.is_some_and(|f| u16::from(f.code) == CLOSE_REVOKED) && false;
                }
                Some(Ok(_)) => {}
                _ => return false,
            }
        }
    })
    .await;
    if ready != Ok(true) {
        return lost;
    }
    shared.update(|s| s.state = State::Online);
    serve(shared, owner, ssh, socket, &mut stopped).await
}

struct Tunnel {
    input: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
}

async fn serve(
    shared: &Arc<Shared>,
    owner: &Owner,
    ssh: &HostSsh,
    socket: Box<dyn Socket>,
    stopped: &mut tokio::sync::watch::Receiver<bool>,
) -> Ended {
    let online = Ended::Lost { was_online: true };
    let (mut sink, mut source) = socket.split();
    let (out, mut outgoing) = tokio::sync::mpsc::unbounded_channel::<Value>();
    let mut tunnels: HashMap<String, Tunnel> = HashMap::new();
    let (ended_tx, mut ended_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let mut heard = Instant::now();
    let mut beat = tokio::time::interval(HEARTBEAT);
    beat.tick().await;
    let ended = loop {
        tokio::select! {
            _ = stopped.changed() => break Ended::Stopped,
            _ = beat.tick() => {
                if heard.elapsed() > SILENT {
                    break online;
                }
                let _ = out.send(json!({"type": "heartbeat"}));
            }
            Some(frame) = outgoing.recv() => {
                if sink.send(Message::Text(frame.to_string().into())).await.is_err() {
                    break online;
                }
            }
            Some(stream) = ended_rx.recv() => {
                if tunnels.remove(&stream).is_some() {
                    let _ = out.send(json!({"type": "tunnel_close", "stream": stream}));
                    shared.update(|s| s.tunnels = tunnels.len());
                }
            }
            message = source.next() => {
                heard = Instant::now();
                let text = match message {
                    Some(Ok(Message::Text(text))) => text,
                    Some(Ok(Message::Close(frame))) => {
                        break match frame.map(|f| u16::from(f.code)) {
                            Some(CLOSE_REVOKED) => Ended::Revoked,
                            Some(CLOSE_UNSUPPORTED) => Ended::Outdated,
                            _ => online,
                        };
                    }
                    Some(Ok(_)) => continue,
                    _ => break online,
                };
                if text.len() > MAX_FRAME_CHARACTERS {
                    break online;
                }
                let Ok(frame) = serde_json::from_str::<Value>(&text) else {
                    break online;
                };
                match frame["type"].as_str() {
                    Some("heartbeat_ack") => {}
                    Some("tunnel_open") => {
                        let stream = frame["stream"].as_str().unwrap_or_default().to_owned();
                        let folder = frame["folder_id"].as_str().unwrap_or_default().to_owned();
                        let valid_stream = !stream.is_empty()
                            && stream.len() <= 64
                            && stream.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
                        if !valid_stream || uuid::Uuid::parse_str(&folder).is_err() || tunnels.contains_key(&stream) {
                            break online;
                        }
                        let refuse = |error: &str| json!({"type": "tunnel_refused", "stream": stream, "error": error});
                        if tunnels.len() >= MAX_TUNNELS {
                            let _ = out.send(refuse("tunnel_limit"));
                            continue;
                        }
                        if shared.registry.resolve(owner, &folder).is_none() {
                            let _ = out.send(refuse("folder_unavailable"));
                            continue;
                        }
                        let (near, far) = tokio::io::duplex(256 * 1024);
                        let (input, mut inputs) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
                        tunnels.insert(stream.clone(), Tunnel { input });
                        let _ = out.send(json!({"type": "tunnel_opened", "stream": stream}));
                        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                        shared.update(|s| {
                            s.tunnels = tunnels.len();
                            s.last_access = Some(now);
                        });
                        let (mut read, mut write) = tokio::io::split(near);
                        let (frames, name) = (out.clone(), stream.clone());
                        tokio::spawn(async move {
                            let mut buffer = vec![0u8; TUNNEL_CHUNK];
                            while let Ok(n) = read.read(&mut buffer).await {
                                if n == 0 {
                                    break;
                                }
                                let data = STANDARD.encode(&buffer[..n]);
                                if frames.send(json!({"type": "tunnel_data", "stream": name, "data": data})).is_err() {
                                    break;
                                }
                            }
                        });
                        tokio::spawn(async move {
                            while let Some(bytes) = inputs.recv().await {
                                if write.write_all(&bytes).await.is_err() {
                                    break;
                                }
                            }
                            let _ = write.shutdown().await;
                        });
                        let (ssh, ended) = (ssh.clone(), ended_tx.clone());
                        tokio::spawn(async move {
                            ssh.serve(far, folder).await;
                            let _ = ended.send(stream);
                        });
                    }
                    Some("tunnel_data") => {
                        let tunnel = frame["stream"].as_str().and_then(|s| tunnels.get(s));
                        if let (Some(tunnel), Some(Ok(bytes))) =
                            (tunnel, frame["data"].as_str().map(|d| STANDARD.decode(d)))
                        {
                            let _ = tunnel.input.send(bytes);
                        }
                    }
                    Some("tunnel_close") => {
                        if let Some(stream) = frame["stream"].as_str() {
                            // Dropping the input ends the SSH session's bytes.
                            tunnels.remove(stream);
                            shared.update(|s| s.tunnels = tunnels.len());
                        }
                    }
                    // Plaintext relays are no longer served: only SSH, end to end.
                    Some("file") => {
                        let _ = out.send(json!({"type": "reply", "id": frame["id"], "error": "not_allowed"}));
                    }
                    Some("watch") => {
                        let _ = out.send(json!({"type": "event", "subscription": frame["subscription"],
                            "paths": [], "reset": true}));
                    }
                    Some("exec_open") => {
                        let _ = out.send(json!({"type": "exec_failed", "session": frame["session"],
                            "error": "not_allowed"}));
                    }
                    _ => {}
                }
            }
        }
    };
    tunnels.clear();
    let _ = sink
        .send(Message::Close(Some(
            tokio_tungstenite::tungstenite::protocol::CloseFrame {
                code: CloseCode::Normal,
                reason: "".into(),
            },
        )))
        .await;
    ended
}

/// The device connection through the Cloud's own endpoints.
pub struct HttpGateway {
    deployment: String,
    client: reqwest::Client,
}
impl HttpGateway {
    pub fn new(deployment: &str) -> Self {
        Self {
            deployment: deployment.trim_end_matches('/').to_owned(),
            client: reqwest::Client::builder()
                .redirect_policy(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(15))
                .build()
                .expect("HTTP client"),
        }
    }
}
impl Gateway for HttpGateway {
    fn challenge(&self, device: &str, body: Value) -> BoxFuture<'static, Result<Value, Refused>> {
        let request = self
            .client
            .post(format!(
                "{}/hosts/devices/{device}/device-challenge",
                self.deployment
            ))
            .json(&body);
        Box::pin(async move {
            let response = request.send().await.map_err(|_| Refused::default())?;
            let status = response.status().as_u16();
            let body: Value = response.json().await.unwrap_or_default();
            if (200..300).contains(&status) {
                return Ok(body);
            }
            let detail = &body["detail"];
            Err(Refused {
                status,
                code: detail["code"].as_str().map(str::to_owned),
                server_time: detail["server_time"].as_i64(),
            })
        })
    }
    fn connect(&self, url: url::Url) -> BoxFuture<'static, Result<Box<dyn Socket>, String>> {
        Box::pin(async move {
            let (socket, _) = tokio_tungstenite::connect_async(url.as_str())
                .await
                .map_err(|e| e.to_string())?;
            Ok(Box::new(socket) as Box<dyn Socket>)
        })
    }
    fn authorities(&self) -> BoxFuture<'static, Result<Vec<String>, String>> {
        let request = self
            .client
            .get(format!("{}/hosts/ssh-authority", self.deployment));
        Box::pin(async move {
            let response = request.send().await.map_err(|e| e.to_string())?;
            if !response.status().is_success() {
                return Err(format!(
                    "SSH authority unavailable ({}).",
                    response.status()
                ));
            }
            let body: Value = response.json().await.map_err(|e| e.to_string())?;
            let keys: Vec<String> = body["keys"]
                .as_array()
                .map(|keys| {
                    keys.iter()
                        .filter_map(|k| k.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default();
            if keys.is_empty() {
                return Err("No SSH authority.".into());
            }
            Ok(keys)
        })
    }
    fn deployment(&self) -> &str {
        &self.deployment
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        identity::MemoryKeys,
        ssh::{Access, Authorities, HostIdentity, new_key, public_line},
    };
    use super::*;
    use russh::keys::{PublicKey, ssh_key::certificate::CertType};

    const ACCOUNT: &str = "1e8a6c52-2222-4b3a-9c3f-6b5a4c3d2e1f";
    const DEVICE: &str = "0d9b7f61-1111-4c2a-8b2e-7a6b5c4d3e2f";

    /// The Cloud's device side in memory: it checks the challenge and the
    /// hello signatures with the registered key, says `ready`, and opens a
    /// tunnel whose bytes it relays from its other side.
    struct Cloud {
        public: Mutex<Option<String>>,
        socket: Mutex<Option<tokio::io::DuplexStream>>,
        revoke: bool,
    }
    impl Gateway for Cloud {
        fn challenge(
            &self,
            device: &str,
            body: Value,
        ) -> BoxFuture<'static, Result<Value, Refused>> {
            assert_eq!(device, DEVICE);
            let public = self.public.lock().unwrap().clone().unwrap();
            let revoke = self.revoke;
            Box::pin(async move {
                if revoke {
                    return Err(Refused {
                        status: 403,
                        code: Some("device_revoked".into()),
                        server_time: None,
                    });
                }
                let payload =
                    challenge_payload(ACCOUNT, DEVICE, body["timestamp"].as_i64().unwrap());
                assert!(verify(
                    &public,
                    &payload,
                    body["signature"].as_str().unwrap()
                ));
                Ok(json!({"challenge_id": uuid::Uuid::new_v4().to_string(),
                    "epoch": "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b", "nonce": "n0nce"}))
            })
        }
        fn connect(&self, url: url::Url) -> BoxFuture<'static, Result<Box<dyn Socket>, String>> {
            assert_eq!(url.scheme(), "wss");
            let stream = self.socket.lock().unwrap().take().unwrap();
            Box::pin(async move {
                let (socket, _) = tokio_tungstenite::client_async("ws://localhost/", stream)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(Box::new(socket) as Box<dyn Socket>)
            })
        }
        fn authorities(&self) -> BoxFuture<'static, Result<Vec<String>, String>> {
            Box::pin(async { Ok(vec![]) })
        }
        fn deployment(&self) -> &str {
            "https://api.puppyone.ai/api/v1"
        }
    }
    fn verify(public: &str, payload: &str, signature: &str) -> bool {
        use russh::keys::signature::Verifier as _;
        let key: [u8; 32] = STANDARD.decode(public).unwrap().try_into().unwrap();
        let signature = russh::keys::ssh_key::Signature::new(
            russh::keys::ssh_key::Algorithm::Ed25519,
            STANDARD.decode(signature).unwrap(),
        )
        .unwrap();
        russh::keys::ssh_key::public::Ed25519PublicKey(key)
            .verify(payload.as_bytes(), &signature)
            .is_ok()
    }
    struct Ca(PublicKey);
    impl Authorities for Ca {
        fn keys(&self, _: bool) -> Vec<PublicKey> {
            vec![self.0.clone()]
        }
    }

    /// A shared folder reached the whole way: device challenge and hello
    /// signed by the device key, `ready`, a tunnel the Cloud opens, and an
    /// SSH session inside it that reads the folder.
    #[test]
    fn the_device_connection_serves_ssh_tunnels_for_shared_folders() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap().join("notes");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("note.md"), "hello").unwrap();
        let deployment = "https://api.puppyone.ai/api/v1";
        let identity = Arc::new(DeviceIdentity::new(
            temp.path().join("id.json"),
            Box::new(MemoryKeys::default()),
            deployment,
        ));
        let public = Mutex::new(String::new());
        let owner = identity
            .register(ACCOUNT, |key| {
                *public.lock().unwrap() = key.into();
                Ok(DEVICE.into())
            })
            .unwrap();
        let registry = Arc::new(Registry::new(temp.path().join("reg.json"), deployment));
        let (folder, _) = registry
            .register(&owner, &root, "notes", false, |id, _, _| Ok(id.into()))
            .unwrap();
        let (cloud_end, device_end) = tokio::io::duplex(1024 * 1024);
        let gateway = Arc::new(Cloud {
            public: Mutex::new(Some(public.into_inner().unwrap())),
            socket: Mutex::new(Some(device_end)),
            revoke: false,
        });
        let ca = new_key();
        let key = identity.key(&owner).unwrap();
        let ssh = HostSsh::new(
            Arc::new(HostIdentity {
                account: ACCOUNT.into(),
                device: DEVICE.into(),
                key: key.clone(),
            }),
            Arc::new(Ca(ca.public_key().clone())),
            Arc::new(super::super::registry::Shared {
                registry: registry.clone(),
                owner: Arc::new(Mutex::new(Some(owner.clone()))),
            }),
            None,
        );
        let states = Arc::new(Mutex::new(Vec::new()));
        let seen = states.clone();
        let connector = Connector::new(
            gateway,
            identity,
            registry,
            "0.4.0",
            move |s| seen.lock().unwrap().push(s.state),
            |_| {},
        );
        connector.connect(owner.clone(), ssh);
        let read = runtime().block_on(async move {
            let mut cloud = tokio_tungstenite::accept_async(cloud_end).await.unwrap();
            let hello: Value = match cloud.next().await.unwrap().unwrap() {
                Message::Text(text) => serde_json::from_str(&text).unwrap(),
                other => panic!("{other:?}"),
            };
            assert_eq!(hello["protocol"], 1);
            assert_eq!(hello["app_version"], "0.4.0");
            cloud
                .send(Message::Text(
                    json!({"type": "ready", "epoch": hello["epoch"]}).to_string().into(),
                ))
                .await
                .unwrap();
            cloud
                .send(Message::Text(
                    json!({"type": "tunnel_open", "stream": "s1", "folder_id": folder})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
            // The access side's bytes, relayed as tunnel frames.
            let (client, relay) = tokio::io::duplex(1024 * 1024);
            let (mut relay_read, mut relay_write) = tokio::io::split(relay);
            let (to_cloud, mut frames) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
            tokio::spawn(async move {
                let mut buffer = vec![0u8; 32 * 1024];
                while let Ok(n) = relay_read.read(&mut buffer).await {
                    if n == 0 || to_cloud.send(buffer[..n].to_vec()).is_err() {
                        break;
                    }
                }
            });
            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        Some(bytes) = frames.recv() => {
                            let frame = json!({"type": "tunnel_data", "stream": "s1",
                                "data": STANDARD.encode(bytes)});
                            if cloud.send(Message::Text(frame.to_string().into())).await.is_err() {
                                break;
                            }
                        }
                        message = cloud.next() => {
                            let Some(Ok(Message::Text(text))) = message else { break };
                            let frame: Value = serde_json::from_str(&text).unwrap();
                            if frame["type"] == "tunnel_data" {
                                let bytes = STANDARD.decode(frame["data"].as_str().unwrap()).unwrap();
                                if relay_write.write_all(&bytes).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                }
            });
            let user = new_key();
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            let mut builder = russh::keys::ssh_key::certificate::Builder::new(
                [3u8; 16],
                user.public_key().key_data().clone(),
                now - 60,
                now + 300,
            )
            .unwrap();
            builder.cert_type(CertType::User).unwrap();
            builder.key_id(format!("user:{ACCOUNT}")).unwrap();
            builder.valid_principal(DEVICE).unwrap();
            let certificate = builder.sign(&ca).unwrap().to_openssh().unwrap();
            let access = Access::connect(client, &folder, user, &certificate, &public_line(&key))
                .await
                .unwrap();
            let files = access.files().await.unwrap();
            files
                .request(&super::super::protocol::Request::Read {
                    path: "note.md".into(),
                })
                .await
                .unwrap()
        });
        assert_eq!(read["content_base64"], "aGVsbG8=");
        assert_eq!(connector.status().state, State::Online);
        assert_eq!(connector.status().tunnels, 1);
        connector.stop();
        assert_eq!(connector.status().state, State::Off);
        let seen = states.lock().unwrap().clone();
        assert!(
            seen.contains(&State::Connecting) && seen.contains(&State::Online),
            "{seen:?}"
        );
    }

    #[test]
    fn a_gateway_outside_the_family_is_never_dialled() {
        let deployment = "https://api.puppyone.ai/api/v1";
        assert_eq!(
            device_socket_url(deployment, DEVICE, None)
                .unwrap()
                .as_str(),
            format!("wss://api.puppyone.ai/api/v1/hosts/devices/{DEVICE}/connect")
        );
        let named = format!("https://gw.puppyone.ai/api/v1/hosts/devices/{DEVICE}/connect");
        assert_eq!(
            device_socket_url(deployment, DEVICE, Some(&named))
                .unwrap()
                .scheme(),
            "wss"
        );
        for bad in [
            format!("https://gw.example.com/api/v1/hosts/devices/{DEVICE}/connect"),
            "https://gw.puppyone.ai/api/v1/hosts/devices/other/connect".to_owned(),
            format!("https://gw.puppyone.ai/api/v1/hosts/devices/{DEVICE}/connect?x=1"),
        ] {
            assert!(
                device_socket_url(deployment, DEVICE, Some(&bad)).is_none(),
                "{bad}"
            );
        }
    }
}
