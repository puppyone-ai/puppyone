//! `application/session/agent-session-feed.mjs`: a versioned snapshot plus
//! change feed for disposable Renderer replicas.
use super::super::ports::Logger;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::schema::assert_agent_session_frame;
use crate::agent::domain::agent_control_view::project_agent_control_view;
use crate::agent::domain::agent_session_actor::Commit;
use crate::agent::domain::agent_session_model::{SessionRef, session_metadata, session_snapshot};
use crate::agent::sender::Sender;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::{Rc, Weak};

pub const MAX_PENDING_FRAMES: usize = 512;
pub const MAX_PENDING_BYTES: usize = 8 * 1024 * 1024;

struct Frame {
    value: Value,
    revision: i64,
    bytes: usize,
}

impl Frame {
    fn new(value: Value) -> Self {
        Self {
            revision: value["revision"].as_i64().unwrap_or(0),
            bytes: js::json_byte_length(&value),
            value,
        }
    }
}

struct Subscription {
    id: String,
    session_id: String,
    owner_id: u64,
    sender: Sender,
    stream_id: String,
    session_epoch: String,
    ready: bool,
    acknowledged_revision: i64,
    initial_revision: i64,
    buffered_frames: Vec<Rc<Frame>>,
    buffered_bytes: usize,
    unacknowledged_frames: Vec<Rc<Frame>>,
    unacknowledged_bytes: usize,
    needs_resync: bool,
}

struct ActorBinding {
    instance_id: String,
    session_epoch: String,
    actor: crate::agent::domain::agent_session_actor::SessionActor,
    listener: u64,
}

#[derive(Default)]
struct FeedState {
    subscriptions: HashMap<String, Subscription>,
    session_subscriptions: HashMap<String, Vec<String>>,
    actor_cleanups: HashMap<String, ActorBinding>,
}

/// `new AgentSessionFeed({ logger })`.
#[derive(Clone)]
pub struct AgentSessionFeed {
    state: Rc<RefCell<FeedState>>,
    logger: Rc<dyn Logger>,
}

fn control_of(session: &SessionRef) -> Value {
    session.actor.control()
}

impl AgentSessionFeed {
    pub fn new(logger: Rc<dyn Logger>) -> Self {
        Self {
            state: Rc::default(),
            logger,
        }
    }

    /// `feed.attach(session)`.
    pub fn attach(&self, session: &SessionRef) -> AgentResult<Value> {
        let id = session.id();
        let count = self
            .state
            .borrow()
            .session_subscriptions
            .get(&id)
            .map_or(0, Vec::len);
        if count >= 4 {
            return Err(AgentError::new(
                "Agent display subscription budget is exhausted.",
            ));
        }
        self.bind(session);
        let control = control_of(session);
        let subscription_id = format!("subscription-{}", uuid::Uuid::new_v4());
        let revision = control["revision"].as_i64().unwrap_or(0);
        let subscription = Subscription {
            id: subscription_id.clone(),
            session_id: id.clone(),
            owner_id: session.owner_id,
            sender: session.sender.clone(),
            stream_id: control["streamId"].as_str().unwrap_or("").to_string(),
            session_epoch: control["sessionEpoch"].as_str().unwrap_or("").to_string(),
            ready: false,
            acknowledged_revision: revision,
            initial_revision: revision,
            buffered_frames: Vec::new(),
            buffered_bytes: 0,
            unacknowledged_frames: Vec::new(),
            unacknowledged_bytes: 0,
            needs_resync: false,
        };
        {
            let mut state = self.state.borrow_mut();
            state
                .subscriptions
                .insert(subscription_id.clone(), subscription);
            state
                .session_subscriptions
                .entry(id)
                .or_default()
                .push(subscription_id.clone());
        }
        Ok(json!({ "subscriptionId": subscription_id, "snapshot": session_snapshot(session) }))
    }

