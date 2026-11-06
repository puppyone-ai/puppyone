//! `electron/app-preview-runtime.mjs` with `app-preview-service.mjs`: one
//! App Preview runtime per `(workspace root, .puppyoneapp)` for the whole
//! process. A local server runs only after its manifest (and the package
//! script it names) was confirmed once; a static HTML file is served from a
//! loopback server of its own; an existing URL is simply connected.
//!
//! Operations on one app are serialized; every call blocks its (background)
//! caller. Sessions are shared by owners (open App Preview surfaces) and
//! stop when the last one releases them or the app quits.
use super::manifest::{self, APP_PREVIEW_EXTENSION, Launch, Manifest};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

const HEALTH_TIMEOUT: Duration = Duration::from_millis(18_000);
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(300);
const HEALTH_REQUEST_TIMEOUT: Duration = Duration::from_millis(1200);
const LOG_LIMIT: usize = 60_000;
const TRUST_STORE_FILENAME: &str = "app-preview-trust.json";

/// `serializeSession(session)`: what the page shows (`AppPreviewResult`).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub runtime_id: Option<String>,
    pub app_id: String,
    pub name: String,
    pub status: &'static str,
    pub path: String,
    pub url: Option<String>,
    pub port: Option<u16>,
    pub command: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub message: Option<String>,
    pub logs: String,
    pub generation: Option<u64>,
    pub sequence: u64,
    pub reason: Option<&'static str>,
    pub exit_code: Option<i32>,
}
/// A runtime state change for one workspace root.
#[derive(Clone, Debug)]
pub struct Update {
    pub root: PathBuf,
    pub result: Snapshot,
}

/// The confirmation a local server needs before it runs
/// (`native.appPreview.run.*`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrustPrompt {
    pub app_name: String,
    pub command: String,
    pub directory: String,
    pub permissions: Option<String>,
}
/// Asks the person; `true` runs the app.
pub type Confirm = Box<dyn Fn(TrustPrompt) -> bool + Send + Sync>;

/// What the process allows itself to inherit (`SAFE_INHERITED_ENVIRONMENT`).
const SAFE_INHERITED: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LANGUAGE",
    "TMPDIR",
    "TMP",
    "TEMP",
    "TERM",
    "TERM_PROGRAM",
    "COLORTERM",
    "FORCE_COLOR",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "NVM_DIR",
    "NVM_BIN",
    "VOLTA_HOME",
    "PNPM_HOME",
    "BUN_INSTALL",
    "ASDF_DIR",
    "ASDF_DATA_DIR",
    "HERMES_HOME",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
];

/// `sanitizeAppPreviewEnvironment(source)`.
pub fn sanitize_environment(
    source: impl IntoIterator<Item = (String, String)>,
) -> BTreeMap<String, String> {
    source
        .into_iter()
        .filter(|(key, _)| {
            let upper = key.to_uppercase();
            SAFE_INHERITED.contains(&upper.as_str()) || upper.starts_with("LC_")
        })
        .collect()
}

/// Sessions and listeners, shared with each session's exit watcher.
#[derive(Default)]
struct Hub {
    sessions: Mutex<HashMap<String, Shared>>,
    listeners: Mutex<Vec<async_channel::Sender<Update>>>,
}
impl Hub {
    fn session(&self, key: &str) -> Option<Shared> {
        self.sessions.lock().unwrap().get(key).cloned()
    }
    /// `publishSessionState(session)`: only the current session reports.
    fn publish(&self, session: &Shared) {
        let update = {
            let mut s = session.lock().unwrap();
            let current = self
                .session(&s.key)
                .is_some_and(|current| Arc::ptr_eq(&current, session));
            if !current {
                return;
            }
            s.sequence += 1;
            Update {
                root: s.root.clone(),
                result: s.snapshot(),
            }
        };
        self.listeners
            .lock()
            .unwrap()
            .retain(|tx| tx.try_send(update.clone()).is_ok());
    }
}

struct Session {
    hub: std::sync::Weak<Hub>,
    key: String,
    root: PathBuf,
    app_path: String,
    app_id: String,
    manifest: Manifest,
    manifest_hash: String,
    cwd_path: Option<PathBuf>,
    cwd_relative: String,
    static_file: Option<PathBuf>,
    generation: u64,
    runtime_id: String,
    owners: HashSet<u64>,
    /// The process group's leader while it runs.
    pid: Option<u32>,
    exited: bool,
    /// Set while the runtime stops the process itself.
    ignore_exit: bool,
    static_server: Option<Arc<AtomicBool>>,
    port: Option<u16>,
    url: Option<String>,
    logs: String,
    status: &'static str,
    message: Option<String>,
    reason: Option<&'static str>,
    exit_code: Option<i32>,
    sequence: u64,
}
type Shared = Arc<Mutex<Session>>;

