import { createHash, randomUUID } from "node:crypto";
import { projectSessionError } from "../../../../../shared/project-session-contract/schema.mjs";

export function commandIdentity(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
    ? value
    : `command-${randomUUID()}`;
}

export function requireCommandPreconditions(session, request) {
  if (session.closing) throw projectSessionError("SESSION_CLOSING", "This conversation is closing.", true);
  if (request?.instanceId && request.instanceId !== session.instanceId) throw projectSessionError("SESSION_STALE", "This conversation instance has ended.");
  const control = session.actor.control;
  if (request?.expectedSessionEpoch !== undefined && request.expectedSessionEpoch !== control.sessionEpoch) {
    throw new Error("The Agent command belongs to an older session generation.");
  }
  if (request?.expectedAdapterGeneration !== undefined && request.expectedAdapterGeneration !== control.adapterGeneration) {
    throw new Error("The Agent command belongs to a replaced runtime connection.");
  }
  if (request?.expectedRunGeneration !== undefined && request.expectedRunGeneration !== control.runGeneration) {
    throw new Error("The Agent command belongs to an older turn generation.");
  }
}

export function repeatedCommand(session, commandId, kind, intentFingerprint) {
  if (typeof commandId !== "string") return null;
  const existing = session.actor.control.commands.find((entry) => entry.commandId === commandId);
  if (!existing) return null;
  if (existing.kind !== kind) throw new Error("Agent command id was already used for a different operation.");
  if (existing.intentFingerprint !== intentFingerprint) {
    throw new Error("Agent command id was already used with different input.");
  }
  if (["rejected", "cancelled", "outcome-unknown"].includes(existing.status)) {
    throw new Error(`Agent command was already ${existing.status} and will not be retried automatically.`);
  }
  return existing;
}

export function commandReceipt(session, command) {
  return {
    sessionId: session.id,
    commandId: command.commandId,
    turnId: command.targetTurnId,
    queued: command.status === "queued",
    deliveryStatus: command.status,
    deduplicated: true,
  };
}

export function operationIdentity() {
  return `operation-${randomUUID()}`;
}

export function startCommandIntent(input, { model, effort, mode }, recoveryOfTurnId = null) {
  return {
    prompt: input.displayPrompt,
    recoveryOfTurnId,
    promptMentions: input.promptMentions,
    referenceDisplays: input.referenceDisplays,
    model: model ?? null,
    effort: effort ?? null,
    mode: mode ?? null,
  };
}

export function commandFingerprint(kind, intent) {
  return createHash("sha256")
    .update(stableSerialize({ kind, intent }))
    .digest("hex");
}

function stableSerialize(value) {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}
