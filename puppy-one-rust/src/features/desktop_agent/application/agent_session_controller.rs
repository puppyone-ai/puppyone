//! Application-owned session commands; hiding the GPUI view does not dispose this owner.
use crate::agent::domain::reference_input::{Prompt, Reference};
use crate::agent::{
    domain::agent_session_model::{Resolution, SessionSnapshot, State},
    runtime::agent_runtime_port::AgentRuntimePort,
};
use serde_json::Value;
use std::collections::HashMap;

/// How a turn ended (`AgentTurnTerminalState`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TurnOutcome {
    Completed,
    Failed,
    Interrupted,
}
/// Confirmed timing of a finished turn; `Worked for` exists only with one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TurnTiming {
    pub duration_ms: u64,
    pub outcome: TurnOutcome,
}
/// The running turn's clock (`agentRunActiveElapsedMs`): wall time minus the
/// time spent waiting for the user's approval or answers.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RunningTurn {
    pub started_ms: u64,
    pub user_wait_ms: u64,
    pub user_wait_started_ms: Option<u64>,
}
impl RunningTurn {
    pub fn active_elapsed_ms(&self, now_ms: u64) -> u64 {
        let open = self
            .user_wait_started_ms
            .map_or(0, |start| now_ms.saturating_sub(start));
        now_ms
            .saturating_sub(self.started_ms)
            .saturating_sub(self.user_wait_ms)
            .saturating_sub(open)
    }
}
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

pub struct AgentSessionController {
    client: Box<dyn AgentRuntimePort>,
    /// This conversation's attachment owner (its staged snapshots).
    pub owner: String,
    /// The workspace its live references must stay inside.
    pub root: Option<std::path::PathBuf>,
    pub references: Vec<Reference>,
    pub draft_error: Option<String>,
    pending: Option<Prompt>,
    pub recoverable: Option<Prompt>,
    /// The turn in progress, observed from the runtime's state transitions.
    pub running: Option<RunningTurn>,
    stop_requested: bool,
    /// Finished turns keyed by the user message that started them.
    pub turn_timings: HashMap<String, TurnTiming>,
}
/// `revokeOwner`: a closed conversation's attachments go with it.
impl Drop for AgentSessionController {
    fn drop(&mut self) {
        crate::agent::infrastructure::attachments::revoke_owner(&self.owner);
    }
}
impl AgentSessionController {
    pub fn new(client: Box<dyn AgentRuntimePort>) -> Self {
        Self {
            client,
            owner: uuid::Uuid::new_v4().to_string(),
            root: None,
            references: vec![],
            draft_error: None,
            pending: None,
            recoverable: None,
            running: None,
            stop_requested: false,
            turn_timings: HashMap::new(),
        }
    }
    /// Turn clock: a turn runs while the runtime is Running/Stopping; its end
    /// is attached to the user message that opened it.
    fn observe_turn(&mut self) {
        let snapshot = self.client.snapshot();
        let active = matches!(snapshot.state, State::Running | State::Stopping);
        let now = now_ms();
        match (&mut self.running, active) {
            (None, true) => {
                self.running = Some(RunningTurn {
                    started_ms: now,
                    user_wait_ms: 0,
                    user_wait_started_ms: None,
                })
            }
            (Some(turn), true) => {
                let waiting = !snapshot.interactions.is_empty();
                match (turn.user_wait_started_ms, waiting) {
                    (None, true) => turn.user_wait_started_ms = Some(now),
                    (Some(start), false) => {
                        turn.user_wait_ms += now.saturating_sub(start);
                        turn.user_wait_started_ms = None;
                    }
                    _ => {}
                }
            }
            (Some(turn), false) => {
                let outcome = if snapshot.state == State::Failed {
                    TurnOutcome::Failed
                } else if self.stop_requested {
                    TurnOutcome::Interrupted
                } else {
                    TurnOutcome::Completed
                };
                let duration_ms = turn.active_elapsed_ms(now);
                if let Some(anchor) = snapshot.messages.iter().rev().find(|m| {
                    m.role == "You" && !matches!(m.status.as_str(), "steering" | "queued")
                }) {
                    self.turn_timings.insert(
                        anchor.id.clone(),
                        TurnTiming {
                            duration_ms,
                            outcome,
                        },
                    );
                }
                self.running = None;
                self.stop_requested = false;
            }
            (None, false) => {}
        }
    }
    pub fn snapshot(&self) -> &SessionSnapshot {
        self.client.snapshot()
    }
    pub fn busy(&self) -> bool {
        self.snapshot().busy()
    }
    /// A submitted prompt is waiting for the session (`preparing-session`).
    pub fn awaiting_session(&self) -> bool {
        self.pending.is_some()
    }
    pub fn poll(&mut self) {
        self.client.poll();
        self.observe_turn();
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
        // `authorizeAgentReferences`: live references are checked and read
        // again, snapshots must be intact; a failure keeps the draft.
        let mut references = self.references.clone();
        if let Err(error) = crate::agent::infrastructure::attachments::authorize(
            &mut references,
            self.root.as_deref(),
        ) {
            self.draft_error = Some(error);
            return false;
        }
        let prompt = Prompt { text, references };
        self.pending = Some(prompt.clone());
        self.client.submit(prompt);
        self.observe_turn();
        if !matches!(self.snapshot().state, State::Running | State::Starting) {
            return false;
        }
        self.references.clear();
        true
    }
    pub fn replace_client(&mut self, client: Box<dyn AgentRuntimePort>) {
        self.client = client;
        self.observe_turn();
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
        self.stop_requested = self.running.is_some();
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

    /// Drops draft references, revoking their staged snapshots.
    pub fn remove_references(&mut self, keep: impl Fn(&Reference) -> bool) {
        let (kept, removed): (Vec<_>, Vec<_>) = std::mem::take(&mut self.references)
            .into_iter()
            .partition(|r| keep(r));
        self.references = kept;
        crate::agent::infrastructure::attachments::revoke(&removed);
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
                .sum::<usize>() as u64
                > crate::agent::infrastructure::attachments::MAX_TOTAL_REFERENCE_BYTES
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn running_clock_excludes_user_waits() {
        let turn = RunningTurn {
            started_ms: 1_000,
            user_wait_ms: 2_000,
            user_wait_started_ms: Some(9_000),
        };
        // 10s wall − 2s settled wait − 2s open wait.
        assert_eq!(turn.active_elapsed_ms(11_000), 6_000);
    }
}
