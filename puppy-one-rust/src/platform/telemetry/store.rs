//! The four telemetry files under `<data dir>/desktop-telemetry`
//! (`electron/main/telemetry/infrastructure/*`): each is an atomic JSON
//! document that normalizes whatever it reads, so a damaged or foreign file
//! falls back to its default instead of failing the app.
use super::contract::{self, Event, Level, NOTICE_VERSION};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use std::{
    io::{self, Write as _},
    path::{Path, PathBuf},
};

pub const PREFERENCES: &str = "preferences-v1.json";
pub const IDENTITY: &str = "identity-v1.json";
pub const LIFECYCLE: &str = "lifecycle-v1.json";
pub const QUEUE: &str = "queue-v1.json";
/// The queue keeps at most this many events.
pub const MAX_QUEUED: usize = 32;

/// `createAtomicJsonFile`.
#[derive(Clone, Debug)]
pub struct JsonFile {
    path: PathBuf,
}
impl JsonFile {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
    /// The document, or `None` when it is missing or not JSON.
    pub fn read(&self) -> io::Result<Option<Value>> {
        match std::fs::read(&self.path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes).ok()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }
    /// Two-space JSON and a newline, written to a private temp file (0600)
    /// in a private directory (0700) and renamed into place.
    pub fn write(&self, value: &impl Serialize) -> io::Result<()> {
        let dir = self.path.parent().unwrap_or(Path::new("."));
        create_private_dir(dir)?;
        let mut payload = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
        payload.push(b'\n');
        let millis = chrono::Utc::now().timestamp_millis();
        let temp = PathBuf::from(format!(
            "{}.{}.{millis}.tmp",
            self.path.display(),
            std::process::id()
        ));
        let result = (|| {
            let mut file = private_file(&temp)?;
            file.write_all(&payload)?;
            file.sync_all()?;
            std::fs::rename(&temp, &self.path)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        result
    }
    pub fn remove(&self) -> io::Result<()> {
        match std::fs::remove_file(&self.path) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    }
    pub fn exists(&self) -> bool {
        self.path.is_file()
    }
}

fn create_private_dir(dir: &Path) -> io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(dir)
}
fn private_file(path: &Path) -> io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)
}

/// `telemetry-preference-store`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Preference {
    pub version: u32,
    pub level: Level,
    pub notice_seen_version: u32,
    pub updated_at: Option<String>,
}
impl Preference {
    /// `createDefaultTelemetryPreference`.
    pub fn default_for(level: Level) -> Self {
        Self {
            version: 1,
            level,
            notice_seen_version: 0,
            updated_at: None,
        }
    }
    /// `normalizePreference`.
    pub fn normalize(value: Option<&Value>, default_level: Level) -> Self {
        let fallback = Self::default_for(default_level);
        let Some(value) = value.filter(|v| v.get("version").and_then(Value::as_u64) == Some(1))
        else {
            return fallback;
        };
        let level = value
            .get("level")
            .and_then(|l| serde_json::from_value(l.clone()).ok())
            .unwrap_or(default_level);
        let notice_seen_version = value
            .get("notice_seen_version")
            .and_then(Value::as_u64)
            .filter(|v| *v <= u64::from(NOTICE_VERSION))
            .map_or(0, |v| v as u32);
        let updated_at = value
            .get("updated_at")
            .and_then(Value::as_str)
            .and_then(iso_instant);
        Self {
            version: 1,
            level,
            notice_seen_version,
            updated_at,
        }
    }
}

