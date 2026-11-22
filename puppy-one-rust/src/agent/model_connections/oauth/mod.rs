//! Provider sign-in for the Built-in Agent, ported from Pi Coding Agent's
//! OAuth flows (`earendil-works/pi@d981de1229ef899957bbe968bc8dcda02a21f477:
//! packages/ai/src/auth/oauth/`, MIT). Requests name this app
//! (`originator` / `referrer`: `puppyone`); no flow impersonates another
//! vendor's client, which is why Pi's Claude Pro/Max and GitHub Copilot
//! sign-ins are not ported.
//!
//! Every flow runs in the app process: the browser is opened by the caller
//! from [`Progress::OpenBrowser`], the callback listens on loopback only,
//! and the tokens it yields go straight to the Keychain
//! ([`super::credentials`]).
mod chatgpt;
mod device;
mod kimi;
mod loopback;
mod meta;
mod openrouter;
pub mod pkce;
mod xai;

use super::credentials::Credential;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// The sign-ins the Built-in Agent offers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OauthProvider {
    /// ChatGPT Plus / Pro through OpenAI's Codex sign-in.
    Chatgpt,
    /// OpenRouter: the sign-in issues a user-controlled API key.
    Openrouter,
    /// Kimi Code subscription.
    KimiCode,
    /// SuperGrok / X Premium.
    Xai,
    /// Meta Model API through Meta's sign-in (Pi `meta.ts`).
    Meta,
}

impl OauthProvider {
    /// The sign-ins Settings offers, in order.
    pub const ALL: [OauthProvider; 5] = [
        OauthProvider::Chatgpt,
        OauthProvider::Openrouter,
        OauthProvider::KimiCode,
        OauthProvider::Xai,
        OauthProvider::Meta,
    ];
    pub fn key(self) -> &'static str {
        match self {
            Self::Chatgpt => "chatgpt",
            Self::Openrouter => "openrouter",
            Self::KimiCode => "kimi-code",
            Self::Xai => "xai",
            Self::Meta => "meta",
        }
    }
    /// The flow opens a browser and waits on a loopback callback (else it is
    /// a device-code flow the user completes on any device).
    pub fn uses_browser_callback(self) -> bool {
        matches!(self, Self::Chatgpt | Self::Openrouter | Self::Xai)
    }
}

/// What the user must do while a sign-in runs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Progress {
    /// Open this authorization page in the system browser.
    OpenBrowser { url: String },
    /// Enter `user_code` at `verification_uri` (opened for the user).
    DeviceCode {
        user_code: String,
        verification_uri: String,
    },
    /// The provider answered; tokens are being exchanged.
    Exchanging,
}

/// Controls a running sign-in from the UI: cancels it, or hands it what
/// the user pasted when the browser could not reach the app (the code a
/// provider's page shows, or the final callback URL; Pi's manual input).
/// Cheap to clone.
#[derive(Clone, Default)]
pub struct Cancel {
    cancelled: Arc<AtomicBool>,
    pasted: Arc<std::sync::Mutex<Option<String>>>,
}
impl Cancel {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }
    pub fn cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
    /// What the user pasted; the browser flow takes it instead of waiting
    /// for its callback.
    pub fn paste(&self, text: String) {
        if let Ok(mut pasted) = self.pasted.lock() {
            *pasted = Some(text);
        }
    }
    fn take_pasted(&self) -> Option<String> {
        self.pasted.lock().ok()?.take()
    }
    fn check(&self) -> Result<(), String> {
        if self.cancelled() {
            Err("OAUTH_CANCELLED".into())
        } else {
            Ok(())
        }
    }
}

/// The longest a sign-in waits for the user.
const LOGIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// The HTTP client sign-in requests use: system proxy, no redirects.
fn client() -> Result<reqwest::Client, String> {
    crate::platform::proxy::system(
        reqwest::Client::builder().user_agent(crate::agent::model_connections::USER_AGENT),
    )
    .redirect_policy(reqwest::redirect::Policy::none())
    .connect_timeout(std::time::Duration::from_secs(15))
    .timeout(std::time::Duration::from_secs(30))
    .build()
    .map_err(|_| "OAUTH_UNAVAILABLE".to_owned())
}

