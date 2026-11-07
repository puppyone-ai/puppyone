//! `application/agent-reference-policy.mjs`: preparing a turn's reference
//! input, and the claims that keep leased attachment tokens and private
//! paths owned by exactly one operation or turn.
use super::agent_input_policy::{
    bind_prompt_reference_mention_delivery, compile_agent_prompt_reference_mentions,
    normalize_authorized_references, normalize_prompt, normalize_prompt_reference_mentions,
    normalize_reference_displays, require_supported_agent_references,
};
use super::ports::AttachmentStore;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::Obj;
use crate::agent::domain::agent_session_model::{AgentSession, ReferenceClaim};
use crate::clock;
use regex::Regex;
use serde_json::Value;
use std::rc::Rc;
use std::sync::LazyLock;

static LEASE_TOKEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_-]{32,256}$").expect("lease token"));

/// The input a start or steer carries once references are authorized.
#[derive(Clone, Debug, Default)]
pub struct PreparedInput {
    pub references: Vec<Value>,
    pub reference_displays: Vec<Value>,
    /// Private path → display name, scrubbed from native output.
    pub private_reference_paths: Vec<(String, String)>,
    pub display_prompt: String,
    pub prompt_mentions: Vec<Value>,
    /// The prompt the runtime receives (mentions compiled).
    pub prompt: String,
}

/// The identity of one dispatch (`{ commandId, operationId, adapterGeneration }`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperationIdentity {
    pub command_id: String,
    pub operation_id: String,
    pub adapter_generation: i64,
}

fn private_paths(references: &[Value]) -> Vec<(String, String)> {
    let mut paths = Vec::new();
    for reference in references
        .iter()
        .filter(|r| r["kind"] == "staged-attachment")
    {
        let name = reference["displayName"].as_str().unwrap_or("").to_string();
        if let Some(path) = reference["path"].as_str() {
            paths.push((path.to_string(), name.clone()));
        }
        if let Some(url) = reference["snapshotUrl"].as_str() {
            paths.push((url.to_string(), name));
        }
    }
    paths
}

