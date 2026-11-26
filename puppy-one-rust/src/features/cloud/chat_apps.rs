//! A hosted Project's Agent in Telegram, Slack and WeCom chats, kept for the
//! Agents dialog and the Header ("Add the Agent to a Chat", puppy-issues
//! `document/puppy-one-rust/cloud/projects/chat-apps.md`). It shares the
//! Agents' scope: another Project, account, sign-in or host starts over.
//!
//! Adding is one rule for three apps: put it in the chat over there, the
//! chat knocks, and a manager lets it in here. Each wait lasts ten minutes
//! and is asked about every three seconds while it is on.
use crate::{
    features::cloud::account,
    workspace::cloud::{
        chat_apps::{Change, Chat, Chats, Client, Connection, Link, Platform, Started, WhoCanAsk},
        services::{self, Error},
    },
};
use gpui::*;
use std::{collections::HashSet, sync::Arc, time::Duration};

const REFRESH: Duration = Duration::from_secs(10);
/// While a chat may knock, or the dialog is open, it appears about at once.
const WAITING_REFRESH: Duration = Duration::from_secs(3);
/// A link and its code last ten minutes on the server.
const WAIT: Duration = Duration::from_secs(10 * 60);
pub const NAME_MAX: usize = 64;

/// Where adding stands.
#[derive(Clone, Debug, PartialEq)]
pub enum Stage {
    /// The first step's actions; nothing sent yet.
    Add,
    /// Slack's browser install is under way.
    Installing,
    /// WeCom's ID and secret were sent; the bot is connecting.
    Connecting,
    /// The link or code is out; the chat may knock.
    Waiting,
    Knocked(Chat),
    In(Chat),
    /// Ten minutes passed without a chat.
    Lapsed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FlowError {
    Failed,
    WeComRejected,
    /// Another process or place connected the same bot; one bot, one place.
    WeComElsewhere,
    /// The bot belongs to another space.
    WeComTaken,
    SlackNotAdded,
    NotManager,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AddFlow {
    pub platform: Platform,
    pub stage: Stage,
    pub started: Option<Started>,
    /// The WeCom bot or Slack workspace this wait belongs to.
    pub connection: Option<Connection>,
    /// The Telegram links were opened at least once.
    pub opened: bool,
    pub busy: bool,
    pub error: Option<FlowError>,
    /// The chat a manager just turned away.
    pub turned_away: Option<String>,
    deadline_ms: i64,
}
impl AddFlow {
    fn new(platform: Platform) -> Self {
        Self {
            platform,
            stage: Stage::Add,
            started: None,
            connection: None,
            opened: false,
            busy: false,
            error: None,
            turned_away: None,
            deadline_ms: 0,
        }
    }
    /// Steps on the page: Telegram 2; Slack 3 the first time, 2 once this
    /// person's workspace is in; WeCom 3.
    pub fn steps(&self, slack_ready: bool) -> usize {
        match self.platform {
            Platform::Telegram => 2,
            Platform::Slack if slack_ready => 2,
            Platform::Slack | Platform::Wecom => 3,
        }
    }
    pub fn waiting(&self) -> bool {
        matches!(
            self.stage,
            Stage::Installing | Stage::Connecting | Stage::Waiting
        )
    }
    pub fn remaining_secs(&self) -> u64 {
        ((self.deadline_ms - crate::clock::now_ms()).max(0) / 1000) as u64
    }
}

struct Scope {
    key: String,
    project: String,
    client: Client,
    fixture: bool,
}

pub struct CloudChats {
    scope: Option<Scope>,
    pub chats: Vec<Chat>,
    pub connections: Vec<Connection>,
    pub platforms: Vec<Platform>,
    pub mentions: std::collections::HashMap<Platform, String>,
    pub can_manage: bool,
    pub known: bool,
    latest: u64,
    visible: bool,
    dialog_open: bool,
    poll: Option<Task<()>>,
    ticker: Option<Task<()>>,
    pub flow: Option<AddFlow>,
    /// The chat whose management view is open.
    pub managing: Option<String>,
    pub confirming_remove: bool,
    /// Requests and changes on their way; each control waits for its answer.
    pub pending: HashSet<String>,
    pub change_failed: bool,
    /// Telegram opens once its first link exists: in a group, or alone.
    pending_open: Option<bool>,
}

impl CloudChats {
    pub fn new() -> Self {
        Self {
            scope: None,
            chats: vec![],
            connections: vec![],
            platforms: vec![],
            mentions: Default::default(),
            can_manage: false,
            known: false,
            latest: 0,
            visible: true,
            dialog_open: false,
            poll: None,
            ticker: None,
            flow: None,
            managing: None,
            confirming_remove: false,
            pending: HashSet::new(),
            change_failed: false,
            pending_open: None,
        }
    }

    // --- scope ------------------------------------------------------------
    /// The same target the Agents follow (`CloudAgents::sync`).
    pub fn sync(&mut self, project: Option<&str>, dialog_open: bool, cx: &mut Context<Self>) {
        if self.scope.as_ref().is_some_and(|s| s.fixture) {
            self.set_dialog_open(dialog_open, cx);
            return;
        }
        let target = project.and_then(|project| {
            let (broker, binding) = account::broker_and_binding(cx)?;
            let key = format!(
                "{}\n{}\n{}\n{project}",
                binding.environment.api(),
                binding.user,
                binding.epoch
            );
            Some((key, project.to_owned(), broker, binding))
        });
        let key = target.as_ref().map(|t| t.0.clone());
        if key.as_deref() != self.scope.as_ref().map(|s| s.key.as_str()) {
            let scope = target.map(|(key, project, broker, binding)| Scope {
                key,
                project,
                fixture: false,
                client: Client::new(Arc::new(services::BrokerTransport {
                    broker,
                    binding,
                    cancel: Default::default(),
                })),
            });
            self.attach(scope, cx);
        }
        self.set_dialog_open(dialog_open, cx);
    }
    #[cfg(test)]
    pub fn attach_client(&mut self, project: &str, client: Client, cx: &mut Context<Self>) {
        self.attach(
            Some(Scope {
                key: format!("fixture\n{project}"),
                project: project.into(),
                client,
                fixture: true,
            }),
            cx,
        );
    }
    fn attach(&mut self, scope: Option<Scope>, cx: &mut Context<Self>) {
        let (dialog_open, visible) = (self.dialog_open, self.visible);
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
    pub fn scope_key(&self) -> Option<&str> {
        self.scope.as_ref().map(|s| s.key.as_str())
    }
    /// Apps are on in this deployment and this person may see the chats.
    pub fn available(&self) -> bool {
        !self.platforms.is_empty()
    }
    fn set_dialog_open(&mut self, open: bool, cx: &mut Context<Self>) {
        if self.dialog_open == open {
            return;
        }
        let fast = self.fast();
        self.dialog_open = open;
        if !open {
            // The dialog's own state goes with it; a chat may still knock.
            self.managing = None;
            self.confirming_remove = false;
            self.change_failed = false;
            if self.flow.as_ref().is_some_and(|f| !f.waiting()) {
                self.flow = None;
            }
        }
        if fast != self.fast() {
            self.schedule(cx);
        }
        self.tick(cx);
        cx.notify();
    }
    pub fn set_visible(&mut self, visible: bool, cx: &mut Context<Self>) {
        if self.visible != visible {
            self.visible = visible;
            if visible {
                self.refresh(cx);
            }
        }
    }
    fn fast(&self) -> bool {
        self.dialog_open || self.flow.as_ref().is_some_and(AddFlow::waiting)
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
                let alive = this.update(cx, |s, cx| {
                    if s.visible {
                        s.refresh(cx);
                    }
                });
                if alive.is_err() {
                    break;
                }
            }
        }));
    }
    /// The countdown redraws each second while a wait is on screen.
    fn tick(&mut self, cx: &mut Context<Self>) {
        let on = self.dialog_open && self.flow.as_ref().is_some_and(AddFlow::waiting);
        if !on {
            self.ticker = None;
            return;
        }
        if self.ticker.is_none() {
            self.ticker = Some(cx.spawn(async move |this, cx| {
                loop {
                    cx.background_executor().timer(Duration::from_secs(1)).await;
                    if this.update(cx, |s, cx| s.expire(cx)).is_err() {
                        break;
                    }
                }
            }));
        }
    }
    fn expire(&mut self, cx: &mut Context<Self>) {
        if let Some(flow) = &mut self.flow
            && flow.waiting()
            && flow.deadline_ms > 0
            && crate::clock::now_ms() >= flow.deadline_ms
        {
            flow.stage = Stage::Lapsed;
            self.end_wait(cx);
        }
        cx.notify();
    }
    fn end_wait(&mut self, cx: &mut Context<Self>) {
        self.ticker = None;
        self.schedule(cx);
    }

    // --- reading ----------------------------------------------------------
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        let Some(scope) = &self.scope else {
            return;
        };
        self.latest += 1;
        let request = self.latest;
        let (client, project) = (scope.client.clone(), scope.project.clone());
        let link = self
            .flow
            .as_ref()
            .filter(|f| f.waiting())
            .and_then(|f| f.started.as_ref())
            .map(|s| s.link.id.clone());
        let task = cx.background_spawn(async move {
            let chats = client.chats(&project);
            let link = link.map(|id| client.link(&project, &id));
            (chats, link)
        });
        cx.spawn(async move |this, cx| {
            let (chats, link) = task.await;
            let _ = this.update(cx, |s, cx| {
                if request == s.latest {
                    s.receive(chats, link, cx);
                }
            });
        })
        .detach();
    }
    fn receive(
        &mut self,
        chats: services::Result<Chats>,
        link: Option<services::Result<Link>>,
        cx: &mut Context<Self>,
    ) {
        match chats {
            Ok(chats) => {
                self.can_manage = chats.can_manage;
                self.platforms = chats.platforms;
                self.mentions = chats.mentions;
                self.connections = chats.connections;
                self.chats = chats.conversations;
                self.known = true;
                let ids: HashSet<&str> = self.chats.iter().map(|c| c.id.as_str()).collect();
                self.pending
                    .retain(|id| !id.starts_with("decide:") || ids.contains(&id[7..]));
                if self
                    .managing
                    .as_ref()
                    .is_some_and(|id| !ids.contains(id.as_str()))
                {
                    self.managing = None;
                    self.confirming_remove = false;
                }
            }
            Err(Error::Status(403)) => {
                self.chats.clear();
                self.connections.clear();
                self.can_manage = false;
                self.known = true;
                self.poll = None;
            }
            Err(_) => {}
        }
        if let Some(Ok(link)) = link {
            self.follow(link, cx);
        }
        self.follow_connection(cx);
        cx.notify();
    }
    /// The wait moves on with what the server says about its link.
    fn follow(&mut self, link: Link, cx: &mut Context<Self>) {
        let Some(flow) = &mut self.flow else {
            return;
        };
        match (link.state.as_str(), &flow.stage) {
            ("knocked", Stage::Waiting) => {
                if let Some(chat) = link.conversation {
                    flow.stage = Stage::Knocked(chat);
                    self.end_wait(cx);
                }
            }
            ("done", Stage::Installing) => {
                // Slack is in this workspace now: wait in it for the channel.
                flow.connection = link.connection;
                let connection = flow.connection.as_ref().map(|c| c.id.clone());
                self.begin(connection, cx);
            }
            ("expired", Stage::Waiting | Stage::Installing) => {
                if flow.stage == Stage::Installing {
                    flow.error = Some(FlowError::SlackNotAdded);
                }
                flow.stage = Stage::Lapsed;
                self.end_wait(cx);
            }
            _ => {}
        }
    }
    /// WeCom: the bot connects in the gateway; the wait for a group starts once it has.
    fn follow_connection(&mut self, cx: &mut Context<Self>) {
        let Some(flow) = &mut self.flow else {
            return;
        };
        // While connecting, and while the code is out: a bot that drops out
        // sends the person back to connect it, saying why.
        let waiting_on_bot = flow.platform == Platform::Wecom && flow.stage == Stage::Waiting;
        if flow.stage != Stage::Connecting && !waiting_on_bot {
            return;
        }
        let Some(id) = flow.connection.as_ref().map(|c| c.id.clone()) else {
            return;
        };
        let Some(now) = self.connections.iter().find(|c| c.id == id).cloned() else {
            return;
        };
        match now.status.as_str() {
            "active" if waiting_on_bot => {}
            "active" => {
                flow.connection = Some(now);
                self.begin(Some(id), cx);
            }
            "failed" => {
                flow.stage = Stage::Add;
                flow.error = Some(FlowError::WeComRejected);
                self.end_wait(cx);
            }
            "displaced" => {
                flow.stage = Stage::Add;
                flow.error = Some(FlowError::WeComElsewhere);
                self.end_wait(cx);
            }
            _ => {}
        }
    }

    // --- what the Header and roster show ----------------------------------
    pub fn knocking(&self) -> impl Iterator<Item = &Chat> {
        self.chats.iter().filter(|c| c.asking())
    }
    pub fn active(&self) -> impl Iterator<Item = &Chat> {
        self.chats.iter().filter(|c| !c.asking())
    }
    pub fn working(&self) -> impl Iterator<Item = &Chat> {
        self.active().filter(|c| c.working)
    }
    pub fn chat(&self, id: &str) -> Option<&Chat> {
        self.chats.iter().find(|c| c.id == id)
    }
    /// The installed Slack workspace this person can add channels from.
    pub fn slack_ready(&self) -> Option<&Connection> {
        self.connections
            .iter()
            .find(|c| c.platform == Platform::Slack && c.status == "active" && c.linked_me)
    }
    /// How people call it in `platform` (Telegram: the bot's username).
    pub fn mention(&self, platform: Platform) -> &str {
        self.mentions
            .get(&platform)
            .map(String::as_str)
            .unwrap_or("@PuppyOne")
    }
    pub fn wecom_bot(&self) -> Option<&Connection> {
        self.connections
            .iter()
            .find(|c| c.platform == Platform::Wecom && c.status == "active")
    }

    // --- adding -----------------------------------------------------------
    pub fn open_add(&mut self, cx: &mut Context<Self>) {
        let platform = self
            .platforms
            .first()
            .copied()
            .unwrap_or(Platform::Telegram);
        self.managing = None;
        self.flow = Some(AddFlow::new(platform));
        cx.notify();
    }
    pub fn close_add(&mut self, cx: &mut Context<Self>) {
        self.flow = None;
        self.end_wait(cx);
        cx.notify();
    }
    /// The app chosen at the top; a wait in another app ends.
    pub fn choose(&mut self, platform: Platform, cx: &mut Context<Self>) {
        if self.flow.as_ref().is_some_and(|f| f.platform == platform) {
            return;
        }
        self.flow = Some(AddFlow::new(platform));
        self.end_wait(cx);
        cx.notify();
    }
    /// Starts (or restarts) the wait: a new link or code, ten minutes.
    fn begin(&mut self, connection: Option<String>, cx: &mut Context<Self>) {
        let (Some(scope), Some(flow)) = (&self.scope, &mut self.flow) else {
            return;
        };
        let platform = flow.platform;
        flow.busy = true;
        flow.error = None;
        let (client, project) = (scope.client.clone(), scope.project.clone());
        let task =
            cx.background_spawn(
                async move { client.start(&project, platform, connection.as_deref()) },
            );
        cx.spawn(async move |this, cx| {
            let started = task.await;
            let _ = this.update(cx, |s, cx| s.started(platform, started, cx));
        })
        .detach();
        cx.notify();
    }
    fn started(
        &mut self,
        platform: Platform,
        started: services::Result<Started>,
        cx: &mut Context<Self>,
    ) {
        let open_telegram = self.pending_open.take();
        let Some(flow) = self.flow.as_mut().filter(|f| f.platform == platform) else {
            return;
        };
        flow.busy = false;
        if let (
            Some(group),
            Ok(Started {
                links: Some(links), ..
            }),
        ) = (open_telegram, &started)
        {
            let url = if group { &links.group } else { &links.dm };
            if crate::workspace::cloud::chat_apps::trusted_link(url) {
                cx.open_url(url);
            }
        }
        match started {
            Ok(started) => {
                flow.stage = if started.install_url.is_some() {
                    Stage::Installing
                } else {
                    Stage::Waiting
                };
                flow.deadline_ms = crate::clock::now_ms() + WAIT.as_millis() as i64;
                flow.turned_away = None;
                let open = started.install_url.clone();
                flow.started = Some(started);
                if let Some(url) =
                    open.filter(|u| crate::workspace::cloud::chat_apps::trusted_link(u))
                {
                    cx.open_url(&url);
                }
            }
            Err(Error::Status(403)) => flow.error = Some(FlowError::NotManager),
            // WeCom: the bot is no longer connected here.
            Err(Error::Status(409)) if flow.platform == Platform::Wecom => {
                flow.stage = Stage::Add;
                flow.error = Some(FlowError::WeComElsewhere);
            }
            Err(_) => flow.error = Some(FlowError::Failed),
        }
        self.schedule(cx);
        self.tick(cx);
        cx.notify();
    }
    /// Telegram: "Add to a group" / "Chat with it yourself" open Telegram on
    /// a link that carries the code; the first press makes the link.
    pub fn telegram_open(&mut self, group: bool, cx: &mut Context<Self>) {
        let Some(flow) = &mut self.flow else {
            return;
        };
        if let Some(links) = flow.started.as_ref().and_then(|s| s.links.clone())
            && flow.stage == Stage::Waiting
        {
            let url = if group { links.group } else { links.dm };
            flow.opened = true;
            if crate::workspace::cloud::chat_apps::trusted_link(&url) {
                cx.open_url(&url);
            }
            cx.notify();
            return;
        }
        flow.opened = true;
        self.pending_open = Some(group);
        self.begin(None, cx);
    }
    /// Slack: install in a workspace, or wait in the one already in.
    pub fn slack_add(&mut self, cx: &mut Context<Self>) {
        let ready = self.slack_ready().map(|c| (c.id.clone(), c.clone()));
        if let Some(flow) = &mut self.flow {
            flow.connection = ready.as_ref().map(|(_, c)| c.clone());
        }
        self.begin(ready.map(|(id, _)| id), cx);
    }
    /// WeCom: the bot's ID and secret, then the six-digit code once it connects.
    pub fn wecom_connect(&mut self, bot_id: String, secret: String, cx: &mut Context<Self>) {
        let (Some(scope), Some(flow)) = (&self.scope, &mut self.flow) else {
            return;
        };
        if bot_id.trim().is_empty() || secret.trim().is_empty() {
            return;
        }
        flow.busy = true;
        flow.error = None;
        let (client, project) = (scope.client.clone(), scope.project.clone());
        let task = cx.background_spawn(async move { client.connect(&project, &bot_id, &secret) });
        cx.spawn(async move |this, cx| {
            let connected = task.await;
            let _ = this.update(cx, |s, cx| {
                let Some(flow) = s.flow.as_mut().filter(|f| f.platform == Platform::Wecom) else {
                    return;
                };
                flow.busy = false;
                match connected {
                    Ok(connection) => {
                        flow.stage = Stage::Connecting;
                        flow.deadline_ms = crate::clock::now_ms() + WAIT.as_millis() as i64;
                        flow.connection = Some(connection);
                        s.schedule(cx);
                        s.tick(cx);
                    }
                    Err(Error::Status(403)) => flow.error = Some(FlowError::NotManager),
                    Err(Error::Status(409)) => flow.error = Some(FlowError::WeComTaken),
                    Err(_) => flow.error = Some(FlowError::Failed),
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    /// WeCom with a bot already connected: straight to the code.
    pub fn wecom_use_bot(&mut self, cx: &mut Context<Self>) {
        let bot = self.wecom_bot().cloned();
        if let (Some(flow), Some(bot)) = (&mut self.flow, bot) {
            let id = bot.id.clone();
            flow.connection = Some(bot);
            self.begin(Some(id), cx);
        }
    }
    /// "Get a new link" / "Keep waiting": the same first step again.
    pub fn renew(&mut self, cx: &mut Context<Self>) {
        let connection = self
            .flow
            .as_ref()
            .and_then(|f| f.connection.as_ref())
            .map(|c| c.id.clone());
        if let Some(flow) = &mut self.flow
            && flow.platform == Platform::Slack
            && connection.is_none()
        {
            flow.stage = Stage::Add;
            cx.notify();
            return;
        }
        self.begin(connection, cx);
    }
    /// "Add another chat": back to the start in the same app.
    pub fn add_another(&mut self, cx: &mut Context<Self>) {
        if let Some(flow) = &self.flow {
            self.flow = Some(AddFlow::new(flow.platform));
        }
        cx.notify();
    }

    // --- answering a knock and managing a chat ----------------------------
    pub fn decide(&mut self, chat: &str, allow: bool, cx: &mut Context<Self>) {
        let Some(scope) = &self.scope else {
            return;
        };
        let key = format!("decide:{chat}");
        if !self.pending.insert(key.clone()) {
            return;
        }
        self.change_failed = false;
        let (client, project, id) = (scope.client.clone(), scope.project.clone(), chat.to_owned());
        let task = cx.background_spawn(async move { client.decide(&project, &id, allow) });
        let name = self.chat(chat).map(|c| c.display_name.clone());
        cx.spawn(async move |this, cx| {
            let decided = task.await;
            let _ = this.update(cx, |s, cx| {
                s.pending.remove(&key);
                match decided {
                    Ok(chat) => {
                        s.upsert(chat.clone());
                        if let Some(flow) = &mut s.flow
                            && matches!(&flow.stage, Stage::Knocked(k) if k.id == chat.id)
                        {
                            if allow {
                                flow.stage = Stage::In(chat.clone());
                            } else {
                                *flow = AddFlow::new(flow.platform);
                                flow.turned_away = name;
                            }
                        }
                        if !allow {
                            s.chats.retain(|c| c.id != chat.id);
                        }
                    }
                    Err(_) => s.change_failed = true,
                }
                s.refresh(cx);
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    pub fn manage(&mut self, chat: Option<String>, cx: &mut Context<Self>) {
        self.managing = chat;
        self.flow = None;
        self.confirming_remove = false;
        self.change_failed = false;
        cx.notify();
    }
    pub fn managed(&self) -> Option<&Chat> {
        self.managing.as_deref().and_then(|id| self.chat(id))
    }
    fn upsert(&mut self, chat: Chat) {
        match self.chats.iter_mut().find(|c| c.id == chat.id) {
            Some(slot) => *slot = chat,
            None => self.chats.push(chat),
        }
    }
    /// One setting or the name; the row waits for the server, then shows it.
    pub fn change(&mut self, chat: &str, change: Change, cx: &mut Context<Self>) {
        let Some(scope) = &self.scope else {
            return;
        };
        if let Some(name) = &change.display_name {
            let name = name.trim();
            if name.is_empty() || name.chars().count() > NAME_MAX {
                return;
            }
        }
        let key = format!("change:{chat}");
        if !self.pending.insert(key.clone()) {
            return;
        }
        self.change_failed = false;
        let (client, project, id) = (scope.client.clone(), scope.project.clone(), chat.to_owned());
        let task = cx.background_spawn(async move { client.change(&project, &id, &change) });
        cx.spawn(async move |this, cx| {
            let changed = task.await;
            let _ = this.update(cx, |s, cx| {
                s.pending.remove(&key);
                match changed {
                    Ok(chat) => s.upsert(chat),
                    Err(_) => s.change_failed = true,
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    pub fn set_who_can_ask(&mut self, chat: &str, who: WhoCanAsk, cx: &mut Context<Self>) {
        self.change(
            chat,
            Change {
                who_can_ask: Some(who),
                ..Default::default()
            },
            cx,
        );
    }
    pub fn take_over(&mut self, chat: &str, cx: &mut Context<Self>) {
        self.act(chat, "owner", cx, |client, project, id| {
            client.take_over(project, id).map(Some)
        });
    }
    pub fn confirm_remove(&mut self, confirming: bool, cx: &mut Context<Self>) {
        self.confirming_remove = confirming;
        cx.notify();
    }
    /// Two presses: the second leaves the chat and closes its view.
    pub fn remove(&mut self, chat: &str, cx: &mut Context<Self>) {
        if !self.confirming_remove {
            self.confirm_remove(true, cx);
            return;
        }
        self.act(chat, "remove", cx, |client, project, id| {
            client.remove(project, id).map(|_| None)
        });
    }
    fn act(
        &mut self,
        chat: &str,
        what: &str,
        cx: &mut Context<Self>,
        call: impl FnOnce(&Client, &str, &str) -> services::Result<Option<Chat>> + Send + 'static,
    ) {
        let Some(scope) = &self.scope else {
            return;
        };
        let key = format!("{what}:{chat}");
        if !self.pending.insert(key.clone()) {
            return;
        }
        self.change_failed = false;
        let (client, project, id) = (scope.client.clone(), scope.project.clone(), chat.to_owned());
        let task = cx.background_spawn(async move { call(&client, &project, &id) });
        let removed = what == "remove";
        let target = chat.to_owned();
        cx.spawn(async move |this, cx| {
            let done = task.await;
            let _ = this.update(cx, |s, cx| {
                s.pending.remove(&key);
                match done {
                    Ok(Some(chat)) => s.upsert(chat),
                    Ok(None) if removed => {
                        s.chats.retain(|c| c.id != target);
                        s.managing = None;
                        s.confirming_remove = false;
                    }
                    Ok(None) => {}
                    Err(_) => s.change_failed = true,
                }
                s.refresh(cx);
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
}

impl Default for CloudChats {
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

    /// A Cloud whose answers the test sets: the list, and each link's state.
    #[derive(Default)]
    struct Server {
        connections: Mutex<Value>,
        link: Mutex<Value>,
        started: Mutex<Vec<Value>>,
        patches: Mutex<Vec<Value>>,
    }
    impl Transport for Server {
        fn request(&self, request: ApiRequest) -> services::Result<Value> {
            let path = request.path.as_str();
            let body = request.body.clone().unwrap_or(Value::Null);
            if path.ends_with("/chat-apps") {
                return Ok(
                    json!({"can_manage": true, "platforms": ["telegram", "slack", "wecom"],
                    "conversations": [], "connections": self.connections.lock().unwrap().clone()}),
                );
            }
            if path.ends_with("/links") {
                self.started.lock().unwrap().push(body.clone());
                let mut link = self.link.lock().unwrap().clone();
                link["state"] = "waiting".into();
                let started = match body["platform"].as_str() {
                    Some("slack") if body.get("connection_id").is_none() => {
                        let mut install = link.clone();
                        install["purpose"] = "slack_install".into();
                        json!({"link": install,
                               "install_url": "https://slack.com/oauth/v2/authorize?x"})
                    }
                    Some("slack") => json!({"link": link, "invite": "/invite @PuppyOne"}),
                    Some("wecom") => json!({"link": link, "code": "482731"}),
                    _ => json!({"link": link, "links": {"group": "https://t.me/b?startgroup=x",
                                                        "dm": "https://t.me/b?start=x"}}),
                };
                return Ok(started);
            }
            if path.contains("/links/") {
                return Ok(self.link.lock().unwrap().clone());
            }
            if path.ends_with("/connections") {
                return Ok(
                    json!({"id": "bot", "platform": "wecom", "display_name": "Bot",
                    "status": "pending"}),
                );
            }
            if request.method == reqwest::Method::PATCH {
                self.patches.lock().unwrap().push(body);
            }
            Ok(Value::Null)
        }
    }
    fn link(state: &str, platform: &str) -> Value {
        json!({"id": "l1", "purpose": "knock", "platform": platform, "state": state,
               "expires_at": "2026-11-25T12:10:00Z"})
    }
    fn setup(cx: &mut TestAppContext) -> (Arc<Server>, Entity<CloudChats>) {
        let server = Arc::new(Server::default());
        *server.connections.lock().unwrap() = json!([]);
        *server.link.lock().unwrap() = link("waiting", "telegram");
        let chats = cx.new(|_| CloudChats::new());
        let client = Client::new(server.clone());
        chats.update(cx, |c, cx| c.attach_client("p1", client, cx));
        cx.run_until_parked();
        (server, chats)
    }
    fn stage(chats: &Entity<CloudChats>, cx: &mut TestAppContext) -> Stage {
        chats.read_with(cx, |c, _| c.flow.as_ref().unwrap().stage.clone())
    }
    fn poll(chats: &Entity<CloudChats>, cx: &mut TestAppContext) {
        chats.update(cx, |c, cx| c.refresh(cx));
        cx.run_until_parked();
    }

    #[test]
    fn each_app_has_its_own_number_of_steps() {
        let steps = |p, ready| AddFlow::new(p).steps(ready);
        assert_eq!(steps(Platform::Telegram, false), 2);
        assert_eq!(steps(Platform::Slack, false), 3);
        assert_eq!(steps(Platform::Slack, true), 2);
        assert_eq!(steps(Platform::Wecom, false), 3);
    }

    #[gpui::test]
    fn a_telegram_wait_ends_on_the_knock_or_lapses(cx: &mut TestAppContext) {
        let (server, chats) = setup(cx);
        chats.update(cx, |c, cx| {
            c.open_add(cx);
            c.telegram_open(true, cx)
        });
        cx.run_until_parked();
        assert_eq!(stage(&chats, cx), Stage::Waiting);
        assert_eq!(
            server.started.lock().unwrap()[0],
            json!({"platform": "telegram"})
        );
        let mut knocked = link("knocked", "telegram");
        knocked["conversation"] = json!({"id": "c1", "platform": "telegram", "chat_kind": "group",
            "display_name": "Design team", "state": "asking", "enabled": true,
            "owner_user_id": "u1", "who_can_ask": "owner"});
        *server.link.lock().unwrap() = knocked;
        poll(&chats, cx);
        assert!(matches!(stage(&chats, cx), Stage::Knocked(c) if c.display_name == "Design team"));
        // A new wait that nobody answers in ten minutes lapses.
        chats.update(cx, |c, cx| c.add_another(cx));
        chats.update(cx, |c, cx| c.telegram_open(false, cx));
        cx.run_until_parked();
        *server.link.lock().unwrap() = link("expired", "telegram");
        poll(&chats, cx);
        assert_eq!(stage(&chats, cx), Stage::Lapsed);
    }

    #[gpui::test]
    fn slack_installs_once_then_waits_for_the_channel(cx: &mut TestAppContext) {
        let (server, chats) = setup(cx);
        chats.update(cx, |c, cx| {
            c.open_add(cx);
            c.choose(Platform::Slack, cx);
            c.slack_add(cx)
        });
        cx.run_until_parked();
        assert_eq!(stage(&chats, cx), Stage::Installing);
        let mut done = link("done", "slack");
        done["connection"] = json!({"id": "T1c", "platform": "slack", "display_name": "Acme",
            "status": "active", "linked_me": true});
        *server.link.lock().unwrap() = done;
        poll(&chats, cx);
        cx.run_until_parked();
        assert_eq!(stage(&chats, cx), Stage::Waiting);
        let started = server.started.lock().unwrap().clone();
        assert_eq!(
            started[1],
            json!({"platform": "slack", "connection_id": "T1c"})
        );
        chats.read_with(cx, |c, _| {
            assert_eq!(
                c.flow
                    .as_ref()
                    .unwrap()
                    .started
                    .as_ref()
                    .unwrap()
                    .invite
                    .as_deref(),
                Some("/invite @PuppyOne")
            )
        });
    }

    #[gpui::test]
    fn wecom_shows_the_code_once_the_bot_connects_and_says_when_refused(cx: &mut TestAppContext) {
        let (server, chats) = setup(cx);
        chats.update(cx, |c, cx| {
            c.open_add(cx);
            c.choose(Platform::Wecom, cx);
            c.wecom_connect("bot".into(), "secret-placeholder".into(), cx)
        });
        cx.run_until_parked();
        assert_eq!(stage(&chats, cx), Stage::Connecting);
        *server.connections.lock().unwrap() =
            json!([{"id": "bot", "platform": "wecom", "display_name": "Bot", "status": "active"}]);
        *server.link.lock().unwrap() = link("waiting", "wecom");
        poll(&chats, cx);
        cx.run_until_parked();
        assert_eq!(stage(&chats, cx), Stage::Waiting);
        chats.read_with(cx, |c, _| {
            assert_eq!(
                c.flow
                    .as_ref()
                    .unwrap()
                    .started
                    .as_ref()
                    .unwrap()
                    .code
                    .as_deref(),
                Some("482731")
            )
        });
        // Another try with a bot WeCom refuses goes back to the first step.
        chats.update(cx, |c, cx| {
            c.add_another(cx);
            c.wecom_connect("bad".into(), "secret-placeholder".into(), cx)
        });
        cx.run_until_parked();
        *server.connections.lock().unwrap() =
            json!([{"id": "bot", "platform": "wecom", "display_name": "Bot", "status": "failed"}]);
        poll(&chats, cx);
        chats.read_with(cx, |c, _| {
            let flow = c.flow.as_ref().unwrap();
            assert_eq!(
                (flow.stage.clone(), flow.error),
                (Stage::Add, Some(FlowError::WeComRejected))
            );
        });
    }

    /// One bot works in one place: when it connects somewhere else, the code
    /// on screen is dead, so the flow goes back to connecting and says why.
    #[gpui::test]
    fn a_wecom_bot_taken_elsewhere_while_waiting_asks_to_connect_again(cx: &mut TestAppContext) {
        let (server, chats) = setup(cx);
        chats.update(cx, |c, cx| {
            c.open_add(cx);
            c.choose(Platform::Wecom, cx);
            c.wecom_connect("bot".into(), "secret-placeholder".into(), cx)
        });
        cx.run_until_parked();
        *server.connections.lock().unwrap() =
            json!([{"id": "bot", "platform": "wecom", "display_name": "Bot", "status": "active"}]);
        *server.link.lock().unwrap() = link("waiting", "wecom");
        poll(&chats, cx);
        cx.run_until_parked();
        assert_eq!(stage(&chats, cx), Stage::Waiting);
        *server.connections.lock().unwrap() = json!([{"id": "bot", "platform": "wecom", "display_name": "Bot", "status": "displaced"}]);
        poll(&chats, cx);
        chats.read_with(cx, |c, _| {
            let flow = c.flow.as_ref().unwrap();
            assert_eq!(
                (flow.stage.clone(), flow.error),
                (Stage::Add, Some(FlowError::WeComElsewhere))
            );
        });
    }

    #[gpui::test]
    fn a_name_over_64_characters_is_not_sent(cx: &mut TestAppContext) {
        let (server, chats) = setup(cx);
        chats.update(cx, |c, cx| {
            let long = Change {
                display_name: Some("x".repeat(65)),
                ..Default::default()
            };
            c.change("c1", long, cx);
            let blank = Change {
                display_name: Some("  ".into()),
                ..Default::default()
            };
            c.change("c1", blank, cx);
        });
        cx.run_until_parked();
        assert!(server.patches.lock().unwrap().is_empty());
    }

    #[gpui::test]
    fn another_project_or_account_starts_over(cx: &mut TestAppContext) {
        let (_, chats) = setup(cx);
        chats.update(cx, |c, cx| c.open_add(cx));
        let other = Client::new(Arc::new(Server::default()));
        chats.update(cx, |c, cx| c.attach_client("p2", other, cx));
        chats.read_with(cx, |c, _| assert!(c.flow.is_none() && c.chats.is_empty()));
    }
}