/// A token endpoint's answer, read as JSON whatever its status.
async fn post_form(url: &str, form: &[(&str, &str)]) -> Result<(u16, serde_json::Value), String> {
    let response = client()?
        .post(url)
        .header("accept", "application/json")
        .header("x-request-id", uuid::Uuid::new_v4().to_string())
        .form(form)
        .send()
        .await
        .map_err(|_| "OAUTH_UNREACHABLE".to_owned())?;
    let status = response.status().as_u16();
    // A gateway's block or error page is not the provider's answer.
    let json = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("json"));
    if !json {
        return Err("OAUTH_UNAVAILABLE".into());
    }
    let body = response.json().await.unwrap_or(serde_json::Value::Null);
    Ok((status, body))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// A token response (`access_token`, `refresh_token`, `expires_in`) as a
/// credential. A provider that omits the refresh token on refresh keeps the
/// previous one ([`super::credentials::resolve`]).
fn token_credential(body: &serde_json::Value, require_refresh: bool) -> Result<Credential, String> {
    let access = body["access_token"]
        .as_str()
        .filter(|a| !a.is_empty())
        .ok_or("OAUTH_INVALID_RESPONSE")?;
    let refresh = body["refresh_token"].as_str().unwrap_or_default();
    if require_refresh && refresh.is_empty() {
        return Err("OAUTH_INVALID_RESPONSE".into());
    }
    let expires = body["expires_in"]
        .as_i64()
        .filter(|e| *e > 0)
        .map(|e| now_ms() + e * 1000)
        .unwrap_or_default();
    Ok(Credential::Oauth {
        access: access.to_owned(),
        refresh: refresh.to_owned(),
        expires,
        account_id: None,
        label: None,
        endpoint: None,
    })
}

/// Sign in with `provider`. `progress` tells the user what to do; the
/// returned credential is not stored yet.
pub async fn login(
    provider: OauthProvider,
    progress: impl Fn(Progress) + Send + Sync + 'static,
    cancel: Cancel,
) -> Result<Credential, String> {
    let progress: Arc<dyn Fn(Progress) + Send + Sync> = Arc::new(progress);
    let flow = async {
        match provider {
            OauthProvider::Chatgpt => {
                chatgpt::login(&chatgpt::Endpoints::default(), progress, &cancel).await
            }
            OauthProvider::Openrouter => {
                openrouter::login(&openrouter::Endpoints::default(), progress, &cancel).await
            }
            OauthProvider::KimiCode => {
                kimi::login(&kimi::Endpoints::default(), progress, &cancel).await
            }
            OauthProvider::Xai => xai::login(&xai::Endpoints::default(), progress, &cancel).await,
            OauthProvider::Meta => {
                meta::login(&meta::Endpoints::default(), progress, &cancel).await
            }
        }
    };
    tokio::time::timeout(LOGIN_TIMEOUT, flow)
        .await
        .map_err(|_| "OAUTH_TIMEOUT".to_owned())?
}

/// A fresh access token for `refresh_token`.
pub async fn refresh(provider: OauthProvider, refresh_token: &str) -> Result<Credential, String> {
    match provider {
        OauthProvider::Chatgpt => {
            chatgpt::refresh(&chatgpt::Endpoints::default(), refresh_token).await
        }
        // OpenRouter issues a permanent key; nothing to refresh.
        OauthProvider::Openrouter => Err("OAUTH_REAUTH_REQUIRED".into()),
        OauthProvider::KimiCode => kimi::refresh(&kimi::Endpoints::default(), refresh_token).await,
        OauthProvider::Xai => xai::refresh(&xai::Endpoints::default(), refresh_token).await,
        OauthProvider::Meta => meta::refresh(&meta::Endpoints::default(), refresh_token).await,
    }
}

#[cfg(test)]
mod test_server;
