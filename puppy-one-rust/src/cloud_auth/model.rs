use serde::{Deserialize, Serialize};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{Duration, Instant};
use url::Url;
use zeroize::Zeroize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Configuration,
    SecureStorage,
    Unavailable,
    InvalidResponse,
    InvalidCredentials,
    SessionChanged,
    Cancelled,
    Expired,
    Unsupported,
    NoProviders,
    RemoteLogoutUnavailable,
    Http(u16),
    Service(u16, super::transport::ServiceCode),
    /// A server failure (5xx, 408, 429) or an allowlisted reason code
    /// (`cloudOpeningFailure` reasons); never free-form server prose.
    Response(u16, Option<&'static str>),
    OutcomeUnknown,
}
pub type Result<T> = std::result::Result<T, Error>;
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Configuration => "Cloud endpoints are missing or invalid. Configure this native build's API and Web origins.",
            Self::SecureStorage => "Secure credential storage failed. A saved sign-in may remain; retry sign-out before leaving this device.",
            Self::Unavailable => "Cloud authentication is temporarily unavailable. Your saved sign-in has not been discarded.",
            Self::InvalidResponse => "The authentication response could not be verified.",
            Self::InvalidCredentials => "Sign-in credentials expired or were revoked. Sign in again.",
            Self::SessionChanged => "The account or service changed; this operation is no longer authorized.",
            Self::Cancelled => "Sign-in was cancelled.",
            Self::Expired => "Sign-in expired. Start again from the application.",
            Self::Unsupported => "Secure native sign-in is unavailable on this platform.",
            Self::NoProviders => "No sign-in method is enabled for this service.",
            Self::RemoteLogoutUnavailable => "Signed out on this device. Remote session revocation could not be confirmed.",
            Self::Http(_) | Self::Service(_, _) => "The service rejected this request.",
            Self::Response(_, _) => "The Cloud service could not complete this request.",
            Self::OutcomeUnknown => "The operation may have completed. Verify its outcome before trying again.",
        })
    }
}
impl std::error::Error for Error {}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Environment {
    pub(super) api: String,
    pub(super) web: String,
}
impl<'de> Deserialize<'de> for Environment {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Raw {
            api: String,
            web: String,
        }
        let raw = Raw::deserialize(deserializer)?;
        Self::new(&raw.api, &raw.web).map_err(serde::de::Error::custom)
    }
}
impl Environment {
    /// The Web origin hosted resource links use (`workspaceResourceUrl`).
    pub fn web(&self) -> &str {
        &self.web
    }
    pub fn api(&self) -> &str {
        &self.api
    }
    pub fn new(api: &str, web: &str) -> Result<Self> {
        let api = endpoint(api, true)?;
        let web = endpoint(web, true)?;
        if !api.path().trim_end_matches('/').ends_with("/api/v1") || web.path() != "/" {
            return Err(Error::Configuration);
        }
        Ok(Self {
            api: api.as_str().trim_end_matches('/').into(),
            web: web.origin().ascii_serialization(),
        })
    }
    /// `loadDesktopCloudConfiguration`: the development environment
    /// (`VITE_DESKTOP_CLOUD_API_URL` / `VITE_DESKTOP_CLOUD_WEB_URL`, the
    /// names the TS build uses; `PUPPYONE_CLOUD_*` stays accepted), else the
    /// packaged public `desktop-cloud.json` (`schemaVersion: 1`). Missing or
    /// invalid configuration fails closed — there is no production fallback.
    pub fn configured() -> Result<Self> {
        let var = |names: [&str; 2]| names.iter().find_map(|n| std::env::var(n).ok());
        if let (Some(api), Some(web)) = (
            var(["VITE_DESKTOP_CLOUD_API_URL", "PUPPYONE_CLOUD_API_URL"]),
            var(["VITE_DESKTOP_CLOUD_WEB_URL", "PUPPYONE_CLOUD_WEB_URL"]),
        ) {
            return Self::new(&api, &web);
        }
        let exe = std::env::current_exe().map_err(|_| Error::Configuration)?;
        let dir = exe.parent().ok_or(Error::Configuration)?;
        [
            dir.join("../Resources/desktop-cloud.json"),
            dir.join("desktop-cloud.json"),
        ]
        .iter()
        .find_map(|path| std::fs::read(path).ok())
        .ok_or(Error::Configuration)
        .and_then(|bytes| Self::from_packaged(&bytes))
    }
    /// `dist/desktop-cloud.json`: `{schemaVersion: 1, apiBase, webOrigin}`.
    pub fn from_packaged(bytes: &[u8]) -> Result<Self> {
        let value: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|_| Error::Configuration)?;
        if value["schemaVersion"] != 1 {
            return Err(Error::Configuration);
        }
        Self::new(
            value["apiBase"].as_str().ok_or(Error::Configuration)?,
            value["webOrigin"].as_str().ok_or(Error::Configuration)?,
        )
    }
    /// `VITE_DESKTOP_CLOUD_GIT_ORIGIN`: the hosted Git origin a loopback
    /// development API may trust; never consulted for a non-loopback API.
    pub fn hosted_git_origin(&self) -> Option<String> {
        let api = Url::parse(&self.api).ok()?;
        if !matches!(api.host_str(), Some("localhost" | "127.0.0.1")) {
            return None;
        }
        std::env::var("VITE_DESKTOP_CLOUD_GIT_ORIGIN")
            .ok()
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
    }
    pub fn api_url(&self, path: &str, query: &[(String, String)]) -> Result<Url> {
        if !path.starts_with('/')
            || path.starts_with("//")
            || path.contains(['\\', '?', '#', '%'])
            || path.split('/').any(|s| s == "." || s == "..")
            || path.chars().any(char::is_control)
        {
            return Err(Error::Configuration);
        }
        let mut url =
            Url::parse(&format!("{}{path}", self.api)).map_err(|_| Error::Configuration)?;
        if !query.is_empty() {
            url.query_pairs_mut()
                .extend_pairs(query.iter().map(|(k, v)| (k, v)));
        }
        Ok(url)
    }
}
pub(super) fn endpoint(value: &str, official: bool) -> Result<Url> {
    let url = Url::parse(value).map_err(|_| Error::Configuration)?;
    let host = url.host_str().ok_or(Error::Configuration)?;
    // `normalizeCloudApiBaseUrl`: the PuppyOne host family over HTTPS, or
    // explicit loopback development (`localhost`, `127.0.0.1`).
    let local = matches!(host, "localhost" | "127.0.0.1");
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !(url.scheme() == "https" || (local && url.scheme() == "http"))
        || (official && !(host == "puppyone.ai" || host.ends_with(".puppyone.ai") || local))
    {
        return Err(Error::Configuration);
    }
    Ok(url)
}

