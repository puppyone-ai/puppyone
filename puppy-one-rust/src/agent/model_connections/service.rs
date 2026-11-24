//! Unified Model Connections & Managed Compute Authority
//! (`connection-service.mjs` + `managed-connection.mjs`):
//! Single Source of Truth owned by `po-agent` (zero GPUI dependency).
//!
//! - Owns saved custom connections, probed catalogs, durable model
//!   verifications, and PuppyOne managed compute wallet state.
//! - Subscribes directly to `cloud::auth::Broker` so sign-in, sign-out,
//!   account switches, trial claims and balance changes propagate without any
//!   UI glue or stale static caches.
//! - Publishes immutable `Arc<ModelConnectionSnapshot>` over
//!   `tokio::sync::watch` for both `AgentHost` (automatic readiness
//!   invalidation) and GPUI views (`ModelConnectionsStore`).
//! - Tracks active session leases with `Cancellation` tokens so deleting a
//!   connection, rotating security-sensitive config, signing out, or
//!   disabling Payments immediately interrupts in-flight inference.
use super::configuration::{self, ModelConnection};
use super::drivers::{self, Candidate, CatalogModel};
use super::managed::{
    BrokerManagedGateway, ManagedCore, ManagedGateway, ManagedSession, run_checkout, run_receipt,
    run_refresh,
};
use super::schema::{connection_error, model_route, parse_model_route};
use super::snapshot::{CatalogStatus, ConnectionCatalog, ModelConnectionSnapshot};
use crate::agent::agent_error::AgentResult;
use crate::cloud::auth::{Broker, Cancellation, model::Binding};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::sync::watch;

/// Shared lightweight tokio runtime for background model-connection I/O
/// (mirrors `cloud::auth::http::runtime()`).
fn background_runtime() -> &'static tokio::runtime::Runtime {
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("puppyone-model-connections")
            .enable_all()
            .build()
            .expect("model connections tokio runtime")
    })
}

/// One active Built-in Agent session lease.
struct ActiveLease {
    connection_id: String,
    security_generation: String,
    managed: bool,
    cancel: Cancellation,
}

struct ServiceState {
    revision: u64,
    payments_enabled: bool,
    connections: Vec<ModelConnection>,
    catalogs: HashMap<String, ConnectionCatalog>,
    managed: ManagedCore,
}

impl ServiceState {
    fn build_snapshot(&self) -> Arc<ModelConnectionSnapshot> {
        let managed = self.managed.snapshot();
        let managed_connections = if self.payments_enabled && managed.available {
            self.managed.connections()
        } else {
            vec![]
        };
        Arc::new(ModelConnectionSnapshot {
            revision: self.revision,
            payments_enabled: self.payments_enabled,
            connections: self.connections.clone(),
            catalogs: self.catalogs.clone(),
            managed,
            managed_connections,
        })
    }
}

/// Process-wide authority for custom model connections, PuppyOne managed
/// compute, and Built-in Agent session leases.
pub struct ModelConnectionService {
    data_dir: PathBuf,
    broker: Option<Arc<Broker>>,
    gateway: Option<Arc<dyn ManagedGateway>>,
    state: Mutex<ServiceState>,
    leases: Mutex<HashMap<String, ActiveLease>>,
    tx: watch::Sender<Arc<ModelConnectionSnapshot>>,
}

impl ModelConnectionService {
    /// Production constructor: loads saved connections from `data_dir`,
    /// subscribes to `broker` (when Cloud is configured), and triggers
    /// initial catalog probes & managed refresh.
    pub fn new(data_dir: PathBuf, broker: Option<Arc<Broker>>) -> Arc<Self> {
        let gateway: Option<Arc<dyn ManagedGateway>> = broker
            .as_ref()
            .map(|b| Arc::new(BrokerManagedGateway::new(b.clone())) as Arc<dyn ManagedGateway>);
        let service = Self::with_gateway(data_dir, broker.clone(), gateway, managed_deadline());
        if let Some(broker) = broker {
            // Adopt initial binding synchronously so there is no blank frame.
            let initial = broker.signed_in_binding().map(ManagedSession::of);
            {
                let mut state = service.state.lock().unwrap();
                state.managed.adopt(initial);
                state.revision += 1;
                let snap = state.build_snapshot();
                service.tx.send_replace(snap);
            }
            let mut updates = broker.subscribe();
            let weak = Arc::downgrade(&service);
            background_runtime().spawn(async move {
                while updates.changed().await.is_ok() {
                    let Some(service) = weak.upgrade() else {
                        break;
                    };
                    let binding = updates
                        .borrow_and_update()
                        .account
                        .as_ref()
                        .map(|a| a.binding.clone());
                    service.adopt_broker_binding(binding);
                }
            });
            service.refresh_managed(false);
        }
        // Warm custom connection catalogs off-thread so Ollama/LM Studio
        // tool-capable models become available immediately on startup.
        let ids: Vec<String> = service
            .state
            .lock()
            .unwrap()
            .connections
            .iter()
            .map(|c| c.id.clone())
            .collect();
        for id in ids {
            service.spawn_refresh_connection(id);
        }
        service
    }