impl Session {
    fn append(&mut self, text: &str) {
        self.logs.push_str(text);
        if self.logs.len() > LOG_LIMIT {
            let mut cut = self.logs.len() - LOG_LIMIT;
            while !self.logs.is_char_boundary(cut) {
                cut += 1;
            }
            self.logs.drain(..cut);
        }
    }
    fn snapshot(&self) -> Snapshot {
        let local = match &self.manifest.launch {
            Some(Launch::LocalServer { command, .. }) => Some(command.clone()),
            _ => None,
        };
        Snapshot {
            runtime_id: Some(self.runtime_id.clone()),
            app_id: self.app_id.clone(),
            name: self.manifest.name.clone(),
            status: self.status,
            path: self.app_path.clone(),
            url: self.url.clone(),
            port: self.port,
            cwd: if self.cwd_relative.is_empty() {
                local.as_ref().map(|_| ".".to_owned())
            } else {
                Some(self.cwd_relative.clone())
            },
            command: local,
            message: self.message.clone(),
            logs: self.logs.clone(),
            generation: Some(self.generation),
            sequence: self.sequence,
            reason: self.reason,
            exit_code: self.exit_code,
        }
    }
}

/// What `loadAppPreviewContext` resolved for one request.
struct Context {
    root: PathBuf,
    app_path: String,
    app_id: String,
    manifest: Manifest,
    manifest_hash: String,
    cwd_path: Option<PathBuf>,
    cwd_relative: String,
    static_file: Option<PathBuf>,
}

pub struct Runtime {
    data_dir: PathBuf,
    hub: Arc<Hub>,
    generations: Mutex<HashMap<String, u64>>,
    /// `lifecycleByApp`: one operation at a time per app.
    lifecycles: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    trusted: Mutex<Option<HashSet<String>>>,
}

/// The process-wide runtime.
pub fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| Runtime::new(crate::platform::data_dir()))
}

static OWNER: AtomicU64 = AtomicU64::new(1);
/// A new owner identity for an App Preview surface.
pub fn owner() -> u64 {
    OWNER.fetch_add(1, Ordering::Relaxed)
}

fn session_key(root: &Path, app_path: &str) -> String {
    format!("{}\n{app_path}", root.display())
}

