import {
  normalizeAuthorizedReferences,
  bindPromptReferenceMentionDelivery,
  compileAgentPromptReferenceMentions,
  normalizePrompt,
  normalizePromptReferenceMentions,
  normalizeReferenceDisplays,
  requireSupportedAgentReferences,
} from "./agent-input-policy.mjs";

export function prepareAgentTurnReferenceInput(request, capabilities, deliveryForReference) {
  const authorizedReferences = normalizeAuthorizedReferences([
    ...(Array.isArray(request?.references) ? request.references : []),
    ...(Array.isArray(request?.contextReferences) ? request.contextReferences : []),
    ...(Array.isArray(request?.attachments) ? request.attachments : []),
  ]);
  requireSupportedAgentReferences(capabilities, authorizedReferences);
  const displayPrompt = normalizePrompt(request?.prompt, {
    allowEmpty: authorizedReferences.length > 0 && capabilities?.referenceInputs?.attachmentOnly === true,
  });
  const promptMentions = normalizePromptReferenceMentions(request?.promptMentions, displayPrompt, authorizedReferences);
  const references = bindPromptReferenceMentionDelivery(authorizedReferences, promptMentions, deliveryForReference);
  return {
    references,
    referenceDisplays: normalizeReferenceDisplays(references),
    privateReferencePaths: new Map(references.flatMap((reference) => reference.kind === "staged-attachment"
      ? [
          [reference.path, reference.displayName],
          ...(typeof reference.snapshotUrl === "string" ? [[reference.snapshotUrl, reference.displayName]] : []),
        ]
      : [])),
    displayPrompt,
    promptMentions,
    prompt: compileAgentPromptReferenceMentions(displayPrompt, promptMentions, references),
  };
}

export function beginAgentTurnReferences(session, request, identity, preparedInput = null) {
  const deliveryForReference = typeof session.adapter?.referenceMentionDelivery === "function"
    ? (reference) => session.adapter.referenceMentionDelivery(reference)
    : undefined;
  const input = preparedInput ?? prepareAgentTurnReferenceInput(request, session.capabilities, deliveryForReference);
  const result = session.actor.dispatch({
    type: "submission.prepared",
    startedAtMs: Date.now(),
    submission: {
      commandId: identity.commandId,
      operationId: identity.operationId,
      adapterGeneration: identity.adapterGeneration,
      prompt: input.displayPrompt,
      promptMentions: input.promptMentions,
      referenceDisplays: input.referenceDisplays,
    },
  });
  if (!result.changed) throw new Error("The Agent start operation is no longer current.");
  setReferenceClaim(session, referenceClaimKey("start", identity), {
    tokens: privateReferenceLeaseTokens(request),
    paths: input.privateReferencePaths,
  });
  return input;
}

export function abandonAgentTurnReferences(session, identity) {
  const result = session.actor.dispatch({ type: "submission.abandoned", ...identity });
  const released = deleteReferenceClaim(session, referenceClaimKey("start", identity));
  return result.changed || released;
}

export function acceptAgentTurnReferences(session, identity, turnId) {
  const source = referenceClaimKey("start", identity);
  const claim = session.referenceClaims?.get(source);
  if (!claim) return false;
  if (session.activeTurnId !== turnId) return false;
  session.referenceClaims.delete(source);
  mergeReferenceClaim(session, referenceClaimKey("turn", { turnId }), claim);
  return true;
}

export function prepareAgentSteerReferenceInput(request, capabilities, deliveryForReference) {
  const authorizedReferences = normalizeAuthorizedReferences(request?.references);
  if (authorizedReferences.length > 0 && capabilities?.referenceInputs?.steer !== true) {
    throw new Error("The active Agent runtime does not support references while steering.");
  }
  requireSupportedAgentReferences(capabilities, authorizedReferences);
  const displayMessage = normalizePrompt(request?.message, {
    allowEmpty: authorizedReferences.length > 0 && capabilities?.referenceInputs?.attachmentOnly === true,
  });
  const promptMentions = normalizePromptReferenceMentions(request?.promptMentions, displayMessage, authorizedReferences);
  const references = bindPromptReferenceMentionDelivery(authorizedReferences, promptMentions, deliveryForReference);
  return {
    references,
    privateReferencePaths: new Map(references.flatMap((reference) => reference.kind === "staged-attachment"
      ? [
          [reference.path, reference.displayName],
          ...(typeof reference.snapshotUrl === "string" ? [[reference.snapshotUrl, reference.displayName]] : []),
        ]
      : [])),
    promptMentions,
    message: compileAgentPromptReferenceMentions(displayMessage, promptMentions, references),
  };
}

