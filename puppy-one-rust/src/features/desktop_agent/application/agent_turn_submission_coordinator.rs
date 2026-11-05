//! `application/AgentTurnSubmissionCoordinator.ts`: captures and advances
//! immutable prompt/configuration/reference intents.
use super::agent_client_port::{AgentClientProvider, require_bridge};
use super::agent_controller_state::{AgentControllerState, StatePatch};
use super::agent_error::{create_agent_error, format_agent_error};
use super::agent_reference_draft_manager::AgentReferenceDraftManager;
use super::agent_session_controller::{AgentControllerStore, command_preconditions};
use super::ui_runtime::random_uuid;
use crate::agent::agent_error::AgentResult;
use crate::agent::contract::js;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::rc::Rc;

/// `writeDraft(draft, mentions)`.
pub type WriteDraft = Rc<dyn Fn(&str, &[Value])>;

pub struct AgentTurnSubmissionCoordinatorOptions {
    pub workspace_root: String,
    pub bridge_provider: AgentClientProvider,
    pub references: AgentReferenceDraftManager,
    pub store: Rc<AgentControllerStore>,
    pub write_draft: WriteDraft,
    pub prepare_session: Rc<dyn Fn() -> LocalBoxFuture<'static, bool>>,
    pub reconnect_session: Rc<dyn Fn() -> LocalBoxFuture<'static, AgentResult<bool>>>,
}

#[derive(Clone)]
pub struct AgentTurnSubmissionCoordinator(Rc<Inner>);

struct Inner {
    options: AgentTurnSubmissionCoordinatorOptions,
    active_intent_id: RefCell<Option<String>>,
    disposed: Cell<bool>,
}

type Dispatch = Box<dyn FnOnce(String) -> LocalBoxFuture<'static, AgentResult<Value>>>;

impl AgentTurnSubmissionCoordinator {
    pub fn new(options: AgentTurnSubmissionCoordinatorOptions) -> Self {
        Self(Rc::new(Inner {
            options,
            active_intent_id: RefCell::default(),
            disposed: Cell::new(false),
        }))
    }

    /// Detach local receipts when the owning conversation is replaced.
    pub fn invalidate(&self) {
        *self.0.active_intent_id.borrow_mut() = None;
        self.0.options.store.patch(
            StatePatch::new()
                .submitting(false)
                .pending_intent(None)
                .pending_prompt(None),
        );
    }

    pub fn dispose(&self) {
        self.0.disposed.set(true);
        *self.0.active_intent_id.borrow_mut() = None;
    }

    pub fn submit(&self, prompt: &str) -> LocalBoxFuture<'static, AgentResult<bool>> {
        let inner = self.0.clone();
        if inner.disposed.get() || inner.active_intent_id.borrow().is_some() {
            return Box::pin(async { Ok(false) });
        }
        let bridge = match require_bridge(&inner.options.bridge_provider, &["startAgentTurn"]) {
            Ok(bridge) => bridge,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        let state = inner.options.store.snapshot();
        let normalized = normalize_submission_draft(prompt, &state.draft_mentions);
        let text = normalized.0;
        let capabilities = state
            .inspection
            .as_ref()
            .map(|i| i["capabilities"].clone())
            .unwrap_or(Value::Null);
        let attachment_only = !state.references.is_empty()
            && capabilities["referenceInputs"]["attachmentOnly"] == true;
        if (text.is_empty() && !attachment_only)
            || state.submitting
            || state.pending_intent.is_some()
            || matches!(
                state.replica_status,
                super::agent_controller_state::ReplicaStatus::Stale
                    | super::agent_controller_state::ReplicaStatus::Subscribing
            )
        {
            return Box::pin(async { Ok(false) });
        }
        if state
            .references
            .iter()
            .any(|reference| reference["status"] != "ready")
        {
            inner.options.store.patch(
                StatePatch::new().error(Some(create_agent_error("references-not-ready", None))),
            );
            return Box::pin(async { Ok(false) });
        }
        if js::truthy(&capabilities["modelSelection"]) && state.selected_model.is_none() {
            inner
                .options
                .store
                .patch(StatePatch::new().error(Some(create_agent_error("model-required", None))));
            return Box::pin(async { Ok(false) });
        }
        let intent = create_submission_intent(
            &inner.options.references.reference_epoch(),
            &text,
            &state,
            &state.references,
            &normalized.1,
        );
        let active_turn_id = state.running_turn_id().map(str::to_string);
        if let Some(active_turn_id) = active_turn_id.as_ref()
            && state.session.is_some()
            && js::truthy(&capabilities["steer"])
            && bridge.implements("steerAgentTurn")
        {
            if intent["references"]
                .as_array()
                .is_some_and(|r| !r.is_empty())
                && capabilities["referenceInputs"]["steer"] != true
            {
                inner
                    .options
                    .store
                    .patch(StatePatch::new().error(Some(create_agent_error(
                        "steer-references-unsupported",
                        None,
                    ))));
                return Box::pin(async { Ok(false) });
            }
            let request = {
                let mut request = json!({
                    "rootPath": inner.options.workspace_root,
                    "commandId": intent["id"],
                    "turnId": active_turn_id,
                });
                spread(&mut request, &command_preconditions(&state));
                request["message"] = Value::from(text.as_str());
                request["referenceEpoch"] = intent["referenceEpoch"].clone();
                request["references"] = intent["references"].clone();
                request["promptMentions"] = intent["promptMentions"].clone();
                request
            };
            let dispatch: Dispatch = Box::new(move |session_id| {
                let mut request = request;
                request["sessionId"] = Value::from(session_id);
                bridge.call("steerAgentTurn", request)
            });
            return inner.dispatch_intent(intent, dispatch, false);
        }
        if active_turn_id.is_some() && !js::truthy(&capabilities["queue"]) {
            return Box::pin(async { Ok(false) });
        }
        let store = inner.options.store.clone();
        let root = inner.options.workspace_root.clone();
        let captured = intent.clone();
        let dispatch: Dispatch = Box::new(move |session_id| {
            let mut request =
                json!({ "rootPath": root, "sessionId": session_id, "commandId": captured["id"] });
            spread(&mut request, &store.read(command_preconditions));
            for key in [
                "prompt",
                "model",
                "effort",
                "mode",
                "referenceEpoch",
                "references",
                "promptMentions",
            ] {
                request[key] = captured[key].clone();
            }
            bridge.call("startAgentTurn", request)
        });
        inner.dispatch_intent(intent, dispatch, false)
    }

