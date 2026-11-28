//! Per-workspace single-slot standby handover for ACP runtimes (ADR-024).
//!
//! Invariants:
//! - Never multiplexes live sessions: a parked ACP process is idle, zero-turn,
//!   and atomically handed over with 100% exclusive ownership to at most one
//!   session.
//! - Once claimed, the slot is immediately empty and this pool retains no
//!   reference to the connection or child process.
//! - Only adapters whose `"metadata"` and `"session"` launch args & environment
//!   are identical may park an inspection connection (for example OpenCode's
//!   `OPENCODE_DB=":memory:"` metadata mode is never parked as a live session).
use super::acp_client::AcpHandshakeState;
use super::acp_native_values::SessionConfig;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::tasks::spawn_after;
use crate::agent::transports::jsonl_rpc_connection::ConnectionEvent;
use crate::agent::transports::rpc_connection::RpcConnection;
use futures_util::future::join_all;
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;
use tokio::task::JoinHandle;

/// Default idle lifetime of a parked standby ACP process.
pub const DEFAULT_IDLE_TTL_MS: u64 = 60_000;
/// Maximum number of parked standby ACP processes across runtimes/workspaces.
pub const DEFAULT_MAX_SLOTS: usize = 4;

type StandbyKey = (String, String, String);

/// A zero-turn empty ACP session created during metadata inspection for the
/// exact `(runtime_id, executable_path, workspace_root)` key.
#[derive(Clone)]
pub struct PrecreatedAcpSession {
    pub session_id: String,
    pub session_config: SessionConfig,
    pub commands: Vec<Value>,
}

/// An already-initialized (and optionally already-authenticated & session-ready)
/// ACP connection waiting for exclusive handover to one live session.
pub struct AcpStandbyEntry {
    pub connection: Rc<dyn RpcConnection>,
    pub handshake: AcpHandshakeState,
    pub authenticated_method_id: Option<String>,
    pub precreated_session: Option<PrecreatedAcpSession>,
}

struct StandbySlot {
    id: u64,
    key: StandbyKey,
    entry: AcpStandbyEntry,
    listener_id: u64,
    timer: JoinHandle<()>,
}

impl StandbySlot {
    fn dispose_now(self, reason: &str) {
        self.timer.abort();
        self.entry.connection.off(self.listener_id);
        self.entry.connection.dispose(reason, true);
    }
}

struct StandbyInner {
    idle_ttl: Duration,
    max_slots: usize,
    slots: RefCell<Vec<StandbySlot>>,
    next_slot_id: Cell<u64>,
    disposed: Cell<bool>,
}

impl Drop for StandbyInner {
    fn drop(&mut self) {
        let slots = std::mem::take(self.slots.get_mut());
        for slot in slots {
            slot.dispose_now("ACP standby pool dropped.");
        }
    }
}

/// Per-(runtime, binary, workspace) single-slot exclusive handover pool for
/// local ACP runtimes (Cursor, Hermes, WorkBuddy, etc.).
#[derive(Clone)]
pub struct AcpStandbyPool(Rc<StandbyInner>);

impl Default for AcpStandbyPool {
    fn default() -> Self {
        Self::new()
    }
}

impl AcpStandbyPool {
    /// Creates a pool with production defaults (60s idle TTL, 4 max slots).
    pub fn new() -> Self {
        Self::with_options(
            Duration::from_millis(DEFAULT_IDLE_TTL_MS),
            DEFAULT_MAX_SLOTS,
        )
    }

    /// Creates a pool with explicit TTL and slot cap.
    pub fn with_options(idle_ttl: Duration, max_slots: usize) -> Self {
        Self(Rc::new(StandbyInner {
            idle_ttl,
            max_slots,
            slots: RefCell::new(Vec::new()),
            next_slot_id: Cell::new(0),
            disposed: Cell::new(false),
        }))
    }

