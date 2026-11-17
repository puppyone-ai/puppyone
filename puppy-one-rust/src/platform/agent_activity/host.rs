//! The process-wide activity host (`create-agent-activity-host.mjs`,
//! `create-terminal-agent-activity-host.mjs`, `terminal-agent-activity-host.mjs`).
//! A terminal is prepared only while its provider's Hook is enabled (any
//! Hook for a plain shell); the socket starts with the first such terminal.
use super::{
    Phase, PublicEvent,
    adapters::{self, Normalized},
    env, now_millis,
    registration::{Bridge, Enrollment, ProviderStatus, Registration},
    service::{Service, Session},
    transport::{self, Auth, Envelope, Server},
};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
    time::{Duration, Instant},
};

pub type Event = (String, PublicEvent);
pub struct Host {
    registration: Registration,
    runtime_dir: PathBuf,
    auth: Arc<Mutex<Auth>>,
    service: Arc<Mutex<Service>>,
    server: Mutex<Option<Server>>,
    events: async_channel::Receiver<Event>,
}
impl Host {
    /// The product's host: the user's Agent configuration and the product's
    /// data directory. Tests get a private home that has no Hooks.
    pub fn global() -> &'static Host {
        static HOST: OnceLock<Host> = OnceLock::new();
        HOST.get_or_init(|| {
            #[cfg(test)]
            let (home, data) = {
                let base = std::env::temp_dir().join(format!(
                    "puppyone-agent-activity-test-{}",
                    std::process::id()
                ));
                (base.join("home"), base.join("data"))
            };
            #[cfg(not(test))]
            let (home, data) = (
                PathBuf::from(std::env::var_os("HOME").unwrap_or_default()),
                crate::platform::data_dir(),
            );
            let executable = std::env::current_exe().unwrap_or_default();
            Host::new(
                Registration {
                    home,
                    bridge: Bridge {
                        dir: data.join("agent-activity/bridge/current"),
                        executable,
                    },
                },
                data.join("agent-activity/runtime"),
            )
        })
    }
    pub fn new(registration: Registration, runtime_dir: PathBuf) -> Self {
        let (tx, rx) = async_channel::bounded::<Event>(1024);
        let service = Arc::new(Mutex::new(Service::new(Box::new(move |owner, event| {
            // A window that stopped reading cannot hold the ingest thread.
            let _ = tx.try_send((owner.to_owned(), event));
        }))));
        Self {
            registration,
            runtime_dir,
            auth: Arc::default(),
            service,
            server: Mutex::new(None),
            events: rx,
        }
    }
    /// Activity events for every window, each tagged with its owner.
    pub fn events(&self) -> async_channel::Receiver<Event> {
        self.events.clone()
    }
    /// `getEnrollmentSnapshot` (file I/O; call off the UI thread).
    pub fn enrollment(&self) -> Vec<ProviderStatus> {
        self.registration.snapshot()
    }
    /// `setEnrollmentEnabled` (file I/O; call off the UI thread).
    pub fn set_enrollment(&self, provider: &str, enabled: bool) -> Result<Enrollment, String> {
        self.registration.set_enabled(provider, enabled)
    }
    /// `prepareTerminalSession`: the environment that lets the session's
    /// Hooks report to this host, or nothing when no Hook applies. Runs on
    /// the terminal's own thread before the shell starts.
    pub fn prepare_terminal_session(
        &self,
        terminal_session_id: &str,
        provider: &str,
        root: &Path,
        owner: &str,
    ) -> Vec<(&'static str, String)> {
        let shell = provider == "shell";
        let enabled = if shell {
            self.registration.has_any_enabled()
        } else {
            adapters::known(provider) && self.registration.is_enabled(provider)
        };
        if !enabled {
            return vec![];
        }
        let endpoint = match self.start() {
            Ok(endpoint) => endpoint,
            Err(_) => {
                self.close_terminal_session(terminal_session_id);
                return vec![];
            }
        };
        let session_provider = if shell { "*" } else { provider };
        self.service.lock().unwrap().register(
            terminal_session_id,
            Session {
                provider_id: session_provider.into(),
                root: std::path::absolute(root).unwrap_or_else(|_| root.to_path_buf()),
                owner: owner.into(),
            },
        );
        let token = self
            .auth
            .lock()
            .unwrap()
            .issue(terminal_session_id, session_provider);
        let mut environment = vec![
            (env::ENDPOINT, endpoint.to_string_lossy().into_owned()),
            (env::TOKEN, token),
        ];
        if !shell {
            environment.push((env::PROVIDER, provider.into()));
        }
        environment.push((env::TERMINAL_SESSION_ID, terminal_session_id.into()));
        environment
    }
    pub fn close_terminal_session(&self, terminal_session_id: &str) {
        self.auth.lock().unwrap().revoke(terminal_session_id);
        self.service
            .lock()
            .unwrap()
            .close_terminal_session(terminal_session_id);
    }
    /// `subscribe`: the window's open claims. Windows read every event from
    /// the app's start (`agent_presence::init`), so only tests ask.
    #[cfg(test)]
    pub fn snapshot(&self, owner: &str) -> Vec<PublicEvent> {
        self.service.lock().unwrap().snapshot(owner)
    }
    fn start(&self) -> std::io::Result<PathBuf> {
        let mut server = self.server.lock().unwrap();
        if let Some(server) = server.as_ref() {
            return Ok(server.endpoint.clone());
        }
        #[cfg(not(unix))]
        return Err(std::io::ErrorKind::Unsupported.into());
        #[cfg(unix)]
        {
            let auth = self.auth.clone();
            let verify = Arc::new(move |e: &Envelope| {
                auth.lock()
                    .unwrap()
                    .verify(&e.terminal_session_id, &e.provider_id, &e.token)
            });
            let service = Arc::downgrade(&self.service);
            let handle = Arc::new(move |e: Envelope| {
                service.upgrade().is_some_and(|service| handle(&service, e))
            });
            let started = Server::start(transport::endpoint(&self.runtime_dir), verify, handle)?;
            let endpoint = started.endpoint.clone();
            *server = Some(started);
            expire_leases(Arc::downgrade(&self.service));
            Ok(endpoint)
        }
    }
}
/// `handleEnvelope`: the provider's adapter, then the claim service.
fn handle(service: &Mutex<Service>, envelope: Envelope) -> bool {
    let Some(normalized) = adapters::normalize(
        &envelope.provider_id,
        &envelope.payload,
        &envelope.terminal_session_id,
        now_millis(),
    ) else {
        return false;
    };
    let event = match normalized {
        Normalized::SessionEnded { source_session_id } => {
            service
                .lock()
                .unwrap()
                .close_source_session(&envelope.terminal_session_id, source_session_id.as_deref());
            return true;
        }
        Normalized::Event(event) => event,
    };
    let Some(session) = service
        .lock()
        .unwrap()
        .session(&event.terminal_session_id)
        .cloned()
    else {
        return false;
    };
    let targets = if event.phase == Phase::Started {
        Service::resolve_targets(&event, &session)
    } else {
        vec![]
    };
    service.lock().unwrap().ingest(event, targets)
}
/// The two-minute lease, checked every second while the service lives.
fn expire_leases(service: Weak<Mutex<Service>>) {
    let _ = std::thread::Builder::new()
        .name("agent-activity-leases".into())
        .spawn(move || {
            while let Some(service) = service.upgrade() {
                service.lock().unwrap().expire(Instant::now());
                drop(service);
                std::thread::sleep(Duration::from_secs(1));
            }
        });
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::platform::agent_activity::{Access, Operation, hook};
    use core::prelude::v1::test;
    #[test]
    fn an_enabled_hook_reports_a_terminal_agents_file_reads_to_its_window() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        let root = dir.path().join("repo");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/a.rs"), "").unwrap();
        let registration = Registration {
            home: home.clone(),
            bridge: Bridge {
                dir: dir.path().join("bridge"),
                executable: "/bin/true".into(),
            },
        };
        let host = Host::new(registration, dir.path().join("rt"));
        // No Hook enabled: the terminal gets no environment.
        assert!(
            host.prepare_terminal_session("t1", "codex", &root, "window:1")
                .is_empty()
        );
        assert_eq!(host.set_enrollment("codex", true), Ok(Enrollment::Enabled));
        assert!(
            host.prepare_terminal_session("t1", "claude", &root, "window:1")
                .is_empty()
        );
        let shell = host.prepare_terminal_session("t1", "shell", &root, "window:1");
        let lookup = |key: &str| {
            shell
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v.clone())
        };
        assert!(lookup(env::PROVIDER).is_none());
        let args = ["--provider".into(), "codex".into()];
        let input = br#"{"hook_event_name":"PreToolUse","tool_name":"Read","tool_use_id":"c1","tool_input":{"file_path":"src/a.rs"}}"#;
        let cwd = root.to_string_lossy();
        let send = |endpoint: &str, frame: &str| {
            use std::io::Write as _;
            let mut s = std::os::unix::net::UnixStream::connect(endpoint).unwrap();
            s.write_all(frame.as_bytes()).is_ok()
        };
        assert!(hook::forward(&lookup, &args, &input[..], &cwd, send));
        let events = host.events();
        let (owner, event) = events.recv_blocking().unwrap();
        assert_eq!(owner, "window:1");
        assert_eq!(
            (event.phase, event.operation),
            (Phase::Started, Operation::Read)
        );
        assert_eq!(event.targets[0].relative, "src/a.rs");
        assert_eq!(event.targets[0].access, Access::Read);
        assert_eq!(host.snapshot("window:1").len(), 1);
        // A token from another session is refused.
        let forged = |key: &str| {
            if key == env::TOKEN {
                Some("x".repeat(43))
            } else {
                lookup(key)
            }
        };
        let done = br#"{"hook_event_name":"PostToolUse","tool_name":"Read","tool_use_id":"c1","tool_input":{"file_path":"src/a.rs"}}"#;
        assert!(hook::forward(&forged, &args, &done[..], &cwd, send));
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(host.snapshot("window:1").len(), 1);
        assert!(hook::forward(&lookup, &args, &done[..], &cwd, send));
        let (_, finished) = events.recv_blocking().unwrap();
        assert_eq!(finished.phase, Phase::Completed);
        assert_eq!(finished.activity_id, event.activity_id);
        host.close_terminal_session("t1");
        assert!(host.snapshot("window:1").is_empty());
    }
}
