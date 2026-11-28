//! The public telemetry contract (`shared/desktop-telemetry-contract.mjs`,
//! `shared/desktop-telemetry-event.mjs`): versions, levels, the two bounded
//! events and their exact shapes. Nothing outside this file builds an event.
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SCHEMA_VERSION: u32 = 2;
pub const NOTICE_VERSION: u32 = 2;
pub const ONBOARDING_VERSION: u32 = 1;
pub const DAILY_ACTIVE: &str = "desktop_daily_active";
pub const FIRST_RUN: &str = "desktop_first_run";
/// `DESKTOP_STABLE_TELEMETRY_INGEST_URL`: pinned in source like the update
/// feed; only packaged Stable builds are eligible to use it.
pub const INGEST_URL: &str = "https://telemetry.puppyone.ai/v1/desktop/events";
/// `DESKTOP_TELEMETRY_DISCLOSURE_URL`.
pub const DISCLOSURE_URL: &str =
    "https://github.com/puppyone-ai/puppyone/blob/main/README.md#privacy";

/// `DESKTOP_TELEMETRY_LEVELS`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Off,
    Basic,
}

/// A queued or sent event. Field order is the product's.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub schema_version: u32,
    pub event_id: String,
    pub event: String,
    pub activity_day: String,
    pub anonymous_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retention_id: Option<String>,
    pub properties: Properties,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Properties {
    pub app_version: String,
    pub platform: String,
    pub architecture: String,
    pub os_major: String,
    pub notice_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub onboarding_version: Option<u32>,
}

/// What an event is built from.
#[derive(Clone, Debug)]
pub struct EventInput<'a> {
    pub activity_day: &'a str,
    pub anonymous_id: &'a str,
    pub app_version: &'a str,
    pub architecture: &'a str,
    pub event_id: &'a str,
    pub os_major: &'a str,
    pub platform: &'a str,
    pub retention_id: Option<&'a str>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Invalid {
    ActivityDay,
    AnonymousId,
    AppVersion,
    Architecture,
    EventId,
    Platform,
    RetentionId,
}

/// `createDesktopDailyActiveEvent`.
pub fn daily_active(input: &EventInput) -> Result<Event, Invalid> {
    current(DAILY_ACTIVE, input)
}
/// `createDesktopFirstRunEvent`: always carries the retention ID.
pub fn first_run(input: &EventInput) -> Result<Event, Invalid> {
    current(FIRST_RUN, input)
}

fn current(event: &str, input: &EventInput) -> Result<Event, Invalid> {
    let first_run = event == FIRST_RUN;
    let properties = Properties {
        app_version: require(input.app_version, version, Invalid::AppVersion)?,
        platform: require(input.platform, token, Invalid::Platform)?,
        architecture: require(input.architecture, token, Invalid::Architecture)?,
        os_major: normalize_os_major(input.os_major),
        notice_version: NOTICE_VERSION,
        onboarding_version: first_run.then_some(ONBOARDING_VERSION),
    };
    let retention_id = if first_run || input.retention_id.is_some() {
        Some(require(
            input.retention_id.unwrap_or_default(),
            |v| scoped_id(v, "r1_"),
            Invalid::RetentionId,
        )?)
    } else {
        None
    };
    Ok(Event {
        schema_version: SCHEMA_VERSION,
        event_id: require(input.event_id, event_id, Invalid::EventId)?,
        event: event.to_string(),
        activity_day: normalize_activity_day(input.activity_day)?,
        anonymous_id: require(
            input.anonymous_id,
            |v| scoped_id(v, "m1_"),
            Invalid::AnonymousId,
        )?,
        retention_id,
        properties,
    })
}

/// `isDesktopTelemetryEvent`: the current shapes exactly as the factories
/// build them, or the exact legacy (schema 1) daily-active shape.
pub fn is_event(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    // `retention_id: null` is present-but-invalid, not absent.
    if object.get("retention_id").is_some_and(Value::is_null)
        || object
            .get("properties")
            .and_then(Value::as_object)
            .and_then(|p| p.get("onboarding_version"))
            .is_some_and(Value::is_null)
    {
        return false;
    }
    let Ok(event) = serde_json::from_value::<Event>(value.clone()) else {
        return false;
    };
    match event.schema_version {
        1 => is_legacy(&event),
        SCHEMA_VERSION => {
            let factory = match event.event.as_str() {
                FIRST_RUN => first_run,
                DAILY_ACTIVE => daily_active,
                _ => return false,
            };
            factory(&EventInput {
                activity_day: &event.activity_day,
                anonymous_id: &event.anonymous_id,
                app_version: &event.properties.app_version,
                architecture: &event.properties.architecture,
                event_id: &event.event_id,
                os_major: &event.properties.os_major,
                platform: &event.properties.platform,
                retention_id: event.retention_id.as_deref(),
            })
            .is_ok_and(|normalized| normalized == event)
        }
        _ => false,
    }
}

