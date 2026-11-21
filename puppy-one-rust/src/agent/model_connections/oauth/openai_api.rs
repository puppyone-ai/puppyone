//! The OpenAI API through "Sign in with ChatGPT" for agents, as Pi does it
//! (`packages/ai/src/auth/oauth/openai-chatgpt.ts`, MIT): the authorization
//! registers a public client for this app (`dynamic_agent_client`, named
//! by `agent_name_hint` and this installation's host ID), returns its
//! client ID with the code, and grants `chatgpt.tokens.use.direct` so the
//! token calls `https://api.openai.com/v1` itself. The issued client ID is
//! kept with the credential (`account_id`) for refreshes.
use super::loopback::Callback;
use super::{Cancel, Progress, pkce, post_form};
use crate::agent::model_connections::credentials::Credential;
use std::sync::Arc;

const DYNAMIC_CLIENT_ID: &str = "dynamic_agent_client";
const AGENT_NAME: &str = "PuppyOne";
const RESOURCE: &str = "https://api.openai.com/v1";
const CALLBACK_PORT: u16 = 1455;
const CALLBACK_PATH: &str = "/auth/callback";
const DIRECT_SCOPE: &str = "chatgpt.tokens.use.direct";
const SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
/// Refreshed this long before expiry (Pi: three minutes).
const EXPIRY_MARGIN_MS: i64 = 3 * 60 * 1000;

pub struct Endpoints {
    pub authorize: String,
    pub token: String,
    pub callback_port: u16,
}
impl Default for Endpoints {
    fn default() -> Self {
        Self {
            authorize: "https://auth.openai.com/api/accounts/authorize".into(),
            token: "https://auth.openai.com/api/accounts/oauth/token".into(),
            callback_port: CALLBACK_PORT,
        }
    }
}

fn redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{port}{CALLBACK_PATH}")
}

/// This installation's agent host (`ext_agent_host_id`): a UUID made once
/// and kept in the data folder, separate from any analytics identity.
pub fn host_id() -> String {
    let path = crate::agent::model_connections::configuration::data_dir().join("agent-host-id");
    let stored = std::fs::read_to_string(&path)
        .ok()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| uuid::Uuid::parse_str(s).is_ok());
    let id = stored.unwrap_or_else(|| {
        let id = uuid::Uuid::new_v4().to_string();
        let _ = std::fs::create_dir_all(path.parent().unwrap_or(&path));
        let _ = std::fs::write(&path, &id);
        id
    });
    format!("urn:uuid:{id}")
}

pub fn authorize_url(
    endpoints: &Endpoints,
    port: u16,
    host: &str,
    challenge: &str,
    state: &str,
    nonce: &str,
) -> String {
    let mut url = url::Url::parse(&endpoints.authorize).expect("authorize URL");
    url.query_pairs_mut()
        .append_pair("client_id", DYNAMIC_CLIENT_ID)
        .append_pair("agent_name_hint", AGENT_NAME)
        .append_pair("ext_agent_host_id", host)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &redirect_uri(port))
        .append_pair("resource", RESOURCE)
        .append_pair("scope", SCOPE)
        .append_pair("state", state)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("nonce", nonce);
    url.into()
}

/// A token answer as a credential: the direct-use scope must be granted.
fn credential(body: &serde_json::Value, client_id: &str) -> Result<Credential, String> {
    let text = |key: &str| body[key].as_str().filter(|v| !v.trim().is_empty());
    let access = text("access_token").ok_or("OAUTH_INVALID_RESPONSE")?;
    let refresh = text("refresh_token").ok_or("OAUTH_INVALID_RESPONSE")?;
    let scope = text("scope").ok_or("OAUTH_INVALID_RESPONSE")?;
    if !scope.split_whitespace().any(|s| s == DIRECT_SCOPE) {
        return Err("OAUTH_SCOPE_DENIED".into());
    }
    let expires_in = body["expires_in"]
        .as_f64()
        .filter(|e| e.is_finite() && *e > 0.)
        .ok_or("OAUTH_INVALID_RESPONSE")?;
    Ok(Credential::Oauth {
        access: access.to_owned(),
        refresh: refresh.to_owned(),
        expires: super::now_ms() + (expires_in * 1000.) as i64 - EXPIRY_MARGIN_MS,
        account_id: Some(client_id.to_owned()),
        label: None,
        endpoint: None,
    })
}

