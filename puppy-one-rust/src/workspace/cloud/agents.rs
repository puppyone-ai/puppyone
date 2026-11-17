//! `share/agentLinks.ts` and `useWorkspaceAgents.resolveWorkspaceAgents`:
//! the Agents connected to a hosted workspace, the ones asking to join, and
//! the invites that let them in. An invite is made only when its prompt is
//! copied, so looking mints nothing; it lets one Agent in after the owner
//! allows it and is then spent, so there are no links to look after. Only
//! the owner may read or change any of it.
use super::services::{Error, Result, Transport, decode, segment};
use crate::cloud::auth::model::ApiRequest;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;

/// An Agent works in bursts: a command, then a pause while it thinks, then
/// the next. "Running a command at this instant" would be false for much of
/// a busy task, so a recent command still counts.
const ACTIVE_GRACE_MS: i64 = 120_000;
/// How much of an invite's secret is shown; the rest is masked, as it is the
/// key to the project.
const SHOWN_SECRET: usize = 8;
/// The part of the link only copying makes, shown as what it is: not made.
pub const UNMADE: &str = "••••••";
/// `INVITABLE_AGENTS`: an invite asks the Agent to make its own key and
/// connect, so only Agents that run commands can follow one.
pub const INVITABLE: [&str; 8] = [
    "claude",
    "codex",
    "cursor",
    "gemini",
    "github-copilot",
    "opencode",
    "hermes",
    "devin",
];

