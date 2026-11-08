//! The account's Project and space requests (`lib/cloudApi.ts`): renaming,
//! deleting and creating Cloud projects, and the spaces they live in. Every
//! response is held to the Project asked for; a creation carries its
//! operation's idempotency key, so a retried one is made once.
use crate::cloud::auth::{
    self as auth, Broker, Cancellation,
    model::{ApiRequest, Binding},
};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;

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

/// `UpdateCloudProjectInput`: only the settings being changed.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProjectUpdate {
    pub name: Option<String>,
    /// `Some(None)` clears the description.
    pub description: Option<Option<String>>,
    /// `org` or `private`.
    pub visibility: Option<&'static str>,
    pub bound_git_branch: Option<String>,
}
impl ProjectUpdate {
    fn payload(self) -> Result<Value> {
        let mut payload = serde_json::Map::new();
        if let Some(name) = self.name {
            let name = name.trim();
            if name.is_empty() {
                return Err(Error::Invalid("name"));
            }
            payload.insert("name".into(), name.into());
        }
        if let Some(description) = self.description {
            payload.insert("description".into(), description.into());
        }
        if let Some(branch) = self.bound_git_branch {
            let branch = branch.trim();
            if branch.is_empty() {
                return Err(Error::Invalid("branch"));
            }
            payload.insert("bound_git_branch".into(), branch.into());
        }
        if let Some(visibility) = self.visibility {
            payload.insert("visibility".into(), visibility.into());
        }
        if payload.is_empty() {
            return Err(Error::Invalid("update"));
        }
        Ok(Value::Object(payload))
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
/// `DesktopCloudOrganization`: a space. `kind` and `can_create_projects`
/// are absent on older deployments; a personal space is never inferred
/// from a name.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Organization {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub can_create_projects: Option<bool>,
    #[serde(default)]
    pub plan: String,
    #[serde(default)]
    pub seat_limit: u64,
}

/// `{code, data}` yields `data`.
pub(super) fn unwrap(value: Value) -> Value {
    match value {
        Value::Object(mut map) if map.contains_key("data") => {
            map.remove("data").unwrap_or(Value::Null)
        }
        value => value,
    }
}
pub(super) fn decode<T: serde::de::DeserializeOwned>(
    value: Value,
    what: &'static str,
) -> Result<T> {
    serde_json::from_value(unwrap(value)).map_err(|_| Error::Invalid(what))
}
/// A path segment: nothing that would need escaping reaches a request.
pub(super) fn segment(id: &str) -> Result<&str> {
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
/// Requests for the account's Projects and spaces.
#[derive(Clone)]
pub struct Client {
    transport: Arc<dyn Transport>,
}
impl Client {
    pub fn new(transport: Arc<dyn Transport>) -> Self {
        Self { transport }
    }
    pub fn transport(&self) -> Arc<dyn Transport> {
        self.transport.clone()
    }
    fn send(
        &self,
        method: Method,
        path: String,
        body: Option<Value>,
        idempotency_key: Option<String>,
    ) -> Result<Value> {
        self.transport.request(ApiRequest {
            method,
            path,
            query: vec![],
            body,
            idempotency_key,
        })
    }
    fn get(&self, path: String) -> Result<Value> {
        self.send(Method::GET, path, None, None)
    }
    pub fn project(&self, id: &str) -> Result<Project> {
        let project: Project = decode(self.get(format!("/projects/{}", segment(id)?))?, "project")?;
        if project.id != id {
            return Err(Error::Invalid("project"));
        }
        Ok(project)
    }
    /// `createCloudProject`: an empty Cloud project named `name` in the
    /// space `org`. `operation` is the creation's idempotency key, the same
    /// for every retry of one intent.
    pub fn create_project(&self, name: &str, org: &str, operation: &str) -> Result<Project> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::Invalid("name"));
        }
        let body = json!({ "name": name, "org_id": segment(org)? });
        decode(
            self.send(
                Method::POST,
                "/projects/".into(),
                Some(body),
                Some(operation.to_owned()),
            )?,
            "project",
        )
    }
    /// `updateCloudProject`: `PUT /projects/{id}` with the fields given and
    /// nothing else. A name or branch is trimmed and may not be empty.
    pub fn update_project(&self, id: &str, update: ProjectUpdate) -> Result<Project> {
        let path = format!("/projects/{}", segment(id)?);
        let body = update.payload()?;
        let project: Project = decode(self.send(Method::PUT, path, Some(body), None)?, "project")?;
        if project.id != id {
            return Err(Error::Invalid("project"));
        }
        Ok(project)
    }
    /// `deleteCloudProject`: access ends when the server accepts this; it
    /// removes the stored objects afterwards.
    pub fn delete_project(&self, id: &str) -> Result<()> {
        let path = format!("/projects/{}", segment(id)?);
        self.send(Method::DELETE, path, None, None).map(|_| ())
    }
    /// `listCloudOrganizations`: the spaces this account belongs to.
    pub fn organizations(&self) -> Result<Vec<Organization>> {
        decode(self.get("/organizations/".into())?, "organizations")
    }
    /// `ensurePersonalCloudSpace`: deliberate provisioning of this account's
    /// personal space; the server returns the same one on every call.
    pub fn ensure_personal_space(&self) -> Result<Organization> {
        decode(
            self.send(Method::POST, "/auth/personal-space".into(), None, None)?,
            "personal space",
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

    #[test]
    fn identifiers_never_reach_a_path_unescaped() {
        assert!(client(json!({})).project("../x").is_err());
        assert!(
            client(json!({"id": "other", "name": "N"}))
                .project("p")
                .is_err()
        );
        assert!(client(json!({})).delete_project("a/b").is_err());
        assert!(client(json!({})).create_project("N", "o/x", "op").is_err());
    }

    struct Recorded(std::sync::Mutex<Vec<ApiRequest>>, Value);
    impl Transport for Recorded {
        fn request(&self, request: ApiRequest) -> Result<Value> {
            self.0.lock().unwrap().push(request);
            Ok(self.1.clone())
        }
    }

    #[test]
    fn a_project_is_updated_with_put_and_deleted_with_delete() {
        let transport = Arc::new(Recorded(
            Default::default(),
            json!({"id": "p", "name": "Notes"}),
        ));
        let client = Client::new(transport.clone());
        let update = ProjectUpdate {
            name: Some("  Notes ".into()),
            description: Some(None),
            ..Default::default()
        };
        assert_eq!(client.update_project("p", update).unwrap().name, "Notes");
        client.delete_project("p").unwrap();
        let sent = transport.0.lock().unwrap();
        assert_eq!(sent[0].method, Method::PUT);
        assert_eq!(sent[0].path, "/projects/p");
        assert_eq!(
            sent[0].body,
            Some(json!({"name": "Notes", "description": null}))
        );
        assert_eq!(sent[1].method, Method::DELETE);
        assert_eq!(sent[1].path, "/projects/p");
        assert_eq!(sent[1].body, None);
    }

    #[test]
    fn a_new_cloud_project_names_its_space_and_keeps_its_operation_key() {
        let transport = Arc::new(Recorded(
            Default::default(),
            json!({"data": {"id": "p", "name": "Plan"}}),
        ));
        let client = Client::new(transport.clone());
        assert_eq!(
            client.create_project(" Plan ", "org-1", "op-1").unwrap().id,
            "p"
        );
        assert!(client.create_project("  ", "org-1", "op-1").is_err());
        let sent = transport.0.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].method, Method::POST);
        assert_eq!(sent[0].path, "/projects/");
        assert_eq!(
            sent[0].body,
            Some(json!({"name": "Plan", "org_id": "org-1"}))
        );
        assert_eq!(sent[0].idempotency_key.as_deref(), Some("op-1"));
    }

    #[test]
    fn spaces_keep_what_the_server_says_and_nothing_more() {
        let orgs = client(json!([
            {"id": "a", "name": "Alex", "kind": "personal", "can_create_projects": true},
            {"id": "b", "name": "Design", "kind": "team", "can_create_projects": false},
            {"id": "c", "name": "Old"}
        ]))
        .organizations()
        .unwrap();
        assert_eq!(orgs[0].kind.as_deref(), Some("personal"));
        assert_eq!(orgs[1].can_create_projects, Some(false));
        assert_eq!(orgs[2].kind, None);
        assert_eq!(orgs[2].can_create_projects, None);
    }
}
