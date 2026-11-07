//! `application/AgentTurnSubmissionCoordinator.ts`: captures and advances
//! immutable prompt/configuration/reference intents.
use super::agent_client_port::{AgentClient as _, AgentClientProvider, require_bridge};
use super::agent_controller_state::{AgentControllerState, StatePatch};
use super::agent_error::{ErrorDescriptor, create_agent_error, format_agent_error};
use super::agent_reference_draft_manager::AgentReferenceDraftManager;
use super::agent_session_controller::{AgentControllerStore, command_preconditions};
use super::ui_runtime::random_uuid;
use crate::agent::agent_error::AgentResult;
use crate::agent::contract::dto::{Capability, DraftReference, PromptMention, SubmissionIntent};
use crate::agent::contract::protocol::{AgentOperation, StartTurn, SteerTurn};
use crate::text;
use futures_util::future::LocalBoxFuture;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

/// `writeDraft(draft, mentions)`.
pub type WriteDraft = Rc<dyn Fn(&str, &[PromptMention])>;

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

type Dispatch = Box<dyn FnOnce(String) -> LocalBoxFuture<'static, AgentResult<()>>>;

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
        let bridge =
            match require_bridge(&inner.options.bridge_provider, &[AgentOperation::StartTurn]) {
                Ok(bridge) => bridge,
                Err(error) => return Box::pin(async move { Err(error) }),
            };
        let state = inner.options.store.snapshot();
        let normalized = normalize_submission_draft(prompt, &state.draft_mentions);
        let text = normalized.0;
        let reference_inputs = state
            .inspection
            .as_ref()
            .and_then(|i| i.capabilities.as_ref())
            .and_then(|c| c.reference_inputs.as_ref());
        let attachment_only =
            !state.references.is_empty() && reference_inputs.is_some_and(|r| r.attachment_only);
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
            .any(|reference| !reference.is_ready())
        {
            inner.options.store.patch(
                StatePatch::new().error(Some(create_agent_error("references-not-ready", None))),
            );
            return Box::pin(async { Ok(false) });
        }
        if state.capability(Capability::ModelSelection) && state.selected_model.is_none() {
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
            && state.capability(Capability::Steer)
            && bridge.supports(AgentOperation::SteerTurn)
        {
            if !intent.references.is_empty() && !reference_inputs.is_some_and(|r| r.steer) {
                inner
                    .options
                    .store
                    .patch(StatePatch::new().error(Some(create_agent_error(
                        "steer-references-unsupported",
                        None,
                    ))));
                return Box::pin(async { Ok(false) });
            }
            let request = SteerTurn {
                root_path: inner.options.workspace_root.clone(),
                session_id: String::new(),
                turn_id: active_turn_id.clone(),
                command_id: Some(intent.id.clone()),
                preconditions: command_preconditions(&state),
                message: text.clone(),
                reference_epoch: Some(intent.reference_epoch.clone()),
                prompt_mentions: Some(intent.prompt_mentions.clone()),
                references: Some(intent.references.clone()),
            };
            let dispatch: Dispatch = Box::new(move |session_id| {
                let call = bridge.steer_turn(SteerTurn {
                    session_id,
                    ..request
                });
                Box::pin(async move { call.await.map(drop) })
            });
            return inner.dispatch_intent(intent, dispatch, false);
        }
        if active_turn_id.is_some() && !state.capability(Capability::Queue) {
            return Box::pin(async { Ok(false) });
        }
        let store = inner.options.store.clone();
        let root = inner.options.workspace_root.clone();
        let captured = intent.clone();
        let dispatch: Dispatch = Box::new(move |session_id| {
            let call = bridge.start_turn(StartTurn {
                root_path: root,
                session_id,
                command_id: Some(captured.id.clone()),
                preconditions: store.read(command_preconditions),
                prompt: captured.prompt.clone(),
                model: captured.model.clone(),
                effort: captured.effort.clone(),
                mode: captured.mode.clone(),
                reference_epoch: Some(captured.reference_epoch.clone()),
                references: Some(captured.references.clone()),
                prompt_mentions: Some(captured.prompt_mentions.clone()),
                ..StartTurn::default()
            });
            Box::pin(async move { call.await.map(drop) })
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
        let bridge =
            match require_bridge(&inner.options.bridge_provider, &[AgentOperation::StartTurn]) {
                Ok(bridge) => bridge,
                Err(error) => return Box::pin(async move { Err(error) }),
            };
        let state = inner.options.store.snapshot();
        let latest_turn = state.projection.turns.last().cloned();
        let text = text::trim(prompt).to_string();
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
        if latest_turn.id != turn_id
            || latest_turn.status != "completed"
            || latest_turn.completion_quality.as_deref() != Some("degraded")
            || latest_turn
                .recovery
                .as_ref()
                .is_none_or(|recovery| recovery.kind != "degraded-completion")
        {
            return Box::pin(async { Ok(false) });
        }
        if state.capability(Capability::ModelSelection) && state.selected_model.is_none() {
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
            let call = bridge.start_turn(StartTurn {
                root_path: root,
                session_id,
                command_id: Some(captured.id.clone()),
                recovery_of_turn_id: Some(turn_id),
                preconditions: store.read(command_preconditions),
                prompt: captured.prompt.clone(),
                model: captured.model.clone(),
                effort: captured.effort.clone(),
                mode: captured.mode.clone(),
                reference_epoch: Some(captured.reference_epoch.clone()),
                references: Some(Vec::new()),
                prompt_mentions: Some(Vec::new()),
                ..StartTurn::default()
            });
            Box::pin(async move { call.await.map(drop) })
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
        intent: SubmissionIntent,
        dispatch: Dispatch,
        preserve_draft: bool,
    ) -> LocalBoxFuture<'static, AgentResult<bool>> {
        let intent_id = intent.id.clone();
        *self.active_intent_id.borrow_mut() = Some(intent_id.clone());
        let session_id = self.session_id();
        let mut patch = StatePatch::new()
            .submitting(true)
            .pending_prompt(Some(intent.prompt.clone()))
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
                let epoch = intent.reference_epoch.clone();
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
                            .is_some_and(|control| control.connection.status == "exited")
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
                                    control.command(&intent.id).is_some_and(|command| {
                                        ["queued", "dispatching", "accepted", "outcome-unknown"]
                                            .contains(&command.status.as_str())
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

    fn prepare_failure(&self) -> Option<ErrorDescriptor> {
        Some(
            self.options
                .store
                .read(|state| state.error.clone())
                .unwrap_or_else(|| create_agent_error("session-prepare-failed", None)),
        )
    }

    fn release_submitted_previews(&self, intent: &SubmissionIntent) {
        let retained: Vec<String> = self
            .options
            .store
            .read(|state| state.references.iter().map(|r| r.id.clone()).collect());
        let released: Vec<DraftReference> = intent
            .references
            .iter()
            .filter(|r| !retained.contains(&r.id))
            .cloned()
            .collect();
        self.options.references.release_previews(&released);
    }

    fn restore_draft(&self, intent: &SubmissionIntent, error: Option<ErrorDescriptor>) {
        let (draft, mentions, references) = self.options.store.read(|state| {
            (
                state.draft.clone(),
                state.draft_mentions.clone(),
                state.references.clone(),
            )
        });
        let (prompt, mentions) = merge_failed_draft(intent, &draft, &mentions);
        let intent_references = intent.references.clone();
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

/// `createSubmissionIntent({ … })`. The product's destructuring drops a
/// `recoveryOfTurnId` from the intent.
fn create_submission_intent(
    reference_epoch: &str,
    prompt: &str,
    state: &AgentControllerState,
    references: &[DraftReference],
    prompt_mentions: &[PromptMention],
) -> SubmissionIntent {
    SubmissionIntent {
        id: format!("intent-{}", random_uuid()),
        recovery_of_turn_id: None,
        reference_epoch: reference_epoch.to_string(),
        prompt: prompt.to_string(),
        model: state.selected_model.clone(),
        effort: state.selected_effort.clone(),
        mode: state.selected_mode.clone(),
        references: references.to_vec(),
        prompt_mentions: prompt_mentions.to_vec(),
    }
}

/// `normalizeSubmissionDraft(prompt, mentions)`.
fn normalize_submission_draft(
    prompt: &str,
    mentions: &[PromptMention],
) -> (String, Vec<PromptMention>) {
    let leading = text::len16(prompt) - text::len16(text::trim_start(prompt));
    let trailing_boundary = text::len16(text::trim_end(prompt));
    let normalized = text::slice16(prompt, leading, trailing_boundary.max(leading)).to_string();
    let mentions = mentions
        .iter()
        .filter(|mention| mention.start >= leading && mention.end <= trailing_boundary)
        .map(|mention| PromptMention {
            reference_id: mention.reference_id.clone(),
            start: mention.start - leading,
            end: mention.end - leading,
        })
        .collect();
    (normalized, mentions)
}

/// `mergeFailedDraft(failed, currentPrompt, currentMentions)`.
fn merge_failed_draft(
    failed: &SubmissionIntent,
    current_prompt: &str,
    current_mentions: &[PromptMention],
) -> (String, Vec<PromptMention>) {
    let failed_prompt = failed.prompt.clone();
    let failed_mentions = failed.prompt_mentions.clone();
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
    let offset = text::len16(&failed_prompt) + text::len16(separator);
    let mut mentions = failed_mentions;
    for mention in current_mentions {
        mentions.push(PromptMention {
            reference_id: mention.reference_id.clone(),
            start: mention.start + offset,
            end: mention.end + offset,
        });
    }
    (
        format!("{failed_prompt}{separator}{current_prompt}"),
        mentions,
    )
}
