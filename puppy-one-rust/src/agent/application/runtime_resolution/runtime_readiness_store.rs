//! `runtime-resolution/runtime-readiness-store.mjs`: process-local,
//! generation-stamped snapshots. Launch data never leaves Main.
use crate::clock;
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

pub const DEFAULT_SUCCESS_TTL_MS: i64 = 5 * 60_000;

/// One stored readiness snapshot.
#[derive(Clone, Debug)]
pub struct ReadinessSnapshot {
    pub public_readiness: Value,
    pub internal_readiness: Value,
    pub inspection: Value,
    pub evidence_source: String,
    pub generation: u64,
    pub observed_at: i64,
    pub expires_at: i64,
}

#[derive(Clone)]
pub struct RuntimeReadinessStore {
    snapshots: Rc<RefCell<HashMap<String, ReadinessSnapshot>>>,
    generation: Rc<Cell<u64>>,
    now: Rc<dyn Fn() -> i64>,
    success_ttl_ms: i64,
}

fn key(runtime_id: &str, workspace_root: &str) -> String {
    format!("{runtime_id}\0{workspace_root}")
}

impl RuntimeReadinessStore {
    /// `createRuntimeReadinessStore({ now, successTtlMs })`.
    pub fn new(now: Option<Rc<dyn Fn() -> i64>>, success_ttl_ms: Option<i64>) -> Self {
        Self {
            snapshots: Rc::default(),
            generation: Rc::default(),
            now: now.unwrap_or_else(|| Rc::new(clock::now_ms)),
            success_ttl_ms: success_ttl_ms.unwrap_or(DEFAULT_SUCCESS_TTL_MS),
        }
    }

    pub fn get(&self, runtime_id: &str, workspace_root: &str) -> Option<ReadinessSnapshot> {
        let key = key(runtime_id, workspace_root);
        let snapshot = self.snapshots.borrow().get(&key).cloned()?;
        if snapshot.generation != self.generation.get() || snapshot.expires_at <= (self.now)() {
            self.snapshots.borrow_mut().remove(&key);
            return None;
        }
        Some(snapshot)
    }

    pub fn set(
        &self,
        runtime_id: &str,
        workspace_root: &str,
        public_readiness: Value,
        internal_readiness: Value,
        inspection: Value,
        evidence_source: &str,
    ) -> ReadinessSnapshot {
        let observed_at = (self.now)();
        let snapshot = ReadinessSnapshot {
            public_readiness,
            internal_readiness,
            inspection,
            evidence_source: evidence_source.into(),
            generation: self.generation.get(),
            observed_at,
            expires_at: observed_at + self.success_ttl_ms.max(1),
        };
        self.snapshots
            .borrow_mut()
            .insert(key(runtime_id, workspace_root), snapshot.clone());
        snapshot
    }

    pub fn invalidate(&self, runtime_id: &str, workspace_root: &str) {
        self.snapshots
            .borrow_mut()
            .remove(&key(runtime_id, workspace_root));
    }

    pub fn clear(&self) -> u64 {
        self.generation.set(self.generation.get() + 1);
        self.snapshots.borrow_mut().clear();
        self.generation.get()
    }

    pub fn generation(&self) -> u64 {
        self.generation.get()
    }
}
