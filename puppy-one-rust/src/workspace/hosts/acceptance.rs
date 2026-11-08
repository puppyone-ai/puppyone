//! Two computers against the real Cloud (`two-computer-acceptance`): this
//! process is both. Computer A is PuppyOne Host (device key, registry,
//! device connection, SSH server, the folder sandbox); computer B is the
//! access side. Both are the same person, signed in with a Supabase password
//! grant in place of the browser; everything after the token is this
//! repository's code. Run explicitly:
//!
//! ```text
//! cargo test -p po-workspace --features test-support -- hosts::acceptance --ignored --nocapture
//! ```
//!
//! Needs `ACCEPT_ACCOUNT_FILE` (`{"email","password"}`) and
//! `ACCEPT_SUPABASE_FILE` (`{"SUPABASE_URL","SUPABASE_ANON_KEY"}`); the API is
//! `ACCEPT_API` (qubits by default). The device it registers is removed at
//! the end.
#![cfg(test)]
use super::{
    connector::State,
    exec::Mechanism,
    git::GitRequest,
    identity::{KeyStore, MemoryKeys},
    lines::HostError,
    protocol::Request,
    registry::Execution,
    remote::{Cloud, FolderEvent, Hosts, Socket, runtime},
    service::{HostService, Person, PersonSession},
    ssh::Output,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub(crate) struct Account {
    pub api: String,
    pub token: String,
    pub user: String,
    /// The grant itself (`refresh_token`, `user.email`).
    pub grant: Value,
    http: reqwest::Client,
}
impl Account {
    pub(crate) fn sign_in() -> Self {
        let home = std::env::var("HOME").unwrap();
        let read = |var: &str, default: &str| -> Value {
            let path = std::env::var(var).unwrap_or_else(|_| format!("{home}/.secrets/{default}"));
            serde_json::from_slice(&std::fs::read(path).expect("acceptance secrets")).unwrap()
        };
        let account = read("ACCEPT_ACCOUNT_FILE", "qubits-e2e-colleague.json");
        let supabase = read("ACCEPT_SUPABASE_FILE", "qubits-supabase-public.json");
        let api = std::env::var("ACCEPT_API")
            .unwrap_or_else(|_| "https://qubits-api.puppyone.ai/api/v1".into());
        let http = reqwest::Client::new();
        let grant: Value = runtime().block_on(async {
            http.post(format!(
                "{}/auth/v1/token?grant_type=password",
                supabase["SUPABASE_URL"].as_str().unwrap()
            ))
            .header("apikey", supabase["SUPABASE_ANON_KEY"].as_str().unwrap())
            .json(&json!({"email": account["email"], "password": account["password"]}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap()
        });
        Self {
            api,
            token: grant["access_token"].as_str().expect("signed in").into(),
            user: grant["user"]["id"].as_str().unwrap().into(),
            grant,
            http,
        }
    }
    async fn call(
        &self,
        method: &str,
        route: &str,
        body: Option<Value>,
    ) -> Result<Value, (u16, String)> {
        let method = reqwest::Method::from_bytes(method.as_bytes()).unwrap();
        let mut request = self
            .http
            .request(method, format!("{}{route}", self.api))
            .bearer_auth(&self.token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|e| (0, e.to_string()))?;
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        if (200..300).contains(&status) {
            Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
        } else {
            Err((status, text))
        }
    }
    fn blocking(
        &self,
        method: &str,
        route: &str,
        body: Option<Value>,
    ) -> Result<Value, (u16, String)> {
        let call = self.call(method, route, body);
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => tokio::task::block_in_place(|| handle.block_on(call)),
            Err(_) => runtime().block_on(call),
        }
    }
}
/// Computer A's App, lending its person to its host.
struct App(Arc<Account>);
impl Person for App {
    fn session(&self) -> Option<PersonSession> {
        Some(PersonSession {
            user_id: self.0.user.clone(),
            session_generation: "accept".into(),
            api_base_url: self.0.api.clone(),
        })
    }
    fn api(&self, method: &str, route: &str, body: Option<Value>) -> Result<Value, String> {
        self.0
            .blocking(method, route, body)
            .map_err(|(status, text)| format!("{status} {text}"))
    }
}
/// Computer B's access side, as the App's broker would do it.
struct Access(Arc<Account>);
impl Cloud for Access {
    fn catalog(&self) -> Result<Value, HostError> {
        self.0
            .blocking("GET", "/hosts", None)
            .map_err(|(s, _)| HostError {
                status: s,
                ..HostError::new("folder_unavailable")
            })
    }
    fn certificate(&self, device: &str, public_key: &str) -> Result<Value, HostError> {
        self.0
            .blocking(
                "POST",
                &format!("/hosts/devices/{device}/ssh-certificate"),
                Some(json!({"public_key": public_key})),
            )
            .map_err(|(s, text)| {
                eprintln!("certificate refused: {s} {text}");
                HostError {
                    status: s,
                    ..HostError::new("folder_unavailable")
                }
            })
    }
    fn origin(&self) -> url::Url {
        let api = url::Url::parse(&self.0.api).unwrap();
        url::Url::parse(&api.origin().ascii_serialization()).unwrap()
    }
    fn tunnel(&self, url: &url::Url) -> Result<Box<dyn Socket>, HostError> {
        use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderValue};
        let mut request = url.as_str().into_client_request().unwrap();
        request.headers_mut().insert(
            "Sec-WebSocket-Protocol",
            HeaderValue::from_str(&format!("version.v1, version.bearer.{}", self.0.token)).unwrap(),
        );
        let connect = tokio_tungstenite::connect_async(request);
        let connected = match tokio::runtime::Handle::try_current() {
            Ok(handle) => tokio::task::block_in_place(|| handle.block_on(connect)),
            Err(_) => runtime().block_on(connect),
        };
        connected
            .map(|(socket, _)| Box::new(socket) as Box<dyn Socket>)
            .map_err(|e| {
                eprintln!("tunnel refused: {e}");
                HostError::new("tunnel_unavailable")
            })
    }
}

fn step(name: &str, started: Instant) {
    eprintln!("[acceptance] {name} ({} ms)", started.elapsed().as_millis());
}
fn wait(what: &str, limit: Duration, mut ready: impl FnMut() -> bool) {
    let deadline = Instant::now() + limit;
    while !ready() {
        assert!(Instant::now() < deadline, "{what} did not happen");
        std::thread::sleep(Duration::from_millis(200));
    }
}

#[test]
#[ignore = "real Cloud acceptance; run explicitly"]
fn two_computers_share_a_folder_through_the_real_cloud() {
    let started = Instant::now();
    let account = Arc::new(Account::sign_in());
    step("signed in", started);
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("accept-notes");
    std::fs::create_dir(&folder).unwrap();
    let image: Vec<u8> = (0..=255u8).cycle().take(70_000).collect();
    std::fs::write(folder.join("note.md"), "hello from A\n").unwrap();
    std::fs::write(folder.join("image.bin"), &image).unwrap();
    // Computer A: its host.
    let keys = Arc::new(MemoryKeys::default());
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
    let host = HostService::new(
        temp.path().join("host-service"),
        vec![temp.path().join("app-data")],
        env!("CARGO_PKG_VERSION"),
        None,
        Arc::new(move || Box::new(Same(keys.clone())) as Box<dyn KeyStore>),
        Mechanism::detect(),
    );
    host.set_person(Some(Arc::new(App(account.clone()))));
    host.configure(&account.api).unwrap();
    let owner = host
        .identity_register("Rust acceptance A", super::service::platform())
        .unwrap();
    step(&format!("device {} registered", owner.device_id), started);
    let cleanup = {
        let (account, device) = (account.clone(), owner.device_id.clone());
        move || {
            let removed = account.blocking("DELETE", &format!("/hosts/devices/{device}"), None);
            eprintln!("[acceptance] device removed: {}", removed.is_ok());
        }
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let shared = host
            .registry_register(&owner.device_id, &folder, "accept-notes", true)
            .unwrap();
        let folder_id = shared["folderId"].as_str().unwrap().to_owned();
        host.connect(&owner).unwrap();
        wait("A online", Duration::from_secs(30), || {
            host.status()["state"] == State::Online.as_str()
        });
        step("A online", started);
        // Computer B: the access side.
        let hosts = Hosts::new(Arc::new(Access(account.clone())));
        let devices = runtime().block_on(hosts.catalog()).unwrap();
        let device = devices
            .iter()
            .find(|d| d.id == owner.device_id)
            .expect("A in the catalog");
        assert!(device.online);
        assert!(device.folders.iter().any(|f| f.id == folder_id));
        step("B sees A online with its folder", started);
        let request = |request: Request| runtime().block_on(hosts.request(&folder_id, &request));
        let connecting = Instant::now();
        runtime().block_on(hosts.files(&folder_id)).unwrap();
        eprintln!(
            "[acceptance] SSH through the tunnel in {} ms",
            connecting.elapsed().as_millis()
        );
        let reading = Instant::now();
        let read = request(Request::Read {
            path: "image.bin".into(),
        })
        .unwrap();
        eprintln!(
            "[acceptance] 70 KB read in {} ms",
            reading.elapsed().as_millis()
        );
        assert_eq!(
            STANDARD
                .decode(read["content_base64"].as_str().unwrap())
                .unwrap(),
            image,
            "byte exact"
        );
        let started_read = Instant::now();
        let note = request(Request::Read {
            path: "note.md".into(),
        })
        .unwrap();
        eprintln!(
            "[acceptance] read latency {} ms",
            started_read.elapsed().as_millis()
        );
        step("B reads byte-exact", started);
        let revision = note["revision"].as_str().unwrap().to_owned();
        request(Request::Write {
            path: "note.md".into(),
            content_base64: STANDARD.encode("edited on B\n"),
            expected_revision: Some(Some(revision.clone())),
        })
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(folder.join("note.md")).unwrap(),
            "edited on B\n"
        );
        let conflict = request(Request::Write {
            path: "note.md".into(),
            content_base64: STANDARD.encode("stale\n"),
            expected_revision: Some(Some(revision)),
        })
        .unwrap_err();
        assert_eq!(conflict.status, 409);
        let refused = request(Request::Read {
            path: "../outside".into(),
        })
        .unwrap_err();
        assert_eq!(refused.code, "invalid_path");
        request(Request::Mkdir {
            path: "made-on-b".into(),
        })
        .unwrap();
        assert!(folder.join("made-on-b").is_dir());
        step("B edits, conflicts and is refused outside", started);
        // A change on A reaches B's watch.
        let events = Arc::new(Mutex::new(Vec::<FolderEvent>::new()));
        let seen = events.clone();
        let watcher = hosts.clone();
        let id = folder_id.clone();
        runtime().spawn(async move {
            watcher
                .watch(&id, move |event| {
                    seen.lock().unwrap().push(event);
                    true
                })
                .await
        });
        wait("the watch", Duration::from_secs(20), || {
            !events.lock().unwrap().is_empty()
        });
        std::fs::write(folder.join("from-a.md"), "x").unwrap();
        wait("the change on B", Duration::from_secs(20), || {
            events.lock().unwrap().iter().any(|e| {
                matches!(e, FolderEvent::Change { paths, reset } if *reset || paths.iter().any(|p| p == "from-a.md"))
            }) && events.lock().unwrap().len() >= 2
        });
        step("A's change reaches B", started);
        // A terminal there, once A allows it (only where it has a sandbox).
        if Mechanism::detect().is_some() {
            host.call(
                "registrySetExecution",
                &json!({"accountId": owner.account_id, "deviceId": owner.device_id,
                    "folderId": folder_id, "terminal": true, "git": true}),
            )
            .unwrap();
            let revision = runtime()
                .block_on(hosts.catalog())
                .unwrap()
                .into_iter()
                .find(|d| d.id == owner.device_id)
                .and_then(|d| d.folders.into_iter().find(|f| f.id == folder_id))
                .unwrap()
                .revision;
            account
                .blocking(
                    "PATCH",
                    &format!("/hosts/devices/{}/folders/{folder_id}", owner.device_id),
                    Some(
                        json!({"name": "accept-notes", "writable": true, "terminal": true,
                        "git": true, "agent": false, "expected_revision": revision}),
                    ),
                )
                .unwrap();
            hosts.close(&folder_id);
            let output = runtime().block_on(async {
                let access = hosts.access(&folder_id).await.unwrap();
                let mut session = access.session("shell", 80, 24).await.unwrap();
                session.input(b"echo $((40 + 2)); exit\n").await;
                let mut text = String::new();
                loop {
                    match tokio::time::timeout(Duration::from_secs(20), session.next()).await {
                        Ok(Output::Data(bytes)) => text.push_str(&String::from_utf8_lossy(&bytes)),
                        Ok(Output::Exit(_)) | Ok(Output::Closed) | Err(_) => break,
                    }
                }
                text
            });
            assert!(output.contains("42"), "{output}");
            let status = request(Request::Git(GitRequest {
                op: "status".into(),
                ..Default::default()
            }))
            .unwrap();
            assert_eq!(status["isRepo"], false);
            // Consent withdrawn here: nothing more runs.
            host.registry_set_execution(&owner, &folder_id, Execution::default())
                .unwrap();
            let refused = runtime().block_on(async {
                let access = hosts.access(&folder_id).await?;
                access.session("shell", 80, 24).await.map(|_| ())
            });
            assert!(refused.is_err());
            step("a sandboxed terminal there, then withdrawn", started);
        }
        // Unshared on A: B can no longer reach it.
        host.registry_remove(&owner.device_id, &folder_id).unwrap();
        hosts.close(&folder_id);
        let gone = request(Request::List {
            path: String::new(),
        })
        .unwrap_err();
        eprintln!(
            "[acceptance] after unsharing: {} {}",
            gone.code, gone.status
        );
        assert!(matches!(
            gone.code.as_str(),
            "folder_unavailable" | "device_offline" | "tunnel_unavailable"
        ));
        step("unshared", started);
        host.stop_sharing().unwrap();
    }));
    host.dispose();
    cleanup();
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}

