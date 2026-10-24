//! Project-scoped capacity is acquired before starting a provider and released with its owner.
use super::agent_runtime_port::AgentRuntimePort;
use crate::agent::domain::{agent_session_model::*, reference_input::Prompt};
use serde_json::Value;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};
static CAPACITY: OnceLock<Mutex<HashMap<PathBuf, usize>>> = OnceLock::new();
pub struct Lease {
    root: PathBuf,
}
impl Lease {
    /// Whether `acquire` would succeed now (the launcher keeps a refused
    /// creation in place instead of opening a failed chat).
    pub fn available(root: &std::path::Path) -> bool {
        CAPACITY
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .is_ok_and(|counts| {
                counts.values().sum::<usize>() < 32 && counts.get(root).copied().unwrap_or(0) < 8
            })
    }
    pub fn acquire(root: PathBuf) -> Result<Self, String> {
        let mut counts = CAPACITY
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| "Agent capacity lock failed")?;
        if counts.values().sum::<usize>() >= 32 || counts.get(&root).copied().unwrap_or(0) >= 8 {
            return Err("This project already has eight Agent sessions (or the application has 32). Close a session before opening another.".into());
        }
        *counts.entry(root.clone()).or_default() += 1;
        Ok(Self { root })
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Some(capacity) = CAPACITY.get()
            && let Ok(mut counts) = capacity.lock()
            && let Some(n) = counts.get_mut(&self.root)
        {
            *n = n.saturating_sub(1);
            if *n == 0 {
                counts.remove(&self.root);
            }
        }
    }
}
pub struct Leased {
    pub inner: Box<dyn AgentRuntimePort>,
    pub lease: Lease,
}
impl AgentRuntimePort for Leased {
    fn snapshot(&self) -> &SessionSnapshot {
        let _ = &self.lease;
        self.inner.snapshot()
    }
    fn poll(&mut self) {
        self.inner.poll()
    }
    fn send(&mut self, text: String) {
        self.inner.send(text)
    }
    fn submit(&mut self, prompt: Prompt) {
        self.inner.submit(prompt)
    }
    fn stop(&mut self) {
        self.inner.stop()
    }
    fn resume(&mut self, id: String) {
        self.inner.resume(id)
    }
    fn list_history(&mut self) {
        self.inner.list_history()
    }
    fn new_thread(&mut self) {
        self.inner.new_thread()
    }
    fn resolve(&mut self, id: &Value, response: Resolution) {
        self.inner.resolve(id, response)
    }
    fn select_model(&mut self, model: Option<String>) {
        self.inner.select_model(model)
    }
    fn steer(&mut self, text: String) {
        self.inner.steer(text)
    }
    fn fork(&mut self) {
        self.inner.fork()
    }
    fn compact(&mut self) {
        self.inner.compact()
    }
    fn archive(&mut self, id: String) {
        self.inner.archive(id)
    }
    fn rename(&mut self, name: String) {
        self.inner.rename(name)
    }
    fn select_mode(&mut self, mode: String) {
        self.inner.select_mode(mode)
    }
    fn select_effort(&mut self, effort: String) {
        self.inner.select_effort(effort)
    }
    fn reload_configuration(&mut self) {
        self.inner.reload_configuration()
    }
}
pub struct Unavailable {
    pub snapshot: SessionSnapshot,
}
impl AgentRuntimePort for Unavailable {
    fn snapshot(&self) -> &SessionSnapshot {
        &self.snapshot
    }
    fn poll(&mut self) {}
    fn send(&mut self, _text: String) {}
    fn submit(&mut self, _prompt: Prompt) {}
    fn stop(&mut self) {}
    fn resume(&mut self, _id: String) {}
    fn list_history(&mut self) {}
    fn new_thread(&mut self) {}
    fn resolve(&mut self, _id: &Value, _response: Resolution) {}
    fn select_model(&mut self, _model: Option<String>) {}
    fn steer(&mut self, _text: String) {}
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lease_capacity_is_released_by_ownership() {
        let root = PathBuf::from(format!("/tmp/{}", uuid::Uuid::new_v4()));
        let leases = (0..8)
            .map(|_| Lease::acquire(root.clone()).unwrap())
            .collect::<Vec<_>>();
        assert!(Lease::acquire(root.clone()).is_err());
        assert!(!Lease::available(&root));
        drop(leases);
        assert!(Lease::available(&root));
        assert!(Lease::acquire(root).is_ok());
    }
}