    /// Starts an explicit follow-up without consuming the user's independent
    /// draft or references.
    pub fn continue_from_recovery(
        &self,
        turn_id: &str,
        prompt: &str,
    ) -> LocalBoxFuture<'static, AgentResult<bool>> {
        let inner = self.0.clone();
        if inner.disposed.get() || inner.active_intent_id.borrow().is_some() {
            return Box::pin(async { Ok(false) });
        }
        let bridge = match require_bridge(&inner.options.bridge_provider, &["startAgentTurn"]) {
            Ok(bridge) => bridge,
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        let state = inner.options.store.snapshot();
        let latest_turn = state.projection.turns.last().cloned();
        let text = js::trim(prompt).to_string();
        if text.is_empty()
            || state.session.is_none()
            || state.submitting
            || state.pending_intent.is_some()
            || state.running_turn_id().is_some()
            || matches!(
                state.replica_status,
                super::agent_controller_state::ReplicaStatus::Stale
                    | super::agent_controller_state::ReplicaStatus::Subscribing
            )
        {
            return Box::pin(async { Ok(false) });
        }
        let Some(latest_turn) = latest_turn else {
            return Box::pin(async { Ok(false) });
        };
        if latest_turn["id"] != turn_id
            || latest_turn["status"] != "completed"
            || latest_turn["completionQuality"] != "degraded"
            || latest_turn["recovery"]["kind"] != "degraded-completion"
        {
            return Box::pin(async { Ok(false) });
        }
        if state.capability("modelSelection") && state.selected_model.is_none() {
            inner
                .options
                .store
                .patch(StatePatch::new().error(Some(create_agent_error("model-required", None))));
            return Box::pin(async { Ok(false) });
        }
        let intent = create_submission_intent(
            &inner.options.references.reference_epoch(),
            &text,
            &state,
            &[],
            &[],
        );
        let store = inner.options.store.clone();
        let root = inner.options.workspace_root.clone();
        let captured = intent.clone();
        let turn_id = turn_id.to_string();
        let dispatch: Dispatch = Box::new(move |session_id| {
            let mut request = json!({
                "rootPath": root,
                "sessionId": session_id,
                "commandId": captured["id"],
                "recoveryOfTurnId": turn_id,
            });
            spread(&mut request, &store.read(command_preconditions));
            for key in ["prompt", "model", "effort", "mode", "referenceEpoch"] {
                request[key] = captured[key].clone();
            }
            request["references"] = json!([]);
            request["promptMentions"] = json!([]);
            bridge.call("startAgentTurn", request)
        });
        inner.dispatch_intent(intent, dispatch, true)
    }
}

