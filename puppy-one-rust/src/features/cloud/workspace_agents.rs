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
/// How long Copy says "Copied" before it offers to copy again.
const COPIED_FLASH: Duration = Duration::from_millis(1600);

/// Who opened the Agents dialog: one Agent's mark, the stack of the ones at
/// rest, or the empty seat.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Opener {
    Agent(String),
    More,
    Invite,
}
/// Where the invite stands. Copying is not the end of it: the message is
/// out until an Agent comes in, or it lapses.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Invite {
    /// Nothing copied yet, or starting over.
    #[default]
    Give,
    /// The message is out, since this moment (ms); the person pastes it.
    Out(i64),
    /// Nobody came before the message lapsed.
    Lapsed,
    /// The Agent that came in, by id.
    Joined(String),
}
/// What the invite shows now: [`Invite`] with an Agent asking to join
/// answered where it asks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InvitePhase {
    Give,
    Waiting,
    Knocking,
    Lapsed,
    Joined,
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
    /// The dialog shows the invite rather than the roster.
    pub invite_open: bool,
    /// Where the invite stands.
    pub invite_flow: Invite,
    /// The Agents here when the message went out, so a newcomer is known.
    baseline: HashSet<String>,
    /// The Agent the owner just turned away, by name.
    pub turned_away: Option<String>,
    /// Copy has just copied (`Copied`, then `Copy again`).
    pub fresh_copy: bool,
    fresh_timer: Option<Task<()>>,
    /// Redraws the countdown while the message is out and on screen.
    ticker: Option<Task<()>>,
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

