//! RFC 8628 device authorization polling (`device-code.ts`): the user
//! enters a code on any device while the app polls the token endpoint.
use super::{Cancel, post_form};
use std::time::{Duration, Instant};

/// A device authorization the provider issued.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Device {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval: Duration,
    pub expires_in: Duration,
}

/// RFC 8628 §3.2: five seconds when the server names no interval.
const DEFAULT_INTERVAL: Duration = Duration::from_secs(5);
const MINIMUM_INTERVAL: Duration = Duration::from_secs(1);
/// §3.5: `slow_down` adds five seconds.
const SLOW_DOWN: Duration = Duration::from_secs(5);

/// Parse a device authorization response. The verification page must be
/// https (http only on loopback, for tests).
pub fn parse(body: &serde_json::Value) -> Result<Device, String> {
    let text = |key: &str| {
        body[key]
            .as_str()
            .filter(|v| !v.is_empty())
            .map(str::to_owned)
    };
    let uri = text("verification_uri_complete")
        .or_else(|| text("verification_uri"))
        .ok_or("OAUTH_INVALID_RESPONSE")?;
    let parsed = url::Url::parse(&uri).map_err(|_| "OAUTH_INVALID_RESPONSE")?;
    let loopback = parsed.host_str().is_some_and(|h| h == "127.0.0.1");
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return Err("OAUTH_INVALID_RESPONSE".into());
    }
    let seconds = |key: &str| {
        body[key]
            .as_u64()
            .or_else(|| body[key].as_str().and_then(|s| s.trim().parse().ok()))
            .filter(|s| *s > 0)
    };
    Ok(Device {
        device_code: text("device_code").ok_or("OAUTH_INVALID_RESPONSE")?,
        user_code: text("user_code").ok_or("OAUTH_INVALID_RESPONSE")?,
        verification_uri: uri,
        interval: seconds("interval")
            .map(Duration::from_secs)
            .unwrap_or(DEFAULT_INTERVAL)
            .max(MINIMUM_INTERVAL),
        expires_in: Duration::from_secs(seconds("expires_in").unwrap_or(15 * 60)),
    })
}

/// What one poll of the token endpoint said.
#[derive(Debug, PartialEq, Eq)]
pub enum Poll {
    Pending,
    SlowDown(Option<Duration>),
    Complete(serde_json::Value),
    Failed(String),
}

/// The RFC 8628 reading of a token endpoint answer.
pub fn classify(status: u16, body: serde_json::Value) -> Poll {
    if (200..300).contains(&status) && body["access_token"].is_string() {
        return Poll::Complete(body);
    }
    match body["error"].as_str() {
        Some("authorization_pending") => Poll::Pending,
        Some("slow_down") => Poll::SlowDown(body["interval"].as_u64().map(Duration::from_secs)),
        Some("access_denied" | "authorization_denied") => Poll::Failed("OAUTH_DENIED".into()),
        Some("expired_token") => Poll::Failed("OAUTH_EXPIRED".into()),
        _ if status >= 500 => Poll::Pending,
        _ => Poll::Failed("OAUTH_INVALID_RESPONSE".into()),
    }
}

/// Poll `token_url` with `form` until the user approves, the code expires
/// or the sign-in is cancelled.
pub async fn poll(
    device: &Device,
    token_url: &str,
    form: &[(&str, &str)],
    cancel: &Cancel,
) -> Result<serde_json::Value, String> {
    let deadline = Instant::now() + device.expires_in;
    let mut interval = device.interval;
    loop {
        sleep(
            interval.min(deadline.saturating_duration_since(Instant::now())),
            cancel,
        )
        .await?;
        if Instant::now() >= deadline {
            return Err("OAUTH_EXPIRED".into());
        }
        let (status, body) = match post_form(token_url, form).await {
            Ok(answer) => answer,
            // A dropped request is retried at the next interval.
            Err(_) => continue,
        };
        match classify(status, body) {
            Poll::Complete(body) => return Ok(body),
            Poll::Pending => {}
            Poll::SlowDown(next) => {
                interval = next
                    .map(|n| n.max(MINIMUM_INTERVAL))
                    .unwrap_or(interval + SLOW_DOWN);
            }
            Poll::Failed(code) => return Err(code),
        }
    }
}

/// Sleep in short steps so a cancel stops the wait promptly.
async fn sleep(total: Duration, cancel: &Cancel) -> Result<(), String> {
    let end = Instant::now() + total;
    while Instant::now() < end {
        cancel.check()?;
        tokio::time::sleep((end - Instant::now()).min(Duration::from_millis(100))).await;
    }
    cancel.check()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn device_authorizations_are_parsed_with_safe_defaults() {
        let device = parse(&json!({
            "device_code": "dc", "user_code": "ABCD-EFGH",
            "verification_uri": "https://auth.example.test/device",
            "verification_uri_complete": "https://auth.example.test/device?code=ABCD-EFGH",
            "interval": "0", "expires_in": 600
        }))
        .unwrap();
        assert_eq!(
            device.verification_uri,
            "https://auth.example.test/device?code=ABCD-EFGH"
        );
        // A missing or zero interval is the RFC default.
        assert_eq!(device.interval, DEFAULT_INTERVAL);
        assert_eq!(device.expires_in, Duration::from_secs(600));
        for unsafe_uri in ["http://auth.example.test/device", "javascript:alert(1)"] {
            assert!(
                parse(
                    &json!({"device_code": "dc", "user_code": "u", "verification_uri": unsafe_uri})
                )
                .is_err(),
                "{unsafe_uri}"
            );
        }
        assert!(parse(&json!({"user_code": "u", "verification_uri": "https://a.test"})).is_err());
    }

    #[test]
    fn token_answers_follow_rfc_8628() {
        assert_eq!(
            classify(400, json!({"error": "authorization_pending"})),
            Poll::Pending
        );
        assert_eq!(
            classify(400, json!({"error": "slow_down", "interval": 9})),
            Poll::SlowDown(Some(Duration::from_secs(9)))
        );
        assert_eq!(
            classify(400, json!({"error": "slow_down"})),
            Poll::SlowDown(None)
        );
        assert_eq!(
            classify(400, json!({"error": "access_denied"})),
            Poll::Failed("OAUTH_DENIED".into())
        );
        assert_eq!(
            classify(400, json!({"error": "expired_token"})),
            Poll::Failed("OAUTH_EXPIRED".into())
        );
        assert_eq!(classify(503, json!(null)), Poll::Pending);
        assert!(matches!(
            classify(200, json!({"access_token": "a"})),
            Poll::Complete(_)
        ));
    }

    #[test]
    fn polling_waits_for_approval_and_honours_slow_down() {
        let (base, server) = super::super::test_server::serve(vec![
            ("400 Bad Request", r#"{"error":"authorization_pending"}"#),
            ("400 Bad Request", r#"{"error":"slow_down","interval":1}"#),
            (
                "200 OK",
                r#"{"access_token":"at","refresh_token":"rt","expires_in":3600}"#,
            ),
        ]);
        let device = Device {
            device_code: "dc".into(),
            user_code: "u".into(),
            verification_uri: "https://a.test".into(),
            interval: MINIMUM_INTERVAL,
            expires_in: Duration::from_secs(30),
        };
        let body = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(poll(
                &device,
                &format!("{base}/token"),
                &[("device_code", "dc")],
                &Cancel::default(),
            ))
            .unwrap();
        assert_eq!(body["access_token"], "at");
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 3);
        assert!(requests.iter().all(|r| r.body.contains("device_code=dc")));
    }
}
