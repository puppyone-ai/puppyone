import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { materializeTemplate, validateTemplatePlan } from "../../local-api/templates/materialize.mjs";
import { publishDirectory } from "../../local-api/templates/publish-directory.mjs";
import { resolveProjectTemplate } from "../../local-api/templates/project-catalog.mjs";

/** The caller must authorize the parent for this sender before every call. */
export function createProjectInitializationService({ journalDirectory = null, materialize = materializeTemplate } = {}) {
  const pending = new Map();
  const completed = new Map();

  async function initialize({ parentPath, name, source, locale, operationId = randomUUID() }) {
    if (typeof operationId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(operationId)) throw new Error("Invalid initialization operation ID.");
    const plan = await resolveProjectTemplate(source, locale);
    const validated = validateTemplatePlan(plan);
    const fingerprint = createHash("sha256").update(JSON.stringify({ parentPath, name, source, locale: plan.template?.resolvedLocale, digest: validated.digest })).digest("hex");
    const known = completed.get(operationId) ?? pending.get(operationId);
    if (known) {
      if (known.fingerprint !== fingerprint) throw new Error("This initialization ID belongs to a different request.");
      return known.result;
    }
    const result = run({ parentPath, name, plan, validated, operationId, fingerprint });
    pending.set(operationId, { fingerprint, result });
    try {
      const receipt = await result;
      completed.set(operationId, { fingerprint, result: receipt });
      // Disk receipts own persistence; the cache only coalesces recent retries.
      if (completed.size > 128) completed.delete(completed.keys().next().value);
      return receipt;
    } finally {
      pending.delete(operationId);
    }
  }

  async function run({ parentPath, name, plan, validated, operationId, fingerprint }) {
    const journalRoot = typeof journalDirectory === "function" ? journalDirectory() : journalDirectory;
    const journalPath = journalRoot ? path.join(journalRoot, `${operationId}.json`) : null;
    if (journalRoot) await fs.mkdir(journalRoot, { recursive: true, mode: 0o700 });
    const receipt = {
      operationId,
      outcome: "committed",
      path: path.join(parentPath, name),
      name,
      createdPaths: [...validated.directories, ...validated.files.map((entry) => entry.path)],
      initialOpenPath: validated.initialOpenPath,
      template: plan.template ? { ...plan.template, digest: validated.digest } : null,
    };
    const existing = journalPath ? await fs.readFile(journalPath, "utf8").then(JSON.parse).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    }) : null;
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("This initialization ID belongs to a different request.");
      if (!["publishing", "committed"].includes(existing.state)
        || existing.receipt?.operationId !== operationId
        || existing.receipt?.path !== path.join(parentPath, name)
        || path.dirname(existing.stagingPath ?? "") !== parentPath
        || !path.basename(existing.stagingPath).startsWith(".puppyone-template-")) {
        throw new Error("Invalid initialization journal. No project files were changed.");
      }
      if (existing.state === "committed") return receipt;
      if (await matchesIdentity(receipt.path, existing.identity)) {
        await save({ ...existing, state: "committed" }, journalPath);
        return receipt;
      }
      if (await matchesIdentity(existing.stagingPath, existing.identity)) {
        await publishDirectory(existing.stagingPath, receipt.path);
        await save({ ...existing, state: "committed" }, journalPath);
        return receipt;
      }
      throw new Error("The previous creation could not be safely recovered. Check the project location before starting a new creation.");
    }
    let publishing = null;
    try {
      await materialize({ parentPath, name, plan, beforePublish: async ({ stagingPath, identity }) => {
        publishing = { state: "publishing", fingerprint, receipt, stagingPath, identity };
        await save(publishing, journalPath);
      } });
    } catch (error) {
      // If publication actually happened, retain the receipt and user files.
      // Otherwise the materializer has drained writes and removed its staging.
      if (!publishing || !await matchesIdentity(receipt.path, publishing.identity)) {
        if (journalPath) await fs.unlink(journalPath).catch((cleanupError) => {
          if (cleanupError.code !== "ENOENT") throw cleanupError;
        });
        throw error;
      }
    }
    // A failed acknowledgement must never turn a committed directory into a
    // second create. The publishing record can recover by directory identity.
    await save({ ...publishing, state: "committed" }, journalPath).catch(() => undefined);
    return receipt;
  }

  return Object.freeze({ initialize });
}

async function matchesIdentity(target, identity) {
  if (!target || !identity || !identity.ino || identity.ino === "0"
    || !identity.birthtimeNs || identity.birthtimeNs === "0") return false;
  const metadata = await fs.lstat(target, { bigint: true }).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  return !!metadata && metadata.isDirectory() && !metadata.isSymbolicLink()
    && String(metadata.dev) === identity.dev && String(metadata.ino) === identity.ino
    && String(metadata.birthtimeNs) === identity.birthtimeNs;
}

async function save(record, filePath) {
  if (!filePath) return;
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}