/// Interop, one way: a folder a TypeScript host shares
/// (`ACCEPT_INTEROP_FOLDER`), read and edited from this access side.
#[test]
#[ignore = "real Cloud interop; run explicitly with a TypeScript host sharing"]
fn a_folder_a_typescript_host_shares_opens_here() {
    let folder = std::env::var("ACCEPT_INTEROP_FOLDER").expect("the TypeScript host's folder id");
    let account = Arc::new(Account::sign_in());
    let hosts = Hosts::new(Arc::new(Access(account)));
    let request = |request: Request| runtime().block_on(hosts.request(&folder, &request));
    let read = request(Request::Read {
        path: "note.md".into(),
    })
    .unwrap();
    let text = String::from_utf8(
        STANDARD
            .decode(read["content_base64"].as_str().unwrap())
            .unwrap(),
    )
    .unwrap();
    eprintln!("[interop] read from the TypeScript host: {text:?}");
    request(Request::Write {
        path: "note.md".into(),
        content_base64: STANDARD.encode("written by the Rust access side\n"),
        expected_revision: Some(Some(read["revision"].as_str().unwrap().into())),
    })
    .unwrap();
    let list = request(Request::List {
        path: String::new(),
    })
    .unwrap();
    eprintln!("[interop] listed: {}", list["entries"]);
    let git = request(Request::Git(GitRequest {
        op: "status".into(),
        ..Default::default()
    }));
    eprintln!(
        "[interop] git without consent: {:?}",
        git.map(|_| ()).map_err(|e| e.code)
    );
}

