//! Qwen Code subscription sign-in, as Qwen Code does it today
//! (`QwenLM/qwen-code`: `packages/core/src/qwen/subscription-oauth-client.ts`
//! and `oauth-config.ts`, Apache-2.0): RFC 8628 device authorization at
//! `auth.qwen.ai` for the public client `qwen-code-cli`, scope
//! `model:invoke profile:read`. The token calls the subscription API at
//! `https://api.qwen.ai/compatible-mode/v1` (OpenAI-compatible). The plan is a
//! Qwen Plus or Pro subscription; a free account is refused on the
//! authorization page.
use super::device::{self, Device};
use super::{Cancel, Progress, post_form, token_credential};
use crate::agent::model_connections::credentials::Credential;
use std::sync::Arc;

const CLIENT_ID: &str = "qwen-code-cli";
const SCOPE: &str = "model:invoke profile:read";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";
/// The subscription API (`QWEN_SUBSCRIPTION_BASE_URL`).
pub const ENDPOINT: &str = "https://api.qwen.ai/compatible-mode/v1";

pub struct Endpoints {
    pub host: String,
}
impl Default for Endpoints {
    fn default() -> Self {
        Self {
            host: "https://auth.qwen.ai".into(),
        }
    }
}

/// `withQwenChatTracking`: the authorization page Qwen Code opens.
fn tracked(uri: &str) -> String {
    match url::Url::parse(uri) {
        Ok(mut url) if url.host_str() == Some("chat.qwen.ai") => {
            url.query_pairs_mut()
                .append_pair("entry", "qwen_code")
                .append_pair("paywallScene", "desktop");
            url.into()
        }
        _ => uri.to_owned(),
    }
}

/// A token answer as a credential on the subscription API.
fn credential(body: &serde_json::Value, require_refresh: bool) -> Result<Credential, String> {
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
            endpoint: Some(ENDPOINT.into()),
        }),
        other => Ok(other),
    }
}

pub async fn login(
    endpoints: &Endpoints,
    progress: Arc<dyn Fn(Progress) + Send + Sync>,
    cancel: &Cancel,
) -> Result<Credential, String> {
    let (status, body) = post_form(
        &format!("{}/api/oauth/device/code", endpoints.host),
        &[("client_id", CLIENT_ID), ("scope", SCOPE)],
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err("OAUTH_UNAVAILABLE".into());
    }
    let device: Device = device::parse(&body)?;
    progress(Progress::DeviceCode {
        user_code: device.user_code.clone(),
        verification_uri: tracked(&device.verification_uri),
    });
    let body = device::poll(
        &device,
        &format!("{}/api/oauth/token", endpoints.host),
        &[
            ("grant_type", DEVICE_GRANT),
            ("client_id", CLIENT_ID),
            ("device_code", &device.device_code),
        ],
        cancel,
    )
    .await?;
    credential(&body, true)
}

pub async fn refresh(endpoints: &Endpoints, refresh_token: &str) -> Result<Credential, String> {
    let (status, body) = post_form(
        &format!("{}/api/oauth/token", endpoints.host),
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
    credential(&body, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_authorization_page_carries_qwen_codes_tracking() {
        assert_eq!(
            tracked("https://chat.qwen.ai/device?user_code=JBBC-RQLR"),
            "https://chat.qwen.ai/device?user_code=JBBC-RQLR&entry=qwen_code&paywallScene=desktop"
        );
        assert_eq!(tracked("https://other.test/x"), "https://other.test/x");
    }

    #[test]
    fn the_device_flow_signs_in_to_the_subscription_api() {
        let (base, server) = super::super::test_server::serve(vec![
            (
                "200 OK",
                r#"{"device_code":"dc","user_code":"QWEN-1","verification_uri":"http://127.0.0.1/device","verification_uri_complete":"http://127.0.0.1/device?user_code=QWEN-1","interval":1,"expires_in":60}"#,
            ),
            ("400 Bad Request", r#"{"error":"authorization_pending"}"#),
            (
                "200 OK",
                r#"{"access_token":"qat","refresh_token":"qrt","token_type":"Bearer","expires_in":900,"scope":"model:invoke profile:read"}"#,
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
            Credential::Oauth { endpoint: Some(e), .. } if e == ENDPOINT
        ));
        let requests = server.join().unwrap();
        assert!(requests[0].head.starts_with("POST /api/oauth/device/code"));
        assert!(requests[0].body.contains("client_id=qwen-code-cli"));
        assert!(
            requests[0]
                .body
                .contains("scope=model%3Ainvoke+profile%3Aread")
        );
        assert!(requests[2].body.contains("device_code=dc"));
    }
}
