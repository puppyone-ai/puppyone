//! xAI sign-in for SuperGrok / X Premium. The browser flow is Cherry Studio's
//! (`src/main/services/oauth/runtime/providers/grok.ts`, AGPL-3.0, read for
//! its parameters): authorization code with PKCE (S256) for the public Grok
//! CLI client, a fixed loopback callback `http://127.0.0.1:56121/callback`
//! and a `nonce`; no code to type, so no code can be refused. The token
//! (scope `api:access`) calls the Responses API at `api.x.ai` as Pi does
//! (`providers/xai.ts`).
use super::loopback::Callback;
use super::{Cancel, Progress, pkce, post_form, token_credential};
use crate::agent::model_connections::credentials::Credential;
use std::sync::Arc;

const CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
const SCOPE: &str = "openid profile email offline_access grok-cli:access api:access";
/// The redirect registered for this client: the port is fixed.
const CALLBACK_PORT: u16 = 56121;
const CALLBACK_PATH: &str = "/callback";

pub struct Endpoints {
    pub authorize: String,
    pub token: String,
    pub callback_port: u16,
}
impl Default for Endpoints {
    fn default() -> Self {
        // `https://auth.x.ai/.well-known/openid-configuration`.
        Self {
            authorize: "https://auth.x.ai/oauth2/authorize".into(),
            token: "https://auth.x.ai/oauth2/token".into(),
            callback_port: CALLBACK_PORT,
        }
    }
}

fn redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{port}{CALLBACK_PATH}")
}

pub fn authorize_url(
    endpoints: &Endpoints,
    port: u16,
    challenge: &str,
    state: &str,
    nonce: &str,
) -> String {
    let mut url = url::Url::parse(&endpoints.authorize).expect("authorize URL");
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", &redirect_uri(port))
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("nonce", nonce);
    url.into()
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
    let nonce = pkce::state();
    progress(Progress::OpenBrowser {
        url: authorize_url(endpoints, port, &pkce.challenge, &state, &nonce),
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
    token_credential(&body, true)
}

/// xAI may omit the refresh token when it does not rotate it; the stored one
/// is kept ([`crate::agent::model_connections::credentials::resolve`]).
pub async fn refresh(endpoints: &Endpoints, refresh_token: &str) -> Result<Credential, String> {
    let (status, body) = post_form(
        &endpoints.token,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", CLIENT_ID),
            ("refresh_token", refresh_token),
        ],
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err("OAUTH_REAUTH_REQUIRED".into());
    }
    token_credential(&body, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_authorization_url_uses_the_registered_loopback_redirect() {
        let url = url::Url::parse(&authorize_url(
            &Endpoints::default(),
            CALLBACK_PORT,
            "chal",
            "st",
            "nn",
        ))
        .unwrap();
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(url.host_str(), Some("auth.x.ai"));
        assert_eq!(pairs["redirect_uri"], "http://127.0.0.1:56121/callback");
        assert_eq!(pairs["code_challenge_method"], "S256");
        assert_eq!(
            (pairs["state"].as_str(), pairs["nonce"].as_str()),
            ("st", "nn")
        );
        assert!(pairs["scope"].contains("api:access"));
    }

    #[test]
    fn the_browser_flow_exchanges_the_callback_code() {
        let (base, server) = super::super::test_server::serve(vec![(
            "200 OK",
            r#"{"access_token":"xat","refresh_token":"xrt","expires_in":3600}"#,
        )]);
        let endpoints = Endpoints {
            authorize: format!("{base}/authorize"),
            token: format!("{base}/token"),
            callback_port: 0,
        };
        // The "browser" follows the redirect with the code and state.
        let progress: Arc<dyn Fn(Progress) + Send + Sync> = Arc::new(|step| {
            if let Progress::OpenBrowser { url } = step {
                let url = url::Url::parse(&url).unwrap();
                let pairs: std::collections::HashMap<_, _> =
                    url.query_pairs().into_owned().collect();
                let redirect = url::Url::parse(&pairs["redirect_uri"]).unwrap();
                let port = redirect.port().unwrap();
                let request = format!(
                    "GET /callback?code=the-code&state={} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
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
        let credential = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(login(&endpoints, progress, &Cancel::default()))
            .unwrap();
        assert_eq!(credential.bearer(), "xat");
        let requests = server.join().unwrap();
        assert!(requests[0].body.contains("grant_type=authorization_code"));
        assert!(requests[0].body.contains("code=the-code"));
        assert!(requests[0].body.contains("code_verifier="));
    }

    #[test]
    fn a_refresh_without_a_new_refresh_token_is_accepted() {
        let (base, server) = super::super::test_server::serve(vec![(
            "200 OK",
            r#"{"access_token":"new-access","expires_in":600}"#,
        )]);
        let endpoints = Endpoints {
            authorize: format!("{base}/authorize"),
            token: format!("{base}/token"),
            callback_port: 0,
        };
        let credential = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(refresh(&endpoints, "old-refresh"))
            .unwrap();
        assert_eq!(credential.bearer(), "new-access");
        assert!(
            server.join().unwrap()[0]
                .body
                .contains("refresh_token=old-refresh")
        );
    }
}