/// Interop, the other way: a folder this host shares, read and edited by
/// the TypeScript access side (`ACCEPT_TS_ACCESS`, a Node script).
#[test]
#[ignore = "real Cloud interop; run explicitly with the TypeScript access script"]
fn a_folder_this_host_shares_opens_from_typescript() {
    let script = std::env::var("ACCEPT_TS_ACCESS").expect("the TypeScript access script");
    let account = Arc::new(Account::sign_in());
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("interop");
    std::fs::create_dir(&folder).unwrap();
    std::fs::write(folder.join("note.md"), "shared by the Rust host\n").unwrap();
    let host = HostService::new(
        temp.path().join("host-service"),
        vec![],
        env!("CARGO_PKG_VERSION"),
        None,
        Arc::new(|| Box::new(MemoryKeysOnce::get()) as Box<dyn KeyStore>),
        Mechanism::detect(),
    );
    host.set_person(Some(Arc::new(App(account.clone()))));
    host.configure(&account.api).unwrap();
    let owner = host
        .identity_register("Rust interop host", super::service::platform())
        .unwrap();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let shared = host
            .registry_register(&owner.device_id, &folder, "interop", true)
            .unwrap();
        let folder_id = shared["folderId"].as_str().unwrap().to_owned();
        host.connect(&owner).unwrap();
        wait("the host online", Duration::from_secs(30), || {
            host.status()["state"] == State::Online.as_str()
        });
        let output = std::process::Command::new("node")
            .arg(&script)
            .arg(&folder_id)
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&output.stdout);
        eprintln!("[interop] TypeScript access side: {text}");
        eprintln!("{}", String::from_utf8_lossy(&output.stderr));
        let reply: Value = serde_json::from_str(text.trim().lines().last().unwrap()).unwrap();
        assert_eq!(reply["ok"], true);
        assert_eq!(reply["text"], "shared by the Rust host\n");
        assert_eq!(
            std::fs::read_to_string(folder.join("note.md")).unwrap(),
            "written by the TypeScript access side\n"
        );
    }));
    host.dispose();
    let _ = account.blocking(
        "DELETE",
        &format!("/hosts/devices/{}", owner.device_id),
        None,
    );
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}
/// One key store per test process, as a keychain would be.
struct MemoryKeysOnce;
impl MemoryKeysOnce {
    fn get() -> impl KeyStore {
        static KEYS: std::sync::OnceLock<Arc<MemoryKeys>> = std::sync::OnceLock::new();
        struct Shared(Arc<MemoryKeys>);
        impl KeyStore for Shared {
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
        Shared(KEYS.get_or_init(Arc::default).clone())
    }
}
