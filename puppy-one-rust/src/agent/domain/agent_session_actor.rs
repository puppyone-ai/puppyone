//! `domain/agent-session-actor.mjs`: the single mutable owner of one
//! session's product control state and ledger. Transactions are synchronous
//! and contain no native I/O; effects run in application coordinators after
//! admission, and their receipts re-enter here.
use super::agent_event_checkpoint::fold_agent_event_checkpoint;
use super::agent_session_control::{
    MAX_TERMINAL_TURNS, create_agent_session_control, reduce_agent_session_control, reduce_control,
};
use super::transcript::display_control::project_agent_display_control;
use super::transcript::display_projection::ProjectionOptions;
use super::transcript::display_window::bound_agent_display;
use super::transcript::message_identity::associate_agent_user_message;
use super::transcript::transcript_reducer::{
    apply_agent_event, apply_agent_events, create_agent_projection, project_agent_user_submission,
};
use crate::agent::agent_events::{EnvelopeInput, count_text_bytes, create_agent_event_envelope};
use crate::agent::contract::display_schema::assert_display;
use crate::agent::contract::display_state::create_agent_display_patch;
use crate::agent::contract::display_types::AgentDisplay;
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::schema::assert_agent_session_control;
use crate::agent::contract::types::AgentEventView;
use crate::clock;
use serde_json::{Map, Value, json};
use std::cell::{Cell, RefCell};
use std::collections::{HashSet, VecDeque};
use std::rc::Rc;

pub const MAX_REPLAY_EVENTS: usize = 1_000;
pub const MAX_REPLAY_BYTES: usize = 2 * 1024 * 1024;

/// A transaction the actor refused; its state is unchanged.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActorError(pub String);

impl std::fmt::Display for ActorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ActorError {}

fn err(error: impl std::fmt::Display) -> ActorError {
    ActorError(error.to_string())
}

/// One committed revision, as every subscriber sees it.
#[derive(Clone, Debug)]
pub struct Commit {
    pub stream_id: String,
    pub base_revision: i64,
    pub revision: i64,
    pub control: Value,
    pub sequence: i64,
    pub emitted_at: Option<String>,
    pub input: Value,
    pub display_patch: Value,
    pub events: Vec<Value>,
}

/// The result of a control input.
#[derive(Clone, Debug)]
pub struct ControlResult {
    pub changed: bool,
    pub control: Value,
    pub commit: Option<Commit>,
}

/// An adapter event admitted into the ledger.
#[derive(Clone, Debug)]
pub struct EventInput {
    pub session_id: String,
    pub runtime_id: String,
    pub provider_session_id: Option<String>,
    /// `{ type, turnId?, itemId?, payload?, emittedAt?, providerSessionId? }`.
    pub event: Value,
}

/// `actor.snapshot()`.
#[derive(Clone, Debug)]
pub struct ActorSnapshot {
    pub cursor: Value,
    pub control: Value,
    pub display: AgentDisplay,
    pub timeline: Value,
}

pub struct AgentSessionActor {
    control: Value,
    display: AgentDisplay,
    clock: Box<dyn Fn() -> i64>,
    events: VecDeque<Value>,
    sequence: i64,
    replay_bytes: usize,
    checkpoint_by_turn: Map<String, Value>,
    terminal_outcome_by_turn: Map<String, Value>,
}

/// `new AgentSessionActor({ events, sequence, terminalState, clock })`.
#[derive(Default)]
pub struct ActorOptions {
    pub events: Vec<Value>,
    pub sequence: i64,
    pub terminal_state: Option<String>,
    pub clock: Option<Box<dyn Fn() -> i64>>,
}

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

impl AgentSessionActor {
    pub fn new(options: ActorOptions) -> Result<Self, ActorError> {
        let clock = options.clock.unwrap_or_else(|| Box::new(clock::now_ms));
        let events: VecDeque<Value> = options.events.into_iter().collect();
        let sequence = events
            .iter()
            .map(|e| e.sequence())
            .fold(options.sequence.max(0), i64::max);
        let replay_bytes = events.iter().map(count_text_bytes).sum();
        let mut control = create_agent_session_control(
            &uuid(),
            &uuid(),
            options.terminal_state.as_deref().unwrap_or("idle"),
            0,
        );
        let mut actor = Self {
            control: Value::Null,
            display: AgentDisplay::default(),
            clock,
            events,
            sequence,
            replay_bytes,
            checkpoint_by_turn: Map::new(),
            terminal_outcome_by_turn: Map::new(),
        };
        for event in actor.events.clone() {
            actor.remember_terminal_outcome(&event);
            control = reduce_control(
                &control,
                &json!({ "type": "event.accepted", "event": event }),
            )
            .map_err(err)?;
        }
        if !actor.events.is_empty() {
            control = reduce_control(
                &control,
                &json!({ "type": "recovery.unconfirmed", "reason": "native-state-unconfirmed-after-main-restart" }),
            )
            .map_err(err)?;
        }
        let mut projection = apply_agent_events(
            &create_agent_projection(),
            actor.events.make_contiguous(),
            ProjectionOptions::default(),
        );
        // A new display starts at the persisted ledger position. Native history
        // will supply its content; old event numbers are not missing messages.
        projection.set("lastSequence", sequence);
        let display = bound_agent_display(
            project_agent_display_control(&projection, &control),
            &control,
        );
        assert_display(&display).map_err(err)?;
        assert_agent_session_control(&control, "Agent session control").map_err(err)?;
        actor.control = control;
        actor.display = display;
        actor.enforce_replay_limits();
        Ok(actor)
    }

