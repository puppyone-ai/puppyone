//! `managed-connection.mjs` (the PuppyOne compute wallet) without Cloud
//! hosting: the public model and pack directory (`/ai/catalog`), this
//! account's balance (`/ai/balance`), the one-time trial grant claimed once
//! per account (`/ai/trial`), the latest model call's usage receipt
//! (`/ai/usage/{reservation}`) and top-up checkouts (`/ai/checkouts`)
//! opened only at the payment provider's HTTPS origin.
//!
//! A refresh reads the directory (reused for a minute) and the wallet at
//! once and gives up at its deadline; until it ends the state is loading,
//! and only a failed one makes the gateway unavailable. A new session drops
//! everything read under the old one at once, and an answer for it that
//! lands later is ignored; a session that changed during a refresh is
//! refreshed again as soon as that one ends.
#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests;
mod wallet;

pub use wallet::{
    Balance, Catalog, ErrorCode, Reason, Usage, checkout_url, money, parse_balance, parse_catalog,
    parse_usage,
};

use crate::agent::model_connections::ManagedComputeSnapshot;
use crate::cloud::auth::{Broker, model::ApiRequest};
use futures_util::future::{Either, select};
use gpui::*;
use reqwest::Method;
use serde_json::Value;
use std::{
    future::Future,
    pin::Pin,
    rc::Rc,
    sync::Arc,
    time::{Duration, Instant},
};
use wallet::data;

/// `refreshTimeoutMs`: a refresh that has not ended by then fails.
pub const DEADLINE: Duration = Duration::from_secs(30);
/// `catalogTtlMs`: the public directory is reused this long.
const CATALOG_TTL: Duration = Duration::from_secs(60);
/// Without `force`, the wallet is read at most this often.
const REFRESH_INTERVAL: Duration = Duration::from_secs(15);

/// A request the wallet did not answer usably.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Failed;
pub type Answer = Pin<Box<dyn Future<Output = Result<Value, Failed>> + Send>>;

/// Where the wallet is asked: the account's Broker, or a test's double.
pub trait Gateway: Send + Sync {
    /// `requestPublic`: no account.
    fn public(&self, path: &str) -> Answer;
    /// `requestSessionApi`: as the signed-in account.
    fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        idempotency_key: Option<String>,
    ) -> Answer;
}

/// The signed-in account the wallet belongs to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Session {
    /// The account, its sign-in and its environment.
    pub key: String,
    pub user: String,
}
impl Session {
    pub fn of(binding: &crate::cloud::auth::model::Binding) -> Self {
        Self {
            key: crate::cloud::auth::reservation::key(binding),
            user: binding.user.clone(),
        }
    }
}

/// The signed-in session (if any) and the gateway (if Cloud is on).
pub type Connection = (Option<Session>, Option<Arc<dyn Gateway>>);

/// The app's sides of compute: what it is connected to, how the browser
/// sign-in starts and where a checkout opens.
#[derive(Clone)]
pub struct Hooks {
    pub connect: Rc<dyn Fn(&App) -> Connection>,
    /// `startOAuth`: false when the browser handoff could not start.
    pub sign_in: Rc<dyn Fn(&App) -> bool>,
    pub open: Rc<dyn Fn(&str)>,
    pub deadline: Duration,
}

struct BrokerGateway {
    broker: Arc<Broker>,
    binding: Option<crate::cloud::auth::model::Binding>,
}
impl Gateway for BrokerGateway {
    fn public(&self, path: &str) -> Answer {
        let (broker, path) = (self.broker.clone(), path.to_owned());
        Box::pin(async move { broker.public(&path).map(data).map_err(|_| Failed) })
    }
    fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        idempotency_key: Option<String>,
    ) -> Answer {
        let (broker, binding) = (self.broker.clone(), self.binding.clone());
        let request = ApiRequest {
            idempotency_key,
            method,
            path: path.to_owned(),
            query: vec![],
            body,
        };
        Box::pin(async move {
            let binding = binding.ok_or(Failed)?;
            broker
                .request(&binding, &request)
                .map(data)
                .map_err(|_| Failed)
        })
    }
}

impl Hooks {
    /// The app's account, its browser sign-in and the system browser.
    pub fn app() -> Self {
        Self {
            connect: Rc::new(|cx| {
                let Some(broker) = crate::features::cloud::account::broker(cx) else {
                    return (None, None);
                };
                let binding =
                    crate::features::cloud::account::broker_and_binding(cx).map(|(_, b)| b);
                let session = binding.as_ref().map(Session::of);
                let gateway: Arc<dyn Gateway> = Arc::new(BrokerGateway { broker, binding });
                (session, Some(gateway))
            }),
            sign_in: Rc::new(crate::features::cloud::account::sign_in_or_reopen),
            open: Rc::new(|url| {
                let _ = crate::platform::desktop::open_url(url);
            }),
            deadline: DEADLINE,
        }
    }
}

