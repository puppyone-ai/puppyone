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

export function beginAgentTurnReferences(session, request) {
  const deliveryForReference = typeof session.adapter?.referenceMentionDelivery === "function"
    ? (reference) => session.adapter.referenceMentionDelivery(reference)
    : undefined;
  const input = prepareAgentTurnReferenceInput(request, session.capabilities, deliveryForReference);
  session.actor.dispatch({
    type: "submission.prepared",
    startedAtMs: Date.now(),
    submission: {
      prompt: input.displayPrompt,
      promptMentions: input.promptMentions,
      referenceDisplays: input.referenceDisplays,
    },
  });
  session.privateReferencePaths = input.privateReferencePaths;
  session.activeReferenceTokens = privateReferenceLeaseTokens(request);
  return input;
}

export function abandonAgentTurnReferences(session) {
  session.actor.dispatch({ type: "submission.abandoned" });
  session.privateReferencePaths.clear();
  session.activeReferenceTokens = [];
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
  const tokens = Array.isArray(session?.activeReferenceTokens) ? session.activeReferenceTokens.splice(0) : [];
  const revoke = attachmentStore?.revokeLeased ?? attachmentStore?.revoke;
  if (tokens.length === 0 || typeof revoke !== "function") return;
  await revoke.call(attachmentStore, {
    ownerId: session.ownerId,
    workspaceRoot: session.workspaceRoot,
    tokens,
  }).catch(() => undefined);
}

export async function withAgentSteerReferenceTokens(session, request, invoke) {
  const previous = session.activeReferenceTokens;
  session.activeReferenceTokens = Array.from(new Set([...previous, ...privateReferenceLeaseTokens(request)]));
  try {
    return await invoke();
  } catch (error) {
    session.activeReferenceTokens = session.activeTurnId ? previous : [];
    throw error;
  }
}
