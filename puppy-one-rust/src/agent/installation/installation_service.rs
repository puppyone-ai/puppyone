//! Application-session installation evidence. Explicit refresh guarantees a
//! subsequent scan; views never expire evidence or own the shared work.
use super::executable_resolver::{
    LocalAgentExecutableResolver, Observation, ResolutionContext, ResolvedCandidate,
};
use super::installation_definition::InstallationDefinition;
use super::installation_registry::{
    DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY, InstallationRegistry,
};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::discovery::executable_discovery_port::{
    DiscoveryPortOptions, ExecutableDiscoveryPort,
};
use crate::agent::tasks::{CancelSignal, Canceller, SharedTask, shared};
use futures_util::{FutureExt, StreamExt, future::LocalBoxFuture, stream::FuturesUnordered};
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    rc::Rc,
    sync::Arc,
    time::Instant,
};
use tokio::sync::oneshot;

pub type CreateContext =
    Rc<dyn Fn(CancelSignal) -> LocalBoxFuture<'static, AgentResult<ResolutionContext>>>;
pub type Resolve = Rc<
    dyn Fn(
        InstallationDefinition,
        Rc<ResolutionContext>,
    ) -> LocalBoxFuture<'static, AgentResult<Observation>>,
>;
pub type ProgressObserver = Rc<dyn Fn(Arc<Progress>)>;
pub type SnapshotPublisher = Rc<dyn Fn(Arc<Snapshot>)>;
pub type Discovery = SharedTask<AgentResult<Arc<Snapshot>>>;

mod types;
pub use types::{Diagnostics, ProductResult, Progress, Snapshot, Source, Status};
#[cfg(test)]
mod tests;