impl Inner {
    fn session_id(&self) -> Option<String> {
        self.options
            .store
            .read(|state| state.session_id().map(str::to_string))
    }

    fn dispatch_intent(
        self: &Rc<Self>,
        intent: Value,
        dispatch: Dispatch,
        preserve_draft: bool,
    ) -> LocalBoxFuture<'static, AgentResult<bool>> {
        let intent_id = js::string_or_empty(intent.get("id"));
        *self.active_intent_id.borrow_mut() = Some(intent_id.clone());
        let session_id = self.session_id();
        let mut patch = StatePatch::new()
            .submitting(true)
            .pending_prompt(intent["prompt"].as_str().map(str::to_string))
            .pending_intent(Some(intent.clone()));
        if !preserve_draft {
            patch = patch
                .draft(String::new())
                .draft_mentions(Vec::new())
                .references(Vec::new());
        }
        self.options.store.patch(patch.error(None));
        if !preserve_draft {
            (self.options.write_draft)("", &[]);
        }
        let inner = self.clone();
        Box::pin(async move {
            let session = Rc::new(RefCell::new(session_id));
            let is_current = {
                let inner = inner.clone();
                let session = session.clone();
                let intent_id = intent_id.clone();
                let epoch = js::string_or_empty(intent.get("referenceEpoch"));
                move || {
                    !inner.disposed.get()
                        && inner.active_intent_id.borrow().as_deref() == Some(intent_id.as_str())
                        && inner.options.references.reference_epoch() == epoch
                        && session
                            .borrow()
                            .as_ref()
                            .is_none_or(|id| inner.session_id().as_deref() == Some(id.as_str()))
                }
            };
            let result: AgentResult<bool> = async {
                let exited = session.borrow().is_some()
                    && inner.options.store.read(|state| {
                        state
                            .control
                            .as_ref()
                            .is_some_and(|control| control["connection"]["status"] == "exited")
                    });
                if exited {
                    let reconnected = (inner.options.reconnect_session)().await?;
                    if !is_current() {
                        return Ok(false);
                    }
                    *session.borrow_mut() = inner.session_id();
                    if !reconnected || session.borrow().is_none() {
                        inner.restore_draft(&intent, inner.prepare_failure());
                        return Ok(false);
                    }
                }
                if session.borrow().is_none() {
                    let prepared = (inner.options.prepare_session)().await;
                    if !is_current() {
                        return Ok(false);
                    }
                    *session.borrow_mut() = inner.session_id();
                    if !prepared || session.borrow().is_none() {
                        inner.restore_draft(&intent, inner.prepare_failure());
                        return Ok(false);
                    }
                }
                let session_id = session.borrow().clone().unwrap_or_default();
                dispatch(session_id).await?;
                if !is_current() {
                    return Ok(false);
                }
                inner.release_submitted_previews(&intent);
                // The request result is a delivery acknowledgement, not
                // execution authority. turn.started/terminal facts alone
                // drive the visible phase.
                Ok(true)
            }
            .await;
            let outcome =
                match result {
                    Ok(submitted) => submitted,
                    Err(error) => {
                        if is_current() {
                            let accepted = inner.options.store.read(|observed| {
                                observed.control.as_ref().is_some_and(|control| {
                                    control["commands"].as_array().is_some_and(|commands| {
                                        commands.iter().any(|command| {
                                            command["commandId"] == intent["id"]
                                                && [
                                                    "queued",
                                                    "dispatching",
                                                    "accepted",
                                                    "outcome-unknown",
                                                ]
                                                .iter()
                                                .any(|status| command["status"] == *status)
                                        })
                                    })
                                })
                            });
                            // A visible input proves local admission, not native
                            // delivery. Only Main's delivery state determines
                            // whether a failed request may restore the draft.
                            if accepted {
                                inner.release_submitted_previews(&intent);
                                inner.options.store.patch(
                                    StatePatch::new().error(Some(format_agent_error(&error))),
                                );
                            } else if !preserve_draft {
                                inner.restore_draft(&intent, Some(format_agent_error(&error)));
                            } else {
                                inner.options.store.patch(
                                    StatePatch::new().error(Some(format_agent_error(&error))),
                                );
                            }
                        }
                        false
                    }
                };
            // Local ownership, rather than the optional presentation field,
            // releases the lock even after preparation fails without
            // creating a Main session.
            if !inner.disposed.get()
                && inner.active_intent_id.borrow().as_deref() == Some(intent_id.as_str())
            {
                *inner.active_intent_id.borrow_mut() = None;
                inner.options.store.patch(
                    StatePatch::new()
                        .submitting(false)
                        .pending_intent(None)
                        .pending_prompt(None),
                );
            }
            Ok(outcome)
        })
    }

    fn prepare_failure(&self) -> Option<Value> {
        Some(
            self.options
                .store
                .read(|state| state.error.clone())
                .unwrap_or_else(|| create_agent_error("session-prepare-failed", None)),
        )
    }

    fn release_submitted_previews(&self, intent: &Value) {
        let retained: Vec<String> = self.options.store.read(|state| {
            state
                .references
                .iter()
                .map(|r| js::string_or_empty(r.get("id")))
                .collect()
        });
        let released: Vec<Value> = intent["references"]
            .as_array()
            .map(|references| {
                references
                    .iter()
                    .filter(|r| !retained.contains(&js::string_or_empty(r.get("id"))))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        self.options.references.release_previews(&released);
    }

    fn restore_draft(&self, intent: &Value, error: Option<Value>) {
        let (draft, mentions, references) = self.options.store.read(|state| {
            (
                state.draft.clone(),
                state.draft_mentions.clone(),
                state.references.clone(),
            )
        });
        let (prompt, mentions) = merge_failed_draft(intent, &draft, &mentions);
        let intent_references = intent["references"].as_array().cloned().unwrap_or_default();
        self.options.store.patch(
            StatePatch::new()
                .draft(prompt.clone())
                .draft_mentions(mentions.clone())
                .references(
                    self.options
                        .references
                        .merge_and_validate(&intent_references, &references),
                )
                .error(error),
        );
        (self.options.write_draft)(&prompt, &mentions);
    }
}

/// `{ ...request, ...extra }`.
fn spread(request: &mut Value, extra: &Value) {
    if let (Some(request), Some(extra)) = (request.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            request.insert(key.clone(), value.clone());
        }
    }
}

