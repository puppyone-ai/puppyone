//! Port of `ConversationHistoryController` + `useAgentConversationHistory`:
//! one locator-only listing per chat-capable runtime, merged newest first.
//! Listings never create or resume a conversation; opening one belongs to
//! the workbench, which starts a real chat for the chosen locator.
use crate::agent::{
    connections::local_agent_inventory::Installation,
    domain::agent_session_model::{HistoryEntry, State},
    runtime::agent_runtime_port::AgentRuntimePort,
};
use crate::wake::Wake;
use std::path::PathBuf;

/// `AgentSessionDiscoveryStatus` as the browser needs it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SourceStatus {
    Loading,
    Complete,
    /// More pages exist (`nextCursor`).
    Partial,
    Unsupported,
    Failed,
}

/// One merged row (`AgentSessionListItem`).
#[derive(Clone, Debug, PartialEq)]
pub struct HistorySession {
    pub installation: usize,
    pub id: String,
    pub title: String,
    pub updated_at: Option<i64>,
}

pub type ListingFactory = fn(Installation, PathBuf, Wake) -> Box<dyn AgentRuntimePort>;

struct Source {
    installation: Installation,
    port: Option<Box<dyn AgentRuntimePort>>,
    /// `history_listed` value a pending request is waiting to exceed.
    awaited: u64,
    requested: bool,
    /// Fixture listings (dev-capture) report a status without a port.
    fixture: Option<(SourceStatus, Vec<HistoryEntry>)>,
}

pub struct ConversationHistory {
    root: PathBuf,
    wake: Wake,
    factory: ListingFactory,
    sources: Vec<Source>,
    /// Sessions already open in a tab (`excludedResourceIds`).
    excluded: Vec<String>,
    refreshing: bool,
    loading_more: bool,
}

impl ConversationHistory {
    pub fn new(
        installations: Vec<Installation>,
        root: PathBuf,
        wake: Wake,
        factory: ListingFactory,
    ) -> Self {
        let mut history = Self {
            root,
            wake,
            factory,
            sources: installations
                .into_iter()
                .map(|installation| Source {
                    installation,
                    port: None,
                    awaited: 0,
                    requested: false,
                    fixture: None,
                })
                .collect(),
            excluded: vec![],
            refreshing: false,
            loading_more: false,
        };
        history.start();
        history
    }
    /// Dev-capture: fixed listings, no providers.
    #[cfg(feature = "dev-capture")]
    pub fn fixture(rows: Vec<(Installation, SourceStatus, Vec<HistoryEntry>)>) -> Self {
        Self {
            root: PathBuf::new(),
            wake: Wake::channel().0,
            factory: |_, _, _| unreachable!("fixture listings have no provider"),
            sources: rows
                .into_iter()
                .map(|(installation, status, entries)| Source {
                    installation,
                    port: None,
                    awaited: 0,
                    requested: true,
                    fixture: Some((status, entries)),
                })
                .collect(),
            excluded: vec![],
            refreshing: false,
            loading_more: false,
        }
    }
    fn start(&mut self) {
        for source in &mut self.sources {
            if source.fixture.is_none() {
                source.port = Some((self.factory)(
                    source.installation.clone(),
                    self.root.clone(),
                    self.wake.clone(),
                ));
                source.awaited = 0;
                source.requested = false;
            }
        }
    }
    pub fn set_excluded(&mut self, ids: Vec<String>) {
        self.excluded = ids;
    }
    pub fn installation(&self, index: usize) -> Option<&Installation> {
        self.sources.get(index).map(|s| &s.installation)
    }
    pub fn installations(&self) -> impl Iterator<Item = &Installation> {
        self.sources.iter().map(|s| &s.installation)
    }
    /// Drive every listing; a ready provider that did not list on its own is
    /// asked once (`listSessions`).
    pub fn poll(&mut self) {
        for source in &mut self.sources {
            let Some(port) = source.port.as_mut() else {
                continue;
            };
            port.poll();
            let snapshot = port.snapshot();
            if !source.requested
                && snapshot.history_listed == 0
                && snapshot.capabilities.history
                && !matches!(snapshot.state, State::Starting | State::Failed)
            {
                source.requested = true;
                port.list_history();
            }
        }
        if self.refreshing
            && self
                .sources
                .iter()
                .all(|s| s.status() != SourceStatus::Loading)
        {
            self.refreshing = false;
        }
        if self.loading_more && self.sources.iter().all(|s| !s.awaiting()) {
            self.loading_more = false;
        }
    }
    /// `refreshNative`: restart every listing from its first page.
    pub fn refresh(&mut self) {
        self.refreshing = true;
        self.start();
    }
    /// `loadMoreNative`: the next page of every source that has one.
    pub fn load_more(&mut self) {
        for source in &mut self.sources {
            if source.status() == SourceStatus::Partial
                && let Some(port) = source.port.as_mut()
            {
                source.awaited = port.snapshot().history_listed;
                port.list_history();
                self.loading_more = true;
            }
        }
    }
    pub fn statuses(&self) -> Vec<(usize, SourceStatus)> {
        self.sources
            .iter()
            .enumerate()
            .map(|(i, s)| (i, s.status()))
            .collect()
    }
    fn all_sessions(&self) -> Vec<HistorySession> {
        let mut rows: Vec<HistorySession> = self
            .sources
            .iter()
            .enumerate()
            .flat_map(|(index, source)| {
                source.entries().iter().map(move |entry| HistorySession {
                    installation: index,
                    id: entry.id.clone(),
                    title: entry.title.clone(),
                    updated_at: entry.updated_at,
                })
            })
            .collect();
        // Newest first; unknown times keep their provider order at the end.
        rows.sort_by_key(|row| std::cmp::Reverse(row.updated_at.unwrap_or(i64::MIN)));
        rows
    }
    pub fn sessions(&self) -> Vec<HistorySession> {
        self.all_sessions()
            .into_iter()
            .filter(|row| !self.excluded.contains(&row.id))
            .collect()
    }
    pub fn excluded_count(&self) -> usize {
        self.all_sessions()
            .iter()
            .filter(|row| self.excluded.contains(&row.id))
            .count()
    }
    pub fn loading(&self) -> bool {
        self.sources
            .iter()
            .any(|s| s.status() == SourceStatus::Loading)
    }
    pub fn refreshing(&self) -> bool {
        self.refreshing
    }
    pub fn loading_more(&self) -> bool {
        self.loading_more
    }
    pub fn has_more(&self) -> bool {
        self.sources
            .iter()
            .any(|s| s.status() == SourceStatus::Partial)
    }
    pub fn source_failed(&self) -> bool {
        self.sources
            .iter()
            .any(|s| s.status() == SourceStatus::Failed)
    }
    /// Every source listed to its end (`coverage === "complete"`).
    pub fn complete(&self) -> bool {
        !self.sources.is_empty()
            && self
                .sources
                .iter()
                .all(|s| s.status() == SourceStatus::Complete)
    }
}

