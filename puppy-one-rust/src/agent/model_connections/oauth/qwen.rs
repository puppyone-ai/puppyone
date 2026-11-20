//! Qwen Code sign-in (`QwenLM/qwen-code`: `packages/core/src/qwen/qwenOAuth2.ts`,
//! Apache-2.0): RFC 8628 device authorization with PKCE at `chat.qwen.ai`.
//! The token names the account's API host (`resource_url`), served as an
//! OpenAI-compatible endpoint at `https://<host>/v1`.
use super::device::{self, Device};
use super::{Cancel, Progress, pkce, post_form, token_credential};
use crate::agent::model_connections::credentials::Credential;
use std::sync::Arc;

const CLIENT_ID: &str = "f0304373b74a44d2b584a3fb70ca9e56";
const SCOPE: &str = "openid profile email model.completion";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";
/// The endpoint used when the token names none (`DEFAULT_DASHSCOPE_BASE_URL`).
const DEFAULT_ENDPOINT: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1";

pub struct Endpoints {
    pub host: String,
}
impl Default for Endpoints {
    fn default() -> Self {
        Self {
            host: "https://chat.qwen.ai".into(),
        }
    }
}

/// `getCurrentEndpoint(resource_url)`: https, one `/v1`. Only an https host
/// is accepted, so a token cannot send requests to plain HTTP.
pub fn endpoint(resource_url: Option<&str>) -> Result<String, String> {
    let Some(raw) = resource_url.map(str::trim).filter(|r| !r.is_empty()) else {
        return Ok(DEFAULT_ENDPOINT.into());
    };
    let with_scheme = if raw.contains("://") {
        raw.to_owned()
    } else {
        format!("https://{raw}")
    };
    let url = url::Url::parse(&with_scheme).map_err(|_| "OAUTH_INVALID_RESPONSE")?;
    if url.scheme() != "https" || url.host_str().is_none() || url.query().is_some() {
        return Err("OAUTH_INVALID_RESPONSE".into());
    }
    let base = url.as_str().trim_end_matches('/').to_owned();
    Ok(if base.ends_with("/v1") {
        base
    } else {
        format!("{base}/v1")
    })
}

/// A token response as a Qwen credential with its endpoint.
fn credential(body: &serde_json::Value, require_refresh: bool) -> Result<Credential, String> {
    let endpoint = endpoint(body["resource_url"].as_str())?;
    match token_credential(body, require_refresh)? {
        Credential::Oauth {
            access,
            refresh,
            expires,
            account_id,
            label,
            ..
        } => Ok(Credential::Oauth {
            access,
            refresh,
            expires,
            account_id,
            label,
            endpoint: Some(endpoint),
        }),
        other => Ok(other),
    }
}

pub async fn login(
    endpoints: &Endpoints,
    progress: Arc<dyn Fn(Progress) + Send + Sync>,
    cancel: &Cancel,
) -> Result<Credential, String> {
    let pkce = pkce::Pkce::new();
    let (status, body) = post_form(
        &format!("{}/api/v1/oauth2/device/code", endpoints.host),
        &[
            ("client_id", CLIENT_ID),
            ("scope", SCOPE),
            ("code_challenge", &pkce.challenge),
            ("code_challenge_method", "S256"),
        ],
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
        &format!("{}/api/v1/oauth2/token", endpoints.host),
        &[
            ("grant_type", DEVICE_GRANT),
            ("client_id", CLIENT_ID),
            ("device_code", &device.device_code),
            ("code_verifier", &pkce.verifier),
        ],
        cancel,
    )
    .await?;
    credential(&body, true)
}

pub async fn refresh(endpoints: &Endpoints, refresh_token: &str) -> Result<Credential, String> {
    let (status, body) = post_form(
        &format!("{}/api/v1/oauth2/token", endpoints.host),
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
mod tests {
    use super::*;

    #[test]
    fn the_resource_url_becomes_an_https_v1_endpoint() {
        assert_eq!(
            endpoint(Some("portal.qwen.ai")).unwrap(),
            "https://portal.qwen.ai/v1"
        );
        assert_eq!(
            endpoint(Some("https://portal.qwen.ai/v1/")).unwrap(),
            "https://portal.qwen.ai/v1"
        );
        assert_eq!(endpoint(None).unwrap(), DEFAULT_ENDPOINT);
        assert!(endpoint(Some("http://portal.qwen.ai")).is_err());
        assert!(endpoint(Some("https://evil.test/?x=1")).is_err());
    }

    #[test]
    fn the_device_flow_sends_pkce_and_keeps_the_endpoint() {
        let (base, server) = super::super::test_server::serve(vec![
            (
                "200 OK",
                r#"{"device_code":"dc","user_code":"QWEN-1","verification_uri":"http://127.0.0.1/authorize","interval":1,"expires_in":60}"#,
            ),
            (
                "200 OK",
                r#"{"access_token":"qat","refresh_token":"qrt","expires_in":900,"resource_url":"portal.qwen.ai"}"#,
            ),
        ]);
        let progress: Arc<dyn Fn(Progress) + Send + Sync> = Arc::new(|_| {});
        let credential = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(login(
                &Endpoints { host: base },
                progress,
                &Cancel::default(),
            ))
            .unwrap();
        assert_eq!(credential.bearer(), "qat");
        assert!(matches!(
            &credential,
            Credential::Oauth { endpoint: Some(e), .. } if e == "https://portal.qwen.ai/v1"
        ));
        let requests = server.join().unwrap();
        assert!(requests[0].body.contains("code_challenge_method=S256"));
        assert!(requests[1].body.contains("code_verifier="));
    }
}
