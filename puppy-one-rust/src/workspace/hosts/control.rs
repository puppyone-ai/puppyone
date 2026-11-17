//! The local control channel between the App and the host (`control.mjs`):
//! one JSON object per line over a Unix socket in the host's own state
//! directory. Only this user can reach it: the directory and socket are
//! 0700/0600, and every connection first presents the token the host wrote
//! there (0600). Both ends can call the other: the App asks the host to
//! share or stop, and the host asks the App for the few Cloud calls that
//! need the signed-in person.
use super::service::{HostService, Person, PersonSession};
use futures_util::future::BoxFuture;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{UnixListener, UnixStream},
    sync::{mpsc, oneshot},
};

const MAX_LINE: usize = 1024 * 1024;
const HELLO_TIMEOUT: Duration = Duration::from_secs(5);
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_SOCKET_PATH: usize = 100;
const MAX_CLIENTS: usize = 4;

/// `hostControlPaths`: a long state directory gets a short socket in a
/// private directory of this user's home instead (104 bytes on macOS).
pub fn paths(dir: &Path) -> (PathBuf, PathBuf) {
    let token = dir.join("control-token");
    let inside = dir.join("control.sock");
    if inside.as_os_str().len() <= MAX_SOCKET_PATH {
        return (inside, token);
    }
    let name = &blake3::hash(dir.as_os_str().as_encoded_bytes()).to_hex()[..24];
    let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
    (
        home.join(".puppyone-host").join(format!("{name}.sock")),
        token,
    )
}

pub type Handler =
    Arc<dyn Fn(String, Value) -> BoxFuture<'static, Result<Value, String>> + Send + Sync>;
pub type Events = Arc<dyn Fn(String, Value) + Send + Sync>;

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>;
/// One end of the channel: it calls the other and answers its calls.
#[derive(Clone)]
pub struct Peer {
    send: mpsc::UnboundedSender<String>,
    pending: Pending,
    closed: Arc<AtomicBool>,
}
impl Peer {
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        if self.is_closed() {
            return Err("Host service disconnected.".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (reply, answer) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), reply);
        let line = json!({"type": "call", "id": id, "method": method, "params": params});
        let _ = self.send.send(line.to_string());
        match tokio::time::timeout(CALL_TIMEOUT, answer).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("Host service disconnected.".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err("Host service did not answer.".into())
            }
        }
    }
    pub fn emit(&self, event: &str, data: Value) {
        let _ = self
            .send
            .send(json!({"type": "event", "event": event, "data": data}).to_string());
    }
}

/// Runs the RPC over `stream` after the hello; `rest` is what followed it.
fn run_peer(
    stream: UnixStream,
    rest: Vec<u8>,
    handler: Handler,
    events: Events,
    on_close: impl FnOnce() + Send + 'static,
) -> Peer {
    let (read, mut write) = stream.into_split();
    let (send, mut lines) = mpsc::unbounded_channel::<String>();
    let peer = Peer {
        send,
        pending: Arc::default(),
        closed: Arc::default(),
    };
    tokio::spawn(async move {
        while let Some(mut line) = lines.recv().await {
            line.push('\n');
            if write.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
    });
    let reader = peer.clone();
    tokio::spawn(async move {
        let mut input = BufReader::new(tokio::io::AsyncReadExt::chain(
            std::io::Cursor::new(rest),
            read,
        ));
        loop {
            let mut line = Vec::new();
            match input.read_until(b'\n', &mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) if line.len() > MAX_LINE => break,
                Ok(_) => {}
            }
            let Ok(message) = serde_json::from_slice::<Value>(&line) else {
                break;
            };
            match message["type"].as_str() {
                Some("event") => events(
                    message["event"].as_str().unwrap_or_default().to_owned(),
                    message["data"].clone(),
                ),
                Some("result") | Some("error") => {
                    let id = message["id"].as_str().unwrap_or_default();
                    if let Some(waiter) = reader.pending.lock().unwrap().remove(id) {
                        let _ = waiter.send(if message["type"] == "result" {
                            Ok(message["result"].clone())
                        } else {
                            Err(message["message"]
                                .as_str()
                                .unwrap_or("Host service call failed.")
                                .to_owned())
                        });
                    }
                }
                Some("call") => {
                    let (handler, send) = (handler.clone(), reader.send.clone());
                    let id = message["id"].clone();
                    let method = message["method"].as_str().unwrap_or_default().to_owned();
                    let params = message["params"].clone();
                    tokio::spawn(async move {
                        let reply = match handler(method, params).await {
                            Ok(result) => json!({"type": "result", "id": id, "result": result}),
                            Err(message) => json!({"type": "error", "id": id, "message": message}),
                        };
                        let _ = send.send(reply.to_string());
                    });
                }
                _ => {}
            }
        }
        reader.closed.store(true, Ordering::SeqCst);
        for (_, waiter) in reader.pending.lock().unwrap().drain() {
            let _ = waiter.send(Err("Host service disconnected.".into()));
        }
        on_close();
    });
    peer
}

