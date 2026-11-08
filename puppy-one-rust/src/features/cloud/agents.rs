//! `useWorkspaceAgents` and the state behind `CloudWorkspaceAgentsDialog`,
//! `CloudWorkspaceAgentInvite`, `CloudWorkspaceAgentRequestCard` and
//! `useAgentRequestAnswer`: who is in a hosted workspace, kept current for
//! a Header that never closes. Only the owner may read the list, so a 403
//! ends the asking for good; a bad network keeps what is known instead of
//! emptying the Header.
use crate::{
    features::{cloud::account, source_control::relative_time},
    localization::{t as tr, tf},
    workspace::cloud::{
        agents::{self, Admission, AgentRequest, Client, Inventory, WorkspaceAgent},
        services::{self, Error},
    },
};
use gpui::*;
use std::{collections::HashSet, sync::Arc, time::Duration};

/// Soon enough after an Agent is allowed, gentle enough for the Header.
const REFRESH: Duration = Duration::from_secs(10);
/// While someone waits on an Agent, a request appears about as it is made.
const WAITING_REFRESH: Duration = Duration::from_secs(3);
/// A sign-in request lasts ten minutes, so an invite unanswered by then is
/// not awaited.
const INVITE_WAIT: Duration = Duration::from_secs(10 * 60);

/// Who opened the Agents dialog: one Agent's mark, the stack of the ones at
/// rest, or the empty seat.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Opener {
    Agent(String),
    More,
    Invite,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CopyStatus {
    #[default]
    Idle,
    Copying,
    Copied,
    Failed,
    NotOwner,
}
struct Scope {
    /// A fixture outlives the account (tests, captures).
    fixture: bool,
    key: String,
    project: String,
    project_name: String,
    /// The API the invite links point under (`linkPreview`).
    api: String,
    client: Client,
}

pub struct CloudAgents {
    scope: Option<Scope>,
    pub agents: Vec<WorkspaceAgent>,
    pub requests: Vec<AgentRequest>,
    /// Only someone the server lets read the list may manage it.
    pub manageable: bool,
    /// The server has said whether this person may manage the Agents.
    pub known: bool,
    denied: bool,
    latest: u64,
    visible: bool,
    dialog_open: bool,
    poll: Option<Task<()>>,
    /// The Agents already here when the last invite was copied.
    invite: Option<HashSet<String>>,
    invite_timer: Option<Task<()>>,
    pub opener: Opener,
    /// The invite's steps show under the seat.
    pub invite_open: bool,
    pub copy: CopyStatus,
    /// The invite last copied, its secret masked past its start.
    pub made: Option<String>,
    /// Requests being answered; each stays, disabled, until the list that
    /// no longer holds it arrives.
    pub deciding: HashSet<String>,
    pub decision_failed: bool,
    /// The tile asking once whether to remove its Agent, and the one being
    /// removed.
    pub confirming: Option<String>,
    pub removing: Option<String>,
    pub change_failed: bool,
}

/// `workspaceAgentStatus`: the server lists recent sessions only, so an
/// empty history means "nothing recent", never "never".
pub fn status(agent: &WorkspaceAgent, now_secs: i64) -> Option<String> {
    if agent.active {
        return Some(tr("cloud.share.agent.status.active").to_string());
    }
    if !agent.activity_known {
        return None;
    }
    Some(match &agent.last_active_at {
        Some(at) => tf(
            "cloud.share.agent.status.lastActive",
            &[(
                "time",
                relative_time(at, now_secs).unwrap_or_default().into(),
            )],
        ),
        None => tr("cloud.share.agent.status.none").to_string(),
    })
}