    /// Headless constructor (used by `new` and pure-Rust unit tests with a
    /// scripted [`ManagedGateway`]).
    pub fn with_gateway(
        data_dir: PathBuf,
        broker: Option<Arc<Broker>>,
        gateway: Option<Arc<dyn ManagedGateway>>,
        deadline: Duration,
    ) -> Arc<Self> {
        let connections = configuration::load_at(&data_dir).unwrap_or_default();
        let mut managed = ManagedCore::default();
        managed.deadline = deadline;
        let state = ServiceState {
            revision: 1,
            payments_enabled: false,
            connections,
            catalogs: HashMap::new(),
            managed,
        };
        let initial = state.build_snapshot();
        let (tx, _) = watch::channel(initial);
        Arc::new(Self {
            data_dir,
            broker,
            gateway,
            state: Mutex::new(state),
            leases: Mutex::new(HashMap::new()),
            tx,
        })
    }

    /// Current immutable snapshot.
    pub fn snapshot(&self) -> Arc<ModelConnectionSnapshot> {
        self.tx.borrow().clone()
    }

    /// Watch stream of every snapshot revision.
    pub fn subscribe(&self) -> watch::Receiver<Arc<ModelConnectionSnapshot>> {
        self.tx.subscribe()
    }

    fn publish_locked(&self, state: &mut ServiceState) -> Arc<ModelConnectionSnapshot> {
        state.revision += 1;
        let snap = state.build_snapshot();
        self.tx.send_replace(snap.clone());
        snap
    }

    /// Updates `experimental.payments`. Disabling immediately revokes active
    /// managed leases; enabling triggers a wallet refresh if signed in.
    pub fn set_payments(self: &Arc<Self>, enabled: bool) {
        let changed = {
            let mut state = self.state.lock().unwrap();
            if state.payments_enabled == enabled {
                false
            } else {
                state.payments_enabled = enabled;
                self.publish_locked(&mut state);
                true
            }
        };
        if !changed {
            return;
        }
        if !enabled {
            self.revoke_managed_leases();
        } else {
            self.refresh_managed(false);
        }
    }

    /// Adopts a new account binding (from `Broker::subscribe()` or tests).
    /// Changing session immediately revokes all active managed leases and
    /// triggers a wallet refresh.
    pub fn adopt_broker_binding(self: &Arc<Self>, binding: Option<Binding>) {
        self.adopt_session(binding.map(ManagedSession::of));
    }

    pub fn adopt_session(self: &Arc<Self>, session: Option<ManagedSession>) {
        let changed = {
            let mut state = self.state.lock().unwrap();
            if state.managed.adopt(session) {
                self.publish_locked(&mut state);
                true
            } else {
                false
            }
        };
        if changed {
            self.revoke_managed_leases();
            self.refresh_managed(false);
        }
    }

    /// Triggers an asynchronous refresh of `/ai/catalog`, `/ai/balance`,
    /// optional `/ai/trial`, and `/ai/usage/{reservation}`.
    pub fn refresh_managed(self: &Arc<Self>, force: bool) {
        let Some(gateway) = self.gateway.clone() else {
            return;
        };
        let plan = {
            let mut state = self.state.lock().unwrap();
            let plan = state.managed.begin_refresh(force);
            if plan.is_some() {
                self.publish_locked(&mut state);
            }
            plan
        };
        let Some(plan) = plan else {
            return;
        };
        let service = self.clone();
        background_runtime().spawn(async move {
            service.drive_refresh(gateway, plan).await;
        });
    }

