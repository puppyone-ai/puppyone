//! Port of `desktop-agent-presence/agentActivityStore.ts` and
//! `agentActivity.ts`: the file claims of Hooked terminal Agents, kept per
//! owner window and projected onto workspace files. A finished claim
//! lingers for four seconds; a cancelled one disappears at once.
use crate::platform::agent_activity::{COMPLETED_LINGER, Phase, PublicEvent, adapters, host::Host};
use gpui::*;
use std::{
    cell::RefCell,
    collections::HashMap,
    path::{Path, PathBuf},
};

#[derive(Default)]
pub struct AgentPresence {
    activities: HashMap<String, Activity>,
    revision: u64,
    /// Canonical forms of the roots compared so far.
    roots: RefCell<HashMap<PathBuf, PathBuf>>,
}
struct Activity {
    owner: String,
    event: PublicEvent,
    revision: u64,
}
struct Shared(Entity<AgentPresence>);
impl Global for Shared {}

/// Starts reading the activity host for every window of this app.
pub fn init(cx: &mut App) {
    if cx.has_global::<Shared>() {
        return;
    }
    let entity = cx.new(|_| AgentPresence::default());
    cx.set_global(Shared(entity.clone()));
    let events = Host::global().events();
    let weak = entity.downgrade();
    cx.spawn(async move |cx| {
        while let Ok((owner, event)) = events.recv().await {
            if weak
                .update(cx, |store, cx| store.apply(owner, event, cx))
                .is_err()
            {
                break;
            }
        }
    })
    .detach();
}
pub fn store(cx: &App) -> Option<Entity<AgentPresence>> {
    cx.try_global::<Shared>().map(|shared| shared.0.clone())
}
/// The owner a window's terminals register under (also their host budget).
pub fn owner(window: &Window) -> String {
    format!("window:{:?}", window.window_handle().window_id())
}

/// `AgentFilePresenceClaim`.
#[derive(Clone, Debug, PartialEq)]
pub struct Claim {
    pub provider: String,
    pub reading: bool,
    pub active: bool,
    pub occurred_at: u64,
}
/// `AgentFilePresenceProjection`.
#[derive(Clone, Debug, PartialEq)]
pub struct Projection {
    pub primary: Claim,
    pub additional: usize,
}

impl AgentPresence {
    /// `apply`.
    pub fn apply(&mut self, owner: String, event: PublicEvent, cx: &mut Context<Self>) {
        self.revision += 1;
        let id = event.activity_id.clone();
        if event.phase == Phase::Cancelled {
            self.activities.remove(&id);
        } else {
            let lingers = matches!(event.phase, Phase::Completed | Phase::Failed);
            let revision = self.revision;
            self.activities.insert(
                id.clone(),
                Activity {
                    owner,
                    event,
                    revision,
                },
            );
            if lingers {
                cx.spawn(async move |this, cx| {
                    cx.background_executor().timer(COMPLETED_LINGER).await;
                    let _ = this.update(cx, |store, cx| {
                        if store
                            .activities
                            .get(&id)
                            .is_some_and(|a| a.revision == revision)
                        {
                            store.activities.remove(&id);
                            cx.notify();
                        }
                    });
                })
                .detach();
            }
        }
        cx.notify();
    }
    /// `projectFilePresence` for `owner`'s claims on the file at `relative`
    /// in the workspace `root`.
    pub fn projection(&self, owner: &str, root: &Path, relative: &Path) -> Option<Projection> {
        if self.activities.is_empty() {
            return None;
        }
        let relative = relative
            .components()
            .map(|c| c.as_os_str().to_str())
            .collect::<Option<Vec<_>>>()?
            .join("/");
        if relative.is_empty() {
            return None;
        }
        let mut claims: Vec<Claim> = self
            .activities
            .values()
            .filter(|a| a.owner == owner && self.same_root(&a.event.root, root))
            .flat_map(|a| {
                a.event
                    .targets
                    .iter()
                    .filter(|t| t.relative == relative)
                    .map(|_| Claim {
                        provider: adapters::label(&a.event.provider_id).to_owned(),
                        reading: a.event.operation.reading(),
                        active: a.event.phase == Phase::Started,
                        occurred_at: a.event.occurred_at,
                    })
            })
            .collect();
        // `compareClaims`: writing first, then running, then newest.
        claims.sort_by(|a, b| {
            a.reading
                .cmp(&b.reading)
                .then(b.active.cmp(&a.active))
                .then(b.occurred_at.cmp(&a.occurred_at))
        });
        let additional = claims.len().checked_sub(1)?;
        Some(Projection {
            primary: claims.swap_remove(0),
            additional,
        })
    }
    fn same_root(&self, a: &Path, b: &Path) -> bool {
        if a == b {
            return true;
        }
        let mut roots = self.roots.borrow_mut();
        let mut canonical = |p: &Path| {
            roots
                .entry(p.to_path_buf())
                .or_insert_with(|| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()))
                .clone()
        };
        canonical(a) == canonical(b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::agent_activity::{Access, Operation, PublicTarget};
    use core::prelude::v1::test;
    fn event(id: &str, provider: &str, operation: Operation, phase: Phase, at: u64) -> PublicEvent {
        PublicEvent {
            activity_id: id.into(),
            provider_id: provider.into(),
            terminal_session_id: "t".into(),
            phase,
            operation,
            targets: vec![PublicTarget {
                relative: "src/a.rs".into(),
                access: Access::Write,
            }],
            occurred_at: at,
            root: "/repo".into(),
        }
    }
    #[gpui::test]
    fn claims_project_onto_their_window_and_file(cx: &mut TestAppContext) {
        let store = cx.new(|_| AgentPresence::default());
        let file = Path::new("src/a.rs");
        store.update(cx, |s, cx| {
            s.apply(
                "w1".into(),
                event("1", "claude", Operation::Read, Phase::Started, 1),
                cx,
            );
            s.apply(
                "w1".into(),
                event("2", "codex", Operation::Write, Phase::Completed, 2),
                cx,
            );
            s.apply(
                "w2".into(),
                event("3", "pi", Operation::Write, Phase::Started, 3),
                cx,
            );
        });
        store.read_with(cx, |s, _| {
            let p = s.projection("w1", Path::new("/repo"), file).unwrap();
            // Writing outranks a running read.
            assert_eq!(p.primary.provider, "Codex");
            assert!(!p.primary.reading && !p.primary.active);
            assert_eq!(p.additional, 1);
            assert!(s.projection("w1", Path::new("/other"), file).is_none());
            assert!(
                s.projection("w1", Path::new("/repo"), Path::new("src/b.rs"))
                    .is_none()
            );
            assert_eq!(
                s.projection("w2", Path::new("/repo"), file)
                    .unwrap()
                    .primary
                    .provider,
                "Pi Agent"
            );
        });
        // A finished claim lingers, then goes; a cancelled one goes at once.
        cx.executor().advance_clock(COMPLETED_LINGER);
        cx.run_until_parked();
        store.update(cx, |s, cx| {
            assert_eq!(
                s.projection("w1", Path::new("/repo"), file)
                    .unwrap()
                    .additional,
                0
            );
            s.apply(
                "w1".into(),
                event("1", "claude", Operation::Read, Phase::Cancelled, 4),
                cx,
            );
            assert!(s.projection("w1", Path::new("/repo"), file).is_none());
        });
    }
}
