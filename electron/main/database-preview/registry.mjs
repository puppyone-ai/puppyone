import { openSqlite } from "./sqlite-adapter.mjs";
import { openDuckdb } from "./duckdb-adapter.mjs";

// Only packaged, first-party adapters. No workspace-defined modules, SQL or
// driver paths can enter this registry. A new engine supplies this protocol,
// not a branch in Workbench, FilePreview or the common save pipeline.
const relational = Object.freeze({ metadata: true, browse: true, filter: false, sort: false, count: false, sql: false });
const define = (engine, binding, open) => Object.freeze({ engine, adapterVersion: 1, binding,
  inputKind: "single-file", dataModel: "relational", consistency: "read-transaction",
  capabilities: relational, open });
export const DATABASE_ENGINE_ADAPTERS = Object.freeze({
  sqlite: define("sqlite", "electron-node:sqlite", openSqlite),
  duckdb: define("duckdb", "@duckdb/node-api@1.5.5-r.5", openDuckdb),
});
