import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { publishDirectory } from "./publish-directory.mjs";

const MAX_FILES = 256;
const MAX_BYTES = 32 * 1024 * 1024;
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

// A file plan contains data only. Sources never receive a destination path or
// a callback that could run a command, activate an Agent, or write elsewhere.
export function validateTemplatePlan(plan) {
  if (!Array.isArray(plan?.files) || plan.files.length > MAX_FILES) throw new Error("Invalid template file count.");
  const names = new Map();
  const directories = new Set();
  let bytes = 0;
  const files = plan.files.map((entry) => {
    const name = requireRelativeTemplatePath(entry?.path);
    const key = name.normalize("NFC").toLowerCase();
    if (names.has(key)) throw new Error(`Conflicting template path: ${name}`);
    names.set(key, "file");
    if (typeof entry.content !== "string" && !Buffer.isBuffer(entry.content) && !(entry.content instanceof Uint8Array)) {
      throw new Error(`Invalid template content: ${name}`);
    }
    bytes += Buffer.byteLength(entry.content);
    if (bytes > MAX_BYTES) throw new Error("Template exceeds the local content budget.");
    const content = Buffer.from(entry.content);
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i += 1) directories.add(parts.slice(0, i).join("/"));
    return { path: name, content };
  });
  const directoryKeys = new Map();
  for (const name of directories) {
    const key = name.normalize("NFC").toLowerCase();
    if (names.has(key) || (directoryKeys.has(key) && directoryKeys.get(key) !== name)) {
      throw new Error(`Conflicting template directory: ${name}`);
    }
    directoryKeys.set(key, name);
  }
  const initialOpenPath = plan.initialOpenPath ?? null;
  if (initialOpenPath !== null && !files.some((entry) => entry.path === initialOpenPath)) {
    throw new Error("The template opening document must be a generated file.");
  }
  const digest = createHash("sha256");
  digest.update(JSON.stringify({ initialOpenPath }));
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    digest.update(JSON.stringify([file.path, file.content.length]));
    digest.update(file.content);
  }
  return { files, directories: [...directories].sort((a, b) => a.split("/").length - b.split("/").length), initialOpenPath, digest: digest.digest("hex") };
}

export function requireRelativeTemplatePath(value) {
  if (typeof value !== "string" || value.length > 1024 || value.includes("\\")) throw new Error("Invalid template path.");
  const parts = value.split("/");
  if (parts.length > 16 || parts.some((part) => !part || part === "." || part === ".."
    || /[<>:"|?*\u0000-\u001f\u007f]/.test(part) || /[. ]$/.test(part)
    || Buffer.byteLength(part) > 240 || RESERVED_NAME.test(part))) throw new Error(`Invalid template path: ${value}`);
  return value;
}

export async function materializeTemplate({ parentPath, name, plan, beforePublish }, { io = fs, publish = publishDirectory } = {}) {
  const validated = validateTemplatePlan(plan);
  // The generated root is one new child, never an existing directory to merge.
  if (typeof name !== "string" || !name || name === "." || name === ".." || /[/\\\0]/.test(name)) throw new Error("Invalid template directory name.");
  const targetPath = path.join(parentPath, name);
  const stagingPath = await io.mkdtemp(path.join(parentPath, ".puppyone-template-"));
  let committed = false;
  try {
    for (const directory of validated.directories) await io.mkdir(path.join(stagingPath, directory));
    // Sequential writes bound memory and ensure no writer can outlive cleanup.
    for (const file of validated.files) await io.writeFile(path.join(stagingPath, file.path), file.content, { flag: "wx" });
    const identity = await io.stat(stagingPath, { bigint: true });
    await beforePublish?.({ stagingPath, targetPath, identity: { dev: String(identity.dev), ino: String(identity.ino), birthtimeNs: String(identity.birthtimeNs) }, digest: validated.digest });
    await publish(stagingPath, targetPath);
    committed = true;
    return {
      path: targetPath,
      initialOpenPath: validated.initialOpenPath,
      createdPaths: [...validated.directories, ...validated.files.map((file) => file.path)],
      digest: validated.digest,
    };
  } finally {
    // No code path rolls back the final directory after publication.
    if (!committed) await io.rm(stagingPath, { recursive: true, force: true });
  }
}