/// `CloudWorkspaceHeaderTools`' scope: the API host, the account, its
/// sign-in generation and the Project.
fn scope_key(api: &str, user: &str, epoch: u64, project: &str) -> String {
    format!("{api}\n{user}\n{epoch}\n{project}")
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
            invite_flow: Invite::Give,
            baseline: HashSet::new(),
            turned_away: None,
            fresh_copy: false,
            fresh_timer: None,
            ticker: None,
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
            let key = scope_key(
                binding.environment.api(),
                &binding.user,
                binding.epoch,
                project,
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
    /// The Project and identity everything here belongs to; anything open
    /// for one ends when it changes.
    pub fn scope_key(&self) -> Option<&str> {
        self.scope.as_ref().map(|s| s.key.as_str())
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
            self.tick(cx);
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
    /// The Project is known and the server has not yet said whether this
    /// person may manage its Agents (`loading`).
    pub fn checking(&self) -> bool {
        self.scope.is_some() && !self.known
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
        // The Agent the message brought in: the invite ends on it while it
        // is on screen; otherwise the Header shows it and the invite starts
        // over.
        if matches!(self.invite_flow, Invite::Out(_)) {
            let newcomer = self
                .agents
                .iter()
                .find(|a| !self.baseline.contains(&a.agent.id))
                .map(|a| a.agent.id.clone());
            if let Some(id) = newcomer {
                if self.dialog_open && self.invite_open {
                    self.invite_flow = Invite::Joined(id);
                    self.ticker = None;
                } else {
                    self.reset_invite(cx);
                }
            }
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
    /// yet, or from the seat, it opens on the invite (`openFirst`).
    pub fn open(&mut self, opener: Opener, cx: &mut Context<Self>) {
        self.opener = opener;
        self.confirming = None;
        self.change_failed = false;
        self.decision_failed = false;
        self.invite_open = matches!(self.opener, Opener::Invite)
            || (self.agents.is_empty() && self.requests.is_empty());
        self.tick(cx);
        cx.notify();
    }
    /// The roster's seat: the dialog turns to the invite, where it stands.
    pub fn start_invite(&mut self, cx: &mut Context<Self>) {
        self.confirming = None;
        self.invite_open = true;
        if matches!(self.invite_flow, Invite::Joined(_) | Invite::Lapsed) {
            self.reset_invite(cx);
        }
        self.tick(cx);
        cx.notify();
    }
    /// The dialog closed: a message still out keeps waiting (the Header
    /// says so); anything else starts over next time.
    pub fn close_invite(&mut self, cx: &mut Context<Self>) {
        self.invite_open = false;
        if !matches!(self.invite_flow, Invite::Out(_)) {
            self.reset_invite(cx);
        }
        cx.notify();
    }
    /// From what to copy again (`Add another agent`).
    pub fn reset_invite(&mut self, cx: &mut Context<Self>) {
        self.invite_flow = Invite::Give;
        self.baseline.clear();
        self.turned_away = None;
        self.fresh_copy = false;
        self.fresh_timer = None;
        self.ticker = None;
        if self.copy != CopyStatus::Copying {
            self.copy = CopyStatus::Idle;
        }
        self.made = None;
        cx.notify();
    }
    /// What the invite shows: an Agent asking to join is answered in the
    /// invite, whatever brought it; a message out past its ten minutes has
    /// lapsed.
    pub fn invite_phase(&self) -> InvitePhase {
        match &self.invite_flow {
            Invite::Joined(id) if self.agents.iter().any(|a| &a.agent.id == id) => {
                return InvitePhase::Joined;
            }
            _ if !self.requests.is_empty() => return InvitePhase::Knocking,
            _ => {}
        }
        match self.invite_flow {
            Invite::Out(_) if self.remaining_secs() > 0 => InvitePhase::Waiting,
            Invite::Out(_) | Invite::Lapsed => InvitePhase::Lapsed,
            _ => InvitePhase::Give,
        }
    }
    /// Captures: the message out long enough to have lapsed.
    #[cfg(feature = "dev-capture")]
    pub fn capture_lapse(&mut self, cx: &mut Context<Self>) {
        self.invite_flow = Invite::Lapsed;
        self.ticker = None;
        cx.notify();
    }
    /// Whole seconds left before the message lapses.
    pub fn remaining_secs(&self) -> u64 {
        let Invite::Out(since) = self.invite_flow else {
            return 0;
        };
        let left = INVITE_WAIT.as_millis() as i64 - (crate::clock::now_ms() - since);
        (left.max(0) as u64).div_ceil(1000)
    }
    /// The Agent the invite ended on.
    pub fn joined(&self) -> Option<&WorkspaceAgent> {
        match &self.invite_flow {
            Invite::Joined(id) => self.agents.iter().find(|a| &a.agent.id == id),
            _ => None,
        }
    }
    /// The countdown moves once a second while the message is out and the
    /// invite is on screen.
    fn tick(&mut self, cx: &mut Context<Self>) {
        let showing = self.dialog_open && self.invite_open;
        if !(showing && matches!(self.invite_flow, Invite::Out(_))) {
            self.ticker = None;
            return;
        }
        if self.ticker.is_some() {
            return;
        }
        self.ticker = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(Duration::from_secs(1)).await;
                if this.update(cx, |_, cx| cx.notify()).is_err() {
                    break;
                }
            }
        }));
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
    /// The prompt as the invite shows it, in two parts so the link stands
    /// apart: `Connect to my puppyone project "…" by following `, then the
    /// link without its scheme and with what is not shown as an ellipsis,
    /// so it wraps as one address and reads as one.
    pub fn prompt_parts(&self) -> Option<(String, String)> {
        let prompt = self.prompt()?;
        let link = self.made.clone().unwrap_or_else(|| {
            let api = self
                .scope
                .as_ref()
                .map(|s| s.api.as_str())
                .unwrap_or_default();
            format!("{}{}", agents::link_preview(api), agents::UNMADE)
        });
        let lead = prompt.strip_suffix(&link).unwrap_or(&prompt).to_owned();
        let shown = link
            .split_once("://")
            .map_or(link.as_str(), |(_, rest)| rest)
            .replace(agents::UNMADE, "…");
        Some((lead, shown))
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
    /// `onInvited`: the message is out, so the invite and the Header wait
    /// for the answer.
    fn invited(&mut self, cx: &mut Context<Self>) {
        let here: HashSet<String> = self.agents.iter().map(|a| a.agent.id.clone()).collect();
        self.baseline = here.clone();
        self.invite = Some(here);
        self.invite_flow = Invite::Out(crate::clock::now_ms());
        self.turned_away = None;
        self.fresh_copy = true;
        self.fresh_timer = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(COPIED_FLASH).await;
            let _ = this.update(cx, |s, cx| {
                s.fresh_copy = false;
                cx.notify();
            });
        }));
        self.invite_timer = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(INVITE_WAIT).await;
            let _ = this.update(cx, |s, cx| {
                s.end_wait(cx);
                // Nobody came: the message has lapsed.
                if matches!(s.invite_flow, Invite::Out(_)) && s.requests.is_empty() {
                    s.invite_flow = Invite::Lapsed;
                    s.ticker = None;
                }
                cx.notify();
            });
        }));
        self.tick(cx);
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
        let name = self
            .requests
            .iter()
            .find(|r| r.id == request)
            .map(|r| r.name.clone());
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
                    // Turned away: the invite starts over, saying so.
                    Ok(()) if !allow && s.invite_open => {
                        s.reset_invite(cx);
                        s.turned_away = name;
                        s.refresh(cx);
                    }
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
/// `roster`, nobody asking; `empty`, nobody yet; `invite`, nobody yet until
/// the message goes out, then Claude Code asks to join and, allowed, is in.
#[cfg(feature = "dev-capture")]
pub fn lab_client(variant: &str) -> Client {
    use crate::{cloud::auth::model::ApiRequest, workspace::cloud::services::Transport};
    use serde_json::{Value, json};
    use std::sync::atomic::{AtomicU8, Ordering};
    struct Lab(String, AtomicU8);
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
                self.1.fetch_max(1, Ordering::SeqCst);
                return Ok(json!({"agent_url": "https://api.puppyone.ai/agent/pai_lab0123456789"}));
            }
            if request.path.ends_with("/decision") {
                self.1.store(2, Ordering::SeqCst);
                return Ok(json!({}));
            }
            if self.0 == "invite" && request.path.ends_with("/agent-links") {
                return Ok(match self.1.load(Ordering::SeqCst) {
                    0 => json!({"links": [], "connections": [], "pending": []}),
                    1 => json!({"links": [], "connections": [], "pending": [{"id": "knock",
                        "name": "Claude Code", "avatar": "claude", "admission": "sign_in",
                        "requested_at": ago(5), "expires_at": ago(-595)}]}),
                    _ => {
                        json!({"links": [], "connections": [agent("claude", "Claude Code", "sign_in")],
                        "pending": []})
                    }
                });
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
    Client::new(Arc::new(Lab(variant.to_owned(), AtomicU8::new(0))))
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
        /// The sessions cannot be read; the list still can.
        sessions_down: Mutex<bool>,
        /// Answers and removals do not go through.
        refuse_changes: Mutex<bool>,
        /// The next invite is not made, for this reason.
        link_failure: Mutex<Option<Error>>,
        calls: Mutex<Vec<String>>,
        /// What every write carried, in order.
        writes: Mutex<Vec<(String, Value)>>,
    }
    impl Transport for Server {
        fn request(&self, request: ApiRequest) -> services::Result<Value> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("{} {}", request.method, request.path));
            if request.method != reqwest::Method::GET {
                self.writes.lock().unwrap().push((
                    request.path.clone(),
                    request.body.clone().unwrap_or(Value::Null),
                ));
            }
            let change = request.path.ends_with("/decision") || request.path.contains("/grants/");
            if change && *self.refuse_changes.lock().unwrap() {
                return Err(Error::Unavailable);
            }
            if request.path.ends_with("/agent-links")
                && request.method == reqwest::Method::POST
                && let Some(error) = self.link_failure.lock().unwrap().take()
            {
                return Err(error);
            }
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
                if *self.sessions_down.lock().unwrap() {
                    return Err(Error::Unavailable);
                }
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
        fn reads_of(&self, project: &str) -> usize {
            let list = format!("GET /projects/{project}/agent-links");
            self.calls
                .lock()
                .unwrap()
                .iter()
                .filter(|c| **c == list)
                .count()
        }
        /// Each answer given, as `request:decision`.
        fn decisions(&self) -> Vec<String> {
            self.writes
                .lock()
                .unwrap()
                .iter()
                .filter_map(|(path, body)| {
                    let id = path.strip_prefix("/agent-links/connections/")?;
                    let id = id.strip_suffix("/decision")?;
                    Some(format!("{id}:{}", body["decision"].as_str()?))
                })
                .collect()
        }
        /// The secret of every invite asked for.
        fn secrets(&self) -> Vec<String> {
            self.writes
                .lock()
                .unwrap()
                .iter()
                .filter(|(path, _)| path.ends_with("/agent-links"))
                .filter_map(|(_, body)| body["secret"].as_str().map(str::to_owned))
                .collect()
        }
    }
    fn ids(agents: &Entity<CloudAgents>, cx: &mut TestAppContext) -> Vec<String> {
        agents.read_with(cx, |a, _| {
            a.agents.iter().map(|a| a.agent.id.clone()).collect()
        })
    }
    fn asked(agents: &Entity<CloudAgents>, cx: &mut TestAppContext) -> Vec<String> {
        agents.read_with(cx, |a, _| a.requests.iter().map(|r| r.id.clone()).collect())
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

    /// The host, the account, its sign-in generation and the Project each
    /// make a scope of their own.
    #[test]
    fn every_part_of_the_identity_makes_its_own_scope() {
        let key = scope_key("https://api.puppyone.ai/api/v1", "alice", 1, "p1");
        for other in [
            scope_key("https://other.puppyone.ai/api/v1", "alice", 1, "p1"),
            scope_key("https://api.puppyone.ai/api/v1", "bob", 1, "p1"),
            scope_key("https://api.puppyone.ai/api/v1", "alice", 2, "p1"),
            scope_key("https://api.puppyone.ai/api/v1", "alice", 1, "p2"),
        ] {
            assert_ne!(key, other);
        }
    }

    /// `workspaceAgentStatus`: working now, when it last worked, nothing
    /// recent, and nothing at all when its sessions could not be read.
    #[test]
    fn the_status_says_when_an_agent_last_worked() {
        let now = 1_793_361_600; // 2026-10-30T12:00:00Z
        let one = |active: bool, last: Option<i64>, known: bool| WorkspaceAgent {
            agent: serde_json::from_value(agent("c1")).unwrap(),
            active,
            last_active_at: last.map(|ago| {
                chrono::DateTime::from_timestamp(now - ago, 0)
                    .unwrap()
                    .to_rfc3339()
            }),
            activity_known: known,
        };
        assert_eq!(
            status(&one(true, None, true), now).as_deref(),
            Some("Working now")
        );
        assert_eq!(
            status(&one(false, Some(300), true), now).as_deref(),
            Some("Last worked 5 minutes ago")
        );
        assert_eq!(
            status(&one(false, None, true), now).as_deref(),
            Some("No recent work")
        );
        assert_eq!(status(&one(false, None, false), now), None);
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
        // Nobody waiting any more: back to every ten seconds.
        agents.update(cx, |a, cx| a.set_dialog_open(false, cx));
        cx.run_until_parked();
        let calls = server.lists();
        cx.executor().advance_clock(WAITING_REFRESH);
        cx.run_until_parked();
        assert_eq!(server.lists(), calls);
        cx.executor().advance_clock(REFRESH - WAITING_REFRESH);
        cx.run_until_parked();
        assert_eq!(server.lists(), calls + 1);
    }

    /// `useWorkspaceAgents`: an Agent shows once it is allowed and goes once
    /// it is removed, at once when asked rather than at the next poll; so do
    /// the Agents asking to join. One whose activity could not be read is
    /// still listed. Without a target nothing is asked, and whatever the
    /// last one held goes with it (signing out ends a waiting request too).
    #[gpui::test]
    fn the_header_follows_the_list_and_forgets_it_with_the_target(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        *server.connections.lock().unwrap() = json!([]);
        cx.executor().advance_clock(REFRESH);
        cx.run_until_parked();
        assert!(ids(&agents, cx).is_empty());
        *server.connections.lock().unwrap() = json!([agent("c1")]);
        cx.executor().advance_clock(REFRESH);
        cx.run_until_parked();
        assert_eq!(ids(&agents, cx), ["c1"]);
        // Asked, it reads now.
        *server.connections.lock().unwrap() = json!([]);
        agents.update(cx, |a, cx| a.refresh(cx));
        cx.run_until_parked();
        assert!(ids(&agents, cx).is_empty());
        *server.pending.lock().unwrap() = Some(asking("r1"));
        agents.update(cx, |a, cx| a.refresh(cx));
        cx.run_until_parked();
        assert_eq!(asked(&agents, cx), ["r1"]);
        *server.pending.lock().unwrap() = Some(json!([]));
        agents.update(cx, |a, cx| a.refresh(cx));
        cx.run_until_parked();
        assert!(asked(&agents, cx).is_empty());
        // Its sessions could not be read: listed, its activity unknown.
        *server.connections.lock().unwrap() = json!([agent("c1")]);
        *server.sessions_down.lock().unwrap() = true;
        *server.pending.lock().unwrap() = Some(asking("r2"));
        agents.update(cx, |a, cx| a.refresh(cx));
        cx.run_until_parked();
        agents.read_with(cx, |a, _| {
            assert_eq!(a.agents[0].agent.name, "Claude Code");
            assert!(!a.agents[0].activity_known);
            assert!(!a.checking());
        });
        // The target goes: so do the Agents and the request, and nothing
        // more is asked.
        agents.update(cx, |a, cx| a.attach(None, cx));
        agents.read_with(cx, |a, _| {
            assert!(a.agents.is_empty() && a.requests.is_empty());
            assert!(!a.manageable && !a.checking());
        });
        let calls = server.lists();
        agents.update(cx, |a, cx| a.refresh(cx));
        cx.executor().advance_clock(REFRESH * 3);
        cx.run_until_parked();
        assert_eq!(server.lists(), calls);
    }

    /// `ignores an answer that arrives after a newer one`: what a read
    /// overtaken by a newer one found never shows, not even for a moment.
    #[gpui::test]
    fn an_overtaken_answer_never_shows(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        *server.connections.lock().unwrap() = json!([]);
        agents.update(cx, |a, cx| a.refresh(cx));
        cx.run_until_parked();
        let shown = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let seen = shown.clone();
        cx.update(|cx| {
            cx.observe(&agents, move |a, cx| {
                seen.borrow_mut().push(a.read(cx).agents.len());
            })
            .detach()
        });
        // The first read finds c1, but its answer has not landed when a
        // newer read, which finds nobody, is asked for.
        *server.connections.lock().unwrap() = json!([agent("c1")]);
        let before = server.lists();
        agents.update(cx, |a, cx| a.refresh(cx));
        let executor = cx.executor();
        let dispatcher = executor.dispatcher().as_test().unwrap();
        while server.lists() == before {
            assert!(dispatcher.tick(true), "the first read must run");
        }
        *server.connections.lock().unwrap() = json!([]);
        agents.update(cx, |a, cx| a.refresh(cx));
        cx.run_until_parked();
        assert_eq!(server.lists(), before + 2);
        assert!(!shown.borrow().is_empty());
        assert!(
            shown.borrow().iter().all(|n| *n == 0),
            "{:?}",
            shown.borrow()
        );
        assert!(ids(&agents, cx).is_empty());
    }

    /// Not the owner from the very first read: nothing is listed, nothing
    /// is offered and nothing more is asked.
    #[gpui::test]
    fn a_first_refusal_asks_no_more(cx: &mut TestAppContext) {
        let server = Arc::new(Server::default());
        *server.denied.lock().unwrap() = true;
        let agents = cx.new(|_| CloudAgents::new());
        let client = Client::new(server.clone());
        agents.update(cx, |a, cx| a.attach_client("p1", "Docs", client, cx));
        cx.run_until_parked();
        assert_eq!(server.lists(), 1);
        cx.executor().advance_clock(REFRESH * 2);
        cx.run_until_parked();
        assert_eq!(server.lists(), 1);
        agents.read_with(cx, |a, _| {
            assert!(a.agents.is_empty() && !a.manageable);
            assert!(a.known && !a.checking());
        });
    }

    /// `useAgentRequestAnswer` behind the request card: an answer goes once
    /// and holds both choices until the list moves on to the next request;
    /// one that did not go through says so and can be given again, letting
    /// nobody in. The server dropping a request (expired, or answered
    /// elsewhere) ends it; a bad network does not. A late answer in another
    /// project changes nothing there.
    #[gpui::test]
    fn an_answer_goes_once_and_a_failed_one_can_be_given_again(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        *server.pending.lock().unwrap() = Some(json!([request("r1"), request("r2")]));
        agents.update(cx, |a, cx| a.refresh(cx));
        cx.run_until_parked();
        assert_eq!(asked(&agents, cx), ["r1", "r2"]);
        // Allow, then Deny before it lands: one answer, both choices held.
        *server.pending.lock().unwrap() = Some(asking("r2"));
        agents.update(cx, |a, cx| {
            a.decide("r1", true, cx);
            a.decide("r1", false, cx);
            assert!(a.deciding.contains("r1"));
        });
        cx.run_until_parked();
        assert_eq!(asked(&agents, cx), ["r2"]);
        agents.read_with(cx, |a, _| {
            assert!(a.deciding.is_empty() && !a.decision_failed)
        });
        // Not through: it says so, the request stays and nobody is let in.
        *server.refuse_changes.lock().unwrap() = true;
        agents.update(cx, |a, cx| a.decide("r2", true, cx));
        cx.run_until_parked();
        agents.read_with(cx, |a, _| {
            assert!(a.decision_failed && !a.deciding.contains("r2"));
            assert_eq!(a.agents.len(), 1);
        });
        assert_eq!(asked(&agents, cx), ["r2"]);
        *server.refuse_changes.lock().unwrap() = false;
        *server.pending.lock().unwrap() = Some(json!([]));
        agents.update(cx, |a, cx| a.decide("r2", false, cx));
        cx.run_until_parked();
        assert!(asked(&agents, cx).is_empty());
        agents.read_with(cx, |a, _| assert!(!a.decision_failed));
        assert_eq!(
            server.decisions(),
            ["r1:approve", "r2:approve", "r2:reject"]
        );
        // Dropped by the server: gone without an answer. A bad network
        // keeps the one waiting, still answerable.
        *server.pending.lock().unwrap() = Some(asking("r3"));
        cx.executor().advance_clock(REFRESH);
        cx.run_until_parked();
        assert_eq!(asked(&agents, cx), ["r3"]);
        *server.pending.lock().unwrap() = Some(json!([]));
        cx.executor().advance_clock(REFRESH);
        cx.run_until_parked();
        assert!(asked(&agents, cx).is_empty());
        *server.pending.lock().unwrap() = Some(asking("r4"));
        cx.executor().advance_clock(REFRESH);
        cx.run_until_parked();
        *server.offline.lock().unwrap() = true;
        cx.executor().advance_clock(REFRESH);
        cx.run_until_parked();
        assert_eq!(asked(&agents, cx), ["r4"]);
        agents.read_with(cx, |a, _| assert!(a.deciding.is_empty()));
        assert_eq!(server.decisions().len(), 3);
        // Answered, then another project: the late answer reads nothing.
        *server.offline.lock().unwrap() = false;
        *server.pending.lock().unwrap() = None;
        agents.update(cx, |a, cx| a.decide("r4", false, cx));
        let other = Client::new(server.clone());
        agents.update(cx, |a, cx| a.attach_client("p2", "Other", other, cx));
        cx.run_until_parked();
        assert_eq!(server.reads_of("p2"), 1);
        assert!(asked(&agents, cx).is_empty());
        assert_eq!(server.decisions().len(), 4);
    }

    /// `CloudWorkspaceAgentInvite`'s Copy: nothing is made before it is
    /// pressed — the prompt shows the link to come, masked — and every
    /// press makes an invite of its own. One that could not be made says so
    /// and Copy works again; a refusal says only the owner may, copying
    /// nothing and setting no wait.
    #[gpui::test]
    fn every_copy_makes_its_own_invite_and_a_refusal_copies_nothing(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        agents.update(cx, |a, cx| {
            a.set_dialog_open(true, cx);
            a.open(Opener::Invite, cx)
        });
        agents.read_with(cx, |a, _| {
            assert_eq!(
                a.prompt().unwrap(),
                format!(
                    "Connect to my puppyone project \"Docs\" by following https://api.puppyone.ai/agent/{}",
                    agents::UNMADE
                )
            );
            assert_eq!(a.invite_phase(), InvitePhase::Give);
        });
        assert!(server.secrets().is_empty());
        cx.write_to_clipboard(ClipboardItem::new_string("mine".into()));
        *server.link_failure.lock().unwrap() = Some(Error::Unavailable);
        agents.update(cx, |a, cx| a.copy_invite(cx));
        cx.run_until_parked();
        agents.read_with(cx, |a, _| {
            assert_eq!(a.copy, CopyStatus::Failed);
            assert_eq!(a.invite_phase(), InvitePhase::Give);
            assert!(!a.waiting() && a.made.is_none());
        });
        assert_eq!(
            cx.read_from_clipboard().and_then(|c| c.text()).as_deref(),
            Some("mine")
        );
        agents.update(cx, |a, cx| a.copy_invite(cx));
        cx.run_until_parked();
        agents.read_with(cx, |a, _| {
            assert_eq!(a.copy, CopyStatus::Copied);
            assert_eq!(a.invite_phase(), InvitePhase::Waiting);
        });
        agents.update(cx, |a, cx| a.copy_invite(cx));
        cx.run_until_parked();
        let secrets = server.secrets();
        assert_eq!(secrets.len(), 3);
        assert!(secrets[0] != secrets[1] && secrets[1] != secrets[2]);
        // Not the owner: told so, nothing copied, the Header not waiting.
        let (refusing, invite) = setup(cx);
        cx.write_to_clipboard(ClipboardItem::new_string("mine".into()));
        *refusing.link_failure.lock().unwrap() = Some(Error::Status(403));
        invite.update(cx, |a, cx| {
            a.set_dialog_open(true, cx);
            a.open(Opener::Invite, cx);
            a.copy_invite(cx)
        });
        cx.run_until_parked();
        invite.read_with(cx, |a, _| {
            assert_eq!(a.copy, CopyStatus::NotOwner);
            assert!(!a.waiting());
            assert_eq!(a.invite_phase(), InvitePhase::Give);
        });
        assert_eq!(
            cx.read_from_clipboard().and_then(|c| c.text()).as_deref(),
            Some("mine")
        );
    }

    fn request(id: &str) -> Value {
        json!({"id": id, "name": "Codex", "admission": "sign_in",
            "requested_at": "2026-10-30T12:00:00Z", "expires_at": "2026-10-30T12:10:00Z"})
    }
    fn asking(id: &str) -> Value {
        json!([request(id)])
    }
    fn phase(agents: &Entity<CloudAgents>, cx: &mut TestAppContext) -> InvitePhase {
        agents.read_with(cx, |a, _| a.invite_phase())
    }
    fn next_poll(cx: &mut TestAppContext) {
        cx.executor().advance_clock(WAITING_REFRESH);
        cx.run_until_parked();
    }

    /// Copying is not the end of it: the message is out, the invite waits
    /// for the Agent with the time it has left, and only the Agent coming
    /// in ends it, on that Agent.
    #[gpui::test]
    fn copying_an_invite_waits_for_a_newcomer(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        agents.update(cx, |a, cx| {
            a.set_dialog_open(true, cx);
            a.open(Opener::Invite, cx);
            a.copy_invite(cx)
        });
        cx.run_until_parked();
        assert_eq!(
            cx.read_from_clipboard().and_then(|c| c.text()).as_deref(),
            Some(
                "Connect to my puppyone project \"Docs\" by following https://api.puppyone.ai/agent/x"
            )
        );
        agents.read_with(cx, |a, _| {
            assert_eq!(a.copy, CopyStatus::Copied);
            assert!(a.waiting() && a.fresh_copy);
            assert_eq!(a.invite_phase(), InvitePhase::Waiting);
            assert_eq!(a.remaining_secs(), INVITE_WAIT.as_secs());
            // The link made, shown without its scheme.
            assert_eq!(a.made.as_deref(), Some("https://api.puppyone.ai/agent/x"));
            assert_eq!(
                a.prompt_parts().map(|(_, link)| link).as_deref(),
                Some("api.puppyone.ai/agent/x")
            );
        });
        // "Copied" gives way to "Copy again"; the same Agents do not end
        // the wait.
        next_poll(cx);
        agents.read_with(cx, |a, _| assert!(!a.fresh_copy && a.waiting()));
        assert_eq!(phase(&agents, cx), InvitePhase::Waiting);
        // An Agent asking to join is answered in the invite.
        *server.pending.lock().unwrap() = Some(asking("r1"));
        next_poll(cx);
        assert_eq!(phase(&agents, cx), InvitePhase::Knocking);
        agents.read_with(cx, |a, _| assert!(!a.waiting()));
        // Let in, it is the one the invite ends on.
        *server.pending.lock().unwrap() = None;
        *server.connections.lock().unwrap() = json!([agent("c1"), agent("c2")]);
        next_poll(cx);
        assert_eq!(phase(&agents, cx), InvitePhase::Joined);
        agents.read_with(cx, |a, _| assert_eq!(a.joined().unwrap().agent.id, "c2"));
        // Another starts over from what to copy.
        agents.update(cx, |a, cx| a.reset_invite(cx));
        agents.read_with(cx, |a, _| {
            assert_eq!(a.invite_phase(), InvitePhase::Give);
            assert_eq!((a.copy, a.made.as_deref()), (CopyStatus::Idle, None));
        });
    }

    /// The dialog closed while the message is out: it keeps waiting, and an
    /// Agent let in from the Header leaves the invite to start over.
    #[gpui::test]
    fn a_message_out_waits_with_the_dialog_closed(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        agents.update(cx, |a, cx| {
            a.set_dialog_open(true, cx);
            a.open(Opener::Invite, cx);
            a.copy_invite(cx)
        });
        cx.run_until_parked();
        agents.update(cx, |a, cx| a.set_dialog_open(false, cx));
        agents.read_with(cx, |a, _| {
            assert!(!a.invite_open && a.waiting());
            assert_eq!(a.copy, CopyStatus::Copied);
        });
        // Opened again, it is where it was.
        agents.update(cx, |a, cx| {
            a.set_dialog_open(true, cx);
            a.open(Opener::Invite, cx)
        });
        assert_eq!(phase(&agents, cx), InvitePhase::Waiting);
        agents.update(cx, |a, cx| a.set_dialog_open(false, cx));
        *server.connections.lock().unwrap() = json!([agent("c1"), agent("c2")]);
        next_poll(cx);
        agents.read_with(cx, |a, _| {
            assert!(!a.waiting());
            assert_eq!(a.invite_phase(), InvitePhase::Give);
            assert_eq!((a.copy, a.made.as_deref()), (CopyStatus::Idle, None));
        });
    }

    /// Turned away, the invite starts over and says so; a message nobody
    /// answers lapses after ten minutes.
    #[gpui::test]
    fn a_turned_away_or_unanswered_message_starts_over(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        agents.update(cx, |a, cx| {
            a.set_dialog_open(true, cx);
            a.open(Opener::Invite, cx);
            a.copy_invite(cx)
        });
        cx.run_until_parked();
        *server.pending.lock().unwrap() = Some(asking("r1"));
        next_poll(cx);
        assert_eq!(phase(&agents, cx), InvitePhase::Knocking);
        *server.pending.lock().unwrap() = None;
        agents.update(cx, |a, cx| a.decide("r1", false, cx));
        cx.run_until_parked();
        agents.read_with(cx, |a, _| {
            assert_eq!(a.invite_phase(), InvitePhase::Give);
            assert_eq!(a.turned_away.as_deref(), Some("Codex"));
            assert_eq!(a.copy, CopyStatus::Idle);
        });
        // A new message, and nobody comes.
        agents.update(cx, |a, cx| a.copy_invite(cx));
        cx.run_until_parked();
        agents.read_with(cx, |a, _| assert!(a.turned_away.is_none()));
        cx.executor().advance_clock(INVITE_WAIT);
        cx.run_until_parked();
        agents.read_with(cx, |a, _| assert!(!a.waiting()));
        assert_eq!(phase(&agents, cx), InvitePhase::Lapsed);
        // Closed, it starts over next time.
        agents.update(cx, |a, cx| a.set_dialog_open(false, cx));
        assert_eq!(phase(&agents, cx), InvitePhase::Give);
    }

    #[gpui::test]
    fn the_dialog_opens_on_inviting_only_while_nobody_is_here(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        agents.update(cx, |a, cx| a.open(Opener::More, cx));
        agents.read_with(cx, |a, _| assert!(!a.invite_open));
        // The roster's seat turns the dialog to the invite.
        agents.update(cx, |a, cx| a.start_invite(cx));
        agents.read_with(cx, |a, _| assert!(a.invite_open));
        *server.connections.lock().unwrap() = json!([]);
        agents.update(cx, |a, cx| a.refresh(cx));
        cx.run_until_parked();
        agents.update(cx, |a, cx| a.open(Opener::More, cx));
        agents.read_with(cx, |a, _| {
            assert!(a.invite_open);
            // Before Copy, the link is shown as not made yet.
            assert_eq!(
                a.prompt().as_deref(),
                Some("Connect to my puppyone project \"Docs\" by following https://api.puppyone.ai/agent/••••••")
            );
            assert_eq!(
                a.prompt_parts(),
                Some((
                    "Connect to my puppyone project \"Docs\" by following ".into(),
                    "api.puppyone.ai/agent/…".into()
                ))
            );
        });
    }

    #[gpui::test]
    fn removing_asks_once_on_the_tile_and_tells_the_header(cx: &mut TestAppContext) {
        let (server, agents) = setup(cx);
        // A removal that does not go through says so and keeps the Agent.
        *server.refuse_changes.lock().unwrap() = true;
        agents.update(cx, |a, cx| {
            a.confirm_remove(Some("c1".into()), cx);
            a.remove("c1", cx)
        });
        cx.run_until_parked();
        agents.read_with(cx, |a, _| {
            assert!(a.change_failed && a.removing.is_none() && a.confirming.is_none());
            assert_eq!(a.agents.len(), 1);
        });
        *server.refuse_changes.lock().unwrap() = false;
        server.calls.lock().unwrap().clear();
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
