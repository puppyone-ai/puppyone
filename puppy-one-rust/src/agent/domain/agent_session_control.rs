//! `domain/agent-session-control.mjs`: the session's control state
//! (connection, execution, commands, queue, blockers) and its pure reducer,
//! shared by live and hydration paths. It never performs I/O.
use super::agent_recovery::reduce_agent_recoveries;
use crate::agent::contract::constants::{AGENT_IDLE_DISCONNECT_REASON, limits};
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::types::AgentEventView;
use crate::clock;
use crate::text;
use serde_json::{Map, Value, json};

pub const MAX_COMMAND_RECORDS: usize = 128;
pub const MAX_TERMINAL_TURNS: usize = 128;

/// The reducer refused an input it cannot hold (`throw new Error`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ControlError(pub String);

impl std::fmt::Display for ControlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn status_of(entry: &Value) -> &str {
    js::str_or_empty(entry.get("status"))
}

fn array_len(value: &Value) -> usize {
    value.as_array().map_or(0, Vec::len)
}

/// `isAgentExecutionSettled(control)`: a settled session can reconnect
/// before its next command without asking the user to recover a turn.
pub fn is_agent_execution_settled(control: &Value) -> bool {
    let execution = &control["execution"];
    execution.is_object()
        && matches!(status_of(execution), "idle" | "ended")
        && execution.get("certainty") == Some(&Value::from("confirmed"))
        && !js::truthy_opt(execution.get("activeTurnId"))
        && !js::truthy_opt(execution.get("uncertainTurnId"))
        && !js::truthy_opt(control.get("pendingSubmission"))
        && array_len(&control["queue"]) == 0
        && array_len(&control["interaction"]["approvals"]) == 0
        && array_len(&control["interaction"]["questions"]) == 0
}

/// `isAgentIdleDisconnect(control)`.
pub fn is_agent_idle_disconnect(control: &Value) -> bool {
    control["connection"]["status"] == "exited"
        && control["connection"]["reason"] == AGENT_IDLE_DISCONNECT_REASON
        && is_agent_execution_settled(control)
}

/// `createAgentSessionControl({ streamId, sessionEpoch, terminalState, revision })`.
pub fn create_agent_session_control(
    stream_id: &str,
    session_epoch: &str,
    terminal_state: &str,
    revision: i64,
) -> Value {
    let outcome_unknown = matches!(
        terminal_state,
        "running" | "provider-exited" | "outcome-unknown"
    );
    json!({
        "schemaVersion": 1,
        "streamId": stream_id,
        "revision": revision,
        "sessionEpoch": session_epoch,
        "adapterGeneration": 0,
        "runGeneration": 0,
        "connection": { "status": "connecting", "reason": null },
        "execution": {
            "status": if outcome_unknown { "outcome-unknown" } else { "idle" },
            "activeTurnId": null,
            "uncertainTurnId": null,
            "startedAtMs": null,
            "nativeOutcome": terminal_outcome(Some(&Value::from(terminal_state))),
            "certainty": if outcome_unknown { "unknown" } else { "confirmed" },
        },
        "interaction": { "approvals": [], "questions": [] },
        "commands": [],
        "queue": [],
        "terminalTurns": [],
        "pendingSubmission": null,
        "recoveries": [],
    })
}

/// `reduceAgentSessionControl(previous, input)`: the next control, or
/// `previous` itself (`Ok(None)`) when the input changes nothing.
pub fn reduce_agent_session_control(
    previous: &Value,
    input: &Value,
) -> Result<Option<Value>, ControlError> {
    let mut state = State(previous.as_object().cloned().unwrap_or_default());
    if !state.apply(input)? {
        return Ok(None);
    }
    let revision = previous["revision"].as_i64().unwrap_or(0) + 1;
    state.0.insert("revision".into(), revision.into());
    Ok(Some(Value::Object(state.0)))
}

/// `reduceAgentSessionControl(previous, input)` for callers that hold the
/// control by value: returns `previous` when nothing changed.
pub fn reduce_control(previous: &Value, input: &Value) -> Result<Value, ControlError> {
    Ok(reduce_agent_session_control(previous, input)?.unwrap_or_else(|| previous.clone()))
}

