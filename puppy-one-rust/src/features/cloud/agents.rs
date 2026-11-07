//! `useWorkspaceAgents` and the state behind `CloudWorkspaceAgentsPanel`,
//! `CloudWorkspaceAgentInvite` and `CloudWorkspaceAgentsDialog`: who is in a
//! hosted workspace, kept current for a Header that never closes. Only the
//! owner may read the list, so a 403 ends the asking for good; a bad network
//! keeps what is known instead of emptying the Header.
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
/// The Manage dialog shows an Agent the owner just allowed on its own.
const MANAGE_REFRESH: Duration = Duration::from_secs(5);
/// A sign-in request lasts ten minutes, so an invite unanswered by then is
/// not awaited.
const INVITE_WAIT: Duration = Duration::from_secs(10 * 60);
/// Long enough to read, short enough to invite a second Agent.
const COPIED: Duration = Duration::from_secs(3);

/// Who opened the Agents card: one Agent's mark, the overflow count, or the
/// invite seat.
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
/// `CloudWorkspaceAgentsDialog`'s own reading of the links and connections.
#[derive(Default)]
pub struct Manage {
    pub inventory: Inventory,
    pub change_failed: bool,
    _poll: Option<Task<()>>,
}

struct Scope {
    /// A fixture outlives the account (tests, captures).
    fixture: bool,
    key: String,
    project: String,
    project_name: String,
    client: Client,
}

