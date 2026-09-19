import { randomUUID } from "node:crypto";
import { DATABASE_PREVIEW_VERSION, DATABASE_BUDGET, boundedInteger, databaseError, publicDatabaseFailure } from "../../../shared/database-preview/contract.mjs";
import { inspectDatabaseSource, verifyDatabaseSource } from "../../main/database-preview/source.mjs";
import { DATABASE_ENGINE_ADAPTERS } from "../../main/database-preview/registry.mjs";

const port = process.parentPort;
const send = (message) => port ? port.postMessage(message) : process.send(message);
const onMessage = (callback) => port ? port.on("message", ({ data }) => callback(data)) : process.on("message", callback);
let adapter, source, cursor = null, busy = false;
const epoch = randomUUID();
onMessage(async (request) => {
  if (request.version === DATABASE_PREVIEW_VERSION && request.method === "close" && !busy) {
    try { adapter?.close(); } finally { process.exit(0); }
  }
  if (busy) { send({ id: request.id, error: { code: "busy" } }); return; }
  busy = true;
  try {
    if (request.version !== DATABASE_PREVIEW_VERSION) throw databaseError("invalid-request");
    let result;
    if (request.method === "open" && !adapter) {
      source = await inspectDatabaseSource(request.rootPath, request.path);
      await verifyDatabaseSource(source);
      const definition = DATABASE_ENGINE_ADAPTERS[source.format.engine];
      if (!definition) throw databaseError("capability-unavailable");
      adapter = await definition.open(source);
      result = { engine: adapter.engine, engineVersion: adapter.version, objects: adapter.objects,
        adapterVersion: definition.adapterVersion, binding: definition.binding, dataModel: definition.dataModel,
        consistency: definition.consistency, capabilities: definition.capabilities,
        snapshotEpoch: epoch, pageRows: DATABASE_BUDGET.pageRows, pageColumns: DATABASE_BUDGET.pageColumns };
    } else if (request.method === "page" && adapter) {
      await verifyDatabaseSource(source);
      if (request.cursor) {
        if (request.cursor !== cursor) throw databaseError("invalid-request");
      } else {
        const schema = await adapter.select(String(request.objectId), boundedInteger(request.columnOffset, DATABASE_BUDGET.maxColumns));
        result = schema;
      }
      const page = await adapter.next();
      cursor = page.hasMore ? randomUUID() : null;
      result = { ...result, ...page, cursor, snapshotEpoch: epoch };
    } else throw databaseError("invalid-request");
    await verifyDatabaseSource(source);
    if (Buffer.byteLength(JSON.stringify(result)) > DATABASE_BUDGET.maxMessageBytes) throw databaseError("budget-exceeded");
    send({ id: request.id, result });
  } catch (error) { send({ id: request.id, error: publicDatabaseFailure(error) }); }
  finally { busy = false; }
});
