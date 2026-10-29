//! `cloud-publish-api.mjs`: the Cloud side of a first publication. Creation
//! and credential issue carry the operation id as `Idempotency-Key`, so a
//! retry after a lost response returns the same Project and credential.
use super::{Code, PublishError, journal::Record};
use crate::cloud_auth::{
    Broker, Error as AuthError,
    model::{ApiRequest, Binding},
};
use reqwest::Method;
use serde_json::{Value, json};
use std::sync::Arc;

pub const GIT_USERNAME: &str = "x-puppyone-token";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Credential {
    pub id: String,
    pub username: String,
    pub remote_url: String,
}

pub trait CloudOps: Send + Sync {
    fn create_project(&self, record: &Record) -> Result<String, PublishError>;
    fn issue_credential(&self, record: &Record, secret: &str) -> Result<Credential, PublishError>;
    fn revoke_credential(&self, record: &Record) -> Result<(), PublishError>;
    /// `Ok(false)`: Cloud refused (`initialization_not_abandonable`).
    fn abandon_empty_project(&self, record: &Record) -> Result<bool, PublishError>;
    /// `GET /organizations/`: where a Project may be created.
    fn organizations(&self) -> Result<Vec<Organization>, PublishError>;
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Organization {
    pub id: String,
    pub name: String,
}

/// `mapCloudMutationError`.
pub fn mutation_error(default: Code, message: &str, error: &AuthError) -> PublishError {
    let status = match error {
        AuthError::Http(s) | AuthError::Response(s, _) | AuthError::Service(s, _) => Some(*s),
        AuthError::InvalidCredentials => Some(401),
        _ => None,
    };
    match (error, status) {
        (AuthError::SessionChanged | AuthError::InvalidCredentials, _) | (_, Some(401)) => {
            PublishError::new(
                Code::SessionRequired,
                "Sign in to Puppyone Cloud to continue.",
                true,
            )
        }
        (_, Some(403)) => PublishError::new(
            Code::PermissionDenied,
            "You do not have permission to access this Cloud Project.",
            false,
        ),
        (_, Some(404)) => PublishError::new(
            Code::ProjectUnavailable,
            "The Cloud Project no longer exists or is unavailable.",
            false,
        ),
        (AuthError::Response(_, Some("organization_required")), _) => PublishError::new(
            Code::OrganizationRequired,
            "Select a PuppyOne organization before publishing.",
            false,
        ),
        (
            AuthError::Response(
                _,
                Some(
                    "database_schema_outdated"
                    | "schema_migration_required"
                    | "service_upgrade_required",
                ),
            ),
            _,
        ) => PublishError::new(
            Code::ServiceUpgradeRequired,
            "Puppyone Cloud is being upgraded. Resume publishing shortly.",
            true,
        ),
        _ => PublishError::new(
            default,
            message,
            !matches!(status, Some(400 | 403 | 404 | 409 | 410 | 422)),
        ),
    }
}

/// `validateCanonicalCloudGitRemoteUrl`.
pub fn validate_remote_url(
    remote: &str,
    project: &str,
    api_base: &str,
    hosted_git_origin: Option<&str>,
) -> Result<String, PublishError> {
    let unsafe_url = || {
        PublishError::new(
            Code::CredentialFailed,
            "Cloud returned an unsafe Git remote URL.",
            false,
        )
    };
    let url = url::Url::parse(remote).map_err(|_| unsafe_url())?;
    let api = url::Url::parse(api_base).map_err(|_| unsafe_url())?;
    let host = url.host_str().unwrap_or_default();
    let loopback = matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]");
    if !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != format!("/git/{project}.git")
    {
        return Err(unsafe_url());
    }
    let origin = url.origin().ascii_serialization().to_lowercase();
    let mut allowed = vec![api.origin().ascii_serialization().to_lowercase()];
    if let Some(configured) = hosted_git_origin.and_then(|o| url::Url::parse(o).ok()) {
        allowed.push(configured.origin().ascii_serialization().to_lowercase());
    }
    let puppyone = |h: &str| h == "puppyone.ai" || h.ends_with(".puppyone.ai");
    if !allowed.contains(&origin)
        && !(puppyone(api.host_str().unwrap_or_default()) && puppyone(host))
    {
        return Err(PublishError::new(
            Code::CredentialFailed,
            "Cloud returned a Git remote outside the trusted Cloud origin.",
            false,
        ));
    }
    Ok(url.to_string())
}

