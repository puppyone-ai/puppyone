import { createRequire } from "node:module";
import { capabilityForCoreViewer } from "./preset-viewer-manifest.mjs";

export { capabilityForCoreViewer } from "./preset-viewer-manifest.mjs";

const require = createRequire(import.meta.url);
const registryJson = require("../../../shared/fileFormats.json");

/**
 * Main-process mirror of the core file-format policy, backed by the same JSON
 * registry as shared-ui. This is the authoritative core-vs-plugin gate used at
 * activation time; the renderer's route is only a presentation hint.
 */

const formats = Array.isArray(registryJson.formats) ? registryJson.formats : [];
const unknownFormat = registryJson.unknownFormat ?? { defaultViewer: "binary-placeholder" };

for (const format of [...formats, unknownFormat]) {
  capabilityForCoreViewer(format.defaultViewer ?? "binary-placeholder");
}

const filenameIndex = new Map();
const mimeIndex = new Map();
const extensionEntries = [];
const filenamePatterns = [];

for (const format of formats) {
  for (const filename of format.filenames ?? []) filenameIndex.set(filename.toLowerCase(), format);
  for (const extension of format.extensions ?? []) {
    extensionEntries.push({ extension: extension.toLowerCase(), format });
  }
  for (const mime of format.mimeTypes ?? []) mimeIndex.set(normalizeMime(mime), format);
  for (const pattern of format.filenamePatterns ?? []) {
    filenamePatterns.push({ regex: globPatternToRegExp(pattern.toLowerCase()), format });
  }
}
extensionEntries.sort((left, right) => right.extension.length - left.extension.length);

export function resolveCoreFormatPolicy({ name, mimeType = null }) {
  const normalizedName = basename(String(name ?? "")).toLowerCase();
  let format = filenameIndex.get(normalizedName) ?? null;
  if (!format && normalizedName) {
    format = extensionEntries.find(({ extension }) => normalizedName.endsWith(extension))?.format ?? null;
  }
  if (!format && normalizedName) {
    format = filenamePatterns.find(({ regex }) => regex.test(normalizedName))?.format ?? null;
  }

  const mime = normalizeMime(mimeType);
  if (!format && mime) format = mimeIndex.get(mime) ?? null;
  if (!format && mime.startsWith("image/")) {
    return {
      formatId: "image-unknown",
      viewerId: "image-preview",
      capability: capabilityForCoreViewer("image-preview"),
    };
  }
  if (
    !format &&
    (mime.startsWith("text/") || mime === "application/javascript" || mime === "application/typescript")
  ) {
    return {
      formatId: "text-unknown",
      viewerId: "plain-text",
      capability: capabilityForCoreViewer("plain-text"),
    };
  }

  const resolved = format ?? unknownFormat;
  const viewerId = resolved.defaultViewer ?? "binary-placeholder";
  return {
    formatId: resolved.id ?? "unknown",
    viewerId,
    capability: capabilityForCoreViewer(viewerId),
  };
}

function normalizeMime(value) {
  return typeof value === "string" ? value.toLowerCase().split(";")[0].trim() : "";
}

function basename(value) {
  return value.replace(/\\/g, "/").split("/").pop() ?? value;
}

function globPatternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
}
