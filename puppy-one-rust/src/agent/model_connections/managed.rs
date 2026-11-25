//! Pure-Rust managed compute state machine (`managed-connection.mjs`):
//! concurrent `/ai/catalog` (60s TTL on success only) + `/ai/balance`,
//! idempotent one-time `/ai/trial` claim, 30s deadline with late-answer drop,
//! session-generation isolation, async `/ai/usage/{reservation}` receipts,
//! and Polar-origin-checked `/ai/checkouts`.
use super::configuration::{self, ModelConnection};
use super::snapshot::ManagedComputeSnapshot;
use super::wallet::{
    Balance, Catalog, ErrorCode, Reason, Usage, checkout_url, data, parse_balance, parse_catalog,
    parse_usage,
};
use crate::cloud::auth::{
    Broker,
    model::{ApiRequest, Binding},
};
use reqwest::Method;
use serde_json::{Value, json};
use std::{
    future::Future,
    pin::Pin,
    sync::Arc,
    time::{Duration, Instant},
};

/// `refreshTimeoutMs`: a refresh that has not ended by then fails.
pub const DEADLINE: Duration = Duration::from_secs(30);
/// `catalogTtlMs`: a valid public directory is reused this long.
pub const CATALOG_TTL: Duration = Duration::from_secs(60);
/// Without `force`, the wallet is read at most this often.
pub const REFRESH_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Failed;

pub type Answer = Pin<Box<dyn Future<Output = Result<Value, Failed>> + Send>>;

/// Account session identity used to fence wallet answers and reservations.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManagedSession {
    pub key: String,
    pub user: String,
    pub binding: Option<Binding>,
}
impl ManagedSession {
    pub fn of(binding: Binding) -> Self {
        let key = crate::cloud::auth::reservation::key(&binding);
        let user = binding.user.clone();
        Self {
            key,
            user,
            binding: Some(binding),
        }
    }
}

/// Abstract managed compute gateway (`Broker` in production, scripted double in tests).
pub trait ManagedGateway: Send + Sync {
    fn public(&self, path: &str) -> Answer;
    fn request(
        &self,
        binding: Option<Binding>,
        method: Method,
        path: &str,
        body: Option<Value>,
        idempotency_key: Option<String>,
    ) -> Answer;
}

/// Production gateway backed by `cloud::auth::Broker` (runs blocking Broker
/// calls on tokio's blocking pool so async tasks never stall worker threads).
pub struct BrokerManagedGateway {
    broker: Arc<Broker>,
}
impl BrokerManagedGateway {
    pub fn new(broker: Arc<Broker>) -> Self {
        Self { broker }
    }
}
impl ManagedGateway for BrokerManagedGateway {
    fn public(&self, path: &str) -> Answer {
        let broker = self.broker.clone();
        let path = path.to_owned();
        Box::pin(async move {
            tokio::task::spawn_blocking(move || broker.public(&path).map(data).map_err(|_| Failed))
                .await
                .unwrap_or(Err(Failed))
        })
    }
    fn request(
        &self,
        binding: Option<Binding>,
        method: Method,
        path: &str,
        body: Option<Value>,
        idempotency_key: Option<String>,
    ) -> Answer {
        let broker = self.broker.clone();
        let request = ApiRequest {
            idempotency_key,
            method,
            path: path.to_owned(),
            query: vec![],
            body,
        };
        Box::pin(async move {
            let binding = binding.ok_or(Failed)?;
            tokio::task::spawn_blocking(move || {
                broker
                    .request(&binding, &request)
                    .map(data)
                    .map_err(|_| Failed)
            })
            .await
            .unwrap_or(Err(Failed))
        })
    }
}

/// Outcome of one managed refresh cycle.
pub struct RefreshOutcome {
    pub catalog: Catalog,
    pub fresh_catalog: bool,
    pub balance: Option<Balance>,
    pub claimed: bool,
}

/// What a finished refresh asks to read next: the receipt's generation,
/// user, binding and wait.
pub type ReceiptRead = (u64, String, Option<Binding>, Duration);

/// Pure-Rust managed wallet state machine (held under a Mutex inside
/// [`super::service::ModelConnectionService`]).
pub struct ManagedCore {
    pub session: Option<ManagedSession>,
    pub catalog: Option<Catalog>,
    pub catalog_at: Option<Instant>,
    pub balance: Option<Balance>,
    pub error: Option<ErrorCode>,
    pub pending: bool,
    pub trial_claimed_for: Option<String>,
    pub last_refresh: Option<Instant>,
    pub generation: u64,
    pub last_reservation: Option<String>,
    pub last_usage: Option<Usage>,
    pub receipt_pending: bool,
    pub checkout_failed: bool,
    pub deadline: Duration,
}