    pub fn display(&self) -> &AgentDisplay {
        &self.display
    }
    pub fn control(&self) -> &Value {
        &self.control
    }
    pub fn sequence(&self) -> i64 {
        self.sequence
    }
    pub fn replay_bytes(&self) -> usize {
        self.replay_bytes
    }
    pub fn events(&self) -> Vec<Value> {
        self.events.iter().cloned().collect()
    }
    /// `actor.terminalOutcome(turnId)`.
    pub fn terminal_outcome(&self, turn_id: &str) -> Option<&str> {
        self.terminal_outcome_by_turn
            .get(turn_id)
            .and_then(Value::as_str)
    }

    /// `actor.dispatch(input)` without notifying subscribers (see
    /// [`SessionActor`]).
    pub fn dispatch(&mut self, input: Value) -> Result<ControlResult, ActorError> {
        self.apply_control(input)
    }

    /// `actor.appendEvent(input)` without notifying subscribers: the
    /// committed envelope and its commit.
    pub fn append_event(&mut self, input: EventInput) -> Result<(Value, Commit), ActorError> {
        self.apply_event(input)
    }

    fn apply_control(&mut self, mut input: Value) -> Result<ControlResult, ActorError> {
        let input_type = js::str_or_empty(input.get("type")).to_string();
        if input_type == "command.received"
            && input["command"]["kind"] == "start"
            && !js::truthy_opt(input["command"].get("userMessageId"))
        {
            input["command"]["userMessageId"] = Value::from(uuid());
        }
        if input_type == "submission.prepared" && js::nullish(input.get("startedAtMs")) {
            input["startedAtMs"] = Value::from((self.clock)());
        }
        let previous = self.control.clone();
        let Some(next) = reduce_agent_session_control(&previous, &input).map_err(err)? else {
            return Ok(ControlResult {
                changed: false,
                control: previous,
                commit: None,
            });
        };
        assert_agent_session_control(&next, "Agent session control").map_err(err)?;
        // Admission is a product display fact, not a fabricated native history event.
        let admitted = if input_type == "command.received" && input["command"]["kind"] == "start" {
            let command_id = &input["command"]["commandId"];
            let command = next["commands"]
                .as_array()
                .and_then(|commands| commands.iter().find(|c| &c["commandId"] == command_id));
            project_agent_user_submission(&self.display, command)
        } else if input_type == "history.loaded" {
            let coverage = input.get("coverage").cloned().unwrap_or(Value::Null);
            let reason = if coverage == "complete" {
                Value::Null
            } else {
                input
                    .get("reason")
                    .filter(|r| !r.is_null())
                    .cloned()
                    .unwrap_or(Value::from("unverified"))
            };
            let mut display = self.display.clone();
            display.set("history", json!({ "coverage": coverage, "reason": reason }));
            display
        } else {
            self.display.clone()
        };
        let display = bound_agent_display(project_agent_display_control(&admitted, &next), &next);
        assert_display(&display).map_err(err)?;
        let display_patch = create_agent_display_patch(&self.display, &display);
        self.display = display;
        self.control = next.clone();
        let commit = Commit {
            stream_id: js::str_or_empty(next.get("streamId")).to_string(),
            base_revision: previous["revision"].as_i64().unwrap_or(0),
            revision: next["revision"].as_i64().unwrap_or(0),
            control: next.clone(),
            sequence: self.sequence,
            emitted_at: None,
            input,
            display_patch,
            events: Vec::new(),
        };
        Ok(ControlResult {
            changed: true,
            control: next,
            commit: Some(commit),
        })
    }

