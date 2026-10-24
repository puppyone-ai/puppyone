//! Application-owned session commands; hiding the GPUI view does not dispose this owner.
use crate::agent::domain::reference_input::{Prompt, Reference};
use crate::agent::{
    domain::agent_session_model::{Resolution, SessionSnapshot, State},
    runtime::agent_runtime_port::AgentRuntimePort,
};
use serde_json::Value;
pub struct AgentSessionController {
    client: Box<dyn AgentRuntimePort>,
    pub references: Vec<Reference>,
    pub draft_error: Option<String>,
    pending: Option<Prompt>,
    pub recoverable: Option<Prompt>,
}
impl AgentSessionController {
    pub fn new(client: Box<dyn AgentRuntimePort>) -> Self {
        Self {
            client,
            references: vec![],
            draft_error: None,
            pending: None,
            recoverable: None,
        }
    }
    pub fn snapshot(&self) -> &SessionSnapshot {
        self.client.snapshot()
    }
    pub fn busy(&self) -> bool {
        self.snapshot().busy()
    }
    pub fn poll(&mut self) {
        self.client.poll();
        if let Some(prompt) = self.pending.take() {
            if self.snapshot().state == State::Failed || self.snapshot().error.is_some() {
                self.recoverable = Some(prompt);
            } else if self.snapshot().busy() {
                self.pending = Some(prompt);
            }
        }
    }
    pub fn send(&mut self, text: String) -> bool {
        if self.snapshot().state != State::Idle
            || (text.trim().is_empty() && self.references.is_empty())
        {
            return false;
        }
        let prompt = Prompt {
            text,
            references: self.references.clone(),
        };
        self.pending = Some(prompt.clone());
        self.client.submit(prompt);
        if !matches!(self.snapshot().state, State::Running | State::Starting) {
            return false;
        }
        self.references.clear();
        true
    }
    pub fn replace_client(&mut self, client: Box<dyn AgentRuntimePort>) {
        self.client = client;
        if self.pending.is_some() {
            self.recoverable = self.pending.take();
        }
    }
    pub fn recover_draft(&mut self) -> Option<String> {
        let prompt = self.recoverable.take()?;
        self.references = prompt.references;
        Some(prompt.text)
    }
    pub fn reload_configuration(&mut self) {
        self.client.reload_configuration();
    }
    pub fn stop(&mut self) {
        self.client.stop()
    }
    pub fn resume(&mut self, id: String) {
        if !self.busy() {
            self.client.resume(id)
        }
    }
    pub fn list_history(&mut self) {
        self.client.list_history()
    }
    pub fn new_thread(&mut self) {
        if !self.busy() {
            self.client.new_thread()
        }
    }
    pub fn resolve(&mut self, id: &Value, response: Resolution) {
        self.client.resolve(id, response)
    }
    pub fn select_model(&mut self, model: Option<String>) {
        if self.snapshot().state == State::Idle {
            self.client.select_model(model)
        }
    }

    pub fn stage(&mut self, refs: Vec<Reference>) {
        let caps = &self.snapshot().capabilities;
        if refs.iter().any(|r| {
            matches!(
                &r.content,
                crate::agent::domain::reference_input::ReferenceContent::Image { .. }
            ) && !caps.images
        }) {
            self.draft_error =
                Some(crate::localization::t("agent.reference.error.image-unsupported").into());
            return;
        }
        if self.references.len() + refs.len() > 32
            || self
                .references
                .iter()
                .chain(&refs)
                .map(|r| r.bytes)
                .sum::<usize>()
                > 16 * 1024 * 1024
        {
            self.draft_error =
                Some(crate::localization::t("agent.reference.error.reference-limit").into());
            return;
        }
        self.references.extend(refs);
        self.draft_error = None;
    }
    pub fn steer(&mut self, text: String) -> bool {
        if self.snapshot().state != State::Running
            || !self.snapshot().capabilities.steer
            || text.trim().is_empty()
            || !self.references.is_empty()
        {
            return false;
        }
        self.client.steer(text);
        true
    }
    pub fn fork(&mut self) {
        if self.snapshot().state == State::Idle && self.snapshot().capabilities.fork {
            self.client.fork()
        }
    }
    pub fn compact(&mut self) {
        if self.snapshot().state == State::Idle && self.snapshot().capabilities.compact {
            self.client.compact()
        }
    }
    pub fn archive(&mut self, id: String) {
        if !self.busy() && self.snapshot().capabilities.archive {
            self.client.archive(id)
        }
    }
    pub fn rename(&mut self, name: String) {
        if !self.busy() && self.snapshot().capabilities.rename {
            self.client.rename(name)
        }
    }
    pub fn select_mode(&mut self, mode: String) {
        if !self.busy() && self.snapshot().capabilities.modes {
            self.client.select_mode(mode)
        }
    }
    pub fn select_effort(&mut self, effort: String) {
        if !self.busy() {
            self.client.select_effort(effort)
        }
    }
    pub fn export(&self) -> String {
        self.snapshot()
            .messages
            .iter()
            .map(|m| format!("## {}\n\n{}", m.role, m.text))
            .collect::<Vec<_>>()
            .join("\n\n")
    }
}