fn execution(
    status: &str,
    active: Option<Value>,
    uncertain: Option<Value>,
    started_at_ms: Value,
    native_outcome: Value,
    certainty: &str,
) -> Value {
    Obj::new()
        .set("status", status)
        .set("activeTurnId", active.unwrap_or(Value::Null))
        .set("uncertainTurnId", uncertain.unwrap_or(Value::Null))
        .set("startedAtMs", started_at_ms)
        .set("nativeOutcome", native_outcome)
        .set("certainty", certainty)
        .build()
}

fn idle_execution() -> Value {
    execution("idle", None, None, Value::Null, Value::Null, "confirmed")
}

struct State(Map<String, Value>);

impl State {
    fn get(&self, key: &str) -> &Value {
        self.0.get(key).unwrap_or(&Value::Null)
    }
    fn set(&mut self, key: &str, value: impl Into<Value>) {
        self.0.insert(key.into(), value.into());
    }
    fn i64(&self, key: &str) -> i64 {
        self.get(key).as_i64().unwrap_or(0)
    }
    fn execution(&self) -> &Value {
        self.get("execution")
    }
    fn active_turn(&self) -> Option<&Value> {
        self.execution()
            .get("activeTurnId")
            .filter(|v| js::truthy(v))
    }
    fn execution_status(&self) -> &str {
        status_of(self.execution())
    }
    fn commands(&self) -> &[Value] {
        self.get("commands")
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
    }
    fn commands_mut(&mut self) -> &mut Vec<Value> {
        if !self.get("commands").is_array() {
            self.set("commands", Value::Array(Vec::new()));
        }
        self.0
            .get_mut("commands")
            .and_then(Value::as_array_mut)
            .expect("commands")
    }
    fn queue(&self) -> Vec<Value> {
        self.get("queue").as_array().cloned().unwrap_or_default()
    }
    fn list(&self, a: &str, b: &str) -> Vec<Value> {
        self.get(a)
            .get(b)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    }
    fn generation(&self) -> Value {
        self.get("adapterGeneration").clone()
    }

    /// The execution `outcome-unknown` after losing the native run.
    fn lose_execution(&mut self, keep_uncertain: bool) {
        let active = self
            .execution()
            .get("activeTurnId")
            .filter(|v| !v.is_null())
            .cloned();
        let uncertain = if keep_uncertain {
            active.or_else(|| {
                self.execution()
                    .get("uncertainTurnId")
                    .filter(|v| !v.is_null())
                    .cloned()
            })
        } else {
            active
        };
        let started = self
            .execution()
            .get("startedAtMs")
            .cloned()
            .unwrap_or(Value::Null);
        self.set(
            "execution",
            execution(
                "outcome-unknown",
                None,
                uncertain,
                started,
                Value::Null,
                "unknown",
            ),
        );
    }

