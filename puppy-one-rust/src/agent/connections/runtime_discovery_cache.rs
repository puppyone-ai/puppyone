//! `connections/runtime-discovery-cache.mjs`: a bounded, refreshable and
//! single-flight cache for one runtime discovery.
use crate::agent::agent_error::AgentResult;
use crate::agent::contract::js;
use crate::agent::event_loop::{AbortSignal, SharedTask, shared};
use crate::agent::runtime::agent_runtime_registry::RuntimeDiscovery;
use futures_util::future::LocalBoxFuture;
use serde_json::Value;
use std::cell::RefCell;
use std::rc::Rc;

/// `runtimeDiscoveryCachePolicy`.
pub mod policy {
    pub const POSITIVE_TTL_MS: i64 = 5 * 60_000;
    pub const TRANSIENT_TTL_MS: i64 = 5_000;
}

const TRANSIENT_CODES: &[&str] = &[
    "AUTHENTICATION_PROBE_FAILED",
    "AUTHENTICATION_PROBE_CRASHED",
    "AUTHENTICATION_PROBE_TIMED_OUT",
    "AUTHENTICATION_STATUS_UNKNOWN",
    "RUNTIME_DISCOVERY_FAILED",
    "RUNTIME_INSPECTION_FAILED",
    "PROTOCOL_PROBE_FAILED",
];

/// `load({ signal })`.
pub type DiscoveryLoad = Rc<dyn Fn(AbortSignal) -> LocalBoxFuture<'static, AgentResult<Value>>>;

/// `createCachedRuntimeDiscovery(load, { now, positiveTtlMs, transientTtlMs })` options.
#[derive(Clone)]
pub struct CacheOptions {
    pub now: Rc<dyn Fn() -> i64>,
    pub positive_ttl_ms: i64,
    pub transient_ttl_ms: i64,
}

impl Default for CacheOptions {
    fn default() -> Self {
        Self {
            now: Rc::new(js::now_ms),
            positive_ttl_ms: policy::POSITIVE_TTL_MS,
            transient_ttl_ms: policy::TRANSIENT_TTL_MS,
        }
    }
}

struct Cached {
    generation: u64,
    expires_at: i64,
    value: Value,
}

#[derive(Default)]
struct State {
    generation: u64,
    cached: Option<Cached>,
    in_flight: Option<(u64, u64, SharedTask<AgentResult<Value>>)>,
    next_flight: u64,
}

/// `createCachedRuntimeDiscovery(load, options)`.
pub struct CachedRuntimeDiscovery {
    load: DiscoveryLoad,
    options: CacheOptions,
    state: Rc<RefCell<State>>,
}

impl CachedRuntimeDiscovery {
    pub fn new(load: DiscoveryLoad, options: Option<CacheOptions>) -> Self {
        Self {
            load,
            options: options.unwrap_or_default(),
            state: Rc::default(),
        }
    }
}

fn is_transient(value: &Value) -> bool {
    let code = value.get("code").and_then(Value::as_str);
    code.is_some_and(|code| TRANSIENT_CODES.contains(&code))
        || (value.get("status").and_then(Value::as_str) == Some("error")
            && code != Some("RUNTIME_NOT_INSTALLED"))
}

impl RuntimeDiscovery for CachedRuntimeDiscovery {
    fn discover(
        &self,
        refresh: bool,
        signal: AbortSignal,
    ) -> LocalBoxFuture<'static, AgentResult<Value>> {
        let (load, options, state) = (self.load.clone(), self.options.clone(), self.state.clone());
        Box::pin(async move {
            signal.throw_if_aborted()?;
            enum Next {
                Cached(Value),
                Join(SharedTask<AgentResult<Value>>),
                Lead(u64, u64, SharedTask<AgentResult<Value>>),
            }
            let next = {
                let mut current = state.borrow_mut();
                if refresh {
                    current.generation += 1;
                    current.cached = None;
                    current.in_flight = None;
                }
                let generation = current.generation;
                let fresh = current
                    .cached
                    .as_ref()
                    .filter(|c| c.generation == generation && c.expires_at > (options.now)())
                    .map(|cached| cached.value.clone());
                let joined = current
                    .in_flight
                    .as_ref()
                    .filter(|(flight_generation, _, _)| *flight_generation == generation)
                    .map(|(_, _, task)| task.clone());
                match (fresh, joined) {
                    (Some(value), _) => Next::Cached(value),
                    (None, Some(task)) => Next::Join(task),
                    (None, None) => {
                        current.next_flight += 1;
                        let id = current.next_flight;
                        let first = signal.clone();
                        let task = shared(async move {
                            first.throw_if_aborted()?;
                            load(first).await
                        });
                        current.in_flight = Some((generation, id, task.clone()));
                        Next::Lead(generation, id, task)
                    }
                }
            };
            let (request_generation, id, task) = match next {
                Next::Cached(value) => return Ok(value),
                Next::Join(task) => return task.await,
                Next::Lead(generation, id, task) => (generation, id, task),
            };
            let result = task.await;
            {
                let mut current = state.borrow_mut();
                if current
                    .in_flight
                    .as_ref()
                    .is_some_and(|(generation, flight, _)| {
                        *generation == request_generation && *flight == id
                    })
                {
                    current.in_flight = None;
                }
            }
            let value = result?;
            signal.throw_if_aborted()?;
            let mut current = state.borrow_mut();
            if current.generation == request_generation {
                let ttl = if is_transient(&value) {
                    options.transient_ttl_ms
                } else {
                    options.positive_ttl_ms
                };
                current.cached = Some(Cached {
                    generation: request_generation,
                    expires_at: (options.now)() + ttl.max(1),
                    value: value.clone(),
                });
            }
            Ok(value)
        })
    }
}