    async fn drive_refresh(
        self: &Arc<Self>,
        gateway: Arc<dyn ManagedGateway>,
        mut plan: super::managed::RefreshPlan,
    ) {
        loop {
            let generation = plan.generation;
            let user = plan.user.clone();
            let outcome = run_refresh(gateway.clone(), plan).await;
            let (next_plan, receipt_job) = {
                let mut state = self.state.lock().unwrap();
                let (rerun, receipt_job) = state.managed.finish_refresh(generation, user, outcome);
                let next_plan = if rerun {
                    state.managed.begin_refresh(true)
                } else {
                    None
                };
                self.publish_locked(&mut state);
                (next_plan, receipt_job)
            };
            if let Some(next) = next_plan {
                plan = next;
                continue;
            }
            if let Some((generation, reservation, binding, deadline)) = receipt_job {
                let usage = run_receipt(gateway, binding, reservation.clone(), deadline).await;
                let mut state = self.state.lock().unwrap();
                if state.managed.finish_receipt(generation, &reservation, usage) {
                    self.publish_locked(&mut state);
                }
            }
            break;
        }
    }

    /// Synchronous refresh helper for tests running on a tokio runtime.
    pub async fn refresh_managed_now(self: &Arc<Self>, force: bool) {
        let Some(gateway) = self.gateway.clone() else {
            return;
        };
        let mut updates = self.subscribe();
        let plan = loop {
            while updates.borrow_and_update().managed.pending {
                if updates.changed().await.is_err() {
                    return;
                }
            }
            let mut state = self.state.lock().unwrap();
            if state.managed.pending {
                continue;
            }
            let plan = state.managed.begin_refresh(force);
            if plan.is_some() {
                self.publish_locked(&mut state);
            }
            break plan;
        };
        if let Some(plan) = plan {
            self.drive_refresh(gateway, plan).await;
        }
    }

    /// Called by `model_client` when a managed stream receives its reservation
    /// header (`StreamEvent::Reservation`).
    pub fn note_managed_reservation(&self, binding: &Binding, reservation_id: &str, model_id: &str) {
        let key = crate::cloud::auth::reservation::key(binding);
        crate::cloud::auth::reservation::note(binding, reservation_id, model_id);
        let mut state = self.state.lock().unwrap();
        if state
            .managed
            .note_reservation(&key, reservation_id, model_id)
        {
            self.publish_locked(&mut state);
        }
    }

    /// Called by `model_client` once a managed stream ends (succeeded,
    /// errored, or cancelled) so balance & usage receipt refresh immediately.
    pub fn on_managed_inference_finished(self: &Arc<Self>) {
        self.refresh_managed(true);
    }

    /// Starts a Polar checkout for `pack_id`, invoking `open_url` only if the
    /// server returns an origin-verified Polar HTTPS URL.
    pub fn checkout(self: &Arc<Self>, pack_id: String, open_url: impl FnOnce(String) + Send + 'static) {
        let Some(gateway) = self.gateway.clone() else {
            return;
        };
        let validated = {
            let mut state = self.state.lock().unwrap();
            let v = state.managed.validate_checkout_pack(&pack_id);
            if v.is_some() {
                state.managed.pending = true;
                state.managed.checkout_failed = false;
                self.publish_locked(&mut state);
            }
            v
        };
        let Some((binding, sandbox)) = validated else {
            return;
        };
        let service = self.clone();
        background_runtime().spawn(async move {
            let url = run_checkout(gateway, binding, pack_id, sandbox).await;
            {
                let mut state = service.state.lock().unwrap();
                state.managed.pending = false;
                if url.is_none() {
                    state.managed.checkout_failed = true;
                }
                service.publish_locked(&mut state);
            }
            if let Some(url) = url {
                open_url(url);
            }
            service.refresh_managed(true);
        });
    }

    /// Reloads custom connections from disk and publishes a fresh snapshot.
    pub fn reload_saved(&self) -> Result<Vec<ModelConnection>, String> {
        let loaded = configuration::load_at(&self.data_dir)?;
        let mut state = self.state.lock().unwrap();
        state.connections = loaded.clone();
        let valid_ids: std::collections::HashSet<String> =
            state.connections.iter().map(|c| c.id.clone()).collect();
        state.catalogs.retain(|id, _| valid_ids.contains(id));
        self.publish_locked(&mut state);
        Ok(loaded)
    }

