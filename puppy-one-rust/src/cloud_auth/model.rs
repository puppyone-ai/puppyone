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
    pub fn configured() -> Result<Self> {
        Self::new(
            &std::env::var("PUPPYONE_CLOUD_API_URL").map_err(|_| Error::Configuration)?,
            &std::env::var("PUPPYONE_CLOUD_WEB_URL").map_err(|_| Error::Configuration)?,
        )
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
    let local = matches!(host, "localhost" | "127.0.0.1" | "[::1]");
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
}
impl ApiRequest {
    pub fn read_only(&self) -> bool {
        self.method == reqwest::Method::GET || self.method == reqwest::Method::HEAD
    }
}
