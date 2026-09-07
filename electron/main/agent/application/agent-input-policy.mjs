import {
  acceptsAgentAttachment,
  classifyAgentAttachment,
} from "../../../../shared/agent-contract/reference-input.mjs";
import {
  AGENT_REFERENCE_ERROR_CODES,
  agentReferenceError,
} from "../domain/agent-reference-error.mjs";
import {
  agentReferenceMentionText,
  normalizeAgentWorkspaceRelativePath,
} from "../../../../shared/agent-contract/reference-identity.mjs";

const MAX_REFERENCE_SNAPSHOT_URL_LENGTH = Math.ceil(512 * 1024 * 4 / 3) + 256;

export function readinessWithAccountState(readiness, accountState, runtimeName = "Agent runtime") {
  if (readiness.status === "ready" && requiresRuntimeSetup(accountState)) {
    const code = accountState?.setupReason === "authentication-expired"
      ? "AUTHENTICATION_EXPIRED"
      : accountState?.requiresOpenaiAuth || accountState?.setupReason === "authentication-required"
        ? "AUTHENTICATION_REQUIRED"
        : "RUNTIME_SETUP_REQUIRED";
    return {
      ...readiness,
      status: "installed-not-authenticated",
      code,
      selectable: false,
      message: accountState?.error || (
        readiness.message && readiness.message !== `${runtimeName} is ready.`
          ? readiness.message
          : `${runtimeName} requires authentication or model setup.`
      ),
    };
  }
  return readiness;
}

export function assertAuthenticated(accountState, runtimeName = "Agent runtime") {
  if (requiresRuntimeSetup(accountState)) {
    throw new Error(accountState?.error || `${runtimeName} requires authentication or model setup.`);
  }
}

export function requiresRuntimeSetup(accountState) {
  return Boolean(
    !accountState?.account
    && (accountState?.requiresOpenaiAuth || accountState?.requiresRuntimeSetup),
  );
}

export function requireWorkspaceRoot(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("No authorized local workspace is assigned to this Agent session.");
  }
}

export function requireMatchingWorkspace(session, workspaceRoot) {
  // Trusted IPC always supplies a canonical root. Direct service-level tests
  // may omit it, but a supplied proof must match exactly.
  if (workspaceRoot === null || workspaceRoot === undefined) return;
  requireWorkspaceRoot(workspaceRoot);
  if (session.workspaceRoot !== workspaceRoot) {
    throw new Error("Agent session does not belong to the assigned workspace.");
  }
}

export function requireSenderId(sender) {
  if (!Number.isSafeInteger(sender?.id) || sender.id <= 0) throw new Error("Agent IPC sender is invalid.");
  return sender.id;
}

export function normalizePrompt(value, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) throw new Error("Enter a message for the Agent.");
  if (value.length > 128 * 1024) throw new Error("The Agent message is too large.");
  return value;
}

export function normalizeRequiredId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9:._-]{1,256}$/.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

export function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 200) : null;
}

export function normalizeRuntimeId(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]{1,39}$/.test(value) ? value : null;
}

export function normalizeOptionalId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/.test(value) ? value : null;
}

export function normalizeAuthorizedReferences(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 32) throw new Error("Agent references exceed the 32-file safety limit.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || entry.authorized !== true) {
      throw agentReferenceError(
        AGENT_REFERENCE_ERROR_CODES.unauthorized,
        "Agent references must be authorized by the main process.",
      );
    }
    if (entry.kind !== "workspace-entry" && entry.kind !== "staged-attachment") {
      throw new Error("Agent reference kind is not supported.");
    }
    if (typeof entry.path !== "string" || entry.path.length === 0 || entry.path.length > 4_096) {
      throw new Error("Agent reference path is invalid.");
    }
    const kind = entry.kind;
    const entryType = entry.entryType === "directory" ? "directory" : "file";
    const relativePath = kind === "workspace-entry"
      ? normalizeAgentWorkspaceRelativePath(entry.relativePath)
      : null;
    if (kind === "workspace-entry" && !relativePath) {
      throw new Error("Agent workspace reference identity is invalid.");
    }
    return {
      authorized: true,
      id: normalizeReferenceId(entry.id, entry.path),
      kind,
      ...(kind === "workspace-entry" ? { entryType } : {}),
      path: entry.path,
      name: normalizeReferenceDisplayName(entry.name ?? entry.displayName),
      displayName: normalizeReferenceDisplayName(entry.displayName ?? entry.name) || "reference",
      ...(kind === "workspace-entry"
        ? {
            relativePath,
            ...(entry.resourceUri ? { resourceUri: entry.resourceUri, workspaceFolderId: entry.workspaceFolderId } : {}),
            ...(entry.authorizedWorkspaceRoot ? { authorizedWorkspaceRoot: entry.authorizedWorkspaceRoot } : {}),
            ...(entry.workspaceName ? { workspaceName: normalizeReferenceDisplayName(entry.workspaceName) } : {}),
          }
        : {}),
      mime: normalizeOptionalString(entry.mime),
      size: Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : 0,
      ...(isBoundedDataUrl(entry.snapshotUrl) ? { snapshotUrl: entry.snapshotUrl } : {}),
    };
  });
}

