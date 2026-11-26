//! "Add the Agent to a Chat" in a real window: the roster's chat tiles, a
//! chat knocking and let in, a chat's three settings, its name and a removal
//! that asks once. The chat side is a fake Cloud that knocks when told to.
use super::*;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct ChatServer {
    manage: bool,
    chats: Vec<Value>,
    link_state: String,
    writes: Vec<(String, String, Value)>,
}
type Shared = Arc<Mutex<ChatServer>>;

fn chat(id: &str, name: &str, state: &str) -> Value {
    json!({"id": id, "platform": "telegram", "chat_kind": "group", "display_name": name,
        "state": state, "enabled": true, "owner_user_id": "user-1", "owner_name": "Alex",
        "who_can_ask": "owner", "daily_limit_units": 60, "used_today_units": 18,
        "working": false})
}

fn answer(server: &Shared, request: &crate::cloud::auth::model::ApiRequest) -> Option<Value> {
    let path = request.path.as_str();
    let rest = path.strip_prefix("/projects/project-a/chat-apps")?;
    let mut s = server.lock().unwrap();
    let method = request.method.as_str().to_owned();
    if method != "GET" {
        s.writes.push((
            method.clone(),
            rest.to_owned(),
            request.body.clone().unwrap_or(Value::Null),
        ));
    }
    let link = |s: &ChatServer| {
        json!({"id": "l1", "purpose": "knock", "platform": "telegram",
            "expires_at": crate::clock::iso_string(crate::clock::now_ms() + 600_000),
            "state": s.link_state,
            "conversation": s.chats.iter().find(|c| c["state"] == "asking").cloned()})
    };
    Some(match (method.as_str(), rest) {
        ("GET", "") => json!({"can_manage": s.manage, "conversations": s.chats,
            "connections": [], "platforms": ["telegram", "slack", "wecom"]}),
        ("POST", "/links") => {
            s.link_state = "waiting".into();
            json!({"link": link(&s), "links": {"group": "https://t.me/PuppyOneBot?startgroup=abc",
                "dm": "https://t.me/PuppyOneBot?start=abc"}})
        }
        ("GET", "/links/l1") => link(&s),
        (_, rest) if rest.starts_with("/conversations/") => {
            let id = rest["/conversations/".len()..]
                .split('/')
                .next()
                .unwrap()
                .to_owned();
            if method == "DELETE" {
                s.chats.retain(|c| c["id"] != id.as_str());
                return Some(json!({}));
            }
            let body = request.body.clone().unwrap_or(Value::Null);
            let slot = s.chats.iter_mut().find(|c| c["id"] == id.as_str())?;
            if rest.ends_with("/decision") {
                slot["state"] = if body["decision"] == "allow" {
                    "active"
                } else {
                    "denied"
                }
                .into();
            } else if let Value::Object(map) = body {
                for (key, value) in map {
                    slot[key] = value;
                }
            }
            slot.clone()
        }
        _ => return None,
    })
}

fn open(cx: &mut TestAppContext, server: Shared) -> (Entity<Shell>, &mut VisualTestContext) {
    let (view, cx) = setup(cx);
    let base = cloud_project_responder();
    let responder = with_catalog(Arc::new(move |request| match answer(&server, request) {
        Some(data) => Ok(json!({"code": 0, "data": data})),
        None if request.path.ends_with("/agent-links") => Err(crate::cloud::auth::Error::Http(403)),
        None => base(request),
    }));
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle_cloud(&view, cx, "the chats", &|s, cx| {
        s.cloud.read(cx).chats.read(cx).available()
    });
    (view, cx)
}

fn roster(view: &Entity<Shell>, cx: &mut VisualTestContext) {
    view.update_in(cx, |s, window, cx| {
        s.cloud.update(cx, |c, cx| c.open_chat_roster(window, cx))
    });
    draw(cx);
}
fn writes(server: &Shared) -> Vec<(String, String, Value)> {
    server.lock().unwrap().writes.clone()
}