/// What the refresh brought back.
struct Outcome {
    catalog: Catalog,
    fresh_catalog: bool,
    balance: Option<Balance>,
    claimed: bool,
}

pub struct ManagedCompute {
    hooks: Hooks,
    session: Option<Session>,
    pub catalog: Option<Catalog>,
    catalog_at: Option<Instant>,
    pub balance: Option<Balance>,
    error: Option<ErrorCode>,
    pub pending: bool,
    trial_claimed_for: Option<String>,
    last_refresh: Option<Instant>,
    /// The session's generation: what was read under an older one is
    /// dropped.
    generation: u64,
    last_reservation: Option<String>,
    pub last_usage: Option<Usage>,
    receipt_pending: bool,
    /// The last checkout gave no usable address.
    pub checkout_failed: bool,
    /// The last browser sign-in could not start (`AUTHENTICATION_FAILED`).
    pub sign_in_failed: bool,
    /// Production authority backing this view projection; `None` in standalone
    /// scripted-hook unit tests.
    backing: Option<Entity<super::store::ModelConnectionsStore>>,
    _account: Option<Subscription>,
}

struct Service(Entity<ManagedCompute>);
impl Global for Service {}
/// The app's compute wallet, projected directly from [`super::store::ModelConnectionsStore`]
/// so Settings, Chat and `AgentHost` share one wallet state and never duplicate requests.
pub fn global(cx: &mut App) -> Entity<ManagedCompute> {
    if let Some(service) = cx.try_global::<Service>() {
        return service.0.clone();
    }
    let store = super::store::global(cx);
    let entity = cx.new(|cx| ManagedCompute::from_store(store, cx));
    cx.set_global(Service(entity.clone()));
    entity
}

/// Tests: the app's wallet, on `hooks`.
#[cfg(test)]
pub(crate) fn install(hooks: Hooks, cx: &mut App) -> Entity<ManagedCompute> {
    let entity = cx.new(|_| ManagedCompute::new(hooks));
    cx.set_global(Service(entity.clone()));
    entity
}

impl ManagedCompute {
    fn from_store(store: Entity<super::store::ModelConnectionsStore>, cx: &mut Context<Self>) -> Self {
        let mut compute = Self::new(Hooks::app());
        compute.sync_from_snapshot(&store.read(cx).snapshot().managed);
        compute._account = Some(cx.observe(&store, |c: &mut ManagedCompute, store, cx| {
            c.sync_from_snapshot(&store.read(cx).snapshot().managed);
            cx.notify();
        }));
        compute.backing = Some(store);
        compute
    }

    fn sync_from_snapshot(&mut self, snap: &ManagedComputeSnapshot) {
        let next_session = if snap.signed_in {
            Some(Session {
                key: snap.session_key.clone().unwrap_or_default(),
                user: String::new(),
            })
        } else {
            None
        };
        if next_session != self.session {
            self.session = next_session;
            self.sign_in_failed = false;
        }
        self.catalog = snap.catalog.clone();
        self.balance = snap.balance;
        self.error = snap.error_code;
        self.pending = snap.pending;
        self.last_usage = snap.last_usage.clone();
        self.checkout_failed = snap.checkout_failed;
    }

    pub fn new(hooks: Hooks) -> Self {
        Self {
            hooks,
            session: None,
            catalog: None,
            catalog_at: None,
            balance: None,
            error: None,
            pending: false,
            trial_claimed_for: None,
            last_refresh: None,
            generation: 0,
            last_reservation: None,
            last_usage: None,
            receipt_pending: false,
            checkout_failed: false,
            sign_in_failed: false,
            backing: None,
            _account: None,
        }
    }
    pub fn signed_in(&self) -> bool {
        self.session.is_some()
    }
    /// `managed.reason`.
    pub fn reason(&self) -> Reason {
        if self.session.is_none() {
            return Reason::SignInRequired;
        }
        match (&self.catalog, &self.balance) {
            (Some(_), Some(b)) if self.error.is_none() => {
                if b.available_micro_usd > 0 {
                    Reason::Ready
                } else {
                    Reason::InsufficientCredit
                }
            }
            _ if self.pending || self.error.is_none() => Reason::Loading,
            _ => Reason::GatewayUnavailable,
        }
    }
    /// `managed.errorCode`: none while a refresh is in flight.
    pub fn error_code(&self) -> Option<ErrorCode> {
        self.error.filter(|_| !self.pending)
    }
    /// The wallet could not be read, or a checkout could not open.
    pub fn failed(&self) -> bool {
        self.error_code().is_some() || self.checkout_failed
    }
    /// `managed.trialCreditMicroUsd`: the server's one-time credit.
    pub fn trial_credit_micro_usd(&self) -> i64 {
        self.catalog
            .as_ref()
            .map_or(0, |c| c.trial_credit_micro_usd)
    }