    fn apply_event(&mut self, input: EventInput) -> Result<(Value, Commit), ActorError> {
        let event = associate_agent_user_message(&input.event, &self.control);
        let string = |key: &str| event.get(key).and_then(Value::as_str).map(str::to_string);
        let envelope = create_agent_event_envelope(EnvelopeInput {
            sequence: self.sequence + 1,
            emitted_at: Some(
                string("emittedAt").unwrap_or_else(|| clock::iso_string((self.clock)())),
            ),
            session_id: input.session_id,
            runtime_id: input.runtime_id,
            provider_session_id: string("providerSessionId").or(input.provider_session_id),
            turn_id: string("turnId"),
            item_id: string("itemId"),
            event_type: event.event_type().to_string(),
            payload: event.get("payload").cloned().unwrap_or_else(|| json!({})),
        })
        .map_err(err)?;
        let previous = self.control.clone();
        let next = reduce_control(
            &previous,
            &json!({ "type": "event.accepted", "event": envelope }),
        )
        .map_err(err)?;
        assert_agent_session_control(&next, "Agent session control").map_err(err)?;
        let applied = apply_agent_event(&self.display, &envelope, ProjectionOptions::default());
        let display = bound_agent_display(project_agent_display_control(&applied, &next), &next);
        assert_display(&display).map_err(err)?;
        let display_patch = create_agent_display_patch(&self.display, &display);
        self.display = display;
        self.remember_terminal_outcome(&envelope);
        self.sequence = envelope.sequence();
        self.replay_bytes += count_text_bytes(&envelope);
        self.events.push_back(envelope.clone());
        self.control = next.clone();
        self.enforce_replay_limits();
        let commit = Commit {
            stream_id: js::str_or_empty(next.get("streamId")).to_string(),
            base_revision: previous["revision"].as_i64().unwrap_or(0),
            revision: next["revision"].as_i64().unwrap_or(0),
            control: next,
            sequence: envelope.sequence(),
            emitted_at: envelope
                .get("emittedAt")
                .and_then(Value::as_str)
                .map(str::to_string),
            input: json!({ "type": "event.accepted", "event": envelope }),
            display_patch,
            events: vec![envelope.clone()],
        };
        Ok((envelope, commit))
    }

    /// `actor.snapshot()`.
    pub fn snapshot(&self) -> ActorSnapshot {
        let events = self.events();
        let retained: HashSet<i64> = events.iter().map(|e| e.sequence()).collect();
        let materialized_prefix = self
            .checkpoint_by_turn
            .values()
            .flat_map(|events| events.as_array().cloned().unwrap_or_default());
        let blockers = ["approvals", "questions"].iter().flat_map(|key| {
            self.control["interaction"][*key]
                .as_array()
                .cloned()
                .unwrap_or_default()
        });
        let mut checkpoint_events: Vec<Value> = Vec::new();
        let mut seen = HashSet::new();
        for entry in materialized_prefix.chain(blockers) {
            let event = match entry.get("event").filter(|e| js::truthy(e)) {
                Some(event) if !retained.contains(&event.sequence()) => event.clone(),
                Some(_) => continue,
                None if js::truthy_opt(entry.get("type")) => entry,
                None => continue,
            };
            if seen.insert(event.sequence()) {
                checkpoint_events.push(event);
            }
        }
        checkpoint_events.sort_by_key(|e| e.sequence());
        let first_available = events.first().map_or(self.sequence + 1, |e| e.sequence());
        let partial = events.first().is_some_and(|e| e.sequence() > 1);
        ActorSnapshot {
            cursor: json!({ "streamId": self.control["streamId"], "revision": self.control["revision"] }),
            control: self.control.clone(),
            display: self.display.clone(),
            timeline: Obj::new()
                .set("events", events)
                .set("checkpointEvents", checkpoint_events)
                .set("partial", partial)
                .set("firstAvailableSequence", first_available)
                .set("lastSequence", self.sequence)
                .build(),
        }
    }

    fn remember_terminal_outcome(&mut self, event: &Value) {
        let Some(turn_id) = event.turn_id().filter(|t| !t.is_empty()) else {
            return;
        };
        let Some(outcome) = event
            .event_type()
            .strip_prefix("turn.")
            .filter(|o| matches!(*o, "completed" | "failed" | "interrupted"))
        else {
            return;
        };
        self.terminal_outcome_by_turn.shift_remove(turn_id);
        self.terminal_outcome_by_turn
            .insert(turn_id.to_string(), Value::from(outcome));
        while self.terminal_outcome_by_turn.len() > MAX_TERMINAL_TURNS {
            let Some(oldest) = self.terminal_outcome_by_turn.keys().next().cloned() else {
                break;
            };
            self.terminal_outcome_by_turn.shift_remove(&oldest);
        }
    }

    fn discard_expired_checkpoints(&mut self) {
        let mut retained: HashSet<String> = self
            .events
            .iter()
            .filter_map(|e| e.turn_id().filter(|t| !t.is_empty()).map(str::to_string))
            .collect();
        if let Some(active) = self.control["execution"]["activeTurnId"]
            .as_str()
            .filter(|t| !t.is_empty())
        {
            retained.insert(active.to_string());
        }
        self.checkpoint_by_turn
            .retain(|turn, _| retained.contains(turn));
    }