export function normalizePromptReferenceMentions(value, prompt, references) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 32) throw new Error("Agent prompt reference mentions are invalid.");
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  let boundary = 0;
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Agent prompt reference mention is invalid.");
    const referenceId = normalizeRequiredId(entry.referenceId, "Reference mention id");
    const reference = byId.get(referenceId);
    if (!reference) throw new Error("Agent prompt reference mention is not backed by an authorized reference.");
    if (reference.mime?.startsWith("image/")) throw new Error("Image references must use the native media input channel.");
    const start = Number.isSafeInteger(entry.start) ? entry.start : -1;
    const end = Number.isSafeInteger(entry.end) ? entry.end : -1;
    if (start < boundary || end <= start || end > prompt.length) throw new Error("Agent prompt reference mention range is invalid.");
    const expected = agentReferenceMentionText(reference);
    if (prompt.slice(start, end) !== expected) throw new Error("Agent prompt reference mention text does not match its authorized reference.");
    boundary = end;
    return { referenceId, start, end };
  });
}

/** Bind protocol delivery metadata without mutating main-authorized records. */
export function bindPromptReferenceMentionDelivery(
  references,
  mentions,
  deliveryForReference = () => "resource",
) {
  const mentionedIds = new Set(mentions.map((mention) => mention.referenceId));
  return references.map((reference) => mentionedIds.has(reference.id)
    ? {
        ...reference,
        inlineMentioned: true,
        mentionDelivery: deliveryForReference(reference) === "path" ? "path" : "resource",
      }
    : reference);
}

export function compileAgentPromptReferenceMentions(prompt, mentions, references) {
  if (!mentions.length) return prompt;
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  let compiled = prompt;
  for (let index = mentions.length - 1; index >= 0; index -= 1) {
    const mention = mentions[index];
    const reference = byId.get(mention.referenceId);
    if (!reference) throw new Error("Agent prompt reference mention lost its authorized reference.");
    if (reference.mentionDelivery === "path") {
      compiled = `${compiled.slice(0, mention.start)}${quoteNativePath(reference.path)}${compiled.slice(mention.end)}`;
    }
  }
  return compiled;
}

function quoteNativePath(filename) {
  return `\`${String(filename).replace(/`/g, "\\`")}\``;
}

