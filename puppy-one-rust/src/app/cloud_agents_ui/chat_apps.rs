//! "Add the Agent to a Chat" inside the Agents dialog: a chat is a tile in
//! the roster, a chat knocking is answered where it knocks, "Add to chat"
//! walks the app's own steps (the invite's step layout), and pressing a chat
//! opens its three settings. Interaction contract: puppy-issues
//! `document/puppy-one-rust/cloud/projects/chat-apps.md`.
use super::dialog::TILE_MARK;
use super::invite::{Mark, action, copy_icon};
use super::*;
use crate::features::cloud::{AddFlow, CHAT_NAME_MAX, ChatStage, FlowError};
use crate::ui::components::{
    IconButton, Segment, SegmentedControl, Select, SelectOption, SettingRow, Switch,
};
use crate::ui::form_input::TextInput;
use crate::workspace::cloud::chat_apps::{Change, Chat, Platform, Stopped, WhoCanAsk};

/// Copy as owned text; the glob import's `tr` lends it.
fn tr(key: &str) -> String {
    crate::localization::t(key).to_string()
}

/// Daily limit choices, in Agent minutes; none is no limit.
pub(super) const LIMITS: [Option<u32>; 4] = [Some(30), Some(60), Some(180), None];

/// The text fields the chat views need; made once with the window.
pub struct ChatInputs {
    pub bot_id: Entity<TextInput>,
    pub secret: Entity<TextInput>,
    pub rename: Entity<TextInput>,
    /// The chat whose name is being edited.
    pub renaming: Option<String>,
}
impl ChatInputs {
    pub fn new(window: &mut Window, cx: &mut Context<WindowCloud>) -> Self {
        let bot_id =
            cx.new(|cx| TextInput::new(tr("native.chatApps.botId"), false, 200, window, cx));
        let secret = cx.new(|cx| {
            TextInput::new(tr("native.chatApps.secret"), false, 2000, window, cx).masked(window, cx)
        });
        let rename = cx.new(|cx| {
            let mut input = TextInput::new("", false, CHAT_NAME_MAX, window, cx);
            input.submit_on_enter = true;
            input
        });
        for input in [&bot_id, &secret, &rename] {
            cx.observe(input, |_, _, cx| cx.notify()).detach();
        }
        cx.subscribe_in(&rename, window, |s: &mut WindowCloud, _, event, _, cx| {
            if matches!(event, crate::ui::form_input::InputEvent::Submit) {
                s.save_chat_name(cx);
            }
        })
        .detach();
        Self {
            bot_id,
            secret,
            rename,
            renaming: None,
        }
    }
}

pub(super) fn limit_label(limit: Option<u32>) -> String {
    tr(match limit {
        Some(30) => "native.chatApps.limit30",
        Some(60) => "native.chatApps.limit60",
        Some(180) => "native.chatApps.limit180",
        _ => "native.chatApps.noLimit",
    })
}
pub(super) fn who_label(who: WhoCanAsk) -> String {
    tr(match who {
        WhoCanAsk::Owner => "native.chatApps.onlyMe",
        WhoCanAsk::Project => "native.chatApps.project",
        WhoCanAsk::Anyone => "native.chatApps.anyone",
    })
}
/// The one line under a chat tile's name.
pub(super) fn chat_status(chat: &Chat, now: i64) -> String {
    if chat.stopped_reason == Some(Stopped::RemovedThere) {
        tr("native.chatApps.statusRemoved")
    } else if chat.working {
        tr("native.chatApps.statusWorking")
    } else if !chat.enabled || chat.stopped_reason.is_some() {
        tr("native.chatApps.statusPaused")
    } else if chat.limit_reached() {
        tr("native.chatApps.statusLimit")
    } else {
        chat.last_activity_at
            .as_deref()
            .and_then(|at| relative_time(at, now))
            .unwrap_or_else(|| tr("native.chatApps.noRecent"))
    }
}
/// The fixed line about what it reads there.
pub(super) fn reads_line(chat: &Chat) -> String {
    tr(if !chat.group() {
        "native.chatApps.readsDm"
    } else if chat.platform == Platform::Telegram {
        "native.chatApps.readsTelegram"
    } else {
        "native.chatApps.readsMention"
    })
}
/// The name a knocking chat shows: WeCom cannot read group names.
pub(super) fn knock_name(chat: &Chat) -> String {
    match (&chat.platform, &chat.knock_hint) {
        (Platform::Wecom, Some(code)) => tf(
            "native.chatApps.wecomSent",
            &[("code", code.clone().into())],
        ),
        _ => chat.display_name.clone(),
    }
}
/// At most one banner, most pressing first.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Banner {
    OwnerLeft,
    RemovedThere,
    NoHours,
    Limit,
}
pub(super) fn banner(chat: &Chat) -> Option<Banner> {
    match chat.stopped_reason {
        Some(Stopped::OwnerLeft) => Some(Banner::OwnerLeft),
        Some(Stopped::RemovedThere) => Some(Banner::RemovedThere),
        None if chat.no_hours => Some(Banner::NoHours),
        None if chat.limit_reached() => Some(Banner::Limit),
        None => None,
    }
}

/// The app's mark: a round ground with its glyph.
pub(super) fn platform_mark(platform: Platform, size: f32, t: Theme) -> Div {
    let icon = match platform {
        Platform::Telegram => "send",
        Platform::Slack => "hash",
        Platform::Wecom => "message-circle",
    };
    div()
        .size(px(size))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded_full()
        .bg(theme::alpha(t.accent, 0.12))
        .text_color(t.accent_text)
        .child(Icon::new(icon).with_size(px(size * 0.42)).stroke(1.75))
}