/// `new Date(value).toISOString()` for an RFC 3339 instant.
pub fn iso_instant(value: &str) -> Option<String> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|d| iso(d.with_timezone(&chrono::Utc)))
}
pub fn iso(instant: chrono::DateTime<chrono::Utc>) -> String {
    instant.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// `telemetry-lifecycle-store`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Lifecycle {
    pub version: u32,
    /// "fresh" (counted for first-run cohorts) or "baseline".
    pub cohort_status: Cohort,
    pub first_run_utc_day: Option<String>,
    pub first_run_enqueued: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Cohort {
    Fresh,
    Baseline,
}
impl Lifecycle {
    /// `createInitialTelemetryLifecycle`.
    pub fn initial(fresh: bool) -> Self {
        Self {
            version: 1,
            cohort_status: if fresh {
                Cohort::Fresh
            } else {
                Cohort::Baseline
            },
            first_run_utc_day: None,
            first_run_enqueued: !fresh,
        }
    }
    /// `neutralizeTelemetryLifecycle`: a baseline that remembers no day.
    pub fn neutral() -> Self {
        Self::initial(false)
    }
    /// `normalizeLifecycle` / `requireLifecycle`.
    pub fn normalize(value: Option<&Value>) -> Option<Self> {
        let value = value?;
        if value.get("version").and_then(Value::as_u64) != Some(1) {
            return None;
        }
        let cohort: Cohort = serde_json::from_value(value.get("cohort_status")?.clone()).ok()?;
        let fresh = cohort == Cohort::Fresh;
        let enqueued = value.get("first_run_enqueued") == Some(&Value::Bool(true));
        if !fresh && !enqueued {
            return None;
        }
        let first_run_utc_day = if fresh && enqueued {
            let day = value.get("first_run_utc_day").and_then(Value::as_str)?;
            Some(contract::utc_day(day).then(|| day.to_string())?)
        } else {
            None
        };
        Some(Self {
            version: 1,
            cohort_status: cohort,
            first_run_utc_day,
            first_run_enqueued: enqueued,
        })
    }
}

/// `telemetry-queue-store`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Queue {
    pub version: u32,
    pub last_enqueued_utc_day: Option<String>,
    pub events: Vec<Event>,
}
impl Queue {
    /// `createEmptyTelemetryQueue`.
    pub fn empty() -> Self {
        Self {
            version: 1,
            last_enqueued_utc_day: None,
            events: Vec::new(),
        }
    }
    /// `normalizeQueue`: only valid events, the newest 32.
    pub fn normalize(value: Option<&Value>) -> Self {
        let Some(value) = value.filter(|v| v.get("version").and_then(Value::as_u64) == Some(1))
        else {
            return Self::empty();
        };
        let mut events: Vec<Event> = value
            .get("events")
            .and_then(Value::as_array)
            .map(|events| {
                events
                    .iter()
                    .filter(|e| contract::is_event(e))
                    .filter_map(|e| serde_json::from_value(e.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        keep_newest(&mut events);
        let last_enqueued_utc_day = value
            .get("last_enqueued_utc_day")
            .and_then(Value::as_str)
            .filter(|d| contract::day_shape(d))
            .map(str::to_string);
        Self {
            version: 1,
            last_enqueued_utc_day,
            events,
        }
    }
}
pub fn keep_newest(events: &mut Vec<Event>) {
    if events.len() > MAX_QUEUED {
        events.drain(..events.len() - MAX_QUEUED);
    }
}

/// `telemetry-identity-store`: a random local secret from which the monthly
/// activity ID and the cohort retention ID are derived (HMAC-SHA256), so
/// neither can be linked to the other or across months without it.
pub struct IdentityStore {
    file: JsonFile,
    secret: Option<String>,
    random: Box<dyn Fn() -> [u8; 32] + Send + Sync>,
}
impl IdentityStore {
    pub fn new(path: PathBuf, random: Box<dyn Fn() -> [u8; 32] + Send + Sync>) -> Self {
        Self {
            file: JsonFile::new(path),
            secret: None,
            random,
        }
    }
    fn stored(&mut self) -> io::Result<Option<String>> {
        if let Some(secret) = &self.secret {
            return Ok(Some(secret.clone()));
        }
        let value = self.file.read()?;
        let secret = value
            .filter(|v| v.get("version").and_then(Value::as_u64) == Some(1))
            .and_then(|v| v.get("secret").and_then(Value::as_str).map(str::to_string))
            .filter(|s| {
                s.len() == 43
                    && s.bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            });
        self.secret.clone_from(&secret);
        Ok(secret)
    }
    pub fn has_stored_identity(&mut self) -> io::Result<bool> {
        Ok(self.stored()?.is_some())
    }
    fn secret(&mut self) -> io::Result<String> {
        if let Some(secret) = self.stored()? {
            return Ok(secret);
        }
        let secret = URL_SAFE_NO_PAD.encode((self.random)());
        self.file
            .write(&serde_json::json!({"version": 1, "secret": secret}))?;
        self.secret = Some(secret.clone());
        Ok(secret)
    }
    fn derive(&mut self, prefix: &str, scope: &str) -> io::Result<String> {
        let secret = self.secret()?;
        let key = URL_SAFE_NO_PAD
            .decode(secret.as_bytes())
            .map_err(io::Error::other)?;
        let mut mac = Hmac::<Sha256>::new_from_slice(&key).map_err(io::Error::other)?;
        mac.update(scope.as_bytes());
        Ok(format!(
            "{prefix}_{}",
            URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
        ))
    }
    /// Stable within a calendar month (UTC), unlinkable across months.
    pub fn monthly_anonymous_id(
        &mut self,
        now: chrono::DateTime<chrono::Utc>,
    ) -> io::Result<String> {
        let period = now.format("%Y-%m").to_string();
        self.derive("m1", &format!("puppyone-desktop-telemetry:{period}"))
    }
    pub fn retention_anonymous_id(&mut self) -> io::Result<String> {
        self.derive("r1", "puppyone-desktop-retention:v1")
    }
    pub fn clear(&mut self) -> io::Result<()> {
        self.secret = None;
        self.file.remove()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    fn at(value: &str) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    #[test]
    fn the_rotating_identity_is_stable_within_a_month_and_unlinkable_across_months() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("telemetry").join(IDENTITY);
        let mut store = IdentityStore::new(path.clone(), Box::new(|| [7; 32]));
        assert!(!store.has_stored_identity().unwrap());
        let august = store
            .monthly_anonymous_id(at("2026-08-01T00:00:00Z"))
            .unwrap();
        let late_august = store
            .monthly_anonymous_id(at("2026-08-31T23:59:59Z"))
            .unwrap();
        let september = store
            .monthly_anonymous_id(at("2026-09-01T00:00:00Z"))
            .unwrap();
        let retention = store.retention_anonymous_id().unwrap();
        assert_eq!(august, late_august);
        assert_ne!(august, september);
        for id in [&august, &september] {
            assert!(id.starts_with("m1_") && id.len() == 46, "{id}");
        }
        assert!(retention.starts_with("r1_") && !retention.contains(&august[3..]));
        // HMAC-SHA256 over the scope, keyed by the decoded secret.
        let mut mac = Hmac::<Sha256>::new_from_slice(&[7; 32]).unwrap();
        mac.update(b"puppyone-desktop-telemetry:2026-08");
        assert_eq!(
            august,
            format!("m1_{}", URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
        );
        // Persisted privately, read back by a new store.
        let stored: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(stored["version"], 1);
        assert_eq!(stored["secret"].as_str().unwrap().len(), 43);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&path), 0o600);
            assert_eq!(mode(path.parent().unwrap()), 0o700);
        }
        let mut reopened = IdentityStore::new(path.clone(), Box::new(|| [9; 32]));
        assert!(reopened.has_stored_identity().unwrap());
        assert_eq!(
            reopened
                .monthly_anonymous_id(at("2026-08-15T00:00:00Z"))
                .unwrap(),
            august
        );
        // Reset deletes the secret; the next ID is a new identity.
        reopened.clear().unwrap();
        assert!(!path.exists());
        assert!(!reopened.has_stored_identity().unwrap());
        assert_ne!(
            reopened
                .monthly_anonymous_id(at("2026-08-15T00:00:00Z"))
                .unwrap(),
            august
        );
    }

    #[test]
    fn documents_normalize_instead_of_failing() {
        let level = Level::Basic;
        assert_eq!(
            Preference::normalize(None, level),
            Preference::default_for(level)
        );
        let stored = json!({"version": 1, "level": "off", "notice_seen_version": 9, "updated_at": "2026-08-27T07:00:00+02:00"});
        assert_eq!(
            Preference::normalize(Some(&stored), level),
            Preference {
                version: 1,
                level: Level::Off,
                notice_seen_version: 0,
                updated_at: Some("2026-08-27T05:00:00.000Z".into()),
            }
        );
        let odd = json!({"version": 1, "level": "verbose", "notice_seen_version": 2, "updated_at": "yesterday"});
        let odd = Preference::normalize(Some(&odd), level);
        assert_eq!(
            (odd.level, odd.notice_seen_version, odd.updated_at),
            (level, 2, None)
        );

        // A fresh cohort keeps its first day only once the event is queued.
        let fresh = json!({"version": 1, "cohort_status": "fresh", "first_run_utc_day": "2026-08-27", "first_run_enqueued": true});
        assert_eq!(
            Lifecycle::normalize(Some(&fresh))
                .unwrap()
                .first_run_utc_day
                .as_deref(),
            Some("2026-08-27")
        );
        let pending = json!({"version": 1, "cohort_status": "fresh", "first_run_utc_day": "2026-08-27", "first_run_enqueued": false});
        assert_eq!(
            Lifecycle::normalize(Some(&pending)),
            Some(Lifecycle::initial(true))
        );
        let contradictory =
            json!({"version": 1, "cohort_status": "baseline", "first_run_enqueued": false});
        assert_eq!(Lifecycle::normalize(Some(&contradictory)), None);
        let neutral = Lifecycle::neutral();
        assert_eq!(
            (
                neutral.cohort_status,
                neutral.first_run_utc_day,
                neutral.first_run_enqueued
            ),
            (Cohort::Baseline, None, true)
        );

        let event = contract::daily_active(&contract::EventInput {
            activity_day: "2026-08-27",
            anonymous_id: "m1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            app_version: "0.4.0",
            architecture: "arm64",
            event_id: "123e4567-e89b-42d3-a456-426614174000",
            os_major: "15",
            platform: "darwin",
            retention_id: None,
        })
        .unwrap();
        let mut events: Vec<Value> = (0..40)
            .map(|_| serde_json::to_value(&event).unwrap())
            .collect();
        events.push(json!({"event": "desktop_daily_active", "workspace": "/x"}));
        let queue = Queue::normalize(Some(
            &json!({"version": 1, "last_enqueued_utc_day": "2026-08-27T07:00", "events": events}),
        ));
        assert_eq!(
            (queue.events.len(), queue.last_enqueued_utc_day),
            (MAX_QUEUED, None)
        );
        assert_eq!(
            Queue::normalize(Some(&json!({"version": 2}))),
            Queue::empty()
        );
    }

    #[test]
    fn a_missing_or_damaged_file_reads_as_absent_and_writes_replace_it_whole() {
        let dir = tempfile::tempdir().unwrap();
        let file = JsonFile::new(dir.path().join("x").join(QUEUE));
        assert_eq!(file.read().unwrap(), None);
        file.write(&Queue::empty()).unwrap();
        let text = std::fs::read_to_string(dir.path().join("x").join(QUEUE)).unwrap();
        assert_eq!(
            text,
            "{\n  \"version\": 1,\n  \"last_enqueued_utc_day\": null,\n  \"events\": []\n}\n"
        );
        std::fs::write(dir.path().join("x").join(QUEUE), "{not json").unwrap();
        assert_eq!(file.read().unwrap(), None);
        file.remove().unwrap();
        file.remove().unwrap();
        assert!(!file.exists());
        // No temp files are left behind.
        assert_eq!(std::fs::read_dir(dir.path().join("x")).unwrap().count(), 0);
    }
}