impl Runtime {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            hub: Arc::default(),
            generations: Mutex::default(),
            lifecycles: Mutex::default(),
            trusted: Mutex::default(),
        }
    }
    /// `app-preview:runtime-state`: every later state change.
    pub fn subscribe(&self) -> async_channel::Receiver<Update> {
        let (tx, rx) = async_channel::unbounded();
        self.hub.listeners.lock().unwrap().push(tx);
        rx
    }
    fn lifecycle(&self, key: &str) -> Arc<Mutex<()>> {
        self.lifecycles
            .lock()
            .unwrap()
            .entry(key.to_owned())
            .or_default()
            .clone()
    }
    fn session(&self, key: &str) -> Option<Shared> {
        self.hub.session(key)
    }
    fn publish(&self, session: &Shared) {
        self.hub.publish(session);
    }

    /// `start(sender, request)`.
    pub fn start(
        &self,
        owner: u64,
        root: &Path,
        path: &str,
        confirm: &Confirm,
    ) -> Result<Snapshot, String> {
        let app_path = normalize_app_path(path)?;
        let key = session_key(root, &app_path);
        let lifecycle = self.lifecycle(&key);
        let _serial = lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        self.start_locked(owner, root, &app_path, &key, confirm)
    }
    fn start_locked(
        &self,
        owner: u64,
        root: &Path,
        app_path: &str,
        key: &str,
        confirm: &Confirm,
    ) -> Result<Snapshot, String> {
        let context = load_context(root, app_path)?;
        let existing = self.session(key);
        if let Some(existing) = &existing {
            let mut s = existing.lock().unwrap();
            let same = s.app_path == context.app_path && s.manifest_hash == context.manifest_hash;
            if same && s.status == "running" && !s.exited {
                s.owners.insert(owner);
                return Ok(s.snapshot());
            }
        }
        self.ensure_trusted(&context, confirm)?;
        if let Some(existing) = existing {
            existing.lock().unwrap().owners.insert(owner);
            self.stop_session(&existing, Some("restart"));
            self.release(&existing);
        }
        let session = self.create_session(context, owner);
        self.hub
            .sessions
            .lock()
            .unwrap()
            .insert(key.to_owned(), session.clone());
        match self.start_session(&session) {
            Ok(()) => Ok(session.lock().unwrap().snapshot()),
            Err(error) => {
                {
                    let mut s = session.lock().unwrap();
                    if s.status != "stopped" {
                        s.status = "error";
                        s.message = Some(error.clone());
                        s.reason = s.reason.or(Some(classify_failure(&error)));
                        s.append(&format!("[puppyone] {error}\n"));
                    }
                }
                terminate(&session, "start failed");
                if let Some(stop) = session.lock().unwrap().static_server.take() {
                    stop.store(true, Ordering::SeqCst);
                }
                self.publish(&session);
                Err(error)
            }
        }
    }
    /// `restart(sender, request)`: a changed manifest prompts again.
    pub fn restart(
        &self,
        owner: u64,
        root: &Path,
        path: &str,
        confirm: &Confirm,
    ) -> Result<Snapshot, String> {
        let app_path = normalize_app_path(path)?;
        let key = session_key(root, &app_path);
        let lifecycle = self.lifecycle(&key);
        let _serial = lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        let context = load_context(root, &app_path)?;
        self.ensure_trusted(&context, confirm)?;
        if let Some(existing) = self.session(&key) {
            existing.lock().unwrap().owners.insert(owner);
            self.stop_session(&existing, Some("restart"));
            self.release(&existing);
        }
        self.start_locked(owner, root, &app_path, &key, confirm)
    }
    /// `stop(sender, request)`.
    pub fn stop(&self, owner: u64, root: &Path, path: &str) -> Result<Snapshot, String> {
        let app_path = normalize_app_path(path)?;
        let key = session_key(root, &app_path);
        let lifecycle = self.lifecycle(&key);
        let _serial = lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        let Some(existing) = self.session(&key) else {
            return Ok(Snapshot {
                app_id: format!("{}:{app_path}", root.display()),
                name: manifest::basename_without_extension(&app_path),
                status: "stopped",
                path: app_path,
                ..Default::default()
            });
        };
        require_owner(&existing, owner)?;
        self.stop_session(&existing, Some("stop"));
        let snapshot = existing.lock().unwrap().snapshot();
        Ok(snapshot)
    }
    /// `getLogs(sender, request)`.
    pub fn logs(&self, owner: u64, root: &Path, path: &str) -> Result<String, String> {
        let app_path = normalize_app_path(path)?;
        match self.session(&session_key(root, &app_path)) {
            Some(existing) => {
                require_owner(&existing, owner)?;
                Ok(existing.lock().unwrap().logs.clone())
            }
            None => Ok(String::new()),
        }
    }
    /// `openExternal(sender, request)`: the running app in the browser.
    pub fn open_external(
        &self,
        owner: u64,
        root: &Path,
        path: &str,
        confirm: &Confirm,
    ) -> Result<(), String> {
        let snapshot = self.start(owner, root, path, confirm)?;
        let url = snapshot
            .url
            .ok_or_else(|| "App Preview URL is unavailable.".to_owned())?;
        crate::platform::desktop::open_url(&url)
    }
    /// `closeSessionsForWindow`: an owner went away; apps nobody shows stop.
    pub fn release_owner(&self, owner: u64) {
        let sessions: Vec<Shared> = self
            .hub
            .sessions
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect();
        for session in sessions {
            let (key, empty) = {
                let mut s = session.lock().unwrap();
                if !s.owners.remove(&owner) {
                    continue;
                }
                (s.key.clone(), s.owners.is_empty())
            };
            if empty {
                let lifecycle = self.lifecycle(&key);
                let _serial = lifecycle.lock().unwrap_or_else(|e| e.into_inner());
                self.stop_session(&session, Some("window closed"));
                self.release(&session);
            }
        }
    }
    /// `closeAll()` at quit.
    pub fn close_all(&self) {
        let sessions: Vec<Shared> = self
            .hub
            .sessions
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect();
        for session in sessions {
            self.stop_session(&session, Some("quit"));
            self.release(&session);
        }
    }

    fn release(&self, session: &Shared) {
        let key = session.lock().unwrap().key.clone();
        let mut sessions = self.hub.sessions.lock().unwrap();
        if sessions.get(&key).is_some_and(|s| Arc::ptr_eq(s, session)) {
            sessions.remove(&key);
        }
    }
    fn create_session(&self, context: Context, owner: u64) -> Shared {
        let key = session_key(&context.root, &context.app_path);
        let generation = {
            let mut generations = self.generations.lock().unwrap();
            let next = generations.get(&key).copied().unwrap_or(0) + 1;
            generations.insert(key.clone(), next);
            next
        };
        Arc::new(Mutex::new(Session {
            hub: Arc::downgrade(&self.hub),
            key,
            root: context.root,
            app_path: context.app_path,
            app_id: context.app_id,
            manifest: context.manifest,
            manifest_hash: context.manifest_hash,
            cwd_path: context.cwd_path,
            cwd_relative: context.cwd_relative,
            static_file: context.static_file,
            generation,
            runtime_id: format!("app-runtime-{}", uuid::Uuid::new_v4()),
            owners: HashSet::from([owner]),
            pid: None,
            exited: false,
            ignore_exit: false,
            static_server: None,
            port: None,
            url: None,
            logs: String::new(),
            status: "starting",
            message: None,
            reason: None,
            exit_code: None,
            sequence: 0,
        }))
    }

    fn ensure_trusted(&self, context: &Context, confirm: &Confirm) -> Result<(), String> {
        let Some(Launch::LocalServer { command, .. }) = &context.manifest.launch else {
            return Ok(());
        };
        let trust_key = format!(
            "{}:{}:{}",
            context.root.display(),
            context.app_path,
            context.manifest_hash
        );
        if self.trust_store().contains(&trust_key) {
            return Ok(());
        }
        let prompt = TrustPrompt {
            app_name: context.manifest.name.clone(),
            command: format_command(command),
            directory: if context.cwd_relative.is_empty() {
                ".".into()
            } else {
                context.cwd_relative.clone()
            },
            permissions: (!context.manifest.workspace_permissions.is_empty()).then(|| {
                format!(
                    "workspace: {}",
                    context.manifest.workspace_permissions.join(", ")
                )
            }),
        };
        if !confirm(prompt) {
            return Err("App preview was cancelled.".into());
        }
        self.remember_trust(trust_key);
        Ok(())
    }
    fn trust_path(&self) -> PathBuf {
        self.data_dir.join(TRUST_STORE_FILENAME)
    }
    fn trust_store(&self) -> HashSet<String> {
        let mut trusted = self.trusted.lock().unwrap();
        trusted
            .get_or_insert_with(|| {
                std::fs::read_to_string(self.trust_path())
                    .ok()
                    .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
                    .and_then(|v| v["trustedManifests"].as_array().cloned())
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|i| i.as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default()
            })
            .clone()
    }
    fn remember_trust(&self, key: String) {
        let mut all = self.trust_store();
        if !all.insert(key.clone()) {
            return;
        }
        // The file keeps insertion order for its last 500 entries.
        let mut ordered: Vec<String> = std::fs::read_to_string(self.trust_path())
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .and_then(|v| v["trustedManifests"].as_array().cloned())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|i| i.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        ordered.push(key);
        let keep = ordered.len().saturating_sub(500);
        let ordered = ordered.split_off(keep);
        let _ = std::fs::create_dir_all(&self.data_dir);
        let _ = std::fs::write(
            self.trust_path(),
            serde_json::to_string_pretty(&serde_json::json!({ "trustedManifests": ordered }))
                .unwrap_or_default(),
        );
        *self.trusted.lock().unwrap() = Some(all);
    }

    fn start_session(&self, session: &Shared) -> Result<(), String> {
        let launch = {
            let mut s = session.lock().unwrap();
            s.status = "starting";
            s.message = None;
            s.manifest.launch.clone()
        };
        self.publish(session);
        match launch {
            Some(Launch::ExistingUrl { url }) => {
                let mut s = session.lock().unwrap();
                s.url = Some(url.clone());
                s.status = "running";
                s.append(&format!("[puppyone] Connected: {url}\n"));
                drop(s);
                self.publish(session);
                Ok(())
            }
            Some(Launch::StaticFile { path }) => {
                let file = session
                    .lock()
                    .unwrap()
                    .static_file
                    .clone()
                    .ok_or("App preview HTML file could not be found.")?;
                let (port, stop) = serve_static(&file)?;
                let mut s = session.lock().unwrap();
                s.static_server = Some(stop);
                s.port = Some(port);
                let url = format!("http://127.0.0.1:{port}/");
                s.url = Some(url.clone());
                s.status = "running";
                s.append(&format!("[puppyone] Serving {path}\n"));
                s.append(&format!("[puppyone] Ready: {url}\n"));
                drop(s);
                self.publish(session);
                Ok(())
            }
            Some(Launch::LocalServer {
                command,
                env,
                url,
                health,
                ..
            }) => self.start_local_server(session, &command, &env, &url, &health),
            None => Err("This App is not configured yet.".into()),
        }
    }
    fn start_local_server(
        &self,
        session: &Shared,
        command: &[String],
        env: &BTreeMap<String, String>,
        url_template: &str,
        health: &manifest::Health,
    ) -> Result<(), String> {
        let port = allocate_port()?;
        let url = build_local_url(url_template, port)?;
        let health_url = build_health_url(&url, &health.path)?;
        let (cwd, root) = {
            let mut s = session.lock().unwrap();
            s.port = Some(port);
            s.url = Some(url.clone());
            let cwd = s
                .cwd_path
                .clone()
                .ok_or("App preview cwd could not be found.")?;
            let starting = format!("[puppyone] Starting {}\n", s.manifest.name);
            s.append(&starting);
            s.append(&format!("[puppyone] {}\n", format_command(command)));
            s.append(&format!("[puppyone] {}\n", cwd.display()));
            (cwd, s.root.clone())
        };
        let command = manifest::interpolate_command(command, port).map_err(|e| e.message)?;
        let mut environment = sanitize_environment(std::env::vars());
        environment.insert(
            "PATH".into(),
            crate::platform::environment::search_path()
                .to_string_lossy()
                .into_owned(),
        );
        for (key, value) in env {
            let value =
                manifest::interpolate(value, port, &format!("App preview env value for {key}"))
                    .map_err(|e| e.message)?;
            environment.insert(key.clone(), value);
        }
        environment.insert("HOST".into(), "127.0.0.1".into());
        environment.insert("PORT".into(), port.to_string());
        environment.insert("BROWSER".into(), "none".into());
        environment.insert("PUPPYONE_APP_PREVIEW".into(), "1".into());
        environment.insert(
            "PUPPYONE_WORKSPACE_ROOT".into(),
            root.to_string_lossy().into_owned(),
        );
        let program = resolve_program(&command[0]);
        let mut process = Command::new(program);
        process
            .args(&command[1..])
            .current_dir(&cwd)
            .env_clear()
            .envs(&environment)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::platform::process::isolate(&mut process);
        let mut child: Child = match process.spawn() {
            Ok(child) => child,
            Err(error) => {
                let mut s = session.lock().unwrap();
                s.status = "error";
                s.message = Some(error.to_string());
                s.reason = Some("process-exit");
                s.append(&format!("[puppyone] Process error: {error}\n"));
                drop(s);
                self.publish(session);
                return Err(error.to_string());
            }
        };
        {
            let mut s = session.lock().unwrap();
            s.pid = Some(child.id());
            s.exited = false;
        }
        for stream in [
            child
                .stdout
                .take()
                .map(|s| Box::new(s) as Box<dyn Read + Send>),
            child
                .stderr
                .take()
                .map(|s| Box::new(s) as Box<dyn Read + Send>),
        ]
        .into_iter()
        .flatten()
        {
            let session = session.clone();
            thread::spawn(move || {
                let mut reader = BufReader::new(stream);
                let mut chunk = Vec::new();
                while reader.read_until(b'\n', &mut chunk).is_ok_and(|n| n > 0) {
                    session
                        .lock()
                        .unwrap()
                        .append(&String::from_utf8_lossy(&chunk));
                    chunk.clear();
                }
            });
        }
        let watcher = session.clone();
        thread::spawn(move || {
            let status = child.wait();
            let mut s = watcher.lock().unwrap();
            let hub = s.hub.upgrade();
            s.exited = true;
            s.pid = None;
            if s.status == "stopped" || s.ignore_exit {
                s.ignore_exit = false;
                return;
            }
            let (code, signal) = match &status {
                Ok(status) => (status.code(), exit_signal(status)),
                Err(_) => (None, None),
            };
            let message = format!(
                "Process exited{}{}.",
                code.map(|c| format!(" with code {c}")).unwrap_or_default(),
                signal.map(|s| format!(" ({s})")).unwrap_or_default()
            );
            s.status = if code == Some(0) { "stopped" } else { "error" };
            s.message = Some(message.clone());
            s.reason = (code != Some(0)).then_some("process-exit");
            s.exit_code = code;
            s.append(&format!("[puppyone] {message}\n"));
            drop(s);
            if let Some(hub) = hub {
                hub.publish(&watcher);
            }
        });
        self.wait_for_health(session, &health_url, health.expect_status)?;
        let mut s = session.lock().unwrap();
        let current = self
            .session(&s.key)
            .is_some_and(|current| Arc::ptr_eq(&current, session));
        if s.status != "starting" || s.exited || !current {
            return Err("App preview start was superseded.".into());
        }
        s.status = "running";
        s.message = None;
        s.append(&format!("[puppyone] Ready: {url}\n"));
        drop(s);
        self.publish(session);
        Ok(())
    }
    fn wait_for_health(&self, session: &Shared, url: &url::Url, expect: u16) -> Result<(), String> {
        let started = Instant::now();
        let mut last: Option<String> = None;
        while started.elapsed() < HEALTH_TIMEOUT {
            {
                let s = session.lock().unwrap();
                if s.status != "starting" {
                    return Err(s
                        .message
                        .clone()
                        .unwrap_or_else(|| "App preview stopped before it became ready.".into()));
                }
                if s.pid.is_none() || s.exited {
                    return Err(s.message.clone().unwrap_or_else(|| {
                        "App preview process exited before it became ready.".into()
                    }));
                }
            }
            match health_status(url) {
                Ok(status) if status == expect => return Ok(()),
                Ok(status) => last = Some(format!("Health check returned {status}.")),
                Err(error) => last = Some(error),
            }
            thread::sleep(HEALTH_POLL_INTERVAL);
        }
        Err(match last {
            Some(error) => format!("App preview did not become ready. {error}"),
            None => "App preview did not become ready.".into(),
        })
    }
    /// `stopSession(session, reason)`.
    fn stop_session(&self, session: &Shared, reason: Option<&str>) {
        {
            let mut s = session.lock().unwrap();
            s.status = "stopped";
            s.message = reason.map(|r| format!("Stopped: {r}"));
        }
        terminate(session, reason.unwrap_or("stop"));
        let mut s = session.lock().unwrap();
        if let Some(stop) = s.static_server.take() {
            stop.store(true, Ordering::SeqCst);
        }
        s.exited = true;
        drop(s);
        self.publish(session);
    }
}

