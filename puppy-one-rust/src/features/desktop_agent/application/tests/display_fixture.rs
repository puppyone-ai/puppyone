//! `tests/support/agent/agentDisplayFixture.ts`: a display-feed transport
//! fixture. Event interpretation stays in the Main control and transcript
//! reducers, as in production.
use super::fake_client::FakeClient;
use crate::agent::agent_error::AgentError;
use crate::agent::contract::display_state::create_agent_display_patch;
use crate::agent::contract::display_types::AgentDisplay;
use crate::agent::contract::js;
use crate::agent::domain::agent_control_view::project_agent_control_view;
use crate::agent::domain::agent_session_control::{
    create_agent_session_control, reduce_agent_session_control,
};
use crate::agent::domain::transcript::display_control::project_agent_display_control;
use crate::agent::domain::transcript::display_projection::ProjectionOptions;
use crate::agent::domain::transcript::message_identity::associate_agent_user_message;
use crate::agent::domain::transcript::transcript_reducer::{
    apply_agent_event, create_agent_projection, project_agent_user_submission,
};
use crate::features::desktop_agent::fixtures::JsonAnswer as ClientFuture;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

fn reduce(control: &Value, input: Value) -> Value {
    reduce_agent_session_control(control, &input)
        .expect("control input")
        .unwrap_or_else(|| control.clone())
}

fn display_of(snapshot: &Value) -> AgentDisplay {
    AgentDisplay::from_value(&snapshot["display"]).expect("display")
}

/// `{ ...session, activeTurnId, terminalState }` of a projected display.
fn with_display_state(session: &Value, display: &AgentDisplay) -> Value {
    let mut session = session.clone();
    session["activeTurnId"] = display.get("runningTurnId").cloned().unwrap_or(Value::Null);
    match display
        .get("presentation")
        .and_then(|p| p.get("terminalState"))
    {
        Some(terminal) => session["terminalState"] = terminal.clone(),
        None => js::delete(&mut session, "terminalState"),
    }
    session
}

/// `displaySnapshot(raw)`.
pub fn display_snapshot(raw: &Value) -> Value {
    let session_id = raw["session"]["id"].as_str().unwrap_or_default();
    let explicit = raw.get("control").filter(|c| !c.is_null()).cloned();
    let mut control = explicit.clone().unwrap_or_else(|| {
        let control = create_agent_session_control(
            &format!("stream:{session_id}"),
            &format!("epoch:{session_id}"),
            "idle",
            0,
        );
        reduce(&control, json!({ "type": "adapter.attached" }))
    });
    let mut display = create_agent_projection();
    for event in raw["events"].as_array().cloned().unwrap_or_default() {
        display = apply_agent_event(&display, &event, ProjectionOptions::default());
        if explicit.is_none() {
            control = reduce(
                &control,
                json!({ "type": "event.accepted", "event": event }),
            );
        }
    }
    let display = project_agent_display_control(&display, &control);
    let mut snapshot = raw.clone();
    snapshot["session"] = with_display_state(&raw["session"], &display);
    snapshot["display"] = display.to_value();
    snapshot["cursor"] =
        json!({ "streamId": control["streamId"], "revision": control["revision"] });
    snapshot["control"] = control;
    snapshot
}

struct Subscription {
    session_id: String,
    ready: bool,
    frames: Vec<Value>,
}

/// `withDisplayFeed(bridge, bind)`.
pub struct DisplayFeed {
    bridge: Rc<FakeClient>,
    snapshots: RefCell<HashMap<String, Value>>,
    subscriptions: RefCell<Vec<(String, Subscription)>>,
    next_id: Cell<u64>,
}