    fn apply(&mut self, input: &Value) -> Result<bool, ControlError> {
        let kind = js::str_or_empty(input.get("type"));
        Ok(match kind {
            "adapter.attached" => {
                if self.i64("adapterGeneration") > 0 {
                    self.settle_outstanding_commands("adapter-generation-changed");
                    if self.active_turn().is_some() || self.execution_status() == "starting" {
                        self.lose_execution(false);
                    }
                    self.set("pendingSubmission", Value::Null);
                }
                let generation = self.i64("adapterGeneration") + 1;
                self.set("adapterGeneration", generation);
                self.set("recoveries", Value::Array(Vec::new()));
                self.set(
                    "connection",
                    json!({ "status": "connected", "reason": null }),
                );
                true
            }
            "adapter.exited" => {
                if !js::nullish(input.get("adapterGeneration"))
                    && input.get("adapterGeneration") != Some(&self.generation())
                {
                    return Ok(false);
                }
                let reason = input
                    .get("reason")
                    .filter(|r| js::truthy(r))
                    .and_then(Value::as_str)
                    .unwrap_or("provider-exited")
                    .to_string();
                self.set("recoveries", Value::Array(Vec::new()));
                self.set(
                    "connection",
                    json!({ "status": "exited", "reason": bounded_reason(Some(&Value::from(reason.as_str()))) }),
                );
                if self.active_turn().is_some() || self.execution_status() == "starting" {
                    self.lose_execution(false);
                }
                self.set("pendingSubmission", Value::Null);
                self.settle_outstanding_commands(&reason);
                true
            }
            "connection.connecting" => {
                self.set(
                    "connection",
                    json!({ "status": "connecting", "reason": bounded_reason(input.get("reason")) }),
                );
                true
            }
            "event.accepted" => {
                self.apply_canonical_event(input.get("event").unwrap_or(&Value::Null))
            }
            "submission.prepared" => {
                let submission = input.get("submission").unwrap_or(&Value::Null);
                if !self.matches_dispatching_start(submission) {
                    return Ok(false);
                }
                self.set("pendingSubmission", submission.clone());
                if self.active_turn().is_none() {
                    let started = input
                        .get("startedAtMs")
                        .filter(|v| !v.is_null())
                        .cloned()
                        .unwrap_or(Value::Null);
                    self.set(
                        "execution",
                        execution("starting", None, None, started, Value::Null, "unknown"),
                    );
                }
                true
            }
            "submission.accepted" => self.accept_submission(input),
            "submission.outcome-unknown" => self.mark_submission_outcome_unknown(input),
            "submission.abandoned" => {
                if !matches_pending_submission(self.get("pendingSubmission"), input) {
                    return Ok(false);
                }
                self.set("pendingSubmission", Value::Null);
                if self.active_turn().is_none() && self.execution_status() == "starting" {
                    self.set("execution", idle_execution());
                }
                true
            }
            "interrupt.requested" => {
                if self.execution().get("activeTurnId") != input.get("turnId") {
                    return Ok(false);
                }
                let turn = input.get("turnId").cloned().unwrap_or(Value::Null);
                self.upsert_command(
                    Obj::new()
                        .set(
                            "commandId",
                            input.get("commandId").cloned().unwrap_or(Value::Null),
                        )
                        .set("kind", "interrupt")
                        .set("targetTurnId", turn)
                        .set("status", "dispatching")
                        .set(
                            "intentFingerprint",
                            input
                                .get("intentFingerprint")
                                .cloned()
                                .unwrap_or(Value::Null),
                        )
                        .set("wasQueued", false)
                        .set("error", Value::Null)
                        .build(),
                )
            }
            "command.received" => {
                self.receive_command(input.get("command").unwrap_or(&Value::Null))?
            }
            "queue.dispatch-reserved" => self.reserve_queued_start(input),
            "command.dispatching"
            | "command.accepted"
            | "command.rejected"
            | "command.cancelled"
            | "command.outcome-unknown" => self.transition_command(input),
            "history.loaded" => true,
            "control.hydrated" => {
                self.hydrate_control(input.get("control").unwrap_or(&Value::Null))
            }
            "recovery.unconfirmed" => {
                if self.active_turn().is_none() && self.execution_status() != "starting" {
                    return Ok(false);
                }
                self.lose_execution(true);
                self.set("pendingSubmission", Value::Null);
                let reason = input
                    .get("reason")
                    .filter(|r| js::truthy(r))
                    .and_then(Value::as_str)
                    .unwrap_or("native-state-unconfirmed")
                    .to_string();
                self.settle_outstanding_commands(&reason);
                true
            }
            _ => false,
        })
    }