pub async fn login(
    endpoints: &Endpoints,
    progress: Arc<dyn Fn(Progress) + Send + Sync>,
    cancel: &Cancel,
) -> Result<Credential, String> {
    let host = host_id();
    let callback = Callback::bind(endpoints.callback_port)?;
    let port = callback.port;
    let pkce = pkce::Pkce::new();
    let (state, nonce) = (pkce::state(), pkce::state());
    progress(Progress::OpenBrowser {
        url: authorize_url(endpoints, port, &host, &pkce.challenge, &state, &nonce),
    });
    let authorization = callback
        .wait(
            CALLBACK_PATH.into(),
            Some(state),
            cancel.clone(),
            super::LOGIN_TIMEOUT,
        )
        .await?;
    // The registration answers with the client it issued.
    let client_id = authorization.client_id.ok_or("OAUTH_INVALID_RESPONSE")?;
    progress(Progress::Exchanging);
    let redirect = redirect_uri(port);
    let (status, body) = post_form(
        &endpoints.token,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", &client_id),
            ("code", &authorization.code),
            ("code_verifier", &pkce.verifier),
            ("redirect_uri", &redirect),
            ("resource", RESOURCE),
        ],
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err("OAUTH_EXCHANGE_FAILED".into());
    }
    if body["id_token"]
        .as_str()
        .is_none_or(|t| t.trim().is_empty())
    {
        return Err("OAUTH_INVALID_RESPONSE".into());
    }
    credential(&body, &client_id)
}

pub async fn refresh(
    endpoints: &Endpoints,
    client_id: &str,
    refresh_token: &str,
) -> Result<Credential, String> {
    let (status, body) = post_form(
        &endpoints.token,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("resource", RESOURCE),
        ],
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err("OAUTH_REAUTH_REQUIRED".into());
    }
    credential(&body, client_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_authorization_registers_a_client_named_for_this_app() {
        let url = url::Url::parse(&authorize_url(
            &Endpoints::default(),
            1455,
            "urn:uuid:00000000-0000-4000-8000-000000000000",
            "chal",
            "st",
            "nn",
        ))
        .unwrap();
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(url.path(), "/api/accounts/authorize");
        assert_eq!(pairs["client_id"], "dynamic_agent_client");
        assert_eq!(pairs["agent_name_hint"], "PuppyOne");
        assert_eq!(pairs["resource"], "https://api.openai.com/v1");
        assert_eq!(pairs["redirect_uri"], "http://127.0.0.1:1455/auth/callback");
        assert!(pairs["scope"].contains("chatgpt.tokens.use.direct"));
    }

    #[test]
    fn the_callback_client_signs_in_and_refreshes() {
        let (base, server) = super::super::test_server::serve(vec![
            (
                "200 OK",
                r#"{"access_token":"oat","refresh_token":"ort","id_token":"idt","expires_in":3600,"scope":"openid resource.invoke chatgpt.tokens.use.direct"}"#,
            ),
            (
                "200 OK",
                r#"{"access_token":"oat2","refresh_token":"ort2","expires_in":3600,"scope":"chatgpt.tokens.use.direct"}"#,
            ),
        ]);
        let endpoints = Endpoints {
            authorize: format!("{base}/authorize"),
            token: format!("{base}/token"),
            callback_port: 0,
        };
        let progress: Arc<dyn Fn(Progress) + Send + Sync> = Arc::new(|step| {
            if let Progress::OpenBrowser { url } = step {
                let url = url::Url::parse(&url).unwrap();
                let pairs: std::collections::HashMap<_, _> =
                    url.query_pairs().into_owned().collect();
                let port = url::Url::parse(&pairs["redirect_uri"])
                    .unwrap()
                    .port()
                    .unwrap();
                let request = format!(
                    "GET /auth/callback?code=the-code&state={}&client_id=app_issued HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
                    pairs["state"]
                );
                std::thread::spawn(move || {
                    use std::io::{Read, Write};
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
                    stream.write_all(request.as_bytes()).unwrap();
                    let _ = stream.read(&mut [0u8; 512]);
                });
            }
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let credential = runtime
            .block_on(login(&endpoints, progress, &Cancel::default()))
            .unwrap();
        assert_eq!(credential.bearer(), "oat");
        assert_eq!(credential.account_id(), Some("app_issued"));
        let fresh = runtime
            .block_on(refresh(&endpoints, "app_issued", "ort"))
            .unwrap();
        assert_eq!(fresh.bearer(), "oat2");
        let requests = server.join().unwrap();
        assert!(requests[0].body.contains("client_id=app_issued"));
        assert!(
            requests[0]
                .body
                .contains("resource=https%3A%2F%2Fapi.openai.com%2Fv1")
        );
        assert!(requests[1].body.contains("grant_type=refresh_token"));
    }

    #[test]
    fn a_grant_without_direct_use_is_refused() {
        let body = serde_json::json!({
            "access_token": "a", "refresh_token": "r", "expires_in": 60, "scope": "openid"
        });
        assert_eq!(credential(&body, "c").unwrap_err(), "OAUTH_SCOPE_DENIED");
    }
}