fn is_legacy(event: &Event) -> bool {
    let p = &event.properties;
    event.event == DAILY_ACTIVE
        && event.retention_id.is_none()
        && p.onboarding_version.is_none()
        && event_id(&event.event_id)
        && normalize_activity_day(&event.activity_day).is_ok()
        && scoped_id(&event.anonymous_id, "m1_")
        && version(&p.app_version)
        && token(&p.platform)
        && token(&p.architecture)
        && normalize_os_major(&p.os_major) == p.os_major
        && p.notice_version == 1
}

/// `normalizeOsMajor`: the leading 1–3 digits as a number, else "unknown".
pub fn normalize_os_major(value: &str) -> String {
    let value = value.trim();
    let digits: String = value.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() || digits.len() > 3 {
        return "unknown".into();
    }
    digits
        .parse::<u32>()
        .map_or_else(|_| "unknown".into(), |n| n.to_string())
}

/// `normalizeActivityDay`: a real `YYYY-MM-DD` calendar day, never a time.
pub fn normalize_activity_day(value: &str) -> Result<String, Invalid> {
    utc_day(value)
        .then(|| value.to_string())
        .ok_or(Invalid::ActivityDay)
}

pub(super) fn utc_day(value: &str) -> bool {
    day_shape(value)
        && chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .is_ok_and(|d| d.format("%Y-%m-%d").to_string() == value)
}
pub(super) fn day_shape(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        })
}