#[cfg(unix)]
fn exit_signal(status: &std::process::ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt;
    status.signal().map(|signal| match signal {
        libc::SIGTERM => "SIGTERM".into(),
        libc::SIGKILL => "SIGKILL".into(),
        libc::SIGINT => "SIGINT".into(),
        other => format!("signal {other}"),
    })
}
#[cfg(not(unix))]
fn exit_signal(_: &std::process::ExitStatus) -> Option<String> {
    None
}

/// `terminateSessionChild` / `terminateProcessTree`: TERM the group, then
/// KILL it if it is still there.
fn terminate(session: &Shared, reason: &str) {
    let pid = {
        let mut s = session.lock().unwrap();
        let Some(pid) = s.pid.filter(|_| !s.exited) else {
            return;
        };
        s.ignore_exit = true;
        s.append(&format!("[puppyone] Stopping app preview ({reason}).\n"));
        pid
    };
    #[cfg(unix)]
    {
        let group = -(pid as i32);
        // Only the group isolate() created, never the GUI's own.
        unsafe { libc::kill(group, libc::SIGTERM) };
        if !wait_exit(session, Duration::from_millis(1400)) {
            unsafe { libc::kill(group, libc::SIGKILL) };
            wait_exit(session, Duration::from_millis(500));
        }
    }
    #[cfg(not(unix))]
    let _ = pid;
    let mut s = session.lock().unwrap();
    s.exited = true;
    s.pid = None;
}
fn wait_exit(session: &Shared, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if session.lock().unwrap().pid.is_none() {
            return true;
        }
        thread::sleep(Duration::from_millis(20));
    }
    false
}