fn list(request: &Value, key: &str) -> Vec<Value> {
    request
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// `prepareAgentTurnReferenceInput(request, capabilities, deliveryForReference)`.
pub fn prepare_agent_turn_reference_input(
    request: &Value,
    capabilities: Option<&Value>,
    delivery_for_reference: &dyn Fn(&Value) -> Option<&'static str>,
) -> AgentResult<PreparedInput> {
    let mut all = list(request, "references");
    all.extend(list(request, "contextReferences"));
    all.extend(list(request, "attachments"));
    let authorized = normalize_authorized_references(&all)?;
    require_supported_agent_references(capabilities, &authorized)?;
    let attachment_only =
        capabilities.is_some_and(|c| c["referenceInputs"]["attachmentOnly"] == true);
    let display_prompt = normalize_prompt(
        request.get("prompt"),
        !authorized.is_empty() && attachment_only,
    )?;
    let prompt_mentions = normalize_prompt_reference_mentions(
        request.get("promptMentions"),
        &display_prompt,
        &authorized,
    )?;
    let references = bind_prompt_reference_mention_delivery(
        &authorized,
        &prompt_mentions,
        delivery_for_reference,
    );
    let prompt =
        compile_agent_prompt_reference_mentions(&display_prompt, &prompt_mentions, &references)?;
    Ok(PreparedInput {
        reference_displays: normalize_reference_displays(&references),
        private_reference_paths: private_paths(&references),
        references,
        display_prompt,
        prompt_mentions,
        prompt,
    })
}

/// `beginAgentTurnReferences(session, request, identity, preparedInput)`.
pub fn begin_agent_turn_references(
    session: &AgentSession,
    request: &Value,
    identity: &OperationIdentity,
    input: &PreparedInput,
) -> AgentResult<()> {
    let result = session.actor.dispatch(serde_json::json!({
        "type": "submission.prepared",
        "startedAtMs": clock::now_ms(),
        "submission": {
            "commandId": identity.command_id,
            "operationId": identity.operation_id,
            "adapterGeneration": identity.adapter_generation,
            "prompt": input.display_prompt,
            "promptMentions": input.prompt_mentions,
            "referenceDisplays": input.reference_displays,
        },
    }))?;
    if !result.changed {
        return Err(AgentError::new(
            "The Agent start operation is no longer current.",
        ));
    }
    set_reference_claim(
        session,
        &claim_key("start", identity),
        ReferenceClaim {
            tokens: private_reference_lease_tokens(request),
            paths: input.private_reference_paths.clone(),
        },
    );
    Ok(())
}

/// `abandonAgentTurnReferences(session, identity)`.
pub fn abandon_agent_turn_references(session: &AgentSession, identity: &OperationIdentity) -> bool {
    let changed = session
        .actor
        .dispatch(serde_json::json!({
            "type": "submission.abandoned",
            "commandId": identity.command_id,
            "operationId": identity.operation_id,
            "adapterGeneration": identity.adapter_generation,
        }))
        .is_ok_and(|result| result.changed);
    let released = delete_reference_claim(session, &claim_key("start", identity));
    changed || released
}

/// `acceptAgentTurnReferences(session, identity, turnId)`.
pub fn accept_agent_turn_references(
    session: &AgentSession,
    identity: &OperationIdentity,
    turn_id: &str,
) -> bool {
    move_claim_to_turn(session, &claim_key("start", identity), turn_id)
}

fn move_claim_to_turn(session: &AgentSession, source: &str, turn_id: &str) -> bool {
    let Some(claim) = take_claim(session, source, turn_id) else {
        return false;
    };
    merge_reference_claim(session, &format!("turn:{turn_id}"), claim);
    true
}

fn take_claim(session: &AgentSession, source: &str, turn_id: &str) -> Option<ReferenceClaim> {
    let index = session
        .state()
        .reference_claims
        .iter()
        .position(|(key, _)| key == source)?;
    if session.active_turn_id().as_deref() != Some(turn_id) {
        return None;
    }
    Some(session.state_mut().reference_claims.remove(index).1)
}

/// `prepareAgentSteerReferenceInput(request, capabilities, deliveryForReference)`.
pub fn prepare_agent_steer_reference_input(
    request: &Value,
    capabilities: Option<&Value>,
    delivery_for_reference: &dyn Fn(&Value) -> Option<&'static str>,
) -> AgentResult<PreparedInput> {
    let authorized = normalize_authorized_references(&list(request, "references"))?;
    if !authorized.is_empty() && capabilities.is_none_or(|c| c["referenceInputs"]["steer"] != true)
    {
        return Err(AgentError::new(
            "The active Agent runtime does not support references while steering.",
        ));
    }
    require_supported_agent_references(capabilities, &authorized)?;
    let attachment_only =
        capabilities.is_some_and(|c| c["referenceInputs"]["attachmentOnly"] == true);
    let display_message = normalize_prompt(
        request.get("message"),
        !authorized.is_empty() && attachment_only,
    )?;
    let prompt_mentions = normalize_prompt_reference_mentions(
        request.get("promptMentions"),
        &display_message,
        &authorized,
    )?;
    let references = bind_prompt_reference_mention_delivery(
        &authorized,
        &prompt_mentions,
        delivery_for_reference,
    );
    let message =
        compile_agent_prompt_reference_mentions(&display_message, &prompt_mentions, &references)?;
    Ok(PreparedInput {
        private_reference_paths: private_paths(&references),
        references,
        prompt_mentions,
        prompt: message,
        display_prompt: display_message,
        reference_displays: Vec::new(),
    })
}

/// `scrubPrivateReferencePaths(value, replacements)`.
pub fn scrub_private_reference_paths(value: &Value, replacements: &[(String, String)]) -> Value {
    fn scrub(value: &Value, replacements: &[(String, String)], depth: usize) -> Value {
        if depth > 12 {
            return value.clone();
        }
        match value {
            Value::String(text) => {
                let mut output = text.clone();
                for (private_path, display_name) in replacements {
                    if !private_path.is_empty() {
                        output = output.replace(
                            private_path.as_str(),
                            &format!("[attachment:{display_name}]"),
                        );
                    }
                }
                Value::String(output)
            }
            Value::Array(entries) => Value::Array(
                entries
                    .iter()
                    .map(|e| scrub(e, replacements, depth + 1))
                    .collect(),
            ),
            Value::Object(map) => Value::Object(
                map.iter()
                    .map(|(key, entry)| (key.clone(), scrub(entry, replacements, depth + 1)))
                    .collect(),
            ),
            other => other.clone(),
        }
    }
    if replacements.is_empty() {
        return value.clone();
    }
    scrub(value, replacements, 0)
}

/// `privateReferenceLeaseTokens(request)`.
pub fn private_reference_lease_tokens(request: &Value) -> Vec<String> {
    let lease = &request["privateReferenceLease"];
    if !lease.is_object() || !lease["leaseId"].is_string() {
        return Vec::new();
    }
    let mut tokens: Vec<String> = Vec::new();
    for token in lease["tokens"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        if LEASE_TOKEN.is_match(token) && !tokens.iter().any(|t| t == token) {
            tokens.push(token.to_string());
        }
    }
    tokens.truncate(32);
    tokens
}

async fn revoke_tokens(
    session: &AgentSession,
    tokens: Vec<String>,
    store: Option<&Rc<dyn AttachmentStore>>,
) {
    let Some(store) = store.filter(|s| s.supports("revokeLeased") || s.supports("revoke")) else {
        return;
    };
    if tokens.is_empty() {
        return;
    }
    let request = Obj::new()
        .set("ownerId", session.owner_id)
        .set("workspaceRoot", session.workspace_root())
        .set("tokens", tokens)
        .build();
    let _ = store.revoke(request).await;
}

/// `revokeActiveAgentReferences(session, attachmentStore)`.
pub async fn revoke_active_agent_references(
    session: &AgentSession,
    store: Option<&Rc<dyn AttachmentStore>>,
) {
    let tokens = {
        let mut state = session.state_mut();
        let tokens = std::mem::take(&mut state.active_reference_tokens);
        state.reference_claims.clear();
        state.private_reference_paths.clear();
        tokens
    };
    revoke_tokens(session, tokens, store).await;
}

/// `revokeAgentOperationReferences(session, identity, attachmentStore)`.
pub async fn revoke_agent_operation_references(
    session: &AgentSession,
    identity: &OperationIdentity,
    store: Option<&Rc<dyn AttachmentStore>>,
) {
    let key = claim_key("start", identity);
    let claim = {
        let mut state = session.state_mut();
        let Some(index) = state.reference_claims.iter().position(|(k, _)| *k == key) else {
            return;
        };
        state.reference_claims.remove(index).1
    };
    sync_reference_claims(session);
    revoke_tokens(session, claim.tokens, store).await;
}

/// `beginAgentSteerReferences(session, request, identity, preparedInput)`.
pub fn begin_agent_steer_references(
    session: &AgentSession,
    request: &Value,
    identity: &OperationIdentity,
    input: &PreparedInput,
) {
    set_reference_claim(
        session,
        &claim_key("steer", identity),
        ReferenceClaim {
            tokens: private_reference_lease_tokens(request),
            paths: input.private_reference_paths.clone(),
        },
    );
}

/// `acceptAgentSteerReferences(session, identity, turnId)`.
pub fn accept_agent_steer_references(
    session: &AgentSession,
    identity: &OperationIdentity,
    turn_id: &str,
) -> bool {
    move_claim_to_turn(session, &claim_key("steer", identity), turn_id)
}

/// `abandonAgentSteerReferences(session, identity)`.
pub fn abandon_agent_steer_references(
    session: &AgentSession,
    identity: &OperationIdentity,
) -> bool {
    delete_reference_claim(session, &claim_key("steer", identity))
}

/// `releaseAgentReferenceLease(session, request, attachmentStore)`.
pub async fn release_agent_reference_lease(
    session: &AgentSession,
    request: &Value,
    store: Option<&Rc<dyn AttachmentStore>>,
) {
    let lease_id = request["privateReferenceLease"]["leaseId"]
        .as_str()
        .filter(|id| !id.is_empty());
    let tokens = private_reference_lease_tokens(request);
    let (Some(lease_id), Some(store)) = (lease_id, store.filter(|s| s.supports("releaseLease")))
    else {
        return;
    };
    if tokens.is_empty() {
        return;
    }
    let _ = store
        .release_lease(
            Obj::new()
                .set("ownerId", session.owner_id)
                .set("workspaceRoot", session.workspace_root())
                .set("tokens", tokens)
                .set("leaseId", lease_id)
                .build(),
        )
        .await;
}

fn claim_key(kind: &str, identity: &OperationIdentity) -> String {
    format!(
        "{kind}:{}:{}:{}",
        identity.adapter_generation, identity.command_id, identity.operation_id
    )
}

fn set_reference_claim(session: &AgentSession, key: &str, claim: ReferenceClaim) {
    let mut tokens: Vec<String> = Vec::new();
    for token in claim.tokens {
        if !tokens.contains(&token) {
            tokens.push(token);
        }
    }
    {
        let mut state = session.state_mut();
        let claim = ReferenceClaim {
            tokens,
            paths: claim.paths,
        };
        match state.reference_claims.iter_mut().find(|(k, _)| k == key) {
            Some(entry) => entry.1 = claim,
            None => state.reference_claims.push((key.to_string(), claim)),
        }
    }
    sync_reference_claims(session);
}

fn merge_reference_claim(session: &AgentSession, key: &str, incoming: ReferenceClaim) {
    {
        let mut state = session.state_mut();
        let current = state
            .reference_claims
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, c)| c.clone())
            .unwrap_or_default();
        let mut tokens = current.tokens;
        for token in incoming.tokens {
            if !tokens.contains(&token) {
                tokens.push(token);
            }
        }
        let mut paths = current.paths;
        for (path, name) in incoming.paths {
            match paths.iter_mut().find(|(p, _)| *p == path) {
                Some(entry) => entry.1 = name,
                None => paths.push((path, name)),
            }
        }
        let merged = ReferenceClaim { tokens, paths };
        match state.reference_claims.iter_mut().find(|(k, _)| k == key) {
            Some(entry) => entry.1 = merged,
            None => state.reference_claims.push((key.to_string(), merged)),
        }
    }
    sync_reference_claims(session);
}

fn delete_reference_claim(session: &AgentSession, key: &str) -> bool {
    let removed = {
        let mut state = session.state_mut();
        let before = state.reference_claims.len();
        state.reference_claims.retain(|(k, _)| k != key);
        state.reference_claims.len() != before
    };
    if removed {
        sync_reference_claims(session);
    }
    removed
}

fn sync_reference_claims(session: &AgentSession) {
    let mut state = session.state_mut();
    let mut tokens: Vec<String> = Vec::new();
    let mut paths: Vec<(String, String)> = Vec::new();
    for (_, claim) in &state.reference_claims {
        for token in &claim.tokens {
            if !tokens.contains(token) {
                tokens.push(token.clone());
            }
        }
        for (path, name) in &claim.paths {
            match paths.iter_mut().find(|(p, _)| p == path) {
                Some(entry) => entry.1 = name.clone(),
                None => paths.push((path.clone(), name.clone())),
            }
        }
    }
    state.active_reference_tokens = tokens;
    state.private_reference_paths = paths;
}
