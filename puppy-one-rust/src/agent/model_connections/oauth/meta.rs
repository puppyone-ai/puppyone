//! Meta Model API sign-in (`meta.ts`): RFC 8628 device authorization at
//! `auth.meta.com` yields an identity token that inference does not accept;
//! it is exchanged for a Model API key at the Muse Code key-mint endpoint.
//! The key is stored as `access` and the identity token as `refresh`, so a
//! refresh mints a fresh key. The identity token itself is not renewable:
//! a 401/403 from the mint means the user must sign in again.
use super::device::{self, Device};
use super::{Cancel, Progress, client, now_ms, post_form};
use crate::agent::model_connections::credentials::Credential;
use std::sync::Arc;

/// Muse Code CLI client ID.
const CLIENT_ID: &str = "1031625952748946";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";
/// Minted keys live about a day.
const API_KEY_LIFETIME_MS: i64 = 24 * 60 * 60 * 1000;

pub struct Endpoints {
    pub auth_host: String,
    pub mint: String,
}
impl Default for Endpoints {
    fn default() -> Self {
        Self {
            auth_host: "https://auth.meta.com".into(),
            mint: "https://api.meta.ai/muse-code/key".into(),
        }
    }
}

pub async fn login(
    endpoints: &Endpoints,
    progress: Arc<dyn Fn(Progress) + Send + Sync>,
    cancel: &Cancel,
) -> Result<Credential, String> {
    let (status, body) = post_form(
        &format!("{}/oidc/device/authorization/", endpoints.auth_host),
        &[("client_id", CLIENT_ID)],
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err("OAUTH_UNAVAILABLE".into());
    }
    let device: Device = device::parse(&body)?;
    progress(Progress::DeviceCode {
        user_code: device.user_code.clone(),
        verification_uri: device.verification_uri.clone(),
    });
    let body = device::poll(
        &device,
        &format!("{}/oidc/device/token/", endpoints.auth_host),
        &[
            ("grant_type", DEVICE_GRANT),
            ("device_code", &device.device_code),
            ("client_id", CLIENT_ID),
        ],
        cancel,
    )
    .await?;
    let identity = body["access_token"]
        .as_str()
        .filter(|t| !t.is_empty())
        .ok_or("OAUTH_INVALID_RESPONSE")?;
    progress(Progress::Exchanging);
    cancel.check()?;
    mint(endpoints, identity).await
}

/// A fresh Model API key for the stored identity token.
pub async fn refresh(endpoints: &Endpoints, refresh_token: &str) -> Result<Credential, String> {
    if refresh_token.is_empty() {
        return Err("OAUTH_REAUTH_REQUIRED".into());
    }
    mint(endpoints, refresh_token).await
}

/// Exchange an identity token for a Model API key.
async fn mint(endpoints: &Endpoints, identity: &str) -> Result<Credential, String> {
    let response = client()?
        .post(&endpoints.mint)
        .header("accept", "application/json")
        .header("authorization", format!("Bearer {identity}"))
        .header("content-type", "application/json")
        .header("x-api-version", "1.0.0")
        .body("{}")
        .send()
        .await
        .map_err(|_| "OAUTH_UNREACHABLE".to_owned())?;
    let status = response.status().as_u16();
    if status == 401 || status == 403 {
        return Err("OAUTH_REAUTH_REQUIRED".into());
    }
    if !(200..300).contains(&status) {
        return Err("OAUTH_UNAVAILABLE".into());
    }
    let body: serde_json::Value = response.json().await.unwrap_or(serde_json::Value::Null);
    // Without a key Meta may name a setup page (`action_url`); the account
    // has no Model API access yet, which only the user can fix.
    let api_key = body["api_key"]
        .as_str()
        .filter(|k| !k.is_empty())
        .ok_or("OAUTH_INVALID_RESPONSE")?;
    Ok(Credential::Oauth {
        access: api_key.to_owned(),
        refresh: identity.to_owned(),
        expires: now_ms() + API_KEY_LIFETIME_MS,
        account_id: None,
        label: None,
        endpoint: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

    #[test]
    fn the_device_flow_mints_a_model_api_key_with_the_identity_token() {
        let (base, server) = super::super::test_server::serve(vec![
            (
                "200 OK",
                r#"{"device_code":"dc","user_code":"META-1234","verification_uri":"http://127.0.0.1/device","interval":1,"expires_in":60}"#,
            ),
            ("400 Bad Request", r#"{"error":"authorization_pending"}"#),
            ("200 OK", r#"{"access_token":"identity","expires_in":3600}"#),
            ("200 OK", r#"{"api_key":"mak"}"#),
        ]);
        let shown = Arc::new(std::sync::Mutex::new(vec![]));
        let sink = shown.clone();
        let progress: Arc<dyn Fn(Progress) + Send + Sync> =
            Arc::new(move |p| sink.lock().unwrap().push(p));
        let endpoints = Endpoints {
            auth_host: base.clone(),
            mint: format!("{base}/muse-code/key"),
        };
        let credential = run(login(&endpoints, progress, &Cancel::default())).unwrap();
        assert_eq!(credential.bearer(), "mak");
        let Credential::Oauth {
            refresh, expires, ..
        } = &credential
        else {
            panic!("not an OAuth credential");
        };
        assert_eq!(refresh, "identity");
        let day = now_ms() + API_KEY_LIFETIME_MS;
        assert!((day - expires).abs() < 60_000, "{expires}");
        assert_eq!(
            *shown.lock().unwrap(),
            vec![
                Progress::DeviceCode {
                    user_code: "META-1234".into(),
                    verification_uri: "http://127.0.0.1/device".into()
                },
                Progress::Exchanging,
            ]
        );
        let requests = server.join().unwrap();
        assert!(
            requests[0]
                .head
                .starts_with("POST /oidc/device/authorization/ ")
        );
        assert!(requests[0].body.contains("client_id=1031625952748946"));
        for poll in &requests[1..3] {
            assert!(poll.head.starts_with("POST /oidc/device/token/ "));
            assert!(
                poll.body
                    .contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code")
            );
            assert!(poll.body.contains("device_code=dc"));
        }
        let mint = &requests[3];
        let head = mint.head.to_ascii_lowercase();
        assert!(mint.head.starts_with("POST /muse-code/key "));
        assert!(head.contains("authorization: bearer identity"));
        assert!(head.contains("x-api-version: 1.0.0"));
        assert!(head.contains("content-type: application/json"));
        assert_eq!(mint.body, "{}");
    }

    #[test]
    fn a_rejected_mint_asks_the_user_to_sign_in_again() {
        let (base, server) = super::super::test_server::serve(vec![(
            "401 Unauthorized",
            r#"{"error":"invalid_token"}"#,
        )]);
        let endpoints = Endpoints {
            auth_host: base.clone(),
            mint: format!("{base}/muse-code/key"),
        };
        let result = run(refresh(&endpoints, "dead"));
        assert_eq!(result.unwrap_err(), "OAUTH_REAUTH_REQUIRED");
        server.join().unwrap();
    }

    #[test]
    fn a_mint_without_a_key_is_an_error() {
        let (base, server) = super::super::test_server::serve(vec![(
            "200 OK",
            r#"{"action_url":"https://www.meta.ai/setup"}"#,
        )]);
        let endpoints = Endpoints {
            auth_host: base.clone(),
            mint: format!("{base}/muse-code/key"),
        };
        let result = run(refresh(&endpoints, "identity"));
        assert_eq!(result.unwrap_err(), "OAUTH_INVALID_RESPONSE");
        server.join().unwrap();
    }
}