    /// Saves a custom connection. If security-sensitive fields changed, active
    /// session leases for this connection are immediately cancelled.
    pub fn save(
        self: &Arc<Self>,
        connection: ModelConnection,
        secret: Option<String>,
    ) -> Result<Vec<ModelConnection>, String> {
        let (saved, security_changed) =
            configuration::save_at(&self.data_dir, connection, secret)?;
        let id = saved.id.clone();
        let all = configuration::load_at(&self.data_dir)?;
        {
            let mut state = self.state.lock().unwrap();
            state.connections = all.clone();
            if security_changed {
                state.catalogs.remove(&id);
            } else if let Some(cat) = state.catalogs.get_mut(&id) {
                cat.config_generation = saved.generation.clone();
            }
            self.publish_locked(&mut state);
        }
        if security_changed {
            self.revoke_connection_leases(&id);
        }
        self.spawn_refresh_connection(id);
        Ok(all)
    }

    /// Removes a custom connection and immediately cancels its active leases.
    pub fn remove(&self, id: &str, generation: &str) -> Result<Vec<ModelConnection>, String> {
        configuration::remove_at(&self.data_dir, id, generation)?;
        let all = configuration::load_at(&self.data_dir)?;
        {
            let mut state = self.state.lock().unwrap();
            state.connections = all.clone();
            state.catalogs.remove(id);
            self.publish_locked(&mut state);
        }
        self.revoke_connection_leases(id);
        Ok(all)
    }

    /// Probes the local Ollama / LM Studio loopback candidates.
    pub async fn discover_local(&self) -> Vec<Candidate> {
        drivers::discover_local().await
    }

    /// Refreshes one saved connection's model catalog in the background.
    pub fn spawn_refresh_connection(self: &Arc<Self>, id: String) {
        let service = self.clone();
        background_runtime().spawn(async move {
            let _ = service.refresh_connection(&id).await;
        });
    }

    /// Fetches one saved connection's catalog, retaining prior models as
    /// `Stale` if a subsequent refresh fails (Connection Rules).
    pub async fn refresh_connection(&self, id: &str) -> Result<Vec<CatalogModel>, String> {
        let conn = {
            let mut state = self.state.lock().unwrap();
            let Some(conn) = state.connections.iter().find(|c| c.id == id).cloned() else {
                return Err("CONNECTION_NOT_FOUND".into());
            };
            let entry = state
                .catalogs
                .entry(id.to_owned())
                .or_insert_with(|| ConnectionCatalog {
                    connection_id: id.to_owned(),
                    config_generation: conn.generation.clone(),
                    status: CatalogStatus::Idle,
                    models: vec![],
                    error_code: None,
                });
            entry.config_generation = conn.generation.clone();
            entry.status = CatalogStatus::Refreshing;
            self.publish_locked(&mut state);
            conn
        };
        let result = async {
            let client = drivers::metadata_client()?;
            let key = conn.credential().ok().flatten();
            drivers::list_models(&client, &conn, key.as_deref()).await
        }
        .await;
        let mut state = self.state.lock().unwrap();
        let still_current = state
            .connections
            .iter()
            .any(|c| c.id == conn.id && c.generation == conn.generation);
        if !still_current {
            return Err("CONFIGURATION_CONFLICT".into());
        }
        match &result {
            Ok(models) => {
                state.catalogs.insert(
                    conn.id.clone(),
                    ConnectionCatalog {
                        connection_id: conn.id.clone(),
                        config_generation: conn.generation.clone(),
                        status: CatalogStatus::Ready,
                        models: models.clone(),
                        error_code: None,
                    },
                );
            }
            Err(code) => {
                let previous = state.catalogs.get(&conn.id).cloned();
                let had_models = previous.as_ref().is_some_and(|p| !p.models.is_empty());
                state.catalogs.insert(
                    conn.id.clone(),
                    ConnectionCatalog {
                        connection_id: conn.id.clone(),
                        config_generation: conn.generation.clone(),
                        status: if had_models {
                            CatalogStatus::Stale
                        } else {
                            CatalogStatus::Failed
                        },
                        models: previous.map(|p| p.models).unwrap_or_default(),
                        error_code: Some(code.clone()),
                    },
                );
            }
        }
        self.publish_locked(&mut state);
        result
    }