struct Flight {
    generation: u64,
    task: Discovery,
    observers: Vec<ProgressObserver>,
    progress: Option<Arc<Progress>>,
}
struct Queued {
    task: Discovery,
    sender: oneshot::Sender<AgentResult<Arc<Snapshot>>>,
    observers: Vec<ProgressObserver>,
}
#[derive(Default)]
struct State {
    latest: Option<Arc<Snapshot>>,
    active: Option<Flight>,
    queued: Option<Queued>,
    generation: u64,
    disposed: bool,
    diagnostics: Diagnostics,
}
#[derive(Clone)]
pub struct InstallationService {
    state: Rc<RefCell<State>>,
    registry: InstallationRegistry,
    context: CreateContext,
    resolve: Resolve,
    now: Rc<dyn Fn() -> i64>,
    publish: Option<SnapshotPublisher>,
    cancel: Canceller,
}
impl InstallationService {
    pub fn system(publish: Option<SnapshotPublisher>) -> Self {
        let registry = DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone();
        let resolver = Rc::new(LocalAgentExecutableResolver::new(
            Some(registry.clone()),
            ExecutableDiscoveryPort::new(DiscoveryPortOptions::default()),
        ));
        let context = resolver.clone();
        Self::new(
            registry,
            Rc::new(move |signal| {
                let resolver = context.clone();
                Box::pin(async move { resolver.create_context(Some(signal)).await })
            }),
            Rc::new(move |definition, context| {
                let resolver = resolver.clone();
                Box::pin(async move {
                    resolver
                        .resolve(&definition.id, Some((*context).clone()), vec![])
                        .await
                })
            }),
            Rc::new(crate::clock::now_ms),
            publish,
        )
    }
    pub fn new(
        registry: InstallationRegistry,
        context: CreateContext,
        resolve: Resolve,
        now: Rc<dyn Fn() -> i64>,
        publish: Option<SnapshotPublisher>,
    ) -> Self {
        let diagnostics = Diagnostics {
            catalog_size: registry.len(),
            ..Diagnostics::default()
        };
        Self {
            state: Rc::new(RefCell::new(State {
                diagnostics,
                ..State::default()
            })),
            registry,
            context,
            resolve,
            now,
            publish,
            cancel: Canceller::new(),
        }
    }
    pub fn get_snapshot(&self) -> Option<Arc<Snapshot>> {
        self.state.borrow().latest.clone()
    }
    pub fn get_diagnostics(&self) -> Diagnostics {
        self.state.borrow().diagnostics.clone()
    }
    pub fn is_scanning(&self) -> bool {
        let state = self.state.borrow();
        state.active.is_some() || state.queued.is_some()
    }
    pub fn discover(&self, refresh: bool, observer: Option<ProgressObserver>) -> Discovery {
        let mut state = self.state.borrow_mut();
        if state.disposed {
            return shared(async { Err(closed()) });
        }
        if !refresh && let Some(snapshot) = state.latest.clone() {
            state.diagnostics.cache_hit_count += 1;
            let mut snapshot = (*snapshot).clone();
            snapshot.source = Source::MemoryCache;
            return shared(async move { Ok(Arc::new(snapshot)) });
        }
        if state.active.is_some() {
            if refresh {
                if state.queued.is_none() {
                    state.diagnostics.queued_refresh_count += 1;
                    let (task, sender) = promise();
                    state.queued = Some(Queued {
                        task,
                        sender,
                        observers: vec![],
                    });
                }
                let queued = state.queued.as_mut().unwrap();
                add_observer(&mut queued.observers, observer);
                return queued.task.clone();
            }
            let active = state.active.as_mut().unwrap();
            add_observer(&mut active.observers, observer.clone());
            let (task, progress) = (active.task.clone(), active.progress.clone());
            drop(state);
            if let (Some(observer), Some(progress)) = (observer, progress) {
                safely(|| observer(progress));
            }
            return task;
        }
        drop(state);
        self.start(observer.into_iter().collect())
    }
    fn start(&self, observers: Vec<ProgressObserver>) -> Discovery {
        let (task, sender) = promise();
        let generation = {
            let mut state = self.state.borrow_mut();
            state.generation += 1;
            let generation = state.generation;
            state.active = Some(Flight {
                generation,
                task: task.clone(),
                observers,
                progress: None,
            });
            generation
        };
        let service = self.clone();
        tokio::task::spawn_local(async move {
            let started = Instant::now();
            let outcome = service.scan(generation).await.and_then(|snapshot| {
                snapshot.validate()?;
                Ok(Arc::new(snapshot))
            });
            let snapshot = outcome.as_ref().ok();
            let publish = {
                let mut state = service.state.borrow_mut();
                state.diagnostics.scan_count += 1;
                state.diagnostics.last_scan_completed_at = snapshot.map(|s| s.completed_at.clone());
                state.diagnostics.last_available_count =
                    snapshot.map_or(0, |s| s.available_agent_ids.len());
                state.diagnostics.last_scan_duration_ms =
                    Some((started.elapsed().as_secs_f64() * 100_000.).round() / 100.);
                let publish =
                    snapshot.is_some() && !state.disposed && state.generation == generation;
                if publish {
                    state.latest = snapshot.cloned();
                }
                publish
            };
            if publish && let Some(publisher) = &service.publish {
                safely(|| publisher(snapshot.unwrap().clone()));
            }
            let _ = sender.send(outcome);
            let queued = {
                let mut state = service.state.borrow_mut();
                if state
                    .active
                    .as_ref()
                    .is_none_or(|f| f.generation != generation)
                {
                    return;
                }
                state.active = None;
                if state.disposed {
                    None
                } else {
                    state.queued.take()
                }
            };
            if let Some(queued) = queued {
                let next = service.start(queued.observers);
                tokio::task::spawn_local(async move {
                    let _ = queued.sender.send(next.await);
                });
            }
        });
        task
    }
    async fn scan(&self, generation: u64) -> AgentResult<Snapshot> {
        let requested_at = crate::clock::iso_string((self.now)());
        let scan_id = format!("local-agent-scan:{generation}");
        let context =
            std::panic::AssertUnwindSafe(async { (self.context)(self.cancel.signal()).await })
                .catch_unwind()
                .await
                .ok()
                .and_then(Result::ok)
                .map(Rc::new);
        let mut work = FuturesUnordered::new();
        for definition in self.registry.iter().cloned() {
            let context = context.clone();
            let resolve = self.resolve.clone();
            work.push(async move {
                let observation = if let Some(context) = context {
                    std::panic::AssertUnwindSafe(async {
                        resolve(definition.clone(), context).await
                    })
                    .catch_unwind()
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .unwrap_or_else(|| Observation::Failed {
                        reason_code: "resolver-error".into(),
                    })
                } else {
                    Observation::Failed {
                        reason_code: "context-error".into(),
                    }
                };
                (definition, observation)
            });
        }
        let mut settled = HashMap::new();
        let mut candidates = HashMap::new();
        while let Some((definition, observation)) = work.next().await {
            settled.insert(
                definition.id.clone(),
                ProductResult::from_observation(&definition, &observation),
            );
            if let Observation::Found { candidate, .. } = observation {
                candidates.insert(definition.id, *candidate);
            }
            let results = stable(&self.registry, &settled);
            let progress = Arc::new(Progress {
                scan_id: scan_id.clone(),
                generation,
                completed_agent_count: settled.len(),
                total_agent_count: self.registry.len(),
                candidates: candidates.clone(),
                available_agent_ids: available(&results),
                results,
            });
            let observers = {
                let mut state = self.state.borrow_mut();
                if state.disposed {
                    continue;
                }
                let Some(active) = state.active.as_mut().filter(|a| a.generation == generation)
                else {
                    continue;
                };
                active.progress = Some(progress.clone());
                active.observers.clone()
            };
            for observer in observers {
                safely(|| observer(progress.clone()));
            }
        }
        let results = stable(&self.registry, &settled);
        let previous = self.state.borrow().latest.clone();
        let previous_ids: HashSet<_> = previous
            .as_ref()
            .into_iter()
            .flat_map(|s| s.available_agent_ids.iter().chain(&s.retained_agent_ids))
            .cloned()
            .collect();
        let retained_agent_ids: Vec<_> = results
            .iter()
            .filter(|r| r.status == Status::Failed && previous_ids.contains(&r.agent_id))
            .map(|r| r.agent_id.clone())
            .collect();
        if let Some(previous) = previous {
            for id in &retained_agent_ids {
                if let Some(candidate) = previous.candidate(id) {
                    candidates.insert(id.clone(), candidate.clone());
                }
            }
        }
        Ok(Snapshot {
            generation,
            scan_id,
            requested_at,
            completed_at: crate::clock::iso_string((self.now)()),
            source: Source::Scan,
            available_agent_ids: available(&results),
            results,
            retained_agent_ids,
            candidates,
        })
    }
    pub fn dispose(&self) {
        let queued = {
            let mut state = self.state.borrow_mut();
            state.disposed = true;
            state.generation += 1;
            state.latest = None;
            state.active = None;
            state.queued.take()
        };
        self.cancel.cancel(closed());
        if let Some(queued) = queued {
            let _ = queued.sender.send(Err(closed()));
        }
    }
}
fn promise() -> (Discovery, oneshot::Sender<AgentResult<Arc<Snapshot>>>) {
    let (sender, receive) = oneshot::channel();
    (
        shared(async move { receive.await.unwrap_or_else(|_| Err(closed())) }),
        sender,
    )
}
fn closed() -> AgentError {
    AgentError::new("Local Agent installation service is closed.")
}
fn add_observer(observers: &mut Vec<ProgressObserver>, observer: Option<ProgressObserver>) {
    if let Some(observer) = observer
        && !observers.iter().any(|old| Rc::ptr_eq(old, &observer))
    {
        observers.push(observer);
    }
}
fn safely(callback: impl FnOnce()) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(callback));
}
fn stable(
    registry: &[InstallationDefinition],
    settled: &HashMap<String, ProductResult>,
) -> Vec<ProductResult> {
    registry
        .iter()
        .filter_map(|definition| settled.get(&definition.id).cloned())
        .collect()
}
fn available(results: &[ProductResult]) -> Vec<String> {
    results
        .iter()
        .filter(|r| r.status == Status::Found)
        .map(|r| r.agent_id.clone())
        .collect()
}
