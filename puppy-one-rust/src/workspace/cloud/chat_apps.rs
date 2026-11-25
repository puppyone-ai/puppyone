//! A project's Cloud Agent in Telegram, Slack and WeCom chats: the chats it is
//! in, the one-time links that let a chat knock, and the manager's changes.
//! Contract: `puppyone-cloud` `/api/v1/projects/{project}/chat-apps` (09-chat-apps.md).
//! Reading needs AGENT_READ; everything else AGENT_MANAGE. No route returns a
//! customer secret, and none is kept here after it is sent.
use super::services::{Result, Transport, decode, segment};
use crate::cloud::auth::model::ApiRequest;
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Telegram,
    Slack,
    Wecom,
}
impl Platform {
    pub const ALL: [Platform; 3] = [Self::Telegram, Self::Slack, Self::Wecom];
    pub fn wire(self) -> &'static str {
        match self {
            Self::Telegram => "telegram",
            Self::Slack => "slack",
            Self::Wecom => "wecom",
        }
    }
    /// The app's own name; not translated.
    pub fn name(self) -> &'static str {
        match self {
            Self::Telegram => "Telegram",
            Self::Slack => "Slack",
            Self::Wecom => "WeCom",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WhoCanAsk {
    Owner,
    Project,
    Anyone,
}
impl WhoCanAsk {
    pub fn wire(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Project => "project",
            Self::Anyone => "anyone",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stopped {
    OwnerLeft,
    RemovedThere,
}

/// One group, channel or direct chat the Agent is in, or asking to join.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Chat {
    pub id: String,
    pub platform: Platform,
    #[serde(default)]
    pub connection_id: Option<String>,
    pub chat_kind: String,
    pub display_name: String,
    /// WeCom: the code the knock carried ("WeCom group · sent 482731").
    #[serde(default)]
    pub knock_hint: Option<String>,
    /// `asking` until a manager allows it, then `active`.
    pub state: String,
    pub enabled: bool,
    pub owner_user_id: String,
    #[serde(default)]
    pub owner_name: Option<String>,
    pub who_can_ask: WhoCanAsk,
    /// Minutes per UTC day; none is no limit.
    #[serde(default)]
    pub daily_limit_units: Option<u32>,
    #[serde(default)]
    pub stopped_reason: Option<Stopped>,
    #[serde(default)]
    pub used_today_units: u32,
    #[serde(default)]
    pub working: bool,
    /// The space ran out of Agent hours on this chat's last question.
    #[serde(default)]
    pub no_hours: bool,
    #[serde(default)]
    pub last_activity_at: Option<String>,
    /// Slack workspace / WeCom bot name.
    #[serde(default)]
    pub workspace_name: Option<String>,
}
impl Chat {
    pub fn asking(&self) -> bool {
        self.state == "asking"
    }
    pub fn group(&self) -> bool {
        self.chat_kind != "dm"
    }
    pub fn limit_reached(&self) -> bool {
        self.daily_limit_units
            .is_some_and(|limit| self.used_today_units >= limit)
    }
}

/// A Slack workspace or WeCom bot this space installed.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Connection {
    pub id: String,
    pub platform: Platform,
    pub display_name: String,
    /// `pending`, `active`, `failed`, `displaced` or `revoked`.
    pub status: String,
    /// This person is known in it (Slack: installed it themselves).
    #[serde(default)]
    pub linked_me: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Chats {
    #[serde(default)]
    pub can_manage: bool,
    #[serde(default)]
    pub conversations: Vec<Chat>,
    #[serde(default)]
    pub connections: Vec<Connection>,
    /// Apps this deployment has switched on; none means the feature is off.
    #[serde(default)]
    pub platforms: Vec<Platform>,
    /// How people mention it in each app (Telegram: the bot's username).
    #[serde(default)]
    pub mentions: std::collections::HashMap<Platform, String>,
}

/// Where one wait for a chat stands.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Link {
    pub id: String,
    pub purpose: String,
    pub platform: Platform,
    #[serde(default)]
    pub connection_id: Option<String>,
    pub expires_at: String,
    /// `waiting`, `knocked`, `done` (Slack installed) or `expired`.
    pub state: String,
    #[serde(default)]
    pub conversation: Option<Chat>,
    #[serde(default)]
    pub connection: Option<Connection>,
}

/// What starting gives back: the wait and the one thing to do with it.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Started {
    pub link: Link,
    /// Telegram: `group` and `dm` links that carry the code.
    #[serde(default)]
    pub links: Option<TelegramLinks>,
    /// WeCom: the six digits to send in the group.
    #[serde(default)]
    pub code: Option<String>,
    /// Slack: the line to send in the channel.
    #[serde(default)]
    pub invite: Option<String>,
    /// Slack: the browser page that installs the app.
    #[serde(default)]
    pub install_url: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct TelegramLinks {
    pub group: String,
    pub dm: String,
}

/// A change to one chat; only what is set is sent.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Change {
    pub enabled: Option<bool>,
    pub who_can_ask: Option<WhoCanAsk>,
    /// `Some(None)` is no limit.
    pub daily_limit_units: Option<Option<u32>>,
    pub display_name: Option<String>,
}
impl Change {
    fn body(&self) -> Value {
        let mut body = Map::new();
        if let Some(enabled) = self.enabled {
            body.insert("enabled".into(), enabled.into());
        }
        if let Some(who) = self.who_can_ask {
            body.insert("who_can_ask".into(), who.wire().into());
        }
        if let Some(limit) = self.daily_limit_units {
            body.insert("daily_limit_units".into(), json!(limit));
        }
        if let Some(name) = &self.display_name {
            body.insert("display_name".into(), name.trim().into());
        }
        Value::Object(body)
    }
}