impl DisplayFeed {
    pub fn install(bridge: &Rc<FakeClient>) -> Rc<Self> {
        let feed = Rc::new(Self {
            bridge: bridge.clone(),
            snapshots: RefCell::default(),
            subscriptions: RefCell::default(),
            next_id: Cell::new(0),
        });
        let weak = Rc::downgrade(&feed);
        bridge.handle("attachAgentSession", move |request| {
            let feed = weak.upgrade().expect("feed");
            let result = feed.attach(&request);
            Box::pin(async move { result })
        });
        let weak = Rc::downgrade(&feed);
        bridge.handle("acknowledgeAgentSession", move |request| {
            let feed = weak.upgrade().expect("feed");
            Box::pin(async move { Ok(feed.acknowledge(request)) })
        });
        let weak = Rc::downgrade(&feed);
        bridge.handle("detachAgentSession", move |request| {
            let feed = weak.upgrade().expect("feed");
            let subscription_id = js::string_or_empty(request.get("subscriptionId"));
            feed.subscriptions
                .borrow_mut()
                .retain(|(id, _)| *id != subscription_id);
            Box::pin(
                async move { Ok(json!({ "subscriptionId": subscription_id, "detached": true })) },
            )
        });
        let weak = Rc::downgrade(&feed);
        bridge.handle("readAgentSessionWatermark", move |request| {
            let feed = weak.upgrade().expect("feed");
            let cursor = feed
                .snapshots
                .borrow()
                .get(request["sessionId"].as_str().unwrap_or_default())
                .map(|snapshot| snapshot["cursor"].clone())
                .unwrap_or(Value::Null);
            let mut watermark =
                json!({ "subscriptionId": request["subscriptionId"], "resyncRequired": false });
            watermark["streamId"] = cursor["streamId"].clone();
            watermark["revision"] = cursor["revision"].clone();
            Box::pin(async move { Ok(watermark) })
        });
        let weak = Rc::downgrade(&feed);
        bridge.intercept(move |method, request, invoke| {
            let Some(feed) = weak.upgrade() else {
                return invoke(request);
            };
            if ![
                "createAgentSession",
                "resumeAgentSession",
                "openAgentSession",
                "startAgentTurn",
            ]
            .contains(&method)
            {
                return invoke(request);
            }
            if method == "startAgentTurn" {
                feed.admit(&request);
            }
            let call = invoke(request.clone());
            let method = method.to_string();
            Box::pin(async move {
                match call.await {
                    Ok(result) => Ok(feed.register(result)),
                    Err(error) => {
                        if method == "startAgentTurn" {
                            feed.reject(&request, &error);
                        }
                        Err(error)
                    }
                }
            }) as ClientFuture
        });
        feed
    }

    /// `emit(event)`: a native event through Main's reducers.
    pub fn emit(&self, event: Value) {
        let session_id = js::string_or_empty(event.get("sessionId"));
        let Some(previous) = self.snapshots.borrow().get(&session_id).cloned() else {
            return;
        };
        let event = associate_agent_user_message(&event, &previous["control"]);
        let control = reduce(
            &previous["control"],
            json!({ "type": "event.accepted", "event": event }),
        );
        let display = project_agent_display_control(
            &apply_agent_event(&display_of(&previous), &event, ProjectionOptions::default()),
            &control,
        );
        let mut next = previous.clone();
        let mut events = previous["events"].as_array().cloned().unwrap_or_default();
        events.push(event.clone());
        next["events"] = Value::Array(events);
        next["cursor"] =
            json!({ "streamId": control["streamId"], "revision": control["revision"] });
        next["lastSequence"] = event["sequence"].clone();
        let mut session = with_display_state(&previous["session"], &display);
        session["lastSequence"] = event["sequence"].clone();
        next["session"] = session;
        next["display"] = display.to_value();
        next["control"] = control;
        self.publish(&session_id, next);
    }

    /// The current snapshot of `session_id`.
    pub fn snapshot(&self, session_id: &str) -> Option<Value> {
        self.snapshots.borrow().get(session_id).cloned()
    }

    fn publish(&self, session_id: &str, next: Value) {
        let previous = self
            .snapshots
            .borrow_mut()
            .insert(session_id.to_string(), next.clone());
        let Some(previous) = previous else {
            return;
        };
        let patch = create_agent_display_patch(&display_of(&previous), &display_of(&next));
        let mut ready = Vec::new();
        for (subscription_id, subscription) in self.subscriptions.borrow_mut().iter_mut() {
            if subscription.session_id != session_id {
                continue;
            }
            let frame = json!({
                "type": "delta",
                "subscriptionId": subscription_id,
                "streamId": next["control"]["streamId"],
                "baseRevision": previous["control"]["revision"],
                "revision": next["control"]["revision"],
                "control": project_agent_control_view(&next["control"]),
                "session": next["session"],
                "displayPatch": patch,
            });
            if subscription.ready {
                ready.push(frame);
            } else {
                subscription.frames.push(frame);
            }
        }
        for frame in ready {
            self.bridge.frame(frame);
        }
    }

