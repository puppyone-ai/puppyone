//! GPUI global projection over [`crate::agent::model_connections::ModelConnectionService`].
//!
//! Owns zero domain logic, zero HTTP requests, and zero lease state: it simply
//! watches the `po-agent` authority's `watch::Receiver<Arc<ModelConnectionSnapshot>>`
//! and notifies observing GPUI views whenever the snapshot revision advances.
use crate::agent::model_connections::{
    ModelConnectionService, ModelConnectionSnapshot,
};
use crate::cloud::auth::Broker;
use gpui::*;
use std::sync::Arc;

struct StoreGlobal(Entity<ModelConnectionsStore>);
impl Global for StoreGlobal {}

pub struct ModelConnectionsStore {
    service: Arc<ModelConnectionService>,
    snapshot: Arc<ModelConnectionSnapshot>,
}

impl ModelConnectionsStore {
    fn attach(service: Arc<ModelConnectionService>, cx: &mut Context<Self>) -> Self {
        let mut updates = service.subscribe();
        let snapshot = updates.borrow_and_update().clone();
        cx.spawn(async move |this, cx| {
            while updates.changed().await.is_ok() {
                let next = updates.borrow_and_update().clone();
                if this
                    .update(cx, |s, cx| {
                        s.snapshot = next;
                        cx.notify();
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        Self { service, snapshot }
    }

    pub fn service(&self) -> Arc<ModelConnectionService> {
        self.service.clone()
    }

    pub fn snapshot(&self) -> Arc<ModelConnectionSnapshot> {
        self.snapshot.clone()
    }

    pub fn set_payments(&self, enabled: bool) {
        self.service.set_payments(enabled);
    }

    pub fn refresh_managed(&self, force: bool) {
        self.service.refresh_managed(force);
    }

    pub fn reload_saved(&self, cx: &mut Context<Self>) {
        let service = self.service.clone();
        cx.background_executor()
            .spawn(async move {
                let _ = service.reload_saved();
            })
            .detach();
    }
}

/// Installs the process-wide model-connections authority backed by `broker`
/// (called once at app startup right after `features::cloud::account::install`).
pub fn install(broker: Option<Arc<Broker>>, cx: &mut App) -> Entity<ModelConnectionsStore> {
    let service = ModelConnectionService::new(crate::platform::data_dir(), broker);
    install_entity(service, cx)
}

fn install_entity(
    service: Arc<ModelConnectionService>,
    cx: &mut App,
) -> Entity<ModelConnectionsStore> {
    let entity = cx.new(|cx| ModelConnectionsStore::attach(service, cx));
    cx.set_global(StoreGlobal(entity.clone()));
    entity
}

/// Tests: install a store backed by a scripted [`ModelConnectionService`].
#[cfg(test)]
pub(crate) fn install_service(
    service: Arc<ModelConnectionService>,
    cx: &mut App,
) -> Entity<ModelConnectionsStore> {
    install_entity(service, cx)
}

/// The process-wide store, lazily installed if not yet initialized.
pub fn global(cx: &mut App) -> Entity<ModelConnectionsStore> {
    if let Some(store) = cx.try_global::<StoreGlobal>() {
        return store.0.clone();
    }
    let broker = crate::features::cloud::account::broker(cx);
    install(broker, cx)
}

/// Shared handle to the underlying `po-agent` [`ModelConnectionService`].
pub fn service(cx: &mut App) -> Arc<ModelConnectionService> {
    global(cx).read(cx).service()
}

/// Current snapshot if the store is installed.
pub fn snapshot(cx: &App) -> Option<Arc<ModelConnectionSnapshot>> {
    cx.try_global::<StoreGlobal>()
        .map(|store| store.0.read(cx).snapshot())
}

/// Propagates `experimental.payments` into the unified authority.
pub fn set_payments(enabled: bool, cx: &mut App) {
    global(cx).read(cx).set_payments(enabled);
}

/// Triggers a throttled (or forced) PuppyOne managed compute refresh.
pub fn refresh_managed(force: bool, cx: &mut App) {
    if let Some(store) = cx.try_global::<StoreGlobal>() {
        store.0.read(cx).refresh_managed(force);
    }
}

/// Reloads saved custom connections from disk on a background worker.
pub fn reload_saved(cx: &mut App) {
    if let Some(store) = cx.try_global::<StoreGlobal>().map(|s| s.0.clone()) {
        store.update(cx, |s, cx| s.reload_saved(cx));
    }
}