impl Source {
    fn entries(&self) -> &[HistoryEntry] {
        if let Some((_, entries)) = &self.fixture {
            return entries;
        }
        self.port
            .as_ref()
            .map_or(&[], |p| p.snapshot().history.as_slice())
    }
    fn awaiting(&self) -> bool {
        self.port.as_ref().is_some_and(|p| {
            p.snapshot().history_listed <= self.awaited && p.snapshot().state != State::Failed
        })
    }
    fn status(&self) -> SourceStatus {
        if let Some((status, _)) = &self.fixture {
            return *status;
        }
        let Some(port) = self.port.as_ref() else {
            return SourceStatus::Loading;
        };
        let snapshot = port.snapshot();
        if snapshot.state == State::Failed {
            return SourceStatus::Failed;
        }
        if snapshot.history_listed == 0 {
            if snapshot.state != State::Starting && !snapshot.capabilities.history {
                return SourceStatus::Unsupported;
            }
            return SourceStatus::Loading;
        }
        if snapshot.error.is_some() && snapshot.history.is_empty() {
            return SourceStatus::Failed;
        }
        if snapshot.cursor.is_some() {
            SourceStatus::Partial
        } else {
            SourceStatus::Complete
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{
        domain::agent_session_model::SessionSnapshot, runtime::agent_runtime_registry::Runtime,
    };
    use core::prelude::v1::test;
    use serde_json::Value;

    /// A provider that lists `pages` one per request.
    struct Fake {
        snapshot: SessionSnapshot,
        pages: Vec<Vec<HistoryEntry>>,
    }
    impl AgentRuntimePort for Fake {
        fn snapshot(&self) -> &SessionSnapshot {
            &self.snapshot
        }
        fn poll(&mut self) {
            if self.snapshot.state == State::Starting {
                self.snapshot.state = State::Idle;
                self.snapshot.capabilities.history = true;
            }
        }
        fn send(&mut self, _: String) {}
        fn stop(&mut self) {}
        fn resume(&mut self, _: String) {}
        fn list_history(&mut self) {
            if !self.pages.is_empty() {
                self.snapshot.history.extend(self.pages.remove(0));
            }
            self.snapshot.cursor = (!self.pages.is_empty()).then(|| "next".into());
            self.snapshot.history_listed += 1;
        }
        fn new_thread(&mut self) {}
        fn resolve(&mut self, _: &Value, _: crate::agent::domain::agent_session_model::Resolution) {
        }
        fn select_model(&mut self, _: Option<String>) {}
    }
    fn entry(id: &str, at: i64) -> HistoryEntry {
        HistoryEntry {
            id: id.into(),
            title: id.into(),
            updated_at: Some(at),
        }
    }
    fn installation(runtime: Runtime) -> Installation {
        Installation {
            runtime,
            id: "fake",
            label: format!("{runtime:?}"),
            executable: PathBuf::new(),
            chat: true,
        }
    }
    fn factory(installation: Installation, _: PathBuf, _: Wake) -> Box<dyn AgentRuntimePort> {
        let pages = match installation.runtime {
            Runtime::Codex => vec![vec![entry("c1", 30), entry("c2", 10)], vec![entry("c3", 5)]],
            _ => vec![vec![entry("p1", 20)]],
        };
        Box::new(Fake {
            snapshot: SessionSnapshot::new("fake", true),
            pages,
        })
    }

    #[test]
    fn listings_merge_newest_first_and_page_on_demand() {
        let mut history = ConversationHistory::new(
            vec![installation(Runtime::Codex), installation(Runtime::Pi)],
            PathBuf::from("/project"),
            Wake::channel().0,
            factory,
        );
        assert!(history.loading());
        history.poll();
        assert!(!history.loading());
        let ids: Vec<_> = history.sessions().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, ["c1", "p1", "c2"]);
        assert!(history.has_more() && !history.complete());
        history.set_excluded(vec!["p1".into()]);
        assert_eq!(history.excluded_count(), 1);
        history.load_more();
        assert!(!history.has_more() && history.complete());
        assert_eq!(history.sessions().last().map(|s| s.id.as_str()), Some("c3"));
        history.refresh();
        assert!(history.refreshing() && history.loading());
        history.poll();
        assert!(!history.refreshing());
    }
}