impl Default for ManagedCore {
    fn default() -> Self {
        Self {
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
            deadline: DEADLINE,
        }
    }
}

impl ManagedCore {
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

    pub fn error_code(&self) -> Option<ErrorCode> {
        self.error.filter(|_| !self.pending)
    }

    pub fn snapshot(&self) -> ManagedComputeSnapshot {
        let reason = self.reason();
        ManagedComputeSnapshot {
            signed_in: self.session.is_some(),
            available: reason == Reason::Ready,
            reason,
            error_code: self.error_code(),
            catalog: self.catalog.clone(),
            balance: self.balance,
            last_usage: self.last_usage.clone(),
            pending: self.pending,
            trial_credit_micro_usd: self
                .catalog
                .as_ref()
                .map_or(0, |c| c.trial_credit_micro_usd),
            session_key: self.session.as_ref().map(|s| s.key.clone()),
            checkout_failed: self.checkout_failed,
        }
    }

    /// Projects ready managed `ModelConnection` entries with real catalog
    /// `context_window` values (or empty if signed out / unavailable).
    pub fn connections(&self) -> Vec<ModelConnection> {
        let available = self.reason() == Reason::Ready;
        let (Some(session), Some(catalog)) = (self.session.as_ref(), self.catalog.as_ref()) else {
            return vec![];
        };
        let Some(binding) = session.binding.as_ref() else {
            return vec![];
        };
        configuration::managed_connections_for(binding, catalog, available)
    }

    /// Adopts `session`. Returns `true` when the session changed (meaning
    /// account/generation rotated and active managed leases must be revoked).
    pub fn adopt(&mut self, session: Option<ManagedSession>) -> bool {
        let same = match (&self.session, &session) {
            (None, None) => true,
            (Some(a), Some(b)) => a.key == b.key && a.user == b.user,
            _ => false,
        };
        if same {
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
        self.receipt_pending = false;
        self.checkout_failed = false;
        true
    }

    /// Notes a reservation emitted by `model_client` for the current session.
    pub fn note_reservation(
        &mut self,
        session_key: &str,
        reservation_id: &str,
        model_id: &str,
    ) -> bool {
        if !crate::cloud::auth::reservation::valid(reservation_id) {
            return false;
        }
        if self.session.as_ref().map(|s| s.key.as_str()) != Some(session_key) {
            return false;
        }
        if self.last_reservation.as_deref() == Some(reservation_id) {
            return false;
        }
        self.last_reservation = Some(reservation_id.to_owned());
        self.last_usage = Some(Usage::pending(reservation_id, model_id));
        true
    }

    /// Prepares an async refresh if allowed by `force` / throttle / pending.
    pub fn begin_refresh(&mut self, force: bool) -> Option<RefreshPlan> {
        if self.pending
            || (!force
                && self
                    .last_refresh
                    .is_some_and(|t| t.elapsed() < REFRESH_INTERVAL))
        {
            return None;
        }
        if let Some(session) = self.session.as_ref()
            && let Some((id, model)) = crate::cloud::auth::reservation::take(&session.key)
            && self.last_reservation.as_deref() != Some(id.as_str())
        {
            self.last_usage = Some(Usage::pending(&id, &model));
            self.last_reservation = Some(id);
        }
        self.pending = true;
        let user = self.session.as_ref().map(|s| s.user.clone());
        let claim = user
            .clone()
            .filter(|u| self.trial_claimed_for.as_ref() != Some(u));
        let cached_catalog = self
            .catalog
            .clone()
            .filter(|_| self.catalog_at.is_some_and(|t| t.elapsed() < CATALOG_TTL));
        Some(RefreshPlan {
            generation: self.generation,
            user,
            binding: self.session.as_ref().and_then(|s| s.binding.clone()),
            claim_trial: claim.is_some(),
            cached_catalog,
            deadline: self.deadline,
        })
    }

    /// Applies the completed refresh result. Returns `(session_changed_mid_flight, should_read_receipt)`.
    pub fn finish_refresh(
        &mut self,
        generation: u64,
        user: Option<String>,
        ended: Result<RefreshOutcome, ErrorCode>,
    ) -> (bool, Option<ReceiptRead>) {
        self.pending = false;
        if generation != self.generation {
            return (true, None);
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
                let receipt = self.begin_receipt();
                (false, receipt)
            }
            Err(code) => {
                self.error = Some(code);
                self.balance = None;
                (false, None)
            }
        }
    }

    pub fn begin_receipt(&mut self) -> Option<(u64, String, Option<Binding>, Duration)> {
        if self.receipt_pending {
            return None;
        }
        let reservation = self.last_reservation.clone()?;
        let binding = self.session.as_ref().and_then(|s| s.binding.clone());
        self.receipt_pending = true;
        Some((self.generation, reservation, binding, self.deadline))
    }

