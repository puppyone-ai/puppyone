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
mod projection;

pub use projection::project_cloud_agent_runs;

use crate::{
    cloud_auth::Cancellation,
    wake::Wake,
    workspace::cloud::agent::{Client, Run, Session, Submission},
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

/// `HistoryState`: the target's conversations, newest first.
#[derive(Clone, Debug, Default)]
pub struct CloudHistory {
    pub sessions: Vec<Session>,
    pub loading: bool,
    pub loaded: bool,
    pub error: Option<String>,
    pub revision: u64,
}

/// One target's shared state (`CloudAgentWorkbench` minus its layout).
pub struct Hub {
    client: Client,
    dir: PathBuf,
    storage: String,
    agents: Mutex<BTreeSet<String>>,
    open: Mutex<HashMap<u64, String>>,
    history: Mutex<CloudHistory>,
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
                    history.loaded = true;
                }
                history.error = error;
                history.loading = false;
                history.revision += 1;
            }
            hub.notify_all();
        });
    }
    /// `getHistory()`.
    pub fn history(&self) -> CloudHistory {
        self.history.lock().unwrap().clone()
    }
    /// Follows the shared history (`subscribeHistory`).
    pub fn watch_history(&self, wake: Wake) -> u64 {
        let id = self.next_actor.fetch_add(1, Ordering::SeqCst);
        self.wakes.lock().unwrap().insert(id, wake);
        id
    }
    pub fn unwatch(&self, id: u64) {
        self.wakes.lock().unwrap().remove(&id);
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
    /// The composer's text (`state.draft`).
    draft: String,
    resolving: Option<String>,
    error: Option<String>,
    /// The failed request's HTTP status (`error.status`).
    error_status: Option<u16>,
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
            if s.saved
                .pending
                .as_ref()
                .is_some_and(|p| p.prompt == s.draft)
            {
                s.draft.clear();
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
                    s.error_status = e.status;
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
                s.error_status = None;
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
                        s.error_status = error.status;
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
                    Err(e) => {
                        s.error_status = e.status;
                        s.error = Some(e.message);
                    }
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
                            s.error_status = error.status;
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

/// `CloudAgentState`: what a hosted chat shows.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CloudAgentState {
    pub session_id: Option<String>,
    pub agent_id: Option<String>,
    pub pending: Option<Submission>,
    pub draft: String,
    pub runs: Vec<Run>,
    pub loading: bool,
    pub submitting: bool,
    pub resolving: Option<String>,
    pub error: Option<String>,
    pub error_status: Option<u16>,
    pub reconnecting: bool,
}

impl CloudAgentState {
    /// The latest run, while it is the server's to finish.
    pub fn running(&self) -> bool {
        self.runs.last().is_some_and(Run::active)
    }
}

/// `CloudAgentController`: one tab's conversation. Opening a tab, a new chat
/// or typing sends nothing; dropping it ends its observation only.
pub struct CloudAgentController {
    core: Arc<Core>,
}

impl CloudAgentController {
    /// `key` names this tab's persisted receipts within the target; a
    /// History `session` opens it (`prepare(id, session)`), unless another
    /// tab has it open.
    pub fn new(
        hub: Arc<Hub>,
        key: &str,
        session: Option<Session>,
        wake: Wake,
    ) -> Result<Self, String> {
        let actor = hub.next_actor.fetch_add(1, Ordering::SeqCst);
        if let Some(session) = &session
            && hub.open_elsewhere(actor).contains(&session.id)
        {
            return Err("This conversation is already open.".into());
        }
        let path = hub.dir.join(format!(
            "{}.json",
            blake3::hash(format!("{}\u{0}{key}", hub.storage).as_bytes()).to_hex()
        ));
        let mut saved: Saved = read_json(&path).unwrap_or_default();
        if let Some(session) = &session {
            saved = Saved {
                session_id: Some(session.id.clone()),
                agent_id: Some(session.agent_id.clone()),
                pending: None,
            };
        }
        if let Some(agent) = &saved.agent_id {
            hub.remember_agent(agent);
        }
        hub.wakes.lock().unwrap().insert(actor, wake.clone());
        let draft = saved
            .pending
            .as_ref()
            .map(|p| p.prompt.clone())
            .unwrap_or_default();
        let core = Arc::new(Core {
            hub,
            actor,
            path,
            state: Mutex::new(CoreState {
                saved,
                draft,
                loading: true,
                ..Default::default()
            }),
            wake,
            cancel: Cancellation::default(),
        });
        core.save();
        let observer = core.clone();
        std::thread::spawn(move || observer.observe());
        Ok(Self { core })
    }

    fn spawn(&self, f: impl FnOnce(Arc<Core>) + Send + 'static) {
        let core = self.core.clone();
        std::thread::spawn(move || f(core));
    }

    pub fn hub(&self) -> &Arc<Hub> {
        &self.core.hub
    }

    /// `getSnapshot()`, with a send already handed over counted as one.
    pub fn snapshot(&self) -> CloudAgentState {
        let s = self.core.state.lock().unwrap();
        CloudAgentState {
            session_id: s.saved.session_id.clone(),
            agent_id: s.saved.agent_id.clone(),
            pending: s.saved.pending.clone(),
            draft: s.draft.clone(),
            runs: s.runs.clone(),
            loading: s.loading,
            submitting: s.submitting || s.sending,
            resolving: s.resolving.clone(),
            error: s.error.clone(),
            error_status: s.error_status,
            reconnecting: s.reconnecting,
        }
    }

    /// `setDraft(draft)`.
    pub fn set_draft(&self, draft: String) {
        self.core.patch(|s| s.draft = draft);
    }

    /// `submit(prompt)`.
    pub fn submit(&self, prompt: String) {
        // The view reads the state right after handing a prompt over: it
        // must already say so.
        self.core.patch(|s| s.sending = true);
        self.spawn(move |core| core.submit(prompt));
    }

    pub fn stop(&self) {
        self.spawn(|core| core.stop());
    }

    /// `approve(call, allow)`.
    pub fn approve(&self, call: String, allow: bool) {
        self.spawn(move |core| core.approve(call, allow));
    }

    /// The status's Retry: the unconfirmed submission again, else a reload.
    pub fn retry(&self) {
        let pending = self.core.state.lock().unwrap().saved.pending.clone();
        match pending {
            Some(pending) => self.submit(pending.prompt),
            None => self.spawn(|core| core.load()),
        }
    }

    /// `canClose`: an unconfirmed submission keeps its tab.
    pub fn can_release(&self) -> bool {
        let s = self.core.state.lock().unwrap();
        s.saved.pending.is_none() && !s.submitting && !s.sending
    }
}

impl Drop for CloudAgentController {
    /// Closing the view ends its subscription; the run stays the server's.
    fn drop(&mut self) {
        self.core.cancel.cancel();
        self.core.hub.wakes.lock().unwrap().remove(&self.core.actor);
        self.core.hub.open.lock().unwrap().remove(&self.core.actor);
    }
}

#[cfg(test)]
mod tests;