// Deliberately no Debug/Display/Serialize on access credentials or wire replies.
#[derive(Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub(super) struct Secret(pub String);
impl Drop for Secret {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}
impl Secret {
    pub fn valid(&self) -> bool {
        !self.0.is_empty()
            && self.0.len() <= 8192
            && self.0.bytes().all(|b| (33..=126).contains(&b))
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Credential {
    pub version: u8,
    pub environment: Environment,
    pub user: String,
    pub email: String,
    pub refresh: Secret,
}
impl Credential {
    pub fn valid(&self) -> bool {
        self.version == 1
            && Environment::new(&self.environment.api, &self.environment.web).as_ref()
                == Ok(&self.environment)
            && valid_identity(&self.user, 512)
            && valid_identity(&self.email, 320)
            && self.email.contains('@')
            && self.refresh.valid()
    }
}
fn valid_identity(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
#[derive(Deserialize)]
pub(super) struct AuthReply {
    pub access_token: Secret,
    pub refresh_token: Secret,
    pub expires_in: u64,
    pub user: AuthUser,
}
#[derive(Deserialize)]
pub(super) struct AuthUser {
    pub id: String,
    pub email: String,
}
#[derive(Clone)]
pub(super) struct Session {
    pub credential: Credential,
    pub access: Secret,
    pub until: Instant,
}
impl Session {
    pub fn from_reply(environment: Environment, value: AuthReply) -> Result<Self> {
        let credential = Credential {
            version: 1,
            environment,
            user: value.user.id,
            email: value.user.email,
            refresh: value.refresh_token,
        };
        if !credential.valid()
            || !value.access_token.valid()
            || value.expires_in == 0
            || value.expires_in > 604800
        {
            return Err(Error::InvalidResponse);
        }
        Ok(Self {
            credential,
            access: value.access_token,
            until: Instant::now() + Duration::from_secs(value.expires_in),
        })
    }
    pub fn fresh(&self) -> bool {
        self.until > Instant::now() + Duration::from_secs(60)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    SignedOut,
    Restoring,
    SigningIn,
    Authenticated,
    Offline,
    Refreshing,
    SigningOut,
    StorageBlocked,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Binding {
    pub environment: Environment,
    pub user: String,
    pub instance: uuid::Uuid,
    pub epoch: u64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Account {
    pub email: String,
    pub binding: Binding,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub epoch: u64,
    pub environment: Environment,
    pub status: Status,
    pub account: Option<Account>,
    pub error: Option<Error>,
    pub can_reopen: bool,
}
pub(super) struct Control {
    pub epoch: AtomicU64,
    closed: AtomicBool,
    pub changes: tokio::sync::watch::Sender<()>,
}
impl Control {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            epoch: AtomicU64::new(1),
            closed: AtomicBool::new(false),
            changes: tokio::sync::watch::channel(()).0,
        })
    }
    pub fn advance(&self) -> u64 {
        let next = self.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        self.changes.send_replace(());
        next
    }
    pub fn fence(self: &Arc<Self>) -> Fence {
        Fence {
            control: self.clone(),
            epoch: self.epoch.load(Ordering::SeqCst),
            deadline: None,
            cancel: None,
        }
    }
    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.advance();
    }
}
#[derive(Clone)]
pub(super) struct Fence {
    pub control: Arc<Control>,
    pub epoch: u64,
    pub deadline: Option<Instant>,
    pub cancel: Option<super::transport::Cancellation>,
}
impl Fence {
    pub fn check(&self) -> Result<()> {
        if let Some(cancel) = &self.cancel {
            cancel.check()?;
        }
        if self.control.closed.load(Ordering::SeqCst)
            || self.epoch != self.control.epoch.load(Ordering::SeqCst)
        {
            Err(Error::SessionChanged)
        } else if self.deadline.is_some_and(|d| Instant::now() >= d) {
            Err(Error::Expired)
        } else {
            Ok(())
        }
    }
}

pub struct ApiRequest {
    pub method: reqwest::Method,
    pub path: String,
    pub query: Vec<(String, String)>,
    pub body: Option<serde_json::Value>,
    /// `Idempotency-Key` of a retried creation (`requestIdempotent`).
    pub idempotency_key: Option<String>,
}
impl ApiRequest {
    fn project_endpoint(&self, endpoint: &str) -> bool {
        self.path
            .strip_prefix("/projects/")
            .and_then(|p| p.split_once('/'))
            .is_some_and(|(project, tail)| !project.is_empty() && tail == endpoint)
    }
    pub fn read_only(&self) -> bool {
        self.method == reqwest::Method::GET
            || self.method == reqwest::Method::HEAD
            || (self.method == reqwest::Method::POST && self.project_endpoint("repository-context"))
    }
    /// Opening/status have a server-side wait. Keep ordinary APIs bounded to
    /// 15 s, while allowing the explicit workbench handshake to finish.
    pub fn timeout(&self) -> Duration {
        let workbench = self.project_endpoint("workbench");
        if workbench && self.method == reqwest::Method::POST {
            Duration::from_secs(120)
        } else if workbench
            && self.method == reqwest::Method::GET
            && self
                .query
                .iter()
                .any(|(k, v)| k == "wait_seconds" && v == "20")
        {
            Duration::from_secs(25)
        } else {
            Duration::from_secs(15)
        }
    }
}

#[cfg(test)]
mod request_policy_tests {
    use super::ApiRequest;
    use reqwest::Method;
    use std::time::Duration;

    #[test]
    fn only_exact_context_resolution_posts_can_be_retried_as_reads() {
        for (path, read_only) in [
            ("/projects/project-a/repository-context", true),
            ("/projects/project-a/workbench", false),
            ("/projects/project-a/workbench/file", false),
            ("/projects/project-a/nested/repository-context", false),
            ("/projects//repository-context", false),
        ] {
            let request = ApiRequest {
                idempotency_key: None,
                method: Method::POST,
                path: path.into(),
                query: Vec::new(),
                body: None,
            };
            assert_eq!(request.read_only(), read_only, "{path}");
        }
    }

    #[test]
    fn workbench_wait_budget_does_not_extend_file_or_account_requests() {
        for (path, method, wait, seconds) in [
            ("/projects/project-a/workbench", Method::POST, false, 120),
            ("/projects/project-a/workbench", Method::GET, true, 25),
            ("/projects/project-a/workbench", Method::GET, false, 15),
            ("/projects/project-a/workbench/file", Method::GET, true, 15),
            (
                "/projects/project-a/nested/workbench",
                Method::POST,
                false,
                15,
            ),
            ("/user/profile", Method::GET, true, 15),
        ] {
            let request = ApiRequest {
                idempotency_key: None,
                method,
                path: path.into(),
                query: if wait {
                    vec![("wait_seconds".into(), "20".into())]
                } else {
                    Vec::new()
                },
                body: None,
            };
            assert_eq!(request.timeout(), Duration::from_secs(seconds), "{path}");
        }
    }
}

#[cfg(test)]
mod configuration_tests {
    use super::Environment;

    #[test]
    fn endpoints_follow_the_desktop_allowlist() {
        assert!(Environment::new("https://api.puppyone.ai/api/v1", "https://puppyone.ai").is_ok());
        assert!(Environment::new("http://127.0.0.1:9090/api/v1", "http://localhost:3000").is_ok());
        for (api, web) in [
            // Official hosts need HTTPS; other hosts are never Cloud.
            ("http://api.puppyone.ai/api/v1", "https://puppyone.ai"),
            ("https://api.example.com/api/v1", "https://puppyone.ai"),
            // `normalizeCloudApiBaseUrl` admits localhost and 127.0.0.1 only.
            ("http://[::1]:9090/api/v1", "http://localhost:3000"),
            // Paths, credentials and queries are rejected.
            ("https://api.puppyone.ai/v2", "https://puppyone.ai"),
            ("https://api.puppyone.ai/api/v1", "https://puppyone.ai/app"),
            ("https://user@api.puppyone.ai/api/v1", "https://puppyone.ai"),
            ("https://api.puppyone.ai/api/v1?x=1", "https://puppyone.ai"),
        ] {
            assert!(Environment::new(api, web).is_err(), "{api} {web}");
        }
    }

    #[test]
    fn the_packaged_configuration_is_public_and_versioned() {
        let ok = br#"{"schemaVersion":1,"apiBase":"https://api.puppyone.ai/api/v1","webOrigin":"https://puppyone.ai"}"#;
        let environment = Environment::from_packaged(ok).unwrap();
        assert_eq!(environment.api(), "https://api.puppyone.ai/api/v1");
        assert_eq!(environment.web(), "https://puppyone.ai");
        assert!(Environment::from_packaged(br#"{"schemaVersion":2,"apiBase":"https://api.puppyone.ai/api/v1","webOrigin":"https://puppyone.ai"}"#).is_err());
        assert!(Environment::from_packaged(b"{}").is_err());
        // The hosted Git mapping is only for a loopback API.
        assert_eq!(environment.hosted_git_origin(), None);
    }
}