/// The App as the host's [`Person`]: its session and host routes.
struct AppPerson(Peer);
impl Person for AppPerson {
    fn session(&self) -> Option<PersonSession> {
        let value = block(self.0.call("session", json!({}))).ok()?;
        serde_json::from_value(value).ok()
    }
    fn api(&self, method: &str, route: &str, body: Option<Value>) -> Result<Value, String> {
        if !super::service::is_host_route(route) {
            return Err("This route is not available to the host service.".into());
        }
        block(self.0.call(
            "api",
            json!({"route": route, "init": {"method": method, "body": body}}),
        ))
    }
}
/// Waits for `future` from a host method's blocking thread.
fn block<T>(future: impl std::future::Future<Output = T>) -> T {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => tokio::task::block_in_place(|| handle.block_on(future)),
        Err(_) => super::remote::runtime().block_on(future),
    }
}

fn write_private(file: &Path, content: &str) -> std::io::Result<()> {
    super::identity::save_private(file, content.as_bytes()).map_err(std::io::Error::other)
}

/// Serves `host` on its control socket until `shutdown` is asked for.
pub async fn serve(
    dir: PathBuf,
    host: Arc<HostService>,
    shutdown: mpsc::UnboundedSender<()>,
) -> std::io::Result<()> {
    std::fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    let (socket, token_file) = paths(&dir);
    let token = {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(std::io::Error::other)?;
        base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes)
    };
    write_private(&token_file, &token)?;
    if let Some(parent) = socket.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let _ = std::fs::remove_file(&socket);
    let listener = UnixListener::bind(&socket)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600));
    }
    let peers: Arc<Mutex<Vec<Peer>>> = Arc::default();
    {
        let peers = peers.clone();
        host.set_notify(Arc::new(move |event, data| {
            for peer in peers.lock().unwrap().iter() {
                peer.emit(event, data.clone());
            }
        }));
    }
    loop {
        let (mut stream, _) = listener.accept().await?;
        if peers
            .lock()
            .unwrap()
            .iter()
            .filter(|p| !p.is_closed())
            .count()
            >= MAX_CLIENTS
        {
            continue;
        }
        let (host, token, peers, shutdown) =
            (host.clone(), token.clone(), peers.clone(), shutdown.clone());
        tokio::spawn(async move {
            let mut hello = Vec::new();
            let mut reader = BufReader::new(&mut stream);
            let read =
                tokio::time::timeout(HELLO_TIMEOUT, reader.read_until(b'\n', &mut hello)).await;
            let rest = reader.buffer().to_vec();
            drop(reader);
            if !matches!(read, Ok(Ok(n)) if n > 0 && n <= 4096) {
                return;
            }
            let Ok(hello) = serde_json::from_slice::<Value>(&hello) else {
                return;
            };
            let presented = hello["token"].as_str().unwrap_or_default();
            let same = presented.len() == token.len()
                && presented
                    .bytes()
                    .zip(token.bytes())
                    .fold(0u8, |acc, (a, b)| acc | (a ^ b))
                    == 0;
            if hello["type"] != "hello" || !same {
                return;
            }
            let desktop = hello["role"] == "desktop";
            if stream.write_all(b"{\"type\":\"welcome\"}\n").await.is_err() {
                return;
            }
            let calls = host.clone();
            let handler: Handler = Arc::new(move |method, params| {
                let (host, shutdown) = (calls.clone(), shutdown.clone());
                Box::pin(async move {
                    // Other local clients may only observe.
                    if !desktop && method != "status" {
                        return Err("Unknown method.".into());
                    }
                    if method == "shutdown" {
                        let _ = shutdown.send(());
                        return Ok(json!(true));
                    }
                    tokio::task::spawn_blocking(move || host.call(&method, &params))
                        .await
                        .map_err(|e| e.to_string())?
                })
            });
            let left = host.clone();
            let peer = run_peer(stream, rest, handler, Arc::new(|_, _| {}), move || {
                if desktop {
                    left.set_person(None);
                }
            });
            if desktop {
                host.set_person(Some(Arc::new(AppPerson(peer.clone()))));
            }
            peers.lock().unwrap().push(peer);
        });
    }
}