    /// `feed.acknowledge(session, request)`.
    pub fn acknowledge(&self, session: &SessionRef, request: &Value) -> AgentResult<Value> {
        let subscription_id = request["subscriptionId"].as_str().unwrap_or("").to_string();
        self.require_subscription(session, &subscription_id)?;
        let control = control_of(session);
        let current_revision = control["revision"].as_i64().unwrap_or(0);
        let (resync, buffered) = {
            let mut state = self.state.borrow_mut();
            let subscription = state
                .subscriptions
                .get_mut(&subscription_id)
                .expect("required subscription");
            if request["streamId"].as_str() != Some(subscription.stream_id.as_str()) {
                return Err(AgentError::new("Agent session feed generation is stale."));
            }
            let Some(revision) = request
                .get("revision")
                .and_then(js::safe_integer)
                .filter(|r| *r >= 0)
            else {
                return Err(AgentError::new("Agent session feed revision is invalid."));
            };
            if revision > current_revision {
                return Err(AgentError::new(
                    "Agent session feed acknowledgement is ahead of Main.",
                ));
            }
            if !subscription.ready && revision != subscription.initial_revision {
                return Err(AgentError::new(
                    "Agent session feed acknowledgement does not match its snapshot revision.",
                ));
            }
            if subscription.ready
                && revision > subscription.acknowledged_revision
                && !subscription
                    .unacknowledged_frames
                    .iter()
                    .any(|frame| frame.revision == revision)
            {
                return Err(AgentError::new(
                    "Agent session feed acknowledgement skips an undelivered revision.",
                ));
            }
            subscription.acknowledged_revision = subscription.acknowledged_revision.max(revision);
            let acknowledged = subscription.acknowledged_revision;
            subscription
                .unacknowledged_frames
                .retain(|frame| frame.revision > acknowledged);
            subscription.unacknowledged_bytes = subscription
                .unacknowledged_frames
                .iter()
                .map(|f| f.bytes)
                .sum();
            let first = !subscription.ready;
            subscription.ready = true;
            if subscription.needs_resync {
                subscription.buffered_frames.clear();
                subscription.buffered_bytes = 0;
                (true, Vec::new())
            } else if first {
                subscription.buffered_bytes = 0;
                (false, std::mem::take(&mut subscription.buffered_frames))
            } else {
                (false, Vec::new())
            }
        };
        if resync {
            let (id, stream_id) = self.identity(&subscription_id);
            self.send(
                &subscription_id,
                json!({ "type": "resync-required", "subscriptionId": id, "streamId": stream_id, "revision": current_revision }),
            );
        } else {
            for frame in buffered {
                self.deliver_delta(&subscription_id, frame);
            }
        }
        let state = self.state.borrow();
        let needs_resync = state
            .subscriptions
            .get(&subscription_id)
            .is_some_and(|s| s.needs_resync);
        let stream_id = state
            .subscriptions
            .get(&subscription_id)
            .map(|s| s.stream_id.clone())
            .unwrap_or_default();
        Ok(json!({
            "subscriptionId": subscription_id,
            "streamId": stream_id,
            "revision": current_revision,
            "synchronized": !needs_resync,
        }))
    }

    /// `feed.watermark(session, subscriptionId)`.
    pub fn watermark(&self, session: &SessionRef, subscription_id: &str) -> AgentResult<Value> {
        self.require_subscription(session, subscription_id)?;
        let control = control_of(session);
        let state = self.state.borrow();
        let subscription = &state.subscriptions[subscription_id];
        Ok(json!({
            "subscriptionId": subscription.id,
            "streamId": control["streamId"],
            "revision": control["revision"],
            "acknowledgedRevision": subscription.acknowledged_revision,
            "resyncRequired": subscription.needs_resync,
        }))
    }

    /// `feed.detach(session, subscriptionId)`.
    pub fn detach(&self, session: &SessionRef, subscription_id: &str) -> AgentResult<Value> {
        self.require_subscription(session, subscription_id)?;
        self.remove(subscription_id);
        Ok(json!({ "subscriptionId": subscription_id, "detached": true }))
    }

    /// `feed.releaseSession(sessionId, instanceId)`.
    pub fn release_session(&self, session_id: &str, instance_id: Option<&str>) {
        if let Some(instance) = instance_id
            && self
                .state
                .borrow()
                .actor_cleanups
                .get(session_id)
                .map(|b| b.instance_id.as_str())
                != Some(instance)
        {
            return;
        }
        let ids = self
            .state
            .borrow()
            .session_subscriptions
            .get(session_id)
            .cloned()
            .unwrap_or_default();
        for id in ids {
            self.remove(&id);
        }
        let binding = self.state.borrow_mut().actor_cleanups.remove(session_id);
        if let Some(binding) = binding {
            binding.actor.unsubscribe(binding.listener);
        }
    }