export function scrubPrivateReferencePaths(value, replacements, depth = 0) {
  if (depth > 12 || !replacements?.size) return value;
  if (typeof value === "string") {
    let output = value;
    for (const [privatePath, displayName] of replacements) {
      output = output.split(privatePath).join(`[attachment:${displayName}]`);
    }
    return output;
  }
  if (Array.isArray(value)) return value.map((entry) => scrubPrivateReferencePaths(entry, replacements, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    scrubPrivateReferencePaths(entry, replacements, depth + 1),
  ]));
}

export function privateReferenceLeaseTokens(request) {
  const lease = request?.privateReferenceLease;
  if (!lease || typeof lease !== "object" || typeof lease.leaseId !== "string") return [];
  return Array.from(new Set((Array.isArray(lease.tokens) ? lease.tokens : [])
    .filter((token) => typeof token === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(token))))
    .slice(0, 32);
}

export async function revokeActiveAgentReferences(session, attachmentStore) {
  const tokens = Array.isArray(session?.activeReferenceTokens) ? [...session.activeReferenceTokens] : [];
  session.referenceClaims?.clear?.();
  session.privateReferencePaths?.clear?.();
  session.activeReferenceTokens = [];
  const revoke = attachmentStore?.revokeLeased ?? attachmentStore?.revoke;
  if (tokens.length === 0 || typeof revoke !== "function") return;
  await revoke.call(attachmentStore, {
    ownerId: session.ownerId,
    workspaceRoot: session.workspaceRoot,
    tokens,
  }).catch(() => undefined);
}

export async function revokeAgentOperationReferences(session, identity, attachmentStore) {
  const key = referenceClaimKey("start", identity);
  const claim = session.referenceClaims?.get(key);
  if (!claim) return;
  session.referenceClaims.delete(key);
  syncReferenceClaims(session);
  const tokens = Array.from(claim.tokens ?? []);
  const revoke = attachmentStore?.revokeLeased ?? attachmentStore?.revoke;
  if (tokens.length === 0 || typeof revoke !== "function") return;
  await revoke.call(attachmentStore, {
    ownerId: session.ownerId,
    workspaceRoot: session.workspaceRoot,
    tokens,
  }).catch(() => undefined);
}

export function beginAgentSteerReferences(session, request, identity, preparedInput) {
  setReferenceClaim(session, referenceClaimKey("steer", identity), {
    tokens: privateReferenceLeaseTokens(request),
    paths: preparedInput?.privateReferencePaths,
  });
}

export function acceptAgentSteerReferences(session, identity, turnId) {
  const source = referenceClaimKey("steer", identity);
  const claim = session.referenceClaims?.get(source);
  if (!claim) return false;
  if (session.activeTurnId !== turnId) return false;
  session.referenceClaims.delete(source);
  mergeReferenceClaim(session, referenceClaimKey("turn", { turnId }), claim);
  return true;
}

export function abandonAgentSteerReferences(session, identity) {
  return deleteReferenceClaim(session, referenceClaimKey("steer", identity));
}

export async function releaseAgentReferenceLease(session, request, attachmentStore) {
  const lease = request?.privateReferenceLease;
  const tokens = privateReferenceLeaseTokens(request);
  if (!lease?.leaseId || tokens.length === 0 || typeof attachmentStore?.releaseLease !== "function") return;
  await attachmentStore.releaseLease({
    ownerId: session.ownerId,
    workspaceRoot: session.workspaceRoot,
    tokens,
    leaseId: lease.leaseId,
  }).catch(() => undefined);
}

function referenceClaimKey(kind, identity) {
  if (kind === "turn") return `turn:${identity.turnId}`;
  return `${kind}:${identity.adapterGeneration}:${identity.commandId}:${identity.operationId}`;
}

function setReferenceClaim(session, key, { tokens = [], paths = new Map() }) {
  if (!(session.referenceClaims instanceof Map)) session.referenceClaims = new Map();
  session.referenceClaims.set(key, {
    tokens: new Set(tokens),
    paths: new Map(paths instanceof Map ? paths : []),
  });
  syncReferenceClaims(session);
}

function mergeReferenceClaim(session, key, incoming) {
  const current = session.referenceClaims.get(key);
  session.referenceClaims.set(key, {
    tokens: new Set([...(current?.tokens ?? []), ...(incoming?.tokens ?? [])]),
    paths: new Map([...(current?.paths ?? []), ...(incoming?.paths ?? [])]),
  });
  syncReferenceClaims(session);
}

function deleteReferenceClaim(session, key) {
  if (!session.referenceClaims?.delete?.(key)) return false;
  syncReferenceClaims(session);
  return true;
}

function syncReferenceClaims(session) {
  const claims = session.referenceClaims instanceof Map ? Array.from(session.referenceClaims.values()) : [];
  session.activeReferenceTokens = Array.from(new Set(claims.flatMap((claim) => Array.from(claim.tokens ?? []))));
  session.privateReferencePaths = new Map(claims.flatMap((claim) => Array.from(claim.paths ?? [])));
}
