import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { publishDirectory } from "../../../local-api/templates/publish-directory.mjs";
import { createImportSourceRegistry } from "./registry.mjs";
import { createImportWriter } from "./writer.mjs";

const CONNECTION_LIFETIME_MS = 30 * 60 * 1000;

/** Main-process coordinator for connection, discovery, and local publication. */
export function createLocalProjectImportService({
  io = fs,
  publish = publishDirectory,
  adapters,
  loadAdapter,
  descriptors,
  registry = createImportSourceRegistry({ descriptors, adapters, loadAdapter }),
  validateName,
  now = Date.now,
} = {}) {
  if (typeof validateName !== "function") throw new Error("Local import project name validation is required.");
  const connections = new Map();

  function requireConnection({ provider, connectionId, ownerId }) {
    const record = connections.get(connectionId);
    if (record?.expiresAt <= now()) connections.delete(connectionId);
    if (!record || record.provider !== provider || record.ownerId !== ownerId || record.expiresAt <= now()) {
      const error = new Error("Reconnect this import source and try again.");
      error.code = "IMPORT_CONNECTION_EXPIRED";
      throw error;
    }
    return record;
  }

  return Object.freeze({
    registry,
    async connectSource({ provider, ownerId, context = {} }) {
      if (!Number.isInteger(ownerId)) throw new Error("An import owner is required.");
      const { adapter } = await registry.require(provider);
      if (typeof adapter.connect !== "function" || typeof adapter.listResources !== "function") {
        throw new Error("This import source does not use an account connection.");
      }
      const value = await adapter.connect(context);
      const connectionId = randomUUID();
      for (const [id, record] of connections) {
        if (record.expiresAt <= now()) connections.delete(id);
      }
      connections.set(connectionId, { provider, ownerId, value, allowedResources: new Set(), expiresAt: now() + CONNECTION_LIFETIME_MS });
      return { connectionId };
    },
    async listResources({ provider, connectionId, ownerId, parentId = null, cursor = null }) {
      const { adapter } = await registry.require(provider);
      if (typeof adapter.listResources !== "function") throw new Error("This source cannot list resources.");
      const record = requireConnection({ provider, connectionId, ownerId });
      const page = normalizeResourcePage(await adapter.listResources({ connection: record.value, parentId, cursor }));
      for (const resource of page.items) record.allowedResources.add(resource.id);
      return page;
    },
    async importProject({ parentPath, source, ownerId, signal, onProgress = () => {} }) {
      const { descriptor, adapter } = await registry.require(source?.provider);
      const record = descriptor.mode === "remote"
        ? requireConnection({ provider: descriptor.id, connectionId: source?.connectionId, ownerId })
        : null;
      if (record && !record.allowedResources.has(source?.resourceId)) {
        throw new Error("Choose a resource from this connection before importing.");
      }
      const connection = record?.value ?? null;
      onProgress({ phase: "preparing" });
      const prepared = await adapter.inspect(source, { connection });
      const name = validateName(prepared.name);
      const targetPath = path.join(parentPath, name);
      const existing = await io.lstat(targetPath).then(() => true).catch((error) => {
        if (error?.code === "ENOENT") return false;
        throw error;
      });
      if (existing) throw projectExists(name);
      const stagingPath = await io.mkdtemp(path.join(parentPath, `.puppyone-import-${name}-`));
      let published = false;
      try {
        const writer = createImportWriter({ stagingPath, io, signal,
          allowBulk: descriptor.mode !== "remote", onProgress });
        onProgress({ phase: "reading" });
        await adapter.materialize({ source: prepared.source, connection, writer, targetPath, signal, onProgress });
        if (signal?.aborted) throw new Error("Import cancelled.");
        onProgress({ phase: "publishing" });
        try {
          await publish(stagingPath, targetPath);
        } catch (error) {
          if (error?.code === "EEXIST") throw projectExists(name);
          throw error;
        }
        published = true;
        onProgress({ phase: "complete", filesWritten: writer.filesWritten });
        return { path: targetPath, name, provider: descriptor.id };
      } finally {
        if (!published) await io.rm(stagingPath, { recursive: true, force: true });
      }
    },
  });
}

function projectExists(name) {
  const error = new Error(`A file or folder named “${name}” already exists in that location.`);
  error.code = "PROJECT_ALREADY_EXISTS";
  return error;
}

function normalizeResourcePage(page) {
  if (!page || !Array.isArray(page.items) || !(page.nextCursor === null || typeof page.nextCursor === "string")) {
    throw new Error("Import source returned an invalid resource page.");
  }
  return {
    items: page.items.map((resource) => {
      if (typeof resource?.id !== "string" || !resource.id || typeof resource?.name !== "string"
        || !["folder", "document", "database", "file"].includes(resource?.kind)) {
        throw new Error("Import source returned an invalid resource.");
      }
      return { id: resource.id, name: resource.name, kind: resource.kind };
    }),
    nextCursor: page.nextCursor,
  };
}
