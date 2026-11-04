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
    /// `loadDesktopCloudConfiguration`: a packaged app reads only its public
    /// `desktop-cloud.json` (`schemaVersion: 1`) beside the executable; a
    /// development build reads only `VITE_DESKTOP_CLOUD_API_URL` /
    /// `VITE_DESKTOP_CLOUD_WEB_URL`. Missing or invalid configuration fails
    /// closed — there is no production fallback.
    pub fn configured() -> Result<Self> {
        let exe = std::env::current_exe().map_err(|_| Error::Configuration)?;
        let dir = exe.parent().ok_or(Error::Configuration)?;
        let packaged = [
            dir.join("../Resources/desktop-cloud.json"),
            dir.join("desktop-cloud.json"),
        ]
        .into_iter()
        .find(|path| path.is_file());
        Self::from_sources(packaged.as_deref(), |name| std::env::var(name).ok())
    }
    fn from_sources(
        packaged: Option<&std::path::Path>,
        env: impl Fn(&str) -> Option<String>,
    ) -> Result<Self> {
        match packaged {
            Some(path) => std::fs::read(path)
                .map_err(|_| Error::Configuration)
                .and_then(|bytes| Self::from_packaged(&bytes)),
            None => Self::new(
                &env("VITE_DESKTOP_CLOUD_API_URL").ok_or(Error::Configuration)?,
                &env("VITE_DESKTOP_CLOUD_WEB_URL").ok_or(Error::Configuration)?,
            ),
        }
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
        if !matches!(
            api.host_str(),
            Some("localhost" | "127.0.0.1" | "::1" | "[::1]")
        ) {
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
/// `buildSessionFromAuth`: every field but the access token may be missing
/// from a reply, and falls back as the product's does.
#[derive(Deserialize)]
pub(super) struct AuthReply {
    pub access_token: Secret,
    #[serde(default)]
    pub refresh_token: Option<Secret>,
    #[serde(default)]
    pub expires_in: Option<f64>,
    #[serde(default)]
    pub user: Option<AuthUser>,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub user_email: Option<String>,
}
#[derive(Default, Deserialize)]
pub(super) struct AuthUser {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
}
/// The JWT's `sub`, read without trusting it for anything but a name.
fn jwt_subject(token: &str) -> Option<String> {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    let mut parts = token.split('.');
    let (_, payload, _) = (parts.next()?, parts.next()?, parts.next()?);
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value["sub"]
        .as_str()
        .map(str::to_owned)
        .filter(|s| !s.trim().is_empty())
}
/// `createLegacyUserId`: an account known only by its email on this API.
fn legacy_user(api: &str, email: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(format!("{api}\n{email}").as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("legacy:{}", &hex[..32])
}
#[derive(Clone)]
pub(super) struct Session {
    pub credential: Credential,
    pub access: Secret,
    pub until: Instant,
}
impl Session {
    /// A sign-in's session: the reply alone must name the account.
    pub fn from_reply(environment: Environment, value: AuthReply) -> Result<Self> {
        Self::from_reply_or(environment, value, None)
    }
    /// A refresh's session: what the reply leaves out comes from the
    /// credential it renewed (`fallbackEmail`, `fallbackRefreshToken`,
    /// `fallbackUserId`). No `expires_in` means no expiry.
    pub fn from_reply_or(
        environment: Environment,
        value: AuthReply,
        fallback: Option<&Credential>,
    ) -> Result<Self> {
        let text = |s: Option<String>| s.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty());
        let user = value.user.unwrap_or_default();
        let email = text(value.user_email)
            .or_else(|| text(user.email))
            .or_else(|| fallback.map(|c| c.email.clone()))
            .map(|e| e.to_lowercase())
            .ok_or(Error::InvalidResponse)?;
        let id = text(value.user_id)
            .or_else(|| text(user.id))
            .or_else(|| jwt_subject(&value.access_token.0))
            .or_else(|| fallback.map(|c| c.user.clone()))
            .unwrap_or_else(|| legacy_user(&environment.api, &email));
        let refresh = value
            .refresh_token
            .or_else(|| fallback.map(|c| c.refresh.clone()))
            .ok_or(Error::InvalidResponse)?;
        let credential = Credential {
            version: 1,
            environment,
            user: id,
            email,
            refresh,
        };
        if !credential.valid() || !value.access_token.valid() {
            return Err(Error::InvalidResponse);
        }
        let lifetime = value
            .expires_in
            .filter(|s| s.is_finite() && *s > 0.)
            .map_or(
                Duration::from_secs(10 * 365 * 24 * 3600),
                Duration::from_secs_f64,
            );
        Ok(Self {
            credential,
            access: value.access_token,
            until: Instant::now() + lifetime,
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
    /// `isSafeSessionRetry`: what may be sent once more under a newer
    /// session of the same account. Reads and the read-only context lookup;
    /// and the publication's own creations, which carry a UUIDv4
    /// idempotency key and a body fixed before the first attempt.
    pub fn safe_session_retry(&self) -> bool {
        use reqwest::Method;
        if matches!(self.method, Method::GET | Method::HEAD | Method::OPTIONS) {
            return true;
        }
        if self.method == Method::POST && self.project_endpoint("repository-context") {
            return true;
        }
        let keyed = self
            .idempotency_key
            .as_deref()
            .and_then(|k| uuid::Uuid::parse_str(k.trim()).ok())
            .is_some_and(|k| k.get_version_num() == 4);
        if !keyed {
            return false;
        }
        let segments: Vec<&str> = self.path.trim_end_matches('/').split('/').collect();
        let project = |i: usize| segments.get(i).is_some_and(|s| !s.is_empty());
        match (&self.method, segments.as_slice()) {
            (&Method::POST, _) if self.path == "/projects/" => true,
            (&Method::POST, ["", "projects", _, "git-credentials"]) => project(2),
            (&Method::POST, ["", "projects", _, "initialization", "abandon"]) => project(2),
            (&Method::DELETE, ["", "projects", _, "git-credentials", credential]) => {
                project(2) && !credential.is_empty()
            }
            _ => false,
        }
    }
    pub fn read_only(&self) -> bool {
        self.method == reqwest::Method::GET
            || self.method == reqwest::Method::HEAD
            || (self.method == reqwest::Method::POST && self.project_endpoint("repository-context"))
    }
    /// Opening/status have a server-side wait. Keep ordinary APIs bounded to
    /// 15 s, while allowing the explicit workbench handshake to finish. A
    /// workbench file read or write has no deadline in the product
    /// (`sessionReadOptions`): an 8 MiB file on a slow link must not turn a
    /// save into an unknown outcome, so only a dead connection (10 minutes)
    /// ends one.
    pub fn timeout(&self) -> Duration {
        let workbench = self.project_endpoint("workbench");
        if self.project_endpoint("workbench/file") || self.project_endpoint("workbench/files") {
            Duration::from_secs(600)
        } else if workbench && self.method == reqwest::Method::POST {
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
    fn workbench_waits_and_file_transfers_get_their_own_budgets() {
        for (path, method, wait, seconds) in [
            ("/projects/project-a/workbench", Method::POST, false, 120),
            ("/projects/project-a/workbench", Method::GET, true, 25),
            ("/projects/project-a/workbench", Method::GET, false, 15),
            ("/projects/project-a/workbench/file", Method::GET, true, 600),
            (
                "/projects/project-a/workbench/file",
                Method::PUT,
                false,
                600,
            ),
            (
                "/projects/project-a/workbench/files",
                Method::POST,
                false,
                600,
            ),
            (
                "/projects/project-a/workbench/events",
                Method::GET,
                false,
                15,
            ),
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

#[cfg(test)]
mod reply_tests {
    use super::*;
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

    fn environment() -> Environment {
        Environment::new("http://127.0.0.1:9/api/v1", "http://127.0.0.1:9").unwrap()
    }
    fn reply(value: serde_json::Value) -> AuthReply {
        serde_json::from_value(value).unwrap()
    }
    /// N-18: `buildSessionFromAuth`'s fallbacks.
    #[test]
    fn a_refresh_reply_falls_back_field_by_field() {
        let previous = Credential {
            version: 1,
            environment: environment(),
            user: "user-1".into(),
            email: "ada@example.test".into(),
            refresh: Secret("refresh-1".into()),
        };
        // Only an access token: everything else is the renewed credential's,
        // and there is no expiry.
        let session = Session::from_reply_or(
            environment(),
            reply(serde_json::json!({"access_token": "access-2"})),
            Some(&previous),
        )
        .unwrap();
        assert_eq!(session.credential.user, "user-1");
        assert_eq!(session.credential.email, "ada@example.test");
        assert_eq!(session.credential.refresh.0, "refresh-1");
        assert!(session.until > Instant::now() + Duration::from_secs(365 * 24 * 3600));
        // The token's subject names the account before the fallback does.
        let payload = URL_SAFE_NO_PAD.encode(br#"{"sub":"user-from-jwt"}"#);
        let token = format!("h.{payload}.s");
        let session = Session::from_reply_or(
            environment(),
            reply(
                serde_json::json!({"access_token": token, "user_email": "ADA@example.test",
                "expires_in": 120}),
            ),
            Some(&previous),
        )
        .unwrap();
        assert_eq!(session.credential.user, "user-from-jwt");
        assert_eq!(session.credential.email, "ada@example.test");
        // Without any of them a sign-in names the account by its email.
        let session = Session::from_reply(
            environment(),
            reply(
                serde_json::json!({"access_token": "opaque", "refresh_token": "r",
                "user": {"email": "ada@example.test"}}),
            ),
        )
        .unwrap();
        assert!(session.credential.user.starts_with("legacy:"));
        assert_eq!(session.credential.user.len(), "legacy:".len() + 32);
        // A sign-in still needs an email.
        assert!(
            Session::from_reply(
                environment(),
                reply(serde_json::json!({"access_token": "a", "refresh_token": "r"}))
            )
            .is_err()
        );
    }
}

#[cfg(test)]
mod session_retry_tests {
    use super::ApiRequest;
    use reqwest::Method;

    /// N-16: `isSafeSessionRetry`.
    #[test]
    fn only_reads_and_keyed_publication_creations_survive_a_new_session() {
        let key = "3f1c2b6e-4d5a-4b7c-8e9f-0a1b2c3d4e5f";
        let check = |method: Method, path: &str, key: Option<&str>| {
            ApiRequest {
                method,
                path: path.into(),
                query: vec![],
                body: None,
                idempotency_key: key.map(str::to_owned),
            }
            .safe_session_retry()
        };
        assert!(check(Method::GET, "/projects/p/workbench", None));
        assert!(check(Method::POST, "/projects/p/repository-context", None));
        assert!(check(Method::POST, "/projects/", Some(key)));
        assert!(check(
            Method::POST,
            "/projects/p/git-credentials",
            Some(key)
        ));
        assert!(check(
            Method::POST,
            "/projects/p/initialization/abandon",
            Some(key)
        ));
        assert!(check(
            Method::DELETE,
            "/projects/p/git-credentials/c",
            Some(key)
        ));
        // Unkeyed, a non-v4 key, or another mutation never resend.
        assert!(!check(Method::POST, "/projects/", None));
        assert!(!check(
            Method::POST,
            "/projects/",
            Some("3f1c2b6e-4d5a-1b7c-8e9f-0a1b2c3d4e5f")
        ));
        assert!(!check(Method::PUT, "/projects/p", Some(key)));
        assert!(!check(Method::POST, "/projects/p/agent-links", Some(key)));
    }
}

#[cfg(test)]
mod source_tests {
    use super::Environment;

    /// N-22: a packaged app never takes its endpoints from the environment,
    /// and the old `PUPPYONE_CLOUD_*` names are not read.
    #[test]
    fn a_packaged_app_reads_only_its_file_and_a_development_build_only_vite_names() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("desktop-cloud.json");
        std::fs::write(
            &file,
            r#"{"schemaVersion":1,"apiBase":"https://api.puppyone.ai/api/v1","webOrigin":"https://www.puppyone.ai"}"#,
        )
        .unwrap();
        let env = |name: &str| match name {
            "VITE_DESKTOP_CLOUD_API_URL" => Some("http://localhost:9000/api/v1".to_owned()),
            "VITE_DESKTOP_CLOUD_WEB_URL" => Some("http://localhost:3000".to_owned()),
            "PUPPYONE_CLOUD_API_URL" => Some("http://127.0.0.1:1/api/v1".to_owned()),
            _ => None,
        };
        let packaged = Environment::from_sources(Some(&file), env).unwrap();
        assert_eq!(packaged.api(), "https://api.puppyone.ai/api/v1");
        let development = Environment::from_sources(None, env).unwrap();
        assert_eq!(development.api(), "http://localhost:9000/api/v1");
        let legacy = |name: &str| match name {
            "PUPPYONE_CLOUD_API_URL" => Some("http://localhost:9000/api/v1".to_owned()),
            "PUPPYONE_CLOUD_WEB_URL" => Some("http://localhost:3000".to_owned()),
            _ => None,
        };
        assert!(Environment::from_sources(None, legacy).is_err());
    }
}
