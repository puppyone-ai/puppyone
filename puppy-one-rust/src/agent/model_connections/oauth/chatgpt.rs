//! ChatGPT (Plus / Pro) sign-in through OpenAI's Codex authorization
//! (`openai-codex.ts`): browser PKCE with the callback on
//! `localhost:1455/auth/callback` (the redirect the client is registered
//! with), then the account ID from the access token's claims.
use super::loopback::Callback;
use super::{Cancel, Progress, pkce, post_form, token_credential};
use crate::agent::model_connections::credentials::Credential;
use base64::Engine as _;
use std::sync::Arc;

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const SCOPE: &str = "openid profile email offline_access";
const CALLBACK_PORT: u16 = 1455;
const CALLBACK_PATH: &str = "/auth/callback";
/// The JWT claim holding the ChatGPT account.
const AUTH_CLAIM: &str = "https://api.openai.com/auth";
const PROFILE_CLAIM: &str = "https://api.openai.com/profile";

pub struct Endpoints {
    pub authorize: String,
    pub token: String,
    pub callback_port: u16,
}
impl Default for Endpoints {
    fn default() -> Self {
        Self {
            authorize: "https://auth.openai.com/oauth/authorize".into(),
            token: "https://auth.openai.com/oauth/token".into(),
            callback_port: CALLBACK_PORT,
        }
    }
}

fn redirect_uri(port: u16) -> String {
    format!("http://localhost:{port}{CALLBACK_PATH}")
}

/// The authorization page for `challenge` and `state`.
pub fn authorize_url(endpoints: &Endpoints, port: u16, challenge: &str, state: &str) -> String {
    let mut url = url::Url::parse(&endpoints.authorize).expect("authorize URL");
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", &redirect_uri(port))
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("id_token_add_organizations", "true")
        .append_pair("codex_cli_simplified_flow", "true");
    url.into()
}

/// The claims of a JWT, unverified (only read for the account it names; the
/// API authenticates the token).
fn claims(token: &str) -> Option<serde_json::Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// A token response as a ChatGPT credential: the account ID is required
/// (every request names it), the email is the Settings label.
pub fn credential(body: &serde_json::Value, require_refresh: bool) -> Result<Credential, String> {
    let Credential::Oauth {
        access,
        refresh,
        expires,
        ..
    } = token_credential(body, require_refresh)?
    else {
        unreachable!()
    };
    let claims = claims(&access).ok_or("OAUTH_INVALID_RESPONSE")?;
    let account_id = claims[AUTH_CLAIM]["chatgpt_account_id"]
        .as_str()
        .filter(|a| !a.is_empty())
        .ok_or("OAUTH_INVALID_RESPONSE")?
        .to_owned();
    let label = claims[PROFILE_CLAIM]["email"]
        .as_str()
        .or_else(|| claims["email"].as_str())
        .map(str::to_owned);
    Ok(Credential::Oauth {
        access,
        refresh,
        expires,
        account_id: Some(account_id),
        label,
        endpoint: None,
    })
}

pub async fn login(
    endpoints: &Endpoints,
    progress: Arc<dyn Fn(Progress) + Send + Sync>,
    cancel: &Cancel,
) -> Result<Credential, String> {
    let callback = Callback::bind(endpoints.callback_port)?;
    let port = callback.port;
    let pkce = pkce::Pkce::new();
    let state = pkce::state();
    progress(Progress::OpenBrowser {
        url: authorize_url(endpoints, port, &pkce.challenge, &state),
    });
    let authorization = callback
        .wait(
            CALLBACK_PATH.into(),
            Some(state),
            cancel.clone(),
            super::LOGIN_TIMEOUT,
        )
        .await?;
    progress(Progress::Exchanging);
    let redirect = redirect_uri(port);
    let (status, body) = post_form(
        &endpoints.token,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", CLIENT_ID),
            ("code", &authorization.code),
            ("code_verifier", &pkce.verifier),
            ("redirect_uri", &redirect),
        ],
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err("OAUTH_EXCHANGE_FAILED".into());
    }
    credential(&body, true)
}