/// `createSubmissionIntent({ … })`. The product's destructuring drops a
/// `recoveryOfTurnId` from the intent.
fn create_submission_intent(
    reference_epoch: &str,
    prompt: &str,
    state: &AgentControllerState,
    references: &[Value],
    prompt_mentions: &[Value],
) -> Value {
    json!({
        "id": format!("intent-{}", random_uuid()),
        "referenceEpoch": reference_epoch,
        "prompt": prompt,
        "model": state.selected_model,
        "effort": state.selected_effort,
        "mode": state.selected_mode,
        "references": references,
        "promptMentions": prompt_mentions,
    })
}

/// `normalizeSubmissionDraft(prompt, mentions)`.
fn normalize_submission_draft(prompt: &str, mentions: &[Value]) -> (String, Vec<Value>) {
    let leading = js::len16(prompt) - js::len16(js::trim_start(prompt));
    let trailing_boundary = js::len16(js::trim_end(prompt));
    let normalized = js::slice16(prompt, leading, trailing_boundary.max(leading)).to_string();
    let mentions = mentions
        .iter()
        .filter_map(|mention| {
            let start = mention["start"].as_i64()?;
            let end = mention["end"].as_i64()?;
            if start < leading as i64 || end > trailing_boundary as i64 {
                return None;
            }
            let mut mention = mention.clone();
            mention["start"] = Value::from(start - leading as i64);
            mention["end"] = Value::from(end - leading as i64);
            Some(mention)
        })
        .collect();
    (normalized, mentions)
}

/// `mergeFailedDraft(failed, currentPrompt, currentMentions)`.
fn merge_failed_draft(
    failed: &Value,
    current_prompt: &str,
    current_mentions: &[Value],
) -> (String, Vec<Value>) {
    let failed_prompt = js::string_or_empty(failed.get("prompt"));
    let failed_mentions = failed["promptMentions"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if failed_prompt.is_empty() {
        return (current_prompt.to_string(), current_mentions.to_vec());
    }
    if current_prompt.is_empty() {
        return (failed_prompt, failed_mentions);
    }
    if current_prompt == failed_prompt {
        return (current_prompt.to_string(), current_mentions.to_vec());
    }
    let separator = "\n\n";
    let offset = (js::len16(&failed_prompt) + js::len16(separator)) as i64;
    let mut mentions = failed_mentions;
    for mention in current_mentions {
        let mut mention = mention.clone();
        mention["start"] = Value::from(mention["start"].as_i64().unwrap_or(0) + offset);
        mention["end"] = Value::from(mention["end"].as_i64().unwrap_or(0) + offset);
        mentions.push(mention);
    }
    (
        format!("{failed_prompt}{separator}{current_prompt}"),
        mentions,
    )
}