/// Through the signed-in broker, bound to the operation's account.
pub struct Http {
    pub broker: Arc<Broker>,
    pub binding: Binding,
    pub hosted_git_origin: Option<String>,
}
impl Http {
    fn call(
        &self,
        method: Method,
        path: String,
        body: Option<Value>,
        key: Option<&str>,
    ) -> Result<Value, AuthError> {
        self.broker.request(
            &self.binding,
            &ApiRequest {
                idempotency_key: key.map(str::to_owned),
                method,
                path,
                query: vec![],
                body,
            },
        )
    }
}
/// The `{code, data}` envelope, or the bare value.
fn data(value: Value) -> Value {
    if value.get("data").is_some() && value.get("code").is_some() {
        value["data"].clone()
    } else {
        value
    }
}
fn project_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 200
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'-')
}
impl CloudOps for Http {
    fn create_project(&self, record: &Record) -> Result<String, PublishError> {
        let value = self
            .call(
                Method::POST,
                "/projects/".into(),
                Some(serde_json::to_value(&record.create_payload).unwrap_or_default()),
                Some(&record.operation_id),
            )
            .map_err(|e| {
                mutation_error(
                    Code::ProjectCreateFailed,
                    "Unable to create the Cloud Project.",
                    &e,
                )
            })?;
        let value = data(value);
        let id = value["id"].as_str().map(str::trim).unwrap_or_default();
        if !project_id(id) {
            return Err(PublishError::new(
                Code::ProjectCreateFailed,
                "Cloud returned an invalid Project identity.",
                false,
            ));
        }
        if value["org_id"].as_str() != Some(record.organization_id.as_str()) {
            return Err(PublishError::new(
                Code::ProjectCreateFailed,
                "Cloud returned a Project in a different organization.",
                false,
            ));
        }
        Ok(id.to_owned())
    }
    fn issue_credential(&self, record: &Record, secret: &str) -> Result<Credential, PublishError> {
        let project = record.project_id.as_deref().unwrap_or_default();
        let value = self
            .call(
                Method::POST,
                format!("/projects/{project}/git-credentials"),
                Some(json!({
                    "target": {"kind": "project_root", "project_id": project},
                    "mode": "rw",
                    "credential": secret,
                })),
                Some(&record.operation_id),
            )
            .map_err(|e| {
                mutation_error(
                    Code::CredentialFailed,
                    "Unable to issue the Project Git credential.",
                    &e,
                )
            })?;
        let value = data(value);
        let id = value["id"].as_str().map(str::trim).unwrap_or_default();
        let target = &value["remote"]["target"];
        if id.is_empty()
            || value["mode"] != "rw"
            || target["kind"] != "project_root"
            || target["project_id"].as_str() != Some(project)
        {
            return Err(PublishError::new(
                Code::CredentialFailed,
                "Cloud returned an invalid Git credential response.",
                false,
            ));
        }
        let username = value["remote"]["username"]
            .as_str()
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .unwrap_or(GIT_USERNAME)
            .to_owned();
        let remote_url = validate_remote_url(
            value["remote"]["url"].as_str().unwrap_or_default().trim(),
            project,
            &record.api_base_url,
            self.hosted_git_origin.as_deref(),
        )?;
        Ok(Credential {
            id: id.to_owned(),
            username,
            remote_url,
        })
    }
    fn revoke_credential(&self, record: &Record) -> Result<(), PublishError> {
        let (Some(project), Some(credential)) = (&record.project_id, &record.credential_id) else {
            return Ok(());
        };
        match self.call(
            Method::DELETE,
            format!("/projects/{project}/git-credentials/{credential}"),
            None,
            Some(&record.operation_id),
        ) {
            Ok(_) => Ok(()),
            Err(
                AuthError::Http(404) | AuthError::Response(404, _) | AuthError::Service(404, _),
            ) => Ok(()),
            Err(e) => Err(mutation_error(
                Code::CleanupFailed,
                "Unable to revoke the initialization Git credential.",
                &e,
            )),
        }
    }
    fn abandon_empty_project(&self, record: &Record) -> Result<bool, PublishError> {
        let project = record.project_id.as_deref().unwrap_or_default();
        match self.call(
            Method::POST,
            format!("/projects/{project}/initialization/abandon"),
            Some(json!({})),
            Some(&record.operation_id),
        ) {
            Ok(_) => Ok(true),
            // Deletion is idempotent: a missing Project is already abandoned.
            Err(
                AuthError::Http(404) | AuthError::Response(404, _) | AuthError::Service(404, _),
            ) => Ok(true),
            Err(AuthError::Response(_, Some("initialization_not_abandonable"))) => Ok(false),
            Err(e) => Err(mutation_error(
                Code::CleanupFailed,
                "Unable to delete the empty Cloud Project. Finish cleanup to retry.",
                &e,
            )),
        }
    }
    fn organizations(&self) -> Result<Vec<Organization>, PublishError> {
        let value = self
            .call(Method::GET, "/organizations/".into(), None, None)
            .map_err(|e| {
                mutation_error(
                    Code::OrganizationRequired,
                    "Unable to list organizations.",
                    &e,
                )
            })?;
        Ok(data(value)
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|o| {
                        Some(Organization {
                            id: o["id"].as_str()?.to_owned(),
                            name: o["name"].as_str().unwrap_or("Organization").to_owned(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }
}