    /// `feed.releaseAll()`.
    pub fn release_all(&self) {
        let ids: Vec<String> = self.state.borrow().actor_cleanups.keys().cloned().collect();
        for id in ids {
            self.release_session(&id, None);
        }
    }

    fn bind(&self, session: &SessionRef) {
        let id = session.id();
        let control = control_of(session);
        let epoch = control["sessionEpoch"].as_str().unwrap_or("").to_string();
        let existing_epoch = self
            .state
            .borrow()
            .actor_cleanups
            .get(&id)
            .map(|b| b.session_epoch.clone());
        if existing_epoch.as_deref() == Some(epoch.as_str()) {
            return;
        }
        if existing_epoch.is_some() {
            let ids = self
                .state
                .borrow()
                .session_subscriptions
                .get(&id)
                .cloned()
                .unwrap_or_default();
            for subscription in ids {
                self.remove(&subscription);
            }
            if let Some(binding) = self.state.borrow_mut().actor_cleanups.remove(&id) {
                binding.actor.unsubscribe(binding.listener);
            }
        }
        let feed = Rc::downgrade(&self.state);
        let logger = self.logger.clone();
        let weak_session: Weak<_> = Rc::downgrade(session);
        let listener = session.actor.subscribe(move |commit| {
            let (Some(state), Some(session)) = (feed.upgrade(), weak_session.upgrade()) else {
                return;
            };
            AgentSessionFeed {
                state,
                logger: logger.clone(),
            }
            .publish(&session, commit);
        });
        self.state.borrow_mut().actor_cleanups.insert(
            id,
            ActorBinding {
                instance_id: session.instance_id.clone(),
                session_epoch: epoch,
                actor: session.actor.clone(),
                listener,
            },
        );
    }

    fn publish(&self, session: &SessionRef, commit: &Commit) {
        let ids = self
            .state
            .borrow()
            .session_subscriptions
            .get(&session.id())
            .cloned()
            .unwrap_or_default();
        for subscription_id in ids {
            let (ready, needs_resync) = {
                let state = self.state.borrow();
                let Some(subscription) = state.subscriptions.get(&subscription_id) else {
                    continue;
                };
                if subscription.stream_id != commit.stream_id {
                    continue;
                }
                (subscription.ready, subscription.needs_resync)
            };
            let metadata = Obj::from(&session_metadata(session, Some(&commit.control)))
                .set("lastSequence", commit.sequence)
                .set(
                    "updatedAt",
                    commit
                        .emitted_at
                        .clone()
                        .unwrap_or_else(|| session.updated_at()),
                )
                .build();
            let frame = Rc::new(Frame::new(json!({
                "type": "delta",
                "subscriptionId": subscription_id,
                "streamId": commit.stream_id,
                "baseRevision": commit.base_revision,
                "revision": commit.revision,
                "control": project_agent_control_view(&commit.control),
                "displayPatch": commit.display_patch,
                "session": metadata,
            })));
            if ready {
                self.deliver_delta(&subscription_id, frame);
            } else if !needs_resync {
                let overflow = {
                    let mut state = self.state.borrow_mut();
                    let subscription = state
                        .subscriptions
                        .get_mut(&subscription_id)
                        .expect("subscription");
                    subscription.buffered_bytes += frame.bytes;
                    subscription.buffered_frames.push(frame.clone());
                    let overflow = subscription.buffered_frames.len() > MAX_PENDING_FRAMES
                        || subscription.buffered_bytes > MAX_PENDING_BYTES;
                    let counts = (
                        subscription.buffered_frames.len(),
                        subscription.buffered_bytes,
                    );
                    if overflow {
                        subscription.buffered_frames.clear();
                        subscription.buffered_bytes = 0;
                        subscription.needs_resync = true;
                    }
                    overflow.then_some(counts)
                };
                if let Some((frames, bytes)) = overflow {
                    self.log_resync(
                        &subscription_id,
                        "pre-ack-buffer-overflow",
                        frames,
                        bytes,
                        frame.revision,
                    );
                }
            }
        }
    }