/// Who a link lets in: an Agent its owner allows, or any Agent holding it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Admission {
    SignIn,
    Link,
}
impl Admission {
    fn wire(self) -> &'static str {
        match self {
            Self::SignIn => "sign_in",
            Self::Link => "link",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct ConnectedAgent {
    pub id: String,
    pub name: String,
    /// The picture the Agent chose from the server's list when it
    /// connected: a brand the Desktop draws, or "other". Absent when it
    /// chose nothing, and from servers that predate the choice.
    #[serde(default)]
    pub avatar: Option<String>,
    pub admission: Admission,
    pub grant_id: String,
    #[serde(default)]
    pub connected_at: String,
    #[serde(default)]
    pub expires_at: Option<String>,
}
/// An Agent that followed a sign-in link and waits for the owner.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct AgentRequest {
    pub id: String,
    pub name: String,
    /// As on a connected Agent, so the owner sees it before allowing it.
    #[serde(default)]
    pub avatar: Option<String>,
    pub admission: Admission,
    pub requested_at: String,
    #[serde(default)]
    pub expires_at: String,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Link {
    pub id: String,
    pub admission: Admission,
    pub expires_at: String,
}
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Inventory {
    #[serde(default)]
    pub links: Vec<Link>,
    /// The deployment decides whether a link may admit without sign-in.
    #[serde(default)]
    pub open_links_enabled: bool,
    #[serde(default)]
    pub connections: Vec<ConnectedAgent>,
    /// Absent from servers that predate it.
    #[serde(default)]
    pub pending: Vec<AgentRequest>,
}
/// One connection to the workspace, kept open across the commands an Agent
/// runs over it.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Session {
    pub grant_id: String,
    pub state: String,
    pub created_at: String,
    #[serde(default)]
    pub closed_at: Option<String>,
    pub lease_until: String,
    /// Commands running over it now. Absent from servers that predate it.
    #[serde(default)]
    pub commands_running: Option<u32>,
    /// When its last command started or ended; none before its first.
    #[serde(default)]
    pub last_command_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WorkspaceAgent {
    pub agent: ConnectedAgent,
    pub active: bool,
    pub last_active_at: Option<String>,
    /// False when the sessions could not be read, which is not the same as
    /// there being none.
    pub activity_known: bool,
}

fn millis(iso: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(iso)
        .ok()
        .map(|t| t.timestamp_millis())
}
/// `resolveWorkspaceAgents`: at work means running commands, not being
/// connected — one connection now stays open across many. A server that
/// does not report commands only says when a connection opened or closed,
/// which is all an older one can tell. A lapsed lease is a connection nobody
/// closed, not one in use.
pub fn resolve(
    connections: &[ConnectedAgent],
    sessions: Option<&[Session]>,
    now_ms: i64,
) -> Vec<WorkspaceAgent> {
    connections
        .iter()
        .map(|agent| {
            let Some(sessions) = sessions else {
                return WorkspaceAgent {
                    agent: agent.clone(),
                    active: false,
                    last_active_at: None,
                    activity_known: false,
                };
            };
            let mut last: Option<(i64, &str)> = None;
            let mut active = false;
            for session in sessions.iter().filter(|s| s.grant_id == agent.grant_id) {
                let reports_commands = session.commands_running.is_some();
                let at = if reports_commands {
                    session.last_command_at.as_deref()
                } else {
                    Some(session.closed_at.as_deref().unwrap_or(&session.created_at))
                };
                if let Some(at) = at
                    && let Some(ms) = millis(at)
                    && last.is_none_or(|(known, _)| ms > known)
                {
                    last = Some((ms, at));
                }
                let open = session.state != "closed"
                    && millis(&session.lease_until).is_some_and(|lease| lease > now_ms);
                if open && (!reports_commands || session.commands_running.unwrap_or(0) > 0) {
                    active = true;
                }
            }
            if last.is_some_and(|(ms, _)| now_ms - ms < ACTIVE_GRACE_MS) {
                active = true;
            }
            WorkspaceAgent {
                agent: agent.clone(),
                active,
                last_active_at: last.map(|(_, at)| at.to_owned()),
                activity_known: true,
            }
        })
        .collect()
}

/// `agentConnectMessage`: what the person pastes. It stays in English
/// because the Agent reads it, not the person.
pub fn connect_message(project_name: &str, url: &str) -> String {
    format!("Connect to my puppyone project \"{project_name}\" by following {url}")
}
/// `linkPreview`: where the link will point, so the prompt reads true up to
/// the part only copying makes.
pub fn link_preview(api: &str) -> String {
    url::Url::parse(api)
        .map(|url| format!("{}/agent/", url.origin().ascii_serialization()))
        .unwrap_or_default()
}
/// `maskSecret`: the link as shown, its last segment, the secret, keeping
/// only its start.
pub fn mask_secret(url: &str) -> String {
    let cut = url.rfind('/').map_or(0, |i| i + 1);
    let secret = &url[cut..];
    if secret.chars().count() > SHOWN_SECRET {
        let shown: String = secret.chars().take(SHOWN_SECRET).collect();
        format!("{}{shown}{UNMADE}", &url[..cut])
    } else {
        url.to_owned()
    }
}
/// `invitationSecret`: 32 random bytes.
fn invitation_secret() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("system randomness");
    format!("pai_{}", URL_SAFE_NO_PAD.encode(bytes))
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
    /// `createAgentLink`: the owner's workspace proves who may share; an
    /// admitted Agent gets a machine of its own.
    pub fn create_link(&self, project: &str, admission: Admission) -> Result<String> {
        let project = segment(project)?;
        let workbench = self.send(Method::GET, format!("/projects/{project}/workbench"), None)?;
        let workbench = super::services::unwrap(workbench);
        let Some(workbench) = workbench["workspace"]["id"].as_str() else {
            return Err(Error::Status(409));
        };
        let created = self.send(
            Method::POST,
            format!("/projects/{project}/agent-links"),
            Some(json!({
                "id": uuid::Uuid::new_v4().to_string(),
                "secret": invitation_secret(),
                "workbench_id": workbench,
                "admission": admission.wire(),
            })),
        )?;
        super::services::unwrap(created)["agent_url"]
            .as_str()
            .filter(|url| url.starts_with("https://") || url.starts_with("http://"))
            .map(str::to_owned)
            .ok_or(Error::Invalid("agent link"))
    }
    pub fn links(&self, project: &str) -> Result<Inventory> {
        let path = format!("/projects/{}/agent-links", segment(project)?);
        decode(self.send(Method::GET, path, None)?, "agent links")
    }
    pub fn sessions(&self, project: &str) -> Result<Vec<Session>> {
        let path = format!("/projects/{}/access/sessions", segment(project)?);
        decode(self.send(Method::GET, path, None)?, "agent sessions")
    }
    /// `removeConnectedAgent`: its grant is revoked.
    pub fn remove(&self, project: &str, grant: &str) -> Result<()> {
        let path = format!(
            "/projects/{}/access/grants/{}",
            segment(project)?,
            segment(grant)?
        );
        self.send(Method::PATCH, path, Some(json!({"state": "revoked"})))
            .map(drop)
    }
    /// `decideAgentRequest`: allowing one ends the wait of others on its link.
    pub fn decide(&self, connection: &str, allow: bool) -> Result<()> {
        let path = format!("/agent-links/connections/{}/decision", segment(connection)?);
        let decision = if allow { "approve" } else { "reject" };
        self.send(Method::POST, path, Some(json!({"decision": decision})))
            .map(drop)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::sync::Mutex;

    const NOW: i64 = 1_793_361_600_000; // 2026-10-30T12:00:00Z
    fn at(seconds_ago: i64) -> String {
        chrono::DateTime::from_timestamp_millis(NOW - seconds_ago * 1000)
            .unwrap()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    }
    fn agent() -> ConnectedAgent {
        ConnectedAgent {
            id: "c1".into(),
            name: "秘书小陈".into(),
            avatar: None,
            admission: Admission::SignIn,
            grant_id: "g1".into(),
            connected_at: at(9000),
            expires_at: Some("2026-11-29T00:00:00Z".into()),
        }
    }
    fn closed(grant: &str, seconds_ago: i64) -> Session {
        Session {
            grant_id: grant.into(),
            state: "closed".into(),
            created_at: at(seconds_ago + 1),
            closed_at: Some(at(seconds_ago)),
            lease_until: at(seconds_ago - 30),
            ..Default::default()
        }
    }
    fn one(sessions: Option<&[Session]>) -> WorkspaceAgent {
        resolve(&[agent()], sessions, NOW).remove(0)
    }

    #[test]
    fn what_the_header_says_about_an_agent() {
        // Active while a session is open.
        let open = Session {
            grant_id: "g1".into(),
            state: "active".into(),
            created_at: at(900),
            closed_at: None,
            lease_until: at(-30),
            ..Default::default()
        };
        assert!(one(Some(&[open])).active);
        // Still active between the one-second connections of a task.
        assert!(one(Some(&[closed("g1", 60)])).active);
        // Quiet once it has really stopped, and it remembers when.
        let quiet = one(Some(&[closed("g1", 600), closed("g1", 3000)]));
        assert!(!quiet.active);
        assert_eq!(quiet.last_active_at, Some(at(600)));
        // A session nobody closed whose lease ran out.
        let abandoned = Session {
            grant_id: "g1".into(),
            state: "active".into(),
            created_at: at(4000),
            closed_at: None,
            lease_until: at(3900),
            ..Default::default()
        };
        assert!(!one(Some(&[abandoned])).active);
        // Never another Agent's session.
        let other = one(Some(&[closed("g2", 5)]));
        assert!(!other.active && other.last_active_at.is_none());
        // Unreadable sessions are not "none".
        assert!(!one(None).activity_known);
        assert!(one(Some(&[])).activity_known);
        // A server that reports commands: connected but idle is at rest,
        // and only a command counts as activity.
        let idle = Session {
            grant_id: "g1".into(),
            state: "active".into(),
            created_at: at(9000),
            lease_until: at(-30),
            commands_running: Some(0),
            last_command_at: Some(at(1200)),
            ..Default::default()
        };
        let quiet = one(Some(std::slice::from_ref(&idle)));
        assert!(!quiet.active);
        assert_eq!(quiet.last_active_at, Some(at(1200)));
        let running = Session {
            commands_running: Some(1),
            ..idle.clone()
        };
        assert!(one(Some(&[running])).active);
        // Within two minutes of its last command it still counts.
        let between = Session {
            last_command_at: Some(at(60)),
            ..idle.clone()
        };
        assert!(one(Some(&[between])).active);
        let never = Session {
            last_command_at: None,
            ..idle
        };
        let fresh = one(Some(&[never]));
        assert!(!fresh.active && fresh.last_active_at.is_none());
    }

    #[test]
    fn an_invite_shows_only_the_start_of_its_secret() {
        assert_eq!(
            mask_secret("https://api.puppyone.ai/agent/pai_abcdefghijk"),
            format!("https://api.puppyone.ai/agent/pai_abcd{UNMADE}")
        );
        assert_eq!(
            mask_secret("https://api.puppyone.ai/agent/short"),
            "https://api.puppyone.ai/agent/short"
        );
    }

    struct Recorded(Mutex<Vec<ApiRequest>>, Vec<Value>);
    impl Transport for Recorded {
        fn request(&self, request: ApiRequest) -> Result<Value> {
            let mut seen = self.0.lock().unwrap();
            let reply = self.1.get(seen.len()).cloned().unwrap_or(Value::Null);
            seen.push(request);
            Ok(reply)
        }
    }

    #[test]
    fn a_link_is_made_for_the_running_workspace_and_its_prompt_names_the_project() {
        let transport = Arc::new(Recorded(
            Default::default(),
            vec![
                json!({"code": 0, "data": {"workspace": {"id": "wb-1"}}}),
                json!({"data": {"agent_url": "https://api.puppyone.ai/agent/x"}}),
            ],
        ));
        let client = Client::new(transport.clone());
        let url = client.create_link("p1", Admission::SignIn).unwrap();
        assert_eq!(
            connect_message("Docs", &url),
            "Connect to my puppyone project \"Docs\" by following https://api.puppyone.ai/agent/x"
        );
        let seen = transport.0.lock().unwrap();
        assert_eq!(seen[0].path, "/projects/p1/workbench");
        assert_eq!(
            (seen[1].method.clone(), seen[1].path.as_str()),
            (Method::POST, "/projects/p1/agent-links")
        );
        let body = seen[1].body.as_ref().unwrap();
        assert_eq!(body["workbench_id"], "wb-1");
        assert_eq!(body["admission"], "sign_in");
        let secret = body["secret"].as_str().unwrap();
        assert!(secret.starts_with("pai_") && secret.len() == 4 + 43);
        assert!(uuid::Uuid::parse_str(body["id"].as_str().unwrap()).is_ok());
        drop(seen);
        // No hosted workspace, no link.
        let none = Client::new(Arc::new(Recorded(
            Default::default(),
            vec![json!({"workspace": null})],
        )));
        assert_eq!(
            none.create_link("p1", Admission::Link),
            Err(Error::Status(409))
        );
        assert_eq!(
            link_preview("https://api.puppyone.ai/api/v1"),
            "https://api.puppyone.ai/agent/"
        );
    }

    #[test]
    fn the_inventory_tolerates_servers_that_predate_requests() {
        let client = Client::new(Arc::new(Recorded(
            Default::default(),
            vec![
                json!({"links": [], "connections": [{"id": "c1", "name": "Codex",
                "admission": "link", "grant_id": "g1", "connected_at": "2026-10-30T12:00:00Z",
                "expires_at": null}]}),
            ],
        )));
        let inventory = client.links("p1").unwrap();
        assert!(inventory.pending.is_empty() && !inventory.open_links_enabled);
        assert_eq!(inventory.connections[0].admission, Admission::Link);
    }

    #[test]
    fn owner_changes_use_the_products_requests() {
        let transport = Arc::new(Recorded(Default::default(), vec![]));
        let client = Client::new(transport.clone());
        client.remove("p1", "g1").unwrap();
        client.decide("r1", false).unwrap();
        assert!(client.remove("p1", "../x").is_err());
        let seen = transport.0.lock().unwrap();
        let calls: Vec<_> = seen
            .iter()
            .map(|r| (r.method.as_str().to_owned(), r.path.clone(), r.body.clone()))
            .collect();
        assert_eq!(
            calls,
            vec![
                (
                    "PATCH".into(),
                    "/projects/p1/access/grants/g1".into(),
                    Some(json!({"state": "revoked"}))
                ),
                (
                    "POST".into(),
                    "/agent-links/connections/r1/decision".into(),
                    Some(json!({"decision": "reject"}))
                ),
            ]
        );
    }
}