    fn apply_canonical_event(&mut self, event: &Value) -> bool {
        let control = Value::Object(self.0.clone());
        let recoveries = reduce_agent_recoveries(
            self.get("recoveries")
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default(),
            event,
            &control,
        );
        self.set("recoveries", recoveries);
        let payload = event.payload();
        match event.event_type() {
            "session.started" | "session.resumed" => {
                self.set(
                    "connection",
                    json!({ "status": "connected", "reason": null }),
                );
                true
            }
            "session.closed" => {
                self.set(
                    "connection",
                    json!({ "status": "disconnected", "reason": "session-closed" }),
                );
                if self.active_turn().is_some()
                    || matches!(self.execution_status(), "starting" | "outcome-unknown")
                {
                    self.lose_execution(true);
                } else {
                    let outcome = self
                        .execution()
                        .get("nativeOutcome")
                        .cloned()
                        .unwrap_or(Value::Null);
                    self.set(
                        "execution",
                        execution("ended", None, None, Value::Null, outcome, "confirmed"),
                    );
                }
                self.set("interaction", json!({ "approvals": [], "questions": [] }));
                self.set("pendingSubmission", Value::Null);
                self.settle_outstanding_commands("session-closed");
                true
            }
            "turn.started" => {
                let turn_id = event
                    .turn_id()
                    .filter(|t| !t.is_empty())
                    .map(str::to_string);
                let restored = js::truthy_opt(payload.get("restored"));
                // A correlated native start is a delivery receipt even if the RPC reply is lost.
                if let Some(turn) = &turn_id
                    && !restored
                    && let Some(submission) = payload.get("submissionId").filter(|s| js::truthy(s))
                {
                    self.transition_command(
                        &Obj::new()
                            .set("type", "command.accepted")
                            .set("commandId", submission.clone())
                            .set("turnId", turn.as_str())
                            .opt("userMessageId", payload.get("userMessageId").cloned())
                            .build(),
                    );
                }
                let Some(turn_id) = turn_id else {
                    return true;
                };
                let terminal = self.get("terminalTurns").as_array().is_some_and(|turns| {
                    turns.iter().any(|t| t.as_str() == Some(turn_id.as_str()))
                });
                if terminal {
                    return true;
                }
                let turn = Value::from(turn_id.as_str());
                let emitted_at = event
                    .get("emittedAt")
                    .and_then(Value::as_str)
                    .and_then(clock::date_parse)
                    .filter(|ms| *ms != 0)
                    .map_or(Value::Null, Value::from);
                if payload.get("restored") == Some(&Value::Bool(true)) {
                    if self.execution().get("activeTurnId") != Some(&turn)
                        && self.execution().get("uncertainTurnId") != Some(&turn)
                    {
                        let generation = self.i64("runGeneration") + 1;
                        self.set("runGeneration", generation);
                    }
                    self.set(
                        "execution",
                        execution(
                            "outcome-unknown",
                            None,
                            Some(turn),
                            emitted_at,
                            Value::Null,
                            "unknown",
                        ),
                    );
                    self.set("pendingSubmission", Value::Null);
                    return true;
                }
                if self.execution().get("activeTurnId") != Some(&turn) {
                    let generation = self.i64("runGeneration") + 1;
                    self.set("runGeneration", generation);
                }
                let started = match self.execution().get("startedAtMs") {
                    Some(started)
                        if self.execution_status() == "starting" && !started.is_null() =>
                    {
                        started.clone()
                    }
                    _ => emitted_at,
                };
                self.set(
                    "execution",
                    execution(
                        "active",
                        Some(turn),
                        None,
                        started,
                        Value::Null,
                        "confirmed",
                    ),
                );
                self.set("pendingSubmission", Value::Null);
                true
            }
            "turn.completed" | "turn.failed" | "turn.interrupted" => {
                let turn_id = event
                    .turn_id()
                    .filter(|t| !t.is_empty())
                    .map(str::to_string);
                self.remember_terminal(turn_id.as_deref());
                let keep = |entry: &Value| {
                    turn_id.is_none()
                        || entry.get("turnId").and_then(Value::as_str) != turn_id.as_deref()
                };
                let approvals: Vec<Value> = self
                    .list("interaction", "approvals")
                    .into_iter()
                    .filter(keep)
                    .collect();
                let questions: Vec<Value> = self
                    .list("interaction", "questions")
                    .into_iter()
                    .filter(keep)
                    .collect();
                self.set(
                    "interaction",
                    json!({ "approvals": approvals, "questions": questions }),
                );
                if let Some(turn) = turn_id {
                    let turn = Value::from(turn);
                    if self.execution().get("activeTurnId") == Some(&turn)
                        || self.execution().get("uncertainTurnId") == Some(&turn)
                    {
                        let outcome = &event.event_type()["turn.".len()..];
                        self.set(
                            "execution",
                            execution(
                                "ended",
                                None,
                                None,
                                Value::Null,
                                Value::from(outcome),
                                "confirmed",
                            ),
                        );
                        self.set("pendingSubmission", Value::Null);
                    }
                }
                true
            }
            "approval.requested" => self.upsert_blocker("approvals", event, payload),
            "question.requested" => self.upsert_blocker("questions", event, payload),
            "approval.resolved" => self.remove_blocker("approvals", payload.get("requestId")),
            "question.resolved" => self.remove_blocker("questions", payload.get("requestId")),
            "provider.connection.updated" => {
                if payload.get("scope") != Some(&Value::from("transport")) {
                    return true;
                }
                let state = js::str_or_empty(payload.get("state"));
                let max = payload
                    .get("maxAttempts")
                    .filter(|v| !v.is_null())
                    .or(payload.get("maxRetries"));
                self.set(
                    "connection",
                    Obj::new()
                        .set(
                            "status",
                            if state == "connected" {
                                "connected"
                            } else {
                                "recovering"
                            },
                        )
                        .set("reason", bounded_reason(payload.get("message")))
                        .set(
                            "recoveryState",
                            matches!(state, "reconnecting" | "fallback").then_some(state),
                        )
                        .set("attempt", positive_integer_or_null(payload.get("attempt")))
                        .set("maxAttempts", positive_integer_or_null(max))
                        .build(),
                );
                true
            }
            // Content events still advance the control revision, making feed cursors
            // total-order every canonical fact even when control fields are unchanged.
            _ => true,
        }
    }