fn require(value: &str, valid: impl Fn(&str) -> bool, invalid: Invalid) -> Result<String, Invalid> {
    valid(value).then(|| value.to_string()).ok_or(invalid)
}
/// `EVENT_ID_PATTERN`: a v1–v8 UUID with the RFC variant.
fn event_id(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            14 => (b'1'..=b'8').contains(c),
            19 => matches!(c.to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b'),
            _ => c.is_ascii_hexdigit(),
        })
}
/// `MONTHLY_ANONYMOUS_ID_PATTERN` / `RETENTION_ID_PATTERN`.
fn scoped_id(value: &str, prefix: &str) -> bool {
    value.strip_prefix(prefix).is_some_and(|rest| {
        (32..=64).contains(&rest.len())
            && rest
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    })
}
/// `VERSION_PATTERN`.
fn version(value: &str) -> bool {
    let b = value.as_bytes();
    (1..=80).contains(&b.len())
        && b[0].is_ascii_alphanumeric()
        && b[1..]
            .iter()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'+' | b'-'))
}
/// `TOKEN_PATTERN`.
fn token(value: &str) -> bool {
    let b = value.as_bytes();
    (1..=32).contains(&b.len())
        && b[0].is_ascii_alphanumeric()
        && b[1..]
            .iter()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    fn input(retention: Option<&'static str>) -> EventInput<'static> {
        EventInput {
            activity_day: "2026-08-27",
            anonymous_id: "m1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            app_version: "0.3.10",
            architecture: "arm64",
            event_id: "123e4567-e89b-42d3-a456-426614174000",
            os_major: "15.6.1",
            platform: "darwin",
            retention_id: retention,
        }
    }
    const R: &str = "r1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn a_daily_active_payload_is_fixed_and_carries_no_workspace_or_account_fields() {
        let event = daily_active(&input(Some(R))).unwrap();
        let value = serde_json::to_value(&event).unwrap();
        assert_eq!(
            value,
            json!({
                "schema_version": 2,
                "event_id": "123e4567-e89b-42d3-a456-426614174000",
                "event": "desktop_daily_active",
                "activity_day": "2026-08-27",
                "anonymous_id": "m1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "retention_id": R,
                "properties": {
                    "app_version": "0.3.10",
                    "platform": "darwin",
                    "architecture": "arm64",
                    "os_major": "15",
                    "notice_version": 2,
                },
            })
        );
        // The product's field order, as the ingest service receives it.
        let text = serde_json::to_string(&event).unwrap();
        assert!(text.starts_with(r#"{"schema_version":2,"event_id":"#));
        assert!(
            text.contains(r#""anonymous_id":"m1_"#) && text.ends_with(r#""notice_version":2}}"#)
        );
        let lower = text.to_lowercase();
        for word in ["path", "prompt", "account", "email", "remote", "repository"] {
            assert!(!lower.contains(word), "{word}");
        }
        assert!(is_event(&value));
    }

    #[test]
    fn unregistered_fields_timestamps_and_impossible_days_are_rejected() {
        let mut value = serde_json::to_value(daily_active(&input(Some(R))).unwrap()).unwrap();
        let mut extra = value.clone();
        extra["workspace_path"] = json!("/private/project");
        assert!(!is_event(&extra));
        let mut locale = value.clone();
        locale["properties"]["locale"] = json!("en-US");
        assert!(!is_event(&locale));
        let mut null_retention = value.clone();
        null_retention["retention_id"] = Value::Null;
        assert!(!is_event(&null_retention));
        assert_eq!(
            daily_active(&EventInput {
                activity_day: "2026-08-27T07:00:00.000Z",
                ..input(Some(R))
            }),
            Err(Invalid::ActivityDay)
        );
        value["activity_day"] = json!("2026-02-30");
        assert!(!is_event(&value));
    }

    #[test]
    fn daily_activity_outside_the_cohort_window_omits_the_retention_id() {
        let event = daily_active(&EventInput {
            activity_day: "2026-12-05",
            ..input(None)
        })
        .unwrap();
        assert_eq!(event.retention_id, None);
        let value = serde_json::to_value(&event).unwrap();
        assert!(value.get("retention_id").is_none());
        assert!(is_event(&value));
    }

    #[test]
    fn exactly_one_first_run_shape_is_allowed() {
        let event = first_run(&input(Some(R))).unwrap();
        assert_eq!(event.event, FIRST_RUN);
        assert_eq!(event.retention_id.as_deref(), Some(R));
        assert_eq!(event.properties.onboarding_version, Some(1));
        let mut value = serde_json::to_value(&event).unwrap();
        assert!(is_event(&value));
        value["properties"]["onboarding_version"] = json!(2);
        assert!(!is_event(&value));
        // A first-run event without its retention ID cannot be built.
        assert_eq!(first_run(&input(None)), Err(Invalid::RetentionId));
        // Daily activity never carries the onboarding version.
        let mut daily = serde_json::to_value(daily_active(&input(None)).unwrap()).unwrap();
        daily["properties"]["onboarding_version"] = json!(1);
        assert!(!is_event(&daily));
    }

    #[test]
    fn the_exact_legacy_schema_still_validates_for_queued_events() {
        let legacy = json!({
            "schema_version": 1,
            "event_id": "123e4567-e89b-42d3-a456-426614174000",
            "event": "desktop_daily_active",
            "activity_day": "2026-08-27",
            "anonymous_id": "m1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "properties": {
                "app_version": "0.3.10",
                "platform": "darwin",
                "architecture": "arm64",
                "os_major": "15",
                "notice_version": 1,
            },
        });
        assert!(is_event(&legacy));
        let mut with_retention = legacy.clone();
        with_retention["retention_id"] = json!(R);
        assert!(!is_event(&with_retention));
        let mut unnormalized = legacy.clone();
        unnormalized["properties"]["os_major"] = json!("15.1");
        assert!(!is_event(&unnormalized));
    }

    #[test]
    fn os_majors_and_identifier_shapes_follow_the_patterns() {
        assert_eq!(normalize_os_major(" 15.6.1 "), "15");
        assert_eq!(normalize_os_major("024"), "24");
        assert_eq!(normalize_os_major("1234"), "unknown");
        assert_eq!(normalize_os_major("Darwin"), "unknown");
        assert_eq!(normalize_os_major(""), "unknown");
        assert!(event_id("123E4567-E89B-42D3-A456-426614174000"));
        assert!(!event_id("123e4567-e89b-02d3-a456-426614174000"));
        assert!(!event_id("123e4567-e89b-42d3-c456-426614174000"));
        assert!(!scoped_id("m1_short", "m1_"));
        assert!(!scoped_id(&format!("m1_{}", "a".repeat(65)), "m1_"));
        assert!(!scoped_id(&format!("m1_{}=", "a".repeat(43)), "m1_"));
        assert!(version("0.4.0-beta.1+build.7") && !version("-0.4") && !version(""));
        assert!(token("x64") && token("win32") && !token("arm 64") && !token(&"a".repeat(33)));
    }
}
