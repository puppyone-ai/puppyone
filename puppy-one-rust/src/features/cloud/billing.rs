//! `billingReadCache.ts` and `useAccountPlan.ts`: a space's billing
//! readings (catalog, summary, usage, the reader's access). Memory only and
//! shared by every window: one session namespace at a time, fresh for 30 s,
//! and an expired reading may paint while a fresh request runs; it never
//! proves a charge. A failed read keeps what was last read and says so;
//! hosted subscriptions switched off is a state, not a failure.
use crate::cloud::auth::model::Binding;
use crate::workspace::cloud::{
    billing::{self, Access, Catalog, Summary, Usage},
    cache::{Cache, TTL},
    services::Error,
};
use gpui::{App, Global};
use std::time::Instant;

/// The readings' bound per kind.
const ENTRIES: usize = 64;
/// The catalog belongs to the account, not to a space.
const ACCOUNT: &str = "account";

/// `AccountPlanSnapshot`: one space's readings as the page shows them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PlanSnapshot {
    pub catalog: Option<Catalog>,
    pub summary: Option<Summary>,
    pub usage: Option<Usage>,
    pub organization: Option<String>,
    /// Whether this person may change the plan; only a space's owner can.
    pub can_manage_billing: Option<bool>,
    pub loading: bool,
    pub error: bool,
    /// Hosted subscriptions are switched off: readings stay, nothing sells.
    pub catalog_unavailable: bool,
}

struct Reads {
    catalog: Cache<Catalog>,
    summary: Cache<Summary>,
    usage: Cache<Usage>,
    access: Cache<Access>,
}
impl Global for Reads {}
impl Reads {
    fn activate(&mut self, namespace: &str) {
        self.catalog.activate(namespace);
        self.summary.activate(namespace);
        self.usage.activate(namespace);
        self.access.activate(namespace);
    }
}
fn reads(cx: &mut App) -> &mut Reads {
    if !cx.has_global::<Reads>() {
        cx.set_global(Reads {
            catalog: Cache::new(ENTRIES, TTL),
            summary: Cache::new(ENTRIES, TTL),
            usage: Cache::new(ENTRIES, TTL),
            access: Cache::new(ENTRIES, TTL),
        });
    }
    cx.global_mut::<Reads>()
}

/// `createCloudBillingContextKey`: the session the readings belong to.
pub fn namespace(binding: &Binding) -> String {
    serde_json::json!([binding.environment.api(), binding.user, binding.epoch]).to_string()
}

/// What the cache holds for `org`, and which of it is still fresh.
#[derive(Clone, Default)]
pub struct Cached {
    pub catalog: Option<(Catalog, bool)>,
    pub summary: Option<(Summary, bool)>,
    pub usage: Option<(Usage, bool)>,
    pub access: Option<(Access, bool)>,
}
impl Cached {
    /// `cachedSnapshot`: the last readings, painted while a load runs.
    pub fn snapshot(&self, org: &str) -> PlanSnapshot {
        PlanSnapshot {
            catalog: self.catalog.clone().map(|c| c.0),
            summary: self.summary.clone().map(|c| c.0),
            usage: self.usage.clone().map(|c| c.0),
            organization: Some(org.to_owned()),
            can_manage_billing: self.access.as_ref().map(|a| a.0.can_manage_billing),
            loading: true,
            error: false,
            catalog_unavailable: false,
        }
    }
}
pub fn cached(namespace: &str, org: &str, cx: &mut App) -> Cached {
    let now = Instant::now();
    let reads = reads(cx);
    reads.activate(namespace);
    Cached {
        catalog: reads.catalog.read(ACCOUNT, now),
        summary: reads.summary.read(org, now),
        usage: reads.usage.read(org, now),
        access: reads.access.read(org, now),
    }
}