    fn command_index(&self, id: Option<&Value>) -> Option<usize> {
        self.commands()
            .iter()
            .position(|entry| entry.get("commandId") == id)
    }

    fn accept_submission(&mut self, input: &Value) -> bool {
        if input.get("adapterGeneration") != Some(&self.generation()) {
            return false;
        }
        let Some(index) = self.command_index(input.get("commandId")) else {
            return false;
        };
        let command = &self.commands()[index];
        if status_of(command) == "accepted"
            && command.get("operationId") == input.get("operationId")
            && command.get("targetTurnId") == input.get("turnId")
        {
            return true;
        }
        if command.get("kind") != Some(&Value::from("start"))
            || status_of(command) != "dispatching"
            || command.get("operationId") != input.get("operationId")
        {
            return false;
        }
        let pending_matches = matches_pending_submission(self.get("pendingSubmission"), input);
        let changed = self.transition_command(
            &Obj::new()
                .set("type", "command.accepted")
                .opt("commandId", input.get("commandId").cloned())
                .opt("operationId", input.get("operationId").cloned())
                .opt("turnId", input.get("turnId").cloned())
                .opt("userMessageId", input.get("userMessageId").cloned())
                .build(),
        );
        if !changed || !pending_matches {
            return changed;
        }
        self.set("pendingSubmission", Value::Null);
        if let Some(outcome) = terminal_outcome(input.get("terminalOutcome")) {
            // No turn.started fact was observed for this operation, so receipt-time
            // correlation is the single point that advances the run generation.
            let generation = self.i64("runGeneration") + 1;
            self.set("runGeneration", generation);
            self.set(
                "execution",
                execution(
                    "ended",
                    None,
                    None,
                    Value::Null,
                    Value::from(outcome),
                    "confirmed",
                ),
            );
        }
        true
    }

    fn mark_submission_outcome_unknown(&mut self, input: &Value) -> bool {
        if !matches_pending_submission(self.get("pendingSubmission"), input) {
            return false;
        }
        let Some(index) = self.command_index(input.get("commandId")) else {
            return false;
        };
        let command = &self.commands()[index];
        if command.get("kind") != Some(&Value::from("start"))
            || status_of(command) != "dispatching"
            || command.get("operationId") != input.get("operationId")
        {
            return false;
        }
        self.transition_command(
            &Obj::new()
                .set("type", "command.outcome-unknown")
                .opt("commandId", input.get("commandId").cloned())
                .opt("operationId", input.get("operationId").cloned())
                .opt("error", input.get("error").cloned())
                .opt("userMessageId", input.get("userMessageId").cloned())
                .build(),
        );
        self.set("pendingSubmission", Value::Null);
        let started = self
            .execution()
            .get("startedAtMs")
            .cloned()
            .unwrap_or(Value::Null);
        self.set(
            "execution",
            execution(
                "outcome-unknown",
                None,
                None,
                started,
                Value::Null,
                "unknown",
            ),
        );
        true
    }

