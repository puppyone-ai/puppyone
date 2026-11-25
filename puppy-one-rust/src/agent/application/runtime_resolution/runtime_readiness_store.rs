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
    pub inspection: Value,
    pub generation: u64,
    pub expires_at: i64,
}

#[derive(Clone)]
pub struct RuntimeReadinessStore {
    snapshots: Rc<RefCell<HashMap<String, ReadinessSnapshot>>>,
    generation: Rc<Cell<u64>>,
    runtime_generations: Rc<RefCell<HashMap<String, u64>>>,
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
            runtime_generations: Rc::default(),
            now: now.unwrap_or_else(|| Rc::new(clock::now_ms)),
            success_ttl_ms: success_ttl_ms.unwrap_or(DEFAULT_SUCCESS_TTL_MS),
        }
    }

    pub fn runtime_generation(&self, runtime_id: &str) -> u64 {
        self.generation.get().wrapping_add(
            self.runtime_generations
                .borrow()
                .get(runtime_id)
                .copied()
                .unwrap_or(0),
        )
    }

    pub fn get(&self, runtime_id: &str, workspace_root: &str) -> Option<ReadinessSnapshot> {
        let key = key(runtime_id, workspace_root);
        let snapshot = self.snapshots.borrow().get(&key).cloned()?;
        if snapshot.generation != self.runtime_generation(runtime_id)
            || snapshot.expires_at <= (self.now)()
        {
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
        inspection: Value,
    ) -> ReadinessSnapshot {
        let observed_at = (self.now)();
        let snapshot = ReadinessSnapshot {
            public_readiness,
            inspection,
            generation: self.runtime_generation(runtime_id),
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

    /// Invalidates every cached workspace snapshot for `runtime_id` and bumps
    /// its generation so in-flight inspections from before this point cannot
    /// repopulate stale data, without disturbing unrelated CLI runtimes.
    pub fn invalidate_runtime(&self, runtime_id: &str) -> u64 {
        let prefix = format!("{runtime_id}\0");
        self.snapshots
            .borrow_mut()
            .retain(|k, _| !k.starts_with(&prefix));
        let mut gens = self.runtime_generations.borrow_mut();
        let next = gens.get(runtime_id).copied().unwrap_or(0).wrapping_add(1);
        gens.insert(runtime_id.to_owned(), next);
        self.generation.get().wrapping_add(next)
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn invalidate_runtime_evicts_only_the_target_runtime_across_workspaces_and_fences_generation() {
        let store = RuntimeReadinessStore::new(Some(Rc::new(|| 1_000)), Some(60_000));
        let ready = json!({ "status": "ready" });
        let inspection = json!({ "models": [] });

        store.set("puppyone-agent", "/ws-a", ready.clone(), inspection.clone());
        store.set("puppyone-agent", "/ws-b", ready.clone(), inspection.clone());
        store.set("external-cli", "/ws-a", ready.clone(), inspection.clone());

        let builtin_before = store.runtime_generation("puppyone-agent");
        let external_before = store.runtime_generation("external-cli");

        let builtin_after = store.invalidate_runtime("puppyone-agent");
        assert_ne!(builtin_after, builtin_before);
        assert_eq!(store.runtime_generation("puppyone-agent"), builtin_after);
        assert_eq!(store.runtime_generation("external-cli"), external_before);

        assert!(store.get("puppyone-agent", "/ws-a").is_none());
        assert!(store.get("puppyone-agent", "/ws-b").is_none());
        assert!(
            store.get("external-cli", "/ws-a").is_some(),
            "invalidating built-in agent must not evict external CLI readiness caches"
        );
    }
}