impl CloudAgents {
    pub fn new() -> Self {
        Self {
            scope: None,
            agents: vec![],
            requests: vec![],
            manageable: false,
            known: false,
            denied: false,
            latest: 0,
            visible: true,
            dialog_open: false,
            poll: None,
            invite: None,
            invite_timer: None,
            opener: Opener::More,
            invite_open: false,
            copy: CopyStatus::Idle,
            made: None,
            deciding: HashSet::new(),
            decision_failed: false,
            confirming: None,
            removing: None,
            change_failed: false,
        }
    }
    /// The hosted Project at its root for the signed-in account
    /// (`agentTarget`); a scope change forgets everything.
    pub fn sync(
        &mut self,
        project: Option<(&str, &str)>,
        dialog_open: bool,
        cx: &mut Context<Self>,
    ) {
        let target = project.and_then(|(project, name)| {
            let (broker, binding) = account::broker_and_binding(cx)?;
            let key = format!(
                "{}\n{}\n{}\n{project}",
                binding.environment.api(),
                binding.user,
                binding.epoch
            );
            Some((key, project, name, broker, binding))
        });
        if self.scope.as_ref().is_some_and(|s| s.fixture) {
            self.set_dialog_open(dialog_open, cx);
            return;
        }
        let key = target.as_ref().map(|t| t.0.clone());
        if key.as_deref() != self.scope.as_ref().map(|s| s.key.as_str()) {
            let scope = target.map(|(key, project, name, broker, binding)| Scope {
                fixture: false,
                key,
                project: project.to_owned(),
                project_name: name.to_owned(),
                api: binding.environment.api().to_string(),
                client: Client::new(Arc::new(services::BrokerTransport {
                    broker,
                    binding,
                    cancel: Default::default(),
                })),
            });
            self.attach(scope, cx);
        } else if let (Some(scope), Some((_, name))) = (&mut self.scope, project) {
            scope.project_name = name.to_owned();
        }
        self.set_dialog_open(dialog_open, cx);
    }
    /// Tests and captures: a Project read through `client`.
    #[cfg(any(test, feature = "dev-capture"))]
    pub fn attach_client(
        &mut self,
        project: &str,
        name: &str,
        client: Client,
        cx: &mut Context<Self>,
    ) {
        self.attach(
            Some(Scope {
                fixture: true,
                key: format!("fixture\n{project}"),
                project: project.into(),
                project_name: name.into(),
                api: "https://api.puppyone.ai/api/v1".into(),
                client,
            }),
            cx,
        );
    }
    fn attach(&mut self, scope: Option<Scope>, cx: &mut Context<Self>) {
        let dialog_open = self.dialog_open;
        let visible = self.visible;
        *self = Self::new();
        self.dialog_open = dialog_open;
        self.visible = visible;
        self.scope = scope;
        if self.scope.is_some() {
            self.refresh(cx);
            self.schedule(cx);
        }
        cx.notify();
    }
    pub fn project_name(&self) -> Option<&str> {
        self.scope.as_ref().map(|s| s.project_name.as_str())
    }
    /// The Agents dialog is open, so a request should appear about as soon
    /// as it is made.
    fn set_dialog_open(&mut self, open: bool, cx: &mut Context<Self>) {
        if self.dialog_open != open {
            let waiting = self.fast();
            self.dialog_open = open;
            // The dialog's own state goes with it.
            if !open {
                self.decision_failed = false;
                self.confirming = None;
                self.change_failed = false;
                self.close_invite(cx);
            }
            if self.fast() != waiting {
                self.refresh(cx);
                self.schedule(cx);
            }
        }
    }
    /// The window was hidden or came back; a returning window catches up.
    pub fn set_visible(&mut self, visible: bool, cx: &mut Context<Self>) {
        if self.visible != visible {
            self.visible = visible;
            if visible {
                self.refresh(cx);
            }
        }
    }
    /// An invite is out and no Agent has answered it yet.
    pub fn waiting(&self) -> bool {
        self.invite.is_some()
    }
    fn fast(&self) -> bool {
        self.dialog_open || self.waiting()
    }
    fn schedule(&mut self, cx: &mut Context<Self>) {
        if self.scope.is_none() {
            self.poll = None;
            return;
        }
        let interval = if self.fast() {
            WAITING_REFRESH
        } else {
            REFRESH
        };
        self.poll = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(interval).await;
                if this
                    .update(cx, |s, cx| {
                        if s.visible {
                            s.refresh(cx);
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        }));
    }
    /// Reads the list and the sessions now, without waiting for the poll.
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        let Some(scope) = &self.scope else {
            return;
        };
        if self.denied {
            return;
        }
        self.latest += 1;
        let request = self.latest;
        let (client, project) = (scope.client.clone(), scope.project.clone());
        let task =
            cx.background_spawn(
                async move { (client.links(&project), client.sessions(&project).ok()) },
            );
        cx.spawn(async move |this, cx| {
            let (inventory, sessions) = task.await;
            let _ = this.update(cx, |s, cx| {
                if request == s.latest {
                    s.receive(inventory, sessions, cx);
                }
            });
        })
        .detach();
    }
    fn receive(
        &mut self,
        inventory: services::Result<Inventory>,
        sessions: Option<Vec<agents::Session>>,
        cx: &mut Context<Self>,
    ) {
        let inventory = match inventory {
            Ok(inventory) => inventory,
            Err(Error::Status(403)) => {
                self.denied = true;
                self.agents.clear();
                self.requests.clear();
                self.manageable = false;
                self.known = true;
                self.poll = None;
                cx.notify();
                return;
            }
            Err(_) => return,
        };
        let present = self.agents.len() + self.requests.len();
        self.manageable = true;
        self.known = true;
        self.requests = inventory.pending;
        self.agents = agents::resolve(
            &inventory.connections,
            sessions.as_deref(),
            crate::clock::now_ms(),
        );
        let pending: HashSet<&str> = self.requests.iter().map(|r| r.id.as_str()).collect();
        self.deciding.retain(|id| pending.contains(id.as_str()));
        // A removed Agent's tile leaves with the list that no longer holds it.
        if self
            .removing
            .as_ref()
            .is_some_and(|id| !self.agents.iter().any(|a| &a.agent.id == id))
        {
            self.removing = None;
            self.confirming = None;
        }
        // The steps give way as soon as an Agent turns up in the row.
        if self.agents.len() + self.requests.len() > present {
            self.close_invite(cx);
        }
        // A newcomer, or one asking to join, ends the wait.
        let answered = self.invite.as_ref().is_some_and(|known| {
            !self.requests.is_empty() || self.agents.iter().any(|a| !known.contains(&a.agent.id))
        });
        if answered {
            self.end_wait(cx);
        }
        cx.notify();
    }
    fn end_wait(&mut self, cx: &mut Context<Self>) {
        let fast = self.fast();
        self.invite = None;
        self.invite_timer = None;
        if self.fast() != fast {
            self.schedule(cx);
        }
    }
    /// A mark, the stack or the seat opens the dialog; with nobody here
    /// yet it opens on how to invite (`openFirst`).
    pub fn open(&mut self, opener: Opener, cx: &mut Context<Self>) {
        self.opener = opener;
        self.confirming = None;
        self.change_failed = false;
        self.decision_failed = false;
        self.invite_open = self.agents.is_empty() && self.requests.is_empty();
        cx.notify();
    }
    /// The seat shows or folds the invite's steps.
    pub fn toggle_invite(&mut self, cx: &mut Context<Self>) {
        if self.invite_open {
            self.close_invite(cx);
        } else {
            self.invite_open = true;
            cx.notify();
        }
    }
    /// Opened again, the steps start over from what to copy.
    pub fn close_invite(&mut self, cx: &mut Context<Self>) {
        self.invite_open = false;
        if self.copy != CopyStatus::Copying {
            self.copy = CopyStatus::Idle;
        }
        self.made = None;
        cx.notify();
    }
    /// The prompt as shown: the link not made yet, then the one made, its
    /// secret masked past its start.
    pub fn prompt(&self) -> Option<String> {
        let scope = self.scope.as_ref()?;
        let link = self
            .made
            .clone()
            .unwrap_or_else(|| format!("{}{}", agents::link_preview(&scope.api), agents::UNMADE));
        Some(agents::connect_message(&scope.project_name, &link))
    }

    /// `copy`: nothing is made until Copy is pressed, and every press makes
    /// a new invite, each letting one Agent in after the owner allows it.
    pub fn copy_invite(&mut self, cx: &mut Context<Self>) {
        let Some(scope) = &self.scope else {
            return;
        };
        if self.copy == CopyStatus::Copying {
            return;
        }
        self.copy = CopyStatus::Copying;
        let admission = Admission::SignIn;
        let (client, project, name) = (
            scope.client.clone(),
            scope.project.clone(),
            scope.project_name.clone(),
        );
        let key = scope.key.clone();
        let task = cx.background_spawn(async move { client.create_link(&project, admission) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.scope.as_ref().map(|s| &s.key) != Some(&key) {
                    return;
                }
                match result {
                    Ok(url) => {
                        cx.write_to_clipboard(ClipboardItem::new_string(agents::connect_message(
                            &name, &url,
                        )));
                        s.made = Some(agents::mask_secret(&url));
                        s.copy = CopyStatus::Copied;
                        s.invited(cx);
                    }
                    Err(Error::Status(403)) => s.copy = CopyStatus::NotOwner,
                    Err(_) => s.copy = CopyStatus::Failed,
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    /// `onInvited`: the Header waits for the answer.
    fn invited(&mut self, cx: &mut Context<Self>) {
        self.invite = Some(self.agents.iter().map(|a| a.agent.id.clone()).collect());
        self.invite_timer = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(INVITE_WAIT).await;
            let _ = this.update(cx, |s, cx| {
                s.end_wait(cx);
                cx.notify();
            });
        }));
        self.refresh(cx);
        self.schedule(cx);
    }
    /// `useAgentRequestAnswer`: the owner's answer to a waiting Agent. While
    /// it is on its way it cannot be given twice; if it fails it can be
    /// given again; a late answer for another project changes nothing.
    pub fn decide(&mut self, request: &str, allow: bool, cx: &mut Context<Self>) {
        let Some(scope) = &self.scope else {
            return;
        };
        if !self.deciding.insert(request.to_owned()) {
            return;
        }
        self.decision_failed = false;
        let client = scope.client.clone();
        let key = scope.key.clone();
        let id = request.to_owned();
        let task = cx.background_spawn({
            let id = id.clone();
            async move { client.decide(&id, allow) }
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.scope.as_ref().map(|s| &s.key) != Some(&key) {
                    return;
                }
                match result {
                    Ok(()) => s.refresh(cx),
                    Err(_) => {
                        s.deciding.remove(&id);
                        s.decision_failed = true;
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    /// Removing asks once, on the tile itself, so a slip never takes an
    /// Agent out.
    pub fn confirm_remove(&mut self, agent: Option<String>, cx: &mut Context<Self>) {
        if self.removing.is_none() {
            self.confirming = agent;
            self.change_failed = false;
            cx.notify();
        }
    }
    /// `removeConnectedAgent`: its grant is revoked, then the Header's
    /// Agents are read again so the row and the Header follow at once.
    pub fn remove(&mut self, agent: &str, cx: &mut Context<Self>) {
        let Some(scope) = &self.scope else {
            return;
        };
        let Some(grant) = self
            .agents
            .iter()
            .find(|a| a.agent.id == agent)
            .map(|a| a.agent.grant_id.clone())
        else {
            return;
        };
        if self.removing.is_some() {
            return;
        }
        self.removing = Some(agent.to_owned());
        self.change_failed = false;
        let (client, project, key) = (
            scope.client.clone(),
            scope.project.clone(),
            scope.key.clone(),
        );
        let task = cx.background_spawn(async move { client.remove(&project, &grant) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.scope.as_ref().map(|s| &s.key) != Some(&key) {
                    return;
                }
                match result {
                    Ok(()) => s.refresh(cx),
                    Err(_) => {
                        s.removing = None;
                        s.confirming = None;
                        s.change_failed = true;
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
}
/// Captures: a project with Agents at work, at rest and one asking to join;
/// `roster`, nobody asking; `empty`, nobody yet.
#[cfg(feature = "dev-capture")]
pub fn lab_client(variant: &str) -> Client {
    use crate::{cloud::auth::model::ApiRequest, workspace::cloud::services::Transport};
    use serde_json::{Value, json};
    struct Lab(String);
    impl Transport for Lab {
        fn request(&self, request: ApiRequest) -> services::Result<Value> {
            let ago = |secs: i64| {
                chrono::DateTime::from_timestamp_millis(crate::clock::now_ms() - secs * 1000)
                    .unwrap_or_default()
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
            };
            let agent = |id: &str, name: &str, admission: &str| {
                json!({"id": id, "name": name, "admission": admission, "grant_id": format!("g-{id}"),
                    "connected_at": ago(86_400), "expires_at": "2026-12-04T00:00:00Z"})
            };
            if request.method == reqwest::Method::GET && request.path.ends_with("/workbench") {
                return Ok(json!({"workspace": {"id": "wb-lab"}}));
            }
            if request.method == reqwest::Method::POST && request.path.ends_with("/agent-links") {
                return Ok(json!({"agent_url": "https://api.puppyone.ai/agent/pai_lab0123456789"}));
            }
            Ok(if request.path.ends_with("/access/sessions") {
                json!([
                    {"grant_id": "g-claude", "state": "active", "created_at": ago(900),
                        "closed_at": null, "lease_until": ago(-60), "commands_running": 1,
                        "last_command_at": ago(5)},
                    {"grant_id": "g-codex", "state": "closed", "created_at": ago(301),
                        "closed_at": ago(300), "lease_until": ago(270)},
                ])
            } else if self.0 == "empty" {
                json!({"links": [], "connections": [], "pending": []})
            } else {
                json!({
                    "links": [],
                    "connections": [
                        agent("claude", "Claude Code", "sign_in"),
                        agent("codex", "Codex", "link"),
                        agent("cursor", "Cursor", "sign_in"),
                        agent("helper", "Research helper", "sign_in"),
                    ],
                    "pending": if self.0 == "roster" { json!([]) } else { json!([{"id": "robo",
                        "name": "Robo", "avatar": "other", "admission": "sign_in",
                        "requested_at": ago(60), "expires_at": ago(-540)}]) },
                })
            })
        }
    }
    Client::new(Arc::new(Lab(variant.to_owned())))
}
impl Default for CloudAgents {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::auth::model::ApiRequest;
    use crate::workspace::cloud::services::Transport;
    use core::prelude::v1::test;
    use gpui::TestAppContext;
    use serde_json::{Value, json};
    use std::sync::Mutex;

    #[derive(Default)]
    struct Server {
        connections: Mutex<Value>,
        pending: Mutex<Option<Value>>,
        denied: Mutex<bool>,
        offline: Mutex<bool>,
        calls: Mutex<Vec<String>>,
    }
    impl Transport for Server {
        fn request(&self, request: ApiRequest) -> services::Result<Value> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("{} {}", request.method, request.path));
            if request.path.ends_with("/agent-links") && request.method == reqwest::Method::GET {
                if *self.denied.lock().unwrap() {
                    return Err(Error::Status(403));
                }
                if *self.offline.lock().unwrap() {
                    return Err(Error::Unavailable);
                }
                let mut inventory =
                    json!({"links": [], "connections": self.connections.lock().unwrap().clone()});
                if let Some(pending) = self.pending.lock().unwrap().clone() {
                    inventory["pending"] = pending;
                }
                return Ok(inventory);
            }
            if request.path.ends_with("/access/sessions") {
                return Ok(json!([]));
            }
            if request.path.ends_with("/workbench") {
                return Ok(json!({"workspace": {"id": "wb"}}));
            }
            if request.path.ends_with("/agent-links") {
                return Ok(json!({"agent_url": "https://api.puppyone.ai/agent/x"}));
            }
            Ok(Value::Null)
        }
    }
    impl Server {
        fn lists(&self) -> usize {
            self.calls
                .lock()
                .unwrap()
                .iter()
                .filter(|c| c.starts_with("GET") && c.ends_with("/agent-links"))
                .count()
        }
    }
    fn agent(id: &str) -> Value {
        json!({"id": id, "name": "Claude Code", "admission": "sign_in", "grant_id": format!("g-{id}"),
            "connected_at": "2026-10-30T12:00:00Z", "expires_at": null})
    }
    fn setup(cx: &mut TestAppContext) -> (Arc<Server>, Entity<CloudAgents>) {
        let server = Arc::new(Server::default());
        *server.connections.lock().unwrap() = json!([agent("c1")]);
        let agents = cx.new(|_| CloudAgents::new());
        let client = Client::new(server.clone());
        agents.update(cx, |a, cx| a.attach_client("p1", "Docs", client, cx));
        cx.run_until_parked();
        (server, agents)
    }

    #[gpui::test]
    fn the_header_keeps_up_with_who_is_here(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        agents.read_with(cx, |a, _| {
            assert!(a.manageable);
            assert_eq!(a.agents[0].agent.name, "Claude Code");
        });
        // An Agent asking to join appears on the next poll.
        *server.pending.lock().unwrap() = Some(json!([{"id": "r1", "name": "Codex",
            "admission": "sign_in", "requested_at": "2026-10-30T12:00:00Z",
            "expires_at": "2026-10-30T12:10:00Z"}]));
        cx.executor().advance_clock(REFRESH);
        cx.run_until_parked();
        agents.read_with(cx, |a, _| assert_eq!(a.requests[0].name, "Codex"));
        // A bad network keeps what is known.
        *server.offline.lock().unwrap() = true;
        cx.executor().advance_clock(REFRESH);
        cx.run_until_parked();
        agents.read_with(cx, |a, _| assert_eq!(a.agents.len(), 1));
        // Not the owner: everything goes and the asking stops.
        *server.offline.lock().unwrap() = false;
        *server.denied.lock().unwrap() = true;
        cx.executor().advance_clock(REFRESH);
        cx.run_until_parked();
        let calls = server.lists();
        agents.read_with(cx, |a, _| {
            assert!(a.agents.is_empty() && a.requests.is_empty() && !a.manageable)
        });
        cx.executor().advance_clock(REFRESH * 3);
        cx.run_until_parked();
        assert_eq!(server.lists(), calls);
    }

    #[gpui::test]
    fn an_open_card_or_a_waiting_invite_asks_every_three_seconds(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        let calls = server.lists();
        cx.executor().advance_clock(WAITING_REFRESH);
        cx.run_until_parked();
        assert_eq!(server.lists(), calls);
        agents.update(cx, |a, cx| a.set_dialog_open(true, cx));
        cx.run_until_parked();
        let calls = server.lists();
        cx.executor().advance_clock(WAITING_REFRESH);
        cx.run_until_parked();
        assert_eq!(server.lists(), calls + 1);
        // A hidden window is not polled, and catches up when it returns.
        agents.update(cx, |a, cx| a.set_visible(false, cx));
        let calls = server.lists();
        cx.executor().advance_clock(WAITING_REFRESH * 5);
        cx.run_until_parked();
        assert_eq!(server.lists(), calls);
        agents.update(cx, |a, cx| a.set_visible(true, cx));
        cx.run_until_parked();
        assert_eq!(server.lists(), calls + 1);
    }

    #[gpui::test]
    fn copying_an_invite_waits_for_a_newcomer(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        agents.update(cx, |a, cx| a.copy_invite(cx));
        cx.run_until_parked();
        assert_eq!(
            cx.read_from_clipboard().and_then(|c| c.text()).as_deref(),
            Some(
                "Connect to my puppyone project \"Docs\" by following https://api.puppyone.ai/agent/x"
            )
        );
        agents.read_with(cx, |a, _| {
            assert_eq!(a.copy, CopyStatus::Copied);
            assert!(a.waiting());
            // The prompt now shows the link made, its secret masked.
            assert_eq!(a.made.as_deref(), Some("https://api.puppyone.ai/agent/x"));
        });
        // The same Agents do not end the wait; a newcomer does, and the
        // steps give way to it.
        agents.update(cx, |a, cx| {
            a.invite_open = true;
            cx.notify()
        });
        cx.executor().advance_clock(WAITING_REFRESH);
        cx.run_until_parked();
        agents.read_with(cx, |a, _| assert!(a.waiting() && a.invite_open));
        *server.connections.lock().unwrap() = json!([agent("c1"), agent("c2")]);
        cx.executor().advance_clock(WAITING_REFRESH);
        cx.run_until_parked();
        agents.read_with(cx, |a, _| {
            assert!(!a.waiting() && !a.invite_open);
            assert_eq!((a.copy, a.made.as_deref()), (CopyStatus::Idle, None));
        });
    }

    #[gpui::test]
    fn the_dialog_opens_on_inviting_only_while_nobody_is_here(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        agents.update(cx, |a, cx| a.open(Opener::More, cx));
        agents.read_with(cx, |a, _| assert!(!a.invite_open));
        *server.connections.lock().unwrap() = json!([]);
        agents.update(cx, |a, cx| a.refresh(cx));
        cx.run_until_parked();
        agents.update(cx, |a, cx| a.open(Opener::Invite, cx));
        agents.read_with(cx, |a, _| {
            assert!(a.invite_open);
            // Before Copy, the link is shown as not made yet.
            assert_eq!(
                a.prompt().as_deref(),
                Some("Connect to my puppyone project \"Docs\" by following https://api.puppyone.ai/agent/••••••")
            );
        });
        // Folded and opened again, the steps start over.
        agents.update(cx, |a, cx| {
            a.toggle_invite(cx);
            a.toggle_invite(cx);
        });
        agents.read_with(cx, |a, _| assert!(a.invite_open && a.made.is_none()));
    }

    #[gpui::test]
    fn removing_asks_once_on_the_tile_and_tells_the_header(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        agents.update(cx, |a, cx| a.confirm_remove(Some("c1".into()), cx));
        agents.read_with(cx, |a, _| assert_eq!(a.confirming.as_deref(), Some("c1")));
        // Keep takes nothing out.
        agents.update(cx, |a, cx| a.confirm_remove(None, cx));
        assert!(
            !server
                .calls
                .lock()
                .unwrap()
                .iter()
                .any(|c| c.starts_with("PATCH"))
        );
        *server.connections.lock().unwrap() = json!([]);
        agents.update(cx, |a, cx| {
            a.confirm_remove(Some("c1".into()), cx);
            a.remove("c1", cx)
        });
        cx.run_until_parked();
        assert!(
            server
                .calls
                .lock()
                .unwrap()
                .contains(&"PATCH /projects/p1/access/grants/g-c1".to_owned())
        );
        agents.read_with(cx, |a, _| {
            assert!(a.agents.is_empty());
            assert!(a.removing.is_none() && a.confirming.is_none());
        });
    }
}