    /// Atomically validates and reserves the next queued effect before any I/O.
    fn reserve_queued_start(&mut self, input: &Value) -> bool {
        if input.get("adapterGeneration") != Some(&self.generation())
            || self.get("connection")["status"] != "connected"
        {
            return false;
        }
        let queue = self.queue();
        if queue.first() != input.get("commandId") || js::truthy(self.get("pendingSubmission")) {
            return false;
        }
        if self.active_turn().is_some()
            || js::truthy_opt(self.execution().get("uncertainTurnId"))
            || matches!(self.execution_status(), "starting" | "outcome-unknown")
        {
            return false;
        }
        if self.commands().iter().any(|entry| {
            entry.get("kind") == Some(&Value::from("interrupt"))
                && status_of(entry) == "dispatching"
        }) {
            return false;
        }
        let Some(index) = self.command_index(input.get("commandId")) else {
            return false;
        };
        let command = &self.commands()[index];
        if command.get("kind") != Some(&Value::from("start"))
            || status_of(command) != "queued"
            || command.get("operationId") != input.get("operationId")
        {
            return false;
        }
        let command = js::with(
            &js::with(command, "status", "dispatching"),
            "error",
            Value::Null,
        );
        self.commands_mut()[index] = command;
        let mut queue = queue;
        queue.remove(0);
        self.set("queue", queue);
        true
    }

    fn receive_command(&mut self, command: &Value) -> Result<bool, ControlError> {
        let Some(command_id) = command
            .get("commandId")
            .filter(|id| js::truthy(id))
            .cloned()
        else {
            return Ok(false);
        };
        if self.command_index(Some(&command_id)).is_some() {
            return Ok(false);
        }
        if self.commands().len() >= MAX_COMMAND_RECORDS {
            let Some(settled) = self.commands().iter().position(|entry| {
                matches!(status_of(entry), "accepted" | "rejected" | "cancelled")
            }) else {
                return Err(ControlError(
                    "Agent command capacity is full; unresolved deliveries must be settled first."
                        .into(),
                ));
            };
            self.commands_mut().remove(settled);
        }
        let queued = command.get("status") == Some(&Value::from("queued"));
        let or_null = |key: &str| {
            command
                .get(key)
                .filter(|v| !v.is_null())
                .cloned()
                .unwrap_or(Value::Null)
        };
        let record = Obj::new()
            .set("commandId", command_id.clone())
            .set("kind", command.get("kind").cloned().unwrap_or(Value::Null))
            .set("targetTurnId", or_null("targetTurnId"))
            .set("requestId", or_null("requestId"))
            .set("status", if queued { "queued" } else { "dispatching" })
            .set("operationId", or_null("operationId"))
            .set("intentFingerprint", or_null("intentFingerprint"))
            .set(
                "wasQueued",
                queued || command.get("wasQueued") == Some(&Value::Bool(true)),
            )
            .set("userMessageId", or_null("userMessageId"))
            .opt(
                "intent",
                command.get("intent").filter(|i| js::truthy(i)).cloned(),
            )
            .set("error", Value::Null)
            .build();
        self.commands_mut().push(record);
        if queued {
            let mut queue = self.queue();
            queue.push(command_id);
            self.set("queue", queue);
        }
        self.trim_commands();
        Ok(true)
    }

