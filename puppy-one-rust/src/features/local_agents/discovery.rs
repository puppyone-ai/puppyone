//! One installation-discovery session for every native window. Views subscribe
//! to evidence; only explicit refresh or a completed activation starts new work.
#[cfg(test)]
mod fixtures;
use crate::agent::connections::legacy_local_agent_inventory::{self as legacy, Installation};
use crate::agent::host::{
    InstallationCandidate as ResolvedCandidate, InstallationEvent as Event,
    InstallationHost as Host, InstallationProgress as Progress,
    InstallationResult as ProductResult, InstallationSnapshot as Snapshot,
    InstallationStatus as Status,
};
use crate::platform::local_agent_setup::{Observation, ObservationFailure, ObservationStatus};
use gpui::*;
use std::sync::Arc;

pub(crate) struct Installations {
    host: Host,
    latest: Option<Arc<Snapshot>>,
    progress: Option<Arc<Progress>>,
    pub scanning: bool,
    pub failed: bool,
    /// Request identity fences an older scan's completion while a refresh is queued.
    request: u64,
    disposed: bool,
}
struct Shared(Entity<Installations>);
impl Global for Shared {}

pub(crate) fn store(cx: &mut App) -> Entity<Installations> {
    if let Some(shared) = cx.try_global::<Shared>() {
        return shared.0.clone();
    }
    #[cfg(not(test))]
    let (host, events) = Host::new();
    #[cfg(test)]
    let (host, events) = Host::with_factory(fixtures::service);
    install(host, events, cx)
}
pub(super) fn install(
    host: Host,
    mut events: tokio::sync::mpsc::UnboundedReceiver<Event>,
    cx: &mut App,
) -> Entity<Installations> {
    let entity = cx.new(|cx| {
        let mut state = Installations {
            host,
            latest: None,
            progress: None,
            scanning: false,
            failed: false,
            request: 0,
            disposed: false,
        };
        state.request(false, cx);
        state
    });
    cx.set_global(Shared(entity.clone()));
    let weak = entity.downgrade();
    cx.spawn(async move |cx| {
        while let Some(event) = events.recv().await {
            if weak
                .update(cx, |state, cx| state.accept(event, cx))
                .is_err()
            {
                break;
            }
        }
    })
    .detach();
    let weak = entity.downgrade();
    cx.on_app_quit(move |cx| {
        let _ = weak.update(cx, |s, _| {
            s.disposed = true;
            s.scanning = false;
            s.host.close();
        });
        std::future::ready(())
    })
    .detach();
    let activation = super::activation_store(cx);
    entity.update(cx, |_, cx| {
        cx.subscribe(&activation, |s, _, _: &super::InstallationsChanged, cx| {
            s.request(true, cx)
        })
        .detach();
    });
    entity
}
impl Installations {
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        super::activation_store(cx).update(cx, |s, cx| s.rescan_companions(cx));
        self.request(true, cx);
    }
    fn request(&mut self, refresh: bool, cx: &mut Context<Self>) {
        if self.disposed {
            return;
        }
        self.request += 1;
        self.scanning = true;
        self.failed = false;
        self.progress = None;
        if !self.host.discover(self.request, refresh) {
            self.scanning = false;
            self.failed = true;
        }
        cx.notify();
    }
    fn accept(&mut self, event: Event, cx: &mut Context<Self>) {
        if self.disposed {
            return;
        }
        match event {
            Event::Progress(progress) => {
                if self
                    .latest
                    .as_ref()
                    .is_some_and(|s| s.generation() >= progress.generation())
                    || self.progress.as_ref().is_some_and(|p| {
                        p.generation() > progress.generation()
                            || (p.generation() == progress.generation()
                                && p.completed_agent_count() >= progress.completed_agent_count())
                    })
                {
                    return;
                }
                self.progress = Some(progress);
            }
            Event::Completed { request, result } => {
                // Every successful generation is a cross-window publication,
                // even if a newer explicit refresh is still pending.
                if let Ok(snapshot) = &result
                    && self
                        .latest
                        .as_ref()
                        .is_none_or(|s| s.generation() <= snapshot.generation())
                {
                    if self
                        .progress
                        .as_ref()
                        .is_none_or(|p| p.generation() <= snapshot.generation())
                    {
                        self.progress = None;
                    }
                    self.latest = Some(snapshot.clone());
                }
                if request == self.request {
                    self.scanning = false;
                    self.failed = result.is_err();
                }
            }
            Event::Unavailable => {
                self.scanning = false;
                self.failed = true;
            }
        }
        cx.notify();
    }
    /// Preserve previous rows during incremental work; only a complete scan
    /// may remove definite absences. Failed observations retain host evidence.
    pub fn inventory(&self) -> legacy::Inventory {
        let mut installations = vec![];
        for product in legacy::LOCAL_AGENTS {
            let candidate = self
                .progress
                .as_ref()
                .and_then(|p| p.candidate(product.id))
                .or_else(|| self.latest.as_ref().and_then(|s| s.candidate(product.id)));
            if let Some(candidate) = candidate {
                installations.push(installation(product, candidate));
            }
        }
        installations.push(Installation {
            runtime: crate::agent::connections::legacy_runtime_registry::Runtime::PuppyOne,
            id: legacy::BUILT_IN_AGENT_ID,
            label: legacy::BUILT_IN_AGENT_LABEL.into(),
            executable: Default::default(),
            chat: true,
        });
        // Incomplete discovery never authorizes an absence-based setup offer.
        let results = if self.scanning || self.failed {
            &[][..]
        } else {
            self.latest.as_ref().map_or(&[][..], |s| s.results())
        };
        legacy::Inventory {
            installations,
            observations: results.iter().map(observation).collect(),
        }
    }
}
fn installation(product: &legacy::LocalAgent, candidate: &ResolvedCandidate) -> Installation {
    Installation {
        runtime: product.runtime,
        id: product.id,
        label: product.label.into(),
        executable: candidate.executable_path.clone().into(),
        chat: true,
    }
}
fn observation(result: &ProductResult) -> Observation {
    Observation {
        id: result.agent_id().into(),
        status: match result.status() {
            Status::Found => ObservationStatus::Found,
            Status::NotFound => ObservationStatus::NotFound,
            Status::Failed => ObservationStatus::Failed,
        },
        failure: match result.reason_code() {
            Some("environment-unavailable") => Some(ObservationFailure::EnvironmentUnavailable),
            Some("context-error") => Some(ObservationFailure::ContextError),
            _ if result.status() == Status::Failed => Some(ObservationFailure::Product),
            _ => None,
        },
    }
}