fn require_owner(session: &Shared, owner: u64) -> Result<(), String> {
    if session.lock().unwrap().owners.contains(&owner) {
        Ok(())
    } else {
        Err("App preview session belongs to another window.".into())
    }
}

/// `normalizeAppPath(value)`.
pub fn normalize_app_path(value: &str) -> Result<String, String> {
    if value.trim().is_empty() {
        return Err("App path is required.".into());
    }
    let portable = value.trim().replace('\\', "/");
    let drive = portable.len() >= 3
        && portable.as_bytes()[0].is_ascii_alphabetic()
        && &portable[1..3] == ":/";
    if portable.contains('\0') || portable.starts_with('/') || drive {
        return Err("App path must be relative to the workspace.".into());
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in portable.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err("App path must stay inside the workspace.".into());
                }
            }
            part => parts.push(part),
        }
    }
    let normalized = parts.join("/");
    if !normalized.to_lowercase().ends_with(APP_PREVIEW_EXTENSION) {
        return Err("App Preview files must use the .puppyoneapp extension.".into());
    }
    Ok(normalized)
}
fn relative_dir(path: &str) -> String {
    match path.rfind('/') {
        Some(index) => path[..index].to_owned(),
        None => String::new(),
    }
}
/// `joinManifestRelativePath(base, relative)`.
fn join_relative(base: &str, relative: &str) -> String {
    let joined = if base.is_empty() {
        relative.to_owned()
    } else {
        format!("{base}/{relative}")
    };
    manifest::portable_relative_path(Some(&serde_json::Value::String(joined)), "path")
        .map(|p| if p == "." { String::new() } else { p })
        .unwrap_or_default()
}