    /// Adopt the account now signed in: a new one drops what was read
    /// under the old one.
    fn adopt(&mut self, session: Option<Session>) -> bool {
        if session == self.session {
            return false;
        }
        self.session = session;
        self.generation += 1;
        self.balance = None;
        self.error = None;
        self.trial_claimed_for = None;
        self.last_refresh = None;
        self.last_reservation = None;
        self.last_usage = None;
        self.checkout_failed = false;
        self.sign_in_failed = false;
        true
    }

    /// Read the directory and the wallet; at most every 15 s unless forced.
    pub fn refresh(&mut self, force: bool, cx: &mut Context<Self>) {
        if let Some(store) = &self.backing {
            store.read(cx).refresh_managed(force);
            return;
        }
        let (session, gateway) = (self.hooks.connect)(cx);
        if self.adopt(session) {
            cx.notify();
        }
        let Some(gateway) = gateway else {
            return;
        };
        if self.pending
            || (!force
                && self
                    .last_refresh
                    .is_some_and(|t| t.elapsed() < REFRESH_INTERVAL))
        {
            return;
        }
        self.adopt_reservation();
        self.pending = true;
        cx.notify();
        let generation = self.generation;
        let user = self.session.as_ref().map(|s| s.user.clone());
        let claim = user
            .clone()
            .filter(|u| self.trial_claimed_for.as_ref() != Some(u));
        let cached = self
            .catalog
            .clone()
            .filter(|_| self.catalog_at.is_some_and(|t| t.elapsed() < CATALOG_TTL));
        let executor = cx.background_executor().clone();
        let deadline = executor.timer(self.hooks.deadline);
        // The public directory and this account's wallet are read at once.
        let directory = match cached {
            Some(catalog) => Either::Left(async move { Ok::<_, Failed>((catalog, false)) }),
            None => {
                let answer = gateway.public("/ai/catalog");
                Either::Right(executor.spawn(async move {
                    let value = answer.await?;
                    parse_catalog(&value).map(|c| (c, true)).ok_or(Failed)
                }))
            }
        };
        let wallet = user
            .as_ref()
            .map(|_| executor.spawn(gateway.request(Method::GET, "/ai/balance", None, None)));
        let job = async move {
            let (catalog, fresh_catalog) = directory.await?;
            let wallet = match wallet {
                Some(wallet) => Some(wallet.await?),
                None => None,
            };
            let mut balance = wallet.as_ref().map(parse_balance);
            let mut claimed = false;
            // A returning account has already received its lifetime grant;
            // for a new one the idempotent claim returns the new wallet.
            if claim.is_some() && catalog.trial_credit_micro_usd > 0 {
                if !balance
                    .flatten()
                    .is_some_and(|b| b.trial_granted_micro_usd > 0)
                {
                    let granted = executor
                        .spawn(gateway.request(
                            Method::POST,
                            "/ai/trial",
                            Some(serde_json::json!({})),
                            None,
                        ))
                        .await?;
                    balance = Some(parse_balance(&granted));
                }
                claimed = true;
            }
            let balance = match balance {
                Some(balance) => Some(balance.ok_or(Failed)?),
                None => None,
            };
            Ok::<_, Failed>(Outcome {
                catalog,
                fresh_catalog,
                balance,
                claimed,
            })
        };
        cx.spawn(async move |this, cx| {
            let ended = match select(Box::pin(job), deadline).await {
                Either::Left((result, _)) => result.map_err(|_| ErrorCode::GatewayUnavailable),
                // The answer that lands after this is dropped with its task.
                Either::Right(_) => Err(ErrorCode::Timeout),
            };
            let _ = this.update(cx, |s, cx| s.ended(generation, user, ended, cx));
        })
        .detach();
    }