/// Connects as the App (or another local client); fails when no host listens.
pub async fn connect(
    dir: &Path,
    role: &str,
    handler: Handler,
    events: Events,
    on_close: impl FnOnce() + Send + 'static,
) -> Result<Peer, String> {
    let (socket, token_file) = paths(dir);
    let token = std::fs::read_to_string(&token_file).map_err(|e| e.to_string())?;
    let mut stream = UnixStream::connect(&socket)
        .await
        .map_err(|e| e.to_string())?;
    let hello = json!({"type": "hello", "token": token.trim(), "role": role});
    stream
        .write_all(format!("{hello}\n").as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(&mut stream);
    let mut welcome = Vec::new();
    tokio::time::timeout(HELLO_TIMEOUT, reader.read_until(b'\n', &mut welcome))
        .await
        .map_err(|_| "Host service did not answer.".to_owned())?
        .map_err(|e| e.to_string())?;
    let rest = reader.buffer().to_vec();
    drop(reader);
    let welcome: Value = serde_json::from_slice(&welcome).unwrap_or_default();
    if welcome["type"] != "welcome" {
        return Err("Host service refused this client.".into());
    }
    Ok(run_peer(stream, rest, handler, events, on_close))
}

#[cfg(test)]
mod tests {
    use super::super::identity::{KeyStore, MemoryKeys};
    use super::*;

    /// The App reaches its host with the token, the host borrows the App's
    /// person for its Cloud calls, and a client without the token is refused.
    #[test]
    fn the_app_drives_its_host_over_the_control_socket() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("host-service");
        let keys = Arc::new(MemoryKeys::default());
        let host = HostService::new(
            dir.clone(),
            vec![],
            "0.4.0",
            None,
            Arc::new(move || {
                struct Same(Arc<MemoryKeys>);
                impl KeyStore for Same {
                    fn put(&self, i: &str, s: &[u8]) -> Result<(), String> {
                        self.0.put(i, s)
                    }
                    fn get(&self, i: &str) -> Result<Option<Vec<u8>>, String> {
                        self.0.get(i)
                    }
                    fn delete(&self, i: &str) -> Result<(), String> {
                        self.0.delete(i)
                    }
                }
                Box::new(Same(keys.clone())) as Box<dyn KeyStore>
            }),
            None,
        );
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let (stop, mut stopped) = mpsc::unbounded_channel();
            tokio::spawn(serve(dir.clone(), host.clone(), stop));
            let mut tries = 0;
            while !paths(&dir).1.exists() || UnixStream::connect(paths(&dir).0).await.is_err() {
                tries += 1;
                assert!(tries < 200);
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            let asked = Arc::new(Mutex::new(Vec::<Value>::new()));
            let seen = asked.clone();
            let handler: Handler = Arc::new(move |method, params| {
                let seen = seen.clone();
                Box::pin(async move {
                    match method.as_str() {
                        "session" => Ok(json!({"user_id": "1e8a6c52-2222-4b3a-9c3f-6b5a4c3d2e1f",
                            "session_generation": "g", "api_base_url": "https://api.puppyone.ai/api/v1"})),
                        "api" => {
                            seen.lock().unwrap().push(params);
                            Ok(json!({"device_id": "0d9b7f61-1111-4c2a-8b2e-7a6b5c4d3e2f"}))
                        }
                        _ => Err("Unknown method.".into()),
                    }
                })
            });
            let app = connect(&dir, "desktop", handler, Arc::new(|_, _| {}), || {})
                .await
                .unwrap();
            let status = app.call("status", json!({})).await.unwrap();
            assert_eq!(status["state"], "off");
            app.call("configure", json!({"apiBase": "https://api.puppyone.ai/api/v1"}))
                .await
                .unwrap();
            let owner = app
                .call("identityRegister", json!({"name": "Mac", "platform": "darwin"}))
                .await
                .unwrap();
            assert_eq!(owner["deviceId"], "0d9b7f61-1111-4c2a-8b2e-7a6b5c4d3e2f");
            assert_eq!(asked.lock().unwrap()[0]["route"], "/hosts/devices");
            // Observers may read, never change.
            let observer = connect(&dir, "client", Arc::new(|_, _| Box::pin(async { Err("no".into()) })), Arc::new(|_, _| {}), || {})
                .await
                .unwrap();
            assert!(observer.call("stopSharing", json!({})).await.is_err());
            assert!(observer.call("status", json!({})).await.is_ok());
            // The wrong token: no welcome.
            std::fs::write(paths(&dir).1, "wrong").unwrap();
            assert!(connect(&dir, "desktop", Arc::new(|_, _| Box::pin(async { Ok(Value::Null) })), Arc::new(|_, _| {}), || {}).await.is_err());
            app.call("shutdown", json!({})).await.unwrap();
            assert!(stopped.recv().await.is_some());
        });
    }
}