/// `loadAppPreviewContext(request)`.
fn load_context(root: &Path, app_path: &str) -> Result<Context, String> {
    let root = root
        .canonicalize()
        .map_err(|_| "Workspace root path is required.".to_owned())?;
    let content = std::fs::read_to_string(root.join(app_path)).map_err(|e| e.to_string())?;
    let manifest = manifest::parse(&content, app_path).map_err(|e| e.message)?;
    let Some(launch) = &manifest.launch else {
        return Err("This App is not configured yet.".into());
    };
    let app_dir = relative_dir(app_path);
    let cwd_relative = match launch {
        Launch::LocalServer { cwd, .. } => join_relative(&app_dir, cwd),
        _ => app_dir.clone(),
    };
    let cwd_path = match launch {
        Launch::ExistingUrl { .. } => None,
        _ => Some(canonical_inside(
            &root,
            &root.join(&cwd_relative),
            "App preview cwd",
            true,
        )?),
    };
    let static_file = match launch {
        Launch::StaticFile { path } => Some(canonical_inside(
            &root,
            &root.join(join_relative(&app_dir, path)),
            "App preview HTML file",
            false,
        )?),
        _ => None,
    };
    let manifest_hash = trust_fingerprint(&root, app_path, &content, &manifest, &cwd_relative);
    Ok(Context {
        app_id: manifest
            .id
            .clone()
            .unwrap_or_else(|| format!("{}:{app_path}", root.display())),
        root,
        app_path: app_path.to_owned(),
        manifest,
        manifest_hash,
        cwd_path,
        cwd_relative,
        static_file,
    })
}
/// `resolveCanonicalWorkspaceDirectory` / `resolveCanonicalWorkspaceFile`.
fn canonical_inside(
    root: &Path,
    path: &Path,
    label: &str,
    directory: bool,
) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("{label} could not be found. {error}"))?;
    if !canonical.starts_with(root) {
        return Err(format!("{label} must stay inside the assigned workspace."));
    }
    if directory && !canonical.is_dir() {
        return Err(format!("{label} must point to a folder."));
    }
    if !directory && !canonical.is_file() {
        return Err(format!("{label} must point to a file."));
    }
    Ok(canonical)
}

