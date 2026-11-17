//! Port of `application/agent-activity-service.mjs`: a started tool call
//! with exact in-workspace targets becomes a claim; its finish, its
//! provider session's end, its terminal's close or a two-minute lease ends
//! it. Each window holds at most 256 claims; the oldest gives way.
use super::{
    Phase, PublicEvent, PublicTarget, adapters::SourceEvent, limits, now_millis, path_policy,
};
use std::{
    collections::HashMap,
    path::PathBuf,
    time::{Duration, Instant},
};

/// `ActivitySession`: a prepared terminal, its provider (`*` for a shell,
/// which may run any Agent) and its owner window.
#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    pub provider_id: String,
    pub root: PathBuf,
    pub owner: String,
}
struct Claim {
    activity_id: String,
    correlation: String,
    event: SourceEvent,
    terminal_session_id: String,
    owner: String,
    root: PathBuf,
    targets: Vec<PublicTarget>,
    deadline: Instant,
}
pub type Publish = Box<dyn FnMut(&str, PublicEvent) + Send>;
pub struct Service {
    sessions: HashMap<String, Session>,
    claims: HashMap<String, Claim>,
    by_correlation: HashMap<String, String>,
    publish: Publish,
    lease: Duration,
}
impl Service {
    pub fn new(publish: Publish) -> Self {
        Self {
            sessions: HashMap::new(),
            claims: HashMap::new(),
            by_correlation: HashMap::new(),
            publish,
            lease: limits::ACTIVE_CLAIM_LEASE,
        }
    }
    #[cfg(test)]
    fn with_lease(mut self, lease: Duration) -> Self {
        self.lease = lease;
        self
    }
    pub fn register(&mut self, terminal_session_id: &str, session: Session) {
        self.close_terminal_session(terminal_session_id);
        self.sessions.insert(terminal_session_id.into(), session);
    }
    pub fn session(&self, terminal_session_id: &str) -> Option<&Session> {
        self.sessions.get(terminal_session_id)
    }
    /// Resolves `event`'s targets against its session without holding any
    /// lock: path canonicalisation touches the file system.
    pub fn resolve_targets(event: &SourceEvent, session: &Session) -> Vec<PublicTarget> {
        let mut seen = std::collections::HashSet::new();
        event
            .targets
            .iter()
            .filter_map(|t| path_policy::resolve(&t.path, t.access, &event.cwd, &session.root))
            .filter(|t| seen.insert(t.clone()))
            .collect()
    }
    /// `ingest` with targets already resolved (`resolve_targets`). `false`
    /// when the session is unknown or belongs to another provider.
    pub fn ingest(&mut self, event: SourceEvent, targets: Vec<PublicTarget>) -> bool {
        let Some(session) = self.sessions.get(&event.terminal_session_id).cloned() else {
            return false;
        };
        if session.provider_id != "*" && session.provider_id != event.provider_id {
            return false;
        }
        let correlation = correlation(&event);
        if event.phase == Phase::Started {
            if targets.is_empty() {
                return true;
            }
            let deadline = Instant::now() + self.lease;
            if let Some(id) = self.by_correlation.get(&correlation).cloned()
                && let Some(claim) = self.claims.get_mut(&id)
            {
                let occurred = event.occurred_at;
                claim.event = event;
                claim.targets = targets;
                claim.deadline = deadline;
                self.publish_claim(&id, Phase::Started, occurred);
                return true;
            }
            self.enforce_window_bound(&session.owner);
            let activity_id = uuid::Uuid::new_v4().to_string();
            let occurred = event.occurred_at;
            self.by_correlation
                .insert(correlation.clone(), activity_id.clone());
            self.claims.insert(
                activity_id.clone(),
                Claim {
                    activity_id: activity_id.clone(),
                    correlation,
                    terminal_session_id: event.terminal_session_id.clone(),
                    event,
                    owner: session.owner,
                    root: session.root,
                    targets,
                    deadline,
                },
            );
            self.publish_claim(&activity_id, Phase::Started, occurred);
            return true;
        }
        let Some(id) = self.by_correlation.get(&correlation).cloned() else {
            return true;
        };
        if self.claims.get(&id).map(|c| c.terminal_session_id.as_str())
            != Some(event.terminal_session_id.as_str())
        {
            return true;
        }
        if let Some(claim) = self.remove(&id) {
            self.emit(&claim, event.phase, event.occurred_at);
        }
        true
    }
    pub fn close_terminal_session(&mut self, terminal_session_id: &str) -> bool {
        if self.sessions.remove(terminal_session_id).is_none() {
            return false;
        }
        self.cancel_where(|c| c.terminal_session_id == terminal_session_id);
        true
    }
    pub fn close_source_session(&mut self, terminal_session_id: &str, source: Option<&str>) {
        self.cancel_where(|c| {
            c.terminal_session_id == terminal_session_id
                && c.event.source_session_id.as_deref() == source
        });
    }
    /// Ends claims whose lease ran out.
    pub fn expire(&mut self, now: Instant) {
        self.cancel_where(|c| c.deadline <= now);
    }
    /// `getSnapshotForWindow`: the window's open claims as started events.
    #[cfg(test)]
    pub fn snapshot(&self, owner: &str) -> Vec<PublicEvent> {
        let mut claims: Vec<&Claim> = self.claims.values().filter(|c| c.owner == owner).collect();
        claims.sort_by_key(|c| c.event.occurred_at);
        claims
            .into_iter()
            .map(|c| public(c, Phase::Started, c.event.occurred_at))
            .collect()
    }
    #[cfg(test)]
    pub fn claim_count(&self) -> usize {
        self.claims.len()
    }
    fn cancel_where(&mut self, matches: impl Fn(&Claim) -> bool) {
        let mut ids: Vec<(u64, String)> = self
            .claims
            .values()
            .filter(|c| matches(c))
            .map(|c| (c.event.occurred_at, c.activity_id.clone()))
            .collect();
        ids.sort();
        let now = now_millis();
        for (_, id) in ids {
            if let Some(claim) = self.remove(&id) {
                self.emit(&claim, Phase::Cancelled, now);
            }
        }
    }
    fn enforce_window_bound(&mut self, owner: &str) {
        let owned: Vec<(u64, String)> = self
            .claims
            .values()
            .filter(|c| c.owner == owner)
            .map(|c| (c.event.occurred_at, c.activity_id.clone()))
            .collect();
        if owned.len() < limits::ACTIVE_CLAIMS_PER_WINDOW {
            return;
        }
        if let Some((_, oldest)) = owned.into_iter().min()
            && let Some(claim) = self.remove(&oldest)
        {
            self.emit(&claim, Phase::Cancelled, now_millis());
        }
    }
    fn remove(&mut self, id: &str) -> Option<Claim> {
        let claim = self.claims.remove(id)?;
        self.by_correlation.remove(&claim.correlation);
        Some(claim)
    }
    fn publish_claim(&mut self, id: &str, phase: Phase, occurred_at: u64) {
        if let Some(claim) = self.claims.get(id) {
            let event = public(claim, phase, occurred_at);
            (self.publish)(&claim.owner.clone(), event);
        }
    }
    fn emit(&mut self, claim: &Claim, phase: Phase, occurred_at: u64) {
        (self.publish)(&claim.owner, public(claim, phase, occurred_at));
    }
}
fn public(claim: &Claim, phase: Phase, occurred_at: u64) -> PublicEvent {
    PublicEvent {
        activity_id: claim.activity_id.clone(),
        provider_id: claim.event.provider_id.clone(),
        terminal_session_id: claim.event.terminal_session_id.clone(),
        phase,
        operation: claim.event.operation,
        targets: claim.targets.clone(),
        occurred_at,
        root: claim.root.clone(),
    }
}
/// `createCorrelationKey`.
fn correlation(event: &SourceEvent) -> String {
    [
        event.terminal_session_id.as_str(),
        event.provider_id.as_str(),
        event.source_session_id.as_deref().unwrap_or(""),
        event.native_tool_call_id.as_str(),
    ]
    .join("\0")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::agent_activity::{Access, Operation, adapters::SourceTarget};
    use core::prelude::v1::test;
    use std::sync::{Arc, Mutex};
    type Log = Arc<Mutex<Vec<(String, PublicEvent)>>>;
    fn service() -> (Service, Log) {
        let log: Log = Arc::default();
        let sink = log.clone();
        let service = Service::new(Box::new(move |owner, event| {
            sink.lock().unwrap().push((owner.into(), event))
        }));
        (service, log)
    }
    fn event(session: &str, call: &str, phase: Phase, path: &str) -> SourceEvent {
        SourceEvent {
            provider_id: "codex".into(),
            terminal_session_id: session.into(),
            source_session_id: Some("src".into()),
            native_turn_id: None,
            native_tool_call_id: call.into(),
            native_tool_name: "Edit".into(),
            phase,
            operation: Operation::Write,
            cwd: "/".into(),
            targets: vec![SourceTarget {
                path: path.into(),
                access: Access::Write,
            }],
            occurred_at: 10,
        }
    }
    fn target(path: &str) -> Vec<PublicTarget> {
        vec![PublicTarget {
            relative: path.into(),
            access: Access::Write,
        }]
    }
    fn session(provider: &str) -> Session {
        Session {
            provider_id: provider.into(),
            root: "/repo".into(),
            owner: "window:1".into(),
        }
    }
    #[test]
    fn a_tool_call_claims_its_files_until_it_finishes() {
        let (mut s, log) = service();
        s.register("t1", session("codex"));
        assert!(s.ingest(event("t1", "c1", Phase::Started, "a"), target("a")));
        // The same call again refreshes the claim instead of adding one.
        assert!(s.ingest(event("t1", "c1", Phase::Started, "a"), target("a")));
        assert_eq!(s.claim_count(), 1);
        assert_eq!(s.snapshot("window:1").len(), 1);
        assert!(s.snapshot("window:2").is_empty());
        assert!(s.ingest(event("t1", "c1", Phase::Completed, "a"), vec![]));
        assert_eq!(s.claim_count(), 0);
        let log = log.lock().unwrap();
        let phases: Vec<Phase> = log.iter().map(|(_, e)| e.phase).collect();
        assert_eq!(phases, [Phase::Started, Phase::Started, Phase::Completed]);
        assert!(
            log.iter()
                .all(|(owner, e)| owner == "window:1" && e.activity_id == log[0].1.activity_id)
        );
        assert_eq!(log[0].1.root, PathBuf::from("/repo"));
    }
    #[test]
    fn foreign_providers_unknown_sessions_and_empty_targets_claim_nothing() {
        let (mut s, log) = service();
        s.register("t1", session("claude"));
        assert!(!s.ingest(event("t1", "c1", Phase::Started, "a"), target("a")));
        assert!(!s.ingest(event("t2", "c1", Phase::Started, "a"), target("a")));
        s.register("shell", session("*"));
        assert!(s.ingest(event("shell", "c1", Phase::Started, "a"), vec![]));
        assert!(log.lock().unwrap().is_empty());
        // A shell session accepts every provider.
        assert!(s.ingest(event("shell", "c1", Phase::Started, "a"), target("a")));
        assert_eq!(s.claim_count(), 1);
    }
    #[test]
    fn closing_ending_and_expiry_cancel_claims() {
        let (mut s, log) = service();
        s.register("t1", session("codex"));
        s.ingest(event("t1", "c1", Phase::Started, "a"), target("a"));
        s.ingest(event("t1", "c2", Phase::Started, "b"), target("b"));
        s.close_source_session("t1", Some("other"));
        assert_eq!(s.claim_count(), 2);
        s.close_source_session("t1", Some("src"));
        assert_eq!(s.claim_count(), 0);
        s.ingest(event("t1", "c3", Phase::Started, "c"), target("c"));
        assert!(s.close_terminal_session("t1"));
        assert!(!s.close_terminal_session("t1"));
        assert_eq!(s.claim_count(), 0);
        let (s2, _) = service();
        let mut s2 = s2.with_lease(Duration::ZERO);
        s2.register("t1", session("codex"));
        s2.ingest(event("t1", "c1", Phase::Started, "a"), target("a"));
        s2.expire(Instant::now());
        assert_eq!(s2.claim_count(), 0);
        let cancelled = log
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, e)| e.phase == Phase::Cancelled)
            .count();
        assert_eq!(cancelled, 3);
    }
    #[test]
    fn a_window_keeps_at_most_its_bound_of_claims() {
        let (mut s, log) = service();
        s.register("t1", session("codex"));
        for i in 0..=limits::ACTIVE_CLAIMS_PER_WINDOW {
            let mut e = event("t1", &format!("c{i}"), Phase::Started, "a");
            e.occurred_at = i as u64;
            s.ingest(e, target("a"));
        }
        assert_eq!(s.claim_count(), limits::ACTIVE_CLAIMS_PER_WINDOW);
        let log = log.lock().unwrap();
        let cancelled: Vec<_> = log
            .iter()
            .filter(|(_, e)| e.phase == Phase::Cancelled)
            .collect();
        assert_eq!(cancelled.len(), 1);
        assert_eq!(cancelled[0].1.activity_id, log[0].1.activity_id);
    }
}