impl WindowCloud {
    // --- roster -----------------------------------------------------------
    /// The chat tiles: knocking first (answered where they knock), then the
    /// chats it is in; the "Add to chat" seat for managers.
    pub(super) fn chat_tiles(&self, width: f32, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let chats = self.chats.read(cx);
        if !chats.available() {
            return vec![];
        }
        let knocking: Vec<Chat> = chats.knocking().cloned().collect();
        let active: Vec<Chat> = chats.active().cloned().collect();
        let manage = chats.can_manage;
        let mut tiles: Vec<AnyElement> = knocking
            .iter()
            .filter(|_| manage)
            .map(|c| self.knock_tile(c, width, cx))
            .collect();
        tiles.extend(active.iter().map(|c| self.chat_tile(c, width, manage, cx)));
        if manage {
            tiles.push(self.add_chat_seat(width, cx));
        }
        tiles
    }
    pub(super) fn chat_note(&self, cx: &App) -> Option<AnyElement> {
        let chats = self.chats.read(cx);
        (chats.available() && chats.known && !chats.can_manage).then(|| {
            div()
                .text_size(px(theme::ty().ui.caption))
                .line_height(px(16.))
                .text_color(cx.palette().subtle)
                .child(tr("native.chatApps.onlyManagers"))
                .into_any_element()
        })
    }
    fn chat_tile(
        &self,
        chat: &Chat,
        width: f32,
        manage: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let id = chat.id.clone();
        let entity = self.chats.clone();
        let status = chat_status(chat, crate::clock::now_ms() / 1000);
        Self::tile(format!("cloud-chat:{id}").into(), width)
            .when(manage, |d| {
                d.hover(|d| d.bg(t.hover))
                    .cursor(theme::clickable_cursor())
                    .on_click(move |_, _, cx| {
                        entity.update(cx, |c, cx| c.manage(Some(id.clone()), cx))
                    })
            })
            .child(
                div()
                    .mb(px(6.))
                    .relative()
                    .child(platform_mark(chat.platform, TILE_MARK, t))
                    .when(chat.working, |d| d.child(working_dot(t))),
            )
            .child(Self::tile_name(chat.display_name.clone(), t))
            .child(
                div()
                    .max_w_full()
                    .truncate()
                    .text_size(px(theme::ty().ui.micro))
                    .line_height(px(14.))
                    .text_color(if chat.working { t.success } else { t.subtle })
                    .child(status),
            )
            .into_any_element()
    }
    fn knock_tile(&self, chat: &Chat, width: f32, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let deciding = self
            .chats
            .read(cx)
            .pending
            .contains(&format!("decide:{}", chat.id));
        let answer = |allow: bool| {
            let entity = self.chats.clone();
            let id = chat.id.clone();
            move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                entity.update(cx, |c, cx| c.decide(&id, allow, cx))
            }
        };
        let name = knock_name(chat);
        Self::tile(format!("cloud-chat-knock:{}", chat.id).into(), width)
            .bg(theme::alpha(t.accent, 0.07))
            .child(
                div()
                    .mb(px(6.))
                    .child(platform_mark(chat.platform, TILE_MARK, t)),
            )
            .child(Self::tile_name(name.clone(), t))
            .child(
                div()
                    .text_size(px(theme::ty().ui.micro))
                    .line_height(px(14.))
                    .text_color(t.subtle)
                    .child(tr("native.chatApps.asks")),
            )
            .child(
                h_flex()
                    .flex_wrap()
                    .justify_center()
                    .gap(px(4.))
                    .mt(px(6.))
                    .child(
                        Button::new(SharedString::from(format!("cloud-chat-deny:{}", chat.id)))
                            .variant(ButtonVariant::Ghost)
                            .label(tr("cloud.share.agent.request.deny"))
                            .accessibility_label(format!(
                                "{} {name}",
                                tr("cloud.share.agent.request.deny")
                            ))
                            .disabled(deciding)
                            .on_click(answer(false)),
                    )
                    .child(
                        Button::new(SharedString::from(format!("cloud-chat-allow:{}", chat.id)))
                            .variant(ButtonVariant::Solid)
                            .label(tr("cloud.share.agent.request.allow"))
                            .accessibility_label(format!(
                                "{} {name}",
                                tr("cloud.share.agent.request.allow")
                            ))
                            .disabled(deciding)
                            .on_click(answer(true)),
                    ),
            )
            .into_any_element()
    }
    fn add_chat_seat(&self, width: f32, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let start = self.chats.clone();
        Self::tile("cloud-chat-add-seat".into(), width)
            .hover(|d| d.bg(theme::alpha(t.accent, 0.08)))
            .cursor(theme::clickable_cursor())
            .child(
                div()
                    .mb(px(6.))
                    .size(px(TILE_MARK))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .border(px(1.5))
                    .border_dashed()
                    .border_color(theme::alpha(t.accent, 0.7))
                    .bg(theme::alpha(t.accent, 0.08))
                    .text_color(t.accent_text)
                    .child(
                        Icon::new("message-square-plus")
                            .with_size(px(20.))
                            .stroke(1.75),
                    ),
            )
            .child(
                div()
                    .text_size(px(theme::ty().ui.caption))
                    .line_height(px(16.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.accent_text)
                    .child(tr("native.chatApps.addToChat")),
            )
            .on_click(move |_, _, cx| start.update(cx, |c, cx| c.open_add(cx)))
            .into_any_element()
    }

    // --- adding -----------------------------------------------------------
    pub(super) fn chat_flow(&self, cx: &mut Context<Self>) -> AnyElement {
        let chats = self.chats.read(cx);
        let Some(flow) = chats.flow.clone() else {
            return div().into_any_element();
        };
        let t = cx.palette();
        if let ChatStage::In(chat) = &flow.stage {
            return self.chat_in(chat, cx);
        }
        let picker =
            SegmentedControl::new("cloud-chat-app").segments(chats.platforms.iter().map(|&p| {
                let entity = self.chats.clone();
                Segment::new(p.name())
                    .selected(p == flow.platform)
                    .on_select(move |_, cx| entity.update(cx, |c, cx| c.choose(p, cx)))
            }));
        let slack_ready = chats.slack_ready().is_some();
        let total = flow.steps(slack_ready);
        let knocked = matches!(flow.stage, ChatStage::Knocked(_));
        let mut steps: Vec<Div> = match flow.platform {
            Platform::Telegram => vec![self.telegram_step(&flow, cx)],
            Platform::Slack if total == 2 => vec![self.slack_invite_step(1, &flow, cx)],
            Platform::Slack => vec![
                self.slack_add_step(&flow, cx),
                self.slack_invite_step(2, &flow, cx),
            ],
            Platform::Wecom => vec![
                self.wecom_bot_step(&flow, cx),
                self.wecom_code_step(&flow, cx),
            ],
        };
        let last = self.step(
            total,
            if knocked { Mark::Now } else { Mark::Later },
            tr("native.chatApps.letIn"),
            Some(match &flow.stage {
                ChatStage::Knocked(chat) => self.knock_card(chat, cx),
                _ => div()
                    .text_color(t.subtle)
                    .child(tr("native.chatApps.knockHint"))
                    .into_any_element(),
            }),
            false,
            t,
        );
        steps.push(last);
        let mut column = v_flex()
            .id("cloud-chat-add")
            .debug_selector(|| "cloud-chat-add".into())
            .min_w_0()
            .gap(px(14.))
            .text_size(px(theme::ty().ui.meta))
            .child(h_flex().child(picker));
        let mut body = v_flex().gap(px(4.));
        for step in steps {
            body = body.child(step);
        }
        column = column.child(body);
        if let Some(name) = &flow.turned_away {
            column = column.child(div().text_color(t.subtle).child(tf(
                "native.chatApps.turnedAway",
                &[("chat", name.clone().into())],
            )));
        }
        if let Some(error) = flow.error {
            column = column.child(div().text_color(t.danger).child(tr(match error {
                FlowError::WeComRejected => "native.chatApps.wecomRejected",
                FlowError::SlackNotAdded => "native.chatApps.slackFailed",
                FlowError::NotManager => "native.chatApps.onlyManagers",
                FlowError::Failed => "cloud.share.agent.changeFailed",
            })));
        }
        column.into_any_element()
    }
    /// What step `n` shows once it is behind: a tick and what happened.
    fn done_step(&self, n: usize, title: String, t: Theme) -> Div {
        self.step(n, Mark::Done, title, None, true, t)
    }
    /// The wait: what to do over there, then the spinner and the time left.
    fn waiting_row(&self, label: &'static str, flow: &AddFlow, t: Theme) -> Stateful<Div> {
        let remaining = flow.remaining_secs();
        h_flex()
            .id("cloud-chat-waiting")
            .debug_selector(|| "cloud-chat-waiting".into())
            .mt(px(10.))
            .gap(px(8.))
            .items_center()
            .text_color(t.muted)
            .child(
                Icon::new("loader-circle")
                    .with_size(px(14.))
                    .stroke(2.)
                    .color(t.accent_text)
                    .spinning("cloud-chat-waiting-spin"),
            )
            .child(div().flex_1().min_w_0().child(tr(label)))
            .child(div().flex_none().text_color(t.subtle).child(format!(
                "{}:{:02}",
                remaining / 60,
                remaining % 60
            )))
    }
    fn lapsed_row(&self, line: &'static str, button: &'static str, t: Theme) -> Stateful<Div> {
        let entity = self.chats.clone();
        h_flex()
            .id("cloud-chat-lapsed")
            .debug_selector(|| "cloud-chat-lapsed".into())
            .mt(px(10.))
            .gap(px(10.))
            .justify_between()
            .items_center()
            .px(px(12.))
            .py(px(10.))
            .rounded(px(10.))
            .bg(t.control)
            .border_1()
            .border_color(t.border)
            .text_color(t.muted)
            .child(div().min_w_0().child(tr(line)))
            .child(marked(
                "cloud-chat-renew",
                action("cloud-chat-renew", tr(button), ButtonVariant::FilledPrimary)
                    .on_click(move |_, _, cx| entity.update(cx, |c, cx| c.renew(cx))),
            ))
    }
    fn telegram_step(&self, flow: &AddFlow, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let open = |group: bool| {
            let entity = self.chats.clone();
            move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                entity.update(cx, |c, cx| c.telegram_open(group, cx))
            }
        };
        let body = match flow.stage {
            ChatStage::Lapsed => v_flex().child(self.lapsed_row(
                "native.chatApps.expired",
                "native.chatApps.newLink",
                t,
            )),
            ChatStage::Waiting => v_flex()
                .child(
                    div()
                        .text_color(t.text)
                        .child(tr("native.chatApps.pickTelegram")),
                )
                .child(
                    h_flex().mt(px(8.)).child(marked(
                        "cloud-chat-telegram-again",
                        action(
                            "cloud-chat-telegram-again",
                            tr("native.chatApps.openAgain"),
                            ButtonVariant::Ghost,
                        )
                        .on_click(open(true)),
                    )),
                )
                .child(self.waiting_row("native.chatApps.waitingChat", flow, t)),
            _ => v_flex()
                .child(
                    div()
                        .text_color(t.subtle)
                        .child(tr("native.chatApps.telegramHint")),
                )
                .child(
                    h_flex()
                        .mt(px(10.))
                        .gap(px(8.))
                        .child(marked(
                            "cloud-chat-telegram-group",
                            action(
                                "cloud-chat-telegram-group",
                                tr("native.chatApps.toGroup"),
                                ButtonVariant::FilledPrimary,
                            )
                            .disabled(flow.busy)
                            .on_click(open(true)),
                        ))
                        .child(marked(
                            "cloud-chat-telegram-dm",
                            action(
                                "cloud-chat-telegram-dm",
                                tr("native.chatApps.toSelf"),
                                ButtonVariant::Ghost,
                            )
                            .disabled(flow.busy)
                            .on_click(open(false)),
                        )),
                ),
        };
        if matches!(flow.stage, ChatStage::Knocked(_)) {
            return self.done_step(1, tr("native.chatApps.telegramStep"), t);
        }
        self.step(
            1,
            Mark::Now,
            tr("native.chatApps.telegramStep"),
            Some(body.into_any_element()),
            true,
            t,
        )
    }
    fn slack_add_step(&self, flow: &AddFlow, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let entity = self.chats.clone();
        match &flow.stage {
            ChatStage::Add | ChatStage::Installing => {
                let installing = flow.stage == ChatStage::Installing;
                let body = v_flex()
                    .child(
                        div()
                            .text_color(t.subtle)
                            .child(tr("native.chatApps.slackHint")),
                    )
                    .child(
                        h_flex().mt(px(10.)).child(marked(
                            "cloud-chat-slack-add",
                            action(
                                "cloud-chat-slack-add",
                                tr(if installing {
                                    "native.chatApps.finishBrowser"
                                } else {
                                    "native.chatApps.addSlack"
                                }),
                                if installing {
                                    ButtonVariant::Ghost
                                } else {
                                    ButtonVariant::FilledPrimary
                                },
                            )
                            .disabled(flow.busy)
                            .on_click(move |_, _, cx| entity.update(cx, |c, cx| c.slack_add(cx))),
                        )),
                    )
                    .when(installing, |d| {
                        d.child(self.waiting_row("native.chatApps.waitingSlack", flow, t))
                    });
                self.step(
                    1,
                    Mark::Now,
                    tr("native.chatApps.slackStep"),
                    Some(body.into_any_element()),
                    true,
                    t,
                )
            }
            ChatStage::Lapsed if flow.connection.is_none() => self.step(
                1,
                Mark::Now,
                tr("native.chatApps.slackStep"),
                Some(
                    self.lapsed_row("native.chatApps.slackFailed", "native.chatApps.tryAgain", t)
                        .into_any_element(),
                ),
                true,
                t,
            ),
            _ => {
                let name = flow
                    .connection
                    .as_ref()
                    .map(|c| c.display_name.clone())
                    .unwrap_or_default();
                self.done_step(
                    1,
                    tf("native.chatApps.addedTo", &[("workspace", name.into())]),
                    t,
                )
            }
        }
    }
    fn slack_invite_step(&self, n: usize, flow: &AddFlow, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let title = tr("native.chatApps.inviteStep");
        let started = flow.started.as_ref().filter(|s| s.invite.is_some());
        match (&flow.stage, started) {
            (ChatStage::Knocked(chat), _) => self.done_step(
                n,
                tf(
                    "native.chatApps.invitedTo",
                    &[("chat", chat.display_name.clone().into())],
                ),
                t,
            ),
            (ChatStage::Lapsed, Some(_)) => self.step(
                n,
                Mark::Now,
                title,
                Some(
                    self.lapsed_row(
                        "native.chatApps.noChannel",
                        "native.chatApps.keepWaiting",
                        t,
                    )
                    .into_any_element(),
                ),
                true,
                t,
            ),
            (ChatStage::Waiting, Some(started)) => {
                let line = started.invite.clone().unwrap_or_default();
                let body = v_flex()
                    .child(
                        div()
                            .text_color(t.subtle)
                            .child(tr("native.chatApps.inviteHint")),
                    )
                    .child(self.copy_line("cloud-chat-slack-invite", line, cx))
                    .child(self.waiting_row("native.chatApps.waitingChannel", flow, t));
                self.step(n, Mark::Now, title, Some(body.into_any_element()), true, t)
            }
            _ if n == 1 => {
                // The workspace is in already: one press starts the wait.
                let entity = self.chats.clone();
                let body = v_flex()
                    .child(
                        div()
                            .text_color(t.subtle)
                            .child(tr("native.chatApps.inviteHint")),
                    )
                    .child(
                        h_flex().mt(px(10.)).child(marked(
                            "cloud-chat-slack-start",
                            action(
                                "cloud-chat-slack-start",
                                tr("native.chatApps.inviteStep"),
                                ButtonVariant::FilledPrimary,
                            )
                            .disabled(flow.busy)
                            .on_click(move |_, _, cx| entity.update(cx, |c, cx| c.slack_add(cx))),
                        )),
                    );
                self.step(n, Mark::Now, title, Some(body.into_any_element()), true, t)
            }
            _ => self.step(n, Mark::Later, title, None, true, t),
        }
    }
    fn wecom_bot_step(&self, flow: &AddFlow, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let title = tr("native.chatApps.wecomStep");
        let connected = matches!(flow.stage, ChatStage::Waiting | ChatStage::Knocked(_))
            || (flow.stage == ChatStage::Lapsed && flow.connection.is_some());
        if connected {
            return self.done_step(1, tr("native.chatApps.botConnected"), t);
        }
        let connecting = flow.stage == ChatStage::Connecting || flow.busy;
        let inputs = &self.chat_inputs;
        let ready = !inputs.bot_id.read(cx).text().trim().is_empty()
            && !inputs.secret.read(cx).text().trim().is_empty();
        let entity = self.chats.clone();
        let (bot, secret) = (inputs.bot_id.clone(), inputs.secret.clone());
        let existing = self.chats.read(cx).wecom_bot().cloned();
        let field = |label: &'static str, input: Entity<TextInput>| {
            v_flex()
                .gap(px(4.))
                .child(
                    div()
                        .text_size(px(theme::ty().ui.caption))
                        .text_color(t.subtle)
                        .child(tr(label)),
                )
                .child(input)
        };
        let body = v_flex()
            .child(
                div()
                    .text_color(t.subtle)
                    .child(tr("native.chatApps.wecomHint")),
            )
            .child(
                div()
                    .mt(px(4.))
                    .text_size(px(theme::ty().ui.caption))
                    .text_color(t.subtle)
                    .child(tr("native.chatApps.wecomNote")),
            )
            .child(
                h_flex()
                    .mt(px(10.))
                    .gap(px(8.))
                    .child(div().flex_1().child(field(
                        "native.chatApps.botId",
                        self.chat_inputs.bot_id.clone(),
                    )))
                    .child(div().flex_1().child(field(
                        "native.chatApps.secret",
                        self.chat_inputs.secret.clone(),
                    ))),
            )
            .child(
                h_flex()
                    .mt(px(10.))
                    .gap(px(8.))
                    .child(marked(
                        "cloud-chat-wecom-connect",
                        action(
                            "cloud-chat-wecom-connect",
                            tr(if connecting {
                                "native.chatApps.connecting"
                            } else {
                                "native.chatApps.connect"
                            }),
                            ButtonVariant::FilledPrimary,
                        )
                        .disabled(connecting || !ready)
                        .on_click(move |_, _, cx| {
                            let (id, key) = (
                                bot.read(cx).text().to_owned(),
                                secret.read(cx).text().to_owned(),
                            );
                            entity.update(cx, |c, cx| c.wecom_connect(id, key, cx));
                        }),
                    ))
                    .when_some(existing.filter(|_| !connecting), |d, bot| {
                        let entity = self.chats.clone();
                        d.child(marked(
                            "cloud-chat-wecom-existing",
                            action(
                                "cloud-chat-wecom-existing",
                                bot.display_name.clone(),
                                ButtonVariant::Ghost,
                            )
                            .on_click(move |_, _, cx| {
                                entity.update(cx, |c, cx| c.wecom_use_bot(cx))
                            }),
                        ))
                    }),
            )
            .when(flow.stage == ChatStage::Connecting, |d| {
                d.child(self.waiting_row("native.chatApps.connecting", flow, t))
            });
        self.step(1, Mark::Now, title, Some(body.into_any_element()), true, t)
    }
    fn wecom_code_step(&self, flow: &AddFlow, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let title = tr("native.chatApps.codeStep");
        match (
            &flow.stage,
            flow.started.as_ref().and_then(|s| s.code.clone()),
        ) {
            (ChatStage::Knocked(chat), _) => self.done_step(2, knock_name(chat), t),
            (ChatStage::Lapsed, Some(_)) => self.step(
                2,
                Mark::Now,
                title,
                Some(
                    self.lapsed_row("native.chatApps.noChat", "native.chatApps.keepWaiting", t)
                        .into_any_element(),
                ),
                true,
                t,
            ),
            (ChatStage::Waiting, Some(code)) => {
                let body = v_flex()
                    .child(
                        div()
                            .text_color(t.subtle)
                            .child(tr("native.chatApps.codeHint")),
                    )
                    .child(self.copy_line("cloud-chat-wecom-code", code, cx))
                    .child(self.waiting_row("native.chatApps.waitingChat", flow, t));
                self.step(2, Mark::Now, title, Some(body.into_any_element()), true, t)
            }
            _ => self.step(2, Mark::Later, title, None, true, t),
        }
    }
    /// A line to send over there (`/invite @PuppyOne`, the six digits), in
    /// the monospace face, with Copy.
    fn copy_line(&self, id: &'static str, line: String, cx: &mut Context<Self>) -> Stateful<Div> {
        let t = cx.palette();
        let copied = self.chat_copied.as_deref() == Some(line.as_str());
        let host = self.weak.clone();
        let value = line.clone();
        h_flex()
            .id(id)
            .debug_selector(move || id.into())
            .mt(px(10.))
            .gap(px(10.))
            .items_center()
            .justify_between()
            .px(px(12.))
            .py(px(8.))
            .rounded(px(10.))
            .bg(theme::alpha(t.inset, 0.3))
            .border_1()
            .border_color(t.border)
            .child(
                div()
                    .min_w_0()
                    .font_family(theme::mono())
                    .text_size(px(theme::ty().ui.body_large))
                    .text_color(t.text)
                    .child(line),
            )
            .child(
                action(
                    &format!("{id}-copy"),
                    tr(if copied {
                        "native.chatApps.copied"
                    } else {
                        "native.chatApps.copy"
                    }),
                    ButtonVariant::Ghost,
                )
                .leading(copy_icon())
                .on_click(move |_, _, cx| {
                    cx.write_to_clipboard(ClipboardItem::new_string(value.clone()));
                    let value = value.clone();
                    let _ = host.update(cx, |s, cx| {
                        s.chat_copied = Some(value);
                        cx.notify();
                    });
                }),
            )
    }
    /// The chat at the door, with what letting it in means.
    fn knock_card(&self, chat: &Chat, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let deciding = self
            .chats
            .read(cx)
            .pending
            .contains(&format!("decide:{}", chat.id));
        let answer = |allow: bool| {
            let entity = self.chats.clone();
            let id = chat.id.clone();
            move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                entity.update(cx, |c, cx| c.decide(&id, allow, cx))
            }
        };
        v_flex()
            .id("cloud-chat-knock-card")
            .debug_selector(|| "cloud-chat-knock-card".into())
            .mt(px(8.))
            .gap(px(8.))
            .px(px(12.))
            .py(px(10.))
            .rounded(px(10.))
            .bg(theme::alpha(t.accent, 0.07))
            .border_1()
            .border_color(theme::alpha(t.accent, 0.22))
            .child(
                h_flex()
                    .gap(px(10.))
                    .items_center()
                    .child(platform_mark(chat.platform, 32., t))
                    .child(
                        div()
                            .min_w_0()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(tf(
                                "native.chatApps.wantsJoin",
                                &[("chat", knock_name(chat).into())],
                            )),
                    ),
            )
            .child(
                div()
                    .text_color(t.subtle)
                    .child(tr("native.chatApps.onlyYou")),
            )
            .child(
                h_flex()
                    .gap(px(8.))
                    .justify_end()
                    .child(marked(
                        "cloud-chat-flow-deny",
                        action(
                            "cloud-chat-flow-deny",
                            tr("cloud.share.agent.request.deny"),
                            ButtonVariant::Ghost,
                        )
                        .disabled(deciding)
                        .on_click(answer(false)),
                    ))
                    .child(marked(
                        "cloud-chat-flow-allow",
                        action(
                            "cloud-chat-flow-allow",
                            tr("cloud.share.agent.request.allow"),
                            ButtonVariant::FilledPrimary,
                        )
                        .disabled(deciding)
                        .on_click(answer(true)),
                    )),
            )
            .into_any_element()
    }
    /// Let in: where it is and how to ask it there.
    fn chat_in(&self, chat: &Chat, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let (again, done) = (self.chats.clone(), self.chats.clone());
        let mention = self.chats.read(cx).mention(chat.platform).to_owned();
        let how = if chat.platform == Platform::Telegram && chat.group() {
            "native.chatApps.replyOrMention"
        } else {
            "native.chatApps.mention"
        };
        v_flex()
            .id("cloud-chat-in")
            .debug_selector(|| "cloud-chat-in".into())
            .items_center()
            .gap(px(8.))
            .py(px(12.))
            .text_size(px(theme::ty().ui.meta))
            .child(
                div()
                    .relative()
                    .child(platform_mark(chat.platform, 56., t))
                    .child(
                        div()
                            .absolute()
                            .right(px(-2.))
                            .bottom(px(-2.))
                            .size(px(20.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded_full()
                            .bg(t.success)
                            .text_color(t.text_inverse)
                            .child(Icon::new("check").with_size(px(12.)).stroke(3.)),
                    ),
            )
            .child(
                div()
                    .text_size(px(theme::ty().ui.body_large))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.text)
                    .child(tf(
                        "native.chatApps.agentIn",
                        &[("chat", chat.display_name.clone().into())],
                    )),
            )
            .child(
                div()
                    .text_center()
                    .text_color(t.subtle)
                    .child(tf(how, &[("mention", mention.into())])),
            )
            .child(
                h_flex()
                    .mt(px(6.))
                    .gap(px(8.))
                    .child(marked(
                        "cloud-chat-another",
                        action(
                            "cloud-chat-another",
                            tr("native.chatApps.addAnother"),
                            ButtonVariant::Ghost,
                        )
                        .on_click(move |_, _, cx| again.update(cx, |c, cx| c.add_another(cx))),
                    ))
                    .child(marked(
                        "cloud-chat-done",
                        action(
                            "cloud-chat-done",
                            tr("native.chatApps.done"),
                            ButtonVariant::FilledPrimary,
                        )
                        .on_click(move |_, _, cx| done.update(cx, |c, cx| c.close_add(cx))),
                    )),
            )
            .into_any_element()
    }

    // --- managing one chat ------------------------------------------------
    pub(super) fn chat_heading(&self, chat: &Chat, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let renaming = self.chat_inputs.renaming.as_deref() == Some(chat.id.as_str());
        let back = self.chats.clone();
        let host = self.weak.clone();
        let (id, name) = (chat.id.clone(), chat.display_name.clone());
        let editable = self.chats.read(cx).can_manage && chat.stopped_reason.is_none();
        h_flex()
            .items_center()
            .gap(px(8.))
            .min_w_0()
            .pt(px(4.))
            .pb(px(7.5))
            .child(
                IconButton::new("cloud-chat-back", Icon::new("arrow-left"))
                    .tooltip(tr("native.chatApps.back"))
                    .on_click(move |_, _, cx| back.update(cx, |c, cx| c.manage(None, cx))),
            )
            .child(platform_mark(chat.platform, 26., t))
            .child(if renaming {
                div()
                    .id("cloud-chat-rename")
                    .debug_selector(|| "cloud-chat-rename".into())
                    .flex_1()
                    .min_w_0()
                    .child(self.chat_inputs.rename.clone())
                    .into_any_element()
            } else {
                h_flex()
                    .id("cloud-chat-name")
                    .group("cloud-chat-name")
                    .min_w_0()
                    .gap(px(4.))
                    .items_center()
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .text_size(px(ty.body_large))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t.text)
                            .child(name.clone()),
                    )
                    .when(editable, |d| {
                        d.child(
                            div()
                                .opacity(0.)
                                .group_hover("cloud-chat-name", |d| d.opacity(1.))
                                .child(
                                    IconButton::new("cloud-chat-rename-start", Icon::new("pencil"))
                                        .tooltip(tr("native.chatApps.rename"))
                                        .on_click(move |_, window, cx| {
                                            let (id, name) = (id.clone(), name.clone());
                                            let _ = host.update(cx, |s, cx| {
                                                s.start_chat_rename(id, name, window, cx)
                                            });
                                        }),
                                ),
                        )
                    })
                    .into_any_element()
            })
            .child(
                div()
                    .flex_none()
                    .text_size(px(ty.meta))
                    .text_color(t.subtle)
                    .child(chat.platform.name()),
            )
            .into_any_element()
    }
    #[cfg(test)]
    pub(in crate::app) fn rename_chat_for_test(
        &mut self,
        id: &str,
        name: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.start_chat_rename(id.into(), name.into(), window, cx);
    }
    fn start_chat_rename(
        &mut self,
        id: String,
        name: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.chat_inputs.renaming = Some(id);
        self.chat_inputs
            .rename
            .update(cx, |i, cx| i.set_text(name, cx));
        self.chat_inputs
            .rename
            .read(cx)
            .focus_handle(cx)
            .focus(window, cx);
        cx.notify();
    }
    pub(in crate::app) fn save_chat_name(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.chat_inputs.renaming.take() else {
            return;
        };
        let name = self.chat_inputs.rename.read(cx).text().trim().to_owned();
        if !name.is_empty() && name.chars().count() <= CHAT_NAME_MAX {
            self.chats.update(cx, |c, cx| {
                c.change(
                    &id,
                    Change {
                        display_name: Some(name),
                        ..Default::default()
                    },
                    cx,
                )
            });
        }
        cx.notify();
    }
    pub(super) fn chat_manage(&self, chat: &Chat, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let chats = self.chats.read(cx);
        let busy = chats.pending.contains(&format!("change:{}", chat.id));
        let confirming = chats.confirming_remove;
        let removing = chats.pending.contains(&format!("remove:{}", chat.id));
        let change_failed = chats.change_failed;
        let frozen = chat.stopped_reason.is_some();
        let id = chat.id.clone();
        let entity = self.chats.clone();
        let mine = self
            .chats
            .read(cx)
            .scope_key()
            .is_some_and(|key| key.split('\n').nth(1) == Some(chat.owner_user_id.as_str()));
        let used = chat.used_today_units;
        let hint = |text: String| {
            div()
                .text_size(px(ty.caption))
                .line_height(px(16.))
                .text_color(t.subtle)
                .child(text)
        };
        let answers = {
            let (entity, id) = (entity.clone(), id.clone());
            Switch::new("cloud-chat-enabled", tr("native.chatApps.answers"))
                .checked(chat.enabled)
                .disabled(frozen || busy)
                .on_change(move |on, _, cx| {
                    entity.update(cx, |c, cx| {
                        c.change(
                            &id,
                            Change {
                                enabled: Some(on),
                                ..Default::default()
                            },
                            cx,
                        )
                    })
                })
        };
        let current_who = chat.who_can_ask;
        let who = {
            let (entity, id) = (entity.clone(), id.clone());
            Select::new("cloud-chat-who", who_label(current_who), move |_| {
                [WhoCanAsk::Owner, WhoCanAsk::Project, WhoCanAsk::Anyone]
                    .into_iter()
                    .map(|w| {
                        let (entity, id) = (entity.clone(), id.clone());
                        SelectOption::new(who_label(w))
                            .selected(w == current_who)
                            .on_select(move |_, cx| {
                                entity.update(cx, |c, cx| c.set_who_can_ask(&id, w, cx))
                            })
                    })
                    .collect()
            })
            .disabled(frozen || busy)
        };
        let limit = {
            let (entity, id) = (entity.clone(), id.clone());
            let current = chat.daily_limit_units;
            Select::new("cloud-chat-limit", limit_label(current), move |_| {
                LIMITS
                    .into_iter()
                    .map(|l| {
                        let (entity, id) = (entity.clone(), id.clone());
                        SelectOption::new(limit_label(l))
                            .selected(l == current)
                            .on_select(move |_, cx| {
                                entity.update(cx, |c, cx| {
                                    c.change(
                                        &id,
                                        Change {
                                            daily_limit_units: Some(l),
                                            ..Default::default()
                                        },
                                        cx,
                                    )
                                })
                            })
                    })
                    .collect()
            })
            .disabled(frozen || busy)
        };
        let who_hint = match current_who {
            WhoCanAsk::Project => Some(tr("native.chatApps.projectHint")),
            WhoCanAsk::Anyone => Some(tf(
                "native.chatApps.anyoneHint",
                &[("chat", chat.display_name.clone().into())],
            )),
            WhoCanAsk::Owner => None,
        };
        let label = |title: String, under: Option<String>| {
            v_flex()
                .gap(px(2.))
                .child(
                    div()
                        .text_color(if frozen { t.subtle } else { t.text })
                        .child(title),
                )
                .children(under.map(hint))
        };
        let rows = v_flex()
            .id("cloud-chat-settings")
            .debug_selector(|| "cloud-chat-settings".into())
            .when(frozen, |d| d.opacity(0.55))
            .child(
                SettingRow::new("")
                    .label_element(label(tr("native.chatApps.answers"), None))
                    .control(answers),
            )
            .child(
                SettingRow::new("")
                    .label_element(label(tr("native.chatApps.who"), who_hint))
                    .control(who),
            )
            .child(
                SettingRow::new("")
                    .label_element(label(
                        tr("native.chatApps.limit"),
                        Some(tf(
                            "native.chatApps.used",
                            &[("n", used.to_string().into())],
                        )),
                    ))
                    .control(limit),
            );
        let owner = chat.owner_name.clone().unwrap_or_default();
        let facts = v_flex()
            .id("cloud-chat-facts")
            .debug_selector(|| "cloud-chat-facts".into())
            .gap(px(4.))
            .px(px(10.))
            .text_size(px(ty.caption))
            .line_height(px(16.))
            .text_color(t.subtle)
            .child(reads_line(chat))
            .child(if mine {
                tr("native.chatApps.worksAsYou")
            } else {
                tf("native.chatApps.worksAs", &[("name", owner.into())])
            });
        let remove = {
            let (entity, keep, id) = (entity.clone(), entity.clone(), id.clone());
            if confirming {
                h_flex()
                    .id("cloud-chat-remove-confirm")
                    .debug_selector(|| "cloud-chat-remove-confirm".into())
                    .gap(px(8.))
                    .items_center()
                    .justify_between()
                    .px(px(12.))
                    .py(px(8.))
                    .rounded(px(10.))
                    .bg(theme::alpha(t.danger, 0.08))
                    .border_1()
                    .border_color(theme::alpha(t.danger, 0.35))
                    .child(div().min_w_0().text_color(t.text).child(tf(
                        "native.chatApps.removeConfirm",
                        &[("chat", chat.display_name.clone().into())],
                    )))
                    .child(
                        h_flex()
                            .gap(px(6.))
                            .child(marked(
                                "cloud-chat-keep",
                                Button::new("cloud-chat-keep")
                                    .variant(ButtonVariant::Ghost)
                                    .label(tr("cloud.share.agent.keep"))
                                    .disabled(removing)
                                    .on_click(move |_, _, cx| {
                                        keep.update(cx, |c, cx| c.confirm_remove(false, cx))
                                    }),
                            ))
                            .child(marked(
                                "cloud-chat-remove-yes",
                                Button::new("cloud-chat-remove-yes")
                                    .variant(ButtonVariant::SolidDanger)
                                    .label(tr("cloud.share.agent.remove"))
                                    .disabled(removing)
                                    .on_click(move |_, _, cx| {
                                        entity.update(cx, |c, cx| c.remove(&id, cx))
                                    }),
                            )),
                    )
                    .into_any_element()
            } else {
                h_flex()
                    .child(marked(
                        "cloud-chat-remove",
                        Button::new("cloud-chat-remove")
                            .variant(ButtonVariant::Ghost)
                            .text_color(t.danger)
                            .label(tr("native.chatApps.remove"))
                            .on_click(move |_, _, cx| entity.update(cx, |c, cx| c.remove(&id, cx))),
                    ))
                    .into_any_element()
            }
        };
        v_flex()
            .id("cloud-chat-manage")
            .debug_selector(|| "cloud-chat-manage".into())
            .gap(px(10.))
            .min_w_0()
            .children(
                banner(chat)
                    .map(|b| self.chat_banner(chat, b, cx))
                    .into_iter()
                    .collect::<Vec<_>>(),
            )
            .child(rows)
            .child(facts)
            .when(change_failed, |d| {
                d.child(hint(tr("cloud.share.agent.changeFailed")).text_color(t.danger))
            })
            .child(div().mt(px(4.)).child(remove))
            .into_any_element()
    }
    fn chat_banner(&self, chat: &Chat, which: Banner, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let entity = self.chats.clone();
        let (text, button): (String, Option<(&'static str, BannerPress)>) = match which {
            Banner::Limit => (tr("native.chatApps.bannerLimit"), None),
            Banner::OwnerLeft => {
                let id = chat.id.clone();
                (
                    tf(
                        "native.chatApps.bannerLeft",
                        &[("name", chat.owner_name.clone().unwrap_or_default().into())],
                    ),
                    Some((
                        "native.chatApps.takeOver",
                        Box::new(move |cx: &mut App| {
                            entity.update(cx, |c, cx| c.take_over(&id, cx))
                        }),
                    )),
                )
            }
            Banner::RemovedThere => {
                let platform = chat.platform;
                (
                    tf(
                        "native.chatApps.bannerRemoved",
                        &[("app", platform.name().into())],
                    ),
                    Some((
                        "native.chatApps.addAgain",
                        Box::new(move |cx: &mut App| {
                            entity.update(cx, |c, cx| {
                                c.open_add(cx);
                                c.choose(platform, cx);
                            })
                        }),
                    )),
                )
            }
            Banner::NoHours => {
                let host = self.weak.clone();
                (
                    tr("native.chatApps.bannerHours"),
                    Some((
                        "native.chatApps.seePlans",
                        Box::new(move |cx: &mut App| {
                            let _ = host.update(cx, |_, cx| {
                                cx.emit(super::super::window_cloud::CloudEvent::OpenSettings(
                                    crate::features::settings::Page::Plan,
                                ))
                            });
                        }),
                    )),
                )
            }
        };
        h_flex()
            .id("cloud-chat-banner")
            .debug_selector(|| "cloud-chat-banner".into())
            .gap(px(10.))
            .items_center()
            .justify_between()
            .px(px(12.))
            .py(px(8.))
            .rounded(px(10.))
            .bg(theme::alpha(t.warning, 0.10))
            .border_1()
            .border_color(theme::alpha(t.warning, 0.30))
            .text_size(px(theme::ty().ui.meta))
            .text_color(t.text)
            .child(div().min_w_0().child(text))
            .children(button.map(|(label, press)| {
                marked(
                    "cloud-chat-banner-action",
                    action(
                        "cloud-chat-banner-action",
                        tr(label),
                        ButtonVariant::Outline,
                    )
                    .on_click(move |_, _, cx| press(cx)),
                )
            }))
            .into_any_element()
    }
}

