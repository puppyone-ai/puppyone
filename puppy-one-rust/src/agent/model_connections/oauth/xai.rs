//! xAI sign-in for SuperGrok / X Premium (`xai.ts`): RFC 8628 device
//! authorization at `auth.x.ai`; the access token authenticates Responses
//! requests to `api.x.ai`.
use super::device::{self, Device};
use super::{Cancel, Progress, post_form, token_credential};
use crate::agent::model_connections::credentials::Credential;
use std::sync::Arc;

const CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
const SCOPE: &str = "openid profile email offline_access grok-cli:access api:access";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";

pub struct Endpoints {
    pub device: String,
    pub token: String,
}
impl Default for Endpoints {
    fn default() -> Self {
        Self {
            device: "https://auth.x.ai/oauth2/device/code".into(),
            token: "https://auth.x.ai/oauth2/token".into(),
        }
    }
}

pub async fn login(
    endpoints: &Endpoints,
    progress: Arc<dyn Fn(Progress) + Send + Sync>,
    cancel: &Cancel,
) -> Result<Credential, String> {
    let (status, body) = post_form(
        &endpoints.device,
        &[
            ("client_id", CLIENT_ID),
            ("scope", SCOPE),
            ("referrer", "puppyone"),
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
        &endpoints.token,
        &[
            ("grant_type", DEVICE_GRANT),
            ("client_id", CLIENT_ID),
            ("device_code", &device.device_code),
        ],
        cancel,
    )
    .await?;
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
    fn a_refresh_without_a_new_refresh_token_is_accepted() {
        let (base, server) = super::super::test_server::serve(vec![(
            "200 OK",
            r#"{"access_token":"new-access","expires_in":600}"#,
        )]);
        let endpoints = Endpoints {
            device: format!("{base}/device"),
            token: format!("{base}/token"),
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
