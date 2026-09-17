import fs from "node:fs";
import path from "node:path";
import { authorizedWorkspaceReferencePath, formatAuthorizedWorkspaceReferencePrompt } from "../../security/authorized-workspace-reference-prompt.mjs";
import {
  AGENT_REFERENCE_ERROR_CODES,
  agentReferenceError,
} from "../../domain/agent-reference-error.mjs";

export const PI_NATIVE_IMAGE_MIME_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
export const PI_NATIVE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PI_NATIVE_IMAGE_MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(PI_NATIVE_IMAGE_MIME_TYPES);

/** Map authorized semantic references to Pi's native prompt + images command. */
export async function buildPiTurnInput({ prompt, references = [], workspaceRoot, runtimeLabel = "Pi" }) {
  const label = typeof runtimeLabel === "string" && runtimeLabel.trim() ? runtimeLabel.trim().slice(0, 80) : "Pi";
  const pathReferences = [];
  const images = [];
  let imageBytes = 0;
  const seen = new Set();
  for (const reference of Array.isArray(references) ? references : []) {
    const filename = resolveReferencePath(reference, workspaceRoot);
    if (!filename || seen.has(filename)) continue;
    seen.add(filename);
    if (reference.kind === "workspace-entry" && !authorizedWorkspaceReferencePath(reference, workspaceRoot)) {
      throw referenceError(
        AGENT_REFERENCE_ERROR_CODES.unauthorized,
        `${label} received a workspace reference outside the assigned workspace.`,
      );
    }
    if (IMAGE_MIME_TYPES.has(reference.mime)) {
      const materialized = await materializeImage(reference, filename);
      imageBytes += materialized.byteLength;
      if (imageBytes > PI_NATIVE_IMAGE_MAX_TOTAL_BYTES) {
        throw referenceError(
          AGENT_REFERENCE_ERROR_CODES.limitExceeded,
          `${label} image attachments exceed the native RPC frame limit.`,
        );
      }
      images.push(materialized.image);
      continue;
    }
    if (reference.kind === "workspace-entry" || (
      reference.kind === "staged-attachment"
      && reference.inlineMentioned === true
      && reference.mentionDelivery === "path"
    )) {
      pathReferences.push({ ...reference, path: filename });
      continue;
    }
    throw referenceError(
      AGENT_REFERENCE_ERROR_CODES.unsupportedKind,
      `${label} accepts non-image file attachments only as native path mentions.`,
    );
  }
  return {
    message: formatAuthorizedWorkspaceReferencePrompt(prompt, pathReferences, workspaceRoot),
    images,
  };
}

async function materializeImage(reference, filename) {
  const metadata = await fs.promises.lstat(filename).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > PI_NATIVE_IMAGE_MAX_BYTES) {
    throw referenceError(
      AGENT_REFERENCE_ERROR_CODES.materializationFailed,
      "The Pi RPC runtime could not safely materialize the image attachment.",
    );
  }
  const bytes = await fs.promises.readFile(filename).catch((cause) => {
    throw referenceError(
      AGENT_REFERENCE_ERROR_CODES.materializationFailed,
      "The Pi RPC runtime could not read the image attachment.",
      cause,
    );
  });
  return {
    byteLength: bytes.byteLength,
    image: { type: "image", data: bytes.toString("base64"), mimeType: reference.mime },
  };
}

function resolveReferencePath(reference, workspaceRoot) {
  if (!reference || typeof reference.path !== "string" || reference.path.length === 0) {
    throw referenceError(AGENT_REFERENCE_ERROR_CODES.invalidInput, "Pi received an invalid reference input.");
  }
  if (path.isAbsolute(reference.path)) return path.resolve(reference.path);
  if (typeof workspaceRoot !== "string" || !path.isAbsolute(workspaceRoot)) {
    throw referenceError(AGENT_REFERENCE_ERROR_CODES.unauthorized, "Pi requires an assigned workspace root.");
  }
  return path.resolve(workspaceRoot, reference.path);
}

function referenceError(code, message, cause) {
  return agentReferenceError(code, message, cause ? { cause } : undefined);
}