pub async fn refresh(endpoints: &Endpoints, refresh_token: &str) -> Result<Credential, String> {
    let (status, body) = post_form(
        &endpoints.token,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", CLIENT_ID),
        ],
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err("OAUTH_REAUTH_REQUIRED".into());
    }
    credential(&body, false)
}

#[cfg(test)]
pub(crate) fn test_token(account: &str, email: &str) -> String {
    let encode = |v: serde_json::Value| {
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v.to_string())
    };
    format!(
        "{}.{}.sig",
        encode(serde_json::json!({"alg": "none"})),
        encode(serde_json::json!({
            AUTH_CLAIM: {"chatgpt_account_id": account},
            PROFILE_CLAIM: {"email": email}
        }))
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_authorization_url_is_codexs_with_the_loopback_redirect() {
        let url =
            url::Url::parse(&authorize_url(&Endpoints::default(), 1455, "chal", "st")).unwrap();
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(url.host_str(), Some("auth.openai.com"));
        assert_eq!(pairs["redirect_uri"], "http://localhost:1455/auth/callback");
        assert_eq!(pairs["code_challenge_method"], "S256");
        // As Cherry Studio: no `originator` on the authorization page (the
        // requests name PuppyOne in their `originator` header).
        assert!(!pairs.contains_key("originator"));
        assert_eq!(pairs["codex_cli_simplified_flow"], "true");
        assert_eq!(pairs["state"], "st");
    }

    #[test]
    fn the_account_and_email_come_from_the_access_token() {
        let access = test_token("acct-1", "me@example.test");
        let credential = credential(
            &json!({"access_token": access, "refresh_token": "rt", "expires_in": 60}),
            true,
        )
        .unwrap();
        assert_eq!(credential.account_id(), Some("acct-1"));
        assert_eq!(credential.label(), Some("me@example.test"));
        // A token without the account cannot make requests.
        assert!(
            credential_without_account().is_err(),
            "a token naming no account is refused"
        );
    }

    fn credential_without_account() -> Result<Credential, String> {
        credential(
            &json!({"access_token": "a.e30.s", "refresh_token": "rt", "expires_in": 60}),
            true,
        )
    }

    #[test]
    fn the_browser_flow_exchanges_the_callback_code_once() {
        let access = Box::leak(
            format!(
                r#"{{"access_token":"{}","refresh_token":"rt","expires_in":3600}}"#,
                test_token("acct-2", "u@example.test")
            )
            .into_boxed_str(),
        );
        let (base, server) = super::super::test_server::serve(vec![("200 OK", access)]);
        let endpoints = Endpoints {
            authorize: "https://auth.example.test/authorize".into(),
            token: format!("{base}/token"),
            callback_port: 0,
        };
        let (url_tx, url_rx) = std::sync::mpsc::channel::<String>();
        let progress: Arc<dyn Fn(Progress) + Send + Sync> = Arc::new(move |p| {
            if let Progress::OpenBrowser { url } = p {
                let _ = url_tx.send(url);
            }
        });
        // The "browser": follow the redirect with the issued state.
        let browser = std::thread::spawn(move || {
            let url = url::Url::parse(&url_rx.recv().unwrap()).unwrap();
            let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
            let redirect = url::Url::parse(&pairs["redirect_uri"]).unwrap();
            let target = format!("/auth/callback?code=the-code&state={}", pairs["state"]);
            use std::io::{Read, Write};
            let mut stream =
                std::net::TcpStream::connect(("127.0.0.1", redirect.port().unwrap())).unwrap();
            write!(stream, "GET {target} HTTP/1.1\r\n\r\n").unwrap();
            let mut page = String::new();
            let _ = stream.read_to_string(&mut page);
            page
        });
        let credential = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(login(&endpoints, progress, &Cancel::default()))
            .unwrap();
        assert!(browser.join().unwrap().starts_with("HTTP/1.1 200"));
        assert_eq!(credential.account_id(), Some("acct-2"));
        let requests = server.join().unwrap();
        assert!(requests[0].body.contains("grant_type=authorization_code"));
        assert!(requests[0].body.contains("code=the-code"));
        assert!(requests[0].body.contains("code_verifier="));
    }
}
