//! Per-workspace single-slot standby handover and bounded model-catalog cache
//! for the local Codex app-server (ADR-024).
//!
//! Invariants:
//! - Never multiplexes live sessions: a parked connection is always thread-less,
//!   idle, and handed over with 100% exclusive ownership to at most one session.
//! - Once claimed, the slot is immediately empty and this pool retains no handle
//!   to the connection or its child process.
//! - Authentication (`account/read`) is never cached here; only the normalized
//!   model catalog is cached so slow upstream `model/list` network timeouts do
//!   not stall session creation.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::tasks::spawn_after;
use crate::agent::transports::jsonl_rpc_connection::ConnectionEvent;
use crate::agent::transports::rpc_connection::RpcConnection;
use futures_util::future::join_all;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::task::JoinHandle;

/// Default idle lifetime of a parked standby Codex process.
pub const DEFAULT_IDLE_TTL_MS: u64 = 60_000;
/// Maximum number of parked standby Codex processes across workspaces.
pub const DEFAULT_MAX_SLOTS: usize = 4;
/// Fast-path wait for live `model/list` when a cached model catalog exists.
pub const DEFAULT_FAST_MODEL_LIST_TIMEOUT_MS: u64 = 1_200;

const MODEL_CACHE_SCHEMA_VERSION: u64 = 1;
const MAX_MODEL_CACHE_BYTES: u64 = 512 * 1024;
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(1);

type StandbyKey = (String, String);

struct StandbySlot {
    id: u64,
    key: StandbyKey,
    connection: Rc<dyn RpcConnection>,
    listener_id: u64,
    timer: JoinHandle<()>,
}

impl StandbySlot {
    fn dispose_now(self, reason: &str) {
        self.timer.abort();
        self.connection.off(self.listener_id);
        self.connection.dispose(reason, true);
    }
}

struct StandbyInner {
    idle_ttl: Duration,
    max_slots: usize,
    model_cache_path: Option<PathBuf>,
    slots: RefCell<Vec<StandbySlot>>,
    next_slot_id: Cell<u64>,
    disposed: Cell<bool>,
    cached_models: RefCell<Option<Vec<Value>>>,
}

impl Drop for StandbyInner {
    fn drop(&mut self) {
        let slots = std::mem::take(self.slots.get_mut());
        for slot in slots {
            slot.dispose_now("Codex standby pool dropped.");
        }
    }
}

/// Per-workspace single-slot standby handover pool + model-catalog cache.
#[derive(Clone)]
pub struct CodexStandbyPool(Rc<StandbyInner>);

impl CodexStandbyPool {
    /// Creates a pool with production defaults (60s idle TTL, 4 max slots) and
    /// an optional on-disk model-catalog cache path.
    pub fn new(model_cache_path: Option<PathBuf>) -> Self {
        Self::with_options(
            Duration::from_millis(DEFAULT_IDLE_TTL_MS),
            DEFAULT_MAX_SLOTS,
            model_cache_path,
        )
    }

    /// Creates a pool with explicit TTL, slot cap, and optional disk cache path.
    pub fn with_options(
        idle_ttl: Duration,
        max_slots: usize,
        model_cache_path: Option<PathBuf>,
    ) -> Self {
        let initial_models = model_cache_path
            .as_deref()
            .and_then(load_model_cache_from_disk);
        Self(Rc::new(StandbyInner {
            idle_ttl,
            max_slots,
            model_cache_path,
            slots: RefCell::new(Vec::new()),
            next_slot_id: Cell::new(0),
            disposed: Cell::new(false),
            cached_models: RefCell::new(initial_models),
        }))
    }

    /// Parks a healthy, initialized, thread-less Codex connection for exclusive
    /// handover to the next session in the same `(executable_path, workspace_root)`.
    ///
    /// Returns `true` if parked, or `false` if rejected (in which case this
    /// method has already initiated `connection.dispose(...)`).
    pub fn park(
        &self,
        executable_path: &str,
        workspace_root: &str,
        connection: Rc<dyn RpcConnection>,
    ) -> bool {
        let inner = &self.0;
        if inner.disposed.get() || inner.max_slots == 0 || connection.closed() {
            connection.dispose("Codex standby pool unavailable.", true);
            return false;
        }
        let key = (executable_path.to_string(), workspace_root.to_string());
        // Replace any older parked slot for the same workspace/binary first.
        let replaced = {
            let mut slots = inner.slots.borrow_mut();
            slots
                .iter()
                .position(|slot| slot.key == key)
                .map(|index| slots.remove(index))
        };
        if let Some(previous) = replaced {
            previous.dispose_now("Codex standby slot replaced.");
        }
        // Enforce the global standby cap with FIFO/LRU eviction.
        loop {
            let evicted = {
                let mut slots = inner.slots.borrow_mut();
                if slots.len() >= inner.max_slots {
                    Some(slots.remove(0))
                } else {
                    None
                }
            };
            match evicted {
                Some(slot) => slot.dispose_now("Codex standby capacity limit reached."),
                None => break,
            }
        }
        let slot_id = inner.next_slot_id.get() + 1;
        inner.next_slot_id.set(slot_id);
        let weak = Rc::downgrade(inner);
        let conn_for_listener = Rc::downgrade(&connection);
        let listener_id = connection.on(Rc::new(move |event| match event {
            ConnectionEvent::Request(message) => {
                if let Some(id) = message.get("id").filter(|id| !id.is_null())
                    && let Some(conn) = conn_for_listener.upgrade()
                {
                    let _ = conn.respond_error(
                        id.clone(),
                        -32601,
                        "Standby Codex connection has no active session.",
                    );
                }
            }
            ConnectionEvent::Exit(_) => {
                if let Some(inner) = weak.upgrade() {
                    let removed = {
                        let mut slots = inner.slots.borrow_mut();
                        slots
                            .iter()
                            .position(|slot| slot.id == slot_id)
                            .map(|index| slots.remove(index))
                    };
                    if let Some(slot) = removed {
                        slot.timer.abort();
                        slot.connection.off(slot.listener_id);
                    }
                }
            }
            ConnectionEvent::Notification(_) | ConnectionEvent::ProtocolError(_) => {}
        }));
        let weak_for_timer = Rc::downgrade(inner);
        let timer = spawn_after(inner.idle_ttl, move || {
            let Some(inner) = weak_for_timer.upgrade() else {
                return;
            };
            let expired = {
                let mut slots = inner.slots.borrow_mut();
                slots
                    .iter()
                    .position(|slot| slot.id == slot_id)
                    .map(|index| slots.remove(index))
            };
            if let Some(slot) = expired {
                slot.connection.off(slot.listener_id);
                slot.connection
                    .dispose("Codex standby connection idle timeout.", true);
            }
        });
        inner.slots.borrow_mut().push(StandbySlot {
            id: slot_id,
            key,
            connection,
            listener_id,
            timer,
        });
        true
    }