    pub fn finish_receipt(
        &mut self,
        generation: u64,
        reservation: &str,
        usage: Option<Usage>,
    ) -> bool {
        self.receipt_pending = false;
        if generation == self.generation
            && self.last_reservation.as_deref() == Some(reservation)
            && let Some(usage) = usage
        {
            self.last_usage = Some(usage);
            return true;
        }
        false
    }

    pub fn validate_checkout_pack(&self, pack_id: &str) -> Option<(Option<Binding>, bool)> {
        let session = self.session.as_ref()?;
        let catalog = self.catalog.as_ref()?;
        catalog
            .packs
            .iter()
            .any(|p| p.id == pack_id)
            .then(|| (session.binding.clone(), catalog.sandbox))
    }
}

pub struct RefreshPlan {
    pub generation: u64,
    pub user: Option<String>,
    pub binding: Option<Binding>,
    pub claim_trial: bool,
    pub cached_catalog: Option<Catalog>,
    pub deadline: Duration,
}

/// Runs the concurrent catalog + wallet (+ optional idempotent `/ai/trial`)
/// refresh bounded by `plan.deadline`.
pub async fn run_refresh(
    gateway: Arc<dyn ManagedGateway>,
    plan: RefreshPlan,
) -> Result<RefreshOutcome, ErrorCode> {
    let signed_in = plan.user.is_some();
    let gw_dir = gateway.clone();
    let dir_fut = async move {
        match plan.cached_catalog {
            Some(catalog) => Ok::<_, Failed>((catalog, false)),
            None => {
                let value = gw_dir.public("/ai/catalog").await?;
                parse_catalog(&value).map(|c| (c, true)).ok_or(Failed)
            }
        }
    };
    let gw_bal = gateway.clone();
    let binding_bal = plan.binding.clone();
    let bal_fut = async move {
        if !signed_in {
            return Ok::<_, Failed>(None);
        }
        let value = gw_bal
            .request(binding_bal, Method::GET, "/ai/balance", None, None)
            .await?;
        Ok(Some(value))
    };
    let job = async move {
        let (dir_res, bal_res) = tokio::join!(dir_fut, bal_fut);
        let (catalog, fresh_catalog) = dir_res?;
        let wallet = bal_res?;
        let mut balance = wallet.as_ref().map(parse_balance);
        let mut claimed = false;
        if plan.claim_trial && catalog.trial_credit_micro_usd > 0 {
            if !balance
                .flatten()
                .is_some_and(|b| b.trial_granted_micro_usd > 0)
            {
                let granted = gateway
                    .request(
                        plan.binding,
                        Method::POST,
                        "/ai/trial",
                        Some(json!({})),
                        None,
                    )
                    .await?;
                balance = Some(parse_balance(&granted));
            }
            claimed = true;
        }
        let balance = match balance {
            Some(balance) => Some(balance.ok_or(Failed)?),
            None => None,
        };
        Ok::<_, Failed>(RefreshOutcome {
            catalog,
            fresh_catalog,
            balance,
            claimed,
        })
    };
    match tokio::time::timeout(plan.deadline, job).await {
        Ok(Ok(outcome)) => Ok(outcome),
        Ok(Err(Failed)) => Err(ErrorCode::GatewayUnavailable),
        Err(_) => Err(ErrorCode::Timeout),
    }
}

/// Reads `/ai/usage/{reservation}` bounded by `deadline`.
pub async fn run_receipt(
    gateway: Arc<dyn ManagedGateway>,
    binding: Option<Binding>,
    reservation: String,
    deadline: Duration,
) -> Option<Usage> {
    let path = format!("/ai/usage/{reservation}");
    match tokio::time::timeout(
        deadline,
        gateway.request(binding, Method::GET, &path, None, None),
    )
    .await
    {
        Ok(Ok(value)) => parse_usage(&value, &reservation),
        _ => None,
    }
}

/// Calls `POST /ai/checkouts` with an idempotency key and validates the
/// returned Polar checkout URL origin.
pub async fn run_checkout(
    gateway: Arc<dyn ManagedGateway>,
    binding: Option<Binding>,
    pack_id: String,
    sandbox: bool,
) -> Option<String> {
    let value = gateway
        .request(
            binding,
            Method::POST,
            "/ai/checkouts",
            Some(json!({ "pack_id": pack_id })),
            Some(uuid::Uuid::new_v4().to_string()),
        )
        .await
        .ok()?;
    checkout_url(value["checkout_url"].as_str()?, sandbox)
}
