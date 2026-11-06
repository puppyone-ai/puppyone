import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { normalizeRelativePath, resolveExistingWorkspacePath } from "./path-policy.mjs";

const SOURCE_LIMIT = 25 * 1024 * 1024;
const TEXT_LIMIT = 8 * 1024 * 1024;
const IMAGE_LIMIT = 20 * 1024 * 1024;

/** Narrow generated-output sink: it can only create a fresh sibling conversion folder. */
export async function saveWorkspaceDocumentConversion(rootPath, request) {
  const sourcePath = normalizeRelativePath(request?.path);
  if (!/\.(docx|pdf)$/i.test(sourcePath) || !/^[a-f\d]{64}$/.test(request?.fingerprint ?? "")) return invalid();
  const stem = path.posix.basename(sourcePath).replace(/\.(docx|pdf)$/i, "");
  const files = validateOutputs(request, stem);
  if (!files) return invalid();
  const source = await resolveExistingWorkspacePath(rootPath, sourcePath);
  if (await sourceFingerprint(source) !== request.fingerprint) return { ok: false, reason: "source-changed" };
  const parentRelative = path.posix.dirname(sourcePath) === "." ? "" : path.posix.dirname(sourcePath);
  const parent = await resolveExistingWorkspacePath(rootPath, parentRelative);
  // Fresh directory claim is authoritative even when another window saves at the same time.
  const baseName = `${Array.from(stem).slice(0, 40).join("")}-converted`;
  let folderName; let output;
  for (let attempt = 1; attempt <= 1000; attempt++) {
    folderName = baseName + (attempt === 1 ? "" : `-${attempt}`);
    output = path.join(parent, folderName);
    try { await fs.mkdir(output); break; }
    catch (error) { if (error?.code !== "EEXIST" || attempt === 1000) throw error; }
  }
  const folderPath = path.posix.join(parentRelative, folderName);
  try {
    const directories = new Set();
    for (const file of files) {
      const destination = path.join(output, file.path);
      const directory = path.dirname(destination);
      if (directory !== output && !directories.has(directory)) {
        await fs.mkdir(directory); directories.add(directory);
      }
      await fs.writeFile(destination, file.bytes, { flag: "wx" });
    }
    return { ok: true, folderPath, openPath: path.posix.join(folderPath, request.primaryPath),
      paths: files.map(file => path.posix.join(folderPath, file.path)) };
  } catch {
    // Preserve outputs after an incomplete save; retry claims another directory.
    return { ok: false, reason: "io", folderPath };
  }
}

function validateOutputs(request, stem) {
  if (!Array.isArray(request.files) || !request.files.length || request.files.length > 500) return null;
  const names = new Set(); let textBytes = 0; let imageBytes = 0;
  const files = [];
  for (const file of request.files) {
    if (!file || typeof file.path !== "string" || !(file.bytes instanceof Uint8Array)) return null;
    const markdown = file.path === `${stem}.md`;
    const csv = /^tables\/[a-z\d-]+\.csv$/.test(file.path);
    const image = /^assets\/image-\d+\.(png|jpg|gif|webp)$/.exec(file.path);
    if (!markdown && !csv && !image) return null;
    const key = file.path.toLowerCase();
    if (names.has(key)) return null;
    names.add(key);
    if (image) {
      imageBytes += file.bytes.byteLength;
      if (!imageSignature(file.bytes, image[1]) || imageBytes > IMAGE_LIMIT) return null;
    } else {
      textBytes += file.bytes.byteLength;
      if (textBytes > TEXT_LIMIT) return null;
      try { new TextDecoder("utf-8", { fatal: true }).decode(file.bytes); } catch { return null; }
    }
    files.push({ path: file.path, bytes: file.bytes });
  }
  if (!files.some(file => file.path === request.primaryPath && !file.path.startsWith("assets/"))) return null;
  return files;
}
function imageSignature(bytes, extension) {
  if (extension === "png") return [137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte);
  if (extension === "jpg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const start = Buffer.from(bytes.subarray(0, 12)).toString("ascii");
  return extension === "gif" ? /^GIF8[79]a/.test(start) : start.startsWith("RIFF") && start.slice(8, 12) === "WEBP";
}
async function sourceFingerprint(filePath) {
  const handle = await fs.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > SOURCE_LIMIT) throw new Error("Conversion source exceeds its limit.");
    const hash = createHash("sha256"); const chunk = Buffer.alloc(64 * 1024);
    let total = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > SOURCE_LIMIT) throw new Error("Conversion source exceeds its limit.");
      hash.update(chunk.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally { await handle.close(); }
}
const invalid = () => ({ ok: false, reason: "invalid" });