    fn transition_command(&mut self, input: &Value) -> bool {
        let status = js::str_or_empty(input.get("type"))
            .trim_start_matches("command.")
            .to_string();
        let Some(index) = self.command_index(input.get("commandId")) else {
            return false;
        };
        let current = self.commands()[index].clone();
        let input_operation = input.get("operationId").filter(|v| js::truthy(v));
        let current_operation = current.get("operationId").filter(|v| js::truthy(v));
        if let (Some(a), Some(b)) = (input_operation, current_operation)
            && a != b
        {
            return false;
        }
        let confirms_unknown_start = current.get("kind") == Some(&Value::from("start"))
            && status_of(&current) == "outcome-unknown"
            && status == "accepted"
            && js::truthy_opt(input.get("turnId"));
        if is_final_command_status(status_of(&current)) && !confirms_unknown_start {
            return false;
        }
        let coalesce = |a: Option<&Value>, b: Option<&Value>| {
            a.filter(|v| !v.is_null())
                .or(b.filter(|v| !v.is_null()))
                .cloned()
                .unwrap_or(Value::Null)
        };
        let mut next = Obj::from(&current)
            .set("status", status.as_str())
            .set(
                "operationId",
                coalesce(input.get("operationId"), current.get("operationId")),
            )
            .set(
                "targetTurnId",
                coalesce(input.get("turnId"), current.get("targetTurnId")),
            )
            .set(
                "userMessageId",
                coalesce(input.get("userMessageId"), current.get("userMessageId")),
            )
            .set(
                "error",
                input
                    .get("error")
                    .filter(|e| js::truthy(e))
                    .map(|e| {
                        let text = e
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| e.to_string());
                        Value::from(text::head16(&text, limits::MAX_COMMAND_ERROR_LENGTH))
                    })
                    .unwrap_or(Value::Null),
            )
            .build();
        if matches!(status.as_str(), "accepted" | "rejected" | "cancelled") {
            js::delete(&mut next, "intent");
        }
        self.commands_mut()[index] = next;
        if status != "queued" {
            let queue: Vec<Value> = self
                .queue()
                .into_iter()
                .filter(|id| Some(id) != input.get("commandId"))
                .collect();
            self.set("queue", queue);
        }
        if matches!(status.as_str(), "rejected" | "cancelled")
            && current.get("kind") == Some(&Value::from("start"))
            && matches_pending_submission(
                self.get("pendingSubmission"),
                &Obj::new()
                    .opt("commandId", input.get("commandId").cloned())
                    .set(
                        "operationId",
                        coalesce(input.get("operationId"), current.get("operationId")),
                    )
                    .set("adapterGeneration", self.generation())
                    .build(),
            )
            && self.active_turn().is_none()
            && self.execution_status() == "starting"
        {
            self.set("execution", idle_execution());
            self.set("pendingSubmission", Value::Null);
        }
        true
    }

    fn upsert_command(&mut self, command: Value) -> bool {
        if self.command_index(command.get("commandId")).is_some() {
            return false;
        }
        let operation = command
            .get("operationId")
            .filter(|v| !v.is_null())
            .cloned()
            .unwrap_or(Value::Null);
        self.commands_mut()
            .push(js::with(&command, "operationId", operation));
        self.trim_commands();
        true
    }

    fn settle_outstanding_commands(&mut self, reason: &str) {
        let error = bounded_command_error(reason);
        for entry in self.commands_mut().iter_mut() {
            let status = match status_of(entry) {
                "dispatching" => "outcome-unknown",
                "queued" => "cancelled",
                _ => continue,
            };
            *entry = js::with(&js::with(entry, "status", status), "error", error.clone());
        }
        self.set("queue", Value::Array(Vec::new()));
    }

    fn upsert_blocker(&mut self, key: &str, event: &Value, payload: &Value) -> bool {
        let Some(request_id) = payload.get("requestId").filter(|r| r.is_string()).cloned() else {
            return false;
        };
        let mut entries = self.list("interaction", key);
        if entries
            .iter()
            .any(|entry| entry.get("requestId") == Some(&request_id))
        {
            return false;
        }
        let runtime = event
            .get("runtimeId")
            .filter(|v| !v.is_null())
            .or(event.get("provider"))
            .cloned()
            .unwrap_or(Value::Null);
        let mut blocker = Obj::new()
            .set("requestId", request_id)
            .set("turnId", event.turn_value())
            .set("itemId", event.item_value())
            .set("runtimeId", runtime)
            .set("event", event.clone());
        if key == "questions" {
            blocker.insert(
                "questions",
                payload
                    .get("questions")
                    .filter(|q| q.is_array())
                    .cloned()
                    .unwrap_or(json!([])),
            );
        }
        entries.push(blocker.build());
        self.set_interaction(key, entries);
        true
    }

    fn set_interaction(&mut self, key: &str, entries: Vec<Value>) {
        let mut interaction = self
            .get("interaction")
            .as_object()
            .cloned()
            .unwrap_or_default();
        interaction.insert(key.into(), Value::Array(entries));
        self.set("interaction", Value::Object(interaction));
    }

    fn remove_blocker(&mut self, key: &str, request_id: Option<&Value>) -> bool {
        let entries = self.list("interaction", key);
        let length = entries.len();
        let request = request_id.cloned().unwrap_or(Value::Null);
        let kept: Vec<Value> = entries
            .into_iter()
            .filter(|entry| entry.get("requestId").cloned().unwrap_or(Value::Null) != request)
            .collect();
        let changed = kept.len() != length;
        self.set_interaction(key, kept);
        changed
    }

    fn remember_terminal(&mut self, turn_id: Option<&str>) {
        let Some(turn_id) = turn_id.filter(|t| !t.is_empty()) else {
            return;
        };
        let mut turns = self
            .get("terminalTurns")
            .as_array()
            .cloned()
            .unwrap_or_default();
        if turns.iter().any(|t| t.as_str() == Some(turn_id)) {
            return;
        }
        turns.push(Value::from(turn_id));
        let excess = turns.len().saturating_sub(MAX_TERMINAL_TURNS);
        turns.drain(..excess);
        self.set("terminalTurns", turns);
    }

    fn hydrate_control(&mut self, control: &Value) -> bool {
        if !control.is_object() {
            return false;
        }
        let active = control
            .get("activeTurnId")
            .filter(|v| v.is_string())
            .cloned();
        let terminal = terminal_outcome(control.get("terminalState"));
        let next = match active {
            Some(active) => execution(
                "active",
                Some(active),
                None,
                Value::Null,
                Value::Null,
                "unknown",
            ),
            None => execution(
                if terminal.is_some() { "ended" } else { "idle" },
                None,
                None,
                Value::Null,
                terminal.map_or(Value::Null, Value::from),
                "confirmed",
            ),
        };
        self.set("execution", next);
        true
    }

    fn trim_commands(&mut self) {
        if self.commands().len() <= MAX_COMMAND_RECORDS {
            return;
        }
        let protected = self.queue();
        while self.commands().len() > MAX_COMMAND_RECORDS {
            let Some(index) = self.commands().iter().position(|entry| {
                !protected
                    .iter()
                    .any(|id| Some(id) == entry.get("commandId"))
                    && matches!(status_of(entry), "accepted" | "rejected" | "cancelled")
            }) else {
                break;
            };
            self.commands_mut().remove(index);
        }
    }

    fn matches_dispatching_start(&self, submission: &Value) -> bool {
        if !submission.is_object()
            || submission.get("adapterGeneration") != Some(&self.generation())
        {
            return false;
        }
        self.commands().iter().any(|command| {
            command.get("commandId") == submission.get("commandId")
                && command.get("kind") == Some(&Value::from("start"))
                && status_of(command) == "dispatching"
                && command.get("operationId") == submission.get("operationId")
        })
    }
}