/// `tests/unit/agent/runtimes/discovery/electron.runtime-discovery-cache.test.mjs`.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::application::tests_support::run_local;
    use core::prelude::v1::test;
    use serde_json::json;
    use std::cell::Cell;
    use tokio::sync::oneshot;

    fn readiness(code: &str, status: &str, message: &str) -> Value {
        json!({ "code": code, "status": status, "message": message })
    }

    fn counted(value: Value) -> (DiscoveryLoad, Rc<Cell<usize>>) {
        let calls = Rc::new(Cell::new(0));
        let count = calls.clone();
        let load: DiscoveryLoad = Rc::new(move |_| {
            count.set(count.get() + 1);
            let value = value.clone();
            Box::pin(async move { Ok(value) })
        });
        (load, calls)
    }

    fn clock(now: &Rc<Cell<i64>>, positive: i64, transient: i64) -> Option<CacheOptions> {
        let now = now.clone();
        Some(CacheOptions {
            now: Rc::new(move || now.get()),
            positive_ttl_ms: positive,
            transient_ttl_ms: transient,
        })
    }

    #[test]
    fn deduplicates_concurrent_discovery_and_keeps_successful_evidence_for_the_positive_ttl() {
        run_local(async {
            let now = Rc::new(Cell::new(0));
            let (load, calls) = counted(readiness("READY", "ready", "READY"));
            let discovery = CachedRuntimeDiscovery::new(load, clock(&now, 100, 10));
            let signal = AbortSignal::default();
            let (first, second) = futures_util::future::join(
                discovery.discover(false, signal.clone()),
                discovery.discover(false, signal.clone()),
            )
            .await;
            assert_eq!(first.unwrap(), second.unwrap());
            assert_eq!(calls.get(), 1);
            now.set(99);
            discovery.discover(false, signal.clone()).await.unwrap();
            assert_eq!(calls.get(), 1);
            now.set(100);
            discovery.discover(false, signal).await.unwrap();
            assert_eq!(calls.get(), 2);
        });
    }

    #[test]
    fn expires_transient_negative_evidence_sooner_than_successful_inventory() {
        run_local(async {
            let now = Rc::new(Cell::new(0));
            let (load, calls) = counted(readiness("AUTHENTICATION_PROBE_TIMED_OUT", "error", "x"));
            let discovery = CachedRuntimeDiscovery::new(load, clock(&now, 100, 10));
            let signal = AbortSignal::default();
            discovery.discover(false, signal.clone()).await.unwrap();
            now.set(9);
            discovery.discover(false, signal.clone()).await.unwrap();
            assert_eq!(calls.get(), 1);
            now.set(10);
            discovery.discover(false, signal).await.unwrap();
            assert_eq!(calls.get(), 2);
        });
    }

    #[test]
    fn starts_a_new_generation_on_refresh_and_never_lets_the_older_flight_overwrite_it() {
        run_local(async {
            let (resolve, deferred) = oneshot::channel::<Value>();
            let deferred = Rc::new(RefCell::new(Some(deferred)));
            let calls = Rc::new(Cell::new(0));
            let count = calls.clone();
            let load: DiscoveryLoad = Rc::new(move |_| {
                count.set(count.get() + 1);
                let pending = deferred.borrow_mut().take();
                Box::pin(async move {
                    match pending {
                        Some(pending) => Ok(pending.await.unwrap()),
                        None => Ok(readiness("READY", "ready", "new")),
                    }
                })
            });
            let discovery = Rc::new(CachedRuntimeDiscovery::new(load, None));
            let signal = AbortSignal::default();
            let old_flight = {
                let (discovery, signal) = (discovery.clone(), signal.clone());
                tokio::task::spawn_local(async move { discovery.discover(false, signal).await })
            };
            tokio::task::yield_now().await;
            let refreshed = discovery.discover(true, signal.clone()).await.unwrap();
            resolve
                .send(readiness("RUNTIME_DISCOVERY_FAILED", "error", "old"))
                .unwrap();
            old_flight.await.unwrap().unwrap();
            assert_eq!(refreshed["message"], "new");
            assert_eq!(
                discovery.discover(false, signal).await.unwrap()["message"],
                "new"
            );
            assert_eq!(calls.get(), 2);
        });
    }
}