    /// Runs the 60s tool round-trip check for `(id, model_id)` and persists
    /// durable verification evidence at the current `security_generation`.
    pub async fn verify_model(
        self: &Arc<Self>,
        id: &str,
        model_id: &str,
    ) -> Result<(), String> {
        let mut conn = {
            let state = self.state.lock().unwrap();
            state
                .connections
                .iter()
                .find(|c| c.id == id)
                .cloned()
                .ok_or_else(|| "CONNECTION_NOT_FOUND".to_owned())?
        };
        let expected_sec_gen = conn.security_gen().to_owned();
        conn.model = model_id.to_owned();
        tokio::time::timeout(
            Duration::from_secs(60),
            crate::agent::runtimes::puppyone_agent::verify(&conn, self.as_ref()),
        )
        .await
        .map_err(|_| "TIMEOUT".to_owned())??;
        let updated = configuration::record_verification_at(
            &self.data_dir,
            id,
            model_id,
            &expected_sec_gen,
        )?;
        let mut state = self.state.lock().unwrap();
        if let Some(slot) = state.connections.iter_mut().find(|c| c.id == id) {
            *slot = updated;
        }
        self.publish_locked(&mut state);
        Ok(())
    }

    /// Cancels and removes all active leases belonging to `connection_id`.
    pub fn revoke_connection_leases(&self, connection_id: &str) {
        let revoked: Vec<Cancellation> = {
            let mut leases = self.leases.lock().unwrap();
            let ids: Vec<String> = leases
                .iter()
                .filter(|(_, l)| l.connection_id == connection_id)
                .map(|(k, _)| k.clone())
                .collect();
            ids.into_iter()
                .filter_map(|k| leases.remove(&k).map(|l| l.cancel))
                .collect()
        };
        for cancel in revoked {
            cancel.cancel();
        }
    }

    /// Cancels and removes all active managed compute leases.
    pub fn revoke_managed_leases(&self) {
        let revoked: Vec<Cancellation> = {
            let mut leases = self.leases.lock().unwrap();
            let ids: Vec<String> = leases
                .iter()
                .filter(|(_, l)| l.managed)
                .map(|(k, _)| k.clone())
                .collect();
            ids.into_iter()
                .filter_map(|k| leases.remove(&k).map(|l| l.cancel))
                .collect()
        };
        for cancel in revoked {
            cancel.cancel();
        }
    }

    /// Acquires a session lease for `route` (or the first eligible connection).
    pub fn acquire_lease(&self, route: Option<&str>) -> AgentResult<Value> {
        let connections = self.snapshot().agent_connections();
        let selected = match route {
            Some(route) => {
                let parsed = parse_model_route(Some(route))?;
                connections
                    .iter()
                    .find(|c| {
                        crate::agent::runtimes::puppyone_agent::native_model_connections::product_connection_id(&c.id)
                            == parsed.connection_id
                            && c.model == parsed.model_id
                    })
                    .ok_or_else(|| connection_error("MODEL_UNAVAILABLE"))?
            }
            None => connections
                .first()
                .ok_or_else(|| connection_error("CONNECTION_UNAVAILABLE"))?,
        };
        let prod_id =
            crate::agent::runtimes::puppyone_agent::native_model_connections::product_connection_id(
                &selected.id,
            );
        model_route(&prod_id, &selected.model)?;
        let members: Vec<&ModelConnection> = connections
            .iter()
            .filter(|c| c.id == selected.id)
            .collect();
        let lease_id = uuid::Uuid::new_v4().to_string();
        let cancel = Cancellation::default();
        self.leases.lock().unwrap().insert(
            lease_id.clone(),
            ActiveLease {
                connection_id: selected.id.clone(),
                security_generation: selected.security_gen().to_owned(),
                managed: selected.managed,
                cancel,
            },
        );
        let mut config =
            crate::agent::runtimes::puppyone_agent::native_model_connections::lease_configuration(
                &members, selected,
            );
        config["leaseId"] = Value::from(lease_id.clone());
        Ok(json!({
            "leaseId": lease_id,
            "configuration": config,
        }))
    }

