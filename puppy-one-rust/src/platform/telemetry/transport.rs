//! `telemetry-http-transport.mjs`: one POST of the versioned batch to a pinned
//! HTTPS endpoint, without cookies or redirects, within ten seconds.
use super::contract::{self, Event, SCHEMA_VERSION};
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(10);

/// Why a batch was not delivered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SendError {
    /// The HTTP status, when the service answered.
    pub status: Option<u16>,
    /// Network failures, 408, 425, 429 and 5xx are retried; other answers
    /// drop the batch.
    pub retryable: bool,
}

/// Delivers a batch, returning the IDs the service accepted.
pub trait Transport: Send + Sync {
    fn send(&self, events: &[Event]) -> Result<Vec<String>, SendError>;
}

/// `normalizeTelemetryEndpoint`.
pub fn normalize_endpoint(value: &str) -> Result<url::Url, &'static str> {
    let url = url::Url::parse(value).map_err(|_| "A valid telemetry endpoint is required.")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some_and(|q| !q.is_empty())
        || url.fragment().is_some_and(|f| !f.is_empty())
    {
        return Err(
            "The telemetry endpoint must be an HTTPS URL without credentials, query, or fragment.",
        );
    }
    Ok(url)
}

/// The JSON body: `{schema_version, sent_at, events}`.
pub fn body(events: &[Event], sent_at: chrono::DateTime<chrono::Utc>) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "schema_version": SCHEMA_VERSION,
        "sent_at": super::store::iso(sent_at),
        "events": events,
    }))
    .unwrap_or_default()
}

pub fn retryable(status: u16) -> bool {
    matches!(status, 408 | 425 | 429) || status >= 500
}

pub struct Http {
    endpoint: url::Url,
}
impl Http {
    pub fn new(endpoint: &str) -> Result<Self, &'static str> {
        Ok(Self {
            endpoint: normalize_endpoint(endpoint)?,
        })
    }
}
impl Transport for Http {
    fn send(&self, events: &[Event]) -> Result<Vec<String>, SendError> {
        let unavailable = SendError {
            status: None,
            retryable: true,
        };
        if events.is_empty()
            || !events
                .iter()
                .all(|e| serde_json::to_value(e).is_ok_and(|v| contract::is_event(&v)))
        {
            return Err(SendError {
                status: None,
                retryable: false,
            });
        }
        let payload = body(events, chrono::Utc::now());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| unavailable)?;
        let status = runtime.block_on(async {
            let client = reqwest::Client::builder()
                .redirect_policy(reqwest::redirect::Policy::none())
                .https_only(true)
                .timeout(TIMEOUT)
                .build()
                .map_err(|_| unavailable)?;
            let response = client
                .post(self.endpoint.clone())
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .header("X-PuppyOne-Telemetry-Schema", SCHEMA_VERSION.to_string())
                .body(payload)
                .send()
                .await
                .map_err(|_| unavailable)?;
            Ok::<_, SendError>(response.status().as_u16())
        })?;
        if !(200..300).contains(&status) {
            return Err(SendError {
                status: Some(status),
                retryable: retryable(status),
            });
        }
        Ok(events.iter().map(|e| e.event_id.clone()).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn only_a_versioned_batch_goes_to_a_pinned_https_endpoint() {
        let event = contract::daily_active(&contract::EventInput {
            activity_day: "2026-08-27",
            anonymous_id: "m1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            app_version: "0.3.10",
            architecture: "arm64",
            event_id: "123e4567-e89b-42d3-a456-426614174000",
            os_major: "15",
            platform: "darwin",
            retention_id: Some("r1_ccccccccccccccccccccccccccccccccccccccccccc"),
        })
        .unwrap();
        let sent = chrono::DateTime::parse_from_rfc3339("2026-08-27T08:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let body: serde_json::Value =
            serde_json::from_slice(&body(std::slice::from_ref(&event), sent)).unwrap();
        assert_eq!(
            body,
            serde_json::json!({
                "schema_version": 2,
                "sent_at": "2026-08-27T08:00:00.000Z",
                "events": [serde_json::to_value(&event).unwrap()],
            })
        );
        assert!(normalize_endpoint(contract::INGEST_URL).is_ok());
        assert!(Http::new(contract::INGEST_URL).is_ok());
        let https = |e: &str| normalize_endpoint(e).unwrap_err();
        assert!(https("http://telemetry.puppyone.ai/events").contains("HTTPS"));
        assert!(https("https://token@example.com/events").contains("credentials"));
        assert!(https("https://example.com/events?secret=1").contains("query"));
        assert!(https("https://example.com/events#x").contains("fragment"));
        // Retries: network, 408, 425, 429 and 5xx; other answers drop the batch.
        assert!([408, 425, 429, 500, 503].into_iter().all(retryable));
        assert!(![400, 401, 403, 404, 413, 422].into_iter().any(retryable));
        // An invalid batch never reaches the network.
        let http = Http::new(contract::INGEST_URL).unwrap();
        assert!(!http.send(&[]).unwrap_err().retryable);
        let mut tampered = event;
        tampered.properties.os_major = "15.6".into();
        assert_eq!(
            http.send(&[tampered]).unwrap_err(),
            SendError {
                status: None,
                retryable: false
            }
        );
    }
}