    /// Atomically claims sole ownership of a parked connection for
    /// `(executable_path, workspace_root)`. Once returned, the standby slot is
    /// empty and its standby listener and idle timer are removed.
    pub fn claim(
        &self,
        executable_path: &str,
        workspace_root: &str,
    ) -> Option<Rc<dyn RpcConnection>> {
        let inner = &self.0;
        if inner.disposed.get() {
            return None;
        }
        let slot = {
            let mut slots = inner.slots.borrow_mut();
            slots
                .iter()
                .position(|slot| slot.key.0 == executable_path && slot.key.1 == workspace_root)
                .map(|index| slots.remove(index))
        }?;
        slot.timer.abort();
        slot.connection.off(slot.listener_id);
        if slot.connection.closed() {
            return None;
        }
        Some(slot.connection)
    }

    /// Evicts and terminates every currently parked standby connection without
    /// permanently closing the pool (used on explicit runtime refresh so stale
    /// binaries or environments are never handed over).
    pub fn evict_all(&self) {
        let slots = std::mem::take(&mut *self.0.slots.borrow_mut());
        for slot in slots {
            slot.dispose_now("Codex standby cache invalidated.");
        }
    }

    /// Permanently closes the pool, disposes every parked standby connection,
    /// and waits for all of their child processes to exit.
    pub async fn dispose_all(&self) -> AgentResult<()> {
        self.0.disposed.set(true);
        let slots = std::mem::take(&mut *self.0.slots.borrow_mut());
        let connections: Vec<Rc<dyn RpcConnection>> = slots
            .into_iter()
            .map(|slot| {
                slot.timer.abort();
                slot.connection.off(slot.listener_id);
                slot.connection
                    .dispose("Codex standby pool disposed.", true);
                slot.connection
            })
            .collect();
        let results = join_all(connections.iter().map(|c| c.wait_for_exit())).await;
        if results.iter().any(Result::is_err) {
            return Err(AgentError::new(
                "One or more standby Codex processes failed to exit cleanly.",
            ));
        }
        Ok(())
    }

    /// Returns the last known non-empty normalized Codex model catalog, if any.
    pub fn cached_models(&self) -> Option<Vec<Value>> {
        self.0
            .cached_models
            .borrow()
            .as_ref()
            .filter(|models| !models.is_empty())
            .cloned()
    }

    /// Stores a non-empty normalized model catalog in memory and (best-effort)
    /// persists it to disk so subsequent cold starts can avoid network stalls.
    pub fn store_models(&self, models: &[Value]) {
        if models.is_empty() {
            return;
        }
        *self.0.cached_models.borrow_mut() = Some(models.to_vec());
        if let Some(path) = self.0.model_cache_path.as_deref() {
            save_model_cache_to_disk(path, models);
        }
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.0.slots.borrow().len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

fn load_model_cache_from_disk(path: &Path) -> Option<Vec<Value>> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_MODEL_CACHE_BYTES {
        return None;
    }
    let raw = std::fs::read_to_string(path).ok()?;
    let parsed: Value = serde_json::from_str(&raw).ok()?;
    if parsed.get("version").and_then(Value::as_u64) != Some(MODEL_CACHE_SCHEMA_VERSION) {
        return None;
    }
    let models = parsed.get("models")?.as_array()?;
    let valid: Vec<Value> = models
        .iter()
        .filter(|entry| {
            entry
                .get("model")
                .and_then(Value::as_str)
                .is_some_and(|m| !m.is_empty())
        })
        .cloned()
        .collect();
    (!valid.is_empty()).then_some(valid)
}

fn save_model_cache_to_disk(path: &Path, models: &[Value]) {
    let Some(parent) = path.parent() else {
        return;
    };
    if std::fs::create_dir_all(parent).is_err() {
        return;
    }
    let payload = json!({
        "version": MODEL_CACHE_SCHEMA_VERSION,
        "models": models,
    });
    let Ok(bytes) = serde_json::to_vec(&payload) else {
        return;
    };
    let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = parent.join(format!(
        ".codex-models-cache.{}.{}.tmp",
        std::process::id(),
        nonce
    ));
    if std::fs::write(&tmp, &bytes).is_ok() {
        if std::fs::rename(&tmp, path).is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
    } else {
        let _ = std::fs::remove_file(&tmp);
    }
}