    fn attach(&self, request: &Value) -> Result<Value, AgentError> {
        let session_id = js::string_or_empty(request.get("sessionId"));
        let id = self.next_id.get() + 1;
        self.next_id.set(id);
        let subscription_id = format!("subscription-{id}");
        self.subscriptions.borrow_mut().push((
            subscription_id.clone(),
            Subscription {
                session_id: session_id.clone(),
                ready: false,
                frames: Vec::new(),
            },
        ));
        let mut snapshot = self.snapshot(&session_id).ok_or_else(|| {
            AgentError::new("Cannot read properties of undefined (reading 'control')")
        })?;
        snapshot["control"] = project_agent_control_view(&snapshot["control"]);
        Ok(json!({ "subscriptionId": subscription_id, "snapshot": snapshot }))
    }

    fn acknowledge(&self, request: Value) -> Value {
        let subscription_id = js::string_or_empty(request.get("subscriptionId"));
        let frames = {
            let mut subscriptions = self.subscriptions.borrow_mut();
            match subscriptions
                .iter_mut()
                .find(|(id, _)| *id == subscription_id)
            {
                Some((_, subscription)) if !subscription.ready => {
                    subscription.ready = true;
                    std::mem::take(&mut subscription.frames)
                }
                _ => Vec::new(),
            }
        };
        for frame in frames {
            self.bridge.frame(frame);
        }
        let mut receipt = request;
        receipt["synchronized"] = Value::Bool(true);
        receipt
    }

    /// Main's admission of a start command before the native receipt.
    fn admit(&self, request: &Value) {
        let session_id = js::string_or_empty(request.get("sessionId"));
        let Some(previous) = self.snapshot(&session_id) else {
            return;
        };
        let command_id = js::string_or_empty(request.get("commandId"));
        let operation_id = format!("operation:{command_id}");
        let or_null = |value: &Value| {
            if value.is_null() {
                Value::Null
            } else {
                value.clone()
            }
        };
        let intent = json!({
            "prompt": request["prompt"],
            "promptMentions": request.get("promptMentions").filter(|m| !m.is_null()).cloned().unwrap_or_else(|| json!([])),
            "referenceDisplays": [],
            "model": or_null(&request["model"]),
            "effort": or_null(&request["effort"]),
            "mode": or_null(&request["mode"]),
        });
        let mut control = reduce(
            &previous["control"],
            json!({ "type": "command.received", "command": {
                "commandId": command_id, "kind": "start", "status": "dispatching",
                "userMessageId": format!("client:{command_id}"), "intentFingerprint": command_id, "intent": intent,
            } }),
        );
        control = reduce(
            &control,
            json!({ "type": "command.dispatching", "commandId": command_id, "operationId": operation_id }),
        );
        control = reduce(
            &control,
            json!({ "type": "submission.prepared", "submission": {
                "commandId": command_id, "operationId": operation_id, "adapterGeneration": control["adapterGeneration"],
                "prompt": request["prompt"], "promptMentions": [], "referenceDisplays": [],
            }, "startedAtMs": js::now_ms() }),
        );
        let command = control["commands"]
            .as_array()
            .and_then(|commands| {
                commands
                    .iter()
                    .find(|c| c["commandId"] == command_id.as_str())
            })
            .cloned();
        let display = project_agent_user_submission(&display_of(&previous), command.as_ref());
        let mut next = previous;
        next["display"] = project_agent_display_control(&display, &control).to_value();
        next["control"] = control;
        self.publish(&session_id, next);
    }

    fn reject(&self, request: &Value, error: &AgentError) {
        let session_id = js::string_or_empty(request.get("sessionId"));
        let Some(previous) = self.snapshot(&session_id) else {
            return;
        };
        let control = reduce(
            &previous["control"],
            json!({ "type": "command.rejected", "commandId": request["commandId"], "error": format!("Error: {}", error.message) }),
        );
        let mut next = previous.clone();
        next["display"] =
            project_agent_display_control(&display_of(&previous), &control).to_value();
        next["control"] = control;
        self.publish(&session_id, next);
    }

    /// Registers a returned snapshot (`displaySnapshot`) and returns it.
    fn register(&self, result: Value) -> Value {
        let nested = js::truthy(&result["snapshot"]);
        let snapshot = if nested { &result["snapshot"] } else { &result };
        if !js::truthy(&snapshot["session"]) {
            return result;
        }
        let session_id = js::string_or_empty(snapshot["session"].get("id"));
        let registered = display_snapshot(snapshot);
        self.snapshots
            .borrow_mut()
            .insert(session_id, registered.clone());
        if nested {
            let mut result = result;
            result["snapshot"] = registered;
            result
        } else {
            registered
        }
    }
}
