//! The Cloud services dialog's API (`lib/cloudApi.ts`, `accessSurfacesApi`,
//! `resourceDashboardApi`). Every response is held to the Project and
//! identity asked for; a Dashboard row never carries a credential; a
//! one-time credential is returned to its caller and never stored here.
use crate::cloud_auth::{
    self as auth, Broker, Cancellation,
    model::{ApiRequest, Binding},
};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Arc};

#[derive(Clone, Debug, PartialEq)]
pub enum Error {
    /// The server answered with this status.
    Status(u16),
    /// A mutation's outcome is unknown; never repeated automatically.
    Unknown,
    /// The response broke the contract.
    Invalid(&'static str),
    Unavailable,
}
impl Error {
    fn from_auth(error: auth::Error) -> Self {
        match error {
            auth::Error::Http(s) | auth::Error::Service(s, _) | auth::Error::Response(s, _) => {
                Self::Status(s)
            }
            auth::Error::InvalidCredentials => Self::Status(401),
            auth::Error::OutcomeUnknown => Self::Unknown,
            _ => Self::Unavailable,
        }
    }
}
pub type Result<T> = std::result::Result<T, Error>;

pub trait Transport: Send + Sync {
    fn request(&self, request: ApiRequest) -> Result<Value>;
}
pub struct BrokerTransport {
    pub broker: Arc<Broker>,
    pub binding: Binding,
    pub cancel: Cancellation,
}
impl Transport for BrokerTransport {
    fn request(&self, request: ApiRequest) -> Result<Value> {
        self.broker
            .request_scoped(&self.binding, &request, &self.cancel)
            .map_err(Error::from_auth)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub visibility: Option<String>,
    #[serde(default)]
    pub bound_git_branch: Option<String>,
}
impl Project {
    pub fn can(&self, capability: &str) -> bool {
        self.capabilities.iter().any(|c| c == capability)
    }
}
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Nodes {
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub folders: u64,
    #[serde(default)]
    pub files: u64,
    #[serde(default)]
    pub storage_bytes: Option<u64>,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct DashboardProject {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Dashboard {
    pub project: DashboardProject,
    pub nodes: Nodes,
    pub resources: Vec<Value>,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct TreeEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub children_count: Option<u64>,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Tree {
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub entries: Vec<TreeEntry>,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Scope {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub exclude: Vec<String>,
    pub max_mode: String,
}
/// `RepositoryTarget`: exactly the reviewed keys.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Target {
    ProjectRoot {
        project_id: String,
    },
    Scope {
        project_id: String,
        scope_id: String,
    },
}
impl Target {
    pub fn project(&self) -> &str {
        match self {
            Self::ProjectRoot { project_id } | Self::Scope { project_id, .. } => project_id,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Surface {
    pub id: String,
    pub project_id: String,
    pub target: Target,
    pub kind: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub config: Value,
    #[serde(default)]
    pub last_activity_at: Option<String>,
    #[serde(default)]
    pub error_message: Option<String>,
    #[serde(default)]
    pub has_key: Option<bool>,
    #[serde(default)]
    pub key_last4: Option<String>,
}
const SURFACE_KINDS: [&str; 7] = [
    "git_remote",
    "cli",
    "agent",
    "mcp",
    "mcp_endpoint",
    "sandbox",
    "sandbox_endpoint",
];
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct McpEndpoint {
    pub id: String,
    pub project_id: String,
    #[serde(default)]
    pub path: Option<String>,
    pub name: String,
    #[serde(default)]
    pub api_key_hint: Option<String>,
    /// Present only in a creation receipt.
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub status: String,
}
/// `buildMcpServerUrl`: the public proxy, on the API's origin. The bearer
/// credential travels apart from it, never in the URL.
pub fn mcp_server_url(api: &str) -> String {
    let Ok(url) = url::Url::parse(api) else {
        return String::new();
    };
    format!(
        "{}/api/v1/mcp/proxy",
        &url[url::Position::BeforeScheme..url::Position::AfterPort]
    )
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct IdentityScope {
    pub id: String,
    pub name: String,
    pub path: String,
    pub git_url: String,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Identity {
    pub project_id: String,
    pub url: String,
    #[serde(default)]
    pub content_initialized: bool,
    #[serde(default)]
    pub scopes: Vec<IdentityScope>,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Organization {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub plan: String,
    #[serde(default)]
    pub seat_limit: u64,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Member {
    pub id: String,
    pub user_id: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    pub role: String,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Entitlements {
    pub org_id: String,
    pub plan_id: String,
    pub seat_quantity: u64,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct SeatUsage {
    pub billable_seat_quantity: u64,
}

/// `{code, data}` yields `data`.
fn unwrap(value: Value) -> Value {
    match value {
        Value::Object(mut map) if map.contains_key("data") => {
            map.remove("data").unwrap_or(Value::Null)
        }
        value => value,
    }
}
fn decode<T: serde::de::DeserializeOwned>(value: Value, what: &'static str) -> Result<T> {
    serde_json::from_value(unwrap(value)).map_err(|_| Error::Invalid(what))
}
/// A path segment: nothing that would need escaping reaches a request.
fn segment(id: &str) -> Result<&str> {
    if !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        Ok(id)
    } else {
        Err(Error::Invalid("identifier"))
    }
}
/// `validateResourceDashboard`.
fn dashboard(value: Value, project: &str) -> Result<Dashboard> {
    let value = unwrap(value);
    let parsed: DashboardProject = serde_json::from_value(value["project"].clone())
        .map_err(|_| Error::Invalid("dashboard"))?;
    if parsed.id != project {
        return Err(Error::Invalid("dashboard"));
    }
    let resources = value["resources"]
        .as_array()
        .ok_or(Error::Invalid("dashboard"))?
        .clone();
    let mut seen = HashSet::new();
    for row in &resources {
        let (Some(id), Some(kind)) = (row["resource_id"].as_str(), row["resource_kind"].as_str())
        else {
            return Err(Error::Invalid("dashboard"));
        };
        if id.trim().is_empty() || !matches!(kind, "synchronize" | "access") {
            return Err(Error::Invalid("dashboard"));
        }
        // A summary never carries a credential.
        if row.get("access_key").is_some() || row.get("api_key").is_some() {
            return Err(Error::Invalid("dashboard"));
        }
        if !seen.insert(format!("{kind}:{id}")) {
            return Err(Error::Invalid("dashboard"));
        }
    }
    Ok(Dashboard {
        project: parsed,
        nodes: serde_json::from_value(value["nodes"].clone()).unwrap_or_default(),
        resources,
    })
}
/// `validate` / `inventory`: exact identity, no duplicates, no foreign target.
fn inventory(value: Value, project: &str) -> Result<Vec<Surface>> {
    let rows: Vec<Surface> = decode(value, "access")?;
    let mut seen = HashSet::new();
    for row in &rows {
        if row.id.trim().is_empty()
            || row.project_id != project
            || row.target.project() != project
            || !SURFACE_KINDS.contains(&row.kind.as_str())
            || !seen.insert(row.id.clone())
        {
            return Err(Error::Invalid("access"));
        }
    }
    Ok(rows)
}

/// Requests for one Project (and the account's organizations).
#[derive(Clone)]
pub struct Client {
    transport: Arc<dyn Transport>,
}
impl Client {
    pub fn new(transport: Arc<dyn Transport>) -> Self {
        Self { transport }
    }
    fn send(
        &self,
        method: Method,
        path: String,
        query: Vec<(String, String)>,
        body: Option<Value>,
    ) -> Result<Value> {
        self.transport.request(ApiRequest {
            method,
            path,
            query,
            body,
            idempotency_key: None,
        })
    }
    fn get(&self, path: String) -> Result<Value> {
        self.send(Method::GET, path, vec![], None)
    }
    pub fn project(&self, id: &str) -> Result<Project> {
        let project: Project = decode(self.get(format!("/projects/{}", segment(id)?))?, "project")?;
        if project.id != id {
            return Err(Error::Invalid("project"));
        }
        Ok(project)
    }
    pub fn dashboard(&self, id: &str) -> Result<Dashboard> {
        dashboard(
            self.get(format!("/projects/{}/dashboard/resources", segment(id)?))?,
            id,
        )
    }
    pub fn tree(&self, id: &str) -> Result<Tree> {
        decode(
            self.send(
                Method::GET,
                format!("/content/{}/ls", segment(id)?),
                vec![("path".into(), String::new())],
                None,
            )?,
            "tree",
        )
    }
    pub fn scopes(&self, id: &str) -> Result<Vec<Scope>> {
        let rows: Vec<Scope> = decode(
            self.get(format!("/projects/{}/scopes", segment(id)?))?,
            "scopes",
        )?;
        if rows.iter().any(|s| s.project_id != id) {
            return Err(Error::Invalid("scopes"));
        }
        Ok(rows)
    }
    pub fn surfaces(&self, id: &str) -> Result<Vec<Surface>> {
        inventory(
            self.get(format!("/projects/{}/access/surfaces", segment(id)?))?,
            id,
        )
    }
    pub fn mcp_endpoints(&self, id: &str) -> Result<Vec<McpEndpoint>> {
        let rows: Vec<McpEndpoint> = decode(
            self.send(
                Method::GET,
                "/mcp-endpoints".into(),
                vec![("project_id".into(), id.to_owned())],
                None,
            )?,
            "mcp",
        )?;
        if rows.iter().any(|e| e.project_id != id) {
            return Err(Error::Invalid("mcp"));
        }
        Ok(rows)
    }
    pub fn identity(&self, id: &str) -> Result<Identity> {
        let identity: Identity = decode(
            self.get(format!("/projects/{}/access-point", segment(id)?))?,
            "identity",
        )?;
        if identity.project_id != id {
            return Err(Error::Invalid("identity"));
        }
        Ok(identity)
    }
    /// `updateCloudProject`: the fields given, nothing else.
    pub fn update_project(&self, id: &str, fields: Value) -> Result<Project> {
        let path = format!("/projects/{}", segment(id)?);
        let project: Project = decode(
            self.send(Method::PATCH, path, vec![], Some(fields))?,
            "project",
        )?;
        if project.id != id {
            return Err(Error::Invalid("project"));
        }
        Ok(project)
    }
    /// A prepared read (the History page's own requests).
    pub fn raw(&self, request: ApiRequest) -> Result<Value> {
        self.transport.request(request)
    }
    /// `listCloudFolder`: one folder of the Project, for choosing a path.
    pub fn folder(&self, id: &str, path: &str) -> Result<Tree> {
        decode(
            self.send(
                Method::GET,
                format!("/content/{}/ls", segment(id)?),
                vec![("path".into(), path.trim_start_matches('/').to_owned())],
                None,
            )?,
            "tree",
        )
    }
    /// `createCloudScope`.
    pub fn create_scope(&self, project: &str, name: &str, path: &str, mode: &str) -> Result<Scope> {
        let body = json!({"name": name, "path": path, "max_mode": mode, "exclude": []});
        let url = format!("/projects/{}/scopes", segment(project)?);
        let scope: Scope = decode(self.send(Method::POST, url, vec![], Some(body))?, "scopes")?;
        if scope.project_id != project {
            return Err(Error::Invalid("scopes"));
        }
        Ok(scope)
    }
    /// `updateCloudScope`.
    pub fn update_scope(
        &self,
        project: &str,
        scope: &str,
        name: &str,
        mode: &str,
    ) -> Result<Scope> {
        let body = json!({"name": name, "max_mode": mode});
        let url = format!("/projects/{}/scopes/{}", segment(project)?, segment(scope)?);
        let updated: Scope = decode(self.send(Method::PATCH, url, vec![], Some(body))?, "scopes")?;
        if updated.project_id != project || updated.id != scope {
            return Err(Error::Invalid("scopes"));
        }
        Ok(updated)
    }
    /// `deleteCloudScope`: the access scope goes and its credential with it.
    pub fn delete_scope(&self, project: &str, scope: &str) -> Result<()> {
        let url = format!("/projects/{}/scopes/{}", segment(project)?, segment(scope)?);
        self.send(Method::DELETE, url, vec![], None).map(|_| ())
    }
    /// `createCloudMcpEndpoint`: the one read that may carry the key; the
    /// caller shows it once. It never goes into a URL.
    pub fn create_mcp_endpoint(
        &self,
        project: &str,
        path: &str,
        readonly: bool,
    ) -> Result<McpEndpoint> {
        let body = json!({"project_id": project, "path": path, "name": "MCP Server",
            "accesses": [{"path": path, "json_path": "", "readonly": readonly}]});
        let endpoint: McpEndpoint = decode(
            self.send(Method::POST, "/mcp-endpoints".into(), vec![], Some(body))?,
            "mcp",
        )?;
        if endpoint.project_id != project {
            return Err(Error::Invalid("mcp"));
        }
        Ok(endpoint)
    }
    pub fn organizations(&self) -> Result<Vec<Organization>> {
        decode(self.get("/organizations/".into())?, "organizations")
    }
    pub fn members(&self, org: &str) -> Result<Vec<Member>> {
        decode(
            self.get(format!("/organizations/{}/members", segment(org)?))?,
            "members",
        )
    }
    pub fn entitlements(&self, org: &str) -> Result<Entitlements> {
        let value: Entitlements = decode(
            self.get(format!("/organizations/{}/entitlements", segment(org)?))?,
            "entitlements",
        )?;
        if value.org_id != org {
            return Err(Error::Invalid("entitlements"));
        }
        Ok(value)
    }
    pub fn seat_usage(&self, org: &str) -> Result<SeatUsage> {
        decode(
            self.get(format!("/organizations/{}/seat-usage", segment(org)?))?,
            "seats",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    struct Reply(Value);
    impl Transport for Reply {
        fn request(&self, _: ApiRequest) -> Result<Value> {
            Ok(self.0.clone())
        }
    }
    fn client(value: Value) -> Client {
        Client::new(Arc::new(Reply(value)))
    }
    fn surface(id: &str, project: &str) -> Value {
        json!({"id": id, "project_id": project, "kind": "mcp", "status": "active",
            "target": {"kind": "project_root", "project_id": project}})
    }

    #[test]
    fn a_dashboard_must_name_the_project_and_carry_no_credentials() {
        let row = json!({"resource_id": "r1", "resource_kind": "access", "project_id": "p"});
        let ok = json!({"data": {"project": {"id": "p", "name": "N"},
            "nodes": {"total": 3, "folders": 1, "files": 2, "storage_bytes": 42},
            "resources": [row.clone()]}});
        let parsed = client(ok).dashboard("p").unwrap();
        assert_eq!(parsed.nodes.storage_bytes, Some(42));
        let wrong = json!({"project": {"id": "other", "name": "N"}, "resources": []});
        assert!(client(wrong).dashboard("p").is_err());
        let mut secret = row.clone();
        secret["api_key"] = json!("k");
        let leaked = json!({"project": {"id": "p", "name": "N"}, "resources": [secret]});
        assert!(client(leaked).dashboard("p").is_err());
        let twice = json!({"project": {"id": "p", "name": "N"}, "resources": [row.clone(), row]});
        assert!(client(twice).dashboard("p").is_err());
    }

    #[test]
    fn an_access_inventory_is_exact_about_identity_and_target() {
        assert_eq!(
            client(json!([surface("a", "p")]))
                .surfaces("p")
                .unwrap()
                .len(),
            1
        );
        assert!(client(json!([surface("a", "q")])).surfaces("p").is_err());
        assert!(
            client(json!([surface("a", "p"), surface("a", "p")]))
                .surfaces("p")
                .is_err()
        );
        let mut foreign = surface("a", "p");
        foreign["target"]["project_id"] = json!("q");
        assert!(client(json!([foreign])).surfaces("p").is_err());
        let mut ambiguous = surface("a", "p");
        ambiguous["target"]["scope_id"] = json!("s");
        assert!(client(json!([ambiguous])).surfaces("p").is_err());
        let mut kind = surface("a", "p");
        kind["kind"] = json!("webhook");
        assert!(client(json!([kind])).surfaces("p").is_err());
    }

    #[test]
    fn identifiers_never_reach_a_path_unescaped() {
        assert!(client(json!({})).project("../x").is_err());
        assert!(
            client(json!({"id": "other", "name": "N"}))
                .project("p")
                .is_err()
        );
        assert!(client(json!({})).delete_scope("p", "a/b").is_err());
    }

    #[test]
    fn the_mcp_address_is_the_proxy_and_never_holds_the_key() {
        assert_eq!(
            mcp_server_url("https://api.puppyone.ai/api/v1"),
            "https://api.puppyone.ai/api/v1/mcp/proxy"
        );
        assert_eq!(
            mcp_server_url("http://127.0.0.1:9090/api/v1"),
            "http://127.0.0.1:9090/api/v1/mcp/proxy"
        );
        let created = json!({"id": "e", "project_id": "p", "name": "MCP Server", "api_key": "k"});
        assert_eq!(
            client(created.clone())
                .create_mcp_endpoint("p", "docs", true)
                .unwrap()
                .api_key
                .as_deref(),
            Some("k")
        );
        assert!(
            client(created)
                .create_mcp_endpoint("q", "docs", true)
                .is_err()
        );
    }

    #[test]
    fn scope_changes_are_held_to_their_project_and_scope() {
        let scope =
            json!({"id": "s", "project_id": "p", "name": "N", "path": "a", "max_mode": "r"});
        assert!(
            client(scope.clone())
                .create_scope("p", "N", "a", "r")
                .is_ok()
        );
        assert!(
            client(scope.clone())
                .create_scope("q", "N", "a", "r")
                .is_err()
        );
        assert!(
            client(scope.clone())
                .update_scope("p", "s", "N", "r")
                .is_ok()
        );
        assert!(client(scope).update_scope("p", "other", "N", "r").is_err());
    }
}