/// A manager sees the chats and the "Add to chat" seat; anyone else sees the
/// chats, no seat, a line saying who can add, and no way into a chat.
#[gpui::test]
fn only_managers_add_chats_or_open_them(cx: &mut TestAppContext) {
    let server: Shared = Arc::new(Mutex::new(ChatServer {
        manage: false,
        chats: vec![chat("c1", "Design team", "active")],
        ..Default::default()
    }));
    let (view, cx) = open(cx, server.clone());
    roster(&view, cx);
    let tile = cx
        .debug_bounds("cloud-chat:c1")
        .expect("the chat is a tile");
    assert!(cx.debug_bounds("cloud-chat-add-seat").is_none());
    cx.simulate_click(tile.center(), Modifiers::none());
    draw(cx);
    assert!(cx.debug_bounds("cloud-chat-manage").is_none());
    server.lock().unwrap().manage = true;
    view.update(cx, |s, cx| {
        s.cloud
            .update(cx, |c, cx| c.chats.update(cx, |c, cx| c.refresh(cx)))
    });
    settle_cloud(&view, cx, "manager", &|s, cx| {
        s.cloud.read(cx).chats.read(cx).can_manage
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-chat-add-seat").is_some());
    let tile = cx.debug_bounds("cloud-chat:c1").unwrap();
    cx.simulate_click(tile.center(), Modifiers::none());
    draw(cx);
    assert!(cx.debug_bounds("cloud-chat-manage").is_some());
}

/// In a project with nobody in it yet, the Header's seat opens the roster
/// for a manager who can add chats: inviting an Agent and adding to a chat
/// sit side by side there, and neither is skipped.
#[gpui::test]
fn the_empty_seat_offers_both_the_agent_and_the_chat(cx: &mut TestAppContext) {
    let server: Shared = Arc::new(Mutex::new(ChatServer {
        manage: true,
        ..Default::default()
    }));
    let (view, cx) = open(cx, server);
    draw(cx);
    view.update_in(cx, |s, window, cx| {
        s.cloud.update(cx, |c, cx| {
            c.press_agents(crate::features::cloud::Opener::Invite, window, cx)
        })
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-agent-invite").is_none());
    let seat = cx.debug_bounds("cloud-chat-add-seat").unwrap();
    cx.simulate_click(seat.center(), Modifiers::none());
    draw(cx);
    assert!(cx.debug_bounds("cloud-chat-add").is_some());
}

/// Telegram in two steps: the links open Telegram, the chat knocks here with
/// its name, and letting it in says where it is. Nothing gets in unasked.
#[gpui::test]
fn a_telegram_chat_knocks_and_is_let_in(cx: &mut TestAppContext) {
    let server: Shared = Arc::new(Mutex::new(ChatServer {
        manage: true,
        ..Default::default()
    }));
    let (view, cx) = open(cx, server.clone());
    roster(&view, cx);
    let seat = cx.debug_bounds("cloud-chat-add-seat").unwrap();
    cx.simulate_click(seat.center(), Modifiers::none());
    draw(cx);
    assert!(cx.debug_bounds("cloud-chat-add").is_some());
    assert!(cx.debug_bounds("cloud-agent-invite-step:2").is_some());
    assert!(cx.debug_bounds("cloud-agent-invite-step:3").is_none());
    let group = cx.debug_bounds("cloud-chat-telegram-group").unwrap();
    cx.simulate_click(group.center(), Modifiers::none());
    settle_cloud(&view, cx, "the link", &|s, cx| {
        s.cloud
            .read(cx)
            .chats
            .read(cx)
            .flow
            .as_ref()
            .is_some_and(|f| f.waiting())
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-chat-waiting").is_some());
    assert_eq!(writes(&server)[0].2, json!({"platform": "telegram"}));
    // The chat knocks; the step shows it by name with Deny / Allow.
    {
        let mut s = server.lock().unwrap();
        s.chats.push(chat("c9", "Design team", "asking"));
        s.link_state = "knocked".into();
    }
    view.update(cx, |s, cx| {
        s.cloud
            .update(cx, |c, cx| c.chats.update(cx, |c, cx| c.refresh(cx)))
    });
    settle_cloud(&view, cx, "the knock", &|s, cx| {
        matches!(
            s.cloud
                .read(cx)
                .chats
                .read(cx)
                .flow
                .as_ref()
                .map(|f| &f.stage),
            Some(crate::features::cloud::ChatStage::Knocked(_))
        )
    });
    draw(cx);
    let allow = cx.debug_bounds("cloud-chat-flow-allow").unwrap();
    cx.simulate_click(allow.center(), Modifiers::none());
    settle_cloud(&view, cx, "let in", &|s, cx| {
        matches!(
            s.cloud
                .read(cx)
                .chats
                .read(cx)
                .flow
                .as_ref()
                .map(|f| &f.stage),
            Some(crate::features::cloud::ChatStage::In(_))
        )
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-chat-in").is_some());
    assert!(writes(&server).iter().any(|(_, path, body)| {
        path == "/conversations/c9/decision" && body["decision"] == "allow"
    }));
}

/// A chat's view: three settings with their defaults, the two facts, a
/// banner that freezes the settings, and a removal that asks once.
#[gpui::test]
fn managing_a_chat_asks_once_before_removing_it(cx: &mut TestAppContext) {
    let server: Shared = Arc::new(Mutex::new(ChatServer {
        manage: true,
        chats: vec![chat("c1", "Design team", "active")],
        ..Default::default()
    }));
    let (view, cx) = open(cx, server.clone());
    view.update_in(cx, |s, window, cx| {
        s.cloud
            .update(cx, |c, cx| c.open_chat(Some("c1".into()), window, cx))
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-chat-settings").is_some());
    assert!(cx.debug_bounds("cloud-chat-facts").is_some());
    assert!(cx.debug_bounds("cloud-chat-banner").is_none());
    view.read_with(cx, |s, cx| {
        let chats = s.cloud.read(cx).chats.read(cx);
        let chat = chats.managed().unwrap();
        assert_eq!(
            chat.who_can_ask,
            crate::workspace::cloud::chat_apps::WhoCanAsk::Owner
        );
        assert_eq!(chat.daily_limit_units, Some(60));
    });
    let remove = cx.debug_bounds("cloud-chat-remove").unwrap();
    cx.simulate_click(remove.center(), Modifiers::none());
    draw(cx);
    assert!(cx.debug_bounds("cloud-chat-remove-confirm").is_some());
    assert!(writes(&server).is_empty(), "the first press only asks");
    let yes = cx.debug_bounds("cloud-chat-remove-yes").unwrap();
    cx.simulate_click(yes.center(), Modifiers::none());
    settle_cloud(&view, cx, "removed", &|s, cx| {
        s.cloud.read(cx).chats.read(cx).chats.is_empty()
    });
    assert_eq!(writes(&server)[0].0, "DELETE");
}

/// Today's limit reached shows its banner; the owner gone freezes the rows
/// behind "Take over".
#[gpui::test]
fn banners_say_why_it_stopped_and_freeze_the_settings(cx: &mut TestAppContext) {
    let mut left = chat("c1", "Design team", "active");
    left["stopped_reason"] = "owner_left".into();
    let server: Shared = Arc::new(Mutex::new(ChatServer {
        manage: true,
        chats: vec![left],
        ..Default::default()
    }));
    let (view, cx) = open(cx, server.clone());
    view.update_in(cx, |s, window, cx| {
        s.cloud
            .update(cx, |c, cx| c.open_chat(Some("c1".into()), window, cx))
    });
    draw(cx);
    let banner = cx.debug_bounds("cloud-chat-banner").unwrap();
    assert!(banner.size.height > px(0.));
    // A frozen row sends nothing.
    view.update(cx, |s, cx| {
        let chats = s.cloud.read(cx).chats.clone();
        assert_eq!(
            crate::app::cloud_agents_ui::banner_of(chats.read(cx).managed().unwrap()),
            Some("owner_left")
        );
    });
    let take = cx.debug_bounds("cloud-chat-banner-action").unwrap();
    cx.simulate_click(take.center(), Modifiers::none());
    settle_cloud(&view, cx, "taken over", &|_, _| true);
    assert!(
        writes(&server)
            .iter()
            .any(|(m, p, _)| m == "POST" && p == "/conversations/c1/owner")
    );
}

/// The name is edited in place: Enter saves and Escape keeps the old one.
#[gpui::test]
fn a_chat_is_renamed_in_place(cx: &mut TestAppContext) {
    let server: Shared = Arc::new(Mutex::new(ChatServer {
        manage: true,
        chats: vec![chat("c1", "WeCom group", "active")],
        ..Default::default()
    }));
    let (view, cx) = open(cx, server.clone());
    view.update_in(cx, |s, window, cx| {
        s.cloud.update(cx, |c, cx| {
            c.open_chat(Some("c1".into()), window, cx);
            c.rename_chat_for_test("c1", "Launch", window, cx);
        })
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-chat-rename").is_some());
    command(&view, cx, Command::Escape);
    draw(cx);
    assert!(cx.debug_bounds("cloud-chat-rename").is_none());
    assert!(writes(&server).is_empty(), "Escape keeps the old name");
    view.update_in(cx, |s, window, cx| {
        s.cloud.update(cx, |c, cx| {
            c.rename_chat_for_test("c1", "Launch", window, cx);
            c.save_chat_name(cx);
        })
    });
    settle_cloud(&view, cx, "renamed", &|s, cx| {
        s.cloud
            .read(cx)
            .chats
            .read(cx)
            .chat("c1")
            .is_some_and(|c| c.display_name == "Launch")
    });
    let sent: Vec<_> = writes(&server)
        .into_iter()
        .map(|(_, _, body)| body)
        .collect();
    assert_eq!(sent, [json!({"display_name": "Launch"})]);
}