/// A command tests and the end-to-end driver can find by name.
fn marked(id: &'static str, element: impl IntoElement) -> Div {
    div().debug_selector(move || id.into()).child(element)
}

/// What a banner's one command does.
type BannerPress = Box<dyn Fn(&mut App)>;

/// The green lamp on a chat at work.
fn working_dot(t: Theme) -> Div {
    div()
        .absolute()
        .right(px(1.))
        .bottom(px(1.))
        .size(px(11.))
        .rounded_full()
        .bg(t.success)
        .border_2()
        .border_color(t.overlay)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn chat(changes: serde_json::Value) -> Chat {
        let mut base = serde_json::json!({"id": "c1", "platform": "telegram", "chat_kind": "group",
            "display_name": "Design team", "state": "active", "enabled": true,
            "owner_user_id": "u1", "who_can_ask": "owner", "daily_limit_units": 60,
            "used_today_units": 10});
        for (key, value) in changes.as_object().unwrap() {
            base[key] = value.clone();
        }
        serde_json::from_value(base).unwrap()
    }

    #[test]
    fn a_tile_says_one_thing_about_the_chat() {
        let now = 1_795_000_000;
        let status = |changes| chat_status(&chat(changes), now);
        assert_eq!(
            status(serde_json::json!({"working": true})),
            tr("native.chatApps.statusWorking")
        );
        assert_eq!(
            status(serde_json::json!({"enabled": false})),
            tr("native.chatApps.statusPaused")
        );
        assert_eq!(
            status(serde_json::json!({"used_today_units": 60})),
            tr("native.chatApps.statusLimit")
        );
        assert_eq!(
            status(serde_json::json!({"stopped_reason": "removed_there", "working": true})),
            tr("native.chatApps.statusRemoved")
        );
        assert_eq!(
            status(serde_json::json!({})),
            tr("native.chatApps.noRecent")
        );
    }

    #[test]
    fn what_it_reads_differs_in_groups_telegram_and_direct_chats() {
        assert_eq!(
            reads_line(&chat(serde_json::json!({}))),
            tr("native.chatApps.readsTelegram")
        );
        assert_eq!(
            reads_line(&chat(serde_json::json!({"platform": "slack"}))),
            tr("native.chatApps.readsMention")
        );
        assert_eq!(
            reads_line(&chat(serde_json::json!({"chat_kind": "dm"}))),
            tr("native.chatApps.readsDm")
        );
    }

    #[test]
    fn a_wecom_knock_shows_the_code_it_carried() {
        let wecom = chat(
            serde_json::json!({"platform": "wecom", "display_name": "WeCom group",
            "knock_hint": "482731", "connection_id": "x"}),
        );
        assert!(knock_name(&wecom).contains("482731"));
        assert_eq!(knock_name(&chat(serde_json::json!({}))), "Design team");
    }

    #[test]
    fn one_banner_at_most_and_the_most_pressing() {
        assert_eq!(banner(&chat(serde_json::json!({}))), None);
        assert_eq!(
            banner(&chat(serde_json::json!({"used_today_units": 60}))),
            Some(Banner::Limit)
        );
        assert_eq!(
            banner(&chat(
                serde_json::json!({"no_hours": true, "used_today_units": 60})
            )),
            Some(Banner::NoHours)
        );
        assert_eq!(
            banner(&chat(
                serde_json::json!({"stopped_reason": "owner_left", "no_hours": true})
            )),
            Some(Banner::OwnerLeft)
        );
        assert_eq!(
            banner(&chat(
                serde_json::json!({"stopped_reason": "removed_there"})
            )),
            Some(Banner::RemovedThere)
        );
    }

    #[test]
    fn settings_read_back_as_their_choices() {
        assert_eq!(LIMITS.map(limit_label).len(), 4);
        assert_eq!(limit_label(None), tr("native.chatApps.noLimit"));
        assert_eq!(limit_label(Some(60)), tr("native.chatApps.limit60"));
        assert_eq!(who_label(WhoCanAsk::Owner), tr("native.chatApps.onlyMe"));
    }

    #[test]
    fn every_chat_string_exists_in_every_language() {
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../../assets/native-locales.json")).unwrap();
        let source = include_str!("chat_apps.rs").to_owned()
            + include_str!("../../features/cloud/chat_apps.rs")
            + include_str!("../window_cloud.rs");
        let keys: std::collections::BTreeSet<&str> = source
            .match_indices("\"native.chatApps.")
            .map(|(i, _)| {
                let rest = &source[i + 1..];
                &rest[..rest.find('"').unwrap()]
            })
            .filter(|key| key.len() > "native.chatApps.".len())
            .collect();
        assert!(keys.len() > 80);
        for (locale, entries) in catalog["catalogs"].as_object().unwrap() {
            for key in &keys {
                assert!(entries.get(*key).is_some(), "{locale} lacks {key}");
            }
        }
    }
}
