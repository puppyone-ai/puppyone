//! Kimi Code sign-in (`kimi-coding.ts`): RFC 8628 device authorization at
//! `auth.kimi.com`; the access token authenticates Anthropic Messages
//! requests to `api.kimi.com/coding` as a bearer token.
use super::device::{self, Device};
use super::{Cancel, Progress, post_form, token_credential};
use crate::agent::model_connections::credentials::Credential;
use std::sync::Arc;

const CLIENT_ID: &str = "17e5f671-d194-4dfb-9706-5516cb48c098";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";

pub struct Endpoints {
    pub host: String,
}
impl Default for Endpoints {
    fn default() -> Self {
        Self {
            host: "https://auth.kimi.com".into(),
        }
    }
}

pub async fn login(
    endpoints: &Endpoints,
    progress: Arc<dyn Fn(Progress) + Send + Sync>,
    cancel: &Cancel,
) -> Result<Credential, String> {
    let (status, body) = post_form(
        &format!("{}/api/oauth/device_authorization", endpoints.host),
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
        &format!("{}/api/oauth/token", endpoints.host),
        &[
            ("client_id", CLIENT_ID),
            ("device_code", &device.device_code),
            ("grant_type", DEVICE_GRANT),
        ],
        cancel,
    )
    .await?;
    token_credential(&body, true)
}

pub async fn refresh(endpoints: &Endpoints, refresh_token: &str) -> Result<Credential, String> {
    let (status, body) = post_form(
        &format!("{}/api/oauth/token", endpoints.host),
        &[
            ("client_id", CLIENT_ID),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ],
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err("OAUTH_REAUTH_REQUIRED".into());
    }
    token_credential(&body, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_device_flow_shows_the_code_then_returns_tokens() {
        let (base, server) = super::super::test_server::serve(vec![
            (
                "200 OK",
                r#"{"device_code":"dc","user_code":"KIMI-1234","verification_uri":"http://127.0.0.1/device","interval":1,"expires_in":60}"#,
            ),
            (
                "200 OK",
                r#"{"access_token":"kat","refresh_token":"krt","expires_in":900}"#,
            ),
        ]);
        let shown = Arc::new(std::sync::Mutex::new(vec![]));
        let sink = shown.clone();
        let progress: Arc<dyn Fn(Progress) + Send + Sync> =
            Arc::new(move |p| sink.lock().unwrap().push(p));
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
        assert_eq!(credential.bearer(), "kat");
        assert_eq!(
            shown.lock().unwrap()[0],
            Progress::DeviceCode {
                user_code: "KIMI-1234".into(),
                verification_uri: "http://127.0.0.1/device".into()
            }
        );
        let requests = server.join().unwrap();
        assert!(
            requests[0]
                .head
                .starts_with("POST /api/oauth/device_authorization")
        );
        assert!(
            requests[1]
                .body
                .contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code")
        );
    }

    #[test]
    fn a_rejected_refresh_asks_the_user_to_sign_in_again() {
        let (base, server) = super::super::test_server::serve(vec![(
            "401 Unauthorized",
            r#"{"error":"invalid_grant"}"#,
        )]);
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(refresh(&Endpoints { host: base }, "dead"));
        assert_eq!(result.unwrap_err(), "OAUTH_REAUTH_REQUIRED");
        server.join().unwrap();
    }
}