    fn ended(
        &mut self,
        generation: u64,
        user: Option<String>,
        ended: Result<Outcome, ErrorCode>,
        cx: &mut Context<Self>,
    ) {
        self.pending = false;
        if generation != self.generation {
            // Read for a session that is gone: read the new one now.
            cx.notify();
            self.refresh(true, cx);
            return;
        }
        self.last_refresh = Some(Instant::now());
        match ended {
            Ok(outcome) => {
                if outcome.fresh_catalog {
                    self.catalog_at = Some(Instant::now());
                }
                self.catalog = Some(outcome.catalog);
                self.balance = outcome.balance;
                self.error = None;
                if outcome.claimed {
                    self.trial_claimed_for = user;
                }
                self.read_receipt(cx);
            }
            Err(code) => {
                self.error = Some(code);
                self.balance = None;
            }
        }
        cx.notify();
    }

    /// The reservation the model client noted for this session.
    fn adopt_reservation(&mut self) {
        let Some(session) = &self.session else {
            return;
        };
        if let Some((id, model)) = crate::cloud::auth::reservation::take(&session.key)
            && self.last_reservation.as_ref() != Some(&id)
        {
            self.last_usage = Some(Usage::pending(&id, &model));
            self.last_reservation = Some(id);
        }
    }

    /// `refreshReceipt`: the latest call's settlement, read on its own; the
    /// wallet never waits for it.
    fn read_receipt(&mut self, cx: &mut Context<Self>) {
        let (Some(reservation), false) = (self.last_reservation.clone(), self.receipt_pending)
        else {
            return;
        };
        let (_, Some(gateway)) = (self.hooks.connect)(cx) else {
            return;
        };
        self.receipt_pending = true;
        let generation = self.generation;
        let answer = cx.background_executor().spawn(gateway.request(
            Method::GET,
            &format!("/ai/usage/{reservation}"),
            None,
            None,
        ));
        let deadline = cx.background_executor().timer(self.hooks.deadline);
        cx.spawn(async move |this, cx| {
            let receipt = match select(answer, deadline).await {
                Either::Left((Ok(value), _)) => parse_usage(&value, &reservation),
                _ => None,
            };
            let _ = this.update(cx, |s, cx| {
                s.receipt_pending = false;
                if generation == s.generation
                    && s.last_reservation.as_ref() == Some(&reservation)
                    && let Some(receipt) = receipt
                {
                    s.last_usage = Some(receipt);
                    cx.notify();
                }
            });
        })
        .detach();
    }

    /// `managed({action: "sign-in"})`: the browser sign-in; a handoff that
    /// cannot start is a sign-in problem, not a billing one.
    pub fn sign_in(&mut self, cx: &mut Context<Self>) {
        self.sign_in_failed = !(self.hooks.sign_in)(cx);
        cx.notify();
    }

    /// Top up with `pack`: the checkout opens in the system browser; the
    /// balance changes only when the service says so.
    pub fn checkout(&mut self, pack: String, cx: &mut Context<Self>) {
        if let Some(store) = &self.backing {
            store.read(cx).service().checkout(pack, |url| {
                let _ = crate::platform::desktop::open_url(&url);
            });
            return;
        }
        let (Some(_), Some(gateway)) = (self.hooks.connect)(cx) else {
            return;
        };
        let Some(catalog) = self.catalog.clone() else {
            return;
        };
        if !catalog.packs.iter().any(|p| p.id == pack) {
            return;
        }
        self.pending = true;
        self.checkout_failed = false;
        cx.notify();
        let answer = cx.background_executor().spawn(gateway.request(
            Method::POST,
            "/ai/checkouts",
            Some(serde_json::json!({"pack_id": pack})),
            Some(uuid::Uuid::new_v4().to_string()),
        ));
        cx.spawn(async move |this, cx| {
            let url = answer
                .await
                .ok()
                .and_then(|v| checkout_url(v["checkout_url"].as_str()?, catalog.sandbox));
            let _ = this.update(cx, |s, cx| {
                s.pending = false;
                match url {
                    Some(url) => (s.hooks.open)(&url),
                    None => s.checkout_failed = true,
                }
                s.refresh(true, cx);
                cx.notify();
            });
        })
        .detach();
    }

    /// Tests: the directory and the last refresh read `by` ago.
    #[cfg(test)]
    pub(crate) fn age(&mut self, by: Duration) {
        let back = |t: &mut Option<Instant>| {
            if let Some(at) = t.as_mut() {
                *at -= by;
            }
        };
        back(&mut self.catalog_at);
        back(&mut self.last_refresh);
    }
}
