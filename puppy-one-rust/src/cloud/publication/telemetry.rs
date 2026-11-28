//! `cloud-initialization/telemetry.mjs`: one `puppyone.cloud_initialization`
//! line in the app's own log ([`crate::platform::diagnostics`]) for each
//! step of a first publication. A line names the step and carries only the
//! allowlisted fields of [`Fields`]: identifiers, the error code, the
//! outcome, how long the attempt has run and the attempt count, with the
//! commit cut to 12 characters. Never a secret, a remote URL or a local
//! path. Writing the line never changes the publication.
use super::{Code, journal::Record};
use chrono::{DateTime, Utc};
use serde_json::{Map, Value};

/// The log event every step is written under.
pub const LOG_EVENT: &str = "puppyone.cloud_initialization";
/// A commit is identified by its first 12 characters.
const COMMIT_CHARS: usize = 12;

/// `ALLOWED_FIELDS`: everything a line may carry besides the step's name
/// and when it happened.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Fields {
    pub operation_id: Option<String>,
    pub attempt_id: Option<String>,
    pub project_id: Option<String>,
    pub commit_oid: Option<String>,
    pub error_code: Option<&'static str>,
    pub outcome: Option<&'static str>,
    pub duration_ms: Option<u64>,
    pub attempt_count: Option<u32>,
}

impl Fields {
    /// `eventFields`: the operation's identifiers, its attempt count and
    /// how long the current attempt (or else the operation) has run.
    pub fn of(record: &Record, now: DateTime<Utc>) -> Self {
        let started = DateTime::parse_from_rfc3339(&record.attempt.started_at)
            .or_else(|_| DateTime::parse_from_rfc3339(&record.created_at))
            .ok();
        Self {
            operation_id: Some(record.operation_id.clone()),
            attempt_id: Some(record.attempt.attempt_id.clone()).filter(|id| !id.is_empty()),
            project_id: record.project_id.clone(),
            commit_oid: Some(record.attempt.commit_oid.clone()).filter(|oid| !oid.is_empty()),
            attempt_count: Some(record.attempt_count),
            duration_ms: started.map(|at| {
                u64::try_from((now - at.with_timezone(&Utc)).num_milliseconds()).unwrap_or(0)
            }),
            ..Self::default()
        }
    }
    pub fn error(mut self, code: &'static str) -> Self {
        self.error_code = Some(code);
        self
    }
    pub fn outcome(mut self, outcome: &'static str) -> Self {
        self.outcome = Some(outcome);
        self
    }
}

/// The line's fields: `event`, `occurred_at`, then each field present.
pub fn line(name: &str, fields: &Fields, now: DateTime<Utc>) -> Value {
    let mut line = Map::new();
    line.insert("event".into(), name.into());
    line.insert(
        "occurred_at".into(),
        now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
            .into(),
    );
    let text = [
        ("operation_id", fields.operation_id.as_deref()),
        ("attempt_id", fields.attempt_id.as_deref()),
        ("project_id", fields.project_id.as_deref()),
        (
            "commit_oid",
            fields
                .commit_oid
                .as_deref()
                .map(|oid| oid.get(..COMMIT_CHARS).unwrap_or(oid)),
        ),
        ("error_code", fields.error_code),
        ("outcome", fields.outcome),
    ];
    for (name, value) in text {
        if let Some(value) = value {
            line.insert(name.into(), value.into());
        }
    }
    if let Some(count) = fields.attempt_count {
        line.insert("attempt_count".into(), count.into());
    }
    if let Some(duration) = fields.duration_ms {
        line.insert("duration_ms".into(), duration.into());
    }
    Value::Object(line)
}

/// `record`: writes the step's line now.
pub fn record(name: &str, fields: Fields) {
    crate::platform::diagnostics::info(LOG_EVENT, line(name, &fields, Utc::now()));
}

/// `eventFields` of `record` as it stands now.
pub fn of(record: &Record) -> Fields {
    Fields::of(record, Utc::now())
}

/// `errorEventName`: the step a failure ends.
pub fn failure_event(code: Code) -> &'static str {
    match code {
        Code::PushUncertain => "push_attempt_uncertain",
        Code::PushFailed | Code::PushLimitExceeded | Code::RemoteRefConflict => {
            "push_attempt_failed"
        }
        _ => "cloud_init_failed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// `emits only the structured allowlist and truncates commit
    /// identifiers`: a record that knows a secret's reference, a
    /// credential-bearing remote and the checkout's path writes none of
    /// them.
    #[test]
    fn only_the_allowlist_is_written_and_the_commit_is_cut() {
        let request = super::super::Request {
            root: "/Users/private/repository".into(),
            api_base_url: "https://api.puppyone.test".into(),
            user_id: "user-1".into(),
            organization_id: "org-1".into(),
            project_name: "Notes".into(),
            source_branch: "main".into(),
            operation_id: None,
            action: super::super::Action::Initialize,
        };
        let mut record = super::super::initial_record(
            &request,
            "/Users/private/repository/.git",
            "0123456789abcdef0123456789abcdef01234567",
        );
        record.project_id = Some("project-3".into());
        record.attempt_count = 2;
        record.attempt.attempt_id = "attempt-2".into();
        record.secret_ref = Some("pwg_must_not_log".into());
        record.canonical_remote_url =
            Some("https://token:secret@example.test/git/project-3.git".into());
        record.attempt.started_at = "2026-07-17T23:59:58.500Z".into();
        let now = DateTime::parse_from_rfc3339("2026-07-18T00:00:00.000Z")
            .unwrap()
            .with_timezone(&Utc);
        let fields = Fields::of(&record, now).error(Code::PushFailed.as_str());
        let written = line("push_attempt_failed", &fields, now);
        assert_eq!(
            written,
            serde_json::json!({
                "event": "push_attempt_failed",
                "occurred_at": "2026-07-18T00:00:00.000Z",
                "operation_id": record.operation_id,
                "attempt_id": "attempt-2",
                "project_id": "project-3",
                "commit_oid": "0123456789ab",
                "error_code": "PUSH_FAILED",
                "attempt_count": 2,
                "duration_ms": 1500,
            })
        );
        record_line(&record, fields);
    }

    /// The line goes to the app's own log as `info`, carrying nothing else.
    fn record_line(entry: &Record, fields: Fields) {
        record("push_attempt_failed", fields);
        let written: Vec<Value> = crate::platform::diagnostics::recorded(LOG_EVENT)
            .into_iter()
            .filter(|l| l["fields"]["operation_id"] == entry.operation_id.as_str())
            .collect();
        assert_eq!(written.len(), 1);
        assert_eq!(written[0]["level"], "info");
        assert_eq!(written[0]["fields"]["commit_oid"], "0123456789ab");
        let text = written[0].to_string();
        for secret in ["pwg_", "token:secret", "/Users/private", "example.test"] {
            assert!(!text.contains(secret), "{secret} in {text}");
        }
    }

    /// `errorEventName`.
    #[test]
    fn a_failure_is_named_by_its_code() {
        assert_eq!(failure_event(Code::PushUncertain), "push_attempt_uncertain");
        for code in [
            Code::PushFailed,
            Code::PushLimitExceeded,
            Code::RemoteRefConflict,
        ] {
            assert_eq!(failure_event(code), "push_attempt_failed");
        }
        assert_eq!(failure_event(Code::CredentialFailed), "cloud_init_failed");
    }
}