/// Links only go to the app's own pages, or to a loopback development
/// stand-in (the same rule the Cloud endpoints follow): anything else is not
/// opened.
pub fn trusted_link(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|u| match (u.scheme(), u.host_str()) {
        ("https", Some(h)) => h == "t.me" || h == "slack.com" || h.ends_with(".slack.com"),
        ("http", Some(h)) => h == "127.0.0.1" || h == "localhost",
        _ => false,
    })
}

#[derive(Clone)]
pub struct Client {
    transport: Arc<dyn Transport>,
}
impl Client {
    pub fn new(transport: Arc<dyn Transport>) -> Self {
        Self { transport }
    }
    fn send(&self, method: Method, path: String, body: Option<Value>) -> Result<Value> {
        self.transport.request(ApiRequest {
            method,
            path,
            query: vec![],
            body,
            idempotency_key: None,
        })
    }
    fn base(project: &str) -> Result<String> {
        Ok(format!("/projects/{}/chat-apps", segment(project)?))
    }
    pub fn chats(&self, project: &str) -> Result<Chats> {
        decode(self.send(Method::GET, Self::base(project)?, None)?, "chats")
    }
    /// Telegram and WeCom wait for a knock; Slack installs once per
    /// workspace (no connection) or waits in an installed one.
    pub fn start(
        &self,
        project: &str,
        platform: Platform,
        connection: Option<&str>,
    ) -> Result<Started> {
        let mut body = json!({"platform": platform.wire()});
        if let Some(connection) = connection {
            body["connection_id"] = segment(connection)?.into();
        }
        let path = format!("{}/links", Self::base(project)?);
        decode(self.send(Method::POST, path, Some(body))?, "chat link")
    }
    pub fn link(&self, project: &str, link: &str) -> Result<Link> {
        let path = format!("{}/links/{}", Self::base(project)?, segment(link)?);
        decode(self.send(Method::GET, path, None)?, "chat link")
    }
    /// WeCom: the bot's ID and secret, sent once and never read back.
    pub fn connect(&self, project: &str, bot_id: &str, secret: &str) -> Result<Connection> {
        let path = format!("{}/connections", Self::base(project)?);
        let body = json!({"platform": "wecom", "bot_id": bot_id.trim(), "secret": secret.trim()});
        decode(
            self.send(Method::POST, path, Some(body))?,
            "chat connection",
        )
    }
    pub fn decide(&self, project: &str, chat: &str, allow: bool) -> Result<Chat> {
        let path = format!(
            "{}/conversations/{}/decision",
            Self::base(project)?,
            segment(chat)?
        );
        let decision = if allow { "allow" } else { "deny" };
        decode(
            self.send(Method::POST, path, Some(json!({"decision": decision})))?,
            "chat",
        )
    }
    pub fn change(&self, project: &str, chat: &str, change: &Change) -> Result<Chat> {
        let path = format!("{}/conversations/{}", Self::base(project)?, segment(chat)?);
        decode(self.send(Method::PATCH, path, Some(change.body()))?, "chat")
    }
    pub fn take_over(&self, project: &str, chat: &str) -> Result<Chat> {
        let path = format!(
            "{}/conversations/{}/owner",
            Self::base(project)?,
            segment(chat)?
        );
        decode(self.send(Method::POST, path, None)?, "chat")
    }
    pub fn remove(&self, project: &str, chat: &str) -> Result<()> {
        let path = format!("{}/conversations/{}", Self::base(project)?, segment(chat)?);
        self.send(Method::DELETE, path, None).map(drop)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::sync::Mutex;

    struct Recorded(Mutex<Vec<ApiRequest>>, Mutex<Vec<Value>>);
    impl Transport for Recorded {
        fn request(&self, request: ApiRequest) -> Result<Value> {
            self.0.lock().unwrap().push(request);
            Ok(self.1.lock().unwrap().remove(0))
        }
    }
    fn chat() -> Value {
        json!({"id": "c1", "platform": "telegram", "chat_kind": "group",
               "display_name": "Design team", "state": "active", "enabled": true,
               "owner_user_id": "u1", "who_can_ask": "owner", "daily_limit_units": 60,
               "used_today_units": 60})
    }

    #[test]
    fn requests_follow_the_contract() {
        let link = json!({"id": "l1", "purpose": "knock", "platform": "telegram",
                          "expires_at": "2026-11-25T12:10:00Z", "state": "waiting"});
        let transport = Arc::new(Recorded(
            Default::default(),
            Mutex::new(vec![
                json!({"can_manage": true, "conversations": [chat()], "platforms": ["telegram"]}),
                json!({"link": link, "links": {"group": "https://t.me/b?startgroup=x",
                                                "dm": "https://t.me/b?start=x"}}),
                chat(),
                chat(),
                json!({}),
            ]),
        ));
        let client = Client::new(transport.clone());
        let chats = client.chats("p1").unwrap();
        assert!(chats.can_manage && chats.conversations[0].limit_reached());
        let started = client.start("p1", Platform::Telegram, None).unwrap();
        assert_eq!(started.link.state, "waiting");
        client.decide("p1", "c1", true).unwrap();
        client
            .change(
                "p1",
                "c1",
                &Change {
                    daily_limit_units: Some(None),
                    display_name: Some(" Launch ".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        client.remove("p1", "c1").unwrap();
        let seen = transport.0.lock().unwrap();
        let calls: Vec<_> = seen
            .iter()
            .map(|r| (r.method.as_str().to_owned(), r.path.clone()))
            .collect();
        assert_eq!(
            calls,
            [
                ("GET", "/projects/p1/chat-apps"),
                ("POST", "/projects/p1/chat-apps/links"),
                ("POST", "/projects/p1/chat-apps/conversations/c1/decision"),
                ("PATCH", "/projects/p1/chat-apps/conversations/c1"),
                ("DELETE", "/projects/p1/chat-apps/conversations/c1"),
            ]
            .map(|(m, p)| (m.to_owned(), p.to_owned()))
        );
        assert_eq!(seen[1].body, Some(json!({"platform": "telegram"})));
        assert_eq!(seen[2].body, Some(json!({"decision": "allow"})));
        assert_eq!(
            seen[3].body,
            Some(json!({"daily_limit_units": null, "display_name": "Launch"}))
        );
    }

    #[test]
    fn identifiers_never_escape_their_path_segment() {
        let client = Client::new(Arc::new(Recorded(Default::default(), Default::default())));
        assert!(client.chats("../x").is_err());
        assert!(client.remove("p1", "a/b").is_err());
    }

    #[test]
    fn only_the_apps_own_pages_are_opened() {
        assert!(trusted_link("https://t.me/PuppyOneBot?startgroup=abc"));
        assert!(trusted_link("https://slack.com/oauth/v2/authorize?x=1"));
        assert!(!trusted_link("http://t.me/x"));
        assert!(trusted_link(
            "http://127.0.0.1:9911/oauth/v2/authorize?state=x"
        ));
        assert!(!trusted_link("http://10.0.0.1/oauth"));
        assert!(!trusted_link("https://evil.example/t.me"));
    }
}