pub struct CloudAgents {
    scope: Option<Scope>,
    pub agents: Vec<WorkspaceAgent>,
    pub requests: Vec<AgentRequest>,
    /// Only someone the server lets read the list may manage it.
    pub manageable: bool,
    pub open_links: bool,
    denied: bool,
    latest: u64,
    visible: bool,
    panel_open: bool,
    poll: Option<Task<()>>,
    /// The Agents already here when the last invite was copied.
    invite: Option<HashSet<String>>,
    invite_timer: Option<Task<()>>,
    pub opener: Opener,
    pub admission: Admission,
    pub copy: CopyStatus,
    copy_timer: Option<Task<()>>,
    /// The invite form is asked for beside the Agents.
    pub expanded: bool,
    /// Requests being answered; each row stays, disabled, until the list
    /// that no longer holds it arrives.
    pub deciding: HashSet<String>,
    pub decision_failed: bool,
    pub manage: Option<Manage>,
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
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

impl CloudAgents {
    pub fn new() -> Self {
        Self {
            scope: None,
            agents: vec![],
            requests: vec![],
            manageable: false,
            open_links: false,
            denied: false,
            latest: 0,
            visible: true,
            panel_open: false,
            poll: None,
            invite: None,
            invite_timer: None,
            opener: Opener::More,
            admission: Admission::SignIn,
            copy: CopyStatus::Idle,
            copy_timer: None,
            expanded: false,
            deciding: HashSet::new(),
            decision_failed: false,
            manage: None,
        }
    }
    /// The hosted Project at its root for the signed-in account
    /// (`agentTarget`); a scope change forgets everything.
    pub fn sync(
        &mut self,
        project: Option<(&str, &str)>,
        panel_open: bool,
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
            self.set_panel_open(panel_open, cx);
            return;
        }
        let key = target.as_ref().map(|t| t.0.clone());
        if key.as_deref() != self.scope.as_ref().map(|s| s.key.as_str()) {
            let scope = target.map(|(key, project, name, broker, binding)| Scope {
                fixture: false,
                key,
                project: project.to_owned(),
                project_name: name.to_owned(),
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
        self.set_panel_open(panel_open, cx);
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
                client,
            }),
            cx,
        );
    }
    fn attach(&mut self, scope: Option<Scope>, cx: &mut Context<Self>) {
        let panel_open = self.panel_open;
        let visible = self.visible;
        *self = Self::new();
        self.panel_open = panel_open;
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
    /// The Agents card is open, so a request should appear about as soon
    /// as it is made.
    fn set_panel_open(&mut self, open: bool, cx: &mut Context<Self>) {
        if self.panel_open != open {
            let waiting = self.fast();
            self.panel_open = open;
            // The card's own state goes with it.
            if !open {
                self.decision_failed = false;
                self.expanded = false;
                self.admission = Admission::SignIn;
                if self.copy != CopyStatus::Copying {
                    self.copy = CopyStatus::Idle;
                }
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
        self.panel_open || self.waiting()
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
                self.poll = None;
                cx.notify();
                return;
            }
            Err(_) => return,
        };
        self.manageable = true;
        self.open_links = inventory.open_links_enabled;
        self.requests = inventory.pending;
        self.agents = agents::resolve(&inventory.connections, sessions.as_deref(), now_ms());
        let pending: HashSet<&str> = self.requests.iter().map(|r| r.id.as_str()).collect();
        self.deciding.retain(|id| pending.contains(id.as_str()));
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
    /// A mark, the count or the invite seat was pressed: the same one
    /// closes the card, another one moves it.
    pub fn press(&mut self, opener: Opener, open: bool) -> bool {
        let close = open && self.opener == opener;
        self.opener = opener;
        !close
    }

    /// `copy`: every copy is a new link, and the prompt goes to the
    /// clipboard.
    pub fn copy_invite(&mut self, cx: &mut Context<Self>) {
        let Some(scope) = &self.scope else {
            return;
        };
        if self.copy == CopyStatus::Copying {
            return;
        }
        self.copy = CopyStatus::Copying;
        self.copy_timer = None;
        let admission = if self.open_links {
            self.admission
        } else {
            Admission::SignIn
        };
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
                        s.copy = CopyStatus::Copied;
                        s.copy_timer = Some(cx.spawn(async move |this, cx| {
                            cx.background_executor().timer(COPIED).await;
                            let _ = this.update(cx, |s, cx| {
                                if s.copy == CopyStatus::Copied {
                                    s.copy = CopyStatus::Idle;
                                    cx.notify();
                                }
                            });
                        }));
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
    pub fn choose(&mut self, admission: Admission, cx: &mut Context<Self>) {
        self.admission = admission;
        self.copy = CopyStatus::Idle;
        cx.notify();
    }
    pub fn expand_invite(&mut self, cx: &mut Context<Self>) {
        self.expanded = true;
        cx.notify();
    }
    /// The owner's answer to a waiting Agent.
    pub fn decide(&mut self, request: &str, allow: bool, cx: &mut Context<Self>) {
        let Some(scope) = &self.scope else {
            return;
        };
        if !self.deciding.insert(request.to_owned()) {
            return;
        }
        self.decision_failed = false;
        let client = scope.client.clone();
        let id = request.to_owned();
        let task = cx.background_spawn({
            let id = id.clone();
            async move { client.decide(&id, allow) }
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
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

    /// Manage agents opens over the window and keeps its own list current.
    pub fn open_manage(&mut self, cx: &mut Context<Self>) {
        if self.scope.is_none() {
            return;
        }
        let poll = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(MANAGE_REFRESH).await;
                if this.update(cx, |s, cx| s.refresh_manage(cx)).is_err() {
                    break;
                }
            }
        });
        self.manage = Some(Manage {
            _poll: Some(poll),
            ..Default::default()
        });
        self.refresh_manage(cx);
        cx.notify();
    }
    pub fn close_manage(&mut self, cx: &mut Context<Self>) {
        self.manage = None;
        cx.notify();
    }
    /// What is shown stays until a read succeeds.
    fn refresh_manage(&mut self, cx: &mut Context<Self>) {
        let (Some(scope), Some(_)) = (&self.scope, &self.manage) else {
            return;
        };
        let (client, project) = (scope.client.clone(), scope.project.clone());
        let task = cx.background_spawn(async move { client.links(&project) });
        cx.spawn(async move |this, cx| {
            if let Ok(inventory) = task.await {
                let _ = this.update(cx, |s, cx| {
                    if let Some(manage) = &mut s.manage {
                        manage.inventory = inventory;
                        cx.notify();
                    }
                });
            }
        })
        .detach();
    }
    /// `removeConnectedAgent`.
    pub fn remove(&mut self, grant: &str, cx: &mut Context<Self>) {
        let grant = grant.to_owned();
        self.change(move |client, project| client.remove(project, &grant), cx);
    }
    /// `stopSharingWithAgents`: links and connections end together.
    pub fn remove_all(&mut self, cx: &mut Context<Self>) {
        self.change(|client, project| client.stop_sharing(project), cx);
    }
    fn change(
        &mut self,
        action: impl FnOnce(&Client, &str) -> services::Result<()> + Send + 'static,
        cx: &mut Context<Self>,
    ) {
        let (Some(scope), Some(manage)) = (&self.scope, &mut self.manage) else {
            return;
        };
        manage.change_failed = false;
        let (client, project) = (scope.client.clone(), scope.project.clone());
        let task = cx.background_spawn(async move { action(&client, &project) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                match result {
                    Ok(()) => {
                        s.refresh_manage(cx);
                        s.refresh(cx);
                    }
                    Err(_) => {
                        if let Some(manage) = &mut s.manage {
                            manage.change_failed = true;
                        }
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
}
/// Captures: a project with Agents at work, at rest and asking to join.
#[cfg(feature = "dev-capture")]
pub fn lab_client(open_links: bool) -> Client {
    use crate::{cloud::auth::model::ApiRequest, workspace::cloud::services::Transport};
    use serde_json::{Value, json};
    struct Lab(bool);
    impl Transport for Lab {
        fn request(&self, request: ApiRequest) -> services::Result<Value> {
            let ago = |secs: i64| {
                chrono::DateTime::from_timestamp_millis(now_ms() - secs * 1000)
                    .unwrap_or_default()
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
            };
            let agent = |id: &str, name: &str, admission: &str| {
                json!({"id": id, "name": name, "admission": admission, "grant_id": format!("g-{id}"),
                    "connected_at": ago(86_400), "expires_at": "2026-12-04T00:00:00Z"})
            };
            Ok(if request.path.ends_with("/access/sessions") {
                json!([
                    {"grant_id": "g-claude", "state": "active", "created_at": ago(20),
                        "closed_at": null, "lease_until": ago(-60)},
                    {"grant_id": "g-codex", "state": "closed", "created_at": ago(301),
                        "closed_at": ago(300), "lease_until": ago(270)},
                ])
            } else {
                json!({
                    "links": [{"id": "l1", "admission": "sign_in", "expires_at": "2026-11-11T00:00:00Z"}],
                    "open_links_enabled": self.0,
                    "connections": [
                        agent("claude", "Claude Code", "sign_in"),
                        agent("codex", "Codex", "link"),
                        agent("cursor", "Cursor", "sign_in"),
                        agent("helper", "Research helper", "sign_in"),
                    ],
                    "pending": [{"id": "opencode", "name": "OpenCode", "admission": "sign_in",
                        "requested_at": ago(60), "expires_at": ago(-540)}],
                })
            })
        }
    }
    Client::new(Arc::new(Lab(open_links)))
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
        agents.update(cx, |a, cx| a.set_panel_open(true, cx));
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
        });
        // The same Agents do not end the wait; a newcomer does.
        cx.executor().advance_clock(WAITING_REFRESH);
        cx.run_until_parked();
        agents.read_with(cx, |a, _| {
            assert!(a.waiting());
            assert_eq!(a.copy, CopyStatus::Idle);
        });
        *server.connections.lock().unwrap() = json!([agent("c1"), agent("c2")]);
        cx.executor().advance_clock(WAITING_REFRESH);
        cx.run_until_parked();
        agents.read_with(cx, |a, _| assert!(!a.waiting()));
        // Pressing the mark that opened the card closes it.
        agents.update(cx, |a, _| {
            assert!(a.press(Opener::Invite, false));
            assert!(!a.press(Opener::Invite, true));
            assert!(a.press(Opener::More, true));
        });
    }

    #[gpui::test]
    fn manage_removes_an_agent_and_tells_the_header(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        agents.update(cx, |a, cx| a.open_manage(cx));
        cx.run_until_parked();
        agents.read_with(cx, |a, _| {
            assert_eq!(a.manage.as_ref().unwrap().inventory.connections.len(), 1)
        });
        *server.connections.lock().unwrap() = json!([]);
        agents.update(cx, |a, cx| a.remove("g-c1", cx));
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
            assert!(a.manage.as_ref().unwrap().inventory.connections.is_empty());
        });
    }
}
