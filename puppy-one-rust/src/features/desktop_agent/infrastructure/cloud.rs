//! The hosted Agent as an `agent-chat` runtime (`CloudAgentController`,
//! `CloudAgentWorkbench`'s history and `cloudAgentProjection`).
//!
//! - One controller per tab owns its receipts and run copies; the Hub of a
//!   target shares the known Agents, the history catalog (one request per
//!   Agent, concurrent refreshes joined) and which sessions are open.
//! - Opening a tab, a new chat or typing sends nothing; the first send goes
//!   through durable admission with a persisted request UUID. A lost
//!   receipt is queried before the same UUID is submitted again; only a
//!   definite 4xx forgets it.
//! - Event reads are bounded batches resumed by sequence; EOF is never
//!   completion; `reset` replaces the copy. Dropping a tab cancels its
//!   observation only — it never sends Stop. Stop and approvals are commands
//!   against the exact run.
//! - A run whose publication is `committed` invalidates the Cloud content
//!   once (`onPublication`); chat text is never parsed for success.
use crate::{
    agent::{
        domain::agent_session_model::{
            Decision, HistoryEntry, Interaction, InteractionKind, Resolution, SessionSnapshot,
            State, parse_rfc3339_ms,
        },
        runtime::agent_runtime_port::AgentRuntimePort,
    },
    cloud_auth::Cancellation,
    wake::Wake,
    workspace::cloud::agent::{Client, Run, Session, Submission, Tool},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

/// `CLOUD_AGENT_LABEL`: the hosted runtime's name and assistant role.
pub const LABEL: &str = "Puppyone Agent";
pub const INSTALLATION_ID: &str = "puppyone-cloud-agent";

/// Where a target's receipts and known Agents persist.
pub fn storage_dir() -> PathBuf {
    if cfg!(test) {
        std::env::temp_dir().join(format!("puppyone-cloud-agent-tests-{}", std::process::id()))
    } else {
        crate::platform::data_dir().join("cloud-agent")
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Saved {
    session_id: Option<String>,
    agent_id: Option<String>,
    pending: Option<Submission>,
}

#[derive(Default)]
struct History {
    sessions: Vec<Session>,
    loading: bool,
    error: Option<String>,
    revision: u64,
}

/// One target's shared state (`CloudAgentWorkbench` minus its layout).
pub struct Hub {
    client: Client,
    dir: PathBuf,
    storage: String,
    agents: Mutex<BTreeSet<String>>,
    open: Mutex<HashMap<u64, String>>,
    history: Mutex<History>,
    wakes: Mutex<HashMap<u64, Wake>>,
    next_actor: AtomicU64,
    on_publication: Box<dyn Fn() + Send + Sync>,
}
impl Hub {
    /// `storage` namespaces persistence (API, account, Project, root).
    pub fn new(
        client: Client,
        storage: String,
        dir: PathBuf,
        on_publication: Box<dyn Fn() + Send + Sync>,
    ) -> Arc<Self> {
        let agents: BTreeSet<String> = read_json(&agents_path(&dir, &storage)).unwrap_or_default();
        Arc::new(Self {
            client,
            dir,
            storage,
            agents: Mutex::new(agents),
            open: Mutex::default(),
            history: Mutex::default(),
            wakes: Mutex::default(),
            next_actor: AtomicU64::new(1),
            on_publication,
        })
    }
    fn notify_all(&self) {
        for wake in self.wakes.lock().unwrap().values() {
            wake.notify();
        }
    }
    fn remember_agent(&self, agent: &str) {
        let mut agents = self.agents.lock().unwrap();
        if agents.insert(agent.to_owned()) {
            write_json(&agents_path(&self.dir, &self.storage), &*agents);
        }
    }
    /// `refreshHistory`: one request per distinct Agent, shared by every tab;
    /// a refresh in flight is joined. Never reads transcripts.
    pub fn refresh_history(self: &Arc<Self>) {
        {
            let mut history = self.history.lock().unwrap();
            if history.loading {
                return;
            }
            history.loading = true;
            history.error = None;
            history.revision += 1;
        }
        self.notify_all();
        let hub = self.clone();
        std::thread::spawn(move || {
            let agents: Vec<String> = hub.agents.lock().unwrap().iter().cloned().collect();
            let mut rows: HashMap<String, Session> = HashMap::new();
            let mut error = None;
            for agent in agents {
                match hub.client.sessions(&agent) {
                    Ok(list) => rows.extend(list.into_iter().map(|s| (s.id.clone(), s))),
                    Err(e) => error = Some(e.message),
                }
            }
            let mut sessions: Vec<Session> = rows.into_values().collect();
            sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            {
                let mut history = hub.history.lock().unwrap();
                if error.is_none() {
                    history.sessions = sessions;
                }
                history.error = error;
                history.loading = false;
                history.revision += 1;
            }
            hub.notify_all();
        });
    }
    /// The open conversation of every other tab.
    fn open_elsewhere(&self, actor: u64) -> HashSet<String> {
        self.open
            .lock()
            .unwrap()
            .iter()
            .filter(|(a, _)| **a != actor)
            .map(|(_, s)| s.clone())
            .collect()
    }
}
fn agents_path(dir: &std::path::Path, storage: &str) -> PathBuf {
    dir.join(format!(
        "{}-agents.json",
        blake3::hash(storage.as_bytes()).to_hex()
    ))
}
fn read_json<T: serde::de::DeserializeOwned>(path: &std::path::Path) -> Option<T> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}
/// Unavailable storage never blocks chat; the memory copy stays usable.
fn write_json<T: Serialize>(path: &std::path::Path, value: &T) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec(value) {
        let tmp = path.with_extension("tmp");
        if std::fs::write(&tmp, bytes).is_ok() {
            let _ = std::fs::rename(&tmp, path);
        }
    }
}

#[derive(Default)]
struct CoreState {
    saved: Saved,
    runs: Vec<Run>,
    loading: bool,
    submitting: bool,
    /// `send` handed a prompt over; `submit` has not taken it yet.
    sending: bool,
    /// The tab shows the history list (`historyOpen`).
    browsing: bool,
    resolving: Option<String>,
    error: Option<String>,
    reconnecting: bool,
    /// Selection epoch: a new chat or session drops late results.
    revision: u64,
    published: HashSet<String>,
    decisions: HashMap<String, (String, bool)>,
    changed: u64,
}
/// One tab's controller, shared with its command and observation threads.
struct Core {
    hub: Arc<Hub>,
    actor: u64,
    path: PathBuf,
    state: Mutex<CoreState>,
    wake: Wake,
    cancel: Cancellation,
}
impl Core {
    fn patch(&self, f: impl FnOnce(&mut CoreState)) {
        {
            let mut state = self.state.lock().unwrap();
            f(&mut state);
            state.changed += 1;
        }
        self.wake.notify();
    }
    fn save(&self) {
        let saved = self.state.lock().unwrap().saved.clone();
        if let Some(session) = &saved.session_id {
            self.hub
                .open
                .lock()
                .unwrap()
                .insert(self.actor, session.clone());
        } else {
            self.hub.open.lock().unwrap().remove(&self.actor);
        }
        write_json(&self.path, &saved);
    }
    fn revision(&self) -> u64 {
        self.state.lock().unwrap().revision
    }
    fn alive(&self) -> bool {
        self.cancel.check().is_ok()
    }
    /// Sleeps in slices, returning `false` once observation ended.
    fn pause(&self, ms: u64) -> bool {
        let mut left = ms;
        while left > 0 {
            if !self.alive() {
                return false;
            }
            let step = left.min(50);
            std::thread::sleep(Duration::from_millis(step));
            left -= step;
        }
        self.alive()
    }
    /// A newer copy of a run; receipts without tools keep the known ones.
    fn accept(state: &mut CoreState, run: Run) {
        let old = state.runs.iter().find(|r| r.id == run.id);
        if old.is_some_and(|old| old.sequence > run.sequence) {
            return;
        }
        let tools = run
            .tools
            .clone()
            .or_else(|| old.and_then(|o| o.tools.clone()))
            .unwrap_or_default();
        state.runs.retain(|r| r.id != run.id);
        state.runs.push(Run {
            tools: Some(tools),
            ..run
        });
        state.runs.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    }
    fn confirm(&self, run: Run, revision: u64) -> bool {
        let agent = run.agent_id.clone();
        let mut confirmed = false;
        self.patch(|s| {
            if s.revision != revision {
                return;
            }
            s.saved.session_id = Some(run.session_id.clone());
            s.saved.agent_id = Some(run.agent_id.clone());
            s.saved.pending = None;
            s.error = None;
            Self::accept(s, run);
            confirmed = true;
        });
        if confirmed {
            self.hub.remember_agent(&agent);
            self.save();
        }
        confirmed
    }
    /// `load`: the pending receipt, the session's runs, its latest snapshot.
    fn load(self: &Arc<Self>) {
        let revision = self.revision();
        self.patch(|s| {
            s.loading = true;
            s.error = None;
        });
        let result = (|| -> Result<(), crate::workspace::cloud::agent::Error> {
            let pending = self.state.lock().unwrap().saved.pending.clone();
            if let Some(pending) = pending {
                match self.hub.client.receipt(&pending.request_id) {
                    Ok(run) => {
                        self.confirm(run, revision);
                    }
                    Err(e) if e.status == Some(404) => {}
                    Err(e) => return Err(e),
                }
            }
            let session = self.state.lock().unwrap().saved.session_id.clone();
            if let Some(session) = session {
                let runs = self.hub.client.runs(&session)?;
                if self.revision() != revision {
                    return Ok(());
                }
                let last = runs.last().map(|r| r.id.clone());
                self.patch(|s| {
                    for run in runs {
                        Self::accept(s, run);
                    }
                });
                if let Some(last) = last {
                    let next = self.hub.client.snapshot(&last)?;
                    self.patch(|s| {
                        if s.revision == revision {
                            Self::accept(s, next);
                        }
                    });
                }
            }
            Ok(())
        })();
        self.patch(|s| {
            if s.revision == revision {
                if let Err(e) = result {
                    s.error = Some(e.message);
                }
                s.loading = false;
            }
        });
    }
    fn busy(s: &CoreState) -> bool {
        s.submitting || s.loading || s.runs.last().is_some_and(Run::active)
    }
    fn submit(self: &Arc<Self>, prompt: String) {
        // A send while the tab is still loading waits for it (the composer
        // has already handed over its text).
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        while self.state.lock().unwrap().loading && std::time::Instant::now() < deadline {
            if !self.pause(20) {
                break;
            }
        }
        let (input, pending, revision) = {
            let mut s = self.state.lock().unwrap();
            s.sending = false;
            s.changed += 1;
            if Self::busy(&s) || prompt.trim().is_empty() {
                drop(s);
                self.wake.notify();
                return;
            }
            // A lost receipt keeps its original body and UUID.
            let pending = s.saved.pending.clone();
            if let Some(p) = &pending
                && p.prompt != prompt
            {
                s.error = Some("Confirm the previous message before sending another.".into());
                s.changed += 1;
                drop(s);
                self.wake.notify();
                return;
            }
            let input = pending.clone().unwrap_or_else(|| Submission {
                request_id: uuid::Uuid::new_v4().to_string(),
                prompt: prompt.clone(),
                session_id: s.saved.session_id.clone(),
                agent_id: s.saved.agent_id.clone(),
            });
            s.saved.pending = Some(input.clone());
            s.submitting = true;
            s.error = None;
            s.changed += 1;
            (input, pending, s.revision)
        };
        self.save();
        self.wake.notify();
        let result = if pending.is_some() {
            match self.hub.client.receipt(&input.request_id) {
                Err(e) if e.status == Some(404) => self.hub.client.submit(&input),
                other => other,
            }
        } else {
            self.hub.client.submit(&input)
        };
        match result {
            Ok(run) => {
                self.confirm(run, revision);
            }
            Err(error) => {
                // A definite refusal is unaccepted; transport loss stays
                // pending for receipt recovery.
                self.patch(|s| {
                    if s.revision == revision {
                        if error.refused() {
                            s.saved.pending = None;
                        }
                        s.error = Some(error.message.clone());
                    }
                });
                self.save();
            }
        }
        self.patch(|s| {
            if s.revision == revision {
                s.submitting = false;
            }
        });
    }
    fn command(
        self: &Arc<Self>,
        id: String,
        action: impl FnOnce(&Client) -> crate::workspace::cloud::agent::Result<Run>,
    ) {
        let revision = self.revision();
        self.patch(|s| {
            s.resolving = Some(id);
            s.error = None;
        });
        let result = action(&self.hub.client).and_then(|run| self.hub.client.snapshot(&run.id));
        self.patch(|s| {
            if s.revision == revision {
                match result {
                    Ok(run) => Self::accept(s, run),
                    Err(e) => s.error = Some(e.message),
                }
                s.resolving = None;
            }
        });
    }
    fn stop(self: &Arc<Self>) {
        let run = {
            let s = self.state.lock().unwrap();
            match s.runs.last() {
                Some(run) if run.active() && !run.stop_requested && s.resolving.is_none() => {
                    run.id.clone()
                }
                _ => return,
            }
        };
        self.command("stop".into(), |client| client.stop(&run));
    }
    /// The same decision UUID for a retried answer; a different answer to
    /// the same call is refused.
    fn approve(self: &Arc<Self>, call: String, allow: bool) {
        let (run, decision) = {
            let mut s = self.state.lock().unwrap();
            let Some(run) = s.runs.last().map(|r| r.id.clone()) else {
                return;
            };
            if s.resolving.is_some() {
                return;
            }
            let key = format!("{run}:{call}");
            let decision = match s.decisions.get(&key) {
                Some((_, previous)) if *previous != allow => return,
                Some((id, _)) => id.clone(),
                None => uuid::Uuid::new_v4().to_string(),
            };
            s.decisions.insert(key, (decision.clone(), allow));
            (run, decision)
        };
        let id = call.clone();
        self.command(id, |client| client.approve(&run, &call, &decision, allow));
    }
    fn select(self: &Arc<Self>, session: Option<Session>) {
        {
            let mut s = self.state.lock().unwrap();
            if s.submitting || s.saved.pending.is_some() || s.runs.last().is_some_and(Run::active) {
                return;
            }
            s.revision += 1;
            s.saved.session_id = session.as_ref().map(|s| s.id.clone());
            if let Some(session) = &session {
                s.saved.agent_id = Some(session.agent_id.clone());
            }
            s.runs.clear();
            s.error = None;
            s.loading = false;
            s.changed += 1;
        }
        self.save();
        self.wake.notify();
        if session.is_some() {
            self.load();
        }
    }
    fn notify_publications(&self) {
        let fresh = {
            let mut s = self.state.lock().unwrap();
            let ids: Vec<String> = s
                .runs
                .iter()
                .filter(|r| r.committed())
                .map(|r| r.id.clone())
                .collect();
            ids.into_iter()
                .filter(|id| s.published.insert(id.clone()))
                .count()
        };
        for _ in 0..fresh {
            (self.hub.on_publication)();
        }
    }
    /// `observe`: bounded batches by sequence; EOF still asks for the
    /// server's fact; 401/403/404 end observation.
    fn observe(self: &Arc<Self>) {
        self.load();
        while self.alive() {
            let revision = self.revision();
            let run = self.state.lock().unwrap().runs.last().cloned();
            self.notify_publications();
            let Some(run) = run.filter(Run::active) else {
                if !self.pause(500) {
                    break;
                }
                continue;
            };
            let step =
                (|| -> crate::workspace::cloud::agent::Result<bool> {
                    let events = self
                        .hub
                        .client
                        .events(&run.id, run.sequence, &self.cancel)?;
                    if !self.alive() || self.revision() != revision {
                        return Ok(false);
                    }
                    let next =
                        match events.iter().rev().find(|e| e.event == "reset") {
                            Some(reset) => serde_json::from_value::<Run>(reset.data.clone())
                                .map_err(|_| crate::workspace::cloud::agent::Error {
                                    status: None,
                                    unknown: false,
                                    message: "Cloud Agent returned an invalid reset.".into(),
                                })?,
                            None => self.hub.client.snapshot(&run.id)?,
                        };
                    if next.id != run.id || next.project_id != self.hub.client.project {
                        return Err(crate::workspace::cloud::agent::Error {
                            status: None,
                            unknown: false,
                            message: "Cloud Agent event target changed.".into(),
                        });
                    }
                    self.patch(|s| {
                        if s.revision == revision {
                            Self::accept(s, next);
                            s.reconnecting = false;
                        }
                    });
                    self.notify_publications();
                    Ok(events.is_empty())
                })();
            match step {
                Ok(idle) => {
                    if idle && !self.pause(200) {
                        break;
                    }
                }
                Err(error) => {
                    if !self.alive() {
                        break;
                    }
                    if error.terminal() {
                        self.patch(|s| {
                            s.error = Some(error.message.clone());
                            s.reconnecting = false;
                        });
                        break;
                    }
                    self.patch(|s| s.reconnecting = true);
                    if !self.pause(1500) {
                        break;
                    }
                }
            }
        }
    }
}

/// A tab's runtime: the shared Agent UI reads its snapshot.
pub struct CloudAgentRuntime {
    core: Arc<Core>,
    snapshot: SessionSnapshot,
    seen: (u64, u64),
}
impl CloudAgentRuntime {
    /// `key` names this tab's persisted receipts within the target;
    /// `history` opens the tab on its history list.
    pub fn new(hub: Arc<Hub>, key: &str, history: bool, wake: Wake) -> Self {
        let actor = hub.next_actor.fetch_add(1, Ordering::SeqCst);
        let path = hub.dir.join(format!(
            "{}.json",
            blake3::hash(format!("{}\u{0}{key}", hub.storage).as_bytes()).to_hex()
        ));
        let saved: Saved = read_json(&path).unwrap_or_default();
        if let Some(agent) = &saved.agent_id {
            hub.remember_agent(agent);
        }
        hub.wakes.lock().unwrap().insert(actor, wake.clone());
        let core = Arc::new(Core {
            hub,
            actor,
            path,
            state: Mutex::new(CoreState {
                saved,
                loading: true,
                browsing: history,
                ..Default::default()
            }),
            wake,
            cancel: Cancellation::default(),
        });
        core.save();
        let observer = core.clone();
        std::thread::spawn(move || observer.observe());
        if history {
            core.hub.refresh_history();
        }
        let mut runtime = Self {
            core,
            snapshot: SessionSnapshot::new(LABEL, history),
            seen: (u64::MAX, u64::MAX),
        };
        runtime.poll();
        runtime
    }
    fn spawn(&self, f: impl FnOnce(Arc<Core>) + Send + 'static) {
        let core = self.core.clone();
        std::thread::spawn(move || f(core));
    }
}
impl Drop for CloudAgentRuntime {
    /// Closing the view ends its subscription; the run stays the server's.
    fn drop(&mut self) {
        self.core.cancel.cancel();
        self.core.hub.wakes.lock().unwrap().remove(&self.core.actor);
        self.core.hub.open.lock().unwrap().remove(&self.core.actor);
    }
}
impl AgentRuntimePort for CloudAgentRuntime {
    fn snapshot(&self) -> &SessionSnapshot {
        &self.snapshot
    }
    fn poll(&mut self) {
        let history = self.core.hub.history.lock().unwrap().revision;
        let changed = self.core.state.lock().unwrap().changed;
        if self.seen == (changed, history) {
            return;
        }
        self.seen = (changed, history);
        let revision = self.snapshot.revision + 1;
        let open = self.core.hub.open_elsewhere(self.core.actor);
        let hub_history = self.core.hub.history.lock().unwrap();
        let state = self.core.state.lock().unwrap();
        self.snapshot = project(&state, &hub_history, &open);
        self.snapshot.revision = revision;
    }
    fn send(&mut self, text: String) {
        // The session owner reads the state right after handing a prompt
        // over: it must already say so.
        self.core.patch(|s| s.sending = true);
        self.poll();
        self.spawn(move |core| core.submit(text));
    }
    fn stop(&mut self) {
        self.spawn(|core| core.stop());
    }
    fn resume(&mut self, id: String) {
        let known = {
            let history = self.core.hub.history.lock().unwrap();
            history.sessions.iter().find(|s| s.id == id).cloned()
        };
        self.core.patch(|s| s.browsing = false);
        // An open conversation is not opened twice.
        if self.core.hub.open_elsewhere(self.core.actor).contains(&id) {
            self.core
                .patch(|s| s.error = Some("This conversation is already open.".into()));
            return;
        }
        let agent = known
            .as_ref()
            .map(|s| s.agent_id.clone())
            .or_else(|| self.core.state.lock().unwrap().saved.agent_id.clone())
            .unwrap_or_default();
        let session = known.unwrap_or(Session {
            id,
            agent_id: agent,
            title: None,
            mode: "cloud_pi".into(),
            updated_at: String::new(),
        });
        self.spawn(move |core| core.select(Some(session)));
    }
    fn list_history(&mut self) {
        self.core.patch(|s| s.browsing = true);
        self.core.hub.refresh_history();
    }
    fn new_thread(&mut self) {
        self.core.patch(|s| s.browsing = false);
        self.spawn(|core| core.select(None));
    }
    fn resolve(&mut self, id: &serde_json::Value, response: Resolution) {
        let Some(call) = id.as_str().map(str::to_owned) else {
            return;
        };
        let allow = matches!(
            response,
            Resolution::Approval(Decision::Accept | Decision::AcceptForSession)
        );
        self.spawn(move |core| core.approve(call, allow));
    }
    fn select_model(&mut self, _model: Option<String>) {}
    /// `canClose`: an unconfirmed submission keeps its tab.
    fn can_release(&self) -> bool {
        let s = self.core.state.lock().unwrap();
        s.saved.pending.is_none() && !s.submitting
    }
}

/// `cloudAgentProjection`: runs to the shared transcript model.
fn project(state: &CoreState, history: &History, open: &HashSet<String>) -> SessionSnapshot {
    let mut snapshot = SessionSnapshot::new(LABEL, state.browsing);
    snapshot.capabilities.history = true;
    snapshot.thread = state.saved.session_id.clone();
    let current = state.runs.last();
    let active = current.is_some_and(Run::active);
    snapshot.turn = current.filter(|r| r.active()).map(|r| r.id.clone());
    snapshot.state = if active {
        if current.is_some_and(|r| r.stop_requested) {
            State::Stopping
        } else {
            State::Running
        }
    } else if (state.loading && state.runs.is_empty() && state.saved.session_id.is_some())
        || state.submitting
        || state.sending
    {
        State::Starting
    } else if state.browsing {
        State::History
    } else {
        State::Idle
    };
    for run in &state.runs {
        snapshot.upsert(format!("{}:user", run.id), "You", run.prompt.clone(), "");
        for tool in run.tools.iter().flatten() {
            let id = format!("{}:{}", run.id, tool.call_id);
            snapshot.tool_call(
                id.clone(),
                tool.name.clone(),
                tool.input.to_string(),
                tool_status(tool),
            );
            snapshot.tool_result(id, tool.name.clone(), tool_output(tool), tool_status(tool));
            if Some(&run.id) == current.map(|r| &r.id) && run.active() && tool.state == "waiting" {
                snapshot.interactions.push(Interaction {
                    id: serde_json::Value::String(tool.call_id.clone()),
                    thread: run.session_id.clone(),
                    turn: run.id.clone(),
                    kind: InteractionKind::Approval {
                        command: tool.name == "bash",
                        prompt: tool.name.clone(),
                        decisions: vec![Decision::Accept, Decision::Decline],
                        title: tool.name.clone(),
                        command_line: tool
                            .input
                            .get("command")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned),
                        cwd: None,
                        reason: None,
                    },
                });
            }
        }
        if let Some(text) = run.snapshot.text.as_ref().filter(|t| !t.is_empty()) {
            let status = if run.active() {
                "running"
            } else if run.state == "failed" {
                "failed"
            } else if run.state == "stopped" {
                "interrupted"
            } else {
                "completed"
            };
            snapshot.upsert(format!("{}:assistant", run.id), LABEL, text.clone(), status);
        }
    }
    if state.runs.len() == 100 {
        snapshot.truncated_thread = Some(state.saved.session_id.clone());
    }
    snapshot.notice = if state.reconnecting {
        Some(crate::localization::t("agent.connection.reconnecting").into())
    } else if current.is_some_and(|r| r.state == "outcome_unknown") {
        Some(crate::localization::t("agent.status.deliveryUnknown").into())
    } else {
        None
    };
    snapshot.error = state.error.clone().or_else(|| {
        current
            .filter(|r| r.state == "failed" || r.state == "conflict")
            .map(|r| r.snapshot.code.clone().unwrap_or_else(|| r.state.clone()))
    });
    snapshot.history = history
        .sessions
        .iter()
        .filter(|s| !open.contains(&s.id))
        .map(|s| HistoryEntry {
            id: s.id.clone(),
            title: s
                .title
                .clone()
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| LABEL.into()),
            updated_at: parse_rfc3339_ms(&s.updated_at),
        })
        .collect();
    snapshot.history_listed = history.revision;
    snapshot.title = state
        .runs
        .first()
        .map(|r| r.prompt.chars().take(80).collect())
        .unwrap_or_else(|| LABEL.into());
    snapshot
}
/// `toolStatus`.
fn tool_status(tool: &Tool) -> &'static str {
    match tool.state.as_str() {
        "completed" => match &tool.result {
            Some(result) if result.is_error => {
                let code = result
                    .details
                    .as_ref()
                    .and_then(|d| d.get("code"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("");
                if [
                    "tool_permission_denied",
                    "tool_approval_denied",
                    "tool_unavailable",
                ]
                .contains(&code)
                {
                    "blocked"
                } else {
                    "failed"
                }
            }
            _ => "completed",
        },
        "rejected" => "cancelled",
        "waiting" => "waiting-for-user",
        _ => "running",
    }
}
/// `toolOutput`.
fn tool_output(tool: &Tool) -> String {
    let text: Vec<&str> = tool
        .result
        .iter()
        .flat_map(|r| r.content.iter())
        .filter(|part| part.get("type").and_then(|t| t.as_str()) == Some("text"))
        .filter_map(|part| part.get("text").and_then(|t| t.as_str()))
        .collect();
    if text.is_empty() && tool.state == "rejected" {
        return crate::localization::t("native.cloudAgent.declined").into();
    }
    text.join("\n")
}

#[cfg(test)]
mod tests;