    fn identity(&self, subscription_id: &str) -> (String, String) {
        let state = self.state.borrow();
        let subscription = &state.subscriptions[subscription_id];
        (subscription.id.clone(), subscription.stream_id.clone())
    }

    fn send(&self, subscription_id: &str, frame: Value) {
        let sender = {
            let state = self.state.borrow();
            let Some(subscription) = state.subscriptions.get(subscription_id) else {
                return;
            };
            subscription.sender.clone()
        };
        if sender.is_destroyed() {
            self.remove(subscription_id);
            return;
        }
        match assert_agent_session_frame(&frame) {
            Ok(()) => sender.send_frame(frame),
            Err(error) => {
                self.logger.warn(
                    &format!(
                        "Unable to deliver Agent session frame: {}",
                        redact_secret_text(&error.0)
                    ),
                    Value::Null,
                );
                self.remove(subscription_id);
            }
        }
    }

    fn deliver_delta(&self, subscription_id: &str, frame: Rc<Frame>) {
        let overflow = {
            let mut state = self.state.borrow_mut();
            let Some(subscription) = state.subscriptions.get_mut(subscription_id) else {
                return;
            };
            if subscription.needs_resync {
                return;
            }
            subscription.unacknowledged_bytes += frame.bytes;
            subscription.unacknowledged_frames.push(frame.clone());
            let overflow = subscription.unacknowledged_frames.len() > MAX_PENDING_FRAMES
                || subscription.unacknowledged_bytes > MAX_PENDING_BYTES;
            let counts = (
                subscription.unacknowledged_frames.len(),
                subscription.unacknowledged_bytes,
            );
            if overflow {
                subscription.unacknowledged_frames.clear();
                subscription.unacknowledged_bytes = 0;
                subscription.needs_resync = true;
            }
            overflow.then_some(counts)
        };
        if let Some((frames, bytes)) = overflow {
            self.log_resync(
                subscription_id,
                "unacknowledged-buffer-overflow",
                frames,
                bytes,
                frame.revision,
            );
            let (id, stream_id) = self.identity(subscription_id);
            self.send(
                subscription_id,
                json!({ "type": "resync-required", "subscriptionId": id, "streamId": stream_id, "revision": frame.revision }),
            );
            return;
        }
        self.send(subscription_id, frame.value.clone());
    }

    fn log_resync(
        &self,
        subscription_id: &str,
        cause: &str,
        frame_count: usize,
        byte_count: usize,
        revision: i64,
    ) {
        let (acknowledged, stream_id) = {
            let state = self.state.borrow();
            let Some(subscription) = state.subscriptions.get(subscription_id) else {
                return;
            };
            (
                subscription.acknowledged_revision,
                subscription.stream_id.clone(),
            )
        };
        self.logger.warn(
            "Agent display feed requires resync",
            json!({
                "cause": cause,
                "frameCount": frame_count,
                "byteCount": byte_count,
                "revision": revision,
                "acknowledgedRevision": acknowledged,
                "streamId": stream_id,
            }),
        );
    }

    fn require_subscription(&self, session: &SessionRef, subscription_id: &str) -> AgentResult<()> {
        let epoch = control_of(session)["sessionEpoch"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let state = self.state.borrow();
        let valid = state
            .subscriptions
            .get(subscription_id)
            .is_some_and(|subscription| {
                subscription.session_id == session.id()
                    && subscription.owner_id == session.owner_id
                    && subscription.session_epoch == epoch
            });
        if !valid {
            return Err(AgentError::new(
                "Agent session subscription is stale or not owned by this window.",
            ));
        }
        Ok(())
    }

    fn remove(&self, subscription_id: &str) {
        let mut state = self.state.borrow_mut();
        let Some(subscription) = state.subscriptions.remove(subscription_id) else {
            return;
        };
        let session_id = subscription.session_id;
        let empty = match state.session_subscriptions.get_mut(&session_id) {
            Some(ids) => {
                ids.retain(|id| id != subscription_id);
                ids.is_empty()
            }
            None => false,
        };
        if empty {
            state.session_subscriptions.remove(&session_id);
            if let Some(binding) = state.actor_cleanups.remove(&session_id) {
                drop(state);
                binding.actor.unsubscribe(binding.listener);
            }
        }
    }
}
