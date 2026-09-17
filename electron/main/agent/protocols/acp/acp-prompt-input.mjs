import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ACP_INLINE_IMAGE_MAX_BYTES } from "./acp-limits.mjs";
import { classifyAgentAttachment } from "../../../../../shared/agent-contract/reference-input.mjs";
import { authorizedWorkspaceReferencePath } from "../../security/authorized-workspace-reference-prompt.mjs";
import {
  AGENT_REFERENCE_ERROR_CODES,
  agentReferenceError,
} from "../../domain/agent-reference-error.mjs";

export const ACP_NATIVE_IMAGE_MIME_TYPES = Object.freeze(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const ACP_NATIVE_IMAGE_MIME_TYPE_SET = new Set(ACP_NATIVE_IMAGE_MIME_TYPES);

export async function materializeAcpReferences(references, profile = {}) {
  const nativeProfile = normalizeProfile(profile);
  return Promise.all(array(references).map(async (reference) => {
    if (reference?.kind !== "staged-attachment") return reference;
    const kind = classifyAgentAttachment({ mime: reference.mime, name: reference.displayName ?? reference.name });
    if (kind === "image" && reference.snapshotUrl) return reference;
    if (kind === "image" && (!nativeProfile.image || !ACP_NATIVE_IMAGE_MIME_TYPE_SET.has(reference.mime))) {
      throw unsupportedAttachmentError(kind);
    }
    if (!["image", "text", "binary"].includes(kind)
      || typeof reference.path !== "string" || !path.isAbsolute(reference.path)) {
      throw unsupportedAttachmentError(kind);
    }
    const metadata = await fs.promises.lstat(reference.path).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink()) {
      throw materializationError(kind);
    }
    if (kind === "image") {
      if (metadata.size > ACP_INLINE_IMAGE_MAX_BYTES) throw materializationError(kind);
      const bytes = await fs.promises.readFile(reference.path);
      return { ...reference, snapshotUrl: `data:${reference.mime};base64,${bytes.toString("base64")}` };
    }
    if (!nativeProfile.embeddedText || kind !== "text" || metadata.size > ACP_INLINE_IMAGE_MAX_BYTES) {
      return reference;
    }
    const bytes = await fs.promises.readFile(reference.path);
    let snapshotText;
    try {
      snapshotText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // The ACP baseline still accepts a resource link. Invalid UTF-8 should
      // not turn a valid local path reference into a rejected attachment.
      return reference;
    }
    return { ...reference, snapshotText };
  }));
}

/** @deprecated Use materializeAcpReferences with an explicit native profile. */
export function materializeAcpImageReferences(references) {
  return materializeAcpReferences(references, { image: true });
}

export function buildAcpPromptBlocks({ prompt, instructions, references, workspaceRoot, profile = {} }) {
  const nativeProfile = normalizeProfile(profile);
  const content = instructions ? `${instructions}\n\nUser request:\n${prompt}` : prompt;
  const blocks = [{ type: "text", text: content }];
  const seen = new Set();
  for (const reference of array(references)) {
    if (reference?.kind === "staged-attachment") {
      const kind = classifyAgentAttachment({ mime: reference.mime, name: reference.displayName ?? reference.name });
      if (kind === "image") {
        const image = dataUrlParts(reference.snapshotUrl);
        if (!nativeProfile.image || !ACP_NATIVE_IMAGE_MIME_TYPE_SET.has(reference.mime)
          || !image || image.mime !== reference.mime) throw materializationError(kind);
        blocks.push({ type: "image", data: image.data, mimeType: image.mime });
        continue;
      }
      if (kind === "text" && nativeProfile.embeddedText && typeof reference.snapshotText === "string") {
        blocks.push({
          type: "resource",
          resource: {
            uri: attachmentUri(reference),
            mimeType: reference.mime || "text/plain",
            text: reference.snapshotText,
          },
        });
        continue;
      }
      if (["text", "binary"].includes(kind) && typeof reference.path === "string" && path.isAbsolute(reference.path)) {
        blocks.push(resourceLink(reference.path, reference));
        continue;
      }
      throw unsupportedAttachmentError(kind);
    }
    const filename = typeof reference?.path === "string" ? path.resolve(reference.path) : null;
    if (!filename || !authorizedWorkspaceReferencePath(reference, workspaceRoot)) {
      throw new Error("ACP received an invalid workspace reference.");
    }
    if (seen.has(filename)) continue;
    seen.add(filename);
    blocks.push(resourceLink(filename, reference));
  }
  return blocks;
}

function resourceLink(filename, reference) {
  const name = text(reference?.displayName ?? reference?.name, 300) || path.basename(filename);
  return {
    type: "resource_link",
    uri: pathToFileURL(filename).href,
    name,
    title: name,
    ...(text(reference?.mime, 160) ? { mimeType: text(reference.mime, 160) } : {}),
    ...(Number.isSafeInteger(reference?.size) && reference.size >= 0 ? { size: reference.size } : {}),
  };
}

function dataUrlParts(value) {
  if (typeof value !== "string" || value.length > Math.ceil(ACP_INLINE_IMAGE_MAX_BYTES * 4 / 3) + 256) return null;
  const match = /^data:([^;,]{1,160});base64,([A-Za-z0-9+/=]+)$/.exec(value);
  return match ? { mime: match[1], data: match[2] } : null;
}

function attachmentUri(reference) {
  const id = text(reference?.id, 256).replace(/[^A-Za-z0-9:._-]/g, "-") || "attachment";
  const name = encodeURIComponent(text(reference?.displayName ?? reference?.name, 512) || "attachment");
  return `puppyone-attachment://local/${encodeURIComponent(id)}/${name}`;
}

function normalizeProfile(value) {
  return {
    image: value?.image === true,
    embeddedText: value?.embeddedText === true,
  };
}

function unsupportedAttachmentError(kind) {
  return agentReferenceError(
    AGENT_REFERENCE_ERROR_CODES.missingRuntimeCapability,
    `The ACP runtime does not accept ${kind} attachments through its negotiated prompt capabilities.`,
  );
}

function materializationError(kind, cause) {
  return agentReferenceError(
    AGENT_REFERENCE_ERROR_CODES.materializationFailed,
    `ACP could not safely materialize the staged ${kind} attachment.`,
    cause ? { cause } : undefined,
  );
}

function text(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