    /// Validates an active lease against current snapshot & security generation.
    pub fn validate_lease(&self, lease_id: &str, route: Option<&str>) -> AgentResult<()> {
        let (connection_id, security_generation) = {
            let leases = self.leases.lock().unwrap();
            let Some(lease) = leases.get(lease_id) else {
                return Err(connection_error("LEASE_REVOKED"));
            };
            if lease.cancel.is_cancelled() {
                return Err(connection_error("LEASE_REVOKED"));
            }
            (lease.connection_id.clone(), lease.security_generation.clone())
        };
        let connections = self.snapshot().agent_connections();
        let current = connections.iter().find(|c| c.id == connection_id);
        match current {
            Some(c) if c.security_gen() == security_generation => {}
            Some(_) => return Err(connection_error("MODEL_BINDING_CHANGED")),
            None => return Err(connection_error("CONNECTION_UNAVAILABLE")),
        }
        if let Some(route) = route {
            let parsed = parse_model_route(Some(route))?;
            if !connections.iter().any(|c| {
                c.id == connection_id
                    && crate::agent::runtimes::puppyone_agent::native_model_connections::product_connection_id(&c.id)
                        == parsed.connection_id
                    && c.model == parsed.model_id
            }) {
                return Err(connection_error("MODEL_UNAVAILABLE"));
            }
        }
        Ok(())
    }

    /// Releases a lease without erroring if already revoked.
    pub fn release_lease(&self, lease_id: &str) {
        if let Some(lease) = self.leases.lock().unwrap().remove(lease_id) {
            lease.cancel.cancel();
        }
    }

    /// Returns the `Cancellation` token for `lease_id` so an in-flight turn or
    /// HTTP stream aborts immediately when the lease is revoked.
    pub fn lease_cancellation(&self, lease_id: &str) -> Option<Cancellation> {
        self.leases
            .lock()
            .unwrap()
            .get(lease_id)
            .map(|l| l.cancel.clone())
    }

    /// Test helper: injects a probed catalog observation directly into state.
    #[cfg(any(test, feature = "test-support"))]
    pub fn set_catalog_for_test(&self, catalog: ConnectionCatalog) {
        let mut state = self.state.lock().unwrap();
        state.catalogs.insert(catalog.connection_id.clone(), catalog);
        self.publish_locked(&mut state);
    }

    /// Test helper: checks how many active leases remain.
    #[cfg(any(test, feature = "test-support"))]
    pub fn active_lease_count(&self) -> usize {
        self.leases.lock().unwrap().len()
    }
}

impl super::ComputeAccount for ModelConnectionService {
    fn current(&self) -> Option<(Arc<Broker>, Binding)> {
        let payments = self.state.lock().unwrap().payments_enabled;
        if !payments {
            return None;
        }
        let broker = self.broker.as_ref()?;
        let binding = broker.signed_in_binding()?;
        Some((broker.clone(), binding))
    }

    fn note_reservation(&self, binding: &Binding, reservation_id: &str, model_id: &str) {
        self.note_managed_reservation(binding, reservation_id, model_id);
    }
}

fn managed_deadline() -> Duration {
    super::managed::DEADLINE
}

/// Optional helper to expose `on_managed_inference_finished` through a trait
/// object without coupling `model_client` directly to `Arc<ModelConnectionService>`.
pub trait ManagedCompletionObserver: Send + Sync {
    fn on_finished(&self);
}
impl ManagedCompletionObserver for ModelConnectionService {
    fn on_finished(&self) {
        let _ = self;
    }
}

/// Wrapper implementing [`super::ComputeAccount`] over `Arc<ModelConnectionService>`
/// so `model_client` notifies the service when a managed stream ends.
pub struct ServiceComputeAccount(pub Arc<ModelConnectionService>);
impl super::ComputeAccount for ServiceComputeAccount {
    fn current(&self) -> Option<(Arc<Broker>, Binding)> {
        self.0.current()
    }
    fn note_reservation(&self, binding: &Binding, reservation_id: &str, model_id: &str) {
        self.0.note_managed_reservation(binding, reservation_id, model_id);
    }
    fn on_inference_finished(&self) {
        self.0.on_managed_inference_finished();
    }
}

/// Resolves the [`ModelConnection`] authorized by a lease configuration from
/// `service`'s authoritative snapshot.
pub fn resolve_from_service(
    service: &ModelConnectionService,
    configuration: &Value,
    model_id: &str,
) -> AgentResult<ModelConnection> {
    if let Some(lease_id) = configuration["leaseId"].as_str() {
        let revoked = service
            .lease_cancellation(lease_id)
            .is_none_or(|c| c.is_cancelled());
        if revoked {
            return Err(connection_error("LEASE_REVOKED"));
        }
    }
    let connections = service.snapshot().agent_connections();
    crate::agent::runtimes::puppyone_agent::native_model_connections::resolve_leased_connection(
        configuration,
        model_id,
        &connections,
    )
}