/// One read's answer: fetched, or the reason it was not.
pub type Fetched<T> = Option<Result<T, Error>>;
/// What a load fetched; `None` where the cache was fresh enough.
#[derive(Default)]
pub struct Loaded {
    pub catalog: Fetched<Catalog>,
    pub summary: Fetched<Summary>,
    pub usage: Fetched<Usage>,
    pub access: Fetched<Access>,
}
/// The reads one load makes, off the main thread: whatever is not fresh,
/// or everything when `force`. Each is held to `org`.
pub fn fetch(client: &billing::Client, org: &str, cached: &Cached, force: bool) -> Loaded {
    let stale = |fresh: Option<bool>| force || fresh != Some(true);
    Loaded {
        catalog: stale(cached.catalog.as_ref().map(|c| c.1)).then(|| client.catalog()),
        summary: stale(cached.summary.as_ref().map(|c| c.1)).then(|| client.summary(org)),
        usage: stale(cached.usage.as_ref().map(|c| c.1)).then(|| {
            client.usage(org).and_then(|usage| {
                if usage.runtime.org_id == org {
                    Ok(usage)
                } else {
                    Err(Error::Invalid(billing::MISMATCH))
                }
            })
        }),
        access: stale(cached.access.as_ref().map(|c| c.1)).then(|| client.access(org)),
    }
}
/// Keeps what arrived and makes the snapshot: an answer, else the reading
/// last held. A failed read marks the snapshot failed, and a page without
/// the space's summary is a failed one.
pub fn settle(
    namespace: &str,
    org: &str,
    cached: Cached,
    loaded: Loaded,
    cx: &mut App,
) -> PlanSnapshot {
    let now = Instant::now();
    let reads = reads(cx);
    reads.activate(namespace);
    let mut failed = false;
    let mut catalog_unavailable = false;
    let catalog = match loaded.catalog {
        Some(Ok(catalog)) => {
            reads.catalog.store(ACCOUNT.into(), catalog.clone(), now);
            Some(catalog)
        }
        Some(Err(Error::BillingDisabled)) => {
            catalog_unavailable = true;
            None
        }
        Some(Err(_)) => {
            failed = true;
            cached.catalog.map(|c| c.0)
        }
        None => cached.catalog.map(|c| c.0),
    };
    macro_rules! settle_one {
        ($field:ident) => {
            match loaded.$field {
                Some(Ok(value)) => {
                    reads.$field.store(org.into(), value.clone(), now);
                    Some(value)
                }
                Some(Err(_)) => {
                    failed = true;
                    cached.$field.map(|c| c.0)
                }
                None => cached.$field.map(|c| c.0),
            }
        };
    }
    let summary = settle_one!(summary);
    let usage = settle_one!(usage);
    let access = settle_one!(access);
    PlanSnapshot {
        error: failed || summary.is_none(),
        catalog,
        summary,
        usage,
        organization: Some(org.to_owned()),
        can_manage_billing: access.map(|a| a.can_manage_billing),
        loading: false,
        catalog_unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::auth::model::ApiRequest;
    use core::prelude::v1::test;
    use serde_json::{Value, json};
    use std::sync::{Arc, Mutex};

    type Answer = Arc<dyn Fn(&str) -> Result<Value, Error> + Send + Sync>;
    /// Answers by path, and counts what it was asked.
    struct Server(Mutex<Vec<String>>, Answer);
    impl crate::workspace::cloud::services::Transport for Server {
        fn request(&self, request: ApiRequest) -> Result<Value, Error> {
            self.0.lock().unwrap().push(request.path.clone());
            (self.1)(&request.path)
        }
    }
    fn answers(path: &str) -> Result<Value, Error> {
        Ok(match path {
            "/billing/catalog" => {
                json!({"schema_version": "1.0", "plans": [{"id": "free", "name": "Free"}]})
            }
            "/billing/organizations/o1/summary" => {
                json!({"org_id": "o1", "plan_id": "free", "status": "free", "seat_quantity": 1})
            }
            "/billing/organizations/o1/usage" => {
                json!({"runtime": {"org_id": "o1"}, "storage": {"logical_bytes": 1}})
            }
            "/organizations/o1/access" => {
                json!({"org_id": "o1", "user_id": "u1", "role": "owner", "can_manage_billing": true})
            }
            _ => Value::Null,
        })
    }
    fn client(
        f: impl Fn(&str) -> Result<Value, Error> + Send + Sync + 'static,
    ) -> (billing::Client, Arc<Server>) {
        let server = Arc::new(Server(Default::default(), Arc::new(f)));
        (billing::Client::new(server.clone()), server)
    }

    /// `useAccountPlan`: fresh readings are not asked again; a forced load
    /// asks for everything.
    #[gpui::test]
    fn fresh_readings_are_reused_until_forced(cx: &mut gpui::TestAppContext) {
        let (client, server) = client(answers);
        cx.update(|cx| {
            let first = cached("ns", "o1", cx);
            let loaded = fetch(&client, "o1", &first, false);
            let snapshot = settle("ns", "o1", first, loaded, cx);
            assert!(!snapshot.error && !snapshot.loading);
            assert_eq!(snapshot.can_manage_billing, Some(true));
            assert_eq!(server.0.lock().unwrap().len(), 4);
            let again = cached("ns", "o1", cx);
            assert!(fetch(&client, "o1", &again, false).summary.is_none());
            assert_eq!(server.0.lock().unwrap().len(), 4);
            fetch(&client, "o1", &again, true);
            assert_eq!(server.0.lock().unwrap().len(), 8);
            // Another session reads nothing of this one.
            assert!(cached("other", "o1", cx).summary.is_none());
        });
    }

    /// A failed read keeps the reading last held and says the load failed;
    /// switched-off billing is not a failure.
    #[gpui::test]
    fn a_failed_read_keeps_the_last_reading_and_switched_off_billing_is_a_state(
        cx: &mut gpui::TestAppContext,
    ) {
        let (good, _) = client(answers);
        let (down, _) = client(|path| match path {
            "/billing/catalog" => Err(Error::BillingDisabled),
            _ => Err(Error::Status(503)),
        });
        cx.update(|cx| {
            let first = cached("ns", "o1", cx);
            let loaded = fetch(&good, "o1", &first, false);
            settle("ns", "o1", first, loaded, cx);
            let held = cached("ns", "o1", cx);
            let loaded = fetch(&down, "o1", &held, true);
            let snapshot = settle("ns", "o1", held, loaded, cx);
            assert!(snapshot.error);
            assert!(snapshot.catalog_unavailable);
            assert_eq!(snapshot.catalog, None);
            assert_eq!(snapshot.summary.unwrap().plan_id, "free");
        });
    }

    /// Usage another space's answer is refused, never shown under this one.
    #[gpui::test]
    fn usage_for_another_space_is_refused(cx: &mut gpui::TestAppContext) {
        let (client, _) = client(|path| match path {
            "/billing/organizations/o1/usage" => {
                Ok(json!({"runtime": {"org_id": "o2"}, "storage": {"logical_bytes": 1}}))
            }
            path => answers(path),
        });
        cx.update(|cx| {
            let first = cached("ns", "o1", cx);
            let loaded = fetch(&client, "o1", &first, false);
            let snapshot = settle("ns", "o1", first, loaded, cx);
            assert!(snapshot.error);
            assert_eq!(snapshot.usage, None);
        });
    }
}