fn is_final_command_status(value: &str) -> bool {
    matches!(
        value,
        "accepted" | "rejected" | "cancelled" | "outcome-unknown"
    )
}

fn matches_pending_submission(submission: &Value, identity: &Value) -> bool {
    js::truthy(submission)
        && js::truthy(identity)
        && submission.get("commandId") == identity.get("commandId")
        && submission.get("operationId") == identity.get("operationId")
        && submission.get("adapterGeneration") == identity.get("adapterGeneration")
}

fn bounded_reason(value: Option<&Value>) -> Value {
    match value.and_then(Value::as_str).filter(|v| !v.is_empty()) {
        Some(text) => Value::from(text::head16(text, limits::MAX_CONTROL_REASON_LENGTH)),
        None => Value::Null,
    }
}

fn bounded_command_error(value: &str) -> Value {
    if value.is_empty() {
        Value::Null
    } else {
        Value::from(text::head16(value, limits::MAX_COMMAND_ERROR_LENGTH))
    }
}

fn terminal_outcome(value: Option<&Value>) -> Option<&'static str> {
    match value.and_then(Value::as_str) {
        Some("completed") => Some("completed"),
        Some("failed") => Some("failed"),
        Some("interrupted") => Some("interrupted"),
        _ => None,
    }
}

fn positive_integer_or_null(value: Option<&Value>) -> Value {
    value
        .and_then(js::safe_integer)
        .filter(|n| *n > 0)
        .map_or(Value::Null, Value::from)
}