/// `createTrustFingerprint(...)`: the manifest and, for a package script,
/// the script it runs.
fn trust_fingerprint(
    root: &Path,
    app_path: &str,
    content: &str,
    manifest: &Manifest,
    cwd_relative: &str,
) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    hash.update(b"puppyone-app-preview-trust-v2\0");
    hash.update(app_path.as_bytes());
    hash.update(b"\0manifest\0");
    hash.update(content.as_bytes());
    let Some(Launch::LocalServer { command, .. }) = &manifest.launch else {
        return hex(&hash.finalize());
    };
    let Some(script) = package_script(command) else {
        return hex(&hash.finalize());
    };
    let package = join_relative(cwd_relative, "package.json");
    let resolved = match std::fs::read_to_string(root.join(&package))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
    {
        Some(value) => value["scripts"][&script]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| "<script unavailable>".into()),
        None => "<package.json unavailable>".into(),
    };
    hash.update(b"\0package-script\0");
    hash.update(script.as_bytes());
    hash.update(b"\0");
    hash.update(resolved.as_bytes());
    hex(&hash.finalize())
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
/// `getPackageScriptName(command)`.
pub fn package_script(command: &[String]) -> Option<String> {
    if command.len() < 2 {
        return None;
    }
    let executable = Path::new(&command[0])
        .file_name()?
        .to_string_lossy()
        .to_lowercase();
    let executable = executable.strip_suffix(".cmd").unwrap_or(&executable);
    if !matches!(executable, "npm" | "pnpm" | "yarn" | "bun") {
        return None;
    }
    let index = if command[1] == "run" { 2 } else { 1 };
    command
        .get(index)
        .filter(|c| !c.is_empty() && !c.starts_with('-'))
        .cloned()
}
/// `formatCommand(command)`.
pub fn format_command(command: &[String]) -> String {
    command
        .iter()
        .map(|part| {
            if part.chars().any(char::is_whitespace) {
                serde_json::to_string(part).unwrap_or_default()
            } else {
                part.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
/// The executable, found where the person's shell would find it.
fn resolve_program(name: &str) -> PathBuf {
    if name.contains('/') {
        return PathBuf::from(name);
    }
    crate::platform::environment::search_dirs()
        .into_iter()
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| PathBuf::from(name))
}

/// `allocatePort()`.
fn allocate_port() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|_| "Unable to allocate a local preview port.".into())
}
/// `buildLocalUrl(template, port)`.
pub fn build_local_url(template: &str, port: u16) -> Result<String, String> {
    let raw = manifest::interpolate(template, port, "App preview URL").map_err(|e| e.message)?;
    let url = url::Url::parse(&raw).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("App preview URL must use http or https.".into());
    }
    if !matches!(url.host_str(), Some("127.0.0.1" | "localhost")) {
        return Err("App preview URL must bind to localhost.".into());
    }
    if url.port_or_known_default() != Some(port)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(
            "App preview URL must use the allocated localhost port without credentials.".into(),
        );
    }
    Ok(url.to_string())
}
/// `buildHealthUrl(appUrl, health)`.
fn build_health_url(app_url: &str, path: &str) -> Result<url::Url, String> {
    let base = url::Url::parse(app_url).map_err(|e| e.to_string())?;
    let url = base.join(path).map_err(|e| e.to_string())?;
    if url.origin() != base.origin() {
        return Err("App preview health URL must use the app preview origin.".into());
    }
    Ok(url)
}
/// One health request's status (`redirect: "manual"`). HTTPS servers are
/// ready once they accept a connection.
fn health_status(url: &url::Url) -> Result<u16, String> {
    let host = url.host_str().ok_or("Health URL has no host.")?;
    let port = url
        .port_or_known_default()
        .ok_or("Health URL has no port.")?;
    let address = std::net::ToSocketAddrs::to_socket_addrs(&(host, port))
        .map_err(|e| e.to_string())?
        .next()
        .ok_or("Health URL does not resolve.")?;
    let mut stream =
        TcpStream::connect_timeout(&address, HEALTH_REQUEST_TIMEOUT).map_err(|e| e.to_string())?;
    if url.scheme() == "https" {
        return Ok(200);
    }
    stream
        .set_read_timeout(Some(HEALTH_REQUEST_TIMEOUT))
        .map_err(|e| e.to_string())?;
    let target = match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None => url.path().to_owned(),
    };
    write!(
        stream,
        "GET {target} HTTP/1.1\r\nHost: {host}:{port}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
    )
    .map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(stream)
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    line.split_whitespace()
        .nth(1)
        .and_then(|status| status.parse().ok())
        .ok_or_else(|| "Health check returned an invalid response.".into())
}
/// `classifyRuntimeFailure(message)`.
pub fn classify_failure(message: &str) -> &'static str {
    let normalized = message.to_lowercase();
    if normalized.contains("cancel") {
        "cancelled"
    } else if normalized.contains("health") || normalized.contains("become ready") {
        "health-timeout"
    } else if normalized.contains("exited") || normalized.contains("process") {
        "process-exit"
    } else if normalized.contains("could not be found")
        || normalized.contains("must point")
        || normalized.contains("package")
    {
        "preflight"
    } else {
        "unknown"
    }
}