export function requireSupportedAgentReferences(capabilities, references) {
  const input = capabilities?.referenceInputs;
  const values = Array.isArray(references) ? references : [];
  if (!input) {
    if (values.length > 0) {
      throw agentReferenceError(
        AGENT_REFERENCE_ERROR_CODES.missingRuntimeCapability,
        "The selected Agent has not reported reference input support.",
      );
    }
    return;
  }
  const totalBytes = values.reduce((sum, entry) => sum + (Number.isSafeInteger(entry?.size) ? entry.size : 0), 0);
  if (values.length > input.limits.maxCount) {
    throw agentReferenceError(AGENT_REFERENCE_ERROR_CODES.limitExceeded, "This Agent accepts fewer reference inputs.");
  }
  if (totalBytes > input.limits.maxTotalBytes) {
    throw agentReferenceError(
      AGENT_REFERENCE_ERROR_CODES.limitExceeded,
      "Reference inputs exceed this Agent's total size limit.",
    );
  }
  for (const reference of values) {
    if ((reference.size ?? 0) > input.limits.maxBytesPerReference) {
      throw agentReferenceError(
        AGENT_REFERENCE_ERROR_CODES.limitExceeded,
        "A reference exceeds this Agent's per-file size limit.",
      );
    }
    if (reference.kind === "workspace-entry") {
      if (reference.workspaceName && input.workspace.crossRoots !== true) {
        throw agentReferenceError(AGENT_REFERENCE_ERROR_CODES.unsupportedKind, "The selected Agent does not accept references from another project.");
      }
      if (reference.entryType === "directory" && input.workspace.directories !== true) {
        throw agentReferenceError(
          AGENT_REFERENCE_ERROR_CODES.unsupportedKind,
          "The selected Agent does not accept workspace directories.",
        );
      }
      if (reference.entryType !== "directory" && input.workspace.files !== true) {
        throw agentReferenceError(
          AGENT_REFERENCE_ERROR_CODES.unsupportedKind,
          "The selected Agent does not accept workspace files.",
        );
      }
      continue;
    }
    const attachment = { mime: reference.mime, name: reference.displayName ?? reference.name };
    const kind = classifyAgentAttachment(attachment);
    const kindLimit = input.attachments[kind].maxBytes;
    if (kindLimit && (reference.size ?? 0) > kindLimit) {
      throw agentReferenceError(
        AGENT_REFERENCE_ERROR_CODES.limitExceeded,
        `The ${kind} attachment exceeds this Agent's native input size limit.`,
      );
    }
    if (!acceptsAgentAttachment(input, attachment)) {
      throw agentReferenceError(
        AGENT_REFERENCE_ERROR_CODES.unsupportedKind,
        kind === "image"
          ? "The selected Agent does not accept image attachments."
          : `The selected Agent does not accept ${kind} file attachments.`,
      );
    }
  }
}

export function normalizeReferenceDisplays(references) {
  return (Array.isArray(references) ? references : []).slice(0, 32).map((reference) => ({
    id: normalizeReferenceId(reference.id, `${reference.kind}:${reference.path}`),
    kind: reference.kind === "staged-attachment"
      ? "attachment"
      : reference.entryType === "directory" ? "workspace-directory" : "workspace-file",
    displayName: normalizeReferenceDisplayName(reference.displayName ?? reference.name) || "reference",
    ...(reference.workspaceName ? { workspaceName: normalizeReferenceDisplayName(reference.workspaceName) } : {}),
    ...(reference.kind === "workspace-entry" && typeof reference.relativePath === "string"
      ? { relativePath: reference.relativePath.slice(0, 4_096) }
      : {}),
    ...(reference.kind === "staged-attachment" && reference.mime ? { mime: reference.mime } : {}),
    ...(reference.kind === "staged-attachment" && Number.isSafeInteger(reference.size) ? { size: reference.size } : {}),
  }));
}

function normalizeReferenceDisplayName(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 512) : null;
}

export function normalizeQuestionAnswers(value, questions) {
  if (value === null || value === undefined) return null;
  let rows;
  if (typeof value === "string") rows = [[value]];
  else if (Array.isArray(value) && value.every(Array.isArray)) rows = value;
  else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    rows = Array.isArray(questions) && questions.length > 1
      ? value.map((entry) => [entry])
      : [value];
  } else {
    throw new Error("Question answers are invalid.");
  }
  return rows.slice(0, 8).map((row) => row
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim().slice(0, 4_000))
    .filter(Boolean)
    .slice(0, 20));
}

export function unavailableReadiness(message) {
  return {
    runtimeId: "unknown",
    provider: "unknown",
    status: "error",
    code: "RUNTIME_DISCOVERY_FAILED",
    version: null,
    minimumVersion: null,
    message,
    source: "missing",
    compatibility: "unavailable",
    selectable: false,
  };
}

export function normalizeApprovalDecision(value) {
  if (!["accept", "acceptForSession", "decline", "cancel"].includes(value)) {
    throw new Error("Approval decision is invalid.");
  }
  return value;
}

export function normalizeSequence(value) {
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0;
}

function isBoundedDataUrl(value) {
  if (typeof value !== "string" || value.length > MAX_REFERENCE_SNAPSHOT_URL_LENGTH) return false;
  const marker = value.indexOf(";base64,");
  return value.startsWith("data:") && marker > 5 && marker < 200 && !value.slice(0, marker).includes("\n");
}

function normalizeReferenceId(value, fallback) {
  if (typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/.test(value)) return value;
  let hash = 2166136261;
  for (const character of String(fallback ?? "reference")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `reference-${(hash >>> 0).toString(16)}`;
}