    fn enforce_replay_limits(&mut self) {
        while self.events.len() > MAX_REPLAY_EVENTS
            || (self.replay_bytes > MAX_REPLAY_BYTES && self.events.len() > 1)
        {
            let Some(removed) = self.events.pop_front() else {
                break;
            };
            self.replay_bytes = self.replay_bytes.saturating_sub(count_text_bytes(&removed));
            if let Some(turn) = removed.turn_id().filter(|t| !t.is_empty()) {
                let previous = self
                    .checkpoint_by_turn
                    .get(turn)
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let folded = fold_agent_event_checkpoint(&previous, &removed);
                self.checkpoint_by_turn
                    .insert(turn.to_string(), Value::Array(folded));
            }
        }
        self.discard_expired_checkpoints();
    }
}

type Listener = Rc<dyn Fn(&Commit)>;

/// The shared actor a session's coordinators hold (`session.actor`):
/// mailbox transactions commit synchronously, then every subscriber sees
/// each commit in revision order. A subscriber may dispatch again; its
/// commit is published after the one being delivered.
#[derive(Clone)]
pub struct SessionActor(Rc<ActorCell>);

struct ActorCell {
    state: RefCell<AgentSessionActor>,
    listeners: RefCell<Vec<(u64, Listener)>>,
    next_listener: Cell<u64>,
    notifications: RefCell<VecDeque<Commit>>,
    publishing: Cell<bool>,
}

impl SessionActor {
    pub fn new(options: ActorOptions) -> Result<Self, ActorError> {
        Ok(Self(Rc::new(ActorCell {
            state: RefCell::new(AgentSessionActor::new(options)?),
            listeners: RefCell::new(Vec::new()),
            next_listener: Cell::new(0),
            notifications: RefCell::new(VecDeque::new()),
            publishing: Cell::new(false),
        })))
    }

    /// Reads the actor's state.
    pub fn read<R>(&self, read: impl FnOnce(&AgentSessionActor) -> R) -> R {
        read(&self.0.state.borrow())
    }

    /// `actor.control`.
    pub fn control(&self) -> Value {
        self.read(|actor| actor.control().clone())
    }

    /// `actor.display`.
    pub fn display(&self) -> AgentDisplay {
        self.read(|actor| actor.display().clone())
    }

    /// `actor.sequence`.
    pub fn sequence(&self) -> i64 {
        self.read(AgentSessionActor::sequence)
    }

    /// `actor.events()`.
    pub fn events(&self) -> Vec<Value> {
        self.read(AgentSessionActor::events)
    }

    /// `actor.snapshot()`.
    pub fn snapshot(&self) -> ActorSnapshot {
        self.read(AgentSessionActor::snapshot)
    }

    /// `actor.dispatch(input)`.
    pub fn dispatch(&self, input: Value) -> Result<ControlResult, ActorError> {
        let result = self.0.state.borrow_mut().dispatch(input)?;
        if let Some(commit) = &result.commit {
            self.notify(commit.clone());
        }
        Ok(result)
    }

    /// `actor.appendEvent(input)`.
    pub fn append_event(&self, input: EventInput) -> Result<Value, ActorError> {
        let (envelope, commit) = self.0.state.borrow_mut().append_event(input)?;
        self.notify(commit);
        Ok(envelope)
    }

    /// `actor.subscribe(listener)`: the id [`Self::unsubscribe`] takes.
    pub fn subscribe(&self, listener: impl Fn(&Commit) + 'static) -> u64 {
        let id = self.0.next_listener.get() + 1;
        self.0.next_listener.set(id);
        self.0.listeners.borrow_mut().push((id, Rc::new(listener)));
        id
    }

    pub fn unsubscribe(&self, id: u64) {
        self.0
            .listeners
            .borrow_mut()
            .retain(|(listener, _)| *listener != id);
    }

    /// Whether two handles name the same actor (`session.actor === other`).
    pub fn ptr_eq(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    fn notify(&self, commit: Commit) {
        self.0.notifications.borrow_mut().push_back(commit);
        if self.0.publishing.replace(true) {
            return;
        }
        loop {
            let Some(committed) = self.0.notifications.borrow_mut().pop_front() else {
                break;
            };
            let listeners: Vec<Listener> = self
                .0
                .listeners
                .borrow()
                .iter()
                .map(|(_, l)| l.clone())
                .collect();
            for listener in listeners {
                // One subscriber cannot stop later revisions.
                let _ =
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| listener(&committed)));
            }
        }
        self.0.publishing.set(false);
    }
}