/// `startStaticFileServer(session)`: the file's folder on a loopback port;
/// the root path answers with the file itself.
fn serve_static(entry: &Path) -> Result<(u16, Arc<AtomicBool>), String> {
    let root = entry
        .parent()
        .ok_or("App preview HTML file could not be found.")?
        .to_path_buf();
    let name = entry
        .file_name()
        .ok_or("App preview HTML file could not be found.")?
        .to_string_lossy()
        .into_owned();
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|_| "Unable to start the local HTML preview server.".to_owned())?;
    let port = listener
        .local_addr()
        .map_err(|_| "Unable to start the local HTML preview server.".to_owned())?
        .port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    thread::spawn(move || {
        while !stopped.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let (root, name) = (root.clone(), name.clone());
                    thread::spawn(move || serve_static_request(stream, &root, &name));
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(30));
                }
                Err(_) => break,
            }
        }
    });
    Ok((port, stop))
}
fn serve_static_request(mut stream: TcpStream, root: &Path, entry: &str) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut line = String::new();
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(stream) => stream,
        Err(_) => return,
    });
    if reader.read_line(&mut line).is_err() {
        return;
    }
    // Drain the headers.
    let mut header = String::new();
    while reader.read_line(&mut header).is_ok_and(|n| n > 2) {
        header.clear();
    }
    let target = line.split_whitespace().nth(1).unwrap_or("/");
    let path = target.split(['?', '#']).next().unwrap_or("/");
    let requested = if path == "/" {
        entry.to_owned()
    } else {
        percent_decode(&path[1..])
    };
    let file = root
        .join(requested)
        .canonicalize()
        .ok()
        .filter(|p| p.starts_with(root) && p.is_file());
    let (status, mime, body) = match file.and_then(|p| std::fs::read(&p).ok().map(|b| (p, b))) {
        Some((path, body)) => ("200 OK", static_mime(&path), body),
        None => (
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"Not found".to_vec(),
        ),
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(&body);
}
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && let Some(byte) = std::str::from_utf8(bytes.get(i + 1..i + 3).unwrap_or_default())
                .ok()
                .and_then(|hex| u8::from_str_radix(hex, 16).ok())
        {
            out.push(byte);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
/// `getStaticMimeType(filePath)`.
fn static_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .as_deref()
    {
        Some("css") => "text/css; charset=utf-8",
        Some("gif") => "image/gif",
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("ico") => "image/x-icon",
        Some("jpeg" | "jpg") => "image/jpeg",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("json" | "map") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("mp4") => "video/mp4",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("wasm") => "application/wasm",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn get(url: &str) -> (u16, String) {
        let url = url::Url::parse(url).unwrap();
        let mut stream =
            TcpStream::connect((url.host_str().unwrap(), url.port().unwrap())).unwrap();
        write!(
            stream,
            "GET {} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
            url.path()
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        let status = response.split_whitespace().nth(1).unwrap().parse().unwrap();
        (status, response)
    }

    #[test]
    fn static_files_and_local_servers_run_once_trusted() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("site/assets")).unwrap();
        std::fs::write(root.join("site/index.html"), "<h1>Hello</h1>").unwrap();
        std::fs::write(root.join("site/assets/app.js"), "console.log(1)").unwrap();
        std::fs::write(
            root.join("site.puppyoneapp"),
            r#"{"type":"puppyone.app","version":1,"name":"Site","launch":{"kind":"static-file","path":"site/index.html"}}"#,
        )
        .unwrap();
        let data = tempfile::tempdir().unwrap();
        let runtime = Runtime::new(data.path().to_path_buf());
        let updates = runtime.subscribe();
        let never: Confirm = Box::new(|_| panic!("a static file needs no confirmation"));
        let started = runtime.start(1, &root, "site.puppyoneapp", &never).unwrap();
        assert_eq!(started.status, "running");
        let url = started.url.clone().unwrap();
        assert!(get(&url).1.ends_with("<h1>Hello</h1>"));
        assert_eq!(get(&format!("{url}assets/app.js")).0, 200);
        assert_eq!(get(&format!("{url}..%2F..%2Fetc%2Fpasswd")).0, 404);
        assert!(updates.try_recv().is_ok());
        // Another surface showing the same app joins the running session.
        assert_eq!(
            runtime
                .start(2, &root, "site.puppyoneapp", &never)
                .unwrap()
                .runtime_id,
            started.runtime_id
        );
        assert!(runtime.logs(3, &root, "site.puppyoneapp").is_err());
        runtime.release_owner(1);
        runtime.release_owner(2);
        assert_eq!(runtime.logs(1, &root, "site.puppyoneapp").unwrap(), "");

        // A local server asks once per manifest and runs in its own group.
        std::fs::write(
            root.join("server.puppyoneapp"),
            r#"{"type":"puppyone.app","version":1,"launch":{"kind":"local-server",
                "command":["python3","-m","http.server","${port}","--bind","127.0.0.1"],"cwd":"site",
                "url":"http://127.0.0.1:${port}/"}}"#,
        )
        .unwrap();
        let asked = Arc::new(AtomicU64::new(0));
        let count = asked.clone();
        let decline: Confirm = Box::new(|_| false);
        let error = runtime
            .start(1, &root, "server.puppyoneapp", &decline)
            .unwrap_err();
        assert_eq!(classify_failure(&error), "cancelled");
        let accept: Confirm = Box::new(move |prompt| {
            assert_eq!(prompt.directory, "site");
            count.fetch_add(1, Ordering::SeqCst);
            true
        });
        let running = runtime
            .start(1, &root, "server.puppyoneapp", &accept)
            .unwrap();
        assert_eq!(running.status, "running", "{}", running.logs);
        assert!(
            get(running.url.as_deref().unwrap())
                .1
                .ends_with("<h1>Hello</h1>")
        );
        assert_eq!(running.cwd.as_deref(), Some("site"));
        let stopped = runtime.stop(1, &root, "server.puppyoneapp").unwrap();
        assert_eq!(stopped.status, "stopped");
        assert!(
            stopped
                .logs
                .contains("[puppyone] Stopping app preview (stop).")
        );
        // Trusted once: a restart does not ask again.
        runtime
            .restart(1, &root, "server.puppyoneapp", &accept)
            .unwrap();
        assert_eq!(asked.load(Ordering::SeqCst), 1);
        runtime.close_all();

        std::fs::write(
            root.join("todo.puppyoneapp"),
            r#"{"type":"puppyone.app","version":1}"#,
        )
        .unwrap();
        assert_eq!(
            runtime
                .start(1, &root, "todo.puppyoneapp", &never)
                .unwrap_err(),
            "This App is not configured yet."
        );
        assert!(normalize_app_path("../x.puppyoneapp").is_err());
        assert!(normalize_app_path("a/x.json").is_err());
        assert_eq!(
            build_local_url("http://localhost:${port}/app", 4100).unwrap(),
            "http://localhost:4100/app"
        );
        assert!(build_local_url("http://example.com:${port}/", 4100).is_err());
        assert_eq!(
            package_script(&["pnpm".into(), "run".into(), "dev".into()]).as_deref(),
            Some("dev")
        );
    }
}
