import fs from "node:fs";
import path from "node:path";
import { authorizedWorkspaceReferencePath, formatAuthorizedWorkspaceReferencePrompt } from "../../security/authorized-workspace-reference-prompt.mjs";
import {
  AGENT_REFERENCE_ERROR_CODES,
  agentReferenceError,
} from "../../domain/agent-reference-error.mjs";

export const CLAUDE_NATIVE_IMAGE_MIME_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
export const CLAUDE_NATIVE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const CLAUDE_NATIVE_IMAGE_MIME_TYPE_SET = new Set(CLAUDE_NATIVE_IMAGE_MIME_TYPES);

/** Map authorized semantic references to Claude Agent SDK MessageParam content. */
export async function buildClaudeUserMessageContent({ prompt, references = [], workspaceRoot }) {
  const workspaceReferences = [];
  const imageBlocks = [];
  const seen = new Set();
  for (const reference of Array.isArray(references) ? references : []) {
    const filename = typeof reference?.path === "string" ? path.resolve(reference.path) : null;
    if (!filename) {
      throw referenceError(AGENT_REFERENCE_ERROR_CODES.invalidInput, "Claude Code received an invalid reference input.");
    }
    if (seen.has(filename)) continue;
    seen.add(filename);
    const referenceKind = reference.kind === "staged-attachment" ? "staged-attachment" : "workspace-entry";
    if (referenceKind === "workspace-entry" && !authorizedWorkspaceReferencePath(reference, workspaceRoot)) {
      throw referenceError(
        AGENT_REFERENCE_ERROR_CODES.unauthorized,
        "Claude Code received an unauthorized workspace reference outside the assigned workspace.",
      );
    }
    if (CLAUDE_NATIVE_IMAGE_MIME_TYPE_SET.has(reference.mime)) {
      imageBlocks.push(await materializeImage(reference, filename));
      continue;
    }
    if (referenceKind === "workspace-entry" || (referenceKind === "staged-attachment"
      && reference.inlineMentioned === true && reference.mentionDelivery === "path")) {
      workspaceReferences.push({ ...reference, kind: referenceKind, path: filename });
      continue;
    }
    throw referenceError(
      AGENT_REFERENCE_ERROR_CODES.unsupportedKind,
      "Claude Code received an unsupported staged attachment type for the native Agent SDK input contract.",
    );
  }
  const text = formatAuthorizedWorkspaceReferencePrompt(prompt, workspaceReferences, workspaceRoot);
  return imageBlocks.length > 0 ? [{ type: "text", text }, ...imageBlocks] : text;
}

async function materializeImage(reference, filename) {
  const metadata = await fs.promises.lstat(filename).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > CLAUDE_NATIVE_IMAGE_MAX_BYTES) {
    throw referenceError(
      AGENT_REFERENCE_ERROR_CODES.materializationFailed,
      "Claude Code could not safely materialize the staged image attachment.",
    );
  }
  const bytes = await fs.promises.readFile(filename).catch((cause) => {
    throw referenceError(
      AGENT_REFERENCE_ERROR_CODES.materializationFailed,
      "Claude Code could not read the staged image attachment.",
      cause,
    );
  });
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: reference.mime,
      data: bytes.toString("base64"),
    },
  };
}

function referenceError(code, message, cause) {
  return agentReferenceError(code, message, cause ? { cause } : undefined);
}