    /// Parks an initialized, zero-turn ACP connection for exclusive handover.
    ///
    /// Returns `true` if parked, or `false` if rejected (in which case this
    /// method has already initiated `entry.connection.dispose(...)`).
    pub fn park(
        &self,
        runtime_id: &str,
        executable_path: &str,
        workspace_root: &str,
        entry: AcpStandbyEntry,
    ) -> bool {
        let inner = &self.0;
        if inner.disposed.get() || inner.max_slots == 0 || entry.connection.closed() {
            entry
                .connection
                .dispose("ACP standby pool unavailable.", true);
            return false;
        }
        let key = (
            runtime_id.to_string(),
            executable_path.to_string(),
            workspace_root.to_string(),
        );
        let replaced = {
            let mut slots = inner.slots.borrow_mut();
            slots
                .iter()
                .position(|slot| slot.key == key)
                .map(|index| slots.remove(index))
        };
        if let Some(previous) = replaced {
            previous.dispose_now("ACP standby slot replaced.");
        }
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
                Some(slot) => slot.dispose_now("ACP standby capacity limit reached."),
                None => break,
            }
        }
        let slot_id = inner.next_slot_id.get() + 1;
        inner.next_slot_id.set(slot_id);
        let weak = Rc::downgrade(inner);
        let conn_for_listener = Rc::downgrade(&entry.connection);
        let listener_id = entry.connection.on(Rc::new(move |event| match event {
            ConnectionEvent::Request(message) => {
                if let Some(id) = message.get("id").filter(|id| !id.is_null())
                    && let Some(conn) = conn_for_listener.upgrade()
                {
                    let _ = conn.respond_error(
                        id.clone(),
                        -32601,
                        "Standby ACP connection has no active session.",
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
                        slot.entry.connection.off(slot.listener_id);
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
                slot.entry.connection.off(slot.listener_id);
                slot.entry
                    .connection
                    .dispose("ACP standby connection idle timeout.", true);
            }
        });
        inner.slots.borrow_mut().push(StandbySlot {
            id: slot_id,
            key,
            entry,
            listener_id,
            timer,
        });
        true
    }

    /// Atomically claims sole ownership of a parked ACP connection for
    /// `(runtime_id, executable_path, workspace_root)`.
    pub fn claim(
        &self,
        runtime_id: &str,
        executable_path: &str,
        workspace_root: &str,
    ) -> Option<AcpStandbyEntry> {
        let inner = &self.0;
        if inner.disposed.get() {
            return None;
        }
        let slot = {
            let mut slots = inner.slots.borrow_mut();
            slots
                .iter()
                .position(|slot| {
                    slot.key.0 == runtime_id
                        && slot.key.1 == executable_path
                        && slot.key.2 == workspace_root
                })
                .map(|index| slots.remove(index))
        }?;
        slot.timer.abort();
        slot.entry.connection.off(slot.listener_id);
        if slot.entry.connection.closed() {
            return None;
        }
        Some(slot.entry)
    }

    /// Evicts and terminates every parked standby ACP connection without
    /// permanently closing the pool (invoked on explicit runtime refresh).
    pub fn evict_all(&self) {
        let slots = std::mem::take(&mut *self.0.slots.borrow_mut());
        for slot in slots {
            slot.dispose_now("ACP standby cache invalidated.");
        }
    }

    /// Permanently closes the pool, disposes every parked standby ACP process,
    /// and waits for all of them to exit.
    pub async fn dispose_all(&self) -> AgentResult<()> {
        self.0.disposed.set(true);
        let slots = std::mem::take(&mut *self.0.slots.borrow_mut());
        let connections: Vec<Rc<dyn RpcConnection>> = slots
            .into_iter()
            .map(|slot| {
                slot.timer.abort();
                slot.entry.connection.off(slot.listener_id);
                slot.entry
                    .connection
                    .dispose("ACP standby pool disposed.", true);
                slot.entry.connection
            })
            .collect();
        let results = join_all(connections.iter().map(|c| c.wait_for_exit())).await;
        if results.iter().any(Result::is_err) {
            return Err(AgentError::new(
                "One or more standby ACP processes failed to exit cleanly.",
            ));
        }
        Ok(())
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
